import { reactive } from 'vue'
import { captureSessionContext, assertSessionContext, isSessionContextCurrent, createSessionFetch, invalidateSession } from './sessionScope'
import { wazoService, callStore } from './wazo'
import { logger } from './loggerService'

const contactState = reactive({ currentContacts: [], presences: {}, favoriteIds: [] })

class ContactService {
  get currentContacts() { return contactState.currentContacts }
  set currentContacts(value) { contactState.currentContacts = value }
  get presences() { return contactState.presences }
  set presences(value) { contactState.presences = value }
  get favoriteIds() { return contactState.favoriteIds }
  set favoriteIds(value) { contactState.favoriteIds = value }
  constructor() {
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
      window.addEventListener('wazo-presence-updated', (ev) => {
        if (ev.detail) {
          this.updateSinglePresence(ev.detail)
        }
      })
    }
  }

  /**
   * Tải danh sách liên hệ yêu thích trực tiếp từ máy chủ Wazo Dird API:
   * GET /api/dird/0.1/directories/favorites/default
   */
  async fetchFavorites() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
        logger.info('API', `Đồng bộ Wazo Dird favorites thành công (${this.favoriteIds.length} mục, Nguồn mặc định: "${this.defaultSourceName}")`)
        return this.favoriteIds
      } else {
        logger.warn('API', `Wazo Dird favorites trả về mã ${res.status}`)
      }
    } catch (err) {
      logger.warn('API', 'Không thể kết nối Wazo Dird favorites:', err.message)
    }
    return this.favoriteIds || []
  }

  /**
   * Bật/Tắt trạng thái yêu thích trên máy chủ Wazo Dird REST API
   * PUT /api/dird/0.1/directories/favorites/{directory}/{contact}
   * DELETE /api/dird/0.1/directories/favorites/{directory}/{contact}
   */
  async toggleFavorite(contactOrId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const willBeFavorite = contact
      ? !contact.isFavorite
      : !this.isFavorite(contactId, contact?.uuid, contact?.number)

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

    // Gọi API Wazo Dird bất đồng bộ dưới nền theo tên nguồn chuẩn
    try {
      const token = wazoService.getToken()
      if (token) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`
        const primaryDirectory = contact?.source || this.defaultSourceName || 'wazo_user'
        const method = willBeFavorite ? 'PUT' : 'DELETE'
        const targetId = contact?.rawId || contact?.id || contact?.uuid || contactId

        // Danh sách các ứng viên Directory/Source theo thứ tự ưu tiên Wazo
        const candidateDirectories = Array.from(
          new Set(
            [
              primaryDirectory,
              this.defaultSourceName,
              'wazo_user',
              'wazo',
              this.wazoSourceUuid,
              'personal',
            ].filter(Boolean),
          ),
        )

        let success = false
        for (const dir of candidateDirectories) {
          try {
            logger.info('API', `Gửi yêu cầu ${method} favorite tới Wazo Dird: /directories/favorites/${dir}/${targetId}`)
            const res = await fetch(
              `${host}/api/dird/0.1/directories/favorites/${encodeURIComponent(dir)}/${encodeURIComponent(targetId)}`,
              {
                method,
                headers: {
                  'X-Auth-Token': token,
                  Accept: 'application/json',
                },
                signal: AbortSignal.timeout(3500),
              },
            )

            if (res.ok) {
              logger.success('API', `Đã đồng bộ trạng thái favorite lên Wazo Dird qua nguồn "${dir}" (${willBeFavorite ? 'ADD' : 'REMOVE'})`)
              this.defaultSourceName = dir
              if (contact) contact.source = dir
              success = true
              break
            } else if (res.status !== 404) {
              logger.warn('API', `Wazo Dird nguồn "${dir}" trả về mã ${res.status}`)
              break
            }
          } catch (fetchErr) {
            logger.warn('API', `Thử nguồn "${dir}" gặp lỗi:`, fetchErr.message)
          }
        }

        if (!success) {
          logger.warn('API', `Không thể đồng bộ favorite lên server qua các nguồn Wazo Dird (đã bảo toàn cục bộ 0ms)`)
        }
      }
    } catch (e) {
      logger.warn('API', 'Lỗi gọi API favorites Wazo Dird (đã bảo toàn cục bộ):', e.message)
    }

    return willBeFavorite
  }

  isFavorite(id, uuid = null, number = null) {
    if (!id && !uuid && !number) return false
    return (
      Boolean(id && (this.favoriteIds || []).includes(String(id))) ||
      Boolean(uuid && (this.favoriteIds || []).includes(String(uuid))) ||
      Boolean(number && (this.favoriteIds || []).includes(String(number)))
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
   * Kiểm tra một liên hệ có đường dây sẵn sàng nhận cuộc gọi (Available) hay không
   * Chuẩn 100% theo WazoPresencesResponse.java & WazoSipCallManager.java
   * Chặn người đang talking, holding, ringing, progressing hoặc do_not_disturb, offline
   */
  isContactAvailableForCall(contactOrUuidOrExt) {
    if (!contactOrUuidOrExt) return false
    let contact = null
    let uuid = ''
    if (typeof contactOrUuidOrExt === 'object') {
      contact = contactOrUuidOrExt
      uuid = contact.uuid || ''
    } else {
      const str = String(contactOrUuidOrExt).trim()
      contact = this.findContactByExtension(str) || (this.currentContacts || []).find((c) => c.uuid === str || c.id === str)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    await this.fetchFavorites()
    if (!isSessionContextCurrent(sessionContext)) return []
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
        // Stale-While-Revalidate: Giữ nguyên danh sách hiện tại nếu không lấy được dữ liệu mới
        return this.currentContacts || []
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
            (number && favorites.includes(String(number))) ||
            Boolean(item.favorited)

          if (isFav) {
            if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
            if (userUuid && !this.favoriteIds.includes(userUuid)) this.favoriteIds.push(userUuid)
            if (rawId && !this.favoriteIds.includes(rawId)) this.favoriteIds.push(rawId)
            if (number && !this.favoriteIds.includes(String(number))) this.favoriteIds.push(String(number))
          }

          return {
            id,
            rawId,
            uuid: userUuid,
            source: item.source || item.backend || this.defaultSourceName || 'wazo_user',
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            statusLabel: 'Ngoại tuyến',
            isFavorite: isFav,
            isMobileApp: false,
          }
        })

        // Đồng bộ phòng ban của chính người dùng đăng nhập từ danh bạ Wazo
        const myUuid = callStore.myUserUuid || localStorage.getItem('smartcall_user_uuid')
        const myExt = callStore.myExtension || localStorage.getItem('smartcall_extension')
        const myName = callStore.myUserName || localStorage.getItem('smartcall_username')
        const meContact = mappedList.find(
          (c) => (myUuid && c.uuid === myUuid) || (myExt && c.number === myExt) || (myName && c.name === myName),
        )
        if (meContact?.dept && (!callStore.myDepartment || callStore.myDepartment !== meContact.dept)) {
          callStore.myDepartment = meContact.dept
          localStorage.setItem('smartcall_department', meContact.dept)
          localStorage.setItem('smartcall_user_department', meContact.dept)
        }

        const finalContacts = await this.loadPresencesForContacts(mappedList)
        assertSessionContext(sessionContext)
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
            (number && favorites.includes(String(number))) ||
            Boolean(r.favorited)

          if (isFav) {
            if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
            if (userUuid && !this.favoriteIds.includes(userUuid)) this.favoriteIds.push(userUuid)
            if (rawId && !this.favoriteIds.includes(rawId)) this.favoriteIds.push(rawId)
            if (number && !this.favoriteIds.includes(String(number))) this.favoriteIds.push(String(number))
          }

          return {
            id,
            rawId,
            uuid: userUuid,
            source: r.source || r.backend || this.defaultSourceName || 'wazo_user',
            name,
            email,
            dept,
            number: String(number || ''),
            status: 'offline',
            statusLabel: 'Ngoại tuyến',
            isFavorite: isFav,
            isMobileApp: false,
          }
        })

        // Đồng bộ phòng ban của chính người dùng đăng nhập từ danh bạ Wazo
        const myUuid = callStore.myUserUuid || localStorage.getItem('smartcall_user_uuid')
        const myExt = callStore.myExtension || localStorage.getItem('smartcall_extension')
        const myName = callStore.myUserName || localStorage.getItem('smartcall_username')
        const meContact = mappedList.find(
          (c) => (myUuid && c.uuid === myUuid) || (myExt && c.number === myExt) || (myName && c.name === myName),
        )
        if (meContact?.dept && (!callStore.myDepartment || callStore.myDepartment !== meContact.dept)) {
          callStore.myDepartment = meContact.dept
          localStorage.setItem('smartcall_department', meContact.dept)
          localStorage.setItem('smartcall_user_department', meContact.dept)
        }

        const finalContacts = await this.loadPresencesForContacts(mappedList)
        assertSessionContext(sessionContext)
        this.startPresencePolling()
        return this._filterContacts(finalContacts)
      }

      return this.currentContacts || []
    } catch (err) {
      logger.warn('API', 'Không thể nạp danh bạ từ máy chủ Wazo:', err.message)
      return this.currentContacts || []
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
        const p = c.uuid && this.presences[c.uuid]
        const statusStr = String(p?.status || '').toLowerCase()
        c.isMobileApp = Boolean(
          st.key !== 'offline' &&
          st.key !== 'unavailable' &&
          p && (
            statusStr.includes('smartcall-android') ||
            statusStr.includes('android') ||
            p.mobile === true ||
            p.lines?.some((l) => l.mobile)
          ),
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
              p && (
                statusStr.includes('smartcall-android') ||
                statusStr.includes('android') ||
                p.mobile === true ||
                p.lines?.some((l) => l.mobile)
              ),
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
    invalidateSession()
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
   * Tra cứu liên hệ an toàn từ bộ nhớ RAM hoặc trực tiếp từ Wazo Dird API
   * Đảm bảo tính sẵn sàng 100% khi người dùng gọi lại (autocall) từ Lịch sử cuộc gọi
   * @param {string} ext - Số máy lẻ
   */
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
