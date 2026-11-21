/**
 * Chuẩn hóa hồ sơ tại một cổng vào từ SDK và Confd.
 * UUID và máy lẻ chỉ lấy từ dữ liệu xác thực, không dùng số giả mặc định.
 */
export function mapUserProfile(session, confdUser = {}, username = '') {
  const sdkProfile = session?.profile || {}
  let sdkNumber = ''
  try {
    sdkNumber = session?.primaryNumber?.() || ''
  } catch {
    /* SDK có thể chưa có line. */
  }
  const sdkName = [sdkProfile.firstName, sdkProfile.lastName].filter(Boolean).join(' ').trim()
  const confdName = [confdUser.firstname, confdUser.lastname].filter(Boolean).join(' ').trim()
  let displayName = ''
  try {
    displayName =
      typeof session?.displayName === 'function'
        ? session.displayName()
        : session?.displayName || ''
  } catch {
    /* Ưu tiên profile nếu SDK chưa có display name. */
  }
  return {
    userUuid: session?.uuid || confdUser.uuid || '',
    extension: String(sdkNumber || confdUser.lines?.[0]?.extensions?.[0]?.exten || ''),
    displayName: sdkName || confdName || displayName || username,
    department:
      sdkProfile.department ||
      confdUser.department ||
      confdUser.society ||
      confdUser.title ||
      (String(confdUser.userfield || '').startsWith('smartcall:sso:') ? '' : confdUser.userfield) ||
      confdUser.description ||
      '',
  }
}

/** Đổi lỗi xác thực thành thông báo dễ hiểu; không phát lộ token hoặc nội dung request. */
export function getAuthenticationErrorMessage(error) {
  if (error.status === 401 || /401|unauthorized|credentials/i.test(error.message || ''))
    return 'Tên đăng nhập hoặc mật khẩu không chính xác.'
  if (/timeout|hết thời gian/i.test(error.message || ''))
    return 'Không thể kết nối đến tổng đài trong thời gian chờ.'
  if (error.name === 'TypeError' || /network|failed to fetch/i.test(error.message || ''))
    return 'Không kết nối được tổng đài. Vui lòng kiểm tra mạng và chứng chỉ.'
  return error.message || 'Đăng nhập không thành công. Vui lòng thử lại.'
}
