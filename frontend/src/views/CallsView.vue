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
        <UiIcon name="phone-text" /> Bàn phím & Đàm thoại
      </button>
      <button
        class="seg-btn"
        :class="{ active: mobileTab === 'contacts' }"
        @click="mobileTab = 'contacts'"
      >
        <UiIcon name="users-text" /> Danh bạ
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
          <UiIcon :name="isMuted ? 'muted-text' : 'microphone-text'" />
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
        :preview-message="dialPreviewMessage"
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
        :can-add-participant="groupCallService.canInviteParticipants()"
        @mute="toggleMute"
        @record="toggleRecord"
        @hangup="hangupCall"
        @add-participant="openAddParticipantModal"
      />

      <!-- CỘT 3: DANH BẠ NHÂN VIÊN (CONTACTS PANEL) -->
      <DirectoryPanel
        :active="directoryActive"
        :busy="isCalling || isDialing || preparingGroup"
        :my-extension="userSessionState.extension"
        :search-query="searchTerm"
        :recent-contacts="recentContacts"
        :load-contacts="loadDirectoryContacts"
        :peek-contacts="peekDirectoryContacts"
        :load-departments="loadDepartments"
        :refresh-presence="refreshVisiblePresence"
        @call="handleCallFromPanel"
        @remember="rememberContact"
        @favorite="toggleFavorite"
        @clear-search="clearSearch"
        @clear-recent="clearRecentContacts"
      >
        <template #groups><CallGroupsView embedded @called="mobileTab = 'dialer'" /></template>
      </DirectoryPanel>
    </div>

    <!-- Modal Thêm thành viên vào cuộc gọi đang diễn ra -->
    <AddParticipantModal
      :is-open="showAddParticipantModal"
      :contacts="contacts"
      :call="callState.activeCall"
      :group="groupCallService.state"
      :my-extension="userSessionState.extension"
      :can-invite-contact="canInviteContact"
      :load-contacts="loadDirectoryContacts"
      :refresh-presence="refreshVisiblePresence"
      :submitting="submittingInvite"
      @close="closeAddParticipantModal"
      @confirm="confirmAddParticipants"
    />
  </div>
</template>

<script setup>
import UiIcon, { iconGlyphs } from '@/components/common/UiIcon.vue'
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
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
import AddParticipantModal from '@/components/call/AddParticipantModal.vue'
import DirectoryPanel from '@/components/contacts/DirectoryPanel.vue'
import CallGroupsView from './CallGroupsView.vue'
import { captureSessionContext, isSessionContextCurrent } from '@/services/auth/sessionScope.js'

// View chỉ nối router/state với service và chuyển dữ liệu cho các cụm giao diện.
const searchTerm = ref('')
const directoryActive = ref(false)
const preparingGroup = ref(false)
const submittingInvite = ref(false)
let inviteDialogVersion = 0
/** Hiển thị lịch sử của phiên hiện tại với tên và presence đã biết. */
const recentContacts = computed(() => contactService.getRecentContacts())

/** Đọc danh sách có phạm vi từ dịch vụ danh bạ. */
function loadDirectoryContacts(query) {
  return query.tab === 'favorites'
    ? contactService.listFavorites(query)
    : contactService.listPublishedContacts(query)
}

/** Kiểm tra nhanh RAM cache của Yêu thích/Bộ phận để đổi tab tức thì không chớp màn hình tải. */
function peekDirectoryContacts(query) {
  return contactService.peekDirectoryContacts?.(query) || null
}

/** Chuyển lệnh tải presence khi panel lấy lại focus hoặc khi socket mở lại. */
function refreshVisiblePresence(contacts, force, signal) {
  void contactService.refreshDirectoryPresence(contacts, force, signal)
}

/** Lấy tên các bộ phận trước khi chọn, tránh đoán từ trang hiện tại. */
function loadDepartments(signal, force) {
  return contactService.listDepartments(signal, force)
}

/** Ghi liên hệ đã được người dùng chọn trong kết quả tìm kiếm. */
function rememberContact(contact) {
  contactService.rememberRecentContact(contact)
}

/** Xóa lịch sử tra liên hệ của phiên đang dùng. */
function clearRecentContacts() {
  contactService.clearRecentContacts()
}
/**
 * Truyền điều kiện khả dụng của ContactService xuống component dưới dạng hàm, không để UI tự đọc
 * API.
 */
const canInviteContact = (contact) => contactService.isContactAvailableForCall(contact)
/** Mở modal lựa chọn người; việc mời thật chỉ bắt đầu sau khi người dùng xác nhận. */
const openAddParticipantModal = () => {
  // Chặn thao tác nếu nhánh vừa kết thúc hoặc cuộc gọi chỉ được tổng đài trả lời.
  if (!groupCallService.canInviteParticipants()) return
  inviteDialogVersion++
  showAddParticipantModal.value = true
}
/** Đóng modal mời người; lựa chọn tạm thuộc component và được reset theo vòng đời mở/đóng. */
const closeAddParticipantModal = () => {
  inviteDialogVersion++
  showAddParticipantModal.value = false
}
/** Service quyết định host/ủy quyền; View chỉ hiển thị lỗi khi không gửi được yêu cầu. */
const confirmAddParticipants = async (extensions) => {
  if (submittingInvite.value) return
  const version = inviteDialogVersion
  submittingInvite.value = true
  try {
    const targets = await prepareSelectedTargets(extensions)
    if (!targets.length || !showAddParticipantModal.value || inviteDialogVersion !== version) return
    await groupCallService.addParticipantsToGroupCall(targets)
    if (inviteDialogVersion === version) closeAddParticipantModal()
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: error.message || 'Không thể thêm người vào cuộc gọi.', type: 'warning' },
      }),
    )
  } finally {
    submittingInvite.value = false
  }
}

const route = useRoute()

const router = useRouter()

const extension = ref('')
let autoDialTimer

const dtmfLog = ref('')

const mobileTab = ref('dialer')

/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => contactService.getKnownContacts())

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

const matchedDialContact = ref(null)
const dialPreviewMessage = ref('')

/** Tra đúng số đã nhập qua service, độc lập với kết quả và trang danh bạ đang mở. */
function previewDialTarget([value, active], previous, onCleanup) {
  matchedDialContact.value = null
  dialPreviewMessage.value = ''
  const number = value.trim()
  if (!active || !/^\d{3,}$/.test(number) || callState.activeCall) return
  const context = captureSessionContext()
  let canceled = false
  dialPreviewMessage.value = 'Đang tra cứu máy lẻ…'
  /** Bỏ phản hồi của số cũ, màn đã đóng hoặc phiên đã hết trước khi hiển thị. */
  function isPreviewCurrent() {
    return !canceled && extension.value === value && isSessionContextCurrent(context)
  }

  /** Hiển thị liên hệ đã xác minh rồi lấy trạng thái cho riêng UUID đó. */
  async function lookupPreview() {
    try {
      const contact = await contactService.getOrLookupContact(number)
      if (!isPreviewCurrent()) return
      matchedDialContact.value = contact
      dialPreviewMessage.value = contact ? '' : 'Không tìm thấy máy lẻ trong danh bạ'
      if (contact) await contactService.refreshDirectoryPresence([contact])
    } catch {
      if (isPreviewCurrent()) dialPreviewMessage.value = 'Chưa tra cứu được máy lẻ'
    }
  }
  const timer = setTimeout(lookupPreview, 300)
  /** Hủy debounce và chặn phản hồi đã bắt đầu trước khi đổi số hoặc rời màn. */
  function cancelPreview() {
    canceled = true
    clearTimeout(timer)
  }
  onCleanup(cancelPreview)
}
watch([extension, directoryActive], previewDialTarget)

/** Định dạng số giây đàm thoại thành phút:giây để hiển thị trên khung gọi và thanh gọi nhỏ. */
function formatActiveCallDuration() {
  const s = callState.activeCall?.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

/** Thời lượng đàm thoại hiện tại dạng mm:ss. */
const formattedDuration = computed(formatActiveCallDuration)

/** Chọn nhãn thời gian phù hợp: chưa gọi, đang kết nối/đổ chuông hoặc thời lượng đàm thoại. */
function buildDurationText() {
  if (!callState.activeCall) return '00:00'
  if (callState.activeCall.status === 'answering') return 'Đang kết nối...'
  if (callState.activeCall.status === 'ringing')
    return `${iconGlyphs['phone-text']} Đang đổ chuông...`
  return formattedDuration.value
}

/** Chuỗi hiển thị trạng thái kết nối hoặc thời lượng cuộc gọi ở ActiveCallPanel. */
const durationText = computed(buildDurationText)

/** Xác minh người được mời, giữ guard phiên và cuộc gọi khi API trả muộn. */
async function prepareSelectedTargets(contacts) {
  if (preparingGroup.value) return []
  const context = captureSessionContext()
  const generation = callService.callGeneration
  const callId = callState.activeCall?.callId
  preparingGroup.value = true
  try {
    const result = await contactService.prepareGroupTargets(contacts)
    if (
      !isSessionContextCurrent(context) ||
      generation !== callService.callGeneration ||
      callState.activeCall?.callId !== callId
    )
      return []
    if (result.rejected.length)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { type: 'warning', message: 'Không thể mời: ' + result.rejected.join(', ') },
        }),
      )
    return result.extensions
  } catch (error) {
    if (isSessionContextCurrent(context))
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            type: 'warning',
            message: error.message || 'Chưa kiểm tra được người được mời.',
          },
        }),
      )
    return []
  } finally {
    preparingGroup.value = false
  }
}

/** Nhập số/gửi DTMF trước tiếng phản hồi; phím số không khởi tạo AudioContext đồng bộ. */
const pressKey = (key) => {
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
  callToneService.playDtmfTone(key)
}

/** Xóa ký tự cuối của số đang nhập; không thay đổi số của cuộc gọi đã hoạt động. */
const clearDigit = () => {
  if (!callState.activeCall) {
    extension.value = extension.value.slice(0, -1)
  }
}

/** Bỏ qua lỗi điều hướng router.replace khi người dùng chuyển trang hoặc trùng query hiện tại. */
const ignoreRouterReplaceError = () => {}

/** Xóa từ khóa trên UI và query q của router để trạng thái tìm kiếm không tự quay lại. */
const clearSearch = () => {
  searchTerm.value = ''
  if (route.query && route.query.q) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.q
    router.replace({ path: '/calls', query: remainingQuery }).catch(ignoreRouterReplaceError)
  }
}

/** Gửi số đã chuẩn hóa tới CallService.startCall rồi dọn ô nhập/query điều hướng. */
const handleDial = async () => {
  const targetExtension = extension.value.trim()
  if (!targetExtension) return
  const expectedUuid =
    route.query.number === targetExtension ? String(route.query.peerUuid || '') : ''
  const context = captureSessionContext()
  const result = expectedUuid
    ? await callService.startCall(targetExtension, { expectedUuid })
    : await callService.startCall(targetExtension)
  if (result?.success && isSessionContextCurrent(context))
    contactService.rememberRecentContact(contactService.findContactByExtension(targetExtension))
  if (extension.value.trim() === targetExtension) {
    if (result?.success) extension.value = ''
    cleanCallQueryParams()
  }
}

/** Nhận liên hệ từ panel và tra lại trạng thái/UUID trước khi quay số. */
async function handleCallFromPanel(contact) {
  if (!contact?.number) return
  contactService.rememberRecentContact(contact)
  mobileTab.value = 'dialer'
  extension.value = ''
  await callService.startCall(contact.number, {
    name: contact.name,
    dept: contact.dept,
    expectedUuid: contact.uuid,
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

/** Dọn tham số tự gọi đã xử lý để refresh không phát lại cuộc gọi. */
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
    delete remainingQuery.peerUuid
    delete remainingQuery.active
    delete remainingQuery.direction
    delete remainingQuery.name
    delete remainingQuery.dept
    router.replace({ path: '/calls', query: remainingQuery }).catch(ignoreRouterReplaceError)
  }
}

/** Xóa số/DTMF và query gọi khi service thông báo cuộc gọi đã kết thúc. */
const onCallEnded = () => {
  extension.value = ''
  cleanCallQueryParams()
}

/** Ghi cảnh báo nếu lệnh dừng ghi âm khi cúp máy thất bại nhưng không chặn việc ngắt cuộc gọi. */
function handleStopRecordingOnHangupError(err) {
  logger.warn('AUDIO', 'Không thể dừng ghi âm khi cúp máy:', err)
}

/** Yêu cầu dừng ghi âm nếu cần rồi cúp qua CallService, dọn trạng thái nhập của màn hình. */
const hangupCall = () => {
  if (recordingService.isRecording()) {
    try {
      recordingService.stopRecording().catch(handleStopRecordingOnHangupError)
    } catch (err) {
      handleStopRecordingOnHangupError(err)
    }
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
            message: `${iconGlyphs['stop-text']} Đã dừng ghi âm cuộc gọi trên máy chủ tổng đài.`,
            type: 'info',
          },
        }),
      )
    } catch (e) {
      logger.warn('AUDIO', 'Lỗi khi dừng ghi âm máy chủ:', e)
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
            message: `${iconGlyphs['hourglass']} Xin vui lòng chờ đối phương nhấc máy để bắt đầu ghi âm!`,
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
            message: `${iconGlyphs['status-busy']} Đang ghi âm cuộc gọi trực tiếp trên máy chủ tổng đài...`,
            type: 'success',
          },
        }),
      )
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['warning']} Không thể ghi âm trên tổng đài: ${err.message || 'Lỗi phân quyền'}`,
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

/** Nhận từ khóa từ URL và đồng bộ vào thanh tìm kiếm danh bạ (tự mở tab Danh bạ trên mobile). */
function syncSearchTermFromRoute(newQuery) {
  if (newQuery === undefined || newQuery === null) return
  searchTerm.value = String(newQuery)
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    mobileTab.value = 'contacts'
  }
}

/** Nhận yêu cầu quay số từ URL; chỉ tự động gọi khi không có cuộc gọi đang hoạt động. */
function handleRouteNumberChange(newNum) {
  clearTimeout(autoDialTimer)
  if (!newNum) return
  if (route.query.active === 'true' || isCalling.value) {
    // Đang trong cuộc gọi hoặc vừa nhận cuộc gọi từ Modal: không đưa số vào ô nhập bàn phím.
    extension.value = ''
    return
  }
  extension.value = String(newNum)
  if (route.query.autocall === 'true') {
    if (!callState.activeCall && !callService.hasActiveCall()) {
      const context = captureSessionContext()
      /** Chỉ tự quay đúng số ban đầu nếu lệnh URL, ô nhập và phiên còn khớp. */
      function dialFromRoute() {
        if (
          route.path === '/calls' &&
          String(route.query.number) === String(newNum) &&
          extension.value === String(newNum) &&
          isSessionContextCurrent(context)
        )
          void handleDial()
      }
      autoDialTimer = setTimeout(dialFromRoute, 150)
    } else {
      cleanCallQueryParams()
    }
  }
}

/** Đóng modal mời và dọn query/số nhập ngay khi cuộc gọi kết thúc. */
function resetCallsViewOnCallEnd(newCall, oldCall) {
  if (!newCall && oldCall) {
    closeAddParticipantModal()
    extension.value = ''
    cleanCallQueryParams()
  }
}

watch(() => route.query.q, syncSearchTermFromRoute, { immediate: true })
watch(() => route.query.number, handleRouteNumberChange, { immediate: true })
watch(() => callState.activeCall, resetCallsViewOnCallEnd)

/** Đăng ký sự kiện của màn hình gọi trong suốt vòng đời component. */
function registerCallViewListeners() {
  activateCallsView()
  window.addEventListener('smartcall-call-ended', onCallEnded)
}

/** Nhận từ khóa trong URL và tải danh bạ khi màn hình gọi được hiển thị. */
function activateCallsView() {
  directoryActive.value = true
  if (route.query.q) searchTerm.value = String(route.query.q)
}

/** Hủy truy vấn tìm khi rời tab giữ bằng KeepAlive. */
function deactivateDirectory() {
  directoryActive.value = false
  clearTimeout(autoDialTimer)
}

/** Gỡ listener và xóa nhật ký bàn phím khi component kết thúc vòng đời. */
function disposeCallsView() {
  clearTimeout(autoDialTimer)
  window.removeEventListener('smartcall-call-ended', onCallEnded)
  dtmfLog.value = ''
}

onMounted(registerCallViewListeners)
onActivated(activateCallsView)
onDeactivated(deactivateDirectory)
onUnmounted(disposeCallsView)
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

  .calls-view .calls-grid-layout.mobile-show-dialer .contacts-col,
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
