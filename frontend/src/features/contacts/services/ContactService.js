import { mapDirectoryContacts } from '../mappers/contactMapper.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../../../core/session/sessionScope.js'

import { userSessionState } from '../../../core/session/userSessionState.js'
import { logger } from '../../../core/logging/LoggerService.js'
import { reactive } from 'vue'

/** Sở hữu danh bạ, trạng thái presence và danh sách yêu thích của phiên hiện tại. */
export class ContactService {
  get currentContacts() {
    return this.state.currentContacts
  }

  set currentContacts(value) {
    this.state.currentContacts = value
  }

  get presences() {
    return this.state.presences
  }

  set presences(value) {
    this.state.presences = value
  }

  get favoriteIds() {
    return this.state.favoriteIds
  }

  set favoriteIds(value) {
    this.state.favoriteIds = value
  }

  constructor({ authService }) {
    Object.assign(this, { authService })
    this.state = reactive({ currentContacts: [], presences: {}, favoriteIds: [] })
    this.pendingFavorites = new Map()
    this.currentContacts = []
    this.presences = {}
    this.presencePollTimer = null
    this.favoriteIds = []
    this.defaultSourceName = 'wazo_user'
    this.wazoSourceUuid = ''

    // Dọn dẹp triệt để các key favorites cũ trong localStorage (100% Wazo Dird API)
    try {
      if (typeof localStorage !== 'undefined') {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith('smartcall_favorites_')) {
            localStorage.removeItem(k)
          }
        })
      }
    } catch (e) {}

    if (typeof window !== 'undefined') {
      this.presenceListener = (ev) => {
        if (ev.detail) {
          this.updateSinglePresence(ev.detail)
        }
      }
      window.addEventListener('wazo-presence-updated', this.presenceListener)
    }
  }

  async fetchFavorites() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    try {
      const token = this.authService.getToken()
      if (!token) {
        return this.favoriteIds || []
      }
      const host = this.authService.host.startsWith('http')
        ? this.authService.host
        : `https://${this.authService.host}`

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
            if (item.source) {
              this.defaultSourceName = item.source
            }
            const cid = item.contact_id || item.id || item.uuid || item.relations?.user_uuid
            if (cid) ids.push(String(cid))
            if (item.relations?.user_uuid) ids.push(String(item.relations.user_uuid))
            if (item.exten || item.number) ids.push(String(item.exten || item.number))
          })
        } else if (Array.isArray(data.results) && Array.isArray(data.column_types)) {
          const idIdx = data.column_types.indexOf('id')
          const numIdx = data.column_types.indexOf('number')
          data.results.forEach((r) => {
            if (r.source) {
              this.defaultSourceName = r.source
            }
            if (idIdx !== -1 && r.column_values[idIdx]) ids.push(String(r.column_values[idIdx]))
            if (numIdx !== -1 && r.column_values[numIdx]) ids.push(String(r.column_values[numIdx]))
            if (r.relations?.user_uuid) ids.push(String(r.relations.user_uuid))
          })
        } else if (Array.isArray(data)) {
          data.forEach((item) => {
            if (item.source) {
              this.defaultSourceName = item.source
            }
            const cid = item.contact_id || item.id || item.uuid || item.relations?.user_uuid
            if (cid) ids.push(String(cid))
            if (item.exten || item.number) ids.push(String(item.exten || item.number))
          })
        }
        this.favoriteIds = Array.from(new Set(ids))
        logger.info(
          'API',
          `Đồng bộ Wazo Dird favorites thành công (${this.favoriteIds.length} mục, Nguồn mặc định: "${this.defaultSourceName}")`,
        )
        return this.favoriteIds
      } else {
        logger.warn('API', `Wazo Dird favorites trả về mã ${res.status}`)
      }
    } catch (err) {
      logger.warn('API', 'Không thể kết nối Wazo Dird favorites:', err.message)
    }
    return this.favoriteIds || []
  }

  async toggleFavorite(contactOrId) {
    const contact =
      typeof contactOrId === 'object'
        ? contactOrId
        : this.currentContacts.find(
            (item) =>
              item.id === contactOrId || item.uuid === contactOrId || item.rawId === contactOrId,
          )
    if (!contact) throw new Error('Không xác định được liên hệ để cập nhật yêu thích.')
    const id = String(contact.rawId || contact.id || contact.uuid || '')
    if (!id) throw new Error('Liên hệ chưa có ID trên máy chủ.')
    if (this.pendingFavorites.has(id)) return this.pendingFavorites.get(id)
    const context = captureSessionContext(),
      desired = !contact.isFavorite
    const request = this.setContactFavorite(contact, desired, context)
    this.pendingFavorites.set(id, request)
    try {
      return await request
    } finally {
      if (this.pendingFavorites.get(id) === request) this.pendingFavorites.delete(id)
    }
  }

  /** Chỉ commit yêu thích sau ACK; 404 thử nguồn tiếp theo, 4xx/5xx trả lỗi rõ. */
  async setContactFavorite(contact, enabled, context = captureSessionContext()) {
    const token = this.authService.getToken()
    if (!token) throw new Error('Phiên đăng nhập đã kết thúc.')
    const fetch = createSessionFetch(context)
    const host = this.authService.getHostUrl()
    const id = String(contact.rawId || contact.id || contact.uuid)
    const sources = [
      ...new Set(
        [
          contact.source,
          this.defaultSourceName,
          'wazo_user',
          'wazo',
          this.wazoSourceUuid,
          'personal',
        ].filter(Boolean),
      ),
    ]
    for (const source of sources) {
      const result = await fetch(
        host +
          '/api/dird/0.1/directories/favorites/' +
          encodeURIComponent(source) +
          '/' +
          encodeURIComponent(id),
        {
          method: enabled ? 'PUT' : 'DELETE',
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          signal: AbortSignal.timeout(3500),
        },
      )
      if (result.status === 404) continue
      if (!result.ok)
        throw new Error('Không lưu được yêu thích trên máy chủ (HTTP ' + result.status + ').')
      assertSessionContext(context)
      contact.isFavorite = enabled
      contact.source = source
      this.defaultSourceName = source
      const ids = [id, contact.uuid, contact.id, contact.rawId, contact.number]
        .filter(Boolean)
        .map(String)
      this.favoriteIds = enabled
        ? [...new Set([...this.favoriteIds, ...ids])]
        : this.favoriteIds.filter((value) => !ids.includes(value))
      window.dispatchEvent(new CustomEvent('smartcall-contacts-updated'))
      return enabled
    }
    throw new Error('Không tìm được nguồn danh bạ hỗ trợ cập nhật yêu thích.')
  }

  /** Gỡ listener khi app bị hủy; timer được dọn riêng khi logout. */
  dispose() {
    this.stopPresencePolling()
    window.removeEventListener('wazo-presence-updated', this.presenceListener)
  }

  isFavorite(id, uuid = null, number = null) {
    if (!id && !uuid && !number) return false
    return (
      Boolean(id && (this.favoriteIds || []).includes(String(id))) ||
      Boolean(uuid && (this.favoriteIds || []).includes(String(uuid))) ||
      Boolean(number && (this.favoriteIds || []).includes(String(number)))
    )
  }

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
      : p.connected === true ||
        p.state === 'available' ||
        p.state === 'online' ||
        p.line_state === 'available'
    if (!online || p.state === 'unavailable' || p.state === 'offline')
      return { key: 'offline', label: 'Ngoại tuyến' }
    if (p.state === 'away') return { key: 'away', label: 'Vắng mặt' }
    return { key: 'online', label: 'Trực tuyến' }
  }

  isContactAvailableForCall(contactOrUuidOrExt) {
    if (!contactOrUuidOrExt) return false
    let contact = null
    let uuid = ''
    if (typeof contactOrUuidOrExt === 'object') {
      contact = contactOrUuidOrExt
      uuid = contact.uuid || ''
    } else {
      const str = String(contactOrUuidOrExt).trim()
      contact =
        this.findContactByExtension(str) ||
        (this.currentContacts || []).find((c) => c.uuid === str || c.id === str)
      uuid = contact?.uuid || (this.presences?.[str] ? str : '')
    }

    const p = uuid && this.presences?.[uuid]
    if (!p) {
      if (contact) {
        return contact.status === 'online'
      }
      return false
    }

    // 1. Chặn nếu có cờ Do Not Disturb
    if (p.do_not_disturb) return false

    // 2. Chặn nếu trạng thái state là offline hoặc unavailable
    if (p.state === 'unavailable' || p.state === 'offline') return false

    // 3. Đối chiếu mảng lines từ Wazo Chatd (chuẩn WazoPresencesResponse.java)
    const lines = (p.lines || []).map((l) => l.state)
    if (lines.length > 0) {
      // Chặn nếu có bất kỳ line nào đang bận hoặc đổ chuông
      const isBusy = lines.some((s) => ['talking', 'holding', 'ringing', 'progressing'].includes(s))
      if (isBusy) return false
      // Phải có ít nhất 1 line available
      return lines.some((s) => s === 'available')
    }

    return p.line_state === 'available' || p.state === 'available' || p.connected === true
  }

  matchesSearch(contact, query) {
    if (!query || !query.trim()) return true
    const q = query.toLowerCase().trim()
    const name = String(contact.name || '').toLowerCase()
    const dept = String(contact.dept || '').toLowerCase()
    const num = String(contact.number || '').toLowerCase()
    return name.includes(q) || dept.includes(q) || num.includes(q)
  }

  async getContacts() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    await this.fetchFavorites()
    if (!isSessionContextCurrent(sessionContext)) return []
    const favorites = this.favoriteIds || []
    try {
      const token = this.authService.getToken()
      if (!token) throw new Error('No token available')

      const host = this.authService.host.startsWith('http')
        ? this.authService.host
        : `https://${this.authService.host}`

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
          const sourceItem = sourcesData.items?.[0]
          const sourceUuid = sourceItem?.uuid
          if (sourceItem?.name) {
            this.defaultSourceName = sourceItem.name
          }
          if (sourceUuid) {
            this.wazoSourceUuid = sourceUuid
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
          const lookupRes = await fetch(`${host}/api/dird/0.1/directories/lookup/default?term=1`, {
            headers: { 'X-Auth-Token': token },
            signal: AbortSignal.timeout(3000),
          })
          if (lookupRes.ok) {
            contactsData = await lookupRes.json()
          }
        } catch (lookErr) {
          console.warn('Lỗi tra cứu danh bạ lookup:', lookErr)
        }
      }

      if (!contactsData) {
        // Stale-While-Revalidate: Giữ nguyên danh sách hiện tại nếu không lấy được dữ liệu mới
        return this.currentContacts || []
      }

      const contacts = mapDirectoryContacts(contactsData, {
        favoriteIds: favorites,
        defaultSource: this.defaultSourceName || 'wazo_user',
      })
      if (contacts === null) return this.currentContacts || []
      for (const contact of contacts.filter((item) => item.isFavorite)) {
        for (const id of [contact.id, contact.uuid, contact.rawId, contact.number]) {
          if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
        }
      }
      this.synchronizeCurrentUserDepartment(contacts)
      const finalContacts = await this.loadPresencesForContacts(contacts)
      assertSessionContext(sessionContext)
      this.startPresencePolling()
      return this._filterContacts(finalContacts)
    } catch (err) {
      logger.warn('API', 'Không thể nạp danh bạ từ máy chủ Wazo:', err.message)
      return this.currentContacts || []
    }
  }

  /** Bổ sung phòng ban từ danh bạ đã xác nhận; nhận diện bằng UUID hoặc máy lẻ. */
  synchronizeCurrentUserDepartment(contacts) {
    const myUuid = this.authService.getCurrentUserUuid()
    const myExtension = this.authService.getCurrentExtension()
    const currentUser = contacts.find(
      (contact) =>
        (myUuid && contact.uuid === myUuid) || (myExtension && contact.number === myExtension),
    )
    if (!currentUser?.dept) return
    userSessionState.department = currentUser.dept
    localStorage.setItem('smartcall_department', currentUser.dept)
    localStorage.setItem('smartcall_user_department', currentUser.dept)
  }

  _filterContacts(list) {
    const meUuid = this.authService.session?.uuid || localStorage.getItem('smartcall_user_uuid')
    let meExten = this.authService.getCurrentExtension()
    const cleanExt = (n) =>
      String(n || '')
        .split('@')[0]
        .trim()

    // Tự động nhận diện số máy lẻ của chính mình nếu session chưa kịp điền (giống mã nguồn tham chiếu mẫu)
    const mine = list.find((c) => c.uuid && c.uuid === meUuid)
    if (mine && !meExten && mine.number) {
      const cleanedMine = cleanExt(mine.number)
      meExten = cleanedMine
      userSessionState.extension = cleanedMine
      if (this.authService.session) {
        this.authService.session.profile = this.authService.session.profile || {}
        this.authService.session.profile.lines = [{ extensions: [{ exten: cleanedMine }] }]
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
      String(a.number).localeCompare(String(b.number), undefined, { numeric: true }),
    )
    this.currentContacts = filtered
    return filtered
  }

  async loadPresencesForContacts(contacts) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!Array.isArray(contacts) || contacts.length === 0) return contacts
    const token = this.authService.getToken()
    if (!token) return contacts

    const host = this.authService.host.startsWith('http')
      ? this.authService.host
      : `https://${this.authService.host}`
    const uuids = contacts.map((c) => c.uuid).filter(Boolean)

    if (uuids.length === 0) return contacts

    try {
      const res = await fetch(
        `${host}/api/chatd/1.0/users/presences?user_uuid=${uuids.join(',')}`,
        {
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        },
      )
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
        const p = c.uuid && this.presences[c.uuid]
        const statusStr = String(p?.status || '').toLowerCase()
        c.isMobileApp = Boolean(
          st.key !== 'offline' &&
          st.key !== 'unavailable' &&
          p &&
          (statusStr.includes('smartcall-android') ||
            statusStr.includes('android') ||
            p.mobile === true ||
            p.lines?.some((l) => l.mobile)),
        )
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
            const p = this.presences[uuid]
            const statusStr = String(p?.status || '').toLowerCase()
            const isMob = Boolean(
              st.key !== 'offline' &&
              st.key !== 'unavailable' &&
              p &&
              (statusStr.includes('smartcall-android') ||
                statusStr.includes('android') ||
                p.mobile === true ||
                p.lines?.some((l) => l.mobile)),
            )
            if (c.status !== st.key || c.statusLabel !== st.label || c.isMobileApp !== isMob) {
              c.status = st.key
              c.statusLabel = st.label
              c.isMobileApp = isMob
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
      if (
        this.currentContacts &&
        this.currentContacts.length > 0 &&
        this.authService.isAuthenticated()
      ) {
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

  reset() {
    this.pendingFavorites.clear()
    this.defaultSourceName = 'wazo_user'
    this.wazoSourceUuid = ''
    this.stopPresencePolling()
    this.currentContacts = []
    this.presences = {}
    this.favoriteIds = []
    logger.info('API', 'Đã dọn dẹp sạch toàn bộ cache danh bạ và hiện diện.')
  }

  findContactByExtension(ext) {
    if (!ext) return null
    const cleanTarget = String(ext).split('@')[0].trim()
    const pool = Array.isArray(this.currentContacts) ? this.currentContacts : []
    return (
      pool.find(
        (c) =>
          String(c.number || '')
            .split('@')[0]
            .trim() === cleanTarget ||
          (c.uuid && c.uuid === String(ext).trim()),
      ) || null
    )
  }

  async getOrLookupContact(ext) {
    if (!ext) return null
    const cleanExt = String(ext).split('@')[0].trim()
    let found = (this.currentContacts || []).find(
      (c) =>
        String(c.number).split('@')[0].trim() === cleanExt ||
        c.id === cleanExt ||
        c.uuid === cleanExt,
    )
    if (found) return found

    // Nếu chưa có trong RAM, tự động kích hoạt nạp lại danh bạ một lần nữa từ Wazo
    try {
      const refreshed = await this.getContacts()
      found = (refreshed || []).find(
        (c) =>
          String(c.number).split('@')[0].trim() === cleanExt ||
          c.id === cleanExt ||
          c.uuid === cleanExt,
      )
      return found || null
    } catch (e) {
      return null
    }
  }

  findContactByUuid(uuid) {
    if (!uuid) return null
    const cleanUuid = String(uuid).trim()
    const pool = Array.isArray(this.currentContacts) ? this.currentContacts : []
    return pool.find((c) => c.uuid === cleanUuid || c.id === cleanUuid) || null
  }

  async resolveUserUuid(ext) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!ext) return null
    const cleanExt = String(ext).split('@')[0].trim()
    const cached = this.findContactByExtension(cleanExt)
    if (cached?.uuid) return cached.uuid

    try {
      const token = this.authService.getToken()
      if (token) {
        const host = this.authService.host.startsWith('http')
          ? this.authService.host
          : `https://${this.authService.host}`
        const res = await fetch(
          `${host}/api/dird/0.1/directories/lookup/default?term=${encodeURIComponent(cleanExt)}`,
          {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          },
        )
        if (res.ok) {
          const data = await res.json()
          const contacts = mapDirectoryContacts(data) || []
          const found = contacts.find((contact) => contact.number.trim() === cleanExt)
          if (found?.uuid) return found.uuid
        }
      }
    } catch (e) {
      /* ignore */
    }
    return cached?.uuid || null
  }
}
