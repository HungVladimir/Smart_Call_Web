import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope } from 'vue'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import { mapUserProfile } from '../../src/utils/userProfile.js'
import { useRecordingPlayer } from '../../src/composables/useRecordingPlayer.js'
import { useMicrophoneMeter } from '../../src/composables/useMicrophoneMeter.js'

let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => {
  disposeFixture(app)
})

it('favorites HTTP500 trả lỗi và không đổi state', async () => {
  const contact = { id: 'peer', uuid: 'peer', number: '4321', isFavorite: false }
  fetch.mockResolvedValue(response({}, 500))
  await expect(app.contactService.toggleFavorite(contact)).rejects.toThrow(/500/)
  expect(contact.isFavorite).toBe(false)
  expect(app.contactService.favoriteIds).toHaveLength(0)
})

it('favorites 204 commit một lần dù người dùng bấm trùng', async () => {
  const pending = deferred(),
    contact = { id: 'peer', uuid: 'peer', number: '4321', isFavorite: false }
  fetch.mockImplementation(() => pending.promise)
  const a = app.contactService.toggleFavorite(contact),
    b = app.contactService.toggleFavorite(contact)
  expect(contact.isFavorite).toBe(false)
  pending.resolve(response({}, 204))
  await expect(a).resolves.toBe(true)
  await expect(b).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(contact.isFavorite).toBe(true)
})

it('xóa nhóm trả chính xác kết quả từng phần', async () => {
  app.chatService.deleteRoom = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error('HTTP500'))
  expect(await app.chatService.deleteMultipleRooms(['a', 'b'])).toEqual({
    deletedIds: ['a'],
    failures: [{ roomId: 'b', message: 'HTTP500' }],
  })
})

it('room state cập nhật computed khi thay danh sách', () => {
  const count = computed(() => app.chatService.rooms.length)
  expect(count.value).toBe(0)
  app.chatService.rooms = [{ id: 'a' }]
  expect(count.value).toBe(1)
  app.chatService.reset()
  expect(count.value).toBe(0)
})

it('nested presence cập nhật computed thực', () => {
  const presence = computed(() => app.contactService.presences.peer?.state || 'offline')
  expect(presence.value).toBe('offline')
  app.contactService.presences.peer = { state: 'available' }
  expect(presence.value).toBe('available')
})

it('lịch sử happy path normalize bản ghi server', async () => {
  fetch.mockResolvedValue(
    response({
      items: [
        {
          id: 10,
          call_direction: 'inbound',
          answered: true,
          source_extension: '4321',
          source_name: 'Fixture',
          start: '2026-11-19T00:00:00Z',
          duration: 12,
        },
      ],
    }),
  )
  const calls = await app.historyService.getHistory()
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    id: 10,
    direction: 'inbound',
    extension: '4321',
    answered: true,
  })
})

it('hai lần force refresh cùng phiên chỉ nhận kết quả mới nhất', async () => {
  const a = deferred(),
    b = deferred()
  fetch.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
  const old = app.historyService.getHistory({ forceRefresh: true }),
    latest = app.historyService.getHistory({ forceRefresh: true })
  b.resolve(response({ items: [{ id: 'new', source_extension: '4321' }] }))
  await latest
  a.resolve(response({ items: [{ id: 'old', source_extension: '4321' }] }))
  await old
  expect(app.historyService.localHistory[0].id).toBe('new')
})

it('cài đặt chưa tải không ghi đè DND/forward', async () => {
  const result = await app.settingsService.saveCallServices(
    { dnd: false, forwards: { busy: '', noanswer: '', unconditional: '' } },
    { dnd: null, forwards: null },
  )
  expect(fetch).not.toHaveBeenCalled()
  expect(result.failures).toHaveLength(0)
})

it('cài đặt đã tải nhưng không đổi không phát PUT', async () => {
  const baseline = { dnd: true, forwards: { busy: '4321', noanswer: '', unconditional: '' } }
  await app.settingsService.saveCallServices(
    { dnd: true, forwards: { ...baseline.forwards } },
    baseline,
  )
  expect(fetch).not.toHaveBeenCalled()
})

it('save cài đặt thất bại giữ baseline để thử lại', async () => {
  fetch.mockResolvedValue(response({}, 500))
  const result = await app.settingsService.saveCallServices(
    { dnd: false, forwards: {} },
    { dnd: true, forwards: null },
  )
  expect(result.baseline.dnd).toBe(true)
  expect(result.failures[0]).toMatch(/500/)
})

it('mapper lấy máy lẻ thật Confd khi SDK chưa có number', () => {
  expect(
    mapUserProfile(
      { uuid: 'a', displayName: () => 'Fixture' },
      { lines: [{ extensions: [{ exten: '4321' }] }] },
      'user',
    ),
  ).toMatchObject({
    userUuid: 'a',
    extension: '4321',
    displayName: 'Fixture',
  })
})

it('mapper không tạo số máy lẻ giả', () => {
  expect(mapUserProfile({ uuid: 'a' }).extension).toBe('')
})

it('player chỉ phát kết quả mới nhất và bỏ kết quả sau khi dừng', async () => {
  const pending = {},
    played = []
  vi.stubGlobal(
    'Audio',
    class {
      constructor(url) {
        this.url = url
      }
      async play() {
        played.push(this.url)
      }
      pause() {}
      removeAttribute() {}
      load() {}
    },
  )
  const scope = effectScope()
  const player = scope.run(() =>
    useRecordingPlayer({
      canPlay: () => true,
      recordingService: {
        getAudioUrlForCall: (call) => {
          pending[call.id] = deferred()
          return pending[call.id].promise
        },
      },
    }),
  )
  const a = player.togglePlayCall({ id: 'a' }),
    b = player.togglePlayCall({ id: 'b' })
  pending.b.resolve('audio-b')
  await b
  pending.a.resolve('audio-a')
  await a
  expect(played).toEqual(['audio-b'])
  const c = player.togglePlayCall({ id: 'c' })
  scope.stop()
  pending.c.resolve('audio-c')
  await c
  expect(played).toEqual(['audio-b'])
})

it('microphone trả muộn sau scope dispose được stop ngay', async () => {
  const pending = deferred(),
    stopped = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => pending.promise },
  })
  const scope = effectScope()
  const meter = scope.run(() =>
    useMicrophoneMeter({ isActive: () => true, getMicrophoneId: () => 'default' }),
  )
  const starting = meter.startMicMeter()
  scope.stop()
  pending.resolve({ getTracks: () => [{ stop: stopped }] })
  await starting
  expect(stopped).toHaveBeenCalledTimes(1)
})

it('lookup UUID đọc được schema danh bạ bảng cột', async () => {
  fetch.mockResolvedValue(
    response({
      column_types: ['number'],
      results: [{ column_values: ['4321'], relations: { user_uuid: 'peer' } }],
    }),
  )
  expect(await app.contactService.resolveUserUuid('4321')).toBe('peer')
})

it('favorite đang chờ của phiên cũ không khóa thao tác cùng contact trong phiên mới', async () => {
  const old = deferred(),
    newer = deferred()
  fetch.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => newer.promise)
  const first = app.contactService.toggleFavorite({ id: 'peer', isFavorite: false })
  const rejected = expect(first).rejects.toMatchObject({ name: 'StaleSessionError' })
  const { invalidateSession } = await import('../../src/services/auth/sessionScope.js')
  invalidateSession()
  app.contactService.reset()
  localStorage.setItem('smartcall_user_uuid', 'b')
  const contact = { id: 'peer', isFavorite: false }
  const second = app.contactService.toggleFavorite(contact)
  expect(fetch).toHaveBeenCalledTimes(2)
  newer.resolve(response({}, 204))
  await second
  old.resolve(response({}, 204))
  await rejected
  expect(contact.isFavorite).toBe(true)
})
