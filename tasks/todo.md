# Checklist SmartCall sau commit 81de05f

Tiêu chí chi tiết trong [kế hoạch](plan.md).

- [x] Đã push tra máy lẻ ngoài trang, xác minh Chatd mới trước cuộc gọi 1–1 và chấm xanh/xám.
- [x] Cô lập cache Dird/Confd/Chatd, xác minh với hai tài khoản khác ACL trên bộ mô phỏng.
- [ ] Chốt và thực hiện phương án credential với chủ repo và chủ dịch vụ.
- [x] Xác minh mới máy lẻ → UUID tại thời điểm gọi, giữ kiểm tra Chatd.
- [x] Xử lý nhánh đầu bị chặn trước SIP hoặc nhận sự kiện kết thúc sớm, cập nhật lựa chọn còn lại.
- [x] Nạp presence theo trang trong modal mời, xác minh lại lựa chọn xuyên trang.
- [x] Phân biệt bộ phận thiếu quyền/rỗng/lỗi nguồn, xóa nhãn cũ khi đã xác nhận.
- [x] Làm mới có giới hạn và đọc lại trang sau khi cập nhật cache danh mục.
- [x] Đồng bộ kết quả lọc online/offline, xử lý trang cuối và độ dài URL upstream.
- [x] Dọn các điểm UI, bộ kiểm thử cục bộ, Prettier và chỉnh backend dùng địa chỉ IPv4 của proxy dev.
- [ ] Nghiệm thu Wazo/IdP với tài khoản thường, nhiều quyền, Web và Android.
- [ ] Đo tải đồng thời đến mục tiêu trên môi trường thử và ghi kết quả bàn giao.
