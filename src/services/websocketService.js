import { wazoService } from './wazo'

class WebSocketService {
  constructor() {
    this.listeners = new Map()
  }

  get isConnected() {
    return Boolean(wazoService.eventWs && wazoService.eventWs.readyState === WebSocket.OPEN)
  }

  /**
   * Kết nối tới wazo-websocketd thông qua socket duy nhất của wazoService
   */
  connect() {
    wazoService.openWebSocketEvents()
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
    // Socket dùng chung được quản lý tập trung bởi wazoService
  }
}

export const websocketService = new WebSocketService()
