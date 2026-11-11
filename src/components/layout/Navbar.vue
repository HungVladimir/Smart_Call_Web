<template>
  <nav class="navbar" :class="{ mobile: isMobile }">
    <!-- Logo & Brand -->
    <div class="navbar-brand" @click="goHome">
      <div class="logo-icon">📞</div>
      <span class="brand-text">SDV Wazo Web</span>
    </div>

    <!-- Menu Items -->
    <ul class="nav-menu">
      <li v-for="item in navItems" :key="item.path" class="nav-item">
        <router-link :to="item.path" class="nav-link" active-class="active">
          <span class="icon">{{ item.icon }}</span>
          <span class="text">{{ item.label }}</span>
        </router-link>
      </li>
    </ul>

    <!-- User Actions (Logout) -->
    <div class="nav-actions">
      <button @click="$emit('logout')" class="btn-logout">
        <span class="icon">🚪</span>
        <span class="text">Đăng xuất</span>
      </button>
    </div>

    <!-- Mobile Toggle Button (Optional, nếu cần menu hamburger) -->
    <button class="mobile-toggle" @click="toggleMenu" v-if="isMobile">☰</button>
  </nav>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// Định nghĩa các mục menu
const navItems = [
  { path: '/dashboard', label: 'Tổng quan', icon: '📊' },
  { path: '/contacts', label: 'Danh bạ', icon: '📇' },
  { path: '/history', label: 'Lịch sử', icon: '🕒' },
]

// State responsive
const isMobile = ref(false)
const isMenuOpen = ref(false)

// Check screen size
const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

// Methods
const goHome = () => {
  router.push('/dashboard')
}

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value
}
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #2c3e50;
  color: white;
  padding: 0 24px;
  height: 64px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
  z-index: 100;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 1.2rem;
  font-weight: 700;
  transition: opacity 0.2s;
}

.navbar-brand:hover {
  opacity: 0.9;
}

.logo-icon {
  font-size: 1.5rem;
}

.nav-menu {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 5px;
}

.nav-item {
  height: 100%;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ecf0f1;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 6px;
  transition: all 0.2s;
  font-weight: 500;
}

.nav-link:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #3498db;
}

/* Active state handled by router-link-active class */
.nav-link.router-link-active {
  background-color: rgba(52, 152, 219, 0.2);
  color: #3498db;
  border-bottom: 2px solid #3498db;
}

.nav-actions {
  display: flex;
  align-items: center;
}

.btn-logout {
  background: transparent;
  border: 1px solid #e74c3c;
  color: #e74c3c;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-logout:hover {
  background: #e74c3c;
  color: white;
}

.mobile-toggle {
  display: none;
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
}

/* Responsive Styles */
@media (max-width: 768px) {
  .navbar {
    padding: 0 16px;
  }

  .mobile-toggle {
    display: block;
  }

  .nav-menu {
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    background-color: #34495e;
    flex-direction: column;
    padding: 10px 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    display: none; /* Hidden by default on mobile */
  }

  .nav-menu.open {
    display: flex;
  }

  .nav-item {
    width: 100%;
  }

  .nav-link {
    padding: 12px 20px;
    justify-content: flex-start;
  }

  .nav-actions {
    display: none; /* Hide logout button on mobile header, maybe move to menu or keep separate */
  }

  /* Optional: Show logout in mobile menu if needed */
}
</style>