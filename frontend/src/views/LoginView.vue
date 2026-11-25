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
              <UiIcon name="user" class="input-icon" />
              <input
                id="login-username"
                type="text"
                v-model="username"
                placeholder="Ví dụ: alice hoặc bob (Tài khoản tổng đài)"
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
              <UiIcon name="lock" class="input-icon" />
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
                <UiIcon name="eye" v-if="showPassword" />
                <!-- SVG Mắt gạch chéo -->
                <UiIcon name="eye-off" v-else />
              </button>
            </div>
          </div>

          <!-- Thông báo lỗi khi đăng nhập không thành công -->
          <transition name="alert-slide">
            <div v-if="errorMessage" class="error-banner">
              <UiIcon name="warning-outline" class="error-banner-icon" />
              <div class="error-banner-text">{{ errorMessage }}</div>
            </div>
          </transition>

          <!-- Ghi nhớ đăng nhập & Quên mật khẩu -->
          <div class="options-row">
            <label class="remember-label">
              <input type="checkbox" v-model="rememberMe" />
              <span class="custom-checkbox"></span>
              <span class="label-text">Ghi nhớ đăng nhập trên thiết bị này</span>
            </label>
            <a href="#" class="forgot-password-link" @click.prevent="openForgotModal"
              >Quên mật khẩu?</a
            >
          </div>

          <!-- Nút Đăng nhập chính -->
          <button type="submit" class="btn-primary-login" :disabled="loading">
            <span v-if="loading" class="btn-spinner"></span>
            <span>{{ loading ? 'Đang xác thực thông tin...' : 'ĐĂNG NHẬP VÀO HỆ THỐNG' }}</span>
            <UiIcon name="forward" v-if="!loading" class="btn-arrow" />
          </button>

          <!-- Điều hướng toàn trang tới backend để bắt đầu giao dịch OIDC. -->
          <button
            type="button"
            class="btn-primary-login"
            :disabled="loading"
            @click="authService.beginSingleIdLogin()"
          >
            ĐĂNG NHẬP SINGLE ID
          </button>

          <!-- Gợi ý xác nhận chứng chỉ SSL -->
          <div v-if="showCertificateHint" class="ssl-cert-hint">
            <UiIcon name="info-outline" class="hint-icon" />
            <span
              >Nếu chưa tin cậy chứng chỉ máy chủ, mở
              <a
                :href="`https://${serverHost}/`"
                target="_blank"
                rel="noopener noreferrer"
                class="hint-link"
                >https://{{ serverHost }}/</a
              >
              để xác nhận tin cậy chứng chỉ máy chủ.</span
            >
          </div>
        </form>
      </div>

      <!-- Modal Quên / Đặt lại mật khẩu qua Email (Auth API) -->
      <div
        v-if="showForgotModal"
        class="forgot-modal-backdrop"
        @click.self="showForgotModal = false"
      >
        <div class="forgot-modal-card">
          <div class="forgot-modal-header">
            <h3><UiIcon name="key" /> Lấy Lại Mật Khẩu</h3>
            <button type="button" class="btn-close-modal" @click="showForgotModal = false">
              <UiIcon name="close-text" />
            </button>
          </div>
          <div class="forgot-modal-body">
            <p class="forgot-desc">
              Nhập tên đăng nhập hoặc địa chỉ email tài khoản tổng đài của bạn. Hệ thống sẽ phát
              liên kết đặt lại mật khẩu đến hòm thư email công ty.
            </p>
            <div class="form-group">
              <label class="input-label" for="resetInput">Tên đăng nhập hoặc Email:</label>
              <div class="input-box">
                <input
                  id="resetInput"
                  v-model="resetIdentifier"
                  type="text"
                  class="input-field"
                  placeholder="VD: user1 hoặc user@company.com"
                  @keyup.enter="handleResetPassword"
                />
              </div>
            </div>
            <div
              v-if="resetMessage"
              class="reset-feedback"
              :class="resetSuccess ? 'success' : 'error'"
            >
              {{ resetMessage }}
            </div>
          </div>
          <div class="forgot-modal-footer">
            <button type="button" class="btn-modal-cancel" @click="showForgotModal = false">
              Hủy
            </button>
            <button
              type="button"
              class="btn-modal-submit"
              :disabled="resetLoading || !resetIdentifier.trim()"
              @click="handleResetPassword"
            >
              {{ resetLoading ? 'Đang gửi...' : 'Gửi liên kết đặt lại' }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import UiIcon, { iconGlyphs } from '@/components/common/UiIcon.vue'
import { getAuthenticationErrorMessage } from '../utils/userProfile.js'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/index.js'

const router = useRouter()

const showForgotModal = ref(false)
const resetIdentifier = ref('')
const resetLoading = ref(false)
const resetMessage = ref('')
const resetSuccess = ref(false)

/** Mở hộp nhập tài khoản/email để yêu cầu tổng đài gửi hướng dẫn đặt lại mật khẩu. */
const openForgotModal = () => {
  resetIdentifier.value = username.value || ''
  resetMessage.value = ''
  resetSuccess.value = false
  showForgotModal.value = true
}

/** Kiểm tra định danh nhập, gọi AuthService reset và phân biệt thông báo thành công/lỗi dịch vụ. */
const handleResetPassword = async () => {
  const val = resetIdentifier.value.trim()
  if (!val) return
  resetLoading.value = true
  resetMessage.value = ''
  try {
    const res = await authService.resetPassword(val)
    if (res.ok || res.status === 204 || res.status === 200) {
      resetSuccess.value = true
      resetMessage.value = `${iconGlyphs['email']} Đã gửi liên kết đặt lại mật khẩu! Vui lòng kiểm tra hộp thư email của bạn.`
    } else if (res.status === 404) {
      resetSuccess.value = false
      resetMessage.value = `${iconGlyphs['error-text']} Không tìm thấy tài khoản với tên đăng nhập hoặc email này.`
    } else if (res.status === 503) {
      resetSuccess.value = false
      resetMessage.value = `${iconGlyphs['warning']} Dịch vụ thư điện tử (Mail Server) của tổng đài chưa được cấu hình. Vui lòng liên hệ Quản trị viên.`
    } else {
      resetSuccess.value = false
      resetMessage.value = `${iconGlyphs['error-text']} Yêu cầu thất bại (Mã lỗi: ${res.status}). Vui lòng thử lại sau!`
    }
  } catch (err) {
    resetSuccess.value = false
    resetMessage.value = `${iconGlyphs['error-text']} Không thể kết nối tới máy chủ tổng đài: ${err.message}`
  } finally {
    resetLoading.value = false
  }
}

const username = ref(localStorage.getItem('smartcall_remembered_username') || '')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(true)
const loading = ref(false)
const errorMessage = ref('')
const showCertificateHint = ref(false)
const serverHost = ref(
  (authService.host || '107.126.11.126:9443').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
)

/**
 * Gửi credential tới AuthService, lưu lựa chọn nhớ tên và điều hướng sau xác thực; không tự tạo
 * token/máy lẻ giả.
 */
/** Chỉ gợi ý kiểm tra chứng chỉ khi request lỗi mạng/TLS; không suy diễn từ lỗi tài khoản hoặc HTTP. */
const shouldShowCertificateHint = (error) => {
  const status = Number(error?.status || error?.response?.status || error?.statusCode)
  const message = String(error?.message || '')
  if (status >= 400 || /\b(?:401|403)\b|unauthorized|credentials/i.test(message)) return false
  return /failed to fetch|fetch failed|network|load failed|certificate|ssl|tls|cert_/i.test(message)
}

const handleLogin = async () => {
  const submittedUsername = username.value.trim()
  if (loading.value || !submittedUsername || !password.value) return
  loading.value = true
  errorMessage.value = ''
  showCertificateHint.value = false
  try {
    await authService.login(submittedUsername, password.value)
    if (rememberMe.value) localStorage.setItem('smartcall_remembered_username', submittedUsername)
    else localStorage.removeItem('smartcall_remembered_username')
    localStorage.setItem('smartcall_logged_in', 'true')
    window.dispatchEvent(new CustomEvent('app-login-success'))
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { type: 'success', message: 'Đăng nhập thành công.' },
      }),
    )
    await router.push('/calls')
  } catch (error) {
    showCertificateHint.value = shouldShowCertificateHint(error)
    errorMessage.value = getAuthenticationErrorMessage(error)
  } finally {
    loading.value = false
  }
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
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Helvetica, Arial, sans-serif;
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

/* --- Options: Remember Me & Forgot Password --- */
.options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.forgot-password-link {
  font-size: 0.82rem;
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}

.forgot-password-link:hover {
  text-decoration: underline;
  color: #1d4ed8;
}

/* Modal Quên mật khẩu */
.forgot-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.forgot-modal-card {
  background: white;
  width: 100%;
  max-width: 420px;
  border-radius: 14px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.forgot-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
}

.forgot-modal-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
}

.btn-close-modal {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: #64748b;
  cursor: pointer;
}

.forgot-modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.forgot-desc {
  font-size: 0.85rem;
  color: #475569;
  line-height: 1.45;
  margin: 0;
}

.reset-feedback {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.82rem;
  line-height: 1.4;
}

.reset-feedback.success {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.reset-feedback.error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.forgot-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}

.btn-modal-cancel {
  padding: 8px 14px;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-modal-submit {
  padding: 8px 16px;
  background: #2563eb;
  border: none;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
}

.btn-modal-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

/* --- Gợi ý chứng chỉ SSL --- */
.ssl-cert-hint {
  margin-top: 10px;
  padding: 8px 12px;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.76rem;
  color: #64748b;
  line-height: 1.4;
}

.hint-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
  color: #3b82f6;
}

.hint-link {
  color: #2563eb;
  font-weight: 500;
  text-decoration: underline;
}

.hint-link:hover {
  color: #1d4ed8;
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
