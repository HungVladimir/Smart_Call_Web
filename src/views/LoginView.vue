<template>
  <div class="smart-call-login">
    <!-- Header giống hình: Nền tối, Logo bên trái -->
    <header class="top-bar">
      <div class="logo-area">
        <img src="/app-icon.webp" alt="SmartCall" class="icon-logo-img" />
        <span class="app-name">SmartCall</span>
      </div>
    </header>

    <!-- Main Content: Centered như hình -->
    <main class="login-body">
      <div class="center-wrapper">
        <!-- Logo lớn ở giữa -->
        <div class="main-logo-container">
          <img src="/app-icon.webp" alt="SmartCall" class="big-icon-img" />
        </div>

        <!-- Tiêu đề -->
        <h1 class="title">SmartCall</h1>

        <!-- Form Login -->
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="input-group">
            <input
              type="text"
              v-model="username"
              placeholder="TÊN ĐĂNG NHẬP / MÁY LẺ"
              required
              autocomplete="off"
            />
          </div>

          <div class="input-group">
            <input
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder="MẬT KHẨU"
              required
            />
            <button
              type="button"
              class="toggle-eye"
              @click="showPassword = !showPassword"
              title="Hiện/Ẩn mật khẩu"
            >
              {{ showPassword ? '👁️' : '🔒' }}
            </button>
          </div>

          <button type="submit" class="btn-submit" :disabled="loading">
            {{ loading ? 'ĐANG ĐĂNG NHẬP...' : 'LOGIN' }}
          </button>

          <div class="remember-me">
            <label>
              <input type="checkbox" v-model="rememberMe" />
              Remember me
            </label>
          </div>
        </form>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { wazoService } from '@/services/wazo'

const router = useRouter()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(true)
const loading = ref(false)

const handleLogin = async () => {
  loading.value = true
  let realDisplayName = ''
  let realExtension = ''

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout máy chủ Wazo (2s)')), 2000),
    )
    await Promise.race([wazoService.login(username.value, password.value), timeoutPromise])

    // Khi đăng nhập Wazo thành công -> Lấy thông tin user hiện tại (users/me) theo dev_guide mục 4.1
    const token = wazoService.getToken()
    if (token) {
      const host = wazoService.host.startsWith('http') ? wazoService.host : `https://${wazoService.host}`
      const meRes = await fetch(`${host}/api/confd/1.1/users/me`, {
        headers: { 'X-Auth-Token': token },
      })
      if (meRes.ok) {
        const meData = await meRes.json()
        const fullName = [meData.firstname, meData.lastname].filter(Boolean).join(' ').trim()
        realDisplayName = fullName || meData.username
        realExtension = meData.lines?.[0]?.extensions?.[0]?.exten || ''
      }
    }
  } catch (err) {
    console.log('Chưa kết nối được máy chủ Wazo, tự động chuyển sang chế độ Demo/Fake:', err.message)
  } finally {
    const finalName = realDisplayName || username.value || 'Người dùng'
    const finalExt = realExtension || '1001'

    localStorage.setItem('smartcall_username', finalName)
    localStorage.setItem('smartcall_extension', finalExt)
    localStorage.setItem('smartcall_role', 'user')
    localStorage.setItem('smartcall_is_admin', 'false')
    localStorage.setItem('smartcall_logged_in', 'true')

    window.dispatchEvent(new CustomEvent('app-login-success'))
    loading.value = false
    router.push('/dashboard')
  }
}
</script>

<style scoped>
/* --- Reset & Base --- */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.smart-call-login {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background-color: #e3ebf0; /* Màu nền xám nhạt giống hình */
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* --- Top Bar (Header) --- */
.top-bar {
  background-color: #23272b; /* Nền tối giống hình */
  color: white;
  height: 50px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #3a3f45;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.2rem;
  font-weight: bold;
  color: #1e88e5; /* Chữ xanh dương */
}

.icon-logo-img {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: contain;
}

.big-icon-img {
  width: 76px;
  height: 76px;
  border-radius: 18px;
  object-fit: contain;
  box-shadow: 0 4px 14px rgba(30, 136, 229, 0.25);
}

.icon-logo {
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.5));
}

/* --- Main Body --- */
.login-body {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.center-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 400px;
}

/* --- Logo & Title --- */
.main-logo-container {
  margin-bottom: 10px;
}

.big-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.title {
  color: #1e88e5;
  font-size: 1.8rem;
  font-weight: 600;
  margin-bottom: 30px;
  letter-spacing: -0.5px;
}

/* --- Form --- */
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-group {
  position: relative;
  width: 100%;
}

.input-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ccc; /* Viền xám nhẹ */
  border-radius: 2px; /* Bo góc rất nhỏ hoặc không bo như hình gốc */
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.input-group input:focus {
  border-color: #1e88e5;
}

/* Placeholder styling để giống hình (không có label nổi) */
.input-group input::placeholder {
  color: transparent; /* Ẩn placeholder mặc định nếu muốn */
}

.toggle-eye {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.5;
  font-size: 0.9rem;
}

.btn-submit {
  background-color: #1e88e5; /* Xanh dương đậm */
  color: white;
  border: none;
  padding: 10px;
  font-size: 0.9rem;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 2px;
  transition: background-color 0.2s;
}

.btn-submit:hover {
  background-color: #1565c0;
}

.demo-buttons-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.btn-demo {
  background: transparent;
  color: #1e88e5;
  border: 1px dashed #1e88e5;
  padding: 8px 10px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  text-align: center;
}

.btn-demo-admin {
  background: #fffbeb;
  color: #b45309;
  border-color: #f59e0b;
}

.btn-demo-admin:hover {
  background: #fef3c7;
}

.btn-demo-user {
  background: #f0fdf4;
  color: #047857;
  border-color: #10b981;
}

.btn-demo-user:hover {
  background: #dcfce7;
}

.remember-me {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

.remember-me label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #666;
  cursor: pointer;
}

.remember-me input {
  accent-color: #1e88e5;
}

/* --- Responsive Mobile --- */
@media (max-width: 600px) {
  .top-bar {
    padding: 0 15px;
  }

  .title {
    font-size: 1.5rem;
  }

  .login-form {
    max-width: 90%;
  }
}
</style>