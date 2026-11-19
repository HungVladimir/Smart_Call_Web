/** Lỗi API có mã HTTP, phân biệt thất bại với kết quả rỗng hợp lệ. */
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
