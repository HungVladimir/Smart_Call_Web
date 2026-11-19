/** Phân phối sự kiện trong ứng dụng; không sở hữu socket hoặc state nghiệp vụ. */
export class EventHub {
  constructor() {
    this.listeners = new Map()
  }
  /** Đăng ký callback và trả hàm hủy để bên sở hữu chủ động cleanup. */
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(handler)
    return () => this.off(name, handler)
  }
  off(name, handler) {
    this.listeners.get(name)?.delete(handler)
  }
  emit(name, data) {
    for (const handler of this.listeners.get(name) || []) {
      try {
        handler(data)
      } catch (error) {
        console.error('Lỗi xử lý sự kiện ' + name, error)
      }
    }
  }
  clear() {
    this.listeners.clear()
  }
}
