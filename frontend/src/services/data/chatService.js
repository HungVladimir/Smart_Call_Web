import { formatMessageDateTime } from '../../utils/formatMessageDateTime.js'
import { reactive } from 'vue'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../auth/sessionScope.js'

import { logger } from '../common/loggerService.js'

/** Sở hữu phòng chat và tin nhắn Web; chỉ cập nhật lệnh quản trị sau khi API xác nhận. */
export class ChatService {
  /**
   * Giữ dependency và state rooms, đăng ký nhận event chat để cập nhật hội thoại theo thời gian
   * thực.
   */
  constructor({ authService, contactService, eventHub }) {
    Object.assign(this, { authService, contactService, eventHub })
    this.state = reactive({ rooms: [], unreadByRoom: Object.create(null) })
    this._fetchingRoomsPromise = null
    this._closedRoomIds = new Set()
    this._seenIncomingMessageIds = new Map()
    this._visibleRoomId = null
    this._unreadStorageKey = null
    if (typeof window !== 'undefined') {
      // Lắng nghe sự kiện tin nhắn thời gian thực tập trung tại tầng dịch vụ (SSOT)
      this.eventHub.on('chatd_user_room_message_created', (data) =>
        this.handleIncomingMessage(data),
      )
      this.eventHub.on('chatd_user_message_created', (data) => this.handleIncomingMessage(data))
      this.eventHub.on('chatd_user_room_created', () => {
        this.getRooms().catch(() => {})
      })
    }
  }

  /** Đọc/cập nhật nguồn rooms reactive duy nhất để mọi View theo dõi cùng dữ liệu. */
  get rooms() {
    return this.state.rooms
  }
  /**
   * Gán giá trị mới vào state rooms để các nơi đang theo dõi cùng nhận thay đổi; bản thân setter
   * không ghi dữ liệu lên server.
   */
  set rooms(value) {
    this.state.rooms = value
  }

  /** Tổng tin đến chưa mở trong các phòng đang hiển thị, dùng chung cho badge menu và danh sách. */
  get totalUnread() {
    return this.rooms.reduce((total, room) => total + this.getUnreadCount(room.id), 0)
  }

  /** Lấy số tin đến chưa mở của một phòng; dữ liệu được khôi phục từ cache riêng của tài khoản. */
  getUnreadCount(roomId) {
    return this.state.unreadByRoom[roomId]?.size || 0
  }

  /** Khóa cache chỉ dùng cho bộ đếm, tách theo máy chủ và UUID; không dùng tài khoản mặc định dùng chung. */
  _getUnreadStorageKey() {
    const userUuid = this.authService.getCurrentUserUuid()
    if (!userUuid) return null
    const host = this.authService.getHostUrl().replace(/\/+$/, '').toLowerCase()
    return `smartcall_unread_v1:${encodeURIComponent(host)}:${encodeURIComponent(userUuid)}`
  }

  /** Nạp cache khi đã xác định đúng tài khoản; đổi owner sẽ dọn bộ đếm cũ trước khi khôi phục. */
  _restoreUnreadState() {
    const key = this._getUnreadStorageKey()
    if (key === this._unreadStorageKey) return
    this._unreadStorageKey = key
    this.state.unreadByRoom = Object.create(null)
    this._seenIncomingMessageIds.clear()
    this._visibleRoomId = null
    if (!key) return
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null')
      if (saved?.version !== 1 || !saved.rooms || typeof saved.rooms !== 'object') return
      for (const [roomId, state] of Object.entries(saved.rooms)) {
        if (!state || !Array.isArray(state.unread) || !Array.isArray(state.seen)) continue
        // Chỉ nhận ID ngắn hợp lệ từ cache; bỏ metadata hỏng thay vì để lỗi lan sang nhận tin.
        const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 256
        const unread = state.unread.filter(validId)
        if (unread.length) this.state.unreadByRoom[roomId] = new Set(unread)
        this._seenIncomingMessageIds.set(
          roomId,
          new Set([...state.seen.filter(validId).slice(-1000), ...unread]),
        )
      }
    } catch {
      // Cache hỏng/bị chặn không được làm hỏng đăng nhập hoặc nhận tin thời gian thực.
      logger.warn('CHAT', 'Không khôi phục được bộ đếm tin nhắn trên trình duyệt.')
    }
  }

  /** Lưu ID chưa mở và tối đa 1000 ID gần nhất/phòng; không lưu nội dung, token hoặc hồ sơ. */
  _persistUnreadState() {
    const key = this._unreadStorageKey
    if (!key || key !== this._getUnreadStorageKey()) return // Không ghi cache A bằng state đã chuyển sang B.
    try {
      const rooms = Object.create(null)
      for (const [roomId, seen] of this._seenIncomingMessageIds) {
        rooms[roomId] = {
          unread: [...(this.state.unreadByRoom[roomId] || [])],
          seen: [...seen].slice(-1000),
        }
      }
      localStorage.setItem(key, JSON.stringify({ version: 1, rooms }))
    } catch {
      // Hết quota hoặc chế độ chặn storage: vẫn nhận tin/đếm trong RAM, không báo lưu thành công giả.
      logger.warn('CHAT', 'Không lưu được bộ đếm tin nhắn trên trình duyệt.')
    }
  }

  /** Sidebar khôi phục số sau login/F5, rồi đối chiếu phòng thật trên server trước khi hiển thị tổng. */
  async restoreUnreadNotifications() {
    this._restoreUnreadState()
    if (Object.values(this.state.unreadByRoom).some((ids) => ids.size > 0)) await this.getRooms()
  }

  /** Chỉ coi hội thoại đang được xem khi màn hình đó hoạt động và cửa sổ thực sự ở phía trước. */
  _isRoomVisible(roomId) {
    return (
      this._visibleRoomId === roomId &&
      document.visibilityState !== 'hidden' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus())
    )
  }

  /** View gọi khi chọn phòng, kích hoạt lại hoặc rời màn hình; không gửi read receipt lên Wazo. */
  setVisibleRoom(roomId) {
    this._restoreUnreadState()
    this._visibleRoomId = roomId || null
    if (roomId && this._isRoomVisible(roomId) && this.state.unreadByRoom[roomId]) {
      delete this.state.unreadByRoom[roomId]
      this._persistUnreadState()
    }
  }

  /** Khử trùng theo UUID server, kể cả event đã xuất hiện trong lịch sử REST hoặc vừa được mở xem. */
  _trackIncomingUnread(roomId, messageId, senderUuid, isControlMessage) {
    this._restoreUnreadState()
    if (!messageId) return // Không tự tạo ID để đếm một event không có định danh server.
    if (!this._seenIncomingMessageIds.has(roomId))
      this._seenIncomingMessageIds.set(roomId, new Set())
    const seen = this._seenIncomingMessageIds.get(roomId)
    if (seen.has(messageId)) return
    seen.add(messageId)
    if (!senderUuid || senderUuid === this.authService.getCurrentUserUuid() || isControlMessage)
      return
    if (this._isRoomVisible(roomId)) {
      delete this.state.unreadByRoom[roomId]
      this._persistUnreadState()
      return
    }
    if (!this.state.unreadByRoom[roomId]) this.state.unreadByRoom[roomId] = new Set()
    this.state.unreadByRoom[roomId].add(messageId)
    this._persistUnreadState()
  }

  /** Sắp phòng theo hoạt động mới nhất để danh sách hội thoại hiển thị đúng thứ tự. */
  sortRooms() {
    if (!this.rooms || !Array.isArray(this.rooms)) return
    this.rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  /** Sắp danh sách và thông báo UI khi room/message đổi; silent tránh vòng tải lại do event lặp. */
  publishRoomsChanged(silent = false) {
    try {
      this.sortRooms()
      if (!silent && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
      }
    } catch (e) {
      console.warn('Lỗi cập nhật phòng chat:', e)
    }
  }

  /**
   * Chỉ nhận tag quản trị từ UUID admin đã được metadata server xác nhận, không tin alias/nội dung
   * tự khai.
   */
  isTrustedRoomCommand(room, message) {
    const sender = message?.user_uuid || message?.message?.user_uuid || ''
    const content = message?.content || message?.message?.content || ''
    // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
    // không tự cấp quyền.
    if (!room || room.isDirect || !room.adminVerified || sender !== room.adminUuid) return false
    return /^(?:🚫|🔔)?\s*\[SYSTEM:(?:ROOM_CLOSED|MSG_DELETED|ROOM_RENAME)(?::|\])/.test(content)
  }

  /** Chặn thao tác quản trị nếu server chưa xác nhận người đang đăng nhập là admin của nhóm. */
  assertRoomAdmin(room) {
    // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
    // không tự cấp quyền.
    if (!room?.adminVerified || room.adminUuid !== this.authService.getCurrentUserUuid()) {
      throw new Error(
        'Máy chủ chưa xác nhận quyền quản trị nhóm. Không thể thực hiện thao tác này an toàn.',
      )
    }
  }

  /** Đóng phòng trên giao thức SmartCall; không thay thế quyền membership của Wazo. */
  _markRoomClosed(roomId, room = this.rooms.find((item) => item.id === roomId)) {
    delete this.state.unreadByRoom[roomId]
    this._seenIncomingMessageIds.delete(roomId)
    this._persistUnreadState()
    if (this._visibleRoomId === roomId) this._visibleRoomId = null
    this._closedRoomIds.add(roomId)
    if (room) room.isClosed = true
    this.rooms = this.rooms.filter((item) => item.id !== roomId)
  }

  /** Tìm tombstone trên server, kể cả khi nó đã nằm ngoài trang lịch sử gần nhất. */
  async _verifyRoomClosure(room, context) {
    if (room.isDirect) return
    // Giữ trạng thái đóng phòng: không cho tin mới hoặc kết quả tải lại tự đưa nhóm đã đóng/chưa
    // xác minh về luồng đang mở.
    if (this._closedRoomIds.has(room.id)) {
      room.isClosed = true
      return
    }
    // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
    // không tự cấp quyền.
    if (!room.adminVerified) return // Không suy quyền quản trị từ tên hoặc thứ tự thành viên.
    const fetch = createSessionFetch(context)
    const pageSize = 100
    const seen = new Set()
    for (let page = 0; page < 100; page += 1) {
      const url = `${this.authService.getHostUrl()}/api/chatd/1.0/users/me/rooms/${encodeURIComponent(room.id)}/messages?search=${encodeURIComponent('[SYSTEM:ROOM_CLOSED')}&limit=${pageSize}&offset=${page * pageSize}`
      const res = await fetch(url, {
        headers: { 'X-Auth-Token': this.authService.getToken(), Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      })
      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (!res.ok) throw new Error(`Không xác minh được trạng thái đóng nhóm (${res.status}).`)
      const data = await res.json()
      if (!Array.isArray(data.items)) throw new Error('Dữ liệu trạng thái nhóm không hợp lệ.')
      for (const message of data.items) {
        // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag
        // text không tự cấp quyền.
        if (
          this.isTrustedRoomCommand(room, message) &&
          message.content.includes('[SYSTEM:ROOM_CLOSED')
        ) {
          this._markRoomClosed(room.id, room)
          return
        }
      }
      if (data.items.length < pageSize) return
      const signature = JSON.stringify(data.items.map((item) => item.uuid || item.id || item))
      if (seen.has(signature)) throw new Error('Máy chủ chưa hỗ trợ phân trang trạng thái nhóm.')
      seen.add(signature)
    }
    throw new Error('Chưa xác minh hết trạng thái nhóm. Vui lòng thử lại.')
  }

  // Xử lý tin nhắn đến thời gian thực qua WebSocket (Tập trung toàn hệ thống - SSOT)
  handleIncomingMessage(data) {
    if (!data) return
    // Web/Mobile có thể phát message trực tiếp hoặc bọc trong message; dùng cùng một định danh server.
    const message = data.message || data
    const roomUuid = data.room_uuid || data.room?.uuid || message.room_uuid || message.room?.uuid
    const content = message.content || data.content || data.msg || ''
    const alias = message.alias || data.alias || data.sender_name || 'Đồng nghiệp'
    const serverMessageId = message.uuid || message.id || data.uuid || data.id
    const msgId = serverMessageId || `msg-${Date.now()}-${Math.random()}`
    const createdAt = message.created_at || data.created_at
    const msgTimestamp = createdAt ? new Date(createdAt).getTime() : Date.now()
    const timeStr = formatMessageDateTime(createdAt || msgTimestamp)
    const authenticatedSender =
      message.user_uuid ||
      message.sender_uuid ||
      message.user?.uuid ||
      data.user_uuid ||
      data.sender_uuid ||
      ''

    if (!roomUuid || !content) return
    if (this._closedRoomIds.has(roomUuid)) return
    if (!this.rooms.some((room) => room.id === roomUuid)) {
      // Nạp metadata/quyền và kiểm tra tombstone trước khi hiển thị một phòng chưa biết.
      const context = captureSessionContext()
      this.getRooms()
        .then(() => {
          if (
            isSessionContextCurrent(context) &&
            this.rooms.some((room) => room.id === roomUuid) &&
            !this._closedRoomIds.has(roomUuid)
          )
            this.handleIncomingMessage(data)
        })
        .catch(() => {})
      return
    }
    const trustedCommand = this.isTrustedRoomCommand(
      this.rooms.find((room) => room.id === roomUuid),
      data,
    )

    // 0. Xử lý Tombstone giải tán / đóng phòng thời gian thực
    if (trustedCommand && content.includes('[SYSTEM:ROOM_CLOSED')) {
      logger.info(
        'CHAT',
        `Phòng [${roomUuid}] đã bị giải tán qua Tombstone SYSTEM:ROOM_CLOSED. Tự động ẩn phòng.`,
      )
      const targetRoom = (this.rooms || []).find((r) => r.id === roomUuid)
      if (targetRoom) {
        targetRoom.isClosed = true
      }
      this._markRoomClosed(roomUuid, targetRoom)
      this.publishRoomsChanged()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('smartcall-room-closed', { detail: { roomId: roomUuid } }),
        )
      }
      return
    }

    // 0.1. Xử lý Tombstone xóa tin nhắn thời gian thực
    if (trustedCommand && content.includes('[SYSTEM:MSG_DELETED:ids="')) {
      const delMatch = content.match(/\[SYSTEM:MSG_DELETED:ids="([^"]+)"/)
      if (delMatch && delMatch[1]) {
        const deletedIds = delMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        for (const id of deletedIds) this.state.unreadByRoom[roomUuid]?.delete(id)
        this._persistUnreadState()
        const targetRoom = (this.rooms || []).find((r) => r.id === roomUuid)
        if (targetRoom && targetRoom.messages) {
          targetRoom.messages = targetRoom.messages.filter((m) => !deletedIds.includes(m.id))
          if (targetRoom.messages.length > 0) {
            const last = targetRoom.messages[targetRoom.messages.length - 1]
            targetRoom.preview = last.text
            targetRoom.time = last.time
            targetRoom.updatedAt = last.timestamp
          } else {
            targetRoom.preview = 'Cuộc trò chuyện'
          }
          this.publishRoomsChanged()
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('smartcall-messages-deleted', {
              detail: { roomId: roomUuid, deletedIds },
            }),
          )
        }
      }
      return
    }

    let targetRoom = this.rooms.find((r) => r.id === roomUuid)
    if (!targetRoom) {
      const isGroup = !roomUuid.startsWith('direct-')
      targetRoom = {
        id: roomUuid,
        title: alias || 'Cuộc trò chuyện',
        preview: content,
        time: timeStr,
        avatarBg: isGroup ? '#8b5cf6' : '#3b82f6',
        icon: isGroup ? '👥' : (alias || 'CH').slice(0, 2).toUpperCase(),
        isDirect: !isGroup,
        messages: [],
        members: [],
        memberCount: isGroup ? 2 : 2,
        updatedAt: msgTimestamp,
      }
      this.rooms.unshift(targetRoom)
      // Tự động kéo thông tin phòng từ Wazo server để cập nhật chi tiết
      setTimeout(() => {
        this.getRooms().catch(() => {})
      }, 500)
    }

    if (!targetRoom.messages) targetRoom.messages = []

    this._trackIncomingUnread(roomUuid, serverMessageId, authenticatedSender, trustedCommand)
    // 1. Khử trùng tuyệt đối nếu UUID thật đã tồn tại
    const alreadyExists = targetRoom.messages.some((m) => m.id === msgId)
    if (alreadyExists) return

    const myUserUuid =
      this.authService.getCurrentUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    let senderUuid = authenticatedSender
    let senderAlias = alias
    let finalContent = content
    let finalTimeStr = timeStr
    let isFwd = false

    // Giải mã thẻ chuyển tiếp siêu dữ liệu (FWD Metadata) nếu có
    const fwdRegex = /^💬 \[FWD:user_uuid=([^|]*)\|sender=([^|]*)\|time=([^\]]*)\] ([\s\S]*)$/
    const fwdMatch = content.match(fwdRegex)
    if (fwdMatch) {
      isFwd = true
      // Forward metadata never overrides the authenticated sender UUID.
      // Keep the actual alias; forwarded attribution is display-only.
      // Giữ thời điểm do máy chủ cung cấp để sắp xếp tin nhắn.
      finalContent = fwdMatch[4]
    }

    // Nhận diện và làm sạch thẻ đổi tên nhóm (ROOM_RENAME) chuẩn hệ thống
    const renameMatch =
      trustedCommand && finalContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
    if (renameMatch && renameMatch[1]) {
      targetRoom.title = renameMatch[1].trim()
      finalContent = finalContent.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
    } else if (trustedCommand && finalContent.includes('đã đổi tên nhóm thành: "')) {
      const legacyMatch = finalContent.match(/đã đổi tên nhóm thành: "([^"]+)"/)
      if (legacyMatch && legacyMatch[1]) {
        targetRoom.title = legacyMatch[1].trim()
      }
    }

    let isMine = false
    if (myUserUuid && senderUuid === myUserUuid) {
      isMine = true
    }

    // 2. Nếu là tin nhắn của chính mình, kiểm tra xem có tin tạm (prefix cmsg-) cùng nội dung hay không
    if (isMine) {
      const tempMsg = targetRoom.messages.find(
        (m) => typeof m.id === 'string' && m.id.startsWith('cmsg-') && m.text === finalContent,
      )
      if (tempMsg) {
        // Chỉ cập nhật ID thật và chuẩn hóa thời gian, không push trùng lặp
        tempMsg.id = msgId
        tempMsg.time = finalTimeStr
        tempMsg.timestamp = msgTimestamp
        targetRoom.preview = finalContent
        targetRoom.time = finalTimeStr
        targetRoom.updatedAt = msgTimestamp
        this.publishRoomsChanged()
        return
      }
    }

    let senderDisplayName = senderAlias
    if (isMine) {
      senderDisplayName = 'Tôi'
    } else if (senderUuid) {
      const c = this.contactService.findContactByUuid(senderUuid)
      if (c?.name) senderDisplayName = c.name
    }

    const newMsg = {
      id: msgId,
      sender: isMine ? 'mine' : 'theirs',
      senderName: senderDisplayName,
      text: finalContent,
      time: finalTimeStr,
      timestamp: msgTimestamp,
      user_uuid: senderUuid,
      alias: senderAlias,
      isForwarded: isFwd,
    }

    targetRoom.messages.push(newMsg)
    targetRoom.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    targetRoom.preview = finalContent
    targetRoom.time = timeStr
    targetRoom.updatedAt = msgTimestamp

    this.publishRoomsChanged()
    logger.info('CHAT', 'Nhận tin nhắn mới', { roomId: roomUuid, messageId: msgId })
    window.dispatchEvent(
      new CustomEvent('smartcall-message-received', {
        detail: { roomId: roomUuid, message: newMsg },
      }),
    )
  }

  /**
   * Nạp phòng từ Chatd, ghép thông tin liên hệ và xác minh nhóm đã đóng trước khi công bố danh
   * sách.
   */
  async getRooms() {
    this._restoreUnreadState()
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this._fetchingRoomsPromise) {
      return this._fetchingRoomsPromise
    }

    this._fetchingRoomsPromise = (async () => {
      try {
        if (!this.rooms || this.rooms.length === 0) {
          this.rooms = []
        }

        const token = this.authService.getToken()
        if (token) {
          const host = this.authService.host.startsWith('http')
            ? this.authService.host
            : `https://${this.authService.host}`

          const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          })

          // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
          // thành công giả.
          if (res.ok) {
            const data = await res.json()
            const items = Array.isArray(data.items) ? data.items : []
            const myUuid =
              this.authService.getCurrentUserUuid() ||
              localStorage.getItem('smartcall_user_uuid') ||
              ''
            const myExt =
              this.authService.getCurrentExtension() ||
              localStorage.getItem('smartcall_extension') ||
              ''
            const missing = new Set()
            for (const room of items) {
              for (const user of Array.isArray(room.users) ? room.users : []) {
                const uuid = typeof user === 'string' ? user : user?.uuid
                if (uuid && uuid !== myUuid && !this.contactService.findContactByUuid(uuid))
                  missing.add(uuid)
              }
              if (missing.size >= 60) break
            }
            if (missing.size && this.contactService.hydrateContactsByUuid) {
              try {
                await this.contactService.hydrateContactsByUuid([...missing].slice(0, 60))
              } catch {
                /* Chatd vẫn cung cấp dữ liệu phòng nếu Dird chưa sẵn sàng. */
              }
            }

            // Đồng bộ dữ liệu phòng thật từ máy chủ Wazo
            assertSessionContext(sessionContext)
            const serverRooms = items.map((room) => {
              const existing = (this.rooms || []).find((r) => r.id === room.uuid)
              const serverUsers = Array.isArray(room.users) ? room.users : []
              const memberCount =
                serverUsers.length || existing?.members?.length || existing?.memberCount || 2

              // Nhận diện phòng 1-1: đúng 2 user và tên phòng không chứa 'nhóm' hoặc 'group'
              const isDirect =
                serverUsers.length === 2 &&
                (!room.name ||
                  (!room.name.toLowerCase().includes('nhóm') &&
                    !room.name.toLowerCase().includes('group')))
              const isGroup = !isDirect

              // Dùng danh bạ để xác định người đối thoại trong phòng chat riêng.
              // TUYỆT ĐỐI KHÔNG dùng room.name từ server cho phòng 1-1
              let displayTitle = ''
              let directExt = existing?.ext || ''

              if (isDirect) {
                const otherUser = serverUsers.find((u) => {
                  const uId = typeof u === 'string' ? u : u.uuid
                  return uId && uId !== myUuid
                })
                const otherUuid = otherUser
                  ? typeof otherUser === 'string'
                    ? otherUser
                    : otherUser.uuid
                  : null

                let otherContact = null
                if (otherUuid) {
                  otherContact = this.contactService.findContactByUuid(otherUuid)
                }

                if (otherContact) {
                  displayTitle = otherContact.name
                  directExt = otherContact.number || otherContact.exten || ''
                } else if (existing?.ext) {
                  const c = this.contactService.findContactByExtension(existing.ext)
                  if (c) {
                    displayTitle = c.name
                    directExt = c.number
                  }
                }

                if (!displayTitle) {
                  if (otherContact?.number) {
                    displayTitle = `Máy lẻ ${otherContact.number}`
                  } else if (otherUuid) {
                    displayTitle = `Máy lẻ ${otherUuid.slice(0, 4)}`
                  } else {
                    displayTitle = 'Cuộc trò chuyện 1-1'
                  }
                }
              } else {
                displayTitle = room.name || 'Phòng thảo luận nhóm'
              }

              // Chuẩn hóa updatedAt theo timestamp của tin nhắn gần nhất
              let lastMsgTimestamp = existing?.updatedAt
              if (existing?.messages && existing.messages.length > 0) {
                const lastMsg = existing.messages[existing.messages.length - 1]
                if (lastMsg && (lastMsg.timestamp || lastMsg.time)) {
                  if (lastMsg.timestamp) lastMsgTimestamp = Number(lastMsg.timestamp)
                }
              }

              const avatarBg = isGroup ? '#8b5cf6' : existing?.avatarBg || '#0284c7'
              const icon = isGroup ? '👥' : (displayTitle || 'CH').slice(0, 2).toUpperCase()

              const serverAdminUuid = room.admin_uuid || room.creator_uuid || ''
              const defaultAdminUuid = serverAdminUuid

              // Ánh xạ thành viên 100% từ danh sách serverUsers của máy chủ Wazo
              const mappedMembers = serverUsers.map((u) => {
                const uId = typeof u === 'string' ? u : u.uuid
                const c = this.contactService.findContactByUuid(uId)
                return {
                  id: uId,
                  uuid: uId,
                  name:
                    c?.name ||
                    (uId === myUuid
                      ? this.authService.getCurrentDisplayName() ||
                        localStorage.getItem('smartcall_username') ||
                        'Tôi'
                      : 'Thành viên'),
                  ext: c?.number || c?.exten || (uId === myUuid ? myExt : ''),
                  dept: c?.dept || '',
                  status: c?.status || 'offline',
                  isAdmin: isGroup && defaultAdminUuid ? uId === defaultAdminUuid : uId === myUuid,
                }
              })

              return {
                id: room.uuid,
                title: displayTitle,
                preview:
                  existing?.preview ||
                  (isGroup ? 'Phòng thảo luận nhóm mới' : 'Cuộc trò chuyện mới'),
                time: existing?.time || '',
                avatarBg: avatarBg,
                icon: icon,
                isDirect: isDirect,
                ext: directExt,
                adminUuid: defaultAdminUuid,
                adminVerified: Boolean(serverAdminUuid),
                messages: existing?.messages || [],
                members: mappedMembers,
                memberCount: memberCount,
                updatedAt: lastMsgTimestamp || existing?.updatedAt || 0,
              }
            })

            await Promise.all(
              serverRooms.map(async (room) => {
                try {
                  await this._verifyRoomClosure(room, sessionContext)
                } catch (error) {
                  assertSessionContext(sessionContext)
                  room.closureUnverified = true
                  logger.warn('CHAT', 'Tạm ẩn nhóm chưa xác minh được trạng thái:', error.message)
                }
              }),
            )
            assertSessionContext(sessionContext)
            // Giữ trạng thái đóng phòng: không cho tin mới hoặc kết quả tải lại tự đưa nhóm đã
            // đóng/chưa xác minh về luồng đang mở.
            if (serverRooms.some((room) => room.closureUnverified))
              window.dispatchEvent(
                new CustomEvent('app-toast', {
                  detail: {
                    message:
                      'Một số nhóm tạm chưa hiển thị vì chưa xác minh được trạng thái đóng. Vui lòng tải lại.',
                    type: 'warning',
                  },
                }),
              )

            // Tải trước song song tin nhắn gần nhất cho các phòng chưa nạp tin nhắn
            const roomsNeedFetch = serverRooms.filter(
              (r) =>
                !r.isClosed && !r.closureUnverified && (!r.messages || r.messages.length === 0),
            )
            if (roomsNeedFetch.length > 0) {
              await Promise.allSettled(
                roomsNeedFetch.map(async (room) => {
                  try {
                    const msgs = await this.getRoomMessages(room.id, 15, room)
                    if (msgs && msgs.length > 0) {
                      room.messages = msgs
                      const last = msgs[msgs.length - 1]
                      room.preview = last.text
                      room.time = last.time
                      room.updatedAt = last.timestamp
                    }
                  } catch (fetchErr) {
                    /* ignore */
                  }
                }),
              )
            }

            // Sắp xếp các phòng theo thứ tự tin nhắn mới nhất lên đầu chuẩn 100%
            serverRooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

            // Lọc bỏ hoàn toàn các phòng nhóm đã bị giải tán (Tombstone SYSTEM:ROOM_CLOSED)
            const activeServerRooms = serverRooms.filter(
              (room) =>
                !room.isClosed && !room.closureUnverified && !this._closedRoomIds.has(room.id),
            )

            // Giữ lại các phòng chat 1-1 local nếu CHƯA có phòng server nào tương ứng
            const directRooms = (this.rooms || []).filter((r) => r.id && r.id.startsWith('direct-'))
            const merged = [...activeServerRooms]
            for (const dr of directRooms) {
              const hasMatch = merged.some((m) => m.id === dr.id || (dr.ext && m.ext === dr.ext))
              if (!hasMatch) {
                merged.push(dr)
              }
            }
            assertSessionContext(sessionContext)
            this.rooms = merged
            this.publishRoomsChanged(true) // Silent: không kích hoạt vòng lặp sự kiện
            return [...this.rooms]
          }
        }
      } catch (err) {
        /* Fallback sang local rooms */
      } finally {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(sessionContext)) this._fetchingRoomsPromise = null
      }

      this.sortRooms()
      return [...(this.rooms || [])]
    })()

    return this._fetchingRoomsPromise
  }

  /**
   * Tải lịch sử một phòng, lọc command đáng tin/tin đã xóa và không để tin thường mở lại nhóm
   * đóng.
   */
  async getRoomMessages(roomId, limit = 50, roomContext = null) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    // Giữ trạng thái đóng phòng: không cho tin mới hoặc kết quả tải lại tự đưa nhóm đã đóng/chưa
    // xác minh về luồng đang mở.
    if (!roomId || this._closedRoomIds.has(roomId)) return []
    const localRoom = roomContext || this.rooms.find((r) => r.id === roomId)

    try {
      const token = this.authService.getToken()
      if (token && !roomId.startsWith('room-') && !roomId.startsWith('direct-')) {
        const host = this.authService.host.startsWith('http')
          ? this.authService.host
          : `https://${this.authService.host}`

        const res = await fetch(
          `${host}/api/chatd/1.0/users/me/rooms/${roomId}/messages?limit=${limit}`,
          {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
          },
        )

        // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
        // thành công giả.
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.items)) {
            const myUserUuid =
              this.authService.getCurrentUserUuid() ||
              localStorage.getItem('smartcall_user_uuid') ||
              ''

            // Sắp xếp tin nhắn theo thứ tự thời gian tăng dần (cũ trước, mới sau)
            const sortedItems = [...data.items].sort(
              (a, b) =>
                new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
            )

            // Tìm mốc giải tán nhóm gần nhất [SYSTEM:ROOM_CLOSED] nếu có
            let lastClosedIdx = -1
            for (let i = sortedItems.length - 1; i >= 0; i--) {
              // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc
              // tag text không tự cấp quyền.
              if (
                this.isTrustedRoomCommand(localRoom, sortedItems[i]) &&
                sortedItems[i].content.includes('[SYSTEM:ROOM_CLOSED')
              ) {
                lastClosedIdx = i
                break
              }
            }

            if (lastClosedIdx >= 0) {
              this._markRoomClosed(roomId, localRoom)
              return []
            }
            // Giữ trạng thái đóng phòng: không cho tin mới hoặc kết quả tải lại tự đưa nhóm đã
            // đóng/chưa xác minh về luồng đang mở.
            if (this._closedRoomIds.has(roomId)) return []
            const activeItems = sortedItems

            // 1. Quét thu thập tất cả các ID tin nhắn đã bị xóa bằng Tombstone MSG_DELETED
            const deletedIdsSet = new Set()
            for (const item of activeItems) {
              const c = item.content || ''
              // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc
              // tag text không tự cấp quyền.
              if (
                this.isTrustedRoomCommand(localRoom, item) &&
                c.includes('[SYSTEM:MSG_DELETED:ids="')
              ) {
                const match = c.match(/\[SYSTEM:MSG_DELETED:ids="([^"]+)"/)
                if (match && match[1]) {
                  match[1].split(',').forEach((id) => {
                    const cleanId = id.trim()
                    if (cleanId) deletedIdsSet.add(cleanId)
                  })
                }
              }
            }

            // 2. Lọc bỏ các tin nhắn có ID bị xóa và bản thân các tin nhắn tombstone MSG_DELETED /
            // ROOM_CLOSED
            const visibleItems = activeItems.filter((item) => {
              const itemId = item.uuid || item.id
              if (itemId && deletedIdsSet.has(itemId)) return false
              // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc
              // tag text không tự cấp quyền.
              if (
                this.isTrustedRoomCommand(localRoom, item) &&
                (item.content.includes('[SYSTEM:MSG_DELETED:ids=') ||
                  item.content.includes('[SYSTEM:ROOM_CLOSED'))
              )
                return false
              return true
            })

            const fwdRegex =
              /^💬 \[FWD:user_uuid=([^|]*)\|sender=([^|]*)\|time=([^\]]*)\] ([\s\S]*)$/

            let latestRenamedTitle = null
            const mapped = visibleItems.map((m) => {
              let senderUuid = m.user_uuid || m.sender_uuid || (m.user && m.user.uuid) || ''
              let senderAlias = (m.alias || '').trim()
              let msgContent = m.content || ''
              let msgTimeStr = formatMessageDateTime(m.created_at || Date.now())
              let isFwd = false

              // Giải mã thẻ chuyển tiếp siêu dữ liệu (FWD Metadata) nếu có
              const fwdMatch = msgContent.match(fwdRegex)
              if (fwdMatch) {
                isFwd = true
                // Preserve the server sender UUID for forwarded content.
                // Preserve the server alias.
                // Preserve the server timestamp.
                msgContent = fwdMatch[4] // Lấy nội dung gốc sạch sẽ
              }

              // Giải mã thẻ đổi tên nhóm (ROOM_RENAME) chuẩn hệ thống
              const renameMatch =
                this.isTrustedRoomCommand(localRoom, m) &&
                msgContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
              if (renameMatch && renameMatch[1]) {
                latestRenamedTitle = renameMatch[1].trim()
                msgContent = msgContent.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
              }

              let isMine = false
              if (myUserUuid && senderUuid === myUserUuid) {
                isMine = true
              }

              let senderDisplayName = senderAlias || 'Đồng nghiệp'
              if (isMine) {
                senderDisplayName = 'Tôi'
              } else if (senderUuid) {
                const c = this.contactService.findContactByUuid(senderUuid)
                if (c?.name) senderDisplayName = c.name
              }

              const msgTimestamp = m.created_at ? new Date(m.created_at).getTime() : Date.now()

              return {
                id: m.uuid || `msg-${Date.now()}-${Math.random()}`,
                sender: isMine ? 'mine' : 'theirs',
                senderName: senderDisplayName,
                text: msgContent,
                time: msgTimeStr,
                timestamp: msgTimestamp,
                user_uuid: senderUuid,
                alias: senderAlias,
                isForwarded: isFwd,
              }
            })

            // Sắp xếp tăng dần theo thời gian (cũ ở trên, mới ở dưới)
            mapped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

            if (localRoom) {
              localRoom.messages = mapped
              if (mapped.length > 0) {
                const last = mapped[mapped.length - 1]
                localRoom.preview = last.text
                localRoom.time = last.time
                localRoom.updatedAt = last.timestamp

                if (!localRoom.isDirect) {
                  // Phân giải tên nhóm mới nhất từ tin nhắn đổi tên chuẩn Tag hệ thống
                  if (latestRenamedTitle) {
                    localRoom.title = latestRenamedTitle
                  }
                }
              }
              this.publishRoomsChanged(true)
            }
            return mapped
          }
        }
      }
    } catch (e) {
      /* ignore */
    }

    return localRoom?.messages || []
  }

  /** Tìm phòng một-một hiện có theo UUID/máy lẻ hoặc tạo phòng server cần thiết trước khi gửi tin. */
  async getOrCreateDirectRoom(ext, name, currentUserName = 'Người dùng', expectedUuid = '') {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = []
    }

    const myExt =
      this.authService.getCurrentExtension() || localStorage.getItem('smartcall_extension') || ''
    const myUuid =
      this.authService.getCurrentUserUuid() || localStorage.getItem('smartcall_user_uuid') || 'me'

    const cleanExt = String(ext || '')
      .split('@')[0]
      .trim()
    const isSelf = cleanExt === myExt
    const displayTitle = isSelf ? `${name || currentUserName} (Bạn)` : name || `Máy lẻ ${cleanExt}`
    const targetUuid = isSelf ? myUuid : await this.contactService.resolveUserUuid(cleanExt)
    assertSessionContext(sessionContext)
    if (!targetUuid) throw new Error('Không xác định được người nhận từ số máy lẻ này.')
    if (expectedUuid && expectedUuid !== targetUuid)
      throw new Error('Máy lẻ đã đổi người sử dụng. Vui lòng chọn lại người nhận.')
    /** Không tái dùng phòng của người cũ khi máy lẻ đã được cấp cho UUID khác. */
    function belongsToPeer(room) {
      if (!room.isDirect) return false
      if (isSelf) return room.ext === cleanExt
      return (
        room.peerUuid === targetUuid ||
        room.members?.some((member) => (member.uuid || member.id) === targetUuid)
      )
    }

    // 1. Kiểm tra xem đã có phòng 1-1 Wazo server thật (UUID 36 ký tự) tương ứng với máy lẻ này
    // chưa
    const foundReal = this.rooms.find((r) => !r.id.startsWith('direct-') && belongsToPeer(r))

    if (foundReal) {
      if (isSelf && !foundReal.title.includes('(Bạn)')) {
        foundReal.title = `${foundReal.title} (Bạn)`
      }
      return foundReal
    }

    // 3. Gọi Wazo Chatd API để tìm phòng 1-1 có sẵn hoặc tạo phòng mới trên server tổng đài
    let realRoomUuid = null
    const token = this.authService.getToken()
    if (token && targetUuid && myUuid && myUuid !== 'me') {
      try {
        const host = this.authService.host.startsWith('http')
          ? this.authService.host
          : `https://${this.authService.host}`

        // Bước 3.1: Kiểm tra xem đã tồn tại phòng 1-1 với user_uuid này trên máy chủ chưa
        const checkRes = await fetch(
          `${host}/api/chatd/1.0/users/me/rooms?user_uuid=${encodeURIComponent(targetUuid)}`,
          {
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          },
        )

        if (checkRes.ok) {
          const checkData = await checkRes.json()
          if (Array.isArray(checkData.items) && checkData.items.length > 0) {
            // Lọc đúng phòng 1-1 thuần túy (đúng 2 user, không phải phòng nhóm)
            /** Kiểm tra hai UUID thật kể cả khi phiên bản Chatd bỏ qua tham số user_uuid. */
            function matchesDirectRoom(it) {
              const users =
                Array.isArray(it.users) &&
                it.users.map((user) => (typeof user === 'string' ? user : user?.uuid))
              return (
                Array.isArray(it.users) &&
                users.length === 2 &&
                users.includes(myUuid) &&
                users.includes(targetUuid) &&
                (!it.name ||
                  (!it.name.toLowerCase().includes('nhóm') &&
                    !it.name.toLowerCase().includes('group')))
              )
            }
            const directItem = checkData.items.find(matchesDirectRoom)
            if (directItem) {
              realRoomUuid = directItem.uuid
              logger.info('CHAT', `Tìm thấy phòng 1-1 chuẩn xác trên Wazo Chatd: ${realRoomUuid}`)
            }
          }
        } else throw new Error('Chưa kiểm tra được phòng chat hiện có trên Wazo.')

        // Bước 3.2: Nếu chưa có phòng trên server, gọi POST /api/chatd/1.0/users/me/rooms để tạo
        if (!realRoomUuid) {
          const createRes = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
            method: 'POST',
            headers: {
              'X-Auth-Token': token,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(4000),
            body: JSON.stringify({
              name: displayTitle,
              users: [{ uuid: myUuid }, { uuid: targetUuid }],
            }),
          })

          if (createRes.ok) {
            const roomData = await createRes.json()
            if (roomData && (roomData.uuid || roomData.id)) {
              realRoomUuid = roomData.uuid || roomData.id
              logger.info('CHAT', `Đã tạo phòng 1-1 thật trên máy chủ Wazo Chatd: ${realRoomUuid}`)
            }
          }
        }
      } catch (err) {
        logger.warn(
          'CHAT',
          'Không thể kết nối Wazo Chatd server, chuyển sang chế độ dự phòng:',
          err.message,
        )
      }
    }

    assertSessionContext(sessionContext)
    // 4. Nâng cấp phòng tạm hiện có hoặc tạo mới
    if (realRoomUuid) {
      // Tìm phòng tạm direct- cũ để thay thế ID
      const dummyRoom = this.rooms.find(
        (r) =>
          r.id.startsWith('direct-') &&
          belongsToPeer(r) &&
          String(r.ext || '')
            .split('@')[0]
            .trim() === cleanExt,
      )
      if (dummyRoom) {
        dummyRoom.id = realRoomUuid
        dummyRoom.title = displayTitle
        dummyRoom.ext = cleanExt
        dummyRoom.isDirect = true
        this.publishRoomsChanged()
        return dummyRoom
      }

      // Kiểm tra xem phòng realRoomUuid đã có trong danh sách chưa
      const existingReal = this.rooms.find((r) => r.id === realRoomUuid)
      if (existingReal) {
        existingReal.title = displayTitle
        existingReal.ext = cleanExt
        existingReal.isDirect = true
        this.publishRoomsChanged()
        return existingReal
      }

      // Tạo phòng mới với ID thật từ server Wazo
      const newRoom = {
        id: realRoomUuid,
        title: displayTitle,
        preview: 'Bắt đầu cuộc trò chuyện...',
        time: 'Mới',
        avatarBg: isSelf ? '#059669' : '#0284c7',
        icon: (name || cleanExt || 'U').slice(0, 2).toUpperCase(),
        isDirect: true,
        ext: cleanExt,
        peerUuid: targetUuid,
        memberCount: 2,
        updatedAt: Date.now(),
        members: [
          { id: myUuid, name: currentUserName, dept: '', ext: myExt, isAdmin: true },
          {
            id: targetUuid || `emp-${cleanExt}`,
            name: name,
            dept: 'Nội bộ',
            ext: cleanExt,
            isAdmin: false,
          },
        ],
        messages: [],
      }
      this.rooms.unshift(newRoom)
      this.publishRoomsChanged()
      return newRoom
    }

    // 5. Dự phòng ngoại tuyến (Offline Fallback) khi không gọi được server
    let dummy = this.rooms.find(
      (r) =>
        belongsToPeer(r) &&
        String(r.ext || '')
          .split('@')[0]
          .trim() === cleanExt,
    )
    if (dummy) {
      if (isSelf && !dummy.title.includes('(Bạn)')) {
        dummy.title = `${dummy.title} (Bạn)`
      }
      return dummy
    }

    dummy = {
      id: `direct-${targetUuid}`,
      title: displayTitle,
      preview: 'Bắt đầu cuộc trò chuyện...',
      time: 'Mới',
      avatarBg: isSelf ? '#059669' : '#0284c7',
      icon: (name || cleanExt || 'U').slice(0, 2).toUpperCase(),
      isDirect: true,
      ext: cleanExt,
      peerUuid: targetUuid,
      memberCount: 2,
      updatedAt: 0,
      members: [
        { id: myUuid, name: currentUserName, dept: '', ext: myExt, isAdmin: true },
        {
          id: targetUuid || `emp-${cleanExt}`,
          name: name,
          dept: 'Nội bộ',
          ext: cleanExt,
          isAdmin: false,
        },
      ],
      messages: [],
    }
    this.rooms.unshift(dummy)
    this.publishRoomsChanged()
    return dummy
  }

  /**
   * Tạo tin tạm reactive rồi POST lên Chatd; cập nhật ID/thời gian khi ACK hoặc đánh dấu
   * sendFailed khi lỗi.
   */
  async sendMessage(roomId, text, userAlias = null) {
    // Giữ trạng thái đóng phòng: không cho tin mới hoặc kết quả tải lại tự đưa nhóm đã đóng/chưa
    // xác minh về luồng đang mở.
    if (this._closedRoomIds.has(roomId)) throw new Error('Nhóm này đã đóng trong SmartCall.')
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const myRealName =
      this.authService.getCurrentDisplayName() ||
      localStorage.getItem('smartcall_username') ||
      'Người dùng'
    const actualAlias = userAlias && userAlias !== 'Tôi' ? userAlias : myRealName
    const now = new Date()
    const msgTimestamp = now.getTime()
    const timeStr = formatMessageDateTime(now)
    const tempId = `cmsg-${crypto.randomUUID()}`

    let targetRoomId = roomId
    let room = this.rooms.find((r) => r.id === targetRoomId)

    // Nếu phòng đang mang ID tạm (direct-...), tự động nâng cấp lên ID server thật trước khi gửi
    // API
    if (targetRoomId && targetRoomId.startsWith('direct-') && room?.ext) {
      try {
        const upgraded = await this.getOrCreateDirectRoom(room.ext, room.title, actualAlias)
        if (upgraded && !upgraded.id.startsWith('direct-')) {
          targetRoomId = upgraded.id
          room = upgraded
        }
      } catch (upgradeErr) {
        logger.warn('CHAT', `Không thể nâng cấp ID phòng trước khi gửi: ${upgradeErr.message}`)
      }
    }

    assertSessionContext(sessionContext)
    const isSystemCommand = this.isTrustedRoomCommand(room, {
      content: text,
      user_uuid: this.authService.getCurrentUserUuid(),
    })
    const isSystemDeleter = isSystemCommand && text.includes('[SYSTEM:MSG_DELETED:ids=')
    let displayText = text
    if (isSystemCommand && text.includes('[SYSTEM:ROOM_RENAME:title="')) {
      displayText = text.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
    }

    const newMsg = reactive({
      id: tempId,
      sender: 'mine',
      senderName: 'Tôi',
      dept: '',
      text: displayText,
      time: timeStr,
      timestamp: msgTimestamp,
      sendFailed: false,
    })

    if (room && !isSystemDeleter) {
      if (!room.messages) room.messages = []
      room.messages.push(newMsg)
      room.preview = displayText
      room.time = timeStr
      room.updatedAt = msgTimestamp
      this.publishRoomsChanged()
    }

    try {
      const token = this.authService.getToken()
      if (token && targetRoomId && !targetRoomId.startsWith('direct-')) {
        const host = this.authService.host.startsWith('http')
          ? this.authService.host
          : `https://${this.authService.host}`

        const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms/${targetRoomId}/messages`, {
          method: 'POST',
          headers: {
            'X-Auth-Token': token,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({
            content: text,
            alias: actualAlias,
          }),
        })

        // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
        // thành công giả.
        if (res.ok) {
          const serverMsg = await res.json()
          if (serverMsg && (serverMsg.uuid || serverMsg.id)) {
            newMsg.id = serverMsg.uuid || serverMsg.id
            if (serverMsg.created_at) {
              newMsg.time = formatMessageDateTime(serverMsg.created_at)
              newMsg.timestamp = new Date(serverMsg.created_at).getTime()
              if (room && !isSystemDeleter) {
                room.time = newMsg.time
                room.updatedAt = newMsg.timestamp
              }
            }
          }

          this.publishRoomsChanged()
        } else {
          throw new Error(`Máy chủ tổng đài báo lỗi khi gửi tin nhắn (${res.status})`)
        }
      } else {
        throw new Error('Không thể gửi tin nhắn do chưa kết nối máy chủ hoặc phòng chưa sẵn sàng')
      }
    } catch (e) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(sessionContext)) throw e
      newMsg.sendFailed = true
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              type: 'error',
              message: 'Không thể gửi tin nhắn. Vui lòng kiểm tra kết nối mạng.',
            },
          }),
        )
      }
      this.publishRoomsChanged()
      logger.warn('CHAT', `Gửi tin nhắn thất bại: ${e.message}`)
    }

    return newMsg
  }

  /** Tạo phòng nhóm trên server với danh sách UUID đã chuẩn hóa, chỉ đưa vào state sau xác nhận. */
  async createGroupRoom(groupName, memberUserUuids = [], forwardedMessages = []) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (forwardedMessages.length)
      throw new Error(
        'Chuyển tiếp lịch sử khi tạo lại nhóm chưa được máy chủ hỗ trợ an toàn. Hội thoại gốc được giữ nguyên.',
      )
    const cleanName = (groupName || '').trim() || 'Nhóm thảo luận mới'
    const myUuid =
      this.authService.getCurrentUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const myName =
      this.authService.getCurrentDisplayName() ||
      localStorage.getItem('smartcall_username') ||
      'Người dùng'
    const token = this.authService.getToken()

    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) {
      throw new Error('Chưa có phiên đăng nhập Wazo để tạo nhóm')
    }

    // Tập hợp danh sách UUID độc nhất, luôn bao gồm chính mình
    const uniqueUuids = new Set()
    if (myUuid && myUuid !== 'me') {
      uniqueUuids.add(myUuid)
    }
    memberUserUuids.forEach((u) => {
      if (u && typeof u === 'string' && u.trim().length > 0 && u !== myUuid) {
        uniqueUuids.add(u.trim())
      }
    })

    if (uniqueUuids.size < 3) {
      throw new Error('Nhóm chat cần ít nhất 3 thành viên (bạn và ít nhất 2 đồng nghiệp khác)')
    }

    const usersPayload = Array.from(uniqueUuids).map((uuid) => ({ uuid }))

    const host = this.authService.host.startsWith('http')
      ? this.authService.host
      : `https://${this.authService.host}`

    logger.info(
      'CHAT',
      `Đang gọi Wazo Chatd API POST /users/me/rooms tạo nhóm: [${cleanName}] với ${usersPayload.length} thành viên`,
    )

    const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        name: cleanName,
        users: usersPayload,
      }),
    })

    // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
    // công giả.
    if (!res.ok) {
      const errText = await res.text()
      logger.error('CHAT', `Lỗi tạo nhóm Wazo Chatd (${res.status}): ${errText}`)
      throw new Error(`Máy chủ tổng đài báo lỗi khi tạo nhóm (${res.status})`)
    }

    const roomData = await res.json()
    const newRoomUuid = roomData.uuid || roomData.id
    if (!newRoomUuid) throw new Error('Máy chủ chưa trả về mã nhóm hợp lệ.')
    logger.info('CHAT', `Tạo nhóm thành công trên Wazo server với UUID: ${newRoomUuid}`)

    // Gửi lời chào dưới danh tính hiện tại; không tái tạo lịch sử hội thoại.
    try {
      await fetch(`${host}/api/chatd/1.0/users/me/rooms/${newRoomUuid}/messages`, {
        method: 'POST',
        headers: {
          'X-Auth-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          content: `🎉 Nhóm "${cleanName}" đã được khởi tạo bởi ${myName}. Chào mừng các thành viên!`,
          alias: myName,
        }),
      })
    } catch (msgErr) {
      logger.warn('CHAT', `Không thể gửi tin nhắn khởi tạo: ${msgErr.message}`)
    }

    // Làm mới danh sách phòng từ server
    assertSessionContext(sessionContext)
    await this.getRooms()
    assertSessionContext(sessionContext)
    const createdRoom = (this.rooms || []).find((r) => r.id === newRoomUuid)
    return createdRoom || roomData
  }

  /** Kiểm tra quyền admin và gửi command đổi tên; không báo thành công nếu server chưa nhận tin. */
  async renameGroup(roomId, newTitle) {
    const sessionContext = captureSessionContext()
    const cleanTitle = (newTitle || '').trim()
    if (!cleanTitle) {
      throw new Error('Vui lòng nhập tên nhóm mới')
    }
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room) throw new Error('Không tìm thấy phòng chat')
    this.assertRoomAdmin(room)

    const myName =
      this.authService.getCurrentDisplayName() ||
      localStorage.getItem('smartcall_username') ||
      'Người dùng'

    // Gửi tin nhắn thông báo hệ thống lên server Wazo theo chuẩn Tag hệ thống chuyên biệt
    const renameTag = `🔔 [SYSTEM:ROOM_RENAME:title="${cleanTitle}"] [${myName}] đã đổi tên nhóm thành: "${cleanTitle}"`
    try {
      const sent = await this.sendMessage(roomId, renameTag, 'Hệ thống')
      if (sent.sendFailed) throw new Error('Chưa đổi tên nhóm trên máy chủ.')
      assertSessionContext(sessionContext)
      room.title = cleanTitle
      room.updatedAt = Date.now()
      this.publishRoomsChanged()
    } catch (e) {
      throw e
    }

    return room
  }

  /**
   * Chặn xóa thành viên khi chưa có API membership đúng hợp đồng; không thay phòng để giả lập xóa
   * người.
   */
  async removeMemberFromGroup(roomId, memberUuid) {
    throw new Error(
      'Thay đổi thành viên cần API quản lý nhóm của máy chủ. Nhóm và lịch sử hiện tại được giữ nguyên để tránh mất dữ liệu.',
    )
  }

  /**
   * Chặn việc tạo phòng thay thế để giả thêm người; bảo toàn nhóm/lịch sử cho đến khi có API
   * membership.
   */
  async addMembersToGroup(roomId, allMemberUuids, customTitle = null) {
    throw new Error(
      'Thay đổi thành viên cần API quản lý nhóm của máy chủ. Nhóm và lịch sử hiện tại được giữ nguyên để tránh mất dữ liệu.',
    )
  }

  /**
   * Gửi tombstone đóng nhóm theo giao thức SmartCall rồi ẩn phòng; không xóa dữ liệu/membership
   * của Wazo.
   */
  async deleteRoom(roomId) {
    const sessionContext = captureSessionContext()
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room || room.isDirect) return false
    this.assertRoomAdmin(room)

    const myUserUuid =
      this.authService.getCurrentUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const roomTitle = room.title || 'Nhóm thảo luận'
    const tombstoneMsg = `🚫 [SYSTEM:ROOM_CLOSED:by=${myUserUuid}|name="${roomTitle}"] Nhóm này đã được giải tán.`

    try {
      const sent = await this.sendMessage(roomId, tombstoneMsg, 'Hệ thống')
      if (sent.sendFailed) throw new Error('Chưa giải tán nhóm trên máy chủ.')
      assertSessionContext(sessionContext)
    } catch (e) {
      throw e
    }

    // Ẩn phòng nhóm ngay lập tức khỏi RAM
    this._markRoomClosed(roomId, room)
    this.publishRoomsChanged()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId } }))
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    return true
  }

  /**
   * Đóng từng nhóm và trả riêng deletedIds/failures để UI không báo thành công toàn bộ khi chỉ một
   * phần đạt.
   */
  async deleteMultipleRooms(roomIds) {
    const context = captureSessionContext()
    const deletedIds = [],
      failures = []
    for (const roomId of [...new Set(roomIds || [])]) {
      assertSessionContext(context)
      try {
        const removed = await this.deleteRoom(roomId)
        if (removed) deletedIds.push(roomId)
        else
          failures.push({
            roomId,
            message: 'Phòng không còn tồn tại hoặc không hỗ trợ thao tác này.',
          })
      } catch (error) {
        failures.push({ roomId, message: error.message })
      }
    }
    return { deletedIds, failures }
  }

  /** Ẩn phòng đã bị thu hồi quyền trong RAM; không giả lập API rời nhóm. */
  dismissRoom(roomId) {
    this.rooms = this.rooms.filter((room) => room.id !== roomId)
    this.publishRoomsChanged()
  }

  /**
   * Ủy quyền thao tác đóng nhóm vào cùng deleteRoom để không tạo hai cơ chế quyền/cleanup khác
   * nhau.
   */
  async deleteGroupRoom(roomId) {
    return this.deleteRoom(roomId)
  }

  /**
   * Xóa phòng, request đang theo dõi và dấu đóng trong RAM khi đổi phiên; không xóa lịch sử
   * server.
   */
  reset() {
    this.state.unreadByRoom = Object.create(null)
    this._seenIncomingMessageIds.clear()
    this._visibleRoomId = null
    this._unreadStorageKey = null // Chỉ dọn RAM; giữ cache riêng cho lần đăng nhập lại.
    this.rooms = []
    this._closedRoomIds.clear()
    this._fetchingRoomsPromise = null
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    logger.info('CHAT', 'Đã dọn dẹp sạch toàn bộ cache tin nhắn và phòng chat.')
  }
}
