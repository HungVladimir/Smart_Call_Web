/** Cờ hiển thị các màn hình Web. Dữ liệu nghiệp vụ luôn lấy từ dịch vụ thật. */
const STORAGE_KEY = 'smartcall_features_config'
export const DEFAULT_FEATURES = Object.freeze({ calls: true, callGroups: true, history: true })
/** Chỉ nhận các cờ còn hỗ trợ; cấu hình cũ không thể bật lại chế độ dữ liệu mẫu. */
function normalizeFeatures(value = {}) {
  const normalized = Object.fromEntries(
    Object.entries(DEFAULT_FEATURES).map(([key, fallback]) => [
      key,
      typeof value?.[key] === 'boolean' ? value[key] : fallback,
    ]),
  )
  // Màn gọi chứa điều khiển nhận/kết thúc, nên menu nhóm phụ thuộc vào màn gọi.
  if (!normalized.calls) normalized.callGroups = false
  return normalized
}
/**
 * Đọc và chuẩn hóa cờ màn hình đã lưu; dữ liệu cũ hoặc sai định dạng được thay bằng cấu hình hợp
 * lệ.
 */
export function getFeatures() {
  try {
    return normalizeFeatures(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return { ...DEFAULT_FEATURES }
  }
}
/** Lưu lựa chọn giao diện và thông báo cho các màn hình đang mở. */
export function saveFeatures(features) {
  const normalized = normalizeFeatures(features)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('smartcall-features-changed', { detail: normalized }))
  return normalized
}
/** Kiểm tra một màn hình có được bật trong cấu hình hiện tại hay không. */
export function isFeatureEnabled(key) {
  return Boolean(getFeatures()[key])
}
/** Khôi phục bộ cờ màn hình mặc định qua cùng luồng lưu và thông báo thay đổi. */
export function resetFeatures() {
  return saveFeatures(DEFAULT_FEATURES)
}
