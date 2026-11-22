# Kiến trúc, Vue và chất lượng code

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

[Hiểu dự án](01-project-understanding.md) · [Findings](03-bugs-and-logic-findings.md) · [Kế hoạch](07-prioritized-action-plan.md).

## Điểm mạnh

- Có service cho từng miền nghiệp vụ; UI tái sử dụng Wazo callStore và recordStore thay vì hoàn toàn tự quản SIP.
- Main routes có lazy import, KeepAlive giúp giữ UI qua đổi tab; cache key có user UUID.
- Phone listener đã chuyển sang named handler/detach. Session guard đã có để bảo vệ active session ID.
- Có single-flight rooms/history, timeouts tại nhiều API, socket pub/sub tập trung, global error logger giới hạn250 entries.
- CDR hiện RAM-only; ghi âm điều khiển máy chủ; không có binary recording trong IndexedDB.
- Presence ưu tiên talking/holding, ringing/progressing và DND; các điểm dial có guard busy/offline/self.

Các guard này giảm rủi ro nhưng không chứng minh mọi race đã bị loại.

## Ranh giới trách nhiệm — ARCH-001

WazoService3093 dòng quản lý auth, identity, heartbeat, REST, WS, SIP, media, group conference, presence và CDR triggers. CallsView4304 dòng, Messages2753 dòng gồm cả CSS/template; không dùng tổng dòng làm metric độ phức tạp thực thi. Rủi ro được chứng minh bằng những sửa đổi xuyên module: settings HTTP khác contract chat; call handlers vừa đổi state vừa ghi log/CDR vừa phát window event.

Dependency cycle: wazo → chat/contact/history/websocket → wazo. ESM cycle không mặc định crash; nhiều truy cập ở runtime. Lợi ích tách là ownership/testability, không phải đổi style. SettingsModal trực tiếp gọi Confd, LoginView bổ sung confd trong khi services cũng map identity. Dữ liệu UUID, ext, name, status được fallback ở nhiều nơi.

Đề xuất thứ tự: regression tests → state/session boundary → adapter SDK/HTTP có result contract → tách auth, telephony/group/media từng bước; giữ facade cho caller cũ. Không rewrite đồng loạt, không bắt buộc đưa Pinia chỉ để có thư mục store.

## Reactivity theo Vue3 thực tế

| Khu vực | Kết luận |
|---|---|
| ref/reactive | .value ở script và template unwrapping nhìn chung đúng; không tìm đủ bằng chứng lỗi destructuring phổ biến để tạo finding |
| callStore/recordStore | Reactive nested state có tác dụng; raw SDK session nằm trong reactive graph cần ownership rõ nhưng chưa chứng minh proxy gây crash |
| Plain singleton fields/Map | BUG-010: computed _isDialing/pending members không invalidation |
| ContactService arrays | Calls dùng snapshot và events để ép cập nhật; computed chỉ đọc raw service trong Messages có thể stale tới khi dependency khác đổi; mở rộng kiểm thử BUG-010 |
| Computed side effects | Không tìm đủ bằng chứng vòng lặp computed; không tạo nhận xét chung chung |
| Watch route | Calls autocall timer và Messages async direct resolution không có generation chung; BUG-013 và SEC-002 là ví dụ rõ |
| Lifecycle KeepAlive | onDeactivated khác unmount: Messages xóa activeRoomId nhưng onActivated không khôi phục nếu không có query; badge khi quay lại cần regression test |
| Media/timer | Cleanup hiện có cho tone, playback, meter; callback pending vẫn thoát cleanup: BUG-011/015 |
| Async clock | Aggregate state nhóm chưa biểu diễn trạng thái từng SIP leg, BUG-005 |

Không benchmark render, không khẳng định deep watchers là bottleneck khi source không có bằng chứng tương ứng.

## Stores/shared state

State ownership phân mảnh giữa reactive store, plain fields, Map, local refs, localStorage và CustomEvent. getRooms/getHistory single-flight không theo user/epoch; reset không vô hiệu continuation (SEC-002). forceRefresh bỏ promise reference không cancel; finally request cũ còn có thể xóa marker request mới.

Chuyển logic UI state sang reactive đúng chỗ; resource SDK dùng plain/shallow holder và state serializable riêng. Auth user/epoch phải là dependency của mọi async commit; không sửa bằng thêm delay arbitrary.

## Components và forms

- Props/emits Incoming modal tương đối đơn giản; App là owner thao tác call.
- Submit group/login có disabled/loading, nhưng service vẫn cần idempotency/cancellation; disabled UI không phải server guarantee.
- Settings một nút save ghi nhiều miền, bug thực tế BUG-001. Một form domain nên có loaded/dirty/error state riêng.
- Messages command/query/selection coupled; async completion có thể đổi selection đã được user thay (BUG-013).
- History có playback singleton local, không chặn response stale (BUG-011).
- Keys phần lớn dựa ID. Client message ID Date.now có thể trùng trong cùng millisecond khi gửi song song; chưa đo/tái hiện nên xem thêm trong edge-case test, không tăng severity.

## Logging và error contract

Global error handler hữu ích cho quan sát nhưng không phục hồi state. try/catch quanh SDK Promise không await không bắt rejection. fetch thường không throw HTTP4xx/5xx, cần kiểm tra ok. Chat đã sửa lỗi cấp sendMessage nhưng caller command không propagate. Recording/settings vẫn báo thành công quá sớm. Log ring buffer giới hạn memory nhưng thiếu session cleanup (SEC-003).

## Khả năng mở rộng

Tải rooms prefetch15 message cho mọi room bằng Promise.allSettled: cold start R phòng tạo R request tin + request danh sách, không giới hạn concurrency. Calls mount và activated đều loadContacts; sidebar click/focus có thể thêm fetch. Presence poll10s và heartbeat5s là chi phí định kỳ. Đây là hệ quả code, chưa phải độ trễ đo được.

Danh bạ limit1000, history UI limit100, chat load50 mà chưa có UI phân trang đầy đủ. Cần biểu thị phạm vi/total và pagination để tránh hiểu “không có dữ liệu cũ”. Mở rộng theo đo đạc: request dedup, bounded concurrency, lazy messages; virtualization chỉ khi profiling chứng minh cần.

## Hướng backend mới

User xác nhận Python+SQLite/SingleIdAuth planned. Ưu tiên contract danh tính/membership/message/events và migration strategy trước khi tách frontend. Đợi mẫu IdP, không tự suy luận email→Wazo token. SQLite phải được đo tải/backup; không coi frontend audit đủ chứng minh backend tương lai production-ready.
