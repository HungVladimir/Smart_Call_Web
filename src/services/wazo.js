import Wazo from '@wazo/sdk'
import { logger } from './loggerService'
import { audioService } from './audioService'

class WazoService {
  constructor() {
    this.session = null
    this.currentCallSession = null
    // Lấy IP từ file môi trường .env hoặc dùng mặc định máy chủ tổng đài
    this.host = import.meta.env.VITE_WAZO_HOST || '107.126.11.126:9443'
    this.clientId = import.meta.env.VITE_WAZO_CLIENT_ID || 'webapp-vue'
    this.listenersAttached = false
    this.isRegistered = false
    this.eventWs = null
  }

  init() {
    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    Wazo.Auth.init(this.clientId)
    Wazo.Auth.setHost(cleanHost)
    logger.info('AUTH', `Khởi tạo Wazo Auth SDK với host: ${cleanHost}`)
  }

  async login(username, password) {
    this.init()
    logger.info('AUTH', `Đang gửi yêu cầu đăng nhập tài khoản "${username}" tới máy chủ...`)
    try {
      this.session = await Wazo.Auth.logIn(username, password)
      if (this.session && this.session.token) {
        localStorage.setItem('smartcall_wazo_token', this.session.token)
        localStorage.setItem('smartcall_wazo_refreshToken', this.session.refreshToken || '')
        if (this.session.uuid) {
          localStorage.setItem('smartcall_user_uuid', this.session.uuid)
        }
        let exten = ''
        try {
          exten = this.session.primaryNumber?.() || ''
        } catch (e) {}
        if (exten) {
          localStorage.setItem('smartcall_user_exten', exten)
          localStorage.setItem('smartcall_extension', exten)
        }
        logger.success('AUTH', `Đăng nhập Wazo thành công! UUID: ${this.session.uuid || 'N/A'}`)
      }

      this.openWebSocketEvents()

      // Tự động kết nối WebRTC Phone sau khi login thành công
      try {
        await this.connectPhone()
      } catch (phoneErr) {
        logger.warn('SIP', 'Kết nối WebRTC Phone cảnh báo (vẫn duy trì phiên login)', phoneErr.message)
      }

      // Tự động đồng bộ trạng thái Trực tuyến (Available) lên Wazo Chatd
      try {
        await this.setPresence('available', 'Sẵn sàng')
      } catch (presErr) {
        /* ignore */
      }

      return this.session
    } catch (error) {
      logger.error('AUTH', `Đăng nhập thất bại: ${error.message || error}`, error)
      throw error
    }
  }

  // Khôi phục session xác thực Wazo từ Token khi người dùng F5 hoặc mở lại tab
  async restoreSession() {
    this.init()
    const token = localStorage.getItem('smartcall_wazo_token')
    const refreshToken = localStorage.getItem('smartcall_wazo_refreshToken')
    if (token) {
      try {
        logger.info('AUTH', 'Đang khôi phục phiên làm việc Wazo từ Token lưu trữ...')
        this.session = await Wazo.Auth.validateToken(token, refreshToken)
        if (this.session) {
          if (this.session.uuid) {
            localStorage.setItem('smartcall_user_uuid', this.session.uuid)
          }
          let exten = ''
          try {
            exten = this.session.primaryNumber?.() || ''
          } catch (e) {}
          if (exten) {
            localStorage.setItem('smartcall_user_exten', exten)
            localStorage.setItem('smartcall_extension', exten)
          }
          logger.success('AUTH', 'Đã khôi phục phiên đăng nhập Wazo từ Token thành công!')
          this.openWebSocketEvents()
          try {
            await this.connectPhone()
          } catch (phoneErr) {
            logger.warn('SIP', 'Khôi phục WebRTC phone cảnh báo', phoneErr.message)
          }
          try {
            await this.setPresence('available', 'Sẵn sàng')
          } catch (presErr) {
            /* ignore */
          }
          return true
        }
      } catch (e) {
        logger.warn('AUTH', 'Không thể khôi phục phiên Wazo từ Token cũ', e.message)
      }
    }
    return false
  }

  logout() {
    logger.info('AUTH', 'Thực hiện đăng xuất khỏi hệ thống Wazo...')
    try {
      this.setPresence('unavailable', 'Ngoại tuyến')
    } catch (e) {
      /* ignore */
    }
    audioService.stopAllTones()
    this.closeWebSocketEvents()
    if (this.session) {
      try {
        Wazo.Auth.logout(this.session)
      } catch (e) {
        /* ignore */
      }
      this.session = null
    }
    localStorage.removeItem('smartcall_wazo_token')
    localStorage.removeItem('smartcall_wazo_refreshToken')
    localStorage.removeItem('smartcall_user_exten')
    localStorage.removeItem('smartcall_extension')
    localStorage.removeItem('smartcall_offline_mode')
    this.currentCallSession = null
    this.stopRemoteAudio()
    this.disconnectPhone()
    logger.info('AUTH', 'Đã xóa toàn bộ token và phiên làm việc cục bộ.')
  }

  isLogged() {
    return Boolean(this.session?.token || localStorage.getItem('smartcall_wazo_token'))
  }

  getToken() {
    return this.session?.token || localStorage.getItem('smartcall_wazo_token') || ''
  }

  getMyExtension() {
    try {
      const ext = this.session?.primaryNumber?.()
      if (ext) return String(ext).trim()
    } catch (e) {}
    const stored =
      localStorage.getItem('smartcall_extension') ||
      localStorage.getItem('smartcall_user_exten') ||
      localStorage.getItem('smartcall_sip_user') ||
      ''
    return String(stored).trim()
  }

  openWebSocketEvents() {
    const token = this.getToken()
    if (!token || this.eventWs) return

    const cleanHost = (this.host || '107.126.11.126:9443').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    try {
      this.eventWs = new WebSocket(`wss://${cleanHost}/api/websocketd/?token=${token}&version=2`)

      this.eventWs.onopen = () => {
        logger.info('API', 'Kết nối wazo-websocketd đã mở thành công.')
        try {
          for (const name of ['chatd_presence_updated', 'chatd_user_presence_updated']) {
            this.eventWs.send(JSON.stringify({ op: 'subscribe', data: { event_name: name } }))
          }
          this.eventWs.send(JSON.stringify({ op: 'start' }))
        } catch (err) {
          /* ignore */
        }
      }

      this.eventWs.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data)
          const ev = msg.op === 'event' ? msg.data : msg
          const name = ev?.name || ''
          if (name.includes('presence')) {
            const d = ev.data || {}
            window.dispatchEvent(new CustomEvent('wazo-presence-updated', { detail: d }))
          }
        } catch (e) {
          /* ignore */
        }
      }

      this.eventWs.onclose = () => {
        this.eventWs = null
        // Tự động kết nối lại sau 5s nếu người dùng vẫn đang đăng nhập
        if (this.isLogged()) {
          setTimeout(() => {
            if (this.isLogged() && !this.eventWs) {
              this.openWebSocketEvents()
            }
          }, 5000)
        }
      }
    } catch (e) {
      logger.warn('API', 'Không thể mở kết nối wazo-websocketd:', e.message)
    }
  }

  closeWebSocketEvents() {
    if (this.eventWs) {
      try {
        this.eventWs.onclose = null
        this.eventWs.close()
      } catch (e) {}
      this.eventWs = null
    }
  }

  async connectPhone() {
    if (!this.isLogged()) throw new Error('User must be logged in')

    logger.info('SIP', 'Đang kết nối WebSocket WebRTC SIP tới máy chủ Wazo...')
    try {
      // Audio: true cần thiết cho WebRTC (sẽ kích hoạt cấp quyền Mic từ trình duyệt)
      await Wazo.Phone.connect({ audio: true, video: false })
      this.attachListeners()
      logger.success('SIP', 'Lệnh Wazo.Phone.connect({ audio: true }) gửi thành công.')
      return true
    } catch (error) {
      logger.error('SIP', `Lỗi kết nối WebRTC SIP: ${error.message || error}`, error)
      throw error
    }
  }

  disconnectPhone() {
    try {
      this.isRegistered = false
      this.stopRemoteAudio()
      audioService.stopAllTones()
      Wazo.Phone.disconnect()
      this.listenersAttached = false
      logger.info('SIP', 'Đã ngắt kết nối Wazo WebRTC Phone')
    } catch (e) {
      /* Ignore */
    }
  }

  isPhoneRegistered() {
    return Boolean(this.isRegistered)
  }

  attachListeners() {
    if (this.listenersAttached) return
    this.listenersAttached = true

    // Lắng nghe sự kiện từ SDK và phát ra event toàn cục qua window
    Wazo.Phone.on(Wazo.Phone.ON_REGISTERED, () => {
      this.isRegistered = true
      logger.success('SIP', '🟢 Wazo WebRTC SIP Phone: Registered thành công!')
      window.dispatchEvent(new CustomEvent('wazo-registered'))
    })

    Wazo.Phone.on(Wazo.Phone.ON_UNREGISTERED, () => {
      this.isRegistered = false
      logger.warn('SIP', '🔴 Wazo WebRTC SIP Phone: Unregistered!')
      window.dispatchEvent(new CustomEvent('wazo-unregistered'))

      // Tự động kết nối lại SIP sau 5 giây nếu đang đăng nhập và không ở chế độ offline
      if (this.isLogged() && localStorage.getItem('smartcall_offline_mode') !== 'true') {
        setTimeout(async () => {
          if (this.isLogged() && !this.isRegistered) {
            try {
              logger.info('SIP', 'Đang tự động kết nối lại WebRTC Phone sau khi mất đăng ký...')
              await this.connectPhone()
            } catch (err) {
              logger.warn('SIP', 'Tự động kết nối lại WebRTC Phone thất bại:', err)
            }
          }
        }, 5000)
      }
    })

    Wazo.Phone.on(Wazo.Phone.ON_PROGRESS, (callSession) => {
      logger.info('CALL', '🔔 Sự kiện Wazo: Đường dây đang đổ chuông (ON_PROGRESS / 180 Ringing)')
      audioService.startRingbackTone()
      window.dispatchEvent(new CustomEvent('wazo-progress', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => {
      this.currentCallSession = callSession
      const ext = callSession?.number || callSession?.callerNumber || 'N/A'
      logger.info('CALL', `🔔 Cuộc gọi đến từ máy lẻ: ${ext}`, callSession)
      window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, (callSession) => {
      logger.info('CALL', '⏹️ Sự kiện Wazo: Cuộc gọi đã kết thúc (ON_CALL_ENDED)')
      this.currentCallSession = null
      this.stopRemoteAudio()
      audioService.stopAllTones()
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_FAILED, (callSession) => {
      logger.error('CALL', '❌ Sự kiện Wazo: Cuộc gọi thất bại (ON_CALL_FAILED - Máy bận, offline hoặc từ chối)')
      this.currentCallSession = null
      this.stopRemoteAudio()
      audioService.stopAllTones()
      window.dispatchEvent(new CustomEvent('wazo-failed', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_REJECTED, (callSession) => {
      logger.warn('CALL', '🚫 Sự kiện Wazo: Cuộc gọi bị từ chối (ON_CALL_REJECTED)')
      this.currentCallSession = null
      this.stopRemoteAudio()
      audioService.stopAllTones()
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_CANCELED, (callSession) => {
      logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)')
      this.currentCallSession = null
      this.stopRemoteAudio()
      audioService.stopAllTones()
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => {
      this.currentCallSession = callSession
      logger.success('CALL', '🟢 Sự kiện Wazo: Cuộc gọi đã được kết nối! Đang đàm thoại 2 chiều (Full-Duplex).')
      audioService.stopRingbackTone()

      // 1. Thử gắn luồng âm thanh ngay lập tức nếu stream đã sẵn sàng
      try {
        const immediateStream = Wazo.Phone.getRemoteStream(callSession)
        if (immediateStream) {
          this.playRemoteStream(immediateStream)
        }
      } catch (err) {
        /* ignore */
      }

      // 2. Dự phòng an toàn: Kiểm tra sau 600ms xem SDK đã phát audio chưa, nếu chưa thì kích hoạt phát
      setTimeout(() => {
        try {
          const sdkAudios = [...document.querySelectorAll('audio')].filter(
            (a) => a.id !== 'wazo-remote-audio' && a.srcObject && !a.paused
          )
          if (sdkAudios.length > 0) {
            logger.info('AUDIO', 'Luồng âm thanh WebRTC đã được phát tự động bởi Wazo SDK.')
            return
          }
          const stream = Wazo.Phone.getRemoteStream(callSession)
          if (stream) {
            this.playRemoteStream(stream)
            logger.info('AUDIO', 'Đã kích hoạt luồng âm thanh đàm thoại 2 chiều dự phòng.')
          }
        } catch (err) {
          logger.warn('AUDIO', 'Cảnh báo đồng bộ luồng âm thanh:', err)
        }
      }, 600)

      window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
    })
  }

  // Phát luồng âm thanh 2 chiều của người gọi từ xa qua thẻ <audio>
  playRemoteStream(stream) {
    let audioElement = document.getElementById('wazo-remote-audio')
    if (!audioElement) {
      audioElement = document.createElement('audio')
      audioElement.id = 'wazo-remote-audio'
      audioElement.autoplay = true
      document.body.appendChild(audioElement)
    }
    audioElement.srcObject = stream
    audioElement.play().catch((err) => {
      logger.warn('AUDIO', 'Trình duyệt chặn Autoplay Audio (Cần tương tác người dùng):', err)
    })
  }

  stopRemoteAudio() {
    const audioElement = document.getElementById('wazo-remote-audio')
    if (audioElement) {
      audioElement.srcObject = null
    }
  }

  // Các hàm điều khiển cuộc gọi (truyền false cho audio-only WebRTC)
  async makeCall(extension) {
    logger.info('CALL', `📞 Bắt đầu gọi tới số máy lẻ: ${extension} (Audio-only WebRTC)...`)
    try {
      this.currentCallSession = await Wazo.Phone.call(extension, false)
      logger.success('CALL', `Tín hiệu cuộc gọi tới ${extension} đã được phát đi. Session ID: ${this.currentCallSession?.sipCallId || 'N/A'}`)
      return this.currentCallSession
    } catch (err) {
      logger.error('CALL', `Lỗi khi thực hiện cuộc gọi tới ${extension}: ${err.message || err}`, err)
      audioService.stopAllTones()
      throw err
    }
  }

  hangup(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Cúp máy (Hangup)')
    audioService.stopAllTones()
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        Wazo.Phone.hangup(session)
      } catch (e) {
        /* ignore */
      }
      this.currentCallSession = null
    } else {
      try {
        Wazo.Phone.hangup()
      } catch (e) {
        /* ignore */
      }
    }
    this.stopRemoteAudio()
    window.dispatchEvent(new CustomEvent('wazo-ended', { detail: session }))
  }

  accept(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Nghe máy (Accept)')
    audioService.stopRingbackTone()
    audioService.stopIncomingRingtone()
    const session = callSession || this.currentCallSession
    if (session) {
      this.currentCallSession = session
      try {
        Wazo.Phone.accept(session, false)
      } catch (e) {
        /* ignore */
      }
    }
  }

  reject(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Từ chối cuộc gọi (Reject)')
    audioService.stopAllTones()
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        Wazo.Phone.reject(session)
      } catch (e) {
        /* ignore */
      }
      this.currentCallSession = null
      this.stopRemoteAudio()
    }
  }

  setMute(isMuted, callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        if (isMuted) {
          Wazo.Phone.mute(session)
          logger.info('CALL', 'Đã tắt Microphone (Mute)')
        } else {
          Wazo.Phone.unmute(session)
          logger.info('CALL', 'Đã bật lại Microphone (Unmute)')
        }
      } catch (e) {
        logger.warn('CALL', 'Lỗi chuyển trạng thái Mic:', e)
      }
    }
  }

  setHold(isHeld, callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        if (isHeld) {
          Wazo.Phone.hold(session)
          logger.info('CALL', 'Đã giữ máy (Hold)')
        } else {
          if (typeof Wazo.Phone.unhold === 'function') {
            Wazo.Phone.unhold(session)
          } else if (typeof Wazo.Phone.resume === 'function') {
            Wazo.Phone.resume(session)
          }
          logger.info('CALL', 'Đã tiếp tục đàm thoại (Unhold / Resume)')
        }
      } catch (e) {
        logger.warn('CALL', 'Lỗi chuyển trạng thái Giữ máy:', e)
      }
    }
  }

  sendDTMF(tone, callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        if (typeof Wazo.Phone.sendDTMF === 'function') {
          Wazo.Phone.sendDTMF(tone, session)
        } else if (typeof session.sendDtmf === 'function') {
          session.sendDtmf(tone)
        }
        logger.info('CALL', `Đã gửi tín hiệu DTMF [${tone}] qua WebRTC tới máy chủ Asterisk.`)
      } catch (e) {
        logger.warn('CALL', `Lỗi gửi tín hiệu DTMF [${tone}]:`, e)
      }
    }
  }

  hasActiveCall() {
    return Boolean(this.currentCallSession)
  }

  mute(callSession = null) {
    this.setMute(true, callSession)
  }

  hold(callSession = null) {
    this.setHold(true, callSession)
  }

  /**
   * Cập nhật trạng thái Presence người dùng lên máy chủ tổng đài Wazo Chatd
   * PUT /api/chatd/1.0/users/{user_uuid}/presences (theo OpenAPI spec Wazo Platform 26.10)
   */
  async setPresence(state = 'available', statusText = '') {
    const token = this.getToken()
    if (!token) return false

    const host = this.host.startsWith('http') ? this.host : `https://${this.host}`
    const userUuid = this.session?.uuid || localStorage.getItem('smartcall_user_uuid') || 'me'
    logger.info('API', `Cập nhật Presence: state=${state}, status=${statusText}`)
    try {
      const res = await fetch(`${host}/api/chatd/1.0/users/${userUuid}/presences`, {
        method: 'PUT',
        headers: {
          'X-Auth-Token': token,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          state,
          status: statusText || (state === 'available' ? 'Sẵn sàng' : 'Bận'),
        }),
      })
      if (res.ok) {
        logger.success('API', `Đã đồng bộ Presence "${state}" lên máy chủ Wazo`)
      }
      return res.ok
    } catch (err) {
      logger.warn('API', 'Không thể cập nhật presence lên Wazo server:', err)
      return false
    }
  }
}

export const wazoService = new WazoService()
