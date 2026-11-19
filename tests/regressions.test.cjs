const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { reactive, shallowReactive, ref, computed } = require('vue')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const noop = () => {}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => '', blob: async () => ({ size: 1 }) })

// Execute application logic with browser/SDK/network boundaries replaced, never the real SDK.
function fixture() {
  const values = new Map([['smartcall_user_uuid', 'a'], ['smartcall_wazo_token', 'fixture']])
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }
  const events = [], timers = new Map(), hooks = { mounted: [], activated: [], deactivated: [], unmounted: [] }
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
    chatService: { reset: noop }, websocketService: { on: noop, emit: noop }, Wazo: { Phone: phone, Auth: {} },
    document: { getElementById: () => null, querySelectorAll: () => [] }, navigator: {},
    window: { dispatchEvent: (e) => events.push(e), addEventListener: noop, removeEventListener: noop },
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
  const c = wazo(), pending = deferred(), hung = []
  c.state.activeCall = { callId: 'old', number: 'peer', status: 'connected' }
  c.svc.currentCallSession = {}; c.svc.isGroupCall = c.svc.isGroupHost = true
  c.contactService.isContactAvailableForCall = () => true
  c.svc.broadcastGroupStateViaPresence = noop; c.svc.broadcastNoticeToGroup = noop; c.svc.setPresence = async () => {}
  c.Wazo.Phone.call = () => pending.promise; c.Wazo.Phone.hangup = async (session) => hung.push(session)
  const inviting = c.svc.addParticipantsToGroupCall(['4321'])
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
