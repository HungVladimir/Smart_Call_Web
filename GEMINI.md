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
- **Cấm tự động nhấc máy giả lập trên nhánh chính (Timer 1.5s / 2.5s)**:
  - Tuyệt đối **không** khôi phục bộ đếm thời gian tự động nhấc máy giả lập (`mockAnswerTimer`) trên nhánh chính `Smart_Call_Web`. Trạng thái đàm thoại phải phụ thuộc hoàn toàn vào tín hiệu WebRTC thật từ máy chủ tổng đài. (Chỉ duy nhất bản `Smart_Call_Web_Mock` được hỗ trợ tính năng này để kiểm thử ngoại tuyến).
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

---

## 6. QUY TRÌNH TƯƠNG TÁC VÀ PHÊ DUYỆT TRƯỚC KHI CODE (REVIEW-FIRST WORKFLOW)

1. **Giải thích chi tiết trước khi code (Review First)**:
   - Đối với mọi câu hỏi, yêu cầu tính năng hoặc yêu cầu sửa lỗi từ người dùng, AI **CHỈ ĐƯỢC GIẢI THÍCH CHI TIẾT** phương án kỹ thuật, phân tích luồng logic sẽ sửa đổi và danh sách các file liên quan để người dùng review trước.
   - **TUYỆT ĐỐI KHÔNG** tự ý sửa file, viết code hay commit/push mã nguồn khi người dùng chưa xác nhận đồng ý.
2. **Chỉ code khi người dùng xác nhận "OK"**:
   - Chỉ khi người dùng phản hồi xác nhận đồng ý (ví dụ: *"OK"*, *"Đồng ý"*, *"Triển khai đi"*, v.v.), AI mới bắt đầu tiến hành chỉnh sửa mã nguồn trên các file tương ứng.
3. **Cập nhật tài liệu triển khai và push Git**:
   - Sau khi hoàn thành việc chỉnh sửa code và chạy kiểm tra `npm run build` thành công, AI phải cập nhật đầy đủ nội dung kỹ thuật vào tài liệu `doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md`.
   - Tiến hành commit và push lên Git công ty (`origin/main`) để người dùng kiểm tra và theo dõi tiến độ.

---

## 7. NGUYÊN TẮC KIỂM SOÁT CHẤT LƯỢNG TOÀN DIỆN & TRUY VẾT VÒNG ĐỜI TRẠNG THÁI (STATE LIFECYCLE & QUALITY ASSURANCE)

Để triệt tiêu hoàn toàn các lỗi sơ đẳng, cấm tuyệt đối tư duy "sửa chắp vá cục bộ" (local patch). Trong mọi yêu cầu phát triển hoặc sửa lỗi trên toàn bộ hệ thống (Cuộc gọi, Tin nhắn, Danh bạ, Hiện diện Presence, Xác thực Token, v.v.), AI phải tuân thủ nghiêm ngặt 5 nguyên tắc sau:

### 7.1. Nguyên tắc "Truy vết khép kín toàn vòng đời" (Full Lifecycle Closed-Loop Trace)
Mọi biến cờ trạng thái (flag), phiên kết nối (session), bộ đếm thời gian (timer), hoặc sự kiện (event listener) khi được tạo ra bắt buộc phải được truy vết đủ 3 điểm:
1. **Khởi tạo (Trigger/Init):** Điều kiện nào bật cờ/kích hoạt tài nguyên?
2. **Chuyển tiếp (Transition):** Khi người dùng chuyển tab (KeepAlive), chuyển route, hoặc thu nhỏ giao diện thì trạng thái được chuyển giao ra sao?
3. **Giải phóng (Cleanup/Termination):** Khi tác vụ kết thúc (thành công, thất bại, người dùng bấm hủy/cúp máy, mất kết nối mạng, hoặc unmount component), cờ trạng thái PHẢI ĐƯỢC GIẢI PHÓNG VỀ SẠCH (`idle` / `false` / `null`). Cấm tuyệt đối để sót cờ bị kẹt (stuck state) làm sai lệch các lượt thao tác tiếp theo.

### 7.2. Nguyên tắc "Nguồn chân lý duy nhất" (Single Source of Truth - SSOT)
- Cấm tạo các biến trạng thái trùng lặp độc lập ở nhiều component khác nhau (ví dụ: cấm tạo cờ cuộc gọi riêng ở `App.vue`, `CallsView.vue` và `wazo.js`).
- Mọi phân hệ cốt lõi phải có một Service / Composable quản lý trạng thái tập trung. Các component UI chỉ được đăng ký lắng nghe (react/computed) và phát lệnh điều khiển qua Service đó, đảm bảo toàn bộ ứng dụng luôn đồng bộ 100% về cùng một trạng thái.

### 7.3. Nguyên tắc "Chuẩn hóa dữ liệu ngay tại cổng vào" (Input Data Normalizer)
- Dữ liệu đến từ bên ngoài (Wazo REST API, Chatd WebSocket, Presence WebSocket, WebRTC SDK, hoặc các sự kiện giả lập Test) phải được chuẩn hóa qua một hàm duy nhất (Normalizer) trước khi đẩy vào State/UI.
- Cấm để UI tự đoán trường dữ liệu rải rác (ví dụ: nơi đọc `item.number`, nơi đọc `item.extension`, nơi đọc `item.displayName`, nơi đọc `item.name`).

### 7.4. Checklist tự kiểm tra 4 kịch bản biên (Cross-Scenario Self-Verification)
Trước khi báo cáo giải pháp cho người dùng, AI phải tự kiểm tra code qua đủ 4 kịch bản:
1. **Happy Path (Thành công):** Luồng chính chạy trơn tru từ đầu đến cuối.
2. **Cancellation Path (Hủy/Ngắt giữa chừng):** Người dùng cúp máy, bấm Hủy, bấm Đóng modal, hoặc đổi ý chuyển trang giữa chừng -> Hệ thống có dọn dẹp sạch tài nguyên và trả về trạng thái sẵn sàng không?
3. **Failure/Network Path (Sự cố):** Máy tính không có mic/loa, mạng ngắt, API trả 4xx/5xx -> Có thông báo lỗi dễ hiểu và đưa giao diện về trạng thái an toàn không (không được để đơ/treo UI)?
4. **Collision Path (Xung đột đồng thời):** Thao tác đè (bấm nút liên tục 2 lần, cuộc gọi thứ 2 gọi đến khi đang đàm thoại, 2 tin nhắn gửi cùng lúc) -> Đã có cơ chế khóa (throttle / anti-collision / queue) bảo vệ chưa?

### 7.5. Sửa lỗi từ gốc rễ (Root-Cause Architecture Fix)
- Khi phát hiện lỗi, phải truy nguyên nhân về tận gốc rễ luồng dữ liệu (Tầng Service / Store / WebSocket). Cấm viết thêm các câu lệnh `if/else` chữa cháy tạm thời tại tầng View làm rối mã nguồn và phát sinh lỗi dây chuyền.




