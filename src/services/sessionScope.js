// Session ownership is independent of Wazo SDK and service import cycles.
let epoch = 0
const pending = new Set()

export class StaleSessionError extends Error {
  constructor() {
    super('Phiên làm việc đã thay đổi. Vui lòng thử lại.')
    this.name = 'StaleSessionError'
  }
}

export function captureSessionContext() {
  return { epoch, userUuid: localStorage.getItem('smartcall_user_uuid') || '' }
}

export function isSessionContextCurrent(context) {
  return context.epoch === epoch && context.userUuid === (localStorage.getItem('smartcall_user_uuid') || '')
}

export function assertSessionContext(context) {
  if (!isSessionContextCurrent(context)) throw new StaleSessionError()
}

export function invalidateSession() {
  epoch += 1
  for (const controller of pending) controller.abort()
  pending.clear()
}

export function createSessionFetch(context = captureSessionContext()) {
  return async (url, options = {}) => {
    assertSessionContext(context)
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    pending.add(controller)
    try {
      const response = await globalThis.fetch(url, { ...options, signal: controller.signal })
      assertSessionContext(context)
      return new Proxy(response, {
        get(target, key) {
          if (['json', 'text', 'blob', 'arrayBuffer'].includes(key)) {
            return async (...args) => {
              assertSessionContext(context)
              pending.add(controller)
              if (options.signal?.aborted) controller.abort()
              else options.signal?.addEventListener('abort', abort, { once: true })
              try {
                const value = await target[key](...args)
                assertSessionContext(context)
                return value
              } finally {
                pending.delete(controller)
                options.signal?.removeEventListener('abort', abort)
              }
            }
          }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    } finally {
      pending.delete(controller)
      options.signal?.removeEventListener('abort', abort)
    }
  }
}
