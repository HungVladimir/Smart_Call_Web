# Nhật ký refactor SmartCall Web

Ngày thực hiện: 19/11/2026. Phạm vi ghi: D:/Project/Smart_Call_Web_Refactor. Nhánh: codex/refactor-architecture. Điểm bắt đầu: fac529b; mã nghiệp vụ kế thừa affdb80. Bản gốc cùng cấp được giữ nguyên.

## 1. Chuẩn bị và kiểm tra thực tế

- Tiếp nhận yêu cầu Web, không refactor ứng dụng Android; FileQuest chỉ tham khảo.
- Trình bày sơ đồ và cây thư mục trước khi chỉnh sửa.
- Xác minh clone/main khi bắt đầu vẫn chứa mã Vue ở gốc; chưa có frontend/backend như mô tả dự kiến. Tạo bố cục theo yêu cầu mới.
- Chuyển src, public, tests, package/lock, index, Vite/jsconfig/Prettier và cấu hình môi trường vào frontend.
- Giữ Git, tài liệu, FileQuest/spec tại gốc; tạo backend/README.md mô tả phần chờ hợp đồng.
- Lưu source baseline tạm trong .refactor-tmp được ignore để đối chiếu khi tách code.

## 2. Baseline và công cụ kiểm chứng

- Baseline sau chuyển thư mục: hồi quy cũ 27/27 đạt; build thành công, 324 module, bundle đầu vào khoảng 1,19 MB.
- Bộ hồi quy cũ phụ thuộc vị trí source. Thay bằng Vitest chạy module thật và Vue component thật, không tiếp tục duy trì file kiểm thử đã trỏ vào cấu trúc bị xóa.
- Khi cài công cụ gặp lỗi npm Arborist edgesOut ở chuỗi peer devtools/Vitest; bỏ vite-plugin-vue-devtools khỏi bản refactor và dùng Vitest tương thích môi trường Node.
- Bộ mount dùng Vue createApp; không giữ @vue/test-utils sau khi xác định có thể kiểm tra trực tiếp mà không cần dependency này.
- Thêm ESLint, Prettier check, checker import/cycle/ràng buộc tầng và kiểm tra field callState cũ.
- Lần npm ci cuối ban đầu bị EPERM vì dev server đang giữ binding native Rolldown; dừng dev server trước khi cài lại.
- Cấu hình Vitest tắt transform asset URL cho public asset để component import đúng trên Windows.
- Một số test UI ban đầu lỗi do chưa đợi router và happy-dom không có confirm: đợi điều hướng trong command UI và stub confirm tại ranh giới test.

## 3. Tách kiến trúc

- Tách wazo.js khoảng 3.209 dòng thành AuthService, CallController, GroupCallController, PhoneAdapter, CallControlApi và các handler sự kiện có trách nhiệm cụ thể.
- createServices lắp ghép dependency; services.js là nơi nạp SDK thật. Service nghiệp vụ không import ngược app.
- EventConnection sở hữu socket/reconnect; handleWazoEvent xử lý nội dung nghiệp vụ; EventHub phân phối sự kiện tới các dịch vụ.
- Tách userSessionState, callState, groupCallState, recordingState; Map chứa SDK session dùng shallowReactive.
- ContactService và ChatService giữ reactive state của danh bạ/phòng. Giao diện đọc bằng computed, bỏ các bản sao mảng và listener cập nhật rỗng.
- Tách SettingsService/WazoApiClient để modal không chứa HTTP/header.
- Tách mapper hồ sơ, danh bạ hai schema, CDR; định dạng thời gian tin nhắn có file riêng.
- Tách useContactFilters, useMicrophoneMeter, useRecordingPlayer.
- Tách DialerPanel, MessageList, MessageComposer; dọn CSS trùng trong page sau khi chuyển sang component.
- Chuẩn hóa tên có nghĩa: getOrCreateDirectRoom, publishRoomsChanged, isTrustedRoomCommand, assertRoomAdmin, các hàm timeout/hủy lời mời.
- Sửa các tham chiếu myExtension/myUserUuid cũ sang userSessionState. Thêm checker để phát hiện field callState không còn tồn tại.

## 4. Lỗi phát hiện và xử lý trong lượt refactor

| Trigger / vấn đề | Thay đổi tại đúng owner | Bằng chứng |
| --- | --- | --- |
| API favorite lỗi vẫn đổi UI; bấm trùng tạo request lặp | Commit sau ACK, dùng pending map, trả lỗi HTTP | Test HTTP500/204 và thao tác đồng thời |
| Favorite phiên cũ khóa thao tác cùng contact của phiên mới | Reset pending map và metadata nguồn khi đổi phiên | Test hai request qua hai phiên |
| Xóa nhiều nhóm có lỗi nhưng báo thành công toàn bộ | Trả deletedIds/failures, giữ lựa chọn lỗi, thông báo đúng tỷ lệ | Test service và MessagesView |
| Có token bị coi là SIP online | Header đọc trạng thái registered thực | Test Header trước/sau registered |
| App yêu cầu connect lần nữa sau AuthService | Auth sở hữu kết nối login/restore; controller gộp connect đang chờ | Test SDK chỉ nhận một connect |
| Registered phát trong connect trước lúc listener được gắn | Gắn listener trước lệnh SDK | Test registered đồng bộ |
| SDK logout/disconnect hoàn tất muộn và xóa state SDK của lần kết nối mới | Chờ cleanup SDK trước login/connect tiếp theo; đối chiếu chữ ký SDK 0.49.11 | Test SDK logout/disconnect trả promise muộn |\n| Callback đã xếp hàng chạy sau logout/disconnect | Ràng buộc context và thế hệ listener | Test callback cũ không sửa phiên mới |
| SDK đăng nhập không trả kết quả làm form chờ vô hạn | Giới hạn chờ SDK auth/token 15 giây; không commit kết quả muộn | Test SDK promise treo |
| Token khôi phục bị từ chối vẫn còn coi là đăng nhập | Xóa phiên bị từ chối, chỉ khi epoch vẫn thuộc lần khôi phục đó | Test invalid restore và restore A sau B |
| Host ghi âm lấy từ fallback khác host Auth/env | RecordingService dùng host AuthService | Test URL truy vấn Calld |
| Force refresh CDR cũ về sau request mới | Dùng request generation trước commit/catch/finally | Test phản hồi đảo thứ tự |
| Khóa quay số hết sau 1,2 giây dù lookup đang chờ | Giữ lock đến khi xử lý xong; release thuộc đúng attempt | Test lookup dài, logout, kết quả SDK muộn |
| Enter trong lúc nhập IME gửi ngoài ý muốn | Composer kiểm tra isComposing | Test component thật |
| Lookup UUID không hiểu danh bạ bảng cột | Dùng chung contactMapper | Test column_types/results |
| Chọn mic thử đã lưu dù chưa bấm Lưu | Chỉ khởi động phép đo; lưu thiết bị trong handleSave | Rà luồng và test lưu cấu hình |
| Stream/mic/audio trả về sau đóng modal/chuyển lựa chọn | Generation + cleanup trong composable | Test dispose/reversed response |

Các lỗi và biện pháp của lượt audit trước vẫn được giữ: chặn response sai phiên sau đọc body; nghe máy chờ ACK; conference/recording không hồi sinh sau hủy; không thực thi command quản trị từ tin thường; không tái tạo phòng để giả cập nhật membership.

## 5. Hành vi được làm rõ

- Bỏ đăng nhập offline/token giả và cờ mockData; cấu hình cũ không bật lại được đường này.
- Không đưa lại ghim, read receipt hoặc bộ đếm chưa đọc. Giữ nội dung, thời gian và thông báo gửi thất bại.
- Ngôn ngữ khác tiếng Việt, desktop notifications, chat sound và điều chỉnh âm lượng chuông chưa có implementation đầy đủ; điều khiển hiện bị vô hiệu hóa thay vì cho thay đổi không có tác dụng.
- Backend/IdP chưa có hợp đồng: chỉ chuẩn bị ranh giới, không tạo endpoint hoặc token exchange giả.
- Đóng/thêm/xóa thành viên nhóm vẫn cần hợp đồng server và kiểm tra quyền tương ứng; giữ chặn các thao tác chưa an toàn.

## 6. Comment, định dạng và tài liệu

- Bổ sung comment tiếng Việt cho lớp, lệnh nghiệp vụ, ràng buộc phiên và cleanup.
- Phát hiện một số comment/tài liệu mới bị mất dấu do encoding pipeline PowerShell; chuyển pipeline sang UTF-8 và viết lại các đoạn bị ảnh hưởng.
- Chuẩn hóa imports và định dạng bằng Prettier; bỏ imports, hàm/listener không còn sử dụng.
- Tạo ARCHITECTURE, DEVELOPMENT_GUIDE, VERIFICATION, IMPLEMENTATION_PROMPT; cập nhật README/AGENTS/backend và bước 79 của lịch sử triển khai.
- Tài liệu cũ được giữ làm lịch sử; đường dẫn hiện hành bắt đầu từ frontend/src.

## 7. Kết quả cuối và giới hạn

- 76 kiểm thử thuộc 7 file đạt; lint và kiểm tra 50 module Web đạt.
- Build production thành công; vẫn có cảnh báo chunk đầu vào khoảng 1.197 KB, gzip khoảng 325 KB. Chưa có đo hiệu năng để khẳng định tải nhanh hơn.
- Cài đặt từ lockfile và audit dependency được xác minh; xem VERIFICATION.md để biết phạm vi.
- Mở trang login bằng trình duyệt local: hiển thị tiếng Việt, không có console error/warning ở lần kiểm tra. Không nhập credential thật.
- Không chạy SIP/media/hội nghị/ghi âm hoặc IdP trên tổng đài thật. Không triển khai production.
- Các service/page lớn vẫn còn nhiều nghiệp vụ và CSS. Việc tách tiếp cần dựa vào thay đổi cụ thể và kiểm chứng tích hợp, không chỉ số dòng.

Thông tin commit/push được báo trong kết quả bàn giao của lượt làm việc; không ghi hash tự tham chiếu vào commit này.

## 8. Audit độc lập sau refactor — 19/11/2026

- Rà lại commit a85d6dc theo yêu cầu đánh giá bảo mật, độ sạch, cấu trúc và các trường hợp chưa cover.
- Bộ chính vẫn 76/76 đạt; lint, architecture check, format và build đạt; npm audit báo 0 vulnerability tại thời điểm chạy.
- Bộ audit riêng trong cache có 11 ca: 9 không đạt, 2 đối chứng đạt, gom thành 8 nhóm vấn đề chính.
- Phát hiện: xác thực người phát group presence, SDK auth hoàn tất sau timeout, cleanup khi thu hồi phiên, accepted của sai cuộc gọi, event xóa conference không liên quan, reactivity nhãn gửi thất bại, mở lại phòng sau tombstone và vòng lặp router khi tắt hết phân hệ.
- Đo AST: ChatService 1.229 dòng; finalizeCallTermination 349 dòng; hai trang Calls/Messages vẫn hơn 800 dòng script mỗi trang. Cấu trúc feature phù hợp nhưng chưa hoàn tất làm sạch trách nhiệm.
- Ghi báo cáo và bản sao ca tái hiện: [FOLLOWUP_AUDIT_2026-11-19.md](FOLLOWUP_AUDIT_2026-11-19.md), [AUDIT_REPRO_CASES.md](AUDIT_REPRO_CASES.md).
- Không sửa mã nghiệp vụ, không gọi Wazo/IdP thật. Các phát hiện đang mở; cần sửa theo thứ tự trong báo cáo.

## 9. Rà soát file cần lưu Git — 19/11/2026

- Xác nhận node_modules ở gốc clone chỉ chứa cache công cụ; node_modules ở mọi cấp đã được loại bằng quy tắc node_modules/.
- Bổ sung .vite-temp/ và .vitest-cache/ để loại cache cả khi sinh ngoài node_modules.
- Giữ frontend/scripts, frontend/tests, eslint.config.js và vitest.config.js trong Git vì các lệnh check/lint/test cần chúng.
- Không xóa thư mục trên máy, không bỏ theo dõi source/config, không sửa mã nghiệp vụ hoặc bản gốc.
- Xác minh bằng git check-ignore và git diff --check; thay đổi ignore không cần chạy lại test ứng dụng.

## 10. Tài liệu nhập môn frontend — 19/11/2026

- Tạo doc/HUONG_DAN_FRONTEND_CHO_NGUOI_MOI.md gồm 20 chương cho người mới, giải thích khái niệm, cấu trúc, khởi động, từng tính năng và luồng từ UI tới SDK/HTTP rồi state.
- Giải thích đầy đủ 51 file source, cấu hình/test, các nhóm endpoint, response minh họa và bài thực hành lần code.
- Đối chiếu WazoApiService của Android với WazoApiClient/CallControlApi và các request còn phân tán; tách rõ code hiện tại với đề xuất chuẩn hóa API.
- Người dùng đính chính định dạng sang Markdown; bàn giao .md trực tiếp trong doc, không giữ bản Word mới tạo.
- Không sửa mã nghiệp vụ. Kiểm tra mục lục, liên kết file và độ bao phủ danh mục source; không cần chạy lại test ứng dụng cho thay đổi tài liệu.

## 11. Vá ba vấn đề ưu tiên F01 F02 F03 — 19/11/2026

- Group presence được tách vào groupPresenceSignals: xác định sender bằng UUID/danh bạ, đối chiếu peer/host/member hiện tại, yêu cầu mời chỉ từ người đã kết nối, LEFT chỉ cho chính người gửi; gộp yêu cầu lặp và giữ schema Android cũ.
- Thêm SdkAuthenticationGate dùng chung theo SDK Auth: initialize/login/validate/logout cùng hàng đợi, giữ khóa qua timeout cho đến khi SDK và cleanup kết thúc. Cleanup lỗi chặn tiếp và yêu cầu tải lại trang; request treo không cho retry chạy song song.
- Thu hồi phiên dùng logout revoked=true: invalidate scope, xóa token/profile/cache/URL media/định danh SIP cũ, dừng socket/retry/timer. Socket.close lỗi không ngăn dọn credential.
- App đóng Settings, bỏ view/cache riêng tư ngay trước khi router chuyển login và giữ modal lý do. Test UI đã bắt được trường hợp route riêng tư có thể render lại trong khoảng chờ, đã bổ sung guard.
- Thêm 27 ca hồi quy vào suite chính; tổng 103 test, 10 file. Không chỉnh sửa SDK trong node_modules, không tạo API/IdP mới.
- Cập nhật handbook, kiến trúc, báo cáo audit và kiểm chứng. F04–F08 vẫn mở ngoài phạm vi yêu cầu ba lỗi này.
- Giới hạn: chưa thử Wazo/Android thật. Contract presence cũ không có call nonce/chữ ký server; dữ liệu sender phải do server xác nhận. Bản vá client không thay ACL hoặc chứng minh chống mọi replay của cùng người dùng giữa các cuộc gọi.

## 12. Đơn giản hóa cấu trúc theo phản hồi người dùng — 20/11/2026

- Đã push bản gốc lên origin/main tại 5d5fe3e, xác nhận hash remote và working tree sạch. Sau đó chỉ sửa clone.
- Chạy baseline clone: 103 test đạt. Snapshot và mapping trước di chuyển nằm trong .refactor-tmp (Git ignore).
- Bỏ tầng app/core/features/shared, cập nhật import/test/index.html và ranh giới architecture checker. Không giữ alias shim hoặc bản sao source cũ.
- Đổi CallController/GroupCallController thành CallService/GroupCallService. Gộp state gọi/ghi âm/nhóm, ApiError và helper presence vào module sở hữu.
- Tách ActiveCallPanel, ContactsPanel, ContactCard và AddParticipantModal. View giữ lệnh/router; component giữ hiển thị/lựa chọn. Đối chiếu 282 rule CSS trước/sau, không mất rule; namespace bảo vệ các trang khác.
- Bổ sung kiểm thử UI thật và các ca F04–F08. Sửa event SIP cũ, ID hội nghị, proxy sendFailed, nhóm đóng không tự mở lại, và self-redirect. F07 vẫn cần API server để thực thi membership/ACL thật.
- Đồng bộ mật khẩu có khoảng trắng, định danh reset, dữ liệu người gọi và logger an toàn từ bản gốc.
- Viết lại cây thư mục/nhập môn/file catalog/luồng UI trong tài liệu hướng dẫn và kiến trúc. Các mục trước của nhật ký là lịch sử, không phải cây hiện hành.
- Kết quả cuối: 121/121 test (12 file), lint/architecture/build đạt. CallsView từ 3.748 xuống 923 dòng; 53 file và 14 thư mục source. Chi tiết và giới hạn nằm trong VERIFICATION.md.

- Hai lỗi UI/lifecycle phát hiện thêm: kết quả gọi cũ dừng nhầm ringback của cuộc gọi mới; danh sách đang kết nối gồm cả nhánh đã nghe. Đã sửa và có hai ca hồi quy riêng.

## 13. Gom nhóm service theo phản hồi — 20/11/2026

- Gom 19 service vào auth/calls/audio/realtime/data/common, chỉ một cấp nhóm; giữ index.js/createServices.js ở gốc.
- Source vẫn có 53 file; số thư mục con tăng từ 14 lên 20 để phục vụ phân loại có ý nghĩa. Không tái tạo các tầng app/core/features/shared.
- Có snapshot trước di chuyển; cập nhật import trực tiếp trong source và test, không để shim hoặc bản sao file cũ.
- Cập nhật cây thư mục, catalog, hướng dẫn chọn nhóm, kiến trúc và quy tắc phát triển. Bộ 121 test tiếp tục đạt sau di chuyển.

## 14. Giải thích hàm và điều kiện quan trọng — 20/11/2026

- Bổ sung 300 comment trước hàm/method/computed còn thiếu, 28 comment ở watch/lifecycle và 174 comment guard quan trọng. Nâng cấp thêm mô tả bộ lọc CDR để rõ hơn.
- Nội dung giải thích theo vai trò thực tế: View điều phối, component phát event, service sở hữu API/state/tài nguyên; không chỉ lặp tên hàm.
- Comment dài được xuống dòng để đọc trong editor; dùng JSDoc cho hàm và // cho nhánh xử lý.
- Bổ sung chương 21 của handbook để giải thích cách đọc guard về phiên, SIP ID, quyền và HTTP.
- Đã chốt: 461/461 hàm có tên/method/getter/computed có giải thích; đối chiếu AST của 52 module không đổi logic, template/style không đổi. 121 test, lint, architecture, build và format:check đều đạt.

## 15. Đồng bộ lỗi vừa sửa ở bản gốc — 20/11/2026

- Đối chiếu ff191f4, 86b2011 và 7485481; chuyển logic theo dependency hiện có, không copy wazo.js hoặc đổi cấu trúc thư mục.
- Giữ A là host khi B yêu cầu thêm C; tách call_ended khỏi rời hội nghị; giữ queue kết thúc nhánh lúc REST ghép còn chờ và dọn theo thế hệ.
- Gắn lại listener sau SDK connect/unbind; kiểm chứng bằng emitter/_transferEvents thật của SDK đã cài.
- Phím số cập nhật trước tiếng phím, không mở AudioContext; badge menu/từng phòng dùng cùng state, lưu metadata tạm theo host/UUID và khôi phục ngoài trang chat.
- Cập nhật AGENTS/architecture checker đúng yêu cầu mới, giữ cấm pin/read receipt. Comment và handbook được cập nhật cùng hành vi.
- 143/143 test (14 file), lint, architecture và build đạt. Thêm 22 ca; source vẫn 53 file/20 thư mục. Chưa thử tổng đài/Android thật.
- Chi tiết, đường đọc code và checklist: [bản sửa mới](LATEST_FIXES_2026-11-20.md).


## Đồng bộ bổ sung hiển thị nhóm Web — 20/11/2026

Đã chuyển tiếp bản main d0dc85d vào refactor theo yêu cầu mới: tách groupConnectedExtensions/groupPendingExtensions, snapshot GROUP_STATE có revision, GROUP_SYNC khi incoming/accepted/reconnect. ActiveCallPanel chỉ đếm người đã kết nối, bỏ tiêu đề số cũ. Giữ ánh xạ ID B/C sau merge và dọn lời mời khi SDK lỗi/null/timeout. EventConnection báo mở socket qua callback được lắp tại createServices, không import ngược nghiệp vụ.

Kết quả hiện hành: 148/148 test (14 file), lint/architecture/build đạt; các số 143 ở mục trước là mốc trước bổ sung này. Đã gồm toàn bộ bản sửa trước về host, listener SDK, tiếng phím và badge lưu tạm. Chưa thử tổng đài thật; cả ba máy Web cần cập nhật cùng bản.


## Gọi từ hội thoại — 20/11/2026

MessagesView.startVoiceCall chỉ phát app-action/dial cho chat 1-1. App.onDial là nơi duy nhất chuyển route kèm number/autocall; CallsView nhận query và gọi CallService.startCall. Không gọi router.push('/calls') thêm lần nữa vì sẽ làm mất query tự gọi.

Chat nhóm: MessagesView lấy máy lẻ thành viên, bỏ chính mình/trùng số → GroupCallService.startGroupCall → ContactService.isContactAvailableForCall loại bận/đổ chuông/DND/offline/không xác định khả dụng → không còn ai: dừng; còn một: CallService.startCall; nhiều người: khởi tạo nhóm và mời các nhánh còn lại. Phần kiểm tra SIP, mic và phiên vẫn thuộc dịch vụ gọi. Người gọi ban đầu giữ host.

View chờ kết quả success trước khi chuyển màn hình/gửi thông báo chat; khóa bấm lặp và trả khóa trong finally. Giữ room ID lúc bắt đầu, kiểm tra session trước khi xử lý kết quả. Thông báo chỉ nói đã khởi tạo cuộc gọi, chưa khẳng định người được mời đã nghe máy. Bộ lọc dùng presence hiện có, cần xử lý cả trường hợp trạng thái đổi sau kiểm tra và tổng đài từ chối. Không thay đổi admin.

Kiểm chứng mới nhất: 155/155 test (14 file), lint/architecture/build/format đạt; còn cảnh báo chunk lớn. Test mới kiểm tra router thật giữ query, nhóm một/nhiều/không có người rảnh, bấm lặp, đổi phòng khi chờ, logout, hủy và exception. Chưa thử tổng đài thật. Khi test: chat 1-1 gọi được; nhóm chỉ mời người khả dụng; tất cả bận/offline thì ở lại màn hình chat; người chưa nghe máy không tính đã tham gia.

Danh bạ 2.000 người mới chỉ thảo luận, chưa code: phân trang API 50/lần, tìm tên/số trên server, presence chỉ cho trang đang xem và người sắp gọi; không bắt buộc polling toàn bộ danh bạ. Nguồn Wazo Dird có limit/offset/search/uuid theo tài liệu cục bộ, cần thử trên server thực tế. Chỉ cắt mảng sau khi tải toàn bộ sẽ giảm DOM nhưng không giảm dữ liệu mạng. Không đổi số cột để thay cho phân trang. Khi triển khai sau này phải giữ lookup UUID/máy lẻ độc lập với trang hiển thị để không làm hỏng chat, mời nhóm và xác minh thành viên; presence chia lô theo giới hạn máy chủ.


## Sửa mục 3, 4, 5, 7 — 20/11/2026

- MessagesView.loadRooms giữ danh sách/phòng trong RAM khi REST cập nhật nền, chỉ loading lần đầu nếu chưa có dữ liệu. selectRoom không che lịch sử có sẵn bằng spinner. KeepAlive vẫn đồng bộ server khi mở lại, WebSocket/badge và kiểm tra session giữ nguyên. Không lưu nội dung chat cục bộ, chưa giảm số REST request.
- LoginView chỉ hiện hướng dẫn kiểm tra chứng chỉ sau lỗi kết nối/TLS phù hợp; ẩn mặc định và khi thử lại. Lỗi HTTP/credentials/timeout chung/TypeError nội bộ không kích hoạt. Failed to fetch có thể là mạng, CORS hoặc TLS; hướng dẫn không khẳng định nguyên nhân. Link tab mới có noopener/noreferrer.
- ActiveCallPanel sửa SVG mic thường cho cân đối; giữ icon muted và emit mute. Nút thêm người dùng nền hover bán trong suốt giống các nút điều khiển trên nền tối.
- MessagesView bổ sung CSS btn-action bị thiếu (36x36, viền, nền, flex căn giữa và hover) theo bản gốc, khôi phục diện mạo nút gọi/video. Chưa triển khai gọi video.
- 158/158 test (14 file), lint/architecture/build đạt; format:check đạt. Test mới dùng DOM/KeepAlive thật với REST trì hoãn, lịch sử có sẵn và các nhánh lỗi đăng nhập. Còn cảnh báo chunk lớn. Chưa xác nhận giao diện trên môi trường tổng đài thật.
- Người dùng thử: chuyển qua lại Tin nhắn, mở phòng cũ, nhập sai mật khẩu và thử lỗi kết nối, mic bật/tắt và hover thêm người trong cuộc gọi, nút gọi/video ở header chat. Admin không đổi; danh bạ phân trang vẫn chỉ thảo luận. Giữ nguyên backend/doc của người dùng, không đưa vào commit.


## Tích hợp backend Single ID và cấp tài khoản Wazo — 20/11/2026

Backend hiện có FastAPI (main), cấu hình (config), Redis session/SQLite mapping (store), OIDC (oidc) và cấp phát Wazo (wazo). Frontend thêm nút Single ID ở LoginView, route/CallbackView công khai và singleIdApi; AuthService dùng chung completeAuthenticatedSession cho mật khẩu và token SSO. App không đưa callback về login trước khi hoàn tất. Vite dùng cổng 8800, proxy /api tới backend 8801.

Giữ luồng tham chiếu code → token → ID token claims, bổ sung state gắn browser và GETDEL, nonce/issuer/audience/exp/chữ ký/JWKS, PKCE, cookie HttpOnly/Secure theo origin, Origin/CSRF cho POST và no-store. Không trả token IdP về Web. Profile trong RAM, UUID/máy lẻ theo Wazo. Redis namespace riêng, SQLite lưu liên kết issuer/sub/tenant với Wazo UUID, không lưu password/token.

Tạo mới qua Confd POST user gộp auth/line/extension/SIP, password test 12345 theo yêu cầu, số ngẫu nhiên còn trống trong dải cấu hình, context internal và template global/webrtc được xác minh trên server, SIP secret riêng. Email đã có không tự reset password; hỗ trợ opt-in thử password cấu hình hoặc báo cần liên kết. Chưa có federation/token exchange Wazo tự giả định.

Kiểm chứng: 14 test backend; 167 test frontend/16 file, lint/architecture/build/format. Health/proxy thật ok, callback HTML 200, guest profile 401. Chưa gọi IdP/Wazo công ty từ môi trường này. Cần điền credential cấp phát và tenant Wazo; IdP/Redis cục bộ lấy chọn lọc từ bản tham chiếu vào .env bị ignore. Hai file dán trong backend/doc giữ nguyên và được bỏ khỏi Git vì chứa secret.

Hướng dẫn chạy, biến môi trường, API và bảng test đầy đủ: xem [backend/README.md](../../backend/README.md). Từ handbook ở doc/ dùng đường dẫn ../backend/README.md.


## Nhập cấu hình từ bản mẫu — 20/11/2026

Đặt bản dán gốc tại backend/doc/backendV1.py trên máy cần chạy, sau đó từ thư mục gốc gọi:

~~~powershell
.\backend\.venv\Scripts\python.exe -X utf8 backend/import_reference_env.py
~~~

Script đọc các dòng môi trường, không thực thi code tham chiếu. Nó điền issuer/client ID/client secret, Redis URL/TTL, PUBLIC_ORIGIN từ callback mẫu, discovery và JWKS đặc thù /t/display.company/oauth2/jwks. Chạy lại sẽ đồng bộ lại các giá trị IdP/Redis từ mẫu; giữ nguyên Wazo/CA đã cấu hình. Không sao chép credential MinIO/LLM/RDP/database vì SmartCall không sử dụng chúng. Secret chỉ ghi vào backend/.env bị ignore; Git chỉ chứa script và test. Sau pull ở máy khác phải chạy script tại máy đó với bản mẫu cục bộ hoặc tự điền .env; Git không chuyển secret.

Trong mẫu chưa có WAZO_ADMIN_USERNAME, WAZO_ADMIN_PASSWORD và WAZO_TENANT_UUID: cần quản trị cung cấp ba giá trị này. TLS_CA_FILE chưa có file CA để điền; chỉ cần khi Python chưa tin CA máy chủ. Context internal, template global/webrtc và dải 1000–9999 là mặc định thử nghiệm theo yêu cầu, chưa được xác nhận trên server. Redis TTL lấy từ mẫu nhưng thời hạn phiên thực tế vẫn bị giới hạn bởi exp của ID token.

Kiểm chứng cập nhật: 16 test backend đạt, gồm mapping env, giữ Wazo/CA, chạy lại không trùng biến và từ chối callback mẫu bất thường. Chưa gọi IdP/Redis/Wazo thật.


## Host bị thu hồi phiên và cleanup nhóm — 21/11/2026

Logout giữ snapshot token SDK/conference ID/call ID trước khi vô hiệu phiên, gửi DELETE độc lập có timeout và không cập nhật state theo ACK muộn. Không dùng token mới trong storage. UI/cache/scope vẫn bị dọn ngay, SDK nhánh chính được hangup trước disconnect. Finalize trong logout không gửi REST lần hai.

Phiên mới chờ revokeOtherDeviceSessions trước kết nối SIP; nếu có session khác thì đọc calls của user, lấy bridges và thử DELETE adhoc bằng token mới trước revoke. Wazo xác minh user là host; 404 của bridge thường/nhóm tham gia được bỏ qua, không cúp nhánh người khác. Lỗi server hiển thị chưa xác nhận. Logout thành viên không giải tán nhóm.

Kiểm chứng: 172 test frontend/17 file, lint/architecture/build/format đạt; bản gốc 124 test/build. Có ca token cũ 401 nhưng token mới dọn nhóm trước revoke, ACK muộn không phục hồi phiên và cuộc gọi mới không bị dọn. Chưa thử Wazo thật. Hai máy Web phải cập nhật; client cũ/Android chưa tích hợp và mất mạng hoàn toàn cần phối hợp server để bảo đảm tuyệt đối. Race server đang tạo hội nghị chưa trả ID còn cần thử tổng đài, không khẳng định đã cover mọi tình huống offline.

Theo yêu cầu rõ ràng của người dùng ngày 21/11/2026, backend/.env được đưa lên Git (ngoại lệ thay hướng dẫn ignore trước đây); chứa credential thật và người đọc repo/lịch sử Git có thể lấy được. Chỉ file này được cho phép track, không đưa hai bản dán tham chiếu hoặc các mật khẩu dịch vụ khác lên Git. backend/main.py đang có thay đổi của người dùng được giữ nguyên và không stage trong commit này.


## Logout Single ID để đổi tài khoản — 21/11/2026

Callback có nút Đăng xuất Single ID / Đổi tài khoản. Nút đăng nhập chỉ có khi chưa có hồ sơ, không còn gây hiểu nhầm rằng login lại sẽ xóa phiên SSO. Khi đã vào /calls bằng Single ID, nút logout trên header cũng dùng luồng IdP này. Login mật khẩu vẫn logout Wazo như trước.

Backend lưu ID token đã xác minh trong Redis cùng thời hạn phiên để làm id_token_hint; GET user_info vẫn không trả token đó. POST /api/auth/idp-logout yêu cầu Origin/CSRF, tạo ticket cookie HttpOnly sống 60 giây và xóa phiên backend. Web dọn SDK rồi điều hướng cửa sổ tới GET /api/auth/idp-logout/continue. Endpoint GETDEL một lần trả 302 tới end_session_endpoint lấy từ discovery với id_token_hint và post_logout_redirect_uri, giống logic logout mẫu. Không dùng fetch để theo redirect logout tới IdP.

SMARTCALL_IDP_LOGOUT_REDIRECT được lấy từ ONEAI_IDP__LOGOUT_REDIRECT trong mẫu; mặc định origin + /logout. Đường dẫn này cần được IdP cho phép. Web /logout chuyển về /login. Phần router.isReady trước mount cũng được đưa vào source để không mất sửa khởi động callback khi lấy code mới.

Phiên tạo trước bản sửa chưa có id_token_hint: chọn Về trang đăng nhập rồi Single ID một lần để tạo phiên mới, sau đó bấm logout/đổi tài khoản. Thiếu end_session_endpoint hoặc handoff hết hạn sẽ hiện lỗi, không giả báo đã logout IdP. Việc IdP có hiển thị form mật khẩu sau logout còn phụ thuộc chính sách SSO tích hợp của máy chủ; cần thử trên hệ thống công ty.

Kiểm chứng: 18 test backend và 175 test frontend/17 file; lint, architecture, build và format đạt. Chưa gọi logout IdP thật. Giữ nguyên đoạn chạy uvicorn trực tiếp do người dùng thêm trong backend/main.py ở working tree, không đưa đoạn đó vào commit tính năng.
