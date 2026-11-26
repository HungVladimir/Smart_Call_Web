import { ref, computed, onScopeDispose } from 'vue'
import { logger } from '../services/common/loggerService.js'

/** Chỉ giữ một microphone stream; đóng modal hoặc nhận stream muộn đều dọn track/context. */
export function useMicrophoneMeter({ isActive, getMicrophoneId }) {
  const micLevel = ref(0)

  const isVoiceActive = ref(false)

  let lastVoiceTime = 0

  const VAD_THRESHOLD = 10

  const VAD_HANGOVER_MS = 1000

  /** Đổi trạng thái microphone/VAD thành nhãn dễ hiểu cho phần thử mic. */
  const micStatusText = computed(function getMicStatusText() {
    if (isVoiceActive.value) {
      return 'Đang nhận tín hiệu giọng nói'
    }
    return 'Sẵn sàng (Hãy nói vào mic để thử)'
  })

  let audioContext = null

  let analyser = null

  let micStream = null

  let animFrameId = null

  let micGeneration = 0

  let disposed = false

  /** Dừng từng MediaStreamTrack để trình duyệt tắt đèn micro ngay khi hủy hoặc hết phiên đo. */
  function stopMediaStreamTrack(track) {
    track.stop()
  }

  /** Bỏ qua lỗi đóng AudioContext khi trình duyệt đã giải phóng context từ trước. */
  function ignoreAudioContextCloseError() {}

  /**
   * Xin stream của mic đang chọn và khởi tạo bộ đo âm lượng; stream đến sau khi đóng phải được thu
   * hồi.
   */
  const startMicMeter = async () => {
    stopMicMeter()
    const generation = micGeneration
    // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
    // muộn sau hủy/đổi phiên.
    if (disposed || !isActive()) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    try {
      const constraints = {
        audio:
          getMicrophoneId() && getMicrophoneId() !== 'default'
            ? { deviceId: { exact: getMicrophoneId() } }
            : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (generation !== micGeneration || disposed || !isActive()) {
        stream.getTracks().forEach(stopMediaStreamTrack)
        return
      }
      micStream = stream
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) {
        stopMicMeter()
        return
      }
      audioContext = new AudioCtx()
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (generation !== micGeneration || disposed || !isActive()) return
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4

      const source = audioContext.createMediaStreamSource(micStream)
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      /**
       * Đọc dữ liệu analyser theo frame để cập nhật mức âm lượng và trạng thái phát hiện giọng
       * nói.
       */
      const updateVolume = () => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!analyser || generation !== micGeneration) return
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        // Chuẩn hóa mức âm lượng từ 0% đến 100%
        const currentVol = Math.min(100, Math.round((avg / 64) * 100))
        micLevel.value = currentVol

        // Thuật toán VAD Hangover:
        const now = Date.now()
        if (currentVol >= VAD_THRESHOLD) {
          isVoiceActive.value = true
          lastVoiceTime = now
        } else if (isVoiceActive.value && now - lastVoiceTime > VAD_HANGOVER_MS) {
          isVoiceActive.value = false
        }

        animFrameId = requestAnimationFrame(updateVolume)
      }
      updateVolume()
    } catch (e) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (generation !== micGeneration) return
      stopMicMeter()
      logger.warn('AUDIO', 'Lỗi kết nối Micro đo tín hiệu VU:', e)
    }
  }

  /** Dừng frame đo, đóng AudioContext và giải phóng mọi track mic đang được preview. */
  const stopMicMeter = () => {
    micGeneration += 1
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
    if (micStream) {
      micStream.getTracks().forEach(stopMediaStreamTrack)
      micStream = null
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(ignoreAudioContextCloseError)
      audioContext = null
    }
    micLevel.value = 0
    isVoiceActive.value = false
    lastVoiceTime = 0
  }

  /** Đánh dấu scope đã hủy và dừng stream đo micro khi component unmount. */
  function disposeMicrophoneMeter() {
    disposed = true
    stopMicMeter()
  }

  onScopeDispose(disposeMicrophoneMeter)
  return { micLevel, isVoiceActive, micStatusText, startMicMeter, stopMicMeter }
}
