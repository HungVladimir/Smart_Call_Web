import { wazoService } from './wazo'

// Dữ liệu danh bạ mẫu chuẩn doanh nghiệp
const MOCK_CONTACTS = [
  {
    id: 'emp-1002',
    name: 'Nguyễn Văn An',
    email: 'an.nguyen@company.local',
    dept: 'Khối Kỹ thuật / Nhóm Ứng dụng',
    number: '1002',
    status: 'online',
    unreadCount: 2,
  },
  {
    id: 'emp-1003',
    name: 'Trần Văn Bình',
    email: 'binh.tran@company.local',
    dept: 'Khối Vận hành / Phân xưởng MFQ',
    number: '1003',
    status: 'online',
    unreadCount: 0,
  },
  {
    id: 'emp-1004',
    name: 'Lê Cẩm Tú',
    email: 'tu.le@company.local',
    dept: 'Khối Quản trị Chất lượng',
    number: '1004',
    status: 'offline',
    unreadCount: 0,
  },
  {
    id: 'emp-1005',
    name: 'Ngô Tiến Việt',
    email: 'viet.ngo@company.local',
    dept: 'Phòng Phát triển Phần mềm',
    number: '1005',
    status: 'online',
    unreadCount: 1,
  },
  {
    id: 'emp-1006',
    name: 'Lương Đức Anh',
    email: 'ducanh.luong@company.local',
    dept: 'Phòng Phát triển Phần mềm',
    number: '1006',
    status: 'online',
    unreadCount: 3,
  },
  {
    id: 'emp-1007',
    name: 'Nguyễn Hữu Hiếu',
    email: 'hieu.nguyen@company.local',
    dept: 'Trưởng nhóm Phát triển Hệ thống',
    number: '1007',
    status: 'online',
    unreadCount: 0,
  },
]

class ContactService {
  constructor() {
    this.localContacts = [...MOCK_CONTACTS]
  }

  // Quản lý danh sách Yêu thích (Favorites)
  getFavoriteIds() {
    try {
      const raw = localStorage.getItem('smartcall_favorites')
      return raw ? JSON.parse(raw) : ['emp-1002', 'emp-1007']
    } catch (e) {
      return ['emp-1002']
    }
  }

  toggleFavorite(id) {
    const list = this.getFavoriteIds()
    const idx = list.indexOf(id)
    if (idx !== -1) {
      list.splice(idx, 1)
    } else {
      list.push(id)
    }
    localStorage.setItem('smartcall_favorites', JSON.stringify(list))
    return list.includes(id)
  }

  isFavorite(id) {
    return this.getFavoriteIds().includes(id)
  }

  /**
   * Lấy danh bạ toàn bộ nhân viên:
   * 1. Thử gọi API máy chủ tổng đài Wazo Dird.
   * 2. Nếu không có kết nối máy chủ -> Sử dụng dữ liệu dự phòng.
   */
  async getContacts() {
    const favorites = this.getFavoriteIds()
    try {
      const token = wazoService.getToken()
      if (!token) throw new Error('No token available')

      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      // 1. Lấy nguồn danh bạ tổng đài (Cách 1)
      let contactsData = null
      try {
        const sourceRes = await fetch(
          `${host}/api/dird/0.1/directories/default/sources?backend=wazo`,
          {
            headers: { 'X-Auth-Token': token },
          },
        )

        if (sourceRes.ok) {
          const sourcesData = await sourceRes.json()
          const sourceUuid = sourcesData.items?.[0]?.uuid
          if (sourceUuid) {
            // Lấy toàn bộ danh sách liên hệ từ nguồn (lấy full danh bạ)
            const contactsRes = await fetch(
              `${host}/api/dird/0.1/backends/wazo/sources/${sourceUuid}/contacts?limit=1000`,
              {
                headers: { 'X-Auth-Token': token },
              },
            )
            if (contactsRes.ok) {
              contactsData = await contactsRes.json()
            }
          }
        }
      } catch (srcErr) {
        console.warn('Lỗi lấy nguồn danh bạ wazo dird:', srcErr)
      }

      // 2. Cách 2: Dự phòng tra cứu lookup/default (theo mã nguồn tham chiếu mẫu)
      if (!contactsData) {
        try {
          const lookupRes = await fetch(
            `${host}/api/dird/0.1/directories/lookup/default?term=1`,
            {
              headers: { 'X-Auth-Token': token },
            },
          )
          if (lookupRes.ok) {
            contactsData = await lookupRes.json()
          }
        } catch (lookErr) {
          console.warn('Lỗi tra cứu danh bạ lookup:', lookErr)
        }
      }

      if (!contactsData) {
        return this.localContacts.map((c) => ({
          ...c,
          isFavorite: favorites.includes(c.id),
        }))
      }

      // Xử lý dữ liệu trả về từ Wazo Dird:
      // Trường hợp 1: Dạng danh sách đối tượng (items)
      if (Array.isArray(contactsData.items) && contactsData.items.length > 0) {
        return contactsData.items.map((item, index) => {
          const id = item.uuid || item.id || `wazo-${index}`

          // 1. Tên hiển thị: Wazo Dird trả firstname và lastname riêng biệt
          const fn = (item.firstname || item.firstName || '').trim()
          const ln = (item.lastname || item.lastName || '').trim()
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()

          let name = item.name || fullName || item.display_name || item.displayName || item.username
          if (!name && item.email) {
            const userPrefix = item.email.split('@')[0]
            name = userPrefix.charAt(0).toUpperCase() + userPrefix.slice(1)
          }
          if (!name) name = 'Ẩn danh'

          // 2. Số máy lẻ: Wazo Dird lưu máy lẻ trong trường 'exten' (hoặc extension, number, mobile_phone_number)
          let number =
            item.exten ||
            item.extension ||
            item.number ||
            item.phone_number ||
            item.mobile_phone_number ||
            ''

          // Fallback nếu số nằm trong mảng numbers hoặc lines
          if (!number && Array.isArray(item.numbers) && item.numbers.length > 0) {
            const first = item.numbers[0]
            number = typeof first === 'object' ? (first.number || first.exten || '') : first
          }
          if (!number && Array.isArray(item.lines) && item.lines.length > 0) {
            number = item.lines[0]?.extensions?.[0]?.exten || ''
          }

          // 3. Email & Khối phòng ban
          const email = item.email || (Array.isArray(item.emails) && item.emails[0]?.email) || ''
          const dept = item.department || item.userfield || item.description || 'Khối Kỹ thuật'

          return {
            id,
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'online',
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
      }

      // Trường hợp 2: Dạng bảng cột (column_types & results)
      if (Array.isArray(contactsData.results) && Array.isArray(contactsData.column_types)) {
        const cols = contactsData.column_types
        return contactsData.results.map((r, index) => {
          const getVal = (colName) => {
            const idx = cols.indexOf(colName)
            return idx !== -1 ? r.column_values[idx] : null
          }
          const id = r.relations?.user_uuid || `wazo-${index}`
          const fn = (getVal('firstname') || '').trim()
          const ln = (getVal('lastname') || '').trim()
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()
          const name = getVal('name') || fullName || getVal('display_name') || 'Ẩn danh'
          const number = getVal('number') || getVal('callable') || getVal('exten') || ''
          const email = getVal('email') || ''
          const dept = getVal('department') || getVal('userfield') || 'Khối Kỹ thuật'

          return {
            id,
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'online',
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
      }

      return this.localContacts.map((c) => ({
        ...c,
        isFavorite: favorites.includes(c.id),
      }))
    } catch (err) {
      return this.localContacts.map((c) => ({
        ...c,
        isFavorite: favorites.includes(c.id),
      }))
    }
  }

  /**
   * Xóa một liên hệ khỏi danh bạ
   */
  async deleteContact(id) {
    const idx = this.localContacts.findIndex((c) => c.id === id)
    if (idx !== -1) {
      this.localContacts.splice(idx, 1)
      window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
      return true
    }
    return false
  }

  /**
   * Tìm kiếm thông tin liên hệ theo số máy lẻ
   */
  findContactByExtension(ext) {
    if (!ext) return null
    const str = String(ext).trim()
    return (
      this.localContacts.find(
        (c) => String(c.number).trim() === str || String(c.id).includes(str),
      ) || null
    )
  }

  /**
   * Thêm liên hệ mới
   */
  async addContact(contact) {
    this.localContacts.unshift({
      id: `custom-${Date.now()}`,
      status: 'offline',
      unreadCount: 0,
      isFavorite: false,
      ...contact,
    })
    return true
  }
}

export const contactService = new ContactService()
