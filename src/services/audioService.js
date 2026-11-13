/**
 * AudioService - Bộ tạo âm thanh tổng đài WebRTC chuẩn bằng Web Audio API
 * Tự động tạo âm thanh thuần không cần phụ thuộc file .mp3 bên ngoài (hoạt động 100% offline).
 * Đảm bảo ngắt dứt khoát toàn bộ âm thanh chuông chờ và chuông đến khi cuộc gọi kết thúc/từ chối.
 */

import { logger } from './loggerService'

class AudioService {
  constructor() {
    this.audioCtx = null
    this.ringInterval = null
    this.ringbackInterval = null
    this.isRinging = false
    this.isRingbackActive = false
    this.activeOscillators = []
  }

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

  _trackOscillator(osc) {
    this.activeOscillators.push(osc)
    osc.onended = () => {
      const idx = this.activeOscillators.indexOf(osc)
      if (idx !== -1) {
        this.activeOscillators.splice(idx, 1)
      }
    }
  }

  _stopAllActiveOscillators() {
    while (this.activeOscillators.length > 0) {
      const osc = this.activeOscillators.pop()
      try {
        osc.stop(0)
        osc.disconnect()
      } catch (e) {
        /* ignore */
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

    this.isRinging = true
    logger.info('AUDIO', '🔔 Bắt đầu phát chuông cuộc gọi đến (Incoming Ringtone)')

    const playRingCycle = () => {
      if (!this.isRinging) return

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

        this._trackOscillator(osc1)
        this._trackOscillator(osc2)

        osc1.start(ctx.currentTime)
        osc2.start(ctx.currentTime)
        osc1.stop(ctx.currentTime + 1.6)
        osc2.stop(ctx.currentTime + 1.6)
      } catch (e) {
        console.warn('Lỗi phát âm thanh chuông:', e)
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
    this.isRingbackActive = true
    logger.info('AUDIO', '🎵 Bắt đầu phát chuông chờ cuộc gọi đi (Ringback Tone: Tút... Tút...)')

    const playTone = () => {
      if (!this.isRingbackActive) return
      this.playRingbackTone()
    }
    playTone()
    this.ringbackInterval = setInterval(playTone, 3000)
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
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Phát âm thanh khi bấm phím số (DTMF Keypad Tone)
   */
  playDtmfTone(digit) {
    const ctx = this._getAudioContext()
    if (!ctx) return

    // Bảng tần số DTMF chuẩn
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

    const freqs = dtmfFreqs[digit] || [700, 1200]

    try {
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()

      osc1.frequency.setValueAtTime(freqs[0], ctx.currentTime)
      osc2.frequency.setValueAtTime(freqs[1], ctx.currentTime)

      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12)

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)

      this._trackOscillator(osc1)
      this._trackOscillator(osc2)

      osc1.start(ctx.currentTime)
      osc2.start(ctx.currentTime)
      osc1.stop(ctx.currentTime + 0.12)
      osc2.stop(ctx.currentTime + 0.12)
    } catch (e) {
      /* ignore */
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
    ;[0, 0.2, 0.4].forEach((offset) => {
      try {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.setValueAtTime(480, now + offset)
        gain.gain.setValueAtTime(0.12, now + offset)
        gain.gain.linearRampToValueAtTime(0, now + offset + 0.12)

        osc.connect(gain)
        gain.connect(ctx.destination)

        this._trackOscillator(osc)
        osc.start(now + offset)
        osc.stop(now + offset + 0.12)
      } catch (e) {
        /* ignore */
      }
    })
  }
}

export const audioService = new AudioService()
