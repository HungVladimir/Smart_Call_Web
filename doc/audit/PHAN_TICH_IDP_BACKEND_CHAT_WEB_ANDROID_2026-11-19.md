# Tổng hợp phân tích SmartCall: IdP, backend Python và chat Web–Android

Ngày: 19/11/2026, múi giờ Asia/Saigon.

## 1. Phạm vi, quyền thực hiện và trạng thái

- Người dùng cho phép tạo file Markdown mới để tổng hợp phân tích; không cho phép sửa file đã có.
- Báo cáo này là tài liệu mới. Không triển khai backend, không sửa Web/Android, không cài package, không gọi API IdP/Wazo hoặc truy cập database production.
- Yêu cầu ban đầu là full repository audit với hai vòng đánh giá. Trong quá trình làm, người dùng bổ sung nhiệm vụ phân tích `FileQuest/quest.txt`, sau đó cung cấp các xác nhận mới. Tài liệu này tổng hợp kết quả nghiên cứu và hướng triển khai; chưa phải chứng nhận hoàn thành full audit hai vòng.
- Theo cập nhật mới nhất của người dùng, tạm gác vấn đề logout vì hiện tại kiểm thử không còn gặp lỗi. Các phân tích logout trước đó được lưu như giả thuyết/bằng chứng lịch sử, không coi là lỗi production đang tái hiện.
- Không chép lại thông tin cá nhân, email thực, token, cookie, mật khẩu hoặc assertion SSO trong tài liệu.

## 2. Các thông tin người dùng đã xác nhận

| Chủ đề | Xác nhận | Hệ quả triển khai |
|---|---|---|
| SingleIdAuth | Chưa có tài liệu tích hợp; sau này sẽ có dự án mẫu và các phương thức kết nối IdP | Chưa chốt giao thức hay tự xây endpoint đăng nhập theo phỏng đoán |
| Backend | Hiện đội Web được giao Python + SQLite; Android có thể gọi backend này khi Web làm ổn | Thiết kế API dùng chung ngay từ đầu, chưa mặc định Android đã cam kết lịch chuyển đổi |
| Liên kết Wazo–IdP | Chưa xác định người phụ trách; người dùng dự đoán không thuộc phần việc của mình | Ghi thành dependency cần giao rõ, không tự nhận provisioning/cấu hình SSO |
| Logout | Tạm bỏ qua | Không ưu tiên sửa, không tuyên bố đã tái hiện hoặc đã khắc phục |
| Mã Android | Người dùng chỉ dẫn bộ SMCApp và codeApp | Đối chiếu bộ file thực tế, không suy đoán từ mô tả gọi nhóm |
| Quyền ghi file | Cho phép tạo `.md` mới | Chỉ tạo báo cáo mới, không cập nhật tài liệu cũ |

Các tài liệu cũ yêu cầu mọi nghiệp vụ đi qua Wazo. Yêu cầu mới cho backend chat riêng là thay đổi định hướng do người dùng đưa ra. Khi được triển khai, cần một quyết định kiến trúc mới và hợp đồng API chung; không ép thiết kế mới phải giữ nguyên toàn bộ giả định chat Wazo cũ.

## 3. Bản đồ repository và công nghệ

Tech stack khai báo: Vue 3, JavaScript, Composition API với `<script setup>`, Vite, Vue Router, `@wazo/sdk`. Không thấy Pinia/Vuex, TypeScript hoặc UI library trong dependencies trực tiếp. Trạng thái tập trung chủ yếu dùng service singleton, `reactive(callStore)` và `reactive(recordStore)`; các service còn có state thường và phát sự kiện `window`.

Phiên bản trong lockfile tại lần kiểm tra: Vue 3.5.45, Vue Router 5.5.0, Vite 8.3.8, Wazo SDK 0.49.11. Phiên bản này khác một số tài liệu kiến trúc cũ ghi Vite 5/Router 4.

| Module | Vai trò | Phạm vi đã đọc |
|---|---|---|
| `src/main.js`, `src/App.vue` | Bootstrap, layout, KeepAlive, modal toàn cục, sự kiện đăng nhập | Logic khởi tạo và điều phối |
| `src/router/index.js`, `src/config/features.js` | Route, guard UI, feature flags | Đọc cấu hình và guard |
| `src/services/wazo.js` | Auth, refresh, presence, SIP, cuộc gọi đơn/nhóm | Truy vết luồng chính và các nhánh kết thúc/async |
| `contactService.js` | Danh bạ, favorites, chuẩn hóa presence | Đọc các phương thức và cách UI tiêu thụ |
| `chatService.js` | Phòng, tin, tag hệ thống, thành viên, ghim | Truy vết gửi/nhận, tải lịch sử và chuyển phòng |
| `historyService.js`, `recordService.js` | CDR, ghi âm máy chủ, phát lại | Đọc và kiểm tra các nhánh trạng thái/lỗi |
| `audioService.js`, `websocketService.js`, `loggerService.js` | Âm báo, event hub, log | Đọc implementation |
| Bốn view và các component dùng chung | UI, lifecycle, watcher, form | Đọc phần script; kiểm tra template theo hành vi, không kiểm định mọi CSS/pixel |
| `FileQuest/CodeAndroid` | Bản xuất mã tham chiếu Android | Tập trung auth/presence và toàn bộ chuỗi hiển thị chat liên quan |

Backend/database của SmartCall mới chưa có trong mã ứng dụng đã khảo sát. Wazo là backend bên ngoài. Không dùng các file mẫu trong FileQuest làm bằng chứng rằng backend Python mới đã được xây.

Luồng hiện tại: Vue → services → Wazo REST/SDK/WebSocket → service state → UI. Thoại dùng SIP/WebRTC; chat dùng Wazo Chatd; CDR dùng Call-logd; ghi âm điều khiển qua Calld.

## 4. Tài liệu và mức độ áp dụng

Đã lập inventory Markdown bằng tìm kiếm cả file bị ignore và thư mục ẩn, loại dependencies/build output. Không tìm thấy AGENTS.md trong kết quả khảo sát repository. Inventory dưới ghi rõ mức độ đọc, không tuyên bố đọc toàn bộ từng dòng của mọi tài liệu.

| Tài liệu | Mục đích / trạng thái | Cách sử dụng trong phân tích |
|---|---|---|
| `GEMINI.md` | Quy tắc phát triển hiện có | Đã đọc; yêu cầu mới của người dùng có ưu tiên khi thay đổi hướng backend |
| `doc/README.md` | README template Vue/Vite | Đã đọc; chưa phải hướng dẫn vận hành SmartCall đầy đủ |
| `doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md` | Nhật ký nhiều giai đoạn đến bước 74 | Khảo sát mục lục, đọc chọn các mục liên quan; có phần cũ đã bị hướng mới thay thế |
| `doc/KIEN_TRUC_VA_LUONG_HOAT_DONG_CHI_TIET.md` | Giải thích kiến trúc | Đối chiếu chọn lọc; có mô tả cache/localStorage cũ |
| `doc/GIAI_THICH_CHI_TIET_SERVICES.md` | Giải thích services | Đọc chọn lọc và đối chiếu; số phương thức, vị trí code và một số hành vi đã cũ |
| `doc/GIAI_THICH_CHI_TIET_VIEWS.md` | Giải thích views | Đọc chọn lọc; một số query, timer, thiết bị audio khác implementation |
| `doc/BAO_CAO_RA_SOAT_CODEBASE_ONBOARDING.md` | Báo cáo onboarding và quick wins | Đã đọc; không dùng kết quả build cũ thay cho xác minh hiện tại |
| `doc/SMARTCALL_EXPERT_AUDIT_REPORT.md` | Báo cáo audit trước | Đọc tham khảo; nhiều đường dẫn thuộc bản Mock, phải kiểm chứng lại |
| `doc/SMART_CALL_WEB_ANALYSIS_AND_ROADMAP.md` | Roadmap lịch sử | Đọc chọn lọc; gồm giai đoạn mock/DB nhân sự dự kiến |
| `doc/TONG_HOP_TOAN_BO_API_DA_CALL.md` | Danh mục API | Đối chiếu theo luồng; không mặc định danh mục cũ còn đầy đủ |
| `doc/WAZO_API_REFERENCE.md` | Danh mục REST theo phiên bản | Đọc các phần auth/SAML, Chatd, Dird, Calld và Call-logd |
| `doc/walkthrough.md` | Hướng dẫn công cụ Antigravity | Đã đọc; không phải business specification |
| `FileQuest/dev_guide.md` | Hướng dẫn Wazo nội bộ | Đọc chọn các phần tích hợp; tài liệu tự ghi có endpoint cần kiểm tra spec |
| `FileQuest/wazo_api_reference.md` | Bản tham chiếu API | Inventory và tra cứu theo nội dung liên quan; chưa đọc toàn bộ từng dòng |
| `specs/architecture/plan.md` | Kế hoạch kiến trúc ngày 15/11, ghi chờ phê duyệt | Đã đọc; không coi các mục “đạt 100%” là bằng chứng kiểm thử |

Các bản xuất mã tham chiếu, ảnh UI và mã Android ngoài luồng được xem là tài liệu hỗ trợ. Chưa audit toàn bộ Android như một project Gradle có thể build.

## 5. Kiểm tra lại bộ mã Android người dùng chỉ định

### 5.1 File thực tế

Tìm thấy:

- `FileQuest/CodeAndroid/SMCAppV2.txt`: bản tóm tắt giao thức gọi nhóm.
- `FileQuest/CodeAndroid/codeApp1.py`: bản xuất nhiều lớp, gồm SessionManager, DTO, ApiClient, WazoApiService, model ChatMessage và phần service.
- `FileQuest/CodeAndroid/codeApp2.py`: phần tiếp theo của logic SIP/gọi nhóm và picker.
- `FileQuest/CodeAndroid/codeApp3.py`: các Activity/Fragment/Adapter, gồm ChatDetailActivity và MessageAdapter.
- `FileQuest/CodeAndroid/codeApp4.py`: lịch sử, MainActivity, Application và phần cấu hình/resource.
- Các bản riêng `WazoSipCallManager.py`, `LoginACtivity.py`, `wazoApiService.py`, `InCallActivity.py`.

Không tìm thấy file tên `SMCApp2` hoặc `codeApp5` trong inventory hiện có. Không giả định nội dung của file chưa có. Dù đuôi là `.py`, các đoạn được đối chiếu ở đây là Java/XML xuất ra văn bản, không phải backend Python.

### 5.2 Kết luận về raw text — CONFIRMED trong mã tham chiếu

Chuỗi thực thi Android:

1. `codeApp1.py:1227`: GET lịch sử tin từ Wazo Chatd.
2. `codeApp3.py:722`: lấy nguyên trường `content`.
3. `codeApp3.py:733`: tạo `ChatMessage(content, ...)`.
4. `codeApp1.py:377`: ChatMessage chỉ có content, senderName, timestamp, isSentByMe.
5. `codeApp3.py:2339`: `holder.bubble.setText(message.content)`.

Nhánh nhận realtime tại `codeApp3.py:613` cũng đưa nguyên content vào ChatMessage ở dòng 621.

Ở Web, `src/services/chatService.js:104` xử lý `[SYSTEM:ROOM_CLOSED...]`; dòng 122 xử lý `[SYSTEM:MSG_DELETED...]`; dòng 193 phân tích `[FWD:...]`; dòng 204 xử lý đổi tên phòng. Các tag nằm trong nội dung thật được lưu/gửi qua Chatd.

Tìm kiếm trong bộ Android đã cung cấp không thấy bộ phân tích các tag chat này. Vì vậy raw text là kết quả có thể giải thích trực tiếp từ code. Đây là quy ước nhúng metadata/lệnh vào text, không phải mã hóa mật mã và không cần “giải mã” bằng khóa.

Phạm vi xác nhận: implementation trong bản xuất mã. Chưa chạy APK để xác minh phiên bản nhị phân đang dùng trùng bản này.

### 5.3 Phần gọi nhóm ổn không đồng nghĩa chat đã đầy đủ

`SMCAppV2.txt` chủ yếu mô tả Calld/Chatd presence/WebRTC và các thẻ `[GROUP]`, `[ADD_REQ]`, `[NOTICE]`, `[LEFT]`. Đó là giao thức gọi nhóm qua presence, khác các tag nghiệp vụ tin nhắn `[SYSTEM]` và `[FWD]`.

Những phần còn hạn chế trong bản xuất mã chat:

| Bằng chứng | Kết luận | Confidence / giới hạn |
|---|---|---|
| `codeApp3.py:1180`: listener nút tạo nhóm rỗng | Nút này chưa thực hiện tạo nhóm trong đoạn mã cung cấp | CONFIRMED trong source tham chiếu |
| `codeApp3.py:605`: listener chi tiết phòng rỗng | Chưa có nghiệp vụ chi tiết/thành viên tại nút này | CONFIRMED trong source tham chiếu |
| `codeApp1.py:26–47`: WazoWebSocketManager chỉ giữ listener, không có kết nối hay gọi callback | Chưa thấy đường cấp dữ liệu realtime cho listener chat; tìm kiếm toàn bộ CodeAndroid không thấy nơi gọi onNewChatMessage | NEEDS VERIFICATION: bản xuất mã có thể thiếu phần triển khai |
| `codeApp3.py:767`, 778–793: thêm tin trước HTTP, lỗi chỉ toast | Tin hiển thị optimistic không được đánh dấu lỗi hoặc rollback theo đoạn mã | CONFIRMED trong source tham chiếu |
| `codeApp3.py:731`: substring(0,19) trên chuỗi thời gian | Thiếu/rút ngắn created_at có thể gây StringIndexOutOfBoundsException | LIKELY BUG theo dữ liệu đầu vào; chưa reproduce APK |

Không kết luận toàn bộ app không hoạt động. Cần phân biệt độ ổn định của gọi nhóm, mức đầy đủ của chat và khả năng thiếu đoạn trong bản export.

## 6. SingleIdAuth: điều đã biết và điều đang chờ

### 6.1 Không chốt giao thức từ URL quan sát

Đường dẫn SSO được người dùng mô tả gợi ý SAML, nhưng chưa có hợp đồng chính thức. `userinfo.js` là dữ liệu quan sát trong một ứng dụng khác, chưa chứng minh là API được cấp cho SmartCall.

Không sao chép cookie của ứng dụng khác; không nhúng tài khoản/mật khẩu công ty; không tin JSON do browser tự gửi lên để cấp phiên. Ứng dụng SmartCall cần đăng ký và xác minh kết quả qua phương thức chính thức của SingleIdAuth.

Khi có dự án mẫu, cần đọc và xác định:

1. Giao thức/SDK, phiên bản và môi trường hỗ trợ.
2. Cách đăng ký ứng dụng, callback/ACS, issuer/audience hoặc client ID.
3. Cách xác minh phản hồi/token, chống replay và liên kết request–callback.
4. Thuộc tính danh tính ổn định, email đã xác thực, tên/phòng ban và trạng thái tài khoản.
5. Thời hạn phiên, refresh, logout và xử lý lỗi mạng.
6. Cách backend Python được phép nhận và kiểm tra danh tính.
7. Cách Web và Android sử dụng cùng hệ thống sau này.

### 6.2 Tách ba lớp danh tính

| Lớp | Vai trò |
|---|---|
| IdP công ty | Xác thực con người và cấp thuộc tính được cho phép |
| SmartCall | User ID nội bộ, phiên ứng dụng, quyền chat và liên kết tài khoản |
| Wazo | Wazo user UUID, máy lẻ, quyền và phiên thoại |

Email có thể dùng để đối chiếu ban đầu nếu duy nhất và đáng tin cậy; không mặc định bất biến. Ưu tiên khóa SSO ổn định được nhà cung cấp cam kết, ví dụ subject/NameID bền vững hoặc mã nhân sự. Không dùng email do client nhập để tự liên kết.

Đề xuất mapping: `(identity_provider, external_subject) → smartcall_user_id → wazo_user_uuid`. Email là thuộc tính có kiểm soát, không phải bằng chứng xác thực.

Trường tên lấy từ Wazo là yêu cầu người dùng đang dự kiến. Cần xác nhận ai đổ dữ liệu thật vào Wazo và nguồn nào quyết định khi tên/phòng ban khác nhau. Không mặc định Wazo hiện chứa danh mục nhân sự chuẩn.

### 6.3 Nhận đúng danh tính chưa đủ để có phiên thoại

Backend không thể tự đổi một email thành Wazo token nếu chưa có cơ chế được Wazo hỗ trợ và được cấp quyền.

Tài liệu `doc/WAZO_API_REFERENCE.md:83` có cấu hình SAML, dòng 198 có luồng SAML auth. SDK đang cài có `initiateIdpAuthentication` và `samlLogIn`. Đây là khả năng cần đội hạ tầng đánh giá, không chứng minh server hiện đã cấu hình hoặc được phép kết nối IdP công ty.

Người chịu trách nhiệm cấu hình Wazo–IdP/provisioning là dependency chưa giao rõ. Có thể thiết kế mapping và error contract trước; chưa thể chứng minh luồng SSO→thoại hoàn chỉnh trước khi dependency này được giải quyết.

## 7. Kiến trúc backend đề xuất

```text
Web Vue ───────┐
              ├── HTTPS REST + realtime ── Backend Python ── SQLite
Android sau ──┘                               │
                                             ├── Adapter SingleIdAuth chính thức
                                             └── Mapping/tích hợp Wazo được cấp quyền

Web/Android ── SIP/WebRTC theo cơ chế Wazo được hỗ trợ ── Wazo/Asterisk
```

Python backend quản lý user/mapping, phiên ứng dụng, quyền, phòng, thành viên, tin nhắn và realtime. Wazo tiếp tục xử lý thoại/hội nghị/CDR/ghi âm theo phạm vi hiện tại. Không đưa luồng âm thanh WebRTC qua Python chỉ vì có backend chat mới.

FastAPI là lựa chọn phù hợp để đánh giá, chưa cài đặt hay chốt framework. Có thể dùng ORM và migration có quản lý phiên bản. Không tạo mock production identity trước khi có adapter SingleIdAuth thật.

### 7.1 SQLite

SQLite phù hợp để đánh giá giai đoạn đầu một máy chủ, ổ đĩa cục bộ, tải ghi vừa phải. Cần bật foreign keys trên mỗi connection, transaction ngắn, unique constraints/index, busy timeout phù hợp, migration và backup có kiểm tra phục hồi. WAL có thể cải thiện read/write concurrency nhưng vẫn chỉ một writer tại một thời điểm.

Không dùng database file chung trên network share để giả lập nhiều máy chủ cùng ghi. Khi có yêu cầu nhiều backend host hoặc tải ghi lớn, đánh giá PostgreSQL. Chưa có số người dùng/tin nhắn để khẳng định SQLite đáp ứng production.

### 7.2 Schema nghiệp vụ tối thiểu đề xuất

| Nhóm dữ liệu | Nội dung |
|---|---|
| users | ID nội bộ, trạng thái, thuộc tính hồ sơ cần thiết |
| external_identities | provider, subject duy nhất, user_id |
| wazo_mappings | user_id, Wazo UUID, máy lẻ, trạng thái cấp thoại |
| sessions | user_id, phiên, thời hạn, trạng thái thu hồi theo hợp đồng auth |
| rooms | direct/group, tên, trạng thái, người tạo |
| room_members | user_id, room_id, role, thời điểm tham gia/rời |
| messages | ID, room_id, sender_id, loại, nội dung, thời gian máy chủ, trạng thái xóa |
| read_positions | mốc tin đã đọc của từng thành viên |
| pinned_messages | quan hệ ghim gắn với tin nhắn |

Cần unique idempotency key để retry gửi tin không tạo bản ghi trùng. Không cấp role từ người gửi tin đầu tiên trong một trang lịch sử. Backend phải xác định sender từ phiên và kiểm tra quyền, không tin sender/role do client khai báo.

## 8. Hợp đồng API chat dùng chung

Endpoint dưới là đề xuất thiết kế, chưa được triển khai:

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/me` | Danh tính/hồ sơ/khả năng thoại hiện tại |
| GET, POST | `/api/rooms` | Danh sách/tạo phòng |
| GET | `/api/rooms/{id}/messages?cursor=...` | Phân trang lịch sử |
| POST | `/api/rooms/{id}/messages` | Gửi có client_message_id |
| DELETE | `/api/messages/{id}` | Xóa theo chính sách quyền/retention |
| PATCH | `/api/rooms/{id}` | Đổi tên/trạng thái có kiểm tra quyền |
| POST, DELETE | `/api/rooms/{id}/members/...` | Quản lý thành viên |
| POST | `/api/rooms/{id}/read` | Mốc đã đọc |

Event chung có version, event_id/cursor, type và payload có cấu trúc: `message.created`, `message.deleted`, `room.updated`, `room.member_removed`. Định nghĩa replay/resync khi reconnect; giới hạn người nhận theo quyền hiện tại. REST cập nhật database, realtime thông báo thay đổi sau khi commit; cần cơ chế phát lại hoặc đồng bộ bù nếu phát event thất bại.

Phải định nghĩa rõ “đã gửi” là backend nhận bền vững, “đã nhận” là thiết bị nhận xác nhận, “đã xem” là read marker. Online không chứng minh đã nhận/đọc.

Với phiên Web, đánh giá cookie HttpOnly/Secure và biện pháp CSRF phù hợp; Android dùng cơ chế phiên/token theo hợp đồng chung. Các lựa chọn cụ thể phụ thuộc dự án mẫu và topology deployment, chưa chốt bằng giả định.

## 9. Thay đổi nghiệp vụ so với chat hiện tại

| Hiện tại | Định hướng mới |
|---|---|
| Nhúng `[SYSTEM]` và `[FWD]` trong content | Payload/event có type, metadata riêng |
| Xóa bằng tag để Web tự ẩn | Backend kiểm tra quyền và cập nhật trạng thái tin |
| Đóng nhóm bằng tag | Trạng thái room có hiệu lực phía server |
| Đổi thành viên bằng tạo phòng mới | Giữ room_id và cập nhật membership theo chính sách |
| Chuyển tiếp tối đa 25 tin khi tái tạo nhóm | Giữ lịch sử gốc; quyết định quyền truy cập của thành viên mới/rời nhóm |
| Ghim trong RAM tại `chatService.js:1480` | Lưu quan hệ ghim phía server |
| Mỗi nền tảng suy đoán trạng thái hiển thị | Schema, trạng thái và quyền chung |

Không triển khai dual-write Web sang SQLite và Android sang Wazo Chatd mà không có thiết kế đồng bộ. Nếu chỉ Web chuyển đổi, cần quy định rõ giai đoạn thí điểm chưa liên thông, hoặc xây adapter chuyển tiếp có xử lý ID, retry và dedup. Hướng ưu tiên là thống nhất hợp đồng và lịch chuyển đổi hai nền tảng.

Chính sách cần chốt: dữ liệu cũ chuyển toàn bộ, chỉ đọc qua hệ thống cũ hay bắt đầu lịch sử mới; xóa cho mọi người hay chỉ ẩn cá nhân; retention/audit; quyền xem lịch sử trước khi tham gia; quyền truy cập sau khi rời nhóm. Không mặc định xóa UI là xóa vật lý database.

## 10. Lưu vết phân tích logout — tạm gác

Không có lỗi logout đang được người dùng xác nhận tái hiện. Không tiếp tục sửa hoặc ưu tiên mảng này.

Các quan sát lịch sử đã có:

- Web phát `smartcall-web-...`; nhánh conflict ở `codeApp2.py:276` chỉ nhận `smartcall-android-...`.
- Thu hồi session và refresh token là thao tác bất đồng bộ nhiều bước; cần kiểm chứng race trên server nếu vấn đề quay lại.
- Token đặt ở localStorage, client ID ở sessionStorage có thể tạo vấn đề khi nhiều tab cùng origin; chưa xác nhận topology của case đã mô tả.
- Presence có định danh thiết bị khác chưa đủ chứng minh đó là lần đăng nhập mới hơn. Cần nguồn quyết định phiên phía server.
- Mất mạng không tự xóa localStorage/sessionStorage. Chưa có bằng chứng token tự null vì mất mạng.

Nếu tái điều tra, lấy trace đã che thông tin nhạy cảm: client/session ID, mốc thời gian, loại event, mã HTTP và nguyên nhân kick. Không cần gửi token/cookie/mật khẩu. Thiết bị offline không thể nhận lệnh tức thì; điều cần bảo đảm là server từ chối phiên cũ và client xác minh khi trở lại.

## 11. Lưu vết audit trước và giới hạn snapshot

Đã thực hiện kiểm tra cú pháp/compile trong bộ nhớ đối với 10 Vue SFC và 11 JS module, không ghi output, không chạy ứng dụng: không có lỗi tại snapshot kiểm tra. Đã đối chiếu mã SDK đang cài ở các hành vi liên quan disconnect/listeners và auth.

Đã chạy harness Node VM cô lập với storage/network/SDK giả lập trong RAM để kiểm tra một số nhánh logic tại snapshot trước: lỗi gửi chat, response sau reset, listener, session kết thúc không khớp, secondary call, merge thất bại, stop recording HTTP lỗi, lưu settings trước khi load và computed trên field thường. Không gửi mạng hay khởi tạo SDK thật; không tạo test file.

Trong quá trình đọc, nội dung một số file nguồn đã khác snapshot kiểm tra trước, ví dụ nhánh lỗi sendMessage hiện đặt `Lỗi gửi` và `sendFailed=true`, logic admin và bảo vệ session cũng có thay đổi. Các thay đổi này không do lượt phân tích này thực hiện. Vì vậy:

- Không mang kết quả harness snapshot cũ sang tuyên bố lỗi hiện tại còn tồn tại.
- Chưa khẳng định các thay đổi mới đã sửa đầy đủ mọi tương tác xuyên module.
- Muốn chốt full audit cần cố định revision/snapshot, đọc lại coverage còn thiếu và kiểm chứng vòng hai trên cùng snapshot.

Không chạy `npm run build` vì tạo dist và có thể cache; không chạy formatter/install. Không thấy script test/lint/typecheck trong package.json. Chưa có kết quả E2E Web–Android/IdP/Wazo, benchmark tải, kiểm thử APK hoặc production ACL. Tài liệu build thành công trước đây không thay cho kiểm thử nghiệp vụ.

Các nhóm vấn đề cần audit tiếp khi quay lại nhiệm vụ full audit: lifecycle/reset giữa user, request cũ sau chuyển route/phiên, idempotency submit, trạng thái ghi âm khi HTTP thất bại, settings ghi dịch vụ khi dữ liệu chưa load, reactivity của field thường trong singleton, phân trang và đồng bộ chat. Đây là checklist xác minh, không phải toàn bộ findings đã chốt.

## 12. Lộ trình và điều kiện hoàn thành

### Giai đoạn 1 — Chuẩn bị trước khi có mẫu IdP

- Chốt trách nhiệm backend Web, Android consumer, đội IdP và quản trị Wazo.
- Chốt phạm vi MVP, source of truth cho hồ sơ, quyền chat và chính sách dữ liệu cũ.
- Thiết kế OpenAPI/schema/event/error contract dùng chung; các endpoint auth cụ thể chờ hợp đồng SingleIdAuth.
- Ghi rõ yêu cầu tải và mô hình vận hành để đánh giá SQLite.

### Giai đoạn 2 — Khi nhận dự án mẫu SingleIdAuth

- Đọc luồng request/callback, session, hồ sơ và xử lý lỗi của mẫu.
- Xác minh một tài khoản thật trên môi trường thử được phê duyệt.
- Chốt external subject và quy tắc mapping duy nhất.
- Xác minh riêng cách có phiên thoại Wazo. Không đánh dấu SSO end-to-end hoàn thành nếu mới lấy được hồ sơ.

### Giai đoạn 3 — Backend chat và Web consumer

- Triển khai migration, auth adapter, quyền và nghiệp vụ transaction.
- REST + realtime, idempotency, pagination, read marker, retry và resync.
- Web dùng API mới; thông báo lỗi phản ánh đúng kết quả server.
- Duy trì ranh giới với các nghiệp vụ thoại đang dùng Wazo.

### Giai đoạn 4 — Android và chuyển đổi

- Android triển khai cùng contract, không tự suy đoán các tag text của Web.
- Kiểm thử Web gửi–Android nhận và ngược lại, xóa/ghim/đổi thành viên và reconnect.
- Chọn phương án chuyển lịch sử, rollback và thời điểm ngừng ghi Chatd cũ.

### Test nghiệm thu tối thiểu

1. Danh tính không hợp lệ/hết hạn/replay không tạo phiên SmartCall.
2. Email trùng hoặc chưa có mapping không liên kết nhầm Wazo.
3. Đăng nhập được nhưng chưa có quyền thoại trả trạng thái rõ ràng.
4. Retry cùng client_message_id tạo đúng một tin, kể cả sau timeout.
5. Thành viên không có quyền không đọc/gửi/xóa dữ liệu phòng khác.
6. Xóa/đổi tên/ghim/thành viên đồng nhất trên Web và Android.
7. Mất mạng rồi reconnect lấy bù tin và không nhân đôi.
8. Đổi tài khoản khi request cũ còn chạy không lộ dữ liệu.
9. HTTP 4xx/5xx không hiển thị thao tác thành công.
10. Backup SQLite phục hồi được dữ liệu và ràng buộc, kiểm thử tải với quy mô mục tiêu.

## 13. Những câu hỏi còn mở

- Khi có dự án mẫu: SingleIdAuth dùng giao thức nào và backend Python được tích hợp bằng phương thức nào?
- Ai chịu trách nhiệm đăng ký ứng dụng IdP, cấu hình Wazo, cấp tài khoản thật và mapping?
- Android có cam kết dùng API chung; thời điểm và phạm vi chức năng nào?
- Số người dùng đồng thời, lượng tin/ngày, số backend worker/host, thời hạn lưu và quy trình backup?
- Nguồn hồ sơ chuẩn, khóa danh tính ổn định và quyền xem avatar/nhân sự?
- Lịch sử Wazo Chatd được chuyển, giữ chỉ đọc hay không đưa vào hệ thống mới?

Các câu hỏi này chưa chặn việc thiết kế hợp đồng và chuẩn bị kiến trúc, nhưng chặn việc khẳng định SSO/thoại đã tích hợp thành công hoặc SQLite đã đủ cho tải production.

## 14. Kết luận hiện hành

Có cơ sở trực tiếp để giải thích raw text: Android render content nguyên bản, Web diễn giải các tag riêng. Bản tóm tắt gọi nhóm không phải đặc tả chat liên nền tảng.

Hướng triển khai đề xuất là backend Python quản lý danh tính ứng dụng, mapping, quyền và chat; Wazo giữ vai trò thoại. Chờ dự án mẫu để chốt adapter SingleIdAuth. API thiết kế cho cả Web và Android, kèm quyết định chuyển đổi dữ liệu rõ ràng. Phần logout tạm gác theo yêu cầu người dùng; full audit hai vòng chưa được tuyên bố hoàn thành.
