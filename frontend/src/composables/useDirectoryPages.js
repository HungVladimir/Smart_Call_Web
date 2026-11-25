import { ref, shallowRef, watch, onScopeDispose } from 'vue'

/** Giữ đúng một trang và bỏ response cũ khi đổi từ khóa, bộ lọc hoặc rời view. */
export function useDirectoryPages(getQuery, requestPage) {
  const contacts = shallowRef([])
  const loading = ref(false)
  const error = ref('')
  const offset = ref(0)
  const nextOffset = ref(null)
  const total = ref(null)
  const notice = ref('')
  const fetchedAt = ref('')
  const refreshState = ref('')
  let controller
  let timer
  let currentQuery
  let failedOffset = 0
  let failedRefresh = false

  /** Dừng debounce và request của trang cũ khi view không còn dùng kết quả đó. */
  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  /** Đọc một trang mới, giữ trang đã có nếu gặp lỗi và chặn response đến muộn. */
  async function load(requestedOffset = 0, refresh = false) {
    cancel()
    if (!currentQuery || currentQuery.waitForInput) return
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    failedOffset = requestedOffset
    failedRefresh = refresh
    try {
      const page = await requestPage({
        ...currentQuery,
        offset: requestedOffset,
        refresh,
        signal: request.signal,
      })
      if (controller !== request || request.signal.aborted) return
      // Nguồn yêu thích có thể thu hẹp giữa hai trang và chưa trả offset đã hiệu chỉnh.
      if (
        page.offset == null &&
        page.total != null &&
        requestedOffset >= page.total &&
        requestedOffset
      )
        return await load(Math.max(0, Math.floor((page.total - 1) / 30)) * 30)
      contacts.value = page.contacts
      offset.value = page.offset ?? requestedOffset
      nextOffset.value = page.nextOffset
      total.value = page.total ?? null
      notice.value = page.notice || ''
      fetchedAt.value = page.fetchedAt || ''
      refreshState.value = refresh ? page.refreshState || '' : ''
    } catch (failure) {
      if (controller === request && !request.signal.aborted) {
        // Quyền đã mất phải gỡ trang cũ. Lỗi tạm thời vẫn cho xem bản đã tải.
        if (failure.status === 401 || failure.status === 403) {
          contacts.value = []
          total.value = null
          nextOffset.value = null
          offset.value = 0
          notice.value = ''
          fetchedAt.value = ''
          refreshState.value = ''
        }
        error.value = failure.message || 'Chưa tải được danh bạ.'
      }
    } finally {
      if (controller === request) loading.value = false
    }
  }

  /** Reset trang và kết quả sau khi người dùng thay điều kiện tra cứu. */
  function changeQuery(query) {
    cancel()
    currentQuery = query
    contacts.value = []
    error.value = ''
    offset.value = 0
    nextOffset.value = null
    total.value = null
    notice.value = ''
    fetchedAt.value = ''
    refreshState.value = ''
    if (!query || query.waitForInput) return
    if (query.term) {
      loading.value = true
      timer = setTimeout(load, 300)
    } else void load()
  }

  /** Thay trang đang hiện bằng trang tiếp theo, không tăng số thẻ đã render. */
  function loadMore() {
    if (!loading.value && nextOffset.value !== null) void load(nextOffset.value)
  }

  /** Tải lại một trang phía trước theo kích thước trang của API. */
  function previous() {
    if (!loading.value && offset.value) void load(Math.max(0, offset.value - 30))
  }

  /** Thử lại đúng offset đã lỗi. */
  function retry() {
    void load(failedOffset, failedRefresh)
  }

  /** Làm mới trang đang hiển thị theo cùng bộ lọc. */
  function refresh(force = false) {
    return load(offset.value, force)
  }

  watch(getQuery, changeQuery, { immediate: true })
  onScopeDispose(cancel)
  return {
    contacts,
    loading,
    error,
    offset,
    nextOffset,
    total,
    notice,
    fetchedAt,
    refreshState,
    loadMore,
    previous,
    retry,
    refresh,
  }
}
