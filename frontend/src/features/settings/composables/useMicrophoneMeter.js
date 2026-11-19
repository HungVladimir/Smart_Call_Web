import { ref, computed, onScopeDispose } from 'vue'

/** Chỉ giữ một microphone stream; đóng modal hoặc nhận stream muộn đều dọn track/context. */
export function useMicrophoneMeter({ isActive, getMicrophoneId }) {
  const micLevel = ref(0)

  const isVoiceActive = ref(false)

  let lastVoiceTime = 0

  const VAD_THRESHOLD = 10

  const VAD_HANGOVER_MS = 1000

  const micStatusText = computed(() => {
    if (isVoiceActive.value) {
      return '🟢 Đang nhận tín hiệu giọng nói'
    }
    return '⚪ Sẵn sàng (Hãy nói vào mic để thử)'
  })

  let audioContext = null

  let analyser = null

  let micStream = null

  let animFrameId = null

  let micGeneration = 0

  let disposed = false

  const startMicMeter = async () => {
    stopMicMeter()
    const generation = micGeneration
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
      if (generation !== micGeneration || disposed || !isActive()) {
        stream.getTracks().forEach((track) => track.stop())
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
      if (generation !== micGeneration || disposed || !isActive()) return
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4

      const source = audioContext.createMediaStreamSource(micStream)
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateVolume = () => {
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
      if (generation !== micGeneration) return
      stopMicMeter()
      console.warn('Lỗi kết nối Micro đo tín hiệu VU:', e)
    }
  }

  const stopMicMeter = () => {
    micGeneration += 1
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop())
      micStream = null
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {})
      audioContext = null
    }
    micLevel.value = 0
    isVoiceActive.value = false
    lastVoiceTime = 0
  }
  onScopeDispose(() => {
    disposed = true
    stopMicMeter()
  })
  return { micLevel, isVoiceActive, micStatusText, startMicMeter, stopMicMeter }
}
