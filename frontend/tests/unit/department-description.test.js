import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invalidateSession } from '../../src/services/auth/sessionScope.js'
import { mapDirectoryContacts } from '../../src/utils/contactMapper.js'
import { mapUserProfile } from '../../src/utils/userProfile.js'
import { useContactFilters } from '../../src/composables/useContactFilters.js'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))

it('description ưu tiên hơn department cũ và marker SSO không thành phòng ban', () => {
  const contacts = mapDirectoryContacts({
    items: [
      {
        uuid: 'peer',
        description: '  AI   Part(SDV) ',
        department: 'Old',
        userfield: 'smartcall:sso:hash',
      },
      { uuid: 'other', userfield: 'smartcall:sso:hash' },
    ],
  })
  expect(contacts[0].dept).toBe('AI Part(SDV)')
  expect(contacts[1].dept).toBe('')
})

it('danh bạ bảng cột description đi vào tìm kiếm và chip bộ phận', () => {
  app.contactService.currentContacts = mapDirectoryContacts({
    column_types: ['name', 'description'],
    results: [
      { relations: { user_uuid: 'peer' }, column_values: ['Employee', 'AI Part(SDV)'] },
      { relations: { user_uuid: 'other' }, column_values: ['Other', 'HR'] },
    ],
  })
  const filters = useContactFilters({
    getContacts: () => app.contactService.currentContacts,
    isAvailableForCall: () => true,
    getCurrentExtension: () => '',
  })
  filters.activeTab.value = 'department'
  filters.selectedDepartment.value = 'AI Part(SDV)'
  expect(filters.filteredContacts.value.map((contact) => contact.uuid)).toEqual(['peer'])
  expect(filters.departmentTabCount.value).toBe(1)
  filters.activeTab.value = 'all'
  filters.searchTerm.value = 'ai part'
  expect(filters.filteredContacts.value.map((contact) => contact.uuid)).toEqual(['peer'])
})

it('Dird thiếu description thì lấy theo lô từ Confd bằng UUID, không dùng API backend riêng', async () => {
  fetch.mockResolvedValue(
    response({ items: [{ uuid: 'peer', description: 'AI Part(SDV)' }], total: 1 }),
  )
  const contacts = await app.contactService.loadContactDescriptions([
    { uuid: 'peer', dept: '', description: '' },
  ])
  expect(contacts[0].dept).toBe('AI Part(SDV)')
  expect(fetch.mock.calls[0][0]).toContain('/api/confd/1.1/users?recurse=true&limit=100&offset=0')
  expect(fetch.mock.calls[0][1].headers['X-Auth-Token']).toBe('fixture-token')
})

it('Dird đã trả description thì không phát thêm GET Confd', async () => {
  const contacts = [{ uuid: 'peer', description: 'AI', dept: 'AI' }]
  expect(await app.contactService.loadContactDescriptions(contacts)).toEqual(contacts)
  expect(fetch).not.toHaveBeenCalled()
})

it('Confd từ chối quyền vẫn giữ danh bạ hiện tại', async () => {
  fetch.mockResolvedValue(response({}, 403))
  const contacts = [{ uuid: 'peer', dept: 'Existing' }]
  expect(await app.contactService.loadContactDescriptions(contacts)).toEqual(contacts)
})

it('description trả sau logout không cập nhật danh bạ phiên mới', async () => {
  const pending = deferred()
  fetch.mockReturnValue(pending.promise)
  const loading = app.contactService.loadContactDescriptions([{ uuid: 'old' }])
  const rejected = expect(loading).rejects.toMatchObject({ name: 'StaleSessionError' })
  app.authService.logout()
  pending.resolve(response({ items: [{ uuid: 'old', description: 'Old private dept' }] }))
  await rejected
  expect(app.contactService.currentContacts).toEqual([])
})

it('hồ sơ đăng nhập ưu tiên description và bỏ userfield kỹ thuật', () => {
  expect(
    mapUserProfile({ uuid: 'a', profile: { department: 'Old' } }, { description: 'AI' }).department,
  ).toBe('AI')
  expect(mapUserProfile({ uuid: 'a' }, { userfield: 'smartcall:sso:hash' }).department).toBe('')
})

/** Kiểm tra hai người gọi cùng chia kết quả và lỗi tải không bị báo thành cập nhật mới. */
async function checkSharedDirectoryRefresh() {
  const pending = deferred()
  const favorites = vi.spyOn(app.contactService, 'fetchFavorites').mockResolvedValue([])
  app.contactService.currentContacts = [{ uuid: 'cached' }]
  fetch.mockReturnValue(pending.promise)

  const firstRefresh = app.contactService.refreshDirectory()
  const secondRefresh = app.contactService.refreshDirectory()
  const backgroundContacts = app.contactService.getContacts()

  expect(secondRefresh).toBe(firstRefresh)
  pending.resolve(response({}, 503))
  expect(await firstRefresh).toEqual({ status: 'cached', contacts: [{ uuid: 'cached' }] })
  expect(await backgroundContacts).toEqual([{ uuid: 'cached' }])
  expect(favorites).toHaveBeenCalledTimes(1)
}

/** Danh bạ rỗng do API trả thành công vẫn ghi đè dữ liệu cũ trong phiên hiện tại. */
async function checkEmptyDirectoryRefresh() {
  vi.spyOn(app.contactService, 'fetchFavorites').mockResolvedValue([])
  app.contactService.currentContacts = [{ uuid: 'cached' }]
  fetch
    .mockResolvedValueOnce(response({ items: [{ uuid: 'source', name: 'wazo' }] }))
    .mockResolvedValueOnce(response({ items: [] }))

  expect(await app.contactService.refreshDirectory()).toEqual({ status: 'updated', contacts: [] })
  expect(app.contactService.currentContacts).toEqual([])
}

/** Khi đổi phiên giữa lúc tải, lượt cũ không đọc danh bạ đang thuộc phiên mới. */
async function checkCancelledDirectoryRefresh() {
  const pending = deferred()
  vi.spyOn(app.contactService, 'fetchFavorites').mockResolvedValue([])
  fetch.mockReturnValue(pending.promise)
  const refresh = app.contactService.refreshDirectory()
  await Promise.resolve()

  invalidateSession()
  app.contactService.reset()
  app.contactService.currentContacts = [{ uuid: 'new-session' }]
  pending.resolve(response({}, 503))

  expect(await refresh).toEqual({ status: 'cancelled', contacts: [] })
  expect(app.contactService.currentContacts).toEqual([{ uuid: 'new-session' }])
}

it('chia sẻ lượt tải danh bạ và báo rõ dữ liệu cũ', checkSharedDirectoryRefresh)
it('chấp nhận danh bạ rỗng được xác nhận từ Dird', checkEmptyDirectoryRefresh)
it('dừng lượt tải danh bạ của phiên đã đổi', checkCancelledDirectoryRefresh)
