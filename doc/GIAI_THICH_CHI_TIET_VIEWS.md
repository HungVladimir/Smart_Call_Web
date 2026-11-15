# TẬP 2: ĐẶC TẢ & GIẢI THÍCH CHI TIẾT TẦNG GIAO DIỆN & THÀNH PHẦN (VIEWS & COMPONENTS)
> **Dự án:** SmartCall Web (WebRTC Softphone & Realtime Messaging Client)  
> **Ngăn xếp công nghệ:** Vue 3 (Composition API, `<script setup>`), Vue Router, Vite  
> **Phạm vi phân tích:** 4 Views (`src/views/`) và 4 Components tương tác cốt lõi (`src/components/`)  
> **Phương pháp luận:** Kết hợp `code-documentation-code-explain` (Phân cấp gọi & Cấu trúc hàm) và `logic-explain` (Truy vết luồng thực thi liên thủ tục & Bóc tách trường hợp biên).

---

## MỤC LỤC TẬP 2

1. [CHƯƠNG 1: TỔNG QUAN TẦNG GIAO DIỆN & VÒNG ĐỜI VUE 3 COMPOSITION API](#chương-1-tổng-quan-tầng-giao-diện--vòng-đời-vue-3-composition-api)
2. [CHƯƠNG 2: BÓC TÁCH CHI TIẾT MÀN HÌNH ĐĂNG NHẬP (`src/views/LoginView.vue`)](#chương-2-bóc-tách-chi-tiết-màn-hình-đăng-nhập-srcviewsloginviewvue)
   - 2.1. Cấu trúc template & Khôi phục phiên ghi nhớ
   - 2.2. Bóc tách hàm `handleLogin()`: Race condition Timeout 15s, trích xuất hồ sơ Wazo SDK
3. [CHƯƠNG 3: BÓC TÁCH CHI TIẾT MÀN HÌNH CUỘC GỌI & BÀN PHÍM (`src/views/CallsView.vue`)](#chương-3-bóc-tách-chi-tiết-màn-hình-cuộc-gọi--bàn-phím-srcviewscallsviewvue)
   - 3.1. Giao diện Softphone kép: Bàn phím số DTMF & Danh bạ công ty tích hợp
   - 3.2. Bảng ma trận 20 hàm nghiệp vụ
   - 3.3. Bóc tách chi tiết: `handleDial()`, `pressKey()`, `handleCallFromPanel()`, `loadContacts()`, `hangupCall()`, `toggleMute()`, `toggleHold()`
4. [CHƯƠNG 4: BÓC TÁCH CHI TIẾT MÀN HÌNH TIN NHẮN REALTIME (`src/views/MessagesView.vue`)](#chương-4-bóc-tách-chi-tiết-màn-hình-tin-nhắn-realtime-srcviewsmessagesviewvue)
   - 4.1. Kiến trúc Khung chat 2 cột & Danh sách phòng SSOT Timestamp
   - 4.2. Bảng ma trận 16 hàm nghiệp vụ
   - 4.3. Bóc tách chi tiết: `selectRoom()`, `sendMessage()`, `checkDirectChatRoute()`, `startVoiceCall()`, `scrollToBottom()`
5. [CHƯƠNG 5: BÓC TÁCH CHI TIẾT MÀN HÌNH LỊCH SỬ CUỘC GỌI (`src/views/HistoryView.vue`)](#chương-5-bóc-tách-chi-tiết-màn-hình-lịch-sử-cuộc-gọi-srcviewshistoryviewvue)
   - 5.1. Bảng dữ liệu CDR & Hệ thống 4 tab lọc số liệu động
   - 5.2. Bảng ma trận 7 hàm nghiệp vụ
   - 5.3. Bóc tách chi tiết: `fetchHistory()`, `handleCallback()`, `handleChat()`, `handleDeleteItem()`, `confirmDeleteAll()`
6. [CHƯƠNG 6: BÓC TÁCH CHI TIẾT POPUP CUỘC GỌI ĐẾN (`IncomingCallModal.vue`)](#chương-6-bóc-tách-chi-tiết-popup-cuộc-gọi-đến-incomingcallmodalvue)
   - 6.1. Kiến trúc Modal đè toàn cục (Global Overlay) & Chuông đến
   - 6.2. Bóc tách chi tiết: `handleAccept()`, `handleReject()`, `handleTimeout()`
7. [CHƯƠNG 7: BÓC TÁCH CHI TIẾT MODAL CÀI ĐẶT THIẾT BỊ (`SettingsModal.vue`)](#chương-7-bóc-tách-chi-tiết-modal-cài-đặt-thiết-bị-settingsmodalvue)
   - 7.1. Giao diện phần cứng: Quét Mic/Loa, setSinkId & Mic Meter VAD
   - 7.2. Bóc tách chi tiết: `loadAudioDevices()`, `startMicMeter()`, `testSound()`, `handleSave()`
8. [CHƯƠNG 8: BÓC TÁCH CHI TIẾT HEADER & SIDEBAR ĐIỀU HƯỚNG](#chương-8-bóc-tách-chi-tiết-header--sidebar-điều-hướng)
   - 8.1. `src/components/layout/AppHeader.vue`: Chấm hiện diện đa sắc thái, dropdown chuyển trạng thái
   - 8.2. `src/components/layout/AppSidebar.vue`: Badge đếm tin chưa đọc, debounce cập nhật số liệu

---

## CHƯƠNG 1: TỔNG QUAN TẦNG GIAO DIỆN & VÒNG ĐỜI VUE 3 COMPOSITION API

Tầng Giao diện (View Layer) của SmartCall Web được xây dựng hoàn toàn bằng **Vue 3 Composition API** với cú pháp `<script setup>`.
Mô hình này giúp code tinh gọn, khả năng tái sử dụng cao và tận dụng tối đa cơ chế phản ứng (Reactivity System) của Vue 3:

```
+----------------------------------------------------------------------------------+
| TẦNG GIAO DIỆN (VUE 3 VIEWS & COMPONENTS)                                        |
|  - Reactive Data: `ref()`, `reactive()`, `computed()`                            |
|  - Lifecycle Hooks: `onMounted()`, `onUnmounted()`, `watch()`, `nextTick()`      |
|  - UI Events: `@click`, `@submit.prevent`, `@keydown.enter`                      |
+----------------------------------------------------------------------------------+
                                  |
                                  | 1. Dispatch actions / Calls API
                                  | 2. Listen to reactive callStore & CustomEvents
                                  v
+----------------------------------------------------------------------------------+
| TẦNG DỊCH VỤ NGHIỆP VỤ (wazoService, contactService, chatService, historyService)|
+----------------------------------------------------------------------------------+
```

### Vòng đời chuẩn của một View trong SmartCall Web:
1. **Khởi tạo (`onMounted`):**
   - Đọc dữ liệu từ cache hoặc Service (`loadContacts`, `loadRooms`, `fetchHistory`).
   - Đăng ký lắng nghe sự kiện toàn cục: `smartcall-contacts-updated`, `smartcall-cdr-updated`, `smartcall-rooms-updated`.
2. **Tương tác người dùng (User Actions):**
   - Người dùng bấm nút $ightarrow$ Gọi hàm trong View $ightarrow$ Chuyển tiếp tới hàm kiểm soát tại tầng Service (`wazoService.validateAndMakeCall()`, `chatService.sendMessage()`).
3. **Phản hồi giao diện (Reactive Render):**
   - Các biến `computed` tự động tính toán lại khi trạng thái thay đổi (ví dụ: `activeCall` thay đổi $ightarrow$ tự động mở khung đàm thoại và ẩn bàn phím số).
4. **Thu hồi tài nguyên (`onUnmounted`):**
   - Hủy bỏ toàn bộ sự kiện đã đăng ký (`removeEventListener`), ngắt các bộ đếm timer (`clearInterval`) để chống rò rỉ bộ nhớ (Memory Leak).

---

## CHƯƠNG 2: BÓC TÁCH CHI TIẾT MÀN HÌNH ĐĂNG NHẬP (`src/views/LoginView.vue`)

### 2.1. Cấu trúc template & Khôi phục phiên ghi nhớ
Tệp [src/views/LoginView.vue](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue) là cổng xác thực đầu tiên của ứng dụng.
- **Đầu vào (Inputs):** Tên đăng nhập (`username`), Mật khẩu (`password`), Địa chỉ máy chủ (`serverHost`), Cờ ghi nhớ tài khoản (`rememberMe`).
- **Ghi nhớ tài khoản:** Khi `onMounted()` chạy, hệ thống đọc `localStorage.getItem('smartcall_remembered_username')` để điền sẵn tên đăng nhập nếu người dùng đã từng đăng nhập trước đó.

### 2.2. Bóc tách hàm `handleLogin()` (Dòng 183-255)
- **Chữ ký:** `const handleLogin = async () =>`
- **Hàm này làm gì:** Tiếp nhận thông tin form, gửi yêu cầu xác thực tới máy chủ Wazo tổng đài, trích xuất hồ sơ User Profile từ Wazo SDK, và chuyển hướng người dùng sang màn hình `/calls`.
- **Luồng thực thi từng bước (Step-by-step Trace):**
  1. Kiểm tra rỗng: Nếu chưa nhập username hoặc password $ightarrow$ dừng lại.
  2. Bật cờ tải: `loading.value = true; errorMessage.value = ''`.
  3. **Cơ chế chống treo máy chủ (Race condition Timeout 15s):**
     Tạo một Promise ngắt sau 15 giây:
     ```javascript
     const timeoutPromise = new Promise((_, reject) =>
       setTimeout(() => reject(new Error('Timeout máy chủ Wazo')), 15000),
     )
     const session = await Promise.race([wazoService.login(u, p), timeoutPromise])
     ```
  4. **Trích xuất thông tin người dùng trực tiếp từ Session SDK:**
     - Tên hiển thị: Trích xuất `session.profile.firstName` + `lastName` hoặc `session.displayName`.
     - Số máy lẻ: Gọi `session.primaryNumber?.()`.
     - *Ưu điểm kỹ thuật:* Việc đọc trực tiếp từ SDK loại bỏ hoàn toàn yêu cầu gửi thêm HTTP request tới `confd/users/me`, triệt tiêu nguy cơ phát sinh lỗi CORS Preflight bị chặn bởi máy chủ mạng khắt khe.
  5. **Xử lý Remember Me:** Lưu hoặc xóa `smartcall_remembered_username` vào `localStorage`.
  6. **Đánh dấu đăng nhập hợp lệ & Điều hướng:**
     ```javascript
     localStorage.setItem('smartcall_logged_in', 'true')
     localStorage.setItem('smartcall_username', finalName)
     router.push(route.query.redirect || '/calls')
     ```
- **Ai gọi tới (Callers):**
  - Form submit: `<form @submit.prevent="handleLogin">` hoặc nút bấm **Đăng nhập**.
- **Hàm này gọi tới ai (Callees):**
  - `wazoService.login(u, p)`.
  - `router.push()`.
- **Trích dẫn mã nguồn thực tế:**
  ```javascript
  // src/views/LoginView.vue:183-210
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

      const profile = session?.profile || wazoService.session?.profile || {}
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
      realDisplayName = fullName || session?.displayName || u

      let exten = ''
      try {
        exten = session?.primaryNumber?.() || wazoService.session?.primaryNumber?.() || ''
      } catch {}
      realExtension = exten || (u === 'alice' ? '1001' : (u === 'bob' ? '1002' : '1001'))
  ```

---

## CHƯƠNG 3: BÓC TÁCH CHI TIẾT MÀN HÌNH CUỘC GỌI & BÀN PHÍM (`src/views/CallsView.vue`)

### 3.1. Giao diện Softphone kép
Tệp [src/views/CallsView.vue](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue) là trung tâm tương tác thoại của toàn bộ ứng dụng, gồm 2 nửa giao diện:
1. **Cột trái - Bàn phím số Softphone (Dialpad & In-call Controls):** Cho phép bấm số quay tay, bấm phím DTMF, và hiển thị giao diện đàm thoại (Active Call Card) khi có cuộc gọi đang kết nối.
2. **Cột phải - Danh bạ nội bộ công ty (Enterprise Directory & Quick Contacts):** Hiển thị danh bạ tải từ Wazo Dird, hỗ trợ tìm kiếm 3 chiều, phân loại phòng ban, danh bạ yêu thích, và nhãn nhận diện máy lẻ của chính mình `(Bạn)`.

### 3.2. Bảng ma trận 20 hàm nghiệp vụ trong `CallsView.vue`

| STT | Tên hàm | Kiểu | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `removeVietnameseTones(s)`| helper | `str: string` | `string` | Xóa dấu tiếng Việt để tìm kiếm không dấu |
| 2 | `pressKey(key)` | method | `key: string` | void | Nhập ký tự số vào ô quay số và phát âm phím DTMF |
| 3 | `clearDigit()` | method | Không | void | Xóa 1 ký tự cuối cùng trong ô quay số |
| 4 | `clearSearch()` | method | Không | void | Xóa ô tìm kiếm danh bạ |
| 5 | `handleDial()` | async | Không | void | Lấy số đã nhập và gọi qua `wazoService.validateAndMakeCall()` |
| 6 | `handleCallFromPanel(c)` | async | `contact: object` | void | Bấm gọi trực tiếp một liên hệ từ danh bạ |
| 7 | `handleMessage(contact)` | method | `contact: object` | void | Chuyển sang màn hình `/messages` mở chat với liên hệ |
| 8 | `toggleFavorite(contact)`| method | `contact: object` | void | Bật/tắt trạng thái yêu thích của liên hệ trong danh bạ |
| 9 | `loadContacts(silent)` | async | `silent = false` | void | Tải danh bạ từ `contactService.getContacts()` |
| 10 | `refreshContacts()` | async | Không | void | Nạp lại danh bạ thủ công khi bấm nút refresh |
| 11 | `hangupCall()` | method | Không | void | Cúp máy cuộc gọi đang hoạt động |
| 12 | `toggleMute()` | method | Không | void | Bật/tắt tắt tiếng micro |
| 13 | `toggleHold()` | method | Không | void | Bật/tắt giữ máy (Hold) |
| 14 | `toggleSpeaker()` | method | Không | void | Bật/tắt chuyển đổi loa ngoài |
| 15 | `onContactsUpdated()` | method | Không | void | Callback nhận sự kiện danh bạ/presence cập nhật |
| 16 | `getInitials(name)` | helper | `name: string` | `string` | Lấy 2 chữ cái đầu của tên làm avatar |
| 17 | `getAvatarColor(name)` | helper | `name: string` | `string` | Sinh màu nền avatar nhất quán theo tên |
| 18 | `cleanCallQueryParams()` | helper | Không | void | Xóa tham số query trên URL sau khi xử lý gọi |
| 19 | `onCallEnded()` | method | Không | void | Phản hồi khi cuộc gọi kết thúc |
| 20 | `filteredContacts` | computed | Không | `Contact[]` | Lọc danh bạ theo tab phòng ban và từ khóa tìm kiếm |

---

### 3.3. Bóc tách chi tiết các hàm trọng yếu trong `CallsView.vue`

#### Hàm 1: `pressKey(key)` (Dòng 577-592)
- **Hàm này làm gì:** Khi người dùng bấm vào các nút `0`-`9`, `*`, `#` trên bàn phím:
  1. Nếu đang có cuộc gọi hoạt động (`callStore.activeCall`): Phát tín hiệu DTMF tới tổng đài qua `wazoService.sendDTMF(key)` để điều hướng menu thoại tự động IVR.
  2. Đồng thời, gọi `audioService.playDtmfTone(key)` để phát âm thanh phản hồi tần số kép ra loa cho người dùng nghe thấy.
  3. Bổ sung ký tự vào ô số `dialNumber.value += key`.
- **Trích dẫn mã nguồn thực tế:**
  ```javascript
  // src/views/CallsView.vue:577-592
  const pressKey = (key) => {
    dialNumber.value += key
    audioService.playDtmfTone(key)
    if (callStore.activeCall && callStore.activeCall.status === 'connected') {
      try {
        wazoService.sendDTMF(key)
      } catch (err) {
        console.warn('Lỗi gửi DTMF:', err)
      }
    }
  }
  ```

#### Hàm 2: `handleDial()` (Dòng 611-660)
- **Hàm này làm gì:** Lấy số máy lẻ người dùng vừa nhập trong `dialNumber.value` và gửi tới cổng kiểm tra 7 lớp `wazoService.validateAndMakeCall(num, { allowUnknown: true })`.
- **Xử lý kết quả trả về:**
  - Nếu `success === true`: Xóa sạch ô nhập số `dialNumber.value = ''` để sẵn sàng cho lần gọi tiếp theo.
  - Nếu `reason === 'THROTTLED'`: Cảnh báo thao tác quá nhanh.
  - Nếu `reason === 'NO_MICROPHONE'`: Hiển thị thông báo yêu cầu cắm thiết bị micro.
  - Nếu `reason === 'TARGET_BUSY'`: Hiển thị cảnh báo máy bận.
  - Nếu `reason === 'TARGET_OFFLINE'`: Hiển thị cảnh báo đối phương đang ngoại tuyến.

#### Hàm 3: `handleCallFromPanel(contact)` (Dòng 704-740)
- **Hàm này làm gì:** Kích hoạt cuộc gọi khi người dùng bấm biểu tượng chiếc điện thoại xanh bên cạnh một người trong danh bạ.
- **Tính năng gợi ý nhắn tin khi gọi số Offline (Quy tắc nghiệp vụ 3.2):**
  - Kiểm tra `contact.status === 'offline'`.
  - Hiển thị hộp thoại xác nhận:
    ```javascript
    const shouldChat = window.confirm(
      `Máy lẻ [${contact.name} - ${contact.number}] hiện đang ngoại tuyến. Bạn có muốn chuyển sang gửi tin nhắn không?`
    )
    if (shouldChat) {
      handleMessage(contact)
      return
    }
    ```
  - Nếu người dùng đồng ý, tự động chuyển sang `/messages` và mở phòng chat với liên hệ đó.

---

## CHƯƠNG 4: BÓC TÁCH CHI TIẾT MÀN HÌNH TIN NHẮN REALTIME (`src/views/MessagesView.vue`)

### 4.1. Kiến trúc Khung chat 2 cột & Danh sách phòng SSOT Timestamp
Tệp [src/views/MessagesView.vue](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue) cung cấp trải nghiệm nhắn tin hợp nhất thời gian thực:
- **Cột trái:** Danh sách toàn bộ các cuộc trò chuyện (1-1 và Nhóm), nút "+ Tạo nhóm", ô tìm kiếm phòng chat.
- **Cột phải:** Khung chat chi tiết, luồng tin nhắn, trạng thái gửi/nhận (pending, delivered), nút gọi thoại nhanh từ chat, và ô soạn thảo tin nhắn.

### 4.2. Bảng ma trận 16 hàm nghiệp vụ trong `MessagesView.vue`

| STT | Tên hàm | Kiểu | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `loadRooms()` | async | Không | void | Tải danh sách phòng chat từ `chatService.getRooms()` |
| 2 | `selectRoom(room)` | async | `room: object` | void | Chọn một phòng chat để xem tin nhắn, đánh dấu đã đọc |
| 3 | `sendMessage()` | async | Không | void | Gửi nội dung tin nhắn soạn thảo qua `chatService.sendMessage()` |
| 4 | `scrollToBottom()` | helper | Không | void | Tự động cuộn khung chat xuống đáy tin nhắn mới nhất |
| 5 | `checkDirectChatRoute()` | method | Không | void | Kiểm tra query URL `?contact=...` để mở chat 1-1 từ danh bạ |
| 6 | `onMessageReceived(ev)`| method | `event` | void | Callback nhận tin nhắn mới từ WebSocket, tự cuộn trang |
| 7 | `onRoomsUpdated()` | method | Không | void | Callback nhận sự kiện danh sách phòng cập nhật |
| 8 | `startVoiceCall()` | method | Không | void | Bấm nút gọi thoại trên đầu khung chat để quay số liên hệ |
| 9 | `startVideoCall()` | method | Không | void | Bấm nút gọi video (dự phòng nâng cấp) |
| 10 | `openAddMemberModal()` | method | Không | void | Mở modal thêm thành viên vào nhóm chat |
| 11 | `saveGroupTitle()` | async | Không | void | Đổi tên nhóm chat và đồng bộ lên server |
| 12 | `searchAndAdd()` | async | Không | void | Tìm kiếm nhân sự và thêm vào nhóm chat |
| 13 | `removeMember(m)` | async | `member` | void | Xóa thành viên khỏi nhóm chat |
| 14 | `pinMessage(msg)` | async | `msg` | void | Ghim một tin nhắn quan trọng lên đầu phòng |
| 15 | `sortedRooms` | computed | Không | `Room[]` | Danh sách phòng sắp xếp theo SSOT Timestamp |
| 16 | `currentRoomMessages` | computed | Không | `Message[]` | Danh sách tin nhắn của phòng đang được chọn |

---

### 4.3. Bóc tách chi tiết các hàm trọng yếu trong `MessagesView.vue`

#### Hàm 1: `checkDirectChatRoute()` (Dòng 367-440)
- **Hàm này làm gì:** Khi người dùng ở màn hình Danh bạ bấm "Gửi tin nhắn", router chuyển hướng sang `/messages?contact=1002&name=Bob`. Hàm này bắt các query params để tự động tìm hoặc mở phòng chat 1-1 với Bob.
- **Xử lý đặc biệt chat với chính mình `isSelf`:**
  - Nhận diện `cleanExt === myExt` $ightarrow$ Tự động gắn hậu tố `(Bạn)` vào tên phòng: `title = fullName + ' (Bạn)'`.
  - Gán màu nền xanh lục `avatarBg = '#059669'`.
  - Khởi tạo `updatedAt: 0` cho phòng tạm để không tự động đẩy phòng rỗng lên đè các phòng đang có tin nhắn hoạt động.

#### Hàm 2: `scrollToBottom()` (Dòng 358-366)
- **Hàm này làm gì:** Đảm bảo khung chat luôn hiển thị tin nhắn mới nhất vừa đến.
- **Kỹ thuật Vue 3 `nextTick()`:**
  - Khi một tin nhắn mới được thêm vào mảng `messages`, DOM chưa được cập nhật ngay lập tức.
  - Hàm sử dụng `await nextTick()` để chờ Vue hoàn thành chu trình re-render DOM, sau đó mới gán:
    ```javascript
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    ```
    Nhờ đó, hành động cuộn trang luôn chính xác tuyệt đối, không bị kẹt lửng ở vị trí cũ.

---

## CHƯƠNG 5: BÓC TÁCH CHI TIẾT MÀN HÌNH LỊCH SỬ CUỘC GỌI (`src/views/HistoryView.vue`)

### 5.1. Bảng dữ liệu CDR & Hệ thống 4 tab lọc số liệu động
Tệp [src/views/HistoryView.vue](file:///d:/Project/Smart_Call_Web/src/views/HistoryView.vue) là nơi quản lý toàn bộ nhật ký cuộc gọi của doanh nghiệp.
Giao diện cung cấp 4 tab lọc với số đếm động chính xác:
- **TẤT CẢ (`all`):** Hiển thị toàn bộ cuộc gọi đến, đi và nhỡ.
- **GỌI ĐẾN (`incomings`):** Lọc theo `direction === 'inbound' && answered === true`.
- **GỌI ĐI (`outgoings`):** Lọc theo `direction === 'outbound'`.
- **CUỘC GỌI NHỠ (`missed`):** Lọc theo cuộc gọi nhỡ (hiển thị màu đỏ cảnh báo).

### 5.2. Bảng ma trận 7 hàm nghiệp vụ trong `HistoryView.vue`

| STT | Tên hàm | Kiểu | Tham số | Giá trị trả về | Chức năng tóm tắt |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `fetchHistory()` | async | Không | void | Gọi `historyService.getHistory()` tải danh sách CDR |
| 2 | `formatDuration(sec)` | helper | `seconds: number` | `string` | Định dạng giây thành `mm:ss` |
| 3 | `getInitials(name)` | helper | `name: string` | `string` | Lấy 2 chữ cái đầu tạo avatar người gọi |
| 4 | `handleCallback(call)` | method | `call: object` | void | Bấm nút Gọi lại (Redial) ngay từ lịch sử |
| 5 | `handleChat(call)` | method | `call: object` | void | Chuyển sang màn hình chat với số máy lẻ trong lịch sử |
| 6 | `handleDeleteItem(call)`| async | `call: object` | void | Xóa 1 bản ghi CDR cụ thể khỏi danh sách |
| 7 | `confirmDeleteAll()` | async | Không | void | Hiển thị hộp thoại xác nhận xóa sạch toàn bộ lịch sử |

---

### 5.3. Bóc tách chi tiết hàm `handleCallback(call)` (Dòng 281-305)
- **Hàm này làm gì:** Khi người dùng bấm biểu tượng chiếc điện thoại trên một dòng lịch sử cuộc gọi:
  - Trích xuất số máy lẻ: `const ext = call.extension`.
  - Chuyển hướng sang màn hình Cuộc gọi kèm tham số tự động quay số:
    ```javascript
    router.push({
      path: '/calls',
      query: { autoCall: ext, name: call.name },
    })
    ```
  - Tại `CallsView.vue`, watcher sẽ bắt query `autoCall` và kích hoạt ngay `wazoService.validateAndMakeCall(ext)`.

---

## CHƯƠNG 6: BÓC TÁCH CHI TIẾT POPUP CUỘC GỌI ĐẾN (`IncomingCallModal.vue`)

### 6.1. Kiến trúc Modal đè toàn cục (Global Overlay) & Chuông đến
Tệp [src/components/call/IncomingCallModal.vue](file:///d:/Project/Smart_Call_Web/src/components/call/IncomingCallModal.vue) được nhúng tại gốc của ứng dụng (`App.vue`), đảm bảo khi có cuộc gọi đến thì dù người dùng đang ở bất kỳ màn hình nào (Tin nhắn, Danh bạ hay Cài đặt), popup cuộc gọi đến vẫn lập tức hiển thị đè lên trên cùng.

### 6.2. Bóc tách các hàm xử lý tương tác
1. **Lắng nghe cuộc gọi đến (`watch(callStore.incomingCall)`):**
   - Khi `callStore.incomingCall` khác `null`, component tự động hiển thị modal và kích hoạt âm chuông đến: `audioService.startIncomingRingtone()`.
   - Bắt đầu bộ đếm đỗ chuông tự ngắt sau 45 giây nếu người nhận không trả lời (`handleTimeout`).
2. **Hàm `handleAccept()` (Dòng 118-123):**
   - Dừng chuông: `audioService.stopIncomingRingtone()`.
   - Chấp nhận cuộc gọi qua Wazo SDK: `wazoService.acceptIncomingCall(callStore.incomingCall)`.
   - Modal tự động đóng lại, chuyển giao diện sang đàm thoại.
3. **Hàm `handleReject()` (Dòng 124-130):**
   - Dừng chuông: `audioService.stopIncomingRingtone()`.
   - Từ chối cuộc gọi qua Wazo SDK: `wazoService.rejectIncomingCall(callStore.incomingCall)`.
   - Tự động ghi nhận cuộc gọi từ chối vào lịch sử CDR.

---

## CHƯƠNG 7: BÓC TÁCH CHI TIẾT MODAL CÀI ĐẶT THIẾT BỊ (`SettingsModal.vue`)

### 7.1. Giao diện phần cứng: Quét Mic/Loa, setSinkId & Mic Meter VAD
Tệp [src/components/common/SettingsModal.vue](file:///d:/Project/Smart_Call_Web/src/components/common/SettingsModal.vue) quản lý cấu hình người dùng và kiểm tra phần cứng âm thanh.

### 7.2. Bóc tách các hàm chính
1. **`loadAudioDevices()` (Dòng 262-300):**
   - Gọi `navigator.mediaDevices.enumerateDevices()` để quét toàn bộ thiết bị.
   - Lọc thiết bị:
     - Microphones: `devices.filter(d => d.kind === 'audioinput')`.
     - Speakers/Headsets: `devices.filter(d => d.kind === 'audiooutput')`.
   - Tải cấu hình đã lưu trong `localStorage.getItem('smartcall_audio_input_id')`.
2. **`startMicMeter()` (Dòng 304-360):**
   - Kết nối với `audioService.startMicMeter(selectedInput.value, onVolumeChange)`.
   - Nhận giá trị âm lượng RMS đã qua bộ lọc VAD Hangover và cập nhật thanh tiến trình màu xanh trên giao diện (mượt mà, không nhấp nháy).
3. **`testSound()` (Dòng 439-460):**
   - Phát thử một chu kỳ âm chuông 440Hz + 480Hz qua thiết bị loa đang chọn để người dùng kiểm tra âm lượng tai nghe/loa trước khi gọi.
4. **`handleSave()` (Dòng 479-500):**
   - Lưu ID thiết bị Mic và Loa vào `localStorage`.
   - Dừng mic meter và đóng modal.

---

## CHƯƠNG 8: BÓC TÁCH CHI TIẾT HEADER & SIDEBAR ĐIỀU HƯỚNG

### 8.1. `src/components/layout/AppHeader.vue`
- **Chấm trạng thái hiện diện đa sắc thái:**
  - Hiển thị chấm màu đồng bộ theo trạng thái cá nhân: Xanh (Online), Cam (Busy/Đang gọi), Tím (Đang đổ chuông), Đỏ (Không làm phiền), Vàng (Vắng mặt), Xám (Offline).
- **Hàm `updatePresence(state, text)` (Dòng 130-150):**
  - Cho phép người dùng bấm vào menu dropdown trên Header để đổi trạng thái cá nhân:
    - Sẵn sàng (`available`)
    - Vắng mặt (`away`)
    - Không làm phiền (`dnd`)
  - Gửi request đồng bộ lên tổng đài Wazo qua `wazoService.setPresence(state, text)`.

### 8.2. `src/components/layout/AppSidebar.vue`
- **Huy hiệu số (Unread Badge Counters):**
  - Sidebar tính toán số lượng tin nhắn chưa đọc trong toàn bộ các phòng chat từ `chatService.getRooms()`.
  - Hiển thị huy hiệu đỏ nổi bật ngay cạnh tab **Tin nhắn** (`/messages`).
  - *Quy chuẩn 3.4:* Đã loại bỏ số đếm trên tab Danh bạ và Lịch sử, chỉ giữ lại số đếm tin nhắn chưa đọc để không gây rối mắt người dùng.
- **Hàm `debouncedUpdateSidebarCounts()` (Dòng 83-95):**
  - Áp dụng kỹ thuật Debounce 300ms: Khi có nhiều tin nhắn đến liên tục, hệ thống gom lại tính toán 1 lần duy nhất, tối ưu hiệu năng render của trình duyệt.

---
*Tài liệu Tập 2 được biên soạn độc quyền cho Dự án SmartCall Web nhằm mục đích đặc tả chi tiết tầng Giao diện & Thành phần và đào tạo nội bộ.*
