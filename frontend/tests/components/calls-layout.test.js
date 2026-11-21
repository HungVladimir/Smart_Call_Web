import { callToneService } from '../../src/services/audio/audioService.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reactive, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { callState, recordingState } from '../../src/state/callState.js'
import { userSessionState } from '../../src/state/sessionState.js'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'

const ports = vi.hoisted(() => ({
  callService: {
    isDialing: false,
    hasActiveCall: vi.fn(() => false),
    startCall: vi.fn(async () => ({ success: true })),
    sendDtmfDigits: vi.fn(),
    toggleMute: vi.fn(),
    hangupCurrentCall: vi.fn(),
  },
  groupCallService: {
    state: { isGroupCall: false, groupParticipantExtensions: [], secondaryCallSessions: new Map() },
    startGroupCall: vi.fn(),
    addParticipantsToGroupCall: vi.fn(),
    delegateAddParticipantsToHost: vi.fn(),
  },
  contactService: {
    currentContacts: [],
    getContacts: vi.fn(),
    isContactAvailableForCall: vi.fn(),
    findContactByExtension: vi.fn(),
  },
  recordingService: {
    isRecording: vi.fn(() => false),
    stopRecording: vi.fn(),
    startRecording: vi.fn(),
  },
}))
vi.mock('@/services/index.js', () => ports)
vi.mock('@/services/audio/audioService.js', () => ({ callToneService: { playDtmfTone: vi.fn() } }))
vi.mock('@/services/common/loggerService.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
import CallsView from '../../src/views/CallsView.vue'
import ActiveCallPanel from '../../src/components/call/ActiveCallPanel.vue'
import ContactsPanel from '../../src/components/contacts/ContactsPanel.vue'
import AddParticipantModal from '../../src/components/call/AddParticipantModal.vue'

let wrapper, warnings
const group = () =>
  reactive({
    isGroupCall: false,
    isGroupHost: false,
    groupParticipantExtensions: [],
    secondaryCallSessions: new Map(),
  })
const contacts = () =>
  reactive([
    { id: 'me', uuid: 'me', number: '1000', name: 'Tôi', dept: 'Kỹ thuật', status: 'online' },
    { id: 'peer', uuid: 'peer', number: '2000', name: 'Đỗ An', dept: 'Nhân sự', status: 'online' },
    {
      id: 'invite',
      uuid: 'invite',
      number: '3000',
      name: 'Đồng nghiệp',
      dept: 'Kỹ thuật',
      status: 'online',
    },
    {
      id: 'offline',
      uuid: 'offline',
      number: '4000',
      name: 'Ngoại tuyến',
      dept: 'Kỹ thuật',
      status: 'offline',
    },
  ])
beforeEach(() => {
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  Object.assign(callState, {
    activeCall: null,
    incomingCall: null,
    dialing: false,
    isRegistered: true,
  })
  Object.assign(recordingState, { isRecording: false, duration: 0 })
  Object.assign(userSessionState, { extension: '1000', userUuid: 'me' })
  ports.contactService.currentContacts = contacts()
  ports.groupCallService.state = group()
  ports.contactService.findContactByExtension.mockImplementation((ext) =>
    ports.contactService.currentContacts.find((contact) => contact.number === ext),
  )
  ports.contactService.getContacts.mockImplementation(
    async () => ports.contactService.currentContacts,
  )
  ports.contactService.isContactAvailableForCall.mockImplementation(
    (value) =>
      (typeof value === 'string' ? ports.contactService.findContactByExtension(value) : value)
        ?.status === 'online',
  )
})
afterEach(() => {
  wrapper?.unmount()
  expect(
    warnings.mock.calls.filter(([message]) => String(message).startsWith('[Vue warn]')),
  ).toEqual([])
})

it('khung đàm thoại hiển thị state và phát sự kiện điều khiển, không tự gọi SDK', async () => {
  const muted = vi.fn(),
    record = vi.fn(),
    hangup = vi.fn(),
    add = vi.fn()
  wrapper = mountComponent(ActiveCallPanel, {
    props: {
      call: { number: '2000', name: 'Đỗ An', status: 'connected' },
      contacts: contacts(),
      group: group(),
      recording: { isRecording: false, duration: 0 },
      durationText: '00:42',
      onMute: muted,
      onRecord: record,
      onHangup: hangup,
      'onAdd-participant': add,
    },
  })
  expect(wrapper.element.querySelector('.caller-title').textContent).toContain('Đỗ An')
  expect(wrapper.element.querySelector('.duration-text').textContent).toContain('00:42')
  wrapper.element.querySelector('.control-btn').click()
  wrapper.element.querySelector('.btn-record').click()
  wrapper.element.querySelector('.btn-hangup').click()
  wrapper.element.querySelector('.btn-add-member').click()
  expect(muted).toHaveBeenCalledOnce()
  expect(record).toHaveBeenCalledOnce()
  expect(hangup).toHaveBeenCalledOnce()
  expect(add).toHaveBeenCalledOnce()
})

it('danh bạ tìm không dấu và phát đúng liên hệ được chọn', async () => {
  const call = vi.fn(),
    favorite = vi.fn()
  wrapper = mountComponent(ContactsPanel, {
    props: {
      contacts: ports.contactService.currentContacts,
      myExtension: '1000',
      canInviteContact: ports.contactService.isContactAvailableForCall,
      onCall: call,
      onFavorite: favorite,
    },
  })
  const input = wrapper.element.querySelector('.search-input')
  input.value = 'nhan su'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushUi()
  expect(wrapper.element.querySelectorAll('.contact-item-card')).toHaveLength(1)
  expect(wrapper.element.querySelector('.contact-name').textContent).toContain('Đỗ An')
  wrapper.element.querySelector('.btn-action-icon.call').click()
  wrapper.element.querySelector('.btn-star').click()
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ number: '2000' }))
  expect(favorite).toHaveBeenCalledWith(expect.objectContaining({ number: '2000' }))
})

it('modal mời loại chính mình, peer hiện tại và người offline; đóng/mở xóa lựa chọn tạm', async () => {
  const confirm = vi.fn()
  wrapper = mountComponent(AddParticipantModal, {
    props: {
      isOpen: true,
      call: { number: '2000' },
      group: group(),
      contacts: ports.contactService.currentContacts,
      myExtension: '1000',
      canInviteContact: ports.contactService.isContactAvailableForCall,
      onConfirm: confirm,
    },
  })
  expect(wrapper.element.querySelectorAll('.add-participant-item')).toHaveLength(1)
  wrapper.element.querySelector('.add-participant-item').click()
  await nextTick()
  wrapper.element.querySelector('.btn-add-confirm').click()
  expect(confirm).toHaveBeenCalledWith(['3000'])
  await wrapper.setProps({ isOpen: false })
  await wrapper.setProps({ isOpen: true })
  expect(wrapper.element.querySelector('.btn-add-confirm').disabled).toBe(true)
})

it('modal không mời lựa chọn đã offline trước lúc xác nhận', async () => {
  const confirm = vi.fn()
  wrapper = mountComponent(AddParticipantModal, {
    props: {
      isOpen: true,
      call: { number: '2000' },
      group: group(),
      contacts: ports.contactService.currentContacts,
      myExtension: '1000',
      canInviteContact: ports.contactService.isContactAvailableForCall,
      onConfirm: confirm,
    },
  })
  wrapper.element.querySelector('.add-participant-item').click()
  await nextTick()
  ports.contactService.currentContacts.find((contact) => contact.number === '3000').status =
    'offline'
  await nextTick()
  wrapper.element.querySelector('.btn-add-confirm').click()
  expect(confirm).not.toHaveBeenCalled()
})

it('CallsView nối bàn phím với call service và tự xóa ô nhập sau khi gửi lệnh', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/calls', component: { template: '<div />' } },
      { path: '/messages', component: { template: '<div />' } },
    ],
  })
  await router.push('/calls')
  await router.isReady()
  wrapper = mountComponent(CallsView, { plugins: [router] })
  await flushUi()
  wrapper.state.extension = '2000'
  await nextTick()
  wrapper.element.querySelector('.btn-dial').click()
  await flushUi()
  expect(ports.callService.startCall).toHaveBeenCalledWith('2000')
  expect(wrapper.state.extension).toBe('')
  expect(wrapper.element.querySelector('.contacts-col')).not.toBeNull()
})

it('khung gọi nhóm không báo đang kết nối cho nhánh đã nghe máy', () => {
  const state = group()
  state.isGroupCall = true
  state.secondaryCallSessions.set('3000', { answered: true })
  state.secondaryCallSessions.set('5000', { answered: false })
  state.groupConnectedExtensions = ['1000', '2000', '3000']
  state.groupPendingExtensions = ['5000']
  wrapper = mountComponent(ActiveCallPanel, {
    props: {
      call: { number: '2000', status: 'connected', isGroupCall: true },
      group: state,
      contacts: contacts(),
      recording: { isRecording: false, duration: 0 },
    },
  })
  const pending = wrapper.element.querySelector('.group-pending-summary-text').textContent
  expect(pending).toContain('5000')
  expect(pending).not.toContain('3000')
})

it('bấm phím cập nhật số trước tiếng phản hồi cục bộ, không chờ âm thanh', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/calls', component: { template: '<div />' } }],
  })
  await router.push('/calls')
  await router.isReady()
  wrapper = mountComponent(CallsView, { plugins: [router] })
  await flushUi()
  callToneService.playDtmfTone.mockImplementation(() => {
    expect(wrapper.state.extension).toBe('1')
  })
  wrapper.element.querySelector('.key-btn').click()
  await nextTick()
  expect(wrapper.state.extension).toBe('1')
  expect(callToneService.playDtmfTone).toHaveBeenCalledWith('1')
})
