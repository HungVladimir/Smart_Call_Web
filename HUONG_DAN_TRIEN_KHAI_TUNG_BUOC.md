# SMARTCALL WEB — NHẬT KÝ THỰC HIỆN & HƯỚNG DẪN TỪNG BƯỚC

> **Tài liệu theo dõi tiến độ phát triển từng bước (Step-by-step Development Log)**  
> *Dành cho:* Nhà phát triển SmartCall Web  
> *Quy tắc làm việc:* **Hướng dẫn làm từng bước một** $\rightarrow$ Thực hiện & Kiểm tra $\rightarrow$ Cập nhật trạng thái vào file này $\rightarrow$ Chuyển sang bước tiếp theo.

---

## BẢNG THEO DÕI TIẾN ĐỘ TỔNG THỂ

| Bước | Nội dung công việc | Trạng thái | Ghi chú / Kết quả |
|:---:|---|:---:|---|
| **01** | Khởi tạo base & Trích xuất code latest từ Excel vào `src/` | **HOÀN THÀNH** ✅ | Trích xuất 11 file, cấu hình `src/assets/main.css`, build thành công trong 334ms. |
| **01.5** | Tạo bản xem trước giao diện hoàn chỉnh (`preview_smartcall.html`) | **HOÀN THÀNH** ✅ | Đã dựng bản HTML tương tác đầy đủ 5 phân hệ + modal để duyệt trước khi code Vue. |
| **02** | Chuẩn hóa Layout Web (Header + Sidebar) & Hoàn thiện luồng Login | **HOÀN THÀNH** ✅ | Đã code Header có status/settings, Sidebar dọc 5 tab, Settings modal 4 tab, Login mượt mà. |
| **03** | Nâng cấp Danh bạ (Contacts) đầy đủ 4 nút hành động & Tinh chỉnh cuộc gọi | **TIẾP THEO** 🚀 | Bổ sung 4 nút hành động theo app4.webp, tích hợp gọi nhanh sang CallsView. |
| **04** | Nâng cấp Danh bạ (Contacts) đầy đủ 4 nút hành động | *Chưa bắt đầu* ⏳ | Nút Gọi thoại, Nhắn tin, Gọi video, Xóa liên hệ theo `app4.webp`. |
| **05** | Xây dựng Module Tin Nhắn (Chat / Messaging) | *Chưa bắt đầu* ⏳ | Danh sách phòng chat, khung chat, ghim tin nhắn, modal Add Member theo `app1, 2, 3`. |
| **06** | Chuẩn hóa Lịch sử cuộc gọi (Call History) | *Chưa bắt đầu* ⏳ | Các tab lọc All, Inbound, Outbound, Missed theo `web1.webp` và nút gọi lại. |
| **07** | Tích hợp WebSocket Realtime & Kiểm thử toàn diện LAN | *Chưa bắt đầu* ⏳ | Lắng nghe sự kiện cuộc gọi, tin nhắn, presence không cần F5. |

---

## CHI TIẾT CÁC BƯỚC THỰC HIỆN

---

### BƯỚC 1: ĐỒNG BỘ CODE LATEST TỪ EXCEL VÀO DỰ ÁN
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Đưa toàn bộ mã nguồn anh Dũng đã tạo từ file `sm_code_latest.xlsx` vào đúng cấu trúc thư mục `src/`, đảm bảo dự án chạy dev server và build thành công.

#### Các việc đã làm:
1. Đã trích xuất các file từ Excel vào vị trí chính xác:
   - `src/services/wazo.js` (Giữ nguyên `return ... || true` để bypass kiểm tra khi chưa có DB).
   - `src/components/call/CallControlPanel.vue`
   - `src/components/layout/Navbar.vue`
   - `src/router/index.js`
   - `src/views/LoginView.vue`, `DashboardView.vue`, `ContactsView.vue`, `HistoryView.vue`
   - `src/App.vue`, `src/main.js`, `index.html`
2. Bổ sung file `src/assets/main.css` để `main.js` import không bị lỗi.
3. Chạy `npm i` khôi phục binary bindings trên môi trường Windows (`@rolldown/binding-win32-x64-msvc`).
4. Kiểm tra `npm run build` thành công 100% trong `334ms`.
5. Đã khởi động Dev Server chạy tại: `http://localhost:5174/`.

---

### BƯỚC 1.5: THIẾT KẾ BẢN XEM TRƯỚC GIAO DIỆN HOÀN CHỈNH (HTML UI PROTOTYPE)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Tạo một file HTML độc lập chứa toàn bộ giao diện hoàn chỉnh, có tương tác đầy đủ để bạn xem trước, bấm thử trải nghiệm thực tế trước khi chuyển sang viết code Vue 3.
* **Tài liệu bàn giao:** File [**`preview_smartcall.html`**](file:///D:/Project/Smart_Call_Web/preview_smartcall.html) ngay tại thư mục gốc dự án.

#### Các chức năng đã có trên bản xem trước:
1. **Top Header:** Logo SmartCall, Ô tìm kiếm nhân viên toàn hệ thống, User Profile (Lê Việt Dũng, máy lẻ 1001), Dropdown chọn trạng thái Presence (`🟢 Online`, `🟡 Away`, `🔴 DND`).
2. **Left Sidebar:** Điều hướng linh hoạt 5 phân hệ:
   - 📊 **Tổng quan (Dashboard):** Thẻ thông tin máy lẻ, trạng thái tổng đài Wazo, WebRTC SIP Registered, nút thử giả lập cuộc gọi đến.
   - 📞 **Gọi điện & Bàn phím số (Calls):** Bàn phím số (0-9, *, #), bấm số gọi đi, màn hình đàm thoại đang diễn ra theo `app5.webp` (đếm giờ, bật/tắt mic, giữ máy, loa, cúp máy).
   - 📇 **Danh bạ (Contacts):** Bảng danh bạ nhân viên hiển thị đầy đủ **4 nút hành động chuẩn theo `app4.webp`** (Gọi thoại, Nhắn tin kèm badge chưa đọc, Gọi Video, Xóa liên hệ có modal hỏi).
   - 💬 **Tin nhắn (Messages):** Cột trái danh sách phòng chat; Cột phải khung chat chi tiết, có **thanh ghim thông báo (`📌 Ghim: ...`)** theo `app2.webp`, bong bóng tin nhắn, nhấp vào `Read` mở popup xem danh sách ai đã đọc (`READ_ID`).
   - 🕒 **Lịch sử cuộc gọi (History):** Các tab lọc `ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED` theo `web1.webp` và nút Gọi lại nhanh.
3. **Modal "ADD MEMBER" chuẩn nghiệp vụ Admin (`app3.webp`):**
   - Đổi tên nhóm (TITLE, tối đa 100 ký tự - chỉ Admin mới được đổi).
   - Ô tìm kiếm nhân viên + nút Thêm (+) kèm xác nhận.
   - Danh sách thành viên hiện tại có nút Xóa (X) kèm xác nhận (khóa không cho xóa Admin, nhóm dưới 3 người ẩn nút X).
   - Nút OK chỉ sáng khi là Admin và tên nhóm có thay đổi.
4. **Popup giả lập cuộc gọi đến (Incoming Call):** Nút Nghe máy và Từ chối rung chuông trực quan.
5. **Modal Cài đặt hệ thống (SETTINGS Modal theo `web1.webp`):** Nút `⚙️ SETTINGS` trên thanh Header cho phép mở modal cài đặt gồm 4 Tab trực quan:
   - 🎙️ **Âm thanh & WebRTC:** Chọn Micro, chọn Loa/Tai nghe, thử âm thanh, thanh đo tín hiệu mic động, chỉnh âm lượng chuông gọi đến.
   - 📞 **Dịch vụ cuộc gọi (Theo `dev_guide.md`):** Bật/tắt Không làm phiền (DND), cấu hình Chuyển tiếp cuộc gọi (Call Forwarding khi bận, khi không trả lời sau 20s, chuyển tiếp vô điều kiện), Voicemail.
   - 🔒 **Tài khoản & Mật khẩu:** Xem thông tin SIP URI Wazo, đổi mật khẩu đăng nhập.
   - 🌐 **Ngôn ngữ & Tùy chọn:** Chuyển đổi Tiếng Việt / Tiếng Hàn (한국어) / Tiếng Anh cho môi trường SDV, bật/tắt thông báo đẩy Desktop và âm thanh tin nhắn chat.

---

### BƯỚC 2: CHUẨN HÓA LAYOUT WEB HIỆN ĐẠI & HOÀN THIỆN LUỒNG ĐĂNG NHẬP
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Xây dựng bộ khung Layout chuẩn máy tính (Desktop App Layout) hiện đại, thay thế Navbar ngang bằng Header + Sidebar dọc 5 phân hệ, có nút Settings mở modal 4 tab, và hoàn thiện màn hình Login có thể đăng nhập / đăng xuất mượt mà.

#### Các việc đã code và hoàn thành:
1. **Component `src/components/layout/AppHeader.vue`:**
   - Logo SmartCall, Huy hiệu mạng LAN.
   - Thanh tìm kiếm nhân viên toàn hệ thống.
   - Dropdown chọn trạng thái Presence (`🟢 Online`, `🟡 Away`, `🔴 DND`).
   - Avatar & Tên người dùng đang đăng nhập (`Lê Việt Dũng`, Máy lẻ `1001`).
   - Nút `⚙️ SETTINGS` mở modal cài đặt.
   - Nút `🚪 Thoát` (Đăng xuất).
2. **Component `src/components/layout/AppSidebar.vue`:**
   - Menu dọc bên trái 5 phân hệ: 📊 Tổng quan (`/dashboard`), 📞 Gọi thoại & Bàn phím (`/calls`), 📇 Danh bạ (`/contacts`), 💬 Tin nhắn (`/messages`), 🕒 Lịch sử cuộc gọi (`/history`).
   - Footer hiển thị máy lẻ SIP `1001@192.168.1.50` và trạng thái `● WebRTC Audio Ready`.
3. **Component `src/components/common/SettingsModal.vue`:**
   - 4 Tab cài đặt hoàn chỉnh: (1) Âm thanh/WebRTC (chọn mic, thử loa, thanh đo âm lượng), (2) Dịch vụ cuộc gọi (DND, Chuyển tiếp cuộc gọi khi bận/không trả lời/toàn bộ theo `dev_guide.md`), (3) Tài khoản Wazo & Đổi mật khẩu, (4) Ngôn ngữ (Việt - Hàn - Anh) & Thông báo.
4. **Màn hình `src/views/LoginView.vue`:**
   - Nút **LOGIN** xử lý đăng nhập thật với Wazo hoặc tự động chuyển sang chế độ Demo khi đang dev offline.
   - Thêm nút *"⚡ Đăng nhập nhanh (Chế độ Demo/Test)"* để test 1 chạm.
   - Lưu trạng thái đăng nhập vào `localStorage` (`smartcall_logged_in`).
5. **Màn hình mới `src/views/CallsView.vue` & `src/views/MessagesView.vue`:**
   - `CallsView`: Bàn phím số đầy đủ + mô phỏng cuộc gọi thoại WebRTC đang diễn ra (đếm giây, mute, hold, cúp máy theo `app5.webp`).
   - `MessagesView`: Danh sách phòng chat + khung chat + thanh ghim thông báo + popup Read ID + modal Thêm thành viên Admin theo `app1, 2, 3`.
6. **Cập nhật `src/router/index.js` & `src/App.vue`:**
   - Đăng ký đầy đủ các route: `/calls`, `/messages`, `/contacts`, `/history`, `/dashboard`, `/login`.
   - Bảo vệ route: Nếu chưa login hoặc bấm Đăng xuất sẽ ẩn toàn bộ Header/Sidebar và chuyển về trang Login toàn màn hình. Khi đăng nhập thành công sẽ hiện Header và Sidebar đầy đủ.
7. **Kiểm tra biên dịch:** `npm run build` thành công 100% trong `400ms`.

---

### BƯỚC 3: NÂNG CẤP DANH BẠ (CONTACTS) 4 NÚT HÀNH ĐỘNG & CUỘC GỌI WEBRTC
* **Trạng thái:** `TIẾP THEO 🚀`
* **Mục tiêu:**
  1. Cập nhật `src/views/ContactsView.vue` để hiển thị danh bạ dạng bảng/danh sách hiện đại, trang bị đầy đủ **4 nút hành động chuẩn theo `app4.webp`**:
     - 📞 **Gọi thoại:** Bấm vào tự động nạp số máy lẻ và thực hiện cuộc gọi sang `CallsView`.
     - 💬 **Nhắn tin:** Có huy hiệu số tin chưa đọc, bấm vào chuyển ngay sang phòng chat với người đó trong `MessagesView`.
     - 🎥 **Gọi Video:** Khởi chạy modal cuộc gọi video.
     - ❌ **Xóa liên hệ:** Hiện popup hỏi xác nhận *"Hỏi xóa không?"*.
  2. Kết nối chuyển đổi mượt mà giữa Danh bạ $\leftrightarrow$ Bàn phím gọi $\leftrightarrow$ Phòng chat.
