/** Chuyển thời điểm CDR sang giờ cục bộ của trình duyệt để hiển thị. */
function formatCdrDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').substring(0, 19)
  /** Thêm số 0 ở đầu để các phần giờ/phút/giây có đủ hai chữ số khi hiển thị. */
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Chuẩn hóa CDR server; cuộc gọi nội bộ xác định chiều theo máy lẻ nguồn. */
export function mapCallHistoryRecord(cdr, { myExtension = '', index = 0 } = {}) {
  const outbound =
    cdr.call_direction === 'outbound' ||
    (cdr.call_direction !== 'inbound' &&
      String(cdr.source_extension || '').trim() === String(myExtension).trim())
  const answered = Boolean(cdr.answered)
  const extension = (outbound ? cdr.destination_extension : cdr.source_extension) || ''
  const name =
    (outbound ? cdr.destination_name : cdr.source_name) ||
    (extension ? `Máy lẻ ${extension}` : 'Số ngoài')
  const status = answered ? 'success' : outbound ? 'declined' : 'missed'
  const recordings = cdr.recordings || []
  return {
    id: cdr.id || `cdr-${index}`,
    date: formatCdrDate(cdr.start),
    name,
    extension,
    dept: 'Nội bộ công ty',
    duration: cdr.duration || 0,
    direction: outbound ? 'outbound' : 'inbound',
    directionLabel: outbound ? 'Outgoing' : 'Incoming',
    status,
    statusLabel: answered ? 'Success' : outbound ? 'Declined' : 'Missed',
    answered,
    recordings,
    hasRecording: recordings.length > 0,
  }
}
