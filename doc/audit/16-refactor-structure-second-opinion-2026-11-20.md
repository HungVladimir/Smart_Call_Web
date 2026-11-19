# Đánh giá lại cấu trúc bản refactor và nhận xét từ công cụ khác

Ngày đối chiếu: 20/11/2026. Chỉ đọc bản clone; không thay đổi cấu trúc của hai dự án trong lượt đánh giá này.

## Kết luận

Nhận xét rằng bản clone chia thư mục quá sâu và chưa ưu tiên đủ việc làm gọn màn hình là có cơ sở. Với nhóm phát triển hiện tại, nên dùng cấu trúc nông, tên quen thuộc và luồng đi từ view tới service dễ lần theo. Bản refactor đã đi xa hơn nhu cầu ở một số chỗ.

Tuy nhiên, không thể suy ra rằng mọi tách biệt service/state/SDK đều thừa, rằng một file chứa toàn bộ code đương nhiên là nguồn dữ liệu duy nhất, hoặc chỉ tách component là đủ giải quyết vấn đề của dự án. Nhận xét bên ngoài có những khẳng định quá tuyệt đối và số liệu chưa nhất quán.

## 1. Số liệu đã đối chiếu

Đếm file và thư mục bên trong `src/`, không cộng prefix `frontend/` vào độ sâu của riêng bản clone. Đếm tất cả thư mục con, không chỉ thư mục cấp một.

| Chỉ tiêu | Bản gốc trước lượt sửa hiện tại | Bản gốc đang sửa | Bản clone |
| --- | ---: | ---: | ---: |
| File trong src | 23 | 23 | 53 |
| Thư mục con trong src | 9 | 9 | 44 |
| Độ sâu thư mục lớn nhất bên dưới src, không tính tên file | 2 | 2 | 3 |
| CallsView.vue, tổng dòng | 4.294 | Khoảng 4.300, thay đổi theo bản vá | 3.748 |

Bản clone có 26 thư mục lá chỉ chứa đúng một file. Con số 26 trong câu trả lời được dẫn lại phù hợp với nhóm thư mục một-file này, không phù hợp với tổng số thư mục con thực tế là 44.

Việc thêm prefix `frontend/` là yêu cầu phân chia Web/backend của người dùng. Không nên tính riêng prefix đó thành bằng chứng kiến trúc phức tạp. Phần đáng cân nhắc là các tầng bên dưới `src`, ví dụ `features/auth/mappers/` chỉ chứa một mapper.

## 2. Điểm phê bình đúng và cần tiếp thu

### Thư mục một-file xuất hiện quá nhiều

Các nhóm như `core/logging/LoggerService.js`, `core/events/EventHub.js`, `features/auth/mappers/userProfile.js` có thể đặt nông hơn mà không làm mất trách nhiệm của module.

Một file được tách hợp lý không đồng nghĩa phải có một thư mục riêng cho file đó. Đây là hai quyết định độc lập:

- Có cần module riêng để kiểm thử hoặc sở hữu một trách nhiệm không?
- Module đó có cần thêm một tầng thư mục không?

Ở bản clone, quyết định thứ hai đã được áp dụng nhiều hơn mức cần thiết.

### CallsView vẫn làm quá nhiều việc

Bản clone còn 3.748 dòng; mục tiêu làm người mới dễ đọc chưa được giải quyết đủ. Phân tích cấu trúc SFC hiện tại:

| Phần | Bản gốc đang sửa | Bản clone |
| --- | ---: | ---: |
| Template | Khoảng 910 dòng | Khoảng 869 dòng |
| Script | Khoảng 1.067 dòng | Khoảng 826 dòng |
| Style | Khoảng 2.318 dòng | Khoảng 2.051 dòng |

Các con số từng khối có thể lệch nhẹ với tổng file do tính dòng trống và thẻ SFC. Hơn nửa file clone là CSS; không được diễn giải 3.748 dòng thành 3.748 dòng nghiệp vụ. Dù vậy, template gần 900 dòng và script hơn 800 dòng vẫn là dấu hiệu màn hình chưa được chia đủ theo cụm giao diện.

Các cụm nên cân nhắc tách: khung cuộc gọi đang hoạt động, danh sách thành viên gọi nhóm, modal thêm người, danh bạ và bộ lọc, hàng liên hệ. Nên tách cả template, script liên quan và CSS của từng cụm; không chỉ chuyển CSS sang file khác để làm số dòng đẹp hơn.

### Điểm lắp ghép dịch vụ còn khó đọc

`createServices.js` khoảng 100 dòng không phải bản thân một lỗi, nhưng phải lắp nhiều service và gọi `attachGroupCoordinator` cùng `attachLifecycle`. Điều đó cho thấy các dịch vụ còn gắn với nhau về vòng đời.

Việc không có vòng import tĩnh không chứng minh các đối tượng đã ít phụ thuộc nhau lúc chạy. Muốn dễ bảo trì hơn cần làm rõ ai tạo listener, ai được chuyển trạng thái cuộc gọi, ai dọn session và ai chỉ đọc state.

### Có tách biệt chưa mang lại lợi ích tương xứng

Policy khoảng 21 dòng, state 9–15 dòng hoặc formatter 37 dòng không nhất thiết sai khi tách file. Nhưng việc kết hợp nhiều file nhỏ với nhiều tầng thư mục và tên khái niệm mới làm người mới phải học cả bản đồ dự án trước khi hiểu một hành vi.

Với quy mô này, có thể gộp hoặc đặt chúng gần nơi sử dụng hơn, vẫn giữ được kiểm thử và hợp đồng rõ ràng.

## 3. Những khẳng định cần sửa trong nhận xét được dẫn lại

### Không đủ cơ sở gọi đây là Feature-Sliced Design/Clean Architecture đầy đủ

Bản clone dùng các tên `features`, `core`, `shared` và cách truyền dependency. Điều đó không đồng nghĩa nó triển khai đầy đủ một mô hình kiến trúc cụ thể. Đây chủ yếu là cách tổ chức theo tính năng kết hợp phân tách trách nhiệm.

Vấn đề cần đánh giá là chi phí đọc và mức phụ thuộc thực tế, không phải một nhãn kiến trúc chỉ phù hợp nhóm hàng trăm người.

### Một file không đồng nghĩa Single Source of Truth

Single Source of Truth là một trạng thái có nơi sở hữu và quy tắc cập nhật rõ ràng. Nó không có nghĩa tất cả chức năng phải nằm trong một file.

Một file lớn vẫn có thể giữ cùng thông tin ở nhiều nơi như `this.isRegistered`, `callStore.isRegistered`, token trong session và token trong storage. Ngược lại, nhiều module vẫn có thể đọc chung một `callState` mà không nhân bản dữ liệu.

Bản gốc dễ tìm file hơn, nhưng `wazo.js` hơn 3.200 dòng trộn xác thực, WebSocket, SIP, cuộc gọi nhóm, hội nghị, timer và điều khiển âm thanh. Khi sửa logout, người đọc vẫn phải hiểu nhiều nhánh không thuộc xác thực. Số lượng tab ít không bảo đảm tổng lượng kiến thức phải giữ trong đầu ít.

### ON_CALL_ACCEPTED không bắt buộc đi qua toàn bộ chín file đã liệt kê

Luồng quan trọng trong clone là:

```text
SDK phát ON_CALL_ACCEPTED
  -> callback được CallController đăng ký
  -> createCallAcceptedHandler trong phoneEventHandlers
  -> cập nhật callState
  -> tùy nhánh gọi coordinator nhóm hoặc adapter âm thanh
  -> Vue render lại
```

`SdkAuthenticationGate` phục vụ xác thực, không nằm trên đường xử lý mỗi lần nghe máy. `callPolicy` chủ yếu dùng kiểm tra trước khi gọi. Không nên cộng mọi module liên quan đến cuộc gọi rồi khẳng định một event bắt buộc mở hết chúng.

Dù vậy, handler vẫn can thiệp state và gọi nhiều collaborator. Phê bình rằng khó lần theo là hợp lý; cách chứng minh bằng “bắt buộc 8 tab” chưa chính xác.

### Đường dẫn import của CallsView không đúng như mô tả

CallsView clone chủ yếu dùng alias `@/app/services.js`, `@/features/calls/state/callState.js` và `@/core/...`; chỉ một số import lân cận là đường dẫn tương đối. Không phải màn hình này toàn đường dẫn `../../../../features/...`.

Alias giảm độ dài import, nhưng không tự giải quyết sự phân tán trách nhiệm. Hai vấn đề cần được đánh giá riêng.

### Bản clone có nhiều giá trị hơn hai điểm được nêu

Các giá trị nên giữ gồm: khóa xác thực SDK khi timeout, vô hiệu session và kết quả muộn, kiểm tra quyền tín hiệu gọi nhóm, xác nhận API trước khi báo thành công, trả kết quả từng phần, cleanup media, mapper thuần và kiểm thử hành vi/Vue.

Một phần đã có trong bản gốc qua lượt audit trước khi clone; một phần được bổ sung trong refactor. Không nên quy hết công lao cho cấu trúc mới, cũng không nên bỏ các cơ chế này chỉ vì quyết định thư mục chưa phù hợp.

### Backend có README là đúng phạm vi đã được yêu cầu

Người dùng yêu cầu có chỗ dành cho backend và nói tài liệu/project mẫu IdP sẽ được cung cấp sau. README ghi rõ chưa có implementation là thông tin minh bạch. Nó không chứng minh đã triển khai backend, nhưng cũng không phải tự thân một lỗi kiến trúc.

Chưa đủ dữ liệu để khẳng định FastAPI + SQLite + SingleIdAuth sẽ được triển khai đúng bằng vài file cụ thể. Phải có giao thức/metadata/đăng ký ứng dụng, hợp đồng phiên và quy trình liên kết Wazo trước.

## 4. Hướng phù hợp hơn với dự án hiện tại

Trong ngắn hạn: tiếp tục sửa lỗi trên bản gốc; giữ nguyên bản clone để đối chiếu; không thêm một đợt đổi toàn bộ cây thư mục.

Nếu làm gọn từng bước, có thể giữ các nhóm quen thuộc:

```text
src/
  App.vue
  main.js
  router/
  config/
  views/
    CallsView.vue
    MessagesView.vue
    HistoryView.vue
    LoginView.vue
  components/
    call/
      DialerKeypad.vue
      ActiveCallPanel.vue
      GroupParticipants.vue
      AddParticipantModal.vue
    contacts/
      ContactList.vue
      ContactRow.vue
    common/
    layout/
  services/
    authService.js
    callService.js
    groupCallService.js
    chatService.js
    contactService.js
    historyService.js
    recordService.js
    sessionScope.js
  composables/
    useMicrophoneMeter.js
    useRecordingPlayer.js
  state/
    callState.js
    sessionState.js
  utils/
  assets/
```

Đây là phương án minh họa để thảo luận, chưa được áp dụng và không phải yêu cầu tạo đủ tất cả file. Nếu tiếp tục layout frontend/backend, đặt cây này dưới `frontend/src`; không thay đổi các tầng bên trong chỉ vì thêm prefix frontend.

Quyết định mới nhất của người dùng cho bản gốc: không thêm `UnavailableView`; gộp helper xác thực SDK và tín hiệu gọi nhóm vào `wazo.js`. Đã áp dụng lựa chọn này và không phát sinh file runtime mới. Cây minh họa trên chỉ là phương án cho tương lai nếu có nhu cầu, không phải kế hoạch đang thực hiện.

Các nguyên tắc chọn:

1. Tách theo một trách nhiệm có tên cụ thể, không tách theo số dòng máy móc.
2. Thư mục mới phải có lợi ích điều hướng rõ; không cần thư mục `domain/mappers/adapters` cho mọi tính năng.
3. Giữ service xác thực và gọi tách nhau khi cần sở hữu vòng đời khác nhau; không gom lại file lớn chỉ để giảm số file.
4. Tách UI theo các cụm người dùng nhận ra; mỗi component mang theo logic trình bày và CSS của nó.
5. Một thao tác có điểm vào chính rõ ràng; view không cần tự phối hợp nhiều service cấp thấp.
6. Chỉ dùng composable cho logic thực sự gắn vòng đời Vue; helper thuần không cần đổi tên thành composable.
7. Có kiểm thử trước khi di chuyển chức năng và đối chiếu hành vi sau mỗi bước nhỏ.
8. Không chọn mục tiêu “ít nhất bao nhiêu file” hoặc “nhiều nhất bao nhiêu file”. Kiểm tra xem người mới có lần được hành vi và xác định nơi sửa mà không phải đoán hay không.

## 5. Trách nhiệm đối với bản refactor trước

Bản refactor đã ưu tiên phân tách service và khả năng kiểm thử hơn mức độ quen thuộc của cây thư mục với người dùng. Đồng thời, việc chia màn hình lớn chưa được làm đủ. Vì mục tiêu ban đầu bao gồm dễ đọc cho người mới, đây là một điểm chưa đạt cần thừa nhận.

Hướng điều chỉnh là giảm tầng thư mục và làm rõ điểm vào nghiệp vụ, giữ các bản sửa có kiểm chứng; không cần chọn giữa hai cực là giữ nguyên một file lớn hoặc áp toàn bộ cấu trúc clone.
