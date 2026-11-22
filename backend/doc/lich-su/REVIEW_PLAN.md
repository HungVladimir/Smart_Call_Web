# Kế hoạch chỉnh sửa sau rà soát

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi. Xem [hướng dẫn vận hành hiện hành](../README.md) và [bàn giao](../HANDOFF.md).

## Đợt 1. Dọn mã và sửa lỗi nhỏ

- Đối chiếu toàn bộ frontend và test trước khi gỡ hàm. Giữ các điểm vào ghi âm phát, tải, bắt đầu và dừng đang được gọi.
- Dùng chung lượt tải danh bạ đang chạy theo phiên. Trả ba kết quả rõ ràng cho giao diện là dữ liệu mới, dữ liệu đang giữ và yêu cầu đã hủy. Kiểm tra dữ liệu rỗng hợp lệ và request cũ khi đổi phiên.
- Chuẩn hóa tên hồ sơ IdP và kiểm tra tên rỗng. Giữ kiểu dữ liệu và endpoint hiện tại.
- Thêm comment tiếng Việt vào các hàm thuộc phần chỉnh, đổi tên biến khó đọc và cập nhật hướng dẫn chạy frontend/backend.

## Đợt 2. Chuẩn hóa dữ liệu danh bạ khi tăng quy mô

- Đo số request, dung lượng phản hồi và thời gian hiển thị bằng dữ liệu được cấp quyền trong môi trường thử nghiệm.
- Kiểm tra khả năng phân trang, tìm kiếm và giới hạn danh sách UUID của Wazo Dird/Chatd. Tách phân trang dữ liệu khỏi phân trang hiển thị.
- Thiết kế tải presence cho danh sách đang hiển thị với giới hạn đồng thời. Kiểm tra những nơi vẫn cần tìm người ngoài trang hiện tại, gồm gọi máy lẻ, tra cứu phòng chat, gọi nhóm và favorites.

## Đợt 3. Đọc và chỉnh luồng chat, gọi nhóm theo từng phần

- Chat. Tách việc nạp phòng, ghép danh bạ, xác minh trạng thái nhóm đóng và giữ lựa chọn phòng. Kiểm tra huy hiệu, gửi lỗi, realtime và tải lại.
- Cuộc gọi. Tách xác định nhánh đang kết thúc, nhóm do host quản lý và dọn tài nguyên. Giữ A là host khi B mời C. Kiểm tra sự kiện đến muộn, host bị đăng xuất và fallback khi WebSocket mất kết nối.
- Giữ cấu trúc thư mục hiện tại. Ưu tiên hàm có tên và comment trước mỗi hàm. Chia commit theo hành vi để có thể review và quay lui riêng.

## Đợt riêng. Cấu hình môi trường

- Chuẩn bị cấu hình cục bộ và xác minh môi trường đang chạy trước khi bỏ theo dõi backend/.env. Xử lý xoay credential và tài khoản Wazo đã tạo bằng mật khẩu hiện tại cùng người phụ trách triển khai.
- Đợt này chỉ lập kế hoạch cho phần cấu hình. Các thay đổi vào credential đang chạy cần một phương án chuyển đổi riêng.
