	 	 	 	 	 	 	 	# --- PHẦN 2/5 CỦA FILE ---
etService().getMyActiveCalls(token).enqueue(new retrofit2.Callback<JsonObject>() {
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

                            if (sipId.equals(activeCallId) && !cId.isEmpty()) {
                                activeWazoCallId = cId;
                            } else if (sipId.equals(answeredLeg.sipCallId) && !cId.isEmpty()) {
                                answeredLeg.wazoCallId = cId;
                            }

                            if (callObj.has("talking_to") && callObj.get("talking_to").isJsonObject()) {
                                JsonObject talkingTo = callObj.getAsJsonObject("talking_to");
                                for (String peerCallId : talkingTo.keySet()) {
                                    if (sipId.equals(answeredLeg.sipCallId)) {
                                        extensionToWazoCallIdMap.put(answeredLeg.targetExt, peerCallId);
                                    } else if (sipId.equals(activeCallId) && !activeTargetExt.isEmpty()) {
                                        extensionToWazoCallIdMap.put(activeTargetExt, peerCallId);
                                    }
                                }
                            }
                        }
                    }
                }
                String peerCallIdToMerge = extensionToWazoCallIdMap.get(answeredLeg.targetExt);
                if (peerCallIdToMerge != null && !peerCallIdToMerge.isEmpty()) {
                    scheduleMergeIntoAdhocConference(token, peerCallIdToMerge);
                } else if (!answeredLeg.wazoCallId.isEmpty()) {
                    scheduleMergeIntoAdhocConference(token, answeredLeg.wazoCallId);
                }
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                if (!answeredLeg.wazoCallId.isEmpty()) {
                    scheduleMergeIntoAdhocConference(token, answeredLeg.wazoCallId);
                }
            }
        });
    }

    private void scheduleMergeIntoAdhocConference(final String token, final String newParticipantCallId) {
        if (newParticipantCallId == null || newParticipantCallId.isEmpty()) return;
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                mergeCallIntoAdhocConference(token, newParticipantCallId);
            }
        }, 400);
    }

    private void mergeCallIntoAdhocConference(final String token, final String participantCallId) {
        if (!hasActiveCall() || activeWazoCallId.isEmpty()) return;
        if (mergedCallIds.contains(participantCallId)) return;

        if (!activeAdhocConferenceId.isEmpty()) {
            mergedCallIds.add(participantCallId);
            ApiClient.getService().addParticipantToAdhocConference(token, activeAdhocConferenceId, participantCallId)
                    .enqueue(new retrofit2.Callback<Void>() {
                        @Override
                        public void onResponse(retrofit2.Call<Void> call, retrofit2.Response<Void> response) {
                            Log.d(TAG, "Thêm nhánh " + participantCallId + " vào Ad-hoc Conference " + activeAdhocConferenceId + " -> HTTP " + response.code());
                            broadcastGroupStateViaPresence();
                        }

                        @Override
                        public void onFailure(retrofit2.Call<Void> call, Throwable t) {
                            mergedCallIds.remove(participantCallId);
                        }
                    });
            return;
        }

        JsonObject body = new JsonObject();
        body.addProperty("host_call_id", activeWazoCallId);
        JsonArray partArray = new JsonArray();

        for (String existingCallId : extensionToWazoCallIdMap.values()) {
            if (existingCallId != null && !existingCallId.isEmpty() && !existingCallId.equals(activeWazoCallId)) {
                partArray.add(existingCallId);
                mergedCallIds.add(existingCallId);
            }
        }
        if (!mergedCallIds.contains(participantCallId) && !participantCallId.equals(activeWazoCallId)) {
            partArray.add(participantCallId);
            mergedCallIds.add(participantCallId);
        }

        if (partArray.size() == 0) return;
        body.add("participant_call_ids", partArray);

        ApiClient.getService().createAdhocConference(token, body).enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null && response.body().has("conference_id")) {
                    activeAdhocConferenceId = response.body().get("conference_id").getAsString();
                    Log.d(TAG, "Tạo Ad-hoc Conference thành công: conference_id=" + activeAdhocConferenceId);
                    broadcastGroupStateViaPresence();
                } else {
                    Log.w(TAG, "createAdhocConference HTTP " + response.code());
                    mergedCallIds.clear();
                }
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                mergedCallIds.clear();
            }
        });
    }

    private void setupHostUrls() {
        String hostWithPort = ApiClient.DEFAULT_HOST
                .replaceAll("^https?://", "")
                .replaceAll("/+$", "");
        this.domainIp = hostWithPort.contains(":") ? hostWithPort.split(":")[0] : hostWithPort;
        this.wsUrl = "https://" + hostWithPort + "/api/asterisk/ws";
    }

    private void initWebRtcFactory() {
        synchronized (webrtcLock) {
            if (peerConnectionFactory != null || appContext == null) return;
            PeerConnectionFactory.InitializationOptions initOptions =
                    PeerConnectionFactory.InitializationOptions.builder(appContext)
                            .createInitializationOptions();
            PeerConnectionFactory.initialize(initOptions);

            PeerConnectionFactory.Options options = new PeerConnectionFactory.Options();
            peerConnectionFactory = PeerConnectionFactory.builder()
                    .setOptions(options)
                    .createPeerConnectionFactory();
        }
    }

    private void connectWazoEventWebSocket() {
        if (appContext == null) return;
        if (logoutRequested) return;
        SessionManager sm = new SessionManager(appContext);
        String token = sm.getToken();
        if (token == null || token.isEmpty()) return;

        if (eventWebSocket != null) {
            try {
                eventWebSocket.close(1000, "Reconnect");
            } catch (Exception ignored) {}
        }
        if (wsClient == null) {
            wsClient = buildUnsafeWsClient();
        }

        String hostWithPort = ApiClient.DEFAULT_HOST
                .replaceAll("^https?://", "")
                .replaceAll("/+$", "");
        String eventUrl = "https://" + hostWithPort + "/api/websocketd/?token=" + token + "&version=2";

        Request request = new Request.Builder().url(eventUrl).build();
        eventWebSocket = wsClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                Log.d(TAG, "Connected to wazo-websocketd");
                String[] events = {
                        "call_created",
                        "call_answered",
                        "call_ended",
                        "call_updated",
                        "adhoc_conference_created",
                        "adhoc_conference_deleted",
                        "adhoc_conference_participant_joined",
                        "adhoc_conference_participant_left",
                        "conference_user_participant_joined",
                        "conference_user_participant_left",
                        "chatd_presence_updated",
                        "chatd_user_presence_updated",
                        "endpoint_status_updated",
                        "user_status_update",
                        "auth_session_deleted"
                };
                for (String ev : events) {
                    webSocket.send("{\"op\":\"subscribe\",\"data\":{\"event_name\":\"" + ev + "\"}}");
                }
                webSocket.send("{\"op\":\"start\"}");
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                Log.d(TAG, "WS-EVENT <<< " + text);
                if (text != null && text.contains("auth_session_deleted")) {
                    triggerSessionValidation();
                    return;
                }
                handleWazoEventMessage(text);
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                if (webSocket != eventWebSocket) return;
                Log.w(TAG, "wazo-websocketd closed: code=" + code + ", reason=" + reason);
                eventWebSocket = null;

                if (code == 4001 || code == 4002 || code == 4003 || code == 1008) {
                    triggerSessionValidation();
                    return;
                }

                if (!logoutRequested) {
                    mainHandler.postDelayed(() -> {
                        if (!logoutRequested) {
                            connectWazoEventWebSocket();
                        }
                    }, 5000);
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                if (webSocket != eventWebSocket) return;
                int httpCode = (response != null) ? response.code() : -1;
                Log.w(TAG, "wazo-websocketd failure (HTTP " + httpCode + "): " + t.getMessage());
                eventWebSocket = null;

                if (httpCode == 401 || httpCode == 403) {
                    triggerSessionValidation();
                    return;
                }

                if (!logoutRequested) {
                    mainHandler.postDelayed(() -> {
                        if (!logoutRequested) {
                            connectWazoEventWebSocket();
                        }
                    }, 5000);
                }
            }
        });
    }

    private void triggerSessionValidation() {
        if (appContext == null || logoutRequested) return;
        SessionManager sm = new SessionManager(appContext);
        sm.forceLogoutOnTokenExpired(() -> {
            if (!logoutRequested && eventWebSocket == null) {
                connectWazoEventWebSocket();
            }
        });
    }

    private void handleWazoEventMessage(String jsonText) {
        try {
            JSONObject root = new JSONObject(jsonText);
            if (!"event".equals(root.optString("op"))) return;
            JSONObject dataWrapper = root.optJSONObject("data");
            if (dataWrapper == null) return;

            String eventName = dataWrapper.optString("name", "");

            if ("chatd_user_presence_updated".equals(eventName) || "chatd_presence_updated".equals(eventName)) {
                JSONObject payload = dataWrapper.optJSONObject("data");
                if (payload != null && appContext != null) {
                    String eventUserUuid = payload.optString("uuid", "");
                    String statusText = payload.optString("status", "");

                    SessionManager sm = new SessionManager(appContext);
                    String myUserUuid = sm.getUserUuid();
                    String myClientId = sm.getDeviceClientId();
                    String myExt = getMyExtension();

                    // 1. Kiểm tra xung đột đăng nhập trên thiết bị khác
                    if (!myUserUuid.isEmpty() && myUserUuid.equals(eventUserUuid)
                            && statusText.contains("smartcall-android-")
                            && !statusText.contains(myClientId)) {
                        Log.w(TAG, "Phát hiện thiết bị mới đăng nhập (" + statusText + ") -> Buộc logout tức thì!");
                        sm.forceLogoutOnTokenExpired();
                        return;
                    }

                    // 2. VẤN ĐỀ 1: Chủ phòng (A) nhận yêu cầu ủy quyền thêm người [ADD_REQ:hostExt:1008,1009] từ máy thành viên (B)
                    if (hasActiveCall() && !wasIncomingCall && statusText.contains("[ADD_REQ:")) {
                        int start = statusText.indexOf("[ADD_REQ:") + 9;
                        int end = statusText.indexOf("]", start);
                        if (end > start) {
                            String content = statusText.substring(start, end).trim();
                            String[] segments = content.split(":");
                            if (segments.length == 2) {
                                String targetHostExt = segments[0].trim();
                                String csvToInvite = segments[1].trim();
                                if (targetHostExt.equals(myExt)) {
                                    List<String> delegatedExts = new ArrayList<>();
                                    for (String p : csvToInvite.split(",")) {
                                        if (!p.trim().isEmpty()) delegatedExts.add(p.trim());
                                    }
                                    if (!delegatedExts.isEmpty()) {
                                        Log.d(TAG, "Chủ phòng (" + myExt + ") nhận ủy quyền từ thành viên -> Quay số mời: " + delegatedExts);
                                        addParticipantsToCurrentCall(delegatedExts);
                                    }
                                }
                            }
                        }
                    }

                    // 3. Đồng bộ giao diện Gọi Nhóm cho tất cả thành viên khi nhận tag [GROUP:hostExt:1001,1002,1003]
                    if (hasActiveCall() && statusText.contains("[GROUP:")) {
                        int start = statusText.indexOf("[GROUP:") + 7;
                        int end = statusText.indexOf("]", start);
                        if (end > start) {
                            String content = statusText.substring(start, end).trim();
                            String hostExt = "";
                            String csv = content;
                            if (content.contains(":")) {
                                String[] segs = content.split(":", 2);
                                hostExt = segs[0].trim();
                                csv = segs[1].trim();
                            }

                            String[] parts = csv.split(",");
                            boolean includesMe = false;
                            List<String> parsedExts = new ArrayList<>();
                            for (String p : parts) {
                                String clean = p.trim();
                                if (!clean.isEmpty()) {
                                    parsedExts.add(clean);
                                    if (clean.equals(myExt) || clean.equals(activeTargetExt)) {
                                        includesMe = true;
                                    }
                                }
                            }
                            if (includesMe) {
                                if (!hostExt.isEmpty()) {
                                    groupHostExtension = hostExt;
                                    isGroupHost = hostExt.equals(myExt);
                                }
                                if (parsedExts.size() >= 2) {
                                    isGroupCall = true;
                                    synchronized (groupParticipantExtensions) {
                                        groupParticipantExtensions.clear();
                                        groupParticipantExtensions.addAll(parsedExts);
                                    }
                                    notifyGroupUiUpdated();
                                }
                            }
                        }
                    }
                }
            } else if ("call_created".equals(eventName) || "call_updated".equals(eventName)) {
                JSONObject payload = dataWrapper.optJSONObject("data");
                if (payload == null) return;

                String eventSipCallId = payload.optString("sip_call_id", "");
                String wazoCallId = payload.optString("call_id", "");
                String peerExt = payload.optString("peer_caller_id_number", "");

                if (!activeCallId.isEmpty() && activeCallId.equals(eventSipCallId) && !wazoCallId.isEmpty()) {
                    activeWazoCallId = wazoCallId;
                }

                SecondaryInviteLeg secLeg = (!eventSipCallId.isEmpty()) ? secondaryLegsBySipCallId.get(eventSipCallId) : null;
                if (secLeg != null && !wazoCallId.isEmpty()) {
                    secLeg.wazoCallId = wazoCallId;
                }

                JSONObject talkingTo = payload.optJSONObject("talking_to");
                if (talkingTo != null && talkingTo.length() > 0) {
                    Iterator<String> keys = talkingTo.keys();
                    while (keys.hasNext()) {
                        String otherCallId = keys.next();
                        String otherUserUuid = talkingTo.optString(otherCallId, "");
                        String resolvedExt = findExtensionByUserUuid(otherUserUuid);
                        if (!resolvedExt.isEmpty()) {
                            extensionToWazoCallIdMap.put(resolvedExt, otherCallId);
                        } else if (!peerExt.isEmpty()) {
                            extensionToWazoCallIdMap.put(peerExt, otherCallId);
                        }
                    }
                }
            } else if ("call_answered".equals(eventName)) {
                JSONObject payload = dataWrapper.optJSONObject("data");
                String eventSipCallId = (payload != null) ? payload.optString("sip_call_id", "") : "";
                String wazoCallId = (payload != null) ? payload.optString("call_id", "") : "";
                String peerExt = (payload != null) ? payload.optString("peer_caller_id_number", "") : "";

                if (!peerExt.isEmpty() && !wazoCallId.isEmpty()) {
                    extensionToWazoCallIdMap.put(peerExt, wazoCallId);
                }

                SecondaryInviteLeg secLeg = (!eventSipCallId.isEmpty()) ? secondaryLegsBySipCallId.get(eventSipCallId) : null;
                if (secLeg != null && !wazoCallId.isEmpty()) {
                    secLeg.wazoCallId = wazoCallId;
                }

                if (!activeCallId.isEmpty() && activeCallId.equals(eventSipCallId)) {
                    if (!wazoCallId.isEmpty()) {
                        activeWazoCallId = wazoCallId;
                    }
                    if (!isCallConnected) {
                        Log.d(TAG, "Nhận sự kiện call_answered từ wazo-websocketd cho nhánh chính: " + eventSipCallId);
                        isCallConnected = true;
                        CallToneHelper.stopRingback();
                        CallToneHelper.stopIncomingRing();
                        setSpeaker(false);
                        notifyUi("Đang đàm thoại", true, false);
                    }
                }
            } else if ("adhoc_conference_participant_left".equals(eventName)
                    || "conference_user_participant_left".equals(eventName)) {
                JSONObject payload = dataWrapper.optJSONObject("data");
                if (payload != null && isGroupCall) {
                    String leftCallId = payload.optString("call_id", "");
                    String leftExt = payload.optString("caller_id_number", "");
                    handleParticipantLeftGroup(leftExt, leftCallId);
                }
            } else if ("adhoc_conference_deleted".equals(eventName)) {
                if (isGroupCall && hasActiveCall()) {
                    Log.d(TAG, "Phòng họp Ad-hoc đã kết thúc bởi Chủ phòng -> Đóng cuộc gọi");
                    hangup();
                    notifyUi("Chủ phòng đã kết thúc cuộc gọi nhóm", false, true);
                }
            } else if ("call_ended".equals(eventName)) {
                JSONObject payload = dataWrapper.optJSONObject("data");
                String eventSipCallId = (payload != null) ? payload.optString("sip_call_id", "") : "";
                String endedWazoCallId = (payload != null) ? payload.optString("call_id", "") : "";
                int reasonCode = (payload != null) ? payload.optInt("reason_code", 0) : 0;

                // Nếu sự kiện call_ended thuộc về một nhánh khác activeCallId (nhánh phụ)
                if (!eventSipCallId.isEmpty() && !eventSipCallId.equals(activeCallId)) {
                    SecondaryInviteLeg endedSec = secondaryLegsBySipCallId.remove(eventSipCallId);
                    // Chỉ xóa thành viên nếu nhánh phụ đó bị từ chối/bận TRƯỚC KHI bắt máy
                    if (endedSec != null && !endedSec.isAnswered) {
                        handleParticipantLeftGroup(endedSec.targetExt, endedWazoCallId);
                    }
                    // Khi đã vào Ad-hoc Conference, việc thành viên rời phòng sẽ do sự kiện "adhoc_conference_participant_left" đảm nhiệm
                    return;
                }

                if (isCallConnected && reasonCode == 26) {
                    Log.d(TAG, "Bỏ qua call_ended reason_code=26 vì thiết bị này đã nhấc máy.");
                    return;
                }

                if (!secondaryLegsBySipCallId.isEmpty()) {
                    promoteRemainingSecondaryLegWhenPrimaryEnded();
                    return;
                }

                if (!activeCallId.isEmpty() || isIncomingCall) {
                    Log.d(TAG, "Nhận sự kiện call_ended cho cuộc gọi chính -> Kết thúc cuộc gọi");
                    CallToneHelper.playCallEnded();
                    resetCallState();
                    notifyUi("Cuộc gọi đã kết thúc", false, true);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Lỗi parse wazo-websocketd event: " + e.getMessage());
        }
    }

    // Khi nhánh chính (ví dụ B) bị hủy/rời đi nhưng vẫn còn nhánh phụ (C) đang hoạt động -> Giữ cuộc gọi trên nhánh C!
    private void promoteRemainingSecondaryLegWhenPrimaryEnded() {
        String oldPrimaryExt = activeTargetExt;
        SecondaryInviteLeg nextLeg = null;
        for (SecondaryInviteLeg leg : secondaryLegsBySipCallId.values()) {
            if (leg.isAnswered) {
                nextLeg = leg;
                break;
            }
        }
        if (nextLeg == null) {
            Iterator<SecondaryInviteLeg> it = secondaryLegsBySipCallId.values().iterator();
            if (it.hasNext()) nextLeg = it.next();
        }

        if (nextLeg == null) return;

        secondaryLegsBySipCallId.remove(nextLeg.sipCallId);
        activeCallId = nextLeg.sipCallId;
        activeTargetExt = nextLeg.targetExt;
        activeTargetName = nextLeg.targetName;
        activeFromTag = nextLeg.fromTag;
        activeToTag = nextLeg.toTag;
        activeInviteBranch = nextLeg.branch;
        activeRemoteContactUri = nextLeg.remoteContactUri;
        activeInviteCseq = nextLeg.inviteCseq;
        activeWazoCallId = nextLeg.wazoCallId;
        isCallConnected = nextLeg.isAnswered;

        if (oldPrimaryExt != null && !oldPrimaryExt.isEmpty()) {
            handleParticipantLeftGroup(oldPrimaryExt, "");
        } else {
            notifyGroupUiUpdated();
        }
    }

    private void handleParticipantLeftGroup(String leftExt, String leftCallId) {
        if (System.currentTimeMillis() - groupCreatedTimestamp < 3000) {
            Log.d(TAG, "Bỏ qua sự kiện rời nhóm trong 3s đầu khởi tạo ConfBridge (leftExt=" + leftExt + ")");
            return;
        }

        String resolvedExt = leftExt;
        if ((resolvedExt == null || resolvedExt.isEmpty()) && leftCallId != null && !leftCallId.isEmpty()) {
            for (Map.Entry<String, String> entry : extensionToWazoCallIdMap.entrySet()) {
                if (leftCallId.equals(entry.getValue())) {
                    resolvedExt = entry.getKey();
                    break;
                }
            }
        }

        String myExt = getMyExtension();
        // Tuyệt đối không tự kích hoạt thoát phòng bởi chính số máy của mình
        if (resolvedExt == null || resolvedExt.isEmpty() || resolvedExt.equals(myExt)) {
            return;
        }

        groupParticipantExtensions.remove(resolvedExt);
        extensionToWazoCallIdMap.remove(resolvedExt);

        // Nếu máy này là thành viên và nhận tin Chủ phòng (Host) rời khỏi cuộc gọi nhóm -> kết thúc cuộc gọi
        if (isGroupCall && !isGroupHost && resolvedExt.equals(groupHostExtension)) {
            Log.d(TAG, "Chủ phòng (" + groupHostExtension + ") đã kết thúc cuộc gọi -> Ngắt máy thành viên!");
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    hangup();
                    notifyUi("Chủ phòng đã kết thúc cuộc gọi", false, true);
                }
            });
            return;
        }

        if (isGroupCall) {
            notifyGroupUiUpdated();
            if (isGroupHost) {
                broadcastGroupStateViaPresence();
            }

            // Nếu chỉ còn lại 1 mình Chủ phòng (tất cả thành viên đã thoát và không còn ai đang đổ chuông) -> Tự kết thúc!
            if (isGroupHost && groupParticipantExtensions.size() <= 1
                    && secondaryLegsBySipCallId.isEmpty() && pendingGroupInviteExtensions.isEmpty()) {
                Log.d(TAG, "Chỉ còn lại 1 mình Chủ phòng trong cuộc gọi nhóm -> Tự động kết thúc cuộc gọi!");
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        hangup();
                        notifyUi("Cuộc gọi nhóm đã kết thúc", false, true);
                    }
                });
            }
        }
    }

    private String findExtensionByUserUuid(String userUuid) {
        if (userUuid == null || userUuid.isEmpty()) return "";
        List<UserContact> contacts = ContactCache.getContacts();
        if (contacts != null) {
            for (UserContact c : contacts) {
                if (userUuid.equals(c.getUuid()) && c.getExtension() != null) {
                    return c.getExtension().trim();
                }
            }
        }
        return "";
    }

    private synchronized void connectSipWebSocket() {
        if (logoutRequested) return;
        if (isConnectingSip) return;
        isConnectingSip = true;

        if (wsUrl == null || wsUrl.isEmpty() || domainIp == null || domainIp.isEmpty()) {
            setupHostUrls();
        }

        String userUuid = "";
        if (appContext != null) {
            SessionManager sm = new SessionManager(appContext);
            userUuid = sm.getUserUuid();
        }

        if (sipWebSocket != null) {
            try { sipWebSocket.cancel(); } catch (Exception ignored) {}
            sipWebSocket = null;
        }
        if (wsClient == null) {
            wsClient = buildUnsafeOkHttpClient();
        }

        String finalWsUrl = wsUrl;
        if (userUuid != null && !userUuid.isEmpty()) {
            finalWsUrl = wsUrl + "?userUuid=" + userUuid;
        }

        String hostWithPort = ApiClient.DEFAULT_HOST.replaceAll("^https?://", "").replaceAll("/+$", "");

        Request request = new Request.Builder()
                .url(finalWsUrl)
                .header("Sec-WebSocket-Protocol", "sip")
                .header("Origin", "https://" + hostWithPort)
                .header("User-Agent", "Wazo WebRTC Client")
                .build();

        sipWebSocket = wsClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                if (webSocket != sipWebSocket) return;
                isConnectingSip = false;
                Log.d(TAG, "WSS Connected to Wazo Asterisk with userUuid");
                sendSipRegister(null, null, null);
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                if (webSocket != sipWebSocket) return;
                Log.d(TAG, "SIP <<< \n" + text);
                handleIncomingSipMessage(text);
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                if (webSocket != sipWebSocket) return;

                isConnectingSip = false;
                isRegistered = false;
                sipWebSocket = null;

                if (!logoutRequested) {
                    mainHandler.postDelayed(() -> {
                        if (!logoutRequested
                                && !isRegistered
                                && !sipUsername.isEmpty()) {
                            connectSipWebSocket();
                        }
                    }, 5000);
                }
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                if (webSocket != sipWebSocket) return;

                isConnectingSip = false;
                isRegistered = false;
                sipWebSocket = null;
            }
        });
    }

    private void sendSipRegister(String realm, String nonce, String qop) {
        sendSipRegister(realm, nonce, qop, 600);
    }

    private void sendSipRegister(
            String realm,
            String nonce,
            String qop,
            int expiresSeconds
    ) {
        int cseq = cseqCounter++;

        if (expiresSeconds == 0) {
            unregisterCseq = cseq;
        }

        String branch = "z9hG4bK" + (1000000 + new Random().nextInt(8999999));
        String uri = "sip:" + domainIp;

        StringBuilder sb = new StringBuilder();
        sb.append("REGISTER ").append(uri).append(" SIP/2.0\r\n");
        sb.append("Via: SIP/2.0/WSS ").append(sipJsViaDomain)
                .append(";branch=").append(branch).append("\r\n");
        sb.append("Max-Forwards: 70\r\n");
        sb.append("To: <sip:").append(sipUsername).append("@").append(domainIp).append(">\r\n");
        sb.append("From: <sip:").append(sipUsername).append("@").append(domainIp)
                .append(">;tag=").append(registerFromTag).append("\r\n");
        sb.append("Call-ID: ").append(registerCallId).append("\r\n");
        sb.append("CSeq: ").append(cseq).append(" REGISTER\r\n");

        if (realm != null && nonce != null) {
            String authHeader = buildDigestAuth("REGISTER", uri, realm, nonce, qop);
            sb.append("Authorization: ").append(authHeader).append("\r\n");
        }

        sb.append("Contact: 	 	 
 	 	 	 	 	 	 	 	# --- PHẦN 3/5 CỦA FILE ---
<sip:")
                .append(sipJsContactName).append("@").append(sipJsViaDomain)
                .append(";transport=ws>;+sip.ice;reg-id=1;+sip.instance=\"<urn:uuid:")
                .append(sipJsInstanceUuid).append(">\";expires=")
                .append(expiresSeconds).append("\r\n");

        sb.append("Expires: ").append(expiresSeconds).append("\r\n");
        sb.append("Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n");
        sb.append("Supported: path, outbound, gruu\r\n");
        sb.append("User-Agent: Wazo WebRTC Client\r\n");
        sb.append("Content-Length: 0\r\n\r\n");

        sendRawSip(sb.toString());
    }

    public void makeCall(final String targetExtension) {
        if (targetExtension == null || targetExtension.trim().isEmpty()) {
            notifyUi("Số máy nhánh không hợp lệ", false, true);
            return;
        }

        isIncomingCall = false;
        wasIncomingCall = false;
        isGroupHost = true;
        groupHostExtension = getMyExtension();

        if ((sipUsername == null || sipUsername.isEmpty()) && appContext != null) {
            SessionManager sm = new SessionManager(appContext);
            sipUsername = sm.getSipUsername();
            sipPassword = sm.getSipPassword();
        }

        if (sipUsername == null || sipUsername.isEmpty() || sipPassword == null || sipPassword.isEmpty()) {
            notifyUi("Tài khoản chưa có cấu hình SIP", false, true);
            return;
        }

        setupHostUrls();
        initWebRtcFactory();

        if (eventWebSocket == null) {
            connectWazoEventWebSocket();
        }

        if (sipWebSocket == null || !isRegistered) {
            pendingDialExtension = targetExtension.trim();
            notifyUi("Đang đăng ký lại kênh SIP...", false, false);
            connectSipWebSocket();
            return;
        }

        pendingDialExtension = "";
        startOutgoingCallInternal(targetExtension.trim());
    }

    private void startOutgoingCallInternal(final String cleanTargetExt) {
        isIncomingCall = false;
        isCallConnected = false;
        remoteSdpSet = false;

        createPeerConnectionAndOffer(new SdpReadyCallback() {
            @Override
            public void onSdpReady(String sdpOffer) {
                activeTargetExt = cleanTargetExt;
                UserContact c = ContactCache.findByExtension(cleanTargetExt);
                activeTargetName = (c != null && !c.getFullName().isEmpty()) ? c.getFullName() : ("Máy nhánh " + cleanTargetExt);
                activeCallId = randomAlphaNum(20);
                activeFromTag = randomAlphaNum(10);
                activeToTag = "";
                activeRemoteContactUri = "";
                sendSipInvite(activeTargetExt, sdpOffer, null, null, null);
            }
        });
    }

    private void sendSipInvite(String targetExt, String sdpBody, String realm, String nonce, String qop) {
        activeInviteCseq = cseqCounter++;
        activeInviteBranch = "z9hG4bK" + (1000000 + new Random().nextInt(8999999));
        String targetUri = "sip:" + targetExt + "@" + domainIp;

        StringBuilder sb = new StringBuilder();
        sb.append("INVITE ").append(targetUri).append(" SIP/2.0\r\n");
        sb.append("Via: SIP/2.0/WSS ").append(sipJsViaDomain).append(";branch=").append(activeInviteBranch).append("\r\n");
        sb.append("Max-Forwards: 70\r\n");
        sb.append("To: <").append(targetUri).append(">\r\n");
        sb.append("From: <sip:").append(sipUsername).append("@").append(domainIp).append(">;tag=").append(activeFromTag).append("\r\n");
        sb.append("Call-ID: ").append(activeCallId).append("\r\n");
        sb.append("CSeq: ").append(activeInviteCseq).append(" INVITE\r\n");

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

        notifyUi("Đang kết nối...", false, false);
        sendRawSip(sb.toString());
    }

    private void handleIncomingSipMessage(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            if (sipWebSocket != null) {
                sipWebSocket.send("\r\n");
            }
            return;
        }

        String normalized = raw.contains("\r\n") ? raw : raw.replace("\n", "\r\n");
        String[] parts = normalized.split("\r\n\r\n", 2);
        String headers = parts[0];
        String body = parts.length > 1 ? parts[1] : "";
        String firstLine = headers.split("\r\n")[0].trim();
        String upperFirstLine = firstLine.toUpperCase(Locale.ROOT);
        String cseqMethod = extractCseqMethod(headers);

        if (upperFirstLine.startsWith("OPTIONS ") || upperFirstLine.startsWith("NOTIFY ")) {
            Log.d(TAG, "Asterisk Qualify Ping (" + firstLine + ") -> Trả lời 200 OK");
            sendSip200OkGeneric(headers);
            return;
        }

        // A. CUỘC GỌI ĐẾN (INVITE) HOẶC RE-INVITE GIỮ KẾT NỐI
        if (upperFirstLine.startsWith("INVITE ")) {
            String newCallId = extractHeaderValue(headers, "Call-ID:", "i:");
            String wazoHeaderCallId = extractHeaderValue(headers, "X-Wazo-Call-ID:", null);

            // 1. Re-INVITE trên nhánh chính
            if (activeCallId != null && !activeCallId.isEmpty() && activeCallId.equals(newCallId)) {
                Log.d(TAG, "Nhận gói SIP Re-INVITE (Session Timer refresh) cho Call-ID: " + newCallId + " -> Phản hồi 200 OK giữ kết nối");
                String reInviteVia = extractAllViaHeaders(headers);
                String reInviteFrom = extractHeaderLine(headers, "From:", "f:");
                String reInviteTo = extractHeaderLine(headers, "To:", "t:");
                String reInviteCseq = extractHeaderLine(headers, "CSeq:", null);
                String contactUri = extractContactUri(headers);
                if (!contactUri.isEmpty()) {
                    activeRemoteContactUri = contactUri;
                }

                if (!reInviteTo.toLowerCase(Locale.ROOT).contains(";tag=") && activeToTag != null && !activeToTag.isEmpty()) {
                    reInviteTo = reInviteTo + ";tag=" + activeToTag;
                }

                String localSdp = getSafeLocalSdp();
                String okMsg = "SIP/2.0 200 OK\r\n" +
                        reInviteVia +
                        reInviteTo + "\r\n" +
                        reInviteFrom + "\r\n" +
                        "Call-ID: " + newCallId + "\r\n" +
                        reInviteCseq + "\r\n" +
                        "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                        "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                        "Supported: outbound\r\n" +
                        "Session-Expires: 300;refresher=uac\r\n" +
                        "Content-Type: application/sdp\r\n" +
                        "Content-Length: " + localSdp.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + "\r\n\r\n" +
                        localSdp;
                sendRawSip(okMsg);
                return;
            }

            // 2. Re-INVITE trên nhánh phụ
            SecondaryInviteLeg secReInvite = (!newCallId.isEmpty()) ? secondaryLegsBySipCallId.get(newCallId) : null;
            if (secReInvite != null) {
                String reInviteVia = extractAllViaHeaders(headers);
                String reInviteFrom = extractHeaderLine(headers, "From:", "f:");
                String reInviteTo = extractHeaderLine(headers, "To:", "t:");
                String reInviteCseq = extractHeaderLine(headers, "CSeq:", null);
                String localSdp = getSafeLocalSdp();
                String okMsg = "SIP/2.0 200 OK\r\n" +
                        reInviteVia +
                        reInviteTo + "\r\n" +
                        reInviteFrom + "\r\n" +
                        "Call-ID: " + newCallId + "\r\n" +
                        reInviteCseq + "\r\n" +
                        "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                        "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                        "Supported: outbound\r\n" +
                        "Content-Type: application/sdp\r\n" +
                        "Content-Length: " + localSdp.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + "\r\n\r\n" +
                        localSdp;
                sendRawSip(okMsg);
                return;
            }

            // 3. Đang bận cuộc gọi -> Từ chối cuộc gọi mới với 486 Busy Here
            if (hasActiveCall()) {
                Log.d(TAG, "Đang bận cuộc gọi (" + activeCallId + "), từ chối cuộc gọi mới (" + newCallId + ") với 486 Busy Here");
                String busyVia = extractAllViaHeaders(headers);
                String busyFrom = extractHeaderLine(headers, "From:", "f:");
                String busyTo = extractHeaderLine(headers, "To:", "t:");
                String busyCseq = extractHeaderLine(headers, "CSeq:", null);
                String busyMsg = "SIP/2.0 486 Busy Here\r\n" +
                        busyVia +
                        busyTo + ";tag=" + randomAlphaNum(8) + "\r\n" +
                        busyFrom + "\r\n" +
                        "Call-ID: " + newCallId + "\r\n" +
                        busyCseq + "\r\n" +
                        "Content-Length: 0\r\n\r\n";
                sendRawSip(busyMsg);
                return;
            }

            // 4. Cuộc gọi đến mới thực sự (Máy nhận không phải là Host)
            isIncomingCall = true;
            wasIncomingCall = true;
            isGroupHost = false;
            isCallConnected = false;
            remoteSdpSet = false;

            incomingViaHeaders = extractAllViaHeaders(headers);
            incomingFromHeader = extractHeaderLine(headers, "From:", "f:");
            incomingToHeader = extractHeaderLine(headers, "To:", "t:");
            incomingCallId = newCallId;
            incomingCseqHeader = extractHeaderLine(headers, "CSeq:", null);
            incomingRemoteSdp = body;
            incomingCallerNumber = extractCallerExtension(incomingFromHeader);
            activeRemoteContactUri = extractContactUri(headers);

            activeCallId = incomingCallId;
            if (!wazoHeaderCallId.isEmpty()) {
                activeWazoCallId = wazoHeaderCallId;
            }
            activeTargetExt = incomingCallerNumber;
            groupHostExtension = incomingCallerNumber; // Người gọi đến mặc định là Chủ phòng
            activeToTag = randomAlphaNum(10);
            activeFromTag = extractTagFromHeader(incomingFromHeader);

            final String callerDisplayName = resolveCallerName(incomingFromHeader, incomingCallerNumber);
            activeTargetName = callerDisplayName;
            String ringingMsg = "SIP/2.0 180 Ringing\r\n" +
                    incomingViaHeaders +
                    incomingToHeader + ";tag=" + activeToTag + "\r\n" +
                    incomingFromHeader + "\r\n" +
                    "Call-ID: " + incomingCallId + "\r\n" +
                    incomingCseqHeader + "\r\n" +
                    "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                    "Supported: outbound\r\n" +
                    "User-Agent: Wazo WebRTC Client\r\n" +
                    "Content-Length: 0\r\n\r\n";
            sendRawSip(ringingMsg);

            if (appContext != null) {
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    CallToneHelper.startIncomingRing(appContext);

                    Intent intent = new Intent(appContext, InCallActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    intent.putExtra("target_name", callerDisplayName);
                    intent.putExtra("target_ext", incomingCallerNumber);
                    intent.putExtra("CALLEE_NAME", callerDisplayName);
                    intent.putExtra("CALLEE_EXT", incomingCallerNumber);
                    intent.putExtra("is_incoming", true);

                    showIncomingCallNotification(appContext, intent, callerDisplayName, incomingCallerNumber);

                    try {
                        appContext.startActivity(intent);
                    } catch (Exception e) {
                        Log.e(TAG, "Không thể mở trực tiếp InCallActivity từ nền: " + e.getMessage());
                    }

                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> cancelIncomingCallNotification(), 300);
                });
            }
            return;
        }

        // B. Đầu dây bên kia cúp máy (BYE)
        if (upperFirstLine.startsWith("BYE ")) {
            String byeCallId = extractHeaderValue(headers, "Call-ID:", "i:");
            sendSip200OkGeneric(headers);

            SecondaryInviteLeg endedSecLeg = (!byeCallId.isEmpty()) ? secondaryLegsBySipCallId.remove(byeCallId) : null;
            if (endedSecLeg != null) {
                Log.d(TAG, "Nhận BYE trên nhánh phụ (" + endedSecLeg.targetExt + "), giữ nguyên phòng họp nhóm");
                // Chỉ xóa khỏi nhóm nếu nhánh phụ này CHƯA từng bấm nghe máy
                if (!endedSecLeg.isAnswered) {
                    handleParticipantLeftGroup(endedSecLeg.targetExt, endedSecLeg.wazoCallId);
                }
                return;
            }

            if (!byeCallId.isEmpty() && !activeCallId.isEmpty() && !byeCallId.equals(activeCallId)) {
                Log.d(TAG, "Bỏ qua BYE của Call-ID khác: " + byeCallId);
                return;
            }

            // Nếu nhánh chính nhận BYE nhưng vẫn còn nhánh phụ đang kết nối -> Đưa nhánh phụ lên làm nhánh chính!
            if (!secondaryLegsBySipCallId.isEmpty()) {
                promoteRemainingSecondaryLegWhenPrimaryEnded();
                return;
            }

            Log.d(TAG, "Nhận gói SIP BYE cho cuộc gọi chính -> Kết thúc cuộc gọi");
            CallToneHelper.playCallEnded();
            resetCallState();
            notifyUi("Cuộc gọi đã kết thúc", false, true);
            return;
        }

        // C. Đầu dây bên kia hủy khi đang đổ chuông (CANCEL)
        if (upperFirstLine.startsWith("CANCEL ")) {
            Log.d(TAG, "Nhận gói SIP CANCEL");
            sendSip200OkGeneric(headers);
            if (isCallConnected) {
                Log.d(TAG, "Bỏ qua CANCEL vì cuộc gọi đã được kết nối trên thiết bị này.");
                return;
            }
            CallToneHelper.stopIncomingRing();
            resetCallState();
            notifyUi("Cuộc gọi nhỡ", false, true);
            return;
        }

        // D. Các phản hồi SIP/2.0 xxx
        if (upperFirstLine.startsWith("SIP/2.0 ")) {
            int statusCode = parseStatusCode(upperFirstLine);
            String respCallId = extractHeaderValue(headers, "Call-ID:", "i:");

            // --- 1. XỬ LÝ RIÊNG CHO NHÁNH MỜI PHỤ (SECONDARY LEG) ---
            SecondaryInviteLeg secLeg = (!respCallId.isEmpty()) ? secondaryLegsBySipCallId.get(respCallId) : null;
            if (secLeg != null && "INVITE".equals(cseqMethod)) {
                if (statusCode == 401 || statusCode == 407) {
                    String realm = extractParam(headers, "realm");
                    String nonce = extractParam(headers, "nonce");
                    String qop = extractParam(headers, "qop");
                    sendSecondarySipAck(secLeg, headers, false);
                    String localSdp = getSafeLocalSdp();
                    if (!localSdp.isEmpty()) {
                        sendSecondarySipInvite(secLeg, localSdp, realm, nonce, qop);
                    }
                    return;
                }

                if (statusCode == 180 || statusCode == 183) {
                    String toTag = extractToTag(headers);
                    if (!toTag.isEmpty()) secLeg.toTag = toTag;
                    String contact = extractContactUri(headers);
                    if (!contact.isEmpty()) secLeg.remoteContactUri = contact;
                    notifyUi("Đang kết nối " + secLeg.targetName + " (" + secLeg.targetExt + ")...", isCallConnected, false);
                    return;
                }

                if (statusCode == 200) {
                    secLeg.isAnswered = true;
                    String toTag = extractToTag(headers);
                    if (!toTag.isEmpty()) secLeg.toTag = toTag;
                    String contact = extractContactUri(headers);
                    if (!contact.isEmpty()) secLeg.remoteContactUri = contact;

                    sendSecondarySipAck(secLeg, headers, true);

                    // VẤN ĐỀ 2: Nếu nhánh chính (B) CHƯA nghe máy mà C đã nghe máy -> Đưa C lên làm nhánh chính để A và C nói chuyện ngay!
                    if (!isCallConnected) {
                        swapSecondaryLegToPrimaryAndConnect(secLeg, body);
                        return;
                    }

                    // Nếu nhánh chính đã kết nối rồi -> C là người thứ 3 thực sự -> Nâng cấp lên Gọi Nhóm!
                    Log.d(TAG, "Người thứ 3 (" + secLeg.targetExt + ") ĐÃ BẤM NGHE MÁY! Chuyển sang Gọi Nhóm.");
                    promoteToGroupCallOnParticipantAnswered(secLeg);
                    return;
                }

                if (statusCode >= 400) {
                    Log.d(TAG, "Nhánh phụ (" + secLeg.targetExt + ") từ chối hoặc bận (SIP " + statusCode + ")");
                    sendSecondarySipAck(secLeg, headers, false);
                    secondaryLegsBySipCallId.remove(respCallId);
                    handleParticipantLeftGroup(secLeg.targetExt, secLeg.wazoCallId);
                    notifyUi("Không thể kết nối " + secLeg.targetName + " (" + secLeg.targetExt + ")", isCallConnected, false);
                    return;
                }
                return;
            }
            // --- HẾT PHẦN NHÁNH PHỤ, TIẾP TỤC XỬ LÝ NHÁNH CHÍNH ---

            if (statusCode == 401 || statusCode == 407) {
                String realm = extractParam(headers, "realm");
                String nonce = extractParam(headers, "nonce");
                String qop = extractParam(headers, "qop");

                if ("REGISTER".equals(cseqMethod)) {
                    int expires = logoutRequested ? 0 : 600;
                    sendSipRegister(realm, nonce, qop, expires);
                } else if ("INVITE".equals(cseqMethod)) {
                    sendSipAckForNon2xx(headers);
                    String localSdp = getSafeLocalSdp();
                    if (!localSdp.isEmpty()) {
                        sendSipInvite(activeTargetExt, localSdp, realm, nonce, qop);
                    }
                }
                return;
            }

            if (statusCode == 180 || statusCode == 183) {
                String toTag = extractToTag(headers);
                if (!toTag.isEmpty()) activeToTag = toTag;
                String contact = extractContactUri(headers);
                if (!contact.isEmpty()) activeRemoteContactUri = contact;

                // Chỉ set Early Media SDP khi KHÔNG có nhánh phụ nào khác đang đua đổ chuông
                if (!body.isEmpty() && !remoteSdpSet && secondaryLegsBySipCallId.isEmpty()) {
                    setSafeRemoteAnswerSdp(body);
                }

                if (!isCallConnected) {
                    CallToneHelper.startRingback();
                    String pending = getRingingSecondaryLegsLabel();
                    String ringText = pending.isEmpty() ? "Đang đổ chuông..." : ("Đang kết nối " + pending + "...");
                    notifyUi(ringText, false, false);
                }
                return;
            }

            if (statusCode == 200) {
                if ("REGISTER".equals(cseqMethod)) {
                    String cseqValue = extractHeaderValue(headers, "CSeq:", null);
                    int responseCseq = -1;

                    try {
                        responseCseq = Integer.parseInt(cseqValue.trim().split("\\s+")[0]);
                    } catch (Exception ignored) {}

                    if (logoutRequested && responseCseq == unregisterCseq) {
                        Log.d(TAG, "SIP unregister thành công");
                        finishLogout();
                        return;
                    }

                    if (logoutRequested) {
                        return;
                    }

                    isRegistered = true;
                    Log.d(TAG, "SIP Registration Thành Công");
                    publishPresence("available", "Sẵn sàng");

                    if (pendingDialExtension != null && !pendingDialExtension.isEmpty()) {
                        String extToCall = pendingDialExtension;
                        pendingDialExtension = "";
                        startOutgoingCallInternal(extToCall);
                    }
                } else if ("INVITE".equals(cseqMethod)) {
                    Log.d(TAG, "Nhận 200 OK cho INVITE nhánh chính -> Đã bắt máy!");
                    isCallConnected = true;
                    CallToneHelper.stopRingback();
                    CallToneHelper.stopIncomingRing();

                    String toTag = extractToTag(headers);
                    if (!toTag.isEmpty()) activeToTag = toTag;
                    String contact = extractContactUri(headers);
                    if (!contact.isEmpty()) activeRemoteContactUri = contact;

                    sendSipAckFor200Ok();

                    if (!body.isEmpty()) {
                        forceSetRemoteAnswerSdp(body);
                    }
                    setSpeaker(false);

                    // Kiểm tra nếu có nhánh phụ nào đã bắt máy từ trước -> gộp vào nhóm luôn
                    for (SecondaryInviteLeg leg : secondaryLegsBySipCallId.values()) {
                        if (leg.isAnswered) {
                            promoteToGroupCallOnParticipantAnswered(leg);
                        }
                    }

                    String pending = getRingingSecondaryLegsLabel();
                    String status = pending.isEmpty() ? "Đang đàm thoại" : ("Đang kết nối " + pending + "...");
                    notifyUi(status, true, false);
                } else if ("BYE".equals(cseqMethod)) {
                    resetCallState();
                }
                return;
            }

            if (statusCode >= 400) {
                if ("INVITE".equals(cseqMethod)) {
                    Log.d(TAG, "Transaction INVITE nhánh chính kết thúc với mã SIP: " + statusCode);
                    sendSipAckForNon2xx(headers);

                    // VẤN ĐỀ 3: Nếu B (nhánh chính) không nghe/từ chối nhưng vẫn còn C trong secondaryLegsBySipCallId -> KHÔNG kết thúc cuộc gọi!
                    if (!secondaryLegsBySipCallId.isEmpty()) {
                        String failedName = activeTargetName;
                        String failedExt = activeTargetExt;
                        promoteRemainingSecondaryLegWhenPrimaryEnded();
                        notifyUi("Không thể kết nối " + failedName + " (" + failedExt + ")", isCallConnected, false);
                        return;
                    }

                    CallToneHelper.playCallEnded();
                    resetCallState();

                    String reason = (statusCode == 486 || statusCode == 603)
                            ? "Người nhận đang bận hoặc từ chối"
                            : (statusCode == 487 ? "Đã hủy cuộc gọi" : "Không liên lạc được (" + statusCode + ")");
                    notifyUi(reason, false, true);
                }
            }
        }
    }

    public void acceptIncomingCall() {
        if (!isIncomingCall || incomingRemoteSdp == null || incomingRemoteSdp.isEmpty()) {
            Log.e(TAG, "acceptIncomingCall: Không có cuộc gọi đến hoặc thiếu Remote SDP");
            return;
        }
        CallToneHelper.stopIncomingRing();
        cancelIncomingCallNotification();
        isIncomingCall = false;

        createPeerConnectionAndAnswer(incomingRemoteSdp, new SdpReadyCallback() {
            @Override
            public void onSdpReady(String sdpAnswer) {
                isCallConnected = true;
                byte[] sdpBytes = sdpAnswer.getBytes(java.nio.charset.StandardCharsets.UTF_8);

                String okMsg = "SIP/2.0 200 OK\r\n" +
                        incomingViaHeaders +
                        incomingToHeader + ";tag=" + activeToTag + "\r\n" +
                        incomingFromHeader + "\r\n" +
                        "Call-ID: " + incomingCallId + "\r\n" +
                        incomingCseqHeader + "\r\n" +
                        "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                        "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                        "Supported: outbound\r\n" +
                        "User-Agent: Wazo WebRTC Client\r\n" +
                        "Content-Type: application/sdp\r\n" +
                        "Content-Length: " + sdpBytes.length + "\r\n\r\n" +
                        sdpAnswer;

                sendRawSip(okMsg);

                new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        setSpeaker(false);
                        notifyUi("Đang đàm thoại", true, false);
                    }
                });
            }
        });
    }

    public boolean hasActiveCall() {
        return isIncomingCall || isCallConnected
                || (activeCallId != null && !activeCallId.isEmpty())
                || !secondaryLegsBySipCallId.isEmpty();
    }

    public void rejectIncomingCall() {
        CallToneHelper.stopIncomingRing();
        if (!incomingCallId.isEmpty()) {
            String busyMsg = "SIP/2.0 486 Busy Here\r\n" +
                    incomingViaHeaders +
                    incomingToHeader + ";tag=" + activeToTag + "\r\n" +
                    incomingFromHeader + "\r\n" +
                    "Call-ID: " + incomingCallId + "\r\n" +
                    incomingCseqHeader + "\r\n" +
                    "User-Agent: Wazo WebRTC Client\r\n" +
                    "Content-Length: 0\r\n\r\n";
            sendRawSip(busyMsg);
        }
        resetCallState();
    }

    private void sendSipAckForNon2xx(String responseHeaders) {
        if (activeTargetExt.isEmpty() || activeCallId.isEmpty()) return;
        String targetUri = "sip:" + activeTargetExt + "@" + domainIp;
        String toTag = extractToTag(responseHeaders);
        String toHeader = toTag.isEmpty() ? "<" + targetUri + ">" : "<" + targetUri + ">;tag=" + toTag;
        String branchToUse = !activeInviteBranch.isEmpty() ? activeInviteBranch : ("z9hG4bK" + (1000000 + new Random().nextInt(8999999)));

        String sb = "ACK " + targetUri + " SIP/2.0\r\n" +
                "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + branchToUse + "\r\n" +
                "Max-Forwards: 70\r\n" +
                "To: " + toHeader + "\r\n" +
                "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + activeFromTag + "\r\n" +
                "Call-ID: " + activeCallId + "\r\n" +
                "CSeq: " + activeInviteCseq + " ACK\r\n" +
                "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                "Content-Length: 0\r\n\r\n";
        sendRawSip(sb);
    }

    private void sendSipAckFor200Ok() {
        if (activeTargetExt.isEmpty() || activeCallId.isEmpty()) return;
        String requestUri = !activeRemoteContactUri.isEmpty()
                ? activeRemoteContactUri
                : "sip:" + activeTargetExt + "@" + domainIp;
        String targetUri = "sip:" + activeTargetExt + "@" + domainIp;
        String toHeader = activeToTag.isEmpty() ? "<" + targetUri + ">" : "<" + targetUri + ">;tag=" + activeToTag;

        String sb = "ACK " + requestUri + " SIP/2.0\r\n" +
                "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=z9hG4bK" + (1000000 + new Random().nextInt(8999999)) + "\r\n" +
                "Max-Forwards: 70\r\n" +
                "To: " + toHeader + "\r\n" +
                "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + activeFromTag + "\r\n" +
                "Call-ID: " + activeCallId + "\r\n" +
                "CSeq: " + activeInviteCseq + " ACK\r\n" +
                "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                "Content-Length: 0\r\n\r\n";
        sendRawSip(sb);
    }

    public void hangup() {
        pendingDialExtension = "";
        CallToneHelper.playCallEnded();
        cancelIncomingCallNotification();

        // 1. Hủy hoặc gửi BYE cho toàn bộ các nhánh phụ (Secondary Legs) nếu máy này là Chủ phòng
        for (SecondaryInviteLeg secLeg : secondaryLegsBySipCallId.values()) {
            sendSecondarySipCancelOrBye(secLeg);
        }
        secondaryLegsBySipCallId.clear();

        // 2. CHỈ khi Chủ phòng thực sự (isGroupHost && !wasIncomingCall) bấm cúp máy mới giải tán Ad-hoc Conference và ngắt tất cả
        if (isGroupCall && isGroupHost && !wasIncomingCall && appContext != null) {
            final String token = new SessionManager(appContext).getToken();
            final String confId = activeAdhocConferenceId;
            final List<String> childCallIds = new ArrayList<>(extensionToWazoCallIdMap.values());
            if (token != null && !token.isEmpty()) {
                if (confId != null && !confId.isEmpty()) {
                    ApiClient.getService().deleteAdhocConference(token, confId).enqueue(new retrofit2.Callback<Void>() {
                        @Override public void onResponse(retrofit2.Call<Void> call, retrofit2.Response<Void> response) {}
                        @Override public void onFailure(retrofit2.Call<Void> call, Throwable t) {}
                    });
                }
                for (String cId : childCallIds) {
                    if (cId != null && !cId.isEmpty()) {
                        ApiClient.getService().hangupUserCall(token, cId).enqueue(new retrofit2.Callback<Void>() {
                            @Override public void onResponse(retrofit2.Call<Void> call, retrofit2.Response<Void> response) {}
                            @Override public void onFailure(retrofit2.Call<Void> call, Throwable t) {}
                        });
                    }
                }
            }
        }

        if (isIncomingCall) {
            wasIncomingCall = false;
            rejectIncomingCall();
            return;
        }

        final String callIdSnapshot = activeCallId;
        final String targetExtSnapshot = activeTargetExt;
        final String fromTagSnapshot = activeFromTag;
        final String toTagSnapshot = activeToTag;
        final String branchSnapshot = activeInviteBranch;
        final int inviteCseqSnapshot = activeInviteCseq;
        final boolean wasConnected = isCallConnected;
        final boolean wasIncomingSnapshot = wasIncomingCall;
        final String remoteContactSnapshot = ac	 	 
 	 	 	 	 	 	 	 	# --- PHẦN 4/5 CỦA FILE ---
tiveRemoteContactUri;
        final String inFromHeaderSnapshot = incomingFromHeader;
        final String inToHeaderSnapshot = incomingToHeader;

        wasIncomingCall = false;
        resetCallState();

        if (!callIdSnapshot.isEmpty() && !targetExtSnapshot.isEmpty()) {
            String targetUri = "sip:" + targetExtSnapshot + "@" + domainIp;

            if (!wasConnected) {
                String cancelBranch = !branchSnapshot.isEmpty() ? branchSnapshot : ("z9hG4bK" + (1000000 + new Random().nextInt(8999999)));
                String cancelMsg = "CANCEL " + targetUri + " SIP/2.0\r\n" +
                        "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + cancelBranch + "\r\n" +
                        "Max-Forwards: 70\r\n" +
                        "To: <" + targetUri + ">\r\n" +
                        "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + fromTagSnapshot + "\r\n" +
                        "Call-ID: " + callIdSnapshot + "\r\n" +
                        "CSeq: " + inviteCseqSnapshot + " CANCEL\r\n" +
                        "Content-Length: 0\r\n\r\n";
                sendRawSip(cancelMsg);
            } else {
                String requestUri = !remoteContactSnapshot.isEmpty() ? remoteContactSnapshot : targetUri;
                int byeCseq = cseqCounter++;
                String branch = "z9hG4bK" + (1000000 + new Random().nextInt(8999999));

                String byeFromHeader;
                String byeToHeader;

                if (wasIncomingSnapshot && inToHeaderSnapshot != null && !inToHeaderSnapshot.isEmpty()
                        && inFromHeaderSnapshot != null && !inFromHeaderSnapshot.isEmpty()) {
                    String rawMyUri = inToHeaderSnapshot.replaceFirst("(?i)^(To|t)\\s*:\\s*", "").trim();
                    if (!rawMyUri.contains(";tag=")) {
                        rawMyUri = rawMyUri + ";tag=" + toTagSnapshot;
                    }
                    String rawRemoteUri = inFromHeaderSnapshot.replaceFirst("(?i)^(From|f)\\s*:\\s*", "").trim();

                    byeFromHeader = "From: " + rawMyUri;
                    byeToHeader = "To: " + rawRemoteUri;
                } else {
                    String toVal = toTagSnapshot.isEmpty() ? "<" + targetUri + ">" : "<" + targetUri + ">;tag=" + toTagSnapshot;
                    byeFromHeader = "From: <sip:" + sipUsername + "@" + domainIp + ">;tag=" + fromTagSnapshot;
                    byeToHeader = "To: " + toVal;
                }

                String byeMsg = "BYE " + requestUri + " SIP/2.0\r\n" +
                        "Via: SIP/2.0/WSS " + sipJsViaDomain + ";branch=" + branch + "\r\n" +
                        "Max-Forwards: 70\r\n" +
                        byeToHeader + "\r\n" +
                        byeFromHeader + "\r\n" +
                        "Call-ID: " + callIdSnapshot + "\r\n" +
                        "CSeq: " + byeCseq + " BYE\r\n" +
                        "Contact: <sip:" + sipJsContactName + "@" + sipJsViaDomain + ";transport=ws;ob>\r\n" +
                        "Content-Length: 0\r\n\r\n";
                sendRawSip(byeMsg);
            }
        }
    }

    private void sendSip200OkGeneric(String incomingHeaders) {
        String allVias = extractAllViaHeaders(incomingHeaders);
        String fromLine = extractHeaderLine(incomingHeaders, "From:", "f:");
        String toLine = extractHeaderLine(incomingHeaders, "To:", "t:");
        String callIdLine = extractHeaderLine(incomingHeaders, "Call-ID:", "i:");
        String cseqLine = extractHeaderLine(incomingHeaders, "CSeq:", null);

        if (!toLine.toLowerCase(Locale.ROOT).contains(";tag=")) {
            toLine = toLine + ";tag=" + randomAlphaNum(10);
        }

        String sb = "SIP/2.0 200 OK\r\n" +
                allVias +
                toLine + "\r\n" +
                fromLine + "\r\n" +
                callIdLine + "\r\n" +
                cseqLine + "\r\n" +
                "Allow: ACK,CANCEL,INVITE,MESSAGE,BYE,OPTIONS,INFO,NOTIFY,REFER\r\n" +
                "Accept: application/sdp, application/dtmf-relay\r\n" +
                "Supported: outbound\r\n" +
                "User-Agent: Wazo WebRTC Client\r\n" +
                "Content-Length: 0\r\n\r\n";
        sendRawSip(sb);
    }

    private String extractAllViaHeaders(String headers) {
        StringBuilder sb = new StringBuilder();
        for (String line : headers.split("\r\n")) {
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.startsWith("via:") || lower.startsWith("v:")) {
                sb.append(line).append("\r\n");
            }
        }
        return sb.toString();
    }

    public void setMute(boolean mute) {
        synchronized (webrtcLock) {
            if (localAudioTrack != null) {
                try {
                    localAudioTrack.setEnabled(!mute);
                } catch (Exception ignored) {}
            }
        }
        if (appContext != null) {
            AudioManager am = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) am.setMicrophoneMute(mute);
        }
    }

    public void setSpeaker(boolean useSpeaker) {
        if (appContext == null) return;
        AudioManager am = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(useSpeaker);
        }
    }

    private String getSafeLocalSdp() {
        synchronized (webrtcLock) {
            if (peerConnection != null && peerConnection.getLocalDescription() != null) {
                return peerConnection.getLocalDescription().description;
            }
            return "";
        }
    }

    private void setSafeRemoteAnswerSdp(String sdpBody) {
        synchronized (webrtcLock) {
            if (peerConnection != null && !remoteSdpSet) {
                remoteSdpSet = true;
                SessionDescription remoteSdp = new SessionDescription(SessionDescription.Type.ANSWER, sdpBody);
                peerConnection.setRemoteDescription(new SimpleSdpObserver(), remoteSdp);
            }
        }
    }

    // Cho phép ghi đè SDP của nhánh thực sự trả lời 200 OK đầu tiên (tránh bị khóa bởi 183 Early Media của nhánh chưa bắt máy)
    private void forceSetRemoteAnswerSdp(String sdpBody) {
        synchronized (webrtcLock) {
            if (peerConnection != null && sdpBody != null && !sdpBody.isEmpty()) {
                if (!remoteSdpSet || peerConnection.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                    remoteSdpSet = true;
                    SessionDescription remoteSdp = new SessionDescription(SessionDescription.Type.ANSWER, sdpBody);
                    peerConnection.setRemoteDescription(new SimpleSdpObserver(), remoteSdp);
                }
            }
        }
    }

    private interface SdpReadyCallback {
        void onSdpReady(String sdp);
    }

    private void createPeerConnectionAndOffer(final SdpReadyCallback callback) {
        cleanupPeerConnection();
        synchronized (webrtcLock) {
            setupPeerConnectionBaseLocked(callback);

            MediaConstraints sdpConstraints = new MediaConstraints();
            sdpConstraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
            sdpConstraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"));

            if (peerConnection != null) {
                peerConnection.createOffer(new SimpleSdpObserver() {
                    @Override
                    public void onCreateSuccess(SessionDescription sessionDescription) {
                        synchronized (webrtcLock) {
                            if (peerConnection != null) {
                                peerConnection.setLocalDescription(new SimpleSdpObserver(), sessionDescription);
                            }
                        }
                    }
                }, sdpConstraints);
            }
        }
    }

    private void createPeerConnectionAndAnswer(final String remoteOfferSdp, final SdpReadyCallback callback) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                cleanupPeerConnection();

                final java.util.concurrent.atomic.AtomicBoolean onceFlag = new java.util.concurrent.atomic.AtomicBoolean(false);
                final SdpReadyCallback safeCallback = new SdpReadyCallback() {
                    @Override
                    public void onSdpReady(String sdp) {
                        if (onceFlag.compareAndSet(false, true) && callback != null) {
                            callback.onSdpReady(sdp);
                        }
                    }
                };

                final org.webrtc.PeerConnection pc;
                synchronized (webrtcLock) {
                    setupPeerConnectionBaseLocked(safeCallback);
                    pc = peerConnection;
                }

                if (pc == null) {
                    Log.e(TAG, "createPeerConnectionAndAnswer: peerConnection is null");
                    return;
                }

                SessionDescription remoteDesc = new SessionDescription(SessionDescription.Type.OFFER, remoteOfferSdp);
                pc.setRemoteDescription(new SimpleSdpObserver() {
                    @Override
                    public void onSetSuccess() {
                        Log.d(TAG, "setRemoteDescription(OFFER) thành công, đang tạo Answer...");
                        if (peerConnection == null) return;

                        MediaConstraints sdpConstraints = new MediaConstraints();
                        sdpConstraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
                        sdpConstraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"));

                        peerConnection.createAnswer(new SimpleSdpObserver() {
                            @Override
                            public void onCreateSuccess(SessionDescription answerDesc) {
                                Log.d(TAG, "createAnswer thành công, đang setLocalDescription...");
                                if (peerConnection == null) return;

                                String sdpStr = answerDesc.description.replace("a=setup:actpass", "a=setup:active");
                                final SessionDescription finalAnswer = new SessionDescription(SessionDescription.Type.ANSWER, sdpStr);

                                peerConnection.setLocalDescription(new SimpleSdpObserver() {
                                    @Override
                                    public void onSetSuccess() {
                                        Log.d(TAG, "setLocalDescription(ANSWER) thành công!");
                                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                                            @Override
                                            public void run() {
                                                if (peerConnection != null) {
                                                    SessionDescription local = peerConnection.getLocalDescription();
                                                    String sdpToSend = (local != null) ? local.description : finalAnswer.description;
                                                    safeCallback.onSdpReady(sdpToSend);
                                                }
                                            }
                                        }, 600);
                                    }

                                    @Override
                                    public void onSetFailure(String error) {
                                        Log.e(TAG, "setLocalDescription(ANSWER) lỗi: " + error);
                                    }
                                }, finalAnswer);
                            }

                            @Override
                            public void onCreateFailure(String error) {
                                Log.e(TAG, "createAnswer lỗi: " + error);
                            }
                        }, sdpConstraints);
                    }

                    @Override
                    public void onSetFailure(String error) {
                        Log.e(TAG, "setRemoteDescription(OFFER) lỗi: " + error);
                    }
                }, remoteDesc);
            }
        }).start();
    }

    private void setupPeerConnectionBaseLocked(final SdpReadyCallback callback) {
        initWebRtcFactory();
        List<PeerConnection.IceServer> iceServers = new ArrayList<>();
        PeerConnection.RTCConfiguration rtcConfig = new PeerConnection.RTCConfiguration(iceServers);
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, new PeerConnection.Observer() {
            @Override public void onSignalingChange(PeerConnection.SignalingState signalingState) {}
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState iceConnectionState) {
                Log.d(TAG, "ICE State: " + iceConnectionState);
            }
            @Override public void onIceConnectionReceivingChange(boolean b) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState iceGatheringState) {
                if (iceGatheringState == PeerConnection.IceGatheringState.COMPLETE) {
                    String sdp = getSafeLocalSdp();
                    if (!sdp.isEmpty()) {
                        callback.onSdpReady(sdp);
                    }
                }
            }
            @Override public void onIceCandidate(IceCandidate iceCandidate) {}
            @Override public void onIceCandidatesRemoved(IceCandidate[] iceCandidates) {}
            @Override public void onAddStream(MediaStream mediaStream) {}
            @Override public void onRemoveStream(MediaStream mediaStream) {}
            @Override public void onDataChannel(DataChannel dataChannel) {}
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver rtpReceiver, MediaStream[] mediaStreams) {}
        });

        MediaConstraints audioConstraints = new MediaConstraints();
        audioConstraints.mandatory.add(new MediaConstraints.KeyValuePair("googEchoCancellation", "true"));
        audioConstraints.mandatory.add(new MediaConstraints.KeyValuePair("googNoiseSuppression", "true"));

        audioSource = peerConnectionFactory.createAudioSource(audioConstraints);
        localAudioTrack = peerConnectionFactory.createAudioTrack("ARDAMSa0", audioSource);
        localAudioTrack.setEnabled(true);
        if (peerConnection != null) {
            peerConnection.addTrack(localAudioTrack, Collections.singletonList("ARDAMS"));
        }
    }

    private void cleanupPeerConnection() {
        synchronized (webrtcLock) {
            final PeerConnection pcToDispose = peerConnection;
            final AudioTrack trackToDispose = localAudioTrack;
            final AudioSource sourceToDispose = audioSource;

            peerConnection = null;
            localAudioTrack = null;
            audioSource = null;

            if (pcToDispose != null) {
                try {
                    pcToDispose.close();
                    pcToDispose.dispose();
                } catch (Exception e) {
                    Log.w(TAG, "Lỗi đóng PeerConnection: " + e.getMessage());
                }
            }
            if (trackToDispose != null) {
                try {
                    trackToDispose.dispose();
                } catch (Exception e) {
                    Log.w(TAG, "Lỗi đóng AudioTrack: " + e.getMessage());
                }
            }
            if (sourceToDispose != null) {
                try {
                    sourceToDispose.dispose();
                } catch (Exception e) {
                    Log.w(TAG, "Lỗi đóng AudioSource: " + e.getMessage());
                }
            }
        }
    }

    private void resetCallState() {
        boolean hadCall = !activeCallId.isEmpty() || !incomingCallId.isEmpty() || isIncomingCall || isCallConnected;

        CallToneHelper.stopRingback();
        CallToneHelper.stopIncomingRing();

        cancelIncomingCallNotification();
        if (appContext != null) {
            com.company.internalcall.ui.call.InCallActivity.cancelOngoingCallNotification(appContext);
        }

        isIncomingCall = false;
        wasIncomingCall = false;
        isCallConnected = false;
        remoteSdpSet = false;

        activeCallId = "";
        activeWazoCallId = "";
        activeAdhocConferenceId = "";
        groupHostExtension = "";
        activeTargetExt = "";
        activeTargetName = "";
        activeToTag = "";
        activeFromTag = "";
        activeRemoteContactUri = "";
        activeInviteBranch = "";

        isGroupCall = false;
        isGroupHost = false;
        groupHadMultipleConnected = false;
        groupParticipantExtensions.clear();
        pendingGroupInviteExtensions.clear();
        extensionToWazoCallIdMap.clear();
        mergedCallIds.clear();
        secondaryLegsBySipCallId.clear();

        incomingCallId = "";
        incomingRemoteSdp = "";
        incomingCallerNumber = "";
        incomingViaHeaders = "";
        incomingFromHeader = "";
        incomingToHeader = "";
        incomingCseqHeader = "";

        cleanupPeerConnection();

        if (hadCall && !logoutRequested) {
            publishPresence("available", "Sẵn sàng");
        }

        if (hadCall && appContext != null) {
            Intent historyIntent = new Intent(com.company.internalcall.ui.main.history.HistoryFragment.ACTION_CALL_HISTORY_UPDATED);
            historyIntent.setPackage(appContext.getPackageName());
            appContext.sendBroadcast(historyIntent);
        }
    }

    public void forceLogoutDueToConflict() {
        Log.w(TAG, "Phiên đăng nhập đã bị thu hồi hoặc đăng nhập trên thiết bị khác -> Ngắt SIP, Event WS & Service");
        logoutRequested = true;
        isRegistered = false;
        isConnectingSip = false;
        pendingDialExtension = "";
        mainHandler.removeCallbacks(keepAliveRunnable);
        resetCallState();

        if (sipWebSocket != null) {
            try {
                sipWebSocket.close(1000, "Logged in on another device");
            } catch (Exception ignored) {}
            sipWebSocket = null;
        }

        if (eventWebSocket != null) {
            try {
                eventWebSocket.close(1000, "Logged in on another device");
            } catch (Exception ignored) {}
            eventWebSocket = null;
        }

        if (appContext != null) {
            try {
                Intent stopServiceIntent = new Intent(appContext, WazoKeepAliveService.class);
                appContext.stopService(stopServiceIntent);
            } catch (Exception ignored) {}
        }
    }

    private int parseStatusCode(String firstLine) {
        String[] tokens = firstLine.split("\\s+");
        if (tokens.length >= 2) {
            try {
                return Integer.parseInt(tokens[1]);
            } catch (NumberFormatException ignored) {}
        }
        return 0;
    }

    private String extractCseqMethod(String headers) {
        String cseqLine = extractHeaderValue(headers, "CSeq:", null);
        if (!cseqLine.isEmpty()) {
            String[] parts = cseqLine.trim().split("\\s+");
            if (parts.length >= 2) {
                return parts[1].toUpperCase(Locale.ROOT);
            }
        }
        return "";
    }

    private String extractContactUri(String headers) {
        String line = extractHeaderLine(headers, "Contact:", "m:");
        if (line.isEmpty()) return "";
        Pattern p = Pattern.compile("<([^>]+)>");
        Matcher m = p.matcher(line);
        if (m.find()) return m.group(1).trim();
        return "";
    }

    private String extractToTag(String headers) {
        String toLine = extractHeaderLine(headers, "To:", "t:");
        return extractTagFromHeader(toLine);
    }

    private String extractTagFromHeader(String headerLine) {
        if (headerLine == null || headerLine.isEmpty()) return "";
        Pattern p = Pattern.compile(";tag=([^;\\s\\r\\n]+)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(headerLine);
        return m.find() ? m.group(1).trim() : "";
    }

    private String extractCallerExtension(String fromHeader) {
        Pattern p = Pattern.compile("sip:([^@>;]+)@", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(fromHeader);
        return m.find() ? m.group(1).trim() : "Không rõ";
    }

    private String extractHeaderLine(String headers, String prefix1, String compactPrefix) {
        for (String line : headers.split("\r\n")) {
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.startsWith(prefix1.toLowerCase(Locale.ROOT))) return line;
            if (compactPrefix != null && lower.startsWith(compactPrefix.toLowerCase(Locale.ROOT))) return line;
        }
        return "";
    }

    private String extractHeaderValue(String headers, String prefix1, String compactPrefix) {
        String line = extractHeaderLine(headers, prefix1, compactPrefix);
        return line.contains(":") ? line.substring(line.indexOf(":") + 1).trim() : "";
    }

    private String buildDigestAuth(String method, String uri, String realm, String nonce, String qop) {
        String ha1 = md5(sipUsername + ":" + realm + ":" + sipPassword);
        String ha2 = md5(method + ":" + uri);

        if (qop != null && qop.contains("auth")) {
            String nc = "00000001";
            String cnonce = randomAlphaNum(12);
            String response = md5(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2);
            return "Digest username=\"" + sipUsername + "\", realm=\"" + realm + "\", nonce=\"" + nonce +
                    "\", uri=\"" + uri + "\", response=\"" + response + "\", algorithm=MD5, qop=auth, nc=" + nc + ", cnonce=\"" + cnonce + "\"";
        } else {
            String response = md5(ha1 + ":" + nonce + ":" + ha2);
            return "Digest username=\"" + sipUsername + "\", realm=\"" + realm + "\", nonce=\"" + nonce +
                    "\", uri=\"" + uri + "\", response=\"" + response + "\", algorithm=MD5";
        }
    }

    private String md5(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String extractParam(String headers, String key) {
        Pattern p = Pattern.compile(key + "=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(headers);
        if (m.find()) return m.group(1);
        Pattern pUnquoted = Pattern.compile(key + "=([^,\\r\\n]+)", Pattern.CASE_INSENSITIVE);
        Matcher m2 = pUnquoted.matcher(headers);
        return m2.find() ? m2.group(1).trim() : null;
    }

    private static String randomAlphaNum(int length) {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        Random rnd = new Random();
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(rnd.nextInt(chars.length())));
        }
        return sb.toString();
    }

    private void sendRawSip(String message) {
        if (sipWebSocket != null) {
            Log.d(TAG, "SIP >>> \n" + message);
            sipWebSocket.send(message);
        }
    }

    private void notifyUi(final String status, final boolean connected, final boolean ended) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (uiCallback != null) {
                    uiCallback.onCallStateChanged(status, connected, ended);
                    if (isGroupCall && !ended) {
                        uiCallback.onGroupParticipantsUpdated(
                                true,
                                "Cuộc gọi nhóm",
                                getFormattedGroupMembersSummary(),
                                getGroupParticipantExtensions().size()
                        );
                    }
                }
            }
        });
    }

    private OkHttpClient buildUnsafeWsClient() {
        try {
            final TrustManager[] trustAllCerts = new TrustManager[]{
                    new X509TrustManager() {
                        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[]{}; }
                    }
            };
            SSLContext sslContext = SSLContext.getInstance("TLSv1.2");
            sslContext.init(null, trustAllCerts, new SecureRandom());
            SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            return new OkHttpClient.Builder()
                    .sslSocketFactory(sslSocketFactory, (X509TrustManager) trustAllCerts[0])
                    .hostnameVerifier((hostname, session) -> true)
                    .protocols(Collections.singletonList(Protocol.HTTP_1_1))
                    .pingInterval(25, TimeUnit.SECONDS)
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.SECONDS)
                    .build();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private OkHttpClient buildUnsafeOkHttpClient() {
        try {
            final TrustManager[] trustAllCerts = new TrustManager[]{
                    new X509TrustManager() {
                        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[]{}; }
                    }
            };
            SSLContext sslContext = SSLContext.getInstance("TLSv1.2");
            sslContext.init(null, trustAllCerts, new SecureRandom());
            SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            return new OkHttpClient.Builder()
                    .sslSocketFactory(sslSocketFactory, (X509TrustManager) trustAllCerts[0])
                    .hostnameVerifier((hostname, session) -> true)
                    .protocols(Collections.singletonList(Protocol.HTTP_1_1))
                    .pingInterval(25, TimeUnit.SECONDS)
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.SECONDS)
                    .build();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void showIncomingCallNotification(Context context, Intent callIntent, String callerName, String callerExt) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            String channelId = "wazo_incoming_call_high";
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.app.NotificationChannel channel = new android.app.NotificationChannel(
                        channelId, "Cuộc gọi đến", android.app.NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Thông báo toàn màn hình khi có cuộc gọi đến");
                channel.setSound(null, null);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(channel);
            }

            int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
            }
            android.app.PendingIntent fullScreenPendingIntent = android.app.PendingIntent.getActivity(
                    context, 1001, callIntent, flags);

            androidx.core.app.NotificationCompat.Builder builder =
                    new androidx.core.app.NotificationCompat.Builder(context, channelId)
                            .setSmallIcon(android.R.drawable.sym_call_incoming)
                            .setContentTitle("Cuộc gọi nội bộ đến")
                            .setContentText(callerName + " (" + callerExt + ")")
                            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MAX)
                            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_CALL)
                            .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
                            .setOngoing(true)
                            .setAutoCancel(true)
                            .setFullScreenIntent(fullScreenPendingIntent, true);

            nm.notify(INCOMING_CALL_NOTIF_ID, builder.build());
        } catch (Exception e) {
            Log.e(TAG, "Lỗi tạo FullScreenNotification: " + e.getMessage());
        }
    }

    public void cancelIncomingCallNotification() {
        if (appContext != null) {
            android.app.NotificationManager nm = (android.app.NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(INCOMING_CALL_NOTIF_ID);
        }
    }

    private String resolveCallerName(String fromHeader, String extension) {
        try {
            java.util.List<com.company.internalcall.domain.model.UserContact> cached =
                    com.company.internalcall.data.local.ContactCache.getContacts();
            if (cached != null) {
                for (com.company.internalcall.domain.model.UserContact c : cached) {
                    if (extension != null && extension.equals(c.getExtension())
                            && c.getFullName() != null && !c.getFullName().trim().isEmpty()) {
                        return c.getFullName().trim();
                    }
                }
            }
        } catch (Exception ignored) {}

        if (fromHeader != null) {
            int firstQuote = fromHeader.indexOf('"');
            int secondQuote = fromHeader.indexOf('"', firstQuote + 1);
            if (firstQuote != -1 && secondQuote > firstQuote + 1) {
                String quotedName = fromHeader.substring(firstQuote + 1, secondQuote).trim();
                if (!quotedName.isEmpty() && !quotedName.equalsIgnoreCase(extension)) {
                    return quotedName;
                }
            }
        }

        return "Máy nhánh " + extension;
    }

    public void logout(Runnable onComplete) {
        synchronized (this) {
            logoutRequested = true;
            logoutCallback = onComplete;
        }

        mainHandler.removeCallbacks(keepAliveRunnable);
        mainHandler.removeCallbacks(logoutTimeoutRunnable);
        pendingDialExtension = "";

        if (!activeCallId.isEmpty() || isIncomingCall) {
            hangup();
        }

        if (sipWebSocket != null && isRegistered) {
            sendSipRegister(null, null, null, 0);
            mainHandler.postDelayed(logoutTimeoutRunnable, 5000);
        } 	 	 
 	 	 	 	 	 	 	 	# --- PHẦN 5/5 CỦA FILE ---
else {
            finishLogout();
        }
    }

    private void finishLogout() {
        mainHandler.removeCallbacks(keepAliveRunnable);
        mainHandler.removeCallbacks(logoutTimeoutRunnable);

        isRegistered = false;
        isConnectingSip = false;
        unregisterCseq = -1;

        WebSocket sip = sipWebSocket;
        sipWebSocket = null;
        if (sip != null) {
            try {
                sip.close(1000, "Logout");
            } catch (Exception ignored) {}
        }

        WebSocket events = eventWebSocket;
        eventWebSocket = null;
        if (events != null) {
            try {
                events.close(1000, "Logout");
            } catch (Exception ignored) {}
        }

        resetCallState();

        sipUsername = "";
        sipPassword = "";

        Runnable callback = logoutCallback;
        logoutCallback = null;

        if (callback != null) {
            mainHandler.post(callback);
        }
    }

    private static class SimpleSdpObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription sessionDescription) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String s) { Log.e(TAG, "SDP Create Error: " + s); }
        @Override public void onSetFailure(String s) { Log.e(TAG, "SDP Set Error: " + s); }
    }
}	 	 
 	 	 	 	 	 	 	ui	 	 	 
 	 	 	 	 	 	 	 	call	 	 
 	 	 	 	 	 	 	 	 	GroupParticipantPickerSheet.java	 
 	 	 	 	 	 	 	 	 	package com.company.internalcall.ui.call;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.company.internalcall.data.local.ContactCache;
import com.company.internalcall.data.local.SessionManager;
import com.company.internalcall.domain.model.UserContact;
import com.google.android.material.bottomsheet.BottomSheetDialog;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class GroupParticipantPickerSheet {

    public interface OnParticipantsSelectedListener {
        void onSelected(List<String> selectedExtensions);
    }

    public static void show(
            final Context context,
            final String titleText,
            final String confirmButtonPrefix,
            final int minRequired,
            final List<String> excludedExtensions,
            final OnParticipantsSelectedListener listener
    ) {
        final BottomSheetDialog dialog = new BottomSheetDialog(context);

        final Set<String> excludeSet = new HashSet<>();
        if (excludedExtensions != null) {
            excludeSet.addAll(excludedExtensions);
        }
        SessionManager sm = new SessionManager(context);
        if (sm.getCurrentUser() != null && sm.getCurrentUser().getExtension() != null) {
            excludeSet.add(sm.getCurrentUser().getExtension().trim());
        }

        final List<UserContact> allAvailable = new ArrayList<>();
        List<UserContact> cached = ContactCache.getContacts();
        if (cached != null) {
            for (UserContact c : cached) {
                if (c != null && c.getExtension() != null && !c.getExtension().trim().isEmpty()) {
                    if (!excludeSet.contains(c.getExtension().trim())) {
                        allAvailable.add(c);
                    }
                }
            }
        }

        final Set<String> selectedExts = new LinkedHashSet<>();

        int pad16 = dp(context, 16);
        int pad12 = dp(context, 12);
        int pad8 = dp(context, 8);

        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(pad16, pad16, pad16, pad16);

        // Tiêu đề
        TextView tvTitle = new TextView(context);
        tvTitle.setText(titleText);
        tvTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        tvTitle.setTypeface(null, Typeface.BOLD);
        tvTitle.setTextColor(Color.parseColor("#111827"));
        root.addView(tvTitle);

        // Ô tìm kiếm
        EditText etSearch = new EditText(context);
        etSearch.setHint("Tìm theo tên hoặc số nội bộ...");
        etSearch.setSingleLine(true);
        etSearch.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        etSearch.setPadding(pad12, pad8, pad12, pad8);
        GradientDrawable searchBg = new GradientDrawable();
        searchBg.setColor(Color.parseColor("#F3F4F6"));
        searchBg.setCornerRadius(dp(context, 8));
        etSearch.setBackground(searchBg);
        LinearLayout.LayoutParams searchLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 42));
        searchLp.topMargin = pad12;
        searchLp.bottomMargin = pad8;
        root.addView(etSearch, searchLp);

        // Danh sách cuộn
        ScrollView scrollView = new ScrollView(context);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 320));
        final LinearLayout listContainer = new LinearLayout(context);
        listContainer.setOrientation(LinearLayout.VERTICAL);
        scrollView.addView(listContainer);
        root.addView(scrollView, scrollLp);

        // Nút xác nhận
        final Button btnConfirm = new Button(context);
        btnConfirm.setAllCaps(false);
        btnConfirm.setTextColor(Color.WHITE);
        btnConfirm.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        btnConfirm.setTypeface(null, Typeface.BOLD);
        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setColor(Color.parseColor("#1E88E5"));
        btnBg.setCornerRadius(dp(context, 10));
        btnConfirm.setBackground(btnBg);
        btnConfirm.setText(confirmButtonPrefix + " (0)");
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 48));
        btnLp.topMargin = pad12;
        root.addView(btnConfirm, btnLp);

        final Runnable updateButtonLabel = new Runnable() {
            @Override
            public void run() {
                btnConfirm.setText(confirmButtonPrefix + " (" + selectedExts.size() + " người)");
            }
        };

        voidRenderList(context, listContainer, allAvailable, "", selectedExts, updateButtonLabel);

        etSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(Editable s) {
                String kw = (s != null) ? s.toString().trim() : "";
                voidRenderList(context, listContainer, allAvailable, kw, selectedExts, updateButtonLabel);
            }
        });

        btnConfirm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (selectedExts.size() < minRequired) {
                    Toast.makeText(context,
                            "Vui lòng chọn ít nhất " + minRequired + " thành viên",
                            Toast.LENGTH_SHORT).show();
                    return;
                }
                dialog.dismiss();
                if (listener != null) {
                    listener.onSelected(new ArrayList<>(selectedExts));
                }
            }
        });

        dialog.setContentView(root);
        dialog.show();
    }

    private static void voidRenderList(
            final Context context,
            final LinearLayout container,
            final List<UserContact> contacts,
            final String keyword,
            final Set<String> selectedExts,
            final Runnable onSelectionChanged
    ) {
        container.removeAllViews();
        String lowerKw = keyword.toLowerCase(Locale.ROOT);

        int count = 0;
        for (final UserContact c : contacts) {
            final String ext = c.getExtension().trim();
            final String name = (c.getFullName() != null && !c.getFullName().isEmpty())
                    ? c.getFullName() : ("Số nội bộ " + ext);
            String emp = (c.getEmpCode() != null) ? c.getEmpCode() : "";

            if (!lowerKw.isEmpty()
                    && !name.toLowerCase(Locale.ROOT).contains(lowerKw)
                    && !ext.toLowerCase(Locale.ROOT).contains(lowerKw)
                    && !emp.toLowerCase(Locale.ROOT).contains(lowerKw)) {
                continue;
            }
            count++;

            LinearLayout row = new LinearLayout(context);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(context, 8), dp(context, 10), dp(context, 8), dp(context, 10));

            final CheckBox cb = new CheckBox(context);
            cb.setChecked(selectedExts.contains(ext));
            cb.setClickable(false);
            cb.setFocusable(false);
            row.addView(cb);

            LinearLayout infoCol = new LinearLayout(context);
            infoCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            infoLp.leftMargin = dp(context, 10);

            TextView tvName = new TextView(context);
            tvName.setText(name);
            tvName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            tvName.setTypeface(null, Typeface.BOLD);
            tvName.setTextColor(Color.parseColor("#111827"));

            TextView tvSub = new TextView(context);
            tvSub.setText("Số nội bộ: " + ext + (c.isOnline() ? "  •  Trực tuyến" : ""));
            tvSub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            tvSub.setTextColor(c.isOnline() ? Color.parseColor("#2E7D32") : Color.parseColor("#6B7280"));

            infoCol.addView(tvName);
            infoCol.addView(tvSub);
            row.addView(infoCol, infoLp);

            row.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    boolean nowChecked = !cb.isChecked();
                    cb.setChecked(nowChecked);
                    if (nowChecked) {
                        selectedExts.add(ext);
                    } else {
                        selectedExts.remove(ext);
                    }
                    onSelectionChanged.run();
                }
            });

            container.addView(row);
        }

        if (count == 0) {
            TextView tvEmpty = new TextView(context);
            tvEmpty.setText("Không tìm thấy nhân viên phù hợp");
            tvEmpty.setGravity(Gravity.CENTER);
            tvEmpty.setTextColor(Color.parseColor("#6B7280"));
            tvEmpty.setPadding(0, dp(context, 24), 0, dp(context, 24));
            container.addView(tvEmpty);
        }
    }

    private static int dp(Context ctx, int dp) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, dp, ctx.getResources().getDisplayMetrics());
    }
}