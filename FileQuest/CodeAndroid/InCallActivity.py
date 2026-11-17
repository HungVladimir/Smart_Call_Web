
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