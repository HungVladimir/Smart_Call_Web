
 	 	 	 	 	 	 	 	 	 	InCallActivity.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.call;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.company.internalcall.R;
import com.company.internalcall.service.CallToneHelper;
import com.company.internalcall.service.WazoKeepAliveService;
import com.company.internalcall.service.WazoSipCallManager;
import com.google.android.material.floatingactionbutton.FloatingActionButton;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class InCallActivity extends AppCompatActivity {
    private static final String TAG = "InCallActivity";
    private static final int REQ_RECORD_AUDIO = 101;

    private TextView tvAvatarCall;
    private TextView tvTargetName;
    private TextView tvTargetExtension;
    private TextView tvCallStatus;
    private ImageButton btnMute;
    private ImageButton btnSpeaker;
    private ImageButton btnAddParticipant;
    private FloatingActionButton btnEndCall;
    private FloatingActionButton btnAcceptCall;

    private String targetName = "";
    private String targetExt = "";
    private ArrayList<String> initialGroupExtensions = null;
    private boolean isIncoming = false;
    private boolean isMuted = false;
    private boolean isSpeakerOn = false;
    private boolean timerRunning = false;
    private int secondsElapsed = 0;
    private long callConnectedTimestamp = 0L;

    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private final Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!timerRunning) return;
            secondsElapsed++;
            int mins = secondsElapsed / 60;
            int secs = secondsElapsed % 60;
            tvCallStatus.setText(String.format(Locale.getDefault(), "%02d:%02d", mins, secs));
            timerHandler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        turnScreenOnAndKeyguardOff();
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_incall);

        tvAvatarCall = findViewById(R.id.tvAvatarCall);
        tvTargetName = findViewById(R.id.tvTargetName);
        tvTargetExtension = findViewById(R.id.tvTargetExtension);
        tvCallStatus = findViewById(R.id.tvCallStatus);
        btnMute = findViewById(R.id.btnMute);
        btnSpeaker = findViewById(R.id.btnSpeaker);
        btnAddParticipant = findViewById(R.id.btnAddParticipant);
        btnEndCall = findViewById(R.id.btnEndCall);
        btnAcceptCall = findViewById(R.id.btnAcceptCall);

        setupFromIntent(getIntent());

        if (btnAcceptCall != null) {
            btnAcceptCall.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    btnAcceptCall.hide();
                    tvCallStatus.setText("Đang kết nối âm thanh...");
                    CallToneHelper.stopIncomingRing();
                    WazoSipCallManager.getInstance().cancelIncomingCallNotification();
                    WazoSipCallManager.getInstance().acceptIncomingCall();
                }
            });
        }

        WazoSipCallManager.getInstance().setCallStateCallback(new WazoSipCallManager.CallStateCallback() {
            @Override
            public void onCallStateChanged(final String statusText, final boolean isConnected, final boolean isEnded) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isEnded) {
                            stopCallTimer();
                            callConnectedTimestamp = 0L;
                            CallToneHelper.stopRingback();
                            CallToneHelper.stopIncomingRing();
                            WazoSipCallManager.getInstance().cancelIncomingCallNotification();
                            cancelOngoingCallNotification(InCallActivity.this);
                        }

                        if (isFinishing() || isDestroyed()) return;

                        if (isConnected) {
                            CallToneHelper.stopRingback();
                            CallToneHelper.stopIncomingRing();
                            WazoSipCallManager.getInstance().cancelIncomingCallNotification();
                            if (btnAcceptCall != null) btnAcceptCall.hide();
                            startCallTimer();

                            // Nếu có thông báo phụ kiểu "Đang kết nối Nguyễn Văn C (1008)..." khi đang gọi 1-1
                            if (statusText != null && statusText.startsWith("Đang kết nối ")) {
                                tvTargetExtension.setText(statusText);
                            } else if (statusText != null && statusText.startsWith("Không thể kết nối ")) {
                                Toast.makeText(InCallActivity.this, statusText, Toast.LENGTH_SHORT).show();
                                if (!WazoSipCallManager.getInstance().isGroupCall()) {
                                    tvTargetExtension.setText("Số nội bộ: " + targetExt);
                                }
                            }

                            showOngoingCallNotification();
                        } else if (isEnded) {
                            tvCallStatus.setText(statusText);
                            btnEndCall.setEnabled(false);
                            if (btnAcceptCall != null) btnAcceptCall.hide();
                            timerHandler.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    closeInCallScreen();
                                }
                            }, 900);
                        } else {
                            tvCallStatus.setText(statusText);
                        }
                    }
                });
            }

            @Override
            public void onGroupParticipantsUpdated(final boolean isGroup, final String titleText, final String membersSummary, final int memberCount) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        if (isGroup) {
                            targetName = "Cuộc gọi nhóm";
                            tvTargetName.setText("Cuộc gọi nhóm");
                            tvTargetExtension.setText(membersSummary);
                            if (tvAvatarCall != null) {
                                tvAvatarCall.setText(memberCount + "P");
                            }
                            showOngoingCallNotification();
                        } else {
                            // Khi hoán đổi nhánh chính (ví dụ B chưa nghe mà C đã nghe trước -> đổi tên sang C)
                            String curName = WazoSipCallManager.getInstance().getActiveTargetName();
                            String curExt = WazoSipCallManager.getInstance().getActiveTargetExt();
                            if (!curName.isEmpty()) targetName = curName;
                            if (!curExt.isEmpty()) targetExt = curExt;
                            tvTargetName.setText(targetName);
                            tvTargetExtension.setText("Số nội bộ: " + targetExt);
                            if (tvAvatarCall != null && !targetName.isEmpty()) {
                                tvAvatarCall.setText(targetName.substring(0, 1).toUpperCase(Locale.ROOT));
                            }
                            showOngoingCallNotification();
                        }
                    }
                });
            }
        });

        btnMute.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                isMuted = !isMuted;
                WazoSipCallManager.getInstance().setMute(isMuted);
                btnMute.setAlpha(isMuted ? 1.0f : 0.6f);
                btnMute.setImageResource(isMuted ? R.drawable.ic_mic_off : R.drawable.ic_mic_on);
            }
        });

        btnSpeaker.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                isSpeakerOn = !isSpeakerOn;
                WazoSipCallManager.getInstance().setSpeaker(isSpeakerOn);
                btnSpeaker.setAlpha(isSpeakerOn ? 1.0f : 0.6f);
                btnSpeaker.setImageResource(isSpeakerOn ? R.drawable.ic_speaker_on : R.drawable.ic_speaker_off);
            }
        });

        if (btnAddParticipant != null) {
            btnAddParticipant.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (!WazoSipCallManager.getInstance().hasActiveCall()) {
                        Toast.makeText(InCallActivity.this, "Cuộc gọi chưa sẵn sàng", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    List<String> alreadyInCall = new ArrayList<>(WazoSipCallManager.getInstance().getGroupParticipantExtensions());
                    if (targetExt != null && !targetExt.isEmpty() && !alreadyInCall.contains(targetExt)) {
                        alreadyInCall.add(targetExt);
                    }
                    GroupParticipantPickerSheet.show(
                            InCallActivity.this,
                            "Thêm thành viên vào cuộc gọi",
                            "Mời vào cuộc gọi",
                            1,
                            alreadyInCall,
                            new GroupParticipantPickerSheet.OnParticipantsSelectedListener() {
                                @Override
                                public void onSelected(List<String> selectedExtensions) {
                                    Toast.makeText(InCallActivity.this,
                                            "Đang mời thêm " + selectedExtensions.size() + " thành viên...",
                                            Toast.LENGTH_SHORT).show();
                                    WazoSipCallManager.getInstance().addParticipantsToCurrentCall(selectedExtensions);
                                }
                            }
                    );
                }
            });
        }

        btnEndCall.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                stopCallTimer();
                callConnectedTimestamp = 0L;
                CallToneHelper.stopRingback();
                CallToneHelper.stopIncomingRing();
                WazoSipCallManager.getInstance().cancelIncomingCallNotification();
                cancelOngoingCallNotification(InCallActivity.this);
                WazoSipCallManager.getInstance().hangup();
                closeInCallScreen();
            }
        });

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
        } else {
            beginCallFlow();
        }
    }

    @Override
    public void onBackPressed() {
        if (WazoSipCallManager.getInstance().hasActiveCall()) {
            moveTaskToBack(true);
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        setupFromIntent(intent);
        beginCallFlow();
    }

    @Override
    protected void onResume() {
        super.onResume();
        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        callManager.cancelIncomingCallNotification();

        if (callManager.isGroupCall()) {
            tvTargetName.setText("Cuộc gọi nhóm");
            tvTargetExtension.setText(callManager.getFormattedGroupMembersSummary());
            if (tvAvatarCall != null) {
                tvAvatarCall.setText(callManager.getGroupParticipantExtensions().size() + "P");
            }
        }

        if (callManager.hasActiveCall()) {
            showOngoingCallNotification();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        WazoSipCallManager callManager = WazoSipCallManager.getInstance();

        if (isFinishing() && callManager.hasActiveCall()) {
            stopCallTimer();
            CallToneHelper.stopRingback();
            CallToneHelper.stopIncomingRing();
            callManager.cancelIncomingCallNotification();
            cancelOngoingCallNotification(this);
            callManager.hangup();
        }
    }

    private void showOngoingCallNotification() {
        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        if (!callManager.hasActiveCall()) return;

        String notifTitle = callManager.isGroupCall() ? "Cuộc gọi nhóm" : targetName;
        String notifSub = callManager.isGroupCall() ? callManager.getFormattedGroupMembersSummary() : targetExt;

        WazoKeepAliveService.updateNotificationState(
                this,
                true,
                notifTitle,
                notifSub,
                timerRunning ? callConnectedTimestamp : 0L
        );
    }

    public static void cancelOngoingCallNotification(Context context) {
        if (context == null) return;
        WazoKeepAliveService.updateNotificationState(context, false, null, null, 0L);
    }

    @Override
    protected void onDestroy() {
        cancelOngoingCallNotification(this);
        stopCallTimer();

        if (!isChangingConfigurations() && WazoSipCallManager.getInstance().hasActiveCall()) {
            CallToneHelper.stopRingback();
            CallToneHelper.stopIncomingRing();
            WazoSipCallManager.getInstance().cancelIncomingCallNotification();
            WazoSipCallManager.getInstance().hangup();
        }

        WazoSipCallManager.getInstance().setCallStateCallback(null);
        super.onDestroy();
    }

    private void setupFromIntent(Intent intent) {
        WazoSipCallManager.getInstance().cancelIncomingCallNotification();

        logAllIntentExtras(intent);

        if (intent != null && intent.hasExtra("GROUP_EXTENSIONS")) {
            initialGroupExtensions = intent.getStringArrayListExtra("GROUP_EXTENSIONS");
        }

        String newExt = resolveIntentString(intent,
                "target_ext", "extension", "ext", "number", "phone",
                "EXTRA_EXTENSION", "EXTRA_NUMBER", "call_ext", "callee_ext", "CALLEE_EXT");

        String newName = resolveIntentString(intent,
                "target_name", "name", "full_name", "fullName", "displayName",
                "EXTRA_NAME", "caller_name", "callee_name", "CALLEE_NAME");

        if (newExt.isEmpty() && intent != null && intent.getExtras() != null) {
            Bundle bundle = intent.getExtras();
            for (String key : bundle.keySet()) {
                Object val = bundle.get(key);
                if (val instanceof String) {
                    String s = ((String) val).trim();
                    if (s.matches("^\\d{3,6}$") && newExt.isEmpty()) {
                        newExt = s;
                    } else if (!s.isEmpty() && newName.isEmpty() && !key.equalsIgnoreCase("is_incoming")) {
                        newName = s;
                    }
                }
            }
        }

        if (!newExt.isEmpty()) targetExt = newExt;
        if (!newName.isEmpty()) targetName = newName;

        if (timerRunning) {
            isIncoming = false;
        } else {
            isIncoming = intent != null && intent.getBooleanExtra("is_incoming", false);
        }

        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        if (callManager.isGroupCall()) {
            tvTargetName.setText("Cuộc gọi nhóm");
            tvTargetExtension.setText(callManager.getFormattedGroupMembersSummary());
            if (tvAvatarCall != null) {
                tvAvatarCall.setText(callManager.getGroupParticipantExtensions().size() + "P");
            }
        } else {
            String displayName = !targetName.isEmpty() ? targetName : ("Máy nhánh " + targetExt);
            tvTargetName.setText(displayName);
            tvTargetExtension.setText("Số nội bộ: " + targetExt);
            if (tvAvatarCall != null && !displayName.isEmpty()) {
                tvAvatarCall.setText(displayName.substring(0, 1).toUpperCase(Locale.ROOT));
            }
        }

        if (btnAcceptCall != null) {
            if (isIncoming && !timerRunning && WazoSipCallManager.getInstance().isIncomingRinging()) {
                btnAcceptCall.show();
            } else {
                btnAcceptCall.hide();
            }
        }
    }

    private void turnScreenOnAndKeyguardOff() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
    }

    private String resolveIntentString(Intent intent, String... keys) {
        if (intent == null) return "";
        for (String k : keys) {
            String v = intent.getStringExtra(k);
            if (v != null && !v.trim().isEmpty()) {
                return v.trim();
            }
        }
        return "";
    }

    private void closeInCallScreen() {
        cancelOngoingCallNotification(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private void logAllIntentExtras(Intent intent) {
        if (intent == null || intent.getExtras() == null) return;
        Bundle b = intent.getExtras();
        for (String key : b.keySet()) {
            Log.d(TAG, "Intent Extra [" + key + "] = " + b.get(key));
        }
    }

    private void beginCallFlow() {
        WazoSipCallManager manager = WazoSipCallManager.getInstance();
        if (isIncoming) {
            if (!manager.hasActiveCall()) {
                closeInCallScreen();
                return;
            }
            if (manager.isIncomingRinging()) {
                tvCallStatus.setText("Cuộc gọi đến...");
            } else {
                if (btnAcceptCall != null) btnAcceptCall.hide();
                startCallTimer();
            }
        } else if (initialGroupExtensions != null && initialGroupExtensions.size() >= 2) {
            if (manager.hasActiveCall()) {
                return;
            }
            List<String> groupToCall = new ArrayList<>(initialGroupExtensions);
            initialGroupExtensions = null;
            tvCallStatus.setText("Đang khởi tạo cuộc gọi nhóm...");
            manager.startGroupCall(groupToCall);
        } else if (targetExt != null && !targetExt.isEmpty()) {
            if (manager.hasActiveCall()) {
                return;
            }
            tvCallStatus.setText("Đang kết nối...");
            manager.makeCall(targetExt);
        } else {
            tvCallStatus.setText("Không tìm thấy số máy nhánh");
        }
    }

    private void startCallTimer() {
        if (timerRunning) return;
        timerRunning = true;
        secondsElapsed = 0;
        callConnectedTimestamp = System.currentTimeMillis();
        tvCallStatus.setText("00:00");
        timerHandler.postDelayed(timerRunnable, 1000);
    }

    private void stopCallTimer() {
        timerRunning = false;
        timerHandler.removeCallbacks(timerRunnable);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            beginCallFlow();
        } else {
            closeInCallScreen();
        }
    }
}	 
 	 	 	 	 	 	 	 	 	chat	 	 
 	 	 	 	 	 	 	 	 	 	ChatDetailActivity.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.chat;


import android.os.Bundle;

import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;

import com.company.internalcall.data.api.WazoWebSocketManager;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.model.ChatMessage;

import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.ui.main.MainActivity;
import com.company.internalcall.ui.main.contact.MessageAdapter;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class ChatDetailActivity extends AppCompatActivity {
    private RecyclerView rvMessages;
    private EditText edtMessage;
    private Button btnSend;
    private ImageButton btnRoomDetail;
    private MessageAdapter adapter;
    private final List<ChatMessage> messages = new ArrayList<>();

    private SessionManager sessionManager;
    private String roomUuid;
    private String targetUuid;
    private String targetName;
    private String targetExten;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chat_detail);

        sessionManager = new SessionManager(this);

        targetName = getIntent().getStringExtra("TARGET_NAME");
        roomUuid = getIntent().getStringExtra("ROOM_UUID");
        targetUuid = getIntent().getStringExtra("TARGET_UUID");
        targetExten = getIntent().getStringExtra("TARGET_EXTEN");

        TextView tvTitle = findViewById(R.id.tvChatTitle);
        ImageButton btnCall = findViewById(R.id.btnCallFromChat);
        rvMessages = findViewById(R.id.rvMessages);
        edtMessage = findViewById(R.id.edtMessage);
        btnSend = findViewById(R.id.btnSend);
        btnRoomDetail = findViewById(R.id.btnRoomDetail);

        tvTitle.setText(targetName != null ? targetName : "Hội thoại");

        adapter = new MessageAdapter(messages);
        rvMessages.setLayoutManager(new LinearLayoutManager(this));
        rvMessages.setAdapter(adapter);

        // Nút gọi điện ngay trên góc phải màn hình chat
        btnCall.setOnClickListener(v -> {
            if (targetExten != null && !targetExten.isEmpty()) {
                // them call o day nhe ducky
            } else {
                Toast.makeText(this, "Liên hệ này chưa có số máy lẻ", Toast.LENGTH_SHORT).show();
            }
        });

        btnRoomDetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

            }
        });

        // Lắng nghe tin nhắn đến qua WebSocket
        WazoWebSocketManager.getInstance().setChatListener((incomingRoomUuid, senderUuid, senderName, content) -> {
            if (senderUuid != null && senderUuid.equals(sessionManager.getUserUuid())) {
                return;
            }
            if (roomUuid != null && !incomingRoomUuid.isEmpty() && !roomUuid.equals(incomingRoomUuid)) {
                return;
            }

            messages.add(new ChatMessage(content, false, senderName, ""));
            adapter.notifyItemInserted(messages.size() - 1);
            rvMessages.scrollToPosition(messages.size() - 1);
        });

        // Khởi tạo phòng chat hoặc tải lịch sử tin nhắn
        if (roomUuid != null && !roomUuid.isEmpty()) {
            loadRoomMessages();
        } else if (targetUuid != null && !targetUuid.isEmpty()) {
            createOrGetChatRoom(targetUuid);
        } else {
            // Nếu bấm từ danh bạ mà chưa có user_uuid, tự động tìm user_uuid theo tên/số máy lẻ
            resolveUserUuidAndCreateRoom();
        }

        btnSend.setOnClickListener(v -> sendMessage());
    }

    // 1. Tạo hoặc lấy phòng chat 1-1
    private void createOrGetChatRoom(String otherUserUuid) {
        btnSend.setEnabled(false);

        JsonObject body = new JsonObject();
        body.addProperty("name", targetName != null ? targetName : "Chat");

        JsonArray usersArray = new JsonArray();
        JsonObject otherUser = new JsonObject();
        otherUser.addProperty("uuid", otherUserUuid);
        usersArray.add(otherUser);
        body.add("users", usersArray);
        SessionManager sm = new SessionManager(this);
        final String token = sm.getToken();

        ApiClient.getService().createChatRoom(token, body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                btnSend.setEnabled(true);
                if (response.isSuccessful() && response.body() != null && response.body().has("uuid")) {
                    roomUuid = response.body().get("uuid").getAsString();
                    loadRoomMessages();
                } else {
                    Toast.makeText(ChatDetailActivity.this,
                            "Không tạo được phòng chat (Mã lỗi: " + response.code() + ")",
                            Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                btnSend.setEnabled(true);
                Toast.makeText(ChatDetailActivity.this, "Lỗi mạng khi tạo phòng chat: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    // Tìm user_uuid từ wazo-dird nếu liên hệ chưa có sẵn UUID
    private void resolveUserUuidAndCreateRoom() {
        String term = (targetExten != null && !targetExten.isEmpty()) ? targetExten : targetName;
        if (term == null || term.isEmpty()) return;

        SessionManager sm = new SessionManager(this);
        final String token = sm.getToken();
        ApiClient.getService().searchDirectory(token,"default", term).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null && response.body().has("results")) {
                    JsonArray results = response.body().getAsJsonArray("results");
                    for (JsonElement el : results) {
                        JsonObject obj = el.getAsJsonObject();
                        if (obj.has("relations") && obj.getAsJsonObject("relations").has("user_uuid")
                                && !obj.getAsJsonObject("relations").get("user_uuid").isJsonNull()) {
                            targetUuid = obj.getAsJsonObject("relations").get("user_uuid").getAsString();
                            createOrGetChatRoom(targetUuid);
                            return;
                        }
                    }
                }
                Toast.makeText(ChatDetailActivity.this,
                        "Liên hệ này không phải tài khoản Wazo nội bộ nên không thể chat",
                        Toast.LENGTH_LONG).show();
            }

            @Override public void onFailure(Call<JsonObject> call, Throwable t) {}
        });
    }

    // 2. Tải lịch sử tin nhắn: GET /api/chatd/1.0/users/me/rooms/{room_uuid}/messages
    private void loadRoomMessages() {
        SessionManager sm = new SessionManager(this);
        final String token = sm.getToken();
        ApiClient.getService().getRoomMessages(token, roomUuid).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null && response.body().has("items")) {
                    messages.clear();
                    JsonArray items = response.body().getAsJsonArray("items");
                    String myUuid = sessionManager.getUserUuid();

                    List<ChatMessage> loaded = new ArrayList<>();
                    for (JsonElement el : items) {
                        JsonObject msgObj = el.getAsJsonObject();
                        String content = msgObj.has("content") && !msgObj.get("content").isJsonNull()
                                ? msgObj.get("content").getAsString() : "";
                        String senderUuid = msgObj.has("user_uuid") && !msgObj.get("user_uuid").isJsonNull()
                                ? msgObj.get("user_uuid").getAsString() : "";
                        String senderName = msgObj.has("alias") && !msgObj.get("alias").isJsonNull()
                                ? msgObj.get("alias").getAsString() : "";
                        boolean isMe = myUuid != null && myUuid.equals(senderUuid);
                        String time = msgObj.has("created_at") && !msgObj.get("created_at").isJsonNull()
                                ? msgObj.get("created_at").getAsString() : "";
                        String timeStamp = time.replace('T', ' ').substring(0, 19);

                        loaded.add(new ChatMessage(content, isMe, senderName, timeStamp));
                    }
                    // API Wazo trả về tin nhắn mới nhất trước, cần đảo ngược lại để tin mới nhất nằm dưới cùng
                    Collections.reverse(loaded);
                    messages.addAll(loaded);
                    adapter.notifyDataSetChanged();
                    if (!messages.isEmpty()) {
                        rvMessages.scrollToPosition(messages.size() - 1);
                    }
                }
            }

            @Override public void onFailure(Call<JsonObject> call, Throwable t) {}
        });
    }

    // 3. Gửi tin nhắn: POST /api/chatd/1.0/users/me/rooms/{room_uuid}/messages
    private void sendMessage() {
        final String content = edtMessage.getText().toString().trim();
        if (content.isEmpty()) return;

        if (roomUuid == null || roomUuid.isEmpty()) {
            Toast.makeText(this, "Đang khởi tạo phòng chat, vui lòng đợi...", Toast.LENGTH_SHORT).show();
            if (targetUuid != null && !targetUuid.isEmpty()) {
                createOrGetChatRoom(targetUuid);
            }
            return;
        }

        LocalDateTime now = LocalDateTime.now();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        String formattedDateTime = now.format(formatter);

        messages.add(new ChatMessage(content, true, "", formattedDateTime));
        adapter.notifyItemInserted(messages.size() - 1);
        rvMessages.scrollToPosition(messages.size() - 1);
        edtMessage.setText("");


        JsonObject body = new JsonObject();
        body.addProperty("content", content);
        body.addProperty("alias", sessionManager.getSipUsername());
        SessionManager sm = new SessionManager(this);
        final String token = sm.getToken();
        ApiClient.getService().sendRoomMessage(token, roomUuid, body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (!response.isSuccessful()) {
                    Toast.makeText(ChatDetailActivity.this,
                            "Gửi tin nhắn thất bại (" + response.code() + ")",
                            Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                Toast.makeText(ChatDetailActivity.this,
                        "Lỗi kết nối khi gửi tin: " + t.getMessage(),
                        Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        WazoWebSocketManager.getInstance().setChatListener(null);
    }
}	 
 	 	 	 	 	 	 	 	 	login	 	 
 	 	 	 	 	 	 	 	 	 	LoginActivity.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.login;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.company.internalcall.R;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.dto.WazoAuthRequest;
import com.company.internalcall.data.remote.dto.WazoAuthResponse;
import com.company.internalcall.data.remote.dto.WazoSipEndpointResponse;
import com.company.internalcall.data.remote.dto.WazoUserDetailResponse;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.service.WazoSipCallManager;
import com.company.internalcall.ui.main.MainActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import okhttp3.Credentials;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LoginActivity extends AppCompatActivity {

    private static final String TAG = "LoginActivity";
    private SessionManager sessionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        sessionManager = new SessionManager(this);
        if (sessionManager.isLoggedIn() && sessionManager.getSavedUser() != null) {
            com.company.internalcall.service.WazoKeepAliveService.startIfLoggedIn(this);
            goToMain(sessionManager.getSavedUser());
            return;
        }

        final TextInputEditText etEmpCode = findViewById(R.id.etEmpCode);
        final TextInputEditText etPassword = findViewById(R.id.etPassword);
        final MaterialButton btnLogin = findViewById(R.id.btnLogin);

        btnLogin.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final String username = etEmpCode.getText() != null ? etEmpCode.getText().toString().trim() : "";
                final String password = etPassword.getText() != null ? etPassword.getText().toString().trim() : "";

                if (username.isEmpty() || password.isEmpty()) {
                    Toast.makeText(LoginActivity.this, "Nhập tài khoản và mật khẩu Wazo", Toast.LENGTH_SHORT).show();
                    return;
                }

                btnLogin.setEnabled(false);
                btnLogin.setText("Đang đăng nhập Wazo...");

                // Bước 1: Đăng nhập lấy token & xivo_user_uuid
                String basicAuth = Credentials.basic(username, password);
                WazoAuthRequest authRequest = new WazoAuthRequest(sessionManager.getDeviceClientId());
                ApiClient.getService().loginWazo(basicAuth, authRequest).enqueue(new Callback<WazoAuthResponse>() {
                    @Override
                    public void onResponse(@NonNull Call<WazoAuthResponse> call, @NonNull Response<WazoAuthResponse> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().data != null) {
                            String token = response.body().data.token;
                            String refreshToken = response.body().data.refreshToken;
                            String userUuid = response.body().data.uuid;
                            String currentSessionUuid = response.body().data.sessionUuid;

                            // Lưu refresh_token dài hạn (hoàn toàn không lưu mật khẩu người dùng)
                            sessionManager.saveRefreshToken(refreshToken);

                            // Thu hồi toàn bộ phiên đăng nhập & refresh token cũ trên thiết bị khác / Web
                            revokeOtherDevices(token, userUuid, currentSessionUuid, authRequest.clientId);

                            fetchUserProfile(token, userUuid, username, btnLogin);
                        } else {
                            resetLoginButton(btnLogin);
                            Toast.makeText(LoginActivity.this, "Sai tài khoản/mật khẩu (" + response.code() + ")", Toast.LENGTH_SHORT).show();
                        }
                    }

                    @Override
                    public void onFailure(@NonNull Call<WazoAuthResponse> call, @NonNull Throwable t) {
                        resetLoginButton(btnLogin);
                        Toast.makeText(LoginActivity.this, "Lỗi kết nối tới " + ApiClient.DEFAULT_HOST + ": " + t.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    /**
     * Đá văng các thiết bị cũ và trình duyệt Web đang đăng nhập cùng tài khoản này
     */
    private void revokeOtherDevices(final String newToken, final String userUuid, final String currentSessionUuid, final String currentClientId) {
        // 1. Xóa toàn bộ Session cũ (làm token hiện tại của máy cũ/web bị vô hiệu hóa 401 ngay lập tức)
        ApiClient.getService().getUserSessions(newToken, userUuid).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(@NonNull Call<JsonObject> call, @NonNull Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null && response.body().has("items")) {
                    JsonArray items = response.body().getAsJsonArray("items");
                    for (JsonElement el : items) {
                        JsonObject obj = el.getAsJsonObject();
                        String sUuid = obj.has("uuid") && !obj.get("uuid").isJsonNull() ? obj.get("uuid").getAsString() : "";
                        if (!sUuid.isEmpty() && !sUuid.equals(currentSessionUuid)) {
                            ApiClient.getService().deleteUserSession(newToken, userUuid, sUuid)
                                    .enqueue(new Callback<Void>() {
                                        @Override
                                        public void onResponse(@NonNull Call<Void> c, @NonNull Response<Void> r) {
                                            Log.d(TAG, "Đã thu hồi session cũ: " + sUuid + " -> code: " + r.code());
                                        }
                                        @Override
                                        public void onFailure(@NonNull Call<Void> c, @NonNull Throwable t) {}
                                    });
                        }
                    }
                }
            }

            @Override
            public void onFailure(@NonNull Call<JsonObject> call, @NonNull Throwable t) {}
        });

        // 2. Xóa toàn bộ Refresh Token cũ (ngăn máy cũ tự động xin cấp lại token mới)
        ApiClient.getService().getUserRefreshTokens(newToken, userUuid).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(@NonNull Call<JsonObject> call, @NonNull Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null && response.body().has("items")) {
                    JsonArray items = response.body().getAsJsonArray("items");
                    for (JsonElement el : items) {
                        JsonObject obj = el.getAsJsonObject();
                        String clientId = obj.has("client_id") && !obj.get("client_id").isJsonNull() ? obj.get("client_id").getAsString() : "";
                        if (!clientId.isEmpty() && !clientId.equals(currentClientId)) {
                            ApiClient.getService().deleteUserRefreshToken(newToken, userUuid, clientId)
                                    .enqueue(new Callback<Void>() {
                                        @Override
                                        public void onResponse(@NonNull Call<Void> c, @NonNull Response<Void> r) {
                                            Log.d(TAG, "Đã xóa refresh_token của client cũ: " + clientId);
                                        }
                                        @Override
                                        public void onFailure(@NonNull Call<Void> c, @NonNull Throwable t) {}
                                    });
                        }
                    }
                }
            }

            @Override
            public void onFailure(@NonNull Call<JsonObject> call, @NonNull Throwable t) {}
        });
    }

    // Bước 2: Lấy tên nhân viên, số máy nhánh (exten), lineId và sipUuid từ users/{user_uuid}
    private void fetchUserProfile(final String token, final String userUuid, final String username, final MaterialButton btnLogin) {
        btnLogin.setText("Đang tải thông tin máy nhánh...");

        ApiClient.getService().getMyProfile(token, userUuid).enqueue(new Callback<WazoUserDetailResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoUserDetailResponse> call, @NonNull Response<WazoUserDetailResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    WazoUserDetailResponse detail = response.body();
                    String exten = detail.getPrimaryExtension();
                    int myLineId = detail.getPrimaryLineId();
                    String sipUuid = detail.getPrimarySipUuid();

                    UserContact currentUser = new UserContact(
                            userUuid,
                            username,
                            detail.getFullName(),
                            exten,
                            "Wazo Internal",
                            true
                    );

                    sessionManager.saveUserSession(token, userUuid, currentUser);

                    if (myLineId > 0) {
                        fetchSipCredentialsAndEnterMain(token, userUuid, myLineId, sipUuid, currentUser, btnLogin);
                    } else {
                        resetLoginButton(btnLogin);
                        Toast.makeText(LoginActivity.this, "Tài khoản chưa được gán Line", Toast.LENGTH_SHORT).show();
                        goToMain(currentUser);
                    }
                } else {
                    resetLoginButton(btnLogin);
                    Toast.makeText(LoginActivity.this, "Không lấy được thông tin máy nhánh (" + response.code() + ")", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(@NonNull Call<WazoUserDetailResponse> call, @NonNull Throwable t) {
                resetLoginButton(btnLogin);
                Toast.makeText(LoginActivity.this, "Lỗi tải profile: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    // Bước 3: Lấy SIP username & password qua endpoint chuẩn của Wazo
    private void fetchSipCredentialsAndEnterMain(final String token, final String userUuid, final int lineId,
                                                 final String sipUuid, final UserContact currentUser, final MaterialButton btnLogin) {
        btnLogin.setText("Đang kết nối kênh thoại SIP...");

        ApiClient.getService().getUserLineSipEndpoint(token, userUuid, lineId)
                .enqueue(new Callback<WazoSipEndpointResponse.SipAuthDetail>() {
                    @Override
                    public void onResponse(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> call2,
                                           @NonNull Response<WazoSipEndpointResponse.SipAuthDetail> res2) {
                        if (res2.isSuccessful() && res2.body() != null) {
                            resetLoginButton(btnLogin);
                            String sipUser = res2.body().getUsername();
                            String sipPass = res2.body().getPassword();
                            sessionManager.saveSipCredentials(sipUser, sipPass);
                            WazoSipCallManager.getInstance().initAndRegister(LoginActivity.this, sipUser, sipPass);
                            goToMain(currentUser);
                        } else if (!sipUuid.isEmpty()) {
                            ApiClient.getService().getSipEndpointDetail(token, sipUuid)
                                    .enqueue(new Callback<WazoSipEndpointResponse.SipAuthDetail>() {
                                        @Override
                                        public void onResponse(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> call3,
                                                               @NonNull Response<WazoSipEndpointResponse.SipAuthDetail> res3) {
                                            resetLoginButton(btnLogin);
                                            if (res3.isSuccessful() && res3.body() != null) {
                                                String sipUser = res3.body().getUsername();
                                                String sipPass = res3.body().getPassword();
                                                sessionManager.saveSipCredentials(sipUser, sipPass);
                                                WazoSipCallManager.getInstance().initAndRegister(LoginActivity.this, sipUser, sipPass);
                                            } else {
                                                Toast.makeText(LoginActivity.this, "Lỗi đọc SIP endpoint (" + res2.code() + "/" + res3.code() + ")", Toast.LENGTH_LONG).show();
                                            }
                                            goToMain(currentUser);
                                        }

                                        @Override
                                        public void onFailure(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> call3, @NonNull Throwable t) {
                                            resetLoginButton(btnLogin);
                                            goToMain(currentUser);
                                        }
                                    });
                        } else {
                            resetLoginButton(btnLogin);
                            Toast.makeText(LoginActivity.this, "Lỗi đọc SIP endpoint (" + res2.code() + ")", Toast.LENGTH_LONG).show();
                            goToMain(currentUser);
                        }
                    }

                    @Override
                    public void onFailure(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> call2, @NonNull Throwable t) {
                        resetLoginButton(btnLogin);
                        goToMain(currentUser);
                    }
                });
    }

    private void resetLoginButton(MaterialButton btnLogin) {
        btnLogin.setEnabled(true);
        btnLogin.setText("Đăng nhập & Kết nối tổng đài");
    }

    private void goToMain(UserContact currentUser) {
        Intent intent = new Intent(LoginActivity.this, MainActivity.class);
        intent.putExtra("USER_DATA", currentUser);
        startActivity(intent);
        finish();
    }
}	 
 	 	 	 	 	 	 	 	 	main	 	 
 	 	 	 	 	 	 	 	 	 	contact	 
 	 	 	 	 	 	 	 	 	 	 	ChatsFragment.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.ui.chat.ChatDetailActivity;
import com.company.internalcall.ui.main.MainActivity;
import com.google.android.material.floatingactionbutton.FloatingActionButton;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.List;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ChatsFragment extends Fragment {
    private ContactChatAdapter adapter;
    private final List<ContactChatItem> chatRooms = new ArrayList<>();
    private SessionManager sessionManager;
    private RecyclerView rvChats;
    private EditText edtSearchChat;
    private FloatingActionButton fabCreateGroup;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_chats, container, false);

        sessionManager = new SessionManager(requireContext());

        rvChats = view.findViewById(R.id.recyclerViewChats);
        edtSearchChat = view.findViewById(R.id.edtSearchChat);
        fabCreateGroup = view.findViewById(R.id.fabCreateGroup);

        rvChats.setLayoutManager(new LinearLayoutManager(requireContext()));

        adapter = new ContactChatAdapter(new ContactChatAdapter.OnContactActionListener() {
            @Override
            public void onCallClick(ContactChatItem item) {
                if (!item.getPhoneNumber().isEmpty()) {
                    if (getActivity() instanceof MainActivity) {
                        ((MainActivity) getActivity()).startInternalCall(
                                item.getDisplayName(),
                                item.getPhoneNumber(),
                                item.getDisplayName()
                        );
                    }
                }
            }

            @Override
            public void onChatClick(ContactChatItem item) {
                Intent intent = new Intent(requireContext(), ChatDetailActivity.class);
                intent.putExtra("TARGET_NAME", item.getDisplayName());
                intent.putExtra("ROOM_UUID", item.id);
                intent.putExtra("TARGET_UUID", item.uuid);
                intent.putExtra("TARGET_EXTEN", item.getPhoneNumber());
                startActivity(intent);
            }
        });
        rvChats.setAdapter(adapter);

        // Xử lý sự kiện tìm kiếm real-time khi nhập text
        edtSearchChat.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                onSearchQuery(s.toString());
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });


        fabCreateGroup.setOnClickListener(v -> {


        });

        loadMyChatRooms();
        return view;
    }

    @Override
    public void onResume() {
        super.onResume();
        loadMyChatRooms();
    }

    @Override
    public void onHiddenChanged(boolean hidden) {
        super.onHiddenChanged(hidden);
        if (!hidden) {
            loadMyChatRooms();
        }
    }

    public void onSearchQuery(String query) {
        if (!isAdded() || adapter == null) return;
        List<ContactChatItem> filtered = new ArrayList<>();
        for (ContactChatItem item : chatRooms) {
            if (item.getDisplayName().toLowerCase().contains(query.toLowerCase())
                    || item.getPhoneNumber().contains(query)) {
                filtered.add(item);
            }
        }
        adapter.submitList(filtered);
    }

    private void loadMyChatRooms() {
        if (sessionManager == null || getActivity() == null) return;
        final String token = sessionManager.getToken();
        ApiClient.getService().getMyChatRooms(token).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (!isAdded()) return;
                if (response.isSuccessful() && response.body() != null && response.body().has("items")) {
                    chatRooms.clear();
                    String myUuid = sessionManager.getUserUuid();
                    JsonArray rooms = response.body().getAsJsonArray("items");

                    for (JsonElement el : rooms) {
                        JsonObject room = el.getAsJsonObject();
                        ContactChatItem item = new ContactChatItem();
                        item.id = room.has("uuid") && !room.get("uuid").isJsonNull()
                                ? room.get("uuid").getAsString() : "";

                        String roomName = room.has("name") && !room.get("name").isJsonNull()
                                ? room.get("name").getAsString() : "";

                        if (room.has("users") && room.get("users").isJsonArray()) {
                            JsonArray users = room.getAsJsonArray("users");
                            for (JsonElement uEl : users) {
                                JsonObject uObj = uEl.getAsJsonObject();
                                if (uObj.has("uuid") && !uObj.get("uuid").isJsonNull()) {
                                    String uUuid = uObj.get("uuid").getAsString();
                                    if (!uUuid.equals(myUuid)) {
                                        item.uuid = uUuid;
                                        break;
                                    }
                                }
                            }
                        }

                        item.firstname = !roomName.isEmpty() ? roomName : "Phòng chat";
                        item.exten = item.id.length() > 8 ? "Phòng #" + item.id.substring(0, 6) : "Hội thoại";
                        chatRooms.add(item);
                    }
                    if (adapter != null) {
                        String currentQuery = edtSearchChat != null ? edtSearchChat.getText().toString() : "";
                        if (!currentQuery.isEmpty()) {
                            onSearchQuery(currentQuery);
                        } else {
                            adapter.submitList(new ArrayList<>(chatRooms));
                        }
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {}
        });
    }
}
 	 	 	 	 	 	 	 	 	 	 	ContactAdapter.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.domain.model.UserContact;

import java.util.List;

public class ContactAdapter extends RecyclerView.Adapter<ContactAdapter.ViewHolder> {

    public interface OnContactCallListener {
        void onCallClick(UserContact contact);
        void onChatClick(UserContact contact);

        default void onFavoriteToggle(UserContact contact, int position) {}
    }

    private List<UserContact> items;
    private final OnContactCallListener listener;

    // Cờ phân biệt màn hình Danh bạ Yêu thích (true) và màn hình Tìm kiếm (false)
    private boolean isFavoriteScreenMode = false;
    // Lưu vị trí dòng đang mở nút Xóa
    private int revealedDeletePosition = RecyclerView.NO_POSITION;

    public ContactAdapter(List<UserContact> items, OnContactCallListener listener) {
        this.items = items;
        this.listener = listener;
    }

    public void setFavoriteScreenMode(boolean favoriteScreenMode) {
        this.isFavoriteScreenMode = favoriteScreenMode;
    }

    public void updateList(List<UserContact> newItems) {
        this.items = newItems;
        this.revealedDeletePosition = RecyclerView.NO_POSITION;
        notifyDataSetChanged();
    }

    public static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvAvatar, tvName, tvSub;
        ImageButton btnCall, btnFavorite, btnChat;
        View btnDeleteFavorite;
        public ViewHolder(View view) {
            super(view);
            tvAvatar = view.findViewById(R.id.tvContactAvatar);
            tvName = view.findViewById(R.id.tvContactName);
            tvSub = view.findViewById(R.id.tvContactSub);
            btnCall = view.findViewById(R.id.btnCallContact);
            btnChat = view.findViewById(R.id.btnChatContact);
            btnFavorite = view.findViewById(R.id.btnFavorite);
            btnDeleteFavorite = view.findViewById(R.id.btnDeleteFavorite);
        }
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_contact, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public int getItemCount() {
        return items != null ? items.size() : 0;
    }

    @Override
    public void onBindViewHolder(@NonNull final ViewHolder holder, int position) {
        final UserContact contact = items.get(position);
        String fullName = contact.getFullName();
        String initial = fullName.isEmpty() ? "?" : fullName.substring(fullName.length() - 1).toUpperCase();

        holder.tvAvatar.setText(initial);
        holder.tvName.setText(fullName);
        holder.tvSub.setText("Số: " + contact.getExtension() + " (" + contact.getDepartment() + ")");

        if (isFavoriteScreenMode) {
            // 1. Chế độ Màn hình Danh bạ: Ẩn ngôi sao, chỉ hiện nút Gọi; click vào item sẽ trượt nút Xóa ra
            if (holder.btnFavorite != null) {
                holder.btnFavorite.setVisibility(View.GONE);
            }

            boolean isRevealed = (position == revealedDeletePosition);
            if (holder.btnDeleteFavorite != null) {
                if (isRevealed) {
                    holder.btnDeleteFavorite.setVisibility(View.VISIBLE);
                    holder.btnDeleteFavorite.setTranslationX(120f);
                    holder.btnDeleteFavorite.setAlpha(0f);
                    holder.btnDeleteFavorite.animate()
                            .translationX(0f)
                            .alpha(1f)
                            .setDuration(220)
                            .setInterpolator(new DecelerateInterpolator())
                            .start();
                } else {
                    holder.btnDeleteFavorite.animate().cancel();
                    holder.btnDeleteFavorite.setVisibility(View.GONE);
                    holder.btnDeleteFavorite.setTranslationX(0f);
                    holder.btnDeleteFavorite.setAlpha(1f);
                }

                holder.btnDeleteFavorite.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        int currentPos = holder.getAdapterPosition();
                        if (currentPos != RecyclerView.NO_POSITION && listener != null) {
                            revealedDeletePosition = RecyclerView.NO_POSITION;
                            listener.onFavoriteToggle(contact, currentPos);
                        }
                    }
                });
            }

            // Bấm vào dòng liên hệ để bật/tắt trượt nút Xóa bên phải
            holder.itemView.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    int currentPos = holder.getAdapterPosition();
                    if (currentPos == RecyclerView.NO_POSITION) return;

                    int prevPos = revealedDeletePosition;
                    if (revealedDeletePosition == currentPos) {
                        revealedDeletePosition = RecyclerView.NO_POSITION;
                        notifyItemChanged(currentPos);
                    } else {
                        revealedDeletePosition = currentPos;
                        if (prevPos != RecyclerView.NO_POSITION) {
                            notifyItemChanged(prevPos);
                        }
                        notifyItemChanged(currentPos);
                    }
                }
            });

        } else {
            // 2. Chế độ Màn hình Tìm kiếm: Hiện ngôi sao để tích/bỏ tích Favorite, ẩn nút Xóa
            if (holder.btnDeleteFavorite != null) {
                holder.btnDeleteFavorite.setVisibility(View.GONE);
            }
            holder.itemView.setOnClickListener(null);
            holder.itemView.setClickable(false);

            if (holder.btnFavorite != null) {
                holder.btnFavorite.setVisibility(View.VISIBLE);
                holder.btnFavorite.setImageResource(contact.isFavorite()
                        ? R.drawable.ic_person_added
                        : R.drawable.ic_person_add);

                holder.btnFavorite.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        if (listener != null) {
                            int currentPos = holder.getAdapterPosition();
                            if (currentPos != RecyclerView.NO_POSITION) {
                                listener.onFavoriteToggle(contact, currentPos);
                            }
                        }
                    }
                });
            }
        }

        // Trạng thái Online/Offline của nút Gọi
        final boolean isOnline = contact.isOnline();
        if (isOnline) {
            holder.btnCall.setBackgroundResource(R.drawable.bg_circle_green);
            holder.btnCall.setEnabled(true);
            holder.btnCall.setAlpha(1.0f);
        } else {
            holder.btnCall.setBackgroundResource(R.drawable.bg_circle_grey);
            holder.btnCall.setEnabled(false);
            holder.btnCall.setAlpha(0.5f);
        }

        holder.btnCall.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (isOnline && listener != null) {
                    listener.onCallClick(contact);
                }
            }
        });

        holder.btnChat.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (listener != null) {
                    listener.onChatClick(contact);
                }
            }
        });
    }
}
 	 	 	 	 	 	 	 	 	 	 	ContactChatAdapter.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;

import java.util.ArrayList;
import java.util.List;

public class ContactChatAdapter extends RecyclerView.Adapter<ContactChatAdapter.ViewHolder> {
    public interface OnContactActionListener {
        void onCallClick(ContactChatItem item);
        void onChatClick(ContactChatItem item);
    }

    private final List<ContactChatItem> items = new ArrayList<>();
    private final OnContactActionListener listener;

    public ContactChatAdapter(OnContactActionListener listener) {
        this.listener = listener;
    }

    public void submitList(List<ContactChatItem> newItems) {
        items.clear();
        items.addAll(newItems);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_chat_contact, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        ContactChatItem item = items.get(position);
        String name = item.getDisplayName();
      //  holder.tvAvatar.setText(name.isEmpty() ? "U" : name.substring(0, 1).toUpperCase());
        holder.tvName.setText(name);
        holder.tvExten.setText("Số nội bộ: " + item.getPhoneNumber());

        holder.btnCall.setOnClickListener(v -> listener.onCallClick(item));
        holder.layout.setOnClickListener(v -> listener.onChatClick(item));
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvAvatar, tvName, tvExten;
        ImageButton btnChat, btnCall;
        LinearLayout layout;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvAvatar = itemView.findViewById(R.id.tvAvatar);
            tvName = itemView.findViewById(R.id.tvContactName);
            tvExten = itemView.findViewById(R.id.tvContactExten);
            btnChat = itemView.findViewById(R.id.btnChatContact);
            btnCall = itemView.findViewById(R.id.btnCallContact);
            layout = itemView.findViewById(R.id.layout);
        }
    }
}
 	 	 	 	 	 	 	 	 	 	 	ContactChatItem.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import com.google.gson.annotations.SerializedName;

public class ContactChatItem {
    @SerializedName("id")
    public String id;
    @SerializedName("uuid")
    public String uuid;
    @SerializedName("firstname")
    public String firstname;
    @SerializedName("lastname")
    public String lastname;
    @SerializedName("exten")
    public String exten;
    @SerializedName("number")
    public String number;
    @SerializedName("email")
    public String email;

    public String getDisplayName() {
        String full = ((firstname != null ? firstname : "") + " " + (lastname != null ? lastname : "")).trim();
        return full.isEmpty() ? (exten != null ? exten : "Không tên") : full;
    }

    public String getPhoneNumber() {
        if (exten != null && !exten.isEmpty()) return exten;
        return number != null ? number : "";
    }
}
 	 	 	 	 	 	 	 	 	 	 	ContactFragment.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.data.local.ContactCache;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.DirectoryMapper;
import com.company.internalcall.data.remote.dto.WazoDirectoryResponse;
import com.company.internalcall.data.remote.dto.WazoPresencesResponse;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.ui.call.GroupParticipantPickerSheet;
import com.company.internalcall.ui.main.MainActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ContactFragment extends Fragment {

    private static final String DEFAULT_PROFILE = "default";
    private static final long REFRESH_INTERVAL_MS = 60 * 1000;

    private EditText etSearch;
    private ContactAdapter adapter;
    private final List<UserContact> displayedList = new ArrayList<>();
    private final Set<String> favoriteExtSet = new HashSet<>();

    private String defaultSourceName = "wazo";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable searchRunnable;
    private Runnable refreshRunnable;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_contact, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        etSearch = view.findViewById(R.id.etSearchContact);
        Button btnStartGroupCall = view.findViewById(R.id.btnStartGroupCall);
        RecyclerView rvContacts = view.findViewById(R.id.rvContacts);

        etSearch.setFocusableInTouchMode(true);
        etSearch.setFocusable(true);
        etSearch.setClickable(true);
        etSearch.setHint("Tìm kiếm theo tên hoặc số máy nhánh...");

        if (btnStartGroupCall != null) {
            btnStartGroupCall.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    GroupParticipantPickerSheet.show(
                            requireContext(),
                            "Tạo cuộc gọi nhóm mới",
                            "Bắt đầu gọi nhóm",
                            2,
                            Collections.<String>emptyList(),
                            new GroupParticipantPickerSheet.OnParticipantsSelectedListener() {
                                @Override
                                public void onSelected(List<String> selectedExtensions) {
                                    if (getActivity() instanceof MainActivity) {
                                        ((MainActivity) getActivity()).startInternalGroupCall(
                                                new ArrayList<>(selectedExtensions)
                                        );
                                    }
                                }
                            }
                    );
                }
            });
        }

        adapter = new ContactAdapter(displayedList, new ContactAdapter.OnContactCallListener() {
            @Override
            public void onCallClick(UserContact contact) {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalCall(
                            contact.getFullName(),
                            contact.getEmpCode(),
                            contact.getExtension()
                    );
                }
            }

            @Override
            public void onChatClick(UserContact contact) {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalChat(
                            contact.getFullName(),
                            contact.getUuid(),
                            contact.getExtension()
                    );
                }
            }

            @Override
            public void onFavoriteToggle(UserContact contact, int position) {
                toggleFavorite(contact);
            }
        });

        rvContacts.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvContacts.setAdapter(adapter);

        etSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable s) {
                if (searchRunnable != null) {
                    handler.removeCallbacks(searchRunnable);
                }
                final String term = s != null ? s.toString().trim() : "";
                searchRunnable = new Runnable() {
                    @Override
                    public void run() {
                        performWazoLookup(term.isEmpty() ? "1" : term);
                    }
                };
                handler.postDelayed(searchRunnable, 300);
            }
        });

        refreshRunnable = new Runnable() {
            @Override
            public void run() {
                syncFavoritesAndSearch();
                handler.postDelayed(this, REFRESH_INTERVAL_MS);
            }
        };
    }

    @Override
    public void onResume() {
        super.onResume();
        syncFavoritesAndSearch();
        handler.postDelayed(refreshRunnable, REFRESH_INTERVAL_MS);
    }

    @Override
    public void onPause() {
        super.onPause();
        handler.removeCallbacks(refreshRunnable);
    }

    private void syncFavoritesAndSearch() {
        final SessionManager session = new SessionManager(requireContext());
        final String token = session.getToken();
        final String myUuid = session.getUserUuid();

        ApiClient.getService().getFavoriteContacts(token, DEFAULT_PROFILE).enqueue(new Callback<WazoDirectoryResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoDirectoryResponse> call, @NonNull Response<WazoDirectoryResponse> response) {
                if (!isAdded()) return;
                if (response.code() == 401) {
                    session.forceLogoutOnTokenExpired();
                    return;
                }
                favoriteExtSet.clear();
                if (response.isSuccessful() && response.body() != null) {
                    List<UserContact> favs = DirectoryMapper.mapFromDirectoryResponse(response.body(), myUuid, true);
                    for (UserContact f : favs) {
                        favoriteExtSet.add(f.getExtension());
                        if (f.getSource() != null && !f.getSource().isEmpty()) {
                            defaultSourceName = f.getSource();
                        }
                    }
                }
                String currentTerm = (etSearch != null && etSearch.getText() != null) ? etSearch.getText().toString().trim() : "";
                performWazoLookup(currentTerm.isEmpty() ? "1" : currentTerm);
            }

            @Override
            public void onFailure(@NonNull Call<WazoDirectoryResponse> call, @NonNull Throwable t) {
                if (!isAdded()) return;
                String currentTerm = (etSearch != null && etSearch.getText() != null) ? etSearch.getText().toString().trim() : "";
                performWazoLookup(currentTerm.isEmpty() ? "1" : currentTerm);
            }
        });
    }

    private void performWazoLookup(final String term) {
        final SessionManager session = new SessionManager(requireContext());
        final String token = session.getToken();
        final String myUuid = session.getUserUuid();

        ApiClient.getService().lookupContacts(token, DEFAULT_PROFILE, term).enqueue(new Callback<WazoDirectoryResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoDirectoryResponse> call, @NonNull Response<WazoDirectoryResponse> response) {
                if (!isAdded()) return;
                if (response.code() == 401) {
                    session.forceLogoutOnTokenExpired();
                    return;
                }
                if (response.isSuccessful() && response.body() != null) {
                    List<UserContact> lookupList = DirectoryMapper.mapFromDirectoryResponse(response.body(), myUuid, false);
                    for (UserContact c : lookupList) {
                        if (favoriteExtSet.contains(c.getExtension())) {
                            c.setFavorite(true);
                        }
                        if (c.getSource() != null && !c.getSource().isEmpty()) {
                            defaultSourceName = c.getSource();
                        }
                    }
                    fetchPresencesAndRender(token, lookupList);
                } else {
                    displayedList.clear();
                    adapter.updateList(displayedList);
                }
            }

            @Override
            public void onFailure(@NonNull Call<WazoDirectoryResponse> call, @NonNull Throwable t) {}
        });
    }

    private void fetchPresencesAndRender(String token, final List<UserContact> contacts) {
        List<String> uuids = new ArrayList<>();
        for (UserContact c : contacts) {
            if (c.getUuid() != null && !c.getUuid().isEmpty()) {
                uuids.add(c.getUuid());
            }
        }

        if (uuids.isEmpty()) {
            applyRenderedContacts(contacts);
            return;
        }

        ApiClient.getService().getBatchPresences(token, TextUtils.join(",", uuids)).enqueue(new Callback<WazoPresencesResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoPresencesResponse> call, @NonNull Response<WazoPresencesResponse> response) {
                if (!isAdded()) return;
                if (response.isSuccessful() && response.body() != null && response.body().items != null) {
                    Map<String, Boolean> map = new HashMap<>();
                    for (WazoPresencesResponse.PresenceItem p : response.body().items) {
                        boolean online = p.isLineOnline();
                        map.put(p.uuid, online);
                    }
                    for (UserContact c : contacts) {
                        if (map.containsKey(c.getUuid())) {
                            c.setOnline(map.get(c.getUuid()));
                        }
                    }
                }
                applyRenderedContacts(contacts);
            }

            @Override
            public void onFailure(@NonNull Call<WazoPresencesResponse> call, @NonNull Throwable t) {
                if (isAdded()) applyRenderedContacts(contacts);
            }
        });
    }

    private void applyRenderedContacts(List<UserContact> contacts) {
        Collections.sort(contacts, new Comparator<UserContact>() {
            @Override
            public int compare(UserContact a, UserContact b) {
                try {
                    return Integer.compare(Integer.parseInt(a.getExtension()), Integer.parseInt(b.getExtension()));
                } catch (Exception e) {
                    return a.getExtension().compareTo(b.getExtension());
                }
            }
        });

        ContactCache.setContacts(contacts);
        displayedList.clear();
        displayedList.addAll(contacts);
        adapter.updateList(displayedList);
    }

    private void toggleFavorite(final UserContact contact) {
        SessionManager session = new SessionManager(requireContext());
        final String token = session.getToken();
        final String directory = (contact.getSource() != null && !contact.getSource().isEmpty())
                ? contact.getSource() : defaultSourceName;
        final String contactId = (contact.getSourceEntryId() != null && !contact.getSourceEntryId().isEmpty())
                ? contact.getSourceEntryId() : contact.getUuid();

        if (contactId == null || contactId.isEmpty()) {
            Toast.makeText(requireContext(), "Không tìm thấy ID liên hệ", Toast.LENGTH_SHORT).show();
            return;
        }

        if (!contact.isFavorite()) {
            ApiClient.getService().addFavoriteContact(token, directory, contactId).enqueue(new Callback<Void>() {
                @Override
                public void onResponse(@NonNull Call<Void> call, @NonNull Response<Void> response) {
                    if (!isAdded()) return;
                    if (response.isSuccessful() || response.code() == 204) {
                        contact.setFavorite(true);
                        favoriteExtSet.add(contact.getExtension());
                        adapter.updateList(displayedList);
                        Toast.makeText(requireContext(), "Đã lưu vào Danh bạ", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(requireContext(), "Không thể thêm vào danh bạ (" + response.code() + ")", Toast.LENGTH_SHORT).show();
                    }
                }

                @Override
                public void onFailure(@NonNull Call<Void> call, @NonNull Throwable t) {
                    if (isAdded()) Toast.makeText(requireContext(), "Lỗi kết nối", Toast.LENGTH_SHORT).show();
                }
            });
        } else {
            ApiClient.getService().removeFavoriteContact(token, directory, contactId).enqueue(new Callback<Void>() {
                @Override
                public void onResponse(@NonNull Call<Void> call, @NonNull Response<Void> response) {
                    if (!isAdded()) return;
                    if (response.isSuccessful() || response.code() == 204) {
                        contact.setFavorite(false);
                        favoriteExtSet.remove(contact.getExtension());
                        adapter.updateList(displayedList);
                        Toast.makeText(requireContext(), "Đã bỏ khỏi Danh bạ", Toast.LENGTH_SHORT).show();
                    }
                }

                @Override
                public void onFailure(@NonNull Call<Void> call, @NonNull Throwable t) {}
            });
        }
    }
}
 	 	 	 	 	 	 	 	 	 	 	FavoriteFragment.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.DirectoryMapper;
import com.company.internalcall.data.remote.dto.WazoDirectoryResponse;
import com.company.internalcall.data.remote.dto.WazoPresencesResponse;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.ui.main.MainActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class FavoriteFragment extends Fragment {

    private static final String DEFAULT_PROFILE = "default";
    private static final long REFRESH_INTERVAL_MS = 60 * 1000;

    private EditText etSearch;
    private ContactAdapter adapter;
    private List<UserContact> favoriteMasterList = new ArrayList<>();
    private final List<UserContact> filteredList = new ArrayList<>();

    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private Runnable refreshRunnable;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_contact, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        etSearch = view.findViewById(R.id.etSearchContact);
        RecyclerView rvContacts = view.findViewById(R.id.rvContacts);

        etSearch.setHint("Tìm trong danh bạ...");

        adapter = new ContactAdapter(filteredList, new ContactAdapter.OnContactCallListener() {
            @Override
            public void onCallClick(UserContact contact) {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalCall(
                            contact.getFullName(),
                            contact.getEmpCode(),
                            contact.getExtension()
                    );
                }
            }

            @Override
            public void onChatClick(UserContact contact) {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalChat(
                            contact.getFullName(),
                            contact.getUuid(),
                            contact.getExtension()
                    );
                }
            }

            @Override
            public void onFavoriteToggle(UserContact contact, int position) {
                confirmAndRemoveFavorite(contact);
            }
        });

        adapter.setFavoriteScreenMode(true);

        rvContacts.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvContacts.setAdapter(adapter);

        etSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable s) {
                filterLocalFavorites(s != null ? s.toString() : "");
            }
        });

        refreshRunnable = new Runnable() {
            @Override
            public void run() {
                loadFavoritesFromWazo();
                refreshHandler.postDelayed(this, REFRESH_INTERVAL_MS);
            }
        };
    }

    @Override
    public void onResume() {
        super.onResume();
        loadFavoritesFromWazo();
        refreshHandler.postDelayed(refreshRunnable, REFRESH_INTERVAL_MS);
    }

    @Override
    public void onPause() {
        super.onPause();
        refreshHandler.removeCallbacks(refreshRunnable);
    }

    private void loadFavoritesFromWazo() {
        final SessionManager session = new SessionManager(requireContext());
        final String token = session.getToken();
        final String myUuid = session.getUserUuid();

        ApiClient.getService().getFavoriteContacts(token, DEFAULT_PROFILE).enqueue(new Callback<WazoDirectoryResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoDirectoryResponse> call, @NonNull Response<WazoDirectoryResponse> response) {
                if (!isAdded()) return;
                if (response.code() == 401) {
                    session.forceLogoutOnTokenExpired();
                    return;
                }
                if (response.isSuccessful() && response.body() != null) {
                    List<UserContact> list = DirectoryMapper.mapFromDirectoryResponse(response.body(), myUuid, true);
                    fetchPresences(token, list);
                }
            }

            @Override
            public void onFailure(@NonNull Call<WazoDirectoryResponse> call, @NonNull Throwable t) {}
        });
    }

    private void fetchPresences(String token, final List<UserContact> contacts) {
        List<String> uuids = new ArrayList<>();
        for (UserContact c : contacts) {
            if (c.getUuid() != null && !c.getUuid().isEmpty()) {
                uuids.add(c.getUuid());
            }
        }

        if (uuids.isEmpty()) {
            applyFavoriteList(contacts);
            return;
        }

        ApiClient.getService().getBatchPresences(token, TextUtils.join(",", uuids)).enqueue(new Callback<WazoPresencesResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoPresencesResponse> call, @NonNull Response<WazoPresencesResponse> response) {
                if (!isAdded()) return;
                if (response.isSuccessful() && response.body() != null && response.body().items != null) {
                    Map<String, Boolean> map = new HashMap<>();
                    for (WazoPresencesResponse.PresenceItem p : response.body().items) {
                        boolean online = p.isLineOnline();
                        map.put(p.uuid, online);
                    }
                    for (UserContact c : contacts) {
                        if (map.containsKey(c.getUuid())) {
                            c.setOnline(map.get(c.getUuid()));
                        }
                    }
                }
                applyFavoriteList(contacts);
            }

            @Override
            public void onFailure(@NonNull Call<WazoPresencesResponse> call, @NonNull Throwable t) {
                if (isAdded()) applyFavoriteList(contacts);
            }
        });
    }

    private void applyFavoriteList(List<UserContact> contacts) {
        Collections.sort(contacts, new Comparator<UserContact>() {
            @Override
            public int compare(UserContact a, UserContact b) {
                try {
                    return Integer.compare(Integer.parseInt(a.getExtension()), Integer.parseInt(b.getExtension()));
                } catch (Exception e) {
                    return a.getExtension().compareTo(b.getExtension());
                }
            }
        });
        favoriteMasterList = new ArrayList<>(contacts);
        String q = (etSearch != null && etSearch.getText() != null) ? etSearch.getText().toString() : "";
        filterLocalFavorites(q);
    }

    private void filterLocalFavorites(String query) {
        filteredList.clear();
        String q = query.trim().toLowerCase(Locale.ROOT);
        for (UserContact c : favoriteMasterList) {
            if (q.isEmpty()
                    || c.getFullName().toLowerCase(Locale.ROOT).contains(q)
                    || c.getExtension().toLowerCase(Locale.ROOT).contains(q)
                    || c.getEmpCode().toLowerCase(Locale.ROOT).contains(q)) {
                filteredList.add(c);
            }
        }
        adapter.updateList(filteredList);
    }

    private void confirmAndRemoveFavorite(final UserContact contact) {
        if (!isAdded()) return;
        new androidx.appcompat.app.AlertDialog.Builder(requireContext())
                .setTitle("Xóa khỏi danh bạ")
                .setMessage("Bạn có chắc muốn xóa " + contact.getFullName() + " (" + contact.getExtension() + ") khỏi danh bạ?")
                .setPositiveButton("Xóa", (dialog, which) -> removeFavorite(contact))
                .setNegativeButton("Hủy", (dialog, which) -> dialog.dismiss())
                .show();
    }
    private void removeFavorite(final UserContact contact) {
        SessionManager session = new SessionManager(requireContext());
        String token = session.getToken();

        ApiClient.getService().removeFavoriteContact(token, contact.getSource(), contact.getSourceEntryId())
                .enqueue(new Callback<Void>() {
                    @Override
                    public void onResponse(@NonNull Call<Void> call, @NonNull Response<Void> response) {
                        if (!isAdded()) return;
                        if (response.isSuccessful() || response.code() == 204) {
                            favoriteMasterList.remove(contact);
                            String q = (etSearch != null && etSearch.getText() != null) ? etSearch.getText().toString() : "";
                            filterLocalFavorites(q);
                            Toast.makeText(requireContext(), "Đã xóa khỏi danh bạ", Toast.LENGTH_SHORT).show();
                        }
                    }

                    @Override
                    public void onFailure(@NonNull Call<Void> call, @NonNull Throwable t) {}
                });
    }
}
 	 	 	 	 	 	 	 	 	 	 	MessageAdapter.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.contact;

import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.data.model.ChatMessage;

import java.util.List;

public class MessageAdapter extends RecyclerView.Adapter<MessageAdapter.MsgViewHolder> {
    private static final int TYPE_SENT = 1;
    private static final int TYPE_RECEIVED = 2;
    private final List<ChatMessage> list;

    public MessageAdapter(List<ChatMessage> list) {
        this.list = list;
    }

    @Override
    public int getItemViewType(int position) {
        return list.get(position).isSentByMe ? TYPE_SENT : TYPE_RECEIVED;
    }

    @NonNull
    @Override
    public MsgViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        boolean isSent = (viewType == TYPE_SENT);

        LinearLayout row = new LinearLayout(parent.getContext());
        row.setLayoutParams(new RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        row.setPadding(16, 8, 16, 8);
        row.setGravity(isSent ? Gravity.END : Gravity.START);

        LinearLayout messageContainer = new LinearLayout(parent.getContext());
        LinearLayout.LayoutParams containerParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        containerParams.width = LinearLayout.LayoutParams.WRAP_CONTENT;
        messageContainer.setLayoutParams(containerParams);
        messageContainer.setOrientation(LinearLayout.VERTICAL);
        messageContainer.setGravity(isSent ? Gravity.END : Gravity.START);

        TextView tvSenderName = new TextView(parent.getContext());
        tvSenderName.setText("Tên Người Gửi");
        tvSenderName.setTextSize(12f);
        tvSenderName.setTypeface(null, android.graphics.Typeface.BOLD);
        if (isSent) {
            tvSenderName.setVisibility(android.view.View.GONE);
        } else {
            tvSenderName.setTextColor(Color.parseColor("#222222"));
        }
        android.widget.LinearLayout.LayoutParams nameParams = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        );
        nameParams.gravity = isSent ? android.view.Gravity.END : android.view.Gravity.START;
        nameParams.setMargins(isSent ? 0 : 12, 0, isSent ? 12 : 0, 4);
        tvSenderName.setLayoutParams(nameParams);
        messageContainer.addView(tvSenderName);

        // bong bóng chat kk

        TextView bubble = new TextView(parent.getContext());
        bubble.setPadding(32, 20, 32, 20);
        bubble.setTextSize(15f);
        bubble.setTextColor(Color.parseColor("#111111"));

        android.graphics.drawable.GradientDrawable drawable = new android.graphics.drawable.GradientDrawable();
        drawable.setColor(isSent ? Color.parseColor("#D5F1FF") : Color.WHITE);

        float radius = 36f;
        if (isSent) {
            drawable.setCornerRadii(new float[]{radius, radius, radius, radius, 8f, 8f, radius, radius});
        } else {
            drawable.setCornerRadii(new float[]{radius, radius, radius, radius, radius, radius, 8f, 8f});

            drawable.setStroke(1, Color.parseColor("#E0E0E0"));
        }

        bubble.setBackground(drawable);

        android.widget.LinearLayout.LayoutParams paramscontent = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        );
        paramscontent.setMargins(16, 8, 16, 8);

        if (isSent) {
            paramscontent.gravity = android.view.Gravity.END;
        } else {
            paramscontent.gravity = android.view.Gravity.START;
        }

        bubble.setLayoutParams(paramscontent);
        messageContainer.addView(bubble);

        ////=== end bong bong

        TextView tvTime = new TextView(parent.getContext());
        tvTime.setText("02:12");
        tvTime.setTextSize(11f);
        tvTime.setTextColor(Color.parseColor("#8E8E93"));

        android.widget.LinearLayout.LayoutParams timeParams = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        );
        timeParams.gravity = isSent ? android.view.Gravity.END : android.view.Gravity.START;
        timeParams.setMargins(isSent ? 0 : 12, 2, isSent ? 12 : 0, 8);

        tvTime.setLayoutParams(timeParams);
        messageContainer.addView(tvTime);



        row.addView(messageContainer);

        return new MsgViewHolder(row, tvSenderName, bubble, tvTime);
    }

    @Override
    public void onBindViewHolder(@NonNull MsgViewHolder holder, int position) {
        ChatMessage message = list.get(position);

        holder.bubble.setText(message.content);

        holder.tvSenderName.setText(message.senderName != null ? message.senderName : "User");
        holder.tvTime.setText(message.timestamp != null ? message.timestamp : "");
    }

    @Override
    public int getItemCount() {
        return list.size();
    }

    static class MsgViewHolder extends RecyclerView.ViewHolder {
        TextView tvSenderName;
        TextView bubble;
        TextView tvTime;

        MsgViewHolder(@NonNull View itemView, TextView tvSenderName, TextView bubble, TextView tvTime) {
            super(itemView);
            this.tvSenderName = tvSenderName;
            this.bubble = bubble;
            this.tvTime = tvTime;
        }
    }
}
 	 	 	 	 	 	 	 	 	 	history	 
 	 	 	 	 	 	 	 	 	 	 	HistoryAdapter.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.history;

import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.domain.model.CallLogItem;
import com.company.internalcall.domain.model.CallType;

import java.util.List;

public class HistoryAdapter extends RecyclerView.Adapter<HistoryAdapter.ViewHolder> {

    public interface OnHistoryClickListener {
        void onHistoryClick(CallLogItem item);
    }

    private final List<CallLogItem> items;
    private final OnHistoryClickListener listener;

    public HistoryAdapter(List<CallLogItem> items, OnHistoryClickListener listener) {
        this.items = items;
        this.listener = listener;
    }

    public static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvName, tvSub, tvTime, tvDuration;
        ImageView  tvDirection;
        public ViewHolder(View view) {
            super(view);
            tvDirection = view.findViewById(R.id.tvCallDirection);
            tvName = view.findViewById(R.id.tvHistoryName);
            tvSub = view.findViewById(R.id.tvHistorySub);
            tvTime = view.findViewById(R.id.tvHistoryTime);
            tvDuration = view.findViewById(R.id.tvHistoryDuration);
        }
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_history, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        final CallLogItem item = items.get(position);
        boolean isMissed = item.getType() == CallType.MISSED;

        holder.tvName.setText(item.getContactName());
        holder.tvSub.setText("Số: " + item.getExtension());
        holder.tvTime.setText(item.getTimestamp());
        holder.tvDuration.setText(isMissed ? "Cuộc gọi nhỡ" : item.getDuration());

        if (item.getType() == CallType.INCOMING) {
            holder.tvDirection.setImageResource(R.drawable.ic_call_incoming);
        } else if (item.getType() == CallType.OUTGOING) {
            holder.tvDirection.setImageResource(R.drawable.ic_call_outgoing);
        } else {
            holder.tvDirection.setImageResource(R.drawable.ic_call_missed);
        }

        int color = isMissed ? Color.parseColor("#D32F2F") : Color.parseColor("#2E7D32");
        holder.tvName.setTextColor(isMissed ? color : Color.parseColor("#111827"));

        holder.itemView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                listener.onHistoryClick(item);
            }
        });
    }
}
