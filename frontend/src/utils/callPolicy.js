/** Chuẩn hóa máy lẻ trước khi so sánh hoặc gửi sang SDK. */
export function normalizeExtension(value) {
  return String(value || '')
    .split('@')[0]
    .trim()
}

/** Policy gọi một-một dùng chung. Trả null khi được phép, không tự hiển thị toast. */
export function getContactCallRestriction(contact) {
  const state = contact?.status
  const label = contact?.name || contact?.number || 'Người nhận'
  if (['busy', 'talking', 'holding'].includes(state))
    return { reason: 'TARGET_BUSY', message: label + ' đang trong cuộc gọi khác.' }
  if (['ringing', 'progressing'].includes(state))
    return { reason: 'TARGET_RINGING', message: label + ' đang nhận cuộc gọi khác.' }
  if (state === 'dnd')
    return { reason: 'TARGET_DND', message: label + ' đang bật Không làm phiền.' }
  if (['offline', 'unavailable'].includes(state))
    return { reason: 'TARGET_OFFLINE', message: label + ' đang ngoại tuyến. Vui lòng gọi lại sau.' }
  return null
}
