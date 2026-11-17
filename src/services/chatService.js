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
  constructor() {
    this.rooms = []
    this.activeRoomId = null
    this._fetchingRoomsPromise = null
    if (typeof window !== 'undefined') {
      // Lắng nghe sự kiện tin nhắn thời gian thực tập trung tại tầng dịch vụ (SSOT)
      websocketService.on('chatd_user_room_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_message_created', (data) => this.handleIncomingMessage(data))
      websocketService.on('chatd_user_room_created', () => {
        this.getRooms().catch(() => {})
      })
    }
  }

  // Quản lý ID phòng đang mở tích cực trong RAM (SSOT - Triệt tiêu localStorage)
  setActiveRoomId(roomId) {
    this.activeRoomId = roomId || null
  }

  getActiveRoomId() {
    return this.activeRoomId
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

    // 0. Xử lý Tombstone giải tán / đóng phòng thời gian thực
    if (content.includes('[SYSTEM:ROOM_CLOSED')) {
      logger.info('CHAT', `Phòng [${roomUuid}] đã bị giải tán qua Tombstone SYSTEM:ROOM_CLOSED. Tự động ẩn phòng.`)
      const targetRoom = (this.rooms || []).find((r) => r.id === roomUuid)
      if (targetRoom) {
        targetRoom.isClosed = true
      }
      this.rooms = (this.rooms || []).filter((r) => r.id !== roomUuid)
      if (this.activeRoomId === roomUuid) {
        this.setActiveRoomId(null)
      }
      this.saveRooms()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId: roomUuid } }))
      }
      return
    }

    // 0.1. Xử lý Tombstone xóa tin nhắn thời gian thực
    if (content.includes('[SYSTEM:MSG_DELETED:ids="')) {
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
      if (fwdMatch[1]) senderUuid = fwdMatch[1].trim()
      if (fwdMatch[2]) senderAlias = fwdMatch[2].trim()
      if (fwdMatch[3]) finalTimeStr = fwdMatch[3].trim()
      finalContent = fwdMatch[4]
    }

    // Nhận diện và làm sạch thẻ đổi tên nhóm (ROOM_RENAME) chuẩn hệ thống
    const renameMatch = finalContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
    if (renameMatch && renameMatch[1]) {
      targetRoom.title = renameMatch[1].trim()
      finalContent = finalContent.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
    } else if (finalContent.includes('đã đổi tên nhóm thành: "')) {
      const legacyMatch = finalContent.match(/đã đổi tên nhóm thành: "([^"]+)"/)
      if (legacyMatch && legacyMatch[1]) {
        targetRoom.title = legacyMatch[1].trim()
      }
    }

    let isMine = false
    if (myUserUuid && senderUuid && senderUuid === myUserUuid) {
      isMine = true
    } else if (currentUserName && senderAlias && senderAlias.toLowerCase() === currentUserName.toLowerCase()) {
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
      readStatus: isMine ? 'Đã gửi' : 'Read',
      readers: [],
      user_uuid: senderUuid,
      alias: senderAlias,
      isForwarded: isFwd,
    }

    if (!isMine) {
      // Khi đối phương gửi tin nhắn phản hồi, chuyển tất cả tin trước đó của mình sang Đã xem
      targetRoom.messages.forEach((m) => {
        if (m.sender === 'mine') {
          m.readStatus = 'Đã xem'
        }
      })
    }

    targetRoom.messages.push(newMsg)
    targetRoom.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    targetRoom.preview = finalContent
    targetRoom.time = timeStr
    targetRoom.updatedAt = msgTimestamp


    const activeRoomId = this.activeRoomId || (typeof localStorage !== 'undefined' ? localStorage.getItem('smartcall_active_room_id') : null)
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
                // Nhận diện tên nhóm cập nhật mới nhất từ Tag hệ thống chuyên biệt
                if (existing?.messages && existing.messages.length > 0) {
                  const renameMsg = [...existing.messages].reverse().find(
                    (m) =>
                      m.text &&
                      (m.text.includes('[SYSTEM:ROOM_RENAME:title="') ||
                        /\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/.test(m.text) ||
                        m.text.includes('đã đổi tên nhóm thành: "')),
                  )
                  if (renameMsg) {
                    const match =
                      renameMsg.text.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/) ||
                      renameMsg.text.match(/đã đổi tên nhóm thành: "([^"]+)"/)
                    if (match && match[1]) {
                      displayTitle = match[1].trim()
                    }
                  }
                }
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

              const defaultAdminUuid =
                existing?.adminUuid ||
                existing?.messages?.[0]?.user_uuid ||
                (serverUsers[0] ? (typeof serverUsers[0] === 'string' ? serverUsers[0] : serverUsers[0].uuid) : '')

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
                unread: existing?.unread || 0,
                avatarBg: avatarBg,
                icon: icon,
                isDirect: isDirect,
                ext: directExt,
                adminUuid: defaultAdminUuid,
                messages: existing?.messages || [],
                members: mappedMembers,
                memberCount: memberCount,
                pinned: existing?.pinned || '',
                updatedAt: lastMsgTimestamp || existing?.updatedAt || 0,
              }
            })

            // Tải trước song song tin nhắn gần nhất cho các phòng chưa nạp tin nhắn
            const roomsNeedFetch = serverRooms.filter(
              (r) => !r.messages || r.messages.length === 0,
            )
            if (roomsNeedFetch.length > 0) {
              await Promise.allSettled(
                roomsNeedFetch.map(async (room) => {
                  try {
                    const msgs = await this.getRoomMessages(room.id, 15)
                    if (msgs && msgs.length > 0) {
                      room.messages = msgs
                      const last = msgs[msgs.length - 1]
                      room.preview = last.text
                      room.time = last.time
                      room.updatedAt = last.timestamp

                      // Xác định Quản trị viên (Admin) duy nhất của phòng nhóm từ tin nhắn khởi tạo đầu tiên
                      if (!room.isDirect) {
                        const firstMsg = msgs[0]
                        if (firstMsg?.user_uuid) {
                          room.adminUuid = firstMsg.user_uuid
                          if (room.members) {
                            room.members.forEach((m) => {
                              m.isAdmin = Boolean(m.id === room.adminUuid || m.uuid === room.adminUuid)
                            })
                          }
                        }
                      }
                    }
                  } catch (fetchErr) {
                    /* ignore */
                  }
                }),
              )
            }

            // Sắp xếp các phòng theo thứ tự tin nhắn mới nhất lên đầu chuẩn 100%
            serverRooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

            // Lọc bỏ hoàn toàn các phòng đã bị giải tán (Tombstone SYSTEM:ROOM_CLOSED)
            const activeServerRooms = serverRooms.filter((r) => {
              if (r.isClosed) return false
              const lastMsg = r.messages?.[r.messages.length - 1]
              const preview = r.preview || ''
              const isClosed =
                (lastMsg?.text && lastMsg.text.includes('[SYSTEM:ROOM_CLOSED')) ||
                preview.includes('[SYSTEM:ROOM_CLOSED')
              return !isClosed
            })

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

            // Sắp xếp tin nhắn theo thứ tự thời gian tăng dần (cũ trước, mới sau)
            const sortedItems = [...data.items].sort(
              (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
            )

            // 1. Quét thu thập tất cả các ID tin nhắn đã bị xóa bằng Tombstone MSG_DELETED
            const deletedIdsSet = new Set()
            for (const item of sortedItems) {
              const c = item.content || ''
              if (c.includes('[SYSTEM:MSG_DELETED:ids="')) {
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
            const visibleItems = sortedItems.filter((item) => {
              const itemId = item.uuid || item.id
              if (itemId && deletedIdsSet.has(itemId)) return false
              if (item.content && (item.content.includes('[SYSTEM:MSG_DELETED:ids=') || item.content.includes('[SYSTEM:ROOM_CLOSED'))) return false
              return true
            })

            // 3. Kiểm tra xem phòng có bị giải tán bằng Tombstone SYSTEM:ROOM_CLOSED không (từ tin nhắn mới nhất)
            const lastRaw = sortedItems[sortedItems.length - 1]
            if (lastRaw?.content && lastRaw.content.includes('[SYSTEM:ROOM_CLOSED')) {
              if (localRoom) {
                if (!localRoom.isDirect) {
                  localRoom.isClosed = true
                  localRoom.preview = 'Nhóm này đã được giải tán.'
                } else {
                  localRoom.isClosed = false
                  localRoom.preview = 'Cuộc trò chuyện mới'
                }
              }
            }

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
                if (fwdMatch[1]) senderUuid = fwdMatch[1].trim()
                if (fwdMatch[2]) senderAlias = fwdMatch[2].trim()
                if (fwdMatch[3]) msgTimeStr = fwdMatch[3].trim()
                msgContent = fwdMatch[4] // Lấy nội dung gốc sạch sẽ
              }

              // Giải mã thẻ đổi tên nhóm (ROOM_RENAME) chuẩn hệ thống
              const renameMatch = msgContent.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/)
              if (renameMatch && renameMatch[1]) {
                latestRenamedTitle = renameMatch[1].trim()
                msgContent = msgContent.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
              }

              let isMine = false
              if (myUserUuid && senderUuid && senderUuid === myUserUuid) {
                isMine = true
              } else if (currentUserName && senderAlias && senderAlias.toLowerCase() === currentUserName.toLowerCase()) {
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
                readStatus: isMine ? 'Đã gửi' : 'Read',
                readers: [],
                user_uuid: senderUuid,
                alias: senderAlias,
                isForwarded: isFwd,
              }
            })

            // Sắp xếp tăng dần theo thời gian (cũ ở trên, mới ở dưới)
            mapped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

            // Chuẩn hóa trạng thái: Đang gửi... -> Đã gửi -> Đã nhận -> Đã xem
            let lastTheirsIndex = -1
            for (let idx = mapped.length - 1; idx >= 0; idx--) {
              if (mapped[idx].sender === 'theirs') {
                lastTheirsIndex = idx
                break
              }
            }

            let isRecipientOnline = false
            if (localRoom?.isDirect) {
              const myExt = wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || ''
              const otherMember = (localRoom.members || []).find((mem) => {
                const isMe =
                  (myUserUuid && (mem.id === myUserUuid || mem.uuid === myUserUuid)) ||
                  (myExt && (mem.ext === myExt || mem.number === myExt))
                return !isMe
              })
              const targetExt = otherMember?.ext || (localRoom.ext ? String(localRoom.ext).split('@')[0] : '')
              const targetUuid = otherMember?.id || otherMember?.uuid || localRoom.peerUuid || ''
              const targetContact = (targetExt && contactService.findContactByExtension(targetExt)) ||
                                    (targetUuid && contactService.findContactByUuid(targetUuid))
              if (targetContact && targetContact.status && targetContact.status !== 'offline' && targetContact.status !== 'unavailable') {
                isRecipientOnline = true
              }
            }

            mapped.forEach((msg, idx) => {
              if (msg.sender === 'mine') {
                if (lastTheirsIndex !== -1 && idx < lastTheirsIndex) {
                  msg.readStatus = 'Đã xem'
                } else if (isRecipientOnline) {
                  msg.readStatus = 'Đã nhận'
                } else {
                  msg.readStatus = 'Đã gửi'
                }
              }
            })

            if (localRoom) {
              localRoom.messages = mapped
              if (mapped.length > 0) {
                const last = mapped[mapped.length - 1]
                localRoom.preview = last.text
                localRoom.time = last.time
                localRoom.updatedAt = last.timestamp

                // Nhận diện Quản trị viên (Admin) duy nhất từ tin nhắn khởi tạo đầu tiên của nhóm
                if (!localRoom.isDirect) {
                  const first = mapped[0]
                  if (first?.user_uuid) {
                    localRoom.adminUuid = first.user_uuid
                    if (localRoom.members) {
                      localRoom.members.forEach((m) => {
                        m.isAdmin = Boolean(m.id === localRoom.adminUuid || m.uuid === localRoom.adminUuid)
                      })
                    }
                  }

                  // Phân giải tên nhóm mới nhất từ tin nhắn đổi tên chuẩn Tag hệ thống
                  if (latestRenamedTitle) {
                    localRoom.title = latestRenamedTitle
                  } else {
                    const renameMsg = [...mapped].reverse().find(
                      (m) =>
                        m.text &&
                        (m.text.includes('[SYSTEM:ROOM_RENAME:title="') ||
                          /\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/.test(m.text) ||
                          m.text.includes('đã đổi tên nhóm thành: "')),
                    )
                    if (renameMsg) {
                      const match =
                        renameMsg.text.match(/\[SYSTEM:ROOM_RENAME:title="([^"]+)"\]/) ||
                        renameMsg.text.match(/đã đổi tên nhóm thành: "([^"]+)"/)
                      if (match && match[1]) {
                        localRoom.title = match[1].trim()
                      }
                    }
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
  async sendMessage(roomId, text, userAlias = null) {
    const myRealName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Người dùng'
    const actualAlias = userAlias && userAlias !== 'Tôi' ? userAlias : myRealName
    const now = new Date()
    const msgTimestamp = now.getTime()
    const timeStr = formatMessageDateTime(now)
    const tempId = `cmsg-${msgTimestamp}`

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

    const isSystemDeleter = text.includes('[SYSTEM:MSG_DELETED:ids=')
    let displayText = text
    if (text.includes('[SYSTEM:ROOM_RENAME:title="')) {
      displayText = text.replace(/\[SYSTEM:ROOM_RENAME:title="[^"]+"\]\s*/, '')
    }

    const newMsg = {
      id: tempId,
      sender: 'mine',
      senderName: 'Tôi',
      dept: '',
      text: displayText,
      time: timeStr,
      timestamp: msgTimestamp,
      readStatus: 'Đang gửi...',
      readers: [],
    }

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
          newMsg.readStatus = 'Đã gửi'

          // Kiểm tra xem đối phương có trực tuyến không để chuyển sang 'Đã nhận'
          if (room?.isDirect) {
            const myExt = wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || ''
            const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
            const otherMember = (room.members || []).find((mem) => {
              const isMe =
                (myUserUuid && (mem.id === myUserUuid || mem.uuid === myUserUuid)) ||
                (myExt && (mem.ext === myExt || mem.number === myExt))
              return !isMe
            })
            const targetExt = otherMember?.ext || (room.ext ? String(room.ext).split('@')[0] : '')
            const targetUuid = otherMember?.id || otherMember?.uuid || room.peerUuid || ''
            const targetContact = (targetExt && contactService.findContactByExtension(targetExt)) ||
                                  (targetUuid && contactService.findContactByUuid(targetUuid))
            if (targetContact && targetContact.status && targetContact.status !== 'offline' && targetContact.status !== 'unavailable') {
              setTimeout(() => {
                newMsg.readStatus = 'Đã nhận'
                this.saveRooms()
              }, 600)
            }
          }
          this.saveRooms()
        }
      }
    } catch (e) {
      newMsg.readStatus = 'Đã gửi'
      // Giữ ID tạm khi chạy ngoại tuyến hoặc timeout mạng
      logger.warn('CHAT', `Gửi tin nhắn ngoại tuyến hoặc timeout: ${e.message}`)
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
    logger.info('CHAT', `Tạo nhóm thành công trên Wazo server với UUID: ${newRoomUuid}`)

    // Gửi tin nhắn khởi tạo nhóm chào mừng các thành viên & chuyển tiếp lịch sử (nếu có)
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

      // Chuyển tiếp tin nhắn cũ sang phòng nhóm mới kèm FWD Metadata đối xứng
      if (Array.isArray(forwardedMessages) && forwardedMessages.length > 0) {
        const recentMsgs = forwardedMessages.slice(-25)
        for (const m of recentMsgs) {
          if (!m.text) continue
          const origSender = m.senderName || (m.sender === 'mine' ? myName : 'Thành viên')
          const origUuid = m.user_uuid || ''
          const timeStr = m.time || ''
          const fwdPayload = `💬 [FWD:user_uuid=${origUuid}|sender=${origSender}|time=${timeStr}] ${m.text}`

          try {
            await fetch(`${host}/api/chatd/1.0/users/me/rooms/${newRoomUuid}/messages`, {
              method: 'POST',
              headers: {
                'X-Auth-Token': token,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              signal: AbortSignal.timeout(4000),
              body: JSON.stringify({
                content: fwdPayload,
                alias: origSender,
              }),
            })
          } catch (fwdErr) {
            /* ignore individual message failure */
          }
        }
      }
    } catch (msgErr) {
      logger.warn('CHAT', `Không thể gửi tin nhắn khởi tạo/chuyển tiếp: ${msgErr.message}`)
    }

    // Làm mới danh sách phòng từ server
    await this.getRooms()
    const createdRoom = (this.rooms || []).find((r) => r.id === newRoomUuid)
    return createdRoom || roomData
  }

  /**
   * Đổi tên nhóm chat và gửi thông báo hệ thống lên máy chủ Wazo (Chỉ Admin)
   * @param {string} roomId - UUID phòng chat
   * @param {string} newTitle - Tên nhóm mới
   */
  async renameGroup(roomId, newTitle) {
    const cleanTitle = (newTitle || '').trim()
    if (!cleanTitle) {
      throw new Error('Vui lòng nhập tên nhóm mới')
    }
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room) {
      throw new Error('Không tìm thấy phòng chat')
    }

    const myName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Quản trị viên'
    room.title = cleanTitle
    room.updatedAt = Date.now()
    this.saveRooms()

    // Gửi tin nhắn thông báo hệ thống lên server Wazo theo chuẩn Tag hệ thống chuyên biệt
    const renameTag = `🔔 [SYSTEM:ROOM_RENAME:title="${cleanTitle}"] [${myName}] đã đổi tên nhóm thành: "${cleanTitle}"`
    try {
      await this.sendMessage(roomId, renameTag, 'Hệ thống')
    } catch (e) {
      logger.warn('CHAT', `Lỗi gửi tin nhắn thông báo đổi tên: ${e.message}`)
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
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room) {
      throw new Error('Không tìm thấy phòng chat')
    }

    const remainingMembers = (room.members || []).filter(
      (m) => (m.id !== memberUuid && m.uuid !== memberUuid),
    )

    if (remainingMembers.length < 2) {
      throw new Error('Số lượng thành viên tối thiểu của nhóm là 2 người, không thể xóa thêm!')
    }

    const removedMember = (room.members || []).find(
      (m) => (m.id === memberUuid || m.uuid === memberUuid),
    )
    const removedName = removedMember?.name || 'Một thành viên'
    const myName = wazoService.getMyUserName() || localStorage.getItem('smartcall_username') || 'Quản trị viên'
    const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''

    const remainingUuids = remainingMembers.map((m) => m.id || m.uuid).filter(Boolean)

    logger.info('CHAT', `Đang cập nhật nhóm sau khi xóa [${removedName}]...`)
    const newRoom = await this.createGroupRoom(room.title, remainingUuids, room.messages || [])

    // Gửi thông báo đến phòng cũ để thành viên bị xóa nhận biết trạng thái
    try {
      await this.sendMessage(roomId, `⚠️ Bạn [${removedName}] đã được Quản trị viên (${myName}) mời ra khỏi nhóm thảo luận.`, 'Hệ thống')
    } catch (e) {
      /* ignore */
    }

    // Đóng phòng cũ bằng Tombstone SYSTEM:ROOM_CLOSED chuẩn Wazo API
    try {
      await this.sendMessage(
        roomId,
        `🚫 [SYSTEM:ROOM_CLOSED:by=${myUserUuid}|new_room=${newRoom.id}|name="${room.title}"] Nhóm đã được chuyển sang phòng mới.`,
        'Hệ thống',
      )
    } catch (e) {
      /* ignore */
    }

    // Ẩn phòng cũ ngay lập tức khỏi RAM
    this.rooms = (this.rooms || []).filter((r) => r.id !== roomId)
    if (this.activeRoomId === roomId) {
      this.setActiveRoomId(newRoom.id)
    }
    this.saveRooms()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId } }))
    }

    // Gửi tin nhắn thông báo cập nhật vào phòng mới
    try {
      await this.sendMessage(newRoom.id, `👋 [${myName}] đã cập nhật thành viên: [${removedName}] đã rời nhóm thảo luận.`, 'Hệ thống')
    } catch (e) {
      /* ignore */
    }

    return newRoom
  }

  /**
   * Xóa một cuộc trò chuyện bất kỳ (cả nhóm lẫn 1-1) bằng Tombstone System Message
   * Lưu trên Wazo server, các thiết bị khi tải phòng sẽ tự động ẩn phòng đã đóng
   * @param {string} roomId - UUID phòng chat
   */
  async deleteRoom(roomId) {
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (!room) return false

    const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const roomTitle = room.title || (room.isDirect ? 'Cuộc trò chuyện' : 'Nhóm thảo luận')
    const tombstoneMsg = room.isDirect
      ? `🚫 [SYSTEM:ROOM_CLOSED:by=${myUserUuid}|name="${roomTitle}"] Cuộc trò chuyện này đã kết thúc.`
      : `🚫 [SYSTEM:ROOM_CLOSED:by=${myUserUuid}|name="${roomTitle}"] Nhóm này đã được giải tán.`

    try {
      await this.sendMessage(roomId, tombstoneMsg, 'Hệ thống')
    } catch (e) {
      logger.warn('CHAT', `Lỗi gửi tombstone đóng cuộc trò chuyện: ${e.message}`)
    }

    // Ẩn phòng ngay lập tức khỏi RAM
    this.rooms = (this.rooms || []).filter((r) => r.id !== roomId)
    if (this.activeRoomId === roomId) {
      this.setActiveRoomId(null)
    }
    this.saveRooms()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-room-closed', { detail: { roomId } }))
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    }
    return true
  }

  /**
   * Xóa đồng loạt nhiều cuộc trò chuyện (Batch Room Deletion)
   * @param {string[]} roomIds - Danh sách UUID phòng chat cần xóa
   */
  async deleteMultipleRooms(roomIds) {
    if (!Array.isArray(roomIds) || roomIds.length === 0) return 0
    let count = 0
    for (const rId of roomIds) {
      try {
        await this.deleteRoom(rId)
        count++
      } catch (e) {
        logger.warn('CHAT', `Lỗi xóa phòng [${rId}]:`, e.message)
      }
    }
    return count
  }

  /**
   * Giải tán / Xóa phòng nhóm bằng Tombstone System Message (Hỗ trợ tương thích ngược)
   * @param {string} roomId - UUID phòng chat
   */
  async deleteGroupRoom(roomId) {
    return this.deleteRoom(roomId)
  }

  /**
   * Xóa một hoặc nhiều tin nhắn bằng Tombstone System Message
   * Lọc bỏ hoàn toàn các tin nhắn có ID bị xóa khi hiển thị lịch sử chat
   * @param {string} roomId
   * @param {string|string[]} messageIds
   */
  async deleteMessages(roomId, messageIds) {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
    const validIds = ids.filter(Boolean)
    if (validIds.length === 0) return

    const myUserUuid = wazoService.getMyUserUuid() || localStorage.getItem('smartcall_user_uuid') || ''
    const idsStr = validIds.join(',')
    const delText = `🚫 [SYSTEM:MSG_DELETED:ids="${idsStr}"|by="${myUserUuid}"]`

    // Xóa ngay lập tức trên UI/RAM (Optimistic 0ms)
    const room = (this.rooms || []).find((r) => r.id === roomId)
    if (room && room.messages) {
      room.messages = room.messages.filter((m) => !validIds.includes(m.id))
      if (room.messages.length > 0) {
        const last = room.messages[room.messages.length - 1]
        room.preview = last.text
        room.time = last.time
        room.updatedAt = last.timestamp
      } else {
        room.preview = 'Cuộc trò chuyện'
      }
      this.saveRooms()
    }

    try {
      await this.sendMessage(roomId, delText, 'Hệ thống')
    } catch (e) {
      logger.warn('CHAT', `Lỗi khi gửi tombstone xóa tin nhắn: ${e.message}`)
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('smartcall-messages-deleted', {
          detail: { roomId, deletedIds: validIds },
        }),
      )
    }
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
    this.activeRoomId = null
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
