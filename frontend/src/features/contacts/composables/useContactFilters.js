import { ref, computed } from 'vue'

/** Lọc danh bạ cho giao diện; không tải API và không giữ bản sao của state liên hệ. */
export function useContactFilters({ getContacts, isAvailableForCall, getCurrentExtension }) {
  const searchTerm = ref('')

  const activeTab = ref('all')

  const selectedDepartment = ref('all')

  const availableDepartments = computed(() => {
    const depts = new Set()
    getContacts().forEach((c) => {
      const d = (c.dept || '').trim()
      if (d) depts.add(d)
    })
    return Array.from(depts).sort((a, b) => a.localeCompare(b, 'vi'))
  })

  const getDepartmentCount = (dept) => {
    if (!dept || dept === 'all') return getContacts().length
    return getContacts().filter(
      (c) => (c.dept || '').trim().toLowerCase() === dept.trim().toLowerCase(),
    ).length
  }

  const departmentTabCount = computed(() => {
    if (selectedDepartment.value === 'all') {
      return (
        getContacts().filter((c) => Boolean((c.dept || '').trim())).length || getContacts().length
      )
    }
    return getDepartmentCount(selectedDepartment.value)
  })

  const removeVietnameseTones = (str) => {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim()
  }

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
        const targetDept = selectedDepartment.value.trim().toLowerCase()
        list = list.filter((c) => (c.dept || '').trim().toLowerCase() === targetDept)
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
