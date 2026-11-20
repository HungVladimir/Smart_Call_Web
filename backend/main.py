"""API Single ID của SmartCall. Chạy: uvicorn main:app --host 127.0.0.1 --port 8801."""
from contextlib import asynccontextmanager
import sqlite3
import secrets
import ssl
import time
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
from config import Settings
from store import Store
from oidc import OidcClient, fail
from wazo import WazoClient


def create_app(settings=None):
    """Lắp ghép cấu hình/adapter; cho phép test thay HTTP/Redis mà không gọi hạ tầng thật."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        """Dùng chung pool HTTP/Redis và luôn đóng tài nguyên khi tắt backend."""
        verify = ssl.create_default_context(cafile=settings.tls_ca_file or None)
        async with httpx.AsyncClient(trust_env=False, verify=verify, timeout=15, follow_redirects=False) as client:
            app.state.store = Store(settings)
            app.state.oidc = OidcClient(settings, client)
            app.state.wazo = WazoClient(settings, client, app.state.store)
            try:
                yield
            finally:
                await app.state.store.redis.aclose()

    app = FastAPI(title="SmartCall Backend", lifespan=lifespan)

    @app.middleware("http")
    async def protect_response(request, call_next):
        """Không cache hồ sơ/token; Origin chặn POST từ website khác trước khi xử lý."""
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("origin") != settings.public_origin:
            return JSONResponse({"detail": {"code": "ORIGIN_INVALID", "message": "Origin không hợp lệ."}}, status_code=403)
        response = await call_next(request)
        response.headers.update({"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer"})
        return response

    @app.exception_handler(httpx.HTTPError)
    async def upstream_failure(request, error):
        """Không phản chiếu URL/token upstream trong lỗi gửi về trình duyệt."""
        return JSONResponse({"detail": {"code": "UPSTREAM_UNAVAILABLE",
            "message": "Không kết nối được IdP/Wazo. Kiểm tra mạng, CA và cấu hình backend."}}, status_code=502)

    @app.exception_handler(RedisError)
    async def redis_failure(request, error):
        """Mất Redis thì từ chối phiên, không dùng dữ liệu phiên cũ hoặc bỏ qua xác thực."""
        return JSONResponse({"detail": {"code": "SESSION_STORE_UNAVAILABLE",
            "message": "Không truy cập được Redis quản lý phiên."}}, status_code=503)

    @app.exception_handler(sqlite3.IntegrityError)
    async def identity_conflict(request, error):
        """Không để hai danh tính chiếm cùng một tài khoản Wazo."""
        return JSONResponse({"detail": {"code": "IDENTITY_CONFLICT",
            "message": "Tài khoản Wazo đã được liên kết với danh tính khác."}}, status_code=409)

    async def require_session(request, csrf=False):
        """Kiểm tra hạn phiên server mỗi request, kể cả profile đã được cache."""
        session = await app.state.store.get("sessions", request.cookies.get("smartcall_session"))
        if not session or session["expires_at"] <= time.time():
            fail("SESSION_EXPIRED", "Phiên Single ID không tồn tại hoặc đã hết hạn. Vui lòng đăng nhập lại.", 401)
        if csrf and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf_token"]):
            fail("CSRF_INVALID", "Yêu cầu không thuộc phiên hiện tại.", 403)
        return session

    @app.get("/api/health")
    async def health():
        """Kiểm tra tiến trình; không tiết lộ cấu hình/credential."""
        return {"status": "ok"}

    @app.get("/api/auth/login")
    async def login(request: Request):
        """Chuyển cửa sổ tới authorization endpoint, gắn cookie giao dịch riêng cho browser."""
        state, transaction, location = await app.state.oidc.begin()
        await app.state.store.put("transactions", state, transaction, 300)
        response = RedirectResponse(location, status_code=302)
        response.set_cookie("smartcall_oidc_state", state, httponly=True, secure=settings.secure_cookie,
                            samesite="lax", max_age=300, path="/api/auth")
        return response

    @app.get("/api/auth/callback")
    async def callback(request: Request):
        """Chỉ nhận callback đúng browser/state; hoàn tất OIDC trước khi cấp session ID riêng."""
        state = request.query_params.get("state", "")
        cookie_state = request.cookies.get("smartcall_oidc_state", "")
        if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
            fail("STATE_INVALID", "Callback không thuộc trình duyệt bắt đầu đăng nhập.", 400)
        transaction = await app.state.store.get("transactions", state, consume=True)
        if not transaction:
            fail("STATE_EXPIRED", "Giao dịch đăng nhập hết hạn hoặc đã sử dụng.", 400)
        if request.query_params.get("error"):
            response = RedirectResponse(settings.public_origin + "/callback?error=idp_denied", status_code=302)
            response.delete_cookie("smartcall_oidc_state", path="/api/auth")
            return response
        code = request.query_params.get("code")
        if not code:
            fail("CODE_MISSING", "IdP chưa trả authorization code.", 400)
        session, ttl = await app.state.oidc.finish(code, transaction)
        session_id = secrets.token_urlsafe(48)
        await app.state.store.put("sessions", session_id, session, ttl)
        # Xoay phiên ứng dụng khi đổi tài khoản; không dùng session_state của IdP làm cookie.
        await app.state.store.delete("sessions", request.cookies.get("smartcall_session"))
        response = RedirectResponse(settings.public_origin + "/callback", status_code=302)
        response.delete_cookie("smartcall_oidc_state", path="/api/auth")
        response.set_cookie("smartcall_session", session_id, httponly=True, secure=settings.secure_cookie,
                            samesite="lax", max_age=ttl, path="/api/auth")
        return response

    @app.get("/api/auth/user_info")
    async def user_info(request: Request):
        """Chỉ trả profile và CSRF token; không trả access/refresh/ID token của IdP."""
        session = await require_session(request)
        mapping = (await app.state.store.mapping(session["identity"], settings.wazo_tenant_uuid)
                   if settings.wazo_tenant_uuid else None)
        return {"profile": session["profile"], "csrf_token": session["csrf_token"],
                "wazo_user_uuid": mapping["user_uuid"] if mapping else None,
                "expires_at": session["expires_at"]}

    @app.post("/api/auth/wazo-session")
    async def wazo_session(body: WazoSessionRequest, request: Request):
        """Tìm/tạo tài khoản và trả token người dùng Wazo sau xác thực cookie + CSRF."""
        session = await require_session(request, csrf=True)
        result = await app.state.wazo.provision(session, body.client_id)
        # Cấp phát có thể mất thời gian; phiên bị logout/hết hạn không được nhận token mới.
        try:
            current = await require_session(request, csrf=True)
            if current["identity"] != session["identity"]:
                fail("SESSION_CHANGED", "Phiên đã thay đổi trong lúc cấp tài khoản.", 401)
        except Exception:
            try:
                await app.state.wazo.revoke_session(result, body.client_id)
            except Exception:
                pass  # Không giao credential ra ngoài; token vẫn có thời hạn phía Wazo.
            raise
        return result

    @app.post("/api/auth/logout")
    async def logout(request: Request):
        """Hủy phiên SmartCall backend; SDK frontend phụ trách thu hồi phiên Wazo của nó."""
        await require_session(request, csrf=True)
        await app.state.store.delete("sessions", request.cookies.get("smartcall_session"))
        response = JSONResponse({"status": "logged_out"})
        response.delete_cookie("smartcall_session", path="/api/auth")
        return response

    return app


class WazoSessionRequest(BaseModel):
    """Chỉ nhận mã client; không nhận email/quyền/UUID tin tưởng từ trình duyệt."""
    client_id: str = Field(min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


app = create_app()
