<template>
  <section class="groups-view calls-view">
    <header class="groups-header">
      <h1>Gọi nhóm</h1>
      <button type="button" :disabled="busy" @click="createGroup">Tạo nhóm</button>
    </header>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">Đang tải nhóm…</p>
    <p v-else-if="!groups.length && !editor">Chưa có nhóm đã lưu.</p>
    <div class="group-grid">
      <article v-for="group in groups" :key="group.id" class="group-card">
        <h2>{{ group.name }}</h2>
        <p>{{ group.members.length }} đồng nghiệp</p>
        <div class="group-actions">
          <button type="button" :disabled="busy || callState.activeCall" @click="callGroup(group)">
            Gọi
          </button>
          <button type="button" :disabled="busy" @click="editGroup(group)">Sửa</button>
          <button type="button" :disabled="busy" @click="removeGroup(group)">Xóa</button>
        </div>
      </article>
    </div>
    <section v-if="editor" class="group-editor">
      <form class="group-card" @submit.prevent="submitGroup">
        <h2>{{ editor.id ? 'Sửa nhóm' : 'Tạo nhóm' }}</h2>
        <label
          >Tên nhóm <input v-model="editor.name" required maxlength="100" :disabled="busy"
        /></label>
        <p>Đã chọn {{ editor.members.length }} đồng nghiệp</p>
        <ul>
          <li v-for="member in editor.members" :key="member.uuid">
            {{ member.name }}
            <button type="button" :disabled="busy" @click="toggleMember(member)">Bỏ</button>
          </li>
        </ul>
        <div class="group-actions">
          <button :disabled="busy || !editor.name.trim() || editor.members.length < 2">
            Lưu nhóm
          </button>
          <button type="button" :disabled="busy" @click="editor = null">Hủy</button>
        </div>
      </form>
      <PagedContactsPanel
        :active="active"
        picker
        :busy="busy"
        :my-extension="myExtension"
        :selected-ids="selectedIds"
        :load-page="loadPage"
        :refresh-presence="refreshPresence"
        @toggle-member="toggleMember"
      />
    </section>
  </section>
</template>

<script setup>
import { computed, onActivated, onDeactivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import PagedContactsPanel from '@/components/contacts/PagedContactsPanel.vue'
import { authService, callService, contactService, groupCallService } from '@/services/index.js'
import {
  deleteCallGroup,
  listCallGroups,
  saveCallGroup,
} from '@/services/data/callGroupsService.js'
import { captureSessionContext, isSessionContextCurrent } from '@/services/auth/sessionScope.js'
import { callState } from '@/state/callState.js'

const router = useRouter()
const groups = ref([])
const editor = ref(null)
const active = ref(false)
const busy = ref(false)
const loading = ref(false)
const notice = ref('')
const error = ref('')
let version = 0

/** Lấy danh sách UUID đã chọn để thẻ ở trang khác đánh dấu đúng. */
const selectedIds = computed(() => editor.value?.members.map(memberId) || [])
/** Bỏ số của chính người dùng khỏi bộ chọn. */
const myExtension = computed(() => authService.getCurrentExtension())

/** Lấy định danh ổn định của thành viên nhóm. */
function memberId(member) {
  return member.uuid
}

/** Chỉ áp kết quả của màn hiện tại và phiên vẫn còn hiệu lực. */
function stillActive(context, viewVersion) {
  return active.value && version === viewVersion && isSessionContextCurrent(context)
}

/** Đọc lại nhóm khi chuyển từ màn gọi hoặc lịch sử về đây. */
async function loadGroups() {
  active.value = true
  const viewVersion = ++version
  const context = captureSessionContext()
  loading.value = true
  error.value = ''
  try {
    const items = await listCallGroups(authService.getToken())
    if (stillActive(context, viewVersion)) groups.value = items
  } catch (failure) {
    if (stillActive(context, viewVersion)) error.value = failure.message
  } finally {
    if (stillActive(context, viewVersion)) loading.value = false
  }
}

/** Chặn cập nhật từ request cũ sau khi rời màn và bỏ bản sửa chưa lưu. */
function hideGroups() {
  active.value = false
  editor.value = null
  busy.value = false
  version += 1
}
onActivated(loadGroups)
onDeactivated(hideGroups)

/** Khởi tạo biểu mẫu mới để chọn đồng nghiệp bằng danh bạ phân trang. */
function createGroup() {
  error.value = ''
  editor.value = { id: '', name: '', members: [] }
}

/** Tra lại thành viên qua UUID và giữ mục đã rời danh bạ để người dùng có thể bỏ. */
async function editGroup(group) {
  await perform(async (context, viewVersion) => {
    const contacts = await contactService.getSavedGroupMembers(group.members)
    if (!stillActive(context, viewVersion)) return
    const byId = new Map(contacts.map((contact) => [contact.uuid, contact]))
    editor.value = {
      id: group.id,
      name: group.name,
      members: group.members.map(
        (uuid) => byId.get(uuid) || { uuid, name: 'Liên hệ không còn trong danh bạ' },
      ),
    }
  })
}

/** Chọn hoặc bỏ một UUID mà không phụ thuộc máy lẻ hay trang đang xem. */
function toggleMember(contact) {
  if (busy.value || !editor.value || !contact.uuid) return
  const members = editor.value.members
  const index = members.findIndex((member) => member.uuid === contact.uuid)
  if (index >= 0) members.splice(index, 1)
  else if (members.length < 100) members.push(contact)
  else error.value = 'Mỗi nhóm lưu tối đa 100 đồng nghiệp.'
}

/** Khóa thao tác lúc chờ backend và ngăn kết quả muộn từ view cũ. */
async function perform(action) {
  if (busy.value) return
  const context = captureSessionContext()
  const viewVersion = version
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action(context, viewVersion)
  } catch (failure) {
    if (stillActive(context, viewVersion)) error.value = failure.message
  } finally {
    if (stillActive(context, viewVersion)) busy.value = false
  }
}

/** Thêm hoặc cập nhật danh sách sau ACK từ backend. */
async function submitGroup() {
  const draft = editor.value
  if (!draft) return
  await perform(async (context, viewVersion) => {
    const saved = await saveCallGroup(
      authService.getToken(),
      draft.id,
      draft.name,
      selectedIds.value,
    )
    if (!stillActive(context, viewVersion)) return
    groups.value = [...groups.value.filter((group) => group.id !== saved.id), saved]
    editor.value = null
    notice.value = 'Đã lưu nhóm.'
  })
}

/** Xóa sau khi người dùng xác nhận đúng nhóm. */
async function removeGroup(group) {
  if (!confirm('Xóa nhóm ' + group.name + '?')) return
  await perform(async (context, viewVersion) => {
    await deleteCallGroup(authService.getToken(), group.id)
    if (!stillActive(context, viewVersion)) return
    groups.value = groups.value.filter((item) => item.id !== group.id)
    if (editor.value?.id === group.id) editor.value = null
    notice.value = 'Đã xóa nhóm.'
  })
}

/** Lấy máy lẻ mới nhất, kiểm tra presence và gọi nhóm qua luồng host hiện có. */
async function callGroup(group) {
  if (callState.activeCall || callService.isDialing) return
  await perform(async (context, viewVersion) => {
    const members = await contactService.getSavedGroupMembers(group.members)
    const result = await contactService.prepareGroupTargets(members)
    if (!stillActive(context, viewVersion) || callState.activeCall || callService.isDialing) return
    const missing = group.members.length - members.length
    const rejected = [...result.rejected]
    if (missing) rejected.push(missing + ' liên hệ không còn trong danh bạ')
    if (!result.extensions.length) {
      notice.value = ['Không có thành viên khả dụng.', ...rejected].join(' ')
      return
    }
    if (rejected.length) notice.value = 'Không thể mời ' + rejected.join(', ')
    if (
      result.extensions.length === 1 &&
      !confirm('Chỉ còn một người khả dụng. Gọi riêng người này?')
    )
      return
    if (
      rejected.length &&
      result.extensions.length > 1 &&
      !confirm(notice.value + '. Tiếp tục gọi ' + result.extensions.length + ' người còn lại?')
    )
      return
    let started = await groupCallService.startGroupCall(result.extensions, {
      groupTitle: group.name,
      requireGroupConfirmation: true,
    })
    if (!stillActive(context, viewVersion)) return
    if (started?.reason === 'TARGET_AVAILABILITY_CHANGED' && started.extension) {
      if (!confirm('Chỉ còn một người khả dụng. Gọi riêng người này?')) return
      started = await callService.startCall(started.extension, {
        expectedUuid: started.expectedUuid,
      })
      if (!stillActive(context, viewVersion)) return
    }
    if (!started?.success) {
      error.value = 'Chưa bắt đầu được cuộc gọi. Kiểm tra trạng thái rồi thử lại.'
      return
    }
    await router.push({ path: '/calls', query: { active: 'true' } })
  })
}

/** Đọc kết quả chọn thành viên từ dịch vụ danh bạ. */
function loadPage(query) {
  return contactService.searchPublishedDirectory(query)
}

/** Cập nhật presence của trang bộ chọn đang mở. */
function refreshPresence(contacts, force) {
  void contactService.refreshDirectoryPresence(contacts, force)
}
</script>

<style scoped>
.groups-view {
  margin: 0 auto;
  max-width: 1200px;
  padding: 16px;
}
.groups-header,
.group-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.groups-header {
  justify-content: space-between;
}
.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
}
.group-card {
  background: var(--card-bg, #fff);
  border: 1px solid #dbe4ef;
  border-radius: 12px;
  padding: 16px;
}
.group-card h2 {
  margin-top: 0;
  font-size: 1.1rem;
}
.group-editor {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: 12px;
  margin-top: 16px;
}
.group-editor input {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 8px;
}
.group-editor li {
  margin: 6px 0;
}
.groups-view button {
  padding: 6px 10px;
  border: 1px solid #bac9e0;
  border-radius: 6px;
  cursor: pointer;
}
.groups-view button:disabled {
  cursor: default;
  opacity: 0.6;
}
@media (max-width: 680px) {
  .group-editor {
    grid-template-columns: 1fr;
  }
}
</style>
