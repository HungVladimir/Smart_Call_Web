import { captureSessionContext, createSessionFetch } from '../session/sessionScope.js'
import { ApiError } from './ApiError.js'

/** HTTP cho Wazo; giữ token/host/timeout và kiểm tra owner ở một boundary. */
export class WazoApiClient {
  constructor({ authService }) {
    this.authService = authService
  }
  async request(path, { context = captureSessionContext(), timeoutMs = 5000, ...options } = {}) {
    const token = this.authService.getToken()
    if (!token) throw new ApiError('Phiên đăng nhập đã kết thúc.', 401)
    const request = createSessionFetch(context)
    const response = await request(this.authService.getHostUrl() + path, {
      ...options,
      headers: { Accept: 'application/json', 'X-Auth-Token': token, ...options.headers },
      signal: options.signal || AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok)
      throw new ApiError('Máy chủ từ chối yêu cầu (HTTP ' + response.status + ').', response.status)
    return response
  }
  async getJson(path, options = {}) {
    const response = await this.request(path, options)
    return response.status === 204 ? null : response.json()
  }
  async putJson(path, data, options = {}) {
    return this.request(path, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(data),
    })
  }
}
