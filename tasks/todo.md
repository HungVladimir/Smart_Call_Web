# Checklist triển khai danh bạ SmartCall

[Kế hoạch, hợp đồng API và ma trận tình huống](plan.md).

Nhánh thử nghiệm `codex/directory-search-pagination` đã có phần Web và test mô phỏng. Các mục liên quan Wazo thật, Android, tải 3.000 người và tab Online/Offline toàn cục vẫn cần nghiệm thu. Từ checklist này có thể chọn các ca thử trên tổng đài công ty trước.

## 1. Xác minh nguồn Dird và đo baseline

**Phụ thuộc** — Không. **Phạm vi** — Xác minh API bằng dữ liệu thử và token user, chưa đổi luồng đang chạy.

- [ ] Ghi phiên bản Wazo, phạm vi nguồn theo profile/tenant, quyền người dùng thường, schema mẫu đã ẩn dữ liệu và hai trang khác nhau. Xác định khóa UUID chính và sắp xếp ổn định.
- [ ] Thử người ngoài 1.000 mục đầu, tìm có dấu/không dấu, họ tên đầy đủ, số ngắn, số chính xác, số trùng, nhiều nguồn, phòng ban, yêu thích và lỗi ACL/timeout.
- [ ] Đo baseline request/payload khi vào Calls và Messages, lượng event presence, tra đích và reconnect. Chốt API trực tiếp hoặc phạm vi cần chỉ mục dùng chung.

## 2. Tra chính xác máy lẻ và bảo vệ các luồng thoại

**Phụ thuộc** — 1. **File dự kiến** — `contactService.js`, `callService.js`, `CallsView.vue`, `HistoryView.vue`, `phoneEvents.js`.

- [ ] Thay fallback tải lại danh bạ bằng tra theo máy lẻ. Phân biệt số không tồn tại, số trùng, lỗi tạm, thiếu quyền và request đã hủy.
- [ ] Dùng cùng đường tra cho gọi bằng số, thẻ liên hệ và gọi lại. Không dùng trạng thái cũ trong History để chặn trước. Thử số đổi chủ với CDR có và thiếu UUID.
- [ ] Gọi đến hiện ngay theo SIP, tra tên nền có guard phiên và cuộc gọi. Kiểm tra nghe/từ chối vẫn hoạt động khi API danh bạ chậm.

## 3. Tra UUID và chuyển luồng chat

**Phụ thuộc** — 1, 2. **File dự kiến** — `contactService.js`, `contactMapper.js`, `chatService.js`, `MessagesView.vue`.

- [ ] Xác minh UUID Wazo dùng trong Chatd. Tra theo lô cho phòng và thành viên chưa biết. Giữ metadata Chatd nếu danh bạ chưa trả tên.
- [ ] Thử mở chat từ kết quả tìm, từ số, từ History và chọn người tạo nhóm chat ở ngoài trang. Người offline nhắn được. Lỗi tra UUID có thông báo riêng.
- [ ] Mở danh sách phòng và nhận tin nhắn với cache danh bạ rỗng. Quan sát network để xác nhận không có tải toàn danh bạ hoặc một lượt tra cho từng tin.

## 4. Giữ quyền host và tra thành viên nhóm ngoài trang

**Phụ thuộc** — 2, 3. **File dự kiến** — `groupCallService.js`, `wazoEventHandler.js`, `callService.js`.

- [ ] B mời C khi cache của A rỗng. A xác minh người gửi, tra C rồi gọi với tư cách host. Kiểm tra Wazo/Android cũ, Web–Web và sự kiện đến sau khi cuộc gọi đổi.
- [ ] Xác minh máy lẻ của người gửi trong đúng phạm vi thay vì dựa vào một trang. Đọc lại quyền/vai trò và ID cuộc gọi sau khi chờ tra cứu, giữ chống lặp.
- [ ] Chạy lại test từ chối 1-1 và nhóm, người nghe thật, thành viên chuyển vào ConfBridge, host cúp và cleanup.

**Cổng A:** Chạy được gọi, gọi đến, gọi lại, mở chat và mời nhóm khi danh bạ chưa tải. Giao diện cũ vẫn chạy qua các đường tra mới.

## 5. Hiện Gần đây, Tìm kiếm và Duyệt danh bạ

**Phụ thuộc** — Cổng A. **File dự kiến** — `contactService.js`, `CallsView.vue`, `ContactsPanel.vue`, `useContactFilters.js`.

- [ ] Mở vào Gần đây mà không tải danh bạ. Giới hạn 10 mục, tách tài khoản, có nút xóa. Danh bạ chỉ tải khi bật Duyệt hoặc nhập từ khóa hợp lệ.
- [ ] Tìm sau debounce và kết thúc bộ gõ. Thử 30 mục/trang, trang ngắn/rỗng/trùng, xóa từ khóa, đổi tab nhanh, lỗi Xem thêm, logout khi đang tải và thử lại đúng trang.
- [ ] Mở Yêu thích theo nhu cầu. Giữ định danh nguồn và kết quả ACK khi bật/tắt yêu thích. Kiểm tra liên hệ mất quyền xem hoặc bị xóa.

## 6. Chọn nhiều người qua các trang

**Phụ thuộc** — 4, 5. **File dự kiến** — `ContactsPanel.vue`, `AddParticipantModal.vue`, `CallsView.vue`, `MessagesView.vue`.

- [ ] Chọn người ở trang 3 và trang 5 rồi đổi từ khóa, trang hoặc phòng ban. Giữ mục đã chọn, hỗ trợ bỏ từng người, loại trùng và bỏ chính mình.
- [ ] Kiểm tra đích ở lúc gửi lệnh và trả kết quả từng người khi có người đã đổi số, vừa bận, offline, DND hoặc không xác minh được. Giữ điều kiện tối thiểu của từng thao tác.
- [ ] Dọn lựa chọn đúng khi hủy, đóng modal, đã gửi lệnh hoặc phiên/cuộc gọi đổi. Gõ từ khóa hoặc chọn liên hệ không tự quay số.

## 7. Giới hạn presence và đồng bộ WebSocket

**Phụ thuộc** — 4, 5. **File dự kiến** — `contactService.js`, `createServices.js`, `wazoEventHandler.js`, các lối vào gọi/nhóm.

- [ ] Lấy trạng thái theo lô cho kết quả hiển thị, các mục cần kiểm tra trước thao tác và cuộc gọi hiện tại khi phù hợp. Kiểm tra không còn URL chứa danh sách toàn danh bạ.
- [ ] Xác minh event đến đúng UUID, REST muộn không đè event mới, mất mạng chuyển **Chưa rõ**, reconnect lấy lại trạng thái cần dùng. Không làm mất GROUP/GROUP_SYNC/ADD_REQ hoặc ảnh hưởng thu hồi phiên.
- [ ] Thử loading, cache hết hạn, chuyển tab, modal và reconnect. Tắt timer presence toàn danh bạ sau khi kiểm chứng đường mới.

**Cổng B:** Gần đây, tìm, chọn qua trang và ba luồng gọi/nhắn tin hoạt động với request giới hạn. Đo request so với baseline trước khi làm bộ lọc toàn cục.

## 8. Hoàn thiện các bộ lọc toàn cục đủ điều kiện

**Phụ thuộc** — 1 và Cổng B. **Phạm vi** — Tách một lượt triển khai cho mỗi nhóm bộ lọc.

- [ ] Phòng ban lọc đúng toàn bộ tập trước khi chia trang, chọn đúng bộ phận cùng tên gần giống, xử lý thiếu description. Không quét Confd từ từng browser.
- [ ] Chốt nghĩa Online, Offline, Chưa rõ và Có thể mời gọi. Kiểm tra lọc toàn cục, phân trang, cập nhật badge khi đổi trạng thái và làm mới danh sách.
- [ ] Nếu API trực tiếp chưa đủ, thử chỉ mục backend nhỏ theo kế hoạch. Xác minh phạm vi quyền cho Wazo trực tiếp và Single ID, cô lập tenant/profile, không dùng khả năng đọc của admin để mở rộng phạm vi cho người dùng.

## 9. Kiểm chứng, pilot và triển khai

**Phụ thuộc** — Cổng B và bước 8 đối với bộ lọc bật trong đợt này.

- [ ] Chạy `npm run check` và `npm --prefix frontend run format:check`. Nếu có thay backend, chạy unittest backend. Phân biệt lỗi định dạng đã có với file thay đổi. Giữ test theo quy tắc Git của dự án.
- [ ] Nghiệm thu trên Wazo test bằng Web và Android. Đo tới 3.000 phiên theo tải thực tế, ghi p95, lỗi và số request. So sánh với baseline và tiêu chí trong kế hoạch.
- [ ] Bật thử phạm vi nhỏ, xác minh phương án quay lui và cập nhật tài liệu dành cho người mới, PROGRESS và VERIFICATION khi triển khai.
