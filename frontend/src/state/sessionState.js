import { reactive } from 'vue'

/**
 * Đọc giá trị đầu tiên không rỗng từ localStorage theo thứ tự khóa ưu tiên; dùng nội bộ để ưu
 * tiên khóa chuẩn nhưng vẫn tương thích dữ liệu phiên cũ.
 */
function readStoredSessionValue(...keys) {
  for (const key of keys) {
    const value = localStorage.getItem(key)
    if (value) return value
  }
  return ''
}

/** Hồ sơ của phiên Web; tách khỏi trạng thái đăng ký SIP và dữ liệu nghiệp vụ. */
export const userSessionState = reactive({
  extension: readStoredSessionValue('smartcall_extension', 'smartcall_user_exten'),
  userUuid: readStoredSessionValue('smartcall_user_uuid'),
  displayName: readStoredSessionValue('smartcall_username'),
  department: readStoredSessionValue('smartcall_department', 'smartcall_user_department'),
  email: '',
})
