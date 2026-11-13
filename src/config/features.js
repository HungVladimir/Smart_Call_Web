/**
 * Quản trị Cấu hình Tính năng (Feature Flags) và Chế độ Dữ liệu (Mock / Real)
 * Cho phép bật/tắt linh hoạt 5 phân hệ giao diện và chế độ dữ liệu thử nghiệm.
 */

const STORAGE_KEY = 'smartcall_features_config'

// Cấu hình mặc định của hệ thống
export const DEFAULT_FEATURES = {
  // 5 cờ phân hệ chức năng (Screens / Features)
  dashboard: true, // Màn hình Tổng quan (/dashboard)
  calls: true, // Màn hình Gọi điện và bàn phím (/calls)
  contacts: true, // Màn hình Danh bạ (/contacts)
  messages: true, // Màn hình Tin nhắn (/messages)
  history: true, // Màn hình Lịch sử cuộc gọi (/history)

  // Cờ dữ liệu thử nghiệm / dữ liệu giả lập (Mock / Test Data)
  mockData: true, // true: Cho phép đăng nhập Offline và dùng dữ liệu Mock; false: 100% dữ liệu thật từ Wazo
}

/**
 * Đọc cấu hình hiện tại từ localStorage hoặc mặc định
 */
export function getFeatures() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return { ...DEFAULT_FEATURES, ...JSON.parse(saved) }
    }
  } catch (e) {
    console.warn('Lỗi đọc cấu hình features:', e)
  }
  return { ...DEFAULT_FEATURES }
}

/**
 * Lưu cấu hình mới và phát sự kiện đồng bộ toàn ứng dụng
 */
export function saveFeatures(features) {
  try {
    const merged = { ...DEFAULT_FEATURES, ...features }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.dispatchEvent(new CustomEvent('smartcall-features-changed', { detail: merged }))
    return merged
  } catch (e) {
    console.warn('Lỗi lưu cấu hình features:', e)
    return DEFAULT_FEATURES
  }
}

/**
 * Kiểm tra xem một tính năng có đang được kích hoạt hay không
 */
export function isFeatureEnabled(key) {
  const current = getFeatures()
  return Boolean(current[key])
}

/**
 * Khôi phục toàn bộ cấu hình về mặc định ban đầu
 */
export function resetFeatures() {
  return saveFeatures(DEFAULT_FEATURES)
}

