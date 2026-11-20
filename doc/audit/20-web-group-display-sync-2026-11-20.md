# Đồng bộ hiển thị nhóm giữa các máy Web — 20/11/2026

Người dùng xác nhận A/B/C đều là Web. Chỉ sửa dự án gốc; chưa chuyển bản sửa này sang refactor.

## Nguyên nhân

- groupParticipantExtensions chứa cả người đang mời nhưng View đếm toàn bộ như đã tham gia.
- groupTitle lưu số cũ được ưu tiên hơn state hiện tại.
- GROUP gửi trước incoming bị C bỏ qua, không có cơ chế xin lại.
- talking_to nhiều peer sau ghép có thể ghi đè ID B/C vào cùng máy lẻ.

## Bản sửa

Giữ danh sách được mời để xác thực quyền; thêm groupConnectedExtensions và groupPendingExtensions cho hiển thị. Nâng từ A–B lên nhóm khởi tạo hai người kết nối; C chỉ được tính sau SDK accepted hoặc Calld xác nhận talking/holding. View dùng số kết nối, không dùng tiêu đề cũ hoặc mặc định ba người.

Host giữ GROUP cho danh sách lời mời và thêm GROUP_STATE gồm ID nhóm, revision, danh sách kết nối và ACK request tùy chọn. Máy nhận bỏ revision cũ, snapshot sai thành viên và scope khác; chỉ phản hồi đúng request hiện tại được sửa scope đã lỡ bind. GROUP legacy không ghi đè snapshot hiện đại đã xác nhận.

Máy nhận gửi GROUP_SYNC khi incoming, accepted và socket mở lại. Host chỉ trả lời UUID thuộc danh sách đã mời, gộp request lặp. Việc xin lại giúp C nhận trạng thái dù GROUP ban đầu tới trước incoming. Request chờ danh bạ kiểm tra phiên/thế hệ/nhánh trước khi gửi; cúp máy dọn ID/request/snapshot.

Giữ ánh xạ call ID đã biết khi talking_to có nhiều peer; không gán mọi ID vào activeCall.number. Dọn người đang mời khi SDK lỗi/trả null. Timeout kiểm tra riêng nhánh đã nghe, không dựa vào trạng thái connected chung của cả nhóm.

## Kiểm chứng

- 110/110 test đạt, thêm 12 ca: ba VM Web độc lập, C bỏ lỡ GROUP ban đầu, đang mời/đã nghe, revision đảo thứ tự, scope/ACK, metadata sai, View với title cũ, từ chối/timeout, C nghe trước B, Calld bổ sung accepted, ID sau merge, cúp khi chờ danh bạ, lỗi/null SDK, reconnect và cleanup.
- npm run build thành công; cảnh báo bundle lớn vẫn còn.
- Chưa gọi trên tổng đài thật. Cả ba máy cần cập nhật cùng bản Web rồi kiểm tra lại. Giao thức mới là tín hiệu ứng dụng trên presence hiện có, không phải API Wazo mới; không xác nhận hành vi của Android legacy.

## Thử lại

1. A gọi B, B thêm C: A/B hiện hai người và C đang kết nối.
2. C nghe: cả ba hiện giao diện nhóm, ba người, không còn C trong đang kết nối.
3. C từ chối/không nghe: giữ hai người; B hoặc C rời chỉ giảm đúng người.
4. A cúp kết thúc nhóm; gọi lại không mang snapshot cũ.
5. Mở lại kết nối sự kiện ở máy thành viên: xin lại snapshot của host.
