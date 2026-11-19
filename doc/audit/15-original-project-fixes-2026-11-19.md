# Sửa các vấn đề tồn đọng trên dự án gốc

Ngày bắt đầu: 19/11/2026. Cập nhật theo yêu cầu người dùng: 20/11/2026. Phạm vi chỉnh sửa: `D:\Project\Smart_Call_Web`.

Bản refactor tại thư mục cùng cấp chỉ được đọc để đối chiếu, không chỉnh sửa. Giữ cấu trúc hiện tại của dự án gốc; không chuyển nguyên kiến trúc refactor vào đây. Các tài liệu có sẵn được giữ nguyên.

## Phạm vi và tiến trình

1. Đối chiếu lại F01–F08 với mã gốc: cả tám vấn đề đều cần xử lý.
2. Đưa cơ chế xác thực tín hiệu gọi nhóm và khóa xác thực SDK vào `src/services/wazo.js`, có comment phân vùng. Theo yêu cầu mới nhất, không giữ hai file helper riêng.
3. Sửa thu hồi phiên, vòng đời socket/Phone, định danh cuộc gọi và hội nghị.
4. Sửa reactivity của tin nhắn, trạng thái đóng nhóm, kết quả đóng hàng loạt và điều hướng khi tắt hết tính năng.
5. Bổ sung các bản sửa liên quan đã xác nhận: yêu thích chờ ACK, khóa quay số, refresh CDR, mật khẩu, định danh đăng nhập, host ghi âm, trạng thái SIP và dữ liệu người gọi.
6. Bổ sung kiểm thử tái hiện; kiểm chứng build; rà soát diff trước khi bàn giao.

## Đối chiếu lỗi và cách xử lý

| Mục | Xử lý trong bản gốc |
| --- | --- |
| F01: presence điều khiển nhóm không xác thực người phát | Đối chiếu UUID server, máy lẻ không trùng, peer, host, thành viên và kết nối hiện tại. LEFT chỉ cho chính người phát. ADD_REQ gộp lặp cả schema cũ/mới. Thành viên không phát GROUP thay host. |
| F02: timeout không dừng side effect SDK | Một gate dùng chung cho SDK Auth tuần tự hóa init/login/validate/logout. Timeout chỉ kết thúc chờ của form; giữ khóa đến khi request cũ và cleanup xong. Cleanup lỗi yêu cầu tải lại trang. |
| F03: phiên bị thu hồi chưa dọn đầy đủ | Đi qua logout ngay, vô hiệu scope, abort request/body, xóa token/định danh/cache, dừng socket/timer/thoại. App bỏ view riêng tư và Settings trước khi chuyển trang. |
| F04: accepted cũ thay session mới | Kiểm tra SIP ID của các nhánh đang quản lý. Event tới trước Promise call được giữ tạm và chỉ phát lại khi ID khớp kết quả thực tế. Không dùng số điện thoại để xác định cùng cuộc gọi. |
| F05: conference_deleted nhầm hội nghị | Chỉ ngắt khi ID khớp hội nghị đang quản lý. Event participant_joined chỉ gắn ID hội nghị khi call_id khớp nhánh server hiện tại. Thiếu bằng chứng thì bỏ qua. |
| F06: sendFailed không cập nhật UI | Tin nhắn optimistic được tạo bằng reactive, cả ID/thời gian server và lỗi gửi đều cập nhật qua proxy. Rooms cũng có nguồn state reactive dùng chung. |
| F07: tin thường mở lại nhóm đã đóng | Tombstone đáng tin không bị tin thường đảo ngược; nhớ ID đóng trong RAM theo phiên, kiểm tra lại trên server khi tải phòng, tìm tombstone ngoài trang tin gần nhất. Chặn gửi ở service. |
| F08: tắt hết tính năng gây redirect loop | Theo người dùng, sản phẩm luôn bật ít nhất một màn hình. Bỏ `UnavailableView` và route riêng; chỉ giữ guard không tự redirect về chính route đang đến. |

## Giới hạn cần hiểu đúng

- Đóng nhóm chat hiện là giao thức ứng dụng SmartCall. Wazo Chatd trong tài liệu hiện có chưa cung cấp API giải tán phòng/thu hồi membership tương ứng. Không khẳng định bản vá đã xóa dữ liệu hoặc chặn client khác gửi qua API trực tiếp. UI xác nhận được sửa để diễn đạt đúng phạm vi này.
- Kiểm tra tombstone dùng `search`, `limit`, `offset` đã được liệt kê trong đặc tả messages. Nếu không xác minh được, nhóm được tạm ẩn thay vì coi là mở; không ghi dữ liệu nghiệp vụ vào localStorage. Phân trang lặp hoặc vượt giới hạn được coi là chưa xác minh, không tự bỏ qua.
- UUID trong presence phải là danh tính do Wazo cung cấp. Kiểm tra Web không thay ACL trên server; chưa có nonce/chữ ký ràng buộc từng cuộc gọi trong giao thức Android cũ.
- SDK không có cơ chế hủy request xác thực được dùng ở đây. Nếu request treo mãi hoặc cleanup thất bại, người dùng phải chờ hoặc tải lại trang; không cho đăng nhập chồng để tránh lẫn session.
- Nếu conference event thiếu ID/call_id để ràng buộc, Web bỏ qua event đó; kết thúc nhánh SIP vẫn xử lý theo luồng cuộc gọi. Cần xác minh envelope thực tế trên tổng đài.
- Chưa chạy thử Wazo, Android hoặc IdP thật; không thực hiện đăng nhập/gửi lệnh bằng tài khoản thật trong lượt sửa này.

## Kiểm chứng

Kết quả sau khi gộp helper và bỏ màn hình không cần thiết theo yêu cầu mới nhất:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 72/72 ca đạt, không skip/cancel; 27 ca cũ và 45 ca bổ sung |
| `npm run build` | Thành công; 324 module được biến đổi |
| `git diff --check` | Đạt, không lỗi khoảng trắng trong diff |
| File runtime trong `src` | 23 file, bằng số file trước lượt sửa; không thêm tầng thư mục |
| `UnavailableView`, hai file helper tách riêng | Đã bỏ; logic gate và presence nằm trong `wazo.js` |
| Bản clone refactor | Chỉ đọc, không chỉnh sửa |

Build vẫn cảnh báo chunk đầu vào lớn hơn 500 KB: khoảng 1.201 KB trước gzip, 327 KB sau gzip. Chưa tối ưu bundle trong lượt sửa lỗi này.

Các ca mới kiểm tra: SDK auth có state bị ghi muộn; timeout/cleanup; restore lỗi và đổi phiên; thu hồi khi đang đọc body HTTP; người ngoài/giả mạo tín hiệu nhóm; accepted/terminal event cũ; SDK phát event trước Promise; ID hội nghị; proxy Vue của tin nhắn; tombstone cũ và phân trang; lỗi xác minh nhóm; favorite thất bại/ACK muộn; refresh CDR đảo thứ tự; khóa quay số; kết quả đóng nhóm từng phần; mật khẩu có khoảng trắng; chọn mic chưa lưu; socket/callback cũ; tab dùng chung storage; connect/disconnect SIP và lỗi cleanup.

Ca App dùng component `App.vue` được compile thật, Vue renderer và memory router để xác nhận view riêng tư/KeepAlive được gỡ. Các dịch vụ gốc được thực thi qua fixture VM của bộ test hiện có, SDK/HTTP/thiết bị được thay ở ranh giới. Đây không phải chứng nhận coverage 100% hoặc kiểm thử tổng đài thật.

## Các bản sửa liên quan khác

- Lưu tên tài khoản đăng nhập riêng với tên hiển thị để không gửi reset password nhầm định danh.
- Login và đổi mật khẩu giữ nguyên khoảng trắng. UUID SDK không bị profile Confd ghi đè.
- Ghi âm dùng host/token của phiên đăng nhập, không lấy host cũ từ localStorage.
- Header và màn hình gọi chỉ báo SIP online sau REGISTERED, không suy từ token.
- Chặn connect trùng, đợi cleanup cũ, vô hiệu listener và reconnect timer của phiên cũ. Cleanup SIP thất bại chặn connect/quay số tiếp trên SDK chưa sạch.
- Đăng ký SIP chạy nền sau xác thực; Phone treo không giữ form login dù Auth đã thành công.
- Tab cũ dọn SDK/cache của chính nó khi storage đổi phiên nhưng không xóa token của tab mới.
- Logger chụp dữ liệu an toàn, che token/password và xử lý object SDK có vòng tham chiếu.
- Không còn đường login offline với token/máy lẻ giả. Cấu hình legacy mockData không bật lại được đường đó.
- IME đang ghép ký tự không gửi tin khi nhấn Enter. View bắt lỗi service khi nhóm đóng trong lúc gửi.
- Chọn mic để thử không lưu trước khi bấm Lưu. Các tùy chọn chưa có tác dụng được vô hiệu và ghi rõ trạng thái.
- Modal cuộc gọi đến không tự điền số máy lẻ mẫu khi thiếu dữ liệu.

## Xác minh tích hợp còn cần trên môi trường thật

1. Envelope UUID/call_id/conference_id và quyền phát/nhận event trên Wazo.
2. Mời/nghe/cúp từng nhánh với Web và mã tham chiếu Android, nhất là schema ADD_REQ cũ.
3. Search/phân trang tombstone và metadata quản trị của Chatd đang triển khai.
4. Thu hồi token giữa hai thiết bị, SDK logout/đăng ký SIP và quyền microphone thực tế.
5. Hợp đồng API giải tán phòng/membership và IdP khi phía phụ trách cung cấp; không tự tạo API chưa có.

Người dùng đã yêu cầu commit và push bản vá lên Git vào ngày 20/11/2026. Mã commit và kết quả push được báo riêng sau khi hoàn tất thao tác Git.
