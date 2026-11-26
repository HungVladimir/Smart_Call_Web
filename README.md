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
