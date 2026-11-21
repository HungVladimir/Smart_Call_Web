import {
  captureSessionContext,
  createSessionFetch,
  isSessionContextCurrent,
} from '../auth/sessionScope.js'

import { logger } from '../common/loggerService.js'

/** Adapter REST Calld: gửi lệnh và trả xác nhận từ máy chủ. */
export class CallControlApi {
  /** Nhận AuthService để các API Calld luôn lấy đúng host/token của phiên hiện tại. */
  constructor({ authService }) {
    this.authService = authService
  }

  /** Lấy danh sách cuộc gọi server của tài khoản hiện tại. */
  async listActiveCalls() {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) return []
    const host = this.authService.getHostUrl()
    try {
      const res = await fetch(`${host}/api/calld/1.0/users/me/calls`, {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json',
        },
      })
      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
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
      // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
      // công giả.
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
  /** Gửi cleanup bằng snapshot credential cũ; không cập nhật state và không bị scope logout hủy. */
  async cleanupSessionCalls({ token, host, conferenceId, callIds = [] }) {
    if (!token || !host) return false
    const paths = [
      ...(conferenceId
        ? ['/api/calld/1.0/users/me/conferences/adhoc/' + encodeURIComponent(conferenceId)]
        : []),
      ...[...new Set(callIds.filter(Boolean))].map(
        (id) => '/api/calld/1.0/users/me/calls/' + encodeURIComponent(id),
      ),
    ]
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          const response = await globalThis.fetch(host + path, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          })
          return response.ok || response.status === 404
        } catch {
          return false
        }
      }),
    )
    return results.every(Boolean)
  }

  /** Phiên mới dọn bridge do cùng user làm host trước khi thu hồi token của máy cũ. */
  async endPreviousHostedConferences(context = captureSessionContext()) {
    const fetch = createSessionFetch(context)
    const token = this.authService.getToken()
    const host = this.authService.getHostUrl()
    if (!token || this.authService.callService.hasActiveCall()) return false
    try {
      const response = await fetch(host + '/api/calld/1.0/users/me/calls', {
        headers: { 'X-Auth-Token': token, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error('Không đọc được cuộc gọi cũ: HTTP ' + response.status)
      const data = await response.json()
      const calls = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : null
      if (!calls) throw new Error('Danh sách cuộc gọi cũ không hợp lệ.')
      if (this.authService.callService.hasActiveCall()) return false
      // bridges là ID bridge Calld trả về. DELETE adhoc chỉ thành công nếu server xác nhận user là host.
      // Bridge thường hoặc hội nghị mà user chỉ tham gia sẽ trả 404; không cúp nhánh của thành viên.
      const ids = [
        ...new Set(
          calls
            .flatMap((call) => (Array.isArray(call.bridges) ? call.bridges : []))
            .filter((id) => typeof id === 'string' && id),
        ),
      ]
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const result = await fetch(
              host + '/api/calld/1.0/users/me/conferences/adhoc/' + encodeURIComponent(id),
              {
                method: 'DELETE',
                headers: { 'X-Auth-Token': token, Accept: 'application/json' },
                signal: AbortSignal.timeout(4000),
              },
            )
            return result.ok || result.status === 404
          } catch {
            return false
          }
        }),
      )
      if (!results.every(Boolean)) throw new Error('Chưa xác nhận giải tán hết hội nghị cũ.')
      return true
    } catch (error) {
      logger.warn('CALL', 'Không hoàn tất dọn hội nghị phiên cũ:', error.message)
      if (isSessionContextCurrent(context))
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              type: 'warning',
              message: 'Chưa xác nhận kết thúc hội nghị ở thiết bị cũ. Vui lòng kiểm tra tổng đài.',
            },
          }),
        )
      return false
    }
  }
}
