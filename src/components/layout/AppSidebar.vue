<template>
  <aside class="app-sidebar">
    <ul class="sidebar-menu">
      <li>
        <router-link to="/dashboard" class="nav-btn" active-class="active">
          <span class="icon">📊</span>
          <span>Tổng quan</span>
        </router-link>
      </li>

      <li>
        <router-link to="/calls" class="nav-btn" active-class="active">
          <span class="icon">📞</span>
          <span>Gọi điện & Bàn phím</span>
        </router-link>
      </li>

      <li>
        <router-link to="/contacts" class="nav-btn" active-class="active">
          <span class="icon">📇</span>
          <span>Danh bạ</span>
          <span class="badge-count">12</span>
        </router-link>
      </li>

      <li>
        <router-link to="/messages" class="nav-btn" active-class="active">
          <span class="icon">💬</span>
          <span>Tin nhắn</span>
          <span class="badge-count">3</span>
        </router-link>
      </li>

      <li>
        <router-link to="/history" class="nav-btn" active-class="active">
          <span class="icon">🕒</span>
          <span>Lịch sử cuộc gọi</span>
        </router-link>
      </li>
    </ul>

    <div class="sidebar-footer">
      <div>SIP: <code>1001@192.168.1.50</code></div>
      <div class="webrtc-status">● WebRTC Audio Ready</div>
    </div>
  </aside>
</template>

<script setup>
// Sidebar logic
</script>

<style scoped>
.app-sidebar {
  width: 220px;
  background: #262c34;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-right: 1px solid #1a1e24;
  user-select: none;
  height: 100%;
}

.sidebar-menu {
  list-style: none;
  padding: 15px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  margin: 0;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  color: #94a3b8;
  border-radius: 8px;
  text-decoration: none;
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 500;
  transition: all 0.2s;
}

.nav-btn:hover {
  background: #323a45;
  color: white;
}

.nav-btn.active {
  background: #1e88e5;
  color: white;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(30, 136, 229, 0.4);
}

.nav-btn .icon {
  font-size: 1.15rem;
  width: 22px;
  text-align: center;
}

.badge-count {
  margin-left: auto;
  background: #e74c3c;
  color: white;
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: bold;
}

.sidebar-footer {
  padding: 12px 15px;
  border-top: 1px solid #343a40;
  font-size: 0.75rem;
  color: #64748b;
  background: #20252c;
}

.sidebar-footer code {
  color: #cbd5e1;
  font-family: monospace;
}

.webrtc-status {
  margin-top: 4px;
  color: #4ade80;
  font-weight: 500;
}
</style>

