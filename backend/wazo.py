"""Cấp tài khoản WebRTC qua Confd; chỉ trả token của user, tuyệt đối không trả token quản trị."""
import hashlib
import secrets
from httpx import BasicAuth
from oidc import fail


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
    async def token(self, username, password, client_id, user=True):
        response = await self.client.post(self.settings.wazo_url + "/api/auth/0.1/token",
            headers={"Wazo-Tenant": self.settings.wazo_auth_tenant_uuid} if self.settings.wazo_auth_tenant_uuid else {},
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
    def build_user_payload(self, user_profile, wazo_username, identity_marker, selected_templates, selected_extension_number):
        settings = self.settings
        authentication_payload = {
            "username": wazo_username,
            "password": settings.wazo_default_password,
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

    # Chuẩn bị dữ liệu và gửi một POST để tạo user cùng tài khoản thoại.
    async def create_user(self, user_profile, wazo_username, identity_marker, admin_token, provisioning_lock):
        selected_context = await self.load_provisioning_context(admin_token)
        selected_templates = await self.load_sip_templates(admin_token)
        selected_extension_number = await self.choose_extension_number(selected_context, admin_token)
        create_user_payload = self.build_user_payload(
            user_profile, wazo_username, identity_marker, selected_templates, selected_extension_number,
        )

        # Giữ khóa kho số tới lúc POST; lỗi/timeout không được retry tạo user mù.
        if not await provisioning_lock.owned():
            fail("WAZO_PROVISION_BUSY", "Khóa cấp phát đã hết hạn; vui lòng thử lại.", 409)
        await provisioning_lock.extend(180, replace_ttl=True)

        return await self.request(
            "POST",
            "/api/confd/1.1/users",
            token=admin_token,
            json=create_user_payload,
        )

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
