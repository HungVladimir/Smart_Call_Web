import { wazoService } from './wazo'
import { isFeatureEnabled } from '@/config/features'
import { logger } from './loggerService'

class ContactService {
  constructor() {
    this.localContacts = []
    this.cachedContacts = null
    this.presencePollTimer = null

    if (typeof window !== 'undefined') {
      window.addEventListener('wazo-presence-updated', (ev) => {
        if (ev.detail) {
          this.updateSinglePresence(ev.detail)
        }
      })
    }
    this.startPresencePolling()
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
  async getContacts({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.cachedContacts && this.cachedContacts.length > 0) {
      return this.cachedContacts
    }
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
        const mappedList = contactsData.items.map((item, index) => {
          const userUuid = item.user_uuid || item.uuid || (typeof item.relations === 'object' && item.relations?.user_uuid) || null
          const id = userUuid || item.id || `wazo-${index}`

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
            uuid: userUuid,
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline', // Sẽ được cập nhật bằng presence thật từ chatd bên dưới
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        return this._filterAndCache(finalContacts)
      }

      // Trường hợp 2: Dạng bảng cột (column_types & results)
      if (Array.isArray(contactsData.results) && Array.isArray(contactsData.column_types)) {
        const cols = contactsData.column_types
        const mappedList = contactsData.results.map((r, index) => {
          const getVal = (colName) => {
            const idx = cols.indexOf(colName)
            return idx !== -1 ? r.column_values[idx] : null
          }
          const userUuid = r.relations?.user_uuid || null
          const id = userUuid || `wazo-${index}`
          const fn = (getVal('firstname') || '').trim()
          const ln = (getVal('lastname') || '').trim()
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()
          const name = getVal('name') || fullName || getVal('display_name') || 'Ẩn danh'
          const number = getVal('number') || getVal('callable') || getVal('exten') || ''
          const email = getVal('email') || ''
          const dept = getVal('department') || getVal('userfield') || 'Khối Kỹ thuật'

          return {
            id,
            uuid: userUuid,
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        return this._filterAndCache(finalContacts)
      }

      return this.localContacts.map((c) => ({
        ...c,
        isFavorite: favorites.includes(c.id),
      }))
    } catch (err) {
      logger.warn('API', 'Không thể nạp danh bạ từ máy chủ Wazo:', err.message)
      return this.localContacts.map((c) => ({
        ...c,
        isFavorite: favorites.includes(c.id),
      }))
    }
  }

  _filterAndCache(list) {
    const meUuid = wazoService.session?.uuid || localStorage.getItem('smartcall_user_uuid')
    const meExten = wazoService.getMyExtension()
    let filtered = list
    if (meUuid || meExten) {
      filtered = list.filter((c) => {
        if (meUuid && c.uuid && c.uuid === meUuid) return false
        if (meExten && c.number && String(c.number).trim() === String(meExten).trim()) return false
        return true
      })
    }
    this.cachedContacts = filtered
    return filtered
  }

  /**
   * Tải trạng thái hiện diện (Presence) thời gian thực của danh sách nhân sự từ Wazo Chatd
   * GET /api/chatd/1.0/users/presences?user_uuid=...
   */
  async loadPresencesForContacts(contacts) {
    if (!Array.isArray(contacts) || contacts.length === 0) return contacts
    const token = wazoService.getToken()
    if (!token) return contacts

    const host = wazoService.host.startsWith('http') ? wazoService.host : `https://${wazoService.host}`
    const uuids = contacts
      .map((c) => c.uuid || c.id)
      .filter((id) => id && String(id).includes('-') && !String(id).startsWith('emp-') && !String(id).startsWith('wazo-'))

    if (uuids.length === 0) return contacts

    try {
      // Dùng dấu phẩy nguyên bản uuids.join(',') theo mã tham chiếu mẫu (tránh %2C)
      const res = await fetch(`${host}/api/chatd/1.0/users/presences?user_uuid=${uuids.join(',')}`, {
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      })
      if (!res.ok) return contacts

      const data = await res.json()
      const presences = {}
      ;(data.items || []).forEach((p) => {
        const u = p.uuid || p.user_uuid
        if (u) presences[u] = p
      })

      contacts.forEach((c) => {
        const p = presences[c.uuid || c.id]
        if (p) {
          const lines = (p.lines || []).map((l) => l.state)
          if (lines.some((s) => s === 'talking' || s === 'holding')) {
            c.status = 'busy'
          } else if (lines.some((s) => s === 'ringing' || s === 'progressing')) {
            c.status = 'ringing'
          } else if (p.do_not_disturb) {
            c.status = 'dnd'
          } else if (p.state === 'away') {
            c.status = 'away'
          } else {
            const isLineOnline = lines.length ? lines.some((s) => s !== 'unavailable') : false
            const isUserOnline = p.state === 'available' || p.connected === true
            const online = isLineOnline || isUserOnline
            c.status = online ? 'online' : 'offline'
          }
        }
      })
      logger.info('API', `Đã cập nhật trạng thái Presence thật cho ${data.items?.length || 0} nhân sự từ Wazo Chatd`)
    } catch (e) {
      logger.warn('API', 'Không thể nạp trạng thái presence từ chatd:', e.message)
    }
    return contacts
  }

  updateSinglePresence(presenceRecord) {
    if (!this.cachedContacts || !presenceRecord) return
    const uuid = presenceRecord.uuid || presenceRecord.user_uuid
    if (!uuid) return

    let changed = false
    this.cachedContacts.forEach((c) => {
      if (c.uuid === uuid || c.id === uuid) {
        const lines = (presenceRecord.lines || []).map((l) => l.state)
        let newStatus = 'offline'
        if (lines.some((s) => s === 'talking' || s === 'holding')) {
          newStatus = 'busy'
        } else if (lines.some((s) => s === 'ringing' || s === 'progressing')) {
          newStatus = 'ringing'
        } else if (presenceRecord.do_not_disturb) {
          newStatus = 'dnd'
        } else if (presenceRecord.state === 'away') {
          newStatus = 'away'
        } else {
          const isLineOnline = lines.length ? lines.some((s) => s !== 'unavailable') : false
          const isUserOnline = presenceRecord.state === 'available' || presenceRecord.connected === true
          const online = isLineOnline || isUserOnline
          newStatus = online ? 'online' : 'offline'
        }
        if (c.status !== newStatus) {
          c.status = newStatus
          changed = true
        }
      }
    })

    if (changed) {
      window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
    }
  }

  startPresencePolling() {
    if (this.presencePollTimer) return
    this.presencePollTimer = setInterval(async () => {
      if (this.cachedContacts && this.cachedContacts.length > 0 && wazoService.isLogged()) {
        await this.loadPresencesForContacts(this.cachedContacts)
        window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
      }
    }, 10000)
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
    const pool = [
      ...(Array.isArray(this.cachedContacts) ? this.cachedContacts : []),
      ...(Array.isArray(this.localContacts) ? this.localContacts : []),
    ]
    return (
      pool.find(
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
