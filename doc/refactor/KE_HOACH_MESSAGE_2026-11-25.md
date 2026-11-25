# Kế hoạch xây dựng quản lý nhóm message SmartCall

> Bản pilot đã có trong workspace. Mục triển khai bên dưới ghi lại cách bật, hợp đồng API hiện hành và phạm vi kiểm chứng.

**Goal:** Web và Android dùng chung nhóm, quyền admin, thêm/gỡ thành viên, đổi tên và lịch sử nguyên gốc, không gửi lệnh quản trị dưới dạng tin nhắn.

**Architecture:** FastAPI quản lý nhóm logic có ID cố định, quyền, từng lần kích hoạt phòng Wazo và nhật ký nghiệp vụ. Wazo lưu/phát tin mới; backend lưu bản lưu trữ nguyên gốc phục vụ lịch sử chung và phân trang, không POST lại tin cũ vào Wazo. Mọi ghi vào nhóm được quản lý đi qua backend.

**Tech Stack:** Vue hiện tại, FastAPI/httpx, Redis hiện có, SQLite riêng cho pilot một máy; PostgreSQL là cổng đánh giá trước triển khai nhiều máy hoặc khi đo tải cho thấy cần thiết.

**Spec:** Các quy tắc nghiệp vụ và hợp đồng trong chính tài liệu này; ràng buộc dự án trong `../../AGENTS.md`. Ngày 25/11/2026, baseline `codex/refactor-architecture`, commit `62faa28`, cây làm việc sạch trước khi viết kế hoạch.

## Bản triển khai pilot ngày 25/11

Các mục T0–T7 bên dưới là kế hoạch thiết kế ban đầu. Bản pilot có FastAPI, Web và hợp đồng cho Android. Android thực tế do đội ứng dụng tích hợp riêng.

**Bật pilot:** Trên backend đặt `SMARTCALL_CHAT_ENABLED=true`, cấu hình đúng tenant/CA Wazo và khởi động lại FastAPI. DB mặc định là `backend/data/messages.sqlite3`; có thể đặt `SMARTCALL_CHAT_DATABASE_PATH`. Trên frontend đặt `VITE_MANAGED_CHAT=true` trước khi khởi động Vite hoặc build lại. Reverse proxy chuyển toàn bộ `/api/chat/v1/` tới FastAPI. Nâng cấp đồng thời các client thí điểm. Để tạm dừng ghi và vẫn đọc nhóm qua API, giữ hai cờ đã bật và đặt `SMARTCALL_CHAT_READ_ONLY=true`, khởi động lại backend.

**Tạo nhóm và thử trên hai thiết bị:** A tạo ABCD. Mỗi người gửi một tin có thể nhận biết. A gỡ D và gửi thêm tin. D mở lịch sử, chỉ thấy đến lúc bị gỡ. A thêm lại D và D thấy cả tin trong lúc vắng mặt. Gỡ D lần hai, đổi tên và chuyển admin cho B. A mất quyền chỉnh nhóm. B bấm gọi, kiểm tra danh sách mời không có D. Ghi riêng kết quả nếu Android cũ vẫn nhắn vào phòng vật lý ABCD. Cờ bật chỉ tạo nhóm managed cho luồng mới. Nhóm cũ cần được xác minh và nhập rõ ràng.

**Hợp đồng Android hiện thực:** Lấy schema JSON ở `/openapi.json` trên backend đã bật tính năng. Các endpoint trong mục 6 dùng `X-Auth-Token` của chính người dùng. Gửi UUID ở `Idempotency-Key`; `If-Match` là số revision dạng chuỗi, bắt buộc với quản trị nhóm có sẵn. Gửi tin dùng cùng `clientMessageId` khi thử lại. Kết quả tạo/đổi nhóm là snapshot trực tiếp, gửi tin trả bản ghi nguồn. GET `operations/{key}` nhận UUID client đã dùng, trả `pending|done|failed`. Khi chưa rõ ACK, nhóm báo 409 để đối soát. GET `events` trả một batch SSE rồi kết thúc, kết nối lại bằng cursor hoặc Last-Event-ID. GET `changes` trả cùng dữ liệu dạng JSON. Giữ cursor theo host/tài khoản. Lúc mở app lần đầu lấy cursor trước khi nạp snapshot để bù sự kiện đồng thời. GET `groups/{groupId}/activity` cho nhật ký quản trị. Danh sách tin mặc định 50, `nextCursor` dùng để tải trang trước. Dùng `capabilities`, `status`, `version` và `managedRoomIds` để điều khiển UI, bỏ sự kiện Chatd thô của các phòng đã quản lý. Khi gặp 409 do revision cũ, tải snapshot và để người dùng xem lại thao tác. Lấy roster mới ngay trước khi gọi.

**Dữ liệu cũ:** Vận hành viên lập manifest từ bản xuất đã được phép đọc. Trường gốc gồm `groupId,tenantUuid,adminUuid,title,reviewedSource,activations`. Xếp activation theo thứ tự sử dụng, mỗi phần có `roomId,members,expectedCount,messages`. Mỗi tin dùng dữ liệu Wazo gốc gồm `uuid,room.uuid,tenant_uuid,user_uuid,created_at,content`, xếp theo thứ tự đã kiểm kê. Chỉ đưa các tin đã xác định thuộc giai đoạn đó. Đối chiếu tag/FWD thủ công, nội dung được nhập sẽ hiển thị nguyên văn. Chạy `python backend/chat_import.py --db <DB> --manifest <FILE>` để dry-run. Dừng ghi, sao lưu, kiểm tra rồi thêm `--apply`. Tool rollback toàn bộ nếu sai nguồn, trùng tin hoặc xung đột phòng. Không import tự động chỉ dựa vào tên hoặc cùng thành viên.

**Khôi phục khi timeout:** Sau khi dừng các worker, sao lưu SQLite bằng backup API. Dùng khóa client tra operation. Nếu đã ghi, lấy biên nhận gốc từ Wazo và đối chiếu với request/thời điểm trong log. Chạy `python backend/chat_recovery.py --db <DB> --key <UUID> --receipt <FILE>`, thêm `--apply` sau khi dry-run đúng. Nếu đã có chứng cứ Wazo không thực hiện lệnh, file có `tenant_uuid,verified_not_applied=true,evidence_reference` để đánh failed. Không dùng việc hai tin cùng nội dung làm bằng chứng duy nhất. Nếu chưa xác định được, tiếp tục giữ pending. Khi dùng tên phòng SmartCall/<operation UUID>, UUID đó thuộc thao tác backend; tiêu đề người dùng nằm trong snapshot.

**Giới hạn kiểm chứng:** test cục bộ dùng HTTP Chatd mô phỏng; cần bốn tài khoản thử trên Wazo công ty và Web/Android mới để nghiệm thu quyền đọc/gửi thật. Cần đo 3.000 kết nối qua proxy/Wazo/ổ đĩa dự kiến trước khi chọn DB production. Bản pilot áp dụng cho một tenant trên một Wazo host cố định của backend.

## 1. Căn cứ và giới hạn

- `frontend/src/services/data/chatService.js`: add/remove hiện chủ động báo lỗi; rename/đóng nhóm vẫn dùng tag trong nội dung. Không mở lại các hàm cũ đơn thuần.
- Quan sát người dùng: ABCD → ABC → ABCD → ABC trả lại hai UUID phòng đã dùng. Upstream Chatd cũng tìm phòng có đúng tập người trong tenant trước khi tạo.
- HTTP 201 tạo phòng không chứng minh UUID mới. Tên yêu cầu mới có thể bị bỏ qua khi tái sử dụng phòng.
- API phòng hiện được kiểm tra không có hợp đồng quản trị membership/rename đáp ứng yêu cầu này. Phải kiểm tra phiên bản công ty trước khi triển khai.
- Backend hiện chặn request ghi thiếu Origin hợp lệ. Android không thể mặc định dùng nguyên hợp đồng cookie của Web.
- Không sửa Wazo DB, không tự cấp quyền admin Wazo cho client, không coi token IdP là token Wazo.
- Không thêm pin/read receipt/đã gửi/đã xem. Badge chưa mở chỉ lưu metadata local theo host/UUID; không lưu nội dung chat vào localStorage.
- Không sửa hai tài liệu người dùng yêu cầu giữ nguyên: `doc/HUONG_DAN_TOAN_BO_LUONG_SMARTCALL.md`, `doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md`.
- Tên biến tiếng Anh, comment giải thích tiếng Việt; giữ cấu trúc services một cấp theo nhóm hiện có, kiểm tra phiên và cleanup mọi tác vụ bất đồng bộ.

Nguồn đối chiếu (upstream, không thay cho test server công ty):

- https://raw.githubusercontent.com/wazo-platform/wazo-chatd/master/wazo_chatd/plugins/rooms/api.yml
- https://raw.githubusercontent.com/wazo-platform/wazo-chatd/master/wazo_chatd/plugins/rooms/http.py
- https://raw.githubusercontent.com/wazo-platform/wazo-chatd/master/wazo_chatd/plugins/rooms/notifier.py

## 2. Quy tắc nghiệp vụ đề xuất

| Nội dung | Quy tắc phiên bản đầu |
| --- | --- |
| Định danh | Một `groupId` tồn tại xuyên suốt; `roomId` chỉ là địa chỉ vận chuyển của Wazo |
| Quy mô | Nhóm 3–100 người, tính cả admin; đối chiếu giới hạn server khi kiểm chứng |
| Admin | Đúng một admin đang hoạt động; người tạo là admin |
| Quyền | Chỉ admin thêm/gỡ, đổi tên, chuyển admin, đóng nhóm; backend kiểm tra mỗi lệnh |
| Gỡ người | Sau thao tác còn ít nhất 3 người; không tự biến nhóm thành DM |
| Gỡ admin | Không được; phải chuyển admin trước. Không tự chọn người khác khi admin offline |
| Chuyển admin | Chỉ sang một thành viên đang hoạt động, nguyên tử; không đổi phòng Wazo |
| Rời nhóm | Chưa cung cấp ở bản đầu, tránh phát sinh luồng tự gỡ/chọn admin chưa thống nhất |
| Đổi tên | Trim, 1–100 ký tự Unicode, bỏ ký tự điều khiển; render text, không HTML; không đổi phòng |
| Thêm người | UUID cùng tenant, tồn tại, không trùng; một lệnh thêm nhiều người là tất cả hoặc không ai |
| Lịch sử | Đề xuất: thành viên hiện tại được đọc toàn bộ lịch sử chung của nhóm, kể cả khi vừa được thêm/lại |
| Người bị gỡ | Giữ bản lịch sử chỉ đọc đến mốc bị gỡ; không nhận nội dung mới hoặc roster mới |
| Thêm lại | Tiếp tục nhóm cũ và lịch sử chung; không clear tin nhắn để giả một nhóm mới |
| DM | Giữ riêng; tạo nhóm từ DM không tự chia sẻ lịch sử riêng tư |
| Đóng nhóm | Đánh dấu closed, khóa ghi trong SmartCall, giữ lịch sử; không gọi đó là xóa dữ liệu Wazo |

Chính sách chia sẻ toàn bộ lịch sử là lựa chọn sản phẩm đề xuất, không phải quyền do Wazo tự cấp. Dialog thêm người phải thông báo rõ người được thêm sẽ thấy lịch sử nhóm. Nếu cần giấu khoảng thời gian vắng mặt, phải đổi chính sách trước bước triển khai lịch sử, không chỉ sửa UI.

Admin bị khóa/xóa tài khoản: khóa thao tác quản trị nhóm, vận hành có công cụ chuyển admin được xác thực và audit riêng. Không suy quyền từ tên, alias hay tin nhắn chào mừng. Admin chat không liên quan host của cuộc gọi.

## 3. Tái sử dụng phòng và quyền sở hữu

| Thao tác | groupId | activationId | Phòng Wazo | Thành viên |
| --- | --- | --- | --- | --- |
| Tạo | G1 | V1 | X | ABCD |
| Gỡ D | G1 | V2 | Y | ABC |
| Thêm D | G1 | V3 | X | ABCD |
| Gỡ D | G1 | V4 | Y | ABC |

`revision` tăng với mỗi thay đổi metadata/quyền; `activationId` chỉ đổi khi chuyển phòng/thành viên. Không dùng hai khái niệm thay thế nhau. Đổi tên vẫn cùng activation.

- Một phòng vật lý chỉ được gắn với một nhóm logic trong toàn bộ vòng đời. Unique `(tenantId, roomId)` trong bảng sở hữu.
- Nhận lại X thuộc G1 thì tạo V3 và tiếp tục; không xóa V1, không gắn toàn bộ lịch sử X vào V3.
- Nhận UUID thuộc nhóm khác, DM hoặc phòng cũ chưa được xác minh: dừng với `ROOM_OWNERSHIP_CONFLICT`, giữ nguyên nhóm hiện tại. Không tự merge.
- Hai nhóm độc lập cùng tập người có thể không tạo được trên Wazo này. Báo xung đột; đây là giới hạn thật của lựa chọn vận chuyển, không thể giải quyết chỉ bằng thêm groupId.
- Phòng đã đóng vẫn giữ ownership để tránh dùng lại tin cũ cho một nhóm mới khác.
- Không tái sử dụng timestamp đơn lẻ làm ranh giới; gắn message ID được Wazo xác nhận vào activation và thứ tự backend.

## 4. Giới hạn an toàn phải nói đúng

Backend quản lý quyền SmartCall, không tự thu hồi membership vật lý trong Chatd. Người bị gỡ có thể vẫn đọc phòng cũ qua Wazo hoặc gửi vào đó nếu quyền Wazo cho phép. Tin gửi trực tiếp vào phòng cũ có thể tới những người còn là thành viên vật lý. Web/Android mới không hiển thị các tin không thuộc luồng managed-group, nhưng như vậy không phải thu hồi quyền trên tổng đài.

Để cam kết chặn mọi truy cập vượt luồng, phải kiểm chứng có thể chặn endpoint ghi/đọc Chatd trực tiếp từ client hoặc áp ACL/proxy phù hợp, đồng thời giữ SIP/calls hoạt động. Không mặc định Wazo có ACL phân biệt đủ chi tiết. Nếu không làm được, chỉ phát hành với cam kết giới hạn ở client SmartCall đã nâng cấp; nếu yêu cầu bảo mật bắt buộc mạnh hơn thì dừng triển khai và đổi phương án máy chủ chat.

Không dùng việc lọc WebSocket ở UI để khẳng định không rò dữ liệu. Sự kiện Chatd có thể chứa nội dung và phát cho thành viên vật lý. Client cũ/direct API là cổng kiểm chứng bắt buộc.

## 5. Lưu trữ và tính nguyên vẹn

Chọn DB message riêng, không trộn với bảng identities. SQLite WAL, transaction ngắn, busy timeout hữu hạn, backup bằng SQLite backup API cho pilot một máy. Không giữ transaction SQL trong lúc gọi Wazo. Chưa khẳng định SQLite đáp ứng tải thật; thử tải trước khi chọn production. DB production nằm trên volume bền vững và bị ignore Git.

| Bảng | Trách nhiệm và khóa quan trọng |
| --- | --- |
| `chat_groups` | tenant/groupId, title, adminUuid, revision, activeActivationId, status |
| `chat_membership_periods` | UUID, joinedSequence, leftSequence; mỗi lần tham gia là một dòng; unique một kỳ active/user/group |
| `chat_room_ownership` | tenant/roomId unique → groupId; giữ cả khi nhóm đóng |
| `chat_room_activations` | activationId, groupId, roomId, roster snapshot, start/end sequence, operationId |
| `chat_messages` | source host/tenant/roomId/messageId unique; author UUID, original timestamp/content, activationId, sequence, provenance |
| `chat_operations` | operationId, actor, idempotency key, payload hash, expected revision, trạng thái, kết quả/lỗi đã làm sạch |
| `chat_events` | eventId, sequence, loại, actor, revision, audience; sự kiện quản trị có cấu trúc và thông báo thay đổi |
| `chat_schema_versions` | migration version, thời điểm áp dụng |

Lưu bản nguyên gốc của tin đã được xác nhận để thành viên mới đọc được lịch sử chung mà không cần token của thành viên cũ. Đây là một bản lưu trữ phía backend, không phải copy/gửi lại thành tin mới trên Wazo. Giữ nội dung và người gửi thật, không thay author bằng người thực hiện thêm thành viên. Mã hóa volume/backup, giới hạn quyền vận hành, quy định lưu trữ và xóa dữ liệu trước production.

Không hash nội dung để quyết định hai tin trùng nhau: một người có thể gửi cùng nội dung hai lần hợp lệ. Hash chỉ hỗ trợ phát hiện thay đổi bản lưu; chống trùng bằng source ID. Tin cũ dạng FWD giữ provenance `legacy_forwarded`, không tuyên bố khôi phục được tác giả/thời gian gốc đã mất.

Trước khi chuyển membership, lịch sử được cam kết phải có checkpoint nhập đầy đủ. Nếu chưa đầy đủ, phản hồi `HISTORY_SYNC_REQUIRED`, chạy đồng bộ có tiến độ; không âm thầm lấy 25/50 tin gần nhất rồi báo đã giữ toàn bộ. Sau khi chuyển, đọc lịch sử từ DB chung, phân trang 50 mặc định, tối đa 100, cursor theo group/sequence/snapshot và quyền đọc hiện tại. Sự kiện quản trị là mục riêng trong timeline, không phải nội dung Chatd.

## 6. Hợp đồng API chung đề xuất

Prefix `/api/chat/v1`; đây là endpoint SmartCall sẽ xây, không phải API sẵn có của Wazo.

| Method/path | Chức năng |
| --- | --- |
| GET `/groups?cursor=&limit=50` | Danh sách nhóm được phép xem; một dòng/group, không tải lịch sử từng phòng |
| POST `/groups` | Tạo nhóm với title và memberUuids; admin lấy từ danh tính đã xác thực |
| GET `/groups/{groupId}` | Snapshot tên/quyền/thành viên/revision/capabilities |
| PATCH `/groups/{groupId}` | Đổi title |
| POST `/groups/{groupId}/members` | Thêm một hoặc nhiều memberUuids |
| DELETE `/groups/{groupId}/members/{userUuid}` | Gỡ một người |
| POST `/groups/{groupId}/admin-transfer` | Chuyển admin sang targetUserUuid |
| POST `/groups/{groupId}/close` | Đóng nhóm, không xóa vật lý |
| GET `/groups/{groupId}/messages?cursor=&limit=50` | Timeline đã lọc quyền và chống trùng |
| POST `/groups/{groupId}/messages` | Gửi content với clientMessageId và expectedActivationId |
| GET `/operations/{operationId}` | Tra kết quả khi chờ/timeout, chỉ người có quyền |
| GET `/changes?cursor=` | Đọc thay đổi theo người dùng, cursor bền vững |
| GET `/events` | SSE thông báo invalidation theo người dùng, có khôi phục cursor |

Lệnh quản trị bắt buộc `Idempotency-Key` và `If-Match` revision. Cùng key/cùng payload trả operation cũ; cùng key/khác payload trả 409. Gửi tin dùng clientMessageId riêng, không dùng revision tên nhóm để chặn gửi vô lý; kiểm tra active membership và expectedActivationId.

Snapshot có `groupId`, `title`, `revision`, `activeActivationId`, `status`, `members`, `capabilities`. Người bị gỡ nhận snapshot giới hạn, không roster hiện tại/room mới. Client không truyền roomId đích để backend tin theo. Lỗi có `{code, message, operationId, retryable}`; không chứa token/upstream URL bí mật.

Các mã chính: 401 phiên/token không hợp lệ; 403 thiếu quyền; 404 nhóm không thuộc phạm vi người dùng; 409 stale revision/room conflict/key conflict; 422 tên/số thành viên sai; 202 operation còn xử lý; 503 upstream không khả dụng. Không đồng nhất 202 với thao tác đã thành công.

Xác thực: thêm dependency `require_chat_actor` xác minh Wazo user token với Wazo Auth theo hợp đồng đã kiểm chứng, lấy UUID/tenant từ kết quả, tuyệt đối không tin header actor do app gửi. Web và Android có thể dùng cùng token Wazo đã có. Tách middleware cho `/api/chat/v1`: nhánh token không dựa vào cookie nên không yêu cầu Android giả Origin; request browser có Origin vẫn kiểm tra allowlist. Giữ nguyên Origin+CSRF cho auth/cookie hiện tại. Không nhận token qua URL, không log token, không lưu lâu dài vào DB message. Host Wazo do cấu hình backend chọn, không nhận URL tùy ý từ client.

## 7. Giao dịch thêm/gỡ và gửi tin đồng thời

1. Xác thực actor/tenant, kiểm tra admin, payload, số thành viên, revision và idempotency.
2. Ghi operation `preparing`, chiếm quyền xử lý theo group bằng trạng thái/CAS bền vững trong DB; Redis chỉ hỗ trợ giảm tranh chấp. Khi restart vẫn không mất hàng rào bảo vệ.
3. Ngăn nhận lượt gửi mới cho group đang chuyển; xử lý hết hoặc đối soát lượt gửi đã nhận. Client giữ nháp và hiển thị đang cập nhật nhóm, không tự gửi lại.
4. Xác nhận lịch sử/checkpoint, gọi Wazo bằng danh tính phù hợp đang ở roster (bản đầu là admin đang thao tác). Không dùng token admin hệ thống làm người gửi giả.
5. Xác minh UUID, tenant, toàn bộ roster và ownership phòng trả về. Không chỉ kiểm tra HTTP success.
6. Commit DB nguyên tử: đóng activation cũ, tạo activation mới, membership periods, revision, operation committed và event cùng transaction.
7. Sau commit, đánh thức SSE; DB event log là nguồn khôi phục nếu phát signal lỗi. Client lấy snapshot mới và giữ nguyên groupId/UI.

Trạng thái operation: `preparing → upstream_pending → committed`, hoặc `failed`, hoặc `reconciling`. Không tự đánh failed khi upstream có thể đã ghi.

Nếu tạo phòng thành công nhưng DB lỗi: giữ operation để đối soát; không tự xóa phòng hoặc đảo DB bằng tay. Nếu crash sau commit trước response, retry trả cùng kết quả. Nếu timeout có kết quả chưa biết, giữ nhóm tạm không ghi cho đến khi rõ; ưu tiên đúng dữ liệu hơn tự mở lại cả hai phòng.

Gửi tin: ghi intent → Wazo POST đúng active room dưới token tác giả → xác nhận message ID → transaction lưu nguyên gốc, activation, sequence và event → trả kết quả. SSE/Wazo event đến trước ACK không được gắn theo activation hiện tại một cách mù quáng; đợi mapping/reconcile. Không bảo đảm exactly-once nếu Wazo không có idempotency: POST timeout không được tự retry theo nội dung. Operation chưa rõ phải giữ trạng thái đối soát; cần người gửi xác thực lại nếu token đã hết hạn. Không lưu credential quản trị để giả người gửi.

## 8. Realtime, Android và hành vi giao diện

- Nhóm managed nhận timeline/quyền từ backend; raw Chatd events không trực tiếp thêm tin vào state nhóm. DM tiếp tục đường hiện tại.
- Một SSE connection mỗi phiên đang hoạt động, không một connection cho từng nhóm. Auth bằng cơ chế hỗ trợ header token (fetch stream/client Android), không token query string. Refresh/reconnect xác thực lại, cleanup khi logout.
- Event chứa ID/revision cần thiết; lấy snapshot/timeline qua API được kiểm tra quyền. Recipient tính tại transaction: người bị gỡ chỉ nhận removed, người còn lại nhận group changed. Không phát nội dung nhạy cảm bằng roster cũ.
- Event trùng hoặc sai thứ tự: dedup eventId, bỏ revision cũ, phát hiện gap thì sync. Cursor hết retention trả yêu cầu full snapshot. Redis pubsub chỉ đánh thức, không là lịch sử duy nhất.
- Android bị hệ điều hành dừng SSE: resume lấy changes/snapshot. Push notification nền là hạng mục tích hợp riêng, không hứa SSE bảo đảm khi app bị kill.
- Đổi tên có hiệu lực Web/Android sau ACK/sync. UI nhận capabilities từ server; server vẫn kiểm tra mọi request.
- Đang xem nhóm và bị gỡ: khóa composer ngay sau event/xác minh; giữ lịch sử được phép. Nếu thiết bị offline, backend vẫn chặn gửi khi nó kết nối lại.
- Badge gắn groupId, chỉ tăng cho tin đến mới hợp lệ, không tăng vì backfill, chuyển phòng hay event quản trị; dedup source message ID.
- Người đang được thêm không tính là thành viên cho đến commit. Thất bại giữ snapshot trước đó và hiển thị lỗi cụ thể.
- Không tải toàn bộ người/tin khi mở danh sách. Tìm người để thêm qua dịch vụ danh bạ; không phụ thuộc người đang nằm ở trang danh bạ hiện tại.

## 9. Di chuyển dữ liệu cũ

1. Inventory chỉ đọc: room UUID/roster/tags, số tin, mapping nhóm và dữ liệu FWD. Phân loại managed mới, legacy chưa chuyển, DM.
2. Không suy admin chắc chắn từ lời chào/tin SYSTEM. Xuất danh sách cần xác nhận admin và chuỗi phòng; trường hợp không chứng minh được thì giữ legacy read-only.
3. Import có dry-run, backup và checkpoint; chỉ đọc bằng quyền nguồn đã được kiểm chứng, không giả định admin token đọc mọi phòng. Lưu tin gốc và provenance, không sửa Wazo.
4. Chỉ converter legacy diễn giải marker đã xác minh. Tin mới chứa chữ `[SYSTEM:...]` là text bình thường, không trở thành lệnh.
5. Nhóm legacy đã chuyển được client mới ẩn các phòng vật lý, hiện một groupId. Phòng chưa xác định không tự gộp chỉ vì cùng tên/tập người.
6. Không hứa phục hồi lịch sử chưa từng được copy hoặc đã mất trước đây. Báo phần thiếu và kiểm tra trước khi cho chuyển membership.

## 10. Bản đồ thay đổi dự kiến

Các file mới dưới đây là đề xuất, chưa tạo code:

| File | Trách nhiệm |
| --- | --- |
| `backend/chat_models.py` | DTO, enum, validation và schema API |
| `backend/chat_auth.py` | Actor/tenant đã xác thực, không thay hợp đồng OIDC |
| `backend/chat_store.py` | Schema version, SQL transaction/CAS, ownership, archive/event log |
| `backend/chat_wazo.py` | Adapter Chatd/Auth đã kiểm chứng, timeout và mapping nguyên gốc |
| `backend/chat_service.py` | Quy tắc nhóm/admin/activation, điều phối operation và gửi tin |
| `backend/chat_routes.py` | Router, mã lỗi, pagination, SSE và changes |
| `backend/main.py`, `backend/config.py` | Lắp ghép lifecycle/router, cấu hình DB/feature flag, phân nhánh middleware |
| `frontend/src/services/data/chatGroupApi.js` | HTTP backend chung, không logic giao diện |
| `frontend/src/services/data/chatService.js` | Điều phối managed/legacy/DM, state chat hiện có; bỏ phát marker cho managed |
| `frontend/src/services/realtime/chatEvents.js` | SSE, cursor, reconnect, hủy phiên |
| `frontend/src/services/createServices.js` | Lắp ghép và cleanup; giữ ownership state chat ở ChatService |
| `frontend/src/views/MessagesView.vue` | Command thêm/gỡ/rename/admin, hiển thị quyền và tiến độ |
| `frontend/src/components/messages/GroupMembersDialog.vue` | Danh sách thành viên/chọn người/phát event, không tự HTTP |
| `frontend/src/components/messages/MessageList.vue`, `MessageComposer.vue` | Timeline quản trị riêng, phân trang/khóa gửi đúng trạng thái |

Android là sản phẩm riêng: bàn giao OpenAPI, fixture contract và acceptance checklist cho đội Android. `FileQuest/` chỉ dùng tham khảo, không coi sửa đó là đã triển khai app thật.

## 11. Trình tự triển khai và nghiệm thu từng tác vụ

### T0 — Kiểm chứng hợp đồng và chốt điều kiện phát hành

- [ ] Trên tài khoản/phòng thử riêng: ABCD→ABC→ABCD→ABC, ghi UUID/roster/message IDs/HTTP; kiểm tra thứ tự, pagination và event trước/sau ACK.
- [ ] Kiểm tra quyền đọc/gửi trực tiếp của người đã bị gỡ, phòng trùng với nhóm khác, token hết hạn, khả năng chặn raw endpoint mà không ảnh hưởng calls.
- [ ] Chốt hợp đồng token Web/Android, cách lấy lịch sử hợp lệ, chính sách chia sẻ toàn bộ lịch sử và giới hạn client cũ.
- [ ] Đầu ra: bảng khả năng theo phiên bản Wazo thật. Nếu không đạt ranh giới bảo mật yêu cầu thì dừng, không dựng tiếp trên giả định.

### T1 — DB, xác thực và nhóm cơ bản

- [ ] Viết test thất bại cho tenant isolation, token giả/hết hạn, Android không Origin, cookie auth vẫn có CSRF, migration chạy hai lần và unique ownership.
- [ ] Triển khai `require_chat_actor(request) -> ChatActor(tenant_id, user_uuid)`; `ChatStore.migrate()` và `ChatService.create_group(actor, command) -> OperationResult`.
- [ ] DTO cố định: `GroupSnapshot`, `OperationResult(operationId,status,result,error)`, `MessagePage(items,nextCursor)`. Dùng một schema OpenAPI cho cả hai client.
- [ ] Nghiệm thu: tạo/đọc nhóm đúng quyền, không nhận adminUuid tùy ý; phòng trùng không bị nhập nhằng; chạy bộ test backend.

### T2 — Lịch sử nguyên gốc và gửi tin có đối soát

- [ ] Viết test source ID chống trùng, hai tin cùng nội dung vẫn là hai tin, cursor ổn định khi có tin mới, token tác giả đúng, timeout không tự POST lần hai.
- [ ] Triển khai `send_message(actor, group_id, command) -> OperationResult`, `list_messages(actor, group_id, cursor, limit) -> MessagePage` và import checkpoint trong store/service/adapter.
- [ ] Test crash sau Wazo ACK trước DB commit; phải phục hồi được mapping hoặc giữ reconciling, không báo thành công khi thiếu chứng cứ.
- [ ] Nghiệm thu: giữ nguyên author/time/content/source ID, backfill nhiều trang không cắt 50 tin, không dùng client time làm sequence.

### T3 — Chuyển thành viên nguyên tử

- [ ] Viết test ABCD→ABC→ABCD→ABC có 4 activation, 2 room, 1 group; không lặp tin và không clear lịch sử.
- [ ] Triển khai `change_members(actor, group_id, command) -> OperationResult` với CAS/idempotency, drain sends, ownership và checkpoint.
- [ ] Test hai lệnh cùng revision chỉ một lệnh thắng; gửi tin/gỡ người đồng thời; crash ở mỗi mốc; response UUID đúng nhưng roster sai phải bị từ chối.
- [ ] Test 3→2 bị chặn, thêm người trùng không đổi activation, thêm nhiều người lỗi một UUID không ghi một phần.
- [ ] Nghiệm thu: người bị gỡ không gửi qua backend sau cutover, người còn lại giữ timeline, thêm lại theo chính sách đã chốt.

### T4 — Đổi tên, admin và đóng nhóm

- [ ] Viết test member gọi API trực tiếp bị 403; không gỡ admin cuối; chuyển admin làm quyền người cũ mất ngay; revision stale không ghi đè.
- [ ] Triển khai `rename_group`, `transfer_admin`, `close_group`, cùng nhận actor/group_id/command và trả OperationResult.
- [ ] Test tên rỗng/Unicode/HTML/ký tự điều khiển; đổi tên không gọi tạo phòng và không POST tag Chatd.
- [ ] Nghiệm thu: sự kiện có cấu trúc, audit actor chính xác; group closed khóa ghi nhưng đọc lịch sử theo quyền.

### T5 — Đồng bộ và Web

- [ ] Test SSE trùng/out-of-order/gap/reconnect, logout giữa request, response từ phiên trước không ghi state, người bị gỡ không nhận payload roster mới.
- [ ] Triển khai `ChatGroupApi` theo OpenAPI, nối command ChatService và View/components; realtime chỉ cập nhật sau kiểm tra phiên/quyền/revision.
- [ ] Test selection giữ groupId qua đổi room, composer giữ nháp khi lỗi, badge không nhân đôi lúc backfill, DM/calls không bị thay luồng.
- [ ] Nghiệm thu: hai trình duyệt đồng bộ tên/admin/member và lịch sử; chạy lint/architecture/frontend tests/build/format.

### T6 — Android và chuyển đổi legacy

- [ ] Bàn giao schema/fixture/mã lỗi; Android triển khai cùng API và SSE/resume, bỏ xử lý raw room cho nhóm managed.
- [ ] Viết local test importer cho tag giả, FWD không rõ tác giả, chuỗi phòng không rõ, import lặp/crash; giữ dữ liệu nguồn.
- [ ] Dry-run migration một nhóm thử, so số tin/ID/author/content trước-sau. Không tự nhận ownership của phòng không rõ.
- [ ] Nghiệm thu chéo: Web thêm/Android gỡ, Android rename/Web sync, Android offline khi bị gỡ, đăng nhập lại, app bị kill/resume.

### T7 — Tải, vận hành và rollout

- [ ] Đo pilot với dữ liệu tăng dần đến 3.000 kết nối, hỗn hợp gửi tin/tải trang/chuyển nhóm, nhóm dài nhiều activation và reconnect đồng thời.
- [ ] Mục tiêu ban đầu để đo: p95 đọc metadata/lịch sử từ DB dưới 500 ms, SSE invalidation dưới 2 giây khi online; thời gian gửi/chuyển nhóm báo riêng theo Wazo. Không coi mục tiêu là kết quả đã đạt.
- [ ] Đo RAM/CPU, SQLite write wait, event backlog, timeout Wazo, archive growth; chọn PostgreSQL trước production nếu contention/HA yêu cầu. Không chỉ dựa vào số online.
- [ ] Test backup/restore, disk full, Redis/DB/Wazo outage, restart giữa operation, token expiry khi reconciling. Alert operation treo và ownership conflict, không log nội dung/token.
- [ ] Pilot cùng Web/Android mới; feature flag theo nhóm/tenant. Tắt flag khi lỗi đưa nhóm managed về chỉ đọc, không quay lại phát tag hoặc client cũ ghi thẳng vào phòng.
- [ ] Cập nhật `doc/refactor/PROGRESS.md`, `ARCHITECTURE.md`, `VERIFICATION.md`, `doc/HUONG_DAN_FRONTEND_CHO_NGUOI_MOI.md` và API contract; không thay hai tài liệu giữ nguyên.

## 12. Bộ kiểm chứng và trọng tâm review

Lệnh hiện có khi triển khai:

```powershell
.\backend\.venv\Scripts\python.exe -X utf8 -m unittest discover -s backend/tests
npm run lint
npm --prefix frontend run check:architecture
npm test
npm run build
npm --prefix frontend run format:check
```

Đề xuất local test files: `backend/tests/test_chat_auth.py`, `test_chat_store.py`, `test_chat_groups.py`, `test_chat_messages.py`, `test_chat_migration.py`; `frontend/tests/unit/managed-chat.test.js`, `frontend/tests/components/managed-chat.test.js`. Tuân thủ ignore test hiện có, ghi rõ cách cung cấp bộ test khi bàn giao máy khác; không báo CI có test nếu clone không chứa chúng.

Năm trọng tâm review đã được gắn test vào T0–T7:

1. Room UUID tái sử dụng hoặc đụng nhóm khác: T0/T1/T3, không trộn hội thoại.
2. Gửi tin đang bay khi chuyển activation/crash: T2/T3/T7, không gắn nhầm đoạn, không báo ACK giả.
3. Client cũ/raw API và event chứa dữ liệu: T0/T5/T6, không nhầm ẩn UI với thu hồi quyền thật.
4. Người mới/được thêm lại và lịch sử legacy thiếu: T2/T3/T6, quyền chia sẻ rõ và không bịa lịch sử.
5. Android không Origin, offline, token hết hạn và reconnect: T1/T5/T6/T7, không mở toàn bộ middleware và không ghi state phiên cũ.

Điều kiện hoàn tất: test tự động phù hợp đạt; thử Wazo thật và Web/Android chéo đạt; chính sách lịch sử và giới hạn raw API được chấp nhận; backup/restore và timeout recovery chứng minh được. Chưa đủ các điều kiện này thì chưa coi feature hoàn thiện.
