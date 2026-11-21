# Department và avatar nhân viên dùng chung

## Nguyên nhân bộ lọc cũ không thấy department Single ID

Luồng đăng nhập chỉ gắn department vào userSessionState/localStorage của người đang đăng nhập. Bộ lọc danh bạ lại lấy contact.dept từ Dird của Wazo. Hai nguồn chưa được nối: department trên header có nhưng contact.dept vẫn rỗng hoặc là dữ liệu cũ. Ngoài ra marker smartcall:sso:<hash> trong userfield bị mapper coi như phòng ban.

Bản sửa giữ marker làm liên kết kỹ thuật, không coi là department. Sau khi wazo-session xác nhận phiên còn hợp lệ và đã có UUID Wazo, backend lưu tên, department, EP ID theo danh tính và tenant vào bảng directory_profiles trong SQLite đang dùng. Không sửa schema identities hay đưa token/password vào bảng mới. Nếu danh tính được tạo lại với UUID mới thì hồ sơ cũ của danh tính đó được chuyển sang UUID mới.

Danh bạ vẫn lấy tên/số/presence từ Wazo. ContactService bổ sung hồ sơ backend theo từng lô tối đa 100 UUID, ghép bằng UUID; không ghép theo tên hiển thị. Department IdP có dữ liệu được ưu tiên hơn fallback Wazo. Chip, so khớp và bộ đếm phòng ban chuẩn hóa Unicode/khoảng trắng/hoa thường; lựa chọn tất cả đếm đúng toàn bộ danh bạ. Khi backend bổ sung chưa sẵn sàng, Web giữ danh bạ Wazo, không chặn gọi hoặc nhắn tin.

## Luồng avatar

1. Lấy profile.employee_id từ Single ID đã xác thực, không nhận EP ID tùy ý từ body frontend.
2. Lưu EP ID trong directory_profiles gắn tenant + UUID Wazo.
3. Frontend xin ảnh theo UUID qua backend cùng origin, với X-Auth-Token của user Wazo.
4. Backend xác minh token trên Wazo cố định và kiểm tra tenant. Tra EP ID từ DB rồi gọi URL ảnh cấu hình với query epid.
5. Backend trả byte ảnh; frontend tạo ObjectURL, hiển thị trong EmployeeAvatar. EP ID không nằm trong JSON danh bạ dùng chung hoặc URL ảnh mà browser gọi.

URL nguồn mặc định:

```dotenv
SMARTCALL_EMPLOYEE_PHOTO_URL=http://kor4.samsung.net/employee/empsearch/rest/v1/photo/tinythumb
```

Không đặt sẵn query epid vào biến cấu hình; backend gắn EP ID của từng user. Backend phải truy cập được mạng nội bộ này. Không forward Cookie/Authorization/token IdP hay Wazo sang host ảnh, không đi theo redirect. Nếu nguồn ảnh yêu cầu SSO/cookie riêng, cần có hợp đồng tích hợp được xác nhận; bản này không tự mượn phiên IdP để truy cập host khác.

Chỉ nhận JPEG/PNG/WebP/GIF tối đa 2 MB; HTML, SVG, trang đăng nhập hoặc ảnh lỗi đều fallback chữ viết tắt. API ảnh có no-store và nosniff. Proxy cùng origin giúp tránh browser tải trực tiếp nguồn HTTP từ Web HTTPS, đồng thời frontend không cần gọi cross-origin đến host ảnh.

EmployeeAvatar chỉ hiển thị, nhận loader qua Vue provide/inject ở main.js; ContactService sở hữu HTTP và cache. Thumbnail chỉ bắt đầu tải khi phần tử đi vào vùng nhìn (IntersectionObserver); request cùng UUID được gộp, lỗi được giữ tạm 60 giây; ảnh thành công dùng lại trong phiên. Logout/reset thu hồi ObjectURL và kết quả đến muộn không được cập nhật phiên mới.

Các vị trí áp dụng: avatar header, thẻ danh bạ, preview bàn phím, người gọi đến, cuộc gọi 1-1 đang hoạt động, danh sách mời thêm người, phòng tin nhắn trực tiếp và danh sách thành viên. Avatar chung của phòng/cuộc gọi nhóm vẫn giữ biểu tượng nhóm.

## Người khác thấy ảnh và department bằng cách nào?

Các máy cần dùng chung backend và database (và cùng tenant Wazo). User A đăng nhập Single ID qua backend đó ít nhất một lần sau cập nhật để lưu hồ sơ. User B đăng nhập bằng Single ID hoặc tài khoản Wazo thông thường đều có thể đọc hồ sơ/ảnh bằng token user Wazo đúng tenant. B tải lại danh bạ để nhận department/flag ảnh mới. Không cần public EP ID hoặc chia sẻ token IdP của A.

Nếu mỗi lập trình viên chạy backend localhost với file SQLite khác nhau, dữ liệu profile không tự đồng bộ. Cần trỏ proxy /api của các Web về backend chung; triển khai HTTPS/same origin phù hợp cấu hình phiên hiện có. Không trỏ frontend trực tiếp tới file SQLite qua mạng. Mobile và bản Web cũ chưa dùng API này thì chưa tự hiển thị avatar; không sửa Android trong lượt này.

Chưa có hồ sơ IdP thì chưa thể suy EP ID/department chỉ từ email Wazo. Không tự dựng dữ liệu cho những tài khoản đó. Chức năng lọc này áp dụng trên danh bạ Web đang tải được, không thay thế công việc phân trang toàn bộ danh bạ 2.000 người đã bàn trước đây.

## API mới

```http
GET /api/auth/directory-profiles?user_uuid=<uuid>&user_uuid=<uuid_khac>
X-Auth-Token: <token user Wazo>
```

Trả items gồm user_uuid, name, department, has_avatar. Tối đa 100 UUID/request; không trả employee_id, issuer, sub, email hoặc token khác.

```http
GET /api/auth/directory-profiles/<uuid>/avatar
X-Auth-Token: <token user Wazo>
```

Trả byte ảnh hoặc lỗi 401/403/404/502. Không dùng cookie Single ID để mở ảnh công khai. Các route đặt dưới /api/auth để dùng proxy đang có; đây vẫn là dữ liệu dành cho user đã xác thực Wazo.

## Cách test ở công ty

1. Pull nhánh refactor và khởi động lại cả backend lẫn frontend.
2. Đăng xuất, đăng nhập lại bằng Single ID. Bước wazo-session sẽ lưu profile vào bảng mới tự tạo.
3. Mở tab Bộ phận: kiểm tra tên phòng ban, lọc chip và đếm số người. Marker smartcall:sso không còn xuất hiện như phòng ban.
4. Kiểm tra avatar header/danh bạ. Nếu ảnh fallback, xem Network request directory-profiles/<uuid>/avatar; 404 có thể là chưa có profile/EP ID hoặc nguồn ảnh không trả ảnh.
5. Dùng browser/tài khoản khác cùng backend; tải lại danh bạ và kiểm tra avatar của A.
6. Nếu API hồ sơ 401/403: kiểm tra token user/tenant; nếu upstream photo lỗi: thử URL nguồn trên chính máy chạy backend, không chỉ trên browser người dùng. Backend không tự dùng proxy môi trường vì HTTP client hiện có đặt trust_env=False.

Công cụ manage_identity_db.py vẫn chỉ quản lý bảng identities. Xóa mapping không đồng nghĩa xóa hồ sơ directory_profiles hoặc tài khoản Wazo. Lần đăng nhập thành công mới sẽ cập nhật/chuyển profile theo UUID mới.

## Kiểm chứng

45/45 test backend và 187/187 test frontend (19 file) đạt; lint, architecture, build, format và pip check đạt. Có kiểm thử department đi vào bộ lọc, batch, marker SSO, provenance dữ liệu IdP, tenant/token, proxy không forward cookie/credential, giới hạn ảnh, cache/ObjectURL, logout và fallback UI. Chưa truy cập ảnh thật trên mạng công ty hoặc kiểm tra hiển thị bằng browser thật. Build còn cảnh báo chunk lớn đã có.
