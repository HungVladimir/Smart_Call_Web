import { mapCallHistoryRecord } from '../../utils/callHistoryMapper.js'
import { userSessionState } from '../../state/sessionState.js'
import {
  captureSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../auth/sessionScope.js'
import { logger } from '../common/loggerService.js'

/** Thêm số 0 ở đầu để các phần ngày/giờ hiển thị đủ hai chữ số. */
function padTwoDigits(value) {
  return String(value).padStart(2, '0')
}

/** Định dạng thời điểm cuộc gọi tạm thành chuỗi yyyy-MM-dd HH:mm:ss theo giờ máy khách. */
function formatLocalTimestamp(date) {
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())} ${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}:${padTwoDigits(date.getSeconds())}`
}

/** Kiểm tra bản ghi có phải cuộc gọi đến để lọc tab danh sách lịch sử. */
function isInboundRecord(record) {
  return record.direction === 'inbound'
}

/** Kiểm tra bản ghi có phải cuộc gọi đi để lọc tab danh sách lịch sử. */
function isOutboundRecord(record) {
  return record.direction === 'outbound'
}

/** Kiểm tra bản ghi có phải cuộc gọi nhỡ (trạng thái missed hoặc gọi đến chưa bắt máy). */
function isMissedRecord(record) {
  return record.status === 'missed' || (record.direction === 'inbound' && !record.answered)
}

/** So sánh hai bản ghi CDR theo thời gian giảm dần để bản ghi mới nhất hiển thị đầu tiên. */
function compareRecordsByDateDesc(firstRecord, secondRecord) {
  return new Date(secondRecord.date || 0) - new Date(firstRecord.date || 0)
}

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
    const dateStr = formatLocalTimestamp(new Date())
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
    return `${padTwoDigits(mins)}:${padTwoDigits(secs)}`
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
    this._fetchingHistoryPromise = this._fetchAndMergeHistory({
      limit,
      forceRefresh,
      sessionContext,
      requestGeneration,
      fetch,
    })

    const list = await this._fetchingHistoryPromise
    return this._filterList(list, tab)
  }

  /**
   * Gọi Wazo Call-Logd lấy danh sách CDR, chuẩn hóa và hợp nhất bản ghi RAM tạm thời; chỉ cập nhật
   * cache khi request vẫn thuộc đúng phiên và thế hệ mới nhất.
   */
  async _fetchAndMergeHistory({ limit, forceRefresh, sessionContext, requestGeneration, fetch }) {
    try {
      const token = this.authService.getToken()
      // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc
      // tự tạo token thay thế.
      if (!token) throw new Error('No token available')

      const host = this.authService.getHostUrl()
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
      // Nếu phản hồi không chứa danh sách bản ghi CDR, giữ lại cache RAM hiện có thay vì xóa trắng.
      if (!data.items) return this.localHistory || []

      const myExtension = this.authService.getCurrentExtension() || userSessionState.extension || ''
      const mapped = this._mapServerCdrItems(data.items, myExtension)
      const merged = this._mergeWithLocalHistory(mapped)
      this.localHistory = merged
      return merged
    } catch (error) {
      logger.warn('API', 'Không thể nạp CDR từ Wazo call-logd:', error.message)
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
      if (isSessionContextCurrent(sessionContext) && requestGeneration === this.historyGeneration) {
        this._fetchingHistoryPromise = null
      }
    }
  }

  /** Chuẩn hóa từng bản ghi CDR thô từ Wazo Call-Logd theo máy lẻ của người dùng hiện tại. */
  _mapServerCdrItems(items, myExtension) {
    /** Chuyển một phần tử CDR từ API sang cấu trúc hiển thị chuẩn của SmartCall Web. */
    const mapRecord = (cdrRecord, index) => mapCallHistoryRecord(cdrRecord, { myExtension, index })
    return items.map(mapRecord)
  }

  /**
   * Ghép các bản ghi vừa kết thúc còn giữ trong RAM nếu server Call-Logd chưa kịp đồng bộ, rồi
   * sắp xếp theo thời gian mới nhất lên đầu.
   */
  _mergeWithLocalHistory(mappedRecords) {
    const merged = [...mappedRecords]
    if (Array.isArray(this.localHistory)) {
      for (const localRecord of this.localHistory) {
        /** Kiểm tra bản ghi server có trùng ID hoặc cùng số máy lẻ trong cửa sổ 2 phút với bản ghi RAM. */
        const matchesLocalRecord = (serverRecord) =>
          serverRecord.id === localRecord.id ||
          (serverRecord.extension === localRecord.extension &&
            Math.abs(new Date(serverRecord.date || 0) - new Date(localRecord.date || 0)) < 120000)

        if (!merged.some(matchesLocalRecord)) {
          merged.push(localRecord)
        }
      }
    }
    merged.sort(compareRecordsByDateDesc)
    return merged
  }

  /** Lọc danh sách CDR theo chiều gọi hoặc missed, dùng cùng một quy tắc cho danh sách và số đếm. */
  _filterList(list, tab) {
    if (!Array.isArray(list)) return []
    if (tab === 'inbound' || tab === 'incomings') {
      return list.filter(isInboundRecord)
    }
    if (tab === 'outbound' || tab === 'outgoings') {
      return list.filter(isOutboundRecord)
    }
    if (tab === 'missed') {
      return list.filter(isMissedRecord)
    }
    return list
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
