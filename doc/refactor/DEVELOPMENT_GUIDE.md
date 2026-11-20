# Hướng dẫn đọc và mở rộng mã Web

## Đọc dự án lần đầu

1. Đọc README để chạy đúng frontend; backend chưa có runtime.
2. Xem `src/main.js`, `router/index.js`, `App.vue`: khởi tạo, điều hướng và các modal dùng chung.
3. Xem `services/createServices.js`: đối tượng nào được tạo và dependency được truyền đi đâu.
4. Chọn một thao tác, đọc View → event của component → command service → SDK/API/state.
5. Đọc kiểm thử tương ứng để thấy hành vi lỗi, response muộn và trạng thái được mong đợi.

Ví dụ gọi điện: CallsView → startCall → callPolicy → placeSdkCall → phoneEventHandlers. Ví dụ chat trực tiếp: MessagesView → getOrCreateDirectRoom → sendMessage → state.rooms → MessageList.

## Đặt tên

| Loại | Quy ước / ví dụ |
| --- | --- |
| Component, lớp | PascalCase: MessageComposer, GroupCallService |
| Composable | use + mục đích: useRecordingPlayer, useContactFilters |
| Phép kiểm tra | is/has/can: isSessionContextCurrent, hasActiveCall |
| Lệnh | Động từ cụ thể: startCall, acceptIncomingCall, saveCallServices |
| Lookup có thể tạo dữ liệu | getOrCreateDirectRoom, không gọi đơn thuần getRoom |
| Mapper | mapUserProfile, mapDirectoryContacts, mapCallHistoryRecord |
| Thông tin rõ đơn vị | timeoutMs, duration, microphoneId, participantExtension |
| ID khác nguồn | callId của Web, sipCallId của SDK, server call ID của Calld phải phân biệt |

Tên tham số/field giao thức server như user_uuid, noanswer, SIP event constants được giữ theo hợp đồng, không đổi tùy ý để đồng nhất camelCase.

## Comment có ích

Viết tiếng Việt giải thích **vì sao**, ai sở hữu state, khi nào cleanup, trường hợp ngoại lệ và kết quả trả về. Không cần comment lặp lại mọi phép gán. Hàm public phức tạp nên có JSDoc; mapper/composable có mô tả hợp đồng. Không đưa nhận định “100% đồng bộ” hoặc “không còn lỗi” vào comment khi chưa có kiểm chứng.

## Thêm tính năng hoặc API

1. Đặt View/component/service trong thư mục quen thuộc đang có. Chỉ tạo thư mục khi có một nhóm file thực sự cần đi cùng nhau.
2. Với DTO mới, thêm mapper thuần và kiểm thử dữ liệu đúng/rỗng/khác schema quan trọng.
3. Truyền dependency qua constructor và tạo tại createServices. Không import services/index.js hoặc services/createServices.js từ service/state/helper/composable.
4. Component gọi command, không gọi fetch hoặc tự dựng header/token.
5. Với API mới, ưu tiên WazoApiClient hoặc API client backend riêng theo hợp đồng thực tế. Giữ context qua request và xử lý lỗi HTTP.
6. Sau await, kiểm tra context/thế hệ trước khi commit. Nếu có timer, stream, audio URL hoặc listener, xác định luôn chỗ thu hồi.
7. Chỉ commit sau ACK đối với thao tác ghi. Nếu có nhiều request, trả kết quả từng phần có nghĩa.
8. Cập nhật tài liệu/nhật ký và chạy check.

Không copy workflow lifecycle của Android vào component Vue. Chỉ đối chiếu schema, event và quy tắc nghiệp vụ thật cần tương thích.

## State và lưu trữ

- Đọc danh bạ/phòng từ computed tham chiếu state service, không sao chép mảng để cập nhật thủ công.
- Không đưa bản sao session SDK vào deep reactive. groupCallState dùng shallowReactive cho Map chứa session.
- localStorage giữ thông tin khôi phục phiên/cấu hình kỹ thuật. Ngoại lệ tạm theo yêu cầu mới: metadata badge theo host/UUID (ID phòng/tin, không text) để giữ số qua F5/đăng nhập lại. Không lưu danh bạ/phòng/tin nhắn/CDR để giả đồng bộ server; badge này chưa đồng bộ read cursor với thiết bị khác.
- Các danh sách và media cache trong RAM phải dọn khi đổi phiên.
- createServices phục vụ dependency injection; các state module vẫn là singleton cho SPA một phiên. Test phải reset state theo fixture.

## Kiểm thử

Vitest chạy module thật; happy-dom cung cấp trình duyệt giả lập. Helper mountComponent dùng Vue createApp thật. Mạng, SDK, thiết bị và đồng hồ được thay ở ranh giới để điều khiển thời điểm.

Ưu tiên kiểm thử hành vi có rủi ro: response đảo thứ tự, logout khi đang chờ, HTTP lỗi, kết quả từng phần, người dùng chuyển phòng, stream đến sau dispose. Không kiểm tra code bằng cách tìm chuỗi source hoặc giả lập lại toàn bộ service.

```powershell
npm test
npm --prefix frontend run test:watch
npm run lint
npm --prefix frontend run check:architecture
npm --prefix frontend run format:check
npm run build
```

Architecture checker kiểm tra import cục bộ, cycle, service import giao diện/điểm khởi tạo, state/helper import nghiệp vụ, fetch trực tiếp trong SFC và một số identifier của tính năng đã bỏ. Đây là kiểm tra tĩnh có phạm vi cụ thể, không chứng minh mọi thiết kế đều đúng.

## Khi đưa IdP/backend vào

Đọc backend/README.md trước. Thay đổi điểm lấy hồ sơ/phiên qua adapter theo hợp đồng mới, giữ model của feature và test hành vi. Không tự bịa endpoint đăng nhập hoặc trao đổi token từ luồng trình duyệt đang quan sát. Không đưa client secret vào frontend/.env vì Vite có thể công khai giá trị.

## Cài đặt và triển khai

Chạy npm ci tại frontend để dùng lockfile. Đầu ra frontend/dist cần static host có fallback về index.html cho Vue Router history. Production WebRTC cần secure context, quyền microphone, chứng chỉ và cấu hình Wazo phù hợp. Kiểm chứng kết nối thật bằng bảng trong VERIFICATION.md trước khi chuyển người dùng sang bản clone.

Các tùy chọn ngôn ngữ khác tiếng Việt, thông báo desktop/chat sound và chỉnh âm lượng chuông chưa có logic hoàn chỉnh nên hiện bị vô hiệu hóa, có mô tả trạng thái. Không coi chúng là chức năng đã được triển khai.

## Chọn nhóm service

Chọn auth cho phiên; calls cho thoại/hội nghị; audio cho âm báo/thiết bị/ghi âm; realtime cho socket/event; data cho danh bạ/chat/CDR/cấu hình Wazo; common cho HTTP/log. Không thêm thư mục sâu hơn nếu chưa có nhu cầu thực tế.
