# Ghi nhận Phase 1 — Audit SmartCall Web

Ngày 19/11/2026. Phạm vi ghi: chỉ file Markdown mới trong `doc/audit/`. Đây là checkpoint trước vòng phản biện; kết luận cuối xem [03](03-bugs-and-logic-findings.md), [06](06-second-pass-review.md), [08](08-executive-summary.md) và [09](09-audit-coverage.md).

## Snapshot và hiểu hệ thống

Đã lập inventory và hash nội dung các file nguồn/tài liệu/cấu hình. Vue 3 + JavaScript + Composition API, Vite, Vue Router, Wazo SDK; không Pinia/Vuex. Có 22 file trong src, gồm 10 Vue SFC, 11 JS và 1 CSS. Không có backend SmartCall Python/SQLite hiện thực trong source ứng dụng. Backend mới và SingleIdAuth là định hướng đang chờ dự án mẫu, không tính là feature hiện hành bị lỗi.

Đã truy vết auth/restore, SIP, gọi đơn/nhóm, presence/danh bạ/favorites, chat, đổi thành viên, CDR/ghi âm/phát lại, settings và KeepAlive. Tài liệu hiện hành cần đọc cùng nhật ký bước 75–76; báo cáo Mock/roadmap cũ không phải bằng chứng hành vi hiện tại. Metadata API được tra cứu theo các service ứng dụng sử dụng. Các tài liệu lịch sử lớn được đọc theo phần nghiệp vụ liên quan; không khẳng định mọi dòng tài liệu lưu trữ đã được đọc.

## Giả thuyết cần phản biện

| Nhóm | Bằng chứng ban đầu | Mức ưu tiên dự kiến |
|---|---|---|
| Settings ghi đè dịch vụ chưa tải | State mặc định false/rỗng; save gửi DND và ba forward dù đang tab audio | P1 |
| Chat response vượt qua reset | Request dùng token cũ, reset chỉ xóa state/promise; response vẫn gán rooms | P1 |
| Tag chat có thể điều khiển UI ngoài quyền admin | Parser ROOM_CLOSED/MSG_DELETED/ROOM_RENAME tin content, không xác minh role | P1 |
| Accept đặt connected quá sớm | Không await kết quả SDK, tạo connected/startTime ngay | P1 dự kiến, cần xét failure event |
| Sync conference hoàn tất sau hangup | Await create rồi gán ID, không kiểm tra lifecycle generation | P1 dự kiến |
| Merge nhánh thất bại không retry | mergedCallIds.add trước await và bỏ qua false | P2 |
| Secondary nghe trước / progress | Aggregate connected nhưng startTime null/timer chưa chạy; progress lại đặt ringing | P2 |
| Recording dừng giả thành công | Xóa state trước request, HTTP 500 vẫn trả object thành công | P2 |
| Chat command lỗi vẫn thành công | sendMessage trả message có sendFailed; caller delete/rename không kiểm tra | P2 |
| Vue computed đọc field thường | _isDialing và secondaryCallSessions không reactive | P2 |
| Cold load nhóm đã đóng | Parser loại tombstone rồi getRooms không nhận metadata isClosed | P2 |
| UI chat response chọn lại phòng cũ | Sau await luôn currentRoom=targetId | P2 |

## Kiểm tra đã chạy

- Compile/parse trong RAM: 10 Vue SFC, 11 JS, 11 style blocks được parse cùng SFC; không có lỗi script/template. Không compile hay benchmark toàn bộ CSS.
- Harness VM dùng dữ liệu tổng hợp, fetch/SDK/storage/timer thay bằng stub RAM: xác nhận các nhánh settings, stale rooms, tag close, accept premature, merge false, secondary state, recording false success, delete false success và computed stale.
- Bổ sung kiểm tra conference response muộn, cold tombstone, badge missed và chuyển phòng khi send pending.
- Có một lượt harness thiếu fixture `formatMessageDateTime`, đã sửa fixture trong bộ nhớ và chạy lại; không coi lượt lỗi harness là lỗi sản phẩm.
- Không npm build/install/format, không gọi Wazo/IdP, không test production.

## Kết luận cũ đã có bằng chứng bác bỏ

- Chat gửi HTTP 500 hiện thành `Lỗi gửi`/sendFailed, không còn `Đã gửi` ở chính sendMessage.
- getRoomMessages hiện không còn gán admin từ tin đầu tiên.
- Finalize khác ID giữ activeCall khi active session có ID.
- disconnect/logout có detachListeners; cần xem tác dụng phụ removeAllListeners, không lặp lại nhận định tích tụ listener cũ.
- CDR hiện thuần RAM, không còn lưu lịch sử qua localStorage.

## Giới hạn trước vòng hai

Chưa kiểm thử media/SIP thật, server ACL/event delivery, Android APK, tải dữ liệu lớn và IdP. Các lỗi cục bộ được xác minh bằng harness không tương đương E2E. Theo xác nhận trước đó của người dùng, không tiếp tục quy kết case logout mất mạng là lỗi đang tái hiện; chỉ kiểm tra reset/session như phạm vi audit mới.

Tiếp theo tự động thực hiện vòng hai: mở lại mọi P1, tìm guard/caller phản bác, kiểm tra ngữ cảnh SDK và mức độ reachable, rồi xuất chín báo cáo hợp nhất.
