import { wazoService } from './wazo'
import { contactService } from './contactService'
import { websocketService } from './websocketService'
import { logger } from './loggerService'

/**
 * Định dạng thời gian tin nhắn chuẩn xác theo giờ Việt Nam / Trình duyệt cục bộ (HH:mm DD/MM/YYYY)
 * Ví dụ: "10:30 16/11/2026"
 */
export const formatMessageDateTime = (isoOrTimestamp) => {
  if (!isoOrTimestamp) return ''
  const d = new Date(isoOrTimestamp)
  if (isNaN(d.getTime())) return String(isoOrTimestamp)
  const pad = (n) => String(n).padStart(2, '0')
  const hours = pad(d.getHours())
  const minutes = pad(d.getMinutes())
  const day = pad(d.getDate())
  const month = pad(d.getMonth() + 1)
  const year = d.getFullYear()
  return `${hours}:${minutes} ${day}/${month}/${year}`
}

class ChatService {
  constructor() {
    this.rooms = []
    this._fetchingRoomsPromise = null
    if (typeof window !== 'undefined') {
      this.rooms = this.loadSavedRooms()
      // Lắng nghe sự kiện tin nhắn thời gian thực tập trung tại tầng dịch vụ (SSOT)
      websocketService.on('chatd_user_room_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_room_created', () => {
        this.getRooms().catch(() => {})
      })
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
    const timeStr = formatMessageDateTime(data.created_at || msgTimestamp)

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
      // Tự động kéo thông tin phòng từ Wazo server để cập nhật chi tiết
      setTimeout(() => {
        this.getRooms().catch(() => {})
      }, 500)
    }

    if (!targetRoom.messages) targetRoom.messages = []

    // 1. Khử trùng tuyệt đối nếu UUID thật đã tồn tại
    const alreadyExists = targetRoom.messages.some((m) => m.id === msgId)
    if (alreadyExists) return

    const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const currentUserName = (wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || '').trim()
    const senderUuid = data.user_uuid || data.message?.user_uuid || ''

    let isMine = false
    if (myUserUuid && senderUuid && senderUuid === myUserUuid) {
      isMine = true
    } else if (currentUserName && alias && alias.toLowerCase() === currentUserName.toLowerCase()) {
      isMine = true
    } else if (alias === 'Tôi' || alias === 'me') {
      isMine = true
    }

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

    let senderDisplayName = alias
    if (isMine) {
      senderDisplayName = 'Tôi'
    } else if (senderUuid) {
      const c = contactService.findContactByUuid(senderUuid)
      if (c?.name) senderDisplayName = c.name
    }

    const newMsg = {
      id: msgId,
      sender: isMine ? 'mine' : 'theirs',
      senderName: senderDisplayName,
      text: content,
      time: timeStr,
      timestamp: msgTimestamp,
      readStatus: isMine ? 'Đã gửi' : 'Read',
      readers: [],
      user_uuid: senderUuid,
      alias: alias,
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
    logger.info('CHAT', `Nhận tin nhắn mới từ [${senderDisplayName}] trong phòng [${targetRoom.title}]: ${content}`)
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
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          })

          if (res.ok) {
            const data = await res.json()
            const items = Array.isArray(data.items) ? data.items : []
            const myUuid =
              wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
            const myExt =
              wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || ''
            const myUserName = (
              wazoService.getMyUserName() ||
              localStorage.getItem('smartcall_username') ||
              ''
            ).toLowerCase().trim()

            // Đồng bộ dữ liệu phòng thật từ máy chủ Wazo
            const serverRooms = items.map((room) => {
              const existing = (this.rooms || []).find((r) => r.id === room.uuid)
              const serverUsers = Array.isArray(room.users) ? room.users : []
              const memberCount =
                serverUsers.length || existing?.members?.length || existing?.memberCount || 2

              // Nhận diện phòng 1-1: đúng 2 user và tên phòng không chứa 'nhóm'
              const isDirect =
                serverUsers.length === 2 &&
                (!room.name || !room.name.toLowerCase().includes('nhóm'))
              const isGroup = !isDirect

              // Phân giải thông tin đối phương nếu là phòng 1-1 theo quy tắc SSOT (Issue 3)
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
                  otherContact = contactService.findContactByUuid(otherUuid)
                }

                if (otherContact) {
                  displayTitle = otherContact.name
                  directExt = otherContact.number || otherContact.exten || ''
                } else if (existing?.ext) {
                  const c = contactService.findContactByExtension(existing.ext)
                  if (c) {
                    displayTitle = c.name
                    directExt = c.number
                  }
                }

                if (!displayTitle) {
                  const rName = (room.name || '').trim()
                  if (rName && rName.toLowerCase() !== myUserName && !rName.toLowerCase().includes('(bạn)')) {
                    displayTitle = rName
                  } else if (otherUuid) {
                    displayTitle = `Máy lẻ ${otherUuid.slice(0, 4)}`
                  } else {
                    displayTitle = 'Cuộc trò chuyện 1-1'
                  }
                }
              } else {
                displayTitle = room.name || 'Phòng thảo luận'
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
              const icon = isGroup
                ? '👥'
                : (displayTitle || 'CH').slice(0, 2).toUpperCase()

              return {
                id: room.uuid,
                title: displayTitle,
                preview: existing?.preview || 'Cuộc trò chuyện mới',
                time: existing?.time || '',
                unread: existing?.unread || 0,
                avatarBg: avatarBg,
                icon: icon,
                isDirect: isDirect,
                ext: directExt,
                messages: existing?.messages || [],
                members:
                  existing?.members && existing.members.length > 0
                    ? existing.members
                    : serverUsers.map((u) => {
                        const uId = typeof u === 'string' ? u : u.uuid
                        const c = contactService.findContactByUuid(uId)
                        return {
                          id: uId,
                          name:
                            c?.name ||
                            (uId === myUuid
                              ? localStorage.getItem('smartcall_username') || 'Tôi'
                              : 'Thành viên'),
                          ext: c?.number || (uId === myUuid ? myExt : ''),
                        }
                      }),
                memberCount: memberCount,
                pinned: existing?.pinned || '',
                updatedAt: lastMsgTimestamp || existing?.updatedAt || Date.now(),
              }
            })

            // Giữ lại các phòng chat 1-1 local nếu CHƯA có phòng server nào tương ứng
            const directRooms = (this.rooms || []).filter(
              (r) => r.id && r.id.startsWith('direct-'),
            )
            const merged = [...serverRooms]
            for (const dr of directRooms) {
              const hasMatch = merged.some(
                (m) => m.id === dr.id || (dr.ext && m.ext === dr.ext),
              )
              if (!hasMatch) {
                merged.push(dr)
              }
            }
            this.rooms = merged
            this.saveRooms(true) // Silent: không kích hoạt vòng lặp sự kiện
            return [...this.rooms]
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
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
          },
        )

        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.items)) {
            const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
            const currentUserName = (wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || '').trim()

            const mapped = data.items.map((m) => {
              const senderUuid = m.user_uuid || m.uuid || ''
              const senderAlias = (m.alias || '').trim()

              let isMine = false
              if (myUserUuid && senderUuid && senderUuid === myUserUuid) {
                isMine = true
              } else if (currentUserName && senderAlias && senderAlias.toLowerCase() === currentUserName.toLowerCase()) {
                isMine = true
              } else if (senderAlias === 'Tôi' || senderAlias === 'me') {
                isMine = true
              }

              let senderDisplayName = senderAlias || 'Đồng nghiệp'
              if (isMine) {
                senderDisplayName = 'Tôi'
              } else if (senderUuid) {
                const c = contactService.findContactByUuid(senderUuid)
                if (c?.name) senderDisplayName = c.name
              }

              const msgTimestamp = m.created_at ? new Date(m.created_at).getTime() : Date.now()

              return {
                id: m.uuid || `msg-${Date.now()}-${Math.random()}`,
                sender: isMine ? 'mine' : 'theirs',
                senderName: senderDisplayName,
                text: m.content || '',
                time: formatMessageDateTime(m.created_at),
                timestamp: msgTimestamp,
                readStatus: isMine ? 'Đã xem' : 'Read',
                readers: [],
                user_uuid: senderUuid,
                alias: senderAlias,
              }
            })

            // Sắp xếp tăng dần theo thời gian (cũ ở trên, mới ở dưới) - Issue 5
            mapped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

            if (localRoom) {
              localRoom.messages = mapped
              if (mapped.length > 0) {
                const last = mapped[mapped.length - 1]
                localRoom.preview = last.text
                localRoom.time = last.time
                localRoom.updatedAt = last.timestamp
              }
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

    // 1. Kiểm tra xem đã có phòng Wazo server thật (UUID 36 ký tự) tương ứng với máy lẻ này chưa
    const foundReal = this.rooms.find(
      (r) =>
        !r.id.startsWith('direct-') &&
        (String(r.ext || '').split('@')[0].trim() === cleanExt ||
          (r.members &&
            r.members.some((m) => String(m.ext || '').split('@')[0].trim() === cleanExt))),
    )

    if (foundReal) {
      if (isSelf && !foundReal.title.includes('(Bạn)')) {
        foundReal.title = `${foundReal.title} (Bạn)`
      }
      return foundReal
    }

    // 2. Tra cứu User UUID của đối phương qua ContactService
    let targetUuid = null
    const targetContact = contactService.findContactByExtension(cleanExt)
    if (targetContact?.uuid) {
      targetUuid = targetContact.uuid
    } else {
      targetUuid = await contactService.resolveUserUuid(cleanExt)
    }

    // 3. Gọi Wazo Chatd API để tìm phòng 1-1 có sẵn hoặc tạo phòng mới trên server tổng đài
    let realRoomUuid = null
    const token = wazoService.getToken()
    if (token && targetUuid && myUuid && myUuid !== 'me') {
      try {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

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
            realRoomUuid = checkData.items[0].uuid
            logger.info('CHAT', `Tìm thấy phòng 1-1 có sẵn trên Wazo Chatd: ${realRoomUuid}`)
          }
        }

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

    // 4. Nâng cấp phòng tạm hiện có hoặc tạo mới
    if (realRoomUuid) {
      // Tìm phòng tạm direct- cũ để thay thế ID
      const dummyRoom = this.rooms.find(
        (r) =>
          r.id.startsWith('direct-') &&
          String(r.ext || '').split('@')[0].trim() === cleanExt,
      )
      if (dummyRoom) {
        dummyRoom.id = realRoomUuid
        dummyRoom.title = displayTitle
        dummyRoom.ext = cleanExt
        dummyRoom.isDirect = true
        this.saveRooms()
        return dummyRoom
      }

      // Kiểm tra xem phòng realRoomUuid đã có trong danh sách chưa
      const existingReal = this.rooms.find((r) => r.id === realRoomUuid)
      if (existingReal) {
        existingReal.title = displayTitle
        existingReal.ext = cleanExt
        existingReal.isDirect = true
        this.saveRooms()
        return existingReal
      }

      // Tạo phòng mới với ID thật từ server Wazo
      const newRoom = {
        id: realRoomUuid,
        title: displayTitle,
        preview: 'Bắt đầu cuộc trò chuyện...',
        time: 'Mới',
        unread: 0,
        avatarBg: isSelf ? '#059669' : '#0284c7',
        icon: (name || cleanExt || 'U').slice(0, 2).toUpperCase(),
        isDirect: true,
        ext: cleanExt,
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
      this.saveRooms()
      return newRoom
    }

    // 5. Dự phòng ngoại tuyến (Offline Fallback) khi không gọi được server
    let dummy = this.rooms.find(
      (r) => String(r.ext || '').split('@')[0].trim() === cleanExt,
    )
    if (dummy) {
      if (isSelf && !dummy.title.includes('(Bạn)')) {
        dummy.title = `${dummy.title} (Bạn)`
      }
      return dummy
    }

    dummy = {
      id: `direct-${cleanExt}`,
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
    this.saveRooms()
    return dummy
  }

  /**
   * Gửi một tin nhắn mới vào phòng
   * Cập nhật tức thì vào mảng phòng (Optimistic 0ms) và đồng bộ với Wazo Chatd
   */
  async sendMessage(roomId, text, userAlias = 'Tôi') {
    const now = new Date()
    const msgTimestamp = now.getTime()
    const timeStr = formatMessageDateTime(now)
    const tempId = `cmsg-${msgTimestamp}`

    let targetRoomId = roomId
    let room = this.rooms.find((r) => r.id === targetRoomId)

    // Nếu phòng đang mang ID tạm (direct-...), tự động nâng cấp lên ID server thật trước khi gửi API
    if (targetRoomId && targetRoomId.startsWith('direct-') && room?.ext) {
      try {
        const upgraded = await this.getDirectRoom(room.ext, room.title, userAlias)
        if (upgraded && !upgraded.id.startsWith('direct-')) {
          targetRoomId = upgraded.id
          room = upgraded
        }
      } catch (upgradeErr) {
        logger.warn('CHAT', `Không thể nâng cấp ID phòng trước khi gửi: ${upgradeErr.message}`)
      }
    }

    const newMsg = {
      id: tempId,
      sender: 'mine',
      senderName: 'Tôi',
      dept: '',
      text,
      time: timeStr,
      timestamp: msgTimestamp,
      readStatus: 'Đã gửi',
      readers: [],
    }

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
      if (token && targetRoomId && !targetRoomId.startsWith('direct-')) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

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
            alias: userAlias,
          }),
        })

        if (res.ok) {
          const serverMsg = await res.json()
          if (serverMsg && (serverMsg.uuid || serverMsg.id)) {
            newMsg.id = serverMsg.uuid || serverMsg.id
            if (serverMsg.created_at) {
              newMsg.time = formatMessageDateTime(serverMsg.created_at)
              newMsg.timestamp = new Date(serverMsg.created_at).getTime()
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
    this._fetchingRoomsPromise = null
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('smartcall_active_room_id')
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith('smartcall_chat_rooms_')) {
            localStorage.removeItem(k)
          }
        })
      } catch (e) {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    logger.info('CHAT', 'Đã dọn dẹp sạch toàn bộ cache tin nhắn và phòng chat.')
  }
}

export const chatService = new ChatService()
