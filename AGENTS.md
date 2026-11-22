# Quy tắc làm việc trong bản refactor SmartCall Web

- Phạm vi sửa: duy nhất `D:/Project/Smart_Call_Web_Refactor`. Giữ nguyên bản gốc `D:/Project/Smart_Call_Web`.
- Đây là sản phẩm Web. Mã Vue nằm trong `frontend/`; `backend/` triển khai FastAPI Single ID và cấp tài khoản Wazo; `FileQuest/` chỉ là tài liệu tham khảo Android.
- Người dùng đã cho phép tự phân tích, refactor và sửa lỗi liên quan trong bản clone.
- Làm việc trên `codex/refactor-architecture`, không cập nhật `main`.
- Tên biến/hàm/lớp dùng tiếng Anh rõ nghĩa; comment giải thích và tài liệu dùng tiếng Việt, UTF-8.
- Ưu tiên tách callback/lambda thành hàm có tên rõ nghĩa thay vì viết biểu thức rút gọn hoặc lồng nhiều callback. Áp dụng cho `.map()`, `.filter()`, promise chains, event handlers, Vue lifecycle hooks, `watch`/`computed` và callback SDK. Hàm có tên giúp người mới lần theo luồng, đặt breakpoint và đọc stack trace dễ hơn.
- Chỉ giữ lambda inline khi thật sự ngắn, một biểu thức đơn giản và mục đích đã rõ ngay tại chỗ; nếu có điều kiện, xử lý lỗi, side effect, nhiều bước hoặc tên tham số viết tắt thì phải tách thành hàm có tên. Không dùng tên chung chung như `fn`, `cb`, `x`, `e` khi có thể đặt tên theo vai trò.
- Comment tiếng Việt ngay trước mỗi khai báo hàm/method/getter/computed, handler, callback có tên và hàm trong test. Comment giải thích hàm dùng để làm gì, được gọi trong trường hợp nào và tác động phụ/giá trị trả về quan trọng; có thể viết dài để người mới hiểu, không cần hạn chế số lượng comment.
- Với callback bắt buộc truyền inline cho API/framework, nếu callback không hiển nhiên thì ưu tiên khai báo hàm có tên và comment trước đó rồi truyền tên hàm vào. Không cố nhồi comment vào giữa lời gọi API.
- Trước guard/điều kiện quan trọng, giải thích vì sao phải kiểm tra và hậu quả nếu bỏ qua; cập nhật hoặc xóa comment khi logic thay đổi để tránh tài liệu sai lệch.
- Không thêm lại ghim tin, read receipts hoặc trạng thái đã gửi/đã xem. Theo yêu cầu mới 20/11/2026, khôi phục badge tin đến chưa mở và tạm lưu metadata bộ đếm qua localStorage, tách theo host/UUID; không lưu nội dung phòng/tin nhắn.
- Không chèn dữ liệu mẫu vào ứng dụng. Fixture chỉ thuộc bộ kiểm thử.
- Không tự giả định giao thức IdP, token exchange, API membership hoặc phân quyền chưa có hợp đồng.
- Mỗi nhóm state có chủ sở hữu. HTTP/socket/SDK không tự import ngược giao diện hoặc điểm lắp ghép dịch vụ.
- Component gọi lệnh nghiệp vụ; không tự tạo URL/header HTTP. Hàm mapper không sửa state.
- Tác vụ bất đồng bộ phải kiểm tra phiên/thế hệ trước khi cập nhật state; tài nguyên phải có đường cleanup.
- Người gọi ban đầu luôn giữ host: A gọi B, B thêm C thì B gửi ADD_REQ cho A; A gọi/ghép C. A cúp giải tán nhóm, thành viên rời không tự chuyển host. Không coi call_ended khi chuyển vào ConfBridge là rời hội nghị.
- Không báo thành công thao tác ghi khi API chưa xác nhận. Kết quả từng phần phải thể hiện đúng.
- Cập nhật `doc/refactor/PROGRESS.md` khi thay đổi kiến trúc/hành vi; chạy các bước trong `VERIFICATION.md`.
- Tài liệu chính: `doc/refactor/ARCHITECTURE.md`, `DEVELOPMENT_GUIDE.md`.
- `GEMINI.md` là hướng dẫn lịch sử. Khi mâu thuẫn với phạm vi/cấu trúc/yêu cầu mới, áp dụng yêu cầu hiện tại và quy tắc trong file này.

- Cấu trúc hiện hành (20/11/2026) là views/components/services/state/composables/utils/router/config/assets. Không dựng lại app/core/features/shared hoặc tạo thư mục chỉ để chứa một helper.
- Component hiển thị phát event; View gọi command của service. CallsView dùng ActiveCallPanel, ContactsPanel/ContactCard và AddParticipantModal. Cập nhật doc/HUONG_DAN_FRONTEND_CHO_NGUOI_MOI.md khi thay đổi luồng/đường dẫn.

- Services được gom một cấp theo auth/calls/audio/realtime/data/common; giữ index.js/createServices.js ở gốc. Không thêm các tầng con cho từng lớp khái niệm.

- Trước hàm/method/getter/computed có tên, thêm comment tiếng Việt nêu công việc và tác động đáng chú ý. Guard quan trọng về phiên, quyền, SIP/conference ID, ACK HTTP và cleanup cần giải thích lý do; cập nhật comment khi logic đổi.

- Hiển thị nhóm chỉ đếm người đã kết nối; người đang mời tách riêng. Đồng bộ snapshot có revision và xin lại khi nhận máy/reconnect; không dùng groupTitle cũ để tính số.

- Single ID dùng OIDC Authorization Code; không coi token IdP là token Wazo. Cấp phát qua backend với credential quản trị riêng, chỉ trả token user cho SDK. Không reset mật khẩu tài khoản cũ; mật khẩu 12345 chỉ là mặc định thử nghiệm theo yêu cầu người dùng. Ngoại lệ người dùng ngày 21/11/2026: backend/.env được track/push dù chứa credential; tài liệu và cấu hình đầu vào cục bộ trong backend/doc thuộc diện Git ignore.

