# Kế hoạch SmartCall cho danh bạ lớn và nhóm gọi có tên

Hướng dẫn thử luồng danh bạ và nhóm gọi hiện hành trên nhánh `codex/refactor-architecture`. Kế hoạch phân trang ban đầu nằm ở phần lịch sử bên dưới.

## Bản triển khai và cách thử

Cập nhật ngày 26/11/2026. Pull nhánh refactor, khởi động lại FastAPI và build lại frontend. Proxy chuyển `/api/directory` và `/api/call-groups` về FastAPI. Token phải thuộc Wazo host và tenant của backend.

1. Mở Tất cả. Khi ô trống, Web chỉ hiện liên hệ gần đây từ phiên này. Chọn lần lượt Tên, Máy lẻ, Mã nhân viên và Email. Với Máy lẻ, nhập `10` chưa tìm. Nhập `1001` mới tra toàn bộ số. Kiểm tra tên có dấu hoặc không dấu, email rút gọn và ID có số 0 đầu. Truy vấn quá rộng hiện tối đa 50 kết quả và yêu cầu thu hẹp.
2. Mở Yêu thích. Kiểm tra máy lẻ của cùng một người như Alice giữa Tất cả và Yêu thích. Thử bộ lọc Trực tuyến/Ngoại tuyến. Presence chỉ đọc tập liên hệ đã tải, gồm danh sách yêu thích chứ không quét toàn nguồn.
3. Mở Bộ phận và chọn tên `description` đã biết. Nếu thiếu tên bộ phận, đối chiếu Wazo Dird xem nguồn có trả `description` không. Nếu nguồn thiếu trường này, kiểm tra quyền bằng chính token người dùng ở Confd. Chỉ hiện Chưa có bộ phận khi có bản ghi được xác nhận trống.
4. Mở Gọi nhóm từ danh bạ. Danh sách nhóm xuất hiện ngay. Bấm Tạo nhóm mới mở bộ chọn, thử tìm và chọn đồng nghiệp từ nhiều lượt tìm. Lưu nhóm, mở lại, gọi và kiểm tra danh sách bỏ qua khi có người ngoại tuyến. Nếu chỉ còn một người thì xác nhận trước khi gọi riêng.
5. Trong Network, kiểm tra không có nút hay lượt lật trang ở Web. Backend vẫn đọc nguồn Wazo theo lô trong phạm vi quyền token. Đo riêng thời gian dựng snapshot và các lượt dùng lại cache khi thử dữ liệu công ty.

Mã nhân viên ưu tiên trường `employee_id` hoặc `epId`. Backend có thể bổ sung ID từ lúc người đó đăng nhập Single ID hoặc từ báo cáo import CSV đã xác nhận UUID bằng `.\backend\.venv\Scripts\python.exe -X utf8 backend/seed_wazo_test_users.py --index-report <CSV_KET_QUA>`.

## Kế hoạch lịch sử dùng phân trang

Các mục dưới đây mô tả thiết kế trước ngày 26/11/2026.

## 1. Kết quả kiểm tra Bộ phận trước khi triển khai

- Backend ghi department của IdP vào description của Wazo khi tạo thuê bao và đồng bộ khi đăng nhập nếu department có giá trị. Xem backend/wazo.py.
- frontend/src/utils/contactMapper.js chuẩn hóa description rồi gán dept theo thứ tự description, department, society, title. Khi Dird thiếu description, ContactService thử đọc Confd bằng token người dùng, mỗi lượt 100 bản ghi và ghép theo UUID. Nếu Confd trả description là chuỗi rỗng, đoạn ghép hiện tại có thể ghi đè dept dự phòng thành rỗng.
- frontend/src/composables/useContactFilters.js lấy tên bộ phận từ dept của danh bạ trong RAM. Chọn một bộ phận so khớp chính xác sau trim và chuyển chữ thường. Ô tìm tự do so khớp một phần tên, số và dept, hỗ trợ tìm tiếng Việt không dấu. Chưa tìm qua email hoặc mã nhân viên.
- Đường tải chính của nhánh refactor lấy tối đa 1.000 mục Dird. Phòng ban chỉ có người nằm ngoài tập đã tải có thể vắng khỏi bộ lọc. Nhánh codex/directory-search-pagination có phần đọc từng trang và bổ sung thông tin từng liên hệ, nhưng vẫn cần kiểm chứng lọc bộ phận toàn nguồn trước khi lấy trang.

## 2. Trình tự triển khai

| Bước | Công việc | Điều kiện nghiệm thu |
| --- | --- | --- |
| 1. Xác minh nguồn | Với token người dùng trên môi trường thử, đối chiếu Dird, Confd và nguồn mã nhân viên bằng những liên hệ đã biết. Xác nhận cách tìm theo tên không dấu, extension, email đầy đủ, phần trước @samsung.com và mã nhân viên. Kiểm tra phân quyền, bộ lọc trước phân trang, thứ tự, tổng kết quả và khả năng tra theo UUID. | Tìm được người ngoài 1.000 mục đầu. Xác nhận mã nhân viên thực tế hoặc ghi rõ cần nguồn nào. epId của riêng người đăng nhập chưa đủ cho toàn công ty. |
| 2. Bỏ chat | Gỡ màn Messages, menu, nút chat ở danh bạ/lịch sử, badge, cấu hình và các lượt gọi room/message. Chuyển liên kết /messages cũ sang màn gọi. Tách subscription tin nhắn khỏi presence, SIP và tín hiệu điều khiển cuộc gọi nhóm. | Đăng nhập, mở danh bạ, mở lịch sử và reconnect không phát API tin nhắn. Cuộc gọi 1–1, yêu cầu thêm người qua host, xử lý từ chối và kết thúc hội nghị vẫn đúng. |
| 3. Danh bạ | Tận dụng có chọn lọc từ nhánh pagination. Trống từ khóa thì hiện tối đa 30 liên hệ gần đây của đúng tài khoản/host/tenant, lưu khi chọn kết quả hoặc xác nhận đúng liên hệ, loại trùng bằng UUID. Khi tìm, debounce khoảng 300 ms, hủy truy vấn cũ, phân trang 30 và sắp xếp ổn định với UUID làm khóa phụ. Reset trang khi đổi từ khóa/bộ lọc. | 100 người tên Hùng cho 4 trang 30/30/30/10. Xóa từ khóa trở về gần đây. Gọi lại từ lịch sử, nhập máy lẻ hoặc mở yêu thích hoạt động độc lập với trang đang xem. |
| 4. Bộ phận và trạng thái | Dùng description có nội dung làm nguồn ưu tiên. Chuẩn hóa Unicode, khoảng trắng và cách viết hoa. Có mục Chưa có bộ phận. Lấy danh mục bộ phận và lọc toàn nguồn theo quyền trước khi phân trang. Gộp Trực tuyến/Ngoại tuyến thành bộ lọc trong Tất cả. Khi chọn trạng thái toàn danh bạ, dùng nguồn presence phía server để lọc trước khi lấy 30 người. | Bộ phận nằm ngoài trang đầu vẫn hiện; lọc online trả đủ trang khi toàn nguồn còn đủ người. Không gắn nhãn toàn công ty cho kết quả chỉ lọc trong một trang. Tránh để từng trình duyệt quét Confd để dựng bộ lọc. |
| 5. Presence và gọi | Chỉ lấy snapshot cho UUID đang hiển thị, cập nhật các thay đổi qua WebSocket. Dọn tập theo dõi khi đổi trang/phiên. Đồng bộ lại khi reconnect, quay lại tab hoặc dữ liệu quá cũ, gộp request trùng. Lỗi nguồn hiển thị Chưa xác định. Trước khi gọi, lấy trạng thái mới của đúng người hoặc nhóm được mời, chia lô nhỏ nếu cần. | 30 người hiển thị không phát request chứa 1.000 UUID. Đổi trang nhanh không áp response cũ. Người offline sau lần kiểm tra vẫn được xử lý đúng theo kết quả Wazo/SIP. |
| 6. Nhóm gọi có tên | Dùng vị trí menu cũ cho Gọi nhóm. Cho phép tạo, đặt tên, sửa, xóa, tìm thành viên và chọn xuyên nhiều trang, kể cả người đang offline. Đề xuất nhóm cá nhân lưu backend theo chủ sở hữu/tenant với danh sách UUID để có thể mở lại trên máy khác. Danh bạ có lối gọi nhanh hoặc lưu lựa chọn thành nhóm. | Nhóm lưu giữ đủ thành viên. Khi gọi hiện số có thể mời và lý do bỏ qua; 0 người thì báo, còn 1 thì xác nhận gọi riêng. Truyền tên nhóm vào cuộc gọi và giữ tên khi số người kết nối thay đổi. |
| 7. Nghiệm thu tải và phát hành | Kiểm tra bằng dữ liệu giả và nhiều phiên độc lập, sau đó chạy pilot trên Wazo công ty. Đo độ trễ p95, số request/phiên, kích thước URL, byte phản hồi, lưu lượng socket và tải Wazo khi gõ nhanh, chuyển trang, reconnect đồng loạt hoặc gọi nhóm. | Tách kết quả 3.000 bản ghi khỏi phép thử 3.000 phiên đồng thời. So sánh trước/sau, ghi lại các giới hạn proxy và API thực tế trước khi mở rộng. |

## 3. Quyết định thiết kế cần giữ

Tìm kiếm và bộ lọc toàn danh bạ phải áp dụng trước phân trang. Ưu tiên khả năng sẵn có của Dird theo quyền người dùng. Nếu nguồn thực tế thiếu lookup theo mã nhân viên, danh mục bộ phận hoặc lọc online toàn công ty, bổ sung lớp tra cứu chung ở backend cho đúng trường còn thiếu. Cache và kết quả phải tách theo phạm vi quyền, có cơ chế cập nhật khi hồ sơ hoặc presence đổi. Khi người dùng chỉ mở danh sách gần đây, nhãn bộ lọc phải thể hiện rõ nếu thao tác chỉ áp dụng trong gần đây.

Nhóm gọi lưu lâu dài và một cuộc gọi đang diễn ra có hai vòng đời riêng. Sửa thành viên nhóm lưu áp dụng cho lần gọi kế tiếp. Người gọi ban đầu tiếp tục là host cuộc gọi hiện tại. Mời thêm người, rời cuộc gọi và giải tán hội nghị đi qua luồng điều khiển cuộc gọi hiện có.

Hai điểm cần xác nhận với nghiệp vụ là trường mã nhân viên chính thức trong nguồn danh bạ và nhóm có tên là nhóm cá nhân hay nhóm chia sẻ cho nhiều người quản lý. Giả định bản đầu là nhóm cá nhân có thể mở trên nhiều thiết bị của cùng tài khoản.
