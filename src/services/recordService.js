/**
 * RecordService - Module Quản lý Ghi âm Cuộc gọi Thoại (Dual Client & Server Engine)
 * - Web Audio API (AudioContext) gộp 2 luồng âm thanh: Microphone cục bộ + Âm thanh đối phương
 * - MediaRecorder xuất file âm thanh chuẩn audio/webm (Opus)
 * - Lưu trữ bền vững vào IndexedDB (không giới hạn 5MB như localStorage)
 * - Hỗ trợ phát lại trực tiếp trên trình duyệt và tải file ghi âm về máy
 */

import { reactive } from 'vue'
import { logger } from './loggerService'

export const recordStore = reactive({
  isRecording: false,
  duration: 0,
  currentCallId: null,
  meta: null,
})

const DB_NAME = 'smartcall_recordings_db'
const DB_VERSION = 1
const STORE_NAME = 'recordings'

class RecordService {
  constructor() {
    this._db = null
    this._mediaRecorder = null
    this._recordedChunks = []
    this._audioCtx = null
    this._micStream = null
    this._destination = null
    this._stopPromise = null
    this._durationTimer = null
    this._blobUrls = new Map() // callId -> objectUrl
    this._memoryFallback = new Map() // callId -> record (nếu IndexedDB bị chặn)
    this._initDB()
  }

  // Khởi tạo cơ sở dữ liệu IndexedDB
  async _initDB() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null
    }
    if (this._db) return this._db

    return new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = (e) => {
          const db = e.target.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'callId' })
            store.createIndex('date', 'date', { unique: false })
            store.createIndex('extension', 'extension', { unique: false })
            store.createIndex('timestamp', 'timestamp', { unique: false })
          }
        }
        req.onsuccess = (e) => {
          this._db = e.target.result
          resolve(this._db)
        }
        req.onerror = (e) => {
          logger.warn('RECORD', 'IndexedDB không thể mở, sử dụng Memory Fallback:', e)
          resolve(null)
        }
      } catch (err) {
        logger.warn('RECORD', 'Lỗi khởi tạo IndexedDB:', err)
        resolve(null)
      }
    })
  }

  isRecording() {
    return recordStore.isRecording
  }

  getRecordingDuration() {
    return recordStore.duration
  }

  /**
   * Bắt đầu ghi âm cuộc gọi
   * @param {string} callId - Mã định danh cuộc gọi
   * @param {object} meta - Thông tin người đàm thoại { number, name, dept, direction }
   */
  async startRecording(callId, meta = {}) {
    if (recordStore.isRecording) {
      logger.warn('RECORD', 'Đang có một tiến trình ghi âm hoạt động.')
      return false
    }

    const recCallId = callId || `rec-${Date.now()}`
    logger.info('RECORD', `Bắt đầu ghi âm cuộc gọi: ${recCallId}`, meta)

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext
      if (!AudioCtxClass) {
        throw new Error('Trình duyệt không hỗ trợ Web Audio API')
      }
      this._audioCtx = new AudioCtxClass()
      if (this._audioCtx.state === 'suspended') {
        await this._audioCtx.resume()
      }

      this._destination = this._audioCtx.createMediaStreamDestination()

      // 1. Luồng âm thanh Micro của người dùng (ưu tiên local stream từ WebRTC session nếu có)
      try {
        let localStream = null
        if (meta.session) {
          try {
            const wazoPhone = typeof window !== 'undefined' ? window.Wazo?.Phone : null
            if (wazoPhone?.getLocalStream) {
              localStream = wazoPhone.getLocalStream(meta.session)
            }
            if (!localStream && meta.session.localStream) {
              localStream = meta.session.localStream
            }
          } catch (e) {}
        }

        if (localStream && localStream.getAudioTracks && localStream.getAudioTracks().length > 0) {
          const micSource = this._audioCtx.createMediaStreamSource(localStream)
          micSource.connect(this._destination)
          logger.info('RECORD', 'Đã gắn luồng Micro trực tiếp từ phiên WebRTC Call.')
        } else {
          const selectedMic = localStorage.getItem('smartcall_selected_mic') || 'default'
          const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
          if (selectedMic && selectedMic !== 'default') {
            audioConstraints.deviceId = { exact: selectedMic }
          }

          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            this._micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
            const micSource = this._audioCtx.createMediaStreamSource(this._micStream)
            micSource.connect(this._destination)
            logger.info('RECORD', 'Đã gắn luồng Micro từ thiết bị người dùng qua getUserMedia.')
          }
        }
      } catch (micErr) {
        logger.warn('RECORD', 'Không thể bắt luồng Microphone cục bộ (vẫn tiếp tục thu âm đối phương):', micErr.message)
      }

      // 2. Luồng âm thanh đối phương từ thẻ <audio id="wazo-remote-audio"> hoặc Wazo Phone
      let remoteStream = null
      const remoteAudioEl = document.getElementById('wazo-remote-audio')
      if (remoteAudioEl && remoteAudioEl.srcObject) {
        remoteStream = remoteAudioEl.srcObject
      } else if (meta.session) {
        try {
          const wazoPhone = typeof window !== 'undefined' ? window.Wazo?.Phone : null
          if (wazoPhone?.getRemoteStream) {
            remoteStream = wazoPhone.getRemoteStream(meta.session)
          }
        } catch (e) {}
      }

      if (!remoteStream) {
        const audios = document.querySelectorAll('audio')
        for (const a of audios) {
          if (a.srcObject && a.srcObject.getAudioTracks && a.srcObject.getAudioTracks().length > 0) {
            remoteStream = a.srcObject
            break
          }
        }
      }

      if (remoteStream) {
        try {
          const remoteSource = this._audioCtx.createMediaStreamSource(remoteStream)
          remoteSource.connect(this._destination)
          logger.info('RECORD', 'Đã gắn luồng âm thanh đàm thoại từ xa vào tiến trình ghi âm.')
        } catch (remErr) {
          logger.warn('RECORD', 'Không thể gắn remote audio vào AudioContext:', remErr.message)
        }
      }

      // 3. Fallback: Nếu stream rỗng, gắn silent track để MediaRecorder không bị lỗi empty stream
      if (this._destination.stream.getAudioTracks().length === 0) {
        const osc = this._audioCtx.createOscillator()
        const gain = this._audioCtx.createGain()
        gain.gain.value = 0
        osc.connect(gain)
        gain.connect(this._destination)
        osc.start()
      }

      // 4. Khởi tạo MediaRecorder
      let mimeType = 'audio/webm;codecs=opus'
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/ogg')
            ? 'audio/ogg'
            : ''
        }
      }

      this._recordedChunks = []
      const options = mimeType ? { mimeType } : {}
      this._mediaRecorder = new MediaRecorder(this._destination.stream, options)

      this._mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this._recordedChunks.push(e.data)
        }
      }

      this._mediaRecorder.start(1000)

      recordStore.isRecording = true
      recordStore.duration = 0
      recordStore.currentCallId = recCallId
      recordStore.meta = { ...meta, startTime: Date.now() }

      // Bật đồng hồ đếm thời gian ghi âm
      if (this._durationTimer) clearInterval(this._durationTimer)
      this._durationTimer = setInterval(() => {
        recordStore.duration += 1
      }, 1000)

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('smartcall-recording-started', {
            detail: { callId: recCallId, meta },
          }),
        )
      }
      return true
    } catch (err) {
      logger.error('RECORD', 'Không thể khởi động ghi âm:', err)
      this._cleanupResources()
      return false
    }
  }

  /**
   * Dừng ghi âm cuộc gọi và lưu trữ vào IndexedDB (Hỗ trợ lock chống xung đột đồng thời)
   */
  stopRecording() {
    if (this._stopPromise) {
      return this._stopPromise
    }

    if (!recordStore.isRecording && !this._mediaRecorder) {
      return Promise.resolve(null)
    }

    logger.info('RECORD', 'Dừng tiến trình ghi âm cuộc gọi...')

    if (this._durationTimer) {
      clearInterval(this._durationTimer)
      this._durationTimer = null
    }

    const callId = recordStore.currentCallId || `rec-${Date.now()}`
    const duration = recordStore.duration || 0
    const meta = recordStore.meta || {}

    // Giải phóng trạng thái ghi âm ngay lập tức để tránh UI giật hoặc xung đột cuộc gọi tiếp theo
    recordStore.isRecording = false
    recordStore.duration = 0
    recordStore.currentCallId = null
    recordStore.meta = null

    this._stopPromise = new Promise((resolve) => {
      const finalizeSave = async () => {
        try {
          const mimeType = this._mediaRecorder?.mimeType || 'audio/webm'
          const blob = new Blob(this._recordedChunks, { type: mimeType })
          this._cleanupResources()

          const now = new Date()
          const pad = (n) => String(n).padStart(2, '0')
          const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

          const record = {
            callId,
            date: dateStr,
            timestamp: Date.now(),
            name: meta.name || '',
            extension: String(meta.extension || meta.number || ''),
            dept: meta.dept || '',
            direction: meta.direction || 'outbound',
            duration: Math.max(1, duration),
            blob,
            mimeType,
            size: blob.size,
            source: 'client',
          }

          let objectUrl = null
          if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            try {
              objectUrl = URL.createObjectURL(blob)
              this._blobUrls.set(callId, objectUrl)
            } catch (e) {}
          }

          // Lưu vào IndexedDB (hoặc Memory Fallback)
          await this._saveRecord(record)

          logger.success('RECORD', `Đã lưu bản ghi âm cuộc gọi (${duration}s, ${(blob.size / 1024).toFixed(1)} KB): ${callId}`)
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('smartcall-recording-saved', {
                detail: { callId, record },
              }),
            )
          }
          resolve(record)
        } catch (err) {
          logger.error('RECORD', 'Lỗi khi hoàn tất lưu bản ghi âm:', err)
          this._cleanupResources()
          resolve(null)
        }
      }

      if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
        this._mediaRecorder.onstop = finalizeSave
        try {
          this._mediaRecorder.stop()
        } catch (e) {
          finalizeSave()
        }
      } else {
        finalizeSave()
      }
    }).finally(() => {
      this._stopPromise = null
    })

    return this._stopPromise
  }

  _cleanupResources() {
    if (this._micStream) {
      try {
        this._micStream.getTracks().forEach((t) => t.stop())
      } catch (e) {}
      this._micStream = null
    }
    if (this._destination?.stream) {
      try {
        this._destination.stream.getTracks().forEach((t) => t.stop())
      } catch (e) {}
      this._destination = null
    }
    if (this._audioCtx) {
      try {
        this._audioCtx.close()
      } catch (e) {}
      this._audioCtx = null
    }
    this._recordedChunks = []
    this._mediaRecorder = null
  }

  // Lưu bản ghi vào IndexedDB
  async _saveRecord(record) {
    const db = await this._initDB()
    if (!db) {
      this._memoryFallback.set(record.callId, record)
      return
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.put(record)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => {
          this._memoryFallback.set(record.callId, record)
          resolve(false)
        }
      } catch (err) {
        this._memoryFallback.set(record.callId, record)
        resolve(false)
      }
    })
  }

  /**
   * Lấy bản ghi âm theo callId
   */
  async getRecording(callId) {
    if (!callId) return null
    if (this._memoryFallback.has(callId)) {
      return this._memoryFallback.get(callId)
    }

    const db = await this._initDB()
    if (!db) return null

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.get(callId)
        req.onsuccess = (e) => resolve(e.target.result || null)
        req.onerror = () => resolve(null)
      } catch (e) {
        resolve(null)
      }
    })
  }

  /**
   * Lấy danh sách tất cả các bản ghi âm
   */
  async getAllRecordings() {
    const db = await this._initDB()
    if (!db) {
      return Array.from(this._memoryFallback.values())
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.getAll()
        req.onsuccess = (e) => {
          const dbList = e.target.result || []
          const memList = Array.from(this._memoryFallback.values())
          const merged = [...dbList]
          memList.forEach((m) => {
            if (!merged.some((r) => r.callId === m.callId)) {
              merged.push(m)
            }
          })
          resolve(merged)
        }
        req.onerror = () => resolve(Array.from(this._memoryFallback.values()))
      } catch (e) {
        resolve(Array.from(this._memoryFallback.values()))
      }
    })
  }

  /**
   * Kiểm tra xem một cuộc gọi trong lịch sử có file ghi âm không
   */
  async hasRecordingForCall(call) {
    if (!call) return false
    if (call.hasRecording) return true
    if (call.recordings && call.recordings.length > 0) return true
    if (call.recordingId && (this._blobUrls.has(call.recordingId) || this._memoryFallback.has(call.recordingId))) {
      return true
    }
    if (call.callId && (this._blobUrls.has(call.callId) || this._memoryFallback.has(call.callId))) {
      return true
    }

    // Kiểm tra trong DB
    const recId = call.recordingId || call.callId || call.id
    if (recId) {
      const rec = await this.getRecording(recId)
      if (rec) return true
    }
    return false
  }

  /**
   * Lấy URL phát âm thanh cho cuộc gọi (Hỗ trợ cả callId dạng chuỗi hoặc call object)
   * @param {string|object} callOrId - ID cuộc gọi hoặc đối tượng cuộc gọi
   * @param {object} options - Tùy chọn máy chủ và token
   */
  async getRecordingAudioUrl(callOrId, options = {}) {
    const call =
      typeof callOrId === 'string'
        ? { recordingId: callOrId, callId: callOrId, id: callOrId }
        : callOrId || {}
    return this.getAudioUrlForCall(call, options)
  }

  /**
   * Tải file ghi âm về máy tính người dùng (.webm) (Hỗ trợ cả callId dạng chuỗi hoặc call object)
   * @param {string|object} callOrId - ID cuộc gọi hoặc đối tượng cuộc gọi
   * @param {string} filename - Tên file tùy chỉnh
   */
  async downloadRecording(callOrId, filename = null) {
    const call =
      typeof callOrId === 'string'
        ? { recordingId: callOrId, callId: callOrId, id: callOrId }
        : callOrId || {}
    return this.downloadRecordingForCall(call, filename)
  }

  /**
   * Lấy URL phát âm thanh cho cuộc gọi (Hỗ trợ cả Client Recording và Wazo Call-Logd Server)
   */
  async getAudioUrlForCall(call, { wazoHost = '', token = '' } = {}) {
    if (!call) return null

    const recId = call.recordingId || call.callId || call.id
    // 1. Kiểm tra cache URL đã có sẵn
    if (recId && this._blobUrls.has(recId)) {
      return this._blobUrls.get(recId)
    }

    // 2. Tìm trong IndexedDB
    if (recId) {
      const localRec = await this.getRecording(recId)
      if (localRec && localRec.blob) {
        const url = URL.createObjectURL(localRec.blob)
        this._blobUrls.set(recId, url)
        if (call.id && call.id !== recId) {
          this._blobUrls.set(call.id, url)
        }
        return url
      }
    }

    // 3. Tìm theo ngày và số máy lẻ nếu recId chưa trỏ đúng
    if (call.extension && call.date) {
      const all = await this.getAllRecordings()
      const matched = all.find(
        (r) =>
          r.extension === String(call.extension) &&
          Math.abs(new Date(r.date || 0) - new Date(call.date || 0)) < 120000,
      )
      if (matched && matched.blob) {
        const url = URL.createObjectURL(matched.blob)
        this._blobUrls.set(matched.callId, url)
        if (call.id) {
          this._blobUrls.set(call.id, url)
        }
        return url
      }
    }

    // 4. Nếu có bản ghi từ Wazo Call-Logd Server
    const serverRecUuid = call.recordings?.[0]?.uuid || call.recordingUuid
    if (call.id && serverRecUuid) {
      const host = (
        wazoHost ||
        import.meta.env?.VITE_WAZO_HOST ||
        localStorage.getItem('smartcall_wazo_host') ||
        '107.126.11.126:9443'
      )
        .trim()
        .replace(/^https?:\/\//, '')
      const authToken = token || localStorage.getItem('smartcall_wazo_token') || ''
      const url = `https://${host}/api/call-logd/1.0/users/me/cdr/${call.id}/recordings/${serverRecUuid}/media`

      try {
        const res = await fetch(url, {
          headers: {
            'X-Auth-Token': authToken,
          },
        })
        if (res.ok) {
          const blob = await res.blob()
          const objectUrl = URL.createObjectURL(blob)
          this._blobUrls.set(call.id, objectUrl)
          return objectUrl
        }
      } catch (err) {
        logger.warn('RECORD', 'Không thể tải file ghi âm từ máy chủ Wazo:', err.message)
      }
    }

    return null
  }

  /**
   * Tải file ghi âm về máy tính người dùng (.webm)
   */
  async downloadRecordingForCall(call, filename = null) {
    const url = await this.getAudioUrlForCall(call)
    if (!url) {
      throw new Error('Không tìm thấy file âm thanh ghi âm cho cuộc gọi này')
    }

    const ext = call.extension || 'call'
    const dateFormatted = (call.date || '').replace(/[: ]/g, '-')
    const name = filename || `recording_${ext}_${dateFormatted || Date.now()}.webm`

    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    logger.info('RECORD', `Đã tải xuống file ghi âm: ${name}`)
  }

  /**
   * Xóa bản ghi âm khỏi IndexedDB
   */
  async deleteRecording(callId) {
    if (!callId) return false
    if (this._blobUrls.has(callId)) {
      try {
        URL.revokeObjectURL(this._blobUrls.get(callId))
      } catch (e) {}
      this._blobUrls.delete(callId)
    }
    this._memoryFallback.delete(callId)

    const db = await this._initDB()
    if (!db) return true

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(callId)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
      } catch (e) {
        resolve(false)
      }
    })
  }
}

export const recordService = new RecordService()
