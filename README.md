# SmartCall Web

Ứng dụng Web dùng Vue và Wazo cho thoại, tin nhắn và danh bạ. Backend FastAPI xác thực Single ID, quản lý phiên qua Redis và lưu liên kết tài khoản Wazo trong SQLite. Nhánh phát triển của bản này là codex/refactor-architecture.

## Chạy frontend

Dùng Node theo phiên bản khai báo trong frontend/package.json. Tại thư mục gốc dự án:

~~~powershell
npm --prefix frontend ci
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
npm run dev
~~~

Đặt VITE_WAZO_HOST theo môi trường. Vite mặc định phục vụ Web tại http://localhost:8800 và chuyển request /api sang backend tại cổng 8801.

## Chạy backend cho Single ID

Cần Python và một Redis hỗ trợ GETDEL. Tạo môi trường Python một lần và giữ cấu hình hiện có khi cập nhật code.

~~~powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
.\backend\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8801
~~~

Điền cấu hình IdP, Redis và Wazo cho môi trường của bạn theo danh sách biến trong backend/.env.example. Origin Web và callback đăng ký với IdP phải khớp môi trường đang chạy. Mở Web trên origin đó rồi chọn đăng nhập Single ID.

## API danh bạ cho Web và App

Gửi token Wazo của người đăng nhập trong header X-Auth-Token. App có thể bỏ source để backend lấy nguồn Wazo đầu tiên trong profile Dird của người đó. Khi chỉ định source, backend kiểm tra quyền đọc nguồn đó.

~~~http
GET /api/directory/contacts?term=nguyen%20an&limit=30&offset=0
X-Auth-Token: <WAZO_USER_TOKEN>
~~~

Route trả items, total, offset và có thể kèm notice về dữ liệu bộ phận. Các trường chung mỗi liên hệ gồm uuid, name, number, email, employee_id, department và department_state. Giữ number và employee_id dưới dạng chuỗi để bảo toàn số 0 đầu. department_state gồm confirmed, empty và unknown.

- Bỏ field để tìm cùng lúc theo tên, máy lẻ, email, mã nhân viên và bộ phận. Có thể gửi thêm department hoặc presence (online/offline). limit mặc định là 30, tối đa 50.
- GET /api/directory/departments dùng cùng header, source là tùy chọn và trả items, has_unassigned và notice.
- App gọi host HTTPS đã triển khai SmartCall. Trong môi trường dev trên máy tính, có thể gọi FastAPI ở cổng 8801.

## Thử wrapper Wazo và `/api/register` cho Android, Web và Postman

Bật wrapper và `/api/register` trên backend bằng biến môi trường `SMARTCALL_WAZO_WRAPPER_TEST_KEY` (hoặc đặt tạm trong `backend/.env` trên môi trường thử). Bỏ biến hoặc để trống để tắt route (`404`). Backend tự lấy token quản trị và ép `Wazo-Tenant` từ cấu hình server, tuyệt đối không trả token quản trị về client.

### 1) Kiểm tra email & Đăng ký / Lấy thông tin tài khoản (`GET/POST /api/register/check-email`, `POST /api/register`)

- **Kiểm tra email đã tồn tại chưa (`GET` hoặc `POST /api/register/check-email`):**
  - App gửi `email` (qua query `?email=...` với `GET`, hoặc JSON `{"email": "..."}` kèm tùy chọn `password`, `client_id` với `POST`) kèm `X-SmartCall-Test-Key`.
  - Trả `200 OK`: nếu chưa có → `{"exists": false, "authenticated": false, "token": "", "refresh_token": "", "user": null}`; nếu đã có → `{"exists": true, "authenticated": true, "token": "...", "refresh_token": "...", "user": {"user_uuid", "username", "email", "firstname", "lastname", "department", "description", "extension", "enabled", "host", "tenant_uuid"}}` (đã lọc sạch trường nhạy cảm). Nếu tài khoản cũ có mật khẩu riêng chưa khớp cấu hình/chưa gửi `password` thì vẫn trả thông tin user với `"authenticated": false, "reason": "WAZO_CREDENTIALS_REQUIRED", "token": ""`.

- **Tạo mới hoặc lấy tài khoản hiện có (`POST /api/register`):**
  - Chưa có email → tạo user + cấp máy lẻ trống + ghi `department` vào `description` + đăng nhập trả `created: true, exists: false, authenticated: true, token, refresh_token` (nếu bỏ trống `username`, backend tự lấy phần trước `@` của email).
  - Email đã tồn tại → **không báo lỗi 409**, trả `200 OK` với `created: false, exists: true` cùng đầy đủ thông tin user hiện có và `token`, `refresh_token` để đăng nhập (đồng thời đồng bộ `description` khi xác thực thành công và có truyền `department`; nếu mật khẩu riêng chưa khớp thì trả `authenticated: false, reason: "WAZO_CREDENTIALS_REQUIRED", token: ""`).

~~~http
POST /api/register
Content-Type: application/json
X-SmartCall-Test-Key: <KEY_THU_NGHIEM>

{
  "firstname": "Test",
  "lastname": "User 01",
  "username": "test.user01",
  "email": "test.user01@samsung.com",
  "department": "AI Transformation Part(SDV)",
  "client_id": "smartcall-android"
}
~~~

- Nếu email mới nhưng `username` trùng tài khoản khác sẽ trả `409 WAZO_USERNAME_EXISTS`. Trùng email ở tenant khác trả `409 WAZO_EMAIL_OTHER_TENANT`.

### 2) Gọi API Wazo bằng quyền quản trị (`POST /api/wrapper`)

Android, Web (`http://localhost:8800/api/wrapper` qua Vite proxy) và Postman dùng cùng JSON `{method, path, query, body}`:

~~~http
POST /api/wrapper
Content-Type: application/json
X-SmartCall-Test-Key: <KEY_THU_NGHIEM>

{
  "method": "GET",
  "path": "/api/confd/1.1/users/<user_b_uuid>",
  "query": { "view": "directory" }
}
~~~

- Phạm vi cho phép: `GET`, `POST`, `PUT`, `DELETE`, `PATCH` tới các prefix `/api/confd/1.1/`, `/api/dird/0.1/`, `/api/chatd/1.0/`, `/api/calld/1.0/`, `/api/call-logd/1.0/`.
- Rào chắn bảo mật: chặn cứng `/api/auth/*`, cấu hình mật khẩu SIP (`.../endpoints/sip` trừ đọc `templates`), đường dẫn chứa `password`/`tokens`/`sessions`, các route `tenants`/`trunks`/`wizard`/`incalls`/`outcalls`/`registers`, xóa user/context/extension, sửa trường nhạy cảm (`auth`/`password`/`userfield`) và path traversal; tự động lọc bỏ `auth`, `password`, `userfield`, secret khỏi dữ liệu trả về.

| Mã HTTP từ SmartCall | Ý nghĩa |
| --- | --- |
| 200 / 201 | Thành công; `204` từ Wazo được chuẩn hóa thành `{"ok": true, "status": 204}`. |
| 401 | Thiếu key hoặc `X-SmartCall-Test-Key` sai. |
| 403 | `method`/`path` bị chặn bảo mật, khác tenant, sai domain email hoặc `Origin` trình duyệt không hợp lệ. |
| 404 | Chưa bật `SMARTCALL_WAZO_WRAPPER_TEST_KEY`, hoặc tài nguyên không tồn tại trên Wazo. |
| 409 | Trùng email/username/số máy lẻ khi đăng ký (`WAZO_EMAIL_EXISTS` / `WAZO_USERNAME_EXISTS` / `WAZO_PROVISION_BUSY`). |
| 422 | JSON, query hoặc thông tin đăng ký sai định dạng. |
| 502 / 503 | Wazo từ chối quyền admin/lỗi mạng hoặc backend thiếu cấu hình Wazo. |

Phép thử `GET /api/wrapper/contexts?limit=30&offset=0` vẫn tương thích với cùng header `X-SmartCall-Test-Key`. Xem chi tiết mẫu gọi cho Android, Web và Postman tại [SMARTCALL_API_POSTMAN.md](doc/SMARTCALL_API_POSTMAN.md). Key thử nghiệm không đưa vào Git hoặc bản phát hành công khai.

## Đọc code từ đâu

| Muốn đọc | Bắt đầu ở đây |
| --- | --- |
| Màn hình và điều hướng | [router](frontend/src/router/index.js) và [views](frontend/src/views) |
| Cách các dịch vụ frontend kết nối với nhau | [createServices.js](frontend/src/services/createServices.js) |
| Danh bạ, cuộc gọi, tin nhắn | [contactService.js](frontend/src/services/data/contactService.js), [callService.js](frontend/src/services/calls/callService.js), [chatService.js](frontend/src/services/data/chatService.js) |
| API và phiên Single ID | [main.py](backend/main.py), [oidc.py](backend/oidc.py), [store.py](backend/store.py) |
| Cấp tài khoản và phiên tổng đài | [wazo.py](backend/wazo.py) |

Xem [mục lục tài liệu](doc/README.md), [sơ đồ và bảng tra API](doc/SO_DO_VA_TRA_CUU_SMARTCALL.md), hoặc [bàn giao backend](backend/doc/HANDOFF.md).

## Kiểm tra thay đổi

~~~powershell
npm run check
.\backend\.venv\Scripts\python.exe -X utf8 -m unittest discover -s backend/tests
~~~

Frontend kiểm tra lint, import, test và build. Bộ test backend dùng dữ liệu và dịch vụ mô phỏng. Khi kiểm tra triển khai, thử riêng callback Single ID, đăng ký SIP, thoại nhóm và ghi âm trên tổng đài.
