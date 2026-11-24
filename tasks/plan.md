# Kế hoạch danh bạ SmartCall cho 3.000 người dùng đồng thời

Mốc đối chiếu: nhánh `codex/refactor-architecture`, commit `62faa28`. Kế hoạch này áp dụng cho Web. Android tiếp tục dùng các API và tín hiệu nhóm hiện hành. Các giá trị 30 mục, 10 mục gần đây và 300 ms là thông số khởi điểm để kiểm thử. Chúng chưa phải số đo trên tổng đài công ty.

## 1. Quyết định sản phẩm

Màn hình gọi mặc định hiện tối đa 10 **Người gần đây**. Lưu người đã chọn để gọi, mở chat hoặc mở liên hệ. Dữ liệu giới hạn ở định danh và thông tin hiển thị tối thiểu, tách theo Wazo host, tenant và UUID tài khoản. Cho phép xóa. Người dùng lần đầu thấy ô tìm kiếm, bàn phím số và lối vào **Duyệt danh bạ**. Khi chưa nhập, màn hình chỉ yêu cầu presence của người gần đây nếu cần hiển thị trạng thái.

Tìm từ hai ký tự tên sau khoảng 300 ms kể từ lần nhập cuối. Đợi người dùng kết thúc bộ gõ tiếng Việt. Kết quả theo từ khóa có 30 mục mỗi lượt và nút **Xem thêm**. Bàn phím số hỗ trợ tra đúng máy lẻ khi người dùng bấm gọi, kể cả số ngắn hợp lệ theo dialplan. Có thể hiện gợi ý tên cho số đủ dài, nhưng thao tác tra cứu này không tự phát cuộc gọi.

**Duyệt danh bạ**, **Phòng ban**, **Online** và **Offline** áp dụng bộ lọc trên tập liên hệ người dùng có quyền thấy rồi mới chia trang. **Yêu thích** dùng nguồn yêu thích của Wazo khi mở tab, nhận danh sách riêng. Nếu API yêu thích trả cả tập, chia phần hiển thị tại Web cho tập nhỏ và đo payload thật trước khi mở rộng. **Gọi nhóm** và **Thêm người** dùng cùng tìm kiếm, giữ các mục đã chọn qua mọi trang và từ khóa.

Chọn cách triển khai trực tiếp qua Dird cho duyệt, tìm kiếm và tra chính xác. Làm một bộ chỉ mục danh bạ dùng chung ở backend nếu đo thấy API trực tiếp không đáp ứng tiếng Việt, lọc phòng ban hoặc Online/Offline toàn cục. Khi cần giao đủ các tab toàn cục ngay đợt đầu và API trực tiếp thiếu khả năng lọc, phần chỉ mục là bước bắt buộc trước khi bật các tab đó. Đo tải rồi mới quyết định lưu ở đâu. Có thể tận dụng Redis hiện có nếu mô hình phân quyền và tải phù hợp.

## 2. Hợp đồng Wazo cần xác minh

| API | Vai trò | Điều kiện phải thử trên Wazo công ty bằng token người dùng |
| --- | --- | --- |
| `GET /api/dird/0.1/directories/{profile}/sources` | Lấy các nguồn thuộc profile, xác định nguồn nhân viên nội bộ | Profile thực tế, quyền của tài khoản thường, tenant con, một hoặc nhiều nguồn, nguồn bị đổi hoặc bị xóa |
| `GET /api/dird/0.1/backends/wazo/sources/{source_uuid}/contacts` | Duyệt, tìm với `search`, phân trang với `limit/offset`, tra lô `uuid` | Hai trang khác nhau, thứ tự ổn định, tìm người ngoài 1.000 mục đầu, so khớp tiếng Việt, máy lẻ chính xác, UUID Dird có cùng định danh với Chatd hay cần ánh xạ, `description` có trong response và cách tính tổng kết quả |
| `GET /api/dird/0.1/directories/lookup/{profile}?term=...` | Dự phòng cho tra máy lẻ cụ thể nếu xác minh được kết quả và quyền | Tìm theo số, đối chiếu chính xác máy lẻ, trùng số, giới hạn response. SDK hiện gửi `term` rồi cắt kết quả tại trình duyệt, nên đường này không phải API phân trang chính |
| `GET /api/dird/0.1/directories/favorites/{profile}` | Đọc yêu thích theo tài khoản và nguồn | Kích thước response, ID của favorite là ID liên hệ hay UUID user, người đã bị xóa hoặc mất quyền xem |
| `GET /api/chatd/1.0/users/presences?user_uuid=...` và `chatd_presence_updated` | Lấy trạng thái theo lô nhỏ, nhận cập nhật qua WebSocket | Cách truyền nhiều UUID, số UUID mỗi lô, thiếu bản ghi, quyền event giữa Web và Android, reconnect và tải đồng thời |
| Confd `GET /api/confd/1.1/users` | Nguồn `description` nếu Dird thiếu dữ liệu cần thiết | Tương thích máy chủ, quyền `confd.users.read`, tenant và điều kiện đồng bộ có kiểm soát ở backend. Giữ cơ chế ghi bộ phận hiện tại |

Tài liệu công khai xác nhận tham số tìm/phân trang của API nguồn Wazo và ACL của từng API. Hành vi ghép họ tên tiếng Việt, bỏ dấu, tìm số, tính duy nhất của máy lẻ và trường bộ phận vẫn cần kiểm chứng thực tế. Cài đặt `searched_columns` của nguồn Dird cần được đối chiếu riêng cho đường `lookup`; kết quả của đường đó chưa chứng minh đường `/contacts?search=...` cũng tìm theo cùng cột.

[Wazo Dird](https://wazo-platform.org/documentation/api/contact.html) · [Cấu hình nguồn và trường tìm kiếm](https://beta.wazo-platform.org/uc-doc/administration/contact_directories) · [Wazo Chatd Presence](https://raw.githubusercontent.com/wazo-platform/wazo-chatd/master/wazo_chatd/plugins/presences/api.yml) · [Sự kiện Chatd](https://wazo-platform.org/documentation/events/chat/) · [Wazo Confd Users](https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/plugins/user/api.yml)

### Quyết định sau khi thử API

1. Nếu một nguồn nội bộ bao phủ đúng đối tượng và API phân trang/tìm chính xác hoạt động, dùng trực tiếp nguồn đó với token user. Chốt cấu hình nguồn theo profile và tenant; refetch một lần khi nguồn cũ mất hiệu lực.
2. Nếu nhiều nguồn có kết quả chồng nhau, chốt nguồn nhân viên chính hoặc cung cấp lọc nguồn ở bản trực tiếp. Khi cần gộp nhiều nguồn như một danh bạ, backend phải có quy tắc phạm vi, thứ tự, khóa định danh và loại trùng trước khi chia trang. Phân biệt người Wazo và liên hệ ngoài Wazo.
3. Nếu tìm tiếng Việt hoặc máy lẻ chưa đạt, thử chỉnh nguồn Dird và kiểm tra lại bằng token user. Với tra số, có thể dùng `lookup` cho số đầy đủ đã chuẩn hóa, rồi đối chiếu chính xác trong phạm vi đã xác nhận. Nếu API chỉ trả một tập con và không thể chứng minh số không tồn tại hoặc thuộc duy nhất một người, trả kết quả **chưa xác minh được** và chuyển sang đường tra đáng tin cậy. Nếu các hạn chế vẫn còn, dùng chỉ mục backend cho các khả năng bị thiếu.
4. Nếu cần bộ lọc phòng ban chính xác, dùng mã phòng ban đã xác nhận nếu nguồn có. Khi chỉ có `description`, chuẩn hóa cách viết và khoảng trắng, giữ tên hiển thị, so khớp bộ phận theo giá trị đầy đủ và có nhóm **Chưa có phòng ban**. Chuỗi tìm gần đúng trên nhiều trường chưa đủ để lọc phòng ban.
5. Nếu giữ Online/Offline toàn cục, cần truy vấn có thể kết hợp phạm vi danh bạ với presence ở máy chủ trước khi phân trang. Bộ chỉ mục dùng chung giữ presence tách khỏi thông tin liên hệ, nhận event và đối soát sau reconnect. Dữ liệu không rõ hoặc quá hạn hiển thị **Chưa rõ**, không tự xếp vào Offline. Chốt rõ ý nghĩa Online so với **Có thể mời gọi**, vì người bận hoặc DND có thể vẫn đang kết nối.

## 3. Kiến trúc và các quy tắc giữ xuyên suốt

| Dữ liệu | Nơi giữ và cách dùng |
| --- | --- |
| Kết quả trang | Mỗi màn hình/modal giữ truy vấn hiện tại, thứ tự, trang hoặc con trỏ tiếp theo và lỗi tải. Thay từ khóa, phòng ban hoặc tab tạo truy vấn mới. Bộ lọc và thứ tự thuộc phạm vi đã cấp quyền |
| Định danh liên hệ | `ContactService` giữ cache giới hạn trong phiên, tra theo UUID người dùng và máy lẻ chuẩn hóa. Liên hệ ngoài Wazo có ID riêng theo nguồn. Chủ sở hữu máy lẻ phải được xác nhận trong phạm vi dialplan cần dùng, kể cả khi cache chỉ có một kết quả |
| Presence | Cache theo UUID riêng, có độ mới và nguồn xác nhận. Khi hiện trang, lấy theo lô khoảng 30 UUID. Gộp yêu cầu trùng. Cập nhật đúng mục từ WebSocket. Đồng bộ lại khi reconnect, trở lại tab hoặc thực hiện lệnh cần trạng thái mới. REST đến muộn không ghi đè event mới hơn. State thiếu, lỗi hoặc hết hạn là **Chưa rõ** |
| Lựa chọn nhóm | Giữ độc lập với trang theo UUID và máy lẻ tại lúc chọn. Hiện danh sách **Đã chọn** và cho bỏ từng người. Giữ qua đổi trang và từ khóa. Dọn khi hủy, hoàn tất, kết thúc cuộc gọi đang mời hoặc đổi phiên |

Tái sử dụng `ContactService`, `createSessionFetch` và luồng session hiện tại. Các hàm tra cứu trả kết quả phân biệt **tìm thấy**, **đã xác nhận không có**, **trùng/không xác định duy nhất**, **không có quyền**, **lỗi tạm thời** và **đã hủy**. Đặt timeout, giới hạn số request đồng thời, gộp request trùng theo phạm vi. Response chỉ được cập nhật state nếu host, tenant, tài khoản và phiên còn khớp. Với phần hiển thị, truy vấn và trang cũng phải còn khớp.

Tải lần đầu hoặc từ khóa mới dùng trang 1. Lỗi khi **Xem thêm** giữ các trang đã có và cho thử lại đúng trang. Dùng thứ tự được API hỗ trợ và loại trùng theo định danh. Nếu tập dữ liệu đổi khi dùng offset, cập nhật khi người dùng làm mới hoặc tìm lại. Nếu API trả trang trùng/lặp, dừng tải thêm và báo lỗi phù hợp. Khi cần thứ tự ổn định qua nhiều nguồn hoặc lọc Online liên tục, backend giữ thứ tự nhất quán cho lượt duyệt và cập nhật badge tại chỗ.

Khi cần chỉ mục backend, chỉ đồng bộ trường được phép hiển thị như UUID, tên, máy lẻ, bộ phận và nguồn. Giới hạn cache theo host/profile/tenant và phạm vi quyền của người dùng; chỉ dùng cache chung giữa người có cùng phạm vi đã được xác nhận. Không trả dữ liệu riêng tư từ nguồn cá nhân cho người khác và không cấp token quản trị cho client. Backend cần xác thực người dùng theo phương thức được hỗ trợ cho cả đăng nhập Wazo trực tiếp và Single ID trước khi nhận traffic. Khi nguồn đồng bộ chậm hoặc lỗi, cho phép hiển thị bản cache còn trong thời hạn với báo trạng thái; thao tác gọi/mời vẫn kiểm tra đích thực tế. Triển khai chỉ mục ở một nơi dùng chung thay vì làm lại theo từng client. Đo độ trễ, dung lượng, ưu tiên làm mới và quyền truy cập trước khi phát hành.

## 4. Ma trận hành vi và lỗi

| Tình huống | Kết quả cần đạt |
| --- | --- |
| Mở màn hình lần đầu, mở lại bằng KeepAlive, đổi tab | Dùng đúng cache của truy vấn hoặc hiện Gần đây. Không gọi tải nền 1.000 mục. Chat cũng không kích hoạt tải toàn bộ |
| Gõ `H`, dùng bộ gõ `Hùng`, dán họ tên, nhập `Hung`, nhập khoảng trắng | Một ký tự tên chưa tìm. Đợi hoàn tất bộ gõ, bỏ khoảng trắng thừa, kiểm thử tương đương có dấu/không dấu và thứ tự họ tên. Kết quả đến muộn của truy vấn cũ bị bỏ |
| Từ khóa phổ biến, danh bạ 3.000, mục ở trang 80 | Nhận tới 30 kết quả hợp lệ mỗi lượt, tìm kiếm trong toàn bộ phạm vi được cấp, hỗ trợ trang cuối rỗng hoặc ngắn. Không quét mọi trang chỉ để tìm một người có máy lẻ/UUID cụ thể |
| Hai người trùng tên, một người có nhiều máy lẻ, hai nguồn trùng số | Hiện thêm bộ phận/máy lẻ để phân biệt. Trùng nguồn nhưng cùng UUID được gộp phù hợp. Hai UUID cùng máy lẻ không tự chọn người đầu; yêu cầu làm rõ hoặc báo không xác minh được |
| Gọi từ bàn phím số, thẻ kết quả, chat hoặc gọi lại từ History | Dùng đường tra đích thống nhất. Gọi lại kiểm tra máy lẻ hiện tại, bỏ chặn sớm dựa vào presence cũ trên History. Nếu CDR có UUID và máy lẻ hiện thuộc người khác, cảnh báo hoặc yêu cầu xác nhận đích. CDR chỉ có số thì hiển thị rõ đây là gọi lại số đã lưu |
| Gọi đến từ người ngoài trang hoặc chưa có danh bạ | Hiện caller ID hoặc máy lẻ ngay, tra tên nền và chỉ cập nhật đúng SIP session. Người nhận có thể nghe hoặc từ chối trong lúc tra tên |
| Mở chat từ kết quả, từ số, từ History hoặc từ phòng cũ | Dùng UUID Wazo đã xác nhận, tra lô UUID thành viên hoặc dùng metadata Chatd đã có. Người offline vẫn nhắn được. Nếu thiếu UUID, báo chưa xác định người nhận; giữ phòng cũ và quyền hiện hành. Mục chọn người tạo nhóm chat cũng tìm ngoài trang. Không phát một request riêng cho từng tin nhắn |
| Chọn B ở trang 3, C ở trang 5 rồi đổi bộ lọc | Cả hai còn trong **Đã chọn**, mỗi người chỉ xuất hiện một lần. Modal không loại người chỉ vì họ rời trang đang xem |
| Người được chọn vừa bận, bật DND, offline, đổi máy lẻ hoặc bị xóa | Trước khi gửi lệnh, tra lại định danh khi cần và lấy presence theo lô của đích. Giữ điều kiện gọi nhóm hiện hành, báo lý do từng người, xử lý số người còn đủ điều kiện công khai. Hủy hoặc chỉnh lựa chọn không làm phát cuộc gọi ngầm |
| B mời C ngoài danh bạ đã tải của A, Android gửi tín hiệu cũ, sự kiện đến muộn | A vẫn là host. Xác nhận UUID và quyền của người gửi qua thông tin Wazo và cuộc gọi hiện tại; kiểm tra số đích ngoài trang trước khi quay. Khi phải đợi tra cứu, xác nhận lại session, cuộc gọi, vai trò, thành viên và chống xử lý lặp trước khi áp dụng. Giữ kiểm tra người thật đã nối và phân biệt chuyển vào ConfBridge |
| Presence lỗi, socket đứt, response REST đến sau event | Giữ dữ liệu liên hệ, hiện trạng thái **Chưa rõ** nếu không còn nguồn đáng tin. Khôi phục snapshot theo lô sau reconnect. Chặn mời nhóm đối với người chưa xác minh khả dụng theo quy tắc hiện hành. Gọi một-một báo rõ không kiểm tra được nếu cần chặn theo chính sách hiện tại |
| Dird hoặc nguồn quyền trả 401/403/404/429/5xx, timeout hoặc trả dữ liệu sai | Dùng luồng phiên hiện tại cho 401. Phân biệt 403 quyền đọc, 404 nguồn không còn, 429 thử lại theo giới hạn và 5xx/timeout lỗi tạm. Chỉ báo **không có kết quả** khi truy vấn hợp lệ thành công. Giữ trang đang xem khi làm mới lỗi, ghi rõ dữ liệu cũ và cho thử lại. Không tải toàn bộ làm dự phòng |
| Tab Online/Offline đổi trạng thái khi đang xem trang | Badge thay đổi theo event. Không tự kéo mục mới từ hàng loạt trang; làm mới theo nhịp có giới hạn hoặc qua nút làm mới. Tổng hay số lượng chỉ hiện khi server tính cho toàn bộ tập lọc |
| Favorite, Gần đây, logout, chuyển tenant, hai phiên khác nhau | Thay đổi favorite hiện thành công sau ACK Wazo. Liên hệ đã xóa hoặc không còn trong phạm vi được làm mới và đánh dấu hoặc loại bỏ. Cache và lựa chọn của phiên cũ không xuất hiện ở phiên mới. Gần đây có nút xóa riêng |

Riêng luồng thoại, trạng thái trực tuyến là ảnh chụp tại thời điểm kiểm tra. Wazo/SIP vẫn trả kết quả cuộc gọi cuối cùng. UI xử lý được trường hợp trạng thái đổi sau khi kiểm tra, trước lúc Wazo nhận lệnh. Cuộc gọi đang chạy tiếp tục quản lý bằng SIP/Calld và định danh của cuộc gọi, kể cả khi danh bạ đang tải lại.

## 5. Thứ tự triển khai và cổng nghiệm thu

**A. Đo và xác minh API → B. Sửa tra đích gọi/chat và xác minh tín hiệu nhóm → C. Đổi UI sang Gần đây, tìm và chọn qua trang → D. Thu hẹp presence → E. Bật các bộ lọc toàn cục đã đạt điều kiện → F. Đo tải, pilot và phát hành.**

Giai đoạn B chạy được cùng giao diện cũ. Chỉ bật C khi gọi theo số, History, chat, gọi đến và ADD_REQ hoạt động với cache rỗng. Chỉ bỏ timer presence cũ khi D đã kiểm tra socket, kết nối lại và chuyển trạng thái trước khi bấm gọi. Công việc cụ thể và quan hệ phụ thuộc nằm trong [danh sách triển khai](todo.md).

### Kiểm thử và đo tải

- Kiểm thử fixture 3.000 mục, cố định tài khoản mục tiêu sau mục 1.000, có UUID thiếu/trùng, nhiều nguồn, kết quả tiếng Việt và dữ liệu đổi giữa hai trang. Dùng response thực tế đã làm sạch dữ liệu để xác nhận mapper.
- Kiểm thử hồi quy với socket và SDK mô phỏng cho gọi 1-1, chat, gọi lại, gọi đến, tạo nhóm, mời người ở hai trang, nhóm Web–Android và hai ca từ chối cuộc gọi đã sửa. Kiểm tra yêu cầu đến muộn sau logout, back/forward, reconnect và cập nhật REST đến sau event.
- Trên môi trường test, đo riêng lượt mở màn hình gọi, gõ tìm, bấm **Xem thêm**, gọi lại, xác minh nhóm và reconnect đồng loạt. Tách số Web và Android. Chạy nhiều mức tải đến 3.000 phiên theo tỷ lệ hoạt động dự kiến, gồm giờ đăng nhập đông, chat, gọi và chuyển trang. Dùng dữ liệu test và tránh chạy stress test tổng đài production.
- So sánh số request Dird/Confd/Chatd, payload, p50/p95, tỷ lệ lỗi, CPU upstream và số event WebSocket với baseline. Mốc khởi điểm để chốt sau khi đo baseline là p95 từ lúc hết debounce tới khi hiện tên dưới 1 giây trong kịch bản tải đã thống nhất. Đo thời gian presence riêng.
- Điều kiện tối thiểu là mở Gần đây không có request list danh bạ lớn, mỗi trang search tối đa 30 mục, presence theo lô giới hạn và không có browser định kỳ hỏi toàn bộ danh bạ. Không làm tăng lỗi đăng ký SIP, gọi lại hoặc xác minh thành viên nhóm. Kiểm tra hiệu quả Wazo phía server vì response nhỏ chưa chứng minh truy vấn backend nhẹ.
- Đo cả luồng vi phạm dễ bị bỏ sót khi lượng kết quả ít: gõ nhanh nhiều chữ, gõ trong hai modal, 429 khi reconnect, nhiều người dùng mở tab cùng lúc, cache hết hạn đồng thời và người dùng rời trang ngay khi đang tải.
- Bật thử có giới hạn cho tài khoản Web nội bộ. Nếu tỷ lệ lỗi tra đích hoặc gọi lại tăng, tắt giao diện mới về cấu hình cũ đã kiểm chứng, giữ thay đổi tra chính xác tương thích. Giữ khả năng tắt riêng các tab toàn cục nếu nguồn presence chưa ổn định. Cập nhật hướng dẫn frontend, PROGRESS và kết quả kiểm chứng khi triển khai, theo quy tắc dự án.

## 6. Điểm code cần chú ý

- [ContactService](../frontend/src/services/data/contactService.js): `fetchDirectory` chọn nguồn đầu, tải 1.000 mục, bổ sung description bằng Confd và bật timer presence. `getOrLookupContact` hiện tải lại danh bạ khi không thấy máy lẻ. `statusOf` đang mặc định offline khi thiếu presence.
- [CallsView](../frontend/src/views/CallsView.vue), [ContactsPanel](../frontend/src/components/contacts/ContactsPanel.vue), [bộ lọc](../frontend/src/composables/useContactFilters.js), [modal thêm người](../frontend/src/components/call/AddParticipantModal.vue): các lối vào hiển thị. Modal đang kiểm tra lựa chọn bằng danh sách có thể mời đã lọc theo từ khóa, nên phải tách trước khi bật phân trang.
- [CallService](../frontend/src/services/calls/callService.js), [HistoryView](../frontend/src/views/HistoryView.vue), [phoneEvents](../frontend/src/services/calls/phoneEvents.js): tra đích gọi, gọi lại, gắn tên người gọi đến và đối chiếu peer Calld.
- [ChatService](../frontend/src/services/data/chatService.js), [MessagesView](../frontend/src/views/MessagesView.vue): tải phòng, lookup người khi mở chat và khi chọn thành viên. Xóa đường tải toàn danh bạ từ màn hình chat sau khi thay bằng tra UUID theo lô.
- [GroupCallService](../frontend/src/services/calls/groupCallService.js), [Wazo event handler](../frontend/src/services/realtime/wazoEventHandler.js), [điểm lắp ghép](../frontend/src/services/createServices.js): xác minh vai trò, đường ADD_REQ, đồng bộ nhóm và presence. Không suy rằng máy lẻ có chủ duy nhất chỉ vì cache trang có một UUID.

Trong lượt lập kế hoạch, đã kiểm tra code và hợp đồng công khai. Chưa xác nhận API, quyền user, chất lượng tìm không dấu, tải WebSocket hoặc khả năng lọc toàn cục trên Wazo công ty.
