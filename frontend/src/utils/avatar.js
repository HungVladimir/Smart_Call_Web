/** Hai chữ cái cuối theo quy ước avatar của màn hình gọi điện. */
export function getAvatarInitials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(-2)
    .toUpperCase()
}
/** Màu avatar ổn định từ tên; không phụ thuộc dữ liệu lưu trữ hoặc API. */
export function getAvatarColor(name) {
  let hash = 0
  for (let index = 0; index < (name || '').length; index++)
    hash = name.charCodeAt(index) + ((hash << 5) - hash)
  return 'hsl(' + Math.abs(hash % 360) + ', 65%, 48%)'
}
