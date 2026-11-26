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

const DEFAULT_WAZO_HOST = '107.126.11.126:9443'

const SESSION_STORAGE_KEYS = {
  authMethod: 'smartcall_auth_method',
  token: 'smartcall_wazo_token',
  refreshToken: 'smartcall_wazo_refreshToken',
  host: 'smartcall_wazo_host',
  sessionUuid: 'smartcall_session_uuid',
  userUuid: 'smartcall_user_uuid',
  extension: 'smartcall_extension',
  username: 'smartcall_username',
  loginUsername: 'smartcall_login_username',
  department: 'smartcall_department',
  loggedIn: 'smartcall_logged_in',
}

const TAB_STORAGE_KEYS = {
  tabClientId: 'smartcall_tab_client_id',
  clientId: 'smartcall_client_id',
  sessionId: 'smartcall_session_id',
}

// Danh sách khóa phiên cần xóa khi đăng xuất; giữ smartcall_wazo_host để nhớ cấu hình tổng đài
// và vẫn dọn các khóa danh tính cũ (user_exten, user_department, sip_user) nếu còn sót từ bản trước.
const CLEARABLE_SESSION_KEYS = [
  SESSION_STORAGE_KEYS.authMethod,
  SESSION_STORAGE_KEYS.token,
  SESSION_STORAGE_KEYS.refreshToken,
  SESSION_STORAGE_KEYS.sessionUuid,
  SESSION_STORAGE_KEYS.userUuid,
  SESSION_STORAGE_KEYS.extension,
  SESSION_STORAGE_KEYS.username,
  SESSION_STORAGE_KEYS.loginUsername,
  SESSION_STORAGE_KEYS.department,
  SESSION_STORAGE_KEYS.loggedIn,
  'smartcall_user_exten',
  'smartcall_user_department',
  'smartcall_sip_user',
]

/** Kiểm tra một phần tử session từ Wazo Auth có thuộc thiết bị/tab khác với phiên hiện tại hay không. */
function isOtherDeviceSession(sessionItem, currentSessionUuid) {
  return Boolean(sessionItem?.uuid && sessionItem.uuid !== currentSessionUuid)
}

/** Tạo mã phiên presence ngắn gọn cho tab Web đang hoạt động. */
function createPresenceSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

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
      localStorage.getItem(SESSION_STORAGE_KEYS.host) ||
      DEFAULT_WAZO_HOST
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
    historyService,
    recordingService,
  }) {
    Object.assign(this, {
      callService,
      eventConnection,
      contactService,
      historyService,
      recordingService,
    })
  }

  /** Trả URL gốc của tổng đài, bổ sung HTTPS khi cấu hình chỉ có host. */
  getHostUrl() {
    return this.host.startsWith('http') ? this.host : `https://${this.host}`
  }

  /** Đọc an toàn giá trị từ sessionStorage; trả chuỗi rỗng nếu trình duyệt hạn chế storage theo tab. */
  _readSessionStorage(key) {
    try {
      return sessionStorage.getItem(key) || ''
    } catch {
      /* Trình duyệt có thể chặn sessionStorage trong ngữ cảnh ẩn danh hoặc sandbox. */
      return ''
    }
  }

  /** Ghi an toàn giá trị vào sessionStorage mà không làm gián đoạn luồng đăng nhập khi storage bị khóa. */
  _writeSessionStorage(key, value) {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* Bỏ qua nếu trình duyệt không cho phép ghi sessionStorage. */
    }
  }

  /** Xóa các khóa nhận diện riêng của tab trong sessionStorage khi đăng xuất hoặc thu hồi phiên. */
  _clearTabSessionStorage() {
    try {
      for (const key of Object.values(TAB_STORAGE_KEYS)) {
        sessionStorage.removeItem(key)
      }
    } catch {
      /* Bỏ qua nếu trình duyệt hạn chế quyền truy cập sessionStorage. */
    }
  }

  /** Đọc số máy lẻ từ đối tượng session của SDK một cách an toàn khi tài khoản chưa có SIP line. */
  _readSessionPrimaryNumber(session) {
    try {
      const ext = session?.primaryNumber?.()
      return ext ? String(ext).trim() : ''
    } catch {
      /* SDK có thể chưa gán line hoặc ném lỗi khi gọi primaryNumber(). */
      return ''
    }
  }

  /**
   * Đồng bộ các trường nhận diện cơ bản từ session SDK vào localStorage và userSessionState làm
   * nguồn dữ liệu tức thời trước khi nạp đầy đủ hồ sơ Confd.
   */
  _syncSessionIdentityFromSession(session) {
    this.currentSessionUuid =
      session.sessionUuid || localStorage.getItem(SESSION_STORAGE_KEYS.sessionUuid) || ''
    if (this.currentSessionUuid) {
      localStorage.setItem(SESSION_STORAGE_KEYS.sessionUuid, this.currentSessionUuid)
    }
    if (session.uuid) {
      localStorage.setItem(SESSION_STORAGE_KEYS.userUuid, session.uuid)
      userSessionState.userUuid = session.uuid
    }
    const exten = this._readSessionPrimaryNumber(session)
    if (exten) {
      localStorage.setItem(SESSION_STORAGE_KEYS.extension, exten)
      userSessionState.extension = exten
    }
    if (session.profile?.department) {
      const dept = session.profile.department
      localStorage.setItem(SESSION_STORAGE_KEYS.department, dept)
      userSessionState.department = dept
    }
    userSessionState.displayName = this.getCurrentDisplayName()
  }

  /** Lưu hồ sơ người dùng đã chuẩn hóa vào SSOT reactive và các khóa localStorage chuẩn. */
  _persistUserProfile(profile) {
    Object.assign(userSessionState, profile)
    localStorage.setItem(SESSION_STORAGE_KEYS.userUuid, profile.userUuid)
    localStorage.setItem(SESSION_STORAGE_KEYS.extension, profile.extension)
    localStorage.setItem(SESSION_STORAGE_KEYS.username, profile.displayName)
    localStorage.setItem(SESSION_STORAGE_KEYS.department, profile.department)
  }

  /** Xóa toàn bộ khóa phiên trong storage và đưa userSessionState về trạng thái rỗng sạch. */
  _clearPersistedSessionData() {
    for (const key of CLEARABLE_SESSION_KEYS) {
      localStorage.removeItem(key)
    }
    this._clearTabSessionStorage()
    userSessionState.extension = ''
    userSessionState.userUuid = ''
    userSessionState.displayName = ''
    userSessionState.department = ''
  }

  /** Lấy hoặc tạo mã client riêng cho tab để nhận diện phiên Web. */
  getOrCreateBrowserClientId() {
    let storedClientId = this._readSessionStorage(TAB_STORAGE_KEYS.tabClientId)
    if (!storedClientId) {
      const rand =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10)
      storedClientId = `web_${rand}`
      this._writeSessionStorage(TAB_STORAGE_KEYS.tabClientId, storedClientId)
    }
    this.clientId = storedClientId
    return storedClientId
  }

  /** Cấu hình SDK bằng host và client ID trước khi đăng nhập hoặc khôi phục. */
  initializeAuthentication() {
    const cleanHost = (this.host || DEFAULT_WAZO_HOST)
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

  /**
   * Kết nối WebRTC Phone sau khi phiên Wazo đã sẵn sàng; chỉ ghi cảnh báo nếu SIP chưa kết nối
   * được để không làm mất phiên đăng nhập chính.
   */
  async _connectPhoneDuringBootstrap() {
    try {
      await this.callService.connect()
    } catch (phoneError) {
      logger.warn(
        'SIP',
        'Kết nối WebRTC Phone cảnh báo (vẫn duy trì phiên login)',
        phoneError.message,
      )
    }
  }

  /**
   * Đồng bộ trạng thái Trực tuyến kèm Session ID lên dịch vụ Presence tổng đài và bật lịch kiểm
   * tra tính hợp lệ định kỳ của phiên.
   */
  async _activateSessionPresence(sessionContext, { reuseExistingSessionId = false } = {}) {
    this.mySessionId =
      (reuseExistingSessionId && this._readSessionStorage(TAB_STORAGE_KEYS.sessionId)) ||
      createPresenceSessionId()
    this._writeSessionStorage(TAB_STORAGE_KEYS.sessionId, this.mySessionId)
    this.isSessionRevoked = false
    try {
      await this.updatePresence('available', this.mySessionId)
    } catch (presenceError) {
      if (presenceError?.name !== 'StaleSessionError') {
        logger.warn(
          'API',
          'Không đồng bộ được presence sau xác thực:',
          presenceError?.message || presenceError,
        )
      }
    }
    assertSessionContext(sessionContext)
    this.startSessionHealthCheck()
  }

  /** Dùng chung bước gắn session, profile, WebSocket và SIP cho mật khẩu và Single ID. */
  async completeAuthenticatedSession(authenticatedSession, username, context) {
    assertSessionContext(context)
    // Bảo vệ ranh giới xác thực: không lưu credential hoặc khởi chạy WebSocket/SIP khi không có token.
    if (!authenticatedSession?.token) throw new Error('Máy chủ chưa trả về phiên xác thực hợp lệ.')
    this.session = authenticatedSession
    localStorage.setItem(SESSION_STORAGE_KEYS.loginUsername, username)

    localStorage.setItem(SESSION_STORAGE_KEYS.token, this.session.token)
    localStorage.setItem(SESSION_STORAGE_KEYS.refreshToken, this.session.refreshToken || '')
    if (this.clientId) {
      this._writeSessionStorage(TAB_STORAGE_KEYS.clientId, this.clientId)
    }
    this._syncSessionIdentityFromSession(this.session)
    await this.synchronizeUserProfile(this.session, username)
    this.historyService.reload()
    logger.success('AUTH', `Đăng nhập Wazo thành công! UUID: ${this.session.uuid || 'N/A'}`)

    // Thu hồi phiên và refresh token cũ để giữ một phiên đang hoạt động.
    // Chốt chặn an toàn: Chỉ thực hiện khi có đầy đủ sessionUuid và clientId hợp lệ.
    if (this.session.uuid && this.currentSessionUuid && this.clientId) {
      try {
        await this.revokeOtherDeviceSessions(
          this.session.uuid,
          this.currentSessionUuid,
          this.clientId,
        )
      } catch (error) {
        logger.warn('AUTH', 'Lỗi khi thu hồi phiên thiết bị khác:', error.message)
      }
    } else {
      logger.warn(
        'AUTH',
        'Chốt chặn an toàn: Bỏ qua thu hồi phiên khác do thiếu sessionUuid hoặc clientId hợp lệ.',
      )
    }

    // Không để login đã bị hủy kết nối SIP sau khi chờ cleanup các phiên cũ.
    assertSessionContext({ epoch: context.epoch, userUuid: this.session?.uuid || '' })
    const authenticatedContext = captureSessionContext()
    this.eventConnection.connect()

    // Tự động kết nối WebRTC Phone sau khi login thành công.
    await this._connectPhoneDuringBootstrap()
    assertSessionContext(authenticatedContext)

    // Tự động đồng bộ trạng thái Trực tuyến kèm Session ID lên dịch vụ Presence tổng đài.
    await this._activateSessionPresence(authenticatedContext)

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
    // Chỉ cho phép chuyển hướng tới endpoint handoff nội bộ cố định, tránh open redirect.
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

  /**
   * Thu hồi cookie phiên Single ID ở nền khi rời trang hoặc đăng xuất; lỗi mạng chỉ ghi cảnh báo
   * để không chặn cleanup cục bộ.
   */
  _endSingleIdSessionInBackground(contextLabel) {
    /** Ghi nhận lỗi thu hồi phiên Single ID ở nền mà không phát sinh unhandled rejection. */
    const handleEndSessionError = (error) => {
      if (error?.name !== 'StaleSessionError') {
        logger.warn('AUTH', `${contextLabel}:`, error?.message || error)
      }
    }
    this.endSingleIdSession().catch(handleEndSessionError)
  }

  /** Hủy giao dịch đang chờ khi rời callback; thu hồi cookie backend và vô hiệu scope SDK. */
  cancelSingleIdLogin() {
    this._endSingleIdSessionInBackground('Không thu hồi được phiên Single ID tạm khi hủy')
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
      // Chỉ tiếp tục xác minh SDK khi backend cấp đủ token, user_uuid và host HTTPS hợp lệ.
      if (!data.token || !data.user_uuid || !String(data.host || '').startsWith('https://'))
        throw new Error('Backend chưa trả phiên Wazo hợp lệ.')
      this.singleIdProfile = data.profile || profile
      this.host = data.host
      const session = await this.validateSdkSession(data.token, data.refresh_token, context)
      assertSessionContext(context)
      // Không chấp nhận session SDK nếu UUID trả về lệch với user được Single ID liên kết.
      if (!session || session.uuid !== data.user_uuid)
        throw new Error('Danh tính phiên SDK không khớp tài khoản Wazo được liên kết.')
      localStorage.setItem(SESSION_STORAGE_KEYS.host, data.host)
      localStorage.setItem(SESSION_STORAGE_KEYS.authMethod, 'singleid')
      return await this.completeAuthenticatedSession(session, data.username, context)
    } catch (error) {
      if (captureSessionContext().epoch === context.epoch) this.logout({ preserveSingleId: true })
      throw error
    }
  }

  /**
   * Thử cứu phiên khi access token cũ hết hạn tự nhiên bằng cách gọi refresh token và xác nhận
   * lại qua SDK trong cùng context khôi phục.
   */
  async _recoverSessionWithRefreshToken(refreshToken, restoreContext) {
    logger.info(
      'AUTH',
      'Auth Token cũ đã hết hạn (1 giờ), đang tự động khôi phục phiên bằng Refresh Token...',
    )
    const refreshed = await this.refreshAccessToken()
    assertSessionContext(restoreContext)
    if (!refreshed) return null
    const newToken = this.getToken()
    const refreshedSession = await this.validateSdkSession(newToken, refreshToken, restoreContext)
    assertSessionContext(restoreContext)
    if (refreshedSession) return refreshedSession
    return {
      token: newToken,
      refreshToken: localStorage.getItem(SESSION_STORAGE_KEYS.refreshToken) || refreshToken,
      sessionUuid: localStorage.getItem(SESSION_STORAGE_KEYS.sessionUuid) || '',
      uuid: localStorage.getItem(SESSION_STORAGE_KEYS.userUuid) || '',
    }
  }

  /** Khôi phục token đã lưu; phản hồi muộn không được ghi đè phiên mới. */
  async restoreSession() {
    const restoreContext = captureSessionContext()
    const token = localStorage.getItem(SESSION_STORAGE_KEYS.token)
    const refreshToken = localStorage.getItem(SESSION_STORAGE_KEYS.refreshToken)
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        const restoredSession = await this.validateSdkSession(token, refreshToken, restoreContext)
        assertSessionContext(restoreContext)
        this.session = restoredSession

        // Nếu token 1 giờ đã hết hạn tự nhiên trong lúc đóng tab/trình duyệt, tự động cứu phiên
        // bằng Refresh Token.
        if (!this.session && refreshToken) {
          this.session = await this._recoverSessionWithRefreshToken(refreshToken, restoreContext)
        }

        if (this.session) {
          this._syncSessionIdentityFromSession(this.session)
          if (localStorage.getItem(SESSION_STORAGE_KEYS.authMethod) === 'singleid') {
            try {
              await this.getSingleIdProfile(this.session.uuid)
            } catch {
              /* Phiên Wazo độc lập vẫn được SDK xác minh dù backend Single ID tạm không phản hồi. */
            }
            assertSessionContext(restoreContext)
          }
          await this.synchronizeUserProfile(this.session, this.getCurrentDisplayName())
          this.historyService.reload()
          logger.success('AUTH', 'Đã khôi phục phiên đăng nhập Wazo từ Token thành công!')
          this.eventConnection.connect()
          await this._connectPhoneDuringBootstrap()
          const connectedContext = captureSessionContext()
          // Không tiếp tục cập nhật presence nếu người dùng đã đăng xuất/đổi phiên trong lúc chờ SIP.
          if (connectedContext.epoch !== restoreContext.epoch)
            throw new Error('Phiên khôi phục đã kết thúc.')
          await this._activateSessionPresence(connectedContext, { reuseExistingSessionId: true })
          return true
        }
      } catch (error) {
        logger.warn('AUTH', 'Không thể khôi phục phiên Wazo từ Token cũ', error.message)
      }
    }
    // Không giữ token bị từ chối làm bằng chứng đăng nhập. Phản hồi phiên cũ không được logout
    // phiên mới.
    if (captureSessionContext().epoch === restoreContext.epoch) this.logout()
    return false
  }

  /**
   * Gửi lệnh giải tán hội nghị do mình làm host trước khi xóa credential; ghi cảnh báo nếu server
   * chưa xác nhận để phiên mới tiếp tục dọn dẹp.
   */
  async _cleanupHostedGroupSession(cleanupSnapshot) {
    const confirmed = await this.callService.callControlApi.cleanupSessionCalls(cleanupSnapshot)
    if (!confirmed) {
      logger.warn(
        'CALL',
        'Cleanup phiên cũ chưa được server xác nhận; phiên mới cần dọn bằng token hợp lệ.',
      )
    }
  }

  /** Cập nhật trạng thái ngoại tuyến an toàn khi logout; bỏ qua nếu hàm đồng bộ từ chối trong lúc dọn phiên. */
  _clearPresenceSafely() {
    /** Bỏ qua lỗi cập nhật presence khi phiên đang được thu hồi/đăng xuất. */
    const ignorePresenceLogoutError = () => {}
    try {
      Promise.resolve(this.updatePresence('unavailable', 'Ngoại tuyến')).catch(
        ignorePresenceLogoutError,
      )
    } catch {
      /* Bỏ qua nếu hàm đồng bộ presence ném lỗi trong lúc dọn phiên. */
    }
  }

  /** Cúp nhánh gọi chính an toàn khi đăng xuất mà không làm gián đoạn chuỗi cleanup còn lại. */
  _hangupPrimarySessionSafely(primarySession) {
    /** Bỏ qua lỗi hangup vì nhánh SIP hoặc SDK có thể đã ngắt trước đó. */
    const ignoreHangupError = () => {}
    try {
      Promise.resolve(this.sdk.Phone.hangup(primarySession)).catch(ignoreHangupError)
    } catch {
      /* SDK đã ngắt kết nối SIP. */
    }
  }

  /** Ghi cảnh báo khi SDK Auth không hoàn tất logout từ xa để không làm treo quy trình đăng xuất cục bộ. */
  _handleSdkLogoutError(error) {
    logger.warn('AUTH', 'SDK chưa hoàn tất logout từ xa:', error.message)
  }

  /** Kết thúc phiên, ngắt kết nối và yêu cầu các dịch vụ dọn state. */
  logout({ revoked = false, preserveSingleId = false } = {}) {
    if (!preserveSingleId && localStorage.getItem(SESSION_STORAGE_KEYS.authMethod) === 'singleid') {
      this._endSingleIdSessionInBackground('Không thu hồi được phiên Single ID khi đăng xuất')
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
    this._clearPresenceSafely()
    if (cleanupSnapshot) {
      this._cleanupHostedGroupSession(cleanupSnapshot)
    }
    if (primarySession) {
      this._hangupPrimarySessionSafely(primarySession)
    }
    this.callService.finalizeCallTermination('ended', null, true, false)
    this.eventConnection.disconnect()
    this.singleIdProfile = null
    this.singleIdCsrf = ''
    this.session = null

    /** Chuyển tiếp lỗi cleanup SDK về handler có tên khi phiên logout từ xa gặp sự cố. */
    const onSdkLogoutRejected = (error) => this._handleSdkLogoutError(error)
    // Xếp cleanup sau request xác thực còn chạy, trước mọi lần initialize/logIn tiếp theo.
    this.sdkCleanupPromise = this.sdkAuthentication
      .logout(sdkNeedsCleanup)
      .catch(onSdkLogoutRejected)

    this._clearPersistedSessionData()
    this.clientId = ''
    this.stopSessionHealthCheck()
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this.isSessionRevoked = revoked

    // Dọn dẹp phòng vệ Wazo.Phone event listeners và ngắt kết nối SIP Phone.
    try {
      this.callService.detachPhoneListeners()
      this.callService.disconnect()
    } catch (error) {
      logger.warn('SIP', 'Lỗi khi dọn dẹp Phone trong logout:', error)
    } finally {
      this.callService.listenersAttached = false
    }

    callState.isRegistered = false
    callState.activeCall = null
    callState.incomingCall = null
    callState.callNotice = null
    this.contactService.reset()
    this.historyService.reset()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
    return this.sdkCleanupPromise
  }

  /** Kiểm tra sự tồn tại token; không đồng nghĩa SIP đã đăng ký thành công. */
  isAuthenticated() {
    return (
      !this.isSessionRevoked &&
      Boolean(this.session?.token || localStorage.getItem(SESSION_STORAGE_KEYS.token))
    )
  }

  /** Lấy access token của phiên hiện tại để gọi Wazo API. */
  getToken() {
    if (this.isSessionRevoked) return ''
    return this.session?.token || localStorage.getItem(SESSION_STORAGE_KEYS.token) || ''
  }

  /** Lấy máy lẻ từ hồ sơ SDK hoặc thông tin phiên đã khôi phục. */
  getCurrentExtension() {
    const sdkExtension = this._readSessionPrimaryNumber(this.session)
    if (sdkExtension) return sdkExtension
    const stored =
      localStorage.getItem(SESSION_STORAGE_KEYS.extension) ||
      localStorage.getItem('smartcall_user_exten') ||
      localStorage.getItem('smartcall_sip_user') ||
      ''
    return String(stored).trim()
  }

  /** Trả UUID người dùng hiện tại để xác định chủ sở hữu dữ liệu. */
  getCurrentUserUuid() {
    return this.session?.uuid || localStorage.getItem(SESSION_STORAGE_KEYS.userUuid) || ''
  }

  /** Thu hồi phiên cục bộ và thông báo giao diện khi máy chủ xác nhận token bị hủy. */
  handleSessionRevocation() {
    if (!this.isAuthenticated() || this.isSessionRevoked) return
    this.logout({ revoked: true })
    logger.warn('AUTH', 'Phiên đã bị thu hồi; token, tác vụ và cache đã được vô hiệu hóa.')
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  /** Xóa từng session trên các thiết bị khác ngoại trừ session hiện tại. */
  async _deletePreviousSession({ host, token, userUuid, sessionUuid, fetch }) {
    try {
      const delRes = await fetch(`${host}/api/auth/0.1/users/${userUuid}/sessions/${sessionUuid}`, {
        method: 'DELETE',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(4000),
      })
      logger.info('AUTH', `Đã thu hồi session cũ: ${sessionUuid} -> Status: ${delRes.status}`)
    } catch (deleteError) {
      logger.warn('AUTH', `Lỗi khi thu hồi session ${sessionUuid}:`, deleteError.message)
    }
  }

  /**
   * Thu hồi danh sách session cũ của cùng tài khoản; dọn hội nghị cũ đang host trước khi xóa
   * session để giữ nguyên quyền xử lý hội nghị hợp lệ.
   */
  async _revokePreviousSessionsList({
    host,
    token,
    userUuid,
    currentSessionUuid,
    sessionContext,
    fetch,
  }) {
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
      if (!res.ok) {
        logger.warn('AUTH', `Không thể lấy danh sách sessions từ Wazo Auth (${res.status})`)
        return
      }

      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : []
      /** Xác định item thuộc thiết bị khác để giải tán hội nghị tồn dư trước khi thu hồi token cũ. */
      const hasOtherSession = (item) => isOtherDeviceSession(item, currentSessionUuid)
      if (items.some(hasOtherSession)) {
        await this.callService.callControlApi.endPreviousHostedConferences(sessionContext)
        assertSessionContext(sessionContext)
      }
      for (const sessionItem of items) {
        if (isOtherDeviceSession(sessionItem, currentSessionUuid)) {
          await this._deletePreviousSession({
            host,
            token,
            userUuid,
            sessionUuid: sessionItem.uuid,
            fetch,
          })
        }
      }
    } catch (error) {
      logger.warn('AUTH', 'Lỗi trong quá trình thu hồi sessions cũ:', error.message)
    }
  }

  /** Xóa refresh token theo clientId của thiết bị cũ để ngăn tự động cấp lại access token. */
  async _deleteClientRefreshToken({ host, token, userUuid, clientId, fetch }) {
    try {
      const delRes = await fetch(
        `${host}/api/auth/0.1/users/${userUuid}/tokens/${encodeURIComponent(clientId)}`,
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
        `Đã xóa refresh_token của client cũ: ${clientId} -> Status: ${delRes.status}`,
      )
    } catch (deleteError) {
      logger.warn('AUTH', `Lỗi khi xóa refresh_token của client ${clientId}:`, deleteError.message)
    }
  }

  /** Thu hồi toàn bộ refresh token của các client cũ ngoại trừ client hiện tại. */
  async _revokePreviousRefreshTokens({ host, token, userUuid, currentClientId, fetch }) {
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

      if (!resTokens.ok) {
        logger.warn(
          'AUTH',
          `Không thể lấy danh sách refresh tokens từ Wazo Auth (${resTokens.status})`,
        )
        return
      }

      const dataTokens = await resTokens.json()
      const itemsTokens = Array.isArray(dataTokens.items) ? dataTokens.items : []
      for (const tokenItem of itemsTokens) {
        const clientId = tokenItem.client_id || tokenItem.clientId
        if (clientId && clientId !== currentClientId) {
          await this._deleteClientRefreshToken({ host, token, userUuid, clientId, fetch })
        }
      }
    } catch (error) {
      logger.warn('AUTH', 'Lỗi trong quá trình thu hồi refresh tokens cũ:', error.message)
    }
  }

  /** Thu hồi các phiên thiết bị khác theo cơ chế Wazo hiện hành. */
  async revokeOtherDeviceSessions(userUuid, currentSessionUuid, currentClientId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    // Thiếu token hoặc UUID thì không thể gọi endpoint quản trị phiên của user.
    if (!token || !userUuid) return

    // Chốt chặn an toàn: Bắt buộc phải có currentSessionUuid và currentClientId hợp lệ để tránh tự
    // xóa phiên của chính mình.
    if (!currentSessionUuid || !currentClientId) {
      logger.warn(
        'AUTH',
        'Chốt chặn an toàn: Bỏ qua revokeOtherDevices do thiếu sessionUuid hoặc clientId hợp lệ.',
      )
      return
    }

    const host = this.getHostUrl()
    await this._revokePreviousSessionsList({
      host,
      token,
      userUuid,
      currentSessionUuid,
      sessionContext,
      fetch,
    })
    await this._revokePreviousRefreshTokens({
      host,
      token,
      userUuid,
      currentClientId,
      fetch,
    })
  }

  /** Kiểm tra định kỳ sức khỏe token; thu hồi phiên cục bộ khi refresh token bị máy chủ từ chối. */
  async _pollSessionHealth() {
    if (!this.isAuthenticated() || this.isSessionRevoked) return
    const isHealthy = await this.verifySessionHealth()
    // Chỉ ép đăng xuất khi refresh token đã bị thu hồi; tránh đá người dùng khi rớt mạng tạm thời.
    if (!isHealthy && this.refreshTokenRevoked) {
      logger.warn(
        'AUTH',
        'Token và Refresh Token không còn hợp lệ trên Wazo Auth, phiên đã kết thúc!',
      )
      this.handleSessionRevocation()
    }
  }

  /** Bắt đầu kiểm tra định kỳ tính hợp lệ của phiên; chỉ có một timer. */
  startSessionHealthCheck() {
    this.stopSessionHealthCheck()
    /** Gọi phương thức kiểm tra sức khỏe phiên trên đúng instance AuthService hiện tại. */
    const runSessionHealthPoll = () => this._pollSessionHealth()
    this.sessionHealthTimer = setInterval(runSessionHealthPoll, 5000)
  }

  /** Dừng kiểm tra phiên khi logout hoặc bị thu hồi quyền truy cập. */
  stopSessionHealthCheck() {
    if (this.sessionHealthTimer) {
      clearInterval(this.sessionHealthTimer)
      this.sessionHealthTimer = null
    }
  }

  /** Lưu cặp token mới nhận từ API refresh vào storage, state phiên và Wazo Auth SDK. */
  _applyRefreshedTokenPayload(payload, fallbackRefreshToken) {
    const newToken = payload?.token
    if (!newToken) return false

    const newRefreshToken = payload?.refresh_token || payload?.refreshToken || fallbackRefreshToken
    const newSessionUuid = payload?.session_uuid || payload?.sessionUuid || payload?.uuid

    localStorage.setItem(SESSION_STORAGE_KEYS.token, newToken)
    localStorage.setItem(SESSION_STORAGE_KEYS.refreshToken, newRefreshToken)
    if (newSessionUuid) {
      localStorage.setItem(SESSION_STORAGE_KEYS.sessionUuid, newSessionUuid)
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
        uuid: payload?.uuid || localStorage.getItem(SESSION_STORAGE_KEYS.userUuid) || '',
      }
    }

    try {
      this.sdk.Auth.setApiToken(newToken)
      this.sdk.Auth.setToken?.(newToken)
    } catch (error) {
      logger.warn(
        'AUTH',
        'Không cập nhật được token mới vào Wazo Auth SDK:',
        error?.message || error,
      )
    }

    this.refreshTokenRevoked = false
    logger.success(
      'AUTH',
      '🎉 Đã làm mới Auth Token thành công! Phiên làm việc được duy trì liên tục.',
    )
    return true
  }

  /** Thực thi request làm mới access token qua REST API và dọn cờ khóa khi vẫn thuộc đúng phiên. */
  async _executeTokenRefresh({ host, clientId, refreshToken, sessionContext, fetch }) {
    try {
      logger.info(
        'AUTH',
        `🔄 Đang gửi yêu cầu làm mới Auth Token tới Wazo Auth (client_id: ${clientId})...`,
      )

      // Gửi trực tiếp REST API POST /api/auth/0.1/token chuẩn theo DTO
      // WazoAuthRequest.forRefreshToken.
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
        return this._applyRefreshedTokenPayload(payload, refreshToken)
      }
      if (res.status === 401 || res.status === 404 || res.status === 400) {
        logger.warn(
          'AUTH',
          `Refresh token đã bị thu hồi hoặc không hợp lệ trên máy chủ (HTTP ${res.status}).`,
        )
        this.refreshTokenRevoked = true
        return false
      }
      logger.warn('AUTH', `Không thể làm mới token do lỗi máy chủ tạm thời (HTTP ${res.status}).`)
      this.refreshTokenRevoked = false
      return false
    } catch (error) {
      logger.warn('AUTH', 'Lỗi mạng khi làm mới Auth Token qua Refresh Token:', error.message)
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
  }

  /** Làm mới token với một request dùng chung; không ghi kết quả của phiên cũ. */
  async refreshAccessToken() {
    // Giữ ranh giới SDK: không cho tác vụ xác thực mới chạy khi request/cleanup trước chưa kết
    // thúc an toàn.
    if (this.isSessionRevoked || this.sdkAuthentication.isAuthenticationPending) return false
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    if (this.isRefreshingToken) return this.refreshPromise
    const refreshToken = localStorage.getItem(SESSION_STORAGE_KEYS.refreshToken)
    if (!refreshToken) {
      logger.warn('AUTH', 'Không tìm thấy refresh_token trong localStorage để làm mới phiên.')
      this.refreshTokenRevoked = true
      return false
    }

    const clientId = this.clientId || 'web_client'
    const host = this.getHostUrl()

    this.isRefreshingToken = true
    this.refreshPromise = this._executeTokenRefresh({
      host,
      clientId,
      refreshToken,
      sessionContext,
      fetch,
    })

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
      const host = this.getHostUrl()
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
    } catch (error) {
      if (error?.name !== 'StaleSessionError') {
        logger.warn(
          'AUTH',
          'Lỗi mạng tạm thời khi kiểm tra sức khỏe phiên:',
          error?.message || error,
        )
      }
      return true // Lỗi mạng tạm thời, không kick nhầm
    }
  }

  /** Tra cứu bổ sung UUID người dùng qua Confd khi state phiên cục bộ chưa có UUID. */
  async _resolveMissingUserUuid({ host, token, fetch }) {
    try {
      const meRes = await fetch(`${host}/api/confd/1.1/users/me`, {
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      })
      if (!meRes.ok) return ''
      const meData = await meRes.json()
      if (!meData.uuid) return ''
      localStorage.setItem(SESSION_STORAGE_KEYS.userUuid, meData.uuid)
      userSessionState.userUuid = meData.uuid
      return meData.uuid
    } catch (error) {
      if (error?.name === 'StaleSessionError') throw error
      logger.warn('AUTH', 'Không tra cứu được UUID người dùng qua Confd:', error?.message || error)
      return ''
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
    const host = this.getHostUrl()
    let userUuid = this.getCurrentUserUuid()
    if (!userUuid) {
      userUuid = await this._resolveMissingUserUuid({ host, token, fetch })
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
    const host = this.getHostUrl()
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
    } catch {
      /* Dự phòng nếu getter hồ sơ SDK chưa sẵn sàng. */
    }
    return localStorage.getItem(SESSION_STORAGE_KEYS.username) || 'Người dùng'
  }

  /** Gửi presence theo contract Wazo, giữ metadata nhận diện client Web. */
  async updatePresence(state = 'available', statusText = '') {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.getToken()
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) return false

    const host = this.getHostUrl()
    const userUuid =
      this.session?.uuid || localStorage.getItem(SESSION_STORAGE_KEYS.userUuid) || 'me'

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
    /** Khởi tạo cấu hình host/clientId SDK trước khi đăng nhập bằng mật khẩu. */
    const initializeSdk = () => this.initializeAuthentication()
    /** Thực thi lệnh đăng nhập của Wazo Auth SDK bằng tài khoản và mật khẩu. */
    const requestSdkLogin = () => this.sdk.Auth.logIn(username, password)
    return this.sdkAuthentication.authenticate({
      context,
      initialize: initializeSdk,
      request: requestSdkLogin,
    })
  }

  /**
   * Khôi phục session SDK qua gate có timeout và kiểm tra context, không chạy validateToken song
   * song với login cũ.
   */
  validateSdkSession(token, refreshToken, context) {
    /** Khởi tạo cấu hình host/clientId SDK trước khi xác minh lại token đã lưu. */
    const initializeSdk = () => this.initializeAuthentication()
    /** Gửi token và refresh token cho Wazo Auth SDK kiểm tra tính hợp lệ. */
    const requestSdkValidation = () => this.sdk.Auth.validateToken(token, refreshToken)
    return this.sdkAuthentication.authenticate({
      context,
      initialize: initializeSdk,
      request: requestSdkValidation,
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
    this._persistUserProfile(profile)
    return profile
  }
}
