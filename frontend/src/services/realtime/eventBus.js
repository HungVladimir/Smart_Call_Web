/** Phân phối sự kiện trong ứng dụng; không sở hữu socket hoặc state nghiệp vụ. */
export class EventHub {
  /** Tạo registry subscriber cho sự kiện nội bộ; bản thân bus không mở kết nối mạng. */
  constructor() {
    this.listeners = new Map()
  }
  /** Đăng ký callback và trả hàm hủy để bên sở hữu chủ động cleanup. */
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(handler)
    return () => this.off(name, handler)
  }
  /** Gỡ một subscriber khỏi tên sự kiện để View/service chủ động cleanup. */
  off(name, handler) {
    this.listeners.get(name)?.delete(handler)
  }
  /**
   * Phát dữ liệu đến các subscriber nội bộ; lỗi một handler được ghi nhận để không chặn handler
   * còn lại.
   */
  emit(name, data) {
    for (const handler of this.listeners.get(name) || []) {
      try {
        handler(data)
      } catch (error) {
        console.error('Lỗi xử lý sự kiện ' + name, error)
      }
    }
  }
  /** Xóa toàn bộ subscriber nội bộ khi nơi sở hữu bus cần dọn vòng đời. */
  clear() {
    this.listeners.clear()
  }
}
