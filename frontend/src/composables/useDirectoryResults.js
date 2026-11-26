import { ref, shallowRef, watch, onScopeDispose } from 'vue'

/** Giữ danh sách của truy vấn hiện tại và hủy lượt cũ khi người dùng đổi điều kiện hoặc rời màn. */
export function useDirectoryResults(getQuery, requestResults) {
  const contacts = shallowRef([])
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  let controller
  let timer
  let query

  /** Dừng cả request và thời gian chờ gõ khi truy vấn không còn hiệu lực. */
  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  /** Tải đúng truy vấn hiện tại và giữ kết quả trước nếu làm mới gặp lỗi tạm thời. */
  async function refresh(force = false) {
    cancel()
    if (!query) return
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    try {
      const result = await requestResults({
        ...query,
        refresh: force === true,
        signal: request.signal,
      })
      if (controller !== request || request.signal.aborted) return
      contacts.value = result.contacts
      notice.value = result.notice || ''
    } catch (failure) {
      if (controller !== request || request.signal.aborted) return
      // Khi quyền không còn, gỡ dữ liệu của lần đọc trước khỏi giao diện.
      if (failure.status === 401 || failure.status === 403) {
        contacts.value = []
        notice.value = ''
      }
      error.value = failure.message || 'Chưa tải được danh bạ.'
    } finally {
      if (controller === request) loading.value = false
    }
  }

  /** Chỉ gửi tìm kiếm khi dừng gõ, còn bộ phận và yêu thích có thể tải ngay. */
  function changeQuery(value) {
    cancel()
    query = value
    contacts.value = []
    error.value = ''
    notice.value = ''
    if (!query) return
    if (query.term) {
      loading.value = true
      timer = setTimeout(refresh, 300)
    } else void refresh()
  }

  watch(getQuery, changeQuery, { immediate: true })
  onScopeDispose(cancel)
  return { contacts, loading, error, notice, refresh }
}
