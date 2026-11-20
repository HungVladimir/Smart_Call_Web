import { captureSessionContext, createSessionFetch } from '../auth/sessionScope.js'

/** Lỗi API có mã HTTP, phân biệt thất bại với kết quả rỗng hợp lệ. */
export class ApiError extends Error {
  /** Tạo lỗi HTTP có tên và status để caller phân biệt yêu cầu thất bại với response rỗng hợp lệ. */
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** HTTP cho Wazo; giữ token/host/timeout và kiểm tra owner ở một boundary. */
export class WazoApiClient {
  /** Nhận AuthService làm nguồn token/host duy nhất cho các request HTTP dùng chung. */
  constructor({ authService }) {
    this.authService = authService
  }
  /**
   * Gửi HTTP với token/context/timeout, ném ApiError khi bị từ chối và trả Response đã kiểm tra
   * cho caller đọc body.
   */
  async request(path, { context = captureSessionContext(), timeoutMs = 5000, ...options } = {}) {
    const token = this.authService.getToken()
    // Thiếu token thì dừng trước khi gọi server; không gửi request bằng credential rỗng hoặc tự
    // tạo token thay thế.
    if (!token) throw new ApiError('Phiên đăng nhập đã kết thúc.', 401)
    const request = createSessionFetch(context)
    const response = await request(this.authService.getHostUrl() + path, {
      ...options,
      headers: { Accept: 'application/json', 'X-Auth-Token': token, ...options.headers },
      signal: options.signal || AbortSignal.timeout(timeoutMs),
    })
    // Chỉ sử dụng response HTTP thành công; mã lỗi đi qua nhánh xử lý thất bại thay vì báo thành
    // công giả.
    if (!response.ok)
      throw new ApiError('Máy chủ từ chối yêu cầu (HTTP ' + response.status + ').', response.status)
    return response
  }
  /** Gửi request GET qua HTTP client dùng chung và trả JSON sau khi đã kiểm tra HTTP/context. */
  async getJson(path, options = {}) {
    const response = await this.request(path, options)
    return response.status === 204 ? null : response.json()
  }
  /** Gửi JSON bằng PUT qua HTTP client; chỉ coi thao tác thành công khi máy chủ xác nhận. */
  async putJson(path, data, options = {}) {
    return this.request(path, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(data),
    })
  }
}
