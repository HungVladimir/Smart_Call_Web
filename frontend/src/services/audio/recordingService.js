import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
} from '../auth/sessionScope.js'

import { logger } from '../common/loggerService.js'

import { recordingState } from '../../state/callState.js'

/**
 * RecordService - Module Quản lý Ghi âm Cuộc gọi Máy chủ Wazo (Pure Server-Side Recording)
 * Tuân thủ quy tắc bất biến: API Server First - Triệt tiêu Local Storage / IndexedDB nghiệp vụ (GEMINI.md)
 * - Điều khiển ghi âm trực tiếp trên tổng đài Asterisk PBX qua Wazo Calld REST API (/api/calld/1.0)
 * - Tự động liên kết file ghi âm với bản ghi CDR trong Wazo Call-Logd (/api/call-logd/1.0)
 * - Tải và phát lại âm thanh trực tiếp từ máy chủ tổng đài Wazo, đồng bộ 100% trên mọi thiết bị
 */

/** Quản lý ghi âm server và tải media; nhận dependency xác thực qua constructor. */
export class RecordingService {
  /** Giữ AuthService và cache/timer ghi âm của instance để có thể thu hồi khi phiên kết thúc. */
  constructor({ authService }) {
    Object.assign(this, { authService })
    this._stopPromise = null
    this._durationTimer = null
    this._recordingEpoch = 0
    this._blobUrls = new Map() // cache URL ObjectURL trong phiên duyệt hiện tại (cdrId_recUuid -> objectUrl)
  }

  /** Cho biết ghi âm trên tổng đài đang hoạt động; không đồng nghĩa đang phát lại một file audio. */
  isRecording() {
    return recordingState.isRecording
  }

  /** Dùng cùng host với AuthService; tùy chọn chỉ dành cho endpoint media đã được xác định. */
  getHost(customHost = '') {
    const raw = customHost || this.authService.getHostUrl()
    const value = String(raw).trim().replace(new RegExp('/+$'), '')
    return value.startsWith('http') ? value : 'https://' + value
  }

  /**
   * Tra Calld để tìm ID cuộc gọi server đang hoạt động; ID này khác SIP ID của SDK và ID tạm của
   * Web.
   */
  async getActiveServerCall() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    try {
      const token = this.authService.getToken()
      // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
      // tạo token thay thế.
      if (!token) return null
      const host = this.getHost()
      const url = `${host}/api/calld/1.0/users/me/calls`

      const res = await fetch(url, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })

      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (!res.ok) {
        logger.warn('RECORD', `Không thể lấy danh sách cuộc gọi từ calld (HTTP ${res.status})`)
        return null
      }

      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []
      if (items.length === 0) return null

      // Trả về cuộc gọi đang kết nối đầu tiên
      return items[0]
    } catch (err) {
      logger.warn('RECORD', 'Lỗi khi truy vấn cuộc gọi active từ calld:', err.message)
      return null
    }
  }

  /** Bắt đầu ghi âm trên cuộc gọi server, chỉ đổi state sau ACK và thu hồi kết quả nếu đã bị hủy. */
  async startRecording(callId = null, meta = {}) {
    if (recordingState.isStarting || recordingState.isStopping)
      throw new Error('Thao tác ghi âm đang được xử lý.')
    const recordingEpoch = this._recordingEpoch
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (recordingState.isRecording) {
      logger.warn('RECORD', 'Đang có một tiến trình ghi âm máy chủ hoạt động.')
      return false
    }

    const token = this.authService.getToken()
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) {
      throw new Error('Chưa đăng nhập tổng đài (Thiếu token)')
    }

    recordingState.isStarting = true
    recordingState.error = ''
    const host = this.getHost()
    let serverCallId = callId

    try {
      // Nếu chưa có server call_id (hoặc callId là mã tạm client), truy vấn từ Wazo Calld
      if (
        !serverCallId ||
        String(serverCallId).startsWith('rec-') ||
        String(serverCallId).startsWith('call-')
      ) {
        const activeCall = await this.getActiveServerCall()
        serverCallId = activeCall?.id || activeCall?.call_id || null
      }

      if (!serverCallId) {
        logger.warn('RECORD', 'Không tìm thấy cuộc gọi đang đàm thoại trên máy chủ để ghi âm.')
        throw new Error('Không tìm thấy cuộc gọi đang kết nối trên tổng đài Wazo.')
      }

      assertSessionContext(sessionContext)
      if (recordingEpoch !== this._recordingEpoch) return false
      logger.info('RECORD', `Gửi yêu cầu Bắt đầu ghi âm tới máy chủ Wazo Calld: ${serverCallId}`)

      // 1. Thử endpoint theo ngữ cảnh user: /users/me/calls/{call_id}/record/start
      let res = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/start`, {
        method: 'PUT',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })

      // 2. Nếu trả về 404, thử endpoint trực tiếp: /calls/{call_id}/record/start
      if (!res.ok && res.status === 404) {
        res = await fetch(`${host}/api/calld/1.0/calls/${serverCallId}/record/start`, {
          method: 'PUT',
          headers: {
            'X-Auth-Token': token,
            Accept: 'application/json',
          },
        })
      }

      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (!res.ok && res.status !== 204) {
        let errDetail = ''
        try {
          const errJson = await res.json()
          errDetail = errJson.message || JSON.stringify(errJson)
        } catch (e) {
          errDetail = await res.text().catch(() => '')
        }

        if (res.status === 403) {
          throw new Error(
            'Tài khoản chưa được cấp quyền ghi âm trên máy chủ (ACL calld.calls.record)',
          )
        }
        throw new Error(`Tổng đài từ chối lệnh ghi âm (HTTP ${res.status}): ${errDetail}`)
      }

      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (recordingEpoch !== this._recordingEpoch || !isSessionContextCurrent(sessionContext)) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(sessionContext)) {
          const stopped = await fetch(
            `${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/stop`,
            {
              method: 'PUT',
              headers: { 'X-Auth-Token': token },
              signal: AbortSignal.timeout(5000),
            },
          )
          if (!stopped.ok) throw new Error('Chưa xác nhận dừng yêu cầu ghi âm đã hủy.')
        }
        return false
      }
      // Kích hoạt trạng thái ghi âm máy chủ thành công
      recordingState.isRecording = true
      recordingState.duration = 0
      recordingState.currentCallId = serverCallId
      recordingState.meta = { ...meta, startTime: Date.now() }

      if (this._durationTimer) clearInterval(this._durationTimer)
      this._durationTimer = setInterval(() => {
        recordingState.duration += 1
      }, 1000)

      logger.success(
        'RECORD',
        `🟢 Tổng đài Wazo đã kích hoạt ghi âm cuộc gọi trên máy chủ (Server Recording): ${serverCallId}`,
      )
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('smartcall-recording-started', {
            detail: { serverCallId, meta },
          }),
        )
      }
      return true
    } catch (err) {
      logger.error('RECORD', 'Lỗi khi kích hoạt ghi âm trên máy chủ Wazo:', err.message)
      throw err
    } finally {
      if (recordingEpoch === this._recordingEpoch) recordingState.isStarting = false
    }
  }

  /**
   * Tăng thế hệ ghi âm để lệnh start còn chờ không được bật lại trạng thái sau khi cuộc gọi đã kết
   * thúc.
   */
  cancelPendingStart() {
    this._recordingEpoch += 1
    recordingState.isStarting = false
  }

  /** Gộp thao tác dừng đang chờ, gửi lệnh stop và giữ state cho phép thử lại nếu API chưa xác nhận. */
  stopRecording(callId = null) {
    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this._stopPromise) return this._stopPromise
    if (!recordingState.isRecording) return Promise.resolve(null)
    const context = captureSessionContext()
    const fetch = createSessionFetch(context)
    const serverCallId = callId || recordingState.currentCallId
    const duration = recordingState.duration
    const token = this.authService.getToken()
    const host = this.getHost()
    if (!serverCallId || !token) {
      recordingState.error = 'Không có phiên/cuộc gọi để dừng ghi âm.'
      return Promise.reject(new Error(recordingState.error))
    }
    recordingState.isStopping = true
    recordingState.error = ''
    const promise = (async () => {
      try {
        let res = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/stop`, {
          method: 'PUT',
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        })
        if (res.status === 404)
          res = await fetch(`${host}/api/calld/1.0/calls/${serverCallId}/record/stop`, {
            method: 'PUT',
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          })
        // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
        // thành công giả.
        if (!res.ok) throw new Error(`Tổng đài chưa xác nhận dừng ghi âm (HTTP ${res.status}).`)
        assertSessionContext(context)
        clearInterval(this._durationTimer)
        this._durationTimer = null
        recordingState.isRecording = false
        recordingState.currentCallId = null
        recordingState.duration = 0
        recordingState.meta = null
        window.dispatchEvent(
          new CustomEvent('smartcall-recording-stopped', { detail: { serverCallId, duration } }),
        )
        return { serverCallId, duration }
      } catch (err) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(context)) recordingState.error = err.message
        throw err
      } finally {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(context)) recordingState.isStopping = false
        // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session
        // song song.
        if (this._stopPromise === promise) this._stopPromise = null
      }
    })()
    this._stopPromise = promise
    return promise
  }

  /** Chọn bản ghi của CDR và lấy URL audio phù hợp để player phát. */
  async getAudioUrlForCall(call, { wazoHost = '', token = '' } = {}) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (!call) return null

    const cdrId = call.id
    const recordingUuid = call.recordings?.[0]?.uuid || call.recordingUuid
    if (!cdrId || !recordingUuid) {
      return null
    }

    const cacheKey = `${sessionContext.userUuid}_${this.getHost(wazoHost)}_${cdrId}_${recordingUuid}`
    if (this._blobUrls.has(cacheKey)) {
      return this._blobUrls.get(cacheKey)
    }

    const host = this.getHost(wazoHost)
    const authToken = token || this.authService.getToken()
    if (!authToken) return null

    const url = `${host}/api/call-logd/1.0/users/me/cdr/${cdrId}/recordings/${recordingUuid}/media`
    logger.info('RECORD', `Tải stream file ghi âm từ máy chủ tổng đài: CDR ${cdrId}`)

    try {
      const res = await fetch(url, {
        headers: {
          'X-Auth-Token': authToken,
          Accept: '*/*',
        },
      })

      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (!res.ok) {
        logger.warn('RECORD', `Máy chủ Wazo trả về HTTP ${res.status} cho file ghi âm CDR ${cdrId}`)
        return null
      }

      const blob = await res.blob()
      if (blob.size === 0) {
        logger.warn('RECORD', 'File ghi âm trả về từ máy chủ rỗng (0 bytes)')
        return null
      }

      const objectUrl = URL.createObjectURL(blob)
      this._blobUrls.set(cacheKey, objectUrl)
      return objectUrl
    } catch (err) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(sessionContext)) return null
      logger.error('RECORD', `Lỗi tải file ghi âm từ máy chủ Wazo (CDR ${cdrId}):`, err.message)
      return null
    }
  }

  /** Chọn bản ghi của cuộc gọi rồi ủy quyền tải file qua luồng ghi âm dùng chung. */
  async downloadRecordingForCall(call, filename = null) {
    const sessionContext = captureSessionContext()
    if (!call) throw new Error('Không có thông tin cuộc gọi')

    const audioUrl = await this.getAudioUrlForCall(call)
    assertSessionContext(sessionContext)
    if (!audioUrl) {
      throw new Error('Không tìm thấy file ghi âm trên máy chủ tổng đài Wazo')
    }

    const extension = call.extension || 'call'
    const dateFormatted = call.date ? String(call.date).replace(/[: ]/g, '-') : Date.now()
    const defaultFilename = `recording_${extension}_${dateFormatted}.wav`
    const finalFilename = filename || defaultFilename

    if (typeof document !== 'undefined') {
      const a = document.createElement('a')
      a.href = audioUrl
      a.download = finalFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  /**
   * Thu hồi ObjectURL, timer và state ghi âm khi phiên kết thúc để tài nguyên không lẫn giữa tài
   * khoản.
   */
  clearSessionCache() {
    this.cancelPendingStart()
    this._stopPromise = null
    recordingState.isStopping = false
    recordingState.error = ''
    this._blobUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch (e) {}
    })
    this._blobUrls.clear()
    recordingState.isRecording = false
    recordingState.duration = 0
    recordingState.currentCallId = null
    recordingState.meta = null
    if (this._durationTimer) {
      clearInterval(this._durationTimer)
      this._durationTimer = null
    }
  }
}
