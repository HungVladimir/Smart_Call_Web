# Vòng hai: phản biện độc lập với kết luận Phase1

> **Tài liệu lịch sử.** Nội dung phản ánh thời điểm ghi nhận. Đường dẫn code, số liệu và đề xuất có thể đã thay đổi.

Ngày19/11/2026. Đây là vòng đổi vai reviewer trong cùng phiên làm việc/cùng môi trường; không tuyên bố có một tổ chức hay kỹ sư bên ngoài đã chứng nhận. [Checkpoint Phase1](00-phase1-notes.md) · [Findings cuối](03-bugs-and-logic-findings.md).

## Cách thực hiện

Mở lại caller và state ownership, kiểm tra guard mới ở bước75/76, xem contract Promise của SDK đang cài, chạy harness mới trên snapshot hiện tại và tìm đường failure/recovery phản bác. Không dựa vào labels BUG trong comments hoặc báo cáo cũ để kết luận.

## Tất cả P1 đã kiểm tra lại

| ID | Phản chứng đã tìm | Kết quả |
|---|---|---|
| SEC-001 | UI có currentIsAdmin/isRoomAdmin; backend Chatd có ACL gửi tin | Guard UI không kiểm tra inbound content; message thông thường không chứng minh admin. VM dùng ordinary sender vẫn ẩn room. CONFIRMED ở client, không nâng thành server-delete exploit |
| SEC-002 | logout reset services; KeepAlive key theo UUID; single-flight | Các guard xóa state/instance nhưng không vô hiệu request đang chạy. Response A gán lại singleton shared. VM A→reset→B→response xác nhận. CONFIRMED |
| BUG-001 | loadCallServices có fetch DND/forwards | Chỉ chạy khi tab calls. Default audio save vẫn bốn PUT false/rỗng. VM và code reopened xác nhận. CONFIRMED; tác động server phụ thuộc quyền/validation |

Không có P0 để xác minh.

## Điều chỉnh severity

| ID | Phase1 | Sau phản biện | Lý do |
|---|---|---|---|
| BUG-002 | P1 dự kiến | P2 CONFIRMED BUG | Chứng minh state connected quá sớm; failure event có thể dọn sau đó. Chưa chứng minh mọi answer lỗi đều stuck hoặc call success trên PBX |
| BUG-003 | P1 dự kiến | P2 CONFIRMED BUG | VM xác nhận late confId hồi sinh; chưa chứng minh orphan còn media hoặc tác động nghiêm trọng trên server thật |
| BUG-005 | P2 | P2 CONFIRMED BUG | Guard secondary mới giữ primary/startTime cũ, nhưng không tạo timer khi chưa ai nghe; ON_PROGRESS vẫn overwrite aggregate. Chỉ chốt state defect, không khẳng định đã reproduce âm thanh câm |

Một fixture đầu tiên cho BUG-003 chưa đi tới create vì mapping chỉ còn một peer, cho kết quả created0; không dùng làm bằng chứng. Fixture sau đặt hai peer và giữ create Promise pending rồi hangup: confId late-conf xuất hiện lại dù activeCall null. Đây là xác minh khác execution path, không cherry-pick kết quả ban đầu.

## Những giả thuyết bị bác bỏ/không đưa vào findings hiện hành

| Giả thuyết cũ | Bằng chứng bác bỏ hiện tại |
|---|---|
| sendMessage HTTP500 tự báo Đã gửi | chatService.js:1100–1117 throw/catch đặt Lỗi gửi và sendFailed; VM control xác nhận |
| Admin luôn bị thay bằng người gửi tin đầu tiên | Đã bỏ override trong getRoomMessages; VM admin creator được giữ. Fallback serverUsers[0] vẫn là giả định cần schema thật |
| Ended khác ID luôn xóa active call | wazo.js:1206 guard activeSipId khác endedSipId; VM giữ active. Không phủ nhận early phase khi active.session chưa có |
| Listener luôn tích tụ sau disconnect | Có detachListeners và named handlers. Không lặp lại finding cũ; removeAllListeners rộng có thể ảnh hưởng subscriber khác, chưa chứng minh caller bị ảnh hưởng |
| CDR còn ghi localStorage | historyService hiện RAM-only; source search/bước75 bác bỏ |
| startGroupCall không có collision guard | wazo.js:2317 đã chặn local active/group/dialing. Không chốt duplicate group bug cũ |
| Không có WS reconnect/refresh token | Code đã có reconnect và heartbeat/refresh; không bê finding báo cáo Mock sang main |
| Logout mất mạng vẫn lỗi | Người dùng xác nhận hiện không gặp; chưa có trace live. Tạm gác, không tính vào21 |

## Phát hiện bổ sung từ kiểm tra chéo

- BUG-011: play A/B đảo thứ tự, played audio-b rồi audio-a trong khi UI chọn b. Đã reproduce VM, P2.
- BUG-015: start mic pending, stop/close trước resolve, track mới không stop. VM stopCount0, P2.
- BUG-014: cold room prefetch lấy messages loại tombstone nhưng mất isClosed, phòng vẫn visible. VM xác nhận.
- BUG-012: badge missed0 nhưng rows1 với outbound declined. VM xác nhận.
- BUG-013: send A pending rồi chọn B, completion chọn lại A. VM xác nhận.
- SEC-003/LOGIC-001/002: đối chiếu thêm reset graph, receipt và membership; code evidence đủ kết luận phạm vi mô tả.

## Coverage và uncertainty

Đã review lại tất cả P1 cùng caller/callee/guards; đã thực hiện pass bổ sung qua Vue state/lifecycle và cross-module. Source được hash trước/sau để phát hiện thay đổi ngoài audit. Các output VM là dữ liệu tổng hợp, không chứng minh server schema/ACL, SIP media, Android APK hoặc IdP.

Tài liệu lịch sử lớn/API catalog được phân loại và tra phần liên quan; không tuyên bố toàn bộ từng dòng lưu trữ/prototype đã review. Toàn bộ app source có inventory và static scan; CSS được parse cùng SFC/đọc phần liên quan nhưng chưa visual QA. Xem [09](09-audit-coverage.md) để biết giới hạn đầy đủ.
