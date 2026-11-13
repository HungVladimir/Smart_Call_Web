import { wazoService } from './wazo'
import { isFeatureEnabled } from '@/config/features'
import { logger } from './loggerService'

class ContactService {
  constructor() {
    this.localContacts = []
    this.currentContacts = []
    this.presences = {}
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
   * Tính toán trạng thái hiển thị của một User từ bản ghi Presence
   * Chuẩn 100% theo mã nguồn tham chiếu mẫu của Wazo
   */
  statusOf(uuid) {
    const p = uuid && this.presences[uuid]
    if (!p) return { key: 'offline', label: 'Ngoại tuyến' }
    const lines = (p.lines || []).map((l) => l.state)
    if (lines.some((s) => s === 'talking' || s === 'holding'))
      return { key: 'busy', label: 'Đang gọi' }
    if (lines.some((s) => s === 'ringing' || s === 'progressing'))
      return { key: 'ringing', label: 'Đang đổ chuông' }
    if (p.do_not_disturb) return { key: 'dnd', label: 'Không làm phiền' }
    const online = lines.length
      ? lines.some((s) => s !== 'unavailable')
      : p.connected === true
    if (!online) return { key: 'offline', label: 'Ngoại tuyến' }
    if (p.state === 'away') return { key: 'away', label: 'Vắng mặt' }
    return { key: 'online', label: 'Trực tuyến' }
  }

  /**
   * Lấy danh bạ toàn bộ nhân viên trực tiếp từ Wazo (Bỏ hoàn toàn cache)
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
            // Lấy toàn bộ danh sách liên hệ từ nguồn (limit=1000)
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

      // 2. Cách 2: Dự phòng tra cứu lookup/default
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
          const userUuid = item.uuid || item.user_uuid || (typeof item.relations === 'object' && item.relations?.user_uuid) || null
          const id = userUuid || item.id || `wazo-${index}`

          const fn = (item.firstname || item.firstName || '').trim()
          const ln = (item.lastname || item.lastName || '').trim()
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()
          const name = fullName || item.name || item.display_name || item.displayName || item.username || 'Ẩn danh'

          let number = item.exten || item.extension || item.number || item.phone_number || ''
          if (!number && Array.isArray(item.numbers) && item.numbers.length > 0) {
            const first = item.numbers[0]
            number = typeof first === 'object' ? (first.number || first.exten || '') : first
          }
          if (!number && Array.isArray(item.lines) && item.lines.length > 0) {
            number = item.lines[0]?.extensions?.[0]?.exten || ''
          }

          const email = item.email || (Array.isArray(item.emails) && item.emails[0]?.email) || ''
          const dept = item.department || item.userfield || item.description || 'Khối Kỹ thuật'

          return {
            id,
            uuid: userUuid,
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            statusLabel: 'Ngoại tuyến',
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        return this._filterContacts(finalContacts)
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
          const name = fullName || getVal('name') || getVal('display_name') || 'Ẩn danh'
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
            statusLabel: 'Ngoại tuyến',
            unreadCount: 0,
            isFavorite: favorites.includes(id),
          }
        })
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        return this._filterContacts(finalContacts)
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

  _filterContacts(list) {
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
    filtered.sort((a, b) =>
      String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
    )
    this.currentContacts = filtered
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
    const uuids = contacts.map((c) => c.uuid).filter(Boolean)

    if (uuids.length === 0) return contacts

    try {
      const res = await fetch(`${host}/api/chatd/1.0/users/presences?user_uuid=${uuids.join(',')}`, {
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      })
      if (!res.ok) return contacts

      const data = await res.json()
      this.presences = this.presences || {}
      for (const it of data.items || []) {
        const u = it.uuid || it.user_uuid
        if (u) {
          this.presences[u] = it
        }
      }

      contacts.forEach((c) => {
        const st = this.statusOf(c.uuid)
        c.status = st.key
        c.statusLabel = st.label
      })
      logger.info('API', `Đã cập nhật trạng thái Presence thật cho ${data.items?.length || 0} nhân sự từ Wazo Chatd`)
    } catch (e) {
      logger.warn('API', 'Không thể nạp trạng thái presence từ chatd:', e.message)
    }
    return contacts
  }

  updateSinglePresence(presenceRecord) {
    if (!presenceRecord) return
    const uuid = presenceRecord.uuid || presenceRecord.user_uuid
    if (uuid) {
      this.presences = this.presences || {}
      this.presences[uuid] = { ...(this.presences[uuid] || {}), ...presenceRecord }
      if (this.currentContacts && this.currentContacts.length > 0) {
        let changed = false
        this.currentContacts.forEach((c) => {
          if (c.uuid === uuid) {
            const st = this.statusOf(c.uuid)
            if (c.status !== st.key) {
              c.status = st.key
              c.statusLabel = st.label
              changed = true
            }
          }
        })
        if (changed) {
          window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
        }
      }
    } else {
      if (this.currentContacts && this.currentContacts.length > 0) {
        this.loadPresencesForContacts(this.currentContacts).then(() => {
          window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
        })
      }
    }
  }

  startPresencePolling() {
    if (this.presencePollTimer) return
    this.presencePollTimer = setInterval(async () => {
      if (this.currentContacts && this.currentContacts.length > 0 && wazoService.isLogged()) {
        await this.loadPresencesForContacts(this.currentContacts)
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
      ...(Array.isArray(this.currentContacts) ? this.currentContacts : []),
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
      statusLabel: 'Ngoại tuyến',
      unreadCount: 0,
      isFavorite: false,
      ...contact,
    })
    return true
  }
}

export const contactService = new ContactService()
