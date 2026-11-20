import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createFixture, disposeFixture } from '../helpers/createFixture.js'
import { mountComponent, flushUi } from '../helpers/mountComponent.js'

const ports = vi.hoisted(() => ({ services: {} }))
vi.mock('@/services/index.js', () => ports.services)
let app, wrapper
beforeEach(() => {
  app = createFixture()
  Object.assign(ports.services, app)
})
afterEach(() => {
  wrapper?.unmount()
  disposeFixture(app)
})

it('thu hồi phiên đóng Settings, bỏ view/cache riêng tư và hiện login cùng lý do', async () => {
  let destroyed = false
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/calls',
        name: 'Calls',
        component: {
          template: '<div>PRIVATE VIEW</div>',
          unmounted() {
            destroyed = true
          },
        },
      },
      { path: '/login', name: 'Login', component: { template: '<div>LOGIN VIEW</div>' } },
      { path: '/messages', component: { template: '<div />' } },
      { path: '/history', component: { template: '<div />' } },
    ],
  })
  await router.push('/calls')
  await router.isReady()
  const { default: App } = await import('../../src/App.vue')
  wrapper = mountComponent(App, { plugins: [router] })
  await flushUi()
  expect(wrapper.element.textContent).toContain('PRIVATE VIEW')
  wrapper.state.showSettings = true
  app.authService.handleSessionRevocation()
  await nextTick()
  expect(wrapper.element.textContent).not.toContain('PRIVATE VIEW')
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'))
  await flushUi()
  expect(wrapper.state.showSettings).toBe(false)
  expect(wrapper.state.showKickedModal).toBe(true)
  expect(wrapper.element.textContent).not.toContain('PRIVATE VIEW')
  expect(destroyed).toBe(true)
  expect(router.currentRoute.value.path).toBe('/login')
  await app.authService.sdkCleanupPromise
})
