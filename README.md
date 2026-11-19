# SmartCall Web — bản refactor

Mã ứng dụng Web nằm trong **frontend/**. Đây là bản clone để refactor; bản gốc ở thư mục cùng cấp được giữ nguyên.

```text
Smart_Call_Web_Refactor/
├── frontend/       # Vue, WebRTC, các dịch vụ Wazo, kiểm thử
├── backend/        # Chuẩn bị API/IdP; chưa có server triển khai
├── doc/refactor/   # Kiến trúc, hướng dẫn, kiểm chứng, nhật ký
└── FileQuest/      # Tham chiếu Android; không tham gia build Web
```

## Bắt đầu

Dùng Node đáp ứng `frontend/package.json#engines`; phiên bản đã kiểm tra: **22.19.0**.

```powershell
npm --prefix frontend ci
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
# Điền host tổng đài thực tế vào frontend/.env
npm run dev
```

Không ghi đè `.env` đã có. File này được Git ignore. Vite đọc cấu hình từ `frontend/`; các biến `VITE_*` được đưa vào mã trình duyệt, vì vậy chỉ chứa cấu hình công khai, không chứa secret IdP.

```powershell
npm run check
npm --prefix frontend run format:check
```

Các lệnh dev/build/test/lint/check ở gốc chuyển tiếp tới frontend. Build tạo `frontend/dist/`. Không có package dependency riêng ở gốc; không cần chạy npm install tại gốc.

## Tài liệu

- [Sơ đồ kiến trúc và cây thư mục](doc/refactor/ARCHITECTURE.md)
- [Luồng đọc code, quy ước và cách mở rộng](doc/refactor/DEVELOPMENT_GUIDE.md)
- [Kết quả kiểm chứng và kiểm tra tích hợp](doc/refactor/VERIFICATION.md)
- [Nhật ký toàn bộ đợt refactor](doc/refactor/PROGRESS.md)
- [Prompt triển khai chi tiết](doc/refactor/IMPLEMENTATION_PROMPT.md)
- [Ranh giới backend và IdP](backend/README.md)

Các báo cáo trong `doc/audit/` và những bước triển khai cũ phản ánh phiên bản trước. Đường dẫn source hiện hành nằm dưới `frontend/src/`.

Ứng dụng tiếp tục dùng Wazo SDK/API hiện hành. Chưa triển khai SSO mới hoặc backend. Cần thử SIP, media, hội nghị và ghi âm trên tổng đài thật trước khi thay bản đang sử dụng.
