import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { nextTick } from 'vue'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'
const auth = vi.hoisted(() => ({
  getSingleIdProfile: vi.fn(),
  completeSingleIdLogin: vi.fn(),
  beginSingleIdLogin: vi.fn(),
  endSingleIdSession: vi.fn(),
  logoutSingleId: vi.fn(),
  cancelSingleIdLogin: vi.fn(),
}))
vi.mock('@/services/index.js', () => ({ authService: auth }))
import CallbackView from '../../src/views/CallbackView.vue'
let router, wrapper

beforeEach(async () => {
  localStorage.clear()
  vi.resetAllMocks()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/callback', component: CallbackView },
      { path: '/calls', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  })
  await router.push('/callback')
  auth.getSingleIdProfile.mockResolvedValue({
    profile: { name: 'Fixture', email: 'fixture@samsung.com', department: 'D', employee_id: 'EP1' },
    csrf_token: 'csrf',
  })
})
afterEach(() => wrapper?.unmount())

it('có profile nhưng chưa cấu hình Wazo thì vẫn hiển thị hồ sơ và lỗi dễ hiểu, không hiện token', async () => {
  auth.completeSingleIdLogin.mockRejectedValue(new Error('Cần cấu hình Wazo'))
  wrapper = mountComponent(CallbackView, { plugins: [router] })
  await flushUi()
  expect(wrapper.element.textContent).toContain('fixture@samsung.com')
  expect(wrapper.element.textContent).toContain('EP1')
  expect(wrapper.element.textContent).toContain('Cần cấu hình Wazo')
  expect(wrapper.element.textContent).not.toContain('Access Token')
  expect(router.currentRoute.value.path).toBe('/callback')
})

it('chỉ công bố đăng nhập sau khi AuthService tiếp nhận session thành công', async () => {
  let finish
  auth.completeSingleIdLogin.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  wrapper = mountComponent(CallbackView, { plugins: [router] })
  await flushUi()
  expect(localStorage.getItem('smartcall_logged_in')).toBeNull()
  finish()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/calls'))
  expect(localStorage.getItem('smartcall_logged_in')).toBe('true')
})

it('rời callback khi chờ hủy tác vụ, không điều hướng khi kết quả đến muộn', async () => {
  let finish
  auth.completeSingleIdLogin.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  wrapper = mountComponent(CallbackView, { plugins: [router] })
  await flushUi()
  wrapper.unmount()
  wrapper = null
  expect(auth.cancelSingleIdLogin).toHaveBeenCalled()
  finish()
  await nextTick()
  await flushUi()
  expect(localStorage.getItem('smartcall_logged_in')).toBeNull()
})

it('callback có nút logout SSO để đổi tài khoản, lỗi được giữ trên trang', async () => {
  auth.completeSingleIdLogin.mockRejectedValue(new Error('Chưa cấu hình Wazo'))
  auth.logoutSingleId.mockRejectedValue(new Error('IdP logout chưa sẵn sàng'))
  wrapper = mountComponent(CallbackView, { plugins: [router] })
  await flushUi()
  const button = [...wrapper.element.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Đăng xuất Single ID'),
  )
  expect(button).toBeTruthy()
  button.click()
  await flushUi()
  expect(auth.logoutSingleId).toHaveBeenCalledTimes(1)
  expect(auth.beginSingleIdLogin).not.toHaveBeenCalled()
  expect(wrapper.element.textContent).toContain('IdP logout chưa sẵn sàng')
  expect(router.currentRoute.value.path).toBe('/callback')
})
