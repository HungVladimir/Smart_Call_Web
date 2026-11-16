import { wazoService, callStore } from './wazo'
import { logger } from './loggerService'

class ContactService {
  constructor() {
    this.currentContacts = []
    this.presences = {}
    this.presencePollTimer = null
    this.favoriteIds = []

    if (typeof window !== 'undefined') {
      window.addEventListener('wazo-presence-updated', (ev) => {
        if (ev.detail) {
          this.updateSinglePresence(ev.detail)
        }
      })
    }
  }

  // Khóa danh sách yêu thích phân tách theo User UUID
  getFavoritesKey() {
    const userUuid = wazoService?.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || 'default'
    return `smartcall_favorites_${userUuid}`
  }

  // Tải mảng ID yêu thích từ localStorage (0ms instant)
  getSavedFavoriteIds() {
    try {
      const key = this.getFavoritesKey()
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.map(String)
      }
    } catch (e) {
      console.warn('Lỗi đọc favorites từ localStorage:', e)
    }
    return []
  }

  // Lưu bền vững vào localStorage theo User UUID
  saveFavorites(ids) {
    try {
      const key = this.getFavoritesKey()
      localStorage.setItem(key, JSON.stringify(ids || []))
    } catch (e) {
      console.warn('Lỗi ghi favorites vào localStorage:', e)
    }
  }

  /**
   * Tải danh sách liên hệ yêu thích:
   * 1. Nạp tức thời từ localStorage (0ms, F5 không mất)
   * 2. Gọi Wazo Dird API để đồng bộ với server
   * GET /api/dird/0.1/directories/favorites/default
   */
  async fetchFavorites() {
    // 1. Luôn nạp cache local trước để UI hiển thị ngay lập tức
    const saved = this.getSavedFavoriteIds()
    if (saved && saved.length > 0) {
      this.favoriteIds = Array.from(new Set([...(this.favoriteIds || []), ...saved]))
    }

    try {
      const token = wazoService.getToken()
      if (!token) {
        return this.favoriteIds || []
      }
      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      const res = await fetch(`${host}/api/dird/0.1/directories/favorites/default`, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3500),
      })

      if (res.ok) {
        const data = await res.json()
        const ids = []
        if (Array.isArray(data.items)) {
          data.items.forEach((item) => {
            const cid = item.contact_id || item.id || item.uuid || item.relations?.user_uuid
            if (cid) ids.push(String(cid))
            if (item.relations?.user_uuid) ids.push(String(item.relations.user_uuid))
            if (item.exten || item.number) ids.push(String(item.exten || item.number))
          })
        } else if (Array.isArray(data.results) && Array.isArray(data.column_types)) {
          const idIdx = data.column_types.indexOf('id')
          data.results.forEach((r) => {
            if (idIdx !== -1 && r.column_values[idIdx]) ids.push(String(r.column_values[idIdx]))
            if (r.relations?.user_uuid) ids.push(String(r.relations.user_uuid))
          })
        } else if (Array.isArray(data)) {
          data.forEach((item) => {
            const cid = item.contact_id || item.id || item.uuid || item.relations?.user_uuid
            if (cid) ids.push(String(cid))
          })
        }
        // Hợp nhất server favorites với local favorites
        this.favoriteIds = Array.from(new Set([...(this.favoriteIds || []), ...ids]))
        this.saveFavorites(this.favoriteIds)
        logger.info('API', `Đồng bộ Wazo Dird favorites thành công (${this.favoriteIds.length} mục)`)
        return this.favoriteIds
      } else {
        logger.warn('API', `Wazo Dird favorites trả về mã ${res.status}, duy trì danh sách yêu thích cục bộ (${(this.favoriteIds || []).length} mục)`)
      }
    } catch (err) {
      logger.warn('API', 'Không thể kết nối Wazo Dird favorites (dùng bộ nhớ đệm cục bộ):', err.message)
    }
    return this.favoriteIds || []
  }

  /**
   * Bật/Tắt trạng thái yêu thích trên máy chủ Wazo Dird REST API
   * PUT /api/dird/0.1/directories/favorites/{directory}/{contact}
   * DELETE /api/dird/0.1/directories/favorites/{directory}/{contact}
   * Áp dụng mô hình Write-Through Cache: Ghi ngay lập tức xuống localStorage theo User UUID
   */
  async toggleFavorite(contactOrId) {
    let contact = null
    let contactId = ''
    if (contactOrId && typeof contactOrId === 'object') {
      contact = contactOrId
      contactId = contact.rawId || contact.id || contact.uuid || ''
    } else {
      contactId = String(contactOrId || '')
      contact = this.currentContacts.find(
        (c) => c.id === contactId || c.uuid === contactId || c.rawId === contactId,
      )
    }

    if (!contactId) return false
    const willBeFavorite = contact ? !contact.isFavorite : !this.isFavorite(contactId)

    // Cập nhật trạng thái tức thời trên đối tượng contact
    if (contact) {
      contact.isFavorite = willBeFavorite
    }
    const idList = [contactId]
    if (contact?.uuid) idList.push(String(contact.uuid))
    if (contact?.id) idList.push(String(contact.id))
    if (contact?.rawId) idList.push(String(contact.rawId))
    if (contact?.number) idList.push(String(contact.number))

    if (willBeFavorite) {
      idList.forEach((id) => {
        if (!this.favoriteIds.includes(id)) this.favoriteIds.push(id)
      })
    } else {
      this.favoriteIds = this.favoriteIds.filter((id) => !idList.includes(id))
    }

    // Write-Through: Ghi NGAY LẬP TỨC xuống localStorage theo User UUID (F5 không mất)
    this.saveFavorites(this.favoriteIds)

    // Gọi API Wazo Dird bất đồng bộ dưới nền
    try {
      const token = wazoService.getToken()
      if (token) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`
        const directory = contact?.source || 'default'
        const method = willBeFavorite ? 'PUT' : 'DELETE'
        const targetId = contact?.rawId || contact?.id || contact?.uuid || contactId

        logger.info('API', `Gửi yêu cầu ${method} favorite tới Wazo Dird: /directories/favorites/${directory}/${targetId}`)
        let res = await fetch(
          `${host}/api/dird/0.1/directories/favorites/${directory}/${encodeURIComponent(targetId)}`,
          {
            method,
            headers: {
              'X-Auth-Token': token,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(3500),
          },
        )

        // Nếu directory !== 'default' mà bị lỗi, dự phòng gọi tiếp endpoint default
        if (!res.ok && directory !== 'default') {
          res = await fetch(
            `${host}/api/dird/0.1/directories/favorites/default/${encodeURIComponent(targetId)}`,
            {
              method,
              headers: {
                'X-Auth-Token': token,
                Accept: 'application/json',
              },
              signal: AbortSignal.timeout(3500),
            },
          )
        }

        if (res.ok) {
          logger.success('API', `Đã đồng bộ trạng thái favorite lên máy chủ Wazo Dird (${willBeFavorite ? 'ADD' : 'REMOVE'})`)
        } else {
          logger.warn('API', `Máy chủ Wazo Dird trả về status ${res.status} cho favorite (đã bảo toàn cục bộ)`)
        }
      }
    } catch (e) {
      logger.warn('API', 'Lỗi gọi API favorites Wazo Dird (đã bảo toàn cục bộ):', e.message)
    }

    return willBeFavorite
  }

  isFavorite(id, uuid = null) {
    if (!id && !uuid) return false
    return (
      Boolean(id && (this.favoriteIds || []).includes(String(id))) ||
      Boolean(uuid && (this.favoriteIds || []).includes(String(uuid)))
    )
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
      : p.connected === true || p.state === 'available' || p.state === 'online' || p.line_state === 'available'
    if (!online || p.state === 'unavailable' || p.state === 'offline') return { key: 'offline', label: 'Ngoại tuyến' }
    if (p.state === 'away') return { key: 'away', label: 'Vắng mặt' }
    return { key: 'online', label: 'Trực tuyến' }
  }

  /**
   * Khớp nối chuỗi tìm kiếm theo tên, phòng ban hoặc số máy lẻ
   */
  matchesSearch(contact, query) {
    if (!query || !query.trim()) return true
    const q = query.toLowerCase().trim()
    const name = String(contact.name || '').toLowerCase()
    const dept = String(contact.dept || '').toLowerCase()
    const num = String(contact.number || '').toLowerCase()
    return name.includes(q) || dept.includes(q) || num.includes(q)
  }

  /**
   * Lấy danh bạ toàn bộ nhân viên trực tiếp từ Wazo (100% dữ liệu thật, không mock data)
   */
  async getContacts() {
    await this.fetchFavorites()
    const favorites = this.favoriteIds || []
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
            signal: AbortSignal.timeout(3000),
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
                signal: AbortSignal.timeout(3000),
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

      // 2. Cách 2: Dự phòng tra cứu lookup/default nếu Cách 1 không mở nguồn
      if (!contactsData) {
        try {
          const lookupRes = await fetch(
            `${host}/api/dird/0.1/directories/lookup/default?term=1`,
            {
              headers: { 'X-Auth-Token': token },
              signal: AbortSignal.timeout(3000),
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
        this.currentContacts = []
        return []
      }

      // Xử lý dữ liệu trả về từ Wazo Dird:
      // Trường hợp 1: Dạng danh sách đối tượng (items)
      if (Array.isArray(contactsData.items) && contactsData.items.length > 0) {
        const mappedList = contactsData.items.map((item, index) => {
          const userUuid = item.uuid || item.user_uuid || (typeof item.relations === 'object' && item.relations?.user_uuid) || null
          const rawId = String(item.id || item.contact_id || userUuid || '')
          const id = userUuid || rawId || `wazo-${index}`

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
          const dept = item.department || item.society || item.title || item.userfield || item.description || ''

          const isFav =
            favorites.includes(id) ||
            (userUuid && favorites.includes(userUuid)) ||
            (rawId && favorites.includes(rawId)) ||
            Boolean(item.favorited)

          if (isFav) {
            if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
            if (userUuid && !this.favoriteIds.includes(userUuid)) this.favoriteIds.push(userUuid)
            if (rawId && !this.favoriteIds.includes(rawId)) this.favoriteIds.push(rawId)
          }

          return {
            id,
            rawId,
            uuid: userUuid,
            source: item.source || item.backend || 'default',
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            statusLabel: 'Ngoại tuyến',
            unreadCount: 0,
            isFavorite: isFav,
          }
        })
        this.saveFavorites(this.favoriteIds)
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        this.startPresencePolling()
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
          const rawId = String(getVal('id') || r.id || userUuid || '')
          const id = userUuid || rawId || `wazo-${index}`
          const fn = (getVal('firstname') || '').trim()
          const ln = (getVal('lastname') || '').trim()
          const fullName = [fn, ln].filter(Boolean).join(' ').trim()
          const name = fullName || getVal('name') || getVal('display_name') || 'Ẩn danh'
          const number = getVal('number') || getVal('callable') || getVal('exten') || ''
          const email = getVal('email') || ''
          const dept = getVal('department') || getVal('society') || getVal('title') || getVal('userfield') || getVal('description') || ''

          const isFav =
            favorites.includes(id) ||
            (userUuid && favorites.includes(userUuid)) ||
            (rawId && favorites.includes(rawId)) ||
            Boolean(r.favorited)

          if (isFav) {
            if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
            if (userUuid && !this.favoriteIds.includes(userUuid)) this.favoriteIds.push(userUuid)
            if (rawId && !this.favoriteIds.includes(rawId)) this.favoriteIds.push(rawId)
          }

          return {
            id,
            rawId,
            uuid: userUuid,
            source: r.source || r.backend || 'default',
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            statusLabel: 'Ngoại tuyến',
            unreadCount: 0,
            isFavorite: isFav,
          }
        })
        this.saveFavorites(this.favoriteIds)
        const finalContacts = await this.loadPresencesForContacts(mappedList)
        this.startPresencePolling()
        return this._filterContacts(finalContacts)
      }

      this.currentContacts = []
      return []
    } catch (err) {
      logger.warn('API', 'Không thể nạp danh bạ từ máy chủ Wazo:', err.message)
      this.currentContacts = []
      return []
    }
  }

  _filterContacts(list) {
    const meUuid = wazoService.session?.uuid || localStorage.getItem('smartcall_user_uuid')
    let meExten = wazoService.getMyExtension()
    const cleanExt = (n) => String(n || '').split('@')[0].trim()

    // Tự động nhận diện số máy lẻ của chính mình nếu session chưa kịp điền (giống mã nguồn tham chiếu mẫu)
    const mine = list.find((c) => c.uuid && c.uuid === meUuid)
    if (mine && !meExten && mine.number) {
      const cleanedMine = cleanExt(mine.number)
      meExten = cleanedMine
      callStore.myExtension = cleanedMine
      if (wazoService.session) {
        wazoService.session.profile = wazoService.session.profile || {}
        wazoService.session.profile.lines = [{ extensions: [{ exten: cleanedMine }] }]
      }
      localStorage.setItem('smartcall_user_exten', cleanedMine)
      localStorage.setItem('smartcall_extension', cleanedMine)
      logger.info('AUTH', `Đã tự động nhận diện số máy lẻ của bạn từ danh bạ: ${cleanedMine}`)
    }

    let filtered = list
    if (meUuid || meExten) {
      const cleanMe = cleanExt(meExten)
      filtered = list.filter((c) => {
        if (meUuid && c.uuid && c.uuid === meUuid) return false
        if (cleanMe && c.number && cleanExt(c.number) === cleanMe) return false
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
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return contacts

      const data = await res.json()
      this.presences = this.presences || {}
      const items = Array.isArray(data.items)
        ? data.items
        : data.items && typeof data.items === 'object'
          ? Object.entries(data.items).map(([uuid, val]) => ({ uuid, ...val }))
          : []

      for (const it of items) {
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
            if (c.status !== st.key || c.statusLabel !== st.label) {
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

  stopPresencePolling() {
    if (this.presencePollTimer) {
      clearInterval(this.presencePollTimer)
      this.presencePollTimer = null
    }
  }

  /**
   * Dọn dẹp sạch sẽ toàn bộ trạng thái khi người dùng đăng xuất
   */
  reset() {
    this.stopPresencePolling()
    this.currentContacts = []
    this.presences = {}
    this.favoriteIds = []
    logger.info('API', 'Đã dọn dẹp sạch toàn bộ cache danh bạ và hiện diện.')
  }

  /**
   * Tìm kiếm thông tin liên hệ theo số máy lẻ (So khớp chính xác số máy lẻ hoặc UUID)
   */
  findContactByExtension(ext) {
    if (!ext) return null
    const cleanTarget = String(ext).split('@')[0].trim()
    const pool = Array.isArray(this.currentContacts) ? this.currentContacts : []
    return (
      pool.find(
        (c) =>
          String(c.number || '').split('@')[0].trim() === cleanTarget ||
          (c.uuid && c.uuid === String(ext).trim()),
      ) || null
    )
  }

  /**
   * Tìm kiếm thông tin liên hệ theo User UUID
   */
  findContactByUuid(uuid) {
    if (!uuid) return null
    const cleanUuid = String(uuid).trim()
    const pool = Array.isArray(this.currentContacts) ? this.currentContacts : []
    return (
      pool.find((c) => c.uuid === cleanUuid || c.id === cleanUuid) || null
    )
  }

  /**
   * Phân giải User UUID từ số máy lẻ (tra cứu cache hoặc gọi Wazo Dird lookup nếu chưa có)
   */
  async resolveUserUuid(ext) {
    if (!ext) return null
    const cleanExt = String(ext).split('@')[0].trim()
    const cached = this.findContactByExtension(cleanExt)
    if (cached?.uuid) return cached.uuid

    try {
      const token = wazoService.getToken()
      if (token) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`
        const res = await fetch(
          `${host}/api/dird/0.1/directories/lookup/default?term=${encodeURIComponent(cleanExt)}`,
          {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          },
        )
        if (res.ok) {
          const data = await res.json()
          const items = Array.isArray(data.items) ? data.items : []
          for (const item of items) {
            const num = item.exten || item.number || item.phone_number || ''
            if (String(num).trim() === cleanExt) {
              const uUuid =
                item.uuid ||
                item.user_uuid ||
                (typeof item.relations === 'object' && item.relations?.user_uuid)
              if (uUuid) return uUuid
            }
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    return cached?.uuid || null
  }
}

export const contactService = new ContactService()
