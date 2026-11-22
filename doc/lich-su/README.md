# Lịch sử kiến trúc, kiểm toán và refactor

## Web trước refactor

Các tài liệu kiến trúc, dịch vụ, giao diện và API ở giai đoạn đầu xoay quanh một `wazo.js` lớn, `websocketService.js` và cây `src/` cũ. Một số báo cáo còn mô tả bản Mock hoặc lộ trình tích hợp thật. Nhánh hiện tại lắp ghép qua `frontend/src/services/createServices.js`, chia theo auth, calls, audio, realtime, data và common. View điều phối lệnh nghiệp vụ, state có chủ sở hữu và test dùng fixture riêng.

- Kiến trúc và lộ trình ban đầu. [Đặc tả](web-truoc-refactor/KIEN_TRUC_VA_LUONG_HOAT_DONG_CHI_TIET.md) · [Phân tích và lộ trình](web-truoc-refactor/SMART_CALL_WEB_ANALYSIS_AND_ROADMAP.md)
- Màn hình, service và API đã gọi ở bản cũ. [Views](web-truoc-refactor/GIAI_THICH_CHI_TIET_VIEWS.md) · [Services](web-truoc-refactor/GIAI_THICH_CHI_TIET_SERVICES.md) · [API](web-truoc-refactor/TONG_HOP_TOAN_BO_API_DA_CALL.md)
- Quan sát lúc bàn giao bản Web cũ. [Báo cáo onboarding](web-truoc-refactor/BAO_CAO_RA_SOAT_CODEBASE_ONBOARDING.md)

## Audit và quyết định nghiệp vụ

Các báo cáo audit ghi lại bằng chứng và mức độ rủi ro tại từng mốc. Đọc kết quả khắc phục cùng phát hiện ban đầu để tránh coi một vấn đề lịch sử là lỗi hiện tại.

| Chủ đề | Kết quả chuyển tiếp | Hồ sơ |
| --- | --- | --- |
| Vòng đời phiên, quyền và dữ liệu | Bản refactor có scope theo phiên, lọc sự kiện và kiểm tra kết quả API. Môi trường thật vẫn cần kiểm chứng riêng. | [Tổng kết](audit/08-executive-summary.md) · [Khắc phục](audit/10-remediation-status.md) · [Phạm vi](audit/09-audit-coverage.md) |
| Chat | Ghim và receipt đã được bỏ. Badge chưa mở được khôi phục ở mốc sau, chỉ lưu metadata theo host/UUID. | [Quyết định ghim/read](audit/11-remove-message-pin-and-read-status.md) · [Bản sửa badge](../refactor/LATEST_FIXES_2026-11-20.md) |
| Refactor | Thiết kế phân tầng ban đầu được điều chỉnh sang cây nông hơn để dễ lần code. | [Blueprint cũ](audit/13-refactor-blueprint-2026-11-19.md) · [Review chất lượng](audit/12-code-quality-review-2026-11-19.md) · [Kiến trúc hiện hành](../refactor/ARCHITECTURE.md) |
| IdP và Web–Android | Single ID OIDC và cấp phiên Wazo đã có backend. API chat dùng chung và thay đổi hợp đồng Web–Android trong báo cáo là đề xuất thời điểm đó. | [Phân tích tích hợp](audit/PHAN_TICH_IDP_BACKEND_CHAT_WEB_ANDROID_2026-11-19.md) · [Backend hiện hành](../../backend/doc/README.md) |
| Kiểm toán sau refactor | Các ghi nhận và ca kiểm tra gắn với snapshot ngày 19/11/2026. | [Audit sau refactor](refactor/FOLLOWUP_AUDIT_2026-11-19.md) · [Ca kiểm tra lịch sử](refactor/AUDIT_REPRO_CASES.md) |

Hồ sơ đầy đủ nằm trong [audit](audit/). Báo cáo chuyên gia về [bản Mock](audit/SMARTCALL_EXPERT_AUDIT_REPORT.md), [prompt refactor lịch sử](refactor/IMPLEMENTATION_PROMPT.md) và [ghi chú công cụ Antigravity](cong-cu/walkthrough.md) được giữ để đối chiếu.
