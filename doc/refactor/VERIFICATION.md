# Kiểm chứng bản refactor dễ đọc

Cập nhật: 20/11/2026. Windows, Node 22.19.0. Đợt này sửa duy nhất D:/Project/Smart_Call_Web_Refactor sau khi đã push bản gốc lên main tại 5d5fe3e.

## Kết quả hiện hành

| Kiểm tra | Kết quả |
| --- | --- |
| npm run lint | Đạt, không lỗi |
| npm --prefix frontend run check:architecture | 52 module JS/Vue; không import thiếu/cycle, service không import giao diện/điểm lắp ghép, state/helper không import nghiệp vụ |
| npm test | 121/121 test, 12 file; không skip/cancel |
| npm run build | Đạt, 361 module được biến đổi; đầu ra frontend/dist |
| npm --prefix frontend run format:check | Đạt; toàn bộ source/test/script/config khớp Prettier |
| CSS màn hình gọi | 282 rule nguồn được đối chiếu sau tách, thiếu 0 rule |
| Catalog handbook | 53 link file source hợp lệ, đủ toàn bộ source hiện tại |
| Cây thư mục | 53 file, 20 thư mục dưới src, tối đa hai tầng; trước đó 44 thư mục |
| CallsView.vue | 976 dòng, bao gồm comment giải thích; UI đã được tách theo cụm |

Baseline đầu lượt là 103 test/10 file. Lượt này thêm 18 ca cho component mới, các lỗi F04–F08, credential/logger và hai tình huống gọi/nhánh nhóm. Bộ test chạy module thật và Vue thật; SDK/network/device/clock được kiểm soát tại ranh giới. Các ca UI mới kiểm tra cả cảnh báo template Vue. Không suy ra coverage 100%.

## Phạm vi hành vi đã kiểm tra

- Phiên: response/body cũ, login/validate timeout, SDK state/cleanup muộn, thu hồi và bỏ private view/KeepAlive.
- Gọi: điều kiện chặn, gọi chính mình, lookup chậm, SIP registration, kết nối/cleanup và lệnh nhận máy chờ ACK.
- Event: SIP ID của nhánh đang quản lý; accepted đến trước Promise; terminal event cũ; kết quả gọi cũ không tắt âm báo cuộc gọi mới.
- Nhóm: host/member/UUID, ADD_REQ cũ/mới, LEFT chỉ chính người phát, ID hội nghị, merge lỗi/thử lại, nhánh muộn và cleanup.
- UI mới: Dialer → View → service, nút điều khiển, tìm kiếm không dấu, phát đúng contact, modal loại peer/self/offline và bỏ lựa chọn không còn hợp lệ. Nhánh đã nghe không còn báo đang kết nối.
- Chat: command quản trị, proxy sendFailed/ID server, phòng đóng không tự mở lại bởi tin thường, tombstone ngoài trang gần nhất, chặn gửi tiếp, kết quả batch từng phần.
- Dữ liệu/media: schema danh bạ, refresh CDR đảo thứ tự, ghi âm start/stop lỗi/hủy, ObjectURL, player và mic đến muộn.
- Credential/log: giữ khoảng trắng mật khẩu, reset dùng login identifier, che token/password và serialize snapshot có vòng tham chiếu.

## Build và phạm vi chưa chứng minh

Chunk đầu vào khoảng 1.204 KB trước gzip, 328 KB sau gzip; Vite vẫn cảnh báo lớn hơn 500 KB. Không tăng ngưỡng để che cảnh báo và không khẳng định đợt tái cấu trúc đã tăng tốc.

Đối chiếu CSS xác nhận giữ selector/khai báo/điều kiện media và keyframe sau đổi namespace. Đợt này chưa kiểm thử hiển thị bằng trình duyệt thật ở mọi kích thước. Chưa đăng nhập Wazo, gọi Android, kiểm tra mic/codec/media hoặc IdP thật. Bản kiểm tra login trên trình duyệt trong lượt trước không được coi là xác minh toàn bộ UI vừa tách.

## Các giới hạn tích hợp

- Đóng phòng Chatd hiện là giao thức SmartCall, không phải API xóa phòng hoặc thu hồi membership. Backend/Wazo phải thực thi ACL thật.
- Search/phân trang tombstone và metadata admin phải được thử trên server triển khai. Không xác minh được trạng thái thì tạm ẩn nhóm có admin được xác nhận và thông báo.
- Envelope presence phải có UUID server. Legacy ADD_REQ chưa có nonce/chữ ký cho từng cuộc gọi.
- Conference event thiếu ID/call_id đáng tin bị bỏ qua; cần thử envelope thực tế và kết thúc nhánh SIP.
- SDK auth không có abort được dùng ở đây. Gate giữ khóa đến khi request/cleanup xong; treo hoặc cleanup lỗi cần chờ/tải lại.
- Backend/SSO chưa triển khai; không tự bịa giao thức hoặc API membership.

## Chạy lại

```powershell
npm run check
npm --prefix frontend run format:check
```

Trước khi dùng thay bản gốc, thử login/restore/revoke hai thiết bị; gọi/nhận/cúp; host/nhánh phụ; ghi âm và CDR; Chatd tombstone; thiết bị mic/loa và chứng chỉ trên tổng đài thật.

## Bổ sung khi gom service và giải thích code

Services có 6 nhóm auth/calls/audio/realtime/data/common, một cấp nhóm; index.js/createServices.js ở gốc. Toàn frontend vẫn 53 file với 20 thư mục con. Bộ 121 test được giữ nguyên, không thêm test chỉ để kiểm tra nội dung comment. Comment được kiểm chứng bằng đối chiếu AST và template/style với snapshot trước khi chú thích; kết quả cuối: 461/461 mục có giải thích, AST của 52 module không đổi, template/style không đổi; 121/121 test, lint, architecture, build và format:check đều đạt.
