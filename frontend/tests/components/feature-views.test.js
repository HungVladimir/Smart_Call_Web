import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reactive, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
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
  groupCallService: { state: {} },
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
