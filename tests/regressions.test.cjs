const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { reactive, shallowReactive, ref, computed } = require('vue')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const noop = () => {}
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => '', blob: async () => ({ size: 1 }) })

// Execute application logic with browser/SDK/network boundaries replaced, never the real SDK.
function fixture() {
  const values = new Map([['smartcall_user_uuid', 'a'], ['smartcall_wazo_token', 'fixture']])
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }
  const events = [], timers = new Map(), hooks = { mounted: [], activated: [], deactivated: [], unmounted: [] }
  const listeners = new Map()
  let timerId = 0
  const phone = { on: noop, off: noop, eventEmitter: { removeAllListeners: noop }, disconnect: async () => {}, hangup: async () => {}, accept: async () => 'sip', call: async () => ({ sipCallId: 's' }), getRemoteStream: () => null }
  for (const name of ['REGISTERED', 'UNREGISTERED', 'PROGRESS', 'CALL_INCOMING', 'CALL_ACCEPTED', 'CALL_ENDED', 'CALL_FAILED', 'CALL_REJECTED', 'CALL_CANCELED']) phone['ON_' + name] = name
  const logger = new Proxy({}, { get: (target, key) => target[key] || noop })
  const c = vm.createContext({
    console, reactive, shallowReactive, ref, computed, localStorage: storage, sessionStorage: storage,
    AbortController, AbortSignal, crypto: require('node:crypto').webcrypto, URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: noop },
    logger, audioService: new Proxy({}, { get: () => noop }),
    historyService: { addRecord: noop, reset: noop, reload: noop, getLocalHistory: () => [] },
    recordService: { isRecording: () => false, cancelPendingStart: noop, clearSessionCache: noop },
    contactService: { currentContacts: [{}], findContactByExtension: () => null, findContactByUuid: () => null, reset: noop },
    chatService: { reset: noop, setVisibleRoom: noop, getUnreadCount: () => 0, totalUnread: 0 }, websocketService: { on: noop, emit: noop }, Wazo: { Phone: phone, Auth: { init: noop, setClientId: noop, setHost: noop, logout: async () => {} } },
    document: { getElementById: () => null, querySelectorAll: () => [], visibilityState: 'visible', hasFocus: () => true, addEventListener: noop, removeEventListener: noop }, navigator: {},
    window: {
      dispatchEvent: (e) => { events.push(e); for (const listener of listeners.get(e.type) || []) listener(e); return true },
      addEventListener: (type, listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener) },
      removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options) } },
    setTimeout: (cb) => { timers.set(++timerId, cb); return timerId }, clearTimeout: (id) => timers.delete(id),
    setInterval: (cb) => { timers.set(++timerId, cb); return timerId }, clearInterval: (id) => timers.delete(id),
    fetch: async () => { throw new Error('Unexpected network request') },
    wazoService: { getToken: () => storage.getItem('smartcall_wazo_token'), getMyUserUuid: () => storage.getItem('smartcall_user_uuid'), getMyExtension: () => '', getMyUserName: () => 'Fixture', host: 'fixture.invalid', getHostUrl: () => 'https://fixture.invalid', applyAudioDevices: async () => {} },
    callStore: reactive({}), recordStore: reactive({}),
    useRouter: () => ({ push: noop, replace: async () => {} }), useRoute: () => ({ path: '/messages', query: {} }),
    defineProps: () => ({ isOpen: true }), defineEmits: () => noop, watch: noop, nextTick: (fn) => fn?.(),
    onMounted: (fn) => hooks.mounted.push(fn), onActivated: (fn) => hooks.activated.push(fn), onDeactivated: (fn) => hooks.deactivated.push(fn), onUnmounted: (fn) => hooks.unmounted.push(fn),
    getFeatures: () => ({}), saveFeatures: noop, resetFeatures: () => ({}), formatMessageDateTime: () => 'fixture',
    requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  })
  vm.runInContext(read('src/services/sessionScope.js').replace(/^export /gm, ''), c)
  c.events = events; c.timers = timers; c.hooks = hooks
  return c
}

function service(c, name, expose) {
  const source = read('src/services/' + name + '.js').replace(/^import .*$/gm, '').replace(/^export /gm, '').replace(/import\.meta\.env\.VITE_WAZO_HOST/g, "'fixture.invalid'")
  vm.runInContext(source + '\n' + expose, c, { filename: name })
  return c
}
function view(c, file, expose) {
  const source = read(file).split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  vm.runInContext(source + '\n' + expose, c, { filename: file })
  return c
}
const chat = () => service(fixture(), 'chatService', 'globalThis.svc = chatService')
const wazo = () => service(fixture(), 'wazo', 'globalThis.svc = wazoService; globalThis.state = callStore')

test('Keypad: lần đầu không mở AudioContext; âm phát bất đồng bộ, cache WAV và cleanup được', async () => {
  const c = fixture(), pending = deferred(); let audioContexts = 0, audioElements = 0, urls = 0, pauses = 0
  c.window.AudioContext = class { constructor() { audioContexts++; throw new Error('Cold audio driver') } }
  c.Blob = Blob; c.URL.createObjectURL = () => 'blob:tone-' + ++urls
  c.Audio = class { constructor() { audioElements++ } pause() { pauses++ } play() { return pending.promise } }
  service(c, 'audioService', 'globalThis.svc = audioService')
  c.svc.playDtmfTone('1'); c.svc.playDtmfTone('1'); c.svc.playDtmfTone('2')
  assert.equal(audioContexts, 0); assert.equal(audioElements, 1); assert.equal(urls, 2)
  c.svc.stopAllTones(); assert.equal(c.svc.dtmfAudio.currentTime, 0); assert.ok(pauses >= 4)
  pending.reject(new Error('Autoplay blocked')); await drain()
})

test('Keypad: số và DTMF tổng đài được cập nhật trước âm phản hồi cục bộ', () => {
  const c = fixture(), observed = []
  c.wazoService.sendDTMF = (key) => observed.push('sip:' + key)
  c.audioService = { playDtmfTone: (key) => observed.push('tone:' + key + ':' + c.number.value) }
  view(c, 'src/views/CallsView.vue', 'globalThis.press = pressKey; globalThis.number = extension; globalThis.dtmf = dtmfLog')
  c.press('1'); assert.equal(c.number.value, '1'); assert.deepEqual(observed, ['tone:1:1'])
  c.callStore.activeCall = { number: 'peer' }; c.press('2')
  assert.equal(c.number.value, '1'); assert.equal(c.dtmf.value, '2')
  assert.deepEqual(observed.slice(1), ['sip:2', 'tone:2:1'])
})

test('Keypad: phát âm bị lỗi không chặn nhập số và không chạm AudioContext', () => {
  const c = fixture(); c.Blob = Blob; c.Audio = class { constructor() { throw new Error('No audio output') } }
  service(c, 'audioService', 'globalThis.svc = audioService')
  view(c, 'src/views/CallsView.vue', 'globalThis.press = pressKey; globalThis.number = extension')
  c.press('1'); c.press('2'); assert.equal(c.number.value, '12')
})

/** Phòng được server xác minh; event kiểm thử dùng cùng schema WebSocket của Web/Mobile. */
function unreadFixture() {
  const c = chat()
  c.svc.rooms = [{ id: 'r', title: 'Hội thoại', isDirect: true, members: [], messages: [] }, { id: 'other', title: 'Hội thoại khác', isDirect: true, members: [], messages: [] }]
  c.receive = (id, room = 'r', sender = 'peer') => c.svc.handleIncomingMessage({ uuid: id, room_uuid: room, user_uuid: sender, content: 'Tin ' + id, created_at: '2026-11-20T02:00:00Z' })
  return c
}

test('Badge: tin Web/Mobile cùng UUID chỉ đếm một lần, tổng bằng tổng từng hội thoại', () => {
  const c = unreadFixture(), total = computed(() => c.svc.totalUnread)
  assert.equal(total.value, 0); c.receive('web')
  c.svc.handleIncomingMessage({ uuid: 'envelope', message: { uuid: 'mobile', room: { uuid: 'r' }, sender_uuid: 'peer', content: 'Mobile', created_at: '2026-11-20T02:01:00Z' } })
  c.svc.handleIncomingMessage({ uuid: 'mobile', room: { uuid: 'r' }, user_uuid: 'peer', content: 'Mobile' })
  c.receive('third', 'other')
  assert.equal(c.svc.getUnreadCount('r'), 2); assert.equal(c.svc.getUnreadCount('other'), 1); assert.equal(total.value, 3)
  c.svc.setVisibleRoom('r'); assert.equal(total.value, 1)
  c.receive('web'); assert.equal(c.svc.getUnreadCount('r'), 0)
})

test('Badge: tự gửi/echo từ tài khoản của mình và lệnh quản trị không tăng số', () => {
  const c = unreadFixture()
  c.receive('self', 'r', 'a')
  c.svc.rooms.push({ id: 'group', isDirect: false, adminUuid: 'admin', adminVerified: true, messages: [] })
  c.svc.handleIncomingMessage({ uuid: 'rename', room_uuid: 'group', user_uuid: 'admin', content: '[SYSTEM:ROOM_RENAME:title="Mới"]' })
  c.svc.handleIncomingMessage({ uuid: 'unknown', room_uuid: 'r', content: 'Không có sender UUID' })
  assert.equal(c.svc.totalUnread, 0)
})

test('Badge: phòng đang xem không đếm; tab ẩn hoặc cửa sổ mất focus vẫn nhận số', () => {
  const c = unreadFixture(); c.svc.setVisibleRoom('r'); c.receive('visible')
  assert.equal(c.svc.getUnreadCount('r'), 0)
  c.document.visibilityState = 'hidden'; c.receive('hidden'); assert.equal(c.svc.getUnreadCount('r'), 1)
  c.document.visibilityState = 'visible'; c.document.hasFocus = () => false
  c.svc.setVisibleRoom('r'); c.receive('blurred'); assert.equal(c.svc.getUnreadCount('r'), 2)
  c.document.hasFocus = () => true; c.svc.setVisibleRoom('r'); assert.equal(c.svc.getUnreadCount('r'), 0)
  c.svc.setVisibleRoom(null); c.receive('away'); assert.equal(c.svc.getUnreadCount('r'), 1)
})

test('Badge: REST đã tải tin trước callback WebSocket vẫn đếm đúng, refresh không làm mất số', async () => {
  const c = unreadFixture()
  c.svc.rooms[0].messages.push({ id: 'already-fetched', text: 'Đã nằm trong REST' })
  c.receive('already-fetched'); assert.equal(c.svc.getUnreadCount('r'), 1)
  c.fetch = async () => response({ items: [{ uuid: 'r', users: ['a', 'peer'] }, { uuid: 'other', users: ['a', 'peer'] }] })
  await c.svc.getRooms(); assert.equal(c.svc.getUnreadCount('r'), 1)
  c.receive('already-fetched'); assert.equal(c.svc.getUnreadCount('r'), 1)
})

test('Badge: phòng mới được REST tải kèm tin trước khi phát lại event vẫn có badge', async () => {
  const c = chat()
  c.fetch = async (url) => url.endsWith('/rooms')
    ? response({ items: [{ uuid: 'new', users: ['a', 'peer'] }] })
    : response({ items: [{ uuid: 'incoming', user_uuid: 'peer', content: 'Tin mới', created_at: '2026-11-20T02:00:00Z' }] })
  c.svc.handleIncomingMessage({ uuid: 'incoming', room_uuid: 'new', user_uuid: 'peer', content: 'Tin mới' })
  await drain(); assert.equal(c.svc.getUnreadCount('new'), 1); assert.equal(c.svc.totalUnread, 1)
})

test('Badge: xóa tin/đóng phòng/reset dọn số; không lẫn tài khoản sau logout', () => {
  const c = unreadFixture()
  c.svc.rooms[0].isDirect = false; c.svc.rooms[0].adminUuid = 'admin'; c.svc.rooms[0].adminVerified = true
  c.receive('one'); c.receive('two')
  c.svc.handleIncomingMessage({ uuid: 'delete', room_uuid: 'r', user_uuid: 'admin', content: '[SYSTEM:MSG_DELETED:ids="one"]' })
  assert.equal(c.svc.getUnreadCount('r'), 1)
  c.svc.handleIncomingMessage({ uuid: 'close', room_uuid: 'r', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' })
  assert.equal(c.svc.totalUnread, 0)
  c.receive('three', 'other'); assert.equal(c.svc.totalUnread, 1)
  c.svc.reset(); assert.equal(c.svc.totalUnread, 0)
  c.svc.rooms = [{ id: 'other', isDirect: true, messages: [] }]
  c.localStorage.setItem('smartcall_user_uuid', 'b'); c.receive('three', 'other')
  assert.equal(c.svc.getUnreadCount('other'), 1)
})

test('Badge: callback nạp phòng đến sau logout không khôi phục bộ đếm', async () => {
  const c = chat(), pending = deferred()
  c.fetch = () => pending.promise
  c.svc.handleIncomingMessage({ uuid: 'old', room_uuid: 'private', user_uuid: 'peer', content: 'Phiên cũ' })
  c.svc.reset(); pending.resolve(response({ items: [{ uuid: 'private', users: ['a', 'peer'] }] }))
  await drain(); assert.equal(c.svc.totalUnread, 0); assert.equal(c.svc.getUnreadCount('private'), 0)
})

test('Badge lưu tạm: tải lại Web giữ số và khử trùng; mở phòng rồi tải lại không tăng lại', async () => {
  const first = unreadFixture(); first.receive('one'); first.receive('two')
  const key = first.svc._unreadStorageKey, raw = first.localStorage.getItem(key)
  assert.ok(raw); assert.equal(raw.includes('Tin one'), false); assert.equal(raw.includes('content'), false); assert.equal(raw.includes('token'), false)
  const reloaded = unreadFixture(); reloaded.localStorage.setItem(key, raw)
  reloaded.svc.getRooms = async () => [...reloaded.svc.rooms]
  await reloaded.svc.restoreUnreadNotifications()
  assert.equal(reloaded.svc.getUnreadCount('r'), 2)
  reloaded.receive('one'); assert.equal(reloaded.svc.getUnreadCount('r'), 2)
  reloaded.svc.setVisibleRoom('r')
  const third = unreadFixture(); third.localStorage.setItem(key, reloaded.localStorage.getItem(key))
  await third.svc.restoreUnreadNotifications(); third.receive('one')
  assert.equal(third.svc.totalUnread, 0)
})

test('Badge lưu tạm: reset giữ cache tài khoản A; B hoặc máy chủ khác không dùng chung số', async () => {
  const c = unreadFixture(); c.receive('one')
  const keyA = c.svc._unreadStorageKey
  c.svc.reset(); assert.ok(c.localStorage.getItem(keyA))
  c.localStorage.setItem('smartcall_user_uuid', 'b')
  c.svc.getRooms = async () => { c.svc.rooms = [{ id: 'r', messages: [] }]; return c.svc.rooms }
  await c.svc.restoreUnreadNotifications(); assert.equal(c.svc.getUnreadCount('r'), 0)
  c.localStorage.setItem('smartcall_user_uuid', 'a')
  await c.svc.restoreUnreadNotifications(); assert.equal(c.svc.getUnreadCount('r'), 1)
  c.wazoService.getHostUrl = () => 'https://another.invalid'
  await c.svc.restoreUnreadNotifications(); assert.equal(c.svc.getUnreadCount('r'), 0)
  assert.ok(c.localStorage.getItem(keyA))
})

test('Badge lưu tạm: Sidebar tự nạp lại phòng thật khi có số đã lưu, không đòi mở trang Tin nhắn', async () => {
  const first = unreadFixture(); first.receive('one')
  const c = chat(), key = first.svc._unreadStorageKey; c.localStorage.setItem(key, first.localStorage.getItem(key))
  c.getFeatures = () => ({ messages: true })
  let requests = 0
  c.svc.getRooms = async () => { requests++; c.svc.rooms = [{ id: 'r', title: 'Hội thoại', messages: [] }]; return c.svc.rooms }
  view(c, 'src/components/layout/AppSidebar.vue', 'globalThis.badge = totalUnread')
  c.hooks.mounted[0](); await drain()
  assert.equal(requests, 1); assert.equal(c.badge.value, 1)
})

test('Badge lưu tạm: cache hỏng/không hỗ trợ được bỏ qua, storage đầy vẫn nhận và đếm tin', async () => {
  const first = unreadFixture(); first.receive('one'); const key = first.svc._unreadStorageKey
  const c = unreadFixture(); c.localStorage.setItem(key, 'not-json')
  await c.svc.restoreUnreadNotifications(); assert.equal(c.svc.totalUnread, 0)
  c.localStorage.setItem = () => { throw new Error('QuotaExceededError') }
  c.receive('new'); assert.equal(c.svc.getUnreadCount('r'), 1)
})

test('Badge lưu tạm: xóa tin và đóng phòng cũng cập nhật cache bền qua reload', async () => {
  const c = unreadFixture(); c.svc.rooms[0].isDirect = false; c.svc.rooms[0].adminUuid = 'admin'; c.svc.rooms[0].adminVerified = true
  c.receive('one'); c.receive('two')
  c.svc.handleIncomingMessage({ uuid: 'delete', room_uuid: 'r', user_uuid: 'admin', content: '[SYSTEM:MSG_DELETED:ids="one"]' })
  const key = c.svc._unreadStorageKey
  assert.equal(JSON.parse(c.localStorage.getItem(key)).rooms.r.unread.length, 1)
  c.svc.handleIncomingMessage({ uuid: 'close', room_uuid: 'r', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' })
  assert.equal(JSON.parse(c.localStorage.getItem(key)).rooms.r, undefined)
  const reloaded = unreadFixture(); reloaded.localStorage.setItem(key, c.localStorage.getItem(key))
  await reloaded.svc.restoreUnreadNotifications(); assert.equal(reloaded.svc.totalUnread, 0)
})

test('Badge Vue thật: menu và hội thoại cùng đếm; chọn phòng, KeepAlive và focus xóa đúng số', async () => {
  const Vue = require('vue'), { parse, compileScript } = require('@vue/compiler-sfc'), c = unreadFixture()
  c.Vue = Vue; c.getFeatures = () => ({ calls: true, messages: true, history: true })
  c.routeState = Vue.reactive({ path: '/messages', query: {} }); c.useRoute = () => c.routeState
  c.svc.getRooms = async () => [...c.svc.rooms]; c.svc.getRoomMessages = async (id) => c.svc.rooms.find((r) => r.id === id)?.messages || []
  // Compile nguyên component và template; chỉ thay ranh giới router/DOM, không thay logic badge/lifecycle.
  const compile = (file) => {
    const { descriptor } = parse(read(file))
    const script = compileScript(descriptor, { id: 'badge-test', inlineTemplate: true }).content
      .replace(/import \{([^}]+)\} from ['"]vue['"]/g, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`)
      .replace(/^import .*$/gm, '').replace('export default', 'return')
    return vm.runInContext('(function(){' + script + '\n})()', c)
  }
  const Sidebar = compile('src/components/layout/AppSidebar.vue'), Messages = compile('src/views/MessagesView.vue')
  const make = (type, text = '') => ({ type, tagName: type.toUpperCase(), text, props: {}, style: {}, children: [], parent: null, addEventListener: noop, removeEventListener: noop, getRootNode() { let n = this; while (n.parent) n = n.parent; return n } })
  const renderer = Vue.createRenderer({
    createElement: (type) => make(type), createText: (text) => make('text', text), createComment: (text) => make('comment', text),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insert(node, parent, anchor = null) { if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1) }; const i = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(i < 0 ? parent.children.length : i, 0, node); node.parent = parent },
    remove(node) { const i = node.parent?.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1); node.parent = null },
    patchProp: (node, key, _, value) => { node.props[key] = value },
  })
  const Root = { render: () => Vue.h('main', [Vue.h(Sidebar), Vue.h(Vue.KeepAlive, null, { default: () => c.routeState.path === '/messages' ? Vue.h(Messages) : Vue.h('empty') })]) }
  const root = make('root'), app = renderer.createApp(Root)
  app.component('RouterLink', { setup: (_, { slots }) => () => Vue.h('a', slots.default?.()) })
  app.mount(root); await drain(); await Vue.nextTick()
  const nodes = (node) => [node, ...node.children.flatMap(nodes)]
  const badges = () => nodes(root).filter((node) => /(?:^|\s)(?:unread-badge|room-unread-badge)(?:\s|$)/.test(node.props.class || '')).map((node) => String(node.text))
  try {
    c.receive('first'); await Vue.nextTick(); assert.deepEqual(badges(), ['1', '1'])
    const room = nodes(root).find((node) => /(?:^|\s)room-item(?:\s|$)/.test(node.props.class || ''))
    await room.props.onClick(); await Vue.nextTick(); assert.deepEqual(badges(), [])
    c.routeState.path = '/calls'; await Vue.nextTick(); c.receive('while-away'); await Vue.nextTick()
    assert.deepEqual(badges(), ['1'])
    c.routeState.path = '/messages'; await drain(); await Vue.nextTick(); assert.deepEqual(badges(), [])
    c.document.visibilityState = 'hidden'; c.receive('hidden'); await Vue.nextTick(); assert.deepEqual(badges(), ['1', '1'])
    c.document.visibilityState = 'visible'; c.window.dispatchEvent({ type: 'focus' }); await Vue.nextTick(); assert.deepEqual(badges(), [])
    c.receive('currently-visible'); await Vue.nextTick(); assert.deepEqual(badges(), [])
  } finally { app.unmount() }
})

test('SEC-002: response from A cannot repopulate rooms after reset/login B', async () => {
  const c = chat(), pending = deferred()
  c.fetch = () => pending.promise
  const request = c.svc.getRooms()
  c.svc.reset(); c.localStorage.setItem('smartcall_user_uuid', 'b')
  pending.resolve(response({ items: [{ uuid: 'private-a', users: ['a', 'other'] }] }))
  await request
  assert.equal(c.svc.rooms.length, 0)
})

test('SEC-001: ordinary sender cannot close room; verified admin can', () => {
  const c = chat()
  c.svc.rooms = [{ id: 'r', adminUuid: 'admin', adminVerified: true, isDirect: false, messages: [] }]
  c.svc.handleIncomingMessage({ room_uuid: 'r', user_uuid: 'ordinary', content: '[SYSTEM:ROOM_CLOSED]' })
  assert.equal(c.svc.rooms.length, 1)
  c.svc.handleIncomingMessage({ room_uuid: 'r', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' })
  assert.equal(c.svc.rooms.length, 0)
  const v = view(fixture(), 'src/views/MessagesView.vue', 'globalThis.room = currentRoom; globalThis.admin = currentIsAdmin')
  v.localStorage.setItem('smartcall_is_admin', 'true'); v.room.value = { id: 'r', adminUuid: 'a' }
  assert.equal(v.admin.value, false)
  v.room.value.adminVerified = true; assert.equal(v.admin.value, true)
})

test('BUG-001: save audio before loading services sends no Confd writes', async () => {
  const c = fixture(), requests = []
  c.fetch = async (url) => { requests.push(url); return response({}) }
  view(c, 'src/components/common/SettingsModal.vue', 'globalThis.save = handleSave')
  await c.save()
  assert.equal(requests.length, 0)
})

test('BUG-001: loaded but unchanged services are not rewritten; HTTP500 is failure', async () => {
  const c = fixture(), writes = []
  c.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') { writes.push(JSON.parse(options.body)); return response({}, 500) }
    return response(url.endsWith('/dnd') ? { enabled: true } : { busy: { enabled: true, destination: '4321' } })
  }
  view(c, 'src/components/common/SettingsModal.vue', 'globalThis.load = loadCallServices; globalThis.save = handleSave; globalThis.dnd = dndEnabled')
  await c.load(); await c.save()
  assert.equal(writes.length, 0)
  c.dnd.value = false
  await c.save()
  assert.deepEqual(writes, [{ enabled: false }])
  assert.equal(c.events.at(-1).detail.type, 'error')
})

test('BUG-002: rejected answer never becomes connected', async () => {
  const c = wazo()
  c.state.incomingCall = { number: 'peer', session: { id: 's' } }
  c.Wazo.Phone.accept = async () => { throw new Error('mic denied') }
  assert.equal(await c.svc.acceptIncomingCall(), false)
  assert.equal(c.state.activeCall, null)
})

test('BUG-003: late conference response is cleaned after hangup', async () => {
  const c = wazo(), pending = deferred(), started = deferred(), deleted = []
  c.svc.isGroupCall = c.svc.isGroupHost = true
  c.svc.currentCallSession = { sipCallId: 's' }
  c.state.activeCall = { number: 'peer', status: 'connected' }
  c.svc.extensionToWazoCallIdMap.set('x', 'px'); c.svc.extensionToWazoCallIdMap.set('y', 'py')
  c.svc.getMyActiveCalls = async () => [{ id: 'host', sip_call_id: 's', talking_to: {} }]
  c.svc.createAdhocConference = () => { started.resolve(); return pending.promise }
  c.svc.deleteAdhocConference = async (id) => deleted.push(id)
  const request = c.svc._doSyncActiveCallsToAdhocConference()
  await started.promise
  c.svc._finalizeCallTermination('ended', null, true)
  pending.resolve('late-conf'); await request
  assert.equal(c.svc.activeAdhocConferenceId, '')
  assert.deepEqual(deleted, ['late-conf'])
})

test('BUG-004: failed merge remains retryable', async () => {
  const c = wazo(); let attempts = 0
  c.svc.isGroupCall = c.svc.isGroupHost = true; c.svc.activeAdhocConferenceId = 'conf'
  c.svc.currentCallSession = { sipCallId: 's' }; c.state.activeCall = { number: 'peer', status: 'connected' }
  c.svc.extensionToWazoCallIdMap.set('member', 'p')
  c.svc.getMyActiveCalls = async () => [{ id: 'host', sip_call_id: 's', talking_to: {} }]
  c.svc.addParticipantToAdhocConference = async () => ++attempts > 1
  await c.svc._doSyncActiveCallsToAdhocConference(); assert.equal(c.svc.mergedCallIds.has('p'), false)
  await c.svc._doSyncActiveCallsToAdhocConference(); assert.equal(c.svc.mergedCallIds.has('p'), true)
})

test('BUG-005/010: secondary starts clock; progress preserves connected; dialing is reactive', () => {
  const c = wazo(); c.svc.attachListeners(); c.svc.isGroupCall = c.svc.isGroupHost = true
  const primary = { sipCallId: 'p' }, secondary = { sipCallId: 's' }
  c.svc.currentCallSession = primary; c.svc.secondaryCallSessions.set('member', secondary)
  c.state.activeCall = { number: 'peer', session: primary, status: 'ringing', startTime: null, duration: 0 }
  c.svc.syncActiveCallsToAdhocConference = noop
  c.svc._onCallAcceptedHandler(secondary); c.svc._onProgressHandler(primary)
  assert.equal(c.state.activeCall.status, 'connected'); assert.ok(c.state.activeCall.startTime); assert.ok(c.svc._durationInterval)
  const dialing = computed(() => c.svc._isDialing)
  assert.equal(dialing.value, false); c.svc._isDialing = true; assert.equal(dialing.value, true)
  c.svc._finalizeCallTermination('ended', null, true)
  c.svc._onCallAcceptedHandler(secondary)
  assert.equal(c.state.activeCall, null)
})

test('BUG-006: stop HTTP500 rejects and retains recording for retry', async () => {
  const c = service(fixture(), 'recordService', 'globalThis.svc = recordService; globalThis.state = recordStore')
  c.state.isRecording = true; c.state.currentCallId = 'call'; c.fetch = async () => response({}, 500)
  await assert.rejects(c.svc.stopRecording())
  assert.equal(c.state.isRecording, true); assert.equal(c.state.currentCallId, 'call'); assert.equal(c.state.isStopping, false)
  c.fetch = async () => response({}, 204); await c.svc.stopRecording(); assert.equal(c.state.isRecording, false)
})

test('BUG-007: failed room command does not report deletion', async () => {
  const c = chat(); c.fetch = async () => response({}, 500)
  c.svc.rooms = [{ id: 'r', adminUuid: 'a', adminVerified: true, isDirect: false, messages: [] }]
  await assert.rejects(c.svc.deleteRoom('r'))
  assert.equal(c.svc.rooms.length, 1)
})

test('BUG-011: reverse audio responses only play latest recording', async () => {
  const c = fixture(), pending = {}, played = []
  c.recordService.getAudioUrlForCall = (call) => { pending[call.id] = deferred(); return pending[call.id].promise }
  c.Audio = class { constructor(url) { this.url = url } async play() { played.push(this.url) } pause() {} removeAttribute() {} load() {} }
  view(c, 'src/views/HistoryView.vue', 'globalThis.play = togglePlayCall; globalThis.stop = stopCurrentAudio')
  const a = c.play({ id: 'a' }), b = c.play({ id: 'b' })
  pending.b.resolve('audio-b'); await b; pending.a.resolve('audio-a'); await a
  assert.deepEqual(played, ['audio-b'])
  const late = c.play({ id: 'c' }); c.stop(); pending.c.resolve('audio-c'); await late
  assert.deepEqual(played, ['audio-b'])
})

test('BUG-012: outbound declined is not a missed call', () => {
  const c = view(fixture(), 'src/views/HistoryView.vue', 'globalThis.state = { calls, currentTab, counts, filteredCalls }')
  c.state.calls.value = [{ direction: 'outbound', status: 'declined', answered: false }]
  c.state.currentTab.value = 'missed'
  assert.equal(c.state.counts.value.missed, 0); assert.equal(c.state.filteredCalls.value.length, 0)
})

test('BUG-013: sending in A does not reselect A after choosing B', async () => {
  const c = fixture(), pending = deferred()
  c.chatService = { rooms: [{ id: 'a', messages: [] }, { id: 'b', messages: [] }], sendMessage: () => pending.promise, getRooms: async () => c.chatService.rooms }
  view(c, 'src/views/MessagesView.vue', 'globalThis.state = { currentRoom, inputText, rooms }; globalThis.send = sendMessage')
  c.state.rooms.value = c.chatService.rooms; c.state.currentRoom.value = c.chatService.rooms[0]; c.state.inputText.value = 'fixture'
  const sending = c.send(); c.state.currentRoom.value = c.chatService.rooms[1]
  pending.resolve({ id: 'm' }); await sending
  assert.equal(c.state.currentRoom.value.id, 'b')
})

test('BUG-014: trusted closed room stays hidden on cold load', async () => {
  const c = chat()
  c.fetch = async (url) => response(url.includes('/messages?') ? { items: [{ uuid: 'm', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]', created_at: '2026-11-19T00:00:00Z' }] } : { items: [{ uuid: 'r', name: 'Group', creator_uuid: 'admin', users: ['a', 'b', 'c'] }] })
  assert.equal((await c.svc.getRooms()).length, 0)
})

test('BUG-015: mic resolving after close is stopped', async () => {
  const c = fixture(), pending = deferred(); let stopped = 0
  c.navigator.mediaDevices = { getUserMedia: () => pending.promise }
  view(c, 'src/components/common/SettingsModal.vue', 'globalThis.start = startMicMeter; globalThis.stop = stopMicMeter')
  const starting = c.start(); c.stop(); pending.resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await starting
  assert.equal(stopped, 1)
})

test('LOGIC-002: no destructive membership migration', async () => {
  const c = chat(); c.svc.rooms = [{ id: 'r', messages: [] }]
  await assert.rejects(c.svc.removeMemberFromGroup('r', 'other'))
  await assert.rejects(c.svc.addMembersToGroup('r', ['a', 'b', 'c']))
  assert.equal(c.svc.rooms.length, 1)
})

test('SEC-002: session change while reading response body rejects stale payload', async () => {
  const c = fixture(), body = deferred()
  c.fetch = async () => ({ ...response({}), json: () => body.promise })
  const res = await vm.runInContext('createSessionFetch() ("fixture")', c)
  const reading = res.json()
  vm.runInContext('invalidateSession()', c); c.localStorage.setItem('smartcall_user_uuid', 'b')
  body.resolve({ secret: 'a' })
  await assert.rejects(reading, { name: 'StaleSessionError' })
})

test('SEC-002: stale contact lookup cannot create a fallback room for B', async () => {
  const c = chat(), pending = deferred()
  c.contactService.resolveUserUuid = () => pending.promise
  const opening = c.svc.getDirectRoom('4321', 'Fixture')
  c.svc.reset(); c.localStorage.setItem('smartcall_user_uuid', 'b')
  pending.resolve('peer-a')
  await assert.rejects(opening, { name: 'StaleSessionError' })
  assert.equal(c.svc.rooms.length, 0)
})

test('SEC-002: stale force-refresh failure does not clear B history', async () => {
  const c = service(fixture(), 'historyService', 'globalThis.svc = historyService'), pending = deferred()
  c.fetch = () => pending.promise
  const loading = c.svc.getHistory({ forceRefresh: true })
  c.svc.reset(); c.localStorage.setItem('smartcall_user_uuid', 'b'); c.svc.localHistory = [{ id: 'b' }]
  pending.resolve(response({ items: [] })); await loading
  assert.equal(c.svc.localHistory[0].id, 'b')
})

test('SEC-002: stale presence result cannot recommit A contacts', async () => {
  const c = service(fixture(), 'contactService', 'globalThis.svc = contactService'), pending = deferred(), entered = deferred()
  c.svc.fetchFavorites = async () => []
  c.fetch = async (url) => response(url.includes('/sources?') ? { items: [{ uuid: 'source' }] } : { items: [{ uuid: 'peer-a', exten: '4321' }] })
  c.svc.loadPresencesForContacts = (contacts) => { entered.resolve(); return pending.promise.then(() => contacts) }
  const loading = c.svc.getContacts(); await entered.promise
  c.svc.reset(); c.localStorage.setItem('smartcall_user_uuid', 'b')
  pending.resolve(); await loading
  assert.equal(c.svc.currentContacts.length, 0)
})

test('SEC-003: recording cache is scoped by owner and revoked at logout boundary', async () => {
  const c = service(fixture(), 'recordService', 'globalThis.svc = recordService'), revoked = []; let count = 0
  c.URL.createObjectURL = () => `blob:${++count}`; c.URL.revokeObjectURL = (url) => revoked.push(url)
  c.fetch = async () => response({})
  const call = { id: 'same-cdr', recordingUuid: 'same-recording' }
  assert.equal(await c.svc.getAudioUrlForCall(call), 'blob:1')
  c.localStorage.setItem('smartcall_user_uuid', 'b')
  assert.equal(await c.svc.getAudioUrlForCall(call), 'blob:2')
  c.svc.clearSessionCache()
  assert.deepEqual(revoked, ['blob:1', 'blob:2']); assert.equal(c.svc._blobUrls.size, 0)
  const w = wazo(); let logsCleared = 0, cacheCleared = 0
  w.logger.clearLogs = () => logsCleared++; w.recordService.clearSessionCache = () => cacheCleared++
  w.svc.setPresence = async () => {}; w.Wazo.Auth.logOut = noop; w.svc.logout()
  assert.equal(logsCleared, 1); assert.equal(cacheCleared, 1)
})

test('BUG-008: Confd extension is preserved when SDK has no primary number', async () => {
  const c = fixture()
  c.wazoService.login = async () => ({ profile: {}, displayName: () => 'Fixture' })
  c.wazoService.isPhoneRegistered = () => true
  c.fetch = async () => response({ uuid: 'a', lines: [{ extensions: [{ exten: '4321' }] }] })
  view(c, 'src/views/LoginView.vue', 'globalThis.login = handleLogin; globalThis.form = { username, password, errorMessage }')
  c.form.username.value = 'fixture'; c.form.password.value = 'fixture'; await c.login()
  assert.equal(c.localStorage.getItem('smartcall_extension'), '4321'); assert.equal(c.callStore.myExtension, '4321')
  assert.equal(c.form.errorMessage.value, '')
})

test('BUG-009: saved audio devices reach SDK constraints and output routing', async () => {
  const c = wazo(), applied = []
  c.localStorage.setItem('smartcall_selected_mic', 'mic-1'); c.localStorage.setItem('smartcall_selected_speaker', 'speaker-1')
  c.Wazo.Phone.phone = { setMediaConstraints: (media) => applied.push(media), changeAudioInputDevice: async (id) => applied.push(id), changeAudioDevice: async (id) => applied.push(id) }
  c.svc.hasActiveCall = () => true
  await c.svc.applyAudioDevices()
  assert.equal(applied[0].audio.deviceId.exact, 'mic-1'); assert.equal(applied[0].video, false)
  assert.deepEqual(applied.slice(1), ['mic-1', 'speaker-1'])
})

test('BUG-010: nested presence changes invalidate computed UI state', () => {
  const c = service(fixture(), 'contactService', 'globalThis.svc = contactService')
  const state = computed(() => c.svc.presences.peer?.state || 'offline')
  assert.equal(state.value, 'offline'); c.svc.presences.peer = { state: 'available' }; assert.equal(state.value, 'available')
})

test('call cancellation: late secondary session is hung up without restoring group', async () => {
  const c = wazo(), pending = deferred(), started = deferred(), hung = []
  c.state.activeCall = { callId: 'old', number: 'peer', status: 'connected' }
  c.svc.currentCallSession = {}; c.svc.isGroupCall = c.svc.isGroupHost = true
  c.contactService.isContactAvailableForCall = () => true
  c.svc.broadcastGroupStateViaPresence = noop; c.svc.broadcastNoticeToGroup = noop; c.svc.setPresence = async () => {}
  c.Wazo.Phone.call = () => { started.resolve(); return pending.promise }; c.Wazo.Phone.hangup = async (session) => hung.push(session)
  const inviting = c.svc.addParticipantsToGroupCall(['4321'])
  await started.promise
  c.svc._finalizeCallTermination('ended', null, true)
  const late = { sipCallId: 'late' }; pending.resolve(late); await inviting
  assert.equal(c.svc.secondaryCallSessions.size, 0); assert.equal(c.state.activeCall, null); assert.deepEqual(hung, [late])
})

test('recording cancellation: late start is stopped and never marked recording', async () => {
  const c = service(fixture(), 'recordService', 'globalThis.svc = recordService; globalThis.state = recordStore'), pending = deferred(), requests = []
  c.fetch = (url) => { requests.push(url); return url.endsWith('/start') ? pending.promise : Promise.resolve(response({}, 204)) }
  const starting = c.svc.startRecording('server-id')
  c.svc.cancelPendingStart(); pending.resolve(response({}, 204))
  assert.equal(await starting, false); assert.equal(c.state.isRecording, false); assert.equal(c.state.isStarting, false)
  assert.equal(requests.length, 2); assert.ok(requests[1].endsWith('/stop'))
})

test('recording stop: missing credentials reject cleanly and allow retry', async () => {
  const c = service(fixture(), 'recordService', 'globalThis.svc = recordService; globalThis.state = recordStore')
  c.state.isRecording = true; c.state.currentCallId = 'server-id'; c.localStorage.removeItem('smartcall_wazo_token')
  await assert.rejects(c.svc.stopRecording(), /Không có phiên/)
  assert.equal(c.state.isStopping, false); assert.equal(c.svc._stopPromise, null)
  c.localStorage.setItem('smartcall_wazo_token', 'fixture'); c.fetch = async () => response({}, 204)
  await c.svc.stopRecording(); assert.equal(c.state.isRecording, false)
})

const drain = () => new Promise((resolve) => setImmediate(resolve))

function groupFixture() {
  const c = wazo()
  c.svc.getMyExtension = () => '1000'
  c.state.activeCall = { number: '2000', status: 'connected', session: { sipCallId: 'current' } }
  c.svc.currentCallSession = c.state.activeCall.session
  c.contactService.currentContacts = [{ uuid: 'a', number: '1000' }, { uuid: 'peer', number: '2000' }, { uuid: 'member', number: '3000' }, { uuid: 'outsider', number: '9000' }]
  c.contactService.findContactByUuid = (uuid) => c.contactService.currentContacts.find((item) => item.uuid === uuid)
  c.contactService.findContactByExtension = (extension) => c.contactService.currentContacts.find((item) => item.number === String(extension).split('@')[0])
  c.svc.isGroupCall = c.svc.isGroupHost = true
  c.svc.groupHostExtension = '1000'
  c.svc.groupParticipantExtensions = ['1000', '2000', '3000']
  c.invited = []; c.left = []
  c.svc.addParticipantsToGroupCall = async (targets) => c.invited.push([...targets])
  c.svc.handleParticipantLeftGroupCall = (ext) => c.left.push(ext)
  vm.runInContext('globalThis.signal = (data) => handleGroupPresenceSignal({ wazoService, callStore, contactService }, data)', c)
  return c
}

test('F01: người ngoài không được mời hoặc gỡ thành viên bằng presence', () => {
  const c = groupFixture()
  c.signal({ uuid: 'outsider', status: '[ADD_REQ:r:1000:4000]' })
  c.signal({ uuid: 'outsider', status: '[LEFT:2000]' })
  c.signal({ uuid: 'peer', status: '[LEFT:3000]' })
  assert.equal(c.invited.length, 0); assert.equal(c.left.length, 0)
  c.signal({ uuid: 'peer', status: '[LEFT:2000]' })
  assert.deepEqual(c.left, ['2000'])
})

test('F01: thành viên đã kết nối được mời, ADD_REQ cũ/mới được gộp lặp', async () => {
  const c = groupFixture()
  c.signal({ uuid: 'member', status: '[ADD_REQ:x:1000:4000]' })
  assert.equal(c.invited.length, 0)
  c.svc.extensionToWazoCallIdMap.set('3000', 'confirmed')
  c.signal({ uuid: 'member', status: '[ADD_REQ:x:1000:4000]' })
  c.signal({ uuid: 'member', status: '[ADD_REQ:x:1000:4000]' })
  c.signal({ uuid: 'peer', status: '[ADD_REQ:1000:5000]' })
  c.signal({ uuid: 'peer', status: '[ADD_REQ:1000:5000]' })
  assert.deepEqual(c.invited, [['4000'], ['5000']])
})

test('F01: không tin UUID mâu thuẫn, máy lẻ trùng hoặc nhiều tag điều khiển', () => {
  const c = groupFixture()
  c.signal({ uuid: 'peer', user_uuid: 'outsider', status: '[ADD_REQ:x:1000:4000]' })
  c.signal({ uuid: 'peer', status: '[ADD_REQ:x:1000:4000][LEFT:2000]' })
  c.contactService.currentContacts.push({ uuid: 'duplicate', number: '2000' })
  c.signal({ uuid: 'peer', status: '[ADD_REQ:x:1000:4000]' })
  assert.equal(c.invited.length, 0)
})

test('F01: chỉ peer hiện tại được khởi tạo host; không tự chuyển quyền host', () => {
  const c = groupFixture()
  c.state.activeCall.direction = 'inbound'
  c.svc.isGroupCall = c.svc.isGroupHost = false
  c.svc.groupHostExtension = ''
  c.signal({ uuid: 'outsider', status: '[GROUP:9000:1000,9000]' })
  assert.equal(c.svc.isGroupCall, false)
  c.signal({ uuid: 'peer', status: '[GROUP:2000:1000,2000,3000]' })
  assert.equal(c.svc.groupHostExtension, '2000')
  c.signal({ uuid: 'member', status: '[GROUP:3000:1000,2000,3000]' })
  assert.equal(c.svc.groupHostExtension, '2000')
  const count = c.events.length
  c.signal({ uuid: 'member', status: '[NOTICE:n:2000:fake]' })
  assert.equal(c.events.length, count)
  c.signal({ uuid: 'peer', status: '[NOTICE:n:2000:valid]' })
  c.signal({ uuid: 'peer', status: '[NOTICE:n:2000:valid]' })
  assert.equal(c.events.length, count + 1)
})

test('F02: tích hợp login timeout giữ khóa SDK; retry sau cleanup giữ đúng tài khoản mới', async () => {
  const c = wazo(), pending = deferred()
  c.Wazo.Auth.logIn = () => pending.promise.then(() => { c.Wazo.Auth.token = 'late'; return { token: 'late', uuid: 'old' } })
  c.Wazo.Auth.logout = async () => { c.Wazo.Auth.token = '' }
  const login = c.svc.login('old', 'secret')
  await drain()
  const timeout = [...c.timers.values()][0]
  timeout()
  await assert.rejects(login, /thời gian chờ/)
  await assert.rejects(c.svc.login('new', 'secret'), /chưa kết thúc/)
  pending.resolve()
  await c.svc._authenticationGate.tail
  assert.equal(c.Wazo.Auth.token, '')
  assert.equal(c.svc.isLogged(), false)
  c.Wazo.Auth.logIn = async () => { c.Wazo.Auth.token = 'new'; return { token: 'new', uuid: 'new' } }
  c.svc.connectPhone = async () => true
  await c.svc.login('new', 'secret')
  assert.equal(c.svc.getToken(), 'new'); assert.equal(c.Wazo.Auth.token, 'new')
})

test('F03: thu hồi phiên dọn token/cache và bỏ kết quả body tin nhắn đang chờ', async () => {
  const c = wazo(), body = deferred()
  service(c, 'chatService', 'globalThis.chat = chatService')
  const receiving = deferred(); let signal
  c.fetch = async (url, options) => { signal = options.signal; receiving.resolve(); return { ok: true, json: () => body.promise } }
  c.chat.rooms = [{ id: 'room', isDirect: true, messages: [] }]
  const request = c.chat.getRoomMessages('room')
  await receiving.promise; await drain()
  c.localStorage.setItem('smartcall_sip_user', 'legacy')
  c.svc.handleSessionKicked()
  assert.equal(c.svc.isLogged(), false); assert.equal(c.svc.getToken(), '')
  assert.equal(c.localStorage.getItem('smartcall_sip_user'), null)
  assert.equal(c.chat.rooms.length, 0); assert.equal(signal.aborted, true)
  body.resolve({ items: [{ uuid: 'late', content: 'private', user_uuid: 'peer' }] })
  await request
  assert.equal(c.chat.rooms.length, 0)
  c.svc.handleSessionKicked()
  assert.equal(c.events.filter((event) => event.type === 'smartcall-session-kicked').length, 1)
})

test('F04: accepted/progress cũ không thay session, timer hoặc âm thanh của cuộc gọi mới', () => {
  const c = wazo(); c.svc.attachListeners()
  const current = { sipCallId: 'new' }
  c.svc.currentCallSession = current
  c.state.activeCall = { number: 'same-peer', session: current, status: 'ringing' }
  c.svc._onCallAcceptedHandler({ sipCallId: 'old', number: 'same-peer' })
  c.svc._onProgressHandler({ sipCallId: 'old' })
  assert.equal(c.svc.currentCallSession, current)
  assert.equal(c.state.activeCall.status, 'ringing'); assert.equal(c.svc._durationInterval, null)
  c.svc._onCallAcceptedHandler({ sipCallId: 'new' })
  assert.equal(c.state.activeCall.status, 'connected')
})

test('F04: accepted hợp lệ đến đồng bộ trước Phone.call trả về vẫn được xử lý', async () => {
  const c = wazo(); c.svc.attachListeners()
  c.state.activeCall = { callId: 'attempt', number: 'peer', status: 'ringing' }
  c.Wazo.Phone.call = async () => { c.svc._onCallAcceptedHandler({ sipCallId: 'actual' }); return { sipCallId: 'actual' } }
  await c.svc.makeCall('peer')
  assert.equal(c.state.activeCall.status, 'connected'); assert.equal(c.svc.currentCallSession.sipCallId, 'actual')
})

test('F05: chỉ conference_deleted đúng ID được ngắt cuộc gọi', () => {
  const c = groupFixture(); let ended = 0
  c.svc.isGroupHost = false; c.svc.hangup = () => ended++
  c.svc.currentCallSession = { sipCallId: 'sip', callId: 'server-current' }
  c.svc._handleConferenceEvent('adhoc_conference_deleted', { id: 'unknown' })
  c.svc._handleConferenceEvent('adhoc_conference_participant_joined', { conference_id: 'wrong', call_id: 'server-old' })
  assert.equal(c.svc.activeAdhocConferenceId, '')
  c.svc._handleConferenceEvent('adhoc_conference_participant_joined', { conference_id: 'current', call_id: 'server-current' })
  c.svc._handleConferenceEvent('adhoc_conference_deleted', { id: 'other' })
  c.svc._handleConferenceEvent('adhoc_conference_deleted', {})
  assert.equal(ended, 0)
  c.svc._handleConferenceEvent('adhoc_conference_deleted', { id: 'current' })
  assert.equal(ended, 1)
})

test('F06: HTTP500 cập nhật computed sendFailed ngay, không cần đổi phòng', async () => {
  const c = chat(), pending = deferred()
  c.svc.rooms = [{ id: 'r', messages: [] }]
  c.fetch = () => pending.promise
  const sending = c.svc.sendMessage('r', 'hello')
  const failed = computed(() => c.svc.rooms[0].messages[0]?.sendFailed)
  assert.equal(failed.value, false)
  pending.resolve(response({}, 500)); const message = await sending
  assert.equal(failed.value, true); assert.equal(message.sendFailed, true)
})

test('F06: ID/thời gian server được cập nhật qua proxy Vue', async () => {
  const c = chat(), pending = deferred()
  c.svc.rooms = [{ id: 'r', messages: [] }]; c.fetch = () => pending.promise
  const sending = c.svc.sendMessage('r', 'hello')
  const id = computed(() => c.svc.rooms[0].messages[0]?.id)
  assert.ok(id.value.startsWith('cmsg-'))
  pending.resolve(response({ uuid: 'server', created_at: '2026-11-19T01:00:00Z' }))
  await sending; assert.equal(id.value, 'server')
})

test('F07: nhóm đóng không sống lại bởi tin thường; service chặn gửi tiếp', async () => {
  const c = chat()
  c.svc.rooms = [{ id: 'r', adminVerified: true, adminUuid: 'admin', isDirect: false, messages: [] }]
  c.svc.handleIncomingMessage({ room_uuid: 'r', uuid: 'close', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' })
  c.svc.handleIncomingMessage({ room_uuid: 'r', uuid: 'after', user_uuid: 'peer', content: 'hello' })
  assert.equal(c.svc.rooms.length, 0)
  await assert.rejects(c.svc.sendMessage('r', 'new'), /đã đóng/)
})

test('F07: cold load tìm tombstone ngoài trang gần nhất và không phục hồi nhóm', async () => {
  const c = chat()
  c.fetch = async (url) => {
    if (url.endsWith('/rooms')) return response({ items: [{ uuid: 'r', name: 'Group', admin_uuid: 'admin', users: ['a', 'peer', 'admin'] }] })
    if (url.includes('search=')) return response({ items: [{ uuid: 'close', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' }] })
    throw new Error('Không được tải lịch sử phòng đã đóng')
  }
  assert.equal((await c.svc.getRooms()).length, 0)
  assert.equal(c.svc._closedRoomIds.has('r'), true)
})

test('F07: lịch sử có tin thường sau tombstone vẫn giữ trạng thái đóng', async () => {
  const c = chat()
  c.svc.rooms = [{ id: 'r', adminVerified: true, adminUuid: 'admin', isDirect: false, messages: [] }]
  c.fetch = async () => response({ items: [{ uuid: 'close', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]', created_at: '2026-11-19T01:00:00Z' }, { uuid: 'after', user_uuid: 'peer', content: 'hello', created_at: '2026-11-19T02:00:00Z' }] })
  assert.equal((await c.svc.getRoomMessages('r')).length, 0)
  assert.equal(c.svc.rooms.length, 0)
})

test('Favorites: HTTP500 giữ nguyên dữ liệu, 404 thử nguồn đã biết, gộp thao tác trùng', async () => {
  const c = service(fixture(), 'contactService', 'globalThis.svc = contactService')
  c.svc.currentContacts = [{ id: 'peer', uuid: 'peer', source: 'first', number: '2000', isFavorite: false }]
  const contact = c.svc.currentContacts[0]
  c.fetch = async () => response({}, 500)
  await assert.rejects(c.svc.toggleFavorite(contact), /500/)
  assert.equal(contact.isFavorite, false); assert.equal(c.svc.favoriteIds.length, 0)
  const pending = deferred(); let count = 0
  c.fetch = async () => { count++; return count === 1 ? response({}, 404) : pending.promise }
  const first = c.svc.toggleFavorite(contact), second = c.svc.toggleFavorite(contact)
  await drain(); pending.resolve(response({}, 204))
  assert.equal(await first, true); assert.equal(await second, true); assert.equal(count, 2)
  assert.equal(contact.isFavorite, true)
})

test('CDR: refresh cũ trả muộn không ghi đè lần refresh mới hoặc mở khóa nhầm', async () => {
  const c = service(fixture(), 'historyService', 'globalThis.svc = historyService'), old = deferred(), recent = deferred()
  let calls = 0; c.fetch = () => (++calls === 1 ? old.promise : recent.promise)
  const a = c.svc.getHistory({ forceRefresh: true }), b = c.svc.getHistory({ forceRefresh: true })
  recent.resolve(response({ items: [{ id: 'new', start: '2026-11-19T02:00:00Z', answered: true }] })); await b
  old.resolve(response({ items: [{ id: 'old', start: '2026-11-19T01:00:00Z', answered: true }] })); await a
  assert.deepEqual([...c.svc.localHistory].map((item) => item.id), ['new'])
})

test('Dialer: tra cứu thiết bị chậm không mở khóa sớm hoặc gọi hai lần', async () => {
  const c = wazo(), pending = deferred(); let calls = 0
  c.svc.getMyExtension = () => '1000'; c.svc.isPhoneRegistered = () => true
  c.contactService.currentContacts = [{ number: '2000' }]
  c.contactService.findContactByExtension = () => ({ number: '2000', status: 'online' })
  c.navigator.mediaDevices = { enumerateDevices: () => pending.promise }
  c.Wazo.Phone.call = async () => { calls++; return { sipCallId: 'new' } }
  const first = c.svc.validateAndMakeCall('2000')
  assert.equal(c.svc._isDialing, true)
  assert.equal((await c.svc.validateAndMakeCall('2000')).reason, 'THROTTLED')
  pending.resolve([{ kind: 'audioinput' }]); assert.equal((await first).success, true)
  assert.equal(calls, 1); assert.equal(c.svc._isDialing, false)
})

test('Batch close: trả đúng thành công/thất bại, không nhận vơ toàn bộ đã đóng', async () => {
  const c = chat()
  c.svc.deleteRoom = async (id) => { if (id === 'bad') throw new Error('403'); return id === 'ok' }
  const result = await c.svc.deleteMultipleRooms(['ok', 'bad', 'direct', 'ok'])
  assert.deepEqual([...result.deletedIds], ['ok']); assert.equal(result.failures.length, 2)
})

test('Login và đổi mật khẩu giữ nguyên khoảng trắng; reset không dùng displayName', async () => {
  const c = fixture(); let credentials
  c.wazoService.login = async (u, p) => { credentials = [u, p]; return { uuid: 'a', token: 'fixture' } }
  c.wazoService.isPhoneRegistered = () => false; c.fetch = async () => response({})
  view(c, 'src/views/LoginView.vue', 'globalThis.login = handleLogin; globalThis.form = { username, password }')
  c.form.username.value = ' account '; c.form.password.value = ' pass '; await c.login()
  assert.deepEqual(credentials, ['account', ' pass '])
  const settings = fixture(); let changed, reset = 0
  settings.wazoService.changePassword = async (old, next) => { changed = [old, next]; return response({}, 204) }
  settings.wazoService.resetPassword = async () => { reset++; return response({}, 204) }
  settings.localStorage.setItem('smartcall_username', 'Display Name')
  view(settings, 'src/components/common/SettingsModal.vue', 'globalThis.passwords = { oldPassword, newPassword, confirmPassword }; globalThis.savePassword = savePassword; globalThis.resetEmail = sendPasswordResetEmail')
  settings.passwords.oldPassword.value = ' old '; settings.passwords.newPassword.value = ' new pass '; settings.passwords.confirmPassword.value = ' new pass '
  await settings.savePassword(); assert.deepEqual(changed, [' old ', ' new pass '])
  await settings.resetEmail(); assert.equal(reset, 0)
  settings.localStorage.setItem('smartcall_login_username', 'account'); await settings.resetEmail(); assert.equal(reset, 1)
})

function loadRouter(c, features) {
  const VueRouter = require('vue-router')
  Object.assign(c, { createRouter: VueRouter.createRouter, createWebHistory: VueRouter.createMemoryHistory, LoginView: { render: () => null }, getFeatures: () => features, isFeatureEnabled: (key) => features[key] === true })
  const source = read('src/router/index.js').replace(/^import .*$/gm, '').replace('import.meta.env.BASE_URL', "'/'").replace(/component: \(\) => import\([^)]+\)/g, 'component: { render: () => null }').replace('export default router', 'globalThis.router = router')
  vm.runInContext(source, c)
  return c.router
}

test('F08: cả tám tổ hợp cờ tính năng đều điều hướng hữu hạn, kể cả tắt hết', async () => {
  for (let bits = 0; bits < 8; bits++) {
    const c = fixture(); c.wazoService.isLogged = () => true
    c.localStorage.setItem('smartcall_logged_in', 'true')
    const features = { calls: Boolean(bits & 1), messages: Boolean(bits & 2), history: Boolean(bits & 4) }
    const router = loadRouter(c, features)
    await router.push('/login')
    const expected = features.calls ? '/calls' : features.messages ? '/messages' : features.history ? '/history' : '/login'
    assert.equal(router.currentRoute.value.path, expected)
    await router.push('/calls')
    assert.equal(router.currentRoute.value.path, expected)
  }
})

test('Router: người chưa đăng nhập không truy cập được trang lịch sử', async () => {
  const c = fixture(); c.wazoService.isLogged = () => false
  const router = loadRouter(c, { calls: false, messages: false, history: false })
  await router.push('/history'); assert.equal(router.currentRoute.value.path, '/login')
})

test('Cờ dữ liệu giả cũ không kích hoạt lại đường đăng nhập offline', () => {
  const c = fixture()
  vm.runInContext(read('src/config/features.js').replace(/^export /gm, ''), c)
  c.localStorage.setItem('smartcall_features_config', JSON.stringify({ calls: false, messages: false, history: false, mockData: true }))
  const features = c.getFeatures()
  assert.equal(features.calls, false); assert.equal('mockData' in features, false)
})

test('SIP: SDK xóa listener trong connect; kết nối trùng vẫn nhận REGISTERED và cuộc gọi đến', async () => {
  const c = wazo(), connecting = deferred(); const phone = sdkPhoneBoundary(c); let count = 0
  phone.connect = async () => {
    count++
    phone._transferEvents()
    phone.registered = true
    phone.phone.eventEmitter.emit(phone.ON_REGISTERED)
    await connecting.promise
  }
  const first = c.svc.connectPhone(), second = c.svc.connectPhone()
  await drain(); assert.equal(count, 1); assert.equal(c.state.isRegistered, false)
  connecting.resolve(); await Promise.all([first, second])
  assert.equal(c.state.isRegistered, true)
  assert.equal(phone.eventEmitter.listenerCount(phone.ON_REGISTERED), 1)
  phone.phone.eventEmitter.emit(phone.ON_CALL_INCOMING, { sipCallId: 'incoming', number: '2000' })
  assert.equal(c.state.incomingCall.number, '2000')
})

/** Dùng chính Emitter và _transferEvents của SDK đã cài để test không bỏ sót unbind() trong connect. */
function sdkPhoneBoundary(c) {
  const sdk = fs.readFileSync(path.join(path.dirname(require.resolve('@wazo/sdk')), 'index.mjs'), 'utf8')
  const emitterStart = sdk.indexOf('class Emitter {'), emitterEnd = sdk.indexOf('__webpack_require__.g.wazoClients', emitterStart)
  const transferStart = sdk.indexOf('    _transferEvents() {', sdk.indexOf('class Phone_Phone extends Emitter'))
  const transferEnd = sdk.indexOf('    _logConnector(', transferStart)
  assert.ok(emitterStart >= 0 && emitterEnd > emitterStart && transferStart >= 0 && transferEnd > transferStart, 'Hợp đồng SDK thay đổi: cần cập nhật phép kiểm chứng listener')
  const Emitter = vm.runInNewContext(sdk.slice(emitterStart, emitterEnd).replace('__WEBPACK_EXTERNAL_MODULE_events__["default"]', 'EventEmitter') + '\nEmitter', { EventEmitter })
  const phone = new Emitter()
  Object.assign(phone, c.Wazo.Phone)
  // Giữ phương thức thật của Emitter; fixture mặc định dùng noop cho on/off.
  delete phone.on; delete phone.off; delete phone.eventEmitter
  phone.eventEmitter = new EventEmitter()
  phone.client = new Emitter(); phone.phone = new Emitter()
  phone.phone.isRegistered = () => phone.registered === true
  const constants = Object.fromEntries(Object.entries(phone).filter(([key]) => key.startsWith('ON_')))
  phone._transferEvents = vm.runInNewContext('({' + sdk.slice(transferStart, transferEnd) + '})', {
    web_rtc_client_events: [], transportEvents: [], WebRTCPhone_namespaceObject: constants,
  })._transferEvents
  c.Wazo.Phone = phone
  return phone
}

/** Tạo một máy Web có cuộc gọi thật về mặt state; mạng/SIP được thay riêng tại ranh giới kiểm thử. */
function callClient(number, peer, direction) {
  const c = wazo()
  c.svc.getMyExtension = () => number; c.svc.getMyUserUuid = () => number
  c.contactService.currentContacts = ['1000', '2000', '3000', '4000'].map((n) => ({ uuid: n, number: n }))
  c.contactService.findContactByUuid = (uuid) => c.contactService.currentContacts.find((item) => item.uuid === uuid)
  c.contactService.findContactByExtension = (extension) => c.contactService.currentContacts.find((item) => item.number === String(extension).split('@')[0])
  c.contactService.isContactAvailableForCall = () => true
  c.svc.currentCallSession = { sipCallId: number + '-primary', answered: true }
  c.state.activeCall = { callId: number + '-call', number: peer, direction, status: 'connected', session: c.svc.currentCallSession }
  c.sent = []; c.dialed = []; c.deleted = []; c.hung = []
  c.svc.setPresence = async (state, status) => { c.sent.push({ state, status }); return true }
  c.Wazo.Phone.call = async (ext) => { c.dialed.push(ext); return { sipCallId: number + '-' + ext } }
  c.svc.deleteAdhocConference = async (id) => c.deleted.push(id)
  c.svc.hangupUserCall = async (id) => c.hung.push(id)
  c.svc.syncActiveCallsToAdhocConference = noop
  vm.runInContext('globalThis.signal = (data) => handleGroupPresenceSignal({ wazoService, callStore, contactService }, data)', c)
  c.svc.attachListeners()
  return c
}

test('Group display: ba máy cùng dùng snapshot; C chưa nghe chỉ ở danh sách đang mời, C nhận muộn vẫn vào UI nhóm', async () => {
  const a = callClient('1000', '2000', 'outbound'), b = callClient('2000', '1000', 'inbound'), c = callClient('3000', '1000', 'inbound')
  c.state.activeCall = null; c.svc.currentCallSession = null
  a.svc.setPresence = async (_, status) => { b.signal({ uuid: '1000', status }); c.signal({ uuid: '1000', status }); return true }
  b.svc.setPresence = async (_, status) => { a.signal({ uuid: '2000', status }); return true }
  c.svc.setPresence = async (_, status) => { a.signal({ uuid: '3000', status }); return true }
  await b.svc.addParticipantsToGroupCall(['3000']); await drain()
  for (const client of [a, b]) {
    assert.equal(client.state.activeCall.groupTitle, 'Cuộc gọi nhóm (2 người)')
    assert.deepEqual([...client.state.activeCall.groupConnectedExtensions], ['1000', '2000'])
    assert.deepEqual([...client.state.activeCall.groupPendingExtensions], ['3000'])
  }
  assert.equal(c.svc.isGroupCall, false) // GROUP ban đầu đến trước incoming của C.
  const incoming = { sipCallId: 'C-incoming', number: '1000' }
  c.svc._onCallIncomingHandler(incoming); await drain()
  assert.equal(c.state.incomingCall.isGroupCall, true)
  assert.deepEqual([...c.state.incomingCall.groupPendingExtensions], ['3000'])
  await c.svc.acceptIncomingCall(); c.svc._onCallAcceptedHandler(incoming)
  a.svc._onCallAcceptedHandler(a.svc.secondaryCallSessions.get('3000')); await drain()
  for (const client of [a, b, c]) {
    assert.equal(client.state.activeCall.isGroupCall, true)
    assert.equal(client.state.activeCall.groupTitle, 'Cuộc gọi nhóm (3 người)')
    assert.deepEqual([...client.state.activeCall.groupConnectedExtensions], ['1000', '2000', '3000'])
    assert.deepEqual([...client.state.activeCall.groupPendingExtensions], [])
    assert.equal(client.state.activeCall.groupHostExtension, '1000')
  }
})

test('Group display: snapshot cũ/legacy/scope khác không kéo 3 người về 2; phản hồi đúng request có thể sửa scope cũ', () => {
  const b = callClient('2000', '1000', 'inbound')
  const signal = (state) => b.signal({ uuid: '1000', status: '[GROUP:1000:1000,2000,3000]' + state })
  signal('[GROUP_STATE:room:2:1000,2000,3000]')
  signal('[GROUP_STATE:room:1:1000,2000]')
  signal('')
  signal('[GROUP_STATE:other:10:1000,2000]')
  assert.equal(b.state.activeCall.groupTitle, 'Cuộc gọi nhóm (3 người)')
  assert.equal(b.svc._groupSnapshotRevision, 2)
  b.svc._groupSyncRequestIds.add('current-request')
  signal('[GROUP_STATE:new-room:1:1000,2000:current-request]')
  assert.equal(b.svc._groupSnapshotId, 'new-room')
  assert.equal(b.state.activeCall.groupTitle, 'Cuộc gọi nhóm (2 người)')
  assert.deepEqual([...b.state.activeCall.groupPendingExtensions], ['3000'])
})

test('Group display: GROUP_STATE sai thành viên/revision hoặc nhiều snapshot không được áp dụng', () => {
  const b = callClient('2000', '1000', 'inbound')
  for (const metadata of ['[GROUP_STATE:room:1:1000,9000]', '[GROUP_STATE:room:0:1000,2000]', '[GROUP_STATE:room:1:1000,2000', '[GROUP_STATE:room:1:1000,2000][GROUP_STATE:room:2:1000,2000]']) {
    b.signal({ uuid: '1000', status: '[GROUP:1000:1000,2000,3000]' + metadata })
    assert.equal(b.svc.isGroupCall, false)
  }
})

test('Group display: chỉ thành viên được mời có quyền xin snapshot, request lặp không phát lại', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  const replies = []; a.svc.broadcastGroupStateViaPresence = (request) => replies.push(request)
  a.signal({ uuid: '4000', status: '[GROUP_SYNC:outside:1000]' })
  a.signal({ uuid: '3000', status: '[GROUP_SYNC:request:1000]' })
  a.signal({ uuid: '3000', status: '[GROUP_SYNC:request:1000]' })
  assert.deepEqual(replies, ['request'])
})

test('Group display: View đếm người đã kết nối thay vì groupTitle cũ và tách người đang mời', async () => {
  const a = callClient('1000', '2000', 'outbound')
  view(a, 'src/views/CallsView.vue', 'globalThis.title = activeCallTitle; globalThis.pending = pendingRingingMembers; globalThis.members = groupMembersSummary')
  await a.svc.addParticipantsToGroupCall(['3000'])
  a.state.activeCall.groupTitle = 'Cuộc gọi nhóm (999 người)'
  assert.equal(a.title.value, 'Cuộc gọi nhóm (2 người)')
  assert.equal(a.pending.value.length, 1); assert.match(a.pending.value[0], /3000/)
  assert.doesNotMatch(a.members.value, /3000/)
  a.svc._onCallAcceptedHandler(a.svc.secondaryCallSessions.get('3000'))
  assert.equal(a.title.value, 'Cuộc gọi nhóm (3 người)'); assert.equal(a.pending.value.length, 0)
  assert.match(a.members.value, /3000/)
})

test('Group display: C từ chối không làm tăng số; timeout đến sau accepted không xóa C', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  a.svc._onCallRejectedHandler(a.svc.secondaryCallSessions.get('3000'))
  assert.deepEqual([...a.state.activeCall.groupConnectedExtensions], ['1000', '2000'])
  assert.deepEqual([...a.state.activeCall.groupPendingExtensions], [])
  await a.svc.addParticipantsToGroupCall(['3000'])
  a.svc._onCallAcceptedHandler(a.svc.secondaryCallSessions.get('3000'))
  a.svc._cancelSecondaryLegOnTimeout('3000')
  assert.equal(a.state.activeCall.groupConnectedExtensions.length, 3)
})

test('Group display: C nghe trước B thì chỉ có A/C; timeout B vẫn được dọn dù nhóm đã connected', () => {
  const a = callClient('1000', '2000', 'outbound')
  a.svc.currentCallSession.answered = false; a.state.activeCall.status = 'ringing'
  a.svc.isGroupCall = a.svc.isGroupHost = true; a.svc.groupHostExtension = '1000'
  a.svc.groupParticipantExtensions = ['1000', '2000', '3000']; a.svc.groupConnectedExtensions = ['1000']
  const child = { sipCallId: 'C', answered: true }; a.svc.secondaryCallSessions.set('3000', child)
  a.svc._onCallAcceptedHandler(child)
  assert.deepEqual([...a.state.activeCall.groupConnectedExtensions], ['1000', '3000'])
  assert.deepEqual([...a.state.activeCall.groupPendingExtensions], ['2000'])
  a.svc._cancelPrimaryLegOnTimeout('2000')
  assert.deepEqual([...a.state.activeCall.groupPendingExtensions], [])
  assert.deepEqual([...a.state.activeCall.groupConnectedExtensions], ['1000', '3000'])
})

test('Group display: Calld bổ sung accepted bị lỡ và nhiều talking_to không làm B/C đè call ID', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  a.svc.activeAdhocConferenceId = 'conference'; a.svc.mergedCallIds.add('B-call'); a.svc.mergedCallIds.add('C-call')
  a.svc.extensionToWazoCallIdMap.set('2000', 'B-call'); a.svc.extensionToWazoCallIdMap.set('3000', 'C-call')
  a.svc.secondaryCallSessions.clear()
  a.svc.getMyActiveCalls = async () => [{ id: 'host', sip_call_id: '1000-primary', status: 'talking', talking_to: { 'B-call': {}, 'C-call': {} } }]
  await a.svc._doSyncActiveCallsToAdhocConference()
  assert.equal(a.svc.extensionToWazoCallIdMap.get('2000'), 'B-call')
  assert.equal(a.svc.extensionToWazoCallIdMap.get('3000'), 'C-call')
  assert.equal(a.state.activeCall.groupTitle, 'Cuộc gọi nhóm (3 người)')
})

test('Group display: chờ danh bạ rồi cúp không gửi yêu cầu snapshot của cuộc gọi đã kết thúc', async () => {
  const c = callClient('3000', '1000', 'inbound'), contacts = deferred()
  c.state.activeCall = null; c.svc.currentCallSession = null
  c.contactService.findContactByExtension = () => null
  c.contactService.getContacts = () => contacts.promise
  c.svc._onCallIncomingHandler({ sipCallId: 'C-incoming', number: '1000' })
  c.svc.hangup()
  c.contactService.findContactByExtension = () => ({ uuid: '1000', number: '1000' })
  contacts.resolve(); await drain()
  assert.equal(c.sent.some(({ status }) => status.includes('[GROUP_SYNC:')), false)
  assert.equal(c.svc._groupSyncRequestIds.size, 0)
})

test('Group display: SDK lỗi hoặc trả null thì bỏ C đang mời, hai máy vẫn cùng hiển thị 2 người', async () => {
  for (const fail of [async () => { throw new Error('SIP failed') }, async () => null]) {
    const a = callClient('1000', '2000', 'outbound'), b = callClient('2000', '1000', 'inbound')
    a.svc.setPresence = async (_, status) => { b.signal({ uuid: '1000', status }); return true }
    a.Wazo.Phone.call = fail
    await a.svc.addParticipantsToGroupCall(['3000'])
    for (const client of [a, b]) {
      assert.equal(client.state.activeCall.groupTitle, 'Cuộc gọi nhóm (2 người)')
      assert.deepEqual([...client.state.activeCall.groupPendingExtensions], [])
      assert.deepEqual([...client.state.activeCall.groupParticipantExtensions], ['1000', '2000'])
    }
  }
})

test('Group display: websocket mở lại xin snapshot mới mà không tự suy ra nhóm', async () => {
  const b = callClient('2000', '1000', 'inbound')
  b.WebSocket = class { send() {} close() {} }
  b.svc.openWebSocketEvents(); b.svc.eventWs.onopen(); await drain()
  assert.ok(b.sent.some(({ status }) => status.startsWith('[GROUP_SYNC:')))
  assert.equal(b.svc.isGroupCall, false)
})

test('Group display: cúp dọn snapshot và event GROUP cũ không phục hồi giao diện nhóm', async () => {
  const b = callClient('2000', '1000', 'inbound')
  const status = '[GROUP:1000:1000,2000,3000][GROUP_STATE:room:1:1000,2000,3000]'
  b.signal({ uuid: '1000', status }); assert.equal(b.svc.isGroupCall, true)
  b.svc.hangup(); b.signal({ uuid: '1000', status }); await drain()
  assert.equal(b.svc.isGroupCall, false); assert.equal(b.svc._groupSnapshotId, '')
  assert.deepEqual([...b.svc.groupConnectedExtensions], []); assert.equal(b.state.activeCall, null)
})

test('Host: A gọi B, B mời C thì chỉ A gọi C và A giữ quyền giải tán nhóm', async () => {
  const a = callClient('1000', '2000', 'outbound'), b = callClient('2000', '1000', 'inbound'), c = callClient('3000', '1000', 'inbound')
  a.svc.setPresence = async (_, status) => { b.signal({ uuid: '1000', status }); c.signal({ uuid: '1000', status }); return true }
  b.svc.setPresence = async (_, status) => { a.signal({ uuid: '2000', status }); return true }
  await b.svc.addParticipantsToGroupCall(['3000']); await drain()
  assert.deepEqual(b.dialed, []); assert.deepEqual(a.dialed, ['3000'])
  assert.equal(a.svc.isGroupHost, true); assert.equal(a.svc.groupHostExtension, '1000')
  assert.equal(b.svc.isGroupHost, false); assert.equal(b.svc.groupHostExtension, '1000')
  assert.equal(c.svc.isGroupHost, false); assert.equal(c.svc.groupHostExtension, '1000')
  assert.deepEqual([...a.svc.groupParticipantExtensions], ['1000', '2000', '3000'])
  a.svc.activeAdhocConferenceId = 'conference'; a.svc.extensionToWazoCallIdMap.set('2000', 'B-call'); a.svc.extensionToWazoCallIdMap.set('3000', 'C-call')
  for (const [client, id] of [[b, 'B-call'], [c, 'C-call']]) {
    client.svc.currentCallSession.callId = id
    client.svc._handleConferenceEvent('adhoc_conference_participant_joined', { conference_id: 'conference', call_id: id })
  }
  a.svc.deleteAdhocConference = async (id) => {
    a.deleted.push(id); await drain()
    b.svc._handleConferenceEvent('adhoc_conference_deleted', { id })
    c.svc._handleConferenceEvent('adhoc_conference_deleted', { id })
  }
  a.svc.hangup(); await drain()
  assert.ok(a.deleted.includes('conference')); assert.ok(a.hung.includes('B-call')); assert.ok(a.hung.includes('C-call'))
  assert.equal(a.state.activeCall, null)
  assert.equal(b.state.activeCall, null); assert.equal(c.state.activeCall, null)
})

test('Host: người gọi tự thêm C vẫn là host; thành viên rời không giải tán phòng', async () => {
  const a = callClient('1000', '2000', 'outbound')
  await a.svc.addParticipantsToGroupCall(['3000'])
  assert.equal(a.svc.groupHostExtension, '1000'); assert.deepEqual(a.dialed, ['3000'])
  a.svc.activeAdhocConferenceId = 'conference'
  a.svc.extensionToWazoCallIdMap.set('2000', 'B-call'); a.svc.extensionToWazoCallIdMap.set('3000', 'C-call')
  a.svc._handleConferenceEvent('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 'B-call' })
  assert.deepEqual([...a.svc.groupParticipantExtensions], ['1000', '3000'])
  assert.equal(a.svc.isGroupHost, true); assert.ok(a.state.activeCall); assert.deepEqual(a.deleted, [])
})

test('Host: chỉ peer đã kết nối của cuộc gọi outbound được yêu cầu nâng nhóm; không nhận host từ B', () => {
  const a = callClient('1000', '2000', 'outbound'); let invited = 0
  a.svc.addParticipantsToGroupCall = async () => invited++
  a.signal({ uuid: '3000', status: '[ADD_REQ:x:1000:4000]' })
  a.state.activeCall.status = 'ringing'; a.signal({ uuid: '2000', status: '[ADD_REQ:x:1000:4000]' })
  a.state.activeCall.status = 'connected'; a.signal({ uuid: '2000', status: '[GROUP:2000:1000,2000,3000]' })
  assert.equal(invited, 0); assert.equal(a.svc.isGroupCall, false)
  a.signal({ uuid: '2000', status: '[ADD_REQ:x:1000:3000]' }); a.signal({ uuid: '2000', status: '[ADD_REQ:x:1000:3000]' })
  assert.equal(invited, 1)
  const b = callClient('2000', '1000', 'inbound'); b.svc.addParticipantsToGroupCall = async () => invited++
  b.signal({ uuid: '1000', status: '[ADD_REQ:x:2000:3000]' })
  assert.equal(invited, 1)
})

test('Host: lỗi gửi ADD_REQ không báo thành công và không tự tạo nhóm ở máy B', async () => {
  const b = callClient('2000', '1000', 'inbound'); b.svc.setPresence = async () => false
  await assert.rejects(b.svc.addParticipantsToGroupCall(['3000']), /Không gửi được/)
  assert.equal(b.svc.isGroupHost, false); assert.equal(b.svc.isGroupCall, false); assert.deepEqual(b.dialed, [])
  assert.equal(b.events.some((e) => e.detail?.message?.includes('Đã gửi yêu cầu')), false)
})

test('Host: ACK mời C đến sau khi B cúp không hiện thông báo thành công cho cuộc gọi cũ', async () => {
  const b = callClient('2000', '1000', 'inbound'), pending = deferred()
  b.svc.setPresence = () => pending.promise
  const inviting = b.svc.addParticipantsToGroupCall(['3000'])
  b.svc.hangup(); pending.resolve(true); await inviting
  assert.equal(b.state.activeCall, null); assert.deepEqual(b.dialed, [])
  assert.equal(b.events.some((e) => e.detail?.message?.includes('Đã gửi yêu cầu')), false)
})

test('Host: B cúp chỉ rời nhóm của A; A và C tiếp tục và host không đổi', async () => {
  const a = callClient('1000', '2000', 'outbound'), b = callClient('2000', '1000', 'inbound')
  a.svc.setPresence = async (_, status) => { b.signal({ uuid: '1000', status }); return true }
  b.svc.setPresence = async (_, status) => { a.signal({ uuid: '2000', status }); return true }
  await b.svc.addParticipantsToGroupCall(['3000']); await drain()
  a.svc.activeAdhocConferenceId = 'conference'; a.svc.extensionToWazoCallIdMap.set('2000', 'B-call'); a.svc.extensionToWazoCallIdMap.set('3000', 'C-call')
  b.svc.hangup(); await drain()
  assert.equal(b.state.activeCall, null); assert.ok(a.state.activeCall)
  assert.deepEqual([...a.svc.groupParticipantExtensions], ['1000', '3000'])
  assert.equal(a.svc.groupHostExtension, '1000'); assert.deepEqual(a.deleted, [])
})

test('Conference: call_ended của kênh cũ không làm C rời phòng; chỉ sự kiện đúng hội nghị mới gỡ C', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  a.svc.activeAdhocConferenceId = 'conference'; a.svc.extensionToWazoCallIdMap.set('2000', 'B-call'); a.svc.extensionToWazoCallIdMap.set('3000', 123)
  a.svc.mergedCallIds.add(123)
  a.WebSocket = class { send() {} close() {} }; a.svc.openWebSocketEvents()
  const send = (name, data) => a.svc.eventWs.onmessage({ data: JSON.stringify({ op: 'event', data: { name, data } }) })
  send('call_ended', { call_id: 123, reason_code: 26 })
  a.svc._onCallEndedHandler(a.svc.secondaryCallSessions.get('3000'))
  send('adhoc_conference_participant_left', { conference_id: 'old-room', call_id: 123 })
  send('adhoc_conference_participant_left', { call_id: 123 })
  assert.ok(a.svc.groupParticipantExtensions.includes('3000'))
  assert.equal(a.events.some((e) => e.detail?.message?.includes('đã rời')), false)
  send('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 123 })
  send('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 123 })
  assert.equal(a.svc.groupParticipantExtensions.includes('3000'), false)
  assert.equal(a.events.filter((e) => e.detail?.message?.includes('đã rời')).length, 1)
  assert.ok(a.state.activeCall)
})

test('Conference: C kết thúc kênh lúc REST tạo phòng còn chờ không bị báo rời; A cúp vẫn dọn B và C', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  const secondary = a.svc.secondaryCallSessions.get('3000'); a.svc._onCallAcceptedHandler(secondary)
  const pending = deferred(), started = deferred()
  a.svc.getMyActiveCalls = async () => [
    { id: 'A-host', sip_call_id: '1000-primary', talking_to: { 'B-call': {} } },
    { id: 'A-C', sip_call_id: secondary.sipCallId, talking_to: { 'C-call': {} } },
  ]
  a.svc.createAdhocConference = () => { started.resolve(); return pending.promise }
  vm.runInContext('wazoService.syncActiveCallsToAdhocConference = Object.getPrototypeOf(wazoService).syncActiveCallsToAdhocConference', a)
  a.svc.syncActiveCallsToAdhocConference()
  const merging = a.timers.get(a.svc._syncAdhocDebounceTimer)(); await started.promise
  a.svc._onCallEndedHandler(secondary)
  assert.ok(a.svc.groupParticipantExtensions.includes('3000')); assert.equal(a.svc._pendingConferenceTerminations.size, 1)
  pending.resolve('conference'); await merging
  assert.equal(a.svc._pendingConferenceTerminations.size, 0); assert.equal(a.svc.secondaryCallSessions.has('3000'), false)
  assert.ok(a.svc.groupParticipantExtensions.includes('3000'))
  assert.equal(a.events.some((e) => e.detail?.message?.includes('đã rời')), false)
  a.svc.hangup(); await drain(); assert.ok(a.hung.includes('C-call')); assert.ok(a.deleted.includes('conference'))
})

test('Conference: ghép thất bại thì kết thúc nhánh chờ được dọn; không giữ C giả trong nhóm', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  const secondary = a.svc.secondaryCallSessions.get('3000'); a.svc._onCallAcceptedHandler(secondary)
  const pending = deferred(), started = deferred()
  a.svc.getMyActiveCalls = async () => [
    { id: 'host', sip_call_id: '1000-primary', talking_to: { 'B-call': {} } },
    { id: 'child', sip_call_id: secondary.sipCallId, talking_to: { 'C-call': {} } },
  ]
  a.svc.createAdhocConference = () => { started.resolve(); return pending.promise }
  vm.runInContext('wazoService.syncActiveCallsToAdhocConference = Object.getPrototypeOf(wazoService).syncActiveCallsToAdhocConference', a)
  a.svc.syncActiveCallsToAdhocConference(); const merging = a.timers.get(a.svc._syncAdhocDebounceTimer)(); await started.promise
  a.svc._onCallEndedHandler(secondary); pending.resolve(null); await merging
  assert.equal(a.svc._pendingConferenceTerminations.size, 0)
  assert.equal(a.svc.groupParticipantExtensions.includes('3000'), false); assert.ok(a.state.activeCall)
})

test('Conference: A cúp khi ghép còn chờ xóa hàng đợi; kết quả muộn không phục hồi nhóm', async () => {
  const a = callClient('1000', '2000', 'outbound'); await a.svc.addParticipantsToGroupCall(['3000'])
  const secondary = a.svc.secondaryCallSessions.get('3000'); a.svc._onCallAcceptedHandler(secondary)
  const pending = deferred(), started = deferred()
  a.svc.getMyActiveCalls = async () => [
    { id: 'host', sip_call_id: '1000-primary', talking_to: { 'B-call': {} } },
    { id: 'child', sip_call_id: secondary.sipCallId, talking_to: { 'C-call': {} } },
  ]
  a.svc.createAdhocConference = () => { started.resolve(); return pending.promise }
  vm.runInContext('wazoService.syncActiveCallsToAdhocConference = Object.getPrototypeOf(wazoService).syncActiveCallsToAdhocConference', a)
  a.svc.syncActiveCallsToAdhocConference(); const merging = a.timers.get(a.svc._syncAdhocDebounceTimer)(); await started.promise
  a.svc._onCallEndedHandler(secondary); a.svc.hangup()
  assert.equal(a.svc._pendingConferenceTerminations.size, 0)
  pending.resolve('late-conference'); await merging
  assert.equal(a.state.activeCall, null); assert.equal(a.svc.isGroupCall, false); assert.equal(a.svc.activeAdhocConferenceId, '')
  assert.ok(a.deleted.includes('late-conference'))
})

test('SIP: callback giữ lại từ listener trước bị vô hiệu ngay sau logout', async () => {
  const c = wazo(); c.svc.attachListeners()
  const old = c.svc._onRegisteredHandler
  c.svc.logout(); c.localStorage.setItem('smartcall_wazo_token', 'new')
  old(); assert.equal(c.state.isRegistered, false)
  await c.svc._phoneCleanup
})

test('SIP: connect mới chờ connect/disconnect cũ hoàn tất', async () => {
  const c = wazo(), old = deferred(), cleanup = deferred(); let count = 0
  c.Wazo.Phone.connect = () => (++count === 1 ? old.promise : Promise.resolve())
  c.Wazo.Phone.disconnect = () => cleanup.promise
  const first = c.svc.connectPhone(); await drain()
  c.svc.logout()
  c.localStorage.setItem('smartcall_wazo_token', 'new'); c.localStorage.setItem('smartcall_user_uuid', 'new')
  const second = c.svc.connectPhone()
  const rejection = assert.rejects(first, { name: 'StaleSessionError' })
  old.resolve(); await rejection; await drain(); assert.equal(count, 1)
  cleanup.resolve(); await second; assert.equal(count, 2)
})

test('Storage: tab cũ dọn phiên nhưng không xóa token của tài khoản tab mới', async () => {
  const c = wazo()
  c.svc.session = { token: 'fixture', uuid: 'a' }
  c.svc.attachListeners()
  c.localStorage.setItem('smartcall_wazo_token', 'new-account-token')
  c.localStorage.setItem('smartcall_user_uuid', 'b')
  c.localStorage.setItem('smartcall_session_uuid', 'b-session')
  c.svc.handleSharedSessionChange({ key: 'smartcall_wazo_token' })
  assert.equal(c.svc.getToken(), ''); assert.equal(c.svc.isLogged(), false)
  assert.equal(c.localStorage.getItem('smartcall_wazo_token'), 'new-account-token')
  assert.equal(c.localStorage.getItem('smartcall_user_uuid'), 'b')
  assert.equal(c.localStorage.getItem('smartcall_session_uuid'), 'b-session')
  await c.svc._authenticationGate.tail
})

test('Socket: close() lỗi không ngăn xóa token; callback cũ không khởi động lại phiên', async () => {
  const c = wazo(); let socket
  c.WebSocket = class { constructor() { socket = this } send() {} close() { throw new Error('close failed') } }
  c.svc.openWebSocketEvents()
  const callback = socket.onmessage, onclose = socket.onclose
  c.svc.handleSessionKicked()
  callback({ data: JSON.stringify({ op: 'event', data: { name: 'chatd_user_room_message_created', data: { content: 'old' } } }) })
  await onclose({ code: 4001 })
  assert.equal(c.svc.eventWs, null); assert.equal(c.svc.getToken(), '')
  assert.equal(c.svc._wsRetryTimer, null)
})

test('Logger: che token/password, giữ snapshot và xuất được object SDK có vòng tham chiếu', () => {
  const c = service(fixture(), 'loggerService', 'globalThis.svc = logger')
  const sdk = { token: 'private-token', nested: { password: 'private-password', url: 'wss://example.invalid/?token=private-query' } }
  sdk.self = sdk
  c.svc.info('AUTH', 'GET /api/auth/0.1/token/private-path', sdk)
  sdk.token = 'changed'
  const text = c.svc.exportLogsText()
  for (const secret of ['private-token', 'private-password', 'private-query', 'private-path', 'changed']) assert.equal(text.includes(secret), false)
  assert.ok(text.includes('Tham chiếu vòng'))
})

test('F03: App Vue thật bỏ private view/KeepAlive ngay khi bị thu hồi phiên', async () => {
  const Vue = require('vue'), VueRouter = require('vue-router'), { parse, compileScript } = require('@vue/compiler-sfc')
  const c = wazo()
  c.svc.session = { token: 'fixture', uuid: 'a' }
  c.localStorage.setItem('smartcall_logged_in', 'true')
  let mounted = 0, unmounted = 0
  const PrivateView = { setup() { Vue.onMounted(() => mounted++); Vue.onUnmounted(() => unmounted++); return () => Vue.h('private-view', 'PRIVATE') } }
  const router = VueRouter.createRouter({ history: VueRouter.createMemoryHistory(), routes: [{ path: '/calls', name: 'Calls', component: PrivateView }, { path: '/login', name: 'Login', component: { render: () => Vue.h('login-view', 'LOGIN') } }] })
  await router.push('/calls')
  const { descriptor } = parse(read('src/App.vue'))
  const script = compileScript(descriptor, { id: 'session-test', inlineTemplate: true }).content
    .replace(/import \{([^}]+)\} from ['"]vue['"]/g, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`)
    .replace(/import \{([^}]+)\} from ['"]vue-router['"]/g, (_, names) => `const {${names}} = VueRouter`)
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.component =')
  const stub = { render: () => null }
  Object.assign(c, { Vue, VueRouter, AppHeader: stub, AppSidebar: stub, SettingsModal: stub, IncomingCallModal: stub, DebugLogDrawer: stub })
  vm.runInContext(script, c)
  const make = (type, text = '') => ({ type, text, children: [], parent: null, getRootNode() { let node = this; while (node.parent) node = node.parent; return node } })
  const renderer = Vue.createRenderer({
    createElement: (type) => make(type), createText: (text) => make('text', text), createComment: (text) => make('comment', text),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insert(node, parent, anchor = null) { if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1) }; const i = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(i < 0 ? parent.children.length : i, 0, node); node.parent = parent },
    remove(node) { const i = node.parent?.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1); node.parent = null }, patchProp: noop,
  })
  const root = make('root'), app = renderer.createApp(c.component)
  app.use(router); app.mount(root); await Vue.nextTick(); await drain()
  const containsPrivate = (node) => node.type === 'private-view' || node.children.some(containsPrivate)
  assert.equal(mounted, 1); assert.equal(containsPrivate(root), true)
  c.svc.handleSessionKicked()
  await Vue.nextTick()
  assert.equal(containsPrivate(root), false); assert.equal(unmounted, 1)
  await drain(); assert.equal(router.currentRoute.value.path, '/login')
  app.unmount()
})

test('Restore: token bị từ chối bị xóa, không giữ trạng thái đã đăng nhập giả', async () => {
  const c = wazo()
  c.Wazo.Auth.validateToken = async () => { throw new Error('401') }
  assert.equal(await c.svc.restoreSession(), false)
  assert.equal(c.svc.isLogged(), false); assert.equal(c.localStorage.getItem('smartcall_wazo_token'), null)
})

test('Restore: timeout validate giữ khóa SDK và xóa token Web trong khi chờ cleanup', async () => {
  const c = wazo(), pending = deferred()
  c.Wazo.Auth.validateToken = () => pending.promise
  const restoring = c.svc.restoreSession(); await drain()
  const timeout = [...c.timers.values()][0]; timeout()
  assert.equal(await restoring, false)
  assert.equal(c.svc.getToken(), '')
  await assert.rejects(c.svc.login('new', 'secret'), /chưa kết thúc/)
  pending.resolve({ token: 'late', uuid: 'a' }); await c.svc._authenticationGate.tail
  assert.equal(c.svc.isLogged(), false)
})

test('Restore: kết quả cũ không xóa credential vừa đổi ở tab khác', async () => {
  const c = wazo(), pending = deferred()
  c.Wazo.Auth.validateToken = () => pending.promise
  const restoring = c.svc.restoreSession(); await drain()
  c.localStorage.setItem('smartcall_wazo_token', 'b-token'); c.localStorage.setItem('smartcall_user_uuid', 'b')
  pending.resolve({ token: 'a-token', uuid: 'a' })
  assert.equal(await restoring, false)
  assert.equal(c.localStorage.getItem('smartcall_wazo_token'), 'b-token')
  assert.equal(c.localStorage.getItem('smartcall_user_uuid'), 'b')
})

test('Login: SDK Phone treo không giữ form đăng nhập dù xác thực đã thành công', async () => {
  const c = wazo(), pending = deferred()
  c.Wazo.Auth.logIn = async () => ({ token: 'new', uuid: 'a' })
  c.svc.connectPhone = () => pending.promise
  const session = await c.svc.login('account', 'secret')
  assert.equal(session.token, 'new'); assert.equal(c.state.isRegistered, false)
  pending.resolve(true)
})

test('F04: terminal event cũ không hủy cuộc gọi mới đang chờ session SDK', async () => {
  const c = wazo(), pending = deferred(); c.svc.attachListeners()
  c.state.activeCall = { callId: 'new', status: 'ringing', number: 'peer', session: null }
  c.Wazo.Phone.call = () => pending.promise
  const dialing = c.svc.makeCall('peer')
  c.svc._onCallEndedHandler({ sipCallId: 'old' })
  c.svc._onCallFailedHandler({ sipCallId: 'old' })
  assert.equal(c.state.activeCall.callId, 'new')
  pending.resolve({ sipCallId: 'new-sip' }); await dialing
  assert.equal(c.svc.currentCallSession.sipCallId, 'new-sip')
})

test('F04: nhánh phụ nghe đồng bộ không bị đặt lại timer timeout 30 giây', async () => {
  const c = groupFixture(); c.svc.attachListeners()
  c.contactService.isContactAvailableForCall = () => true
  c.svc.syncActiveCallsToAdhocConference = noop
  c.svc.broadcastGroupStateViaPresence = noop; c.svc.broadcastNoticeToGroup = noop
  c.Wazo.Phone.call = async () => { c.svc._onCallAcceptedHandler({ sipCallId: 'secondary', answered: true }); return { sipCallId: 'secondary', answered: false } }
  // Dùng implementation thật, không stub lời mời trong groupFixture.
  vm.runInContext('wazoService.addParticipantsToGroupCall = Object.getPrototypeOf(wazoService).addParticipantsToGroupCall', c)
  await c.svc.addParticipantsToGroupCall(['4000'])
  assert.equal(c.svc._secondaryInviteTimers.has('4000'), false)
  assert.equal(c.svc.secondaryCallSessions.get('4000').answered, true)
})

test('F07: kiểm tra phân trang vẫn bỏ qua lệnh giả và tìm đúng tombstone quản trị', async () => {
  const c = chat(), offsets = []
  const room = { id: 'r', adminVerified: true, adminUuid: 'admin', isDirect: false }
  c.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset)
    return offset === 0 ? response({ items: Array.from({ length: 100 }, (_, i) => ({ uuid: 'fake-' + i, user_uuid: 'ordinary', content: '[SYSTEM:ROOM_CLOSED]' })) }) : response({ items: [{ uuid: 'real', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' }] })
  }
  await c.svc._verifyRoomClosure(room, c.captureSessionContext())
  assert.deepEqual(offsets, [0, 100]); assert.equal(room.isClosed, true)
})

test('F07: lỗi xác minh trạng thái không làm nhóm hiện lại như đang mở', async () => {
  const c = chat()
  c.svc.rooms = [{ id: 'r', isDirect: false, messages: [{ id: 'cached', text: 'old' }] }]
  c.fetch = async (url) => url.endsWith('/rooms') ? response({ items: [{ uuid: 'r', name: 'Group', admin_uuid: 'admin', users: ['a', 'peer', 'admin'] }] }) : response({}, 500)
  assert.equal((await c.svc.getRooms()).length, 0)
  assert.equal(c.events.some((event) => event.type === 'app-toast' && event.detail.type === 'warning'), true)
})

test('Favorites: ACK muộn sau đổi phiên không sửa yêu thích tài khoản mới', async () => {
  const c = service(fixture(), 'contactService', 'globalThis.svc = contactService'), pending = deferred()
  c.svc.currentContacts = [{ id: 'peer', uuid: 'peer', number: '2000', isFavorite: false }]
  c.fetch = () => pending.promise
  const first = c.svc.toggleFavorite(c.svc.currentContacts[0])
  c.svc.reset(); c.localStorage.setItem('smartcall_user_uuid', 'b')
  c.svc.currentContacts = [{ id: 'peer', uuid: 'peer', number: '2000', isFavorite: false }]
  pending.resolve(response({}, 204))
  await assert.rejects(first, { name: 'StaleSessionError' })
  assert.equal(c.svc.currentContacts[0].isFavorite, false); assert.equal(c.svc.favoriteIds.length, 0)
})

test('Ghi âm dùng đúng host đăng nhập, không lấy host cũ trong localStorage', () => {
  const c = service(fixture(), 'recordService', 'globalThis.svc = recordService')
  c.localStorage.setItem('smartcall_wazo_host', 'stale.invalid')
  c.wazoService.getHostUrl = () => 'https://current.invalid:9443'
  assert.equal(c.svc.getHost(), 'https://current.invalid:9443')
})

test('Cleanup thoại bắt cả lỗi Promise và lỗi đồng bộ, không phát unhandled rejection', async () => {
  const c = wazo()
  assert.equal(await c.svc._runPhoneCleanup(() => Promise.reject(new Error('SIP unavailable'))), false)
  assert.equal(await c.svc._runPhoneCleanup(() => { throw new Error('SIP unavailable') }), false)
  assert.equal(await c.svc._runPhoneCleanup(() => Promise.reject()), false)
  assert.equal(await c.svc._runPhoneCleanup(async () => {}), true)
})

test('Chọn mic để thử không lưu thay đổi trước khi bấm Lưu', () => {
  const c = fixture()
  c.localStorage.setItem('smartcall_selected_mic', 'saved-mic')
  view(c, 'src/components/common/SettingsModal.vue', 'globalThis.mic = selectedMic; globalThis.preview = restartMicMeter')
  c.mic.value = 'preview-mic'; c.preview()
  assert.equal(c.localStorage.getItem('smartcall_selected_mic'), 'saved-mic')
})

test('SIP: disconnect thất bại chặn kết nối/quay số mới trên SDK chưa sạch', async () => {
  const c = wazo(); let dialed = 0, connected = 0
  c.Wazo.Phone.disconnect = async () => { throw new Error('cleanup failed') }
  c.Wazo.Phone.connect = async () => connected++
  c.Wazo.Phone.call = async () => dialed++
  await c.svc.disconnectPhone()
  await assert.rejects(c.svc.connectPhone(), /kết nối thoại cũ/)
  await assert.rejects(c.svc._requestPhoneCall('2000'), /kết nối thoại cũ/)
  assert.equal(connected, 0); assert.equal(dialed, 0)
})

test('SDK thật về mặt state: timeout không cho retry trước khi request và logout hoàn tất', async () => {
  const c = wazo()
  const pending = deferred(), cleanup = deferred()
  const sdk = { token: '', logout: async () => { await cleanup.promise; sdk.token = '' } }
  const gate = c.getSdkAuthenticationGate(sdk)
  const first = gate.authenticate({ context: c.captureSessionContext(), initialize() {}, request: () => pending.promise.then(() => { sdk.token = 'old'; return { token: 'old' } }), timeoutMs: 5 })
  await drain()
  ;[...c.timers.values()][0]()
  await assert.rejects(first, /thời gian chờ/)
  assert.throws(() => gate.assertCanAuthenticate(), /chưa kết thúc/)
  pending.resolve()
  await drain()
  assert.equal(sdk.token, 'old')
  assert.throws(() => gate.assertCanAuthenticate(), /chưa kết thúc/)
  cleanup.resolve()
  await gate.tail
  assert.equal(sdk.token, '')
  const session = await gate.authenticate({ context: c.captureSessionContext(), initialize() {}, request: async () => { sdk.token = 'new'; return { token: 'new' } } })
  assert.equal(session.token, 'new')
  assert.equal(sdk.token, 'new')
})

test('Logout khi validate còn chờ: kết quả SDK cũ bị dọn trước thao tác tiếp theo', async () => {
  const c = wazo()
  const pending = deferred()
  const sdk = { token: '', logout: async () => { sdk.token = '' } }
  const gate = c.getSdkAuthenticationGate(sdk)
  const validating = gate.authenticate({ context: c.captureSessionContext(), initialize() {}, request: () => pending.promise.then(() => { sdk.token = 'old'; return {} }) })
  await drain()
  c.invalidateSession()
  const cleanup = gate.logout()
  pending.resolve()
  await assert.rejects(validating, { name: 'StaleSessionError' })
  await cleanup
  assert.equal(sdk.token, '')
  gate.assertCanAuthenticate()
})

test('Cleanup SDK thất bại: khóa đăng nhập an toàn và yêu cầu tải lại', async () => {
  const c = wazo()
  const sdk = { logout: async () => { throw new Error('cleanup failed') } }
  const gate = c.getSdkAuthenticationGate(sdk)
  await assert.rejects(gate.logout(), /cleanup failed/)
  assert.throws(() => gate.assertCanAuthenticate(), /tải lại trang/)
  assert.equal(c.getSdkAuthenticationGate(sdk), gate)
})


// Kiểm tra đường gọi từ hội thoại với router thật và dịch vụ nhóm hiện hành.
function messageCallView(c = fixture()) {
  c.confirm = () => true
  c.chatService.sendMessage = async () => ({ id: 'notice' })
  c.callStore.myExtension = '1000'
  const navigations = []
  c.useRouter = () => ({ push: (route) => { navigations.push(route); return Promise.resolve() } })
  view(c, 'src/views/MessagesView.vue', 'globalThis.messageCall = { startVoiceCall, currentRoom, isStartingVoiceCall }')
  c.navigations = navigations
  c.messageCall.currentRoom.value = { id: 'room', title: 'Team', isDirect: false, members: [{ id: 'a', ext: '1000' }, { id: 'b', ext: '2000' }] }
  return c
}

test('Chat call: điều hướng thật giữ nguyên number/autocall thay vì bị /calls ghi đè', async () => {
  const { createRouter, createMemoryHistory } = await import('vue-router')
  const router = createRouter({ history: createMemoryHistory(), routes: ['/messages', '/calls'].map(path => ({ path, component: {} })) })
  await router.push('/messages')
  const c = fixture()
  c.useRouter = () => router
  // Dùng đúng hàm onDial của App, không dựng lại quy tắc tạo query trong test.
  const appSource = read('src/App.vue')
  vm.runInContext('const router = useRouter();' + appSource.slice(appSource.indexOf('const onDial ='), appSource.indexOf('// --- Helper Toast')), c)
  c.window.addEventListener('app-action', event => vm.runInContext('onDial(' + JSON.stringify(event.detail.value) + ')', c))
  // MessagesView có router riêng trong scope module giống component thật.
  const source = read('src/views/MessagesView.vue').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  vm.runInContext('{'+source+';globalThis.messageCall = {startVoiceCall,currentRoom}}', c)
  c.messageCall.currentRoom.value = { isDirect: true, ext: '2000' }
  await c.messageCall.startVoiceCall(); await drain()
  assert.equal(router.currentRoute.value.path, '/calls')
  assert.equal(router.currentRoute.value.query.number, '2000')
  assert.equal(router.currentRoute.value.query.autocall, 'true')
})

test('Chat group: một thành viên cũng đi qua bộ lọc nhóm; thất bại không chuyển trang/gửi tin', async () => {
  const c = messageCallView(); let sent = 0, checked = []
  c.chatService.sendMessage = async () => { sent++ }
  c.wazoService.startGroupCall = async targets => { checked = [...targets]; return { success: false, reason: 'NO_AVAILABLE_TARGETS' } }
  await c.messageCall.startVoiceCall()
  assert.deepEqual(checked, ['2000']); assert.equal(sent, 0); assert.equal(c.navigations.length, 0)
  assert.equal(c.messageCall.isStartingVoiceCall.value, false)
})

test('Chat group: chờ thành công, khóa bấm lặp và thông báo đúng phòng ban đầu', async () => {
  const c = messageCallView(), pending = deferred(), sent = []; let count = 0
  c.wazoService.startGroupCall = () => { count++; return pending.promise }
  c.chatService.sendMessage = async id => { sent.push(id) }
  const first = c.messageCall.startVoiceCall(); await c.messageCall.startVoiceCall()
  assert.equal(count, 1); assert.equal(sent.length, 0); assert.equal(c.navigations.length, 0)
  c.messageCall.currentRoom.value = { id: 'different', isDirect: true }
  pending.resolve({ success: true }); await first
  assert.deepEqual(sent, ['room']); assert.deepEqual(c.navigations, ['/calls'])
  assert.equal(c.messageCall.isStartingVoiceCall.value, false)
})

test('Chat group: logout trong lúc chờ không điều hướng/gửi thông báo muộn', async () => {
  const c = messageCallView(), pending = deferred(); let sent = 0
  c.wazoService.startGroupCall = () => pending.promise
  c.chatService.sendMessage = async () => { sent++ }
  const first = c.messageCall.startVoiceCall()
  vm.runInContext('invalidateSession()', c)
  pending.resolve({ success: true }); await first
  assert.equal(sent, 0); assert.equal(c.navigations.length, 0)
})

test('Chat group: exception giải phóng khóa; hủy xác nhận không gọi dịch vụ', async () => {
  const c = messageCallView(); let calls = 0
  c.wazoService.startGroupCall = async () => { calls++; throw new Error('network') }
  await c.messageCall.startVoiceCall()
  assert.equal(c.messageCall.isStartingVoiceCall.value, false); assert.equal(c.navigations.length, 0)
  c.confirm = () => false
  await c.messageCall.startVoiceCall(); assert.equal(calls, 1)
})

test('Group filter: bỏ talking/holding/ringing/progressing/DND/offline và máy không rõ', async () => {
  const c = service(fixture(), 'contactService', 'globalThis.contacts = contactService')
  service(c, 'wazo', 'globalThis.svc = wazoService')
  const states = ['available', 'talking', 'holding', 'ringing', 'progressing', 'unavailable']
  c.contacts.currentContacts = states.map((state, index) => ({ uuid: 'peer-' + index, number: String(2000 + index), status: 'online' }))
  states.forEach((state, index) => { c.contacts.presences['peer-' + index] = { state: 'available', lines: [{state}] } })
  c.contacts.currentContacts.push({ uuid: 'dnd', number: '3000' }, { uuid: 'offline', number: '3001' })
  c.contacts.presences.dnd = { state: 'available', do_not_disturb: true, lines: [{ state: 'available' }] }
  c.contacts.presences.offline = { state: 'offline', lines: [{ state: 'available' }] }
  const dialed = []
  c.svc.validateAndMakeCall = async number => { dialed.push(number); return { success: true } }
  const result = await c.svc.startGroupCall(['1000', ...c.contacts.currentContacts.map(c => c.number), 'unknown', '2000'])
  assert.equal(result.success, true); assert.deepEqual(dialed, ['2000']); assert.equal(c.svc.isGroupCall, false)
  c.contacts.presences['peer-0'] = { state: 'offline' }
  assert.equal((await c.svc.startGroupCall(['2000', '2001'])).reason, 'NO_AVAILABLE_TARGETS')
  assert.deepEqual(dialed, ['2000'])
})


test('Group filter: còn hai người khả dụng thì tạo nhóm, không đưa người bị loại vào danh sách mời', async () => {
  const c = wazo(), dialed = []
  c.svc.getMyExtension = () => '1000'
  c.contactService.isContactAvailableForCall = ext => ['2000', '2001'].includes(ext)
  c.svc.validateAndMakeCall = async (number, meta) => { dialed.push({ number, meta }); return { success: true } }
  c.svc.broadcastGroupStateViaPresence = noop
  const result = await c.svc.startGroupCall(['2000', '2001', '3000', '2000', '1000'])
  assert.equal(result.success, true); assert.equal(c.svc.isGroupHost, true)
  assert.deepEqual([...c.svc.groupParticipantExtensions], ['1000', '2000', '2001'])
  assert.equal(dialed[0].number, '2000'); assert.equal(dialed[0].meta.isGroupCall, true)
})


test('Chat refresh: lần đầu loading, quay lại KeepAlive đồng bộ nền không che phòng hiện có', async () => {
  const c = fixture(), first = deferred(), refresh = deferred(); let requests = 0
  c.chatService.rooms = []
  c.chatService.getRooms = () => (++requests === 1 ? first.promise : refresh.promise)
  view(c, 'src/views/MessagesView.vue', 'globalThis.ui = { loadRooms, currentRoom, isLoadingRooms, rooms }')
  const loading = c.ui.loadRooms()
  assert.equal(c.ui.isLoadingRooms.value, true)
  const room = { id: 'r', messages: [{ id: 'm', text: 'Có sẵn' }] }
  first.resolve([room]); await loading
  c.ui.currentRoom.value = c.ui.rooms.value[0]
  c.hooks.deactivated[0]()
  const activated = c.hooks.activated[0]()
  assert.equal(c.ui.isLoadingRooms.value, false)
  assert.equal(c.ui.currentRoom.value.messages[0].text, 'Có sẵn')
  refresh.resolve([{ ...room, title: 'Mới' }]); await activated
  assert.equal(c.ui.currentRoom.value.title, 'Mới'); assert.equal(requests, 2)
})

test('Chat cache: mở view/phòng đã có dữ liệu không che lịch sử trong lúc tải', async () => {
  const c = fixture(), pending = deferred()
  c.chatService.rooms = [{ id: 'r', messages: [{ id: 'm', text: 'Cũ' }] }]
  c.chatService.saveRooms = noop
  c.chatService.getRooms = () => pending.promise
  c.chatService.getRoomMessages = () => pending.promise
  view(c, 'src/views/MessagesView.vue', 'globalThis.ui = { loadRooms, selectRoom, rooms, isLoadingRooms, isLoadingMessages, currentRoom }')
  const load = c.ui.loadRooms()
  assert.equal(c.ui.isLoadingRooms.value, false)
  const select = c.ui.selectRoom(c.ui.rooms.value[0])
  assert.equal(c.ui.isLoadingMessages.value, false)
  assert.equal(c.ui.currentRoom.value.messages[0].text, 'Cũ')
  pending.resolve([]); await Promise.all([load, select])
})

test('Login hint: ẩn mặc định, chỉ hiện với lỗi kết nối và xóa khi thử lại', async () => {
  const c = fixture()
  view(c, 'src/views/LoginView.vue', 'globalThis.ui = {handleLogin, username, password, showCertificateHint}')
  c.ui.username.value = 'account'; c.ui.password.value = 'password'
  assert.equal(c.ui.showCertificateHint.value, false)
  const cases = [
    [new TypeError('Failed to fetch'), true],
    [new Error('certificate verify failed'), true],
    [Object.assign(new Error('Network error'), { status: 401 }), false],
    [Object.assign(new Error('server'), { response: { status: 503 } }), false],
    [new Error('Invalid credentials'), false],
    [new Error('Timeout'), false],
    [new TypeError('Cannot read properties of undefined'), false],
  ]
  c.console = { ...console, error: noop }
  for (const [error, expected] of cases) {
    c.wazoService.login = async () => { throw error }
    await c.ui.handleLogin(); assert.equal(c.ui.showCertificateHint.value, expected, error.message)
  }
  c.wazoService.login = async () => { throw new TypeError('Failed to fetch') }
  await c.ui.handleLogin()
  const pending = deferred(); c.wazoService.login = () => pending.promise
  const retry = c.ui.handleLogin()
  assert.equal(c.ui.showCertificateHint.value, false)
  pending.reject(new Error('Invalid credentials')); await retry
})
