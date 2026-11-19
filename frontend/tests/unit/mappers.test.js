import { expect, it } from 'vitest'
import { mapDirectoryContacts } from '../../src/features/contacts/mappers/contactMapper.js'
import { mapCallHistoryRecord } from '../../src/features/history/mappers/callHistoryMapper.js'
import { getFeatures } from '../../src/config/features.js'

it('danh bạ dạng items giữ UUID, số máy lẻ và trạng thái yêu thích', () => {
  const [contact] = mapDirectoryContacts(
    {
      items: [
        {
          uuid: 'u',
          id: 'raw',
          firstname: 'An',
          lastname: 'Nguyễn',
          lines: [{ extensions: [{ exten: '4321' }] }],
        },
      ],
    },
    { favoriteIds: ['4321'] },
  )
  expect(contact).toMatchObject({
    uuid: 'u',
    rawId: 'raw',
    name: 'An Nguyễn',
    number: '4321',
    isFavorite: true,
  })
})
it('danh bạ bảng cột giữ ID cột, quan hệ UUID và số callable', () => {
  const [contact] = mapDirectoryContacts({
    column_types: ['id', 'name', 'callable', 'department'],
    results: [{ column_values: ['raw', 'An', '4321', 'Kỹ thuật'], relations: { user_uuid: 'u' } }],
  })
  expect(contact).toMatchObject({ id: 'u', rawId: 'raw', number: '4321', dept: 'Kỹ thuật' })
})
it('phân biệt danh bạ rỗng hợp lệ và schema không hỗ trợ', () => {
  expect(mapDirectoryContacts({ items: [] })).toEqual([])
  expect(mapDirectoryContacts({ results: [], column_types: [] })).toEqual([])
  expect(mapDirectoryContacts({ error: 'unsupported' })).toBeNull()
})
it('mapper không sửa dữ liệu đầu vào hoặc danh sách yêu thích', () => {
  const item = Object.freeze({ uuid: 'u', number: '4321', favorited: true })
  const favorites = Object.freeze([])
  expect(
    mapDirectoryContacts({ items: Object.freeze([item]) }, { favoriteIds: favorites })[0]
      .isFavorite,
  ).toBe(true)
  expect(favorites).toEqual([])
})
it.each([
  ['internal', '1000', false, 'outbound', 'declined'],
  ['internal', '4321', false, 'inbound', 'missed'],
  ['inbound', '1000', true, 'inbound', 'success'],
  ['outbound', '4321', true, 'outbound', 'success'],
])(
  'CDR %s nguồn %s trả đúng chiều/trạng thái',
  (call_direction, source_extension, answered, direction, status) => {
    expect(
      mapCallHistoryRecord(
        {
          id: 'cdr',
          call_direction,
          source_extension,
          destination_extension: '2000',
          answered,
          recordings: [{ uuid: 'rec' }],
        },
        { myExtension: '1000' },
      ),
    ).toMatchObject({ direction, status, hasRecording: true })
  },
)
it('cấu hình trình duyệt cũ không bật lại cờ dữ liệu giả', () => {
  localStorage.setItem(
    'smartcall_features_config',
    JSON.stringify({ mockData: true, calls: false, messages: 'invalid' }),
  )
  expect(getFeatures()).toEqual({ calls: false, messages: true, history: true })
  localStorage.removeItem('smartcall_features_config')
})
