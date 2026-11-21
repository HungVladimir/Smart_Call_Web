<template>
  <main class="callback-panel">
    <h1>Đăng nhập Single ID</h1>
    <p role="status">{{ status }}</p>
    <dl v-if="profile">
      <dt>Họ tên</dt>
      <dd>{{ profile.name }}</dd>
      <dt>Email</dt>
      <dd>{{ profile.email }}</dd>
      <dt>Mã nhân viên</dt>
      <dd>{{ profile.employee_id || 'Chưa được IdP cung cấp' }}</dd>
      <dt>Bộ phận</dt>
      <dd>{{ profile.department || 'Chưa được IdP cung cấp' }}</dd>
    </dl>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <div class="callback-actions">
      <button v-if="profile && errorMessage" :disabled="working" @click="connectWazo">
        Thử kết nối Wazo lại
      </button>
      <button v-if="profile" :disabled="working" @click="logoutSingleId">
        Đăng xuất Single ID / Đổi tài khoản
      </button>
      <button v-else :disabled="working" @click="restartLogin">Đăng nhập Single ID</button>
      <button :disabled="working" @click="returnToLogin">Về trang đăng nhập</button>
    </div>
  </main>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { authService } from '@/services/index.js'

const router = useRouter()
const route = useRoute()
const profile = ref(null)
const status = ref('Đang kiểm tra phiên Single ID…')
const errorMessage = ref('')
const working = ref(false)
let active = true
let completed = false
let csrfToken = ''

/** Lấy phiên Wazo qua backend rồi công bố đăng nhập khi SDK đã chấp nhận đúng user. */
async function connectWazo() {
  if (working.value || !active) return
  working.value = true
  errorMessage.value = ''
  status.value = 'Đã xác thực Single ID. Đang tìm hoặc cấp tài khoản Wazo…'
  try {
    await authService.completeSingleIdLogin(csrfToken)
    if (!active) return
    completed = true
    localStorage.setItem('smartcall_logged_in', 'true')
    window.dispatchEvent(new CustomEvent('app-login-success'))
    await router.replace('/calls')
  } catch (error) {
    if (!active) return
    status.value = 'Đã nhận hồ sơ Single ID; chưa hoàn tất kết nối Wazo.'
    errorMessage.value = error.message
  } finally {
    working.value = false
  }
}

/** Kết thúc SSO; lỗi backend vẫn giữ hồ sơ để người dùng thử lại. */
async function logoutSingleId() {
  if (working.value) return
  working.value = true
  errorMessage.value = ''
  try {
    await authService.logoutSingleId()
  } catch (error) {
    if (active) errorMessage.value = error.message
  } finally {
    working.value = false
  }
}

/** Bắt đầu giao dịch OIDC mới; không tái sử dụng code/state của lần trước. */
function restartLogin() {
  authService.beginSingleIdLogin()
}

/** Hủy phiên tạm khi rời callback theo nút quay lại đăng nhập. */
async function returnToLogin() {
  await authService.endSingleIdSession().catch(() => {})
  await router.replace('/login')
}

// Callback là route công khai nhưng profile chỉ được API cookie backend xác minh trả về.
onMounted(async () => {
  if (route.query.error) {
    status.value = 'Single ID chưa hoàn tất đăng nhập.'
    errorMessage.value = 'Yêu cầu đã bị từ chối hoặc hủy ở IdP. Vui lòng đăng nhập lại.'
    return
  }
  try {
    const data = await authService.getSingleIdProfile()
    if (!active) return
    profile.value = data.profile
    csrfToken = data.csrf_token
    await connectWazo()
  } catch (error) {
    if (active) {
      status.value = 'Không lấy được hồ sơ Single ID.'
      errorMessage.value = error.message
    }
  }
})

// Không điều hướng hoặc ghi UI sau khi người dùng đã rời callback.
onUnmounted(() => {
  active = false
  if (working.value && !completed) authService.cancelSingleIdLogin()
})
</script>

<style scoped>
.callback-panel {
  width: min(640px, 100% - 40px);
  margin: 48px auto;
  padding: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 16px;
  background: white;
  color: #0f172a;
}
h1 {
  margin-bottom: 20px;
}
p {
  margin: 14px 0;
  line-height: 1.6;
}
dl {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  margin: 24px 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: #b91c1c;
}
.callback-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
button {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #94a3b8;
  cursor: pointer;
  background: #eff6ff;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
</style>
