# TẬP 1: ĐẶC TẢ & GIẢI THÍCH CHI TIẾT TẦNG DỊCH VỤ (SERVICES LAYER)
> **Dự án:** SmartCall Web (WebRTC Softphone & Realtime Messaging Client)  
> **Ngăn xếp công nghệ:** Vue 3, Wazo SDK, Web Audio API, WebSocket Bus  
> **Phạm vi phân tích:** Toàn bộ 7 file trong `src/services/`  
> **Phương pháp luận:** Kết hợp `code-documentation-code-explain` (Phân cấp gọi & Cấu trúc hàm) và `logic-explain` (Truy vết luồng thực thi liên thủ tục & Bóc tách trường hợp biên).

---

## MỤC LỤC TẬP 1

1. [CHƯƠNG 1: TỔNG QUAN VỀ TẦNG DỊCH VỤ & MÔ HÌNH TRẠNG THÁI TẬP TRUNG (SSOT)](#chương-1-tổng-quan-về-tầng-dịch-vụ--mô-hình-trạng-thái-tập-trung-ssot)
2. [CHƯƠNG 2: BÓC TÁCH CHI TIẾT WAZO SERVICE (`src/services/wazo.js`)](#chương-2-bóc-tách-chi-tiết-wazo-service-srcserviceswazojs)
   - 2.1. Định vị kiến trúc & Đối tượng phản ứng `callStore`
   - 2.2. Bảng ma trận 28 hàm & phương thức
   - 2.3. Bóc tách chi tiết từng hàm (Chức năng, Luồng thực thi, Callers, Callees, Code, Kịch bản biên)
3. [CHƯƠNG 3: BÓC TÁCH CHI TIẾT AUDIO SERVICE (`src/services/audioService.js`)](#chương-3-bóc-tách-chi-tiết-audio-service-srcservicesaudioservicejs)
   - 3.1. Kiến trúc Web Audio API Synthesizers & Thiết bị phần cứng
   - 3.2. Bảng ma trận 11 phương thức
   - 3.3. Bóc tách chi tiết từng hàm (Tạo chuông đi, chuông đến, DTMF ITU-T, VAD Hangover)
4. [CHƯƠNG 4: BÓC TÁCH CHI TIẾT CONTACT SERVICE (`src/services/contactService.js`)](#chương-4-bóc-tách-chi-tiết-contact-service-srcservicescontactservicejs)
   - 4.1. Kiến trúc Đồng bộ Danh bạ & Cơ chế Hiện diện thời gian thực
   - 4.2. Bảng ma trận 12 phương thức
   - 4.3. Bóc tách chi tiết từng hàm (Thuật toán `statusOf`, Wazo Dird API, Normalizer)
5. [CHƯƠNG 5: BÓC TÁCH CHI TIẾT CHAT SERVICE (`src/services/chatService.js`)](#chương-5-bóc-tách-chi-tiết-chat-service-srcserviceschatservicejs)
   - 5.1. Kiến trúc Nhắn tin Wazo Chatd, Phân cách User UUID & SSOT Timestamp
   - 5.2. Bảng ma trận 10 phương thức
   - 5.3. Bóc tách chi tiết từng hàm (Optimistic UI 0ms, WebSocket Event, Sắp xếp phòng)
6. [CHƯƠNG 6: BÓC TÁCH CHI TIẾT HISTORY SERVICE (`src/services/historyService.js`)](#chương-6-bóc-tách-chi-tiết-history-service-srcserviceshistoryservicejs)
   - 6.1. Kiến trúc Bản ghi CDR & Cơ chế Dual-Source
   - 6.2. Bảng ma trận 9 phương thức
   - 6.3. Bóc tách chi tiết từng hàm (Wazo Call-logd API, Local Immediate CDR, Lọc 4 tab)
7. [CHƯƠNG 7: BÓC TÁCH CHI TIẾT WEBSOCKET SERVICE (`src/services/websocketService.js`)](#chương-7-bóc-tách-chi-tiết-websocket-service-srcserviceswebsocketservicejs)
   - 7.1. Kiến trúc Event Bus tập trung
   - 7.2. Bóc tách chi tiết từng hàm (`connect`, `on`, `off`, `emit`, `disconnect`)
8. [CHƯƠNG 8: BÓC TÁCH CHI TIẾT LOGGER SERVICE (`src/services/loggerService.js`)](#chương-8-bóc-tách-chi-tiết-logger-service-srcservicesloggerservicejs)
   - 8.1. Kiến trúc Structured Tagged Logger & In-Memory Ring Buffer
   - 8.2. Bóc tách chi tiết từng hàm (`log`, `info`, `warn`, `error`, `exportLogsText`)

---

## CHƯƠNG 1: TỔNG QUAN VỀ TẦNG DỊCH VỤ & MÔ HÌNH TRẠNG THÁI TẬP TRUNG (SSOT)

Tầng Dịch vụ (Service Layer) nằm tại thư mục `src/services/`, đóng vai trò là **"bộ não nghiệp vụ" (Business Core)** của SmartCall Web.
Tầng này chịu trách nhiệm cách ly hoàn toàn tầng Giao diện (Vue Views & Components) khỏi các chi tiết kỹ thuật phức tạp về giao thức mạng (SIP over WebSocket, Wazo REST API, WebRTC PeerConnection, Web Audio API Oscillators).

```
+-----------------------------------------------------------------------------------+
| TẦNG VIEW / COMPONENT (CallsView, MessagesView, HistoryView, LoginView, Headers)  |
+-----------------------------------------------------------------------------------+
                                   | (Gọi hàm nghiệp vụ & Đăng ký lắng nghe)
                                   v
+-----------------------------------------------------------------------------------+
| TẦNG DỊCH VỤ CHUYÊN TRÁCH (SERVICE LAYER - SINGLE SOURCE OF TRUTH)               |
|                                                                                   |
|  [wazo.js]            <-- Tổng chỉ huy WebRTC Phone, SIP Session, callStore      |
|  [audioService.js]    <-- Bộ tổng hợp âm thanh Web Audio API, DTMF, VAD Mic Meter |
|  [contactService.js]  <-- Danh bạ Wazo Dird, thuật toán hiện diện statusOf()      |
|  [chatService.js]     <-- Nhắn tin Wazo Chatd, phòng 1-1/nhóm, SSOT Timestamp     |
|  [historyService.js]  <-- Lịch sử Wazo Call-logd CDR + Dual-Source Local Immediate|
|  [websocketService.js]<-- Kênh Event Bus WebSocket tổng đài                      |
|  [loggerService.js]   <-- Ghi log có phân loại [AUTH], [CALL], [SIP], v.v.        |
+-----------------------------------------------------------------------------------+
                                   | (Báo hiệu mạng & Điều khiển phần cứng)
                                   v
+-----------------------------------------------------------------------------------+
| HẠ TẦNG KỸ THUẬT: WAZO PBX SERVER (:9443), ASTERISK WEBSOCKET, BROWSER MEDIA    |
+-----------------------------------------------------------------------------------+
```

### Nguyên tắc thiết kế cốt lõi của tầng Service:
1. **Single Source of Truth (SSOT):** Không lưu trữ trạng thái rải rác. `callStore` trong `wazo.js` là nơi duy nhất giữ trạng thái cuộc gọi. `presences` trong `contactService.js` là nơi duy nhất giữ trạng thái online/offline.
2. **In-Flight Promise Sharing:** Khi nhiều component cùng yêu cầu dữ liệu đồng thời (ví dụ khi khởi động cả Header, Sidebar và CallsView đều cần lịch sử hoặc danh bạ), tầng Service tự động gom vào 1 Promise duy nhất đang bay (`_fetchingRoomsPromise`, `_fetchingHistoryPromise`) để không nã trùng lặp request lên server tổng đài.
3. **Phòng vệ chủ động (Defensive Programming):** Mọi tham số đầu vào đều được làm sạch (`trim()`, loại bỏ ký tự `@pbx...`), mọi request mạng đều có `AbortSignal.timeout(3000)` để không bao giờ làm treo giao diện.

---

## CHƯƠNG 2: BÓC TÁCH CHI TIẾT WAZO SERVICE (`src/services/wazo.js`)

### 2.1. Định vị kiến trúc & Đối tượng phản ứng `callStore`
Tệp [src/services/wazo.js](file:///d:/Project/Smart_Call_Web/src/services/wazo.js) là tệp quan trọng nhất của toàn bộ hệ thống, đóng vai trò là **Softphone Controller**.

Tệp định nghĩa đối tượng phản ứng tập trung `callStore`:
```javascript
// Trích dẫn từ src/services/wazo.js (Dòng 11-24)
export const callStore = reactive({
  activeCall: null,      // Đối tượng cuộc gọi đang hoạt động (gọi đi hoặc đàm thoại)
  incomingCall: null,    // Đối tượng cuộc gọi đến đang đổ chuông
  myExtension: '',       // Số máy lẻ của chính người dùng (ví dụ: '1001')
  myUserName: '',        // Tên hiển thị người dùng (ví dụ: 'Alice Nguyễn')
  myUserUuid: '',        // UUID tài khoản Wazo của người dùng
  myPresence: 'online',  // Trạng thái hiện diện ('online', 'busy', 'dnd', 'away')
  isRegistered: false,   // Cờ xác nhận máy lẻ đã đăng ký SIP thành công với Asterisk
  callDuration: 0,       // Số giây đàm thoại thực tế
})
```

### 2.2. Bảng ma trận 28 hàm & phương thức trong `wazo.js`

| STT | Tên hàm / Thuộc tính | Quyền truy cập | Tham số đầu vào | Giá trị trả về | Mục đích tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `constructor()` | public | Không | Instance | Khởi tạo cấu hình host, clientId, bộ đếm timer |
| 2 | `init()` | public | Không | void | Khởi tạo Wazo Auth SDK với host chuẩn hóa |
| 3 | `login(u, p)` | async public | `username, password` | `Promise<Session>` | Xác thực tài khoản với Wazo Auth, lưu token, kết nối phone |
| 4 | `restoreSession()` | async public | Không | `Promise<boolean>` | Tự động khôi phục phiên từ token đã lưu trong localStorage |
| 5 | `loadExistingSession()`| public | Không | `boolean` | Kiểm tra token có sẵn để quyết định trạng thái đăng nhập |
| 6 | `logout()` | public | Không | void | Đăng xuất, hủy đăng ký SIP, ngắt WebSocket, dọn sạch storage |
| 7 | `isLogged()` | public | Không | `boolean` | Kiểm tra người dùng có đang đăng nhập hợp lệ không |
| 8 | `getToken()` | public | Không | `string` | Trích xuất token phiên làm việc hiện tại |
| 9 | `getMyExtension()` | public | Không | `string` | Lấy số máy lẻ cá nhân (từ session hoặc localStorage) |
| 10 | `getMyUserUuid()` | public | Không | `string` | Lấy UUID người dùng trên tổng đài Wazo |
| 11 | `getMyUserName()` | public | Không | `string` | Lấy tên hiển thị đầy đủ của người dùng |
| 12 | `openWebSocketEvents()`| public | Không | void | Mở kết nối WebSocket tới `wazo-websocketd` |
| 13 | `closeWebSocketEvents()`| public | Không | void | Đóng kết nối WebSocket sự kiện |
| 14 | `connectPhone()` | async public | Không | `Promise<void>` | Đăng ký SIP WebRTC Phone tới Asterisk qua WebSocket |
| 15 | `disconnectPhone()` | public | Không | void | Hủy đăng ký SIP và ngắt kết nối WebRTC Phone |
| 16 | `isPhoneRegistered()` | public | Không | `boolean` | Kiểm tra trạng thái đăng ký của WebRTC Phone |
| 17 | `startCallDurationTimer()`| public | Không | void | Kích hoạt bộ đếm thời gian đàm thoại (chạy mỗi giây) |
| 18 | `stopCallDurationTimer()`| public | Không | void | Dừng bộ đếm thời gian đàm thoại |
| 19 | `_finalizeCallTermination(r, s)`| private | `reason, session` | void | Giải phóng tài nguyên khép kín khi cuộc gọi kết thúc |
| 20 | `_bindPhoneEvents()` | private | Không | void | Lắng nghe toàn bộ sự kiện vòng đời cuộc gọi từ Wazo SDK |
| 21 | `playRemoteStream(stream)`| public | `MediaStream` | void | Gắn luồng âm thanh đàm thoại vào thẻ `<audio>` để phát ra loa |
| 22 | `stopRemoteAudio()` | public | Không | void | Dừng và giải phóng thẻ `<audio>` đàm thoại |
| 23 | `makeCall(extension)` | async public | `extension: string` | `Promise<CallSession>` | Phát lệnh gọi âm thoại audio-only cấp thấp qua Wazo SDK |
| 24 | `hangup(callSession)` | public | `callSession = null`| void | Cúp máy cuộc gọi hiện tại |
| 25 | `accept(callSession)` | public | `callSession = null`| void | Nhấc máy chấp nhận cuộc gọi đến |
| 26 | `reject(callSession)` | public | `callSession = null`| void | Từ chối cuộc gọi đến |
| 27 | `validateAndMakeCall(ext, meta)`| async public| `rawExt, meta` | `Promise<{success, reason}>` | **Cổng kiểm tra 7 lớp tối cao** trước khi gọi |
| 28 | `toggleMute()` / `toggleHold()`| public | Không | void | Bật/tắt trạng thái Mute Mic hoặc Giữ máy (Hold) |

---

### 2.3. Bóc tách chi tiết từng hàm trọng yếu trong `wazo.js`

#### Hàm 1: `login(username, password)` (Dòng 47-94)
- **Chữ ký:** `async login(username, password)`
- **Hàm này làm gì:** Xác thực thông tin người dùng với máy chủ `wazo-auth`. Khi thành công, lưu Token, Refresh Token, User UUID, Extension vào `localStorage` và `callStore`; đồng thời tự động kích hoạt kết nối WebSocket sự kiện (`openWebSocketEvents`), kết nối SIP WebRTC (`connectPhone`), và gửi trạng thái trực tuyến lên tổng đài (`setPresence('available')`).
- **Luồng thực thi:**
  1. Gọi `this.init()` chuẩn hóa host.
  2. Gửi request đăng nhập: `this.session = await Wazo.Auth.logIn(username, password)`.
  3. Trích xuất token và lưu vào `localStorage.setItem('smartcall_wazo_token', ...)`.
  4. Trích xuất số máy lẻ qua `this.session.primaryNumber?.()` và gán vào `callStore.myExtension`.
  5. Mở kết nối Event Bus: `this.openWebSocketEvents()`.
  6. Kết nối WebRTC Phone: `await this.connectPhone()`.
  7. Đồng bộ trạng thái: `await this.setPresence('available', 'Sẵn sàng')`.
- **Ai gọi tới (Callers):**
  - [src/views/LoginView.vue:194](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue#L194) trong hàm `handleLogin()`.
- **Hàm này gọi tới ai (Callees):**
  - `Wazo.Auth.logIn()` (Wazo SDK).
  - `this.openWebSocketEvents()`, `this.connectPhone()`, `this.setPresence()`.
  - `logger.info()`, `logger.success()`.
- **Trích dẫn mã nguồn thực tế:**
  ```javascript
  // src/services/wazo.js:47-79
  async login(username, password) {
    this.init()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
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
      this.openWebSocketEvents()
      try {
        await this.connectPhone()
      } catch (phoneErr) {
        logger.warn('SIP', 'Kết nối WebRTC Phone cảnh báo', phoneErr.message)
      }
      try {
        await this.setPresence('available', 'Sẵn sàng')
      } catch (presErr) {}
      return this.session
    } catch (err) {
      logger.error('AUTH', `Đăng nhập Wazo thất bại cho "${username}"`, err.message)
      throw err
    }
  }
  ```
- **Kịch bản biên & Xử lý lỗi:** Nếu sai tài khoản/mật khẩu, ném Exception để `LoginView.vue` bắt và hiển thị thông báo đỏ. Nếu kết nối WebRTC Phone bị lỗi (ví dụ do mạng chặn cổng WSS Asterisk), khối `try/catch` bọc riêng sẽ cảnh báo log nhưng vẫn duy trì phiên đăng nhập REST cho người dùng.

---

#### Hàm 2: `validateAndMakeCall(rawExt, meta = {})` (Dòng 740-948)
- **Chữ ký:** `async validateAndMakeCall(rawExt, meta = {})`
- **Hàm này làm gì:** Đây là **cổng kiểm soát tối cao duy nhất** của mọi cuộc gọi đi trong ứng dụng. Hàm ngăn chặn hoàn toàn các lỗi xung đột tài nguyên, lỗi máy bận, máy offline, lỗi phần cứng microphone và hiện tượng bấm phím liên tục trước khi phát lệnh gọi thực sự.
- **Luồng thực thi 7 Gate chi tiết:**
  1. **Gate 1 - Khóa chống bấm nhanh (Throttle 1200ms):** Kiểm tra `if (this._isDialing) return { success: false, reason: 'THROTTLED' }`. Khóa này giữ trong 1.2 giây để người dùng không bấm đúp tạo 2 cuộc gọi cùng lúc.
  2. **Gate 2 - Kiểm tra cuộc gọi hiện tại (Local Busy):** Kiểm tra `callStore.activeCall`. Nếu đang có cuộc gọi, phát `app-toast` cảnh báo người dùng phải cúp máy trước khi gọi số mới (`BUSY_LOCAL`).
  3. **Gate 3 - Làm sạch số & Chặn tự gọi chính mình:** Bóc tách chuỗi `cleanExt = ext.split('@')[0].trim()`. Nếu `cleanExt === myExtension`, chặn và báo lỗi `SELF_CALL`.
  4. **Gate 4 - Đối soát Danh bạ & Hiện diện (Presence Validation):**
     - Tra cứu `targetContact` từ `contactService.currentContacts`.
     - Nếu `status === 'busy'`: Hiển thị cảnh báo máy đang bận đàm thoại, hủy lệnh gọi (`TARGET_BUSY`).
     - Nếu `status === 'dnd'`: Hiển thị cảnh báo người dùng đang bật Không làm phiền (`TARGET_DND`).
     - Nếu `status === 'offline'`: Hiển thị hộp thoại hỏi người dùng: *"Máy lẻ [Tên] hiện đang ngoại tuyến. Bạn có muốn chuyển sang gửi tin nhắn không?"*. Nếu đồng ý, tự động điều hướng sang `/messages` (`TARGET_OFFLINE_CHAT_SUGGESTED`).
  5. **Gate 5 - Kiểm tra phần cứng Microphone:**
     - Gọi `navigator.mediaDevices.enumerateDevices()`.
     - Lọc danh sách thiết bị `kind === 'audioinput'`.
     - Nếu không tìm thấy microphone nào, phát toast cảnh báo yêu cầu cắm mic và hủy lệnh gọi (`NO_MICROPHONE`).
  6. **Gate 6 - Kiểm tra đăng ký SIP Phone:**
     - Kiểm tra `callStore.isRegistered`. Nếu chưa kết nối SIP, tự động gọi `await this.connectPhone()`.
  7. **Gate 7 - Khởi tạo phiên gọi tập trung & Phát âm chuông đi:**
     - Khởi tạo `callStore.activeCall = { number: cleanExt, name: ..., status: 'progressing', direction: 'outbound', ... }`.
     - Kích hoạt âm chuông đi: `audioService.startRingbackTone()`.
     - Thực hiện cuộc gọi cấp thấp qua Wazo SDK: `await this.makeCall(cleanExt)`.
- **Ai gọi tới (Callers):**
  - [src/views/CallsView.vue:715](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue#L715) trong hàm `handleDial()`.
  - [src/views/CallsView.vue:850](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue#L850) khi bấm nút Gọi trong danh bạ nhanh hoặc danh bạ nội bộ.
  - [src/views/HistoryView.vue:245](file:///d:/Project/Smart_Call_Web/src/views/HistoryView.vue#L245) khi bấm nút Gọi lại (Redial).
  - [src/views/MessagesView.vue:320](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L320) khi bấm nút Gọi thoại trên đầu khung chat.
- **Hàm này gọi tới ai (Callees):**
  - `contactService.findContactByExtension()`.
  - `audioService.startRingbackTone()`, `audioService.stopRingbackTone()`.
  - `navigator.mediaDevices.enumerateDevices()`.
  - `this.makeCall()`, `this._finalizeCallTermination()`.
- **Trích dẫn mã nguồn thực tế:**
  ```javascript
  // src/services/wazo.js:740-755 (Trích lược 2 Gate đầu tiên)
  async validateAndMakeCall(rawExt, meta = {}) {
    // 1. Chống bấm liên tục (Throttle 1200ms)
    if (this._isDialing) {
      logger.warn('UI', 'Thao tác quay số quá nhanh, vui lòng chờ trong giây lát!')
      return { success: false, reason: 'THROTTLED' }
    }

    // 2. Chặn nếu đang trong một cuộc gọi khác
    if (callStore.activeCall || this.hasActiveCall()) {
      logger.warn('CALL', 'Chặn quay số: Người dùng đang trong một cuộc gọi khác.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động. Vui lòng cúp máy trước khi gọi số mới!',
            type: 'warning',
          },
        }),
      )
      return { success: false, reason: 'BUSY_LOCAL' }
    }
  ```

---

#### Hàm 3: `_finalizeCallTermination(reason = 'ended', session = null)` (Dòng 341-398)
- **Chữ ký:** `_finalizeCallTermination(reason = 'ended', session = null)`
- **Hàm này làm gì:** Thu hồi toàn bộ tài nguyên, ngắt triệt để mọi âm thanh chuông chờ và chuông đến, dừng phát âm thanh đàm thoại ra loa, tự động ghi bản ghi CDR vào `historyService`, và đưa trạng thái `callStore.activeCall` và `callStore.incomingCall` về sạch (`null`).
- **Luồng thực thi:**
  1. Kiểm tra cờ `if (this._isTerminating) return; this._isTerminating = true;` để chống dọn dẹp trùng lặp khi nhận đồng thời nhiều sự kiện kết thúc.
  2. Dừng bộ đếm thời gian: `this.stopCallDurationTimer()`.
  3. Ngắt âm thanh: `audioService.stopRingbackTone()`, `audioService.stopIncomingRingtone()`, `this.stopRemoteAudio()`.
  4. Nếu có cuộc gọi vừa kết thúc, gọi `historyService.addRecord()` lưu lại lịch sử cuộc gọi ngay lập tức.
  5. Đặt `callStore.activeCall = null`, `callStore.incomingCall = null`.
  6. Sau 500ms, mở lại cờ `this._isTerminating = false`.
- **Ai gọi tới (Callers):**
  - `hangup()`, `reject()`, `missIncomingCall()`.
  - Các sự kiện Wazo SDK: `ON_CALL_ENDED`, `ON_CALL_FAILED`, `ON_CALL_REJECTED`, `ON_CALL_CANCELED`.
- **Hàm này gọi tới ai (Callees):**
  - `audioService.stopRingbackTone()`, `audioService.stopIncomingRingtone()`.
  - `this.stopRemoteAudio()`, `this.stopCallDurationTimer()`.
  - `historyService.addRecord()`.
- **Trích dẫn mã nguồn thực tế:**
  ```javascript
  // src/services/wazo.js:341-370
  _finalizeCallTermination(reason = 'ended', session = null) {
    if (this._isTerminating) return
    this._isTerminating = true

    this.stopCallDurationTimer()
    audioService.stopRingbackTone()
    audioService.stopIncomingRingtone()
    this.stopRemoteAudio()

    const active = callStore.activeCall
    if (active) {
      const wasConnected = active.status === 'connected'
      const dur = wasConnected ? active.duration || callStore.callDuration || 0 : 0
      try {
        historyService.addRecord({
          name: active.name || 'Người dùng',
          extension: active.number,
          dept: active.dept || 'Nội bộ công ty',
          duration: dur,
          direction: active.direction || 'outbound',
          status: wasConnected && dur > 0 ? 'success' : (reason === 'declined' ? 'declined' : 'missed'),
          answered: wasConnected && dur > 0,
        })
      } catch (histErr) {}
    }
    callStore.activeCall = null
    callStore.incomingCall = null
    this.currentCallSession = null
    setTimeout(() => { this._isTerminating = false }, 500)
  }
  ```

---

## CHƯƠNG 3: BÓC TÁCH CHI TIẾT AUDIO SERVICE (`src/services/audioService.js`)

### 3.1. Kiến trúc Web Audio API Synthesizers & Thiết bị phần cứng
Tệp [src/services/audioService.js](file:///d:/Project/Smart_Call_Web/src/services/audioService.js) đảm nhiệm toàn bộ việc phát sinh âm thanh tổng đài và phân tích tín hiệu Microphone thời gian thực mà **không sử dụng bất kỳ file MP3 tĩnh nào**.

### 3.2. Bảng ma trận 11 phương thức trong `audioService.js`

| STT | Tên phương thức | Quyền | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `_getAudioContext()` | private | Không | `AudioContext` | Khởi tạo hoặc tái kích hoạt AudioContext của trình duyệt |
| 2 | `_trackOscillator(osc)` | private | `OscillatorNode` | void | Lưu trữ oscillator vào mảng theo dõi để dọn dẹp |
| 3 | `_stopAllActiveOscillators()`| private | Không | void | Ngắt dứt khoát 100% toàn bộ oscillator đang phát |
| 4 | `startIncomingRingtone()` | public | Không | void | Phát chuông gọi đến (440Hz + 480Hz, chu kỳ 1.6s on / 2.0s off) |
| 5 | `stopIncomingRingtone()` | public | Không | void | Dừng hoàn toàn chuông gọi đến |
| 6 | `startRingbackTone()` | public | Không | void | Phát chuông chờ cuộc gọi đi (440Hz + 480Hz, chu kỳ 2s on / 4s off) |
| 7 | `stopRingbackTone()` | public | Không | void | Dừng hoàn toàn chuông chờ cuộc gọi đi |
| 8 | `playDtmfTone(digit)` | public | `digit: string` | void | Phát âm phím bấm số theo tần số kép chuẩn ITU-T |
| 9 | `startMicMeter(id, cb)` | async public | `deviceId, callback` | `Promise<boolean>` | Lắng nghe Mic và tính âm lượng kèm thuật toán VAD Hangover |
| 10 | `stopMicMeter()` | public | Không | void | Ngắt kết nối phân tích micro và giải phóng MediaStream |
| 11 | `setAudioOutputDevice(el, id)`| async public| `audioEl, deviceId`| `Promise<boolean>` | Định tuyến âm thanh ra đúng loa qua HTML5 `setSinkId()` |

---

### 3.3. Bóc tách chi tiết các hàm trọng yếu trong `audioService.js`

#### Hàm 1: `startRingbackTone()` (Dòng 124-185)
- **Hàm này làm gì:** Tự động tạo âm chuông "Tút... Tút..." báo hiệu máy bên kia đang đổ chuông khi người dùng thực hiện cuộc gọi đi.
- **Nguyên lý vật lý âm thanh:**
  - Kết hợp 2 bộ dao động sóng hình sin: `440 Hz` (nốt La chuẩn) và `480 Hz` (tiêu chuẩn tín hiệu tổng đài Bắc Mỹ & Châu Âu).
  - Sử dụng `GainNode` điều biến biên độ: Tăng dần từ 0 lên 0.15 trong 0.1s (fade-in), giữ nguyên 1.9s, và hạ dần về 0 trong 0.1s (fade-out) để triệt tiêu tiếng "bụp" (audio pop/click).
  - Chu kỳ phát âm: Bật 2.0 giây, nghỉ 4.0 giây, lặp lại qua `setInterval`.
- **Ai gọi tới (Callers):**
  - `wazoService.validateAndMakeCall()` khi bắt đầu cuộc gọi đi.
- **Hàm này gọi tới ai (Callees):**
  - `this._getAudioContext()`, `ctx.createOscillator()`, `ctx.createGain()`.
  - `this._trackOscillator()`.

#### Hàm 2: `startMicMeter(deviceId, onVolumeChange)` (Dòng 252-325)
- **Hàm này làm gì:** Thu tín hiệu âm thanh thực tế từ Microphone của người dùng, phân tích biên độ sóng âm thời gian thực để hiển thị thanh đo âm lượng trong modal Cài đặt.
- **Thuật toán giải quyết bài toán nhấp nháy (VAD Hangover):**
  - Sử dụng `AnalyserNode` với kích thước cửa sổ FFT `fftSize = 512`.
  - Đọc mảng byte miền thời gian `getByteTimeDomainData(dataArray)`.
  - Tính toán độ lệch bình phương trung bình (RMS) so với đường cơ sở 128:
    $$	ext{RMS} = \sqrt{rac{1}{N} \sum_{i=0}^{N-1} (x_i - 128)^2}$$
  - Đặt ngưỡng phát hiện tiếng nói: `VAD_THRESHOLD = 10`.
  - Khi `rawVolume >= VAD_THRESHOLD`: Đánh dấu người dùng đang nói (`lastSpeechTime = Date.now()`).
  - **Cơ chế Hangover 1000ms:** Trong vòng 1.0 giây sau khi âm lượng tụt xuống dưới ngưỡng, thuật toán vẫn giữ nguyên trạng thái hoạt động với một hệ số suy giảm mềm mại (decay factor 0.92), giúp thanh đo hiển thị ổn định, không bị chớp tắt giật cục giữa các âm tiết.
- **Ai gọi tới (Callers):**
  - [src/components/common/SettingsModal.vue:260](file:///d:/Project/Smart_Call_Web/src/components/common/SettingsModal.vue#L260) khi mở modal Cài đặt.

---

## CHƯƠNG 4: BÓC TÁCH CHI TIẾT CONTACT SERVICE (`src/services/contactService.js`)

### 4.1. Kiến trúc Đồng bộ Danh bạ & Cơ chế Hiện diện thời gian thực
Tệp [src/services/contactService.js](file:///d:/Project/Smart_Call_Web/src/services/contactService.js) chịu trách nhiệm tải toàn bộ danh bạ công ty từ microservice `wazo-dird`, quản lý danh sách yêu thích và phân giải trạng thái hiện diện (Presence).

### 4.2. Bảng ma trận 12 phương thức trong `contactService.js`

| STT | Tên phương thức | Quyền | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `constructor()` | public | Không | Instance | Đăng ký lắng nghe sự kiện `wazo-presence-updated` |
| 2 | `getFavoritesKey()` | public | Không | `string` | Tạo khóa localStorage danh bạ yêu thích theo User UUID |
| 3 | `getFavoriteIds()` | public | Không | `string[]` | Tải mảng ID liên hệ yêu thích từ localStorage |
| 4 | `toggleFavorite(id)` | public | `id: string` | `boolean` | Bật/tắt trạng thái yêu thích của một liên hệ |
| 5 | `isFavorite(id)` | public | `id: string` | `boolean` | Kiểm tra một liên hệ có nằm trong danh sách yêu thích không |
| 6 | `statusOf(uuid)` | public | `uuid: string` | `{key, label}` | **Thuật toán phân giải trạng thái chuẩn 100% Wazo PBX** |
| 7 | `matchesSearch(contact, q)`| public | `contact, query` | `boolean` | So khớp tìm kiếm 3 chiều: Tên, Phòng ban, Số máy lẻ |
| 8 | `getContacts()` | async public | Không | `Promise<Contact[]>` | Tải danh bạ từ Wazo Dird API, chuẩn hóa và loại bỏ số của mình |
| 9 | `loadPresencesForContacts(c)`| async public| `contacts` | `Promise<Contact[]>` | Truy vấn hàng loạt trạng thái Presence từ Wazo Chatd API |
| 10 | `updateSinglePresence(rec)`| public | `presenceRecord` | void | Cập nhật tức thời trạng thái 1 user khi nhận WebSocket event |
| 11 | `findContactByExtension(ext)`| public | `ext: string` | `Contact | null` | Tìm kiếm liên hệ trong danh bạ theo số máy lẻ hoặc UUID |
| 12 | `reset()` | public | Không | void | Dọn sạch cache danh bạ và hiện diện khi người dùng đăng xuất |

---

### 4.3. Bóc tách chi tiết hàm `statusOf(uuid)` (Dòng 55-75)
- **Chữ ký:** `statusOf(uuid)`
- **Hàm này làm gì:** Chuyển đổi bản ghi trạng thái mạng đa tầng phức tạp của Wazo (`p.lines`, `p.state`, `p.do_not_disturb`, `p.connected`) thành một trạng thái duy nhất có nhãn tiếng Việt và mã màu nhận diện chuẩn mực.
- **Luồng logic chuẩn 100% theo mã nguồn tham chiếu tổng đài:**
  1. Kiểm tra bản ghi `const p = uuid && this.presences[uuid]`. Nếu không có dữ liệu $ightarrow$ trả về `{ key: 'offline', label: 'Ngoại tuyến' }`.
  2. Quét mảng trạng thái các đường dây: `const lines = (p.lines || []).map(l => l.state)`.
  3. **Nhánh 1 (Đang bận đàm thoại):** Nếu có bất kỳ đường dây nào có `state === 'talking'` hoặc `holding` $ightarrow$ Trả về `{ key: 'busy', label: 'Đang gọi' }` (Màu cam).
  4. **Nhánh 2 (Đang đổ chuông):** Nếu có đường dây có `state === 'ringing'` hoặc `progressing` $ightarrow$ Trả về `{ key: 'ringing', label: 'Đang đổ chuông' }` (Màu tím).
  5. **Nhánh 3 (Không làm phiền):** Nếu `p.do_not_disturb === true` $ightarrow$ Trả về `{ key: 'dnd', label: 'Không làm phiền' }` (Màu đỏ).
  6. **Nhánh 4 (Kiểm tra khả dụng mạng):**
     - Nếu có đường dây khác `unavailable`, HOẶC `p.connected === true`, HOẶC `p.state === 'available'`/`'online'` $ightarrow$ Được coi là có kết nối mạng.
     - Nếu không khả dụng, hoặc `p.state === 'unavailable'`/`'offline'` $ightarrow$ Trả về `{ key: 'offline', label: 'Ngoại tuyến' }` (Màu xám).
  7. **Nhánh 5 (Vắng mặt):** Nếu `p.state === 'away'` $ightarrow$ Trả về `{ key: 'away', label: 'Vắng mặt' }` (Màu vàng).
  8. **Nhánh 6 (Mặc định trực tuyến):** Trả về `{ key: 'online', label: 'Trực tuyến' }` (Màu xanh lục).
- **Ai gọi tới (Callers):**
  - `wazoService.validateAndMakeCall()` để kiểm tra máy đích trước khi gọi.
  - `contactService.getContacts()` khi chuẩn hóa danh bạ.
  - `AppHeader.vue`, `CallsView.vue`, `MessagesView.vue` khi hiển thị chấm màu trạng thái.

---

## CHƯƠNG 5: BÓC TÁCH CHI TIẾT CHAT SERVICE (`src/services/chatService.js`)

### 5.1. Kiến trúc Nhắn tin Wazo Chatd, Phân cách User UUID & SSOT Timestamp
Tệp [src/services/chatService.js](file:///d:/Project/Smart_Call_Web/src/services/chatService.js) quản lý phân hệ nhắn tin thời gian thực với microservice `wazo-chatd`.
Tệp giải quyết 3 bài toán lớn:
1. **Cách ly dữ liệu:** Lưu cache riêng theo User UUID: `smartcall_chat_rooms_<UserUUID>`.
2. **SSOT Timestamp:** Trật tự sắp xếp danh sách phòng chat hoàn toàn dựa trên thời gian thực tế của tin nhắn cuối cùng, không bị đảo lộn khi người dùng click vào xem phòng.
3. **Optimistic UI:** Phản hồi giao diện tức thì 0ms khi gửi tin.

### 5.2. Bảng ma trận 10 phương thức trong `chatService.js`

| STT | Tên phương thức | Quyền | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `constructor()` | public | Không | Instance | Tải danh sách phòng từ cache và gắn lắng nghe WebSocket |
| 2 | `getStorageKey()` | public | Không | `string` | Tạo khóa localStorage theo UUID người dùng |
| 3 | `loadSavedRooms()` | public | Không | `Room[]` | Tải phòng từ localStorage và chuẩn hóa `updatedAt` theo tin cuối |
| 4 | `sortRooms()` | public | Không | void | Sắp xếp các phòng chat theo thời gian tin nhắn mới nhất giảm dần |
| 5 | `saveRooms(silent)` | public | `silent = false` | void | Lưu danh sách phòng vào localStorage và phát sự kiện cập nhật UI |
| 6 | `handleIncomingMessage(data)`| public | `data: object` | void | Nhận tin nhắn mới từ WebSocket, khử trùng lặp và đẩy vào phòng |
| 7 | `getRooms()` | async public | Không | `Promise<Room[]>` | Tải phòng từ Wazo Chatd API, hợp nhất với phòng cục bộ |
| 8 | `getDirectRoom(contact)` | async public | `contact: object` | `Promise<Room>` | Mở hoặc tạo phòng chat 1-1 với một đồng nghiệp |
| 9 | `createGroupRoom(name, list)`| async public| `name, contacts` | `Promise<Room>` | Tạo phòng chat nhóm qua Wazo Chatd API `POST /users/me/rooms` |
| 10 | `sendMessage(id, text, alias)`| async public| `roomId, text, alias` | `Promise<Message>`| Gửi tin nhắn với Optimistic UI 0ms và gọi API máy chủ |

---

### 5.3. Bóc tách chi tiết hàm `sendMessage` (Dòng 415-485)
- **Chữ ký:** `async sendMessage(roomId, text, userAlias = 'Tôi')`
- **Hàm này làm gì:** Gửi nội dung tin nhắn vào phòng chat. Áp dụng kỹ thuật **Optimistic UI**: Tạo ngay một tin nhắn tạm thời trong bộ nhớ và hiển thị lên khung chat ngay tức thì (0ms) để người dùng không cảm thấy độ trễ mạng, sau đó mới gửi request ngầm tới API Wazo Chatd.
- **Luồng thực thi:**
  1. Kiểm tra tính hợp lệ của chuỗi `text.trim()`.
  2. Tạo đối tượng tin nhắn:
     ```javascript
     const tempMsg = {
       id: `temp-${Date.now()}-${Math.random()}`,
       sender: userAlias,
       text: text.trim(),
       time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
       timestamp: Date.now(),
       isMe: true,
       status: 'pending', // Đang gửi
     }
     ```
  3. Cập nhật phòng: `targetRoom.messages.push(tempMsg)`, gán `targetRoom.preview = text.trim()`, `targetRoom.updatedAt = Date.now()`.
  4. Lưu cache và phát sự kiện: `this.saveRooms()`.
  5. Gửi HTTP POST tới Wazo Chatd:
     `POST /api/chatd/1.0/users/me/rooms/<roomId>/messages`
     Body: `{ "content": text.trim() }`
  6. Khi server phản hồi `201 Created`: Cập nhật `tempMsg.status = 'delivered'` và gán lại ID thật do server cấp.
- **Ai gọi tới (Callers):**
  - [src/views/MessagesView.vue:560](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L560) khi người dùng bấm nút Gửi hoặc nhấn phím Enter.
- **Kịch bản biên:** Nếu mất kết nối mạng hoặc server trả về lỗi 5xx, cờ trạng thái chuyển thành `tempMsg.status = 'error'` kèm biểu tượng chấm than đỏ để người dùng biết tin chưa gửi được và có thể bấm gửi lại.

---

## CHƯƠNG 6: BÓC TÁCH CHI TIẾT HISTORY SERVICE (`src/services/historyService.js`)

### 6.1. Kiến trúc Bản ghi CDR & Cơ chế Dual-Source
Tệp [src/services/historyService.js](file:///d:/Project/Smart_Call_Web/src/services/historyService.js) chịu trách nhiệm quản lý lịch sử cuộc gọi (Call Detail Records - CDR).
Để đảm bảo trải nghiệm người dùng luôn tức thì mà không phụ thuộc vào độ trễ đồng bộ cơ sở dữ liệu của tổng đài, hệ thống áp dụng cơ chế **Dual-Source (Nguồn kép)**:
1. **Nguồn tức thời cục bộ:** Ghi lại ngay khi cúp máy trên giao diện.
2. **Nguồn chính thức từ máy chủ tổng đài:** Truy vấn từ API `wazo-call-logd`.

### 6.2. Bảng ma trận 9 phương thức trong `historyService.js`

| STT | Tên phương thức | Quyền | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `getStorageKey()` | public | Không | `string` | Tạo khóa localStorage lịch sử theo User UUID |
| 2 | `loadSavedHistory()` | public | Không | `CallRecord[]` | Tải danh sách lịch sử cuộc gọi đã lưu từ cache |
| 3 | `saveHistory()` | public | Không | void | Ghi danh sách lịch sử cuộc gọi vào localStorage |
| 4 | `addRecord(options)` | public | `options: object` | `CallRecord` | **Thêm bản ghi cuộc gọi mới lên đầu danh sách (Top 1)** |
| 5 | `formatDuration(sec)` | public | `seconds: number` | `string` | Định dạng số giây thành chuỗi thời gian `mm:ss` |
| 6 | `getHistory(options)` | async public | `{ tab, limit }` | `Promise<CallRecord[]>`| Tải CDR từ Wazo Call-logd, hợp nhất với cục bộ và lọc tab |
| 7 | `_filterList(list, tab)`| private | `list, tab` | `CallRecord[]` | Lọc danh sách theo tab: all, inbound, outbound, missed |
| 8 | `clearAllHistory()` | async public | Không | `Promise<boolean>` | Xóa toàn bộ lịch sử cuộc gọi trên client |
| 9 | `deleteItem(id)` | async public | `id: string` | `Promise<boolean>` | Xóa một bản ghi lịch sử cuộc gọi cụ thể |

---

### 6.3. Bóc tách chi tiết hàm `getHistory` (Dòng 105-180)
- **Chữ ký:** `async getHistory({ tab = 'all', limit = 50 } = {})`
- **Hàm này làm gì:** Lấy toàn bộ danh sách lịch sử cuộc gọi để hiển thị trên màn hình Lịch sử và thẻ KPI Dashboard.
- **Kỹ thuật In-flight Promise Sharing:**
  - Nếu đang có một request truy vấn lịch sử đang thực thi (`this._fetchingHistoryPromise !== null`), các component gọi sau sẽ tái sử dụng chung Promise này mà không phát thêm HTTP request thứ hai lên server.
- **Luồng xử lý mạng & Hợp nhất:**
  1. Gửi request: `GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc` kèm header `X-Auth-Token`.
  2. Chuẩn hóa dữ liệu từ Wazo CDR format sang định dạng nội bộ của SmartCall Web:
     - `call_direction === 'outbound'` $ightarrow$ `direction: 'outbound'`, nhãn 'Outgoing'.
     - Xác định tên hiển thị: Nếu gọi đi lấy `destination_name`, nếu gọi đến lấy `source_name`.
     - Phân loại trạng thái: Nếu `answered === false` $ightarrow$ Đánh dấu `status: 'missed'` hoặc `'declined'`.
  3. **Hợp nhất không trùng lặp (Deduplicated Merge):** Quét các bản ghi trong `localHistory`, nếu chưa có trong danh sách từ server (so khớp theo `id` hoặc cặp `date + extension`) thì bổ sung vào.
  4. Sắp xếp giảm dần theo thời gian: `merged.sort((a, b) => new Date(b.date) - new Date(a.date))`.
  5. Áp dụng bộ lọc `_filterList(merged, tab)` và trả về kết quả.
- **Ai gọi tới (Callers):**
  - [src/views/HistoryView.vue:180](file:///d:/Project/Smart_Call_Web/src/views/HistoryView.vue#L180) trong `loadHistory()`.
  - Thẻ KPI trên Dashboard và Sidebar khi tính số lượng cuộc gọi nhỡ.

---

## CHƯƠNG 7: BÓC TÁCH CHI TIẾT WEBSOCKET SERVICE (`src/services/websocketService.js`)

### 7.1. Kiến trúc Event Bus tập trung
Tệp [src/services/websocketService.js](file:///d:/Project/Smart_Call_Web/src/services/websocketService.js) đóng vai trò là **Bus truyền thông điệp (Event Emitter)** nội bộ trong ứng dụng, nhận các khung dữ liệu JSON từ kết nối WebSocket duy nhất do `wazoService` quản lý và phân phối tới các service hoặc component đăng ký lắng nghe.

### 7.2. Bóc tách chi tiết từng phương thức

1. **`isConnected` (Getter):**
   - Kiểm tra `wazoService.eventWs && wazoService.eventWs.readyState === WebSocket.OPEN`. Trả về `true` nếu kênh WebSocket đang mở.
2. **`connect()`:**
   - Kích hoạt `wazoService.openWebSocketEvents()`.
3. **`on(eventName, callback)`:**
   - Đăng ký một hàm lắng nghe cho sự kiện `eventName`. Sử dụng cấu trúc `Map<string, Set<Function>>` để đảm bảo mỗi callback chỉ được đăng ký một lần duy nhất, chống hiện tượng rò rỉ bộ nhớ (Memory Leak).
   - *Caller:* `chatService` đăng ký sự kiện `chatd_user_room_message_created`.
4. **`off(eventName, callback)`:**
   - Hủy đăng ký callback khỏi sự kiện tương ứng khi component bị unmount.
5. **`emit(eventName, data)`:**
   - Quét qua toàn bộ các callback trong `Set` của `eventName` và thực thi trong khối `try/catch` độc lập để lỗi của một callback không làm gián đoạn các callback khác.

---

## CHƯƠNG 8: BÓC TÁCH CHI TIẾT LOGGER SERVICE (`src/services/loggerService.js`)

### 8.1. Kiến trúc Structured Tagged Logger & In-Memory Ring Buffer
Tệp [src/services/loggerService.js](file:///d:/Project/Smart_Call_Web/src/services/loggerService.js) là hệ thống ghi nhật ký chuyên nghiệp của SmartCall Web, cung cấp khả năng chẩn đoán sự cố trực tiếp (Live Debugging).

### 8.2. Bóc tách chi tiết các phương thức

1. **`log(category, message, details, level)`:**
   - Nhận diện 7 danh mục phân loại: `AUTH` (Xanh dương), `SIP` (Xanh lục), `CALL` (Tím), `AUDIO` (Cam), `API` (Xanh da trời), `UI` (Xám), `SYSTEM` (Đen).
   - Sinh bản ghi nhật ký với dấu thời gian chính xác tới mili-giây: `HH:mm:ss.SSS`.
   - **Cơ chế Ring Buffer:** Giới hạn tối đa 250 bản ghi mới nhất (`MAX_LOGS = 250`). Khi vượt quá, tự động loại bỏ bản ghi cũ nhất (`pop()`), ngăn ngừa tràn RAM trình duyệt.
   - Định dạng CSS màu sắc nổi bật trên Console F12 của trình duyệt qua `_printToConsole()`.
   - Phát sự kiện toàn cục `smartcall-log-added` để hiển thị trực tiếp lên ngăn kéo gỡ lỗi [DebugLogDrawer.vue](file:///d:/Project/Smart_Call_Web/src/components/common/DebugLogDrawer.vue).
2. **`info()`, `success()`, `warn()`, `error()`:**
   - Các hàm bọc tiện ích rút gọn theo từng cấp độ nghiêm trọng.
3. **`exportLogsText()`:**
   - Xuất toàn bộ 250 bản ghi nhật ký thành một chuỗi văn bản hoàn chỉnh theo thứ tự thời gian tăng dần, giúp người dùng hoặc kỹ sư vận hành có thể copy và gửi báo cáo sự cố ngay lập tức.
4. **`clearLogs()`:**
   - Xóa sạch nhật ký trong bộ nhớ tạm và phát sự kiện `smartcall-logs-cleared`.

---
*Tài liệu Tập 1 được biên soạn độc quyền cho Dự án SmartCall Web nhằm mục đích đặc tả kiến trúc kỹ thuật chi tiết tầng Dịch vụ và đào tạo nội bộ.*
