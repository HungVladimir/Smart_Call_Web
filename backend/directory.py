"""Danh bạ phân trang dùng nguồn Dird đã được Wazo cấp quyền."""
import asyncio
import hashlib
import unicodedata
from time import monotonic
from uuid import UUID

from fastapi import HTTPException


# Chuẩn hóa tên tìm kiếm tiếng Việt, email và description bằng cùng quy tắc.
def normalize(value):
    text = " ".join(str(value or "").casefold().split()).replace("đ", "d")
    return "".join(char for char in unicodedata.normalize("NFD", text)
                   if unicodedata.category(char) != "Mn")


# Chọn nhãn bộ phận có nội dung, ưu tiên description từ Wazo.
def department_name(row):
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
            if department_name(row):
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
    return {"items": [item[3] for item in selected[offset:offset + limit]], "total": len(selected)}


# Chỉ dùng kiểu so sánh được và không phụ thuộc nội dung từ điển.
def directory_order(item):
    return item[:3]


# Presence thiếu chứng cứ phải là unknown để không lọt vào bộ lọc ngoại tuyến.
def presence_state(record):
    lines = [line.get("state") for line in record.get("lines", []) if line.get("state")]
    state = record.get("state")
    if state in ("unavailable", "offline"):
        return "offline"
    if state == "invisible":
        return "unknown"
    if lines:
        return "online" if any(value != "unavailable" for value in lines) else "offline"
    if state in ("available", "online", "away") or record.get("connected") is True:
        return "online"
    if record.get("connected") is False:
        return "offline"
    return "unknown"


class Directory:
    # Cache nằm trong worker, tách theo nguồn đã xác thực trong tenant cấu hình.
    def __init__(self, wazo):
        self.wazo = wazo
        self.samples = {}
        self.presence = {}
        self.scopes = {}
        self.identities = {}
        self.locks = {}

    # Xác minh token bằng Auth của cùng Wazo host. Không nhận tenant hoặc actor từ trình duyệt.
    async def actor(self, token):
        try:
            token = str(UUID(token or ""))
        except ValueError:
            raise HTTPException(401, "Cần token Wazo hợp lệ.") from None
        key = hashlib.sha256(token.encode()).hexdigest()
        cached = self.identities.get(key)
        if cached and cached[0] > monotonic():
            return cached[1], token, key
        if len(self.identities) >= 4096:
            self.identities.clear()
            self.scopes.clear()
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

    # Gọi API bằng quyền người dùng ở tenant đã xác minh và phân biệt lỗi với kết quả rỗng.
    async def read(self, path, token, **params):
        response = await self.wazo.client.get(self.wazo.settings.wazo_url + path, params=params,
            headers={"X-Auth-Token": token, "Wazo-Tenant": self.wazo.settings.wazo_tenant_uuid})
        if not response.is_success:
            raise HTTPException(403 if response.status_code == 403 else 502, f"Nguồn Wazo trả HTTP {response.status_code}.")
        return response.json()

    # Chỉ chia sẻ nguồn Wazo công bố qua profile và tài khoản có quyền đọc chính nguồn đó.
    async def contacts(self, source, token, key):
        path = f"/api/dird/0.1/backends/wazo/sources/{source}/contacts"
        scope = (key, source)
        if self.scopes.get(scope, 0) <= monotonic():
            sources = await self.read("/api/dird/0.1/directories/default/sources", token, backend="wazo")
            if not any(str(item.get("uuid")) == source for item in sources.get("items", [])):
                raise HTTPException(403, "Nguồn danh bạ không thuộc profile Wazo.")
            await self.read(path, token, limit=1, offset=0)
            self.scopes[scope] = monotonic() + 30
        lock = self.locks.setdefault(("directory", source), asyncio.Lock())
        async with lock:
            cached = self.samples.get(source)
            if cached and cached[0] > monotonic():
                return await self.describe(source, token, key, cached[1])
            rows, seen = [], set()
            for offset in range(0, 10000, 100):
                data = await self.read(path, token, limit=100, offset=offset)
                page = data.get("items")
                if not isinstance(page, list) or len(page) > 100:
                    raise HTTPException(502, "Nguồn Dird không trả trang hợp lệ.")
                if offset and page and all((item.get('uuid') or item.get('user_uuid')) in seen for item in page):
                    raise HTTPException(502, 'Wazo lặp trang danh bạ.')
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
                    self.samples[source] = (monotonic() + 120, rows)
                    return await self.describe(source, token, key, rows)
            raise HTTPException(503, "Nguồn danh bạ vượt giới hạn 10.000 liên hệ.")

    # Bổ sung description trước khi lọc, bằng view directory khi Wazo cấp quyền.
    async def describe(self, source, token, key, rows):
        missing = [row["uuid"] for row in rows if not str(row.get("description") or "").strip()]
        if not missing:
            return rows
        path = "/api/confd/1.1/users"
        scope = (key, "description")
        checked = self.scopes.get(scope)
        if not checked or checked[0] <= monotonic():
            try:
                await self.read(path, token, view="directory", limit=1, recurse="false")
                checked = (monotonic() + 120, True)
            except HTTPException as error:
                if error.status_code != 403:
                    raise
                checked = (monotonic() + 120, False)
            self.scopes[scope] = checked
        if not checked[1]:
            return rows
        cache_key = (source, "description")
        cached = self.samples.get(cache_key)
        if cached and cached[1] is rows:
            return cached[2]
        descriptions = {}
        for offset in range(0, len(missing), 100):
            batch = missing[offset:offset + 100]
            data = await self.read(path, token, view="directory", uuid=",".join(batch),
                                   limit=len(batch), recurse="false")
            for item in data.get("items", []):
                uuid = item.get("uuid")
                description = str(item.get("description") or "").strip()
                if uuid in batch and description:
                    descriptions[uuid] = description
        enriched = [dict(row, description=descriptions[row["uuid"]]) if row["uuid"] in descriptions else row
                    for row in rows]
        self.samples[cache_key] = (monotonic() + 120, rows, enriched)
        return enriched

    # Đọc trạng thái chỉ khi lọc online/offline. Cache chung tránh mỗi phiên quét hết danh bạ.
    async def status(self, source, user, token, rows):
        path = "/api/chatd/1.0/users/presences"
        scope = (hashlib.sha256(token.encode()).hexdigest(), 'presence')
        if self.scopes.get(scope, 0) <= monotonic():
            await self.read(path, token, user_uuid=user)
            self.scopes[scope] = monotonic() + 30
        lock = self.locks.setdefault(("presence", source), asyncio.Lock())
        async with lock:
            cached = self.presence.get(source)
            if cached and cached[0] > monotonic():
                return cached[1]
            ids = [row["uuid"] for row in rows]
            states = {}
            for start in range(0, len(ids), 120):
                data = await self.read(path, token, user_uuid=",".join(ids[start:start + 120]))
                items = data.get("items")
                if isinstance(items, dict):
                    items = [dict(record, uuid=uuid) for uuid, record in items.items()]
                if not isinstance(items, list):
                    raise HTTPException(502, "Nguồn presence không trả trạng thái hợp lệ.")
                for record in items:
                    states[record.get("uuid") or record.get("user_uuid")] = presence_state(record)
            self.presence[source] = (monotonic() + 15, states)
            return states
