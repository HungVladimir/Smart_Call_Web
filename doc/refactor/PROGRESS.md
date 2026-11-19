# Nhật ký refactor SmartCall Web

Ngày thực hiện: 19/11/2026. Phạm vi ghi: D:/Project/Smart_Call_Web_Refactor. Nhánh: codex/refactor-architecture. Điểm bắt đầu: fac529b; mã nghiệp vụ kế thừa affdb80. Bản gốc cùng cấp được giữ nguyên.

## 1. Chuẩn bị và kiểm tra thực tế

- Tiếp nhận yêu cầu Web, không refactor ứng dụng Android; FileQuest chỉ tham khảo.
- Trình bày sơ đồ và cây thư mục trước khi chỉnh sửa.
- Xác minh clone/main khi bắt đầu vẫn chứa mã Vue ở gốc; chưa có frontend/backend như mô tả dự kiến. Tạo bố cục theo yêu cầu mới.
- Chuyển src, public, tests, package/lock, index, Vite/jsconfig/Prettier và cấu hình môi trường vào frontend.
- Giữ Git, tài liệu, FileQuest/spec tại gốc; tạo backend/README.md mô tả phần chờ hợp đồng.
- Lưu source baseline tạm trong .refactor-tmp được ignore để đối chiếu khi tách code.

## 2. Baseline và công cụ kiểm chứng

- Baseline sau chuyển thư mục: hồi quy cũ 27/27 đạt; build thành công, 324 module, bundle đầu vào khoảng 1,19 MB.
- Bộ hồi quy cũ phụ thuộc vị trí source. Thay bằng Vitest chạy module thật và Vue component thật, không tiếp tục duy trì file kiểm thử đã trỏ vào cấu trúc bị xóa.
- Khi cài công cụ gặp lỗi npm Arborist edgesOut ở chuỗi peer devtools/Vitest; bỏ vite-plugin-vue-devtools khỏi bản refactor và dùng Vitest tương thích môi trường Node.
- Bộ mount dùng Vue createApp; không giữ @vue/test-utils sau khi xác định có thể kiểm tra trực tiếp mà không cần dependency này.
- Thêm ESLint, Prettier check, checker import/cycle/ràng buộc tầng và kiểm tra field callState cũ.
- Lần npm ci cuối ban đầu bị EPERM vì dev server đang giữ binding native Rolldown; dừng dev server trước khi cài lại.
- Cấu hình Vitest tắt transform asset URL cho public asset để component import đúng trên Windows.
- Một số test UI ban đầu lỗi do chưa đợi router và happy-dom không có confirm: đợi điều hướng trong command UI và stub confirm tại ranh giới test.

## 3. Tách kiến trúc

- Tách wazo.js khoảng 3.209 dòng thành AuthService, CallController, GroupCallController, PhoneAdapter, CallControlApi và các handler sự kiện có trách nhiệm cụ thể.
- createServices lắp ghép dependency; services.js là nơi nạp SDK thật. Service nghiệp vụ không import ngược app.
- EventConnection sở hữu socket/reconnect; handleWazoEvent xử lý nội dung nghiệp vụ; EventHub phân phối sự kiện tới các dịch vụ.
- Tách userSessionState, callState, groupCallState, recordingState; Map chứa SDK session dùng shallowReactive.
- ContactService và ChatService giữ reactive state của danh bạ/phòng. Giao diện đọc bằng computed, bỏ các bản sao mảng và listener cập nhật rỗng.
- Tách SettingsService/WazoApiClient để modal không chứa HTTP/header.
- Tách mapper hồ sơ, danh bạ hai schema, CDR; định dạng thời gian tin nhắn có file riêng.
- Tách useContactFilters, useMicrophoneMeter, useRecordingPlayer.
- Tách DialerPanel, MessageList, MessageComposer; dọn CSS trùng trong page sau khi chuyển sang component.
- Chuẩn hóa tên có nghĩa: getOrCreateDirectRoom, publishRoomsChanged, isTrustedRoomCommand, assertRoomAdmin, các hàm timeout/hủy lời mời.
- Sửa các tham chiếu myExtension/myUserUuid cũ sang userSessionState. Thêm checker để phát hiện field callState không còn tồn tại.

## 4. Lỗi phát hiện và xử lý trong lượt refactor

| Trigger / vấn đề | Thay đổi tại đúng owner | Bằng chứng |
| --- | --- | --- |
| API favorite lỗi vẫn đổi UI; bấm trùng tạo request lặp | Commit sau ACK, dùng pending map, trả lỗi HTTP | Test HTTP500/204 và thao tác đồng thời |
| Favorite phiên cũ khóa thao tác cùng contact của phiên mới | Reset pending map và metadata nguồn khi đổi phiên | Test hai request qua hai phiên |
| Xóa nhiều nhóm có lỗi nhưng báo thành công toàn bộ | Trả deletedIds/failures, giữ lựa chọn lỗi, thông báo đúng tỷ lệ | Test service và MessagesView |
| Có token bị coi là SIP online | Header đọc trạng thái registered thực | Test Header trước/sau registered |
| App yêu cầu connect lần nữa sau AuthService | Auth sở hữu kết nối login/restore; controller gộp connect đang chờ | Test SDK chỉ nhận một connect |
| Registered phát trong connect trước lúc listener được gắn | Gắn listener trước lệnh SDK | Test registered đồng bộ |
| SDK logout/disconnect hoàn tất muộn và xóa state SDK của lần kết nối mới | Chờ cleanup SDK trước login/connect tiếp theo; đối chiếu chữ ký SDK 0.49.11 | Test SDK logout/disconnect trả promise muộn |\n| Callback đã xếp hàng chạy sau logout/disconnect | Ràng buộc context và thế hệ listener | Test callback cũ không sửa phiên mới |
| SDK đăng nhập không trả kết quả làm form chờ vô hạn | Giới hạn chờ SDK auth/token 15 giây; không commit kết quả muộn | Test SDK promise treo |
| Token khôi phục bị từ chối vẫn còn coi là đăng nhập | Xóa phiên bị từ chối, chỉ khi epoch vẫn thuộc lần khôi phục đó | Test invalid restore và restore A sau B |
| Host ghi âm lấy từ fallback khác host Auth/env | RecordingService dùng host AuthService | Test URL truy vấn Calld |
| Force refresh CDR cũ về sau request mới | Dùng request generation trước commit/catch/finally | Test phản hồi đảo thứ tự |
| Khóa quay số hết sau 1,2 giây dù lookup đang chờ | Giữ lock đến khi xử lý xong; release thuộc đúng attempt | Test lookup dài, logout, kết quả SDK muộn |
| Enter trong lúc nhập IME gửi ngoài ý muốn | Composer kiểm tra isComposing | Test component thật |
| Lookup UUID không hiểu danh bạ bảng cột | Dùng chung contactMapper | Test column_types/results |
| Chọn mic thử đã lưu dù chưa bấm Lưu | Chỉ khởi động phép đo; lưu thiết bị trong handleSave | Rà luồng và test lưu cấu hình |
| Stream/mic/audio trả về sau đóng modal/chuyển lựa chọn | Generation + cleanup trong composable | Test dispose/reversed response |

Các lỗi và biện pháp của lượt audit trước vẫn được giữ: chặn response sai phiên sau đọc body; nghe máy chờ ACK; conference/recording không hồi sinh sau hủy; không thực thi command quản trị từ tin thường; không tái tạo phòng để giả cập nhật membership.

## 5. Hành vi được làm rõ

- Bỏ đăng nhập offline/token giả và cờ mockData; cấu hình cũ không bật lại được đường này.
- Không đưa lại ghim, read receipt hoặc bộ đếm chưa đọc. Giữ nội dung, thời gian và thông báo gửi thất bại.
- Ngôn ngữ khác tiếng Việt, desktop notifications, chat sound và điều chỉnh âm lượng chuông chưa có implementation đầy đủ; điều khiển hiện bị vô hiệu hóa thay vì cho thay đổi không có tác dụng.
- Backend/IdP chưa có hợp đồng: chỉ chuẩn bị ranh giới, không tạo endpoint hoặc token exchange giả.
- Đóng/thêm/xóa thành viên nhóm vẫn cần hợp đồng server và kiểm tra quyền tương ứng; giữ chặn các thao tác chưa an toàn.

## 6. Comment, định dạng và tài liệu

- Bổ sung comment tiếng Việt cho lớp, lệnh nghiệp vụ, ràng buộc phiên và cleanup.
- Phát hiện một số comment/tài liệu mới bị mất dấu do encoding pipeline PowerShell; chuyển pipeline sang UTF-8 và viết lại các đoạn bị ảnh hưởng.
- Chuẩn hóa imports và định dạng bằng Prettier; bỏ imports, hàm/listener không còn sử dụng.
- Tạo ARCHITECTURE, DEVELOPMENT_GUIDE, VERIFICATION, IMPLEMENTATION_PROMPT; cập nhật README/AGENTS/backend và bước 79 của lịch sử triển khai.
- Tài liệu cũ được giữ làm lịch sử; đường dẫn hiện hành bắt đầu từ frontend/src.

## 7. Kết quả cuối và giới hạn

- 76 kiểm thử thuộc 7 file đạt; lint và kiểm tra 50 module Web đạt.
- Build production thành công; vẫn có cảnh báo chunk đầu vào khoảng 1.197 KB, gzip khoảng 325 KB. Chưa có đo hiệu năng để khẳng định tải nhanh hơn.
- Cài đặt từ lockfile và audit dependency được xác minh; xem VERIFICATION.md để biết phạm vi.
- Mở trang login bằng trình duyệt local: hiển thị tiếng Việt, không có console error/warning ở lần kiểm tra. Không nhập credential thật.
- Không chạy SIP/media/hội nghị/ghi âm hoặc IdP trên tổng đài thật. Không triển khai production.
- Các service/page lớn vẫn còn nhiều nghiệp vụ và CSS. Việc tách tiếp cần dựa vào thay đổi cụ thể và kiểm chứng tích hợp, không chỉ số dòng.

Thông tin commit/push được báo trong kết quả bàn giao của lượt làm việc; không ghi hash tự tham chiếu vào commit này.
