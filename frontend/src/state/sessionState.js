import { reactive } from 'vue'

/** Hồ sơ của phiên Web; tách khỏi trạng thái đăng ký SIP và dữ liệu nghiệp vụ. */
export const userSessionState = reactive({
  extension: localStorage.getItem('smartcall_extension') || '',
  userUuid: localStorage.getItem('smartcall_user_uuid') || '',
  displayName: localStorage.getItem('smartcall_username') || '',
  department: localStorage.getItem('smartcall_department') || '',
  hasEmployeeAvatar: false,
})
