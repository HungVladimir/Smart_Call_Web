import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Cấu hình build ứng dụng Web; không khởi tạo kết nối tổng đài. */
export default defineConfig({
  plugins: [vue()],
  // Giữ /api ở request; FastAPI khai báo prefix này tường minh, không dùng root_path thay route.
  server: {
    port: 8800,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8801', changeOrigin: false } },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
