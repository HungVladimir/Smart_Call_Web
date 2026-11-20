import { assertSessionContext, isSessionContextCurrent, StaleSessionError } from './sessionScope.js'

const gates = new WeakMap()

/** Một SDK Auth singleton chỉ được có một tác vụ xác thực/cleanup đang sửa state nội bộ. */
export function getSdkAuthenticationGate(auth) {
  if (!gates.has(auth)) gates.set(auth, new SdkAuthenticationGate(auth))
  return gates.get(auth)
}

class SdkAuthenticationGate {
  /**
   * Giữ Auth SDK singleton và chuẩn bị hàng đợi xác thực/cleanup để không sửa session SDK song
   * song.
   */
  constructor(auth) {
    this.auth = auth
    this.tail = Promise.resolve()
    this.isAuthenticationPending = false
    this.cleanupFailed = false
  }

  /**
   * Từ chối login mới khi SDK cũ còn xử lý hoặc cleanup thất bại; yêu cầu chờ/tải lại thay vì trộn
   * session.
   */
  assertCanAuthenticate() {
    // Giữ ranh giới SDK: không cho tác vụ xác thực mới chạy khi request/cleanup trước chưa kết
    // thúc an toàn.
    if (this.cleanupFailed)
      throw new Error('Chưa dọn được phiên SDK cũ. Vui lòng tải lại trang để đăng nhập an toàn.')
    // Giữ ranh giới SDK: không cho tác vụ xác thực mới chạy khi request/cleanup trước chưa kết
    // thúc an toàn.
    if (this.isAuthenticationPending)
      throw new Error('Tác vụ xác thực trước chưa kết thúc. Vui lòng chờ hoặc tải lại trang.')
  }

  /** Timeout chỉ giải phóng form; khóa SDK được giữ đến khi request và cleanup thật sự kết thúc. */
  authenticate({ context, initialize, request, timeoutMs = 15000 }) {
    this.assertCanAuthenticate()
    this.isAuthenticationPending = true
    let canceled = false
    let timer
    const operation = this.tail
      .then(async () => {
        if (canceled) throw new StaleSessionError()
        // Giữ ranh giới SDK: không cho tác vụ xác thực mới chạy khi request/cleanup trước chưa kết
        // thúc an toàn.
        if (this.cleanupFailed)
          throw new Error(
            'Chưa dọn được phiên SDK cũ. Vui lòng tải lại trang để đăng nhập an toàn.',
          )
        assertSessionContext(context)
        let session
        try {
          initialize()
          session = await request()
        } catch (error) {
          // Request SDK có thể đã sửa token trước khi reject.
          await this.clearSdkSession()
          throw error
        }
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (canceled || !isSessionContextCurrent(context)) {
          await this.clearSdkSession()
          throw new StaleSessionError()
        }
        return session
      })
      .finally(() => {
        this.isAuthenticationPending = false
      })
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    )
    return Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          canceled = true
          reject(
            new Error(
              'Đăng nhập quá thời gian chờ. Tác vụ SDK đang được thu hồi; vui lòng chờ hoặc tải lại trang.',
            ),
          )
        }, timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  /**
   * Đợi SDK logout hoàn tất; nếu cleanup lỗi thì giữ trạng thái chặn đăng nhập mới để tránh lẫn
   * credential.
   */
  async clearSdkSession() {
    try {
      await this.auth.logout()
    } catch (error) {
      this.cleanupFailed = true
      throw error
    }
  }

  /** Không logout song song với logIn/validateToken còn sống trong SDK. */
  logout(required = true) {
    if (!required) return this.tail
    const cleanup = this.tail.then(() => this.clearSdkSession())
    this.tail = cleanup.then(
      () => undefined,
      () => undefined,
    )
    return cleanup
  }
}
