import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reactive, nextTick, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { invalidateSession } from '../../src/services/auth/sessionScope.js'
import { callState } from '../../src/state/callState.js'
import { userSessionState } from '../../src/state/sessionState.js'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'

const ports = vi.hoisted(() => ({
  authService: {
    getCurrentDisplayName: vi.fn(() => 'Fixture'),
    getCurrentExtension: vi.fn(() => '1000'),
    getHostUrl: vi.fn(() => 'https://fixture.invalid'),
    updatePresence: vi.fn(),
    login: vi.fn(),
  },
  phoneAdapter: { applyAudioDevices: vi.fn(async () => {}) },
  settingsService: { loadCallServices: vi.fn(), saveCallServices: vi.fn() },
  contactService: {
    getEmployeeAvatar: vi.fn(async () => ''),
    currentContacts: [],
    findContactByExtension: vi.fn(),
    findContactByUuid: vi.fn(),
  },
  chatService: {
    rooms: [],
    setVisibleRoom: vi.fn(),
    getUnreadCount: vi.fn(() => 0),
    getRooms: vi.fn(),
    getRoomMessages: vi.fn(),
    publishRoomsChanged: vi.fn(),
    sendMessage: vi.fn(),
    deleteMultipleRooms: vi.fn(),
  },
  groupCallService: { state: {}, startGroupCall: vi.fn() },
}))
vi.mock('@/services/index.js', () => ports)

import AppHeader from '../../src/components/layout/AppHeader.vue'
import SettingsModal from '../../src/components/common/SettingsModal.vue'
import MessagesView from '../../src/views/MessagesView.vue'
import LoginView from '../../src/views/LoginView.vue'

let wrapper, router
beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('smartcall_user_uuid', 'a')
  Object.assign(userSessionState, {
    userUuid: 'a',
    extension: '1000',
    displayName: 'Fixture',
    department: '',
  })
  Object.assign(callState, { isRegistered: false, activeCall: null, incomingCall: null })
  router = createRouter({
    history: createMemoryHistory(),
    routes: ['/messages', '/calls', '/login'].map((path) => ({
      path,
      component: { template: '<div />' },
    })),
  })
  await router.push('/messages')
  await router.isReady()
  ports.chatService.rooms = reactive([
    { id: 'a', title: 'A', isDirect: true, messages: [] },
    { id: 'b', title: 'B', isDirect: true, messages: [] },
  ])
  ports.chatService.getRooms.mockImplementation(async () => ports.chatService.rooms)
  ports.chatService.getRoomMessages.mockResolvedValue([])
  ports.settingsService.loadCallServices.mockResolvedValue({
    dnd: true,
    forwards: { busy: '4321', noanswer: '', unconditional: '' },
    errors: [],
  })
  ports.settingsService.saveCallServices.mockImplementation(async (_values, baseline) => ({
    baseline,
    failures: [],
  }))
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

it('header không báo SIP online chỉ vì có token', async () => {
  localStorage.setItem('smartcall_wazo_token', 'fixture-token')
  wrapper = mountComponent(AppHeader, { plugins: [router] })
  expect(wrapper.element.querySelector('.sip-status-text').textContent).toContain('Ngoại tuyến')
  callState.isRegistered = true
  await nextTick()
  expect(wrapper.element.querySelector('.sip-status-text').textContent).toContain('Trực tuyến')
})

it('lưu âm thanh trước khi tải Confd gửi baseline chưa tải xuống service', async () => {
  wrapper = mountComponent(SettingsModal, { props: { isOpen: true } })
  await flushUi()
  wrapper.element.querySelector('.modal-foot .btn-primary').click()
  await flushUi()
  expect(ports.settingsService.saveCallServices).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ dnd: null, forwards: null }),
  )
})

it('form đăng nhập gọi auth command và điều hướng sau thành công', async () => {
  ports.authService.login.mockResolvedValue({ token: 'fixture' })
  wrapper = mountComponent(LoginView, { plugins: [router] })
  wrapper.state.username = 'fixture'
  wrapper.state.password = 'fixture-password'
  await wrapper.state.handleLogin()
  await flushUi()
  expect(ports.authService.login).toHaveBeenCalledWith('fixture', 'fixture-password')
  expect(router.currentRoute.value.path).toBe('/calls')
})

it('gửi ở phòng A không kéo về A sau khi đã chọn phòng B', async () => {
  let finish
  ports.chatService.sendMessage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  wrapper = mountComponent(MessagesView, { plugins: [router] })
  await flushUi()
  wrapper.state.currentRoom = ports.chatService.rooms[0]
  wrapper.state.inputText = 'Nội dung'
  const sending = wrapper.state.sendMessage()
  wrapper.state.currentRoom = ports.chatService.rooms[1]
  finish({ id: 'message' })
  await sending
  await flushUi()
  expect(wrapper.state.currentRoom.id).toBe('b')
})

it('batch delete không báo thành công toàn bộ khi service trả lỗi từng phần', async () => {
  const events = [],
    onToast = (event) => events.push(event.detail)
  window.addEventListener('app-toast', onToast)
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
  ports.chatService.deleteMultipleRooms.mockResolvedValue({
    deletedIds: [],
    failures: [{ roomId: 'a', message: 'HTTP500' }],
  })
  wrapper = mountComponent(MessagesView, { plugins: [router] })
  await flushUi()
  wrapper.state.selectedRoomIds = ['a']
  await wrapper.state.handleDeleteSelectedRooms()
  expect(wrapper.state.selectedRoomIds).toEqual(['a'])
  expect(events.at(-1)).toMatchObject({ type: 'warning' })
  expect(events.at(-1).message).toContain('0/1')
  window.removeEventListener('app-toast', onToast)
})

it('đổi mật khẩu giữ nguyên khoảng trắng thay vì tự sửa credential', async () => {
  ports.authService.changePassword = vi.fn(async () => ({ ok: true, status: 204 }))
  wrapper = mountComponent(SettingsModal, { props: { isOpen: true } })
  wrapper.state.oldPassword = ' old password '
  wrapper.state.newPassword = ' new password '
  wrapper.state.confirmPassword = ' new password '
  await wrapper.state.savePassword()
  expect(ports.authService.changePassword).toHaveBeenCalledWith(' old password ', ' new password ')
})

it('reset mật khẩu dùng tên đăng nhập thật, không dùng tên hiển thị', async () => {
  ports.authService.resetPassword = vi.fn(async () => ({ ok: true, status: 204 }))
  localStorage.setItem('smartcall_username', 'Tên hiển thị')
  wrapper = mountComponent(SettingsModal, { props: { isOpen: true } })
  await wrapper.state.sendPasswordResetEmail()
  expect(ports.authService.resetPassword).not.toHaveBeenCalled()
  localStorage.setItem('smartcall_login_username', 'real.login')
  await wrapper.state.sendPasswordResetEmail()
  expect(ports.authService.resetPassword).toHaveBeenCalledWith('real.login')
})

it('gọi từ chat 1-1 giữ query tự gọi trên router thật', async () => {
  wrapper = mountComponent(MessagesView, { plugins: [router] })
  await flushUi()
  wrapper.state.currentRoom = { id: 'direct', isDirect: true, ext: '2000', messages: [] }
  // App là bên duy nhất nhận dial và điều hướng; MessagesView không được ghi đè bằng /calls.
  const onAction = (event) =>
    router.push({ path: '/calls', query: { number: event.detail.value, autocall: 'true' } })
  window.addEventListener('app-action', onAction)
  try {
    await wrapper.state.startVoiceCall()
    await flushUi()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({ number: '2000', autocall: 'true' }),
    )
  } finally {
    window.removeEventListener('app-action', onAction)
  }
})

/** Mở hội thoại nhóm nhỏ để kiểm tra cả nhánh chỉ còn một người khác. */
async function openGroupCallRoom() {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
  ports.chatService.sendMessage.mockResolvedValue({ id: 'notice' })
  ports.groupCallService.startGroupCall.mockReset()
  wrapper = mountComponent(MessagesView, { plugins: [router] })
  await flushUi()
  wrapper.state.currentRoom = {
    id: 'group',
    title: 'Team',
    isDirect: false,
    messages: [],
    members: [
      { id: 'a', ext: '1000' },
      { id: 'peer', ext: '2000' },
    ],
  }
}

it('chat nhóm một người cũng được lọc; không mở Calls hoặc gửi thông báo khi không gọi được', async () => {
  await openGroupCallRoom()
  ports.chatService.sendMessage.mockClear()
  ports.groupCallService.startGroupCall.mockResolvedValue({
    success: false,
    reason: 'NO_AVAILABLE_TARGETS',
  })
  await wrapper.state.startVoiceCall()
  expect(ports.groupCallService.startGroupCall).toHaveBeenCalledWith(['2000'], {
    roomId: 'group',
    groupTitle: 'Team',
  })
  expect(router.currentRoute.value.path).toBe('/messages')
  expect(ports.chatService.sendMessage).not.toHaveBeenCalled()
  expect(wrapper.state.isStartingVoiceCall).toBe(false)
})

it('chat nhóm chờ kết quả, chặn bấm lặp và giữ room ID lúc bắt đầu', async () => {
  await openGroupCallRoom()
  let finish
  ports.groupCallService.startGroupCall.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  ports.chatService.sendMessage.mockClear()
  const first = wrapper.state.startVoiceCall()
  await wrapper.state.startVoiceCall()
  expect(ports.groupCallService.startGroupCall).toHaveBeenCalledTimes(1)
  expect(ports.chatService.sendMessage).not.toHaveBeenCalled()
  expect(router.currentRoute.value.path).toBe('/messages')
  wrapper.state.currentRoom = { id: 'other', isDirect: true, messages: [] }
  finish({ success: true })
  await first
  await flushUi()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/calls'))
  expect(ports.chatService.sendMessage).toHaveBeenCalledWith(
    'group',
    expect.any(String),
    expect.any(String),
  )
  expect(wrapper.state.isStartingVoiceCall).toBe(false)
})

it('logout khi chat-call đang chờ bỏ kết quả muộn', async () => {
  await openGroupCallRoom()
  let finish
  ports.groupCallService.startGroupCall.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  ports.chatService.sendMessage.mockClear()
  const first = wrapper.state.startVoiceCall()
  invalidateSession()
  finish({ success: true })
  await first
  expect(router.currentRoute.value.path).toBe('/messages')
  expect(ports.chatService.sendMessage).not.toHaveBeenCalled()
})

it('hủy xác nhận không gọi; lỗi dịch vụ trả khóa để thử lại', async () => {
  await openGroupCallRoom()
  confirm.mockReturnValue(false)
  await wrapper.state.startVoiceCall()
  expect(ports.groupCallService.startGroupCall).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  ports.groupCallService.startGroupCall.mockRejectedValue(new Error('network'))
  await wrapper.state.startVoiceCall()
  expect(wrapper.state.isStartingVoiceCall).toBe(false)
  expect(router.currentRoute.value.path).toBe('/messages')
})

it('quay lại KeepAlive giữ danh sách phòng trong khi REST đang cập nhật nền', async () => {
  const host = {
    components: { MessagesView },
    setup() {
      return { visible: ref(true) }
    },
    template: '<KeepAlive><MessagesView v-if="visible" /></KeepAlive>',
  }
  wrapper = mountComponent(host, { plugins: [router] })
  await flushUi()
  expect(wrapper.element.querySelector('.rooms-loading')).toBeNull()
  let finish
  ports.chatService.getRooms.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  wrapper.state.visible = false
  await nextTick()
  wrapper.state.visible = true
  await nextTick()
  expect(wrapper.element.querySelector('.rooms-loading')).toBeNull()
  expect(wrapper.element.querySelectorAll('.room-item').length).toBe(2)
  finish(ports.chatService.rooms)
  await flushUi()
})

it('lịch sử chat có trong RAM vẫn hiển thị trong lúc refresh phòng', async () => {
  wrapper = mountComponent(MessagesView, { plugins: [router] })
  await flushUi()
  let finish
  ports.chatService.getRoomMessages.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const room = {
    id: 'existing',
    isDirect: true,
    title: 'Có sẵn',
    messages: [{ id: 'm', text: 'Nội dung đã tải', sender: 'other' }],
  }
  const request = wrapper.state.selectRoom(room)
  await nextTick()
  expect(wrapper.state.isLoadingMessages).toBe(false)
  expect(wrapper.element.textContent).toContain('Nội dung đã tải')
  finish(room.messages)
  await request
})

it('login chỉ hiện hướng dẫn chứng chỉ sau lỗi mạng, không hiện với 401/HTTP/runtime và xóa khi thử lại', async () => {
  wrapper = mountComponent(LoginView, { plugins: [router] })
  wrapper.state.username = 'fixture'
  wrapper.state.password = 'password'
  expect(wrapper.element.querySelector('.ssl-cert-hint')).toBeNull()
  for (const [error, expected] of [
    [new TypeError('Failed to fetch'), true],
    [new Error('certificate verify failed'), true],
    [Object.assign(new Error('Network error'), { status: 401 }), false],
    [Object.assign(new Error('server'), { response: { status: 503 } }), false],
    [new Error('Invalid credentials'), false],
    [new Error('Timeout'), false],
    [new TypeError('Cannot read properties of undefined'), false],
  ]) {
    ports.authService.login.mockRejectedValue(error)
    await wrapper.state.handleLogin()
    await nextTick()
    expect(Boolean(wrapper.element.querySelector('.ssl-cert-hint'))).toBe(expected)
  }
  ports.authService.login.mockRejectedValue(new TypeError('Failed to fetch'))
  await wrapper.state.handleLogin()
  let finish
  ports.authService.login.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const retry = wrapper.state.handleLogin()
  await nextTick()
  expect(wrapper.element.querySelector('.ssl-cert-hint')).toBeNull()
  finish({ token: 'fixture' })
  await retry
})
