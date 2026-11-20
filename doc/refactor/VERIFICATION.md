# Kiểm chứng bản refactor dễ đọc

Cập nhật: 20/11/2026. Windows, Node 22.19.0. Đợt đồng bộ mới chỉ sửa D:/Project/Smart_Call_Web_Refactor; đối chiếu các bản sửa main đến 7485481. Bản gốc không thay đổi trong lượt này.

## Kết quả hiện hành

| Kiểm tra | Kết quả |
| --- | --- |
| npm run lint | Đạt, không lỗi |
| npm --prefix frontend run check:architecture | 52 module JS/Vue; không import thiếu/cycle, service không import giao diện/điểm lắp ghép, state/helper không import nghiệp vụ |
| npm test | 143/143 test, 14 file; không skip/cancel |
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

Chunk đầu vào khoảng 1.210 KB trước gzip, 329,49 KB sau gzip; Vite vẫn cảnh báo lớn hơn 500 KB. Không tăng ngưỡng để che cảnh báo và không khẳng định đợt tái cấu trúc đã tăng tốc.

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

## Bổ sung đồng bộ lỗi từ main — 20/11/2026

Baseline trước lượt này: 121 test/12 file. Hiện tại: 143 test/14 file, thêm 22 ca cho host, merge/cleanup muộn, listener SDK thật, âm phím và badge/cache/Vue lifecycle. Các số 121 và kết quả comment/AST ở phần lịch sử phía trên thuộc lượt trước, không mô tả phạm vi thay đổi hành vi mới.

Đã chạy npm --prefix frontend run check (lint → architecture → test → build) thành công. Không tăng ngưỡng bundle hoặc tắt toàn bộ rule kiến trúc; chỉ cập nhật quy tắc cấm unread theo yêu cầu khôi phục badge. Chưa thử tổng đài, Android hoặc đo latency trên máy bị khựng. Xem [bảng thử](LATEST_FIXES_2026-11-20.md).


## Đồng bộ bổ sung hiển thị nhóm Web — 20/11/2026

Đã chuyển tiếp bản main d0dc85d vào refactor theo yêu cầu mới: tách groupConnectedExtensions/groupPendingExtensions, snapshot GROUP_STATE có revision, GROUP_SYNC khi incoming/accepted/reconnect. ActiveCallPanel chỉ đếm người đã kết nối, bỏ tiêu đề số cũ. Giữ ánh xạ ID B/C sau merge và dọn lời mời khi SDK lỗi/null/timeout. EventConnection báo mở socket qua callback được lắp tại createServices, không import ngược nghiệp vụ.

Kết quả hiện hành: 148/148 test (14 file), lint/architecture/build đạt; các số 143 ở mục trước là mốc trước bổ sung này. Đã gồm toàn bộ bản sửa trước về host, listener SDK, tiếng phím và badge lưu tạm. Chưa thử tổng đài thật; cả ba máy Web cần cập nhật cùng bản.


## Gọi từ hội thoại — 20/11/2026

MessagesView.startVoiceCall chỉ phát app-action/dial cho chat 1-1. App.onDial là nơi duy nhất chuyển route kèm number/autocall; CallsView nhận query và gọi CallService.startCall. Không gọi router.push('/calls') thêm lần nữa vì sẽ làm mất query tự gọi.

Chat nhóm: MessagesView lấy máy lẻ thành viên, bỏ chính mình/trùng số → GroupCallService.startGroupCall → ContactService.isContactAvailableForCall loại bận/đổ chuông/DND/offline/không xác định khả dụng → không còn ai: dừng; còn một: CallService.startCall; nhiều người: khởi tạo nhóm và mời các nhánh còn lại. Phần kiểm tra SIP, mic và phiên vẫn thuộc dịch vụ gọi. Người gọi ban đầu giữ host.

View chờ kết quả success trước khi chuyển màn hình/gửi thông báo chat; khóa bấm lặp và trả khóa trong finally. Giữ room ID lúc bắt đầu, kiểm tra session trước khi xử lý kết quả. Thông báo chỉ nói đã khởi tạo cuộc gọi, chưa khẳng định người được mời đã nghe máy. Bộ lọc dùng presence hiện có, cần xử lý cả trường hợp trạng thái đổi sau kiểm tra và tổng đài từ chối. Không thay đổi admin.

Kiểm chứng mới nhất: 155/155 test (14 file), lint/architecture/build/format đạt; còn cảnh báo chunk lớn. Test mới kiểm tra router thật giữ query, nhóm một/nhiều/không có người rảnh, bấm lặp, đổi phòng khi chờ, logout, hủy và exception. Chưa thử tổng đài thật. Khi test: chat 1-1 gọi được; nhóm chỉ mời người khả dụng; tất cả bận/offline thì ở lại màn hình chat; người chưa nghe máy không tính đã tham gia.

Danh bạ 2.000 người mới chỉ thảo luận, chưa code: phân trang API 50/lần, tìm tên/số trên server, presence chỉ cho trang đang xem và người sắp gọi; không bắt buộc polling toàn bộ danh bạ. Nguồn Wazo Dird có limit/offset/search/uuid theo tài liệu cục bộ, cần thử trên server thực tế. Chỉ cắt mảng sau khi tải toàn bộ sẽ giảm DOM nhưng không giảm dữ liệu mạng. Không đổi số cột để thay cho phân trang. Khi triển khai sau này phải giữ lookup UUID/máy lẻ độc lập với trang hiển thị để không làm hỏng chat, mời nhóm và xác minh thành viên; presence chia lô theo giới hạn máy chủ.


## Sửa mục 3, 4, 5, 7 — 20/11/2026

- MessagesView.loadRooms giữ danh sách/phòng trong RAM khi REST cập nhật nền, chỉ loading lần đầu nếu chưa có dữ liệu. selectRoom không che lịch sử có sẵn bằng spinner. KeepAlive vẫn đồng bộ server khi mở lại, WebSocket/badge và kiểm tra session giữ nguyên. Không lưu nội dung chat cục bộ, chưa giảm số REST request.
- LoginView chỉ hiện hướng dẫn kiểm tra chứng chỉ sau lỗi kết nối/TLS phù hợp; ẩn mặc định và khi thử lại. Lỗi HTTP/credentials/timeout chung/TypeError nội bộ không kích hoạt. Failed to fetch có thể là mạng, CORS hoặc TLS; hướng dẫn không khẳng định nguyên nhân. Link tab mới có noopener/noreferrer.
- ActiveCallPanel sửa SVG mic thường cho cân đối; giữ icon muted và emit mute. Nút thêm người dùng nền hover bán trong suốt giống các nút điều khiển trên nền tối.
- MessagesView bổ sung CSS btn-action bị thiếu (36x36, viền, nền, flex căn giữa và hover) theo bản gốc, khôi phục diện mạo nút gọi/video. Chưa triển khai gọi video.
- 158/158 test (14 file), lint/architecture/build đạt; format:check đạt. Test mới dùng DOM/KeepAlive thật với REST trì hoãn, lịch sử có sẵn và các nhánh lỗi đăng nhập. Còn cảnh báo chunk lớn. Chưa xác nhận giao diện trên môi trường tổng đài thật.
- Người dùng thử: chuyển qua lại Tin nhắn, mở phòng cũ, nhập sai mật khẩu và thử lỗi kết nối, mic bật/tắt và hover thêm người trong cuộc gọi, nút gọi/video ở header chat. Admin không đổi; danh bạ phân trang vẫn chỉ thảo luận. Giữ nguyên backend/doc của người dùng, không đưa vào commit.


## Tích hợp backend Single ID và cấp tài khoản Wazo — 20/11/2026

Backend hiện có FastAPI (main), cấu hình (config), Redis session/SQLite mapping (store), OIDC (oidc) và cấp phát Wazo (wazo). Frontend thêm nút Single ID ở LoginView, route/CallbackView công khai và singleIdApi; AuthService dùng chung completeAuthenticatedSession cho mật khẩu và token SSO. App không đưa callback về login trước khi hoàn tất. Vite dùng cổng 8800, proxy /api tới backend 8801.

Giữ luồng tham chiếu code → token → ID token claims, bổ sung state gắn browser và GETDEL, nonce/issuer/audience/exp/chữ ký/JWKS, PKCE, cookie HttpOnly/Secure theo origin, Origin/CSRF cho POST và no-store. Không trả token IdP về Web. Profile trong RAM, UUID/máy lẻ theo Wazo. Redis namespace riêng, SQLite lưu liên kết issuer/sub/tenant với Wazo UUID, không lưu password/token.

Tạo mới qua Confd POST user gộp auth/line/extension/SIP, password test 12345 theo yêu cầu, số ngẫu nhiên còn trống trong dải cấu hình, context internal và template global/webrtc được xác minh trên server, SIP secret riêng. Email đã có không tự reset password; hỗ trợ opt-in thử password cấu hình hoặc báo cần liên kết. Chưa có federation/token exchange Wazo tự giả định.

Kiểm chứng: 14 test backend; 167 test frontend/16 file, lint/architecture/build/format. Health/proxy thật ok, callback HTML 200, guest profile 401. Chưa gọi IdP/Wazo công ty từ môi trường này. Cần điền credential cấp phát và tenant Wazo; IdP/Redis cục bộ lấy chọn lọc từ bản tham chiếu vào .env bị ignore. Hai file dán trong backend/doc giữ nguyên và được bỏ khỏi Git vì chứa secret.

Hướng dẫn chạy, biến môi trường, API và bảng test đầy đủ: xem [backend/README.md](../../backend/README.md). Từ handbook ở doc/ dùng đường dẫn ../backend/README.md.


20/11/2026: thêm importer cấu hình từ mẫu, 16/16 backend test đạt. Các kiểm tra frontend 167 test/lint/build/format trước đó không đổi vì không sửa frontend. Kiểm tra .env nạp đủ trường IdP/Redis, không in secret. Còn thiếu credential cấp phát/tenant Wazo và có thể CA PEM theo môi trường.
