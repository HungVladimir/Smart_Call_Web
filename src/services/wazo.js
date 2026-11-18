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
  // activeCall: { session, number, name, dept, direction: 'outbound'|'inbound', status: 'ringing'|'connected', startTime, duration, isMuted }
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
    this.myClientId = ''
    this.getOrCreateClientId()
    this.listenersAttached = false
    this.isRegistered = false
    this.eventWs = null
    this._wsConnectTime = 0
    this._durationInterval = null
    this._isDialing = false
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this._isKicked = false
    this._tokenCheckTimer = null
    this._isRefreshingToken = false
    this._refreshPromise = null

    // Trạng thái Gọi nhóm Ad-hoc (Ad-hoc Group Conference) - Parity với Android WazoSipCallManager
    this.activeAdhocConferenceId = ''
    this.isGroupCall = false
    this.isGroupHost = false
    this.groupHostExtension = ''
    this.groupParticipantExtensions = []
    this.extensionToWazoCallIdMap = new Map()
    this.mergedCallIds = new Set()
    this.secondaryCallSessions = new Map()
    this._terminatingSecondarySipIds = new Set()
    this._isSyncingAdhoc = false
    this._syncAdhocDebounceTimer = null
    this._secondaryInviteTimers = new Map()
    this._primaryInviteTimer = null
    this._processedAddReqIds = new Set()
    this._processedNoticeIds = new Set()
  }

  getHostUrl() {
    return this.host.startsWith('http') ? this.host : `https://${this.host}`
  }

  getOrCreateClientId() {
    let storedClientId = ''
    try {
      storedClientId = sessionStorage.getItem('smartcall_tab_client_id') || ''
    } catch (e) {}
    if (!storedClientId) {
      const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
      storedClientId = `web_${rand}`
      try {
        sessionStorage.setItem('smartcall_tab_client_id', storedClientId)
      } catch (e) {}
    }
    this.clientId = storedClientId
    this.currentClientId = storedClientId
    this.myClientId = storedClientId
    return storedClientId
  }

  init() {
    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const cId = this.getOrCreateClientId()
    Wazo.Auth.init(cId)
    Wazo.Auth.setClientId(cId)
    Wazo.Auth.setHost(cleanHost)
    this._neutralizeSdkAutoHold()
    if (typeof window !== 'undefined') {
      window.Wazo = Wazo
    }
    logger.info('AUTH', `Khởi tạo Wazo Auth SDK với host: ${cleanHost}, clientId: ${cId}`)
  }

  /**
   * Triệt tiêu hoàn toàn cơ chế tự động Hold của Wazo SDK
   * Ngăn chặn SDK phát SIP re-INVITE (sendonly) gây phát Music On Hold (MOH) từ máy chủ tổng đài
   */
  _neutralizeSdkAutoHold() {
    try {
      if (Wazo.Phone) {
        Wazo.Phone.hold = () => Promise.resolve()
        Wazo.Phone.unhold = () => Promise.resolve()
        Wazo.Phone.resume = () => Promise.resolve()
      }

      const phoneInstance = Wazo.Phone?.phone
      const WebRTCPhoneClass = phoneInstance?.constructor
      if (WebRTCPhoneClass && WebRTCPhoneClass.prototype) {
        WebRTCPhoneClass.prototype.holdSipSession = async function () {
          logger.info('CALL', '🛡️ Đã chặn lệnh holdSipSession tự động từ SDK (triệt tiêu Hold & Music On Hold)')
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.hold = function () {
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.unholdSipSession = async function () {
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.unhold = function () {
          return Promise.resolve()
        }
      }

      if (phoneInstance) {
        phoneInstance.holdSipSession = async function () {
          logger.info('CALL', '🛡️ Đã chặn lệnh holdSipSession trên instance (triệt tiêu Hold & Music On Hold)')
          return Promise.resolve()
        }
        phoneInstance.hold = () => Promise.resolve()
        phoneInstance.unhold = () => Promise.resolve()
      }
    } catch (err) {
      logger.warn('CALL', 'Không thể cấu hình triệt tiêu SDK auto-hold:', err)
    }
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

      // Tự động đồng bộ trạng thái Trực tuyến kèm Session ID lên máy chủ Chatd
      this.mySessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
      try {
        sessionStorage.setItem('smartcall_session_id', this.mySessionId)
      } catch (e) {}
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
        this.session = await Wazo.Auth.validateToken(token, refreshToken).catch(() => null)

        // Nếu token 1 giờ đã hết hạn tự nhiên trong lúc đóng tab/trình duyệt, tự động cứu phiên bằng Refresh Token
        if (!this.session && refreshToken) {
          logger.info('AUTH', 'Auth Token cũ đã hết hạn (1 giờ), đang tự động khôi phục phiên bằng Refresh Token...')
          const refreshed = await this.refreshSessionToken()
          if (refreshed) {
            const newToken = this.getToken()
            this.session = await Wazo.Auth.validateToken(newToken, refreshToken).catch(() => null)
            if (!this.session) {
              this.session = {
                token: newToken,
                refreshToken: localStorage.getItem('smartcall_wazo_refreshToken') || refreshToken,
                sessionUuid: localStorage.getItem('smartcall_session_uuid') || '',
                uuid: localStorage.getItem('smartcall_user_uuid') || '',
              }
            }
          }
        }

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
          this.mySessionId = sessionStorage.getItem('smartcall_session_id') || ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))
          try {
            sessionStorage.setItem('smartcall_session_id', this.mySessionId)
          } catch (e) {}
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
    try {
      localStorage.removeItem('smartcall_session_id')
    } catch (e) {}
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
        if (!isHealthy && this._lastRefreshRevoked) {
          logger.warn('AUTH', 'Token và Refresh Token không còn hợp lệ trên Wazo Auth, phiên đã kết thúc!')
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

  /**
   * Tự động làm mới Auth Token khi phiên 1 giờ hết hạn qua Refresh Token
   * Đảm bảo phiên làm việc được duy trì liên tục, chỉ logout khi chính refresh_token bị thu hồi
   */
  async refreshSessionToken() {
    if (this._isRefreshingToken) return this._refreshPromise
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (!refreshToken) {
      logger.warn('AUTH', 'Không tìm thấy refresh_token trong localStorage để làm mới phiên.')
      this._lastRefreshRevoked = true
      return false
    }

    const clientId = this.myClientId || this.clientId || localStorage.getItem('smartcall_device_client_id') || 'web_client'
    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`

    this._isRefreshingToken = true
    this._refreshPromise = (async () => {
      try {
        logger.info('AUTH', `🔄 Đang gửi yêu cầu làm mới Auth Token tới Wazo Auth (client_id: ${clientId})...`)

        // Gửi trực tiếp REST API POST /api/auth/0.1/token chuẩn 100% theo DTO WazoAuthRequest.forRefreshToken
        const res = await fetch(`${host}/api/auth/0.1/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            refresh_token: refreshToken,
            expiration: 604800,
          }),
          signal: AbortSignal.timeout(6000),
        })

        if (res.ok) {
          const data = await res.json()
          const payload = data?.data || data
          const newToken = payload?.token
          const newRefreshToken = payload?.refresh_token || payload?.refreshToken || refreshToken
          const newSessionUuid = payload?.session_uuid || payload?.sessionUuid || payload?.uuid

          if (newToken) {
            localStorage.setItem('smartcall_wazo_token', newToken)
            localStorage.setItem('smartcall_wazo_refreshToken', newRefreshToken)
            if (newSessionUuid) {
              localStorage.setItem('smartcall_session_uuid', newSessionUuid)
              this.currentSessionUuid = newSessionUuid
            }

            if (this.session) {
              this.session.token = newToken
              this.session.refreshToken = newRefreshToken
              if (newSessionUuid) this.session.sessionUuid = newSessionUuid
            } else {
              this.session = {
                token: newToken,
                refreshToken: newRefreshToken,
                sessionUuid: newSessionUuid,
                uuid: payload?.uuid || localStorage.getItem('smartcall_user_uuid') || '',
              }
            }

            try {
              Wazo.Auth.setApiToken(newToken)
              Wazo.Auth.setToken?.(newToken)
            } catch (e) {}

            this._lastRefreshRevoked = false
            logger.success('AUTH', '🎉 Đã làm mới Auth Token thành công! Phiên làm việc được duy trì liên tục.')
            return true
          }
        } else if (res.status === 401 || res.status === 404 || res.status === 400) {
          logger.warn('AUTH', `Refresh token đã bị thu hồi hoặc không hợp lệ trên máy chủ (HTTP ${res.status}).`)
          this._lastRefreshRevoked = true
          return false
        } else {
          logger.warn('AUTH', `Không thể làm mới token do lỗi máy chủ tạm thời (HTTP ${res.status}).`)
          this._lastRefreshRevoked = false
          return false
        }
      } catch (err) {
        logger.warn('AUTH', 'Lỗi mạng khi làm mới Auth Token qua Refresh Token:', err.message)
        this._lastRefreshRevoked = false
        return false
      } finally {
        this._isRefreshingToken = false
        this._refreshPromise = null
      }
      return false
    })()

    return this._refreshPromise
  }

  async verifyTokenHealth(forceRefresh = false) {
    this._lastRefreshRevoked = false
    const token = this.getToken()
    if (!token) return false

    if (forceRefresh) {
      const refreshed = await this.refreshSessionToken()
      if (refreshed) return true
      if (this._lastRefreshRevoked) return false
      return true // Lỗi mạng tạm thời, không kick nhầm
    }

    try {
      const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
      const res = await fetch(`${host}/api/auth/0.1/token/${token}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3500),
      })
      if (res.status === 401 || res.status === 404) {
        logger.info('AUTH', 'Token hết hạn trên máy chủ xác thực (401/404), đang kích hoạt làm mới tự động...')
        const refreshed = await this.refreshSessionToken()
        if (refreshed) {
          return true
        }
        if (this._lastRefreshRevoked) {
          return false
        }
        return true // Lỗi mạng tạm thời, không kick nhầm
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
        this._wsConnectTime = Date.now()
        logger.info('API', 'Kết nối wazo-websocketd đã mở thành công.')
        try {
          const defaultEvents = [
            'call_created',
            'call_answered',
            'call_updated',
            'call_ended',
            'adhoc_conference_created',
            'adhoc_conference_deleted',
            'adhoc_conference_participant_joined',
            'adhoc_conference_participant_left',
            'conference_user_participant_joined',
            'conference_user_participant_left',
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

            // Đồng bộ giao diện Gọi Nhóm cho tất cả thành viên khi nhận tag [GROUP:hostExt:1001,1002,1003]
            const statusText = data?.status || data?.state || ''
            if (this.hasActiveCall() && typeof statusText === 'string' && statusText.includes('[GROUP:')) {
              const start = statusText.indexOf('[GROUP:') + 7
              const end = statusText.indexOf(']', start)
              if (end > start) {
                const content = statusText.substring(start, end).trim()
                let hostExt = ''
                let csv = content
                if (content.includes(':')) {
                  const segs = content.split(':')
                  hostExt = segs[0].trim()
                  csv = segs.slice(1).join(':').trim()
                }
                const parsedExts = csv.split(',').map((s) => s.trim()).filter(Boolean)
                const myExt = this.getMyExtension()
                if (parsedExts.includes(myExt)) {
                  this.isGroupCall = true
                  this.groupHostExtension = hostExt
                  this.isGroupHost = hostExt === myExt
                  this.groupParticipantExtensions = parsedExts
                  if (callStore.activeCall) {
                    callStore.activeCall.isGroupCall = true
                    callStore.activeCall.isGroupHost = this.isGroupHost
                    callStore.activeCall.groupHostExtension = hostExt
                    callStore.activeCall.groupParticipantExtensions = parsedExts
                    callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${parsedExts.length} người)`
                  }
                }
              }
            }

            // 2. Chủ phòng nhận ủy quyền thêm người [ADD_REQ:reqId:hostExt:ext1,ext2] từ máy thành viên
            if (this.hasActiveCall() && this.isGroupHost && typeof statusText === 'string' && statusText.includes('[ADD_REQ:')) {
              const start = statusText.indexOf('[ADD_REQ:') + 9
              const end = statusText.indexOf(']', start)
              if (end > start) {
                const content = statusText.substring(start, end).trim()
                const parts = content.split(':')
                let reqId = ''
                let targetHostExt = ''
                let csvExts = ''
                if (parts.length >= 3) {
                  reqId = parts[0].trim()
                  targetHostExt = parts[1].trim()
                  csvExts = parts.slice(2).join(':').trim()
                } else if (parts.length === 2) {
                  targetHostExt = parts[0].trim()
                  csvExts = parts[1].trim()
                }

                const myExt = this.getMyExtension()
                if (targetHostExt === myExt) {
                  if (!reqId || !this._processedAddReqIds.has(reqId)) {
                    if (reqId) this._processedAddReqIds.add(reqId)
                    const toInvite = csvExts.split(',').map((s) => s.trim()).filter(Boolean)
                    if (toInvite.length > 0) {
                      logger.info('CALL', `Chủ phòng (${myExt}) nhận ủy quyền từ thành viên -> Quay số mời: ${toInvite.join(', ')}`)
                      window.dispatchEvent(
                        new CustomEvent('app-toast', {
                          detail: { message: `📥 Nhận yêu cầu thêm ${toInvite.join(', ')} vào nhóm từ thành viên`, type: 'info' },
                        }),
                      )
                      this.addParticipantsToGroupCall(toInvite)
                    }
                  }
                }
              }
            }

            // 3. Đồng bộ thông báo nhóm khi nhận tag [NOTICE:noticeId:hostExt:message]
            if (this.hasActiveCall() && typeof statusText === 'string' && statusText.includes('[NOTICE:')) {
              const start = statusText.indexOf('[NOTICE:') + 8
              const end = statusText.indexOf(']', start)
              if (end > start) {
                const content = statusText.substring(start, end).trim()
                const parts = content.split(':')
                const noticeId = parts[0]?.trim()
                const noticeMsg = parts.length >= 3 ? parts.slice(2).join(':').trim() : parts.slice(1).join(':').trim()
                if (noticeId && !this._processedNoticeIds.has(noticeId) && noticeMsg) {
                  this._processedNoticeIds.add(noticeId)
                  window.dispatchEvent(
                    new CustomEvent('app-toast', {
                      detail: { message: `🔔 ${noticeMsg}`, type: 'warning' },
                    }),
                  )
                }
              }
            }

            // 4. Báo rời nhóm tức thì khi nhận tag [LEFT:ext]
            if (this.hasActiveCall() && typeof statusText === 'string' && statusText.includes('[LEFT:')) {
              const start = statusText.indexOf('[LEFT:') + 6
              const end = statusText.indexOf(']', start)
              if (end > start) {
                const leftExt = statusText.substring(start, end).trim()
                const myExt = this.getMyExtension()
                if (leftExt && leftExt !== myExt && this.groupParticipantExtensions.includes(leftExt)) {
                  logger.info('CALL', `Nhận thẻ [LEFT:${leftExt}] từ thành viên rời phòng.`)
                  this.handleParticipantLeftGroupCall(leftExt)
                }
              }
            }

            // Single Device Login: Nếu presence của chính user chứa Session ID / Client ID mới từ thiết bị khác hoặc thiết bị Android
            const myUuid = this.getMyUserUuid()
            const targetUuid = data?.uuid || data?.user_uuid
            if (myUuid && targetUuid === myUuid && data?.status) {
              const statusStr = String(data.status)
              // Bỏ qua nếu đây là thẻ tín hiệu hệ thống nội bộ gọi nhóm
              const isGroupCallTag =
                statusStr.includes('[GROUP:') ||
                statusStr.includes('[ADD_REQ:') ||
                statusStr.includes('[NOTICE:') ||
                statusStr.includes('[LEFT:')

              if (!isGroupCallTag) {
                const isAndroidDevice = statusStr.includes('smartcall-android')
                const isOtherWebDevice = statusStr.includes('smartcall-web') && this.myClientId && !statusStr.includes(this.myClientId)
                const isLegacyOtherWeb = statusStr.includes('sess_') && this.mySessionId && !statusStr.includes(this.mySessionId) && (!this.myClientId || !statusStr.includes(this.myClientId))

                if (isAndroidDevice || isOtherWebDevice || isLegacyOtherWeb) {
                  logger.warn('AUTH', `⚡ Phát hiện phiên đăng nhập mới (${statusStr}) từ thiết bị khác. Thực hiện đăng xuất tức thì (0.1s)!`)
                  this.handleSessionKicked()
                  return
                }
              }
            }
          }

          // Khi có nhánh nghe máy trong cuộc gọi nhóm, tự động kích hoạt đồng bộ Ad-hoc Conference (Đã có debounce 350ms)
          if ((name === 'call_answered' || name === 'call_updated') && this.isGroupCall && this.isGroupHost) {
            this.syncActiveCallsToAdhocConference()
          }

          // Xử lý sự kiện giải tán phòng Ad-hoc Conference từ Chủ phòng
          if (name === 'adhoc_conference_deleted') {
            const confId = data?.conference_id || data?.id
            if (this.isGroupCall && this.hasActiveCall() && !this.isGroupHost) {
              logger.info('CALL', `Phòng họp Ad-hoc [${confId}] đã kết thúc bởi Chủ phòng.`)
              window.dispatchEvent(
                new CustomEvent('app-toast', {
                  detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
                }),
              )
              this.hangup()
            }
          }

          // Xử lý sự kiện thành viên rời phòng Ad-hoc Conference hoặc gác máy
          if (name === 'adhoc_conference_participant_left' || name === 'conference_user_participant_left' || name === 'call_ended') {
            const leftCallId = data?.call_id || data?.participant_id || data?.id
            if (this.isGroupCall && this.isGroupHost && leftCallId) {
              this.handleParticipantLeftGroupCall(leftCallId)
            }
          }

          // Chuyển tiếp tới các subscriber của websocketService (chat, call)
          websocketService.emit(name, data)
        } catch (e) {
          /* ignore */
        }
      }

      this.eventWs.onclose = async (ev) => {
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

        this.eventWs = null

        if (wasKicked && this.isLogged() && !this._isKicked) {
          logger.info('API', `WebSocket đóng (${ev?.code || 'N/A'}: ${ev?.reason || ''}). Đang kiểm chứng phiên với Wazo Auth...`)
          const isValid = await this.verifyTokenHealth(true)
          if (!isValid && this._lastRefreshRevoked) {
            logger.warn('AUTH', 'Phiên làm việc đã bị thu hồi thực sự trên máy chủ (HTTP 401 trên refresh token).')
            this.handleSessionKicked()
            return
          }
          logger.success('API', 'Đã cấp mới Token thành công sau khi WebSocket đóng. Đang kết nối lại WebSocket...')
          this.openWebSocketEvents()
          return
        }

        if (this.isLogged() && !this._isKicked) {
          setTimeout(() => {
            if (this.isLogged() && !this.eventWs && !this._isKicked) {
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
      this._neutralizeSdkAutoHold()
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
      if (callStore.activeCall && callStore.activeCall.status === 'connected') {
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
  _finalizeCallTermination(reason = 'ended', session = null, forceEnd = false) {
    // 1. Kiểm tra nếu cuộc gọi nhóm đang diễn ra và chỉ có 1 nhánh phụ bị ngắt (không forceEnd)
    if (!forceEnd && this.isGroupCall && this.isGroupHost && session) {
      const endedSipId = session.sipCallId || (session.getId && session.getId()) || session.id
      let endedSecExt = null
      for (const [ext, secSession] of this.secondaryCallSessions.entries()) {
        const secSipId = secSession.sipCallId || (secSession.getId && secSession.getId()) || secSession.id
        if (secSession === session || (endedSipId && secSipId && String(secSipId) === String(endedSipId))) {
          endedSecExt = ext
          break
        }
      }

      // Nhận diện thêm nếu SIP ID nằm trong danh sách đang hủy do timeout
      const isMarkedTerminating = endedSipId && this._terminatingSecondarySipIds.has(String(endedSipId))
      if (isMarkedTerminating && endedSipId) {
        this._terminatingSecondarySipIds.delete(String(endedSipId))
      }

      if (endedSecExt || isMarkedTerminating) {
        if (endedSecExt) {
          this._clearSecondaryLegTimeout(endedSecExt)
          this.secondaryCallSessions.delete(endedSecExt)

          // Nếu đã có Ad-hoc Conference hoạt động và không phải nhánh timeout, nhánh SIP phụ WebRTC kết thúc do Asterisk chuyển kênh sang ConfBridge
          // -> Tuyệt đối KHÔNG xóa thành viên khỏi nhóm (Đối chiếu WazoSipCallManager.py line 1164)
          if (this.activeAdhocConferenceId && !isMarkedTerminating) {
            logger.info('CALL', `Nhánh WebRTC phụ [${endedSecExt}] đã chuyển giao sang Ad-hoc Conference [${this.activeAdhocConferenceId}]. Tiếp tục duy trì thành viên trong nhóm.`)
            return
          }

          logger.warn('CALL', `Nhánh phụ [${endedSecExt}] kết thúc (${reason}). Gỡ khỏi nhóm và duy trì các nhánh còn lại.`)
          const childCallId = this.extensionToWazoCallIdMap.get(endedSecExt)
          if (childCallId) {
            this.hangupUserCall(childCallId).catch(() => {})
            this.extensionToWazoCallIdMap.delete(endedSecExt)
            this.mergedCallIds.delete(childCallId)
          }
          this.groupParticipantExtensions = this.groupParticipantExtensions.filter((e) => e !== endedSecExt)
          if (callStore.activeCall) {
            callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
            callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
          }
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: { message: `⚠️ Nhánh máy lẻ ${endedSecExt} không thể kết nối hoặc đã rời nhóm`, type: 'warning' },
            }),
          )
          this.broadcastGroupStateViaPresence()
          this.broadcastNoticeToGroup(`Nhánh máy lẻ ${endedSecExt} không thể kết nối hoặc đã rời nhóm`)
        }

        // KIỂM TRA ĐIỀU KIỆN KẾT THÚC CUỘC GỌI NHÓM:
        // Chỉ khi KHÔNG còn ai đang kết nối (đàm thoại) VÀ KHÔNG còn nhánh phụ nào đang đổ chuông VÀ nhánh chính không còn đổ chuông
        const myExt = this.getMyExtension()
        const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)
        if (this.isAnyParticipantConnected() || this.secondaryCallSessions.size > 0 || (this.currentCallSession && remainingOthers.length > 0 && callStore.activeCall?.status === 'ringing')) {
          logger.info('CALL', 'Vẫn còn thành viên đang hoạt động hoặc đang đổ chuông trong nhóm. Duy trì cuộc gọi!')
          return // Không cúp cuộc gọi chính!
        }
        logger.warn('CALL', 'Tất cả thành viên trong nhóm đều đã ngắt kết nối hoặc không nghe máy. Kết thúc cuộc gọi.')
      }

      // 2. Nếu nhánh chính (primary) kết thúc nhưng vẫn còn các nhánh phụ đang hoạt động
      const primarySipId = this.currentCallSession?.sipCallId || (this.currentCallSession?.getId && this.currentCallSession.getId()) || this.currentCallSession?.id
      if (session === this.currentCallSession || (endedSipId && primarySipId && String(primarySipId) === String(endedSipId))) {
        this._clearPrimaryLegTimeout()
        if (this.secondaryCallSessions.size > 0) {
          const [nextExt, nextSession] = this.secondaryCallSessions.entries().next().value
          logger.info('CALL', `Nhánh chính kết thúc. Tự động chuyển nhánh [${nextExt}] lên làm nhánh chính tiếp tục cuộc gọi nhóm.`)
          this.secondaryCallSessions.delete(nextExt)
          this.currentCallSession = nextSession
          if (callStore.activeCall) {
            callStore.activeCall.number = nextExt
            callStore.activeCall.session = nextSession
          }
          this.broadcastGroupStateViaPresence()
          return // Không cúp cuộc gọi chính!
        } else if (this.isAnyParticipantConnected()) {
          logger.info('CALL', 'Nhánh chính WebRTC chuyển trạng thái nhưng cuộc gọi nhóm vẫn đang kết nối thành viên. Duy trì cuộc gọi.')
          return // Không cúp cuộc gọi chính!
        }
      }
    }

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

    // Dọn dẹp Ad-hoc Group Call nếu phiên này là Chủ phòng (Bám sát Android lines 2055-2062)
    if (this.isGroupCall && this.isGroupHost) {
      this._clearAllSecondaryLegTimeouts()
      this._clearPrimaryLegTimeout()
      if (this.activeAdhocConferenceId) {
        this.deleteAdhocConference(this.activeAdhocConferenceId).catch(() => {})
      }
      const childCallIds = Array.from(this.extensionToWazoCallIdMap.values())
      for (const cId of childCallIds) {
        if (cId) {
          this.hangupUserCall(cId).catch(() => {})
        }
      }
      for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
        try {
          Wazo.Phone.hangup(secSession)
        } catch (e) {
          /* ignore */
        }
      }
      this.secondaryCallSessions.clear()
    }
    this._resetGroupCallState()
    try {
      this.setPresence('available', this.mySessionId)
    } catch (e) {
      /* ignore */
    }

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
          if (!isValid && this._lastRefreshRevoked) {
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
          isRecorded: false,
        }
      }

      this.startCallDurationTimer()
      this._clearPrimaryLegTimeout()

      // Xóa timer timeout 30s của nhánh phụ nếu đây là nhánh phụ vừa nghe máy
      const acceptedSipId = callSession?.sipCallId || (callSession?.getId && callSession.getId())
      for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
        const secSipId = secSession.sipCallId || (secSession.getId && secSession.getId())
        if (secSession === callSession || (acceptedSipId && secSipId === acceptedSipId)) {
          this._clearSecondaryLegTimeout(secExt)
          break
        }
      }

      // Tự động đồng bộ các nhánh vào Ad-hoc Conference nếu đang gọi nhóm
      if (this.isGroupCall && this.isGroupHost) {
        setTimeout(() => {
          this.syncActiveCallsToAdhocConference()
        }, 500)
      }

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

    Wazo.Phone.on(Wazo.Phone.ON_CALL_CANCELED, (callSession, elsewhere) => {
      logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)', { elsewhere })
      // Nếu thiết bị đã nhấc máy và có cờ elsewhere (cause=26 completed elsewhere do chuyển kênh / ConfBridge)
      // -> Bỏ qua không ngắt cuộc gọi (Đối chiếu WazoSipCallManager.py line 1168)
      if (elsewhere && callStore.activeCall && callStore.activeCall.status === 'connected') {
        logger.info('CALL', 'Bỏ qua ON_CALL_CANCELED vì cuộc gọi đã được kết nối (completed elsewhere / bridged).')
        return
      }
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

    // 1. Nếu là Chủ phòng gọi nhóm, giải tán Ad-hoc Conference và ngắt tất cả các nhánh Asterisk của thành viên
    // (Bám sát 100% Android WazoSipCallManager.py lines 2044-2062)
    if (this.isGroupCall && this.isGroupHost) {
      this._clearAllSecondaryLegTimeouts()
      this._clearPrimaryLegTimeout()
      if (this.activeAdhocConferenceId) {
        this.deleteAdhocConference(this.activeAdhocConferenceId).catch(() => {})
      }
      const childCallIds = Array.from(this.extensionToWazoCallIdMap.values())
      for (const cId of childCallIds) {
        if (cId) {
          this.hangupUserCall(cId).catch(() => {})
        }
      }
      for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
        try {
          Wazo.Phone.hangup(secSession)
        } catch (e) {
          /* ignore */
        }
      }
      this.secondaryCallSessions.clear()
    } else if (this.isGroupCall && !this.isGroupHost) {
      // Nếu là thành viên trong cuộc gọi nhóm, phát thẻ [LEFT:myExt] trước khi cúp máy để các máy khác cập nhật tức thì
      const myExt = this.getMyExtension()
      if (myExt) {
        this.setPresence('available', `[LEFT:${myExt}]`)
      }
    }

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
    this._finalizeCallTermination('ended', session, true)
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
      isRecorded: false,
      isGroupCall: Boolean(this.isGroupCall || incoming.isGroupCall),
      isGroupHost: Boolean(this.isGroupHost),
      groupHostExtension: this.groupHostExtension || incoming.groupHostExtension || '',
      groupParticipantExtensions: this.groupParticipantExtensions.length > 0
        ? [...this.groupParticipantExtensions]
        : (incoming.groupParticipantExtensions || []),
      groupTitle: this.groupTitle || incoming.groupTitle || '',
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
    if (!targetContact && !meta.allowUnknown) {
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
      isRecorded: false,
      isGroupCall: Boolean(meta.isGroupCall || this.isGroupCall),
      isGroupHost: Boolean(meta.isGroupHost || this.isGroupHost),
      groupHostExtension: meta.groupHostExtension || this.groupHostExtension,
      groupParticipantExtensions: meta.groupParticipants || this.groupParticipantExtensions || [],
      groupTitle: meta.groupTitle || '',
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

  // =========================================================================
  // WAZO CALLD (/api/calld/1.0) - AD-HOC CONFERENCES & GỌI NHÓM TỨC THỜI
  // Đối ứng chuẩn 100% với Android WazoSipCallManager & wazoApiService
  // =========================================================================

  /**
   * Truy vấn danh sách cuộc gọi hiện tại của user trên máy chủ Wazo Calld
   * GET /api/calld/1.0/users/me/calls
   */
  async getMyActiveCalls() {
    const token = this.getToken()
    if (!token) return []
    const host = this.getHostUrl()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/calls`, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    } catch (e) {
      logger.warn('CALL', 'Lỗi khi gọi getMyActiveCalls:', e)
      return []
    }
  }

  /**
   * Tạo phòng họp nhóm Ad-hoc từ host_call_id và danh sách participant_call_ids
   * POST /api/calld/1.0/users/me/conferences/adhoc
   */
  async createAdhocConference(hostCallId, participantCallIds = []) {
    const token = this.getToken()
    if (!token || !hostCallId) return null
    const host = this.getHostUrl()
    try {
      logger.info('CALL', `Tạo Ad-hoc Conference với Host [${hostCallId}] và ${participantCallIds.length} nhánh...`)
      const res = await fetch(`${host}/api/calld/1.0/users/me/conferences/adhoc`, {
        method: 'POST',
        headers: {
          'X-Auth-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          host_call_id: hostCallId,
          participant_call_ids: participantCallIds,
        }),
      })
      if (!res.ok) {
        logger.warn('CALL', `Tạo Ad-hoc Conference thất bại (HTTP ${res.status})`)
        return null
      }
      const data = await res.json()
      logger.success('CALL', `🎉 Đã tạo Ad-hoc Conference thành công: ${data?.conference_id}`)
      return data?.conference_id || null
    } catch (e) {
      logger.error('CALL', 'Lỗi khi tạo Ad-hoc Conference:', e)
      return null
    }
  }

  /**
   * Thêm một participant call_id vào Ad-hoc Conference đang diễn ra
   * PUT /api/calld/1.0/users/me/conferences/adhoc/{conference_id}/participants/{call_id}
   */
  async addParticipantToAdhocConference(conferenceId, callId) {
    const token = this.getToken()
    if (!token || !conferenceId || !callId) return false
    const host = this.getHostUrl()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/conferences/adhoc/${conferenceId}/participants/${callId}`, {
        method: 'PUT',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })
      logger.info('CALL', `Thêm nhánh ${callId} vào Ad-hoc Conference ${conferenceId} -> HTTP ${res.status}`)
      return res.ok
    } catch (e) {
      logger.warn('CALL', 'Lỗi addParticipantToAdhocConference:', e)
      return false
    }
  }

  /**
   * Xóa/Giải tán phòng họp Ad-hoc khi Chủ phòng kết thúc cuộc gọi
   * DELETE /api/calld/1.0/users/me/conferences/adhoc/{conference_id}
   */
  async deleteAdhocConference(conferenceId) {
    const token = this.getToken()
    if (!token || !conferenceId) return false
    const host = this.getHostUrl()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/conferences/adhoc/${conferenceId}`, {
        method: 'DELETE',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })
      logger.info('CALL', `Giải tán Ad-hoc Conference ${conferenceId} -> HTTP ${res.status}`)
      return res.ok
    } catch (e) {
      logger.warn('CALL', 'Lỗi deleteAdhocConference:', e)
      return false
    }
  }

  /**
   * Ngắt một nhánh cuộc gọi cụ thể
   * DELETE /api/calld/1.0/users/me/calls/{call_id}
   */
  async hangupUserCall(callId) {
    const token = this.getToken()
    if (!token || !callId) return false
    const host = this.getHostUrl()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/calls/${callId}`, {
        method: 'DELETE',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })
      return res.ok
    } catch (e) {
      return false
    }
  }

  /**
   * Khởi tạo cuộc gọi nhóm tức thời (Ad-hoc Group Call)
   * Tương thích hoàn toàn với Android WazoSipCallManager.startGroupCall
   * @param {string[]} targetExtensions - Danh sách số máy lẻ thành viên
   * @param {object} meta - Thông tin bổ sung (groupTitle, roomId...)
   */
  async startGroupCall(targetExtensions = [], meta = {}) {
    if (!targetExtensions || targetExtensions.length === 0) return { success: false, reason: 'EMPTY' }

    const myExt = this.getMyExtension()
    const cleanList = []
    for (const ext of targetExtensions) {
      const s = String(ext || '').trim()
      if (s && s !== myExt && !cleanList.includes(s)) {
        cleanList.push(s)
      }
    }

    if (cleanList.length === 0) {
      logger.warn('CALL', 'Danh sách máy lẻ hợp lệ để gọi nhóm rỗng.')
      return { success: false, reason: 'NO_VALID_TARGETS' }
    }

    if (cleanList.length === 1) {
      return this.validateAndMakeCall(cleanList[0], meta)
    }

    logger.info('CALL', `👥 Bắt đầu gọi nhóm (Ad-hoc) tới ${cleanList.length} thành viên: ${cleanList.join(', ')}`)

    // Thiết lập trạng thái Host & Group
    this.isGroupHost = true
    this.groupHostExtension = myExt
    this.isGroupCall = true
    this.activeAdhocConferenceId = ''
    this.extensionToWazoCallIdMap.clear()
    this.mergedCallIds.clear()
    this.secondaryCallSessions.clear()

    this.groupParticipantExtensions = [myExt, ...cleanList]

    const firstTarget = cleanList[0]
    const remainingTargets = cleanList.slice(1)

    // Khởi tạo cuộc gọi nhánh đầu tiên
    const callResult = await this.validateAndMakeCall(firstTarget, {
      ...meta,
      isGroupCall: true,
      isGroupHost: true,
      groupHostExtension: myExt,
      groupTitle: meta.groupTitle || `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`,
      groupParticipants: this.groupParticipantExtensions,
    })

    if (!callResult || !callResult.success) {
      this._resetGroupCallState()
      return callResult
    }

    // Đặt bộ đếm Timeout 30 giây cho nhánh chính đầu tiên
    this._startPrimaryLegTimeout(firstTarget)

    // Đánh dấu activeCall là groupCall
    if (callStore.activeCall) {
      callStore.activeCall.isGroupCall = true
      callStore.activeCall.isGroupHost = true
      callStore.activeCall.groupHostExtension = myExt
      callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
      callStore.activeCall.groupTitle = meta.groupTitle || `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
    }

    // Sau 700ms (khi nhánh đầu tiên đã sẵn sàng SDP), gọi các nhánh còn lại
    setTimeout(() => {
      if (this.hasActiveCall() && this.isGroupCall && remainingTargets.length > 0) {
        this.addParticipantsToGroupCall(remainingTargets)
      }
    }, 700)

    // Phát trạng thái nhóm lên Presence
    this.broadcastGroupStateViaPresence()

    return { success: true }
  }

  /**
   * Thêm các máy lẻ vào cuộc gọi nhóm đang diễn ra
   */
  async addParticipantsToGroupCall(extensions = []) {
    const myExt = this.getMyExtension()

    // VẤN ĐỀ 1 (Chuẩn Android): Nếu máy này KHÔNG phải là Chủ phòng (Host) -> Gửi lệnh ủy quyền về cho Chủ phòng
    if (!this.isGroupHost) {
      const hostExt = this.groupHostExtension || callStore.activeCall?.number
      if (hostExt && hostExt !== myExt) {
        this.delegateAddParticipantsToHost(hostExt, extensions)
        return
      }
    }

    const toInvite = []
    for (const ext of extensions) {
      const s = String(ext || '').trim()
      if (s && s !== myExt && !this.groupParticipantExtensions.includes(s)) {
        this.groupParticipantExtensions.push(s)
        toInvite.push(s)
      } else if (s && s !== myExt && !toInvite.includes(s)) {
        toInvite.push(s)
      }
    }

    if (toInvite.length === 0) return

    logger.info('CALL', `Mời thêm thành viên vào nhóm: ${toInvite.join(', ')}`)
    if (callStore.activeCall) {
      callStore.activeCall.isGroupCall = true
      callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
    }
    this.broadcastGroupStateViaPresence()

    // Khởi tạo các nhánh gọi tới từng máy lẻ qua WebRTC Phone mà không hold nhánh trước
    for (const ext of toInvite) {
      try {
        logger.info('CALL', `Đang gửi tín hiệu gọi nhánh thành viên: ${ext}...`)

        // Bảo vệ nhánh đầu tiên: tạm thời tách currentSipSession để Wazo.Phone không gửi lệnh hold sai quy cách lên nhánh đang đổ chuông
        const phoneInstance = Wazo.Phone?.phone
        const prevSipSession = phoneInstance?.currentSipSession
        const prevCallSession = phoneInstance?.currentCallSession
        if (phoneInstance && phoneInstance.currentSipSession) {
          phoneInstance.currentSipSession = null
        }

        const session = await Wazo.Phone.call(ext, false)

        if (phoneInstance && prevSipSession) {
          phoneInstance.currentSipSession = prevSipSession
          phoneInstance.currentCallSession = prevCallSession
        }

        if (session) {
          this.secondaryCallSessions.set(ext, session)
          this._startSecondaryLegTimeout(ext, session)
        }
      } catch (err) {
        logger.warn('CALL', `Không thể gọi nhánh ${ext}:`, err.message || err)
        this.broadcastNoticeToGroup(`Không thể kết nối máy lẻ ${ext}`)
      }
    }
  }

  /**
   * Bắt đầu bộ đếm Timeout 30 giây cho nhánh chính đầu tiên trong cuộc gọi nhóm
   */
  _startPrimaryLegTimeout(targetExt) {
    this._clearPrimaryLegTimeout()
    this._primaryInviteTimer = setTimeout(() => {
      this._cancelPrimaryLegOnTimeout(targetExt)
    }, 30000)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh chính [${targetExt}].`)
  }

  _clearPrimaryLegTimeout() {
    if (this._primaryInviteTimer) {
      clearTimeout(this._primaryInviteTimer)
      this._primaryInviteTimer = null
    }
  }

  _cancelPrimaryLegOnTimeout(targetExt) {
    this._clearPrimaryLegTimeout()
    if (this.isGroupCall && this.isGroupHost && callStore.activeCall && callStore.activeCall.status === 'ringing') {
      logger.warn('CALL', `Nhánh chính [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh chính.`)
      const session = this.currentCallSession
      if (session) {
        try {
          Wazo.Phone.hangup(session)
        } catch (e) {
          /* ignore */
        }
      }

      // Gỡ targetExt khỏi groupParticipantExtensions
      const myExt = this.getMyExtension()
      this.groupParticipantExtensions = this.groupParticipantExtensions.filter((e) => e !== targetExt)
      if (callStore.activeCall) {
        callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
        callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
      }
      this.broadcastGroupStateViaPresence()

      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: `⏱️ Máy lẻ [${targetExt}] không trả lời sau 30 giây.`, type: 'warning' },
        }),
      )
      this.broadcastNoticeToGroup(`Máy lẻ ${targetExt} không trả lời sau 30 giây`)

      // Nếu còn nhánh phụ đang hoạt động hoặc đang đổ chuông, chuyển nhánh phụ lên
      if (this.secondaryCallSessions.size > 0) {
        const [nextExt, nextSession] = this.secondaryCallSessions.entries().next().value
        logger.info('CALL', `Tự động chuyển nhánh [${nextExt}] lên làm nhánh chính tiếp tục cuộc gọi nhóm.`)
        this.secondaryCallSessions.delete(nextExt)
        this.currentCallSession = nextSession
        if (callStore.activeCall) {
          callStore.activeCall.number = nextExt
          callStore.activeCall.session = nextSession
        }
        this.broadcastGroupStateViaPresence()
      } else if (!this.isAnyParticipantConnected()) {
        logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: { message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.', type: 'warning' },
          }),
        )
        this.hangup()
      }
    }
  }

  /**
   * Kiểm tra an toàn xem có bất kỳ thành viên nào đang kết nối đàm thoại không
   */
  isAnyParticipantConnected() {
    if (!this.hasActiveCall()) return false
    const myExt = this.getMyExtension()
    const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)

    if (callStore.activeCall?.status === 'connected') {
      if (this.isGroupCall) {
        if (remainingOthers.length > 0 && (this.extensionToWazoCallIdMap.size > 0 || this.activeAdhocConferenceId || this.currentCallSession)) {
          return true
        }
      } else {
        return true
      }
    }

    if (this.extensionToWazoCallIdMap && this.extensionToWazoCallIdMap.size > 0) {
      return true
    }

    return false
  }

  /**
   * Bắt đầu bộ đếm Timeout 30 giây cho nhánh phụ mời thêm (Chuẩn Android WazoSipCallManager.java)
   */
  _startSecondaryLegTimeout(ext, session) {
    this._clearSecondaryLegTimeout(ext)
    const timer = setTimeout(() => {
      this._cancelSecondaryLegOnTimeout(ext)
    }, 30000)
    this._secondaryInviteTimers.set(ext, timer)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh phụ [${ext}].`)
  }

  _clearSecondaryLegTimeout(ext) {
    if (this._secondaryInviteTimers.has(ext)) {
      clearTimeout(this._secondaryInviteTimers.get(ext))
      this._secondaryInviteTimers.delete(ext)
    }
  }

  _clearAllSecondaryLegTimeouts() {
    for (const [ext, timer] of this._secondaryInviteTimers.entries()) {
      clearTimeout(timer)
    }
    this._secondaryInviteTimers.clear()
  }

  _cancelSecondaryLegOnTimeout(targetExt) {
    this._clearSecondaryLegTimeout(targetExt)
    const session = this.secondaryCallSessions.get(targetExt)
    if (session) {
      const sipId = session.sipCallId || (session.getId && session.getId()) || session.id
      if (sipId) {
        this._terminatingSecondarySipIds.add(String(sipId))
      }
      logger.warn('CALL', `Nhánh phụ [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh phụ.`)
      try {
        Wazo.Phone.hangup(session)
      } catch (e) {
        /* ignore */
      }
      // Không delete khỏi this.secondaryCallSessions ngay để _finalizeCallTermination nhận diện được nhánh phụ!
    }

    // Gỡ khỏi groupParticipantExtensions nếu chưa bao giờ kết nối
    const idx = this.groupParticipantExtensions.indexOf(targetExt)
    if (idx >= 0) {
      this.groupParticipantExtensions.splice(idx, 1)
      if (callStore.activeCall) {
        callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
        callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
      }
      this.broadcastGroupStateViaPresence()
    }

    // Phát thông báo UI cục bộ và phát thẻ NOTICE cho cả nhóm
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `⏱️ Máy lẻ [${targetExt}] không trả lời sau 30 giây.`, type: 'warning' },
      }),
    )
    this.broadcastNoticeToGroup(`Máy lẻ ${targetExt} không trả lời sau 30 giây`)

    // Kiểm tra: Nếu tất cả thành viên khác đều không nghe máy và không còn ai đang kết nối
    const myExt = this.getMyExtension()
    const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)
    if (remainingOthers.length === 0 && !this.isAnyParticipantConnected() && (!this.currentCallSession || callStore.activeCall?.status !== 'ringing')) {
      logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.', type: 'warning' },
        }),
      )
      this.hangup()
    }
  }

  /**
   * Thành viên ủy quyền cho Chủ phòng đứng ra quay số và gộp vào nhóm
   * Phát thẻ [ADD_REQ:reqId:hostExt:ext1,ext2] lên Presence
   */
  delegateAddParticipantsToHost(hostExt, targetExtensions) {
    if (!hostExt || !targetExtensions || targetExtensions.length === 0) return
    const myExt = this.getMyExtension()
    const toInviteNow = targetExtensions
      .map((e) => String(e).trim())
      .filter((e) => e && e !== myExt && e !== hostExt)
    if (toInviteNow.length === 0) return

    const reqId = Date.now()
    const reqTag = `[ADD_REQ:${reqId}:${hostExt}:${toInviteNow.join(',')}]`
    logger.info('CALL', `Máy thành viên ủy quyền cho Chủ phòng (${hostExt}) mời thêm: ${reqTag}`)
    this.setPresence('unavailable', `Đang bận ${reqTag}`)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `📤 Đã gửi yêu cầu thêm người tới Chủ phòng (${hostExt})`, type: 'info' },
      }),
    )
  }

  /**
   * Phát thông báo lỗi/bận cho toàn bộ thành viên trong nhóm
   * Thẻ: [NOTICE:noticeId:hostExt:message]
   */
  broadcastNoticeToGroup(message) {
    if (!this.isGroupCall || !this.isGroupHost) return
    const noticeId = Date.now()
    const myExt = this.getMyExtension()
    const noticeTag = `[NOTICE:${noticeId}:${myExt}:${message}]`
    this.setPresence('unavailable', `Đang gọi nhóm ${noticeTag}`)
  }

  /**
   * Đồng bộ các cuộc gọi active vào Ad-hoc Conference qua Wazo Calld REST API
   * Tích hợp Debounce 350ms & Mutex Lock triệt tiêu hoàn toàn Race Condition (HTTP 503)
   */
  syncActiveCallsToAdhocConference() {
    if (!this.hasActiveCall() || !this.isGroupCall || !this.isGroupHost) return

    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }

    this._syncAdhocDebounceTimer = setTimeout(async () => {
      this._syncAdhocDebounceTimer = null
      if (this._isSyncingAdhoc) return
      this._isSyncingAdhoc = true
      try {
        await this._doSyncActiveCallsToAdhocConference()
      } catch (err) {
        logger.warn('CALL', 'Lỗi trong quá trình đồng bộ Ad-hoc Conference:', err)
      } finally {
        this._isSyncingAdhoc = false
      }
    }, 350)
  }

  async _doSyncActiveCallsToAdhocConference() {
    if (!this.hasActiveCall() || !this.isGroupCall || !this.isGroupHost) return

    const activeCalls = await this.getMyActiveCalls()
    if (!activeCalls || activeCalls.length === 0) return

    // 1. Xác định hostCallId từ primary session của Host
    let hostCallId = ''
    const myPrimarySipId = this.currentCallSession?.sipCallId

    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      if (myPrimarySipId && sipId === myPrimarySipId) {
        hostCallId = cid
        break
      }
    }
    if (!hostCallId && activeCalls.length > 0) {
      hostCallId = activeCalls[0].id || activeCalls[0].call_id
    }
    if (!hostCallId) return

    // 2. Thu thập TẤT CẢ các peerCallId từ talking_to của các cuộc gọi
    // BÁM SÁT 100% Android WazoSipCallManager.py lines 748-755:
    // TUYỆT ĐỐI KHÔNG đưa cid (kênh WebRTC cục bộ của Host) vào participant_call_ids!
    let hasUnbridgedLeg = false
    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      const isTalking =
        callObj.status === 'talking' ||
        (callObj.talking_to && typeof callObj.talking_to === 'object' && Object.keys(callObj.talking_to).length > 0)

      if (callObj.talking_to && typeof callObj.talking_to === 'object') {
        for (const peerId of Object.keys(callObj.talking_to)) {
          if (peerId && peerId !== hostCallId) {
            let matchedExt = null
            for (const [ext, secSession] of this.secondaryCallSessions.entries()) {
              if (secSession.sipCallId === sipId) {
                matchedExt = ext
                break
              }
            }
            if (matchedExt) {
              this.extensionToWazoCallIdMap.set(matchedExt, peerId)
            } else if (callStore.activeCall?.number) {
              this.extensionToWazoCallIdMap.set(callStore.activeCall.number, peerId)
            }
          }
        }
      } else if (isTalking && cid !== hostCallId) {
        hasUnbridgedLeg = true
      }
    }

    // Nếu có nhánh phụ đã talking nhưng Asterisk chưa kịp link talking_to -> Hẹn giờ thử lại sau 300ms
    if (hasUnbridgedLeg && this.extensionToWazoCallIdMap.size < 2) {
      logger.info('CALL', 'Đang đợi máy chủ Asterisk điền talking_to cho nhánh phụ, sẽ thử lại sau 300ms...')
      setTimeout(() => {
        if (this.hasActiveCall() && this.isGroupCall && this.isGroupHost) {
          this.syncActiveCallsToAdhocConference()
        }
      }, 300)
    }

    // Hủy bộ đếm timeout 30s cho các nhánh đã kết nối thành công vào extensionToWazoCallIdMap
    for (const [secExt] of this.secondaryCallSessions.entries()) {
      if (this.extensionToWazoCallIdMap.has(secExt)) {
        this._clearSecondaryLegTimeout(secExt)
      }
    }

    const participantCallIds = Array.from(new Set(this.extensionToWazoCallIdMap.values())).filter(
      (id) => id && id !== hostCallId,
    )

    // Nếu chưa đủ 2 nhánh thành viên (chỉ có Host + 1 người nghe máy) và chưa có phòng họp nhóm:
    if (participantCallIds.length < 2 && !this.activeAdhocConferenceId) {
      logger.info(
        'CALL',
        `Chưa đủ 2 thành viên đàm thoại (hiện có ${participantCallIds.length} người nghe máy). Duy trì thoại trực tiếp và chờ người tiếp theo...`,
      )
      // Nếu nhánh chính vẫn đang ringing mà đã có 1 nhánh phụ talking -> Đưa âm thanh nhánh nghe máy lên đàm thoại ngay (Đối chiếu WazoSipCallManager.py line 1780)
      if (callStore.activeCall && callStore.activeCall.status === 'ringing' && participantCallIds.length === 1) {
        callStore.activeCall.status = 'connected'
        callStore.activeCall.startTime = Date.now()
        audioService.stopRingbackTone()
        for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
          try {
            const stream = Wazo.Phone.getRemoteStream(secSession)
            if (stream) {
              this.playRemoteStream(stream)
              logger.info('AUDIO', `Đã kết nối âm thanh với nhánh phụ nghe trước: ${secExt}`)
              break
            }
          } catch (e) {}
        }
      }
      return
    }

    logger.info(
      'CALL',
      `👥 Bắt đầu đồng bộ Ad-hoc Conference: Host=[${hostCallId}], Participants=[${participantCallIds.join(', ')}]`,
    )

    // Nếu đã có activeAdhocConferenceId: Thêm các participant chưa merge
    if (this.activeAdhocConferenceId) {
      for (const pId of participantCallIds) {
        if (!this.mergedCallIds.has(pId) && pId !== hostCallId) {
          this.mergedCallIds.add(pId)
          await this.addParticipantToAdhocConference(this.activeAdhocConferenceId, pId)
        }
      }
      return
    }

    // Chưa có conference_id: Tạo mới Ad-hoc Conference khi có ít nhất 2 thành viên
    const toMerge = participantCallIds.filter((id) => id !== hostCallId)
    if (toMerge.length >= 2 && hostCallId) {
      toMerge.forEach((id) => this.mergedCallIds.add(id))
      const confId = await this.createAdhocConference(hostCallId, toMerge)
      if (confId) {
        this.activeAdhocConferenceId = confId
        if (callStore.activeCall) {
          callStore.activeCall.activeAdhocConferenceId = confId
        }
        this.broadcastGroupStateViaPresence()
      } else {
        this.mergedCallIds.clear()
      }
    }
  }

  /**
   * Xử lý khi có thành viên rời phòng họp nhóm (Callee cúp máy hoặc nhận thẻ [LEFT:])
   * Cập nhật danh sách nhóm và nếu chỉ còn 1 người thì tự động kết thúc cuộc gọi
   */
  handleParticipantLeftGroupCall(leftCallIdOrExt) {
    if (!this.isGroupCall) return

    let leftExt = null
    const targetStr = String(leftCallIdOrExt).trim()

    // 1. Kiểm tra xem có khớp thẳng với extension không
    if (this.groupParticipantExtensions.includes(targetStr)) {
      leftExt = targetStr
    } else {
      // 2. Tìm trong extensionToWazoCallIdMap
      for (const [ext, cId] of this.extensionToWazoCallIdMap.entries()) {
        if (cId === targetStr) {
          leftExt = ext
          break
        }
      }
    }

    if (!leftExt) return

    const myExt = this.getMyExtension()
    // Tuyệt đối không tự xóa chính mình khỏi nhóm
    if (leftExt === myExt) return

    // Hủy timer timeout nếu còn
    this._clearSecondaryLegTimeout(leftExt)

    logger.info('CALL', `Thành viên [${leftExt}] đã rời cuộc gọi nhóm.`)
    const cId = this.extensionToWazoCallIdMap.get(leftExt)
    if (cId) this.mergedCallIds.delete(cId)
    this.extensionToWazoCallIdMap.delete(leftExt)
    this.secondaryCallSessions.delete(leftExt)

    this.groupParticipantExtensions = this.groupParticipantExtensions.filter((e) => e !== leftExt)
    if (callStore.activeCall) {
      callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
      callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
    }

    // Nếu máy này là thành viên và nhận tin Chủ phòng rời khỏi cuộc gọi -> kết thúc cuộc gọi
    if (!this.isGroupHost && leftExt === this.groupHostExtension) {
      logger.info('CALL', `Chủ phòng (${this.groupHostExtension}) đã kết thúc cuộc gọi -> Ngắt máy thành viên.`)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
        }),
      )
      this.hangup()
      return
    }

    if (this.isGroupHost) {
      this.broadcastGroupStateViaPresence()

      // Nếu trong nhóm chỉ còn lại đúng 1 người (chính là Host) và không còn nhánh phụ nào đang đổ chuông
      const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)
      if (remainingOthers.length === 0 && this.secondaryCallSessions.size === 0) {
        logger.info('CALL', 'Tất cả thành viên đã rời nhóm. Tự động kết thúc cuộc gọi.')
        this.hangup()
      }
    }

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `👋 Máy lẻ ${leftExt} đã rời cuộc gọi nhóm.`, type: 'info' },
      }),
    )
  }

  /**
   * Phát trạng thái Gọi nhóm lên Presence của Wazo Chatd
   * Thẻ: [GROUP:hostExt:ext1,ext2,ext3]
   */
  broadcastGroupStateViaPresence() {
    if (!this.isGroupCall) return
    const myExt = this.getMyExtension()
    const hostExt = this.groupHostExtension || myExt
    const exts = this.groupParticipantExtensions.length > 0 ? this.groupParticipantExtensions : [myExt]
    const groupTag = `[GROUP:${hostExt}:${exts.join(',')}]`
    this.setPresence('unavailable', `Đang gọi nhóm ${groupTag}`)
  }

  _resetGroupCallState() {
    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }
    this._clearAllSecondaryLegTimeouts()
    this._clearPrimaryLegTimeout()
    this._processedAddReqIds.clear()
    this._processedNoticeIds.clear()
    this._terminatingSecondarySipIds.clear()
    this._isSyncingAdhoc = false
    this.activeAdhocConferenceId = ''
    this.isGroupCall = false
    this.isGroupHost = false
    this.groupHostExtension = ''
    this.groupParticipantExtensions = []
    this.extensionToWazoCallIdMap.clear()
    this.mergedCallIds.clear()
    this.secondaryCallSessions.clear()
  }

  /**
   * Cập nhật trạng thái Presence người dùng lên máy chủ tổng đài
   * PUT /api/chatd/1.0/users/{user_uuid}/presences (theo OpenAPI spec Wazo Platform 26.10)
   * Chuẩn hóa luôn chứa hậu tố "-smartcall-web" để client Android nhận diện đăng xuất
   */
  async setPresence(state = 'available', statusText = '') {
    const token = this.getToken()
    if (!token) return false

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    const userUuid = this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || 'me'

    let baseStatus = statusText || (state === 'available' ? 'Sẵn sàng' : 'Bận')
    let finalStatus = baseStatus
    if (!finalStatus.includes('smartcall-web')) {
      finalStatus = this.myClientId
        ? `${finalStatus}-smartcall-web-${this.myClientId}`
        : `${finalStatus}-smartcall-web`
    } else if (this.myClientId && !finalStatus.includes(this.myClientId)) {
      finalStatus = `${finalStatus}-${this.myClientId}`
    }

    logger.info('API', `Cập nhật Presence: state=${state}, status=${finalStatus}`)
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
          status: finalStatus,
        }),
      })
      if (res.ok) {
        logger.success('API', `Đã đồng bộ Presence "${state}" lên máy chủ tổng đài`)
      }
      return res.ok
    } catch (err) {
      logger.warn('API', 'Không thể cập nhật presence lên máy chủ tổng đài:', err)
      return false
    }
  }
}

export const wazoService = new WazoService()
