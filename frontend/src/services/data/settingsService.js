import { captureSessionContext, assertSessionContext } from '../auth/sessionScope.js'

/** Quản lý Confd và kết quả từng phần; component không tạo URL hoặc header. */
export class SettingsService {
  /** Nhận HTTP client để load/save cấu hình Confd qua cùng cơ chế token, lỗi và context. */
  constructor({ apiClient }) {
    this.apiClient = apiClient
  }
  /**
   * Tải DND và chuyển tiếp từ Confd, giữ trạng thái chưa tải khi API lỗi để không ghi đè bằng giá
   * trị mặc định.
   */
  async loadCallServices() {
    const context = captureSessionContext(),
      result = { dnd: null, forwards: null, errors: [] }
    await Promise.all([
      this.apiClient
        .getJson('/api/confd/1.1/users/me/services/dnd', { context, timeoutMs: 3500 })
        .then((data) => {
          result.dnd = Boolean(data.enabled)
        })
        .catch((error) => result.errors.push(error.message)),
      this.apiClient
        .getJson('/api/confd/1.1/users/me/forwards', { context, timeoutMs: 3500 })
        .then((data) => {
          /**
           * Đổi cấu hình chuyển tiếp server thành số đích hiển thị; dịch vụ đang tắt được biểu
           * diễn bằng chuỗi rỗng.
           */
          const destination = (value) => (value?.enabled === false ? '' : value?.destination || '')
          result.forwards = {
            busy: destination(data.busy),
            noanswer: destination(data.noanswer),
            unconditional: destination(data.unconditional),
          }
        })
        .catch((error) => result.errors.push(error.message)),
    ])
    assertSessionContext(context)
    return result
  }
  /** Chỉ gửi trường đã tải và thay đổi; baseline mới phản ánh ACK thực. */
  async saveCallServices(values, baseline) {
    const context = captureSessionContext(),
      next = { dnd: baseline.dnd, forwards: baseline.forwards ? { ...baseline.forwards } : null },
      failures = []
    const changes = []
    if (baseline.dnd !== null && baseline.dnd !== values.dnd)
      changes.push({
        path: 'services/dnd',
        body: { enabled: values.dnd },
        commit: () => {
          next.dnd = values.dnd
        },
      })
    if (baseline.forwards)
      for (const type of ['busy', 'noanswer', 'unconditional']) {
        const value = String(values.forwards[type] || '').trim()
        if (value !== baseline.forwards[type])
          changes.push({
            path: 'forwards/' + type,
            body: { enabled: Boolean(value), destination: value || null },
            commit: () => {
              next.forwards[type] = value
            },
          })
      }
    for (const change of changes) {
      try {
        await this.apiClient.putJson('/api/confd/1.1/users/me/' + change.path, change.body, {
          context,
        })
        change.commit()
      } catch (error) {
        failures.push(error.message)
      }
    }
    assertSessionContext(context)
    return { baseline: next, failures }
  }
}
