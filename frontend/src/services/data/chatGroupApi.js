import {
  captureSessionContext,
  assertSessionContext,
  createSessionFetch,
  isSessionContextCurrent,
} from '../auth/sessionScope.js'
import { formatMessageDateTime } from '../../utils/formatMessageDateTime.js'

/** Điều phối nhóm do backend SmartCall quản lý, dùng chung nguồn state với ChatService. */
export class ChatGroupApi {
  /** Nhận service sở hữu phiên và danh bạ để ánh xạ UUID thành tên hiển thị. */
  constructor(chat) {
    this.chat = chat
    this.enabled = import.meta.env.VITE_MANAGED_CHAT === 'true'
    this.pendingWrites = new Map()
    this.cursor = null
    this.timer = null
    this.running = false
  }

  /** Nhận diện ID nhóm logic tách biệt với UUID phòng vật lý của Chatd. */
  owns(id) {
    return typeof id === 'string' && id.startsWith('group:')
  }

  /** Gửi request cùng origin và kiểm tra phiên trước khi nhận body. */
  async request(path, method = 'GET', body, revision, key) {
    const headers = { 'X-Auth-Token': this.chat.authService.getToken() }
    if (body) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') headers['Idempotency-Key'] = key || crypto.randomUUID()
    if (revision != null) headers['If-Match'] = String(revision)
    const res = await createSessionFetch()('/api/chat/v1/' + path, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok && path.startsWith('events')) {
      const stream = await res.text()
      const line = stream.split('\n').find((item) => item.startsWith('data: '))
      if (!line) throw new Error('Thiếu sự kiện đồng bộ nhóm.')
      return JSON.parse(line.slice(6))
    }
    const data = await res.json()
    if (!res.ok) {
      const error = new Error(data.detail?.message || 'Không tải được nhóm SmartCall.')
      error.definitive = res.status < 500 && data.detail?.code !== 'OPERATION_PENDING'
      throw error
    }
    return data
  }

  /** Ánh xạ snapshot quyền do backend xác nhận và bảo toàn trang lịch sử đã mở. */
  room(data) {
    const id = 'group:' + data.groupId
    const old = this.chat.rooms.find((room) => room.id === id)
    if (old?.version > data.version) return old
    const members = data.members.map((uuid) => {
      const contact = this.chat.contactService.findContactByUuid(uuid)
      return {
        id: uuid,
        uuid,
        name: contact?.name || uuid,
        ext: contact?.number || '',
        dept: contact?.dept || '',
      }
    })
    return {
      ...old,
      ...data,
      id,
      members,
      memberCount: members.length,
      isDirect: false,
      isGroup: true,
      adminVerified: data.status === 'active',
      isClosed: data.status === 'closed',
      isKicked: data.status === 'removed',
      messages: old?.messages || [],
      avatarBg: '#405d81',
      preview: data.preview || '',
      updatedAt: data.lastMessageAt ? Date.parse(data.lastMessageAt) : 0,
    }
  }

  /** Tái sử dụng khóa khi mạng đứt để lượt gửi lại nhận đúng kết quả đã commit. */
  async write(path, method, body, revision, message = false) {
    const signature = JSON.stringify([path, method, body, revision])
    const key = this.pendingWrites.get(signature) || crypto.randomUUID()
    this.pendingWrites.set(signature, key)
    try {
      const result = await this.request(
        path,
        method,
        message ? { ...body, clientMessageId: key } : body,
        revision,
        key,
      )
      this.pendingWrites.delete(signature)
      return result
    } catch (error) {
      if (error.definitive) this.pendingWrites.delete(signature)
      else if (error.name !== 'AbortError')
        throw new Error(`Chưa xác nhận kết quả. Mã tra cứu ${key}.`, { cause: error })
      throw error
    }
  }

  /** Đọc từng trang metadata, không truy vấn lịch sử từng nhóm. */
  async list() {
    const context = captureSessionContext()
    let cursor = 0
    const items = []
    do {
      const page = await this.request('groups?limit=100&cursor=' + cursor)
      assertSessionContext(context)
      for (const data of page.items) items.push(this.room(data))
      cursor = page.nextCursor
    } while (cursor != null)
    return items
  }

  /** Áp dụng snapshot vừa nhận vào đúng nhóm logic. */
  apply(data) {
    const room = this.room(data)
    const old = this.chat.rooms.find((item) => item.id === room.id)
    if (old) Object.assign(old, room)
    else this.chat.rooms.push(room)
    this.chat.publishRoomsChanged()
    return old || room
  }

  /** Đọc lại roster và quyền tại thời điểm bấm gọi. */
  async refresh(id) {
    return this.apply(await this.request('groups/' + id.slice(6)))
  }

  /** Thực hiện thao tác quản trị theo revision người dùng đang xem. */
  async command(id, suffix, method, body) {
    const room = this.chat.rooms.find((item) => item.id === id)
    const path = id ? 'groups/' + id.slice(6) + suffix : 'groups'
    const data = await this.write(path, method, body, room?.revision)
    return this.apply(data)
  }

  /** Giữ nguyên tác giả, nội dung và giờ gốc khi hiển thị tin có cùng source ID. */
  message(row) {
    const mine = row.author === this.chat.authService.getCurrentUserUuid()
    return {
      id: row.source,
      user_uuid: row.author,
      sender: mine ? 'mine' : 'theirs',
      senderName: mine
        ? 'Tôi'
        : this.chat.contactService.findContactByUuid(row.author)?.name || row.author,
      text: row.content,
      timestamp: Date.parse(row.created),
      time: formatMessageDateTime(row.created),
      sequence: row.seq,
    }
  }

  /** Ghép trang theo mã nguồn để không lặp tin khi nhiều request trả về cùng lúc. */
  async history(id, older = false) {
    const room = this.chat.rooms.find((item) => item.id === id)
    if (!room || (older && !room.nextCursor)) return room?.messages || []
    const cursor = older ? '?cursor=' + room.nextCursor : ''
    const page = await this.request('groups/' + id.slice(6) + '/messages' + cursor)
    const target = this.chat.rooms.find((item) => item.id === id)
    if (!target) return []
    const byId = new Map(target.messages.map((message) => [message.id, message]))
    // Mất kết nối lâu có thể bỏ sót nhiều trang. Dùng cursor của trang mới khi hai khoảng không giao nhau.
    const gap = !older && !page.items.some((row) => byId.has(row.source))
    if (gap) byId.clear()
    for (const row of page.items) byId.set(row.source, this.message(row))
    if (gap || older || target.nextCursor === undefined) target.nextCursor = page.nextCursor
    target.messages = [...byId.values()].sort((a, b) => a.sequence - b.sequence)
    const last = target.messages.at(-1)
    if (last) {
      target.preview = last.text
      target.updatedAt = last.timestamp
    }
    this.chat.publishRoomsChanged()
    return target.messages
  }

  /** Gửi theo activation hiện tại, xác nhận từ backend trước khi thêm tin vào UI. */
  async send(id, text) {
    const room = this.chat.rooms.find((item) => item.id === id)
    const result = await this.write(
      'groups/' + id.slice(6) + '/messages',
      'POST',
      { content: text, expectedActivationId: room.activeActivationId },
      undefined,
      true,
    )
    const message = this.message(result)
    const target = this.chat.rooms.find((item) => item.id === id)
    if (target && !target.messages.some((item) => item.id === message.id)) {
      target.messages.push(message)
      target.preview = message.text
      target.updatedAt = message.timestamp
      this.chat.publishRoomsChanged()
    }
    return message
  }

  /** Theo dõi thay đổi theo cursor xuyên suốt phiên, dừng timer khi logout. */
  start() {
    if (!this.enabled || this.running) return
    this.running = true
    const storageKey = this.chat._getUnreadStorageKey()
    try {
      const saved = storageKey && localStorage.getItem(storageKey + ':cursor')
      if (saved && /^[0-9]+$/.test(saved)) this.cursor = Number(saved)
    } catch {
      /* Trình duyệt có thể chặn storage. */
    }
    const context = captureSessionContext()
    const self = this
    /** Chỉ tiến cursor sau khi áp dụng hết thay đổi để có thể tải lại nếu mất mạng. */
    async function sync() {
      let delay = 100
      try {
        const query = self.cursor == null ? '' : '?cursor=' + self.cursor
        const page = await self.request('events' + query)
        assertSessionContext(context)
        const ids = new Set(page.items.map((event) => event.g))
        for (const group of ids) {
          const id = 'group:' + group
          await self.refresh(id)
          if (self.chat._visibleRoomId === id) await self.history(id)
        }
        for (const event of page.items) {
          if (event.kind === 'send')
            self.chat._trackIncomingUnread(
              'group:' + event.g,
              String(event.seq),
              event.actor,
              false,
            )
        }
        assertSessionContext(context)
        self.cursor = page.cursor
        try {
          if (storageKey) localStorage.setItem(storageKey + ':cursor', String(page.cursor))
        } catch {
          /* Vẫn đồng bộ trong RAM. */
        }
      } catch {
        // Khi mất kết nối, thử lại từ cursor cuối sau một khoảng nghỉ.
        delay = 4000
      }
      if (self.running && isSessionContextCurrent(context)) self.timer = setTimeout(sync, delay)
    }
    void sync()
  }

  /** Xóa cursor của tài khoản cũ và hủy đồng bộ nền. */
  reset() {
    this.running = false
    clearTimeout(this.timer)
    this.pendingWrites.clear()
    this.cursor = null
  }
}
