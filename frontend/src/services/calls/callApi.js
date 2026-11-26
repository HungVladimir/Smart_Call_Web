import {
  captureSessionContext,
  createSessionFetch,
  isSessionContextCurrent,
} from '../auth/sessionScope.js'

import { logger } from '../common/loggerService.js'

/** Gom danh sách bridge ID duy nhất từ các cuộc gọi trả về bởi Calld để thu hồi hội nghị cũ. */
function extractHostedBridgeIds(calls) {
  const bridgeIds = new Set()
  for (const call of calls) {
    if (!Array.isArray(call.bridges)) continue
    for (const bridgeId of call.bridges) {
      if (typeof bridgeId === 'string' && bridgeId) {
        bridgeIds.add(bridgeId)
      }
    }
  }
  return [...bridgeIds]
}

/** Kiểm tra phần tử boolean đã trả true trong danh sách kết quả cleanup song song. */
function isCleanupConfirmed(succeeded) {
  return Boolean(succeeded)
}

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
    } catch (error) {
      logger.warn('CALL', 'Lỗi khi gọi getMyActiveCalls:', error)
      return []
    }
  }

  /** Tạo hội nghị từ các server call ID; chỉ trả ID khi máy chủ xác nhận. */
  async createConference(hostCallId, participantCallIds = []) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    // Thiếu token hoặc thiếu call ID của host thì không gửi lệnh tạo hội nghị rỗng lên Calld.
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
    } catch (error) {
      logger.error('CALL', 'Lỗi khi tạo Ad-hoc Conference:', error)
      return null
    }
  }

  /** Thêm server call ID vào hội nghị, trả kết quả xác nhận từ Calld. */
  async addConferenceParticipant(conferenceId, callId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    // Thiếu token, conferenceId hoặc callId thì dừng trước khi gọi server để tránh request lỗi.
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
    } catch (error) {
      logger.warn('CALL', 'Lỗi addParticipantToAdhocConference:', error)
      return false
    }
  }

  /** Yêu cầu Calld giải tán hội nghị theo ID. */
  async deleteConference(conferenceId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    // Thiếu token hoặc conferenceId thì không gửi DELETE để tránh xóa sai hoặc lỗi auth.
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
    } catch (error) {
      logger.warn('CALL', 'Lỗi deleteAdhocConference:', error)
      return false
    }
  }

  /** Yêu cầu Calld ngắt một nhánh gọi theo server call ID. */
  async hangupServerCall(callId) {
    const sessionContext = captureSessionContext()
    const fetch = createSessionFetch(sessionContext)
    const token = this.authService.getToken()
    // Thiếu token hoặc callId thì không gửi DELETE nhánh gọi lên Calld.
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
    } catch (error) {
      logger.warn('CALL', 'Lỗi khi ngắt nhánh cuộc gọi trên Calld:', error.message)
      return false
    }
  }

  /** Gửi cleanup bằng snapshot credential cũ; không cập nhật state và không bị scope logout hủy. */
  async cleanupSessionCalls({ token, host, conferenceId, callIds = [] }) {
    // Không thể gửi cleanup tới Calld khi thiếu snapshot token hoặc host của phiên vừa kết thúc.
    if (!token || !host) return false
    const uniqueCallIds = [...new Set(callIds.filter(Boolean))]
    const paths = [
      ...(conferenceId
        ? ['/api/calld/1.0/users/me/conferences/adhoc/' + encodeURIComponent(conferenceId)]
        : []),
      ...uniqueCallIds.map((id) => '/api/calld/1.0/users/me/calls/' + encodeURIComponent(id)),
    ]

    /** Gửi lệnh DELETE tới một tài nguyên Calld bằng snapshot cũ, coi 404 là đã dọn xong. */
    async function deleteCleanupResource(path) {
      try {
        const response = await globalThis.fetch(host + path, {
          method: 'DELETE',
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        })
        return response.ok || response.status === 404
      } catch {
        // Lỗi mạng/timeout trả false để caller ghi nhận cleanup chưa hoàn tất trên máy chủ.
        return false
      }
    }

    const results = await Promise.all(paths.map(deleteCleanupResource))
    return results.every(isCleanupConfirmed)
  }

  /** Phiên mới dọn bridge do cùng user làm host trước khi thu hồi token của máy cũ. */
  async endPreviousHostedConferences(context = captureSessionContext()) {
    const fetch = createSessionFetch(context)
    const token = this.authService.getToken()
    const host = this.authService.getHostUrl()
    // Không dọn hội nghị cũ khi thiếu token hoặc thiết bị hiện tại đã bắt đầu một cuộc gọi mới.
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
      // Kiểm tra lại sau await để tránh đụng vào cuộc gọi vừa phát sinh trên thiết bị hiện tại.
      if (this.authService.callService.hasActiveCall()) return false
      // bridges là ID bridge Calld trả về. DELETE adhoc chỉ thành công nếu server xác nhận user là host.
      // Bridge thường hoặc hội nghị mà user chỉ tham gia sẽ trả 404; không cúp nhánh của thành viên.
      const ids = extractHostedBridgeIds(calls)

      /** Gửi DELETE tới từng ad-hoc bridge theo token mới trước khi thu hồi phiên cũ. */
      async function deleteHostedConference(conferenceId) {
        try {
          const result = await fetch(
            host + '/api/calld/1.0/users/me/conferences/adhoc/' + encodeURIComponent(conferenceId),
            {
              method: 'DELETE',
              headers: { 'X-Auth-Token': token, Accept: 'application/json' },
              signal: AbortSignal.timeout(4000),
            },
          )
          return result.ok || result.status === 404
        } catch {
          // Lỗi mạng/timeout trả false để báo cảnh báo chưa xác nhận giải tán hội nghị cũ.
          return false
        }
      }

      const results = await Promise.all(ids.map(deleteHostedConference))
      if (!results.every(isCleanupConfirmed))
        throw new Error('Chưa xác nhận giải tán hết hội nghị cũ.')
      return true
    } catch (error) {
      logger.warn('CALL', 'Không hoàn tất dọn hội nghị phiên cũ:', error.message)
      if (isSessionContextCurrent(context)) {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              type: 'warning',
              message: 'Chưa xác nhận kết thúc hội nghị ở thiết bị cũ. Vui lòng kiểm tra tổng đài.',
            },
          }),
        )
      }
      return false
    }
  }
}
