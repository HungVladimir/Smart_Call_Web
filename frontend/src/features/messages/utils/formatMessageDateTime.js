/**
 * Định dạng thời gian tin nhắn chuẩn xác theo giờ Việt Nam / Trình duyệt cục bộ (HH:mm DD/MM/YYYY)
 * Ví dụ: "10:30 16/11/2026"
 */
export const formatMessageDateTime = (isoOrTimestamp) => {
  if (!isoOrTimestamp) return ''
  let d
  if (isoOrTimestamp instanceof Date) {
    d = isoOrTimestamp
  } else if (typeof isoOrTimestamp === 'number') {
    d = new Date(isoOrTimestamp)
  } else if (typeof isoOrTimestamp === 'string') {
    let str = isoOrTimestamp.trim()
    if (/^\d{10,13}$/.test(str)) {
      d = new Date(Number(str.length === 10 ? str + '000' : str))
    } else {
      // Đảm bảo parse chuẩn UTC nếu chuỗi ISO từ server chưa có Z hoặc múi giờ (+00:00)
      if (str.includes('T') && !str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
        str += 'Z'
      } else if (!str.includes('T') && str.includes(' ') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
        str = str.replace(' ', 'T') + 'Z'
      }
      d = new Date(str)
    }
  } else {
    d = new Date(isoOrTimestamp)
  }

  if (isNaN(d.getTime())) return String(isoOrTimestamp)
  const pad = (n) => String(n).padStart(2, '0')
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  const day = pad(d.getDate())
  const month = pad(d.getMonth() + 1)
  const year = d.getFullYear()
  return `${hours}:${minutes} ${day}/${month}/${year}`
}
