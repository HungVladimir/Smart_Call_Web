# Kiểm chứng bản refactor

Ngày: 19/11/2026. Môi trường đã chạy: Windows, Node 22.19.0. Chỉ bản clone được chỉnh sửa.

## Kiểm tra tự động

| Kiểm tra | Kết quả |
| --- | --- |
| Cài dependency từ frontend/package-lock.json | Hoàn thành; npm ci |
| npm run lint | Đạt, không có lỗi |
| npm --prefix frontend run check:architecture | 50 module; không import thiếu/cycle, không core import ngược, không nghiệp vụ import app |
| npm test | 76/76 kiểm thử, 7 file |
| npm --prefix frontend run format:check | Đạt sau chuẩn hóa |
| npm run build | Thành công; output frontend/dist |
| npm audit | Không ghi nhận vulnerability tại thời điểm chạy |
| Trang login trên trình duyệt local | Hiển thị đúng tiếng Việt; không console error/warning trong lần kiểm tra |

Các dependency gián tiếp vẫn có thông báo deprecated (inflight, glob, rimraf, fstream, jsrsasign). “0 vulnerabilities” là kết quả cơ sở dữ liệu npm tại thời điểm chạy, không phải chứng minh mọi dependency đều an toàn hoặc còn được duy trì. Không dùng force upgrade SDK ngoài phạm vi.

Phiên bản chính đã kiểm tra: @wazo/sdk 0.49.11, Vue 3.5.45, Vue Router 5.5.0, Vite 8.3.8, Vitest 5.1.1. Bản SDK được giữ để hạn chế thay đổi giao thức.

## Các nhóm hành vi được kiểm tra

- Ownership phiên: response/body cũ, chuyển tài khoản, callback SDK/WebSocket, pending favorite.
- Đăng nhập: giới hạn chờ, kết quả muộn, khôi phục token bị từ chối, không logout nhầm phiên mới.
- Gọi: các trạng thái chặn, gọi chính mình, số không tìm thấy, audio-only, khóa lookup dài, SDK trả muộn, nghe máy chờ ACK/thất bại.
- Hội nghị: conference trả muộn sau cúp, merge lỗi được thử lại, nhánh phụ nghe trước, Map reactive, lời mời muộn.
- Ghi âm/media: lỗi start/stop, hủy start, cache sau đổi phiên, đúng host, player đảo thứ tự, thiết bị và mic đến muộn.
- Chat: command quản trị, nhóm đã đóng khi cold load, HTTP lỗi, membership bị chặn, gửi xong không đổi phòng, kết quả batch từng phần.
- UI: Header SIP, form login/điều hướng, Settings chưa tải Confd, MessageList, Composer IME, Dialer.
- Mapper: dữ liệu danh bạ items/bảng cột/rỗng, favorite, CDR nội bộ/inbound/outbound.

Module và Vue component thật được thực thi. SDK, HTTP, thiết bị, đồng hồ được mock ở ranh giới. Không có bằng chứng coverage 100%; test không thay cho xác minh hệ thống ngoài.

## Bundle

Build vẫn báo chunk lớn hơn 500 KB. Chunk đầu vào khoảng 1.197 KB trước gzip, khoảng 325 KB sau gzip; các màn hình được lazy-load như cấu hình router. Việc refactor cải thiện trách nhiệm/kiểm chứng, chưa chứng minh cải thiện tốc độ. Không tăng ngưỡng cảnh báo để che vấn đề.

## Kiểm tra tích hợp trước khi dùng thay bản cũ

Các mục dưới đây **chưa thực hiện** trên Wazo/IdP thật:

| Luồng | Kết quả cần xác nhận |
| --- | --- |
| Login / F5 / logout | Đúng hồ sơ/máy lẻ, token hết hạn, refresh, thu hồi phiên đúng chính sách |
| SIP / mạng ngắt rồi nối lại | ON_REGISTERED thực, không nhân listener/kết nối |
| Gọi đi / gọi đến | Âm thanh hai chiều, answering/connected, từ chối, không trả lời, cúp ở cả hai phía |
| Mic/loa / mute / DTMF | Thiết bị thực được áp dụng, đóng thử mic không giữ track |
| Gọi nhóm | Mời, timeout, host/member rời, merge retry, chuyển nhánh sang hội nghị |
| Ghi âm | API start/stop, CDR liên kết, phát/tải media, đổi tài khoản không còn cache cũ |
| Danh bạ/yêu thích/presence | Đúng source, ACK thật, đồng bộ giữa client theo server |
| Chat nhóm/trực tiếp | Gửi/nhận, metadata quản trị, đóng nhóm, lỗi từng phần, quyền server |
| Settings Confd | DND/forward thực thay đổi và được tải lại đúng |
| Static host | Truy cập URL con/F5 có fallback index.html; public assets đúng |
| Backend/IdP | Chỉ kiểm tra khi có project mẫu, đăng ký client và contract |

Cần theo dõi cả frontend lẫn log server với tài khoản thử nghiệm được cấp. Không đưa secret vào Markdown hoặc log export.

## Chạy lại

Tại gốc clone:

```powershell
npm --prefix frontend ci
npm run check
npm --prefix frontend run format:check
npm --prefix frontend audit
```

Giữ bản gốc hoặc commit trước refactor để đối chiếu. Không áp dụng bản clone vào production chỉ dựa vào build/test tự động.
