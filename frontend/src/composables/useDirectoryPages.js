import { ref, shallowRef, watch, onScopeDispose } from 'vue'

/** Giữ vòng đời truy vấn riêng cho mỗi panel/modal, hủy kết quả khi đổi từ khóa hoặc đóng màn hình. */
export function useDirectoryPages(getQuery, requestPage) {
  const contacts = shallowRef([])
  const loading = ref(false)
  const error = ref('')
  const nextOffset = ref(null)
  const seenPages = new Set()
  let controller
  let timer
  let currentQuery
  let failedOffset = 0

  /** Bỏ debounce và request cũ trước khi chuyển phạm vi hoặc hủy view. */
  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  /** Nạp trang, giữ mục đã có khi Xem thêm lỗi và từ chối trang bị Wazo lặp lại. */
  async function load(offset = 0) {
    cancel()
    if (!currentQuery) return
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    failedOffset = offset
    try {
      const page = await requestPage({ ...currentQuery, offset, signal: request.signal })
      // API có thể hoàn tất dù request vừa bị hủy; không dùng kết quả từ truy vấn trước.
      if (controller !== request || request.signal.aborted) return
      if (offset && seenPages.has(page.pageKey)) {
        nextOffset.value = null
        error.value = 'Wazo trả lặp kết quả. Vui lòng làm mới danh bạ.'
        return
      }
      if (!offset) seenPages.clear()
      seenPages.add(page.pageKey)
      const unique = new Map()
      for (const contact of offset ? [...contacts.value, ...page.contacts] : page.contacts)
        unique.set(contact.uuid || contact.source + ':' + contact.id, contact)
      contacts.value = [...unique.values()]
      nextOffset.value = page.nextOffset
    } catch (failure) {
      if (controller === request && !request.signal.aborted)
        error.value = failure.message || 'Chưa tải được danh bạ. Vui lòng thử lại.'
    } finally {
      if (controller === request) loading.value = false
    }
  }

  /** Khởi động lại khi từ khóa, tab hoặc modal đổi; bỏ kết quả truy vấn cũ ngay trên giao diện. */
  function changeQuery(query) {
    cancel()
    currentQuery = query
    contacts.value = []
    error.value = ''
    nextOffset.value = null
    seenPages.clear()
    if (!query || query.waitForInput) return
    if (query.term || query.department) {
      loading.value = true
      timer = setTimeout(load, 300)
    } else void load()
  }

  /** Chỉ xin đúng offset tiếp theo khi người dùng yêu cầu. */
  function loadMore() {
    if (!loading.value && nextOffset.value !== null) void load(nextOffset.value)
  }

  /** Thử lại request vừa lỗi, giữ các trang trước nếu lỗi xảy ra khi Xem thêm. */
  function retry() {
    if (currentQuery?.waitForInput) return
    void load(failedOffset)
  }

  /** Làm mới trang đầu khi người dùng bấm nút, giữ kết quả cũ nếu request lỗi. */
  function refresh() {
    if (!currentQuery?.waitForInput) void load()
  }

  watch(getQuery, changeQuery, { immediate: true })
  onScopeDispose(cancel)
  return { contacts, loading, error, nextOffset, loadMore, retry, refresh }
}
