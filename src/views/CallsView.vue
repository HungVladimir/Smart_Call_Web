<template>
  <div class="calls-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-titles">
        <h1>Gọi điện & Danh bạ</h1>
        <span class="sub-text"
          >Quản trị đàm thoại WebRTC và tra cứu danh bạ máy lẻ nội bộ</span
        >
      </div>
    </div>

    <!-- Segmented Control dành cho Màn hình Di động (< 768px) -->
    <div class="mobile-segmented-bar">
      <button
        class="seg-btn"
        :class="{ active: mobileTab === 'dialer' }"
        @click="mobileTab = 'dialer'"
      >
        📞 Bàn phím & Đàm thoại
      </button>
      <button
        class="seg-btn"
        :class="{ active: mobileTab === 'contacts' }"
        @click="mobileTab = 'contacts'"
      >
        👥 Danh bạ ({{ contacts.length }})
      </button>
    </div>

    <!-- Mini Call Bar ghim đầu trang di động khi đang đàm thoại mà xem tab Danh bạ -->
    <div v-if="isCalling && mobileTab === 'contacts'" class="mobile-active-call-bar">
      <div class="bar-call-info">
        <span class="mini-pulse-dot"></span>
        <span class="bar-name">{{
          callStore.activeCall?.name || callStore.activeCall?.number
        }}</span>
        <span class="bar-duration">{{ durationText }}</span>
      </div>
      <div class="bar-call-actions">
        <button
          class="btn-mini-control"
          :class="{ active: isMuted }"
          @click="toggleMute"
          title="Mute"
        >
          {{ isMuted ? '🔇' : '🎙️' }}
        </button>
        <button class="btn-mini-hangup" @click="hangupCall" title="Cúp máy">Cúp máy</button>
      </div>
    </div>

    <!-- Main Adaptive 3-Tier Grid Layout -->
    <div class="calls-grid-layout" :class="`mobile-show-${mobileTab}`">
      <!-- CỘT 1: BÀN PHÍM SỐ (DIALER) -->
      <section class="dialer-col">
        <div class="dialer-box">
          <div class="dialer-screen">
            <input
              v-model="extension"
              type="tel"
              placeholder="Nhập số máy lẻ..."
              aria-label="Nhập số máy lẻ cần gọi"
              maxlength="8"
              @keyup.enter="handleDial"
            />
          </div>

          <div class="keypad-grid">
            <button v-for="k in keys" :key="k.num" class="key-btn" @click="pressKey(k.num)">
              <span class="num">{{ k.num }}</span>
              <small v-if="k.sub">{{ k.sub }}</small>
            </button>
          </div>

          <div class="dial-actions">
            <button
              class="btn-dial"
              title="Bắt đầu gọi"
              :disabled="isCalling || isDialing"
              @click="handleDial"
            >
              <svg
                class="dial-svg-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z"
                />
              </svg>
            </button>
            <button
              class="btn-clear"
              :class="{ visible: Boolean(extension) }"
              title="Xóa một số"
              aria-label="Xóa ký tự cuối"
              :disabled="!extension"
              @click="clearDigit"
            >
              <svg
                class="clear-svg-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.5-7.5H21a1 1 0 011 1v13a1 1 0 01-1 1H9.5L3 12z"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <!-- CỘT 2: TRẠNG THÁI CUỘC GỌI (CALL STATUS - COLLAPSIBLE) -->
      <section class="status-col" :class="{ 'is-active-call': isCalling, 'is-idle': !isCalling }">
        <div
          class="call-status-box"
          :class="{
            inCall: isCalling,
            onHold: isHeld,
            isRinging: callState === 'ringing',
            compactIdle: !isCalling,
          }"
        >
          <!-- Giao diện khi Rảnh (Idle) trên màn hình Tablet / Laptop nhỏ -->
          <div v-if="!isCalling" class="idle-collapsed-bar">
            <div class="idle-sip-badge">
              <span class="sip-dot online"></span>
              <span class="sip-text">{{ callerSip }}</span>
            </div>
            <div class="idle-note">Sẵn sàng thực hiện cuộc gọi</div>
          </div>

          <!-- Giao diện Đầy đủ khi Đang Gọi hoặc trên Desktop -->
          <div class="status-full-content" :class="{ 'hide-on-tablet-idle': !isCalling }">
            <div
              class="call-avatar"
              :class="{ pulsing: isCalling, ringingPulse: callState === 'ringing' }"
            >
              <span>{{ callAvatarInitials }}</span>
            </div>

            <div class="caller-details">
              <h2>{{ callerName }}</h2>
              <p class="sip-uri">{{ callerSip }}</p>
              <p
                v-if="isCalling"
                class="duration-text"
                :class="{ ringingText: callState === 'ringing' }"
              >
                {{ durationText }}
              </p>
              <p v-if="isCalling && dtmfLog" class="dtmf-display">Phím số: {{ dtmfLog }}</p>
              <p v-else-if="!isCalling" class="idle-text">Tổng đài WebRTC SIP sẵn sàng</p>
            </div>

            <!-- Hàng 4 nút điều khiển cuộc gọi -->
            <div class="controls-row">
              <!-- Nút Tắt/Bật Micro (Mute) -->
              <button
                class="control-btn"
                :class="{ active: isMuted, muted: isMuted }"
                :disabled="!isCalling"
                :title="isMuted ? 'Bật lại Micro' : 'Tắt Micro (Mute)'"
                @click="toggleMute"
              >
                <svg
                  v-if="!isMuted"
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z"
                  />
                </svg>
                <svg
                  v-else
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17 16.95A7 7 0 015 11m12 0a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8"
                  />
                </svg>
              </button>

              <!-- Nút Giữ máy (Hold) -->
              <button
                class="control-btn"
                :class="{ active: isHeld }"
                :disabled="!isCalling"
                :title="isHeld ? 'Tiếp tục cuộc gọi' : 'Giữ cuộc gọi (Hold)'"
                @click="toggleHold"
              >
                <svg
                  v-if="!isHeld"
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <svg v-else class="ctrl-svg-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>

              <!-- Nút Loa ngoài (Speaker) -->
              <button
                class="control-btn"
                :class="{ active: isSpeaker }"
                :disabled="!isCalling"
                :title="isSpeaker ? 'Tắt loa ngoài' : 'Bật loa ngoài'"
                @click="toggleSpeaker"
              >
                <svg
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"
                  />
                </svg>
              </button>

              <!-- Nút Cúp máy (Hangup) -->
              <button
                class="control-btn btn-hangup"
                :disabled="!isCalling"
                title="Ngắt kết nối / Cúp máy"
                @click="hangupCall"
              >
                <svg class="ctrl-svg-icon hangup-svg" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.28 8.82 7.42 7 12 7s8.72 1.82 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- CỘT 3: DANH BẠ NHÂN VIÊN (CONTACTS PANEL) -->
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
              @click="refreshContacts"
            >
              <span :class="{ 'spin-icon': loadingContacts }">↻</span>
            </button>
          </div>

          <!-- Filter Tabs: Tất cả vs Yêu thích ⭐ -->
          <div class="panel-tabs-bar">
            <button
              class="panel-tab-btn"
              :class="{ active: activeTab === 'all' }"
              @click="activeTab = 'all'"
            >
              👥 Tất cả ({{ contacts.length }})
            </button>
            <button
              class="panel-tab-btn"
              :class="{ active: activeTab === 'favorites' }"
              @click="activeTab = 'favorites'"
            >
              ⭐ Yêu thích ({{ favoriteCount }})
            </button>
          </div>

          <!-- Contact List Body -->
          <div class="panel-list-container">
            <!-- Loading State -->
            <div v-if="loadingContacts && contacts.length === 0" class="panel-state-message">
              <div class="spinner"></div>
              <p>Đang nạp danh bạ từ máy chủ Wazo...</p>
            </div>

            <!-- Empty State -->
            <div v-else-if="filteredContacts.length === 0" class="panel-state-message empty">
              <p v-if="activeTab === 'favorites'">
                Chưa có liên hệ nào trong mục Yêu thích. Hãy bấm biểu tượng ⭐ trên thẻ nhân viên để
                ghim nhanh.
              </p>
              <p v-else-if="searchTerm">
                Không tìm thấy nhân viên nào phù hợp với "{{ searchTerm }}".
              </p>
              <p v-else>Chưa có liên hệ nào trong danh bạ hệ thống.</p>
            </div>

            <!-- Contacts Cards List -->
            <div v-else class="contacts-items-list">
              <div
                v-for="c in filteredContacts"
                :key="c.id"
                class="contact-item-card"
                :class="{ favorite: c.isFavorite }"
              >
                <!-- Ghim yêu thích ⭐ -->
                <button
                  class="btn-star"
                  :class="{ active: c.isFavorite }"
                  :title="c.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
                  :aria-label="c.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
                  @click.stop="toggleFavorite(c)"
                >
                  {{ c.isFavorite ? '⭐' : '☆' }}
                </button>

                <!-- Avatar tròn chữ cái -->
                <div class="avatar-wrap">
                  <div class="contact-avatar" :style="{ backgroundColor: getAvatarColor(c.name) }">
                    {{ getInitials(c.name) }}
                  </div>
                </div>

                <!-- Thông tin nhân viên (Chấm màu đặt ngay trước Tên nhân viên) -->
                <div class="contact-meta">
                  <div class="meta-row-top">
                    <div class="name-status-group">
                      <span
                        class="status-dot-inline"
                        :class="`dot-${c.status || 'offline'}`"
                        :title="`${c.name}: ${c.statusLabel || 'Ngoại tuyến'}`"
                      ></span>
                      <strong class="contact-name" :title="c.name">{{ c.name }}</strong>
                    </div>
                  </div>
                  <div class="meta-row-sub">
                    <span class="ext-badge">Máy lẻ {{ c.number || '---' }}</span>
                    <span v-if="c.dept" class="dept-text" :title="c.dept">• {{ c.dept }}</span>
                  </div>
                </div>

                <!-- Nút thao tác nhanh: Gọi thoại & Nhắn tin -->
                <div class="contact-actions">
                  <button
                    class="btn-action-icon call"
                    :title="!c.number || !c.number.trim() ? 'Chưa có số máy lẻ' : (isCalling || isDialing ? 'Đang bận cuộc gọi' : `Gọi máy lẻ ${c.number}`)"
                    :aria-label="`Gọi cho ${c.name}`"
                    :disabled="isCalling || isDialing || !c.number || !c.number.trim()"
                    @click.stop="handleCallFromPanel(c)"
                  >
                    <svg
                      class="action-svg"
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
                      />
                    </svg>
                  </button>
                  <button
                    class="btn-action-icon chat"
                    :title="`Nhắn tin với ${c.name}`"
                    :aria-label="`Nhắn tin cho ${c.name}`"
                    @click.stop="handleMessage(c)"
                  >
                    <svg
                      class="action-svg"
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
                        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                      />
                    </svg>
                    <span v-if="c.unreadCount > 0" class="badge-unread">{{ c.unreadCount }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { wazoService, callStore } from '@/services/wazo'
import { audioService } from '@/services/audioService'
import { contactService } from '@/services/contactService'
import { logger } from '@/services/loggerService'

const route = useRoute()
const router = useRouter()

// Dialer & Call State
const extension = ref('')
const dtmfLog = ref('')
const mobileTab = ref('dialer') // 'dialer' | 'contacts'

// Contacts Panel State
const searchTerm = ref('')
const contacts = ref([])
const loadingContacts = ref(false)
const activeTab = ref('all') // 'all' | 'favorites'

// Single Source of Truth (SSOT) binding trực tiếp từ callStore
const isCalling = computed(() => Boolean(callStore.activeCall))
const callState = computed(() => (callStore.activeCall ? callStore.activeCall.status : 'idle'))
const isHeld = computed(() => Boolean(callStore.activeCall?.isHeld))
const isMuted = computed(() => Boolean(callStore.activeCall?.isMuted))
const isSpeaker = computed(() => Boolean(callStore.activeCall?.isSpeaker))
const isDialing = computed(() => Boolean(wazoService._isDialing))

const keys = [
  { num: '1', sub: '' },
  { num: '2', sub: 'ABC' },
  { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' },
  { num: '5', sub: 'JKL' },
  { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' },
  { num: '8', sub: 'TUV' },
  { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' },
  { num: '0', sub: '+' },
  { num: '#', sub: '' },
]

const callerName = computed(() => {
  if (!callStore.activeCall) return 'Sẵn sàng kết nối cuộc gọi'
  const ext = callStore.activeCall.number || extension.value
  if (callStore.activeCall.status === 'ringing') {
    return `Đang đổ chuông tới máy lẻ ${ext}...`
  }
  if (callStore.activeCall.isHeld) {
    return `Máy lẻ ${ext} (Tạm giữ - Hold)`
  }
  return `Đang đàm thoại: ${callStore.activeCall.name || `Máy lẻ ${ext}`}`
})

const callerSip = computed(() => {
  const host = (wazoService.host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
  if (callStore.activeCall) return `sip:${callStore.activeCall.number}@${host || 'smartcall'}`
  const myExt = callStore.myExtension || wazoService.getMyExtension() || '1001'
  return `WebRTC SIP Line ${myExt}`
})

const callAvatarInitials = computed(() => {
  if (callStore.activeCall?.number) return callStore.activeCall.number.slice(-2)
  if (extension.value) return extension.value.slice(-2)
  return '📞'
})

const formattedDuration = computed(() => {
  const s = callStore.activeCall?.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
})

const durationText = computed(() => {
  if (!callStore.activeCall) return '00:00'
  if (callStore.activeCall.status === 'ringing') return '📞 Đang đổ chuông...'
  return formattedDuration.value
})

const favoriteCount = computed(() => {
  return contacts.value.filter((c) => c.isFavorite).length
})

// Chuẩn hóa xóa dấu Tiếng Việt phục vụ tìm kiếm chính xác
const removeVietnameseTones = (str) => {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

// Danh sách danh bạ được lọc
const filteredContacts = computed(() => {
  let list = contacts.value
  if (activeTab.value === 'favorites') {
    list = list.filter((c) => c.isFavorite)
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

const pressKey = (key) => {
  audioService.playDtmfTone(key)
  if (!callStore.activeCall) {
    if (extension.value.length < 8) {
      extension.value += key
      logger.info('UI', `Bấm phím [${key}] trên bàn phím số (Số hiện tại: ${extension.value})`)
    }
  } else {
    dtmfLog.value += key
    wazoService.sendDTMF(key)
    logger.info(
      'CALL',
      `Phát tín hiệu DTMF [${key}] trong cuộc gọi tới máy lẻ: ${callStore.activeCall.number}`,
    )
  }
}

const clearDigit = () => {
  if (!callStore.activeCall) {
    extension.value = extension.value.slice(0, -1)
  }
}

// Xóa từ khóa tìm kiếm và dọn sạch query URL q
const clearSearch = () => {
  searchTerm.value = ''
  if (route.query && route.query.q) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.q
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

// Bấm gọi từ bàn phím số (Handle Dialpad)
const handleDial = async () => {
  const ext = extension.value.trim()
  if (!ext) return

  if (wazoService.hasActiveCall() || callStore.activeCall) {
    cleanCallQueryParams()
    return
  }

  // Kiểm tra trạng thái máy lẻ nếu đã có trong danh bạ (Rule 3.1 & 3.3 GEMINI.md)
  const target =
    contacts.value.find((c) => c.number === ext) ||
    contactService.currentContacts?.find((c) => c.number === ext)
  if (target) {
    if (target.status === 'busy' || target.status === 'talking' || target.status === 'holding') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🚫 [${target.name || ext}] hiện đang trong cuộc gọi khác (Máy bận)!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'ringing') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🔔 [${target.name || ext}] hiện đang nhận một cuộc gọi khác!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'dnd') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🔕 [${target.name || ext}] đang bật chế độ Không làm phiền (DND)!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'offline' || target.status === 'unavailable') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '📴 Người này hiện đang ngoại tuyến, xin vui lòng gọi lại lúc khác!',
            type: 'warning',
          },
        }),
      )
      return
    }
  }

  try {
    const res = await wazoService.validateAndMakeCall(ext, {
      name: target?.name || route.query?.name,
      dept: target?.dept || route.query?.dept,
    })
    if (res && !res.success) {
      cleanCallQueryParams()
    }
  } catch (err) {
    cleanCallQueryParams()
  }
}

// Bấm nút Gọi thoại trực tiếp từ Danh bạ (Rule 3.1 & 3.2 GEMINI.md)
const handleCallFromPanel = async (contact) => {
  if (!contact || !contact.number) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Liên hệ [${contact?.name || 'này'}] chưa có số máy lẻ để thực hiện cuộc gọi!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  if (wazoService._isDialing || wazoService.hasActiveCall() || callStore.activeCall) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message:
            '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động hoặc đang kết nối. Vui lòng thử lại sau!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // 1. Máy bận
  if (contact.status === 'busy' || contact.status === 'talking' || contact.status === 'holding') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🚫 [${contact.name}] hiện đang trong cuộc gọi khác (Máy bận). Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 2. Đang đổ chuông
  if (contact.status === 'ringing') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔔 [${contact.name}] hiện đang nhận một cuộc gọi khác. Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 3. Không làm phiền (DND)
  if (contact.status === 'dnd') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔕 [${contact.name}] đang bật chế độ Không làm phiền (DND). Vui lòng liên hệ sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 4. Ngoại tuyến -> Hộp thoại chuyển sang nhắn tin (Rule 3.2 GEMINI.md)
  if (contact.status === 'offline' || contact.status === 'unavailable') {
    const confirmMsg = confirm(
      `Máy lẻ [${contact.name} - ${contact.number}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMsg) {
      handleMessage(contact)
    }
    return
  }

  // 5. Khả dụng -> Thiết lập số, chuyển tab di động sang dialer và gọi trực tiếp
  const cleanExt = String(contact.number || '').trim()
  extension.value = cleanExt
  mobileTab.value = 'dialer'
  await wazoService.validateAndMakeCall(cleanExt, {
    name: contact.name,
    dept: contact.dept,
  })
}

// Chuyển sang màn hình Tin nhắn
const handleMessage = (contact) => {
  contact.unreadCount = 0
  const ext = contact.number || (contact.email ? contact.email.split('@')[0] : contact.id)
  router.push({
    path: '/messages',
    query: {
      ext,
      name: contact.name,
    },
  })
}

// Bật/tắt trạng thái Yêu thích
const toggleFavorite = (contact) => {
  contact.isFavorite = contactService.toggleFavorite(contact.id)
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: contact.isFavorite
          ? `Đã thêm [${contact.name}] vào mục Yêu thích ⭐`
          : `Đã bỏ [${contact.name}] khỏi mục Yêu thích`,
        type: 'info',
      },
    }),
  )
}

// Nạp danh bạ từ máy chủ Wazo
const loadContacts = async (silent = false) => {
  if (!silent && contacts.value.length === 0) {
    loadingContacts.value = true
  }
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
  } catch (err) {
    console.warn('Lỗi nạp danh bạ Wazo:', err)
  } finally {
    loadingContacts.value = false
  }
}

// Làm mới danh bạ thủ công
const refreshContacts = async () => {
  loadingContacts.value = true
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `✅ Đã làm mới danh bạ (${fresh.length} liên hệ)!`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    console.warn('Lỗi làm mới danh bạ:', err)
  } finally {
    loadingContacts.value = false
  }
}

// Dọn dẹp query sau khi cuộc gọi kết thúc (bảo toàn tham số tìm kiếm q)
const cleanCallQueryParams = () => {
  dtmfLog.value = ''
  if (
    route.query &&
    (route.query.number || route.query.autocall || route.query.active || route.query.direction)
  ) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.number
    delete remainingQuery.autocall
    delete remainingQuery.active
    delete remainingQuery.direction
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

const onCallEnded = () => {
  cleanCallQueryParams()
}

const hangupCall = () => {
  wazoService.hangup()
  cleanCallQueryParams()
}

const toggleMute = () => {
  wazoService.toggleMute()
}

const toggleHold = () => {
  wazoService.toggleHold()
}

const toggleSpeaker = () => {
  wazoService.toggleSpeaker()
}

// Helper Avatar
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(-2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 65%, 48%)`
}

const onContactsUpdated = () => {
  if (contactService.currentContacts) {
    contacts.value = [...contactService.currentContacts]
  }
}

// Lắng nghe thay đổi query URL từ thanh tìm kiếm Header
watch(
  () => route.query.q,
  (newQ) => {
    if (newQ !== undefined && newQ !== null) {
      searchTerm.value = String(newQ)
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        mobileTab.value = 'contacts'
      }
    }
  },
  { immediate: true },
)

// Lắng nghe gọi tự động khi click số từ giao diện khác
watch(
  () => route.query.number,
  (newNum) => {
    if (newNum) {
      extension.value = String(newNum)
      if (route.query.autocall === 'true') {
        if (!callStore.activeCall && !wazoService.hasActiveCall()) {
          setTimeout(() => {
            handleDial()
          }, 150)
        } else {
          cleanCallQueryParams()
        }
      }
    }
  },
  { immediate: true },
)

onMounted(async () => {
  window.addEventListener('smartcall-call-ended', onCallEnded)
  window.addEventListener('smartcall-contacts-updated', onContactsUpdated)

  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }

  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    contacts.value = [...contactService.currentContacts]
    loadContacts(true)
  } else {
    loadContacts(false)
  }
})

// Hỗ trợ KeepAlive mượt mà không delay khi chuyển tab
onActivated(() => {
  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }
  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    contacts.value = [...contactService.currentContacts]
  }
})

onUnmounted(() => {
  window.removeEventListener('smartcall-call-ended', onCallEnded)
  window.removeEventListener('smartcall-contacts-updated', onContactsUpdated)
  dtmfLog.value = ''
})
</script>

<style scoped>
.calls-view {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 4px;
}

.view-header {
  margin-bottom: 20px;
}

.header-titles h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 4px 0;
  font-weight: 700;
}

.sub-text {
  color: #64748b;
  font-size: 0.88rem;
}

/* Segmented Control cho Mobile */
.mobile-segmented-bar {
  display: none;
  background: #e2e8f0;
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 16px;
  gap: 4px;
}

.seg-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 0.88rem;
  font-weight: 600;
  color: #475569;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.seg-btn.active {
  background: white;
  color: #1e88e5;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

/* Mini Active Call Bar khi xem Tab Danh bạ trên Mobile */
.mobile-active-call-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0f172a;
  color: white;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 1px solid #334155;
}

.bar-call-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}

.mini-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  animation: pulse-ring 1.5s infinite;
}

.bar-duration {
  font-family: monospace;
  color: #34d399;
  font-weight: 700;
}

.bar-call-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-mini-control {
  background: #334155;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-mini-control.active {
  background: #ef4444;
}

.btn-mini-hangup {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

/* =========================================================================
   ADAPTIVE 3-TIER GRID SYSTEM
   ========================================================================= */

/* 1. Màn hình Desktop rộng (>= 1200px): 3 Cột Cân Đối (Bàn phím 300px, Đàm thoại 420px, Danh bạ 1fr mở rộng) */
.calls-grid-layout {
  display: grid;
  grid-template-columns: 300px 420px 1fr;
  grid-template-areas: 'dialer status contacts';
  gap: 20px;
  align-items: start;
}

.dialer-col {
  grid-area: dialer;
}

.status-col {
  grid-area: status;
}

.contacts-col {
  grid-area: contacts;
}

/* --- Dialer Box --- */
.dialer-box {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.dialer-screen input {
  width: 100%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: #1e293b;
  text-align: center;
  outline: none;
  margin-bottom: 16px;
  transition: all 0.2s;
}

.dialer-screen input:focus {
  border-color: #3b82f6;
  background: white;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.key-btn {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  width: 58px;
  height: 58px;
  margin: 0 auto;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.key-btn:hover {
  background: #e2e8f0;
  transform: scale(1.05);
}

.key-btn small {
  font-size: 0.52rem;
  color: #64748b;
  font-weight: normal;
  margin-top: -3px;
}

.dial-actions {
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: center;
  margin-top: 6px;
}

.btn-dial {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
  transition: all 0.2s;
}

.btn-dial:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: scale(1.06);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
}

.btn-dial:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.dial-svg-icon {
  width: 22px;
  height: 22px;
  fill: #ffffff;
  flex-shrink: 0;
}

.btn-clear {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  border: 1.5px solid #cbd5e1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0.35;
}

.btn-clear.visible {
  opacity: 1;
}

.btn-clear:hover:not(:disabled) {
  background: #fee2e2;
  color: #ef4444;
  border-color: #fca5a5;
  transform: scale(1.06);
}

.btn-clear:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.clear-svg-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

/* --- Call Status Box --- */
.call-status-box {
  background: linear-gradient(145deg, #1e293b, #0f172a);
  color: white;
  border-radius: 14px;
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 440px;
  border: 1px solid #334155;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.call-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  border: 3px solid #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin: 0 auto 16px auto;
  background: linear-gradient(135deg, #1e3a8a, #2563eb);
  color: white;
  font-weight: 700;
  position: relative;
  transition: all 0.3s;
}

.call-avatar.pulsing {
  border-color: #10b981;
  box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.25);
  animation: pulse-ring 2s infinite;
}

.call-avatar.ringingPulse {
  border-color: #f59e0b;
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.25);
  animation: pulse-ring-amber 1.5s infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

@keyframes pulse-ring-amber {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(245, 158, 11, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
}

.caller-details h2,
.caller-details h3 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 6px 0;
  color: #f8fafc;
}

.sip-uri {
  font-size: 0.82rem;
  color: #94a3b8;
  font-family: monospace;
  margin: 0 0 10px 0;
}

.duration-text {
  font-size: 1.45rem;
  color: #34d399;
  font-weight: 700;
  font-family: monospace;
  margin: 8px 0 20px 0;
  letter-spacing: 1px;
}

.duration-text.ringingText {
  color: #fbbf24;
  font-size: 1.05rem;
  letter-spacing: 0.5px;
  animation: pulse-ring-amber 1.5s infinite;
}

.idle-text {
  font-size: 0.88rem;
  color: #64748b;
  margin: 8px 0 20px 0;
}

.controls-row {
  display: flex;
  gap: 14px;
  justify-content: center;
  margin-top: 6px;
}

.control-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.ctrl-svg-icon {
  width: 22px;
  height: 22px;
  stroke: #ffffff;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.control-btn.active {
  background: #f59e0b;
  border-color: #d97706;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
}

.control-btn.muted {
  background: #ef4444;
  border-color: #dc2626;
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.45);
}

.control-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.control-btn.btn-hangup {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-color: #b91c1c;
  width: 54px;
  height: 54px;
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.45);
}

.control-btn.btn-hangup:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: scale(1.06);
}

.hangup-svg {
  fill: #ffffff;
  width: 24px;
  height: 24px;
}

/* Idle collapsed bar chỉ hiển thị trong chế độ thu gọn tablet */
.idle-collapsed-bar {
  display: none;
}

/* --- Cột 3: Danh bạ Nhân viên (Contacts Panel) --- */
.contacts-panel-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 240px;
}

.panel-header {
  padding: 14px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 5px 12px;
  transition: border-color 0.2s;
}

.search-box:focus-within {
  border-color: #1e88e5;
  box-shadow: 0 0 0 2px rgba(30, 136, 229, 0.15);
}

.search-icon {
  font-size: 0.85rem;
  margin-right: 6px;
  color: #64748b;
}

.search-input {
  border: none;
  outline: none;
  font-size: 0.85rem;
  width: 100%;
}

.btn-clear-search {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  font-size: 0.8rem;
  padding: 0 2px;
}

.btn-refresh {
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

.btn-refresh:hover:not(:disabled) {
  background: #e3f2fd;
  border-color: #1e88e5;
  transform: rotate(45deg);
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.panel-tabs-bar {
  display: flex;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 10px;
  gap: 6px;
}

.panel-tab-btn {
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 0.82rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.panel-tab-btn:hover {
  color: #1e293b;
}

.panel-tab-btn.active {
  color: #1e88e5;
  border-bottom-color: #1e88e5;
  background: white;
}

.panel-list-container {
  flex: 1;
  max-height: 480px;
  overflow-y: auto;
  padding: 8px 10px;
}

/* Custom Scrollbar */
.panel-list-container::-webkit-scrollbar {
  width: 5px;
}
.panel-list-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.contacts-items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.contact-item-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px 14px;
  gap: 12px;
  transition: all 0.15s ease;
}

.contact-item-card:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.btn-star {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #cbd5e1;
  transition:
    transform 0.15s,
    color 0.15s;
  padding: 4px;
  min-width: 32px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.btn-star:hover {
  transform: scale(1.2);
  color: #f59e0b;
}

.btn-star.active {
  color: #f59e0b;
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.contact-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.contact-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.name-status-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-dot-inline {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.status-dot-inline.dot-online {
  background: #22c55e;
}
.status-dot-inline.dot-busy {
  background: #ef4444;
}
.status-dot-inline.dot-ringing {
  background: #3b82f6;
  animation: pulse-ring 1s infinite;
}
.status-dot-inline.dot-dnd {
  background: #f97316;
}
.status-dot-inline.dot-away {
  background: #eab308;
}
.status-dot-inline.dot-offline {
  background: #94a3b8;
}

.contact-name {
  font-size: 0.92rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-row-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  color: #64748b;
}

.ext-badge {
  background: #e0f2fe;
  color: #0284c7;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.dept-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 6px;
}

.btn-action-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.92rem;
  transition: all 0.15s;
  position: relative;
}

.btn-action-icon .action-svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  transition: transform 0.15s ease, color 0.15s ease;
}

.btn-action-icon:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.btn-action-icon:hover:not(:disabled) .action-svg {
  transform: scale(1.12);
}

.btn-action-icon.call {
  color: #10b981;
}

.btn-action-icon.call:hover:not(:disabled) {
  background: #ecfdf5;
  border-color: #10b981;
  color: #059669;
}

.btn-action-icon.chat {
  color: #3b82f6;
}

.btn-action-icon.chat:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #2563eb;
}

.btn-action-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn-action-icon:disabled * {
  pointer-events: none;
}

.badge-unread {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #ef4444;
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 10px;
}

.panel-state-message {
  text-align: center;
  padding: 40px 16px;
  color: #64748b;
  font-size: 0.85rem;
}

.spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #1e88e5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px auto;
}

/* =========================================================================
   2. MÀN HÌNH TRUNG BÌNH (Tablet / Laptop nhỏ 768px - 1199px): 2 Cột Tích Hợp
   ========================================================================= */
@media (max-width: 1199px) and (min-width: 768px) {
  .calls-grid-layout {
    grid-template-columns: 330px 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'status contacts'
      'dialer contacts';
    gap: 16px 20px;
  }

  /* Khung trạng thái thu gọn khi Idle (~70px) */
  .status-col.is-idle .call-status-box {
    min-height: 64px;
    padding: 12px 16px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .status-col.is-idle .hide-on-tablet-idle {
    display: none;
  }

  .status-col.is-idle .idle-collapsed-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .idle-sip-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    font-family: monospace;
    color: #cbd5e1;
  }

  .idle-sip-badge .sip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
  }

  .idle-note {
    font-size: 0.78rem;
    color: #94a3b8;
  }

  /* Khi Active: mở rộng đầy đủ */
  .status-col.is-active-call .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .status-col.is-active-call .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.5rem;
    margin-bottom: 10px;
  }

  .status-col.is-active-call .duration-text {
    margin: 6px 0 12px 0;
  }

  .contacts-panel-card {
    min-height: 600px;
  }

  .panel-list-container {
    max-height: 520px;
  }
}

/* =========================================================================
   3. MÀN HÌNH DI ĐỘNG (< 768px): Thanh chuyển đổi phân đoạn Segmented
   ========================================================================= */
@media (max-width: 768px) {
  .mobile-segmented-bar {
    display: flex;
  }

  .calls-grid-layout {
    display: block;
  }

  .calls-grid-layout.mobile-show-dialer .contacts-col {
    display: none;
  }

  .calls-grid-layout.mobile-show-dialer .dialer-col,
  .calls-grid-layout.mobile-show-dialer .status-col {
    display: block;
    margin-bottom: 16px;
  }

  .calls-grid-layout.mobile-show-contacts .dialer-col,
  .calls-grid-layout.mobile-show-contacts .status-col {
    display: none;
  }

  .calls-grid-layout.mobile-show-contacts .contacts-col {
    display: block;
  }

  .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.6rem;
  }

  .dialer-box {
    padding: 16px;
  }

  .key-btn {
    width: 52px;
    height: 52px;
    font-size: 1.15rem;
  }
}
</style>
