# Security, data integrity và performance

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

[Findings](03-bugs-and-logic-findings.md) · [Vòng hai](06-second-pass-review.md) · [Coverage](09-audit-coverage.md).

## Security đã có bằng chứng

| ID | Severity | Boundary và bằng chứng | Giới hạn |
|---|---|---|---|
| SEC-001 | P1 | Chat message content được parser coi là lệnh admin, không xác minh sender role | VM xác nhận tác dụng trên client; chưa chứng minh server cho phép xóa dữ liệu vật lý |
| SEC-002 | P1 | Request A pending vượt reset rồi ghi singleton khi B login | VM xác nhận rooms; ACL server có thể đúng nhưng response đã cấp cho A vẫn phải bị loại phía client |
| SEC-003 | P2 | Debug drawer/log content và blob cache sống qua logout | Bằng chứng call graph; chưa truy xuất media thật |

Frontend route guard chỉ chặn UI. Không có backend application trong repo để audit RBAC/IDOR/cross-tenant thực tế. Các API Wazo /users/me và X-Auth-Token là boundaries đúng hướng; quyền đang cấp cho token thật chưa được kiểm chứng.

Không thấy v-html/innerHTML/eval/new Function trong application search. Vue interpolation giúp escape text trong các chỗ đã xem; điều này không loại bỏ command injection qua parser riêng SEC-001. Không tuyên bố toàn hệ thống không có XSS.

Token/refresh token nằm localStorage, SDK được gán window.Wazo và logger window.smartcallLogger. Đây là exposure surface trong cùng origin, không tự đủ chứng minh exploit XSS hay credential leak. Không đọc .env bí mật, không xuất token/cookie/PII vào report. Không chạy dependency vulnerability network scan; chưa kết luận không có CVE.

## Tính toàn vẹn dữ liệu

- BUG-001: settings tạo write ngoài ý định và bỏ qua response.
- BUG-006/007: UI success không tương đương server ack.
- BUG-003/004: conference state commit trước/ngoài lifecycle tương ứng.
- BUG-014: trạng thái room bị mất qua cold mapping.
- LOGIC-001: receipt được suy đoán, không có bằng chứng người đọc.
- LOGIC-002: chuyển phòng giới hạn25 và không atomic. Room cũ có thể còn dữ liệu server, nên mô tả chính xác là mất khả năng tiếp cận qua UI hiện hành, chưa chứng minh xóa vật lý.
- CDR merge dùng ext+chênh lệch120s tại historyService.js:200; có nguy cơ ghép nhầm các call gần nhau. Cần regression ID/direction/start/duration trước khi chốt bug riêng.
- Pause/resume ghi âm recordService.js:262/281 không kiểm tra res.ok; cùng dạng contract HTTP cần mở rộng regression khi sửa BUG-006.

## Tài nguyên và riêng tư media

BUG-015 cho thấy cleanup đồng bộ không hủy được getUserMedia pending. BUG-011 cho thấy audio stale response vẫn play sau selection mới. Cache URL không bounded theo session cleanup (SEC-003); không có đo đạc để gọi là memory exhaustion. Đề xuất owner/session epoch và cleanup idempotent cho stream, URL, timer và async continuation.

## Performance: dữ kiện code, không phải benchmark

| Dữ kiện | Hệ quả/rủi ro | Cách đo/ưu tiên |
|---|---|---|
| chatService.js:472 prefetch mọi room rỗng, Promise.allSettled không giới hạn | R room gây R request message khi cold; thêm load directory nếu cần | Đo R=10/100/1000 trên staging, số request/latency/memory; lazy/bounded fetch |
| Calls mounted+activated đều loadContacts, focus/sidebar refresh thêm trigger | Có thể request directory lặp | Đếm network request cho mount/đổi tab/focus; single-flight theo session |
| Contact polling10s, auth heartbeat5s | Tải định kỳ tăng theo client | Đo requests/client và server cost; jitter/backoff theo trạng thái kết nối |
| Contacts limit1000, history UI100, messages50 | Hiển thị tập giới hạn, filter ngày/tìm kiếm chỉ trên phần đã tải | Pagination/total/empty states rõ; không giả định đã tải toàn bộ |
| Large lists render v-for không virtualization | Có thể tăng DOM/render work ở dữ liệu lớn | Profile trước khi thêm virtual list |
| Main imports Wazo SDK sớm; route views lazy | Vendor vẫn thuộc initial dependency graph | Dùng bundle stats an toàn khi được phép build; chưa có bundle size mới |
| SDK prototype no-op hold và truy cập phone.currentSipSession | Coupling vào internal SDK, upgrade dễ regression | Pin/contract-test version và media/group E2E trước upgrade |

Không chạy build ghi dist, không dùng con số bundle/time của tài liệu cũ làm kết quả hiện tại. Không có benchmark tải, WebRTC packet/ICE/RTP hay database. Backend Python/SQLite mới chưa tồn tại nên mọi nhận định throughput/concurrency production là UNKNOWN.

## Cổng kiểm chứng production còn thiếu

Quyền API Wazo/tenant, valid token lifecycle, SAML configuration, TLS/CSP/deployment headers, server log/retention, media device routing, Android APK và dữ liệu nhân sự cần môi trường/đội vận hành. Không dùng audit frontend để xác nhận những phần này đã an toàn.
