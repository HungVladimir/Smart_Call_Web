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


## Host bị thu hồi phiên và cleanup nhóm — 21/11/2026

Logout giữ snapshot token SDK/conference ID/call ID trước khi vô hiệu phiên, gửi DELETE độc lập có timeout và không cập nhật state theo ACK muộn. Không dùng token mới trong storage. UI/cache/scope vẫn bị dọn ngay, SDK nhánh chính được hangup trước disconnect. Finalize trong logout không gửi REST lần hai.

Phiên mới chờ revokeOtherDeviceSessions trước kết nối SIP; nếu có session khác thì đọc calls của user, lấy bridges và thử DELETE adhoc bằng token mới trước revoke. Wazo xác minh user là host; 404 của bridge thường/nhóm tham gia được bỏ qua, không cúp nhánh người khác. Lỗi server hiển thị chưa xác nhận. Logout thành viên không giải tán nhóm.

Kiểm chứng: 172 test frontend/17 file, lint/architecture/build/format đạt; bản gốc 124 test/build. Có ca token cũ 401 nhưng token mới dọn nhóm trước revoke, ACK muộn không phục hồi phiên và cuộc gọi mới không bị dọn. Chưa thử Wazo thật. Hai máy Web phải cập nhật; client cũ/Android chưa tích hợp và mất mạng hoàn toàn cần phối hợp server để bảo đảm tuyệt đối. Race server đang tạo hội nghị chưa trả ID còn cần thử tổng đài, không khẳng định đã cover mọi tình huống offline.

Theo yêu cầu rõ ràng của người dùng ngày 21/11/2026, backend/.env được đưa lên Git (ngoại lệ thay hướng dẫn ignore trước đây); chứa credential thật và người đọc repo/lịch sử Git có thể lấy được. Chỉ file này được cho phép track, không đưa hai bản dán tham chiếu hoặc các mật khẩu dịch vụ khác lên Git. backend/main.py đang có thay đổi của người dùng được giữ nguyên và không stage trong commit này.


## Logout Single ID để đổi tài khoản — 21/11/2026

Callback có nút Đăng xuất Single ID / Đổi tài khoản. Nút đăng nhập chỉ có khi chưa có hồ sơ, không còn gây hiểu nhầm rằng login lại sẽ xóa phiên SSO. Khi đã vào /calls bằng Single ID, nút logout trên header cũng dùng luồng IdP này. Login mật khẩu vẫn logout Wazo như trước.

Backend lưu ID token đã xác minh trong Redis cùng thời hạn phiên để làm id_token_hint; GET user_info vẫn không trả token đó. POST /api/auth/idp-logout yêu cầu Origin/CSRF, tạo ticket cookie HttpOnly sống 60 giây và xóa phiên backend. Web dọn SDK rồi điều hướng cửa sổ tới GET /api/auth/idp-logout/continue. Endpoint GETDEL một lần trả 302 tới end_session_endpoint lấy từ discovery với id_token_hint và post_logout_redirect_uri, giống logic logout mẫu. Không dùng fetch để theo redirect logout tới IdP.

SMARTCALL_IDP_LOGOUT_REDIRECT được lấy từ ONEAI_IDP__LOGOUT_REDIRECT trong mẫu; mặc định origin + /logout. Đường dẫn này cần được IdP cho phép. Web /logout chuyển về /login. Phần router.isReady trước mount cũng được đưa vào source để không mất sửa khởi động callback khi lấy code mới.

Phiên tạo trước bản sửa chưa có id_token_hint: chọn Về trang đăng nhập rồi Single ID một lần để tạo phiên mới, sau đó bấm logout/đổi tài khoản. Thiếu end_session_endpoint hoặc handoff hết hạn sẽ hiện lỗi, không giả báo đã logout IdP. Việc IdP có hiển thị form mật khẩu sau logout còn phụ thuộc chính sách SSO tích hợp của máy chủ; cần thử trên hệ thống công ty.

Kiểm chứng: 18 test backend và 175 test frontend/17 file; lint, architecture, build và format đạt. Chưa gọi logout IdP thật. Giữ nguyên đoạn chạy uvicorn trực tiếp do người dùng thêm trong backend/main.py ở working tree, không đưa đoạn đó vào commit tính năng.


## Tenant cha/con, recurse và create_user — 21/11/2026

Đã đối chiếu dữ liệu Postman do người dùng cung cấp: tài khoản điện thoại và context internal thuộc tenant 0e9ab2d3-5a36-4c35-b1de-91e06ddde771. Context thật là ctx-lancompany-internal-45609ff7-078d-4513-ba32-2f89e8cf7bf5, user_ranges 1000–1999. backend/.env được cập nhật đúng các giá trị đó; credential đã có giữ nguyên.

recurse=false chỉ đọc tenant chọn bởi Wazo-Tenant (hoặc tenant mặc định của token nếu không có header). recurse=true thêm các tenant con mà token được phép nhìn thấy. Nó không cấp thêm ACL, không phải phân trang, không quyết định tenant nhận POST. Token admin có thể ở tenant cha, khác tenant chứa điện thoại; không nên mặc định gán metadata.tenant_uuid làm tenant cấp phát nếu user/context ở tenant con.

Backend phân biệt WAZO_TENANT_UUID (tenant cấp phát, luôn gửi header khi đọc/ghi Confd) và WAZO_AUTH_TENANT_UUID (tùy chọn lúc xin token; để trống dùng tenant mặc định của credential). Các API list user/context/template/extension gửi recurse=true và bỏ view=full theo kết quả máy chủ của người dùng. Khi chọn tài nguyên vẫn kiểm tra tenant_uuid nếu server trả trường này: không chọn context/template/user khác tenant; email chỉ tồn tại ngoài tenant báo WAZO_EMAIL_OTHER_TENANT thay vì tự tạo trùng.

create_user được viết rõ từng bước, thay các tên s/c/used/free/selected bằng biến có nghĩa, tách authentication_payload, sip_endpoint_payload, extension_payload, line_payload và create_user_payload. Trước khi POST kiểm tra context enabled, template UUID, số chưa dùng và phần giao giữa kho cấu hình với user_ranges. SIP password vẫn ngẫu nhiên riêng; password đăng nhập giữ cấu hình test do người dùng yêu cầu. Không retry POST mù.

Cấu hình xác nhận:
~~~dotenv
SMARTCALL_WAZO_TENANT_UUID=0e9ab2d3-5a36-4c35-b1de-91e06ddde771
SMARTCALL_WAZO_CONTEXT=ctx-lancompany-internal-45609ff7-078d-4513-ba32-2f89e8cf7bf5
SMARTCALL_WAZO_EXTENSION_MIN=1000
SMARTCALL_WAZO_EXTENSION_MAX=1999
SMARTCALL_WAZO_AUTH_TENANT_UUID=
~~~

Postman: lấy token bằng Basic Auth tài khoản cấp phát; đọc GET /api/confd/1.1/users hoặc /contexts với X-Auth-Token, Wazo-Tenant là tenant đích ở trên, Params recurse=true, limit=100, offset=0. Không dùng view=full. Có thể so sánh recurse=false/true với cùng header để thấy phạm vi tenant; token không có quyền tenant đích vẫn lỗi, recurse không vượt phân quyền. Nếu đổi Wazo-Tenant sang tenant cha thì POST vẫn tạo ở cha, dù GET đệ quy thấy context con; không dùng cấu hình đó để cấp user.

Kiểm chứng: 24/24 test backend, pip check đạt. Có regression query recurse/no full, auth tenant khác target, context/user khác tenant, giới hạn và hết user_ranges. Test dùng transport giả, chưa gọi Wazo thật. Frontend không thay đổi. Giữ nguyên backend/main.py của người dùng. Khi cập nhật máy công ty, giữ credential Wazo đã điền trong .env và áp dụng các dòng tenant/context/kho số trên, rồi khởi động lại backend.

Nguồn: https://raw.githubusercontent.com/wazo-platform/wazo-confd/master/wazo_confd/helpers/restful.py (_build_tenant_list và build_tenant).


## Username auth từ email cố định — 21/11/2026

Theo xác nhận của người dùng, email công ty là duy nhất và không thay đổi. Tài khoản Wazo tạo mới lấy phần trước @ của email làm auth.username, chuẩn hóa chữ thường và bỏ khoảng trắng đầu/cuối. Ví dụ vhung99.nguyen@samsung.com → vhung99.nguyen. Không dùng replace chuỗi samsung.com, không tự thêm hậu tố hoặc hash khi trùng username. Domain vẫn do kiểm tra email của OIDC và SMARTCALL_ALLOWED_EMAIL_DOMAINS kiểm soát; không thay đổi allowlist trong lượt này.

Mapping SQLite vẫn có khóa issuer/sub + tenant và lưu user_uuid/username thật. Tài khoản đã có mapping tiếp tục dùng username cũ sso_..., không tự đổi tên trên server. Khi khôi phục tài khoản SmartCall đã tồn tại nhưng mất mapping, đọc auth username thật theo UUID nếu danh sách Confd không trả auth; không đoán username mới từ email cho user cũ.

Username auth dùng cho xin token API Wazo, không phải máy lẻ. SIP vẫn có credential riêng như trước. Thay đổi quy tắc này chưa sửa hoặc xác nhận nguyên nhân lỗi SIP Unregistered đã báo. Tài khoản đã tạo không tự được cấp lại khi xóa trên Wazo: cơ chế phục hồi mapping 404 là vấn đề riêng còn tồn đọng.

Nếu POST tạo user trả 409, backend báo WAZO_CREATE_CONFLICT, yêu cầu kiểm tra username/auth còn sót hoặc máy lẻ trùng. Không tự liên kết chỉ vì username trùng, không reset mật khẩu, không đổi sang username có hậu tố; kiểm tra uniqueness cuối cùng do Wazo thực thi, kể cả khi có công cụ khác tạo đồng thời.

Kiểm chứng: 29/29 test backend, pip check và git diff --check đạt. Có kiểm thử local-part chứa dấu chấm/số, username legacy trong mapping, khôi phục username cũ khi thiếu inline auth, email sai và xung đột tạo user. Chưa gọi Wazo thật. Frontend không thay đổi; giữ nguyên phần backend/main.py do người dùng tự sửa.


## SIP endpoint, reconnect và công cụ mapping — 21/11/2026

Payload tạo mới thêm endpoint_sip.name = SIP auth username để SDK dùng SIP URI nhất quán với tên endpoint. Tài khoản managed cũ được đọc endpoint chính dạng merged; chỉ PUT name nếu đang lệch, không đổi password/template. Chưa xác minh REGISTER trên Wazo công ty nên không coi giả thuyết tên endpoint là nguyên nhân duy nhất đã chứng minh.

Frontend gộp nhiều UNREGISTERED thành một task reconnect, hủy timer/quyền tiếp tục khi REGISTERED hoặc disconnect/logout, kiểm tra context trước khi dùng kết quả health check. Chặn quay số khi SIP chưa registered hoặc vừa mất đăng ký trong lúc tra cứu; không phát ringback/SDK call trong trường hợp đó. Log tạo SIP session chỉ là INFO đang chờ phản hồi, không báo tổng đài đã chấp nhận.

Mapping có UUID trả 404 được tìm lại qua email rồi tạo nếu cần. Chỉ thay liên kết sau khi đã có user/username hợp lệ; SQLite kiểm tra UUID cũ trong UPDATE để không ghi đè concurrent edit. Lỗi 401/403/timeout vẫn dừng. Không tự xóa tài khoản auth hoặc tài nguyên còn sót trên Wazo.

Công cụ backend/manage_identity_db.py hỗ trợ list/add/delete, đọc đúng Settings.database_path, lọc tenant/username, hiển thị issuer/sub riêng; INSERT không ghi đè và DELETE có tenant+UUID. Tự backup bằng SQLite API trước ghi. Công cụ chỉ chỉnh DB, không gọi API Wazo/IdP/Redis; cần dừng backend khi sửa để test. Xem backend/IDENTITY_DB_GUIDE.md để biết lệnh đầy đủ và ý nghĩa managed.

Kiểm chứng: 38/38 test backend, 178/178 test frontend (17 file), lint/architecture/build/format:check/pip check đạt. Có test CAS SQLite, khôi phục UUID 404, lỗi 403 không tạo lại, payload name và sửa endpoint legacy không sửa credential, CLI backup/unique/delete đúng tenant, reconnect gộp/hủy/health trả muộn và SIP_NOT_READY. Build còn cảnh báo chunk lớn đã có. Không gọi server thật; giữ nguyên backend/main.py do người dùng tự sửa.


## Department và avatar Single ID dùng chung — 21/11/2026

Department cũ chỉ có trong hồ sơ phiên, không được nối vào contact.dept từ Dird nên bộ lọc không có dữ liệu đúng. Đã bổ sung bảng directory_profiles trong SQLite, lưu tên/department/EP ID từ phiên IdP sau liên kết Wazo thành công; API danh bạ chỉ trả tên/department/has_avatar theo UUID trong tenant. ContactService ghép theo lô 100 UUID, bỏ marker SSO khỏi fallback department; chuẩn hóa tên phòng ban và sửa bộ đếm all.

Avatar được proxy qua backend từ employee_photo_url với epid lấy từ DB. User đọc phải có token Wazo hợp lệ đúng tenant; API danh bạ không trả EP ID, route ảnh chỉ nhận UUID. Không chuyển credential/cookie sang host ảnh, không theo redirect, giới hạn ảnh 2 MB; lỗi quay về chữ viết tắt. Component EmployeeAvatar nhận loader ở main.js qua provide/inject; service quản lý lazy request, cache và thu hồi ObjectURL theo phiên. Áp dụng header/danh bạ/cuộc gọi/tin nhắn, giữ icon nhóm.

Điều kiện chia sẻ: các Web dùng chung backend/database, user có hồ sơ sau ít nhất một lần đăng nhập Single ID mới. Backend localhost/SQLite riêng không tự chia sẻ; Android/Web cũ chưa sử dụng API thì chưa tự có avatar. Nguồn ảnh cần truy cập được từ backend, chưa có cơ chế đăng nhập riêng vào nguồn ảnh. Hướng dẫn/route/test chi tiết: backend/EMPLOYEE_PROFILES_GUIDE.md.

Kiểm chứng: 45 test backend, 187 test frontend/19 file; lint, architecture, build, format:check và pip check đạt. Chưa gọi URL ảnh nhân viên thật hoặc kiểm chứng bằng browser trên mạng công ty. Giữ nguyên phần chạy uvicorn trực tiếp do người dùng thêm ở cuối backend/main.py trong working tree, không đưa phần đó vào commit này.
