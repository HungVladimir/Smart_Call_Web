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
DIRECTORY_SEARCH_LIMIT = 50


@dataclass
class DirectorySnapshot:
    rows: list
    fetched_at: str
    loaded_at: float
    notice: str = ""
    source: str = ""


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
    number = next((contact.get(key) for key in ("exten", "extension", "number", "callable", "number_office", "phone_number")
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


# Chuẩn hóa trường công khai để Web và App dùng cùng dữ liệu danh bạ.
def public_contact(row):
    return dict(
        row,
        name=contact_name(row),
        number=str(row.get("number") or row.get("extension") or row.get("exten") or ""),
        email=row.get("email") or "",
        employee_id=str(row.get("employee_id") or row.get("epId") or ""),
        department=department_name(row),
        department_state=row.get("department_state", "unknown"),
    )


# Dựng tên hiển thị từ các dạng dữ liệu mà Dird có thể trả.
def contact_name(row):
    return str(row.get("name") or row.get("display_name") or row.get("displayName") or
               " ".join(str(row.get(key) or "") for key in ("firstname", "lastname"))).strip()


# Ưu tiên máy lẻ và email khớp nguyên giá trị trước các chuỗi chỉ chứa từ khóa.
def search_rank(row, name, department, term):
    if not term:
        return 0
    extension = normalize(row.get("number") or row.get("extension") or row.get("exten"))
    email = normalize(row.get("email"))
    employee_id = search_field(row, "employee_id")
    email_username = email.partition("@")[0]
    fields = (name, extension, email, employee_id, department)
    if term == extension or term == email:
        return 0
    if term in (name, employee_id, department, email_username):
        return 1
    if any(term in field for field in fields):
        return 2
    return None


# Lọc theo từ khóa chung và các bộ lọc, rồi sắp ổn định trước khi cắt trang.
def search_page(rows, term, department, presence, states, offset, limit, owner):
    term = normalize(term)
    department_filter = normalize(department)
    selected = []
    for row in rows:
        if row.get("uuid") == owner:
            continue
        department_label = normalize(department_name(row))
        if department == "__unassigned__":
            if department_label or row.get("department_state") == "unknown":
                continue
        elif department_filter and department_label != department_filter:
            continue
        if presence and states.get(row.get("uuid")) != presence:
            continue
        name = search_field(row, "name")
        rank = search_rank(row, name, department_label, term)
        if rank is not None:
            selected.append((rank, name, str(row.get("uuid") or ""), row))
    selected.sort(key=directory_order)
    total = len(selected)
    offset = min(offset, max(0, (total - 1) // limit) * limit)
    return {"items": [public_contact(item[3]) for item in selected[offset:offset + limit]],
            "total": total, "offset": offset}

# Chỉ dùng kiểu so sánh được và không phụ thuộc nội dung từ điển.
def directory_order(item):
    return item[:3]


# Trả danh sách cho một truy vấn có phạm vi, không cho tải toàn bộ nguồn từ giao diện tìm kiếm.
def search_contacts(rows, field, term, department, owner):
    term = normalize(term)
    if field == "email":
        term = term.removesuffix("@samsung.com")
    if field != "department" and not term:
        return {"items": [], "limited": False}
    if field == "department" and department == "__unassigned__":
        rows = [row for row in rows if row.get("department_state") == "empty"]
    elif field == "department":
        rows = [row for row in rows if normalize(department_name(row)) == normalize(department)]
    elif field == "extension":
        rows = [row for row in rows if normalize(row.get("number")) == term]
    elif term:
        key = {"employee_id": "employee_id", "email": "email", "name": "name"}[field]
        rows = [row for row in rows if term in search_field(row, key)]
    limit = max(1, len(rows)) if field == "department" else DIRECTORY_SEARCH_LIMIT
    result = search_page(rows, "", "", "", {}, 0, limit, owner)
    return {"items": result["items"], "limited": result["total"] > limit}


# Chuẩn hóa đúng trường đã chọn, giữ số 0 đầu mã nhân viên.
def search_field(row, field):
    if field == "name":
        return normalize(contact_name(row))
    if field == "employee_id":
        return normalize(row.get("employee_id") or row.get("epId"))
    return normalize(row.get(field))


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

    # Chọn nguồn mặc định theo thứ tự Dird hoặc đối chiếu nguồn do client yêu cầu.
    def select_source(self, sources, requested):
        items = sources.get("items")
        if not isinstance(items, list):
            raise HTTPException(502, "Wazo Dird không trả danh sách nguồn hợp lệ.")
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                source_id = str(UUID(str(item.get("uuid"))))
            except ValueError:
                continue
            if requested is None or source_id == requested:
                return source_id
        raise HTTPException(403, "Không có nguồn danh bạ phù hợp trong profile Wazo.")

    # Đọc lại profile trên mỗi lượt để quyền nguồn bị thu hồi không dùng lại snapshot.
    async def contacts(self, source, token, key, refresh=False):
        scope = (key, source)
        try:
            sources = await self.read("/api/dird/0.1/directories/default/sources", token,
                                      operation="Wazo Dird (danh sách nguồn)", backend="wazo")
            source = self.select_source(sources, source)
            path = f"/api/dird/0.1/backends/wazo/sources/{source}/contacts"
            scope = (key, source)
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
            snapshot = DirectorySnapshot(rows, datetime.now(timezone.utc).isoformat(), monotonic(), notice, source)
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
