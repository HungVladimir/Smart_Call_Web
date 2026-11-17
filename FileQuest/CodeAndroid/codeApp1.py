SmartCall2.0	 	 	 	 	 	 	 	 	 	 	 
 	app	 	 	 	 	 	 	 	 	 	 
 	 	release	 	 	 	 	 	 	 	 	 
 	 	 	SmartCall2.0-V1.0.apk	 	 	 	 	 	 	 	 
 	 	 	[File nhị phân hoặc không thể đọc dưới dạng Text]	 	 	 	 	 	 	 	 
 	 	 	output.json	 	 	 	 	 	 	 	 
 	 	 	[{"outputType":{"type":"APK"},"apkData":{"type":"MAIN","splits":[],"versionCode":1,"versionName":"1.0","enabled":true,"outputFile":"app-release.apk","fullName":"release","baseName":"release"},"path":"app-release.apk","properties":{}}]	 	 	 	 	 	 	 	 
 	 	src	 	 	 	 	 	 	 	 	 
 	 	 	main	 	 	 	 	 	 	 	 
 	 	 	 	java	 	 	 	 	 	 	 
 	 	 	 	 	com	 	 	 	 	 	 
 	 	 	 	 	 	company	 	 	 	 	 
 	 	 	 	 	 	 	internalcall	 	 	 	 
 	 	 	 	 	 	 	 	data	 	 	 
 	 	 	 	 	 	 	 	 	api	 	 
 	 	 	 	 	 	 	 	 	 	WazoWebSocketManager.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.api;


import android.os.Handler;
import android.os.Looper;

import okhttp3.WebSocket;


public class WazoWebSocketManager {
    private static final String TAG = "WazoWebSocket";

    public interface OnRealtimeMessageListener {
        void onNewChatMessage(String roomUuid, String senderUuid, String senderName, String content);
    }

    private static WazoWebSocketManager instance;
    private WebSocket webSocket;
    private OnRealtimeMessageListener chatListener;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static synchronized WazoWebSocketManager getInstance() {
        if (instance == null) instance = new WazoWebSocketManager();
        return instance;
    }

    public void setChatListener(OnRealtimeMessageListener listener) {
        this.chatListener = listener;
    }
}	 
 	 	 	 	 	 	 	 	 	local	 	 
 	 	 	 	 	 	 	 	 	 	ContactCache.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.local;

import com.company.internalcall.domain.model.UserContact;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ContactCache {
    private static final Map<String, UserContact> extensionMap = new HashMap<>();
    private static List<UserContact> cachedList = new ArrayList<>();

    public static void setContacts(List<UserContact> contacts) {
        cachedList.clear();
        extensionMap.clear();
        if (contacts == null) return;

        for (UserContact c : contacts) {
            // Chỉ nhận các nhân viên có số nằm trong dải 1000 - 1900
            if (SessionManager.isValidExtensionRange(c.getExtension())) {
                cachedList.add(c);
                extensionMap.put(c.getExtension(), c);
            }
        }
    }

    public static List<UserContact> getContacts() {
        return cachedList;
    }

    public static UserContact findByExtension(String extension) {
        return extensionMap.get(extension);
    }
}	 
 	 	 	 	 	 	 	 	 	 	SessionManager.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.local;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.dto.WazoAuthRequest;
import com.company.internalcall.data.remote.dto.WazoAuthResponse;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.ui.login.LoginActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class SessionManager {
    private static final String TAG = "SessionManager";
    private static final String PREF_NAME = "wazo_internal_call_prefs";
    private static final String KEY_TOKEN = "auth_token";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";
    private static final String KEY_USER_UUID = "user_uuid";
    private static final String KEY_EMP_CODE = "emp_code";
    private static final String KEY_FULL_NAME = "full_name";
    private static final String KEY_EXTENSION = "extension";
    private static final String KEY_SIP_USER = "sip_username";
    private static final String KEY_SIP_PASS = "sip_password";

    // Cờ chống gọi trùng lặp khi nhiều request cùng báo lỗi 401 một lúc
    private static final AtomicBoolean isRefreshingToken = new AtomicBoolean(false);
    private static final List<Runnable> pendingRetryCallbacks = new ArrayList<>();

    private final Context appContext;
    private final SharedPreferences prefs;

    public SessionManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.prefs = this.appContext.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public void saveRefreshToken(String refreshToken) {
        if (refreshToken != null && !refreshToken.isEmpty()) {
            prefs.edit().putString(KEY_REFRESH_TOKEN, refreshToken).apply();
        }
    }

    public String getRefreshToken() {
        return prefs.getString(KEY_REFRESH_TOKEN, "");
    }

    public void saveUserSession(String token, String userUuid, UserContact user) {
        isRefreshingToken.set(false);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_TOKEN, token);
        editor.putString(KEY_USER_UUID, userUuid);
        if (user != null) {
            editor.putString(KEY_EMP_CODE, user.getEmpCode());
            editor.putString(KEY_FULL_NAME, user.getFullName());
            editor.putString(KEY_EXTENSION, user.getExtension());
        }
        editor.apply();
    }

    public void updateTokenOnly(String newToken) {
        prefs.edit().putString(KEY_TOKEN, newToken).apply();
    }

    public void saveSipCredentials(String sipUsername, String sipPassword) {
        prefs.edit()
                .putString(KEY_SIP_USER, sipUsername)
                .putString(KEY_SIP_PASS, sipPassword)
                .apply();
    }

    public boolean isLoggedIn() {
        String token = getToken();
        String sipUser = getSipUsername();
        return token != null && !token.isEmpty() && sipUser != null && !sipUser.isEmpty();
    }

    public UserContact getCurrentUser() {
        String uuid = getUserUuid();
        String emp = prefs.getString(KEY_EMP_CODE, "NV0000");
        String name = prefs.getString(KEY_FULL_NAME, "Nhân viên");
        String ext = prefs.getString(KEY_EXTENSION, "");
        return new UserContact(uuid, emp, name, ext, "Wazo Internal", true);
    }

    public UserContact getSavedUser() {
        String ext = prefs.getString(KEY_EXTENSION, "");
        if (ext == null || ext.isEmpty()) return null;
        return getCurrentUser();
    }

    public static boolean isValidExtensionRange(String extension) {
        if (extension == null || extension.trim().isEmpty()) {
            return false;
        }
        try {
            int extNum = Integer.parseInt(extension.trim());
            return extNum >= 1000 && extNum <= 1999;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    public String getToken() {
        return prefs.getString(KEY_TOKEN, "");
    }

    public String getUserUuid() {
        return prefs.getString(KEY_USER_UUID, "");
    }

    public String getSipUsername() {
        return prefs.getString(KEY_SIP_USER, "");
    }

    public String getSipPassword() {
        return prefs.getString(KEY_SIP_PASS, "");
    }

    public void clearSession() {
        String savedClientId = getDeviceClientId();
        prefs.edit()
                .clear()
                .putString("device_client_id", savedClientId)
                .apply();
    }

    public void forceLogoutOnTokenExpired() {
        forceLogoutOnTokenExpired(null);
    }

    // Tự động dùng refresh_token để lấy auth_token mới khi hết hạn (401)
    public void forceLogoutOnTokenExpired(final Runnable onTokenRefreshed) {
        if (onTokenRefreshed != null) {
            synchronized (pendingRetryCallbacks) {
                pendingRetryCallbacks.add(onTokenRefreshed);
            }
        }

        if (!isRefreshingToken.compareAndSet(false, true)) {
            return;
        }

        final String refreshToken = getRefreshToken();
        if (refreshToken == null || refreshToken.isEmpty()) {
            performHardLogout("Phiên đăng nhập cần làm mới. Vui lòng đăng nhập lại 1 lần!");
            return;
        }

        Log.d(TAG, "Auth Token hết hạn (401). Đang dùng refresh_token để lấy token mới...");
        WazoAuthRequest refreshReq = WazoAuthRequest.forRefreshToken(refreshToken, getDeviceClientId());
        ApiClient.getService().refreshWazoToken(refreshReq).enqueue(new Callback<WazoAuthResponse>() {
            @Override
            public void onResponse(@NonNull Call<WazoAuthResponse> call, @NonNull Response<WazoAuthResponse> response) {
                if (response.isSuccessful() && response.body() != null && response.body().data != null) {
                    String newToken = response.body().data.token;
                    String newRefresh = response.body().data.refreshToken;
                    updateTokenOnly(newToken);
                    if (newRefresh != null && !newRefresh.isEmpty()) {
                        saveRefreshToken(newRefresh);
                    }
                    isRefreshingToken.set(false);
                    Log.d(TAG, "Đã cấp mới Auth Token thành công bằng refresh_token!");

                    List<Runnable> callbacksToRun;
                    synchronized (pendingRetryCallbacks) {
                        callbacksToRun = new ArrayList<>(pendingRetryCallbacks);
                        pendingRetryCallbacks.clear();
                    }

                    Handler mainHandler = new Handler(Looper.getMainLooper());
                    for (Runnable callback : callbacksToRun) {
                        mainHandler.post(callback);
                    }
                } else if (response.code() == 401 || response.code() == 400 || response.code() == 404) {
                    // Refresh token đã bị thu hồi trên server
                    performHardLogout("Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại!");
                } else {
                    // Lỗi mạng/server tạm thời -> giữ nguyên phiên để thử lại sau
                    isRefreshingToken.set(false);
                    synchronized (pendingRetryCallbacks) {
                        pendingRetryCallbacks.clear();
                    }
                    Log.w(TAG, "Tạm thời chưa đổi được token mới (HTTP " + response.code() + ")");
                }
            }

            @Override
            public void onFailure(@NonNull Call<WazoAuthResponse> call, @NonNull Throwable t) {
                isRefreshingToken.set(false);
                synchronized (pendingRetryCallbacks) {
                    pendingRetryCallbacks.clear();
                }
                Log.w(TAG, "Lỗi mạng khi đổi refresh_token: " + t.getMessage());
            }
        });
    }

    private void performHardLogout(final String message) {
        synchronized (pendingRetryCallbacks) {
            pendingRetryCallbacks.clear();
        }

        // Ngắt ngay kết nối SIP/WebSocket và Service nền để máy cũ không còn đổ chuông
        try {
            com.company.internalcall.service.WazoSipCallManager.getInstance().forceLogoutDueToConflict();
        } catch (Exception ignored) {}

        clearSession();
        isRefreshingToken.set(false);

        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(appContext, message, Toast.LENGTH_LONG).show();
                Intent intent = new Intent(appContext, LoginActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                appContext.startActivity(intent);
            }
        });
    }
    public String getDeviceClientId() {
        String id = prefs.getString("device_client_id", null);
        if (id == null || id.isEmpty()) {
            id = "smartcall-android-" + java.util.UUID.randomUUID().toString();
            prefs.edit().putString("device_client_id", id).apply();
        }
        return id;
    }
}	 
 	 	 	 	 	 	 	 	 	mock	 	 
 	 	 	 	 	 	 	 	 	 	MockDataSource.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.mock;

import com.company.internalcall.domain.model.CallLogItem;
import com.company.internalcall.domain.model.CallType;
import com.company.internalcall.domain.model.UserContact;

import java.util.Arrays;
import java.util.List;

public class MockDataSource {

    public static List<UserContact> getAssignedContacts() {
        return Arrays.asList(
                new UserContact("", "NV0012", "Nguyễn Văn An", "1001", "Kỹ thuật Vision", true),
                new UserContact("", "NV0045", "Trần Thị Bình", "1002", "QA / QC", true),
                new UserContact("", "NV0108", "Lê Hoàng Cường", "1003", "IT Hạ tầng", true),
                new UserContact("", "NV0156", "Phạm Minh Dũng", "1004", "Sản xuất Line 1", false),
                new UserContact("", "NV0210", "Hoàng Thu Hà", "1006", "Nhân sự", true),
                new UserContact("", "NV0289", "Vũ Đức Huy", "1007", "Kho vận", true),
                new UserContact("", "NV0315", "Đặng Ngọc Lan", "1008", "Kế toán", false)
        );
    }

    public static List<CallLogItem> getCallHistory() {
        return Arrays.asList(
                new CallLogItem("1", "Trần Thị Bình", "NV0045", "1002", CallType.INCOMING, "10:42", "03:15"),
                new CallLogItem("2", "Lê Hoàng Cường", "NV0108", "1003", CallType.MISSED, "09:15", "00:00"),
                new CallLogItem("3", "Nguyễn Văn An", "NV0012", "1001", CallType.OUTGOING, "Hôm qua", "01:48"),
                new CallLogItem("4", "Hoàng Thu Hà", "NV0210", "1006", CallType.OUTGOING, "Hôm qua", "05:20"),
                new CallLogItem("5", "Vũ Đức Huy", "NV0289", "1007", CallType.MISSED, "10/11", "00:00")
        );
    }

    public static UserContact loginAndAssignExtension(String empCode) {
        for (UserContact contact : getAssignedContacts()) {
            if (contact.getEmpCode().equalsIgnoreCase(empCode)) {
                return contact;
            }
        }
        String upperCode = empCode.toUpperCase();
        return new UserContact("", upperCode, "Nhân viên " + upperCode, "1005", "Nội bộ", true);
    }
}	 
 	 	 	 	 	 	 	 	 	model	 	 
 	 	 	 	 	 	 	 	 	 	ChatMessage.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.model;

public class ChatMessage {
    public String content;
    public String senderName;
    public String timestamp;
    public boolean isSentByMe;

    public ChatMessage(String content, boolean isSentByMe, String senderName, String time) {
        if (!isSentByMe) {
            this.senderName = senderName;
        } else { this.senderName = ""; }
        this.isSentByMe = isSentByMe;
        this.content = content;
        this.timestamp = time;
    }
}	 
 	 	 	 	 	 	 	 	 	remote	 	 
 	 	 	 	 	 	 	 	 	 	dto	 
 	 	 	 	 	 	 	 	 	 	 	LoginRequest.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;

public class LoginRequest {
    @SerializedName("emp_code")
    private final String empCode;

    @SerializedName("password")
    private final String password;

    public LoginRequest(String empCode, String password) {
        this.empCode = empCode;
        this.password = password;
    }
}
 	 	 	 	 	 	 	 	 	 	 	LoginResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;

public class LoginResponse {
    @SerializedName("wazo_token")
    private String wazoToken;

    @SerializedName("emp_code")
    private String empCode;

    @SerializedName("full_name")
    private String fullName;

    @SerializedName("extension")
    private String extension; // Số từ 1000 - 1900

    @SerializedName("department")
    private String department;

    @SerializedName("sip_username")
    private String sipUsername;

    @SerializedName("sip_secret")
    private String sipSecret;

    @SerializedName("is_new_assigned")
    private boolean isNewAssigned; // true nếu đăng nhập lần đầu và vừa được cấp số mới

    public String getWazoToken() { return wazoToken != null ? wazoToken : ""; }
    public String getEmpCode() { return empCode != null ? empCode : ""; }
    public String getFullName() { return fullName != null ? fullName : ""; }
    public String getExtension() { return extension != null ? extension : ""; }
    public String getDepartment() { return department != null ? department : "Nội bộ"; }
    public String getSipUsername() { return sipUsername != null ? sipUsername : ""; }
    public String getSipSecret() { return sipSecret != null ? sipSecret : ""; }
    public boolean isNewAssigned() { return isNewAssigned; }
}
 	 	 	 	 	 	 	 	 	 	 	WazoAuthRequest.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;

public class WazoAuthRequest {
    public static final String DEFAULT_CLIENT_ID = "smartcall-android-app";

    @SerializedName("backend")
    public String backend;

    @SerializedName("expiration")
    public int expiration;

    @SerializedName("access_type")
    public String accessType;

    @SerializedName("client_id")
    public String clientId;

    @SerializedName("refresh_token")
    public String refreshToken;

    // 1. Dùng khi đăng nhập lần đầu -> Truyền clientId riêng của từng máy
    public WazoAuthRequest(String deviceClientId) {
        this.backend = "wazo_user";
        this.expiration = 604800; // 7 ngày (604800 giây)
        this.accessType = "offline";
        this.clientId = (deviceClientId != null && !deviceClientId.isEmpty()) ? deviceClientId : DEFAULT_CLIENT_ID;
    }

    public WazoAuthRequest() {
        this(DEFAULT_CLIENT_ID);
    }

    // 2. Dùng khi token hết hạn -> Truyền đúng refreshToken và deviceClientId của máy này
    public static WazoAuthRequest forRefreshToken(String refreshToken, String deviceClientId) {
        WazoAuthRequest req = new WazoAuthRequest(deviceClientId);
        req.backend = null;
        req.accessType = null;
        req.expiration = 604800;
        req.refreshToken = refreshToken;
        return req;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoAuthResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;

public class WazoAuthResponse {
    @SerializedName("data")
    public Data data;

    public static class Data {
        @SerializedName("token")
        public String token;

        @SerializedName("refresh_token")
        public String refreshToken;

        @SerializedName("xivo_user_uuid")
        public String uuid;

        @SerializedName("session_uuid")
        public String sessionUuid;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoCdrResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoCdrResponse {
    @SerializedName("items")
    private List<CdrItem> items;

    public List<CdrItem> getItems() {
        return items;
    }

    public static class CdrItem {
        @SerializedName("id")
        private long id;

        @SerializedName("source_extension")
        private String sourceExtension;

        @SerializedName("source_name")
        private String sourceName;

        @SerializedName("destination_extension")
        private String destinationExtension;

        @SerializedName("destination_name")
        private String destinationName;

        @SerializedName("call_direction")
        private String direction;

        @SerializedName("answered")
        private boolean answered;

        @SerializedName("start")
        private String startTime;

        @SerializedName("duration")
        private Integer durationSeconds; // Dùng Integer vì Wazo trả null khi cuộc gọi nhỡ

        public long getId() { return id; }
        public String getSourceExtension() { return sourceExtension != null ? sourceExtension : ""; }
        public String getSourceName() { return sourceName != null ? sourceName : ""; }
        public String getDestinationExtension() { return destinationExtension != null ? destinationExtension : ""; }
        public String getDestinationName() { return destinationName != null ? destinationName : ""; }
        public String getDirection() { return direction != null ? direction : ""; }
        public boolean isAnswered() { return answered; }
        public String getStartTime() { return startTime != null ? startTime : ""; }
        public int getDurationSeconds() { return durationSeconds != null ? durationSeconds : 0; }
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoDirdContactsResponse.java
 	 	 	 	 	 	 	 	 	 	 	// WazoDirdContactsResponse.java
package com.company.internalcall.data.remote.dto;
import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoDirdContactsResponse {
    @SerializedName("items") public List<DirdContact> items;

    public static class DirdContact {
        @SerializedName("uuid") public String uuid;
        @SerializedName("firstname") public String firstname;
        @SerializedName("lastname") public String lastname;
        @SerializedName("username") public String username;
        @SerializedName("exten") public String exten;

        public String getDisplayName() {
            String fn = firstname != null ? firstname.trim() : "";
            String ln = lastname != null ? lastname.trim() : "";
            String full = (fn + " " + ln).trim();
            if (!full.isEmpty()) return full;
            if (username != null && !username.isEmpty()) return username;
            return exten != null ? exten : "?";
        }
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoDirdSourcesResponse.java
 	 	 	 	 	 	 	 	 	 	 	// WazoDirdSourcesResponse.java
package com.company.internalcall.data.remote.dto;
import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoDirdSourcesResponse {
    @SerializedName("items") public List<SourceItem> items;
    public static class SourceItem {
        @SerializedName("uuid") public String uuid;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoDirectoryResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoDirectoryResponse {
    @SerializedName("column_types")
    public List<String> columnTypes;

    @SerializedName("results")
    public List<ResultItem> results;

    public static class ResultItem {
        @SerializedName("column_values")
        public List<Object> columnValues;

        @SerializedName("source")
        public String source;

        @SerializedName("source_entry_id")
        public String sourceEntryId;

        @SerializedName("backend")
        public String backend;

        @SerializedName("favorite")
        public boolean favorite;

        @SerializedName("relations")
        public Relations relations;
    }

    public static class Relations {
        @SerializedName("user_uuid")
        public String userUuid;

        @SerializedName("xivo_id")
        public String xivoId;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoPresenceListResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoPresenceListResponse {
    @SerializedName("items")
    public List<UserPresenceItem> items;

    public static class UserPresenceItem {
        @SerializedName("uuid")
        public String uuid;

        @SerializedName("state")
        public String state; // "available", "unavailable", "away", "dnd"

        @SerializedName("connected")
        public boolean connected;

        @SerializedName("lines")
        public List<LinePresence> lines;

        // User được coi là Online khi state khác "unavailable"/"offline" hoặc có SIP line đang registered
        public boolean isOnline() {
            if ("available".equalsIgnoreCase(state) || "dnd".equalsIgnoreCase(state) || "away".equalsIgnoreCase(state)) {
                return true;
            }
            if (lines != null) {
                for (LinePresence lp : lines) {
                    if ("available".equalsIgnoreCase(lp.state) || "talking".equalsIgnoreCase(lp.state) || "ringing".equalsIgnoreCase(lp.state)) {
                        return true;
                    }
                }
            }
            return connected && !"unavailable".equalsIgnoreCase(state);
        }
    }

    public static class LinePresence {
        @SerializedName("id")
        public int id;

        @SerializedName("state")
        public String state; // "available", "unavailable", "talking", "ringing"
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoPresenceRequest.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;

public class WazoPresenceRequest {
    @SerializedName("state")
    public String state;

    @SerializedName("status")
    public String status;

    public WazoPresenceRequest(String state, String status) {
        this.state = state;
        this.status = status;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoPresencesResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoPresencesResponse {
    @SerializedName("items")
    public List<PresenceItem> items;

    public static class PresenceItem {
        @SerializedName("uuid")
        public String uuid;

        @SerializedName("tenant_uuid")
        public String tenantUuid;

        @SerializedName("state")
        public String state; // Trạng thái chatd (ví dụ: "available", "unavailable")

        @SerializedName("line_state")
        public String lineState; // Trạng thái Line SIP thực tế trên Asterisk

        @SerializedName("status")
        public String status;

        @SerializedName("do_not_disturb")
        public boolean doNotDisturb;

        @SerializedName("connected")
        public boolean connected;

        @SerializedName("lines")
        public List<LineStateItem> lines;

        // Kiểm tra trạng thái online thực tế từ state bên trong mảng lines
        public boolean isLineOnline() {
            if (lines != null && !lines.isEmpty()) {
                for (LineStateItem line : lines) {
                    if (line != null && line.state != null) {
                        if ("available".equalsIgnoreCase(line.state)
                                || "talking".equalsIgnoreCase(line.state)
                                || "ringing".equalsIgnoreCase(line.state)) {
                            return true;
                        }
                    }
                }
                return false;
            }
            // Fallback nếu JSON không có mảng lines
            return "available".equalsIgnoreCase(lineState);
        }
    }

    public static class LineStateItem {
        @SerializedName("id")
        public int id;

        @SerializedName("state")
        public String state;
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoSipEndpointResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoSipEndpointResponse {

    public static class UserLinesListResponse {
        @SerializedName("items")
        public List<LineSummary> items;
    }

    public static class LineSummary {
        @SerializedName("id")
        public int id;

        @SerializedName("name")
        public String name;
    }

    public static class SipAuthDetail {
        @SerializedName("uuid")
        public String uuid;

        @SerializedName("name")
        public String name;

        @SerializedName("auth_section_options")
        public List<List<String>> authSectionOptions;

        public String getUsername() {
            if (authSectionOptions != null) {
                for (List<String> pair : authSectionOptions) {
                    if (pair.size() >= 2 && "username".equals(pair.get(0))) return pair.get(1);
                }
            }
            return name != null ? name : "";
        }

        public String getPassword() {
            if (authSectionOptions != null) {
                for (List<String> pair : authSectionOptions) {
                    if (pair.size() >= 2 && "password".equals(pair.get(0))) return pair.get(1);
                }
            }
            return "";
        }
    }
}
 	 	 	 	 	 	 	 	 	 	 	WazoUserDetailResponse.java
 	 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class WazoUserDetailResponse {
    @SerializedName("uuid") public String uuid;
    @SerializedName("firstname") public String firstname;
    @SerializedName("lastname") public String lastname;
    @SerializedName("username") public String username;
    @SerializedName("lines") public List<LineItem> lines;

    public static class LineItem {
        @SerializedName("id") public int id;
        @SerializedName("name") public String name;
        @SerializedName("extensions") public List<ExtensionItem> extensions;
        @SerializedName("endpoint_sip") public EndpointSip endpointSip;
    }

    public static class ExtensionItem {
        @SerializedName("exten") public String exten;
    }

    public static class EndpointSip {
        @SerializedName("uuid") public String uuid;
        @SerializedName("name") public String name;
    }

    public String getFullName() {
        String fn = firstname != null ? firstname.trim() : "";
        String ln = lastname != null ? lastname.trim() : "";
        String full = (fn + " " + ln).trim();
        return full.isEmpty() ? (username != null ? username : "User") : full;
    }

    public String getPrimaryExtension() {
        if (lines != null && !lines.isEmpty()
                && lines.get(0).extensions != null
                && !lines.get(0).extensions.isEmpty()) {
            return lines.get(0).extensions.get(0).exten;
        }
        return "";
    }

    public int getPrimaryLineId() {
        if (lines != null && !lines.isEmpty()) {
            return lines.get(0).id;
        }
        return -1;
    }

    public String getPrimarySipUsername() {
        if (lines != null && !lines.isEmpty()) {
            if (lines.get(0).endpointSip != null && lines.get(0).endpointSip.name != null) {
                return lines.get(0).endpointSip.name;
            }
            if (lines.get(0).name != null) {
                return lines.get(0).name;
            }
        }
        return "";
    }

    public String getPrimarySipUuid() {
        if (lines != null && !lines.isEmpty()
                && lines.get(0).endpointSip != null
                && lines.get(0).endpointSip.uuid != null) {
            return lines.get(0).endpointSip.uuid;
        }
        return "";
    }
}
 	 	 	 	 	 	 	 	 	 	ApiClient.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote;

import java.io.IOException;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.logging.HttpLoggingInterceptor;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

public class ApiClient {
    // Giữ nguyên IP Wazo của bạn
    public static final String DEFAULT_HOST = "107.126.11.126:9443";
    private static WazoApiService apiService;

    public static WazoApiService getService() {
        if (apiService == null) {
            String baseUrl = "https://" + DEFAULT_HOST.replaceAll("/+$", "") + "/";
            Retrofit retrofit = new Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .client(getUnsafeOkHttpClient())
                    .addConverterFactory(GsonConverterFactory.create())
                    .build();
            apiService = retrofit.create(WazoApiService.class);
        }
        return apiService;
    }

    private static OkHttpClient getUnsafeOkHttpClient() {
        try {
            final TrustManager[] trustAllCerts = new TrustManager[]{
                    new X509TrustManager() {
                        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[]{}; }
                    }
            };

            final SSLContext sslContext = SSLContext.getInstance("TLSv1.2");
            sslContext.init(null, trustAllCerts, new SecureRandom());
            final SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            HttpLoggingInterceptor logging = new HttpLoggingInterceptor();
            logging.setLevel(HttpLoggingInterceptor.Level.BASIC); // Giảm log body 13KB tránh nghẽn logcat

            return new OkHttpClient.Builder()
                    .sslSocketFactory(sslSocketFactory, (X509TrustManager) trustAllCerts[0])
                    .hostnameVerifier((hostname, session) -> true)
                    .protocols(Collections.singletonList(Protocol.HTTP_1_1))
                    .retryOnConnectionFailure(true)
                    .addInterceptor(new Interceptor() {
                        @Override
                        public Response intercept(Chain chain) throws IOException {
                            Request original = chain.request();
                            Request request = original.newBuilder()
                                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0")
                                    .method(original.method(), original.body())
                                    .build();
                            return chain.proceed(request);
                        }
                    })
                    .addInterceptor(logging)
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .readTimeout(20, TimeUnit.SECONDS)
                    .writeTimeout(20, TimeUnit.SECONDS)
                    .build();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}	 
 	 	 	 	 	 	 	 	 	 	DirectoryMapper.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote;

import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.dto.WazoDirectoryResponse;
import com.company.internalcall.domain.model.UserContact;

import java.util.ArrayList;
import java.util.List;

public class DirectoryMapper {

    public static List<UserContact> mapFromDirectoryResponse(WazoDirectoryResponse response, String myUuid, boolean forceFavoriteFlag) {
        List<UserContact> list = new ArrayList<>();
        if (response == null || response.results == null) return list;

        for (WazoDirectoryResponse.ResultItem item : response.results) {
            String uuid = (item.relations != null && item.relations.userUuid != null) ? item.relations.userUuid : "";
            if (!uuid.isEmpty() && uuid.equals(myUuid)) continue;

            String name = "";
            String number = "";
            String empCode = "";

            if (item.columnValues != null) {
                for (Object valObj : item.columnValues) {
                    if (valObj == null) continue;
                    String val = String.valueOf(valObj).trim();
                    if (val.isEmpty() || "null".equalsIgnoreCase(val)
                            || "true".equalsIgnoreCase(val) || "false".equalsIgnoreCase(val)) {
                        continue;
                    }

                    // Nếu chuỗi là số máy nhánh hợp lệ (1000 - 1999)
                    if (SessionManager.isValidExtensionRange(val)) {
                        if (number.isEmpty()) {
                            number = val;
                        }
                    } else if (val.matches("^\\d+$")) {
                        // Số khác (không phải tên)
                        if (empCode.isEmpty()) empCode = val;
                    } else {
                        // Chuỗi chữ -> Ghép làm Họ tên hoặc Mã nhân viên
                        if (name.isEmpty()) {
                            name = val;
                        } else if (!name.contains(val) && !val.contains("@")) {
                            name = name + " " + val;
                        } else if (empCode.isEmpty()) {
                            empCode = val;
                        }
                    }
                }
            }

            if (!SessionManager.isValidExtensionRange(number)) continue;

            if (name.isEmpty()) name = "Máy nhánh " + number;
            if (empCode.isEmpty()) empCode = "EXT-" + number;

            String source = (item.source != null && !item.source.isEmpty()) ? item.source : "wazo";
            String entryId = (item.sourceEntryId != null && !item.sourceEntryId.isEmpty()) ? item.sourceEntryId : uuid;
            boolean isFav = forceFavoriteFlag || item.favorite;

            list.add(new UserContact(uuid, empCode, name, number, "Nội bộ", false, source, entryId, isFav));
        }

        return list;
    }
}	 
 	 	 	 	 	 	 	 	 	 	WazoApiService.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.data.remote;

import com.company.internalcall.data.remote.dto.WazoAuthRequest;
import com.company.internalcall.data.remote.dto.WazoAuthResponse;
import com.company.internalcall.data.remote.dto.WazoCdrResponse;
import com.company.internalcall.data.remote.dto.WazoDirdContactsResponse;
import com.company.internalcall.data.remote.dto.WazoDirdSourcesResponse;
import com.company.internalcall.data.remote.dto.WazoDirectoryResponse;
import com.company.internalcall.data.remote.dto.WazoPresencesResponse;
import com.company.internalcall.data.remote.dto.WazoUserDetailResponse;
import com.company.internalcall.data.remote.dto.WazoSipEndpointResponse;
import com.google.gson.JsonObject;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Headers;
import retrofit2.http.POST;
import retrofit2.http.PUT;
import retrofit2.http.Path;
import retrofit2.http.Query;

public interface WazoApiService {

    @Headers({
            "Accept: application/json",
            "Content-Type: application/json"
    })
    @POST("api/auth/0.1/token")
    Call<WazoAuthResponse> loginWazo(
            @Header("Authorization") String basicAuthHeader,
            @Body WazoAuthRequest request
    );

    @Headers("Accept: application/json")
    @GET("api/confd/1.1/users/{user_uuid}")
    Call<WazoUserDetailResponse> getMyProfile(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid
    );

    @Headers("Accept: application/json")
    @GET("api/dird/0.1/directories/default/sources?backend=wazo")
    Call<WazoDirdSourcesResponse> getDirdSources(
            @Header("X-Auth-Token") String token
    );

    @Headers("Accept: application/json")
    @GET("api/dird/0.1/backends/wazo/sources/{source_uuid}/contacts")
    Call<WazoDirdContactsResponse> getDirdContacts(
            @Header("X-Auth-Token") String token,
            @Path("source_uuid") String sourceUuid,
            @Query("limit") int limit
    );

    @Headers("Accept: application/json")
    @GET("api/call-logd/1.0/users/me/cdr")
    Call<WazoCdrResponse> getWazoCallHistory(
            @Header("X-Auth-Token") String token,
            @Query("limit") int limit
    );

    @Headers("Accept: application/json")
    @GET("api/confd/1.1/users/{user_uuid}/lines/{line_id}/associated/endpoints/sip")
    Call<WazoSipEndpointResponse.SipAuthDetail> getUserLineSipEndpoint(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid,
            @Path("line_id") int lineId
    );

    @Headers("Accept: application/json")
    @GET("api/confd/1.1/endpoints/sip/{sip_uuid}")
    Call<WazoSipEndpointResponse.SipAuthDetail> getSipEndpointDetail(
            @Header("X-Auth-Token") String token,
            @Path("sip_uuid") String sipUuid
    );

    @Headers({
            "Accept: application/json",
            "Content-Type: application/json"
    })
    @PUT("api/chatd/1.0/users/{user_uuid}/presences")
    Call<Void> updateMyPresence(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid,
            @Body com.company.internalcall.data.remote.dto.WazoPresenceRequest body
    );

    @GET("api/chatd/1.0/presences")
    Call<WazoPresencesResponse> getAllPresences(@Header("X-Auth-Token") String token);

    @GET("api/chatd/1.0/users/presences")
    Call<WazoPresencesResponse> getBatchPresences(
            @Header("X-Auth-Token") String token,
            @Query("user_uuid") String userUuids
    );

    @GET("api/dird/0.1/directories/favorites/{profile}")
    Call<WazoDirectoryResponse> getFavoriteContacts(
            @Header("X-Auth-Token") String token,
            @Path("profile") String profile
    );

    @GET("api/dird/0.1/directories/lookup/{profile}")
    Call<WazoDirectoryResponse> lookupContacts(
            @Header("X-Auth-Token") String token,
            @Path("profile") String profile,
            @Query("term") String term
    );

    @PUT("api/dird/0.1/directories/favorites/{directory}/{contact}")
    Call<Void> addFavoriteContact(
            @Header("X-Auth-Token") String token,
            @Path("directory") String directory,
            @Path("contact") String contactId
    );

    @DELETE("api/dird/0.1/directories/favorites/{directory}/{contact}")
    Call<Void> removeFavoriteContact(
            @Header("X-Auth-Token") String token,
            @Path("directory") String directory,
            @Path("contact") String contactId
    );

    @Headers("Accept: application/json")
    @GET("api/auth/0.1/users/{user_uuid}/sessions")
    Call<com.google.gson.JsonObject> getUserSessions(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid
    );

    @Headers("Accept: application/json")
    @DELETE("api/auth/0.1/users/{user_uuid}/sessions/{session_uuid}")
    Call<Void> deleteUserSession(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid,
            @Path("session_uuid") String sessionUuid
    );
    @Headers("Accept: application/json")
    @GET("api/auth/0.1/users/{user_uuid}/tokens")
    Call<com.google.gson.JsonObject> getUserRefreshTokens(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid
    );

    @Headers("Accept: application/json")
    @DELETE("api/auth/0.1/users/{user_uuid}/tokens/{client_id}")
    Call<Void> deleteUserRefreshToken(
            @Header("X-Auth-Token") String token,
            @Path("user_uuid") String userUuid,
            @Path("client_id") String clientId
    );

    @POST("api/auth/0.1/token")
    Call<WazoAuthResponse> refreshWazoToken(@Body WazoAuthRequest request);

    @GET("/api/dird/0.1/directories/lookup/{profile}")
    Call<JsonObject> searchDirectory(
            @Header("X-Auth-Token") String token,
            @Path("profile") String profile,
            @Query("term") String searchTerm
    );

    // WAZO-CHATD (/api/chatd/1.0) - Trạng thái & Chat nội bộ
    @GET("/api/chatd/1.0/users/me/rooms")
    Call<JsonObject> getMyChatRooms(
            @Header("X-Auth-Token") String token
    );

    @POST("/api/chatd/1.0/users/me/rooms")
    Call<JsonObject> createChatRoom(@Header("X-Auth-Token") String token, @Body JsonObject roomBody);

    @GET("/api/chatd/1.0/users/me/rooms/{room_uuid}/messages")
    Call<JsonObject> getRoomMessages(@Header("X-Auth-Token") String token, @Path("room_uuid") String roomUuid);

    @POST("/api/chatd/1.0/users/me/rooms/{room_uuid}/messages")
    Call<JsonObject> sendRoomMessage(@Header("X-Auth-Token") String token, @Path("room_uuid") String roomUuid, @Body JsonObject messageBody);

    // =========================================================================
    // WAZO-CALLD (/api/calld/1.0) - ĐIỀU KHIỂN CUỘC GỌI & GỌI NHÓM AD-HOC
    // =========================================================================

    // Lấy danh sách các cuộc gọi hiện tại của user
    @Headers("Accept: application/json")
    @GET("api/calld/1.0/users/me/calls")
    Call<JsonObject> getMyActiveCalls(
            @Header("X-Auth-Token") String token
    );

    // Tạo phòng họp nhóm Ad-hoc từ host_call_id và danh sách participant_call_ids
    @Headers({
            "Accept: application/json",
            "Content-Type: application/json"
    })
    @POST("api/calld/1.0/users/me/conferences/adhoc")
    Call<JsonObject> createAdhocConference(
            @Header("X-Auth-Token") String token,
            @Body JsonObject body
    );

    // Thêm một call_id mới vào phòng họp Ad-hoc đang diễn ra
    @Headers("Accept: application/json")
    @PUT("api/calld/1.0/users/me/conferences/adhoc/{conference_id}/participants/{call_id}")
    Call<Void> addParticipantToAdhocConference(
            @Header("X-Auth-Token") String token,
            @Path("conference_id") String conferenceId,
            @Path("call_id") String callId
    );

    // Giải tán phòng họp Ad-hoc (khi Chủ phòng kết thúc cuộc gọi)
    @Headers("Accept: application/json")
    @DELETE("api/calld/1.0/users/me/conferences/adhoc/{conference_id}")
    Call<Void> deleteAdhocConference(
            @Header("X-Auth-Token") String token,
            @Path("conference_id") String conferenceId
    );

    // Quay số mời thêm một thành viên và nối với cuộc gọi hiện tại
    @Headers({
            "Accept: application/json",
            "Content-Type: application/json"
    })
    @POST("api/calld/1.0/calls")
    Call<JsonObject> createCallAsAdmin(
            @Header("X-Auth-Token") String token,
            @Body JsonObject body
    );

    // Ngắt một nhánh call_id cụ thể
    @Headers("Accept: application/json")
    @DELETE("api/calld/1.0/users/me/calls/{call_id}")
    Call<Void> hangupUserCall(
            @Header("X-Auth-Token") String token,
            @Path("call_id") String callId
    );
}	 
 	 	 	 	 	 	 	 	domain	 	 	 
 	 	 	 	 	 	 	 	 	model	 	 
 	 	 	 	 	 	 	 	 	 	CallLogItem.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.domain.model;

public class CallLogItem {
    private String id;
    private String contactName;
    private String empCode;
    private String extension;
    private CallType type;
    private String timestamp;
    private String duration;

    public CallLogItem(String id, String contactName, String empCode, String extension, CallType type, String timestamp, String duration) {
        this.id = id;
        this.contactName = contactName;
        this.empCode = empCode;
        this.extension = extension;
        this.type = type;
        this.timestamp = timestamp;
        this.duration = duration;
    }

    public String getId() { return id; }
    public String getContactName() { return contactName; }
    public String getEmpCode() { return empCode; }
    public String getExtension() { return extension; }
    public CallType getType() { return type; }
    public String getTimestamp() { return timestamp; }
    public String getDuration() { return duration; }
}
 
 	 	 	 	 	 	 	 	 	 	CallType.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.domain.model;

public enum CallType {
    INCOMING, OUTGOING, MISSED
}
 
 	 	 	 	 	 	 	 	 	 	UserContact.java	 
 	 	 	 	 	 	 	 	 	 	package com.company.internalcall.domain.model;

import java.io.Serializable;

public class UserContact implements Serializable {
    private static final long serialVersionUID = 1L;

    private String uuid;
    private String empCode;
    private String fullName;
    private String extension;
    private String department;
    private boolean isOnline;

    // Các trường phục vụ Wazo Favorites API
    private String source = "wazo";
    private String sourceEntryId = "";
    private boolean isFavorite = false;

    public UserContact(String uuid, String empCode, String fullName, String extension, String department, boolean isOnline) {
        this.uuid = uuid != null ? uuid : "";
        this.empCode = empCode != null ? empCode : "";
        this.fullName = fullName != null ? fullName : "";
        this.extension = extension != null ? extension : "";
        this.department = department != null ? department : "";
        this.isOnline = isOnline;
    }

    public UserContact(String uuid, String empCode, String fullName, String extension, String department,
                       boolean isOnline, String source, String sourceEntryId, boolean isFavorite) {
        this(uuid, empCode, fullName, extension, department, isOnline);
        this.source = source != null ? source : "wazo";
        this.sourceEntryId = sourceEntryId != null ? sourceEntryId : "";
        this.isFavorite = isFavorite;
    }

    public String getUuid() { return uuid; }
    public void setUuid(String uuid) { this.uuid = uuid; }

    public String getEmpCode() { return empCode; }
    public String getFullName() { return fullName; }
    public String getExtension() { return extension; }
    public String getDepartment() { return department; }

    public boolean isOnline() { return isOnline; }
    public void setOnline(boolean online) { isOnline = online; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getSourceEntryId() { return sourceEntryId; }
    public void setSourceEntryId(String sourceEntryId) { this.sourceEntryId = sourceEntryId; }

    public boolean isFavorite() { return isFavorite; }
    public void setFavorite(boolean favorite) { isFavorite = favorite; }
}
	 	 	 	 	 	 	 	service	 	 	 
 	 	 	 	 	 	 	 	 	CallToneHelper.java	 	 
 	 	 	 	 	 	 	 	 	package com.company.internalcall.service;

import android.content.Context;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

public class CallToneHelper {
    private static ToneGenerator toneGen;
    private static Ringtone incomingRingtone;
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static boolean isRingbackPlaying = false;

    private static ToneGenerator getToneGen() {
        if (toneGen == null) {
            try {
                toneGen = new ToneGenerator(AudioManager.STREAM_VOICE_CALL, 75);
            } catch (Exception ignored) {}
        }
        return toneGen;
    }

    // 1. Âm thanh bấm phím số Dialpad (DTMF)
    public static void playDtmf(char digit) {
        ToneGenerator tg = getToneGen();
        if (tg == null) return;
        int toneType = ToneGenerator.TONE_DTMF_0;
        if (digit >= '0' && digit <= '9') {
            toneType = ToneGenerator.TONE_DTMF_0 + (digit - '0');
        }
        tg.startTone(toneType, 120);
    }

    // 2. Chuông chờ cuộc gọi đi (Ringback: Tút... Tút... lặp lại mỗi 3 giây)
    public static void startRingback() {
        if (isRingbackPlaying) return;
        isRingbackPlaying = true;
        Runnable loop = new Runnable() {
            @Override
            public void run() {
                if (!isRingbackPlaying) return;
                ToneGenerator tg = getToneGen();
                if (tg != null) tg.startTone(ToneGenerator.TONE_SUP_RINGTONE, 1000);
                handler.postDelayed(this, 3000);
            }
        };
        handler.post(loop);
    }

    public static void stopRingback() {
        isRingbackPlaying = false;
        handler.removeCallbacksAndMessages(null);
        ToneGenerator tg = getToneGen();
        if (tg != null) tg.stopTone();
    }

    // 3. Chuông reo khi có cuộc gọi đến
    public static void startIncomingRing(Context context) {
        try {
            stopIncomingRing();
            Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            incomingRingtone = RingtoneManager.getRingtone(context.getApplicationContext(), ringUri);
            if (incomingRingtone != null) incomingRingtone.play();
        } catch (Exception ignored) {}
    }

    public static void stopIncomingRing() {
        try {
            if (incomingRingtone != null && incomingRingtone.isPlaying()) {
                incomingRingtone.stop();
            }
        } catch (Exception ignored) {}
    }

    // 4. Âm thanh kết thúc cuộc gọi (3 tiếng bíp cúp máy)
    public static void playCallEnded() {
        stopRingback();
        stopIncomingRing();
        ToneGenerator tg = getToneGen();
        if (tg != null) {
            tg.startTone(ToneGenerator.TONE_PROP_BEEP2, 400);
        }
    }
}	 	 
 	 	 	 	 	 	 	 	 	VoipServicePlaceholder.java	 	 
 	 	 	 	 	 	 	 	 	package com.company.internalcall.service;

/**
 * Giai đoạn 2 (Tích hợp Backend Wazo):
 * - Đặt VoipForegroundService giữ kết nối wazo-websocketd qua Wi-Fi
 * - Đặt WazoSipWebRtcManager xử lý REGISTER và truyền âm thanh
 */
public class VoipServicePlaceholder {
}
 	 
 	 	 	 	 	 	 	 	 	WazoKeepAliveService.java	 	 
 	 	 	 	 	 	 	 	 	package com.company.internalcall.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.company.internalcall.R;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.ui.call.InCallActivity;
import com.company.internalcall.ui.main.MainActivity;

public class WazoKeepAliveService extends Service {
    private static final String CHANNEL_ID = "wazo_sip_silent_keep_alive_v2";
    private static final int NOTIFICATION_ID = 1001;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    public static void startIfLoggedIn(Context context) {
        if (context == null) return;
        SessionManager sm = new SessionManager(context);
        String sipUser = sm.getSipUsername();
        String sipPass = sm.getSipPassword();
        if (sipUser != null && !sipUser.isEmpty() && sipPass != null && !sipPass.isEmpty()) {
            Intent serviceIntent = new Intent(context, WazoKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        }
    }

    /**
     * Cập nhật trực tiếp thông báo 1001 giữa chế độ "Trực tuyến" và "Đang trong cuộc gọi"
     */
    public static void updateNotificationState(Context context, boolean showOngoingCall, String callerName, String callerExt, long connectedTimestamp) {
        if (context == null) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Notification notification = buildServiceNotification(context, showOngoingCall, callerName, callerExt, connectedTimestamp);
        manager.notify(NOTIFICATION_ID, notification);
    }

    private static Notification buildServiceNotification(Context context, boolean showOngoingCall, String callerName, String callerExt, long connectedTimestamp) {
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        boolean hasActiveCall = showOngoingCall && callManager.hasActiveCall();

        Intent targetIntent;
        String title;
        String text;

        if (hasActiveCall) {
            String ext = (callerExt != null && !callerExt.isEmpty()) ? callerExt : callManager.getActiveTargetExt();
            String name = (callerName != null && !callerName.isEmpty()) ? callerName : callManager.getActiveTargetName();
            if (name == null || name.isEmpty()) {
                name = "Máy nhánh " + ext;
            }

            title = "Đang gọi: " + name + (ext != null && !ext.isEmpty() ? " (" + ext + ")" : "");
            text = callManager.isIncomingRinging()
                    ? "Cuộc gọi đến - Chạm để quay lại"
                    : "Đang trong cuộc gọi - Chạm để quay lại";

            targetIntent = new Intent(context, InCallActivity.class);
            targetIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            targetIntent.putExtra("target_ext", ext);
            targetIntent.putExtra("target_name", name);
            targetIntent.putExtra("is_incoming", callManager.isIncomingRinging());
        } else {
            title = "SmartCall";
            text = "Trực tuyến";
            targetIntent = new Intent(context, MainActivity.class);
            targetIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, targetIntent, pendingFlags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_call_end)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .setSound(null)
                .setVibrate(new long[]{0L})
                .setOngoing(true)
                .setContentIntent(pendingIntent);

        if (hasActiveCall && connectedTimestamp > 0L && !callManager.isIncomingRinging()) {
            builder.setWhen(connectedTimestamp)
                    .setShowWhen(true)
                    .setUsesChronometer(true);
        } else {
            builder.setShowWhen(false)
                    .setUsesChronometer(false);
        }

        return builder.build();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        setupCrashCallCleanup();
        createNotificationChannel();
        acquireNetworkLocks();
    }

    private void setupCrashCallCleanup() {
        final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                WazoSipCallManager callManager = WazoSipCallManager.getInstance();
                if (callManager.hasActiveCall()) {
                    CallToneHelper.stopRingback();
                    CallToneHelper.stopIncomingRing();
                    callManager.cancelIncomingCallNotification();
                    callManager.hangup();
                    Thread.sleep(300);
                }
            } catch (Exception ignored) {}

            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            } else {
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(1);
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildServiceNotification(this, false, null, null, 0L);
        startForeground(NOTIFICATION_ID, notification);

        SessionManager sm = new SessionManager(this);
        String sipUser = sm.getSipUsername();
        String sipPass = sm.getSipPassword();
        if (sipUser != null && !sipUser.isEmpty() && sipPass != null && !sipPass.isEmpty()) {
            WazoSipCallManager.getInstance().initAndRegister(getApplicationContext(), sipUser, sipPass);
        }

        return START_STICKY;
    }

    private void acquireNetworkLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SmartCall:SipWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null && wifiLock == null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "SmartCall:SipWifiLock");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseNetworkLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.deleteNotificationChannel("wazo_sip_keep_alive_channel");
                manager.deleteNotificationChannel("wazo_ongoing_call_channel");

                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Kết nối nền",
                        NotificationManager.IMPORTANCE_MIN
                );
                channel.setShowBadge(false);
                channel.setSound(null, null);
                channel.enableVibration(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        releaseNetworkLocks();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        WazoSipCallManager callManager = WazoSipCallManager.getInstance();
        if (callManager.hasActiveCall()) {
            CallToneHelper.stopRingback();
            CallToneHelper.stopIncomingRing();
            callManager.cancelIncomingCallNotification();
            callManager.hangup();
        }
        updateNotificationState(getApplicationContext(), false, null, null, 0L);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}	 	 
 	 	 	 	 	 	 	 	 	WazoSipCallManager.java	 	 
 	 	 	 	 	 	 	 	 	# --- PHẦN 1/5 CỦA FILE ---
package com.company.internalcall.service;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;

import com.company.internalcall.data.local.ContactCache;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.data.remote.ApiClient;
import com.company.internalcall.data.remote.dto.WazoPresenceRequest;
import com.company.internalcall.domain.model.UserContact;
import com.company.internalcall.ui.call.InCallActivity;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DataChannel;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class WazoSipCallManager {
    private static final String TAG = "WazoSipCallManager";
    private static WazoSipCallManager instance;

    private final Object webrtcLock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private Context appContext;
    private OkHttpClient wsClient;
    private WebSocket sipWebSocket;
    private WebSocket eventWebSocket;

    private String sipUsername = "";
    private String sipPassword = "";
    private String domainIp = "";
    private String wsUrl = "";
    private boolean wasIncomingCall = false;
    private static final int INCOMING_CALL_NOTIF_ID = 9999;

    // Các định danh mô phỏng chính xác 100% SIP.js bên trong Wazo.Phone.connect()
    private final String registerCallId = randomAlphaNum(22);
    private final String registerFromTag = randomAlphaNum(10);
    private final String sipJsContactName = randomAlphaNum(8);
    private final String sipJsViaDomain = randomAlphaNum(12) + ".invalid";
    private final String sipJsInstanceUuid = UUID.randomUUID().toString();

    private volatile boolean isRegistered = false;
    private volatile boolean isConnectingSip = false;
    private int cseqCounter = 80;

    private String pendingDialExtension = "";

    // Thông tin phiên gọi chính hiện tại (Primary Call Leg)
    private volatile String activeCallId = "";
    private volatile String activeFromTag = "";
    private volatile String activeToTag = "";
    private volatile String activeTargetExt = "";
    private volatile String activeRemoteContactUri = "";
    private volatile String activeInviteBranch = "";
    private volatile int activeInviteCseq = 0;
    private volatile boolean isCallConnected = false;

    // Thông tin cuộc gọi đến (Incoming INVITE)
    private volatile boolean isIncomingCall = false;
    private String incomingViaHeaders = "";
    private String incomingFromHeader = "";
    private String incomingToHeader = "";
    private String incomingCallId = "";
    private String incomingCseqHeader = "";
    private String incomingRemoteSdp = "";
    private String incomingCallerNumber = "";

    private String activeTargetName = "";

    // =========================================================================
    // TRẠNG THÁI GỌI NHÓM (GROUP CALL / AD-HOC CONFERENCE) & NHÁNH PHỤ
    // =========================================================================
    private volatile String activeWazoCallId = "";          // Ví dụ: "1794821349.864"
    private volatile String activeAdhocConferenceId = "";   // UUID phòng họp Ad-hoc trên Wazo
    private volatile String groupHostExtension = "";        // Số nội bộ của Chủ phòng (A)
    private volatile boolean isGroupCall = false;
    private volatile boolean isGroupHost = false;
    private volatile boolean groupHadMultipleConnected = false;
    private volatile long groupCreatedTimestamp = 0L;

    private final Set<String> groupParticipantExtensions = Collections.synchronizedSet(new LinkedHashSet<String>());
    private final Set<String> pendingGroupInviteExtensions = Collections.synchronizedSet(new LinkedHashSet<String>());
    private final Map<String, String> extensionToWazoCallIdMap = new ConcurrentHashMap<>();
    private final Set<String> mergedCallIds = Collections.synchronizedSet(new LinkedHashSet<String>());

    private static class SecondaryInviteLeg {
        String sipCallId;
        String targetExt;
        String targetName;
        String fromTag;
        String toTag = "";
        String branch = "";
        String remoteContactUri = "";
        int inviteCseq;
        String wazoCallId = "";
        boolean isAnswered = false;
    }

    private final Map<String, SecondaryInviteLeg> secondaryLegsBySipCallId = new ConcurrentHashMap<>();

    public String getActiveTargetExt() {
        return activeTargetExt != null ? activeTargetExt : "";
    }

    public String getActiveTargetName() {
        return activeTargetName != null ? activeTargetName : "";
    }

    public boolean isIncomingRinging() {
        return isIncomingCall && !isCallConnected;
    }

    public boolean isGroupCall() {
        return isGroupCall;
    }

    public boolean isGroupHost() {
        return isGroupHost;
    }

    public List<String> getGroupParticipantExtensions() {
        synchronized (groupParticipantExtensions) {
            return new ArrayList<>(groupParticipantExtensions);
        }
    }

    public String getFormattedGroupMembersSummary() {
        List<String> exts = getGroupParticipantExtensions();
        if (exts.isEmpty()) {
            return "";
        }
        List<String> names = new ArrayList<>();
        for (String ext : exts) {
            UserContact c = ContactCache.findByExtension(ext);
            if (c != null && c.getFullName() != null && !c.getFullName().trim().isEmpty()) {
                names.add(c.getFullName().trim());
            } else {
                names.add("Số " + ext);
            }
        }
        return TextUtils.join(", ", names) + " (" + names.size() + " người)";
    }

    // WebRTC Audio
    private PeerConnectionFactory peerConnectionFactory;
    private PeerConnection peerConnection;
    private AudioTrack localAudioTrack;
    private AudioSource audioSource;
    private volatile boolean remoteSdpSet = false;

    private volatile boolean logoutRequested = false;
    private volatile int unregisterCseq = -1;

    private Runnable logoutCallback;
    private final Runnable logoutTimeoutRunnable = this::finishLogout;
    private final AtomicBoolean logoutFinished = new AtomicBoolean(false);

    private CallStateCallback uiCallback;

    private final Runnable keepAliveRunnable = new Runnable() {
        @Override
        public void run() {
            if (logoutRequested) return;
            try {
                if (sipWebSocket != null && isRegistered) {
                    sendSipRegister(null, null, null);

                    android.os.PowerManager pm = (appContext != null)
                            ? (android.os.PowerManager) appContext.getSystemService(Context.POWER_SERVICE)
                            : null;
                    boolean isScreenOn = (pm != null && pm.isInteractive());

                    if (isScreenOn) {
                        if (hasActiveCall() && isGroupCall && isGroupHost) {
                            broadcastGroupStateViaPresence();
                        } else {
                            String currentStatus = hasActiveCall() ? "Đang bận" : "Sẵn sàng";
                            String currentState = hasActiveCall() ? "unavailable" : "available";
                            publishPresence(currentState, currentStatus);
                        }
                    }
                } else if (!sipUsername.isEmpty() && !sipPassword.isEmpty()) {
                    connectSipWebSocket();
                    connectWazoEventWebSocket();
                }
            } catch (Exception ignored) {}
            mainHandler.postDelayed(this, 120_000);
        }
    };

    public interface CallStateCallback {
        void onCallStateChanged(String statusText, boolean isConnected, boolean isEnded);
        default void onGroupParticipantsUpdated(boolean isGroup, String titleText, String membersSummary, int memberCount) {}
    }

    public static synchronized WazoSipCallManager getInstance() {
        if (instance == null) {
            instance = new WazoSipCallManager();
        }
        return instance;
    }

    public void setCallStateCallback(CallStateCallback callback) {
        this.uiCallback = callback;
        if (callback != null && isGroupCall) {
            notifyGroupUiUpdated();
        }
    }

    public boolean isIncomingCall() {
        return isIncomingCall;
    }

    public synchronized void initAndRegister(Context context, String username, String password) {
        if (context != null) {
            this.appContext = context.getApplicationContext();
        }
        logoutRequested = false;
        if (username == null || username.isEmpty() || password == null || password.isEmpty()) {
            Log.e(TAG, "Thiếu SIP username/password -> Không thể REGISTER");
            return;
        }

        boolean userChanged = !username.equals(this.sipUsername) || !password.equals(this.sipPassword);
        this.sipUsername = username;
        this.sipPassword = password;

        setupHostUrls();
        initWebRtcFactory();

        if (!userChanged && (isConnectingSip || (sipWebSocket != null && isRegistered))) {
            Log.d(TAG, "SIP WebSocket đang hoạt động, bỏ qua kết nối trùng lặp.");
            return;
        }

        connectSipWebSocket();
        if (eventWebSocket == null) {
            connectWazoEventWebSocket();
        }

        mainHandler.removeCallbacks(keepAliveRunnable);
        mainHandler.postDelayed(keepAliveRunnable, 120_000);
    }

    public void publishPresence(final String state, final String statusText) {
        if (appContext == null) return;
        final SessionManager sm = new SessionManager(appContext);
        final String token = sm.getToken();
        final String userUuid = sm.getUserUuid();
        final String clientId = sm.getDeviceClientId();
        if (token == null || token.isEmpty() || userUuid == null || userUuid.isEmpty()) return;

        String baseStatus = (statusText != null && !statusText.isEmpty()) ? statusText : "Trực tuyến";
        String taggedStatus = baseStatus.contains("smartcall-android-")
                ? baseStatus
                : baseStatus + " [" + clientId + "]";

        final WazoPresenceRequest req = new WazoPresenceRequest(state, taggedStatus);
        ApiClient.getService().updateMyPresence(token, userUuid, req)
                .enqueue(new retrofit2.Callback<Void>() {
                    @Override
                    public void onResponse(retrofit2.Call<Void> call, retrofit2.Response<Void> response) {
                        Log.d(TAG, "Presence [" + state + " | " + taggedStatus + "] -> HTTP " + response.code());
                        if (response.code() == 401 || response.code() == 403) {
                            Log.e(TAG, "Token xác thực đã hết hạn hoặc bị thu hồi (HTTP " + response.code() + ") -> Kiểm tra & Logout");
                            sm.forceLogoutOnTokenExpired();
                        }
                    }

                    @Override
                    public void onFailure(retrofit2.Call<Void> call, Throwable t) {
                        Log.w(TAG, "Lỗi cập nhật Presence: " + t.getMessage());
                    }
                });
    }

    // Chủ phòng phát danh sách thành viên nhóm kèm mã số Host: [GROUP:hostExt:ext1,ext2,ext3]
    private void broadcastGroupStateViaPresence() {
        if (!isGroupCall || appContext == null) return;
        List<String> exts = getGroupParticipantExtensions();
        if (exts.isEmpty()) return;
        String hostExt = !groupHostExtension.isEmpty() ? groupHostExtension : getMyExtension();
        String groupTag = "[GROUP:" + hostExt + ":" + TextUtils.join(",", exts) + "]";
        publishPresence("unavailable", "Đang gọi nhóm " + groupTag);
    }

    private void notifyGroupUiUpdated() {
        final boolean groupFlag = isGroupCall;
        final List<String> exts = getGroupParticipantExtensions();
        final int count = exts.size();
        final String summary = groupFlag ? getFormattedGroupMembersSummary() : ("Số nội bộ: " + activeTargetExt);
        final String title = groupFlag ? "Cuộc gọi nhóm" : activeTargetName;

        if (groupFlag) {
            activeTargetName = "Cuộc gọi nhóm";
        }

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (uiCallback != null) {
                    uiCallback.onGroupParticipantsUpdated(groupFlag, title, summary, count);
                }
            }
        });
    }

    private String getMyExtension() {
        if (appContext == null) return "";
        SessionManager sm = new SessionManager(appContext);
        if (sm.getCurrentUser() != null && sm.getCurrentUser().getExtension() != null) {
            return sm.getCurrentUser().getExtension().trim();
        }
        return "";
    }

    // =========================================================================
    // KỊCH BẢN 1 & 2: BẮT ĐẦU GỌI NHÓM TỪ DANH BẠ HOẶC THÊM NGƯỜI KHI ĐANG GỌI
    // =========================================================================

    public void startGroupCall(final List<String> targetExtensions) {
        if (targetExtensions == null || targetExtensions.isEmpty()) return;

        List<String> cleanList = new ArrayList<>();
        String myExt = getMyExtension();
        for (String ext : targetExtensions) {
            if (ext != null && !ext.trim().isEmpty() && !ext.trim().equals(myExt)) {
                if (!cleanList.contains(ext.trim())) {
                    cleanList.add(ext.trim());
                }
            }
        }
        if (cleanList.isEmpty()) return;

        if (cleanList.size() == 1) {
            makeCall(cleanList.get(0));
            return;
        }

        isGroupHost = true;
        groupHostExtension = myExt;
        isGroupCall = false;
        groupHadMultipleConnected = false;
        groupParticipantExtensions.clear();
        pendingGroupInviteExtensions.clear();

        if (!myExt.isEmpty()) {
            groupParticipantExtensions.add(myExt);
        }

        String firstTarget = cleanList.get(0);
        groupParticipantExtensions.add(firstTarget);

        for (int i = 1; i < cleanList.size(); i++) {
            pendingGroupInviteExtensions.add(cleanList.get(i));
        }

        UserContact firstContact = ContactCache.findByExtension(firstTarget);
        activeTargetName = (firstContact != null && !firstContact.getFullName().isEmpty())
                ? firstContact.getFullName() : ("Số nội bộ " + firstTarget);

        // Bắt đầu gọi nhánh đầu tiên, và sau 400ms (khi SDP Offer đã sẵn sàng) gọi đồng thời luôn các nhánh còn lại!
        makeCall(firstTarget);
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!pendingGroupInviteExtensions.isEmpty() && hasActiveCall()) {
                    List<String> extras = new ArrayList<>(pendingGroupInviteExtensions);
                    pendingGroupInviteExtensions.clear();
                    addParticipantsToCurrentCall(extras);
                }
            }
        }, 700);
    }

    public void addParticipantsToCurrentCall(final List<String> newExtensions) {
        if (newExtensions == null || newExtensions.isEmpty() || !hasActiveCall()) return;

        String myExt = getMyExtension();
        List<String> toInviteNow = new ArrayList<>();
        List<String> connectingLabels = new ArrayList<>();

        for (String ext : newExtensions) {
            if (ext != null && !ext.trim().isEmpty()) {
                String clean = ext.trim();
                if (!clean.equals(myExt) && !clean.equals(activeTargetExt)) {
                    toInviteNow.add(clean);
                    UserContact c = ContactCache.findByExtension(clean);
                    String name = (c != null && c.getFullName() != null && !c.getFullName().isEmpty())
                            ? c.getFullName() : "Số nội bộ";
                    connectingLabels.add(name + " (" + clean + ")");
                }
            }
        }

        if (toInviteNow.isEmpty()) return;

        String connectingMsg = "Đang kết nối " + TextUtils.join(", ", connectingLabels) + "...";
        notifyUi(connectingMsg, isCallConnected, false);

        // VẤN ĐỀ 1: Nếu máy này là NGƯỜI NHẬN CUỘC GỌI (B), KHÔNG tự làm Host mà gửi lệnh ủy quyền về cho Chủ phòng (A)
        if (wasIncomingCall && !isGroupHost) {
            String hostExt = !groupHostExtension.isEmpty() ? groupHostExtension : activeTargetExt;
            String reqTag = "[ADD_REQ:" + hostExt + ":" + TextUtils.join(",", toInviteNow) + "]";
            Log.d(TAG, "Máy thành viên ủy quyền cho Chủ phòng (" + hostExt + ") mời thêm: " + reqTag);
            publishPresence("unavailable", "Đang bận " + reqTag);
            return;
        }

        // Nếu máy này là Chủ phòng (A - người gọi ban đầu)
        isGroupHost = true;
        groupHostExtension = myExt;
        if (!myExt.isEmpty()) {
            groupParticipantExtensions.add(myExt);
        }
        if (activeTargetExt != null && !activeTargetExt.isEmpty() && !activeTargetExt.equals(myExt)) {
            groupParticipantExtensions.add(activeTargetExt);
        }

        ensureHostCallIdAndInvite(toInviteNow);
    }

    private void ensureHostCallIdAndInvite(final List<String> extensionsToInvite) {
        if (appContext == null || extensionsToInvite.isEmpty()) return;
        final SessionManager sm = new SessionManager(appContext);
        final String token = sm.getToken();
        if (token == null || token.isEmpty()) return;

        ApiClient.getService().getMyActiveCalls(token).enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonArray items = response.body().getAsJsonArray("items");
                    if (items != null) {
                        for (JsonElement el : items) {
                            JsonObject callObj = el.getAsJsonObject();
                            String sipId = callObj.has("sip_call_id") && !callObj.get("sip_call_id").isJsonNull()
                                    ? callObj.get("sip_call_id").getAsString() : "";
                            String cId = callObj.has("call_id") && !callObj.get("call_id").isJsonNull()
                                    ? callObj.get("call_id").getAsString() : "";

                            if (!cId.isEmpty() && (sipId.equals(activeCallId) || activeWazoCallId.isEmpty())) {
                                activeWazoCallId = cId;
                            }

                            if (callObj.has("talking_to") && callObj.get("talking_to").isJsonObject()) {
                                JsonObject talkingTo = callObj.getAsJsonObject("talking_to");
                                for (String peerCallId : talkingTo.keySet()) {
                                    if (activeTargetExt != null && !activeTargetExt.isEmpty()) {
                                        extensionToWazoCallIdMap.put(activeTargetExt, peerCallId);
                                    }
                                }
                            }
                        }
                    }
                }
                originateAndMergeParticipants(token, extensionsToInvite);
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                originateAndMergeParticipants(token, extensionsToInvite);
            }
        });
    }

    private void originateAndMergeParticipants(final String token, final List<String> extensionsToInvite) {
        String localSdp = getSafeLocalSdp();
        if (localSdp.isEmpty()) {
            Log.e(TAG, "Chưa có Local SDP, thử lại sau 400ms...");
            mainHandler.postDelayed(() -> originateAndMergeParticipants(token, extensionsToInvite), 400);
            return;
        }

        for (final String targetExt : extensionsToInvite) {
            // Tránh gửi trùng nếu đang đổ chuông tới số này rồi
            boolean alreadyRinging = false;
            for (SecondaryInviteLeg existing : secondaryLegsBySipCallId.values()) {
                if (targetExt.equals(existing.targetExt)) {
                    alreadyRinging = true;
                    break;
                }
            }
            if (alreadyRinging) continue;

            SecondaryInviteLeg leg = new SecondaryInviteLeg();
            leg.sipCallId = randomAlphaNum(20);
            leg.targetExt = targetExt;
            UserContact c = ContactCache.findByExtension(targetExt);
            leg.targetName = (c != null && !c.getFullName().isEmpty()) ? c.getFullName() : ("Số " + targetExt);
            leg.fromTag = randomAlphaNum(10);

            secondaryLegsBySipCallId.put(leg.sipCallId, leg);
            sendSecondarySipInvite(leg, localSdp, null, null, null);
        }
    }

    private void sendSecondarySipInvite(SecondaryInviteLeg leg, String sdpBody, String realm, String nonce, String qop) {
        leg.inviteCseq = cseqCounter++;
        leg.branch = "z9hG4bK" + (1000000 + new Random().nextInt(8999999));
        String targetUri = "sip:" + leg.targetExt + "@" + domainIp;

        StringBuilder sb = new StringBuilder();
        sb.append("INVITE ").append(targetUri).append(" SIP/2.0\r\n");
        sb.append("Via: SIP/2.0/WSS ").append(sipJsViaDomain).append(";branch=").append(leg.branch).append("\r\n");
        sb.append("Max-Forwards: 70\r\n");
        sb.append("To: <").append(targetUri).append(">\r\n");
        sb.append("From: <sip:").append(sipUsername).append("@").append(domainIp).append(">;tag=").append(leg.fromTag).append("\r\n");
        sb.append("Call-ID: ").append(leg.sipCallId).append("\r\n");
        sb.append("CSeq: ").append(leg.inviteCseq).append(" INVITE\r\n");

        if (realm != null && nonce != null) {
            String authHeader = buildDigestAuth("INVITE", targetUri, realm, nonce, qop);
            sb.append("Authorization: ").append(authHeader).append("\r\n");
        }

        sb.append("Contact: <sip:").append(sipJsContactName).append("@").append(sipJsViaDomain).append(";transport=ws;ob>\r\n");
        sb.append("Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n");
        sb.append("Supported: outbound, path, gruu\r\n");
        sb.append("User-Agent: Wazo WebRTC Client\r\n");
        sb.append("Content-Type: application/sdp\r\n");
        sb.append("Content-Length: ").append(sdpBody.getBytes().length).append("\r\n\r\n");
        sb.append(sdpBody);

        Log.d(TAG, "Gửi SIP INVITE mời thành viên phụ: " + leg.targetExt + " (Call-ID=" + leg.sipCallId + ")");
        sendRawSip(sb.toString());
    }

    private void sendSecondarySipAck(SecondaryInviteLeg leg, String responseHeaders, boolean is2xx) {
        String targetUri = "sip:" + leg.targetExt + "@" + domainIp;
        String requestUri = (is2xx && !leg.remoteContactUri.isEmpty()) ? leg.remoteContactUri : targetUri;
        String toTag = !leg.toTag.isEmpty() ? leg.toTag : extractToTag(responseHeaders);
        String toHeader = toTag.isEmpty() ? "<" + targetUri + ">" : "<" + targetUri + ">;tag=" + toTag;
        String branchToUse = is2xx ? ("z9hG4bK" + (1000000 + new Random().nextInt(8999999))) : leg.branch;

        String sb = "ACK " + requestUri + " SIP/2.0\r\n" +
                "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + branchToUse + "\r\n" +
                "Max-Forwards: 70\r\n" +
                "To: " + toHeader + "\r\n" +
                "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + leg.fromTag + "\r\n" +
                "Call-ID: " + leg.sipCallId + "\r\n" +
                "CSeq: " + leg.inviteCseq + " ACK\r\n" +
                "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                "Content-Length: 0\r\n\r\n";
        sendRawSip(sb);
    }

    private void sendSecondarySipCancelOrBye(SecondaryInviteLeg leg) {
        if (leg == null || leg.sipCallId == null || leg.sipCallId.isEmpty()) return;
        String targetUri = "sip:" + leg.targetExt + "@" + domainIp;
        if (!leg.isAnswered) {
            String cancelBranch = !leg.branch.isEmpty() ? leg.branch : ("z9hG4bK" + (1000000 + new Random().nextInt(8999999)));
            String cancelMsg = "CANCEL " + targetUri + " SIP/2.0\r\n" +
                    "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + cancelBranch + "\r\n" +
                    "Max-Forwards: 70\r\n" +
                    "To: <" + targetUri + ">\r\n" +
                    "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + leg.fromTag + "\r\n" +
                    "Call-ID: " + leg.sipCallId + "\r\n" +
                    "CSeq: " + leg.inviteCseq + " CANCEL\r\n" +
                    "Content-Length: 0\r\n\r\n";
            sendRawSip(cancelMsg);
        } else {
            String requestUri = !leg.remoteContactUri.isEmpty() ? leg.remoteContactUri : targetUri;
            int byeCseq = cseqCounter++;
            String branch = "z9hG4bK" + (1000000 + new Random().nextInt(8999999));
            String toVal = leg.toTag.isEmpty() ? "<" + targetUri + ">" : "<" + targetUri + ">;tag=" + leg.toTag;
            String byeMsg = "BYE " + requestUri + " SIP/2.0\r\n" +
                    "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + branch + "\r\n" +
                    "Max-Forwards: 70\r\n" +
                    "To: " + toVal + "\r\n" +
                    "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + leg.fromTag + "\r\n" +
                    "Call-ID: " + leg.sipCallId + "\r\n" +
                    "CSeq: " + byeCseq + " BYE\r\n" +
                    "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                    "Content-Length: 0\r\n\r\n";
            sendRawSip(byeMsg);
        }
    }

    // VẤN ĐỀ 2 & 3: Khi C (nhánh phụ) bấm nghe máy trong lúc B (nhánh chính) CHƯA nghe máy -> Hoán đổi C lên làm nhánh chính!
    private void swapSecondaryLegToPrimaryAndConnect(SecondaryInviteLeg answeredSecLeg, String sdpAnswer) {
        Log.d(TAG, "Hoán đổi nhánh phụ (" + answeredSecLeg.targetExt + ") lên làm nhánh chính vì nhánh đầu (" + activeTargetExt + ") chưa bắt máy!");

        // 1. Đẩy nhánh chính đang đổ chuông (B) xuống thành SecondaryInviteLeg để tiếp tục chờ B
        if (!activeCallId.isEmpty() && !activeTargetExt.isEmpty()) {
            SecondaryInviteLeg demotedPrimary = new SecondaryInviteLeg();
            demotedPrimary.sipCallId = activeCallId;
            demotedPrimary.targetExt = activeTargetExt;
            UserContact cB = ContactCache.findByExtension(activeTargetExt);
            demotedPrimary.targetName = (cB != null && !cB.getFullName().isEmpty()) ? cB.getFullName() : ("Số " + activeTargetExt);
            demotedPrimary.fromTag = activeFromTag;
            demotedPrimary.toTag = activeToTag;
            demotedPrimary.branch = activeInviteBranch;
            demotedPrimary.remoteContactUri = activeRemoteContactUri;
            demotedPrimary.inviteCseq = activeInviteCseq;
            demotedPrimary.wazoCallId = activeWazoCallId;
            demotedPrimary.isAnswered = false;

            secondaryLegsBySipCallId.put(demotedPrimary.sipCallId, demotedPrimary);
        }

        // 2. Xóa C khỏi map nhánh phụ và đưa C lên làm nhánh chính (Primary)
        secondaryLegsBySipCallId.remove(answeredSecLeg.sipCallId);
        activeCallId = answeredSecLeg.sipCallId;
        activeTargetExt = answeredSecLeg.targetExt;
        activeTargetName = answeredSecLeg.targetName;
        activeFromTag = answeredSecLeg.fromTag;
        activeToTag = answeredSecLeg.toTag;
        activeInviteBranch = answeredSecLeg.branch;
        activeRemoteContactUri = answeredSecLeg.remoteContactUri;
        activeInviteCseq = answeredSecLeg.inviteCseq;
        activeWazoCallId = answeredSecLeg.wazoCallId;

        // 3. Kết nối âm thanh WebRTC với C và bật đồng hồ đàm thoại ngay lập tức
        isCallConnected = true;
        CallToneHelper.stopRingback();
        CallToneHelper.stopIncomingRing();
        if (sdpAnswer != null && !sdpAnswer.isEmpty()) {
            forceSetRemoteAnswerSdp(sdpAnswer);
        }
        setSpeaker(false);

        // Kiểm tra xem còn nhánh phụ nào (như B) đang đổ chuông không để hiển thị trạng thái
        String pendingNames = getRingingSecondaryLegsLabel();
        String statusText = pendingNames.isEmpty() ? "Đang đàm thoại" : ("Đang kết nối " + pendingNames + "...");

        // Cập nhật lại tên người đang nói chuyện 1-1 trên InCallActivity thành C
        notifyGroupUiUpdated();
        notifyUi(statusText, true, false);
    }

    private String getRingingSecondaryLegsLabel() {
        List<String> labels = new ArrayList<>();
        for (SecondaryInviteLeg leg : secondaryLegsBySipCallId.values()) {
            if (!leg.isAnswered) {
                labels.add(leg.targetName + " (" + leg.targetExt + ")");
            }
        }
        return TextUtils.join(", ", labels);
    }

    private void promoteToGroupCallOnParticipantAnswered(final SecondaryInviteLeg answeredLeg) {
        String myExt = getMyExtension();
        isGroupCall = true;
        isGroupHost = true;
        groupHostExtension = myExt;
        groupHadMultipleConnected = true;
        groupCreatedTimestamp = System.currentTimeMillis();

        synchronized (groupParticipantExtensions) {
            groupParticipantExtensions.clear();
            if (!myExt.isEmpty()) {
                groupParticipantExtensions.add(myExt);
            }
            if (activeTargetExt != null && !activeTargetExt.isEmpty()) {
                groupParticipantExtensions.add(activeTargetExt);
            }
            for (SecondaryInviteLeg leg : secondaryLegsBySipCallId.values()) {
                if (leg.isAnswered) {
                    groupParticipantExtensions.add(leg.targetExt);
                }
            }
            groupParticipantExtensions.add(answeredLeg.targetExt);
        }

        notifyGroupUiUpdated();
        broadcastGroupStateViaPresence();

        if (appContext == null) return;
        final String token = new SessionManager(appContext).getToken();
        if (token == null || token.isEmpty()) return;

        // Đồng bộ lấy toàn bộ call_id của nhánh chính và nhánh phụ vừa nghe để gộp vào Ad-hoc Conference