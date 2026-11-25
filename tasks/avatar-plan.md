# Kế hoạch hiển thị avatar theo ID người dùng

Mốc bắt đầu là commit `af84a93` trên `codex/refactor-architecture`. Khi có ảnh hợp lệ, Web hiển thị ảnh trong vòng tròn avatar hiện tại. Trong lúc chờ tải, khi không có ảnh hoặc khi nguồn không đọc được, từng màn tiếp tục hiển thị chữ viết tắt, màu nền hoặc biểu tượng đang dùng.

## 1. Chốt hợp đồng API ảnh

- Lấy URL mẫu đã lược bỏ bí mật, phương thức, tên trường ID, yêu cầu xác thực và phạm vi tài khoản được xem ảnh. Kiểm tra nguồn ảnh có yêu cầu mạng công ty, CA nội bộ, giới hạn tốc độ hoặc kích thước thumbnail hay không.
- Xác minh API nhận UUID người dùng Wazo, mã nhân viên `employee_id`/`epId` hay một ID khác. Dùng hai tài khoản mẫu biết sẵn ảnh, kiểm tra cả trường hợp mã có số 0 ở đầu. Máy lẻ có thể đổi chủ nên không dùng làm khóa ảnh.
- Ghi nhận API trả ảnh trực tiếp, URL ảnh hay JSON. Thử một người có ảnh, một người chưa có ảnh, một ID không tồn tại và một tài khoản không có quyền. Kết quả quyết định cách đọc ảnh, lúc nào được ghi nhớ “không có ảnh” và khi nào cần xác thực lại.

## 2. Nối đúng danh tính và quyền xem

- Nếu API nhận UUID Wazo, dùng UUID đã xác minh từ danh bạ. Nếu API nhận mã nhân viên, ưu tiên ánh xạ có sẵn từ hồ sơ Single ID hoặc dữ liệu Wazo đã công bố. Dùng mã dạng chuỗi để giữ số 0 ở đầu. Nếu thiếu ánh xạ, giữ avatar mặc định cho liên hệ đó.
- Thiết kế mặc định cho API nội bộ là Web gọi cùng origin qua FastAPI. Web gửi UUID đã xác minh. Backend kiểm tra phiên và quyền xem ảnh theo hợp đồng công ty rồi tự phân giải ID ảnh. Nếu dịch vụ ảnh cho phép truy cập trực tiếp từ trình duyệt bằng cơ chế xác thực đã được xác nhận, xem xét dùng đường đó để giảm một lượt qua backend.
- Nếu cần proxy, giữ credential của API ảnh ở backend và dùng host ảnh từ cấu hình tin cậy. Kiểm tra nội dung thực sự là ảnh, giới hạn dung lượng và timeout. Trường hợp upstream trả URL ảnh phải xác minh host được phép trước khi tải tiếp. Tách quyền ảnh khỏi quyết định hiển thị tên và phòng ban.
- Repo từng có avatar ở commit `0f2dbdd`, sau đó được hoàn tác tại `03397d2`. Có thể đối chiếu cách bố trí ảnh và chữ dự phòng trong giao diện sau khi chốt endpoint. Cơ chế API và ánh xạ sẽ theo hợp đồng mới.

## 3. Tải ảnh theo nhu cầu của từng màn

| Đợt | Màn | Cách xác định ảnh |
| --- | --- | --- |
| 1 | Danh bạ, yêu thích và kết quả tìm kiếm | Chỉ tải avatar cho mục đang hiển thị ở trang hiện tại, tối đa 30 mục. Tải khi mục tiến gần vùng nhìn thấy nếu cần giảm request. |
| 1 | Bàn phím gọi và modal mời | Dùng UUID sau khi tra đúng máy lẻ. Nếu số nhập thay đổi hoặc đóng modal, hủy lượt tải không còn người dùng. |
| 2 | Cuộc gọi đến, gọi 1–1 và ảnh tài khoản ở header | Dùng UUID đối phương đã được nhận diện hoặc UUID của phiên đăng nhập. Avatar mặc định xuất hiện ngay và tải ảnh bất đồng bộ để nút nghe/gọi vẫn phản hồi. |
| 2 | Lịch sử gọi | Chỉ ghép ảnh khi CDR có UUID của đối phương hoặc liên kết danh tính tin cậy. Bản ghi cũ thiếu UUID tiếp tục dùng chữ viết tắt. |

Ảnh đại diện chung của cuộc gọi nhóm dùng biểu tượng nhóm hiện có. Một component avatar nhận định danh và phần hiển thị dự phòng của màn. Service ảnh sở hữu việc lấy và lưu tạm ảnh. Component chỉ xử lý hiển thị, gồm cả khi trình duyệt không giải mã được ảnh. Giữ kích thước vòng tròn và bố cục hiện tại.

## 4. Giới hạn tải và xử lý lỗi

- Ưu tiên thumbnail nhỏ nếu API hỗ trợ. Gộp lượt tải theo ID và giới hạn đồng thời, đề xuất bắt đầu từ 4 lượt trên mỗi phiên rồi đo. Một liên hệ xuất hiện trong danh bạ và bàn phím cùng lúc dùng chung lượt tải.
- Cache bộ nhớ có giới hạn theo nguồn ảnh, tenant, phiên/quyền xem và định danh. Hỏi bên quản lý ảnh về thời gian cập nhật trước khi chốt TTL. Chỉ cache ngắn kết quả “không có ảnh” đã được API xác nhận. Lỗi mạng, 401, 403 và 5xx phải giữ avatar dự phòng và cho thử lại theo chính sách phù hợp. Tôn trọng `Retry-After` nếu gặp 429.
- Nếu dùng Blob URL, thu hồi khi ảnh bị loại khỏi cache và không còn component sử dụng. Khi logout, đổi tài khoản hoặc đổi tenant, xóa cache và hủy request cũ. Kết quả trả muộn của Hùng không được hiện khi người dùng đã chuyển sang Lan.

## 5. Kiểm thử và triển khai

1. Xác nhận hợp đồng bằng tài khoản được phép. Viết adapter và kiểm thử ảnh hợp lệ, thiếu ID, người không có ảnh, ảnh hỏng, MIME sai, lỗi mạng và thiếu quyền.
2. Đưa vào danh bạ, bàn phím và modal mời trước. So sánh chữ viết tắt và màu dự phòng với giao diện hiện tại. Thử đổi trang nhanh, nhập hai máy lẻ liên tiếp, logout khi đang tải và dùng nhiều màn cho cùng một người.
3. Mở rộng sang các màn gọi, header và lịch sử khi ánh xạ ID đã được xác minh. Test cuộc gọi đến có ảnh và không ảnh, thao tác nghe máy khi API ảnh lỗi, và CDR cũ khi máy lẻ đã đổi chủ.
4. Với dữ liệu mô phỏng 3.000 liên hệ, mở trang đầu, cuộn và đổi trang. Đếm request ảnh, lượt dùng cache và dung lượng tải. Nghiệm thu khi request chỉ phát sinh cho các avatar người dùng đang xem, và ảnh người không còn trong phạm vi quyền không xuất hiện sau đổi phiên. Chạy pilot nội bộ trước khi mở rộng.
