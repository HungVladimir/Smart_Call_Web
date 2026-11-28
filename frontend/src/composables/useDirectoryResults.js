import { ref, shallowRef, watch, onScopeDispose } from 'vue'

/** Chuẩn hóa khóa truy vấn để phân biệt giữ nguyên kết quả KeepAlive với truy vấn mới. */
function serializeQueryKey(value) {
  return value ? JSON.stringify(value) : ''
}

/** Giữ danh sách của truy vấn hiện tại và hủy lượt cũ khi người dùng đổi điều kiện hoặc rời màn. */
export function useDirectoryResults(
  getQuery,
  requestResults,
  { isActive = () => true, peekResults = null } = {},
) {
  const contacts = shallowRef([])
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  let controller
  let timer
  let query
  let loaded = false
  let loadedQueryKey = ''

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
    if (!query || !isActive()) return
    const targetQuery = query
    const targetKey = serializeQueryKey(targetQuery)
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    try {
      const result = await requestResults({
        ...targetQuery,
        refresh: force === true,
        signal: request.signal,
      })
      if (controller !== request || request.signal.aborted) return
      contacts.value = result.contacts
      notice.value = result.notice || ''
      loaded = true
      loadedQueryKey = targetKey
    } catch (failure) {
      if (controller !== request || request.signal.aborted) return
      // Khi quyền không còn, gỡ dữ liệu của lần đọc trước khỏi giao diện.
      if (failure.status === 401 || failure.status === 403) {
        contacts.value = []
        notice.value = ''
        loaded = false
        loadedQueryKey = ''
      }
      error.value = failure.message || 'Chưa tải được danh bạ.'
    } finally {
      if (controller === request) loading.value = false
    }
  }

  /** Chỉ gửi tìm kiếm khi dừng gõ; giữ kết quả đã tải qua KeepAlive và dùng RAM cache khi đổi tab. */
  function handleStateChange([value, active]) {
    const nextKey = serializeQueryKey(value)
    const sameQuery = nextKey === serializeQueryKey(query)
    query = value

    if (!active) {
      // Tạm rời sang route khác bằng KeepAlive: dừng request nền nhưng giữ nguyên danh sách đang xem.
      cancel()
      if (!query) {
        contacts.value = []
        notice.value = ''
        loaded = false
        loadedQueryKey = ''
      }
      return
    }

    if (!query) {
      cancel()
      contacts.value = []
      error.value = ''
      notice.value = ''
      loaded = false
      loadedQueryKey = ''
      return
    }

    const peeked = typeof peekResults === 'function' ? peekResults(query) : null
    if (sameQuery && loaded && loadedQueryKey === nextKey && !peeked) {
      return
    }

    cancel()
    error.value = ''

    if (peeked?.contacts) {
      contacts.value = peeked.contacts
      notice.value = peeked.notice || ''
      loaded = true
      loadedQueryKey = nextKey
      if (peeked.fresh) return
      void refresh()
      return
    }

    if (!sameQuery) {
      contacts.value = []
      notice.value = ''
      loaded = false
      loadedQueryKey = ''
    }

    if (query.term) {
      loading.value = true
      timer = setTimeout(refresh, 300)
    } else {
      void refresh()
    }
  }

  watch([getQuery, () => Boolean(isActive())], handleStateChange, { immediate: true })
  onScopeDispose(cancel)
  return { contacts, loading, error, notice, refresh }
}
