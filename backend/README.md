# Backend — phạm vi chuẩn bị

Thư mục cùng cấp với frontend, dành cho các API Web và tích hợp IdP sắp tới. **Hiện chưa có backend chạy, framework, database schema hoặc API đã triển khai.**

Mã Android trong FileQuest chỉ dùng đối chiếu nghiệp vụ và giao thức Wazo. Không đưa mã Android vào runtime frontend/backend.

## Những thông tin cần có trước khi triển khai

1. Project mẫu/tài liệu kết nối IdP: giao thức thực tế, issuer/metadata, callback/logout, đăng ký client và môi trường.
2. Quy trình liên kết tài khoản IdP với Wazo: định danh ổn định, quyền truy cập và người phụ trách cấu hình.
3. Hợp đồng API cần dùng: ai được lấy dữ liệu nào, lỗi trả về, cách hết hạn/thu hồi phiên.
4. Nếu ứng dụng di động dùng API backend về sau: xác định riêng kiểu client, cách nhận credential và quyền truy cập; không mặc định dùng lại cookie trình duyệt.
5. Yêu cầu lưu dữ liệu, triển khai, logging và bảo vệ thông tin nhạy cảm.

## Hướng tổ chức dự kiến

Khi có hợp đồng, tách API nhận request, dịch vụ nghiệp vụ, adapter IdP/Wazo và persistence. Chọn tên thư mục theo framework backend thực tế; chưa tạo controller hoặc endpoint giả chỉ để lấp cấu trúc.

Frontend gọi backend qua một API client riêng, rồi ánh xạ dữ liệu về model của feature. Giữ token/secret riêng của server ở backend; không đưa vào biến VITE_*.

Việc chuyển xác thực sang backend cần xử lý đồng thời hợp đồng phiên, refresh/logout và liên kết Wazo. Không thay URL các dịch vụ hiện tại bằng endpoint chưa tồn tại.
