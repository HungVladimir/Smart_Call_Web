import { createSessionFetch } from '../auth/sessionScope.js'

/** Gọi backend cùng origin bằng token Wazo hiện tại, giữ guard phiên cả khi đọc body. */
export async function requestSmartCall(path, token, { method = 'GET', body, signal } = {}) {
  const timeout = AbortSignal.timeout(25000)
  const response = await createSessionFetch()('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Auth-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  let data
  try {
    data = await response.json()
  } catch (error) {
    // Proxy có thể trả body rỗng hoặc HTML. Giữ lại mã HTTP và để lỗi hủy/đổi phiên đi tiếp.
    if (!(error instanceof SyntaxError)) throw error
    throw Object.assign(
      new Error(
        `Phản hồi từ backend SmartCall không đọc được (HTTP ${response.status}). Kiểm tra FastAPI và cấu hình proxy.`,
      ),
      { status: response.status },
    )
  }
  if (!response.ok) {
    const detail = data?.detail
    throw Object.assign(
      new Error(
        typeof detail === 'string' ? detail : detail?.message || 'Backend chưa hoàn tất yêu cầu.',
      ),
      { status: response.status },
    )
  }
  return data
}
