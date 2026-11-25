# Kế hoạch xử lý tồn đọng SmartCall Web

Mốc đối chiếu là commit `81de05f` trên `codex/refactor-architecture`. Bản này đã tra máy lẻ ngoài trang, đọc presence mới khi bấm gọi 1–1, báo lý do khi chặn và hiển thị chấm xanh/xám. Những hành vi đó là điều kiện kiểm thử hồi quy. Các bước dưới đây đề xuất cho các phần còn lại.

## 1. Cô lập dữ liệu danh bạ và xử lý credential

- **Backend danh bạ.** Trong `backend/directory.py`, kiểm tra quyền nguồn cho từng phiên trước khi phục vụ cache. Áp dụng cùng ranh giới cho danh sách Dird, description từ Confd, presence từ Chatd, danh mục bộ phận, tổng số và API phân giải thành viên. Quyền đọc một mục mẫu chưa đủ chứng minh hai tài khoản cùng thấy toàn nguồn.
- **Chọn khóa cache.** Khi chưa có hợp đồng Wazo chứng minh phạm vi quyền tương đương, dùng kết quả theo phiên đã xác thực, có TTL và giới hạn bộ nhớ. Gắn bản làm giàu với phiên bản dữ liệu gốc và hạn sử dụng. Chỉ chia sẻ snapshot khi đã chứng minh được phạm vi đọc tương đương. Đo chi phí trước khi mở rộng vì tách theo phiên có thể nhân số lần quét 3.000 người. Nếu chi phí cao, đánh giá lọc phía nguồn hoặc chỉ mục backend có cơ chế áp quyền xác thực.
- **Nghiệm thu.** Hai tài khoản cùng tenant và source nhưng quyền khác nhau. Cho A rồi B đọc và thử lại theo thứ tự ngược. Kiểm tra danh sách, tổng số, bộ phận, trạng thái và lookup UUID ngoài trang. Thử sau khi thu hồi quyền, đổi tài khoản, hết cache và chạy hai worker. Kiểm tra bằng mock trước, sau đó đối chiếu phản hồi qua tài khoản thường trên Wazo công ty.
- **Vận hành credential.** Chủ hệ thống kiểm kê credential còn sử dụng và các dịch vụ phụ thuộc, chuẩn bị nguồn cấu hình riêng cho từng môi trường, thử nạp cấu hình mới và kiểm tra login/cấp tài khoản/Redis. Đổi credential từng dịch vụ, xác nhận hoạt động rồi thu hồi giá trị cũ. Thống nhất cách cấp mật khẩu tài khoản mới và phạm vi tài khoản thử nghiệm đang dùng mật khẩu mặc định. Repo hiện có ngoại lệ do người dùng đặt cho `backend/.env`. Việc thay ngoại lệ, ngừng track hoặc xử lý lịch sử Git là quyết định riêng của chủ repo. Bỏ track một mình không thu hồi credential đã xuất hiện trong lịch sử.

## 2. Xác minh đúng chủ máy lẻ trước khi quay số

- **Nơi sửa.** `ContactService.getOrLookupContact`, `CallService.startCall` và các điểm gọi từ danh bạ, lịch sử, yêu thích, bàn phím. Cho preview tiếp tục dùng cache. Khi bấm gọi, đọc lại Dird cho đúng số, bỏ qua cache máy lẻ 15 giây và request preview bắt đầu trước lần bấm.
- Nếu có UUID từ liên hệ hoặc lịch sử, so UUID mới với người đã chọn. Nếu khác, báo máy lẻ đã đổi chủ và yêu cầu chọn lại. Với số nhập tay, dùng UUID vừa phân giải. Nếu không tìm được, trùng số, thiếu quyền hoặc lỗi mạng, hiển thị đúng lý do. Sau lookup mới thực hiện bước kiểm tra Chatd đã có. Giữ guard phiên, thế hệ cuộc gọi và khóa bấm lặp ở cả hai bước.
- **Nghiệm thu.** Preview hiện Hùng, sau đó số đổi sang Lan. Gọi từ thẻ hoặc lịch sử của Hùng phải dừng trước SIP. Gọi bằng số nhập tay phải tra và kiểm tra đúng UUID hiện tại. Thử response cũ đến muộn, bấm hai lần, logout giữa Dird và Chatd, người nhận vừa offline, và người online gọi được. Nếu số đổi sau khi đã gửi SIP thì kết quả do tổng đài quyết định.

## 3. Gọi nhóm tiếp khi nhánh đầu thất bại

- **Nơi sửa.** `GroupCallService.startGroupCall`, xử lý sự kiện kết thúc nhánh SIP, timer mời nhánh phụ và hai view gọi nhanh/nhóm đã lưu. Phân biệt thất bại của một đích với lỗi chung như host đã cúp, SIP của A mất đăng ký, hết phiên hay thiếu mic.
- A luôn là host. Theo dõi từng đích bằng UUID/máy lẻ, ID nhánh SIP và thế hệ cuộc gọi. Nếu B offline ngay từ đầu, lọc B như hiện tại. Nếu B rớt sau bước lọc, thử người khả dụng tiếp theo khi đã xác nhận nhánh B thất bại. Nếu C hoặc D đã được mời thì tiếp tục quản lý nhánh đang tồn tại. Không gọi lại cùng người do cả timeout và sự kiện SIP cùng đến. Kết quả gửi lệnh chưa rõ phải được đối soát trước khi thử tiếp.
- **Xác nhận trên UI.** Hai người nhận khả dụng trở lên tiếp tục theo cách gọi nhanh/nhóm đã lưu hiện có. Nếu trước khi kết nối chỉ còn một người, đề xuất hỏi A có muốn gọi riêng. Nếu A đã đàm thoại với C mà D rớt, giữ cuộc A–C. Nếu không còn ai, báo rõ và dọn nhóm. Xử lý cả kết quả `TARGET_AVAILABILITY_CHANGED` ở view.
- **Nghiệm thu ABCD.** B offline trước khi bấm, B rớt ngay lúc tạo nhánh đầu, B lỗi sau khi đã gửi lời mời C, sự kiện kết thúc B lặp lại, C nghe và D từ chối, A cúp giữa lần thử. Kiểm tra số lần gửi lệnh cho từng người, người thực sự nghe máy, âm thanh thông báo và cleanup. Khi chuyển vào ConfBridge, sự kiện kết thúc kênh cũ không được loại người vừa vào hội nghị.

## 4. Hiển thị đúng người có thể mời trong modal

- Khi mở modal, đổi từ khóa hoặc đổi trang, tải presence cho tối đa 30 liên hệ đang hiện. Dùng cùng quy tắc khả dụng với bước xác nhận mời. Sửa điều kiện hiện đang bỏ qua `canInviteContact` khi có `loadPage`. Giữ chấm xanh/xám. Người đang kết nối nhưng bận hoặc bật DND có thể có chấm xanh và nút chọn bị khóa.
- Giữ lựa chọn xuyên trang theo UUID. Khi bấm Mời, xác minh lại chủ máy lẻ và presence của cả tập đã chọn, báo rõ người bị bỏ qua. Hủy request khi đóng modal hoặc khi cuộc gọi đổi. Thành viên mời thêm vẫn gửi yêu cầu qua host.
- **Nghiệm thu.** Mở modal lần đầu với trang chưa từng xem, chọn người ở hai trang, một người chuyển offline trước khi xác nhận. Host chỉ nhận các đích hợp lệ, mỗi người một lần. Thử mất mạng, tự mời, người đã ở trong cuộc và cúp trong lúc chờ.

## 5. Làm đúng dữ liệu bộ phận và nút Làm mới

- **Bộ phận.** Đọc `description` của Dird trước. Khi cần bổ sung từ Confd, ghép theo UUID. Phân biệt trường có giá trị, nguồn xác nhận rỗng, thiếu quyền 403 và nguồn lỗi tạm thời. Nếu một lô Confd lỗi, vẫn trả phần Dird được phép đọc cùng cảnh báo phù hợp. Chỉ xếp vào “Chưa có bộ phận” khi đủ dữ liệu. Nếu dùng nhãn dự phòng, giữ được thông tin nguồn. Khi nguồn xác nhận người dùng đã xóa bộ phận, frontend phải xóa nhãn cũ trong RAM.
- **Làm mới.** API trả thời điểm lấy dữ liệu và kết quả làm mới. Khi người dùng bấm nút, gộp các lượt đọc cùng phạm vi quyền. Đề xuất khoảng tối thiểu ban đầu 30 giây giữa hai lượt dựng lại cùng nguồn/phạm vi. Cập nhật danh mục bộ phận và trang đang xem từ cùng phiên bản. Khi còn trong khoảng giới hạn hoặc khi tải lỗi, hiển thị đúng thời điểm dữ liệu đang dùng.
- **Nghiệm thu.** Trên Wazo công ty dùng tài khoản thường tìm một đồng nghiệp khác theo description đã biết. Đối chiếu gõ tên bộ phận ở Tất cả và chọn trong dropdown. Sau đó đổi và xóa description, thử làm mới trong/ngoài giới hạn, thử 403 và lỗi lô giữa. Việc header hiện đúng bộ phận của chính mình được kiểm tra độc lập.

## 6. Đồng bộ danh sách online/offline và phân trang ở tải lớn

- Khi sự kiện WebSocket có thể đổi thành viên bộ lọc, đánh dấu cần lấy lại danh sách và tổng số. Tính cả người ngoài trang nếu phiên nhận được sự kiện đó. Kiểm chứng phạm vi phát sự kiện thật. Nếu nguồn sự kiện thiếu, đối soát có giới hạn khi tab đang hiện. Gộp sự kiện, hủy khi rời màn, phân tán thời điểm reconnect và chờ lâu hơn khi Wazo lỗi. Đề xuất bắt đầu với nhịp tối đa một lượt làm mới tự động mỗi 15 giây trên màn đang lọc, căn theo tuổi snapshot server.
- Giữ tối đa 30 người trên màn. Nếu offset hiện tại vượt tổng mới, chuyển đến trang cuối hợp lệ theo chính truy vấn đó. Tổng bằng 0 thì về trang đầu. Đổi từ khóa/bộ lọc sẽ hủy kết quả cũ. Badge xám trong lúc chờ dữ liệu không tự đưa một người vào kết quả lọc ngoại tuyến.
- Chia lô UUID theo cả số phần tử và độ dài URL sau mã hóa. Xác minh giới hạn proxy công ty trước khi chọn ngưỡng. Đối chiếu một bộ payload Web/Android cho online, offline, bận, DND, invisible và thiếu dữ liệu giữa frontend và backend.
- **Nghiệm thu.** 100 kết quả chia 30/30/30/10. Đang trang 3, tổng giảm về 25 thì tự về trang 1. Người trong/ngoài trang đổi trạng thái, tab ẩn, burst sự kiện, 414 và reconnect đồng loạt. Đo riêng lần dựng cache đầu tiên và lần cache đã có.

## 7. Dọn UI, test và cấu hình môi trường

- Bỏ số đếm danh bạ mobile lấy từ cache hoặc dùng tổng chính xác của truy vấn hiện tại. Lịch sử gọi dùng bộ phận đã xác minh nếu có, nếu thiếu thì ẩn hoặc dùng nhãn trung tính. Giữ tương thích liên kết `/calls?q=...` khi còn nhu cầu. Kiểm tra lại đường dẫn trước khi xóa watcher.
- Trong bộ test cục bộ, tách các ca chat đã ngừng hỗ trợ, chuyển những ca vẫn còn giá trị sang module mới, đặc biệt logout/thu hồi phiên, quyền nguồn và màn cuộc gọi. Cập nhật fixture router và `recordingService.js` theo Prettier. Mốc đối chiếu trước đó là frontend 13 file lỗi và backend lỗi import `chat_recovery`. Chạy lại toàn bộ và ghi kết quả thực tế. Giữ quy tắc ignore test của repo.
- Thống nhất địa chỉ bind IPv4 khi Vite proxy dùng 127.0.0.1 và dùng cùng public origin trên trình duyệt/IdP. Giữ kiểm tra Origin cho API ghi. Thử qua proxy trên Windows bằng login, lưu nhóm và logout. Xác minh CA nội bộ và tenant auth theo môi trường triển khai.

## Thứ tự triển khai và điều kiện nghiệm thu

1. Chốt phạm vi quyền và phương án credential với chủ hệ thống. Chạy bộ test hiện tại để ghi baseline. Có thể làm bước 2 trong lúc kiểm chứng ACL. Bước 3 và 4 dùng lại kết quả xác minh đích của bước 2.
2. Hoàn thiện cache theo quyền trước khi chia sẻ snapshot hoặc tối ưu theo tải. Sau đó triển khai bộ phận/làm mới và đồng bộ danh sách. Mỗi nhóm thay đổi có commit riêng trên nhánh refactor, chạy test tập trung và kiểm tra hồi quy các bước trước.
3. Trước pilot, chạy lint, architecture, build, format, toàn bộ Vitest và unittest. Ghi rõ lỗi còn lại và phạm vi ảnh hưởng. Chạy pilot trên môi trường Wazo được phép với hai tài khoản thường có quyền khác nhau và bộ thiết bị A/B/C/D. Đối chiếu cuộc gọi thực tế, log theo ID và dữ liệu trên màn hình.
4. Đo dữ liệu 3.000 liên hệ và tải đồng thời bằng hai phép thử riêng. Trên môi trường thử tải, tăng số phiên từng đợt đến mục tiêu 3.000, thử tìm kiếm, lọc online, làm mới và reconnect. Ghi p95, tỷ lệ lỗi, số request Dird/Confd/Chatd, byte phản hồi, CPU/RAM và số worker. Chốt ngưỡng chấp nhận với bên vận hành trước khi chạy. Nếu tải vượt ngưỡng, giữ ở quy mô pilot và điều chỉnh chiến lược cache theo kết quả đo.
5. Ghi kết quả vào `doc/refactor/PROGRESS.md` và `VERIFICATION.md` khi triển khai. Nếu bản thử lỗi, có thể quay lại bản ứng dụng trước theo từng commit. Việc thu hồi credential được quản lý riêng để bản quay lại vẫn dùng credential hợp lệ.
