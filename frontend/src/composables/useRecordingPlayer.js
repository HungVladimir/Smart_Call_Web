import { ref, computed, onScopeDispose } from 'vue'
import { captureSessionContext, isSessionContextCurrent } from '../services/auth/sessionScope.js'
import { logger } from '../services/common/loggerService.js'

/** Sở hữu audio element và chống phản hồi đảo thứ tự; view chỉ giữ bộ lọc lịch sử. */
export function useRecordingPlayer({ recordingService, canPlay }) {
  const currentPlayingId = ref(null)

  const isPlaying = ref(false)

  const playbackCurrentTime = ref(0)

  const playbackDuration = ref(0)

  /** Tính phần trăm tiến độ của bản ghi đang phát để vẽ thanh tua. */
  function calculatePlaybackProgress() {
    if (!playbackDuration.value) return 0
    return Math.min(100, Math.max(0, (playbackCurrentTime.value / playbackDuration.value) * 100))
  }

  /** Cung cấp phần trăm tiến độ phản ứng theo thời gian thực cho thanh tua giao diện. */
  const playbackProgress = computed(calculatePlaybackProgress)

  let audioElement = null

  let playbackGeneration = 0

  let viewActive = true

  /** Dừng player hiện tại và hủy liên kết tài nguyên trước khi chuyển bản ghi hoặc rời trang. */
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

  /** Phát/dừng bản ghi được chọn; chỉ lựa chọn mới nhất được quyền nhận URL/audio trả về muộn. */
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
          // Trình duyệt có thể từ chối phát tiếp nếu chính sách autoplay hoặc stream lỗi; đặt về tạm dừng.
          isPlaying.value = false
        }
      }
      return
    }

    stopCurrentAudio()
    currentPlayingId.value = call.id
    const generation = playbackGeneration
    const context = captureSessionContext()
    /**
     * Kiểm tra tác vụ hiện tại còn thuộc đúng phiên và đúng thế hệ trước khi dùng kết quả bất đồng
     * bộ.
     */
    const current = () =>
      generation === playbackGeneration &&
      viewActive &&
      isSessionContextCurrent(context) &&
      currentPlayingId.value === call.id &&
      canPlay()

    try {
      const audioUrl = await recordingService.getAudioUrlForCall(call)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
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

      /** Cập nhật vị trí phát hiện tại và tổng thời lượng khi audio đang chạy. */
      function handleAudioTimeUpdate() {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        playbackCurrentTime.value = audio.currentTime || 0
        if (audio.duration && isFinite(audio.duration)) {
          playbackDuration.value = audio.duration
        } else if (call.duration) {
          playbackDuration.value = call.duration
        }
      }

      /** Nạp tổng thời lượng bản ghi ngay khi trình duyệt đọc xong metadata audio. */
      function handleAudioLoadedMetadata() {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        if (audio.duration && isFinite(audio.duration)) {
          playbackDuration.value = audio.duration
        } else if (call.duration) {
          playbackDuration.value = call.duration
        }
      }

      /** Đưa trạng thái phát về 0 khi file ghi âm chạy hết. */
      function handleAudioEnded() {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        isPlaying.value = false
        playbackCurrentTime.value = 0
      }

      /** Ghi nhận lỗi codec/tải audio và thông báo cho người dùng khi không phát được file. */
      function handleAudioError(event) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (!current()) return
        logger.warn('AUDIO', 'Lỗi phát âm thanh:', event)
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

      audio.ontimeupdate = handleAudioTimeUpdate
      audio.onloadedmetadata = handleAudioLoadedMetadata
      audio.onended = handleAudioEnded
      audio.onerror = handleAudioError

      await audio.play()
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!current()) {
        audio.pause()
        return
      }
      isPlaying.value = true
    } catch (err) {
      logger.error('AUDIO', 'Không thể phát ghi âm:', err)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (current()) stopCurrentAudio()
    }
  }

  /** Đổi vị trí phát theo thao tác trên thanh tiến độ, giới hạn trong thời lượng hợp lệ. */
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
  /** Cho phép player nhận thao tác khi màn hình lịch sử hoạt động trở lại. */
  const activatePlayer = () => {
    viewActive = true
  }
  /** Vô hiệu tác vụ player và dừng audio khi màn hình bị ẩn hoặc bị hủy. */
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
