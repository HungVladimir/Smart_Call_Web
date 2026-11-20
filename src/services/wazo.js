import { captureSessionContext, assertSessionContext, isSessionContextCurrent, createSessionFetch, invalidateSession, StaleSessionError } from './sessionScope'
import { reactive, shallowReactive } from 'vue'
import Wazo from '@wazo/sdk'
import { logger } from './loggerService'
import { audioService } from './audioService'
import { historyService } from './historyService'
import { contactService } from './contactService'
import { chatService } from './chatService'
import { websocketService } from './websocketService'
import { recordService } from './recordService'

// ===== Khóa xác thực SDK: giữ tác vụ cũ và cleanup tuần tự khi timeout =====
const sdkAuthenticationGates = new WeakMap()

/** Một SDK Auth singleton chỉ được có một tác vụ xác thực/cleanup đang sửa state nội bộ. */
function getSdkAuthenticationGate(auth) {
  if (!sdkAuthenticationGates.has(auth)) sdkAuthenticationGates.set(auth, new SdkAuthenticationGate(auth))
  return sdkAuthenticationGates.get(auth)
}

class SdkAuthenticationGate {
  constructor(auth) {
    this.auth = auth
    this.tail = Promise.resolve()
    this.isAuthenticationPending = false
    this.cleanupFailed = false
  }

  assertCanAuthenticate() {
    if (this.cleanupFailed)
      throw new Error('Chưa dọn được phiên SDK cũ. Vui lòng tải lại trang để đăng nhập an toàn.')
    if (this.isAuthenticationPending)
      throw new Error('Tác vụ xác thực trước chưa kết thúc. Vui lòng chờ hoặc tải lại trang.')
  }

  /** Timeout chỉ giải phóng form; khóa SDK được giữ đến khi request và cleanup thật sự kết thúc. */
  authenticate({ context, initialize, request, timeoutMs = 15000 }) {
    this.assertCanAuthenticate()
    this.isAuthenticationPending = true
    let canceled = false
    let timer
    const operation = this.tail
      .then(async () => {
        if (canceled) throw new StaleSessionError()
        if (this.cleanupFailed)
          throw new Error(
            'Chưa dọn được phiên SDK cũ. Vui lòng tải lại trang để đăng nhập an toàn.',
          )
        assertSessionContext(context)
        let session
        try {
          initialize()
          session = await request()
        } catch (error) {
          // Request SDK có thể đã sửa token trước khi reject.
          await this.clearSdkSession()
          throw error
        }
        if (canceled || !isSessionContextCurrent(context)) {
          await this.clearSdkSession()
          throw new StaleSessionError()
        }
        return session
      })
      .finally(() => {
        this.isAuthenticationPending = false
      })
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    )
    return Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          canceled = true
          reject(
            new Error(
              'Đăng nhập quá thời gian chờ. Tác vụ SDK đang được thu hồi; vui lòng chờ hoặc tải lại trang.',
            ),
          )
        }, timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  async clearSdkSession() {
    try {
      await this.auth.logout()
    } catch (error) {
      this.cleanupFailed = true
      throw error
    }
  }

  /** Không logout song song với logIn/validateToken còn sống trong SDK. */
  logout(required = true) {
    if (!required) return this.tail
    const cleanup = this.tail.then(() => this.clearSdkSession())
    this.tail = cleanup.then(
      () => undefined,
      () => undefined,
    )
    return cleanup
  }
}

// ===== Tín hiệu gọi nhóm: xác thực UUID, host và thành viên trước khi thực hiện =====
const normalizeExtension = (value) => String(value || '').split('@')[0].trim()

/** Chỉ dùng UUID do envelope server cung cấp, không suy người phát từ alias hoặc tag text. */
function resolveGroupSignalSender(context, data) {
  const uuid = data.user_uuid || data.uuid
  if (!uuid || (data.user_uuid && data.uuid && data.user_uuid !== data.uuid)) return null
  if (uuid === context.wazoService.getMyUserUuid()) return null // Echo của chính Web không cấp lại vai trò.
  const contact = context.contactService.findContactByUuid(uuid)
  if (!contact || contact.uuid !== uuid) return null
  const extension = normalizeExtension(contact.number)
  if (!extension) return null
  const owners = new Set(
    context.contactService.currentContacts
      .filter((item) => normalizeExtension(item.number) === extension)
      .map((item) => item.uuid),
  )
  if (owners.size !== 1 || !owners.has(uuid)) return null
  return { uuid, extension }
}

function parseGroupSignalExtensions(value) {
  const list = value.split(',').map(normalizeExtension)
  if (list.some((item) => !item || item.includes(':') || item.includes(']') || /\s/.test(item)))
    return null
  return [...new Set(list)]
}

/** Ràng buộc group signal với người phát và peer/nhóm đang hoạt động; không tự nhận chuyển quyền host. */
function handleGroupPresenceSignal(context, data) {
  if (!context.wazoService.isLogged()) return
  const currentCall = context.callStore.activeCall || context.callStore.incomingCall
  if (!currentCall || !context.wazoService.hasActiveCall() || typeof data.status !== 'string')
    return
  const matches = [...data.status.matchAll(/\[(GROUP|ADD_REQ|NOTICE|LEFT):([^\]]+)\]/g)]
  if (matches.length !== 1) return
  const sender = resolveGroupSignalSender(context, data)
  if (!sender) return
  const [, kind, payload] = matches[0]
  const group = context.wazoService
  const state = group
  const me = context.wazoService.getMyExtension()
  const peer = normalizeExtension(currentCall.number || currentCall.extension)
  const host = state.groupHostExtension
  const established = state.isGroupCall && Boolean(host)
  const member = established && state.groupParticipantExtensions.includes(sender.extension)

  if (kind === 'GROUP') {
    const [declaredHost, csv, ...extra] = payload.split(':')
    const participants = csv && parseGroupSignalExtensions(csv)
    if (
      extra.length ||
      declaredHost !== sender.extension ||
      declaredHost === me ||
      !participants ||
      !participants.includes(me) ||
      !participants.includes(declaredHost)
    )
      return
    // Trong cuộc gọi 1-1, chỉ người gọi ban đầu được công bố mình là host.
    const receivedCall = currentCall.direction === 'inbound' || currentCall === context.callStore.incomingCall
    if (established) {
      if (host !== sender.extension || state.isGroupHost) return
    } else if (!receivedCall || peer !== sender.extension) {
      return
    }
    state.isGroupCall = true
    state.isGroupHost = false
    state.groupHostExtension = sender.extension
    state.groupParticipantExtensions = participants
    Object.assign(currentCall, {
      isGroupCall: true,
      isGroupHost: false,
      groupHostExtension: sender.extension,
      groupParticipantExtensions: [...participants],
      groupTitle: 'Cuộc gọi nhóm (' + participants.length + ' người)',
    })
    return
  }
  // B đang nhận cuộc gọi của A được yêu cầu A nâng lên nhóm, dù GROUP chưa được tạo.
  const initialPeerRequest = !state.isGroupCall && currentCall.direction === 'outbound' &&
    currentCall.status === 'connected' && peer === sender.extension
  if (!member && !(kind === 'ADD_REQ' && initialPeerRequest)) return
  if (kind === 'LEFT') {
    if (payload !== sender.extension || payload === me) return
    group.handleParticipantLeftGroupCall(sender.extension)
    return
  }
  if (kind === 'ADD_REQ') {
    if (!initialPeerRequest && (!state.isGroupHost || host !== me)) return
    const connectedMember =
      (peer === sender.extension && currentCall.status === 'connected') ||
      state.extensionToWazoCallIdMap.has(sender.extension) ||
      state.secondaryCallSessions.get(sender.extension)?.answered === true
    if (!connectedMember) return
    const parts = payload.split(':')
    if (parts.length !== 2 && parts.length !== 3) return
    const [requestId, targetHost, csv] = parts.length === 3 ? parts : ['', ...parts]
    const requested = parseGroupSignalExtensions(csv)
    if (targetHost !== me || !requested) return
    const targets = requested.filter(
      (extension) => extension !== me && extension !== peer && !state.groupParticipantExtensions.includes(extension),
    )
    if (!targets.length) return
    // Android cũ không có request ID: giới hạn một nội dung yêu cầu/người phát trong cuộc gọi hiện tại.
    const key = sender.uuid + ':' + (requestId || csv)
    if (group._processedAddReqIds.has(key)) return
    group._processedAddReqIds.add(key)
    Promise.resolve(group.addParticipantsToGroupCall(targets)).catch((error) =>
      logger.warn('CALL', 'Không thể thực hiện yêu cầu mời từ thành viên:', error.message),
    )
    return
  }
  if (kind === 'NOTICE') {
    const [noticeId, declaredHost, ...message] = payload.split(':')
    if (
      state.isGroupHost ||
      sender.extension !== host ||
      declaredHost !== host ||
      !noticeId ||
      !message.length
    )
      return
    const key = sender.uuid + ':' + noticeId
    if (group._processedNoticeIds.has(key)) return
    group._processedNoticeIds.add(key)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: '🔔 ' + message.join(':'), type: 'warning' },
      }),
    )
  }
}

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
  dialing: false,
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
    this._callEpoch = 0
    this._adhocRetryCount = 0
    this._syncAdhocRetryTimer = null
    this.mySessionId = ''
    this.currentSessionUuid = ''
    this._isKicked = false
    this._tokenCheckTimer = null
    this._isRefreshingToken = false
    this._refreshPromise = null
    this._authenticationGate = getSdkAuthenticationGate(Wazo.Auth)
    this._phoneCleanup = Promise.resolve()
    this._phoneCleanupFailed = false
    this._phoneConnectPromise = null
    this._listenerGeneration = 0
    this._wsRetryTimer = null
    this._sipReconnectTimer = null
    this._pendingSdkCalls = 0
    this._pendingCallEvents = new Map()
    this._answeredSipIds = new Set()
    // Giữ sự kiện kết thúc nhánh khi REST đang chuyển nhánh đó vào hội nghị.
    this._pendingConferenceTerminations = new Map()

    // Trạng thái Gọi nhóm Ad-hoc (Ad-hoc Group Conference) - Parity với Android WazoSipCallManager
    this.activeAdhocConferenceId = ''
    this.isGroupCall = false
    this.isGroupHost = false
    this.groupHostExtension = ''
    this.groupParticipantExtensions = []
    this.extensionToWazoCallIdMap = new Map()
    this.mergedCallIds = new Set()
    this.secondaryCallSessions = shallowReactive(new Map())
    this._terminatingSecondarySipIds = new Set()
    this._isSyncingAdhoc = false
    this._syncAdhocDebounceTimer = null
    this._secondaryInviteTimers = new Map()
    this._primaryInviteTimer = null
    this._processedAddReqIds = new Set()
    this._processedNoticeIds = new Set()

    // Named handlers cho Wazo.Phone event listeners (BUG-06 & BUG-07)
    this._onRegisteredHandler = null
    this._onUnregisteredHandler = null
    this._onProgressHandler = null
    this._onCallIncomingHandler = null
    this._onCallAcceptedHandler = null
    this._onCallEndedHandler = null
    this._onCallFailedHandler = null
    this._onCallRejectedHandler = null
    this._onCallCanceledHandler = null
  }

  get _isDialing() { return callStore.dialing }
  set _isDialing(value) { callStore.dialing = value }

  async applyAudioDevices() {
    const mic = localStorage.getItem('smartcall_selected_mic') || 'default'
    const speaker = localStorage.getItem('smartcall_selected_speaker') || 'default'
    const phone = Wazo.Phone?.phone
    const media = { audio: mic === 'default' ? true : { deviceId: { exact: mic } }, video: false }
    phone?.setMediaConstraints?.(media)
    if (phone && this.hasActiveCall()) await phone.changeAudioInputDevice?.(mic)
    if (phone) await phone.changeAudioDevice?.(speaker)
    const audio = document.getElementById('wazo-remote-audio')
    if (audio?.setSinkId) await audio.setSinkId(speaker)
  }

  _scheduleAdhocRetry(epoch) {
    if (this._syncAdhocRetryTimer || this._adhocRetryCount >= 3) return
    this._adhocRetryCount += 1
    this._syncAdhocRetryTimer = setTimeout(() => {
      this._syncAdhocRetryTimer = null
      if (epoch === this._callEpoch) this.syncActiveCallsToAdhocConference()
    }, 500 * this._adhocRetryCount)
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
    // Không để lần đăng nhập mới sửa SDK khi request cũ đã timeout nhưng còn chạy.
    this._authenticationGate.assertCanAuthenticate()
    this.logout()
    const loginContext = captureSessionContext()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
      const authenticatedSession = await this._authenticationGate.authenticate({
        context: loginContext,
        initialize: () => this.init(),
        request: () => Wazo.Auth.logIn(username, password),
      })
      assertSessionContext(loginContext)
      if (!authenticatedSession?.token || !authenticatedSession?.uuid) throw new Error('Máy chủ chưa trả về phiên đăng nhập hợp lệ.')
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

      const authenticatedContext = captureSessionContext()
      this.openWebSocketEvents()

      // Đăng nhập không phụ thuộc thời gian SDK đăng ký SIP; Header chỉ online khi REGISTERED.
      this.connectPhone().catch((phoneErr) => {
        if (isSessionContextCurrent(authenticatedContext)) logger.warn('SIP', 'Kết nối WebRTC Phone cảnh báo (vẫn duy trì phiên login)', phoneErr.message)
      })
      assertSessionContext(authenticatedContext)

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
      assertSessionContext(authenticatedContext)
      this.startTokenHeartbeat()

      return this.session
    } catch (error) {
      if (captureSessionContext().epoch === loginContext.epoch && (isSessionContextCurrent(loginContext) || this._ownsStoredSession())) this.logout()
      logger.error('AUTH', `Đăng nhập thất bại: ${error.message || error}`, error)
      throw error
    }
  }

  // Khôi phục session xác thực Wazo từ Token khi người dùng F5 hoặc mở lại tab
  async restoreSession() {
    this._authenticationGate.assertCanAuthenticate()
    const restoreContext = captureSessionContext()
    const token = localStorage.getItem('smartcall_wazo_token')
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        const validate = (value, refresh) => this._authenticationGate.authenticate({
          context: restoreContext,
          initialize: () => this.init(),
          request: () => Wazo.Auth.validateToken(value, refresh),
        }).catch((error) => {
          if (this._authenticationGate.isAuthenticationPending || this._authenticationGate.cleanupFailed || error.name === 'StaleSessionError') throw error
          return null
        })
        const restoredSession = await validate(token, refreshToken)
        assertSessionContext(restoreContext)
        this.session = restoredSession

        // Nếu token 1 giờ đã hết hạn tự nhiên trong lúc đóng tab/trình duyệt, tự động cứu phiên bằng Refresh Token
        if (!this.session && refreshToken) {
          logger.info('AUTH', 'Auth Token cũ đã hết hạn (1 giờ), đang tự động khôi phục phiên bằng Refresh Token...')
          const refreshed = await this.refreshSessionToken()
          assertSessionContext(restoreContext)
          if (refreshed) {
            const newToken = this.getToken()
            const refreshedSession = await validate(newToken, localStorage.getItem('smartcall_wazo_refreshToken') || refreshToken)
            assertSessionContext(restoreContext)
            this.session = refreshedSession
          }
        }

        if (this.session?.token && this.session?.uuid) {
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
          const phoneContext = captureSessionContext()
          this.connectPhone().catch((phoneErr) => {
            if (isSessionContextCurrent(phoneContext)) logger.warn('SIP', 'Khôi phục WebRTC phone cảnh báo', phoneErr.message)
          })
          const connectedContext = captureSessionContext()
          if (connectedContext.epoch !== restoreContext.epoch) throw new Error('Phiên khôi phục đã kết thúc.')
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
          assertSessionContext(connectedContext)
          this.startTokenHeartbeat()
          return true
        }
      } catch (e) {
        logger.warn('AUTH', 'Không thể khôi phục phiên Wazo từ Token cũ', e.message)
      }
    }
    if (captureSessionContext().epoch === restoreContext.epoch && (isSessionContextCurrent(restoreContext) || this._ownsStoredSession())) this.logout()
    return false
  }

  logout({ revoked = false, preserveStoredSession = false } = {}) {
    const hadSession = Boolean(this.session || this.getToken())
    this._isKicked = revoked
    invalidateSession()
    this._isRefreshingToken = false
    this._refreshPromise = null
    logger.clearLogs()
    recordService.clearSessionCache()
    logger.info('AUTH', 'Thực hiện đăng xuất khỏi hệ thống Wazo...')
    if (!preserveStoredSession) this.setPresence('unavailable', 'Ngoại tuyến').catch(() => {})
    this._finalizeCallTermination('ended')
    this.closeWebSocketEvents()
    this._authenticationGate.logout(hadSession || this._authenticationGate.isAuthenticationPending)
      .catch((error) => logger.warn('AUTH', 'Chưa dọn được phiên SDK. Cần tải lại trang:', error.message))
    this.session = null
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
      'smartcall_login_username',
      'smartcall_sip_user',
    ]
    if (!preserveStoredSession) sessionKeys.forEach((key) => localStorage.removeItem(key))
    try {
      sessionStorage.removeItem('smartcall_client_id')
      sessionStorage.removeItem('smartcall_tab_client_id')
      sessionStorage.removeItem('smartcall_session_id')
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
    this.myClientId = ''
    this._lastRefreshRevoked = revoked

    // BUG-06 & BUG-07: Dọn dẹp phòng vệ Wazo.Phone event listeners và ngắt kết nối SIP Phone
    try {
      this.detachListeners()
      this.disconnectPhone()
    } catch (e) {
      logger.warn('SIP', 'Lỗi khi dọn dẹp Phone trong logout:', e)
    } finally {
      this.listenersAttached = false
    }

    callStore.isRegistered = false
    callStore.myExtension = ''
    callStore.myUserUuid = ''
    callStore.myUserName = ''
    callStore.myDepartment = ''
    callStore.activeCall = null
    callStore.incomingCall = null
    callStore.callNotice = null
    this._isDialing = false
    contactService.reset()
    chatService.reset()
    historyService.reset()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
  }

  isLogged() {
    return !this._isKicked && Boolean(this.session?.token || localStorage.getItem('smartcall_wazo_token'))
  }

  getToken() {
    return this._isKicked ? '' : this.session?.token || localStorage.getItem('smartcall_wazo_token') || ''
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

  _ownsStoredSession() {
    return Boolean(this.session?.token && this.session.token === localStorage.getItem('smartcall_wazo_token') && this.session.uuid === localStorage.getItem('smartcall_user_uuid'))
  }

  /** Các tab dùng chung storage nhưng có SDK riêng: dọn tab cũ, không xóa credential tab mới. */
  handleSharedSessionChange(event) {
    if (event.key !== null && !['smartcall_wazo_token', 'smartcall_user_uuid', 'smartcall_session_uuid'].includes(event.key)) return
    if (this._isKicked || (!this.session && !this._authenticationGate.isAuthenticationPending)) return
    if (this._ownsStoredSession() && (!this.currentSessionUuid || this.currentSessionUuid === localStorage.getItem('smartcall_session_uuid'))) return
    this.logout({ revoked: true, preserveStoredSession: true })
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  handleSessionKicked() {
    if (!this.isLogged() || this._isKicked) return
    this.logout({ revoked: true })
    logger.warn('AUTH', 'Phiên làm việc bị hủy hoặc tài khoản đăng nhập nơi khác.')
    window.dispatchEvent(new CustomEvent('smartcall-session-kicked'))
  }

  /**
   * Thu hồi toàn bộ phiên làm việc và refresh token của các thiết bị khác trên máy chủ Wazo Auth
   * Bám sát 100% mã nguồn tham chiếu mẫu:
   * - Bước 1: GET /api/auth/0.1/users/{user_uuid}/sessions -> DELETE .../sessions/{session_uuid} (loại trừ currentSessionUuid)
   * - Bước 2: GET /api/auth/0.1/users/{user_uuid}/tokens -> DELETE .../tokens/{client_id} (loại trừ currentClientId)
   */
  async revokeOtherDevices(userUuid, currentSessionUuid, currentClientId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    if (this._isKicked || this._authenticationGate.isAuthenticationPending) return false
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
        if (isSessionContextCurrent(sessionContext)) this._lastRefreshRevoked = false
        return false
      } finally {
        if (isSessionContextCurrent(sessionContext)) {
          this._isRefreshingToken = false
          this._refreshPromise = null
        }
      }
      return false
    })()

    return this._refreshPromise
  }

  async verifyTokenHealth(forceRefresh = false) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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

    const context = captureSessionContext()
    clearTimeout(this._wsRetryTimer)
    this._wsRetryTimer = null
    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    try {
      this.eventWs = new WebSocket(`wss://${cleanHost}/api/websocketd/?token=${token}&version=2`)
      const socket = this.eventWs
      const isCurrent = () => this.eventWs === socket && isSessionContextCurrent(context) && this.isLogged()

      this.eventWs.onopen = () => {
        if (!isCurrent()) return
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
        if (!isCurrent()) return
        try {
          const msg = JSON.parse(m.data)
          const ev = msg.op === 'event' ? msg.data : msg
          const name = ev?.name || ''
          const data = ev?.data || {}

          // Phát sự kiện presence cho toàn hệ thống
          if (name.includes('presence')) {
            window.dispatchEvent(new CustomEvent('wazo-presence-updated', { detail: data }))

            handleGroupPresenceSignal({ wazoService: this, callStore, contactService }, data)

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

              // Bỏ qua nếu là sự kiện chuyển sang trạng thái Ngoại tuyến / Logout của thiết bị khác
              const isOfflineStatus =
                data?.state === 'unavailable' ||
                statusStr.includes('Ngoại tuyến') ||
                statusStr.includes('offline')

              if (!isGroupCallTag && !isOfflineStatus) {
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

          this._handleConferenceEvent(name, data)

          // call_ended chỉ kết thúc một nhánh: khi chuyển vào ConfBridge nó không có nghĩa người đó rời nhóm.
          // Việc rời hội nghị được xử lý riêng trong _handleConferenceEvent; trước khi ghép do SDK quản lý.

          // Chuyển tiếp tới các subscriber của websocketService (chat, call)
          websocketService.emit(name, data)
        } catch (e) {
          /* ignore */
        }
      }

      this.eventWs.onclose = async (ev) => {
        if (!isCurrent()) return
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
          if (!isSessionContextCurrent(context) || !this.isLogged()) return
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
          this._wsRetryTimer = setTimeout(() => {
            this._wsRetryTimer = null
            if (isSessionContextCurrent(context) && this.isLogged() && !this.eventWs && !this._isKicked) {
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
    clearTimeout(this._wsRetryTimer)
    this._wsRetryTimer = null
    if (this.eventWs) {
      try {
        this.eventWs.onclose = null
        this.eventWs.onmessage = null
        this.eventWs.onopen = null
        this.eventWs.close()
      } catch (e) {}
      this.eventWs = null
    }
  }

  /** Chỉ nhận kết thúc hội nghị có ID đã được gắn với nhánh cuộc gọi hiện tại. */
  _handleConferenceEvent(name, data) {
    if (!this.isGroupCall || !this.hasActiveCall()) return
    const conferenceId = data?.conference_id || data?.conference_uuid || (name === 'adhoc_conference_deleted' ? data?.id : '')
    if (!conferenceId) return
    if (name === 'adhoc_conference_participant_left' || name === 'conference_user_participant_left') {
      // Bỏ sự kiện của phòng/kênh cũ; không dùng participant_id hoặc id làm call_id tùy tiện.
      if (this.isGroupHost && this.activeAdhocConferenceId && String(conferenceId) === String(this.activeAdhocConferenceId) && data.call_id != null) {
        this.handleParticipantLeftGroupCall(String(data.call_id))
      }
      return
    }
    if (name === 'adhoc_conference_participant_joined' || name === 'conference_user_participant_joined') {
      const serverCallId = this.currentCallSession?.callId || callStore.activeCall?.session?.callId
      if (serverCallId && data.call_id && String(data.call_id) === String(serverCallId) && (!this.activeAdhocConferenceId || String(this.activeAdhocConferenceId) === String(conferenceId))) {
        this.activeAdhocConferenceId = String(conferenceId)
        if (callStore.activeCall) callStore.activeCall.activeAdhocConferenceId = String(conferenceId)
      }
    }
    if (name !== 'adhoc_conference_deleted' || this.isGroupHost || !this.activeAdhocConferenceId || String(conferenceId) !== String(this.activeAdhocConferenceId)) return
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
    }))
    this.hangup()
  }

  async connectPhone() {
    if (this._phoneConnectPromise) return this._phoneConnectPromise
    const sessionContext = captureSessionContext()
    if (!this.isLogged()) throw new Error('User must be logged in')
    const connecting = (async () => {
      await this._phoneCleanup
      assertSessionContext(sessionContext)
      if (this._phoneCleanupFailed) throw new Error('Chưa dọn được kết nối thoại cũ. Vui lòng tải lại trang.')
      if (this.isPhoneRegistered()) return true
      // SDK gọi unbind() bên trong connect(): listener phải được gắn lại sau khi connect hoàn tất.
      this.detachListeners()
      logger.info('SIP', 'Đang kết nối WebSocket WebRTC SIP tới máy chủ Wazo...')
      try {
        await Wazo.Phone.connect({
          media: { audio: localStorage.getItem('smartcall_selected_mic') && localStorage.getItem('smartcall_selected_mic') !== 'default' ? { deviceId: { exact: localStorage.getItem('smartcall_selected_mic') } } : true, video: false },
          audioDeviceOutput: localStorage.getItem('smartcall_selected_speaker') || 'default',
        })
        assertSessionContext(sessionContext)
        this.attachListeners()
        // REGISTERED có thể phát trước khi Promise connect trả về; đọc trạng thái thật của SDK để bù.
        if (Wazo.Phone.phone?.isRegistered?.()) this._onRegisteredHandler()
        await this.applyAudioDevices()
        assertSessionContext(sessionContext)
        this._neutralizeSdkAutoHold()
        logger.success('SIP', 'Lệnh Wazo.Phone.connect({ audio: true }) gửi thành công.')
        return true
      } catch (error) {
        logger.error('SIP', `Lỗi kết nối WebRTC SIP: ${error.message || error}`, error)
        throw error
      }
    })()
    this._phoneConnectPromise = connecting
    try {
      return await connecting
    } finally {
      if (this._phoneConnectPromise === connecting) this._phoneConnectPromise = null
    }
  }

  disconnectPhone() {
    const connecting = this._phoneConnectPromise
    this._phoneConnectPromise = null
    try {
      this.isRegistered = false
      callStore.isRegistered = false
      this.stopRemoteAudio()
      audioService.stopAllTones()

      // BUG-06: Gỡ bỏ phòng vệ toàn bộ listener của Wazo.Phone trước khi disconnect
      this.detachListeners()

      // Đợi connect cũ kết thúc rồi mới disconnect; connect mới sẽ chờ cleanup này.
      this._phoneCleanup = this._phoneCleanup.then(async () => {
        if (connecting) await connecting.catch(() => {})
        await Wazo.Phone?.disconnect?.()
        this._phoneCleanupFailed = false
      }).catch((error) => {
        this._phoneCleanupFailed = true
        logger.warn('SIP', 'Không thể dọn kết nối thoại cũ:', error?.message || 'Lỗi chưa xác định')
      })
      logger.info('SIP', 'Đã ngắt kết nối Wazo WebRTC Phone')
    } catch (e) {
      logger.warn('SIP', 'Lỗi khi ngắt kết nối Wazo WebRTC Phone:', e)
    } finally {
      this.listenersAttached = false
    }
    return this._phoneCleanup
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
          // API tạo/ghép phòng có thể chưa trả conference_id dù tổng đài đã chuyển kênh.
          // Chờ kết quả REST rồi xử lý lại; không xóa C và báo rời trong lúc C vừa nghe máy.
          if (this._isSyncingAdhoc && !isMarkedTerminating &&
              (session.answered || this._answeredSipIds.has(String(endedSipId)))) {
            this._pendingConferenceTerminations.set(String(endedSipId), { reason, session })
            return
          }
          this._clearSecondaryLegTimeout(endedSecExt)
          this.secondaryCallSessions.delete(endedSecExt)

          // Nếu đã có Ad-hoc Conference hoạt động và không phải nhánh timeout, nhánh SIP phụ WebRTC kết thúc do Asterisk chuyển kênh sang ConfBridge
          // -> Tuyệt đối KHÔNG xóa thành viên khỏi nhóm (Đối chiếu WazoSipCallManager.py line 1164)
          const participantCallId = this.extensionToWazoCallIdMap.get(endedSecExt)
          if (this.activeAdhocConferenceId && this.mergedCallIds.has(participantCallId) && !isMarkedTerminating) {
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
            if (callStore.activeCall.number === endedSecExt) {
              const myExt = this.getMyExtension()
              const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)
              if (remainingOthers.length > 0) {
                callStore.activeCall.number = remainingOthers[0]
                const contact = contactService.findContactByExtension(remainingOthers[0])
                if (contact?.name) {
                  callStore.activeCall.name = contact.name
                }
              }
            }
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
          const oldPrimaryExt = callStore.activeCall?.number
          this.secondaryCallSessions.delete(nextExt)
          this.currentCallSession = nextSession
          if (callStore.activeCall) {
            callStore.activeCall.number = nextExt
            callStore.activeCall.session = nextSession
          }

          // Gỡ số máy nhánh chính cũ khỏi groupParticipantExtensions
          if (oldPrimaryExt) {
            this.groupParticipantExtensions = this.groupParticipantExtensions.filter((e) => e !== oldPrimaryExt)
            const childCallId = this.extensionToWazoCallIdMap.get(oldPrimaryExt)
            if (childCallId) {
              this.hangupUserCall(childCallId).catch(() => {})
              this.extensionToWazoCallIdMap.delete(oldPrimaryExt)
              this.mergedCallIds.delete(childCallId)
            }
          }
          if (callStore.activeCall) {
            callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
            callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`
          }
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: { message: `⚠️ Nhánh máy lẻ ${oldPrimaryExt || 'chính'} không thể kết nối hoặc đã kết thúc`, type: 'warning' },
            }),
          )
          this.broadcastGroupStateViaPresence()
          this.broadcastNoticeToGroup(`Nhánh máy lẻ ${oldPrimaryExt} không thể kết nối hoặc đã kết thúc`)
          return // Không cúp cuộc gọi chính!
        } else if (this.isAnyParticipantConnected()) {
          logger.info('CALL', 'Nhánh chính WebRTC chuyển trạng thái nhưng cuộc gọi nhóm vẫn đang kết nối thành viên. Duy trì cuộc gọi.')
          return // Không cúp cuộc gọi chính!
        }
      }
    }

    // BUG-05: Session guard: Ngăn chặn kết thúc nhầm activeCall khi sự kiện kết thúc thuộc về phiên gọi khác
    if (!forceEnd && session && callStore.activeCall?.session) {
      const activeSession = callStore.activeCall.session
      const activeSipId = activeSession.sipCallId || (typeof activeSession.getId === 'function' && activeSession.getId()) || activeSession.id
      const endedSipId = session.sipCallId || (typeof session.getId === 'function' && session.getId()) || session.id

      if (activeSipId && endedSipId && String(activeSipId) !== String(endedSipId)) {
        logger.warn('CALL', `🛡️ Bỏ qua _finalizeCallTermination: Session kết thúc (${endedSipId}) không khớp với activeCall (${activeSipId}).`)
        // Dọn dẹp incomingCall nếu phiên kết thúc thuộc về incomingCall
        if (callStore.incomingCall) {
          const incSession = callStore.incomingCall.session || callStore.incomingCall.rawSession
          const incSipId = incSession ? (incSession.sipCallId || (typeof incSession.getId === 'function' && incSession.getId()) || incSession.id) : null
          if (!incSipId || String(incSipId) === String(endedSipId)) {
            const inc = callStore.incomingCall
            try {
              historyService.addRecord({
                name: inc.name || (inc.extension || inc.number ? `Máy lẻ ${inc.extension || inc.number}` : 'Đồng nghiệp'),
                extension: inc.extension || inc.number || '',
                dept: inc.dept || '',
                duration: 0,
                direction: 'inbound',
                status: 'missed',
                answered: false,
              })
            } catch (e) {}
            callStore.incomingCall = null
            audioService.stopIncomingRingtone()
          }
        }
        return
      }
    }

    recordService.cancelPendingStart()
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
          recordService.stopRecording().catch((err) => logger.warn('RECORD', 'Chưa xác nhận dừng ghi âm:', err.message))
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
          this._runPhoneCleanup(() => Wazo.Phone.hangup(secSession))
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

  // BUG-06 & BUG-07: Gỡ bỏ phòng vệ toàn bộ Wazo.Phone event listeners
  detachListeners() {
    this._listenerGeneration += 1
    clearTimeout(this._sipReconnectTimer)
    this._sipReconnectTimer = null
    try {
      if (Wazo && Wazo.Phone) {
        const events = [
          [Wazo.Phone.ON_CALL_ENDED, this._onCallEndedHandler],
          [Wazo.Phone.ON_CALL_FAILED, this._onCallFailedHandler],
          [Wazo.Phone.ON_CALL_REJECTED, this._onCallRejectedHandler],
          [Wazo.Phone.ON_CALL_CANCELED, this._onCallCanceledHandler],
          [Wazo.Phone.ON_CALL_ACCEPTED, this._onCallAcceptedHandler],
          [Wazo.Phone.ON_PROGRESS, this._onProgressHandler],
          [Wazo.Phone.ON_CALL_INCOMING, this._onCallIncomingHandler],
          [Wazo.Phone.ON_REGISTERED, this._onRegisteredHandler],
          [Wazo.Phone.ON_UNREGISTERED, this._onUnregisteredHandler],
        ]

        for (const [evt, handler] of events) {
          if (!evt) continue
          try {
            if (handler && typeof Wazo.Phone.off === 'function') {
              Wazo.Phone.off(evt, handler)
            }
          } catch (e) {
            /* ignore */
          }
          try {
            if (Wazo.Phone.eventEmitter && typeof Wazo.Phone.eventEmitter.removeAllListeners === 'function') {
              Wazo.Phone.eventEmitter.removeAllListeners(evt)
            }
          } catch (e) {
            /* ignore */
          }
        }
      }
    } catch (err) {
      logger.warn('SIP', 'Lỗi khi gỡ bỏ listeners Wazo.Phone:', err)
    } finally {
      this.listenersAttached = false
    }
  }

  attachListeners() {
    if (this.listenersAttached) return
    this.listenersAttached = true
    const listenerContext = captureSessionContext()
    const generation = this._listenerGeneration
    const isCurrentListener = () => generation === this._listenerGeneration && isSessionContextCurrent(listenerContext) && this.isLogged()

    this._onRegisteredHandler = () => {
      this.isRegistered = true
      callStore.isRegistered = true
      callStore.myExtension = this.getMyExtension()
      callStore.myUserUuid = this.getMyUserUuid()
      callStore.myUserName = this.getMyUserName()
      logger.success('SIP', '🟢 Wazo WebRTC SIP Phone: Registered thành công!')
      window.dispatchEvent(new CustomEvent('wazo-registered'))
    }

    this._onUnregisteredHandler = () => {
      this.isRegistered = false
      callStore.isRegistered = false
      logger.warn('SIP', '🔴 Wazo WebRTC SIP Phone: Unregistered!')
      window.dispatchEvent(new CustomEvent('wazo-unregistered'))

      if (this.isLogged() && !this._isKicked && localStorage.getItem('smartcall_offline_mode') !== 'true') {
        this.verifyTokenHealth().then((isValid) => {
          if (!isCurrentListener()) return
          if (!isValid && this._lastRefreshRevoked) {
            logger.warn('SIP', 'Phiên SIP bị ngắt do token không còn hợp lệ hoặc phiên đã chuyển sang thiết bị khác!')
            this.handleSessionKicked()
            return
          }
          clearTimeout(this._sipReconnectTimer)
          this._sipReconnectTimer = setTimeout(async () => {
            this._sipReconnectTimer = null
            if (isCurrentListener() && !this.isRegistered && !this._isKicked) {
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
    }

    this._onProgressHandler = (callSession) => {
      if (!this._acceptManagedCallEvent('progress', callSession)) return
      logger.info('CALL', '🔔 Sự kiện Wazo: Đường dây đang đổ chuông (ON_PROGRESS / 180 Ringing)')
      if (callStore.activeCall && callStore.activeCall.status !== 'connected') {
        callStore.activeCall.status = 'ringing'
        audioService.startRingbackTone()
      }
      window.dispatchEvent(new CustomEvent('wazo-progress', { detail: callSession }))
    }

    this._onCallIncomingHandler = (callSession) => {
      const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
      logger.info('CALL', `🔔 Cuộc gọi đến từ máy lẻ: ${ext || 'N/A'}`, callSession)

      // Kiểm tra nếu đang có cuộc gọi hoạt động (bận)
      if (callStore.activeCall || (callStore.incomingCall && callStore.incomingCall.rawSession !== callSession)) {
        logger.warn('CALL', `Đang bận đàm thoại. Tự động từ chối cuộc gọi đến từ máy lẻ ${ext}`)
        try {
          if (callSession && typeof callSession.reject === 'function') {
            this._runPhoneCleanup(() => callSession.reject())
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
    }

    this._onCallAcceptedHandler = (callSession) => {
      if (!callStore.activeCall && !callStore.incomingCall) return
      if (!this._acceptManagedCallEvent('accepted', callSession)) return
      this._answeredSipIds.add(this._sipSessionId(callSession))
      const acceptedEpoch = this._callEpoch
      const acceptedContext = captureSessionContext()
      // 1. Kiểm tra xem session này có phải là nhánh phụ (Secondary Leg) trong cuộc gọi nhóm hay không
      const acceptedSipId = callSession?.sipCallId || (callSession?.getId && callSession.getId()) || callSession?.id
      let isSecondaryLeg = false
      let matchedSecExt = null
      for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
        const secSipId = secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
        if (secSession === callSession || (acceptedSipId && secSipId && String(secSipId) === String(acceptedSipId))) {
          isSecondaryLeg = true
          matchedSecExt = secExt
          break
        }
      }

      // Xử lý riêng cho nhánh phụ (Secondary Leg) trong cuộc gọi nhóm do Host điều phối
      if (this.isGroupCall && this.isGroupHost && isSecondaryLeg) {
        this.secondaryCallSessions.set(matchedSecExt, callSession)
        logger.success('CALL', `🟢 Nhánh phụ [${matchedSecExt || 'N/A'}] đã nghe máy trong cuộc gọi nhóm.`)
        audioService.stopRingbackTone()
        if (matchedSecExt) {
          this._clearSecondaryLegTimeout(matchedSecExt)
        }

        if (callStore.incomingCall) {
          callStore.incomingCall = null
        }

        if (callStore.activeCall) {
          callStore.activeCall.status = 'connected'
          if (!callStore.activeCall.startTime) {
            callStore.activeCall.startTime = Date.now()
            this.startCallDurationTimer()
          }
          if (!this.activeAdhocConferenceId) {
            const stream = Wazo.Phone.getRemoteStream(callSession)
            if (stream) this.playRemoteStream(stream)
          }
          // Giữ nguyên thời gian bắt đầu (startTime) của cuộc gọi nhóm đang diễn ra, không reset về 0
          if (!this.currentCallSession) {
            this.currentCallSession = callSession
            callStore.activeCall.session = callSession
          }
        } else {
          this.currentCallSession = callSession
          const ext = matchedSecExt || callSession?.number || callSession?.callerNumber || callSession?.extension || ''
          const contact = contactService.findContactByExtension(ext)
          callStore.activeCall = {
            session: callSession,
            callId: `rec-${Date.now()}`,
            number: ext,
            name: contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp'),
            dept: contact?.dept || '',
            direction: 'outbound',
            status: 'connected',
            startTime: Date.now(),
            duration: 0,
            isMuted: false,
            isRecorded: false,
          }
          this.startCallDurationTimer()
        }

        // Tự động kết nối nhánh phụ vừa nghe máy vào Ad-hoc Conference qua Asterisk ConfBridge
        this.syncActiveCallsToAdhocConference()

        // Khi đã có ConfBridge, giữ nguyên đường âm thanh của hội nghị.
        window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
        return
      }

      this.currentCallSession = callSession
      logger.success('CALL', '🟢 Sự kiện Wazo: Cuộc gọi đã được kết nối! Đang đàm thoại 2 chiều (Full-Duplex).')
      audioService.stopRingbackTone()

      if (callStore.incomingCall) {
        callStore.incomingCall = null
      }

      if (callStore.activeCall) {
        callStore.activeCall.session = callSession
        callStore.activeCall.status = 'connected'
        if (!callStore.activeCall.startTime) {
          callStore.activeCall.startTime = Date.now()
          callStore.activeCall.duration = 0
        }
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
      for (const [secExt, secSession] of this.secondaryCallSessions.entries()) {
        const secSipId = secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
        if (secSession === callSession || (acceptedSipId && secSipId && String(secSipId) === String(acceptedSipId))) {
          this._clearSecondaryLegTimeout(secExt)
          break
        }
      }

      // Tự động đồng bộ các nhánh vào Ad-hoc Conference nếu đang gọi nhóm
      if (this.isGroupCall && this.isGroupHost) {
        setTimeout(() => {
          if (acceptedEpoch !== this._callEpoch || !isSessionContextCurrent(acceptedContext)) return
          this.syncActiveCallsToAdhocConference()
        }, 500)
      }

      // Tự động kích hoạt ghi âm máy chủ nếu bật cấu hình autoRecordCalls
      if (localStorage.getItem('smartcall_auto_record_calls') === 'true') {
        const recordingCallId = callStore.activeCall?.callId
        setTimeout(async () => {
          if (acceptedEpoch !== this._callEpoch || !isSessionContextCurrent(acceptedContext) || callStore.activeCall?.callId !== recordingCallId) return
          if (callStore.activeCall && !recordService.isRecording()) {
            try {
              const started = await recordService.startRecording(null, {
                name: callStore.activeCall.name,
                number: callStore.activeCall.number,
                extension: callStore.activeCall.number,
                dept: callStore.activeCall.dept,
                direction: callStore.activeCall.direction,
              })
              if (started && callStore.activeCall?.callId === recordingCallId) callStore.activeCall.isRecorded = true
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
        if (acceptedEpoch !== this._callEpoch || !isSessionContextCurrent(acceptedContext) || !callStore.activeCall) return
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
    }

    this._onCallEndedHandler = (callSession) => {
      if (!this._acceptManagedCallEvent('ended', callSession)) return
      logger.info('CALL', '⏹️ Sự kiện Wazo: Cuộc gọi đã kết thúc (ON_CALL_ENDED)')
      this._finalizeCallTermination('ended', callSession)
    }

    this._onCallFailedHandler = (callSession) => {
      if (!this._acceptManagedCallEvent('failed', callSession)) return
      logger.error('CALL', '❌ Sự kiện Wazo: Cuộc gọi thất bại (ON_CALL_FAILED - Máy bận, offline hoặc từ chối)')
      this._finalizeCallTermination('failed', callSession)
      window.dispatchEvent(new CustomEvent('wazo-failed', { detail: callSession }))
    }

    this._onCallRejectedHandler = (callSession) => {
      if (!this._acceptManagedCallEvent('rejected', callSession)) return
      logger.warn('CALL', '🚫 Sự kiện Wazo: Cuộc gọi bị từ chối (ON_CALL_REJECTED)')
      this._finalizeCallTermination('rejected', callSession)
    }

    this._onCallCanceledHandler = (callSession, elsewhere) => {
      if (!this._acceptManagedCallEvent('canceled', callSession)) return
      logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)', { elsewhere })
      // Nếu thiết bị đã nhấc máy và có cờ elsewhere (cause=26 completed elsewhere do chuyển kênh / ConfBridge)
      // -> Bỏ qua không ngắt cuộc gọi (Đối chiếu WazoSipCallManager.py line 1168)
      if (elsewhere && callStore.activeCall && callStore.activeCall.status === 'connected') {
        logger.info('CALL', 'Bỏ qua ON_CALL_CANCELED vì cuộc gọi đã được kết nối (completed elsewhere / bridged).')
        return
      }
      this._finalizeCallTermination('canceled', callSession)
    }

    // Callback đã xếp hàng của phiên/listener cũ không được tác động phiên hiện tại.
    for (const key of ['_onRegisteredHandler', '_onUnregisteredHandler', '_onProgressHandler', '_onCallIncomingHandler', '_onCallAcceptedHandler', '_onCallEndedHandler', '_onCallFailedHandler', '_onCallRejectedHandler', '_onCallCanceledHandler']) {
      const handler = this[key]
      this[key] = (...args) => { if (isCurrentListener()) return handler(...args) }
    }

    // Đăng ký các event listeners với Wazo.Phone
    Wazo.Phone.on(Wazo.Phone.ON_REGISTERED, this._onRegisteredHandler)
    Wazo.Phone.on(Wazo.Phone.ON_UNREGISTERED, this._onUnregisteredHandler)
    Wazo.Phone.on(Wazo.Phone.ON_PROGRESS, this._onProgressHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, this._onCallIncomingHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, this._onCallAcceptedHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, this._onCallEndedHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_FAILED, this._onCallFailedHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_REJECTED, this._onCallRejectedHandler)
    Wazo.Phone.on(Wazo.Phone.ON_CALL_CANCELED, this._onCallCanceledHandler)
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
    const speaker = localStorage.getItem('smartcall_selected_speaker') || 'default'
    if (audioElement.setSinkId) audioElement.setSinkId(speaker).catch((err) => logger.warn('AUDIO', 'Không thể chọn loa:', err.message))
    audioElement.srcObject = stream
    audioElement.play().catch((err) => {
      logger.warn('AUDIO', 'Trình duyệt chặn Autoplay Audio (Cần tương tác người dùng):', err)
    })
  }

  stopRemoteAudio() {
    const audioElement = document.getElementById('wazo-remote-audio')
    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
    }
  }

  _sipSessionId(session) {
    try { return String(session?.sipCallId || session?.getId?.() || session?.id || '') } catch { return '' }
  }

  /** Lệnh dọn nhánh có thể reject bất đồng bộ; try/catch bên ngoài không bắt được Promise. */
  _runPhoneCleanup(command) {
    const context = captureSessionContext()
    const failed = (error) => {
      logger.warn('SIP', 'Chưa xác nhận được thao tác kết thúc nhánh thoại:', error?.message || 'Lỗi chưa xác định')
      if (isSessionContextCurrent(context) && this.isLogged()) {
        window.dispatchEvent(new CustomEvent('app-toast', {
          detail: { type: 'warning', message: 'Chưa xác nhận được thao tác kết thúc cuộc gọi với tổng đài. Vui lòng kiểm tra kết nối.' },
        }))
      }
      return false
    }
    try { return Promise.resolve(command()).then(() => true, failed) }
    catch (error) { return Promise.resolve(failed(error)) }
  }

  /** SDK có thể trả object khác cho cùng nhánh: đối chiếu SIP ID, không đối chiếu số điện thoại. */
  _isManagedCallSession(session) {
    if (!session) return false
    const id = this._sipSessionId(session)
    const managed = [this.currentCallSession, callStore.activeCall?.session, callStore.incomingCall?.session, callStore.incomingCall?.rawSession, ...this.secondaryCallSessions.values()]
    return managed.some((item) => item && (item === session || (id && this._sipSessionId(item) === id)))
  }

  _acceptManagedCallEvent(kind, session) {
    if (this._isManagedCallSession(session)) return true
    // Sự kiện đồng bộ có thể tới trước Promise Phone.call; giữ tạm, chỉ phát lại nếu ID khớp kết quả.
    const id = this._sipSessionId(session)
    if (this._pendingSdkCalls > 0 && id) {
      if (this._pendingCallEvents.size >= 20) this._pendingCallEvents.delete(this._pendingCallEvents.keys().next().value)
      this._pendingCallEvents.set(kind + ':' + id, { kind, session })
    }
    return false
  }

  async _requestPhoneCall(extension) {
    const context = captureSessionContext()
    const epoch = this._callEpoch
    await this._phoneCleanup
    assertSessionContext(context)
    if (epoch !== this._callEpoch) throw new Error('Cuộc gọi đã được hủy.')
    if (this._phoneCleanupFailed) throw new Error('Chưa dọn được kết nối thoại cũ. Vui lòng tải lại trang.')
    this._pendingSdkCalls += 1
    try { return await Wazo.Phone.call(extension, false) }
    finally { this._pendingSdkCalls -= 1 }
  }

  _replayPendingCallEvents(session) {
    const id = this._sipSessionId(session)
    const handlers = { progress: '_onProgressHandler', accepted: '_onCallAcceptedHandler', failed: '_onCallFailedHandler', rejected: '_onCallRejectedHandler', canceled: '_onCallCanceledHandler', ended: '_onCallEndedHandler' }
    for (const kind of Object.keys(handlers)) {
      const key = kind + ':' + id
      const event = this._pendingCallEvents.get(key)
      this._pendingCallEvents.delete(key)
      if (event) this[handlers[kind]]?.(event.session)
    }
    if (!this._pendingSdkCalls) this._pendingCallEvents.clear()
  }

  // --- Điều khiển cuộc gọi cấp thấp qua WebRTC SDK ---
async makeCall(extension) {
    const sessionContext = captureSessionContext()
    logger.info('CALL', `📞 Bắt đầu gọi tới số máy lẻ: ${extension} (Audio-only WebRTC)...`)
    try {
      const callId = callStore.activeCall?.callId
      const callEpoch = this._callEpoch
      const session = await this._requestPhoneCall(extension)
      if (!isSessionContextCurrent(sessionContext) || callEpoch !== this._callEpoch || callStore.activeCall?.callId !== callId) {
        if (session) await Wazo.Phone.hangup(session).catch(() => {})
        throw new Error('Cuộc gọi đã được hủy.')
      }
      if (!session) throw new Error('Kết nối thoại chưa sẵn sàng.')
      this.currentCallSession = session
      this._replayPendingCallEvents(session)
      if (callEpoch !== this._callEpoch || callStore.activeCall?.callId !== callId) throw new Error('Cuộc gọi đã kết thúc.')
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
          this._runPhoneCleanup(() => Wazo.Phone.hangup(secSession))
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
        this._runPhoneCleanup(() => Wazo.Phone.hangup(session))
      } catch (e) {
        /* ignore */
      }
    } else {
      try {
        this._runPhoneCleanup(() => Wazo.Phone.hangup())
      } catch (e) {
        /* ignore */
      }
    }
    this._finalizeCallTermination('ended', session, true)
  }

  async accept(callSession = null) {
    const session = callSession || this.currentCallSession || callStore.incomingCall?.session
    if (!session) throw new Error('Cuộc gọi đến không còn khả dụng.')
    audioService.stopAllTones()
    const result = await Wazo.Phone.accept(session, false)
    if (result == null) throw new Error('Tổng đài chưa chấp nhận thao tác nghe máy.')
    return result
  }

  reject(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Từ chối cuộc gọi (Reject)')
    audioService.stopAllTones()
    const session = callSession || this.currentCallSession || callStore.incomingCall?.session
    if (session) {
      try {
        this._runPhoneCleanup(() => Wazo.Phone.reject(session))
      } catch (e) {
        /* ignore */
      }
    }
    this._finalizeCallTermination('rejected', session)
  }

  // --- Quản lý tiếp nhận & từ chối cuộc gọi đến tập trung ---
  async acceptIncomingCall(callData = null) {
    const context = captureSessionContext()
    const incoming = callData || callStore.incomingCall
    if (!incoming || callStore.activeCall) return false
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    const active = {
      session, callId: `rec-${Date.now()}`, number: incoming.extension || incoming.number || '',
      name: incoming.name || '', dept: incoming.dept || '', direction: 'inbound',
      status: 'answering', startTime: null, duration: 0, isMuted: false, isRecorded: false,
      isGroupCall: Boolean(this.isGroupCall || incoming.isGroupCall), isGroupHost: this.isGroupHost,
      groupHostExtension: this.groupHostExtension || incoming.groupHostExtension || '',
      groupParticipantExtensions: this.groupParticipantExtensions.length ? [...this.groupParticipantExtensions] : (incoming.groupParticipantExtensions || []),
      groupTitle: incoming.groupTitle || '',
    }
    callStore.activeCall = active
    callStore.incomingCall = null
    try {
      await this.accept(session)
      assertSessionContext(context)
      return callStore.activeCall?.callId === active.callId
    } catch (err) {
      if (isSessionContextCurrent(context) && callStore.activeCall?.callId === active.callId) {
        this._finalizeCallTermination('failed', session, true)
        window.dispatchEvent(new CustomEvent('app-toast', { detail: { type: 'error', message: `Không thể nghe máy: ${err.message}` } }))
      }
      return false
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
        this._runPhoneCleanup(() => Wazo.Phone.reject(session))
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

  /** Giữ khóa cho cả tra cứu thiết bị và lời mời SDK, chỉ thao tác sở hữu khóa mới được mở. */
  async validateAndMakeCall(rawExt, meta = {}) {
    if (this._isDialing) return { success: false, reason: 'THROTTLED' }
    if (!this.isLogged()) return { success: false, reason: 'NOT_AUTHENTICATED' }
    const attempt = {}
    this._dialAttempt = attempt
    this._isDialing = true
    try {
      return await this._validateAndMakeCall(rawExt, meta)
    } finally {
      if (this._dialAttempt === attempt) {
        this._dialAttempt = null
        this._isDialing = false
      }
    }
  }

  // --- Kiểm tra toàn diện & Thực hiện cuộc gọi (Single Entry Point) ---
async _validateAndMakeCall(rawExt, meta = {}) {
    const sessionContext = captureSessionContext()
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


    const cleanExt = ext.split('@')[0].trim()
    const myExt = this.getMyExtension()
    const cleanMyExt = myExt.split('@')[0].trim()

    // 3. Chặn người dùng tự gọi cho chính mình
    if (cleanMyExt && cleanExt === cleanMyExt) {
      logger.warn('CALL', `Chặn thao tác: Người dùng cố gắng gọi tới chính máy lẻ của mình (${cleanExt})`)      window.dispatchEvent(
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
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} không tồn tại trong danh bạ hệ thống.`)        window.dispatchEvent(
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
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang bận trong cuộc gọi khác.`)        window.dispatchEvent(
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
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang bật chế độ Không làm phiền (DND).`)        window.dispatchEvent(
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
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} đang đổ chuông nhận cuộc gọi khác.`)        window.dispatchEvent(
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
        logger.warn('CALL', `Chặn cuộc gọi: Máy lẻ ${cleanExt} hiện đang ngoại tuyến.`)        window.dispatchEvent(
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
          logger.error('CALL', 'Không tìm thấy thiết bị Microphone trên máy tính để thực hiện cuộc gọi WebRTC!')          window.dispatchEvent(
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
    assertSessionContext(sessionContext)
    if (callStore.activeCall || this.hasActiveCall()) return { success: false, reason: 'BUSY_LOCAL' }
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
      if (isSessionContextCurrent(sessionContext) && callStore.activeCall?.callId === recCallId) this._finalizeCallTermination('failed')
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
    const sessionContext = captureSessionContext()
    // BUG-08: Anti-collision check ngăn chặn xung đột khi đang trong cuộc gọi hoặc bấm nhanh liên tục
    if (this.isGroupCall || this.hasActiveCall() || callStore.activeCall || this._isDialing) {
      logger.warn('CALL', 'Chặn bắt đầu gọi nhóm: Đã có cuộc gọi đang hoạt động hoặc cuộc gọi nhóm đang diễn ra (already_in_call).')
      return { success: false, reason: 'already_in_call' }
    }

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

    // Lọc loại bỏ các máy lẻ đang bận (talking/holding), đang đổ chuông (ringing/progressing), không làm phiền (dnd) hoặc offline
    const availableTargets = []
    const busyTargets = []
    for (const ext of cleanList) {
      if (contactService.isContactAvailableForCall(ext)) {
        availableTargets.push(ext)
      } else {
        const c = contactService.findContactByExtension(ext)
        busyTargets.push(c?.name ? `${c.name} (${ext})` : `Máy lẻ ${ext}`)
      }
    }

    if (busyTargets.length > 0) {
      logger.warn('CALL', `Các máy lẻ bận/không khả dụng bị loại khỏi gọi nhóm: ${busyTargets.join(', ')}`)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${busyTargets.join(', ')}] hiện đang bận hoặc không khả dụng để gọi nhóm! Đã tự động loại bỏ.`,
            type: 'warning',
          },
        }),
      )
    }

    if (availableTargets.length === 0) {
      logger.warn('CALL', 'Không còn máy lẻ nào khả dụng để bắt đầu cuộc gọi nhóm.')
      return { success: false, reason: 'NO_AVAILABLE_TARGETS' }
    }

    if (availableTargets.length === 1) {
      logger.info('CALL', `Chỉ còn 1 máy lẻ khả dụng [${availableTargets[0]}]. Chuyển sang cuộc gọi thoại 1-1.`)
      return this.validateAndMakeCall(availableTargets[0], meta)
    }

    logger.info('CALL', `👥 Bắt đầu gọi nhóm (Ad-hoc) tới ${availableTargets.length} thành viên khả dụng: ${availableTargets.join(', ')}`)

    // Thiết lập trạng thái Host & Group
    this.isGroupHost = true
    this.groupHostExtension = myExt
    this.isGroupCall = true
    this.activeAdhocConferenceId = ''
    this.extensionToWazoCallIdMap.clear()
    this.mergedCallIds.clear()
    this.secondaryCallSessions.clear()

    this.groupParticipantExtensions = [myExt, ...availableTargets]
    const callEpoch = this._callEpoch

    const firstTarget = availableTargets[0]
    const remainingTargets = availableTargets.slice(1)

    // Khởi tạo cuộc gọi nhánh đầu tiên
    const callResult = await this.validateAndMakeCall(firstTarget, {
      ...meta,
      isGroupCall: true,
      isGroupHost: true,
      groupHostExtension: myExt,
      groupTitle: meta.groupTitle || `Cuộc gọi nhóm (${this.groupParticipantExtensions.length} người)`,
      groupParticipants: this.groupParticipantExtensions,
    })

    if (!isSessionContextCurrent(sessionContext) || callEpoch !== this._callEpoch) return { success: false, reason: 'CANCELED' }
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
      if (!isSessionContextCurrent(sessionContext) || callEpoch !== this._callEpoch) return
      if (this.hasActiveCall() && this.isGroupCall && remainingTargets.length > 0) {
        this.addParticipantsToGroupCall(remainingTargets).catch((err) => logger.warn('CALL', 'Không thể mời thành viên:', err.message))
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
    const sessionContext = captureSessionContext()
    const callEpoch = this._callEpoch
    const callId = callStore.activeCall?.callId
    const current = () => isSessionContextCurrent(sessionContext) && callEpoch === this._callEpoch && callStore.activeCall?.callId === callId
    if (!callStore.activeCall) return
    const myExt = this.getMyExtension()

    // A gọi B thì A luôn là host. B chỉ gửi ADD_REQ cho A, không tự gọi C hoặc tự tạo phòng.
    if (!this.isGroupCall && callStore.activeCall.direction === 'inbound') {
      if (callStore.activeCall.status !== 'connected') throw new Error('Chỉ thêm người sau khi cuộc gọi đã kết nối.')
      return this.delegateAddParticipantsToHost(normalizeExtension(callStore.activeCall.number), extensions)
    }

    // Người gọi ban đầu nâng cuộc gọi 1-1 thành nhóm và tiếp tục giữ quyền host.
    if (!this.isGroupCall && this.hasActiveCall()) {
      if (callStore.activeCall.direction !== 'outbound') throw new Error('Chưa xác định được người gọi ban đầu để tạo nhóm.')
      logger.info('CALL', '👥 Nâng cấp cuộc gọi 1-1 lên cuộc gọi nhóm Ad-hoc Conference...')
      this.isGroupCall = true
      this.isGroupHost = true
      this.groupHostExtension = myExt
      const peerExt = String(callStore.activeCall?.number || '').trim()
      this.groupParticipantExtensions = [myExt]
      if (peerExt && !this.groupParticipantExtensions.includes(peerExt)) {
        this.groupParticipantExtensions.push(peerExt)
      }
      if (callStore.activeCall) {
        callStore.activeCall.isGroupCall = true
        callStore.activeCall.isGroupHost = true
        callStore.activeCall.groupHostExtension = myExt
        callStore.activeCall.groupParticipantExtensions = [...this.groupParticipantExtensions]
        callStore.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupParticipantExtensions.length + extensions.length} người)`
      }
    } else if (!this.isGroupHost) {
      const hostExt = this.groupHostExtension || callStore.activeCall?.number
      if (hostExt && hostExt !== myExt) {
        return this.delegateAddParticipantsToHost(hostExt, extensions)
      }
    }

    const toInvite = []
    const busyOrUnavailable = []
    for (const ext of extensions) {
      const s = String(ext || '').trim()
      if (!s || s === myExt) continue

      if (!contactService.isContactAvailableForCall(s)) {
        const c = contactService.findContactByExtension(s)
        const nameOrExt = c?.name ? `${c.name} (${s})` : `Máy lẻ ${s}`
        busyOrUnavailable.push({ ext: s, label: nameOrExt })
        continue
      }

      if (!this.groupParticipantExtensions.includes(s)) {
        this.groupParticipantExtensions.push(s)
      }
      if (!toInvite.includes(s)) {
        toInvite.push(s)
      }
    }

    if (busyOrUnavailable.length > 0) {
      const busyNames = busyOrUnavailable.map((b) => b.label).join(', ')
      logger.warn('CALL', `Không thể mời các máy lẻ bận/không khả dụng vào nhóm: ${busyNames}`)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${busyNames}] hiện đang bận hoặc không khả dụng, không thể mời vào nhóm!`,
            type: 'warning',
          },
        }),
      )
      this.broadcastNoticeToGroup(`Máy lẻ ${busyOrUnavailable.map((b) => b.ext).join(', ')} đang bận`)
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
      if (!current()) return
      const phoneInstance = Wazo.Phone?.phone
      const prevSipSession = phoneInstance?.currentSipSession
      const prevCallSession = phoneInstance?.currentCallSession
      try {
        logger.info('CALL', `Đang gửi tín hiệu gọi nhánh thành viên: ${ext}...`)

        // Bảo vệ nhánh đầu tiên: tạm thời tách currentSipSession để Wazo.Phone không gửi lệnh hold sai quy cách lên nhánh đang đổ chuông
        if (phoneInstance && phoneInstance.currentSipSession) {
          phoneInstance.currentSipSession = null
        }

        const session = await this._requestPhoneCall(ext)
        if (!current()) {
          if (session) await Wazo.Phone.hangup(session).catch(() => {})
          return
        }

        if (session) {
          this.secondaryCallSessions.set(ext, session)
          this._startSecondaryLegTimeout(ext, session)
          this._replayPendingCallEvents(session)
        }
      } catch (err) {
        if (!current()) return
        logger.warn('CALL', `Không thể gọi nhánh ${ext}:`, err.message || err)
        this.broadcastNoticeToGroup(`Không thể kết nối máy lẻ ${ext}`)
      } finally {
        if (current() && phoneInstance && prevSipSession) {
          phoneInstance.currentSipSession = prevSipSession
          phoneInstance.currentCallSession = prevCallSession
        }
      }
    }
  }

  /**
   * Bắt đầu bộ đếm Timeout 30 giây cho nhánh chính đầu tiên trong cuộc gọi nhóm
   */
  _startPrimaryLegTimeout(targetExt) {
    this._clearPrimaryLegTimeout()
    if (this._answeredSipIds.has(this._sipSessionId(this.currentCallSession))) return
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
          this._runPhoneCleanup(() => Wazo.Phone.hangup(session))
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
    if (this._answeredSipIds.has(this._sipSessionId(session))) return
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
        this._runPhoneCleanup(() => Wazo.Phone.hangup(session))
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
  async delegateAddParticipantsToHost(hostExt, targetExtensions) {
    if (!hostExt || !targetExtensions || targetExtensions.length === 0) return
    const sessionContext = captureSessionContext()
    const callEpoch = this._callEpoch
    const callId = callStore.activeCall?.callId
    const myExt = this.getMyExtension()
    const toInviteNow = []
    const dropped = []

    for (const rawExt of targetExtensions) {
      const e = String(rawExt || '').trim()
      if (!e || e === myExt || e === hostExt) continue
      if (contactService.isContactAvailableForCall(e)) {
        toInviteNow.push(e)
      } else {
        const c = contactService.findContactByExtension(e)
        dropped.push(c?.name ? `${c.name} (${e})` : `Máy lẻ ${e}`)
      }
    }

    if (dropped.length > 0) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${dropped.join(', ')}] hiện đang bận hoặc không khả dụng, không thể gửi yêu cầu mời vào nhóm!`,
            type: 'warning',
          },
        }),
      )
    }

    if (toInviteNow.length === 0) return

    const reqId = Date.now()
    const reqTag = `[ADD_REQ:${reqId}:${hostExt}:${toInviteNow.join(',')}]`
    logger.info('CALL', `Máy thành viên ủy quyền cho Chủ phòng (${hostExt}) mời thêm: ${reqTag}`)
    const sent = await this.setPresence('unavailable', `Đang bận ${reqTag}`)
    // ACK của cuộc gọi cũ không được báo thành công/lỗi sau khi người dùng đã cúp hoặc đổi phiên.
    if (!isSessionContextCurrent(sessionContext) || callEpoch !== this._callEpoch || callStore.activeCall?.callId !== callId) return
    if (!sent) throw new Error('Không gửi được yêu cầu thêm người tới chủ phòng. Vui lòng thử lại.')
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
      const callEpoch = this._callEpoch
      this._isSyncingAdhoc = true
      try {
        await this._doSyncActiveCallsToAdhocConference()
      } catch (err) {
        logger.warn('CALL', 'Lỗi trong quá trình đồng bộ Ad-hoc Conference:', err)
      } finally {
        // Kết quả của lần ghép cũ không được đụng tới cuộc gọi mới sau cúp máy/đổi phiên.
        if (callEpoch === this._callEpoch) {
          this._isSyncingAdhoc = false
          this._flushPendingConferenceTerminations()
        }
      }
    }, 350)
  }

  /** Phát lại kết thúc nhánh sau REST: ghép thành công thì giữ thành viên, thất bại thì dọn nhánh. */
  _flushPendingConferenceTerminations() {
    const pending = [...this._pendingConferenceTerminations.values()]
    this._pendingConferenceTerminations.clear()
    for (const { reason, session } of pending) this._finalizeCallTermination(reason, session)
  }

async _doSyncActiveCallsToAdhocConference() {
    const sessionContext = captureSessionContext()
    if (!this.hasActiveCall() || !this.isGroupCall || !this.isGroupHost) return

    const callEpoch = this._callEpoch
    const current = () => callEpoch === this._callEpoch && isSessionContextCurrent(sessionContext) && this.hasActiveCall()
    const activeCalls = await this.getMyActiveCalls()
    if (!current()) return
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
              const secSip = secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
              if (secSession.sipCallId === sipId || (secSip && sipId && String(secSip) === String(sipId))) {
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
          const added = await this.addParticipantToAdhocConference(this.activeAdhocConferenceId, pId)
          if (!current()) return
          if (added) this.mergedCallIds.add(pId)
          else this._scheduleAdhocRetry(callEpoch)
        }
      }
      return
    }

    // Chưa có conference_id: Tạo mới Ad-hoc Conference khi có ít nhất 2 thành viên
    const toMerge = participantCallIds.filter((id) => id !== hostCallId)
    if (toMerge.length >= 2 && hostCallId) {
      toMerge.forEach((id) => this.mergedCallIds.add(id))
      const confId = await this.createAdhocConference(hostCallId, toMerge)
      if (!current()) {
        if (confId && isSessionContextCurrent(sessionContext)) await this.deleteAdhocConference(confId)
        return
      }
      if (confId) {
        this.activeAdhocConferenceId = confId
        if (callStore.activeCall) {
          callStore.activeCall.activeAdhocConferenceId = confId
        }
        this.broadcastGroupStateViaPresence()
      } else {
        this.mergedCallIds.clear()
        this._scheduleAdhocRetry(callEpoch)
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
        if (String(cId) === targetStr) {
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

      // Khi một thành viên rời đi, nếu activeCall.number đang trỏ vào thành viên đó, chuyển sang thành viên tiếp theo còn lại
      if (callStore.activeCall.number === leftExt) {
        const remainingOthers = this.groupParticipantExtensions.filter((e) => e !== myExt)
        if (remainingOthers.length > 0) {
          callStore.activeCall.number = remainingOthers[0]
          const contact = contactService.findContactByExtension(remainingOthers[0])
          if (contact?.name) {
            callStore.activeCall.name = contact.name
          }
        }
      }
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
    if (!this.isGroupCall || !this.isGroupHost) return
    const myExt = this.getMyExtension()
    const hostExt = this.groupHostExtension || myExt
    const exts = this.groupParticipantExtensions.length > 0 ? this.groupParticipantExtensions : [myExt]
    const groupTag = `[GROUP:${hostExt}:${exts.join(',')}]`
    this.setPresence('unavailable', `Đang gọi nhóm ${groupTag}`)
  }

  _resetGroupCallState() {
    this._callEpoch += 1
    this._pendingCallEvents.clear()
    this._answeredSipIds.clear()
    this._pendingConferenceTerminations.clear()
    clearTimeout(this._syncAdhocRetryTimer)
    this._syncAdhocRetryTimer = null
    this._adhocRetryCount = 0
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
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
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
