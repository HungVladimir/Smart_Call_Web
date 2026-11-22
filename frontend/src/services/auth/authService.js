import { requestSingleId } from './singleIdApi.js'
import { getSdkAuthenticationGate } from './sdkAuthenticationGate.js'
import { mapUserProfile } from '../../utils/userProfile.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
  createSessionFetch,
  invalidateSession,
} from './sessionScope.js'
import { callState } from '../../state/callState.js'
import { userSessionState } from '../../state/sessionState.js'
import { logger } from '../common/loggerService.js'

/** Quản lý xác thực Wazo, hồ sơ và vòng đời token; điều phối cleanup qua các dependency. */
export class AuthService {
  /**
   * Giữ SDK và dependency xác thực, chuẩn bị trạng thái session/refresh/heartbeat và thông tin
   * client của tab.
   */
  constructor({ sdk, phoneAdapter }) {
    this.sdk = sdk
    this.sdkAuthentication = getSdkAuthenticationGate(sdk.Auth)
    this.phoneAdapter = phoneAdapter
    this.singleIdProfile = null
    this.singleIdCsrf = ''
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
    callService,
    eventConnection,
    contactService,
    chatService,
    historyService,
    recordingService,
  }) {
    Object.assign(this, {
      callService,
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
    this.sdkAuthentication.assertCanAuthenticate()
    this.logout()
    const loginContext = captureSessionContext()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
      const authenticatedSession = await this.authenticateCredentials(
        username,
        password,
        loginContext,
      )
      return await this.completeAuthenticatedSession(authenticatedSession, username, loginContext)
    } catch (error) {
      logger.error('AUTH', `Đăng nhập thất bại: ${error.message || error}`, error)
      throw error
    }
  }

  /** Dùng chung bước gắn session, profile, WebSocket và SIP cho mật khẩu và Single ID. */
  async completeAuthenticatedSession(authenticatedSession, username, context) {
    assertSessionContext(context)
    if (!authenticatedSession?.token) throw new Error('Máy chủ chưa trả về phiên xác thực hợp lệ.')
    this.session = authenticatedSession
    localStorage.setItem('smartcall_login_username', username)
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

      // Thu hồi phiên và refresh token cũ để giữ một phiên đang hoạt động.
      // mẫu
      // Chốt chặn an toàn: Chỉ thực hiện khi có đầy đủ sessionUuid và clientId hợp lệ
      if (this.session.uuid && this.currentSessionUuid && this.clientId) {
        await this.revokeOtherDeviceSessions(
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

    // Không để login đã bị hủy kết nối SIP sau khi chờ cleanup các phiên cũ.
    assertSessionContext({ epoch: context.epoch, userUuid: this.session?.uuid || '' })
    const authenticatedContext = captureSessionContext()
    this.eventConnection.connect()

    // Tự động kết nối WebRTC Phone sau khi login thành công
    try {
      await this.callService.connect()
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
  }

  /** Bắt đầu đăng nhập bằng điều hướng cửa sổ, không dùng fetch để mở trang IdP. */
  beginSingleIdLogin() {
    window.location.assign('/api/auth/login')
  }

  /** Lấy hồ sơ đã xác minh và CSRF token; không nhận token IdP trên trình duyệt. */
  async getSingleIdProfile(expectedUserUuid = '') {
    const data = await requestSingleId('user_info')
    this.singleIdProfile =
      !expectedUserUuid || data.wazo_user_uuid === expectedUserUuid ? data.profile : null
    this.singleIdCsrf = data.csrf_token
    return data
  }

  /** Đăng xuất cả IdP bằng điều hướng cửa sổ để có thể nhập tài khoản khác. */
  async logoutSingleId() {
    const csrf = this.singleIdCsrf || (await requestSingleId('user_info')).csrf_token
    const data = await requestSingleId('idp-logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrf },
    })
    if (data.redirect_url !== '/api/auth/idp-logout/continue')
      throw new Error('Đường dẫn logout không hợp lệ.')
    await this.logout({ preserveSingleId: true })
    window.location.assign(data.redirect_url)
  }

  /** Hủy phiên backend có cookie/CSRF; gọi trước khi dọn scope của Web. */
  async endSingleIdSession() {
    let csrf = this.singleIdCsrf
    const profile = this.singleIdProfile
    if (!csrf) csrf = (await requestSingleId('user_info', {}, null)).csrf_token
    await requestSingleId('logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }, null)
    if (this.singleIdProfile === profile) {
      this.singleIdCsrf = ''
      this.singleIdProfile = null
    }
  }

  /** Hủy giao dịch đang chờ khi rời callback; thu hồi cookie backend và vô hiệu scope SDK. */
  cancelSingleIdLogin() {
    this.endSingleIdSession().catch(() => {})
    this.logout({ preserveSingleId: true })
  }

  /** Xin token user từ backend và xác minh SDK trước khi dùng chung luồng hoàn tất đăng nhập. */
  async completeSingleIdLogin(csrfToken) {
    this.sdkAuthentication.assertCanAuthenticate()
    const profile = this.singleIdProfile
    const cleanup = this.logout({ preserveSingleId: true })
    const context = captureSessionContext()
    await cleanup
    assertSessionContext(context)
    this.singleIdProfile = profile
    this.singleIdCsrf = csrfToken
    try {
      const data = await requestSingleId(
        'wazo-session',
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ client_id: this.getOrCreateBrowserClientId() }),
        },
        context,
      )
      assertSessionContext(context)
      if (!data.token || !data.user_uuid || !String(data.host || '').startsWith('https://'))
        throw new Error('Backend chưa trả phiên Wazo hợp lệ.')
      this.singleIdProfile = data.profile || profile
      this.host = data.host
      const session = await this.validateSdkSession(data.token, data.refresh_token, context)
      assertSessionContext(context)
      if (!session || session.uuid !== data.user_uuid)
        throw new Error('Danh tính phiên SDK không khớp tài khoản Wazo được liên kết.')
      localStorage.setItem('smartcall_wazo_host', data.host)
      localStorage.setItem('smartcall_auth_method', 'singleid')
      return await this.completeAuthenticatedSession(session, data.username, context)
    } catch (error) {
      if (captureSessionContext().epoch === context.epoch) this.logout({ preserveSingleId: true })
      throw error
    }
  }

  /** Khôi phục token đã lưu; phản hồi muộn không được ghi đè phiên mới. */
  async restoreSession() {
    const restoreContext = captureSessionContext()
    const token = localStorage.getItem('smartcall_wazo_token')
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        const restoredSession = await this.validateSdkSession(token, refreshToken, restoreContext)
        assertSessionContext(restoreContext)
        this.session = restoredSession

        // Nếu token 1 giờ đã hết hạn tự nhiên trong lúc đóng tab/trình duyệt, tự động cứu phiên
        // bằng Refresh Token
        if (!this.session && refreshToken) {
          logger.info(
            'AUTH',
            'Auth Token cũ đã hết hạn (1 giờ), đang tự động khôi phục phiên bằng Refresh Token...',
          )
          const refreshed = await this.refreshAccessToken()
          assertSessionContext(restoreContext)
          if (refreshed) {
            const newToken = this.getToken()
            const refreshedSession = await this.validateSdkSession(
              newToken,
              refreshToken,
              restoreContext,
            )
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
          if (localStorage.getItem('smartcall_auth_method') === 'singleid') {
            try {
              await this.getSingleIdProfile(this.session.uuid)
            } catch {
              /* Phiên Wazo độc lập vẫn được SDK xác minh. */
            }
            assertSessionContext(restoreContext)
          }
          await this.synchronizeUserProfile(this.session, this.getCurrentDisplayName())
          this.historyService.reload()
          logger.success('AUTH', 'Đã khôi phục phiên đăng nhập Wazo từ Token thành công!')
          this.eventConnection.connect()
          try {
            await this.callService.connect()
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
    // Không giữ token bị từ chối làm bằng chứng đăng nhập. Phản hồi phiên cũ không được logout
    // phiên mới.
    if (captureSessionContext().epoch === restoreContext.epoch) this.logout()
    return false
  }

  /** Kết thúc phiên, ngắt kết nối và yêu cầu các dịch vụ dọn state. */
  logout({ revoked = false, preserveSingleId = false } = {}) {
    if (!preserveSingleId && localStorage.getItem('smartcall_auth_method') === 'singleid') {
      this.endSingleIdSession().catch(() => {})
    }
    // Snapshot chỉ dùng để kết thúc tài nguyên cũ, không tái công bố trạng thái đã đăng xuất.
    const group = this.callService.groupCallService.state
    const cleanupSnapshot =
      group.isGroupCall && group.isGroupHost
        ? {
            token: this.session?.token || '',
            host: this.getHostUrl(),
            conferenceId: group.activeAdhocConferenceId,
            callIds: [...group.extensionToWazoCallIdMap.values()],
          }
        : null
    const primarySession = this.callService.currentCallSession || callState.activeCall?.session
    const previousSession = this.session
    const sdkNeedsCleanup =
      Boolean(previousSession) || this.sdkAuthentication.isAuthenticationPending
    this.isSessionRevoked = revoked
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
    if (cleanupSnapshot)
      this.callService.callControlApi.cleanupSessionCalls(cleanupSnapshot).then((ok) => {
        if (!ok)
          logger.warn(
            'CALL',
            'Cleanup phiên cũ chưa được server xác nhận; phiên mới cần dọn bằng token hợp lệ.',
          )
      })
    if (primarySession) {
      try {
        Promise.resolve(this.sdk.Phone.hangup(primarySession)).catch(() => {})
      } catch {
        /* SDK đã ngắt. */
      }
    }
    this.callService.finalizeCallTermination('ended', null, true, false)
    this.eventConnection.disconnect()
    this.singleIdProfile = null
    this.singleIdCsrf = ''
    this.session = null
    // Xếp cleanup sau request xác thực còn chạy, trước mọi lần initialize/logIn tiếp theo.
    this.sdkCleanupPromise = this.sdkAuthentication
      .logout(sdkNeedsCleanup)
      .catch((error) => logger.warn('AUTH', 'SDK chưa hoàn tất logout từ xa:', error.message))
    // Xóa dữ liệu phiên đã lưu để lượt đăng nhập kế tiếp bắt đầu sạch.
    const sessionKeys = [
      'smartcall_auth_method',
      'smartcall_wazo_token',
      'smartcall_wazo_refreshToken',
      'smartcall_user_uuid',
      'smartcall_user_exten',
      'smartcall_sip_user',
      'smartcall_extension',
      'smartcall_username',
      'smartcall_login_username',
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
    this.isSessionRevoked = revoked

    // BUG-06 & BUG-07: Dọn dẹp phòng vệ Wazo.Phone event listeners và ngắt kết nối SIP Phone
    try {
      this.callService.detachPhoneListeners()
      this.callService.disconnect()
    } catch (e) {
      logger.warn('SIP', 'Lỗi khi dọn dẹp Phone trong logout:', e)
    } finally {
      this.callService.listenersAttached = false
    }

    callState.isRegistered = false
    userSessionState.extension = ''
    userSessionState.userUuid = ''
    userSessionState.displayName = ''
    userSessionState.department = ''
    callState.activeCall = null
    callState.incomingCall = null
    callState.callNotice = null
    this.contactService.reset()
    this.chatService.reset()
    this.historyService.reset()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
    return this.sdkCleanupPromise
  }

  /** Kiểm tra sự tồn tại token; không đồng nghĩa SIP đã đăng ký thành công. */
  isAuthenticated() {
    return (
      !this.isSessionRevoked &&
      Boolean(this.session?.token || localStorage.getItem('smartcall_wazo_token'))
    )
  }

  /** Lấy access token của phiên hiện tại để gọi Wazo API. */
  getToken() {
    if (this.isSessionRevoked) return ''
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
    this.logout({ revoked: true })
    logger.warn('AUTH', 'Phiên đã bị thu hồi; token, tác vụ và cache đã được vô hiệu hóa.')
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  /** Thu hồi các phiên thiết bị khác theo cơ chế Wazo hiện hành. */
  async revokeOtherDeviceSessions(userUuid, currentSessionUuid, currentClientId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    if (!token || !userUuid) return

    // Chốt chặn an toàn: Bắt buộc phải có currentSessionUuid và currentClientId hợp lệ để tránh tự
    // xóa phiên của chính mình
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

      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data.items) ? data.items : []
        if (items.some((item) => item.uuid && item.uuid !== currentSessionUuid)) {
          await this.callService.callControlApi.endPreviousHostedConferences(sessionContext)
          assertSessionContext(sessionContext)
        }
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
    // Giữ ranh giới SDK: không cho tác vụ xác thực mới chạy khi request/cleanup trước chưa kết
    // thúc an toàn.
    if (this.isSessionRevoked || this.sdkAuthentication.isAuthenticationPending) return false
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

        // Gửi trực tiếp REST API POST /api/auth/0.1/token chuẩn 100% theo DTO
        // WazoAuthRequest.forRefreshToken
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

        // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo
        // thành công giả.
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
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(sessionContext)) this.refreshTokenRevoked = false
        return false
      } finally {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
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
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
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
      // Phân biệt lỗi phiên bị từ chối với lỗi mạng/server tạm thời để tránh đăng xuất nhầm người
      // dùng.
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
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
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
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
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
      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (res.ok) {
        logger.success('API', `Đã đồng bộ Presence "${state}" lên máy chủ tổng đài`)
      }
      return res.ok
    } catch (err) {
      logger.warn('API', 'Không thể cập nhật presence lên máy chủ tổng đài:', err)
      return false
    }
  }
  /** Mọi thao tác sửa session nội bộ SDK đi qua cùng một cổng, gồm cả initialize. */
  authenticateCredentials(username, password, context = captureSessionContext()) {
    return this.sdkAuthentication.authenticate({
      context,
      initialize: () => this.initializeAuthentication(),
      request: () => this.sdk.Auth.logIn(username, password),
    })
  }

  /**
   * Khôi phục session SDK qua gate có timeout và kiểm tra context, không chạy validateToken song
   * song với login cũ.
   */
  validateSdkSession(token, refreshToken, context) {
    return this.sdkAuthentication.authenticate({
      context,
      initialize: () => this.initializeAuthentication(),
      request: () => this.sdk.Auth.validateToken(token, refreshToken),
    })
  }

  /** Hoàn thiện và commit hồ sơ ở tầng auth; LoginView không tự gọi Confd. */
  async synchronizeUserProfile(session, username = '') {
    const context = captureSessionContext(),
      request = createSessionFetch(context)
    let confdUser = {}
    try {
      const response = await request(
        this.getHostUrl() + '/api/confd/1.1/users/' + encodeURIComponent(session.uuid),
        {
          headers: { 'X-Auth-Token': this.getToken() },
          signal: AbortSignal.timeout(5000),
        },
      )
      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
      if (response.ok) confdUser = await response.json()
    } catch (error) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context)) throw error
      logger.warn('AUTH', 'Chưa lấy được hồ sơ mở rộng; dùng hồ sơ SDK.')
    }
    assertSessionContext(context)
    const profile = mapUserProfile(session, confdUser, username)
    if (this.singleIdProfile) {
      profile.displayName = this.singleIdProfile.name || profile.displayName
      profile.department = this.singleIdProfile.department || profile.department
    }
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
