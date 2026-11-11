import { wazoService } from './wazo'

// Mock Data chuẩn doanh nghiệp SDV dự phòng khi chưa có server Wazo LAN hoặc API anh Hải
const MOCK_CONTACTS = [
  {
    id: 'emp-1002',
    name: 'Alice Nguyễn',
    email: 'alice@company.local',
    dept: 'SDV MES 1 / SDV Application Group',
    number: '1002',
    status: 'online',
    unreadCount: 2,
  },
  {
    id: 'emp-1003',
    name: 'Bob Trần',
    email: 'bob@company.local',
    dept: 'SDV MES 2 / Vận hành MFQ/MP',
    number: '1003',
    status: 'online',
    unreadCount: 0,
  },
  {
    id: 'emp-1004',
    name: 'Carol Lê',
    email: 'carol@company.local',
    dept: 'MOS Part (SDV)',
    number: '1004',
    status: 'offline',
    unreadCount: 0,
  },
  {
    id: 'emp-1005',
    name: 'Ngô Tiến Việt (Storm)',
    email: 'viet.ngo@company.local',
    dept: 'SDV MES Development Part',
    number: '1005',
    status: 'online',
    unreadCount: 1,
  },
  {
    id: 'emp-1006',
    name: 'Lương Đức Anh (ducanh)',
    email: 'ducanh.luong@company.local',
    dept: 'SDV MES Development Part',
    number: '1006',
    status: 'online',
    unreadCount: 3,
  },
  {
    id: 'emp-1007',
    name: 'Nguyễn Hữu Hiếu (Kaito)',
    email: 'hieu.nguyen@company.local',
    dept: 'SDV MES Application Group Lead',
    number: '1007',
    status: 'online',
    unreadCount: 0,
  },
]

class ContactService {
  constructor() {
    this.localContacts = [...MOCK_CONTACTS]
  }

  /**
   * Lấy danh bạ nhân viên:
   * 1. Thử gọi API thật của Wazo Dird (hoặc API của anh Hải sau này).
   * 2. Nếu thất bại hoặc đang dev offline -> Tự động dùng Mock Data dự phòng để UI luôn hiển thị đẹp.
   */
  async getContacts() {
    try {
      const token = wazoService.getToken()
      if (!token) throw new Error('No token available')

      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      // 1. Thử lấy nguồn danh bạ Wazo Dird
      const sourceRes = await fetch(
        `${host}/api/dird/0.1/directories/default/sources?backend=wazo`,
        {
          headers: { 'X-Auth-Token': token },
        },
      )

      if (!sourceRes.ok) throw new Error('Cannot fetch sources')
      const sourcesData = await sourceRes.json()
      if (!sourcesData.items || sourcesData.items.length === 0) {
        return this.localContacts
      }

      const sourceUuid = sourcesData.items[0].uuid

      // 2. Thử lấy danh sách liên hệ từ nguồn
      const contactsRes = await fetch(
        `${host}/api/dird/0.1/backends/wazo/sources/${sourceUuid}/contacts?limit=1000`,
        {
          headers: { 'X-Auth-Token': token },
        },
      )

      if (!contactsRes.ok) throw new Error('Cannot fetch contacts')
      const contactsData = await contactsRes.json()

      // Map dữ liệu Wazo sang schema chuẩn của hệ thống
      return contactsData.items.map((item, index) => ({
        id: item.uuid || `wazo-${index}`,
        name: item.name || 'Ẩn danh',
        email: item.email || '',
        dept: item.department || 'Nhân viên SDV',
        number: item.number || item.phone_number || '',
        status: 'online',
        unreadCount: 0,
      }))
    } catch (err) {
      // Khi dev offline hoặc chưa có server -> Fallback dữ liệu mock
      return this.localContacts
    }
  }

  /**
   * Xóa một liên hệ khỏi danh bạ gần đây
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
      ...contact,
    })
    return true
  }
}

export const contactService = new ContactService()
