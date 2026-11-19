import { createApp, h, reactive, nextTick } from 'vue'

/** Mount component Vue thật; không sửa source, không giả lập watcher/lifecycle. */
export function mountComponent(component, { props = {}, plugins = [] } = {}) {
  const values = reactive(props)
  const element = document.createElement('div')
  document.body.appendChild(element)
  const app = createApp({ render: () => h(component, values) })
  for (const plugin of plugins) app.use(plugin)
  app.mount(element)
  return {
    element,
    get state() {
      return app._instance.subTree.component.setupState
    },
    async setProps(next) {
      Object.assign(values, next)
      await nextTick()
    },
    unmount() {
      app.unmount()
      element.remove()
    },
  }
}

/** Chờ chuỗi promise và scheduler Vue trong test component. */
export async function flushUi() {
  for (let index = 0; index < 8; index++) await Promise.resolve()
  await nextTick()
}
