# QUY TẮC PHÁT TRIỂN DỰ ÁN SMARTCALL WEB (GEMINI.MD)

Tài liệu này định nghĩa các nguyên tắc phát triển cốt lõi, quy chuẩn giao tiếp và nghiệp vụ hệ thống bắt buộc cho Antigravity AI Assistant trong toàn bộ vòng đời của dự án **SmartCall Web**.

---

## 1. NGUYÊN TẮC GIAO TIẾP VÀ DANH TÍNH (STRICT MANDATES)

1. **Tuyệt đối KHÔNG nhắc đến làm việc từ xa / ở nhà**:
   - Cấm hoàn toàn việc đề cập hoặc ám chỉ ngữ cảnh làm việc từ xa hay ở nhà (tuyệt đối không dùng các từ: *"ở nhà"*, *"nhà"*, *"về nhà"*, *"remote"*, v.v.).
2. **Tuyệt đối KHÔNG sử dụng tên riêng cá nhân**:
   - Tuyệt đối không nhắc tên bất kỳ cá nhân nào trong giao tiếp, tài liệu hay mã nguồn (không dùng *"anh hải"*, *"hải"*, *"anh dũng"*, *"dũng"*, *"hùng"*, v.v.).
   - Khi cần đối chiếu tài liệu/code, luôn dùng thuật ngữ: **"mã nguồn tham chiếu mẫu"**, **"dự án mẫu"**, hoặc **"tài liệu kỹ thuật tổng đài"**.
3. **Bảo toàn tài liệu kỹ thuật của người dùng**:
   - Không được tự ý xóa hoặc thay đổi nội dung các file trong thư mục `doc/`, `FileQuest/`. Các file này phục vụ công việc nội bộ và người dùng sẽ tự quản lý khi đẩy lên Git công ty.

---

## 2. PHÂN ĐỊNH 2 DỰ ÁN VÀ QUY TẮC ĐỒNG BỘ SONG SONG

### Dự án 1: `Smart_Call_Web` (`D:\Project\Smart_Call_Web`) - Nhánh chính công ty
- **Mục tiêu**: Mã nguồn chuẩn production đẩy lên Git công ty.
- **Tiêu chuẩn dữ liệu**:
  - **100% dữ liệu thật** từ API/WebSocket máy chủ Wazo.
  - Tuyệt đối **KHÔNG chứa dữ liệu mock / fake data / test mock**.
  - Khi mất kết nối hoặc máy chủ trả về rỗng, giao diện phải hiển thị danh sách trống hoặc trạng thái loading/thông báo lỗi, không được tự chèn dữ liệu giả lập.

### Dự án 2: `Smart_Call_Web_Mock` (`D:\Project\Smart_Call_Web_Mock`) - Bản thử nghiệm Offline
- **Mục tiêu**: Bản demo chạy thử nghiệm ngoại tuyến khi không kết nối máy chủ tổng đài.
- **Tiêu chuẩn dữ liệu**:
  - Duy trì các mảng dữ liệu mẫu: `MOCK_CONTACTS` (danh bạ), `MOCK_HISTORY` (lịch sử cuộc gọi), `INITIAL_MOCK_ROOMS` (tin nhắn), `quickContacts` (phím tắt).
  - Duy trì nút **"Chạy chế độ thử nghiệm Offline"** tại trang Login và tab **"🚩 Phân hệ & Mock Data"** trong modal Cài đặt.

### Quy tắc đồng bộ song song (Sync Rule):
- Mỗi khi người dùng yêu cầu sửa lỗi, tối ưu hoặc phát triển tính năng mới ở `Smart_Call_Web`, **AI phải chủ động cập nhật tương ứng sang `Smart_Call_Web_Mock`**.
- Khi đồng bộ, chỉ cập nhật phần logic tính năng, giữ nguyên các khối dữ liệu mock và cơ chế fallback offline sẵn có của `Smart_Call_Web_Mock`.

---

## 3. CÁC NGUYÊN TẮC NGHIỆP VỤ & TÍNH NĂNG ĐÃ THỐNG NHẤT

### 3.1. Nghiệp vụ Cuộc gọi & Bàn phím (`CallsView.vue`)
- **Chặn gọi máy bận (Busy / In-call)**:
  - Khi đối phương đang trong cuộc gọi (`busy`, `talking`, `holding`), hệ thống không được phép thực hiện cuộc gọi, phải hiển thị cảnh báo người này đang bận.
- **Chặn gọi máy ngoại tuyến (Offline)**:
  - Khi người dùng bấm gọi tới một số đang offline (từ màn hình Calls hoặc bàn phím số), không kích hoạt WebRTC, hiển thị cảnh báo:
    > `📴 Người này hiện đang ngoại tuyến, xin vui lòng gọi lại lúc khác!`
- **Cấm tự động nhấc máy giả lập (Timer 1.5s / 2.5s)**:
  - Tuyệt đối **không** khôi phục bộ đếm thời gian tự động nhấc máy giả lập (`mockAnswerTimer`). Trạng thái đàm thoại phải phụ thuộc hoàn toàn vào tín hiệu WebRTC thật từ máy chủ tổng đài.
- **Kiểm tra phần cứng Microphone**:
  - Trước khi gửi lệnh gọi, phải kiểm tra thiết bị `audioinput`. Nếu máy tính không có microphone, thông báo người dùng cắm mic/tai nghe và hủy lệnh gọi.

### 3.2. Nghiệp vụ Danh bạ (`ContactsView.vue`)
- **Gợi ý nhắn tin khi gọi số Offline**:
  - Khi bấm nút gọi một liên hệ đang offline trong danh bạ, hiển thị hộp thoại xác nhận:
    > `Máy lẻ [Tên - Ext] hiện đang ngoại tuyến. Bạn có muốn chuyển sang gửi tin nhắn không?`
  - Nếu người dùng đồng ý (`confirm = true`), tự động chuyển sang màn hình `/messages` và mở phòng chat 1-1 với người đó.

### 3.3. Logic Trạng thái Người dùng (Presence & Status)
- Áp dụng hàm `statusOf(uuid)` chuẩn 100% theo mã nguồn tham chiếu Wazo:
  1. Nếu `lines.state` có `talking` hoặc `holding` -> `busy` ("Đang gọi").
  2. Nếu `lines.state` có `ringing` hoặc `progressing` -> `ringing` ("Đang đổ chuông").
  3. Nếu `do_not_disturb = true` -> `dnd` ("Không làm phiền").
  4. Nếu các đường dây khả dụng (`lines` khác `unavailable`) hoặc `p.connected = true` -> Xét tiếp: nếu `state = away` -> `away` ("Vắng mặt"), ngược lại -> `online` ("Trực tuyến").
  5. Tất cả trường hợp còn lại -> `offline` ("Ngoại tuyến").
- **Không dùng cache trạng thái danh bạ cục bộ**: Luôn gọi API/WebSocket thời gian thực và hiển thị trạng thái loading nếu dữ liệu chưa tải xong.

### 3.4. Giao diện Sidebar & Huy hiệu số (Badges)
- **Sidebar**: Loại bỏ hoàn toàn số đếm đỏ trên tab *Danh bạ* và tab *Lịch sử cuộc gọi* (chỉ giữ huy hiệu số tin nhắn chưa đọc trên tab *Tin nhắn*).
- **Bộ lọc Lịch sử cuộc gọi**: Giữ nguyên số đếm trên 4 tab bộ lọc (`ALL`, `INCOMINGS`, `OUTGOINGS`, `MISSED`).

---

## 4. TIÊU CHUẨN KỸ THUẬT & KIỂM TRA

1. **Ngăn xếp công nghệ**:
   - Vue 3 (Composition API với `<script setup>`), Vite, Vue Router.
   - Wazo WebRTC SDK (`@wazo/sdk`) - thiết lập cuộc gọi thoại audio-only: `makeCall(extension, false)`.
2. **Kiểm tra sau chỉnh sửa (Verification)**:
   - Trước khi báo cáo hoàn thành nhiệm vụ, luôn chạy lệnh kiểm tra biên dịch:
     ```bash
     npm run build
     ```
   - Đảm bảo bản build không phát sinh lỗi cú pháp hay thiếu import.

---

## 5. CÁC TÀI LIỆU VÀ MÃ NGUỒN THAM CHIẾU BẮT BUỘC (REFERENCE KNOWLEDGE BASE)

Trước khi thực hiện hoặc chỉnh sửa bất kỳ logic gọi API, xác thực, WebSocket, Presence hoặc WebRTC nào, AI **phải luôn đối chiếu thật kỹ các tài liệu và mã nguồn tham chiếu sau** để đảm bảo gọi đúng phương thức, đúng endpoint, đúng header và không thêm thắt các tham số thừa làm sai lệch hoạt động của API:

1. **`FileQuest/codeAnhHai.txt`**:
   - Mã nguồn tham chiếu chuẩn về khởi tạo kết nối WebSocket, xử lý sự kiện Presence thời gian thực, lắng nghe cuộc gọi WebRTC và cập nhật trạng thái đường dây.
2. **`FileQuest/fileLoginAnhHai.txt`**:
   - Mã nguồn tham chiếu chuẩn về quy trình Đăng nhập (Authentication), cấp phát và quản lý Session Token, trích xuất hồ sơ User Profile từ Wazo SDK.
3. **`FileQuest/wazo_reference.js`**:
   - Tổng hợp mã nguồn tham chiếu toàn diện về tích hợp Wazo SDK, WebRTC phone, khởi tạo cuộc gọi thoại audio-only, xử lý media stream.
4. **`FileQuest/dev_guide.md`**:
   - Hướng dẫn phát triển hệ thống SmartCall, cấu trúc API, đặc tả các phân hệ và luồng nghiệp vụ tổng đài.
5. **`FileQuest/wazo_api_reference.md`** (và `doc/WAZO_API_REFERENCE.md`):
   - Đặc tả chi tiết toàn bộ các API REST của máy chủ tổng đài Wazo (Auth, Dird, Chatd, Call-logd, Calld) cùng định dạng request/response chuẩn.

> ⚠️ **Quy tắc bất biến**: Mọi xử lý liên quan đến API Wazo phải bám sát tuyệt đối 5 tài liệu/mã nguồn tham chiếu trên, tránh tự ý thêm tham số hay thay đổi định dạng gây lỗi kết nối hoặc vi phạm preflight CORS.


