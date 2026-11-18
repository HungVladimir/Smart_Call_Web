<template>
  <div class="calls-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-titles">
        <h1>Gọi điện & Danh bạ</h1>
        <span class="sub-text"
          >Quản trị đàm thoại WebRTC và tra cứu danh bạ máy lẻ nội bộ</span
        >
      </div>
    </div>

    <!-- Segmented Control dành cho Màn hình Di động (< 768px) -->
    <div class="mobile-segmented-bar">
      <button
        class="seg-btn"
        :class="{ active: mobileTab === 'dialer' }"
        @click="mobileTab = 'dialer'"
      >
        📞 Bàn phím & Đàm thoại
      </button>
      <button
        class="seg-btn"
        :class="{ active: mobileTab === 'contacts' }"
        @click="mobileTab = 'contacts'"
      >
        👥 Danh bạ ({{ contacts.length }})
      </button>
    </div>

    <!-- Mini Call Bar ghim đầu trang di động khi đang đàm thoại mà xem tab Danh bạ -->
    <div v-if="isCalling && mobileTab === 'contacts'" class="mobile-active-call-bar">
      <div class="bar-call-info">
        <span class="mini-pulse-dot"></span>
        <span class="bar-name">{{
          callStore.activeCall?.name || callStore.activeCall?.number
        }}</span>
        <span class="bar-duration">{{ durationText }}</span>
      </div>
      <div class="bar-call-actions">
        <button
          class="btn-mini-control"
          :class="{ active: isMuted }"
          @click="toggleMute"
          title="Mute"
        >
          {{ isMuted ? '🔇' : '🎙️' }}
        </button>
        <button class="btn-mini-hangup" @click="hangupCall" title="Cúp máy">Cúp máy</button>
      </div>
    </div>

    <!-- Main Adaptive 3-Tier Grid Layout -->
    <div class="calls-grid-layout" :class="`mobile-show-${mobileTab}`">
      <!-- CỘT 1: BÀN PHÍM SỐ (DIALER) -->
      <section class="dialer-col">
        <div class="dialer-box">
          <div class="dialer-screen">
            <input
              v-model="extension"
              type="tel"
              placeholder="Nhập số máy lẻ..."
              aria-label="Nhập số máy lẻ cần gọi"
              maxlength="8"
              @keyup.enter="handleDial"
            />
          </div>

          <div class="keypad-grid">
            <button v-for="k in keys" :key="k.num" class="key-btn" @click="pressKey(k.num)">
              <span class="num">{{ k.num }}</span>
              <small v-if="k.sub">{{ k.sub }}</small>
            </button>
          </div>

          <div class="dial-actions">
            <button
              class="btn-dial"
              title="Bắt đầu gọi"
              :disabled="isCalling || isDialing"
              @click="handleDial"
            >
              <svg
                class="dial-svg-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z"
                />
              </svg>
            </button>
            <button
              class="btn-clear"
              :class="{ visible: Boolean(extension) }"
              title="Xóa một số"
              aria-label="Xóa ký tự cuối"
              :disabled="!extension"
              @click="clearDigit"
            >
              <svg
                class="clear-svg-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.5-7.5H21a1 1 0 011 1v13a1 1 0 01-1 1H9.5L3 12z"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <!-- CỘT 2: TRẠNG THÁI CUỘC GỌI (CALL STATUS - COLLAPSIBLE) -->
      <section class="status-col" :class="{ 'is-active-call': isCalling, 'is-idle': !isCalling }">
        <div
          class="call-status-box"
          :class="{
            inCall: isCalling,
            onHold: isHeld,
            isRinging: callState === 'ringing',
            compactIdle: !isCalling,
          }"
        >
          <!-- Giao diện khi Rảnh (Idle) trên màn hình Tablet / Laptop nhỏ -->
          <div v-if="!isCalling" class="idle-collapsed-bar">
            <div class="idle-sip-badge">
              <span class="sip-dot" :class="isSipOnline ? 'online' : 'offline'"></span>
              <span class="sip-text">{{ extension ? `Đang nhập số: ${extension}` : 'Cuộc Gọi Thoại Nội Bộ' }}</span>
            </div>
            <div class="idle-note">
              {{ extension ? (matchedDialContact ? matchedDialContact.name : 'Số nội bộ') : 'Sẵn sàng gọi thoại' }}
            </div>
          </div>

          <!-- Giao diện Đầy đủ khi Đang Gọi hoặc trên Desktop -->
          <div class="status-full-content" :class="{ 'hide-on-tablet-idle': !isCalling }">
            <!-- 1. Trạng thái Đang Gọi (Active Call / Ringing / Talking) -->
            <template v-if="isCalling">
              <div
                class="call-avatar"
                :class="{ 
                  pulsing: isCalling, 
                  ringingPulse: callState === 'ringing',
                  groupCallAvatar: isGroupCall
                }"
                :style="{ backgroundColor: activeCallAvatarBg }"
              >
                <span>{{ activeCallAvatarText }}</span>
              </div>

              <div class="caller-details">
                <div v-if="isGroupCall" class="group-call-badge-tag">
                  👥 Cuộc gọi nhóm Ad-hoc
                </div>
                <h2 class="caller-title">{{ activeCallTitle }}</h2>
                <div v-if="activeCallDept" class="caller-dept-badge">{{ activeCallDept }}</div>
                <p class="duration-text" :class="{ ringingText: callState === 'ringing' }">
                  {{ durationText }}
                </p>
                <div v-if="isGroupCall && groupMembersSummary" class="group-members-summary-text">
                  Thành viên: {{ groupMembersSummary }}
                </div>
                <p v-if="dtmfLog" class="dtmf-display">Phím số: {{ dtmfLog }}</p>
                <div v-if="isRecording" class="recording-indicator-tag">
                  <span class="rec-pulse-dot">●</span> {{ formattedRecordingDuration }} Đang ghi âm
                </div>
              </div>
            </template>

            <!-- 2. Trạng thái Đang Gõ Số Máy Lẻ (Dialing extension) -->
            <template v-else-if="extension">
              <div
                class="call-avatar"
                :style="{ backgroundColor: dialAvatarBg }"
              >
                <span>{{ dialAvatarText }}</span>
              </div>

              <div class="caller-details">
                <h2 class="caller-title">{{ dialTitle }}</h2>
                <div v-if="matchedDialContact?.dept" class="caller-dept-badge">
                  {{ matchedDialContact.dept }}
                </div>
                <div v-if="matchedDialContact" class="dialer-status-row">
                  <span class="status-dot-inline" :class="matchedDialContact.status || 'offline'"></span>
                  <span class="status-label-text">{{ matchedDialContact.statusLabel || 'Ngoại tuyến' }}</span>
                  <span class="status-sep">•</span>
                  <span class="status-ext-text">Máy lẻ: {{ extension }}</span>
                </div>
                <p v-else class="idle-unknown-note">Số nội bộ chưa có trong danh bạ</p>
              </div>
            </template>

            <!-- 3. Trạng thái Bàn Phím Trống (Idle) -->
            <template v-else>
              <div class="call-avatar idle-avatar">
                <span>📞</span>
              </div>

              <div class="caller-details">
                <h2 class="caller-title">Cuộc Gọi Thoại Nội Bộ</h2>
                <p class="idle-guide-text">Bấm phím số bên dưới hoặc chọn nhanh từ danh bạ bên phải</p>
              </div>
            </template>

            <!-- Hàng nút điều khiển cuộc gọi (chỉ hiển thị khi đang có cuộc gọi hoạt động) -->
            <div v-if="isCalling" class="controls-row">
              <!-- Nút Tắt/Bật Micro (Mute) -->
              <button
                class="control-btn"
                :class="{ active: isMuted, muted: isMuted }"
                :disabled="!isCalling"
                :title="isMuted ? 'Bật lại Micro' : 'Tắt Micro (Mute)'"
                @click="toggleMute"
              >
                <svg
                  v-if="!isMuted"
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z"
                  />
                </svg>
                <svg
                  v-else
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17 16.95A7 7 0 015 11m12 0a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8"
                  />
                </svg>
              </button>

              <!-- Nút Giữ máy (Hold) -->
              <button
                class="control-btn"
                :class="{ active: isHeld }"
                :disabled="!isCalling"
                :title="isHeld ? 'Tiếp tục cuộc gọi' : 'Giữ cuộc gọi (Hold)'"
                @click="toggleHold"
              >
                <svg
                  v-if="!isHeld"
                  class="ctrl-svg-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <svg v-else class="ctrl-svg-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>

              <!-- Nút Ghi âm (Record trên tổng đài) -->
              <button
                class="control-btn btn-record"
                :class="{ active: isRecording, recording: isRecording }"
                :disabled="!isCalling || callState === 'ringing'"
                :title="isRecording ? 'Dừng ghi âm cuộc gọi trên tổng đài (bấm vào để dừng ghi âm)' : (callState === 'ringing' ? 'Chờ đối phương nhấc máy để bắt đầu ghi âm' : 'Bắt đầu ghi âm cuộc gọi trên tổng đài')"
                @click="toggleRecord"
              >
                <span v-if="isRecording" class="rec-dot-pulse">●</span>
                <span v-if="isRecording" class="rec-label">{{ formattedRecordingDuration }} Đang ghi âm</span>
                <svg
                  v-else
                  class="ctrl-svg-icon rec-svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="5" fill="#ef4444" stroke="#ef4444" />
                  <circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="2" />
                </svg>
              </button>

              <!-- Nút Cúp máy (Hangup) -->
              <button
                class="control-btn btn-hangup"
                :disabled="!isCalling"
                title="Ngắt kết nối / Cúp máy"
                @click="hangupCall"
              >
                <svg class="ctrl-svg-icon hangup-svg" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.28 8.82 7.42 7 12 7s8.72 1.82 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- CỘT 3: DANH BẠ NHÂN VIÊN (CONTACTS PANEL) -->
      <section class="contacts-col">
        <div class="contacts-panel-card">
          <!-- Panel Header: Search Box & Nút Làm mới -->
          <div class="panel-header">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input
                v-model="searchTerm"
                placeholder="Tìm nhân viên, số máy lẻ..."
                aria-label="Tìm kiếm trong danh bạ"
                class="search-input"
              />
              <button
                v-if="searchTerm"
                class="btn-clear-search"
                title="Xóa tìm kiếm"
                aria-label="Xóa từ khóa tìm kiếm"
                @click="clearSearch"
              >
                ✖
              </button>
            </div>

            <button
              class="btn-refresh"
              :disabled="loadingContacts"
              title="Làm mới danh bạ từ máy chủ"
              aria-label="Làm mới danh bạ từ máy chủ"
              @click="refreshContacts"
            >
              <span :class="{ 'spin-icon': loadingContacts }">↻</span>
            </button>
          </div>

          <!-- Filter Tabs: Dynamic Slider + Cài đặt ⚙️ -->
          <div class="panel-tabs-bar">
            <!-- Nút cuộn trái khi > 5 tabs -->
            <button
              v-if="visibleTabs.length > 5 && canScrollLeft"
              class="btn-tabs-nav btn-tabs-left"
              @click="scrollTabs('left')"
              title="Trượt sang trái"
            >
              ‹
            </button>

            <!-- Container trượt hoặc chia đều -->
            <div
              ref="tabsSliderRef"
              class="panel-tabs-slider"
              :class="{
                'is-even-split': visibleTabs.length <= 5,
                'is-slider-mode': visibleTabs.length > 5,
              }"
              @wheel.passive="onTabsWheel"
              @scroll="checkScrollButtons"
            >
              <button
                v-for="tab in visibleTabs"
                :key="tab.id"
                class="panel-tab-btn"
                :class="{ active: activeTab === tab.id, [`tab-${tab.id}`]: true }"
                @click="activeTab = tab.id"
              >
                <span v-if="tab.id === 'all'" class="tab-icon">👥</span>
                <span v-else-if="tab.id === 'favorites'" class="tab-icon">⭐</span>
                <span v-else-if="tab.id === 'online'" class="tab-icon">🟢</span>
                <span v-else-if="tab.id === 'offline'" class="tab-icon">⚪</span>
                <svg
                  v-else-if="tab.id === 'department'"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="tab-svg-icon"
                >
                  <path d="M3 21h18"></path>
                  <path d="M5 21V7l8-4v18"></path>
                  <path d="M19 21V11l-6-4"></path>
                  <line x1="9" y1="9" x2="9.01"></line>
                  <line x1="9" y1="13" x2="9" y2="13.01"></line>
                  <line x1="9" y1="17" x2="9" y2="17.01"></line>
                </svg>
                <svg
                  v-else-if="tab.id === 'group_call'"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="tab-svg-icon"
                >
                  <path
                    d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                  ></path>
                </svg>

                <span class="tab-label">{{ tab.label }}</span>

                <span v-if="tab.id === 'all'" class="tab-badge">{{ contacts.length }}</span>
                <span v-else-if="tab.id === 'favorites'" class="tab-badge">{{ favoriteCount }}</span>
                <span v-else-if="tab.id === 'online'" class="tab-badge badge-online">{{ onlineCount }}</span>
                <span v-else-if="tab.id === 'offline'" class="tab-badge badge-offline">{{ offlineCount }}</span>
                <span v-else-if="tab.id === 'department'" class="tab-badge badge-dept">{{ departmentTabCount }}</span>
              </button>
            </div>

            <!-- Nút cuộn phải khi > 5 tabs -->
            <button
              v-if="visibleTabs.length > 5 && canScrollRight"
              class="btn-tabs-nav btn-tabs-right"
              @click="scrollTabs('right')"
              title="Trượt sang phải"
            >
              ›
            </button>

            <!-- Nút bánh răng Cài đặt hiển thị tab -->
            <button
              class="btn-tab-config"
              @click="showTabConfigModal = true"
              title="Tùy chỉnh danh mục hiển thị"
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
                <circle cx="12" cy="12" r="3"></circle>
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                ></path>
              </svg>
            </button>
          </div>

          <!-- Contact List Body -->
          <div class="panel-list-container">
            <!-- Thanh chọn Bộ phận / Phòng ban khi ở Tab Bộ phận -->
            <div v-if="activeTab === 'department'" class="dept-selector-bar">
              <div class="dept-bar-header">
                <div class="dept-bar-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                  </svg>
                  <span>Lọc theo bộ phận:</span>
                </div>
                <span class="dept-current-badge">{{ selectedDepartment === 'all' ? 'Tất cả bộ phận' : selectedDepartment }}</span>
              </div>
              <div class="dept-chips-scroll">
                <button
                  class="dept-chip-btn"
                  :class="{ active: selectedDepartment === 'all' }"
                  @click="selectedDepartment = 'all'"
                >
                  <span>Tất cả</span>
                  <small class="dept-chip-count">({{ contacts.length }})</small>
                </button>
                <button
                  v-for="dept in availableDepartments"
                  :key="dept"
                  class="dept-chip-btn"
                  :class="{ active: selectedDepartment === dept }"
                  @click="selectedDepartment = dept"
                >
                  <span>{{ dept }}</span>
                  <small class="dept-chip-count">({{ getDepartmentCount(dept) }})</small>
                </button>
                <div v-if="availableDepartments.length === 0" class="dept-empty-hint">
                  (Chưa có nhân viên nào được gán phòng ban)
                </div>
              </div>
            </div>

            <!-- Sticky Action Bar khi ở Tab Gọi nhóm -->
            <div v-if="activeTab === 'group_call'" class="group-call-selection-bar">
              <div class="selection-info">
                <span class="selection-pill">
                  Đã chọn: <strong>{{ selectedGroupExtensions.length }}</strong> người
                </span>
                <div class="action-buttons-group">
                  <button
                    class="btn-action-pill btn-select-online"
                    @click="selectAllOnlineContacts"
                    title="Chọn nhanh tất cả người đang trực tuyến"
                  >
                    <span class="pill-dot online"></span>
                    <span>Chọn trực tuyến</span>
                  </button>
                  <button
                    v-if="selectedGroupExtensions.length > 0"
                    class="btn-action-pill btn-deselect-group"
                    @click="clearGroupSelection"
                    title="Bỏ chọn tất cả"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Bỏ chọn</span>
                  </button>
                </div>
              </div>
              <button
                class="btn-start-group"
                :disabled="selectedGroupExtensions.length < 2 || isCalling || isDialing"
                @click="handleStartGroupCallFromContacts"
                title="Bắt đầu cuộc gọi nhóm tới các thành viên đã chọn"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
                <span>Gọi nhóm {{ selectedGroupExtensions.length >= 2 ? `(${selectedGroupExtensions.length})` : '' }}</span>
              </button>
            </div>

            <!-- Loading State -->
            <div v-if="loadingContacts && contacts.length === 0" class="panel-state-message">
              <div class="spinner"></div>
              <p>Đang nạp danh bạ từ máy chủ...</p>
            </div>

            <!-- Empty State -->
            <div v-else-if="filteredContacts.length === 0" class="panel-state-message empty">
              <p v-if="activeTab === 'favorites'">
                Chưa có liên hệ nào trong mục Yêu thích. Hãy bấm biểu tượng ⭐ trên thẻ nhân viên để
                ghim nhanh.
              </p>
              <p v-else-if="activeTab === 'online'">
                Hiện chưa có nhân viên nào đang trực tuyến.
              </p>
              <p v-else-if="activeTab === 'offline'">
                Hiện chưa có nhân viên nào đang ngoại tuyến.
              </p>
              <p v-else-if="activeTab === 'department'">
                Chưa có nhân viên nào thuộc bộ phận {{ selectedDepartment === 'all' ? 'này' : `"${selectedDepartment}"` }}.
              </p>
              <p v-else-if="activeTab === 'group_call'">
                Chưa có liên hệ nào khả dụng để gọi nhóm.
              </p>
              <p v-else-if="searchTerm">
                Không tìm thấy nhân viên nào phù hợp với "{{ searchTerm }}".
              </p>
              <p v-else>Chưa có liên hệ nào trong danh bạ hệ thống.</p>
            </div>

            <!-- Contacts Cards List -->
            <div v-else class="contacts-items-list">
              <div
                v-for="c in filteredContacts"
                :key="c.id"
                class="contact-item-card"
                :class="{ 
                  favorite: c.isFavorite,
                  'group-selectable': activeTab === 'group_call',
                  'group-selected': activeTab === 'group_call' && isContactSelectedForGroup(c)
                }"
                @click="activeTab === 'group_call' ? toggleGroupContactSelection(c) : null"
              >
                <!-- Checkbox khi ở tab Gọi nhóm -->
                <div
                  v-if="activeTab === 'group_call'"
                  class="group-select-checkbox-wrap"
                  @click.stop="toggleGroupContactSelection(c)"
                >
                  <div
                    class="custom-check-box"
                    :class="{ checked: isContactSelectedForGroup(c), disabled: isSelf(c) }"
                  >
                    <svg
                      v-if="isContactSelectedForGroup(c)"
                      class="check-svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                </div>
                <!-- Ghim yêu thích ⭐ khi ở các tab thông thường -->
                <button
                  v-else
                  class="btn-star"
                  :class="{ active: c.isFavorite }"
                  :title="c.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
                  :aria-label="c.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
                  @click.stop="toggleFavorite(c)"
                >
                  {{ c.isFavorite ? '⭐' : '☆' }}
                </button>

                <!-- Avatar tròn chữ cái -->
                <div class="avatar-wrap">
                  <div class="contact-avatar" :style="{ backgroundColor: getAvatarColor(c.name) }">
                    {{ getInitials(c.name) }}
                  </div>
                </div>

                <!-- Thông tin nhân viên (Chấm màu đặt ngay trước Tên nhân viên) -->
                <div class="contact-meta">
                  <div class="meta-row-top">
                    <div class="name-status-group">
                      <span
                        class="status-dot-inline"
                        :class="`dot-${c.status || 'offline'}`"
                        :title="`${c.name}: ${c.statusLabel || 'Ngoại tuyến'}`"
                      ></span>
                      <strong class="contact-name" :title="c.name">
                        {{ c.name }}
                        <span
                          v-if="c.number && String(c.number).trim() === String(callStore.myExtension || '1001').trim()"
                          class="self-badge"
                        >(Bạn)</span>
                        <span
                          v-if="c.isMobileApp && c.status !== 'offline' && c.status !== 'unavailable'"
                          class="mobile-phone-badge"
                          title="Đang trực tuyến bằng ứng dụng di động"
                        >
                          <svg
                            class="phone-svg-icon"
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                            <line x1="12" y1="18" x2="12.01" y2="18"></line>
                          </svg>
                        </span>
                      </strong>
                    </div>
                  </div>
                  <div class="meta-row-sub">
                    <span class="ext-badge">Máy lẻ {{ c.number || '---' }}</span>
                    <span v-if="c.dept" class="dept-text" :title="c.dept">• {{ c.dept }}</span>
                  </div>
                </div>

                <!-- Thao tác / Chỉ báo: Trong tab Gọi nhóm hiển thị nhãn đã chọn / trạng thái; ở tab thường hiển thị nút Gọi & Nhắn tin -->
                <div v-if="activeTab === 'group_call'" class="group-select-indicator">
                  <span
                    v-if="isContactSelectedForGroup(c)"
                    class="badge-group-selected"
                  >
                    ✓ Đã chọn
                  </span>
                  <span
                    v-else
                    class="badge-status-pill"
                    :class="c.status || 'offline'"
                  >
                    {{ c.statusLabel || 'Ngoại tuyến' }}
                  </span>
                </div>

                <!-- Nút thao tác nhanh khi ở các tab 1-1: Gọi thoại & Nhắn tin -->
                <div v-else class="contact-actions">
                  <button
                    class="btn-action-icon call"
                    :title="!c.number || !c.number.trim() ? 'Chưa có số máy lẻ' : (isCalling || isDialing ? 'Đang bận cuộc gọi' : `Gọi máy lẻ ${c.number}`)"
                    :aria-label="`Gọi cho ${c.name}`"
                    :disabled="isCalling || isDialing || !c.number || !c.number.trim()"
                    @click.stop="handleCallFromPanel(c)"
                  >
                    <svg
                      class="action-svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                      />
                    </svg>
                  </button>
                  <button
                    class="btn-action-icon chat"
                    :title="`Nhắn tin với ${c.name}`"
                    :aria-label="`Nhắn tin cho ${c.name}`"
                    @click.stop="handleMessage(c)"
                  >
                    <svg
                      class="action-svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                      />
                    </svg>
                    <span v-if="c.unreadCount > 0" class="badge-unread">{{ c.unreadCount }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Modal Tùy chỉnh danh mục hiển thị (Category Tabs Config Modal) -->
    <div
      v-if="showTabConfigModal"
      class="tab-config-overlay"
      @click.self="showTabConfigModal = false"
    >
      <div class="tab-config-card">
        <div class="tab-config-header">
          <div class="tab-config-title">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2563eb"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3"></circle>
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
              ></path>
            </svg>
            <span>Tùy chỉnh danh mục danh bạ</span>
          </div>
          <button
            class="tab-config-close"
            @click="showTabConfigModal = false"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <div class="tab-config-body">
          <p class="tab-config-desc">
            Chọn các danh mục muốn hiển thị trên thanh tab. Nếu chọn từ 5 danh mục trở xuống, các tab sẽ tự động căn đều theo tỷ lệ đẹp mắt; nếu chọn trên 5 danh mục, thanh trượt sẽ được kích hoạt để cuộn mượt mà.
          </p>

          <div class="tab-config-list">
            <div
              v-for="tab in AVAILABLE_CATEGORY_TABS"
              :key="tab.id"
              class="tab-config-item"
              :class="{
                selected: isTabVisible(tab.id),
                disabled: tab.required,
              }"
              @click="toggleTabVisibility(tab.id)"
            >
              <div class="tab-config-item-left">
                <input
                  type="checkbox"
                  :checked="isTabVisible(tab.id)"
                  :disabled="tab.required"
                  class="tab-config-checkbox"
                  @click.stop="toggleTabVisibility(tab.id)"
                />
                <span v-if="tab.id === 'all'" class="tab-config-icon">👥</span>
                <span v-else-if="tab.id === 'favorites'" class="tab-config-icon">⭐</span>
                <span v-else-if="tab.id === 'online'" class="tab-config-icon">🟢</span>
                <span v-else-if="tab.id === 'offline'" class="tab-config-icon">⚪</span>
                <svg
                  v-else-if="tab.id === 'department'"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 21h18"></path>
                  <path d="M5 21V7l8-4v18"></path>
                  <path d="M19 21V11l-6-4"></path>
                  <line x1="9" y1="9" x2="9.01"></line>
                  <line x1="9" y1="13" x2="9" y2="13.01"></line>
                  <line x1="9" y1="17" x2="9" y2="17.01"></line>
                </svg>
                <svg
                  v-else-if="tab.id === 'group_call'"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                  ></path>
                </svg>
                <span class="tab-config-item-label">{{ tab.label }}</span>
                <span v-if="tab.required" class="tab-config-item-badge">Bắt buộc</span>
              </div>
              <span
                v-if="getTabPreviewCount(tab.id) !== null"
                class="tab-config-item-count"
              >
                {{ getTabPreviewCount(tab.id) }} mục
              </span>
            </div>
          </div>
        </div>

        <div class="tab-config-footer">
          <button class="btn-tab-config-reset" @click="resetTabVisibility">
            Khôi phục mặc định
          </button>
          <button class="btn-tab-config-done" @click="showTabConfigModal = false">
            Hoàn tất ({{ visibleTabIds.length }} mục)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { wazoService, callStore } from '@/services/wazo'
import { audioService } from '@/services/audioService'
import { contactService } from '@/services/contactService'
import { logger } from '@/services/loggerService'
import { recordService, recordStore } from '@/services/recordService'

const route = useRoute()
const router = useRouter()

// Dialer & Call State
const extension = ref('')
const dtmfLog = ref('')
const mobileTab = ref('dialer') // 'dialer' | 'contacts'

// Contacts Panel State
const searchTerm = ref('')
const contacts = ref([])
const loadingContacts = ref(false)
const activeTab = ref('all') // 'all' | 'favorites'

// Single Source of Truth (SSOT) binding trực tiếp từ callStore
const isCalling = computed(() => Boolean(callStore.activeCall))
const callState = computed(() => (callStore.activeCall ? callStore.activeCall.status : 'idle'))
const isHeld = computed(() => Boolean(callStore.activeCall?.isHeld))
const isMuted = computed(() => Boolean(callStore.activeCall?.isMuted))
const isDialing = computed(() => Boolean(wazoService._isDialing))

const isRecording = computed(() => recordStore.isRecording)
const recordingDuration = computed(() => recordStore.duration)
const formattedRecordingDuration = computed(() => {
  const s = recordStore.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
})

const keys = [
  { num: '1', sub: '' },
  { num: '2', sub: 'ABC' },
  { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' },
  { num: '5', sub: 'JKL' },
  { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' },
  { num: '8', sub: 'TUV' },
  { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' },
  { num: '0', sub: '+' },
  { num: '#', sub: '' },
]

const isSipOnline = computed(
  () =>
    callStore.isRegistered ||
    (Boolean(localStorage.getItem('smartcall_wazo_token')) && localStorage.getItem('smartcall_offline_mode') !== 'true'),
)

const matchedDialContact = computed(() => {
  const ext = extension.value.trim()
  if (!ext) return null
  return (
    contacts.value.find((c) => String(c.number || '').trim() === ext) ||
    contactService.findContactByExtension(ext) ||
    null
  )
})

const activeCallContact = computed(() => {
  const num = callStore.activeCall?.number || ''
  if (!num) return null
  return (
    contacts.value.find((c) => String(c.number || '').trim() === String(num).trim()) ||
    contactService.findContactByExtension(num) ||
    null
  )
})

const isGroupCall = computed(() => Boolean(callStore.activeCall?.isGroupCall || wazoService.isGroupCall))

const groupMembersSummary = computed(() => {
  const exts = callStore.activeCall?.groupParticipantExtensions || wazoService.groupParticipantExtensions || []
  if (!exts || exts.length === 0) return ''
  const myExt = callStore.myExtension || localStorage.getItem('smartcall_extension') || ''
  const names = exts.map((ext) => {
    if (ext === myExt) return 'Bạn'
    const c = contacts.value.find((ct) => String(ct.number || '').trim() === String(ext).trim()) || contactService.findContactByExtension(ext)
    return c?.name ? `${c.name} (${ext})` : `Máy lẻ ${ext}`
  })
  return names.join(', ')
})

const activeCallTitle = computed(() => {
  if (!callStore.activeCall) return ''
  if (isGroupCall.value) {
    const count = (callStore.activeCall.groupParticipantExtensions || wazoService.groupParticipantExtensions || []).length
    return callStore.activeCall.groupTitle || `Cuộc gọi nhóm (${count > 0 ? count : 3} người)`
  }
  const ext = callStore.activeCall.number || extension.value
  if (callStore.activeCall.status === 'ringing') {
    return `Đang đổ chuông: ${callStore.activeCall.name || activeCallContact.value?.name || `Máy lẻ ${ext}`}`
  }
  if (callStore.activeCall.isHeld) {
    return `${callStore.activeCall.name || activeCallContact.value?.name || `Máy lẻ ${ext}`} (Tạm giữ)`
  }
  return callStore.activeCall.name || activeCallContact.value?.name || `Máy lẻ ${ext}`
})

const activeCallDept = computed(() => {
  return callStore.activeCall?.dept || activeCallContact.value?.dept || ''
})

const activeCallAvatarText = computed(() => {
  if (isGroupCall.value) return '👥'
  const name = callStore.activeCall?.name || activeCallContact.value?.name
  if (name) return getInitials(name)
  if (callStore.activeCall?.number) return callStore.activeCall.number.slice(-2)
  return '📞'
})

const activeCallAvatarBg = computed(() => {
  if (isGroupCall.value) return '#059669'
  const name = callStore.activeCall?.name || activeCallContact.value?.name
  if (name) return getAvatarColor(name)
  return '#2563eb'
})

const dialTitle = computed(() => {
  if (matchedDialContact.value) {
    return matchedDialContact.value.name
  }
  return `Máy lẻ ${extension.value}`
})

const dialAvatarText = computed(() => {
  if (matchedDialContact.value) {
    return getInitials(matchedDialContact.value.name)
  }
  return '📞'
})

const dialAvatarBg = computed(() => {
  if (matchedDialContact.value) {
    return getAvatarColor(matchedDialContact.value.name)
  }
  return '#334155'
})

const callerName = computed(() => {
  if (!callStore.activeCall) return 'Cuộc Gọi Thoại Nội Bộ'
  const ext = callStore.activeCall.number || extension.value
  if (callStore.activeCall.status === 'ringing') {
    return `Đang đổ chuông tới máy lẻ ${ext}...`
  }
  if (callStore.activeCall.isHeld) {
    return `Máy lẻ ${ext} (Tạm giữ - Hold)`
  }
  return `Đang đàm thoại: ${callStore.activeCall.name || `Máy lẻ ${ext}`}`
})

const callerSip = computed(() => {
  const host = (wazoService.host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
  if (callStore.activeCall) return `sip:${callStore.activeCall.number}@${host || 'smartcall'}`
  const myExt = callStore.myExtension || wazoService.getMyExtension() || '1001'
  return `Máy lẻ ${myExt}`
})

const callAvatarInitials = computed(() => {
  if (callStore.activeCall?.number) return callStore.activeCall.number.slice(-2)
  if (extension.value) return extension.value.slice(-2)
  return '📞'
})

const formattedDuration = computed(() => {
  const s = callStore.activeCall?.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
})

const durationText = computed(() => {
  if (!callStore.activeCall) return '00:00'
  if (callStore.activeCall.status === 'ringing') return '📞 Đang đổ chuông...'
  return formattedDuration.value
})

const favoriteCount = computed(() => {
  return contacts.value.filter((c) => c.isFavorite).length
})

const onlineCount = computed(() => {
  return contacts.value.filter((c) => c.status !== 'offline' && c.status !== 'unavailable').length
})

const offlineCount = computed(() => {
  return contacts.value.filter((c) => c.status === 'offline' || c.status === 'unavailable').length
})

// Quản lý lọc theo Bộ phận / Phòng ban (Tab 5)
const selectedDepartment = ref('all')

const availableDepartments = computed(() => {
  const depts = new Set()
  contacts.value.forEach((c) => {
    const d = (c.dept || '').trim()
    if (d) depts.add(d)
  })
  return Array.from(depts).sort((a, b) => a.localeCompare(b, 'vi'))
})

const getDepartmentCount = (dept) => {
  if (!dept || dept === 'all') return contacts.value.length
  return contacts.value.filter((c) => (c.dept || '').trim().toLowerCase() === dept.trim().toLowerCase()).length
}

const departmentTabCount = computed(() => {
  if (selectedDepartment.value === 'all') {
    return contacts.value.filter((c) => Boolean((c.dept || '').trim())).length || contacts.value.length
  }
  return getDepartmentCount(selectedDepartment.value)
})

// --- CẤU HÌNH & THANH TRƯỢT DANH MỤC (CATEGORY TABS CONFIG & SLIDER) ---
const AVAILABLE_CATEGORY_TABS = [
  { id: 'all', label: 'Tất cả', icon: 'all', required: true },
  { id: 'favorites', label: 'Yêu thích', icon: 'favorites' },
  { id: 'online', label: 'Trực tuyến', icon: 'online' },
  { id: 'offline', label: 'Ngoại tuyến', icon: 'offline' },
  { id: 'department', label: 'Bộ phận', icon: 'department' },
  { id: 'group_call', label: 'Gọi nhóm', icon: 'group_call' },
]

const DEFAULT_VISIBLE_TAB_IDS = ['all', 'favorites', 'online', 'offline', 'department', 'group_call']

const loadSavedVisibleTabs = () => {
  try {
    const saved = localStorage.getItem('smartcall_visible_tabs')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (!parsed.includes('all')) parsed.unshift('all')
        return parsed
      }
    }
  } catch (e) {
    console.warn('Lỗi đọc visible tabs:', e)
  }
  return [...DEFAULT_VISIBLE_TAB_IDS]
}

const visibleTabIds = ref(loadSavedVisibleTabs())
const showTabConfigModal = ref(false)
const tabsSliderRef = ref(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

const visibleTabs = computed(() => {
  return AVAILABLE_CATEGORY_TABS.filter((t) => visibleTabIds.value.includes(t.id))
})

const isTabVisible = (id) => visibleTabIds.value.includes(id)

const toggleTabVisibility = (id) => {
  if (id === 'all') return
  const idx = visibleTabIds.value.indexOf(id)
  if (idx > -1) {
    if (visibleTabIds.value.length <= 2) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '⚠️ Cần giữ lại ít nhất 2 danh mục hiển thị!', type: 'warning' },
        }),
      )
      return
    }
    visibleTabIds.value.splice(idx, 1)
    if (activeTab.value === id) {
      activeTab.value = 'all'
    }
  } else {
    const newIds = AVAILABLE_CATEGORY_TABS
      .map((t) => t.id)
      .filter((tid) => visibleTabIds.value.includes(tid) || tid === id)
    visibleTabIds.value = newIds
  }
  localStorage.setItem('smartcall_visible_tabs', JSON.stringify(visibleTabIds.value))
  nextTick(() => checkScrollButtons())
}

const resetTabVisibility = () => {
  visibleTabIds.value = [...DEFAULT_VISIBLE_TAB_IDS]
  localStorage.setItem('smartcall_visible_tabs', JSON.stringify(visibleTabIds.value))
  nextTick(() => checkScrollButtons())
}

const getTabPreviewCount = (id) => {
  if (id === 'all') return contacts.value.length
  if (id === 'favorites') return favoriteCount.value
  if (id === 'online') return onlineCount.value
  if (id === 'offline') return offlineCount.value
  if (id === 'department') return departmentTabCount.value
  return null
}

const checkScrollButtons = () => {
  const el = tabsSliderRef.value
  if (!el) {
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  canScrollLeft.value = el.scrollLeft > 5
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 5
}

const scrollTabs = (direction) => {
  const el = tabsSliderRef.value
  if (!el) return
  const step = 140
  el.scrollBy({ left: direction === 'left' ? -step : step, behavior: 'smooth' })
  setTimeout(() => checkScrollButtons(), 300)
}

const onTabsWheel = (e) => {
  const el = tabsSliderRef.value
  if (!el) return
  if (e.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
    el.scrollLeft += e.deltaY * 0.7
    checkScrollButtons()
  }
}

watch(visibleTabs, () => {
  nextTick(() => checkScrollButtons())
})

// Chuẩn hóa xóa dấu Tiếng Việt phục vụ tìm kiếm chính xác
const removeVietnameseTones = (str) => {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

// Quản lý chọn nhân viên cho Gọi nhóm (Tab 5)
const selectedGroupExtensions = ref([])

const isContactSelectedForGroup = (c) => {
  const ext = String(c?.number || '').trim()
  return Boolean(ext && selectedGroupExtensions.value.includes(ext))
}

const isSelf = (c) => {
  const myExt = String(callStore.myExtension || localStorage.getItem('smartcall_extension') || '').trim()
  return Boolean(myExt && String(c?.number || '').trim() === myExt)
}

const toggleGroupContactSelection = (c) => {
  if (isSelf(c)) return
  const ext = String(c?.number || '').trim()
  if (!ext) return
  const idx = selectedGroupExtensions.value.indexOf(ext)
  if (idx > -1) {
    selectedGroupExtensions.value.splice(idx, 1)
  } else {
    selectedGroupExtensions.value.push(ext)
  }
}

const clearGroupSelection = () => {
  selectedGroupExtensions.value = []
}

const selectAllOnlineContacts = () => {
  const myExt = String(callStore.myExtension || localStorage.getItem('smartcall_extension') || '').trim()
  const onlineExts = contacts.value
    .filter((c) => c.status !== 'offline' && c.status !== 'unavailable' && String(c.number || '').trim() !== myExt)
    .map((c) => String(c.number || '').trim())
    .filter(Boolean)
  selectedGroupExtensions.value = [...new Set([...selectedGroupExtensions.value, ...onlineExts])]
}

const handleStartGroupCallFromContacts = async () => {
  if (selectedGroupExtensions.value.length < 2) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: '⚠️ Vui lòng chọn ít nhất 2 thành viên để bắt đầu cuộc gọi nhóm!',
          type: 'warning',
        },
      }),
    )
    return
  }

  if (isCalling.value || isDialing.value) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động. Vui lòng kết thúc trước khi gọi nhóm!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // Chuyển sang màn hình dialer trên mobile
  mobileTab.value = 'dialer'

  const extsToCall = [...selectedGroupExtensions.value]
  logger.info('CALL', `Khởi tạo cuộc gọi nhóm từ Danh bạ tới ${extsToCall.length} người: ${extsToCall.join(', ')}`)

  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: `👥 Đang khởi tạo cuộc gọi nhóm (${extsToCall.length + 1} người)...`,
        type: 'info',
      },
    }),
  )

  await wazoService.startGroupCall(extsToCall, {
    groupTitle: `Cuộc gọi nhóm (${extsToCall.length + 1} người)`,
  })
}

// Danh sách danh bạ được lọc
const filteredContacts = computed(() => {
  let list = contacts.value
  if (activeTab.value === 'favorites') {
    list = list.filter((c) => c.isFavorite)
  } else if (activeTab.value === 'online') {
    list = list.filter((c) => c.status !== 'offline' && c.status !== 'unavailable')
  } else if (activeTab.value === 'offline') {
    list = list.filter((c) => c.status === 'offline' || c.status === 'unavailable')
  } else if (activeTab.value === 'department') {
    if (selectedDepartment.value !== 'all') {
      const targetDept = selectedDepartment.value.trim().toLowerCase()
      list = list.filter((c) => (c.dept || '').trim().toLowerCase() === targetDept)
    }
  } else if (activeTab.value === 'group_call') {
    // Ẩn chính mình khỏi danh sách chọn gọi nhóm
    const myExt = String(callStore.myExtension || localStorage.getItem('smartcall_extension') || '').trim()
    list = list.filter((c) => String(c.number || '').trim() !== myExt)
  }
  const q = searchTerm.value.trim()
  if (!q) return list
  const cleanQ = removeVietnameseTones(q)
  return list.filter((c) => {
    const nameNorm = removeVietnameseTones(c.name || '')
    const deptNorm = removeVietnameseTones(c.dept || '')
    const numNorm = String(c.number || '').toLowerCase()
    return nameNorm.includes(cleanQ) || deptNorm.includes(cleanQ) || numNorm.includes(cleanQ)
  })
})

const pressKey = (key) => {
  audioService.playDtmfTone(key)
  if (!callStore.activeCall) {
    if (extension.value.length < 8) {
      extension.value += key
      logger.info('UI', `Bấm phím [${key}] trên bàn phím số (Số hiện tại: ${extension.value})`)
    }
  } else {
    dtmfLog.value += key
    wazoService.sendDTMF(key)
    logger.info(
      'CALL',
      `Phát tín hiệu DTMF [${key}] trong cuộc gọi tới máy lẻ: ${callStore.activeCall.number}`,
    )
  }
}

const clearDigit = () => {
  if (!callStore.activeCall) {
    extension.value = extension.value.slice(0, -1)
  }
}

// Xóa từ khóa tìm kiếm và dọn sạch query URL q
const clearSearch = () => {
  searchTerm.value = ''
  if (route.query && route.query.q) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.q
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

// Bấm gọi từ bàn phím số (Handle Dialpad)
const handleDial = async () => {
  const ext = extension.value.trim()
  if (!ext) return

  if (wazoService.hasActiveCall() || callStore.activeCall) {
    cleanCallQueryParams()
    return
  }

  // Kiểm tra trạng thái máy lẻ trong danh bạ hệ thống (Rule 3.1 & 3.3 GEMINI.md)
  let target =
    contacts.value.find((c) => String(c.number || '').trim() === ext) ||
    contactService.findContactByExtension(ext)

  // Tra cứu an toàn Stale-While-Revalidate nếu chưa thấy trong danh bạ hiện tại (tránh lỗi gọi lại từ Lịch sử)
  if (!target) {
    target = await contactService.getOrLookupContact(ext)
    if (target && !contacts.value.some((c) => c.id === target.id)) {
      contacts.value.push(target)
    }
  }

  // Nếu số máy lẻ không tồn tại trong danh bạ
  if (!target) {
    cleanCallQueryParams()
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Số máy lẻ [${ext}] không tồn tại trong danh bạ hệ thống!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  if (target) {
    if (target.status === 'busy' || target.status === 'talking' || target.status === 'holding') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🚫 [${target.name || ext}] hiện đang trong cuộc gọi khác (Máy bận)!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'ringing') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🔔 [${target.name || ext}] hiện đang nhận một cuộc gọi khác!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'dnd') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `🔕 [${target.name || ext}] đang bật chế độ Không làm phiền (DND)!`,
            type: 'warning',
          },
        }),
      )
      return
    }
    if (target.status === 'offline' || target.status === 'unavailable') {
      cleanCallQueryParams()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '📴 Người này hiện đang ngoại tuyến, xin vui lòng gọi lại lúc khác!',
            type: 'warning',
          },
        }),
      )
      return
    }
  }

  try {
    const res = await wazoService.validateAndMakeCall(ext, {
      name: target?.name || route.query?.name,
      dept: target?.dept || route.query?.dept,
    })
    if (res && res.success) {
      extension.value = ''
      cleanCallQueryParams()
    } else {
      cleanCallQueryParams()
    }
  } catch (err) {
    cleanCallQueryParams()
  }
}

// Bấm nút Gọi thoại trực tiếp từ Danh bạ (Rule 3.1 & 3.2 GEMINI.md)
const handleCallFromPanel = async (contact) => {
  if (!contact || !contact.number) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Liên hệ [${contact?.name || 'này'}] chưa có số máy lẻ để thực hiện cuộc gọi!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  if (wazoService._isDialing || wazoService.hasActiveCall() || callStore.activeCall) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message:
            '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động hoặc đang kết nối. Vui lòng thử lại sau!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // 1. Máy bận
  if (contact.status === 'busy' || contact.status === 'talking' || contact.status === 'holding') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🚫 [${contact.name}] hiện đang trong cuộc gọi khác (Máy bận). Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 2. Đang đổ chuông
  if (contact.status === 'ringing') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔔 [${contact.name}] hiện đang nhận một cuộc gọi khác. Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 3. Không làm phiền (DND)
  if (contact.status === 'dnd') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔕 [${contact.name}] đang bật chế độ Không làm phiền (DND). Vui lòng liên hệ sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // 4. Ngoại tuyến -> Hộp thoại chuyển sang nhắn tin (Rule 3.2 GEMINI.md)
  if (contact.status === 'offline' || contact.status === 'unavailable') {
    const confirmMsg = confirm(
      `Máy lẻ [${contact.name} - ${contact.number}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMsg) {
      handleMessage(contact)
    }
    return
  }

  // 5. Khả dụng -> Thiết lập số, chuyển tab di động sang dialer và gọi trực tiếp
  const cleanExt = String(contact.number || '').trim()
  extension.value = cleanExt
  mobileTab.value = 'dialer'
  await wazoService.validateAndMakeCall(cleanExt, {
    name: contact.name,
    dept: contact.dept,
  })
}

// Chuyển sang màn hình Tin nhắn
const handleMessage = (contact) => {
  contact.unreadCount = 0
  const ext = contact.number || (contact.email ? contact.email.split('@')[0] : contact.id)
  router.push({
    path: '/messages',
    query: {
      ext,
      name: contact.name,
      uuid: contact.uuid || '',
    },
  })
}

// Bật/tắt trạng thái Yêu thích (gọi API danh bạ máy chủ tổng đài)
const toggleFavorite = async (contact) => {
  const newFav = await contactService.toggleFavorite(contact)
  contact.isFavorite = newFav
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: newFav
          ? `Đã thêm [${contact.name}] vào mục Yêu thích ⭐`
          : `Đã bỏ [${contact.name}] khỏi mục Yêu thích`,
        type: 'info',
      },
    }),
  )
}

// Nạp danh bạ từ máy chủ tổng đài
const loadContacts = async (silent = false) => {
  if (!silent && contacts.value.length === 0) {
    loadingContacts.value = true
  }
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
  } catch (err) {
    console.warn('Lỗi nạp danh bạ tổng đài:', err)
  } finally {
    loadingContacts.value = false
  }
}

// Làm mới danh bạ thủ công
const refreshContacts = async () => {
  loadingContacts.value = true
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `✅ Đã làm mới danh bạ (${fresh.length} liên hệ)!`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    console.warn('Lỗi làm mới danh bạ:', err)
  } finally {
    loadingContacts.value = false
  }
}

// Dọn dẹp query sau khi cuộc gọi kết thúc (bảo toàn tham số tìm kiếm q)
const cleanCallQueryParams = () => {
  dtmfLog.value = ''
  if (
    route.query &&
    (route.query.number || route.query.autocall || route.query.active || route.query.direction)
  ) {
    const remainingQuery = { ...route.query }
    delete remainingQuery.number
    delete remainingQuery.autocall
    delete remainingQuery.active
    delete remainingQuery.direction
    router.replace({ path: '/calls', query: remainingQuery }).catch(() => {})
  }
}

const onCallEnded = () => {
  cleanCallQueryParams()
}

const hangupCall = () => {
  if (recordService.isRecording()) {
    try {
      recordService.stopRecording()
    } catch (e) {}
  }
  wazoService.hangup()
  cleanCallQueryParams()
}

const toggleRecord = async () => {
  if (isRecording.value) {
    try {
      await recordService.stopRecording()
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⏹️ Đã dừng ghi âm cuộc gọi trên máy chủ tổng đài.',
            type: 'info',
          },
        }),
      )
    } catch (e) {
      console.warn('Lỗi khi dừng ghi âm máy chủ:', e)
    }
  } else if (callStore.activeCall) {
    if (callState.value === 'ringing') {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '⏳ Xin vui lòng chờ đối phương nhấc máy để bắt đầu ghi âm!',
            type: 'warning',
          },
        }),
      )
      return
    }

    try {
      await recordService.startRecording(null, {
        name: callStore.activeCall.name,
        number: callStore.activeCall.number,
        extension: callStore.activeCall.number,
        dept: callStore.activeCall.dept,
        direction: callStore.activeCall.direction,
      })
      callStore.activeCall.isRecorded = true
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '🔴 Đang ghi âm cuộc gọi trực tiếp trên máy chủ tổng đài...',
            type: 'success',
          },
        }),
      )
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ Không thể ghi âm trên tổng đài: ${err.message || 'Lỗi phân quyền'}`,
            type: 'error',
          },
        }),
      )
    }
  }
}

const toggleMute = () => {
  wazoService.toggleMute()
}

const toggleHold = () => {
  wazoService.toggleHold()
}

// Helper Avatar
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(-2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 65%, 48%)`
}

const onContactsUpdated = () => {
  if (contactService.currentContacts) {
    contacts.value = [...contactService.currentContacts]
  }
}

// Lắng nghe thay đổi query URL từ thanh tìm kiếm Header
watch(
  () => route.query.q,
  (newQ) => {
    if (newQ !== undefined && newQ !== null) {
      searchTerm.value = String(newQ)
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        mobileTab.value = 'contacts'
      }
    }
  },
  { immediate: true },
)

// Lắng nghe gọi tự động khi click số từ giao diện khác
watch(
  () => route.query.number,
  (newNum) => {
    if (newNum) {
      extension.value = String(newNum)
      if (route.query.autocall === 'true') {
        if (!callStore.activeCall && !wazoService.hasActiveCall()) {
          setTimeout(() => {
            handleDial()
          }, 150)
        } else {
          cleanCallQueryParams()
        }
      }
    }
  },
  { immediate: true },
)

const onWindowFocus = () => {
  loadContacts(true)
}

const onRefreshContactsEvent = () => {
  loadContacts(true)
}

onMounted(async () => {
  window.addEventListener('smartcall-call-ended', onCallEnded)
  window.addEventListener('smartcall-contacts-updated', onContactsUpdated)
  window.addEventListener('smartcall-refresh-contacts', onRefreshContactsEvent)
  window.addEventListener('focus', onWindowFocus)

  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }

  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    contacts.value = [...contactService.currentContacts]
    loadContacts(true)
  } else {
    loadContacts(false)
  }
})

// Hỗ trợ KeepAlive mượt mà không delay khi chuyển tab & tự động refresh ngầm
onActivated(() => {
  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }
  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    contacts.value = [...contactService.currentContacts]
  }
  loadContacts(true)
})

onUnmounted(() => {
  window.removeEventListener('smartcall-call-ended', onCallEnded)
  window.removeEventListener('smartcall-contacts-updated', onContactsUpdated)
  window.removeEventListener('smartcall-refresh-contacts', onRefreshContactsEvent)
  window.removeEventListener('focus', onWindowFocus)
  dtmfLog.value = ''
})
</script>

<style scoped>
.calls-view {
  max-width: 1560px;
  margin: 0 auto;
  padding: 0 16px;
}

.view-header {
  margin-bottom: 20px;
}

.header-titles h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 4px 0;
  font-weight: 700;
}

.sub-text {
  color: #64748b;
  font-size: 0.88rem;
}

/* Segmented Control cho Mobile */
.mobile-segmented-bar {
  display: none;
  background: #e2e8f0;
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 16px;
  gap: 4px;
}

.seg-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 0.88rem;
  font-weight: 600;
  color: #475569;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.seg-btn.active {
  background: white;
  color: #1e88e5;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

/* Mini Active Call Bar khi xem Tab Danh bạ trên Mobile */
.mobile-active-call-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0f172a;
  color: white;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border: 1px solid #334155;
}

.bar-call-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}

.mini-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  animation: pulse-ring 1.5s infinite;
}

.bar-duration {
  font-family: monospace;
  color: #34d399;
  font-weight: 700;
}

.bar-call-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-mini-control {
  background: #334155;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-mini-control.active {
  background: #ef4444;
}

.btn-mini-hangup {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

/* =========================================================================
   ADAPTIVE 3-TIER GRID SYSTEM
   ========================================================================= */

/* 1. Màn hình Desktop rộng (>= 1200px): 3 Cột Cân Đối (Bàn phím 300px, Đàm thoại 420px, Danh bạ 1fr mở rộng) */
.calls-grid-layout {
  display: grid;
  grid-template-columns: 300px 420px 1fr;
  grid-template-areas: 'dialer status contacts';
  gap: 20px;
  align-items: stretch;
}

.dialer-col {
  grid-area: dialer;
}

.status-col {
  grid-area: status;
}

.contacts-col {
  grid-area: contacts;
}

/* --- Dialer Box --- */
.dialer-box {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.dialer-screen input {
  width: 100%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: #1e293b;
  text-align: center;
  outline: none;
  margin-bottom: 16px;
  transition: all 0.2s;
}

.dialer-screen input:focus {
  border-color: #3b82f6;
  background: white;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.key-btn {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  width: 58px;
  height: 58px;
  margin: 0 auto;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.key-btn:hover {
  background: #e2e8f0;
  transform: scale(1.05);
}

.key-btn small {
  font-size: 0.52rem;
  color: #64748b;
  font-weight: normal;
  margin-top: -3px;
}

.dial-actions {
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: center;
  margin-top: 6px;
}

.btn-dial {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
  transition: all 0.2s;
}

.btn-dial:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: scale(1.06);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
}

.btn-dial:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.dial-svg-icon {
  width: 22px;
  height: 22px;
  fill: #ffffff;
  flex-shrink: 0;
}

.btn-clear {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  border: 1.5px solid #cbd5e1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0.35;
}

.btn-clear.visible {
  opacity: 1;
}

.btn-clear:hover:not(:disabled) {
  background: #fee2e2;
  color: #ef4444;
  border-color: #fca5a5;
  transform: scale(1.06);
}

.btn-clear:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.clear-svg-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

/* --- Call Status Box --- */
.call-status-box {
  background: linear-gradient(145deg, #1e293b, #0f172a);
  color: white;
  border-radius: 14px;
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 440px;
  border: 1px solid #334155;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.call-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  border: 3px solid #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin: 0 auto 16px auto;
  background: linear-gradient(135deg, #1e3a8a, #2563eb);
  color: white;
  font-weight: 700;
  position: relative;
  transition: all 0.3s;
}

.call-avatar.pulsing {
  border-color: #10b981;
  box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.25);
  animation: pulse-ring 2s infinite;
}

.call-avatar.ringingPulse {
  border-color: #f59e0b;
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.25);
  animation: pulse-ring-amber 1.5s infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

@keyframes pulse-ring-amber {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(245, 158, 11, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
}

.caller-title {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0 0 6px 0;
  color: #f8fafc;
  letter-spacing: -0.2px;
}

.caller-dept-badge {
  display: inline-block;
  padding: 3px 10px;
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.dialer-status-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #cbd5e1;
  margin-bottom: 16px;
}

.status-dot-inline {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot-inline.online {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
}

.status-dot-inline.busy,
.status-dot-inline.talking,
.status-dot-inline.holding {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.7);
}

.status-dot-inline.away {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.7);
}

.status-dot-inline.dnd {
  background: #8b5cf6;
  box-shadow: 0 0 6px rgba(139, 92, 246, 0.7);
}

.status-dot-inline.ringing {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.7);
}

.status-dot-inline.offline {
  background: #94a3b8;
}

.status-sep {
  color: #64748b;
  font-size: 0.75rem;
}

.status-ext-text {
  font-weight: 500;
  color: #94a3b8;
}

.idle-unknown-note {
  font-size: 0.82rem;
  color: #94a3b8;
  margin: 6px 0 16px 0;
}

.idle-guide-text {
  font-size: 0.85rem;
  color: #94a3b8;
  margin: 8px 0 20px 0;
  max-width: 280px;
  line-height: 1.4;
}

.call-avatar.idle-avatar {
  background: rgba(30, 41, 59, 0.8);
  border-color: #475569;
  font-size: 2.2rem;
}

.duration-text {
  font-size: 1.45rem;
  color: #34d399;
  font-weight: 700;
  font-family: monospace;
  margin: 8px 0 20px 0;
  letter-spacing: 1px;
}

.duration-text.ringingText {
  color: #fbbf24;
  font-size: 1.05rem;
  letter-spacing: 0.5px;
  animation: pulse-ring-amber 1.5s infinite;
}

.controls-row {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 6px;
}

.control-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.ctrl-svg-icon {
  width: 22px;
  height: 22px;
  stroke: #ffffff;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.control-btn.active {
  background: #f59e0b;
  border-color: #d97706;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
}

.control-btn.muted {
  background: #ef4444;
  border-color: #dc2626;
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.45);
}

.control-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.control-btn.btn-hangup {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-color: #b91c1c;
  width: 54px;
  height: 54px;
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.45);
}

.control-btn.btn-hangup:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: scale(1.06);
}

.control-btn.btn-record {
  border-color: rgba(239, 68, 68, 0.45);
}

.control-btn.btn-record:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
}

.control-btn.btn-record.recording {
  background: #dc2626;
  border-color: #b91c1c;
  width: auto;
  min-width: 50px;
  padding: 0 12px;
  border-radius: 25px;
  gap: 5px;
  animation: pulse-rec-btn 1.4s infinite;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
}

.rec-dot-pulse {
  color: #ffffff;
  font-size: 0.95rem;
  line-height: 1;
  animation: blink-rec-dot 1s infinite;
}

.rec-label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  white-space: nowrap;
  color: #ffffff;
}

.recording-indicator-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 12px;
  color: #fca5a5;
  font-size: 0.78rem;
  font-weight: 600;
  margin-top: 6px;
  animation: pulse-rec-border 1.5s infinite;
}

.rec-pulse-dot {
  color: #ef4444;
  font-size: 0.85rem;
  line-height: 1;
  animation: blink-rec-dot 1s infinite;
}

@keyframes blink-rec-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

@keyframes pulse-rec-btn {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  50% { transform: scale(1.04); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

@keyframes pulse-rec-border {
  0% { border-color: rgba(239, 68, 68, 0.5); }
  50% { border-color: rgba(239, 68, 68, 0.9); }
  100% { border-color: rgba(239, 68, 68, 0.5); }
}

.hangup-svg {
  fill: #ffffff;
  width: 24px;
  height: 24px;
}

/* Idle collapsed bar chỉ hiển thị trong chế độ thu gọn tablet */
.idle-collapsed-bar {
  display: none;
}

/* --- Cột 3: Danh bạ Nhân viên (Contacts Panel) --- */
.contacts-panel-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.panel-header {
  padding: 14px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 5px 12px;
  transition: border-color 0.2s;
}

.search-box:focus-within {
  border-color: #1e88e5;
  box-shadow: 0 0 0 2px rgba(30, 136, 229, 0.15);
}

.search-icon {
  font-size: 0.85rem;
  margin-right: 6px;
  color: #64748b;
}

.search-input {
  border: none;
  outline: none;
  font-size: 0.85rem;
  width: 100%;
}

.btn-clear-search {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  font-size: 0.8rem;
  padding: 0 2px;
}

.btn-refresh {
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
  color: #1e88e5;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-refresh:hover:not(:disabled) {
  background: #e3f2fd;
  border-color: #1e88e5;
  transform: rotate(45deg);
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.panel-tabs-bar {
  display: flex;
  align-items: center;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 4px 6px 0;
  gap: 4px;
  position: relative;
  overflow: hidden;
}

.panel-tabs-slider {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  gap: 4px;
  scroll-behavior: smooth;
}

.panel-tabs-slider::-webkit-scrollbar {
  display: none;
}

/* Khi <= 5 danh mục: chia đều 100% chiều rộng */
.panel-tabs-slider.is-even-split {
  width: 100%;
}
.panel-tabs-slider.is-even-split .panel-tab-btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px 4px;
}

/* Khi > 5 danh mục: hiển thị 5 tab trong viewport, phần còn lại trượt */
.panel-tabs-slider.is-slider-mode .panel-tab-btn {
  flex: 0 0 calc((100% - 16px) / 5);
  min-width: 105px;
  padding: 8px 6px;
}

.btn-tabs-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 32px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #475569;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  margin-bottom: 2px;
  transition: all 0.15s ease;
  user-select: none;
}

.btn-tabs-nav:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.btn-tab-config {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
  margin-bottom: 2px;
  transition: all 0.15s ease;
}

.btn-tab-config:hover {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #2563eb;
}

.panel-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  background: transparent;
  font-size: 0.8rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  white-space: nowrap;
  border-radius: 6px 6px 0 0;
  flex-shrink: 0;
}

.panel-tab-btn .tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-tab-btn:hover {
  color: #1e293b;
  background: rgba(241, 245, 249, 0.7);
}

.panel-tab-btn.active {
  color: #1e88e5;
  border-bottom-color: #1e88e5;
  background: #ffffff;
}

.tab-icon {
  font-size: 0.85rem;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.76rem;
  font-weight: 800;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e2e8f0;
  color: #0f172a;
  min-width: 20px;
  line-height: 1.3;
}

.panel-tab-btn.active .tab-badge {
  background: #2563eb;
  color: #ffffff;
}

.tab-badge.badge-online {
  background: #dcfce7;
  color: #166534;
}
.panel-tab-btn.active .tab-badge.badge-online {
  background: #16a34a;
  color: #ffffff;
}

.tab-badge.badge-offline {
  background: #f1f5f9;
  color: #334155;
}

.tab-badge.badge-dept {
  background: #eff6ff;
  color: #1d4ed8;
}
.panel-tab-btn.active .tab-badge.badge-dept {
  background: #2563eb;
  color: #ffffff;
}

.tab-svg-icon {
  flex-shrink: 0;
  vertical-align: middle;
}

/* --- Department Selector Bar --- */
.dept-selector-bar {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.dept-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dept-bar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.dept-current-badge {
  font-size: 0.72rem;
  font-weight: 700;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 2px 8px;
  border-radius: 12px;
}

.dept-chips-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.dept-chips-scroll::-webkit-scrollbar {
  display: none;
}

.dept-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 0.76rem;
  font-weight: 600;
  background: #ffffff;
  color: #64748b;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.dept-chip-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.dept-chip-btn.active {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #3b82f6;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.15);
}

.dept-chip-count {
  font-size: 0.7rem;
  opacity: 0.85;
}

.dept-empty-hint {
  font-size: 0.75rem;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
}

.panel-list-container {
  flex: 1;
  max-height: 620px;
  overflow-y: auto;
  padding: 10px 12px;
}

/* Custom Scrollbar */
.panel-list-container::-webkit-scrollbar {
  width: 5px;
}
.panel-list-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.contacts-items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.contact-item-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px 14px;
  gap: 12px;
  transition: all 0.15s ease;
}

.contact-item-card:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.btn-star {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #cbd5e1;
  transition:
    transform 0.15s,
    color 0.15s;
  padding: 4px;
  min-width: 32px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.btn-star:hover {
  transform: scale(1.2);
  color: #f59e0b;
}

.btn-star.active {
  color: #f59e0b;
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.contact-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.contact-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.name-status-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-dot-inline {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.status-dot-inline.dot-online {
  background: #22c55e;
}
.status-dot-inline.dot-busy {
  background: #ef4444;
}
.status-dot-inline.dot-ringing {
  background: #3b82f6;
  animation: pulse-ring 1s infinite;
}
.status-dot-inline.dot-dnd {
  background: #f97316;
}
.status-dot-inline.dot-away {
  background: #eab308;
}
.status-dot-inline.dot-offline {
  background: #94a3b8;
}

.contact-name {
  font-size: 0.92rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.self-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  color: #059669;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
  vertical-align: middle;
}

.mobile-phone-badge {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 5px;
  color: #10b981;
}

.phone-svg-icon {
  display: inline-block;
  vertical-align: middle;
}

.meta-row-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  color: #64748b;
}

.ext-badge {
  background: #e0f2fe;
  color: #0284c7;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.dept-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 6px;
}

.btn-action-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.92rem;
  transition: all 0.15s;
  position: relative;
}

.btn-action-icon .action-svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  transition: transform 0.15s ease, color 0.15s ease;
}

.btn-action-icon:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.btn-action-icon:hover:not(:disabled) .action-svg {
  transform: scale(1.12);
}

.btn-action-icon.call {
  color: #10b981;
}

.btn-action-icon.call:hover:not(:disabled) {
  background: #ecfdf5;
  border-color: #10b981;
  color: #059669;
}

.btn-action-icon.chat {
  color: #3b82f6;
}

.btn-action-icon.chat:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #2563eb;
}

.btn-action-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn-action-icon:disabled * {
  pointer-events: none;
}

.badge-unread {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #ef4444;
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 10px;
}

.panel-state-message {
  text-align: center;
  padding: 40px 16px;
  color: #64748b;
  font-size: 0.85rem;
}

.spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #1e88e5;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px auto;
}

/* =========================================================================
   2. MÀN HÌNH TRUNG BÌNH (Tablet / Laptop nhỏ 768px - 1199px): 2 Cột Tích Hợp
   ========================================================================= */
@media (max-width: 1199px) and (min-width: 768px) {
  .calls-grid-layout {
    grid-template-columns: 330px 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'status contacts'
      'dialer contacts';
    gap: 16px 20px;
  }

  /* Khung trạng thái thu gọn khi Idle (~70px) */
  .status-col.is-idle .call-status-box {
    min-height: 64px;
    padding: 12px 16px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .status-col.is-idle .hide-on-tablet-idle {
    display: none;
  }

  .status-col.is-idle .idle-collapsed-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .idle-sip-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    font-family: monospace;
    color: #cbd5e1;
  }

  .idle-sip-badge .sip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
  }

  .idle-note {
    font-size: 0.78rem;
    color: #94a3b8;
  }

  /* Khi Active: mở rộng đầy đủ */
  .status-col.is-active-call .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .status-col.is-active-call .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.5rem;
    margin-bottom: 10px;
  }

  .status-col.is-active-call .duration-text {
    margin: 6px 0 12px 0;
  }

  .contacts-panel-card {
    min-height: 600px;
  }

  .panel-list-container {
    max-height: 520px;
  }
}

/* =========================================================================
   3. MÀN HÌNH DI ĐỘNG (< 768px): Thanh chuyển đổi phân đoạn Segmented
   ========================================================================= */
@media (max-width: 768px) {
  .mobile-segmented-bar {
    display: flex;
  }

  .calls-grid-layout {
    display: block;
  }

  .calls-grid-layout.mobile-show-dialer .contacts-col {
    display: none;
  }

  .calls-grid-layout.mobile-show-dialer .dialer-col,
  .calls-grid-layout.mobile-show-dialer .status-col {
    display: block;
    margin-bottom: 16px;
  }

  .calls-grid-layout.mobile-show-contacts .dialer-col,
  .calls-grid-layout.mobile-show-contacts .status-col {
    display: none;
  }

  .calls-grid-layout.mobile-show-contacts .contacts-col {
    display: block;
  }

  .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.6rem;
  }

  .dialer-box {
    padding: 16px;
  }

  .key-btn {
    width: 52px;
    height: 52px;
    font-size: 1.15rem;
  }
}

/* --- Tab Gọi nhóm & Action bar --- */
.panel-tab-btn.tab-group-call {
  color: #2563eb;
  font-weight: 700;
  margin-left: 0;
}
.panel-tab-btn.tab-group-call.active {
  background: #ffffff;
  border-bottom-color: #2563eb;
  color: #2563eb;
}

.group-call-selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.selection-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.selection-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  color: #1e40af;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 4px 10px;
  border-radius: 20px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.selection-pill strong {
  font-weight: 700;
  color: #1d4ed8;
}

.action-buttons-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.btn-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 16px;
  font-size: 0.76rem;
  font-weight: 600;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  height: 26px;
  box-sizing: border-box;
}

.btn-action-pill:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}

.btn-action-pill.btn-deselect-group {
  color: #dc2626;
  border-color: #fecaca;
  background: #fff5f5;
  width: auto;
  height: 26px;
}
.btn-action-pill.btn-deselect-group:hover {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.pill-dot.online {
  background: #22c55e;
}

.btn-start-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-start-group:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(16, 185, 129, 0.4);
}

.btn-start-group:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* Custom Checkbox */
.group-select-checkbox-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.custom-check-box {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 2px solid #cbd5e1;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.custom-check-box.checked {
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
}

.custom-check-box.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f1f5f9;
}

.check-svg {
  width: 13px;
  height: 13px;
  stroke: #ffffff;
}

.contact-item-card.group-selectable {
  cursor: pointer;
  user-select: none;
}

.contact-item-card.group-selected {
  background: #f8faff;
  border: 1.5px solid #93c5fd !important;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

.group-select-indicator {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.badge-group-selected {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.74rem;
  font-weight: 700;
  background: #dbeafe;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}

.badge-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 500;
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.badge-status-pill.online {
  background: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}

.badge-status-pill.busy {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.badge-status-pill.dnd {
  background: #fff7ed;
  color: #c2410c;
  border-color: #fed7aa;
}

.badge-status-pill.away {
  background: #fefce8;
  color: #a16207;
  border-color: #fef08a;
}

.badge-status-pill.ringing {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.badge-status-pill.offline {
  background: #f8fafc;
  color: #94a3b8;
  border-color: #e2e8f0;
}

.group-call-badge-tag {
  display: inline-block;
  padding: 3px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.group-members-summary-text {
  font-size: 0.82rem;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.35;
  max-width: 320px;
  text-align: center;
}

.call-avatar.groupCallAvatar {
  background: #059669 !important;
}

/* Modal Tùy chỉnh danh mục hiển thị */
.tab-config-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeInModal 0.2s ease-out;
}

.tab-config-card {
  background: #ffffff;
  border-radius: 14px;
  width: 90%;
  max-width: 440px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: scaleUpModal 0.2s ease-out;
}

@keyframes fadeInModal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scaleUpModal {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.tab-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}

.tab-config-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
}

.tab-config-close {
  background: transparent;
  border: none;
  font-size: 1rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
}

.tab-config-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.tab-config-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tab-config-desc {
  font-size: 0.8rem;
  color: #64748b;
  margin: 0;
  line-height: 1.45;
}

.tab-config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.tab-config-item:hover {
  border-color: #93c5fd;
  background: #f8fafc;
}

.tab-config-item.selected {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.tab-config-item.disabled {
  cursor: default;
  background: #f8fafc;
  opacity: 0.85;
}

.tab-config-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tab-config-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #2563eb;
  cursor: pointer;
}

.tab-config-icon {
  font-size: 1rem;
}

.tab-config-item-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
}

.tab-config-item-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 6px;
  background: #e2e8f0;
  color: #475569;
  border-radius: 4px;
}

.tab-config-item-count {
  font-size: 0.76rem;
  font-weight: 600;
  color: #64748b;
  background: #ffffff;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.tab-config-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid #f1f5f9;
  background: #f8fafc;
}

.btn-tab-config-reset {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: all 0.15s;
}

.btn-tab-config-reset:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-tab-config-done {
  background: #2563eb;
  color: #ffffff;
  border: none;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-tab-config-done:hover {
  background: #1d4ed8;
}
</style>
