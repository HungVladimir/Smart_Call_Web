/** Chuẩn hóa tên để lọc tiếng Việt trong tập mục đã tải, không đổi từ khóa gửi lên Wazo. */
export function normalizeDirectoryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .trim()
}

/** Chuyển một hàng bảng cột Dird thành object trung gian giữ đủ liên kết UUID và nguồn. */
function mapDirectoryTableRow(columnTypes, row) {
  /** Ghép tên cột của Wazo Dird với giá trị cùng vị trí trong hàng hiện tại. */
  function readColumnEntry(column, index) {
    return [column, row.column_values?.[index]]
  }
  return {
    ...Object.fromEntries(columnTypes.map(readColumnEntry)),
    id: row.relations?.source_entry_id || row.id || row.column_values?.[columnTypes.indexOf('id')],
    uuid:
      row.relations?.user_uuid || row.user_uuid || row.column_values?.[columnTypes.indexOf('uuid')],
    source: row.source || row.backend,
    favorited: row.favorited,
  }
}

/** Chuẩn hóa một mục danh bạ thô của Wazo thành cấu trúc liên hệ thống nhất cho Web. */
function mapDirectoryContactItem(item, index, { favoriteIds, defaultSource }) {
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
      item.number_office ||
      item.phone_number ||
      (typeof firstNumber === 'object' ? firstNumber?.number || firstNumber?.exten : firstNumber) ||
      item.lines?.[0]?.extensions?.[0]?.exten ||
      '',
  )
  // description là nguồn phòng ban chính; userfield chỉ giữ liên kết SSO kỹ thuật.
  const description = String(item.description || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')

  /** Kiểm tra xem định danh hợp lệ của liên hệ có nằm trong tập yêu thích hiện tại không. */
  function matchesFavoriteId(value) {
    return Boolean(value && favoriteIds.includes(value))
  }

  return {
    id,
    rawId,
    uuid,
    name,
    number,
    source: item.source || item.backend || defaultSource,
    email: item.email || item.emails?.[0]?.email || item.emails?.[0]?.address || '',
    employeeId: String(item.employee_id || item.epId || ''),
    description,
    departmentState: item.department_state,
    dept:
      item.department_state === 'empty'
        ? ''
        : description || item.department || item.society || item.title || '',
    status: 'offline',
    statusLabel: 'Ngoại tuyến',
    isMobileApp: false,
    isFavorite: Boolean(item.favorited) || [id, uuid, rawId, number].some(matchesFavoriteId),
  }
}

/**
 * Chuẩn hóa hai dạng phản hồi Dird (items hoặc bảng cột) thành Contact dùng cho Web.
 * Hàm thuần: không gọi API, không sửa state và không ghi localStorage.
 */
export function mapDirectoryContacts(data, { favoriteIds = [], defaultSource = 'wazo_user' } = {}) {
  let items
  if (Array.isArray(data?.items)) {
    items = data.items
  } else if (Array.isArray(data?.results) && Array.isArray(data?.column_types)) {
    /** Chuẩn hóa từng hàng bảng cột theo schema column_types do Wazo trả về. */
    function toDirectoryRow(row) {
      return mapDirectoryTableRow(data.column_types, row)
    }
    items = data.results.map(toDirectoryRow)
  } else {
    return null // null: schema không hỗ trợ; []: máy chủ trả danh sách rỗng hợp lệ.
  }

  /** Áp dụng cấu hình yêu thích và nguồn mặc định lên từng bản ghi sau chuẩn hóa. */
  function toContact(item, index) {
    return mapDirectoryContactItem(item, index, { favoriteIds, defaultSource })
  }
  return items.map(toContact)
}
