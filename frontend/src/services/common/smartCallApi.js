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
  const data = await response.json()
  if (!response.ok) {
    const detail = data.detail
    throw Object.assign(
      new Error(
        typeof detail === 'string' ? detail : detail?.message || 'Backend chưa hoàn tất yêu cầu.',
      ),
      { status: response.status },
    )
  }
  return data
}
