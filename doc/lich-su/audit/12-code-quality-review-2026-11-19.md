# Đánh giá chất lượng code và khả năng bảo trì

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

Ngày 19/11/2026. Snapshot đầu lượt: Git `affdb80`, working tree sạch. Đây là lượt phân tích sau sửa lỗi và sau khi bỏ ghim/read; không chỉnh sửa mã ứng dụng.

[Phương án refactor](13-refactor-blueprint-2026-11-19.md) · [Phạm vi, hash và xác minh](14-incremental-review-snapshot-2026-11-19.md)

## Kết luận trực tiếp

**Có thể tiếp tục phát triển trên code hiện tại, nhưng chưa nên coi kiến trúc và khả năng bảo trì là tốt hoặc đã tối ưu. Refactor toàn dự án làm được và tương đối phù hợp ở giai đoạn này, nếu thay đổi từng phần và giữ hành vi đang hoạt động.**

Các sửa lỗi vừa qua cải thiện tính đúng đắn và quản lý phiên, không tự động giải quyết phân tầng, hợp đồng dữ liệu, độ phức tạp điều phối hoặc kiểm thử tích hợp. Số file ít giúp dễ định vị ban đầu; nhiều trách nhiệm trong cùng file lại làm việc hiểu và sửa sâu khó hơn.

| Câu hỏi | Đánh giá | Cơ sở |
|---|---|---|
| Code đã tốt chưa? | Có nền tảng, chất lượng chưa đồng đều | Có services, reactive state, cleanup và regression tests; vẫn có thành công giả và nhiều loại kết quả API. |
| Đã tối ưu chưa? | Chưa đủ cơ sở khẳng định; có điểm cần ưu tiên | Cold load chat tải tin từng phòng đồng thời; danh bạ/CDR/tin nhắn giới hạn cố định; bundle đầu vào lớn. Chưa benchmark tải thực. |
| Có mở rộng được không? | Có, nhưng chi phí và rủi ro sửa tăng | Auth, SDK, WS, media, group call, profile, contact và UI còn liên kết chặt. |
| Người mới có dễ đọc không? | File nhỏ dễ; luồng gọi/chat khó | Muốn hiểu một thao tác phải lần qua view, service, window event, SDK callback, store và timer. |
| Tên hàm/biến rõ không? | Nhiều tên tốt, một số tên không phản ánh contract | `captureSessionContext`, `stopCurrentAudio` rõ; `isSipOnline`, `getRooms`, `loadSavedRooms` dễ gây hiểu khác hành vi. |
| Cấu trúc thư mục ổn không? | Hợp lý cho lúc bắt đầu, chưa phù hợp với độ phức tạp hiện tại | Tách theo loại file nhưng chưa tách theo nghiệp vụ; `services/wazo.js` trở thành trung tâm quá lớn. |
| Có nên refactor ngay không? | Nên chuẩn bị và triển khai từng phần | Chưa tích hợp backend/IdP mới nên còn cơ hội ổn định boundary trước khi thêm tính năng. Không cần viết lại từ đầu. |

Không chấm điểm số vì chưa có chuẩn chấm đã thống nhất, số liệu tải thật và coverage tích hợp đủ để lượng hóa một cách đáng tin cậy.

## Quy mô thực tế

Inventory `src/` có **23 file: 10 Vue SFC, 12 JavaScript và 1 CSS**. Tổng **18.959 dòng** tính bằng split newline, bao gồm comment, dòng trống, template và style. Không coi số dòng là điểm chất lượng hoặc thời gian cần để refactor.

| File | Tổng dòng | Template | Script | Style | Nhận xét |
|---|---:|---:|---:|---:|---|
| `src/services/wazo.js` | 3.209 | — | JS | — | 73 class methods kể cả constructor/accessor; tập trung nhiều miền trách nhiệm. |
| `src/views/CallsView.vue` | 4.295 | 910 | 1.064 | 2.318 | Không phải 4.295 dòng business logic; vẫn gồm nhiều panel, modal và luồng điều phối. |
| `src/views/MessagesView.vue` | 2.521 | 458 | 808 | 1.252 | Danh sách phòng, tin nhắn, quản trị nhóm và gọi nhóm chung một component. |
| `src/services/chatService.js` | 1.237 | — | JS | — | REST, mapping, state, protocol, fallback và thông báo. |
| `src/components/common/SettingsModal.vue` | 1.137 | 228 | 515 | 390 | UI, quyền thiết bị, đo mic, password và Confd. |
| `src/services/contactService.js` | 812 | — | JS | — | API, schema adaptation, presence, favorites và polling. |

Số dòng các block là nội dung block, không cộng chính xác thành tổng file do tag và newline phân cách. Trên toàn bộ 10 SFC có khoảng **6.524 dòng style** theo cùng cách đếm. Tách CSS đơn thuần sẽ làm file ngắn hơn nhưng chưa giảm coupling nghiệp vụ.

Các hàm lớn được AST xác định: `attachListeners` 329 dòng, `openWebSocketEvents` 258, `_finalizeCallTermination` 253, `getRooms` 224, `getContacts` 222, `validateAndMakeCall` 218. Đây là dấu hiệu cần phân trách nhiệm, không phải bằng chứng mọi hàm dài đều sai.

## Những điểm nên giữ

- Vue 3 Composition API và cấu trúc service hiện tại đủ để nâng cấp dần; không cần đổi framework.
- `callStore`, `recordStore`, contact reactive state và Map nhánh phụ đã cung cấp các điểm tập trung state có thể phát triển tiếp.
- `sessionScope` tách ownership phiên khỏi SDK; kiểm tra response/body và kết quả đến muộn là cơ chế hữu ích, cần giữ khi chuyển file.
- Luồng gọi đã có guard, named listeners, cleanup và generation cuộc gọi; không xóa các guard chỉ để code ngắn.
- Có 27 regression tests cho nhiều đường lỗi, hủy và bất đồng bộ; tốt hơn tình trạng chưa có test trước audit.
- Ghim/read đã được loại bỏ theo quyết định sản phẩm. Không đưa lại trong bản thiết kế mới.
- Main routes đã có lazy loading theo kết quả audit cũ, hash router không đổi. Không kết luận toàn ứng dụng thiếu code splitting.

## Các vấn đề chất lượng chính

### CQ-ARCH-01 — Service trung tâm và dependency cycle

**DESIGN RISK, ưu tiên P2, confidence High.**

[wazo.js](D:/Project/Smart_Call_Web/src/services/wazo.js:1) vừa quản lý auth/token, user identity, websocket, SIP/SDK, âm thanh, cuộc gọi đơn, hội nghị, presence, timer và trigger lịch sử. Các vị trí điển hình: [openWebSocketEvents](D:/Project/Smart_Call_Web/src/services/wazo.js:817), [kết thúc cuộc gọi](D:/Project/Smart_Call_Web/src/services/wazo.js:1158), [attachListeners](D:/Project/Smart_Call_Web/src/services/wazo.js:1453).

Đồ thị import xác nhận các vòng `wazo ↔ contact`, `wazo ↔ chat`, `wazo ↔ history`, `wazo ↔ websocket`, cùng những vòng đi qua nhiều service. ESM cycle không tự động chứng minh ứng dụng crash; rủi ro là init order, ownership, test setup và tác động ngoài ý muốn khi sửa.

Đề xuất: adapter Wazo chỉ biết giao thức/SDK; state và controller thuộc từng feature; app bootstrap nối các phần. Giữ facade cũ trong thời gian chuyển đổi.

### CQ-ARCH-02 — Một state được nhìn qua nhiều bản sao và sự kiện

**DESIGN RISK, P2, High.**

CallsView giữ `contacts` riêng rồi copy từ service và nghe sự kiện; MessagesView giữ `rooms` riêng rồi cập nhật từ `chatService.rooms`. View còn thay trực tiếp dữ liệu của service trong `confirmLeaveKickedRoom`. Nguồn dữ liệu server, state service, snapshot view và storage kỹ thuật chưa có ranh giới công khai thống nhất.

Các entry points: [CallsView](D:/Project/Smart_Call_Web/src/views/CallsView.vue:1647), [MessagesView](D:/Project/Smart_Call_Web/src/views/MessagesView.vue:625). View cũng truy cập thuộc tính có dấu `_` như `wazoService._isDialing`.

Đề xuất: mỗi feature có một state owner, cung cấp state chỉ đọc/selectors và command; view chỉ giữ filter, selection và trạng thái modal của riêng màn hình. Dùng event cho sự kiện rời rạc, không dùng nhiều event để thay thế mọi reactive binding.

### CQ-ARCH-03 — API contract, model và error chưa nhất quán

**DESIGN RISK, P2, High.**

Hàm có nơi trả boolean, nơi trả `{success, reason}`, nơi trả Response, nơi trả message có `sendFailed`, nơi swallow lỗi rồi trả dữ liệu cũ. Mỗi view phải tự biết contract ngầm của từng hàm.

UUID, ID hiển thị, raw contact ID, máy lẻ, SIP ID, server call ID và conference ID có thể cùng được gọi là `id`, `number`, `ext` hoặc `callId`. Mảng backend raw và object đã normalize cùng đi qua nhiều fallback. Tại [startVoiceCall](D:/Project/Smart_Call_Web/src/views/MessagesView.vue:1130), view vẫn phải tìm `ext/extension/number/extra.extension`.

Đề xuất: chuẩn hóa DTO tại adapter; định nghĩa domain model bằng JSDoc/types và result contract rõ. Mỗi command thay đổi dữ liệu phải phân biệt server xác nhận, thất bại và hủy. Có thể chọn throw domain error hoặc Result union, nhưng phải thống nhất trong cùng tầng. Không bọc thêm năm lớp chỉ để đổi tên một `fetch`.

### CQ-UI-01 — View quá nhiều trách nhiệm, logic lặp và comment cũ

**DESIGN RISK, P2, High.**

CallsView chứa dialpad, contact search/filter, favorites, chọn người gọi nhóm, cuộc gọi đang hoạt động, ghi âm, route command và các modal. MessagesView kết hợp room list, chat, group administration và gọi thoại. SettingsModal gọi Confd trực tiếp; LoginView tự hoàn thiện profile và ghi auth state bên cạnh WazoService.

Guard busy/offline/DND có ở view và service. Một phần validation sớm ở UI là hợp lý; policy quyết định có được gọi phải có một nguồn chuẩn, tránh thông báo và điều kiện lệch nhau. Avatar initials, thời lượng và định danh cũng được dựng lại ở nhiều nơi.

Comment còn mô tả chuyển toàn bộ lịch sử khi thêm thành viên trong khi service hiện chủ động chặn; có comment nói bảo toàn badge sau khi unread đã bị xóa. Một số `async` method mất indentation; một số catch chỉ `throw e` lại. Đây là nợ đọc hiểu, không phải lỗi cú pháp.

### CQ-TEST-01 — Test đang bảo vệ logic nhưng chưa đủ bảo vệ refactor

**DESIGN RISK, P2, High.**

[Harness](D:/Project/Smart_Call_Web/tests/regressions.test.cjs:49) đọc source, bỏ import/export bằng regex và chạy VM; view được lấy bằng cách split chuỗi `<script setup>`. `watch` và nhiều lifecycle/browser API bị thay bằng fixture. Vì vậy 27 tests đạt không chứng minh actual module imports, template wiring, watcher scheduling, routing hoặc SIP integration đúng.

Đổi import thành nhiều dòng hoặc đổi cách viết SFC có thể làm harness hỏng dù sản phẩm đúng. Trước khi chuyển hàng loạt file, chuyển dần tests sang import module thuần và component test thực, vẫn giữ scenario nghiệp vụ cũ. Thêm smoke test import toàn app và kiểm tra dependency direction.

`package.json` chưa có scripts test/lint/typecheck/check-format và inventory không thấy pipeline CI. Prettier hiện chỉ có lệnh write, chưa phải cổng chất lượng tự động. Không đồng nhất “thiếu TypeScript” với “code sai”; model contract và kiểm tra tự động mới là nhu cầu thực.

### CQ-PERF-01 — Tải dữ liệu và cache chưa có chiến lược cho quy mô lớn

**DESIGN RISK, P2, High cho cơ chế; chưa đo tác động tải.**

- [Cold room load](D:/Project/Smart_Call_Web/src/services/chatService.js:440) gọi `getRoomMessages(..., 15, ...)` cho từng phòng chưa có tin bằng `Promise.allSettled`, chưa giới hạn concurrency. Với R phòng cần nạp: một request danh sách phòng cộng R request tin, chưa kể danh bạ. Không phải mọi lần refresh đều có R request vì chỉ phòng rỗng mới được prefetch.
- [Danh bạ](D:/Project/Smart_Call_Web/src/services/contactService.js:349) dùng `limit=1000`; chưa có vòng tải trang tiếp theo. CDR và tin nhắn cũng có limit; không thấy cơ chế UI tải tiếp. Giới hạn tải không tự là lỗi nếu product chấp nhận cửa sổ gần nhất, nhưng không thể gọi đó là toàn bộ dữ liệu.
- Lookup danh bạ thường dùng `.find` và mapping phòng/thành viên gọi lookup lồng nhau. Khi danh bạ/phòng lớn, cân nhắc index `Map` theo UUID/máy lẻ và chuẩn hóa search text; chỉ làm sau đo đạc.
- [Cache audio](D:/Project/Smart_Call_Web/src/services/recordService.js:315) được revoke khi logout, nhưng chưa có giới hạn dung lượng/số bản hoặc LRU trong phiên dài. Chưa đo memory để kết luận mức rò/rủi ro thực tế.
- Websocket có polling dự phòng: token mỗi 5 giây, presence mỗi 10 giây. Chưa có số liệu để gọi là quá tải; cần tránh request trùng khi nhiều trigger, giới hạn in-flight và cân nhắc backoff/jitter khi lỗi mạng.
- Artifact `dist/assets/index-CMaCPWtM.js` đang có khoảng 1.191 MB dạng thập phân trước gzip. Build ở lượt trước cảnh báo chunk >500 kB. Đây là dữ liệu artifact hiện có, không phải kết quả benchmark hoặc build mới của lượt audit này.

Ưu tiên request/pagination/caching trước các tối ưu nhỏ như thay `.filter` vô điều kiện. Không dùng giới hạn 1000 bản ghi làm bằng chứng hệ thống backend chỉ chịu được 1000 người dùng.

## Ba lỗi còn tồn tại được kiểm chứng trong lượt này

Đây là phát hiện mới trong assessment hiện tại, không phải tuyên bố 21 findings cũ đã sửa hoàn toàn. Cả ba được tái hiện bằng fixture cô lập từ harness đang có; không gọi server thật.

### CQ-BUG-01 — Favorites báo trạng thái thành công khi API lỗi

**CONFIRMED BUG, P2, High.**

[toggleFavorite](D:/Project/Smart_Call_Web/src/services/contactService.js:118) cập nhật trước state; nếu server không đồng bộ được chỉ log cảnh báo rồi vẫn `return willBeFavorite` ở dòng 220. [Caller](D:/Project/Smart_Call_Web/src/views/CallsView.vue:1631) dùng giá trị này để cập nhật và báo đã thêm/bỏ yêu thích.

Probe HTTP 500 trả `{returned:true, isFavorite:true, requests:1}`. Lỗi có thể làm UI và server không đồng bộ. Nguồn dự phòng chỉ giúp khi tìm được endpoint thành công; không xử lý được trường hợp cuối cùng đều thất bại.

Hướng sửa: rollback hoặc thể hiện trạng thái chưa đồng bộ, trả lỗi/result đúng; caller chỉ báo server đã lưu khi có xác nhận. Test hồi quy: HTTP500/403/mất mạng, thao tác bật/tắt nhanh và đổi phiên khi pending.

### CQ-BUG-02 — Xóa nhóm hàng loạt bỏ qua số nhóm xóa thực tế

**CONFIRMED BUG, P2, High.**

[deleteMultipleRooms](D:/Project/Smart_Call_Web/src/services/chatService.js:1198) bắt lỗi từng phòng và trả `count`. [handleDeleteSelectedRooms](D:/Project/Smart_Call_Web/src/views/MessagesView.vue:558) bỏ qua giá trị trả về, xóa selection và báo toàn bộ số đã chọn thành công.

Probe: chọn 1 nhóm, service trả 0, UI vẫn phát toast `Đã xóa 1 nhóm thành công!`. Việc thiếu metadata quản trị có thể chặn thao tác trước đó ở nhiều môi trường; lỗi vẫn reachable khi có nhóm mà người dùng được phép chọn nhưng server từ chối mutation.

Hướng sửa: trả danh sách thành công/thất bại, thông báo kết quả từng phần và giữ selection thất bại. Test: 0/N, một phần và tất cả thành công.

### CQ-BUG-03 — Có token bị đồng nhất với SIP đã kết nối

**CONFIRMED BUG về trạng thái hiển thị, P2, High.**

[isSipOnline](D:/Project/Smart_Call_Web/src/components/layout/AppHeader.vue:117) là `isRegistered || có token và không offline mode`. Template lại dùng nó để khẳng định đã kết nối an toàn qua WSS ở dòng 68.

Probe cho `isRegistered=false` nhưng token tồn tại, kết quả `displayedOnline=true`. Đây không phải bằng chứng cuộc gọi sẽ thành công; token và kết nối SIP là hai trạng thái khác nhau.

Hướng sửa: tách `isAuthenticated`, `isSipRegistered`, `isEventSocketConnected`; hiển thị rõ đang kết nối/thất bại. Nếu chỉ muốn biểu thị quyền truy cập giao diện, đổi cả tên và copy, không dùng nhãn đã kết nối SIP. Test: có token nhưng SDK disconnected, reconnecting, registered và logout.

## Đánh giá tên hàm, tên biến và khả năng onboarding

Không cần đổi toàn bộ tên. Tên tốt nên được giữ để giảm nhiễu diff.

| Hiện tại | Đánh giá | Hướng chuẩn hóa |
|---|---|---|
| `captureSessionContext`, `assertSessionContext`, `stopCurrentAudio`, `findContactByUuid` | Diễn đạt hành động/ý nghĩa tốt | Giữ; thêm contract và ownership khi cần. |
| `isSipOnline` | Tên không khớp điều kiện hiện tại | Tách theo trạng thái thật như CQ-BUG-03. |
| `getRooms` | Không chỉ lấy danh sách; còn tải danh bạ, tin và ghi state | Tách API `listRooms`, mapper và controller `loadRoomsWithPreviews`. |
| `loadSavedRooms` | Tên gợi tải lưu trữ, hiện luôn trả `[]` | Loại bỏ shim khi hết caller hoặc đặt rõ vai trò trong quá trình chuyển đổi. |
| `localHistory` | Là dữ liệu RAM, không phải database/persistent storage | `recentCalls`/`historyState.items`; ghi rõ các record tạm chưa được server xác nhận. |
| `clearAllHistory`, `deleteItem` | Tên dễ bị hiểu xóa server, thực tế chỉ xóa RAM | Nếu còn cần: `clearHistoryCache`, `removeCachedCall`. Kiểm tra caller trước khi đổi/xóa. |
| `ext`, `exten`, `number`, `rawId`, `uuid` | Viết tắt phù hợp ở mapper, khó khi lan sang domain/UI | Domain dùng `extension`, `userUuid`, `directoryContactId`; API giữ nguyên DTO bên trong adapter. |
| `callId`, `sipCallId`, `serverCallId`, `conferenceId` | Phải phân biệt nhất quán để tránh truyền nhầm | JSDoc/type + tên đầy đủ ở boundary, không đổi tên các trường SDK gốc. |
| `clientId`, `currentClientId`, `myClientId` | Cùng được gán một ID; ownership khó đọc | Xác minh bên ngoài có cần alias không, rồi gom một nguồn chuẩn. |
| `c`, `m`, `it`, `s`, `res` | Chấp nhận được trong callback vài dòng | Với mapper/hàm dài dùng `contact`, `message`, `room`, `response`, `extension`. |

Người mới nên có một tài liệu “hiện trạng” ngắn, chỉ rõ app bootstrap, domain model, state owner, đường gọi API, state machine cuộc gọi và cách chạy test. Các journal cũ dài và comment khẳng định “100%/0ms” không thay thế được contract đã kiểm chứng. Kế hoạch cũ ghi Vite5/Router4 trong khi lock hiện là Vite8.3.8/Router5.5.0; cần coi tài liệu đó là lịch sử/kế hoạch, không làm source of truth.

## Tính mở rộng: cần tách ba vấn đề

1. **Thêm tính năng:** refactor boundary sẽ giúp thêm SSO, backend Web và các nghiệp vụ mới; không cần xóa UI hiện tại.
2. **Tăng dữ liệu trong một phiên trình duyệt:** cần pagination, giới hạn concurrency, index, cache budget và profiling render/media.
3. **Tăng người dùng toàn hệ thống:** cần số liệu Wazo/IdP/backend, giới hạn websocket, ACL và tải hạ tầng. Repo frontend không đủ bằng chứng để khẳng định số concurrent users.

Không có backend Python/SQLite mới đang chạy trong nguồn ứng dụng này. Các mẫu Android trong `FileQuest` là tài liệu đối chiếu, không phải code được Vite build. Refactor Web không tự sửa giao thức hoặc hành vi Android/server.

## Thứ tự ưu tiên

1. Làm rõ và sửa ba contract lỗi đã kiểm chứng trước khi đóng băng baseline refactor; hiện chỉ ghi nhận, chưa sửa theo phạm vi lượt này.
2. Bổ sung test theo import/component thực, thống nhất command results và DTO cho các phần sắp tách.
3. Tách contact/history/settings/identity và UI có rủi ro thấp hơn; dần loại cycle.
4. Cô lập SDK workaround; tách call lifecycle và group coordinator cuối cùng, có staging SIP/media.
5. Tối ưu cold chat load, paging và memory sau khi đo baseline; không gộp thay framework/SDK/TS toàn bộ vào cùng đợt.

Kết luận readiness: đủ căn cứ lên phương án refactor và tiếp tục phát triển có kiểm soát; chưa đủ căn cứ xác nhận production readiness toàn hệ thống chỉ từ test cô lập và các build trước đó.
