# Đồng bộ các bản sửa từ main sang refactor — 20/11/2026

## Phạm vi và nguồn đối chiếu

Chỉ sửa D:/Project/Smart_Call_Web_Refactor, trên codex/refactor-architecture. Bản gốc giữ nguyên tại 7485481.

Đối chiếu ba commit main: ff191f4 (host/hội nghị/listener), 86b2011 (phím số/badge), 7485481 (lưu tạm badge). Không cherry-pick nguyên file wazo.js vì refactor đã chia trách nhiệm; logic được đưa vào đúng các service hiện có, không thay cây thư mục.

## 1. A gọi B, B thêm C: A vẫn là host

Luồng Web:

    AddParticipantModal → CallsView.confirmAddParticipants
      → GroupCallService.addParticipantsToGroupCall
      → nếu đang nhận cuộc gọi 1-1: gửi ADD_REQ tới người gọi ban đầu
      → A nhận request hợp lệ: nâng thành nhóm, gọi C, ghép hội nghị
      → GROUP công bố A là host tới các thành viên

Quyết định nằm ở GroupCallService, không nằm trong View. Người nhận không tự gọi C hoặc tự nhận host. Gửi ADD_REQ chờ HTTP xác nhận; lỗi hoặc ACK sau cúp/đổi phiên không được báo thành công cho cuộc gọi cũ.

wazoEventHandler chỉ cho phép peer đã kết nối của cuộc gọi outbound yêu cầu nâng nhóm trước khi có GROUP; người ngoài/cuộc gọi đang đổ chuông không được thực hiện. GROUP đầu tiên chỉ được nhận từ người gọi tới mình; B không thể phát GROUP để đổi A thành member.

A cúp: CallService yêu cầu xóa hội nghị và ngắt các server call ID B/C. B hoặc C rời đúng hội nghị: cập nhật thành viên, A và người còn lại tiếp tục; không chuyển host.

## 2. Không báo C rời khi tổng đài chuyển kênh

call_ended là kết thúc một nhánh, có thể phát khi chuyển vào ConfBridge. Nó không trực tiếp gọi handleParticipantLeftGroupCall nữa.

Event participant_left chỉ được áp dụng khi conference_id đúng phòng đang quản lý và call_id ánh xạ đúng thành viên; không lấy participant_id/id làm call_id tùy tiện. ID dạng số/chuỗi được đối chiếu thống nhất; event lặp không tạo thêm thông báo rời.

Khi SDK kết thúc nhánh đã nghe trong lúc REST ghép còn chờ, CallService đưa sự kiện vào queue do GroupCallService sở hữu. Sau REST:

- Ghép thành công và nhánh đã nằm trong mergedCallIds: giữ thành viên, kết thúc chỉ là chuyển kênh.
- Ghép thất bại: phát lại kết thúc và dọn nhánh đã kết thúc.
- A đã cúp: queue bị xóa, kết quả tạo phòng muộn không phục hồi nhóm; xóa phòng trả muộn nếu vẫn cùng phiên xác thực.

Không dùng một khoảng bỏ qua cố định vài giây để che mọi sự kiện rời.

## 3. Listener SDK được gắn sau connect

SDK @wazo/sdk 0.49.11 gọi unbind() trong _transferEvents() khi connect. Gắn listener trước rồi giữ cờ listenersAttached=true làm Web mất cả REGISTERED và CALL_INCOMING.

CallService.connect nay gỡ thế hệ listener cũ, đợi connect hoàn tất, kiểm tra phiên/thế hệ rồi gắn listener mới trước khi áp dụng thiết bị. Nếu REGISTERED đã phát sớm, đọc trạng thái thật Phone.phone.isRegistered(); không suy SIP online từ token.

Test thay thế sử dụng chính Emitter và _transferEvents của SDK đã cài, còn mạng/inner client được cô lập. SDK đổi cấu trúc thì test yêu cầu kiểm tra lại hợp đồng.

## 4. Lần bấm phím đầu không tạo AudioContext

CallsView cập nhật số hoặc gửi DTMF tới SDK trước tiếng phản hồi cục bộ. CallToneService phát WAV ngắn bằng HTMLAudio, không mở AudioContext đồng bộ trong phím số. Một audio element và tối đa 12 URL âm phím được tái sử dụng trong RAM; lỗi autoplay/thiết bị không chặn nhập số.

Chưa có performance trace trên máy từng bị khựng 3–4 giây. Đây là loại đường khởi tạo đồng bộ đáng ngờ khỏi handler, chưa phải đo xác nhận độ trễ trên thiết bị thật. Chuông đến/chuông chờ vẫn dùng Web Audio.

## 5. Badge tổng, từng hội thoại và lưu tạm

ChatService sở hữu state.unreadByRoom, tập UUID tin đã thấy và phòng đang hiển thị. Sidebar dùng totalUnread; MessagesView dùng getUnreadCount(room.id).

- Nhận payload Web/Mobile trực tiếp hoặc bọc message; ưu tiên UUID message thay vì ID envelope.
- Không đếm trùng event, tin của chính tài khoản hoặc lệnh quản trị đã xác minh.
- REST tải tin trước callback WebSocket vẫn không làm bỏ sót một tin đến.
- Mở đúng hội thoại ở cửa sổ đang hiển thị xóa số; route khác, KeepAlive, tab ẩn/mất focus vẫn đếm.
- Xóa tin/đóng phòng cập nhật số. Callback của phiên cũ không phục hồi badge sau logout.
- Cache localStorage dùng cùng schema smartcall_unread_v1:<host>:<UUID> với bản gốc; chỉ gồm room ID, UUID chưa mở và tối đa 1000 ID gần nhất/phòng để khử trùng. Không lưu text, tên phòng, token hoặc dữ liệu hồ sơ.
- Logout dọn RAM nhưng giữ cache đúng tài khoản; F5/đăng nhập lại khôi phục qua Sidebar và metadata phòng thật. Tài khoản/máy chủ khác không dùng chung số.
- Storage hỏng/bị chặn/đầy không làm hỏng nhận tin; tiếp tục đếm trong RAM và ghi cảnh báo.

Đây là ngoại lệ lưu tạm do người dùng yêu cầu. Không đồng bộ mốc đọc sang thiết bị khác, không tự đếm đầy đủ tin tới khi Web tắt nếu server không phát lại, và không thay read cursor server. Ghim/read receipt/trạng thái đã gửi/đã xem vẫn không được khôi phục.

## 6. Đường dẫn để đọc code

| Nội dung | File trong frontend/src |
| --- | --- |
| Connect, listener, kết thúc nhánh | services/calls/callService.js |
| Host, mời người, queue trong lúc ghép | services/calls/groupCallService.js |
| UUID, GROUP/ADD_REQ và event hội nghị | services/realtime/wazoEventHandler.js |
| Tiếng phím WAV | services/audio/audioService.js |
| Nhận tin, đếm, khử trùng, lưu/khôi phục | services/data/chatService.js |
| Điều phối thao tác thêm người/nhập số | views/CallsView.vue |
| Badge tổng | components/layout/AppSidebar.vue |
| Badge từng phòng và lifecycle xem phòng | views/MessagesView.vue |

## 7. Kiểm chứng và giới hạn

- 143/143 test, 14 file; thêm 22 ca sau baseline 121, cập nhật các fixture/hợp đồng cũ cho đúng quy tắc hiện tại.
- npm --prefix frontend run check đạt: lint, architecture, test và build.
- Architecture giữ kiểm tra import/cycle/HTTP trong component và cấm pin/read receipt; chỉ bỏ cấm unread/unreadCount vì tính năng đã được người dùng yêu cầu khôi phục.
- Build 361 module; chunk chính khoảng 1.210 kB trước gzip, 329,49 kB sau gzip. Cảnh báo trên 500 kB vẫn còn.
- Source vẫn 53 file/20 thư mục; không thêm tầng kiến trúc.
- Bộ mới có test Vue thật cho hai badge, KeepAlive/focus, khôi phục ngoài trang chat và thứ tự số trước tiếng phím; test service cho host/ghép lỗi/ghép muộn/logout và cache theo owner.
- Không sửa Android/IdP/backend hoặc bản gốc. Chưa thử tổng đài, media, điện thoại thật hoặc đo trên máy bị khựng.
- Mã Android tham chiếu có nhánh chỉ nhận ADD_REQ hai phần; Web nhận hai/ba phần nhưng chiều gửi có request ID cần kiểm tra đúng phiên bản Android trước khi khẳng định tương thích.

## 8. Bảng thử sau khi pull nhánh

1. Cập nhật tất cả máy Web cùng nhánh mới; login/F5 kiểm tra SIP và nhận cuộc gọi.
2. A gọi B, B thêm C: A giữ host, C nghe/nói và không báo rời sai.
3. A cúp: B/C kết thúc; thử lại cho B hoặc C rời thì A/người còn lại tiếp tục.
4. Thử C từ chối, lỗi ghép phòng, A cúp ngay lúc C nghe và gọi lại cuộc mới.
5. Dùng phiên trình duyệt mới thử phím số đầu, không chỉ logout/login trong phiên đã mở audio.
6. Gửi tin từ Web/Mobile: hai badge khớp, không đếm self echo/lặp; mở phòng xóa đúng số.
7. Nhận tin khi ở trang gọi/tab ẩn; F5/logout-login lại còn số; đổi tài khoản không lẫn số.


## Đồng bộ bổ sung hiển thị nhóm Web — 20/11/2026

Đã chuyển tiếp bản main d0dc85d vào refactor theo yêu cầu mới: tách groupConnectedExtensions/groupPendingExtensions, snapshot GROUP_STATE có revision, GROUP_SYNC khi incoming/accepted/reconnect. ActiveCallPanel chỉ đếm người đã kết nối, bỏ tiêu đề số cũ. Giữ ánh xạ ID B/C sau merge và dọn lời mời khi SDK lỗi/null/timeout. EventConnection báo mở socket qua callback được lắp tại createServices, không import ngược nghiệp vụ.

Kết quả hiện hành: 148/148 test (14 file), lint/architecture/build đạt; các số 143 ở mục trước là mốc trước bổ sung này. Đã gồm toàn bộ bản sửa trước về host, listener SDK, tiếng phím và badge lưu tạm. Chưa thử tổng đài thật; cả ba máy Web cần cập nhật cùng bản.
