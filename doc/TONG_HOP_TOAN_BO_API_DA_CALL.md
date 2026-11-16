# TỔNG HỢP TOÀN BỘ CÁC API & KẾT NỐI MÁY CHỦ SỬ DỤNG TRONG SMARTCALL WEB

> **Dự án:** SmartCall Web (WebRTC Softphone & Realtime Messaging Client)  
> **Tổng số API máy chủ Wazo PBX:** Hơn 840 API (Chủ yếu là API quản trị hạ tầng, SIP Trunk, Tenant, Queue, IVR, Provisioning).  
> **Số lượng API thực tế SmartCall Web sử dụng:** **14 REST API** + **2 Kênh WebSocket thời gian thực** (Tổng cộng 16 kết nối).  
> **Mục tiêu:** Tối ưu hóa hiệu năng, khởi động cực nhanh, không phụ thuộc vào hạ tầng quản trị cồng kềnh, bảo toàn 100% dữ liệu thực viễn thông.

---

## 1. MA TRẬN TỔNG HỢP 16 API & KẾT NỐI THỜI GIAN THỰC

| STT | Phương thức | Endpoint API / Kênh kết nối | Microservice | Phân hệ gọi | Vị trí gọi trong mã nguồn | Tác dụng nghiệp vụ |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | `POST` | `/api/auth/0.1/token` | `wazo-auth` | **Login** | `wazo.js:51` | Xác thực tài khoản, cấp phát Token & Session UUID |
| **2** | `GET` | `/api/auth/0.1/token/{token}` | `wazo-auth` | **Login / Init** | `wazo.js:103` | Kiểm tra token cũ để tự động phục hồi phiên khi F5 |
| **3** | `DELETE`| `/api/auth/0.1/token/{token}` | `wazo-auth` | **Logout** | `wazo.js:151` | Hủy token phiên làm việc trên máy chủ khi đăng xuất |
| **4** | `GET` | `/api/confd/1.1/users/me` | `wazo-confd` | **Login / Profile**| `LoginView.vue:218` | Dự phòng lấy họ tên, UUID và số máy lẻ nếu SDK thiếu |
| **5** | `GET` | `/api/dird/0.1/directories/default/sources` | `wazo-dird` | **Contacts** | `contactService.js:100` | Lấy định danh nguồn danh bạ nội bộ (`sourceUuid`) |
| **6** | `GET` | `/api/dird/0.1/backends/wazo/sources/{id}/contacts` | `wazo-dird` | **Contacts** | `contactService.js:113` | Tải toàn bộ danh bạ nhân sự công ty (kèm số máy lẻ) |
| **7** | `GET` | `/api/dird/0.1/directories/lookup/default` | `wazo-dird` | **Contacts** | `contactService.js:132` | Tìm kiếm danh bạ dự phòng khi nguồn chính rỗng |
| **8** | `GET` | `/api/chatd/1.0/users/presences` | `wazo-chatd` | **Presence** | `contactService.js:290` | Tải trạng thái Online/Busy/Away của danh bạ hàng loạt |
| **9** | `PUT` | `/api/chatd/1.0/users/{uuid}/presences` | `wazo-chatd` | **Header / Status**| `wazo.js:1064` | Đổi trạng thái cá nhân (Sẵn sàng, Vắng mặt, DND) |
| **10**| `GET` | `/api/chatd/1.0/users/me/rooms` | `wazo-chatd` | **Messages** | `chatService.js:187` | Tải danh sách tất cả các phòng chat (1-1 & Nhóm) |
| **11**| `GET` | `/api/chatd/1.0/users/me/rooms/{id}/messages` | `wazo-chatd` | **Messages** | `chatService.js:280` | Tải lịch sử 50 tin nhắn cũ trong một phòng chat |
| **12**| `POST`| `/api/chatd/1.0/users/me/rooms` | `wazo-chatd` | **Messages** | `chatService.js:362` | Tạo phòng chat mới (phòng nhóm hoặc 1-1 mới) |
| **13**| `POST`| `/api/chatd/1.0/users/me/rooms/{id}/messages` | `wazo-chatd` | **Messages** | `chatService.js:450` | Gửi tin nhắn văn bản mới vào phòng chat |
| **14**| `GET` | `/api/call-logd/1.0/users/me/cdr` | `wazo-call-logd` | **History / CDR**| `historyService.js:122` | Tải danh sách bản ghi chi tiết lịch sử cuộc gọi |
| **15**| `WSS` | `/api/asterisk/ws` | **Asterisk PBX** | **Calls / WebRTC** | `wazo.js:291` | Kênh SIP WebSocket: Đăng ký số máy lẻ & đàm thoại thoại |
| **16**| `WSS` | `/api/websocketd/?token=...&version=2` | **websocketd** | **Event Bus** | `wazo.js:219` | Lắng nghe tin nhắn mới & biến động trạng thái thời gian thực |

---

## 2. BÓC TÁCH CHI TIẾT TỪNG PHÂN HỆ

### 2.1. Phân hệ Xác thực & Quản lý Phiên (Authentication & Session)

#### 1. `POST /api/auth/0.1/token`
- **Microservice:** `wazo-auth` (:9443)
- **Tác dụng:** Cung cấp thông tin đăng nhập người dùng (Username & Password) để lấy về Session Token hợp lệ, thời gian hết hạn và định danh tài khoản.
- **Header gửi đi:**
  ```http
  POST /api/auth/0.1/token HTTP/1.1
  Host: 107.126.11.126:9443
  Authorization: Basic dXNlcjpwYXNz
  Content-Type: application/json
  ```
- **Body JSON:**
  ```json
  {
    "backend": "wazo_user",
    "expiration": 1209600
  }
  ```
- **Ai gọi tới:**
  - View: [src/views/LoginView.vue:194](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue#L194) (`handleLogin`).
  - Service: [src/services/wazo.js:51](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L51) (`Wazo.Auth.logIn`).

#### 2. `GET /api/auth/0.1/token/{token}`
- **Microservice:** `wazo-auth` (:9443)
- **Tác dụng:** Xác minh tính hợp lệ của Token cũ lưu trong bộ nhớ `localStorage` khi người dùng F5 hoặc khởi động lại ứng dụng.
- **Ai gọi tới:**
  - Service: [src/services/wazo.js:103](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L103) (`Wazo.Auth.validateToken`).

#### 3. `DELETE /api/auth/0.1/token/{token}`
- **Microservice:** `wazo-auth` (:9443)
- **Tác dụng:** Hủy bỏ token phiên trên máy chủ tổng đài, vô hiệu hóa phiên làm việc khi người dùng bấm Đăng xuất.
- **Ai gọi tới:**
  - Service: [src/services/wazo.js:151](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L151) (`Wazo.Auth.logout`).
  - Kích hoạt khi bấm nút **Đăng xuất** trên Header.

#### 4. `GET /api/confd/1.1/users/me`
- **Microservice:** `wazo-confd` (:9443)
- **Tác dụng:** Truy vấn hồ sơ mở rộng của người dùng (Firstname, Lastname, User UUID, và Số máy lẻ cấu hình trên đường dây). Đóng vai trò là kênh dự phòng an toàn nếu SDK Session bị thiếu thông tin số máy lẻ.
- **Ai gọi tới:**
  - View: [src/views/LoginView.vue:218](file:///d:/Project/Smart_Call_Web/src/views/LoginView.vue#L218) (trong khối `try/catch` độc lập).

---

### 2.2. Phân hệ Danh bạ & Hiện diện (Directory & Presence)

#### 5. `GET /api/dird/0.1/directories/default/sources?backend=wazo`
- **Microservice:** `wazo-dird` (:9443)
- **Tác dụng:** Lấy danh sách các nguồn danh bạ nội bộ được cấu hình trên tổng đài Wazo, trích xuất `sourceUuid`.
- **Header:** `X-Auth-Token: <token>`
- **Ai gọi tới:**
  - Service: [src/services/contactService.js:100](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L100) (`getContacts`).

#### 6. `GET /api/dird/0.1/backends/wazo/sources/{sourceUuid}/contacts?limit=1000`
- **Microservice:** `wazo-dird` (:9443)
- **Tác dụng:** Tải toàn bộ danh sách liên hệ nội bộ (họ tên, máy lẻ, phòng ban) của tất cả nhân viên trong doanh nghiệp.
- **Ai gọi tới:**
  - Service: [src/services/contactService.js:113](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L113) (`getContacts`).
  - Kích hoạt khi người dùng vào màn hình Cuộc gọi [CallsView.vue](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue).

#### 7. `GET /api/dird/0.1/directories/lookup/default?term={query}&limit=200`
- **Microservice:** `wazo-dird` (:9443)
- **Tác dụng:** Kênh tìm kiếm danh bạ trực tiếp dự phòng nếu nguồn danh bạ chính trả về rỗng.
- **Ai gọi tới:**
  - Service: [src/services/contactService.js:132](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L132) (`getContacts`).

#### 8. `GET /api/chatd/1.0/users/presences?user_uuid={uuid1,uuid2,...}`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Tải hàng loạt trạng thái hiện diện (Presence) của các nhân sự trong danh bạ: xem ai đang bận đàm thoại (`talking`), ai đang đổ chuông (`ringing`), ai bật Không làm phiền (`dnd`), ai vắng mặt (`away`).
- **Ai gọi tới:**
  - Service: [src/services/contactService.js:290](file:///d:/Project/Smart_Call_Web/src/services/contactService.js#L290) (`loadPresencesForContacts`).

#### 9. `PUT /api/chatd/1.0/users/{user_uuid}/presences`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Cập nhật trạng thái cá nhân của người dùng lên tổng đài (Body: `{ "state": "available" | "away" | "unavailable", "status": "Sẵn sàng" }`).
- **Ai gọi tới:**
  - View: [src/components/layout/AppHeader.vue:130](file:///d:/Project/Smart_Call_Web/src/components/layout/AppHeader.vue#L130) khi chọn đổi trạng thái trên Header.
  - Service: [src/services/wazo.js:1064](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L1064) (`setPresence`).

---

### 2.3. Phân hệ Tin nhắn thời gian thực (Realtime Chat - Wazo Chatd)

#### 10. `GET /api/chatd/1.0/users/me/rooms`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Tải danh sách tất cả các phòng chat (cá nhân 1-1 và phòng nhóm) mà tài khoản hiện tại đang tham gia.
- **Ai gọi tới:**
  - View: [src/views/MessagesView.vue:288](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L288) (`loadRooms`).
  - Service: [src/services/chatService.js:187](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L187) (`getRooms`).

#### 11. `GET /api/chatd/1.0/users/me/rooms/{roomId}/messages?limit=50`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Tải lịch sử 50 tin nhắn cũ trong một phòng chat cụ thể khi người dùng bấm chọn phòng đó.
- **Ai gọi tới:**
  - View: [src/views/MessagesView.vue:296](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L296) (`selectRoom`).
  - Service: [src/services/chatService.js:280](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L280) (`loadRoomMessages`).

#### 12. `POST /api/chatd/1.0/users/me/rooms`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Tạo một phòng chat mới trên máy chủ (phòng chat nhóm hoặc phòng 1-1 mới).
- **Body JSON:**
  ```json
  {
    "name": "Nhóm Kỹ thuật Viễn thông",
    "users": [
      { "uuid": "user-uuid-1001" },
      { "uuid": "user-uuid-1002" }
    ]
  }
  ```
- **Ai gọi tới:**
  - View: [src/views/MessagesView.vue:524](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L524) khi người dùng bấm Tạo nhóm.
  - Service: [src/services/chatService.js:362](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L362) (`createGroupRoom`).

#### 13. `POST /api/chatd/1.0/users/me/rooms/{roomId}/messages`
- **Microservice:** `wazo-chatd` (:9443)
- **Tác dụng:** Gửi tin nhắn văn bản mới vào phòng chat (kết hợp với kỹ thuật Optimistic UI 0ms).
- **Body JSON:** `{ "content": "Nội dung tin nhắn" }`
- **Ai gọi tới:**
  - View: [src/views/MessagesView.vue:333](file:///d:/Project/Smart_Call_Web/src/views/MessagesView.vue#L333) (`sendMessage`).
  - Service: [src/services/chatService.js:450](file:///d:/Project/Smart_Call_Web/src/services/chatService.js#L450) (`sendMessage`).

---

### 2.4. Phân hệ Lịch sử Cuộc gọi (CDR - Wazo Call-logd)

#### 14. `GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc`
- **Microservice:** `wazo-call-logd` (:9443)
- **Tác dụng:** Tải danh sách bản ghi chi tiết các cuộc gọi (thời gian, máy gọi, máy nhận, hướng gọi đến/đi, thời lượng đàm thoại, trạng thái nghe máy/nhỡ) được lưu trữ trên cơ sở dữ liệu viễn thông.
- **Ai gọi tới:**
  - View: [src/views/HistoryView.vue:204](file:///d:/Project/Smart_Call_Web/src/views/HistoryView.vue#L204) (`fetchHistory`).
  - Service: [src/services/historyService.js:122](file:///d:/Project/Smart_Call_Web/src/services/historyService.js#L122) (`getHistory`), tích hợp cơ chế Dual-Source và In-flight Promise Sharing.

---

### 2.5. Phân hệ Báo hiệu & Âm thoại WebRTC (Wazo Asterisk SIP Phone)

#### 15. `WSS /api/asterisk/ws` (SIP over WebSocket)
- **Hạ tầng:** Asterisk PBX WebRTC WebSocket (:9443)
- **Tác dụng:** Trao đổi các bản tin báo hiệu SIP chuẩn viễn thông cho WebRTC:
  - `SIP REGISTER`: Khai báo máy lẻ của người dùng đã online trên tổng đài Asterisk.
  - `SIP INVITE`: Khởi tạo cuộc gọi đi hoặc nhận cuộc gọi đến, trao đổi SDP Offer/Answer chứa Codec âm thanh Opus.
  - `SIP 180 Ringing`: Phản hồi chuông đang đổ ở máy nhận.
  - `SIP 200 OK`: Phản hồi nhấc máy, bắt đầu kết nối luồng âm thoại RTP.
  - `SIP BYE`: Cúp máy kết thúc cuộc gọi.
  - `SIP INFO` / RFC 2833: Gửi tín hiệu bấm phím số DTMF.
  - Điều khiển âm thoại: Mute, Unmute, Hold, Unhold.
- **Ai gọi tới:**
  - Khởi tạo: [src/services/wazo.js:291](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L291) (`connectPhone`).
  - Điều khiển: [src/services/wazo.js:740](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L740) (`validateAndMakeCall` từ [CallsView.vue](file:///d:/Project/Smart_Call_Web/src/views/CallsView.vue)).

---

### 2.6. Phân hệ Phát sóng Sự kiện Tổng đài (Wazo Event Bus)

#### 16. `WSS /api/websocketd/?token={token}&version=2`
- **Hạ tầng:** `wazo-websocketd` (:9443)
- **Tác dụng:** Kênh lắng nghe các sự kiện thời gian thực (Push Notifications) phát từ tổng đài về trình duyệt:
  - `chatd_user_room_message_created`: Nhận tin nhắn chat mới từ đồng nghiệp.
  - `user_presence_updated` / `wazo-presence-updated`: Nhận biến động trạng thái (bận máy, vắng mặt, online).
  - `users_services_dnd_updated`: Nhận sự kiện bật/tắt chế độ Không làm phiền.
- **Ai gọi tới:**
  - Khởi tạo: [src/services/wazo.js:219](file:///d:/Project/Smart_Call_Web/src/services/wazo.js#L219) (`openWebSocketEvents`).
  - Phân phối nội bộ: [src/services/websocketService.js](file:///d:/Project/Smart_Call_Web/src/services/websocketService.js).

---
*Tài liệu này được biên soạn độc quyền cho Dự án SmartCall Web nhằm mục đích tổng hợp và quản trị toàn diện các điểm kết nối API máy chủ.*
