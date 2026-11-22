# Cập nhật trạng thái — 20/11/2026

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

F01–F03 đã vá trước lượt đơn giản hóa. F04, F05, F06 và F08 được sửa trong lượt này, có test tái hiện trong frontend/tests/unit/simplified-regressions.test.js. F07 được sửa ở Web: tombstone không bị tin thường đảo ngược, kiểm tra lịch sử ngoài trang gần nhất và chặn gửi; quyền membership/ACL trên server vẫn cần hợp đồng/API. Các đường dẫn và kết luận bên dưới là snapshot lịch sử trước khi sửa. Xem ARCHITECTURE.md/VERIFICATION.md để đọc cấu trúc và kết quả hiện hành.

# Audit độc lập sau refactor — bảo mật, lỗi còn sót và chất lượng code

- Ngày: 19/11/2026.
- Bản được rà soát: `D:/Project/Smart_Call_Web_Refactor`, commit `a85d6dc`, nhánh `codex/refactor-architecture`.
- Phạm vi: Web Vue và các ranh giới Wazo SDK/API; backend chưa có implementation. Mã Android chỉ tham khảo.
- Trong lượt này không sửa mã nghiệp vụ. Chỉ tạo ca tái hiện ở cache được ignore và viết tài liệu.
- Báo cáo này bổ sung các vấn đề chưa được kết luận trong lượt refactor trước; không thay thế kiểm tra trên tổng đài thật.

## Cập nhật bản vá ba vấn đề ưu tiên

Đã vá F01, F02, F03 trong bản clone sau lượt audit:
- F01: groupPresenceSignals xác định UUID người phát qua danh bạ server, đối chiếu peer/host/thành viên hiện tại; chỉ thành viên đã kết nối được yêu cầu mời, chỉ được LEFT cho chính mình. Thiếu/mâu thuẫn danh tính bị bỏ qua. Giữ schema ADD_REQ Android cũ và gộp lặp trong cuộc gọi.
- F02: SdkAuthenticationGate dùng chung theo SDK Auth, tuần tự hóa initialize/logIn/validateToken/logout. Timeout giải phóng form nhưng không giải phóng khóa SDK trước request và cleanup thực sự kết thúc. Retry lúc còn tác vụ cũ bị từ chối rõ ràng; cleanup lỗi yêu cầu tải lại trang.
- F03: thu hồi phiên đi qua logout, invalidate scope, xóa token/cache/định danh, dừng timer/socket và bỏ UI riêng tư ngay, không đợi router điều hướng xong.
- Bộ chính hiện có **103 kiểm thử, 10 file**; các ca mới dùng SDK có state và Vue thật. Các kết quả 76 test/11 ca trong phần bên dưới là bằng chứng lịch sử tại a85d6dc.
- F04 đến F08 vẫn mở, ngoài phạm vi ba vấn đề được yêu cầu sửa lần này.

Giới hạn: UUID trong envelope và danh bạ phải do server cung cấp đúng; thiếu danh bạ sẽ bỏ qua group signal. Protocol presence cũ không có call nonce/chữ ký server, nên kiểm tra client không thay ACL và không chứng minh chống mọi replay giữa các cuộc gọi của cùng người dùng. Cần thử liên thông Web/Android/Wazo thật.


## Kết luận

Cấu trúc theo feature và điểm lắp ghép dịch vụ là hướng hợp lý cho quy mô hiện tại. Mức độ sạch, khả năng kiểm chứng và tính an toàn **chưa đủ để kết luận bản refactor đã sẵn sàng thay bản đang dùng**.

Bộ kiểm tra hiện có vẫn đạt 76/76 test, lint, architecture check, format và build. Bộ audit riêng gồm 11 tình huống: 9 không đạt và 2 đối chứng đạt, tương ứng 8 nhóm vấn đề chính. Các ca mới không nằm trong bộ test chính và không làm thay đổi hành vi sản phẩm.

P1 dưới đây nghĩa là cần ưu tiên xử lý trước khi mở rộng/đưa vào sử dụng; không phải kết luận đã khai thác thành công trên hệ thống production. Không phát hiện căn cứ để tuyên bố có SQL injection, RCE hoặc XSS thực thi từ các phần đã rà soát. Điều đó không chứng minh toàn hệ thống không có các lỗ hổng này.

## 1. Các phát hiện chính

### F01 — P1: Presence được dùng làm lệnh điều khiển gọi nhóm nhưng chưa xác thực người gửi

**Vị trí:** [handleWazoEvent.js](../../frontend/src/features/calls/services/handleWazoEvent.js), các nhánh GROUP/ADD_REQ/LEFT, khoảng dòng 16, 55 và 136.

Handler đọc status text rồi thực hiện lệnh dựa trên máy lẻ nằm trong chuỗi. Nhánh ADD_REQ kiểm tra targetHostExt nhưng không đối chiếu UUID người phát với thành viên hiện tại. Nhánh LEFT cũng không kiểm tra người phát có chính là người được ghi trong tag hay không. GROUP có thể thay host/isGroupHost của một cuộc gọi đang hoạt động nếu chuỗi liệt kê máy lẻ hiện tại.

**Tái hiện:** AUDIT-01 và AUDIT-02 đưa presence có user_uuid của người ngoài nhóm. Web vẫn gọi addParticipantsToGroupCall hoặc handleParticipantLeftGroupCall.

**Tác động:** nếu tổng đài phát presence của người đó tới Web, người dùng khác có thể làm Web gửi yêu cầu mời/gỡ người bằng quyền của chủ cuộc gọi. Khả năng phát event thực tế tới nạn nhân cần kiểm tra ACL/subscription của tổng đài; unit test đã chứng minh handler không có hàng rào kiểm tra này. Không khẳng định có thể vượt ACL của Wazo server.

**Hướng xử lý:** gắn lệnh với danh tính server xác nhận, cuộc gọi/hội nghị hiện tại và quyền của người phát. LEFT phải khớp người phát; GROUP phải đến từ host đã xác lập; ADD_REQ phải từ thành viên hợp lệ. Với contract hiện tại không đủ chứng minh quyền thì không tự động thực thi lệnh. Giải pháp bền vững là API/event nghiệp vụ được server kiểm tra quyền, không lấy status text làm bằng chứng quyền.

### F02 — P1: Timeout của Web không hủy side effect xác thực bên trong SDK

**Vị trí:** [AuthService.js](../../frontend/src/features/auth/services/AuthService.js), authenticateCredentials/waitForAuthentication, khoảng dòng 837–859.

Promise.race chỉ dừng chờ ở phía Web. Request SDK vẫn chạy. Trong SDK 0.49.11, Auth.logIn gọi _onAuthenticated; hàm này có nhiều await, rồi cập nhật token/session nội bộ và mở SDK WebSocket.

**Tình huống:** A đã vào bước xác thực SDK nhưng còn chờ hồ sơ; Web timeout. B đăng nhập thành công. Phần xử lý còn lại của A hoàn tất sau đó và có thể ghi lại session SDK của A. sessionScope chỉ ngăn commit ở AuthService của Web, không bảo vệ state nội bộ SDK. Hàng đợi sdkCleanupPromise hiện mới chờ logout; không bao phủ request logIn/validateToken còn sống sau timeout.

**Bằng chứng:** AUDIT-09 mô phỏng side effect sau await đúng dạng đã đọc trong mã SDK. Session SDK cuối cùng là old trong khi phiên Web đã chuyển sang new. Đây là mô phỏng hợp đồng SDK có state, không phải test login qua tổng đài thật.

**Hướng xử lý:** quản lý toàn bộ vòng đời thao tác xác thực, gồm request còn chạy sau timeout. Không cho lần xác thực tiếp theo cùng sửa một SDK singleton khi lần cũ chưa được thu hồi/hoàn tất an toàn. Nếu SDK không hỗ trợ abort, cần cơ chế cô lập/reset hoặc hàng đợi phù hợp cùng hành vi retry rõ ràng. Bổ sung test có side effect SDK, không chỉ kiểm tra localStorage.

### F03 — P1: Thu hồi phiên chưa thực hiện đầy đủ cleanup và vô hiệu scope

**Vị trí:** [AuthService.js](../../frontend/src/features/auth/services/AuthService.js), handleSessionRevocation, khoảng dòng 417; [App.vue](../../frontend/src/app/App.vue), handleSessionKicked.

handleSessionRevocation đánh dấu isSessionRevoked, dừng kiểm tra phiên và ngắt thoại/socket. Nó không invalidateSession, không xóa token/phiên, không reset chat/danh bạ/media cache. App chỉ mở modal; logout thực tế đợi người dùng bấm đăng nhập lại.

**Tái hiện:** AUDIT-04 bắt đầu tải tin nhắn, gọi handleSessionRevocation, rồi cho response đến. isAuthenticated vẫn true và phòng vẫn nhận nội dung. Cả hai khẳng định đều không đạt trong test.

**Tác động:** dữ liệu/tác vụ của phiên đã bị Web coi là thu hồi vẫn còn tồn tại và có thể cập nhật UI. Đây là lỗi cleanup phía client; không có nghĩa token đã bị server thu hồi vẫn vượt được xác thực server.

**Hướng xử lý:** dùng một đường kết thúc phiên có tính lặp lại an toàn, vô hiệu scope và dọn state trước; giữ riêng lý do bị thu hồi để modal hiển thị. Chặn lệnh nghiệp vụ khi phiên không còn hoạt động, thay vì chỉ kiểm tra có token.

### F04 — P2: Sự kiện accepted của cuộc gọi cũ có thể thay session của cuộc gọi mới

**Vị trí:** [phoneEventHandlers.js](../../frontend/src/features/calls/services/phoneEventHandlers.js), createCallAcceptedHandler, khoảng dòng 173 và 266.

Wrapper bảo vệ thế hệ đăng nhập/listener. Bên trong accepted handler lại lấy callGeneration ở thời điểm nhận event, chưa đối chiếu sipCallId của event với nhánh chính/nhánh phụ đang được quản lý trước khi gán currentCallSession.

**Tái hiện:** AUDIT-05 có current session mang ID current; đưa accepted của ID old trong cùng kết nối. currentCallSession đổi thành old và activeCall bị chuyển trạng thái.

**Tác động:** UI, đồng hồ, media hoặc lệnh cúp/mute có thể trỏ vào session khác. Xác suất nhận thứ tự này trên SIP thật cần kiểm tra, nhưng nhánh thiếu đối chiếu danh tính đã được tái hiện.

**Hướng xử lý:** phân giải event thành nhánh gọi đã biết trước khi cập nhật state. Giữ hỗ trợ nhánh phụ của hội nghị; không chỉ so sánh duy nhất một session rồi loại toàn bộ secondary leg.

### F05 — P2: Conference bị xóa không được đối chiếu với conference đang tham gia

**Vị trí:** [handleWazoEvent.js](../../frontend/src/features/calls/services/handleWazoEvent.js), nhánh adhoc_conference_deleted, khoảng dòng 210.

Handler đọc confId để ghi log, nhưng chỉ kiểm tra đang gọi nhóm và không phải host rồi gọi hangupCurrentCall; không so confId với hội nghị hiện tại.

**Tái hiện:** AUDIT-03 đang tham gia mine, nhận event xóa other, vẫn gọi hangup.

**Tác động:** event không liên quan, event cũ hoặc event cùng người dùng nhưng khác cuộc gọi có thể cúp nhóm hiện tại nếu được server phát tới Web.

**Hướng xử lý:** ràng buộc conference ID và thế hệ cuộc gọi; xác định cách lưu conference ID của người tham gia theo dữ liệu Wazo thực tế. Không suy kết thúc chỉ từ tên event.

### F06 — P2: sendFailed được gán trên object thô nên Vue có thể không cập nhật nhãn lỗi

**Vị trí:** [ChatService.js](../../frontend/src/features/messages/services/ChatService.js), sendMessage, khoảng dòng 950 và 1001.

newMsg là object thô được push vào mảng reactive. Vue bọc object khi đọc qua proxy; gán newMsg.sendFailed trên tham chiếu thô không kích hoạt dependency của Vue. publishRoomsChanged không luôn làm thay đổi mảng hoặc tham chiếu phòng, nên không bảo đảm render lại.

**Tái hiện:** AUDIT-08 cho computed đọc trạng thái tin vừa thêm, sau đó API trả HTTP500. Giá trị lưu trong object đã đổi nhưng computed vẫn false. Bộ test cũ đọc trực tiếp object trả về nên bỏ lọt vấn đề render.

**Tác động:** có toast lỗi nhưng nhãn lỗi cạnh tin nhắn có thể không xuất hiện cho tới khi có lần render khác. Đây là thông báo gửi thất bại đang được giữ trong yêu cầu sản phẩm, không phải đề xuất đưa lại read receipt/trạng thái đã gửi.

**Hướng xử lý:** cập nhật qua proxy đang nằm trong state, tạo object reactive trước khi lưu hoặc thay object trong mảng. Bổ sung test component thật kết nối ChatService thật cho nhánh HTTP lỗi.

### F07 — P2: Phòng đã giải tán có thể mở lại khi xuất hiện tin thường sau tombstone

**Vị trí:** [ChatService.js](../../frontend/src/features/messages/services/ChatService.js), getRoomMessages, khoảng dòng 515–550; deleteRoom chỉ gửi tin ROOM_CLOSED rồi ẩn RAM.

Nếu có tin mới sau ROOM_CLOSED, code tự đặt isClosed=false và cắt lịch sử trước mốc đó. Tin mới không cần là lệnh mở lại của quản trị viên.

**Tái hiện:** AUDIT-10 trả danh sách gồm tombstone của admin rồi tin thường của thành viên. Phòng mở lại.

**Tác động:** giải tán nhóm hiện chưa phải thao tác đóng/thu hồi membership trên server. Client khác còn quyền gửi có thể khiến nhóm xuất hiện lại. Báo cáo trước đã ghi giới hạn thiếu contract server; lượt này xác nhận đường mở lại cụ thể trong code.

**Hướng xử lý:** không dùng tin thường làm lệnh mở lại. Phải tách trạng thái đóng bền vững do server xác nhận; trong lúc chờ contract, UI không được mô tả việc gửi tombstone là xóa vĩnh viễn/thu hồi quyền. Frontend đơn lẻ không bảo đảm thu hồi quyền gửi của các client khác.

### F08 — P2: Tắt cả ba feature gây vòng lặp điều hướng

**Vị trí:** [router/index.js](../../frontend/src/app/router/index.js), getFirstAvailableRoute và beforeEach, khoảng dòng 7 và 73.

Khi calls/messages/history đều false, fallback là /login. Người đã đăng nhập đi tới Login lại bị chuyển về fallback /login; guard lặp lại. Settings cho phép lưu tổ hợp cờ này.

**Tái hiện:** AUDIT-11 dùng router thật và cấu hình ba cờ false. Vue Router từ chối navigation với Infinite redirect in navigation guard.

**Hướng xử lý:** có trang trạng thái không có phân hệ khả dụng, hoặc ngăn lưu cấu hình không hợp lệ; đảm bảo mọi nhánh fallback kết thúc và không redirect về chính nó.

## 2. Điểm phụ đã đọc thấy, chưa đưa vào 8 nhóm tái hiện chính

| Điểm | Bằng chứng | Đề xuất |
| --- | --- | --- |
| Đổi mật khẩu dùng trim | SettingsModal.vue:543–545 trim cả mật khẩu cũ/mới/xác nhận | Không sửa nội dung mật khẩu; dùng kiểm tra rỗng riêng |
| Reset mật khẩu dùng display name thay username/email | SettingsModal.vue:302, 616–630; currentUsername lấy getCurrentDisplayName | Tách username, displayName, email; gửi định danh API thực sự yêu cầu |
| Caller không xác định bị gán máy lẻ 1007 | IncomingCallModal.vue:108–118 | Hiển thị người gọi/số chưa xác định, không bịa định danh |
| Token/UUID trong localStorage dùng chung giữa các tab | sessionScope đọc UUID từ localStorage; AuthService giữ session riêng trong RAM; chưa thấy xử lý storage event | Kiểm tra hai tab đăng nhập hai tài khoản hoặc logout một tab; định nghĩa chính sách đồng bộ/đổi phiên |
| Ghi log nguyên SDK session và JSON.stringify trực tiếp | phoneEventHandlers.js:108; DebugLogDrawer.vue và LoggerService | Chọn field an toàn, che credential, giới hạn dữ liệu và serialize chống vòng tham chiếu |
| Một số try/catch bao quanh lời gọi async không await | Các lệnh SDK hangup/reject/disconnect trong controller | Rà rejection thực theo chữ ký SDK; không coi catch đồng bộ là đã bắt lỗi Promise |

Các dòng trên là vấn đề đọc mã/rủi ro cần kiểm chứng thêm theo từng luồng. Không tính chúng thành số ca bảo mật đã khai thác, không khẳng định log hiện đã rò token thật hoặc hai tab đã gây lộ dữ liệu trên production.

## 3. Code đã clean và dễ hiểu chưa?

### Phần đã tốt hơn

- frontend/backend và mã tham khảo có phạm vi rõ.
- Tổ chức theo auth/calls/contacts/messages/history/settings giúp tìm code theo chức năng.
- createServices là điểm lắp ghép; service nghiệp vụ không import ngược app.
- Đã có mapper thuần, composable cho tài nguyên UI, component hiển thị riêng.
- Không có import thiếu/cycle theo checker hiện hành; package/lock và kiểm tra định dạng có thể chạy lại.
- Tên mới như getOrCreateDirectRoom, cancelParticipantInvite, captureSessionContext mô tả đúng ý định hơn trước.

### Phần vẫn cần cải thiện

Số liệu lấy từ AST/script SFC của commit được audit:

| File / hàm | Quy mô |
| --- | --- |
| ChatService.js | 1.229 dòng |
| CallController.js | 962 dòng |
| GroupCallController.js | 903 dòng |
| AuthService.js | 887 dòng |
| MessagesView.vue | 865 dòng script, 1.112 dòng CSS |
| CallsView.vue | 826 dòng script, 2.051 dòng CSS |
| finalizeCallTermination | 349 dòng |
| handleWazoEvent | 244 dòng |
| createCallAcceptedHandler | 230 dòng |
| getOrCreateDirectRoom | 223 dòng |

Độ dài không tự chứng minh lỗi, nhưng ở đây hàm lớn đang trộn phân loại sự kiện, quyết định nghiệp vụ, tác động SDK/API, cập nhật state và thông báo UI. F01/F04/F05 chính là những nhánh dễ bị bỏ sót khi các bước này nằm chung.

Có 51 catch block rỗng về mặt statement trong script. Một số là dự phòng storage/browser hợp lệ; không phải 51 lỗi độc lập. Tuy nhiên các catch bỏ qua lỗi API/chat/protocol làm khó phân biệt “danh sách rỗng”, “mất kết nối”, “hết quyền” và “response thuộc phiên cũ”.

Tên hàm/lớp phần lớn đã rõ, nhưng vẫn còn:
- currentUsername thực chất là display name.
- getRooms/getRoomMessages/getOrCreateDirectRoom vừa I/O, mapping, cache, prefetch hoặc tạo dữ liệu. Cần làm rõ hợp đồng và side effect.
- Nhiều cờ boolean kết hợp như isGroupCall/isGroupHost/isStarting/isStopping; chưa có trạng thái và chuyển trạng thái được kiểm soát tập trung.
- Comment như “100%”, “chuẩn xác”, “không commit kết quả muộn” nói rộng hơn những gì code/test chứng minh.
- Dependency nhận qua constructor nhưng phần lớn chưa có JSDoc typedef cho Session, CallLeg, Room, ServicePort. Người mới vẫn phải đọc nơi gọi để đoán hợp đồng.

## 4. Cấu trúc thư mục và khả năng mở rộng

**Giữ cấu trúc feature hiện tại. Chưa cần refactor toàn bộ cây thư mục thêm lần nữa.** Vấn đề quan trọng hơn là ranh giới trách nhiệm trong các file lớn và hợp đồng trạng thái/sự kiện.

Hướng tách tiếp phù hợp:
1. Call identity và bộ giải mã/xác thực group signal thành hàm nhỏ có hợp đồng rõ.
2. Lifecycle kết thúc cuộc gọi: phân loại nhánh, dọn SDK/media, ghi CDR và giải tán conference thành bước riêng.
3. Chat: tải phòng, tải tin, command quản trị và reconciliation optimistic message thành các phần có thể test độc lập.
4. Trang Calls/Messages: tách panel/chọn thành viên/danh sách phòng có hành vi riêng; không chỉ chuyển CSS sang file khác để giảm số dòng.
5. Auth: một owner cho tác vụ SDK auth đang chạy; một đường kết thúc phiên.
6. Backend/IdP: giữ adapter riêng khi có contract. Chưa tạo endpoint hoặc quyền giả.

State hiện vẫn là singleton của SPA một người dùng mỗi tab. createServices không tạo bộ state hoàn toàn độc lập cho nhiều app instance; điều này đã được ghi trong tài liệu và không phải lỗi nếu giữ đúng phạm vi. Nếu sau này cần nhiều workspace/phiên trong cùng runtime, phải thay hợp đồng state.

Một số dịch vụ dùng WazoApiClient, số khác dùng createSessionFetch và dựng URL/header riêng. Đây là mức chuẩn hóa chưa hoàn tất, không phải mọi transport đã có một cơ chế retry/error thống nhất.

## 5. Test còn thiếu gì?

### Kết quả chạy lại

| Kiểm tra | Kết quả |
| --- | --- |
| Bộ chính | 76/76 đạt, 7 file |
| Lint / architecture check | Đạt; 50 module |
| Format | Đạt |
| Build | Đạt, còn cảnh báo chunk lớn |
| npm audit | 0 vulnerability tại thời điểm chạy |
| Bộ audit riêng | 11 ca, 9 không đạt, 2 đối chứng đạt |

Bundle đầu vào khoảng 1.197 KB, gzip khoảng 326 KB. Chưa benchmark tải lớn hoặc chứng minh cải thiện hiệu năng. Các package deprecated vẫn cần kế hoạch nâng cấp, dù npm audit hiện không báo CVE.

### Vì sao 76 test xanh vẫn bỏ lọt?

- Test phiên tập trung state Web, chưa mô phỏng state và side effect nội bộ SDK.
- Có test callback sau đổi phiên/disconnect, thiếu callback của cuộc gọi khác trong cùng phiên/listener.
- Có test command quản trị chat, chưa có sender authorization cho group presence.
- Có test server trả lỗi, chưa nối service thật với reactivity/render cho sendFailed.
- Có test một số cờ hiển thị, thiếu tổ hợp cả ba cờ false.
- Có test cold load nhóm đóng, thiếu tin thường đến sau mốc đóng.
- Fixture thay mạng/SDK khá nhẹ. Không có bằng chứng về độ bao phủ nhánh/coverage 100%, E2E nhiều tab hoặc SIP/media thật.

### Hai đối chứng đạt

- SDK/server echo trước HTTP ACK không tạo hai tin có cùng server ID trong ca đã thử.
- Stop recording của phiên A sau invalidateSession thật không xóa state phiên B trong ca đã thử.

Ca từng reset state ghi âm bằng tay trong cùng phiên đã được loại khỏi kết luận vì không phản ánh đường logout thực tế. Không dùng test tự tạo trạng thái bất khả thi để tăng số lỗi.

## 6. Thứ tự xử lý đề nghị

1. **Trước khi mở rộng chức năng:** F01, F02, F03; bổ sung test quyền người phát, SDK auth có state, cleanup đầy đủ khi thu hồi phiên.
2. **Ổn định nghiệp vụ:** F04, F05, F06, F08; chuyển các ca tương ứng vào suite chính khi sửa.
3. **Làm rõ contract nhóm:** F07; backend/server phải chịu trách nhiệm trạng thái đóng và membership. Điều chỉnh lời mô tả UI trong lúc chưa có API.
4. **Giảm chi phí bảo trì:** tách các hàm lớn nêu trên, bổ sung typedef và kết quả lỗi có cấu trúc. Rà các điểm phụ ở mục 2.
5. **Tích hợp trước sử dụng:** thử Wazo thật, nhiều tab/tài khoản, mất mạng, timeout và SDK trả kết quả muộn.

Không nên tiếp tục thay hàng loạt tên/thư mục trước khi sửa các lỗi vòng đời và quyền. Cấu trúc mới đã đủ chỗ để sửa từng phần một cách kiểm chứng được.

## 7. Bằng chứng và cách chạy lại

Ca tái hiện được lưu trong cache local .refactor-tmp, không vào production hoặc suite chính. Bản sao đầy đủ của config và các ca nằm trong [AUDIT_REPRO_CASES.md](AUDIT_REPRO_CASES.md), để vẫn tái hiện được sau khi clone ở máy khác.

Lệnh tại gốc clone:

```powershell
node frontend/node_modules/vitest/vitest.mjs run --config .refactor-tmp/audit.vitest.config.mjs --reporter=verbose
```

Các ca dùng fixture và SDK/network giả tại ranh giới; không gửi credential hoặc lệnh thật tới Wazo. Chưa thực hiện pentest trên server, chưa xác minh ACL thực tế hoặc tích hợp IdP.

**Trạng thái hiện tại:** F01–F03 đã được vá theo phần cập nhật ở đầu báo cáo; F04–F08 còn mở. Phần phân tích gốc giữ lại để đối chiếu.
