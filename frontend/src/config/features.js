/** Cờ hiển thị các màn hình Web. Dữ liệu nghiệp vụ luôn lấy từ dịch vụ thật. */
const STORAGE_KEY = 'smartcall_features_config'
export const DEFAULT_FEATURES = Object.freeze({ calls: true, messages: true, history: true })
/** Chỉ nhận các cờ còn hỗ trợ; cấu hình cũ không thể bật lại chế độ dữ liệu mẫu. */
function normalizeFeatures(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_FEATURES).map(([key, fallback]) => [
      key,
      typeof value?.[key] === 'boolean' ? value[key] : fallback,
    ]),
  )
}
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
export function isFeatureEnabled(key) {
  return Boolean(getFeatures()[key])
}
export function resetFeatures() {
  return saveFeatures(DEFAULT_FEATURES)
}
