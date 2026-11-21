import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'
const getAvatar = vi.fn()
const avatarProvider = {
  install(app) {
    app.provide('loadEmployeeAvatar', getAvatar)
  },
}
import EmployeeAvatar from '../../src/components/EmployeeAvatar.vue'
let wrapper
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  getAvatar.mockReset()
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

it('avatar có ảnh hiển thị thumbnail, lỗi ảnh quay về chữ viết tắt', async () => {
  getAvatar.mockResolvedValue('blob:photo')
  wrapper = mountComponent(EmployeeAvatar, {
    plugins: [avatarProvider],
    props: { userUuid: 'peer', fallback: 'NV' },
  })
  await flushUi()
  const image = wrapper.element.querySelector('img')
  expect(image.getAttribute('src')).toBe('blob:photo')
  image.dispatchEvent(new Event('error'))
  await flushUi()
  expect(wrapper.element.querySelector('img')).toBeNull()
  expect(wrapper.element.textContent).toBe('NV')
})

it('liên hệ chưa có ảnh không tải API và vẫn hiển thị fallback', async () => {
  wrapper = mountComponent(EmployeeAvatar, {
    plugins: [avatarProvider],
    props: { userUuid: 'peer', enabled: false, fallback: 'NV' },
  })
  await flushUi()
  expect(getAvatar).not.toHaveBeenCalled()
  expect(wrapper.element.textContent).toBe('NV')
})
