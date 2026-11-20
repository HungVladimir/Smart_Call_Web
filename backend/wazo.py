"""Cấp tài khoản WebRTC qua Confd; chỉ trả token của user, tuyệt đối không trả token quản trị."""
import hashlib
import secrets
from httpx import BasicAuth
from oidc import fail


class WazoClient:
    """Tìm/liên kết/tạo user theo email đã xác minh, có khóa cấp phát theo tenant."""
    def __init__(self, settings, client, store):
        """Nhận HTTP client và store; không gọi máy chủ cho tới khi người dùng hoàn tất SSO."""
        self.settings, self.client, self.store = settings, client, store

    async def request(self, method, path, *, token=None, **kwargs):
        """Áp dụng tenant/header cố định và chuyển lỗi thành thông báo không lộ secret."""
        headers = {"Accept": "application/json", "Wazo-Tenant": self.settings.wazo_tenant_uuid}
        if token:
            headers["X-Auth-Token"] = token
        response = await self.client.request(method, self.settings.wazo_url + path, headers=headers, **kwargs)
        if response.status_code >= 400:
            fail("WAZO_REQUEST_FAILED",
                 f"Wazo từ chối {method} {path.split('?')[0]} (HTTP {response.status_code}). Kiểm tra quyền và cấu hình trên tổng đài.",
                 502)
        return response.json() if response.content else {}

    async def token(self, username, password, client_id, user=True):
        """Đăng nhập Wazo bằng credential riêng; token IdP không được dùng làm password."""
        response = await self.client.post(self.settings.wazo_url + "/api/auth/0.1/token",
            headers={"Wazo-Tenant": self.settings.wazo_tenant_uuid},
            auth=BasicAuth(username, password),
            json={"backend": "wazo_user", "expiration": 3600, **(
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

    async def list_items(self, path, token, **params):
        """Lấy đủ các trang trước khi kết luận không tồn tại; lỗi API không phải danh sách rỗng."""
        result = []
        for offset in range(0, 100000, 100):
            data = await self.request("GET", path, token=token, params={**params, "limit": 100, "offset": offset})
            items = data.get("items")
            if not isinstance(items, list):
                fail("WAZO_RESPONSE_INVALID", "Danh sách Wazo không đúng định dạng.", 502)
            result.extend(items)
            if len(items) < 100 or (isinstance(data.get("total"), int) and len(result) >= data["total"]):
                return result
        fail("WAZO_LIST_TOO_LARGE", "Danh sách quá lớn để cấp phát an toàn; cần thu hẹp tenant.", 502)

    async def find_email(self, email, token):
        """Tìm gần đúng qua API rồi bắt buộc khớp email chính xác trong đúng tenant."""
        users = await self.list_items("/api/confd/1.1/users", token, search=email, recurse=False, view="full")
        matches = [u for u in users if str(u.get("email") or "").strip().casefold() == email
                   or any(str(e.get("address") or "").casefold() == email for e in (u.get("auth") or {}).get("emails", []))]
        if len(matches) > 1:
            fail("WAZO_EMAIL_CONFLICT", "Có nhiều tài khoản Wazo cùng email; cần quản trị liên kết.", 409)
        return matches[0] if matches else None

    async def create_user(self, profile, identity, username, marker, token, lock):
        """Kiểm tra context/template/kho số trước một POST gộp user+auth+line+extension."""
        s = self.settings
        contexts = await self.list_items("/api/confd/1.1/contexts", token)
        if not any(c.get("name") == s.wazo_context for c in contexts):
            fail("WAZO_CONTEXT_NOT_FOUND", "Context cấu hình không tồn tại. Điền tên context nội bộ thật trong backend/.env.", 409)
        templates = await self.list_items("/api/confd/1.1/endpoints/sip/templates", token)
        selected = []
        for label in [x.strip() for x in s.wazo_template_labels.split(",") if x.strip()]:
            matches = [t for t in templates if t.get("label") == label]
            if len(matches) != 1 or not matches[0].get("uuid"):
                fail("WAZO_TEMPLATE_NOT_FOUND", f"Không xác định được SIP template '{label}' trong tenant.", 409)
            selected.append({"uuid": matches[0]["uuid"]})
        if not selected:
            fail("WAZO_TEMPLATE_NOT_FOUND", "Chưa cấu hình template WebRTC.", 409)
        extensions = await self.list_items("/api/confd/1.1/extensions", token)
        used = {str(e.get("exten")) for e in extensions if e.get("context") == s.wazo_context}
        # Dải số do quản trị cấu hình; không đoán số điện thoại từ EP ID.
        free = [str(n) for n in range(s.wazo_extension_min, s.wazo_extension_max + 1) if str(n) not in used]
        if not free:
            fail("WAZO_EXTENSION_POOL_EMPTY", "Kho máy lẻ đã hết số trống.", 409)
        extension = secrets.choice(free)
        payload = dict(firstname=profile["firstname"], lastname=profile["lastname"], email=profile["email"],
            userfield=marker,
            auth=dict(username=username, password=s.wazo_default_password, email_address=profile["email"],
                      firstname=profile["firstname"], lastname=profile["lastname"], purpose="user"),
            lines=[dict(context=s.wazo_context, extensions=[dict(exten=extension, context=s.wazo_context)],
                endpoint_sip=dict(templates=selected,
                    auth_section_options=[["username", username + "_" + extension], ["password", secrets.token_urlsafe(32)]]))])
        if not await lock.owned():
            fail("WAZO_PROVISION_BUSY", "Khóa cấp phát đã hết hạn; vui lòng thử lại.", 409)
        await lock.extend(180, replace_ttl=True)
        # Không retry POST mù khi timeout: máy chủ có thể đã tạo; lượt sau tra lại email/marker.
        return await self.request("POST", "/api/confd/1.1/users", token=token, json=payload)

    async def revoke_session(self, result, client_id):
        """Thu hồi token/refresh mới cấp nếu phiên backend bị hủy trước khi giao cho Web."""
        try:
            await self.client.delete(self.settings.wazo_url + "/api/auth/0.1/users/" + result["user_uuid"] + "/tokens/" + client_id,
                                     headers={"X-Auth-Token": result["token"]})
        finally:
            await self.client.delete(self.settings.wazo_url + "/api/auth/0.1/token/" + result["token"])

    async def provision(self, session, client_id):
        """Cấp phát có khóa phân tán; tài khoản cũ không bị reset mật khẩu hay đổi máy lẻ."""
        s = self.settings
        if not s.wazo_provisioning_enabled:
            fail("WAZO_DISABLED", "Đã xác thực Single ID. Cấp phiên Wazo đang tắt trong cấu hình backend.", 409)
        if not s.wazo_admin_username or not s.wazo_admin_password or not s.wazo_tenant_uuid:
            fail("WAZO_NOT_CONFIGURED", "Đã có hồ sơ Single ID. Cần cấu hình credential quản trị và tenant Wazo trong backend/.env.", 503)
        # Khóa tenant bảo vệ cả kho máy lẻ, không chỉ việc tạo trùng cùng một người.
        lock = self.store.redis.lock(self.store.key("provision", s.wazo_tenant_uuid), timeout=180, blocking_timeout=0)
        if not await lock.acquire(blocking=False):
            fail("WAZO_PROVISION_BUSY", "Đang cấp phát tài khoản khác. Vui lòng thử lại sau.", 409)
        admin = None
        try:
            admin = await self.token(s.wazo_admin_username, s.wazo_admin_password, "smartcall-provision", user=False)
            identity, profile = session["identity"], session["profile"]
            digest = hashlib.sha256(identity.encode()).hexdigest()
            marker, default_username = "smartcall:sso:" + digest, "sso_" + digest[:28]
            mapping = await self.store.mapping(identity, s.wazo_tenant_uuid)
            user = (await self.request("GET", "/api/confd/1.1/users/" + mapping["user_uuid"], token=admin["token"])
                    if mapping else await self.find_email(profile["email"], admin["token"]))
            if user and (user.get("tenant_uuid") not in (None, s.wazo_tenant_uuid) or user.get("enabled") is False):
                fail("WAZO_USER_UNAVAILABLE", "Tài khoản Wazo bị khóa hoặc không thuộc tenant cấu hình.", 403)
            managed = bool(mapping and mapping["managed"]) or bool(user and user.get("userfield") == marker)
            created = False
            if not user:
                user = await self.create_user(profile, identity, default_username, marker, admin["token"], lock)
                managed, created = True, True
            if not user.get("uuid"):
                fail("WAZO_RESPONSE_INVALID", "Wazo chưa trả UUID user sau cấp phát.", 502)
            if not managed and not s.wazo_existing_password_login:
                fail("WAZO_ACCOUNT_LINK_REQUIRED",
                     "Email đã có tài khoản Wazo. Cần cơ chế SSO hoặc cho phép thử mật khẩu cấu hình; backend không đổi mật khẩu cũ.", 409)
            auth = user.get("auth") or {}
            username = mapping["username"] if mapping else auth.get("username")
            if not username and managed:
                username = default_username
            if not username:
                auth_user = await self.request("GET", "/api/auth/0.1/users/" + user["uuid"], token=admin["token"])
                username = auth_user.get("username")
            if not username:
                fail("WAZO_USERNAME_MISSING", "Không lấy được username Wazo của tài khoản hiện có.", 409)
            if not await lock.owned():
                fail("WAZO_PROVISION_BUSY", "Khóa cấp phát đã hết hạn; vui lòng thử lại.", 409)
            await lock.extend(180, replace_ttl=True)
            # Lưu ngay sau tạo, trước đăng nhập: retry không được tạo thêm một user khác.
            if not mapping:
                await self.store.mapping(identity, s.wazo_tenant_uuid,
                    dict(user_uuid=user["uuid"], username=username, managed=managed))
            token = await self.token(username, s.wazo_default_password, client_id)
            metadata = token.get("metadata") or {}
            token_user_uuid = metadata.get("pbx_user_uuid") or metadata.get("uuid") or token.get("pbx_user_uuid")
            if token_user_uuid != user["uuid"]:
                try:
                    await self.client.delete(s.wazo_url + "/api/auth/0.1/token/" + token["token"])
                except Exception:
                    pass
                fail("WAZO_IDENTITY_MISMATCH", "Token Wazo không thuộc tài khoản vừa liên kết.", 502)
            return dict(token=token["token"], refresh_token=token.get("refresh_token", ""),
                        user_uuid=user["uuid"], host=s.wazo_url, username=username, created=created,
                        profile=profile)
        finally:
            if admin:
                try:
                    await self.client.delete(s.wazo_url + "/api/auth/0.1/token/" + admin["token"])
                except Exception:
                    pass  # Token admin có hạn ngắn; cleanup lỗi không được làm mất khóa.
            if await lock.owned():
                await lock.release()
