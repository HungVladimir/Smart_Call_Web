import { captureSessionContext, assertSessionContext, isSessionContextCurrent, createSessionFetch } from './sessionScope'
/**
 * RecordService - Module Quản lý Ghi âm Cuộc gọi Máy chủ Wazo (Pure Server-Side Recording)
 * Tuân thủ quy tắc bất biến: API Server First - Triệt tiêu Local Storage / IndexedDB nghiệp vụ (GEMINI.md)
 * - Điều khiển ghi âm trực tiếp trên tổng đài Asterisk PBX qua Wazo Calld REST API (/api/calld/1.0)
 * - Tự động liên kết file ghi âm với bản ghi CDR trong Wazo Call-Logd (/api/call-logd/1.0)
 * - Tải và phát lại âm thanh trực tiếp từ máy chủ tổng đài Wazo, đồng bộ 100% trên mọi thiết bị
 */

import { reactive } from 'vue'
import { logger } from './loggerService'
import { wazoService } from './wazo'

export const recordStore = reactive({
  isRecording: false,
  isStarting: false,
  isStopping: false,
  error: '',
  duration: 0,
  currentCallId: null, // ID cuộc gọi trên máy chủ Wazo Calld
  meta: null,
})

class RecordService {
  constructor() {
    this._stopPromise = null
    this._durationTimer = null
    this._recordingEpoch = 0
    this._blobUrls = new Map() // cache URL ObjectURL trong phiên duyệt hiện tại (cdrId_recUuid -> objectUrl)
  }

  isRecording() {
    return recordStore.isRecording
  }

  getRecordingDuration() {
    return recordStore.duration
  }

  // Lấy Token xác thực Wazo từ phiên làm việc
  getToken() {
    if (typeof window === 'undefined') return ''
    return wazoService.getToken()
  }

  // Lấy địa chỉ máy chủ Wazo chuẩn hóa
  getHost(customHost = '') {
    const raw = customHost || wazoService.getHostUrl()
    const clean = String(raw).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    return `https://${clean}`
  }

  /**
   * Lấy danh sách cuộc gọi đang kết nối của user trên máy chủ Wazo Calld
   * GET /api/calld/1.0/users/me/calls
   */
  async getActiveServerCall() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    try {
      const token = this.getToken()
      if (!token) return null
      const host = this.getHost()
      const url = `${host}/api/calld/1.0/users/me/calls`

      const res = await fetch(url, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })

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

  /**
   * Bắt đầu ghi âm cuộc gọi trên máy chủ tổng đài Wazo
   * PUT /api/calld/1.0/users/me/calls/{call_id}/record/start
   * @param {string|null} callId - ID cuộc gọi trên server (nếu đã biết)
   * @param {object} meta - Thông tin người đàm thoại
   */
  async startRecording(callId = null, meta = {}) {
    if (recordStore.isStarting || recordStore.isStopping) throw new Error('Thao tác ghi âm đang được xử lý.')
    const recordingEpoch = this._recordingEpoch
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (recordStore.isRecording) {
      logger.warn('RECORD', 'Đang có một tiến trình ghi âm máy chủ hoạt động.')
      return false
    }

    const token = this.getToken()
    if (!token) {
      throw new Error('Chưa đăng nhập tổng đài (Thiếu token)')
    }

    recordStore.isStarting = true
    recordStore.error = ''
    const host = this.getHost()
    let serverCallId = callId

    try {
      // Nếu chưa có server call_id (hoặc callId là mã tạm client), truy vấn từ Wazo Calld
      if (!serverCallId || String(serverCallId).startsWith('rec-') || String(serverCallId).startsWith('call-')) {
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

      if (!res.ok && res.status !== 204) {
        let errDetail = ''
        try {
          const errJson = await res.json()
          errDetail = errJson.message || JSON.stringify(errJson)
        } catch (e) {
          errDetail = await res.text().catch(() => '')
        }

        if (res.status === 403) {
          throw new Error('Tài khoản chưa được cấp quyền ghi âm trên máy chủ (ACL calld.calls.record)')
        }
        throw new Error(`Tổng đài từ chối lệnh ghi âm (HTTP ${res.status}): ${errDetail}`)
      }

      if (recordingEpoch !== this._recordingEpoch || !isSessionContextCurrent(sessionContext)) {
        if (isSessionContextCurrent(sessionContext)) {
          const stopped = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/stop`, { method: 'PUT', headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(5000) })
          if (!stopped.ok) throw new Error('Chưa xác nhận dừng yêu cầu ghi âm đã hủy.')
        }
        return false
      }
      // Kích hoạt trạng thái ghi âm máy chủ thành công
      recordStore.isRecording = true
      recordStore.duration = 0
      recordStore.currentCallId = serverCallId
      recordStore.meta = { ...meta, startTime: Date.now() }

      if (this._durationTimer) clearInterval(this._durationTimer)
      this._durationTimer = setInterval(() => {
        recordStore.duration += 1
      }, 1000)

      logger.success('RECORD', `🟢 Tổng đài Wazo đã kích hoạt ghi âm cuộc gọi trên máy chủ (Server Recording): ${serverCallId}`)
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
      if (recordingEpoch === this._recordingEpoch) recordStore.isStarting = false
    }
  }

  cancelPendingStart() {
    this._recordingEpoch += 1
    recordStore.isStarting = false
  }

  /**
   * Dừng ghi âm cuộc gọi trên máy chủ tổng đài Wazo
   * PUT /api/calld/1.0/users/me/calls/{call_id}/record/stop
   */
  stopRecording(callId = null) {
    if (this._stopPromise) return this._stopPromise
    if (!recordStore.isRecording) return Promise.resolve(null)
    const context = captureSessionContext()
    const fetch = createSessionFetch(context)
    const serverCallId = callId || recordStore.currentCallId
    const duration = recordStore.duration
    const token = this.getToken()
    const host = this.getHost()
    if (!serverCallId || !token) {
      recordStore.error = 'Không có phiên/cuộc gọi để dừng ghi âm.'
      return Promise.reject(new Error(recordStore.error))
    }
    recordStore.isStopping = true
    recordStore.error = ''
    const promise = (async () => {
      try {
        let res = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/stop`, {
          method: 'PUT', headers: { 'X-Auth-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
        })
        if (res.status === 404) res = await fetch(`${host}/api/calld/1.0/calls/${serverCallId}/record/stop`, {
          method: 'PUT', headers: { 'X-Auth-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`Tổng đài chưa xác nhận dừng ghi âm (HTTP ${res.status}).`)
        assertSessionContext(context)
        clearInterval(this._durationTimer)
        this._durationTimer = null
        recordStore.isRecording = false
        recordStore.currentCallId = null
        recordStore.duration = 0
        recordStore.meta = null
        window.dispatchEvent(new CustomEvent('smartcall-recording-stopped', { detail: { serverCallId, duration } }))
        return { serverCallId, duration }
      } catch (err) {
        if (isSessionContextCurrent(context)) recordStore.error = err.message
        throw err
      } finally {
        if (isSessionContextCurrent(context)) recordStore.isStopping = false
        if (this._stopPromise === promise) this._stopPromise = null
      }
    })()
    this._stopPromise = promise
    return promise
  }

  /**
   * Tạm dừng ghi âm trên máy chủ (Pause)
   */
  async pauseRecording(callId = null) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const serverCallId = callId || recordStore.currentCallId
    if (!serverCallId) return false
    const token = this.getToken()
    const host = this.getHost()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/pause`, {
        method: 'PUT',
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      })
      return res.ok
    } catch (e) {
      return false
    }
  }

  /**
   * Tiếp tục ghi âm trên máy chủ (Resume)
   */
  async resumeRecording(callId = null) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const serverCallId = callId || recordStore.currentCallId
    if (!serverCallId) return false
    const token = this.getToken()
    const host = this.getHost()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/calls/${serverCallId}/record/resume`, {
        method: 'PUT',
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
      })
      return res.ok
    } catch (e) {
      return false
    }
  }

  /**
   * Kiểm tra xem một cuộc gọi trong CDR có file ghi âm trên máy chủ không
   */
  hasRecordingForCall(call) {
    if (!call) return false
    if (call.hasRecording) return true
    if (Array.isArray(call.recordings) && call.recordings.length > 0) return true
    if (call.recordingUuid) return true
    return false
  }

  /**
   * Lấy URL phát âm thanh trực tiếp từ máy chủ Wazo Call-Logd
   * GET /api/call-logd/1.0/users/me/cdr/{id}/recordings/{recording_uuid}/media
   */
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
    const authToken = token || this.getToken()
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
      if (!isSessionContextCurrent(sessionContext)) return null
      logger.error('RECORD', `Lỗi tải file ghi âm từ máy chủ Wazo (CDR ${cdrId}):`, err.message)
      return null
    }
  }

  // Phương thức bí danh hỗ trợ cả truyền callId hoặc call object
async getRecordingAudioUrl(callOrId, options = {}) {
    const call =
      typeof callOrId === 'string'
        ? { id: callOrId, recordingUuid: callOrId }
        : callOrId || {}
    return this.getAudioUrlForCall(call, options)
  }

  /**
   * Tải file ghi âm từ máy chủ tổng đài Wazo về máy tính người dùng
   */
async downloadRecording(callOrId, filename = null) {
    const call =
      typeof callOrId === 'string'
        ? { id: callOrId, recordingUuid: callOrId }
        : callOrId || {}
    return this.downloadRecordingForCall(call, filename)
  }

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

  // Xóa cache ObjectURL khi đăng xuất
  clearSessionCache() {
    this.cancelPendingStart()
    this._stopPromise = null
    recordStore.isStopping = false
    recordStore.error = ''
    this._blobUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch (e) {}
    })
    this._blobUrls.clear()
    recordStore.isRecording = false
    recordStore.duration = 0
    recordStore.currentCallId = null
    recordStore.meta = null
    if (this._durationTimer) {
      clearInterval(this._durationTimer)
      this._durationTimer = null
    }
  }
}

export const recordService = new RecordService()
