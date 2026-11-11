
# Wazo — Hướng dẫn cho developer Web & Mobile

Tài liệu cho team phát triển webapp và app Android kết nối tới server tổng đài nội bộ **Wazo Platform 26.10**
(chạy offline trong LAN). Đọc mục 1–3 trước, các mục sau tra cứu khi cần.

> Danh sách endpoint trong tài liệu này là **những endpoint hay dùng**, không phải toàn bộ.
> Danh sách đầy đủ, chính xác theo đúng phiên bản đang chạy: tải file OpenAPI của từng service (mục 3).
> Endpoint nào ghi *(kiểm tra spec)* là chưa được test trên server của mình.

---

## 1. Tổng quan

```
 App (Web / Android)
   │
   ├── HTTPS  https://<HOST>/api/<service>/<version>/...   REST API (đăng nhập, user, cuộc gọi, danh bạ...)
   ├── WSS    wss://<HOST>/api/websocketd/                 Sự kiện realtime (cuộc gọi, trạng thái, chat)
   ├── WSS    wss://<HOST>/api/asterisk/ws                 SIP over WebSocket (đăng ký, gọi WebRTC)
   └── UDP    <IP>:<RTP_START>-<RTP_END>                   Âm thanh (SRTP), tự đi qua ICE
```

| Biến | Giá trị ở server LAN | Ghi chú |
|---|---|---|
| `<HOST>` | `<IP>:<WAZO_HTTPS_PORT>`, mặc định `<IP>:9443` | lấy trong file `.env` của server |
| Dải RTP | mặc định UDP `30000–30200` | client không cần cấu hình, chỉ cần không bị firewall chặn |
| CA | `https://<HOST>/wazo-ca.crt` | **bắt buộc** client tin CA này (mục 9) |
| Tenant | `lan-company` | hệ thống có 1 tenant |
| Context nội bộ | `ctx-lancompany-internal-...` | lấy chính xác qua API `GET /api/confd/1.1/contexts` |
| Dải máy lẻ | 1000–1999 | |

Tài khoản test: `alice` / `bob` / `carol`, mật khẩu `Test@123`, máy lẻ 1001 / 1002 / 1003.
Tài khoản quản trị: `root` (chỉ dùng cho công cụ admin, **không** nhúng vào app).

CORS đã mở: webapp chạy ở origin khác vẫn gọi API được.

---

## 2. Xác thực (wazo-auth)

Mọi API (trừ lấy token) cần header:

```
X-Auth-Token: <token>
```

### 2.1 Lấy token (đăng nhập)

```bash
curl --cacert wazo-ca.crt -X POST -u alice:Test@123 \
  -H 'Content-Type: application/json' \
  -d '{"expiration": 3600, "access_type": "offline", "client_id": "my-android-app"}' \
  https://<HOST>/api/auth/0.1/token
```

Kết quả (rút gọn):

```json
{
  "data": {
    "token": "4f1c...-...",
    "refresh_token": "a8b2...",
    "expires_at": "2026-11-10T10:00:00",
    "metadata": { "uuid": "<user_uuid>", "tenant_uuid": "<tenant_uuid>", "pbx_user_uuid": "<user_uuid>" },
    "acl": ["confd.users.me.read", "calld.users.me.#", "..."]
  }
}
```

- `access_type: offline` + `client_id` → nhận `refresh_token` để app mobile **không phải lưu mật khẩu**.
- Lưu `metadata.uuid` (user UUID): rất nhiều API cần nó.

### 2.2 Gia hạn bằng refresh token

```bash
curl --cacert wazo-ca.crt -X POST -H 'Content-Type: application/json' \
  -d '{"refresh_token": "<refresh_token>", "client_id": "my-android-app", "expiration": 3600}' \
  https://<HOST>/api/auth/0.1/token
```

Không cần Basic auth. Nên gia hạn trước khi token hết hạn ~1 phút.

### 2.3 Kiểm tra / đăng xuất / đổi mật khẩu

| Việc | Request |
|---|---|
| Token còn hợp lệ? | `HEAD /api/auth/0.1/token/{token}` (200 = còn) |
| Thông tin token | `GET /api/auth/0.1/token/{token}` |
| Đăng xuất | `DELETE /api/auth/0.1/token/{token}` |
| Xoá refresh token của app | `DELETE /api/auth/0.1/users/{user_uuid}/tokens/{client_id}` *(kiểm tra spec)* |
| Đổi mật khẩu | `PUT /api/auth/0.1/users/{user_uuid}/password` body `{"old_password": "...", "new_password": "..."}` |

### 2.4 Quyền (ACL)

- Token của **user thường** chỉ đọc/ghi dữ liệu của chính mình (các endpoint `/users/me/...`
  hoặc `/users/{uuid_của_mình}/...`). Gọi API admin sẽ bị **401/403**.
- API quản trị (tạo user, import...) dùng token của tài khoản admin. Không nhúng tài khoản admin
  vào app; nếu cần, làm một backend riêng giữ tài khoản đó.
- API admin có thể cần header `Wazo-Tenant: <tenant_uuid>`.

---

## 3. Danh sách đầy đủ API (OpenAPI / Swagger)

Mỗi service Wazo tự phục vụ file mô tả OpenAPI của nó. Đây là **nguồn chính xác nhất**:

| Service | Prefix | Dùng cho | Spec |
|---|---|---|---|
| wazo-auth | `/api/auth/0.1` | đăng nhập, token, user đăng nhập, policy | `/api/auth/0.1/api/api.yml` |
| wazo-confd | `/api/confd/1.1` | cấu hình: user, line, máy lẻ, context, nhóm, IVR, import CSV | `/api/confd/1.1/api/api.yml` |
| wazo-calld | `/api/calld/1.0` | điều khiển cuộc gọi: gọi, cúp, giữ máy, chuyển, voicemail | `/api/calld/1.0/api/api.yml` |
| wazo-call-logd | `/api/call-logd/1.0` | lịch sử cuộc gọi (CDR), ghi âm | `/api/call-logd/1.0/api/api.yml` |
| wazo-dird | `/api/dird/0.1` | danh bạ, tìm kiếm, yêu thích, danh bạ cá nhân | `/api/dird/0.1/api/api.yml` |
| wazo-chatd | `/api/chatd/1.0` | trạng thái (presence), chat | `/api/chatd/1.0/api/api.yml` |
| wazo-webhookd | `/api/webhookd/1.0` | webhook gửi sự kiện sang hệ thống khác | `/api/webhookd/1.0/api/api.yml` |
| wazo-agentd | `/api/agentd/1.0` | agent call center | `/api/agentd/1.0/api/api.yml` |
| wazo-amid | `/api/amid/1.0` | Asterisk AMI (admin) | `/api/amid/1.0/api/api.yml` |
| wazo-websocketd | `/api/websocketd/` | sự kiện realtime (mục 6) | – |

Tải toàn bộ spec về máy (chạy ở máy dev có kết nối tới server):

```bash
HOST=192.168.1.50:9443
for s in auth/0.1 confd/1.1 calld/1.0 call-logd/1.0 dird/0.1 chatd/1.0 webhookd/1.0 agentd/1.0 amid/1.0; do
  f="wazo-$(echo $s | cut -d/ -f1).yml"
  curl -s --cacert wazo-ca.crt -o "$f" "https://$HOST/api/$s/api/api.yml" && echo "OK $f"
done
```

Mở các file `.yml` bằng **Swagger Editor** (bản offline), **Postman** (Import → OpenAPI) hoặc
**Insomnia** để xem đủ endpoint, tham số và schema, và gọi thử.
Tài liệu online (máy có internet): https://wazo-platform.org/documentation (mục API).

> Nếu đường dẫn spec trả 404 trên server, báo lại để kiểm tra; đường dẫn có thể khác giữa các phiên bản.

---

## 4. Endpoint thường dùng cho app người dùng

Dùng token của chính user. `{me}` = user UUID lấy từ token.

### 4.1 Thông tin user & line

| Việc | Request |
|---|---|
| Thông tin user (tên, máy lẻ, line) | `GET /api/confd/1.1/users/{me}` |
| Các line của user | `GET /api/confd/1.1/users/{me}/lines` |
| Thông tin SIP của line (username/secret, cho SIP stack gốc) | `GET /api/confd/1.1/users/{me}/lines/{line_id}/associated/endpoints/sip` *(kiểm tra spec)* |
| Bật/tắt Không làm phiền | `PUT /api/confd/1.1/users/{me}/services/dnd` body `{"enabled": true}` |
| Chuyển tiếp cuộc gọi | `GET/PUT /api/confd/1.1/users/{me}/forwards` (busy / noanswer / unconditional) |

### 4.2 Điều khiển cuộc gọi (wazo-calld)

Dùng khi muốn điều khiển từ server (ví dụ "click-to-call"). Với WebRTC, phần lớn thao tác làm trực tiếp qua SDK/SIP.

| Việc | Request |
|---|---|
| Cuộc gọi đang có | `GET /api/calld/1.0/users/me/calls` |
| Gọi đi | `POST /api/calld/1.0/users/me/calls` body `{"extension": "1002"}` (server đổ chuông máy mình trước, nhấc lên mới gọi đi) |
| Cúp máy | `DELETE /api/calld/1.0/users/me/calls/{call_id}` |
| Nghe máy | `PUT /api/calld/1.0/users/me/calls/{call_id}/answer` |
| Giữ máy / bỏ giữ | `PUT .../users/me/calls/{call_id}/hold/start` · `.../hold/stop` |
| Tắt / bật mic | `PUT .../users/me/calls/{call_id}/mute/start` · `.../mute/stop` |
| Gửi phím DTMF | `PUT .../users/me/calls/{call_id}/dtmf?digits=123` |
| Chuyển cuộc gọi | `POST /api/calld/1.0/users/me/transfers` body `{"initiator_call": "<call_id>", "exten": "1003", "flow": "blind"}` (`blind` hoặc `attended`) |
| Hoàn tất / huỷ chuyển (attended) | `PUT .../users/me/transfers/{transfer_id}/complete` · `DELETE .../users/me/transfers/{transfer_id}` |
| Voicemail | `GET /api/calld/1.0/users/me/voicemails` |

### 4.3 Lịch sử cuộc gọi (wazo-call-logd)

```
GET /api/call-logd/1.0/users/me/cdr?limit=50&offset=0&order=start&direction=desc
```

Trường hay dùng: `start`, `end`, `answered`, `duration`, `source_name`, `source_extension`,
`destination_name`, `destination_extension`, `call_direction` (`internal` / `inbound` / `outbound`).
Lọc thêm: `from`, `until` (ISO 8601), `search`, `call_direction`.

### 4.4 Danh bạ (wazo-dird)

Profile mặc định: `default`.

| Việc | Request |
|---|---|
| Tìm theo tên/số | `GET /api/dird/0.1/directories/lookup/default?term=alice` |
| Liệt kê toàn bộ user nội bộ | B1: `GET /api/dird/0.1/directories/default/sources?backend=wazo` → lấy `items[0].uuid`<br>B2: `GET /api/dird/0.1/backends/wazo/sources/{source_uuid}/contacts?limit=1000` |
| Yêu thích | `GET /api/dird/0.1/directories/favorites/default` · `PUT/DELETE /api/dird/0.1/directories/favorites/{source}/{contact_id}` |
| Danh bạ cá nhân | `GET/POST /api/dird/0.1/personal` · `GET/PUT/DELETE /api/dird/0.1/personal/{id}` |

Kết quả `lookup` dạng cột: dùng `column_types` để biết cột nào là `name`, `number`;
`relations.user_uuid` là UUID user Wazo (để ghép với trạng thái).

### 4.5 Trạng thái (wazo-chatd)

| Việc | Request |
|---|---|
| Trạng thái nhiều người | `GET /api/chatd/1.0/users/presences?user_uuid=<uuid1>,<uuid2>` (tối đa ~30 uuid mỗi lần) |
| Trạng thái 1 người | `GET /api/chatd/1.0/users/{uuid}/presences` |
| Đặt trạng thái của mình | `PUT /api/chatd/1.0/users/{me}/presences` body `{"state": "available", "status": "Đang họp"}` |

`state`: `available` · `away` · `unavailable` · `invisible`.
`lines[].state` cho biết đang gọi: `available` (line online), `ringing`, `progressing`, `talking`,
`holding`, `unavailable` (line offline). Gợi ý hiển thị: có line `talking/holding` → "Đang gọi";
`ringing` → "Đổ chuông"; không line nào `available` → "Offline".

### 4.6 Chat (wazo-chatd)

| Việc | Request |
|---|---|
| Phòng chat của tôi | `GET /api/chatd/1.0/users/me/rooms` |
| Tạo phòng 1-1 | `POST /api/chatd/1.0/users/me/rooms` body `{"users": [{"uuid": "<me>"}, {"uuid": "<other>"}]}` |
| Tin nhắn | `GET /api/chatd/1.0/users/me/rooms/{room_uuid}/messages?limit=50` |
| Gửi tin | `POST /api/chatd/1.0/users/me/rooms/{room_uuid}/messages` body `{"content": "Xin chào", "alias": "Alice"}` |

---

## 5. Gọi điện WebRTC (SIP over WSS)

| Thông số | Giá trị |
|---|---|
| WebSocket SIP | `wss://<HOST>/api/asterisk/ws`, subprotocol **`sip`** |
| SIP domain | IP/hostname server |
| Xác thực SIP | `username` / `secret` của line (mục 4.1), **không** phải mật khẩu đăng nhập |
| Media | DTLS-SRTP, ICE, AVPF, rtcp-mux (template `webrtc`), audio Opus / G.711 |
| Số gọi | máy lẻ nội bộ, ví dụ `1002` |

Mỗi user test đã có line template `webrtc`. User mới tạo phải chọn line **WebRTC** thì mới gọi được từ web/app.

---

## 6. Sự kiện realtime (wazo-websocketd)

```
wss://<HOST>/api/websocketd/?token=<token>&version=2
```

Giao thức v2 (JSON):

```jsonc
// client -> server: đăng ký sự kiện, rồi "start"
{"op": "subscribe", "data": {"event_name": "call_created"}}
{"op": "subscribe", "data": {"event_name": "chatd_presence_updated"}}
{"op": "start"}

// server -> client
{"op": "event", "code": 0, "data": {"name": "call_created", "origin_uuid": "...", "data": { /* nội dung */ }}}

// khi đã gia hạn token: đổi token cho kết nối đang mở (không cần mở lại)
{"op": "token", "data": {"token": "<token_moi>"}}
```

Dùng `"*"` làm `event_name` để nhận tất cả (tiện khi debug).

Sự kiện hay dùng *(xác nhận tên bằng cách subscribe `*` rồi xem log)*:

| Sự kiện | Khi nào |
|---|---|
| `call_created` · `call_updated` · `call_answered` · `call_ended` | cuộc gọi của user thay đổi |
| `chatd_presence_updated` | trạng thái một user đổi |
| `chatd_user_room_message_created` | có tin nhắn chat mới |
| `call_log_user_created` | có bản ghi lịch sử cuộc gọi mới |
| `user_voicemail_message_created` | có voicemail mới |
| `users_services_dnd_updated` · `users_forwards_*_updated` | đổi DND / chuyển tiếp |

Server tự ngắt kết nối nếu token hết hạn: app phải gia hạn token và gửi `op: token`, hoặc kết nối lại.

---

## 7. Webapp

Dùng **@wazo/sdk** (đã test với `0.49.11`). Mã mẫu đầy đủ: thư mục `webapp/` (Vue 3), file `src/wazo.js`.

```js
import Wazo from '@wazo/sdk';

Wazo.Auth.init('my-webapp');                  // client_id tuỳ ý
Wazo.Auth.setHost('192.168.1.50:9443');       // không có https://
const session = await Wazo.Auth.logIn('alice', 'Test@123');
// session.token, session.uuid, session.refreshToken

await Wazo.Phone.connect({ audio: true, video: false });  // REGISTER qua WSS

// Gắn handler SAU connect()
Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => { /* hiện màn hình cuộc gọi đến */ });
Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => { /* đang nói */ });
Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED,    (callSession) => { /* kết thúc */ });

const call = await Wazo.Phone.call('1002');
await Wazo.Phone.accept(callSession);   // nghe
await Wazo.Phone.reject(callSession);   // từ chối
await Wazo.Phone.hangup(call);          // cúp
Wazo.Phone.mute(call); Wazo.Phone.hold(call); Wazo.Phone.transfer(call, '1003');

// Gọi REST API bất kỳ với token của SDK
const res = await fetch('https://192.168.1.50:9443/api/call-logd/1.0/users/me/cdr?limit=20', {
  headers: { 'X-Auth-Token': Wazo.Auth.getSession().token },
});
```

Lưu ý:

- Webapp phải chạy trên **HTTPS** (hoặc `localhost`) thì mới được dùng micro.
- Nên host webapp trong LAN. Server đã phục vụ sẵn webapp mẫu tại `https://<HOST>/phone/`
  (thư mục `webapp-dist/` trên server); build webapp mới với `base` tương ứng rồi chép vào đó là xong.
- Chrome chặn trang từ origin internet gọi vào IP LAN (Local Network Access), nên đừng host webapp ở ngoài internet.

---

## 8. App Android

### 8.1 Chọn hướng làm

| Hướng | Ưu | Nhược |
|---|---|---|
| **A. React Native + @wazo/sdk + react-native-webrtc** | dùng lại logic của webapp, cùng SDK chính thức | cần tích hợp native cho cuộc gọi chạy nền |
| **B. WebView / Capacitor bọc webapp** | nhanh nhất, gần như không code mới | chạy nền và nhận cuộc gọi khi tắt màn hình rất khó |
| **C. Native Kotlin**: REST (Retrofit/OkHttp) + thư viện WebRTC/SIP | kiểm soát tốt nhất (ConnectionService, chạy nền) | nhiều việc nhất. Thư viện SIP phải hỗ trợ **SIP over WSS + WebRTC** (DTLS-SRTP, ICE) để dùng line `webrtc`; nếu dùng SIP thường (UDP 5060) thì phải mở thêm cổng 5060 trên server và tạo line kiểu SIP |

Gợi ý: làm thử **A** trước. Phần REST và websocket (mục 2–6) giống nhau cho mọi hướng.

### 8.2 Nhận cuộc gọi khi app ở nền

Mạng offline nên **không dùng được push (FCM)**. App phải tự giữ kết nối:

- Chạy **Foreground Service** (thông báo cố định) giữ SIP REGISTER qua WSS + websocket sự kiện.
- Xin bỏ qua tối ưu pin (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), dùng `WakeLock` khi đang gọi.
- Tích hợp `ConnectionService` / `TelecomManager` để hiện màn hình cuộc gọi đến như cuộc gọi thường.
- Quyền cần: `RECORD_AUDIO`, `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL`
  (Android 14+), `POST_NOTIFICATIONS` (Android 13+), `MANAGE_OWN_CALLS` (nếu dùng ConnectionService).

### 8.3 Tin chứng chỉ của server

Android mặc định **không** tin CA do người dùng cài. Chọn một cách:

**Cách 1 – nhúng CA vào app** (khuyến nghị): chép `wazo-ca.crt` vào `res/raw/wazo_ca.crt`, rồi

`res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="@raw/wazo_ca" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

**Cách 2 – tin CA người dùng cài**: thay `@raw/wazo_ca` bằng `<certificates src="user" />`
và cài `wazo-ca.crt` trên máy (Cài đặt → Bảo mật → Cài chứng chỉ → Chứng chỉ CA).

`AndroidManifest.xml`: `<application android:networkSecurityConfig="@xml/network_security_config" ...>`

Cấu hình này áp dụng cho OkHttp, WebView và WebSocket của hệ thống. Thư viện WebRTC/SIP có bộ TLS
riêng thì phải cấu hình CA riêng cho nó.

### 8.4 Lưu ý khác

- Lưu `refresh_token` trong **EncryptedSharedPreferences**, không lưu mật khẩu.
- Xử lý audio: `AudioManager.MODE_IN_COMMUNICATION`, chuyển loa ngoài/tai nghe/Bluetooth,
  tắt màn hình khi áp tai (proximity sensor).
- Khi đổi mạng (Wi-Fi ↔ 4G nội bộ): đăng ký SIP lại và kết nối lại websocket.

---

## 9. Chứng chỉ (bắt buộc cho mọi client)

Server dùng chứng chỉ do **CA nội bộ** ký. WebSocket (WSS) **không cho bỏ qua** lỗi chứng chỉ,
nên mọi client phải tin `wazo-ca.crt` (tải `https://<HOST>/wazo-ca.crt` hoặc xin admin).

- Windows: Install Certificate → *Trusted Root Certification Authorities*.
- macOS: Keychain Access → System → *Always Trust*. Firefox: kho riêng (Settings → Certificates → Import).
- Android: mục 8.3. Node.js (script/test): `NODE_EXTRA_CA_CERTS=wazo-ca.crt`.
  curl: `--cacert wazo-ca.crt`. Python requests: `verify="wazo-ca.crt"`.

Truy cập server bằng đúng IP/hostname có trong chứng chỉ (IP trong `WAZO_LAN_IP`).

---

## 10. API quản trị (cho backend / công cụ admin)

Dùng token của tài khoản admin (`root` hoặc user admin riêng), có thể cần header `Wazo-Tenant`.

| Việc | Request |
|---|---|
| Danh sách user | `GET /api/confd/1.1/users?recurse=true&search=...` |
| Context (lấy tên context nội bộ) | `GET /api/confd/1.1/contexts` |
| Tạo user + line WebRTC + máy lẻ (1 lần gọi) | `POST /api/confd/1.1/users` (xem ví dụ dưới) |
| Xoá user | `DELETE /api/confd/1.1/users/{uuid}` |
| Import CSV | `POST /api/confd/1.1/users/import` |
| Export CSV | `GET /api/confd/1.1/users/export` |
| Lịch sử cuộc gọi toàn hệ thống | `GET /api/call-logd/1.0/cdr` |
| Cuộc gọi đang diễn ra | `GET /api/calld/1.0/calls` |

Ví dụ tạo user có line WebRTC (cần truyền `auth_section_options` để có SIP username/password,
xem script `wazo-provision-test` trong image):

```json
POST /api/confd/1.1/users
{
  "firstname": "Dave", "lastname": "Nguyen",
  "auth": { "username": "dave", "password": "Doi@MatKhau1" },
  "lines": [{
    "context": "<context_noi_bo>",
    "extensions": [{ "exten": "1004", "context": "<context_noi_bo>" }],
    "endpoint_sip": {
      "templates": [{ "label": "webrtc" }],
      "auth_section_options": [["username", "dave1004"], ["password", "<sip_secret_ngau_nhien>"]]
    }
  }]
}
```
*(cấu trúc body chính xác: kiểm tra spec confd, schema `UserCreate`)*

### Import user hàng loạt bằng CSV

Qua giao diện wazo-ui hoặc API:

```bash
curl --cacert wazo-ca.crt -u root:<mat_khau_root> \
  -H 'Content-Type: text/csv; charset=utf-8' -H 'Wazo-Tenant: <tenant_uuid>' \
  --data-binary @users.csv https://<HOST>/api/confd/1.1/users/import
```

`users.csv` (UTF-8, dấu phẩy, dòng đầu là tên cột):

```csv
firstname,lastname,email,username,password,exten,context,line_protocol
Dave,Nguyen,dave@company.local,dave,Doi@MatKhau1,1004,<context_noi_bo>,webrtc
Eva,Tran,eva@company.local,eva,Doi@MatKhau2,1005,<context_noi_bo>,webrtc
```

- Bắt buộc: `firstname`; để có máy lẻ thì cần đủ `exten` + `context` + `line_protocol`
  (`webrtc` cho web/app, `sip` cho điện thoại IP).
- Cột khác có thể dùng: `mobile_phone_number`, `language`, `outgoing_caller_id`, `enabled`,
  `ring_seconds`, `simultaneous_calls`, `sip_username`, `sip_secret`, `userfield`, voicemail...
- Lấy file mẫu đúng định dạng: `GET /api/confd/1.1/users/export`.
- **Thử import 1–2 user trước**, kiểm tra đăng nhập và gọi được, rồi mới import toàn bộ.

Tài liệu cột CSV: https://wazo-platform.org/uc-doc/administration/users/csv_import

---

## 11. Lỗi thường gặp

| Lỗi | Nguyên nhân / cách xử lý |
|---|---|
| `401 Unauthorized` | token hết hạn/sai → gia hạn bằng refresh token |
| `403` / `401` khi token còn hạn | user không có quyền gọi API đó (API admin), hoặc gọi `/users/{uuid}` của người khác |
| `SSL handshake` / `certificate verify failed` / WSS đóng ngay | client chưa tin `wazo-ca.crt` hoặc truy cập bằng IP/hostname không có trong chứng chỉ |
| REGISTER SIP lỗi 401/403 | dùng nhầm mật khẩu đăng nhập thay vì SIP secret của line; hoặc line không phải `webrtc` |
| Gọi được nhưng không nghe tiếng | dải UDP RTP bị firewall chặn; ICE thất bại (xem `chrome://webrtc-internals`) |
| Không xin được micro trên web | trang không chạy HTTPS |
| Không nhận cuộc gọi khi app Android ở nền | service bị hệ thống dừng: dùng Foreground Service + bỏ tối ưu pin (mục 8.2) |
| Webapp ở origin internet không kết nối được | Chrome Local Network Access chặn → host webapp trong LAN |

Debug phía server (admin):

```bash
docker exec wazo tail -f /var/log/asterisk/full          # SIP / cuộc gọi
docker exec wazo tail -f /var/log/nginx/wazo.error.log   # HTTP / WSS
docker exec wazo tail -f /var/log/wazo-auth.log           # đăng nhập (tên file: ls /var/log | grep wazo)
docker exec -it wazo asterisk -rvvv                       # pjsip show endpoints / pjsip set logger on
```