# TÀI LIỆU ĐẶC TẢ KIẾN TRÚC & LUỒNG VẬN HÀNH HỆ THỐNG SMARTCALL WEB
> **Phiên bản:** 2.0 - Toàn diện (Production Master Documentation)  
> **Dự án:** SmartCall Web (WebRTC Softphone & Realtime Messaging Client)  
> **Ngăn xếp công nghệ:** Vue 3 (Composition API, `<script setup>`), Vite, Wazo WebRTC SDK, Web Audio API, WebSocket Bus.  
> **Chuẩn dữ liệu:** 100% Dữ liệu thực từ Máy chủ Tổng đài Viễn thông Wazo (Khung tham chiếu chuẩn theo mã nguồn mẫu và tài liệu kỹ thuật tổng đài).

---

## MỤC LỤC TỔNG THỂ

1. [CHƯƠNG 1: TỔNG QUAN KIẾN TRÚC TOÀN HỆ THỐNG & MÔ HÌNH DỮ LIỆU SSOT](#chương-1-tổng-quan-kiến-trúc-toàn-hệ-thống--mô-hình-dữ-liệu-ssot)
   - 1.1. Mục tiêu và Định vị Hệ thống
   - 1.2. Mô hình 5 tầng kiến trúc (Architectural Layers)
   - 1.3. Sơ đồ khối tổng thể hệ thống (System Architecture Diagram)
   - 1.4. Nguyên tắc Single Source of Truth (SSOT) trong State Management
   - 1.5. Phân định ranh giới giữa Dự án Chính và Môi trường Kiểm thử Độc lập
2. [CHƯƠNG 2: PHÂN HỆ XÁC THỰC, PHIÊN LÀM VIỆC & KẾT NỐI TỔNG ĐÀI](#chương-2-phân-hệ-xác-thực-phiên-làm-việc--kết-nối-tổng-đài)
   - 2.1. Quy trình Đăng nhập tại `LoginView.vue`
   - 2.2. Chi tiết Wazo Auth REST API (Endpoint, Headers, Payload, Response)
   - 2.3. Vòng đời Token: Cấp phát, Lưu trữ bảo mật, Refresh Token và Tự phục hồi phiên
   - 2.4. Trích xuất thông tin User Profile & Số máy lẻ (Extension)
   - 2.5. Khởi tạo Phone WebRTC SIP Phone (`Wazo.Phone.connect()`)
   - 2.6. Khởi tạo cầu nối sự kiện Wazo Event Bus WebSocket (`websocketService.js` & `wazo.js`)
   - 2.7. Sơ đồ tuần tự Đăng nhập & Khởi tạo phiên (Sequence Diagram)
   - 2.8. Trích dẫn mã nguồn thực tế & Phân tích từng dòng lệnh
3. [CHƯƠNG 3: PHÂN HỆ HIỆN DIỆN TRỰC TUYẾN & ĐỒNG BỘ DANH BẠ](#chương-3-phân-hệ-hiện-diện-trực-tuyến--đồng-bộ-danh-bạ)
   - 3.1. Cơ chế đồng bộ Danh bạ từ Wazo Dird API (`contactService.js`)
   - 3.2. Chuẩn hóa dữ liệu danh bạ đầu vào (Data Normalization)
   - 3.3. Cơ chế lắng nghe sự kiện Presence thời gian thực (`wazo-presence-updated`)
   - 3.4. Thuật toán phân giải trạng thái người dùng `statusOf(uuid)` chuẩn 100% Wazo PBX
   - 3.5. Hệ thống hiển thị trực quan đa sắc thái (Color-coded Presence Indicator)
   - 3.6. Cơ chế Tìm kiếm (Search Engine) lọc theo Tên, Số máy lẻ, Phòng ban
   - 3.7. Trích dẫn mã nguồn thực tế & Đối chiếu tài liệu kỹ thuật
4. [CHƯƠNG 4: PHÂN HỆ CUỘC GỌI THOẠI WEBRTC (TELEPHONY & WEBRTC CALL FLOW)](#chương-4-phân-hệ-cuộc-gọi-thoại-webrtc-telephony--webrtc-call-flow)
   - 4.1. Điểm khởi đầu cuộc gọi từ UI (`CallsView.vue` & `wazo.js`)
   - 4.2. Bộ lọc an toàn 7 lớp (7 Defense Gates) tại `validateAndMakeCall()`
   - 4.3. Phát lệnh gọi âm thoại audio-only `Wazo.Phone.call(extension, false)`
   - 4.4. Cơ chế tạo âm chuông đi (Ringback Tone) bằng Web Audio API thuần
   - 4.5. Luồng tín hiệu SIP qua Asterisk WebSocket (`INVITE` -> `180 Ringing` -> `200 OK` -> `ACK`)
   - 4.6. Xử lý các sự kiện vòng đời cuộc gọi trong SDK (Progress, Accepted, Ended, Failed)
   - 4.7. Xử lý cuộc gọi đến (Inbound Call Flow)
   - 4.8. Quy trình cúp máy và giải phóng tài nguyên khép kín (`_finalizeCallTermination`)
   - 4.9. Sơ đồ tuần tự cuộc gọi WebRTC đầy đủ (Sequence Diagram)
   - 4.10. Trích dẫn mã nguồn thực tế & Phân tích chi tiết từng khối lệnh
5. [CHƯƠNG 5: PHÂN HỆ TIN NHẮN TỨC THỜI REALTIME (WAZO CHATD SUBSYSTEM)](#chương-5-phân-hệ-tin-nhắn-tức-thời-realtime-wazo-chatd-subsystem)
   - 5.1. Mô hình phòng chat 1-1 và phòng nhóm (Group Rooms)
   - 5.2. Cách ly dữ liệu theo User UUID trong `localStorage`
   - 5.3. Tạo phòng chat: Wazo Chatd REST API (`POST /api/chatd/1.0/users/me/rooms`)
   - 5.4. Gửi tin nhắn: Phản hồi giao diện tức thì 0ms (Optimistic UI) & REST API gửi tin
   - 5.5. Nhận tin nhắn thời gian thực: WebSocket Event `chatd_user_room_message_created`
   - 5.6. Thuật toán sắp xếp danh sách phòng chat theo nguồn chân lý duy nhất (SSOT Timestamp)
   - 5.7. Xử lý thành viên nhóm `(memberCount)` và nhận diện chat với chính mình `(Bạn)`
   - 5.8. Trích dẫn mã nguồn thực tế và đối chiếu API
6. [CHƯƠNG 6: PHÂN HỆ LỊCH SỬ CUỘC GỌI & BẢN GHI CDR (CALL DETAIL RECORDS)](#chương-6-phân-hệ-lịch-sử-cuộc-gọi--bản-ghi-cdr-call-detail-records)
   - 6.1. Vai trò của phân hệ CDR trong hệ thống viễn thông
   - 6.2. Nguồn dữ liệu kép (Dual-Source): Wazo Call-logd REST API + Local Immediate CDR
   - 6.3. Cấu trúc bản ghi CDR chuẩn (Direction, Status, Duration, Caller/Callee)
   - 6.4. Cơ chế phát tán sự kiện toàn cục `smartcall-cdr-updated`
   - 6.5. Bộ lọc 4 tab: ALL, INCOMINGS, OUTGOINGS, MISSED
   - 6.6. Trích dẫn mã nguồn thực tế
7. [CHƯƠNG 7: TẦNG XỬ LÝ ÂM THANH & WEB AUDIO API (AUDIO & MEDIA SUBSYSTEM)](#chương-7-tầng-xử-lý-âm-thanh--web-audio-api-audio--media-subsystem)
   - 7.1. Kiến trúc Audio Context độc lập không phụ thuộc file tĩnh ngoài
   - 7.2. Bộ phát âm tần đa âm (Dual Sine Oscillator): Nhạc chuông đến & Nhạc chuông đi
   - 7.3. Bộ phát âm phím DTMF chuẩn ITU-T
   - 7.4. Quản lý thiết bị Microphone & Loa (`audioinput`, `audiooutput`, `setSinkId`)
   - 7.5. Đồng hồ đo âm lượng Microphone thời gian thực (Mic Meter) & Thuật toán chống nhấp nháy (VAD Hangover)
   - 7.6. Trích dẫn mã nguồn thực tế
8. [CHƯƠNG 8: CẨM NANG VẤN ĐÁP KỸ THUẬT (EXECUTIVE DEFENSE FAQ)](#chương-8-cẩm-nang-vấn-đáp-kỹ-thuật-executive-defense-faq)
   - 10 câu hỏi cốt lõi giải trình kiến trúc trước Lãnh đạo & Hội đồng kỹ thuật

---

## CHƯƠNG 1: TỔNG QUAN KIẾN TRÚC TOÀN HỆ THỐNG & MÔ HÌNH DỮ LIỆU SSOT

### 1.1. Mục tiêu và Định vị Hệ thống
SmartCall Web là giải pháp tổng đài thoại doanh nghiệp (Enterprise Cloud Softphone) và nền tảng giao tiếp hợp nhất (Unified Communications - UC) hoạt động trên nền tảng trình duyệt web hiện đại.
Hệ thống kết nối trực tiếp với cụm máy chủ tổng đài **Wazo Platform** (kiến trúc mở dựa trên nền tảng Asterisk, Consul, RabbitMQ và các microservices chuyên trách như `wazo-auth`, `wazo-confd`, `wazo-dird`, `wazo-calld`, `wazo-chatd`, `wazo-call-logd`, `wazo-websocketd`).

### 1.2. Mô hình 5 tầng kiến trúc (Architectural Layers)
Để đảm bảo tính độc lập, khả năng mở rộng và dễ bảo trì, mã nguồn SmartCall Web được phân bổ chặt chẽ thành 5 tầng chức năng:

```
+---------------------------------------------------------------------------------+
| TẦNG 1: VIEW LAYER (GIAO DIỆN & ROUTING)                                         |
|  - LoginView.vue: Đăng nhập, quản lý phiên, cấu hình máy chủ                    |
|  - CallsView.vue: Bàn phím số DTMF, danh bạ nhanh, giao diện đàm thoại           |
|  - ContactsView.vue: Danh bạ doanh nghiệp, tìm kiếm, lọc phòng ban, trạng thái   |
|  - MessagesView.vue: Nhắn tin thời gian thực 1-1, chat nhóm, đếm tin chưa đọc    |
|  - HistoryView.vue: Lịch sử cuộc gọi CDR, phân loại Đến/Đi/Nhỡ, nghe lại ghi âm  |
|  - SettingsModal.vue: Cấu hình âm thanh (Mic/Loa), kiểm tra âm lượng             |
+---------------------------------------------------------------------------------+
                                      | (Event bindings & Actions)
                                      v
+---------------------------------------------------------------------------------+
| TẦNG 2: COMPONENT & UI WIDGET LAYER (THÀNH PHẦN TÁI SỬ DỤNG)                   |
|  - HeaderBar.vue: Chấm trạng thái người dùng, số máy lẻ cá nhân, tìm kiếm chung  |
|  - IncomingCallModal.vue: Popup thông báo cuộc gọi đến (Nhấc máy / Từ chối)      |
|  - CallOverlay.vue: Khung cuộc gọi thu nhỏ khi chuyển tab hoặc đa nhiệm         |
+---------------------------------------------------------------------------------+
                                      | (Reactive bindings)
                                      v
+---------------------------------------------------------------------------------+
| TẦNG 3: BUSINESS SERVICE LAYER (NGHIỆP VỤ & NGUỒN CHÂN LÝ SSOT)                |
|  - wazo.js: WazoService (Quản lý phiên Wazo, SIP phone, callStore tập trung)     |
|  - contactService.js: Đồng bộ danh bạ, thuật toán phân giải trạng thái statusOf  |
|  - chatService.js: Quản lý phòng chat, gửi/nhận tin nhắn, timestamp SSOT        |
|  - historyService.js: Đồng bộ và tổng hợp bản ghi CDR máy chủ + ghi nhận tại chỗ |
|  - loggerService.js: Ghi log phân tầng [AUTH], [CALL], [SIP], [PRESENCE], [CHAT] |
+---------------------------------------------------------------------------------+
                                      | (Signaling & Hardware abstraction)
                                      v
+---------------------------------------------------------------------------------+
| TẦNG 4: SIGNALING & HARDWARE LAYER (BÁO HIỆU & PHẦN CỨNG MEDIA)                  |
|  - Wazo WebRTC SDK (@wazo/sdk): Báo hiệu SIP over WebSocket, WebRTC PeerConn    |
|  - websocketService.js: Kênh WebSocket lắng nghe sự kiện Event Bus Wazo 2.0      |
|  - audioService.js: Web Audio API (Dual Sine Wave Ringback, Ringtone, DTMF, VAD) |
+---------------------------------------------------------------------------------+
                                      | (Network Protocols: WSS & HTTPS)
                                      v
+---------------------------------------------------------------------------------+
| TẦNG 5: INFRASTRUCTURE & WAZO BACKEND (CỤM MÁY CHỦ TỔNG ĐÀI)                    |
|  - HTTPS :9443/api/auth/0.1        -> Xác thực và cấp phát Session Token        |
|  - HTTPS :9443/api/confd/1.1       -> Cấu hình máy lẻ, User Profile             |
|  - HTTPS :9443/api/dird/0.1        -> Danh bạ nhân sự và nguồn dữ liệu nội bộ   |
|  - HTTPS :9443/api/chatd/1.0       -> Quản lý phòng chat và tin nhắn            |
|  - HTTPS :9443/api/call-logd/1.0   -> Lịch sử cuộc gọi chi tiết (CDR)           |
|  - WSS   :9443/api/asterisk/ws     -> Kênh SIP WebSocket cho WebRTC Media       |
|  - WSS   :9443/api/websocketd/?... -> Kênh phát sóng sự kiện thời gian thực     |
+---------------------------------------------------------------------------------+
```

### 1.3. Sơ đồ khối tổng thể hệ thống (System Architecture Diagram)

```mermaid
flowchart TD
    subgraph ClientBrowser["Trình duyệt Web (SmartCall Web Client)"]
        UI["Vue 3 UI Views<br/>(Calls, Contacts, Messages, History)"]
        
        subgraph CoreServices["Lớp Dịch vụ Nghiệp vụ (Single Source of Truth)"]
            CallStore["callStore (wazo.js)<br/>- activeCall<br/>- incomingCall<br/>- isRegistered"]
            ContactSvc["contactService.js<br/>- Danh bạ & statusOf()"]
            ChatSvc["chatService.js<br/>- Phòng & Tin nhắn"]
            HistSvc["historyService.js<br/>- Bản ghi CDR"]
        end
        
        subgraph HardwareAndSignaling["Tầng Báo hiệu & Media"]
            WazoSDK["@wazo/sdk (Phone WebRTC)"]
            AudioAPI["Web Audio API (audioService.js)<br/>- 440Hz+480Hz Sine Ringback<br/>- Dual Tone DTMF & VAD Mic Meter"]
            WSBridge["websocketService.js<br/>- Wazo Event Bus Client"]
        end
    end

    subgraph WazoPBX["Cụm Máy chủ Tổng đài Wazo (Wazo Platform Server)"]
        AuthSvr["wazo-auth (:9443)<br/>Cấp phát Token"]
        ConfdSvr["wazo-confd (:9443)<br/>Hồ sơ Người dùng"]
        DirdSvr["wazo-dird (:9443)<br/>Danh bạ Nội bộ"]
        ChatdSvr["wazo-chatd (:9443)<br/>Tin nhắn & Phòng chat"]
        CallLogdSvr["wazo-call-logd (:9443)<br/>Lịch sử CDR"]
        AsteriskWS["Asterisk WebRTC WSS (:9443)<br/>Báo hiệu SIP & Media RTP"]
        WSDaemon["wazo-websocketd (:9443)<br/>Phát sự kiện Presence & Chat"]
    end

    UI --> CoreServices
    CoreServices --> HardwareAndSignaling
    
    WazoSDK <-->|SIP over WSS| AsteriskWS
    WSBridge <-->|JSON Events WSS| WSDaemon
    CoreServices <-->|REST API JSON| AuthSvr
    CoreServices <-->|REST API JSON| ConfdSvr
    CoreServices <-->|REST API JSON| DirdSvr
    CoreServices <-->|REST API JSON| ChatdSvr
    CoreServices <-->|REST API JSON| CallLogdSvr
    AudioAPI -.->|Điều khiển luồng âm| UI
```

### 1.4. Nguyên tắc Single Source of Truth (SSOT) trong State Management
Trước đây, các cờ trạng thái (flags) như `isCalling`, `callStatus`, `activeCall` thường bị khai báo rải rác ở nhiều component (`CallsView`, `App.vue`, `HeaderBar`), dẫn đến hiện tượng lệch pha trạng thái (out-of-sync) khi người dùng chuyển trang hoặc thao tác nhanh.

Hệ thống đã chuẩn hóa triệt để theo nguyên tắc **Single Source of Truth (SSOT)**:
1. **Trạng thái Cuộc gọi (Telephony State):** Nằm duy nhất tại đối tượng phản ứng `callStore` được định nghĩa trong [wazo.js](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L11-L24):
   - `callStore.activeCall`: Lưu trữ thông tin cuộc gọi đi/cuộc gọi đang đàm thoại (hoặc `null` nếu rảnh).
   - `callStore.incomingCall`: Lưu trữ cuộc gọi đến đang đổ chuông (hoặc `null`).
   - `callStore.isRegistered`: Cờ đăng ký SIP thành công với tổng đài.
   - Các Component UI (`CallsView.vue`, `HeaderBar.vue`, `CallOverlay.vue`) chỉ `computed` từ `callStore`, không tự sinh biến cờ riêng.
2. **Trạng thái Người dùng & Hiện diện (Presence State):** Tập trung tại `contactService.presences`. Mọi màn hình cần biết trạng thái một người dùng đều bắt buộc gọi qua hàm [contactService.statusOf(uuid)](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L55-L75).
3. **Trạng thái Phòng Chat & Tin nhắn (Chat State):** Tập trung tại `chatService.js`. Trật tự sắp xếp danh sách phòng chat tuân theo trường `updatedAt` được tính toán thuần túy từ thời gian của tin nhắn cuối cùng (`timestamp` SSOT), tuyệt đối không gán `Date.now()` tùy tiện khi người dùng chỉ bấm vào xem phòng.

### 1.5. Phân định ranh giới giữa Dự án Chính và Môi trường Kiểm thử Độc lập
Hệ thống tuân thủ nghiêm ngặt ranh giới giữa 2 môi trường:
- **`Smart_Call_Web` (`d:\Project\Smart_Call_Web`)**: Mã nguồn chuẩn production đẩy lên Git công ty. 100% dữ liệu thực từ máy chủ Wazo. Tuyệt đối không chứa bất kỳ mảng dữ liệu giả lập (mock data), không chứa cờ timer nhấc máy giả lập.
- **`Smart_Call_Web_Mock` (`d:\Project\Smart_Call_Web_Mock`)**: Môi trường kiểm thử ngoại tuyến độc lập khi máy chủ tổng đài không khả dụng. Chứa các mảng dữ liệu mẫu `MOCK_CONTACTS`, `MOCK_HISTORY`, `INITIAL_MOCK_ROOMS` và timer giả lập nhấc máy phục vụ kiểm tra trải nghiệm giao diện người dùng.

---

## CHƯƠNG 2: PHÂN HỆ XÁC THỰC, PHIÊN LÀM VIỆC & KẾT NỐI TỔNG ĐÀI

### 2.1. Quy trình Đăng nhập tại `LoginView.vue`
Khi người dùng truy cập ứng dụng, nếu chưa có phiên hợp lệ, Router sẽ chuyển hướng về màn hình đăng nhập [LoginView.vue](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue).
Người dùng nhập Tên đăng nhập (Username), Mật khẩu (Password) và địa chỉ máy chủ tổng đài Wazo (mặc định: `107.126.11.126:9443`).

Khi bấm nút **Đăng nhập**, phương thức [handleLogin](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue#L183-L255) được kích hoạt:

```javascript
// Trích dẫn từ src/views/LoginView.vue (Dòng 183-205)
const handleLogin = async () => {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) return

  loading.value = true
  errorMessage.value = ''

  let realDisplayName = ''
  let realExtension = ''

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout máy chủ Wazo')), 15000),
    )
    const session = await Promise.race([wazoService.login(u, p), timeoutPromise])

    // 1. Trích xuất thông tin người dùng trực tiếp từ Session SDK (không phát sinh CORS preflight)
    const profile = session?.profile || wazoService.session?.profile || {}
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
    realDisplayName = fullName || session?.displayName || u
```

### 2.2. Chi tiết Wazo Auth REST API
Phương thức `wazoService.login(username, password)` gọi vào SDK `Wazo.Auth.logIn(username, password)`, bản chất là gửi một HTTP POST request chuẩn tới microservice `wazo-auth`:

- **Endpoint:** `POST https://107.126.11.126:9443/api/auth/0.1/token`
- **Request Headers:**
  ```http
  POST /api/auth/0.1/token HTTP/1.1
  Host: 107.126.11.126:9443
  Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=
  Content-Type: application/json
  Accept: application/json
  ```
  *(Chuỗi base64 được tạo từ `username:password`)*
- **Request Body (JSON):**
  ```json
  {
    "backend": "wazo_user",
    "expiration": 1209600
  }
  ```
  *(Thời gian sống của token được yêu cầu là 14 ngày = 1,209,600 giây)*
- **Response Format (JSON 200 OK):**
  ```json
  {
    "data": {
      "token": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "refresh_token": "f0e1d2c3-b4a5-6789-0123-456789abcdef",
      "expires_at": "2026-11-30T17:00:00.000000Z",
      "utc_expires_at": "2026-11-30T17:00:00.000000Z",
      "issued_t": 1794760000,
      "auth_id": "99999999-aaaa-bbbb-cccc-dddddddddddd",
      "session_uuid": "11111111-2222-3333-4444-555555555555",
      "wazo_uuid": "33333333-4444-5555-6666-777777777777",
      "metadata": {
        "uuid": "user-uuid-1001",
        "tenant_uuid": "tenant-uuid-default",
        "username": "alice"
      }
    }
  }
  ```

### 2.3. Vòng đời Token: Cấp phát, Lưu trữ bảo mật, Refresh Token và Tự phục hồi phiên
Sau khi nhận phản hồi từ `Wazo.Auth.logIn`, `wazoService` thực hiện lưu trữ các trường thiết yếu vào `localStorage` phục vụ việc tự động phục hồi phiên làm việc khi người dùng F5 tải lại trang:

```javascript
// Trích dẫn từ src/services/wazo.js (Dòng 48-68)
this.session = await Wazo.Auth.logIn(username, password)
if (this.session && this.session.token) {
  localStorage.setItem('smartcall_wazo_token', this.session.token)
  localStorage.setItem('smartcall_wazo_refreshToken', this.session.refreshToken || '')
  if (this.session.uuid) {
    localStorage.setItem('smartcall_user_uuid', this.session.uuid)
    callStore.myUserUuid = this.session.uuid
  }
  let exten = ''
  try {
    exten = this.session.primaryNumber?.() || ''
  } catch (e) {}
  if (exten) {
    localStorage.setItem('smartcall_user_exten', exten)
    localStorage.setItem('smartcall_extension', exten)
    callStore.myExtension = exten
  }
  callStore.myUserName = this.getMyUserName()
  logger.success('AUTH', `Đăng nhập Wazo thành công! UUID: ${this.session.uuid || 'N/A'}`)
}
```

Khi ứng dụng khởi động lại ([wazo.js:69-80](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L69-L80)), hàm `loadExistingSession()` kiểm tra `smartcall_wazo_token` có sẵn trong bộ nhớ. Nếu hợp lệ, phiên làm việc được tái kích hoạt mà không bắt người dùng phải đăng nhập lại.

### 2.4. Trích xuất thông tin User Profile & Số máy lẻ (Extension)
Để tránh phát sinh lỗi CORS Preflight (OPTIONS request) vốn hay bị chặn trên các môi trường máy chủ viễn thông khắt khe, SmartCall Web ưu tiên trích xuất trực tiếp thông tin từ đối tượng Session của Wazo SDK:
- Tên đầy đủ: `session.profile.firstName` + `session.profile.lastName` hoặc fallback sang `session.displayName`.
- Số máy lẻ: `session.primaryNumber()`.
- Trường hợp dự phòng nếu SDK không trả về số máy lẻ, hệ thống mới thực hiện gọi API:
  - `GET https://107.126.11.126:9443/api/confd/1.1/users/me`
  - Header: `X-Auth-Token: <token>`
  - Trích xuất: `meData.lines[0].extensions[0].exten`.

### 2.5. Khởi tạo Phone WebRTC SIP Phone (`Wazo.Phone.connect()`)
Ngay sau khi xác thực thành công, hệ thống tự động kết nối tầng báo hiệu WebRTC SIP bằng phương thức [connectPhone()](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L286-L300):

```javascript
// Trích dẫn từ src/services/wazo.js (Dòng 286-299)
async connectPhone() {
  if (this.phoneConnected) return
  try {
    this.init()
    logger.info('SIP', 'Đang thiết lập kết nối WebRTC Phone...')
    this._bindPhoneEvents()
    await Wazo.Phone.connect({
      audio: true,
      video: false,
    })
    this.phoneConnected = true
    logger.success('SIP', 'WebRTC Phone đã kết nối và sẵn sàng thực hiện cuộc gọi.')
  } catch (err) {
    logger.warn('SIP', 'Không thể khởi tạo WebRTC Phone:', err.message)
    throw err
  }
}
```

Bản chất của phương thức này là khởi tạo một kết nối WebSocket bảo mật tới Asterisk:
`wss://107.126.11.126:9443/api/asterisk/ws`
Tại đây, thư viện SIP.js nhúng trong Wazo SDK gửi bản tin `SIP REGISTER` để khai báo máy lẻ của người dùng đã trực tuyến trên tổng đài.

### 2.6. Khởi tạo cầu nối sự kiện Wazo Event Bus WebSocket
Đồng thời, hệ thống mở một kênh WebSocket chuyên dụng tới daemon `wazo-websocketd` bằng phương thức [openWebSocketEvents()](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L213-L270):
- **URL WebSocket:** `wss://107.126.11.126:9443/api/websocketd/?token=<token>&version=2`
- **Nhiệm vụ:** Lắng nghe toàn bộ sự kiện thời gian thực của tổng đài:
  - `chatd_user_room_message_created`: Khi có tin nhắn chat mới gửi đến.
  - `users_services_dnd_updated`: Khi có người dùng bật/tắt chế độ Không làm phiền (DND).
  - `user_presence_updated`: Khi trạng thái trực tuyến của nhân sự thay đổi.
  - `call_created`, `call_ended`: Các biến động trạng thái đường dây.

### 2.7. Sơ đồ tuần tự Đăng nhập & Khởi tạo phiên (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng (Client)
    participant LoginView as LoginView.vue
    participant WazoSvc as wazoService (wazo.js)
    participant WazoAuth as wazo-auth (:9443)
    participant AsteriskWS as Asterisk SIP WS
    participant WazoWS as wazo-websocketd

    User->>LoginView: Nhập Username, Password & Bấm Đăng nhập
    LoginView->>WazoSvc: login(username, password)
    WazoSvc->>WazoAuth: POST /api/auth/0.1/token (Basic Auth)
    WazoAuth-->>WazoSvc: 200 OK (token, refresh_token, session_uuid)
    WazoSvc->>WazoSvc: Lưu token & user_uuid vào localStorage
    WazoSvc->>WazoWS: Kết nối wss://.../api/websocketd/?token=...
    WazoWS-->>WazoSvc: WebSocket Connected (Sẵn sàng nhận Event Bus)
    WazoSvc->>AsteriskWS: Kết nối wss://.../api/asterisk/ws
    AsteriskWS-->>WazoSvc: SIP REGISTER 200 OK (callStore.isRegistered = true)
    WazoSvc-->>LoginView: Trả về đối tượng Session hoàn chỉnh
    LoginView->>User: Chuyển hướng sang màn hình Cuộc gọi (/calls)
```

---

## CHƯƠNG 3: PHÂN HỆ HIỆN DIỆN TRỰC TUYẾN & ĐỒNG BỘ DANH BẠ

### 3.1. Cơ chế đồng bộ Danh bạ từ Wazo Dird API (`contactService.js`)
Dữ liệu danh bạ nhân sự trong doanh nghiệp không được lưu cố định (hardcoded) mà được tải động 100% từ máy chủ tổng đài Wazo thông qua phân hệ [contactService.js](file:///d:/Project/Smart_Call_Web/src/services/contactService.js).

Khi vào màn hình Danh bạ ([ContactsView.vue](file:///d:/Project/Smart_Call_Web/src/views/ContactsView.vue)), hàm [getContacts()](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L95-L160) được gọi:
1. Gửi request lấy định danh nguồn danh bạ nội bộ Wazo:
   `GET https://107.126.11.126:9443/api/dird/0.1/directories/default/sources?backend=wazo`
   Header: `X-Auth-Token: <token>`
2. Trích xuất `sourceUuid` từ kết quả trả về (thường là nguồn danh bạ người dùng Asterisk).
3. Gửi tiếp request truy vấn toàn bộ danh bạ:
   `GET https://107.126.11.126:9443/api/dird/0.1/backends/wazo/sources/<sourceUuid>/contacts?limit=1000`

### 3.2. Chuẩn hóa dữ liệu danh bạ đầu vào (Data Normalization)
Dữ liệu trả về từ Wazo Dird có cấu trúc mảng đa tầng. `contactService.js` thực hiện chuẩn hóa dữ liệu về định dạng chuẩn (Normalizer pattern):

```javascript
// Trích dẫn từ src/services/contactService.js
const normalized = items.map((c) => {
  const uuid = c.uuid || c.user_uuid || ''
  const name = c.name || [c.firstname, c.lastname].filter(Boolean).join(' ') || 'Chưa đặt tên'
  const number = c.exten || c.number || ''
  const presenceInfo = this.statusOf(uuid)
  return {
    id: uuid || number,
    uuid: uuid,
    name: name,
    dept: c.department || c.organization || 'Nội bộ',
    number: number,
    status: presenceInfo.key,       // 'online' | 'busy' | 'ringing' | 'dnd' | 'away' | 'offline'
    statusText: presenceInfo.label, // 'Trực tuyến' | 'Đang gọi' | 'Đang đổ chuông' | ...
    avatar: name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase(),
    favorite: favorites.includes(uuid || number),
  }
})
```

### 3.3. Cơ chế lắng nghe sự kiện Presence thời gian thực
Khi trạng thái của bất kỳ người dùng nào trong công ty thay đổi (ví dụ: đang bận nghe điện thoại, chuyển sang vắng mặt, bật không làm phiền), daemon `wazo-websocketd` sẽ bắn sự kiện `wazo-presence-updated` về trình duyệt.
Tại [contactService.js:18-35](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L18-L35), trình lắng nghe sự kiện sẽ cập nhật ngay lập tức vào bảng băm `this.presences[userUuid]` và phát tín hiệu cho giao diện Vue tự động re-render mà không cần reload trang.

### 3.4. Thuật toán phân giải trạng thái người dùng `statusOf(uuid)` chuẩn 100% Wazo PBX
Đây là thuật toán trọng yếu bậc nhất của hệ thống, được đối chiếu chuẩn 100% theo mã nguồn tham chiếu mẫu của tổng đài Wazo tại [contactService.js:55-75](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L55-L75):

```javascript
// Trích dẫn nguyên bản từ src/services/contactService.js (Dòng 55-75)
statusOf(uuid) {
  const p = uuid && this.presences[uuid]
  if (!p) return { key: 'offline', label: 'Ngoại tuyến' }
  
  const lines = (p.lines || []).map((l) => l.state)
  
  // 1. Nếu đường dây đang trong trạng thái nói chuyện hoặc giữ máy -> BẬN
  if (lines.some((s) => s === 'talking' || s === 'holding'))
    return { key: 'busy', label: 'Đang gọi' }
    
  // 2. Nếu đường dây đang đổ chuông hoặc đang kết nối -> ĐỔ CHUÔNG
  if (lines.some((s) => s === 'ringing' || s === 'progressing'))
    return { key: 'ringing', label: 'Đang đổ chuông' }
    
  // 3. Nếu bật chế độ Không làm phiền -> DND
  if (p.do_not_disturb) 
    return { key: 'dnd', label: 'Không làm phiền' }
    
  // 4. Kiểm tra tính khả dụng của đường dây và trạng thái kết nối
  const online = lines.length
    ? lines.some((s) => s !== 'unavailable')
    : p.connected === true || p.state === 'available' || p.state === 'online' || p.line_state === 'available'
    
  if (!online || p.state === 'unavailable' || p.state === 'offline') 
    return { key: 'offline', label: 'Ngoại tuyến' }
    
  // 5. Nếu vắng mặt -> AWAY
  if (p.state === 'away') 
    return { key: 'away', label: 'Vắng mặt' }
    
  // 6. Mặc định khả dụng -> ONLINE
  return { key: 'online', label: 'Trực tuyến' }
}
```

### 3.5. Hệ thống hiển thị trực quan đa sắc thái (Color-coded Presence Indicator)
Hệ thống sử dụng bảng mã màu trực quan chuẩn viễn thông quốc tế được định nghĩa thống nhất tại [HeaderBar.vue](file:///d:/Project/Smart_Call_Web/src/components/HeaderBar.vue), [CallsView.vue](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue) và [ContactsView.vue](file:///d:/Project/Smart_Call_Web/src/views/ContactsView.vue):

| Khóa (Key) | Nhãn hiển thị | Mã màu Hex | Ý nghĩa viễn thông | Hành vi khi bấm gọi |
| :--- | :--- | :--- | :--- | :--- |
| `online` | Trực tuyến | `#10b981` (Xanh lục) | Máy lẻ đã đăng ký SIP, sẵn sàng nhận cuộc gọi | Cho phép gọi ngay |
| `busy` | Đang gọi | `#f59e0b` (Cam đậm) | Máy đang đàm thoại (`talking` / `holding`) | **Chặn cuộc gọi**, báo máy bận |
| `ringing` | Đang đổ chuông | `#8b5cf6` (Tím nhạt) | Máy đang có chuông đến hoặc đi | Cảnh báo máy đang bận chuông |
| `dnd` | Không làm phiền | `#ef4444` (Đỏ) | Bật Do Not Disturb | Cảnh báo không làm phiền |
| `away` | Vắng mặt | `#eab308` (Vàng) | Người dùng tạm rời bàn làm việc | Cho phép gọi (kèm cảnh báo) |
| `offline` | Ngoại tuyến | `#9ca3af` (Xám) | Mất kết nối tổng đài / Chưa đăng ký SIP | **Chặn cuộc gọi**, gợi ý nhắn tin |

### 3.6. Cơ chế Tìm kiếm (Search Engine) lọc theo Tên, Số máy lẻ, Phòng ban
Hàm [matchesSearch](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L80-L90) chuẩn hóa chuỗi Unicode tiếng Việt về chữ thường và thực hiện so khớp đồng thời trên cả 3 trường: `name`, `dept` và `number`, cho phép người dùng chỉ cần gõ 1 phần số máy lẻ (ví dụ: `100`) hoặc tên phòng ban (ví dụ: `Kỹ thuật`) là kết quả được lọc tức thì trong O(N).

---

## CHƯƠNG 4: PHÂN HỆ CUỘC GỌI THOẠI WEBRTC (TELEPHONY & WEBRTC CALL FLOW)

### 4.1. Điểm khởi đầu cuộc gọi từ UI
Cuộc gọi có thể được kích hoạt từ 3 vị trí trên giao diện:
1. Người dùng bấm số trên bàn phím DTMF tại [CallsView.vue](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue) rồi bấm nút **Gọi**.
2. Người dùng bấm biểu tượng chiếc điện thoại xanh bên cạnh một người trong danh bạ nhanh.
3. Người dùng bấm nút **Gọi** tại màn hình Danh bạ [ContactsView.vue](file:///d:/Project/Smart_Call_Web/src/views/ContactsView.vue) hoặc màn hình Tin nhắn [MessagesView.vue](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue).

Tất cả các điểm kích hoạt trên đều hội tụ về **một cổng duy nhất (Single Entry Point)**:
`wazoService.validateAndMakeCall(extension, meta)`

### 4.2. Bộ lọc an toàn 7 lớp (7 Defense Gates) tại `validateAndMakeCall()`
Để bảo vệ hệ thống khỏi hiện tượng xung đột tài nguyên WebRTC (Collision), rò rỉ âm thanh (Audio leak) hoặc gọi nhầm số không hợp lệ, hệ thống thiết lập bộ lọc 7 lớp bảo vệ nghiêm ngặt tại [src/services/wazo.js:740-948](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L740-L948):

```
Người dùng bấm Gọi
       |
       v
+--------------------------------------------------------------+
| GATE 1: THROTTLE 1200ms (Khóa bấm nhanh)                     |
|  -> Chống người dùng click đúp hoặc spam phím gọi liên tục.   |
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 2: LOCAL BUSY CHECK (Kiểm tra cuộc gọi hiện tại)        |
|  -> Chặn nếu `callStore.activeCall` đang tồn tại.             |
|  -> Bắt buộc cúp máy hiện tại trước khi gọi số mới.          |
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 3: SELF-CALL CHECK (Chặn tự gọi chính mình)             |
|  -> Nếu `cleanExt === myExtension` -> Cảnh báo toast và chặn.|
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 4: PRESENCE & OFFLINE/BUSY VALIDATION                   |
|  -> Nếu đối phương `busy` -> Chặn: "Máy bận".                |
|  -> Nếu đối phương `offline` -> Chặn: Hiển thị hộp thoại     |
|     gợi ý chuyển sang nhắn tin chat.                         |
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 5: HARDWARE MICROPHONE AUDIT (Kiểm tra phần cứng)       |
|  -> Gọi `navigator.mediaDevices.enumerateDevices()`           |
|  -> Nếu máy tính không có microphone -> Hủy lệnh gọi, cảnh   |
|     báo cắm tai nghe/mic để bảo toàn trải nghiệm WebRTC.      |
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 6: SIP REGISTRATION READINESS (Kiểm tra SIP Phone)      |
|  -> Kiểm tra `Wazo.Phone.isRegistered()`                      |
|  -> Nếu rớt mạng SIP -> Tự động kích hoạt `connectPhone()`.   |
+--------------------------------------------------------------+
       | Hợp lệ
       v
+--------------------------------------------------------------+
| GATE 7: SESSION INITIALIZATION & RINGBACK TONE               |
|  -> Khởi tạo `callStore.activeCall = { status: 'progressing' }`
|  -> Bật âm chuông đi Web Audio API (440Hz + 480Hz).          |
|  -> Phát lệnh gọi thực tế: `Wazo.Phone.call(cleanExt, false)`|
+--------------------------------------------------------------+
```

### 4.3. Phát lệnh gọi âm thoại audio-only `Wazo.Phone.call(extension, false)`
Tại [wazo.js:613-624](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L613-L624), phương thức gọi thoại thuần túy được thực thi:

```javascript
// Trích dẫn từ src/services/wazo.js (Dòng 613-624)
async makeCall(extension) {
  try {
    this.init()
    logger.info('CALL', `Bắt đầu cuộc gọi audio-only tới: ${extension}`)
    // Tham số thứ 2 là false: chỉ gọi audio, không truyền video stream
    const session = await Wazo.Phone.call(extension, false)
    this.currentCallSession = session
    return session
  } catch (err) {
    logger.error('CALL', 'Lỗi khi gọi qua Wazo Phone SDK:', err)
    throw err
  }
}
```

### 4.4. Cơ chế tạo âm chuông đi (Ringback Tone) bằng Web Audio API thuần
Khác với các hệ thống truyền thống phải tải file âm thanh `.mp3` từ bên ngoài (dễ bị lỗi 404, CORS hoặc trễ mạng), SmartCall Web ứng dụng giải pháp **tổng hợp âm thuần túy bằng Web Audio API** tại [audioService.js:124-185](file:///d:/Project/Smart_Call_Web/src/services/audioService.js#L124-L185):
- Sử dụng 2 bộ dao động sóng hình sin (Dual Sine Wave Oscillators): tần số **440 Hz** và **480 Hz** chuẩn viễn thông quốc tế.
- Chu kỳ phát âm: Kêu 2 giây -> Ngắt 4 giây -> Lặp lại.
- Dùng `GainNode.linearRampToValueAtTime()` để vuốt êm âm lượng lúc bắt đầu và kết thúc xung âm, triệt tiêu hoàn toàn tiếng nổ "lụp bụp" (audio click/pop) gây chói tai người dùng.

### 4.5. Luồng tín hiệu SIP qua Asterisk WebSocket
Quá trình thương thảo WebRTC giữa trình duyệt và máy chủ tổng đài Wazo diễn ra qua giao thức SIP:
1. Trình duyệt gửi bản tin **`SIP INVITE`** kèm mô tả SDP (Session Description Protocol) chứa codec âm thanh (Opus, PCMU/PCMA).
2. Tổng đài định tuyến tới máy lẻ nhận và gửi phản hồi **`SIP 100 Trying`** (Tổng đài đang xử lý).
3. Máy lẻ nhận bắt đầu đổ chuông, tổng đài gửi lại bản tin **`SIP 180 Ringing`**. Wazo SDK phát sự kiện `ON_CALL_PROGRESS`.
4. Khi người nhận bấm nút Nhấc máy, tổng đài gửi bản tin **`SIP 200 OK`** kèm SDP Answer của máy nhận. Wazo SDK phát sự kiện `ON_CALL_ACCEPTED`.
5. Trình duyệt gửi bản tin **`SIP ACK`** xác nhận hoàn tất thiết lập kết nối và kênh truyền âm thanh RTP bắt đầu trao đổi dữ liệu qua WebRTC PeerConnection.

### 4.6. Xử lý các sự kiện vòng đời cuộc gọi trong SDK
Trong phương thức `_bindPhoneEvents()` tại [wazo.js:435-590](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L435-L590), hệ thống bắt các sự kiện chính thức từ Wazo SDK:

1. **`ON_CALL_PROGRESS` (Dòng 435):**
   - Đánh dấu trạng thái `callStore.activeCall.status = 'ringing'`.
   - Giữ nguyên Ringback tone để người gọi nghe thấy chuông đổ.
2. **`ON_CALL_ACCEPTED` (Dòng 504):**
   - Người nhận đã nhấc máy.
   - Ngắt ngay lập tức Ringback tone: `audioService.stopRingbackTone()`.
   - Cập nhật trạng thái `callStore.activeCall.status = 'connected'`.
   - Bắt đầu tính giây đàm thoại: `timerInterval`.
   - Gắn luồng âm thanh MediaStream của người nhận vào thẻ `<audio id="wazo-remote-audio">` để phát ra loa:
     ```javascript
     playRemoteStream(stream) {
       let audioEl = document.getElementById('wazo-remote-audio')
       if (!audioEl) {
         audioEl = document.createElement('audio')
         audioEl.id = 'wazo-remote-audio'
         audioEl.autoplay = true
         document.body.appendChild(audioEl)
       }
       audioEl.srcObject = stream
       audioEl.play().catch(e => console.warn('Lỗi phát âm thanh đàm thoại:', e))
     }
     ```
3. **`ON_CALL_ENDED` / `ON_CALL_FAILED` (Dòng 570-588):**
   - Cuộc gọi kết thúc, bị từ chối hoặc gặp lỗi mạng.
   - Kích hoạt cơ chế dọn dẹp khép kín: `_finalizeCallTermination(reason, callSession)`.

### 4.7. Xử lý cuộc gọi đến (Inbound Call Flow)
Khi có cuộc gọi từ người khác gọi vào máy lẻ của người dùng:
1. Wazo SDK bắt sự kiện `Wazo.Phone.ON_CALL_INCOMING`.
2. Trích xuất thông tin người gọi: Số máy lẻ, Tên hiển thị.
3. Kích hoạt chuông gọi đến: `audioService.startIncomingRingtone()`.
4. Gán `callStore.incomingCall = { session, callerNumber, callerName }`.
5. Giao diện bật Modal cuộc gọi đến [IncomingCallModal.vue](file:///d:/Project/Smart_Call_Web/src/components/IncomingCallModal.vue):
   - **Bấm Nhấc máy:** Gọi `Wazo.Phone.accept(session)`. Dừng chuông đến, chuyển `callStore.incomingCall` thành `callStore.activeCall`.
   - **Bấm Từ chối:** Gọi `Wazo.Phone.reject(session)`. Dừng chuông đến, giải phóng tài nguyên.

### 4.8. Quy trình cúp máy và giải phóng tài nguyên khép kín (`_finalizeCallTermination`)
Hàm [_finalizeCallTermination](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L341-L410) là chốt chặn quan trọng nhất để triệt tiêu mọi nguy cơ kẹt trạng thái (stuck state) hoặc rò rỉ âm thanh (audio leaking):

```javascript
// Trích dẫn từ src/services/wazo.js (Dòng 341-385)
_finalizeCallTermination(reason = 'ended', session = null) {
  if (this._isTerminating) return
  this._isTerminating = true

  // 1. Dừng ngay lập tức toàn bộ âm thanh chuông đi và chuông đến
  audioService.stopRingbackTone()
  audioService.stopIncomingRingtone()
  this.stopRemoteAudio()

  // 2. Tự động ghi lại bản ghi lịch sử cuộc gọi (CDR)
  if (callStore.activeCall) {
    historyService.addRecord({
      number: callStore.activeCall.number,
      name: callStore.activeCall.name,
      direction: callStore.activeCall.direction || 'outgoing',
      duration: callStore.activeCall.duration || 0,
      status: reason === 'ended' && callStore.activeCall.duration > 0 ? 'answered' : 'missed',
      timestamp: Date.now(),
    })
  }

  // 3. Đưa biến cờ toàn cục về trạng thái rảnh rỗi (idle)
  callStore.activeCall = null
  callStore.incomingCall = null
  this.currentCallSession = null

  setTimeout(() => {
    this._isTerminating = false
  }, 500)
}
```

### 4.9. Sơ đồ tuần tự cuộc gọi WebRTC đầy đủ (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Người gọi (Alice - Ext 1001)
    participant UI as CallsView.vue
    participant WazoSvc as wazoService (wazo.js)
    participant AudioSvc as audioService.js
    participant Asterisk as Asterisk Wazo PBX
    actor Callee as Người nhận (Bob - Ext 1002)

    Caller->>UI: Bấm số '1002' & Bấm GỌI
    UI->>WazoSvc: validateAndMakeCall('1002')
    Note over WazoSvc: Vượt qua 7 Gate bảo vệ (Throttle, Presence, Mic, SIP)
    WazoSvc->>AudioSvc: startRingbackTone() (440Hz + 480Hz Sine)
    AudioSvc-->>Caller: [Tút... Tút... Tút...]
    WazoSvc->>Asterisk: SIP INVITE (Opus Audio SDP)
    Asterisk->>Callee: SIP INVITE -> Đổ chuông điện thoại Bob
    Asterisk-->>WazoSvc: SIP 180 Ringing
    WazoSvc->>UI: Cập nhật activeCall.status = 'ringing'
    
    Callee->>Asterisk: Bấm NHẤC MÁY (SIP 200 OK)
    Asterisk-->>WazoSvc: SIP 200 OK (SDP Answer)
    WazoSvc->>Asterisk: SIP ACK
    WazoSvc->>AudioSvc: stopRingbackTone() (Ngắt chuông chờ)
    WazoSvc->>WazoSvc: playRemoteStream(remoteAudioStream)
    WazoSvc->>UI: Cập nhật activeCall.status = 'connected' (Bắt đầu đếm giây)
    
    Note over Caller, Callee: HAI BÊN ĐÀM THOẠI THỜI GIAN THỰC (RTP WebRTC)
    
    Caller->>UI: Bấm CÚP MÁY (Hangup)
    UI->>WazoSvc: hangup()
    WazoSvc->>Asterisk: SIP BYE
    Asterisk-->>WazoSvc: SIP 200 OK
    WazoSvc->>WazoSvc: _finalizeCallTermination('ended')
    WazoSvc->>UI: activeCall = null (Trở về màn hình bàn phím)
```

---

## CHƯƠNG 5: PHÂN HỆ TIN NHẮN TỨC THỜI REALTIME (WAZO CHATD SUBSYSTEM)

### 5.1. Mô hình phòng chat 1-1 và phòng nhóm (Group Rooms)
Phân hệ nhắn tin được quản lý tập trung bởi [chatService.js](file:///d:/Project/Smart_Call_Web/src/services/chatService.js) và hiển thị qua giao diện [MessagesView.vue](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue):
- **Phòng chat 1-1 (Direct Chat):** Kết nối giữa 2 máy lẻ nhân sự. Tên phòng mang tên đối phương, avatar hiển thị 2 chữ cái viết tắt của người đó. Nếu nhắn với chính máy lẻ của mình, hệ thống tự động gắn nhãn `(Bạn)` và gán màu xanh lục để phân biệt rõ ràng.
- **Phòng chat nhóm (Group Chat):** Nhiều thành viên tham gia. Avatar hiển thị icon `👥` với nền gradient tím nhận diện, hiển thị số thành viên thực tế của nhóm `(memberCount)`.

### 5.2. Cách ly dữ liệu theo User UUID trong `localStorage`
Để đảm bảo tính bảo mật và độc lập dữ liệu giữa các tài khoản khác nhau khi đăng nhập trên cùng một trình duyệt, bộ nhớ đệm phòng chat được định danh theo UUID của người dùng:
`smartcall_chat_rooms_<UserUUID>`
Khi tài khoản B đăng nhập, hệ thống tải dữ liệu phòng của tài khoản B, hoàn toàn không bị lẫn lộn tin nhắn với tài khoản A.

### 5.3. Tạo phòng chat: Wazo Chatd REST API
Khi người dùng bấm nút **Tạo nhóm** hoặc mở chat 1-1 với một liên hệ chưa có phòng:
- **Endpoint:** `POST https://107.126.11.126:9443/api/chatd/1.0/users/me/rooms`
- **Headers:**
  ```http
  POST /api/chatd/1.0/users/me/rooms HTTP/1.1
  X-Auth-Token: <token>
  Content-Type: application/json
  ```
- **Payload:**
  ```json
  {
    "name": "Nhóm Dự Án Viễn Thông",
    "users": [
      { "uuid": "user-uuid-1001" },
      { "uuid": "user-uuid-1002" }
    ]
  }
  ```

### 5.4. Gửi tin nhắn: Phản hồi giao diện tức thì 0ms (Optimistic UI) & REST API gửi tin
Để mang lại trải nghiệm mượt mà không độ trễ, phương thức [sendMessage](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L415-L480) áp dụng mô hình **Optimistic UI**:
1. Ngay khi bấm Gửi, tin nhắn lập tức được tạo với trạng thái `pending` và đẩy vào giao diện người dùng hiển thị ngay (độ trễ 0ms).
2. Đồng thời, một HTTP POST request được gửi ngầm tới máy chủ Wazo:
   - **Endpoint:** `POST https://107.126.11.126:9443/api/chatd/1.0/users/me/rooms/<roomId>/messages`
   - **Payload:**
     ```json
     {
       "content": "Nội dung tin nhắn trao đổi"
     }
     ```
3. Khi máy chủ trả về `201 Created`, trạng thái tin nhắn chuyển thành `delivered` (đã gửi thành công).

### 5.5. Nhận tin nhắn thời gian thực: WebSocket Event `chatd_user_room_message_created`
Khi đối phương gửi tin nhắn đến, daemon `wazo-websocketd` phát sự kiện WebSocket:
`chatd_user_room_message_created`
Hàm `handleIncomingMessage(data)` tại [chatService.js:76-130](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L76-L130) tiếp nhận:
- Tìm kiếm phòng chat tương ứng theo `room_uuid`.
- Nếu đang mở đúng phòng đó, đẩy tin nhắn vào danh sách và cuộn xuống cuối màn hình.
- Nếu đang ở tab khác hoặc mở phòng khác, tăng biến đếm `unread` của phòng đó và phát sự kiện cập nhật huy hiệu số (Badge) trên thanh Sidebar.

### 5.6. Thuật toán sắp xếp danh sách phòng chat theo nguồn chân lý duy nhất (SSOT Timestamp)
Một vấn đề thường gặp ở các ứng dụng nhắn tin là thứ tự phòng bị nhảy lộn xộn mỗi khi người dùng click vào xem phòng.
SmartCall Web khắc phục triệt để bằng cơ chế **SSOT Timestamp**:
- Trường `updatedAt` của phòng chat **chỉ được cập nhật duy nhất khi có tin nhắn mới phát sinh** (gửi đi hoặc nhận về).
- Tuyệt đối loại bỏ lệnh gán `Date.now()` tùy tiện khi chỉ bấm vào xem phòng.
- Danh sách phòng được sắp xếp giảm dần theo thời gian tin nhắn cuối cùng:
  ```javascript
  rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  ```
  Nhờ đó, phòng có tin nhắn mới nhất (ví dụ: 23:31) sẽ luôn nằm trên phòng có tin nhắn cũ hơn (23:30), bảo đảm tính trực quan và chuẩn mực trải nghiệm người dùng.

---

## CHƯƠNG 6: PHÂN HỆ LỊCH SỬ CUỘC GỌI & BẢN GHI CDR (CALL DETAIL RECORDS)

### 6.1. Vai trò của phân hệ CDR trong hệ thống viễn thông
Bản ghi chi tiết cuộc gọi (Call Detail Record - CDR) là dữ liệu pháp lý và nghiệp vụ cốt lõi của bất kỳ hệ thống tổng đài nào, lưu lại thời điểm gọi, hướng cuộc gọi, thời lượng đàm thoại và kết quả kết nối.

### 6.2. Nguồn dữ liệu kép (Dual-Source)
Hệ thống [historyService.js](file:///d:/Project/Smart_Call_Web/src/services/historyService.js) áp dụng mô hình nguồn kép thông minh:
1. **Nguồn Máy chủ (Wazo Call-logd API):**
   - **Endpoint:** `GET https://107.126.11.126:9443/api/call-logd/1.0/users/me/cdr?limit=50`
   - Cung cấp toàn bộ lịch sử tổng thể từ trước đến nay được lưu trên cơ sở dữ liệu của tổng đài.
2. **Nguồn Ghi nhận Tức thì Cục bộ (Local Immediate CDR):**
   - Khi một cuộc gọi vừa kết thúc trên trình duyệt, có thể mất từ vài giây đến nửa phút để microservice `wazo-call-logd` của tổng đài đồng bộ vào cơ sở dữ liệu.
   - Để người dùng không bị cảm giác "mất cuộc gọi vừa xong", ngay trong `_finalizeCallTermination`, hệ thống tự động ghi ngay một bản ghi CDR vào `localStorage` và hợp nhất (merge) không trùng lặp với danh sách từ server trả về.

### 6.3. Cấu trúc bản ghi CDR chuẩn
Một bản ghi CDR trong SmartCall Web được chuẩn hóa theo định dạng:
```typescript
interface CallRecord {
  id: string              // Mã định danh duy nhất (UUID)
  number: string          // Số máy lẻ đối phương (ví dụ: "1002")
  name: string            // Tên hiển thị người đàm thoại ("Bob Nguyễn")
  direction: 'inbound' | 'outbound' // Hướng: Gọi đến hay Gọi đi
  status: 'answered' | 'missed'     // Kết quả: Đã trả lời hay Cuộc gọi nhỡ
  duration: number        // Thời lượng đàm thoại tính bằng giây (ví dụ: 45)
  timestamp: number       // Dấu thời gian Unix Epoch (ms)
}
```

### 6.4. Cơ chế phát tán sự kiện toàn cục `smartcall-cdr-updated`
Mỗi khi có bản ghi cuộc gọi mới được tạo hoặc đồng bộ, `historyService` phát sự kiện toàn cục:
`window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))`
Màn hình [HistoryView.vue](file:///d:/Project/Smart_Call_Web/src/views/HistoryView.vue) và thẻ KPI Dashboard tự động cập nhật số liệu mới mà không cần thao tác tải lại trang.

### 6.5. Bộ lọc 4 tab: ALL, INCOMINGS, OUTGOINGS, MISSED
Giao diện lịch sử hỗ trợ 4 bộ lọc chuyên biệt với số đếm động chính xác:
- **TẤT CẢ (ALL):** Hiển thị toàn bộ lịch sử cuộc gọi.
- **GỌI ĐẾN (INCOMINGS):** Lọc theo `direction === 'inbound' && status === 'answered'`.
- **GỌI ĐI (OUTGOINGS):** Lọc theo `direction === 'outbound'`.
- **CUỘC GỌI NHỠ (MISSED):** Lọc theo `status === 'missed'`, hiển thị màu đỏ cảnh báo.

---

## CHƯƠNG 7: TẦNG XỬ LÝ ÂM THANH & WEB AUDIO API (AUDIO & MEDIA SUBSYSTEM)

### 7.1. Kiến trúc Audio Context độc lập không phụ thuộc file tĩnh ngoài
Toàn bộ phân hệ âm thanh của SmartCall Web được đóng gói tại [audioService.js](file:///d:/Project/Smart_Call_Web/src/services/audioService.js), hoạt động 100% dựa trên **Web Audio API** của trình duyệt. 
Hệ thống không phụ thuộc vào bất kỳ file âm thanh nhị phân (`.mp3` / `.wav`) nào trên đĩa, loại bỏ hoàn toàn các lỗi tải tài nguyên mạng và đảm bảo âm thanh phát tức thời với độ trễ dưới 5ms.

### 7.2. Bộ phát âm tần đa âm (Dual Sine Oscillator): Nhạc chuông đến & Nhạc chuông đi
1. **Âm chuông đi (Ringback Tone):**
   - Bộ tạo sóng: 2 nút `OscillatorNode` dạng sóng `sine`.
   - Tần số: **440 Hz** và **480 Hz** (tiêu chuẩn tín hiệu âm thoại Bắc Mỹ & Quốc tế).
   - Chu kỳ nhịp: 2 giây phát âm -> 4 giây im lặng.
2. **Âm chuông đến (Incoming Ringtone):**
   - Tần số kép **440 Hz** và **480 Hz**.
   - Chu kỳ nhịp dồn dập hơn: 1.6 giây kêu -> 2.0 giây nghỉ -> lặp lại.
   - Quản lý mảng `activeOscillators`: Mỗi khi tạo dao động mới, node được lưu vào mảng. Khi cuộc gọi kết thúc, phương thức `_stopAllActiveOscillators()` quét sạch toàn bộ các oscillator đang chạy, ngăn chặn triệt để hiện tượng chuông tiếp tục kêu dù đã ngắt máy.

### 7.3. Bộ phát âm phím DTMF chuẩn ITU-T
Khi người dùng bấm các phím số từ `0`-`9`, `*`, `#` trên bàn phím số lúc đang đàm thoại (để trả lời hệ thống tương tác thoại tự động IVR), phương thức [playDtmfTone(digit)](file:///d:/Project/Smart_Call_Web/src/services/audioService.js#L196-L245) kích hoạt ma trận tần số chuẩn ITU-T:

| Tần số DTMF | 1209 Hz | 1336 Hz | 1477 Hz |
| :--- | :---: | :---: | :---: |
| **697 Hz** | Phím 1 | Phím 2 | Phím 3 |
| **770 Hz** | Phím 4 | Phím 5 | Phím 6 |
| **852 Hz** | Phím 7 | Phím 8 | Phím 9 |
| **941 Hz** | Phím * | Phím 0 | Phím # |

### 7.4. Quản lý thiết bị Microphone & Loa (`audioinput`, `audiooutput`, `setSinkId`)
Tại modal Cài đặt [SettingsModal.vue](file:///d:/Project/Smart_Call_Web/src/components/SettingsModal.vue):
- Gọi `navigator.mediaDevices.enumerateDevices()` để quét toàn bộ thiết bị phần cứng kết nối vào máy tính.
- Phân loại tách biệt:
  - Thiết bị đầu vào: `kind === 'audioinput'` (Microphone rời, Tai nghe headset, Mic tích hợp).
  - Thiết bị đầu ra: `kind === 'audiooutput'` (Loa máy tính, Tai nghe).
- Sử dụng hàm chuẩn HTML5 `audioElement.setSinkId(deviceId)` để định tuyến âm thanh đàm thoại ra đúng thiết bị loa/tai nghe mà người dùng mong muốn, tránh làm phiền loa ngoài của máy tính.

### 7.5. Đồng hồ đo âm lượng Microphone thời gian thực (Mic Meter) & Thuật toán chống nhấp nháy (VAD Hangover)
Trong modal Cài đặt có một thanh đo âm lượng Mic thời gian thực. 
Trước đây, thanh đo thường bị nhấp nháy liên tục (flickering) khi người dùng nói chuyện do sóng âm tự nhiên có các điểm rơi biên độ về 0 giữa các âm tiết.

Hệ thống đã tích hợp thuật toán **VAD Hangover (Voice Activity Detection with Hangover Timer)**:
- Sử dụng `AudioContext.createAnalyser()` và tính toán công thức bình phương trung bình trọng số (RMS - Root Mean Square) trên dữ liệu miền thời gian (Time Domain Data):
  $$	ext{RMS} = \sqrt{rac{1}{N} \sum_{i=0}^{N-1} (x_i - 128)^2}$$
- Ngưỡng nhạy: `VAD_THRESHOLD = 10`.
- Thời gian giữ nhịp (Hangover Duration): `HANG_OVER_MS = 1000`. Khi phát hiện giọng nói vượt ngưỡng, cờ phát hiện tiếng nói được giữ nguyên trong tối thiểu 1.0 giây, giúp thanh đo chuyển động mượt mà, phản ánh đúng trạng thái nói của người dùng và hoàn toàn không bị chớp giật.

---

## CHƯƠNG 8: CẨM NANG VẤN ĐÁP KỸ THUẬT (EXECUTIVE DEFENSE FAQ)

Dưới đây là 10 câu hỏi cốt lõi mà Ban Giám đốc hoặc Hội đồng thẩm định kỹ thuật có thể đặt ra khi nghiệm thu dự án, kèm câu trả lời chuẩn xác và tự tin dựa trên thiết kế kiến trúc thực tế của SmartCall Web:

#### Câu hỏi 1: "Tại sao hệ thống của chúng ta không cần cài đặt thêm phần mềm gì trên máy người dùng mà vẫn gọi điện thoại được như Zoiper hay MicroSIP?"
> **Trả lời:**  
> Hệ thống ứng dụng công nghệ **WebRTC (Web Real-Time Communication)** được hỗ trợ gốc (native) bên trong tất cả trình duyệt hiện đại (Chrome, Edge, Firefox, Safari).  
> Tầng báo hiệu sử dụng thư viện SIP.js được Wazo SDK bao bọc, kết nối trực tiếp qua giao thức WebSocket bảo mật (`wss://`) tới Asterisk PBX của tổng đài để đăng ký số máy lẻ.  
> Luồng âm thanh thoại được mã hóa bằng chuẩn Codec Opus băng thông rộng chất lượng cao và trao đổi trực tiếp ngang hàng qua WebRTC PeerConnection, hoàn toàn không cần cài bất kỳ tiện ích bổ trợ hay phần mềm bên ngoài nào.

#### Câu hỏi 2: "Làm thế nào để ứng dụng biết được nhân viên A đang rảnh hay đang bận đàm thoại để người khác không gọi chen vào?"
> **Trả lời:**  
> Hệ thống duy trì một kết nối WebSocket thường trực tới dịch vụ `wazo-websocketd` trên tổng đài. Khi người dùng A có bất kỳ biến động đường dây nào, tổng đài sẽ bắn ngay bản tin `wazo-presence-updated`.  
> Tại Client, hàm `contactService.statusOf(uuid)` phân tích trạng thái các đường dây `lines[i].state`. Nếu phát hiện trạng thái `talking` hoặc `holding`, hệ thống xác định trạng thái là **`busy`** (chấm màu cam).  
> Khi người khác bấm gọi tới số này, bộ lọc an toàn Gate 4 tại `validateAndMakeCall()` sẽ lập tức chặn lại và thông báo máy bận, bảo vệ tuyệt đối không để xảy ra cuộc gọi chen ngang.

#### Câu hỏi 3: "Nếu người dùng bấm nút Gọi liên tục nhiều lần (spam click) thì có bị lỗi nghẽn tổng đài hay mở nhiều cuộc gọi đè lên nhau không?"
> **Trả lời:**  
> Hoàn toàn không thể xảy ra. Hệ thống thiết lập cơ chế **chống bấm nhanh (Throttle)** ở ngay Gate 1 của `validateAndMakeCall()` với khóa thời gian 1200ms (`this._isDialing = true`).  
> Đồng thời, ở Gate 2 có chốt chặn kiểm tra trạng thái toàn cục `callStore.activeCall`. Nếu đang có cuộc gọi hoạt động, hệ thống từ chối ngay lập tức mọi lệnh gọi mới và cảnh báo người dùng phải cúp máy cuộc gọi hiện tại trước.

#### Câu hỏi 4: "Tại sao nhạc chuông chờ (Ringback tone) và chuông đến không dùng file MP3 mà lại dùng Web Audio API?"
> **Trả lời:**  
> Dùng file MP3 tải từ server có 3 rủi ro lớn trong thực tế:  
> 1. Trễ mạng hoặc lỗi đường truyền khiến file không tải kịp, cuộc gọi đã kết nối mà chuông chưa kịp phát.  
> 2. Dính chính sách bảo mật trình duyệt hoặc lỗi CORS làm chặn file âm thanh.  
> 3. Khó ngắt dứt khoát khi cuộc gọi kết thúc nhanh, dễ dẫn đến hiện tượng "tiếng chuông ma" (chuông vẫn kêu dù đã ngắt máy).  
> Sử dụng Web Audio API cho phép chúng ta tự tổng hợp sóng sin đa tần (440Hz + 480Hz) trực tiếp trên chip xử lý âm thanh của máy tính, khởi động với độ trễ 0ms, không phụ thuộc mạng, và có thể gọi lệnh `stop()` ngắt dứt khoát 100% ngay khi cúp máy.

#### Câu hỏi 5: "Dữ liệu danh bạ và tin nhắn trên web có phải là dữ liệu giả (mock data) không?"
> **Trả lời:**  
> Trên dự án chính `Smart_Call_Web`, **100% dữ liệu là dữ liệu thật từ máy chủ Wazo Platform**:  
> - Danh bạ được kéo trực tiếp từ Wazo Dird API (`/api/dird/0.1/backends/wazo/sources/...`).  
> - Tin nhắn và phòng chat đồng bộ thời gian thực qua Wazo Chatd API (`/api/chatd/1.0/...`) và WebSocket Event Bus.  
> - Lịch sử cuộc gọi truy xuất từ Wazo Call-logd API (`/api/call-logd/1.0/users/me/cdr`).  
> Toàn bộ dữ liệu mock chỉ nằm độc lập trên dự án `Smart_Call_Web_Mock` dùng cho môi trường kiểm thử ngoại tuyến khi không có mạng tổng đài.

#### Câu hỏi 6: "Tại sao trong danh sách tin nhắn, phòng có tin nhắn mới nhất lại luôn nhảy lên đầu chính xác mà không bị nhảy lộn xộn khi bấm vào xem?"
> **Trả lời:**  
> Chúng ta áp dụng nguyên tắc **Single Source of Truth (SSOT) cho Timestamp**:  
> Thứ tự danh sách phòng chat hoàn toàn phụ thuộc vào dấu thời gian `updatedAt` của tin nhắn cuối cùng thực tế trong phòng.  
> Hệ thống nghiêm cấm và đã loại bỏ hoàn toàn các câu lệnh tự ý gán `updatedAt = Date.now()` khi người dùng chỉ bấm click vào xem phòng. Do đó, chỉ khi có tin nhắn mới thực sự phát sinh, phòng đó mới được đẩy lên đầu.

#### Câu hỏi 7: "Nếu máy tính của nhân viên không cắm tai nghe hoặc hỏng micro thì hệ thống xử lý như thế nào?"
> **Trả lời:**  
> Trước khi thực hiện bất kỳ cuộc gọi nào, tại Gate 5 của `validateAndMakeCall()`, hệ thống tự động kiểm tra phần cứng bằng `navigator.mediaDevices.enumerateDevices()`.  
> Nếu phát hiện máy tính không có thiết bị đầu vào âm thanh (`audioinput`), cuộc gọi sẽ bị hủy ngay lập tức kèm thông báo yêu cầu người dùng cắm tai nghe/micro. Điều này ngăn chặn việc tạo ra các "cuộc gọi câm" gây khó chịu cho đầu nhận.

#### Câu hỏi 8: "Khi một cuộc gọi vừa cúp máy, làm sao để màn hình Lịch sử cuộc gọi hiển thị ngay mà không phải chờ máy chủ đồng bộ?"
> **Trả lời:**  
> Hệ thống kết hợp cơ chế **Dual-Source (Nguồn kép)** trong `historyService.js`:  
> Ngay trong hàm dọn dẹp `_finalizeCallTermination`, hệ thống tự động tạo ngay một bản ghi CDR cục bộ từ phiên gọi vừa kết thúc, đẩy vào `localStorage` và phát sự kiện `smartcall-cdr-updated`. Giao diện cập nhật tức thì 0 giây.  
> Sau đó, khi người dùng chuyển trang hoặc tải lại, dữ liệu chính thức từ Wazo Call-logd server sẽ được tải về và hợp nhất (merge) không trùng lặp dựa trên mã định danh và thời gian.

#### Câu hỏi 9: "Làm sao hệ thống phân biệt được giữa cuộc gọi bình thường và nhắn tin khi người dùng bấm vào một máy lẻ đang Offline?"
> **Trả lời:**  
> Đây là một điểm sáng về trải nghiệm người dùng (UX):  
> Khi người dùng bấm gọi một người đang Ngoại tuyến (`offline`), hệ thống không cố gắng quay số để rồi nhận về lỗi kết nối, mà hiển thị một hộp thoại thông minh:  
> *"Máy lẻ [Tên - Ext] hiện đang ngoại tuyến. Bạn có muốn chuyển sang gửi tin nhắn không?"*  
> Nếu người dùng đồng ý, ứng dụng tự động mở phòng chat 1-1 với người đó tại màn hình Tin nhắn, giúp mạch trao đổi công việc trong doanh nghiệp không bị gián đoạn.

#### Câu hỏi 10: "Kiến trúc của dự án đã sẵn sàng để mở rộng thêm các tính năng nâng cao như gọi Video hoặc Hội nghị nhiều bên (Conference) chưa?"
> **Trả lời:**  
> Kiến trúc 5 tầng của SmartCall Web được thiết kế theo hướng module hóa cao độ:  
> - Wazo WebRTC SDK đã có sẵn hỗ trợ luồng hình ảnh (`video: true`). Khi cần nâng cấp lên Video Call, chúng ta chỉ cần bổ sung giao diện hiển thị video stream tại View Layer mà không phải đập đi xây lại tầng Signaling hay Auth.  
> - Phân hệ Hội nghị thoại (Conference) đã có sẵn nền tảng phòng nhóm tại `chatService` và hỗ trợ phòng hội nghị nhiều nhánh trên Wazo Asterisk PBX, việc tích hợp thêm chỉ là phát triển thêm một component giao diện kết nối phòng hội nghị.

---
*Tài liệu này được biên soạn độc quyền cho Dự án SmartCall Web nhằm mục đích đặc tả kiến trúc kỹ thuật, đào tạo nội bộ và bảo vệ đồ án giải pháp trước Ban Lãnh đạo.*
