import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'
import { logger } from '../common/loggerService.js'

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
  'chatd_presence_updated',
  'chatd_user_presence_updated',
]

/** Callback mặc định khi caller không truyền hook vòng đời socket. */
function noopSocketLifecycleCallback() {}

/** Sở hữu một socket và lịch kết nối lại; nghiệp vụ được truyền qua onEnvelope. */
export class EventConnection {
  /**
   * Giữ AuthService và callback xử lý envelope, chuẩn bị thế hệ socket/reconnect để callback cũ bị
   * vô hiệu.
   */
  constructor({
    authService,
    onEnvelope,
    onConnected = noopSocketLifecycleCallback,
    onDisconnected = noopSocketLifecycleCallback,
  }) {
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
    // Thiếu token hoặc đã có socket đang mở thì bỏ qua để tránh mở song song nhiều kết nối.
    if (!token || this.socket) return
    const connection = this
    const context = captureSessionContext(),
      generation = ++this.generation

    /**
     * Kiểm tra tác vụ hiện tại còn thuộc đúng phiên và đúng thế hệ trước khi dùng kết quả bất đồng
     * bộ.
     */
    function isCurrentConnection() {
      return generation === connection.generation && isSessionContextCurrent(context)
    }

    const host = this.authService.host
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    try {
      const socket = new WebSocket(
        'wss://' + host + '/api/websocketd/?token=' + encodeURIComponent(token) + '&version=2',
      )

      /** Gửi lệnh subscribe các sự kiện Wazo và kích hoạt luồng nhận khi socket mở thành công. */
      function handleSocketOpen() {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!isCurrentConnection()) {
          socket.close()
          return
        }
        connection.connectedAt = Date.now()
        for (const name of SUBSCRIBED_EVENTS) {
          socket.send(JSON.stringify({ op: 'subscribe', data: { event_name: name } }))
        }
        socket.send(JSON.stringify({ op: 'start' }))
        connection.onConnected()
      }

      /** Giải mã JSON envelope từ Wazo WebSocket và chuyển về handler nếu vẫn đúng thế hệ. */
      function handleSocketMessage(message) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!isCurrentConnection()) return
        try {
          connection.onEnvelope(JSON.parse(message.data))
        } catch (error) {
          logger.warn('API', 'Không đọc được sự kiện Wazo:', error.message)
        }
      }

      /** Mở lại kết nối sự kiện sau thời gian chờ nếu phiên hiện tại vẫn hợp lệ. */
      function retrySocketConnection() {
        connection.retryTimer = null
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isCurrentConnection()) connection.connect()
      }

      /** Xử lý khi socket đóng, kiểm chứng thu hồi phiên hoặc hẹn kết nối lại theo thế hệ. */
      async function handleSocketClose(event) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!isCurrentConnection()) return
        connection.socket = null
        connection.onDisconnected()
        const revoked =
          [4001, 4003, 4401].includes(event.code) ||
          /401|expired|invalid|session|kicked/i.test(event.reason || '')
        if (
          revoked &&
          connection.authService.isAuthenticated() &&
          !connection.authService.isSessionRevoked
        ) {
          const healthy = await connection.authService.verifySessionHealth(true)
          // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
          // đến muộn sau hủy/đổi phiên.
          if (!isCurrentConnection()) return
          if (!healthy && connection.authService.refreshTokenRevoked) {
            connection.authService.handleSessionRevocation()
            return
          }
        }
        if (connection.authService.isAuthenticated() && !connection.authService.isSessionRevoked) {
          connection.retryTimer = setTimeout(retrySocketConnection, 5000)
        }
      }

      this.socket = socket
      socket.onopen = handleSocketOpen
      socket.onmessage = handleSocketMessage
      socket.onclose = handleSocketClose
    } catch (error) {
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
  }
}
