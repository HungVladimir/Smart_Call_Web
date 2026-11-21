# Quản lý mapping SQLite để kiểm thử Single ID

Công cụ: `backend/manage_identity_db.py`. Chạy từ thư mục gốc dự án refactor. Đây là công cụ terminal cục bộ, không phải API quản trị và không mở thêm màn hình Web.

## Mapping là gì?

Bảng `identities` liên kết danh tính Single ID (issuer + ký tự NUL + sub), tenant Wazo, UUID Wazo, username auth và cờ managed. Không lưu mật khẩu hoặc token trong bảng. `sub` là claim định danh thật do IdP cấp; không tự lấy EP ID/email thay sub. Email duy nhất và cố định được dùng để tạo username nhưng khóa liên kết vẫn là issuer/sub + tenant.

Công cụ chỉ chỉnh SQLite; không tạo/xóa tài khoản Wazo, không logout Redis và không thu hồi token đã cấp. Khi sửa mapping để test, dừng backend trước và đăng xuất phiên Web trước lần thử mới. Các lệnh ghi tự sao lưu DB hiện có bằng SQLite backup API; file backup nằm cạnh DB với hậu tố `.backup-<thời gian UTC>-<mã>`. Lệnh thêm không ghi đè dòng đã tồn tại. Lệnh xóa buộc có cả tenant và UUID, không có lệnh xóa tất cả.

## Xem dữ liệu

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/manage_identity_db.py list
```

Mặc định đường dẫn lấy từ Settings, gồm SMARTCALL_DATABASE_PATH nếu đã cấu hình; mặc định backend/data/identity.sqlite3. Muốn chọn file khác, đặt --db trước tên lệnh:

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/manage_identity_db.py --db "D:\Project\Smart_Call_Web_Refactor\backend\data\identity.sqlite3" list
.\backend\.venv\Scripts\python.exe -X utf8 backend/manage_identity_db.py list --username "vhung99.nguyen"
```

Output JSON tách identity thành issuer và subject dễ đọc. Có thể dùng SQLite Viewer trong VS Code để xem bảng, nhưng công cụ này không yêu cầu cài extension.

## Xóa một liên kết để test tạo lại

Sau khi xác nhận đã xóa user trên Wazo, lấy UUID từ lệnh list rồi chạy:

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/manage_identity_db.py delete --tenant "0e9ab2d3-5a36-4c35-b1de-91e06ddde771" --user-uuid "UUID_USER_DA_XOA"
```

Thay UUID_USER_DA_XOA bằng UUID thật, không phải số máy lẻ. Công cụ in đường dẫn backup và số dòng đã xóa. Không có dòng phù hợp trả mã lỗi 1, không giả báo thành công.

Khởi động lại backend và đăng nhập Single ID: không có mapping thì tìm theo email; không có user mới tạo. Nếu user vẫn tồn tại trên Wazo, backend tìm lại user và áp dụng quy tắc liên kết, không cố tạo thêm. Nếu tài khoản xác thực username còn sót hoặc có tài nguyên bị trùng trên Wazo thì việc tạo mới có thể bị từ chối; xóa SQLite không xử lý được tài nguyên trên server.

## Thêm mapping thủ công

Chỉ dùng với tài khoản Wazo thật đã kiểm tra đúng người. Điền issuer/sub thật của danh tính IdP, tenant, UUID Wazo và username auth thật. Lệnh này không tự xác minh quyền sở hữu qua IdP/Wazo, vì vậy mapping sai có thể liên kết sai tài khoản.

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/manage_identity_db.py add --issuer "ISSUER_THAT_CUA_IDP" --subject "SUB_THAT_CUA_USER" --tenant "TENANT_UUID" --user-uuid "WAZO_USER_UUID" --username "USERNAME_AUTH_THAT"
```

Mặc định managed=false. Chỉ thêm --managed khi đã xác nhận đây là tài khoản do luồng SmartCall quản lý; cờ này cho phép backend thử mật khẩu cấu hình và kiểm tra/sửa tên SIP endpoint khi đăng nhập. Không dùng cờ đó để tự tiếp quản tài khoản cũ do quản trị tạo.

Nếu chỉ thay username mong muốn, đừng xóa/thêm mapping để giả đổi tên: username trên Wazo vẫn giữ nguyên. Công cụ không rename tài khoản Wazo.

## Khôi phục sau khi sửa nhầm

Dừng backend, giữ lại file DB hiện tại để đối chiếu rồi sao chép đúng backup cần phục hồi về đường dẫn DB. Nên dùng một công cụ SQLite nếu DB đang có journal/WAL; không thay file khi tiến trình khác đang mở database. Backup chứa liên kết danh tính nên quản lý cùng phạm vi truy cập với DB gốc.

## Tự phục hồi UUID đã xóa

Backend mới không bắt buộc phải xóa mapping bằng tay: nếu GET user theo UUID đã lưu trả đúng HTTP 404, backend tìm lại theo email, tạo nếu cần, rồi thay binding bằng kiểm tra UUID cũ trong SQLite. Nếu HTTP 401/403/timeout thì dừng, không coi là đã xóa. Nếu bước tạo/tra cứu thất bại thì mapping cũ được giữ để kiểm tra lại. Không tự xóa auth/line/tài nguyên còn sót trên Wazo.

## Một request tạo tài khoản

Backend đọc user/context/template/extension trước để kiểm tra tài nguyên. Khi tạo, gửi đúng một POST /api/confd/1.1/users với JSON gộp firstname, lastname, email, userfield, auth, lines[].endpoint_sip, lines[].extensions. Không request từng trường riêng. Xin token sau tạo là một request khác đến /api/auth/0.1/token.

Username auth mới là phần trước @ của email. SIP username/password là credential riêng; payload mới đặt endpoint_sip.name bằng SIP username. Với tài khoản managed cũ, backend GET endpoint chính dạng merged, và chỉ PUT name nếu lệch SIP username. Đây là bước sửa cấu hình thoại, không tạo lại user, không đổi mật khẩu.

## Phạm vi kiểm chứng

38 test backend và 178 test frontend đạt; lint, kiểm tra kiến trúc, build, định dạng và dependency đạt. Test DB chỉ dùng file tạm. Chưa gọi sửa/tạo/xóa tài khoản thật trên server công ty; cần test lại SIP Registered sau khi cập nhật. Nếu vẫn Unregistered, lấy mã phản hồi REGISTER và endpoint merged để chẩn đoán tiếp. Chưa thể khẳng định name là nguyên nhân duy nhất trên server.
