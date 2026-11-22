# Wazo Platform 26.10 — Tham chiếu toàn bộ REST API

Tài liệu sinh tự động từ OpenAPI spec tải về từ server đang chạy (thư mục `api-specs/`),
bằng `tools/gen_api_reference.py`. **841 endpoint**, trong đó **109** gọi được bằng token
của user thường. Hướng dẫn cách dùng, ví dụ và lưu ý: xem `WAZO_DEV_GUIDE.md`.

## Cách đọc

- URL đầy đủ = `https://<HOST>` + **Base URL** của service + **Path**. Ví dụ:
  `https://192.168.1.15:9443` + `/api/calld/1.0` + `/users/me/calls`.
- Mọi request (trừ đăng nhập) gửi header `X-Auth-Token: <token>`. API quản trị nhiều tenant có thể cần thêm
  `Wazo-Tenant: <tenant_uuid>`.
- Cột đầu:
  - 👤 = **user thường gọi được** (token của chính user; tham số `{user_uuid}`/`{user_id}` phải là của chính mình).
  - 🌐 = không yêu cầu ACL (công khai hoặc dùng Basic auth, vd. đăng nhập).
  - trống = cần token **admin** (quản trị) hoặc quyền được cấp thêm qua policy.
- **ACL yêu cầu**: quyền token phải có. Admin có thể cấp thêm quyền cho user qua policy (`wazo-auth · policies`).
- **Tham số**: tên tham số query và tên schema của body. Chi tiết từng trường: mở file spec tương ứng bằng
  Swagger Editor / Postman / Insomnia (Import → OpenAPI).
- Mô tả được dịch từ spec sang tiếng Việt (`tools/summaries_vi.json`), giữ nguyên thuật ngữ chuyên môn.
  Endpoint mới xuất hiện sau khi nâng cấp mà chưa có bản dịch sẽ hiện mô tả tiếng Anh gốc.
- Đánh dấu 👤 được suy ra từ danh sách ACL của user test `alice` (kiểm chứng 2026-11-11); có thể lệch ở vài
  endpoint đặc biệt — thử thực tế khi dùng.

## Tổng quan

| Service | Chức năng | Base URL | Endpoint | 👤 user |
|---|---|---|---|---|
| [wazo-auth](#wazo-auth) | Xác thực | `/api/auth/0.1` | 93 | 3 |
| [wazo-confd](#wazo-confd) | Cấu hình hệ thống | `/api/confd/1.1` | 425 | 35 |
| [wazo-calld](#wazo-calld) | Điều khiển cuộc gọi | `/api/calld/1.0` | 128 | 41 |
| [wazo-call-logd](#wazo-call-logd) | Lịch sử cuộc gọi | `/api/call-logd/1.0` | 22 | 3 |
| [wazo-dird](#wazo-dird) | Danh bạ | `/api/dird/0.1` | 106 | 19 |
| [wazo-chatd](#wazo-chatd) | Trạng thái & chat | `/api/chatd/1.0` | 23 | 8 |
| [wazo-webhookd](#wazo-webhookd) | Webhook | `/api/webhookd/1.0` | 16 | 0 |
| [wazo-agentd](#wazo-agentd) | Agent call center | `/api/agentd/1.0` | 23 | 0 |
| [wazo-amid](#wazo-amid) | Asterisk AMI | `/api/amid/1.0` | 5 | 0 |
| wazo-websocketd | Sự kiện realtime | `/api/websocketd/` (WebSocket) | – | ✔ |
| Asterisk WSS | SIP over WebSocket (WebRTC) | `/api/asterisk/ws` (WebSocket) | – | ✔ |

WebSocket không có OpenAPI spec — xem mục 5 và 6 của `WAZO_DEV_GUIDE.md`.

## wazo-auth

**Xác thực.** Đăng nhập, cấp/gia hạn/thu hồi token, quản lý tài khoản đăng nhập, nhóm, chính sách quyền (policy/ACL), tenant, đăng nhập bằng LDAP / SAML (SSO).

Base URL: `https://<HOST>/api/auth/0.1` · Spec: `api-specs/wazo-auth.yml` · 93 endpoint, 3 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [admin](#wazo-auth-admin) | 1 | Thao tác quản trị đặc biệt trên user. |
| [backends](#wazo-auth-backends) | 10 | Các cơ chế xác thực đang bật (wazo_user, ldap_user...) và cấu hình LDAP theo tenant. |
| [config](#wazo-auth-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [emails](#wazo-auth-emails) | 2 | Xác nhận email, gửi lại email xác nhận, quên mật khẩu. |
| [external](#wazo-auth-external) | 5 | Kết nối tài khoản bên ngoài (Google, Microsoft) cho user — dùng cho đồng bộ danh bạ/lịch. |
| [groups](#wazo-auth-groups) | 11 | Nhóm user và gán policy (quyền) cho nhóm. |
| [idp](#wazo-auth-idp) | 2 | Nhà cung cấp danh tính (IdP): chọn cách xác thực cho user (native, LDAP, SAML...). |
| [policies](#wazo-auth-policies) | 7 | Policy = tập quyền (ACL). Tạo/sửa policy và gán cho user/nhóm. |
| [sessions](#wazo-auth-sessions) | 2 | Phiên đăng nhập đang hoạt động; đăng xuất phiên. |
| [status](#wazo-auth-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [tenants](#wazo-auth-tenants) | 7 | Tenant (công ty/khách hàng) và tên miền của tenant. |
| [token](#wazo-auth-token) | 12 | Đăng nhập (tạo token), gia hạn bằng refresh token, kiểm tra, thu hồi token. |
| [users](#wazo-auth-users) | 31 | Tài khoản đăng nhập: tạo, đổi mật khẩu, email, policy, nhóm, refresh token của user. |

### wazo-auth · admin

Thao tác quản trị đặc biệt trên user.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `PUT` | `/admin/users/{user_uuid}/emails` | Cập nhật địa chỉ email | body: `AdminUserEmailList` | `auth.admin.users.{user_uuid}.emails.update` |

### wazo-auth · backends

Các cơ chế xác thực đang bật (wazo_user, ldap_user...) và cấu hình LDAP theo tenant.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/backends` |  |  | |
|  | `GET` | `/backends/ldap` | Xem cấu hình LDAP của tenant hiện tại (chưa cấu hình thì mọi trường là `null`) |  | `auth.backends.ldap.read` |
| 🌐 | `PUT` | `/backends/ldap` | Cập nhật cấu hình LDAP của tenant hiện tại | body: `LDAPBackendConfigEdit` | |
|  | `DELETE` | `/backends/ldap` | Xoá cấu hình LDAP của tenant hiện tại |  | `auth.backends.ldap.delete` |
|  | `GET` | `/backends/saml` | Xem cấu hình SAML của tenant hiện tại (chưa cấu hình thì mọi trường là `null`) |  | `auth.backends.saml.read` |
| 🌐 | `POST` | `/backends/saml` | Tạo cấu hình SAML (trả về cấu hình đã tạo) | body: `form-data` | |
| 🌐 | `PUT` | `/backends/saml` | Cập nhật cấu hình SAML của tenant hiện tại | body: `form-data` | |
|  | `DELETE` | `/backends/saml` | Xoá cấu hình SAML của tenant hiện tại |  | `auth.backends.saml.delete` |
|  | `GET` | `/backends/saml/acs_url_template` | Lấy mẫu URL ACS của tenant để khai báo trong IdP |  | `auth.backends.saml.read` |
|  | `GET` | `/backends/saml/metadata` | Tải file SAML metadata XML của tenant |  | `auth.backends.saml.read` |

### wazo-auth · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `auth.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `auth.config.update` |

### wazo-auth · emails

Xác nhận email, gửi lại email xác nhận, quên mật khẩu.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/emails/{email_uuid}/confirm` | Xác nhận địa chỉ email | query: `token` | `auth.emails.{email_uuid}.confirm.update` |
|  | `PUT` | `/emails/{email_uuid}/confirm` | Xác nhận địa chỉ email |  | `auth.emails.{email_uuid}.confirm.update` |

### wazo-auth · external

Kết nối tài khoản bên ngoài (Google, Microsoft) cho user — dùng cho đồng bộ danh bạ/lịch.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/external/{auth_type}/config` | Xem client id và client secret |  | `auth.{auth_type}.external.config.read` |
|  | `POST` | `/external/{auth_type}/config` | Thêm cấu hình cho auth_type chỉ định | body: `ExternalConfig` | `auth.{auth_type}.external.config.create` |
|  | `PUT` | `/external/{auth_type}/config` | Cập nhật cấu hình cho auth_type chỉ định | body: `ExternalConfig` | `auth.{auth_type}.external.config.update` |
|  | `DELETE` | `/external/{auth_type}/config` | Xoá client id và client secret |  | `auth.{auth_type}.external.config.delete` |
|  | `GET` | `/external/{auth_type}/users` | Danh sách user đã kết nối nguồn bên ngoài này | query: `recurse`, `limit`, `offset` | `auth.{auth_type}.external.users` |

### wazo-auth · groups

Nhóm user và gán policy (quyền) cho nhóm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/groups` | Danh sách group | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `uuid`, `name`, `user_uuid`, `read_only`, `policy_slug`, `policy_uuid` | `auth.groups.read` |
|  | `POST` | `/groups` | Tạo group mới | body: `Group` | `auth.groups.create` |
| 🌐 | `GET` | `/groups/{group_uuid}` | Xem chi tiết group |  | |
|  | `PUT` | `/groups/{group_uuid}` | Sửa group | body: `GroupPut` | `auth.groups.{group_uuid}.update` |
|  | `DELETE` | `/groups/{group_uuid}` | Xoá group |  | `auth.groups.{group_uuid}.delete` |
|  | `GET` | `/groups/{group_uuid}/policies` | Danh sách policy của group | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.groups.{group_uuid}.policies.read` |
|  | `PUT` | `/groups/{group_uuid}/policies/{policy_uuid}` | Gán group vào policy |  | `auth.groups.{group_uuid}.policies.{policy_uuid}.create` |
|  | `DELETE` | `/groups/{group_uuid}/policies/{policy_uuid}` | Bỏ policy khỏi group |  | `auth.groups.{group_uuid}.policies.{policy_uuid}.delete` |
|  | `GET` | `/groups/{group_uuid}/users` | Danh sách user trong group | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.groups.{group_uuid}.users.read` |
|  | `PUT` | `/groups/{group_uuid}/users/{user_uuid}` | Thêm user vào group |  | `auth.groups.{group_uuid}.users.{user_uuid}.create` |
|  | `DELETE` | `/groups/{group_uuid}/users/{user_uuid}` | Bỏ user khỏi group |  | `auth.groups.{group_uuid}.users.{user_uuid}.delete` |

### wazo-auth · idp

Nhà cung cấp danh tính (IdP): chọn cách xác thực cho user (native, LDAP, SAML...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/idp` | Danh sách loại identity provider (IdP) |  | |
| 🌐 | `PUT` | `/idp/{idp_type}/users` | Gán nhiều user vào một IDP | body: `IDPUsers` | |

### wazo-auth · policies

Policy = tập quyền (ACL). Tạo/sửa policy và gán cho user/nhóm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/policies` | Danh sách ACL policy | query: `order`, `direction`, `limit`, `offset`, `search`, `recurse` | `auth.policies.read` |
|  | `POST` | `/policies` | Tạo ACL policy mới | body: `Policy` | `auth.policies.create` |
| 🌐 | `GET` | `/policies/{policy_uuid}` | Xem chi tiết policy |  | |
|  | `PUT` | `/policies/{policy_uuid}` | Sửa ACL policy | body: `Policy` | `auth.policies.{policy_uuid}.update` |
|  | `DELETE` | `/policies/{policy_uuid}` | Xoá policy |  | `auth.policies.{policy_uuid}.delete` |
|  | `PUT` | `/policies/{policy_uuid}/acl/{access}` | Thêm quyền (access) vào policy |  | `auth.policies.{policy_uuid}.update` |
|  | `DELETE` | `/policies/{policy_uuid}/acl/{access}` | Bỏ quyền (access) khỏi policy |  | `auth.policies.{policy_uuid}.update` |

### wazo-auth · sessions

Phiên đăng nhập đang hoạt động; đăng xuất phiên.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/sessions` | Danh sách session | query: `recurse`, `order`, `direction`, `limit`, `offset` | `auth.sessions.read` |
|  | `DELETE` | `/sessions/{session_uuid}` | Xoá session |  | `auth.sessions.{session_uuid}.delete` |

### wazo-auth · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `HEAD` | `/status` | Kiểm tra wazo-auth có hoạt động không |  | |

### wazo-auth · tenants

Tenant (công ty/khách hàng) và tên miền của tenant.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/tenants` | Danh sách tenant | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.tenants.read` |
|  | `POST` | `/tenants` | Tạo tenant mới | body: `TenantCreate` | `auth.tenants.create` |
|  | `GET` | `/tenants/{tenant_uuid}` | Xem chi tiết tenant |  | `auth.tenants.{tenant_uuid}.read` |
|  | `PUT` | `/tenants/{tenant_uuid}` | Sửa tenant | body: `TenantEdit` | `auth.tenants.{tenant_uuid}.update` |
|  | `DELETE` | `/tenants/{tenant_uuid}` | Xoá tenant |  | `auth.tenants.{tenant_uuid}.delete` |
|  | `GET` | `/tenants/{tenant_uuid}/domains` | Xem tên miền (kèm uuid) của tenant |  | `auth.tenants.{tenant_uuid}.domains.read` |
|  | `PUT` | `/tenants/{tenant_uuid}/parent/{parent_tenant_uuid}` | Đổi tenant cha |  | `auth.tenants.{tenant_uuid}.parent.{parent_tenant_uuid}.update` |

### wazo-auth · token

Đăng nhập (tạo token), gia hạn bằng refresh token, kiểm tra, thu hồi token.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `POST` | `/saml/acs` | Xử lý phản hồi từ IdP (SAML) và chuyển hướng tới URL yêu cầu, kể cả khi xác thực thất bại để frontend xử lý tiếp | body: `SAMLIdpResponse` | |
| 🌐 | `GET` | `/saml/logout` | Tạo dữ liệu cần thiết để IdP xử lý đăng xuất |  | |
| 🌐 | `GET` | `/saml/sls` | Xử lý phản hồi đăng xuất từ IdP | query: `SAMLResponse`, `RelayState` | |
| 🌐 | `POST` | `/saml/sso` | Tạo context SAML và chuyển hướng tới trang đăng nhập của IdP | body: `SAMLLoginContext` | |
| 🌐 | `POST` | `/token` | Tạo token (đăng nhập / gia hạn bằng refresh token) | body: `JSON` | |
| 🌐 | `GET` | `/token/{token}` | Xem thông tin token | query: `scope`, `tenant` | |
| 🌐 | `DELETE` | `/token/{token}` | Thu hồi token (đăng xuất) |  | |
| 🌐 | `HEAD` | `/token/{token}` | Kiểm tra token còn hợp lệ không | query: `scope`, `tenant` | |
| 🌐 | `POST` | `/token/{token}/scopes/check` | Kiểm tra token có các scope chỉ định không | body: `ScopeCheckRequest` | |
|  | `GET` | `/tokens` | Danh sách refresh token đã tạo trên hệ thống | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `auth.tokens.read` |
| 👤 | `GET` | `/users/{user_uuid_or_me}/tokens` | Danh sách refresh token của user | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.users.{user_uuid}.tokens.read` |
| 👤 | `DELETE` | `/users/{user_uuid_or_me}/tokens/{client_id}` | Xoá refresh token của user |  | `auth.users.{user_uuid}.tokens.{client_id}.delete` |

### wazo-auth · users

Tài khoản đăng nhập: tạo, đổi mật khẩu, email, policy, nhóm, refresh token của user.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `PUT` | `/idp/{idp_type}/users/{user_uuid}` | Gán user vào một IDP |  | `auth.idp.{idp_type}.users.{user_uuid}.create` |
|  | `DELETE` | `/idp/{idp_type}/users/{user_uuid}` | Bỏ user khỏi IDP |  | `auth.idp.{idp_type}.users.{user_uuid}.delete` |
|  | `GET` | `/users` | Danh sách user | query: `order`, `direction`, `limit`, `offset`, `search`, `recurse`, `has_policy_slug`, `has_policy_uuid`, `policy_slug`, `policy_uuid` | `auth.users.read` |
|  | `POST` | `/users` | Tạo user | body: `UserCreate` | `auth.users.create` |
| 🌐 | `GET` | `/users/password/reset` | Đặt lại mật khẩu user (quên mật khẩu) | query: `username`, `email`, `login` | |
|  | `POST` | `/users/password/reset` | Đặt mật khẩu cho user | query: `user_uuid`<br>body: `PostPasswordReset` | `auth.users.password.reset.{user_uuid}.create` |
| 🌐 | `POST` | `/users/register` | Tạo user | body: `UserRegister` | |
|  | `GET` | `/users/{user_uuid}` | Xem chi tiết user |  | `auth.users.{user_uuid}.read` |
|  | `PUT` | `/users/{user_uuid}` | Cập nhật user | body: `UserEdit` | `auth.users.{user_uuid}.update` |
|  | `DELETE` | `/users/{user_uuid}` | Xoá user |  | `auth.users.{user_uuid}.delete` |
|  | `PUT` | `/users/{user_uuid}/emails` | Cập nhật địa chỉ email | body: `UserEmailList` | `auth.users.{user_uuid}.emails.update` |
|  | `GET` | `/users/{user_uuid}/emails/{email_uuid}/confirm` | Yêu cầu gửi lại email xác nhận |  | `auth.users.{user_uuid}.emails.{email_uuid}.confirm.read` |
|  | `GET` | `/users/{user_uuid}/external` | Danh sách dữ liệu xác thực ngoài của user | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.users.{user_uuid}.external.read` |
|  | `GET` | `/users/{user_uuid}/external/google` | Lấy Google token |  | `auth.users.{user_uuid}.external.google.read` |
|  | `POST` | `/users/{user_uuid}/external/google` | Lấy URL xác minh và lưu mã để lấy token | body: `GooglePost` | `auth.users.{user_uuid}.external.google.create` |
|  | `DELETE` | `/users/{user_uuid}/external/google` | Xoá Google token |  | `auth.users.{user_uuid}.external.google.delete` |
|  | `GET` | `/users/{user_uuid}/external/microsoft` | Lấy Microsoft token |  | `auth.users.{user_uuid}.external.microsoft.read` |
|  | `POST` | `/users/{user_uuid}/external/microsoft` | Lấy URL xác minh và lưu mã để lấy token | body: `MicrosoftPost` | `auth.users.{user_uuid}.external.microsoft.create` |
|  | `DELETE` | `/users/{user_uuid}/external/microsoft` | Xoá Microsoft token |  | `auth.users.{user_uuid}.external.microsoft.delete` |
|  | `GET` | `/users/{user_uuid}/external/mobile` | Xem device token push notification |  | `auth.users.{user_uuid}.external.mobile.read` |
|  | `POST` | `/users/{user_uuid}/external/mobile` | Cấu hình device token cho push notification | body: `MobileData` | `auth.users.{user_uuid}.external.mobile.create` |
|  | `PUT` | `/users/{user_uuid}/external/mobile` | Cập nhật device token push notification | body: `MobileData` | `auth.users.{user_uuid}.external.mobile.update` |
|  | `DELETE` | `/users/{user_uuid}/external/mobile` | Xoá device token push notification |  | `auth.users.{user_uuid}.external.mobile.delete` |
|  | `GET` | `/users/{user_uuid}/external/mobile/sender_id` | Lấy sender_id mobile (push) |  | `auth.users.{user_uuid}.external.mobile.sender_id.read` |
|  | `GET` | `/users/{user_uuid}/groups` | Danh sách group của user | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.users.{user_uuid}.groups.read` |
| 👤 | `PUT` | `/users/{user_uuid}/password` | Đổi mật khẩu của user | body: `PasswordChange` | `auth.users.{user_uuid}.password.update` |
|  | `GET` | `/users/{user_uuid}/policies` | Danh sách policy của user | query: `order`, `direction`, `limit`, `offset`, `search` | `auth.users.{user_uuid}.policies.read` |
|  | `PUT` | `/users/{user_uuid}/policies/{policy_uuid}` | Gán policy cho user |  | `auth.users.{user_uuid}.policies.{policy_uuid}.create` |
|  | `DELETE` | `/users/{user_uuid}/policies/{policy_uuid}` | Bỏ policy khỏi user |  | `auth.users.{user_uuid}.policies.{policy_uuid}.delete` |
|  | `GET` | `/users/{user_uuid}/sessions` | Danh sách session của user | query: `order`, `direction`, `limit`, `offset` | `auth.users.{user_uuid}.sessions.read` |
|  | `DELETE` | `/users/{user_uuid}/sessions/{session_uuid}` | Xoá session |  | `auth.users.{user_uuid}.sessions.{session_uuid}.delete` |


## wazo-confd

**Cấu hình hệ thống.** Toàn bộ cấu hình tổng đài: user, line, máy lẻ, context & dải số, nhóm đổ chuông, hàng đợi, phòng họp, IVR, lịch làm việc, trung kế, thiết bị, âm thanh... Phần lớn là API quản trị; user thường chỉ đọc/sửa dữ liệu của chính mình.

Base URL: `https://<HOST>/api/confd/1.1` · Spec: `api-specs/wazo-confd.yml` · 425 endpoint, 35 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [access_features](#wazo-confd-access-features) | 5 | Giới hạn dải IP được dùng các tính năng (vd. phpfastagi). |
| [agents](#wazo-confd-agents) | 10 | Agent call center: tạo, gán kỹ năng, gán vào hàng đợi. |
| [applications](#wazo-confd-applications) | 5 | Ứng dụng Stasis tuỳ biến (điều khiển cuộc gọi bằng code qua calld). |
| [asterisk](#wazo-confd-asterisk) | 31 | Cấu hình Asterisk ở mức hệ thống: PJSIP global/system, RTP (dải cổng, ICE), voicemail, features, confbridge, IAX... |
| [blocklist](#wazo-confd-blocklist) | 9 | Danh sách số bị chặn của user. |
| [callfilters](#wazo-confd-callfilters) | 9 | Bộ lọc cuộc gọi sếp/thư ký. |
| [callpermissions](#wazo-confd-callpermissions) | 5 | Quyền gọi: chặn/cho phép gọi tới số nhất định (theo user, nhóm, outcall). |
| [callpickups](#wazo-confd-callpickups) | 9 | Bắt máy hộ (call pickup) trong nhóm. |
| [conferences](#wazo-confd-conferences) | 7 | Phòng họp thoại cố định (ConfBridge) có số máy lẻ — dùng cho gọi nhóm. |
| [configuration](#wazo-confd-configuration) | 2 | Bật/tắt chế độ "live reload" cấu hình. |
| [contexts](#wazo-confd-contexts) | 7 | Context (vùng quay số) và các dải số: user, nhóm, hàng đợi, phòng họp, số gọi vào. |
| [devices](#wazo-confd-devices) | 9 | Điện thoại IP vật lý: khai báo, gán line, tự cấu hình (provisioning), khởi động lại. |
| [dhcp](#wazo-confd-dhcp) | 2 | Cấu hình DHCP cho provisioning điện thoại IP. |
| [emails](#wazo-confd-emails) | 2 | Cấu hình máy chủ gửi email (SMTP). |
| [endpoints](#wazo-confd-endpoints) | 25 | Endpoint SIP/SCCP/IAX/custom: thông tin kết nối của line và trung kế, template SIP (vd. "webrtc"). |
| [extensions](#wazo-confd-extensions) | 9 | Số máy lẻ / số quay: tạo, gán cho user, nhóm, hàng đợi, phòng họp...; mã tính năng (*xx). |
| [external_apps](#wazo-confd-external-apps) | 10 | Cấu hình ứng dụng bên ngoài gắn với tenant/user (lưu dữ liệu tuỳ ý). |
| [forwards](#wazo-confd-forwards) | 4 | Chuyển tiếp cuộc gọi của user: khi bận, không trả lời, vô điều kiện. |
| [funckeys](#wazo-confd-funckeys) | 18 | Phím chức năng trên điện thoại IP (BLF, quay nhanh...). |
| [groups](#wazo-confd-groups) | 16 | Nhóm đổ chuông (ring group): đổ chuông nhiều người cùng lúc hoặc lần lượt. |
| [ha](#wazo-confd-ha) | 2 | Cấu hình dự phòng (high availability). |
| [incalls](#wazo-confd-incalls) | 9 | Cuộc gọi từ ngoài vào: số DID và nơi chuyển tới (user, IVR, nhóm...). |
| [infos](#wazo-confd-infos) | 1 | Thông tin hệ thống (UUID, phiên bản). |
| [ingresses](#wazo-confd-ingresses) | 5 | Địa chỉ công khai của hệ thống (bắt buộc khai báo để dùng meeting). |
| [ivr](#wazo-confd-ivr) | 5 | IVR (tổng đài trả lời tự động: "bấm 1 để..."). |
| [lines](#wazo-confd-lines) | 19 | Line (đường điện thoại của user): tạo, gán endpoint SIP, máy lẻ, thiết bị. |
| [localization](#wazo-confd-localization) | 2 | Ngôn ngữ, quốc gia mặc định của tenant. |
| [meeting_authorizations](#wazo-confd-meeting-authorizations) | 7 | Duyệt khách xin vào meeting. |
| [meetings](#wazo-confd-meetings) | 11 | Meeting (phòng họp có link/số tham gia, có thể tạo bởi chính user). |
| [moh](#wazo-confd-moh) | 8 | Nhạc chờ (music on hold). |
| [outcalls](#wazo-confd-outcalls) | 12 | Gọi ra ngoài: quy tắc quay số và trung kế được dùng. |
| [pagings](#wazo-confd-pagings) | 7 | Phát thanh (paging) tới nhiều máy cùng lúc. |
| [parking_lots](#wazo-confd-parking-lots) | 7 | Bãi đỗ cuộc gọi (gác cuộc gọi để người khác nhấc). |
| [phone-numbers](#wazo-confd-phone-numbers) | 8 | Danh sách số điện thoại (DID) của tenant. |
| [provisioning](#wazo-confd-provisioning) | 2 | Cấu hình chung của provisioning điện thoại IP. |
| [queues](#wazo-confd-queues) | 18 | Hàng đợi cuộc gọi (call center). |
| [recordings-announcements](#wazo-confd-recordings-announcements) | 2 | Thông báo phát trước khi ghi âm. |
| [registers](#wazo-confd-registers) | 5 | Đăng ký SIP/IAX ra nhà mạng (register). |
| [registrars](#wazo-confd-registrars) | 5 | Registrar/proxy cho điện thoại IP. |
| [schedules](#wazo-confd-schedules) | 5 | Lịch làm việc (giờ hành chính) áp cho user, nhóm, số gọi vào... |
| [sip](#wazo-confd-sip) | 9 | Cấu hình SIP: transport (udp/tcp/wss), template, endpoint SIP. |
| [skills](#wazo-confd-skills) | 4 | Kỹ năng agent và quy tắc phân cuộc gọi theo kỹ năng. |
| [sounds](#wazo-confd-sounds) | 8 | File âm thanh tuỳ chỉnh (lời chào, thông báo). |
| [status](#wazo-confd-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [switchboards](#wazo-confd-switchboards) | 8 | Bảng điều khiển trực tổng đài (lễ tân). |
| [tenants](#wazo-confd-tenants) | 2 | Thông tin tenant phía confd. |
| [timezones](#wazo-confd-timezones) | 1 | Danh sách múi giờ. |
| [trunks](#wazo-confd-trunks) | 13 | Trung kế SIP/IAX nối ra tổng đài khác hoặc nhà mạng. |
| [users](#wazo-confd-users) | 35 | User (người dùng điện thoại): tạo/sửa/xoá, import/export CSV, gán line, nhóm, DND, chuyển tiếp, phím chức năng... |
| [voicemails](#wazo-confd-voicemails) | 7 | Hộp thư thoại: tạo, gán cho user. |
| [wizard](#wazo-confd-wizard) | 3 | Trình cài đặt ban đầu (đã chạy khi build image). |

### wazo-confd · access_features

Giới hạn dải IP được dùng các tính năng (vd. phpfastagi).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/access_features` | Danh sách access feature | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.access_features.read` |
|  | `POST` | `/access_features` | Tạo access_feature | body: `AccessFeature` | `confd.access_features.create` |
|  | `GET` | `/access_features/{access_feature_id}` | Xem access_feature |  | `confd.access_features.{access_feature_id}.read` |
|  | `PUT` | `/access_features/{access_feature_id}` | Cập nhật access_feature | body: `AccessFeature` | `confd.access_features.{access_feature_id}.update` |
|  | `DELETE` | `/access_features/{access_feature_id}` | Xoá access feature |  | `confd.access_features.{access_feature_id}.delete` |

### wazo-confd · agents

Agent call center: tạo, gán kỹ năng, gán vào hàng đợi.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/agents` | Danh sách agent | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.agents.read` |
|  | `POST` | `/agents` | Tạo agent | body: `Agent` | `confd.agents.create` |
|  | `GET` | `/agents/skills` | Danh sách skill | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.agents.skills.read` |
|  | `POST` | `/agents/skills` | Tạo skill | body: `Skill` | `confd.agents.skills.create` |
|  | `GET` | `/agents/skills/{skill_id}` | Xem skill |  | `confd.agents.skills.{skill_id}.read` |
|  | `GET` | `/agents/{agent_id}` | Xem agent |  | `confd.agents.{agent_id}.read` |
|  | `PUT` | `/agents/{agent_id}` | Cập nhật agent | body: `Agent` | `confd.agents.{agent_id}.update` |
|  | `DELETE` | `/agents/{agent_id}` | Xoá agent |  | `confd.agents.{agent_id}.delete` |
|  | `PUT` | `/queues/{queue_id}/members/agents/{agent_id}` | Cập nhật liên kết Agent–Queue | body: `QueueMemberAgent` | `confd.queues.{queue_id}.members.agents.{agent_id}.update` |
|  | `DELETE` | `/queues/{queue_id}/members/agents/{agent_id}` | Bỏ agent khỏi queue |  | `confd.queues.{queue_id}.members.agents.{agent_id}.delete` |

### wazo-confd · applications

Ứng dụng Stasis tuỳ biến (điều khiển cuộc gọi bằng code qua calld).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/applications` | Danh sách application | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.applications.read` |
|  | `POST` | `/applications` | Tạo application | body: `Application` | `confd.applications.create` |
|  | `GET` | `/applications/{application_uuid}` | Xem application |  | `confd.applications.{application_uuid}.read` |
|  | `PUT` | `/applications/{application_uuid}` | Cập nhật application | body: `Application` | `confd.applications.{application_uuid}.update` |
|  | `DELETE` | `/applications/{application_uuid}` | Xoá application |  | `confd.applications.{application_uuid}.delete` |

### wazo-confd · asterisk

Cấu hình Asterisk ở mức hệ thống: PJSIP global/system, RTP (dải cổng, ICE), voicemail, features, confbridge, IAX...

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/asterisk/confbridge/wazo_default_bridge` | Danh sách tuỳ chọn ConfBridge wazo_default_bridge |  | `confd.asterisk.confbridge.wazo_default_bridge.read` |
|  | `PUT` | `/asterisk/confbridge/wazo_default_bridge` | Cập nhật tuỳ chọn ConfBridge wazo_default_bridge | body: `ConfBridgeConfiguration` | `confd.asterisk.confbridge.wazo_default_bridge.update` |
|  | `GET` | `/asterisk/confbridge/wazo_default_user` | Danh sách tuỳ chọn ConfBridge wazo_default_user |  | `confd.asterisk.confbridge.wazo_default_user.read` |
|  | `PUT` | `/asterisk/confbridge/wazo_default_user` | Cập nhật tuỳ chọn ConfBridge wazo_default_user | body: `ConfBridgeConfiguration` | `confd.asterisk.confbridge.wazo_default_user.update` |
|  | `GET` | `/asterisk/features/applicationmap` | Danh sách tuỳ chọn Features applicationmap |  | `confd.asterisk.features.applicationmap.read` |
|  | `PUT` | `/asterisk/features/applicationmap` | Cập nhật tuỳ chọn Features applicationmap | body: `FeaturesConfiguration` | `confd.asterisk.features.applicationmap.update` |
|  | `GET` | `/asterisk/features/featuremap` | Danh sách tuỳ chọn Features featuremap |  | `confd.asterisk.features.featuremap.read` |
|  | `PUT` | `/asterisk/features/featuremap` | Cập nhật tuỳ chọn Features featuremap | body: `FeaturesConfiguration` | `confd.asterisk.features.featuremap.update` |
|  | `GET` | `/asterisk/features/general` | Danh sách tuỳ chọn Features general |  | `confd.asterisk.features.general.read` |
|  | `PUT` | `/asterisk/features/general` | Cập nhật tuỳ chọn Features general | body: `FeaturesConfiguration` | `confd.asterisk.features.general.update` |
|  | `GET` | `/asterisk/hep/general` | Danh sách tuỳ chọn HEP general |  | `confd.asterisk.hep.general.read` |
|  | `PUT` | `/asterisk/hep/general` | Cập nhật tuỳ chọn HEP general | body: `HEPConfiguration` | `confd.asterisk.hep.general.update` |
|  | `GET` | `/asterisk/iax/callnumberlimits` | Danh sách tuỳ chọn IAX callnumberlimits |  | `confd.asterisk.iax.callnumberlimits.read` |
|  | `PUT` | `/asterisk/iax/callnumberlimits` | Cập nhật tuỳ chọn IAX callnumberlimits | body: `IAXCallNumberLimitss` | `confd.asterisk.iax.callnumberlimits.update` |
|  | `GET` | `/asterisk/iax/general` | Danh sách tuỳ chọn IAX general |  | `confd.asterisk.iax.general.read` |
|  | `PUT` | `/asterisk/iax/general` | Cập nhật tuỳ chọn IAX general | body: `IAXGeneral` | `confd.asterisk.iax.general.update` |
|  | `GET` | `/asterisk/pjsip/doc` | Danh sách tất cả tuỳ chọn cấu hình PJSIP |  | `confd.asterisk.pjsip.doc.read` |
|  | `GET` | `/asterisk/pjsip/global` | Danh sách tuỳ chọn PJSIP mục `global` |  | `confd.asterisk.pjsip.global.read` |
|  | `GET` | `/asterisk/pjsip/system` | Danh sách tuỳ chọn PJSIP mục `system` |  | `confd.asterisk.pjsip.system.read` |
|  | `GET` | `/asterisk/queues/general` | Danh sách tuỳ chọn Queue general |  | `confd.asterisk.queue.general.read` |
|  | `PUT` | `/asterisk/queues/general` | Cập nhật tuỳ chọn Queue general | body: `QueueGeneral` | `confd.asterisk.queue.general.update` |
|  | `GET` | `/asterisk/rtp/general` | Danh sách tuỳ chọn RTP general (dải cổng RTP...) |  | `confd.asterisk.rtp.general.read` |
|  | `PUT` | `/asterisk/rtp/general` | Cập nhật tuỳ chọn RTP general (dải cổng RTP...) | body: `RTPConfiguration` | `confd.asterisk.rtp.general.update` |
|  | `GET` | `/asterisk/rtp/ice_host_candidates` | Danh sách tuỳ chọn RTP ice_host_candidates |  | `confd.asterisk.rtp.ice_host_candidates.read` |
|  | `PUT` | `/asterisk/rtp/ice_host_candidates` | Cập nhật tuỳ chọn RTP ice_host_candidates | body: `RTPConfiguration` | `confd.asterisk.rtp.ice_host_candidates.update` |
|  | `GET` | `/asterisk/sccp/general` | Danh sách tuỳ chọn SCCP general |  | `confd.asterisk.sccp.general.read` |
|  | `PUT` | `/asterisk/sccp/general` | Cập nhật tuỳ chọn SCCP general | body: `SCCPGeneral` | `confd.asterisk.sccp.general.update` |
|  | `GET` | `/asterisk/voicemail/general` | Danh sách tuỳ chọn Voicemail general |  | `confd.asterisk.voicemail.general.read` |
|  | `PUT` | `/asterisk/voicemail/general` | Cập nhật tuỳ chọn Voicemail general | body: `VoicemailGeneral` | `confd.asterisk.voicemail.general.update` |
|  | `GET` | `/asterisk/voicemail/zonemessages` | Danh sách tuỳ chọn Voicemail zonemessages |  | `confd.asterisk.voicemail.zonemessages.read` |
|  | `PUT` | `/asterisk/voicemail/zonemessages` | Cập nhật tuỳ chọn Voicemail zonemessages | body: `VoicemailZoneMessages` | `confd.asterisk.voicemail.zonemessages.update` |

### wazo-confd · blocklist

Danh sách số bị chặn của user.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/users/blocklist/numbers` | Danh sách mọi số trong blocklist của tenant | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `user_uuid`, `number`, `label` | `confd.users.blocklist.read` |
|  | `GET` | `/users/blocklist/numbers/{blocklist_number_uuid}` | Xem số trong blocklist theo uuid |  | `confd.users.blocklist.read` |
| 👤 | `GET` | `/users/me/blocklist/numbers` | Danh sách số blocklist của user hiện tại | query: `order`, `direction`, `limit`, `offset`, `search`, `number`, `label` | `confd.users.me.blocklist.read` |
| 👤 | `POST` | `/users/me/blocklist/numbers` | Thêm số vào blocklist | body: `UserBlocklistNumber` | `confd.users.me.blocklist.create` |
| 👤 | `GET` | `/users/me/blocklist/numbers/{blocklist_number_uuid}` | Xem số trong blocklist theo uuid |  | `confd.users.me.blocklist.read` |
| 👤 | `PUT` | `/users/me/blocklist/numbers/{blocklist_number_uuid}` | Cập nhật một số trong blocklist theo uuid | body: `UserBlocklistNumber` | `confd.users.me.blocklist.update` |
| 👤 | `DELETE` | `/users/me/blocklist/numbers/{blocklist_number_uuid}` | Xoá một số trong blocklist theo uuid |  | `confd.users.me.blocklist.delete` |
| 👤 | `GET` | `/users/{user_uuid}/blocklist/numbers` | Danh sách số blocklist của một user | query: `order`, `direction`, `limit`, `offset`, `search`, `number`, `label` | `confd.users.{user_uuid}.blocklist.read` |
| 👤 | `HEAD` | `/users/{user_uuid}/blocklist/numbers` | Kiểm tra số có nằm trong blocklist của user không | query: `number_exact` | `confd.users.{user_uuid}.blocklist.read` |

### wazo-confd · callfilters

Bộ lọc cuộc gọi sếp/thư ký.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/callfilters` | Danh sách call filter | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.callfilters.read` |
|  | `POST` | `/callfilters` | Tạo call filter | body: `CallFilter` | `confd.callfilters.create` |
|  | `GET` | `/callfilters/{callfilter_id}` | Xem call filter |  | `confd.callfilters.{callfilter_id}.read` |
|  | `PUT` | `/callfilters/{callfilter_id}` | Cập nhật call filter | body: `CallFilter` | `confd.callfilters.{callfilter_id}.update` |
|  | `DELETE` | `/callfilters/{callfilter_id}` | Xoá call filter |  | `confd.callfilters.{callfilter_id}.delete` |
|  | `GET` | `/callfilters/{callfilter_id}/fallbacks` | Danh sách fallback của call filter |  | `confd.callfilters.{callfilter_id}.fallbacks.read` |
|  | `PUT` | `/callfilters/{callfilter_id}/fallbacks` | Cập nhật fallback của call filter | body: `CallFilterFallbacks` | `confd.callfilters.{callfilter_id}.fallbacks.update` |
|  | `PUT` | `/callfilters/{callfilter_id}/recipients/users` | Cập nhật call filter và người nhận | body: `CallFilterRecipientUsersUuid` | `confd.callfilters.{callfilter_id}.recipients.users.update` |
|  | `PUT` | `/callfilters/{callfilter_id}/surrogates/users` | Cập nhật call filter và người thay thế | body: `UsersUuid` | `confd.callfilters.{callfilter_id}.surrogates.users.update` |

### wazo-confd · callpermissions

Quyền gọi: chặn/cho phép gọi tới số nhất định (theo user, nhóm, outcall).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/callpermissions` | Danh sách call permission | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.callpermissions.read` |
|  | `POST` | `/callpermissions` | Tạo call permission | body: `CallPermission` | `confd.callpermissions.create` |
|  | `GET` | `/callpermissions/{callpermission_id}` | Xem call permission |  | `confd.callpermissions.{callpermission_id}.read` |
|  | `PUT` | `/callpermissions/{callpermission_id}` | Cập nhật call permission | body: `CallPermission` | `confd.callpermissions.{callpermission_id}.update` |
|  | `DELETE` | `/callpermissions/{callpermission_id}` | Xoá call permission |  | `confd.callpermissions.{callpermission_id}.delete` |

### wazo-confd · callpickups

Bắt máy hộ (call pickup) trong nhóm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/callpickups` | Danh sách call pickup | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.callpickups.read` |
|  | `POST` | `/callpickups` | Tạo call pickup | body: `CallPickup` | `confd.callpickups.create` |
|  | `GET` | `/callpickups/{callpickup_id}` | Xem call pickup |  | `confd.callpickups.{callpickup_id}.read` |
|  | `PUT` | `/callpickups/{callpickup_id}` | Cập nhật call pickup | body: `CallPickup` | `confd.callpickups.{callpickup_id}.update` |
|  | `DELETE` | `/callpickups/{callpickup_id}` | Xoá call pickup |  | `confd.callpickups.{callpickup_id}.delete` |
|  | `PUT` | `/callpickups/{callpickup_id}/interceptors/groups` | Cập nhật call pickup và người bắt máy hộ | body: `GroupsID` | `confd.callpickups.{callpickup_id}.interceptors.groups.update` |
|  | `PUT` | `/callpickups/{callpickup_id}/interceptors/users` | Cập nhật call pickup và người bắt máy hộ | body: `UsersUuid` | `confd.callpickups.{callpickup_id}.interceptors.users.update` |
|  | `PUT` | `/callpickups/{callpickup_id}/targets/groups` | Cập nhật call pickup và các máy đích | body: `GroupsID` | `confd.callpickups.{callpickup_id}.targets.groups.update` |
|  | `PUT` | `/callpickups/{callpickup_id}/targets/users` | Cập nhật call pickup và các máy đích | body: `UsersUuid` | `confd.callpickups.{callpickup_id}.targets.users.update` |

### wazo-confd · conferences

Phòng họp thoại cố định (ConfBridge) có số máy lẻ — dùng cho gọi nhóm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/conferences` | Danh sách conference | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.conferences.read` |
|  | `POST` | `/conferences` | Tạo conference (phòng họp) | body: `Conference` | `confd.conferences.create` |
|  | `GET` | `/conferences/{conference_id}` | Xem conference |  | `confd.conferences.{conference_id}.read` |
|  | `PUT` | `/conferences/{conference_id}` | Cập nhật conference | body: `Conference` | `confd.conferences.{conference_id}.update` |
|  | `DELETE` | `/conferences/{conference_id}` | Xoá conference |  | `confd.conferences.{conference_id}.delete` |
|  | `PUT` | `/conferences/{conference_id}/extensions/{extension_id}` | Gán extension cho conference |  | `confd.conferences.{conference_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/conferences/{conference_id}/extensions/{extension_id}` | Bỏ extension khỏi conference |  | `confd.conferences.{conference_id}.extensions.{extension_id}.delete` |

### wazo-confd · configuration

Bật/tắt chế độ "live reload" cấu hình.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/configuration/live_reload` | Xem trạng thái live reload |  | `confd.configuration.live_reload.read` |
|  | `PUT` | `/configuration/live_reload` | Cập nhật trạng thái live reload | body: `LiveReload` | `confd.configuration.live_reload.update` |

### wazo-confd · contexts

Context (vùng quay số) và các dải số: user, nhóm, hàng đợi, phòng họp, số gọi vào.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/contexts` | Danh sách context | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.contexts.read` |
|  | `POST` | `/contexts` | Tạo context | body: `Context` | `confd.contexts.create` |
|  | `GET` | `/contexts/{context_id}` | Xem context |  | `confd.contexts.{context_id}.read` |
|  | `PUT` | `/contexts/{context_id}` | Cập nhật context (gồm các dải số) | body: `Context` | `confd.contexts.{context_id}.update` |
|  | `DELETE` | `/contexts/{context_id}` | Xoá context |  | `confd.contexts.{context_id}.delete` |
|  | `PUT` | `/contexts/{context_id}/contexts` | Nhúng (include) các context vào context | body: `ContextsId` | `confd.contexts.{context_id}.contexts.update` |
|  | `GET` | `/contexts/{context_id}/ranges/{range_type}` | Danh sách dải số của context | query: `order`, `direction`, `limit`, `offset`, `search`, `availability` | `confd.contexts.{context_id}.ranges.{range_type}.read` |

### wazo-confd · devices

Điện thoại IP vật lý: khai báo, gán line, tự cấu hình (provisioning), khởi động lại.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/devices` | Danh sách device | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.devices.read` |
|  | `POST` | `/devices` | Tạo device | body: `Device` | `confd.devices.create` |
|  | `GET` | `/devices/unallocated` | Danh sách device chưa phân bổ | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.devices.unallocated.read` |
|  | `PUT` | `/devices/unallocated/{device_id}` | Gán thiết bị chưa phân bổ cho tenant |  | `confd.devices.unallocated.{device_id}.update` |
|  | `GET` | `/devices/{device_id}` | Xem device |  | `confd.devices.{device_id}.read` |
|  | `PUT` | `/devices/{device_id}` | Cập nhật device | body: `Device` | `confd.devices.{device_id}.update` |
|  | `DELETE` | `/devices/{device_id}` | Xoá device |  | `confd.devices.{device_id}.delete` |
|  | `GET` | `/devices/{device_id}/autoprov` | Đặt lại device về chế độ autoprov |  | `confd.devices.{device_id}.autoprov.read` |
|  | `GET` | `/devices/{device_id}/synchronize` | Đồng bộ device |  | `confd.devices.{device_id}.synchronize.read` |

### wazo-confd · dhcp

Cấu hình DHCP cho provisioning điện thoại IP.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/dhcp` | Xem cấu hình DHCP |  | `confd.dhcp.read` |
|  | `PUT` | `/dhcp` | Cập nhật cấu hình DHCP | body: `DHCP` | `confd.dhcp.update` |

### wazo-confd · emails

Cấu hình máy chủ gửi email (SMTP).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/emails` | Xem cấu hình email |  | `confd.emails.read` |
|  | `PUT` | `/emails` | Cập nhật cấu hình email | body: `EmailConfig` | `confd.emails.update` |

### wazo-confd · endpoints

Endpoint SIP/SCCP/IAX/custom: thông tin kết nối của line và trung kế, template SIP (vd. "webrtc").

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/endpoints/custom` | Danh sách Custom endpoint | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.endpoints.custom.read` |
|  | `POST` | `/endpoints/custom` | Tạo Custom endpoint | body: `EndpointCustom` | `confd.endpoints.custom.create` |
|  | `GET` | `/endpoints/custom/{custom_id}` | Xem Custom endpoint |  | `confd.endpoints.custom.{custom_id}.read` |
|  | `PUT` | `/endpoints/custom/{custom_id}` | Cập nhật Custom endpoint | body: `EndpointCustom` | `confd.endpoints.custom.{custom_id}.update` |
|  | `DELETE` | `/endpoints/custom/{custom_id}` | Xoá Custom endpoint |  | `confd.endpoints.custom.{custom_id}.delete` |
|  | `GET` | `/endpoints/iax` | Danh sách IAX endpoint | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.endpoints.iax.read` |
|  | `POST` | `/endpoints/iax` | Tạo IAX endpoint | body: `EndpointIAX` | `confd.endpoints.iax.create` |
|  | `GET` | `/endpoints/iax/{iax_id}` | Xem IAX endpoint |  | `confd.endpoints.iax.{iax_id}.read` |
|  | `PUT` | `/endpoints/iax/{iax_id}` | Cập nhật IAX endpoint | body: `EndpointIAX` | `confd.endpoints.iax.{iax_id}.update` |
|  | `DELETE` | `/endpoints/iax/{iax_id}` | Xoá IAX endpoint |  | `confd.endpoints.iax.{iax_id}.delete` |
|  | `GET` | `/endpoints/sccp` | Danh sách SCCP endpoint | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.endpoints.sccp.read` |
|  | `POST` | `/endpoints/sccp` | Tạo SCCP endpoint | body: `EndpointSccp` | `confd.endpoints.sccp.create` |
|  | `GET` | `/endpoints/sccp/{sccp_id}` | Xem SCCP endpoint |  | `confd.endpoints.sccp.{sccp_id}.read` |
|  | `PUT` | `/endpoints/sccp/{sccp_id}` | Cập nhật SCCP endpoint | body: `EndpointSccp` | `confd.endpoints.sccp.{sccp_id}.update` |
|  | `DELETE` | `/endpoints/sccp/{sccp_id}` | Xoá SCCP endpoint |  | `confd.endpoints.sccp.{sccp_id}.delete` |
|  | `GET` | `/endpoints/sip` | Danh sách SIP endpoint | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `uuid` | `confd.endpoints.sip.read` |
|  | `POST` | `/endpoints/sip` | Tạo SIP endpoint | body: `EndpointSIP` | `confd.endpoints.sip.create` |
|  | `GET` | `/endpoints/sip/templates` | Danh sách SIP endpoint template | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.endpoints.sip.templates.read` |
|  | `POST` | `/endpoints/sip/templates` | Tạo SIP endpoint template | body: `EndpointSIP` | `confd.endpoints.sip.templates.create` |
|  | `PUT` | `/endpoints/sip/templates/{template_uuid}` | Cập nhật SIP endpoint template | body: `EndpointSIP` | `confd.endpoints.sip.templates.{template_uuid}.update` |
|  | `DELETE` | `/endpoints/sip/templates/{template_uuid}` | Xoá SIP endpoint template |  | `confd.endpoints.sip.templates.{template_uuid}.delete` |
|  | `PUT` | `/endpoints/sip/{sip_uuid}` | Cập nhật SIP endpoint | body: `EndpointSIP` | `confd.endpoints.sip.{sip_uuid}.update` |
|  | `DELETE` | `/endpoints/sip/{sip_uuid}` | Xoá SIP endpoint |  | `confd.endpoints.sip.{sip_uuid}.delete` |
| 👤 | `GET` | `/users/{user_uuid}/lines/main/associated/endpoints/sip` | Xem SIP endpoint của line chính của user | query: `view` | `confd.users.{user_uuid}.lines.main.associated.endpoints.sip.read` |
| 👤 | `GET` | `/users/{user_uuid}/lines/{line_id}/associated/endpoints/sip` | Xem SIP endpoint của một line của user | query: `view` | `confd.users.{user_uuid}.lines.{line_id}.associated.endpoints.sip.read` |

### wazo-confd · extensions

Số máy lẻ / số quay: tạo, gán cho user, nhóm, hàng đợi, phòng họp...; mã tính năng (*xx).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/extensions` | Danh sách extension | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `type`, `exten`, `context` | `confd.extensions.read` |
|  | `POST` | `/extensions` | Tạo extension | body: `Extension` | `confd.extensions.create` |
|  | `GET` | `/extensions/features` | Danh sách extension feature (mã tính năng) | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.extensions.features.read` |
|  | `GET` | `/extensions/features/{extension_uuid}` | Xem extension feature (mã tính năng) |  | `confd.extensions.features.{extension_uuid}.read` |
|  | `PUT` | `/extensions/features/{extension_uuid}` | Cập nhật extension | body: `ExtensionFeature` | `confd.extensions.features.{extension_uuid}.update` |
|  | `GET` | `/extensions/{extension_id}` | Xem extension |  | `confd.extensions.{extension_id}.read` |
|  | `PUT` | `/extensions/{extension_id}` | Cập nhật extension | body: `Extension` | `confd.extensions.{extension_id}.update` |
|  | `DELETE` | `/extensions/{extension_id}` | Xoá extension |  | `confd.extensions.{extension_id}.delete` |
|  | `POST` | `/lines/{line_id}/extensions` | Tạo extension | body: `Extension` | `confd.lines.{line_id}.extensions.create` |

### wazo-confd · external_apps

Cấu hình ứng dụng bên ngoài gắn với tenant/user (lưu dữ liệu tuỳ ý).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/external/apps` | Danh sách external app | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.external.apps.read` |
|  | `GET` | `/external/apps/{app_name}` | Xem external app |  | `confd.external.apps.{app_name}.read` |
|  | `POST` | `/external/apps/{app_name}` | Tạo external app | body: `ExternalApp` | `confd.external.apps.{app_name}.create` |
|  | `PUT` | `/external/apps/{app_name}` | Cập nhật external app | body: `ExternalApp` | `confd.external.apps.{app_name}.update` |
|  | `DELETE` | `/external/apps/{app_name}` | Xoá external app |  | `confd.external.apps.{app_name}.delete` |
| 👤 | `GET` | `/users/{user_uuid}/external/apps` | Danh sách external app của user | query: `order`, `direction`, `limit`, `offset`, `search`, `view` | `confd.users.{user_uuid}.external.apps.read` |
| 👤 | `GET` | `/users/{user_uuid}/external/apps/{app_name}` | Xem external app của user | query: `view` | `confd.users.{user_uuid}.external.apps.{app_name}.read` |
|  | `POST` | `/users/{user_uuid}/external/apps/{app_name}` | Tạo external app của user | body: `UserExternalApp` | `confd.users.{user_uuid}.external.apps.{app_name}.create` |
|  | `PUT` | `/users/{user_uuid}/external/apps/{app_name}` | Cập nhật external app của user | body: `UserExternalApp` | `confd.users.{user_uuid}.external.apps.{app_name}.update` |
|  | `DELETE` | `/users/{user_uuid}/external/apps/{app_name}` | Xoá external app của user |  | `confd.users.{user_uuid}.external.apps.{app_name}.delete` |

### wazo-confd · forwards

Chuyển tiếp cuộc gọi của user: khi bận, không trả lời, vô điều kiện.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/users/{user_id}/forwards` | Danh sách cấu hình chuyển tiếp của user |  | `confd.users.{user_id}.forwards.read` |
| 👤 | `PUT` | `/users/{user_id}/forwards` | Cập nhật mọi cấu hình chuyển tiếp của user | body: `UserForwards` | `confd.users.{user_id}.forwards.update` |
| 👤 | `GET` | `/users/{user_id}/forwards/{forward_name}` | Xem một cấu hình chuyển tiếp của user |  | `confd.users.{user_id}.forwards.{forward_name}.read` |
| 👤 | `PUT` | `/users/{user_id}/forwards/{forward_name}` | Cập nhật một cấu hình chuyển tiếp của user | body: `UserForward` | `confd.users.{user_id}.forwards.{forward_name}.update` |

### wazo-confd · funckeys

Phím chức năng trên điện thoại IP (BLF, quay nhanh...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/funckeys/destinations` | Danh sách đích có thể gán cho func key và tham số |  | `confd.funckeys.destinations.read` |
|  | `GET` | `/funckeys/templates` | Danh sách func key template | query: `recurse`, `offset`, `limit`, `search` | `confd.funckeys.templates.read` |
|  | `POST` | `/funckeys/templates` | Tạo template func key | body: `FuncKeyTemplate` | `confd.funckeys.templates.create` |
|  | `GET` | `/funckeys/templates/{template_id}` | Xem func key template |  | `confd.funckeys.templates.{template_id}.read` |
|  | `PUT` | `/funckeys/templates/{template_id}` | Cập nhật func key template | body: `FuncKeyTemplate` | `confd.funckeys.templates.{template_id}.update` |
|  | `DELETE` | `/funckeys/templates/{template_id}` | Xoá func key template |  | `confd.funckeys.templates.{template_id}.delete` |
|  | `GET` | `/funckeys/templates/{template_id}/users` | Danh sách user gắn với template |  | `confd.funckeys.templates.{template_id}.users.read` |
|  | `GET` | `/funckeys/templates/{template_id}/{position}` | Xem một func key trong template |  | `confd.funckeys.templates.{template_id}.{position}.read` |
|  | `PUT` | `/funckeys/templates/{template_id}/{position}` | Thêm/thay func key trong template | body: `FuncKey` | `confd.funckeys.templates.{template_id}.{position}.update` |
|  | `DELETE` | `/funckeys/templates/{template_id}/{position}` | Xoá func key khỏi template |  | `confd.funckeys.templates.{template_id}.{position}.delete` |
| 👤 | `GET` | `/users/{user_id}/funckeys` | Danh sách func key của user |  | `confd.users.{user_id}.funckeys.read` |
|  | `PUT` | `/users/{user_id}/funckeys` | Cập nhật func key của user | body: `FuncKeyTemplate` | `confd.users.{user_id}.funckeys.update` |
| 👤 | `GET` | `/users/{user_id}/funckeys/templates` | Danh sách func key template gán cho user |  | `confd.users.{user_id}.funckeys.templates.read` |
|  | `PUT` | `/users/{user_id}/funckeys/templates/{template_id}` | Gán func key template cho user |  | `confd.users.{user_id}.funckeys.templates.{template_id}.update` |
|  | `DELETE` | `/users/{user_id}/funckeys/templates/{template_id}` | Bỏ gán func key template khỏi user |  | `confd.users.{user_id}.funckeys.templates.{template_id}.delete` |
| 👤 | `GET` | `/users/{user_id}/funckeys/{position}` | Xem một func key của user |  | `confd.users.{user_id}.funckeys.{position}.read` |
|  | `PUT` | `/users/{user_id}/funckeys/{position}` | Thêm/thay func key cho user | body: `FuncKey` | `confd.users.{user_id}.funckeys.{position}.update` |
|  | `DELETE` | `/users/{user_id}/funckeys/{position}` | Xoá func key của user |  | `confd.users.{user_id}.funckeys.{position}.delete` |

### wazo-confd · groups

Nhóm đổ chuông (ring group): đổ chuông nhiều người cùng lúc hoặc lần lượt.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/groups` | Danh sách group | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.groups.read` |
|  | `POST` | `/groups` | Tạo group | body: `Group` | `confd.groups.create` |
|  | `GET` | `/groups/{group_uuid}` | Xem group |  | `confd.groups.{group_uuid}.read` |
|  | `PUT` | `/groups/{group_uuid}` | Cập nhật group | body: `Group` | `confd.groups.{group_uuid}.update` |
|  | `DELETE` | `/groups/{group_uuid}` | Xoá group |  | `confd.groups.{group_uuid}.delete` |
|  | `PUT` | `/groups/{group_uuid}/callpermissions/{callpermission_id}` | Gán call permission cho group |  | `confd.groups.{group_uuid}.callpermissions.{call_permission_id}.update` |
|  | `DELETE` | `/groups/{group_uuid}/callpermissions/{callpermission_id}` | Bỏ call permission khỏi group |  | `confd.groups.{group_uuid}.callpermissions.{call_permission_id}.delete` |
|  | `PUT` | `/groups/{group_uuid}/extensions/{extension_id}` | Gán extension cho group |  | `confd.groups.{group_uuid}.extensions.{extension_id}.update` |
|  | `DELETE` | `/groups/{group_uuid}/extensions/{extension_id}` | Bỏ extension khỏi group |  | `confd.groups.{group_uuid}.extensions.{extension_id}.delete` |
|  | `GET` | `/groups/{group_uuid}/fallbacks` | Danh sách fallback của group |  | `confd.groups.{group_uuid}.fallbacks.read` |
|  | `PUT` | `/groups/{group_uuid}/fallbacks` | Cập nhật fallback của group | body: `GroupFallbacks` | `confd.groups.{group_uuid}.fallbacks.update` |
|  | `PUT` | `/groups/{group_uuid}/members/extensions` | Cập nhật thành viên extension của group | body: `GroupMemberExtensions` | `confd.groups.{group_uuid}.members.extensions.update` |
|  | `PUT` | `/groups/{group_uuid}/members/users` | Cập nhật thành viên (user) của group | body: `GroupMemberUsers` | `confd.groups.{group_uuid}.members.users.update` |
|  | `PUT` | `/groups/{group_uuid}/schedules/{schedule_id}` | Gán schedule cho group |  | `confd.groups.{group_uuid}.schedules.{schedule_id}.update` |
|  | `DELETE` | `/groups/{group_uuid}/schedules/{schedule_id}` | Bỏ schedule khỏi group |  | `confd.groups.{group_uuid}.schedules.{schedule_id}.delete` |
|  | `PUT` | `/users/{user_id}/groups` | Cập nhật user và group | body: `UserGroupsID` | `confd.users.{user_id}.groups` |

### wazo-confd · ha

Cấu hình dự phòng (high availability).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/ha` | Xem cấu hình High Availability |  | `confd.ha.read` |
|  | `PUT` | `/ha` | Cập nhật cấu hình High Availability | body: `HA` | `confd.ha.update` |

### wazo-confd · incalls

Cuộc gọi từ ngoài vào: số DID và nơi chuyển tới (user, IVR, nhóm...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/incalls` | Danh sách incall | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `user_id` | `confd.incalls.read` |
|  | `POST` | `/incalls` | Tạo incall (cuộc gọi vào) | body: `Incall` | `confd.incalls.create` |
|  | `GET` | `/incalls/{incall_id}` | Xem incall |  | `confd.incalls.{incall_id}.read` |
|  | `PUT` | `/incalls/{incall_id}` | Cập nhật incall | body: `Incall` | `confd.incalls.{incall_id}.update` |
|  | `DELETE` | `/incalls/{incall_id}` | Xoá incall |  | `confd.incalls.{incall_id}.delete` |
|  | `PUT` | `/incalls/{incall_id}/extensions/{extension_id}` | Gán extension cho incall |  | `confd.incalls.{incall_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/incalls/{incall_id}/extensions/{extension_id}` | Bỏ extension khỏi incall |  | `confd.incalls.{incall_id}.extensions.{extension_id}.delete` |
|  | `PUT` | `/incalls/{incall_id}/schedules/{schedule_id}` | Gán schedule cho incall |  | `confd.incalls.{incall_id}.schedules.{schedule_id}.update` |
|  | `DELETE` | `/incalls/{incall_id}/schedules/{schedule_id}` | Bỏ schedule khỏi incall |  | `confd.incalls.{incall_id}.schedules.{schedule_id}.delete` |

### wazo-confd · infos

Thông tin hệ thống (UUID, phiên bản).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/infos` | Xem thông tin server |  | `confd.infos.read` |

### wazo-confd · ingresses

Địa chỉ công khai của hệ thống (bắt buộc khai báo để dùng meeting).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/ingresses/http` | Danh sách HTTP ingress | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `view` | `confd.ingresses.http.read` |
|  | `POST` | `/ingresses/http` | Tạo HTTP Ingress | body: `HTTPIngressRequest` | `confd.ingresses.http.create` |
|  | `GET` | `/ingresses/http/{http_ingress_uuid}` | Xem HTTP ingress |  | `confd.ingresses.http.{http_ingress_uuid}.read` |
|  | `PUT` | `/ingresses/http/{http_ingress_uuid}` | Cập nhật HTTP ingress | body: `HTTPIngressRequest` | `confd.ingresses.http.{http_ingress_uuid}.update` |
|  | `DELETE` | `/ingresses/http/{http_ingress_uuid}` | Xoá HTTP ingress |  | `confd.ingresses.http.{http_ingress_uuid}.delete` |

### wazo-confd · ivr

IVR (tổng đài trả lời tự động: "bấm 1 để...").

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/ivr` | Danh sách IVR | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.ivr.read` |
|  | `POST` | `/ivr` | Tạo IVR | body: `Ivr` | `confd.ivr.create` |
|  | `GET` | `/ivr/{ivr_id}` | Xem IVR |  | `confd.ivr.{ivr_id}.read` |
|  | `PUT` | `/ivr/{ivr_id}` | Cập nhật IVR | body: `Ivr` | `confd.ivr.{ivr_id}.update` |
|  | `DELETE` | `/ivr/{ivr_id}` | Xoá IVR |  | `confd.ivr.{ivr_id}.delete` |

### wazo-confd · lines

Line (đường điện thoại của user): tạo, gán endpoint SIP, máy lẻ, thiết bị.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/devices/{device_id}/lines` | Danh sách line gắn với device |  | `confd.devices.{device_id}.lines.read` |
|  | `GET` | `/lines` | Danh sách line | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.lines.read` |
|  | `POST` | `/lines` | Tạo line | body: `LineCreate` | `confd.lines.create` |
|  | `GET` | `/lines/{line_id}` | Xem line |  | `confd.lines.{line_id}.read` |
|  | `PUT` | `/lines/{line_id}` | Cập nhật line | body: `Line` | `confd.lines.{line_id}.update` |
|  | `DELETE` | `/lines/{line_id}` | Xoá line |  | `confd.lines.{line_id}.delete` |
|  | `PUT` | `/lines/{line_id}/applications/{application_uuid}` | Gán application cho line |  | `confd.lines.{line_id}.applications.{application_uuid}.update` |
|  | `DELETE` | `/lines/{line_id}/applications/{application_uuid}` | Bỏ application khỏi line |  | `confd.lines.{line_id}.applications.{application_uuid}.delete` |
|  | `GET` | `/lines/{line_id}/devices` | Xem device gắn với line |  | `confd.lines.{line_id}.devices.read` |
|  | `PUT` | `/lines/{line_id}/devices/{device_id}` | Gán device cho line |  | `confd.lines.{line_id}.devices.{device_id}.update` |
|  | `DELETE` | `/lines/{line_id}/devices/{device_id}` | Bỏ device khỏi line |  | `confd.lines.{line_id}.devices.{device_id}.delete` |
|  | `PUT` | `/lines/{line_id}/endpoints/custom/{custom_id}` | Gán Custom endpoint cho line |  | `confd.lines.{line_id}.endpoints.custom.{custom_id}.update` |
|  | `DELETE` | `/lines/{line_id}/endpoints/custom/{custom_id}` | Bỏ Custom endpoint khỏi line |  | `confd.lines.{line_id}.endpoints.custom.{custom_id}.delete` |
|  | `PUT` | `/lines/{line_id}/endpoints/sccp/{sccp_id}` | Gán SCCP endpoint cho line |  | `confd.lines.{line_id}.endpoints.sccp.{sccp_id}.update` |
|  | `DELETE` | `/lines/{line_id}/endpoints/sccp/{sccp_id}` | Bỏ SCCP endpoint khỏi line |  | `confd.lines.{line_id}.endpoints.sccp.{sccp_id}.delete` |
|  | `PUT` | `/lines/{line_id}/endpoints/sip/{sip_uuid}` | Gán SIP endpoint cho line |  | `confd.lines.{line_id}.endpoints.sip.{sip_uuid}.update` |
|  | `DELETE` | `/lines/{line_id}/endpoints/sip/{sip_uuid}` | Bỏ SIP endpoint khỏi line |  | `confd.lines.{line_id}.endpoints.sip.{sip_uuid}.delete` |
|  | `PUT` | `/lines/{line_id}/extensions/{extension_id}` | Gán extension cho line |  | `confd.lines.{line_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/lines/{line_id}/extensions/{extension_id}` | Bỏ extension khỏi line |  | `confd.lines.{line_id}.extensions.{extension_id}.delete` |

### wazo-confd · localization

Ngôn ngữ, quốc gia mặc định của tenant.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/localization` | Xem cấu hình ngôn ngữ/quốc gia |  | `confd.localization.read` |
|  | `PUT` | `/localization` | Cập nhật cấu hình ngôn ngữ/quốc gia | body: `Localization` | `confd.localization.update` |

### wazo-confd · meeting_authorizations

Duyệt khách xin vào meeting.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `POST` | `/guests/{guest_uuid}/meetings/{meeting_uuid}/authorizations` | Khách xin phép vào meeting | body: `MeetingAuthorizationRequest` | |
| 🌐 | `GET` | `/guests/{guest_uuid}/meetings/{meeting_uuid}/authorizations/{authorization_uuid}` | Xem quyền vào meeting của khách |  | |
| 🌐 | `GET` | `/user/me/meetings/{meeting_uuid}/authorizations` | Danh sách yêu cầu tham gia của khách vào meeting |  | |
| 🌐 | `PUT` | `/user/me/meetings/{meeting_uuid}/authorizations/{authorization_uuid}/accept` | Chấp nhận yêu cầu tham gia của khách |  | |
| 🌐 | `PUT` | `/user/me/meetings/{meeting_uuid}/authorizations/{authorization_uuid}/reject` | Từ chối yêu cầu tham gia của khách |  | |
| 🌐 | `GET` | `/users/me/meetings/{meeting_uuid}/authorizations/{authorization_uuid}` | Xem quyền vào meeting của khách |  | |
| 🌐 | `DELETE` | `/users/me/meetings/{meeting_uuid}/authorizations/{authorization_uuid}` | Xoá quyền vào meeting của khách |  | |

### wazo-confd · meetings

Meeting (phòng họp có link/số tham gia, có thể tạo bởi chính user).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/guests/me/meetings/{meeting_uuid}` | Xem một meeting (dành cho khách) |  | |
|  | `GET` | `/meetings` | Danh sách meeting | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.meetings.read` |
|  | `POST` | `/meetings` | Tạo meeting | body: `MeetingRequest` | `confd.meetings.create` |
|  | `GET` | `/meetings/{meeting_uuid}` | Xem meeting |  | `confd.meetings.{meeting_uuid}.read` |
|  | `PUT` | `/meetings/{meeting_uuid}` | Cập nhật meeting | body: `MeetingRequest` | `confd.meetings.{meeting_uuid}.update` |
|  | `DELETE` | `/meetings/{meeting_uuid}` | Xoá meeting |  | `confd.meetings.{meeting_uuid}.delete` |
| 👤 | `GET` | `/users/me/meetings` | Danh sách meeting của user | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.users.me.meetings.read` |
| 👤 | `POST` | `/users/me/meetings` | Tạo meeting của user | body: `MeetingUserRequest` | `confd.users.me.meetings.create` |
| 👤 | `GET` | `/users/me/meetings/{meeting_uuid}` | Xem một meeting của user hiện tại |  | `confd.users.me.meetings.{meeting_uuid}.read` |
| 👤 | `PUT` | `/users/me/meetings/{meeting_uuid}` | Cập nhật một meeting của user hiện tại | body: `MeetingRequest` | `confd.users.me.meetings.{meeting_uuid}.update` |
| 👤 | `DELETE` | `/users/me/meetings/{meeting_uuid}` | Xoá một meeting của user hiện tại |  | `confd.users.me.meetings.{meeting_uuid}.delete` |

### wazo-confd · moh

Nhạc chờ (music on hold).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/moh` | Danh sách MOH class | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.moh.read` |
|  | `POST` | `/moh` | Tạo nhóm nhạc chờ (MOH class) | body: `Moh` | `confd.moh.create` |
|  | `GET` | `/moh/{moh_uuid}` | Xem MOH class |  | `confd.moh.{moh_uuid}.read` |
|  | `PUT` | `/moh/{moh_uuid}` | Cập nhật MOH class | body: `Moh` | `confd.moh.{moh_uuid}.update` |
|  | `DELETE` | `/moh/{moh_uuid}` | Xoá MOH class |  | `confd.moh.{moh_uuid}.delete` |
|  | `GET` | `/moh/{moh_uuid}/files/{moh_filename}` | Tải file âm thanh |  | `confd.moh.{moh_uuid}.files.{moh_filename}.read` |
|  | `PUT` | `/moh/{moh_uuid}/files/{moh_filename}` | Thêm hoặc cập nhật file âm thanh | body: `JSON` | `confd.moh.{moh_uuid}.files.{moh_filename}.update` |
|  | `DELETE` | `/moh/{moh_uuid}/files/{moh_filename}` | Xoá file âm thanh |  | `confd.moh.{moh_uuid}.files.{moh_filename}.delete` |

### wazo-confd · outcalls

Gọi ra ngoài: quy tắc quay số và trung kế được dùng.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/outcalls` | Danh sách outcall | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.outcalls.read` |
|  | `POST` | `/outcalls` | Tạo outcall (quy tắc gọi ra) | body: `Outcall` | `confd.outcalls.create` |
|  | `GET` | `/outcalls/{outcall_id}` | Xem outcall |  | `confd.outcalls.{outcall_id}.read` |
|  | `PUT` | `/outcalls/{outcall_id}` | Cập nhật outcall | body: `Outcall` | `confd.outcalls.{outcall_id}.update` |
|  | `DELETE` | `/outcalls/{outcall_id}` | Xoá outcall |  | `confd.outcalls.{outcall_id}.delete` |
|  | `PUT` | `/outcalls/{outcall_id}/callpermissions/{callpermission_id}` | Gán call permission cho outcall |  | `confd.outcalls.{outcall_id}.callpermissions.{call_permission_id}.update` |
|  | `DELETE` | `/outcalls/{outcall_id}/callpermissions/{callpermission_id}` | Bỏ call permission khỏi outcall |  | `confd.outcalls.{outcall_id}.callpermissions.{call_permission_id}.delete` |
|  | `PUT` | `/outcalls/{outcall_id}/extensions/{extension_id}` | Gán extension cho outcall | body: `OutcallExtension` | `confd.outcalls.{outcall_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/outcalls/{outcall_id}/extensions/{extension_id}` | Bỏ extension khỏi outcall |  | `confd.outcalls.{outcall_id}.extensions.{extension_id}.delete` |
|  | `PUT` | `/outcalls/{outcall_id}/schedules/{schedule_id}` | Gán schedule cho outcall |  | `confd.outcalls.{outcall_id}.schedules.{schedule_id}.update` |
|  | `DELETE` | `/outcalls/{outcall_id}/schedules/{schedule_id}` | Bỏ schedule khỏi outcall |  | `confd.outcalls.{outcall_id}.schedules.{schedule_id}.delete` |
|  | `PUT` | `/outcalls/{outcall_id}/trunks` | Gán trunk cho outcall | body: `TrunksId` | `confd.outcalls.{outcall_id}.trunks.update` |

### wazo-confd · pagings

Phát thanh (paging) tới nhiều máy cùng lúc.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/pagings` | Danh sách paging | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.pagings.read` |
|  | `POST` | `/pagings` | Tạo paging | body: `Paging` | `confd.pagings.create` |
|  | `GET` | `/pagings/{paging_id}` | Xem paging |  | `confd.pagings.{paging_id}.read` |
|  | `PUT` | `/pagings/{paging_id}` | Cập nhật paging | body: `Paging` | `confd.pagings.{paging_id}.update` |
|  | `DELETE` | `/pagings/{paging_id}` | Xoá paging |  | `confd.pagings.{paging_id}.delete` |
|  | `PUT` | `/pagings/{paging_id}/callers/users` | Cập nhật paging và người gọi | body: `UsersUuid` | `confd.pagings.{paging_id}.callers.users.update` |
|  | `PUT` | `/pagings/{paging_id}/members/users` | Cập nhật paging và thành viên | body: `UsersUuid` | `confd.pagings.{paging_id}.members.users.update` |

### wazo-confd · parking_lots

Bãi đỗ cuộc gọi (gác cuộc gọi để người khác nhấc).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/parkinglots` | Danh sách parking lot | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.parkinglots.read` |
|  | `POST` | `/parkinglots` | Tạo parking lot | body: `ParkingLot` | `confd.parkinglots.create` |
|  | `GET` | `/parkinglots/{parking_lot_id}` | Xem parking lot |  | `confd.parkinglots.{parking_lot_id}.read` |
|  | `PUT` | `/parkinglots/{parking_lot_id}` | Cập nhật parking lot | body: `ParkingLot` | `confd.parkinglots.{parking_lot_id}.update` |
|  | `DELETE` | `/parkinglots/{parking_lot_id}` | Xoá parking lot |  | `confd.parkinglots.{parking_lot_id}.delete` |
|  | `PUT` | `/parkinglots/{parking_lot_id}/extensions/{extension_id}` | Gán extension cho parking lot |  | `confd.parkinglots.{parking_lot_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/parkinglots/{parking_lot_id}/extensions/{extension_id}` | Bỏ extension khỏi parking lot |  | `confd.parkinglots.{parking_lot_id}.extensions.{extension_id}.delete` |

### wazo-confd · phone-numbers

Danh sách số điện thoại (DID) của tenant.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/phone-numbers` | Danh sách số điện thoại | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `shared`, `main` | `confd.phone-numbers.read` |
|  | `POST` | `/phone-numbers` | Thêm số điện thoại mới | body: `PhoneNumber` | `confd.phone-numbers.create` |
|  | `GET` | `/phone-numbers/main` | Xem số điện thoại chính |  | `confd.phone-numbers.main.read` |
|  | `PUT` | `/phone-numbers/main` | Đặt số điện thoại "chính" cho tenant | body: `JSON` | `confd.phone-numbers.main.update` |
|  | `POST` | `/phone-numbers/ranges` | Thêm một dải số điện thoại | body: `PhoneNumberRange` | `confd.phone-numbers.create` |
|  | `GET` | `/phone-numbers/{phone_number_uuid}` | Xem số điện thoại |  | `confd.phone-numbers.{phone_number_uuid}.read` |
|  | `PUT` | `/phone-numbers/{phone_number_uuid}` | Cập nhật số điện thoại | body: `PhoneNumberItems` | `confd.phone-numbers.{phone_number_uuid}.update` |
|  | `DELETE` | `/phone-numbers/{phone_number_uuid}` | Xoá số điện thoại |  | `confd.phone-numbers.{phone_number_uuid}.delete` |

### wazo-confd · provisioning

Cấu hình chung của provisioning điện thoại IP.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/provisioning/networking` | Xem cấu hình mạng provisioning |  | `confd.provisioning.networking.read` |
|  | `PUT` | `/provisioning/networking` | Cập nhật cấu hình mạng provisioning | body: `ProvisioningNetworking` | `confd.provisioning.networking.update` |

### wazo-confd · queues

Hàng đợi cuộc gọi (call center).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/queues` | Danh sách queue | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.queues.read` |
|  | `POST` | `/queues` | Tạo queue | body: `Queue` | `confd.queues.create` |
|  | `GET` | `/queues/skillrules` | Danh sách skill rule | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.queues.skillrules.read` |
|  | `POST` | `/queues/skillrules` | Tạo skill rule | body: `SkillRule` | `confd.queues.skillrules.create` |
|  | `GET` | `/queues/skillrules/{skillrule_id}` | Xem skill rule |  | `confd.queues.skillrules.{skillrule_id}.read` |
|  | `PUT` | `/queues/skillrules/{skillrule_id}` | Cập nhật skill rule | body: `SkillRule` | `confd.queues.skillrules.{skillrule_id}.update` |
|  | `DELETE` | `/queues/skillrules/{skillrule_id}` | Xoá skill rule |  | `confd.queues.skillrules.{skillrule_id}.delete` |
|  | `GET` | `/queues/{queue_id}` | Xem queue |  | `confd.queues.{queue_id}.read` |
|  | `PUT` | `/queues/{queue_id}` | Cập nhật queue | body: `Queue` | `confd.queues.{queue_id}.update` |
|  | `DELETE` | `/queues/{queue_id}` | Xoá queue |  | `confd.queues.{queue_id}.delete` |
|  | `PUT` | `/queues/{queue_id}/extensions/{extension_id}` | Gán extension cho queue |  | `confd.queues.{queue_id}.extensions.{extension_id}.update` |
|  | `DELETE` | `/queues/{queue_id}/extensions/{extension_id}` | Bỏ extension khỏi queue |  | `confd.queues.{queue_id}.extensions.{extension_id}.delete` |
|  | `GET` | `/queues/{queue_id}/fallbacks` | Danh sách fallback của queue |  | `confd.queues.{queue_id}.fallbacks.read` |
|  | `PUT` | `/queues/{queue_id}/fallbacks` | Cập nhật fallback của queue | body: `QueueFallbacks` | `confd.queues.{queue_id}.fallbacks.update` |
|  | `PUT` | `/queues/{queue_id}/members/users/{user_id}` | Cập nhật liên kết User–Queue | body: `QueueMemberUser` | `confd.queues.{queue_id}.members.users.{user_id}.update` |
|  | `DELETE` | `/queues/{queue_id}/members/users/{user_id}` | Bỏ user khỏi queue |  | `confd.queues.{queue_id}.members.users.{user_id}.delete` |
|  | `PUT` | `/queues/{queue_id}/schedules/{schedule_id}` | Gán schedule cho queue |  | `confd.queues.{queue_id}.schedules.{schedule_id}.update` |
|  | `DELETE` | `/queues/{queue_id}/schedules/{schedule_id}` | Bỏ schedule khỏi queue |  | `confd.queues.{queue_id}.schedules.{schedule_id}.delete` |

### wazo-confd · recordings-announcements

Thông báo phát trước khi ghi âm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/recordings/announcements` | Xem cấu hình thông báo ghi âm |  | `confd.recordings.announcements.read` |
|  | `PUT` | `/recordings/announcements` | Cập nhật cấu hình thông báo ghi âm | body: `RecordingsAnnouncements` | `confd.recordings.announcements.update` |

### wazo-confd · registers

Đăng ký SIP/IAX ra nhà mạng (register).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/registers/iax` | Danh sách register IAX | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.registers.iax.read` |
|  | `POST` | `/registers/iax` | Tạo register_iax | body: `RegisterIAX` | `confd.registers.iax.create` |
|  | `GET` | `/registers/iax/{register_iax_id}` | Xem register IAX |  | `confd.registers.iax.{register_iax_id}.read` |
|  | `PUT` | `/registers/iax/{register_iax_id}` | Cập nhật register IAX | body: `RegisterIAX` | `confd.registers.iax.{register_iax_id}.update` |
|  | `DELETE` | `/registers/iax/{register_iax_id}` | Xoá register IAX |  | `confd.registers.iax.{register_iax_id}.delete` |

### wazo-confd · registrars

Registrar/proxy cho điện thoại IP.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/registrars` | Xem danh sách registrar | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.registrars.read` |
|  | `POST` | `/registrars` | Tạo registrar | body: `Registrar` | `confd.registrars.create` |
|  | `GET` | `/registrars/{registrar_id}` | Xem registrar |  | `confd.registrars.{registrar_id}.read` |
|  | `PUT` | `/registrars/{registrar_id}` | Cập nhật registrar | body: `Registrar` | `confd.registrars.{registrar_id}.update` |
|  | `DELETE` | `/registrars/{registrar_id}` | Xoá registrar |  | `confd.registrars.{registrar_id}.delete` |

### wazo-confd · schedules

Lịch làm việc (giờ hành chính) áp cho user, nhóm, số gọi vào...

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/schedules` | Danh sách schedule | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.schedules.read` |
|  | `POST` | `/schedules` | Tạo schedule | body: `Schedule` | `confd.schedules.create` |
|  | `GET` | `/schedules/{schedule_id}` | Xem schedule |  | `confd.schedules.{schedule_id}.read` |
|  | `PUT` | `/schedules/{schedule_id}` | Cập nhật schedule | body: `Schedule` | `confd.schedules.{schedule_id}.update` |
|  | `DELETE` | `/schedules/{schedule_id}` | Xoá schedule |  | `confd.schedules.{schedule_id}.delete` |

### wazo-confd · sip

Cấu hình SIP: transport (udp/tcp/wss), template, endpoint SIP.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `PUT` | `/asterisk/pjsip/global` | Cập nhật tuỳ chọn một mục PJSIP | body: `PJSIPGlobal` | `confd.asterisk.pjsip.global.update` |
|  | `PUT` | `/asterisk/pjsip/system` | Cập nhật tuỳ chọn một mục PJSIP | body: `PJSIPSystem` | `confd.asterisk.pjsip.system.update` |
|  | `GET` | `/endpoints/sip/templates/{template_uuid}` | Xem SIP endpoint template |  | `confd.endpoints.sip.templates.{template_uuid}.read` |
|  | `GET` | `/endpoints/sip/{sip_uuid}` | Xem SIP endpoint | query: `view` | `confd.endpoints.sip.{sip_uuid}.read` |
|  | `GET` | `/sip/transports` | Danh sách SIP transport đã cấu hình | query: `order`, `direction`, `limit`, `offset`, `search` | `confd.sip.transports.read` |
|  | `POST` | `/sip/transports` | Tạo SIP transport | body: `SIPTransport` | `confd.sip.transports.create` |
|  | `GET` | `/sip/transports/{transport_uuid}` | Xem SIP transport |  | `confd.sip.transports.{transport_uuid}.read` |
|  | `PUT` | `/sip/transports/{transport_uuid}` | Cập nhật SIP transport | body: `SIPTransport` | `confd.sip.transports.{transport_uuid}.update` |
|  | `DELETE` | `/sip/transports/{transport_uuid}` | Xoá SIP transport | query: `fallback` | `confd.sip.transports.{transport_uuid}.delete` |

### wazo-confd · skills

Kỹ năng agent và quy tắc phân cuộc gọi theo kỹ năng.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `PUT` | `/agents/skills/{skill_id}` | Cập nhật skill | body: `Skill` | `confd.agents.skills.{skill_id}.update` |
|  | `DELETE` | `/agents/skills/{skill_id}` | Xoá skill |  | `confd.agents.skills.{skill_id}.delete` |
|  | `PUT` | `/agents/{agent_id}/skills/{skill_id}` | Gán skill cho agent | body: `AgentSkill` | `confd.agents.{agent_id}.skills.{skill_id}.update` |
|  | `DELETE` | `/agents/{agent_id}/skills/{skill_id}` | Bỏ skill khỏi agent |  | `confd.agents.{agent_id}.skills.{skill_id}.delete` |

### wazo-confd · sounds

File âm thanh tuỳ chỉnh (lời chào, thông báo).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/sounds` | Danh sách danh mục âm thanh | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.sounds.read` |
|  | `POST` | `/sounds` | Tạo danh mục âm thanh | body: `Sound` | `confd.sounds.create` |
|  | `GET` | `/sounds/languages` | Danh sách ngôn ngữ của âm thanh |  | `confd.sounds.languages.read` |
|  | `GET` | `/sounds/{sound_category}` | Xem danh mục âm thanh |  | `confd.sounds.{sound_category}.read` |
|  | `DELETE` | `/sounds/{sound_category}` | Xoá danh mục âm thanh |  | `confd.sounds.{sound_category}.delete` |
|  | `GET` | `/sounds/{sound_category}/files/{sound_filename}` | Tải file âm thanh | query: `language`, `format` | `confd.sounds.{sound_category}.files.{sound_filename}.read` |
|  | `PUT` | `/sounds/{sound_category}/files/{sound_filename}` | Thêm hoặc cập nhật file âm thanh | query: `language`, `format`<br>body: `JSON` | `confd.sounds.{sound_category}.files.{sound_filename}.update` |
|  | `DELETE` | `/sounds/{sound_category}/files/{sound_filename}` | Xoá file âm thanh | query: `language`, `format` | `confd.sounds.{sound_category}.files.{sound_filename}.delete` |

### wazo-confd · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-confd |  | `confd.status.read` |

### wazo-confd · switchboards

Bảng điều khiển trực tổng đài (lễ tân).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/switchboards` | Danh sách switchboard | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.switchboards.read` |
|  | `POST` | `/switchboards` | Tạo switchboard | body: `Switchboard` | `confd.switchboards.create` |
|  | `GET` | `/switchboards/{switchboard_uuid}` | Xem switchboard |  | `confd.switchboards.{switchboard_uuid}.read` |
|  | `PUT` | `/switchboards/{switchboard_uuid}` | Cập nhật switchboard | body: `Switchboard` | `confd.switchboards.{switchboard_uuid}.update` |
|  | `DELETE` | `/switchboards/{switchboard_uuid}` | Xoá switchboard |  | `confd.switchboards.{switchboard_uuid}.delete` |
|  | `GET` | `/switchboards/{switchboard_uuid}/fallbacks` | Danh sách fallback của switchboard |  | `confd.switchboards.{switchboard_uuid}.fallbacks.read` |
|  | `PUT` | `/switchboards/{switchboard_uuid}/fallbacks` | Cập nhật fallback của switchboard | body: `SwitchboardFallbacks` | `confd.switchboards.{switchboard_uuid}.fallbacks.update` |
|  | `PUT` | `/switchboards/{switchboard_uuid}/members/users` | Cập nhật switchboard và thành viên | body: `UsersUuid` | `confd.switchboards.{switchboard_uuid}.members.users.update` |

### wazo-confd · tenants

Thông tin tenant phía confd.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/tenants` | Danh sách tenant | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.tenants.read` |
|  | `GET` | `/tenants/{tenant_uuid}` | Xem tenant |  | `confd.tenants.{tenant_uuid}.read` |

### wazo-confd · timezones

Danh sách múi giờ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/timezones` | Danh sách múi giờ |  | `confd.timezones.read` |

### wazo-confd · trunks

Trung kế SIP/IAX nối ra tổng đài khác hoặc nhà mạng.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/trunks` | Danh sách trunk | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.trunks.read` |
|  | `POST` | `/trunks` | Tạo trunk | body: `Trunk` | `confd.trunks.create` |
|  | `GET` | `/trunks/{trunk_id}` | Xem trunk |  | `confd.trunks.{trunk_id}.read` |
|  | `PUT` | `/trunks/{trunk_id}` | Cập nhật trunk | body: `Trunk` | `confd.trunks.{trunk_id}.update` |
|  | `DELETE` | `/trunks/{trunk_id}` | Xoá trunk |  | `confd.trunks.{trunk_id}.delete` |
|  | `PUT` | `/trunks/{trunk_id}/endpoints/custom/{custom_id}` | Gán Custom endpoint cho trunk |  | `confd.trunks.{trunk_id}.endpoints.custom.{custom_id}.update` |
|  | `DELETE` | `/trunks/{trunk_id}/endpoints/custom/{custom_id}` | Bỏ Custom endpoint khỏi trunk |  | `confd.trunks.{trunk_id}.endpoints.custom.{custom_id}.delete` |
|  | `PUT` | `/trunks/{trunk_id}/endpoints/iax/{iax_id}` | Gán IAX endpoint cho trunk |  | `confd.trunks.{trunk_id}.endpoints.iax.{iax_id}.update` |
|  | `DELETE` | `/trunks/{trunk_id}/endpoints/iax/{iax_id}` | Bỏ IAX endpoint khỏi trunk |  | `confd.trunks.{trunk_id}.endpoints.iax.{iax_id}.delete` |
|  | `PUT` | `/trunks/{trunk_id}/endpoints/sip/{sip_uuid}` | Gán SIP endpoint cho trunk |  | `confd.trunks.{trunk_id}.endpoints.sip.{sip_uuid}.update` |
|  | `DELETE` | `/trunks/{trunk_id}/endpoints/sip/{sip_uuid}` | Bỏ SIP endpoint khỏi trunk |  | `confd.trunks.{trunk_id}.endpoints.sip.{sip_uuid}.delete` |
|  | `PUT` | `/trunks/{trunk_id}/registers/iax/{iax_id}` | Gán IAX register cho trunk |  | `confd.trunks.{trunk_id}.registers.iax.{iax_id}.update` |
|  | `DELETE` | `/trunks/{trunk_id}/registers/iax/{iax_id}` | Bỏ IAX register khỏi trunk |  | `confd.trunks.{trunk_id}.registers.iax.{iax_id}.delete` |

### wazo-confd · users

User (người dùng điện thoại): tạo/sửa/xoá, import/export CSV, gán line, nhóm, DND, chuyển tiếp, phím chức năng...

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/users` | Danh sách user | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search`, `view`, `uuid` | `confd.users.read` |
|  | `POST` | `/users` | Tạo user | body: `UserPost` | `confd.users.create` |
|  | `GET` | `/users/export` | Export hàng loạt user và tài nguyên liên quan (CSV) |  | `confd.users.export.read` |
|  | `POST` | `/users/import` | Import hàng loạt user và tài nguyên liên quan (CSV) | body: `JSON` | `confd.users.import.create` |
|  | `PUT` | `/users/import` | **Đã tắt!** Import hàng loạt user và tài nguyên liên quan | body: `JSON` | `confd.users.import.update` |
| 👤 | `GET` | `/users/me/callerids/outgoing` | Danh sách caller ID gọi ra mà user đang đăng nhập được dùng |  | `confd.users.me.callerids.outgoing.read` |
| 👤 | `GET` | `/users/me/callerids/outgoing/default` | Xem caller ID gọi ra mặc định của user đang đăng nhập |  | `confd.users.me.callerids.outgoing.default.read` |
|  | `PUT` | `/users/me/callerids/outgoing/default` | Cập nhật caller ID gọi ra mặc định của user đang đăng nhập | body: `UserCallerIDDefault` | `confd.users.me.callerids.outgoing.default.update` |
|  | `GET` | `/users/subscriptions` | Xem subscription của user |  | `confd.users.subscriptions.read` |
| 👤 | `GET` | `/users/{user_id}` | Xem user |  | `confd.users.{user_id}.read` |
| 👤 | `PUT` | `/users/{user_id}` | Cập nhật user | body: `User` | `confd.users.{user_id}.update` |
|  | `DELETE` | `/users/{user_id}` | Xoá user | query: `recursive` | `confd.users.{user_id}.delete` |
| 👤 | `HEAD` | `/users/{user_id}` | Kiểm tra user có tồn tại không |  | `confd.users.{user_id}.read` |
|  | `DELETE` | `/users/{user_id}/agents` | Bỏ agent khỏi user |  | `confd.users.{user_id}.agents.delete` |
|  | `PUT` | `/users/{user_id}/agents/{agent_id}` | Gán agent cho user |  | `confd.users.{user_id}.agents.{agent_id}.update` |
| 👤 | `GET` | `/users/{user_id}/callerids/outgoing` | Danh sách caller ID gọi ra của user |  | `confd.users.{user_id}.callerids.outgoing.read` |
| 👤 | `GET` | `/users/{user_id}/callerids/outgoing/default` | Xem caller ID gọi ra mặc định của user |  | `confd.users.{user_id}.callerids.outgoing.default.read` |
|  | `PUT` | `/users/{user_id}/callerids/outgoing/default` | Cập nhật caller ID gọi ra mặc định của user | body: `UserCallerIDDefault` | `confd.users.{user_id}.callerids.outgoing.default.update` |
|  | `PUT` | `/users/{user_id}/callpermissions/{callpermission_id}` | Gán call permission cho user |  | `confd.users.{user_id}.callpermissions.{call_permission_id}.update` |
|  | `DELETE` | `/users/{user_id}/callpermissions/{callpermission_id}` | Bỏ call permission khỏi user |  | `confd.users.{user_id}.callpermissions.{call_permission_id}.delete` |
| 👤 | `GET` | `/users/{user_id}/fallbacks` | Danh sách fallback của user |  | `confd.users.{user_id}.fallbacks.read` |
|  | `PUT` | `/users/{user_id}/fallbacks` | Cập nhật fallback của user | body: `UserFallbacks` | `confd.users.{user_id}.fallbacks.update` |
|  | `PUT` | `/users/{user_id}/lines` | Gán nhiều line cho user | body: `LinesID` | `confd.users.{user_id}.lines.update` |
|  | `PUT` | `/users/{user_id}/lines/{line_id}` | Gán line cho user |  | `confd.users.{user_id}.lines.{line_id}.update` |
|  | `DELETE` | `/users/{user_id}/lines/{line_id}` | Bỏ line khỏi user |  | `confd.users.{user_id}.lines.{line_id}.delete` |
|  | `PUT` | `/users/{user_id}/schedules/{schedule_id}` | Gán schedule cho user |  | `confd.users.{user_id}.schedules.{schedule_id}.update` |
|  | `DELETE` | `/users/{user_id}/schedules/{schedule_id}` | Bỏ schedule khỏi user |  | `confd.users.{user_id}.schedules.{schedule_id}.delete` |
| 👤 | `GET` | `/users/{user_id}/services` | Xem trạng thái mọi dịch vụ của user |  | `confd.users.{user_id}.services.read` |
|  | `PUT` | `/users/{user_id}/services` | Cập nhật mọi dịch vụ của user | body: `UserServices` | `confd.users.{user_id}.services.update` |
| 👤 | `GET` | `/users/{user_id}/services/{service_name}` | Xem trạng thái một dịch vụ của user |  | `confd.users.{user_id}.services.{service}.read` |
| 👤 | `PUT` | `/users/{user_id}/services/{service_name}` | Bật/tắt dịch vụ (DND, lọc cuộc gọi...) của user | body: `UserService` | `confd.users.{user_id}.services.{service}.update` |
| 👤 | `GET` | `/users/{user_id}/voicemails` | Xem các voicemail của user |  | `confd.users.{user_id}.voicemails.read` |
|  | `POST` | `/users/{user_id}/voicemails` | Tạo voicemail cho user | body: `Voicemail` | `confd.users.{user_id}.voicemails.create` |
|  | `DELETE` | `/users/{user_id}/voicemails` | Bỏ voicemail khỏi user |  | `confd.users.{user_id}.voicemails.delete` |
|  | `PUT` | `/users/{user_id}/voicemails/{voicemail_id}` | Gán voicemail cho user |  | `confd.users.{user_id}.voicemails.{voicemail_id}.update` |

### wazo-confd · voicemails

Hộp thư thoại: tạo, gán cho user.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/voicemails` | Danh sách voicemail | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `confd.voicemails.read` |
|  | `POST` | `/voicemails` | Tạo voicemail | body: `Voicemail` | `confd.voicemails.create` |
| 🌐 | `GET` | `/voicemails/transcription` | Xem cấu hình chuyển voicemail thành văn bản của tenant |  | |
| 🌐 | `PUT` | `/voicemails/transcription` | Cập nhật cấu hình chuyển voicemail thành văn bản của tenant | body: `VoicemailTranscriptionConfig` | |
|  | `GET` | `/voicemails/{voicemail_id}` | Xem voicemail |  | `confd.voicemails.{voicemail_id}.read` |
|  | `PUT` | `/voicemails/{voicemail_id}` | Cập nhật voicemail | body: `Voicemail` | `confd.voicemails.{voicemail_id}.update` |
|  | `DELETE` | `/voicemails/{voicemail_id}` | Xoá voicemail |  | `confd.voicemails.{voicemail_id}.delete` |

### wazo-confd · wizard

Trình cài đặt ban đầu (đã chạy khi build image).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/wizard` | Xem trạng thái wizard |  | |
| 🌐 | `POST` | `/wizard` | Chạy wizard cài đặt ban đầu | body: `Wizard` | |
| 🌐 | `GET` | `/wizard/discover` | Xem thông tin phát hiện của wizard |  | |


## wazo-calld

**Điều khiển cuộc gọi.** Thao tác trên cuộc gọi đang diễn ra: gọi, nghe, cúp, giữ máy, tắt mic, chuyển, DTMF, phòng họp, voicemail, đỗ cuộc gọi, ứng dụng Stasis.

Base URL: `https://<HOST>/api/calld/1.0` · Spec: `api-specs/wazo-calld.yml` · 128 endpoint, 41 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [adhoc_conferences](#wazo-calld-adhoc-conferences) | 4 | Gọi nhóm tức thời: gộp các cuộc gọi đang có thành 1 cuộc gọi nhiều người. |
| [applications](#wazo-calld-applications) | 29 | Điều khiển cuộc gọi trong ứng dụng Stasis tuỳ biến (nút, phát âm thanh, bridge...). |
| [calls](#wazo-calld-calls) | 30 | Cuộc gọi đang diễn ra: liệt kê, tạo (click-to-call), cúp, nghe, giữ máy, tắt mic, DTMF, ghi âm. |
| [conferences](#wazo-calld-conferences) | 7 | Người tham gia phòng họp: liệt kê, tắt mic, đuổi ra, ghi âm. |
| [config](#wazo-calld-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [faxes](#wazo-calld-faxes) | 2 | Gửi fax. |
| [lines](#wazo-calld-lines) | 1 | Trạng thái line. |
| [meetings](#wazo-calld-meetings) | 5 | Người tham gia meeting: liệt kê, đuổi ra; trạng thái meeting. |
| [parking_lots](#wazo-calld-parking-lots) | 2 | Đỗ / lấy lại cuộc gọi ở bãi đỗ. |
| [relocates](#wazo-calld-relocates) | 5 | Chuyển cuộc gọi đang nói sang thiết bị khác của chính mình (web ↔ điện thoại). |
| [status](#wazo-calld-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [switchboards](#wazo-calld-switchboards) | 5 | Thao tác trực tổng đài: hàng đợi lễ tân, giữ, trả lời. |
| [transfers](#wazo-calld-transfers) | 8 | Chuyển cuộc gọi: chuyển thẳng (blind) hoặc hỏi ý trước (attended), hoàn tất, huỷ. |
| [trunks](#wazo-calld-trunks) | 1 | Trạng thái trung kế. |
| [users](#wazo-calld-users) | 13 | Thao tác của user trên cuộc gọi của chính mình (/users/me/...): cuộc gọi, chuyển, voicemail, meeting. |
| [voicemails](#wazo-calld-voicemails) | 13 | Hộp thư thoại: tin nhắn, lời chào, đánh dấu đã nghe, tải file âm thanh. |

### wazo-calld · adhoc_conferences

Gọi nhóm tức thời: gộp các cuộc gọi đang có thành 1 cuộc gọi nhiều người.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `POST` | `/users/me/conferences/adhoc` | Tạo adhoc conference (gọi nhóm tức thời) | body: `AdhocConferenceCreation` | `calld.users.me.conferences.adhoc.create` |
| 👤 | `DELETE` | `/users/me/conferences/adhoc/{conference_id}` | Xoá adhoc conference |  | `calld.users.me.conferences.adhoc.delete` |
| 👤 | `PUT` | `/users/me/conferences/adhoc/{conference_id}/participants/{call_id}` | Thêm người tham gia vào adhoc conference |  | `calld.users.me.conferences.adhoc.participants.update` |
| 👤 | `DELETE` | `/users/me/conferences/adhoc/{conference_id}/participants/{call_id}` | Bỏ người tham gia khỏi adhoc conference |  | `calld.users.me.conferences.adhoc.participants.delete` |

### wazo-calld · applications

Điều khiển cuộc gọi trong ứng dụng Stasis tuỳ biến (nút, phát âm thanh, bridge...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/applications/{application_uuid}` | Xem một application |  | `calld.applications.{application_uuid}.read` |
|  | `GET` | `/applications/{application_uuid}/calls` | Danh sách cuộc gọi trong application |  | `calld.applications.{application_uuid}.calls.read` |
|  | `POST` | `/applications/{application_uuid}/calls` | Tạo cuộc gọi mới vào application | body: `ApplicationCallRequestToExten` | `calld.applications.{application_uuid}.calls.create` |
|  | `DELETE` | `/applications/{application_uuid}/calls/{call_id}` | Cúp cuộc gọi từ application |  | `calld.applications.{application_uuid}.calls.{call_id}.delete` |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/answer` | Trả lời cuộc gọi |  | `calld.applications.{application_uuid}.calls.{call_id}.answer.update` |
| 🌐 | `PUT` | `/applications/{application_uuid}/calls/{call_id}/dtmf` | Giả lập bấm phím DTMF | query: `digits` | |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/hold/start` | Giữ máy (hold) |  | `calld.applications.{application_uuid}.calls.{call_id}.hold.start.update` |
| 🌐 | `PUT` | `/applications/{application_uuid}/calls/{call_id}/hold/stop` | Tiếp tục cuộc gọi đang giữ |  | |
| 🌐 | `PUT` | `/applications/{application_uuid}/calls/{call_id}/moh/stop` | Dừng phát nhạc chờ |  | |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/moh/{moh_uuid}/start` | Bắt đầu phát nhạc chờ |  | `calld.applications.{application_uuid}.calls.{call_id}.moh.{moh_uuid}.start.update` |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/mute/start` | Tắt mic cuộc gọi |  | `calld.applications.{application_uuid}.calls.{call_id}.mute.start.update` |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/mute/stop` | Bật lại mic cuộc gọi |  | `calld.applications.{application_uuid}.calls.{call_id}.mute.stop.update` |
|  | `POST` | `/applications/{application_uuid}/calls/{call_id}/playbacks` | Phát file âm thanh vào cuộc gọi | body: `ApplicationPlayback` | `calld.applications.{application_uuid}.calls.{call_id}.playbacks.create` |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/progress/start` | Phát tiếng chuông chờ (ringing) |  | `calld.applications.{application_uuid}.calls.{call_id}.progress.start.update` |
|  | `PUT` | `/applications/{application_uuid}/calls/{call_id}/progress/stop` | Dừng tiếng chuông chờ |  | `calld.applications.{application_uuid}.calls.{call_id}.progress.stop.update` |
|  | `POST` | `/applications/{application_uuid}/calls/{call_id}/snoops` | Bắt đầu nghe lén (snoop) cuộc gọi | body: `ApplicationSnoop` | `calld.applications.{application_uuid}.calls.{call_id}.snoops.create` |
|  | `GET` | `/applications/{application_uuid}/nodes` | Danh sách node trong application |  | `calld.applications.{application_uuid}.nodes.read` |
|  | `POST` | `/applications/{application_uuid}/nodes` | Tạo node mới và thêm cuộc gọi | body: `ApplicationNodeRequest` | `calld.applications.{application_uuid}.nodes.create` |
|  | `GET` | `/applications/{application_uuid}/nodes/{node_uuid}` | Xem một node |  | `calld.applications.{application_uuid}.nodes.{node_uuid}.read` |
|  | `DELETE` | `/applications/{application_uuid}/nodes/{node_uuid}` | Xoá node và cúp mọi cuộc gọi trong đó |  | `calld.applications.{application_uuid}.nodes.{node_uuid}.delete` |
|  | `POST` | `/applications/{application_uuid}/nodes/{node_uuid}/calls` | Tạo cuộc gọi mới vào node | body: `ApplicationCallRequestToExten` | `calld.applications.{application_uuid}.nodes.{node_uuid}.calls.create` |
|  | `POST` | `/applications/{application_uuid}/nodes/{node_uuid}/calls/user` | Gọi tới user và đưa vào node | body: `ApplicationCallRequestToUser` | `calld.applications.{application_uuid}.nodes.{node_uuid}.calls.user.create` |
|  | `PUT` | `/applications/{application_uuid}/nodes/{node_uuid}/calls/{call_id}` | Đưa cuộc gọi vào node |  | `calld.applications.{application_uuid}.nodes.{node_uuid}.calls.{call_id}.update` |
|  | `DELETE` | `/applications/{application_uuid}/nodes/{node_uuid}/calls/{call_id}` | Bỏ cuộc gọi khỏi node |  | `calld.applications.{application_uuid}.nodes.{node_uuid}.calls.{call_id}.delete` |
|  | `DELETE` | `/applications/{application_uuid}/playbacks/{playback_uuid}` | Dừng và bỏ phát âm thanh |  | `calld.applications.{application_uuid}.playbacks.{playback_uuid}.delete` |
|  | `GET` | `/applications/{application_uuid}/snoops` | Danh sách phiên nghe lén (snoop) đang chạy |  | `calld.applications.{application_uuid}.snoops.read` |
|  | `GET` | `/applications/{application_uuid}/snoops/{snoop_uuid}` | Xem tham số nghe lén (snoop) |  | `calld.applications.{application_uuid}.snoops.{snoop_uuid}.read` |
|  | `PUT` | `/applications/{application_uuid}/snoops/{snoop_uuid}` | Thay đổi tham số nghe lén (snoop) | body: `ApplicationSnoopPut` | `calld.applications.{application_uuid}.snoops.{snoop_uuid}.update` |
|  | `DELETE` | `/applications/{application_uuid}/snoops/{snoop_uuid}` | Dừng nghe lén (snoop) |  | `calld.applications.{application_uuid}.snoops.{snoop_uuid}.delete` |

### wazo-calld · calls

Cuộc gọi đang diễn ra: liệt kê, tạo (click-to-call), cúp, nghe, giữ máy, tắt mic, DTMF, ghi âm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/calls` | Danh sách cuộc gọi | query: `application`, `application_instance`, `recurse` | `calld.calls.read` |
|  | `POST` | `/calls` | Tạo cuộc gọi mới | body: `CallRequest` | `calld.calls.create` |
|  | `GET` | `/calls/{call_id}` | Xem một cuộc gọi |  | `calld.calls.{call_id}.read` |
|  | `DELETE` | `/calls/{call_id}` | Cúp cuộc gọi |  | `calld.calls.{call_id}.delete` |
|  | `PUT` | `/calls/{call_id}/answer` | Trả lời cuộc gọi |  | `calld.calls.{call_id}.answer.update` |
| 🌐 | `PUT` | `/calls/{call_id}/dtmf` | Giả lập bấm phím DTMF | query: `digits` | |
|  | `PUT` | `/calls/{call_id}/hold/start` | Giữ máy (hold) |  | `calld.calls.{call_id}.hold.start.update` |
|  | `PUT` | `/calls/{call_id}/hold/stop` | Bỏ giữ máy (unhold) |  | `calld.calls.{call_id}.hold.stop.update` |
|  | `PUT` | `/calls/{call_id}/mute/start` | Tắt mic cuộc gọi |  | `calld.calls.{call_id}.mute.start.update` |
|  | `PUT` | `/calls/{call_id}/mute/stop` | Bật lại mic cuộc gọi |  | `calld.calls.{call_id}.mute.stop.update` |
| 🌐 | `PUT` | `/calls/{call_id}/park` | Đỗ cuộc gọi (park) | body: `ParkCallBody` | |
|  | `PUT` | `/calls/{call_id}/record/pause` | Tạm dừng ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.pause.update` |
|  | `PUT` | `/calls/{call_id}/record/resume` | Tiếp tục ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.resume.update` |
|  | `PUT` | `/calls/{call_id}/record/start` | Bắt đầu ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.start.update` |
|  | `PUT` | `/calls/{call_id}/record/stop` | Dừng ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.stop.update` |
|  | `PUT` | `/calls/{call_id}/user/{user_uuid}` | Nối một cuộc gọi tới user | body: `ConnectCallToUserRequest` | `calld.calls.{call_id}.user.{user_uuid}.update` |
| 👤 | `GET` | `/users/me/calls` | Danh sách cuộc gọi của user | query: `application`, `application_instance` | `calld.users.me.calls.read` |
| 👤 | `POST` | `/users/me/calls` | Tạo cuộc gọi mới từ user (click-to-call) | body: `UserCallRequest` | `calld.users.me.calls.create` |
| 👤 | `DELETE` | `/users/me/calls/{call_id}` | Cúp cuộc gọi (từ phía user) |  | `calld.users.me.calls.{call_id}.delete` |
| 👤 | `PUT` | `/users/me/calls/{call_id}/answer` | Trả lời cuộc gọi (từ phía user) |  | `calld.users.me.calls.{call_id}.answer.update` |
| 🌐 | `PUT` | `/users/me/calls/{call_id}/dtmf` | Giả lập bấm phím DTMF | query: `digits` | |
| 👤 | `PUT` | `/users/me/calls/{call_id}/hold/start` | Giữ máy (từ phía user) |  | `calld.users.me.calls.{call_id}.hold.start.update` |
| 👤 | `PUT` | `/users/me/calls/{call_id}/hold/stop` | Bỏ giữ máy (từ phía user) |  | `calld.users.me.calls.{call_id}.hold.stop.update` |
| 👤 | `PUT` | `/users/me/calls/{call_id}/mute/start` | Tắt mic cuộc gọi (từ phía user) |  | `calld.users.me.calls.{call_id}.mute.start.update` |
| 👤 | `PUT` | `/users/me/calls/{call_id}/mute/stop` | Bật lại mic cuộc gọi (từ phía user) |  | `calld.users.me.calls.{call_id}.mute.stop.update` |
| 👤 | `PUT` | `/users/me/calls/{call_id}/park` | Đỗ cuộc gọi đang nói của user | body: `ParkCallBody` | `calld.users.me.calls.{call_id}.park.update` |
|  | `PUT` | `/users/me/calls/{call_id}/record/pause` | Tạm dừng ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.pause.update` |
|  | `PUT` | `/users/me/calls/{call_id}/record/resume` | Tiếp tục ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.resume.update` |
|  | `PUT` | `/users/me/calls/{call_id}/record/start` | Bắt đầu ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.start.update` |
|  | `PUT` | `/users/me/calls/{call_id}/record/stop` | Dừng ghi âm cuộc gọi |  | `calld.calls.{call_id}.record.stop.update` |

### wazo-calld · conferences

Người tham gia phòng họp: liệt kê, tắt mic, đuổi ra, ghi âm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/conferences/{conference_id}/participants` | Danh sách người tham gia conference |  | `calld.conferences.{conference_id}.participants.read` |
|  | `DELETE` | `/conferences/{conference_id}/participants/{participant_id}` | Đuổi người tham gia khỏi conference |  | `calld.conferences.{conference_id}.participants.{participant_id}.delete` |
|  | `PUT` | `/conferences/{conference_id}/participants/{participant_id}/mute` | Tắt mic một người trong conference |  | `calld.conferences.{conference_id}.participants.{participant_id}.mute.update` |
|  | `PUT` | `/conferences/{conference_id}/participants/{participant_id}/unmute` | Bật lại mic một người trong conference |  | `calld.conferences.{conference_id}.participants.{participant_id}.unmute.update` |
|  | `POST` | `/conferences/{conference_id}/record` | Ghi âm conference |  | `calld.conferences.{conference_id}.record.create` |
|  | `DELETE` | `/conferences/{conference_id}/record` | Dừng ghi âm conference |  | `calld.conferences.{conference_id}.record.delete` |
| 👤 | `GET` | `/users/me/conferences/{conference_id}/participants` | Danh sách người tham gia conference (quyền user) |  | `calld.users.me.conferences.{conference_id}.participants.read` |

### wazo-calld · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `calld.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `calld.config.update` |

### wazo-calld · faxes

Gửi fax.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `POST` | `/faxes` | Gửi fax | query: `context`, `extension`, `caller_id`, `ivr_extension`, `wait_time`<br>body: `JSON` | `calld.faxes.create` |
| 👤 | `POST` | `/users/me/faxes` | Gửi fax với tư cách user của token | query: `extension`, `caller_id`, `ivr_extension`, `wait_time`<br>body: `JSON` | `calld.users.me.faxes.create` |

### wazo-calld · lines

Trạng thái line.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/lines` | Danh sách trạng thái endpoint của line |  | `calld.lines.read` |

### wazo-calld · meetings

Người tham gia meeting: liệt kê, đuổi ra; trạng thái meeting.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/guests/me/meetings/{meeting_uuid}/status` | Xem trạng thái meeting |  | |
|  | `GET` | `/meetings/{meeting_uuid}/participants` | Danh sách người tham gia meeting |  | `calld.meetings.{meeting_uuid}.participants.read` |
|  | `DELETE` | `/meetings/{meeting_uuid}/participants/{participant_id}` | Đuổi người tham gia khỏi meeting |  | `calld.meetings.{meeting_uuid}.participants.delete` |
| 👤 | `GET` | `/users/me/meetings/{meeting_uuid}/participants` | Danh sách người tham gia meeting (quyền user) |  | `calld.users.me.meetings.{meeting_uuid}.participants.read` |
| 👤 | `DELETE` | `/users/me/meetings/{meeting_uuid}/participants/{participant_id}` | Đuổi người tham gia khỏi meeting (quyền user) |  | `calld.users.me.meetings.participants.delete` |

### wazo-calld · parking_lots

Đỗ / lấy lại cuộc gọi ở bãi đỗ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/parkinglots` | Danh sách parking và cuộc gọi đang đỗ |  | `calld.parkings.read` |
|  | `GET` | `/parkinglots/{parking_id}` | Lấy cuộc gọi đang đỗ ở parking |  | `calld.parkings.{parking_id}.read` |

### wazo-calld · relocates

Chuyển cuộc gọi đang nói sang thiết bị khác của chính mình (web ↔ điện thoại).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/users/me/relocates` | Xem các relocate của user đang đăng nhập |  | `calld.users.me.relocates.read` |
| 👤 | `POST` | `/users/me/relocates` | Bắt đầu relocate (user đang đăng nhập) | body: `UserRelocateRequest` | `calld.users.me.relocates.create` |
|  | `GET` | `/users/me/relocates/{relocate_uuid}` | Xem chi tiết relocate |  | `calld.relocates.users.me.{relocate_uuid}.read` |
| 👤 | `PUT` | `/users/me/relocates/{relocate_uuid}/cancel` | Huỷ relocate |  | `calld.users.me.relocates.{relocate_uuid}.cancel.update` |
| 👤 | `PUT` | `/users/me/relocates/{relocate_uuid}/complete` | Hoàn tất relocate |  | `calld.users.me.relocates.{relocate_uuid}.complete.update` |

### wazo-calld · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-calld |  | `calld.status.read` |

### wazo-calld · switchboards

Thao tác trực tổng đài: hàng đợi lễ tân, giữ, trả lời.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/switchboards/{switchboard_uuid}/calls/held` | Danh sách cuộc gọi đang giữ trong switchboard |  | `calld.switchboards.{switchboard_uuid}.calls.held.read` |
|  | `PUT` | `/switchboards/{switchboard_uuid}/calls/held/{call_id}` | Giữ cuộc gọi chỉ định trong switchboard |  | `calld.switchboards.{switchboard_uuid}.calls.held.{call_id}.update` |
|  | `PUT` | `/switchboards/{switchboard_uuid}/calls/held/{call_id}/answer` | Trả lời cuộc gọi đang giữ chỉ định | query: `line_id` | `calld.switchboards.{switchboard_uuid}.calls.held.{call_id}.answer.update` |
|  | `GET` | `/switchboards/{switchboard_uuid}/calls/queued` | Danh sách cuộc gọi đang chờ trong switchboard |  | `calld.switchboards.{switchboard_uuid}.calls.queued.read` |
|  | `PUT` | `/switchboards/{switchboard_uuid}/calls/queued/{call_id}/answer` | Trả lời cuộc gọi đang chờ trong hàng chỉ định | query: `line_id` | `calld.switchboards.{switchboard_uuid}.calls.queued.{call_id}.answer.update` |

### wazo-calld · transfers

Chuyển cuộc gọi: chuyển thẳng (blind) hoặc hỏi ý trước (attended), hoàn tất, huỷ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `POST` | `/transfers` | Bắt đầu chuyển cuộc gọi (transfer) | body: `TransferRequest` | `calld.transfers.create` |
| 👤 | `GET` | `/transfers/{transfer_id}` | Xem chi tiết transfer |  | `calld.transfers.{transfer_id}.read` |
| 👤 | `DELETE` | `/transfers/{transfer_id}` | Huỷ chuyển cuộc gọi (transfer) |  | `calld.transfers.{transfer_id}.delete` |
| 👤 | `PUT` | `/transfers/{transfer_id}/complete` | Hoàn tất chuyển cuộc gọi (transfer) |  | `calld.transfers.{transfer_id}.complete.update` |
| 👤 | `GET` | `/users/me/transfers` | Xem các transfer của user đang đăng nhập |  | `calld.users.me.transfers.read` |
| 👤 | `POST` | `/users/me/transfers` | Bắt đầu chuyển cuộc gọi (user đang đăng nhập) | body: `UserTransferRequest` | `calld.users.me.transfers.create` |
| 👤 | `DELETE` | `/users/me/transfers/{transfer_id}` | Huỷ chuyển cuộc gọi (transfer) |  | `calld.users.me.transfers.{transfer_id}.delete` |
| 👤 | `PUT` | `/users/me/transfers/{transfer_id}/complete` | Hoàn tất chuyển cuộc gọi (transfer) |  | `calld.users.me.transfers.{transfer_id}.complete.update` |

### wazo-calld · trunks

Trạng thái trung kế.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/trunks` | Danh sách trạng thái endpoint của trunk |  | `calld.trunks.read` |

### wazo-calld · users

Thao tác của user trên cuộc gọi của chính mình (/users/me/...): cuộc gọi, chuyển, voicemail, meeting.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/users/me/voicemails` | Xem voicemail của user đang đăng nhập |  | `calld.users.me.voicemails.read` |
| 👤 | `GET` | `/users/me/voicemails/folders/{folder_id}` | Xem chi tiết một thư mục voicemail |  | `calld.users.me.voicemails.folders.{folder_id}.read` |
| 👤 | `GET` | `/users/me/voicemails/greetings/{greeting}` | Xem lời chào tuỳ chỉnh |  | `calld.users.me.voicemails.greetings.{greeting}.read` |
| 👤 | `POST` | `/users/me/voicemails/greetings/{greeting}` | Tạo lời chào tuỳ chỉnh | body: `JSON` | `calld.users.me.voicemails.greetings.{greeting}.create` |
| 👤 | `PUT` | `/users/me/voicemails/greetings/{greeting}` | Cập nhật lời chào tuỳ chỉnh | body: `JSON` | `calld.users.me.voicemails.greetings.{greeting}.update` |
| 👤 | `DELETE` | `/users/me/voicemails/greetings/{greeting}` | Xoá lời chào tuỳ chỉnh |  | `calld.users.me.voicemails.greetings.{greeting}.delete` |
| 👤 | `HEAD` | `/users/me/voicemails/greetings/{greeting}` | Kiểm tra lời chào (greeting) có tồn tại không |  | `calld.users.me.voicemails.greetings.{greeting}.read` |
| 👤 | `POST` | `/users/me/voicemails/greetings/{greeting}/copy` | Sao chép lời chào tuỳ chỉnh | body: `GreetingCopy` | `calld.users.me.voicemails.greetings.{greeting}.copy.create` |
| 👤 | `GET` | `/users/me/voicemails/messages` | Xem tất cả tin nhắn voicemail của user | query: `direction`, `order`, `limit`, `offset`, `voicemail_type` | `calld.users.me.voicemails.messages.read` |
| 👤 | `GET` | `/users/me/voicemails/messages/{message_id}` | Xem một tin nhắn (voicemail) |  | `calld.users.me.voicemails.messages.{message_id}.read` |
| 👤 | `PUT` | `/users/me/voicemails/messages/{message_id}` | Cập nhật tin nhắn voicemail (đánh dấu đã nghe, chuyển thư mục) | body: `VoicemailMessageUpdate` | `calld.users.me.voicemails.messages.{message_id}.update` |
| 👤 | `DELETE` | `/users/me/voicemails/messages/{message_id}` | Xoá tin nhắn |  | `calld.users.me.voicemails.messages.{message_id}.delete` |
| 👤 | `GET` | `/users/me/voicemails/messages/{message_id}/recording` | Tải file ghi âm của tin nhắn voicemail | query: `token`, `download` | `calld.users.me.voicemails.messages.{message_id}.recording.read` |

### wazo-calld · voicemails

Hộp thư thoại: tin nhắn, lời chào, đánh dấu đã nghe, tải file âm thanh.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/voicemails/messages` | Danh sách mọi tin nhắn voicemail trong tenant | query: `direction`, `order`, `limit`, `offset`, `voicemail_type`, `user_uuid`, `voicemail_id`, `from`, `until`, `recurse`, `transcribed` | `calld.voicemails.messages.read` |
|  | `GET` | `/voicemails/{voicemail_id}` | Xem chi tiết voicemail |  | `calld.voicemails.{voicemail_id}.read` |
|  | `GET` | `/voicemails/{voicemail_id}/folders/{folder_id}` | Xem chi tiết một thư mục voicemail |  | `calld.voicemails.{voicemail_id}.folders.{folder_id}.read` |
|  | `GET` | `/voicemails/{voicemail_id}/greetings/{greeting}` | Xem lời chào tuỳ chỉnh |  | `calld.voicemails.{voicemail_id}.greetings.{greeting}.read` |
|  | `POST` | `/voicemails/{voicemail_id}/greetings/{greeting}` | Tạo lời chào tuỳ chỉnh | body: `JSON` | `calld.voicemails.{voicemail_id}.greetings.{greeting}.create` |
|  | `PUT` | `/voicemails/{voicemail_id}/greetings/{greeting}` | Cập nhật lời chào tuỳ chỉnh | body: `JSON` | `calld.voicemails.{voicemail_id}.greetings.{greeting}.update` |
|  | `DELETE` | `/voicemails/{voicemail_id}/greetings/{greeting}` | Xoá lời chào tuỳ chỉnh |  | `calld.voicemails.{voicemail_id}.greetings.{greeting}.delete` |
|  | `HEAD` | `/voicemails/{voicemail_id}/greetings/{greeting}` | Kiểm tra lời chào (greeting) có tồn tại không |  | `calld.voicemails.{voicemail_id}.greetings.{greeting}.read` |
|  | `POST` | `/voicemails/{voicemail_id}/greetings/{greeting}/copy` | Sao chép lời chào tuỳ chỉnh | body: `GreetingCopy` | `calld.voicemails.{voicemail_id}.greetings.{greeting}.copy.create` |
|  | `GET` | `/voicemails/{voicemail_id}/messages/{message_id}` | Xem một tin nhắn (voicemail) |  | `calld.voicemails.{voicemail_id}.messages.{message_id}.read` |
|  | `PUT` | `/voicemails/{voicemail_id}/messages/{message_id}` | Cập nhật tin nhắn voicemail (đánh dấu đã nghe, chuyển thư mục) | body: `VoicemailMessageUpdate` | `calld.voicemails.{voicemail_id}.messages.{message_id}.update` |
|  | `DELETE` | `/voicemails/{voicemail_id}/messages/{message_id}` | Xoá tin nhắn |  | `calld.voicemails.{voicemail_id}.messages.{message_id}.delete` |
|  | `GET` | `/voicemails/{voicemail_id}/messages/{message_id}/recording` | Tải file ghi âm của tin nhắn voicemail | query: `token`, `download` | `calld.voicemails.{voicemail_id}.messages.{message_id}.recording.read` |


## wazo-call-logd

**Lịch sử cuộc gọi.** CDR (lịch sử cuộc gọi), ghi âm, thống kê hàng đợi/agent, chính sách lưu trữ.

Base URL: `https://<HOST>/api/call-logd/1.0` · Spec: `api-specs/wazo-call-logd.yml` · 22 endpoint, 3 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [agent_statistics](#wazo-call-logd-agent-statistics) | 2 | Thống kê agent call center. |
| [cdr](#wazo-call-logd-cdr) | 9 | Lịch sử cuộc gọi toàn hệ thống (quản trị), file ghi âm, xoá ghi âm. |
| [config](#wazo-call-logd-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [exports](#wazo-call-logd-exports) | 2 | Xuất lịch sử/ghi âm ra file để tải về. |
| [queue_statistics](#wazo-call-logd-queue-statistics) | 3 | Thống kê hàng đợi. |
| [retention](#wazo-call-logd-retention) | 2 | Thời gian lưu lịch sử và ghi âm. |
| [status](#wazo-call-logd-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [voicemail_transcriptions](#wazo-call-logd-voicemail-transcriptions) | 1 | Văn bản chuyển từ voicemail. |

### wazo-call-logd · agent_statistics

Thống kê agent call center.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/agents/statistics` | Thống kê tất cả agent | query: `from`, `until`, `day_start_time`, `day_end_time`, `week_days`, `timezone` | `call-logd.agents.statistics.read` |
|  | `GET` | `/agents/{agent_id}/statistics` | Thống kê một agent | query: `from`, `until`, `interval`, `day_start_time`, `day_end_time`, `week_days`, `timezone` | `call-logd.agents.statistics.{agent_id}.read` |

### wazo-call-logd · cdr

Lịch sử cuộc gọi toàn hệ thống (quản trị), file ghi âm, xoá ghi âm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/cdr` | Danh sách CDR (lịch sử cuộc gọi) | query: `from`, `until`, `limit`, `offset`, `order`, `direction`, `search`, `call_direction`, `number`, `tags`, `user_uuid`, `from_id`, `recurse`, `distinct`, `recorded`, `format`, `conversation_id`, `call_status`, `requested_internal_extension`, `requested_internal_context` | `call-logd.cdr.read` |
|  | `DELETE` | `/cdr/recordings/media` | Xoá file ghi âm của nhiều CDR | body: `JSON` | `call-logd.cdr.recordings.media.delete` |
|  | `POST` | `/cdr/recordings/media/export` | Tạo bản export file ghi âm của nhiều CDR | query: `from`, `until`, `search`, `call_direction`, `number`, `tags`, `user_uuid`, `from_id`, `recurse`, `email`<br>body: `JSON` | `call-logd.cdr.recordings.media.export.create` |
|  | `GET` | `/cdr/{cdr_id}` | Xem một CDR theo ID |  | `call-logd.cdr.{cdr_id}.read` |
|  | `GET` | `/cdr/{cdr_id}/recordings/{recording_uuid}/media` | Tải file ghi âm |  | `call-logd.cdr.{cdr_id}.recordings.{recording_uuid}.media.read` |
|  | `DELETE` | `/cdr/{cdr_id}/recordings/{recording_uuid}/media` | Xoá file ghi âm |  | `call-logd.cdr.{cdr_id}.recordings.{recording_uuid}.media.delete` |
| 👤 | `GET` | `/users/me/cdr` | Danh sách CDR của user đang đăng nhập | query: `from`, `until`, `limit`, `offset`, `order`, `direction`, `search`, `call_direction`, `number`, `from_id`, `user_uuid`, `distinct`, `recorded`, `format`, `conversation_id`, `call_status`, `requested_internal_extension`, `requested_internal_context` | `call-logd.users.me.cdr.read` |
| 👤 | `GET` | `/users/me/cdr/{cdr_id}/recordings/{recording_uuid}/media` | Tải file ghi âm của user |  | `call-logd.users.me.cdr.{cdr_id}.recordings.{recording_uuid}.media.read` |
| 👤 | `GET` | `/users/{user_uuid}/cdr` | Danh sách CDR của một user | query: `from`, `until`, `limit`, `offset`, `order`, `direction`, `search`, `call_direction`, `number`, `from_id`, `distinct`, `recorded`, `format`, `conversation_id`, `call_status`, `requested_internal_extension`, `requested_internal_context` | `call-logd.users.{user_uuid}.cdr.read` |

### wazo-call-logd · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `call_logd.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `call_logd.config.update` |

### wazo-call-logd · exports

Xuất lịch sử/ghi âm ra file để tải về.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/exports/{export_uuid}` | Xem bản export theo UUID |  | `call-logd.exports.{export_uuid}.read` |
|  | `GET` | `/exports/{export_uuid}/download` | Tải bản export dạng file ZIP theo UUID |  | `call-logd.exports.{export_uuid}.download.read` |

### wazo-call-logd · queue_statistics

Thống kê hàng đợi.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/queues/statistics` | Thống kê tất cả queue | query: `from`, `until`, `qos_threshold`, `day_start_time`, `day_end_time`, `week_days`, `timezone` | `call-logd.queues.statistics.read` |
|  | `GET` | `/queues/{queue_id}/statistics` | Thống kê một queue | query: `from`, `until`, `interval`, `qos_threshold`, `day_start_time`, `day_end_time`, `week_days`, `timezone` | `call-logd.queues.statistics.{queue_id}.read` |
|  | `GET` | `/queues/{queue_id}/statistics/qos` | Thống kê chất lượng (QoS) của một queue | query: `from`, `until`, `interval`, `qos_thresholds`, `day_start_time`, `day_end_time`, `week_days`, `timezone` | `call-logd.queues.statistics.{queue_id}.qos.read` |

### wazo-call-logd · retention

Thời gian lưu lịch sử và ghi âm.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/retention` | Cấu hình thời gian lưu trữ |  | `call-logd.retention.read` |
|  | `PUT` | `/retention` | Cập nhật cấu hình thời gian lưu trữ | body: `Retention` | `call-logd.retention.update` |

### wazo-call-logd · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-call-logd |  | `call-logd.status.read` |

### wazo-call-logd · voicemail_transcriptions

Văn bản chuyển từ voicemail.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/voicemails/transcriptions` | Danh sách văn bản chuyển từ voicemail | query: `from`, `until`, `voicemail_id`, `limit`, `offset`, `order`, `direction`, `search_text` | `call-logd.voicemails.transcriptions.read` |


## wazo-dird

**Danh bạ.** Tìm kiếm danh bạ hợp nhất, danh bạ nội bộ, danh bạ cá nhân, yêu thích, danh bạ chung (phonebook), cấu hình nguồn danh bạ (LDAP, CSV, Google, Office 365...).

Base URL: `https://<HOST>/api/dird/0.1` · Spec: `api-specs/wazo-dird.yml` · 106 endpoint, 19 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [conference](#wazo-dird-conference) | 1 | Nguồn danh bạ "phòng họp". |
| [config](#wazo-dird-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [configuration](#wazo-dird-configuration) | 58 | Quản trị: nguồn danh bạ (wazo, LDAP, CSV, phonebook...), hiển thị cột, profile. |
| [directories](#wazo-dird-directories) | 9 | Tìm kiếm danh bạ hợp nhất theo profile, tra ngược số → tên, nguồn của profile. |
| [google](#wazo-dird-google) | 1 | Nguồn danh bạ Google. |
| [office365](#wazo-dird-office365) | 1 | Nguồn danh bạ Office 365. |
| [personal](#wazo-dird-personal) | 7 | Danh bạ cá nhân của user: thêm/sửa/xoá, import CSV. |
| [phonebook](#wazo-dird-phonebook) | 23 | Danh bạ chung công ty do admin quản lý. |
| [status](#wazo-dird-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [wazo](#wazo-dird-wazo) | 1 | Danh bạ nội bộ: liệt kê user Wazo của tenant. |
| [work_in_progress](#wazo-dird-work-in-progress) | 2 | API thử nghiệm, có thể thay đổi. |

### wazo-dird · conference

Nguồn danh bạ "phòng họp".

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/backends/conference/sources/{source_uuid}/contacts` | Lấy toàn bộ liên hệ từ nguồn conference | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.backends.conference.sources.{source_uuid}.contacts.read` |

### wazo-dird · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại của dịch vụ |  | `dird.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `dird.config.update` |

### wazo-dird · configuration

Quản trị: nguồn danh bạ (wazo, LDAP, CSV, phonebook...), hiển thị cột, profile.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/backends` | Danh sách backend đã nạp | query: `search`, `order`, `direction`, `limit`, `offset` | `dird.backends.read` |
|  | `GET` | `/backends/conference/sources` | Xem tất cả cấu hình nguồn `conference` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.conference.sources.read` |
|  | `POST` | `/backends/conference/sources` | Cấu hình nguồn danh bạ cho backend `conference` | body: `ConferenceSource` | `dird.backends.conference.sources.create` |
|  | `GET` | `/backends/conference/sources/{source_uuid}` | Xem cấu hình nguồn `conference` |  | `dird.backends.conference.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/conference/sources/{source_uuid}` | Cập nhật cấu hình nguồn `conference` | body: `ConferenceSource` | `dird.backends.conference.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/conference/sources/{source_uuid}` | Xoá cấu hình nguồn `conference` |  | `dird.backends.conference.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/csv/sources` | Xem tất cả cấu hình nguồn `csv` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.csv.sources.read` |
|  | `POST` | `/backends/csv/sources` | Cấu hình nguồn danh bạ cho backend `csv` | body: `CSVSource` | `dird.backends.csv.sources.create` |
|  | `GET` | `/backends/csv/sources/{source_uuid}` | Xem cấu hình nguồn `csv` |  | `dird.backends.csv.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/csv/sources/{source_uuid}` | Cập nhật cấu hình nguồn `csv` | body: `CSVSource` | `dird.backends.csv.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/csv/sources/{source_uuid}` | Xoá cấu hình nguồn `csv` |  | `dird.backends.csv.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/csv_ws/sources` | Xem tất cả cấu hình nguồn `csv_ws` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.csv_ws.sources.read` |
|  | `POST` | `/backends/csv_ws/sources` | Cấu hình nguồn danh bạ cho backend `csv_ws` | body: `CSVWSSource` | `dird.backends.csv_ws.sources.create` |
|  | `GET` | `/backends/csv_ws/sources/{source_uuid}` | Xem cấu hình nguồn `csv_ws` |  | `dird.backends.csv_ws.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/csv_ws/sources/{source_uuid}` | Cập nhật cấu hình nguồn `csv_ws` | body: `CSVWSSource` | `dird.backends.csv_ws.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/csv_ws/sources/{source_uuid}` | Xoá cấu hình nguồn `csv_ws` |  | `dird.backends.csv_ws.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/google/sources` | Xem cấu hình Google | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.google.sources.read` |
|  | `POST` | `/backends/google/sources` | Cấu hình nguồn danh bạ cho backend Google | body: `GoogleSource` | `dird.backends.google.sources.create` |
|  | `GET` | `/backends/google/sources/{source_uuid}` | Xem cấu hình nguồn `google` |  | `dird.backends.google.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/google/sources/{source_uuid}` | Cập nhật cấu hình nguồn `google` | body: `GoogleSource` | `dird.backends.google.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/google/sources/{source_uuid}` | Xoá cấu hình nguồn `google` |  | `dird.backends.google.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/ldap/sources` | Xem tất cả cấu hình nguồn `ldap` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.ldap.sources.read` |
|  | `POST` | `/backends/ldap/sources` | Cấu hình nguồn danh bạ cho backend `ldap` | body: `LDAPSource` | `dird.backends.ldap.sources.create` |
|  | `GET` | `/backends/ldap/sources/{source_uuid}` | Xem cấu hình nguồn `ldap` |  | `dird.backends.ldap.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/ldap/sources/{source_uuid}` | Cập nhật cấu hình nguồn `ldap` | body: `LDAPSource` | `dird.backends.ldap.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/ldap/sources/{source_uuid}` | Xoá cấu hình nguồn `ldap` |  | `dird.backends.ldap.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/office365/sources` | Xem cấu hình Microsoft | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.microsoft.sources.read` |
|  | `POST` | `/backends/office365/sources` | Cấu hình nguồn danh bạ cho backend Microsoft | body: `MicrosoftSource` | `dird.backends.microsoft.sources.create` |
|  | `GET` | `/backends/office365/sources/{source_uuid}` | Xem cấu hình nguồn `microsoft` |  | `dird.backends.microsoft.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/office365/sources/{source_uuid}` | Cập nhật cấu hình nguồn `microsoft` | body: `MicrosoftSource` | `dird.backends.microsoft.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/office365/sources/{source_uuid}` | Xoá cấu hình nguồn `microsoft` |  | `dird.backends.microsoft.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/personal/sources` | Xem tất cả cấu hình nguồn `personal` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.personal.sources.read` |
|  | `POST` | `/backends/personal/sources` | Cấu hình nguồn danh bạ cho backend `personal` | body: `PersonalSource` | `dird.backends.personal.sources.create` |
|  | `GET` | `/backends/personal/sources/{source_uuid}` | Xem cấu hình nguồn `personal` |  | `dird.backends.personal.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/personal/sources/{source_uuid}` | Cập nhật cấu hình nguồn `personal` | body: `PersonalSource` | `dird.backends.personal.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/personal/sources/{source_uuid}` | Xoá cấu hình nguồn `personal` |  | `dird.backends.personal.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/phonebook/sources` | Xem tất cả cấu hình nguồn `phonebook` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.phonebook.sources.read` |
|  | `POST` | `/backends/phonebook/sources` | Cấu hình nguồn danh bạ cho backend `phonebook` | body: `PhonebookSource` | `dird.backends.phonebook.sources.create` |
|  | `GET` | `/backends/phonebook/sources/{source_uuid}` | Xem cấu hình nguồn `phonebook` |  | `dird.backends.phonebook.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/phonebook/sources/{source_uuid}` | Cập nhật cấu hình nguồn `phonebook` | body: `PhonebookSource` | `dird.backends.phonebook.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/phonebook/sources/{source_uuid}` | Xoá cấu hình nguồn `phonebook` |  | `dird.backends.phonebook.sources.{source_uuid}.delete` |
|  | `GET` | `/backends/wazo/sources` | Xem tất cả cấu hình nguồn `wazo` | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.backends.wazo.sources.read` |
|  | `POST` | `/backends/wazo/sources` | Cấu hình nguồn danh bạ cho backend `wazo` | body: `WazoSource` | `dird.backends.wazo.sources.create` |
|  | `GET` | `/backends/wazo/sources/{source_uuid}` | Xem cấu hình nguồn `wazo` |  | `dird.backends.wazo.sources.{source_uuid}.read` |
|  | `PUT` | `/backends/wazo/sources/{source_uuid}` | Cập nhật cấu hình nguồn `wazo` | body: `WazoSource` | `dird.backends.wazo.sources.{source_uuid}.update` |
|  | `DELETE` | `/backends/wazo/sources/{source_uuid}` | Xoá cấu hình nguồn `wazo` |  | `dird.backends.wazo.sources.{source_uuid}.delete` |
|  | `GET` | `/displays` | Danh sách display | query: `recurse`, `order`, `direction`, `limit`, `offset` | `dird.displays.read` |
|  | `POST` | `/displays` | Tạo cấu hình hiển thị (display) mới | body: `Display` | `dird.displays.create` |
|  | `GET` | `/displays/{display_uuid}` | Xem display |  | `dird.displays.{display_uuid}.read` |
|  | `PUT` | `/displays/{display_uuid}` | Cập nhật display | body: `Display` | `dird.displays.{display_uuid}.update` |
|  | `DELETE` | `/displays/{display_uuid}` | Xoá display |  | `dird.displays.{display_uuid}.delete` |
|  | `GET` | `/profiles` | Danh sách profile đã cấu hình | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `dird.profiles.read` |
|  | `POST` | `/profiles` | Tạo profile cấu hình mới | body: `Profile` | `dird.profiles.create` |
|  | `GET` | `/profiles/{profile_uuid}` | Xem cấu hình profile |  | `dird.profiles.{profile_uuid}.read` |
|  | `PUT` | `/profiles/{profile_uuid}` | Cập nhật cấu hình profile | body: `Profile` | `dird.profiles.{profile_uuid}.update` |
|  | `DELETE` | `/profiles/{profile_uuid}` | Xoá cấu hình profile |  | `dird.profiles.{profile_uuid}.delete` |
|  | `GET` | `/services` | Danh sách dịch vụ đã nạp | query: `order`, `direction`, `limit`, `offset` | `dird.services.read` |
|  | `GET` | `/sources` | Danh sách nguồn danh bạ đã cấu hình | query: `recurse`, `order`, `direction`, `limit`, `offset`, `search` | `dird.sources.read` |

### wazo-dird · directories

Tìm kiếm danh bạ hợp nhất theo profile, tra ngược số → tên, nguồn của profile.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `PUT` | `/directories/favorites/{directory}/{contact}` | Đánh dấu liên hệ yêu thích |  | `dird.directories.favorites.{directory}.{contact}.update` |
| 👤 | `DELETE` | `/directories/favorites/{directory}/{contact}` | Bỏ đánh dấu yêu thích |  | `dird.directories.favorites.{directory}.{contact}.delete` |
| 👤 | `GET` | `/directories/favorites/{profile}` | Danh sách liên hệ yêu thích |  | `dird.directories.favorites.{profile}.read` |
| 👤 | `GET` | `/directories/lookup/{profile}` | Tìm kiếm liên hệ | query: `term` | `dird.directories.lookup.{profile}.read` |
|  | `GET` | `/directories/lookup/{profile}/headers` | Lấy tiêu đề cột của kết quả lookup |  | `dird.directories.lookup.{profile}.headers.read` |
| 👤 | `GET` | `/directories/lookup/{profile}/{user_uuid}` | Tìm kiếm liên hệ cho một user | query: `term` | `dird.directories.lookup.{profile}.{user_uuid}.read` |
|  | `GET` | `/directories/personal/{profile}` | Danh sách liên hệ cá nhân đã định dạng |  | `dird.directories.personal.{profile}.read` |
| 👤 | `GET` | `/directories/reverse/{profile}/{user_uuid}` | Tìm liên hệ theo số điện thoại (tra ngược) | query: `exten` | `dird.directories.reverse.{profile}.{user_uuid}.read` |
| 👤 | `GET` | `/directories/{profile}/sources` | Danh sách nguồn danh bạ gắn với profile | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.directories.{profile}.sources.read` |

### wazo-dird · google

Nguồn danh bạ Google.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/backends/google/sources/{source_uuid}/contacts` | Lấy toàn bộ liên hệ từ `google` | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.backends.google.sources.{source_uuid}.contacts.read` |

### wazo-dird · office365

Nguồn danh bạ Office 365.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/backends/office365/sources/{source_uuid}/contacts` | Lấy toàn bộ liên hệ từ `office365` | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.backends.office365.sources.{source_uuid}.contacts.read` |

### wazo-dird · personal

Danh bạ cá nhân của user: thêm/sửa/xoá, import CSV.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/personal` | Danh sách liên hệ cá nhân | query: `format`, `order`, `direction`, `limit`, `offset` | `dird.personal.read` |
| 👤 | `POST` | `/personal` | Tạo liên hệ cá nhân mới | body: `ContactBodySample` | `dird.personal.create` |
| 👤 | `DELETE` | `/personal` | Xoá toàn bộ liên hệ cá nhân |  | `dird.personal.delete` |
| 👤 | `POST` | `/personal/import` | Import nhiều liên hệ cá nhân cùng lúc | body: `JSON` | `dird.personal.import.create` |
| 👤 | `GET` | `/personal/{contact_id}` | Xem liên hệ cá nhân |  | `dird.personal.{contact_id}.read` |
| 👤 | `PUT` | `/personal/{contact_id}` | Sửa liên hệ cá nhân | body: `ContactBodySample` | `dird.personal.{contact_id}.update` |
| 👤 | `DELETE` | `/personal/{contact_id}` | Xoá liên hệ cá nhân |  | `dird.personal.{contact_id}.delete` |

### wazo-dird · phonebook

Danh bạ chung công ty do admin quản lý.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/backends/phonebook/sources/{source_uuid}/contacts` | Lấy danh sách liên hệ từ nguồn `phonebook` | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.backends.phonebook.sources.{source_uuid}.contacts.read` |
|  | `GET` | `/phonebooks` | Danh sách phonebook của tenant | query: `order`, `direction`, `limit`, `offset`, `search`, `recurse` | `dird.phonebooks.read` |
|  | `POST` | `/phonebooks` | Tạo phonebook mới | body: `PhonebookBody` | `dird.phonebooks.create` |
|  | `GET` | `/phonebooks/{phonebook_uuid}` | Xem thông tin một phonebook |  | `dird.phonebooks.{phonebook_uuid}.read` |
|  | `PUT` | `/phonebooks/{phonebook_uuid}` | Sửa phonebook | body: `PhonebookBody` | `dird.phonebooks.{phonebook_uuid}.update` |
|  | `DELETE` | `/phonebooks/{phonebook_uuid}` | Xoá phonebook |  | `dird.phonebooks.{phonebook_uuid}.delete` |
|  | `GET` | `/phonebooks/{phonebook_uuid}/contacts` | Danh sách liên hệ của một phonebook | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.phonebooks.{phonebook_uuid}.contacts.read` |
|  | `POST` | `/phonebooks/{phonebook_uuid}/contacts` | Tạo liên hệ mới | body: `PhonebookContact` | `dird.phonebooks.{phonebook_uuid}.contacts.create` |
|  | `POST` | `/phonebooks/{phonebook_uuid}/contacts/import` | Import nhiều liên hệ cùng lúc | body: `JSON` | `dird.phonebooks.{phonebook_uuid}.contacts.create` |
|  | `GET` | `/phonebooks/{phonebook_uuid}/contacts/{contact_id}` | Xem thông tin một liên hệ |  | `dird.phonebooks.{phonebook_uuid}.contacts.{contact_id}.read` |
|  | `PUT` | `/phonebooks/{phonebook_uuid}/contacts/{contact_id}` | Sửa liên hệ | body: `ContactBodySample` | `dird.phonebooks.{phonebook_uuid}.contacts.{contact_id}.update` |
|  | `DELETE` | `/phonebooks/{phonebook_uuid}/contacts/{contact_id}` | Xoá liên hệ |  | `dird.phonebooks.{phonebook_uuid}.contacts.{contact_id}.delete` |
|  | `GET` | `/tenants/{tenant}/phonebooks` | Danh sách phonebook của tenant | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.tenants.{tenant}.phonebooks.read` |
|  | `POST` | `/tenants/{tenant}/phonebooks` | Tạo phonebook mới | body: `PhonebookBody` | `dird.tenants.{tenant}.phonebooks.create` |
|  | `GET` | `/tenants/{tenant}/phonebooks/{phonebook_id}` | Xem thông tin một phonebook |  | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.read` |
|  | `PUT` | `/tenants/{tenant}/phonebooks/{phonebook_id}` | Sửa phonebook | body: `PhonebookBody` | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.update` |
|  | `DELETE` | `/tenants/{tenant}/phonebooks/{phonebook_id}` | Xoá phonebook |  | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.delete` |
|  | `GET` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts` | Danh sách liên hệ của một phonebook | query: `order`, `direction`, `limit`, `offset`, `search` | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.read` |
|  | `POST` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts` | Tạo liên hệ mới | body: `PhonebookContact` | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.create` |
|  | `POST` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts/import` | Import nhiều liên hệ cùng lúc | body: `JSON` | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.create` |
|  | `GET` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts/{contact_id}` | Xem thông tin một liên hệ |  | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.{contact_id}.read` |
|  | `PUT` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts/{contact_id}` | Sửa liên hệ | body: `ContactBodySample` | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.{contact_id}.update` |
|  | `DELETE` | `/tenants/{tenant}/phonebooks/{phonebook_id}/contacts/{contact_id}` | Xoá liên hệ |  | `dird.tenants.{tenant}.phonebooks.{phonebook_id}.contacts.{contact_id}.delete` |

### wazo-dird · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-dird |  | `dird.status.read` |

### wazo-dird · wazo

Danh bạ nội bộ: liệt kê user Wazo của tenant.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/backends/wazo/sources/{source_uuid}/contacts` | Lấy toàn bộ liên hệ từ `wazo` (user nội bộ) | query: `order`, `direction`, `limit`, `offset`, `search`, `uuid` | `dird.backends.wazo.sources.{source_uuid}.contacts.read` |

### wazo-dird · work_in_progress

API thử nghiệm, có thể thay đổi.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `GET` | `/graphql` | Giao diện thử GraphQL (GraphiQL) trên trình duyệt, không phải REST |  | |
|  | `POST` | `/graphql` | Chạy truy vấn GraphQL (endpoint GraphQL, không phải REST) |  | `dird.graphql.{root_field_name}` |


## wazo-chatd

**Trạng thái & chat.** Trạng thái online (presence), phòng chat, tin nhắn.

Base URL: `https://<HOST>/api/chatd/1.0` · Spec: `api-specs/wazo-chatd.yml` · 23 endpoint, 8 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [config](#wazo-chatd-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [connectors](#wazo-chatd-connectors) | 5 | Kết nối chat với kênh ngoài (SMS...). |
| [identities](#wazo-chatd-identities) | 6 | Danh tính chat ngoài của user (số SMS...). |
| [microsoft](#wazo-chatd-microsoft) | 1 | Đồng bộ trạng thái với Microsoft Teams. |
| [presences](#wazo-chatd-presences) | 3 | Trạng thái online/bận/vắng và trạng thái line của user. |
| [rooms](#wazo-chatd-rooms) | 5 | Phòng chat (1-1, nhóm) và tin nhắn trong phòng. |
| [status](#wazo-chatd-status) | 1 | Kiểm tra tình trạng dịch vụ. |

### wazo-chatd · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `chatd.config.read` |
|  | `PATCH` | `/config` | Thay đổi một phần cấu hình | body: `ConfigPatchItem` | `chatd.config.update` |

### wazo-chatd · connectors

Kết nối chat với kênh ngoài (SMS...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/connectors` | Danh sách khả năng (capability) của từng backend |  | `chatd.connectors.read` |
| 🌐 | `POST` | `/connectors/incoming` | Nhận webhook gửi đến từ connector | body: `JSON` | |
| 🌐 | `POST` | `/connectors/incoming/{backend}` | Nhận webhook gửi đến kèm gợi ý backend | body: `JSON` | |
|  | `GET` | `/connectors/{backend}/auth-schema` | Xem schema thông tin đăng nhập mà backend yêu cầu |  | `chatd.connectors.{backend}.auth-schema.read` |
|  | `GET` | `/connectors/{backend}/identities` | Danh sách identity mà backend báo tenant đang sở hữu |  | `chatd.connectors.{backend}.identities.read` |

### wazo-chatd · identities

Danh tính chat ngoài của user (số SMS...).

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/identities` | Danh sách identity mà tenant thấy được | query: `limit`, `offset`, `order`, `direction`, `search`, `user_uuid`, `backend`, `type`, `identity` | `chatd.identities.read` |
|  | `POST` | `/identities` | Tạo identity | body: `IdentityCreateRequest` | `chatd.identities.create` |
|  | `GET` | `/identities/{identity_uuid}` | Xem identity theo UUID |  | `chatd.identities.{identity_uuid}.read` |
|  | `PUT` | `/identities/{identity_uuid}` | Cập nhật một phần identity | body: `IdentityUpdateRequest` | `chatd.identities.{identity_uuid}.update` |
|  | `DELETE` | `/identities/{identity_uuid}` | Xoá identity |  | `chatd.identities.{identity_uuid}.delete` |
|  | `GET` | `/users/me/identities` | Danh sách identity của user đang đăng nhập | query: `room_uuid` | `chatd.users.me.identities.read` |

### wazo-chatd · microsoft

Đồng bộ trạng thái với Microsoft Teams.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 🌐 | `POST` | `/users/{user_uuid}/teams/presence` | Nhận trạng thái từ Microsoft Teams |  | |

### wazo-chatd · presences

Trạng thái online/bận/vắng và trạng thái line của user.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/users/presences` | Danh sách trạng thái (presence) của nhiều user | query: `recurse`, `user_uuid` | `chatd.users.presences.read` |
| 👤 | `GET` | `/users/{user_uuid}/presences` | Xem trạng thái (presence) của user |  | `chatd.users.{user_uuid}.presences.read` |
| 👤 | `PUT` | `/users/{user_uuid}/presences` | Cập nhật trạng thái (presence) của user | body: `Presence` | `chatd.users.{user_uuid}.presences.update` |

### wazo-chatd · rooms

Phòng chat (1-1, nhóm) và tin nhắn trong phòng.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
| 👤 | `GET` | `/users/me/rooms` | Xem phòng chat | query: `user_uuid` | `chatd.users.me.rooms.read` |
| 👤 | `POST` | `/users/me/rooms` | Tạo phòng chat | body: `Room` | `chatd.users.me.rooms.create` |
| 👤 | `GET` | `/users/me/rooms/messages` | Danh sách tin nhắn trên mọi phòng chat | query: `direction`, `limit`, `order`, `offset`, `search`, `distinct` | `chatd.users.me.rooms.messages.read` |
| 👤 | `GET` | `/users/me/rooms/{room_uuid}/messages` | Danh sách tin nhắn trong phòng chat | query: `from_date`, `direction`, `limit`, `order`, `offset`, `search` | `chatd.users.me.rooms.{room_uuid}.messages.read` |
| 👤 | `POST` | `/users/me/rooms/{room_uuid}/messages` | Gửi tin nhắn vào phòng chat | body: `UserMessagePOST` | `chatd.users.me.rooms.{room_uuid}.messages.create` |

### wazo-chatd · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-chatd |  | `chatd.status.read` |


## wazo-webhookd

**Webhook.** Đăng ký nhận sự kiện Wazo qua HTTP (gọi sang hệ thống khác khi có cuộc gọi, tin nhắn...).

Base URL: `https://<HOST>/api/webhookd/1.0` · Spec: `api-specs/wazo-webhookd.yml` · 16 endpoint, 0 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [config](#wazo-webhookd-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [notifications](#wazo-webhookd-notifications) | 1 | Gửi thông báo push tới mobile. |
| [status](#wazo-webhookd-status) | 1 | Kiểm tra tình trạng dịch vụ. |
| [subscriptions](#wazo-webhookd-subscriptions) | 12 | Đăng ký webhook (quản trị): sự kiện nào gọi URL nào. |

### wazo-webhookd · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `webhookd.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `webhookd.config.update` |

### wazo-webhookd · notifications

Gửi thông báo push tới mobile.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `POST` | `/mobile/notifications` | Gửi push notification tới user | body: `Notification` | `webhookd.mobile.notifications.send` |

### wazo-webhookd · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-webhookd |  | `webhookd.status.read` |

### wazo-webhookd · subscriptions

Đăng ký webhook (quản trị): sự kiện nào gọi URL nào.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/subscriptions` | Danh sách webhook | query: `recurse`, `search_metadata` | `webhookd.subscriptions.read` |
|  | `POST` | `/subscriptions` | Đăng ký webhook (HTTP callback) | body: `SubscriptionRequest` | `webhookd.subscriptions.create` |
|  | `GET` | `/subscriptions/services` | Danh sách dịch vụ có thể đăng ký (webhook) |  | `webhookd.subscriptions.services.read` |
|  | `GET` | `/subscriptions/{subscription_uuid}` | Xem subscription (webhook) |  | `webhookd.subscriptions.{subscription_uuid}.read` |
|  | `PUT` | `/subscriptions/{subscription_uuid}` | Sửa subscription (webhook) | body: `SubscriptionRequest` | `webhookd.subscriptions.{subscription_uuid}.update` |
|  | `DELETE` | `/subscriptions/{subscription_uuid}` | Xoá subscription (webhook) |  | `webhookd.subscriptions.{subscription_uuid}.delete` |
|  | `GET` | `/subscriptions/{subscription_uuid}/logs` | Xem log của hook (webhook) |  | `webhookd.subscriptions.{subscription_uuid}.logs.read` |
|  | `GET` | `/users/me/subscriptions` | Danh sách webhook của user | query: `search_metadata` | `webhookd.users.me.subscriptions.read` |
|  | `POST` | `/users/me/subscriptions` | Đăng ký webhook (HTTP callback) với tư cách user | body: `UserSubscriptionRequest` | `webhookd.users.me.subscriptions.create` |
|  | `GET` | `/users/me/subscriptions/{subscription_uuid}` | Xem subscription của user |  | `webhookd.users.me.subscriptions.{subscription_uuid}.read` |
|  | `PUT` | `/users/me/subscriptions/{subscription_uuid}` | Cập nhật subscription của user | body: `SubscriptionRequest` | `webhookd.users.me.subscriptions.{subscription_uuid}.update` |
|  | `DELETE` | `/users/me/subscriptions/{subscription_uuid}` | Xoá subscription của user |  | `webhookd.users.me.subscriptions.{subscription_uuid}.delete` |


## wazo-agentd

**Agent call center.** Đăng nhập/đăng xuất/tạm dừng agent vào hàng đợi (call center).

Base URL: `https://<HOST>/api/agentd/1.0` · Spec: `api-specs/wazo-agentd.yml` · 23 endpoint, 0 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [agents](#wazo-agentd-agents) | 22 | Đăng nhập/đăng xuất/tạm dừng agent, thêm/bớt agent khỏi hàng đợi. |
| [status](#wazo-agentd-status) | 1 | Kiểm tra tình trạng dịch vụ. |

### wazo-agentd · agents

Đăng nhập/đăng xuất/tạm dừng agent, thêm/bớt agent khỏi hàng đợi.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/agents` | Xem trạng thái tất cả agent | query: `recurse` | `agentd.agents.read` |
|  | `GET` | `/agents/by-id/{agent_id}` | Xem trạng thái agent |  | `agentd.agents.by-id.{agent_id}.read` |
|  | `POST` | `/agents/by-id/{agent_id}/add` | Thêm agent vào queue | body: `Queue` | `agentd.agents.by-id.{agent_id}.add.create` |
|  | `POST` | `/agents/by-id/{agent_id}/login` | Đăng nhập agent | body: `LoginInfo` | `agentd.agents.by-id.{agent_id}.login.create` |
|  | `POST` | `/agents/by-id/{agent_id}/logoff` | Đăng xuất agent |  | `agentd.agents.by-id.{agent_id}.logoff.create` |
|  | `POST` | `/agents/by-id/{agent_id}/remove` | Bỏ agent khỏi queue | body: `Queue` | `agentd.agents.by-id.{agent_id}.remove.create` |
|  | `GET` | `/agents/by-number/{agent_number}` | Xem trạng thái agent |  | `agentd.agents.by-number.{agent_number}.read` |
|  | `POST` | `/agents/by-number/{agent_number}/login` | Đăng nhập agent | body: `LoginInfo` | `agentd.agents.by-number.{agent_number}.login.create` |
|  | `POST` | `/agents/by-number/{agent_number}/logoff` | Đăng xuất agent |  | `agentd.agents.by-number.{agent_number}.logoff.create` |
|  | `POST` | `/agents/by-number/{agent_number}/pause` | Tạm dừng agent | body: `AgentPauseReason` | `agentd.agents.by-number.{agent_number}.pause.create` |
|  | `POST` | `/agents/by-number/{agent_number}/unpause` | Bỏ tạm dừng agent |  | `agentd.agents.by-number.{agent_number}.unpause.create` |
|  | `POST` | `/agents/logoff` | Đăng xuất tất cả agent |  | `agentd.agents.logoff.create` |
|  | `POST` | `/agents/relog` | Đăng nhập lại tất cả agent | query: `all_queues` | `agentd.agents.relog.create` |
|  | `PUT` | `/agents/{agent_id}/queues/{queue_id}/login` | Đăng nhập agent vào queue |  | `agentd.agents.{agent_id}.queues.{queue_id}.login.update` |
|  | `PUT` | `/agents/{agent_id}/queues/{queue_id}/logoff` | Đăng xuất agent khỏi queue |  | `agentd.agents.{agent_id}.queues.{queue_id}.logoff.update` |
|  | `GET` | `/users/me/agents` | Xem trạng thái agent của user đang giữ token |  | `agentd.users.me.agents.read` |
|  | `POST` | `/users/me/agents/login` | Đăng nhập agent của user đang giữ token | body: `UserAgentLoginInfo` | `agentd.users.me.agents.login.create` |
|  | `POST` | `/users/me/agents/logoff` | Đăng xuất agent của user đang giữ token |  | `agentd.users.me.agents.logoff.create` |
|  | `POST` | `/users/me/agents/pause` | Tạm dừng agent của user đang giữ token | body: `AgentPauseReason` | `agentd.users.me.agents.pause.create` |
|  | `PUT` | `/users/me/agents/queues/{queue_id}/login` | Đăng nhập agent của user vào queue |  | `agentd.users.me.agents.queues.{queue_id}.login.update` |
|  | `PUT` | `/users/me/agents/queues/{queue_id}/logoff` | Đăng xuất agent của user khỏi queue |  | `agentd.users.me.agents.queues.{queue_id}.logoff.update` |
|  | `POST` | `/users/me/agents/unpause` | Bỏ tạm dừng agent của user đang giữ token |  | `agentd.users.me.agents.unpause.create` |

### wazo-agentd · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Xem trạng thái wazo-agentd |  | `agentd.status.read` |


## wazo-amid

**Asterisk AMI.** Gửi lệnh trực tiếp tới Asterisk (AMI). Chỉ dành cho quản trị/debug.

Base URL: `https://<HOST>/api/amid/1.0` · Spec: `api-specs/wazo-amid.yml` · 5 endpoint, 0 dùng được bằng token user.

| Nhóm | Số endpoint | Giải thích |
|---|---|---|
| [action](#wazo-amid-action) | 1 | Gửi một action AMI bất kỳ tới Asterisk. |
| [command](#wazo-amid-command) | 1 | Chạy lệnh CLI Asterisk. |
| [config](#wazo-amid-config) | 2 | Xem/sửa cấu hình của dịch vụ. |
| [status](#wazo-amid-status) | 1 | Kiểm tra tình trạng dịch vụ. |

### wazo-amid · action

Gửi một action AMI bất kỳ tới Asterisk.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `POST` | `/action/{action}` | Gửi một action AMI | body: `ActionArguments` | `amid.action.{action}.create` |

### wazo-amid · command

Chạy lệnh CLI Asterisk.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `POST` | `/action/Command` | Chạy lệnh AMI | body: `Command` | `amid.action.Command.create` |

### wazo-amid · config

Xem/sửa cấu hình của dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/config` | Xem cấu hình hiện tại |  | `amid.config.read` |
|  | `PATCH` | `/config` | Cập nhật cấu hình hiện tại | body: `ConfigPatchItem` | `amid.config.update` |

### wazo-amid · status

Kiểm tra tình trạng dịch vụ.

| | Method | Path | Mô tả | Tham số | ACL yêu cầu |
|---|---|---|---|---|---|
|  | `GET` | `/status` | Thông tin trạng thái nội bộ của wazo-amid |  | `amid.status.read` |
