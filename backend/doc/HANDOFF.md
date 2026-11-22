# Bàn giao rà soát backend SmartCall

## Trạng thái

- Workspace phát triển là D:/Project/Smart_Call_Web_Refactor. Commit và push vào codex/refactor-architecture.
- Người dùng đã xác nhận đăng nhập Single ID hoạt động trước đợt rà soát. Ưu tiên giữ nguyên hợp đồng Frontend, IdP và Wazo.
- Đã rà các module Python của ứng dụng và hai tiện ích quản trị. Đợt rà soát ban đầu ghi nhận 43 ca backend. Phiên này dùng các dịch vụ mô phỏng khi kiểm tra logic.
- backend/.env và phần chạy trực tiếp cuối backend/main.py là chỉnh sửa cục bộ đã có từ trước. Giữ nguyên khi làm tiếp. Không in cấu hình bí mật.
- Tài liệu vận hành và bàn giao nằm trong `backend/doc/`. Hai tiện ích cục bộ và bộ test có quy tắc ignore riêng.

## Luồng cần giữ

1. main.py kiểm tra cookie giao dịch và state ở callback. Redis lấy và xóa giao dịch trong một thao tác.
2. oidc.py đổi code, xác minh chữ ký, issuer, audience, nonce và chính sách email, rồi tạo hồ sơ và thời hạn phiên. Vue nhận hồ sơ qua user_info.
3. wazo.py khóa cấp phát theo tenant Redis, ưu tiên UUID đã lưu trong SQLite. Nếu Wazo trả 404 cho UUID đó, tìm lại theo email. Lỗi quyền hoặc lỗi mạng phải dừng thay vì tạo tài khoản mới.
4. Cấp mới sử dụng một POST Confd sau khi tìm context, SIP template và máy lẻ trống. Tên SIP endpoint phải khớp SIP username để WebRTC đăng ký được.
5. Chỉ giao token sau khi xác nhận UUID trong token Wazo đúng tài khoản. Department ghi vào description. Thiếu department thì giữ mô tả cũ.
6. store.py quản lý TTL Redis và mapping SQLite. Tiện ích manage_identity_db.py sao lưu trước thao tác ghi. Tiện ích import_reference_env.py yêu cầu chỉ định đường dẫn nguồn qua --reference FILE.

## Phần đã thực hiện

- Tách đổi code, xác minh ID token và dựng hồ sơ thành các hàm có tên rõ nghĩa.
- Tách các bước tìm tài khoản, xác định username, tìm context và template, chọn máy lẻ và dựng dữ liệu tạo user.
- Viết comment tiếng Việt ngay trước các hàm Python ứng dụng. Giải thích điều kiện bảo vệ phiên và cấp phát tại chỗ.
- Tập trung tài liệu vận hành và SQLite vào backend/doc. Xem [hướng dẫn vận hành và SQLite](README.md).

## Khi tiếp tục

- Đọc AGENTS.md ở gốc clone. Đối chiếu git status và git log -5 trước khi sửa.
- Có thể chạy từ gốc clone: .\\backend\\.venv\\Scripts\\python.exe -X utf8 -m unittest discover -s backend/tests.
- Khi kiểm tra môi trường thực tế, xác nhận lần lượt callback Single ID, cấp phiên Wazo, trạng thái SIP, cuộc gọi và description. Kết quả unit test không thay thế các bước này.

## Rà soát và dọn mã sau khi lên nhánh refactor

- Đợt 1 hoàn tất. Đã bỏ bảy hàm không có nơi gọi và một điều kiện rỗng. Danh bạ gộp lượt tải theo phiên và phân biệt kết quả mới, dữ liệu cũ, yêu cầu hủy. Tên IdP trắng dùng thuộc tính tên tiếp theo hoặc email phù hợp.
- Đã kiểm tra lint, kiến trúc, build, 188 test frontend và 44 test backend. Build còn cảnh báo kích thước chunk. Chưa thử IdP và Wazo thật trong đợt này.

## Kế hoạch còn lại

| Hạng mục | Việc cần làm |
| --- | --- |
| Danh bạ quy mô lớn | Đo số request, dung lượng và thời gian. Xác minh phân trang Dird/Chatd, tách phân trang dữ liệu khỏi hiển thị, giới hạn tải presence đồng thời và giữ khả năng tra cứu ngoài trang. |
| Chat | Chia theo luồng nạp phòng, ghép danh bạ, xác minh phòng đóng và giữ phòng đang chọn. Kiểm tra badge, gửi lỗi, realtime và tải lại. |
| Cuộc gọi | Làm rõ nhánh kết thúc, quyền host và cleanup. Giữ A làm host; kiểm tra sự kiện muộn, thu hồi phiên và WebSocket mất kết nối. |
| Cấu hình môi trường | Đây là hạng mục riêng. Cần phương án chuyển đổi đã xác nhận trước khi thay đổi cấu hình hoặc credential đang dùng. |

[Kế hoạch rà soát gốc](lich-su/REVIEW_PLAN.md) ghi lại phạm vi ban đầu. Xem [kiểm chứng](../../doc/refactor/VERIFICATION.md) để phân biệt kết quả test cục bộ với xác nhận IdP/Wazo thật.
