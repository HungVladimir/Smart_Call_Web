// Mã nguồn tham chiếu mẫu: bọc @wazo/sdk (đăng nhập, SIP/WebRTC) + gọi REST API của Wazo
// (danh bạ qua wazo-dird, trạng thái qua wazo-chatd, sự kiện realtime qua wazo-websocketd).
import Wazo from "@wazo/sdk";
import { reactive } from "vue";
import { startRingtone, startRingback, stopTones } from "./tones";

const HOST_KEY = "wazo-test.host";

function savedHost() {
  try {
    return localStorage.getItem(HOST_KEY);
  } catch {
    return null;
  }
}

function defaultHost() {
  const h = window.location.hostname;
  const isDev =
    !h ||
    h === "localhost" ||
    h === "127.0.0.1" ||
    window.location.port === "5173";
  if (!isDev) return window.location.host;
  return savedHost() || import.meta.env.VITE_WAZO_HOST || "107.126.11.126";
}

export const state = reactive({
  host: defaultHost(),
  phase: "login", // login | connecting | ready
  error: "",
  me: null, // { uuid, name, exten }
  registered: false,
  calls: [], // { id, number, name, direction: 'in'|'out', status: 'calling'|'ringing'|'active', startedAt }
  contacts: [], // { uuid, name, exten }
  contactsMode: "list", // list | search (dự phòng khi không liệt kê được toàn bộ)
  contactsError: "",
  presences: {}, // user uuid -> bản ghi presence của chatd
  logs: [],
});

const sessions = new Map(); // call id -> CallSession
let handlersBound = false;
let ws = null;
let pollTimer = null;
let refreshTimer = null;

export function log(...args) {
  const line = `${new Date().toLocaleTimeString()}  ${args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? a.message
          : JSON.stringify(a),
    )
    .join(" ")}`;
  state.logs.unshift(line);
  if (state.logs.length > 200) state.logs.pop();
  console.log("[wazo-test]", ...args);
}

function token() {
  return Wazo.Auth.getSession()?.token;
}

async function api(path) {
  const res = await fetch(`https://${state.host}${path}`, {
    headers: { "X-Auth-Token": token(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------- Đăng nhập

export async function login(host, username, password) {
  state.error = "";
  state.phase = "connecting";
  state.host = host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  try {
    localStorage.setItem(HOST_KEY, state.host);
  } catch {
    /* ignore */
  }

  try {
    Wazo.Auth.init("wazo-test-webapp");
    Wazo.Auth.setHost(state.host);
    const session = await Wazo.Auth.logIn(username, password);
    const p = session.profile || {};
    let exten = "";
    try {
      exten = session.primaryNumber?.() || "";
    } catch {
      /* ignore */
    }
    state.me = {
      uuid: session.uuid,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || username,
      exten,
    };
    log("Đăng nhập OK:", state.me.name, state.me.uuid);
  } catch (e) {
    state.phase = "login";
    state.error = `Đăng nhập thất bại: ${e.message || e}. Kiểm tra tài khoản, IP server và chứng chỉ CA.`;
    log("Lỗi đăng nhập", e);
    return;
  }

  try {
    await Wazo.Phone.connect({ audio: true, video: false });
    bindPhoneHandlers();
    state.registered = true;
    log("Đã đăng ký SIP qua WSS");
  } catch (e) {
    state.error = `Không kết nối được WebRTC (wss://${state.host}/api/asterisk/ws): ${e.message || e}`;
    log("Lỗi Phone.connect", e);
  }

  state.phase = "ready";
  loadContacts();
  openEvents();
  pollTimer = setInterval(loadPresences, 10000);
}

export async function logout() {
  clearInterval(pollTimer);
  clearTimeout(refreshTimer);
  stopTones();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  try {
    await Wazo.Phone.disconnect();
  } catch {
    /* ignore */
  }
  try {
    await Wazo.Auth.logout();
  } catch {
    /* ignore */
  }
  sessions.clear();
  handlersBound = false;
  Object.assign(state, {
    phase: "login",
    error: "",
    me: null,
    registered: false,
    calls: [],
    contacts: [],
    contactsError: "",
    presences: {},
  });
}

// ---------------------------------------------------------------- Cuộc gọi

function cid(cs) {
  return (cs.getId && cs.getId()) || cs.sipCallId || cs.callId;
}

function upsertCall(cs, patch) {
  const id = cid(cs);
  sessions.set(id, cs);
  let call = state.calls.find((c) => c.id === id);
  if (!call) {
    call = {
      id,
      number: cs.number || "",
      name: cs.displayName || cs.number || "",
      direction: "out",
      status: "calling",
      startedAt: null,
    };
    state.calls.push(call);
  }
  Object.assign(call, patch);
  return call;
}

function removeCall(cs, reason) {
  const id = cid(cs);
  sessions.delete(id);
  if (state.calls.some((c) => c.id === id)) {
    state.calls = state.calls.filter((c) => c.id !== id);
    log(`Cuộc gọi kết thúc (${reason})`, cs.number || "");
  }
  updateTones();
}

function updateTones() {
  if (state.calls.some((c) => c.direction === "in" && c.status === "ringing"))
    startRingtone();
  else if (
    state.calls.some((c) => c.direction === "out" && c.status !== "active")
  )
    startRingback();
  else stopTones();
}

function attachRemoteAudio(cs) {
  setTimeout(() => {
    const el = document.getElementById("remote-audio");
    const sdkAudio = [...document.querySelectorAll("audio")].filter(
      (a) => a !== el && a.srcObject,
    );
    if (sdkAudio.length || !el) return;
    const stream = Wazo.Phone.getRemoteStream(cs);
    if (stream) {
      el.srcObject = stream;
      el.play().catch((e) => log("Không phát được audio", e));
      log("Đã gắn audio dự phòng");
    }
  }, 800);
}

function bindPhoneHandlers() {
  if (handlersBound) return;
  handlersBound = true;
  const P = Wazo.Phone;

  P.on(P.ON_CALL_INCOMING, (cs) => {
    upsertCall(cs, { direction: "in", status: "ringing" });
    log("Cuộc gọi đến từ", cs.displayName || "", cs.number || "");
    updateTones();
  });
  P.on(P.ON_CALL_OUTGOING, (cs) => {
    upsertCall(cs, { direction: "out" });
    updateTones();
  });
  P.on(P.ON_PROGRESS, (cs) => {
    const call = state.calls.find((c) => c.id === cid(cs));
    if (call && call.direction === "out" && call.status !== "active")
      call.status = "ringing";
  });
  P.on(P.ON_CALL_ACCEPTED, (cs) => {
    upsertCall(cs, { status: "active", startedAt: Date.now() });
    log("Đã kết nối", cs.number || "");
    updateTones();
    attachRemoteAudio(cs);
  });
  P.on(P.ON_CALL_ENDED, (cs) => removeCall(cs, "kết thúc"));
  P.on(P.ON_CALL_FAILED, (cs) => removeCall(cs, "thất bại"));
  P.on(P.ON_CALL_REJECTED, (cs) => removeCall(cs, "bị từ chối"));
  P.on(P.ON_CALL_CANCELED, (cs) => removeCall(cs, "bị huỷ"));
  P.on(P.ON_REGISTERED, () => {
    state.registered = true;
    log("SIP registered");
  });
  P.on(P.ON_UNREGISTERED, () => {
    state.registered = false;
    log("SIP unregistered");
  });
}

export async function call(number) {
  number = String(number || "").trim();
  if (!number) return;
  log("Gọi", number);
  try {
    const cs = await Wazo.Phone.call(number, false);
    if (cs) {
      const contact = state.contacts.find((c) => c.exten === number);
      upsertCall(cs, {
        direction: "out",
        number,
        name: contact?.name || number,
      });
      updateTones();
    }
  } catch (e) {
    log("Lỗi khi gọi", e);
    state.error = `Không gọi được ${number}: ${e.message || e}`;
  }
}

export async function accept(id) {
  const cs = sessions.get(id);
  if (!cs) return;
  for (const c of state.calls.filter(
    (x) => x.status === "active" && x.id !== id,
  ))
    await hangup(c.id);
  try {
    await Wazo.Phone.accept(cs, false);
  } catch (e) {
    log("Lỗi nghe máy", e);
  }
}

export async function reject(id) {
  const cs = sessions.get(id);
  if (!cs) return;
  try {
    await Wazo.Phone.reject(cs);
  } catch (e) {
    log("Lỗi từ chối", e);
  }
  removeCall(cs, "đã từ chối");
}

export async function hangup(id) {
  const cs = sessions.get(id);
  if (!cs) return;
  try {
    await Wazo.Phone.hangup(cs);
  } catch (e) {
    log("Lỗi cúp máy", e);
  }
  removeCall(cs, "đã cúp");
}

// ---------------------------------------------------------------- Danh bạ

function mapWazoUser(u) {
  return {
    uuid: u.uuid,
    name:
      [u.firstname, u.lastname].filter(Boolean).join(" ") ||
      u.username ||
      u.email ||
      u.exten ||
      "?",
    exten: u.exten || "",
  };
}

export async function loadContacts() {
  state.contactsError = "";
  try {
    const sources = await api(
      "/api/dird/0.1/directories/default/sources?backend=wazo",
    );
    const source = sources?.items?.[0];
    if (!source) throw new Error("Không tìm thấy nguồn danh bạ wazo");
    const data = await api(
      `/api/dird/0.1/backends/wazo/sources/${source.uuid}/contacts?limit=1000`,
    );
    setContacts((data.items || []).map(mapWazoUser));
    state.contactsMode = "list";
    log(`Danh bạ: ${state.contacts.length} người`);
  } catch (e) {
    log("Không liệt kê được danh bạ, chuyển sang chế độ tìm kiếm:", e);
    state.contactsMode = "search";
    await searchContacts("1");
  }
}

export async function searchContacts(term) {
  term = String(term || "").trim();
  if (!term) return;
  try {
    const data = await api(
      `/api/dird/0.1/directories/lookup/default?term=${encodeURIComponent(term)}`,
    );
    const types = data.column_types || [];
    const iName = types.indexOf("name");
    const iNum = types.indexOf("number");
    setContacts(
      (data.results || []).map((r) => ({
        uuid: r.relations?.user_uuid || null,
        name: (iName >= 0 && r.column_values[iName]) || "?",
        exten: (iNum >= 0 && r.column_values[iNum]) || "",
      })),
    );
    state.contactsError = "";
  } catch (e) {
    state.contactsError = `Không tải được danh bạ: ${e.message}`;
    log("Lỗi tìm danh bạ", e);
  }
}

function setContacts(list) {
  const meUuid = state.me?.uuid;
  const mine = list.find((c) => c.uuid && c.uuid === meUuid);
  if (mine && state.me && !state.me.exten) state.me.exten = mine.exten;
  state.contacts = list
    .filter((c) => c.uuid !== meUuid)
    .sort((a, b) =>
      String(a.exten).localeCompare(String(b.exten), undefined, {
        numeric: true,
      }),
    );
  loadPresences();
}

// ---------------------------------------------------------------- Trạng thái

export async function loadPresences() {
  const uuids = state.contacts.map((c) => c.uuid).filter(Boolean);
  if (!uuids.length || state.phase !== "ready") return;
  try {
    const data = await api(
      `/api/chatd/1.0/users/presences?user_uuid=${uuids.join(",")}`,
    );
    for (const it of data.items || [])
      state.presences[it.uuid || it.user_uuid] = it;
  } catch (e) {
    log("Lỗi tải trạng thái", e);
  }
}

export function statusOf(uuid) {
  const p = uuid && state.presences[uuid];
  if (!p) return { key: "unknown", label: "Không rõ" };
  const lines = (p.lines || []).map((l) => l.state);
  if (lines.some((s) => s === "talking" || s === "holding"))
    return { key: "busy", label: "Đang gọi" };
  if (lines.some((s) => s === "ringing" || s === "progressing"))
    return { key: "ringing", label: "Đang đổ chuông" };
  if (p.do_not_disturb) return { key: "dnd", label: "Không làm phiền" };
  const online = lines.length
    ? lines.some((s) => s !== "unavailable")
    : p.connected === true;
  if (!online) return { key: "offline", label: "Offline" };
  if (p.state === "away") return { key: "away", label: "Vắng mặt" };
  return { key: "online", label: "Sẵn sàng" };
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadPresences, 300);
}

function openEvents() {
  try {
    ws = new WebSocket(
      `wss://${state.host}/api/websocketd/?token=${token()}&version=2`,
    );
  } catch (e) {
    log("Không mở được websocketd", e);
    return;
  }
  const subscribe = () => {
    for (const name of [
      "chatd_presence_updated",
      "chatd_user_presence_updated",
    ]) {
      ws.send(JSON.stringify({ op: "subscribe", data: { event_name: name } }));
    }
    ws.send(JSON.stringify({ op: "start" }));
  };
  ws.onopen = () => {
    subscribe();
    log("websocketd đã kết nối");
  };
  ws.onmessage = (m) => {
    let msg;
    try {
      msg = JSON.parse(m.data);
    } catch {
      return;
    }
    const ev = msg.op === "event" ? msg.data : msg;
    const name = ev?.name || "";
    if (name.includes("presence")) {
      const d = ev.data || {};
      const uuid = d.uuid || d.user_uuid;
      if (uuid)
        state.presences[uuid] = { ...(state.presences[uuid] || {}), ...d };
      else scheduleRefresh();
    }
  };
  ws.onclose = () => {
    log("websocketd đóng, thử lại sau 5 giây");
    ws = null;
    if (state.phase === "ready") setTimeout(openEvents, 5000);
  };
}

