/** Cờ bật/tắt ba màn hình Web; bỏ qua khóa cấu hình cũ và dữ liệu không phải boolean. */
const STORAGE_KEY = 'smartcall_features_config'
export const DEFAULT_FEATURES = { calls: true, messages: true, history: true }

function normalizeFeatures(value) {
  return Object.fromEntries(Object.entries(DEFAULT_FEATURES).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]))
}

export function getFeatures() {
  try { return normalizeFeatures(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }
  catch { return { ...DEFAULT_FEATURES } }
}

export function saveFeatures(features) {
  const normalized = normalizeFeatures(features)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('smartcall-features-changed', { detail: normalized }))
  return normalized
}

export function isFeatureEnabled(key) { return getFeatures()[key] === true }
export function resetFeatures() { return saveFeatures(DEFAULT_FEATURES) }
