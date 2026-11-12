import { wazoService } from './wazo'

/**
 * Dữ liệu phòng chat và tin nhắn mẫu chuẩn hệ thống LAN
 */
const MOCK_ROOMS = [
  {
    id: 'room-tech-part',
    title: 'Nhóm Kỹ thuật LAN',
    preview: 'ok bạn ơi, để mình kiểm tra thử',
    time: '15:32',
    unread: 2,
    pinned: 'Thông báo kỹ thuật: Kiểm tra định kỳ đường truyền SIP Trunk và line WebRTC phòng điều hành.',
    avatarBg: '#0284c7',
    icon: '👥',
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
    unread: 3,
    pinned: 'Thông báo chuyển giao ca trực: Bàn giao hệ thống giám sát và tổng đài cho ca kế tiếp.',
    avatarBg: '#10b981',
    icon: '🏭',
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
    this.rooms = [...MOCK_ROOMS]
  }

  /**
   * Lấy danh sách các phòng chat của user
   * REST API: GET /api/chatd/1.0/users/me/rooms
   */
  async getRooms() {
    try {
      const token = wazoService.getToken()
      if (!token) throw new Error('No token')

      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms`, {
        headers: { 'X-Auth-Token': token },
      })

      if (!res.ok) throw new Error(`HTTP error ${res.status}`)
      const data = await res.json()

      if (data.items && data.items.length > 0) {
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
      return this.rooms
    } catch (err) {
      return this.rooms
    }
  }

  /**
   * Gửi một tin nhắn mới vào phòng
   * POST /api/chatd/1.0/users/me/rooms/{room_uuid}/messages
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
      // Bỏ qua khi chạy chế độ mô phỏng
    }

    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      room.messages.push(newMsg)
      room.preview = text
      room.time = timeStr
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
      return true
    }
    return false
  }

  /**
   * Đổi tiêu đề phòng chat (Admin mới được đổi, tối đa 100 chữ)
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
      return true
    }
    return false
  }
}

export const chatService = new ChatService()
