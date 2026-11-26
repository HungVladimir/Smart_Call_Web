"""Danh bạ phân trang dùng nguồn Dird đã được Wazo cấp quyền."""
import asyncio
import hashlib
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import HTTPException

SNAPSHOT_TTL = 120
MANUAL_REFRESH_INTERVAL = 30
PRESENCE_TTL = 15
SNAPSHOT_LIMIT = 32
UUID_QUERY_BUDGET = 2800


@dataclass
class DirectorySnapshot:
    rows: list
    fetched_at: str
    loaded_at: float
    notice: str = ""


# Chia UUID theo cả số lượng và độ dài truy vấn đã mã hóa để qua được proxy.
def uuid_batches(ids, parameter, limit=60):
    batch = []
    for identifier in ids:
        encoded = urlencode({parameter: ",".join([*batch, identifier])})
        if batch and (len(batch) >= limit or len(encoded) > UUID_QUERY_BUDGET):
            yield batch
            batch = []
        batch.append(identifier)
    if batch:
        yield batch


# Chuẩn hóa tên tìm kiếm tiếng Việt, email và description bằng cùng quy tắc.
def normalize(value):
    text = " ".join(str(value or "").casefold().split()).replace("đ", "d")
    return "".join(char for char in unicodedata.normalize("NFD", text)
                   if unicodedata.category(char) != "Mn")


# Chọn nhãn bộ phận có nội dung, ưu tiên description từ Wazo.
def department_name(row):
    if row.get("department_state") == "empty":
        return ""
    for key in ("description", "department", "society", "title"):
        value = " ".join(str(row.get(key) or "").split())
        if value:
            return value
    return ""


# Chỉ công bố trường danh bạ và lấy số từ cấu trúc Dird/Confd đã biết.
def published_row(contact, user_uuid):
    number = next((contact.get(key) for key in ("exten", "extension", "number", "callable", "phone_number")
                   if contact.get(key)), "")
    numbers = contact.get("numbers") or []
    if not number and numbers:
        number = numbers[0]
        if isinstance(number, dict):
            number = number.get("number") or number.get("exten") or ""
    lines = contact.get("lines") or []
    if not number and lines:
        extensions = lines[0].get("extensions") or []
        number = extensions[0].get("exten", "") if extensions else ""
    keys = ("id", "firstname", "lastname", "name", "display_name", "displayName",
            "description", "department", "society", "title", "email", "employee_id", "epId", "source")
    published = {key: contact[key] for key in keys if isinstance(contact.get(key), (str, int))}
    addresses = contact.get("emails") or []
    if not published.get("email") and addresses and isinstance(addresses[0], dict):
        published["email"] = addresses[0].get("email") or addresses[0].get("address") or ""
    return dict(published, uuid=user_uuid, number=str(number))


# Xếp kết quả chính xác trước, dùng UUID để ổn định thứ tự giữa các trang.
def search_page(rows, term, department, presence, states, offset, limit, owner):
    term = normalize(term).removesuffix("@samsung.com")
    selected = []
    for row in rows:
        if row.get("uuid") == owner:
            continue
        if department == "__unassigned__":
            if department_name(row) or row.get("department_state") == "unknown":
                continue
        elif department and normalize(department_name(row)) != normalize(department):
            continue
        if presence and states.get(row.get("uuid")) != presence:
            continue
        name = normalize(row.get("name") or row.get("display_name") or
                         " ".join(str(row.get(key) or "") for key in ("firstname", "lastname")))
        email = normalize(row.get("email") or ((row.get("emails") or [{}])[0]).get("email"))
        fields = (name, normalize(row.get("number") or row.get("extension") or row.get("exten")),
                  email, normalize(row.get("employee_id") or row.get("epId")),
                  normalize(department_name(row)))
        if term and not any(term in field for field in fields):
            continue
        selected.append((0 if term in fields else 1, name, str(row.get("uuid") or ""), row))
    selected.sort(key=directory_order)
    total = len(selected)
    offset = min(offset, max(0, (total - 1) // limit) * limit)
    return {"items": [item[3] for item in selected[offset:offset + limit]],
            "total": total, "offset": offset}


# Chỉ dùng kiểu so sánh được và không phụ thuộc nội dung từ điển.
def directory_order(item):
    return item[:3]


# Presence thiếu chứng cứ phải là unknown để không lọt vào bộ lọc ngoại tuyến.
def presence_state(record):
    line_states = {"available", "unavailable", "talking", "holding", "ringing", "progressing"}
    lines = [line.get("state") for line in record.get("lines") or []
             if isinstance(line, dict) and line.get("state") in line_states]
    state = record.get("state")
    if state in ("unavailable", "offline"):
        return "offline"
    if state == "invisible":
        return "unknown"
    if not lines and record.get("line_state") in line_states:
        lines = [record["line_state"]]
    if lines:
        return "online" if any(value != "unavailable" for value in lines) else "offline"
    if state in ("available", "online", "away") or record.get("connected") is True:
        return "online"
    if record.get("connected") is False:
        return "offline"
    return "unknown"


class Directory:
    # Mỗi snapshot thuộc token đã xác thực và source, kể cả dữ liệu làm giàu.
    def __init__(self, wazo):
        self.wazo = wazo
        self.samples = OrderedDict()
        self.presence = OrderedDict()
        self.refresh_after = OrderedDict()
        self.identities = {}
        self.locks = [asyncio.Lock() for _ in range(8)]

    # Giới hạn bộ nhớ theo worker và tránh giữ lock riêng cho từng token đã hết phiên.
    def remember(self, cache, scope, value):
        cache[scope] = value
        cache.move_to_end(scope)
        if len(cache) > SNAPSHOT_LIMIT:
            cache.popitem(last=False)

    # Gom các lượt dựng lại của cùng phạm vi và giới hạn số lượt đồng thời vào Wazo.
    def lock_for(self, scope):
        return self.locks[hash(scope) % len(self.locks)]

    # Xác minh token bằng Auth của cùng Wazo host. Không nhận tenant hoặc actor từ trình duyệt.
    async def actor(self, token, *, fresh=False):
        try:
            token = str(UUID(token or ""))
        except ValueError:
            raise HTTPException(401, "Cần token Wazo hợp lệ.") from None
        key = hashlib.sha256(token.encode()).hexdigest()
        # Confd có thể từ chối quyền riêng hoặc token vừa hết hạn, nên lần kiểm tra đó phải hỏi Auth thật.
        if fresh:
            self.identities.pop(key, None)
        cached = self.identities.get(key)
        if cached and cached[0] > monotonic():
            return cached[1], token, key
        if len(self.identities) >= 4096:
            self.identities.clear()
        result = await self.wazo.client.get(
            self.wazo.settings.wazo_url + "/api/auth/0.1/token/" + token,
            headers={"X-Auth-Token": token},
        )
        if not result.is_success:
            raise HTTPException(401 if result.status_code in (401, 403, 404) else 502, "Không xác minh được phiên Wazo.")
        data = result.json().get("data", {})
        meta = data.get("metadata") or {}
        user = meta.get("pbx_user_uuid")
        if not user or (meta.get("tenant_uuid") or data.get("tenant_uuid")) != self.wazo.settings.wazo_tenant_uuid:
            raise HTTPException(403, "Tài khoản không thuộc tenant Wazo được cấu hình.")
        self.identities[key] = (monotonic() + 15, user)
        return user, token, key

    # Gọi API bằng token người dùng và nêu rõ bước lỗi mà không trả URL, token hay payload upstream.
    async def read(self, path, token, *, operation, **params):
        headers = {"X-Auth-Token": token}
        # Với Dird, dùng tenant gốc của token như Web gọi trực tiếp. actor đã đối chiếu tenant này.
        if not path.startswith("/api/dird/"):
            headers["Wazo-Tenant"] = self.wazo.settings.wazo_tenant_uuid
        try:
            response = await self.wazo.client.get(
                self.wazo.settings.wazo_url + path, params=params, headers=headers)
        except httpx.RequestError:
            raise HTTPException(502, f"Chưa kết nối được {operation}.") from None
        if not response.is_success:
            status = response.status_code if response.status_code in (401, 403) else 502
            raise HTTPException(status, f"{operation} trả HTTP {response.status_code}.")
        try:
            data = response.json()
        except ValueError:
            raise HTTPException(502, f"{operation} trả dữ liệu không hợp lệ.") from None
        if not isinstance(data, dict):
            raise HTTPException(502, f"{operation} trả dữ liệu không hợp lệ.")
        return data

    # Đọc lại profile trên mỗi lượt để quyền nguồn bị thu hồi không dùng lại snapshot.
    async def contacts(self, source, token, key, refresh=False):
        path = f"/api/dird/0.1/backends/wazo/sources/{source}/contacts"
        scope = (key, source)
        try:
            sources = await self.read("/api/dird/0.1/directories/default/sources", token,
                                      operation="Wazo Dird (danh sách nguồn)", backend="wazo")
            if not any(str(item.get("uuid")) == source for item in sources.get("items", [])):
                raise HTTPException(403, "Nguồn danh bạ không thuộc profile Wazo.")
            # Profile có source vẫn cần quyền thực đọc endpoint danh bạ.
            await self.read(path, token, operation="Wazo Dird (liên hệ)", limit=1, offset=0)
        except HTTPException:
            self.samples.pop(scope, None)
            self.presence.pop(scope, None)
            raise
        async with self.lock_for(scope):
            cached = self.samples.get(scope)
            now = monotonic()
            valid = cached and now - cached.loaded_at < SNAPSHOT_TTL
            if valid and not refresh:
                return cached, "cached"
            if refresh and valid and now < self.refresh_after.get(scope, 0):
                return cached, "cooldown"
            if refresh:
                self.remember(self.refresh_after, scope, now + MANUAL_REFRESH_INTERVAL)
            try:
                rows = await self.load_rows(path, token)
                notice = await self.describe(token, rows)
            except HTTPException as error:
                if error.status_code in (401, 403):
                    self.samples.pop(scope, None)
                    self.presence.pop(scope, None)
                elif valid:
                    return cached, "failed"
                raise
            snapshot = DirectorySnapshot(rows, datetime.now(timezone.utc).isoformat(), monotonic(), notice)
            self.remember(self.samples, scope, snapshot)
            if refresh:
                self.remember(self.refresh_after, scope, snapshot.loaded_at + MANUAL_REFRESH_INTERVAL)
            return snapshot, "updated"

    # Thu đủ các trang Dird theo quyền của phiên trước khi tìm kiếm và lọc.
    async def load_rows(self, path, token):
        rows, seen = [], set()
        for offset in range(0, 10000, 100):
            data = await self.read(path, token, operation="Wazo Dird (liên hệ)", limit=100, offset=offset)
            page = data.get("items")
            if not isinstance(page, list) or len(page) > 100:
                raise HTTPException(502, "Nguồn Dird không trả trang hợp lệ.")
            if offset and page and all((item.get("uuid") or item.get("user_uuid")) in seen for item in page):
                raise HTTPException(502, "Wazo lặp trang danh bạ.")
            for contact in page:
                uuid = contact.get("uuid") or contact.get("user_uuid")
                if not uuid or uuid in seen:
                    continue
                seen.add(uuid)
                rows.append(published_row(contact, uuid))
            total = data.get("filtered", data.get("total"))
            if len(page) < 100 or isinstance(total, int) and offset + len(page) >= total:
                labels = await self.wazo.store.employee_ids(self.wazo.settings.wazo_tenant_uuid)
                for row in rows:
                    if row["uuid"] in labels and not (row.get("employee_id") or row.get("epId")):
                        row["employee_id"] = labels[row["uuid"]]
                return rows
        raise HTTPException(503, "Nguồn danh bạ vượt giới hạn 10.000 liên hệ.")

    # Phân biệt description rỗng được Confd xác nhận với thiếu quyền hoặc thiếu dữ liệu.
    async def describe(self, token, rows):
        missing = {}
        for row in rows:
            if str(row.get("description") or "").strip():
                row["department_state"] = "confirmed"
            else:
                row["department_state"] = "unknown"
                missing[row["uuid"]] = row
        notice = ""
        path = "/api/confd/1.1/users"
        for batch in uuid_batches(missing, "uuid"):
            try:
                data = await self.read(path, token, operation="Wazo Confd (bộ phận)",
                                       view="directory", uuid=",".join(batch), limit=len(batch), recurse="false")
                if not isinstance(data.get("items"), list):
                    raise HTTPException(502, "Nguồn Confd không trả danh sách bộ phận.")
            except HTTPException as error:
                if error.status_code == 401:
                    await self.actor(token, fresh=True)
                # Chỉ thiếu phần bổ sung khi token còn hiệu lực nhưng Confd từ chối.
                if error.status_code in (401, 403):
                    return "Tài khoản chưa có quyền đọc đầy đủ bộ phận từ Wazo."
                notice = "Chưa cập nhật được một phần bộ phận từ Wazo."
                continue
            for item in data["items"]:
                uuid = item.get("uuid")
                if uuid not in batch or "description" not in item:
                    continue
                description = str(item.get("description") or "").strip()
                missing[uuid]["description"] = description
                missing[uuid]["department_state"] = "confirmed" if description else "empty"
        if not notice and any(row["department_state"] == "unknown" for row in missing.values()):
            return "Wazo chưa trả đủ dữ liệu bộ phận."
        return notice

    # Chỉ lấy trạng thái của UUID thuộc snapshot đã cấp quyền cho chính token này.
    async def status(self, source, user, token, key, snapshot):
        path = "/api/chatd/1.0/users/presences"
        scope = (key, source)
        try:
            await self.read(path, token, operation="Wazo Chatd (trạng thái)", user_uuid=user)
        except HTTPException:
            self.presence.pop(scope, None)
            raise
        async with self.lock_for(scope):
            cached = self.presence.get(scope)
            if cached and cached[0] > monotonic() and cached[1] is snapshot:
                return cached[2]
            ids = [row["uuid"] for row in snapshot.rows]
            states = {}
            for batch in uuid_batches(ids, "user_uuid"):
                data = await self.read(path, token, operation="Wazo Chatd (trạng thái)", user_uuid=",".join(batch))
                items = data.get("items")
                if isinstance(items, dict):
                    items = [dict(record, uuid=uuid) for uuid, record in items.items()
                             if isinstance(record, dict)]
                if not isinstance(items, list):
                    raise HTTPException(502, "Nguồn presence không trả trạng thái hợp lệ.")
                for record in items:
                    if not isinstance(record, dict):
                        continue
                    uuid = record.get("uuid") or record.get("user_uuid")
                    if uuid in batch:
                        states[uuid] = presence_state(record)
            self.remember(self.presence, scope, (monotonic() + PRESENCE_TTL, snapshot, states))
            return states
