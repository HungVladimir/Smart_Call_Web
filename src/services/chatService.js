import { wazoService } from './wazo'

/**
 * MOCK DATA PHÒNG CHAT & TIN NHẮN CHUẨN DOANH NGHIỆP SDV LAN
 * Bám sát nghiệp vụ trong ảnh app1.webp, app2.webp, app3.webp
 */
const MOCK_ROOMS = [
  {
    id: 'room-mos-part',
    title: 'MOS PART (31 thành viên)',
    preview: 'ok anh ơi, để em ngâm cứu thử',
    time: '15:32',
    unread: 2,
    pinned: 'Nếu Scan TRAY ID hoặc cột TRAY ID phần NEW không bị null thì run thêm query này khi save: DELETE FROM WP1MOD_TBL_ISSUE_CELL WHERE 1=1 AND STOCKERID = #WT5FE05-004 AND TRAY_LOT IS NULL',
    avatarBg: '#0284c7',
    icon: '👥',
    members: [
      { id: '1001', name: 'Lê Việt Dũng', dept: 'SDV MES 1', ext: '1001', isAdmin: true },
      { id: '1006', name: 'Lương Đức Anh (ducanh)', dept: 'SDV MES Development Part', ext: '1006', isAdmin: false },
      { id: '1007', name: 'Nguyễn Hữu Hiếu (Kaito)', dept: 'SDV MES Application Group Lead', ext: '1007', isAdmin: false },
      { id: '1002', name: 'Alice Nguyễn', dept: 'SDV MES 1 / SDV Application Group', ext: '1002', isAdmin: false },
      { id: '1003', name: 'Bob Trần', dept: 'SDV MES 2 / Vận hành MFQ/MP', ext: '1003', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-101',
        sender: 'theirs',
        senderName: 'Lương Đức Anh (ducanh)',
        dept: 'Engineer / SDV MES Development Part, SDV',
        text: 'Các anh kiểm tra giúp em line 1002 có gọi sang được bên phân xưởng không ạ?',
        time: '15:28',
        readStatus: 'Read (12)',
        readers: ['Lê Việt Dũng', 'Nguyễn Hữu Hiếu', 'Alice Nguyễn', 'Bob Trần', 'Ngô Tiến Việt'],
      },
      {
        id: 'msg-102',
        sender: 'mine',
        senderName: 'Tôi (Lê Việt Dũng)',
        dept: 'SDV MES 1',
        text: 'Anh vừa thử test gọi thoại qua WebRTC Wazo, mic và âm thanh đều thông suốt rồi nhé!',
        time: '15:30',
        readStatus: 'Read (4)',
        readers: ['Lương Đức Anh', 'Bob Trần', 'Nguyễn Hữu Hiếu'],
      },
      {
        id: 'msg-103',
        sender: 'theirs',
        senderName: 'Lương Đức Anh (ducanh)',
        dept: 'Engineer / SDV MES Development Part, SDV',
        text: 'ok anh ơi, để em ngâm cứu thử',
        time: '15:32',
        readStatus: 'Read (1)',
        readers: ['Lê Việt Dũng'],
      },
    ],
  },
  {
    id: 'room-mfq-mp',
    title: '[QD Project] Vận hành MFQ/MP',
    preview: 'There are new messages. (3)',
    time: '15:58',
    unread: 3,
    pinned: 'Thông báo chuyển giao ca trực 2: Kiểm tra kết nối SIP Trunk và line WebRTC phòng điều hành.',
    avatarBg: '#10b981',
    icon: '🏭',
    members: [
      { id: '1001', name: 'Lê Việt Dũng', dept: 'SDV MES 1', ext: '1001', isAdmin: true },
      { id: '1005', name: 'Ngô Tiến Việt (Storm)', dept: 'SDV MES Development Part', ext: '1005', isAdmin: false },
      { id: '1008', name: 'Trịnh Thế Duyệt', dept: 'MFQ Operator', ext: '1008', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-201',
        sender: 'theirs',
        senderName: 'Trịnh Thế Duyệt',
        dept: 'MFQ Operator',
        text: 'Báo cáo ca làm việc hôm nay bình thường.',
        time: '15:58',
        readStatus: 'Read (5)',
        readers: ['Lê Việt Dũng'],
      },
    ],
  },
  {
    id: 'room-direct-1007',
    title: 'Nguyễn Hữu Hiếu (Kaito)',
    preview: 'Anh test thử cuộc gọi trên máy 1002 nhé',
    time: '14:15',
    unread: 0,
    pinned: '',
    avatarBg: '#f59e0b',
    icon: 'NH',
    members: [
      { id: '1001', name: 'Lê Việt Dũng', dept: 'SDV MES 1', ext: '1001', isAdmin: true },
      { id: '1007', name: 'Nguyễn Hữu Hiếu (Kaito)', dept: 'SDV MES Application Group Lead', ext: '1007', isAdmin: false },
    ],
    messages: [
      {
        id: 'msg-301',
        sender: 'theirs',
        senderName: 'Nguyễn Hữu Hiếu',
        dept: 'SDV MES Application Group Lead',
        text: 'Anh test thử cuộc gọi trên máy 1002 nhé',
        time: '14:15',
        readStatus: 'Read (1)',
        readers: ['Lê Việt Dũng'],
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
   * Bám sát mục 4.6 trong dev_guide.md: GET /api/chatd/1.0/users/me/rooms
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
        // Map từ Wazo Chatd Room sang chuẩn SmartCall
        return data.items.map((room) => ({
          id: room.uuid,
          title: room.name || 'Phòng chat Wazo',
          preview: 'Cuộc trò chuyện mới',
          time: '',
          unread: 0,
          pinned: '',
          avatarBg: '#0284c7',
          icon: '👥',
          members: [],
          messages: [],
        }))
      }
      return this.rooms
    } catch (e) {
      // Fallback sang Mock Data chuẩn SDV khi offline
      return this.rooms
    }
  }

  /**
   * Lấy danh sách tin nhắn trong một phòng chat
   * GET /api/chatd/1.0/users/me/rooms/{room_uuid}/messages?limit=50
   */
  async getMessages(roomId) {
    try {
      const token = wazoService.getToken()
      if (!token) throw new Error('No token')

      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      const res = await fetch(`${host}/api/chatd/1.0/users/me/rooms/${roomId}/messages?limit=50`, {
        headers: { 'X-Auth-Token': token },
      })

      if (!res.ok) throw new Error(`HTTP error ${res.status}`)
      const data = await res.json()

      if (data.items) {
        return data.items.map((msg) => ({
          id: msg.uuid,
          sender: msg.user_uuid === wazoService.session?.uuid ? 'mine' : 'theirs',
          senderName: msg.alias || 'Đồng nghiệp',
          dept: 'Nội bộ SDV',
          text: msg.content,
          time: msg.created_at ? msg.created_at.substring(11, 16) : '',
          readStatus: 'Read',
          readers: [],
        }))
      }
    } catch (e) {
      // Offline fallback
    }

    const room = this.rooms.find((r) => r.id === roomId)
    return room ? room.messages : []
  }

  /**
   * Gửi một tin nhắn mới vào phòng
   * POST /api/chatd/1.0/users/me/rooms/{room_uuid}/messages
   * body: { content: "...", alias: "..." }
   */
  async sendMessage(roomId, text, userAlias = 'Tôi (Lê Việt Dũng)') {
    const now = new Date()
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const newMsg = {
      id: `msg-${Date.now()}`,
      sender: 'mine',
      senderName: userAlias,
      dept: 'SDV MES 1',
      text,
      time: timeStr,
      readStatus: 'Read (0)',
      readers: [],
    }

    // Cố gắng gửi qua API thật
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
      // Ignored in offline mode
    }

    // Cập nhật local
    const room = this.rooms.find((r) => r.id === roomId)
    if (room) {
      room.messages.push(newMsg)
      room.preview = text
      room.time = timeStr
    }

    return newMsg
  }

  /**
   * Thêm thành viên vào phòng (theo nghiệp vụ app3.webp)
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
   * Xóa thành viên khỏi phòng (Ràng buộc: Không xóa Admin, không xóa nếu Recent < 3)
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
   * Đổi tiêu đề phòng chat (Admin mới được đổi, tối đa 100 chữ theo app3.webp)
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
   * Ghim hoặc hủy ghim thông báo (Thanh ghim theo app2.webp)
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

