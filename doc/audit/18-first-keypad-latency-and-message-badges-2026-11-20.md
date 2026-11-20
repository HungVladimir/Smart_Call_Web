# Phím số lần đầu và badge tin nhắn đến — 20/11/2026

## Yêu cầu

1. Xử lý việc lần bấm phím số đầu tiên sau đăng nhập bị khựng 3–4 giây; những lần sau không gặp lại.
2. Khôi phục badge tin nhắn ở menu Tin nhắn và từng hội thoại, nhận tin từ cả Web và Mobile. Không khôi phục ghim hoặc trạng thái đã gửi/đã xem của người nhận.

## Đường xử lý gây chặn phím số

Trước sửa, `CallsView.pressKey()` gọi `audioService.playDtmfTone()` trước khi thêm ký tự vào số đang quay. Hàm phát tiếng phím gọi `_getAudioContext()`, tạo `new AudioContext()` đồng bộ ở lần đầu. Khởi tạo thiết bị/driver âm thanh là đường có thể giữ luồng giao diện trước khi Vue hiển thị số.

Điều này phù hợp với hiện tượng chỉ chậm lần đầu: singleton AudioService giữ AudioContext qua logout/login. Chưa có performance trace của máy bị lỗi, nên không khẳng định đã đo được chính xác 3–4 giây nằm trong constructor.

### Thay đổi

- Nhập số và gửi DTMF tới tổng đài diễn ra trước tiếng phản hồi cục bộ.
- Tiếng phím chuyển sang WAV PCM mono ngắn, tạo từ hai tần số DTMF chuẩn và phát bằng HTMLAudio. Không gọi AudioContext trên đường bấm phím, không di chuyển bước mở AudioContext sang một chỗ khác trong thao tác nhập.
- Dùng một audio element và tối đa 12 URL âm phím trong RAM; không tải tài nguyên ngoài hoặc xin microphone để phát tiếng phím.
- `play()` không được await. Lỗi autoplay, thiết bị hoặc tạo audio không chặn nhập số và không tạo unhandled rejection.
- Dừng cuộc gọi/dừng mọi âm thanh cũng dừng tiếng phím. Lỗi thiết bị trong cleanup không làm ngắt luồng dọn cuộc gọi.
- Chuông đến/chuông chờ vẫn dùng Web Audio theo cơ chế hiện có; đây không phải thay thế toàn bộ audio của SDK.

## Badge mới hoạt động như thế nào?

`chatService` giữ một nguồn reactive duy nhất: mỗi room có tập UUID tin đến chưa mở. Menu đọc `totalUnread`; danh sách hội thoại đọc `getUnreadCount(room.id)`.

```text
WebSocket nhận tin Web/Mobile
  → Chuẩn hóa room, UUID tin, UUID người gửi và thời gian
  → Nạp/xác minh metadata nếu chưa biết phòng
  → Xử lý lệnh quản trị tin cậy theo cơ chế hiện có
  → Khử trùng UUID tin đã nhận trong phiên
  → Nếu tin của người khác và phòng chưa được mở xem: tăng badge
  → Menu và dòng hội thoại cùng cập nhật từ một state
```

### Các điều kiện quan trọng

- Nhận cả payload trực tiếp và payload nằm trong `message`, với room dạng `room_uuid` hoặc `room.uuid`. ID của message bên trong được ưu tiên hơn ID envelope bên ngoài.
- Hai event `chatd_user_room_message_created` / `chatd_user_message_created` không đếm trùng cùng UUID.
- Không đếm tin của chính tài khoản đang đăng nhập, kể cả echo từ thiết bị khác. UUID thật quyết định người gửi; alias và metadata chuyển tiếp không thay thế danh tính.
- Không tăng số cho lệnh quản trị đã được xác minh. Text giống lệnh nhưng không đủ quyền vẫn là tin nhắn thường theo cơ chế bảo vệ hiện có.
- Không tự tạo ID để đếm event thiếu UUID/id server; không đếm khi chưa xác định được người gửi.
- Nếu REST đã nạp tin trước khi callback WebSocket xử lý, tin đến vẫn được tính một lần. Refresh danh sách tạo object room mới không làm mất số, vì số được quản lý độc lập theo room ID.
- Mở một hội thoại chỉ xóa số của hội thoại đó; giữ tập UUID đã thấy để event lặp không làm số tăng lại.
- Đang ở trang khác hoặc MessagesView bị KeepAlive/deactivate thì vẫn nhận số. Tab bị ẩn hoặc cửa sổ mất focus cũng không tự coi là đang xem.
- Khi quay lại hội thoại đang chọn hoặc cửa sổ nhận focus, số được xóa nếu phòng thực sự đang hiển thị.
- Xóa tin bằng lệnh quản trị loại UUID đó khỏi tập chưa mở; đóng phòng và logout dọn bộ đếm. Kết quả nạp phòng của phiên cũ không phục hồi badge sau logout.

## Giới hạn của bộ đếm

Đây là **bộ đếm tin đến chưa mở trong phiên Web hiện tại**, không phải read receipt và không phải tổng lịch sử tin nhắn trong phòng. Tin cũ lấy qua REST không tự biến thành tin chưa đọc.

Đặc tả Chatd hiện có cho phép lấy/gửi tin và lấy phòng, nhưng chưa xác nhận API lưu mốc đọc theo user/room. Vì vậy:

- Không ghi bộ đếm hoặc lịch sử đọc vào localStorage/IndexedDB.
- F5, đóng tab hoặc logout làm mất trạng thái đếm trong RAM.
- Mở tin ở thiết bị khác chưa đồng bộ xóa badge trên Web này.
- Muốn giữ số chính xác qua reload/thiết bị cần hợp đồng read cursor/unread từ server/backend, không suy từ toàn bộ lịch sử hoặc tự tạo endpoint.

Mã Android không bị chỉnh sửa. Các kiểm thử nhận tin dùng các dạng payload WebSocket tương ứng, chưa phải thử gửi/nhận bằng điện thoại thật trên tổng đài.

## Kiểm chứng

- `npm test`: **93/93 đạt**, thêm 11 ca sau bản sửa host.
- Ba ca phím số: không tạo AudioContext kể cả lần đầu; cache/tái sử dụng audio và bắt Promise lỗi; cập nhật số/gửi DTMF trước tiếng phím; thiết bị âm thanh lỗi vẫn nhập được.
- Các ca badge: Web/Mobile, khử trùng, tổng số/từng phòng, self echo, lệnh quản trị, tab ẩn/mất focus, lịch sử REST đến trước event, phòng mới, refresh, xóa tin/đóng phòng, logout và callback muộn.
- Một ca compile nguyên Sidebar và MessagesView, mount bằng Vue renderer thật cùng KeepAlive: xác nhận hai badge hiển thị cùng số, chọn phòng xóa số, chuyển route vẫn đếm, quay lại/focus xóa đúng số.
- `npm run build`: thành công, 324 module; cảnh báo chunk chính lớn hơn 500 kB vẫn còn, khoảng 1.204 kB trước gzip.
- Chưa đo latency trên thiết bị đã gặp lỗi và chưa thử tổng đài/điện thoại thật. Cần thử trên phiên trình duyệt mới, không chỉ logout/login trong cùng phiên đã mở audio.

## File thay đổi

- `src/services/audioService.js`, `src/views/CallsView.vue`: đường phát tiếng phím và thứ tự nhập số.
- `src/services/chatService.js`: bộ đếm reactive, chuẩn hóa event và khử trùng.
- `src/components/layout/AppSidebar.vue`: badge tổng.
- `src/views/MessagesView.vue`: badge từng phòng và lifecycle phòng đang xem.
- `tests/regressions.test.cjs`: kiểm chứng service và component thật.
- `GEMINI.md`: ghi nhận yêu cầu khôi phục badge, phân biệt với read receipt đã bỏ.
