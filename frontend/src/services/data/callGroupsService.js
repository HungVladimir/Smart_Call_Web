import { requestSmartCall } from '../common/smartCallApi.js'

/** Lấy các nhóm cá nhân đã được backend lưu theo phiên Wazo hiện tại. */
export async function listCallGroups(token) {
  return (await requestSmartCall('call-groups', token)).items
}

/** Tạo hoặc sửa nhóm, chỉ trả bản lưu khi backend đã xác nhận. */
export function saveCallGroup(token, id, name, members) {
  return requestSmartCall(id ? 'call-groups/' + encodeURIComponent(id) : 'call-groups', token, {
    method: id ? 'PUT' : 'POST',
    body: { name, members },
  })
}

/** Xóa cấu hình nhóm đã lưu, không tác động hội nghị đang diễn ra. */
export function deleteCallGroup(token, id) {
  return requestSmartCall('call-groups/' + encodeURIComponent(id), token, { method: 'DELETE' })
}
