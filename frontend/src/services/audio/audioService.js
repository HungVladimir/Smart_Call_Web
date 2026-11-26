/**
 * CallToneService - Quản lý chuông Web Audio và tiếng phím WAV qua HTMLAudio
 * Tự động tạo âm thanh thuần không cần phụ thuộc file .mp3 bên ngoài (hoạt động 100% offline).
 * Đảm bảo ngắt dứt khoát toàn bộ âm thanh chuông chờ và chuông đến khi cuộc gọi kết thúc/từ chối.
 */

import { logger } from '../common/loggerService.js'

/** Bỏ qua lỗi phát tiếng phím từ trình duyệt để không cản trở thao tác nhập số hoặc gửi DTMF. */
function ignoreDtmfPlaybackError() {
  /* Autoplay hoặc thiết bị audio lỗi chỉ làm mất tiếng phím cục bộ. */
}

class CallToneService {
  /** Chuẩn bị timer và danh sách node âm thanh; AudioContext chỉ được lấy/tạo khi cần phát âm báo. */
  constructor() {
    this.audioCtx = null
    this.ringInterval = null
    this.ringbackInterval = null
    this.isRinging = false
    this.isRingbackActive = false
    this.activeOscillators = []
    this.dtmfAudio = null
    this.dtmfToneUrls = new Map()
  }

  /** Lấy/tạo AudioContext theo khả năng trình duyệt và mở lại context khi cần phát âm báo. */
  _getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass()
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume()
    }
    return this.audioCtx
  }

  /** Theo dõi oscillator đang phát để mọi âm báo đều có thể được dừng và giải phóng tập trung. */
  _trackOscillator(osc) {
    const toneService = this
    this.activeOscillators.push(osc)

    /** Gỡ oscillator khỏi danh sách theo dõi ngay khi âm báo phát xong. */
    function handleOscillatorEnded() {
      const idx = toneService.activeOscillators.indexOf(osc)
      if (idx !== -1) {
        toneService.activeOscillators.splice(idx, 1)
      }
    }

    osc.onended = handleOscillatorEnded
  }

  /** Dừng/disconnect các oscillator còn sống để âm của cuộc gọi trước không kéo dài sang cuộc mới. */
  _stopAllActiveOscillators() {
    while (this.activeOscillators.length > 0) {
      const osc = this.activeOscillators.pop()
      try {
        osc.stop(0)
        osc.disconnect()
      } catch {
        /* Oscillator có thể đã tự kết thúc hoặc đã bị ngắt kết nối trước lúc cleanup. */
      }
    }
  }

  /**
   * Phát chuông cuộc gọi đến (Incoming Ringtone)
   * Chu kỳ: Kêu 1.6 giây -> Nghỉ 2.0 giây -> Lặp lại
   * Tần số kép chuẩn Bắc Mỹ / Châu Âu: 440Hz + 480Hz
   */
  startIncomingRingtone() {
    if (this.isRinging) return
    const ctx = this._getAudioContext()
    if (!ctx) return

    const toneService = this
    this.isRinging = true
    logger.info('AUDIO', '🔔 Bắt đầu phát chuông cuộc gọi đến (Incoming Ringtone)')

    /** Phát một nhịp âm báo trong chu kỳ ringing; vòng đời chu kỳ được nơi gọi quản lý. */
    function playRingCycle() {
      if (!toneService.isRinging) return

      try {
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gainNode = ctx.createGain()

        osc1.type = 'sine'
        osc2.type = 'sine'
        osc1.frequency.setValueAtTime(440, ctx.currentTime) // 440 Hz
        osc2.frequency.setValueAtTime(480, ctx.currentTime) // 480 Hz

        // Tăng/giảm âm lượng mềm (fade in / fade out) để không bị tiếng "bụp"
        gainNode.gain.setValueAtTime(0, ctx.currentTime)
        gainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.1)
        gainNode.gain.setValueAtTime(0.25, ctx.currentTime + 1.5)
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.6)

        osc1.connect(gainNode)
        osc2.connect(gainNode)
        gainNode.connect(ctx.destination)

        toneService._trackOscillator(osc1)
        toneService._trackOscillator(osc2)

        osc1.start(ctx.currentTime)
        osc2.start(ctx.currentTime)
        osc1.stop(ctx.currentTime + 1.6)
        osc2.stop(ctx.currentTime + 1.6)
      } catch (error) {
        logger.warn('AUDIO', 'Lỗi phát âm thanh chuông:', error)
      }
    }

    playRingCycle()
    this.ringInterval = setInterval(playRingCycle, 3600)
  }

  /**
   * Dừng chuông cuộc gọi đến
   */
  stopIncomingRingtone() {
    if (this.isRinging) {
      this.isRinging = false
      logger.info('AUDIO', '⏹️ Đã dừng chuông cuộc gọi đến')
    }
    if (this.ringInterval) {
      clearInterval(this.ringInterval)
      this.ringInterval = null
    }
    this._stopAllActiveOscillators()
  }

  /**
   * Phát chu kỳ chuông chờ cuộc gọi đi lặp lại liên tục (Ringback Tone: Tút... Tút...)
   */
  startRingbackTone() {
    if (this.isRingbackActive) return
    const toneService = this
    this.isRingbackActive = true
    logger.info('AUDIO', '🎵 Bắt đầu phát chuông chờ cuộc gọi đi (Ringback Tone: Tút... Tút...)')

    /** Tạo oscillator/gain cho một nhịp chuông chờ và thu hồi node sau khi phát xong. */
    function playRingbackCycle() {
      if (!toneService.isRingbackActive) return
      toneService.playRingbackTone()
    }

    playRingbackCycle()
    this.ringbackInterval = setInterval(playRingbackCycle, 3000)
  }

  /**
   * Dừng chuông chờ cuộc gọi đi (Cắt dứt khoát toàn bộ âm thanh ngay lập tức)
   */
  stopRingbackTone() {
    if (this.isRingbackActive) {
      this.isRingbackActive = false
      logger.info('AUDIO', '⏹️ Đã dừng chuông chờ cuộc gọi đi (Ringback Tone dừng hoàn toàn)')
    }
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval)
      this.ringbackInterval = null
    }
    this._stopAllActiveOscillators()
  }

  /**
   * Ngắt toàn bộ mọi loại âm thanh (Incoming ring, Ringback chờ, Keypad DTMF)
   */
  stopAllTones() {
    // Âm bàn phím dùng HTMLAudio riêng để không khởi tạo AudioContext trong lần bấm đầu.
    if (this.dtmfAudio) {
      try {
        this.dtmfAudio.pause()
        this.dtmfAudio.currentTime = 0
      } catch {
        /* Thiết bị âm thanh lỗi không được chặn cleanup cuộc gọi. */
      }
    }
    this.stopRingbackTone()
    this.stopIncomingRingtone()
    this._stopAllActiveOscillators()
  }

  /**
   * Phát âm thanh chuông chờ cuộc gọi đi (Ringback Tone: Tút... Tút...)
   */
  playRingbackTone() {
    if (!this.isRingbackActive) return
    const ctx = this._getAudioContext()
    if (!ctx) return

    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(425, ctx.currentTime) // 425 Hz tiêu chuẩn ITU-T

      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05)
      gain.gain.setValueAtTime(0.15, ctx.currentTime + 0.95)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0)

      osc.connect(gain)
      gain.connect(ctx.destination)

      this._trackOscillator(osc)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 1.0)
    } catch (error) {
      logger.warn('AUDIO', 'Không thể phát chuông chờ cuộc gọi đi:', error)
    }
  }

  /** Tạo WAV ngắn cho từng phím và tái sử dụng URL trong RAM; không mở AudioContext/thiết bị đồng bộ. */
  _getDtmfToneUrl(digit) {
    if (this.dtmfToneUrls.has(digit)) return this.dtmfToneUrls.get(digit)
    const dtmfFreqs = {
      1: [697, 1209],
      2: [697, 1336],
      3: [697, 1477],
      4: [770, 1209],
      5: [770, 1336],
      6: [770, 1477],
      7: [852, 1209],
      8: [852, 1336],
      9: [852, 1477],
      '*': [941, 1209],
      0: [941, 1336],
      '#': [941, 1477],
    }

    const freqs = dtmfFreqs[digit]
    if (!freqs) return null
    const sampleRate = 8000,
      sampleCount = 960 // Âm 120 ms, PCM mono 16 bit.
    const buffer = new ArrayBuffer(44 + sampleCount * 2)
    const wave = new DataView(buffer)

    /** Ghi chuỗi ASCII cố định vào header WAV tại offset cho trước để tạo bộ đệm hợp lệ. */
    function writeWavHeaderText(offset, text) {
      for (let index = 0; index < text.length; index += 1) {
        wave.setUint8(offset + index, text.charCodeAt(index))
      }
    }

    // Header WAV mô tả PCM mono, 16 bit, little-endian; trình duyệt tự giải mã/phát bất đồng bộ.
    writeWavHeaderText(0, 'RIFF')
    wave.setUint32(4, buffer.byteLength - 8, true)
    writeWavHeaderText(8, 'WAVE')
    writeWavHeaderText(12, 'fmt ')
    wave.setUint32(16, 16, true)
    wave.setUint16(20, 1, true)
    wave.setUint16(22, 1, true)
    wave.setUint32(24, sampleRate, true)
    wave.setUint32(28, sampleRate * 2, true)
    wave.setUint16(32, 2, true)
    wave.setUint16(34, 16, true)
    writeWavHeaderText(36, 'data')
    wave.setUint32(40, sampleCount * 2, true)
    for (let i = 0; i < sampleCount; i++) {
      const time = i / sampleRate
      // Tăng/giảm âm nhẹ ở hai đầu để tránh tiếng tách khi bấm nhanh.
      const envelope = Math.min(1, i / 40, (sampleCount - 1 - i) / 80)
      const sample =
        (Math.sin(2 * Math.PI * freqs[0] * time) + Math.sin(2 * Math.PI * freqs[1] * time)) *
        2600 *
        envelope
      wave.setInt16(44 + i * 2, sample, true)
    }
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
    this.dtmfToneUrls.set(digit, url)
    return url
  }

  /** Phát tiếng phím bằng HTMLAudio; play() mở thiết bị bất đồng bộ, lỗi âm thanh không chặn nhập số. */
  playDtmfTone(digit) {
    try {
      const url = this._getDtmfToneUrl(String(digit))
      if (!url) return
      if (!this.dtmfAudio) this.dtmfAudio = new Audio()
      this.dtmfAudio.pause()
      if (this.dtmfAudio.src !== url) this.dtmfAudio.src = url
      this.dtmfAudio.currentTime = 0
      this.dtmfAudio.play()?.catch(ignoreDtmfPlaybackError)
    } catch {
      // Nhập số và DTMF gửi tới tổng đài vẫn hoạt động khi trình duyệt không phát được âm cục bộ.
    }
  }

  /** Lập lịch một tiếng bíp kết thúc cuộc gọi tại độ trễ xác định trên AudioContext hiện tại. */
  _scheduleCallEndedBeep(ctx, startTime, offsetSeconds) {
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.setValueAtTime(480, startTime + offsetSeconds)
      gain.gain.setValueAtTime(0.12, startTime + offsetSeconds)
      gain.gain.linearRampToValueAtTime(0, startTime + offsetSeconds + 0.12)

      osc.connect(gain)
      gain.connect(ctx.destination)

      this._trackOscillator(osc)
      osc.start(startTime + offsetSeconds)
      osc.stop(startTime + offsetSeconds + 0.12)
    } catch (error) {
      logger.warn('AUDIO', 'Không thể phát âm báo kết thúc cuộc gọi:', error)
    }
  }

  /**
   * Âm thanh kết thúc cuộc gọi (3 tiếng bíp cúp máy)
   */
  playCallEndedTone() {
    this.stopAllTones()
    const ctx = this._getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    for (const offsetSeconds of [0, 0.2, 0.4]) {
      this._scheduleCallEndedBeep(ctx, now, offsetSeconds)
    }
  }
}

export const callToneService = new CallToneService()
