import Wazo from '@wazo/sdk'

class WazoService {
  constructor() {
    this.session = null
    this.currentCallSession = null
    // Lấy IP từ file môi trường .env hoặc dùng mặc định máy chủ tổng đài
    this.host = import.meta.env.VITE_WAZO_HOST || '107.126.11.126:9443'
    this.clientId = import.meta.env.VITE_WAZO_CLIENT_ID || 'webapp-vue'
  }

  init() {
    Wazo.Auth.init(this.clientId)
    Wazo.Auth.setHost(this.host)
  }

  async login(username, password) {
    this.init()
    try {
      this.session = await Wazo.Auth.logIn(username, password)
      if (this.session && this.session.token) {
        localStorage.setItem('smartcall_wazo_token', this.session.token)
        localStorage.setItem('smartcall_wazo_refreshToken', this.session.refreshToken || '')
      }
      return true
    } catch (error) {
      console.error('Login failed:', error)
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
        this.session = await Wazo.Auth.validateToken(token, refreshToken)
        if (this.session) {
          console.log('Đã khôi phục phiên đăng nhập Wazo từ token!')
          return true
        }
      } catch (e) {
        console.warn('Không thể khôi phục phiên Wazo từ token:', e)
      }
    }
    return false
  }

  logout() {
    if (this.session) {
      Wazo.Auth.logout(this.session)
      this.session = null
    }
    localStorage.removeItem('smartcall_wazo_token')
    localStorage.removeItem('smartcall_wazo_refreshToken')
    localStorage.removeItem('smartcall_offline_mode')
    this.currentCallSession = null
    this.stopRemoteAudio()
    this.disconnectPhone()
  }

  isLogged() {
    return (!!this.session && !!this.session.token) || true
  }

  getToken() {
    return this.session?.token || ''
  }

  async connectPhone() {
    if (!this.isLogged()) throw new Error('User must be logged in')

    try {
      // Audio: true cần thiết cho WebRTC (sẽ kích hoạt cấp quyền Mic từ trình duyệt)
      await Wazo.Phone.connect({ audio: true, video: false })
      this.attachListeners()
      return true
    } catch (error) {
      console.error('Phone connection failed:', error)
      throw error
    }
  }

  disconnectPhone() {
    try {
      this.stopRemoteAudio()
      Wazo.Phone.disconnect()
    } catch (e) {
      /* Ignore */
    }
  }

  attachListeners() {
    // Lắng nghe sự kiện từ SDK và phát ra event toàn cục qua window
    Wazo.Phone.on(Wazo.Phone.ON_REGISTERED, () => {
      console.log('Wazo WebRTC SIP Phone: Registered thành công!')
      window.dispatchEvent(new CustomEvent('wazo-registered'))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => {
      this.currentCallSession = callSession
      window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, (callSession) => {
      this.currentCallSession = null
      this.stopRemoteAudio()
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_FAILED, (callSession) => {
      this.currentCallSession = null
      this.stopRemoteAudio()
      window.dispatchEvent(new CustomEvent('wazo-failed', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => {
      this.currentCallSession = callSession
      try {
        const stream = Wazo.Phone.getRemoteStream(callSession)
        if (stream) {
          this.playRemoteStream(stream)
        }
      } catch (err) {
        console.warn('Lỗi gắn luồng âm thanh đàm thoại:', err)
      }
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
      console.log('Trình duyệt chặn Autoplay Audio (Cần tương tác người dùng):', err)
    })
  }

  stopRemoteAudio() {
    const audioElement = document.getElementById('wazo-remote-audio')
    if (audioElement) {
      audioElement.srcObject = null
    }
  }

  // Các hàm điều khiển cuộc gọi
  async makeCall(extension) {
    try {
      this.currentCallSession = await Wazo.Phone.call(extension)
      return this.currentCallSession
    } catch (err) {
      console.warn('Wazo Phone.call warning:', err)
      throw err
    }
  }

  hangup(callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) {
      try {
        Wazo.Phone.hangup(session)
      } catch (e) {
        /* ignore */
      }
      this.currentCallSession = null
      this.stopRemoteAudio()
    }
  }

  accept(callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) {
      this.currentCallSession = session
      try {
        Wazo.Phone.accept(session)
      } catch (e) {
        /* ignore */
      }
    }
  }

  reject(callSession = null) {
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

  mute(callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) Wazo.Phone.mute(session)
  }

  hold(callSession = null) {
    const session = callSession || this.currentCallSession
    if (session) Wazo.Phone.hold(session)
  }
}

export const wazoService = new WazoService()