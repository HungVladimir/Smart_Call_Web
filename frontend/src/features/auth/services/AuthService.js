import { mapUserProfile } from '../mappers/userProfile.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
  invalidateSession,
} from '../../../core/session/sessionScope.js'
import { callState } from '../../calls/state/callState.js'
import { userSessionState } from '../../../core/session/userSessionState.js'
import { logger } from '../../../core/logging/LoggerService.js'

/** Quản lý xác thực Wazo, hồ sơ và vòng đời token; điều phối cleanup qua các dependency. */
export class AuthService {
  constructor({ sdk, phoneAdapter }) {
    this.sdk = sdk
    this.phoneAdapter = phoneAdapter
    this.session = null
    this.sdkCleanupPromise = Promise.resolve()
    this.host =
      import.meta.env?.VITE_WAZO_HOST ||
      localStorage.getItem('smartcall_wazo_host') ||
      '107.126.11.126:9443'
    this.clientId = ''
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this.isSessionRevoked = false
    this.sessionHealthTimer = null
    this.isRefreshingToken = false
    this.refreshPromise = null
    this.refreshTokenRevoked = false
    this.getOrCreateBrowserClientId()
  }

  /** Gắn các dịch vụ cần cho vòng đời phiên tại điểm lắp ghép, tránh import vòng. */
  attachLifecycle({
    callController,
    eventConnection,
    contactService,
    chatService,
    historyService,
    recordingService,
  }) {
    Object.assign(this, {
      callController,
      eventConnection,
      contactService,
      chatService,
      historyService,
      recordingService,
    })
  }

  /** Trả URL gốc của tổng đài, bổ sung HTTPS khi cấu hình chỉ có host. */
  getHostUrl() {
    return this.host.startsWith('http') ? this.host : `https://${this.host}`
  }

  /** Lấy hoặc tạo mã client riêng cho tab để nhận diện phiên Web. */
  getOrCreateBrowserClientId() {
    let storedClientId = ''
    try {
      storedClientId = sessionStorage.getItem('smartcall_tab_client_id') || ''
    } catch (e) {}
    if (!storedClientId) {
      const rand =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10)
      storedClientId = `web_${rand}`
      try {
        sessionStorage.setItem('smartcall_tab_client_id', storedClientId)
      } catch (e) {}
    }
    this.clientId = storedClientId
    return storedClientId
  }

  /** Cấu hình SDK bằng host và client ID trước khi đăng nhập hoặc khôi phục. */
  initializeAuthentication() {
    const cleanHost = (this.host || '107.126.11.126:9443')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    const cId = this.getOrCreateBrowserClientId()
    this.sdk.Auth.init(cId)
    this.sdk.Auth.setClientId(cId)
    this.sdk.Auth.setHost(cleanHost)
    this.phoneAdapter.disableSdkAutomaticHold()
    logger.info('AUTH', `Khởi tạo Wazo Auth SDK với host: ${cleanHost}, clientId: ${cId}`)
  }

  /** Đăng nhập và chỉ công bố kết quả nếu request còn thuộc phiên hiện tại. */
  async login(username, password) {
    const cleanup = this.logout()
    const loginContext = captureSessionContext()
    await cleanup
    assertSessionContext(loginContext)
    this.initializeAuthentication()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
      const authenticatedSession = await this.authenticateCredentials(username, password)
      assertSessionContext(loginContext)
      if (!authenticatedSession?.token)
        throw new Error('Máy chủ chưa trả về phiên xác thực hợp lệ.')
      this.session = authenticatedSession
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
          userSessionState.userUuid = this.session.uuid
        }
        let exten = ''
        try {
          exten = this.session.primaryNumber?.() || ''
        } catch (e) {}
        if (exten) {
          localStorage.setItem('smartcall_user_exten', exten)
          localStorage.setItem('smartcall_extension', exten)
          userSessionState.extension = exten
        }
        if (this.session.profile?.department) {
          const dept = this.session.profile.department
          localStorage.setItem('smartcall_department', dept)
          localStorage.setItem('smartcall_user_department', dept)
          userSessionState.department = dept
        }
        userSessionState.displayName = this.getCurrentDisplayName()
        await this.synchronizeUserProfile(this.session, username)
        this.historyService.reload()
        logger.success('AUTH', `Đăng nhập Wazo thành công! UUID: ${this.session.uuid || 'N/A'}`)

        // Thu hồi session cũ và refresh token của các thiết bị khác theo chuẩn mã nguồn tham chiếu mẫu
        // Chốt chặn an toàn: Chỉ thực hiện khi có đầy đủ sessionUuid và clientId hợp lệ
        if (this.session.uuid && this.currentSessionUuid && this.clientId) {
          this.revokeOtherDeviceSessions(
            this.session.uuid,
            this.currentSessionUuid,
            this.clientId,
          ).catch((err) => {
            logger.warn('AUTH', 'Lỗi khi thu hồi phiên thiết bị khác:', err.message)
          })
        } else {
          logger.warn(
            'AUTH',
            'Chốt chặn an toàn: Bỏ qua thu hồi phiên khác do thiếu sessionUuid hoặc clientId hợp lệ.',
          )
        }
      }

      const authenticatedContext = captureSessionContext()
      this.eventConnection.connect()

      // Tự động kết nối WebRTC Phone sau khi login thành công
      try {
        await this.callController.connect()
      } catch (phoneErr) {
        logger.warn(
          'SIP',
          'Kết nối WebRTC Phone cảnh báo (vẫn duy trì phiên login)',
          phoneErr.message,
        )
      }
      assertSessionContext(authenticatedContext)

      // Tự động đồng bộ trạng thái Trực tuyến kèm Session ID lên máy chủ Chatd
      this.mySessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
      try {
        sessionStorage.setItem('smartcall_session_id', this.mySessionId)
      } catch (e) {}
      this.isSessionRevoked = false
      try {
        await this.updatePresence('available', this.mySessionId)
      } catch (presErr) {
        /* ignore */
      }
      assertSessionContext(authenticatedContext)
      this.startSessionHealthCheck()

      return this.session
    } catch (error) {
      logger.error('AUTH', `Đăng nhập thất bại: ${error.message || error}`, error)
      throw error
    }
  }

  /** Khôi phục token đã lưu; phản hồi muộn không được ghi đè phiên mới. */
  async restoreSession() {
    const restoreContext = captureSessionContext()
    this.initializeAuthentication()
    const token = localStorage.getItem('smartcall_wazo_token')
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        const restoredSession = await this.waitForAuthentication(
          this.sdk.Auth.validateToken(token, refreshToken),
        ).catch(() => null)
        assertSessionContext(restoreContext)
        this.session = restoredSession

        // Nếu token 1 giờ đã hết hạn tự nhiên trong lúc đóng tab/trình duyệt, tự động cứu phiên bằng Refresh Token
        if (!this.session && refreshToken) {
          logger.info(
            'AUTH',
            'Auth Token cũ đã hết hạn (1 giờ), đang tự động khôi phục phiên bằng Refresh Token...',
          )
          const refreshed = await this.refreshAccessToken()
          assertSessionContext(restoreContext)
          if (refreshed) {
            const newToken = this.getToken()
            const refreshedSession = await this.waitForAuthentication(
              this.sdk.Auth.validateToken(newToken, refreshToken),
            ).catch(() => null)
            assertSessionContext(restoreContext)
            this.session = refreshedSession
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
          this.currentSessionUuid =
            this.session.sessionUuid || localStorage.getItem('smartcall_session_uuid') || ''
          if (this.currentSessionUuid) {
            localStorage.setItem('smartcall_session_uuid', this.currentSessionUuid)
          }
          if (this.session.uuid) {
            localStorage.setItem('smartcall_user_uuid', this.session.uuid)
            userSessionState.userUuid = this.session.uuid
          }
          let exten = ''
          try {
            exten = this.session.primaryNumber?.() || ''
          } catch (e) {}
          if (exten) {
            localStorage.setItem('smartcall_user_exten', exten)
            localStorage.setItem('smartcall_extension', exten)
            userSessionState.extension = exten
          }
          if (this.session.profile?.department) {
            const dept = this.session.profile.department
            localStorage.setItem('smartcall_department', dept)
            localStorage.setItem('smartcall_user_department', dept)
            userSessionState.department = dept
          }
          userSessionState.displayName = this.getCurrentDisplayName()
          await this.synchronizeUserProfile(this.session, this.getCurrentDisplayName())
          this.historyService.reload()
          logger.success('AUTH', 'Đã khôi phục phiên đăng nhập Wazo từ Token thành công!')
          this.eventConnection.connect()
          try {
            await this.callController.connect()
          } catch (phoneErr) {
            logger.warn('SIP', 'Khôi phục WebRTC phone cảnh báo', phoneErr.message)
          }
          const connectedContext = captureSessionContext()
          if (connectedContext.epoch !== restoreContext.epoch)
            throw new Error('Phiên khôi phục đã kết thúc.')
          this.mySessionId =
            sessionStorage.getItem('smartcall_session_id') ||
            'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
          try {
            sessionStorage.setItem('smartcall_session_id', this.mySessionId)
          } catch (e) {}
          this.isSessionRevoked = false
          try {
            await this.updatePresence('available', this.mySessionId)
          } catch (presErr) {
            /* ignore */
          }
          assertSessionContext(connectedContext)
          this.startSessionHealthCheck()
          return true
        }
      } catch (e) {
        logger.warn('AUTH', 'Không thể khôi phục phiên Wazo từ Token cũ', e.message)
      }
    }
    // Không giữ token bị từ chối làm bằng chứng đăng nhập. Phản hồi phiên cũ không được logout phiên mới.
    if (captureSessionContext().epoch === restoreContext.epoch) this.logout()
    return false
  }

  /** Kết thúc phiên, ngắt kết nối và yêu cầu các dịch vụ dọn state. */
  logout() {
    invalidateSession()
    this.isRefreshingToken = false
    this.refreshPromise = null
    logger.clearLogs()
    this.recordingService.clearSessionCache()
    logger.info('AUTH', 'Thực hiện đăng xuất khỏi hệ thống Wazo...')
    try {
      this.updatePresence('unavailable', 'Ngoại tuyến')
    } catch (e) {
      /* ignore */
    }
    this.callController.finalizeCallTermination('ended')
    this.eventConnection.disconnect()
    const previousSession = this.session
    this.session = null
    // SDK logout có thể xóa token toàn cục sau await. Login mới phải đợi cleanup hoàn tất.
    this.sdkCleanupPromise = this.sdkCleanupPromise
      .then(() => (previousSession ? this.sdk.Auth.logout() : undefined))
      .catch((error) => logger.warn('AUTH', 'SDK chưa hoàn tất logout từ xa:', error.message))
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
      sessionStorage.removeItem('smartcall_tab_client_id')
      sessionStorage.removeItem('smartcall_session_id')
    } catch (e) {}
    this.clientId = ''

    // Xóa tất cả các cache phòng chat cục bộ để không rò rỉ sang tài khoản khác
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('smartcall_chat_rooms_')) {
          localStorage.removeItem(k)
        }
      })
    } catch (e) {}
    this.stopSessionHealthCheck()
    try {
      localStorage.removeItem('smartcall_session_id')
    } catch (e) {}
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this.isSessionRevoked = false

    // BUG-06 & BUG-07: Dọn dẹp phòng vệ Wazo.Phone event listeners và ngắt kết nối SIP Phone
    try {
      this.callController.detachPhoneListeners()
      this.callController.disconnect()
    } catch (e) {
      logger.warn('SIP', 'Lỗi khi dọn dẹp Phone trong logout:', e)
    } finally {
      this.callController.listenersAttached = false
    }

    callState.isRegistered = false
    userSessionState.extension = ''
    userSessionState.userUuid = ''
    userSessionState.displayName = ''
    userSessionState.department = ''
    callState.activeCall = null
    callState.incomingCall = null
    this.contactService.reset()
    this.chatService.reset()
    this.historyService.reset()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
    return this.sdkCleanupPromise
  }

  /** Kiểm tra sự tồn tại token; không đồng nghĩa SIP đã đăng ký thành công. */
  isAuthenticated() {
    return Boolean(this.session?.token || localStorage.getItem('smartcall_wazo_token'))
  }

  /** Lấy access token của phiên hiện tại để gọi Wazo API. */
  getToken() {
    return this.session?.token || localStorage.getItem('smartcall_wazo_token') || ''
  }

  /** Lấy máy lẻ từ hồ sơ SDK hoặc thông tin phiên đã khôi phục. */
  getCurrentExtension() {
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

  /** Trả UUID người dùng hiện tại để xác định chủ sở hữu dữ liệu. */
  getCurrentUserUuid() {
    return this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || ''
  }

  /** Thu hồi phiên cục bộ và thông báo giao diện khi máy chủ xác nhận token bị hủy. */
  handleSessionRevocation() {
    if (!this.isAuthenticated() || this.isSessionRevoked) return
    this.isSessionRevoked = true
    logger.warn('AUTH', 'Phiên làm việc bị hủy hoặc tài khoản đăng nhập nơi khác.')
    this.stopSessionHealthCheck()
    this.callController.finalizeCallTermination('ended')
    this.callController.disconnect()
    if (this.eventConnection.socket) {
      try {
        this.eventConnection.socket.close()
      } catch (e) {}
      this.eventConnection.socket = null
    }
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  /** Thu hồi các phiên thiết bị khác theo cơ chế Wazo hiện hành. */
  async revokeOtherDeviceSessions(userUuid, currentSessionUuid, currentClientId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    if (!token || !userUuid) return

    // Chốt chặn an toàn: Bắt buộc phải có currentSessionUuid và currentClientId hợp lệ để tránh tự xóa phiên của chính mình
    if (!currentSessionUuid || !currentClientId) {
      logger.warn(
        'AUTH',
        'Chốt chặn an toàn: Bỏ qua revokeOtherDevices do thiếu sessionUuid hoặc clientId hợp lệ.',
      )
      return
    }

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`

    // 1. Xóa toàn bộ Session cũ (làm token hiện tại của máy khác bị vô hiệu hóa 401 ngay lập tức)
    try {
      logger.info(
        'AUTH',
        `[Bước 1/2] Thu hồi các sessions cũ của user [${userUuid}] (loại trừ session: ${currentSessionUuid})...`,
      )
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
              const delRes = await fetch(
                `${host}/api/auth/0.1/users/${userUuid}/sessions/${sUuid}`,
                {
                  method: 'DELETE',
                  headers: {
                    'X-Auth-Token': token,
                    Accept: 'application/json',
                  },
                  signal: AbortSignal.timeout(4000),
                },
              )
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
      logger.info(
        'AUTH',
        `[Bước 2/2] Thu hồi các refresh tokens cũ của user [${userUuid}] (loại trừ clientId: ${currentClientId})...`,
      )
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
              const delRes = await fetch(
                `${host}/api/auth/0.1/users/${userUuid}/tokens/${encodeURIComponent(cId)}`,
                {
                  method: 'DELETE',
                  headers: {
                    'X-Auth-Token': token,
                    Accept: 'application/json',
                  },
                  signal: AbortSignal.timeout(4000),
                },
              )
              logger.info(
                'AUTH',
                `Đã xóa refresh_token của client cũ: ${cId} -> Status: ${delRes.status}`,
              )
            } catch (delErr) {
              logger.warn('AUTH', `Lỗi khi xóa refresh_token của client ${cId}:`, delErr.message)
            }
          }
        }
      } else {
        logger.warn(
          'AUTH',
          `Không thể lấy danh sách refresh tokens từ Wazo Auth (${resTokens.status})`,
        )
      }
    } catch (err) {
      logger.warn('AUTH', `Lỗi trong quá trình thu hồi refresh tokens cũ:`, err.message)
    }
  }

  /** Bắt đầu kiểm tra định kỳ tính hợp lệ của phiên; chỉ có một timer. */
  startSessionHealthCheck() {
    this.stopSessionHealthCheck()
    this.sessionHealthTimer = setInterval(async () => {
      if (this.isAuthenticated() && !this.isSessionRevoked) {
        const isHealthy = await this.verifySessionHealth()
        if (!isHealthy && this.refreshTokenRevoked) {
          logger.warn(
            'AUTH',
            'Token và Refresh Token không còn hợp lệ trên Wazo Auth, phiên đã kết thúc!',
          )
          this.handleSessionRevocation()
        }
      }
    }, 5000)
  }

  /** Dừng kiểm tra phiên khi logout hoặc bị thu hồi quyền truy cập. */
  stopSessionHealthCheck() {
    if (this.sessionHealthTimer) {
      clearInterval(this.sessionHealthTimer)
      this.sessionHealthTimer = null
    }
  }

  /** Làm mới token với một request dùng chung; không ghi kết quả của phiên cũ. */
  async refreshAccessToken() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (this.isRefreshingToken) return this.refreshPromise
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (!refreshToken) {
      logger.warn('AUTH', 'Không tìm thấy refresh_token trong localStorage để làm mới phiên.')
      this.refreshTokenRevoked = true
      return false
    }

    const clientId =
      this.clientId ||
      this.clientId ||
      localStorage.getItem('smartcall_device_client_id') ||
      'web_client'
    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`

    this.isRefreshingToken = true
    this.refreshPromise = (async () => {
      try {
        logger.info(
          'AUTH',
          `🔄 Đang gửi yêu cầu làm mới Auth Token tới Wazo Auth (client_id: ${clientId})...`,
        )

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
              this.sdk.Auth.setApiToken(newToken)
              this.sdk.Auth.setToken?.(newToken)
            } catch (e) {}

            this.refreshTokenRevoked = false
            logger.success(
              'AUTH',
              '🎉 Đã làm mới Auth Token thành công! Phiên làm việc được duy trì liên tục.',
            )
            return true
          }
        } else if (res.status === 401 || res.status === 404 || res.status === 400) {
          logger.warn(
            'AUTH',
            `Refresh token đã bị thu hồi hoặc không hợp lệ trên máy chủ (HTTP ${res.status}).`,
          )
          this.refreshTokenRevoked = true
          return false
        } else {
          logger.warn(
            'AUTH',
            `Không thể làm mới token do lỗi máy chủ tạm thời (HTTP ${res.status}).`,
          )
          this.refreshTokenRevoked = false
          return false
        }
      } catch (err) {
        logger.warn('AUTH', 'Lỗi mạng khi làm mới Auth Token qua Refresh Token:', err.message)
        if (isSessionContextCurrent(sessionContext)) this.refreshTokenRevoked = false
        return false
      } finally {
        if (isSessionContextCurrent(sessionContext)) {
          this.isRefreshingToken = false
          this.refreshPromise = null
        }
      }
      return false
    })()

    return this.refreshPromise
  }

  /** Kiểm chứng token với máy chủ và thử làm mới khi cần. */
  async verifySessionHealth(forceRefresh = false) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    this.refreshTokenRevoked = false
    const token = this.getToken()
    if (!token) return false

    if (forceRefresh) {
      const refreshed = await this.refreshAccessToken()
      if (refreshed) return true
      if (this.refreshTokenRevoked) return false
      return true // Lỗi mạng tạm thời, không kick nhầm
    }

    try {
      const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
      const res = await fetch(`${host}/api/auth/0.1/token/${token}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3500),
      })
      if (res.status === 401 || res.status === 404) {
        logger.info(
          'AUTH',
          'Token hết hạn trên máy chủ xác thực (401/404), đang kích hoạt làm mới tự động...',
        )
        const refreshed = await this.refreshAccessToken()
        if (refreshed) {
          return true
        }
        if (this.refreshTokenRevoked) {
          return false
        }
        return true // Lỗi mạng tạm thời, không kick nhầm
      }
      return true
    } catch (e) {
      return true // Lỗi mạng tạm thời, không kick nhầm
    }
  }

  /** Gửi yêu cầu đổi mật khẩu; chỉ báo thành công khi API xác nhận. */
  async changePassword(oldPassword, newPassword) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    if (!token) throw new Error('Chưa đăng nhập hoặc phiên làm việc đã hết hạn.')
    let userUuid = this.getCurrentUserUuid()
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
            userSessionState.userUuid = meData.uuid
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

  /** Yêu cầu tổng đài gửi email đặt lại mật khẩu cho tài khoản được nhập. */
  async resetPassword(identifier) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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

  /** Lấy tên hiển thị từ hồ sơ SDK hoặc dữ liệu nhận diện đã xác nhận. */
  getCurrentDisplayName() {
    try {
      if (this.session?.profile?.firstName) {
        return `${this.session.profile.firstName} ${this.session.profile.lastName || ''}`.trim()
      }
    } catch (e) {}
    return localStorage.getItem('smartcall_username') || 'Người dùng'
  }

  /** Gửi presence theo contract Wazo, giữ metadata nhận diện client Web. */
  async updatePresence(state = 'available', statusText = '') {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    if (!token) return false

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    const userUuid = this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || 'me'

    let baseStatus = statusText || (state === 'available' ? 'Sẵn sàng' : 'Bận')
    let finalStatus = baseStatus
    if (!finalStatus.includes('smartcall-web')) {
      finalStatus = this.clientId
        ? `${finalStatus}-smartcall-web-${this.clientId}`
        : `${finalStatus}-smartcall-web`
    } else if (this.clientId && !finalStatus.includes(this.clientId)) {
      finalStatus = `${finalStatus}-${this.clientId}`
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
  /** SDK không hỗ trợ abort đăng nhập: giới hạn chờ và bỏ mọi kết quả trả về sau timeout. */
  authenticateCredentials(username, password) {
    return this.waitForAuthentication(this.sdk.Auth.logIn(username, password))
  }

  /** Giới hạn thời gian chờ SDK khi đăng nhập hoặc xác minh token đã lưu. */
  async waitForAuthentication(request) {
    let timer
    try {
      return await Promise.race([
        request,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Đăng nhập quá thời gian chờ. Vui lòng thử lại.')),
            15000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Hoàn thiện và commit hồ sơ ở tầng auth; LoginView không tự gọi Confd. */
  async synchronizeUserProfile(session, username = '') {
    const context = captureSessionContext(),
      request = createSessionFetch(context)
    let confdUser = {}
    try {
      const response = await request(this.getHostUrl() + '/api/confd/1.1/users/me', {
        headers: { 'X-Auth-Token': this.getToken() },
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) confdUser = await response.json()
    } catch (error) {
      if (!isSessionContextCurrent(context)) throw error
      logger.warn('AUTH', 'Chưa lấy được hồ sơ mở rộng; dùng hồ sơ SDK.')
    }
    assertSessionContext(context)
    const profile = mapUserProfile(session, confdUser, username)
    Object.assign(userSessionState, profile)
    localStorage.setItem('smartcall_user_uuid', profile.userUuid)
    localStorage.setItem('smartcall_extension', profile.extension)
    localStorage.setItem('smartcall_user_exten', profile.extension)
    localStorage.setItem('smartcall_username', profile.displayName)
    localStorage.setItem('smartcall_department', profile.department)
    localStorage.setItem('smartcall_user_department', profile.department)
    return profile
  }
}
