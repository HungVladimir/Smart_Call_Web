import { mapDirectoryContacts, normalizeDirectoryText } from '../../utils/contactMapper.js'
import { normalizeExtension } from '../../utils/callPolicy.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../auth/sessionScope.js'

import { userSessionState } from '../../state/sessionState.js'
import { logger } from '../common/loggerService.js'
import { reactive } from 'vue'

export const DIRECTORY_PAGE_SIZE = 30
const LOOKUP_MAX_RESULTS = 100
const IDENTITY_CACHE_LIMIT = 600
const PRESENCE_FRESH_MS = 15000

/** Sở hữu danh bạ, trạng thái presence và danh sách yêu thích của phiên hiện tại. */
export class ContactService {
  /** Đọc/cập nhật danh bạ reactive dùng chung cho Calls, Messages và History. */
  get currentContacts() {
    return this.state.currentContacts
  }

  /**
   * Gán giá trị mới vào state currentContacts để các nơi đang theo dõi cùng nhận thay đổi; bản
   * thân setter không ghi dữ liệu lên server.
   */
  set currentContacts(value) {
    this.state.currentContacts = value
  }

  /** Đọc/cập nhật bản đồ presence reactive theo UUID để trạng thái liên hệ tự cập nhật. */
  get presences() {
    return this.state.presences
  }

  /**
   * Gán giá trị mới vào state presences để các nơi đang theo dõi cùng nhận thay đổi; bản thân
   * setter không ghi dữ liệu lên server.
   */
  set presences(value) {
    this.state.presences = value
  }

  /** Đọc/cập nhật tập ID yêu thích được xác nhận từ Dird trong phiên hiện tại. */
  get favoriteIds() {
    return this.state.favoriteIds
  }

  /**
   * Gán giá trị mới vào state favoriteIds để các nơi đang theo dõi cùng nhận thay đổi; bản thân
   * setter không ghi dữ liệu lên server.
   */
  set favoriteIds(value) {
    this.state.favoriteIds = value
  }

  /** Tạo state danh bạ/presence/favorite cùng cơ chế polling và gộp request trong phiên hiện tại. */
  constructor({ authService }) {
    Object.assign(this, { authService })
    this.state = reactive({
      currentContacts: [],
      identities: new Map(),
      presences: {},
      presenceCheckedAt: {},
      favoriteIds: [],
      favoriteContacts: [],
      recentRevision: 0,
    })
    this.pendingFavorites = new Map()
    this.pendingLookups = new Map()
    this.pendingPresence = new Map()
    this.pendingUuidBatches = new Map()
    this.directorySource = null
    this.pendingSource = null
    this.extensionChecks = new Map()
    this.presenceRevisions = new Map()
    this.departmentReadForbidden = false
    this.pendingDirectoryRefresh = null
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

  /** Gửi GET Dird bằng token người dùng; lỗi quyền, nguồn và kết nối phải phân biệt với trang rỗng. */
  async requestDirectory(path, params, context, signal) {
    const fetch = createSessionFetch(context)
    const token = this.authService.getToken()
    if (!token) throw new Error('Phiên danh bạ không còn hiệu lực.')
    const timeout = AbortSignal.timeout(5000)
    const query = new URLSearchParams(params)
    const response = await fetch(
      this.authService.getHostUrl() + '/api/dird/0.1' + path + '?' + query,
      {
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    )
    if (!response.ok) {
      const message =
        response.status === 403
          ? 'Tài khoản chưa có quyền đọc nguồn danh bạ Wazo.'
          : `Chưa tải được danh bạ Wazo (HTTP ${response.status}).`
      throw Object.assign(new Error(message), { status: response.status })
    }
    return response.json()
  }

  /** Chọn nguồn nhân viên được profile công bố và gộp yêu cầu lấy nguồn trong cùng phiên. */
  async getDirectorySource(context) {
    if (this.directorySource) return this.directorySource
    if (this.pendingSource) return this.pendingSource
    /** Chỉ dùng nguồn đã định cấu hình, nguồn nội bộ chuẩn hoặc nguồn duy nhất của profile. */
    const loadSource = async () => {
      const data = await this.requestDirectory(
        '/directories/default/sources',
        { backend: 'wazo' },
        context,
      )
      const sources = Array.isArray(data?.items)
        ? data.items.filter((item) => item.uuid && (!item.backend || item.backend === 'wazo'))
        : []
      const configured = import.meta.env.VITE_WAZO_DIRECTORY_SOURCE_UUID
      const source = configured
        ? sources.find((item) => item.uuid === configured)
        : sources.find((item) => item.name === 'wazo_user') ||
          (sources.length === 1 ? sources[0] : null)
      if (!source) throw new Error('Chưa xác định được nguồn danh bạ nội bộ của profile Wazo.')
      assertSessionContext(context)
      this.directorySource = source
      return source
    }
    const pending = loadSource()
    this.pendingSource = pending
    try {
      return await pending
    } finally {
      if (this.pendingSource === pending) this.pendingSource = null
    }
  }

  /** Đọc trang trực tiếp từ nguồn Wazo và phát hiện phản hồi vượt quá hợp đồng phân trang. */
  async readDirectoryPage(params, context, signal) {
    const source = await this.getDirectorySource(context)
    let data
    try {
      data = await this.requestDirectory(
        '/backends/wazo/sources/' + encodeURIComponent(source.uuid) + '/contacts',
        params,
        context,
        signal,
      )
    } catch (error) {
      if (error.status === 404 && this.directorySource === source) this.directorySource = null
      throw error
    }
    const contacts = mapDirectoryContacts(data, {
      favoriteIds: this.favoriteIds,
      defaultSource: source.name || 'wazo_user',
    })
    if (!contacts || contacts.length > Number(params.limit))
      throw new Error('Nguồn Wazo trả trang danh bạ không hợp lệ.')
    assertSessionContext(context)
    return { contacts, filtered: Number.isInteger(data.filtered) ? data.filtered : null }
  }

  /** Nhớ định danh đã thấy để chat và thoại tìm độc lập với danh sách đang hiển thị. */
  rememberDirectoryContacts(contacts) {
    const remembered = []
    for (const contact of contacts) {
      if (!contact.uuid) {
        remembered.push({ ...contact, ...this.directoryContactStatus() })
        continue
      }
      const cache = this.state.identities
      const observedAt = this.state.presenceCheckedAt[contact.uuid]
      const cached = cache.get(contact.uuid)
      if (cached && !contact.dept) {
        contact.dept = cached.dept
        contact.description = cached.description
      }
      const identity =
        cached && normalizeExtension(cached.number) === normalizeExtension(contact.number)
          ? Object.assign(cached, contact)
          : contact
      Object.assign(identity, this.directoryContactStatus(contact.uuid, observedAt))
      cache.delete(contact.uuid)
      cache.set(contact.uuid, identity)
      remembered.push(cache.get(contact.uuid))
      if (cache.size > IDENTITY_CACHE_LIMIT) cache.delete(cache.keys().next().value)
    }
    return remembered
  }

  /** Lấy trang tìm kiếm/duyệt và giữ offset theo số bản ghi Wazo trả, kể cả mục bị ẩn khỏi UI. */
  async searchDirectory({ term = '', department = '', offset = 0, signal } = {}) {
    const context = captureSessionContext()
    const query = String(term || department)
      .normalize('NFC')
      .trim()
      .replace(/\s+/g, ' ')
    const params = { limit: DIRECTORY_PAGE_SIZE, offset }
    if (query) params.search = query
    const { contacts, filtered } = await this.readDirectoryPage(params, context, signal)
    if (signal?.aborted) throw new DOMException('Đã hủy tra danh bạ', 'AbortError')
    const remembered = this.rememberDirectoryContacts(contacts)
    if (department) await this.enrichPageDepartments(remembered, { required: true, signal })
    assertSessionContext(context)
    if (signal?.aborted) throw new DOMException('Đã hủy tra danh bạ', 'AbortError')
    const myUuid = this.authService.getCurrentUserUuid()
    const myExtension = this.authService.getCurrentExtension()
    const departmentKey = department.trim().normalize('NFC').toLocaleLowerCase('vi')
    /** Giữ người thuộc bộ phận đã chọn trong tập ứng viên tìm trên Wazo. */
    function matchesPage(contact) {
      return (
        contact.uuid !== myUuid &&
        (!myExtension || normalizeExtension(contact.number) !== myExtension) &&
        (!departmentKey ||
          contact.dept.trim().normalize('NFC').toLocaleLowerCase('vi') === departmentKey)
      )
    }
    const nextOffset = offset + contacts.length
    return {
      contacts: remembered.filter(matchesPage),
      nextOffset:
        contacts.length === DIRECTORY_PAGE_SIZE && (filtered === null || nextOffset < filtered)
          ? nextOffset
          : null,
      pageKey: JSON.stringify(contacts.map((contact) => [contact.uuid, contact.number])),
    }
  }

  /** Đọc description cho các UUID đã qua Dird; cùng quyền user, không quét Confd theo trang toàn danh bạ. */
  async enrichPageDepartments(contacts, { required = false, signal } = {}) {
    const missing = contacts.filter(
      (contact) => contact.uuid && !contact.dept && !contact.departmentChecked,
    )
    if (!missing.length) return
    const message = 'Tài khoản chưa có quyền đọc phòng ban từ Wazo Confd.'
    if (this.departmentReadForbidden) {
      if (required) throw new Error(message)
      return
    }
    const context = captureSessionContext()
    const fetch = createSessionFetch(context)
    const timeout = AbortSignal.timeout(4000)
    try {
      const uuids = [...new Set(missing.map((contact) => contact.uuid))]
      const params = new URLSearchParams({
        view: 'directory',
        uuid: uuids.join(','),
        limit: uuids.length,
      })
      // Chỉ đọc UUID đã thuộc nguồn Dird được cấp quyền và không mở rộng tenant bằng recurse.
      const response = await fetch(
        this.authService.getHostUrl() + '/api/confd/1.1/users?' + params,
        {
          headers: { 'X-Auth-Token': this.authService.getToken(), Accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        },
      )
      if (response.status === 403) {
        this.departmentReadForbidden = true
        throw new Error(message)
      }
      if (!response.ok) throw new Error('Chưa tải được bộ phận từ Wazo Confd.')
      const data = await response.json()
      if (!Array.isArray(data?.items) || data.items.length > uuids.length)
        throw new Error('Wazo trả danh sách bộ phận không đúng định dạng.')
      if (signal?.aborted) return
      const byUuid = new Map(data.items.map((item) => [item.uuid, item]))
      for (const contact of missing) {
        const row = byUuid.get(contact.uuid)
        if (!row) continue
        const description = String(row.description || '')
          .normalize('NFC')
          .trim()
          .replace(/\s+/g, ' ')
        Object.assign(contact, { description, dept: description, departmentChecked: true })
      }
      if (required && missing.some((contact) => !contact.departmentChecked))
        throw new Error('Chưa xác minh được bộ phận của các kết quả Wazo trong phạm vi tài khoản.')
    } catch (error) {
      if (required) throw error
    }
  }

  /** Bổ sung định danh theo lô UUID đã được server cấp; không quét các trang danh bạ. */
  async hydrateContactsByUuid(uuids) {
    const unique = [...new Set(uuids)].filter(Boolean)
    const context = captureSessionContext()
    for (let offset = 0; offset < unique.length; offset += DIRECTORY_PAGE_SIZE) {
      const batch = unique.slice(offset, offset + DIRECTORY_PAGE_SIZE)
      const missing = batch.filter((uuid) => !this.findContactByUuid(uuid)).sort()
      if (!missing.length) continue
      assertSessionContext(context)
      const key = missing.join(',')
      const existing = this.pendingUuidBatches.get(key)
      if (existing) {
        await existing
        continue
      }
      /** Chỉ ghi UUID thực sự yêu cầu, kể cả khi upstream bỏ qua bộ lọc. */
      const hydrateBatch = async () => {
        const { contacts } = await this.readDirectoryPage(
          { uuid: key, limit: missing.length, offset: 0 },
          context,
        )
        this.rememberDirectoryContacts(contacts.filter((contact) => missing.includes(contact.uuid)))
      }
      const pending = hydrateBatch()
      this.pendingUuidBatches.set(key, pending)
      try {
        await pending
      } finally {
        if (this.pendingUuidBatches.get(key) === pending) this.pendingUuidBatches.delete(key)
      }
    }
  }

  /** Xác minh một máy lẻ trong nguồn Wazo; chỉ công nhận kết quả duy nhất và đầy đủ. */
  async verifyDirectoryExtension(extension, context) {
    const data = await this.requestDirectory(
      '/directories/lookup/default',
      { term: extension },
      context,
    )
    const contacts = mapDirectoryContacts(data)
    if (
      !contacts ||
      contacts.length > LOOKUP_MAX_RESULTS ||
      Number(data.filtered) > contacts.length
    )
      throw new Error('Chưa xác minh được máy lẻ từ danh bạ Wazo.')
    const matches = new Map()
    for (const contact of contacts) {
      if (normalizeExtension(contact.number) === extension)
        matches.set(contact.uuid || contact.rawId || contact.source, contact)
    }
    if (matches.size > 1)
      throw new Error('Máy lẻ này có nhiều liên hệ. Vui lòng xác minh người nhận.')
    const match = matches.values().next().value || null
    return match ? this.rememberDirectoryContacts([match])[0] : null
  }

  /** Trạng thái chưa có dữ liệu hoặc hết hạn hiển thị Chưa rõ, kể cả khi danh bạ đã tải xong. */
  directoryContactStatus(uuid, observedAt = this.state.presenceCheckedAt[uuid]) {
    if (observedAt === undefined || Date.now() - observedAt >= PRESENCE_FRESH_MS)
      return { status: 'unknown', statusLabel: 'Chưa rõ' }
    const status = this.statusOf(uuid)
    return { status: status.key, statusLabel: status.label }
  }

  /** Đọc riêng danh sách yêu thích khi vào tab; chỉ cắt trang trong tập yêu thích của chính user. */
  async getFavoritePage({ term = '', offset = 0, signal } = {}) {
    const context = captureSessionContext()
    if (offset === 0 || !this.state.favoriteContacts.length) {
      const data = await this.requestDirectory(
        '/directories/favorites/default',
        {},
        context,
        signal,
      )
      const contacts = mapDirectoryContacts(Array.isArray(data) ? { items: data } : data)
      if (!contacts) throw new Error('Wazo trả danh sách yêu thích không hợp lệ.')
      for (const contact of contacts) contact.isFavorite = true
      this.state.favoriteIds = [
        ...new Set(contacts.flatMap((contact) => [contact.rawId, contact.uuid]).filter(Boolean)),
      ]
      this.state.favoriteContacts = this.rememberDirectoryContacts(contacts)
    }
    const normalized = normalizeDirectoryText(term)
    const items = this.state.favoriteContacts.filter(
      (contact) =>
        contact.isFavorite &&
        (!normalized ||
          [contact.name, contact.number].some((value) =>
            normalizeDirectoryText(value).includes(normalized),
          )),
    )
    const contacts = items.slice(offset, offset + DIRECTORY_PAGE_SIZE)
    const nextOffset = offset + contacts.length
    return {
      contacts,
      nextOffset: nextOffset < items.length ? nextOffset : null,
      pageKey: JSON.stringify(contacts.map((contact) => [contact.id, contact.number])),
    }
  }

  /** Tạo khóa gần đây theo máy chủ và UUID của tài khoản đã đăng nhập. */
  recentDirectoryKey() {
    const userUuid = this.authService.getCurrentUserUuid()
    const tenant =
      this.authService.session?.tenantUuid || this.authService.session?.tenant_uuid || ''
    if (!userUuid) return ''
    return (
      'smartcall_directory_recent:' +
      JSON.stringify([this.authService.getHostUrl(), tenant, userUuid])
    )
  }

  /** Chỉ đọc metadata gần đây của tài khoản hiện tại và gắn presence từ cache trong phiên. */
  getRecentContacts() {
    const key = this.recentDirectoryKey()
    // Đọc revision để Vue làm mới danh sách sau khi người dùng chọn hoặc xóa.
    if (!key || this.state.recentRevision < 0) return []
    try {
      const items = JSON.parse(localStorage.getItem(key) || '[]')
      if (!Array.isArray(items)) return []
      return items
        .slice(0, 10)
        .filter((item) => item?.uuid && typeof item.number === 'string')
        .map(
          (item) =>
            this.findContactByUuid(item.uuid) || {
              ...item,
              id: item.uuid,
              ...this.directoryContactStatus(item.uuid),
              isFavorite: this.isFavorite(item.uuid),
            },
        )
    } catch {
      return []
    }
  }

  /** Nhớ người đã được chọn, không lưu từ khóa gõ dở hay trạng thái online trên máy. */
  rememberRecentContact(contact) {
    const key = this.recentDirectoryKey()
    if (!key || !contact?.uuid || !contact.number) return
    const remaining = this.getRecentContacts().filter((item) => item.uuid !== contact.uuid)
    const items = [contact, ...remaining].slice(0, 10)
    try {
      localStorage.setItem(
        key,
        JSON.stringify(
          items.map(({ uuid, name, number, dept, source, rawId }) => ({
            uuid,
            name,
            number,
            dept,
            source,
            rawId,
          })),
        ),
      )
      this.state.recentRevision++
    } catch {
      // Bộ nhớ trình duyệt có thể bị tắt; thao tác gọi và chat vẫn tiếp tục.
    }
  }

  /** Xóa lịch sử gần đây của tài khoản hiện tại. */
  clearRecentContacts() {
    const key = this.recentDirectoryKey()
    if (!key) return
    try {
      localStorage.removeItem(key)
      this.state.recentRevision++
    } catch {
      // Chủ phiên có thể không cấp quyền dùng localStorage.
    }
  }

  /** Tải danh sách yêu thích từ Dird và nhận biết nguồn directory cần dùng khi bật/tắt favorite. */
  async fetchFavorites() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    try {
      const token = this.authService.getToken()
      // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
      // tạo token thay thế.
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

      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
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

  /**
   * Gộp request trùng, chỉ cập nhật yêu thích sau ACK; 404 thử nguồn đã biết, lỗi khác được trả
   * cho UI.
   */
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
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
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

  /** Đối chiếu các định danh hợp lệ của liên hệ với danh sách favorite đang giữ trong RAM. */
  isFavorite(id, uuid = null, number = null) {
    if (!id && !uuid && !number) return false
    return (
      Boolean(id && (this.favoriteIds || []).includes(String(id))) ||
      Boolean(uuid && (this.favoriteIds || []).includes(String(uuid))) ||
      Boolean(number && (this.favoriteIds || []).includes(String(number)))
    )
  }

  /**
   * Quy đổi presence/line/DND thành trạng thái Web theo thứ tự ưu tiên bận, đổ chuông, DND và
   * online/offline.
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
      : p.connected === true ||
        p.state === 'available' ||
        p.state === 'online' ||
        p.line_state === 'available'
    if (!online || p.state === 'unavailable' || p.state === 'offline')
      return { key: 'offline', label: 'Ngoại tuyến' }
    if (p.state === 'away') return { key: 'away', label: 'Vắng mặt' }
    return { key: 'online', label: 'Trực tuyến' }
  }

  /** Kiểm tra liên hệ theo UUID/máy lẻ/object có đang đủ điều kiện nhận cuộc gọi hay không. */
  isContactAvailableForCall(contactOrUuidOrExt) {
    if (!contactOrUuidOrExt) return false
    let contact = null
    let uuid = ''
    if (typeof contactOrUuidOrExt === 'object') {
      contact = contactOrUuidOrExt
      uuid = contact.uuid || ''
    } else {
      const str = String(contactOrUuidOrExt).trim()
      contact = this.findContactByExtension(str) || this.findContactByUuid(str)
      uuid = contact?.uuid || (this.presences?.[str] ? str : '')
    }

    // Presence cũ không được phép cấp quyền mời. Caller làm mới theo lô trước khi gửi lệnh.
    if (
      uuid &&
      this.state.presenceCheckedAt[uuid] !== undefined &&
      this.directoryContactStatus(uuid).status === 'unknown'
    )
      return false
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

  /** Trả danh sách cho caller nền. Khi tải lỗi, giữ danh sách đã có của phiên hiện tại. */
  async getContacts() {
    const result = await this.refreshDirectory()
    return result.contacts
  }

  /** Dùng chung một lượt tải trong cùng phiên, kể cả khi nhiều màn hình mở cùng lúc. */
  refreshDirectory() {
    const sessionContext = captureSessionContext()
    const pending = this.pendingDirectoryRefresh
    if (pending && isSessionContextCurrent(pending.sessionContext)) return pending.promise

    // Chỉ dọn lượt tải mà callback này sở hữu. Phiên mới có thể đã bắt đầu lượt khác.
    const clearPendingRefresh = () => {
      if (this.pendingDirectoryRefresh?.promise === promise) this.pendingDirectoryRefresh = null
    }
    const promise = this.fetchDirectory(sessionContext).finally(clearPendingRefresh)
    this.pendingDirectoryRefresh = { sessionContext, promise }
    return promise
  }

  /** Tải danh bạ Dird, bổ sung phòng ban/presence và báo rõ dữ liệu mới hay dữ liệu cũ. */
  async fetchDirectory(sessionContext) {
    const fetch = createSessionFetch(sessionContext)
    try {
      await this.fetchFavorites()
      assertSessionContext(sessionContext)
      const favorites = this.favoriteIds || []
      const token = this.authService.getToken()
      // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
      // tạo token thay thế.
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
            // Đọc trang danh bạ tối đa 1.000 mục từ nguồn đã chọn.
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
        assertSessionContext(sessionContext)
        return { status: 'cached', contacts: this.currentContacts }
      }

      let contacts = mapDirectoryContacts(contactsData, {
        favoriteIds: favorites,
        defaultSource: this.defaultSourceName || 'wazo_user',
      })
      if (contacts === null) return { status: 'cached', contacts: this.currentContacts }
      contacts = await this.loadContactDescriptions(contacts)
      assertSessionContext(sessionContext)
      for (const contact of contacts.filter((item) => item.isFavorite)) {
        for (const id of [contact.id, contact.uuid, contact.rawId, contact.number]) {
          if (id && !this.favoriteIds.includes(id)) this.favoriteIds.push(id)
        }
      }
      this.synchronizeCurrentUserDepartment(contacts)
      const finalContacts = await this.loadPresencesForContacts(contacts)
      assertSessionContext(sessionContext)
      this.startPresencePolling()
      return { status: 'updated', contacts: this.publishDirectory(finalContacts) }
    } catch (error) {
      // Phiên đã đổi thì không trả danh bạ thuộc tài khoản đang đăng nhập sau đó.
      if (!isSessionContextCurrent(sessionContext)) return { status: 'cancelled', contacts: [] }
      logger.warn('API', 'Không thể nạp danh bạ từ máy chủ Wazo:', error.message)
      return { status: 'cached', contacts: this.currentContacts }
    }
  }

  /** Bổ sung description trực tiếp từ Wazo khi nguồn Dird chưa trả field này, không gọi backend riêng. */
  async loadContactDescriptions(contacts) {
    const context = captureSessionContext()
    const request = createSessionFetch(context)
    const unresolved = new Set(
      contacts
        .filter((contact) => contact.uuid && !contact.description)
        .map((contact) => contact.uuid),
    )
    if (!unresolved.size) return contacts
    const descriptions = new Map()
    try {
      for (let offset = 0; offset < 10000 && unresolved.size; offset += 100) {
        const response = await request(
          this.authService.getHostUrl() +
            '/api/confd/1.1/users?recurse=true&limit=100&offset=' +
            offset,
          {
            headers: { 'X-Auth-Token': this.authService.getToken() },
            signal: AbortSignal.timeout(3000),
          },
        )
        if (!response.ok) {
          logger.warn(
            'API',
            `Chưa đọc được description từ Confd (HTTP ${response.status}); giữ danh bạ Dird.`,
          )
          break
        }
        const data = await response.json()
        if (!Array.isArray(data.items)) break
        for (const user of data.items) {
          if (!unresolved.has(user.uuid)) continue
          if (typeof user.description === 'string')
            descriptions.set(
              user.uuid,
              user.description.normalize('NFC').trim().replace(/\s+/g, ' '),
            )
          unresolved.delete(user.uuid)
        }
        if (
          data.items.length < 100 ||
          (Number.isInteger(data.total) && offset + data.items.length >= data.total)
        )
          break
      }
    } catch (error) {
      if (!isSessionContextCurrent(context)) throw error
      logger.warn('API', 'Không bổ sung được description; giữ dữ liệu Wazo Dird hiện tại.')
    }
    assertSessionContext(context)
    return contacts.map((contact) =>
      descriptions.has(contact.uuid)
        ? {
            ...contact,
            description: descriptions.get(contact.uuid),
            dept: descriptions.get(contact.uuid),
          }
        : contact,
    )
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

  /** Bỏ liên hệ trùng và liên hệ của chính mình trước khi công bố danh bạ cho các màn hình. */
  publishDirectory(list) {
    const meUuid = this.authService.session?.uuid || localStorage.getItem('smartcall_user_uuid')
    let meExten = this.authService.getCurrentExtension()
    /** Bỏ domain/khoảng trắng khỏi máy lẻ để so sánh các giá trị từ API/SDK cùng một quy tắc. */
    const cleanExt = (n) =>
      String(n || '')
        .split('@')[0]
        .trim()

    // Tự động nhận diện số máy lẻ của chính mình nếu session chưa kịp điền (giống mã nguồn tham
    // chiếu mẫu)
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

  /** Tải trạng thái cho các UUID trong danh bạ theo lô và cập nhật nhãn trạng thái từng liên hệ. */
  async loadPresencesForContacts(contacts, invalidateOnFailure = false) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!Array.isArray(contacts) || contacts.length === 0) return contacts
    const token = this.authService.getToken()
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) return contacts

    const host = this.authService.host.startsWith('http')
      ? this.authService.host
      : `https://${this.authService.host}`
    const uuids = [...new Set(contacts.map((contact) => contact.uuid).filter(Boolean))]
    const pendingRevisions = new Map(uuids.map((uuid) => [uuid, this.presenceRevisions.get(uuid)]))
    /** Khi snapshot không xác nhận được người nhận, bỏ giá trị cũ nếu chưa có event mới. */
    const markUnknown = (uuid) => {
      if (pendingRevisions.get(uuid) !== this.presenceRevisions.get(uuid)) return
      delete this.presences[uuid]
      this.state.presenceCheckedAt[uuid] = -Infinity
      this.presenceRevisions.set(uuid, Symbol())
      const contact = this.state.identities.get(uuid)
      if (contact) this.applyDirectoryPresence(contact)
    }

    if (uuids.length === 0) return contacts

    try {
      for (let offset = 0; offset < uuids.length; offset += DIRECTORY_PAGE_SIZE) {
        const batch = uuids.slice(offset, offset + DIRECTORY_PAGE_SIZE)
        const res = await fetch(
          `${host}/api/chatd/1.0/users/presences?user_uuid=${batch.map(encodeURIComponent).join(',')}`,
          {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(3000),
          },
        )
        if (!res.ok) {
          if (invalidateOnFailure) for (const uuid of batch) markUnknown(uuid)
          continue
        }
        const data = await res.json()
        const items = Array.isArray(data.items)
          ? data.items
          : data.items && typeof data.items === 'object'
            ? Object.entries(data.items).map(([uuid, presence]) => ({ uuid, ...presence }))
            : []
        const byUuid = new Map(items.map((item) => [item.uuid || item.user_uuid, item]))
        for (const uuid of batch) {
          // Một event hoặc request mới hơn đã cập nhật thì response này không được ghi đè.
          if (pendingRevisions.get(uuid) !== this.presenceRevisions.get(uuid)) continue
          if (byUuid.has(uuid)) this.storeDirectoryPresence(uuid, byUuid.get(uuid))
          else markUnknown(uuid)
        }
      }
    } catch (e) {
      if (invalidateOnFailure && isSessionContextCurrent(sessionContext))
        for (const uuid of uuids) markUnknown(uuid)
      logger.warn('API', 'Không thể nạp trạng thái presence từ chatd:', e.message)
    }
    if (isSessionContextCurrent(sessionContext)) {
      for (const contact of contacts) this.applyDirectoryPresence(contact)
    }
    return contacts
  }

  /** Gắn nhãn và cờ thiết bị theo snapshot của UUID vào bản ghi liên hệ. */
  applyDirectoryPresence(contact) {
    const uuid = contact.uuid
    const status = this.directoryContactStatus(uuid)
    const presence = this.presences[uuid]
    const label = String(presence?.status || '').toLowerCase()
    Object.assign(contact, status, {
      isMobileApp: Boolean(
        presence &&
        status.status !== 'offline' &&
        status.status !== 'unknown' &&
        (presence.mobile ||
          label.includes('android') ||
          presence.lines?.some((line) => line.mobile)),
      ),
    })
  }

  /** Ghi snapshot theo thứ tự nhận và giữ trạng thái cho những UUID thực sự cần hiển thị. */
  storeDirectoryPresence(uuid, record) {
    this.presenceRevisions.set(uuid, Symbol())
    this.presences[uuid] = record
    this.state.presenceCheckedAt[uuid] = Date.now()
    const contact = this.state.identities.get(uuid)
    if (contact) this.applyDirectoryPresence(contact)
  }

  /** Đánh dấu snapshot cần làm mới khi socket rớt và bỏ các REST response bắt đầu trước đó. */
  invalidateDirectoryPresence() {
    const uuids = new Set([
      ...Object.keys(this.state.presenceCheckedAt),
      ...this.pendingPresence.keys(),
    ])
    this.pendingPresence.clear()
    for (const uuid of uuids) {
      this.presenceRevisions.set(uuid, Symbol())
      this.state.presenceCheckedAt[uuid] = -Infinity
      const contact = this.state.identities.get(uuid)
      if (contact) this.applyDirectoryPresence(contact)
    }
  }

  /**
   * Áp dụng một event presence vào bản đồ UUID và liên hệ tương ứng, không đoán người dùng bằng
   * tên.
   */
  updateSinglePresence(presenceRecord) {
    const uuid = presenceRecord?.uuid || presenceRecord?.user_uuid
    if (!uuid) return
    if (
      this.state.identities.has(uuid) ||
      this.state.presenceCheckedAt[uuid] !== undefined ||
      this.currentContacts.some((contact) => contact.uuid === uuid)
    ) {
      this.storeDirectoryPresence(uuid, { ...this.presences[uuid], ...presenceRecord })
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
    }
  }

  /** Khởi động một timer làm mới presence khi đã có danh bạ/phiên; không nhân đôi timer. */
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

  /** Hủy timer presence để callback cũ không tiếp tục tải/cập nhật sau khi phiên bị dọn. */
  stopPresencePolling() {
    if (this.presencePollTimer) {
      clearInterval(this.presencePollTimer)
      this.presencePollTimer = null
    }
  }

  /** Dừng polling và xóa danh bạ/presence/favorite/request tạm để không lẫn dữ liệu giữa tài khoản. */
  reset() {
    this.pendingFavorites.clear()
    this.pendingDirectoryRefresh = null
    this.pendingLookups.clear()
    this.pendingPresence.clear()
    this.pendingUuidBatches.clear()
    this.extensionChecks.clear()
    this.presenceRevisions.clear()
    this.pendingSource = null
    this.directorySource = null
    this.departmentReadForbidden = false
    this.state.identities.clear()
    this.state.favoriteContacts = []
    this.state.presenceCheckedAt = {}
    this.defaultSourceName = 'wazo_user'
    this.wazoSourceUuid = ''
    this.stopPresencePolling()
    this.currentContacts = []
    this.presences = {}
    this.favoriteIds = []
    logger.info('API', 'Đã dọn dẹp sạch toàn bộ cache danh bạ và hiện diện.')
  }

  /** Tìm liên hệ trong cache hiện tại bằng máy lẻ đã chuẩn hóa, không tự gọi HTTP. */
  findContactByExtension(ext) {
    if (!ext) return null
    const cleanTarget = String(ext).split('@')[0].trim()
    const verified = this.extensionChecks.get(cleanTarget)
    // Kết quả tra chính xác mới hơn cache giao diện có thể biết số vừa đổi người sử dụng.
    if (verified && Date.now() - verified.time < 15000) return verified.contact
    const pool = [...this.currentContacts, ...this.state.identities.values()]
    const matches = new Map()
    for (const contact of pool) {
      if (normalizeExtension(contact.number) === cleanTarget || contact.uuid === cleanTarget)
        matches.set(contact.uuid || contact.rawId || contact.id, contact)
    }
    return matches.size === 1 ? matches.values().next().value : null
  }

  /** Ưu tiên cache; nếu thiếu thì tra Dird trong context hiện tại để hỗ trợ gọi/chat theo máy lẻ. */
  async getOrLookupContact(ext) {
    const extension = normalizeExtension(ext)
    if (!extension) return null
    const checked = this.extensionChecks.get(extension)
    if (checked && Date.now() - checked.time < 15000) return checked.contact
    if (this.pendingLookups.has(extension)) return this.pendingLookups.get(extension)
    const context = captureSessionContext()
    const pending = this.verifyDirectoryExtension(extension, context)
    this.pendingLookups.set(extension, pending)
    try {
      const contact = await pending
      assertSessionContext(context)
      if (this.extensionChecks.size >= IDENTITY_CACHE_LIMIT)
        this.extensionChecks.delete(this.extensionChecks.keys().next().value)
      if (contact) this.extensionChecks.set(extension, { contact, time: Date.now() })
      return contact
    } finally {
      if (this.pendingLookups.get(extension) === pending) this.pendingLookups.delete(extension)
    }
  }

  /** Người chọn từ trang phân trang cần kiểm tra máy lẻ hiện còn thuộc đúng UUID trước khi gọi. */
  isPagedIdentity(contact) {
    return Boolean(contact?.uuid && this.state.identities.has(contact.uuid))
  }

  /** Chỉ dùng cache cho quyền gọi nhóm nếu đã đối chiếu máy lẻ và UUID với Wazo trong lượt gần đây. */
  isVerifiedExtensionOwner(contact) {
    const checked = this.extensionChecks.get(normalizeExtension(contact?.number))
    return Boolean(
      contact?.uuid && checked?.contact?.uuid === contact.uuid && Date.now() - checked.time < 15000,
    )
  }

  /** Nạp lại trạng thái còn thiếu/quá hạn, giữ tối đa một lô nhỏ cho mỗi request. */
  async refreshDirectoryPresence(contacts, force = false) {
    const needsPresence = contacts.filter(
      (contact) =>
        contact?.uuid && (force || this.directoryContactStatus(contact.uuid).status === 'unknown'),
    )
    const pending = new Set()
    const fresh = []
    for (const contact of needsPresence) {
      const inFlight = this.pendingPresence.get(contact.uuid)
      if (inFlight) pending.add(inFlight)
      else fresh.push(contact)
    }
    if (fresh.length) {
      const request = this.loadPresencesForContacts(fresh, force)
      for (const contact of fresh) this.pendingPresence.set(contact.uuid, request)
      try {
        await request
      } finally {
        for (const contact of fresh) {
          if (this.pendingPresence.get(contact.uuid) === request)
            this.pendingPresence.delete(contact.uuid)
        }
      }
    }
    await Promise.all(pending)
    return contacts
  }

  /** Đọc cache tên cho cuộc gọi đang hiện và giữ độc lập với trang danh bạ đã chọn. */
  getKnownContacts() {
    return [...this.currentContacts, ...this.state.identities.values()]
  }

  /** Tra và xác nhận từng người mời trước khi gửi lệnh, kể cả khi người đó ở trang khác. */
  async prepareGroupTargets(targets) {
    const context = captureSessionContext()
    const candidates = new Map()
    const rejected = []
    for (const target of targets) {
      const extension = normalizeExtension(typeof target === 'object' ? target?.number : target)
      if (!extension || extension === this.authService.getCurrentExtension()) continue
      candidates.set(extension, typeof target === 'object' ? target.uuid : null)
    }
    const resolved = []
    for (const [extension, expectedUuid] of candidates) {
      assertSessionContext(context)
      try {
        const cached = this.findContactByExtension(extension)
        const contact =
          !cached || expectedUuid || this.isPagedIdentity(cached)
            ? await this.getOrLookupContact(extension)
            : cached
        if (!contact || (expectedUuid && contact.uuid !== expectedUuid)) {
          rejected.push(
            extension + (expectedUuid && contact ? ' (đã đổi người dùng)' : ' (chưa tìm được)'),
          )
          continue
        }
        resolved.push(contact)
      } catch {
        rejected.push(extension + ' (chưa xác minh được)')
      }
    }
    assertSessionContext(context)
    await this.refreshDirectoryPresence(
      resolved.filter((contact) => this.isPagedIdentity(contact)),
      true,
    )
    assertSessionContext(context)
    const extensions = []
    for (const contact of resolved) {
      if (this.isContactAvailableForCall(contact))
        extensions.push(normalizeExtension(contact.number))
      else rejected.push(contact.name + ' (' + (contact.statusLabel || 'không khả dụng') + ')')
    }
    return { extensions, rejected }
  }

  /**
   * Tìm liên hệ theo UUID/định danh có trong danh bạ hiện tại; không suy danh tính từ tên hiển
   * thị.
   */
  findContactByUuid(uuid) {
    if (!uuid) return null
    const cleanUuid = String(uuid).trim()
    const pool = Array.isArray(this.currentContacts) ? this.currentContacts : []
    return (
      this.state.identities.get(cleanUuid) ||
      pool.find((c) => c.uuid === cleanUuid || c.id === cleanUuid) ||
      null
    )
  }

  /**
   * Phân giải máy lẻ thành UUID từ cache hoặc Dird để request chat/nhóm dùng đúng định danh
   * server.
   */
  async resolveUserUuid(ext) {
    const cached = this.findContactByExtension(ext)
    if (cached?.uuid && !this.isPagedIdentity(cached)) return cached.uuid
    const contact = await this.getOrLookupContact(ext)
    return contact?.uuid || null
  }
}
