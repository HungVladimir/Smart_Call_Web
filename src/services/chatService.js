import { wazoService } from './wazo'
import { contactService } from './contactService'
import { websocketService } from './websocketService'
import { logger } from './loggerService'

class ChatService {
  constructor() {
    this.rooms = []
    this._fetchingRoomsPromise = null
    if (typeof window !== 'undefined') {
      this.rooms = this.loadSavedRooms()
      // Lắng nghe sự kiện tin nhắn thời gian thực tập trung tại tầng dịch vụ (SSOT)
      websocketService.on('chatd_user_room_message_created', (data) => this.handleIncomingMessage(data))
    }
  }

  // Khóa lưu trữ cục bộ phân tách riêng biệt theo từng User UUID đăng nhập
  getStorageKey() {
    const userUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || 'default'
    return `smartcall_chat_rooms_${userUuid}`
  }

  // Tải dữ liệu phòng chat từ localStorage của phiên người dùng hiện tại
  loadSavedRooms() {
    try {
      const key = this.getStorageKey()
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((r, idx) => {
            // Chuẩn hóa updatedAt theo timestamp của tin nhắn cuối cùng nếu có
            if (r.messages && r.messages.length > 0) {
              const lastMsg = r.messages[r.messages.length - 1]
              if (lastMsg && (lastMsg.timestamp || lastMsg.time)) {
                if (lastMsg.timestamp) {
                  r.updatedAt = Number(lastMsg.timestamp)
                }
              }
            }
            if (!r.updatedAt && r.updatedAt !== 0) {
              r.updatedAt = Date.now() - idx * 60000
            }
          })
          parsed.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          return parsed
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc cache phòng chat:', e)
    }
    return []
  }

  // Sắp xếp các phòng chat theo thứ tự tin nhắn mới nhất lên đầu
  sortRooms() {
    if (!this.rooms || !Array.isArray(this.rooms)) return
    this.rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  // Lưu bền vững vào localStorage của user hiện tại (hỗ trợ cờ silent để chống vòng lặp vô tận)
  saveRooms(silent = false) {
    try {
      this.sortRooms()
      const key = this.getStorageKey()
      localStorage.setItem(key, JSON.stringify(this.rooms))
      if (!silent) {
        window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
      }
    } catch (e) {
      console.warn('Lỗi lưu cache phòng chat:', e)
    }
  }

  // Xử lý tin nhắn đến thời gian thực qua WebSocket (Tập trung toàn hệ thống - SSOT)
  handleIncomingMessage(data) {
    if (!data) return
    const roomUuid = data.room_uuid || data.room?.uuid || data.message?.room_uuid
    const content = data.content || data.message?.content || data.msg || ''
    const alias = data.alias || data.message?.alias || data.sender_name || 'Đồng nghiệp'
    const msgId = data.uuid || data.message?.uuid || `msg-${Date.now()}-${Math.random()}`
    const msgTimestamp = data.created_at ? new Date(data.created_at).getTime() : Date.now()
    const timeStr = data.created_at
      ? new Date(data.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      : new Date(msgTimestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

    if (!roomUuid || !content) return

    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = this.loadSavedRooms()
    }

    let targetRoom = this.rooms.find((r) => r.id === roomUuid)
    if (!targetRoom) {
      const isGroup = !roomUuid.startsWith('direct-')
      targetRoom = {
        id: roomUuid,
        title: alias || 'Cuộc trò chuyện',
        preview: content,
        time: timeStr,
        unread: 0,
        avatarBg: isGroup ? '#8b5cf6' : '#3b82f6',
        icon: isGroup ? '👥' : (alias || 'CH').slice(0, 2).toUpperCase(),
        isDirect: !isGroup,
        messages: [],
        members: [],
        memberCount: isGroup ? 2 : 2,
        updatedAt: msgTimestamp,
      }
      this.rooms.unshift(targetRoom)
    }

    if (!targetRoom.messages) targetRoom.messages = []

    // 1. Khử trùng tuyệt đối nếu UUID thật đã tồn tại
    const alreadyExists = targetRoom.messages.some((m) => m.id === msgId)
    if (alreadyExists) return

    const currentUserName = localStorage.getItem('smartcall_username') || 'Người dùng'
    const isMine = alias === currentUserName

    // 2. Nếu là tin nhắn của chính mình, kiểm tra xem có tin tạm (prefix cmsg-) cùng nội dung hay không
    if (isMine) {
      const tempMsg = targetRoom.messages.find(
        (m) => typeof m.id === 'string' && m.id.startsWith('cmsg-') && m.text === content,
      )
      if (tempMsg) {
        // Chỉ cập nhật ID thật và chuẩn hóa thời gian, không push trùng lặp
        tempMsg.id = msgId
        tempMsg.time = timeStr
        tempMsg.timestamp = msgTimestamp
        targetRoom.preview = content
        targetRoom.time = timeStr
        targetRoom.updatedAt = msgTimestamp
        this.saveRooms()
        return
      }
    }

    const newMsg = {
      id: msgId,
      sender: isMine ? 'mine' : 'theirs',
      senderName: alias,
      text: content,
      time: timeStr,
      timestamp: msgTimestamp,
      readStatus: 'Read',
      readers: [],
    }
    targetRoom.messages.push(newMsg)
    targetRoom.preview = content
    targetRoom.time = timeStr
    targetRoom.updatedAt = msgTimestamp

    const activeRoomId = localStorage.getItem('smartcall_active_room_id')
    if (activeRoomId !== roomUuid && !isMine) {
      targetRoom.unread = (targetRoom.unread || 0) + 1
    }

    this.saveRooms()
    logger.info('CHAT', `Nhận tin nhắn mới từ [${alias}] trong phòng [${targetRoom.title}]: ${content}`)
    window.dispatchEvent(
      new CustomEvent('smartcall-message-received', { detail: { roomId: roomUuid, message: newMsg } }),
    )
  }

  /**
   * Lấy danh sách các phòng chat của người dùng (Đồng bộ phòng server Wazo và phòng 1-1 cục bộ)
   */
  async getRooms() {
    if (this._fetchingRoomsPromise) {
      return this._fetchingRoomsPromise
    }

    this._fetchingRoomsPromise = (async () => {
      try {
        if (!this.rooms || this.rooms.length === 0) {
          this.rooms = this.loadSavedRooms()
        }

        const token = wazoService.getToken()
        if (token) {
          const host = wazoService.host.startsWith('http')
            ? wazoService.host
            : `https://${wazoService.host}`

          const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
            headers: { 'X-Auth-Token': token },
            signal: AbortSignal.timeout(3000),
          })

          if (res.ok) {
            const data = await res.json()
            if (data.items && data.items.length > 0) {
              // Đồng bộ dữ liệu phòng thật từ máy chủ Wazo
              const serverRooms = data.items.map((room) => {
                const existing = (this.rooms || []).find((r) => r.id === room.uuid)
                const serverUsers = Array.isArray(room.users) ? room.users : []
                const memberCount =
                  serverUsers.length || existing?.members?.length || existing?.memberCount || 2
                const isGroup = !room.isDirect && (!room.uuid || !room.uuid.startsWith('direct-'))

                // Chuẩn hóa updatedAt theo timestamp của tin nhắn gần nhất
                let lastMsgTimestamp = existing?.updatedAt
                if (existing?.messages && existing.messages.length > 0) {
                  const lastMsg = existing.messages[existing.messages.length - 1]
                  if (lastMsg && (lastMsg.timestamp || lastMsg.time)) {
                    if (lastMsg.timestamp) lastMsgTimestamp = Number(lastMsg.timestamp)
                  }
                }

                return {
                  id: room.uuid,
                  title: room.name || 'Phòng thảo luận',
                  preview: existing?.preview || 'Cuộc trò chuyện mới',
                  time: existing?.time || '',
                  unread: existing?.unread || 0,
                  avatarBg: isGroup ? '#8b5cf6' : existing?.avatarBg || '#3b82f6',
                  icon: isGroup ? '👥' : (room.name || 'CH').slice(0, 2).toUpperCase(),
                  isDirect: !isGroup,
                  messages: existing?.messages || [],
                  members:
                    existing?.members && existing.members.length > 0
                      ? existing.members
                      : serverUsers.map((u) => ({
                          id: typeof u === 'string' ? u : u.uuid,
                          name: 'Thành viên',
                          ext: '',
                        })),
                  memberCount: memberCount,
                  pinned: existing?.pinned || '',
                  updatedAt: lastMsgTimestamp || existing?.updatedAt || Date.now(),
                }
              })

              // Giữ lại các phòng chat 1-1 (direct rooms) đã tạo
              const directRooms = (this.rooms || []).filter(
                (r) => r.isDirect || (r.id && r.id.startsWith('direct-')),
              )
              const merged = [...serverRooms]
              for (const dr of directRooms) {
                if (!merged.some((m) => m.id === dr.id)) {
                  merged.push(dr)
                }
              }
              this.rooms = merged
              this.saveRooms(true) // Silent: không kích hoạt vòng lặp sự kiện
              return [...this.rooms]
            }
          }
        }
      } catch (err) {
        /* Fallback sang local rooms */
      } finally {
        this._fetchingRoomsPromise = null
      }

      this.sortRooms()
      return [...(this.rooms || [])]
    })()

    return this._fetchingRoomsPromise
  }

  /**
   * Tải lịch sử tin nhắn từ Wazo Chatd server cho một phòng chat
   * GET /api/chatd/1.0/users/me/rooms/{roomId}/messages?limit=50
   */
  async getRoomMessages(roomId, limit = 50) {
    if (!roomId) return []
    const localRoom = this.rooms.find((r) => r.id === roomId)

    try {
      const token = wazoService.getToken()
      if (token && !roomId.startsWith('room-') && !roomId.startsWith('direct-')) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        const res = await fetch(
          `${host}/api/chatd/1.0/users/me/rooms/${roomId}/messages?limit=${limit}`,
          {
            headers: { 'X-Auth-Token': token },
            signal: AbortSignal.timeout(3000),
          },
        )

        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.items) && data.items.length > 0) {
            const currentUserName = localStorage.getItem('smartcall_username') || 'Người dùng'
            const mapped = data.items.map((m) => {
              const isMine = m.alias === currentUserName || m.user_uuid === wazoService.session?.uuid
              return {
                id: m.uuid || `msg-${Date.now()}-${Math.random()}`,
                sender: isMine ? 'mine' : 'theirs',
                senderName: m.alias || 'Đồng nghiệp',
                text: m.content || '',
                time: m.created_at ? m.created_at.substring(11, 16) : '',
                readStatus: 'Read',
                readers: [],
              }
            })
            if (localRoom) {
              localRoom.messages = mapped
              this.saveRooms(true)
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

  /**
   * Tìm hoặc tạo phòng chat 1-1 với một máy lẻ (Hỗ trợ Wazo Chatd API chuẩn)
   */
  async getDirectRoom(ext, name, currentUserName = 'Người dùng') {
    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = this.loadSavedRooms()
    }

    const myExt =
      wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || '1001'
    const myUuid =
      wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || 'me'

    const cleanExt = String(ext || '').split('@')[0].trim()
    const isSelf = cleanExt === myExt
    const displayTitle = isSelf ? `${name || currentUserName} (Bạn)` : name || `Máy lẻ ${cleanExt}`

    let found = this.rooms.find(
      (r) =>
        String(r.ext || '').split('@')[0].trim() === cleanExt ||
        (r.title && (r.title === name || r.title.includes(cleanExt))),
    )

    if (found) {
      if (isSelf && !found.title.includes('(Bạn)')) {
        found.title = `${found.title} (Bạn)`
      }
      return found
    }

    // Nếu chưa có phòng, thử gọi API Wazo Chatd thật để tạo phòng 1-1 trên server tổng đài
    let realRoomUuid = null
    const targetContact = contactService.findContactByExtension(cleanExt)
    const targetUuid = targetContact?.uuid

    const token = wazoService.getToken()
    if (token && targetUuid && myUuid && myUuid !== 'me') {
      try {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        // Chuẩn Wazo Chatd: POST /api/chatd/1.0/users/me/rooms
        const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
          method: 'POST',
          headers: {
            'X-Auth-Token': token,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(3000),
          body: JSON.stringify({
            name: displayTitle,
            users: [{ uuid: myUuid }, { uuid: targetUuid }],
          }),
        })

        if (res.ok) {
          const roomData = await res.json()
          if (roomData && (roomData.uuid || roomData.id)) {
            realRoomUuid = roomData.uuid || roomData.id
            logger.info('CHAT', `Đã tạo phòng 1-1 thật trên máy chủ Wazo Chatd: ${realRoomUuid}`)
          }
        }
      } catch (err) {
        logger.warn('CHAT', 'Không thể tạo phòng trên Wazo Chatd server, chuyển sang chế độ dự phòng:', err.message)
      }
    }

    const roomId = realRoomUuid || `direct-${cleanExt}-${Date.now()}`
    found = {
      id: roomId,
      title: displayTitle,
      preview: 'Bắt đầu cuộc trò chuyện...',
      time: 'Mới',
      unread: 0,
      avatarBg: isSelf ? '#059669' : '#0284c7',
      icon: (name || cleanExt || 'U').slice(0, 2).toUpperCase(),
      isDirect: true,
      ext: cleanExt,
      memberCount: 2,
      updatedAt: 0,
      members: [
        { id: myUuid, name: currentUserName, dept: '', ext: myExt, isAdmin: true },
        { id: targetUuid || `emp-${cleanExt}`, name: name, dept: 'Nội bộ', ext: cleanExt, isAdmin: false },
      ],
      messages: [],
    }
    this.rooms.unshift(found)
    this.saveRooms()
    return found
  }

  /**
   * Gửi một tin nhắn mới vào phòng
   * Cập nhật tức thì vào mảng phòng (Optimistic 0ms) và đồng bộ với Wazo Chatd
   */
  async sendMessage(roomId, text, userAlias = 'Tôi') {
    const now = new Date()
    const msgTimestamp = now.getTime()
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    const tempId = `cmsg-${msgTimestamp}`

    const newMsg = {
      id: tempId,
      sender: 'mine',
      senderName: userAlias,
      dept: '',
      text,
      time: timeStr,
      timestamp: msgTimestamp,
      readStatus: 'Read (0)',
      readers: [],
    }

    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      if (!room.messages) room.messages = []
      room.messages.push(newMsg)
      room.preview = text
      room.time = timeStr
      room.updatedAt = msgTimestamp
      this.saveRooms()
    }

    try {
      const token = wazoService.getToken()
      if (token && roomId) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: {
            'X-Auth-Token': token,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(3000),
          body: JSON.stringify({
            content: text,
            alias: userAlias,
          }),
        })

        if (res.ok) {
          const serverMsg = await res.json()
          if (serverMsg && (serverMsg.uuid || serverMsg.id)) {
            newMsg.id = serverMsg.uuid || serverMsg.id
            if (serverMsg.created_at) {
              const serverDate = new Date(serverMsg.created_at)
              newMsg.time = serverDate.toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })
              newMsg.timestamp = serverDate.getTime()
              if (room) {
                room.time = newMsg.time
                room.updatedAt = newMsg.timestamp
              }
            }
            this.saveRooms()
          }
        }
      }
    } catch (e) {
      // Giữ ID tạm khi chạy ngoại tuyến hoặc timeout mạng
      logger.warn('CHAT', `Gửi tin nhắn ngoại tuyến hoặc timeout: ${e.message}`)
    }

    return newMsg
  }

  /**
   * Thêm thành viên vào phòng
   */
  async addMember(roomId, employee) {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room) return false

    if (!room.members) room.members = []
    const exists = room.members.some((m) => m.id === employee.id || m.ext === employee.number)
    if (!exists) {
      room.members.push({
        id: employee.id || `emp-${Date.now()}`,
        name: employee.name,
        dept: employee.dept,
        ext: employee.number || employee.ext,
        isAdmin: false,
      })
      this.saveRooms()
      return true
    }
    return false
  }

  /**
   * Xóa thành viên khỏi phòng
   */
  async removeMember(roomId, memberId) {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room || !room.members) return false

    const target = room.members.find((m) => m.id === memberId)
    if (target?.isAdmin) {
      throw new Error('Không thể xóa quản trị viên (Admin) của nhóm!')
    }
    if (room.members.length <= 3) {
      throw new Error('Số lượng thành viên tối thiểu của nhóm là 3, không thể xóa thêm!')
    }

    const idx = room.members.findIndex((m) => m.id === memberId)
    if (idx !== -1) {
      room.members.splice(idx, 1)
      this.saveRooms()
      return true
    }
    return false
  }

  /**
   * Đổi tiêu đề phòng chat
   */
  async updateRoomTitle(roomId, newTitle) {
    if (!newTitle || newTitle.trim().length === 0) {
      throw new Error('Tiêu đề không được để trống')
    }
    if (newTitle.length > 100) {
      throw new Error('Tiêu đề nhóm không được vượt quá 100 ký tự')
    }

    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      room.title = newTitle.trim()
      this.saveRooms()
      return true
    }
    return false
  }

  /**
   * Ghim hoặc hủy ghim thông báo
   */
  async updatePinnedMessage(roomId, pinnedText) {
    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      room.pinned = pinnedText
      this.saveRooms()
      return true
    }
    return false
  }

  /**
   * Dọn dẹp sạch sẽ toàn bộ trạng thái khi đăng xuất
   */
  reset() {
    this.rooms = []
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('smartcall_active_room_id')
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    logger.info('CHAT', 'Đã dọn dẹp sạch toàn bộ cache tin nhắn và phòng chat.')
  }
}

export const chatService = new ChatService()
