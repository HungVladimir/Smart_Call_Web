import { captureSessionContext, createSessionFetch } from '../session/sessionScope.js'

import { logger } from '../logging/LoggerService.js'

/** Adapter REST Calld: gửi lệnh và trả xác nhận từ máy chủ. */
export class CallControlApi {
  constructor({ authService }) {
    this.authService = authService
  }

  /** Lấy danh sách cuộc gọi server của tài khoản hiện tại. */
  async listActiveCalls() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    if (!token) return []
    const host = this.authService.getHostUrl()
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

  /** Tạo hội nghị từ các server call ID; chỉ trả ID khi máy chủ xác nhận. */
  async createConference(hostCallId, participantCallIds = []) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    if (!token || !hostCallId) return null
    const host = this.authService.getHostUrl()
    try {
      logger.info(
        'CALL',
        `Tạo Ad-hoc Conference với Host [${hostCallId}] và ${participantCallIds.length} nhánh...`,
      )
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

  /** Thêm server call ID vào hội nghị, trả kết quả xác nhận từ Calld. */
  async addConferenceParticipant(conferenceId, callId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    if (!token || !conferenceId || !callId) return false
    const host = this.authService.getHostUrl()
    try {
      const res = await fetch(
        `${host}/api/calld/1.0/users/me/conferences/adhoc/${conferenceId}/participants/${callId}`,
        {
          method: 'PUT',
          headers: {
            'X-Auth-Token': token,
            Accept: 'application/json',
          },
        },
      )
      logger.info(
        'CALL',
        `Thêm nhánh ${callId} vào Ad-hoc Conference ${conferenceId} -> HTTP ${res.status}`,
      )
      return res.ok
    } catch (e) {
      logger.warn('CALL', 'Lỗi addParticipantToAdhocConference:', e)
      return false
    }
  }

  /** Yêu cầu Calld giải tán hội nghị theo ID. */
  async deleteConference(conferenceId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    if (!token || !conferenceId) return false
    const host = this.authService.getHostUrl()
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

  /** Yêu cầu Calld ngắt một nhánh gọi theo server call ID. */
  async hangupServerCall(callId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    if (!token || !callId) return false
    const host = this.authService.getHostUrl()
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
}
