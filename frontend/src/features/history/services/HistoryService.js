import { mapCallHistoryRecord } from '../mappers/callHistoryMapper.js'
import {
  captureSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../../../core/session/sessionScope.js'

import { logger } from '../../../core/logging/LoggerService.js'

/** Nạp lịch sử từ máy chủ và giữ các bản ghi vừa kết thúc tạm thời trong RAM. */
export class HistoryService {
  constructor({ authService }) {
    Object.assign(this, { authService })
    this.localHistory = []
    this._fetchingHistoryPromise = null
    this.historyGeneration = 0
  }

  async reload() {
    this.localHistory = []
    this._fetchingHistoryPromise = null
    return await this.getHistory({ forceRefresh: true })
  }

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

  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  getLocalHistory({ tab = 'all' } = {}) {
    if (!this.localHistory) {
      this.localHistory = []
    }
    return this._filterList(this.localHistory, tab)
  }

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

    const requestGeneration = ++this.historyGeneration
    this._fetchingHistoryPromise = (async () => {
      try {
        const token = this.authService.getToken()
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

        if (!res.ok) throw new Error(`HTTP error ${res.status}`)

        const data = await res.json()
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
        if (
          forceRefresh &&
          isSessionContextCurrent(sessionContext) &&
          requestGeneration === this.historyGeneration
        ) {
          this.localHistory = []
        }
        return this.localHistory || []
      } finally {
        if (isSessionContextCurrent(sessionContext) && requestGeneration === this.historyGeneration)
          this._fetchingHistoryPromise = null
      }
    })()

    const list = await this._fetchingHistoryPromise
    return this._filterList(list, tab)
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

  reset() {
    this.historyGeneration += 1
    this.localHistory = []
    this._fetchingHistoryPromise = null
    window.dispatchEvent(new CustomEvent('smartcall-cdr-updated'))
  }
}
