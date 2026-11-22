# Backend Single ID và cấp tài khoản Wazo

Backend xác thực Single ID, quản lý phiên SmartCall và cấp phiên Wazo cho Web.

## 1. Chạy thử trên Windows

Mở PowerShell tại thư mục gốc Smart_Call_Web_Refactor. Cần Python và Redis từ 6.2 (GETDEL). Môi trường kiểm chứng: Python 3.14, phiên bản thư viện chính xác nằm trong requirements.lock.txt.

Cài một lần:

~~~powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
~~~

Điền cấu hình trong backend/.env. Không ghi credential vào file Vue hoặc biến VITE_*.

Terminal thứ nhất:

~~~powershell
.\backend\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8801
~~~

Terminal thứ hai:

~~~powershell
npm --prefix frontend run dev
~~~

Mở **http://localhost:8800/login**, bấm **ĐĂNG NHẬP SINGLE ID**. Phải dùng origin đúng SMARTCALL_PUBLIC_ORIGIN; không đổi sang 127.0.0.1 hoặc một port khác giữa chừng.

Chỉ chạy frontend không tự khởi động Python. Proxy /api của Vite giữ nguyên prefix, backend khai báo /api tường minh.

## 2. Cấu hình IdP

| Biến | Ý nghĩa |
|---|---|
| SMARTCALL_PUBLIC_ORIGIN | Origin Web, mặc định http://localhost:8800 |
| SMARTCALL_IDP_ISSUER | Issuer đúng claim iss và discovery |
| SMARTCALL_IDP_CLIENT_ID / CLIENT_SECRET | Client đã đăng ký, chỉ lưu ở backend |
| SMARTCALL_IDP_DISCOVERY_URL | Có thể để trống để dùng issuer + /.well-known/openid-configuration |
| SMARTCALL_IDP_JWKS_URI | Override có chủ đích nếu IdP dùng URL JWKS đặc thù |
| SMARTCALL_IDP_SCOPE | Mặc định openid |
| SMARTCALL_IDP_PKCE_ENABLED | Mặc định true/S256; chỉ tắt khi xác nhận IdP/client không hỗ trợ |
| SMARTCALL_IDP_REQUIRE_VERIFIED_EMAIL | Mặc định false cho IdP nội bộ không có claim email_verified. Nếu claim là false vẫn từ chối. Nếu true thì bắt buộc claim true |
| SMARTCALL_ALLOWED_EMAIL_DOMAINS | Mặc định samsung.com; email từ JWT đã xác minh, không nhận từ form/frontend |
| SMARTCALL_REDIS_URL | Redis chứa giao dịch/phiên, namespace smartcall riêng |
| SMARTCALL_TLS_CA_FILE | Đường dẫn PEM CA nội bộ, dùng cho HTTP tới IdP/Wazo; không tắt verify TLS |

Đăng ký chính xác backend redirect URI:

- Local: http://localhost:8800/api/auth/callback
- Trang Vue sau hoàn tất xác thực: http://localhost:8800/callback

Khi chạy bằng hostname/IP công ty phải dùng HTTPS, đăng ký callback tương ứng ở IdP và đổi PUBLIC_ORIGIN. localhost chỉ trỏ tới máy đang mở trình duyệt. Cookie được Secure khi origin là HTTPS.

Điền cấu hình IdP và Redis dành cho môi trường triển khai trong backend/.env.

## 3. Cấu hình Wazo để tự cấp tài khoản

Cấu hình ba giá trị sau:

- SMARTCALL_WAZO_ADMIN_USERNAME
- SMARTCALL_WAZO_ADMIN_PASSWORD
- SMARTCALL_WAZO_TENANT_UUID

Tài khoản backend cần quyền đọc user/context/template/extension, tạo user gộp và quyền đọc thông tin xác thực liên quan. Dùng tài khoản quản trị/cấp phát được cấp quyền phù hợp. Token quản trị không xuống trình duyệt.

Các mặc định theo yêu cầu thử:

- WAZO_DEFAULT_PASSWORD=12345: mật khẩu đăng nhập của user **mới**. Đây là cấu hình thử, không dùng làm mật khẩu vận hành lâu dài.
- WAZO_CONTEXT=internal: phải khớp tên context thật từ GET /api/confd/1.1/contexts.
- WAZO_TEMPLATE_LABELS=global,webrtc: chữ global, không phải gloal; backend lấy UUID template thật. Nếu máy chủ dùng label khác, điền label tương ứng.
- WAZO_EXTENSION_MIN=1000 / MAX=9999: lấy ngẫu nhiên số chưa dùng trong context, không lấy từ EP ID. Đổi dải cho đúng kho số/context của công ty.
- Protocol SIP được thể hiện qua endpoint_sip; không gửi trường Protocol của form UI.
- SIP secret ngẫu nhiên riêng, không dùng password 12345 để làm SIP secret.

Payload POST /api/confd/1.1/users gồm firstname/lastname/email, auth, lines, extensions và endpoint_sip. Bám ví dụ mục 10 dev_guide và schema chính thức:
https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/plugins/user/api.yml

Tên ưu tiên given_name/family_name; nếu chỉ có họ tên thì từ cuối là firstname, phần trước là lastname. Tên hiển thị trên Web vẫn giữ nguyên họ tên do IdP trả về.

## 4. Tài khoản mới, cũ và retry

1. Đã có mapping issuer/sub/tenant: tra đúng UUID đã lưu. Nếu Wazo trả 404, tìm lại theo email rồi tạo nếu cần. Lỗi quyền hoặc lỗi mạng dừng luồng.
2. Chưa có mapping: tìm email chính xác trong tenant, đọc đủ trang.
3. Không có email: kiểm tra context/template/kho số rồi POST một lần tạo user+auth+line.
4. Lưu mapping SQLite không chứa token/password. userfield có marker SmartCall giúp nhận diện tài khoản nếu server đã tạo nhưng request trước timeout.
5. Đăng nhập Wazo bằng credential user mới và trả access/refresh token **của user**, xác minh UUID trước khi giao.
6. Frontend dùng SDK validateToken rồi chạy cùng bootstrap hiện có: profile, WebSocket, SIP, presence, session health.

Nếu email đã có trong Wazo:

- Mặc định WAZO_EXISTING_PASSWORD_LOGIN=false: hiện hồ sơ IdP và lỗi cần liên kết; không reset mật khẩu.
- Bật true nếu tài khoản cũ thực sự sử dụng cùng WAZO_DEFAULT_PASSWORD và muốn backend thử đăng nhập bằng username hiện có.
- Nếu mật khẩu cũ khác, trả WAZO_CREDENTIALS_REQUIRED; không thể suy ra mật khẩu từ email/token IdP.
- Chưa triển khai federation/token exchange Wazo vì chưa có hợp đồng cấu hình đó. Không đưa token admin xuống Web để giả danh user.

Có khóa Redis theo tenant, unique constraint SQLite, kiểm tra lỗi tra cứu và không retry POST tạo user mù. Sau timeout, bấm thử lại để đối chiếu email/marker. Khóa này phối hợp giữa các instance SmartCall dùng cùng Redis namespace; thao tác tạo ở công cụ quản trị khác vẫn có thể tranh số. Nếu tổng đài từ chối số bị trùng, request dừng và người dùng thử lại sau khi kiểm tra.

## 5. Luồng và API

~~~text
LoginView → GET /api/auth/login → IdP
IdP → GET /api/auth/callback → cookie phiên backend → /callback
CallbackView → GET /api/auth/user_info → profile + CSRF
CallbackView → AuthService → POST /api/auth/wazo-session
            → tìm/tạo Wazo → SDK nhận token user → /calls
~~~

| API | Nhiệm vụ |
|---|---|
| GET /api/health | Health tiến trình, không gọi IdP/Wazo |
| GET /api/auth/login | Tạo state/nonce/PKCE, chuyển cửa sổ tới IdP |
| GET /api/auth/callback | Kiểm tra browser/state, GETDEL một lần, xác minh JWT rồi cấp session ID riêng |
| GET /api/auth/user_info | Hồ sơ, CSRF, hạn phiên và UUID đã liên kết; không trả token IdP |
| POST /api/auth/wazo-session | Cookie + Origin + X-CSRF-Token, body chỉ có client_id |
| POST /api/auth/idp-logout | Tạo vé dùng một lần để chuyển hướng đăng xuất IdP |
| GET /api/auth/idp-logout/continue | Dùng vé rồi chuyển trình duyệt sang IdP |
| POST /api/auth/logout | Hủy phiên backend hiện tại, có Origin/CSRF |

Session backend sống tối đa min(SESSION_TTL, hạn ID token). Hồ sơ cache vẫn kiểm tra hạn mỗi request. Chưa refresh token IdP; hết phiên thì đăng nhập lại qua SSO. Phiên Wazo và refresh Wazo giữ cơ chế SDK hiện tại; không có hai bộ refresh Wazo chạy song song.

Logout hiện tại hủy phiên ứng dụng và SDK Wazo, **không đăng xuất toàn cục khỏi IdP/các ứng dụng công ty khác**. Việc thu hồi phiên IdP tức thời/back-channel logout và đồng bộ vô hiệu hóa nhân sự cần hợp đồng riêng; không coi bootstrap này đã cung cấp các khả năng đó.

Trang /callback hiển thị hồ sơ và lỗi nếu chưa cấu hình Wazo. Khi đủ cấu hình và SDK nhận phiên thành công, trang tự chuyển /calls; không cần quay lại form mật khẩu. Không đặt token/password vào URL.

## 6. Lỗi thường gặp

| Mã | Cách kiểm tra |
|---|---|
| IDP_NOT_CONFIGURED | Issuer/client/secret trong .env |
| ISSUER_MISMATCH | Discovery issuer và claim iss phải đúng cấu hình |
| STATE_INVALID / STATE_EXPIRED | Sai origin/cookie, giao dịch quá 5 phút, callback đã dùng |
| SESSION_STORE_UNAVAILABLE | Redis, ACL/mật khẩu/network và namespace |
| UPSTREAM_UNAVAILABLE | CA PEM, mạng nội bộ và URL IdP/Wazo |
| WAZO_NOT_CONFIGURED | Điền tài khoản cấp phát và tenant |
| WAZO_CONTEXT_NOT_FOUND | Tên context thật, không chỉ nhãn internal trên UI |
| WAZO_TEMPLATE_NOT_FOUND | Label template thật, UUID lấy từ API |
| WAZO_EXTENSION_POOL_EMPTY | Dải số trống trong context |
| WAZO_REQUEST_FAILED | Method/path/HTTP được trả về nhưng không lộ credential; kiểm tra ACL/schema trên máy chủ |
| WAZO_ACCOUNT_LINK_REQUIRED | Tài khoản cũ chưa có cơ chế cấp token |
| WAZO_CREDENTIALS_REQUIRED | Không đăng nhập được bằng password cấu hình, không tự reset |
| IDENTITY_CONFLICT / WAZO_EMAIL_CONFLICT | Quản trị xử lý liên kết trùng, không chọn user tùy ý |

Không sao chép lỗi chi tiết từ upstream có thể chứa token/secret vào thông báo Web hoặc log.

## 7. Quản lý cấu hình và liên kết SQLite

`store.py` dùng Redis cho giao dịch OIDC, phiên và vé logout. SQLite lưu bảng `identities` theo issuer, subject và tenant. Bảng giữ UUID, username Wazo và cờ managed. Mặc định DB là `backend/data/identity.sqlite3`, có thể đổi qua `SMARTCALL_DATABASE_PATH`.

Hai tiện ích cục bộ dưới đây cần có sẵn trên máy để chạy. FastAPI dùng cấu hình và database trực tiếp.

- `import_reference_env.py --reference FILE` nhập cấu hình IdP/Redis sang `backend/.env`. Các giá trị IdP/Redis tương ứng có thể được cập nhật. Cấu hình Wazo đã thiết lập được giữ.
- `manage_identity_db.py list` xem liên kết. Dùng `list --username USERNAME` để lọc hoặc đặt `--db FILE` trước lệnh để chọn DB khác. `add` cần issuer, subject, tenant, UUID và username. `delete` cần tenant và UUID. Mỗi lần ghi vào DB hiện có tạo backup cạnh DB. Việc xóa một liên kết chỉ tác động SQLite; backend vẫn có thể tìm lại tài khoản theo email khi đăng nhập tiếp theo.

Thao tác ghi mapping nên thực hiện khi backend đã dừng. Dùng `sub` thật của IdP và chỉ đặt `--managed` cho tài khoản thuộc luồng cấp phát SmartCall. [Cú pháp chi tiết và khôi phục backup](lich-su/IDENTITY_DB_GUIDE.md)

## 8. Kiểm chứng và lịch sử triển khai

Xem [kiểm chứng](../../doc/refactor/VERIFICATION.md) để chạy kiểm tra cục bộ. Bộ test frontend và backend được giữ trên máy theo quy tắc ignore. Khi kiểm thử tích hợp, đi lần lượt qua callback Single ID, cấp phiên Wazo, SIP Registered, gọi thử và kiểm tra `description` trên Confd.

Cấu hình tenant Wazo dùng `SMARTCALL_WAZO_TENANT_UUID` cho tài nguyên, và tùy chọn `SMARTCALL_WAZO_AUTH_TENANT_UUID` cho bước xin token. Username tài khoản mới lấy phần trước @ của email. Tên SIP endpoint khớp SIP username. Phòng ban từ IdP được ghi vào `description` của user Confd khi có dữ liệu.

[Các mốc triển khai Single ID](lich-su/MOC_TRIEN_KHAI_SINGLE_ID.md) lưu chi tiết thay đổi về logout IdP, tenant, username, SIP và phòng ban.
