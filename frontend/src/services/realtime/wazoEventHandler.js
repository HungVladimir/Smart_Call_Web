import { logger } from '../common/loggerService.js'
import { callState } from '../../state/callState.js'
import { normalizeExtension } from '../../utils/callPolicy.js'
import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'

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
          statusStr.includes('[GROUP_SYNC:') ||
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
    } else if (name === 'call_answered' || name === 'call_updated') {
      context.callService.observeDirectCallPeer(data)
    }

    handleConferenceEvent(context, name, data)

    // call_ended có thể chỉ là chuyển kênh vào ConfBridge; việc rời nhóm do event hội nghị xác nhận.

    // Chuyển tiếp cho các subscriber của luồng thoại.
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
  if (context.contactService.isPagedIdentity(contact))
    return context.contactService.isVerifiedExtensionOwner(contact) ? { uuid, extension } : null
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

/** Tra UUID của tín hiệu nhóm hợp lệ về định dạng khi người phát chưa có trong trang hiện tại. */
async function resolveMissingGroupSender(context, data, call) {
  const uuid = data.user_uuid || data.uuid
  if (
    !uuid ||
    uuid === context.authService.getCurrentUserUuid() ||
    (data.user_uuid && data.uuid && data.user_uuid !== data.uuid)
  )
    return
  const session = captureSessionContext()
  const generation = context.callService.callGeneration
  const sip = context.callService.getSipSessionId(call.session || call.rawSession)
  try {
    await context.contactService.hydrateContactsByUuid([uuid])
    const candidate = context.contactService.findContactByUuid(uuid)
    if (!candidate?.number) return
    const owner = await context.contactService.getOrLookupContact(candidate.number)
    const current = callState.activeCall || callState.incomingCall
    // Chỉ phát lại trong đúng cuộc gọi. Hàm chính kiểm tra lại vai trò và chống trùng.
    if (
      owner?.uuid === uuid &&
      isSessionContextCurrent(session) &&
      generation === context.callService.callGeneration &&
      (current === call ||
        (sip &&
          sip === context.callService.getSipSessionId(current?.session || current?.rawSession)))
    )
      handleGroupPresenceSignal(context, data, true)
  } catch {
    // Không xác minh được người phát thì giữ nguyên quyền và trạng thái cuộc gọi.
  }
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
export function handleGroupPresenceSignal(context, data, lookupAttempted = false) {
  if (!context.authService.isAuthenticated()) return
  const currentCall = callState.activeCall || callState.incomingCall
  if (!currentCall || !context.callService.hasActiveCall() || typeof data.status !== 'string')
    return
  const matches = [...data.status.matchAll(/\[(GROUP|GROUP_SYNC|ADD_REQ|NOTICE|LEFT):([^\]]+)\]/g)]
  if (matches.length !== 1) return
  const sender = resolveSender(context, data)
  if (!sender) {
    const uuid = data.user_uuid || data.uuid
    const cached = context.contactService.findContactByUuid(uuid)
    if (!lookupAttempted && (!cached || context.contactService.isPagedIdentity(cached)))
      void resolveMissingGroupSender(context, data, currentCall)
    return
  }
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
    // Trong cuộc gọi 1-1, chỉ người gọi ban đầu được công bố mình là host.
    const receivedCall =
      currentCall.direction === 'inbound' || currentCall === callState.incomingCall
    if (established) {
      if (host !== sender.extension || state.isGroupHost) return
    } else if (!receivedCall || peer !== sender.extension) {
      return
    }
    // Snapshot phân biệt đã nghe/đang mời; revision chặn event đảo thứ tự giữa các máy.
    const snapshots = [...data.status.matchAll(/\[GROUP_STATE:([^\]]+)\]/g)]
    let connected = participants
    if (data.status.includes('[GROUP_STATE:') && snapshots.length !== 1) return
    if (snapshots.length === 1) {
      const [groupId, revisionText, connectedCsv, acknowledgement, ...unknown] =
        snapshots[0][1].split(':')
      const revision = Number(revisionText)
      connected = connectedCsv && extensions(connectedCsv)
      if (
        unknown.length ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(groupId) ||
        !/^\d+$/.test(revisionText) ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        !connected ||
        !connected.includes(declaredHost) ||
        connected.some((ext) => !participants.includes(ext)) ||
        (acknowledgement !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(acknowledgement))
      )
        return
      const freshReply = acknowledgement && group._groupSyncRequestIds.has(acknowledgement)
      if (group._groupSnapshotId && group._groupSnapshotId !== groupId && !freshReply) return
      if (group._groupSnapshotId === groupId && revision <= group._groupSnapshotRevision) return
      group._groupSnapshotId = groupId
      group._groupSnapshotRevision = revision
      if (freshReply) group._groupSyncRequestIds.delete(acknowledgement)
    } else if (group._groupSnapshotId) {
      return // GROUP legacy đến muộn không được ghi đè snapshot đã xác nhận.
    }
    state.isGroupCall = true
    state.isGroupHost = false
    state.groupHostExtension = sender.extension
    state.groupParticipantExtensions = participants
    state.groupConnectedExtensions = connected
    group._syncGroupDisplayState()
    return
  }
  if (kind === 'GROUP_SYNC') {
    // Người vừa nhận SIP incoming có thể đã lỡ GROUP gửi trước đó; chỉ host trả lời thành viên đã mời.
    const [requestId, targetHost, ...extra] = payload.split(':')
    if (
      !member ||
      !state.isGroupHost ||
      host !== me ||
      targetHost !== me ||
      extra.length ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(requestId)
    )
      return
    const key = sender.uuid + ':' + requestId
    if (group._processedGroupSyncIds.has(key)) return
    group._processedGroupSyncIds.add(key)
    group.broadcastGroupStateViaPresence(requestId)
    return
  }
  // B đang nhận cuộc gọi của A được yêu cầu A nâng lên nhóm, dù GROUP chưa được tạo.
  const initialPeerRequest =
    !state.isGroupCall &&
    currentCall.direction === 'outbound' &&
    currentCall.status === 'connected' &&
    currentCall.peerConfirmed === true &&
    peer === sender.extension
  if (!member && !(kind === 'ADD_REQ' && initialPeerRequest)) return
  if (kind === 'LEFT') {
    if (payload !== sender.extension || payload === me) return
    group.handleParticipantLeftGroupCall(sender.extension)
    return
  }
  if (kind === 'ADD_REQ') {
    if (!initialPeerRequest && (!state.isGroupHost || host !== me)) return
    // ACK SIP có thể thuộc nhánh phát thông báo, nên chỉ nhận yêu cầu từ người đã xác nhận.
    const connectedMember =
      initialPeerRequest || state.groupConnectedExtensions.includes(sender.extension)
    if (!connectedMember) return
    const parts = payload.split(':')
    if (parts.length !== 2 && parts.length !== 3) return
    const [requestId, targetHost, csv] = parts.length === 3 ? parts : ['', ...parts]
    const requested = extensions(csv)
    if (targetHost !== me || !requested) return
    const targets = requested.filter(
      (extension) =>
        extension !== me &&
        extension !== peer &&
        !state.groupParticipantExtensions.includes(extension),
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

/** Không dùng một event hội nghị bất kỳ để kết thúc cuộc gọi hiện tại. */
function handleConferenceEvent(context, name, data) {
  const group = context.groupCallService.state
  if (!group.isGroupCall || !context.callService.hasActiveCall()) return
  const conferenceId =
    data?.conference_id ||
    data?.conference_uuid ||
    (name === 'adhoc_conference_deleted' ? data?.id : '')
  if (!conferenceId) return
  if (name === 'adhoc_conference_participant_left' || name === 'conference_user_participant_left') {
    // Chỉ gỡ theo call_id của đúng hội nghị; không đoán từ participant_id/id.
    if (
      group.isGroupHost &&
      group.activeAdhocConferenceId &&
      String(conferenceId) === String(group.activeAdhocConferenceId) &&
      data.call_id != null
    )
      context.groupCallService.handleParticipantLeftGroupCall(String(data.call_id))
    return
  }
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
