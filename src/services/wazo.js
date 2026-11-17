import { reactive } from 'vue'
import Wazo from '@wazo/sdk'
import { logger } from './loggerService'
import { audioService } from './audioService'
import { historyService } from './historyService'
import { contactService } from './contactService'
import { chatService } from './chatService'
import { websocketService } from './websocketService'
import { recordService } from './recordService'

/**
 * Single Source of Truth (SSOT) Reactive Call Store
 * Quản lý trạng thái cuộc gọi toàn cục, đồng bộ cho toàn bộ ứng dụng
 */
export const callStore = reactive({
  isRegistered: false,
  myExtension: localStorage.getItem('smartcall_extension') || localStorage.getItem('smartcall_user_exten') || '',
  myUserUuid: localStorage.getItem('smartcall_user_uuid') || '',
  myUserName: localStorage.getItem('smartcall_username') || '',
  myDepartment: localStorage.getItem('smartcall_department') || localStorage.getItem('smartcall_user_department') || '',
  // activeCall: { session, number, name, dept, direction: 'outbound'|'inbound', status: 'ringing'|'connected'|'held', startTime, duration, isMuted, isHeld }
  activeCall: null,
  // incomingCall: { rawSession, session, number, extension, name, dept, sipUri }
  incomingCall: null,
  callNotice: null,
})

class WazoService {
  constructor() {
    this.session = null
    this.currentCallSession = null
    // Lấy IP từ file môi trường .env hoặc dùng mặc định máy chủ tổng đài
    this.host = import.meta.env.VITE_WAZO_HOST || '107.126.11.126:9443'
    // Client ID duy nhất cho phiên Web (đối ứng chuẩn mã nguồn tham chiếu mẫu Android)
    this.clientId = ''
    this.currentClientId = ''
    this.getOrCreateClientId()
    this.listenersAttached = false
    this.isRegistered = false
    this.eventWs = null
    this._durationInterval = null
    this._isDialing = false
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this._isKicked = false
    this._tokenCheckTimer = null
  }

  getOrCreateClientId() {
    let storedClientId = ''
    try {
      storedClientId = sessionStorage.getItem('smartcall_client_id') || ''
    } catch (e) {}
    if (!storedClientId) {
      const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
      storedClientId = `smartcall-web-${rand}`
      try {
        sessionStorage.setItem('smartcall_client_id', storedClientId)
      } catch (e) {}
    }
    this.clientId = storedClientId
    this.currentClientId = storedClientId
    return storedClientId
  }

  init() {
    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const cId = this.getOrCreateClientId()
    Wazo.Auth.init(cId)
    Wazo.Auth.setClientId(cId)
    Wazo.Auth.setHost(cleanHost)
    if (typeof window !== 'undefined') {
      window.Wazo = Wazo
    }
    logger.info('AUTH', `Khởi tạo Wazo Auth SDK với host: ${cleanHost}, clientId: ${cId}`)
  }

  async login(username, password) {
    this.logout()
    this.init()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
      this.session = await Wazo.Auth.logIn(username, password)
      if (this.session && this.session.token) {
        localStorage.setItem('smartcall_wazo_token', this.session.token)
        localStorage.setItem('smartcall_wazo_refreshToken', this.session.refreshToken || '')
        this.currentSessionUuid = this.session.sessionUuid || ''
        if (this.currentSessionUuid) {
          localStorage.setItem('smartcall_session_uuid', this.currentSessionUuid)
        }
        if (this.clientId) {
          try {
            sessionStorage.setItem('smartcall_client_id', this.clientId)
          } catch (e) {}
        }
        if (this.session.uuid) {
          localStorage.setItem('smartcall_user_uuid', this.session.uuid)
          callStore.myUserUuid = this.session.uuid
        }
        let exten = ''
        try {
          exten = this.session.primaryNumber?.() || ''
        } catch (e) {}
        if (exten) {
          localStorage.setItem('smartcall_user_exten', exten)
          localStorage.setItem('smartcall_extension', exten)
          callStore.myExtension = exten
        }
        if (this.session.profile?.department) {
          const dept = this.session.profile.department
          localStorage.setItem('smartcall_department', dept)
          localStorage.setItem('smartcall_user_department', dept)
          callStore.myDepartment = dept
        }
        callStore.myUserName = this.getMyUserName()
        historyService.reload()
        logger.success('AUTH', `Đăng nhập Wazo thành công! UUID: ${this.session.uuid || 'N/A'}`)

        // Thu hồi session cũ và refresh token của các thiết bị khác theo chuẩn mã nguồn tham chiếu mẫu
        // Chốt chặn an toàn: Chỉ thực hiện khi có đầy đủ sessionUuid và clientId hợp lệ
        if (this.session.uuid && this.currentSessionUuid && this.currentClientId) {
          this.revokeOtherDevices(this.session.uuid, this.currentSessionUuid, this.currentClientId).catch((err) => {
            logger.warn('AUTH', 'Lỗi khi thu hồi phiên thiết bị khác:', err.message)
          })
        } else {
          logger.warn('AUTH', 'Chốt chặn an toàn: Bỏ qua thu hồi phiên khác do thiếu sessionUuid hoặc clientId hợp lệ.')
        }
      }

      this.openWebSocketEvents()

      // Tự động kết nối WebRTC Phone sau khi login thành công
      try {
        await this.connectPhone()
      } catch (phoneErr) {
        logger.warn('SIP', 'Kết nối WebRTC Phone cảnh báo (vẫn duy trì phiên login)', phoneErr.message)
      }

      // Tự động đồng bộ trạng thái Trực tuyến kèm Session ID lên Wazo Chatd
      this.mySessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
      this._isKicked = false
      try {
        await this.setPresence('available', this.mySessionId)
      } catch (presErr) {
        /* ignore */
      }
      this.startTokenHeartbeat()

      return this.session
    } catch (error) {
      logger.error('AUTH', `Đăng nhập thất bại: ${error.message || error}`, error)
      throw error
    }
  }

  // Khôi phục session xác thực Wazo từ Token khi người dùng F5 hoặc mở lại tab
  async restoreSession() {
    this.init()
    const token = localStorage.getItem('smartcall_wazo_token')
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        this.session = await Wazo.Auth.validateToken(token, refreshToken)
        if (this.session) {
          this.currentSessionUuid = this.session.sessionUuid || localStorage.getItem('smartcall_session_uuid') || ''
          if (this.currentSessionUuid) {
            localStorage.setItem('smartcall_session_uuid', this.currentSessionUuid)
          }
          if (this.session.uuid) {
            localStorage.setItem('smartcall_user_uuid', this.session.uuid)
            callStore.myUserUuid = this.session.uuid
          }
          let exten = ''
          try {
            exten = this.session.primaryNumber?.() || ''
          } catch (e) {}
          if (exten) {
            localStorage.setItem('smartcall_user_exten', exten)
            localStorage.setItem('smartcall_extension', exten)
            callStore.myExtension = exten
          }
          if (this.session.profile?.department) {
            const dept = this.session.profile.department
            localStorage.setItem('smartcall_department', dept)
            localStorage.setItem('smartcall_user_department', dept)
            callStore.myDepartment = dept
          }
          callStore.myUserName = this.getMyUserName()
          historyService.reload()
          logger.success('AUTH', 'Đã khôi phục phiên đăng nhập Wazo từ Token thành công!')
          this.openWebSocketEvents()
          try {
            await this.connectPhone()
          } catch (phoneErr) {
            logger.warn('SIP', 'Khôi phục WebRTC phone cảnh báo', phoneErr.message)
          }
          this.mySessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
          this._isKicked = false
          try {
            await this.setPresence('available', this.mySessionId)
          } catch (presErr) {
            /* ignore */
          }
          this.startTokenHeartbeat()
          return true
        }
      } catch (e) {
        logger.warn('AUTH', 'Không thể khôi phục phiên Wazo từ Token cũ', e.message)
      }
    }
    return false
  }

  logout() {
    logger.info('AUTH', 'Thực hiện đăng xuất khỏi hệ thống Wazo...')
    try {
      this.setPresence('unavailable', 'Ngoại tuyến')
    } catch (e) {
      /* ignore */
    }
    this._finalizeCallTermination('ended')
    this.closeWebSocketEvents()
    if (this.session) {
      try {
        Wazo.Auth.logout(this.session)
      } catch (e) {
        /* ignore */
      }
      this.session = null
    }
    // Xóa sạch toàn bộ session storage keys theo Issue 2 & plan
    const sessionKeys = [
      'smartcall_wazo_token',
      'smartcall_wazo_refreshToken',
      'smartcall_user_uuid',
      'smartcall_user_exten',
      'smartcall_extension',
      'smartcall_username',
      'smartcall_department',
      'smartcall_user_department',
      'smartcall_role',
      'smartcall_is_admin',
      'smartcall_logged_in',
      'smartcall_active_room_id',
      'smartcall_offline_mode',
      'smartcall_session_uuid',
    ]
    sessionKeys.forEach((key) => localStorage.removeItem(key))
    try {
      sessionStorage.removeItem('smartcall_client_id')
    } catch (e) {}
    this.clientId = ''
    this.currentClientId = ''

    // Xóa tất cả các cache phòng chat cục bộ để không rò rỉ sang tài khoản khác
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('smartcall_chat_rooms_')) {
          localStorage.removeItem(k)
        }
      })
    } catch (e) {}
    this.stopTokenHeartbeat()
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this._isKicked = false
    this.disconnectPhone()
    callStore.isRegistered = false
    callStore.myExtension = ''
    callStore.myUserUuid = ''
    callStore.myUserName = ''
    callStore.myDepartment = ''
    callStore.activeCall = null
    callStore.incomingCall = null
    contactService.reset()
    chatService.reset()
    historyService.reset()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
  }

  isLogged() {
    return Boolean(this.session?.token || localStorage.getItem('smartcall_wazo_token'))
  }

  getToken() {
    return this.session?.token || localStorage.getItem('smartcall_wazo_token') || ''
  }

  getMyExtension() {
    try {
      const ext = this.session?.primaryNumber?.()
      if (ext) return String(ext).trim()
    } catch (e) {}
    const stored =
      localStorage.getItem('smartcall_extension') ||
      localStorage.getItem('smartcall_user_exten') ||
      localStorage.getItem('smartcall_sip_user') ||
      ''
    return String(stored).trim()
  }

  getMyUserUuid() {
    return this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || ''
  }

  handleSessionKicked() {
    if (!this.isLogged() || this._isKicked) return
    this._isKicked = true
    logger.warn('AUTH', 'Phiên làm việc bị hủy hoặc tài khoản đăng nhập nơi khác.')
    this.stopTokenHeartbeat()
    this.disconnectPhone()
    if (this.eventWs) {
      try {
        this.eventWs.close()
      } catch (e) {}
      this.eventWs = null
    }
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  /**
   * Thu hồi toàn bộ phiên làm việc và refresh token của các thiết bị khác trên máy chủ Wazo Auth
   * Bám sát 100% mã nguồn tham chiếu mẫu:
   * - Bước 1: GET /api/auth/0.1/users/{user_uuid}/sessions -> DELETE .../sessions/{session_uuid} (loại trừ currentSessionUuid)
   * - Bước 2: GET /api/auth/0.1/users/{user_uuid}/tokens -> DELETE .../tokens/{client_id} (loại trừ currentClientId)
   */
  async revokeOtherDevices(userUuid, currentSessionUuid, currentClientId) {
    const token = this.getToken()
    if (!token || !userUuid) return

    // Chốt chặn an toàn: Bắt buộc phải có currentSessionUuid và currentClientId hợp lệ để tránh tự xóa phiên của chính mình
    if (!currentSessionUuid || !currentClientId) {
      logger.warn('AUTH', 'Chốt chặn an toàn: Bỏ qua revokeOtherDevices do thiếu sessionUuid hoặc clientId hợp lệ.')
      return
    }

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`

    // 1. Xóa toàn bộ Session cũ (làm token hiện tại của máy khác bị vô hiệu hóa 401 ngay lập tức)
    try {
      logger.info('AUTH', `[Bước 1/2] Thu hồi các sessions cũ của user [${userUuid}] (loại trừ session: ${currentSessionUuid})...`)
      const res = await fetch(`${host}/api/auth/0.1/users/${userUuid}/sessions`, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data.items) ? data.items : []
        for (const s of items) {
          const sUuid = s.uuid
          if (sUuid && sUuid !== currentSessionUuid) {
            try {
              const delRes = await fetch(`${host}/api/auth/0.1/users/${userUuid}/sessions/${sUuid}`, {
                method: 'DELETE',
                headers: {
                  'X-Auth-Token': token,
                  Accept: 'application/json',
                },
                signal: AbortSignal.timeout(4000),
              })
              logger.info('AUTH', `Đã thu hồi session cũ: ${sUuid} -> Status: ${delRes.status}`)
            } catch (delErr) {
              logger.warn('AUTH', `Lỗi khi thu hồi session ${sUuid}:`, delErr.message)
            }
          }
        }
      } else {
        logger.warn('AUTH', `Không thể lấy danh sách sessions từ Wazo Auth (${res.status})`)
      }
    } catch (err) {
      logger.warn('AUTH', `Lỗi trong quá trình thu hồi sessions cũ:`, err.message)
    }

    // 2. Xóa toàn bộ Refresh Token cũ (ngăn máy khác tự động dùng refresh_token xin token mới)
    try {
      logger.info('AUTH', `[Bước 2/2] Thu hồi các refresh tokens cũ của user [${userUuid}] (loại trừ clientId: ${currentClientId})...`)
      const resTokens = await fetch(`${host}/api/auth/0.1/users/${userUuid}/tokens`, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (resTokens.ok) {
        const dataTokens = await resTokens.json()
        const itemsTokens = Array.isArray(dataTokens.items) ? dataTokens.items : []
        for (const t of itemsTokens) {
          const cId = t.client_id || t.clientId
          if (cId && cId !== currentClientId) {
            try {
              const delRes = await fetch(`${host}/api/auth/0.1/users/${userUuid}/tokens/${encodeURIComponent(cId)}`, {
                method: 'DELETE',
                headers: {
                  'X-Auth-Token': token,
                  Accept: 'application/json',
                },
                signal: AbortSignal.timeout(4000),
              })
              logger.info('AUTH', `Đã xóa refresh_token của client cũ: ${cId} -> Status: ${delRes.status}`)
            } catch (delErr) {
              logger.warn('AUTH', `Lỗi khi xóa refresh_token của client ${cId}:`, delErr.message)
            }
          }
        }
      } else {
        logger.warn('AUTH', `Không thể lấy danh sách refresh tokens từ Wazo Auth (${resTokens.status})`)
      }
    } catch (err) {
      logger.warn('AUTH', `Lỗi trong quá trình thu hồi refresh tokens cũ:`, err.message)
    }
  }

  startTokenHeartbeat() {
    this.stopTokenHeartbeat()
    this._tokenCheckTimer = setInterval(async () => {
      if (this.isLogged() && !this._isKicked) {
        const isHealthy = await this.verifyTokenHealth()
        if (!isHealthy) {
          logger.warn('AUTH', 'Token không còn hợp lệ trên Wazo Auth, phiên đã kết thúc!')
          this.handleSessionKicked()
        }
      }
    }, 5000)
  }

  stopTokenHeartbeat() {
    if (this._tokenCheckTimer) {
      clearInterval(this._tokenCheckTimer)
      this._tokenCheckTimer = null
    }
  }

  async verifyTokenHealth() {
    const token = this.getToken()
    if (!token) return false
    try {
      const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
      const res = await fetch(`${host}/api/auth/0.1/token/${token}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3500),
      })
      if (res.status === 401 || res.status === 404) {
        return false
      }
      return true
    } catch (e) {
      return true // Lỗi mạng tạm thời, không kick nhầm
    }
  }

  async changePassword(oldPassword, newPassword) {
    const token = this.getToken()
    if (!token) throw new Error('Chưa đăng nhập hoặc phiên làm việc đã hết hạn.')
    let userUuid = this.getMyUserUuid()
    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    if (!userUuid) {
      try {
        const meRes = await fetch(`${host}/api/confd/1.1/users/me`, {
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        })
        if (meRes.ok) {
          const meData = await meRes.json()
          if (meData.uuid) {
            userUuid = meData.uuid
            localStorage.setItem('smartcall_user_uuid', meData.uuid)
            callStore.myUserUuid = meData.uuid
          }
        }
      } catch (e) {}
    }
    if (!userUuid) throw new Error('Không xác định được UUID người dùng trên tổng đài.')

    const res = await fetch(`${host}/api/auth/0.1/users/${userUuid}/password`, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
      }),
    })
    return res
  }

  async resetPassword(identifier) {
    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    const queryParam = identifier.includes('@')
      ? `email=${encodeURIComponent(identifier)}`
      : `username=${encodeURIComponent(identifier)}`
    const res = await fetch(`${host}/api/auth/0.1/users/password/reset?${queryParam}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    return res
  }

  getMyUserName() {
    try {
      if (this.session?.profile?.firstName) {
        return `${this.session.profile.firstName} ${this.session.profile.lastName || ''}`.trim()
      }
    } catch (e) {}
    return localStorage.getItem('smartcall_username') || 'Người dùng'
  }

  /**
   * Mở kết nối WebSocket duy nhất tới wazo-websocketd
   * Đăng ký đồng thời sự kiện Presence, Tin nhắn và Cuộc gọi
   */
  openWebSocketEvents() {
    const token = this.getToken()
    if (!token || this.eventWs) return

    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    try {
      this.eventWs = new WebSocket(`wss://${cleanHost}/api/websocketd/?token=${token}&version=2`)

      this.eventWs.onopen = () => {
        logger.info('API', 'Kết nối wazo-websocketd đã mở thành công.')
        try {
          const defaultEvents = [
            'call_created',
            'call_answered',
            'call_ended',
            'chatd_user_room_message_created',
            'chatd_user_message_created',
            'chatd_user_room_created',
            'chatd_presence_updated',
            'chatd_user_presence_updated',
          ]
          for (const name of defaultEvents) {
            this.eventWs.send(JSON.stringify({ op: 'subscribe', data: { event_name: name } }))
          }
          this.eventWs.send(JSON.stringify({ op: 'start' }))
        } catch (err) {
          /* ignore */
        }
      }

      this.eventWs.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data)
          const ev = msg.op === 'event' ? msg.data : msg
          const name = ev?.name || ''
          const data = ev?.data || {}

          // Phát sự kiện presence cho toàn hệ thống
          if (name.includes('presence')) {
            window.dispatchEvent(new CustomEvent('wazo-presence-updated', { detail: data }))

            // Single Device Login: Nếu presence của chính user chứa Session ID mới từ thiết bị khác
            const myUuid = this.getMyUserUuid()
            const targetUuid = data?.uuid || data?.user_uuid
            if (myUuid && targetUuid === myUuid && data?.status && String(data.status).startsWith('sess_')) {
              if (this.mySessionId && data.status !== this.mySessionId) {
                logger.warn('AUTH', `Tài khoản vừa đăng nhập phiên mới (${data.status}) trên thiết bị khác!`)
                this.handleSessionKicked()
                return
              }
            }
          }

          // Chuyển tiếp tới các subscriber của websocketService (chat, call)
          websocketService.emit(name, data)
        } catch (e) {
          /* ignore */
        }
      }

      this.eventWs.onclose = (ev) => {
        const wasKicked =
          ev?.code === 4001 ||
          ev?.code === 4003 ||
          ev?.code === 4401 ||
          (ev?.reason &&
            (ev.reason.includes('401') ||
              ev.reason.toLowerCase().includes('expired') ||
              ev.reason.toLowerCase().includes('invalid') ||
              ev.reason.toLowerCase().includes('session') ||
              ev.reason.toLowerCase().includes('kicked')))

        if (wasKicked && this.isLogged()) {
          this.handleSessionKicked()
          this.eventWs = null
          return
        }

        this.eventWs = null
        if (this.isLogged()) {
          setTimeout(() => {
            if (this.isLogged() && !this.eventWs) {
              this.openWebSocketEvents()
            }
          }, 5000)
        }
      }
    } catch (e) {
      logger.warn('API', 'Không thể mở kết nối wazo-websocketd:', e.message)
    }
  }

  closeWebSocketEvents() {
    if (this.eventWs) {
      try {
        this.eventWs.onclose = null
        this.eventWs.close()
      } catch (e) {}
      this.eventWs = null
    }
  }

  async connectPhone() {
    if (!this.isLogged()) throw new Error('User must be logged in')

    logger.info('SIP', 'Đang kết nối WebSocket WebRTC SIP tới máy chủ Wazo...')
    try {
      await Wazo.Phone.connect({ audio: true, video: false })
      this.attachListeners()
      logger.success('SIP', 'Lệnh Wazo.Phone.connect({ audio: true }) gửi thành công.')
      return true
    } catch (error) {
      logger.error('SIP', `Lỗi kết nối WebRTC SIP: ${error.message || error}`, error)
      throw error
    }
  }

  disconnectPhone() {
    try {
      this.isRegistered = false
      callStore.isRegistered = false
      this.stopRemoteAudio()
      audioService.stopAllTones()
      Wazo.Phone.disconnect()
      this.listenersAttached = false
      logger.info('SIP', 'Đã ngắt kết nối Wazo WebRTC Phone')
    } catch (e) {
      /* Ignore */
    }
  }

  isPhoneRegistered() {
    return Boolean(this.isRegistered || callStore.isRegistered)
  }

  // --- Quản lý Timer đếm giây đàm thoại tập trung ---
  startCallDurationTimer() {
    this.stopCallDurationTimer()
    this._durationInterval = setInterval(() => {
      if (callStore.activeCall && callStore.activeCall.status === 'connected' && !callStore.activeCall.isHeld) {
        if (callStore.activeCall.startTime) {
          callStore.activeCall.duration = Math.max(0, Math.floor((Date.now() - callStore.activeCall.startTime) / 1000))
        } else {
          callStore.activeCall.duration = (callStore.activeCall.duration || 0) + 1
        }
      }
    }, 1000)
  }

  stopCallDurationTimer() {
    if (this._durationInterval) {
      clearInterval(this._durationInterval)
      this._durationInterval = null
    }
  }

  // --- Kết thúc cuộc gọi và ghi nhận CDR tập trung tại một nơi duy nhất ---
  _finalizeCallTermination(reason = 'ended', session = null) {
    const active = callStore.activeCall
    const incoming = callStore.incomingCall

    if (active) {
      const wasConnected = active.status === 'connected'
      let status = 'declined'
      if (wasConnected) {
        status = 'success'
      } else if (reason === 'failed') {
        status = 'declined'
      } else if (active.direction === 'inbound') {
        status = 'missed'
      }

      const finalDuration = wasConnected
        ? (active.startTime
            ? Math.max(0, Math.floor((Date.now() - active.startTime) / 1000))
            : (active.duration || 0))
        : 0

      if (recordService.isRecording()) {
        try {
          recordService.stopRecording()
        } catch (recErr) {
          logger.warn('RECORD', 'Lỗi dừng ghi âm máy chủ:', recErr)
        }
      }

      try {
        historyService.addRecord({
          name: active.name || (active.number ? `Máy lẻ ${active.number}` : 'Đồng nghiệp'),
          extension: active.number || '',
          dept: active.dept || '',
          duration: finalDuration,
          direction: active.direction || 'outbound',
          status: status,
          answered: wasConnected,
        })
      } catch (cdrErr) {
        logger.warn('CALL', 'Không thể ghi nhận CDR cho cuộc gọi hoạt động:', cdrErr)
      }
    } else if (incoming) {
      try {
        historyService.addRecord({
          name: incoming.name || (incoming.extension || incoming.number ? `Máy lẻ ${incoming.extension || incoming.number}` : 'Đồng nghiệp'),
          extension: incoming.extension || incoming.number || '',
          dept: incoming.dept || '',
          duration: 0,
          direction: 'inbound',
          status: 'missed',
          answered: false,
        })
      } catch (cdrErr) {
        logger.warn('CALL', 'Không thể ghi nhận CDR cho cuộc gọi nhỡ:', cdrErr)
      }
    }

    this.stopCallDurationTimer()
    this.currentCallSession = null
    this.stopRemoteAudio()
    audioService.stopAllTones()

    if (active || incoming) {
      audioService.playCallEndedTone()
    }

    callStore.activeCall = null
    callStore.incomingCall = null

    window.dispatchEvent(new CustomEvent('wazo-ended', { detail: session }))
    window.dispatchEvent(new CustomEvent('smartcall-call-ended', { detail: { reason, session } }))
  }

  attachListeners() {
    if (this.listenersAttached) return
    this.listenersAttached = true

    Wazo.Phone.on(Wazo.Phone.ON_REGISTERED, () => {
      this.isRegistered = true
      callStore.isRegistered = true
      callStore.myExtension = this.getMyExtension()
      callStore.myUserUuid = this.getMyUserUuid()
      callStore.myUserName = this.getMyUserName()
      logger.success('SIP', '🟢 Wazo WebRTC SIP Phone: Registered thành công!')
      window.dispatchEvent(new CustomEvent('wazo-registered'))
    })

    Wazo.Phone.on(Wazo.Phone.ON_UNREGISTERED, () => {
      this.isRegistered = false
      callStore.isRegistered = false
      logger.warn('SIP', '🔴 Wazo WebRTC SIP Phone: Unregistered!')
      window.dispatchEvent(new CustomEvent('wazo-unregistered'))

      if (this.isLogged() && !this._isKicked && localStorage.getItem('smartcall_offline_mode') !== 'true') {
        this.verifyTokenHealth().then((isValid) => {
          if (!isValid) {
            logger.warn('SIP', 'Phiên SIP bị ngắt do token không còn hợp lệ hoặc phiên đã chuyển sang thiết bị khác!')
            this.handleSessionKicked()
            return
          }
          setTimeout(async () => {
            if (this.isLogged() && !this.isRegistered && !this._isKicked) {
              try {
                logger.info('SIP', 'Đang tự động kết nối lại WebRTC Phone sau khi mất đăng ký...')
                await this.connectPhone()
              } catch (err) {
                logger.warn('SIP', 'Tự động kết nối lại WebRTC Phone thất bại:', err)
              }
            }
          }, 5000)
        })
      }
    })

    Wazo.Phone.on(Wazo.Phone.ON_PROGRESS, (callSession) => {
      logger.info('CALL', '🔔 Sự kiện Wazo: Đường dây đang đổ chuông (ON_PROGRESS / 180 Ringing)')
      if (callStore.activeCall) {
        callStore.activeCall.status = 'ringing'
      }
      audioService.startRingbackTone()
      window.dispatchEvent(new CustomEvent('wazo-progress', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => {
      const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
      logger.info('CALL', `🔔 Cuộc gọi đến từ máy lẻ: ${ext || 'N/A'}`, callSession)

      // Kiểm tra nếu đang có cuộc gọi hoạt động (bận)
      if (callStore.activeCall || (callStore.incomingCall && callStore.incomingCall.rawSession !== callSession)) {
        logger.warn('CALL', `Đang bận đàm thoại. Tự động từ chối cuộc gọi đến từ máy lẻ ${ext}`)
        try {
          if (callSession && typeof callSession.reject === 'function') {
            callSession.reject()
          } else {
            this.reject(callSession)
          }
        } catch (e) {}

        const contact = contactService.findContactByExtension(ext)
        const name = contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp')
        const dept = contact?.dept || 'Nội bộ công ty'
        historyService.addRecord({
          name,
          extension: ext,
          dept,
          duration: 0,
          direction: 'inbound',
          status: 'missed',
          answered: false,
        })
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: { message: `📞 Cuộc gọi nhỡ từ ${name} (Máy bận)`, type: 'warning' },
          }),
        )
        return
      }

      this.currentCallSession = callSession
      const contact = contactService.findContactByExtension(ext)
      const name =
        callSession?.displayName ||
        callSession?.realDisplayName ||
        callSession?.name ||
        contact?.name ||
        (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp')
      const dept = callSession?.dept || contact?.dept || 'Nội bộ công ty'
      const sipHost = (this.host || '107.126.11.126:9443').replace(/^https?:\/\//, '').split(':')[0]
      const sipUri = callSession?.sipUri || (ext ? `sip:${ext}@${sipHost}` : '')

      callStore.incomingCall = {
        rawSession: callSession,
        session: callSession,
        number: ext,
        extension: ext,
        name,
        dept,
        sipUri,
      }

      window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => {
      this.currentCallSession = callSession
      logger.success('CALL', '🟢 Sự kiện Wazo: Cuộc gọi đã được kết nối! Đang đàm thoại 2 chiều (Full-Duplex).')
      audioService.stopRingbackTone()

      if (callStore.incomingCall) {
        callStore.incomingCall = null
      }

      if (callStore.activeCall) {
        callStore.activeCall.session = callSession
        callStore.activeCall.status = 'connected'
        callStore.activeCall.startTime = Date.now()
        callStore.activeCall.duration = 0
        if (!callStore.activeCall.callId) {
          callStore.activeCall.callId = `rec-${Date.now()}`
        }
      } else {
        const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
        const contact = contactService.findContactByExtension(ext)
        callStore.activeCall = {
          session: callSession,
          callId: `rec-${Date.now()}`,
          number: ext,
          name: contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp'),
          dept: contact?.dept || '',
          direction: 'inbound',
          status: 'connected',
          startTime: Date.now(),
          duration: 0,
          isMuted: false,
          isHeld: false,
          isRecorded: false,
        }
      }

      this.startCallDurationTimer()

      // Tự động kích hoạt ghi âm máy chủ nếu bật cấu hình autoRecordCalls
      if (localStorage.getItem('smartcall_auto_record_calls') === 'true') {
        setTimeout(async () => {
          if (callStore.activeCall && !recordService.isRecording()) {
            try {
              await recordService.startRecording(null, {
                name: callStore.activeCall.name,
                number: callStore.activeCall.number,
                extension: callStore.activeCall.number,
                dept: callStore.activeCall.dept,
                direction: callStore.activeCall.direction,
              })
              callStore.activeCall.isRecorded = true
            } catch (err) {
              logger.warn('RECORD', 'Không thể tự động kích hoạt ghi âm máy chủ:', err.message)
            }
          }
        }, 1200)
      }

      // Gắn luồng âm thanh đàm thoại WebRTC
      try {
        const immediateStream = Wazo.Phone.getRemoteStream(callSession)
        if (immediateStream) {
          this.playRemoteStream(immediateStream)
        }
      } catch (err) {}

      setTimeout(() => {
        try {
          const sdkAudios = [...document.querySelectorAll('audio')].filter(
            (a) => a.id !== 'wazo-remote-audio' && a.srcObject && !a.paused,
          )
          if (sdkAudios.length > 0) {
            logger.info('AUDIO', 'Luồng âm thanh WebRTC đã được phát tự động bởi Wazo SDK.')
            return
          }
          const stream = Wazo.Phone.getRemoteStream(callSession)
          if (stream) {
            this.playRemoteStream(stream)
            logger.info('AUDIO', 'Đã kích hoạt luồng âm thanh đàm thoại 2 chiều dự phòng.')
          }
        } catch (err) {
          logger.warn('AUDIO', 'Cảnh báo đồng bộ luồng âm thanh:', err)
        }
      }, 600)

      window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, (callSession) => {
      logger.info('CALL', '⏹️ Sự kiện Wazo: Cuộc gọi đã kết thúc (ON_CALL_ENDED)')
      this._finalizeCallTermination('ended', callSession)
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_FAILED, (callSession) => {
      logger.error('CALL', '❌ Sự kiện Wazo: Cuộc gọi thất bại (ON_CALL_FAILED - Máy bận, offline hoặc từ chối)')
      this._finalizeCallTermination('failed', callSession)
      window.dispatchEvent(new CustomEvent('wazo-failed', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_REJECTED, (callSession) => {
      logger.warn('CALL', '🚫 Sự kiện Wazo: Cuộc gọi bị từ chối (ON_CALL_REJECTED)')
      this._finalizeCallTermination('rejected', callSession)
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_CANCELED, (callSession) => {
      logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)')
      this._finalizeCallTermination('canceled', callSession)
    })
  }

  // Phát luồng âm thanh 2 chiều của người gọi từ xa qua thẻ <audio>
  playRemoteStream(stream) {
    let audioElement = document.getElementById('wazo-remote-audio')
    if (!audioElement) {
      audioElement = document.createElement('audio')
      audioElement.id = 'wazo-remote-audio'
      audioElement.autoplay = true
      document.body.appendChild(audioElement)
    }
    audioElement.srcObject = stream
    audioElement.play().catch((err) => {
      logger.warn('AUDIO', 'Trình duyệt chặn Autoplay Audio (Cần tương tác người dùng):', err)
    })
  }

  stopRemoteAudio() {
    const audioElement = document.getElementById('wazo-remote-audio')
    if (audioElement) {
      audioElement.srcObject = null
    }
  }

  // --- Điều khiển cuộc gọi cấp thấp qua WebRTC SDK ---
  async makeCall(extension) {
    logger.info('CALL', `📞 Bắt đầu gọi tới số máy lẻ: ${extension} (Audio-only WebRTC)...`)
    try {
      this.currentCallSession = await Wazo.Phone.call(extension, false)
      logger.success('CALL', `Tín hiệu cuộc gọi tới ${extension} đã được phát đi. Session ID: ${this.currentCallSession?.sipCallId || 'N/A'}`)
      return this.currentCallSession
    } catch (err) {
      logger.error('CALL', `Lỗi khi thực hiện cuộc gọi tới ${extension}: ${err.message || err}`, err)
      audioService.stopAllTones()
      throw err
    }
  }

  hangup(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Cúp máy (Hangup)')
    audioService.stopAllTones()
    const session = callSession || this.currentCallSession || callStore.activeCall?.session
    if (session) {
      try {
        Wazo.Phone.hangup(session)
      } catch (e) {
        /* ignore */
      }
    } else {
      try {
        Wazo.Phone.hangup()
      } catch (e) {
        /* ignore */
      }
    }
    this._finalizeCallTermination('ended', session)
  }

  accept(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Nghe máy (Accept)')
    audioService.stopRingbackTone()
    audioService.stopIncomingRingtone()
    const session = callSession || this.currentCallSession || callStore.incomingCall?.session
    if (session) {
      this.currentCallSession = session
      try {
        Wazo.Phone.accept(session, false)
      } catch (e) {
        /* ignore */
      }
    }
  }

  reject(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Từ chối cuộc gọi (Reject)')
    audioService.stopAllTones()
    const session = callSession || this.currentCallSession || callStore.incomingCall?.session
    if (session) {
      try {
        Wazo.Phone.reject(session)
      } catch (e) {
        /* ignore */
      }
    }
    this._finalizeCallTermination('rejected', session)
  }

  // --- Quản lý tiếp nhận & từ chối cuộc gọi đến tập trung ---
  acceptIncomingCall(callData = null) {
    const incoming = callData || callStore.incomingCall
    if (!incoming) return

    logger.info('CALL', `Chấp nhận cuộc gọi đến từ máy lẻ: ${incoming.number || incoming.extension}`)
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    this.accept(session)

    const recId = `rec-${Date.now()}`
    callStore.activeCall = {
      session: session,
      callId: recId,
      number: incoming.extension || incoming.number || '',
      name: incoming.name || '',
      dept: incoming.dept || '',
      direction: 'inbound',
      status: 'connected',
      startTime: Date.now(),
      duration: 0,
      isMuted: false,
      isHeld: false,
      isRecorded: false,
    }
    callStore.incomingCall = null
    this.startCallDurationTimer()

    if (localStorage.getItem('smartcall_auto_record_calls') === 'true') {
      setTimeout(async () => {
        if (callStore.activeCall && !recordService.isRecording()) {
          try {
            await recordService.startRecording(null, {
              name: callStore.activeCall.name,
              number: callStore.activeCall.number,
              extension: callStore.activeCall.number,
              dept: callStore.activeCall.dept,
              direction: callStore.activeCall.direction,
            })
            callStore.activeCall.isRecorded = true
          } catch (err) {
            logger.warn('RECORD', 'Không thể tự động kích hoạt ghi âm máy chủ khi trả lời:', err.message)
          }
        }
      }, 1200)
    }
  }

  rejectIncomingCall(callData = null) {
    const incoming = callData || callStore.incomingCall
    if (!incoming) return

    logger.info('CALL', `Từ chối cuộc gọi đến từ máy lẻ: ${incoming.number || incoming.extension}`)
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    this.reject(session)
  }

  missIncomingCall(callData = null) {
    const incoming = callData || callStore.incomingCall
    if (!incoming) return

    logger.info('CALL', `Cuộc gọi đến từ máy lẻ ${incoming.number || incoming.extension} đã hết hạn (Missed)`)
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    if (session) {
      try {
        Wazo.Phone.reject(session)
      } catch (e) {}
    }

    try {
      historyService.addRecord({
        name: incoming.name || `Máy lẻ ${incoming.extension || incoming.number}`,
        extension: incoming.extension || incoming.number || '',
        dept: incoming.dept || '',
        duration: 0,
        direction: 'inbound',
        status: 'missed',
        answered: false,
      })
    } catch (e) {}

    this.currentCallSession = null
    this.stopRemoteAudio()
    callStore.incomingCall = null
  }

  // --- Kiểm tra toàn diện & Thực hiện cuộc gọi (Single Entry Point) ---
  async validateAndMakeCall(rawExt, meta = {}) {
    // 1. Chống bấm liên tục (Throttle 1200ms)
    if (this._isDialing) {
      logger.warn('UI', 'Thao tác quay số quá nhanh, vui lòng chờ trong giây lát!')
      return { success: false, reason: 'THROTTLED' }
    }

    // 2. Chặn nếu đang trong một cuộc gọi khác
    if (callStore.activeCall || this.hasActiveCall()) {
      logger.warn('CALL', 'Chặn quay số: Người dùng đang trong một cuộc gọi khác.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động. Vui lòng cúp máy trước khi gọi số mới!',
            type: 'warning',
          },
        }),
      )
      return { success: false, reason: 'BUSY_LOCAL' }
    }

    const ext = String(rawExt || '').trim()
    if (!ext) {
      return { success: false, reason: 'EMPTY_EXTENSION' }
    }

    this._isDialing = true
    setTimeout(() => {
      this._isDialing = false
    }, 1200)

    const cleanExt = ext.split('@')[0].trim()
    const myExt = this.getMyExtension()
    const cleanMyExt = myExt.split('@')[0].trim()

    // 3. Chặn người dùng tự gọi cho chính mình
    if (cleanMyExt && cleanExt === cleanMyExt) {
      logger.warn('CALL', `Chặn thao tác: Người dùng cố gắng gọi tới chính máy lẻ của mình (${cleanExt})`)
      this._isDialing = false
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ Không thể thực hiện cuộc gọi tới chính máy lẻ của bạn (${cleanExt})!`,
            type: 'warning',
          },
        }),
      )
      return { success: false, reason: 'SELF_CALL' }
    }

    // 4. Kiểm tra trạng thái máy lẻ trong danh bạ
    const targetContact = contactService.findContactByExtension(cleanExt)
    if (!targetContact && cleanExt !== '8001' && !meta.allowUnknown) {
      if (contactService.currentContacts && contactService.currentContacts.length > 0) {
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} không tồn tại trong danh bạ hệ thống.`)
        this._isDialing = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: `⚠️ Số máy lẻ [${cleanExt}] không tồn tại trong danh bạ hệ thống!`,
              type: 'warning',
            },
          }),
        )
        return { success: false, reason: 'TARGET_NOT_FOUND' }
      }
    }

    if (targetContact) {
      if (targetContact.status === 'busy') {
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang bận trong cuộc gọi khác.`)
        this._isDialing = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: `🚫 Máy lẻ [${targetContact.name || cleanExt}] hiện đang trong cuộc gọi khác (Máy bận). Vui lòng gọi lại sau!`,
              type: 'warning',
            },
          }),
        )
        return { success: false, reason: 'TARGET_BUSY' }
      }

      if (targetContact.status === 'dnd') {
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang bật chế độ Không làm phiền (DND).`)
        this._isDialing = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: `🔕 [${targetContact.name || cleanExt}] đang bật chế độ Không làm phiền (DND). Vui lòng liên hệ sau!`,
              type: 'warning',
            },
          }),
        )
        return { success: false, reason: 'TARGET_DND' }
      }

      if (targetContact.status === 'ringing') {
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang đổ chuông nhận cuộc gọi khác.`)
        this._isDialing = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: `🔔 [${targetContact.name || cleanExt}] hiện đang nhận một cuộc gọi khác. Vui lòng gọi lại sau!`,
              type: 'warning',
            },
          }),
        )
        return { success: false, reason: 'TARGET_RINGING' }
      }

      if (targetContact.status === 'offline' || targetContact.status === 'unavailable') {
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} hiện đang ngoại tuyến.`)
        this._isDialing = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: '📴 Người này hiện đang ngoại tuyến, xin vui lòng gọi lại lúc khác!',
              type: 'warning',
            },
          }),
        )
        return { success: false, reason: 'TARGET_OFFLINE' }
      }
    }

    // 5. Kiểm tra phần cứng Microphone
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const hasMic = devices.some((d) => d.kind === 'audioinput')
        if (devices.length > 0 && !hasMic) {
          logger.error('CALL', 'Không tìm thấy thiết bị Microphone trên máy tính để thực hiện cuộc gọi WebRTC!')
          this._isDialing = false
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: {
                message: '❌ Không tìm thấy thiết bị Microphone! Vui lòng cắm Mic/Tai nghe vào máy tính để gọi.',
                type: 'error',
              },
            }),
          )
          return { success: false, reason: 'NO_MIC' }
        }
      }
    } catch (micErr) {
      /* ignore */
    }

    // 6. Cảnh báo nếu WebRTC SIP chưa sẵn sàng
    if (!this.isPhoneRegistered()) {
      logger.warn('SIP', 'WebRTC Phone chưa ở trạng thái Registered với máy chủ.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⚠️ WebRTC SIP Phone chưa kết nối tới máy chủ tổng đài. Đang thử gửi tín hiệu gọi...',
            type: 'warning',
          },
        }),
      )
    }

    // 7. Khởi tạo trạng thái activeCall trên reactive callStore
    const targetName = meta.name || targetContact?.name || `Máy lẻ ${cleanExt}`
    const targetDept = meta.dept || targetContact?.dept || ''

    const recCallId = `rec-${Date.now()}`
    callStore.activeCall = {
      session: null,
      callId: recCallId,
      number: cleanExt,
      name: targetName,
      dept: targetDept,
      direction: 'outbound',
      status: 'ringing',
      startTime: null,
      duration: 0,
      isMuted: false,
      isHeld: false,
      isRecorded: false,
    }

    audioService.startRingbackTone()

    try {
      const session = await this.makeCall(cleanExt)
      if (callStore.activeCall) {
        callStore.activeCall.session = session
      }
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `📞 Đang gửi tín hiệu cuộc gọi WebRTC tới máy lẻ ${cleanExt}...`,
            type: 'info',
          },
        }),
      )
      return { success: true, session }
    } catch (err) {
      this._finalizeCallTermination('failed')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `❌ Cuộc gọi tới ${cleanExt} không thành công: ${err.message || 'Lỗi kết nối máy chủ'}`,
            type: 'error',
          },
        }),
      )
      return { success: false, reason: 'SDK_ERROR', error: err }
    }
  }

  // --- Điều khiển tính năng đàm thoại (Mute / Hold / DTMF) ---
  setMute(isMuted, callSession = null) {
    const session = callSession || this.currentCallSession || callStore.activeCall?.session
    if (session) {
      try {
        if (isMuted) {
          Wazo.Phone.mute(session)
          logger.info('CALL', 'Đã tắt Microphone (Mute)')
        } else {
          Wazo.Phone.unmute(session)
          logger.info('CALL', 'Đã bật lại Microphone (Unmute)')
        }
      } catch (e) {
        logger.warn('CALL', 'Lỗi chuyển trạng thái Mic:', e)
      }
    }
  }

  toggleMute() {
    if (!callStore.activeCall) return
    callStore.activeCall.isMuted = !callStore.activeCall.isMuted
    this.setMute(callStore.activeCall.isMuted, callStore.activeCall.session)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: callStore.activeCall.isMuted ? '🔇 Đã tắt Microphone (Mute).' : '🎙️ Đã bật lại Microphone (Unmute).',
          type: 'info',
        },
      }),
    )
  }

  setHold(isHeld, callSession = null) {
    const session = callSession || this.currentCallSession || callStore.activeCall?.session
    if (session) {
      try {
        if (isHeld) {
          Wazo.Phone.hold(session)
          logger.info('CALL', 'Đã giữ máy (Hold)')
        } else {
          if (typeof Wazo.Phone.unhold === 'function') {
            Wazo.Phone.unhold(session)
          } else if (typeof Wazo.Phone.resume === 'function') {
            Wazo.Phone.resume(session)
          }
          logger.info('CALL', 'Đã tiếp tục đàm thoại (Unhold / Resume)')
        }
      } catch (e) {
        logger.warn('CALL', 'Lỗi chuyển trạng thái Giữ máy:', e)
      }
    }
  }

  toggleHold() {
    if (!callStore.activeCall) return
    callStore.activeCall.isHeld = !callStore.activeCall.isHeld
    this.setHold(callStore.activeCall.isHeld, callStore.activeCall.session)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: callStore.activeCall.isHeld
            ? '⏸️ Đang giữ máy (Hold). Luồng âm thanh tạm dừng.'
            : '▶️ Đã tiếp tục đàm thoại (Resume).',
          type: 'info',
        },
      }),
    )
  }

  sendDTMF(tone, callSession = null) {
    const session = callSession || this.currentCallSession || callStore.activeCall?.session
    if (session) {
      try {
        if (typeof Wazo.Phone.sendDTMF === 'function') {
          Wazo.Phone.sendDTMF(tone, session)
        } else if (typeof session.sendDtmf === 'function') {
          session.sendDtmf(tone)
        }
        logger.info('CALL', `Đã gửi tín hiệu DTMF [${tone}] qua WebRTC tới máy chủ Asterisk.`)
      } catch (e) {
        logger.warn('CALL', `Lỗi gửi tín hiệu DTMF [${tone}]:`, e)
      }
    }
  }

  hasActiveCall() {
    return Boolean(this.currentCallSession || callStore.activeCall)
  }

  mute(callSession = null) {
    this.setMute(true, callSession)
  }

  hold(callSession = null) {
    this.setHold(true, callSession)
  }

  /**
   * Cập nhật trạng thái Presence người dùng lên máy chủ tổng đài Wazo Chatd
   * PUT /api/chatd/1.0/users/{user_uuid}/presences (theo OpenAPI spec Wazo Platform 26.10)
   */
  async setPresence(state = 'available', statusText = '') {
    const token = this.getToken()
    if (!token) return false

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    const userUuid = this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || 'me'
    logger.info('API', `Cập nhật Presence: state=${state}, status=${statusText}`)
    try {
      const res = await fetch(`${host}/api/chatd/1.0/users/${userUuid}/presences`, {
        method: 'PUT',
        headers: {
          'X-Auth-Token': token,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          state,
          status: statusText || (state === 'available' ? 'Sẵn sàng' : 'Bận'),
        }),
      })
      if (res.ok) {
        logger.success('API', `Đã đồng bộ Presence "${state}" lên máy chủ Wazo`)
      }
      return res.ok
    } catch (err) {
      logger.warn('API', 'Không thể cập nhật presence lên Wazo server:', err)
      return false
    }
  }
}

export const wazoService = new WazoService()
