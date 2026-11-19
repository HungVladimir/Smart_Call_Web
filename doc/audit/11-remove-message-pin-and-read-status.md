# Bỏ ghim và trạng thái gửi/đọc tin nhắn

Ngày cập nhật: 19/11/2026. Thực hiện theo yêu cầu mới của người dùng; thay thế định hướng tiếp tục triển khai receipt/read cursor được nêu trong các báo cáo audit trước đó.

## Hành vi sau thay đổi

- Không còn nút ghim, thanh tin ghim hoặc thao tác bỏ ghim trong phòng chat.
- Không còn nhãn đang gửi/đã gửi/đã nhận/đã xem, dấu kiểm hoặc hộp thoại danh sách người đọc.
- Không còn bộ đếm chưa đọc trên phòng, Sidebar hoặc nút nhắn tin trong danh bạ.
- Tin nhắn hiển thị người gửi, nội dung và thời gian. Gửi thất bại vẫn có thông báo lỗi và cờ lỗi xử lý nội bộ; cờ này không phải xác nhận giao/đọc tin.

## Phần mã đã dọn

| File | Thay đổi |
|---|---|
| `src/views/MessagesView.vue` | Xóa giao diện, state, handler và CSS cho ghim/read; bỏ đánh dấu phòng đã đọc; giữ thông báo lỗi gửi. |
| `src/services/chatService.js` | Xóa `updatePinnedMessage`, dữ liệu pinned/readStatus/readers/unread, tính toán trạng thái đọc và activeRoomId vốn phục vụ bộ đếm chưa đọc. Gửi tin vẫn gọi API thật, kiểm tra HTTP và báo lỗi. |
| `src/components/layout/AppSidebar.vue` | Bỏ badge chưa đọc, việc tải phòng chỉ để đếm, debounce timer và listener phục vụ đếm. Điều hướng và sự kiện làm mới phòng vẫn hoạt động. |
| `src/services/contactService.js`, `src/views/CallsView.vue` | Bỏ trường unreadCount, badge và thao tác xóa bộ đếm khi chuyển sang chat. |
| `tests/regressions.test.cjs` | Bỏ assertion của tính năng readers đã xóa; giữ kiểm thử bảo toàn nhóm và lịch sử. |

Không yêu cầu API pin, receipt hoặc read cursor trong phạm vi sản phẩm hiện tại. Nội dung và lịch sử tin nhắn trên máy chủ không bị xóa hay chuyển đổi bởi đợt thay đổi này. Các yêu cầu quyền nhóm/membership còn lại trong báo cáo sửa lỗi vẫn độc lập với việc bỏ các tính năng này.

## Xác minh

- Tìm kiếm trong `src/` và bộ kiểm thử không còn định danh/logic của ghim tin, read status, readers, unread hoặc activeRoomId.
- `node --test tests/regressions.test.cjs`: **27/27 đạt**.
- `npm run build`: thành công, 324 modules; cảnh báo bundle lớn vẫn còn.
- Chưa kiểm tra giao nhận qua tổng đài thật. Chưa commit, push hoặc triển khai.
