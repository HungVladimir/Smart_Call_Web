import { createSessionFetch, captureSessionContext } from './sessionScope.js'

/** Gọi API cùng origin; chỉ gửi cookie phiên ứng dụng, không gửi credential quản trị tới Web. */
export async function requestSingleId(path, options = {}, context = captureSessionContext()) {
  const request = context ? createSessionFetch(context) : globalThis.fetch
  const response = await request('/api/auth/' + path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.detail?.message || 'Không hoàn tất được đăng nhập Single ID.')
    error.code = data.detail?.code
    error.status = response.status
    throw error
  }
  return data
}
