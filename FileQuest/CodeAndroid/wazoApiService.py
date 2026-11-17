
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