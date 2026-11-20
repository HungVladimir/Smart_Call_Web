import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'
import { callState } from '../../state/callState.js'
import { normalizeExtension } from '../../utils/callPolicy.js'

import { logger } from '../common/loggerService.js'
import { createGroupCallState } from '../../state/callState.js'

/** Điều phối hội nghị và các nhánh gọi; dùng AuthService để lấy thông tin phiên. */
export class GroupCallService {
  /**
   * Nhận các dependency gọi nhóm và tạo state/timer/danh sách tín hiệu đã xử lý riêng cho vòng đời
   * hội nghị.
   */
  constructor({
    sdk,
    authService,
    callService,
    contactService,
    callControlApi,
    phoneAdapter,
    callToneService,
  }) {
    Object.assign(this, {
      sdk,
      authService,
      callService,
      contactService,
      callControlApi,
      phoneAdapter,
      callToneService,
    })
    this.state = createGroupCallState()
    this._adhocRetryCount = 0
    this._syncAdhocRetryTimer = null
    this._terminatingSecondarySipIds = new Set()
    this._isSyncingAdhoc = false
    this._syncAdhocDebounceTimer = null
    this._secondaryInviteTimers = new Map()
    this._primaryInviteTimer = null
    this._processedAddReqIds = new Set()
    this._processedNoticeIds = new Set()
    this._pendingConferenceTerminations = new Map()
    this._groupSnapshotId = ''
    this._groupSnapshotRevision = 0
    this._groupSyncRequestIds = new Set()
    this._groupSyncRequestKeys = new Set()
    this._processedGroupSyncIds = new Set()
  }

  /** Hẹn đồng bộ lại hội nghị khi các server call ID chưa sẵn sàng. */
  scheduleConferenceRetry(epoch) {
    if (this._syncAdhocRetryTimer || this._adhocRetryCount >= 3) return
    this._adhocRetryCount += 1
    this._syncAdhocRetryTimer = setTimeout(() => {
      this._syncAdhocRetryTimer = null
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (epoch === this.callService.callGeneration) this.syncActiveCallsToAdhocConference()
    }, 500 * this._adhocRetryCount)
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
    if (
      this.state.isGroupCall ||
      this.callService.hasActiveCall() ||
      callState.activeCall ||
      this.callService.isDialing
    ) {
      logger.warn(
        'CALL',
        'Chặn bắt đầu gọi nhóm: Đã có cuộc gọi đang hoạt động hoặc cuộc gọi nhóm đang diễn ra (already_in_call).',
      )
      return { success: false, reason: 'already_in_call' }
    }

    if (!targetExtensions || targetExtensions.length === 0)
      return { success: false, reason: 'EMPTY' }

    const myExt = this.authService.getCurrentExtension()
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
      if (this.contactService.isContactAvailableForCall(ext)) {
        availableTargets.push(ext)
      } else {
        const c = this.contactService.findContactByExtension(ext)
        busyTargets.push(c?.name ? `${c.name} (${ext})` : `Máy lẻ ${ext}`)
      }
    }

    if (busyTargets.length > 0) {
      logger.warn(
        'CALL',
        `Các máy lẻ bận/không khả dụng bị loại khỏi gọi nhóm: ${busyTargets.join(', ')}`,
      )
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
      logger.info(
        'CALL',
        `Chỉ còn 1 máy lẻ khả dụng [${availableTargets[0]}]. Chuyển sang cuộc gọi thoại 1-1.`,
      )
      return this.callService.startCall(availableTargets[0], meta)
    }

    logger.info(
      'CALL',
      `👥 Bắt đầu gọi nhóm (Ad-hoc) tới ${availableTargets.length} thành viên khả dụng: ${availableTargets.join(', ')}`,
    )

    // Thiết lập trạng thái Host & Group
    this.state.isGroupHost = true
    this.state.groupHostExtension = myExt
    this.state.isGroupCall = true
    this.state.activeAdhocConferenceId = ''
    this.state.extensionToWazoCallIdMap.clear()
    this.state.mergedCallIds.clear()
    this.state.secondaryCallSessions.clear()

    this.state.groupParticipantExtensions = [myExt, ...availableTargets]
    this.state.groupConnectedExtensions = [myExt] // Các máy đang đổ chuông chưa được tính đã vào nhóm.
    const callEpoch = this.callService.callGeneration

    const firstTarget = availableTargets[0]
    const remainingTargets = availableTargets.slice(1)

    // Khởi tạo cuộc gọi nhánh đầu tiên
    const callResult = await this.callService.startCall(firstTarget, {
      ...meta,
      isGroupCall: true,
      isGroupHost: true,
      groupHostExtension: myExt,
      groupTitle:
        meta.groupTitle || `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`,
      groupParticipants: this.state.groupParticipantExtensions,
    })

    if (!isSessionContextCurrent(sessionContext) || callEpoch !== this.callService.callGeneration)
      return { success: false, reason: 'CANCELED' }
    if (!callResult || !callResult.success) {
      this.resetGroupState()
      return callResult
    }

    // Đặt bộ đếm Timeout 30 giây cho nhánh chính đầu tiên
    this.startPrimaryInviteTimeout(firstTarget)

    // Đánh dấu activeCall là groupCall
    if (callState.activeCall) {
      callState.activeCall.isGroupCall = true
      callState.activeCall.isGroupHost = true
      callState.activeCall.groupHostExtension = myExt
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
      callState.activeCall.groupTitle =
        meta.groupTitle || `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
    }

    // Sau 700ms (khi nhánh đầu tiên đã sẵn sàng SDP), gọi các nhánh còn lại
    setTimeout(() => {
      if (!isSessionContextCurrent(sessionContext) || callEpoch !== this.callService.callGeneration)
        return
      if (
        this.callService.hasActiveCall() &&
        this.state.isGroupCall &&
        remainingTargets.length > 0
      ) {
        this.addParticipantsToGroupCall(remainingTargets).catch((err) =>
          logger.warn('CALL', 'Không thể mời thành viên:', err.message),
        )
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
    const callEpoch = this.callService.callGeneration
    const callId = callState.activeCall?.callId
    const current = () =>
      isSessionContextCurrent(sessionContext) &&
      callEpoch === this.callService.callGeneration &&
      callState.activeCall?.callId === callId
    if (!callState.activeCall) return
    const myExt = this.authService.getCurrentExtension()

    // A gọi B thì A luôn là host. B chỉ gửi ADD_REQ cho A, không tự gọi C hoặc tự tạo phòng.
    if (!this.state.isGroupCall && callState.activeCall.direction === 'inbound') {
      if (callState.activeCall.status !== 'connected')
        throw new Error('Chỉ thêm người sau khi cuộc gọi đã kết nối.')
      return this.delegateAddParticipantsToHost(
        normalizeExtension(callState.activeCall.number),
        extensions,
      )
    }

    // Người gọi ban đầu nâng cuộc gọi 1-1 thành nhóm và tiếp tục giữ quyền host.
    if (!this.state.isGroupCall && this.callService.hasActiveCall()) {
      if (callState.activeCall.direction !== 'outbound')
        throw new Error('Chưa xác định được người gọi ban đầu để tạo nhóm.')
      logger.info('CALL', '👥 Nâng cấp cuộc gọi 1-1 lên cuộc gọi nhóm Ad-hoc Conference...')
      this.state.isGroupCall = true
      this.state.isGroupHost = true
      this.state.groupHostExtension = myExt
      const peerExt = String(callState.activeCall?.number || '').trim()
      this.state.groupParticipantExtensions = [myExt]
      if (peerExt && !this.state.groupParticipantExtensions.includes(peerExt)) {
        this.state.groupParticipantExtensions.push(peerExt)
      }
      this.state.groupConnectedExtensions =
        callState.activeCall.status === 'connected'
          ? [...this.state.groupParticipantExtensions]
          : [myExt]
      if (callState.activeCall) {
        callState.activeCall.isGroupCall = true
        callState.activeCall.isGroupHost = true
        callState.activeCall.groupHostExtension = myExt
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length + extensions.length} người)`
      }
    } else if (!this.state.isGroupHost) {
      const hostExt = this.state.groupHostExtension || callState.activeCall?.number
      if (hostExt && hostExt !== myExt) {
        return this.delegateAddParticipantsToHost(hostExt, extensions)
      }
    }

    const toInvite = []
    const busyOrUnavailable = []
    for (const ext of extensions) {
      const s = String(ext || '').trim()
      if (!s || s === myExt) continue

      if (!this.contactService.isContactAvailableForCall(s)) {
        const c = this.contactService.findContactByExtension(s)
        const nameOrExt = c?.name ? `${c.name} (${s})` : `Máy lẻ ${s}`
        busyOrUnavailable.push({ ext: s, label: nameOrExt })
        continue
      }

      if (!this.state.groupParticipantExtensions.includes(s)) {
        this.state.groupParticipantExtensions.push(s)
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
      this.broadcastNoticeToGroup(
        `Máy lẻ ${busyOrUnavailable.map((b) => b.ext).join(', ')} đang bận`,
      )
    }

    if (toInvite.length === 0) {
      this.broadcastGroupStateViaPresence()
      return
    }

    logger.info('CALL', `Mời thêm thành viên vào nhóm: ${toInvite.join(', ')}`)
    if (callState.activeCall) {
      callState.activeCall.isGroupCall = true
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
    }
    this.broadcastGroupStateViaPresence()

    // Khởi tạo các nhánh gọi tới từng máy lẻ qua WebRTC Phone mà không hold nhánh trước
    for (const ext of toInvite) {
      if (!current()) return
      const phoneInstance = this.sdk.Phone?.phone
      const prevSipSession = phoneInstance?.currentSipSession
      const prevCallSession = phoneInstance?.currentCallSession
      try {
        logger.info('CALL', `Đang gửi tín hiệu gọi nhánh thành viên: ${ext}...`)

        // Bảo vệ nhánh đầu tiên: tạm thời tách currentSipSession để this.sdk.Phone không gửi lệnh hold sai quy cách lên nhánh đang đổ chuông
        if (phoneInstance && phoneInstance.currentSipSession) {
          phoneInstance.currentSipSession = null
        }

        const session = await this.callService.requestSdkCall(ext)
        if (!current()) {
          if (session) await this.sdk.Phone.hangup(session).catch(() => {})
          return
        }

        if (!session) throw new Error('SDK chưa tạo được nhánh gọi tới thành viên.')
        if (session) {
          this.state.secondaryCallSessions.set(ext, session)
          this.startParticipantInviteTimeout(ext, session)
          this.callService.replayPendingCallEvents(session)
        }
      } catch (err) {
        if (!current()) return
        logger.warn('CALL', `Không thể gọi nhánh ${ext}:`, err.message || err)
        this.state.groupParticipantExtensions = this.state.groupParticipantExtensions.filter(
          (member) => member !== ext,
        )
        this.clearParticipantInviteTimeout(ext)
        this.state.secondaryCallSessions.delete(ext)
        this.broadcastGroupStateViaPresence()
        this.broadcastNoticeToGroup(`Không thể kết nối máy lẻ ${ext}`)
      } finally {
        if (current() && phoneInstance && prevSipSession) {
          phoneInstance.currentSipSession = prevSipSession
          phoneInstance.currentCallSession = prevCallSession
        }
      }
    }
  }

  /** Đặt thời hạn chờ trả lời của nhánh gọi đầu tiên. */
  startPrimaryInviteTimeout(targetExt) {
    if (
      this.callService.answeredSipIds.has(
        this.callService.getSipSessionId(this.callService.currentCallSession),
      )
    )
      return
    this.clearPrimaryInviteTimeout()
    this._primaryInviteTimer = setTimeout(() => {
      this.cancelPrimaryInvite(targetExt)
    }, 30000)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh chính [${targetExt}].`)
  }

  /** Hủy timer chờ nhánh đầu tiên sau khi kết nối hoặc kết thúc. */
  clearPrimaryInviteTimeout() {
    if (this._primaryInviteTimer) {
      clearTimeout(this._primaryInviteTimer)
      this._primaryInviteTimer = null
    }
  }

  cancelPrimaryInvite(targetExt) {
    this.clearPrimaryInviteTimeout()
    const primary = this.callService.currentCallSession
    // Một nhánh khác nghe máy không có nghĩa nhánh chính đã nghe; kiểm tra riêng từng lời mời.
    const answered =
      this.state.groupConnectedExtensions.includes(targetExt) ||
      primary?.answered ||
      this.callService.answeredSipIds.has(this.callService.getSipSessionId(primary))
    if (this.state.isGroupCall && this.state.isGroupHost && callState.activeCall && !answered) {
      logger.warn(
        'CALL',
        `Nhánh chính [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh chính.`,
      )
      const session = this.callService.currentCallSession
      if (session) {
        try {
          this._runPhoneCleanup(() => this.sdk.Phone.hangup(session))
        } catch (e) {
          /* ignore */
        }
      }

      // Gỡ targetExt khỏi groupParticipantExtensions
      this.state.groupParticipantExtensions = this.state.groupParticipantExtensions.filter(
        (e) => e !== targetExt,
      )
      if (callState.activeCall) {
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
      }
      this.broadcastGroupStateViaPresence()

      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⏱️ Máy lẻ [${targetExt}] không trả lời sau 30 giây.`,
            type: 'warning',
          },
        }),
      )
      this.broadcastNoticeToGroup(`Máy lẻ ${targetExt} không trả lời sau 30 giây`)

      // Nếu còn nhánh phụ đang hoạt động hoặc đang đổ chuông, chuyển nhánh phụ lên
      if (this.state.secondaryCallSessions.size > 0) {
        const [nextExt, nextSession] = this.state.secondaryCallSessions.entries().next().value
        logger.info(
          'CALL',
          `Tự động chuyển nhánh [${nextExt}] lên làm nhánh chính tiếp tục cuộc gọi nhóm.`,
        )
        this.state.secondaryCallSessions.delete(nextExt)
        this.callService.currentCallSession = nextSession
        if (callState.activeCall) {
          callState.activeCall.number = nextExt
          callState.activeCall.session = nextSession
        }
        this.broadcastGroupStateViaPresence()
      } else if (!this.isAnyParticipantConnected()) {
        logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.',
              type: 'warning',
            },
          }),
        )
        this.callService.hangupCurrentCall()
      }
    }
  }

  /** Kiểm tra nhóm đã có ít nhất một người tham gia kết nối. */
  isAnyParticipantConnected() {
    if (!this.callService.hasActiveCall()) return false
    const myExt = this.authService.getCurrentExtension()
    const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)

    if (callState.activeCall?.status === 'connected') {
      if (this.state.isGroupCall) {
        if (
          remainingOthers.length > 0 &&
          (this.state.extensionToWazoCallIdMap.size > 0 ||
            this.state.activeAdhocConferenceId ||
            this.callService.currentCallSession)
        ) {
          return true
        }
      } else {
        return true
      }
    }

    if (this.state.extensionToWazoCallIdMap && this.state.extensionToWazoCallIdMap.size > 0) {
      return true
    }

    return false
  }

  /** Đặt thời hạn chờ trả lời cho một máy lẻ được mời. */
  startParticipantInviteTimeout(ext, session) {
    if (this.callService.answeredSipIds.has(this.callService.getSipSessionId(session))) return
    this.clearParticipantInviteTimeout(ext)
    const timer = setTimeout(() => {
      this.cancelParticipantInvite(ext)
    }, 30000)
    this._secondaryInviteTimers.set(ext, timer)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh phụ [${ext}].`)
  }

  /** Hủy timer lời mời của máy lẻ đã có kết quả. */
  clearParticipantInviteTimeout(ext) {
    if (this._secondaryInviteTimers.has(ext)) {
      clearTimeout(this._secondaryInviteTimers.get(ext))
      this._secondaryInviteTimers.delete(ext)
    }
  }

  /** Thu hồi toàn bộ timer lời mời khi cuộc gọi nhóm kết thúc. */
  clearAllParticipantInviteTimeouts() {
    for (const [, timer] of this._secondaryInviteTimers.entries()) {
      clearTimeout(timer)
    }
    this._secondaryInviteTimers.clear()
  }

  cancelParticipantInvite(targetExt) {
    this.clearParticipantInviteTimeout(targetExt)
    const session = this.state.secondaryCallSessions.get(targetExt)
    if (
      this.state.groupConnectedExtensions.includes(targetExt) ||
      session?.answered ||
      this.callService.answeredSipIds.has(this.callService.getSipSessionId(session))
    )
      return
    if (session) {
      const sipId = session.sipCallId || (session.getId && session.getId()) || session.id
      if (sipId) {
        this._terminatingSecondarySipIds.add(String(sipId))
      }
      logger.warn(
        'CALL',
        `Nhánh phụ [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh phụ.`,
      )
      try {
        this._runPhoneCleanup(() => this.sdk.Phone.hangup(session))
      } catch (e) {
        /* ignore */
      }
      // Không delete khỏi this.state.secondaryCallSessions ngay để _finalizeCallTermination nhận diện được nhánh phụ!
    }

    // Gỡ khỏi groupParticipantExtensions nếu chưa bao giờ kết nối
    const idx = this.state.groupParticipantExtensions.indexOf(targetExt)
    if (idx >= 0) {
      this.state.groupParticipantExtensions.splice(idx, 1)
      if (callState.activeCall) {
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
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
    const myExt = this.authService.getCurrentExtension()
    const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
    if (
      remainingOthers.length === 0 &&
      !this.isAnyParticipantConnected() &&
      (!this.callService.currentCallSession || callState.activeCall?.status !== 'ringing')
    ) {
      logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.',
            type: 'warning',
          },
        }),
      )
      this.callService.hangupCurrentCall()
    }
  }

  /**
   * Thành viên ủy quyền cho Chủ phòng đứng ra quay số và gộp vào nhóm
   * Phát thẻ [ADD_REQ:reqId:hostExt:ext1,ext2] lên Presence
   */
  async delegateAddParticipantsToHost(hostExt, targetExtensions) {
    if (!hostExt || !targetExtensions || targetExtensions.length === 0) return
    const sessionContext = captureSessionContext()
    const callEpoch = this.callService.callGeneration
    const callId = callState.activeCall?.callId
    const myExt = this.authService.getCurrentExtension()
    const toInviteNow = []
    const dropped = []

    for (const rawExt of targetExtensions) {
      const e = String(rawExt || '').trim()
      if (!e || e === myExt || e === hostExt) continue
      if (this.contactService.isContactAvailableForCall(e)) {
        toInviteNow.push(e)
      } else {
        const c = this.contactService.findContactByExtension(e)
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
    const sent = await this.authService.updatePresence('unavailable', `Đang bận ${reqTag}`)
    // ACK của cuộc gọi cũ không được báo thành công/lỗi sau khi người dùng đã cúp hoặc đổi phiên.
    if (
      !isSessionContextCurrent(sessionContext) ||
      callEpoch !== this.callService.callGeneration ||
      callState.activeCall?.callId !== callId
    )
      return
    if (!sent) throw new Error('Không gửi được yêu cầu thêm người tới chủ phòng. Vui lòng thử lại.')
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `📤 Đã gửi yêu cầu thêm người tới Chủ phòng (${hostExt})`,
          type: 'info',
        },
      }),
    )
  }

  /** Phát thông báo cuộc gọi tới các thành viên theo kênh presence. */
  broadcastNoticeToGroup(message) {
    // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
    if (!this.state.isGroupCall || !this.state.isGroupHost) return
    const noticeId = Date.now()
    const myExt = this.authService.getCurrentExtension()
    const noticeTag = `[NOTICE:${noticeId}:${myExt}:${message}]`
    this.authService.updatePresence('unavailable', `Đang gọi nhóm ${noticeTag}`)
  }

  /** Gộp các yêu cầu đồng bộ hội nghị để tránh thực hiện song song. */
  syncActiveCallsToAdhocConference() {
    // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
    if (!this.callService.hasActiveCall() || !this.state.isGroupCall || !this.state.isGroupHost)
      return

    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }

    this._syncAdhocDebounceTimer = setTimeout(async () => {
      this._syncAdhocDebounceTimer = null
      if (this._isSyncingAdhoc) return
      const callEpoch = this.callService.callGeneration
      this._isSyncingAdhoc = true
      try {
        await this.synchronizeActiveCalls()
      } catch (err) {
        logger.warn('CALL', 'Lỗi trong quá trình đồng bộ Ad-hoc Conference:', err)
      } finally {
        // Callback của cuộc gọi cũ không được thay đổi hàng đợi/cuộc gọi mới.
        if (callEpoch === this.callService.callGeneration) {
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
    for (const { reason, session } of pending)
      this.callService.finalizeCallTermination(reason, session)
  }

  async synchronizeActiveCalls() {
    const sessionContext = captureSessionContext()
    if (!this.callService.hasActiveCall() || !this.state.isGroupCall || !this.state.isGroupHost)
      return

    const callEpoch = this.callService.callGeneration
    const current = () =>
      callEpoch === this.callService.callGeneration &&
      isSessionContextCurrent(sessionContext) &&
      this.callService.hasActiveCall()
    const activeCalls = await this.callControlApi.listActiveCalls()
    if (!current()) return
    if (!activeCalls || activeCalls.length === 0) return

    // 1. Xác định hostCallId từ primary session của Host
    let hostCallId = ''
    const myPrimarySipId = this.callService.getSipSessionId(this.callService.currentCallSession)

    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      if (myPrimarySipId && String(sipId) === myPrimarySipId) {
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
    let connectedChanged = false
    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      const isTalking =
        callObj.status === 'talking' ||
        (callObj.talking_to &&
          typeof callObj.talking_to === 'object' &&
          Object.keys(callObj.talking_to).length > 0)

      if (callObj.talking_to && typeof callObj.talking_to === 'object') {
        const peerIds = Object.keys(callObj.talking_to)
        for (const peerId of peerIds) {
          if (peerId && peerId !== hostCallId) {
            // Sau khi ghép, một kênh có thể talking_to nhiều người. Giữ ánh xạ đã biết,
            // không gán mọi peer vào activeCall.number làm B/C đè ID của nhau.
            let matchedExt = [...this.state.extensionToWazoCallIdMap].find(
              ([, id]) => String(id) === String(peerId),
            )?.[0]
            if (!matchedExt && peerIds.length === 1) {
              for (const [ext, secSession] of this.state.secondaryCallSessions.entries()) {
                const secSip = this.callService.getSipSessionId(secSession)
                if (secSip && sipId && secSip === String(sipId)) {
                  matchedExt = ext
                  break
                }
              }
              if (!matchedExt && myPrimarySipId === String(sipId))
                matchedExt = normalizeExtension(callState.activeCall?.number)
            }
            if (matchedExt && this.state.groupParticipantExtensions.includes(matchedExt)) {
              const previousId = this.state.extensionToWazoCallIdMap.get(matchedExt)
              if (
                this.state.activeAdhocConferenceId &&
                previousId &&
                String(previousId) !== String(peerId)
              )
                continue
              this.state.extensionToWazoCallIdMap.set(matchedExt, peerId)
              // Calld talking/holding là bằng chứng phụ khi SDK accepted đã bị bỏ lỡ.
              if (callObj.status === 'talking' || callObj.status === 'holding') {
                connectedChanged =
                  this._markGroupParticipantConnected(matchedExt, false) || connectedChanged
              }
            }
          }
        }
      } else if (isTalking && cid !== hostCallId) {
        hasUnbridgedLeg = true
      }
    }
    if (connectedChanged) this.broadcastGroupStateViaPresence()

    // Nếu có nhánh phụ đã talking nhưng Asterisk chưa kịp link talking_to -> Hẹn giờ thử lại sau 300ms
    if (hasUnbridgedLeg && this.state.extensionToWazoCallIdMap.size < 2) {
      logger.info(
        'CALL',
        'Đang đợi máy chủ Asterisk điền talking_to cho nhánh phụ, sẽ thử lại sau 300ms...',
      )
      setTimeout(() => {
        if (this.callService.hasActiveCall() && this.state.isGroupCall && this.state.isGroupHost) {
          this.syncActiveCallsToAdhocConference()
        }
      }, 300)
    }

    // Hủy bộ đếm timeout 30s cho các nhánh đã kết nối thành công vào extensionToWazoCallIdMap
    for (const [secExt] of this.state.secondaryCallSessions.entries()) {
      if (this.state.extensionToWazoCallIdMap.has(secExt)) {
        this.clearParticipantInviteTimeout(secExt)
      }
    }

    const participantCallIds = Array.from(
      new Set(this.state.extensionToWazoCallIdMap.values()),
    ).filter((id) => id && id !== hostCallId)

    // Nếu chưa đủ 2 nhánh thành viên (chỉ có Host + 1 người nghe máy) và chưa có phòng họp nhóm:
    if (participantCallIds.length < 2 && !this.state.activeAdhocConferenceId) {
      logger.info(
        'CALL',
        `Chưa đủ 2 thành viên đàm thoại (hiện có ${participantCallIds.length} người nghe máy). Duy trì thoại trực tiếp và chờ người tiếp theo...`,
      )
      // Nếu nhánh chính vẫn đang ringing mà đã có 1 nhánh phụ talking -> Đưa âm thanh nhánh nghe máy lên đàm thoại ngay (Đối chiếu WazoSipCallManager.py line 1780)
      if (
        callState.activeCall &&
        callState.activeCall.status === 'ringing' &&
        participantCallIds.length === 1
      ) {
        callState.activeCall.status = 'connected'
        callState.activeCall.startTime = Date.now()
        this.callToneService.stopRingbackTone()
        for (const [secExt, secSession] of this.state.secondaryCallSessions.entries()) {
          try {
            const stream = this.sdk.Phone.getRemoteStream(secSession)
            if (stream) {
              this.phoneAdapter.playCallAudio(stream)
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
    if (this.state.activeAdhocConferenceId) {
      for (const pId of participantCallIds) {
        if (!this.state.mergedCallIds.has(pId) && pId !== hostCallId) {
          const added = await this.callControlApi.addConferenceParticipant(
            this.state.activeAdhocConferenceId,
            pId,
          )
          if (!current()) return
          if (added) this.state.mergedCallIds.add(pId)
          else this.scheduleConferenceRetry(callEpoch)
        }
      }
      this.broadcastGroupStateViaPresence()
      return
    }

    // Chưa có conference_id: Tạo mới Ad-hoc Conference khi có ít nhất 2 thành viên
    const toMerge = participantCallIds.filter((id) => id !== hostCallId)
    if (toMerge.length >= 2 && hostCallId) {
      toMerge.forEach((id) => this.state.mergedCallIds.add(id))
      const confId = await this.callControlApi.createConference(hostCallId, toMerge)
      if (!current()) {
        if (confId && isSessionContextCurrent(sessionContext))
          await this.callControlApi.deleteConference(confId)
        return
      }
      if (confId) {
        this.state.activeAdhocConferenceId = confId
        if (callState.activeCall) {
          callState.activeCall.activeAdhocConferenceId = confId
        }
        this.broadcastGroupStateViaPresence()
      } else {
        this.state.mergedCallIds.clear()
        this.scheduleConferenceRetry(callEpoch)
      }
    }
  }

  /**
   * Xử lý khi có thành viên rời phòng họp nhóm (Callee cúp máy hoặc nhận thẻ [LEFT:])
   * Cập nhật danh sách nhóm và nếu chỉ còn 1 người thì tự động kết thúc cuộc gọi
   */
  handleParticipantLeftGroupCall(leftCallIdOrExt) {
    if (!this.state.isGroupCall) return

    let leftExt = null
    const targetStr = String(leftCallIdOrExt).trim()

    // 1. Kiểm tra xem có khớp thẳng với extension không
    if (this.state.groupParticipantExtensions.includes(targetStr)) {
      leftExt = targetStr
    } else {
      // 2. Tìm trong extensionToWazoCallIdMap
      for (const [ext, cId] of this.state.extensionToWazoCallIdMap.entries()) {
        if (String(cId) === targetStr) {
          leftExt = ext
          break
        }
      }
    }

    if (!leftExt) return

    const myExt = this.authService.getCurrentExtension()
    // Tuyệt đối không tự xóa chính mình khỏi nhóm
    if (leftExt === myExt) return

    // Hủy timer timeout nếu còn
    this.clearParticipantInviteTimeout(leftExt)

    logger.info('CALL', `Thành viên [${leftExt}] đã rời cuộc gọi nhóm.`)
    const cId = this.state.extensionToWazoCallIdMap.get(leftExt)
    if (cId) this.state.mergedCallIds.delete(cId)
    this.state.extensionToWazoCallIdMap.delete(leftExt)
    this.state.secondaryCallSessions.delete(leftExt)

    this.state.groupParticipantExtensions = this.state.groupParticipantExtensions.filter(
      (e) => e !== leftExt,
    )
    if (callState.activeCall) {
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
      callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`

      // Khi một thành viên rời đi, nếu activeCall.number đang trỏ vào thành viên đó, chuyển sang thành viên tiếp theo còn lại
      if (callState.activeCall.number === leftExt) {
        const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
        if (remainingOthers.length > 0) {
          callState.activeCall.number = remainingOthers[0]
          const contact = this.contactService.findContactByExtension(remainingOthers[0])
          if (contact?.name) {
            callState.activeCall.name = contact.name
          }
        }
      }
    }

    this._syncGroupDisplayState()
    // Nếu máy này là thành viên và nhận tin Chủ phòng rời khỏi cuộc gọi -> kết thúc cuộc gọi
    if (!this.state.isGroupHost && leftExt === this.state.groupHostExtension) {
      logger.info(
        'CALL',
        `Chủ phòng (${this.state.groupHostExtension}) đã kết thúc cuộc gọi -> Ngắt máy thành viên.`,
      )
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
        }),
      )
      this.callService.hangupCurrentCall()
      return
    }

    if (this.state.isGroupHost) {
      this.broadcastGroupStateViaPresence()

      // Nếu trong nhóm chỉ còn lại đúng 1 người (chính là Host) và không còn nhánh phụ nào đang đổ chuông
      const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
      if (remainingOthers.length === 0 && this.state.secondaryCallSessions.size === 0) {
        logger.info('CALL', 'Tất cả thành viên đã rời nhóm. Tự động kết thúc cuộc gọi.')
        this.callService.hangupCurrentCall()
      }
    }

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `👋 Máy lẻ ${leftExt} đã rời cuộc gọi nhóm.`, type: 'info' },
      }),
    )
  }

  /** Tạo ID ngắn cho snapshot/request; không dùng tên hiển thị để ràng buộc một cuộc gọi. */
  _createGroupSignalId() {
    return (
      globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24) ||
      Date.now().toString(36) + '_' + Math.random().toString(36).slice(2)
    )
  }

  /** Một nguồn dữ liệu hiển thị: thành viên được mời, đã kết nối và còn đổ chuông là các tập riêng. */
  _syncGroupDisplayState() {
    if (!this.state.isGroupCall) return
    this.state.groupParticipantExtensions = [
      ...new Set(this.state.groupParticipantExtensions.map(normalizeExtension)),
    ]
    const connected = this.state.groupConnectedExtensions.filter((ext) =>
      this.state.groupParticipantExtensions.includes(ext),
    )
    if (
      this.state.isGroupHost &&
      this.state.groupParticipantExtensions.includes(this.authService.getCurrentExtension())
    )
      connected.unshift(this.authService.getCurrentExtension())
    this.state.groupConnectedExtensions = [...new Set(connected)]
    this.state.groupPendingExtensions = this.state.groupParticipantExtensions.filter(
      (ext) => !this.state.groupConnectedExtensions.includes(ext),
    )
    for (const call of [callState.activeCall, callState.incomingCall]) {
      if (!call) continue
      Object.assign(call, {
        isGroupCall: true,
        isGroupHost: this.state.isGroupHost,
        groupHostExtension: this.state.groupHostExtension,
        groupParticipantExtensions: [...this.state.groupParticipantExtensions],
        groupConnectedExtensions: [...this.state.groupConnectedExtensions],
        groupPendingExtensions: [...this.state.groupPendingExtensions],
        groupTitle: `Cuộc gọi nhóm (${this.state.groupConnectedExtensions.length} người)`,
      })
    }
  }

  /** Chỉ host xác nhận kết nối sau ACK nhánh; mời/đổ chuông không làm tăng số người đã vào nhóm. */
  _markGroupParticipantConnected(extension, publish = true) {
    const ext = normalizeExtension(extension)
    if (
      !this.state.isGroupCall ||
      !this.state.isGroupHost ||
      !this.state.groupParticipantExtensions.includes(ext)
    )
      return false
    if (this.state.groupConnectedExtensions.includes(ext)) return false
    this.state.groupConnectedExtensions.push(ext)
    this._syncGroupDisplayState()
    if (publish) this.broadcastGroupStateViaPresence()
    return true
  }

  /** Máy nhận yêu cầu snapshot khi incoming/accepted, tránh mất GROUP phát trước khi SIP tạo nhánh. */
  async _requestGroupStateSync(phase) {
    const call = callState.activeCall || callState.incomingCall
    if (
      !call ||
      (callState.activeCall && call.direction !== 'inbound') ||
      this.state.isGroupHost ||
      !this.authService.isAuthenticated()
    )
      return false
    const session = call.rawSession || call.session || this.callService.currentCallSession
    const sipId = this.callService.getSipSessionId(session)
    if (!sipId) return false
    const context = captureSessionContext(),
      epoch = this.callService.callGeneration
    const key = epoch + ':' + sipId + ':' + phase
    if (this._groupSyncRequestKeys.has(key)) return false
    const host = this.state.groupHostExtension || normalizeExtension(call.number || call.extension)
    let contact = this.contactService.findContactByExtension(host)
    if (!contact?.uuid && typeof this.contactService.getContacts === 'function') {
      await this.contactService.getContacts()
      contact = this.contactService.findContactByExtension(host)
    }
    if (
      !contact?.uuid ||
      !isSessionContextCurrent(context) ||
      epoch !== this.callService.callGeneration ||
      !this.callService.isManagedCallSession(session) ||
      this._groupSyncRequestKeys.has(key)
    )
      return false
    const requestId = this._createGroupSignalId()
    this._groupSyncRequestKeys.add(key)
    this._groupSyncRequestIds.add(requestId)
    const sent = await this.authService.updatePresence(
      'unavailable',
      `[GROUP_SYNC:${requestId}:${host}]`,
    )
    if (!sent && epoch === this.callService.callGeneration) {
      this._groupSyncRequestKeys.delete(key)
      this._groupSyncRequestIds.delete(requestId)
    }
    return sent
  }

  /** Lệnh dọn nhánh có thể reject bất đồng bộ; try/catch bên ngoài không bắt được Promise. */
  _runPhoneCleanup(command) {
    const context = captureSessionContext()
    const failed = (error) => {
      logger.warn(
        'SIP',
        'Chưa xác nhận được thao tác kết thúc nhánh thoại:',
        error?.message || 'Lỗi chưa xác định',
      )
      if (isSessionContextCurrent(context) && this.authService.isAuthenticated()) {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              type: 'warning',
              message:
                'Chưa xác nhận được thao tác kết thúc cuộc gọi với tổng đài. Vui lòng kiểm tra kết nối.',
            },
          }),
        )
      }
      return false
    }
    try {
      return Promise.resolve(command()).then(() => true, failed)
    } catch (error) {
      return Promise.resolve(failed(error))
    }
  }

  /** Host phát snapshot có phiên bản; GROUP giữ danh sách mời để client cũ vẫn đọc được. */
  broadcastGroupStateViaPresence(acknowledgement = '') {
    if (!this.state.isGroupCall || !this.state.isGroupHost) return
    this._syncGroupDisplayState()
    if (!this._groupSnapshotId) this._groupSnapshotId = this._createGroupSignalId()
    const revision = ++this._groupSnapshotRevision
    const myExt = this.authService.getCurrentExtension()
    const hostExt = this.state.groupHostExtension || myExt
    const exts =
      this.state.groupParticipantExtensions.length > 0
        ? this.state.groupParticipantExtensions
        : [myExt]
    const groupTag = `[GROUP:${hostExt}:${exts.join(',')}]`
    const stateTag = `[GROUP_STATE:${this._groupSnapshotId}:${revision}:${this.state.groupConnectedExtensions.join(',')}${acknowledgement ? ':' + acknowledgement : ''}]`
    return this.authService.updatePresence('unavailable', `Đang gọi nhóm ${groupTag}${stateTag}`)
  }

  /** Tăng thế hệ cuộc gọi và dọn state, timer, Map của hội nghị. */
  resetGroupState() {
    this.callService.callGeneration += 1
    this.state.groupConnectedExtensions = []
    this.state.groupPendingExtensions = []
    this._groupSnapshotId = ''
    this._groupSnapshotRevision = 0
    this._groupSyncRequestIds.clear()
    this._groupSyncRequestKeys.clear()
    this._processedGroupSyncIds.clear()
    this._pendingConferenceTerminations.clear()
    this.callService.pendingCallEvents.clear()
    this.callService.answeredSipIds.clear()
    clearTimeout(this._syncAdhocRetryTimer)
    this._syncAdhocRetryTimer = null
    this._adhocRetryCount = 0
    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }
    this.clearAllParticipantInviteTimeouts()
    this.clearPrimaryInviteTimeout()
    this._processedAddReqIds.clear()
    this._processedNoticeIds.clear()
    this._terminatingSecondarySipIds.clear()
    this._isSyncingAdhoc = false
    this.state.activeAdhocConferenceId = ''
    this.state.isGroupCall = false
    this.state.isGroupHost = false
    this.state.groupHostExtension = ''
    this.state.groupParticipantExtensions = []
    this.state.extensionToWazoCallIdMap.clear()
    this.state.mergedCallIds.clear()
    this.state.secondaryCallSessions.clear()
  }
}
