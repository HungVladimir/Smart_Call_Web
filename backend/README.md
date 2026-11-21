> Cập nhật 21/11/2026: theo yêu cầu người dùng, backend/.env nay được track trong Git và chứa secret thật. Hướng dẫn ignore .env bên dưới là hướng dẫn trước ngoại lệ này; người có quyền đọc repo/lịch sử Git có thể lấy credential.

# Backend Single ID và cấp tài khoản Wazo

Đã chuyển luồng OIDC trong backendV1/codeAuthRefer thành backend chạy thực tế. Hai bản dán gốc trong doc được giữ nguyên tại máy, không đưa lên Git vì chứa credential.

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
| SMARTCALL_IDP_DISCOVERY_URL | Có thể để trống để dùng issuer + /.well-known/openid-configuration như bản tham chiếu |
| SMARTCALL_IDP_JWKS_URI | Override có chủ đích nếu IdP dùng URL JWKS đặc thù trong mã tham chiếu |
| SMARTCALL_IDP_SCOPE | Mặc định openid để giữ tương thích mẫu đã thử |
| SMARTCALL_IDP_PKCE_ENABLED | Mặc định true/S256; chỉ tắt khi xác nhận IdP/client không hỗ trợ |
| SMARTCALL_IDP_REQUIRE_VERIFIED_EMAIL | Mặc định false cho IdP nội bộ không có claim email_verified. Nếu claim là false vẫn từ chối. Nếu true thì bắt buộc claim true |
| SMARTCALL_ALLOWED_EMAIL_DOMAINS | Mặc định samsung.com; email từ JWT đã xác minh, không nhận từ form/frontend |
| SMARTCALL_REDIS_URL | Redis chứa giao dịch/phiên, namespace smartcall riêng |
| SMARTCALL_TLS_CA_FILE | Đường dẫn PEM CA nội bộ, dùng cho HTTP tới IdP/Wazo; không tắt verify TLS |

Đăng ký chính xác backend redirect URI:

- Local: http://localhost:8800/api/auth/callback
- Trang Vue sau hoàn tất xác thực: http://localhost:8800/callback

Khi chạy bằng hostname/IP công ty phải dùng HTTPS, đăng ký callback tương ứng ở IdP và đổi PUBLIC_ORIGIN. localhost chỉ trỏ tới máy đang mở trình duyệt. Cookie được Secure khi origin là HTTPS.

Ở máy đã triển khai trong tác vụ này, .env cục bộ được lấy có chọn lọc cấu hình IdP/Redis từ bản dán tham chiếu. File này **không được push**. Máy công ty sau pull cần giữ/cấu hình lại .env của môi trường đó; không cần gửi secret qua chat.

## 3. Cấu hình Wazo để tự cấp tài khoản

Bắt buộc bổ sung ba giá trị chưa có trong mã tham chiếu:

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

1. Đã có mapping issuer/sub/tenant: dùng đúng Wazo UUID đã lưu, không tạo lại.
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

## 7. Kiểm chứng

~~~powershell
.\backend\.venv\Scripts\python.exe -X utf8 -m unittest discover -s backend/tests
.\backend\.venv\Scripts\python.exe -m pip check
npm --prefix frontend run check
npm --prefix frontend run format:check
~~~

Kết quả ban đầu: 14 test backend; 167 test frontend/16 file, lint/architecture/build/format đạt. Smoke test tiến trình thật: backend health và Vite proxy đều ok, GET /callback trả HTML 200, guest user_info trả 401.

Test dùng JWT ký RSA thật, HTTP/Redis fixture ở ranh giới và SQLite thật; không dùng tài khoản/IdP/Wazo thật. Chưa xác minh việc tạo người dùng/gọi điện trên tổng đài công ty. Build còn cảnh báo chunk lớn.

Test thực tế: hai tài khoản Single ID; hủy login; sai state; hồ sơ nhưng chưa có cấu hình Wazo; tạo user mới; login lại không tạo trùng; email cũ; sai context/template; gọi 1-1 sau đăng nhập; F5; logout. Trước tiên dùng tài khoản thử để kiểm tra API/schema và dải số.


## Nhập cấu hình từ bản mẫu — 20/11/2026

Đặt bản dán gốc tại backend/doc/backendV1.py trên máy cần chạy, sau đó từ thư mục gốc gọi:

~~~powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/import_reference_env.py
~~~

Script đọc các dòng môi trường, không thực thi code tham chiếu. Nó điền issuer/client ID/client secret, Redis URL/TTL, PUBLIC_ORIGIN từ callback mẫu, discovery và JWKS đặc thù /t/display.company/oauth2/jwks. Chạy lại sẽ đồng bộ lại các giá trị IdP/Redis từ mẫu; giữ nguyên Wazo/CA đã cấu hình. Không sao chép credential MinIO/LLM/RDP/database vì SmartCall không sử dụng chúng. Secret chỉ ghi vào backend/.env bị ignore; Git chỉ chứa script và test. Sau pull ở máy khác phải chạy script tại máy đó với bản mẫu cục bộ hoặc tự điền .env; Git không chuyển secret.

Trong mẫu chưa có WAZO_ADMIN_USERNAME, WAZO_ADMIN_PASSWORD và WAZO_TENANT_UUID: cần quản trị cung cấp ba giá trị này. TLS_CA_FILE chưa có file CA để điền; chỉ cần khi Python chưa tin CA máy chủ. Context internal, template global/webrtc và dải 1000–9999 là mặc định thử nghiệm theo yêu cầu, chưa được xác nhận trên server. Redis TTL lấy từ mẫu nhưng thời hạn phiên thực tế vẫn bị giới hạn bởi exp của ID token.

Kiểm chứng cập nhật: 16 test backend đạt, gồm mapping env, giữ Wazo/CA, chạy lại không trùng biến và từ chối callback mẫu bất thường. Chưa gọi IdP/Redis/Wazo thật.


## Logout Single ID để đổi tài khoản — 21/11/2026

Callback có nút Đăng xuất Single ID / Đổi tài khoản. Nút đăng nhập chỉ có khi chưa có hồ sơ, không còn gây hiểu nhầm rằng login lại sẽ xóa phiên SSO. Khi đã vào /calls bằng Single ID, nút logout trên header cũng dùng luồng IdP này. Login mật khẩu vẫn logout Wazo như trước.

Backend lưu ID token đã xác minh trong Redis cùng thời hạn phiên để làm id_token_hint; GET user_info vẫn không trả token đó. POST /api/auth/idp-logout yêu cầu Origin/CSRF, tạo ticket cookie HttpOnly sống 60 giây và xóa phiên backend. Web dọn SDK rồi điều hướng cửa sổ tới GET /api/auth/idp-logout/continue. Endpoint GETDEL một lần trả 302 tới end_session_endpoint lấy từ discovery với id_token_hint và post_logout_redirect_uri, giống logic logout mẫu. Không dùng fetch để theo redirect logout tới IdP.

SMARTCALL_IDP_LOGOUT_REDIRECT được lấy từ ONEAI_IDP__LOGOUT_REDIRECT trong mẫu; mặc định origin + /logout. Đường dẫn này cần được IdP cho phép. Web /logout chuyển về /login. Phần router.isReady trước mount cũng được đưa vào source để không mất sửa khởi động callback khi lấy code mới.

Phiên tạo trước bản sửa chưa có id_token_hint: chọn Về trang đăng nhập rồi Single ID một lần để tạo phiên mới, sau đó bấm logout/đổi tài khoản. Thiếu end_session_endpoint hoặc handoff hết hạn sẽ hiện lỗi, không giả báo đã logout IdP. Việc IdP có hiển thị form mật khẩu sau logout còn phụ thuộc chính sách SSO tích hợp của máy chủ; cần thử trên hệ thống công ty.

Kiểm chứng: 18 test backend và 175 test frontend/17 file; lint, architecture, build và format đạt. Chưa gọi logout IdP thật. Giữ nguyên đoạn chạy uvicorn trực tiếp do người dùng thêm trong backend/main.py ở working tree, không đưa đoạn đó vào commit tính năng.
