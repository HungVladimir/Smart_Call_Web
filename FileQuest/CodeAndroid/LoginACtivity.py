
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