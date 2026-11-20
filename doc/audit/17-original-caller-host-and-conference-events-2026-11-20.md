# Giữ host là người gọi ban đầu và sửa sự kiện hội nghị — 20/11/2026

## Yêu cầu đã chốt

Đối với Web: A gọi B, B thêm C thì **A tiếp tục là host**. B gửi yêu cầu cho A; A gọi C và ghép vào hội nghị. Người bấm thêm thành viên không được tự nhận quyền chủ phòng.

| Thao tác | Hành vi theo quy tắc mới |
| --- | --- |
| A gọi B, B thêm C | B gửi ADD_REQ cho A; A nâng cuộc gọi thành nhóm và gọi C |
| A gọi B, A thêm C | A trực tiếp tạo nhóm và gọi C |
| A cúp | A yêu cầu xóa hội nghị và ngắt các nhánh B/C |
| B hoặc C cúp | Người đó rời; A và thành viên còn lại tiếp tục |
| Người ngoài gửi yêu cầu thêm người | Bị từ chối |

Đây là quy tắc nghiệp vụ được người dùng xác nhận trong lượt sửa này. Không suy quy tắc host từ việc một lần chạy commit cũ đã ngắt toàn bộ máy: state và thứ tự event cũng có thể gây ngắt dây chuyền.

## Hai lỗi độc lập đã phân tích

### Mất listener trên commit 5d5fe3e

`connectPhone()` gắn listener trước `Wazo.Phone.connect()`. SDK `@wazo/sdk 0.49.11` gọi `_transferEvents()` rồi `unbind()` trong lúc kết nối và xóa listener. Cờ `listenersAttached` vẫn true khiến lần gắn sau bị bỏ qua. Hệ quả: SDK có thể đã kết nối nhưng Web không cập nhật REGISTERED và không xử lý CALL_INCOMING.

Sửa: detach trước khi kết nối, gắn lại ngay sau khi Promise connect hoàn tất, trước các thao tác áp dụng thiết bị âm thanh. Nếu REGISTERED đã phát quá sớm, đọc `Phone.phone.isRegistered()` của SDK để đồng bộ; không suy online từ token.

Test cũ phát REGISTERED đồng bộ bằng SDK giả, không xóa listener. Test thay thế sử dụng chính `Emitter` và `_transferEvents()` từ SDK đã cài; phần mạng/SIP vẫn được cô lập. Test kiểm tra cả kết nối trùng, trạng thái đăng ký và cuộc gọi đến sau connect.

### Báo C đã rời ngay khi C nghe máy

Đường WebSocket trước đây gom `call_ended` cùng hai sự kiện thành viên rời hội nghị. Nhưng một kênh SIP có thể kết thúc khi tổng đài chuyển nó vào ConfBridge, trong khi C vẫn ở phòng và tiếp tục nghe/nói. Đường xử lý này có ở cả `9d67747`, `affdb80` và `5d5fe3e`.

Sửa:

- `call_ended` không trực tiếp xóa thành viên nhóm. Nhánh trước khi ghép do SDK quản lý; sau khi ghép, việc rời phòng do sự kiện hội nghị quản lý.
- Chỉ nhận `adhoc_conference_participant_left` / `conference_user_participant_left` khi `conference_id` khớp phòng đang quản lý và `call_id` ánh xạ đúng thành viên. Không nhầm `participant_id` hoặc `id` thành `call_id`.
- Chuẩn hóa ID dạng số/chuỗi khi tìm nhánh; một sự kiện rời lặp không tạo thêm thông báo.
- SDK báo nhánh phụ đã nghe máy kết thúc trong lúc REST ghép phòng còn chờ thì giữ tạm, không xóa thành viên ngay.
- Sau REST, phát lại sự kiện: nhánh đã ghép thành công được giữ trong danh sách; ghép thất bại thì dọn nhánh đã kết thúc. Có phòng không đồng nghĩa mọi nhánh mới đều đã ghép thành công.
- Cúp máy/đổi phiên xóa hàng đợi. Kết quả tạo phòng đến muộn không phục hồi nhóm; cơ chế hiện có yêu cầu xóa phòng vừa tạo muộn nếu vẫn cùng phiên xác thực.

Không thêm một khoảng thời gian tùy ý để bỏ qua toàn bộ sự kiện rời phòng.

## Luồng Web sau sửa

```text
A gọi B → B nghe máy
  ↓
B chọn thêm C
  ↓
B gửi ADD_REQ cho A, không tự gọi C / tự tạo phòng
  ↓
A kiểm tra UUID người phát, peer hiện tại, trạng thái connected và host đích
  ↓
A nâng thành nhóm, đặt host = A, công bố GROUP và gọi C
  ↓
C nghe → A ghép hội nghị
  ↓
Kênh SIP cũ kết thúc không tự tạo thông báo C đã rời
  ↓
A cúp → xóa hội nghị + ngắt các nhánh thành viên
```

`GROUP` đầu tiên chỉ được nhận từ người đang gọi tới mình. A trong cuộc gọi outbound không nhận tag từ B để đổi host sang B. Trong nhóm đã có host, thành viên không được tự công bố thay host.

`ADD_REQ` được chấp nhận trước khi có GROUP chỉ khi người nhận yêu cầu đang có cuộc gọi outbound đã kết nối với đúng người gửi. Ngoại lệ này không mở quyền cho người ngoài, cuộc gọi đang đổ chuông hoặc người nhận cuộc gọi tự nhận host.

Gửi yêu cầu thêm người phải có HTTP thành công mới hiện thông báo đã gửi. ACK đến sau khi cúp/đổi phiên không hiện thông báo cho cuộc gọi cũ. “Đã gửi yêu cầu” không có nghĩa C đã nghe máy hoặc đã ghép phòng.

## File liên quan

- `src/services/wazo.js`: phân quyền host, xác thực ADD_REQ/GROUP, vòng đời listener, phân loại sự kiện hội nghị và hàng đợi kết thúc nhánh.
- `src/views/CallsView.vue`: giao toàn bộ quyết định trực tiếp/ủy quyền cho service, bắt và hiển thị lỗi mời.
- `GEMINI.md`: ghi rõ quy tắc người gọi ban đầu giữ host để các lượt sửa tiếp theo không đổi ngược.
- `tests/regressions.test.cjs`: kiểm chứng SDK và các tình huống nhiều máy Web.

## Kiểm chứng và giới hạn

- `npm test`: **82/82 đạt**; giữ 72 ca trước, cập nhật hai ca theo hợp đồng đúng, bổ sung 10 ca.
- Các ca mới bao gồm A–B–C giữ host A; A tự thêm C; A giải tán và máy thành viên nhận sự kiện kết thúc; B rời mà nhóm tiếp tục; người ngoài/peer đang đổ chuông không được yêu cầu nâng nhóm; chống lặp yêu cầu; gửi ADD_REQ thất bại/ACK muộn; kênh cũ kết thúc; sự kiện rời nhầm phòng/lặp; kết thúc nhánh trong lúc REST chờ; ghép thất bại; cúp trong lúc ghép.
- `npm run build`: thành công, 324 module. Còn cảnh báo chunk chính lớn hơn 500 kB, khoảng 1.202 kB trước gzip.
- `git diff --check`: dùng để kiểm tra phần sửa trước commit.
- Các test chạy code service/view với ranh giới mạng/thiết bị được thay trong môi trường kiểm thử. Test listener đọc cơ chế emitter thật của SDK; không đăng nhập tổng đài hay mở microphone thật.
- Chưa xác minh media/SIP và envelope event trên tổng đài đang triển khai. Cần cập nhật đồng bộ các máy Web trước khi thử quy tắc mới; Web cũ vẫn có thể tự nhận host theo logic trước.
- Không chỉnh sửa Android. Mã tham chiếu hiện có nhánh chỉ nhận ADD_REQ hai phần, trong khi Web phát định dạng có request ID ba phần. Web nhận được cả hai định dạng, nhưng chiều gửi sang Android cần đối chiếu đúng phiên bản ứng dụng trước khi khẳng định tương thích.
- Presence vẫn là giao thức điều khiển ứng dụng hiện có; Web kiểm tra danh tính/quyền nhưng không thay việc phân quyền trên tổng đài.

## Thử trên tổng đài thật

1. Đăng nhập/F5 từng máy Web: SIP cập nhật đúng, nhận được cuộc gọi đến.
2. A gọi B; B nghe rồi thêm C. Kiểm tra yêu cầu gửi tới A và host luôn là A.
3. C nghe: cả ba nghe/nói, danh sách vẫn đủ người, không có thông báo C rời.
4. Lặp lại, cho A cúp: B và C phải kết thúc cuộc gọi.
5. Lặp lại, cho B hoặc C cúp: A và người còn lại tiếp tục; chỉ thông báo đúng người rời.
6. Thử C từ chối/không nghe; lỗi REST/mất mạng khi ghép; A cúp ngay lúc C đang nghe; đăng nhập lại rồi gọi cuộc mới. Không để event cũ tác động cuộc mới.
