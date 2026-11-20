# Quy tắc làm việc trong bản refactor SmartCall Web

- Phạm vi sửa: duy nhất `D:/Project/Smart_Call_Web_Refactor`. Giữ nguyên bản gốc `D:/Project/Smart_Call_Web`.
- Đây là sản phẩm Web. Mã Vue nằm trong `frontend/`; `backend/` chuẩn bị cho API/IdP; `FileQuest/` chỉ là tài liệu tham khảo Android.
- Người dùng đã cho phép tự phân tích, refactor và sửa lỗi liên quan trong bản clone.
- Làm việc trên `codex/refactor-architecture`, không cập nhật `main`.
- Tên biến/hàm/lớp dùng tiếng Anh rõ nghĩa; comment giải thích và tài liệu dùng tiếng Việt, UTF-8.
- Không thêm lại ghim tin, read receipts, trạng thái đã gửi/đã xem hoặc bộ đếm chưa đọc.
- Không chèn dữ liệu mẫu vào ứng dụng. Fixture chỉ thuộc bộ kiểm thử.
- Không tự giả định giao thức IdP, token exchange, API membership hoặc phân quyền chưa có hợp đồng.
- Mỗi nhóm state có chủ sở hữu. HTTP/socket/SDK không tự import ngược giao diện hoặc điểm lắp ghép dịch vụ.
- Component gọi lệnh nghiệp vụ; không tự tạo URL/header HTTP. Hàm mapper không sửa state.
- Tác vụ bất đồng bộ phải kiểm tra phiên/thế hệ trước khi cập nhật state; tài nguyên phải có đường cleanup.
- Không báo thành công thao tác ghi khi API chưa xác nhận. Kết quả từng phần phải thể hiện đúng.
- Cập nhật `doc/refactor/PROGRESS.md` khi thay đổi kiến trúc/hành vi; chạy các bước trong `VERIFICATION.md`.
- Tài liệu chính: `doc/refactor/ARCHITECTURE.md`, `DEVELOPMENT_GUIDE.md`.
- `GEMINI.md` là hướng dẫn lịch sử. Khi mâu thuẫn với phạm vi/cấu trúc/yêu cầu mới, áp dụng yêu cầu hiện tại và quy tắc trong file này.

- Cấu trúc hiện hành (20/11/2026) là views/components/services/state/composables/utils/router/config/assets. Không dựng lại app/core/features/shared hoặc tạo thư mục chỉ để chứa một helper.
- Component hiển thị phát event; View gọi command của service. CallsView dùng ActiveCallPanel, ContactsPanel/ContactCard và AddParticipantModal. Cập nhật doc/HUONG_DAN_FRONTEND_CHO_NGUOI_MOI.md khi thay đổi luồng/đường dẫn.

- Services được gom một cấp theo auth/calls/audio/realtime/data/common; giữ index.js/createServices.js ở gốc. Không thêm các tầng con cho từng lớp khái niệm.

- Trước hàm/method/getter/computed có tên, thêm comment tiếng Việt nêu công việc và tác động đáng chú ý. Guard quan trọng về phiên, quyền, SIP/conference ID, ACK HTTP và cleanup cần giải thích lý do; cập nhật comment khi logic đổi.
