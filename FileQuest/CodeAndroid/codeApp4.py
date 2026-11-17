 	 	 	 	 	 	 	 	 	 	 	HistoryFragment.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main.history;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.company.internalcall.R;
import com.company.internalcall.data.local.ContactCache;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.dto.WazoCdrResponse;
import com.company.internalcall.domain.model.CallLogItem;
import com.company.internalcall.domain.model.CallType;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.ui.main.MainActivity;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.floatingactionbutton.FloatingActionButton;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class HistoryFragment extends Fragment {

    public static final String ACTION_CALL_HISTORY_UPDATED = "com.company.internalcall.ACTION_CALL_HISTORY_UPDATED";

    private RecyclerView rvHistory;
    private String myExtension = "";
    private SessionManager sessionManager;

    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private final Runnable delayedReloadRunnable = new Runnable() {
        @Override
        public void run() {
            if (isAdded() && sessionManager != null) {
                loadCallHistoryFromWazo(sessionManager.getToken(), 2);
            }
        }
    };

    private final BroadcastReceiver historyUpdateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            scheduleHistoryRefresh(900);
        }
    };

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_history, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        sessionManager = new SessionManager(requireContext());
        myExtension = sessionManager.getCurrentUser().getExtension();

        rvHistory = view.findViewById(R.id.rvHistory);
        rvHistory.setLayoutManager(new LinearLayoutManager(requireContext()));

        // Khởi tạo danh sách trống ngay từ đầu (để trắng tới khi tải xong data thật)
        bindToRecyclerView(new ArrayList<CallLogItem>());

        FloatingActionButton fabOpenDialpad = view.findViewById(R.id.fabOpenDialpad);
        fabOpenDialpad.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showDialpadBottomSheet();
            }
        });

        // Gọi API với cơ chế tự thử lại tối đa 2 lần nếu gặp lỗi SSL chập chờn
        loadCallHistoryFromWazo(sessionManager.getToken(), 2);
    }

    @Override
    public void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(ACTION_CALL_HISTORY_UPDATED);
        requireContext().registerReceiver(historyUpdateReceiver, filter);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Tự động làm mới lịch sử mỗi khi quay lại tab Lịch sử hoặc vừa đóng màn hình cuộc gọi (InCallActivity)
        // Trì hoãn 900ms để Wazo call-logd kịp ghi xong bản ghi CDR mới nhất
        scheduleHistoryRefresh(900);
    }

    @Override
    public void onStop() {
        super.onStop();
        try {
            requireContext().unregisterReceiver(historyUpdateReceiver);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        refreshHandler.removeCallbacks(delayedReloadRunnable);
    }

    private void scheduleHistoryRefresh(long delayMs) {
        refreshHandler.removeCallbacks(delayedReloadRunnable);
        refreshHandler.postDelayed(delayedReloadRunnable, delayMs);
    }

    private void loadCallHistoryFromWazo(final String wazoToken, final int retriesLeft) {
        if (wazoToken == null || wazoToken.isEmpty()) return;

        ApiClient.getService().getWazoCallHistory(wazoToken, 50).enqueue(new Callback<WazoCdrResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoCdrResponse> call, @NonNull Response<WazoCdrResponse> response) {
                if (!isAdded()) return;
                if (response.isSuccessful() && response.body() != null && response.body().getItems() != null) {
                    bindToRecyclerView(mapCdrToCallLogItems(response.body().getItems()));
                } else if (response.code() == 401 && sessionManager != null) {
                    sessionManager.forceLogoutOnTokenExpired(new Runnable() {
                        @Override
                        public void run() {
                            if (isAdded()) {
                                loadCallHistoryFromWazo(sessionManager.getToken(), 1);
                            }
                        }
                    });
                }
            }

            @Override
            public void onFailure(@NonNull Call<WazoCdrResponse> call, @NonNull Throwable t) {
                if (!isAdded()) return;
                if (retriesLeft > 0) {
                    loadCallHistoryFromWazo(wazoToken, retriesLeft - 1);
                }
            }
        });
    }

    private List<CallLogItem> mapCdrToCallLogItems(List<WazoCdrResponse.CdrItem> cdrItems) {
        List<CallLogItem> result = new ArrayList<>();
        for (WazoCdrResponse.CdrItem cdr : cdrItems) {
            boolean isOutgoing = !myExtension.isEmpty() && myExtension.equals(cdr.getSourceExtension());
            boolean isInbound = !isOutgoing;

            String peerExtension = isOutgoing ? cdr.getDestinationExtension() : cdr.getSourceExtension();
            String wazoPeerName = isOutgoing ? cdr.getDestinationName() : cdr.getSourceName();

            UserContact matchedUser = ContactCache.findByExtension(peerExtension);
            String displayName;
            if (matchedUser != null && !matchedUser.getFullName().isEmpty()) {
                displayName = matchedUser.getFullName();
            } else if (!wazoPeerName.isEmpty()) {
                displayName = wazoPeerName;
            } else {
                displayName = "Số nội bộ " + peerExtension;
            }

            String empCode = (matchedUser != null) ? matchedUser.getEmpCode() : peerExtension;

            CallType callType;
            if (!cdr.isAnswered() && isInbound) {
                callType = CallType.MISSED;
            } else if (isInbound) {
                callType = CallType.INCOMING;
            } else {
                callType = CallType.OUTGOING;
            }

            int totalSec = cdr.getDurationSeconds();
            String durationFormatted = String.format(Locale.getDefault(), "%02d:%02d", totalSec / 60, totalSec % 60);
            String timeFormatted = formatIsoTime(cdr.getStartTime());

            result.add(new CallLogItem(
                    String.valueOf(cdr.getId()),
                    displayName,
                    empCode,
                    peerExtension,
                    callType,
                    timeFormatted,
                    durationFormatted
            ));
        }
        return result;
    }

    private String formatIsoTime(String isoString) {
        if (isoString == null || isoString.isEmpty()) return "";
        int tIndex = isoString.indexOf('T');
        if (tIndex != -1 && isoString.length() >= tIndex + 6) {
            return isoString.substring(tIndex + 1, tIndex + 6);
        }
        return isoString;
    }

    private void bindToRecyclerView(List<CallLogItem> list) {
        HistoryAdapter adapter = new HistoryAdapter(list, new HistoryAdapter.OnHistoryClickListener() {
            @Override
            public void onHistoryClick(CallLogItem item) {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalCall(
                            item.getContactName(),
                            item.getEmpCode(),
                            item.getExtension()
                    );
                }
            }
        });
        rvHistory.setAdapter(adapter);
    }

    private void showDialpadBottomSheet() {
        final BottomSheetDialog dialog = new BottomSheetDialog(requireContext());
        View sheetView = LayoutInflater.from(requireContext()).inflate(R.layout.bottom_sheet_dialpad, null);
        dialog.setContentView(sheetView);

        final TextView tvDialedNumber = sheetView.findViewById(R.id.tvDialedNumber);
        final TextView tvMatchedContact = sheetView.findViewById(R.id.tvMatchedContact);
        final ImageButton btnBackspace = sheetView.findViewById(R.id.btnBackspace);
        ImageButton btnDialCall = sheetView.findViewById(R.id.btnDialCall);

        final StringBuilder numberBuilder = new StringBuilder();

        final Runnable updateDisplay = new Runnable() {
            @Override
            public void run() {
                String current = numberBuilder.toString();
                tvDialedNumber.setText(current);
                btnBackspace.setVisibility(current.isEmpty() ? View.INVISIBLE : View.VISIBLE);

                if (!current.isEmpty()) {
                    UserContact matched = ContactCache.findByExtension(current);
                    if (matched != null) {
                        tvMatchedContact.setText(matched.getFullName());
                    } else {
                        tvMatchedContact.setText("");
                    }
                } else {
                    tvMatchedContact.setText("");
                }
            }
        };

        int[] keyIds = {
                R.id.key0, R.id.key1, R.id.key2, R.id.key3, R.id.key4,
                R.id.key5, R.id.key6, R.id.key7, R.id.key8, R.id.key9
        };
        for (int id : keyIds) {
            final TextView keyView = sheetView.findViewById(id);
            keyView.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (numberBuilder.length() < 10) {
                        numberBuilder.append(keyView.getText().toString());
                        updateDisplay.run();
                    }
                }
            });
        }

        btnBackspace.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (numberBuilder.length() > 0) {
                    numberBuilder.deleteCharAt(numberBuilder.length() - 1);
                    updateDisplay.run();
                }
            }
        });

        btnBackspace.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                numberBuilder.setLength(0);
                updateDisplay.run();
                return true;
            }
        });

        btnDialCall.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String targetExt = numberBuilder.toString().trim();
                if (targetExt.isEmpty()) {
                    Toast.makeText(requireContext(), "Vui lòng nhập số nội bộ cần gọi", Toast.LENGTH_SHORT).show();
                    return;
                }

                UserContact matched = ContactCache.findByExtension(targetExt);
                String calleeName = (matched != null) ? matched.getFullName() : "Số nội bộ " + targetExt;
                String calleeEmpCode = (matched != null) ? matched.getEmpCode() : "Gọi trực tiếp";

                dialog.dismiss();
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).startInternalCall(calleeName, calleeEmpCode, targetExt);
                }
            }
        });

        dialog.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
            @Override
            public void onShow(android.content.DialogInterface d) {
                BottomSheetDialog bottomSheetDialog = (BottomSheetDialog) d;
                android.widget.FrameLayout bottomSheet = bottomSheetDialog.findViewById(
                        com.google.android.material.R.id.design_bottom_sheet
                );
                if (bottomSheet != null) {
                    com.google.android.material.bottomsheet.BottomSheetBehavior<android.widget.FrameLayout> behavior =
                            com.google.android.material.bottomsheet.BottomSheetBehavior.from(bottomSheet);
                    behavior.setPeekHeight(bottomSheet.getHeight());
                    behavior.setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
                    behavior.setSkipCollapsed(true);
                }
            }
        });

        dialog.show();
    }
}
 	 	 	 	 	 	 	 	 	 	MainActivity.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.main;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.MenuItem;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;

import com.company.internalcall.R;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.dto.WazoSipEndpointResponse;
import com.company.internalcall.data.remote.dto.WazoUserDetailResponse;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.service.WazoKeepAliveService;
import com.company.internalcall.service.WazoSipCallManager;
import com.company.internalcall.ui.call.InCallActivity;
import com.company.internalcall.ui.chat.ChatDetailActivity;
import com.company.internalcall.ui.login.LoginActivity;
import com.company.internalcall.ui.main.contact.ChatsFragment;
import com.company.internalcall.ui.main.contact.ContactFragment;
import com.company.internalcall.ui.main.contact.FavoriteFragment;
import com.company.internalcall.ui.main.history.HistoryFragment;
import com.google.android.material.bottomnavigation.BottomNavigationView;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private SessionManager sessionManager;

    // Cờ tránh hỏi lại liên tục trong cùng 1 phiên mở app nếu người dùng bấm Back từ chối
    private boolean hasAskedOverlayPermission = false;
    private boolean hasAskedBatteryOptimization = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sessionManager = new SessionManager(this);

        TextView tvHeaderUser = findViewById(R.id.tvHeaderUser);
        TextView tvHeaderExt = findViewById(R.id.tvHeaderExt);
        BottomNavigationView bottomNav = findViewById(R.id.bottomNav);
        ImageButton btnLogout = findViewById(R.id.btnLogout);

        UserContact currentUser = (UserContact) getIntent().getSerializableExtra("USER_DATA");
        if (currentUser == null) {
            currentUser = sessionManager.getSavedUser();
        }
        if (currentUser == null) {
            currentUser = new UserContact("", "NV0999", "Nhân viên NV0999", "1005", "Nội bộ", true);
        }

        tvHeaderUser.setText(currentUser.getFullName() + " (" + currentUser.getEmpCode() + ")");
        tvHeaderExt.setText("Số nội bộ của bạn: " + currentUser.getExtension());

        if (savedInstanceState == null) {
            loadFragment(new HistoryFragment());
        }

        btnLogout.setOnClickListener(v -> {
            btnLogout.setEnabled(false);
            WazoSipCallManager.getInstance().logout(() -> runOnUiThread(() -> {
                try {
                    stopService(new Intent(MainActivity.this, WazoKeepAliveService.class));
                } catch (Exception ignored) {}

                sessionManager.clearSession();

                Intent intent = new Intent(MainActivity.this, LoginActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(intent);
                finish();
            }));
        });

        bottomNav.setOnNavigationItemSelectedListener(new BottomNavigationView.OnNavigationItemSelectedListener() {
            @Override
            public boolean onNavigationItemSelected(@NonNull MenuItem item) {
                if (item.getItemId() == R.id.nav_history) {
                    loadFragment(new HistoryFragment());
                    return true;
                } else if (item.getItemId() == R.id.nav_favorites) {
                    loadFragment(new FavoriteFragment());
                    return true;
                } else if (item.getItemId() == R.id.nav_chat) {
                    loadFragment(new ChatsFragment());
                    return true;
                } else if (item.getItemId() == R.id.nav_contact) {
                    loadFragment(new ContactFragment());
                    return true;
                }
                return false;
            }
        });

        ensureSipRegisteredAndOnline();
    }

    @Override
    protected void onResume() {
        super.onResume();

        // 0. Nếu phiên đăng nhập đã bị thu hồi trong lúc tắt màn hình / chạy nền -> Đẩy về LoginActivity ngay
        SessionManager sessionManager = new SessionManager(this);
        if (!sessionManager.isLoggedIn()) {
            Intent loginIntent = new Intent(this, com.company.internalcall.ui.login.LoginActivity.class);
            loginIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            startActivity(loginIntent);
            finish();
            return;
        }

        // 1. Nếu đang có cuộc gọi đổ chuông hoặc đang đàm thoại mà người dùng mở MainActivity (từ Home / Đa nhiệm),
        // lập tức điều hướng quay lại màn hình InCallActivity
        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        if (callManager.hasActiveCall()) {
            Intent callIntent = new Intent(this, InCallActivity.class);
            callIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            callIntent.putExtra("target_ext", callManager.getActiveTargetExt());
            callIntent.putExtra("target_name", callManager.getActiveTargetName());
            callIntent.putExtra("is_incoming", callManager.isIncomingRinging());
            startActivity(callIntent);
            return;
        }

        // 2. Đồng bộ trạng thái trực tuyến & kiểm tra ngầm xem token còn hiệu lực hay đã bị thiết bị khác đá
        callManager.publishPresence("available", "Sẵn sàng");

        // 3. Kiểm tra tuần tự từng quyền hệ thống để không bị đè 2 màn hình Settings lên nhau
        checkSystemPermissionsSequentially();
    }

    private void checkSystemPermissionsSequentially() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Ưu tiên 1: Quyền hiển thị trên ứng dụng khác (để bung màn hình cuộc gọi khi chạy ẩn)
            if (!Settings.canDrawOverlays(this) && !hasAskedOverlayPermission) {
                hasAskedOverlayPermission = true;
                Toast.makeText(this, "Vui lòng bật quyền 'Hiển thị trên ứng dụng khác' để nhận cuộc gọi khi chạy ẩn", Toast.LENGTH_LONG).show();
                Intent overlayIntent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                );
                startActivity(overlayIntent);
                return; // Chờ người dùng bật xong quay về onResume mới kiểm tra tiếp quyền Pin
            }

            // Ưu tiên 2: Quyền bỏ tối ưu hóa pin (giữ kết nối tổng đài ngầm không bị đóng băng)
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName()) && !hasAskedBatteryOptimization) {
                hasAskedBatteryOptimization = true;
                Intent batteryIntent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                batteryIntent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(batteryIntent);
            }
        }
    }

    private void ensureSipRegisteredAndOnline() {
        final String token = sessionManager.getToken();
        final String userUuid = sessionManager.getUserUuid();
        String sipUser = sessionManager.getSipUsername();
        String sipPass = sessionManager.getSipPassword();

        Log.d(TAG, "Kiểm tra SIP đã lưu: sipUser=" + sipUser + ", hasPass=" + (sipPass != null && !sipPass.isEmpty()));

        if (sipUser != null && !sipUser.isEmpty() && sipPass != null && !sipPass.isEmpty()) {
            WazoKeepAliveService.startIfLoggedIn(this);
            WazoSipCallManager.getInstance().initAndRegister(this, sipUser, sipPass);
            return;
        }

        // Nếu chưa có sipUser/sipPass trong bộ nhớ, tự động gọi API lấy lại từ token hiện có
        if (token != null && !token.isEmpty() && userUuid != null && !userUuid.isEmpty()) {
            ApiClient.getService().getMyProfile(token, userUuid).enqueue(new Callback<WazoUserDetailResponse>() {
                @Override
                public void onResponse(@NonNull Call<WazoUserDetailResponse> call, @NonNull Response<WazoUserDetailResponse> response) {
                    if (response.code() == 401) {
                        sessionManager.forceLogoutOnTokenExpired(MainActivity.this::ensureSipRegisteredAndOnline);
                        return;
                    }
                    if (response.isSuccessful() && response.body() != null) {
                        int lineId = response.body().getPrimaryLineId();
                        if (lineId > 0) {
                            ApiClient.getService().getUserLineSipEndpoint(token, userUuid, lineId)
                                    .enqueue(new Callback<WazoSipEndpointResponse.SipAuthDetail>() {
                                        @Override
                                        public void onResponse(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> c2,
                                                               @NonNull Response<WazoSipEndpointResponse.SipAuthDetail> r2) {
                                            if (r2.code() == 401) {
                                                sessionManager.forceLogoutOnTokenExpired(MainActivity.this::ensureSipRegisteredAndOnline);
                                                return;
                                            }
                                            if (r2.isSuccessful() && r2.body() != null) {
                                                String u = r2.body().getUsername();
                                                String p = r2.body().getPassword();
                                                Log.d(TAG, "Đã tải bổ sung SIP credentials thành công: " + u);
                                                sessionManager.saveSipCredentials(u, p);
                                                WazoKeepAliveService.startIfLoggedIn(MainActivity.this);
                                                WazoSipCallManager.getInstance().initAndRegister(MainActivity.this, u, p);
                                            } else {
                                                Log.e(TAG, "Lỗi lấy SIP Endpoint trong MainActivity: HTTP " + r2.code());
                                            }
                                        }

                                        @Override
                                        public void onFailure(@NonNull Call<WazoSipEndpointResponse.SipAuthDetail> c2, @NonNull Throwable t) {}
                                    });
                        }
                    }
                }

                @Override
                public void onFailure(@NonNull Call<WazoUserDetailResponse> call, @NonNull Throwable t) {}
            });
        }
    }

    private void loadFragment(Fragment fragment) {
        getSupportFragmentManager().beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .commit();
    }

    public void startInternalCall(String name, String empCode, String extension) {
        Intent intent = new Intent(this, InCallActivity.class);
        intent.putExtra("CALLEE_NAME", name);
        intent.putExtra("CALLEE_EMP", empCode);
        intent.putExtra("CALLEE_EXT", extension);
        intent.putExtra("target_name", name);
        intent.putExtra("target_ext", extension);
        startActivity(intent);
    }

    public void startInternalGroupCall(java.util.ArrayList<String> extensions) {
        if (extensions == null || extensions.isEmpty()) return;
        Intent intent = new Intent(this, InCallActivity.class);
        intent.putStringArrayListExtra("GROUP_EXTENSIONS", extensions);
        intent.putExtra("target_name", "Cuộc gọi nhóm");
        intent.putExtra("target_ext", extensions.get(0));
        startActivity(intent);
    }

    public void startInternalChat(String name, String uuid, String extension) {
        Intent intent = new Intent(this, ChatDetailActivity.class);
        intent.putExtra("TARGET_NAME", name);
        intent.putExtra("TARGET_UUID", uuid);
        intent.putExtra("TARGET_EXTEN", extension);
        startActivity(intent);
    }
}	 
 	 	 	 	 	 	 	 	InternalCallApp.java	 	 	 
 	 	 	 	 	 	 	 	package com.company.internalcall;

import android.app.Application;

public class InternalCallApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
    }
}
 	 	 
 	 	 	 	res	 	 	 	 	 	 	 
 	 	 	 	 	drawable	 	 	 	 	 	 
 	 	 	 	 	 	bg_call_button_offline.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#9CA3AF" /> <!-- Màu xám (Offline) -->
</shape>	 	 	 	 	 
 	 	 	 	 	 	bg_call_button_online.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#10B981" /> <!-- Màu xanh lá (Online) -->
</shape>	 	 	 	 	 
 	 	 	 	 	 	bg_circle_active.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#FFFFFF" />
</shape>	 	 	 	 	 
 	 	 	 	 	 	bg_circle_avatar.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#D6E4FF" />
</shape>
 	 	 	 	 
 	 	 	 	 	 	bg_circle_avatar_edit.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Lớp 1: Hình nền tròn (Background) -->
    <item>
        <shape android:shape="oval">
            <solid android:color="#2196F3" />
        </shape>
    </item>

    <!-- Lớp 2: Icon hoặc Drawable nằm ở giữa -->
    <item
        android:drawable="@android:drawable/stat_notify_chat"
        android:gravity="center"
        android:width="24dp"
        android:height="24dp" />

</layer-list>	 	 	 	 	 
 	 	 	 	 	 	bg_circle_dark.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#283548" />
</shape>
 	 	 	 	 
 	 	 	 	 	 	bg_circle_green.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#2E7D32" />
</shape>
 	 	 	 	 
 	 	 	 	 	 	bg_circle_grey.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#9CA3AF" /> <!-- Màu xám cho offline -->
</shape>	 	 	 	 	 
 	 	 	 	 	 	bg_circle_red.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#D32F2F" />
</shape>
 	 	 	 	 
 	 	 	 	 	 	bg_dialpad_key.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<ripple xmlns:android="http://schemas.android.com/apk/res/android"
    android:color="#CBD5E1">
    <item>
        <shape android:shape="oval">
            <solid android:color="#F1F5F9" />
        </shape>
    </item>
</ripple>	 	 	 	 	 
 	 	 	 	 	 	ic_backspace_red.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="26dp"
    android:height="26dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#D32F2F"
        android:pathData="M22,3H7c-0.69,0 -1.23,0.35 -1.59,0.88L0,12l5.41,8.11c0.36,0.53 0.9,0.89 1.59,0.89h15c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2zM19,15.59L17.59,17 14,13.41 10.41,17 9,15.59 12.59,12 9,8.41 10.41,7 14,10.59 17.59,7 19,8.41 15.41,12 19,15.59z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_call_end.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="32dp"
    android:height="32dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,9c-1.6,0 -3.15,0.25 -4.6,0.72v3.1c0,0.39 -0.23,0.74 -0.56,0.9 -0.98,0.49 -1.87,1.12 -2.66,1.85 -0.18,0.18 -0.43,0.28 -0.7,0.28 -0.28,0 -0.53,-0.11 -0.71,-0.29L0.29,13.08c-0.18,-0.17 -0.29,-0.42 -0.29,-0.7 0,-0.28 0.11,-0.53 0.29,-0.71C3.34,8.78 7.46,7 12,7s8.66,1.78 11.71,4.67c0.18,0.18 0.29,0.43 0.29,0.71 0,0.28 -0.11,0.53 -0.29,0.71l-2.48,2.48c-0.18,0.18 -0.43,0.29 -0.71,0.29 -0.27,0 -0.52,-0.11 -0.7,-0.28 -0.79,-0.74 -1.69,-1.36 -2.67,-1.85 -0.33,-0.16 -0.56,-0.5 -0.56,-0.9v-3.1C15.15,9.25 13.6,9 12,9z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_call_incoming.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="32dp"
    android:height="32dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <path
        android:fillColor="#16A34A"
        android:pathData="M6.62,10.79a15.05,15.05 0,0 0,6.59 6.59l2.2,-2.2a1,1 0,0 1,1.01,-0.24c1.12,0.37 2.33,0.56 3.58,0.56a1,1 0,0 1,1 1v3.5a1,1 0,0 1,-1 1C10.61,21 3,13.39 3,4a1,1 0,0 1,1 -1h3.5a1,1 0,0 1,1 1c0,1.25 0.2,2.46 0.56,3.58a1,1 0,0 1,-0.25 1.01z" />

    <path
        android:fillColor="@android:color/transparent"
        android:strokeColor="#16A34A"
        android:strokeWidth="2.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M20,4 L11,13 M11,8 L11,13 L16,13" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_call_missed.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="32dp"
    android:height="32dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <!-- Hình điện thoại -->
    <path
        android:fillColor="#EF2020"
        android:pathData="M6.62,10.79a15.05,15.05 0,0 0,6.59 6.59l2.2,-2.2a1,1 0,0 1,1.01,-0.24c1.12,0.37 2.33,0.56 3.58,0.56a1,1 0,0 1,1 1v3.5a1,1 0,0 1,-1 1C10.61,21 3,13.39 3,4a1,1 0,0 1,1 -1h3.5a1,1 0,0 1,1 1c0,1.25 0.2,2.46 0.56,3.58a1,1 0,0 1,-0.25 1.01z" />

    <!-- Dấu X -->
    <path
        android:fillColor="@android:color/transparent"
        android:strokeColor="#EF2020"
        android:strokeWidth="2.2"
        android:strokeLineCap="round"
        android:pathData="M15,4 L21,10 M21,4 L15,10" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_call_outgoing.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="32dp"
    android:height="32dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <!-- Hình điện thoại -->
    <path
        android:fillColor="#1677FF"
        android:pathData="M6.62,10.79a15.05,15.05 0,0 0,6.59 6.59l2.2,-2.2a1,1 0,0 1,1.01,-0.24c1.12,0.37 2.33,0.56 3.58,0.56a1,1 0,0 1,1 1v3.5a1,1 0,0 1,-1 1C10.61,21 3,13.39 3,4a1,1 0,0 1,1 -1h3.5a1,1 0,0 1,1 1c0,1.25 0.2,2.46 0.56,3.58a1,1 0,0 1,-0.25 1.01z" />

    <!-- Mũi tên lên phải -->
    <path
        android:fillColor="@android:color/transparent"
        android:strokeColor="#1677FF"
        android:strokeWidth="2.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M11,13 L20,4 M14,4 L20,4 L20,10" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_dialpad.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path
        android:fillColor="@android:color/white"
        android:pathData="M12,19c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM6,1c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM6,7c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM6,13c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM18,5c1.1,0 2,-0.9 2,-2s-0.9,-2 -2,-2 -2,0.9 -2,2 0.9,2 2,2zM12,13c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM18,13c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM18,7c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM12,7c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM12,5c1.1,0 2,-0.9 2,-2s-0.9,-2 -2,-2 -2,0.9 -2,2 0.9,2 2,2z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_earpiece.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M7,9v6h4l5,5V4l-5,5H7z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_launcher.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <!-- Nền xanh đậm SmartCall -->
    <path
        android:fillColor="#1565C0"
        android:pathData="M24,8h60c8.84,0 16,7.16 16,16v60c0,8.84 -7.16,16 -16,16H24c-8.84,0 -16,-7.16 -16,-16V24c0,-8.84 7.16,-16 16,-16z" />

    <!-- Biểu tượng ống nghe điện thoại màu trắng ở giữa -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M36.5,47.8c3.6,7.1 9.5,12.9 16.6,16.6l5.5,-5.5c0.7,-0.7 1.7,-0.9 2.6,-0.6c2.8,0.9 5.9,1.4 9,1.4c1.4,0 2.5,1.1 2.5,2.5v8.8c0,1.4 -1.1,2.5 -2.5,2.5C46.8,73.5 29.5,56.2 29.5,34.8c0,-1.4 1.1,-2.5 2.5,-2.5h8.8c1.4,0 2.5,1.1 2.5,2.5c0,3.1 0.5,6.2 1.4,9c0.3,0.9 0.1,1.9 -0.6,2.6L36.5,47.8z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_launcher_round.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <!-- Nền hình tròn xanh đậm SmartCall -->
    <path
        android:fillColor="#1565C0"
        android:pathData="M54,6A48,48 0 1,1 53.99,6Z" />

    <!-- Biểu tượng ống nghe điện thoại màu trắng ở giữa -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M36.5,47.8c3.6,7.1 9.5,12.9 16.6,16.6l5.5,-5.5c0.7,-0.7 1.7,-0.9 2.6,-0.6c2.8,0.9 5.9,1.4 9,1.4c1.4,0 2.5,1.1 2.5,2.5v8.8c0,1.4 -1.1,2.5 -2.5,2.5C46.8,73.5 29.5,56.2 29.5,34.8c0,-1.4 1.1,-2.5 2.5,-2.5h8.8c1.4,0 2.5,1.1 2.5,2.5c0,3.1 0.5,6.2 1.4,9c0.3,0.9 0.1,1.9 -0.6,2.6L36.5,47.8z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_mic_off.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M19,11h-1.7c0,0.74 -0.16,1.43 -0.43,2.05l1.23,1.23c0.56,-0.98 0.9,-2.09 0.9,-3.28zM14.98,11.17c0,-0.06 0.02,-0.11 0.02,-0.17V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v0.18l5.98,5.99zM4.27,3L3,4.27l6.01,6.01V11c0,1.66 1.33,3 2.99,3 0.22,0 0.44,-0.03 0.65,-0.08l1.66,1.66c-0.71,0.33 -1.5,0.52 -2.31,0.52 -2.76,0 -5.3,-2.1 -5.3,-5.1H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c0.91,-0.13 1.77,-0.45 2.54,-0.9L19.73,21 21,19.73 4.27,3z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_mic_on.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_nav_contact.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#000000"
        android:pathData="M20,0L4,0v2h16L20,0zM4,24h16v-2L4,22v2zM20,4L4,4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2L22,6c0,-1.1 -0.9,-2 -2,-2zM12,6.75c1.24,0 2.25,1.01 2.25,2.25s-1.01,2.25 -2.25,2.25S9.75,10.24 9.75,9 10.76,6.75 12,6.75zM17,17L7,17v-1.5c0,-1.67 3.33,-2.5 5,-2.5s5,0.83 5,2.5L17,17z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_nav_history.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#000000"
        android:pathData="M13,3c-4.97,0 -9,4.03 -9,9H1l3.89,3.89 0.07,0.14L9,12H6c0,-3.87 3.13,-7 7,-7s7,3.13 7,7 -3.13,7 -7,7c-1.93,0 -3.68,-0.79 -4.94,-2.06l-1.42,1.42C8.27,19.99 10.51,21 13,21c4.97,0 9,-4.03 9,-9s-4.03,-9 -9,-9zM12,8v5l4.28,2.54 0.72,-1.21 -3.5,-2.08V8H12z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_nav_search_directory.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">

    <!-- Gáy sổ danh bạ và khung danh bạ bên trái -->
    <path
        android:fillColor="#000000"
        android:pathData="M1,4h1.5v3H1V4zM1,9.5h1.5v3H1v-3zM1,15h1.5v3H1v-3z" />
    <path
        android:fillColor="#000000"
        android:pathData="M3.5,2v18h7.2c-0.45,-0.58 -0.82,-1.22 -1.08,-1.92H5.5V4h10v4.08c0.7,0.16 1.37,0.43 2,0.8V2c0,-1.1 -0.9,-2 -2,-2h-10C4.4,0 3.5,0.9 3.5,2z" />

    <!-- Hình người đại diện trong sổ danh bạ -->
    <path
        android:fillColor="#000000"
        android:pathData="M10.5,9.5c1.38,0 2.5,-1.12 2.5,-2.5S11.88,4.5 10.5,4.5 8,5.62 8,7s1.12,2.5 2.5,2.5zM10.5,11c-1.8,0 -4,0.9 -4,2.5V15h4.1c0.1,-0.95 0.45,-1.83 0.98,-2.56C11.23,12.15 10.87,11 10.5,11z" />

    <!-- Kính lúp tìm kiếm kết hợp lưới kinh tuyến/vĩ tuyến Internet ở góc phải dưới -->
    <path
        android:fillColor="#000000"
        android:pathData="M16,9.5c-3.04,0 -5.5,2.46 -5.5,5.5s2.46,5.5 5.5,5.5c1.13,0 2.18,-0.34 3.05,-0.93l3.19,3.19l1.26,-1.26l-3.19,-3.19C20.9,17.44 21.5,16.29 21.5,15C21.5,11.96 19.04,9.5 16,9.5zM16,11c0.48,0 0.92,0.72 1.15,1.85h-2.3C15.08,11.72 15.52,11 16,11zM12.16,14.25c0.14,-0.82 0.54,-1.55 1.12,-2.1c-0.22,0.62 -0.37,1.33 -0.43,2.1H12.16zM12.16,15.75h0.69c0.06,0.77 0.21,1.48 0.43,2.1c-0.58,-0.55 -0.98,-1.28 -1.12,-2.1zM14.3,15.75v-1.5h3.4v1.5H14.3zM16,19c-0.48,0 -0.92,-0.72 -1.15,-1.85h2.3C16.92,18.28 16.48,19 16,19zM18.72,17.85c0.22,-0.62 0.37,-1.33 0.43,-2.1h0.69C19.7,16.57 19.3,17.3 18.72,17.85zM19.15,14.25c-0.06,-0.77 -0.21,-1.48 -0.43,-2.1c0.58,0.55 0.98,1.28 1.12,2.1H19.15z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_person_add.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#6B7280"
        android:pathData="M9.5,11.5c2.76,0 5,-2.24 5,-5s-2.24,-5 -5,-5 -5,2.24 -5,5 2.24,5 5,5zM9.5,13.5c-3.33,0 -9.5,1.67 -9.5,5v4h19v-4c0,-3.33 -6.17,-5 -9.5,-5zM20.5,9.5V7h-1.5v2.5H16.5v1.5h2.5v2.5h1.5V11h2.5V9.5h-2.5z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_person_added.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="28dp"
    android:height="28dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#2563EB"
        android:pathData="M9.5,11.5c2.76,0 5,-2.24 5,-5s-2.24,-5 -5,-5 -5,2.24 -5,5 2.24,5 5,5zM9.5,13.5c-3.33,0 -9.5,1.67 -9.5,5v4h19v-4c0,-3.33 -6.17,-5 -9.5,-5zM18.2,13.2L16,11l1.06,-1.06 1.14,1.14 3.24,-3.24 1.06,1.06 -4.3,4.3z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_speaker_off.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M3,9v6h4l5,5V4L7,9H3zM16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v8.05c1.48,-0.73 2.5,-2.25 2.5,-4.02z" />
</vector>	 	 	 	 	 
 	 	 	 	 	 	ic_speaker_on.xml	 	 	 	 	 
 	 	 	 	 	 	<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M3,9v6h4l5,5V4L7,9H3zM16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v8.05c1.48,-0.73 2.5,-2.25 2.5,-4.02zM14,3.23v2.06c2.89,0.86 5,3.54 5,6.71s-2.11,5.85 -5,6.71v2.06c4.01,-0.91 7,-4.49 7,-8.77s-2.99,-7.86 -7,-8.77z" />
</vector>	 	 	 	 	 
 	 	 	 	 	layout	 	 	 	 	 	 
 	 	 	 	 	 	activity_chat_detail.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="#E2E9F1">

    <!-- Header Zalo: Tên người chat + Nút gọi thoại ngay trên góc phải -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:background="@color/Blue"
        android:gravity="center_vertical"
        android:paddingHorizontal="12dp"
        android:orientation="horizontal">

        <TextView
            android:id="@+id/tvChatTitle"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="Đồng nghiệp"
            android:textColor="@color/white"
            android:textSize="18sp"
            android:textStyle="bold" />

        <ImageButton
            android:id="@+id/btnCallFromChat"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@android:drawable/ic_menu_call"
            android:tint="@color/white" />

        <ImageButton
            android:id="@+id/btnRoomDetail"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@android:drawable/arrow_up_float"
            android:tint="@color/white" />
    </LinearLayout>

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rvMessages"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:padding="12dp" />

    <!-- Thanh nhập tin nhắn dưới cùng -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:background="@color/white"
        android:gravity="center_vertical"
        android:paddingHorizontal="8dp"
        android:orientation="horizontal">

        <EditText
            android:id="@+id/edtMessage"
            android:layout_width="0dp"
            android:layout_height="40dp"
            android:layout_weight="1"
            android:hint="Nhập tin nhắn..."
            android:background="@null"
            android:paddingHorizontal="8dp" />

        <Button
            android:id="@+id/btnSend"
            android:layout_width="72dp"
            android:layout_height="38dp"
            android:background="@color/Blue"
            android:text="GỬI"
            android:textColor="@color/white"
            android:textStyle="bold" />
    </LinearLayout>
</LinearLayout>
	 	 	 	 	activity_incall.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#121824"
    android:gravity="center_horizontal"
    android:orientation="vertical"
    android:padding="24dp">

    <!-- Thông tin người gọi / máy nhánh / nhóm -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:gravity="center"
        android:orientation="vertical">

        <TextView
            android:id="@+id/tvAvatarCall"
            android:layout_width="88dp"
            android:layout_height="88dp"
            android:background="@drawable/bg_circle_avatar"
            android:gravity="center"
            android:text="W"
            android:textColor="@color/colorPrimary"
            android:textSize="32sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/tvTargetName"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="20dp"
            android:gravity="center"
            android:text="Nhân viên"
            android:textColor="#FFFFFF"
            android:textSize="26sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/tvTargetExtension"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:gravity="center"
            android:maxLines="3"
            android:ellipsize="end"
            android:paddingStart="12dp"
            android:paddingEnd="12dp"
            android:text="Ext: 1000"
            android:textColor="#90A4AE"
            android:textSize="15sp" />

        <TextView
            android:id="@+id/tvCallStatus"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:text="Đang kết nối..."
            android:textColor="#4FC3F7"
            android:textSize="18sp" />
    </LinearLayout>

    <!-- Cụm nút điều khiển (Mute, Loa ngoài, Thêm người, Kết thúc / Nghe máy) -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginBottom="36dp"
        android:gravity="center"
        android:orientation="vertical">

        <!-- Hàng nút Mute, Speaker & Thêm người vào nhóm -->
        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginBottom="36dp"
            android:gravity="center"
            android:orientation="horizontal">

            <ImageButton
                android:id="@+id/btnMute"
                android:layout_width="64dp"
                android:layout_height="64dp"
                android:layout_marginEnd="28dp"
                android:background="?attr/selectableItemBackgroundBorderless"
                android:padding="14dp"
                android:scaleType="fitCenter"
                app:srcCompat="@drawable/ic_mic_on"
                android:tint="#FFFFFF" />

            <ImageButton
                android:id="@+id/btnSpeaker"
                android:layout_width="64dp"
                android:layout_height="64dp"
                android:layout_marginEnd="28dp"
                android:background="?attr/selectableItemBackgroundBorderless"
                android:padding="14dp"
                android:scaleType="fitCenter"
                app:srcCompat="@drawable/ic_speaker_off"
                android:tint="#FFFFFF" />

            <ImageButton
                android:id="@+id/btnAddParticipant"
                android:layout_width="64dp"
                android:layout_height="64dp"
                android:background="?attr/selectableItemBackgroundBorderless"
                android:contentDescription="Thêm người vào cuộc gọi nhóm"
                android:padding="14dp"
                android:scaleType="fitCenter"
                app:srcCompat="@drawable/ic_person_add"
                android:tint="#FFFFFF" />
        </LinearLayout>

        <!-- Hàng nút Nghe máy (hiện khi có cuộc gọi đến) & Kết thúc (Đỏ) -->
        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:gravity="center"
            android:orientation="horizontal">

            <com.google.android.material.floatingactionbutton.FloatingActionButton
                android:id="@+id/btnAcceptCall"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginEnd="48dp"
                android:visibility="gone"
                app:backgroundTint="#2E7D32"
                app:fabCustomSize="68dp"
                app:maxImageSize="32dp"
                app:srcCompat="@android:drawable/sym_action_call"
                app:tint="#FFFFFF" />

            <com.google.android.material.floatingactionbutton.FloatingActionButton
                android:id="@+id/btnEndCall"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                app:backgroundTint="#E53935"
                app:fabCustomSize="68dp"
                app:maxImageSize="32dp"
                app:srcCompat="@drawable/ic_call_end"
                app:tint="#FFFFFF" />
        </LinearLayout>
    </LinearLayout>

</LinearLayout>	 	 	 	 	 
 	 	 	 	 	 	activity_login.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/bgLight"
    android:gravity="center"
    android:orientation="vertical"
    android:padding="24dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Internal VoIP"
        android:textColor="#111827"
        android:textSize="28sp"
        android:textStyle="bold" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:layout_marginBottom="28dp"
        android:text="Đăng nhập bằng Mã NV để nhận số nội bộ"
        android:textColor="#6B7280"
        android:textSize="14sp" />

    <com.google.android.material.textfield.TextInputLayout
        style="@style/Widget.MaterialComponents.TextInputLayout.OutlinedBox"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:hint="Mã nhân viên (VD: NV0999)">

        <com.google.android.material.textfield.TextInputEditText
            android:id="@+id/etEmpCode"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="viet@ss.com" />
    </com.google.android.material.textfield.TextInputLayout>

    <com.google.android.material.textfield.TextInputLayout
        style="@style/Widget.MaterialComponents.TextInputLayout.OutlinedBox"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="12dp"
        android:hint="Mật khẩu">

        <com.google.android.material.textfield.TextInputEditText
            android:id="@+id/etPassword"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:inputType="textPassword"
            android:text="viet2510" />
    </com.google.android.material.textfield.TextInputLayout>

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnLogin"
        android:layout_width="match_parent"
        android:layout_height="52dp"
        android:layout_marginTop="24dp"
        android:text="Đăng nhập &amp; Kết nối tổng đài"
        android:textAllCaps="false"
        android:textSize="16sp" />

</LinearLayout>
 	 	 	 	 
 	 	 	 	 	 	activity_main.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/bgLight"
    android:orientation="vertical">

    <!-- Header chứa thông tin cá nhân và nút Đăng xuất -->
    <RelativeLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="#FFFFFF"
        android:elevation="2dp"
        android:padding="16dp">

        <!-- 1. Đặt Button lên trước để LinearLayout có thể dùng toStartOf -->
        <ImageButton
            android:id="@+id/btnLogout"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_alignParentEnd="true"
            android:layout_centerVertical="true"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Đăng xuất"
            android:src="@android:drawable/ic_lock_power_off"
            app:tint="#EF4444" />

        <!-- 2. LinearLayout nằm bên trái nút Đăng xuất (dùng đúng @id/btnLogout) -->
        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_alignParentStart="true"
            android:layout_centerVertical="true"
            android:layout_toStartOf="@id/btnLogout"
            android:layout_marginEnd="8dp"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tvHeaderUser"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Nhân viên (NV0999)"
                android:textColor="#111827"
                android:textSize="17sp"
                android:textStyle="bold" />

            <LinearLayout
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <View
                    android:layout_width="8dp"
                    android:layout_height="8dp"
                    android:background="@drawable/bg_circle_green" />

                <TextView
                    android:id="@+id/tvHeaderExt"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="6dp"
                    android:text="Số nội bộ của bạn: 1005"
                    android:textColor="@color/colorPrimary"
                    android:textSize="13sp"
                    android:textStyle="bold" />
            </LinearLayout>
        </LinearLayout>

    </RelativeLayout>

    <FrameLayout
        android:id="@+id/fragmentContainer"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />

    <com.google.android.material.bottomnavigation.BottomNavigationView
        android:id="@+id/bottomNav"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="#FFFFFF"
        app:menu="@menu/bottom_nav_menu" />

</LinearLayout>	 	 	 	 	 
 	 	 	 	 	 	bottom_sheet_dialpad.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:background="#FFFFFF"
    android:gravity="center_horizontal"
    android:orientation="vertical"
    android:paddingStart="24dp"
    android:paddingTop="12dp"
    android:paddingEnd="24dp"
    android:paddingBottom="28dp">

    <!-- Thanh gạt nhỏ trên đỉnh BottomSheet -->
    <View
        android:layout_width="40dp"
        android:layout_height="4dp"
        android:layout_marginBottom="16dp"
        android:background="#D1D5DB" />

    <!-- Khu vực hiển thị số đã nhập + Icon xóa màu đỏ bên phải -->
    <RelativeLayout
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:gravity="center_vertical">

        <TextView
            android:id="@+id/tvDialedNumber"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_centerVertical="true"
            android:layout_toStartOf="@id/btnBackspace"
            android:gravity="center"
            android:hint="Nhập số nội bộ"
            android:letterSpacing="0.08"
            android:maxLines="1"
            android:paddingStart="44dp"
            android:paddingEnd="8dp"
            android:textColor="#111827"
            android:textColorHint="#9CA3AF"
            android:textSize="30sp"
            android:textStyle="bold" />

        <ImageButton
            android:id="@+id/btnBackspace"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:layout_alignParentEnd="true"
            android:layout_centerVertical="true"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Xóa số"
            android:visibility="invisible"
            app:srcCompat="@drawable/ic_backspace_red" />
    </RelativeLayout>

    <!-- Dòng gợi ý tên nhân viên nếu số khớp với ContactCache -->
    <TextView
        android:id="@+id/tvMatchedContact"
        android:layout_width="wrap_content"
        android:layout_height="22dp"
        android:layout_marginTop="2dp"
        android:layout_marginBottom="10dp"
        android:text=""
        android:textColor="@color/colorPrimary"
        android:textSize="13sp"
        android:textStyle="bold" />

    <View
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:layout_marginBottom="16dp"
        android:background="#E5E7EB" />

    <!-- Lưới bàn phím 0 - 9 (3 cột x 4 hàng, không có * và #) -->
    <GridLayout
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:columnCount="3"
        android:rowCount="4">

        <!-- Hàng 1: 1, 2, 3 -->
        <TextView
            android:id="@+id/key1"
            style="@style/DialpadKeyStyle"
            android:text="1" />

        <TextView
            android:id="@+id/key2"
            style="@style/DialpadKeyStyle"
            android:text="2" />

        <TextView
            android:id="@+id/key3"
            style="@style/DialpadKeyStyle"
            android:text="3" />

        <!-- Hàng 2: 4, 5, 6 -->
        <TextView
            android:id="@+id/key4"
            style="@style/DialpadKeyStyle"
            android:text="4" />

        <TextView
            android:id="@+id/key5"
            style="@style/DialpadKeyStyle"
            android:text="5" />

        <TextView
            android:id="@+id/key6"
            style="@style/DialpadKeyStyle"
            android:text="6" />

        <!-- Hàng 3: 7, 8, 9 -->
        <TextView
            android:id="@+id/key7"
            style="@style/DialpadKeyStyle"
            android:text="7" />

        <TextView
            android:id="@+id/key8"
            style="@style/DialpadKeyStyle"
            android:text="8" />

        <TextView
            android:id="@+id/key9"
            style="@style/DialpadKeyStyle"
            android:text="9" />

        <!-- Hàng 4: Trống - 0 - Trống -->
        <Space
            android:layout_width="72dp"
            android:layout_height="72dp"
            android:layout_margin="8dp" />

        <TextView
            android:id="@+id/key0"
            style="@style/DialpadKeyStyle"
            android:text="0" />

        <Space
            android:layout_width="72dp"
            android:layout_height="72dp"
            android:layout_margin="8dp" />
    </GridLayout>

    <!-- Nút Gọi màu xanh lá nằm chính giữa dưới số 0 -->
    <ImageButton
        android:id="@+id/btnDialCall"
        android:layout_width="68dp"
        android:layout_height="68dp"
        android:layout_marginTop="16dp"
        android:background="@drawable/bg_circle_green"
        android:contentDescription="Gọi điện"
        android:elevation="3dp"
        android:src="@android:drawable/sym_action_call"
        android:tint="#FFFFFF" />

</LinearLayout>	 	 	 	 	 
 	 	 	 	 	 	fragment_chats.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#F5F6F8">

    <!-- Thanh tìm kiếm -->
    <EditText
        android:id="@+id/edtSearchChat"
        android:layout_width="0dp"
        android:layout_height="48dp"
        android:layout_margin="12dp"
        android:drawableStart="@drawable/bg_circle_dark"
        android:drawablePadding="8dp"
        android:hint="Tìm kiếm cuộc trò chuyện..."
        android:imeOptions="actionSearch"
        android:inputType="text"
        android:paddingStart="12dp"
        android:paddingEnd="12dp"
        android:textSize="14sp"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

    <!-- RecyclerView hiển thị danh sách phòng chat -->
    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/recyclerViewChats"
        android:layout_width="0dp"
        android:layout_height="0dp"
        android:layout_marginTop="8dp"
        android:clipToPadding="false"
        android:paddingBottom="80dp"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toBottomOf="@id/edtSearchChat" />

    <!-- Nút tạo nhóm chat nổi (FAB) -->
    <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:id="@+id/fabCreateGroup"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_margin="24dp"
        android:contentDescription="Tạo nhóm chat"
        android:src="@drawable/ic_person_add"
        app:backgroundTint="#0084FF"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:tint="@android:color/white" />

</androidx.constraintlayout.widget.ConstraintLayout>	 	 	 	 	 
 	 	 	 	 	 	fragment_contact.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_margin="12dp"
        android:gravity="center_vertical"
        android:orientation="horizontal">

        <EditText
            android:id="@+id/etSearchContact"
            android:layout_width="0dp"
            android:layout_height="46dp"
            android:layout_weight="1"
            android:background="#FFFFFF"
            android:drawableStart="@android:drawable/ic_menu_search"
            android:drawablePadding="8dp"
            android:elevation="1dp"
            android:hint="Tìm theo tên nhân viên, mã NV hoặc số..."
            android:inputType="text"
            android:paddingStart="12dp"
            android:paddingEnd="12dp"
            android:singleLine="true"
            android:textSize="14sp" />

        <Button
            android:id="@+id/btnStartGroupCall"
            android:layout_width="wrap_content"
            android:layout_height="46dp"
            android:layout_marginStart="8dp"
            android:background="@drawable/bg_circle_green"
            android:paddingStart="14dp"
            android:paddingEnd="14dp"
            android:text="Gọi nhóm"
            android:textAllCaps="false"
            android:textColor="#FFFFFF"
            android:textSize="13sp"
            android:textStyle="bold" />
    </LinearLayout>

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rvContacts"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:clipToPadding="false"
        android:paddingStart="12dp"
        android:paddingEnd="12dp"
        android:paddingBottom="12dp" />
</LinearLayout>	 	 	 	 	 
 	 	 	 	 	 	fragment_history.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rvHistory"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:clipToPadding="false"
        android:paddingStart="12dp"
        android:paddingTop="12dp"
        android:paddingEnd="12dp"
        android:paddingBottom="84dp" />

    <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:id="@+id/fabOpenDialpad"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom|end"
        android:layout_margin="18dp"
        android:contentDescription="Mở bàn phím gọi"
        android:src="@drawable/ic_dialpad"
        app:tint="#FFFFFF" />

</FrameLayout>	 	 	 	 	 
 	 	 	 	 	 	item_chat_contact.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="68dp"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:paddingHorizontal="16dp"
    android:background="@color/white"
    android:layout_marginBottom="1dp"
    android:id="@+id/layout">

    <!-- Avatar tròn chữ cái đầu -->
    <TextView
        android:id="@+id/tvAvatar"
        android:layout_width="44dp"
        android:layout_height="44dp"
        android:background="@drawable/bg_circle_avatar_edit"
        android:gravity="center"
        android:textColor="@color/white"
        android:textSize="18sp"
        android:textStyle="bold" />

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:layout_marginStart="12dp"
        android:orientation="vertical">

        <TextView
            android:id="@+id/tvContactName"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Nguyễn Văn A"
            android:textColor="@color/Primary"
            android:textSize="16sp"
            android:textStyle="bold" />

        <TextView
            android:id="@+id/tvContactExten"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Máy lẻ: 1001"
            android:textColor="@color/Secondary"
            android:textSize="13sp" />
    </LinearLayout>

    <ImageButton
        android:id="@+id/btnChatContact"
        android:layout_width="40dp"
        android:layout_height="40dp"
        android:visibility="gone"
        android:background="?attr/selectableItemBackgroundBorderless"
        android:src="@android:drawable/sym_action_chat"
        android:tint="@color/Blue" />

    <ImageButton
        android:id="@+id/btnCallContact"
        android:layout_width="40dp"
        android:layout_height="40dp"
        android:visibility="gone"
        android:layout_marginStart="4dp"
        android:background="?attr/selectableItemBackgroundBorderless"
        android:src="@android:drawable/ic_menu_call"
        android:tint="@color/Blue" />
</LinearLayout>	 	 	 	 	 
 	 	 	 	 	 	item_contact.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<androidx.cardview.widget.CardView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="8dp"
    app:cardCornerRadius="10dp"
    app:cardElevation="1dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:padding="12dp">

        <TextView
            android:id="@+id/tvContactAvatar"
            android:layout_width="42dp"
            android:layout_height="42dp"
            android:background="@drawable/bg_circle_avatar"
            android:gravity="center"
            android:text="A"
            android:textColor="@color/colorPrimary"
            android:textSize="16sp"
            android:textStyle="bold" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="12dp"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tvContactName"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Nguyễn Văn An"
                android:textColor="#111827"
                android:textSize="16sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/tvContactSub"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:text="NV0012  •  Số: 1001 (Kỹ thuật)"
                android:textColor="#6B7280"
                android:textSize="12sp" />
        </LinearLayout>

        <ImageButton
            android:id="@+id/btnFavorite"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginEnd="6dp"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Thêm vào danh bạ"
            android:src="@drawable/ic_person_add" />

        <ImageButton
            android:id="@+id/btnChatContact"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginEnd="6dp"
            android:padding="5dp"
            android:scaleType="fitCenter"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:src="@android:drawable/sym_action_chat"
            android:tint="@color/Blue" />

        <ImageButton
            android:id="@+id/btnCallContact"
            android:layout_width="42dp"
            android:layout_height="42dp"
            android:background="@drawable/bg_circle_green"
            android:contentDescription="Call"
            android:src="@android:drawable/sym_action_call"
            android:tint="#FFFFFF" />
        <!-- Đặt ngay sau ImageButton @+id/btnCallContact trong item_contact.xml -->
        <ImageButton
            android:id="@+id/btnDeleteFavorite"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:layout_marginStart="10dp"
            android:background="@drawable/bg_circle_red"
            android:contentDescription="Xóa khỏi danh bạ"
            android:padding="8dp"
            android:scaleType="centerInside"
            android:src="@android:drawable/ic_menu_delete"
            android:tint="#FFFFFF"
            android:visibility="gone" />
    </LinearLayout>
</androidx.cardview.widget.CardView>
 	 	 	 	 
 	 	 	 	 	 	item_history.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<androidx.cardview.widget.CardView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="8dp"
    app:cardCornerRadius="10dp"
    app:cardElevation="1dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:padding="14dp">

        <ImageView
            android:id="@+id/tvCallDirection"
            android:layout_width="28dp"
            android:layout_height="28dp"
            android:scaleType="fitCenter" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="12dp"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tvHistoryName"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Trần Thị Bình"
                android:textColor="#111827"
                android:textSize="16sp"
                android:textStyle="bold" />

            <TextView
                android:id="@+id/tvHistorySub"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:text="Mã NV: NV0045  •  Ext: 1002"
                android:textColor="#6B7280"
                android:textSize="12sp" />
        </LinearLayout>

        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:gravity="end"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tvHistoryTime"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="10:42"
                android:textColor="#374151"
                android:textSize="12sp" />

            <TextView
                android:id="@+id/tvHistoryDuration"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:text="03:15"
                android:textColor="#6B7280"
                android:textSize="11sp" />
        </LinearLayout>
    </LinearLayout>
</androidx.cardview.widget.CardView>
 	 	 	 	 
 	 	 	 	 	menu	 	 	 	 	 	 
 	 	 	 	 	 	bottom_nav_menu.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<menu xmlns:android="http://schemas.android.com/apk/res/android">
    <item
        android:id="@+id/nav_history"
        android:icon="@drawable/ic_nav_history"
        android:title="History" />
    <item
        android:id="@+id/nav_chat"
        android:icon="@android:drawable/sym_action_chat"
        android:title="Nhắn tin"
        android:tint="#000000"/>
    <item
        android:id="@+id/nav_favorites"
        android:icon="@drawable/ic_nav_contact"
        android:title="Danh bạ" />
    <item
        android:id="@+id/nav_contact"
        android:icon="@drawable/ic_nav_search_directory"
        android:title="Tìm kiếm" />
</menu>	 	 	 	 	 
 	 	 	 	 	mipmap-hdpi	 	 	 	 	 	 
 	 	 	 	 	mipmap-mdpi	 	 	 	 	 	 
 	 	 	 	 	mipmap-xhdpi	 	 	 	 	 	 
 	 	 	 	 	mipmap-xxhdpi	 	 	 	 	 	 
 	 	 	 	 	mipmap-xxxhdpi	 	 	 	 	 	 
 	 	 	 	 	values	 	 	 	 	 	 
 	 	 	 	 	 	colors.xml	 	 	 	 	 
 	 	 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#1565C0</color>
    <color name="colorPrimaryDark">#0D47A1</color>
    <color name="colorAccent">#2E7D32</color>
    <color name="bgLight">#F5F7FA</color>
    <color name="callRed">#D32F2F</color>
    <color name="callGreen">#2E7D32</color>
    <color name="inCallBg">#121824</color>
    <color name="inCallBtnBg">#283548</color>
    <color name="white">#FFFFFF</color>
    <color name="Blue">#0068FF</color>
    <color name="Primary">#111111</color>
    <color name="Secondary">#757575</color>
</resources>
 	 	 	 	 
 	 	 	 	 	 	strings.xml	 	 	 	 	 
 	 	 	 	 	 	<resources>
    <string name="app_name">SmartCall 2.0</string>
</resources>
 	 	 	 	 
 	 	 	 	 	 	styles.xml	 	 	 	 	 
 	 	 	 	 	 	<resources>
    <style name="AppTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="DialpadKeyStyle">
        <item name="android:layout_width">64dp</item>
        <item name="android:layout_height">64dp</item>
        <item name="android:layout_margin">6dp</item>
        <item name="android:background">@drawable/bg_dialpad_key</item>
        <item name="android:gravity">center</item>
        <item name="android:textColor">#111827</item>
        <item name="android:textSize">24sp</item>
        <item name="android:textStyle">bold</item>
        <item name="android:clickable">true</item>
        <item name="android:focusable">true</item>
    </style>
</resources>	 	 	 	 	 
 	 	 	 	AndroidManifest.xml	 	 	 	 	 	 	 
 	 	 	 	<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.company.internalcall">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">

        <activity android:name=".ui.login.LoginActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />

                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <activity android:name=".ui.main.MainActivity" />
        <activity android:name=".ui.chat.ChatDetailActivity" />
        <activity
            android:name=".ui.call.InCallActivity"
            android:excludeFromRecents="false"
            android:launchMode="singleTop"
            android:showOnLockScreen="true"
            android:turnScreenOn="true"
            android:exported="false" />

        <service
            android:name=".service.WazoKeepAliveService"
            android:enabled="true"
            android:exported="false" />
    </application>

</manifest>	 	 	 	 	 	 	 
 	 	build.gradle	 	 	 	 	 	 	 	 	 
 	 	apply plugin: 'com.android.application'

android {
    compileSdkVersion 28
    defaultConfig {
        applicationId "com.company.internalcall"
        minSdkVersion 27
        versionCode 1
        versionName "1.0"
        vectorDrawables.useSupportLibrary = true
    }
    signingConfigs {
        release {
            storeFile file("../smartcall-release.jks")
            storePassword "123456"
            keyAlias "key0"
            keyPassword "123456"

            v1SigningEnabled true
            v2SigningEnabled true
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }

}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.0.2'
    implementation 'com.google.android.material:material:1.0.0'
    implementation 'androidx.constraintlayout:constraintlayout:1.1.3'
    implementation 'androidx.recyclerview:recyclerview:1.0.0'
    implementation 'androidx.cardview:cardview:1.0.0'
    // Thêm Retrofit + Gson + OkHttp để gọi REST API
    implementation 'com.squareup.retrofit2:retrofit:2.6.4'
    implementation 'com.squareup.retrofit2:converter-gson:2.6.4'
    implementation 'com.squareup.okhttp3:okhttp:3.12.13'
    implementation 'com.squareup.okhttp3:logging-interceptor:3.12.13'

// Google WebRTC Audio Engine từ Maven Central (tương thích Java 8 & minSdk 21)
    implementation 'io.github.webrtc-sdk:android:104.5112.09'

}
 	 	 	 	 	 	 	 	 
 	 	proguard-rules.pro	 	 	 	 	 	 	 	 	 
 	 	# Add project specific ProGuard rules here.
 	 	 	 	 	 	 	 	 
 	gradle	 	 	 	 	 	 	 	 	 	 
 	 	wrapper	 	 	 	 	 	 	 	 	 
 	 	 	gradle-wrapper.properties	 	 	 	 	 	 	 	 
 	 	 	distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-5.6.4-all.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
 	 	 	 	 	 	 	 
 	.gitignore	 	 	 	 	 	 	 	 	 	 
 	/local.properties
# Build outputs
build/
app/build/
.gradle/
.idea/	 	 	 	 	 	 	 	 	 	 
 	InternalCallApp.iml	 	 	 	 	 	 	 	 	 	 
 	<?xml version="1.0" encoding="UTF-8"?>
<module external.linked.project.id="InternalCallApp" external.linked.project.path="$MODULE_DIR$" external.root.project.path="$MODULE_DIR$" external.system.id="GRADLE" external.system.module.group="" external.system.module.version="unspecified" type="JAVA_MODULE" version="4">
  <component name="NewModuleRootManager" inherit-compiler-output="true">
    <exclude-output />
    <content url="file://$MODULE_DIR$">
      <excludeFolder url="file://$MODULE_DIR$/.gradle" />
      <excludeFolder url="file://$MODULE_DIR$/build" />
    </content>
    <orderEntry type="inheritedJdk" />
    <orderEntry type="sourceFolder" forTests="false" />
  </component>
</module>	 	 	 	 	 	 	 	 	 	 
 	build.gradle	 	 	 	 	 	 	 	 	 	 
 	buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:3.6.4'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        maven {
            url "https://download.linphone.org/releases/maven_repository"
        }
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
 	 	 	 	 	 	 	 	 	 
 	gradle.properties	 	 	 	 	 	 	 	 	 	 
 	org.gradle.jvmargs=-Xmx1536m -Djavax.net.ssl.trustStoreType=JKS
android.useAndroidX=true
android.enableJetifier=true	 	 	 	 	 	 	 	 	 	 
 	settings.gradle	 	 	 	 	 	 	 	 	 	 
 	include ':app'
rootProject.name='InternalCallApp'
 	 	 	 	 	 	 	 	 	 
 	smartcall-release.jks	 	 	 	 	 	 	 	 	 	 
 	[File nhị phân hoặc không thể đọc dưới dạng Text]	 	 	 	 	 	 	 	 	 	 