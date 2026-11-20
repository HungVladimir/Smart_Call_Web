import { mapCallHistoryRecord } from '../../utils/callHistoryMapper.js'
import {
  captureSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../auth/sessionScope.js'

import { logger } from '../common/loggerService.js'

/** Nạp lịch sử từ máy chủ và giữ các bản ghi vừa kết thúc tạm thời trong RAM. */
export class HistoryService {
  /** Giữ dependency và cache CDR theo thế hệ request để response cũ không ghi đè lần tải mới. */
  constructor({ authService }) {
    Object.assign(this, { authService })
    this.localHistory = []
    this._fetchingHistoryPromise = null
    this.historyGeneration = 0
  }

  /** Bỏ cache CDR hiện tại và chủ động tải lại, đánh dấu thế hệ request để kết quả cũ không ghi đè. */
  async reload() {
    this.localHistory = []
    this._fetchingHistoryPromise = null
    return await this.getHistory({ forceRefresh: true })
  }

  /**
   * Ghi tạm một cuộc gọi vừa kết thúc vào RAM trong lúc chờ CDR server xuất hiện; không lưu lịch
   * sử nghiệp vụ vào storage.
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
    /** Thêm số 0 ở đầu để các phần giờ/phút/giây có đủ hai chữ số khi hiển thị. */
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

  /** Định dạng số giây của một bản ghi thành thời lượng dễ đọc. */
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  /** Đọc cache RAM theo tab hiện tại mà không phát sinh request HTTP. */
  getLocalHistory({ tab = 'all' } = {}) {
    if (!this.localHistory) {
      this.localHistory = []
    }
    return this._filterList(this.localHistory, tab)
  }

  /**
   * Tải CDR, chuẩn hóa theo máy lẻ hiện tại và ghép bản ghi RAM; chỉ request mới nhất được cập
   * nhật cache.
   */
  async getHistory({ tab = 'all', limit = 50, forceRefresh = false } = {}) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (forceRefresh) {
      this._fetchingHistoryPromise = null
      this.localHistory = []
    }

    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this._fetchingHistoryPromise) {
      const merged = await this._fetchingHistoryPromise
      return this._filterList(merged, tab)
    }

    const requestGeneration = ++this.historyGeneration
    this._fetchingHistoryPromise = (async () => {
      try {
        const token = this.authService.getToken()
        // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc
        // tự tạo token thay thế.
        if (!token) throw new Error('No token available')

        const host = this.authService.host.startsWith('http')
          ? this.authService.host
          : `https://${this.authService.host}`

        // Gọi API Wazo Call-Logd lấy nhật ký cuộc gọi CDR
        const url = `${host}/api/call-logd/1.0/users/me/cdr?limit=${limit}&order=start&direction=desc`
        const res = await fetch(url, {
          headers: {
            'X-Auth-Token': token,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(3500),
        })

        // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
        // thành công giả.
        if (!res.ok) throw new Error(`HTTP error ${res.status}`)

        const data = await res.json()
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (requestGeneration !== this.historyGeneration) return this.localHistory || []
        if (!data.items) return this.localHistory || []

        const myExtension =
          this.authService.getCurrentExtension() ||
          localStorage.getItem('smartcall_extension') ||
          ''

        // Map trường dữ liệu từ Wazo CDR sang cấu trúc hiển thị của SmartCall Web
        const mapped = data.items.map((cdr, index) =>
          mapCallHistoryRecord(cdr, { myExtension, index }),
        )

        // Hợp nhất dữ liệu: bổ sung các cuộc gọi vừa kết thúc còn lưu trong RAM chưa kịp lên CDR
        // server
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
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (
          forceRefresh &&
          isSessionContextCurrent(sessionContext) &&
          requestGeneration === this.historyGeneration
        ) {
          this.localHistory = []
        }
        return this.localHistory || []
      } finally {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(sessionContext) && requestGeneration === this.historyGeneration)
          this._fetchingHistoryPromise = null
      }
    })()

    const list = await this._fetchingHistoryPromise
    return this._filterList(list, tab)
  }

  /** Lọc danh sách CDR theo chiều gọi hoặc missed, dùng cùng một quy tắc cho danh sách và số đếm. */
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
   * Tăng thế hệ request và xóa cache lịch sử RAM khi phiên kết thúc để response cũ không khôi phục
   * dữ liệu.
   */
  reset() {
    this.historyGeneration += 1
    this.localHistory = []
    this._fetchingHistoryPromise = null
    window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))
  }
}
