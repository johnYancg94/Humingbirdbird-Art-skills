(function () {
  "use strict";

  var http = require("http");
  var bridgeHost = "127.0.0.1";
  var bridgePort = 47777;
  var pollIntervalMs = 1500;
  var pollPolicy = window.CodexBridgePollPolicy;
  var commandPolicy = window.CodexBridgeCommandPolicy;
  var connectionPolicy = window.CodexBridgeConnectionPolicy;
  var pollState = pollPolicy.createState();
  var connectionState = connectionPolicy.createState();
  var pollTimer = null;
  var statusTimer = null;
  var lastPollAt = null;
  var lastError = null;
  var lastCommandId = null;
  var pendingSnapshotUpload = null;
  var manualSnapshotRequest = null;
  var activeSnapshotRequestId = null;
  var cachedSnapshot = null;
  var cachedSnapshotId = null;
  var lastSnapshotDurationMs = null;
  var adapterAvailable = false;
  var brokerAvailable = false;

  function requestJson(method, path, body) {
    return new Promise(function (resolve, reject) {
      var payload = body === undefined ? null : JSON.stringify(body);
      var request = http.request({
        hostname: bridgeHost,
        port: bridgePort,
        path: path,
        method: method,
        headers: payload ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload)
        } : {}
      }, function (response) {
        var chunks = [];
        response.on("data", function (chunk) { chunks.push(chunk); });
        response.on("end", function () {
          var text = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error("Bridge request failed: " + response.statusCode));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch (error) {
            reject(new Error("Bridge returned invalid JSON: " + error.message));
          }
        });
      });
      request.setTimeout(5000, function () {
        request.destroy(new Error("Bridge request timed out"));
      });
      request.on("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  function evalScript(script) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__) {
        reject(new Error("Adobe CEP scripting interface is unavailable"));
        return;
      }
      window.__adobe_cep__.evalScript(script, function (result) {
        if (result === "EvalScript error.") {
          reject(new Error(result));
          return;
        }
        resolve(result);
      });
    });
  }

  async function loadAdapterScript() {
    if (!window.__adobe_cep__ || typeof window.__adobe_cep__.getSystemPath !== "function") {
      throw new Error("Adobe CEP extension path is unavailable");
    }
    var extensionRoot = window.__adobe_cep__.getSystemPath("extension");
    var scriptPath = extensionRoot.replace(/\/$/, "") + "/jsx/bridge.jsx";
    await evalScript("$.evalFile(new File(" + JSON.stringify(scriptPath) + "))");
  }

  async function callAdapter(method, argument) {
    var script = "$.global.psCodexBridge." + method + "(";
    if (argument !== undefined) {
      script += JSON.stringify(encodeURIComponent(JSON.stringify(argument)));
    }
    script += ")";
    var result = await evalScript(script);
    var parsed;
    try {
      parsed = JSON.parse(result);
    } catch (error) {
      throw new Error("Photoshop adapter returned invalid JSON: " + result);
    }
    if (parsed && parsed.__bridgeError) throw new Error(parsed.__bridgeError);
    return parsed;
  }

  function countLayers(layers) {
    var count = 0;
    (layers || []).forEach(function (layer) {
      count += 1 + countLayers(layer.layers || []);
    });
    return count;
  }

  function describeError(error) {
    var message = error && error.message ? error.message : String(error || "未知错误");
    if (/ECONNREFUSED|connect .*47777/i.test(message)) {
      return "Codex MCP 服务尚未启动或未加载，插件将自动重连。技术信息：" + message;
    }
    if (/timed out/i.test(message)) return "连接请求超时，插件将自动重试。技术信息：" + message;
    if (/CEP scripting interface is unavailable/i.test(message)) {
      return "Photoshop CEP 脚本权限不可用，请重新运行 Bridge 安装程序并重启 Photoshop。技术信息：" + message;
    }
    if (/EvalScript error/i.test(message)) {
      return "Photoshop 脚本适配器加载失败，请点击“重载插件”。技术信息：" + message;
    }
    return "连接或执行失败。技术信息：" + message;
  }

  function isBrokerError(error) {
    var message = error && error.message ? error.message : String(error || "");
    return /ECONNREFUSED|connect .*47777|timed out|Bridge request failed|Bridge returned invalid JSON/i.test(message);
  }

  function getRuntimeStatus() {
    return {
      ok: connectionState.phase === "connected",
      runtime: "CEP",
      loadingMode: "on-demand",
      connectionEnabled: connectionState.enabled,
      connectionPhase: connectionState.phase,
      cepInterfaceAvailable: Boolean(window.__adobe_cep__),
      adapterAvailable: adapterAvailable,
      brokerAvailable: brokerAvailable,
      hasDocument: Boolean(cachedSnapshot && cachedSnapshot.hasDocument),
      documentTitle: cachedSnapshot && cachedSnapshot.document ? cachedSnapshot.document.title : null,
      layerCount: cachedSnapshot ? countLayers(cachedSnapshot.layers) : 0,
      listening: Boolean(pollTimer),
      lastSnapshotDurationMs: lastSnapshotDurationMs,
      lastSnapshotScope: cachedSnapshot ? cachedSnapshot.scope : null,
      skippedOverlappingPolls: pollState.skippedPolls,
      activeSnapshotRequestId: activeSnapshotRequestId,
      autoApply: true,
      agentControl: "automatic",
      readDescriptors: false,
      lastPollAt: lastPollAt,
      lastCommandId: lastCommandId,
      lastError: lastError
    };
  }

  async function postRuntimeStatus() {
    await requestJson("POST", "/photoshop/status", getRuntimeStatus());
  }

  async function uploadPendingSnapshot(generation) {
    if (!pendingSnapshotUpload || !connectionPolicy.isCurrent(connectionState, generation)) return;
    var upload = pendingSnapshotUpload;
    var response = await requestJson("POST", "/photoshop/snapshot", {
      requestId: upload.requestId,
      connected: upload.snapshot.connected,
      runtime: upload.snapshot.runtime,
      photoshopVersion: upload.snapshot.photoshopVersion,
      hasDocument: upload.snapshot.hasDocument,
      document: upload.snapshot.document,
      layers: upload.snapshot.layers,
      scope: upload.snapshot.scope,
      snapshotEngine: upload.snapshot.snapshotEngine,
      capabilities: upload.snapshot.capabilities,
      fastSnapshotError: upload.snapshot.fastSnapshotError,
      capturedAt: upload.snapshot.capturedAt
    });
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    cachedSnapshot = upload.snapshot;
    cachedSnapshotId = response.snapshotId;
    pollPolicy.markSnapshot(pollState, upload.requestId);
    if (manualSnapshotRequest && manualSnapshotRequest.id === upload.requestId) {
      manualSnapshotRequest = null;
    }
    pendingSnapshotUpload = null;
  }

  async function captureSnapshot(request, generation) {
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    activeSnapshotRequestId = request.id;
    updatePanelStatus();
    var startedAt = Date.now();
    try {
      var snapshot = await callAdapter("snapshot", request.scope || { maxDepth: 1 });
      adapterAvailable = true;
      lastSnapshotDurationMs = Date.now() - startedAt;
      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      pendingSnapshotUpload = { requestId: request.id, snapshot: snapshot };
      await uploadPendingSnapshot(generation);
    } catch (error) {
      lastSnapshotDurationMs = Date.now() - startedAt;
      if (connectionPolicy.isCurrent(connectionState, generation)) {
        try {
          await requestJson("POST", "/photoshop/snapshot/error", {
            requestId: request.id,
            error: error.message
          });
        } catch (_) {}
      }
      throw error;
    } finally {
      if (connectionPolicy.isCurrent(connectionState, generation)) activeSnapshotRequestId = null;
    }
  }

  async function executeCommand(command, generation) {
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    lastCommandId = command.id;
    var result;
    try {
      result = await callAdapter("execute", command);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    await requestJson("POST", "/photoshop/commands/" + encodeURIComponent(command.id) + "/result", result);
    if (!result || result.ok !== true) {
      throw new Error(result && result.error ? result.error : "Photoshop command failed");
    }
  }

  async function failCommand(command, reason, generation) {
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    lastCommandId = command.id;
    await requestJson("POST", "/photoshop/commands/" + encodeURIComponent(command.id) + "/result", {
      ok: false,
      error: reason
    });
  }

  function commandContext() {
    return {
      snapshotId: cachedSnapshotId,
      documentId: cachedSnapshot && cachedSnapshot.document ? cachedSnapshot.document.id : null,
      documentTitle: cachedSnapshot && cachedSnapshot.document ? cachedSnapshot.document.title : null
    };
  }

  async function executeAgentCommand(command, generation) {
    var validation = commandPolicy.validateForAutomaticExecution(command, commandContext());
    if (!validation.ok) {
      await failCommand(command, "Automatic execution blocked: " + validation.reason, generation);
      throw new Error(validation.reason);
    }
    await executeCommand(command, generation);
  }

  async function pollOnce(generation) {
    if (!connectionPolicy.isCurrent(connectionState, generation)) return;
    if (!pollPolicy.beginPoll(pollState)) return;
    lastPollAt = new Date().toISOString();
    try {
      if (pendingSnapshotUpload) await uploadPendingSnapshot(generation);
      if (!connectionPolicy.isCurrent(connectionState, generation)) return;

      var requested = manualSnapshotRequest;
      if (!requested) {
        var work = await requestJson("GET", "/photoshop/requests/next");
        brokerAvailable = true;
        requested = work.snapshotRequest;
      }
      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      if (pollPolicy.shouldCaptureSnapshot(pollState, requested)) {
        await captureSnapshot(requested, generation);
        if (manualSnapshotRequest && manualSnapshotRequest.id === requested.id) manualSnapshotRequest = null;
      }

      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      var next = await requestJson("GET", "/photoshop/commands/next");
      brokerAvailable = true;
      if (next.command && connectionPolicy.isCurrent(connectionState, generation)) {
        await executeAgentCommand(next.command, generation);
      }

      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      lastError = null;
      connectionPolicy.markConnected(connectionState, generation);
      await postRuntimeStatus();
    } catch (error) {
      if (connectionPolicy.isCurrent(connectionState, generation)) {
        brokerAvailable = false;
        connectionPolicy.markRetrying(connectionState, generation);
        lastError = describeError(error);
      }
    } finally {
      pollPolicy.endPoll(pollState);
      updatePanelStatus();
    }
  }

  function startPolling(generation) {
    if (pollTimer) return;
    pollTimer = setInterval(function () { pollOnce(generation); }, pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function startAllConnections() {
    var generation = connectionPolicy.beginStart(connectionState);
    if (generation === null) return;
    lastError = null;
    adapterAvailable = false;
    brokerAvailable = false;
    updatePanelStatus();
    try {
      if (!window.__adobe_cep__) throw new Error("Adobe CEP scripting interface is unavailable");
      await loadAdapterScript();
      var adapterStatus = await callAdapter("status");
      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      adapterAvailable = Boolean(adapterStatus && adapterStatus.connected);
      if (!adapterAvailable) throw new Error("Photoshop adapter did not confirm connection");

      startPolling(generation);
      try {
        await requestJson("GET", "/health");
        brokerAvailable = true;
      } catch (brokerError) {
        lastError = describeError(brokerError);
      }
      if (!connectionPolicy.isCurrent(connectionState, generation)) return;
      manualSnapshotRequest = {
        id: "connect-" + Date.now(),
        reason: "Panel one-click connection",
        scope: { maxDepth: null }
      };
      await pollOnce(generation);
    } catch (error) {
      lastError = describeError(error);
      adapterAvailable = false;
      stopPolling();
      connectionPolicy.markFailed(connectionState, generation);
      updatePanelStatus();
    }
  }

  async function stopAllConnections(reportStatus) {
    connectionPolicy.stop(connectionState);
    stopPolling();
    manualSnapshotRequest = null;
    pendingSnapshotUpload = null;
    activeSnapshotRequestId = null;
    adapterAvailable = false;
    brokerAvailable = false;
    lastError = null;
    updatePanelStatus();
    if (reportStatus !== false) {
      try { await postRuntimeStatus(); } catch (_) {}
    }
  }

  function formatScope(scope) {
    if (!scope) return "无";
    return scope.maxDepth === null ? "完整图层树" : "深度 " + scope.maxDepth;
  }

  function yesNo(value) {
    return value ? "可用" : "不可用";
  }

  function updatePanelStatus() {
    var status = getRuntimeStatus();
    var connection = document.getElementById("connection");
    var badgeText = "已关闭";
    var badgeClass = "badge";
    if (status.connectionPhase === "connecting") {
      badgeText = status.lastError ? "自动重连中" : "正在连接";
      badgeClass += status.lastError ? " warning" : "";
    } else if (status.connectionPhase === "connected") {
      badgeText = "已连接";
      badgeClass += " ok";
    } else if (status.connectionPhase === "error") {
      badgeText = "连接异常";
      badgeClass += " error";
    }
    connection.textContent = badgeText;
    connection.className = badgeClass;

    document.getElementById("start").disabled = status.connectionEnabled;
    document.getElementById("stop").disabled = !status.connectionEnabled;
    document.getElementById("refresh").disabled = !status.connectionEnabled;
    document.getElementById("status").textContent = [
      "运行环境：CEP 独立安装版",
      "连接总开关：" + (status.connectionEnabled ? "已开启" : "已关闭"),
      "CEP 接口权限：" + yesNo(status.cepInterfaceAvailable),
      "Photoshop 脚本适配器：" + yesNo(status.adapterAvailable),
      "Codex MCP 服务：" + yesNo(status.brokerAvailable),
      "命令监听：" + (status.listening ? "运行中" : "已停止"),
      "图层读取方式：按需读取",
      "Agent 控制：自动执行",
      "命令保护：快照 + 文档 + 操作预览",
      "已验证快照：" + (cachedSnapshotId || "无"),
      "缓存文档：" + (status.documentTitle || "无"),
      "缓存图层数：" + status.layerCount,
      "缓存范围：" + formatScope(status.lastSnapshotScope),
      "快照引擎：" + (cachedSnapshot && cachedSnapshot.snapshotEngine || "无"),
      "上次读取耗时：" + (status.lastSnapshotDurationMs === null ? "无" : status.lastSnapshotDurationMs + " 毫秒"),
      "正在读取：" + (status.activeSnapshotRequestId || "无"),
      "跳过的重叠轮询：" + status.skippedOverlappingPolls,
      "上次服务轮询：" + (status.lastPollAt || "从未"),
      "上次命令：" + (status.lastCommandId || "无"),
      "最近错误：" + (status.lastError || "无")
    ].join("\n");
  }

  document.getElementById("start").addEventListener("click", startAllConnections);
  document.getElementById("stop").addEventListener("click", function () { stopAllConnections(true); });
  document.getElementById("reload").addEventListener("click", function () {
    stopAllConnections(false).then(function () { window.location.reload(); });
  });
  document.getElementById("refresh").addEventListener("click", function () {
    if (!connectionState.enabled) {
      lastError = "请先点击“一键开启连接”。";
      updatePanelStatus();
      return;
    }
    manualSnapshotRequest = {
      id: "manual-" + Date.now(),
      reason: "Manual panel refresh",
      scope: { maxDepth: null }
    };
    pollOnce(connectionState.generation);
    updatePanelStatus();
  });

  window.addEventListener("beforeunload", function () {
    connectionPolicy.stop(connectionState);
    stopPolling();
  });

  statusTimer = setInterval(updatePanelStatus, 1000);
  updatePanelStatus();
}());
