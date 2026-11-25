# Tài liệu SmartCall Web

## Luồng hiện hành

| Cần tìm | Đọc ở đâu |
| --- | --- |
| Lần thao tác từ màn hình tới Vue, FastAPI hoặc Wazo | [Toàn bộ luồng SmartCall](HUONG_DAN_TOAN_BO_LUONG_SMARTCALL.md) |
| Xem sơ đồ tuần tự, tra tên hàm, endpoint và sự kiện | [Sơ đồ và bảng tra SmartCall](SO_DO_VA_TRA_CUU_SMARTCALL.md) |
| Hiểu cấu trúc frontend và tìm file theo tính năng | [Hướng dẫn frontend cho người mới](HUONG_DAN_FRONTEND_CHO_NGUOI_MOI.md) |
| Thay đổi kiến trúc, state hoặc ranh giới service | [Kiến trúc](refactor/ARCHITECTURE.md) và [hướng dẫn phát triển](refactor/DEVELOPMENT_GUIDE.md) |
| Chạy Single ID, cấu hình Wazo hoặc kiểm tra mapping SQLite | [Vận hành backend](../backend/doc/README.md) |
| Tiếp nhận công việc và xem phần còn lại | [Bàn giao và kế hoạch](../backend/doc/HANDOFF.md) |
| Kiểm chứng một thay đổi hoặc xem kết quả ở từng mốc | [Kiểm chứng](refactor/VERIFICATION.md) và [nhật ký refactor](refactor/PROGRESS.md) |
| Tra các API SmartCall đang dùng và thử bằng Postman | [API SmartCall và Postman](SMARTCALL_API_POSTMAN.md) |
| Đối chiếu các endpoint nền tảng Wazo | [Tham chiếu Wazo 26.10](WAZO_API_REFERENCE.md) |

Đọc [AGENTS.md](../AGENTS.md) trước khi sửa. Khi tài liệu ở mốc cũ khác với nhánh đang dùng, đối chiếu mã nguồn và quy tắc hiện hành.

## Lịch sử

`HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md` là nhật ký theo thời gian được lưu cục bộ. Các bước đầu có cấu trúc Web cũ, dữ liệu Mock và tên service trước refactor. Kiểm tra mốc của đoạn đang đọc trước khi áp dụng vào nhánh hiện tại.

[Các báo cáo đã gộp theo chủ đề](lich-su/README.md) tóm tắt kiến trúc trước refactor, các vòng audit và quyết định đã thay đổi. Các bản chi tiết vẫn có thể tra cứu ở đó.
