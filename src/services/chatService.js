import { captureSessionContext, assertSessionContext, isSessionContextCurrent, createSessionFetch, invalidateSession } from './sessionScope'
import { wazoService } from './wazo'
import { contactService } from './contactService'
import { websocketService } from './websocketService'
import { logger } from './loggerService'
import { reactive } from 'vue'

const chatState = reactive({ rooms: [] })

/**
 * Định dạng thời gian tin nhắn chuẩn xác theo giờ Việt Nam / Trình duyệt cục bộ (HH:mm DD/MM/YYYY)
 * Ví dụ: "10:30 16/11/2026"
 */
export const formatMessageDateTime = (isoOrTimestamp) => {
  if (!isoOrTimestamp) return ''
  let d
  if (isoOrTimestamp instanceof Date) {
    d = isoOrTimestamp
  } else if (typeof isoOrTimestamp === 'number') {
    d = new Date(isoOrTimestamp)
  } else if (typeof isoOrTimestamp === 'string') {
    let str = isoOrTimestamp.trim()
    if (/^\d{10,13}$/.test(str)) {
      d = new Date(Number(str.length === 10 ? str + '000' : str))
    } else {
      // Đảm bảo parse chuẩn UTC nếu chuỗi ISO từ server chưa có Z hoặc múi giờ (+00:00)
      if (str.includes('T') && !str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
        str += 'Z'
      } else if (!str.includes('T') && str.includes(' ') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
        str = str.replace(' ', 'T') + 'Z'
      }
      d = new Date(str)
    }
  } else {
    d = new Date(isoOrTimestamp)
  }

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
  get rooms() { return chatState.rooms }
  set rooms(value) { chatState.rooms = value }
  constructor() {
    this.rooms = []
    this._fetchingRoomsPromise = null
    this._closedRoomIds = new Set()
    if (typeof window !== 'undefined') {
      // Lắng nghe sự kiện tin nhắn thời gian thực tập trung tại tầng dịch vụ (SSOT)
      websocketService.on('chatd_user_room_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_room_created', () => {
        this.getRooms().catch(() => {})
      })
    }
  }

  // Tải dữ liệu phòng chat: thuần 100% API thật từ Wazo server (Issue 8 & Rule 2 GEMINI.md)
  loadSavedRooms() {
    return []
  }

  // Sắp xếp các phòng chat theo thứ tự tin nhắn mới nhất lên đầu
  sortRooms() {
    if (!this.rooms || !Array.isArray(this.rooms)) return
    this.rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  // Cập nhật trạng thái phòng chat và phát sự kiện đồng bộ
  saveRooms(silent = false) {
    try {
      this.sortRooms()
      if (!silent && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
      }
    } catch (e) {
      console.warn('Lỗi cập nhật phòng chat:', e)
    }
  }

  _trustedCommand(room, message) {
    const sender = message?.user_uuid || message?.message?.user_uuid || ''
    const content = message?.content || message?.message?.content || ''
    if (!room || room.isDirect || !room.adminVerified || sender !== room.adminUuid) return false
    return /^(?:🚫|🔔)?\s*\[SYSTEM:(?:ROOM_CLOSED|MSG_DELETED|ROOM_RENAME)(?::|\])/.test(content)
  }

  _requireRoomAdmin(room) {
    if (!room?.adminVerified || room.adminUuid !== wazoService.getMyUserUuid()) {
      throw new Error('Máy chủ chưa xác nhận quyền quản trị nhóm. Không thể thực hiện thao tác này an toàn.')
    }
  }

  /** Đóng phòng trên giao thức SmartCall; không thay thế quyền membership của Wazo. */
  _markRoomClosed(roomId, room = this.rooms.find((item) => item.id === roomId)) {
    this._closedRoomIds.add(roomId)
    if (room) room.isClosed = true
    this.rooms = this.rooms.filter((item) => item.id !== roomId)
  }

  /** Tìm tombstone trên server, kể cả khi nó đã nằm ngoài trang lịch sử gần nhất. */
  async _verifyRoomClosure(room, context) {
    if (room.isDirect) return
    if (this._closedRoomIds.has(room.id)) { room.isClosed = true; return }
    if (!room.adminVerified) return // Không suy quyền quản trị từ tên hoặc thứ tự thành viên.
    const fetch = createSessionFetch(context)
    const pageSize = 100
    const seen = new Set()
    for (let page = 0; page < 100; page += 1) {
      const url = `${wazoService.getHostUrl()}/api/chatd/1.0/users/me/rooms/${encodeURIComponent(room.id)}/messages?search=${encodeURIComponent('[SYSTEM:ROOM_CLOSED')}&limit=${pageSize}&offset=${page * pageSize}`
      const res = await fetch(url, { headers: { 'X-Auth-Token': wazoService.getToken(), Accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error(`Không xác minh được trạng thái đóng nhóm (${res.status}).`)
      const data = await res.json()
      if (!Array.isArray(data.items)) throw new Error('Dữ liệu trạng thái nhóm không hợp lệ.')
      for (const message of data.items) {
        if (this._trustedCommand(room, message) && message.content.includes('[SYSTEM:ROOM_CLOSED')) {
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
    const roomUuid = data.room_uuid || data.room?.uuid || data.message?.room_uuid
    const content = data.content || data.message?.content || data.msg || ''
    const alias = data.alias || data.message?.alias || data.sender_name || 'Đồng nghiệp'
    const msgId = data.uuid || data.message?.uuid || `msg-${Date.now()}-${Math.random()}`
    const msgTimestamp = data.created_at ? new Date(data.created_at).getTime() : Date.now()
    const timeStr = formatMessageDateTime(data.created_at || msgTimestamp)

    if (!roomUuid || !content) return
    if (this._closedRoomIds.has(roomUuid)) return
    if (!this.rooms.some((room) => room.id === roomUuid)) {
      // Nạp metadata/quyền và kiểm tra tombstone trước khi hiển thị một phòng chưa biết.
      const context = captureSessionContext()
      this.getRooms().then(() => {
        if (isSessionContextCurrent(context) && this.rooms.some((room) => room.id === roomUuid) && !this._closedRoomIds.has(roomUuid)) this.handleIncomingMessage(data)
      }).catch(() => {})
      return
    }
    const trustedCommand = this._trustedCommand(this.rooms.find((room) => room.id === roomUuid), data)

    // 0. Xử lý Tombstone giải tán / đóng phòng thời gian thực
    if (trustedCommand && content.includes('[SYSTEM:ROOM_CLOSED')) {
      logger.info('CHAT', `Phòng [${roomUuid}] đã bị giải tán qua Tombstone SYSTEM:ROOM_CLOSED. Tự động ẩn phòng.`)
      const targetRoom = (this.rooms || []).find((r) => r.id === roomUuid)
      if (targetRoom) {
        targetRoom.isClosed = true
      }
      this._markRoomClosed(roomUuid, targetRoom)
      this.saveRooms()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId: roomUuid } }))
      }
      return
    }

    // 0.1. Xử lý Tombstone xóa tin nhắn thời gian thực
    if (trustedCommand && content.includes('[SYSTEM:MSG_DELETED:ids="')) {
      const delMatch = content.match(/\[SYSTEM:MSG_DELETED:ids="([^"]+)"/)
      if (delMatch && delMatch[1]) {
        const deletedIds = delMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
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
          this.saveRooms()
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
    let senderUuid = data.user_uuid || data.message?.user_uuid || ''
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
    const renameMatch = trustedCommand && finalContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
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
        this.saveRooms()
        return
      }
    }

    let senderDisplayName = senderAlias
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


    this.saveRooms()
    logger.info('CHAT', 'Nhận tin nhắn mới', { roomId: roomUuid, messageId: msgId })
    window.dispatchEvent(
      new CustomEvent('smartcall-message-received', { detail: { roomId: roomUuid, message: newMsg } }),
    )
  }

  /**
   * Lấy danh sách các phòng chat của người dùng (Đồng bộ phòng server Wazo và phòng 1-1 cục bộ)
   */
  async getRooms() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
          // Đảm bảo danh bạ đã nạp để tra cứu tên người đối phương chuẩn xác 100% (Issue 3)
          if (!contactService.currentContacts || contactService.currentContacts.length === 0) {
            try {
              await contactService.getContacts()
            } catch (e) {
              /* ignore */
            }
          }

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
            assertSessionContext(sessionContext)
            const serverRooms = items.map((room) => {
              const existing = (this.rooms || []).find((r) => r.id === room.uuid)
              const serverUsers = Array.isArray(room.users) ? room.users : []
              const memberCount =
                serverUsers.length || existing?.members?.length || existing?.memberCount || 2

              // Nhận diện phòng 1-1: đúng 2 user và tên phòng không chứa 'nhóm' hoặc 'group'
              const isDirect =
                serverUsers.length === 2 &&
                (!room.name || (!room.name.toLowerCase().includes('nhóm') && !room.name.toLowerCase().includes('group')))
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
              const icon = isGroup
                ? '👥'
                : (displayTitle || 'CH').slice(0, 2).toUpperCase()

              const serverAdminUuid =
                room.admin_uuid ||
                room.creator_uuid ||
                ''
              const defaultAdminUuid = serverAdminUuid

              // Ánh xạ thành viên 100% từ danh sách serverUsers của máy chủ Wazo
              const mappedMembers = serverUsers.map((u) => {
                const uId = typeof u === 'string' ? u : u.uuid
                const c = contactService.findContactByUuid(uId)
                return {
                  id: uId,
                  uuid: uId,
                  name:
                    c?.name ||
                    (uId === myUuid
                      ? (wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Tôi')
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
                preview: existing?.preview || (isGroup ? 'Phòng thảo luận nhóm mới' : 'Cuộc trò chuyện mới'),
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

            // Kiểm tra đóng phòng độc lập với cache tin nhắn, không cho tin thường mở lại nhóm.
            await Promise.all(serverRooms.map(async (room) => {
              try { await this._verifyRoomClosure(room, sessionContext) }
              catch (error) {
                assertSessionContext(sessionContext)
                room.closureUnverified = true
                logger.warn('CHAT', 'Tạm ẩn nhóm chưa xác minh được trạng thái:', error.message)
              }
            }))
            assertSessionContext(sessionContext)

            if (serverRooms.some((room) => room.closureUnverified)) {
              window.dispatchEvent(new CustomEvent('app-toast', {
                detail: { message: 'Một số nhóm tạm chưa hiển thị vì chưa xác minh được trạng thái đóng. Vui lòng thử tải lại.', type: 'warning' },
              }))
            }

            // Tải trước song song tin nhắn gần nhất cho các phòng chưa nạp tin nhắn
            const roomsNeedFetch = serverRooms.filter(
              (r) => !r.isClosed && !r.closureUnverified && (!r.messages || r.messages.length === 0),
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
            const activeServerRooms = serverRooms.filter((room) => !room.isClosed && !room.closureUnverified && !this._closedRoomIds.has(room.id))


            // Giữ lại các phòng chat 1-1 local nếu CHƯA có phòng server nào tương ứng
            const directRooms = (this.rooms || []).filter(
              (r) => r.id && r.id.startsWith('direct-'),
            )
            const merged = [...activeServerRooms]
            for (const dr of directRooms) {
              const hasMatch = merged.some(
                (m) => m.id === dr.id || (dr.ext && m.ext === dr.ext),
              )
              if (!hasMatch) {
                merged.push(dr)
              }
            }
            assertSessionContext(sessionContext)
            this.rooms = merged
            this.saveRooms(true) // Silent: không kích hoạt vòng lặp sự kiện
            return [...this.rooms]
          }
        }
      } catch (err) {
        /* Fallback sang local rooms */
      } finally {
        if (isSessionContextCurrent(sessionContext)) this._fetchingRoomsPromise = null
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
  async getRoomMessages(roomId, limit = 50, roomContext = null) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!roomId) return []
    if (this._closedRoomIds.has(roomId)) return []
    const localRoom = roomContext || this.rooms.find((r) => r.id === roomId)

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

            // Sắp xếp tin nhắn theo thứ tự thời gian tăng dần (cũ trước, mới sau)
            const sortedItems = [...data.items].sort(
              (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
            )

            // Tìm mốc giải tán nhóm gần nhất [SYSTEM:ROOM_CLOSED] nếu có
            let lastClosedIdx = -1
            for (let i = sortedItems.length - 1; i >= 0; i--) {
              if (this._trustedCommand(localRoom, sortedItems[i]) && sortedItems[i].content.includes('[SYSTEM:ROOM_CLOSED')) {
                lastClosedIdx = i
                break
              }
            }

            if (lastClosedIdx >= 0) {
              this._markRoomClosed(roomId, localRoom)
              return []
            }
            if (this._closedRoomIds.has(roomId)) return []

            // Các tin nhắn thuộc phiên hoạt động hiện tại:
            // Nếu nhóm từng bị giải tán và được tạo lại, chỉ lấy các tin nhắn từ sau mốc giải tán gần nhất!
            const activeItems =
              lastClosedIdx > -1 && lastClosedIdx < sortedItems.length - 1
                ? sortedItems.slice(lastClosedIdx + 1)
                : (lastClosedIdx === sortedItems.length - 1 ? [] : sortedItems)

            // 1. Quét thu thập tất cả các ID tin nhắn đã bị xóa bằng Tombstone MSG_DELETED
            const deletedIdsSet = new Set()
            for (const item of activeItems) {
              const c = item.content || ''
              if (this._trustedCommand(localRoom, item) && c.includes('[SYSTEM:MSG_DELETED:ids="')) {
                const match = c.match(/\[SYSTEM:MSG_DELETED:ids="([^"]+)"/)
                if (match && match[1]) {
                  match[1].split(',').forEach((id) => {
                    const cleanId = id.trim()
                    if (cleanId) deletedIdsSet.add(cleanId)
                  })
                }
              }
            }

            // 2. Lọc bỏ các tin nhắn có ID bị xóa và bản thân các tin nhắn tombstone MSG_DELETED / ROOM_CLOSED
            const visibleItems = activeItems.filter((item) => {
              const itemId = item.uuid || item.id
              if (itemId && deletedIdsSet.has(itemId)) return false
              if (this._trustedCommand(localRoom, item) && (item.content.includes('[SYSTEM:MSG_DELETED:ids=') || item.content.includes('[SYSTEM:ROOM_CLOSED'))) return false
              return true
            })

            const fwdRegex = /^💬 \[FWD:user_uuid=([^|]*)\|sender=([^|]*)\|time=([^\]]*)\] ([\s\S]*)$/

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
              const renameMatch = this._trustedCommand(localRoom, m) && msgContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
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
                const c = contactService.findContactByUuid(senderUuid)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = this.loadSavedRooms()
    }

    const myExt =
      wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || ''
    const myUuid =
      wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || 'me'

    const cleanExt = String(ext || '').split('@')[0].trim()
    const isSelf = cleanExt === myExt
    const displayTitle = isSelf ? `${name || currentUserName} (Bạn)` : name || `Máy lẻ ${cleanExt}`

    // 1. Kiểm tra xem đã có phòng 1-1 Wazo server thật (UUID 36 ký tự) tương ứng với máy lẻ này chưa
    const foundReal = this.rooms.find(
      (r) =>
        !r.id.startsWith('direct-') &&
        r.isDirect &&
        (String(r.ext || '').split('@')[0].trim() === cleanExt ||
          (r.members &&
            r.members.length === 2 &&
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
    assertSessionContext(sessionContext)

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
            // Lọc đúng phòng 1-1 thuần túy (đúng 2 user, không phải phòng nhóm)
            const directItem = checkData.items.find(
              (it) =>
                Array.isArray(it.users) &&
                it.users.length === 2 &&
                (!it.name || (!it.name.toLowerCase().includes('nhóm') && !it.name.toLowerCase().includes('group'))),
            )
            if (directItem) {
              realRoomUuid = directItem.uuid
              logger.info('CHAT', `Tìm thấy phòng 1-1 chuẩn xác trên Wazo Chatd: ${realRoomUuid}`)
            }
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

    assertSessionContext(sessionContext)
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
  async sendMessage(roomId, text, userAlias = null) {
    if (this._closedRoomIds.has(roomId)) throw new Error('Nhóm này đã đóng trong SmartCall. Không thể gửi thêm tin nhắn.')
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const myRealName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Người dùng'
    const actualAlias = userAlias && userAlias !== 'Tôi' ? userAlias : myRealName
    const now = new Date()
    const msgTimestamp = now.getTime()
    const timeStr = formatMessageDateTime(now)
    const tempId = `cmsg-${crypto.randomUUID()}`

    let targetRoomId = roomId
    let room = this.rooms.find((r) => r.id === targetRoomId)

    // Nếu phòng đang mang ID tạm (direct-...), tự động nâng cấp lên ID server thật trước khi gửi API
    if (targetRoomId && targetRoomId.startsWith('direct-') && room?.ext) {
      try {
        const upgraded = await this.getDirectRoom(room.ext, room.title, actualAlias)
        if (upgraded && !upgraded.id.startsWith('direct-')) {
          targetRoomId = upgraded.id
          room = upgraded
        }
      } catch (upgradeErr) {
        logger.warn('CHAT', `Không thể nâng cấp ID phòng trước khi gửi: ${upgradeErr.message}`)
      }
    }

    assertSessionContext(sessionContext)
    if (this._closedRoomIds.has(targetRoomId) || room?.isClosed) throw new Error('Nhóm này đã đóng trong SmartCall.')
    const isSystemCommand = this._trustedCommand(room, { content: text, user_uuid: wazoService.getMyUserUuid() })
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
            alias: actualAlias,
          }),
        })

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

          this.saveRooms()
        } else {
          throw new Error(`Máy chủ tổng đài báo lỗi khi gửi tin nhắn (${res.status})`)
        }
      } else {
        throw new Error('Không thể gửi tin nhắn do chưa kết nối máy chủ hoặc phòng chưa sẵn sàng')
      }
    } catch (e) {
      if (!isSessionContextCurrent(sessionContext)) throw e
      newMsg.sendFailed = true
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: { type: 'error', message: 'Không thể gửi tin nhắn. Vui lòng kiểm tra kết nối mạng.' },
          }),
        )
      }
      this.saveRooms()
      logger.warn('CHAT', `Gửi tin nhắn thất bại: ${e.message}`)
    }

    return newMsg
  }

  /**
   * Tạo phòng chat nhóm mới chuẩn 100% qua Wazo Chatd API (POST /api/chatd/1.0/users/me/rooms)
   * @param {string} groupName - Tên nhóm
   * @param {Array<string>} memberUserUuids - Danh sách User UUID của các thành viên được chọn
   * @param {Array<Object>} forwardedMessages - Danh sách tin nhắn cũ cần chuyển tiếp sang nhóm mới
   * @returns {Promise<Object>} Phòng nhóm mới được tạo
   */
  async createGroupRoom(groupName, memberUserUuids = [], forwardedMessages = []) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (forwardedMessages.length) throw new Error('Chuyển tiếp lịch sử khi tạo lại nhóm chưa được máy chủ hỗ trợ an toàn. Hội thoại gốc được giữ nguyên.')
    const cleanName = (groupName || '').trim() || 'Nhóm thảo luận mới'
    const myUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const myName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Người dùng'
    const token = wazoService.getToken()

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

    const host = wazoService.host.startsWith('http')
      ? wazoService.host
      : `https://${wazoService.host}`

    logger.info('CHAT', `Đang gọi Wazo Chatd API POST /users/me/rooms tạo nhóm: [${cleanName}] với ${usersPayload.length} thành viên`)

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

  /**
   * Đổi tên nhóm chat và gửi thông báo hệ thống lên máy chủ Wazo (Chỉ Admin)
   * @param {string} roomId - UUID phòng chat
   * @param {string} newTitle - Tên nhóm mới
   */
async renameGroup(roomId, newTitle) {
    const sessionContext = captureSessionContext()
    const cleanTitle = (newTitle || '').trim()
    if (!cleanTitle) {
      throw new Error('Vui lòng nhập tên nhóm mới')
    }
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room) throw new Error('Không tìm thấy phòng chat')
    this._requireRoomAdmin(room)

    const myName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Quản trị viên'

    // Gửi tin nhắn thông báo hệ thống lên server Wazo theo chuẩn Tag hệ thống chuyên biệt
    const renameTag = `🔔 [SYSTEM:ROOM_RENAME:title="${cleanTitle}"] [${myName}] đã đổi tên nhóm thành: "${cleanTitle}"`
    try {
      const sent = await this.sendMessage(roomId, renameTag, 'Hệ thống')
      if (sent.sendFailed) throw new Error('Chưa đổi tên nhóm trên máy chủ.')
      assertSessionContext(sessionContext)
      room.title = cleanTitle
      room.updatedAt = Date.now()
      this.saveRooms()
    } catch (e) {
      throw e
    }

    return room
  }

  /**
   * Xóa một thành viên khỏi phòng nhóm (Chỉ Admin)
   * Tạo phiên bản nhóm mới trên máy chủ Wazo với các thành viên còn lại
   * @param {string} roomId - UUID phòng chat hiện tại
   * @param {string} memberUuid - UUID thành viên cần xóa
   */
  async removeMemberFromGroup(roomId, memberUuid) {
    throw new Error('Thay đổi thành viên cần API quản lý nhóm của máy chủ. Nhóm và lịch sử hiện tại được giữ nguyên để tránh mất dữ liệu.')
  }

  /**
   * Thêm thành viên vào nhóm thảo luận (Tạo phòng mới với danh sách thành viên mở rộng,
   * chuyển toàn bộ lịch sử tin nhắn sang phòng mới và đóng phòng cũ bằng Tombstone [SYSTEM:ROOM_CLOSED])
   * @param {string} roomId - ID phòng nhóm cũ
   * @param {string[]} allMemberUuids - Danh sách UUID tất cả thành viên trong nhóm mới
   * @param {string} [customTitle] - Tên nhóm mới (hoặc giữ tên nhóm cũ)
   * @returns {Promise<Object>} Phòng nhóm mới được tạo
   */
  async addMembersToGroup(roomId, allMemberUuids, customTitle = null) {
    throw new Error('Thay đổi thành viên cần API quản lý nhóm của máy chủ. Nhóm và lịch sử hiện tại được giữ nguyên để tránh mất dữ liệu.')
  }

  /**
   * Giải tán / Xóa phòng nhóm bằng Tombstone System Message
   * Lưu trên Wazo server, các thiết bị khi tải phòng sẽ tự động ẩn phòng đã đóng
   * CHỈ áp dụng cho phòng nhóm (!isDirect), bảo toàn tuyệt đối kênh liên lạc 1-1
   * @param {string} roomId - UUID phòng chat nhóm
   */
async deleteRoom(roomId) {
    const sessionContext = captureSessionContext()
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room || room.isDirect) return false
    this._requireRoomAdmin(room)

    const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
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
    this.saveRooms()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId } }))
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    return true
  }

  /**
   * Xóa / Giải tán đồng loạt nhiều phòng nhóm (Batch Group Rooms Deletion)
   * @param {string[]} roomIds - Danh sách UUID phòng chat nhóm cần xóa
   */
async deleteMultipleRooms(roomIds) {
    const sessionContext = captureSessionContext()
    const result = { deletedIds: [], failures: [] }
    if (!Array.isArray(roomIds)) return result
    for (const rId of new Set(roomIds)) {
      assertSessionContext(sessionContext)
      try {
        const ok = await this.deleteRoom(rId)
        if (ok) result.deletedIds.push(rId)
        else result.failures.push({ roomId: rId, message: 'Phòng không còn tồn tại hoặc không phải nhóm.' })
      } catch (e) {
        assertSessionContext(sessionContext)
        result.failures.push({ roomId: rId, message: e.message })
        logger.warn('CHAT', `Lỗi xóa phòng nhóm [${rId}]:`, e.message)
      }
    }
    return result
  }

  /**
   * Giải tán / Xóa phòng nhóm bằng Tombstone System Message (Hỗ trợ tương thích ngược)
   * @param {string} roomId - UUID phòng chat
   */
async deleteGroupRoom(roomId) {
    return this.deleteRoom(roomId)
  }

  /**
   * Dọn dẹp sạch sẽ toàn bộ trạng thái khi đăng xuất
   */
  reset() {
    invalidateSession()
    this.rooms = []
    this._fetchingRoomsPromise = null
    this._closedRoomIds.clear()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    logger.info('CHAT', 'Đã dọn dẹp sạch toàn bộ cache tin nhắn và phòng chat.')
  }
}

export const chatService = new ChatService()
