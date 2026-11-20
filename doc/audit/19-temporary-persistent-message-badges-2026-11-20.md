# Lưu tạm bộ đếm tin nhắn qua F5/đăng nhập lại — 20/11/2026

## Yêu cầu và kết quả đối chiếu code cũ

Người dùng yêu cầu kiểm tra cách trước đây giữ được số tin nhắn và tạm áp dụng lại cơ chế đó.

- `95ceead`: `saveRooms()` ghi toàn bộ `this.rooms` vào `localStorage` với khóa `smartcall_chat_rooms_<user_uuid>`. `loadSavedRooms()` đọc lại danh sách. Trường `room.unread` được giữ cùng dữ liệu phòng, nên bộ đếm tồn tại qua tải lại.
- `9d67747`: `loadSavedRooms()` đã trả mảng rỗng, `saveRooms()` chỉ sắp xếp/phát event. Trường `room.unread` lúc này chỉ còn trong RAM.
- `86b2011`: khôi phục badge bằng state reactive và UUID khử trùng, nhưng chưa lưu qua tải lại. Người dùng yêu cầu bổ sung lưu tạm trong lượt này.

Không kết luận `9d67747` từng lưu bộ đếm bền vững: Git cho thấy cơ chế đó thuộc phiên bản cũ hơn.

## Cách áp dụng

Dùng lại **localStorage**, nhưng chỉ lưu metadata cần cho bộ đếm. Không đưa toàn bộ nội dung phòng/tin nhắn trở lại localStorage.

Khóa:

```text
smartcall_unread_v1:<máy chủ được encode>:<UUID tài khoản được encode>
```

Giá trị gồm phiên bản schema và các phòng; mỗi phòng có:

- `unread`: UUID tin đến chưa mở, số hiển thị là kích thước tập này.
- `seen`: tối đa 1000 UUID gần nhất để chống đếm lại sau reload.

Toàn bộ UUID chưa mở vẫn được giữ để không giảm số khi vượt 1000 tin; giới hạn 1000 chỉ áp dụng danh sách ID gần nhất dùng khử trùng. Tin đã mở nằm ngoài cửa sổ ID này chưa được bảo đảm khử trùng nếu server phát lại rất lâu sau đó.

Không lưu nội dung, tên phòng, alias, danh bạ, token hoặc mật khẩu trong cache này. Không nhập lại cache phòng cũ làm nguồn dữ liệu nghiệp vụ.

## Vòng đời

1. Sidebar được mount sau login/F5 sẽ khôi phục bộ đếm theo tài khoản/máy chủ.
2. Nếu có số đã lưu, tải lại metadata phòng từ Wazo; tổng số chỉ tính trên các phòng server đang cho hiển thị. Không dựng phòng giả từ cache.
3. Nếu không có số đã lưu, không tải toàn bộ phòng chỉ để khởi tạo một badge bằng 0.
4. Khi có tin mới, tăng tập UUID và ghi cache; event trùng không tăng lại.
5. Mở đúng hội thoại ở cửa sổ đang hiển thị sẽ xóa tập chưa mở của phòng đó và ghi lại cache. Giữ các UUID đã thấy để tránh báo lại ngay sau reload.
6. Xóa tin hoặc đóng phòng cũng cập nhật cache.
7. Logout/reset chỉ dọn RAM, giữ cache đúng tài khoản. Tài khoản khác hoặc tổng đài khác dùng khóa khác, không đọc nhầm số.
8. Nếu feature Tin nhắn được bật sau khi Sidebar đã mount, thực hiện khôi phục tương tự.

Không nạp cache trong constructor ChatService vì còn vòng import với wazoService. Các đường getRooms, nhận event và chọn phòng bảo đảm xác định đúng owner trước khi thao tác bộ đếm.

Cache JSON hỏng hoặc storage bị chặn/đầy không được làm hỏng nhận tin. Khi không ghi được, vẫn đếm trong RAM và ghi cảnh báo; không khẳng định đã lưu bền vững.

## Phạm vi của giải pháp tạm

- Giữ số trên **cùng trình duyệt, cùng origin của Web, cùng máy chủ và tài khoản**.
- Không đồng bộ read cursor giữa Chrome/Edge, máy tính khác hoặc Mobile.
- Không tự tính tin đã tới khi Web tắt hoặc mất kết nối nếu server không phát lại event. Đây không phải API unread chuẩn từ server.
- Không khôi phục ghim, đã gửi/đã nhận/đã xem hoặc read receipt gửi cho đối phương.
- Ngoại lệ lưu localStorage này đã được người dùng yêu cầu, chỉ áp dụng bộ đếm. Khi backend/server có read cursor, chuyển sang dùng server làm nguồn dữ liệu.

## Kiểm chứng

- `npm test`: **98/98 đạt**, thêm 5 ca về lưu tạm sau bộ 93 ca trước.
- `npm run build`: thành công, 324 module; còn cảnh báo chunk chính lớn hơn 500 kB.
- Khởi tạo service mới với cùng cache giữ số; event đã nhận không bị tính lại.
- Mở phòng rồi tải lại giữ số bằng 0; cache không chứa text/token.
- Reset giữ cache A; đăng nhập B hoặc đổi máy chủ không dùng chung số; quay lại A nạp được số cũ.
- Sidebar tự khôi phục và tải metadata thật mà không cần mở trang Tin nhắn.
- Cache hỏng/quota lỗi không làm mất khả năng nhận và đếm trong RAM.
- Xóa tin/đóng phòng cập nhật cả dữ liệu đã lưu.
- Kiểm thử tổng đài/điện thoại thật vẫn chưa thực hiện trong môi trường này.

File chính: `src/services/chatService.js`, `src/components/layout/AppSidebar.vue`, `tests/regressions.test.cjs`. Không thay mã Android hoặc bản refactor.
