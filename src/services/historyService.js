import { wazoService } from './wazo'

/**
 * MOCK DATA LỊCH SỬ CUỘC GỌI CHUẨN DOANH NGHIỆP SDV
 * Tương đồng với ảnh web1.webp (Date, Duration, Direction, Status) và máy lẻ nội bộ 4 số.
 */
const MOCK_HISTORY = [
  {
    id: 'cdr-001',
    date: '2026-11-11 15:39:27',
    name: '조창연 (이윤수)',
    extension: '1002',
    dept: 'SDV MES 1 / SDV Application Group',
    duration: 9, // 00:09
    direction: 'inbound', // 'inbound' | 'outbound'
    directionLabel: 'Incoming',
    status: 'success', // 'success' | 'missed' | 'declined'
    statusLabel: 'Success',
    answered: true,
  },
  {
    id: 'cdr-002',
    date: '2026-11-11 15:00:38',
    name: 'Nguyễn Hữu Hiếu (Kaito)',
    extension: '1007',
    dept: 'SDV MES Application Group Lead',
    duration: 24, // 00:24
    direction: 'inbound',
    directionLabel: 'Incoming',
    status: 'success',
    statusLabel: 'Success',
    answered: true,
  },
  {
    id: 'cdr-003',
    date: '2026-11-11 14:42:45',
    name: 'Lương Đức Anh (ducanh)',
    extension: '1006',
    dept: 'SDV MES Development Part',
    duration: 0, // 00:00
    direction: 'inbound',
    directionLabel: 'Incoming',
    status: 'missed',
    statusLabel: 'Missed',
    answered: false,
  },
  {
    id: 'cdr-004',
    date: '2026-11-11 13:28:34',
    name: 'Bob Trần',
    extension: '1003',
    dept: 'SDV MES 2 / Vận hành MFQ/MP',
    duration: 182, // 03:02
    direction: 'outbound',
    directionLabel: 'Outgoing',
    status: 'success',
    statusLabel: 'Success',
    answered: true,
  },
  {
    id: 'cdr-005',
    date: '2026-11-11 11:10:10',
    name: 'Ngô Tiến Việt (Storm)',
    extension: '1005',
    dept: 'SDV MES Development Part',
    duration: 7, // 00:07
    direction: 'inbound',
    directionLabel: 'Incoming',
    status: 'success',
    statusLabel: 'Success',
    answered: true,
  },
  {
    id: 'cdr-006',
    date: '2026-11-11 09:09:12',
    name: 'Carol Lê',
    extension: '1004',
    dept: 'MOS Part (SDV)',
    duration: 0,
    direction: 'outbound',
    directionLabel: 'Outgoing',
    status: 'declined',
    statusLabel: 'Declined (No answer)',
    answered: false,
  },
  {
    id: 'cdr-007',
    date: '2026-11-10 16:20:00',
    name: 'Alice Nguyễn',
    extension: '1002',
    dept: 'SDV MES 1 / SDV Application Group',
    duration: 65, // 01:05
    direction: 'outbound',
    directionLabel: 'Outgoing',
    status: 'success',
    statusLabel: 'Success',
    answered: true,
  },
]

class HistoryService {
  constructor() {
    this.localHistory = [...MOCK_HISTORY]
  }

  /**
   * Format số giây thành chuỗi mm:ss (hoặc hh:mm:ss)
   */
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  /**
   * Lấy lịch sử cuộc gọi:
   * 1. Thử gọi Wazo Call-Logd API (hoặc API DB của anh Hải sau này):
   *    GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc
   * 2. Nếu thất bại (offline/chưa có DB) -> Fallback sang Mock Data chuẩn SDV.
   */
  async getHistory({ tab = 'all', limit = 50 } = {}) {
    try {
      const token = wazoService.getToken()
      if (!token) throw new Error('No token available')

      const host = wazoService.host.startsWith('http')
        ? wazoService.host
        : `https://${wazoService.host}`

      // Bám sát mục 4.3 trong dev_guide.md
      const url = `${host}/api/call-logd/1.0/users/me/cdr?limit=${limit}&order=start&direction=desc`
      const res = await fetch(url, {
        headers: {
          'X-Auth-Token': token,
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) throw new Error(`HTTP error ${res.status}`)

      const data = await res.json()
      if (!data.items) return this._filterLocal(tab)

      // Map trường dữ liệu từ Wazo CDR sang cấu trúc hiển thị của SmartCall Web
      const mapped = data.items.map((cdr, idx) => {
        const isOutbound = cdr.call_direction === 'outbound'
        const isAnswered = Boolean(cdr.answered)
        const durationSec = cdr.duration || 0

        const name = isOutbound
          ? cdr.destination_name || cdr.destination_extension || 'Số ngoài'
          : cdr.source_name || cdr.source_extension || 'Số ngoài'

        const extension = isOutbound
          ? cdr.destination_extension || ''
          : cdr.source_extension || ''

        let status = 'success'
        let statusLabel = 'Success'
        if (!isAnswered) {
          status = isOutbound ? 'declined' : 'missed'
          statusLabel = isOutbound ? 'Declined' : 'Missed'
        }

        return {
          id: cdr.id || `cdr-${idx}`,
          date: cdr.start ? cdr.start.replace('T', ' ').substring(0, 19) : '',
          name,
          extension,
          dept: 'Nội bộ SDV',
          duration: durationSec,
          direction: isOutbound ? 'outbound' : 'inbound',
          directionLabel: isOutbound ? 'Outgoing' : 'Incoming',
          status,
          statusLabel,
          answered: isAnswered,
        }
      })

      return this._filterList(mapped, tab)
    } catch (err) {
      // Offline fallback: Dùng dữ liệu mock nội bộ để UI luôn chạy mượt
      return this._filterLocal(tab)
    }
  }

  /**
   * Lọc danh sách theo tab (ALL, INCOMINGS, OUTGOINGS, MISSED)
   */
  _filterLocal(tab) {
    return this._filterList(this.localHistory, tab)
  }

  _filterList(list, tab) {
    if (tab === 'inbound' || tab === 'incomings') {
      return list.filter((item) => item.direction === 'inbound')
    }
    if (tab === 'outbound' || tab === 'outgoings') {
      return list.filter((item) => item.direction === 'outbound')
    }
    if (tab === 'missed') {
      return list.filter((item) => item.status === 'missed' || !item.answered)
    }
    return list // 'all'
  }

  /**
   * Xóa toàn bộ lịch sử cuộc gọi (tương ứng nút DELETE HISTORY trên web1.webp)
   */
  async clearAllHistory() {
    this.localHistory = []
    try {
      const token = wazoService.getToken()
      if (token) {
        // Nếu backend Wazo hoặc API anh Hải hỗ trợ DELETE CDR
        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`
        await fetch(`${host}/api/call-logd/1.0/users/me/cdr`, {
          method: 'DELETE',
          headers: { 'X-Auth-Token': token },
        })
      }
    } catch (e) {
      // Ignored in offline/mock mode
    }
    return true
  }

  /**
   * Xóa 1 bản ghi lịch sử cụ thể
   */
  async deleteItem(id) {
    const idx = this.localHistory.findIndex((item) => item.id === id)
    if (idx !== -1) {
      this.localHistory.splice(idx, 1)
      return true
    }
    return false
  }
}

export const historyService = new HistoryService()

