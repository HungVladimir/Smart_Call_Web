<template>
  <div class="messages-view">
    <div class="chat-container">
      <!-- 1. CỘT DANH SÁCH PHÒNG CHAT -->
      <div class="chat-rooms-col">
        <div class="rooms-header">
          <h2>Tin nhắn</h2>
          <div class="rooms-header-actions">
            <button
              v-if="groupRoomsCount > 0"
              class="btn-manage-rooms"
              :class="{ active: isRoomSelectMode }"
              :title="isRoomSelectMode ? 'Hủy chọn nhóm' : 'Chọn nhóm để giải tán'"
              @click="toggleRoomSelectMode"
            >
              <svg
                v-if="!isRoomSelectMode"
                class="btn-manage-svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              <svg
                v-else
                class="btn-manage-svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>{{ isRoomSelectMode ? 'Hủy' : 'Chọn' }}</span>
            </button>
            <button class="btn-new-room" @click="openCreateGroupModal()">
              <svg
                class="btn-new-room-svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Tạo nhóm</span>
            </button>
          </div>
        </div>

        <!-- Thanh công cụ chọn & giải tán nhiều nhóm thảo luận -->
        <div v-if="isRoomSelectMode" class="room-select-toolbar">
          <div class="room-select-info">
            <span
              >Đã chọn: <strong>{{ selectedRoomIds.length }}</strong
              >/{{ groupRoomsCount }} nhóm</span
            >
          </div>
          <div class="room-select-actions">
            <button class="btn-select-mini" @click="selectAllRooms">
              {{ selectedRoomIds.length === groupRoomsCount ? 'Bỏ chọn' : 'Tất cả' }}
            </button>
            <button
              class="btn-select-mini danger"
              :disabled="selectedRoomIds.length === 0 || isDeletingRooms"
              @click="handleDeleteSelectedRooms"
            >
              <span v-if="isDeletingRooms">⏳ Đang giải tán...</span>
              <span v-else>Giải tán ({{ selectedRoomIds.length }})</span>
            </button>
          </div>
        </div>

        <div v-if="isLoadingRooms" class="rooms-loading">
          <div class="spinner-circle"></div>
          <span>Đang đồng bộ cuộc trò chuyện...</span>
        </div>
        <div v-else-if="sortedRooms.length === 0" class="rooms-empty">
          <span class="rooms-empty-icon">💬</span>
          <p>Chưa có cuộc trò chuyện nào</p>
        </div>
        <div v-else class="room-list">
          <div
            v-for="room in sortedRooms"
            :key="room.id"
            class="room-item"
            :class="{
              active: currentRoom && currentRoom.id === room.id,
              'in-select-mode': isRoomSelectMode && !room.isDirect && isRoomAdmin(room),
              'is-selected': selectedRoomIds.includes(room.id),
            }"
            @click="
              isRoomSelectMode && !room.isDirect && isRoomAdmin(room)
                ? toggleSelectRoom(room.id)
                : selectRoom(room)
            "
          >
            <div
              v-if="isRoomSelectMode && !room.isDirect && isRoomAdmin(room)"
              class="room-select-check"
              @click.stop
            >
              <input
                type="checkbox"
                class="select-room-checkbox"
                :value="room.id"
                :checked="selectedRoomIds.includes(room.id)"
                @change="toggleSelectRoom(room.id)"
              />
            </div>

            <div
              class="avatar-sm"
              :class="{ 'group-avatar': !room.isDirect }"
              :style="{ backgroundColor: room.avatarBg }"
            >
              {{ room.icon || (!room.isDirect ? '👥' : room.title.slice(0, 2).toUpperCase()) }}
              <span
                v-if="room.isDirect"
                class="status-badge-dot"
                :class="getRoomStatusClass(room)"
              ></span>
            </div>

            <div class="room-info">
              <div class="room-top">
                <span class="room-title">
                  {{ room.title }}
                  <small v-if="!room.isDirect" class="member-tag">
                    ({{
                      currentRoom && room.id === currentRoom.id
                        ? currentRoomMembers.length || room.memberCount || 2
                        : room.memberCount ||
                          (room.members && room.members.length ? room.members.length : 2)
                    }})
                  </small>
                </span>
                <span class="room-time">{{ room.time }}</span>
              </div>
              <div class="room-bottom">
                <span class="room-preview">{{ room.preview }}</span>
                <span
                  v-if="chatService.getUnreadCount(room.id) > 0"
                  class="room-unread-badge"
                  :aria-label="`${chatService.getUnreadCount(room.id)} tin nhắn chưa mở`"
                  >{{ chatService.getUnreadCount(room.id) }}</span
                >
              </div>
            </div>

            <!-- Nút xóa nhanh 1 nhóm khi hover ở chế độ thường (Chỉ hiển thị cho phòng nhóm mà người dùng là Admin) -->
            <button
              v-if="!isRoomSelectMode && !room.isDirect && isRoomAdmin(room)"
              class="btn-delete-room-hover"
              title="Xóa nhóm này"
              @click.stop="handleDeleteSingleRoom(room)"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                ></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 2. CỘT KHUNG CHAT CHI TIẾT -->
      <div v-if="currentRoom" class="chat-main-col">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="chat-title-group">
            <h3>
              <span
                v-if="currentRoom.isDirect"
                class="status-dot-inline"
                :class="getRoomStatusClass(currentRoom)"
              ></span>
              <span v-else class="group-icon-prefix">👥 </span>
              {{ currentRoom.title }}
            </h3>
            <span v-if="!currentRoom.isDirect" class="online-indicator">
              👥 {{ currentRoomMembers.length || currentRoom.memberCount || 2 }} thành viên
            </span>
            <span v-else-if="currentDirectContact" class="online-indicator">
              {{ getStatusLabel(currentDirectContact.status) }} • Máy lẻ
              {{ currentDirectContact.number || currentRoom.ext }}
            </span>
          </div>

          <div class="chat-header-actions">
            <button
              class="btn-action"
              :title="
                currentRoom.isDirect ? 'Gọi thoại 1-1 trực tiếp' : 'Khởi tạo cuộc gọi hội nghị nhóm'
              "
              :disabled="Boolean(currentRoom.groupId && currentRoom.status !== 'active')"
              @click="startVoiceCall"
            >
              <svg
                class="header-action-svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z"
                />
              </svg>
            </button>
            <button
              class="btn-action"
              title="Tính năng cuộc gọi video đang được phát triển"
              @click="handleVideoCallClick"
            >
              <svg
                class="header-action-svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"
                />
              </svg>
            </button>
            <button
              v-if="!currentRoom.isDirect"
              class="btn-manage-members"
              @click="openMemberModal"
            >
              👥 Thành viên
            </button>
          </div>
        </div>

        <!-- Danh sách tin nhắn -->
        <button v-if="currentRoom?.nextCursor" @click="loadOlderMessages">
          Tải tin nhắn trước
        </button>
        <MessageList
          ref="messageListRef"
          :messages="currentRoom.messages || []"
          :loading="isLoadingMessages"
        />

        <!-- Banner thông báo khi phòng đã bị giải tán -->
        <div v-if="isRoomClosed" class="kicked-banner closed-banner">
          <span class="kicked-icon">🚫</span>
          <span class="kicked-text"
            >Nhóm này đã được giải tán. Toàn bộ cuộc trò chuyện đã kết thúc và không thể gửi thêm
            tin nhắn.</span
          >
        </div>

        <!-- Banner thông báo khi thành viên bị mời ra khỏi nhóm -->
        <div v-if="isKickedFromCurrentRoom" class="kicked-banner">
          <span class="kicked-icon">⚠️</span>
          <span class="kicked-text"
            >Bạn đã được Quản trị viên mời ra khỏi nhóm thảo luận này. Bạn không thể gửi thêm tin
            nhắn.</span
          >
          <button
            v-if="!currentRoom?.groupId"
            class="btn-leave-kicked-room"
            @click="confirmLeaveKickedRoom"
          >
            Đã hiểu & Rời nhóm
          </button>
        </div>

        <!-- Hộp soạn thảo tin nhắn -->
        <MessageComposer
          v-model="inputText"
          :disabled="isKickedFromCurrentRoom || isRoomClosed"
          :placeholder="
            isRoomClosed
              ? 'Nhóm đã được giải tán'
              : isKickedFromCurrentRoom
                ? 'Bạn đã rời nhóm'
                : undefined
          "
          @send="sendMessage"
        />
      </div>

      <!-- Khung chờ nếu chưa chọn phòng -->
      <div v-else class="chat-main-col empty-box">
        <div class="empty-hint">
          <span class="empty-icon">💬</span>
          <p>Chọn một cuộc trò chuyện ở danh sách bên trái hoặc từ Danh bạ để bắt đầu nhắn tin.</p>
        </div>
      </div>
    </div>

    <!-- MODAL 1: TẠO NHÓM CHAT MỚI / THÊM THÀNH VIÊN VÀO NHÓM (CHUẨN WAZO CHATD API) -->
    <div v-if="showCreateGroupModal" class="modal-overlay" @click.self="closeCreateGroupModal">
      <div class="modal-card">
        <div class="modal-head">
          <span>{{
            expandingGroupRoomId ? '👥 THÊM THÀNH VIÊN VÀO NHÓM CHAT' : '👥 TẠO NHÓM CHAT MỚI'
          }}</span>
          <button class="btn-close" @click="closeCreateGroupModal">✖</button>
        </div>

        <div class="modal-body">
          <label v-if="!expandingGroupRoomId" class="form-label">TÊN NHÓM CHAT (*):</label>
          <input
            v-if="!expandingGroupRoomId"
            v-model="newGroupTitle"
            type="text"
            maxlength="100"
            class="form-input"
            placeholder="Ví dụ: Nhóm Kỹ Thuật, Ban Quản Trị..."
          />

          <label class="form-label">TÌM KIẾM ĐỒNG NGHIỆP TỪ DANH BẠ TỔNG ĐÀI:</label>
          <div class="search-add-row">
            <input
              v-model="groupContactSearch"
              type="text"
              placeholder="Tìm theo tên hoặc số máy lẻ..."
              class="form-input"
            />
          </div>

          <label class="form-label"
            >Chọn đồng nghiệp {{ expandingGroupRoomId ? 'để thêm vào nhóm' : 'để tạo nhóm' }}</label
          >
          <div class="contact-select-box">
            <div v-if="availableContactsForGroup.length === 0" class="no-contacts-hint">
              Không tìm thấy đồng nghiệp phù hợp trong danh bạ
            </div>
            <label
              v-for="c in availableContactsForGroup"
              :key="c.uuid || c.number"
              class="contact-select-row"
              :class="{ selected: selectedGroupMemberUuids.includes(c.uuid) }"
            >
              <input
                type="checkbox"
                class="contact-checkbox"
                :value="c.uuid"
                :checked="selectedGroupMemberUuids.includes(c.uuid)"
                @change="toggleSelectGroupMember(c.uuid)"
              />
              <div class="contact-avatar-mini" :style="{ backgroundColor: getContactAvatarBg(c) }">
                {{ (c.name || c.number || 'U').slice(0, 2).toUpperCase() }}
              </div>
              <div class="contact-detail-mini">
                <strong>{{ c.name }}</strong>
                <small>{{ c.dept ? c.dept + ' • ' : '' }}Máy lẻ: {{ c.number }}</small>
              </div>
              <span class="status-pill" :class="c.status || 'offline'">
                {{ getStatusLabel(c.status) }}
              </span>
            </label>
          </div>

          <div
            class="select-counter-hint"
            :class="{ valid: selectedGroupMemberUuids.length >= minimumSelected }"
          >
            Đã chọn: <strong>{{ selectedGroupMemberUuids.length }}</strong> đồng nghiệp
            <span v-if="!expandingGroupRoomId && selectedGroupMemberUuids.length < 2">
              (Cần chọn thêm ít nhất {{ 2 - selectedGroupMemberUuids.length }} người để tạo
              nhóm)</span
            >
            <span v-else> (Đủ điều kiện tạo nhóm)</span>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn-secondary" @click="closeCreateGroupModal">Hủy</button>
          <button
            class="btn-primary"
            :disabled="selectedGroupMemberUuids.length < minimumSelected || isSubmittingGroup"
            @click="submitCreateGroup"
          >
            <span v-if="isSubmittingGroup">⏳ Đang xử lý...</span>
            <span v-else>{{
              expandingGroupRoomId ? '🚀 Cập nhật nhóm chat' : '🚀 Tạo nhóm chat'
            }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL 2: THÀNH VIÊN CUỘC TRÒ CHUYỆN & CHUYỂN ĐỔI 1-1 SANG NHÓM -->
    <div v-if="showMemberModal" class="modal-overlay" @click.self="showMemberModal = false">
      <div class="modal-card">
        <div class="modal-head">
          <span v-if="currentRoom?.isDirect">THÀNH VIÊN CUỘC TRÒ CHUYỆN (1-1)</span>
          <span v-else>👥 THÀNH VIÊN NHÓM: {{ currentRoom?.title }}</span>
          <button class="btn-close" @click="showMemberModal = false">✖</button>
        </div>

        <div class="modal-body">
          <!-- Trường hợp A: Phòng 1-1 -->
          <div v-if="currentRoom?.isDirect" class="direct-member-view">
            <div class="direct-member-card">
              <div
                class="avatar-direct-modal"
                :style="{ backgroundColor: currentRoom.avatarBg || '#0284c7' }"
              >
                {{ currentRoom.title.slice(0, 2).toUpperCase() }}
              </div>
              <div class="direct-member-meta">
                <h4>{{ currentRoom.title }}</h4>
                <p>
                  Số máy lẻ: <strong>{{ currentRoom.ext || 'N/A' }}</strong>
                </p>
                <p>
                  Trạng thái:
                  <span class="status-text-badge" :class="getRoomStatusClass(currentRoom)">{{
                    getStatusLabel(getRoomStatusClass(currentRoom))
                  }}</span>
                </p>
              </div>
            </div>

            <div class="group-upgrade-banner">
              <p>
                💡 Cuộc trò chuyện này hiện đang là trao đổi 1-1 riêng tư. Bạn có thể thêm các đồng
                nghiệp khác để nâng cấp thành một nhóm chat thảo luận chung!
              </p>
              <button class="btn-upgrade-group" @click="upgradeDirectToGroup">
                ➕ Thêm người để tạo thành nhóm chat
              </button>
            </div>
          </div>

          <!-- Trường hợp B: Phòng Nhóm (Group) -->
          <div v-else class="group-members-view">
            <!-- Đổi tên nhóm (Chỉ Admin mới có quyền) -->
            <div class="group-rename-section">
              <label class="form-label">TÊN NHÓM CHAT:</label>
              <div class="group-rename-row">
                <input
                  type="text"
                  v-model="editGroupTitle"
                  class="group-rename-input"
                  :disabled="!currentIsAdmin"
                  placeholder="Nhập tên nhóm..."
                  maxlength="60"
                />
                <button
                  v-if="currentIsAdmin"
                  class="btn-save-group-name"
                  :disabled="
                    !editGroupTitle.trim() ||
                    editGroupTitle.trim() === currentRoom?.title ||
                    isRenamingGroup
                  "
                  @click="handleSaveGroupName"
                >
                  <span v-if="isRenamingGroup">⏳</span>
                  <span v-else>💾 Lưu tên</span>
                </button>
              </div>
            </div>

            <!-- Cụm 2 nút Thêm thành viên và Xóa nhóm đặt song song cho Admin -->
            <div v-if="currentIsAdmin" class="group-actions-bar-grid">
              <button class="btn-group-action btn-add-member" @click="openAddMoreToGroup">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Thêm thành viên</span>
              </button>
              <button
                class="btn-group-action btn-delete-group"
                :disabled="isDeletingGroup"
                @click="handleDeleteGroupRoom"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  ></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                <span v-if="isDeletingGroup">Đang xóa...</span>
                <span v-else>Xóa nhóm</span>
              </button>
            </div>
            <!-- Banner nhắc nhở phân quyền khi người dùng là thành viên thường -->
            <div v-else class="non-admin-notice-banner">
              🔒 Bạn là thành viên trong nhóm. Chỉ Quản trị viên (Admin) mới có quyền thêm/xóa thành
              viên, đổi tên hoặc xóa nhóm.
            </div>

            <label class="form-label">
              DANH SÁCH THÀNH VIÊN NHÓM ({{ currentRoomMembers.length }} THÀNH VIÊN):
            </label>
            <div class="member-list-box">
              <div v-for="m in currentRoomMembers" :key="m.id || m.uuid" class="member-row">
                <div class="member-avatar-wrapper">
                  <div
                    class="member-avatar-mini"
                    :style="{ backgroundColor: m.isAdmin ? '#f59e0b' : '#3b82f6' }"
                  >
                    {{ (m.name || 'U').slice(0, 2).toUpperCase() }}
                  </div>
                  <span
                    class="member-status-dot"
                    :class="m.status || 'offline'"
                    :title="getStatusLabel(m.status)"
                  ></span>
                </div>
                <div class="member-info">
                  <div class="member-name-row">
                    <strong>{{ m.name }}</strong>
                    <span v-if="m.isAdmin" class="admin-badge">👑 Admin</span>
                  </div>
                  <small>{{ m.dept ? m.dept + ' • ' : '' }}Máy lẻ: {{ m.ext || 'N/A' }}</small>
                </div>
                <div class="member-actions">
                  <button
                    v-if="currentRoom?.groupId && currentIsAdmin && !m.isAdmin"
                    @click="transferGroupAdmin(m)"
                  >
                    Chuyển quyền admin
                  </button>
                  <button
                    v-if="currentIsAdmin && !m.isAdmin"
                    :disabled="Boolean(currentRoom?.groupId && currentRoomMembers.length <= 3)"
                    class="btn-remove-member"
                    title="Xóa thành viên khỏi nhóm"
                    @click="handleRemoveMember(m)"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Xóa</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn-secondary" @click="showMemberModal = false">Đóng</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import MessageList from '../components/messages/MessageList.vue'
import MessageComposer from '../components/messages/MessageComposer.vue'
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { chatService } from '@/services/index.js'
import { formatMessageDateTime } from '@/utils/formatMessageDateTime.js'
import { contactService } from '@/services/index.js'
import { authService, groupCallService } from '@/services/index.js'
import { userSessionState } from '@/state/sessionState.js'
import { captureSessionContext, isSessionContextCurrent } from '@/services/auth/sessionScope.js'

let viewActive = true
let roomSelectionVersion = 0
const route = useRoute()
const router = useRouter()

const showCreateGroupModal = ref(false)
const expandingGroupRoomId = ref(null)
/** Khi mở rộng nhóm chỉ cần chọn một người mới. */
const minimumSelected = computed(() => (expandingGroupRoomId.value ? 1 : 2))
const showMemberModal = ref(false)
const inputText = ref('')

const pendingForwardMessages = ref([])
const newGroupTitle = ref('')
const groupContactSearch = ref('')
const selectedGroupMemberUuids = ref([])
const isSubmittingGroup = ref(false)
const messageListRef = ref(null)
const isLoadingRooms = ref(false)
const isLoadingMessages = ref(false)

const isRoomSelectMode = ref(false)
const selectedRoomIds = ref([])
const isDeletingRooms = ref(false)
const isDeletingGroup = ref(false)

// Trạng thái phòng bị giải tán qua Tombstone SYSTEM:ROOM_CLOSED
const isRoomClosed = computed(() => Boolean(currentRoom.value?.isClosed))

/** Kiểm tra UUID người dùng khớp admin đã được server xác nhận trước khi bật thao tác quản trị. */
const isRoomAdmin = (room) => {
  // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
  // không tự cấp quyền.
  if (!room || room.isDirect || !room.adminVerified) return false
  const myUuid = userSessionState.userUuid || localStorage.getItem('smartcall_user_uuid')
  // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
  // không tự cấp quyền.
  if (myUuid && room.adminUuid) {
    return room.adminUuid === myUuid
  }
  return false
}

/** Đếm các phòng nhóm hiện có để cập nhật nhãn danh sách. */
const groupRoomsCount = computed(
  () => sortedRooms.value.filter((r) => !r.isDirect && isRoomAdmin(r)).length,
)

/** Bật/tắt chế độ chọn nhiều nhóm để đóng, dọn lựa chọn cũ khi thoát chế độ. */
const toggleRoomSelectMode = () => {
  isRoomSelectMode.value = !isRoomSelectMode.value
  selectedRoomIds.value = []
}

/** Bật/tắt một phòng trong lựa chọn tạm, không đóng phòng ngay. */
const toggleSelectRoom = (roomId) => {
  const room = rooms.value.find((r) => r.id === roomId)
  if (!room || room.isDirect || !isRoomAdmin(room)) return
  const idx = selectedRoomIds.value.indexOf(roomId)
  if (idx > -1) {
    selectedRoomIds.value.splice(idx, 1)
  } else {
    selectedRoomIds.value.push(roomId)
  }
}

/** Chọn hoặc bỏ chọn các phòng nhóm đủ điều kiện trong danh sách hiện tại. */
const selectAllRooms = () => {
  const groupIds = sortedRooms.value.filter((r) => !r.isDirect && isRoomAdmin(r)).map((r) => r.id)
  if (selectedRoomIds.value.length === groupIds.length) {
    selectedRoomIds.value = []
  } else {
    selectedRoomIds.value = [...groupIds]
  }
}

/** Xác nhận thao tác rồi đóng một nhóm qua service và dọn room đang chọn nếu thành công. */
const handleDeleteSingleRoom = async (room) => {
  if (!room || room.isDirect) return
  if (!isRoomAdmin(room)) {
    alert('Chỉ Quản trị viên nhóm (Admin) mới có quyền xóa nhóm này.')
    return
  }
  const title = room.title || 'nhóm này'
  if (
    !confirm(
      `Bạn có chắc chắn muốn xóa nhóm "${title}" không? Web sẽ đóng và ẩn nhóm trong SmartCall. Dữ liệu và quyền thành viên trên Wazo vẫn còn.`,
    )
  ) {
    return
  }

  try {
    await chatService.deleteRoom(room.id)
    if (currentRoom.value && currentRoom.value.id === room.id) {
      currentRoom.value = null
    }
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `🗑️ Đã xóa nhóm "${title}" thành công!`, type: 'success' },
      }),
    )
  } catch (err) {
    alert(`Lỗi khi xóa nhóm: ${err.message}`)
  }
}

/** Đóng các nhóm đã chọn, giữ lại lựa chọn thất bại và báo đúng số thành công từng phần. */
const handleDeleteSelectedRooms = async () => {
  const count = selectedRoomIds.value.length
  if (!count || !confirm('Bạn có chắc muốn đóng ' + count + ' nhóm đã chọn không?')) return
  isDeletingRooms.value = true
  try {
    const result = await chatService.deleteMultipleRooms([...selectedRoomIds.value])
    if (currentRoom.value && result.deletedIds.includes(currentRoom.value.id))
      currentRoom.value = null
    selectedRoomIds.value = result.failures.map((item) => item.roomId)
    isRoomSelectMode.value = result.failures.length > 0
    const message = result.failures.length
      ? 'Đã đóng ' +
        result.deletedIds.length +
        '/' +
        count +
        ' nhóm; ' +
        result.failures.length +
        ' nhóm chưa đóng được.'
      : 'Đã đóng ' + result.deletedIds.length + ' nhóm.'
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { type: result.failures.length ? 'warning' : 'success', message },
      }),
    )
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { type: 'error', message: error.message } }),
    )
  } finally {
    isDeletingRooms.value = false
  }
}

/** Đóng nhóm hiện tại qua cùng cơ chế quyền và tombstone của ChatService. */
const handleDeleteGroupRoom = async () => {
  if (!currentRoom.value || currentRoom.value.isDirect || !currentIsAdmin.value) {
    alert('Chỉ Quản trị viên nhóm (Admin) mới có quyền xóa nhóm này.')
    return
  }
  const groupName = currentRoom.value.title || 'Nhóm này'
  if (
    !confirm(
      `Bạn có chắc chắn muốn xóa nhóm "${groupName}"? Nhóm sẽ đóng trong SmartCall; thao tác này không xóa dữ liệu hoặc quyền thành viên trên Wazo.`,
    )
  ) {
    return
  }

  isDeletingGroup.value = true
  try {
    await chatService.deleteGroupRoom(currentRoom.value.id)
    showMemberModal.value = false
    currentRoom.value = null
    await loadRooms()
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `🚫 Đã xóa nhóm "${groupName}" thành công!`, type: 'success' },
      }),
    )
  } catch (err) {
    alert(`Lỗi khi xóa nhóm: ${err.message}`)
  } finally {
    isDeletingGroup.value = false
  }
}

// Trạng thái thành viên bị mời ra khỏi nhóm
const isKickedFromCurrentRoom = computed(() => Boolean(currentRoom.value?.isKicked))

/** Đóng thông báo và bỏ hội thoại không còn được phép sử dụng khỏi lựa chọn UI. */
const confirmLeaveKickedRoom = () => {
  if (!currentRoom.value) return
  const rId = currentRoom.value.id
  chatService.dismissRoom(rId)
  if (rooms.value.length > 0) {
    selectRoom(rooms.value[0])
  } else {
    currentRoom.value = null
  }
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: 'Đã dọn dẹp và rời khỏi nhóm chat.',
        type: 'info',
      },
    }),
  )
}

// Phân quyền Quản trị viên vs Người dùng thường
const currentIsAdmin = computed(() => {
  // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
  // không tự cấp quyền.
  if (!currentRoom.value || currentRoom.value.isDirect || !currentRoom.value.adminVerified)
    return false
  const myUuid = userSessionState.userUuid || localStorage.getItem('smartcall_user_uuid')
  // Quyền quản trị phải đến từ UUID/metadata được server xác nhận; tên hiển thị hoặc tag text
  // không tự cấp quyền.
  if (myUuid && currentRoom.value.adminUuid) {
    return currentRoom.value.adminUuid === myUuid
  }
  return false
})
/** Đọc tên hiển thị của người đang đăng nhập để gắn alias khi gửi và hiển thị tin của chính mình. */
const currentUserName = computed(
  () => userSessionState.displayName || authService.getCurrentDisplayName() || 'Người dùng',
)
/** Đọc máy lẻ người dùng hiện tại để loại chính mình khi tạo nhóm/gọi nhóm. */
const currentUserExt = computed(
  () => userSessionState.extension || localStorage.getItem('smartcall_extension') || '',
)

/**
 * Tham chiếu trực tiếp nguồn rooms reactive của ChatService, không duy trì mảng song song trong
 * View.
 */
const rooms = computed(() => chatService.rooms)
const currentRoom = ref(null)
const editGroupTitle = ref('')
const isRenamingGroup = ref(false)

/** Sắp các phòng theo bộ lọc/thứ tự hiển thị hiện tại từ nguồn rooms của service. */
const sortedRooms = computed(() => {
  return [...rooms.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

/** Đọc danh sách thành viên của hội thoại đang chọn để hiển thị và kiểm tra lựa chọn nhóm. */
const currentRoomMembers = computed(() => {
  const list = currentRoom.value?.members || []
  const adminId = currentRoom.value?.adminUuid
  if (!currentRoom.value?.isDirect && adminId) {
    return list.map((m) => ({
      ...m,
      isAdmin: Boolean(m.id === adminId || m.uuid === adminId),
    }))
  }
  return list
})

// Thông tin đối phương trong cuộc trò chuyện 1-1
const currentDirectContact = computed(() => {
  if (!currentRoom.value || !currentRoom.value.isDirect) return null
  const myExt = userSessionState.extension || localStorage.getItem('smartcall_extension') || ''
  const myUuid = userSessionState.userUuid || localStorage.getItem('smartcall_user_uuid') || ''
  const otherMember = (currentRoom.value.members || []).find((mem) => {
    const isMe =
      (myUuid && (mem.id === myUuid || mem.uuid === myUuid)) ||
      (myExt && (mem.ext === myExt || mem.number === myExt))
    return !isMe
  })
  const targetExt =
    otherMember?.ext || (currentRoom.value.ext ? String(currentRoom.value.ext).split('@')[0] : '')
  const targetUuid = otherMember?.id || otherMember?.uuid || currentRoom.value.peerUuid || ''
  return (
    (targetExt && contactService.findContactByExtension(targetExt)) ||
    (targetUuid && contactService.findContactByUuid(targetUuid)) ||
    (otherMember
      ? {
          name: otherMember.name,
          number: otherMember.ext,
          dept: otherMember.dept,
          status: 'offline',
          uuid: otherMember.id,
        }
      : null)
  )
})

/** Đổi trạng thái kỹ thuật của liên hệ/phòng thành nhãn người dùng có thể hiểu. */
const getStatusLabel = (status) => {
  switch (status) {
    case 'online':
      return 'Trực tuyến'
    case 'busy':
      return 'Đang gọi'
    case 'ringing':
      return 'Đang đổ chuông'
    case 'away':
      return 'Vắng mặt'
    case 'dnd':
      return 'Không làm phiền'
    default:
      return 'Ngoại tuyến'
  }
}

/** Lấy màu avatar cho liên hệ trong các danh sách chọn người của màn hình tin nhắn. */
const getContactAvatarBg = (contact) => {
  const colors = ['#0284c7', '#7c3aed', '#059669', '#d97706', '#dc2626', '#4f46e5']
  const str = contact?.name || contact?.number || 'U'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

// Danh sách đồng nghiệp từ danh bạ Wazo có thể chọn để tạo nhóm chat
const availableContactsForGroup = computed(() => {
  const list = contactService.currentContacts || []
  const myExt = (
    userSessionState.extension ||
    localStorage.getItem('smartcall_extension') ||
    ''
  ).trim()
  const myUuid = (
    userSessionState.userUuid ||
    localStorage.getItem('smartcall_user_uuid') ||
    ''
  ).trim()
  const q = groupContactSearch.value.trim().toLowerCase()

  return list.filter((c) => {
    if (
      expandingGroupRoomId.value &&
      currentRoomMembers.value.some((member) => member.id === c.uuid)
    )
      return false
    // Loại trừ chính mình
    if (c.uuid && myUuid && c.uuid === myUuid) return false
    if (c.number && myExt && c.number === myExt) return false
    // Lọc theo từ khóa tìm kiếm
    if (q) {
      const matchName = (c.name || '').toLowerCase().includes(q)
      const matchExt = (c.number || '').toLowerCase().includes(q)
      return matchName || matchExt
    }
    return true
  })
})

let hasLoadedRooms = false

/** Nạp lần đầu có loading; những lần sau giữ dữ liệu trong RAM khi đồng bộ nền. */
const loadRooms = async () => {
  const context = captureSessionContext()
  isLoadingRooms.value = !hasLoadedRooms && rooms.value.length === 0
  try {
    await chatService.getRooms()
    // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
    // muộn sau hủy/đổi phiên.
    if (!isSessionContextCurrent(context)) return
    hasLoadedRooms = true
    // Giữ phòng đang mở. Tự chọn phòng khác có thể làm mất huy hiệu tin chưa mở.
    if (currentRoom.value) {
      const found = rooms.value.find((r) => r.id === currentRoom.value.id)
      if (found) currentRoom.value = found
    }
  } finally {
    isLoadingRooms.value = false
  }
}

/** Chọn phòng, nạp lịch sử và chỉ áp dụng kết quả nếu người dùng vẫn đang xem đúng phòng/lượt chọn. */
const selectRoom = async (room) => {
  if (isRoomSelectMode.value) return
  const context = captureSessionContext()
  const selectionVersion = ++roomSelectionVersion
  currentRoom.value = room
  chatService.publishRoomsChanged()
  if (route.query && route.query.ext) {
    router.replace({ path: '/messages', query: {} }).catch(() => {})
  }
  // Tự động kéo lịch sử tin nhắn từ Wazo chatd nếu là phòng trên server thật
  if (room && room.id && !room.id.startsWith('room-') && !room.id.startsWith('direct-')) {
    // Giữ lịch sử đã hiển thị trong lúc lấy bản mới, tránh nháy trắng khi mở lại phòng.
    isLoadingMessages.value = !room.messages?.length
    try {
      const msgs = await chatService.getRoomMessages(room.id)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context)) return
      if (msgs && msgs.length > 0) {
        room.messages = msgs
      }
    } finally {
      if (selectionVersion === roomSelectionVersion) isLoadingMessages.value = false
    }
  }
  scrollToBottom()
}

/**
 * Giữ lại định danh/lượt chọn phòng trước await, gửi qua service và không kéo người dùng về phòng
 * cũ khi gửi xong.
 */
const sendMessage = async () => {
  const text = inputText.value.trim()
  if (!text || !currentRoom.value || isKickedFromCurrentRoom.value || isRoomClosed.value) return

  const targetId = currentRoom.value.id
  const selectionVersion = roomSelectionVersion
  const context = captureSessionContext()
  inputText.value = ''

  // Cập nhật ngay tức thì trên mảng rooms để giao diện nhảy Top 1 lập tức
  const target = rooms.value.find((r) => r.id === targetId)
  if (target && !target.groupId) {
    target.updatedAt = Date.now()
    target.preview = text
    target.time = formatMessageDateTime(new Date())
  }

  try {
    // Lưu bền vững vào cơ sở dữ liệu chatService và đồng bộ Wazo Chatd
    const sentMsg = await chatService.sendMessage(targetId, text, currentUserName.value)
    // Nhóm managed đã đưa ACK vào state nên không cần tải lại tất cả phòng sau mỗi tin.
    if (!isSessionContextCurrent(context)) return
    if (!target?.groupId) await chatService.getRooms()
    // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
    // muộn sau hủy/đổi phiên.
    if (!isSessionContextCurrent(context)) return
    const updated = rooms.value.find(
      (r) => r.id === targetId || (sentMsg && r.messages?.some((m) => m.id === sentMsg.id)),
    )
    if (
      updated &&
      viewActive &&
      currentRoom.value?.id === targetId &&
      selectionVersion === roomSelectionVersion
    )
      currentRoom.value = updated
    scrollToBottom()
  } catch (error) {
    // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
    // muộn sau hủy/đổi phiên.
    if (!isSessionContextCurrent(context)) return
    if (currentRoom.value?.id === targetId && !inputText.value) inputText.value = text
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { type: 'error', message: error.message || 'Không thể gửi tin nhắn.' },
      }),
    )
  }
}

/** Đợi Vue cập nhật DOM rồi cuộn vùng tin nhắn tới nội dung cuối. */
const scrollToBottom = () => {
  nextTick(() => {
    messageListRef.value?.scrollToBottom()
  })
}

// Xử lý mở hội thoại 1-1 trực tiếp khi người dùng chuyển từ Danh bạ sang (Zero-ms switch)
const checkDirectChatRoute = async () => {
  if (viewActive && route.path === '/messages' && route.query && route.query.ext) {
    const selectionVersion = ++roomSelectionVersion
    const context = captureSessionContext()
    const ext = String(route.query.ext).split('@')[0].trim()
    const isSelf = ext === currentUserExt.value
    const rawName = route.query.name ? String(route.query.name) : `Máy lẻ ${ext}`
    const name = isSelf && !rawName.includes('(Bạn)') ? `${rawName} (Bạn)` : rawName

    // 1. Tìm ngay trong RAM (0ms) - Bắt buộc phải là phòng 1-1 (isDirect)
    let target = chatService.rooms.find(
      (r) =>
        r.isDirect &&
        (String(r.ext || '')
          .split('@')[0]
          .trim() === ext ||
          (r.members &&
            r.members.length === 2 &&
            r.members.some(
              (m) =>
                String(m.ext || '')
                  .split('@')[0]
                  .trim() === ext,
            ))),
    )

    if (target) {
      if (isSelf && !target.title.includes('(Bạn)')) {
        target.title = `${target.title} (Bạn)`
      }
      currentRoom.value = target
    }

    // Xóa sạch query URL ngay lập tức để tránh re-trigger khi switch tab
    router.replace({ path: '/messages', query: {} }).catch(() => {})

    // 2. Phân giải hoặc nâng cấp phòng Wazo Chatd server thật
    try {
      const serverRoom = await chatService.getOrCreateDirectRoom(ext, name, currentUserName.value)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (
        serverRoom &&
        viewActive &&
        selectionVersion === roomSelectionVersion &&
        isSessionContextCurrent(context)
      ) {
        currentRoom.value = serverRoom
        if (!serverRoom.id.startsWith('direct-')) {
          const msgs = await chatService.getRoomMessages(serverRoom.id)
          if (msgs && msgs.length > 0) {
            serverRoom.messages = msgs
          }
        }
      }
    } catch (err) {
      console.warn('Lỗi phân giải phòng chat direct:', err)
    }

    scrollToBottom()
  }
}

// Đồng bộ state hiển thị khi dữ liệu được theo dõi thay đổi; việc tải/ghi nghiệp vụ vẫn thuộc
// service hoặc handler tương ứng.
watch(
  () => route.query,
  () => {
    checkDirectChatRoute()
  },
  { immediate: true },
)

// Đồng bộ phòng đang xem, kể cả KeepAlive/chuyển route và cửa sổ bị ẩn hoặc mất focus.
/** Báo phòng đang hiển thị để không xóa số khi View/tab bị ẩn. */
const syncVisibleRoom = () => {
  chatService.setVisibleRoom(
    viewActive && route.path === '/messages' ? currentRoom.value?.id : null,
  )
}
watch(() => [currentRoom.value?.id, route.path], syncVisibleRoom, { flush: 'sync' })

// Lắng nghe sự kiện tin nhắn thời gian thực và cập nhật danh sách phòng từ chatService (SSOT)
const onMessageReceived = (ev) => {
  const { roomId } = ev.detail || {}
  if (currentRoom.value && currentRoom.value.id === roomId) {
    const updated = rooms.value.find((r) => r.id === roomId)
    if (updated) currentRoom.value = updated
    scrollToBottom()
  }
}

/** Đồng bộ phòng đang xem khi service phát thay đổi danh sách phòng/tin nhắn. */
const onRoomsUpdated = () => {
  if (currentRoom.value) {
    const updated = rooms.value.find((r) => r.id === currentRoom.value.id)
    if (updated) currentRoom.value = updated
  }
}

/** Bỏ phòng đang chọn và hiện thông báo khi nhận trạng thái đóng phòng đáng tin. */
const onRoomClosed = (ev) => {
  const { roomId } = ev.detail || {}
  if (currentRoom.value && currentRoom.value.id === roomId) {
    currentRoom.value.isClosed = true
  }
}

// Khi component được gắn vào DOM, nạp dữ liệu và đăng ký các listener/tài nguyên cần cho giao diện
// này.
onMounted(async () => {
  window.addEventListener('smartcall-message-received', onMessageReceived)
  window.addEventListener('smartcall-rooms-updated', onRoomsUpdated)
  window.addEventListener('smartcall-refresh-rooms', loadRooms)
  window.addEventListener('smartcall-room-closed', onRoomClosed)
  window.addEventListener('focus', syncVisibleRoom)
  document.addEventListener('visibilitychange', syncVisibleRoom)
  syncVisibleRoom()
  await loadRooms()
  if (!viewActive) return
  checkDirectChatRoute()
})

// Khi View được KeepAlive mở lại, đồng bộ dữ liệu/tài nguyên với phiên hiện tại thay vì dùng trạng
// thái cũ.
onActivated(async () => {
  viewActive = true
  syncVisibleRoom()
  const context = captureSessionContext()
  await loadRooms()
  if (!viewActive || !isSessionContextCurrent(context)) return
  if (route.query && route.query.ext) {
    checkDirectChatRoute()
  }
})

// Khi View được KeepAlive ẩn đi, dừng tài nguyên/tác vụ không còn cần hoạt động dù component chưa
// bị hủy.
onDeactivated(() => {
  viewActive = false
  syncVisibleRoom()
  roomSelectionVersion += 1
})

// Khi component bị hủy, gỡ listener và dọn tài nguyên thuộc vòng đời này để callback cũ không tiếp
// tục tác động UI.
onUnmounted(() => {
  viewActive = false
  syncVisibleRoom()
  roomSelectionVersion += 1
  window.removeEventListener('smartcall-message-received', onMessageReceived)
  window.removeEventListener('smartcall-rooms-updated', onRoomsUpdated)
  window.removeEventListener('smartcall-refresh-rooms', loadRooms)
  window.removeEventListener('smartcall-room-closed', onRoomClosed)
  window.removeEventListener('focus', syncVisibleRoom)
  document.removeEventListener('visibilitychange', syncVisibleRoom)
})

// Các hàm tương tác Modal Tạo nhóm & Quản lý thành viên (Pure Wazo Chatd API First)
const closeCreateGroupModal = () => {
  showCreateGroupModal.value = false
  expandingGroupRoomId.value = null
}

/** Mở modal tạo nhóm và reset dữ liệu lựa chọn trước đó. */
const openCreateGroupModal = (initialContact = null, messagesToForward = []) => {
  newGroupTitle.value = ''
  groupContactSearch.value = ''
  selectedGroupMemberUuids.value = []
  expandingGroupRoomId.value = null
  pendingForwardMessages.value = Array.isArray(messagesToForward) ? [...messagesToForward] : []

  // Đảm bảo danh bạ đã nạp đầy đủ
  if (!contactService.currentContacts || contactService.currentContacts.length === 0) {
    contactService.getContacts().catch(() => {})
  }

  if (initialContact) {
    if (initialContact.uuid) {
      selectedGroupMemberUuids.value.push(initialContact.uuid)
    }
    newGroupTitle.value = `Nhóm thảo luận [${initialContact.name || initialContact.number || 'Nội bộ'}]`
  }

  showCreateGroupModal.value = true
}

/** Bật/tắt một UUID trong danh sách thành viên tạm của nhóm mới. */
const toggleSelectGroupMember = (uuid) => {
  if (!uuid) return
  const idx = selectedGroupMemberUuids.value.indexOf(uuid)
  if (idx > -1) {
    selectedGroupMemberUuids.value.splice(idx, 1)
  } else {
    selectedGroupMemberUuids.value.push(uuid)
  }
}

/** Kiểm tra tên/thành viên, tạo phòng qua API rồi chuyển UI sang phòng vừa được server xác nhận. */
const submitCreateGroup = async () => {
  if (selectedGroupMemberUuids.value.length < minimumSelected.value) {
    alert(
      'Vui lòng chọn ít nhất 2 đồng nghiệp để tạo nhóm chat (nhóm cần ít nhất 3 thành viên bao gồm bạn).',
    )
    return
  }

  isSubmittingGroup.value = true
  try {
    let title = newGroupTitle.value.trim()
    if (!title) {
      const chosenNames = selectedGroupMemberUuids.value
        .map((u) => {
          const c = contactService.findContactByUuid(u)
          return c?.name || 'Đồng nghiệp'
        })
        .slice(0, 2)
      title = `Nhóm [${chosenNames.join(', ')}...]`
    }

    let createdRoom = null
    const isExpanding = Boolean(expandingGroupRoomId.value)
    if (isExpanding) {
      if (
        currentRoom.value?.groupId &&
        !confirm('Thành viên được thêm sẽ đọc được toàn bộ lịch sử nhóm. Tiếp tục?')
      )
        return
      createdRoom = await chatService.addMembersToGroup(
        expandingGroupRoomId.value,
        selectedGroupMemberUuids.value,
        title,
      )
    } else {
      createdRoom = await chatService.createGroupRoom(
        title,
        selectedGroupMemberUuids.value,
        pendingForwardMessages.value,
      )
    }

    closeCreateGroupModal()
    await loadRooms()
    if (createdRoom) {
      await selectRoom(createdRoom)
    }
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: isExpanding
            ? `Đã thêm thành viên vào nhóm.`
            : `🎉 Đã tạo nhóm chat [${title}] thành công!`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    alert(`Lỗi tạo nhóm: ${err.message}`)
  } finally {
    isSubmittingGroup.value = false
  }
}

/** Mở danh sách thành viên của nhóm hiện tại và nạp dữ liệu trình bày cần thiết. */
const openMemberModal = () => {
  if (!currentRoom.value) return
  editGroupTitle.value = currentRoom.value.title || ''
  showMemberModal.value = true
}

/** Yêu cầu đổi tên qua service có kiểm tra quyền; chỉ áp dụng kết quả được xác nhận. */
const handleSaveGroupName = async () => {
  if (!currentRoom.value || !editGroupTitle.value.trim()) return
  isRenamingGroup.value = true
  try {
    const updated = await chatService.renameGroup(currentRoom.value.id, editGroupTitle.value.trim())
    if (updated) {
      currentRoom.value.title = updated.title
    }
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `✏️ Đã đổi tên nhóm thành: "${editGroupTitle.value.trim()}"`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    alert(`Lỗi đổi tên nhóm: ${err.message}`)
  } finally {
    isRenamingGroup.value = false
  }
}

/**
 * Chuyển yêu cầu xóa người tới service; hiện service chặn khi chưa có API membership đúng hợp
 * đồng.
 */
const handleRemoveMember = async (member) => {
  if (!currentRoom.value || !currentIsAdmin.value) {
    alert('Chỉ Quản trị viên nhóm (Admin) mới có quyền xóa thành viên.')
    return
  }
  const memberName = member.name || `Máy lẻ ${member.ext}` || 'thành viên'
  const memberId = member.id || member.uuid
  if (!confirm(`Bạn có chắc chắn muốn xóa [${memberName}] khỏi nhóm thảo luận?`)) {
    return
  }

  try {
    const updatedRoom = await chatService.removeMemberFromGroup(currentRoom.value.id, memberId)
    await loadRooms()
    if (updatedRoom) {
      await selectRoom(updatedRoom)
    }
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `👋 Đã xóa [${memberName}] khỏi nhóm chat!`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    alert(`Lỗi khi xóa thành viên: ${err.message}`)
  }
}

/** Chuẩn bị giao diện tạo nhóm từ hội thoại trực tiếp, giữ việc tạo UUID phòng thật ở service. */
const upgradeDirectToGroup = () => {
  showMemberModal.value = false
  const directContact = currentDirectContact.value
  const msgs = currentRoom.value?.messages || []
  openCreateGroupModal(directContact, chatService.groups?.enabled ? [] : msgs)
}

/** Mở luồng chọn người bổ sung; không thay phòng/lịch sử để giả lập API thêm thành viên. */
const openAddMoreToGroup = () => {
  if (!currentIsAdmin.value) {
    alert('Chỉ Quản trị viên nhóm (Admin) mới có quyền thêm thành viên.')
    return
  }
  const sourceRoomId = currentRoom.value?.id
  showMemberModal.value = false
  const msgs = currentRoom.value?.messages || []
  openCreateGroupModal(null, msgs)
  // Lưu ID phòng nhóm nguồn cần mở rộng và đóng sau khi tạo nhóm mới
  expandingGroupRoomId.value = sourceRoomId
  newGroupTitle.value = currentRoom.value.title || 'Nhóm thảo luận'
}

/** Đọc trang lịch sử trước và giữ đúng nhóm đang xem. */
async function loadOlderMessages() {
  try {
    await chatService.groups.history(currentRoom.value.id, true)
  } catch (error) {
    alert(error.message)
  }
}

/** Xác nhận chuyển quyền vì người đang thao tác sẽ mất quyền quản trị. */
async function transferGroupAdmin(member) {
  if (!confirm('Chuyển quyền quản trị cho ' + member.name + '?')) return
  try {
    await chatService.groups.command(currentRoom.value.id, '/admin-transfer', 'POST', {
      targetUserUuid: member.id,
    })
  } catch (error) {
    alert(error.message)
  }
}

const isStartingVoiceCall = ref(false)

/** Gọi từ hội thoại; chỉ điều hướng một lần và để dịch vụ lọc thành viên khả dụng. */
const startVoiceCall = async () => {
  if (!currentRoom.value || isStartingVoiceCall.value) return
  const room = currentRoom.value
  const context = captureSessionContext()
  isStartingVoiceCall.value = true
  try {
    if (currentRoom.value.isDirect) {
      const targetExt = String(currentRoom.value.ext || '').trim()
      if (!targetExt) {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: 'Phòng chat này chưa được gán số máy lẻ nội bộ để thực hiện cuộc gọi',
              type: 'warning',
            },
          }),
        )
        return
      }
      window.dispatchEvent(
        new CustomEvent('app-action', {
          detail: { type: 'dial', value: targetExt },
        }),
      )
      // App mở /calls kèm number/autocall; điều hướng lần hai sẽ làm mất lệnh tự gọi.
    } else {
      // CUỘC GỌI NHÓM TỨC THỜI (AD-HOC CONFERENCE - THAY THẾ HOÀN TOÀN PHÒNG HỌP TĨNH 8001)
      const myExt = String(
        authService.getCurrentExtension() ||
          userSessionState.extension ||
          localStorage.getItem('smartcall_extension') ||
          '',
      ).trim()
      const myUuid = String(
        userSessionState.userUuid || localStorage.getItem('smartcall_user_uuid') || '',
      ).trim()
      if (room.groupId) {
        const latest = await chatService.groups.refresh(room.id)
        if (currentRoom.value?.id !== room.id || latest.status !== 'active') return
        currentRoom.value = latest
      }
      const memberExts = []
      for (const m of currentRoomMembers.value) {
        const mId = m.id || m.uuid
        if (myUuid && mId === myUuid) continue

        let ext = m.ext || m.extension || m.number || (m.extra && m.extra.extension)
        if (!ext && mId) {
          const c = contactService.findContactByUuid(mId)
          ext = c?.number || c?.exten || ''
        }

        const clean = String(ext || '').trim()
        if (clean && clean !== myExt && !memberExts.includes(clean)) {
          memberExts.push(clean)
        }
      }

      if (memberExts.length === 0) {
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message:
                '⚠️ Các thành viên trong nhóm chưa được gán số máy lẻ để thực hiện cuộc gọi nhóm',
              type: 'warning',
            },
          }),
        )
        return
      }

      const roomTitle = currentRoom.value.title || 'Nhóm'
      const totalCount = memberExts.length + 1
      if (
        confirm(
          `Khởi tạo cuộc gọi nhóm tức thời tới [${roomTitle}] (${totalCount} thành viên)?\n\nHệ thống sẽ tự động gọi đồng thời và kết nối các thành viên vào cuộc gọi nhóm (Ad-hoc Conference).`,
        )
      ) {
        // Người dùng có thể giữ hộp xác nhận lâu trong khi admin đang đổi roster.
        if (room.groupId) {
          const activation = currentRoom.value.activeActivationId
          const latest = await chatService.groups.refresh(room.id)
          if (
            currentRoom.value?.id !== room.id ||
            latest.status !== 'active' ||
            latest.activeActivationId !== activation
          ) {
            throw new Error('Thành viên nhóm vừa thay đổi.')
          }
        }
        // Dịch vụ bỏ máy bận/offline/DND; còn một người thì tự chuyển sang gọi 1-1.
        const result = await groupCallService.startGroupCall(memberExts, {
          groupTitle: roomTitle,
          roomId: room.id,
        })
        // Kết quả của phiên đã đăng xuất không được mở màn hình gọi hoặc gửi tin vào chat.
        if (!isSessionContextCurrent(context)) return
        if (!result?.success) {
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: {
                message:
                  'Không thể bắt đầu cuộc gọi. Hãy kiểm tra trạng thái thành viên và cuộc gọi hiện tại.',
                type: 'warning',
              },
            }),
          )
          return
        }
        router.push('/calls')
        // Gửi lời gọi thành công chưa có nghĩa tất cả thành viên đã nghe máy.
        chatService
          .sendMessage(
            room.id,
            `📞 [${currentUserName.value}] đã khởi tạo cuộc gọi từ nhóm.`,
            'Hệ thống Tổng đài',
          )
          .catch(() => {})
      }
    }
  } catch (error) {
    if (!isSessionContextCurrent(context)) return
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: 'Không thể bắt đầu cuộc gọi. Vui lòng thử lại.', type: 'error' },
      }),
    )
  } finally {
    isStartingVoiceCall.value = false
  }
}

/**
 * Phản hồi thao tác video theo khả năng hiện tại của Web; không tự mở một luồng media chưa được hỗ
 * trợ.
 */
const handleVideoCallClick = () => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message:
          '🎥 Tính năng Cuộc gọi Video hiện đang trong giai đoạn phát triển và sẽ sớm được ra mắt trong phiên bản tiếp theo!',
        type: 'info',
      },
    }),
  )
}

/** Chọn lớp CSS trạng thái của phòng từ dữ liệu liên hệ/presence để hiển thị chấm trạng thái. */
const getRoomStatusClass = (room) => {
  if (!room || !room.isDirect) return 'online'
  const myExt = userSessionState.extension || localStorage.getItem('smartcall_extension') || ''
  const myUuid = userSessionState.userUuid || localStorage.getItem('smartcall_user_uuid') || ''
  const otherMember = (room.members || []).find((mem) => {
    const isMe =
      (myUuid && (mem.id === myUuid || mem.uuid === myUuid)) ||
      (myExt && (mem.ext === myExt || mem.number === myExt))
    return !isMe
  })
  const targetExt = otherMember?.ext || (room.ext ? String(room.ext).split('@')[0] : '')
  const targetUuid = otherMember?.id || otherMember?.uuid || room.peerUuid || ''
  const contact =
    (targetExt && contactService.findContactByExtension(targetExt)) ||
    (targetUuid && contactService.findContactByUuid(targetUuid)) ||
    null
  if (contact) {
    return contact.status || 'offline'
  }
  return 'offline'
}
</script>

<style scoped>
.room-unread-badge {
  flex-shrink: 0;
  min-width: 20px;
  padding: 2px 6px;
  border-radius: 12px;
  background: #ef4444;
  color: white;
  font-size: 0.75rem;
  text-align: center;
}

.messages-view {
  height: calc(100vh - 56px);
  margin: -24px;
}

.chat-container {
  display: flex;
  height: 100%;
  background: white;
}

/* Cột danh sách phòng */
.chat-rooms-col {
  width: 320px;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.rooms-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 54px;
  box-sizing: border-box;
}

.rooms-header h2 {
  font-size: 1.15rem;
  color: #1e293b;
  margin: 0;
  font-weight: 700;
}

.rooms-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-manage-rooms {
  background: #f8fafc;
  color: #475569;
  border: 1px solid #cbd5e1;
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.btn-manage-rooms:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
}

.btn-manage-rooms.active {
  background: #fee2e2;
  color: #dc2626;
  border-color: #fca5a5;
}

.btn-manage-rooms.active:hover {
  background: #fecaca;
}

.btn-new-room {
  background: #1e88e5;
  color: white;
  border: none;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  transition: background 0.15s ease;
}

.btn-new-room:hover {
  background: #1976d2;
}

.room-list {
  flex: 1;
  overflow-y: auto;
}

.room-item {
  padding: 12px 16px;
  display: flex;
  align-items: center; /* Căn giữa theo chiều dọc để các nút không bị kéo giãn */
  gap: 12px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.15s;
}

.room-item:hover {
  background: #f8fafc;
}

.room-item.active {
  background: #e0f2fe;
  border-left: 4px solid #1e88e5;
}

.avatar-sm {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 0.95rem;
  flex-shrink: 0;
  position: relative;
}

.status-badge-dot {
  position: absolute;
  bottom: 0px;
  right: 0px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #ffffff;
}

.status-badge-dot.online,
.status-dot-inline.online {
  background: #10b981;
}

.status-badge-dot.busy,
.status-badge-dot.talking,
.status-badge-dot.holding,
.status-dot-inline.busy,
.status-dot-inline.talking,
.status-dot-inline.holding {
  background: #ef4444;
}

.status-badge-dot.away,
.status-dot-inline.away {
  background: #f59e0b;
}

.status-badge-dot.dnd,
.status-dot-inline.dnd {
  background: #8b5cf6;
}

.status-badge-dot.ringing,
.status-dot-inline.ringing {
  background: #3b82f6;
}

.status-badge-dot.offline,
.status-dot-inline.offline {
  background: #94a3b8;
}

.status-dot-inline {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 6px;
  vertical-align: middle;
}

.avatar-sm.group-avatar {
  background: linear-gradient(135deg, #8b5cf6, #6366f1) !important;
  font-size: 1.15rem;
  box-shadow: 0 2px 6px rgba(139, 92, 246, 0.25);
}

.room-info {
  flex: 1;
  min-width: 0;
}

.room-top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.room-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-tag {
  color: #64748b;
  font-weight: normal;
}

.room-time {
  font-size: 0.72rem;
  color: #94a3b8;
}

.room-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.room-preview {
  font-size: 0.82rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Cột khung chat chính */
.chat-main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.empty-box {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-hint {
  text-align: center;
  color: #94a3b8;
  max-width: 320px;
}

.empty-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 12px;
}

.chat-header {
  background: white;
  padding: 12px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-title-group h3 {
  font-size: 1.1rem;
  color: #0f172a;
  margin: 0 0 2px 0;
}

.online-indicator {
  font-size: 0.75rem;
  color: #16a34a;
}

.chat-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.btn-action {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.btn-action:hover {
  background: #f1f5f9;
}

.header-action-svg {
  width: 16px;
  height: 16px;
  fill: #475569;
  transition: fill 0.15s;
}

.btn-action:hover .header-action-svg {
  fill: #1e88e5;
}

.btn-manage-members {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

/* Messages */

/* Kicked Member Banner */
.kicked-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fef2f2;
  border-top: 1px solid #fecaca;
  color: #991b1b;
  font-size: 0.85rem;
}

.kicked-icon {
  font-size: 1.2rem;
}

.kicked-text {
  flex: 1;
  line-height: 1.4;
}

.btn-leave-kicked-room {
  background: #dc2626;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}

.btn-leave-kicked-room:hover {
  background: #b91c1c;
}

/* Input Bar */

/* Modals */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: white;
  border-radius: 10px;
  width: 480px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.modal-head {
  padding: 16px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: #1e293b;
  font-size: 0.95rem;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
}

.modal-body {
  padding: 20px;
}

.admin-perm-notice {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  margin-bottom: 14px;
  line-height: 1.4;
}

.form-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px;
  margin-top: 12px;
}

.form-label:first-of-type {
  margin-top: 0;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
}

.form-input:disabled {
  background: #f1f5f9;
  cursor: not-allowed;
  color: #94a3b8;
}

.search-add-row {
  display: flex;
  gap: 8px;
}

.btn-action-add {
  background: #1e88e5;
  color: white;
  border: none;
  width: 38px;
  border-radius: 6px;
  font-size: 1.2rem;
  cursor: pointer;
  flex-shrink: 0;
}

/* Group Rename Section in Modal */
.group-rename-section {
  margin-bottom: 14px;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.group-rename-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.group-rename-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.88rem;
  background: white;
  outline: none;
}

.group-rename-input:disabled {
  background: #f1f5f9;
  color: #64748b;
  cursor: not-allowed;
}

.btn-save-group-name {
  background: #0284c7;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.btn-save-group-name:hover:not(:disabled) {
  background: #0369a1;
}

.btn-save-group-name:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

.text-hint-locked {
  display: block;
  margin-top: 5px;
  font-size: 0.74rem;
  color: #94a3b8;
}

.member-list-box {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-top: 6px;
}

.member-row {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.member-avatar-wrapper {
  position: relative;
  display: inline-block;
  margin-right: 12px;
  flex-shrink: 0;
}

.member-status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #ffffff;
}

.member-status-dot.online {
  background-color: #22c55e;
}

.member-status-dot.busy,
.member-status-dot.ringing {
  background-color: #ef4444;
}

.member-status-dot.away {
  background-color: #eab308;
}

.member-status-dot.dnd {
  background-color: #dc2626;
}

.member-status-dot.offline {
  background-color: #94a3b8;
}

.member-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.member-actions {
  display: flex;
  align-items: center;
  margin-left: auto;
}

.member-info {
  display: flex;
  flex-direction: column;
}

.member-info strong {
  font-size: 0.88rem;
  color: #1e293b;
}

.member-info small {
  font-size: 0.75rem;
  color: #64748b;
}

.admin-badge {
  background: #fef3c7;
  color: #b45309;
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 12px;
  font-weight: 700;
}

.btn-remove-member {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fee2e2;
  color: #ef4444;
  border: 1px solid #fecaca;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1;
}

.btn-remove-member:hover {
  background: #ef4444;
  color: white;
}

.modal-foot {
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-secondary {
  background: #e2e8f0;
  color: #475569;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

.group-icon-prefix {
  font-size: 1.1rem;
  margin-right: 4px;
}

/* Contact selection in Create Group Modal */
.contact-select-box {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-top: 6px;
  background: #f8fafc;
}

.no-contacts-hint {
  padding: 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 0.85rem;
}

.contact-select-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  transition: background 0.15s;
}

.contact-select-row:last-child {
  border-bottom: none;
}

.contact-select-row:hover {
  background: #eff6ff;
}

.contact-select-row.selected {
  background: #e0f2fe;
}

.contact-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #0284c7;
}

.contact-avatar-mini {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}

.contact-detail-mini {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.contact-detail-mini strong {
  font-size: 0.88rem;
  color: #1e293b;
}

.contact-detail-mini small {
  font-size: 0.75rem;
  color: #64748b;
}

.status-pill {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
}

.status-pill.online {
  background: #dcfce7;
  color: #15803d;
}

.status-pill.busy,
.status-pill.ringing {
  background: #fee2e2;
  color: #b91c1c;
}

.status-pill.away {
  background: #fef3c7;
  color: #b45309;
}

.status-pill.offline {
  background: #f1f5f9;
  color: #94a3b8;
}

.select-counter-hint {
  font-size: 0.82rem;
  color: #64748b;
  margin-top: 10px;
  padding: 6px 10px;
  background: #f1f5f9;
  border-radius: 6px;
}

.select-counter-hint.valid {
  background: #ecfdf5;
  color: #047857;
}

/* Direct member view modal */
.direct-member-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  margin-bottom: 16px;
}

.avatar-direct-modal {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 700;
  flex-shrink: 0;
}

.direct-member-meta h4 {
  margin: 0 0 4px 0;
  font-size: 1.05rem;
  color: #1e293b;
}

.direct-member-meta p {
  margin: 2px 0;
  font-size: 0.82rem;
  color: #64748b;
}

.status-text-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.75rem;
}

.status-text-badge.online {
  background: #dcfce7;
  color: #15803d;
}

.status-text-badge.busy,
.status-text-badge.ringing {
  background: #fee2e2;
  color: #b91c1c;
}

.status-text-badge.away {
  background: #fef3c7;
  color: #b45309;
}

.status-text-badge.offline {
  background: #f1f5f9;
  color: #94a3b8;
}

.group-upgrade-banner {
  background: #f5f3ff;
  border: 1px dashed #c4b5fd;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}

.group-upgrade-banner p {
  margin: 0 0 12px 0;
  font-size: 0.84rem;
  color: #6d28d9;
  line-height: 1.4;
}

.btn-upgrade-group {
  background: #7c3aed;
  color: white;
  border: none;
  padding: 9px 18px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-upgrade-group:hover {
  background: #6d28d9;
}

.group-actions-bar-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin: 14px 0;
  box-sizing: border-box;
}

.btn-group-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  width: 100%;
  box-sizing: border-box;
}

.btn-group-action.btn-add-member {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}
.btn-group-action.btn-add-member:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

.btn-group-action.btn-delete-group {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.btn-group-action.btn-delete-group:hover:not(:disabled) {
  background: #fee2e2;
  border-color: #fca5a5;
}
.btn-group-action.btn-delete-group:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.non-admin-notice-banner {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #64748b;
  font-size: 0.8rem;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 14px;
  line-height: 1.45;
}

.member-avatar-mini {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 700;
  flex-shrink: 0;
  margin-right: 10px;
}

/* Loading Spinners & Empty states */
.rooms-loading,
.messages-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 16px;
  gap: 12px;
  color: #64748b;
  font-size: 0.88rem;
  flex: 1;
}

.rooms-empty,
.messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  gap: 10px;
  color: #94a3b8;
  font-size: 0.88rem;
  text-align: center;
  flex: 1;
}

.rooms-empty-icon {
  font-size: 2rem;
  opacity: 0.7;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Toolbar & Select Mode for Conversations (Cột danh sách phòng bên trái) */
.room-select-toolbar {
  padding: 8px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: #334155;
  gap: 8px;
}

.room-select-info {
  display: flex;
  align-items: center;
}

.room-select-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-select-mini {
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-select-mini:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.btn-select-mini.danger {
  background: #ef4444;
  color: #ffffff;
  border-color: #dc2626;
  font-weight: 600;
}

.btn-select-mini.danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-select-mini.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.room-item.in-select-mode {
  user-select: none;
}

.room-item.is-selected {
  background: #e0f2fe !important;
  border-left: 3px solid #0284c7;
}

.room-select-check {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 2px;
}

.select-room-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #0284c7;
}

.btn-delete-room-hover {
  width: 28px;
  height: 28px;
  min-width: 28px;
  max-width: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  padding: 0;
  margin-left: auto;
  align-self: center;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.room-item:hover .btn-delete-room-hover {
  opacity: 0.65;
}

.btn-delete-room-hover:hover {
  opacity: 1 !important;
  background: #fee2e2;
  color: #ef4444;
}

.closed-banner {
  background: #fef2f2 !important;
  border-left: 4px solid #ef4444 !important;
  color: #991b1b !important;
}
</style>
