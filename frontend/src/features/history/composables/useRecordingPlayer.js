import { ref, computed, onScopeDispose } from 'vue'
import {
  captureSessionContext,
  isSessionContextCurrent,
} from '../../../core/session/sessionScope.js'

/** Sở hữu audio element và chống phản hồi đảo thứ tự; view chỉ giữ bộ lọc lịch sử. */
export function useRecordingPlayer({ recordingService, canPlay }) {
  const currentPlayingId = ref(null)

  const isPlaying = ref(false)

  const playbackCurrentTime = ref(0)

  const playbackDuration = ref(0)

  const playbackProgress = computed(() => {
    if (!playbackDuration.value) return 0
    return Math.min(100, Math.max(0, (playbackCurrentTime.value / playbackDuration.value) * 100))
  })

  let audioElement = null

  let playbackGeneration = 0

  let viewActive = true

  const stopCurrentAudio = () => {
    playbackGeneration += 1
    if (audioElement) {
      audioElement.pause()
      audioElement.removeAttribute('src')
      audioElement.load()
      audioElement = null
    }
    isPlaying.value = false
    playbackCurrentTime.value = 0
    playbackDuration.value = 0
    currentPlayingId.value = null
  }

  const togglePlayCall = async (call) => {
    if (!viewActive || !canPlay()) return
    if (currentPlayingId.value === call.id) {
      if (isPlaying.value) {
        audioElement?.pause()
        isPlaying.value = false
      } else {
        try {
          await audioElement?.play()
          isPlaying.value = Boolean(audioElement)
        } catch {
          isPlaying.value = false
        }
      }
      return
    }

    stopCurrentAudio()
    currentPlayingId.value = call.id
    const generation = playbackGeneration
    const context = captureSessionContext()
    const current = () =>
      generation === playbackGeneration &&
      viewActive &&
      isSessionContextCurrent(context) &&
      currentPlayingId.value === call.id &&
      canPlay()

    try {
      const audioUrl = await recordingService.getAudioUrlForCall(call)
      if (!current()) return
      if (!audioUrl) {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: '⚠️ Không tìm thấy nguồn phát âm thanh ghi âm cho cuộc gọi này.',
              type: 'warning',
            },
          }),
        )
        currentPlayingId.value = null
        return
      }

      const audio = new Audio(audioUrl)
      audioElement = audio
      audio.ontimeupdate = () => {
        if (!current()) return
        playbackCurrentTime.value = audio.currentTime || 0
        if (audio.duration && isFinite(audio.duration)) {
          playbackDuration.value = audio.duration
        } else if (call.duration) {
          playbackDuration.value = call.duration
        }
      }
      audio.onloadedmetadata = () => {
        if (!current()) return
        if (audio.duration && isFinite(audio.duration)) {
          playbackDuration.value = audio.duration
        } else if (call.duration) {
          playbackDuration.value = call.duration
        }
      }
      audio.onended = () => {
        if (!current()) return
        isPlaying.value = false
        playbackCurrentTime.value = 0
      }
      audio.onerror = (e) => {
        if (!current()) return
        console.warn('Lỗi phát âm thanh:', e)
        isPlaying.value = false
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: '❌ Không thể phát file âm thanh này.',
              type: 'error',
            },
          }),
        )
      }

      await audio.play()
      if (!current()) {
        audio.pause()
        return
      }
      isPlaying.value = true
    } catch (err) {
      console.error('Không thể phát ghi âm:', err)
      if (current()) stopCurrentAudio()
    }
  }

  const seekCallAudio = async (call, event) => {
    const track = event.currentTarget
    const rect = track.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, clickX / rect.width))

    if (currentPlayingId.value !== call.id || !audioElement) {
      await togglePlayCall(call)
    }

    if (audioElement && currentPlayingId.value === call.id && viewActive) {
      const totalDuration = playbackDuration.value || call.duration || 0
      const newTime = ratio * totalDuration
      audioElement.currentTime = newTime
      playbackCurrentTime.value = newTime
    }
  }
  const activatePlayer = () => {
    viewActive = true
  }
  const deactivatePlayer = () => {
    viewActive = false
    stopCurrentAudio()
  }
  onScopeDispose(deactivatePlayer)
  return {
    currentPlayingId,
    isPlaying,
    playbackCurrentTime,
    playbackDuration,
    playbackProgress,
    stopCurrentAudio,
    togglePlayCall,
    seekCallAudio,
    activatePlayer,
    deactivatePlayer,
  }
}
