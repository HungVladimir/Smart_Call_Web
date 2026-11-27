import { reactive } from 'vue'

const MAX_FAILED_AVATARS = 500

/** Danh sách URL ảnh không tồn tại hoặc lỗi trong phiên hiện tại (chỉ giữ trong RAM). */
export const failedAvatarUrls = reactive(new Set())

/** Kiểm tra URL ảnh đã thất bại trong phiên này chưa để tránh lặp yêu cầu thừa. */
export function hasAvatarFailed(url) {
  return Boolean(url && failedAvatarUrls.has(url))
}

/** Ghi nhận URL ảnh không khả dụng vào bộ nhớ phiên với giới hạn số lượng. */
export function markAvatarFailed(url) {
  if (!url) return
  if (failedAvatarUrls.has(url)) {
    failedAvatarUrls.delete(url)
  } else if (failedAvatarUrls.size >= MAX_FAILED_AVATARS) {
    const oldest = failedAvatarUrls.values().next().value
    failedAvatarUrls.delete(oldest)
  }
  failedAvatarUrls.add(url)
}

/** Dọn trạng thái ảnh lỗi khi đăng xuất hoặc đổi phiên. */
export function clearFailedAvatars() {
  failedAvatarUrls.clear()
}
