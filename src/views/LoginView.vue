<template>
  <div class="smart-call-login">
    <!-- Header giống hình: Nền tối, Logo bên trái -->
    <header class="top-bar">
      <div class="logo-area">
        <svg
          class="icon-logo"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="#1e88e5"
          stroke="white"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
          ></path>
        </svg>
        <span class="app-name">SmartCall</span>
      </div>
    </header>

    <!-- Main Content: Centered như hình -->
    <main class="login-body">
      <div class="center-wrapper">
        <!-- Logo lớn ở giữa -->
        <div class="main-logo-container">
          <svg
            class="big-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="#1e88e5"
            stroke="white"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            ></path>
          </svg>
        </div>

        <!-- Tiêu đề -->
        <h1 class="title">SmartCall</h1>

        <!-- Form Login -->
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="input-group">
            <input type="text" v-model="username" placeholder="" required autocomplete="off" />
          </div>

          <div class="input-group">
            <input
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder="PASSWORD"
              required
            />
            <button type="button" class="toggle-eye" @click="showPassword = !showPassword"></button>
          </div>

          <button type="submit" class="btn-submit">LOGIN</button>

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

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(false)

const handleLogin = () => {
  console.log('Đăng nhập:', { username: username.value, password: password.value })
  // Logic đăng nhập tại đây
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