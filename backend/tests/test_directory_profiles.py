"""Kiểm thử hồ sơ/avatar dùng chung với SQLite thật và upstream giả, không gọi ảnh nhân viên thật."""
import sys
from pathlib import Path
import tempfile
import unittest
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import Settings
from main import create_app
from store import Store
from wazo import WazoClient


class DirectoryProfileTests(unittest.IsolatedAsyncioTestCase):
    """Ảnh/hồ sơ chỉ dành cho phiên Wazo đúng tenant; EP ID không công khai trong danh bạ."""
    async def asyncSetUp(self):
        """Dựng database tạm và mock token/HTTP image."""
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(_env_file=None, wazo_url="https://wazo.fixture", wazo_tenant_uuid="tenant",
            employee_photo_url="http://photos.fixture/tinythumb", database_path=Path(self.directory.name) / "identity.sqlite3")
        self.store = Store(self.settings)
        self.tenant = "tenant"
        self.photo_type, self.photo_body = "image/png", b"fixture-image"
        self.calls = []

        def upstream(request):
            self.calls.append(request)
            if request.url.host == "wazo.fixture":
                if request.url.path.endswith("bad-token"):
                    return httpx.Response(404)
                return httpx.Response(200, json={"data": {"tenant_uuid": self.tenant,
                    "metadata": {"pbx_user_uuid": "viewer"}}})
            if request.url.host == "photos.fixture":
                return httpx.Response(200, headers={"content-type": self.photo_type}, content=self.photo_body)
            raise AssertionError("unexpected upstream")

        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.upstream.cookies.set("shared-cookie", "never-forward", domain="photos.fixture")
        app = create_app(self.settings)
        app.state.store = self.store
        app.state.wazo = WazoClient(self.settings, self.upstream, self.store)
        self.web = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://localhost:8800")
        await self.store.save_directory_profile("tenant", "issuer\0subject", "employee", {
            "name": "Employee", "department": "  AI   Transformation Part(SDV) ", "employee_id": "EP123"})
        await self.store.save_directory_profile("other-tenant", "issuer\0other", "foreign", {
            "name": "Other", "department": "Other", "employee_id": "PRIVATE"})

    async def asyncTearDown(self):
        """Đóng handle trước khi xóa database tạm trên Windows."""
        await self.web.aclose()
        await self.upstream.aclose()
        await self.store.redis.aclose()
        self.directory.cleanup()

    async def test_shared_profiles_are_tenant_scoped_without_employee_id(self):
        """User khác cùng tenant nhận dept chuẩn hóa nhưng không nhận EP ID/identity."""
        response = await self.web.get("/api/auth/directory-profiles", params=[("user_uuid", "employee"), ("user_uuid", "foreign")],
                                      headers={"X-Auth-Token": "valid-token"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["items"], [{"user_uuid": "employee", "name": "Employee",
            "department": "AI Transformation Part(SDV)", "has_avatar": True}])
        self.assertNotIn("EP123", response.text)
        self.assertNotIn("subject", response.text)

    async def test_avatar_proxy_uses_stored_epid_without_credentials(self):
        """Proxy nhận UUID, tự lấy EP ID; không chuyển auth token/cookie sang host ảnh."""
        response = await self.web.get("/api/auth/directory-profiles/employee/avatar", headers={"X-Auth-Token": "valid-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.photo_body)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(response.headers["cache-control"], "no-store")
        request = self.calls[-1]
        self.assertEqual(request.url.params["epid"], "EP123")
        for header in ("X-Auth-Token", "Authorization", "Cookie"):
            self.assertNotIn(header, request.headers)

    async def test_missing_expired_and_other_tenant_tokens_cannot_read_photo(self):
        """Không có cookie IdP không phải lý do mở ảnh công khai; phải có token Wazo hợp lệ."""
        path = "/api/auth/directory-profiles/employee/avatar"
        self.assertEqual((await self.web.get(path)).status_code, 401)
        self.assertEqual((await self.web.get(path, headers={"X-Auth-Token": "bad-token"})).status_code, 401)
        self.tenant = "other-tenant"
        self.assertEqual((await self.web.get(path, headers={"X-Auth-Token": "valid-token"})).status_code, 403)
        self.assertFalse(any(request.url.host == "photos.fixture" for request in self.calls))

    async def test_html_svg_and_oversized_photo_are_not_forwarded(self):
        """Ảnh không hợp lệ không được biến thành nội dung Web chủ động."""
        for media_type, content, expected in (("text/html", b"login page", 404),
                ("image/svg+xml", b"<svg/>", 404), ("image/png", b"x" * (2 * 1024 * 1024 + 1), 502)):
            with self.subTest(media_type=media_type, expected=expected):
                self.photo_type, self.photo_body = media_type, content
                response = await self.web.get("/api/auth/directory-profiles/employee/avatar", headers={"X-Auth-Token": "valid-token"})
                self.assertEqual(response.status_code, expected)

    async def test_profile_is_moved_when_identity_gets_new_wazo_uuid(self):
        """Tạo lại user không để avatar/department ở UUID cũ của cùng danh tính."""
        await self.store.save_directory_profile("tenant", "issuer\0subject", "new-employee", {
            "name": "Employee", "department": "New Department", "employee_id": "EP123"})
        profiles = await self.store.directory_profiles("tenant", ["employee", "new-employee"])
        self.assertEqual([profile["user_uuid"] for profile in profiles], ["new-employee"])

    async def test_batch_is_limited_and_foreign_avatar_is_not_found(self):
        """Giới hạn batch không cho tải DB tùy ý; UUID tenant khác không đọc được ảnh."""
        response = await self.web.get("/api/auth/directory-profiles", params=[("user_uuid", str(index)) for index in range(101)],
                                      headers={"X-Auth-Token": "valid-token"})
        self.assertEqual(response.status_code, 422)
        response = await self.web.get("/api/auth/directory-profiles/foreign/avatar", headers={"X-Auth-Token": "valid-token"})
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
