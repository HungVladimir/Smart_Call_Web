<template>
  <div class="smart-call-login">
    <!-- Nền trang trí ambient mềm mại -->
    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>

    <!-- Header tối giản, thanh lịch -->
    <header class="top-bar">
      <div class="brand-left">
        <img src="/app-icon.webp" alt="SmartCall" class="brand-logo-img" />
        <span class="brand-title">SmartCall</span>
      </div>
    </header>

    <!-- Thân chính: Card đăng nhập hiện đại nổi khối -->
    <main class="login-wrapper">
      <div class="login-card">
        <!-- Logo & Tiêu đề Form -->
        <div class="card-header">
          <div class="logo-wrapper">
            <img src="/app-icon.webp" alt="SmartCall" class="main-logo-img" />
          </div>
          <h1 class="welcome-title">Đăng nhập SmartCall</h1>
          <p class="welcome-desc">Hệ thống liên lạc & Tổng đài thoại nội bộ doanh nghiệp</p>
        </div>

        <!-- Form Đăng nhập -->
        <form @submit.prevent="handleLogin" class="auth-form">
          <!-- Ô Tên đăng nhập / Số máy lẻ -->
          <div class="form-group">
            <label class="input-label" for="login-username">Tài khoản / Số máy lẻ</label>
            <div class="input-box">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <input
                id="login-username"
                type="text"
                v-model="username"
                placeholder="Ví dụ: 1001 hoặc ten.nhanvien"
                required
                autocomplete="username"
                :disabled="loading"
              />
            </div>
          </div>

          <!-- Ô Mật khẩu -->
          <div class="form-group">
            <div class="label-row">
              <label class="input-label" for="login-password">Mật khẩu</label>
            </div>
            <div class="input-box">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                id="login-password"
                :type="showPassword ? 'text' : 'password'"
                v-model="password"
                placeholder="Nhập mật khẩu của bạn"
                required
                autocomplete="current-password"
                :disabled="loading"
              />
              <button
                type="button"
                class="btn-toggle-eye"
                @click="showPassword = !showPassword"
                tabindex="-1"
                :title="showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
              >
                <!-- SVG Mắt mở -->
                <svg v-if="showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <!-- SVG Mắt gạch chéo -->
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Thông báo lỗi khi đăng nhập không thành công -->
          <transition name="alert-slide">
            <div v-if="errorMessage" class="error-banner">
              <svg class="error-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div class="error-banner-text">{{ errorMessage }}</div>
            </div>
          </transition>

          <!-- Ghi nhớ đăng nhập -->
          <div class="options-row">
            <label class="remember-label">
              <input type="checkbox" v-model="rememberMe" />
              <span class="custom-checkbox"></span>
              <span class="label-text">Ghi nhớ đăng nhập trên thiết bị này</span>
            </label>
          </div>

          <!-- Nút Đăng nhập chính -->
          <button type="submit" class="btn-primary-login" :disabled="loading">
            <span v-if="loading" class="btn-spinner"></span>
            <span>{{ loading ? 'Đang xác thực thông tin...' : 'ĐĂNG NHẬP VÀO HỆ THỐNG' }}</span>
            <svg v-if="!loading" class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>

          <!-- Dải phân cách -->
          <div class="auth-divider">
            <span class="divider-line"></span>
            <span class="divider-text">HOẶC</span>
            <span class="divider-line"></span>
          </div>

          <!-- Nút Chạy chế độ thử nghiệm Offline -->
          <button
            type="button"
            class="btn-offline-mode"
            @click="enterOfflineMode"
            :disabled="loading"
            title="Khởi chạy giao diện sử dụng dữ liệu mẫu nội bộ"
          >
            <svg class="offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 21h8m-4-4v4" />
            </svg>
            <span>Chạy chế độ thử nghiệm Offline</span>
          </button>
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

const username = ref(localStorage.getItem('smartcall_remembered_username') || '')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(true)
const loading = ref(false)
const errorMessage = ref('')

const handleLogin = async () => {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) return

  loading.value = true
  errorMessage.value = ''

  let realDisplayName = ''
  let realExtension = ''

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout máy chủ Wazo')), 3500),
    )
    await Promise.race([wazoService.login(u, p), timeoutPromise])

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

    // Ghi nhớ tên đăng nhập nếu bật Remember me
    if (rememberMe.value) {
      localStorage.setItem('smartcall_remembered_username', u)
    } else {
      localStorage.removeItem('smartcall_remembered_username')
    }

    const finalName = realDisplayName || u
    const finalExt = realExtension || '1001'

    localStorage.setItem('smartcall_username', finalName)
    localStorage.setItem('smartcall_extension', finalExt)
    localStorage.setItem('smartcall_role', 'user')
    localStorage.setItem('smartcall_is_admin', 'false')
    localStorage.setItem('smartcall_logged_in', 'true')

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `Đăng nhập thành công! Xin chào ${finalName}`, type: 'success' },
      }),
    )

    window.dispatchEvent(new CustomEvent('app-login-success'))
    loading.value = false
    router.push('/dashboard')
  } catch (err) {
    loading.value = false

    // Phân loại nguyên nhân lỗi để thông báo rõ ràng cho người dùng
    let msg = ''
    if (
      err.status === 401 ||
      err.response?.status === 401 ||
      err.message?.includes('401') ||
      err.message?.toLowerCase().includes('unauthorized') ||
      err.message?.toLowerCase().includes('credentials')
    ) {
      msg = 'Tên đăng nhập hoặc mật khẩu không chính xác.'
    } else if (err.message?.includes('Timeout') || err.message?.includes('timeout')) {
      msg = 'Không thể kết nối đến máy chủ tổng đài (Hết thời gian chờ). Vui lòng kiểm tra lại mạng nội bộ.'
    } else if (
      err.name === 'TypeError' ||
      err.message?.includes('Failed to fetch') ||
      err.message?.includes('Network')
    ) {
      msg = 'Lỗi mạng hoặc trình duyệt chặn SSL máy chủ tổng đài.'
    } else {
      msg = 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản hoặc kết nối mạng.'
    }

    errorMessage.value = msg

    // Bắn Toast thông báo nổi toàn cục
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: msg, type: 'error' },
      }),
    )
  }
}

// Chạy ứng dụng ở chế độ thử nghiệm Offline (Sử dụng dữ liệu mẫu, không cần kết nối máy chủ tổng đài)
const enterOfflineMode = () => {
  const fallbackUser = username.value.trim() || 'Người dùng thử nghiệm'
  localStorage.setItem('smartcall_username', fallbackUser)
  localStorage.setItem('smartcall_extension', '1001')
  localStorage.setItem('smartcall_role', 'user')
  localStorage.setItem('smartcall_is_admin', 'false')
  localStorage.setItem('smartcall_logged_in', 'true')
  localStorage.setItem('smartcall_offline_mode', 'true')
  localStorage.setItem('smartcall_wazo_token', 'offline_mode_token')

  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: 'Đang khởi chạy giao diện ở chế độ thử nghiệm Offline', type: 'info' },
    }),
  )

  window.dispatchEvent(new CustomEvent('app-login-success'))
  router.push('/dashboard')
}
</script>

<style scoped>
/* --- Reset & Layout Nền --- */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.smart-call-login {
  min-height: 100vh;
  background-color: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Helvetica, Arial, sans-serif;
  color: #1e293b;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow-x: hidden;
}

/* Ánh sáng trang trí ambient nền tạo độ sâu cho giao diện hiện đại */
.ambient-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
  z-index: 0;
}

.glow-1 {
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.08) 0%, rgba(37, 99, 235, 0) 70%);
  top: -100px;
  left: -100px;
}

.glow-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.07) 0%, rgba(14, 165, 233, 0) 70%);
  bottom: -120px;
  right: -100px;
}

/* --- Top Bar (Header tinh gọn chuẩn Enterprise) --- */
.top-bar {
  position: relative;
  z-index: 1;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 28px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.brand-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo-img {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  object-fit: contain;
}

.brand-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.3px;
}

/* --- Vùng thân chính & Card đăng nhập --- */
.login-wrapper {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

.login-card {
  width: 100%;
  max-width: 440px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  box-shadow:
    0 10px 25px -5px rgba(15, 23, 42, 0.05),
    0 8px 10px -6px rgba(15, 23, 42, 0.03),
    0 0 1px 1px rgba(15, 23, 42, 0.02);
  padding: 36px 32px 28px;
  display: flex;
  flex-direction: column;
}

/* Card Header */
.card-header {
  text-align: center;
  margin-bottom: 26px;
}

.logo-wrapper {
  display: inline-flex;
  padding: 8px;
  background: #f1f5f9;
  border-radius: 20px;
  margin-bottom: 14px;
  border: 1px solid #e2e8f0;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
}

.main-logo-img {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  object-fit: contain;
}

.welcome-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.4px;
  margin-bottom: 6px;
}

.welcome-desc {
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.4;
}

/* --- Form Fields --- */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #334155;
}

.input-box {
  position: relative;
  display: flex;
  align-items: center;
  background-color: #f8fafc;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.input-box:focus-within {
  background-color: #ffffff;
  border-color: #2563eb;
  box-shadow: 0 0 0 3.5px rgba(37, 99, 235, 0.12);
}

.input-icon {
  width: 18px;
  height: 18px;
  color: #94a3b8;
  margin-left: 12px;
  flex-shrink: 0;
  transition: color 0.2s;
}

.input-box:focus-within .input-icon {
  color: #2563eb;
}

.input-box input {
  flex: 1;
  width: 100%;
  border: none;
  background: transparent;
  padding: 11px 12px 11px 10px;
  font-size: 0.92rem;
  color: #0f172a;
  outline: none;
  font-family: inherit;
}

.input-box input::placeholder {
  color: #94a3b8;
  font-size: 0.88rem;
}

.input-box input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn-toggle-eye {
  background: none;
  border: none;
  padding: 8px 12px;
  cursor: pointer;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}

.btn-toggle-eye:hover {
  color: #475569;
}

.btn-toggle-eye svg {
  width: 18px;
  height: 18px;
}

/* --- Thông báo lỗi --- */
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  padding: 10px 12px;
  color: #991b1b;
}

.error-banner-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 2px;
  color: #dc2626;
}

.error-banner-text {
  font-size: 0.84rem;
  line-height: 1.45;
  font-weight: 500;
}

.alert-slide-enter-active,
.alert-slide-leave-active {
  transition: all 0.25s ease-out;
}

.alert-slide-enter-from,
.alert-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* --- Options: Remember Me --- */
.options-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.remember-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.remember-label input {
  width: 16px;
  height: 16px;
  accent-color: #2563eb;
  cursor: pointer;
  border-radius: 4px;
}

.label-text {
  font-size: 0.83rem;
  color: #475569;
  font-weight: 500;
}

/* --- Nút Đăng nhập chính --- */
.btn-primary-login {
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
  color: #ffffff;
  border: none;
  border-radius: 10px;
  padding: 12px 18px;
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 4px;
}

.btn-primary-login:hover:not(:disabled) {
  background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  transform: translateY(-1px);
}

.btn-primary-login:active:not(:disabled) {
  transform: translateY(0);
}

.btn-primary-login:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn-arrow {
  width: 16px;
  height: 16px;
  transition: transform 0.2s;
}

.btn-primary-login:hover:not(:disabled) .btn-arrow {
  transform: translateX(3px);
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* --- Dải phân cách --- */
.auth-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0;
}

.divider-line {
  flex: 1;
  height: 1px;
  background-color: #e2e8f0;
}

.divider-text {
  font-size: 0.72rem;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

/* --- Nút Chế độ thử nghiệm Offline --- */
.btn-offline-mode {
  width: 100%;
  background-color: #f8fafc;
  color: #475569;
  border: 1.5px dashed #cbd5e1;
  padding: 10px 14px;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-offline-mode:hover:not(:disabled) {
  background-color: #eff6ff;
  color: #2563eb;
  border-color: #93c5fd;
  transform: translateY(-1px);
}

.btn-offline-mode:active:not(:disabled) {
  transform: translateY(0);
}

.btn-offline-mode:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.offline-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* --- Responsive Mobile --- */
@media (max-width: 480px) {
  .top-bar {
    padding: 0 16px;
  }

  .login-card {
    padding: 28px 20px 22px;
    border-radius: 14px;
  }

  .welcome-title {
    font-size: 1.35rem;
  }
}
</style>
