import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import { logger } from '@/core/logging/LoggerService.js'
import '../shared/styles/main.css'

const app = createApp(App)

// Tấm lưới bảo vệ toàn cục: Bắt toàn bộ lỗi giao diện và lifecycle ngầm trong Vue
app.config.errorHandler = (err, instance, info) => {
  logger.error('VUE_CORE', `Lỗi giao diện tại [${info}]: ${err?.message || err}`, {
    stack: err?.stack,
    component: instance?.$options?.name || 'AnonymousComponent',
  })
  console.error('[Vue Global Error]', err, info)
}

// Bắt lỗi Promise bất đồng bộ chưa được try/catch
window.addEventListener('unhandledrejection', (event) => {
  logger.error(
    'ASYNC_PROMISE',
    `Lỗi bất đồng bộ unhandled rejection: ${event.reason?.message || event.reason}`,
  )
})

app.use(router)

app.mount('#app')
