# Tổng kết kiểm toán SmartCall Web

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

Ngày 19/11/2026, Asia/Saigon. **Chưa đủ cơ sở xác nhận production readiness.** Có lỗi logic và cách ly phiên cần sửa trước khi dùng rộng với dữ liệu thật.

## Kết quả hợp nhất

| Severity | Số findings |
|---|---:|
| P0 Critical | 0 |
| P1 High | 3 |
| P2 Medium | 18 |
| P3 Low | 0 |
| Tổng | 21 |

20 CONFIRMED BUG bằng code evidence đủ kết luận và/hoặc VM cô lập; 1 DESIGN RISK (ARCH-001). Không cộng những edge-case chưa đủ bằng chứng vào số findings. Không có P0 được chốt không đồng nghĩa bảo đảm không có P0 ở hệ thống ngoài repo.

## Ba vấn đề mức cao

1. **SEC-002:** response của A có thể gán lại rooms sau reset/login B.
2. **BUG-001:** lưu tab audio có thể gửi cấu hình tắt DND/forwards chưa tải; HTTP lỗi vẫn success.
3. **SEC-001:** message content chứa SYSTEM tag có thể làm Web ẩn phòng/tin mà không kiểm tra quyền người gửi.

P2 đáng chú ý: ghi âm stop giả thành công, group merge thất bại không retry, group secondary/progress làm sai state/timer, conference response muộn sau hangup, playback/mic callbacks sống sau cleanup, chọn thiết bị không áp dụng vào call, máy lẻ fallback giả, read receipts suy đoán và chuyển nhóm chỉ25 tin.

## Sức khỏe dự án

| Tiêu chí | Đánh giá có căn cứ |
|---|---|
| Correctness | Có happy path và guard rõ, nhưng21 findings cho thấy state/error invariants chưa đủ |
| Reliability | Mạnh hơn snapshot cũ ở guard/detach/send failure; race cancellation và partial failure còn hở |
| Security | Có token-based API; ranh giới command/permission và cross-user state chưa an toàn; backend ACL chưa kiểm nghiệm |
| Data integrity | Success UI có thể khác server, receipt thiếu chứng cứ, migration chat không atomic |
| Architecture | Service phân domain và reactive call/record store là nền tảng tốt; singleton cycles và mixed ownership làm regression khó kiểm soát |
| Readability | Tên domain dễ hiểu và nhiều comment; comment “100%/triệt để” đôi khi vượt bằng chứng |
| Maintainability | File trung tâm lớn, raw SDK internals, error contracts không thống nhất |
| Scalability | Có lazy routes/single-flight; prefetch mọi room, polling, limits và list rendering cần đo tải |
| Testability | Logic kiểm tra được bằng VM nhưng chưa có application test/lint scripts; cần adapter/domain tests |
| Production readiness | Chưa xác lập; sửa P1 và xác minh integration/media/permission/IdP trước release |

Không chấm điểm1–10 vì không có kết quả E2E, server ACL, tải production hay benchmark đủ tin cậy.

## Hai vòng audit và phạm vi

Đã ghi Phase1 checkpoint, tự chuyển sang Phase2, phản biện mọi P1 và hợp nhất action plan. Code hiện tại được đối chiếu theo snapshot hash, không bê findings từ báo cáo Mock/cũ. Compile trong RAM10 SFC/11JS không có lỗi script/template; có VM dùng Vue thật với fetch/SDK/media fixtures để tái hiện state defects. Không chạy app/network/production DB, không npm build hoặc install.

Source runtime22 file có inventory/static review; phần style chủ yếu kiểm tra cấu trúc và khu vực liên quan, chưa visual QA. Tất cả Markdown dự án được inventory và phân loại; các journal/API catalog/reference lịch sử lớn đọc theo phần liên quan, không tuyên bố đọc100% từng dòng lưu trữ. Android là bản xuất tham chiếu, không audit APK/Gradle hoàn chỉnh. Full coverage tuyệt đối của toàn repository và hệ thống ngoài repo **chưa đạt**; xem09.

## Những edge cases nguy hiểm

- Logout/login B khi request A còn pending.
- Lưu cấu hình trước khi load xong hoặc khi một API fail.
- Hangup/đổi call trước response conference/recording.
- Secondary nghe trước primary, hoặc progress leg mới khi group đang connected.
- Đổi room khi send pending; cold load nhóm đã đóng.
- Đóng modal/rời route khi mic/audio đang tải.
- User thường gửi tag quản trị; retry/copy history thất bại nửa chừng.

## Quyết định phạm vi mới

SingleIdAuth và backend Python/SQLite/chat là planned, chờ dự án mẫu/contract. Không kết luận email quan sát từ cổng công ty tự đủ tạo Wazo token. Logout thiết bị từng nêu đã được người dùng yêu cầu tạm gác, không báo như sự cố live đã tái hiện.

## Việc cần làm đầu tiên

Theo thứ tự [07](07-prioritized-action-plan.md): session isolation → settings loaded/dirty/error → quyền command backend → cleanup dữ liệu phiên → ack/error contracts → call/media lifecycle → identity mapping → chat state/protocol → tests → refactor và backend mới.

## Danh mục báo cáo

- [00 — Checkpoint Phase1](00-phase1-notes.md)
- [01 — Hiểu dự án](01-project-understanding.md)
- [02 — Kiến trúc và code quality](02-architecture-code-quality.md)
- [03 — Findings chi tiết](03-bugs-and-logic-findings.md)
- [04 — Edge cases](04-missing-edge-cases.md)
- [05 — Security/performance](05-security-performance.md)
- [06 — Second pass](06-second-pass-review.md)
- [07 — Action plan](07-prioritized-action-plan.md)
- [09 — Coverage và verification](09-audit-coverage.md)
