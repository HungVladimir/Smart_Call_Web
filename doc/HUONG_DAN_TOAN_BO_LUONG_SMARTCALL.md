# SmartCall Web — lần theo tất cả luồng từ giao diện tới máy chủ

Bản refactor `codex/refactor-architecture`, mốc `cdb7e2d`. Đọc các đoạn code cùng phần diễn giải bên dưới để biết lệnh đi đâu, kết quả quay về đâu và vì sao giao diện thay đổi. Các ví dụ JSON dùng dữ liệu giả. Đoạn ghi **rút gọn** chỉ giữ các dòng liên quan.

## 1. Danh mục tính năng trước khi mở code

| Màn hình / vùng giao diện | Tính năng hiện có | Điểm bắt đầu |
| --- | --- | --- |
| Đăng nhập `/login` | Tài khoản Wazo, Single ID, quên mật khẩu Wazo, hướng dẫn chứng chỉ khi gặp lỗi phù hợp | [LoginView.vue](../frontend/src/views/LoginView.vue) |
| Trang sau Single ID `/callback` | Hiện hồ sơ, tự thử kết nối Wazo, thử lại, đăng nhập lại, quay về Login, điều hướng sang luồng đăng xuất IdP | [CallbackView.vue](../frontend/src/views/CallbackView.vue) |
| Khung ứng dụng | Thanh điều hướng, hồ sơ/phòng ban, trạng thái SIP, toast, popup gọi đến, phiên bị thu hồi, đăng xuất, mở Settings | [App.vue](../frontend/src/App.vue), [AppHeader.vue](../frontend/src/components/layout/AppHeader.vue), [AppSidebar.vue](../frontend/src/components/layout/AppSidebar.vue) |
| Gọi `/calls` | Nhập số và bàn phím, gọi từ danh bạ, nhận/từ chối, mute, DTMF, cúp, thời lượng, nhạc chuông/chuông chờ, ghi âm, gọi nhóm, mời thêm người | [CallsView.vue](../frontend/src/views/CallsView.vue), [components/call](../frontend/src/components/call) |
| Danh bạ trong `/calls` | Tải/làm mới, tìm theo tên/máy lẻ/phòng ban, bộ lọc, presence, yêu thích, chọn nhiều người, mở chat, ảnh đại diện bằng chữ cái | [ContactsPanel.vue](../frontend/src/components/contacts/ContactsPanel.vue), [useContactFilters.js](../frontend/src/composables/useContactFilters.js) |
| Tin nhắn `/messages` | Danh sách phòng, chat 1-1, tạo nhóm, lịch sử, gửi/nhận, badge chưa mở, xem thành viên, đổi tên/đóng nhóm theo quyền, chọn nhiều phòng, gọi thoại từ chat | [MessagesView.vue](../frontend/src/views/MessagesView.vue), [components/messages](../frontend/src/components/messages) |
| Giới hạn ngay trên màn tin nhắn | Nút video chỉ báo đang phát triển. Thêm/gỡ thành viên nhóm hiện có bị service chặn. Đổi tên/đóng nhóm dùng quy ước SmartCall. Không có pin hoặc receipt đã xem. | [MessagesView.vue](../frontend/src/views/MessagesView.vue#L1534), [chatService.js](../frontend/src/services/data/chatService.js#L1394) |
| Lịch sử `/history` | CDR, lọc ngày/từ khoá/hướng cuộc gọi, đếm từng nhóm, gọi lại, mở chat, phát/tua/tải bản ghi | [HistoryView.vue](../frontend/src/views/HistoryView.vue) |
| Cài đặt dạng modal | Thiết bị mic/loa, đo mic/thử loa, DND, chuyển tiếp, quản lý mật khẩu Wazo, tuỳ chọn ghi âm, bật/tắt màn hình | [SettingsModal.vue](../frontend/src/components/common/SettingsModal.vue) |
| Hỗ trợ vận hành | Log, kiểm tra hoạt động backend, công cụ thao tác liên kết SQLite, nhập cấu hình theo tệp | [loggerService.js](../frontend/src/services/common/loggerService.js), [backend](../backend) |

## 2. Kế hoạch đọc theo thứ tự

| Bước | Theo dõi thao tác | File kế tiếp sau màn hình | Điểm kết thúc cần hiểu |
| --- | --- | --- | --- |
| 1 | Mở URL, vào một trang, đổi tab | Router → App → createServices | Route nào được phép, state nào tồn tại khi đổi trang |
| 2 | Bấm đăng nhập Wazo rồi F5 | AuthService → SDK → sessionScope → CallService | Phiên Web sẵn sàng và SIP đăng ký là hai mốc |
| 3 | Bấm Single ID, theo browser redirect | FastAPI → OIDC → Redis → SQLite → Wazo → CallbackView | Cookie, hồ sơ, token Wazo và tài khoản đến từ đâu |
| 4 | Mở danh bạ, tìm người, bấm yêu thích | ContactService → Dird/Confd/Chatd → mapper → composable | Contact chuẩn hóa, presence, dữ liệu cũ hay mới |
| 5 | Gọi 1-1, nghe máy, cúp, bật ghi âm | CallService → Phone SDK → phoneEvents → RecordingService | SIP session, event, state UI, kết quả ghi âm |
| 6 | A gọi B rồi B mời C | GroupCallService → CallControlApi → Wazo events | Ai là host, sự khác nhau giữa đang mời và đã kết nối |
| 7 | Mở phòng, gửi tin, nhận tin khi đổi tab | ChatService → Chatd → EventHub → badge | Khi nào tin có ID thật, khi nào bộ đếm tăng |
| 8 | Đổi tên/đóng nhóm, gọi từ chat | ChatService hoặc App → GroupCallService | Phạm vi quyền nhóm, query tự gọi, lọc người không gọi được |
| 9 | Xem lịch sử, phát ghi âm, gọi lại | HistoryService → CDR mapper → Call-logd | CDR ID, recording UUID và URL media |
| 10 | Đổi mic, bật DND, thử lưu nhiều mục | SettingsModal → thiết bị browser / SettingsService → Confd | Dữ liệu lưu trên máy hay trên Wazo, thao tác nào được máy chủ xác nhận |
| 11 | Đăng xuất, bị thu hồi phiên, gặp lỗi mạng | AuthService → sessionScope → cleanup từng service | Request cũ bị vô hiệu hóa và tài nguyên nào phải dọn |

## 3. Bản đồ ứng dụng và cách đọc kết quả

~~~mermaid
flowchart LR
    UI["View / Component Vue"] --> S["Service"]
    S --> API["Wazo REST"]
    S --> P["Phone SDK / SIP WebRTC"]
    S --> B["FastAPI cho Single ID"]
    B --> IdP["IdP OIDC"]
    B --> DB["Redis / SQLite"]
    B --> API
    WS["Wazo WebSocket"] --> E["EventConnection / EventHub"]
    E --> S
    API --> S
    P --> S
    S --> ST["State reactive"]
    ST --> UI
~~~

[main.js](../frontend/src/main.js) gắn Vue và router. [router/index.js](../frontend/src/router/index.js) kiểm tra `requiresAuth`, cờ đăng nhập và `authService.isAuthenticated()`. Trang riêng tư chưa có phiên sẽ chuyển đến `/login` kèm `redirect`. Sau đăng nhập, router cũng kiểm tra cờ màn hình. [App.vue](../frontend/src/App.vue) giữ trang bằng `KeepAlive`, điều phối modal, toast và sự kiện của toàn ứng dụng.

**Đọc đoạn lắp ghép** trong [createServices.js](../frontend/src/services/createServices.js):

~~~js
const contactService = new ContactService({ authService })
const historyService = new HistoryService({ authService })
const recordingService = new RecordingService({ authService })
const chatService = new ChatService({ authService, contactService, eventHub })
~~~

Chat cần danh bạ để xác định người đối thoại và EventHub để nhận tin mới. Các service dùng chung một phiên Auth. [services/index.js](../frontend/src/services/index.js) tạo các instance dùng trong trình duyệt. `callState` giữ trạng thái cuộc gọi. `userSessionState` giữ hồ sơ và trạng thái phiên Web. `ref`/`computed` trong View chuyển các giá trị này thành UI.

| Kết quả bạn thấy trong code | Cách hiểu |
| --- | --- |
| HTTP JSON | Metadata hoặc kết quả nghiệp vụ, ví dụ CDR hay tin nhắn |
| HTTP thành công không có JSON | Máy chủ đã xác nhận lệnh, ví dụ một số thao tác cập nhật Confd |
| Redirect HTTP 302 | Trình duyệt chuyển trang, dùng trong Single ID |
| SIP session / Calld call ID / conference ID | Các mã khác nhau của nhánh thoại. Không dùng máy lẻ để thay thế các ID này |
| WebSocket hoặc sự kiện SDK | Cập nhật đến sau, ví dụ đối phương vừa nghe máy hoặc có tin mới |
| Lỗi hoặc kết quả cũ | Một số service giữ dữ liệu đang hiển thị khi mất mạng. Cần đọc hợp đồng hàm trước khi hiện toast thành công |

## 4. Login, Single ID và vòng đời phiên

### 4.1 Đăng nhập tài khoản tổng đài

1. `LoginView.handleLogin` kiểm tra form và chặn bấm lặp. AuthService gọi SDK Wazo trong cổng xác thực [sdkAuthenticationGate.js](../frontend/src/services/auth/sdkAuthenticationGate.js). Cổng tuần tự hóa thao tác SDK để một lần đăng nhập chậm không ghi đè phiên mới sau timeout.
2. AuthService xử lý phiên và hồ sơ Wazo, đọc thêm thông tin user khi cần, cập nhật thông tin vào state và phiên Web. View báo `app-login-success` để App tiếp tục điều phối.
3. CallService khởi tạo Phone và gắn listener. SIP đăng ký riêng. Trường hợp chat chạy mà không gọi được thường cần kiểm tra bước này trước.
4. Lỗi sai mật khẩu trả về form. `shouldShowCertificateHint()` chỉ gợi ý chứng chỉ với lỗi mạng/TLS phù hợp. Quên mật khẩu gọi `AuthService.resetPassword` qua Wazo Auth `/api/auth/0.1/users/password/reset` theo mã định danh nhập.

Đoạn rút gọn từ [LoginView.vue](../frontend/src/views/LoginView.vue#L341):

~~~js
await authService.login(submittedUsername, password.value)
localStorage.setItem('smartcall_logged_in', 'true')
window.dispatchEvent(new CustomEvent('app-login-success'))
await router.push('/calls')
~~~

Các dòng sau khi await chạy khi AuthService hoàn tất. Nếu lệnh xác thực ném lỗi, View giữ người dùng ở Login và hiện thông báo qua nhánh catch.

### 4.2 Single ID từ nút login tới hồ sơ

~~~js
beginSingleIdLogin() {
  window.location.assign('/api/auth/login')
}
~~~

Đoạn trên ở [authService.js](../frontend/src/services/auth/authService.js#L216). Đây là điều hướng cả cửa sổ. Proxy Vite chuyển `/api` đến FastAPI trong môi trường dev. [main.py](../backend/main.py) xử lý các bước sau:

~~~mermaid
sequenceDiagram
    participant Web as Trình duyệt
    participant App as FastAPI
    participant IdP as Single ID
    participant Store as Redis / SQLite
    participant PBX as Wazo
    Web->>App: GET /api/auth/login
    App->>Store: Lưu giao dịch OIDC ngắn hạn
    App-->>Web: Cookie giao dịch và 302
    Web->>IdP: Đăng nhập
    IdP-->>Web: Redirect với code và state
    Web->>App: GET /api/auth/callback
    App->>IdP: Đổi code và đọc khóa ký
    App->>Store: Lưu phiên Single ID
    App-->>Web: Cookie phiên và 302 /callback
    Web->>App: GET /api/auth/user_info
    App-->>Web: Hồ sơ, CSRF, UUID nếu đã liên kết
    Web->>App: POST /api/auth/wazo-session
    App->>PBX: Tìm hoặc cấp tài khoản và xin token Wazo
    App-->>Web: Phiên Wazo của người dùng
~~~

- `OidcClient.begin()` sinh `state`, `nonce` và PKCE verifier. FastAPI lưu giao dịch Redis và đặt cookie giao dịch. Callback so sánh `state` với cookie, lấy và xóa giao dịch bằng thao tác nguyên tử. Code cũ hoặc callback từ browser khác bị chặn.
- `exchange_code()` nhận token từ IdP. `validate_id_token()` dùng khóa ký JWKS và xác minh issuer, audience, hạn, nonce cùng các claim liên quan. `build_profile()` kiểm tra miền email và chuẩn hóa tên/phòng ban. `finish()` trả `(session, ttl)` cho FastAPI. [oidc.py](../backend/oidc.py)
- Server tạo cookie `smartcall_session` và chuyển sang **trang Vue `/callback`**. Endpoint backend nhận authorization code là **`/api/auth/callback`**.
- `user_info` trả `profile`, `csrf_token`, `wazo_user_uuid` nếu có liên kết và `expires_at`. ID token IdP được giữ phía server. Mẫu hồ sơ trả về:

~~~json
{
  "profile": {
    "name": "Người dùng mẫu",
    "email": "employee@example.com",
    "department": "Kỹ thuật",
    "employee_id": "EMP001"
  },
  "wazo_user_uuid": null,
  "csrf_token": "<csrf-của-phiên>",
  "expires_at": 1800000000
}
~~~

### 4.3 Lấy phiên Wazo sau Single ID

`CallbackView.connectWazo()` gọi `completeSingleIdLogin(csrfToken)`. Request gửi cookie phiên, header `X-CSRF-Token` và body chứa `client_id`. Backend xác thực phiên trước và sau provisioning. [CallbackView.vue](../frontend/src/views/CallbackView.vue#L45) · [main.py](../backend/main.py#L128)

[WazoClient.provision](../backend/wazo.py#L334) làm việc theo thứ tự:

1. Khóa Redis theo tenant, xin token quản trị Wazo trên backend.
2. Đọc mapping SQLite theo danh tính IdP và tenant. Nếu UUID đã lưu bị Wazo trả 404 thì tìm lại theo email đúng tenant. Lỗi quyền/mạng dừng luồng.
3. Khi cần tạo mới, gọi `load_provisioning_context`, `load_sip_templates` và `choose_extension_number`. Chọn máy lẻ trong kho cấu hình và dải context, bỏ máy lẻ đã dùng. `build_user_payload` dựng payload chứa user, auth, SIP endpoint và extension. `create_user` gửi một POST Confd `/api/confd/1.1/users`.
4. Username mới lấy phần trước `@` của email. Tài khoản cũ giữ username đã lưu hoặc đọc từ Auth. Tên SIP endpoint khớp SIP username. Backend xử lý sửa tên SIP của tài khoản do ứng dụng quản lý nếu cần.
5. Lưu mapping để thử lại không tạo trùng. Xin token Wazo của user, đối chiếu UUID rồi cập nhật `description` theo phòng ban Single ID. Thiếu phòng ban thì giữ mô tả hiện có.
6. Trả `token`, `refresh_token`, `user_uuid`, `host`, `username`, `created` và `profile`. Frontend xác minh phiên qua SDK. Sau đó View đặt cờ đăng nhập và chuyển `/calls`. Nếu cấp phiên Wazo thất bại, trang vẫn có thể hiển thị hồ sơ Single ID và cho thử lại kết nối.

**Dữ liệu nằm ở đâu:** [store.py](../backend/store.py) giữ giao dịch, phiên, vé logout có TTL trong Redis. SQLite lưu issuer/subject quy về khóa danh tính, tenant, UUID Wazo, username và cờ managed. Xóa bộ nhớ trình duyệt không xóa bảng liên kết. Tiện ích [manage_identity_db.py](../backend/manage_identity_db.py) dùng SQLite và sao lưu trước thao tác ghi.

### 4.4 Khôi phục, refresh và đăng xuất

- Khi F5, App đi qua luồng khôi phục phiên đã lưu. AuthService xác minh token và làm mới khi cần. Refresh thành công trong cùng phiên khác với đăng xuất rồi đổi người.
- `createSessionFetch` gắn request và việc đọc body vào context gồm thế hệ và UUID. `invalidateSession()` tăng thế hệ và abort request. Dữ liệu về muộn không được cập nhật vào phiên mới. [sessionScope.js](../frontend/src/services/auth/sessionScope.js)
- Logout thường dọn phiên ứng dụng, token/SDK, socket, thoại, timers và cache. Đăng xuất IdP để đổi tài khoản đi qua POST `idp-logout` → vé dùng một lần → GET `idp-logout/continue` → redirect IdP. Backend logout cục bộ dùng POST `logout`. Khi phiên host bị thu hồi, frontend có luồng dọn hội nghị và nhánh thoại do host quản lý. [authService.js](../frontend/src/services/auth/authService.js#L413) · [callApi.js](../frontend/src/services/calls/callApi.js#L155)

## 5. Danh bạ, phòng ban, presence và yêu thích

1. Khi màn hình Calls hiện, `activateCallsView()` gọi `loadContacts()`. Các điểm khác như ChatService cũng có thể dùng `getContacts()`. `refreshDirectory()` gộp request cùng phiên.
2. ContactService đọc yêu thích, tìm source Dird và tải trang liên hệ tối đa 1.000 mục ở đường chính. Khi không lấy được, thử đường lookup mặc định. `mapDirectoryContacts()` chuẩn hóa dữ liệu trước khi UI đọc.
3. `loadContactDescriptions()` tìm bổ sung `description` từ Confd theo các trang nếu Dird chưa có. Ghép theo UUID. `description` là nguồn phòng ban ưu tiên. Nếu user token thiếu quyền Confd, giữ kết quả Dird.
4. `loadPresencesForContacts()` lấy presence theo UUID qua Chatd. `statusOf()`/`isContactAvailableForCall()` diễn giải trạng thái và khả năng gọi. WebSocket cập nhật từng user. Polling bổ sung trạng thái định kỳ trong phiên.
5. `publishDirectory()` lọc mục trùng và mục của chính mình rồi cập nhật danh bạ dùng chung. `useContactFilters` lọc dữ liệu có sẵn cho UI. Bấm yêu thích đi qua `toggleFavorite`/`setContactFavorite` và chỉ ghi trạng thái sau khi Dird xác nhận.

Đoạn rút gọn từ [contactService.js](../frontend/src/services/data/contactService.js#L326):

~~~js
async getContacts() {
  const result = await this.refreshDirectory()
  return result.contacts
}
// fetchDirectory khi đã nhận dữ liệu mới
return { status: 'updated', contacts: this.publishDirectory(finalContacts) }
~~~

Nút làm mới dùng `refreshDirectory()` để đọc cả `status`. `updated` có thể có danh sách rỗng hợp lệ. `cached` giữ danh sách cũ và báo lỗi đồng bộ. `cancelled` thuộc phiên đã đổi. Phân trang giao diện và tải presence theo trang chưa được triển khai trong commit này.

## 6. Gọi 1-1, media và ghi âm

**Gọi đi.** Bàn phím phát sự kiện lên View. View cũng có thể nhận lệnh gọi từ ContactCard, History hoặc Messages. Đoạn sau nằm trong [CallsView.vue](../frontend/src/views/CallsView.vue#L331):

~~~js
const handleDial = async () => {
  const targetExtension = extension.value.trim()
  if (!targetExtension) return
  await callService.startCall(targetExtension)
  extension.value = ''
  cleanCallQueryParams()
}
~~~

[CallService.startCall](../frontend/src/services/calls/callService.js#L984) kiểm tra số, phiên, SIP, trạng thái gọi và điều kiện gọi đích. Sau đó chuẩn bị audio và gọi qua SDK. Lệnh trả về hoặc tạo SIP session nghĩa là đã bắt đầu nhánh thoại. `ON_CALL_ACCEPTED` mới xác nhận nhánh được nghe. `phoneEvents.js` cập nhật active call, dừng chuông chờ, quản lý media và đưa View sang trạng thái đàm thoại.

**Gọi đến.** SDK phát `ON_CALL_INCOMING` → `phoneEvents` điền state cuộc gọi đến → `App.vue` mở `IncomingCallModal`. Bấm nghe đi qua `acceptIncomingCall` và `sdk.Phone.accept(session, false)`. Bấm từ chối đi qua `rejectIncomingCall`. Các event kết thúc/thất bại/từ chối/hủy được đối chiếu với SIP session đang quản lý trước khi sửa state. [phoneEvents.js](../frontend/src/services/calls/phoneEvents.js) · [callService.js](../frontend/src/services/calls/callService.js)

| Thao tác | Đường xử lý | Kết quả |
| --- | --- | --- |
| Nhập số khi chưa gọi | `pressKey` → cập nhật `extension` và tiếng bàn phím | Chỉ chuẩn bị số gọi |
| Bấm phím trong cuộc gọi | `pressKey` → `callService.sendDtmfDigits` → SDK | Gửi DTMF cho nhánh đang đàm thoại, ví dụ để chọn menu tổng đài |
| Mute | `CallsView.toggleMute` → `CallService.toggleMute` | Cập nhật media và cờ `isMuted` |
| Cúp | `hangupCurrentCall` và xử lý event kết thúc | Dọn thoại/audio/timer, đối chiếu nhánh họp khi có |
| Ghi âm | `toggleRecord` → `RecordingService.startRecording/stopRecording` → Calld | Trạng thái chỉ bật sau khi API chấp nhận. File thuộc tổng đài và xuất hiện qua CDR |
| Tự ghi âm / tuỳ chọn | Cấu hình từ Settings, được kiểm tra khi nhận event thoại | Ghi âm theo điều kiện cuộc gọi và quyền hiện có |

RecordingService dùng **call ID bên Calld** cho `/record/start` và `/record/stop`. Lịch sử dùng **CDR ID + recording UUID** cho file media. Hai bước mang ID khác nhau. [recordingService.js](../frontend/src/services/audio/recordingService.js)

## 7. Gọi nhóm và đồng bộ các máy Web

1. Danh bạ hoặc chat gom các máy lẻ, bỏ bản thân và số trùng. `GroupCallService.startGroupCall()` lọc tiếp theo khả năng gọi. Với nhánh gọi từ chat, còn một người thì đi theo luồng gọi 1-1. Không còn ai phù hợp thì trả thất bại để View hiện thông báo.
2. Host tạo nhánh thoại, theo dõi các nhánh còn chờ và ghép các nhánh đã nghe vào hội nghị qua `CallControlApi`. `createConference()` gọi POST `/api/calld/1.0/users/me/conferences/adhoc` và lấy `conference_id`. `addConferenceParticipant()` dùng conference ID và call ID, trả boolean theo kết quả HTTP.
3. **A gọi B rồi B mời C.** B phát `ADD_REQ`. A vẫn làm host, A mới gọi và ghép C. C đang đổ chuông nằm trong danh sách chờ. Chỉ sau event xác nhận kết nối mới đưa C vào danh sách đang tham gia.
4. Host phát thông tin nhóm qua presence. `GROUP_STATE` có ID nhóm, revision và danh sách máy lẻ đã kết nối. `GROUP_SYNC` cho phép thành viên xin lại snapshot khi bỏ lỡ event hoặc sau reconnect. Handler kiểm tra người gửi và phiên/phạm vi của nhóm trước khi áp dụng.
5. C rời thì giảm C. A cúp hoặc bị thu hồi phiên thì chạy cleanup hội nghị do A quản lý. Khi tổng đài chuyển nhánh sang hội nghị, một event kết thúc nhánh SIP đơn lẻ có thể chỉ là bước ghép; đối chiếu ID và state trước khi kết luận người rời.

~~~text
A gọi B → B nghe → A/B đã kết nối
B thêm C → ADD_REQ tới A → C đang chờ → UI vẫn đếm 2
C nghe và được xác nhận → host phát GROUP_STATE mới → UI đếm 3
~~~

Phần gửi dữ liệu trong [CallControlApi.createConference](../frontend/src/services/calls/callApi.js#L44):

~~~js
body: JSON.stringify({
  host_call_id: hostCallId,
  participant_call_ids: participantCallIds,
}),
~~~

Đây là ID các nhánh ở Calld. Response thành công được đọc qua data.conference_id; lỗi hoặc thiếu ID làm hàm trả null. Nhóm dùng kết quả đó cho bước ghép tiếp hoặc xử lý thất bại.

Đối chiếu [groupCallService.js](../frontend/src/services/calls/groupCallService.js), [callApi.js](../frontend/src/services/calls/callApi.js), [wazoEventHandler.js](../frontend/src/services/realtime/wazoEventHandler.js) và [ActiveCallPanel.vue](../frontend/src/components/call/ActiveCallPanel.vue). Danh sách được mời phục vụ kiểm tra quyền và điều phối, danh sách đã kết nối phục vụ số người hiển thị.

## 8. Tin nhắn, phòng, badge và cuộc gọi từ hội thoại

| Tình huống | Từ View tới service | Request và dữ liệu đi về |
| --- | --- | --- |
| Vào màn hình hoặc làm mới | `loadRooms` → `getRooms` | GET Chatd `/users/me/rooms` → phòng, metadata và thành viên → ghép danh bạ, xác minh trạng thái đóng → `rooms` reactive. Có gộp lượt tải đang chạy. |
| Mở phòng | `selectRoom` → `getRoomMessages` | GET `/users/me/rooms/{roomId}/messages?limit=50` theo mặc định của service. Chuẩn hóa tin, tác giả và thời gian. |
| Mở chat từ danh bạ/lịch sử | Điều hướng với query máy lẻ → `checkDirectChatRoute` → `getOrCreateDirectRoom` | Phân giải UUID, tìm lại phòng thật trên Chatd và tạo khi cần. Một ID tạm dạng `direct-…` chưa phải UUID để POST tin. |
| Gửi tin | MessageComposer → `sendMessage` của View → `ChatService.sendMessage` | POST `/users/me/rooms/{roomId}/messages` với `content` và `alias`. API trả UUID/thời gian nếu có. |
| Nhận tin | WebSocket → `wazoEventHandler`/EventHub → `handleIncomingMessage` | Ghép event vào phòng, loại trùng và cập nhật badge/preview. |
| Tạo nhóm | `submitCreateGroup` → `createGroupRoom` | POST `/users/me/rooms` với `name` và `users`. Cần có UUID phòng thật. Sau tạo có thể gửi lời chào. |
| Đổi tên, đóng nhóm | `renameGroup` / `deleteRoom` | Kiểm tra quyền theo trạng thái nhóm đã xác minh; gửi tin điều khiển. Đóng nhiều phòng trả phần đạt và phần lỗi riêng. |

Đoạn rút gọn từ [chatService.js](../frontend/src/services/data/chatService.js#L1231):

~~~js
body: JSON.stringify({
  content: text,
  alias: actualAlias,
})
// Khi Chatd xác nhận tin
newMsg.id = serverMsg.uuid || serverMsg.id
// Khi gửi thất bại trong cùng phiên
newMsg.sendFailed = true
~~~

Tin xuất hiện trước phản hồi vì service tạo bản ghi reactive tạm. Khi máy chủ phản hồi, service sửa ID/thời gian trên cùng bản ghi. Khi lỗi, bản ghi còn đó để người dùng thấy gửi thất bại. Đây là trạng thái thao tác gửi ở máy hiện tại.

**Badge chưa mở.** ChatService giữ tập ID chưa mở theo phòng. Điều kiện đang xem tính cả phòng hiện tại, route và trạng thái tab. Khi người dùng thực sự mở phòng, service xóa bộ đếm phòng đó. Sidebar đọc tổng, danh sách phòng đọc số từng phòng. Metadata tạm lưu qua localStorage theo host/UUID; nội dung hội thoại tải từ máy chủ. [chatService.js](../frontend/src/services/data/chatService.js#L54) · [MessagesView.vue](../frontend/src/views/MessagesView.vue#L1131)

**Quyền nhóm và các giới hạn.** `ROOM_RENAME`, `ROOM_CLOSED` và xử lý tag `MSG_DELETED` là quy ước trong nội dung Chatd, có bước kiểm tra thông điệp đáng tin. Tombstone đóng nhóm khiến SmartCall ẩn/khóa theo quy ước ứng dụng. Việc đó không đồng nghĩa xóa lịch sử hay thu hồi membership ở Wazo. `addMembersToGroup` và `removeMemberFromGroup` hiện trả lỗi rõ ràng để giữ nhóm và lịch sử. Khi cần đọc dữ liệu cũ, service cũng nhận dạng định dạng `FWD`. [chatService.js](../frontend/src/services/data/chatService.js#L1424)

**Bấm gọi từ chat.** `startVoiceCall` ở [MessagesView.vue](../frontend/src/views/MessagesView.vue#L1415) gửi lệnh bên dưới cho chat riêng:

~~~js
window.dispatchEvent(
  new CustomEvent('app-action', {
    detail: { type: 'dial', value: targetExt },
  }),
)
~~~

App nhận lệnh, mở `/calls` với query số và tự gọi. CallsView tiêu thụ query và dọn sau khi xử lý. Với phòng nhóm, View phân giải máy lẻ của các thành viên rồi gọi `groupCallService.startGroupCall(memberExts, options)`. Nếu thành công, View mở Calls và thử gửi một tin thông báo đã khởi tạo cuộc gọi. Tin đó thông báo đã bắt đầu, không xác nhận mọi người đã nghe.

## 9. Lịch sử, gọi lại, bản ghi

[HistoryView.vue](../frontend/src/views/HistoryView.vue#L306) gọi `fetchHistory()` → [HistoryService.getHistory()](../frontend/src/services/data/historyService.js#L99). Request hiện tại:

~~~text
GET /api/call-logd/1.0/users/me/cdr?limit=100&order=start&direction=desc
~~~

Đoạn rút gọn trong [HistoryView.vue](../frontend/src/views/HistoryView.vue#L306):

~~~js
const list = await historyService.getHistory({ tab: 'all', limit: 100, forceRefresh: force })
if (request !== historyRequest || !isSessionContextCurrent(context)) return
calls.value = [...list]
await syncRecordingsAvailability()
~~~

Hàm bỏ phản hồi cũ khi đã có lượt tải mới hơn hoặc người dùng đổi phiên. Call-logd trả `items`. [callHistoryMapper.js](../frontend/src/utils/callHistoryMapper.js) chuyển record thành dữ liệu UI như ID, hướng gọi, máy lẻ, thời gian và metadata ghi âm. Service có cache phiên, gộp request và ghép bản ghi tạm của lượt thoại vừa xong trong RAM. Khi có sự kiện `smartcall-cdr-updated`, View tải/đồng bộ lại. Bộ lọc ngày, nội dung tìm và tab áp dụng trên tập dữ liệu đang có.

- **Gọi lại:** lấy máy lẻ từ CDR, kiểm tra liên hệ nếu biết, điều hướng sang Calls. **Nhắn tin:** điều hướng sang Messages với thông tin đích.
- **Phát:** `useRecordingPlayer.togglePlayCall` gọi `getAudioUrlForCall(call)`. RecordingService tải Blob từ `/api/call-logd/1.0/users/me/cdr/{cdrId}/recordings/{recordingUuid}/media` và tạo ObjectURL. Player cập nhật thời lượng, tiến độ và tua theo audio. Khi rời trang, player dọn phát/tài nguyên theo vòng đời.
- **Tải:** `downloadCall` gọi `downloadRecordingForCall`, dùng cùng đường lấy media và kích hoạt tải file browser. Thiếu bản ghi/quyền thì UI báo lỗi. Cache ObjectURL được quản lý theo phiên. [useRecordingPlayer.js](../frontend/src/composables/useRecordingPlayer.js) · [recordingService.js](../frontend/src/services/audio/recordingService.js)

## 10. Cài đặt và cách biết thao tác đã lưu

Settings là [SettingsModal.vue](../frontend/src/components/common/SettingsModal.vue) do App mở. Nút đóng modal và lưu cấu hình là hai thao tác riêng.

| Tab | Hàm chính | Lưu ở đâu / trả gì |
| --- | --- | --- |
| Âm thanh | `loadAudioDevices`, `testSound`, `useMicrophoneMeter`, `PhoneAdapter.applyAudioDevices` | Browser cấp danh sách thiết bị và stream khi có quyền. ID lựa chọn lưu trên máy. Mic meter dừng khi đóng/rời tab. |
| Cuộc gọi | `loadCallServices`, `saveCallServices` | Wazo Confd trả DND và forwards. Ghi từng mục DND, bận, không trả lời, chuyển tiếp toàn bộ qua API. |
| Tài khoản | `savePassword`, `sendPasswordResetEmail` | Wazo Auth xử lý; form kiểm tra mật khẩu mới và xác nhận. Mật khẩu Single ID do IdP quản lý. |
| Tuỳ chọn | `saveAutoRecord` | localStorage và sự kiện cập nhật tuỳ chọn ghi âm trên Web. |
| Phân hệ | `saveFeatures`, `resetFeatures` | Cờ giao diện lưu local; router/sidebar dùng cờ để quyết định trang và mục điều hướng. |

Đoạn rút gọn từ [settingsService.js](../frontend/src/services/data/settingsService.js#L39):

~~~js
await this.apiClient.putJson('/api/confd/1.1/users/me/' + change.path, change.body, {
  context,
})
change.commit()
// Sau khi xử lý từng mục
return { baseline: next, failures }
~~~

Khi tải cấu hình thất bại, trạng thái chưa biết được giữ là `null`. Save chỉ gửi giá trị đã tải và có thay đổi. `baseline` mới chỉ chứa mục máy chủ đã xác nhận, `failures` liệt kê phần lỗi. Ví dụ DND lưu thành công, chuyển tiếp lỗi thì hai kết quả được báo riêng. [apiClient.js](../frontend/src/services/common/apiClient.js) là một điểm HTTP dùng chung; các nhóm thoại, auth, chat và lịch sử cũng có lớp hoặc đoạn gọi API của riêng chúng.

## 11. Tra cứu và thực hành

| Bạn thấy biểu hiện | Lần theo dữ liệu theo thứ tự |
| --- | --- |
| Đăng nhập thành công, SIP offline | Hồ sơ ở AuthService → Phone connect/register → sự kiện registered/unregistered → header |
| Callback có tên nhưng chưa vào Calls | `user_info` → `wazo-session` → thông báo lỗi FastAPI → mapping/tenant/SIP endpoint → xác minh SDK |
| Danh bạ có người nhưng lọc phòng ban thiếu | Dữ liệu Dird → `description` Confd → `contact.dept` → `useContactFilters` |
| C nghe được, bên A vẫn đếm thiếu | Nhánh C accepted / Calld → `groupConnectedExtensions` → snapshot host → revision bên nhận → ActiveCallPanel |
| Tin có ở server nhưng badge không hiện | Socket đang nối → EventHub → `handleIncomingMessage` → phòng thực sự đang xem hay không → bộ đếm Sidebar |
| Không thấy bản ghi ngay khi cúp | Kết quả Calld stop → cập nhật CDR → metadata recordings → media endpoint |
| Settings báo một phần lỗi | Giá trị ban đầu → field thay đổi → HTTP từng mục → `failures` → toast |

Khi đọc DevTools, theo **Network** cho API, **WS** cho WebSocket và log ứng dụng cho SIP/event. Ghi lại endpoint, mã trạng thái, tên event và ID đã ẩn khi cần báo lỗi. Thực hành theo thứ tự dễ nhất: gọi từ danh bạ, gửi một tin sang máy khác, gọi nhóm A/B/C, rồi thử Single ID và kiểm tra chỗ tách phiên. Các hành vi phụ thuộc quyền, dữ liệu hoặc cấu hình tổng đài cần đối chiếu ở môi trường thật.

