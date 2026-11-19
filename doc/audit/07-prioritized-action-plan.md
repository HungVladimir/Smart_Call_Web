# Kế hoạch ưu tiên khắc phục

[Executive summary](08-executive-summary.md) · [Findings](03-bugs-and-logic-findings.md) · [Edge-case tests](04-missing-edge-cases.md).

Chỉ đề xuất, chưa sửa source. Effort S/M/L là ước lượng tương đối, chưa phải cam kết ngày công: S=cục bộ; M=xuyên module; L=cần backend/hai nền tảng. Cần người phụ trách định giá lại sau khi chốt API và test environment.

## Fix immediately — trước thử nghiệm rộng với dữ liệu thật

| Thứ tự | Finding | Thay đổi cần đạt | Impact / effort / regression risk |
|---|---|---|---|
| 1 | SEC-002 | User/session epoch + discard stale results; reset/abort/caches theo owner | Bảo vệ dữ liệu giữa tài khoản; M; cao vì nhiều callers |
| 2 | BUG-001 | Loaded/dirty guards, save từng nhóm và kiểm tra HTTP | Tránh cấu hình thoại bị thay ngoài ý định; M; vừa |
| 3 | SEC-001 | Không coi text thường là command admin; quyền/event có kiểm soát phía server | Bảo vệ room/message UI integrity; L nếu cần API mới; cao do tương thích Web–Android |
| 4 | SEC-003 | Clear logs/revoke audio URLs tại session boundary | Riêng tư thiết bị dùng chung; S/M; vừa |

SEC-001 không giải quyết triệt để bằng cách ẩn nút admin hoặc kiểm tra localStorage role. Nếu API hiện tại không có room mutation chuẩn, cần hạn chế tính năng command hoặc triển khai backend theo contract đã phê duyệt.

## Fix before production

| Nhóm | Findings | Điều kiện chấp nhận | Effort / risk |
|---|---|---|---|
| Lifecycle call | BUG-002/003/005 | Answer theo ack/session; group clock/state theo leg; late create không hồi sinh state | M/L, cao; cần SIP/media staging |
| HTTP consistency | BUG-004/006/007 | Commit khi ack; false/403/500/network có rollback/resync/retry | M, vừa/cao |
| Devices/media | BUG-009/011/015 | Đúng mic/loa, chỉ latest audio play, stream stale được stop | M, cần browser/device matrix |
| Identity | BUG-008 | Không fallback máy lẻ giả; đồng bộ UUID/ext nguồn xác minh | S/M, ảnh hưởng self-call/CDR/group |

Không dùng build thành công làm gate duy nhất. Gate phải gồm failure/cancel/concurrency tests và kiểm thử Wazo staging với quyền user thường.

## Next sprint

- BUG-010/012/013/014: reactive ownership, shared missed predicate, giữ selection theo hành động user mới nhất, truyền room closed metadata qua cold load.
- LOGIC-001: bỏ read receipts suy đoán; thể hiện unknown tới khi có ack/read cursor.
- LOGIC-002: chốt membership/history policy, tối thiểu thành viên và partial migration; không hứa chuyển toàn bộ nếu chỉ25.
- Thêm regression tests theo các fixtures đã reproduce trước khi sửa. Không thêm test chỉ mirror implementation.
- Bổ sung lint/static rules phù hợp và test runner theo phê duyệt riêng; audit này không cài package.

## Long-term refactoring

1. ARCH-001: state/session/call/chat ownership độc lập với SDK; facade giữ tương thích trong từng bước nhỏ.
2. Chuẩn hóa API Result/error và normalizer, ID/timezone từ boundary; giảm fetch rải rác trong UI.
3. Backend Python/SQLite/SingleIdAuth: đợi dự án mẫu cho auth adapter; chốt đội quản trị Wazo–IdP và provisioning.
4. REST/event schema dùng chung Web–Android; server kiểm tra membership/admin, durable messages/read positions.
5. Chiến lược chuyển từ Chatd cũ: không dual-write không kiểm soát; mapping ID, dedup/replay và rollback rõ.
6. Đánh giá SQLite bằng tải mục tiêu, filesystem topology, transaction và restore backup; không tự khẳng định đủ production.

## Optional improvements sau đo đạc

- Bounded concurrency/lazy prefetch message, dedup contacts theo session.
- Virtual list khi profiling chỉ ra DOM cost; không thêm chỉ vì danh sách có thể lớn.
- Bundle split SDK khi đo cho thấy cải thiện đáng kể login; giữ route lazy hiện có.
- Tách UI components Calls/Messages theo domain sau tests; không chạy rewrite/style cleanup diện rộng.
- Tài liệu snapshot hiện hành và nhật ký lịch sử tách rõ; chỉ cập nhật file cũ khi có quyền, audit chỉ tạo mới.

## Thứ tự fix an toàn

Tạo regression tests → sửa session boundary → settings/error contract → call/media state machine → chat permission/protocol → membership/history migration → refactor có guard. Chọn một flow end-to-end mỗi lần, kiểm tra cùng Web/Android trước khi đổi protocol. Không phát hành command/schema mới trước khi client cũ có chiến lược tương thích.

## Top 10 hành động

1. Chặn response user cũ tại mọi singleton commit.
2. Chặn settings write cho dữ liệu chưa load/dirty.
3. Đặt quyền room/message mutation ở backend.
4. Xóa logs/blob URLs khi kết thúc phiên.
5. Chuẩn hóa ack/error cho recording và chat commands.
6. Sửa answer/group state theo session/leg.
7. Hủy/ignore media request cũ và áp dụng device config thật.
8. Loại fallback máy lẻ thử nghiệm.
9. Giữ room selection/closed metadata, dùng receipt thật.
10. Xây regression suite và API contract trước tích hợp IdP/backend mới.
