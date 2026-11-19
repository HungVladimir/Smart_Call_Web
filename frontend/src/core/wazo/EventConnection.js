import { reactive } from 'vue'
import { captureSessionContext, isSessionContextCurrent } from '../session/sessionScope.js'
import { logger } from '../logging/LoggerService.js'

export const eventConnectionState = reactive({ status: 'disconnected' })
const SUBSCRIBED_EVENTS = [
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

/** Sở hữu một socket và lịch kết nối lại; nghiệp vụ được truyền qua onEnvelope. */
export class EventConnection {
  constructor({ authService, onEnvelope }) {
    this.authService = authService
    this.onEnvelope = onEnvelope
    this.socket = null
    this.connectedAt = 0
    this.retryTimer = null
    this.generation = 0
  }

  /** Đăng ký đúng event names/op Wazo; callback phiên cũ không được khởi động lại socket. */
  connect() {
    const token = this.authService.getToken()
    if (!token || this.socket) return
    const context = captureSessionContext(),
      generation = ++this.generation
    const current = () => generation === this.generation && isSessionContextCurrent(context)
    const host = this.authService.host
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    eventConnectionState.status = 'connecting'
    try {
      const socket = new WebSocket(
        'wss://' + host + '/api/websocketd/?token=' + encodeURIComponent(token) + '&version=2',
      )
      this.socket = socket
      socket.onopen = () => {
        if (!current()) {
          socket.close()
          return
        }
        this.connectedAt = Date.now()
        eventConnectionState.status = 'connected'
        for (const name of SUBSCRIBED_EVENTS)
          socket.send(JSON.stringify({ op: 'subscribe', data: { event_name: name } }))
        socket.send(JSON.stringify({ op: 'start' }))
      }
      socket.onmessage = (message) => {
        if (!current()) return
        try {
          this.onEnvelope(JSON.parse(message.data))
        } catch (error) {
          logger.warn('API', 'Không đọc được sự kiện Wazo:', error.message)
        }
      }
      socket.onerror = () => {
        if (current()) eventConnectionState.status = 'error'
      }
      socket.onclose = async (event) => {
        if (!current()) return
        this.socket = null
        eventConnectionState.status = 'disconnected'
        const revoked =
          [4001, 4003, 4401].includes(event.code) ||
          /401|expired|invalid|session|kicked/i.test(event.reason || '')
        if (revoked && this.authService.isAuthenticated() && !this.authService.isSessionRevoked) {
          const healthy = await this.authService.verifySessionHealth(true)
          if (!current()) return
          if (!healthy && this.authService.refreshTokenRevoked) {
            this.authService.handleSessionRevocation()
            return
          }
        }
        if (this.authService.isAuthenticated() && !this.authService.isSessionRevoked) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            if (current()) this.connect()
          }, 5000)
        }
      }
    } catch (error) {
      eventConnectionState.status = 'error'
      logger.warn('API', 'Không mở được kết nối sự kiện:', error.message)
    }
  }

  /** Vô hiệu callback và hủy retry trước khi đóng, tránh reconnect sau logout. */
  disconnect() {
    this.generation++
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null
      this.socket.close()
      this.socket = null
    }
    eventConnectionState.status = 'disconnected'
  }
}
