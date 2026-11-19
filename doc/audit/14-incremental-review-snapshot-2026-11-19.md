# Phạm vi review tăng dần và snapshot — 19/11/2026

[Đánh giá chất lượng](12-code-quality-review-2026-11-19.md) · [Phương án refactor](13-refactor-blueprint-2026-11-19.md)

## Cách bỏ qua file không đổi

Dùng bảng SHA-256 trong `09-audit-coverage.md` làm baseline có sẵn cho source. So sánh hash nội dung thay vì thời gian sửa file hoặc số dòng.

Kết quả: **23 file src, 9 không đổi, 13 thay đổi, 1 file mới** so với baseline. Các file không đổi được kế thừa kết quả review trước, không mở lại toàn bộ nội dung để audit lại. Phân tích thống kê/import/AST có thể đọc chúng bằng công cụ để lập bản đồ tổng thể; điều này không được coi là một vòng deep review mới.

`sessionScope.js` mới so với baseline cũ nhưng đã được đọc và giải thích ở lượt ngay trước; lượt này kế thừa phần hiểu đó và kiểm tra cấu trúc. Không coi file mới so với baseline là chưa từng được đọc trong cuộc trò chuyện.

Repo có thêm các file tham chiếu, tài liệu, ảnh, cấu hình IDE và dữ liệu sinh từ tooling. Inventory filesystem sau khi loại `.git/node_modules/dist/.codex/.agents/.aws` có 117 mục file, gồm cả các mục môi trường chỉ ghi nhận tên. Đây không phải 117 file code ứng dụng, cũng không phải 117 file được deep review.

## Mức coverage

| Nhóm | Việc đã làm | Giới hạn |
|---|---|---|
| 23 file src | Inventory/hash, AST/import/function/block analysis, kết hợp đọc source thay đổi với kết quả audit trước | Không tuyên bố audit từng dòng CSS/template hoặc mọi tổ hợp trạng thái runtime. |
| 9 source không đổi | Tái sử dụng audit cũ; hash trùng | Nếu một yêu cầu mới cần đánh giá sâu hơn phần cũ chưa bao phủ, vẫn phải mở lại đúng phần đó. |
| Services thay đổi | Đọc các đường ownership, API/result, mapping, polling, cache, session/call cleanup và SDK boundary | Chưa kiểm chứng mọi schema/ACL/server response hoặc toàn bộ lifecycle live. |
| Views/components thay đổi | Đọc script/flow, binding liên quan và trách nhiệm; tách số dòng script/template/style | Không thực hiện visual QA/responsive/accessibility toàn bộ bằng browser. |
| Tests | Đọc cách nạp source/fixture, chạy 27 tests; probe ba contract lỗi trong RAM | Harness thay imports, watcher, SDK/browser; không đại diện component/E2E thực. |
| Config/lock | Đọc scripts/build/alias/ignore và extract locked versions | Không tải dependencies, không gọi vulnerability registry. |
| Tài liệu | Dùng báo cáo audit, sửa lỗi, quyết định bỏ pin/read; đối chiếu phần kiến trúc cũ cần thiết | Journal/API catalog dài, prototype/ảnh và export Android không được full-review lại trong lượt này. |
| FileQuest | Phân loại tài liệu/mã tham chiếu ngoài build graph | Không coi file .py chứa export Android là backend Web đang chạy; không build APK. |
| Tooling .ua/.tours | Inventory, nhận diện generated/ignored metadata | Không dùng knowledge graph sinh trước làm bằng chứng implementation hiện tại. |
| Môi trường/credentials | Loại khỏi đọc nội dung và báo cáo | Không đọc .env, không ghi token/credentials vào tài liệu. |

Không có AGENTS.md trong inventory dự án. Các file ngoài workspace, sibling project, Git history toàn bộ và hệ thống bên ngoài không được review ở lượt này. Không sử dụng sub-agent.

## Snapshot source

Số dòng tính bằng `split('\n')`, có thể cộng newline cuối. Hash là nội dung byte tại đầu lượt. Hash không phải xác nhận chất lượng; mức đọc của từng nhóm ở bảng phía trên.

| File | Dòng | Xử lý so với baseline | SHA-256 |
|---|---:|---|---|
| `src/App.vue` | 400 | Đã đổi: review cấu trúc/đường xử lý | `aa73ed5ba11c888128ae32ea21850375fec6232d9f1a0455878e33ec7638f328` |
| `src/assets/main.css` | 7 | Không đổi: kế thừa audit cũ | `ca803b5f56fcf524f7e53a9b6dc83ce8c89ed7734339592c9cc888974576e71e` |
| `src/components/call/IncomingCallModal.vue` | 441 | Không đổi: kế thừa audit cũ | `aad5cd52cf89fbaa7b34b89929f20f57688a7c0d3139e8df82ab84982f359dc6` |
| `src/components/common/DebugLogDrawer.vue` | 406 | Không đổi: kế thừa audit cũ | `9dd8520e83e9ae571c2fe373978867f28f41d37176566a957895a4860a9037f0` |
| `src/components/common/SettingsModal.vue` | 1137 | Đã đổi: review cấu trúc/đường xử lý | `1b4efba1c840550bd0c9451e85370fc5dacb277112f7e1ec59cf0991f6b48ba8` |
| `src/components/layout/AppHeader.vue` | 559 | Đã đổi: review cấu trúc/đường xử lý | `28f6d3d476744d49160a0e9d6a2dc54ed80da710233883f39a567ec375f22119` |
| `src/components/layout/AppSidebar.vue` | 219 | Đã đổi: review cấu trúc/đường xử lý | `c415da1850407e85ff4603932bc070ab774034baa8f505fed6350376d18347ac` |
| `src/config/features.js` | 70 | Không đổi: kế thừa audit cũ | `cc1786be925a00588a1765f67128b58d20208346edbf6d0f5ffa4062ffcaf844` |
| `src/main.js` | 26 | Không đổi: kế thừa audit cũ | `85caeaed2b3ecf3569535074766a78da345e2900a9041a646189d8751d235fd8` |
| `src/router/index.js` | 86 | Không đổi: kế thừa audit cũ | `be5be358e21e99fe468da0d4e262c39dab47f4f2795692f7bd5264bda83edc9a` |
| `src/services/audioService.js` | 276 | Không đổi: kế thừa audit cũ | `626130cc30fb04eb66d5cdb08877d7fa3b91f4bc1294c8172eb2a526a0655ded` |
| `src/services/chatService.js` | 1237 | Đã đổi: review cấu trúc/đường xử lý | `614e1b8caaff71a7a71750b4744b6922e43cdeb19f9f8e731b1127d23ec20147` |
| `src/services/contactService.js` | 812 | Đã đổi: review cấu trúc/đường xử lý | `a7d9d2c7c54672c52b2cdf659e1e93f863ab27242f171d7fb6c62a34c0c9b11a` |
| `src/services/historyService.js` | 286 | Đã đổi: review cấu trúc/đường xử lý | `697edadfbf0df3729e7418cc6c0a46f38dfaa2b0b1c38be692a390c4784c7e35` |
| `src/services/loggerService.js` | 127 | Không đổi: kế thừa audit cũ | `d498405b4807b87d74834d767d309b0a58d53b898ccda517ca190369100209fd` |
| `src/services/recordService.js` | 436 | Đã đổi: review cấu trúc/đường xử lý | `784cd138397cfb41d30566657f4ada56c573e6851b1fb26bed28d6eff3e781c9` |
| `src/services/sessionScope.js` | 69 | Mới so với baseline | `daffc5a738ce4aafd724a4d78e1816fdb0a25a97bb24e98a119eed898942175e` |
| `src/services/wazo.js` | 3209 | Đã đổi: review cấu trúc/đường xử lý | `b8cab1466b4eff8f44dd43adfeccd6442aeb00baa0a60d8ca229a938d6f18848` |
| `src/services/websocketService.js` | 59 | Không đổi: kế thừa audit cũ | `ead1f05dd2a57d2047755ce71d774919cf7ee4cf7469ff223c4d3471edde968a` |
| `src/views/CallsView.vue` | 4295 | Đã đổi: review cấu trúc/đường xử lý | `376f2336c6f572442aa3823b39f5e42e3c973558c1a2772b80f53bda2c57aada` |
| `src/views/HistoryView.vue` | 1251 | Đã đổi: review cấu trúc/đường xử lý | `a67fa9d0294d859c263e7d6c930c67decd333715008e9bb79c1a2ed576d7d129` |
| `src/views/LoginView.vue` | 1030 | Đã đổi: review cấu trúc/đường xử lý | `e80f51518e3ef59d15e8667902f3786e371845e7653e235a78f16a2083dba4a1` |
| `src/views/MessagesView.vue` | 2521 | Đã đổi: review cấu trúc/đường xử lý | `c01514903b69ed1f694f7541a36ce3ac7ec2419eb6aa1decdd723c804c5c9062` |

## Snapshot cấu hình và kiểm thử liên quan

Baseline cũ không công bố hash có thể đối chiếu của các file dưới. Không gắn nhãn “không đổi” chỉ từ trí nhớ hoặc mtime; hash mới giúp các lượt tiếp theo kiểm tra tăng dần.

| File | SHA-256 |
|---|---|
| `.gitignore` | `3644010ff1b663db2dcaf4c051697d91ca21b24b6e557b6b9ec5d6400ee82b0a` |
| `.prettierrc.json` | `f676d50058f1d9c72b54328a9a44c0f0df5ad31be3252849ab910ce83123cca6` |
| `GEMINI.md` | `91192547aa1bc55a4a54498782e07201a0b121cbc94b3ebf6bf0072dfd8bce11` |
| `jsconfig.json` | `a694c5fbd658b2bae25fb085b1678a71b8ecdc30c7ed99dd5d54e4debdcdf200` |
| `package-lock.json` | `81f80721d37e6890951670c9f435f8586e1f66dae516bd8fc9a0d681bc0ab96a` |
| `package.json` | `190f0d9f7f8aec1286e5ab59f2b3f8dffec12ec4a9801a37d314171929964045` |
| `specs/architecture/plan.md` | `48400e8ee343610da84d02bd308e8dc51a59096fbcec71061322049b6f616751` |
| `tests/regressions.test.cjs` | `ec538d4209c2d0af0581b6818b266ff0daa5d360de73b94f40eb95016fb0161c` |
| `vite.config.js` | `4fd60c54e9a6b350a8087919902a5b480db05b4eb4864fe800daa10761dbd5d4` |

Locked versions tại snapshot: Vue 3.5.45, Vue Router 5.5.0, Vite 8.3.8, Wazo SDK 0.49.11. Khác biệt với phiên bản ghi trong kế hoạch cũ không tự chứng minh dependency có lỗi.

## Kiểm tra đã thực hiện

- Git status đầu lượt sạch; HEAD ngắn `affdb80`.
- Inventory/hash bằng Node fs/crypto; không ghi cache hoặc source.
- Phân tích JavaScript và script SFC bằng Babel parser, tách SFC bằng Vue compiler; 10 SFC +12 JS ứng dụng được xử lý. Đây là phân tích cú pháp/cấu trúc, không phải render hoặc browser test.
- Đồ thị import xác nhận nhiều cycle qua `wazo/chat/contact/history/websocket`.
- Thống kê kích thước block và các method dài phục vụ đánh giá trách nhiệm; không suy độ phức tạp chỉ từ số dòng.
- `node --test tests/regressions.test.cjs`: **27/27 đạt**, mã thoát thành công.
- Ba probe cô lập dùng lại fixture/VM của tests hiện có, chỉ đọc source và chạy trong RAM. Lần probe đầu thiếu cấu hình `chatService.rooms`/alert của fixture nên harness lỗi; bổ sung fixture rồi chạy lại thành công. Không coi lỗi harness là lỗi app.
- Đọc kích thước các artifact dist đã có, không tạo build mới.

### Kết quả probe sau khi sửa fixture

```json
{
  "favoriteHTTP500": {
    "returned": true,
    "isFavorite": true,
    "requests": 1
  },
  "batchZeroSuccess": {
    "toasts": [
      {
        "message": "Đã xóa 1 nhóm thành công!",
        "type": "success"
      }
    ]
  },
  "sipWithoutRegistration": {
    "registered": false,
    "displayedOnline": true
  }
}
```

Nội dung toast trong probe thực có biểu tượng; ví dụ JSON trên lược biểu tượng, giữ nguyên ý nghĩa và trường kết quả. Các probe chứng minh contract/UI logic, không chứng minh tác động đã xảy ra trên production.

## Vòng phản biện trước khi chốt

1. **Không biến số dòng thành chất lượng:** CallsView có hơn nửa số dòng là style; kết luận coupling dựa thêm trách nhiệm, imports và thao tác state/API.
2. **Không nói thiếu code splitting toàn bộ:** router hash không đổi và đã lazy routes. Bundle đầu vào lớn là vấn đề cần đo/định vị, không phải lý do mặc định dùng microfrontend.
3. **Không coi cycle là crash chắc chắn:** code đã có hành vi/runtime bảo vệ; cycle được phân loại DESIGN RISK.
4. **Không nói N+1 ở mọi refresh:** chỉ phòng chưa có messages mới được prefetch. Cold-load fan-out vẫn xác định được từ code.
5. **Không gọi offline login là lỗ hổng xác thực:** UI được guard bởi feature flag; chưa có bằng chứng backend chấp nhận token giả. Không tạo finding bảo mật từ code đó.
6. **Không bỏ qua guard quyền nhóm:** nhiều môi trường thiếu metadata sẽ chặn trước batch delete; nhưng khi nhóm có quyền hợp lệ, lỗi bỏ qua partial count vẫn tồn tại.
7. **Không coi Node tests như E2E:** harness bỏ imports và thay scheduler/browser; các giới hạn đó được đưa vào kế hoạch refactor.
8. **Không yêu cầu read/pin trở lại:** quyết định sản phẩm mới được ưu tiên trên roadmap audit cũ.

Trong lượt review này ghi nhận mới **3 CONFIRMED BUG mức P2**, và **6 DESIGN RISK mức P2** được gom theo nguyên nhân trong báo cáo 12. Không phát hiện mới P0/P1 đủ bằng chứng trong phạm vi này; không suy ra toàn hệ thống không có P0/P1. Không cộng các mục này vào 21 findings lịch sử mà không đối chiếu trạng thái/duplication.

## Không thực hiện

Không sửa source/config/tests có sẵn, không format, không thêm dependency, không refactor, không commit/push. Chỉ tạo ba báo cáo Markdown 12–14 trong `doc/audit`.

Kiểm tra cuối lượt: SHA-256 của cả 23 file `src` và file kiểm thử khớp đầu lượt; Git status chỉ có ba báo cáo mới. Kiểm tra 22 liên kết trong ba báo cáo không có đích thiếu hoặc số dòng vượt phạm vi.

Không chạy lại build vì source không thay đổi trong lượt review; lần build thành công trước đã được ghi nhận trong báo cáo 11. Artifact dist chỉ được dùng làm thông tin bổ trợ, không khẳng định có manifest chứng minh artifact khớp revision hiện tại.

Không có browser/E2E, SIP/media thật, test tải, kiểm thử ACL hay SingleIdAuth end-to-end. Không thể xác nhận production readiness hoặc đưa ra số concurrent users từ các kiểm tra hiện có.

## Cách dùng snapshot ở lượt sau

So sánh hash trước khi deep-review. Chỉ đánh dấu “đã đọc, không đổi” nếu file có baseline và phạm vi review cũ phù hợp câu hỏi mới. File chưa từng review, file không có hash hoặc khu vực trước đó chỉ inventory vẫn cần xem tiếp khi liên quan. Nếu code thay đổi trong lúc audit, phải tính lại hash và rà đúng phần đổi trước khi bàn giao.
