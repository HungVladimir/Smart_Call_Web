<template>
  <section class="groups-view calls-view" :class="{ 'groups-embedded': embedded }">
    <button
      v-if="editor"
      class="group-button group-back"
      type="button"
      :disabled="busy"
      @click="closeEditor"
    >
      <UiIcon name="back" /> Nhóm đã lưu
    </button>
    <header class="groups-header">
      <div v-if="!embedded">
        <h1>{{ editor ? (editor.id ? 'Sửa nhóm' : 'Tạo nhóm') : 'Gọi nhóm' }}</h1>
        <p>
          {{
            editor
              ? 'Đặt tên và chọn đồng nghiệp cho nhóm.'
              : 'Lưu nhóm đồng nghiệp để gọi lại nhanh.'
          }}
        </p>
      </div>
      <button
        v-if="!editor && (groups.length || loading)"
        class="group-button group-primary"
        type="button"
        :disabled="busy"
        @click="createGroup"
      >
        <UiIcon name="plus" /> Tạo nhóm
      </button>
    </header>
    <p v-if="notice" class="group-message" role="status"><UiIcon name="info" /> {{ notice }}</p>
    <p v-if="error" class="group-message group-message-error" role="alert">
      <UiIcon name="info" /> {{ error }}
    </p>

    <template v-if="!editor">
      <p v-if="openingDraft" class="group-message" role="status">Đang mở nhóm…</p>
      <p v-else-if="loading && !groups.length" class="group-message" role="status">
        Đang tải nhóm…
      </p>
      <div v-else-if="!groups.length" class="group-empty">
        <div class="group-emblem"><UiIcon name="users" /></div>
        <h2>Chưa có nhóm đã lưu</h2>
        <p>Tạo nhóm từ danh bạ để gọi lại chỉ với một nút.</p>
        <button
          class="group-button group-primary"
          type="button"
          :disabled="busy"
          @click="createGroup"
        >
          <UiIcon name="plus" /> Tạo nhóm
        </button>
      </div>
      <div v-else class="group-grid" :aria-busy="loading">
        <article v-for="group in groups" :key="group.id" class="group-card">
          <div class="group-card-main">
            <div class="group-emblem"><UiIcon name="users" /></div>
            <div class="group-card-copy">
              <h2>{{ group.name }}</h2>
              <p>{{ group.members.length }} đồng nghiệp</p>
            </div>
          </div>
          <div class="group-actions">
            <button
              class="group-button group-call"
              type="button"
              :disabled="busy || callState.activeCall"
              @click="callGroup(group)"
            >
              <UiIcon name="phone" /> Gọi
            </button>
            <button
              class="group-button group-quiet"
              type="button"
              :disabled="busy"
              @click="editGroup(group)"
            >
              <UiIcon name="edit" /> Sửa
            </button>
            <button
              class="group-button group-quiet group-delete"
              type="button"
              :disabled="busy"
              @click="removeGroup(group)"
            >
              <UiIcon name="trash" /> Xóa
            </button>
          </div>
        </article>
      </div>
    </template>

    <section v-else class="group-editor">
      <form class="group-form" @submit.prevent="submitGroup">
        <div class="group-form-body">
          <label class="group-name-field">
            Tên nhóm
            <input
              ref="groupNameInput"
              v-model="editor.name"
              required
              maxlength="100"
              :disabled="busy"
              placeholder="Ví dụ: Điều phối ca sáng"
            />
          </label>
          <div class="group-roster-heading">
            <h2>
              Đã chọn <span>{{ editor.members.length }}</span>
            </h2>
            <span v-if="editor.members.length < 2">Tối thiểu 2 người</span>
          </div>
          <p v-if="!editor.members.length" class="group-roster-empty">
            Chọn đồng nghiệp từ danh bạ.
          </p>
          <ul v-else class="group-roster">
            <li v-for="member in editor.members" :key="member.uuid">
              <UserAvatar
                class="group-member-avatar"
                :name="member.name"
                :email="member.email"
                size="sm"
              />
              <span class="group-member-details">
                <strong>{{ member.name }}</strong>
                <small v-if="member.number">Máy lẻ {{ member.number }}</small>
              </span>
              <button
                class="group-button group-remove"
                type="button"
                :disabled="busy"
                :aria-label="'Bỏ ' + member.name"
                title="Bỏ khỏi nhóm"
                @click="toggleMember(member)"
              >
                <UiIcon name="close" />
              </button>
            </li>
          </ul>
        </div>
        <div class="group-actions group-form-actions">
          <button
            class="group-button group-quiet"
            type="button"
            :disabled="busy"
            @click="closeEditor"
          >
            Hủy
          </button>
          <button
            class="group-button group-primary"
            :disabled="busy || !editor.name.trim() || editor.members.length < 2"
          >
            <UiIcon name="check" /> Lưu nhóm
          </button>
        </div>
      </form>
      <div class="group-directory">
        <h2>Chọn đồng nghiệp</h2>
        <DirectoryPanel
          :active="active"
          picker
          :busy="busy"
          :my-extension="myExtension"
          :selected-ids="selectedIds"
          :load-contacts="loadContacts"
          :refresh-presence="refreshPresence"
          @toggle-member="toggleMember"
        />
      </div>
    </section>
  </section>
</template>
<script setup>
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/components/common/UiIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import DirectoryPanel from '@/components/contacts/DirectoryPanel.vue'
import { authService, callService, contactService, groupCallService } from '@/services/index.js'
import {
  deleteCallGroup,
  listCallGroups,
  saveCallGroup,
} from '@/services/data/callGroupsService.js'
import { captureSessionContext, isSessionContextCurrent } from '@/services/auth/sessionScope.js'
import { callState } from '@/state/callState.js'

const router = useRouter()
const route = useRoute()
const props = defineProps({ embedded: Boolean })
const emit = defineEmits(['called'])
const groups = ref([])
const editor = ref(null)
const groupNameInput = ref(null)
const active = ref(false)
const busy = ref(false)
const loading = ref(false)
const openingDraft = ref(false)
const notice = ref('')
const error = ref('')
let version = 0
let draftRevision = 0
let groupsLoadVersion = 0
let listLoadedForVisit = false
let deactivatedOnce = false
let activeUrlDraft = ''

/** Lấy danh sách UUID đã chọn để các lượt tìm kế tiếp đánh dấu đúng. */
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

/** Mở ngay trình tạo nhóm trống ở chế độ toàn màn hình. */
function openNewGroupEditor() {
  openingDraft.value = false
  error.value = ''
  notice.value = ''
  editor.value = { id: '', name: '', members: [] }
  void focusGroupName()
}

/** Dựng nhanh state sửa nhóm từ danh bạ đã có trong RAM trước khi bổ sung các thành viên còn thiếu. */
function buildImmediateGroupEditor(group) {
  /** Lấy bản ghi thành viên đã có trong RAM danh bạ để hiển thị ngay không chớp khung danh sách. */
  function resolveKnownMember(uuid) {
    return (
      contactService.findContactByUuid?.(uuid) || {
        uuid,
        name: 'Đang tải thành viên...',
      }
    )
  }
  return {
    id: group.id,
    name: group.name,
    members: (group.members || []).map(resolveKnownMember),
  }
}

/** Mở thẳng màn hình tạo hoặc sửa nhóm từ draft đã có sẵn trong danh sách hiện tại. */
function applyImmediateDraft(draft) {
  if (props.embedded || !draft) {
    activeUrlDraft = ''
    openingDraft.value = false
    return false
  }
  activeUrlDraft = draft
  if (draft === 'new') {
    if (!editor.value || editor.value.id !== '') openNewGroupEditor()
    return true
  }
  const existing = groups.value.find((item) => item.id === draft)
  if (existing) {
    openingDraft.value = false
    if (!editor.value || editor.value.id !== draft) {
      void editGroup(existing)
    }
    return true
  }
  openingDraft.value = true
  return false
}

/** Đọc lại nhóm khi mở danh sách hoặc kích hoạt lại tab nhúng; mở form Tạo nhóm ngay không gọi GET. */
async function loadGroups({ applyDraft = true } = {}) {
  active.value = true
  const viewVersion = version
  const context = captureSessionContext()
  const draft = props.embedded || !applyDraft ? '' : String(route.query.draft || '')
  if (draft === 'new') {
    groupsLoadVersion += 1
    applyImmediateDraft('new')
    loading.value = false
    return
  }
  const startLoadVersion = ++groupsLoadVersion
  if (draft) applyImmediateDraft(draft)
  const startDraftRevision = draftRevision
  loading.value = !groups.value.length && !openingDraft.value && !editor.value
  error.value = ''
  try {
    const items = await listCallGroups(authService.getToken())
    if (!stillActive(context, viewVersion) || groupsLoadVersion !== startLoadVersion) return
    groups.value = items
    listLoadedForVisit = true
    if (
      draft &&
      draftRevision === startDraftRevision &&
      String(route.query.draft || '') === draft
    ) {
      if (!editor.value || editor.value.id !== draft) {
        const group = items.find((item) => item.id === draft)
        if (group) await editGroup(group)
      }
    }
    if (draftRevision === startDraftRevision) openingDraft.value = false
  } catch (failure) {
    if (stillActive(context, viewVersion) && groupsLoadVersion === startLoadVersion) {
      if (failure?.status === 401 || failure?.status === 403) groups.value = []
      if (draftRevision === startDraftRevision) openingDraft.value = false
      error.value = failure.message
    }
  } finally {
    if (stillActive(context, viewVersion) && groupsLoadVersion === startLoadVersion) {
      loading.value = false
    }
  }
}

/** Chặn cập nhật từ request cũ sau khi rời màn và bỏ bản sửa chưa lưu. */
function hideGroups() {
  active.value = false
  editor.value = null
  openingDraft.value = false
  busy.value = false
  listLoadedForVisit = false
  activeUrlDraft = ''
  draftRevision += 1
  groupsLoadVersion += 1
  version += 1
}
/** Nạp danh sách ở màn riêng hoặc đồng bộ lại danh sách nhúng khi KeepAlive quay về màn gọi. */
function activateGroupsPage() {
  if (!props.embedded || deactivatedOnce) void loadGroups()
}

/** Ghi dấu đã từng rời màn để lần quay lại KeepAlive đồng bộ lại danh sách nhúng. */
function deactivateGroupsPage() {
  deactivatedOnce = true
  hideGroups()
}

/** Xử lý khi query draft đổi trong lúc trang Gọi nhóm đang mở sẵn. */
function syncDraftQuery(nextDraft) {
  if (props.embedded || !active.value) return
  draftRevision += 1
  if (nextDraft) {
    if (!applyImmediateDraft(String(nextDraft))) void loadGroups()
    return
  }
  if (activeUrlDraft) {
    activeUrlDraft = ''
    editor.value = null
    openingDraft.value = false
    error.value = ''
    if (!listLoadedForVisit) void loadGroups({ applyDraft: false })
  }
}
watch(() => route.query.draft, syncDraftQuery)

/** Nạp danh sách khi tab Gọi nhóm trong danh bạ vừa xuất hiện. */
function mountEmbeddedGroups() {
  if (props.embedded) void loadGroups()
}
onMounted(mountEmbeddedGroups)
onActivated(activateGroupsPage)
onDeactivated(deactivateGroupsPage)
onUnmounted(hideGroups)

/** Mở trình tạo riêng từ tab nhúng hoặc tạo biểu mẫu tại màn nhóm. */
function createGroup() {
  if (props.embedded) {
    void router.push({ path: '/call-groups', query: { draft: 'new' } })
    return
  }
  draftRevision += 1
  activeUrlDraft = ''
  openNewGroupEditor()
}

/** Đưa con trỏ đến trường đầu tiên sau khi mở trình sửa. */
async function focusGroupName() {
  await nextTick()
  if (active.value && editor.value) groupNameInput.value?.focus()
}

/** Quay về danh sách đã lưu, bỏ thay đổi chưa gửi và tải danh sách nếu mở thẳng từ draft=new. */
function closeEditor() {
  draftRevision += 1
  activeUrlDraft = ''
  editor.value = null
  openingDraft.value = false
  error.value = ''
  if (route.query.draft) void router.replace({ path: '/call-groups' })
  if (!props.embedded && !listLoadedForVisit) void loadGroups({ applyDraft: false })
}

/** Chuyển phần tử liên hệ sang cặp [uuid, contact] để tra cứu nhanh khi mở trình sửa nhóm. */
function toContactMapEntry(contact) {
  return [contact.uuid, contact]
}

/** Tải thông tin thành viên hiện tại của nhóm và cập nhật mà không xóa nội dung người dùng đang sửa. */
async function loadGroupForEditing(group, context, viewVersion) {
  const contacts = await contactService.getSavedGroupMembers(group.members)
  if (!stillActive(context, viewVersion) || editor.value?.id !== group.id) return
  const byId = new Map(contacts.map(toContactMapEntry))
  /** Giữ cả UUID đã rời danh bạ để người dùng có thể chủ động gỡ khỏi nhóm. */
  function resolveGroupMember(uuid) {
    return byId.get(uuid) || { uuid, name: 'Liên hệ không còn trong danh bạ' }
  }
  /** Cập nhật chi tiết thành viên từ backend cho từng UUID hiện có trong trình sửa. */
  function hydrateExistingMember(member) {
    return byId.get(member.uuid) || resolveGroupMember(member.uuid)
  }
  editor.value.members = editor.value.members.map(hydrateExistingMember)
}

/** Tra lại thành viên qua UUID và giữ mục đã rời danh bạ để người dùng có thể bỏ. */
async function editGroup(group) {
  if (props.embedded) {
    await router.push({ path: '/call-groups', query: { draft: group.id } })
    return
  }
  if (activeUrlDraft !== group.id) {
    draftRevision += 1
    activeUrlDraft = ''
  }
  if (!editor.value || editor.value.id !== group.id) {
    editor.value = buildImmediateGroupEditor(group)
    void focusGroupName()
  }
  /** Bọc tác vụ nạp dữ liệu sửa nhóm cho hàng đợi khóa thao tác. */
  function runLoadGroupForEditing(context, viewVersion) {
    return loadGroupForEditing(group, context, viewVersion)
  }
  await perform(runLoadGroupForEditing)
  if (editor.value?.id === group.id) void focusGroupName()
}

/** Chọn hoặc bỏ một UUID độc lập với từ khóa đang tìm. */
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

/** Gửi nhóm đang chỉnh sửa lên backend và chỉ cập nhật danh sách khi đã có phản hồi lưu thành công. */
async function saveDraftGroup(draft, context, viewVersion) {
  const saved = await saveCallGroup(authService.getToken(), draft.id, draft.name, selectedIds.value)
  if (!stillActive(context, viewVersion)) return
  groupsLoadVersion += 1
  groups.value = [...groups.value.filter((group) => group.id !== saved.id), saved]
  closeEditor()
  notice.value = 'Đã lưu nhóm.'
}

/** Thêm hoặc cập nhật danh sách sau ACK từ backend. */
async function submitGroup() {
  const draft = editor.value
  if (!draft) return
  /** Bọc tác vụ lưu bản nháp nhóm cho hàng đợi khóa thao tác. */
  function runSaveDraftGroup(context, viewVersion) {
    return saveDraftGroup(draft, context, viewVersion)
  }
  await perform(runSaveDraftGroup)
}

/** Gửi lệnh xóa nhóm lên backend rồi cập nhật lại danh sách nhóm đang mở. */
async function deleteSelectedGroup(group, context, viewVersion) {
  await deleteCallGroup(authService.getToken(), group.id)
  if (!stillActive(context, viewVersion)) return
  groupsLoadVersion += 1
  groups.value = groups.value.filter((item) => item.id !== group.id)
  if (editor.value?.id === group.id) editor.value = null
  notice.value = 'Đã xóa nhóm.'
}

/** Xóa sau khi người dùng xác nhận đúng nhóm. */
async function removeGroup(group) {
  if (!confirm('Xóa nhóm ' + group.name + '?')) return
  /** Bọc tác vụ xóa nhóm được chọn cho hàng đợi khóa thao tác. */
  function runDeleteSelectedGroup(context, viewVersion) {
    return deleteSelectedGroup(group, context, viewVersion)
  }
  await perform(runDeleteSelectedGroup)
}

/** Kiểm tra danh sách thành viên hiện hành, xác nhận các trường hợp rút gọn và khởi tạo cuộc gọi nhóm. */
async function executeGroupCall(group, context, viewVersion) {
  const members = await contactService.getSavedGroupMembers(group.members)
  const result = await contactService.prepareGroupTargets(members)
  // Chặn mở cuộc gọi mới nếu màn đã rời đi hoặc đã phát sinh cuộc gọi khác trong lúc tra cứu.
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
  if (props.embedded) emit('called')
  await router.push({ path: '/calls', query: { active: 'true' } })
}

/** Lấy máy lẻ mới nhất, kiểm tra presence và gọi nhóm qua luồng host hiện có. */
async function callGroup(group) {
  if (callState.activeCall || callService.isDialing) return
  /** Bọc tác vụ quay số nhóm cho hàng đợi khóa thao tác. */
  function runExecuteGroupCall(context, viewVersion) {
    return executeGroupCall(group, context, viewVersion)
  }
  await perform(runExecuteGroupCall)
}

/** Đọc kết quả chọn thành viên từ dịch vụ danh bạ. */
function loadContacts(query) {
  return contactService.listPublishedContacts(query)
}

/** Cập nhật presence của trang bộ chọn đang mở. */
function refreshPresence(contacts, force) {
  void contactService.refreshDirectoryPresence(contacts, force)
}
</script>

<style scoped>
.groups-view {
  --group-ink: #122943;
  --group-muted: #526981;
  --group-line: #dce6f0;
  --group-blue: #1765c5;
  --group-blue-soft: #eaf3fe;
  --group-danger: #ac343d;
  max-width: 1096px;
  margin: 0 auto;
  padding: clamp(12px, 2.4vw, 32px) clamp(4px, 2vw, 24px);
  color: var(--group-ink);
  font-family: Inter, 'Segoe UI', system-ui, sans-serif;
}
.groups-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  flex-wrap: wrap;
  padding-bottom: 21px;
  margin-bottom: 22px;
  border-bottom: 1px solid var(--group-line);
}
.groups-embedded {
  padding: 0;
}
.groups-embedded .groups-header {
  justify-content: flex-end;
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.groups-embedded .groups-header:empty {
  display: none;
}
.groups-header h1 {
  margin: 0 0 6px;
  font-size: clamp(1.75rem, 3vw, 2.15rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
}
.groups-header p,
.group-card-copy p {
  margin: 0;
  color: var(--group-muted);
  font-size: 0.88rem;
  line-height: 1.55;
}
.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 16px;
}
.group-card,
.group-form,
.group-directory,
.group-empty {
  border: 1px solid var(--group-line);
  border-radius: 14px;
  background: #fff;
}
.group-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 2px 6px #12294308;
}
.group-card-main {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 19px 17px;
}
.group-emblem {
  width: 47px;
  height: 47px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 12px;
  background: var(--group-blue-soft);
  color: var(--group-blue);
  font-size: 1.35rem;
}
.group-card-copy {
  min-width: 0;
}
.group-card h2,
.group-form h2,
.group-directory h2,
.group-empty h2 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.group-card-copy p {
  margin-top: 3px;
}
.group-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 12px;
  border-top: 1px solid var(--group-line);
}
.group-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--group-ink);
  cursor: pointer;
  font: inherit;
  font-weight: 650;
  font-size: 0.84rem;
  white-space: nowrap;
}
.group-button:not(:disabled):focus-visible,
.group-name-field input:focus-visible {
  outline: 2px solid var(--group-blue);
  outline-offset: 3px;
}
.group-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.group-primary {
  background: var(--group-blue);
  color: #fff;
  padding-inline: 16px;
}
.group-primary:hover:not(:disabled) {
  background: #1256a8;
}
.group-call {
  margin-right: auto;
  min-width: 84px;
  background: var(--group-blue-soft);
  color: #135aaf;
}
.group-quiet {
  color: var(--group-muted);
}
.group-call:hover:not(:disabled),
.group-quiet:hover:not(:disabled),
.group-remove:hover:not(:disabled),
.group-back:hover:not(:disabled) {
  background: #eaf2fb;
  color: #1256a8;
}
.group-delete:hover:not(:disabled) {
  background: #fcecef;
  color: var(--group-danger);
}
.group-back {
  margin: -4px 0 10px -8px;
  padding-inline: 8px;
  color: var(--group-blue);
}
.group-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: clamp(25px, 5vw, 56px) 16px;
  text-align: center;
}
.group-empty p {
  margin: 0 0 6px;
  color: var(--group-muted);
}
.group-message {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 13px;
  border: 1px solid #d2e4fb;
  border-radius: 8px;
  background: #eef6ff;
  color: #214c77;
  margin: 0 0 16px;
  font-size: 0.86rem;
}
.group-message-error {
  border-color: #efcdd1;
  background: #fdf1f2;
  color: #8c2631;
}
.group-editor {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(245px, 1fr) minmax(0, 1.62fr);
  gap: 16px;
}
.group-form,
.group-directory {
  min-width: 0;
}
.group-form-body {
  padding: 17px;
}
.group-name-field {
  display: grid;
  gap: 8px;
  font-weight: 650;
  font-size: 0.88rem;
}
.group-name-field input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 43px;
  border: 1px solid #c6d6e7;
  border-radius: 8px;
  padding: 8px 11px;
  color: var(--group-ink);
  background: #f9fbfe;
  font: inherit;
  font-weight: 400;
}
.group-roster-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 23px;
}
.group-roster-heading h2 span {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  margin-left: 4px;
  padding-inline: 3px;
  border-radius: 8px;
  background: var(--group-blue-soft);
  color: var(--group-blue);
  font-size: 0.75rem;
}
.group-roster-heading > span,
.group-roster-empty {
  color: var(--group-muted);
  font-size: 0.78rem;
}
.group-roster {
  max-height: 292px;
  overflow: auto;
  list-style: none;
  padding: 0 2px 0 0;
  margin: 9px 0 0;
}
.group-roster li {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 6px 0;
}
.group-roster li + li {
  border-top: 1px solid #edf2f7;
}
.group-member-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.69rem;
  font-weight: 700;
}
.group-member-details {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.group-member-details small {
  color: var(--group-muted);
}
.group-remove {
  min-width: 36px;
  padding-inline: 6px;
  color: var(--group-muted);
}
.group-form-actions {
  justify-content: flex-end;
}
.group-directory {
  padding: 15px 13px 13px;
}
.group-directory > h2 {
  padding: 0 4px 12px;
}
.group-directory :deep(.contacts-col) {
  max-width: none;
}
.group-directory :deep(.directory-panel) {
  height: clamp(275px, 53dvh, 470px);
  box-shadow: none;
}
@media (max-width: 940px) {
  .group-editor {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 520px) {
  .groups-header {
    margin-bottom: 16px;
    padding-bottom: 15px;
  }
  .group-grid {
    gap: 11px;
  }
  .group-directory {
    padding-inline: 8px;
  }
}
</style>
