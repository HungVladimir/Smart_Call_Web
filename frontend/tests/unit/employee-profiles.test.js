import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import { useContactFilters } from '../../src/composables/useContactFilters.js'
import { mapDirectoryContacts } from '../../src/utils/contactMapper.js'

let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))

it('department IdP được nối vào danh bạ và bộ lọc phản ứng theo hồ sơ từng người', async () => {
  fetch.mockResolvedValue(
    response({
      items: [
        {
          user_uuid: 'peer',
          name: 'Employee',
          department: 'AI Transformation Part(SDV)',
          has_avatar: true,
        },
      ],
    }),
  )
  app.contactService.currentContacts = await app.contactService.enrichDirectoryContacts([
    { uuid: 'peer', name: 'Old', dept: '', number: '2000' },
    { uuid: 'other', dept: 'HR', number: '2001' },
  ])
  const filters = useContactFilters({
    getContacts: () => app.contactService.currentContacts,
    isAvailableForCall: () => true,
    getCurrentExtension: () => '1000',
  })
  filters.activeTab.value = 'department'
  filters.selectedDepartment.value = ' ai   transformation part(sdv) '
  expect(filters.filteredContacts.value.map((contact) => contact.uuid)).toEqual(['peer'])
  expect(filters.departmentTabCount.value).toBe(1)
  expect(app.contactService.currentContacts[0].hasEmployeeAvatar).toBe(true)
})

it('chip phòng ban gộp khác hoa thường/khoảng trắng và all đếm cả liên hệ chưa có dept', () => {
  app.contactService.currentContacts = [{ dept: ' AI  Part ' }, { dept: 'ai part' }, { dept: '' }]
  const filters = useContactFilters({
    getContacts: () => app.contactService.currentContacts,
    isAvailableForCall: () => true,
    getCurrentExtension: () => '',
  })
  filters.activeTab.value = 'department'
  expect(filters.availableDepartments.value).toEqual(['AI Part'])
  expect(filters.departmentTabCount.value).toBe(3)
  expect(filters.filteredContacts.value).toHaveLength(3)
})

it('marker SSO không trở thành phòng ban trong danh bạ', () => {
  const contacts = mapDirectoryContacts({
    items: [{ uuid: 'peer', userfield: 'smartcall:sso:hash' }],
  })
  expect(contacts[0].dept).toBe('')
})

it('hồ sơ dùng chung chia batch tối đa 100 UUID và giữ danh bạ khi backend chưa sẵn sàng', async () => {
  fetch.mockResolvedValue(response({ items: [] }))
  await app.contactService.getSharedProfiles(
    Array.from({ length: 205 }, (_, index) => 'user-' + index),
  )
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(
    new URL(fetch.mock.calls[0][0], 'http://localhost').searchParams.getAll('user_uuid'),
  ).toHaveLength(100)
  fetch.mockResolvedValue(response({}, 503))
  const contacts = [{ uuid: 'peer', dept: 'Existing', name: 'Existing' }]
  expect(await app.contactService.enrichDirectoryContacts(contacts)).toEqual(contacts)
})

it('avatar gộp request theo UUID, dùng header token và thu hồi URL khi reset', async () => {
  fetch.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['photo'], { type: 'image/png' }),
  })
  const urls = await Promise.all([
    app.contactService.getEmployeeAvatar('peer'),
    app.contactService.getEmployeeAvatar('peer'),
  ])
  expect(urls).toEqual(['blob:fixture', 'blob:fixture'])
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/auth/directory-profiles/peer/avatar')
  expect(fetch.mock.calls[0][1].headers['X-Auth-Token']).toBe('fixture-token')
  app.contactService.reset()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture')
})

it('avatar trả muộn sau logout không tạo ObjectURL hoặc lẫn dữ liệu phiên mới', async () => {
  const pending = deferred()
  fetch.mockReturnValue(pending.promise)
  const loading = app.contactService.getEmployeeAvatar('peer')
  app.authService.logout()
  pending.resolve({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/png' }) })
  expect(await loading).toBe('')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('HTML thay ảnh bị bỏ qua và cache lỗi có thời hạn để có thể thử lại', async () => {
  fetch.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['login'], { type: 'text/html' }),
  })
  expect(await app.contactService.getEmployeeAvatar('peer')).toBe('')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60001)
  fetch.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['photo'], { type: 'image/jpeg' }),
  })
  expect(await app.contactService.getEmployeeAvatar('peer')).toBe('blob:fixture')
})
