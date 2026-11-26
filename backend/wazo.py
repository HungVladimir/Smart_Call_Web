"""Cấp tài khoản WebRTC qua Confd; chỉ trả token của user, tuyệt đối không trả token quản trị."""
from contextlib import asynccontextmanager
import hashlib
import re
import secrets
from urllib.parse import unquote
from fastapi import HTTPException
import httpx
from httpx import BasicAuth
from oidc import fail

WRAPPER_METHODS = frozenset({"GET", "POST", "PUT", "DELETE", "PATCH"})
WRAPPER_ALLOWED_PREFIXES = (
    "/api/confd/1.1/",
    "/api/dird/0.1/",
    "/api/chatd/1.0/",
    "/api/calld/1.0/",
    "/api/call-logd/1.0/",
)
WRAPPER_SENSITIVE_FIELDS = frozenset({
    "auth",
    "password",
    "secret",
    "auth_section_options",
    "userfield",
    "token",
    "refresh_token",
    "session_uuid",
})
WRAPPER_DESTRUCTIVE_CONF_RESOURCES = (
    "/api/confd/1.1/users",
    "/api/confd/1.1/contexts",
    "/api/confd/1.1/extensions",
)
WRAPPER_FORBIDDEN_CONF_ROOTS = (
    "/api/confd/1.1/tenants",
    "/api/confd/1.1/trunks",
    "/api/confd/1.1/registers",
    "/api/confd/1.1/wizard",
    "/api/confd/1.1/incalls",
    "/api/confd/1.1/outcalls",
)
WRAPPER_BLOCKED_FRAGMENTS = ("/password", "/tokens", "/sessions")


# Loại bỏ credential, mật khẩu SIP và liên kết nội bộ khỏi dữ liệu trả về qua wrapper.
def sanitize_wrapper_payload(value, *, tenant_uuid=None):
    if isinstance(value, list):
        sanitized = []
        for item in value:
            if isinstance(item, dict) and tenant_uuid and item.get("tenant_uuid") not in (None, tenant_uuid):
                continue
            sanitized.append(sanitize_wrapper_payload(item, tenant_uuid=tenant_uuid))
        return sanitized
    if isinstance(value, dict):
        result = {}
        for key, entry in value.items():
            if key in WRAPPER_SENSITIVE_FIELDS:
                continue
            item_tenant = tenant_uuid if key == "items" else None
            result[key] = sanitize_wrapper_payload(entry, tenant_uuid=item_tenant)
        return result
    return value


# Kiểm tra chặt method, tiền tố Wazo và chặn path traversal hoặc endpoint nhạy cảm trước khi gọi server.
def validate_wrapper_command(method, path, body=None):
    clean_method = str(method or "").strip().upper()
    if clean_method not in WRAPPER_METHODS:
        fail("WRAPPER_OPERATION_FORBIDDEN", "Phương thức HTTP chưa được phép qua wrapper.", 403)
    raw_path = str(path or "")
    unquoted = unquote(raw_path)
    double_unquoted = unquote(unquoted)
    for candidate in (raw_path, unquoted, double_unquoted):
        if (not candidate.startswith("/") or candidate.startswith("//") or "//" in candidate
                or "?" in candidate or "#" in candidate or "\\" in candidate or "://" in candidate
                or any(ord(ch) < 32 or ch.isspace() for ch in candidate)):
            fail("WRAPPER_OPERATION_FORBIDDEN", "Đường dẫn API không hợp lệ.", 403)
        segments = candidate.split("/")[1:]
        if any(segment in ("", ".", "..") for segment in segments):
            fail("WRAPPER_OPERATION_FORBIDDEN", "Đường dẫn API không hợp lệ.", 403)
    if not any(unquoted.startswith(prefix) for prefix in WRAPPER_ALLOWED_PREFIXES):
        fail("WRAPPER_OPERATION_FORBIDDEN", "Đường dẫn API Wazo chưa được phép qua wrapper.", 403)
    lower_path = unquoted.casefold()
    if "/endpoints/sip" in lower_path:
        is_template_read = (
            clean_method == "GET"
            and (lower_path == "/api/confd/1.1/endpoints/sip/templates"
                 or lower_path.startswith("/api/confd/1.1/endpoints/sip/templates/"))
        )
        if not is_template_read:
            fail("WRAPPER_OPERATION_FORBIDDEN", "Không được phép đọc/sửa cấu hình SIP qua wrapper.", 403)
    if any(fragment in lower_path for fragment in WRAPPER_BLOCKED_FRAGMENTS):
        fail("WRAPPER_OPERATION_FORBIDDEN", "Không được phép truy cập tài nguyên xác thực/mật khẩu qua wrapper.", 403)
    if any(lower_path == root or lower_path.startswith(root + "/") for root in WRAPPER_FORBIDDEN_CONF_ROOTS):
        fail("WRAPPER_OPERATION_FORBIDDEN", "Thao tác hạ tầng Wazo chưa được phép qua wrapper.", 403)
    if clean_method in ("PUT", "PATCH") and (
        lower_path == "/api/confd/1.1/users" or lower_path.startswith("/api/confd/1.1/users/")
    ) and isinstance(body, dict) and any(key in body for key in WRAPPER_SENSITIVE_FIELDS):
        fail("WRAPPER_OPERATION_FORBIDDEN", "Không được phép sửa credential hoặc userfield qua wrapper.", 403)
    if clean_method == "DELETE" and any(
        lower_path == resource or re.fullmatch(re.escape(resource) + r"/[^/]+", lower_path)
        for resource in WRAPPER_DESTRUCTIVE_CONF_RESOURCES
    ):
        fail("WRAPPER_OPERATION_FORBIDDEN", "Không được phép xóa user/context/extension qua wrapper.", 403)
    if clean_method in ("GET", "HEAD") and body is not None:
        fail("WRAPPER_INVALID_BODY", "Yêu cầu GET không nhận body JSON.", 422)
    return clean_method, unquoted


class WazoClient:
    """Tìm/liên kết/tạo user theo email đã xác minh, có khóa cấp phát theo tenant."""
    # Nhận HTTP client và store; không gọi máy chủ cho tới khi người dùng hoàn tất SSO.
    def __init__(self, settings, client, store):
        self.settings = settings
        self.client = client
        self.store = store

    # Áp dụng tenant/header cố định và chuyển lỗi thành thông báo không lộ secret.
    async def request(self, method, path, *, token=None, allow_not_found=False, **kwargs):
        headers = {"Accept": "application/json", "Wazo-Tenant": self.settings.wazo_tenant_uuid}
        if token:
            headers["X-Auth-Token"] = token
        response = await self.client.request(method, self.settings.wazo_url + path, headers=headers, **kwargs)
        if response.status_code == 404 and allow_not_found:
            return None
        # Username do email quyết định: để Wazo chặn trùng, không tự thêm hậu tố hay chiếm tài khoản cũ.
        if response.status_code == 409 and method == "POST" and path == "/api/confd/1.1/users":
            fail("WAZO_CREATE_CONFLICT",
                 "Wazo báo xung đột khi tạo tài khoản. Kiểm tra username lấy từ email, tài khoản xác thực còn sót hoặc máy lẻ bị trùng; không tự liên kết theo username.",
                 409)
        if response.status_code >= 400:
            fail("WAZO_REQUEST_FAILED",
                 f"Wazo từ chối {method} {path.split('?')[0]} (HTTP {response.status_code}). Kiểm tra quyền và cấu hình trên tổng đài.",
                 502)
        return response.json() if response.content else {}

    # Đăng nhập Wazo bằng credential riêng; token IdP không được dùng làm password.
    async def token(self, username, password, client_id, user=True, *, expiration=3600):
        response = await self.client.post(self.settings.wazo_url + "/api/auth/0.1/token",
            headers={"Wazo-Tenant": self.settings.wazo_auth_tenant_uuid} if self.settings.wazo_auth_tenant_uuid else {},
            auth=BasicAuth(username, password),
            json={"backend": "wazo_user", "expiration": expiration, **(
                {"access_type": "offline", "client_id": client_id} if user else {})})
        if response.status_code in (401, 403) and user:
            fail("WAZO_CREDENTIALS_REQUIRED",
                 "Tài khoản Wazo đã có nhưng không đăng nhập được bằng mật khẩu cấu hình. Không tự đổi mật khẩu tài khoản cũ.", 409)
        if response.status_code >= 400:
            fail("WAZO_AUTH_FAILED", "Không đăng nhập được Wazo. Kiểm tra credential/quyền quản trị hoặc trạng thái tài khoản.", 502)
        data = response.json().get("data", {})
        if not data.get("token"):
            fail("WAZO_RESPONSE_INVALID", "Wazo chưa trả token hợp lệ.", 502)
        return data

    # Cấp phát admin token ngắn hạn và luôn thu hồi sau khi wrapper hoặc cấp phát dùng xong.
    @asynccontextmanager
    async def admin_token_scope(self, client_id, *, expiration=60):
        settings = self.settings
        if not settings.wazo_admin_username or not settings.wazo_admin_password or not settings.wazo_tenant_uuid:
            fail("WAZO_NOT_CONFIGURED", "Chưa cấu hình tài khoản và tenant Wazo.", 503)

        admin_session = await self.token(
            settings.wazo_admin_username, settings.wazo_admin_password,
            client_id, user=False, expiration=expiration,
        )
        admin_token = admin_session["token"]
        try:
            yield admin_token
        finally:
            # Cố gắng thu hồi ngay cả khi xử lý thất bại. Giữ lỗi gốc nếu thu hồi gặp lỗi mạng.
            try:
                await self.client.delete(settings.wazo_url + "/api/auth/0.1/token/" + admin_token)
            except httpx.HTTPError:
                pass

    # Đọc một trang context trong tenant cấu hình và chỉ công bố trường cần thiết cho thử nghiệm.
    async def list_wrapper_contexts(self, limit, offset):
        async with self.admin_token_scope("smartcall-wrapper-contexts", expiration=60) as admin_token:
            result = await self.request(
                "GET", "/api/confd/1.1/contexts", token=admin_token,
                params={"limit": limit, "offset": offset, "recurse": False},
            )
            items = result.get("items") if isinstance(result, dict) else None
            if not isinstance(items, list):
                fail("WAZO_RESPONSE_INVALID", "Danh sách context Wazo không đúng định dạng.", 502)
            fields = ("uuid", "name", "label", "type", "enabled")
            contexts = [
                {field: item[field] for field in fields if field in item}
                for item in items if isinstance(item, dict)
            ]
            return {"items": contexts, "total": result.get("total", len(contexts)), "offset": offset}

    # Chuyển tiếp lệnh đã kiểm tra tới Wazo bằng token quản trị của server và lọc trường nhạy cảm.
    async def execute_wrapper(self, method, path, query=None, body=None):
        clean_method, clean_path = validate_wrapper_command(method, path, body)
        raw_query = query or {}
        if len(raw_query) > 50:
            fail("WRAPPER_QUERY_TOO_LARGE", "Số lượng tham số query vượt giới hạn cho phép.", 422)
        params = {}
        for key, value in raw_query.items():
            key_text = str(key).strip()
            if not key_text or len(key_text) > 100 or not isinstance(value, (str, int, float, bool)):
                fail("WRAPPER_INVALID_QUERY", "Tham số query không hợp lệ.", 422)
            params[key_text] = "true" if value is True else "false" if value is False else str(value)

        async with self.admin_token_scope("smartcall-wrapper", expiration=60) as admin_token:
            response = await self.client.request(
                clean_method,
                self.settings.wazo_url + clean_path,
                headers={
                    "Accept": "application/json",
                    "Wazo-Tenant": self.settings.wazo_tenant_uuid,
                    "X-Auth-Token": admin_token,
                },
                params=params or None,
                json=body if body is not None else None,
            )

        if response.status_code in (401, 403) or response.status_code >= 500:
            fail(
                "WAZO_REQUEST_FAILED",
                f"Wazo từ chối {clean_method} {clean_path} (HTTP {response.status_code}). Kiểm tra quyền và cấu hình trên tổng đài.",
                502,
            )
        if response.status_code >= 400:
            detail_message = f"Wazo trả lỗi HTTP {response.status_code}."
            try:
                error_payload = response.json()
                if isinstance(error_payload, dict) and isinstance(error_payload.get("message"), str):
                    detail_message = error_payload["message"].strip()[:300] or detail_message
                elif isinstance(error_payload, list) and error_payload and isinstance(error_payload[0], str):
                    detail_message = error_payload[0].strip()[:300] or detail_message
            except ValueError:
                pass
            raise HTTPException(
                response.status_code,
                detail={"code": "WAZO_CLIENT_ERROR", "status": response.status_code, "message": detail_message},
            )
        if response.status_code == 204 or not response.content:
            return 200, {"ok": True, "status": response.status_code}
        try:
            payload = response.json()
        except ValueError:
            fail("WAZO_RESPONSE_INVALID", "Wazo trả dữ liệu không đúng định dạng JSON.", 502)
        if isinstance(payload, dict) and payload.get("tenant_uuid") not in (None, self.settings.wazo_tenant_uuid):
            fail("WRAPPER_TENANT_FORBIDDEN", "Tài nguyên không thuộc tenant Wazo được cấu hình.", 403)
        return response.status_code, sanitize_wrapper_payload(payload, tenant_uuid=self.settings.wazo_tenant_uuid)

    # Kiểm tra username đã tồn tại trong danh sách user của tenant hay chưa.
    async def find_username(self, username, token):
        users = await self.list_items("/api/confd/1.1/users", token, search=username)
        for user in users:
            user_tenant = user.get("tenant_uuid")
            if user_tenant and user_tenant != self.settings.wazo_tenant_uuid:
                continue
            auth_username = str((user.get("auth") or {}).get("username") or "").strip().casefold()
            direct_username = str(user.get("username") or "").strip().casefold()
            if username in (auth_username, direct_username):
                return user
        return None

    # Lấy đủ các trang trước khi kết luận không tồn tại; lỗi API không phải danh sách rỗng.
    async def list_items(self, path, token, **params):
        result = []
        for offset in range(0, 100000, 100):
            data = await self.request("GET", path, token=token, params={"recurse": True, **params, "limit": 100, "offset": offset})
            items = data.get("items")
            if not isinstance(items, list):
                fail("WAZO_RESPONSE_INVALID", "Danh sách Wazo không đúng định dạng.", 502)
            result.extend(items)
            if len(items) < 100 or (isinstance(data.get("total"), int) and len(result) >= data["total"]):
                return result
        fail("WAZO_LIST_TOO_LARGE", "Danh sách quá lớn để cấp phát an toàn; cần thu hẹp tenant.", 502)

    # Tìm đủ các trang nhưng chỉ liên kết email trong tenant đích đã cấu hình.
    async def find_email(self, email, token):
        users = await self.list_items(
            "/api/confd/1.1/users",
            token,
            search=email,
        )
        matching_users = []
        email_exists_in_other_tenant = False
        for user in users:
            user_tenant_uuid = user.get("tenant_uuid")

            contact_email = str(user.get("email") or "").strip().casefold()
            authentication_emails = (user.get("auth") or {}).get("emails", [])
            authentication_email_matches = any(
                str(address.get("address") or "").strip().casefold() == email
                for address in authentication_emails
            )
            if contact_email == email or authentication_email_matches:
                if user_tenant_uuid and user_tenant_uuid != self.settings.wazo_tenant_uuid:
                    email_exists_in_other_tenant = True
                else:
                    matching_users.append(user)

        if len(matching_users) > 1:
            fail("WAZO_EMAIL_CONFLICT", "Có nhiều tài khoản Wazo cùng email trong tenant đích; cần quản trị liên kết.", 409)
        if not matching_users and email_exists_in_other_tenant:
            fail("WAZO_EMAIL_OTHER_TENANT", "Email tồn tại ở tenant khác. Kiểm tra tenant đích; không tự liên kết hoặc tạo trùng.", 409)
        return matching_users[0] if matching_users else None

    # Context phải đúng tên thật và thuộc tenant sẽ nhận user mới.
    async def load_provisioning_context(self, admin_token):
        settings = self.settings
        available_contexts = await self.list_items(
            "/api/confd/1.1/contexts",
            admin_token,
        )
        matching_contexts = []
        for context in available_contexts:
            name_matches = context.get("name") == settings.wazo_context
            tenant_matches = context.get("tenant_uuid") in (None, settings.wazo_tenant_uuid)
            is_enabled = context.get("enabled") is not False
            if name_matches and tenant_matches and is_enabled:
                matching_contexts.append(context)

        if len(matching_contexts) != 1:
            fail(
                "WAZO_CONTEXT_NOT_FOUND",
                "Không tìm thấy đúng context nội bộ trong tenant đích. Kiểm tra WAZO_CONTEXT là trường name và WAZO_TENANT_UUID là tenant_uuid của context.",
                409,
            )
        return matching_contexts[0]

    # Chuyển từng label cấu hình thành UUID template thật trong tenant đích.
    async def load_sip_templates(self, admin_token):
        settings = self.settings
        available_templates = await self.list_items(
            "/api/confd/1.1/endpoints/sip/templates",
            admin_token,
        )
        required_template_labels = [
            label.strip()
            for label in settings.wazo_template_labels.split(",")
            if label.strip()
        ]
        selected_templates = []
        for required_label in required_template_labels:
            matching_templates = [
                template
                for template in available_templates
                if template.get("label") == required_label
                and template.get("tenant_uuid") in (None, settings.wazo_tenant_uuid)
            ]
            if len(matching_templates) != 1 or not matching_templates[0].get("uuid"):
                fail(
                    "WAZO_TEMPLATE_NOT_FOUND",
                    f"Không xác định được SIP template '{required_label}' trong tenant đích.",
                    409,
                )
            selected_templates.append({"uuid": matching_templates[0]["uuid"]})

        if not selected_templates:
            fail("WAZO_TEMPLATE_NOT_FOUND", "Chưa cấu hình template WebRTC.", 409)
        return selected_templates

    # Chỉ chọn số nằm trong cả kho cấu hình và user_ranges mà context cho phép.
    async def choose_extension_number(self, selected_context, admin_token):
        settings = self.settings
        allowed_context_ranges = []
        for context_range in selected_context.get("user_ranges") or []:
            try:
                first_number = int(context_range["start"])
                last_number = int(context_range["end"])
            except (KeyError, TypeError, ValueError):
                fail("WAZO_CONTEXT_RANGE_INVALID", "user_ranges của context không đúng định dạng số.", 409)
            if first_number > last_number:
                fail("WAZO_CONTEXT_RANGE_INVALID", "Điểm đầu user_ranges lớn hơn điểm cuối.", 409)
            allowed_context_ranges.append((first_number, last_number))

        existing_extensions = await self.list_items(
            "/api/confd/1.1/extensions",
            admin_token,
        )
        occupied_extension_numbers = {
            str(extension.get("exten"))
            for extension in existing_extensions
            if extension.get("context") == settings.wazo_context
        }
        available_extension_numbers = []
        configured_number_pool = range(
            settings.wazo_extension_min,
            settings.wazo_extension_max + 1,
        )
        for extension_number in configured_number_pool:
            is_allowed_by_context = not allowed_context_ranges or any(
                first_number <= extension_number <= last_number
                for first_number, last_number in allowed_context_ranges
            )
            extension_text = str(extension_number)
            if is_allowed_by_context and extension_text not in occupied_extension_numbers:
                available_extension_numbers.append(extension_text)

        if not available_extension_numbers:
            fail(
                "WAZO_EXTENSION_POOL_EMPTY",
                "Không còn máy lẻ trống trong phần giao giữa kho số cấu hình và user_ranges của context.",
                409,
            )
        return secrets.choice(available_extension_numbers)

    # Credential đăng nhập Wazo khác credential SIP; không dùng token IdP làm mật khẩu.
    def build_user_payload(self, user_profile, wazo_username, identity_marker, selected_templates,
                           selected_extension_number, password=None):
        settings = self.settings
        authentication_payload = {
            "username": wazo_username,
            "password": settings.wazo_default_password if password is None else password,
            "email_address": user_profile["email"],
            "firstname": user_profile["firstname"],
            "lastname": user_profile["lastname"],
            "purpose": "user",
        }
        sip_username = wazo_username + "_" + selected_extension_number
        sip_password = secrets.token_urlsafe(32)
        sip_endpoint_payload = {
            # SDK dùng auth username làm SIP URI; đồng bộ tên PJSIP để nhận diện endpoint/AoR.
            "name": sip_username,
            "templates": selected_templates,
            "auth_section_options": [
                ["username", sip_username],
                ["password", sip_password],
            ],
        }
        extension_payload = {
            "exten": selected_extension_number,
            "context": settings.wazo_context,
        }
        line_payload = {
            "context": settings.wazo_context,
            "extensions": [extension_payload],
            "endpoint_sip": sip_endpoint_payload,
        }
        return {
            "firstname": user_profile["firstname"],
            "lastname": user_profile["lastname"],
            "email": user_profile["email"],
            "description": " ".join(str(user_profile.get("department") or "").split()),
            "userfield": identity_marker,
            "auth": authentication_payload,
            "lines": [line_payload],
        }

    # Cấp phát đầy đủ user + line + extension và trả thêm số máy lẻ đã chọn.
    async def _create_user_with_extension(self, user_profile, wazo_username, identity_marker,
                                          admin_token, provisioning_lock, password=None):
        selected_context = await self.load_provisioning_context(admin_token)
        selected_templates = await self.load_sip_templates(admin_token)
        selected_extension_number = await self.choose_extension_number(selected_context, admin_token)
        create_user_payload = self.build_user_payload(
            user_profile, wazo_username, identity_marker, selected_templates,
            selected_extension_number, password=password,
        )

        # Giữ khóa kho số tới lúc POST; lỗi/timeout không được retry tạo user mù.
        if not await provisioning_lock.owned():
            fail("WAZO_PROVISION_BUSY", "Khóa cấp phát đã hết hạn; vui lòng thử lại.", 409)
        await provisioning_lock.extend(180, replace_ttl=True)

        user = await self.request(
            "POST",
            "/api/confd/1.1/users",
            token=admin_token,
            json=create_user_payload,
        )
        return user, selected_extension_number

    # Chuẩn bị dữ liệu và gửi một POST để tạo user cùng tài khoản thoại.
    async def create_user(self, user_profile, wazo_username, identity_marker, admin_token, provisioning_lock):
        user, _ = await self._create_user_with_extension(
            user_profile, wazo_username, identity_marker, admin_token, provisioning_lock,
        )
        return user

    # Kiểm tra bật cấp phát và đủ thông tin quản trị Wazo trước khi tìm hoặc tạo tài khoản.
    def _ensure_admin_configured(self):
        settings = self.settings
        if not settings.wazo_admin_username or not settings.wazo_admin_password or not settings.wazo_tenant_uuid:
            fail("WAZO_NOT_CONFIGURED", "Chưa cấu hình tài khoản quản trị và tenant Wazo.", 503)

    # Chuẩn hóa email và kiểm tra domain được phép trước khi gọi API tổng đài.
    def _normalize_allowed_email(self, raw_email):
        email = str(raw_email or "").strip().casefold()
        if any(ch.isspace() or ord(ch) < 32 for ch in email) or email.count("@") != 1:
            fail("REGISTER_EMAIL_INVALID", "Email đăng ký không hợp lệ.", 422)
        local, domain = email.split("@", 1)
        if not local or not domain or "." not in domain:
            fail("REGISTER_EMAIL_INVALID", "Email đăng ký không hợp lệ.", 422)
        allowed_domains = {
            item.strip().casefold() for item in self.settings.allowed_email_domains.split(",") if item.strip()
        }
        if allowed_domains and domain not in allowed_domains:
            fail("EMAIL_NOT_ALLOWED", "Email không thuộc phạm vi được cấp tài khoản SmartCall.", 403)
        return email

    # Đọc bổ sung hồ sơ Confd và username Auth khi danh sách users không trả đủ lines/auth.
    async def _read_user_detail(self, user, admin_token):
        record = dict(user)
        username = str(record.get("username") or (record.get("auth") or {}).get("username") or "").strip()
        user_uuid = record.get("uuid")
        if user_uuid and (not record.get("lines") or not username):
            detail = await self.request(
                "GET", f"/api/confd/1.1/users/{user_uuid}", token=admin_token, allow_not_found=True,
            )
            if isinstance(detail, dict):
                record = {**record, **detail}
                username = str(record.get("username") or (record.get("auth") or {}).get("username") or "").strip()
        if user_uuid and not username:
            auth_user = await self.request(
                "GET", f"/api/auth/0.1/users/{user_uuid}", token=admin_token, allow_not_found=True,
            )
            if isinstance(auth_user, dict) and auth_user.get("username"):
                username = str(auth_user["username"]).strip()
        return record, username

    # Trích số máy lẻ đầu tiên gắn với tài khoản Wazo; trả chuỗi rỗng nếu chưa có line/extension.
    def _extract_extension(self, record):
        for line in record.get("lines") or []:
            if not isinstance(line, dict):
                continue
            for extension in line.get("extensions") or []:
                if isinstance(extension, dict) and extension.get("exten"):
                    return str(extension["exten"])
        return ""

    # Tạo bản tóm tắt hồ sơ công khai không chứa auth, password, secret hoặc userfield nội bộ.
    def _build_public_user_summary(self, record, username, fallback_email):
        description = " ".join(str(record.get("description") or "").split())
        email = str(record.get("email") or fallback_email).strip().casefold()
        return {
            "user_uuid": str(record.get("uuid") or ""),
            "username": username,
            "email": email,
            "firstname": str(record.get("firstname") or ""),
            "lastname": str(record.get("lastname") or ""),
            "department": description,
            "description": description,
            "extension": self._extract_extension(record),
            "enabled": bool(record.get("enabled", True)),
            "host": self.settings.wazo_url,
            "tenant_uuid": self.settings.wazo_tenant_uuid,
        }

    # Đăng nhập bằng credential người dùng và xác minh token trả về khớp đúng UUID đã liên kết.
    async def _login_verified_user(self, username, password, client_id, expected_user_uuid):
        user_token = await self.token(username, password, client_id, user=True)
        metadata = user_token.get("metadata") or {}
        token_user_uuid = metadata.get("pbx_user_uuid") or metadata.get("uuid") or user_token.get("pbx_user_uuid")
        if token_user_uuid != expected_user_uuid:
            try:
                await self.client.delete(self.settings.wazo_url + "/api/auth/0.1/token/" + user_token["token"])
            except httpx.HTTPError:
                pass
            fail("WAZO_IDENTITY_MISMATCH", "Token Wazo không khớp với tài khoản vừa liên kết.", 502)
        return user_token

    # Kiểm tra email đã tồn tại trên Wazo chưa; nếu có thì trả về thông tin an toàn của user đó.
    async def check_register_email(self, raw_email):
        self._ensure_admin_configured()
        email = self._normalize_allowed_email(raw_email)
        async with self.admin_token_scope("smartcall-check-email", expiration=60) as admin_token:
            existing_user = await self.find_email(email, admin_token)
            if not existing_user:
                return {"exists": False, "email": email, "user": None}
            if existing_user.get("tenant_uuid") not in (None, self.settings.wazo_tenant_uuid):
                fail("WRAPPER_TENANT_FORBIDDEN", "Tài nguyên không thuộc tenant Wazo được cấu hình.", 403)
            record, username = await self._read_user_detail(existing_user, admin_token)
            return {
                "exists": True,
                "email": email,
                "user": self._build_public_user_summary(record, username, email),
            }

    # Kiểm tra email trên Wazo: nếu chưa có thì tạo mới + trả token; nếu đã có thì trả thông tin (và token nếu đăng nhập được).
    async def register_user(self, payload):
        settings = self.settings
        if not settings.wazo_provisioning_enabled:
            fail("WAZO_DISABLED", "Cấp tài khoản Wazo đang tắt trong cấu hình backend.", 409)
        self._ensure_admin_configured()

        email = self._normalize_allowed_email(payload.email)
        firstname = " ".join(payload.firstname.split())
        lastname = " ".join(payload.lastname.split())
        department = " ".join(payload.department.split())
        effective_password = settings.wazo_default_password if payload.password is None else payload.password

        lock = self.store.redis.lock(self.store.key("provision", settings.wazo_tenant_uuid), timeout=180, blocking_timeout=0)
        if not await lock.acquire(blocking=False):
            fail("WAZO_PROVISION_BUSY", "Đang cấp phát tài khoản khác. Vui lòng thử lại sau.", 409)
        try:
            async with self.admin_token_scope("smartcall-register", expiration=60) as admin_token:
                existing_user = await self.find_email(email, admin_token)
                if existing_user:
                    # Tài khoản bị khóa hoặc khác tenant phải bị từ chối thay vì trả thông tin hay cấp phiên.
                    if existing_user.get("tenant_uuid") not in (None, settings.wazo_tenant_uuid) or existing_user.get("enabled") is False:
                        fail("WAZO_USER_UNAVAILABLE", "Tài khoản Wazo bị khóa hoặc không thuộc tenant cấu hình.", 403)

                    record, existing_username = await self._read_user_detail(existing_user, admin_token)
                    if not existing_username:
                        fail("WAZO_USERNAME_MISSING", "Không lấy được username Wazo của tài khoản hiện có.", 409)

                    register_marker = "smartcall:register:" + hashlib.sha256(email.encode()).hexdigest()
                    userfield = str(record.get("userfield") or "")
                    managed = userfield == register_marker or userfield.startswith("smartcall:sso:")
                    # Chỉ tự thử đăng nhập khi tài khoản do SmartCall quản lý, client truyền mật khẩu, hoặc bật opt-in thử mật khẩu cấu hình.
                    can_attempt_login = managed or payload.password is not None or settings.wazo_existing_password_login
                    authenticated = False
                    token_value = ""
                    refresh_value = ""
                    reason = ""

                    if not can_attempt_login:
                        reason = "WAZO_ACCOUNT_LINK_REQUIRED"
                    else:
                        try:
                            user_token = await self._login_verified_user(
                                existing_username, effective_password, payload.client_id, record["uuid"],
                            )
                            authenticated = True
                            token_value = user_token["token"]
                            refresh_value = user_token.get("refresh_token", "")
                        except HTTPException as error:
                            detail = error.detail if isinstance(error.detail, dict) else {}
                            # Nếu mật khẩu không khớp thì vẫn trả thông tin user hiện có để App/Web xử lý tiếp, không giấu dữ liệu.
                            if detail.get("code") == "WAZO_CREDENTIALS_REQUIRED":
                                reason = "WAZO_CREDENTIALS_REQUIRED"
                            else:
                                raise

                    # Chỉ đồng bộ description sau khi xác nhận token đăng nhập hợp lệ thuộc đúng UUID của user này.
                    if authenticated and department:
                        try:
                            await self.synchronize_department_description(record, {"department": department}, admin_token)
                        except Exception:
                            try:
                                await self.revoke_session({"token": token_value, "user_uuid": record["uuid"]}, payload.client_id)
                            except Exception:
                                pass
                            raise

                    summary = self._build_public_user_summary(record, existing_username, email)
                    return {
                        "created": False,
                        "exists": True,
                        "authenticated": authenticated,
                        "reason": reason,
                        **summary,
                        "token": token_value,
                        "refresh_token": refresh_value,
                    }

                if not firstname or not lastname:
                    fail("REGISTER_NAME_INVALID", "Cần nhập đầy đủ firstname và lastname để tạo tài khoản mới.", 422)

                username = self.username_from_email(email) if payload.username is None else payload.username.strip().casefold()
                if not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,255}", username) or username.endswith(".") or ".." in username:
                    fail("REGISTER_USERNAME_INVALID", "Username chỉ được dùng chữ thường, số và . _ + -.", 422)

                if await self.find_username(username, admin_token):
                    fail("WAZO_USERNAME_EXISTS", "Username đã tồn tại trên tổng đài Wazo.", 409)

                profile = {
                    "firstname": firstname,
                    "lastname": lastname,
                    "email": email,
                    "department": department,
                }
                marker = "smartcall:register:" + hashlib.sha256(email.encode()).hexdigest()
                user, assigned_extension = await self._create_user_with_extension(
                    profile, username, marker, admin_token, lock, password=effective_password,
                )
                if not user.get("uuid"):
                    fail("WAZO_RESPONSE_INVALID", "Wazo chưa trả UUID user sau khi đăng ký.", 502)

            user_token = await self._login_verified_user(
                username, effective_password, payload.client_id, user["uuid"],
            )
            return {
                "created": True,
                "exists": False,
                "authenticated": True,
                "reason": "",
                "user_uuid": user["uuid"],
                "username": username,
                "email": email,
                "firstname": firstname,
                "lastname": lastname,
                "department": department,
                "description": department,
                "extension": assigned_extension,
                "enabled": bool(user.get("enabled", True)),
                "host": settings.wazo_url,
                "tenant_uuid": settings.wazo_tenant_uuid,
                "token": user_token["token"],
                "refresh_token": user_token.get("refresh_token", ""),
            }
        finally:
            if await lock.owned():
                await lock.release()

    # Thu hồi token/refresh mới cấp nếu phiên backend bị hủy trước khi giao cho Web.
    async def revoke_session(self, result, client_id):
        try:
            await self.client.delete(self.settings.wazo_url + "/api/auth/0.1/users/" + result["user_uuid"] + "/tokens/" + client_id,
                                     headers={"X-Auth-Token": result["token"]})
        finally:
            await self.client.delete(self.settings.wazo_url + "/api/auth/0.1/token/" + result["token"])

    # Đồng bộ tên endpoint cũ do SmartCall quản lý, giữ nguyên password và các option SIP.
    async def repair_managed_sip_name(self, user_uuid, admin_token):
        endpoint = await self.request(
            "GET", f"/api/confd/1.1/users/{user_uuid}/lines/main/associated/endpoints/sip",
            token=admin_token, params={"view": "merged"},
        )
        sip_username = next((value for key, value in endpoint.get("auth_section_options", [])
                             if key == "username"), None)
        if not endpoint.get("uuid") or not sip_username:
            fail("WAZO_SIP_CONFIG_INVALID", "Line chính chưa có endpoint UUID hoặc SIP username hợp lệ.", 409)
        if endpoint.get("name") != sip_username:
            # Chỉ sửa endpoint của user được xác nhận managed; không sửa template hoặc credential.
            await self.request("PUT", "/api/confd/1.1/endpoints/sip/" + endpoint["uuid"],
                               token=admin_token, json={"name": sip_username})

    # Ghi bộ phận IdP vào description của user Wazo; thiếu department không xóa mô tả cũ.
    async def synchronize_department_description(self, user, profile, admin_token):
        department = " ".join(str(profile.get("department") or "").split())
        if not department or user.get("description") == department:
            return
        # Chỉ cập nhật field đã thống nhất; không gửi lại auth/password/line hay marker userfield.
        await self.request("PUT", "/api/confd/1.1/users/" + user["uuid"],
                           token=admin_token, json={"description": department})
        user["description"] = department

    # Lấy nguyên phần trước @ làm username auth; chuẩn hóa chữ thường theo email từ IdP.
    def username_from_email(self, email):
        normalized_email = str(email or "").strip().casefold()
        username, separator, domain = normalized_email.rpartition("@")
        # Không bỏ ký tự hay nối hậu tố: username phải phản ánh đúng email công ty đã xác thực.
        if (not separator or not username or not domain or "@" in username
                or len(username) > 256 or any(character.isspace() or ord(character) < 32 for character in normalized_email)):
            fail("WAZO_EMAIL_INVALID", "Email Single ID không hợp lệ để tạo username Wazo.", 409)
        return username

    # Tìm bằng UUID đã liên kết trước. Chỉ tìm theo email khi chưa có liên kết hợp lệ.
    async def find_provisioning_user(self, identity, email, admin_token):
        settings = self.settings
        mapping = await self.store.mapping(identity, settings.wazo_tenant_uuid)
        stale_mapping = None
        user = None
        if mapping:
            user = await self.request(
                "GET", "/api/confd/1.1/users/" + mapping["user_uuid"],
                token=admin_token, allow_not_found=True,
            )
            # Chỉ 404 của UUID cụ thể mới cho phép tìm/tạo lại; 401/403/timeout vẫn dừng.
            if user is None:
                stale_mapping = mapping
                mapping = None
        if not mapping:
            user = await self.find_email(email, admin_token)
        return user, mapping, stale_mapping

    # Ưu tiên username đã lưu, sau đó đọc username Auth thực tế của tài khoản cũ.
    async def resolve_account_username(self, user, mapping, created, default_username, admin_token):
        auth = user.get("auth") or {}
        username = mapping["username"] if mapping else auth.get("username")
        # Chỉ user vừa tạo mới có username theo quy tắc mới; user cũ phải đọc username thật.
        if not username and created:
            username = default_username
        if not username:
            auth_user = await self.request("GET", "/api/auth/0.1/users/" + user["uuid"], token=admin_token)
            username = auth_user.get("username")
        if not username:
            fail("WAZO_USERNAME_MISSING", "Không lấy được username Wazo của tài khoản hiện có.", 409)
        return username

    # Cấp phát có khóa phân tán; tài khoản cũ không bị reset mật khẩu hay đổi máy lẻ.
    async def provision(self, session, client_id):
        settings = self.settings
        if not settings.wazo_provisioning_enabled:
            fail("WAZO_DISABLED", "Đã xác thực Single ID. Cấp phiên Wazo đang tắt trong cấu hình backend.", 409)
        if not settings.wazo_admin_username or not settings.wazo_admin_password or not settings.wazo_tenant_uuid:
            fail("WAZO_NOT_CONFIGURED", "Đã có hồ sơ Single ID. Cần cấu hình credential quản trị và tenant Wazo trong backend/.env.", 503)
        # Khóa tenant bảo vệ cả kho máy lẻ, không chỉ việc tạo trùng cùng một người.
        lock = self.store.redis.lock(self.store.key("provision", settings.wazo_tenant_uuid), timeout=180, blocking_timeout=0)
        if not await lock.acquire(blocking=False):
            fail("WAZO_PROVISION_BUSY", "Đang cấp phát tài khoản khác. Vui lòng thử lại sau.", 409)
        admin = None
        try:
            admin = await self.token(settings.wazo_admin_username, settings.wazo_admin_password, "smartcall-provision", user=False)
            identity = session["identity"]
            profile = session["profile"]
            digest = hashlib.sha256(identity.encode()).hexdigest()
            marker = "smartcall:sso:" + digest
            default_username = self.username_from_email(profile["email"])
            user, mapping, stale_mapping = await self.find_provisioning_user(
                identity, profile["email"], admin["token"],
            )
            if user and (user.get("tenant_uuid") not in (None, settings.wazo_tenant_uuid) or user.get("enabled") is False):
                fail("WAZO_USER_UNAVAILABLE", "Tài khoản Wazo bị khóa hoặc không thuộc tenant cấu hình.", 403)
            managed = bool(mapping and mapping["managed"]) or bool(user and user.get("userfield") == marker)
            created = False
            if not user:
                user = await self.create_user(profile, default_username, marker, admin["token"], lock)
                managed = True
                created = True
            if not user.get("uuid"):
                fail("WAZO_RESPONSE_INVALID", "Wazo chưa trả UUID user sau cấp phát.", 502)
            if not managed and not settings.wazo_existing_password_login:
                fail("WAZO_ACCOUNT_LINK_REQUIRED",
                     "Email đã có tài khoản Wazo. Cần cơ chế SSO hoặc cho phép thử mật khẩu cấu hình; backend không đổi mật khẩu cũ.", 409)
            if managed and not created:
                await self.repair_managed_sip_name(user["uuid"], admin["token"])
            username = await self.resolve_account_username(
                user, mapping, created, default_username, admin["token"],
            )
            if not await lock.owned():
                fail("WAZO_PROVISION_BUSY", "Khóa cấp phát đã hết hạn; vui lòng thử lại.", 409)
            await lock.extend(180, replace_ttl=True)
            # Lưu ngay sau tạo, trước đăng nhập: retry không được tạo thêm một user khác.
            mapping_value = dict(user_uuid=user["uuid"], username=username, managed=managed)
            if stale_mapping:
                # Thay đúng binding đã xác nhận mất user; nếu công cụ khác sửa DB thì dừng.
                await self.store.replace_mapping(identity, settings.wazo_tenant_uuid,
                                                 stale_mapping["user_uuid"], mapping_value)
            elif not mapping:
                await self.store.mapping(identity, settings.wazo_tenant_uuid, mapping_value)
            token = await self.token(username, settings.wazo_default_password, client_id)
            metadata = token.get("metadata") or {}
            token_user_uuid = metadata.get("pbx_user_uuid") or metadata.get("uuid") or token.get("pbx_user_uuid")
            if token_user_uuid != user["uuid"]:
                try:
                    await self.client.delete(settings.wazo_url + "/api/auth/0.1/token/" + token["token"])
                except Exception:
                    pass
                fail("WAZO_IDENTITY_MISMATCH", "Token Wazo không thuộc tài khoản vừa liên kết.", 502)
            # Chỉ cập nhật tài khoản cũ sau khi token đã được xác nhận đúng UUID đã liên kết.
            try:
                await self.synchronize_department_description(user, profile, admin["token"])
            except Exception:
                try:
                    await self.revoke_session(dict(token, user_uuid=user["uuid"]), client_id)
                except Exception:
                    pass
                raise
            return dict(token=token["token"], refresh_token=token.get("refresh_token", ""),
                        user_uuid=user["uuid"], host=settings.wazo_url, username=username, created=created,
                        profile=profile)
        finally:
            if admin:
                try:
                    await self.client.delete(settings.wazo_url + "/api/auth/0.1/token/" + admin["token"])
                except Exception:
                    pass  # Token admin có hạn ngắn; cleanup lỗi không được làm mất khóa.
            if await lock.owned():
                await lock.release()
