import { wazoService } from './wazo'

class WebSocketService {
  constructor() {
    this.ws = null
    this.isConnected = false
    this.listeners = new Map()
    this.reconnectTimer = null
  }

  /**
   * Kết nối tới wazo-websocketd theo mục 6 trong dev_guide.md
   * URL: wss://192.168.1.50:9443/api/websocketd/?token=<token>&version=2
   */
  connect() {
    const token = wazoService.getToken()
    if (!token) {
      console.warn('[WebSocket] Chưa có token xác thực, hoạt động ở chế độ mô phỏng offline.')
      return
    }

    const host = wazoService.host.replace(/^https?:\/\//, '')
    const url = `wss://${host}/api/websocketd/?token=${token}&version=2`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log('[WebSocket] Đã kết nối thành công tới Wazo websocketd')
        this.isConnected = true
        this._subscribeDefaultEvents()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          this._handleMessage(msg)
        } catch (e) {
          console.error('[WebSocket] Lỗi parse JSON message:', e)
        }
      }

      this.ws.onclose = () => {
        this.isConnected = false
        console.log('[WebSocket] Kết nối đóng. Tự động kết nối lại sau 5s...')
        this._scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.warn('[WebSocket] Lỗi kết nối (bình thường khi dev offline):', err)
      }
    } catch (e) {
      console.warn('[WebSocket] Trình duyệt không thể mở kết nối WebSocket:', e)
    }
  }

  /**
   * Đăng ký các sự kiện mặc định cần lắng nghe theo giao thức v2
   */
  _subscribeDefaultEvents() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const events = [
      'call_created',
      'call_answered',
      'call_ended',
      'chatd_user_room_message_created',
      'chatd_presence_updated',
    ]

    events.forEach((eventName) => {
      this.ws.send(
        JSON.stringify({
          op: 'subscribe',
          data: { event_name: eventName },
        }),
      )
    })

    // Gửi lệnh "start" để bắt đầu nhận sự kiện từ Wazo server
    this.ws.send(JSON.stringify({ op: 'start' }))
  }

  _handleMessage(msg) {
    if (msg.op === 'event' && msg.data) {
      const eventName = msg.data.name
      const eventPayload = msg.data.data
      this.emit(eventName, eventPayload)
    }
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, 5000)
  }

  /**
   * Đăng ký lắng nghe sự kiện
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set())
    }
    this.listeners.get(eventName).add(callback)
  }

  /**
   * Hủy lắng nghe sự kiện
   */
  off(eventName, callback) {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName).delete(callback)
    }
  }

  /**
   * Phát sự kiện cho các subscriber
   */
  emit(eventName, data) {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName).forEach((cb) => {
        try {
          cb(data)
        } catch (err) {
          console.error(`[WebSocket] Lỗi xử lý callback sự kiện ${eventName}:`, err)
        }
      })
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer)
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
  }
}

export const websocketService = new WebSocketService()
