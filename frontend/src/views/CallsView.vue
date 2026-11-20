<template>
  <div class="calls-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-titles">
        <h1>Gọi điện & Danh bạ</h1>
        <span class="sub-text">Quản trị đàm thoại WebRTC và tra cứu danh bạ máy lẻ nội bộ</span>
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
          callState.activeCall?.name || callState.activeCall?.number
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
    <div
      class="calls-grid-layout"
      :class="[`mobile-show-${mobileTab}`, { 'is-active-call': isCalling, 'is-idle': !isCalling }]"
    >
      <!-- CỘT 1: BÀN PHÍM SỐ (DIALER) -->
      <DialerPanel
        v-model="extension"
        :contact="matchedDialContact"
        :is-calling="isCalling"
        :is-dialing="isDialing"
        @digit="pressKey"
        @dial="handleDial"
        @erase="clearDigit"
      />

      <!-- CỘT 2: TRẠNG THÁI CUỘC GỌI (CALL STATUS - CENTER EXPANDING ACCORDION) -->
      <ActiveCallPanel
        :call="callState.activeCall"
        :group="groupCallService.state"
        :contacts="contacts"
        :recording="recordingState"
        :my-extension="userSessionState.extension"
        :duration-text="durationText"
        :dtmf-log="dtmfLog"
        @mute="toggleMute"
        @record="toggleRecord"
        @hangup="hangupCall"
        @add-participant="openAddParticipantModal"
      />

      <!-- CỘT 3: DANH BẠ NHÂN VIÊN (CONTACTS PANEL) -->
      <ContactsPanel
        :contacts="contacts"
        :loading-contacts="loadingContacts"
        :is-calling="isCalling"
        :is-dialing="isDialing"
        :my-extension="userSessionState.extension"
        :search-query="searchTerm"
        :can-invite-contact="canInviteContact"
        @call="handleCallFromPanel"
        @message="handleMessage"
        @favorite="toggleFavorite"
        @refresh="refreshContacts"
        @start-group="handleStartGroupCallFromContacts"
        @clear-search="clearSearch"
      />
    </div>

    <!-- Modal Tùy chỉnh danh mục hiển thị (Category Tabs Config Modal) -->

    <!-- Modal Thêm thành viên vào cuộc gọi đang diễn ra -->
    <AddParticipantModal
      :is-open="showAddParticipantModal"
      :contacts="contacts"
      :call="callState.activeCall"
      :group="groupCallService.state"
      :my-extension="userSessionState.extension"
      :can-invite-contact="canInviteContact"
      @close="closeAddParticipantModal"
      @confirm="confirmAddParticipants"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  callService,
  groupCallService,
  contactService,
  recordingService,
} from '@/services/index.js'
import { callState } from '@/state/callState.js'
import { userSessionState } from '@/state/sessionState.js'
import { recordingState } from '@/state/callState.js'
import { callToneService } from '@/services/audio/audioService.js'
import { logger } from '@/services/common/loggerService.js'
import DialerPanel from '@/components/call/DialerPanel.vue'
import ActiveCallPanel from '@/components/call/ActiveCallPanel.vue'
import ContactsPanel from '@/components/contacts/ContactsPanel.vue'
import AddParticipantModal from '@/components/call/AddParticipantModal.vue'

// View chỉ nối router/state với service và chuyển dữ liệu cho các cụm giao diện.
const searchTerm = ref('')
/**
 * Truyền điều kiện khả dụng của ContactService xuống component dưới dạng hàm, không để UI tự đọc
 * API.
 */
const canInviteContact = (contact) => contactService.isContactAvailableForCall(contact)
/** Mở modal lựa chọn người; việc mời thật chỉ bắt đầu sau khi người dùng xác nhận. */
const openAddParticipantModal = () => {
  showAddParticipantModal.value = true
}
/** Đóng modal mời người; lựa chọn tạm thuộc component và được reset theo vòng đời mở/đóng. */
const closeAddParticipantModal = () => {
  showAddParticipantModal.value = false
}
/** Nhận máy lẻ đã chọn; host/cuộc gọi một-một mời trực tiếp, thành viên gửi ủy quyền đến host. */
const confirmAddParticipants = async (extensions) => {
  closeAddParticipantModal()
  if (groupCallService.state.isGroupHost || !groupCallService.state.isGroupCall)
    await groupCallService.addParticipantsToGroupCall(extensions)
  else
    groupCallService.delegateAddParticipantsToHost(
      groupCallService.state.groupHostExtension ||
        callState.activeCall?.groupHostExtension ||
        callState.activeCall?.number,
      extensions,
    )
}

const route = useRoute()

const router = useRouter()

const extension = ref('')

const dtmfLog = ref('')

const mobileTab = ref('dialer')

/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => contactService.currentContacts)

const loadingContacts = ref(false)

/** Cho biết có cuộc gọi đang được quản lý để bật/tắt vùng đàm thoại và chặn thao tác gọi chồng. */
const isCalling = computed(() => Boolean(callState.activeCall))

/**
 * Lấy trạng thái hiện tại của cuộc gọi; dùng idle khi chưa có cuộc gọi để giao diện hiển thị đúng
 * nhánh.
 */
const callStatus = computed(() => (callState.activeCall ? callState.activeCall.status : 'idle'))

/** Đọc trạng thái tắt microphone của cuộc gọi để đồng bộ biểu tượng và nút điều khiển. */
const isMuted = computed(() => Boolean(callState.activeCall?.isMuted))

/** Cho biết lệnh quay số còn đang xử lý để giao diện khóa thao tác gọi lặp. */
const isDialing = computed(() => Boolean(callService.isDialing))

/** Cho biết ghi âm trên tổng đài đang hoạt động; không đồng nghĩa đang phát lại một file audio. */
const isRecording = computed(() => recordingState.isRecording)

/** Tìm liên hệ khớp số đang nhập để bàn phím hiển thị tên/avatar mà không tạo cuộc gọi. */
const matchedDialContact = computed(() => {
  const ext = extension.value.trim()
  if (!ext) return null
  return (
    contacts.value.find((c) => String(c.number || '').trim() === ext) ||
    contactService.findContactByExtension(ext) ||
    null
  )
})

/** Định dạng số giây đàm thoại thành phút:giây để hiển thị trên khung gọi và thanh gọi nhỏ. */
const formattedDuration = computed(() => {
  const s = callState.activeCall?.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
})

/** Chọn nhãn thời gian phù hợp: chưa gọi, đang kết nối/đổ chuông hoặc thời lượng đàm thoại. */
const durationText = computed(() => {
  if (!callState.activeCall) return '00:00'
  if (callState.activeCall.status === 'answering') return 'Đang kết nối...'
  if (callState.activeCall.status === 'ringing') return '📞 Đang đổ chuông...'
  return formattedDuration.value
})

/** Kiểm tra lại số người, trạng thái khả dụng và cuộc gọi đang chạy rồi gọi GroupCallService. */
const handleStartGroupCallFromContacts = async (extensions) => {
  let selectedGroupExtensions = [...extensions]
  if (selectedGroupExtensions.length < 2) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: '⚠️ Vui lòng chọn ít nhất 2 thành viên để bắt đầu cuộc gọi nhóm!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // Kiểm tra thời gian thực trạng thái khả dụng của từng thành viên trước khi gọi
  const unavailableList = selectedGroupExtensions.filter(
    (ext) => !contactService.isContactAvailableForCall(ext),
  )
  if (unavailableList.length > 0) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Máy lẻ [${unavailableList.join(', ')}] hiện đang bận hoặc không khả dụng. Đã tự động bỏ chọn!`,
          type: 'warning',
        },
      }),
    )
    selectedGroupExtensions = selectedGroupExtensions.filter((e) => !unavailableList.includes(e))
    if (selectedGroupExtensions.length < 2) return
  }

  if (isCalling.value || isDialing.value) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message:
            '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động. Vui lòng kết thúc trước khi gọi nhóm!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // Chuyển sang màn hình dialer trên mobile
  mobileTab.value = 'dialer'

  const extsToCall = [...selectedGroupExtensions]
  logger.info(
    'CALL',
    `Khởi tạo cuộc gọi nhóm từ Danh bạ tới ${extsToCall.length} người: ${extsToCall.join(', ')}`,
  )

  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: `👥 Đang khởi tạo cuộc gọi nhóm (${extsToCall.length + 1} người)...`,
        type: 'info',
      },
    }),
  )

  await groupCallService.startGroupCall(extsToCall, {
    groupTitle: `Cuộc gọi nhóm (${extsToCall.length + 1} người)`,
  })
}

/** Phát âm phím; khi chưa gọi thì nhập số, khi đang gọi thì gửi DTMF cho nhánh hiện tại. */
const pressKey = (key) => {
  callToneService.playDtmfTone(key)
  if (!callState.activeCall) {
    if (extension.value.length < 8) {
      extension.value += key
      logger.info('UI', `Bấm phím [${key}] trên bàn phím số (Số hiện tại: ${extension.value})`)
    }
  } else {
    dtmfLog.value += key
    callService.sendDtmfDigits(key)
    logger.info(
      'CALL',
      `Phát tín hiệu DTMF [${key}] trong cuộc gọi tới máy lẻ: ${callState.activeCall.number}`,
    )
  }
}

/** Xóa ký tự cuối của số đang nhập; không thay đổi số của cuộc gọi đã hoạt động. */
const clearDigit = () => {
  if (!callState.activeCall) {
    extension.value = extension.value.slice(0, -1)
  }
}

/** Xóa từ khóa trên UI và query q của router để trạng thái tìm kiếm không tự quay lại. */
const clearSearch = () => {
  searchTerm.value = ''
  if (route.query && route.query.q) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.q
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

/** Gửi số đã chuẩn hóa tới CallService.startCall rồi dọn ô nhập/query điều hướng. */
const handleDial = async () => {
  const targetExtension = extension.value.trim()
  if (!targetExtension) return
  await callService.startCall(targetExtension)
  extension.value = ''
  cleanCallQueryParams()
}

/**
 * Nhận liên hệ từ panel; người offline được gợi ý chuyển chat, người có thể gọi đi qua cùng
 * startCall.
 */
const handleCallFromPanel = async (contact) => {
  if (!contact?.number) return
  if (['offline', 'unavailable'].includes(contact.status)) {
    if (
      confirm(
        'Máy lẻ ' + contact.number + ' đang ngoại tuyến. Bạn muốn chuyển sang nhắn tin không?',
      )
    )
      handleMessage(contact)
    return
  }
  mobileTab.value = 'dialer'
  extension.value = ''
  await callService.startCall(contact.number, { name: contact.name, dept: contact.dept })
}

/** Mở MessagesView với định danh liên hệ để service tìm/tạo phòng một-một đúng người. */
const handleMessage = (contact) => {
  const ext = contact.number || (contact.email ? contact.email.split('@')[0] : contact.id)
  router.push({
    path: '/messages',
    query: {
      ext,
      name: contact.name,
      uuid: contact.uuid || '',
    },
  })
}

/** Gọi service bật/tắt yêu thích và chỉ hiện thông báo theo kết quả được server xác nhận. */
const toggleFavorite = async (contact) => {
  try {
    const enabled = await contactService.toggleFavorite(contact)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          type: 'success',
          message: enabled ? 'Đã thêm liên hệ vào yêu thích.' : 'Đã bỏ liên hệ khỏi yêu thích.',
        },
      }),
    )
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { type: 'error', message: error.message } }),
    )
  }
}

/** Tải danh bạ qua ContactService; chế độ silent giữ UI ổn định khi làm mới nền. */
const loadContacts = async (silent = false) => {
  if (!silent && contacts.value.length === 0) {
    loadingContacts.value = true
  }
  try {
    await contactService.getContacts()
  } catch (err) {
    console.warn('Lỗi nạp danh bạ tổng đài:', err)
  } finally {
    loadingContacts.value = false
  }
}

/** Làm mới danh bạ theo thao tác người dùng, sử dụng cùng luồng loadContacts. */
const refreshContacts = async () => {
  loadingContacts.value = true
  try {
    const fresh = await contactService.getContacts()
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

/** Dọn các query điều khiển gọi đã tiêu thụ để điều hướng/reload không vô tình gọi lại. */
const cleanCallQueryParams = () => {
  dtmfLog.value = ''
  if (
    route.query &&
    (route.query.number ||
      route.query.autocall ||
      route.query.active ||
      route.query.direction ||
      route.query.name ||
      route.query.dept)
  ) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.number
    delete remainingQuery.autocall
    delete remainingQuery.active
    delete remainingQuery.direction
    delete remainingQuery.name
    delete remainingQuery.dept
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

/** Xóa số/DTMF và query gọi khi service thông báo cuộc gọi đã kết thúc. */
const onCallEnded = () => {
  extension.value = ''
  cleanCallQueryParams()
}

/** Yêu cầu dừng ghi âm nếu cần rồi cúp qua CallService, dọn trạng thái nhập của màn hình. */
const hangupCall = () => {
  if (recordingService.isRecording()) {
    try {
      recordingService.stopRecording().catch(() => {})
    } catch (e) {}
  }
  callService.hangupCurrentCall()
  extension.value = ''
  cleanCallQueryParams()
}

/** Bắt đầu/dừng ghi âm server cho đúng cuộc gọi; chỉ đánh dấu recorded khi API đã xác nhận. */
const toggleRecord = async () => {
  if (isRecording.value) {
    try {
      await recordingService.stopRecording()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⏹️ Đã dừng ghi âm cuộc gọi trên máy chủ tổng đài.',
            type: 'info',
          },
        }),
      )
    } catch (e) {
      console.warn('Lỗi khi dừng ghi âm máy chủ:', e)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: e.message || 'Chưa xác nhận dừng ghi âm. Vui lòng thử lại.',
            type: 'error',
          },
        }),
      )
    }
  } else if (callState.activeCall) {
    if (callStatus.value !== 'connected') {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⏳ Xin vui lòng chờ đối phương nhấc máy để bắt đầu ghi âm!',
            type: 'warning',
          },
        }),
      )
      return
    }

    try {
      const recordingCallId = callState.activeCall.callId
      const started = await recordingService.startRecording(null, {
        name: callState.activeCall.name,
        number: callState.activeCall.number,
        extension: callState.activeCall.number,
        dept: callState.activeCall.dept,
        direction: callState.activeCall.direction,
      })
      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
      // đổi state.
      if (!started || callState.activeCall?.callId !== recordingCallId) return
      callState.activeCall.isRecorded = true
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '🔴 Đang ghi âm cuộc gọi trực tiếp trên máy chủ tổng đài...',
            type: 'success',
          },
        }),
      )
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ Không thể ghi âm trên tổng đài: ${err.message || 'Lỗi phân quyền'}`,
            type: 'error',
          },
        }),
      )
    }
  }
}

/** Chuyển yêu cầu tắt/bật microphone tới CallService thay vì sửa trực tiếp SDK từ component. */
const toggleMute = () => {
  callService.toggleMute()
}

const showAddParticipantModal = ref(false)

// Nhận từ khóa từ Header qua query URL và đồng bộ phần tìm kiếm trong danh bạ.
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

// Nhận yêu cầu gọi từ màn hình khác qua URL; chỉ tự quay số khi không có cuộc gọi đang hoạt động.
watch(
  () => route.query.number,
  (newNum) => {
    if (newNum) {
      if (route.query.active === 'true' || isCalling.value) {
        // Đang trong cuộc gọi (hoặc vừa nhận cuộc gọi từ Modal), không đưa số vào ô nhập bàn phím
        extension.value = ''
        return
      }
      extension.value = String(newNum)
      if (route.query.autocall === 'true') {
        if (!callState.activeCall && !callService.hasActiveCall()) {
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

// Đồng bộ phần nhập/hiển thị khi cuộc gọi đổi hoặc kết thúc, không giữ query của cuộc gọi cũ.
watch(
  () => callState.activeCall,
  (newCall, oldCall) => {
    if (!newCall && oldCall) {
      extension.value = ''
      cleanCallQueryParams()
    }
  },
)

/** Làm mới danh bạ nền khi tab được người dùng chú ý trở lại. */
const onWindowFocus = () => {
  loadContacts(true)
}

/** Nhận yêu cầu làm mới danh bạ từ các thành phần khác và dùng cùng loadContacts. */
const onRefreshContactsEvent = () => {
  loadContacts(true)
}

// Khi component được gắn vào DOM, nạp dữ liệu và đăng ký các listener/tài nguyên cần cho giao diện
// này.
onMounted(async () => {
  window.addEventListener('smartcall-call-ended', onCallEnded)
  window.addEventListener('smartcall-refresh-contacts', onRefreshContactsEvent)
  window.addEventListener('focus', onWindowFocus)

  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }

  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    loadContacts(true)
  } else {
    loadContacts(false)
  }
})

// Khi View được KeepAlive mở lại, đồng bộ dữ liệu/tài nguyên với phiên hiện tại thay vì dùng trạng
// thái cũ.
onActivated(() => {
  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }
  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
  }
  loadContacts(true)
})

// Khi component bị hủy, gỡ listener và dọn tài nguyên thuộc vòng đời này để callback cũ không tiếp
// tục tác động UI.
onUnmounted(() => {
  window.removeEventListener('smartcall-call-ended', onCallEnded)
  window.removeEventListener('smartcall-refresh-contacts', onRefreshContactsEvent)
  window.removeEventListener('focus', onWindowFocus)
  dtmfLog.value = ''
})
</script>

<style>
/* CSS chỉ áp dụng trong .calls-view để giữ nguyên layout khi tách component. */
.calls-view {
  max-width: 1560px;
  margin: 0 auto;
  padding: 0 16px;
}

.calls-view .view-header {
  margin-bottom: 20px;
}

.calls-view .header-titles h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 4px 0;
  font-weight: 700;
}

.calls-view .sub-text {
  color: #64748b;
  font-size: 0.88rem;
}
.calls-view .mobile-segmented-bar {
  display: none;
  background: #e2e8f0;
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 16px;
  gap: 4px;
}

.calls-view .seg-btn {
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
.calls-view .mobile-active-call-bar {
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

.calls-view .bar-call-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}

.calls-view .mini-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  animation: calls-view-pulse-ring 1.5s infinite;
}

.calls-view .bar-duration {
  font-family: monospace;
  color: #34d399;
  font-weight: 700;
}

.calls-view .bar-call-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.calls-view .btn-mini-control {
  background: #334155;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.9rem;
}

.calls-view .btn-mini-hangup {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.calls-view .calls-grid-layout {
  display: flex;
  justify-content: center;
  align-items: stretch;
  width: 100%;
  max-width: 1400px;
  height: 580px;
  margin: 0 auto;
  transition: all 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.calls-view .preview-call-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #22c55e;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  box-shadow: 0 2px 4px rgba(34, 197, 94, 0.25);
}

.calls-view .preview-call-action-btn:hover:not(:disabled) {
  background: #16a34a;
  transform: scale(1.06);
}

.calls-view .preview-call-action-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

@keyframes calls-view-pulse-ring {
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

@keyframes calls-view-pulse-ring-amber {
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

.calls-view .dialer-status-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #cbd5e1;
  margin-bottom: 16px;
}

.calls-view .status-sep {
  color: #64748b;
  font-size: 0.75rem;
}

.calls-view .status-ext-text {
  font-weight: 500;
  color: #94a3b8;
}

.calls-view .idle-unknown-note {
  font-size: 0.82rem;
  color: #94a3b8;
  margin: 6px 0 16px 0;
}

.calls-view .idle-guide-text {
  font-size: 0.85rem;
  color: #94a3b8;
  margin: 8px 0 20px 0;
  max-width: 280px;
  line-height: 1.4;
}

@keyframes calls-view-blink-rec-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

@keyframes calls-view-pulse-rec-btn {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
  }
  50% {
    transform: scale(1.04);
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
}

@keyframes calls-view-pulse-rec-border {
  0% {
    border-color: rgba(239, 68, 68, 0.5);
  }
  50% {
    border-color: rgba(239, 68, 68, 0.9);
  }
  100% {
    border-color: rgba(239, 68, 68, 0.5);
  }
}
.calls-view .idle-collapsed-bar {
  display: none;
}

@keyframes calls-view-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1199px) and (min-width: 768px) {
  .calls-view .calls-grid-layout {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    height: auto;
  }

  .calls-view .dialer-col {
    width: 300px;
    margin-right: 0;
  }
}
@media (max-width: 768px) {
  .calls-view .mobile-segmented-bar {
    display: flex;
  }

  .calls-view .calls-grid-layout {
    display: block;
    height: auto;
  }

  .calls-view .calls-grid-layout.mobile-show-dialer .dialer-col {
    display: block;
    width: 100%;
    margin-right: 0;
    margin-bottom: 16px;
  }

  .calls-view .calls-grid-layout.mobile-show-contacts .dialer-col {
    display: none;
  }

  .calls-view .dialer-box {
    padding: 16px;
    height: auto;
    max-height: none;
  }

  .calls-view .key-btn {
    width: 52px;
    height: 52px;
    font-size: 1.15rem;
  }
}

.calls-view .pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

@keyframes calls-view-pulseOpacity {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@keyframes calls-view-fadeInModal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes calls-view-scaleUpModal {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
