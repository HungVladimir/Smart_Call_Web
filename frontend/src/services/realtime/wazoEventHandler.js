import { logger } from '../common/loggerService.js'
import { callState } from '../../state/callState.js'
import { normalizeExtension } from '../../utils/callPolicy.js'

/** Xử lý envelope theo protocol Wazo; transport không chứa quy tắc cuộc gọi hoặc nhóm. */
export function handleWazoEvent(context, envelope) {
  try {
    if (!context.authService.isAuthenticated() || context.authService.isSessionRevoked) return
    const msg = envelope
    const ev = msg.op === 'event' ? msg.data : msg
    const name = ev?.name || ''
    const data = ev?.data || {}

    // Phát sự kiện presence cho toàn hệ thống
    if (name.includes('presence')) {
      window.dispatchEvent(new CustomEvent('wazo-presence-updated', { detail: data }))

      handleGroupPresenceSignal(context, data)

      // Single Device Login: Nếu presence của chính user chứa Session ID / Client ID mới từ thiết
      // bị khác hoặc thiết bị Android
      const myUuid = context.authService.getCurrentUserUuid()
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
          const isOtherWebDevice =
            statusStr.includes('smartcall-web') &&
            context.authService.clientId &&
            !statusStr.includes(context.authService.clientId)
          const isLegacyOtherWeb =
            statusStr.includes('sess_') &&
            context.authService.mySessionId &&
            !statusStr.includes(context.authService.mySessionId) &&
            (!context.authService.clientId || !statusStr.includes(context.authService.clientId))

          if (isAndroidDevice || isOtherWebDevice || isLegacyOtherWeb) {
            logger.warn(
              'AUTH',
              `⚡ Phát hiện phiên đăng nhập mới (${statusStr}) từ thiết bị khác. Thực hiện đăng xuất tức thì (0.1s)!`,
            )
            context.authService.handleSessionRevocation()
            return
          }
        }
      }
    }

    // Khi có nhánh nghe máy trong cuộc gọi nhóm, tự động kích hoạt đồng bộ Ad-hoc Conference (Đã
    // có debounce 350ms)
    if (
      (name === 'call_answered' || name === 'call_updated') &&
      context.groupCallService.state.isGroupCall &&
      context.groupCallService.state.isGroupHost
    ) {
      context.groupCallService.syncActiveCallsToAdhocConference()
    }

    handleConferenceEvent(context, name, data)

    // Xử lý sự kiện thành viên rời phòng Ad-hoc Conference hoặc gác máy
    if (
      name === 'adhoc_conference_participant_left' ||
      name === 'conference_user_participant_left' ||
      name === 'call_ended'
    ) {
      const leftCallId = data?.call_id || data?.participant_id || data?.id
      // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
      if (
        context.groupCallService.state.isGroupCall &&
        context.groupCallService.state.isGroupHost &&
        leftCallId
      ) {
        context.groupCallService.handleParticipantLeftGroupCall(leftCallId)
      }
    }

    // Chuyển tiếp tới các subscriber của websocketService (chat, call)
    context.eventHub.emit(name, data)
  } catch (e) {
    /* ignore */
  }
}

/** Chỉ dùng UUID do envelope server cung cấp, không suy người phát từ alias hoặc tag text. */
function resolveSender(context, data) {
  const uuid = data.user_uuid || data.uuid
  // Thiếu hoặc mâu thuẫn UUID server thì bỏ tín hiệu; không suy người phát từ tên hiển thị hay nội
  // dung tag.
  if (!uuid || (data.user_uuid && data.uuid && data.user_uuid !== data.uuid)) return null
  if (uuid === context.authService.getCurrentUserUuid()) return null // Echo của chính Web không cấp lại vai trò.
  const contact = context.contactService.findContactByUuid(uuid)
  if (!contact || contact.uuid !== uuid) return null
  const extension = normalizeExtension(contact.number)
  if (!extension) return null
  const owners = new Set(
    context.contactService.currentContacts
      .filter((item) => normalizeExtension(item.number) === extension)
      .map((item) => item.uuid),
  )
  // Một máy lẻ phải thuộc duy nhất UUID đã xác minh; danh bạ trùng máy lẻ không đủ an toàn để cấp
  // quyền điều khiển.
  if (owners.size !== 1 || !owners.has(uuid)) return null
  return { uuid, extension }
}

/**
 * Tách danh sách máy lẻ trong tag presence, chuẩn hóa và loại đầu vào rỗng/sai định dạng/trùng
 * lặp.
 */
function extensions(value) {
  const list = value.split(',').map(normalizeExtension)
  if (list.some((item) => !item || item.includes(':') || item.includes(']') || /\s/.test(item)))
    return null
  return [...new Set(list)]
}

/**
 * Ràng buộc group signal với người phát và peer/nhóm đang hoạt động; không tự nhận chuyển quyền
 * host.
 */
export function handleGroupPresenceSignal(context, data) {
  const currentCall = callState.activeCall || callState.incomingCall
  if (!currentCall || !context.callService.hasActiveCall() || typeof data.status !== 'string')
    return
  const matches = [...data.status.matchAll(/\[(GROUP|ADD_REQ|NOTICE|LEFT):([^\]]+)\]/g)]
  if (matches.length !== 1) return
  const sender = resolveSender(context, data)
  if (!sender) return
  const [, kind, payload] = matches[0]
  const group = context.groupCallService
  const state = group.state
  const me = context.authService.getCurrentExtension()
  const peer = normalizeExtension(currentCall.number || currentCall.extension)
  const host = state.groupHostExtension
  const established = state.isGroupCall && Boolean(host)
  const member = established && state.groupParticipantExtensions.includes(sender.extension)

  if (kind === 'GROUP') {
    const [declaredHost, csv, ...extra] = payload.split(':')
    const participants = csv && extensions(csv)
    if (
      extra.length ||
      declaredHost !== sender.extension ||
      declaredHost === me ||
      !participants ||
      !participants.includes(me) ||
      !participants.includes(declaredHost)
    )
      return
    // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
    if (established ? host !== sender.extension || state.isGroupHost : peer !== sender.extension)
      return
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
  // Người phát phải thuộc nhóm hiện tại trước khi được yêu cầu mời người hoặc báo rời nhóm.
  if (!member) return
  if (kind === 'LEFT') {
    if (payload !== sender.extension || payload === me) return
    group.handleParticipantLeftGroupCall(sender.extension)
    return
  }
  if (kind === 'ADD_REQ') {
    // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
    if (!state.isGroupHost || host !== me) return
    const connectedMember =
      (peer === sender.extension && currentCall.status === 'connected') ||
      state.extensionToWazoCallIdMap.has(sender.extension) ||
      state.secondaryCallSessions.get(sender.extension)?.answered === true
    if (!connectedMember) return
    const parts = payload.split(':')
    if (parts.length !== 2 && parts.length !== 3) return
    const [requestId, targetHost, csv] = parts.length === 3 ? parts : ['', ...parts]
    const requested = extensions(csv)
    if (targetHost !== me || !requested) return
    const targets = requested.filter(
      (extension) => !state.groupParticipantExtensions.includes(extension),
    )
    if (!targets.length) return
    // Android cũ không có request ID: giới hạn một nội dung yêu cầu/người phát trong cuộc gọi hiện
    // tại.
    const key = sender.uuid + ':' + (requestId || csv)
    // Bỏ tín hiệu/tin nhắn đã xử lý để event lặp không tạo thêm lời mời hoặc bản sao dữ liệu.
    if (group._processedAddReqIds.has(key)) return
    group._processedAddReqIds.add(key)
    Promise.resolve(group.addParticipantsToGroupCall(targets)).catch((error) =>
      logger.warn('CALL', 'Không thể thực hiện yêu cầu mời từ thành viên:', error.message),
    )
    return
  }
  if (kind === 'NOTICE') {
    const [noticeId, declaredHost, ...message] = payload.split(':')
    // Chọn đúng nhánh host/thành viên trước khi điều phối hội nghị hoặc gửi tín hiệu nhóm.
    if (
      state.isGroupHost ||
      sender.extension !== host ||
      declaredHost !== host ||
      !noticeId ||
      !message.length
    )
      return
    const key = sender.uuid + ':' + noticeId
    // Bỏ tín hiệu/tin nhắn đã xử lý để event lặp không tạo thêm lời mời hoặc bản sao dữ liệu.
    if (group._processedNoticeIds.has(key)) return
    group._processedNoticeIds.add(key)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: '🔔 ' + message.join(':'), type: 'warning' },
      }),
    )
  }
}

/** Không dùng một event hội nghị bất kỳ để kết thúc cuộc gọi hiện tại. */
function handleConferenceEvent(context, name, data) {
  const group = context.groupCallService.state
  if (!group.isGroupCall || !context.callService.hasActiveCall()) return
  const conferenceId =
    data?.conference_id ||
    data?.conference_uuid ||
    (name === 'adhoc_conference_deleted' ? data?.id : '')
  if (!conferenceId) return
  if (
    name === 'adhoc_conference_participant_joined' ||
    name === 'conference_user_participant_joined'
  ) {
    const callId =
      context.callService.currentCallSession?.callId || callState.activeCall?.session?.callId
    // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
    // đổi state.
    if (
      callId &&
      data.call_id &&
      String(callId) === String(data.call_id) &&
      (!group.activeAdhocConferenceId ||
        String(group.activeAdhocConferenceId) === String(conferenceId))
    )
      group.activeAdhocConferenceId = String(conferenceId)
  }
  // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để đổi
  // state.
  if (
    name === 'adhoc_conference_deleted' &&
    !group.isGroupHost &&
    group.activeAdhocConferenceId &&
    String(group.activeAdhocConferenceId) === String(conferenceId)
  )
    context.callService.hangupCurrentCall()
}
