import Wazo from '@wazo/sdk'

class WazoService {
  constructor() {
    this.session = null
    // Thay IP này bằng IP server Wazo của LAN nội bộ SDV
    this.host = '192.168.1.50:9443'
    this.clientId = 'sdv-webapp-vue'
  }

  init() {
    Wazo.Auth.init(this.clientId)
    Wazo.Auth.setHost(this.host)
  }

  async login(username, password) {
    this.init()
    try {
      this.session = await Wazo.Auth.logIn(username, password)
      return true
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  logout() {
    if (this.session) {
      Wazo.Auth.logout(this.session)
      this.session = null
    }
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
      // Audio: true cần thiết cho WebRTC
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
      Wazo.Phone.disconnect()
    } catch (e) {
      /* Ignore */
    }
  }

  attachListeners() {
    // Lắng nghe sự kiện từ SDK và phát ra event toàn cục qua window
    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
    })
  }

  // Các hàm điều khiển cuộc gọi
  makeCall(extension) {
    return Wazo.Phone.call(extension)
  }

  hangup(callSession) {
    if (callSession) Wazo.Phone.hangup(callSession)
  }

  accept(callSession) {
    if (callSession) Wazo.Phone.accept(callSession)
  }

  reject(callSession) {
    if (callSession) Wazo.Phone.reject(callSession)
  }

  mute(callSession) {
    if (callSession) Wazo.Phone.mute(callSession)
  }

  hold(callSession) {
    if (callSession) Wazo.Phone.hold(callSession)
  }
}

export const wazoService = new WazoService()