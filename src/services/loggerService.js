/**
 * LoggerService - Hệ thống ghi nhật ký thao tác và sự kiện thời gian thực (Live Debug Logging)
 * Hỗ trợ hiển thị trên Console trình duyệt (màu sắc phân loại) và hiển thị trực tiếp trên giao diện UI.
 */

import { reactive } from 'vue'

const MAX_LOGS = 250

class LoggerService {
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
    const pad = (n) => String(n).padStart(2, '0')
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`

    const entry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      time: timeStr,
      timestamp: now.getTime(),
      category: category.toUpperCase(),
      message,
      details,
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

  info(category, message, details) {
    return this.log(category, message, details, 'info')
  }

  success(category, message, details) {
    return this.log(category, message, details, 'success')
  }

  warn(category, message, details) {
    return this.log(category, message, details, 'warn')
  }

  error(category, message, details) {
    return this.log(category, message, details, 'error')
  }

  getLogs() {
    return this.logs
  }

  clearLogs() {
    this.logs.splice(0, this.logs.length)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartcall-logs-cleared'))
    }
  }

  exportLogsText() {
    return this.logs
      .slice()
      .reverse()
      .map((l) => `[${l.time}] [${l.category}] [${l.level.toUpperCase()}] ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`)
      .join('\n')
  }

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
    const msgStyle = entry.level === 'error' ? 'color: #ef4444; font-weight: bold;' : entry.level === 'warn' ? 'color: #f59e0b; font-weight: bold;' : 'color: #0f172a;'

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

