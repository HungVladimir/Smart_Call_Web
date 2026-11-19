# Phát hiện lỗi và business logic

Ngày 19/11/2026. Kết quả hợp nhất sau hai vòng rà soát trên snapshot đã hash. **21 findings: P0=0, P1=3, P2=18, P3=0; 20 CONFIRMED BUG và 1 DESIGN RISK.** Confidence High chỉ cho cơ chế code được mô tả; không tương đương xác nhận tác động trên production.

[Hiểu dự án](01-project-understanding.md) · [Vòng hai](06-second-pass-review.md) · [Kế hoạch](07-prioritized-action-plan.md) · [Coverage và cách kiểm tra](09-audit-coverage.md)

CONFIRMED BUG: có bằng chứng code đủ kết luận hoặc harness cô lập; LIKELY BUG: chưa đủ để kết luận; DESIGN RISK: rủi ro thiết kế; NEEDS VERIFICATION: chưa có bằng chứng. Không tìm đủ cơ sở chốt P0. Không suy diễn rằng không có P0 trong toàn hệ thống.

| ID | Severity | Status | Tiêu đề |
|---|---|---|---|
| [SEC-001](#sec-001) | P1 | CONFIRMED BUG | Nội dung chat thường được thực thi như lệnh quản trị |
| [SEC-002](#sec-002) | P1 | CONFIRMED BUG | Request của tài khoản cũ ghi lại state sau reset/đổi user |
| [BUG-001](#bug-001) | P1 | CONFIRMED BUG | Lưu tab Âm thanh có thể tắt DND/chuyển tiếp chưa tải |
| [BUG-002](#bug-002) | P2 | CONFIRMED BUG | Nhận cuộc gọi đặt connected trước khi SDK xác nhận |
| [BUG-003](#bug-003) | P2 | CONFIRMED BUG | Response tạo conference muộn khôi phục state sau hangup |
| [BUG-004](#bug-004) | P2 | CONFIRMED BUG | Thêm nhánh conference thất bại bị đánh dấu đã merge |
| [BUG-005](#bug-005) | P2 | CONFIRMED BUG | Progress/accepted của nhánh phụ làm sai aggregate state nhóm |
| [BUG-006](#bug-006) | P2 | CONFIRMED BUG | Dừng ghi âm báo thành công dù máy chủ từ chối |
| [BUG-007](#bug-007) | P2 | CONFIRMED BUG | Lỗi gửi command chat không truyền tới caller đổi tên/xóa nhóm |
| [BUG-008](#bug-008) | P2 | CONFIRMED BUG | Fallback máy lẻ giả chặn dữ liệu thật từ confd |
| [BUG-009](#bug-009) | P2 | CONFIRMED BUG | Chọn mic/loa không áp dụng vào cuộc gọi |
| [BUG-010](#bug-010) | P2 | CONFIRMED BUG | Computed đọc state thường của singleton bị cache cũ |
| [BUG-011](#bug-011) | P2 | CONFIRMED BUG | Tải audio trả sai thứ tự có thể phát sai bản ghi sau chuyển trang |
| [BUG-012](#bug-012) | P2 | CONFIRMED BUG | Bộ lọc cuộc gọi nhỡ khác điều kiện badge |
| [BUG-013](#bug-013) | P2 | CONFIRMED BUG | Gửi tin xong kéo người dùng về phòng cũ |
| [BUG-014](#bug-014) | P2 | CONFIRMED BUG | Nhóm đã đóng xuất hiện lại khi cold load |
| [BUG-015](#bug-015) | P2 | CONFIRMED BUG | Mic stream có thể mở sau khi modal đã đóng |
| [SEC-003](#sec-003) | P2 | CONFIRMED BUG | Log chat và cache ghi âm sống qua logout |
| [LOGIC-001](#logic-001) | P2 | CONFIRMED BUG | Đã nhận/đã xem và danh sách người đọc được suy đoán |
| [LOGIC-002](#logic-002) | P2 | CONFIRMED BUG | Thay thành viên tạo phòng mới và chỉ chuyển tối đa 25 tin |
| [ARCH-001](#arch-001) | P2 | DESIGN RISK | State nghiệp vụ và API phụ thuộc vòng, thiếu contract kiểm thử |

## SEC-001

**Nội dung chat thường được thực thi như lệnh quản trị**

- **Severity:** P1.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:104](../../src/services/chatService.js#L104); [src/services/chatService.js:122](../../src/services/chatService.js#L122); [src/services/chatService.js:204](../../src/services/chatService.js#L204).
- **Related modules:** ChatService, MessagesView, Wazo Chatd.

**Evidence — FACT:** Parser dùng content.includes/regex cho ROOM_CLOSED, MSG_DELETED, ROOM_RENAME trước khi kiểm tra quyền người gửi; text thường có thể mang tag.

**Trigger conditions:** Một thành viên gửi tin có tag hệ thống, hoặc trích dẫn tag trong nội dung.

**Expected behavior:** Chỉ sự kiện quản trị đã được backend cho phép mới thay đổi phòng/tin.

**Actual/predicted behavior:** Client xóa phòng khỏi rooms hoặc lọc tin theo text do thành viên cung cấp.

**Impact:** Thành viên có thể làm các Web client ẩn hội thoại/tin ngoài quyền admin; không chứng minh xóa vật lý trên Wazo.

**Root cause:** Trộn data và command trong content; guard UI của nút admin không bảo vệ parser.

**Verification:** VM: inject message user ordinary-member, phòng có admin khác; remainingRooms=0. Chưa thử exploit trên server thật.

**Recommendation:** Dùng nghiệp vụ/event có type và quyền phía backend; trong giai đoạn cũ không coi content tùy ý là lệnh có thẩm quyền.

**Regression test:** User thường gửi/trích dẫn mọi SYSTEM tag: phòng/tin không đổi; admin hợp lệ có event xác thực mới được áp dụng.

## SEC-002

**Request của tài khoản cũ ghi lại state sau reset/đổi user**

- **Severity:** P1.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:304](../../src/services/chatService.js#L304); [src/services/chatService.js:523](../../src/services/chatService.js#L523); [src/services/chatService.js:1493](../../src/services/chatService.js#L1493); [src/services/historyService.js:209](../../src/services/historyService.js#L209); [src/services/contactService.js:551](../../src/services/contactService.js#L551).
- **Related modules:** ChatService, HistoryService, ContactService, App/Sidebar.

**Evidence — FACT:** Token được chụp trước await; response sau đó gán singleton. reset chỉ xóa arrays/promise, không abort hay kiểm tra session generation.

**Trigger conditions:** A có request rooms pending, logout, B login trong cùng ứng dụng rồi response A về.

**Expected behavior:** Kết quả A bị loại bỏ, state B chỉ chứa dữ liệu B.

**Actual/predicted behavior:** rooms của A được gán lại; sidebar/view dùng singleton có thể đọc state này.

**Impact:** Rò dữ liệu giữa tài khoản trong cùng phiên trình duyệt; ACL server không bảo vệ kết quả đã cấp cho A.

**Root cause:** Thiếu ownership/generation xuyên await; bỏ reference promise không hủy request.

**Verification:** VM getRooms A pending → reset → đổi getMyUserUuid thành B → trả private-a: rooms chứa private-a. History/contact được truy vết tĩnh, chưa reproduce riêng.

**Recommendation:** Session epoch + AbortController; chụp user/token/host và kiểm tra trước mọi commit state; promise theo epoch.

**Regression test:** Delay A→logout/login B→resolve A; không array, event, badge hay cache nào chứa dữ liệu A.

## BUG-001

**Lưu tab Âm thanh có thể tắt DND/chuyển tiếp chưa tải**

- **Severity:** P1.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/components/common/SettingsModal.vue:454](../../src/components/common/SettingsModal.vue#L454); [src/components/common/SettingsModal.vue:401](../../src/components/common/SettingsModal.vue#L401); [src/components/common/SettingsModal.vue:670](../../src/components/common/SettingsModal.vue#L670).
- **Related modules:** SettingsModal, Wazo Confd.

**Evidence — FACT:** DND mặc định false, forward mặc định rỗng; chỉ tab calls tải dịch vụ. handleSave luôn PUT cả DND và ba forwards, không kiểm tra res.ok rồi báo thành công.

**Trigger conditions:** Mở Settings lần đầu ở tab audio, đổi mic và bấm Lưu; hoặc tải dịch vụ thất bại.

**Expected behavior:** Chỉ lưu trường đã load và sửa; lỗi từng API được phản ánh.

**Actual/predicted behavior:** Gửi enabled:false cho DND và cả ba forward chưa được tải; toast thành công ngay cả HTTP lỗi.

**Impact:** Có thể thay đổi cấu hình nhận cuộc gọi ngoài ý định, gây bỏ lỡ/liên lạc sai. Server áp dụng phụ thuộc ACL/validation.

**Root cause:** Một nút save ghi mọi domain state mà không có loaded/dirty/error tracking.

**Verification:** VM chưa load calls: thu được bốn PUT false/rỗng. HTTP 500 không ngăn luồng success. Không gửi thật.

**Recommendation:** Tách lưu từng nhóm; loaded/dirty guards; await và kiểm tra từng response; không ghi nếu load lỗi.

**Regression test:** Server DND=true/forward có số; save audio không gửi Confd write. Partial 403/500 không success toàn bộ.

## BUG-002

**Nhận cuộc gọi đặt connected trước khi SDK xác nhận**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/wazo.js:1782](../../src/services/wazo.js#L1782); [src/services/wazo.js:1812](../../src/services/wazo.js#L1812); [src/App.vue:161](../../src/App.vue#L161).
- **Related modules:** WazoService, IncomingCallModal, App.

**Evidence — FACT:** accept gọi Promise Wazo.Phone.accept mà không await; acceptIncomingCall luôn tạo status connected/startTime, xóa incoming và start timer.

**Trigger conditions:** Người dùng bấm Nghe khi mic bị từ chối, SIP answer lỗi hoặc SDK không có phone.

**Expected behavior:** State answering cho tới accepted; lỗi phải phục hồi/hiển thị đúng.

**Actual/predicted behavior:** UI và CDR có thể coi đã kết nối trước khi answer thành công; promise rejection không được catch bởi try đồng bộ.

**Impact:** Sai trạng thái/thời lượng, mất UI để thử nhận lại; sự kiện failed sau đó có thể dọn nhưng không bảo đảm xảy ra ở mọi lỗi media.

**Root cause:** Dùng trạng thái optimistic cho sự kiện media chưa hoàn thành.

**Verification:** VM SDK accept trả null: active.status=connected, timer=true. SDK d.ts xác nhận accept trả Promise. Chưa reproduce mic/SIP thật.

**Recommendation:** Await/catch answer, state answering; chuyển connected tại event matching session duy nhất.

**Regression test:** SDK reject/null/NotAllowedError không tạo connected/CDR success; accepted mới bắt đầu duration.

## BUG-003

**Response tạo conference muộn khôi phục state sau hangup**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/wazo.js:2789](../../src/services/wazo.js#L2789); [src/services/wazo.js:2912](../../src/services/wazo.js#L2912); [src/services/wazo.js:3024](../../src/services/wazo.js#L3024).
- **Related modules:** Adhoc sync, hangup, group state.

**Evidence — FACT:** _doSync chỉ kiểm tra active ở đầu; sau await createAdhocConference gán confId và broadcast mà không so generation. reset không hủy in-flight create.

**Trigger conditions:** Create conference đang chờ rồi host hangup trước khi response về.

**Expected behavior:** Response cũ không hồi sinh state; conference đã tạo muộn cần được thu hồi.

**Actual/predicted behavior:** activeAdhocConferenceId lại chứa ID cũ dù activeCall=null.

**Impact:** State/orphan conference không nhất quán; chưa chứng minh media còn hoạt động trên server.

**Root cause:** Lifecycle reset chỉ dọn timer/maps, không cô lập các thao tác HTTP đang chạy.

**Verification:** VM chờ create → finalize(forceEnd) → resolve late-conf: activeId=late-conf, hasActive=false.

**Recommendation:** Call generation ID; kiểm tra sau mỗi await; cleanup conference thành công muộn bằng ID/user context gốc.

**Regression test:** Hangup/đổi call trong lúc create pending; response cũ không sửa phiên mới, cleanup đúng conference.

## BUG-004

**Thêm nhánh conference thất bại bị đánh dấu đã merge**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/wazo.js:2898](../../src/services/wazo.js#L2898); [src/services/wazo.js:2243](../../src/services/wazo.js#L2243).
- **Related modules:** Adhoc sync, Calld client.

**Evidence — FACT:** mergedCallIds.add chạy trước await addParticipant; boolean false không được xử lý.

**Trigger conditions:** Conference có sẵn; PUT thêm participant trả 503/timeout.

**Expected behavior:** Nhánh giữ trạng thái chưa merge và được retry có kiểm soát.

**Actual/predicted behavior:** Lần sync sau bỏ qua ID đã nằm trong Set.

**Impact:** Thành viên không được nối vào conference dù state coi đã merge.

**Root cause:** Commit optimistic không rollback khi API thất bại.

**Verification:** VM gọi sync hai lần, addParticipant luôn false: chỉ một attempt, markedMerged=true.

**Recommendation:** Chỉ add khi success; retry/backoff theo call epoch, resync authoritative server state.

**Regression test:** PUT false/503 lần đầu, success lần sau: retry xảy ra đúng một lần, không duplicate participant.

## BUG-005

**Progress/accepted của nhánh phụ làm sai aggregate state nhóm**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/wazo.js:1423](../../src/services/wazo.js#L1423); [src/services/wazo.js:1507](../../src/services/wazo.js#L1507); [src/services/wazo.js:2874](../../src/services/wazo.js#L2874).
- **Related modules:** Group call handlers, CallsView, recording/CDR.

**Evidence — FACT:** ON_PROGRESS luôn đặt active.status=ringing; secondary accepted với active tồn tại đặt connected nhưng không tạo startTime/timer khi primary chưa answer. Fallback audio lại đòi status ringing.

**Trigger conditions:** Secondary answer trước primary; hoặc mời thêm nhánh lúc nhóm đã connected.

**Expected behavior:** Theo dõi status từng leg, aggregate connected nếu đã có leg talking; timer bắt đầu ở người đầu tiên.

**Actual/predicted behavior:** VM: connected,startTime=null,timer=false; progress tiếp theo đổi thành ringing.

**Impact:** Thời lượng/controls/auto-record có thể sai; đường phát audio dự phòng có thể bị bỏ qua. Chưa kiểm chứng âm thanh thật.

**Root cause:** Dùng một status đại diện nhiều leg mà handlers không phân biệt phase.

**Verification:** VM gọi named secondary accepted và progress; đã đọc fallback và timer xung quanh.

**Recommendation:** Lưu leg state keyed SIP ID, derive aggregate; khởi tạo clock một lần khi leg đầu accepted, không reset khi leg khác progress.

**Regression test:** Primary ringing, secondary accepted, nhánh thứ ba progress; aggregate connected, duration tăng, không bật lại ringback sai.

## BUG-006

**Dừng ghi âm báo thành công dù máy chủ từ chối**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/recordService.js:202](../../src/services/recordService.js#L202); [src/services/recordService.js:214](../../src/services/recordService.js#L214); [src/services/recordService.js:233](../../src/services/recordService.js#L233); [src/views/CallsView.vue:1716](../../src/views/CallsView.vue#L1716).
- **Related modules:** RecordService, recordStore, CallsView.

**Evidence — FACT:** Xóa recording state/callId trước fetch; chỉ xử lý fallback404, không kiểm tra kết quả cuối, network catch trả null response vẫn tới success.

**Trigger conditions:** Người dùng Stop khi request trả 500/403 hoặc mất mạng.

**Expected behavior:** Phân biệt stopping/failed/unknown; chỉ xác nhận dừng sau kết quả server.

**Actual/predicted behavior:** isRecording=false và trả object success cả HTTP500.

**Impact:** Người dùng có thể tin đã dừng trong khi server còn ghi; mất callId cho retry.

**Root cause:** State commit sớm và bỏ qua HTTP status.

**Verification:** VM HTTP500: reportedStopped=true, isRecording=false. Chưa gọi server.

**Recommendation:** Giữ callId tới xác nhận; kiểm tra fallback response; retry/resync, không phát stopped giả.

**Regression test:** 403/500/network giữ trạng thái lỗi có khả năng retry; 204 mới success.

## BUG-007

**Lỗi gửi command chat không truyền tới caller đổi tên/xóa nhóm**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:1106](../../src/services/chatService.js#L1106); [src/services/chatService.js:1247](../../src/services/chatService.js#L1247); [src/services/chatService.js:1424](../../src/services/chatService.js#L1424); [src/views/MessagesView.vue:611](../../src/views/MessagesView.vue#L611).
- **Related modules:** ChatService commands, MessagesView.

**Evidence — FACT:** sendMessage catch trả message sendFailed=true; deleteRoom/renameGroup await nhưng không kiểm tra flag, vẫn return success/đổi RAM.

**Trigger conditions:** HTTP500 khi giải tán hoặc đổi tên nhóm.

**Expected behavior:** Caller nhận failed, giữ/rollback state và cho retry.

**Actual/predicted behavior:** deleteRoom trả true, lọc room khỏi RAM; view báo xóa thành công. Rename tương tự.

**Impact:** Web và thiết bị khác không đồng nhất; phòng có thể xuất hiện lại.

**Root cause:** Hợp đồng lỗi service không thống nhất giữa return flag và throw.

**Verification:** VM deleteRoom HTTP500: reportedDeleted=true, rooms=0; control sendMessage riêng báo Lỗi gửi đúng.

**Recommendation:** Result type nhất quán; command kiểm tra server ack; không mutate final trước ack hoặc rollback.

**Regression test:** Tombstone/rename POST lỗi: không toast success, không ẩn room; retry không tạo side effect trùng.

## BUG-008

**Fallback máy lẻ giả chặn dữ liệu thật từ confd**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/views/LoginView.vue:295](../../src/views/LoginView.vue#L295); [src/views/LoginView.vue:314](../../src/views/LoginView.vue#L314); [src/views/LoginView.vue:334](../../src/views/LoginView.vue#L334).
- **Related modules:** LoginView, WazoService, CDR direction, self-call guard.

**Evidence — FACT:** SDK thiếu primaryNumber thì gán 1001/1002 theo tên tài khoản; điều kiện !realExtension đọc confd không còn đúng.

**Trigger conditions:** User thật có máy lẻ khác nhưng SDK profile thiếu line, confd trả đúng số.

**Expected behavior:** Dùng số thật từ confd hoặc trạng thái chưa xác định.

**Actual/predicted behavior:** Số fallback luôn truthy nên máy lẻ thật không được gán; localStorage nhận số giả.

**Impact:** Sai nhận diện bản thân/chiều CDR/metadata nhóm; không chứng minh SIP thực sự gọi dưới danh tính khác.

**Root cause:** Giá trị thử nghiệm được dùng thay cho unknown trước fallback API.

**Verification:** Đối chiếu điều kiện tĩnh đủ kết luận; chưa chạy login live.

**Recommendation:** Không dùng máy lẻ thử nghiệm trong main; map profile duy nhất rồi đồng bộ callStore.

**Regression test:** SDK thiếu số, confd trả 4321: final extension=4321; cả hai thiếu thì không giả 1001.

## BUG-009

**Chọn mic/loa không áp dụng vào cuộc gọi**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/components/common/SettingsModal.vue:254](../../src/components/common/SettingsModal.vue#L254); [src/components/common/SettingsModal.vue:670](../../src/components/common/SettingsModal.vue#L670); [src/services/wazo.js:1030](../../src/services/wazo.js#L1030); [src/services/wazo.js:1696](../../src/services/wazo.js#L1696).
- **Related modules:** SettingsModal, Wazo Phone, remote audio.

**Evidence — FACT:** Device IDs chỉ được dùng lưu và test mic meter; Phone.connect không truyền media.deviceId/audioDeviceOutput, audio element không setSinkId.

**Trigger conditions:** Chọn thiết bị khác mặc định rồi gọi.

**Expected behavior:** Call input/output theo lựa chọn được hỗ trợ; unsupported có thông báo.

**Actual/predicted behavior:** Cuộc gọi dùng cấu hình mặc định SDK/browser; test mic có thể dùng thiết bị khác cuộc gọi.

**Impact:** Nghe/nói qua sai thiết bị, không có tác dụng như UI hứa.

**Root cause:** Thiếu nối cấu hình phần cứng với phone/media layer.

**Verification:** Tìm kiếm toàn src các key và API setSinkId/audioDeviceOutput; không có nơi áp dụng. Chưa test thiết bị vật lý.

**Recommendation:** Truyền constraints/output option theo SDK; cập nhật output đúng audio owner; feature detect.

**Regression test:** Hai mic/loa, chọn B: stream constraints và output target=B; fallback rõ khi browser không hỗ trợ.

## BUG-010

**Computed đọc state thường của singleton bị cache cũ**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/views/CallsView.vue:940](../../src/views/CallsView.vue#L940); [src/views/CallsView.vue:1006](../../src/views/CallsView.vue#L1006); [src/services/wazo.js:44](../../src/services/wazo.js#L44).
- **Related modules:** CallsView, WazoService shared state.

**Evidence — FACT:** _isDialing và secondaryCallSessions là field/Map thường; computed không có reactive dependency tương ứng.

**Trigger conditions:** Render lần đầu false/Map rỗng, sau đó field/Map thay đổi.

**Expected behavior:** Disabled/nhánh pending thay đổi cùng service state.

**Actual/predicted behavior:** isDialing có thể giữ false, pendingRingingMembers giữ danh sách cũ.

**Impact:** UI guard và trạng thái pending sai; service guard vẫn tồn tại nên không khẳng định mọi doubleclick tạo duplicate.

**Root cause:** Nhầm singleton field với reactive store.

**Verification:** VM Vue computed đọc false → service flag true → computed vẫn false.

**Recommendation:** Chuyển UI-owned state sang reactive/shallow store hoặc refs; không chỉ ép re-render.

**Regression test:** Cache computed trước mutation; sau mutation giá trị và DOM phải đổi mà không cần state phụ.

## BUG-011

**Tải audio trả sai thứ tự có thể phát sai bản ghi sau chuyển trang**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/views/HistoryView.vue:259](../../src/views/HistoryView.vue#L259); [src/views/HistoryView.vue:275](../../src/views/HistoryView.vue#L275); [src/views/HistoryView.vue:289](../../src/views/HistoryView.vue#L289); [src/views/HistoryView.vue:414](../../src/views/HistoryView.vue#L414).
- **Related modules:** HistoryView, RecordService, KeepAlive.

**Evidence — FACT:** Sau await audioUrl không đối chiếu currentPlayingId hoặc active lifecycle; globalAudio bị thay bằng response cũ.

**Trigger conditions:** Play A rồi B, B tải xong trước A; hoặc deactivated trong khi tải.

**Expected behavior:** Chỉ request mới nhất của view đang active được play.

**Actual/predicted behavior:** A vẫn play sau B trong khi UI selected B; deactivation stop không ngăn callback muộn.

**Impact:** Phát nhầm/đồng thời ghi âm, có thể phát khi đã rời trang hoặc có call.

**Root cause:** Thiếu cancellation/generation cho playback.

**Verification:** VM played=[audio-b,audio-a], uiSelected=b.

**Recommendation:** Playback request sequence + activation guard; hủy/revoke request cũ; audio instance ownership rõ.

**Regression test:** Resolve B trước A, hoặc deactivate trước resolve: chỉ B phát; rời trang không có audio mới.

## BUG-012

**Bộ lọc cuộc gọi nhỡ khác điều kiện badge**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/views/HistoryView.vue:456](../../src/views/HistoryView.vue#L456); [src/views/HistoryView.vue:470](../../src/views/HistoryView.vue#L470).
- **Related modules:** HistoryView counts/filter.

**Evidence — FACT:** Badge chỉ inbound unanswered hoặc missed; rows dùng missed || !answered cho cả outbound.

**Trigger conditions:** Có cuộc gọi outbound declined unanswered.

**Expected behavior:** Badge và danh sách dùng cùng định nghĩa missed.

**Actual/predicted behavior:** Badge có thể 0 nhưng tab hiển thị một cuộc gọi đi thất bại.

**Impact:** Phân loại nhật ký gây hiểu nhầm, số đếm sai so với rows.

**Root cause:** Hai predicate nghiệp vụ bị lặp và lệch.

**Verification:** VM một outbound declined: badge0, rows1.

**Recommendation:** Dùng chung predicate inbound missed, theo nghiệp vụ đã thống nhất.

**Regression test:** Ma trận inbound/outbound × answered/missed/declined cho cả badge và filter.

## BUG-013

**Gửi tin xong kéo người dùng về phòng cũ**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/views/MessagesView.vue:899](../../src/views/MessagesView.vue#L899); [src/views/MessagesView.vue:915](../../src/views/MessagesView.vue#L915); [src/views/MessagesView.vue:923](../../src/views/MessagesView.vue#L923).
- **Related modules:** MessagesView, ChatService.

**Evidence — FACT:** targetId chụp trước await; sau gửi/getRooms luôn gán currentRoom thành target, không so lựa chọn hiện tại.

**Trigger conditions:** Gửi tại A, trong lúc pending bấm sang B.

**Expected behavior:** Giữ B; chỉ cập nhật dữ liệu A.

**Actual/predicted behavior:** currentRoom trở lại A; có nguy cơ người dùng gửi lượt tiếp nhầm hội thoại.

**Impact:** Sai ngữ cảnh trao đổi và gián đoạn UI.

**Root cause:** Response quyết định selection thay cho hành động user mới nhất.

**Verification:** VM send A pending → select B → resolve send: selected a.

**Recommendation:** Chỉ rebind target nếu selection vẫn target và view vẫn active; tách mutation data khỏi selection.

**Regression test:** Send A pending, select B: resolve/reject không đổi selection B.

## BUG-014

**Nhóm đã đóng xuất hiện lại khi cold load**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:480](../../src/services/chatService.js#L480); [src/services/chatService.js:499](../../src/services/chatService.js#L499); [src/services/chatService.js:547](../../src/services/chatService.js#L547); [src/services/chatService.js:585](../../src/services/chatService.js#L585).
- **Related modules:** Chat rooms prefetch, tombstone parser.

**Evidence — FACT:** getRooms xây serverRooms chưa đưa vào this.rooms; getRoomMessages tìm localRoom trong this.rooms nên undef khi cold. Tombstone bị lọc khỏi returned messages; isClosed không truyền về serverRooms.

**Trigger conditions:** Reload ứng dụng sau khi nhóm có ROOM_CLOSED cuối cùng.

**Expected behavior:** Phòng vẫn bị ẩn nhất quán sau refresh.

**Actual/predicted behavior:** Phòng được trả về với messages=[] và preview mặc định, filter không thấy dấu đóng.

**Impact:** Giải tán nhóm không bền vững ở UI.

**Root cause:** Hàm tải messages mất metadata trạng thái vì chỉ trả array và mutate một object chưa tồn tại.

**Verification:** VM rooms server có tombstone cuối: getRooms vẫn trả closed-room.

**Recommendation:** Return {messages,roomState}, truyền vào mapping; tốt hơn dùng room state server chuẩn.

**Regression test:** Cold/warm load cùng tombstone và room tái tạo: trạng thái đóng/mở phải nhất quán.

## BUG-015

**Mic stream có thể mở sau khi modal đã đóng**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/components/common/SettingsModal.vue:319](../../src/components/common/SettingsModal.vue#L319); [src/components/common/SettingsModal.vue:330](../../src/components/common/SettingsModal.vue#L330); [src/components/common/SettingsModal.vue:401](../../src/components/common/SettingsModal.vue#L401); [src/components/common/SettingsModal.vue:441](../../src/components/common/SettingsModal.vue#L441).
- **Related modules:** SettingsModal, getUserMedia, lifecycle.

**Evidence — FACT:** stopMicMeter dọn resource hiện có, không invalidate getUserMedia/loadAudioDevices pending. Continuation vẫn tạo context và RAF.

**Trigger conditions:** Đóng modal/đổi tab khi quyền mic hoặc getUserMedia còn pending.

**Expected behavior:** Nếu view/modal không còn cần mic thì stream mới trả về được stop ngay.

**Actual/predicted behavior:** Stream mới được gán sau cleanup và vẫn active.

**Impact:** Microphone sử dụng khi UI đã đóng, rò tài nguyên/riêng tư.

**Root cause:** Không có generation/disposed guard sau await.

**Verification:** VM start → stop trước resolve → cấp stream: track stopCount=0.

**Recommendation:** Cancellation token logic/generation; sau await kiểm tra isOpen/tab; stop tracks của kết quả stale.

**Regression test:** Resolve mic sau close/tab switch/unmount và đổi mic liên tiếp: mọi stream stale đều stop.

## SEC-003

**Log chat và cache ghi âm sống qua logout**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:284](../../src/services/chatService.js#L284); [src/services/loggerService.js:12](../../src/services/loggerService.js#L12); [src/App.vue:50](../../src/App.vue#L50); [src/services/wazo.js:397](../../src/services/wazo.js#L397); [src/services/recordService.js:315](../../src/services/recordService.js#L315); [src/services/recordService.js:399](../../src/services/recordService.js#L399).
- **Related modules:** Logger/DebugLogDrawer, Wazo logout, RecordService.

**Evidence — FACT:** Chat log chứa nguyên content; App giữ DebugLogDrawer toàn cục. logout không clearLogs/clearSessionCache; audio cache trả URL trước kiểm tra token.

**Trigger conditions:** A có log chat/tải audio, logout rồi B dùng cùng SPA.

**Expected behavior:** Xóa nội dung/log và revoke object URLs khi kết thúc phiên.

**Actual/predicted behavior:** Log A vẫn mở được từ drawer; blob URL còn trong Map và không cần token khi cache hit.

**Impact:** Lộ nội dung phiên trước trên thiết bị dùng chung; cache audio tồn tại tới reload.

**Root cause:** Hai singleton không nằm trong reset lifecycle.

**Verification:** Đọc reference graph/callers; clearSessionCache chỉ có khai báo, clearLogs chỉ nút xóa tay. Chưa trích audio thực.

**Recommendation:** Cleanup tại auth session boundary, log tối thiểu/redaction; namespace cache theo user+host và epoch.

**Regression test:** A log/download → logout/login B: log A biến mất, URL revoked, cache hit không trả tài nguyên A.

## LOGIC-001

**Đã nhận/đã xem và danh sách người đọc được suy đoán**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:722](../../src/services/chatService.js#L722); [src/services/chatService.js:1092](../../src/services/chatService.js#L1092); [src/views/MessagesView.vue:761](../../src/views/MessagesView.vue#L761).
- **Related modules:** ChatService receipts, Read ID modal.

**Evidence — FACT:** Đối phương online làm tin thành Đã nhận; có reply làm tin trước thành Đã xem; readers rỗng thì UI liệt kê đối phương/tất cả thành viên.

**Trigger conditions:** Chưa có read acknowledgement, người dùng mở Read ID.

**Expected behavior:** Hiển thị unknown/chưa có xác nhận; danh sách chỉ người thực sự có receipt.

**Actual/predicted behavior:** UI thể hiện nhận/xem/người đọc từ suy đoán presence/membership.

**Impact:** Thông tin giao nhận không đáng tin cho trao đổi công việc.

**Root cause:** Thiếu receipt protocol nên client tự bù dữ liệu như sự thật.

**Verification:** Bằng chứng điều kiện/predicate tĩnh; không có endpoint read receipt được gọi trong flow đã đọc.

**Recommendation:** Read cursor/ack server được quyền; phân biệt sent/delivered/read/unknown.

**Regression test:** Recipient online nhưng chưa mở chat: không Đã xem; readers=[] phải hiển thị chưa có xác nhận.

## LOGIC-002

**Thay thành viên tạo phòng mới và chỉ chuyển tối đa 25 tin**

- **Severity:** P2.
- **Status:** CONFIRMED BUG.
- **Confidence:** High.
- **Location:** [src/services/chatService.js:1205](../../src/services/chatService.js#L1205); [src/services/chatService.js:1279](../../src/services/chatService.js#L1279); [src/services/chatService.js:1303](../../src/services/chatService.js#L1303); [src/services/chatService.js:1351](../../src/services/chatService.js#L1351).
- **Related modules:** Group membership, migration/forwarding, MessagesView.

**Evidence — FACT:** Thêm/xóa người bằng createGroupRoom và đóng phòng cũ; forwardedMessages.slice(-25); HTTP copy lỗi bị bỏ qua. remove cho phép remaining2 nhưng create đòi tối thiểu3.

**Trigger conditions:** Nhóm có >25 tin, thay thành viên; hoặc nhóm3 xóa1.

**Expected behavior:** Quyền thành viên/lịch sử theo policy rõ, không tuyên bố chuyển toàn bộ khi chỉ25; validate tối thiểu thống nhất.

**Actual/predicted behavior:** Phòng mới chỉ có tối đa25 tin từ RAM, có thể ít hơn do tải50/partial failure; 3→2 bị create từ chối.

**Impact:** Mất khả năng xem lịch sử qua phòng hiện hành, inconsistent UX; không khẳng định xóa dữ liệu vật lý ở phòng cũ.

**Root cause:** Membership modeled as room replacement, copy không transactional.

**Verification:** Truy vết create/remove/add và comment 'chuyển toàn bộ' so slice(-25); chưa chạy server.

**Recommendation:** Backend membership chuẩn, giữ room identity; nếu buộc migrate cần policy, full pagination, copy ack và rollback.

**Regression test:** Nhóm100tin đổi người: lịch sử truy cập đúng policy; copy lỗi không đóng phòng cũ; test3→2 rõ quyết định.

## ARCH-001

**State nghiệp vụ và API phụ thuộc vòng, thiếu contract kiểm thử**

- **Severity:** P2.
- **Status:** DESIGN RISK.
- **Confidence:** High.
- **Location:** [src/services/wazo.js:1](../../src/services/wazo.js#L1); [src/services/chatService.js:1](../../src/services/chatService.js#L1); [src/services/contactService.js:1](../../src/services/contactService.js#L1); [src/components/common/SettingsModal.vue:480](../../src/components/common/SettingsModal.vue#L480); [package.json:6](../../package.json#L6).
- **Related modules:** Core services, views, SDK adapter.

**Evidence — FACT:** Wazo import chat/contact/history/websocket và các module import ngược; wazo3093 dòng, Calls4304, Messages2753; Settings trực tiếp fetch; thiếu test/lint scripts.

**Trigger conditions:** Thêm backend mới, đổi SDK hoặc sửa auth tác động nhiều domain.

**Expected behavior:** Ranh giới session/call/chat/media rõ và có contract/regression tests.

**Actual/predicted behavior:** State chia giữa reactive store, plain fields, local refs và event bus; guard/mapping/HTTP lỗi bị lặp.

**Impact:** Tăng nguy cơ regression và khó chứng minh async invariants; không coi kích thước file tự nó là bug.

**Root cause:** Facade tích lũy trách nhiệm, chưa tách ownership của state khỏi integration.

**Verification:** Static import graph và scripts; không kết luận circular import đang crash (ESM lazy access hiện có thể chạy).

**Recommendation:** Tách dần state/session boundary và SDK/API adapter sau regression tests; tránh rewrite lớn hoặc thêm abstraction không có caller.

**Regression test:** Contract test cho adapter và transitions; khi đổi module không cần fake toàn bộ singleton graph.
