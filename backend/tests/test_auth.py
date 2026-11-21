"""Kiểm thử ranh giới HTTP/Redis giả; không kết nối IdP/Wazo thật và không cấp tài khoản thật."""
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import AsyncMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from config import Settings
from main import create_app
from oidc import OidcClient
from store import Store
from wazo import WazoClient

PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC = {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(PRIVATE.public_key())), "kid": "key1", "use": "sig"}


def config(**values):
    """Mọi URL/credential fixture đều độc lập .env của người dùng."""
    return Settings(_env_file=None, idp_issuer="https://idp.fixture", idp_client_id="fixture",
        idp_client_secret="fixture-secret", redis_url="redis://localhost:6379/15",
        wazo_url="https://wazo.fixture", wazo_admin_username="fixture-admin",
        wazo_admin_password="fixture-secret", wazo_tenant_uuid="tenant", **values)


class MemoryLock:
    """Giả ranh giới khóa Redis để kiểm tra không tạo khi khóa đang bận."""
    def __init__(self):
        self.available = True
        self.acquired = False

    async def acquire(self, **kwargs):
        """Nhận khóa nếu chưa có request khác."""
        if self.acquired or not self.available:
            return False
        self.acquired = True
        return True

    async def owned(self):
        """Trả trạng thái sở hữu khóa của fixture."""
        return self.acquired

    async def extend(self, *args, **kwargs):
        """Giả gia hạn khóa cấp phát."""
        return True

    async def release(self):
        """Giải phóng khóa sau cả thành công/lỗi."""
        self.acquired = False


class MemoryStore:
    """Chỉ trong test: giữ giao dịch/phiên/mapping trong RAM."""
    def __init__(self):
        self.values, self.links = {}, {}
        self.gate = MemoryLock()
        self.redis = self

    def key(self, resource, identifier):
        """Tạo namespace fixture."""
        return resource + ":" + identifier

    def lock(self, *args, **kwargs):
        """Trả khóa được test điều khiển."""
        return self.gate

    async def put(self, resource, identifier, value, ttl):
        """Lưu bản sao để test không vô ý sửa dữ liệu ngoài request."""
        self.values[(resource, identifier)] = json.loads(json.dumps(value))

    async def get(self, resource, identifier, consume=False):
        """Mô phỏng GETDEL chống replay."""
        value = self.values.get((resource, identifier))
        if consume:
            self.values.pop((resource, identifier), None)
        return json.loads(json.dumps(value)) if value else None

    async def delete(self, resource, identifier):
        """Dọn cookie session tương ứng."""
        self.values.pop((resource, identifier), None)

    async def replace_mapping(self, identity, tenant, expected_user_uuid, value):
        """Giả thay liên kết có điều kiện như Store SQLite thật."""
        if self.links[(identity, tenant)]["user_uuid"] != expected_user_uuid:
            raise AssertionError("mapping changed")
        self.links[(identity, tenant)] = value

    async def mapping(self, identity, tenant, value=None):
        """Giữ binding để kiểm tra retry không tạo user lặp."""
        if value:
            self.links[(identity, tenant)] = value
        return self.links.get((identity, tenant))


class AuthTests(unittest.IsolatedAsyncioTestCase):
    """Chạy OIDC ký JWT thật và API FastAPI thật với transport upstream giả."""
    async def asyncSetUp(self):
        """Dựng ranh giới; mọi request ngoài kịch bản đều làm test thất bại."""
        self.settings = config()
        self.store = MemoryStore()
        self.nonce = ""
        self.claim_overrides = {}
        self.calls = []

        def upstream(request):
            self.calls.append(request)
            if request.url.path == "/.well-known/openid-configuration":
                return httpx.Response(200, json=dict(issuer=self.settings.idp_issuer,
                    authorization_endpoint="https://idp.fixture/authorize",
                    token_endpoint="https://idp.fixture/token", jwks_uri="https://idp.fixture/jwks", end_session_endpoint="https://idp.fixture/end-session"))
            if request.url.path == "/jwks":
                return httpx.Response(200, json={"keys": [PUBLIC]})
            if request.url.path == "/token":
                claims = dict(iss=self.settings.idp_issuer, aud="fixture", sub="employee1",
                    nonce=self.nonce, iat=int(time.time()), exp=int(time.time())+300,
                    email="employee@samsung.com", formattedName="Họ Đệm Tên", department="Department", epId="EP1")
                claims.update(self.claim_overrides)
                token = jwt.encode(claims, PRIVATE, algorithm="RS256", headers={"kid": "key1"})
                return httpx.Response(200, json={"id_token": token, "access_token": "idp-secret", "refresh_token": "idp-refresh"})
            raise AssertionError(str(request.url))

        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.oidc = OidcClient(self.settings, self.upstream)
        self.app = create_app(self.settings)
        self.app.state.store = self.store
        self.app.state.oidc = self.oidc
        self.app.state.wazo = AsyncMock()
        self.web = httpx.AsyncClient(transport=httpx.ASGITransport(self.app), base_url=self.settings.public_origin)

    async def asyncTearDown(self):
        """Đóng pool fixture."""
        await self.web.aclose()
        await self.upstream.aclose()

    async def begin(self):
        """Khởi động qua endpoint thật và lấy nonce phía server cho token fixture."""
        response = await self.web.get("/api/auth/login")
        state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]
        self.nonce = self.store.values[("transactions", state)]["nonce"]
        return state, response

    async def authenticated(self):
        """Hoàn tất code flow, trả profile công khai và CSRF."""
        state, _ = await self.begin()
        response = await self.web.get("/api/auth/callback", params={"state": state, "code": "one-time"})
        self.assertEqual(response.status_code, 302, response.text)
        response = await self.web.get("/api/auth/user_info")
        self.assertEqual(response.status_code, 200)
        return response.json()

    async def test_full_flow_browser_binding_pkce_and_no_token_leak(self):
        """IdP code flow trả đúng profile, cookie riêng và không lộ token trong URL/JSON."""
        state, response = await self.begin()
        query = parse_qs(urlsplit(response.headers["location"]).query)
        self.assertEqual(query["redirect_uri"][0], "http://localhost:8800/api/auth/callback")
        self.assertEqual(query["code_challenge_method"], ["S256"])
        response = await self.web.get("/api/auth/callback", params={"state": state, "code": "one-time", "session_state": "idp-shared"})
        self.assertEqual(response.status_code, 302, response.text)
        self.assertEqual(response.headers["location"], self.settings.public_origin + "/callback")
        self.assertNotEqual(self.web.cookies.get("smartcall_session"), "idp-shared")
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        profile = await self.web.get("/api/auth/user_info")
        self.assertEqual(profile.json()["profile"]["employee_id"], "EP1")
        self.assertNotIn("idp-secret", profile.text)
        self.assertNotIn("access_token", profile.text)
        self.assertEqual(profile.headers["cache-control"], "no-store")
        token_request = next(r for r in self.calls if r.url.path == "/token")
        self.assertIn("code_verifier=", token_request.content.decode())
        replay = await self.web.get("/api/auth/callback", params={"state": state, "code": "one-time"})
        self.assertEqual(replay.status_code, 400)

    async def test_other_browser_cannot_consume_transaction(self):
        """Biết state vẫn không hoàn tất callback nếu thiếu cookie browser."""
        state, _ = await self.begin()
        self.web.cookies.clear()
        response = await self.web.get("/api/auth/callback", params={"state": state, "code": "one-time"})
        self.assertEqual(response.status_code, 400)
        self.assertIn(("transactions", state), self.store.values)

    async def test_invalid_nonce_expiry_audience_issuer_email_are_rejected(self):
        """Các claim quan trọng phải đúng trước khi có cookie phiên backend."""
        for override in ({"nonce": "wrong"}, {"exp": int(time.time())-10}, {"aud": "wrong"},
                         {"iss": "https://other.fixture"}, {"email_verified": False},
                         {"email": "user@other.fixture"}):
            with self.subTest(override=override):
                self.claim_overrides = override
                self.web.cookies.clear()
                state, _ = await self.begin()
                response = await self.web.get("/api/auth/callback", params={"state": state, "code": "one-time"})
                self.assertIn(response.status_code, (401, 403), response.text)
                self.assertIsNone(self.web.cookies.get("smartcall_session"))

    async def test_idp_logout_handoff_is_one_use_and_does_not_return_id_token_in_json(self):
        """Logout xác nhận CSRF rồi redirect cửa sổ qua ticket, không phát token qua API JSON."""
        info = await self.authenticated()
        headers = {"Origin": self.settings.public_origin, "X-CSRF-Token": info["csrf_token"]}
        bad = await self.web.post("/api/auth/idp-logout", headers={"Origin": self.settings.public_origin})
        self.assertEqual(bad.status_code, 403)
        response = await self.web.post("/api/auth/idp-logout", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("id_token", response.text)
        self.assertEqual((await self.web.get("/api/auth/user_info")).status_code, 401)
        redirect = await self.web.get(response.json()["redirect_url"])
        self.assertEqual(redirect.status_code, 302)
        target = urlsplit(redirect.headers["location"])
        self.assertEqual(target.netloc, "idp.fixture")
        self.assertEqual(target.path, "/end-session")
        params = parse_qs(target.query)
        self.assertIn("id_token_hint", params)
        self.assertEqual(params["post_logout_redirect_uri"], [self.settings.public_origin + "/logout"])
        self.assertEqual((await self.web.get("/api/auth/idp-logout/continue")).status_code, 400)

    async def test_idp_logout_missing_endpoint_keeps_session_for_retry(self):
        """Không giả báo logout thành công nếu IdP không công bố endpoint."""
        info = await self.authenticated()
        self.oidc.metadata_cache.pop("end_session_endpoint")
        response = await self.web.post("/api/auth/idp-logout", headers={"Origin": self.settings.public_origin, "X-CSRF-Token": info["csrf_token"]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual((await self.web.get("/api/auth/user_info")).status_code, 200)

    async def test_cached_profile_still_expires(self):
        """Có cache profile không vượt kiểm tra hạn phiên."""
        await self.authenticated()
        key = ("sessions", self.web.cookies.get("smartcall_session"))
        self.store.values[key]["expires_at"] = 0
        self.assertEqual((await self.web.get("/api/auth/user_info")).status_code, 401)

    async def test_post_requires_origin_csrf_and_logout_invalidates(self):
        """Không dùng cookie từ website khác hoặc CSRF sai để tạo tài khoản."""
        info = await self.authenticated()
        body = {"client_id": "web_fixture"}
        self.assertEqual((await self.web.post("/api/auth/wazo-session", json=body)).status_code, 403)
        headers = {"Origin": self.settings.public_origin, "X-CSRF-Token": "wrong"}
        self.assertEqual((await self.web.post("/api/auth/wazo-session", json=body, headers=headers)).status_code, 403)
        self.app.state.wazo.provision.assert_not_called()
        headers["X-CSRF-Token"] = info["csrf_token"]
        response = await self.web.post("/api/auth/logout", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((await self.web.get("/api/auth/user_info")).status_code, 401)

    async def test_logout_during_provision_revokes_new_wazo_session(self):
        """Phiên backend bị hủy giữa cấp phát thì token mới không được giao cho browser."""
        info = await self.authenticated()
        session_id = self.web.cookies.get("smartcall_session")
        result = {"token": "user-token", "user_uuid": "u1"}
        async def provision(session, client_id):
            await self.store.delete("sessions", session_id)
            return result
        self.app.state.wazo.provision.side_effect = provision
        response = await self.web.post("/api/auth/wazo-session", json={"client_id": "web_fixture"},
            headers={"Origin": self.settings.public_origin, "X-CSRF-Token": info["csrf_token"]})
        self.assertEqual(response.status_code, 401)
        self.app.state.wazo.revoke_session.assert_awaited_once_with(result, "web_fixture")


class ProvisionTests(unittest.IsolatedAsyncioTestCase):
    """Kiểm tra tạo user gộp, tìm email và thất bại an toàn bằng API fixture."""
    async def asyncSetUp(self):
        """Chuẩn bị một context, hai template, một số đã cấp."""
        self.settings = config(wazo_extension_min=2000, wazo_extension_max=2001)
        self.store = MemoryStore()
        self.users, self.calls, self.created_payloads = [], [], []
        self.context = "internal"
        self.templates = ["global", "webrtc"]
        self.identity = "https://idp.fixture\0employee1"
        self.session = dict(identity=self.identity, profile=dict(firstname="Tên", lastname="Họ Đệm",
            name="Họ Đệm Tên", email="employee@samsung.com", department="D", employee_id="EP1"))

        def upstream(request):
            self.calls.append(request)
            path, method = request.url.path, request.method
            if path == "/api/auth/0.1/token":
                # BasicAuth không cung cấp header công khai trên mọi phiên bản: so sánh username decode.
                import base64
                username = base64.b64decode(request.headers["authorization"].split()[1]).decode().split(":")[0]
                return httpx.Response(200, json={"data": {"token": "admin-token" if username == "fixture-admin" else "user-token",
                    "refresh_token": "user-refresh" if username != "fixture-admin" else "",
                    "metadata": {"pbx_user_uuid": "u1"}}})
            if method == "DELETE":
                return httpx.Response(204)
            if path == "/api/confd/1.1/users" and method == "GET":
                return httpx.Response(200, json={"items": self.users, "total": len(self.users)})
            if path == "/api/auth/0.1/users/u1":
                return httpx.Response(200, json={"username": self.users[0]["auth"]["username"]})
            if path.endswith("/lines/main/associated/endpoints/sip"):
                return httpx.Response(200, json={"uuid": "sip-uuid", "name": "legacy-endpoint",
                    "auth_section_options": [["username", "sip-employee"], ["password", "fixture-sip-secret"]]})
            if path == "/api/confd/1.1/endpoints/sip/sip-uuid" and method == "PUT":
                return httpx.Response(204)
            if path == "/api/confd/1.1/users/deleted":
                return httpx.Response(404)
            if path == "/api/confd/1.1/users/u1":
                if method == "PUT":
                    payload = json.loads(request.content)
                    assert set(payload) == {"description"}
                    self.users[0].update(payload)
                    return httpx.Response(204)
                return httpx.Response(200, json=self.users[0])
            if path.endswith("/contexts"):
                return httpx.Response(200, json={"items": [{"name": self.context}]})
            if path.endswith("/templates"):
                return httpx.Response(200, json={"items": [{"uuid": label, "label": label} for label in self.templates]})
            if path.endswith("/extensions"):
                return httpx.Response(200, json={"items": [{"exten": "2000", "context": "internal"}]})
            if path == "/api/confd/1.1/users" and method == "POST":
                body = json.loads(request.content)
                self.created_payloads.append(body)
                user = {**body, "uuid": "u1", "tenant_uuid": "tenant", "enabled": True}
                self.users.append(user)
                return httpx.Response(201, json=user)
            raise AssertionError(str(request.url))

        self.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.wazo = WazoClient(self.settings, self.http, self.store)

    async def asyncTearDown(self):
        """Đóng transport, không đụng tổng đài thật."""
        await self.http.aclose()

    async def test_create_then_retry_returns_user_token_and_never_duplicate(self):
        """Chọn số trống, giữ password test, SIP secret riêng và không trả token admin."""
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(result["token"], "user-token")
        self.assertEqual(result["user_uuid"], "u1")
        self.assertTrue(result["created"])
        body = self.created_payloads[0]
        self.assertEqual(body["description"], "D")
        self.assertEqual(body["auth"]["password"], "12345")
        self.assertEqual(body["auth"]["email_address"], self.session["profile"]["email"])
        self.assertEqual(body["lines"][0]["extensions"][0]["exten"], "2001")
        self.assertEqual(body["lines"][0]["endpoint_sip"]["templates"], [{"uuid": "global"}, {"uuid": "webrtc"}])
        sip_endpoint = body["lines"][0]["endpoint_sip"]
        self.assertEqual(sip_endpoint["name"], dict(sip_endpoint["auth_section_options"])["username"])
        self.assertNotEqual(sip_endpoint["auth_section_options"][1][1], "12345")
        again = await self.wazo.provision(self.session, "web_fixture")
        self.assertFalse(again["created"])
        self.assertEqual(len(self.created_payloads), 1)
        self.assertFalse(self.store.gate.acquired)

    async def test_new_auth_username_is_email_local_part(self):
        """Email có dấu chấm/số được lấy nguyên local-part, không còn tiền tố sso_ hay hash."""
        self.session["profile"]["email"] = "  VHung99.Nguyen@Samsung.com  "
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(result["username"], "vhung99.nguyen")
        self.assertEqual(self.created_payloads[0]["auth"]["username"], "vhung99.nguyen")
        self.assertEqual(self.store.links[(self.identity, "tenant")]["username"], "vhung99.nguyen")

    async def test_existing_mapping_keeps_legacy_username(self):
        """Đổi quy tắc tạo mới không làm user sso_ đã liên kết mất quyền đăng nhập."""
        self.users = [{"uuid": "u1", "email": self.session["profile"]["email"], "enabled": True}]
        self.store.links[(self.identity, "tenant")] = dict(user_uuid="u1", username="sso_legacy", managed=True)
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(result["username"], "sso_legacy")
        self.assertEqual(self.created_payloads, [])

    async def test_recovered_managed_user_reads_real_auth_username(self):
        """Mất mapping không được đoán username mới cho user tạo bằng quy tắc hash trước đây."""
        marker = "smartcall:sso:" + hashlib.sha256(self.identity.encode()).hexdigest()
        self.users = [{"uuid": "u1", "email": self.session["profile"]["email"], "enabled": True,
                       "userfield": marker, "auth": {"username": "sso_legacy"}}]
        original_request = self.wazo.request

        async def omit_inline_auth(method, path, **kwargs):
            # GET danh sách trên server có thể không trả trường auth, buộc tra theo UUID.
            if method == "GET" and path == "/api/confd/1.1/users":
                return {"items": [{key: value for key, value in self.users[0].items() if key != "auth"}], "total": 1}
            return await original_request(method, path, **kwargs)

        self.wazo.request = omit_inline_auth
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(result["username"], "sso_legacy")
        self.assertEqual(self.created_payloads, [])

    async def test_invalid_email_stops_before_user_creation(self):
        """Không tạo username rỗng hoặc nhận email có khoảng trắng bên trong."""
        for email in ("@samsung.com", "employee", "em ployee@samsung.com", "a@b@samsung.com"):
            with self.subTest(email=email), self.assertRaises(HTTPException) as caught:
                self.session["profile"]["email"] = email
                await self.wazo.provision(self.session, "web_fixture")
            self.assertEqual(caught.exception.detail["code"], "WAZO_EMAIL_INVALID")
        self.assertEqual(self.created_payloads, [])

    async def test_create_conflict_never_links_by_username(self):
        """Username hoặc số bị Wazo từ chối phải dừng, không nhận tài khoản khác cùng username."""
        async def conflict(request):
            return httpx.Response(409, json={"error": "already exists"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(conflict)) as conflict_client:
            self.wazo.client = conflict_client
            with self.assertRaises(HTTPException) as caught:
                await self.wazo.request("POST", "/api/confd/1.1/users", token="admin-token", json={})
        self.assertEqual(caught.exception.detail["code"], "WAZO_CREATE_CONFLICT")
        self.assertEqual(self.store.links, {})

    async def test_deleted_user_mapping_is_replaced_after_creation(self):
        """404 user cụ thể cho phép tạo lại và thay binding cũ, không xóa mapping trước POST."""
        self.store.links[(self.identity, "tenant")] = dict(user_uuid="deleted", username="sso_old", managed=True)
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertTrue(result["created"])
        self.assertEqual(self.store.links[(self.identity, "tenant")]["user_uuid"], "u1")
        self.assertEqual(self.store.links[(self.identity, "tenant")]["username"], "employee")

    async def test_managed_existing_endpoint_name_is_repaired_without_credentials(self):
        """User quản lý cũ chỉ được sửa name endpoint, không PUT password/template."""
        self.store.links[(self.identity, "tenant")] = dict(user_uuid="u1", username="sso_old", managed=True)
        self.users = [{"uuid": "u1", "enabled": True}]
        await self.wazo.provision(self.session, "web_fixture")
        writes = [request for request in self.calls if request.method == "PUT" and "/endpoints/sip/" in request.url.path]
        self.assertEqual(len(writes), 1)
        self.assertEqual(json.loads(writes[0].content), {"name": "sip-employee"})

    async def test_mapped_lookup_forbidden_keeps_mapping_and_never_creates(self):
        """403 không được biến thành 404 để cấp tài khoản khác."""
        self.store.links[(self.identity, "tenant")] = dict(user_uuid="u1", username="old", managed=True)
        async def forbidden(request):
            if request.url.path == "/api/auth/0.1/token" and request.method == "POST":
                return httpx.Response(200, json={"data": {"token": "admin-token"}})
            return httpx.Response(403)
        async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as client:
            self.wazo.client = client
            with self.assertRaises(HTTPException):
                await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(self.created_payloads, [])
        self.assertEqual(self.store.links[(self.identity, "tenant")]["user_uuid"], "u1")

    async def test_existing_account_is_not_reset_or_recreated(self):
        """Tài khoản cũ cần linking, không tự đổi password/line."""
        self.users = [{"uuid": "u1", "email": self.session["profile"]["email"], "enabled": True}]
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_ACCOUNT_LINK_REQUIRED")
        self.assertEqual(self.created_payloads, [])
        self.assertFalse(any(r.method in ("PUT", "PATCH") for r in self.calls))

    async def test_context_template_pool_errors_stop_before_create(self):
        """Sai tài nguyên hoặc hết số không được tạo tài khoản dở dang."""
        for context, templates, maximum, expected in [
            ("other", ["global", "webrtc"], 2001, "WAZO_CONTEXT_NOT_FOUND"),
            ("internal", ["global"], 2001, "WAZO_TEMPLATE_NOT_FOUND"),
            ("internal", ["global", "webrtc"], 2000, "WAZO_EXTENSION_POOL_EMPTY")]:
            with self.subTest(expected=expected):
                self.context, self.templates = context, templates
                self.settings.wazo_extension_max = maximum
                with self.assertRaises(HTTPException) as caught:
                    await self.wazo.provision(self.session, "web_fixture")
                self.assertEqual(caught.exception.detail["code"], expected)
                self.assertFalse(self.store.gate.acquired)
        self.assertEqual(self.created_payloads, [])

    async def test_busy_lock_and_missing_admin_do_not_call_create(self):
        """Mất cấu hình/khóa thì dừng thay vì gọi API bằng quyền mặc định."""
        self.store.gate.available = False
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_PROVISION_BUSY")
        self.settings.wazo_admin_password = ""
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_NOT_CONFIGURED")
        self.assertEqual(self.calls, [])

    async def test_existing_login_opt_in_uses_existing_username_and_never_resets(self):
        """Khi bật rõ ràng, chỉ thử password cấu hình trên username của tài khoản cũ."""
        self.settings.wazo_existing_password_login = True
        self.users = [{"uuid": "u1", "email": self.session["profile"]["email"],
                       "enabled": True, "auth": {"username": "existing_user"}}]
        result = await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(result["username"], "existing_user")
        self.assertFalse(result["created"])
        self.assertEqual(self.created_payloads, [])
        writes = [json.loads(request.content) for request in self.calls if request.method == "PUT"]
        self.assertEqual(writes, [{"description": "D"}])

    async def test_email_lookup_failure_does_not_become_create(self):
        """HTTP 403/timeout khi tra cứu phải dừng, không được hiểu là chưa có tài khoản."""
        self.wazo.find_email = AsyncMock(side_effect=HTTPException(502, detail={"code": "LOOKUP_FAILED"}))
        with self.assertRaises(HTTPException):
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(self.created_payloads, [])
        self.assertFalse(self.store.gate.acquired)

    async def test_wrong_token_identity_is_not_delivered(self):
        """Không đưa token có quyền/danh tính khác xuống frontend."""
        original = self.wazo.token
        async def wrong_user(username, password, client_id, user=True):
            if not user:
                return await original(username, password, client_id, user=False)
            return {"token": "wrong", "metadata": {"pbx_user_uuid": "someone-else"}}
        self.wazo.token = wrong_user
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_IDENTITY_MISMATCH")

    async def test_read_queries_use_recurse_and_never_full_view(self):
        """Các API đọc tài nguyên dùng recurse=true, không còn view=full gây HTTP 400."""
        await self.wazo.provision(self.session, "web_fixture")
        reads = [request for request in self.calls
                 if request.method == "GET" and request.url.path.startswith("/api/confd/")]
        self.assertTrue(reads)
        for request in reads:
            self.assertEqual(request.url.params.get("recurse"), "true")
            self.assertNotIn("view", request.url.params)
            self.assertEqual(request.headers["Wazo-Tenant"], "tenant")

    async def test_auth_tenant_is_independent_of_resource_target(self):
        """Không ép tenant đích vào request xin token của admin ở tenant cha."""
        await self.wazo.provision(self.session, "web_fixture")
        token_requests = [request for request in self.calls
                          if request.url.path == "/api/auth/0.1/token"]
        self.assertNotIn("Wazo-Tenant", token_requests[0].headers)
        self.settings.wazo_auth_tenant_uuid = "parent-tenant"
        await self.wazo.token("fixture-admin", "fixture-secret", "fixture", user=False)
        self.assertEqual(self.calls[-1].headers["Wazo-Tenant"], "parent-tenant")

    async def test_context_user_ranges_limit_the_random_pool(self):
        """Kho cấu hình rộng vẫn không cấp số ngoài user_ranges của context."""
        self.settings.wazo_extension_max = 9999
        original = self.wazo.list_items

        async def with_ranges(path, token, **params):
            items = await original(path, token, **params)
            if path.endswith("/contexts"):
                return [{"name": "internal", "tenant_uuid": "tenant",
                         "user_ranges": [{"start": "2000", "end": "2001"}]}]
            return items

        self.wazo.list_items = with_ranges
        await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(self.created_payloads[0]["lines"][0]["extensions"][0]["exten"], "2001")

    async def test_pool_outside_context_ranges_does_not_create(self):
        """Kho số không giao user_ranges phải dừng trước POST."""
        original = self.wazo.list_items

        async def disjoint_ranges(path, token, **params):
            if path.endswith("/contexts"):
                return [{"name": "internal", "tenant_uuid": "tenant",
                         "user_ranges": [{"start": "1000", "end": "1999"}]}]
            return await original(path, token, **params)

        self.wazo.list_items = disjoint_ranges
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_EXTENSION_POOL_EMPTY")
        self.assertEqual(self.created_payloads, [])

    async def test_same_email_in_other_tenant_is_not_linked_or_duplicated(self):
        """Đọc đệ quy không được liên kết nhầm tài khoản ở tenant con/khác."""
        self.users = [{"uuid": "foreign-user", "email": self.session["profile"]["email"],
                       "tenant_uuid": "other-tenant", "enabled": True}]
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_EMAIL_OTHER_TENANT")
        self.assertEqual(self.created_payloads, [])

    async def test_context_in_other_tenant_does_not_authorize_create(self):
        """Trùng tên context ở tenant khác vẫn không được cấp user vào tenant đích."""
        original = self.wazo.list_items

        async def foreign_context(path, token, **params):
            if path.endswith("/contexts"):
                return [{"name": "internal", "tenant_uuid": "other-tenant"}]
            return await original(path, token, **params)

        self.wazo.list_items = foreign_context
        with self.assertRaises(HTTPException) as caught:
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(caught.exception.detail["code"], "WAZO_CONTEXT_NOT_FOUND")
        self.assertEqual(self.created_payloads, [])

    async def test_existing_single_id_login_updates_only_description(self):
        """Tài khoản đã tạo cũng nhận department mới, giữ username/password/line."""
        await self.wazo.provision(self.session, "web_fixture")
        self.session["profile"]["department"] = "  AI   Transformation Part(SDV) "
        self.calls.clear()
        await self.wazo.provision(self.session, "web_fixture")
        updates = [request for request in self.calls if request.method == "PUT" and request.url.path.endswith("/users/u1")]
        self.assertEqual(len(updates), 1)
        self.assertEqual(json.loads(updates[0].content), {"description": "AI Transformation Part(SDV)"})
        self.assertEqual(updates[0].headers["Wazo-Tenant"], "tenant")
        self.assertEqual(self.users[0]["description"], "AI Transformation Part(SDV)")
        self.assertEqual(len(self.created_payloads), 1)

    async def test_unchanged_department_does_not_write(self):
        """Đăng nhập lặp lại không cần PUT description đã đúng."""
        await self.wazo.synchronize_department_description({"uuid": "u1", "description": "D"}, self.session["profile"], "admin-token")
        self.assertEqual(self.calls, [])

    async def test_missing_department_does_not_erase_description(self):
        """IdP thiếu bộ phận thì giữ nội dung mô tả đang có trên Wazo."""
        await self.wazo.synchronize_department_description({"uuid": "u1", "description": "Existing"}, {"department": "  "}, "admin-token")
        self.assertEqual(self.calls, [])

    async def test_description_update_failure_revokes_new_user_token(self):
        """Không trả token như đã hoàn tất khi PUT bị từ chối; thu hồi token vừa xin."""
        await self.wazo.provision(self.session, "web_fixture")
        self.session["profile"]["department"] = "Changed"
        original = self.wazo.request
        async def reject_update(method, path, **kwargs):
            if method == "PUT" and path.endswith("/users/u1"):
                raise HTTPException(502, detail={"code": "WAZO_REQUEST_FAILED"})
            return await original(method, path, **kwargs)
        self.wazo.request = reject_update
        with self.assertRaises(HTTPException):
            await self.wazo.provision(self.session, "web_fixture")
        self.assertEqual(self.users[0]["description"], "D")
        self.assertTrue(any(request.method == "DELETE" and request.url.path.endswith("/token/user-token") for request in self.calls))

    async def test_mismatched_user_token_does_not_update_existing_description(self):
        """Không sửa department nếu token xin được không thuộc UUID đang liên kết."""
        self.settings.wazo_existing_password_login = True
        self.users = [{"uuid": "u1", "email": self.session["profile"]["email"], "description": "Old",
                       "enabled": True, "auth": {"username": "employee"}}]
        original = self.wazo.token
        async def wrong_token(username, password, client_id, user=True):
            if not user:
                return await original(username, password, client_id, user=False)
            return {"token": "wrong", "metadata": {"pbx_user_uuid": "different-user"}}
        self.wazo.token = wrong_token
        with self.assertRaises(HTTPException):
            await self.wazo.provision(self.session, "web_fixture")
        self.assertFalse(any(request.method == "PUT" for request in self.calls))
        self.assertEqual(self.users[0]["description"], "Old")

    async def test_sqlite_replace_mapping_requires_expected_uuid(self):
        """DB thật chỉ thay UUID đã đọc; concurrent edit không bị ghi đè."""
        with tempfile.TemporaryDirectory() as directory:
            store = Store(config(database_path=Path(directory) / "identity.sqlite3"))
            await store.mapping("identity", "tenant", dict(user_uuid="old", username="old-name", managed=True))
            value = dict(user_uuid="new", username="employee", managed=True)
            await store.replace_mapping("identity", "tenant", "old", value)
            self.assertEqual((await store.mapping("identity", "tenant"))["user_uuid"], "new")
            with self.assertRaises(HTTPException) as caught:
                await store.replace_mapping("identity", "tenant", "old", dict(value, user_uuid="wrong"))
            self.assertEqual(caught.exception.detail["code"], "WAZO_MAPPING_CHANGED")
            self.assertEqual((await store.mapping("identity", "tenant"))["user_uuid"], "new")
            await store.redis.aclose()

    async def test_existing_correct_sip_name_is_not_rewritten(self):
        """Endpoint khớp rồi thì không PUT để tránh reconfigure không cần thiết."""
        original = self.wazo.request
        async def correct_endpoint(method, path, **kwargs):
            if path.endswith("/lines/main/associated/endpoints/sip"):
                return {"uuid": "sip-uuid", "name": "sip-employee", "auth_section_options": [["username", "sip-employee"]]}
            return await original(method, path, **kwargs)
        self.wazo.request = correct_endpoint
        await self.wazo.repair_managed_sip_name("u1", "admin-token")
        self.assertFalse(any(request.method == "PUT" for request in self.calls))

    async def test_sqlite_unique_identity_and_no_secret_columns(self):
        """Mapping SQLite thật không cho cùng user_uuid thuộc hai danh tính."""
        with tempfile.TemporaryDirectory() as directory:
            settings = config(database_path=Path(directory) / "identity.sqlite3")
            store = Store(settings)
            value = dict(user_uuid="u1", username="fixture", managed=True)
            await store.mapping("id1", "tenant", value)
            self.assertEqual((await store.mapping("id1", "tenant"))["username"], "fixture")
            with self.assertRaises(sqlite3.IntegrityError):
                await store.mapping("id2", "tenant", value)
            await store.redis.aclose()


if __name__ == "__main__":
    unittest.main()
