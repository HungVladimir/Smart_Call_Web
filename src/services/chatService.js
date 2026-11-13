import { wazoService } from './wazo'
import { logger } from './loggerService'

const STORAGE_KEY = 'smartcall_chat_rooms'

class ChatService {
  constructor() {
    this.rooms = this.loadSavedRooms()
  }

  // Tải dữ liệu phòng chat từ localStorage để duy trì trạng thái khi chuyển tab hoặc tải lại trang
  loadSavedRooms() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Bổ sung thời gian updatedAt nếu phòng chưa có
          parsed.forEach((r, idx) => {
            if (!r.updatedAt) {
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

  // Lưu bền vững vào localStorage
  saveRooms() {
    try {
      this.sortRooms()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rooms))
      window.dispatchEvent(new CustomEvent('smartcall-rooms-updated'))
    } catch (e) {
      console.warn('Lỗi lưu cache phòng chat:', e)
    }
  }

  /**
   * Lấy danh sách các phòng chat của người dùng
   */
  async getRooms() {
    try {
      const token = wazoService.getToken()
      if (token) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
          headers: { 'X-Auth-Token': token },
        })

        if (res.ok) {
          const data = await res.json()
          if (data.items && data.items.length > 0) {
            // Đồng bộ dữ liệu phòng thật từ máy chủ Wazo
            return data.items.map((room) => ({
              id: room.uuid,
              title: room.name || 'Phòng thảo luận',
              preview: 'Cuộc trò chuyện mới',
              time: '',
              unread: 0,
              avatarBg: '#3b82f6',
              icon: (room.name || 'CH').slice(0, 2).toUpperCase(),
              messages: [],
            }))
          }
        }
      }
    } catch (err) {
      /* Fallback sang local rooms */
    }

    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = this.loadSavedRooms()
    }
    this.sortRooms()
    return [...(this.rooms || [])]
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
              this.saveRooms()
            }
            return mapped
          }
        }
      }
    } catch (e) {
      console.warn('Lỗi tải tin nhắn từ máy chủ, sử dụng dữ liệu cục bộ:', e)
    }

    return localRoom?.messages || []
  }

  /**
   * Tìm hoặc tạo phòng chat 1-1 với một máy lẻ
   */
  async getDirectRoom(ext, name, currentUserName = 'Người dùng') {
    if (!this.rooms || this.rooms.length === 0) {
      this.rooms = this.loadSavedRooms()
    }

    let found = this.rooms.find(
      (r) => r.ext === ext || (r.title && (r.title === name || r.title.includes(ext))),
    )

    if (!found) {
      found = {
        id: `direct-${ext}-${Date.now()}`,
        title: name,
        preview: 'Bắt đầu cuộc trò chuyện...',
        time: 'Mới',
        unread: 0,
        avatarBg: '#0284c7',
        icon: (name || 'U').slice(0, 2).toUpperCase(),
        isDirect: true,
        ext: ext,
        memberCount: 2,
        updatedAt: Date.now(),
        members: [
          { id: '1001', name: currentUserName, dept: 'Khối Kỹ thuật', ext: '1001', isAdmin: true },
          { id: `emp-${ext}`, name: name, dept: 'Nội bộ', ext: ext, isAdmin: false },
        ],
        messages: [],
      }
      this.rooms.unshift(found)
      this.saveRooms()
    } else {
      found.updatedAt = Date.now()
      this.saveRooms()
    }

    return found
  }

  /**
   * Gửi một tin nhắn mới vào phòng
   * Cập nhật vào mảng phòng và lưu ngay vào localStorage
   */
  async sendMessage(roomId, text, userAlias = 'Tôi') {
    const now = new Date()
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const newMsg = {
      id: `msg-${Date.now()}`,
      sender: 'mine',
      senderName: userAlias,
      dept: 'Khối Kỹ thuật',
      text,
      time: timeStr,
      readStatus: 'Read (0)',
      readers: [],
    }

    try {
      const token = wazoService.getToken()
      if (token) {
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        await fetch(`${host}/api/chatd/1.0/users/me/rooms/${roomId}/messages`, {
          method: 'POST',
          headers: {
            'X-Auth-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: text,
            alias: userAlias,
          }),
        })
      }
    } catch (e) {
      // Bỏ qua khi chạy chế độ offline
    }

    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      if (!room.messages) room.messages = []
      room.messages.push(newMsg)
      room.preview = text
      room.time = timeStr
      room.updatedAt = Date.now()
      this.saveRooms()
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
}

export const chatService = new ChatService()
