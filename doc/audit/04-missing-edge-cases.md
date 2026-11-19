# Edge cases và ma trận kiểm thử đề xuất

[Findings chi tiết](03-bugs-and-logic-findings.md) · [Verification thực tế](09-audit-coverage.md).
Các test dưới là đề xuất regression; chỉ những case có ghi VM ở báo cáo03/09 mới đã được chạy cô lập.

## Mức cao: phải có regression trước release

| Case | Input/thứ tự | Invariant cần giữ | Findings |
|---|---|---|---|
| Đổi tài khoản khi rooms/CDR/contacts pending | A request → logout → B login → resolve A | Mọi state, callback, badge và cache thuộc B không nhận A | SEC-002 |
| Lưu mic không đổi dịch vụ | Server DND=true, forward có số; mở audio lần đầu → Lưu | Không Confd write cho trường chưa load/dirty | BUG-001 |
| User thường gửi tag | Content trích dẫn ROOM_CLOSED, MSG_DELETED, ROOM_RENAME | Text không có quyền điều khiển phòng/tin | SEC-001 |

## Call/media

| Case | Expected/điểm cần kiểm tra | Findings |
|---|---|---|
| Answer lỗi mic hoặc SDK reject | Không connected trước accepted; promise error có xử lý | BUG-002 |
| Hangup khi create conference pending | Response muộn không set activeId; cleanup server đúng context gốc | BUG-003 |
| Merge HTTP503, retry thành công | Không đánh dấu merged trước success; retry không duplicate | BUG-004 |
| Primary chưa nghe, secondary nghe trước | Duration tăng từ thời điểm người đầu nghe; aggregate connected | BUG-005 |
| Mời leg mới lúc đang đàm thoại | Progress leg mới không đặt toàn nhóm ringing | BUG-005 |
| Mời lại người vừa rời | Danh sách invite theo thành viên thật; không theo active number cũ | Guard bước76 đã có, cần regression |
| SIP call resolve sau user cancel | Session muộn bị hangup, không gắn vào call khác | Cần test bổ sung; chưa tuyên bố lỗi production |
| API recording start chậm, cuộc gọi đã kết thúc | Không tạo recording state mới cho call đã kết thúc | Cần kiểm chứng start/auto-record continuation |
| Stop recording 403/500/network | Không báo stopped giả; giữ ID và recovery | BUG-006 |
| Playback A/B out-of-order | Chỉ selection mới nhất được play | BUG-011 |
| Rời History khi audio fetch pending | Không audio mới sau deactivation; không phát chen call mới | BUG-011 |
| Đóng Settings lúc user đang cấp quyền mic | Stream resolve muộn được stop; không RAF/context mới | BUG-015 |
| Đổi mic liên tục | Chỉ stream mới nhất sống; stream cũ stop | BUG-015 |
| Máy không mic, permission denied, insecure context | Thông báo đúng, không stuck ringing; enumerate rỗng không được coi là chứng minh có mic | Verification media/browser còn thiếu |
| Call thứ hai trong lúc call đầu session=null | Không xóa call mới bởi ended cũ; guard hiện có cần test early phase | Guard activeID chỉ áp khi đủ session/ID |

## Chat, permission và migration

| Case | Expected/điểm cần kiểm tra | Findings |
|---|---|---|
| Send HTTP500 | Tin hiển thị Lỗi gửi (control đã đúng), command caller không success | BUG-007 |
| Gửi tại A rồi chọn B | Không chọn lại A khi response về | BUG-013 |
| Cold load nhóm đóng | Đóng giữ nguyên sau reload; metadata không mất khi lọc tombstone | BUG-014 |
| Nhóm tái tạo cùng users | Ranh giới lịch sử rõ, room state được server xác nhận | BUG-014, LOGIC-002 |
| Thay thành viên nhóm100tin | Không tuyên bố copy toàn bộ khi chỉ25; partial copy không đóng source | LOGIC-002 |
| Nhóm3 xóa1 | Chốt rule tối thiểu2 hay3; validation trước side effect | LOGIC-002 |
| Online nhưng chưa đọc | Không suy diễn Đã nhận/Đã xem hoặc liệt kê mọi member | LOGIC-001 |
| Nhiều user trùng tên | Ownership dựa UUID, không dựa alias/name fallback | Cần test sender inference |
| Hai send cùng millisecond, POST ack và WS echo đảo thứ tự | ID duy nhất, dedup đúng nội dung và request; không mất/nhân tin | Cần test idempotency/echo |
| GET messages pending trong lúc WS nhận tin mới | Merge không replace mất tin mới chưa nằm snapshot GET | Cần test reconciliation |
| Direct A→B nhanh qua query | Resolution A muộn không đổi currentRoom của B; không tạo thừa phòng | Cần test async watcher generation |
| Deactivate rồi activate Messages | activeRoomId khôi phục; không tăng unread cho phòng đang nhìn | Lifecycle gap cần kiểm thử |
| Một user bị remove trong lúc đang tải lịch sử | Backend quyền hiện tại và UI stale response không làm lộ tin | SEC-002 / backend integration cần xác minh |
| Client Android cũ nhận SYSTEM/FWD | Không hiển thị raw metadata; hợp đồng version rõ | Đã xác minh khác biệt mã tham chiếu, chưa test APK |

## Identity, CDR và settings

| Case | Expected/điểm cần kiểm tra | Findings |
|---|---|---|
| SDK không primaryNumber, confd có số thật | Không fake1001; số đúng được đồng bộ store | BUG-008 |
| Chọn thiết bị B thay defaultA | Call sử dụng B, unsupported báo rõ | BUG-009 |
| Outbound declined | Không nằm missed; rows=badge theo cùng predicate | BUG-012 |
| Hai call cùng ext gần nhau | Dedupe theo ID/conversation, không chỉ time proximity | History heuristic cần test |
| Force refresh A/B đảo thứ tự | Kết quả mới thắng; marker in-flight không bị finally cũ xóa | Async request test cần bổ sung |
| Login timeout rồi retry | Login cũ không commit auth/mở phone muộn dưới context mới | Auth SDK continuation cần kiểm chứng |
| Cả feature calls/messages/history false | Không redirect login→login vòng lặp cho user đã login | Router case cần test |
| Logout rồi B mở Logs | Không nội dung A; objectURL cũ revoked | SEC-003 |
| DND/forwards chỉ1 request fail | Báo partial failure, không success toàn bộ | BUG-001 |
| Múi giờ server/browser khác nhau | Chuẩn hóa ISO/timezone một nơi; filter ngày đúng nghĩa nghiệp vụ | Chưa test timezone live |

## Giới hạn

Danh sách chưa xác nhận không phải danh sách bug đã chốt và không cộng vào21 findings. Không test API thật, không tự đổi trạng thái backend. Case logout thiết bị từng nêu được tạm gác theo người dùng; các test đổi user/reset ở đây phục vụ an toàn dữ liệu của audit mới.
