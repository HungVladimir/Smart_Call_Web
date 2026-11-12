import { wazoService } from './wazo'

const STORAGE_KEY = 'smartcall_chat_rooms'

/**
 * Dữ liệu phòng chat và tin nhắn mẫu ban đầu
 */
const INITIAL_MOCK_ROOMS = [
  {
    id: 'room-tech-part',
    title: 'Nhóm Kỹ thuật LAN',
    preview: 'ok bạn ơi, để mình kiểm tra thử',
    time: '15:32',
    unread: 0,
    pinned: 'Thông báo kỹ thuật: Kiểm tra định kỳ đường truyền SIP Trunk và line WebRTC phòng điều hành.',
    avatarBg: '#0284c7',
    icon: '👥',
    isDirect: false,
    memberCount: 4,
    members: [
      { id: '1001', name: 'Quản trị viên', dept: 'Khối Kỹ thuật', ext: '1001', isAdmin: true },
      { id: '1006', name: 'Lương Đức Anh', dept: 'Phòng Phát triển Phần mềm', ext: '1006', isAdmin: false },
      { id: '1007', name: 'Nguyễn Hữu Hiếu', dept: 'Trưởng nhóm Phát triển Hệ thống', ext: '1007', isAdmin: false },
      { id: '1002', name: 'Nguyễn Văn An', dept: 'Khối Kỹ thuật / Nhóm Ứng dụng', ext: '1002', isAdmin: false },
      { id: '1003', name: 'Trần Văn Bình', dept: 'Khối Vận hành / Phân xưởng MFQ', ext: '1003', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-101',
        sender: 'theirs',
        senderName: 'Lương Đức Anh',
        dept: 'Kỹ sư Phần mềm',
        text: 'Mọi người kiểm tra giúp em line 1002 có gọi sang được phân xưởng không ạ?',
        time: '15:28',
        readStatus: 'Read (12)',
        readers: ['Quản trị viên', 'Nguyễn Hữu Hiếu', 'Nguyễn Văn An', 'Trần Văn Bình'],
      },
      {
        id: 'msg-102',
        sender: 'mine',
        senderName: 'Tôi',
        dept: 'Khối Kỹ thuật',
        text: 'Mình vừa thử kiểm tra gọi thoại qua WebRTC, mic và âm thanh đều thông suốt rồi nhé!',
        time: '15:30',
        readStatus: 'Read (4)',
        readers: ['Lương Đức Anh', 'Trần Văn Bình', 'Nguyễn Hữu Hiếu'],
      },
      {
        id: 'msg-103',
        sender: 'theirs',
        senderName: 'Lương Đức Anh',
        dept: 'Kỹ sư Phần mềm',
        text: 'ok bạn ơi, để mình kiểm tra thử',
        time: '15:32',
        readStatus: 'Read (1)',
        readers: ['Quản trị viên'],
      },
    ],
  },
  {
    id: 'room-mfq-mp',
    title: 'Vận hành Phân xưởng MFQ',
    preview: 'Báo cáo ca làm việc hôm nay bình thường.',
    time: '15:58',
    unread: 0,
    pinned: 'Thông báo chuyển giao ca trực: Bàn giao hệ thống giám sát và tổng đài cho ca kế tiếp.',
    avatarBg: '#10b981',
    icon: '🏭',
    isDirect: false,
    memberCount: 3,
    members: [
      { id: '1001', name: 'Quản trị viên', dept: 'Khối Kỹ thuật', ext: '1001', isAdmin: true },
      { id: '1005', name: 'Ngô Tiến Việt', dept: 'Phòng Phát triển Phần mềm', ext: '1005', isAdmin: false },
      { id: '1008', name: 'Trịnh Thế Duyệt', dept: 'Tổ Vận hành Phân xưởng', ext: '1008', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-201',
        sender: 'theirs',
        senderName: 'Trịnh Thế Duyệt',
        dept: 'Tổ Vận hành Phân xưởng',
        text: 'Báo cáo ca làm việc hôm nay bình thường.',
        time: '15:58',
        readStatus: 'Read (5)',
        readers: ['Quản trị viên'],
      },
    ],
  },
  {
    id: 'room-direct-1007',
    title: 'Nguyễn Hữu Hiếu',
    preview: 'Bạn test thử cuộc gọi trên máy 1002 nhé',
    time: '14:15',
    unread: 0,
    pinned: '',
    avatarBg: '#f59e0b',
    icon: 'NH',
    isDirect: true,
    ext: '1007',
    memberCount: 2,
    members: [
      { id: '1001', name: 'Quản trị viên', dept: 'Khối Kỹ thuật', ext: '1001', isAdmin: true },
      { id: '1007', name: 'Nguyễn Hữu Hiếu', dept: 'Trưởng nhóm Phát triển Hệ thống', ext: '1007', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-301',
        sender: 'theirs',
        senderName: 'Nguyễn Hữu Hiếu',
        dept: 'Trưởng nhóm Phát triển Hệ thống',
        text: 'Bạn test thử cuộc gọi trên máy 1002 nhé',
        time: '14:15',
        readStatus: 'Read (1)',
        readers: ['Quản trị viên'],
      },
    ],
  },
]

class ChatService {
  constructor() {
    this.rooms = this.loadSavedRooms()
  }

  // Tải dữ liệu phòng chat từ localStorage để không bao giờ bị mất khi chuyển tab / F5
  loadSavedRooms() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Bổ sung thời gian updatedAt nếu phòng cũ chưa có
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
    const initial = JSON.parse(JSON.stringify(INITIAL_MOCK_ROOMS))
    initial.forEach((r, idx) => {
      r.updatedAt = Date.now() - idx * 60000
    })
    return initial
  }

  // Sắp xếp các phòng chat theo thứ tự tin nhắn mới nhất lên đầu (Top 1)
  sortRooms() {
    if (!this.rooms || !Array.isArray(this.rooms)) return
    this.rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  // Lưu bền vững vào localStorage
  saveRooms() {
    try {
      this.sortRooms()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rooms))
    } catch (e) {
      console.warn('Lỗi lưu cache phòng chat:', e)
    }
  }

  /**
   * Lấy danh sách các phòng chat của user
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
            // Đồng bộ dữ liệu phòng thật
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
    return [...this.rooms]
  }

  /**
   * Tải lịch sử tin nhắn từ Wazo Chatd server cho một phòng chat thật
   * GET /api/chatd/1.0/users/me/rooms/{roomId}/messages?limit=50 (dev_guide.md mục 4.6)
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
            const currentUserName = localStorage.getItem('smartcall_username') || 'Quản trị viên'
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
      console.warn('Lỗi tải tin nhắn từ Wazo server, sử dụng tin nhắn cache:', e)
    }

    return localRoom?.messages || []
  }

  /**
   * Tìm hoặc tạo phòng chat 1-1 với một máy lẻ (Đảm bảo lưu bền vững không bị mất)
   */
  async getDirectRoom(ext, name, currentUserName = 'Quản trị viên') {
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
        preview: 'Bắt đầu cuộc trò chuyện trực tiếp...',
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
          { id: `emp-${ext}`, name: name, dept: 'Nội bộ công ty', ext: ext, isAdmin: false },
        ],
        messages: [
          {
            id: `msg-${Date.now()}`,
            sender: 'theirs',
            senderName: name,
            text: `Xin chào! Bạn có thể trao đổi trực tiếp với tôi qua máy lẻ ${ext}.`,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            readStatus: 'Read',
            readers: [currentUserName],
          },
        ],
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
