/**
 * LoggerService - Hệ thống ghi nhật ký thao tác và sự kiện thời gian thực (Live Debug Logging)
 * Hỗ trợ hiển thị trên Console trình duyệt (màu sắc phân loại) và hiển thị trực tiếp trên giao diện UI.
 */

import { reactive } from 'vue'

const MAX_LOGS = 250

// Chỉ giữ bản chụp đã che thông tin xác thực; không giữ object SDK có tham chiếu vòng.
function redactText(value) {
  return String(value)
    .replace(/((?:[?&]|\b)(?:[\w-]*token|password|secret)=)[^\s&#]+/gi, '$1[ĐÃ CHE]')
    .replace(/(Bearer\s+)[\w.~-]+/gi, '$1[ĐÃ CHE]')
    .replace(/(\/api\/auth\/0\.1\/token\/)[^/?\s]+/gi, '$1[ĐÃ CHE]')
}

/**
 * Chụp dữ liệu log thành object có thể xuất JSON, che credential và giới hạn vòng tham chiếu/độ
 * sâu.
 */
function snapshotDetails(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return redactText(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return '[Không tuần tự hóa]'
  if (seen.has(value)) return '[Tham chiếu vòng]'
  if (depth >= 5) return '[Giới hạn độ sâu]'
  seen.add(value)
  const result = Array.isArray(value) ? [] : {}
  const keys =
    value instanceof Error
      ? ['name', 'message', 'stack', ...Object.keys(value)]
      : Object.keys(value)
  for (const key of keys.slice(0, 100)) {
    if (/token|password|authorization|cookie|secret|credential|sdp/i.test(key)) {
      result[key] = '[ĐÃ CHE]'
      continue
    }
    try {
      result[key] = snapshotDetails(value[key], seen, depth + 1)
    } catch {
      result[key] = '[Không đọc được]'
    }
  }
  return result
}

class LoggerService {
  /** Tạo danh sách log reactive và điểm truy cập debug; dữ liệu nhạy cảm được lọc khi ghi entry. */
  constructor() {
    this.logs = reactive([])
    if (typeof window !== 'undefined') {
      window.smartcallLogger = this
    }
  }

  /**
   * Ghi log thao tác hệ thống
   * @param {string} category - Danh mục: 'AUTH' | 'SIP' | 'CALL' | 'AUDIO' | 'API' | 'UI' | 'SYSTEM'
   * @param {string} message - Nội dung tóm tắt thao tác
   * @param {any} details - Dữ liệu chi tiết đi kèm (nếu có)
   * @param {'info'|'success'|'warn'|'error'} level - Mức độ log
   */
  log(category = 'SYSTEM', message = '', details = null, level = 'info') {
    const now = new Date()
    /** Thêm số 0 ở đầu để các phần giờ/phút/giây có đủ hai chữ số khi hiển thị. */
    const pad = (n) => String(n).padStart(2, '0')
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`

    const entry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      time: timeStr,
      timestamp: now.getTime(),
      category: category.toUpperCase(),
      message: redactText(message),
      details: snapshotDetails(details),
      level,
    }

    this.logs.unshift(entry)
    if (this.logs.length > MAX_LOGS) {
      this.logs.pop()
    }

    // In log có định dạng màu sắc chuyên nghiệp trên Console F12
    this._printToConsole(entry)

    // Phát sự kiện toàn cục để UI phản hồi tức thì
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-log-added', { detail: entry }))
    }

    return entry
  }

  /** Ghi một sự kiện thông tin qua cùng bộ lọc credential và giới hạn dung lượng log. */
  info(category, message, details) {
    return this.log(category, message, details, 'info')
  }

  /**
   * Ghi entry ở cấp success qua cơ chế logger dùng chung; việc xác nhận nghiệp vụ do caller chịu
   * trách nhiệm.
   */
  success(category, message, details) {
    return this.log(category, message, details, 'success')
  }

  /** Ghi cảnh báo có thể phục hồi để theo dõi lỗi mà không làm dừng luồng đang chạy. */
  warn(category, message, details) {
    return this.log(category, message, details, 'warn')
  }

  /** Ghi lỗi với bản chụp dữ liệu đã che credential, phục vụ debug và xuất nhật ký. */
  error(category, message, details) {
    return this.log(category, message, details, 'error')
  }

  /** Trả nguồn log reactive hiện tại để drawer theo dõi thay đổi trực tiếp. */
  getLogs() {
    return this.logs
  }

  /**
   * Xóa log đang giữ trong RAM và thông báo cho drawer cập nhật; không xóa dữ liệu nghiệp vụ trên
   * server.
   */
  clearLogs() {
    this.logs.splice(0, this.logs.length)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-logs-cleared'))
    }
  }

  /** Sắp log theo thời gian và xuất văn bản có thể sao chép để phân tích sự cố. */
  exportLogsText() {
    return this.logs
      .slice()
      .reverse()
      .map(
        (l) =>
          `[${l.time}] [${l.category}] [${l.level.toUpperCase()}] ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`,
      )
      .join('\n')
  }

  /** In entry đã được lọc ra console với màu/cấp độ tương ứng, không đưa object SDK thô vào log. */
  _printToConsole(entry) {
    const badgeColors = {
      AUTH: 'background: #2563eb; color: #fff;',
      SIP: 'background: #059669; color: #fff;',
      CALL: 'background: #7c3aed; color: #fff;',
      AUDIO: 'background: #d97706; color: #fff;',
      API: 'background: #0284c7; color: #fff;',
      UI: 'background: #475569; color: #fff;',
      SYSTEM: 'background: #334155; color: #fff;',
    }

    const levelIcons = {
      info: 'ℹ️',
      success: '✅',
      warn: '⚠️',
      error: '❌',
    }

    const badgeStyle = `padding: 2px 6px; border-radius: 3px; font-weight: 600; font-size: 11px; ${badgeColors[entry.category] || badgeColors.SYSTEM}`
    const timeStyle = 'color: #94a3b8; font-size: 11px;'
    const msgStyle =
      entry.level === 'error'
        ? 'color: #ef4444; font-weight: bold;'
        : entry.level === 'warn'
          ? 'color: #f59e0b; font-weight: bold;'
          : 'color: #0f172a;'

    const prefix = `${levelIcons[entry.level] || 'ℹ️'} %c${entry.time}%c %c[${entry.category}]%c ${entry.message}`

    if (entry.level === 'error') {
      console.error(prefix, timeStyle, '', badgeStyle, msgStyle, entry.details || '')
    } else if (entry.level === 'warn') {
      console.warn(prefix, timeStyle, '', badgeStyle, msgStyle, entry.details || '')
    } else {
      console.log(prefix, timeStyle, '', badgeStyle, msgStyle, entry.details || '')
    }
  }
}

export const logger = new LoggerService()
