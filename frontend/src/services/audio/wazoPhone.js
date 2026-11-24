import { logger } from '../common/loggerService.js'

/** Cô lập thiết bị, luồng audio và cách khắc phục auto-hold của SDK. */
export class PhoneAdapter {
  /**
   * Giữ SDK và hàm kiểm tra có cuộc gọi, phục vụ đổi thiết bị/phát stream mà không giữ state cuộc
   * gọi riêng.
   */
  constructor({ sdk, isCallActive }) {
    this.sdk = sdk
    this.isCallActive = isCallActive
  }

  /** Áp dụng mic/loa được chọn vào SDK và phần tử audio khi trình duyệt hỗ trợ. */
  async applyAudioDevices({ microphoneId, speakerId } = {}) {
    const mic = microphoneId || localStorage.getItem('smartcall_selected_mic') || 'default'
    const speaker = speakerId || localStorage.getItem('smartcall_selected_speaker') || 'default'
    const phone = this.sdk.Phone?.phone
    const media = { audio: mic === 'default' ? true : { deviceId: { exact: mic } }, video: false }
    phone?.setMediaConstraints?.(media)
    if (phone && this.isCallActive()) await phone.changeAudioInputDevice?.(mic)
    if (phone) await phone.changeAudioDevice?.(speaker)
    const audio = document.getElementById('wazo-remote-audio')
    if (audio?.setSinkId) await audio.setSinkId(speaker)
  }

  /** Bịt tiếng nhánh mời ngay khi SDK tạo thẻ audio, trước khi SDK gắn early media hoặc stream đã trả lời. */
  guardGroupInviteAudio(shouldMuteSipAudio) {
    const client = this.sdk.Phone?.phone?.client
    if (!client?.createAudioElementFor || this.guardedAudioClient === client) return
    this.guardedAudioClient = client
    const createAudioElement = client.createAudioElementFor.bind(client)
    /** Giữ nhánh chờ ở trạng thái muted kể cả khi tạo audio phải đợi chọn thiết bị đầu ra. */
    async function createGuardedAudioElement(sipId) {
      const startedMuted = shouldMuteSipAudio(sipId)
      const audio = await createAudioElement(sipId)
      if (shouldMuteSipAudio(sipId, startedMuted)) audio.muted = true
      return audio
    }
    client.createAudioElementFor = createGuardedAudioElement
  }

  /** Chỉ mở tiếng thẻ SDK của nhánh đã xác minh, để SDK tiếp tục sở hữu phần tử và cleanup. */
  allowGroupInviteAudio(sipId) {
    const audio = this.sdk.Phone?.phone?.client?.audioElements?.[sipId]
    if (!audio) return false
    audio.muted = false
    return true
  }

  /** Tắt thẻ SDK của nhánh cũ khi chuyển đường nghe sang nhánh chính hoặc hội nghị khác. */
  muteGroupInviteAudio(sipId) {
    const audio = this.sdk.Phone?.phone?.client?.audioElements?.[sipId]
    if (audio) audio.muted = true
  }

  /** Giới hạn can thiệp auto-hold trong adapter để có thể kiểm tra lại khi nâng SDK. */
  disableSdkAutomaticHold() {
    try {
      if (this.sdk.Phone) {
        this.sdk.Phone.hold = () => Promise.resolve()
        this.sdk.Phone.unhold = () => Promise.resolve()
        this.sdk.Phone.resume = () => Promise.resolve()
      }

      const phoneInstance = this.sdk.Phone?.phone
      const WebRTCPhoneClass = phoneInstance?.constructor
      if (WebRTCPhoneClass && WebRTCPhoneClass.prototype) {
        WebRTCPhoneClass.prototype.holdSipSession = async function () {
          logger.info(
            'CALL',
            '🛡️ Đã chặn lệnh holdSipSession tự động từ SDK (triệt tiêu Hold & Music On Hold)',
          )
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.hold = function () {
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.unholdSipSession = async function () {
          return Promise.resolve()
        }
        WebRTCPhoneClass.prototype.unhold = function () {
          return Promise.resolve()
        }
      }

      if (phoneInstance) {
        phoneInstance.holdSipSession = async function () {
          logger.info(
            'CALL',
            '🛡️ Đã chặn lệnh holdSipSession trên instance (triệt tiêu Hold & Music On Hold)',
          )
          return Promise.resolve()
        }
        phoneInstance.hold = () => Promise.resolve()
        phoneInstance.unhold = () => Promise.resolve()
      }
    } catch (err) {
      logger.warn('CALL', 'Không thể cấu hình triệt tiêu SDK auto-hold:', err)
    }
  }

  /** Phát remote MediaStream qua phần tử audio dự phòng của Web. */
  playCallAudio(stream) {
    let audioElement = document.getElementById('wazo-remote-audio')
    if (!audioElement) {
      audioElement = document.createElement('audio')
      audioElement.id = 'wazo-remote-audio'
      audioElement.autoplay = true
      document.body.appendChild(audioElement)
    }
    const speaker = localStorage.getItem('smartcall_selected_speaker') || 'default'
    if (audioElement.setSinkId)
      audioElement
        .setSinkId(speaker)
        .catch((err) => logger.warn('AUDIO', 'Không thể chọn loa:', err.message))
    audioElement.srcObject = stream
    audioElement.play().catch((err) => {
      logger.warn('AUDIO', 'Trình duyệt chặn Autoplay Audio (Cần tương tác người dùng):', err)
    })
  }

  /** Dừng phần tử audio dự phòng và gỡ MediaStream đang gắn. */
  stopCallAudio() {
    const audioElement = document.getElementById('wazo-remote-audio')
    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
    }
  }
}
