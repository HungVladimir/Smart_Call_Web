# Kết quả sửa lỗi sau audit — 19/11/2026

**Cập nhật yêu cầu sản phẩm:** người dùng đã yêu cầu bỏ hoàn toàn ghim và trạng thái gửi/đọc tin nhắn. Xem [thay đổi mới nhất](11-remove-message-pin-and-read-status.md). Các ghi nhận về hướng phát triển receipt/read cursor bên dưới là lịch sử trước yêu cầu này.

Tài liệu này ghi nhận thay đổi sau khi người dùng cho phép sửa mã nguồn. Các báo cáo `00`–`09` giữ nguyên như bằng chứng tại thời điểm audit. Đây là kết quả kiểm tra mã và kiểm thử hồi quy cô lập; chưa phải chứng nhận hoạt động trên tổng đài thật.

## Kết quả chính

Đã sửa các đường xử lý phía Web gây ghi đè cấu hình thoại, cập nhật dữ liệu sai phiên, sai trạng thái cuộc gọi/ghi âm, phát nhầm bản ghi, chọn nhầm hội thoại và rò tài nguyên microphone. Đã bổ sung bộ kiểm thử chạy bằng Node, sử dụng Vue reactivity thực và thay thế các ranh giới mạng/SDK trong môi trường kiểm thử; không thêm dữ liệu thử vào ứng dụng chạy thực tế.

Một số phát hiện cần hỗ trợ phía server. Bản sửa chặn hành vi nguy hiểm và hiển thị giới hạn rõ ràng, không coi việc chặn đó là đã triển khai đầy đủ chức năng thay thế.

## Đối chiếu 21 phát hiện

“Đã sửa Web” nghĩa là đã thay đổi cơ chế gây lỗi và kiểm tra hồi quy tương ứng. Những chức năng SIP, thiết bị và API thực tế vẫn cần kiểm tra tích hợp theo bảng ở cuối tài liệu.

| ID | Trạng thái sau sửa | Cơ chế và giới hạn |
|---|---|---|
| SEC-001 | Giảm thiểu phía Web; cần server | Chỉ diễn giải tag quản trị khi UUID người gửi trùng `admin_uuid`/`creator_uuid` do API phòng trả về. Không suy quyền từ thành viên đầu tiên, alias hoặc localStorage. Thiếu metadata thì chặn quản trị. Quyền API phải được server thực thi; client Android cũ không tự được bảo vệ bởi bản sửa Web. |
| SEC-002 | Đã sửa các đường bất đồng bộ đã xác định | `sessionScope.js` quản lý thế hệ phiên và owner; fetch và đọc body kiểm tra phiên, hủy request khi đổi phiên. Chặn kết quả muộn ở chat, danh bạ/presence, lịch sử, cấu hình, hồ sơ và luồng gọi. Bổ sung guard cho fallback tạo phòng, refresh token và callback nhóm. |
| BUG-001 | Đã sửa Web | Theo dõi dữ liệu dịch vụ đã tải và giá trị gốc. Chỉ PUT nhóm trường đã tải thành công và có thay đổi; kiểm tra HTTP từng lệnh. Lưu âm thanh không tự tắt DND/chuyển tiếp chưa tải. Lỗi từng phần được báo và giữ modal để thử lại. |
| BUG-002 | Đã sửa Web | Nghe máy có trạng thái `answering`; chờ SDK, không khởi động đồng hồ hoặc đặt `connected` trước sự kiện chấp nhận. SDK từ chối/null thì dọn trạng thái và báo lỗi. |
| BUG-003 | Đã sửa Web | Thế hệ cuộc gọi ngăn conference trả muộn khôi phục state sau cúp máy. Nếu vẫn cùng phiên xác thực, yêu cầu xóa conference trả muộn. Sau đổi phiên/mất mạng, việc dọn tài nguyên đã tạo trên server cần server hỗ trợ hoặc kiểm tra lại. |
| BUG-004 | Đã sửa Web | Nhánh chỉ được đánh dấu đã merge sau API trả thành công. Thất bại giữ khả năng thử lại, tối đa ba lịch retry tự động có kiểm tra thế hệ cuộc gọi. |
| BUG-005 | Đã sửa Web | Nhánh phụ nghe trước vẫn bắt đầu đồng hồ; progress nhánh khác không hạ trạng thái `connected`. Giữ con trỏ nhánh chính và thời điểm bắt đầu nhóm. Media nhiều nhánh cần thử với tổng đài thật. |
| BUG-006 | Đã sửa Web | Dừng ghi âm phải có HTTP thành công; lỗi giữ thông tin ghi âm để thử lại và được báo trên giao diện. Gộp thao tác dừng trùng; khóa khởi tạo/dừng đồng thời. Hủy khi đang start không được bật lại trạng thái ghi âm. |
| BUG-007 | Đã sửa Web trong phạm vi command hiện có | Đổi tên/xóa kiểm tra `sendFailed`, truyền lỗi tới caller và chỉ cập nhật sau xác nhận gửi. Không báo thành công khi POST thất bại. Đây vẫn là cơ chế message tương thích, không phải API mutation nhóm bền vững. |
| BUG-008 | Đã sửa Web | Bỏ máy lẻ giả mặc định; SDK thiếu số thì nhận số thật từ Confd. Đồng bộ hồ sơ vào callStore và bỏ fallback `1001` ở các nơi hiển thị/so sánh định danh. |
| BUG-009 | Đã sửa Web | Thiết bị đã chọn đi vào media constraints, SDK đổi đầu vào/đầu ra và `setSinkId` khi trình duyệt hỗ trợ. Lỗi áp dụng được trả về khi lưu. Cần thử trình duyệt, quyền mic và thiết bị vật lý. |
| BUG-010 | Đã sửa các state được chỉ ra | Dialing đi qua reactive callStore; danh bạ/presence/favorites là reactive; Map phiên nhánh phụ dùng shallowReactive để không bọc sâu đối tượng SDK. Chưa tái cấu trúc toàn bộ singleton. |
| BUG-011 | Đã sửa Web | Mỗi lần phát có thế hệ riêng và owner phiên; chỉ yêu cầu mới nhất còn hoạt động được phát. Đổi route/KeepAlive hoặc dừng sẽ vô hiệu hóa kết quả muộn và pause audio. |
| BUG-012 | Đã sửa Web | Bộ lọc cuộc gọi nhỡ dùng cùng điều kiện inbound chưa trả lời như bộ đếm. Cuộc gọi outbound bị từ chối không được đưa vào missed. |
| BUG-013 | Đã sửa Web | Hoàn tất gửi chỉ gắn lại phòng khi lựa chọn hiện tại, thế hệ lựa chọn, phiên và màn hình vẫn khớp. Gửi ở A rồi chọn B không kéo về A. |
| BUG-014 | Giảm thiểu; cần trạng thái phòng bền vững | Truyền metadata phòng vào nạp tin khi cold load, giữ kết quả đóng phòng từ command đáng tin. Không diễn giải text thường là tombstone. Chỉ có thể phát hiện command trong cửa sổ tin được tải; server cần cung cấp trạng thái closed/membership để bảo đảm sau mọi lịch sử dài. |
| BUG-015 | Đã sửa Web | Thế hệ kiểm tra mic vô hiệu hóa getUserMedia đến muộn; đóng modal/đổi tab/unmount dừng track, RAF và AudioContext. Stream đến sau đóng được stop ngay. |
| SEC-003 | Đã sửa boundary cache/log đã xác định | Logout xóa log trong ứng dụng, revoke ObjectURL, reset ghi âm; cache URL phân biệt user và host. Chat không ghi toàn bộ nội dung vào log mới. Không thể thu hồi log đã xuất, ảnh chụp hoặc console đã được lưu ngoài ứng dụng. |
| LOGIC-001 | Đã bỏ suy đoán; receipt thực còn thiếu | Không tự nâng trạng thái đã nhận bằng timer, không coi trả lời là đã xem, không suy danh sách người đọc từ thành viên nhóm. Chỉ hiển thị readers có dữ liệu thực; thiếu xác nhận thì thể hiện chưa có xác nhận. Cần read cursor/ack chính thức để hoàn thiện. |
| LOGIC-002 | Đã chặn luồng mất dữ liệu; chức năng cần API | Thêm/xóa thành viên hiện trả lỗi rõ ràng trước khi tạo/xóa phòng hoặc chuyển tin. Chặn tái tạo nhóm kèm lịch sử và bỏ đoạn sao chép 25 tin. Nhóm và lịch sử gốc được giữ nguyên. Chưa triển khai API membership phía server. |
| ARCH-001 | Cải thiện một phần; còn nợ kiến trúc | Tách ownership phiên khỏi SDK, bổ sung kiểm thử các ranh giới và reactive state. Các service lớn và phụ thuộc vòng còn tồn tại; cần refactor theo từng bước với contract API/media được xác nhận. |

## Thay đổi kỹ thuật đáng chú ý

### Phiên và thao tác đến muộn

`captureSessionContext()` chụp thế hệ phiên cùng UUID. `createSessionFetch()` bảo vệ cả lúc nhận response và đọc body; `invalidateSession()` hủy request đang theo dõi. Các bước sau khi gọi service con vẫn kiểm tra owner trước khi ghi state hoặc bắt đầu tác vụ tiếp theo.

Vòng đời cuộc gọi có `_callEpoch` riêng. Kết thúc cuộc gọi làm callback conference, mời nhánh, tự ghi âm và gắn media cũ mất hiệu lực. Nhánh SDK trả muộn được yêu cầu cúp; không đưa trở lại Map của cuộc gọi mới. Việc tạm tách con trỏ SDK khi mời nhánh được khôi phục trong `finally` nếu cuộc gọi vẫn còn hợp lệ.

### Quyền và trạng thái chat

Metadata FWD trong nội dung không được thay UUID/alias/thời điểm từ envelope xác thực. Tag SYSTEM chỉ được dùng trong phòng nhóm có owner quản trị do API cung cấp và người gửi khớp owner đó. Không tự tạo metadata quản trị cho nhóm mới nếu server không trả về.

Điều này có thể làm nút quản trị trước đây dựa trên suy đoán không xuất hiện. Các nhóm/tombstone cũ thiếu metadata cần chính sách chuyển đổi phía server. Tránh bật lại fallback “thành viên đầu tiên là admin” để khôi phục nút.

### Trạng thái ghi âm

Start/stop có trạng thái đang xử lý; caller chỉ đánh dấu ghi âm khi start trả `true` và cuộc gọi vẫn khớp. Stop HTTP lỗi giữ trạng thái để người dùng thử lại. Một lệnh đã được server nhận nhưng phản hồi bị mất vẫn cần đối soát trạng thái server; client không thể bảo đảm rollback giao dịch qua mất mạng.

## Kiểm tra đã thực hiện

```powershell
node --test tests/regressions.test.cjs
npm run build
git diff --check -- src tests doc/audit/10-remediation-status.md doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md
```

- Bộ hồi quy: **27/27 đạt**, bao gồm dữ liệu trả muộn sau đổi tài khoản, đọc body muộn, presence muộn, bảo vệ command, cấu hình chưa tải/HTTP500, trả lời bị từ chối, conference trả muộn/merge lỗi, đồng hồ nhánh phụ, cache ghi âm, số máy lẻ thật, thiết bị âm thanh, đổi phòng khi gửi, cold load và cleanup microphone.
- Build production thành công. Vite còn cảnh báo bundle chính lớn hơn 500 kB; chưa thực hiện tối ưu bundle trong đợt sửa lỗi này.
- Kiểm tra khoảng trắng chỉ áp dụng các file do đợt sửa thay đổi. `FileQuest/quest.txt` có thay đổi và khoảng trắng sẵn từ người dùng, được giữ nguyên. Mã Android tham chiếu không bị sửa.
- Không gọi API tổng đài/IdP thật, không gửi tin hoặc thực hiện cuộc gọi thật trong quá trình kiểm thử. Chưa chạy kiểm thử tích hợp trình duyệt–SDK–SIP–Android.

## Kiểm tra tích hợp trước triển khai rộng

| Kịch bản | Kết quả cần xác nhận trên môi trường thử nghiệm |
|---|---|
| Đăng nhập A, tải chậm, đăng xuất rồi đăng nhập B | Không có room/contact/CDR/audio của A xuất hiện trong phiên B; thử cả refresh token và hồ sơ Confd trả muộn. |
| Mở Cài đặt, đổi mic/loa rồi lưu ngay | Không có PUT dịch vụ chưa tải; DND/chuyển tiếp giữ nguyên trên server. API 403/500 phải báo lỗi, không báo thành công toàn bộ. |
| Gọi đến, SDK chậm hoặc từ chối | Hiển thị đang kết nối, không chạy đồng hồ sớm; lỗi trả UI về trạng thái sẵn sàng. |
| Gọi nhóm: phụ nghe trước, chính còn đổ chuông | Một đồng hồ liên tục, không trở về ringing, không mất media, không tự hold nhánh sai. |
| Cúp khi tạo conference/mời nhánh | Không hồi sinh UI/cuộc gọi; kiểm tra conference/nhánh thật đã được dọn trên server. |
| Merge trả 403/500 | Nhánh không bị đánh dấu merge thành công; retry có giới hạn; không tạo vòng lặp request. |
| Ghi âm start/stop chậm hoặc lỗi | Không báo thành công giả; cúp lúc start không bật cờ trở lại; xác minh file/CDR và trạng thái server. |
| Hai bản ghi tải ngược thứ tự; chuyển route khi đang tải | Chỉ bản ghi mới nhất được phát; đóng màn hình dừng âm thanh. |
| Mic được cấp quyền sau khi đóng modal | Không còn track/audio meter hoạt động; thử đóng nhanh nhiều lần và đổi tab. |
| Chat Web–Android | Tin chứa tag từ thành viên thường không được thực thi trên Web; xác minh client Android và server cùng chính sách quyền. |
| Nhóm thiếu metadata quản trị | Tin bình thường vẫn hoạt động; thao tác quản trị bị chặn rõ ràng; không tạo lại phòng và không mất lịch sử. |
| Nhóm có lịch sử dài hơn cửa sổ tải | Cần API trạng thái phòng/read cursor/membership trước khi tuyên bố đóng phòng và receipt bền vững. |

## Phần cần bổ sung từ hệ thống tích hợp

1. Contract quyền nhóm, mutation membership, trạng thái closed và lịch sử truy cập; server phải kiểm tra quyền bằng token, không tin text/role do client gửi.
2. Ack gửi/nhận/read cursor chính thức cho chat. Chưa có thì giữ trạng thái chưa xác nhận.
3. Cơ chế đối soát tài nguyên conference/ghi âm sau mất phản hồi hoặc đổi phiên.
4. Bộ dữ liệu và môi trường thử nghiệm SIP/media có kiểm soát, gồm Web và Android.
5. Dự án mẫu SingleIdAuth khi được cung cấp để chốt giao thức, token exchange và liên kết tài khoản; đợt sửa này không tự giả định SAML/OIDC hoặc dựng backend Python/SQLite.

Các thay đổi hiện ở working tree để review. Không có commit, push hoặc triển khai production trong đợt này.
