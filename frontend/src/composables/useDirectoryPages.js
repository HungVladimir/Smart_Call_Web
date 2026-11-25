import { ref, shallowRef, watch, onScopeDispose } from 'vue'

/** Giữ đúng một trang và bỏ response cũ khi đổi từ khóa, bộ lọc hoặc rời view. */
export function useDirectoryPages(getQuery, requestPage) {
  const contacts = shallowRef([])
  const loading = ref(false)
  const error = ref('')
  const offset = ref(0)
  const nextOffset = ref(null)
  const total = ref(null)
  let controller
  let timer
  let currentQuery
  let failedOffset = 0

  /** Dừng debounce và request của trang cũ khi view không còn dùng kết quả đó. */
  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  /** Đọc một trang mới, giữ trang đã có nếu gặp lỗi và chặn response đến muộn. */
  async function load(requestedOffset = 0) {
    cancel()
    if (!currentQuery || currentQuery.waitForInput) return
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    failedOffset = requestedOffset
    try {
      const page = await requestPage({
        ...currentQuery,
        offset: requestedOffset,
        signal: request.signal,
      })
      if (controller !== request || request.signal.aborted) return
      contacts.value = page.contacts
      offset.value = requestedOffset
      nextOffset.value = page.nextOffset
      total.value = page.total ?? null
    } catch (failure) {
      if (controller === request && !request.signal.aborted)
        error.value = failure.message || 'Chưa tải được danh bạ.'
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
    void load(failedOffset)
  }

  /** Làm mới trang đang hiển thị theo cùng bộ lọc. */
  function refresh() {
    void load(offset.value)
  }

  watch(getQuery, changeQuery, { immediate: true })
  onScopeDispose(cancel)
  return { contacts, loading, error, offset, nextOffset, total, loadMore, previous, retry, refresh }
}
