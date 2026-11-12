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

      // 1. Lấy nguồn danh bạ tổng đài
      const sourceRes = await fetch(
        `${host}/api/dird/0.1/directories/default/sources?backend=wazo`,
        {
          headers: { 'X-Auth-Token': token },
        },
      )

      if (!sourceRes.ok) throw new Error('Cannot fetch sources')
      const sourcesData = await sourceRes.json()
      if (!sourcesData.items || sourcesData.items.length === 0) {
        return this.localContacts.map((c) => ({
          ...c,
          isFavorite: favorites.includes(c.id),
        }))
      }

      const sourceUuid = sourcesData.items[0].uuid

      // 2. Lấy toàn bộ danh sách liên hệ từ nguồn (lấy full danh bạ)
      const contactsRes = await fetch(
        `${host}/api/dird/0.1/backends/wazo/sources/${sourceUuid}/contacts?limit=1000`,
        {
          headers: { 'X-Auth-Token': token },
        },
      )

      if (!contactsRes.ok) throw new Error('Cannot fetch contacts')
      const contactsData = await contactsRes.json()

      return contactsData.items.map((item, index) => {
        const id = item.uuid || `wazo-${index}`
        return {
          id,
          name: item.name || 'Ẩn danh',
          email: item.email || '',
          dept: item.department || 'Khối Kỹ thuật',
          number: item.number || item.phone_number || '',
          status: 'online',
          unreadCount: 0,
          isFavorite: favorites.includes(id),
        }
      })
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
      return true
    }
    return false
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
