# Coverage, snapshot và verification

[Executive](08-executive-summary.md) · [Vòng hai](06-second-pass-review.md) · [Findings](03-bugs-and-logic-findings.md).

## Cách hiểu coverage

FACT: tìm kiếm/inventory, đọc execution path, static compiler và fixtures cô lập. INFERENCE: tác động dự kiến lên người dùng/server khi điều kiện trigger xảy ra. UNKNOWN: môi trường live, ACL, SIP/media, IdP, tải. Không coi parse success là business test hay bằng chứng server an toàn.

Đã thực hiện Phase1 static audit nguồn ứng dụng, Phase2 phản biện các findings và Phase3 hợp nhất tài liệu. Chưa đạt full coverage từng dòng của mọi tài liệu lưu trữ/prototype, CSS visual QA hoặc hệ thống ngoài repo. Phạm vi hoàn tất là các module và flows bên dưới; yêu cầu “entire repository100%” không được tuyên bố hoàn tất.

## Snapshot application source

SHA-256 dưới đây xác định nội dung đã đọc. Cấu hình/package/lock và tài liệu cũng được hash để đối chiếu sau audit. Generated outputs/dependencies không nằm trong full review; chỉ đọc SDK/compiler khi cần kiểm chứng contract.

| File | Số dòng theo split newline | SHA-256 |
|---|---:|---|
| [src/App.vue](../../src/App.vue) | 400 | dfedbec99c70bb1b5ff0001359c5b61e7a04d4b5164e80cecf574a3fac7dd6df |
| [src/assets/main.css](../../src/assets/main.css) | 7 | ca803b5f56fcf524f7e53a9b6dc83ce8c89ed7734339592c9cc888974576e71e |
| [src/components/call/IncomingCallModal.vue](../../src/components/call/IncomingCallModal.vue) | 441 | aad5cd52cf89fbaa7b34b89929f20f57688a7c0d3139e8df82ab84982f359dc6 |
| [src/components/common/DebugLogDrawer.vue](../../src/components/common/DebugLogDrawer.vue) | 406 | 9dd8520e83e9ae571c2fe373978867f28f41d37176566a957895a4860a9037f0 |
| [src/components/common/SettingsModal.vue](../../src/components/common/SettingsModal.vue) | 1135 | f3dfb76e91d765d9386fd7d08db25a5eae7e58f7c76b9c49126ac171ca881fac |
| [src/components/layout/AppHeader.vue](../../src/components/layout/AppHeader.vue) | 559 | 16fe425fbcdaf094cf1d954a6825faedeaf2ccdce2455186f9e56b095ff47135 |
| [src/components/layout/AppSidebar.vue](../../src/components/layout/AppSidebar.vue) | 319 | 20e9a09f2c7f27c998409c4f1fb33a3a6f669b44c81f00b4df672feb9ffe0175 |
| [src/config/features.js](../../src/config/features.js) | 70 | cc1786be925a00588a1765f67128b58d20208346edbf6d0f5ffa4062ffcaf844 |
| [src/main.js](../../src/main.js) | 26 | 85caeaed2b3ecf3569535074766a78da345e2900a9041a646189d8751d235fd8 |
| [src/router/index.js](../../src/router/index.js) | 86 | be5be358e21e99fe468da0d4e262c39dab47f4f2795692f7bd5264bda83edc9a |
| [src/services/audioService.js](../../src/services/audioService.js) | 276 | 626130cc30fb04eb66d5cdb08877d7fa3b91f4bc1294c8172eb2a526a0655ded |
| [src/services/chatService.js](../../src/services/chatService.js) | 1505 | bc81896ce37bd67eacd327489d005b266afcb4584852b3ea28bf482cd8b53297 |
| [src/services/contactService.js](../../src/services/contactService.js) | 790 | b015da366898ff56137bcbaddc58f808619de30f72db059fb8d691d4a56ad74b |
| [src/services/historyService.js](../../src/services/historyService.js) | 282 | dbf5f2479f68a9bb66c7f074de867cd2f464f0fa4ff4d040dd87cccac5236608 |
| [src/services/loggerService.js](../../src/services/loggerService.js) | 127 | d498405b4807b87d74834d767d309b0a58d53b898ccda517ca190369100209fd |
| [src/services/recordService.js](../../src/services/recordService.js) | 418 | 621c909201af82fe1c0e85f8625ead5ca15870a0919ea87ae8592802e125decf |
| [src/services/wazo.js](../../src/services/wazo.js) | 3093 | 72dc97ae0d7fe11d4b472d5aa044afbc8407aa85317e070a2d7f053c5dbc4971 |
| [src/services/websocketService.js](../../src/services/websocketService.js) | 59 | ead1f05dd2a57d2047755ce71d774919cf7ee4cf7469ff223c4d3471edde968a |
| [src/views/CallsView.vue](../../src/views/CallsView.vue) | 4304 | 3605b310244246220bf0611fc20961f39ff3282c878c554a679c9cab9d06fc27 |
| [src/views/HistoryView.vue](../../src/views/HistoryView.vue) | 1229 | 48cb4954ebf02bb6a6f02e8e901b8ccdb8573a588f4e24598822ba2de2bda952 |
| [src/views/LoginView.vue](../../src/views/LoginView.vue) | 1020 | 76f3ff706f237ee92d3c0657534e0aa270aec7ebd624b7917150f630aa917fdc |
| [src/views/MessagesView.vue](../../src/views/MessagesView.vue) | 2753 | 307dbd485b6b8cf969dec8cecbc1b3155a3820bb89fd76deffe965c3a1d39085 |

Số dòng có thể tính thêm newline cuối; không dùng làm metric chất lượng. Module inventory và responsibilities tại01. Source không được sửa trong audit.

## Trạng thái từng nhóm

| Nhóm | Coverage |
|---|---|
| main/App/router/features | Đọc logic, route guards/layout/restore/logout/reset integration; không kiểm thử browser navigation thật |
| Wazo core | Đọc auth/refresh/WS/SIP/call/group/mute/DTMF/presence, lifecycle và lookup callers; media live chưa chạy |
| Chat | Đọc service paths gửi/nhận/room/member/pin/close và view selection; có VM failure/async controls |
| Contacts | Đọc mapper/statusOf/availability/favorites/polling/reset/lookup; chưa kiểm chứng schema/ACL live |
| History/record/audio | Đọc CDR/direction/filter/cache/record APIs, tone cleanup; VM playback/stop recording |
| Components/views | Script logic và template bindings/actions/conditions; static SFC parse toàn bộ; CSS chưa review từng rule hay responsive visual |
| Config/build | package/lock/vite/jsconfig/index/prettier/gitignore đã kiểm tra; .env và credentials không đọc |
| FileQuest | Inventory, đối chiếu các reference Web/Wazo và Android paths liên quan; không full-review mọi prototype/export/resource |
| Tests | Không tìm thấy application unit/component/E2E files/config ngoài dependency/generated artifacts; không có test/lint/typecheck scripts |
| Backend | Không có backend SmartCall mới; Wazo/IdP ngoài repo, chưa đánh giá live |

## Documentation inventory

Mức đọc: đầy đủ logic/nội dung trọng yếu hoặc chọn phần có liên quan; không biến tài liệu cũ thành spec hiện hành. Inventory gồm cả file bị ignore, thư mục ẩn được tìm bằng rg --hidden --no-ignore, loại .git/node_modules/dist.

| File | Lines | Mức review |
|---|---:|---|
| [doc/BAO_CAO_RA_SOAT_CODEBASE_ONBOARDING.md](../../doc/BAO_CAO_RA_SOAT_CODEBASE_ONBOARDING.md) | 216 | Đã đọc nội dung liên quan và đối chiếu implementation |
| [doc/GIAI_THICH_CHI_TIET_SERVICES.md](../../doc/GIAI_THICH_CHI_TIET_SERVICES.md) | 550 | Đối chiếu các phần architecture/business/flow; ví dụ cũ/lặp và phạm vi Mock được phân loại |
| [doc/GIAI_THICH_CHI_TIET_VIEWS.md](../../doc/GIAI_THICH_CHI_TIET_VIEWS.md) | 381 | Đối chiếu các phần architecture/business/flow; ví dụ cũ/lặp và phạm vi Mock được phân loại |
| [doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md](../../doc/HUONG_DAN_TRIEN_KHAI_TUNG_BUOC.md) | 3986 | Mục lục toàn bộ, các mục nghiệp vụ liên quan, bước75–76; lịch sử UI/code lặp không review từng dòng |
| [doc/KIEN_TRUC_VA_LUONG_HOAT_DONG_CHI_TIET.md](../../doc/KIEN_TRUC_VA_LUONG_HOAT_DONG_CHI_TIET.md) | 912 | Đối chiếu các phần architecture/business/flow; ví dụ cũ/lặp và phạm vi Mock được phân loại |
| [doc/PHAN_TICH_IDP_BACKEND_CHAT_WEB_ANDROID_2026-11-19.md](../../doc/PHAN_TICH_IDP_BACKEND_CHAT_WEB_ANDROID_2026-11-19.md) | 324 | Đã đọc bản tổng hợp trước, không dùng làm chứng minh snapshot mới |
| [doc/README.md](../../doc/README.md) | 39 | Đã đọc nội dung liên quan và đối chiếu implementation |
| [doc/SMARTCALL_EXPERT_AUDIT_REPORT.md](../../doc/SMARTCALL_EXPERT_AUDIT_REPORT.md) | 314 | Đối chiếu các phần architecture/business/flow; ví dụ cũ/lặp và phạm vi Mock được phân loại |
| [doc/SMART_CALL_WEB_ANALYSIS_AND_ROADMAP.md](../../doc/SMART_CALL_WEB_ANALYSIS_AND_ROADMAP.md) | 492 | Đối chiếu các phần architecture/business/flow; ví dụ cũ/lặp và phạm vi Mock được phân loại |
| [doc/TONG_HOP_TOAN_BO_API_DA_CALL.md](../../doc/TONG_HOP_TOAN_BO_API_DA_CALL.md) | 202 | Đã đọc nội dung liên quan và đối chiếu implementation |
| [doc/walkthrough.md](../../doc/walkthrough.md) | 106 | Đã đọc, tooling ngoài nghiệp vụ |
| [doc/WAZO_API_REFERENCE.md](../../doc/WAZO_API_REFERENCE.md) | 1900 | Catalog kiểm tra các nhóm app dùng; admin/service không liên quan được loại khỏi deep review |
| [FileQuest/dev_guide.md](../../FileQuest/dev_guide.md) | 467 | Đọc phần auth/API/media/realtime/cert và giới hạn spec |
| [FileQuest/wazo_api_reference.md](../../FileQuest/wazo_api_reference.md) | 1912 | Catalog kiểm tra các nhóm app dùng; admin/service không liên quan được loại khỏi deep review |
| [specs/architecture/plan.md](../../specs/architecture/plan.md) | 194 | Đã đọc, kế hoạch chờ phê duyệt |
| [GEMINI.md](../../GEMINI.md) | undefined | Đã đọc nội dung liên quan và đối chiếu implementation |

GEMINI.md được đọc cho business constraints; AGENTS.md không tìm thấy trong project scan. Không phát hiện Markdown ẩn khác ngoài inventory sau khi loại generated/dependencies. Chưa audit Git history mọi revision, sibling Mock repo, tài liệu ngoài workspace hay nội dung IdP portal.

## Business flows và failure paths

Auth/restore/session reset, dial từ dialpad/contact/history/chat, incoming accept/reject/miss, group invite/timeout/merge/hangup, presence/favorites/directory lookup, rooms/direct/group/send/rename/remove/add/close/pin/read info, CDR/recording/playback/download, settings/load/save/device/meter, KeepAlive route transitions. Success/failure/cancel/concurrency được truy vết tĩnh; fixtures trọng yếu bên dưới.

## Commands đã thực hiện

- PowerShell Get-Content -Encoding UTF8, rg --files/--hidden/--no-ignore/rg -n, Get-ChildItem, git status --short, Test-Path: đọc/inventory, không thực thi app.
- Node stdin dùng fs.readFileSync + crypto.createHash: hash source/docs/config, không ghi file.
- Node stdin dùng @vue/compiler-sfc parse/compileScript/compileTemplate và babelParse: **10 SFC, 11JS, errors=[]**;11 style blocks được SFC parse, không có CSS build/output.
- Node stdin VM: bỏ import/export của module để cô lập, nạp Vue reactive/ref/computed thật, thay SDK/fetch/storage/timers/media bằng fixture RAM. Không gọi Wazo/IdP hay xin mic thật. Đây là regression reproduction cục bộ, không phải test suite cài trong repo.
- Static imports/locked versions/API method types được đọc trực tiếp. Không npm audit network.

Harness không ghi test file vì quyền chỉ tạo Markdown. Một lần thiếu fixture formatMessageDateTime gây lỗi harness; đã bổ sung trong RAM và chạy lại. Một lệnh trích tài liệu bằng regex tiếng Việt lỗi do encoding pipe, đã chạy lại bằng normalizer/ASCII; không liên quan lỗi sản phẩm.

## Kết quả fixtures

Các payload dưới hoàn toàn tổng hợp, không là dữ liệu user thật.

```json
[
  {
    "id": "SEC-002",
    "roomsAfterReset": [
      "private-a"
    ]
  },
  {
    "id": "SEC-001",
    "remainingRooms": 0
  },
  {
    "id": "BUG-001",
    "requests": [
      {
        "endpoint": "services/dnd",
        "body": {
          "enabled": false
        }
      },
      {
        "endpoint": "forwards/busy",
        "body": {
          "enabled": false,
          "destination": null
        }
      },
      {
        "endpoint": "forwards/noanswer",
        "body": {
          "enabled": false,
          "destination": null
        }
      },
      {
        "endpoint": "forwards/unconditional",
        "body": {
          "enabled": false,
          "destination": null
        }
      }
    ]
  },
  {
    "id": "BUG-002",
    "status": "connected",
    "timerStarted": true
  },
  {
    "id": "BUG-004",
    "attempts": 1,
    "markedMerged": true
  },
  {
    "id": "BUG-005",
    "afterSecondary": {
      "status": "connected",
      "startTime": null,
      "timer": false
    }
  },
  {
    "id": "BUG-005-progress",
    "status": "ringing"
  },
  {
    "id": "BUG-006",
    "reportedStopped": true,
    "isRecording": false
  },
  {
    "id": "BUG-007",
    "reportedDeleted": true,
    "remainingRooms": 0
  },
  {
    "id": "BUG-010",
    "before": false,
    "after": false,
    "actualService": true
  },
  {
    "id": "CONTROL-send",
    "readStatus": "Lỗi gửi",
    "failed": true
  },
  {
    "id": "CONTROL-sessionGuard",
    "preserved": true
  },
  {
    "id": "CONTROL-admin",
    "admin": "creator"
  },
  {
    "id": "BUG-003",
    "conferenceAfterHangup": "late-conf",
    "hasActive": false
  },
  {
    "id": "BUG-014",
    "visibleClosedRooms": [
      {
        "id": "closed-room",
        "messages": 0,
        "preview": "Phòng thảo luận nhóm mới"
      }
    ]
  },
  {
    "id": "BUG-012",
    "badge": 0,
    "rows": 1
  },
  {
    "id": "BUG-013",
    "selectedAfterSend": "a"
  },
  {
    "id": "BUG-015",
    "tracksStoppedAfterCloseWhilePending": 0
  },
  {
    "id": "BUG-011",
    "played": [
      "audio-b",
      "audio-a"
    ],
    "uiSelected": "b"
  }
]
```

Những fixture output là quan sát, không tự khẳng định mọi tác động server. BUG-003 fixture đầu chưa đủ peer không đi tới create, đã được thay bằng scenario pending-create ở bảng kết quả. Controls bác bỏ findings cũ đã ghi trong06.

## NOT EXECUTED / BLOCKED external verification

| Check | Lý do |
|---|---|
| npm run build | vite build tạo dist và có thể cache; vượt quyền chỉ tạo Markdown |
| npm run format | prettier --write sửa source; không được phép |
| npm install/update | Sửa dependencies/lock/state, không được phép |
| Lint/typecheck/test suite ứng dụng | Không có scripts/config hiện hành; không tự cài runner |
| Browser E2E/live calls | App startup có auth/presence/thu hồi phiên và tác động tổng đài; không chạy |
| Wazo API/ACL/cross-tenant/intrusive security | Không gọi production, không có staging được cấu hình cho audit |
| SingleIdAuth end-to-end | Chưa có dự án mẫu, metadata/contract và đăng ký ứng dụng |
| Android APK/Gradle | Chỉ có export text; chưa có project có thể build và môi trường thiết bị |
| Performance/load/bundle mới | Không build/benchmark; tài liệu cũ không thay phép đo hiện tại |
| Database migration/data | Backend mới chưa có; không truy cập database production |

Không coi các blocker bên ngoài là bằng chứng code frontend đúng. Chúng giới hạn kết luận production readiness.

## Những phần chưa hoàn tất và cách tiếp tục

1. Đọc từng dòng toàn bộ journal/API catalog/prototype lịch sử nếu mục tiêu audit archive100%; trước đó cần phân loại thêm phần còn áp dụng để tránh dùng code cũ làm spec.
2. Cố định revision rồi đưa fixtures thành regression tests chính thức theo quyền cài đặt riêng.
3. Staging có test users: permission/membership, token/WS/reconnect, SIP answer/media/group, recording và thiết bị/browser.
4. Xác nhận Android export khớp APK; test chat protocol liên nền tảng.
5. Khi có mẫu IdP/backend: audit auth adapter, trust boundary, mappings, migration SQLite, backup/restore và tải.

Mọi report chỉ là file mới tại doc/audit, không sửa tài liệu có sẵn. Snapshot final được kiểm tra sau khi tạo báo cáo; các file mới được kiểm tra link, ID và số lượng.
