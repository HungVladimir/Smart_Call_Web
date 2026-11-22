# Các mốc triển khai Single ID

> **Tài liệu lịch sử.** Số ca test và cấu hình ở đây thuộc từng mốc. Xem [hướng dẫn vận hành](../README.md) khi chạy backend hiện tại.

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


## Logout Single ID để đổi tài khoản — 21/11/2026

Callback có nút Đăng xuất Single ID / Đổi tài khoản. Nút đăng nhập chỉ có khi chưa có hồ sơ, không còn gây hiểu nhầm rằng login lại sẽ xóa phiên SSO. Khi đã vào /calls bằng Single ID, nút logout trên header cũng dùng luồng IdP này. Login mật khẩu vẫn logout Wazo như trước.

Backend lưu ID token đã xác minh trong Redis cùng thời hạn phiên để làm id_token_hint; GET user_info vẫn không trả token đó. POST /api/auth/idp-logout yêu cầu Origin/CSRF, tạo ticket cookie HttpOnly sống 60 giây và xóa phiên backend. Web dọn SDK rồi điều hướng cửa sổ tới GET /api/auth/idp-logout/continue. Endpoint GETDEL một lần trả 302 tới end_session_endpoint lấy từ discovery với id_token_hint và post_logout_redirect_uri, giống logic logout mẫu. Không dùng fetch để theo redirect logout tới IdP.

SMARTCALL_IDP_LOGOUT_REDIRECT được lấy từ ONEAI_IDP__LOGOUT_REDIRECT trong mẫu; mặc định origin + /logout. Đường dẫn này cần được IdP cho phép. Web /logout chuyển về /login. Phần router.isReady trước mount cũng được đưa vào source để không mất sửa khởi động callback khi lấy code mới.

Phiên tạo trước bản sửa chưa có id_token_hint: chọn Về trang đăng nhập rồi Single ID một lần để tạo phiên mới, sau đó bấm logout/đổi tài khoản. Thiếu end_session_endpoint hoặc handoff hết hạn sẽ hiện lỗi, không giả báo đã logout IdP. Việc IdP có hiển thị form mật khẩu sau logout còn phụ thuộc chính sách SSO tích hợp của máy chủ; cần thử trên hệ thống công ty.

Kiểm chứng: 18 test backend và 175 test frontend/17 file; lint, architecture, build và format đạt. Chưa gọi logout IdP thật. Giữ nguyên đoạn chạy uvicorn trực tiếp do người dùng thêm trong backend/main.py ở working tree, không đưa đoạn đó vào commit tính năng.


## Tenant cha/con, recurse và create_user — 21/11/2026

Đã đối chiếu dữ liệu Postman do người dùng cung cấp: tài khoản điện thoại và context internal thuộc tenant 0e9ab2d3-5a36-4c35-b1de-91e06ddde771. Context thật là ctx-lancompany-internal-45609ff7-078d-4513-ba32-2f89e8cf7bf5, user_ranges 1000–1999. backend/.env được cập nhật đúng các giá trị đó; credential đã có giữ nguyên.

recurse=false chỉ đọc tenant chọn bởi Wazo-Tenant (hoặc tenant mặc định của token nếu không có header). recurse=true thêm các tenant con mà token được phép nhìn thấy. Nó không cấp thêm ACL, không phải phân trang, không quyết định tenant nhận POST. Token admin có thể ở tenant cha, khác tenant chứa điện thoại; không nên mặc định gán metadata.tenant_uuid làm tenant cấp phát nếu user/context ở tenant con.

Backend phân biệt WAZO_TENANT_UUID (tenant cấp phát, luôn gửi header khi đọc/ghi Confd) và WAZO_AUTH_TENANT_UUID (tùy chọn lúc xin token; để trống dùng tenant mặc định của credential). Các API list user/context/template/extension gửi recurse=true và bỏ view=full theo kết quả máy chủ của người dùng. Khi chọn tài nguyên vẫn kiểm tra tenant_uuid nếu server trả trường này: không chọn context/template/user khác tenant; email chỉ tồn tại ngoài tenant báo WAZO_EMAIL_OTHER_TENANT thay vì tự tạo trùng.

create_user được viết rõ từng bước, thay các tên s/c/used/free/selected bằng biến có nghĩa, tách authentication_payload, sip_endpoint_payload, extension_payload, line_payload và create_user_payload. Trước khi POST kiểm tra context enabled, template UUID, số chưa dùng và phần giao giữa kho cấu hình với user_ranges. SIP password vẫn ngẫu nhiên riêng; password đăng nhập giữ cấu hình test do người dùng yêu cầu. Không retry POST mù.

Cấu hình xác nhận:
~~~dotenv
SMARTCALL_WAZO_TENANT_UUID=0e9ab2d3-5a36-4c35-b1de-91e06ddde771
SMARTCALL_WAZO_CONTEXT=ctx-lancompany-internal-45609ff7-078d-4513-ba32-2f89e8cf7bf5
SMARTCALL_WAZO_EXTENSION_MIN=1000
SMARTCALL_WAZO_EXTENSION_MAX=1999
SMARTCALL_WAZO_AUTH_TENANT_UUID=
~~~

Postman: lấy token bằng Basic Auth tài khoản cấp phát; đọc GET /api/confd/1.1/users hoặc /contexts với X-Auth-Token, Wazo-Tenant là tenant đích ở trên, Params recurse=true, limit=100, offset=0. Không dùng view=full. Có thể so sánh recurse=false/true với cùng header để thấy phạm vi tenant; token không có quyền tenant đích vẫn lỗi, recurse không vượt phân quyền. Nếu đổi Wazo-Tenant sang tenant cha thì POST vẫn tạo ở cha, dù GET đệ quy thấy context con; không dùng cấu hình đó để cấp user.

Kiểm chứng: 24/24 test backend, pip check đạt. Có regression query recurse/no full, auth tenant khác target, context/user khác tenant, giới hạn và hết user_ranges. Test dùng transport giả, chưa gọi Wazo thật. Frontend không thay đổi. Giữ nguyên backend/main.py của người dùng. Khi cập nhật máy công ty, giữ credential Wazo đã điền trong .env và áp dụng các dòng tenant/context/kho số trên, rồi khởi động lại backend.

Nguồn: https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/helpers/restful.py (_build_tenant_list và build_tenant).


## Username auth từ email cố định — 21/11/2026

Theo xác nhận của người dùng, email công ty là duy nhất và không thay đổi. Tài khoản Wazo tạo mới lấy phần trước @ của email làm auth.username, chuẩn hóa chữ thường và bỏ khoảng trắng đầu/cuối. Ví dụ vhung99.nguyen@samsung.com → vhung99.nguyen. Không dùng replace chuỗi samsung.com, không tự thêm hậu tố hoặc hash khi trùng username. Domain vẫn do kiểm tra email của OIDC và SMARTCALL_ALLOWED_EMAIL_DOMAINS kiểm soát; không thay đổi allowlist trong lượt này.

Mapping SQLite vẫn có khóa issuer/sub + tenant và lưu user_uuid/username thật. Tài khoản đã có mapping tiếp tục dùng username cũ sso_..., không tự đổi tên trên server. Khi khôi phục tài khoản SmartCall đã tồn tại nhưng mất mapping, đọc auth username thật theo UUID nếu danh sách Confd không trả auth; không đoán username mới từ email cho user cũ.

Username auth dùng cho xin token API Wazo, không phải máy lẻ. SIP vẫn có credential riêng như trước. Thay đổi quy tắc này chưa sửa hoặc xác nhận nguyên nhân lỗi SIP Unregistered đã báo. Tài khoản đã tạo không tự được cấp lại khi xóa trên Wazo: cơ chế phục hồi mapping 404 là vấn đề riêng còn tồn đọng.

Nếu POST tạo user trả 409, backend báo WAZO_CREATE_CONFLICT, yêu cầu kiểm tra username/auth còn sót hoặc máy lẻ trùng. Không tự liên kết chỉ vì username trùng, không reset mật khẩu, không đổi sang username có hậu tố; kiểm tra uniqueness cuối cùng do Wazo thực thi, kể cả khi có công cụ khác tạo đồng thời.

Kiểm chứng: 29/29 test backend, pip check và git diff --check đạt. Có kiểm thử local-part chứa dấu chấm/số, username legacy trong mapping, khôi phục username cũ khi thiếu inline auth, email sai và xung đột tạo user. Chưa gọi Wazo thật. Frontend không thay đổi; giữ nguyên phần backend/main.py do người dùng tự sửa.


## SIP endpoint, reconnect và công cụ mapping — 21/11/2026

Payload tạo mới thêm endpoint_sip.name = SIP auth username để SDK dùng SIP URI nhất quán với tên endpoint. Tài khoản managed cũ được đọc endpoint chính dạng merged; chỉ PUT name nếu đang lệch, không đổi password/template. Chưa xác minh REGISTER trên Wazo công ty nên không coi giả thuyết tên endpoint là nguyên nhân duy nhất đã chứng minh.

Frontend gộp nhiều UNREGISTERED thành một task reconnect, hủy timer/quyền tiếp tục khi REGISTERED hoặc disconnect/logout, kiểm tra context trước khi dùng kết quả health check. Chặn quay số khi SIP chưa registered hoặc vừa mất đăng ký trong lúc tra cứu; không phát ringback/SDK call trong trường hợp đó. Log tạo SIP session chỉ là INFO đang chờ phản hồi, không báo tổng đài đã chấp nhận.

Mapping có UUID trả 404 được tìm lại qua email rồi tạo nếu cần. Chỉ thay liên kết sau khi đã có user/username hợp lệ; SQLite kiểm tra UUID cũ trong UPDATE để không ghi đè concurrent edit. Lỗi 401/403/timeout vẫn dừng. Không tự xóa tài khoản auth hoặc tài nguyên còn sót trên Wazo.

Công cụ backend/manage_identity_db.py hỗ trợ list/add/delete, đọc đúng Settings.database_path, lọc tenant/username, hiển thị issuer/sub riêng; INSERT không ghi đè và DELETE có tenant+UUID. Tự backup bằng SQLite API trước ghi. Công cụ chỉ chỉnh DB, không gọi API Wazo/IdP/Redis; cần dừng backend khi sửa để test. Xem hướng dẫn SQLite lịch sử để biết lệnh đầy đủ và ý nghĩa managed.

Kiểm chứng: 38/38 test backend, 178/178 test frontend (17 file), lint/architecture/build/format:check/pip check đạt. Có test CAS SQLite, khôi phục UUID 404, lỗi 403 không tạo lại, payload name và sửa endpoint legacy không sửa credential, CLI backup/unique/delete đúng tenant, reconnect gộp/hủy/health trả muộn và SIP_NOT_READY. Build còn cảnh báo chunk lớn đã có. Không gọi server thật; giữ nguyên backend/main.py do người dùng tự sửa.


## Thay luồng department bằng description Wazo, bỏ avatar — 21/11/2026

Theo yêu cầu mới, commit 03397d2 đảo ngược toàn bộ commit 0f2dbdd (hồ sơ dùng chung/avatar). Đã bỏ EmployeeAvatar, proxy ảnh, cấu hình employee_photo_url, API directory-profiles và code lưu/đọc bảng directory_profiles. Giữ nguyên các sửa SIP, username email, phục hồi mapping và công cụ SQLite từ các commit trước. Nếu máy đã có bảng directory_profiles do chạy bản cũ, code mới không dùng bảng đó; không tự DROP dữ liệu đã tồn tại. Bảng identities vẫn phục vụ liên kết Single ID–Wazo.

Luồng mới: department từ hồ sơ IdP đã xác thực được chuẩn hóa khoảng trắng và gán vào description của user Confd. Tài khoản tạo mới gửi description trong cùng POST /api/confd/1.1/users. Tài khoản đã có được PUT /api/confd/1.1/users/<uuid> với duy nhất JSON {"description": "<department từ IdP>"}, sau khi token đăng nhập được xác nhận đúng UUID liên kết. Chỉ ghi khi department có dữ liệu và khác description hiện tại; không xóa mô tả cũ nếu IdP thiếu department. Nếu PUT thất bại, thu hồi token user vừa cấp và trả lỗi, không báo đã hoàn tất. Đồng bộ department có thể thay nội dung description cũ vì field này nay được quy ước là bộ phận cho tài khoản đăng nhập Single ID; không đụng username/password/line/userfield.

API được dùng là Confd /api/confd/1.1/users/<uuid>, vì schema User có description; không tự suy rằng /api/auth/user/uuid là cùng tài nguyên hoặc đồng bộ sang Auth. Khi kiểm tra Postman nên GET chính endpoint Confd này với X-Auth-Token và Wazo-Tenant đúng. Trường userfield tiếp tục là marker liên kết, không phải phòng ban.

Frontend ưu tiên description trong mapper contact và hồ sơ đăng nhập, không dùng userfield làm department. Vẫn nhận alias department/society/title từ nguồn Dird cũ khi description chưa có. Nếu Dird chưa trả description, ContactService đọc danh sách user Confd trực tiếp bằng token user, có recurse=true và phân trang 100, ghép theo UUID; dừng khi đã tìm đủ liên hệ cần bổ sung hoặc hết dữ liệu (giới hạn 10.000 user cho lượt đọc). Nếu không có quyền Confd, giữ danh bạ Dird và ghi log cảnh báo; không dùng admin token ở Web. Muốn không phát thêm lượt GET Confd, cấu hình nguồn Dird trả description trực tiếp. Search và chip phòng ban tiếp tục dùng contact.dept đã ánh xạ description. Badge chọn tất cả đếm đúng toàn bộ danh bạ đang hiện.

Cách test:
1. Pull nhánh refactor, khởi động lại backend/frontend và đăng nhập Single ID lại.
2. Trong Postman: GET https://<wazo>/api/confd/1.1/users/<UUID> với X-Auth-Token và Wazo-Tenant; description phải là department IdP, ví dụ AI Transformation Part(SDV).
3. Dùng Web/tài khoản khác lấy danh bạ, lọc hoặc tìm theo bộ phận. Dữ liệu nằm trên Wazo nên không phụ thuộc dùng chung file SQLite hồ sơ của bản đã bỏ. App muốn có department thì đọc description từ user Confd hoặc nguồn Dird có field này.
4. Tài khoản cũ chưa đăng nhập Single ID lại chưa được cập nhật tự động hàng loạt. Avatar quay về chữ viết tắt như trước.

Kiểm chứng: 43/43 test backend, 185/185 test frontend (18 file), lint/architecture/build/format:check/pip check đạt. Có test description tạo mới, cập nhật tài khoản cũ, bỏ qua trùng/rỗng, token sai không ghi, lỗi PUT thu hồi token, mapper/search/filter và fallback Confd có guard phiên. Chưa gọi ghi tài khoản thật trên Wazo công ty trong lượt này. Build còn cảnh báo chunk lớn đã có. Đoạn uvicorn người dùng thêm trong backend/main.py được giữ ngoài commit.

Nguồn API: https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/plugins/user/schema.py (description) và https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/helpers/restful.py (PUT partial).
