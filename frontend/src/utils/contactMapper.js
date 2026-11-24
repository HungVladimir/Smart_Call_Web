/** Chuẩn hóa tên để lọc tiếng Việt trong tập mục đã tải, không đổi từ khóa gửi lên Wazo. */
export function normalizeDirectoryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .trim()
}

/**
 * Chuẩn hóa hai dạng phản hồi Dird (items hoặc bảng cột) thành Contact dùng cho Web.
 * Hàm thuần: không gọi API, không sửa state và không ghi localStorage.
 */
export function mapDirectoryContacts(data, { favoriteIds = [], defaultSource = 'wazo_user' } = {}) {
  let items
  if (Array.isArray(data?.items)) items = data.items
  else if (Array.isArray(data?.results) && Array.isArray(data?.column_types)) {
    items = data.results.map((row) => ({
      ...Object.fromEntries(
        data.column_types.map((column, index) => [column, row.column_values?.[index]]),
      ),
      id:
        row.relations?.source_entry_id ||
        row.id ||
        row.column_values?.[data.column_types.indexOf('id')],
      uuid: row.relations?.user_uuid,
      source: row.source || row.backend,
      favorited: row.favorited,
    }))
  } else return null // null: schema không hỗ trợ; []: máy chủ trả danh sách rỗng hợp lệ.
  return items.map((item, index) => {
    const uuid = item.uuid || item.user_uuid || item.relations?.user_uuid || null
    const rawId = String(item.id || item.contact_id || uuid || '')
    const id = uuid || rawId || `wazo-${index}`
    const firstName = (item.firstname || item.firstName || '').trim()
    const lastName = (item.lastname || item.lastName || '').trim()
    const name =
      [firstName, lastName].filter(Boolean).join(' ') ||
      item.name ||
      item.display_name ||
      item.displayName ||
      item.username ||
      'Ẩn danh'
    const firstNumber = item.numbers?.[0]
    const number = String(
      item.exten ||
        item.extension ||
        item.number ||
        item.callable ||
        item.phone_number ||
        (typeof firstNumber === 'object'
          ? firstNumber?.number || firstNumber?.exten
          : firstNumber) ||
        item.lines?.[0]?.extensions?.[0]?.exten ||
        '',
    )
    // description là nguồn phòng ban chính; userfield chỉ giữ liên kết SSO kỹ thuật.
    const description = String(item.description || '')
      .normalize('NFC')
      .trim()
      .replace(/\s+/g, ' ')
    return {
      id,
      rawId,
      uuid,
      name,
      number,
      source: item.source || item.backend || defaultSource,
      email: item.email || item.emails?.[0]?.email || '',
      description,
      dept: description || item.department || item.society || item.title || '',
      status: 'offline',
      statusLabel: 'Ngoại tuyến',
      isMobileApp: false,
      isFavorite:
        Boolean(item.favorited) ||
        [id, uuid, rawId, number].some((value) => value && favoriteIds.includes(value)),
    }
  })
}
