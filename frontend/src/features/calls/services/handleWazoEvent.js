import { callState } from '../state/callState.js'
import { logger } from '../../../core/logging/LoggerService.js'

/** Xử lý envelope theo protocol Wazo; transport không chứa quy tắc cuộc gọi hoặc nhóm. */
export function handleWazoEvent(context, envelope) {
  try {
    const msg = envelope
    const ev = msg.op === 'event' ? msg.data : msg
    const name = ev?.name || ''
    const data = ev?.data || {}

    // Phát sự kiện presence cho toàn hệ thống
    if (name.includes('presence')) {
      window.dispatchEvent(new CustomEvent('wazo-presence-updated', { detail: data }))

      // Đồng bộ giao diện Gọi Nhóm cho tất cả thành viên khi nhận tag [GROUP:hostExt:1001,1002,1003]
      const statusText = data?.status || data?.state || ''
      if (
        context.callController.hasActiveCall() &&
        typeof statusText === 'string' &&
        statusText.includes('[GROUP:')
      ) {
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
          const parsedExts = csv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          const myExt = context.authService.getCurrentExtension()
          if (parsedExts.includes(myExt)) {
            context.groupCallController.state.isGroupCall = true
            context.groupCallController.state.groupHostExtension = hostExt
            context.groupCallController.state.isGroupHost = hostExt === myExt
            context.groupCallController.state.groupParticipantExtensions = parsedExts
            if (callState.activeCall) {
              callState.activeCall.isGroupCall = true
              callState.activeCall.isGroupHost = context.groupCallController.state.isGroupHost
              callState.activeCall.groupHostExtension = hostExt
              callState.activeCall.groupParticipantExtensions = parsedExts
              callState.activeCall.groupTitle = `Cuộc gọi nhóm (${parsedExts.length} người)`
            }
          }
        }
      }

      // 2. Chủ phòng nhận ủy quyền thêm người [ADD_REQ:reqId:hostExt:ext1,ext2] từ máy thành viên
      if (
        context.callController.hasActiveCall() &&
        context.groupCallController.state.isGroupHost &&
        typeof statusText === 'string' &&
        statusText.includes('[ADD_REQ:')
      ) {
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

          const myExt = context.authService.getCurrentExtension()
          if (targetHostExt === myExt) {
            if (!reqId || !context.groupCallController._processedAddReqIds.has(reqId)) {
              if (reqId) context.groupCallController._processedAddReqIds.add(reqId)
              const toInvite = csvExts
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              if (toInvite.length > 0) {
                logger.info(
                  'CALL',
                  `Chủ phòng (${myExt}) nhận ủy quyền từ thành viên -> Quay số mời: ${toInvite.join(', ')}`,
                )
                window.dispatchEvent(
                  new CustomEvent('app-toast', {
                    detail: {
                      message: `📥 Nhận yêu cầu thêm ${toInvite.join(', ')} vào nhóm từ thành viên`,
                      type: 'info',
                    },
                  }),
                )
                context.groupCallController.addParticipantsToGroupCall(toInvite)
              }
            }
          }
        }
      }

      // 3. Đồng bộ thông báo nhóm khi nhận tag [NOTICE:noticeId:hostExt:message]
      if (
        context.callController.hasActiveCall() &&
        typeof statusText === 'string' &&
        statusText.includes('[NOTICE:')
      ) {
        const start = statusText.indexOf('[NOTICE:') + 8
        const end = statusText.indexOf(']', start)
        if (end > start) {
          const content = statusText.substring(start, end).trim()
          const parts = content.split(':')
          const noticeId = parts[0]?.trim()
          const noticeMsg =
            parts.length >= 3 ? parts.slice(2).join(':').trim() : parts.slice(1).join(':').trim()
          if (
            noticeId &&
            !context.groupCallController._processedNoticeIds.has(noticeId) &&
            noticeMsg
          ) {
            context.groupCallController._processedNoticeIds.add(noticeId)
            window.dispatchEvent(
              new CustomEvent('app-toast', {
                detail: { message: `🔔 ${noticeMsg}`, type: 'warning' },
              }),
            )
          }
        }
      }

      // 4. Báo rời nhóm tức thì khi nhận tag [LEFT:ext]
      if (
        context.callController.hasActiveCall() &&
        typeof statusText === 'string' &&
        statusText.includes('[LEFT:')
      ) {
        const start = statusText.indexOf('[LEFT:') + 6
        const end = statusText.indexOf(']', start)
        if (end > start) {
          const leftExt = statusText.substring(start, end).trim()
          const myExt = context.authService.getCurrentExtension()
          if (
            leftExt &&
            leftExt !== myExt &&
            context.groupCallController.state.groupParticipantExtensions.includes(leftExt)
          ) {
            logger.info('CALL', `Nhận thẻ [LEFT:${leftExt}] từ thành viên rời phòng.`)
            context.groupCallController.handleParticipantLeftGroupCall(leftExt)
          }
        }
      }

      // Single Device Login: Nếu presence của chính user chứa Session ID / Client ID mới từ thiết bị khác hoặc thiết bị Android
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

    // Khi có nhánh nghe máy trong cuộc gọi nhóm, tự động kích hoạt đồng bộ Ad-hoc Conference (Đã có debounce 350ms)
    if (
      (name === 'call_answered' || name === 'call_updated') &&
      context.groupCallController.state.isGroupCall &&
      context.groupCallController.state.isGroupHost
    ) {
      context.groupCallController.syncActiveCallsToAdhocConference()
    }

    // Xử lý sự kiện giải tán phòng Ad-hoc Conference từ Chủ phòng
    if (name === 'adhoc_conference_deleted') {
      const confId = data?.conference_id || data?.id
      if (
        context.groupCallController.state.isGroupCall &&
        context.callController.hasActiveCall() &&
        !context.groupCallController.state.isGroupHost
      ) {
        logger.info('CALL', `Phòng họp Ad-hoc [${confId}] đã kết thúc bởi Chủ phòng.`)
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
          }),
        )
        context.callController.hangupCurrentCall()
      }
    }

    // Xử lý sự kiện thành viên rời phòng Ad-hoc Conference hoặc gác máy
    if (
      name === 'adhoc_conference_participant_left' ||
      name === 'conference_user_participant_left' ||
      name === 'call_ended'
    ) {
      const leftCallId = data?.call_id || data?.participant_id || data?.id
      if (
        context.groupCallController.state.isGroupCall &&
        context.groupCallController.state.isGroupHost &&
        leftCallId
      ) {
        context.groupCallController.handleParticipantLeftGroupCall(leftCallId)
      }
    }

    // Chuyển tiếp tới các subscriber của websocketService (chat, call)
    context.eventHub.emit(name, data)
  } catch (e) {
    /* ignore */
  }
}
