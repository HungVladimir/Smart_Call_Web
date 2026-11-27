const ALLOWED_AVATAR_SIZES = new Set(['sm', 'md', 'lg', 'xl', 'org'])
const KNOX_ID_PATTERN = /^[a-zA-Z0-9._-]+$/

/** Trích idKnox (phần trước @ của email) và kiểm tra ký tự hợp lệ trước khi dựng URL ảnh. */
export function extractKnoxId(emailOrId) {
  const raw = String(emailOrId || '').trim()
  if (!raw) return ''
  const knoxId = raw.includes('@') ? raw.split('@', 1)[0].trim() : raw
  if (
    !knoxId ||
    knoxId.length > 128 ||
    knoxId === '.' ||
    knoxId === '..' ||
    !KNOX_ID_PATTERN.test(knoxId)
  ) {
    return ''
  }
  return knoxId
}

/** Dựng URL proxy /api/avatar cùng origin cho Web; trả chuỗi rỗng nếu chưa có idKnox hợp lệ. */
export function buildAvatarUrl(emailOrId, size = 'sm') {
  const knoxId = extractKnoxId(emailOrId)
  if (!knoxId) return ''
  const normalizedSize = String(size || 'sm')
    .trim()
    .toLowerCase()
  const safeSize = ALLOWED_AVATAR_SIZES.has(normalizedSize) ? normalizedSize : 'sm'
  return `/api/avatar?id=${encodeURIComponent(knoxId)}&size=${encodeURIComponent(safeSize)}`
}

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
