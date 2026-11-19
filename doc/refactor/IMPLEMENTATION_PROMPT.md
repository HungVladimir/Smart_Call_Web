# Prompt triển khai refactor SmartCall Web

## Vai trò và mục tiêu

Bạn là kiến trúc sư phần mềm đồng thời trực tiếp triển khai. Phân tích mã thực tế, thiết kế kiến trúc Web dễ đọc, rồi thực hiện refactor có kiểm chứng. Cải thiện khả năng bảo trì/mở rộng và sửa lỗi có bằng chứng trong phạm vi liên quan.

## Phạm vi được phép

- Chỉ sửa trong D:/Project/Smart_Call_Web_Refactor.
- Không sửa bản gốc D:/Project/Smart_Call_Web.
- Dùng branch codex/refactor-architecture, không cập nhật main.
- Frontend Vue đặt trong frontend/. Backend chuẩn bị API/IdP đặt cùng cấp.
- FileQuest và SMCApp2/codeApp là tham chiếu Android; không coi là sản phẩm cần refactor hoặc runtime Web.
- Có quyền thêm, sửa, xóa mã trong bản clone; không cần hỏi lại cho thay đổi thuộc phạm vi được giao.

## Nguyên tắc thiết kế

1. Trình bày sơ đồ kiến trúc, cây thư mục và luồng trước khi sửa.
2. Xác minh bố cục thực tế thay vì mặc định mô tả của người dùng đã trùng filesystem.
3. Gom theo feature: auth, calls, contacts, messages, history, settings.
4. Điểm lắp ghép dịch vụ thuộc app; core chứa session, HTTP, sự kiện và adapter hạ tầng. Không để service import ngược app hoặc tạo vòng import.
5. Component nhận state/phát ý định; service/controller thực hiện nghiệp vụ. Mapper chuẩn hóa DTO là hàm thuần. Composable quản lý vòng đời UI.
6. Mỗi state có chủ sở hữu rõ ràng. Không lưu snapshot mất reactivity khi service thay mảng.
7. Cô lập các can thiệp nội bộ SDK, giữ protocol/endpoint hiện hành khi chưa có bằng chứng cần đổi.
8. Không tạo tầng repository/interface rỗng cho mọi file chỉ để đạt một mẫu kiến trúc.
9. Không thay framework/router/SDK hoặc chuyển toàn bộ sang TypeScript khi không cần cho mục tiêu hiện tại.

## Yêu cầu hành vi

- Bảo toàn đăng nhập/khôi phục/logout, gọi/nhận/từ chối/cúp/mute/DTMF, gọi nhóm, danh bạ/presence/yêu thích, chat, lịch sử, ghi âm và cấu hình đã được hỗ trợ.
- Không đưa lại ghim tin, trạng thái gửi/đọc, danh sách người đọc, bộ đếm chưa đọc.
- Loại bỏ token giả và đường đăng nhập dữ liệu mẫu khỏi sản phẩm.
- Chặn response, callback, timer của phiên/cuộc gọi cũ tác động vào state mới.
- Nghe máy chưa có ACK không được báo connected; chỉ SDK xác nhận đăng ký mới được báo SIP sẵn sàng.
- Thao tác ghi phải kiểm tra HTTP; lỗi từng phần không được báo thành công toàn bộ.
- Khi dọn mic/audio/socket phải xử lý cả tài nguyên trả về muộn.
- Khi phát hiện lỗi: chỉ ra trigger, sửa tại đúng owner, thêm kiểm chứng phù hợp và ghi nhật ký.
- Không triển khai IdP, RBAC/membership hoặc backend endpoint dựa trên phỏng đoán. Ghi rõ phần cần hợp đồng.

## Quy ước đọc hiểu

Tên lớp dùng PascalCase, hàm/biến camelCase rõ nghĩa. Phân biệt lệnh mạng, truy vấn state, phép kiểm tra và hàm chuyển đổi. Comment tiếng Việt giải thích mục đích, nguyên nhân, ràng buộc, cleanup hoặc khác biệt giao thức; không lặp lại từng dòng lệnh. Tài liệu dùng tiếng Việt và UTF-8.

## Quy trình

1. Ghi baseline Git, kiểm thử/build, phạm vi dữ liệu và các dependency.
2. Chuyển Web vào frontend; giữ cấu hình và tài nguyên đi cùng.
3. Tách dịch vụ lớn theo trách nhiệm, inject dependency và loại import cycle.
4. Tách state, mapper, composable, component ở những chỗ có lợi ích cụ thể.
5. Sửa các lỗi đã chứng minh, giữ dữ liệu nghiệp vụ trên server.
6. Thay kiểm thử lệ thuộc vị trí source bằng kiểm thử module thật và Vue component thật; mock tại ranh giới mạng/SDK.
7. Chạy lint, kiểm tra ranh giới import, test, format và build; xác minh cài đặt từ lockfile.
8. Mở Web cục bộ để kiểm tra hiển thị; không dùng credential thật hoặc gửi request nghiệp vụ tới production khi chưa có yêu cầu.
9. Cập nhật kiến trúc, luồng đọc code, nhật ký, kiểm chứng và giới hạn tích hợp.
10. Kiểm tra diff, secret/ignore và bản gốc trước khi commit lên nhánh refactor đã được cho phép.

## Điều kiện bàn giao

Cấu trúc và luồng phản ánh code thật, frontend chạy/build được, các kiểm tra đã ghi có kết quả thực tế, không sửa ngoài clone, không có dữ liệu giả hoặc tính năng đã bỏ. Phân biệt rõ kiểm thử tự động với tích hợp tổng đài/IdP chưa thực hiện. Không tuyên bố không còn lỗi hoặc đã tối ưu hiệu năng nếu chưa đo.
