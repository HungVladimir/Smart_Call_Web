import { ref, computed } from 'vue'

/** Lọc danh bạ cho giao diện; không tải API và không giữ bản sao của state liên hệ. */
export function useContactFilters({ getContacts, isAvailableForCall, getCurrentExtension }) {
  const searchTerm = ref('')

  const activeTab = ref('all')

  const selectedDepartment = ref('all')

  /** Chuẩn hóa Unicode/khoảng trắng từ IdP và Dird trước khi so phòng ban. */
  const departmentLabel = (value) =>
    String(value || '')
      .normalize('NFC')
      .trim()
      .replace(/\s+/g, ' ')
  /** So tên bộ phận không phân biệt chữ hoa/thường. */
  const departmentKey = (value) => departmentLabel(value).toLocaleLowerCase('vi')

  /** Tạo danh sách phòng ban duy nhất từ danh bạ hiện tại cho bộ lọc giao diện. */
  const availableDepartments = computed(() => {
    const depts = new Map()
    getContacts().forEach((c) => {
      const d = departmentLabel(c.dept)
      if (d && !depts.has(departmentKey(d))) depts.set(departmentKey(d), d)
    })
    return Array.from(depts.values()).sort((a, b) => a.localeCompare(b, 'vi'))
  })

  /** Đếm số liên hệ thuộc một phòng ban; giá trị all đại diện cho toàn bộ danh bạ. */
  const getDepartmentCount = (dept) => {
    if (!dept || dept === 'all') return getContacts().length
    return getContacts().filter((c) => departmentKey(c.dept) === departmentKey(dept)).length
  }

  /** Tính số lượng hiển thị trên tab phòng ban theo phòng ban đang được chọn. */
  const departmentTabCount = computed(() => {
    if (selectedDepartment.value === 'all') return getContacts().length
    return getDepartmentCount(selectedDepartment.value)
  })

  /** Bỏ dấu tiếng Việt và chuẩn hóa chữ để tìm kiếm không phân biệt dấu/hoa thường. */
  const removeVietnameseTones = (str) => {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim()
  }

  /** Kết hợp từ khóa, tab, phòng ban và điều kiện gọi nhóm để trả danh sách liên hệ hiển thị. */
  const filteredContacts = computed(() => {
    let list = getContacts()
    if (activeTab.value === 'favorites') {
      list = list.filter((c) => c.isFavorite)
    } else if (activeTab.value === 'online') {
      list = list.filter((c) => c.status !== 'offline' && c.status !== 'unavailable')
    } else if (activeTab.value === 'offline') {
      list = list.filter((c) => c.status === 'offline' || c.status === 'unavailable')
    } else if (activeTab.value === 'department') {
      if (selectedDepartment.value !== 'all') {
        const targetDept = departmentKey(selectedDepartment.value)
        list = list.filter((c) => departmentKey(c.dept) === targetDept)
      }
    } else if (activeTab.value === 'group_call') {
      // Chỉ hiển thị các liên hệ khả dụng sẵn sàng nhận cuộc gọi (Available) và ẩn chính mình
      const myExt = String(getCurrentExtension()).trim()
      list = list.filter((c) => isAvailableForCall(c) && String(c.number || '').trim() !== myExt)
    }
    const q = searchTerm.value.trim()
    if (!q) return list
    const cleanQ = removeVietnameseTones(q)
    return list.filter((c) => {
      const nameNorm = removeVietnameseTones(c.name || '')
      const deptNorm = removeVietnameseTones(c.dept || '')
      const numNorm = String(c.number || '').toLowerCase()
      return nameNorm.includes(cleanQ) || deptNorm.includes(cleanQ) || numNorm.includes(cleanQ)
    })
  })
  return {
    searchTerm,
    activeTab,
    selectedDepartment,
    availableDepartments,
    getDepartmentCount,
    departmentTabCount,
    filteredContacts,
  }
}
