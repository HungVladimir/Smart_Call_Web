import { reactive } from 'vue'
import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'
import { logger } from '../common/loggerService.js'

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
  /**
   * Giữ AuthService và callback xử lý envelope, chuẩn bị thế hệ socket/reconnect để callback cũ bị
   * vô hiệu.
   */
  constructor({ authService, onEnvelope, onConnected = () => {}, onDisconnected = () => {} }) {
    this.authService = authService
    this.onEnvelope = onEnvelope
    this.onConnected = onConnected
    this.onDisconnected = onDisconnected
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
    /**
     * Kiểm tra tác vụ hiện tại còn thuộc đúng phiên và đúng thế hệ trước khi dùng kết quả bất đồng
     * bộ.
     */
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
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) {
          socket.close()
          return
        }
        this.connectedAt = Date.now()
        eventConnectionState.status = 'connected'
        for (const name of SUBSCRIBED_EVENTS)
          socket.send(JSON.stringify({ op: 'subscribe', data: { event_name: name } }))
        socket.send(JSON.stringify({ op: 'start' }))
        this.onConnected()
      }
      socket.onmessage = (message) => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        try {
          this.onEnvelope(JSON.parse(message.data))
        } catch (error) {
          logger.warn('API', 'Không đọc được sự kiện Wazo:', error.message)
        }
      }
      socket.onerror = () => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (current()) eventConnectionState.status = 'error'
      }
      socket.onclose = async (event) => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        this.socket = null
        eventConnectionState.status = 'disconnected'
        this.onDisconnected()
        const revoked =
          [4001, 4003, 4401].includes(event.code) ||
          /401|expired|invalid|session|kicked/i.test(event.reason || '')
        if (revoked && this.authService.isAuthenticated() && !this.authService.isSessionRevoked) {
          const healthy = await this.authService.verifySessionHealth(true)
          // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
          // đến muộn sau hủy/đổi phiên.
          if (!current()) return
          if (!healthy && this.authService.refreshTokenRevoked) {
            this.authService.handleSessionRevocation()
            return
          }
        }
        if (this.authService.isAuthenticated() && !this.authService.isSessionRevoked) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ
            // liệu đến muộn sau hủy/đổi phiên.
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
      const socket = this.socket
      this.socket = null
      try {
        socket.close()
      } catch (error) {
        logger.warn('API', 'Không đóng được socket cũ:', error.message)
      }
    }
    eventConnectionState.status = 'disconnected'
  }
}
