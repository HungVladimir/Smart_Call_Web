<template>
  <section class="contacts-col">
    <div class="contacts-panel-card">
      <!-- Panel Header: Search Box & Nút Làm mới -->
      <div class="panel-header">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchTerm"
            placeholder="Tìm nhân viên, số máy lẻ..."
            aria-label="Tìm kiếm trong danh bạ"
            class="search-input"
          />
          <button
            v-if="searchTerm"
            class="btn-clear-search"
            title="Xóa tìm kiếm"
            aria-label="Xóa từ khóa tìm kiếm"
            @click="clearSearch"
          >
            ✖
          </button>
        </div>

        <button
          class="btn-refresh"
          :disabled="loadingContacts"
          title="Làm mới danh bạ từ máy chủ"
          aria-label="Làm mới danh bạ từ máy chủ"
          @click="$emit('refresh')"
        >
          <span :class="{ 'spin-icon': loadingContacts }">↻</span>
        </button>
      </div>

      <!-- Filter Tabs: Dynamic 2-Row Grid (Cách 2) + Cài đặt ⚙️ -->
      <div class="panel-tabs-bar" :class="{ 'two-rows': visibleTabs.length > 5 }">
        <div class="panel-tabs-grid" :style="panelTabsGridStyle">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            class="panel-tab-btn"
            :class="{ active: activeTab === tab.id, [`tab-${tab.id}`]: true }"
            @click="activeTab = tab.id"
          >
            <span v-if="tab.id === 'all'" class="tab-icon">👥</span>
            <span v-else-if="tab.id === 'favorites'" class="tab-icon">⭐</span>
            <span v-else-if="tab.id === 'online'" class="tab-icon">🟢</span>
            <span v-else-if="tab.id === 'offline'" class="tab-icon">⚪</span>
            <svg
              v-else-if="tab.id === 'department'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="tab-svg-icon"
            >
              <path d="M3 21h18"></path>
              <path d="M5 21V7l8-4v18"></path>
              <path d="M19 21V11l-6-4"></path>
              <line x1="9" y1="9" x2="9.01"></line>
              <line x1="9" y1="13" x2="9" y2="13.01"></line>
              <line x1="9" y1="17" x2="9" y2="17.01"></line>
            </svg>
            <svg
              v-else-if="tab.id === 'group_call'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="tab-svg-icon"
            >
              <path
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
              ></path>
            </svg>

            <span class="tab-label">{{ tab.label }}</span>

            <span v-if="tab.id === 'all'" class="tab-badge">{{ contacts.length }}</span>
            <span v-else-if="tab.id === 'favorites'" class="tab-badge">{{ favoriteCount }}</span>
            <span v-else-if="tab.id === 'online'" class="tab-badge badge-online">{{
              onlineCount
            }}</span>
            <span v-else-if="tab.id === 'offline'" class="tab-badge badge-offline">{{
              offlineCount
            }}</span>
            <span v-else-if="tab.id === 'department'" class="tab-badge badge-dept">{{
              departmentTabCount
            }}</span>
            <span v-else-if="tab.id === 'group_call'" class="tab-badge badge-group">{{
              groupCallOnlineCount
            }}</span>
          </button>
        </div>

        <!-- Nút bánh răng Cài đặt hiển thị tab -->
        <button
          class="btn-tab-config"
          @click="showTabConfigModal = true"
          title="Tùy chỉnh danh mục hiển thị"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            ></path>
          </svg>
        </button>
      </div>

      <!-- Contact List Body -->
      <div class="panel-list-container">
        <!-- Thanh chọn Bộ phận / Phòng ban khi ở Tab Bộ phận -->
        <div v-if="activeTab === 'department'" class="dept-selector-bar">
          <div class="dept-bar-header">
            <div class="dept-bar-title">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              <span>Lọc theo bộ phận:</span>
            </div>
            <span class="dept-current-badge">{{
              selectedDepartment === 'all' ? 'Tất cả bộ phận' : selectedDepartment
            }}</span>
          </div>
          <div class="dept-chips-scroll">
            <button
              class="dept-chip-btn"
              :class="{ active: selectedDepartment === 'all' }"
              @click="selectedDepartment = 'all'"
            >
              <span>Tất cả</span>
              <small class="dept-chip-count">({{ contacts.length }})</small>
            </button>
            <button
              v-for="dept in availableDepartments"
              :key="dept"
              class="dept-chip-btn"
              :class="{ active: selectedDepartment === dept }"
              @click="selectedDepartment = dept"
            >
              <span>{{ dept }}</span>
              <small class="dept-chip-count">({{ getDepartmentCount(dept) }})</small>
            </button>
            <div v-if="availableDepartments.length === 0" class="dept-empty-hint">
              (Chưa có nhân viên nào được gán phòng ban)
            </div>
          </div>
        </div>

        <!-- Sticky Action Bar khi ở Tab Gọi nhóm -->
        <div v-if="activeTab === 'group_call'" class="group-call-selection-bar">
          <div class="selection-info">
            <span class="selection-pill">
              Đã chọn: <strong>{{ selectedGroupExtensions.length }}</strong> người
            </span>
            <div class="action-buttons-group">
              <button
                v-if="selectedGroupExtensions.length > 0"
                class="btn-action-pill btn-deselect-group"
                @click="clearGroupSelection"
                title="Bỏ chọn tất cả"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>Bỏ chọn</span>
              </button>
            </div>
          </div>
          <button
            class="btn-start-group"
            :disabled="selectedGroupExtensions.length < 2 || isCalling || isDialing"
            @click="handleStartGroupCallFromContacts"
            title="Bắt đầu cuộc gọi nhóm tới các thành viên đã chọn"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
              ></path>
            </svg>
            <span
              >Gọi nhóm
              {{
                selectedGroupExtensions.length >= 2 ? `(${selectedGroupExtensions.length})` : ''
              }}</span
            >
          </button>
        </div>

        <!-- Loading State -->
        <div v-if="loadingContacts && contacts.length === 0" class="panel-state-message">
          <div class="spinner"></div>
          <p>Đang nạp danh bạ từ máy chủ...</p>
        </div>

        <!-- Empty State -->
        <div v-else-if="filteredContacts.length === 0" class="panel-state-message empty">
          <p v-if="activeTab === 'favorites'">
            Chưa có liên hệ nào trong mục Yêu thích. Hãy bấm biểu tượng ⭐ trên thẻ nhân viên để
            ghim nhanh.
          </p>
          <p v-else-if="activeTab === 'online'">Hiện chưa có nhân viên nào đang trực tuyến.</p>
          <p v-else-if="activeTab === 'offline'">Hiện chưa có nhân viên nào đang ngoại tuyến.</p>
          <p v-else-if="activeTab === 'department'">
            Chưa có nhân viên nào thuộc bộ phận
            {{ selectedDepartment === 'all' ? 'này' : `"${selectedDepartment}"` }}.
          </p>
          <p v-else-if="activeTab === 'group_call'">
            Hiện không có đồng nghiệp nào đang trực tuyến để gọi nhóm.
          </p>
          <p v-else-if="searchTerm">Không tìm thấy nhân viên nào phù hợp với "{{ searchTerm }}".</p>
          <p v-else>Chưa có liên hệ nào trong danh bạ hệ thống.</p>
        </div>

        <!-- Contacts Cards List -->
        <div v-else class="contacts-items-list">
          <ContactCard
            v-for="contact in filteredContacts"
            :key="contact.id"
            :contact="contact"
            :group-selection-mode="activeTab === 'group_call'"
            :selected="isContactSelectedForGroup(contact)"
            :is-self="isSelf(contact)"
            :can-invite="canInviteContact(contact)"
            :busy="isCalling || isDialing"
            @select="toggleGroupContactSelection"
            @call="emit('call', $event)"
            @message="emit('message', $event)"
            @favorite="emit('favorite', $event)"
          />
        </div>
      </div>
    </div>
  </section>
  <div
    v-if="showTabConfigModal"
    class="tab-config-overlay"
    @click.self="showTabConfigModal = false"
  >
    <div class="tab-config-card">
      <div class="tab-config-header">
        <div class="tab-config-title">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2563eb"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            ></path>
          </svg>
          <span>Tùy chỉnh danh mục danh bạ</span>
        </div>
        <button class="tab-config-close" @click="showTabConfigModal = false" title="Đóng">✕</button>
      </div>

      <div class="tab-config-body">
        <p class="tab-config-desc">
          Chọn các danh mục muốn hiển thị trên thanh tab. Nếu chọn từ 5 danh mục trở xuống, các tab
          sẽ tự động căn đều theo tỷ lệ đẹp mắt; nếu chọn trên 5 danh mục, thanh trượt sẽ được kích
          hoạt để cuộn mượt mà.
        </p>

        <div class="tab-config-list">
          <div
            v-for="tab in AVAILABLE_CATEGORY_TABS"
            :key="tab.id"
            class="tab-config-item"
            :class="{
              selected: isTabVisible(tab.id),
              disabled: tab.required,
            }"
            @click="toggleTabVisibility(tab.id)"
          >
            <div class="tab-config-item-left">
              <input
                type="checkbox"
                :checked="isTabVisible(tab.id)"
                :disabled="tab.required"
                class="tab-config-checkbox"
                @click.stop="toggleTabVisibility(tab.id)"
              />
              <span v-if="tab.id === 'all'" class="tab-config-icon">👥</span>
              <span v-else-if="tab.id === 'favorites'" class="tab-config-icon">⭐</span>
              <span v-else-if="tab.id === 'online'" class="tab-config-icon">🟢</span>
              <span v-else-if="tab.id === 'offline'" class="tab-config-icon">⚪</span>
              <svg
                v-else-if="tab.id === 'department'"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 21h18"></path>
                <path d="M5 21V7l8-4v18"></path>
                <path d="M19 21V11l-6-4"></path>
                <line x1="9" y1="9" x2="9.01"></line>
                <line x1="9" y1="13" x2="9" y2="13.01"></line>
                <line x1="9" y1="17" x2="9" y2="17.01"></line>
              </svg>
              <svg
                v-else-if="tab.id === 'group_call'"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                ></path>
              </svg>
              <span class="tab-config-item-label">{{ tab.label }}</span>
              <span v-if="tab.required" class="tab-config-item-badge">Bắt buộc</span>
            </div>
            <span v-if="getTabPreviewCount(tab.id) !== null" class="tab-config-item-count">
              {{ getTabPreviewCount(tab.id) }} mục
            </span>
          </div>
        </div>
      </div>

      <div class="tab-config-footer">
        <button class="btn-tab-config-reset" @click="resetTabVisibility">Khôi phục mặc định</button>
        <button class="btn-tab-config-done" @click="showTabConfigModal = false">
          Hoàn tất ({{ visibleTabIds.length }} mục)
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import ContactCard from './ContactCard.vue'

import { ref, computed, watch } from 'vue'
import { useContactFilters } from '@/composables/useContactFilters.js'

/** Danh bạ sở hữu tìm kiếm, bộ lọc và lựa chọn; view sở hữu lệnh gọi/API. */
const props = defineProps({
  contacts: { type: Array, required: true },
  loadingContacts: Boolean,
  isCalling: Boolean,
  isDialing: Boolean,
  myExtension: { type: String, default: '' },
  searchQuery: { type: String, default: '' },
  canInviteContact: { type: Function, required: true },
})
const emit = defineEmits(['call', 'message', 'favorite', 'refresh', 'start-group', 'clear-search'])
/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => props.contacts)
const {
  searchTerm,
  activeTab,
  selectedDepartment,
  availableDepartments,
  getDepartmentCount,
  departmentTabCount,
  filteredContacts,
} = useContactFilters({
  getContacts: () => props.contacts,
  isAvailableForCall: (contact) => props.canInviteContact(contact),
  getCurrentExtension: () => props.myExtension,
})
/** Đếm liên hệ được đánh dấu yêu thích để hiển thị số lượng trên tab. */
const favoriteCount = computed(() => {
  return contacts.value.filter((c) => c.isFavorite).length
})

/** Đếm liên hệ không ở trạng thái offline/unavailable cho nhãn thống kê trực tuyến. */
const onlineCount = computed(() => {
  return contacts.value.filter((c) => c.status !== 'offline' && c.status !== 'unavailable').length
})

/** Đếm liên hệ offline/unavailable cho tab ngoại tuyến. */
const offlineCount = computed(() => {
  return contacts.value.filter((c) => c.status === 'offline' || c.status === 'unavailable').length
})

const AVAILABLE_CATEGORY_TABS = [
  { id: 'all', label: 'Tất cả', icon: 'all', required: true },
  { id: 'favorites', label: 'Yêu thích', icon: 'favorites' },
  { id: 'online', label: 'Trực tuyến', icon: 'online' },
  { id: 'offline', label: 'Ngoại tuyến', icon: 'offline' },
  { id: 'department', label: 'Bộ phận', icon: 'department' },
  { id: 'group_call', label: 'Gọi nhóm', icon: 'group_call' },
]

const DEFAULT_VISIBLE_TAB_IDS = [
  'all',
  'favorites',
  'online',
  'offline',
  'department',
  'group_call',
]

/** Khôi phục cấu hình tab danh bạ từ trình duyệt và bảo đảm tab bắt buộc vẫn tồn tại. */
const loadSavedVisibleTabs = () => {
  try {
    const saved = localStorage.getItem('smartcall_visible_tabs')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (!parsed.includes('all')) parsed.unshift('all')
        return parsed
      }
    }
  } catch (e) {
    console.warn('Lỗi đọc visible tabs:', e)
  }
  return [...DEFAULT_VISIBLE_TAB_IDS]
}

const visibleTabIds = ref(loadSavedVisibleTabs())

const showTabConfigModal = ref(false)

/** Lấy các tab đang được bật theo thứ tự cấu hình của panel danh bạ. */
const visibleTabs = computed(() => {
  return AVAILABLE_CATEGORY_TABS.filter((t) => visibleTabIds.value.includes(t.id))
})

/** Tính số cột để các tab danh bạ được chia hàng gọn theo số tab hiện có. */
const panelTabsGridStyle = computed(() => {
  const count = visibleTabs.value.length
  if (count <= 5) {
    return {
      gridTemplateColumns: `repeat(${count || 1}, minmax(0, 1fr))`,
    }
  }
  // Khi > 5 tabs (tối đa 10): cân đối 2 hàng (ví dụ 6 tabs chia 3 + 3, 7 tabs chia 4 + 3)
  const cols = Math.ceil(count / 2)
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  }
})

/** Kiểm tra một tab danh bạ có nằm trong cấu hình hiển thị hiện tại hay không. */
const isTabVisible = (id) => visibleTabIds.value.includes(id)

/** Bật/tắt tab tùy chọn, giữ tab bắt buộc và đổi tab đang chọn nếu nó vừa bị ẩn. */
const toggleTabVisibility = (id) => {
  if (id === 'all') return
  const idx = visibleTabIds.value.indexOf(id)
  if (idx > -1) {
    if (visibleTabIds.value.length <= 2) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '⚠️ Cần giữ lại ít nhất 2 danh mục hiển thị!', type: 'warning' },
        }),
      )
      return
    }
    visibleTabIds.value.splice(idx, 1)
    if (activeTab.value === id) {
      activeTab.value = 'all'
    }
  } else {
    const newIds = AVAILABLE_CATEGORY_TABS.map((t) => t.id).filter(
      (tid) => visibleTabIds.value.includes(tid) || tid === id,
    )
    visibleTabIds.value = newIds
  }
  localStorage.setItem('smartcall_visible_tabs', JSON.stringify(visibleTabIds.value))
}

/** Khôi phục danh sách tab danh bạ mặc định rồi lưu lại cấu hình hiển thị. */
const resetTabVisibility = () => {
  visibleTabIds.value = [...DEFAULT_VISIBLE_TAB_IDS]
  localStorage.setItem('smartcall_visible_tabs', JSON.stringify(visibleTabIds.value))
}

/** Đếm liên hệ đủ điều kiện mời nhóm sau khi loại chính người dùng hiện tại. */
const groupCallOnlineCount = computed(() => {
  const myExt = String(props.myExtension || '').trim()
  return contacts.value.filter(
    (c) => props.canInviteContact(c) && String(c.number || '').trim() !== myExt,
  ).length
})

/** Trả số lượng tương ứng từng tab để hiển thị trong hộp cấu hình tab. */
const getTabPreviewCount = (id) => {
  if (id === 'all') return contacts.value.length
  if (id === 'favorites') return favoriteCount.value
  if (id === 'online') return onlineCount.value
  if (id === 'offline') return offlineCount.value
  if (id === 'department') return departmentTabCount.value
  if (id === 'group_call') return groupCallOnlineCount.value
  return null
}

const selectedGroupExtensions = ref([])

/** Kiểm tra máy lẻ của liên hệ đã được chọn vào danh sách gọi nhóm tạm hay chưa. */
const isContactSelectedForGroup = (c) => {
  const ext = String(c?.number || '').trim()
  return Boolean(ext && selectedGroupExtensions.value.includes(ext))
}

/** So sánh máy lẻ với người dùng hiện tại để chặn tự chọn/gọi chính mình. */
const isSelf = (c) => {
  const myExt = String(props.myExtension || '').trim()
  return Boolean(myExt && String(c?.number || '').trim() === myExt)
}

/** Bật/tắt lựa chọn gọi nhóm sau khi kiểm tra liên hệ có máy lẻ và đang sẵn sàng. */
const toggleGroupContactSelection = (c) => {
  if (isSelf(c)) return
  const ext = String(c?.number || '').trim()
  if (!ext) return
  if (!props.canInviteContact(c)) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Máy lẻ [${c.number || c.name}] hiện đang ${c.statusLabel || 'bận'} hoặc không khả dụng để gọi nhóm!`,
          type: 'warning',
        },
      }),
    )
    return
  }
  const idx = selectedGroupExtensions.value.indexOf(ext)
  if (idx > -1) {
    selectedGroupExtensions.value.splice(idx, 1)
  } else {
    selectedGroupExtensions.value.push(ext)
  }
}

/** Bỏ toàn bộ lựa chọn gọi nhóm trên panel, không thay đổi thành viên của một cuộc gọi đang chạy. */
const clearGroupSelection = () => {
  selectedGroupExtensions.value = []
}
// Đồng bộ state hiển thị khi dữ liệu được theo dõi thay đổi; việc tải/ghi nghiệp vụ vẫn thuộc
// service hoặc handler tương ứng.
watch(
  () => props.searchQuery,
  (value) => {
    searchTerm.value = value || ''
  },
  { immediate: true },
)
/** Xóa bộ lọc tìm kiếm trong panel và báo cho View dọn query tương ứng trên URL. */
const clearSearch = () => {
  searchTerm.value = ''
  emit('clear-search')
}
/**
 * Kiểm tra lại lựa chọn còn sẵn sàng, yêu cầu ít nhất hai người rồi phát lệnh start-group lên
 * View.
 */
const handleStartGroupCallFromContacts = () => {
  selectedGroupExtensions.value = selectedGroupExtensions.value.filter((ext) =>
    props.canInviteContact(ext),
  )
  if (selectedGroupExtensions.value.length < 2) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: 'Vui lòng chọn ít nhất 2 thành viên sẵn sàng để gọi nhóm.',
          type: 'warning',
        },
      }),
    )
    return
  }
  emit('start-group', [...selectedGroupExtensions.value])
}
</script>

<style>
.calls-view .seg-btn.active {
  background: white;
  color: #1e88e5;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.calls-view .btn-mini-control.active {
  background: #ef4444;
}
.calls-view .contacts-col {
  width: 680px;
  max-width: 720px;
  flex: 0 1 680px;
  flex-shrink: 0;
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.calls-view .control-btn.active {
  background: #f59e0b;
  border-color: #d97706;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
}
.calls-view .contacts-panel-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  height: 580px;
  max-height: 580px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.calls-view .panel-header {
  padding: 14px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.calls-view .search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 5px 12px;
  transition: border-color 0.2s;
}

.calls-view .search-box:focus-within {
  border-color: #1e88e5;
  box-shadow: 0 0 0 2px rgba(30, 136, 229, 0.15);
}

.calls-view .search-icon {
  font-size: 0.85rem;
  margin-right: 6px;
  color: #64748b;
}

.calls-view .search-input {
  border: none;
  outline: none;
  font-size: 0.85rem;
  width: 100%;
}

.calls-view .btn-clear-search {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  font-size: 0.8rem;
  padding: 0 2px;
}

.calls-view .btn-refresh {
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
  color: #1e88e5;
  transition: all 0.2s;
  flex-shrink: 0;
}

.calls-view .btn-refresh:hover:not(:disabled) {
  background: #e3f2fd;
  border-color: #1e88e5;
  transform: rotate(45deg);
}

.calls-view .spin-icon {
  display: inline-block;
  animation: calls-view-spin 1s linear infinite;
}

.calls-view .panel-tabs-bar {
  display: flex;
  align-items: center;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 6px 8px;
  gap: 6px;
  position: relative;
}

.calls-view .panel-tabs-bar.two-rows {
  align-items: stretch;
  padding: 6px 8px 6px;
}

.calls-view .panel-tabs-grid {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.calls-view .btn-tab-config {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
  align-self: center;
  transition: all 0.15s ease;
}

.calls-view .btn-tab-config:hover {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #2563eb;
}

.calls-view .panel-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  font-size: 0.8rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  border-radius: 6px;
  padding: 6px 6px;
  min-width: 0;
  width: 100%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.calls-view .panel-tab-btn .tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calls-view .panel-tab-btn:hover {
  color: #1e293b;
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.calls-view .panel-tab-btn.active {
  color: #1e88e5;
  border-color: #93c5fd;
  background: #eff6ff;
  font-weight: 700;
}

.calls-view .tab-icon {
  font-size: 0.85rem;
}

.calls-view .tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.76rem;
  font-weight: 800;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e2e8f0;
  color: #0f172a;
  min-width: 20px;
  line-height: 1.3;
}

.calls-view .panel-tab-btn.active .tab-badge {
  background: #2563eb;
  color: #ffffff;
}

.calls-view .tab-badge.badge-online {
  background: #dcfce7;
  color: #166534;
}
.calls-view .panel-tab-btn.active .tab-badge.badge-online {
  background: #16a34a;
  color: #ffffff;
}

.calls-view .tab-badge.badge-offline {
  background: #f1f5f9;
  color: #334155;
}

.calls-view .tab-badge.badge-dept,
.calls-view .tab-badge.badge-group {
  background: #eff6ff;
  color: #1d4ed8;
}
.calls-view .panel-tab-btn.active .tab-badge.badge-dept,
.calls-view .panel-tab-btn.active .tab-badge.badge-group {
  background: #2563eb;
  color: #ffffff;
}

.calls-view .tab-svg-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
.calls-view .dept-selector-bar {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.calls-view .dept-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.calls-view .dept-bar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.calls-view .dept-current-badge {
  font-size: 0.72rem;
  font-weight: 700;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 2px 8px;
  border-radius: 12px;
}

.calls-view .dept-chips-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.calls-view .dept-chips-scroll::-webkit-scrollbar {
  display: none;
}

.calls-view .dept-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 0.76rem;
  font-weight: 600;
  background: #ffffff;
  color: #64748b;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.calls-view .dept-chip-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.calls-view .dept-chip-btn.active {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #3b82f6;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.15);
}

.calls-view .dept-chip-count {
  font-size: 0.7rem;
  opacity: 0.85;
}

.calls-view .dept-empty-hint {
  font-size: 0.75rem;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
}

.calls-view .panel-list-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
}
.calls-view .panel-list-container::-webkit-scrollbar {
  width: 5px;
}
.calls-view .panel-list-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.calls-view .contacts-items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calls-view .panel-state-message {
  text-align: center;
  padding: 40px 16px;
  color: #64748b;
  font-size: 0.85rem;
}

.calls-view .spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #1e88e5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  animation: calls-view-spin 0.8s linear infinite;
  margin: 0 auto 12px auto;
}
@media (max-width: 1199px) and (min-width: 768px) {
  .calls-view .contacts-col {
    width: 520px;
    max-width: 100%;
  }

  .calls-view .contacts-panel-card {
    height: 580px;
    max-height: 580px;
  }

  .calls-view .panel-list-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
}
@media (max-width: 768px) {
  .calls-view .calls-grid-layout.mobile-show-dialer .contacts-col {
    display: none;
  }

  .calls-view .calls-grid-layout.mobile-show-contacts .contacts-col {
    display: block;
    width: 100%;
    max-width: 100%;
  }

  .calls-view .contacts-panel-card {
    height: auto;
    max-height: none;
  }
}
.calls-view .panel-tab-btn.tab-group-call {
  color: #2563eb;
  font-weight: 700;
  margin-left: 0;
}
.calls-view .panel-tab-btn.tab-group-call.active {
  background: #ffffff;
  border-bottom-color: #2563eb;
  color: #2563eb;
}

.calls-view .group-call-selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.calls-view .selection-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.calls-view .selection-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: #1e40af;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 4px 12px;
  border-radius: 20px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  height: 28px;
  box-sizing: border-box;
}

.calls-view .selection-pill strong {
  font-weight: 700;
  color: #1d4ed8;
}

.calls-view .action-buttons-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.calls-view .btn-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  height: 28px;
  box-sizing: border-box;
}

.calls-view .btn-action-pill:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.calls-view .btn-action-pill.btn-deselect-group {
  color: #e11d48;
  border-color: #fecdd3;
  background: #fff1f2;
  width: auto;
  height: 28px;
}
.calls-view .btn-action-pill.btn-deselect-group:hover {
  background: #ffe4e6;
  border-color: #fda4af;
  color: #be123c;
}
.calls-view .pill-dot.online {
  background: #22c55e;
}

.calls-view .btn-start-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
  white-space: nowrap;
  flex-shrink: 0;
}

.calls-view .btn-start-group:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(16, 185, 129, 0.4);
}

.calls-view .btn-start-group:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}
.calls-view .tab-config-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: calls-view-fadeInModal 0.2s ease-out;
}

.calls-view .tab-config-card {
  background: #ffffff;
  border-radius: 14px;
  width: 90%;
  max-width: 440px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.15),
    0 10px 10px -5px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: calls-view-scaleUpModal 0.2s ease-out;
}

.calls-view .tab-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}

.calls-view .tab-config-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.calls-view .tab-config-close {
  background: transparent;
  border: none;
  font-size: 1rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
}

.calls-view .tab-config-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.calls-view .tab-config-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.calls-view .tab-config-desc {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
  line-height: 1.45;
}

.calls-view .tab-config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calls-view .tab-config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.calls-view .tab-config-item:hover {
  border-color: #93c5fd;
  background: #f8fafc;
}

.calls-view .tab-config-item.selected {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.calls-view .tab-config-item.disabled {
  cursor: default;
  background: #f8fafc;
  opacity: 0.85;
}

.calls-view .tab-config-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.calls-view .tab-config-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #2563eb;
  cursor: pointer;
}

.calls-view .tab-config-icon {
  font-size: 1rem;
}

.calls-view .tab-config-item-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
}

.calls-view .tab-config-item-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 6px;
  background: #e2e8f0;
  color: #475569;
  border-radius: 4px;
}

.calls-view .tab-config-item-count {
  font-size: 0.76rem;
  font-weight: 600;
  color: #64748b;
  background: #ffffff;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.calls-view .tab-config-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid #f1f5f9;
  background: #f8fafc;
}

.calls-view .btn-tab-config-reset {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: all 0.15s;
}

.calls-view .btn-tab-config-reset:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.calls-view .btn-tab-config-done {
  background: #2563eb;
  color: #ffffff;
  border: none;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.calls-view .btn-tab-config-done:hover {
  background: #1d4ed8;
}
.calls-view .add-participant-item.selected {
  background: #eff6ff;
}
</style>
