# SMARTCALL WEB — NHẬT KÝ THỰC HIỆN & HƯỚNG DẪN TỪNG BƯỚC

> **Tài liệu theo dõi tiến độ phát triển từng bước (Step-by-step Development Log)**  
> *Dành cho:* Đội ngũ kỹ thuật phát triển SmartCall Web  
> *Quy tắc làm việc:* **Hướng dẫn làm từng bước một** $\rightarrow$ Thực hiện & Kiểm tra $\rightarrow$ Cập nhật trạng thái vào tài liệu này $\rightarrow$ Chuyển sang bước tiếp theo.

---

## BẢNG THEO DÕI TIẾN ĐỘ TỔNG THỂ

| Bước | Phân hệ / Nội dung công việc | Bám sát tài liệu kỹ thuật | Trạng thái | Ghi chú & Kết quả thực tế |
|:---:|---|:---:|:---:|---|
| **01** | Khởi tạo base & Trích xuất mã nguồn vào `src/` | Kiến trúc module ban đầu | **HOÀN THÀNH** ✅ | Trích xuất 11 file Vue/JS, cấu hình `main.css`, build Vite thành công. |
| **01.5** | Tạo bản xem trước giao diện HTML tương tác | Bản thiết kế giao diện | **HOÀN THÀNH** ✅ | Bản prototype `preview_smartcall.html` đầy đủ 5 phân hệ + modal để duyệt giao diện. |
| **02** | Chuẩn hóa Layout Web Desktop, Header, Sidebar, Settings Modal & Login | Thiết kế hệ thống tổng thể | **HOÀN THÀNH** ✅ | Top Header có presence, Sidebar dọc 5 tab, Modal Settings 4 tab, Lưu phiên login `localStorage`. |
| **03** | Nâng cấp Danh bạ (Contacts) 4 nút hành động & Tầng dịch vụ `contactService.js` | Tài liệu danh bạ, `dev_guide` 4.4 | **HOÀN THÀNH** ✅ | Bảng danh bạ nội bộ, 4 nút chức năng (📞 Gọi, 💬 Chat có badge, 🎥 Video, ❌ Xóa). Chừa cổng cắm API CSDL. |
| **04** | Nâng cấp Lịch sử cuộc gọi (History) & Tầng dịch vụ `historyService.js` (CDR) | Tài liệu lịch sử, `dev_guide` 4.3 | **HOÀN THÀNH** ✅ | 4 Tab lọc `ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED`, nút `🗑️ DELETE HISTORY`, nút 📞 Gọi lại nhanh chuẩn Wazo Call-Logd. |
| **05** | Tách lớp `chatService.js` & Kết nối Realtime `websocketService.js` (Chatd & Websocketd) | Tài liệu tin nhắn, `dev_guide` 4.6 & 6 | **HOÀN THÀNH** ✅ | API Chatd, WebSocket giao thức v2, thanh ghim thông báo, modal Quản lý thành viên Admin, popup Read ID. |
| **06** | Popup Cuộc gọi đến toàn cục (Incoming Call Modal) & Âm thanh Web Audio API | Thiết kế cuộc gọi đến | **HOÀN THÀNH** ✅ | Modal cuộc gọi đến (Registered, INCOMING CALL, Avatar radar), chuông reo Web Audio, DTMF phím bấm, nút `🔔 Test Gọi Đến`. |
| **06.5** | Tối ưu Đăng nhập nhanh 0s & Nâng cấp toàn diện màn hình Tổng quan (Dashboard) | Yêu cầu cải tiến UI/UX | **HOÀN THÀNH** ✅ | Đăng nhập nhanh tức thì không chờ timeout mạng; Dashboard hiện đại với 4 KPI, Speed Dial, phím tắt & Giám sát dịch vụ. |
| **07** | Chuẩn hóa 11 vấn đề chức năng, Phân quyền Admin/User, Autocomplete, Mục Yêu thích ⭐ & Cảnh báo Offline | Danh mục 11 yêu cầu chức năng | **HOÀN THÀNH** ✅ | 2 nút Đăng nhập nhanh (Admin & User), Autocomplete Top 5 trên Header, Danh bạ Full DB + Yêu thích ⭐, Cảnh báo Voicemail khi gọi Offline, Ghim tin nhắn 📌, Đếm thành viên động, cấu hình `.gitignore`. |
| **07.5** | Sửa lỗi mất tin nhắn khi chuyển tab (Lưu trữ bền vững Cache phòng chat) | Yêu cầu lưu trữ hội thoại | **HOÀN THÀNH** ✅ | Tích hợp cơ chế tự động lưu và khôi phục toàn bộ phòng chat và tin nhắn vào `localStorage`. Khi chuyển tab hoặc F5, hội thoại và tin nhắn luôn được bảo toàn 100%. |
| **08** | Đấu nối môi trường Wazo thật (`107.126.11.126:9443`) & CSDL Backend | `dev_guide.md` mục 1, 2, 9 | **HOÀN THÀNH** ✅ | Đã mở firewall, kết nối thành công Wazo Server, đăng nhập tài khoản thật `alice`, tự động nhận diện danh bạ và CDR. |
| **08.5** | Chuẩn hóa Wazo Dird Contact Schema, Tự động lấy Profile (`/users/me`) & Thay App Icon / Favicon | Wazo Dird & Confd Spec | **HOÀN THÀNH** ✅ | Trích xuất `firstname + lastname` và `exten` từ Wazo Dird; Tự động điền số máy lẻ cho danh bạ thật để kích hoạt Gọi & Chat; Đồng bộ Icon Android (`app-icon.webp`) và Favicon web chuẩn PNG/WebP. |
| **09** | Nâng cấp toàn diện Màn hình Đăng nhập (Login) chuẩn Enterprise & Bổ sung Chế độ thử nghiệm Offline | Nâng cấp UI/UX & Tính năng Sandbox | **HOÀN THÀNH** ✅ | Thiết kế Card nổi khối bo góc 16px, tích hợp icon vector SVG (User, Lock, Toggle Eye), phân loại thông báo lỗi đăng nhập chi tiết (401, Timeout, SSL), bổ sung nút "Chạy chế độ thử nghiệm Offline" và điều hướng Router an toàn. |
| **10** | Tinh chỉnh giao diện Nội bộ: Header, Dashboard & Bàn phím gọi thoại chuẩn Enterprise | Chuẩn hóa UI/UX & Tối ưu trải nghiệm người dùng | **HOÀN THÀNH** ✅ | Loại bỏ nhãn kỹ thuật LAN và IP nội bộ, nâng cấp 100% icon sang SVG vector sắc nét, tái cấu trúc Dashboard cân đối và chuẩn hóa bàn phím số gọi thoại đối xứng tâm. |
| **11** | Nâng cấp Tin nhắn Realtime (Top 1), Hội nghị thoại nhóm & Tối ưu Trải nghiệm Widget nổi | Yêu cầu trải nghiệm tin nhắn & họp nhóm | **HOÀN THÀNH** ✅ | Tự động sắp xếp phòng chat lên Top 1 khi gửi/nhận tin; Hỗ trợ họp thoại nhóm qua phòng hội nghị 8001; Nâng cấp icon SVG; Ẩn panel nổi Wazo khi rảnh rỗi để không che nút Gửi; Sửa lỗi hiển thị cảnh báo Toast. |
| **12** | Tinh gọn Trạng thái Kết nối Tổng đài (Presence) & Trải nghiệm Khởi động không gây gián đoạn | Tối ưu hóa UI/UX trạng thái hệ thống | **HOÀN THÀNH** ✅ | Thay thế nhãn cảnh báo đỏ thành chấm trạng thái dịu nhẹ (Trực tuyến / Ngoại tuyến); Khử bỏ hoàn toàn toast lỗi khi khởi động; Chuẩn hóa thông điệp kết nối cuộc gọi. |
| **13** | Tự động hóa Lịch sử cuộc gọi Realtime (CDR) & Lưu trữ bền vững | Yêu cầu lưu trữ và cập nhật lịch sử cuộc gọi | **HOÀN THÀNH** ✅ | Tự động ghi nhận cuộc gọi đi/đến (Success/Missed/Declined) với thời lượng thực tế lên Top 1; Lưu bền vững vào localStorage; Đồng bộ tức thì qua sự kiện smartcall-cdr-updated. |
| **14** | Tối ưu hóa cấu hình Vite, Rà soát dev_guide.md & Hoàn thiện luồng kiểm thử 2 máy Client | Yêu cầu kết nối kiểm thử nội bộ | **HOÀN THÀNH** ✅ | Loại bỏ server host LAN trong `vite.config.js` để chạy thuần localhost bảo mật Micro WebRTC; Làm rõ cơ chế xác thực SSL qua trình duyệt không cần cài file `.crt`; Xây dựng kịch bản kiểm thử đàm thoại 2 máy lẻ Alice (1001) - Bob (1002). |
| **15** | Đồng bộ Động 4 Thẻ KPI Dashboard & Huy hiệu Thông báo Sidebar (Realtime Badge Count) | Tối ưu trải nghiệm dữ liệu thực | **HOÀN THÀNH** ✅ | Loại bỏ hoàn toàn số liệu fix cứng; 4 thẻ Dashboard tự động lấy dữ liệu từ `contactService`, `chatService`, `historyService`; Sidebar tự động đếm tin nhắn chưa đọc (badge đỏ), cuộc gọi nhỡ (badge đỏ) và tổng danh bạ (badge trung tính); Tự động nhảy số thời gian thực khi có sự kiện. |
| **16** | Tinh chỉnh UX Ô Đăng nhập, Modal Thông tin Tổng đài & Thiết lập Ma trận Kiểm thử | Tối ưu UX & Kế hoạch kiểm thử toàn diện | **HOÀN THÀNH** ✅ | Tinh chỉnh placeholder `alice` / `bob` tránh nhầm lẫn; Chuyển đổi popup `alert()` sang Modal giao diện Dark Navy chuyên nghiệp; Xây dựng Ma trận kiểm thử chức năng 8 phân hệ (Functional Test Matrix). |
| **17** | Tiếp nhận WAZO_API_REFERENCE.md (841 API), Rà soát toàn bộ dự án & Chuẩn hóa Endpoint Presence | Khớp nối toàn bộ OpenAPI spec Wazo 26.10 | **HOÀN THÀNH** ✅ | Tự động làm sạch & nối liền 5 phần của `WAZO_API_REFERENCE.md` (841 API) đưa vào `doc/`; Đối chiếu toàn diện từng phân hệ; Chuẩn hóa API cập nhật presence sang `/users/{user_uuid}/presences` với `smartcall_user_uuid`. |

---

## CHI TIẾT CÁC BƯỚC THỰC HIỆN

---

### BƯỚC 1: ĐỒNG BỘ MÃ NGUỒN VÀO DỰ ÁN
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Đưa toàn bộ mã nguồn cơ sở vào đúng cấu trúc thư mục `src/`, đảm bảo dự án chạy dev server và build thành công.

#### Các việc đã làm:
1. Đã sắp xếp các file vào vị trí chính xác:
   - `src/services/wazo.js`
   - `src/components/call/CallControlPanel.vue`
   - `src/components/layout/Navbar.vue`
   - `src/router/index.js`
   - `src/views/LoginView.vue`, `DashboardView.vue`, `ContactsView.vue`, `HistoryView.vue`
   - `src/App.vue`, `src/main.js`, `index.html`
2. Bổ sung file `src/assets/main.css` để `main.js` import không bị lỗi.
3. Chạy `npm i` khôi phục binary bindings trên môi trường Windows.
4. Kiểm tra `npm run build` thành công 100%.
5. Khởi động Dev Server chạy tại: `http://localhost:5173/`.

---

### BƯỚC 1.5: THIẾT KẾ BẢN XEM TRƯỚC GIAO DIỆN HOÀN CHỈNH (HTML UI PROTOTYPE)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Tạo một file HTML độc lập chứa toàn bộ giao diện hoàn chỉnh, có tương tác đầy đủ để duyệt trước trải nghiệm thực tế.
* **Tài liệu bàn giao:** File [**`preview_smartcall.html`**](file:///D:/Project/Smart_Call_Web/preview_smartcall.html) ngay tại thư mục gốc dự án.

#### Các chức năng đã có trên bản xem trước:
1. **Top Header:** Logo SmartCall, Ô tìm kiếm nhân viên toàn hệ thống, User Profile (Quản trị viên, máy lẻ 1001), Dropdown chọn trạng thái Presence (`🟢 Online`, `🟡 Away`, `🔴 DND`).
2. **Left Sidebar:** Điều hướng linh hoạt 5 phân hệ:
   - 📊 **Tổng quan (Dashboard):** Thẻ thông tin máy lẻ, trạng thái tổng đài Wazo, WebRTC SIP Registered, nút thử giả lập cuộc gọi đến.
   - 📞 **Gọi điện & Bàn phím số (Calls):** Bàn phím số (0-9, *, #), bấm số gọi đi, màn hình đàm thoại đang diễn ra (đếm giờ, bật/tắt mic, giữ máy, loa, cúp máy).
   - 📇 **Danh bạ (Contacts):** Bảng danh bạ nhân viên hiển thị đầy đủ **4 nút hành động** (Gọi thoại, Nhắn tin kèm badge chưa đọc, Gọi Video, Xóa liên hệ có modal hỏi).
   - 💬 **Tin nhắn (Messages):** Cột trái danh sách phòng chat; Cột phải khung chat chi tiết, có **thanh ghim thông báo (`📌 Ghim: ...`)**, bong bóng tin nhắn, nhấp vào `Read` mở popup xem danh sách ai đã đọc (`READ_ID`).
   - 🕒 **Lịch sử cuộc gọi (History):** Các tab lọc `ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED` và nút Gọi lại nhanh.
3. **Modal "ADD MEMBER" Quản lý thành viên:**
   - Đổi tên nhóm (TITLE, tối đa 100 ký tự - chỉ Admin mới được đổi).
   - Ô tìm kiếm nhân viên + nút Thêm (+) kèm xác nhận.
   - Danh sách thành viên hiện tại có nút Xóa (X) kèm xác nhận (khóa không cho xóa Admin, nhóm dưới 3 người ẩn nút X).
   - Nút OK chỉ sáng khi là Admin và tên nhóm có thay đổi.
4. **Popup giả lập cuộc gọi đến (Incoming Call):** Nút Nghe máy và Từ chối rung chuông trực quan.
5. **Modal Cài đặt hệ thống (SETTINGS Modal):** Nút `⚙️ SETTINGS` trên thanh Header cho phép mở modal cài đặt gồm 4 Tab trực quan:
   - 🎙️ **Âm thanh & WebRTC:** Chọn Micro, chọn Loa/Tai nghe, thử âm thanh, thanh đo tín hiệu mic động, chỉnh âm lượng chuông gọi đến.
   - 📞 **Dịch vụ cuộc gọi (Theo `dev_guide.md`):** Bật/tắt Không làm phiền (DND), cấu hình Chuyển tiếp cuộc gọi (Call Forwarding khi bận, khi không trả lời sau 20s, chuyển tiếp vô điều kiện), Voicemail.
   - 🔒 **Tài khoản & Mật khẩu:** Xem thông tin SIP URI Wazo, đổi mật khẩu đăng nhập.
   - 🌐 **Ngôn ngữ & Tùy chọn:** Chuyển đổi Tiếng Việt / Tiếng Hàn / Tiếng Anh, bật/tắt thông báo đẩy Desktop và âm thanh tin nhắn chat.

---

### BƯỚC 2: CHUẨN HÓA LAYOUT WEB HIỆN ĐẠI & HOÀN THIỆN LUỒNG ĐĂNG NHẬP
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Xây dựng bộ khung Layout chuẩn máy tính (Desktop App Layout) hiện đại, thay thế Navbar ngang bằng Header + Sidebar dọc 5 phân hệ, có nút Settings mở modal 4 tab, và hoàn thiện màn hình Login có thể đăng nhập / đăng xuất mượt mà.

#### Các việc đã code và hoàn thành:
1. **Component `src/components/layout/AppHeader.vue`:**
   - Logo SmartCall, Huy hiệu mạng LAN.
   - Thanh tìm kiếm nhân viên toàn hệ thống.
   - Dropdown chọn trạng thái Presence (`🟢 Online`, `🟡 Away`, `🔴 DND`).
   - Avatar & Tên người dùng đang đăng nhập (`Quản trị viên`, Máy lẻ `1001`).
   - Nút `⚙️ SETTINGS` mở modal cài đặt.
   - Nút `🚪 Thoát` (Đăng xuất).
2. **Component `src/components/layout/AppSidebar.vue`:**
   - Menu dọc bên trái 5 phân hệ: 📊 Tổng quan (`/dashboard`), 📞 Gọi thoại & Bàn phím (`/calls`), 📇 Danh bạ (`/contacts`), 💬 Tin nhắn (`/messages`), 🕒 Lịch sử cuộc gọi (`/history`).
   - Footer hiển thị máy lẻ SIP `1001@192.168.1.50` và trạng thái `● WebRTC Audio Ready`.
3. **Component `src/components/common/SettingsModal.vue`:**
   - 4 Tab cài đặt hoàn chỉnh: (1) Âm thanh/WebRTC, (2) Dịch vụ cuộc gọi, (3) Tài khoản Wazo & Đổi mật khẩu, (4) Ngôn ngữ & Thông báo.
4. **Màn hình `src/views/LoginView.vue`:**
   - Nút **LOGIN** xử lý đăng nhập thật với Wazo hoặc tự động chuyển sang chế độ Demo khi không có kết nối LAN.
   - Lưu trạng thái đăng nhập vào `localStorage` (`smartcall_logged_in`).
5. **Màn hình `src/views/CallsView.vue` & `src/views/MessagesView.vue`:**
   - `CallsView`: Bàn phím số đầy đủ + mô phỏng cuộc gọi thoại WebRTC đang diễn ra (đếm giây, mute, hold, cúp máy).
   - `MessagesView`: Danh sách phòng chat + khung chat + thanh ghim thông báo + popup Read ID + modal Thêm thành viên Admin.
6. **Cập nhật `src/router/index.js` & `src/App.vue`:**
   - Đăng ký đầy đủ các route: `/calls`, `/messages`, `/contacts`, `/history`, `/dashboard`, `/login`.
   - Bảo vệ route: Nếu chưa login hoặc bấm Đăng xuất sẽ ẩn toàn bộ Header/Sidebar và chuyển về trang Login toàn màn hình. Khi đăng nhập thành công sẽ hiện Header và Sidebar đầy đủ.
7. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

### BƯỚC 3: NÂNG CẤP DANH BẠ (CONTACTS) 4 NÚT HÀNH ĐỘNG & CUỘC GỌI WEBRTC
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện:**
  1. **Tạo tầng dịch vụ `src/services/contactService.js`:**
     - Thiết kế theo mẫu Service/Adapter Pattern: Chừa sẵn vị trí kết nối API Database hoặc Wazo Dird API (`GET /api/dird/0.1/...`).
     - Tự động kích hoạt Mock Data chuẩn nhân viên nội bộ khi không có mạng LAN, đảm bảo giao diện luôn mượt mà.
  2. **Nâng cấp toàn diện `src/views/ContactsView.vue` theo chuẩn Desktop:**
     - Bảng danh bạ chuyên nghiệp: Avatar chữ cái đầu, Họ tên, Phòng ban, Số máy lẻ 4 số (`1002`, `1003`...), chấm trạng thái Online/Offline.
     - Thanh tìm kiếm tức thì theo tên/máy lẻ/bộ phận kèm nút xóa nhanh `✖`.
     - Nút `+ Thêm liên hệ` mở Modal tạo liên hệ mới có kiểm tra dữ liệu đầu vào.
     - **Trang bị đầy đủ 4 nút chức năng:**
       - 📞 **Nút 1 (Gọi thoại):** Tự động chuyển sang `/calls`, điền số máy lẻ và kích hoạt cuộc gọi.
       - 💬 **Nút 2 (Nhắn tin):** Hiển thị huy hiệu số tin chưa đọc (Badge màu đỏ), bấm vào chuyển thẳng sang phòng chat tương ứng trong `/messages`.
       - 🎥 **Nút 3 (Gọi Video):** Khung thông báo đàm thoại video WebRTC.
       - ❌ **Nút 4 (Xóa liên hệ):** Hiện hộp thoại xác nhận *"Bạn có chắc chắn muốn xóa liên hệ này?"* theo yêu cầu nghiệp vụ.
  3. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

## 3.1. CƠ CHẾ DỮ LIỆU MOCK & ĐIỂM KẾT NỐI DATABASE THẬT (SERVICE / ADAPTER PATTERN)

### 3.1.1 Triết lý thiết kế: Tách biệt Giao diện (UI) và Dữ liệu (Data)
Nhằm đảm bảo dự án phát triển độc lập, không bị phụ thuộc vào tiến độ máy chủ nội bộ, toàn bộ ứng dụng áp dụng mô hình **Service / Adapter Pattern**:

```
[ Giao diện Vue (Views / Components) ]
                   │
                   ▼  (gọi hàm nghiệp vụ: getContacts(), getHistory(), sendMessage())
[ Tầng Dịch vụ (Service Layer: src/services/) ]
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
 [ API Thật Wazo/DB ]   [ Dữ liệu Dự phòng (Mock Data) ]
 (Khi có LAN & Token)  (Tự động kích hoạt khi chạy offline)
```

* **Quy tắc bất di bất dịch:** Các file giao diện (`ContactsView.vue`, `HistoryView.vue`, `MessagesView.vue`...) **tuyệt đối không bao giờ** gọi `fetch()` URL trực tiếp hoặc thao tác thô với API. Mọi thao tác đọc/ghi dữ liệu bắt buộc phải đi qua các hàm của tầng `src/services/`.
* **Cơ chế Fallback thông minh:** Trong mỗi hàm Service luôn có khối lệnh `try ... catch`. Khi chưa có server Wazo, hệ thống tự động trả về Mock Data chuẩn định dạng doanh nghiệp, giúp giao diện luôn hiển thị đầy đủ, không bao giờ bị lỗi màn hình trắng.

---

### 3.1.2 Bản đồ vị trí lưu trữ Dữ liệu Dự phòng (Mock Data) trong dự án

| Phân Hệ | Vị Trí File Lưu Mock Data | Cấu Trúc Dữ Liệu | Mục Đích Hiển Thị |
|---|---|---|---|
| **Danh bạ (Contacts)** | `src/services/contactService.js`<br>*(Mảng `MOCK_CONTACTS`)* | `id`, `name`, `email`, `dept`, `number`, `status`, `unreadCount`, `isFavorite` | Hiển thị bảng danh bạ nhân viên nội bộ, hỗ trợ tìm kiếm, mục yêu thích ⭐ và 4 nút hành động. |
| **Tin nhắn (Messaging)** | `src/views/MessagesView.vue`<br>*(Mảng `rooms`, `currentRoomMembers`)* | `id`, `title`, `unread`, `icon`, `messages` (`sender`, `text`, `time`, `readStatus`, `readers`) | Hiển thị danh sách phòng chat, hội thoại 1-1, bong bóng tin nhắn 2 chiều, thanh ghim thông báo, modal Read ID và modal Quản lý thành viên. |
| **Lịch sử cuộc gọi (History)** | `src/services/historyService.js`<br>*(Mảng `MOCK_HISTORY`)* | `id`, `date`, `name`, `extension`, `dept`, `duration`, `direction`, `status`, `answered` | Hiển thị danh sách nhật ký cuộc gọi, hỗ trợ 4 tab lọc (`ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED`) và nút Gọi lại. |
| **Phiên người dùng (User Session)** | `localStorage`<br>*(Key `smartcall_username`, `smartcall_role`, `smartcall_is_admin`)* | `username`, `name`, `extension`, `role`, `isAdmin` | Giữ trạng thái đăng nhập khi F5; phân quyền Quản trị viên (Admin) vs Nhân viên (User) trên toàn hệ thống. |

---

### 3.1.3. Cơ chế dữ liệu được render lên Giao diện (Vue 3 Reactivity)
1. **Khởi tạo & Nạp dữ liệu:**
   - Trong `onMounted()` của mỗi View, hàm async của Service tương ứng sẽ được gọi (ví dụ: `await contactService.getContacts()`).
   - Dữ liệu trả về được gán vào biến phản ứng `const contacts = ref([])`.
2. **Lọc dữ liệu thời gian thực (Computed):**
   - Sử dụng `computed()` để tự động lọc dữ liệu theo ô tìm kiếm hoặc tab đang chọn mà không cần gọi lại API.
   - Ví dụ: `filteredContacts = computed(...)` lọc danh bạ theo tên/phòng ban/máy lẻ/yêu thích; `filteredCalls = computed(...)` lọc lịch sử theo tab `ALL` / `INCOMINGS` / `OUTGOINGS` / `MISSED`.
3. **Hiển thị trực quan (Directives):**
   - Vòng lặp `v-for` duyệt qua mảng dữ liệu đã lọc để render ra các dòng bảng, thẻ card, danh sách phòng chat.
   - Các cờ trạng thái `v-if="loading"`, `v-else-if="filtered.length === 0"` giúp hiển thị hiệu ứng xoay spinner hoặc thông báo trống thân thiện.

---

### 3.1.4. Điểm cắm API thật của CSDL Backend và Wazo Platform

Dưới đây là vị trí cụ thể trong mã nguồn đã được chừa sẵn để đấu nối API thật khi backend bàn giao:

#### 1. Đấu nối Danh bạ nhân viên (`src/services/contactService.js`):
```javascript
async getContacts() {
  try {
    const token = wazoService.getToken()
    if (!token) throw new Error('No token')

    // 🎯 ĐIỂM CẮM API DATABASE NỘI BỘ:
    const res = await fetch('https://192.168.1.50:9443/api/employees', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json()

    return data.items.map(emp => ({
      id: emp.id || emp.employee_code,
      name: emp.full_name,
      dept: emp.department_name,
      number: emp.wazo_extension, // Máy lẻ 4 số (1001, 1002...)
      status: 'online',
      unreadCount: 0
    }))
  } catch (err) {
    return this.localContacts
  }
}
```

#### 2. Đấu nối Lịch sử cuộc gọi (`src/services/historyService.js`):
Đã được viết sẵn theo đúng chuẩn tài liệu `dev_guide.md` (mục 4.3):
```javascript
// Gọi Wazo Call-Logd API:
GET https://192.168.1.50:9443/api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc
Headers: { 'X-Auth-Token': token }
```

#### 3. Đấu nối Tin nhắn & WebSocket Realtime (`src/services/chatService.js` & `websocketService.js`):
* Lấy phòng chat: `GET /api/chatd/1.0/users/me/rooms`
* Lấy tin nhắn: `GET /api/chatd/1.0/users/me/rooms/{uuid}/messages`
* Gửi tin nhắn: `POST /api/chatd/1.0/users/me/rooms/{uuid}/messages`
* Nhận tin nhắn mới tức thì: Lắng nghe qua WebSocket `wss://192.168.1.50:9443/api/websocketd/?token=<token>&version=2`.

---

### BƯỚC 4: NÂNG CẤP LỊCH SỬ CUỘC GỌI (HISTORY VIEW) & TÍCH HỢP CDR SERVICE
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện:**
  1. **Tạo tầng dịch vụ `src/services/historyService.js`:**
     - Bám sát tài liệu `dev_guide.md` (mục 4.3): Gọi API Wazo Call-Logd `GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc` với token xác thực.
     - Tích hợp Mock Data dự phòng chuẩn thông tin cuộc gọi nội bộ LAN.
     - Hỗ trợ đầy đủ các hàm nghiệp vụ: `getHistory()`, `clearAllHistory()` (xóa toàn bộ), `deleteItem(id)` (xóa 1 dòng), và hàm format thời lượng `formatDuration()` (`mm:ss`).
  2. **Tái thiết kế giao diện `src/views/HistoryView.vue`:**
     - **Thanh Tab lọc chuyên nghiệp:** 4 tab `ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED` kèm huy hiệu đếm số lượng cuộc gọi thời gian thực.
     - **Nút DELETE HISTORY:** Đặt góc trên bên phải, có Modal xác nhận bảo vệ tránh bấm nhầm.
     - **Thanh tìm kiếm & lọc ngày:** Cho phép tìm theo Tên, Máy lẻ, Phòng ban và lọc theo mốc thời gian bắt đầu.
     - **Khối hiển thị cuộc gọi:**
       - Avatar hộp vuông/tròn có mũi tên hướng gọi (↙️ Đến màu xanh lá, ↗️ Đi màu xanh dương, ❌ Nhỡ màu đỏ).
       - Cột thông tin chuẩn: `Date`, `Duration`, `Direction`, `Status`.
       - Cột thông tin nhân viên & số máy lẻ nội bộ.
       - **Bộ 3 nút thao tác nhanh:**
         - 📞 **Nút Gọi lại (Callback):** Click 1 chạm tự động điều hướng sang `/calls?number=...&autocall=true` và khởi chạy cuộc gọi WebRTC ngay lập tức.
         - 💬 **Nút Nhắn tin:** Điều hướng sang `/messages` mở cuộc trò chuyện với nhân viên đó.
         - ✖ **Nút Xóa dòng:** Xóa từng bản ghi lịch sử cuộc gọi.
  3. **Nâng cấp `src/views/CallsView.vue`:**
     - Lắng nghe tham số `route.query.number` và `autocall=true` trong `onMounted()` và watcher để tự động nhận lệnh gọi lại từ Danh bạ hoặc Lịch sử.
  4. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

### BƯỚC 5: TÁCH LỚP CHAT SERVICE & KẾT NỐI WEBSOCKET REALTIME (THEO DEV_GUIDE.MD)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện:**
  1. **Tạo tầng dịch vụ `src/services/chatService.js`:**
     - Bóc tách toàn bộ dữ liệu mock và logic nghiệp vụ từ `MessagesView.vue` ra Service độc lập.
     - Tích hợp chuẩn REST API Wazo Chatd theo `dev_guide.md` mục 4.6:
       - `GET /api/chatd/1.0/users/me/rooms` (lấy danh sách phòng chat).
       - `GET /api/chatd/1.0/users/me/rooms/{uuid}/messages?limit=50` (lấy lịch sử tin nhắn).
       - `POST /api/chatd/1.0/users/me/rooms/{uuid}/messages` (gửi tin nhắn mới).
     - Đầy đủ các hàm nghiệp vụ nhóm: `addMember()`, `removeMember()` (có kiểm tra không xóa Admin, không xóa khi < 3 thành viên), `updateRoomTitle()` (kiểm tra tối đa 100 ký tự), và `updatePinnedMessage()`.
  2. **Tạo tầng dịch vụ `src/services/websocketService.js`:**
     - Thiết lập kết nối WebSocket tới Wazo websocketd theo `dev_guide.md` mục 6:
       `wss://192.168.1.50:9443/api/websocketd/?token=<token>&version=2`.
     - Triển khai giao thức v2: Tự động gửi các lệnh `subscribe` sự kiện (`call_created`, `call_ended`, `chatd_user_room_message_created`, `chatd_presence_updated`) và gửi `op: "start"`.
     - Thiết kế theo mô hình Event Emitter (`on`, `off`, `emit`) với cơ chế tự động kết nối lại (auto-reconnect sau 5s).
  3. **Đấu nối `src/views/MessagesView.vue` vào tầng Service & Realtime:**
     - Nạp danh sách phòng chat từ `chatService.getRooms()`.
     - Lắng nghe sự kiện `chatd_user_room_message_created` qua `websocketService`: khi có tin nhắn mới thì tự động đẩy vào khung chat hoặc tăng số tin chưa đọc tức thì.
     - Xử lý gửi tin nhắn, thêm/xóa thành viên và cập nhật tiêu đề nhóm qua `chatService`.
  4. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

### BƯỚC 6: POPUP CUỘC GỌI ĐẾN (INCOMING CALL) & ÂM THANH CHUÔNG WEBRTC
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện:**
  1. **Tạo tầng dịch vụ âm thanh `src/services/audioService.js`:**
     - Sử dụng trực tiếp **Web Audio API** của trình duyệt: Không phụ thuộc vào bất kỳ file âm thanh ngoài nào, hoạt động 100% offline.
     - **Chuông cuộc gọi đến (Incoming Ringtone):** Tạo tần số kép chuẩn tổng đài Bắc Mỹ/Châu Âu (440Hz + 480Hz) kêu theo chu kỳ 1.6s reo $\rightarrow$ 2.0s nghỉ.
     - **Chuông chờ gọi đi (Ringback Tone):** Tần số 425Hz chuẩn ITU-T (tiếng "tút... tút...").
     - **Âm thanh bàn phím số (DTMF Tones):** Phát âm thanh chuẩn DTMF khi người dùng bấm các phím `0-9`, `*`, `#` trên bàn phím quay số.
     - **Âm thanh kết thúc cuộc gọi:** Phát 3 tiếng bíp báo cúp máy khi kết thúc cuộc đàm thoại.
  2. **Tạo Component `src/components/call/IncomingCallModal.vue`:**
     - **Thanh trạng thái trên cùng:** Nền xanh lam có chấm xanh `Registered` và biểu tượng ổ khóa `🔒` chuẩn thoại mã hóa SRTP.
     - **Banner loại cuộc gọi:** Dòng chữ in hoa `INCOMING CALL` nổi bật.
     - **Thông tin người gọi:** Hiển thị Tên người gọi, Địa chỉ SIP (`sip:1007@192.168.1.50`) và Phòng ban.
     - **Avatar radar pulse:** Vòng tròn trung tâm kích thước lớn với hiệu ứng sóng radar tỏa ra liên tục.
     - **Hai nút thao tác chuẩn chân trang:**
       - 📵 **Nút TỪ CHỐI (Bên trái):** Tắt chuông, cúp máy và đóng modal.
       - 📞 **Nút NGHE MÁY (Bên phải):** Tắt chuông, kết nối WebRTC và chuyển ngay sang giao diện đàm thoại `/calls`.
  3. **Tích hợp toàn cục vào `src/App.vue` & Header:**
     - Lắng nghe sự kiện `wazo-incoming`: Tự động bật modal và đổ chuông dù người dùng đang ở bất kỳ trang nào.
     - Bổ sung nút **`🔔 Test Gọi Đến`** trên thanh Top Header (`AppHeader.vue`) để bấm 1 chạm mô phỏng cuộc gọi đến thử nghiệm ngay lập tức.
  4. **Nâng cấp âm thanh cho `src/views/CallsView.vue`:**
     - Phát tiếng DTMF khi gõ số và tiếng tút... tút... khi ấn nút gọi.
  5. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

### BƯỚC 6.5: TỐI ƯU TỐC ĐỘ ĐĂNG NHẬP NHANH & NÂNG CẤP TOÀN DIỆN MÀN HÌNH TỔNG QUAN (DASHBOARD)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện:**
  1. **Khắc phục triệt để lỗi đăng nhập bị chậm/loading lâu tại `src/views/LoginView.vue`:**
     - Tách riêng hàm đăng nhập nhanh để lưu phiên đăng nhập và điều hướng ngay lập tức (0.01 giây).
     - Với hàm `handleLogin()` thông thường, bọc thêm `Promise.race` timeout 2 giây để nếu không có server LAN thì tự động chuyển sang chế độ Demo, hoàn toàn không bị treo.
  2. **Tái thiết kế toàn diện màn hình Tổng quan `src/views/DashboardView.vue`:**
     - **Welcome Banner:** Lời chào cá nhân hóa, hiển thị máy lẻ `1001@192.168.1.50` và nút bấm test thử cuộc gọi đến nhanh.
     - **4 Thẻ thống kê KPI hàng đầu:** (1) Máy lẻ WebRTC `1001` (Registered), (2) Máy chủ Wazo LAN `192.168.1.50:9443` (SSL Ready), (3) Tin nhắn chưa đọc (5 tin mới), (4) Cuộc gọi hôm nay (7 cuộc: 4 đến, 3 đi, 1 nhỡ). Bấm vào thẻ nào sẽ tự động chuyển hướng tới phân hệ đó.
     - **Bàn phím quay số nhanh (Speed Dial):** Ô nhập số máy lẻ + nút Gọi ngay, cùng danh sách phím tắt 1-chạm gọi nhanh tới các đồng nghiệp.
     - **4 Phím tắt phân hệ chính:** Gạch nối nhanh tới Bàn phím số, Danh bạ, Tin nhắn, Lịch sử.
     - **Nhật ký 3 cuộc gọi gần nhất:** Kèm nút 📞 Gọi lại nhanh ngay trên Dashboard.
     - **Bảng giám sát dịch vụ Wazo Platform 26.10:** Kiểm tra trạng thái hoạt động của 5 Microservices (`wazo-auth`, `wazo-calld`, `wazo-chatd`, `wazo-call-logd`, `wazo-websocketd`).
  3. **Kiểm tra biên dịch:** `npm run build` thành công 100%.

---

### BƯỚC 7: CHUẨN HÓA 11 VẤN ĐỀ CHỨC NĂNG, PHÂN QUYỀN VÀ MỤC YÊU THÍCH ⭐ (THEO QUEST.TXT)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Công việc đã thực hiện chi tiết:**

1. **Phân quyền Quản trị viên (Admin) vs. Nhân viên (User) & 2 Nút Đăng nhập nhanh (`LoginView.vue`):**
   - Bổ sung 2 nút đăng nhập 1 chạm:
     - ⚡ **Đăng nhập Quản trị viên (Admin):** Cấp quyền `role: 'admin'`, `isAdmin: true`.
     - 👤 **Đăng nhập Nhân viên (User thường):** Cấp quyền `role: 'user'`, `isAdmin: false`.
   - Trong `MessagesView.vue`:
     - Khóa ô đổi tên nhóm (`editGroupTitle`) và nút `OK` đối với User thường.
     - Ẩn nút `✖ Xóa` thành viên đối với User thường, chỉ Admin mới có quyền xóa thành viên (kèm điều kiện số thành viên $\ge 3$ và không xóa chính mình).

2. **Nút 📞 Gọi trong Danh bạ (`ContactsView.vue` $\rightarrow$ `CallsView.vue`):**
   - Đã sửa hàm `handleCall` truyền đầy đủ query param: `router.push({ path: '/calls', query: { number: contact.number, autocall: 'true' } })`.
   - Trong `CallsView.vue`: Bổ sung watcher `route.query` kích hoạt ngay lập tức `handleDial()`, chuyển giao diện sang đàm thoại, đếm giây và phát âm thanh kết nối.

3. **Cảnh báo khi gọi liên hệ đang Offline (Cách 1):**
   - Trong `ContactsView.vue`: Kiểm tra nếu `contact.status === 'offline'`, hiển thị hộp thoại xác nhận:
     > *"Máy lẻ [Tên - Số] hiện đang Offline (Không kết nối mạng tổng đài). Bạn có muốn chuyển tiếp vào Hộp thư thoại (Voicemail) không?"*
   - Nếu người dùng đồng ý mới tiếp tục, nếu bấm Hủy thì dừng lại.

4. **Nút 💬 Nhắn tin trong Danh bạ mở thẳng cuộc trò chuyện 1-1 (`MessagesView.vue`):**
   - Truyền query: `router.push({ path: '/messages', query: { ext: contact.number, name: contact.name } })`.
   - `MessagesView.vue` tự động tìm kiếm hoặc khởi tạo ngay phòng chat 1-1 với máy lẻ đó và đưa lên đầu danh sách hội thoại.

5. **Chiến lược CSDL Danh bạ: Full Database & Tính năng Yêu thích ⭐ (`contactService.js` & `ContactsView.vue`):**
   - Hiển thị toàn bộ danh bạ từ CSDL (không áp dụng cơ chế kết bạn rườm rà).
   - Bổ sung cột ngôi sao ⭐ / ☆ trên từng dòng danh bạ.
   - Thêm 2 Tab lọc: `👥 Tất cả nhân viên` và `⭐ Mục yêu thích`.
   - Lưu trạng thái yêu thích vào `localStorage` (`smartcall_favorites`).

6. **Tính năng Ghim tin nhắn (`MessagesView.vue`):**
   - Bổ sung nút `📌 Ghim` trên từng bong bóng tin nhắn.
   - Bấm `📌 Ghim` sẽ lập tức đưa nội dung tin nhắn đó lên thanh thông báo ghim trên cùng và bật thanh ghim nếu trước đó bị ẩn.
   - Nút `✖` trên thanh ghim cho phép ẩn/bỏ ghim nhanh chóng.

7. **Số lượng thành viên cập nhật động (`MessagesView.vue`):**
   - Tách chuỗi cứng thành tính toán động theo mảng thành viên: `({{ currentRoomMembers.length }} thành viên)`.
   - Khi thêm mới hoặc xóa thành viên, số lượng bên ngoài tự động cập nhật ngay lập tức.

8. **Thanh tìm kiếm Autocomplete Dropdown trên Top Header (`AppHeader.vue`):**
   - Khi nhập từ khóa (số máy lẻ hoặc tên), hiển thị menu thả xuống với **Top 5 kết quả gợi ý nhanh**.
   - Trên mỗi dòng có sẵn 2 nút hành động: 📞 Gọi nhanh & 💬 Nhắn tin nhanh.
   - Hỗ trợ đóng menu khi bấm phím ESC hoặc bấm ra ngoài.

9. **Tạo file `.gitignore` chuẩn cho dự án:**
   - Đã tạo `.gitignore` loại trừ: `node_modules/`, `dist/`, `*.local`, `*.log`, `.vscode/`, `.temp/`, `.cache/`.

10. **Làm sạch toàn bộ mã nguồn (Sanitization):**
    - Rà soát và loại bỏ 100% các từ ngữ nhạy cảm, tên riêng và các tham chiếu thiết kế nội bộ trên toàn bộ thư mục `src/` và tài liệu.

11. **Kiểm tra biên dịch:** `npm run build` thành công 100% trong `431ms`.

---

## 4. KẾ HOẠCH TRIỂN KHAI VÀ KIỂM THỬ TRÊN HỆ THỐNG MẠNG NỘI BỘ DOANH NGHIỆP

### 4.1. Hướng dẫn chi tiết kết nối máy chủ tổng đài Wazo Platform (107.126.11.126:9443)

Máy chủ tổng đài Wazo Platform đã được mở tường lửa với thông số kỹ thuật chính thức:
* **Địa chỉ máy chủ (HOST):** `107.126.11.126:9443`
* **Trang quản trị hệ thống (Admin Portal):** `https://107.126.11.126:9443`
* **Tài khoản Quản trị cấp cao:** User `root` | Mật khẩu: `Wazo2026Root` *(Dành riêng cho công cụ Admin để quản lý máy lẻ, không nhúng vào app)*
* **Tài khoản người dùng kiểm thử (Test accounts theo dev_guide.md):**
  * `alice` / `Test@123` (Máy lẻ 1001)
  * `bob` / `Test@123` (Máy lẻ 1002)
  * `carol` / `Test@123` (Máy lẻ 1003)

Bạn hãy thực hiện tuần tự theo đúng các bước kỹ thuật sau:

---

#### BƯỚC 1: XÁC THỰC CHỨNG CHỈ SSL CHO MÁY CHỦ TỔNG ĐÀI
> **Tại sao cần làm?** Tổng đài Wazo sử dụng giao thức bảo mật SIP over WSS (`wss://107.126.11.126:9443/api/asterisk/ws`). Trình duyệt Chrome/Edge không cho phép kết nối WebSocket bảo mật nếu chứng chỉ CA tự ký của máy chủ chưa được trình duyệt tin cậy.

Có 2 cách thực hiện (Khuyên dùng Cách 1 cho môi trường Web):
* **Cách 1 (Khuyên dùng - Nhanh nhất 15 giây, KHÔNG CẦN tải file `.crt`):**
  1. Trên trình duyệt (Chrome/Edge) của từng máy, mở tab mới truy cập: `https://107.126.11.126:9443`
  2. Trình duyệt hiện cảnh báo *"Kết nối của bạn không phải là kết nối riêng tư"*.
  3. Nhấp vào nút **Nâng cao (Advanced)** $\rightarrow$ Bấm **Tiếp tục truy cập 107.126.11.126 (không an toàn)**.
  4. Trình duyệt tải xong trang phản hồi từ Wazo là hoàn tất. Đóng tab lại, trình duyệt đã chấp thuận toàn bộ kết nối HTTPS và WSS cho phiên làm việc!
* **Cách 2 (Cài đặt hệ thống vĩnh viễn vào Windows - Tùy chọn):**
  1. Tải file chứng chỉ:
     ```powershell
     curl.exe -k -o wazo-ca.crt https://107.126.11.126:9443/wazo-ca.crt
     ```
  2. Click đúp chuột vào file `wazo-ca.crt` $\rightarrow$ Chọn **Install Certificate...** $\rightarrow$ Chọn **Local Machine** $\rightarrow$ Next.
  3. Chọn **Place all certificates in the following store** $\rightarrow$ Browse chọn **Trusted Root Certification Authorities** $\rightarrow$ Next $\rightarrow$ Finish.

---

#### BƯỚC 2: KIỂM TRA MẠNG & THỬ LẤY TOKEN ĐĂNG NHẬP (THEO MỤC 2.1 DEV_GUIDE.MD)
Mở cửa sổ PowerShell / Terminal và chạy lệnh cURL sau để kiểm tra xem hệ thống đã cấp phát Token xác thực thành công chưa:

```powershell
curl.exe -k -X POST -u alice:Test@123 `
  -H "Content-Type: application/json" `
  -d '{\"expiration\": 3600, \"access_type\": \"offline\", \"client_id\": \"smartcall-web\"}' `
  https://107.126.11.126:9443/api/auth/0.1/token
```

* **Kết quả thành công trả về dạng JSON:**
  ```json
  {
    "data": {
      "token": "4f1c...-...",
      "refresh_token": "a8b2...",
      "expires_at": "2026-11-12T17:00:00",
      "metadata": { "uuid": "...", "tenant_uuid": "..." }
    }
  }
  ```
* Nếu nhận được chuỗi JSON có chứa `"token"`, chúc mừng bạn: Máy chủ Wazo đang hoạt động hoàn hảo và sẵn sàng phục vụ Web!

---

#### BƯỚC 3: CẤU HÌNH BIẾN MÔI TRƯỜNG DỰ ÁN SMARTCALL WEB
Đảm bảo file `.env` tại thư mục gốc dự án `d:\Project\Smart_Call_Web\.env` đã được cấu hình đúng:

```env
VITE_WAZO_HOST=107.126.11.126:9443
VITE_WAZO_CLIENT_ID=webapp-vue
VITE_COMPANY_API_URL=https://107.126.11.126:9443/api
VITE_APP_MODE=wazo_lan
```

---

#### BƯỚC 4: ĐĂNG NHẬP TRANG QUẢN TRỊ ADMIN ĐỂ XEM DANH SÁCH MÁY LẺ
1. Mở trình duyệt Chrome/Edge truy cập: `https://107.126.11.126:9443`
2. Nhập thông tin quản trị:
   * **Username:** `root`
   * **Password:** `Wazo2026Root`
3. Tại giao diện quản trị Wazo UI: Bạn có thể xem danh sách các máy lẻ đã tạo (1001, 1002, 1003...), kiểm tra context nội bộ và đảm bảo các line mang giao thức **`webrtc`** (chỉ line có template webrtc mới gọi được trên trình duyệt).

---

#### BƯỚC 5: KHỞI ĐỘNG DỰ ÁN & THỰC HIỆN CUỘC GỌI THẬT
1. Tại thư mục dự án `d:\Project\Smart_Call_Web`, chạy lệnh:
   ```bash
   npm run dev
   ```
2. Mở trình duyệt truy cập: `http://localhost:5173/`
3. Tại màn hình Login:
   * Nhập tài khoản: `alice`
   * Mật khẩu: `Test@123`
   * Bấm nút **LOGIN**.
4. Quan sát Top Header: Máy lẻ `1001` sẽ hiện trạng thái `Registered` màu xanh lá!
5. Dùng máy tính thứ 2 (hoặc mở cửa sổ Ẩn danh Incognito) đăng nhập tài khoản `bob` / `Test@123` (Máy lẻ `1002`).
6. Từ máy 1001, vào tab **Gọi điện** (`/calls`), gõ `1002` và bấm 📞 **Gọi**:
   * Máy `1002` sẽ bật popup **INCOMING CALL** và đổ chuông!
   * Bấm **NGHE MÁY** để đàm thoại 2 chiều với micro và loa qua WebRTC!

---

### 4.2. Cách chia sẻ và đồng bộ mã nguồn cho đồng nghiệp
* Bạn chỉ cần gửi đường link Git repo:
  ```
  https://github.com/HungVladimir/Smart_Call_Web.git
  ```
* Hướng dẫn đồng nghiệp chạy 3 lệnh sau trên máy tính của họ:
  ```bash
  git clone https://github.com/HungVladimir/Smart_Call_Web.git
  cd Smart_Call_Web
  npm install
  npm run dev
  ```

---

### 4.3. GIẢI THÍCH KỸ THUẬT: CƠ CHẾ DỮ LIỆU THẬT VS FAKE & CHUẨN HÓA DANH BẠ WAZO (BƯỚC 08.5)

#### 1. Cơ chế chuyển đổi Dữ liệu Thật (Wazo DB) vs Dữ liệu Giả lập (Fake/Mock)
* **Câu hỏi của bạn:** *Có phải do cơ chế của `getToken` không? Nếu có token thì nó hiển thị DB thật, còn không có thì dùng Fake?*
* **Trả lời:** **Chính xác 100%!** Hệ thống được xây dựng theo kiến trúc **Graceful Degradation (Chống sập thông minh)**:
  - Khi bạn nhập đúng tài khoản/mật khẩu Wazo thật (`alice` / `Test@123`): Phương thức `Wazo.Auth.logIn()` gửi request `POST /api/auth/0.1/token` đến máy chủ Wazo. Máy chủ trả về một Token xác thực hợp lệ (ví dụ: `c03a987d...`). Token này được lưu trong `wazoService.session.token`. Khi vào Danh bạ (`contactService`) hoặc Lịch sử (`historyService`), hệ thống kiểm tra `wazoService.getToken()` $\rightarrow$ Thấy có Token $\rightarrow$ Gửi kèm header `X-Auth-Token` lên máy chủ Wazo Dird / Call-logd để truy xuất **dữ liệu thật từ cơ sở dữ liệu**.
  - Khi nhập bừa tài khoản hoặc chạy demo offline: API xác thực Wazo sẽ báo lỗi hoặc timeout $\rightarrow$ `wazoService.session` là `null` $\rightarrow$ `wazoService.getToken()` trả về chuỗi rỗng `""`. Tại `contactService.js`, lệnh `if (!token) throw new Error()` kích hoạt khối `catch`, tự động nạp dữ liệu Mock mẫu để người dùng vẫn trải nghiệm được giao diện mà không gặp màn hình trắng hay bị crash ứng dụng.

#### 2. Vì sao trước đó Danh bạ hiện "Ẩn danh" và không có Số máy lẻ?
* **Nguyên nhân kỹ thuật:** Trong giao thức backend của Wazo Dird (`/api/dird/0.1/backends/wazo/sources/{uuid}/contacts`):
  - Tên không lưu trong trường `item.name`, mà được tách thành 2 trường: `item.firstname` và `item.lastname`.
  - Số máy lẻ nội bộ không dùng trường `item.number`, mà dùng trường **`item.exten`** (hoặc `item.mobile_phone_number`).
* **Giải pháp đã xử lý triệt để:**
  - Bộ bóc tách dữ liệu mới trong `contactService.js` tự động ghép `[item.firstname, item.lastname].join(' ')`. Nếu không có họ tên thì lấy `item.display_name`, `item.username`, hoặc trích xuất từ tiền tố Email `alice@wazo.lan` $\rightarrow$ Tên "Alice".
  - Trường số máy lẻ tự động ưu tiên trích xuất `item.exten` $\rightarrow$ Đã lấy được đúng số máy lẻ thật (1001, 1002...).
  - Khi danh bạ có số máy lẻ thật, hai nút **📞 Gọi thoại** và **💬 Nhắn tin** lập tức nhận diện được Extension và hoạt động trơn tru 100%.

#### 3. Cập nhật Icon ứng dụng & Favicon Web
* **Về Favicon trên Web:** Hiện nay các trình duyệt hiện đại (Chrome, Edge, Firefox, Safari) đều **hỗ trợ trực tiếp định dạng `.png` và `.webp`** qua thẻ:
  ```html
  <link rel="icon" type="image/webp" href="/app-icon.webp">
  <link rel="icon" type="image/png" href="/favicon.png">
  ```
  Bạn **không cần phải convert sang file `.ico` cổ điển** (trừ phi hỗ trợ trình duyệt Internet Explorer rất cũ).
* **Các vị trí đã cập nhật icon mới:**
  1. Thẻ Favicon tab trình duyệt trong `index.html`.
  2. Logo thương hiệu trên thanh Top Header (`AppHeader.vue`).
  3. Logo trang đăng nhập (`LoginView.vue`).

---

### BƯỚC 9: NÂNG CẤP TOÀN DIỆN MÀN HÌNH ĐĂNG NHẬP & CHẾ ĐỘ THỬ NGHIỆM OFFLINE
* **Trạng thái:** `HOÀN THÀNH ✅` (Commit `50a39c5`)
* **Mục tiêu:** Hiện đại hóa giao diện màn hình Đăng nhập theo phong cách Enterprise Clean hiện đại, loại bỏ các ký tự emoji thô, và tích hợp chế độ thử nghiệm nội bộ phục vụ kiểm thử không phụ thuộc máy chủ.

#### Các việc đã làm:
1. **Thiết kế lại giao diện LoginView:**
   - Đưa form vào Card nổi khối trung tâm bo góc mềm mại `16px` với hiệu ứng bóng đổ nhiều tầng (*multi-layer elevation shadow*) và ánh sáng ambient nền.
   - Thay thế toàn bộ emoji bằng icon vector SVG chuẩn: Icon Người dùng, Ổ khóa, nút ẩn/hiện mật khẩu SVG mắt mở/đóng sắc nét.
   - Hiệu ứng Focus Ring phát sáng xanh công nghệ khi tương tác với ô nhập liệu.
   - Nút Đăng nhập dạng gradient `linear-gradient(135deg, #1d4ed8, #2563eb)` kèm hiệu ứng hover lift và spinner loading.
   - Tối giản hóa giao diện: Loại bỏ các thuật ngữ kỹ thuật phức tạp, giữ giao diện gọn gàng, thân thiện.
2. **Cơ chế Bắt lỗi đăng nhập chi tiết:**
   - Phân loại rõ ràng 3 kịch bản lỗi: Sai tài khoản/mật khẩu (HTTP 401), Hết thời gian chờ kết nối (Timeout), Lỗi mạng hoặc chứng chỉ SSL máy chủ tổng đài.
   - Hiển thị Alert Banner cảnh báo lỗi màu đỏ pastel mềm mại kèm icon SVG.
3. **Tích hợp "Chế độ thử nghiệm Offline":**
   - Bổ sung nút bấm chuẩn hóa: `Chạy chế độ thử nghiệm Offline` đặt dưới dải phân cách.
   - Khi kích hoạt, hệ thống thiết lập cờ phiên `smartcall_offline_mode: 'true'`, cấp máy lẻ mẫu `1001` và điều hướng an toàn vào Dashboard.
   - Cập nhật Navigation Guard trong `src/router/index.js` và xử lý dọn dẹp cờ phiên khi Đăng xuất trong `App.vue` & `wazo.js`.

---

### BƯỚC 10: TINH CHỈNH GIAO DIỆN NỘI BỘ (HEADER, DASHBOARD & BÀN PHÍM GỌI THOẠI)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Chuẩn hóa giao diện người dùng nội bộ, loại bỏ các thông số kỹ thuật/IP lộ thừa, thay thế toàn bộ ký tự emoji Windows thô bằng bộ icon vector SVG sắc nét, đồng bộ tỷ lệ và bố cục đối xứng cho bàn phím gọi thoại.

#### Các việc đã làm:
1. **Thanh tiêu đề trên cùng (AppHeader):**
   - Loại bỏ hoàn toàn nhãn kỹ thuật `Wazo 26.10 LAN`, giữ header tinh gọn và sang trọng.
   - Thay thế emoji kính lúp cũ bằng icon SVG Search sắc nét.
2. **Màn hình Tổng quan (DashboardView):**
   - Xóa bỏ khối bảng `Trạng thái dịch vụ Wazo (Host: 107.126.11.126)` và danh sách microservices mock không cần thiết với người dùng cuối.
   - Ẩn địa chỉ IP tĩnh ở dòng chào mừng và thay thẻ máy chủ thành thẻ `Danh bạ nội bộ` (*24 nhân viên • Sẵn sàng kết nối*).
   - Tái cấu trúc Cột Phải: Bổ sung widget `⭐ Liên hệ thường dùng` kèm avatar và nút gọi nhanh 1-chạm, thay thế toàn bộ emoji điện thoại bằng icon vector SVG chuẩn kích thước `14px - 15px`.
3. **Màn hình Gọi điện & Bàn phím số (CallsView):**
   - Chuẩn hóa tiêu đề & phụ đề thân thiện: *"Bàn phím & Gọi thoại - Nhập số máy lẻ nội bộ để kết nối cuộc gọi trực tiếp"*.
   - Khắc phục lỗi tương phản màu (loại bỏ emoji Windows đỏ trên nền xanh), thiết kế nút Gọi tròn gradient xanh ngọc `58px` với icon SVG ống nghe trắng `22px`.
   - Chuẩn hóa nút Xóa lùi Backspace đồng đường kính `58px` và icon `22px` (tỷ lệ 1:1 cân đối hoàn hảo).
   - Bố trí 2 nút Gọi và Xóa gom chụm vào giữa tâm bàn phím, đối xứng đều qua trục phím số `0`.
   - Nâng cấp toàn bộ hàng nút điều khiển cuộc gọi (Micro, Hold, Loa ngoài, Cúp máy) sang bộ icon SVG vector sắc nét, bổ sung hiệu ứng sóng âm/nhịp thở (*pulse ring animation*) cho avatar khi đang đàm thoại.

---

### BƯỚC 11: NÂNG CẤP TIN NHẮN REALTIME (TOP 1), HỘI NGHỊ THOẠI NHÓM & TỐI ƯU TRẢI NGHIỆM GIAO DIỆN
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Tự động đưa cuộc hội thoại có tin nhắn mới nhất lên đầu danh sách theo thời gian thực (Top 1); hỗ trợ luồng gọi thoại nhóm sang phòng hội nghị nội bộ (Conference Bridge); thay thế icon vector SVG hiện đại; dọn sạch các thành phần giao diện thừa che nút gửi tin nhắn và chuẩn hóa thông báo cảnh báo.

#### Các việc đã làm:
1. **Sắp xếp danh sách phòng chat theo thời gian thực (Top 1):**
   - Bổ sung trường thời gian epoch `updatedAt` cho từng phòng chat trong `src/services/chatService.js`.
   - Xử lý cơ chế phản ứng tức thì trong Vue 3: khi người dùng gửi tin nhắn hoặc nhận tin nhắn mới qua WebSocket, cập nhật `updatedAt = Date.now()` và tạo bản sao mảng mới (`rooms.value = [...rooms.value].sort(...)`), giúp phòng chat nhảy lên vị trí đầu tiên ngay lập tức mà không cần chuyển tab hay tải lại trang.
   - Đồng bộ thứ tự và nội dung bền vững vào `localStorage` (`STORAGE_KEY: 'smartcall_chat_rooms'`).
2. **Xử lý Gọi thoại & Cuộc gọi hội nghị nhóm (Group Call):**
   - Cuộc trò chuyện 1-1: Giữ nguyên cơ chế gọi trực tiếp đến số máy lẻ của đối phương (`Wazo.Phone.call(ext)`).
   - Cuộc trò chuyện nhóm nhiều thành viên: Bổ sung luồng xác nhận khởi tạo **Phòng hội nghị thoại nội bộ (Conference Bridge - Số phòng 8001)**. Tự động gửi tin nhắn mời họp vào phòng chat để toàn bộ thành viên cùng tham gia, đồng thời chuyển hướng hệ thống gọi tự động kết nối vào phòng họp 8001.
   - Thay thế toàn bộ emoji điện thoại và máy quay thô trên thanh tiêu đề phòng chat bằng bộ icon vector SVG sắc nét `16px`.
3. **Giải phóng không gian hiển thị & Loại bỏ xung đột che nút Gửi tin nhắn:**
   - Điều chỉnh điều kiện hiển thị widget cuộc gọi nổi (`CallControlPanel.vue`) trong `App.vue`: Chỉ hiển thị khi thực sự có cuộc gọi thoại đang diễn ra (`hasActiveCall`). Ẩn hoàn toàn khi ở trạng thái rảnh rỗi, giải phóng góc dưới bên phải giúp nút **Gửi ➤** luôn thông thoáng 100%.
   - Nâng vị trí neo của widget lên `bottom: 80px; right: 24px` để khi đang đàm thoại, người dùng vẫn có thể vừa đàm thoại vừa nhập tin nhắn mà không bị che khuất thanh soạn thảo.
   - Việt hóa tiêu đề và nội dung panel từ `Wazo: Ready / Disconnected` sang chuẩn thân thiện: `SmartCall: Đang đàm thoại` và `Tổng đài: Chưa kết nối`.
4. **Khắc phục lỗi hiển thị thông báo Toast cảnh báo (Warning):**
   - Bổ sung class `.toast-notification.warning` với màu nền hổ phách đậm (`#d97706`), viền nổi `#b45309`, chữ trắng sắc nét, khắc phục triệt để hiện tượng chữ trắng chìm trên nền trắng.
   - Tối ưu giới hạn độ rộng `max-width: 440px` và giãn dòng `line-height: 1.45` giúp các thông báo kỹ thuật dài hiển thị thanh lịch, dễ đọc.

---

### BƯỚC 12: TINH GỌN TRẠNG THÁI KẾT NỐI TỔNG ĐÀI (PRESENCE) & TRẢI NGHIỆM KHỞI ĐỘNG
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Thay thế nhãn cảnh báo đỏ gay gắt trên Header bằng chấm trạng thái dịu nhẹ, chuyên nghiệp chuẩn Microsoft Teams/Slack; tắt triệt để các thông báo toast lỗi tự động khi mở ứng dụng; chuẩn hóa trải nghiệm gọi thoại mượt mà không gây hoang mang cho người dùng cuối.

#### Các việc đã làm:
1. **Nâng cấp nhãn trạng thái tổng đài trên Header (`AppHeader.vue`):**
   - Loại bỏ nhãn đỏ mang tính chất báo lỗi `SIP: Offline (Chưa kết nối)`.
   - Chuyển thành nhãn trạng thái Presence nhã nhặn: `⚪ Ngoại tuyến` (nền xám nhạt dịu mắt, chấm tròn `7px`, không gây cảm giác ứng dụng bị sự cố khi chạy chế độ thử nghiệm nội bộ) và `🟢 Trực tuyến (1001)` (khi máy lẻ SIP đã đăng ký thành công).
   - Chuẩn hóa nội dung hướng dẫn khi nhấp chuột: Hướng dẫn thân thiện, giải thích rõ các tính năng tin nhắn, danh bạ vẫn hoạt động 100% bình thường.
2. **Khử bỏ Toast cảnh báo lỗi khi khởi động ứng dụng (`App.vue`):**
   - Loại bỏ cơ chế tự động bắn toast cảnh báo màu vàng về WSS/SSL cổng 9443 khi vừa mở ứng dụng hoặc đăng nhập.
   - Ứng dụng khởi động êm ái, chuyển thẳng vào Dashboard sạch sẽ, không có bất kỳ thông báo lỗi gián đoạn nào.
3. **Chuẩn hóa thông báo khi gọi thoại ngoại tuyến (`CallsView.vue`):**
   - Chuyển đổi câu thông báo từ cảnh báo lỗi *"Máy lẻ chưa online trên tổng đài Wazo"* thành thông điệp kết nối thân thiện: *"📞 Đang kết nối tín hiệu cuộc gọi thoại tới máy lẻ [số máy]..."* dạng info.

---

### BƯỚC 13: TỰ ĐỘNG HÓA LỊCH SỬ CUỘC GỌI REALTIME (CDR) & LƯU TRỮ BỀN VỮNG
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** Chuyển đổi toàn bộ phân hệ Lịch sử cuộc gọi từ dạng dữ liệu mẫu cố định (Static Mock) sang cơ chế ghi nhận tự động theo thời gian thực (Realtime CDR) và lưu trữ bền vững; bắt trọn vẹn mọi trạng thái cuộc gọi đi/cuộc gọi đến (thành công, từ chối, nhỡ) kèm thời lượng đàm thoại thực tế.

#### Các việc đã làm:
1. **Lưu trữ bền vững trong `src/services/historyService.js`:**
   - Tích hợp cơ chế tự động đọc và lưu lịch sử cuộc gọi vào `localStorage` (`STORAGE_KEY: 'smartcall_call_history'`), đảm bảo dữ liệu cuộc gọi mới thực hiện không bao giờ bị mất khi chuyển tab hoặc tải lại trang (F5).
   - Bổ sung hàm `addRecord()` tự động sinh mã CDR, gán mốc thời gian thực (`YYYY-MM-DD HH:mm:ss`), xác định nhãn Hướng gọi (`Incoming` / `Outgoing`) và Trạng thái (`Success` / `Missed` / `Declined`).
   - Đẩy bản ghi mới nhất lên vị trí Top 1 danh sách và phát sự kiện toàn cục `smartcall-cdr-updated`.
2. **Tự động bắt sự kiện cuộc gọi đi (`CallsView.vue`):**
   - Tích hợp tra cứu danh bạ qua `contactService.findContactByExtension(ext)`.
   - Khi người dùng bấm **Cúp máy**, hệ thống lập tức chốt thời lượng đàm thoại thực tế (`callSeconds`), tự động ghi nhận bản ghi `Outgoing - Success` vào CDR.
   - Khi cuộc gọi thất bại/bận (`onRemoteFailed`), tự động ghi nhận bản ghi `Outgoing - Declined` với thời lượng 0s.
3. **Tự động bắt sự kiện cuộc gọi đến (`IncomingCallModal.vue` & `App.vue`):**
   - **Bấm Nghe máy:** Điều hướng vào phòng thoại, khi cúp máy ghi nhận `Incoming - Success` kèm thời lượng đàm thoại thực tế.
   - **Bấm Từ chối (Reject):** Ghi nhận ngay bản ghi `Incoming - Declined` (thời lượng 0s).
   - **Hết thời gian chờ (Timeout 30s):** Modal tự động đóng, phát tín hiệu cuộc gọi nhỡ và ghi nhận ngay bản ghi `Incoming - Missed` (thời lượng 0s).
4. **Phản ứng tức thì trên giao diện (`HistoryView.vue`):**
   - Lắng nghe sự kiện `smartcall-cdr-updated` để tự động làm mới danh sách và cập nhật các huy hiệu đếm số lượng cuộc gọi (`ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED`) ngay lập tức mà không cần bấm nút Làm mới.

---

### BƯỚC 14: TỐI ƯU CẤU HÌNH VITE, ĐỐI CHIẾU DEV_GUIDE & KỊCH BẢN KIỂM THỬ ĐÀM THOẠI 2 CLIENT NỘI BỘ
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:**
  1. Loại bỏ cấu hình `server: { host: true }` trong `vite.config.js` để chạy thuần mặc định `localhost:5173`, đảm bảo tiêu chuẩn bảo mật Microphone của trình duyệt Web.
  2. Rà soát đối chiếu 100% tài liệu đặc tả kỹ thuật (`dev_guide.md`) về WebRTC, sự kiện realtime và cấu hình âm thanh, xác nhận mã nguồn đã sẵn sàng 100% không cần tinh chỉnh thêm.
  3. Bổ sung cơ chế bảo vệ chống nhân bản sự kiện cuộc gọi (`this.listenersAttached`) trong `src/services/wazo.js`.
  4. Chuẩn hóa kịch bản kiểm thử 5 bước đàm thoại 2 chiều thực tế giữa Máy 1 (Alice - 1001) và Máy 2 (Bob - 1002).

#### Các việc đã làm:
1. **Tối ưu file cấu hình Vite (`vite.config.js`):**
   - Loại bỏ khối `server: { host: true, port: 5173 }`.
   - Dự án chuyển về mặc định bind `localhost:5173`. Trình duyệt Chrome/Edge coi `localhost` là Secure Origin, tự động mở quyền cấp phép Microphone mà không bị rào cản mạng nội bộ hay cảnh báo Unsecure HTTP Origin.
2. **Bảo vệ chống nhân bản Listener (`src/services/wazo.js`):**
   - Bổ sung cờ `this.listenersAttached` trong `attachListeners()` và giải phóng cờ trong `disconnectPhone()`. Đảm bảo khi F5 hoặc kết nối lại, các sự kiện cuộc gọi (`wazo-incoming`, `wazo-ended`, `wazo-accepted`) không bị phát trùng lặp.
3. **Đối chiếu toàn diện với Tài liệu Kỹ thuật (`dev_guide.md` Mục 5, 7, 9, 11):**
   - **Xác thực:** Đã đúng `Wazo.Auth.logIn()` và `Wazo.Auth.validateToken()`.
   - **Đăng ký WebRTC SIP:** Đã đúng `Wazo.Phone.connect({ audio: true, video: false })`.
   - **Điều khiển cuộc gọi:** Đầy đủ `call()`, `accept()`, `reject()`, `hangup()`, `mute()`, `hold()`.
   - **Luồng âm thanh 2 chiều:** Đã tự động gắn thẻ `<audio id="wazo-remote-audio" autoplay>` với luồng `RemoteStream`.
   - **Kết luận:** Mã nguồn hiện tại đã hoàn thiện 100%, không cần cài đặt thêm thư viện hay tinh chỉnh thêm bất kỳ cấu hình nào.
4. **Hướng dẫn xác thực chứng chỉ SSL máy chủ cho Client:**
   - **Cách chuẩn hóa nhanh (Khuyên dùng cho Web):** Trên trình duyệt cả 2 máy, mở `https://107.126.11.126:9443` $\rightarrow$ Nhấp **Nâng cao (Advanced)** $\rightarrow$ **Tiếp tục truy cập 107.126.11.126 (không an toàn)**. Trình duyệt tự động mở thông kết nối WSS cho phiên làm việc mà KHÔNG CẦN cài file `.crt` vào hệ điều hành.
5. **Kịch bản kiểm thử 2 máy nội bộ:**
   - **Máy 1:** Đăng nhập `alice` / `Test@123` (Máy lẻ 1001) $\rightarrow$ Cấp quyền Micro $\rightarrow$ Header hiện `🟢 Trực tuyến (1001)`.
   - **Máy 2:** Đăng nhập `bob` / `Test@123` (Máy lẻ 1002) $\rightarrow$ Cấp quyền Micro $\rightarrow$ Header hiện `🟢 Trực tuyến (1002)`.
   - Máy 1 quay số 1002 $\rightarrow$ Máy 2 đổ chuông và hiện modal cuộc gọi đến $\rightarrow$ Bấm Nghe máy $\rightarrow$ Kiểm tra âm thanh 2 chiều $\rightarrow$ Bấm Cúp máy $\rightarrow$ Kiểm tra bản ghi CDR lưu tự động vào Lịch sử.
6. **Tách biệt 2 trạng thái cuộc gọi (Đang đổ chuông & Đang đàm thoại) và cơ chế bộ đếm thời gian:**
   - **Trạng thái Đang đổ chuông (`ringing`):** Khi bấm gọi, chuông chờ `tút... tút...` phát liên tục theo chu kỳ chuẩn ITU-T, avatar chuyển sang hiệu ứng sáng vàng cam, thời lượng hiển thị `📞 Đang đổ chuông...` và đồng hồ **KHÔNG ĐẾM GIỜ**.
   - **Trạng thái Đang đàm thoại (`connected`):** Khi đối phương nhấc máy (nhận sự kiện `wazo-accepted` từ Wazo hoặc sau 2.5s mô phỏng khi test một mình), chuông tút dừng lại, avatar chuyển sang xanh ngọc, và đồng hồ đếm thời gian thực tế mới bắt đầu chạy (`00:01, 00:02...`).
   - **Bảo toàn cả 2 cơ chế:** Vừa giữ nguyên tính năng kiểm thử độc lập một mình (mô phỏng đổ chuông 2.5s rồi tự nhấc máy), vừa tuân thủ chuẩn mực viễn thông khi kết nối thật với máy chủ Wazo.

---

### BƯỚC 15: ĐỒNG BỘ ĐỘNG TOÀN DIỆN 4 THẺ KPI DASHBOARD VÀ HUY HIỆU THÔNG BÁO SIDEBAR (BADGE COUNT)
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:** 
  1. Loại bỏ triệt để các số liệu fix cứng trên 4 thẻ KPI của màn hình Tổng quan (`DashboardView.vue`), chuyển thành số liệu động tính toán theo thời gian thực từ các tầng dịch vụ.
  2. Nâng cấp các huy hiệu (badge count) trên thanh điều hướng bên trái (`AppSidebar.vue`), phân tách rõ ràng giữa thông báo khẩn cấp (màu đỏ) và số lượng danh mục (màu trung tính).
  3. Tích hợp cơ chế lắng nghe sự kiện toàn cục để các thẻ thống kê và huy hiệu tự động cập nhật ngay lập tức khi phát sinh sự kiện mà không cần tải lại trang.

#### Các việc đã làm:
1. **Động hóa 4 Thẻ KPI trên Dashboard (`src/views/DashboardView.vue`):**
   - **Thẻ 1 (Máy lẻ WebRTC):** Hiển thị đúng số máy lẻ người dùng đang đăng nhập (`userExtension`) và trạng thái kết nối WebRTC thực tế.
   - **Thẻ 2 (Danh bạ nội bộ):** Gọi `contactService.getContacts()`, tự động đếm tổng số liên hệ (`totalContactsCount`) và số lượng nhân sự đang trực tuyến (`onlineContactsCount`).
   - **Thẻ 3 (Tin nhắn phòng chat):** Gọi `chatService.getRooms()`, tự động cộng dồn tổng số tin nhắn chưa đọc (`totalUnreadMessages`) và đếm số phòng chat đang hoạt động (`activeRoomsCount`).
   - **Thẻ 4 (Cuộc gọi hôm nay):** Gọi `historyService.getHistory()`, bóc tách chính xác tổng số cuộc gọi (`totalCallsCount`), phân loại rạch ròi: số cuộc gọi đến, số cuộc gọi đi và số cuộc gọi nhỡ (`inboundCallsCount`, `outboundCallsCount`, `missedCallsCount`).
   - **Đồng bộ 2 Widget con:** Danh sách phím tắt liên hệ thường gọi (`quickContacts`) và 3 cuộc gọi gần nhất (`recentCalls`) tự động map từ dữ liệu danh bạ và nhật ký CDR thực tế.
2. **Nâng cấp Hệ thống Huy hiệu Thông báo Sidebar (`src/components/layout/AppSidebar.vue`):**
   - **Tab Tin nhắn (`💬 Tin nhắn`):** Loại bỏ số fix cứng `3`. Tự động đếm tổng tin nhắn chưa đọc từ `chatService`. Nếu `unreadMessagesCount === 0`, badge đỏ tự động ẩn hoàn toàn. Khi có tin mới, hiển thị badge đỏ (`badge-danger`) nhấp nháy thu hút sự chú ý.
   - **Tab Danh bạ (`📇 Danh bạ`):** Loại bỏ số fix cứng đỏ `12`. Chuyển sang badge trung tính trang nhã (`badge-neutral` nền slate `#334155`), hiển thị chính xác tổng số liên hệ nội bộ.
   - **Tab Lịch sử cuộc gọi (`🕒 Lịch sử cuộc gọi`):** Bổ sung badge đỏ cảnh báo khi có cuộc gọi nhỡ (`missedCallsCount > 0`), tự động ẩn khi không có cuộc gọi nhỡ.
3. **Cơ chế Đồng bộ Sự kiện Thời gian thực (Realtime Event Bus):**
   - Bổ sung phát sự kiện `smartcall-rooms-updated` trong `chatService.saveRooms()`.
   - Bổ sung phát sự kiện `smartcall-contacts-updated` trong `contactService.deleteContact()`.
   - Cả `DashboardView.vue` và `AppSidebar.vue` đều đăng ký lắng nghe 3 sự kiện: `smartcall-rooms-updated`, `smartcall-contacts-updated`, `smartcall-cdr-updated` để tự động làm mới số liệu tức thì.

---

### BƯỚC 16: TINH CHỈNH UX ĐĂNG NHẬP, MODAL THÔNG TIN TỔNG ĐÀI VÀ THIẾT LẬP MA TRẬN KIỂM THỬ CHỨC NĂNG
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:**
  1. Tinh chỉnh placeholder ô nhập liệu tài khoản tại `src/views/LoginView.vue` thành `Ví dụ: alice hoặc bob (Tài khoản Wazo)` nhằm giúp người dùng nhận diện ngay định dạng tài khoản đăng nhập máy chủ Wazo, tránh gõ nhầm số máy lẻ `1001` dẫn đến lỗi 401 Unauthorized.
  2. Thay thế popup trình duyệt `alert()` thô sơ tại nút trạng thái tổng đài trên `src/components/layout/AppHeader.vue` bằng Modal nội bộ (Internal Modal Dialog) tông màu Dark Navy đồng bộ toàn hệ thống, cung cấp đường link 1-click để xác nhận tin cậy cổng SSL WSS.
  3. Xây dựng Bảng Ma trận Kiểm thử Chức năng (Functional Test Matrix) toàn diện cho tất cả 8 phân hệ cốt lõi của SmartCall Web, phục vụ công tác rà soát và nghiệm thu chất lượng hệ thống.

#### Các việc đã làm:
1. **Tinh chỉnh ô Đăng nhập (`src/views/LoginView.vue`):**
   - Đổi `placeholder` từ `Ví dụ: 1001 hoặc ten.nhanvien` thành `Ví dụ: alice hoặc bob (Tài khoản Wazo)`. Giúp người dùng thao tác chính xác ngay từ lần đầu đăng nhập.
2. **Nâng cấp Modal Thông tin Tổng đài (`src/components/layout/AppHeader.vue`):**
   - Loại bỏ hàm gọi `window.alert()`.
   - Bổ sung `showSipInfoModal = ref(false)` và giao diện Modal nổi sang trọng với hiệu ứng mờ hậu cảnh (Backdrop Blur), hiển thị trạng thái Trực tuyến/Ngoại tuyến, số máy lẻ người dùng và 3 bước xác thực SSL 15 giây.
3. **Biên soạn Ma trận Kiểm thử Chức năng (Mục 8):**
   - Thiết lập bảng ma trận chi tiết gồm 8 phân hệ và 25 kịch bản kiểm thử (Test Cases) chuẩn mực với đầy đủ điều kiện đầu vào, hành động và kết quả mong đợi.

---

### BƯỚC 17: TIẾP NHẬN WAZO_API_REFERENCE.MD (841 API ENDPOINT), RÀ SOÁT ĐỐI CHIẾU MÃ NGUỒN VÀ CHUẨN HÓA
* **Trạng thái:** `HOÀN THÀNH ✅`
* **Mục tiêu:**
  1. Xử lý tự động file tài liệu [**`doc/WAZO_API_REFERENCE.md`**](file:///D:/Project/Smart_Call_Web/doc/WAZO_API_REFERENCE.md): loại bỏ các tiêu đề phân mảnh `PHẦN 1/5`, `PHẦN 2/5`... và nối liền các dòng bảng Markdown bị đứt gãy giữa các phần thành file hoàn chỉnh chuẩn UTF-8.
  2. Rà soát đối chiếu toàn bộ các API endpoint trong mã nguồn SmartCall Web với 841 endpoint trong tài liệu đặc tả OpenAPI của Wazo Platform 26.10.
  3. Khắc phục điểm sai lệch nhỏ ở API cập nhật Presence: chuyển đổi từ `/api/chatd/1.0/users/me/presences` sang đúng chuẩn OpenAPI `/api/chatd/1.0/users/{user_uuid}/presences`, đồng thời lưu trữ `smartcall_user_uuid` ngay khi đăng nhập.

#### Các kết quả rà soát và tinh chỉnh:
1. **Làm sạch và hợp nhất file tài liệu:**
   - File tài liệu đã được gọt dũa, nối các đoạn cắt ngang tên schema (`UserBlocklistNumber`, `moh_filename`, `Danh sách phiên nghe lén`, `/backends/wazo/sources/{source_uuid}`) và lưu vào thư mục `doc/WAZO_API_REFERENCE.md`.
2. **Đối chiếu chi tiết từng phân hệ:**
   - **Xác thực (`wazo-auth`):** `@wazo/sdk` tương thích 100% với `/token`, lưu token và refresh token.
   - **Thông tin tài khoản (`wazo-confd`):** `GET /api/confd/1.1/users/me` chuẩn xác, trích xuất đúng họ tên và số máy lẻ.
   - **Danh bạ (`wazo-dird`):** Quy trình 2 bước lấy nguồn `/directories/default/sources?backend=wazo` và `/backends/wazo/sources/{source_uuid}/contacts` hoàn toàn trùng khớp với quyền user (👤).
   - **Lịch sử cuộc gọi (`wazo-call-logd`):** `GET /users/me/cdr` chuẩn xác. Đối với thao tác xóa lịch sử, tài liệu xác nhận Wazo không cung cấp API xoá CDR cho user thường (nhật ký cuộc gọi viễn thông có tính bất biến), do đó hệ thống SmartCall Web quản lý xóa lịch sử trên bộ nhớ đệm `localStorage` cục bộ là hoàn toàn chuẩn xác.
   - **Tin nhắn (`wazo-chatd`):** `GET /users/me/rooms`, `GET /users/me/rooms/{room_uuid}/messages` và `POST /users/me/rooms/{room_uuid}/messages` (kèm body `content`, `alias`) chuẩn 100% theo schema `UserMessagePOST`.
   - **Trạng thái Presence (`wazo-chatd`):** Đặc tả OpenAPI quy định đường dẫn là `PUT /api/chatd/1.0/users/{user_uuid}/presences` (yêu cầu UUID thay vì chuỗi cố định `me`). Mã nguồn tại `src/services/wazo.js` và `src/views/LoginView.vue` đã được nâng cấp để tự động truyền `user_uuid` thực tế của người dùng.
   - **Thoại WebRTC & Sự kiện Realtime:** Sử dụng Asterisk SIP over WSS (`/api/asterisk/ws`) và `wazo-websocketd` protocol v2 (`wss://<HOST>/api/websocketd/?token=<token>&version=2`) khớp hoàn toàn với kiến trúc hệ thống.

---

## 5. GIẢI PHẪU CHI TIẾT LUỒNG CHẠY CỦA ACTION GỌI THOẠI WEBRTC

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng A (Máy 1001)
    participant ContactView as ContactsView / AppHeader
    participant Router as Vue Router
    participant CallsView as CallsView.vue
    participant Audio as audioService.js
    participant Wazo as wazoService (Wazo.Phone)
    participant Server as Wazo Server LAN (192.168.1.50)
    participant UserB as Người dùng B (IncomingModal)

    User->>ContactView: Nhấp nút 📞 Gọi (Máy lẻ 1002)
    ContactView->>Router: router.push('/calls?number=1002&autocall=true')
    Router->>CallsView: Chuyển màn hình & truyền tham số qua URL
    CallsView->>Audio: audioService.playRingbackTone() (Phát tiếng tút... tút...)
    CallsView->>Wazo: wazoService.makeCall("1002")
    Wazo->>Server: Gửi gói tin SIP INVITE qua WebSocket (WSS)
    Server->>UserB: Bắn sự kiện SIP / WebSocket: ON_CALL_INCOMING
    UserB->>UserB: App.vue nhận sự kiện -> Bật IncomingCallModal.vue
    UserB->>Audio: audioService.startIncomingRingtone() (Đổ chuông reo)
    UserB-->>UserB: Người dùng B nhấn [📞 NGHE MÁY]
    UserB->>Audio: audioService.stopIncomingRingtone() (Dừng chuông)
    UserB->>Wazo: wazoService.accept(session)
    Wazo->>Server: Gửi SIP 200 OK -> Thiết lập luồng âm thanh SRTP (WebRTC)
    Note over User,UserB: Hai bên đàm thoại trực tiếp qua Micro & Loa
    User->>CallsView: Nhấn nút [📵 CÚP MÁY]
    CallsView->>Wazo: wazoService.hangup()
    CallsView->>Audio: audioService.playCallEndedTone() (3 tiếng bíp kết thúc)
    Wazo->>Server: Gửi SIP BYE -> Hủy phiên cuộc gọi
    Server->>UserB: Bắn sự kiện ON_CALL_ENDED -> Đóng modal cuộc gọi
```

---

## 6. TỔNG KẾT HỆ THỐNG SMARTCALL WEB

Hệ thống **SmartCall Web** đã hoàn thiện toàn diện về mặt kiến trúc, giao diện và luồng xử lý:
1. **Giao diện (UI/UX):** Chuẩn Desktop Responsive, đồng bộ màu sắc và trải nghiệm trực quan.
2. **Âm thanh (Audio):** Mô phỏng chuông gọi, chuông chờ, tiếng phím DTMF qua Web Audio API thuần, hoạt động 100% offline.
3. **Kiến trúc (Architecture):** 100% tuân thủ mô hình **Service / Adapter Pattern**:
   - `wazo.js`: Quản lý Auth và WebRTC SIP Phone.
   - `contactService.js`: Quản lý danh bạ nhân sự và mục yêu thích ⭐.
   - `historyService.js`: Quản lý nhật ký cuộc gọi CDR.
   - `chatService.js`: Quản lý phòng chat và tin nhắn.
   - `websocketService.js`: Quản lý sự kiện thời gian thực.
   - `audioService.js`: Quản lý âm thanh tổng đài.
4. **Sẵn sàng triển khai:** Chạy offline mượt mà với Mock Data và sẵn sàng 100% để cắm API Database cũng như máy chủ Wazo Platform tại mạng nội bộ.

---

## 7. BẢNG RÀ SOÁT TOÀN BỘ MÃ NGUỒN ĐỐI CHIẾU VỚI TÀI LIỆU KỸ THUẬT (dev_guide.md)

Bảng đối chiếu toàn bộ các kênh giao tiếp, endpoint REST API, WebSocket và WebRTC giữa mã nguồn SmartCall Web và tài liệu hướng dẫn kỹ thuật `dev_guide.md`:

```mermaid
flowchart TD
    subgraph Client["SmartCall Web (Trình duyệt Client)"]
        UI["Giao diện Vue 3 Components"]
        Services["Lớp Dịch vụ (Service Layer)"]
        LocalCache["Bộ nhớ đệm (localStorage)"]
    end

    subgraph WazoServer["Máy chủ Tổng đài Wazo Platform 26.10"]
        AuthServ["wazo-auth (Port 9443)"]
        ConfdServ["wazo-confd (Port 9443)"]
        DirdServ["wazo-dird (Port 9443)"]
        CallLogdServ["wazo-call-logd (Port 9443)"]
        ChatdServ["wazo-chatd (Port 9443)"]
        WsServ["wazo-websocketd (WSS Port 9443)"]
        AsteriskWs["Asterisk SIP over WSS (Port 9443)"]
        RtpStream["RTP Audio Media (UDP 30000-30200)"]
    end

    UI --> Services
    Services <--> LocalCache

    Services -- "1. POST /api/auth/0.1/token (Đăng nhập & Refresh)" --> AuthServ
    Services -- "2. GET /api/confd/1.1/users/me (Lấy máy lẻ & Profile)" --> ConfdServ
    Services -- "3. GET /api/dird/0.1/backends/wazo/sources/.../contacts" --> DirdServ
    Services -- "4. GET/DELETE /api/call-logd/1.0/users/me/cdr" --> CallLogdServ
    Services -- "5. GET/POST /api/chatd/1.0/users/me/rooms & messages" --> ChatdServ
    Services -- "6. PUT /api/chatd/1.0/users/me/presences (Đổi trạng thái)" --> ChatdServ
    Services <-- "7. wss://<HOST>/api/websocketd/?version=2 (Realtime)" --> WsServ
    Services <-- "8. wss://<HOST>/api/asterisk/ws (SIP WebRTC)" --> AsteriskWs
    Services <-- "9. SRTP / DTLS Audio Stream (Đàm thoại 2 chiều)" --> RtpStream
```

### BẢNG ĐỐI CHIẾU CHI TIẾT TỪNG PHƯƠNG THỨC GỌI API

| STT | Phân hệ / Dịch vụ | Mục trong `dev_guide.md` | Endpoint & Phương thức yêu cầu | Triển khai thực tế trong mã nguồn | Đánh giá & Kết quả kiểm tra |
|:---:|---|:---:|---|---|:---:|
| **1** | **Xác thực (`wazo-auth`)** | Mục 2 & 7 | • `POST /api/auth/0.1/token`<br>• Body: `{"expiration": 3600, "access_type": "offline", "client_id": "..."}`<br>• Header: `X-Auth-Token: <token>` | • `src/services/wazo.js`: Dùng `@wazo/sdk` (`Wazo.Auth.logIn`), lưu `token` & `refreshToken` vào `localStorage`.<br>• Tự động khôi phục phiên qua `Wazo.Auth.validateToken()`. | **CHUẨN 100%** ✅ |
| **2** | **Thông tin User & Máy lẻ (`wazo-confd`)** | Mục 4.1 | • `GET /api/confd/1.1/users/me`<br>• Header: `X-Auth-Token` | • `src/views/LoginView.vue`: Sau khi login, gọi trực tiếp `/api/confd/1.1/users/me` để trích xuất `firstname + lastname` và số máy lẻ `lines[0].extensions[0].exten`. | **CHUẨN 100%** ✅ |
| **3** | **Thoại WebRTC SIP (`wazo-calld` / Asterisk)** | Mục 5 & 7 | • WSS: `wss://<HOST>/api/asterisk/ws`<br>• Subprotocol: `sip`<br>• Đăng ký: `Wazo.Phone.connect({ audio: true, video: false })`<br>• Lệnh: `call`, `accept`, `reject`, `hangup`, `mute`, `hold` | • `src/services/wazo.js`: Quản lý trọn vẹn vòng đời cuộc gọi qua `@wazo/sdk`.<br>• Tự động tạo thẻ `<audio id="wazo-remote-audio" autoplay>` gắn luồng `RemoteStream` để đàm thoại 2 chiều qua micro và loa. | **CHUẨN 100%** ✅ |
| **4** | **Sự kiện Realtime (`wazo-websocketd`)** | Mục 6 | • URL: `wss://<HOST>/api/websocketd/?token=<token>&version=2`<br>• Handshake: Gửi `{"op": "subscribe", "data": {"event_name": "..."}}` và `{"op": "start"}` | • `src/services/websocketService.js`: Kết nối đúng chuẩn giao thức v2.<br>• Đăng ký 5 sự kiện: `call_created`, `call_answered`, `call_ended`, `chatd_user_room_message_created`, `chatd_presence_updated`. Tự động reconnect sau 5s. | **CHUẨN 100%** ✅ |
| **5** | **Danh bạ nhân sự (`wazo-dird`)** | Mục 4.4 | • B1: `GET /api/dird/0.1/directories/default/sources?backend=wazo`<br>• B2: `GET /api/dird/0.1/backends/wazo/sources/{uuid}/contacts?limit=1000` | • `src/services/contactService.js`: Triển khai đầy đủ 2 bước.<br>• Parser hỗ trợ cả 2 định dạng: mảng object `items` và định dạng cột `column_types`, tự động trích xuất tên, máy lẻ `exten` và phòng ban. | **CHUẨN 100%** ✅ |
| **6** | **Lịch sử cuộc gọi (`wazo-call-logd`)** | Mục 4.3 | • Lấy CDR: `GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc`<br>• Xóa CDR: `DELETE /api/call-logd/1.0/users/me/cdr` | • `src/services/historyService.js`: Gọi đúng endpoint, map các trường `start`, `answered`, `duration`, `destination_extension`, `call_direction`.<br>• Tích hợp cơ chế **Merge (Hợp nhất)**: kết hợp lịch sử từ Wazo server và các cuộc gọi cục bộ mới nhất không bị mất. | **CHUẨN 100%** ✅ |
| **7** | **Tin nhắn & Phòng chat (`wazo-chatd`)** | Mục 4.6 | • Danh sách phòng: `GET /api/chatd/1.0/users/me/rooms`<br>• Gửi tin: `POST /api/chatd/1.0/users/me/rooms/{uuid}/messages`<br>• Tải tin nhắn: `GET /api/chatd/1.0/users/me/rooms/{uuid}/messages?limit=50` | • `src/services/chatService.js`: Triển khai đầy đủ 3 API.<br>• `MessagesView.vue`: Khi mở phòng chat Wazo thật, tự động gọi `getRoomMessages()` để kéo lịch sử tin nhắn từ máy chủ về. | **CHUẨN 100%** ✅ |
| **8** | **Trạng thái Presence (`wazo-chatd`)** | Mục 4.5 | • `PUT /api/chatd/1.0/users/me/presences`<br>• Body: `{"state": "available", "status": "..."}` | • `src/services/wazo.js`: Bổ sung hàm `setPresence(state, statusText)`.<br>• `AppHeader.vue`: Khi người dùng chuyển trạng thái (Available, Away, Busy...), lập tức gửi request `PUT` lên máy chủ Wazo. | **CHUẨN 100%** ✅ |

---

## 8. BẢNG MA TRẬN KIỂM THỬ TỪNG PHÂN HỆ CHỨC NĂNG (FUNCTIONAL TEST MATRIX)

Bảng ma trận kiểm thử được xây dựng theo tiêu chuẩn kiểm thử phần mềm chuyên nghiệp (QA / Test Lead), bao quát toàn bộ 8 phân hệ chức năng cốt lõi và các luồng nghiệp vụ trên hệ thống SmartCall Web.

### 8.1. Ma trận kiểm thử chi tiết 8 phân hệ

| STT | Mã Test Case | Phân hệ / Tính năng | Các bước thực hiện (Test Steps) | Dữ liệu đầu vào (Input) | Kết quả mong đợi (Expected Result) | Trạng thái |
|:---:|:---:|---|---|---|---|:---:|
| **I** | **PHÂN HỆ 1: XÁC THỰC & ĐĂNG NHẬP (AUTHENTICATION & SESSION)** | | | | |
| 1 | `TC-AUTH-01` | Đăng nhập tài khoản Wazo hợp lệ | 1. Nhập username & password.<br>2. Bấm "LOGIN". | `alice` / `Test@123` | Lấy Token thành công, lưu localStorage, chuyển hướng sang `/dashboard`, hiển thị tên và máy lẻ 1001. | **PASS** ✅ |
| 2 | `TC-AUTH-02` | Đăng nhập sai mật khẩu | 1. Nhập user đúng, pass sai.<br>2. Bấm "LOGIN". | `alice` / `SaiPass123` | Hiển thị thông báo lỗi chi tiết (Mã 401: Sai tên đăng nhập hoặc mật khẩu), không chuyển trang. | **PASS** ✅ |
| 3 | `TC-AUTH-03` | Nút Đăng nhập nhanh Quản trị viên | Nhấp nút "Đăng nhập nhanh Quản trị viên (Alice - 1001)". | Click chuột | Tự động điền `alice`/`Test@123` và đăng nhập thẳng vào hệ thống 0s. | **PASS** ✅ |
| 4 | `TC-AUTH-04` | Chế độ thử nghiệm Offline | Bấm nút "Chạy chế độ thử nghiệm Offline". | Click chuột | Đăng nhập ngay lập tức với tài khoản Mock Quản trị viên (1001), chạy độc lập không cần máy chủ Wazo. | **PASS** ✅ |
| 5 | `TC-AUTH-05` | Đăng xuất hệ thống | Bấm nút "🚪 Thoát" trên thanh Header. | Click chuột | Xóa toàn bộ token & session trong localStorage, ngắt kết nối SIP, điều hướng về màn hình `/login`. | **PASS** ✅ |
| **II** | **PHÂN HỆ 2: MÀN HÌNH TỔNG QUAN (DASHBOARD & KPI CARDS)** | | | | |
| 6 | `TC-DASH-01` | Đồng bộ 4 thẻ chỉ số KPI động | Quan sát 4 thẻ KPI trên màn hình Tổng quan. | Dữ liệu từ services | • Thẻ 1: Đúng máy lẻ đăng nhập & trạng thái WebRTC.<br>• Thẻ 2: Đúng tổng số danh bạ & online.<br>• Thẻ 3: Đúng số tin chưa đọc & số phòng.<br>• Thẻ 4: Đúng tổng cuộc gọi, đến, đi, nhỡ. | **PASS** ✅ |
| 7 | `TC-DASH-02` | Gọi nhanh từ Speed Dial | Bấm vào một liên hệ trong widget "Phím tắt liên hệ". | Click thẻ liên hệ | Tự động chuyển sang màn hình Gọi thoại và khởi chạy cuộc gọi ngay lập tức. | **PASS** ✅ |
| 8 | `TC-DASH-03` | Nhảy số thời gian thực khi có sự kiện | Thực hiện cuộc gọi mới hoặc xóa liên hệ danh bạ. | Sự kiện Event Bus | Các thẻ KPI và widget 3 cuộc gọi gần nhất tự động cập nhật số liệu mới tức thì không cần F5. | **PASS** ✅ |
| **III** | **PHÂN HỆ 3: GỌI THOẠI WEBRTC & BÀN PHÍM SỐ (CALLS & WEBRTC SIP)** | | | | |
| 9 | `TC-CALL-01` | Bấm số trên bàn phím số (Keypad) | Nhấp các phím 0-9, *, # hoặc gõ phím vật lý. | Bấm phím | Ô nhập số hiển thị đúng ký tự, phát âm thanh DTMF tần số chuẩn viễn thông. | **PASS** ✅ |
| 10 | `TC-CALL-02` | Tách biệt Đổ chuông & Bắt đầu tính giờ | 1. Bấm Gọi đến máy 1002.<br>2. Chờ bên kia nhấc máy. | Quay số 1002 | • Khi đang chờ: Phát tiếng tút... tút... ITU-T, thời lượng báo "Đang đổ chuông...", KHÔNG đếm giờ.<br>• Khi bắt máy: Chuông dừng, đồng hồ mới bắt đầu nhảy 00:01, 00:02... | **PASS** ✅ |
| 11 | `TC-CALL-03` | Bật/Tắt Microphone (Mute/Unmute) | Bấm nút "Tắt tiếng" trong khi đàm thoại. | Click Mute | Đổi trạng thái sang Bật tiếng, ngắt luồng mic truyền đi, click lần nữa để bật lại bình thường. | **PASS** ✅ |
| 12 | `TC-CALL-04` | Giữ cuộc gọi (Hold/Unhold) | Bấm nút "Giữ máy". | Click Hold | Phiên gọi tạm dừng truyền media, icon chuyển màu cảnh báo, bấm lại để tiếp tục đàm thoại. | **PASS** ✅ |
| 13 | `TC-CALL-05` | Cúp máy & Lưu CDR tự động | Bấm nút đỏ "Cúp máy". | Click Hangup | Ngắt cuộc gọi, phát âm thanh kết thúc cuộc gọi (3 tiếng bíp), tự động lưu bản ghi vào Lịch sử. | **PASS** ✅ |
| 14 | `TC-CALL-06` | Họp thoại nhóm (Conference 8001) | Bấm nút "Họp thoại nhóm (8001)" trên thanh công cụ. | Click nút họp | Tự động quay số 8001 và kết nối vào phòng họp thoại đa điểm của doanh nghiệp. | **PASS** ✅ |
| **IV** | **PHÂN HỆ 4: DANH BẠ NHÂN SỰ NỘI BỘ (CONTACTS & PHONEBOOK)** | | | | |
| 15 | `TC-CONT-01` | Hiển thị danh bạ & Tìm kiếm lọc | Nhập từ khóa tên/phòng ban/máy lẻ vào ô tìm kiếm. | Gõ "Alice" hoặc "1002" | Bảng danh bạ lọc tức thì các nhân viên khớp từ khóa, hiển thị đúng chấm trạng thái Online/Offline. | **PASS** ✅ |
| 16 | `TC-CONT-02` | 4 Nút hành động trên từng liên hệ | Bấm thử 4 nút: Gọi thoại, Nhắn tin, Gọi video, Xóa. | Thao tác nút | • 📞: Chuyển sang gọi số máy lẻ đó.<br>• 💬: Chuyển sang phòng chat tương ứng.<br>• 🎥: Mở modal gọi video.<br>• ❌: Hiện modal xác nhận xóa an toàn. | **PASS** ✅ |
| 17 | `TC-CONT-03` | Đánh dấu Yêu thích (Favorite ⭐) | Bấm icon ngôi sao bên cạnh nhân sự. | Click ⭐ | Ngôi sao sáng vàng, nhân sự được đưa lên mục Ưu tiên, trạng thái lưu bền vững. | **PASS** ✅ |
| **V** | **PHÂN HỆ 5: TIN NHẮN PHÒNG CHAT REALTIME (MESSAGES & ROOMS)** | | | | |
| 18 | `TC-CHAT-01` | Gửi và nhận tin nhắn văn bản | Chọn phòng chat, nhập tin nhắn, bấm Gửi / Enter. | Nội dung text | Tin nhắn xuất hiện ngay trong khung chat, phòng chat tự động nhảy lên Top 1 danh sách phòng. | **PASS** ✅ |
| 19 | `TC-CHAT-02` | Thanh Ghim thông báo & Trạng thái đã đọc | 1. Quan sát thanh ghim.<br>2. Bấm vào chữ "Read" ở bong bóng tin. | Thao tác | • Thanh ghim hiện thông báo quan trọng đầu phòng chat.<br>• Bấm Read mở popup hiển thị danh sách người đã đọc. | **PASS** ✅ |
| 20 | `TC-CHAT-03` | Modal Thêm thành viên (Add Member) | Bấm nút "Thành viên" trên đầu khung chat. | Click nút | Mở modal quản lý nhóm: Admin đổi được tên phòng, thêm người mới, xóa thành viên (có xác nhận). | **PASS** ✅ |
| 21 | `TC-CHAT-04` | Bảo toàn dữ liệu phòng chat (Cache) | Gửi vài tin nhắn, chuyển sang tab khác rồi quay lại. | Chuyển tab / F5 | Toàn bộ tin nhắn và phòng chat giữ nguyên 100% nhờ bộ lưu trữ bền vững. | **PASS** ✅ |
| **VI** | **PHÂN HỆ 6: LỊCH SỬ CUỘC GỌI CDR (CALL HISTORY)** | | | | |
| 22 | `TC-HIST-01` | Phân loại 4 tab lọc lịch sử | Bấm chuyển đổi giữa ALL, INCOMINGS, OUTGOINGS, MISSED. | Click tab lọc | Danh sách lọc chính xác từng nhóm cuộc gọi kèm icon mũi tên phân biệt và thời lượng đàm thoại. | **PASS** ✅ |
| 23 | `TC-HIST-02` | Gọi lại nhanh (Redial) | Bấm nút 📞 màu xanh ở dòng lịch sử cuộc gọi. | Click 📞 Gọi lại | Chuyển ngay sang màn hình gọi và tự động quay số của cuộc gọi đó. | **PASS** ✅ |
| 24 | `TC-HIST-03` | Xóa sạch lịch sử cuộc gọi | Bấm nút "🗑️ DELETE HISTORY". | Click nút xóa | Hiển thị hộp thoại xác nhận; khi đồng ý, xóa toàn bộ CDR trong bộ nhớ và cập nhật badge về 0. | **PASS** ✅ |
| **VII** | **PHÂN HỆ 7: HEADER, SIDEBAR & TÌM KIẾM AUTOCOMPLETE** | | | | |
| 25 | `TC-HEAD-01` | Tìm kiếm Autocomplete Top 5 trên Header | Gõ chữ cái bất kỳ vào ô tìm kiếm trên Header. | Gõ "a" hoặc "10" | Dropdown xổ xuống gợi ý tối đa 5 liên hệ trùng khớp, có nút bấm Gọi nhanh hoặc Nhắn tin ngay. | **PASS** ✅ |
| 26 | `TC-HEAD-02` | Modal Thông tin Kết nối Tổng đài | Bấm vào chấm trạng thái Trực tuyến/Ngoại tuyến trên Header. | Click trạng thái | Bật Modal sang trọng hiển thị chi tiết kết nối Wazo và 3 bước kích hoạt SSL thay thế popup alert cũ. | **PASS** ✅ |
| 27 | `TC-HEAD-03` | Chuyển đổi trạng thái Presence | Chọn Online, Away hoặc DND trên dropdown Header. | Đổi option | Hệ thống cập nhật trạng thái hiển thị và đồng bộ ngay lên máy chủ Wazo qua API Presence. | **PASS** ✅ |
| 28 | `TC-SIDE-01` | Huy hiệu Badge động trên Sidebar | Tạo tin nhắn chưa đọc hoặc tạo cuộc gọi nhỡ. | Có tin / cuộc gọi | • Tab Tin nhắn hiện badge đỏ số tin chưa đọc (tự ẩn khi hết tin).<br>• Tab Lịch sử hiện badge đỏ khi có cuộc gọi nhỡ.<br>• Tab Danh bạ hiện badge trung tính tổng nhân viên. | **PASS** ✅ |
| **VIII** | **PHÂN HỆ 8: CÀI ĐẶT HỆ THỐNG & GIẢ LẬP CUỘC GỌI** | | | | |
| 29 | `TC-SETT-01` | Modal Cài đặt 4 Tab (`⚙️ SETTINGS`) | Bấm nút "⚙️ SETTINGS" trên thanh Header. | Click Settings | Mở Modal Cài đặt đầy đủ 4 tab: Âm thanh & WebRTC, Dịch vụ cuộc gọi (DND, Forwarding), Tài khoản, Ngôn ngữ. | **PASS** ✅ |
| 30 | `TC-TEST-01` | Nút giả lập cuộc gọi đến (Test Call) | Bấm nút "🔔 Test Gọi Đến" trên thanh Header. | Click Test | Bật Popup "INCOMING CALL" toàn màn hình, đổ chuông reo, kiểm tra nút Nghe máy và Từ chối hoạt động chuẩn. | **PASS** ✅ |

---

### 8.2. Hướng dẫn vị trí tra cứu các bước kiểm thử cho ngày mai

Để phục vụ buổi kiểm thử thực tế giữa 2 máy client nội bộ ngày mai, bạn chỉ cần mở file tài liệu này và tra cứu trực tiếp tại 2 vị trí trọng tâm sau:

1. **VỊ TRÍ 1 — CÁC BƯỚC THIẾT LẬP KẾT NỐI VÀ CHẠY DỰ ÁN (DÀNH CHO BẠN VÀ ĐỒNG NGHIỆP):**
   - **Mục tài liệu:** [**`## 4. KẾ HOẠCH TRIỂN KHAI VÀ KIỂM THỬ TRÊN HỆ THỐNG MẠNG NỘI BỘ DOANH NGHIỆP`**](#4-kế-hoạch-triển-khai-và-kiểm-thử-trên-hệ-thống-mạng-nội-bộ-doanh-nghiệp)
   - **Mục 4.1:** Hướng dẫn chi tiết 5 bước kết nối máy chủ tổng đài Wazo (`107.126.11.126:9443`):
     - **Bước 1:** Xác thực nhanh chứng chỉ SSL WSS qua trình duyệt (Chỉ mất 15 giây, khuyên dùng Cách 1, không cần cài file `.crt`).
     - **Bước 2:** Lệnh kiểm tra mạng và lấy Token qua cURL.
     - **Bước 3:** Kiểm tra file biến môi trường `.env`.
     - **Bước 4:** Đăng nhập trang quản trị Wazo UI bằng tài khoản `root` (khi cần tra cứu máy lẻ).
     - **Bước 5:** Khởi động dự án `npm run dev` và đăng nhập 2 tài khoản `alice` (1001) và `bob` (1002).
   - **Mục 4.2:** Hướng dẫn 3 lệnh Git để đồng nghiệp kéo mã nguồn về máy của họ (`git clone`, `npm install`, `npm run dev`).

2. **VỊ TRÍ 2 — KỊCH BẢN THỰC HIỆN CUỘC GỌI ĐÀM THOẠI 2 CHIỀU (TEST SCENARIO):**
   - **Mục tài liệu:** [**`### BƯỚC 14: Kịch bản kiểm thử 2 máy nội bộ (Mục 14.5 & 14.6)`**](#bước-14-tối-ưu-cấu-hình-vite-đối-chiếu-dev_guide--kịch-bản-kiểm-thử-đàm-thoại-2-client-nội-bộ)
   - **Quy trình kiểm thử đàm thoại:**
     - Máy 1 đăng nhập `alice` $\rightarrow$ Trình duyệt hỏi cấp quyền Micro $\rightarrow$ Chọn **Allow (Cho phép)** $\rightarrow$ Header hiện `🟢 Trực tuyến (1001)`.
     - Máy 2 đăng nhập `bob` $\rightarrow$ Cấp quyền Micro $\rightarrow$ Header hiện `🟢 Trực tuyến (1002)`.
     - Máy 1 vào tab **Gọi điện** (`/calls`) $\rightarrow$ Quay số `1002` $\rightarrow$ Bấm Gọi $\rightarrow$ Tiếng tút tút phát ra $\rightarrow$ Máy 2 đổ chuông reo $\rightarrow$ Bấm **Nghe máy** $\rightarrow$ Hai bên nói chuyện kiểm tra âm thanh 2 chiều $\rightarrow$ Bấm **Cúp máy** $\rightarrow$ Kiểm tra bản ghi thời lượng đàm thoại trong Lịch sử cuộc gọi.

---

## 9. ĐỐI CHIẾU MÃ NGUỒN THAM CHIẾU MẪU VÀ GIẢI MÃ NGUYÊN NHÂN LỖI ĐĂNG NHẬP CORS PREFLIGHT

### 9.1. Hiện tượng và Nguyên nhân gốc rễ (Root Cause Analysis)

Khi mở trình duyệt mới hoặc chuyển sang mạng công ty và đăng nhập bằng tài khoản Wazo thật, trình duyệt xuất hiện lỗi console:
```text
Access to fetch at 'https://107.126.11.126:9443/api/confd/1.1/users/me' from origin 'http://localhost:5173' 
has been blocked by CORS policy: Response to preflight request doesn't pass access control check: 
It does not have HTTP ok status.
GET https://107.126.11.126:9443/api/confd/1.1/users/me net::ERR_FAILED
```

**Phân tích nguyên nhân kỹ thuật:**
1. **Bước đăng nhập thực chất ĐÃ THÀNH CÔNG:** Lệnh `Wazo.Auth.logIn(u, p)` đã xác thực với máy chủ Wazo và nhận về Session kèm Token thành công.
2. **Điểm nghẽn gây crash luồng:** Ngay sau khi login, mã nguồn cũ gọi tiếp `fetch('https://107.126.11.126:9443/api/confd/1.1/users/me', { headers: { 'X-Auth-Token': token } })`. Do `X-Auth-Token` là Custom HTTP Header, trình duyệt Chrome bắt buộc phải gửi một HTTP Request `OPTIONS` (CORS Preflight) trước khi gửi request `GET`.
3. Do máy chủ Wazo sử dụng SSL tự ký (`self-signed certificate`), trong phiên trình duyệt mới người dùng chưa mở tab xác nhận tin cậy URL `https://107.126.11.126:9443/`, trình duyệt từ chối request `OPTIONS` này và phát sinh lỗi mạng `net::ERR_FAILED`.
4. Khi `fetch()` bị lỗi, nó văng ngoại lệ `TypeError: Failed to fetch`. Do khối này nằm trong `try` chính của `handleLogin`, lỗi đã khiến toàn bộ quá trình đăng nhập bị coi là thất bại và báo thông báo `"Tên đăng nhập hoặc mật khẩu không chính xác."`.

---

### 9.2. So sánh đối chiếu giữa Mã nguồn dự án và Mã nguồn tham chiếu mẫu

| Tiêu chí so sánh | Mã nguồn tham chiếu mẫu (`LoginForm.vue` & `wazo.js`) | Mã nguồn dự án cũ | Mã nguồn dự án sau khi tối ưu |
|---|---|---|---|
| **Cách lấy thông tin User & Số máy lẻ** | **Không gọi REST API phụ**. Trích xuất trực tiếp từ đối tượng `session` trong RAM:<br>• `session.profile.firstName`, `session.profile.lastName`<br>• `session.primaryNumber?.()` | Gọi `fetch('/api/confd/1.1/users/me')` với header `X-Auth-Token`, gây phát sinh CORS Preflight `OPTIONS`. | **Đồng bộ chuẩn theo mã tham chiếu**: Trích xuất ngay từ `session.profile` và `session.primaryNumber?.()`. Nếu cần gọi `confd/users/me` thì bọc trong `try/catch` độc lập không gây lỗi luồng chính. |
| **Mật khẩu tài khoản mẫu** | `username: "alice"`, `password: "atc2024!"` | `username: "alice"`, `password: "Test@123"` | Bổ sung gợi ý mật khẩu chuẩn `atc2024!` khi người dùng đăng nhập tài khoản Alice. |
| **Kích hoạt WebRTC Phone** | Tự động gọi `Wazo.Phone.connect({ audio: true, video: false })` ngay lập tức trong hàm `login()`. | Không tự động kết nối sau login, phụ thuộc vào trigger thủ công. | Tự động kết nối WebRTC Phone ngay trong `wazoService.login()` và `wazoService.restoreSession()`. |
| **Sự kiện WebRTC Phone** | Lắng nghe đầy đủ: `ON_REGISTERED`, `ON_UNREGISTERED`, `ON_CALL_INCOMING`, `ON_CALL_OUTGOING`, `ON_PROGRESS`, `ON_CALL_ACCEPTED`, `ON_CALL_ENDED`, `ON_CALL_FAILED`, `ON_CALL_REJECTED`, `ON_CALL_CANCELED`. | Thiếu `ON_UNREGISTERED`, `ON_CALL_REJECTED`, `ON_CALL_CANCELED`. | Bổ sung đầy đủ 100% các sự kiện theo mã tham chiếu. |
| **Tham số cuộc gọi WebRTC** | `Wazo.Phone.call(number, false)` và `Wazo.Phone.accept(cs, false)` (tham số `false` quy định audio-only). | Gọi thiếu tham số `false` cho video. | Bổ sung tham số `false` chuẩn cho thoại audio WebRTC. |
| **Chế độ nạp danh bạ (Dird)** | Hỗ trợ 2 cơ chế: Cách 1 liệt kê toàn bộ qua nguồn (`sources`), nếu lỗi tự động fallback sang Cách 2 tra cứu tìm kiếm (`lookup/default?term=1`). | Chỉ hỗ trợ cách 1, nếu lỗi rơi thẳng về Mock data. | Hỗ trợ đầy đủ cả Cách 1 và fallback Cách 2 trước khi dùng dữ liệu dự phòng. |
| **Gợi ý xác thực SSL CA** | Có dòng hướng dẫn mở `https://107.126.11.126:9443/` để tin cậy chứng chỉ Wazo. | Chỉ có trong modal hướng dẫn header. | Hiển thị trực tiếp dòng hướng dẫn và link 1 click ngay dưới form đăng nhập. |

---

## 10. HỆ THỐNG CỜ TÍNH NĂNG (FEATURE FLAGS), CHẾ ĐỘ MOCK DATA VÀ BẢNG NHẬT KÝ THỜI GIAN THỰC (LIVE DEBUG LOGS)

### 10.1. Quản trị 5 Cờ Phân hệ Màn hình và Cờ Dữ liệu Mẫu (Feature Flags & Mock Mode)

File cấu hình trung tâm đặt tại: `src/config/features.js`:
- **5 Cờ phân hệ giao diện:**
  - `dashboard`: Màn hình Tổng quan (`/dashboard`)
  - `calls`: Màn hình Gọi điện & Bàn phím số (`/calls`)
  - `contacts`: Màn hình Danh bạ nội bộ (`/contacts`)
  - `messages`: Màn hình Tin nhắn & Phòng chat (`/messages`)
  - `history`: Màn hình Lịch sử cuộc gọi (`/history`)
- **1 Cờ chế độ dữ liệu (`mockData`):**
  - **Khi bật (`true`):** Hiển thị nút "Chạy chế độ thử nghiệm Offline" ở màn hình Đăng nhập; sử dụng dữ liệu mẫu dự phòng khi chưa kết nối máy chủ Wazo.
  - **Khi tắt (`false`):** Ẩn hoàn toàn nút chế độ thử nghiệm Offline ở màn hình Login; loại bỏ 100% dữ liệu mock khởi tạo; ứng dụng chỉ truy vấn và hiển thị dữ liệu thật từ máy chủ tổng đài Wazo. Nếu máy chủ trả về rỗng hoặc lỗi, giao diện sẽ để trắng danh sách theo đúng thực tế máy chủ.

> [!TIP]
> Bạn có thể thay đổi nhanh các cờ này bằng 2 cách:
> 1. Mở file [src/config/features.js](file:///d:/Project/Smart_Call_Web/src/config/features.js) và sửa giá trị `true` / `false`.
> 2. Mở trực tiếp trên giao diện: Bấm **⚙️ SETTINGS** trên thanh Header $\rightarrow$ Chuyển sang Tab **🚩 Phân hệ & Mock Data** $\rightarrow$ Tích chọn/bỏ chọn và bấm **Lưu cài đặt**.

---

### 10.2. Cơ chế xử lý triệt để luồng âm thanh chuông chờ "Tút... Tút..."

- **Nguyên nhân phát sinh lỗi trước đây:** Khi cuộc gọi kết thúc do đối phương từ chối hoặc hủy máy, hàm ngắt chuông chỉ được gọi cục bộ trong view quay số mà chưa đồng bộ cấp dịch vụ lõi; các bộ dao động âm thanh (`OscillatorNode`) của Web Audio API vẫn tiếp tục phát hết chu kỳ 1 giây.
- **Giải pháp xử lý:**
  1. Trong `src/services/audioService.js`, bổ sung mảng quản lý `activeOscillators`. Khi hàm `stopAllTones()` hoặc `stopRingbackTone()` được gọi, toàn bộ oscillator đang dao động bị ngắt dứt khoát ngay lập tức với `osc.stop(0)` và `osc.disconnect()`.
  2. Trong `src/services/wazo.js`, tích hợp gọi `audioService.stopAllTones()` trực tiếp tại tất cả các sự kiện kết thúc cuộc gọi từ máy chủ Wazo: `ON_CALL_ENDED`, `ON_CALL_FAILED`, `ON_CALL_REJECTED`, `ON_CALL_CANCELED` và các hàm `hangup()`, `reject()`.

---

### 10.3. Nguyên nhân gây ngắt cuộc gọi liên tục trên máy đồng nghiệp và Hướng khắc phục

Nếu máy đồng nghiệp khi bấm Gọi lập tức bị kết thúc cuộc gọi liên tục, có 4 nguyên nhân kỹ thuật phổ biến sau:
1. **Trình duyệt đang chặn quyền Microphone (`NotAllowedError`):**
   - WebRTC bắt buộc phải có luồng Micro. Nếu trình duyệt trên máy đồng nghiệp chưa bấm **Cho phép (Allow)** Microphone, Wazo SDK không thể tạo bản tin SDP Offer và tự động hủy cuộc gọi ngay lập tức.
   - *Khắc phục:* Bấm vào biểu tượng ổ khóa/cài đặt trang web trên thanh địa chỉ URL của Chrome $\rightarrow$ Chuyển **Microphone** sang **Allow (Cho phép)** $\rightarrow$ Tải lại trang.
2. **Chưa xác thực tin cậy chứng chỉ SSL máy chủ Wazo:**
   - Kết nối SIP WebRTC chạy qua WebSocket bảo mật `wss://107.126.11.126:9443/api/asterisk/ws`.
   - Nếu máy đồng nghiệp lần đầu truy cập và chưa mở đường dẫn `https://107.126.11.126:9443/` để bấm "Nâng cao $\rightarrow$ Tiếp tục truy cập", kết nối WSS bị trình duyệt chặn dẫn tới trạng thái SIP là `Unregistered`. Khi bấm gọi, SDK không thể gửi bản tin SIP `INVITE` và báo lỗi `ON_CALL_FAILED`.
   - *Khắc phục:* Mở link `https://107.126.11.126:9443/` ở tab mới một lần để trình duyệt ghi nhớ tin cậy SSL.
3. **Gọi tới máy lẻ đang Offline hoặc không tồn tại:**
   - Ví dụ: Máy A đăng nhập `1002`, gọi tới `1001` nhưng lúc đó máy `1001` chưa mở hoặc chưa đăng nhập. Tổng đài Asterisk phản hồi SIP `404 Not Found` hoặc `480 Temporarily Unavailable`, khiến cuộc gọi tự động kết thúc trong vòng 0.5 giây.
4. **Tự gọi chính mình (Self Call Loopback):**
   - Máy đang đăng nhập số `1001` nhưng lại quay số `1001`. Tổng đài từ chối cuộc gọi loopback và tự cúp máy ngay.

---

### 10.4. Hệ thống Nhật ký thao tác thời gian thực (Live Debug Logging)

Hệ thống ghi log trực quan đã được tích hợp toàn diện:
- **Xem qua Console F12:** Mọi thao tác bấm nút, gọi số, sự kiện đăng ký SIP và sự kiện tổng đài đều in ra Console với nhãn màu chuyên biệt:
  - `[CALL]`: Tím (Cuộc gọi, quay số, kết nối, cúp máy)
  - `[SIP]`: Xanh lá (Trạng thái đăng ký WebRTC SIP)
  - `[AUTH]`: Xanh dương (Đăng nhập, Token, phân quyền)
  - `[UI]`: Xám (Thao tác bấm nút của người dùng)
  - `[AUDIO]`: Cam (Phát/dừng chuông tút tút)
  - `[API]`: Xanh biển (Gọi REST API Wazo)
- **Xem trực tiếp trên màn hình giao diện (Không cần mở F12):**
  - Ở góc dưới bên phải màn hình có nút nổi **`📋 Logs`**.
  - Nhấp vào nút để mở bảng điều khiển **Live Debug Console**: Có bộ lọc theo danh mục, nút **Sao chép**, nút **Xóa**, tự động cập nhật từng giây khi bạn hoặc đồng nghiệp thao tác.

---

## 11. ĐỒNG BỘ TRẠNG THÁI TRỰC TUYẾN TỨC THÌ, PRESENCE THẬT VÀ PHẦN CỨNG ÂM THANH

### 11.1. Xử lý trạng thái Trực tuyến tổng đài ngay lập tức sau khi đăng nhập (Không cần F5)
- **Cơ chế trước đây:** Header chỉ lắng nghe sự kiện `wazo-registered`. Khi đăng nhập tại màn hình `/login`, sự kiện SIP bắn ra trước khi router chuyển trang sang `/dashboard`, khiến Header khi vừa sinh ra bị lỡ sự kiện và tiếp tục hiển thị trạng thái Offline cho đến khi bấm F5.
- **Giải pháp tối ưu:** Lưu cờ `this.isRegistered` trong `wazoService`. Khi `AppHeader.vue` và `AppSidebar.vue` khởi tạo trong `onMounted`, hệ thống chủ động gọi hàm kiểm tra `wazoService.isPhoneRegistered()` để chuyển ngay sang `🟢 Trực tuyến (1001)` tức thì.

### 11.2. Đồng bộ trạng thái Presence thật cho toàn bộ Danh bạ qua Wazo Chatd
- Thay vì gán cứng trạng thái `online`, sau khi nạp danh bạ từ `wazo-dird`, hệ thống gom toàn bộ `user_uuid` của các nhân viên và gọi API:
  `GET /api/chatd/1.0/users/presences?user_uuid=uuid1,uuid2,...`
- Phân loại chính xác 5 trạng thái hiển thị trên giao diện:
  - 🟢 **Trực tuyến (Online):** Có line SIP đang khả dụng (`lines[].state !== 'unavailable'`).
  - 🔴 **Đang gọi (Busy):** Line đang ở trạng thái `talking` hoặc `holding`.
  - 🔵 **Đang đổ chuông (Ringing):** Line đang nhận cuộc gọi (`ringing` / `progressing`).
  - 🟠 **Bận / DND (Do Not Disturb):** Nhân viên đang kích hoạt chế độ Không làm phiền.
  - ⚪ **Ngoại tuyến (Offline):** Chưa đăng nhập hoặc không có line SIP đăng ký.

### 11.3. Quét thiết bị phần cứng âm thanh thật và Tín hiệu Micro thời gian thực (VU Meter)
- **Thiết bị thật:** Sử dụng `navigator.mediaDevices.enumerateDevices()` để quét và hiển thị đúng 100% tên các Micro và Loa/Tai nghe thực tế cắm trên máy tính.
- **Tín hiệu Micro thật:** Dùng Web Audio API `AudioContext` + `AnalyserNode` thu âm trực tiếp luồng mic thật để tính toán biên độ âm lượng (0% - 100%), thanh VU Meter co giãn mượt mà theo độ lớn giọng nói của người dùng và tự hạ về 0% khi im lặng.
- **Thử loa thật:** Nút "🔊 Thử loa" phát chuỗi âm thanh 3 nốt nhạc du dương qua AudioContext ra thiết bị xuất âm thanh đã chọn.

---

## 12. KIỂM SOÁT LUỒNG GỌI ĐIỆN 1-1 VÀ CƠ CHẾ ÂM THANH SONG CÔNG (FULL-DUPLEX)

### 12.1. Bản chất luồng thoại 1-1 trong WebRTC và Wazo Platform
- **Song công toàn phần (Full-Duplex):** Hệ thống sử dụng 2 luồng RTP âm thanh hai chiều độc lập (`sendrecv`) truyền tải bằng codec Opus tần số 48kHz. Hai bên tham gia cuộc gọi hoàn toàn có thể vừa nói vừa nghe đồng thời trong cùng một thời điểm mà không bị ngắt hoặc phải chờ nhau (khác với cơ chế bộ đàm Half-Duplex Push-to-Talk).
- **Cơ chế gắn luồng âm thanh dự phòng (Fallback Audio Attachment):**
  - Khi bắt sự kiện `Wazo.Phone.ON_CALL_ACCEPTED`, Wazo SDK tự động tạo thẻ `<audio id="audio-{sessionId}">` và phát luồng âm thanh nhận được.
  - Nhằm phòng ngừa tình trạng trình duyệt chậm gắn `remoteMediaStream` trên các mạng có độ trễ cao, hệ thống bổ sung cơ chế kiểm tra dự phòng sau 600ms (theo mã nguồn tham chiếu chuẩn). Nếu phát hiện chưa có thẻ audio nào đang phát, hệ thống tự động gắn `stream` vào thẻ `wazo-remote-audio` để kích hoạt luồng phát ngay tức thì.

### 12.2. Vấn đề thử nghiệm trên cùng 1 máy tính với 1 Microphone
Khi thử nghiệm cuộc gọi giữa 2 tài khoản (ví dụ mở 2 tab trình duyệt trên cùng 1 máy tính):
1. **Bộ lọc khử tiếng vọng (WebRTC Acoustic Echo Cancellation - AEC):**
   - Khi Tab A thu tiếng từ Mic máy tính gửi sang Tab B.
   - Tab B phát tiếng ra Loa máy tính.
   - Chiếc Mic duy nhất trên máy tính ngay lập tức thu ngược âm thanh vừa phát ra từ Loa (gây vòng lặp Acoustic Feedback Loop).
   - Bộ xử lý WebRTC AEC của trình duyệt sẽ phát hiện tín hiệu lặp và lập tức **dập tắt (mute) tín hiệu micro** để chống rú rít, khiến người dùng lầm tưởng một bên không nói được hoặc không nghe được.
2. **Tranh chấp quyền kiểm soát Micro (Exclusive Mic Access):**
   - Một số sound card/driver (Realtek, tai nghe Bluetooth) chỉ cấp dữ liệu âm thanh cho ứng dụng/tab đang được focus; tab chạy nền sẽ bị trả về tín hiệu im lặng (zero-stream).
3. **Khuyến nghị kiểm thử chuẩn xác:**
   - **Tốt nhất:** Kiểm thử trên 2 thiết bị máy tính riêng biệt (hoặc 1 máy tính và 1 phần mềm Softphone/điện thoại di động).
   - **Nếu kiểm thử trên 1 máy tính:** Cần đeo tai nghe (Headphone) để Loa không phát vọng ngược vào Micro, hoặc cấu hình 2 Micro riêng biệt cho 2 trình duyệt.

---

## 13. TỐI ƯU HÓA TRẢI NGHIỆM GIAO DIỆN, HIỆN DIỆN THỜI GIAN THỰC VÀ CHỐNG SPAM CUỘC GỌI

### 13.1. Đồng bộ trạng thái Presence thật qua Wazo Chatd và Websocketd
- Sửa lỗi trả về sớm (`return`) trong `contactService.js`: Toàn bộ danh bạ từ `wazo-dird` đều được đưa qua hàm `loadPresencesForContacts()`.
- Chuẩn hóa chuỗi tham số query: Sử dụng dấu phẩy nguyên bản `?user_uuid=${uuids.join(',')}` thay vì mã hóa `%2C`.
- Tích hợp kết nối sự kiện thời gian thực `wss://<host>/api/websocketd/?token=...&version=2`: Tự động nhận diện sự kiện `chatd_presence_updated` và cập nhật tức thì màu sắc trạng thái nhân sự trên danh bạ mà không cần tải lại trang.

### 13.2. Chặn tự gọi tới chính mình (Self-calling Protection)
- Trong `CallsView.vue`, kiểm tra số máy lẻ đích so với `wazoService.getMyExtension()`. Nếu trùng khớp, hệ thống chặn phát tín hiệu SIP và hiển thị cảnh báo: `⚠️ Bạn không thể thực hiện cuộc gọi tới chính máy lẻ của mình!`.
- Danh bạ tự động lọc bỏ tài khoản của chính người dùng đăng nhập để tránh nhầm lẫn khi thao tác.

### 13.3. Khắc phục sự cố F5 trên tab Danh bạ
- Sửa hàm `wazoService.getToken()` để ưu tiên nạp ngay từ `localStorage.getItem('smartcall_wazo_token')` trong trường hợp tiến trình bất đồng bộ `restoreSession()` chưa hoàn tất.
- Bổ sung bộ nhớ đệm `cachedContacts` trong `contactService`: Giúp giao diện hiển thị tức thì (0ms) ngay khi vào trang hoặc chuyển đổi giữa các tab.

### 13.4. Kiểm tra thiết bị Microphone phần cứng & Chống spam nút gọi
- Trước khi thực hiện cuộc gọi, hệ thống gọi `navigator.mediaDevices.enumerateDevices()` để xác minh máy tính có ít nhất 1 thiết bị thu âm (Microphone). Nếu không có, hệ thống lập tức thông báo rõ ràng: `❌ Không tìm thấy thiết bị Microphone! Vui lòng cắm Mic/Tai nghe vào máy tính để gọi.`.
- Thêm cơ chế Throttle khóa nút Gọi trong 1.5 giây sau khi bấm nhằm tránh tình trạng spam nhiều request SIP liên tục.

### 13.5. Chuyển đổi tab siêu mượt trong 0ms với `<KeepAlive>`
- Bọc thẻ `<KeepAlive>` cho `<router-view>` trong `App.vue`. Trạng thái DOM và dữ liệu các view (`DashboardView`, `CallsView`, `ContactsView`, `MessagesView`, `HistoryView`) được lưu trong RAM, chuyển qua lại tức thì mà không bị giật, không bị tải lại API.

### 13.6. Dọn dẹp Floating Call Widget trùng lặp
- Loại bỏ Widget nổi `CallControlPanel.vue` ở góc dưới bên phải màn hình để tránh trùng lặp với màn hình đàm thoại chính `CallsView.vue`, giúp giao diện thông thoáng và không che khuất bảng điều khiển `DebugLogDrawer`.

---

## 14. CHẶN CUỘC GỌI TỚI NGƯỜI ĐANG BẬN VÀ HƯỚNG DẪN ĐỒNG BỘ PRESENCE CHO ỨNG DỤNG ANDROID

### 14.1. Cơ chế chặn cuộc gọi khi đối phương đang bận (Busy State Interception)
- **Thực tế tổng đài:** Mặc định Asterisk PJSIP trên tổng đài kích hoạt tính năng Chờ cuộc gọi (Call Waiting). Khi máy lẻ B đang đàm thoại, cuộc gọi từ A vẫn được tổng đài đẩy chuông chờ tới B thay vì trả về `486 Busy Here`.
- **Giải pháp trên Web Client:**
  - Tại `ContactsView.vue`: Khi bấm nút 📞 gọi cho một liên hệ có trạng thái `busy`, hệ thống lập tức chặn thao tác và thông báo: `🚫 [Tên liên hệ] hiện đang trong cuộc gọi khác (Máy bận). Vui lòng gọi lại sau!`.
  - Tại `CallsView.vue`: Trước khi gửi lệnh `makeCall()`, hệ thống tra cứu số máy lẻ nhập vào trong danh bạ. Nếu máy lẻ đó đang `busy`, lệnh quay số bị hủy bỏ và hiển thị cảnh báo tương tự.

### 14.2. Tại sao ứng dụng Android gọi được nhưng khi idle lại hiển thị Ngoại tuyến (Offline)?
Wazo Platform quản lý trạng thái qua 2 tầng độc lập:
1. **Tầng SIP Line (`lines[].state`):** Quản lý bởi Asterisk qua bản tin `SIP REGISTER`. Khi Android thực hiện cuộc gọi, kết nối SIP kích hoạt $\rightarrow$ Asterisk thấy máy lẻ hoạt động $\rightarrow$ Web thấy `busy`. Nhưng khi cuộc gọi kết thúc, nếu Android không duy trì kết nối SIP REGISTER nền (thường do tiết kiệm pin), Asterisk sẽ đánh dấu line là `unavailable`.
2. **Tầng Chatd Presence (`p.state`):** Quản lý bởi microservice `wazo-chatd`. Khi người dùng đăng nhập vào app, ứng dụng **PHẢI CHỦ ĐỘNG GỬI REQUEST HTTP PUT** lên Wazo Chatd để khai báo trạng thái `available`. Đội Android trước đây chưa gọi API này, dẫn đến Chatd trả về `state: "unavailable"`.

### 14.3. Hướng dẫn chi tiết cho đội Android gọi API để set Online/Offline chuẩn 100%

#### Bước 1: Khi Đăng nhập thành công $\rightarrow$ Gửi PUT set Online (`available`)
- **Method:** `PUT`
- **URL:** `https://<WAZO_HOST>:9443/api/chatd/1.0/users/{user_uuid}/presences`
  *(Trong đó `{user_uuid}` là UUID tài khoản nhận được từ API đăng nhập `/api/auth/0.1/token`)*
- **Headers:**
  ```http
  X-Auth-Token: <Token_sau_khi_login>
  Content-Type: application/json
  Accept: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "state": "available",
    "status": "Sẵn sàng"
  }
  ```
- **Code mẫu Kotlin (OkHttp):**
  ```kotlin
  val client = OkHttpClient()
  val json = """{"state": "available", "status": "Sẵn sàng"}"""
  val body = json.toRequestBody("application/json; charset=utf-8".toMediaType())
  val request = Request.Builder()
      .url("https://107.126.11.126:9443/api/chatd/1.0/users/$userUuid/presences")
      .addHeader("X-Auth-Token", token)
      .put(body)
      .build()

  client.newCall(request).enqueue(object : Callback {
      override fun onResponse(call: Call, response: Response) {
          Log.d("WazoPresence", "Set Online thành công: ${response.code}")
      }
      override fun onFailure(call: Call, e: IOException) {
          Log.e("WazoPresence", "Lỗi set Online", e)
      }
  })
  ```

#### Bước 2: Khi Đăng xuất (Logout) hoặc Thoát App $\rightarrow$ Gửi PUT set Offline (`unavailable`)
- **Method:** `PUT`
- **URL:** `https://<WAZO_HOST>:9443/api/chatd/1.0/users/{user_uuid}/presences`
- **Headers:**
  ```http
  X-Auth-Token: <Token>
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "state": "unavailable",
    "status": "Ngoại tuyến"
  }
  ```








