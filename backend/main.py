"""API Single ID của SmartCall. Chạy: uvicorn main:app --host 127.0.0.1 --port 8801."""
from contextlib import asynccontextmanager
import sqlite3
import secrets
import ssl
import time
from uuid import UUID
import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis.exceptions import RedisError
from config import Settings
from store import Store
from oidc import OidcClient, fail
from wazo import WazoClient
from directory import Directory, department_name, normalize, public_contact, search_contacts, search_page
from call_groups import CallGroupInput, call_groups


# Lắp ghép cấu hình/adapter; cho phép test thay HTTP/Redis mà không gọi hạ tầng thật.
def create_app(settings=None):
    settings = settings or Settings()

    # Dùng chung pool HTTP/Redis và luôn đóng tài nguyên khi tắt backend.
    @asynccontextmanager
    async def lifespan(app):
        verify = ssl.create_default_context(cafile=settings.tls_ca_file or None)
        async with httpx.AsyncClient(trust_env=False, verify=verify, timeout=15, follow_redirects=False) as client:
            app.state.store = Store(settings)
            app.state.oidc = OidcClient(settings, client)
            app.state.wazo = WazoClient(settings, client, app.state.store)
            app.state.directory = Directory(app.state.wazo)
            try:
                yield
            finally:
                await app.state.store.redis.aclose()

    app = FastAPI(title="SmartCall Backend", lifespan=lifespan)

    # Không cache hồ sơ/token; Origin chặn POST từ website khác trước khi xử lý.
    @app.middleware("http")
    async def protect_response(request, call_next):
        origin = request.headers.get("origin")
        # Postman và App gọi wrapper hoặc đăng ký bằng header key riêng, không dùng cookie hay Origin.
        native_client_route = request.method == "POST" and request.url.path in ("/api/wrapper", "/api/register")
        wrapper_from_native_client = native_client_route and origin is None
        if (request.method not in ("GET", "HEAD", "OPTIONS")
                and origin != settings.public_origin and not wrapper_from_native_client):
            return JSONResponse({"detail": {"code": "ORIGIN_INVALID", "message": "Origin không hợp lệ."}}, status_code=403)
        response = await call_next(request)
        response.headers.update({"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer"})
        return response

    # Không phản chiếu URL/token upstream trong lỗi gửi về trình duyệt.
    @app.exception_handler(httpx.HTTPError)
    async def upstream_failure(request, error):
        return JSONResponse({"detail": {"code": "UPSTREAM_UNAVAILABLE",
            "message": "Không kết nối được IdP/Wazo. Kiểm tra mạng, CA và cấu hình backend."}}, status_code=502)

    # Mất Redis thì từ chối phiên, không dùng dữ liệu phiên cũ hoặc bỏ qua xác thực.
    @app.exception_handler(RedisError)
    async def redis_failure(request, error):
        return JSONResponse({"detail": {"code": "SESSION_STORE_UNAVAILABLE",
            "message": "Không truy cập được Redis quản lý phiên."}}, status_code=503)

    # Không để hai danh tính chiếm cùng một tài khoản Wazo.
    @app.exception_handler(sqlite3.IntegrityError)
    async def identity_conflict(request, error):
        return JSONResponse({"detail": {"code": "IDENTITY_CONFLICT",
            "message": "Tài khoản Wazo đã được liên kết với danh tính khác."}}, status_code=409)

    # Kiểm tra hạn phiên server mỗi request, kể cả profile đã được cache.
    async def require_session(request, csrf=False):
        session = await app.state.store.get("sessions", request.cookies.get("smartcall_session"))
        if not session or session["expires_at"] <= time.time():
            fail("SESSION_EXPIRED", "Phiên Single ID không tồn tại hoặc đã hết hạn. Vui lòng đăng nhập lại.", 401)
        if csrf and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf_token"]):
            fail("CSRF_INVALID", "Yêu cầu không thuộc phiên hiện tại.", 403)
        return session

    # Kiểm tra tiến trình; không tiết lộ cấu hình/credential.
    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    # Xác thực key trước khi thực hiện bất kỳ request quản trị nào sang Wazo.
    def require_wrapper_key(supplied_key):
        configured_key = settings.wazo_wrapper_test_key
        if not configured_key:
            fail("WRAPPER_DISABLED", "API wrapper thử nghiệm chưa được bật.", 404)
        # So sánh theo byte để từ chối an toàn cả khi client gửi ký tự ngoài ASCII.
        if not secrets.compare_digest(supplied_key.encode(), configured_key.encode()):
            fail("WRAPPER_KEY_INVALID", "Key thử nghiệm không hợp lệ.", 401)

    # Tương thích với phép thử đọc context qua GET.
    @app.get("/api/wrapper/contexts")
    async def wrapper_contexts(request: Request, x_smartcall_test_key: str = Header("", max_length=256),
                               limit: int = Query(30, ge=1, le=50),
                               offset: int = Query(0, ge=0, le=10000)):
        require_wrapper_key(x_smartcall_test_key)
        return await request.app.state.wazo.list_wrapper_contexts(limit, offset)

    # Điều phối lệnh đã kiểm tra. Backend tự chọn token admin, tenant, host và URL gọi Wazo.
    @app.post("/api/wrapper")
    async def wrapper_command(command: WazoWrapperCommand, request: Request,
                              x_smartcall_test_key: str = Header("", max_length=256)):
        require_wrapper_key(x_smartcall_test_key)
        method = command.method.strip().upper()
        if (method, command.path) == ("GET", "/api/confd/1.1/contexts"):
            if command.body is not None:
                fail("WRAPPER_INVALID_BODY", "Yêu cầu GET không nhận body JSON.", 422)
            try:
                page_query = WazoWrapperQuery.model_validate(command.query)
            except ValidationError as error:
                raise HTTPException(422, detail=error.errors()) from None
            return await request.app.state.wazo.list_wrapper_contexts(page_query.limit, page_query.offset)
        status_code, payload = await request.app.state.wazo.execute_wrapper(
            method, command.path, command.query, command.body,
        )
        return JSONResponse(payload, status_code=status_code)

    # Tạo tài khoản mới cho Web/Android bằng quyền quản trị rồi đăng nhập trả user token.
    @app.post("/api/register")
    async def register_account(body: RegisterUserRequest, request: Request,
                               x_smartcall_test_key: str = Header("", max_length=256)):
        require_wrapper_key(x_smartcall_test_key)
        return await request.app.state.wazo.register_user(body)

    # Chuyển cửa sổ tới authorization endpoint, gắn cookie giao dịch riêng cho browser.
    @app.get("/api/auth/login")
    async def login(request: Request):
        state, transaction, location = await app.state.oidc.begin()
        await app.state.store.put("transactions", state, transaction, 300)
        response = RedirectResponse(location, status_code=302)
        response.set_cookie("smartcall_oidc_state", state, httponly=True, secure=settings.secure_cookie,
                            samesite="lax", max_age=300, path="/api/auth")
        return response

    # Chỉ nhận callback đúng browser/state; hoàn tất OIDC trước khi cấp session ID riêng.
    @app.get("/api/auth/callback")
    async def callback(request: Request):
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

    # Chỉ trả profile và CSRF token; không trả access/refresh/ID token của IdP.
    @app.get("/api/auth/user_info")
    async def user_info(request: Request):
        session = await require_session(request)
        mapping = None
        if settings.wazo_tenant_uuid:
            mapping = await app.state.store.mapping(session["identity"], settings.wazo_tenant_uuid)
        return {"profile": session["profile"], "csrf_token": session["csrf_token"],
                "wazo_user_uuid": mapping["user_uuid"] if mapping else None,
                "expires_at": session["expires_at"]}

    # Lọc nguồn mà user được đọc trước khi cắt trang cố định.
    @app.get("/api/directory/contacts")
    async def directory_contacts(request: Request, source: UUID | None = None, term: str = Query("", max_length=160),
                                 department: str = Query("", max_length=160),
                                 presence: str = Query("", pattern="^(online|offline)?$"),
                                 field: str = Query("", pattern="^(name|extension|employee_id|email|department)?$"),
                                 offset: int = Query(0, ge=0, le=10000), limit: int = Query(30, ge=1, le=50),
                                 refresh: bool = False,
                                 x_auth_token: str = Header("")):
        directory = request.app.state.directory
        owner, token, key = await directory.actor(x_auth_token)
        # Tìm kiếm mới phải có phạm vi. Máy lẻ chỉ khớp toàn bộ 4 hoặc 5 chữ số.
        if field:
            term = term.strip()
            matchable = (field == "department" and department.strip()
                         or field == "extension" and len(term) in (4, 5) and term.isascii() and term.isdecimal()
                         or field in ("name", "employee_id", "email") and len(term) >= 2)
            if not matchable:
                return {"items": [], "limited": False}
        snapshot, refresh_state = await directory.contacts(str(source) if source else None, token, key, refresh)
        if field:
            return dict(search_contacts(snapshot.rows, field, term, department, owner),
                        notice=snapshot.notice, fetched_at=snapshot.fetched_at, refresh_state=refresh_state)
        states = await directory.status(snapshot.source, owner, token, key, snapshot) if presence else {}
        return dict(search_page(snapshot.rows, term, department, presence, states, offset, limit, owner),
                    notice=snapshot.notice, fetched_at=snapshot.fetched_at, refresh_state=refresh_state)

    # Phân giải đúng UUID của nhóm đã lưu, kể cả khi các thành viên ở trang khác.
    @app.get("/api/directory/members")
    async def directory_members(source: UUID, request: Request, ids: list[UUID] = Query(default=[], max_length=100),
                                entry_ids: list[str] = Query(default=[], max_length=100),
                                x_auth_token: str = Header("")):
        directory = request.app.state.directory
        _, token, key = await directory.actor(x_auth_token)
        snapshot, _ = await directory.contacts(str(source), token, key)
        requested = {str(user) for user in ids}
        entries = {entry for entry in entry_ids if 0 < len(entry) <= 160}
        return {"items": [public_contact(row) for row in snapshot.rows
                          if row["uuid"] in requested or str(row.get("id", row["uuid"])) in entries]}

    # Lấy danh mục bộ phận từ toàn bộ nguồn đã xác minh quyền.
    @app.get("/api/directory/departments")
    async def directory_departments(request: Request, source: UUID | None = None, refresh: bool = False,
                                    x_auth_token: str = Header("")):
        directory = request.app.state.directory
        _, token, key = await directory.actor(x_auth_token)
        snapshot, refresh_state = await directory.contacts(str(source) if source else None, token, key, refresh)
        labels = {}
        for row in snapshot.rows:
            label = department_name(row)
            if label:
                labels.setdefault(normalize(label), label)
        return {"items": sorted(labels.values(), key=normalize), "notice": snapshot.notice,
                "has_unassigned": any(row.get("department_state") == "empty" for row in snapshot.rows),
                "fetched_at": snapshot.fetched_at, "refresh_state": refresh_state}

    # Đọc nhóm gọi của tài khoản đã xác thực.
    @app.get("/api/call-groups")
    async def list_call_groups(request: Request, x_auth_token: str = Header("")):
        owner, _, _ = await request.app.state.directory.actor(x_auth_token)
        return await call_groups(settings.database_path, owner, settings.wazo_tenant_uuid, "list")

    # Tạo nhóm mới và trả snapshot sau commit.
    @app.post("/api/call-groups")
    async def create_call_group(body: CallGroupInput, request: Request, x_auth_token: str = Header("")):
        owner, _, _ = await request.app.state.directory.actor(x_auth_token)
        return await call_groups(settings.database_path, owner, settings.wazo_tenant_uuid, "save", value=body)

    # Chỉ chỉnh sửa nhóm thuộc chủ và tenant hiện tại.
    @app.put("/api/call-groups/{group}")
    async def update_call_group(group: UUID, body: CallGroupInput, request: Request, x_auth_token: str = Header("")):
        owner, _, _ = await request.app.state.directory.actor(x_auth_token)
        return await call_groups(settings.database_path, owner, settings.wazo_tenant_uuid, "save", str(group), body)

    # Xóa cấu hình nhóm lưu của chủ, không gửi lệnh kết thúc cuộc gọi.
    @app.delete("/api/call-groups/{group}")
    async def delete_call_group(group: UUID, request: Request, x_auth_token: str = Header("")):
        owner, _, _ = await request.app.state.directory.actor(x_auth_token)
        return await call_groups(settings.database_path, owner, settings.wazo_tenant_uuid, "delete", str(group))

    # Tìm/tạo tài khoản và trả token người dùng Wazo sau xác thực cookie + CSRF.
    @app.post("/api/auth/wazo-session")
    async def wazo_session(body: WazoSessionRequest, request: Request):
        session = await require_session(request, csrf=True)
        result = await app.state.wazo.provision(session, body.client_id)
        # Cấp phát có thể mất thời gian; phiên bị logout/hết hạn không được nhận token mới.
        try:
            current_session = await require_session(request, csrf=True)
            if current_session["identity"] != session["identity"]:
                fail("SESSION_CHANGED", "Phiên đã thay đổi trong lúc cấp tài khoản.", 401)
            employee_id = str(session["profile"].get("employee_id") or "").strip()
            if employee_id:
                await app.state.store.remember_employee_id(settings.wazo_tenant_uuid, result["user_uuid"], employee_id)
        except Exception:
            try:
                await app.state.wazo.revoke_session(result, body.client_id)
            except Exception:
                pass  # Không giao credential ra ngoài; token vẫn có thời hạn phía Wazo.
            raise
        return result

    # CSRF xác nhận logout; handoff chỉ chứa ticket, không trả ID token trong JSON.
    @app.post("/api/auth/idp-logout")
    async def prepare_idp_logout(request: Request):
        session = await require_session(request, csrf=True)
        location = await app.state.oidc.logout_location(session)
        ticket = secrets.token_urlsafe(48)
        await app.state.store.put("logout", ticket, {"location": location}, 60)
        await app.state.store.delete("sessions", request.cookies.get("smartcall_session"))
        response = JSONResponse({"redirect_url": "/api/auth/idp-logout/continue"})
        response.delete_cookie("smartcall_session", path="/api/auth")
        response.set_cookie("smartcall_logout", ticket, httponly=True, secure=settings.secure_cookie, samesite="lax", max_age=60, path="/api/auth/idp-logout")
        return response

    # Điều hướng cửa sổ tới IdP qua handoff GETDEL; không logout IdP bằng fetch.
    @app.get("/api/auth/idp-logout/continue")
    async def continue_idp_logout(request: Request):
        handoff = await app.state.store.get("logout", request.cookies.get("smartcall_logout"), consume=True)
        if not handoff:
            fail("IDP_LOGOUT_EXPIRED", "Yêu cầu logout hết hạn hoặc đã sử dụng. Vui lòng thử lại.", 400)
        response = RedirectResponse(handoff["location"], status_code=302)
        response.delete_cookie("smartcall_logout", path="/api/auth/idp-logout")
        return response

    # Hủy phiên SmartCall backend; SDK frontend phụ trách thu hồi phiên Wazo của nó.
    @app.post("/api/auth/logout")
    async def logout(request: Request):
        await require_session(request, csrf=True)
        await app.state.store.delete("sessions", request.cookies.get("smartcall_session"))
        response = JSONResponse({"status": "logged_out"})
        response.delete_cookie("smartcall_session", path="/api/auth")
        return response

    return app


class WazoWrapperQuery(BaseModel):
    """Chỉ nhận các tham số phân trang của thao tác đọc context."""
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    limit: int = Field(default=30, ge=1, le=50, strict=True)
    offset: int = Field(default=0, ge=0, le=10000, strict=True)


class WazoWrapperCommand(BaseModel):
    """Mô tả yêu cầu gửi tới wrapper; backend tự kiểm tra đường dẫn và gắn token quản trị."""
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    method: str = Field(min_length=1, max_length=12)
    path: str = Field(min_length=1, max_length=320)
    query: dict[str, str | int | float | bool] = Field(default_factory=dict)
    body: dict | list | None = None


class RegisterUserRequest(BaseModel):
    """Thông tin đăng ký tài khoản Wazo mới cho Web và Android."""
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    firstname: str = Field(min_length=1, max_length=128)
    lastname: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=3, max_length=256)
    department: str = Field(default="", max_length=256)
    password: str | None = Field(default=None, min_length=1, max_length=128)
    client_id: str = Field(default="smartcall-app", min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class WazoSessionRequest(BaseModel):
    """Chỉ nhận mã client; không nhận email/quyền/UUID tin tưởng từ trình duyệt."""
    client_id: str = Field(min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


app = create_app()
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8801, reload=True)
