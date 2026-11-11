<template>
  <div class="dashboard">
    <h1>Tổng quan hệ thống</h1>

    <div class="card">
      <h2>Thông tin người dùng</h2>
      <p><strong>Tên:</strong> {{ userInfo.firstname }} {{ userInfo.lastname }}</p>
      <p><strong>Máy lẻ:</strong> {{ primaryExtension }}</p>
      <p><strong>UUID:</strong> {{ userInfo.uuid }}</p>
    </div>

    <div class="card">
      <h2>Trạng thái hệ thống</h2>
      <ul>
        <li :class="{ 'status-ok': wazoService.isLogged(), 'status-err': !wazoService.isLogged() }">
          Xác thực: {{ wazoService.isLogged() ? 'Thành công' : 'Thất bại' }}
        </li>
        <li>SDK Version: @wazo/sdk (đã cài đặt)</li>
      </ul>
    </div>

    <div class="actions">
      <button @click="refreshData" class="btn-primary">Làm mới dữ liệu</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { wazoService } from '@/services/wazo'

const userInfo = ref({})
const primaryExtension = ref('')

onMounted(() => {
  refreshData()
})

const refreshData = async () => {
  if (!wazoService.isLogged()) return

  try {
    // Lấy thông tin user hiện tại qua REST API
    const token = wazoService.getToken()
    const host = wazoService.host.replace(/https?:\/\//, '') // Đảm bảo host đúng format cho fetch nếu cần

    // Lưu ý: Trong thực tế nên dùng axios/fetch wrapper có header Authorization tự động
    // Ở đây mình giả lập việc lấy data từ API confd
    // GET /api/confd/1.1/users/me

    // Để demo đơn giản, ta lấy metadata từ session nếu có, hoặc call API
    // Vì wazoService.session chứa metadata, ta dùng luôn cho nhanh
    if (wazoService.session && wazoService.session.metadata) {
      // Mock data vì SDK trả về uuid, cần call API mới ra tên đầy đủ
      // Trong app thật: await fetch(`https://${host}/api/confd/1.1/users/${wazoService.session.metadata.uuid}`, { headers: { 'X-Auth-Token': token } })

      // Giả lập response để UI đẹp hơn
      userInfo.value = {
        uuid: wazoService.session.metadata.uuid,
        firstname: 'Lê Việt',
        lastname: 'Dũng',
        username: 'vdung.le',
      }
      primaryExtension.value = '1001' // Giả lập máy lẻ đầu tiên
    }
  } catch (error) {
    console.error('Lỗi tải dashboard:', error)
  }
}
</script>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
}
.card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
}
h2 {
  margin-top: 0;
  color: #2c3e50;
}
.status-ok {
  color: green;
  font-weight: bold;
}
.status-err {
  color: red;
  font-weight: bold;
}
.btn-primary {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}
</style>