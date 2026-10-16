/**
 * api.js — 与 chat.deepseek.com 通信：token 提取、请求封装、当前会话 id 解析。
 *
 * token 提取与请求头逻辑移植自参考项目「他山之石」，那套写法已在真实环境验证过。
 * fetch 的目标与当前页面同源（chat.deepseek.com → chat.deepseek.com），没有 CORS 问题，
 * 因此不需要 background service worker。若将来被页面 CSP 影响，只需把这里改成
 * chrome.runtime.sendMessage 转发，改动局限在本文件。
 */
(() => {
  const NS = (window.__DSEX__ = window.__DSEX__ || {});

  /** 带 kind 的错误，便于 UI 区分提示文案 */
  class ApiError extends Error {
    constructor(kind, message, cause) {
      super(message);
      this.name = "ApiError";
      this.kind = kind;
      if (cause) this.cause = cause;
    }
  }

  /* --------------------------------- token --------------------------------- */

  function getToken() {
    const candidates = [
      readStorageValue("userToken"),
      readStorageValue("accessToken"),
      readStorageValue("token"),
      readStorageValue("authToken"),
      findTokenInStorage(localStorage),
      findTokenInStorage(sessionStorage)
    ];
    return candidates.map(normalizeToken).find(Boolean) || "";
  }

  function readStorageValue(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function findTokenInStorage(storage) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !/token|auth/i.test(key)) continue;
        const token = normalizeToken(storage.getItem(key) || "");
        if (token) return token;
      }
    } catch {
      /* 存储不可用时忽略 */
    }
    return "";
  }

  /** 处理被 JSON 包裹、带 "Bearer " 前缀、或干脆是裸串的各种 token 形态 */
  function normalizeToken(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "string" ? normalizeToken(parsed) : extractTokenFromObject(parsed);
      } catch {
        return "";
      }
    }

    const bearer = trimmed.match(/Bearer\s+([A-Za-z0-9._~+/=-]+)/i);
    if (bearer) return bearer[1];

    if (/^[A-Za-z0-9._~+/=-]{20,}$/.test(trimmed)) return trimmed;
    return "";
  }

  function extractTokenFromObject(value) {
    if (!value || typeof value !== "object") return "";
    if (Array.isArray(value)) {
      for (const item of value) {
        const token = extractTokenFromObject(item);
        if (token) return token;
      }
      return "";
    }

    for (const key of ["value", "userToken", "accessToken", "token", "authToken", "authorization"]) {
      const token = normalizeToken(value[key]);
      if (token) return token;
    }

    for (const [key, child] of Object.entries(value)) {
      if (!/token|auth/i.test(key)) continue;
      const token = typeof child === "string" ? normalizeToken(child) : extractTokenFromObject(child);
      if (token) return token;
    }

    return "";
  }

  /* --------------------------------- 请求 --------------------------------- */

  function isApiError(payload) {
    if (!payload || typeof payload !== "object") return false;
    return typeof payload.code === "number" && payload.code !== 0;
  }

  function buildHeaders(extra) {
    const token = getToken();
    return {
      ...NS.API_HEADERS,
      "x-client-locale": navigator.language?.toLowerCase().startsWith("zh") ? "zh_CN" : "en_US",
      "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
      ...(token
        ? { authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}` }
        : {}),
      ...extra
    };
  }

  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        credentials: "include",
        ...options,
        headers: buildHeaders(options.headers)
      });
    } catch (cause) {
      throw new ApiError("network", "网络请求失败，请检查网络后重试", cause);
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError("parse", "服务器返回了无法解析的内容，DeepSeek 接口可能已变更");
    }

    const apiMessage = payload?.msg || payload?.message || payload?.error;

    if (response.status === 401 || response.status === 403 || /missing token/i.test(String(apiMessage))) {
      throw new ApiError("auth", "登录已过期，请重新登录 chat.deepseek.com 后刷新页面");
    }
    if (!response.ok || isApiError(payload)) {
      throw new ApiError("api", String(apiMessage || `${response.status} ${response.statusText}`));
    }

    return payload;
  }

  /** 拉取一个会话的完整历史（标题、消息、深度思考都在同一个响应里） */
  async function fetchSession(sessionId) {
    if (!getToken()) {
      throw new ApiError("auth", "未检测到登录状态，请先登录 chat.deepseek.com 并刷新页面");
    }
    const url = new URL(NS.HISTORY_URL);
    url.searchParams.set("chat_session_id", sessionId);
    return requestJson(url.toString());
  }

  /* ----------------------------- 当前会话 id ----------------------------- */

  function getSessionIdFromUrl(href) {
    try {
      const url = new URL(href || location.href);
      const match = url.pathname.match(NS.SESSION_ID_RE);
      if (match) return match[1];
      return url.searchParams.get("chat_session_id") || null;
    } catch {
      return null;
    }
  }

  /**
   * 侧边栏兜底：找被标记为「当前选中」的那个会话链接。
   * 只读 href 里的 id，不按标题文本匹配——标题会重复、会截断、会带 emoji。
   */
  function findSessionIdInSidebar() {
    const activeSelector = '[aria-current="page"], [aria-selected="true"], [data-active="true"], [class*="active"]';
    for (const link of document.querySelectorAll('a[href*="/a/chat/s/"]')) {
      if (!link.matches(activeSelector) && !link.closest(activeSelector)) continue;
      const match = (link.getAttribute("href") || "").match(NS.SESSION_ID_RE);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * 解析当前会话 id。
   *
   * URL 里没有 id 时通常是「新对话」页面，此刻没有可导出的内容；但用户也可能刚发完
   * 第一条消息、URL 还没更新，所以先短等一会儿再退到侧边栏。
   * 绝不按标题去猜会话——那会静默导出别的对话。
   */
  async function resolveSessionId({ waitMs = 1500, step = 200 } = {}) {
    let id = getSessionIdFromUrl();
    if (id) return id;

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(step);
      id = getSessionIdFromUrl();
      if (id) return id;
    }

    return findSessionIdInSidebar();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  NS.api = {
    ApiError,
    getToken,
    normalizeToken,
    extractTokenFromObject,
    isApiError,
    requestJson,
    fetchSession,
    getSessionIdFromUrl,
    findSessionIdInSidebar,
    resolveSessionId
  };
})();
