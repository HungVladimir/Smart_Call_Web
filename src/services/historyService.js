import { captureSessionContext, isSessionContextCurrent, createSessionFetch, invalidateSession } from './sessionScope'
import { wazoService } from './wazo'
import { logger } from './loggerService'

class HistoryService {
  constructor() {
    this.localHistory = []
    this._fetchingHistoryPromise = null
  }

  /**
   * Tải lại lịch sử từ máy chủ Wazo (gọi khi đăng nhập thành công hoặc làm mới)
   * Đặt lại bộ nhớ RAM và fetch trực tiếp từ Call-Logd API
   */
async reload() {
    this.localHistory = []
    this._fetchingHistoryPromise = null
    return await this.getHistory({ forceRefresh: true })
  }

  /**
   * Thêm một bản ghi cuộc gọi mới vào đầu lịch sử trong bộ nhớ RAM (Top 1)
   */
  addRecord({
    name = 'Ẩn danh',
    extension = '',
    dept = '',
    duration = 0,
    direction = 'outbound',
    status = 'success',
    answered = true,
    recordingId = null,
    hasRecording = false,
  } = {}) {
    if (!this.localHistory) {
      this.localHistory = []
    }
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

    const directionLabel = direction === 'inbound' ? 'Incoming' : 'Outgoing'
    let statusLabel = 'Success'
    if (status === 'missed') {
      statusLabel = 'Missed'
    } else if (status === 'declined') {
      statusLabel = 'Declined'
    }

    const newCdr = {
      id: `cdr-${Date.now()}`,
      date: dateStr,
      name,
      extension: String(extension || ''),
      dept,
      duration: Math.max(0, parseInt(duration, 10) || 0),
      direction,
      directionLabel,
      status,
      statusLabel,
      answered: Boolean(answered),
      recordingId: recordingId || null,
      hasRecording: Boolean(hasRecording || recordingId),
    }

    this.localHistory.unshift(newCdr)
    window.dispatchEvent(new CustomEvent('smartcall-cdr-updated', { detail: newCdr }))
    return newCdr
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
   * Nạp lịch sử cuộc gọi hiện tại trong bộ nhớ RAM (0ms instant)
   */
  getLocalHistory({ tab = 'all' } = {}) {
    if (!this.localHistory) {
      this.localHistory = []
    }
    return this._filterList(this.localHistory, tab)
  }

  /**
   * Lấy lịch sử cuộc gọi trực tiếp từ Wazo Call-Logd API:
   * GET /api/call-logd/1.0/users/me/cdr?limit=50&order=start&direction=desc
   * Tuân thủ nguyên tắc Zero Local Business Data: dữ liệu thuần RAM, không lưu localStorage.
   */
  async getHistory({ tab = 'all', limit = 50, forceRefresh = false } = {}) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (forceRefresh) {
      this._fetchingHistoryPromise = null
      this.localHistory = []
    }

    if (this._fetchingHistoryPromise) {
      const merged = await this._fetchingHistoryPromise
      return this._filterList(merged, tab)
    }

    this._fetchingHistoryPromise = (async () => {
      try {
        const token = wazoService.getToken()
        if (!token) throw new Error('No token available')

        const host = wazoService.host.startsWith('http')
          ? wazoService.host
          : `https://${wazoService.host}`

        // Gọi API Wazo Call-Logd lấy nhật ký cuộc gọi CDR
        const url = `${host}/api/call-logd/1.0/users/me/cdr?limit=${limit}&order=start&direction=desc`
        const res = await fetch(url, {
          headers: {
            'X-Auth-Token': token,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(3500),
        })

        if (!res.ok) throw new Error(`HTTP error ${res.status}`)

        const data = await res.json()
        if (!data.items) return this.localHistory || []

        const myExtension =
          wazoService.getMyExtension() || localStorage.getItem('smartcall_extension') || ''

        // Map trường dữ liệu từ Wazo CDR sang cấu trúc hiển thị của SmartCall Web
        const mapped = data.items.map((cdr, idx) => {
          let isOutbound = false
          if (cdr.call_direction === 'outbound') {
            isOutbound = true
          } else if (cdr.call_direction === 'inbound') {
            isOutbound = false
          } else {
            // Cuộc gọi nội bộ (call_direction === 'internal' hoặc không xác định):
            // Nếu máy lẻ nguồn trùng với máy lẻ của tôi -> Cuộc gọi đi (outbound)
            isOutbound =
              String(cdr.source_extension || '').trim() === String(myExtension || '').trim()
          }

          const isAnswered = Boolean(cdr.answered)
          const durationSec = cdr.duration || 0

          const name = isOutbound
            ? cdr.destination_name || (cdr.destination_extension ? `Máy lẻ ${cdr.destination_extension}` : 'Số ngoài')
            : cdr.source_name || (cdr.source_extension ? `Máy lẻ ${cdr.source_extension}` : 'Số ngoài')

          const extension = isOutbound
            ? cdr.destination_extension || ''
            : cdr.source_extension || ''

          let status = 'success'
          let statusLabel = 'Success'
          if (!isAnswered) {
            status = isOutbound ? 'declined' : 'missed'
            statusLabel = isOutbound ? 'Declined' : 'Missed'
          }

          const formatCdrDate = (isoStr) => {
            if (!isoStr) return ''
            const d = new Date(isoStr)
            if (isNaN(d.getTime())) return isoStr.replace('T', ' ').substring(0, 19)
            const pad = (n) => String(n).padStart(2, '0')
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
          }

          const serverRecs = cdr.recordings || []
          const hasServerRec = serverRecs.length > 0

          return {
            id: cdr.id || `cdr-${idx}`,
            date: formatCdrDate(cdr.start),
            name,
            extension,
            dept: 'Nội bộ công ty',
            duration: durationSec,
            direction: isOutbound ? 'outbound' : 'inbound',
            directionLabel: isOutbound ? 'Outgoing' : 'Incoming',
            status,
            statusLabel,
            answered: isAnswered,
            recordings: serverRecs,
            hasRecording: hasServerRec,
          }
        })

        // Hợp nhất dữ liệu: bổ sung các cuộc gọi vừa kết thúc còn lưu trong RAM chưa kịp lên CDR server
        const merged = [...mapped]
        if (Array.isArray(this.localHistory)) {
          this.localHistory.forEach((loc) => {
            const existing = merged.find(
              (m) =>
                m.id === loc.id ||
                (m.extension === loc.extension &&
                  Math.abs(new Date(m.date || 0) - new Date(loc.date || 0)) < 120000),
            )
            if (!existing) {
              merged.push(loc)
            }
          })
        }
        merged.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        this.localHistory = merged
        return merged
      } catch (err) {
        logger.warn('API', 'Không thể nạp CDR từ Wazo call-logd:', err.message)
        if (forceRefresh && isSessionContextCurrent(sessionContext)) {
          this.localHistory = []
        }
        return this.localHistory || []
      } finally {
        if (isSessionContextCurrent(sessionContext)) this._fetchingHistoryPromise = null
      }
    })()

    const list = await this._fetchingHistoryPromise
    return this._filterList(list, tab)
  }

  /**
   * Lọc danh sách theo tab (ALL, INCOMINGS, OUTGOINGS, MISSED)
   */
  _filterLocal(tab) {
    return this._filterList(this.localHistory, tab)
  }

  _filterList(list, tab) {
    if (!Array.isArray(list)) return []
    if (tab === 'inbound' || tab === 'incomings') {
      return list.filter((item) => item.direction === 'inbound')
    }
    if (tab === 'outbound' || tab === 'outgoings') {
      return list.filter((item) => item.direction === 'outbound')
    }
    if (tab === 'missed') {
      return list.filter(
        (item) => item.status === 'missed' || (item.direction === 'inbound' && !item.answered),
      )
    }
    return list // 'all'
  }

  /**
   * Xóa toàn bộ lịch sử cuộc gọi trong RAM
   */
async clearAllHistory() {
    this.localHistory = []
    window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))
    return true
  }

  /**
   * Xóa 1 bản ghi lịch sử cụ thể trong RAM
   */
async deleteItem(id) {
    const idx = this.localHistory.findIndex((item) => item.id === id)
    if (idx !== -1) {
      this.localHistory.splice(idx, 1)
      window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))
      return true
    }
    return false
  }

  /**
   * Dọn dẹp bộ nhớ in-memory khi đăng xuất (SSOT)
   */
  reset() {
    invalidateSession()
    this.localHistory = []
    this._fetchingHistoryPromise = null
    window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))
  }
}

export const historyService = new HistoryService()
