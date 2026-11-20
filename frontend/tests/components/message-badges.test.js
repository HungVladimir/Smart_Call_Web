import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { h, KeepAlive, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createFixture, disposeFixture } from '../helpers/createFixture.js'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'
import { ChatService } from '../../src/services/data/chatService.js'
const ports = vi.hoisted(() => ({
  chatService: null,
  authService: null,
  contactService: null,
  groupCallService: null,
}))
vi.mock('@/services/index.js', () => ports)
import AppSidebar from '../../src/components/layout/AppSidebar.vue'
import MessagesView from '../../src/views/MessagesView.vue'
let app, wrapper, router
beforeEach(async () => {
  app = createFixture()
  Object.assign(ports, app)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  app.chatService.rooms = [
    { id: 'r', title: 'Hội thoại', isDirect: true, members: [], messages: [] },
  ]
  vi.spyOn(app.chatService, 'getRooms').mockImplementation(async () => app.chatService.rooms)
  vi.spyOn(app.chatService, 'getRoomMessages').mockImplementation(
    async (id) => app.chatService.rooms.find((r) => r.id === id)?.messages || [],
  )
  router = createRouter({
    history: createMemoryHistory(),
    routes: ['/messages', '/calls'].map((path) => ({ path, component: { template: '<div />' } })),
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  disposeFixture(app)
})
/** Mount menu và MessagesView thật trong KeepAlive để kiểm tra lifecycle và số hiển thị cùng nhau. */
async function mountShell(path = '/messages') {
  await router.push(path)
  await router.isReady()
  const Root = {
    render: () =>
      h('main', [
        h(AppSidebar),
        h(KeepAlive, null, {
          default: () =>
            router.currentRoute.value.path === '/messages' ? h(MessagesView) : h('div'),
        }),
      ]),
  }
  wrapper = mountComponent(Root, { plugins: [router] })
  await flushUi()
}
/** Tin từ user khác đi qua đúng service đang được giao diện sử dụng. */
function receive(id) {
  ports.chatService.handleIncomingMessage({
    uuid: id,
    room_uuid: 'r',
    user_uuid: 'peer',
    content: 'Tin mới',
    created_at: '2026-11-20T02:00:00Z',
  })
}
/** Lấy cả badge tổng và từng hội thoại để phát hiện lệch số giữa hai nơi. */
function badges() {
  return [...wrapper.element.querySelectorAll('.unread-badge, .room-unread-badge')].map((node) =>
    node.textContent.trim(),
  )
}

it('hai badge cùng đếm; chọn phòng, KeepAlive và focus xóa đúng số', async () => {
  await mountShell()
  receive('one')
  await nextTick()
  expect(badges()).toEqual(['1', '1'])
  wrapper.element.querySelector('.room-item').click()
  await flushUi()
  expect(badges()).toEqual([])
  await router.push('/calls')
  await flushUi()
  receive('away')
  await nextTick()
  expect(badges()).toEqual(['1'])
  await router.push('/messages')
  await flushUi()
  expect(badges()).toEqual([])
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  receive('hidden')
  await nextTick()
  expect(badges()).toEqual(['1', '1'])
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  window.dispatchEvent(new Event('focus'))
  await nextTick()
  expect(badges()).toEqual([])
})

it('Sidebar tự hiển thị số đã lưu sau reload dù đang ở trang gọi', async () => {
  receive('cached')
  const fresh = new ChatService({
    authService: app.authService,
    contactService: app.contactService,
    eventHub: { on: vi.fn() },
  })
  fresh.getRooms = vi.fn(async () => {
    fresh.rooms = [{ id: 'r', title: 'Hội thoại', isDirect: true, members: [], messages: [] }]
    return fresh.rooms
  })
  ports.chatService = fresh
  await mountShell('/calls')
  expect(fresh.getRooms).toHaveBeenCalledTimes(1)
  expect(badges()).toEqual(['1'])
})
