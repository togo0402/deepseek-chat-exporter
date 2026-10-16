/**
 * shared.js — 命名空间、常量与通用工具。
 * 必须是 manifest 中注入的第一个文件，其它文件都往 window.__DSEX__ 上挂东西。
 */
(() => {
  const NS = (window.__DSEX__ = window.__DSEX__ || {});

  NS.VERSION = "1.0.0";

  /* ---------------------------------- 常量 ---------------------------------- */

  NS.API_ROOT = "https://chat.deepseek.com/api/v0";
  NS.HISTORY_URL = NS.API_ROOT + "/chat/history_messages";

  NS.ROOT_ID = "dsex-root";

  /** 对话页地址形如 /a/chat/s/<session_id> */
  NS.SESSION_ID_RE = /\/a\/chat\/s\/([A-Za-z0-9_-]+)/i;

  /** chat_messages[].fragments[].type 的所有取值 */
  NS.FRAGMENT = {
    REQUEST: "REQUEST", // 用户提问
    RESPONSE: "RESPONSE", // AI 回答
    THINK: "THINK", // 深度思考
    TIP: "TIP" // 页面提示，导出时丢弃
  };

  /** DeepSeek 网页端会校验这些请求头，缺了会被拒绝 */
  NS.API_HEADERS = {
    accept: "application/json",
    "content-type": "application/json",
    "x-app-version": "2.0.0",
    "x-client-platform": "web",
    "x-client-version": "2.0.0"
  };

  /* ---------------------------------- 工具 ---------------------------------- */

  /** 把秒级时间戳 / 毫秒级时间戳 / ISO 字符串统一转成毫秒；无法识别返回 null */
  function toMillis(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return value > 9999999999 ? value : value * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /** 能转成有限数字就返回数字，否则 null。用于 message_id 比较，避免 NaN 参与排序 */
  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function formatTime(value) {
    const ms = toMillis(value);
    if (ms === null) return value ? String(value) : "";
    return new Date(ms).toLocaleString();
  }

  function isBlank(value) {
    return typeof value !== "string" || value.trim() === "";
  }

  /** 把连续空白折叠成单个空格，用于标题与面板预览 */
  function collapseLines(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function truncate(value, max = 80) {
    const text = collapseLines(value);
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  /**
   * HTML 转义。面板里用 innerHTML 渲染，<details> 内部也按原始 HTML 解析，
   * 两处都必须先过这个函数。
   */
  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]
    );
  }

  /**
   * 消息排序：时间 → message_id → 原始下标。
   * 参考实现直接用 Number(message_id) 相减，一旦 id 不是纯数字就会得到 NaN、
   * 顺序随机，所以这里每一级都必须先确认「两边都是有效值」再比较。
   */
  function sortMessages(list) {
    return list
      .map((message, origin) => ({ message, origin }))
      .sort((a, b) => {
        const timeA = toMillis(a.message.time);
        const timeB = toMillis(b.message.time);
        if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;

        const numA = toNumber(a.message.id);
        const numB = toNumber(b.message.id);
        if (numA !== null && numB !== null && numA !== numB) return numA - numB;

        const strA = String(a.message.id ?? "");
        const strB = String(b.message.id ?? "");
        if (strA && strB && strA !== strB) return strA.localeCompare(strB);

        return a.origin - b.origin;
      })
      .map((entry) => entry.message);
  }

  /** 去掉文件名非法字符、开头点号和路径分隔符，防止生成隐藏文件或越权路径 */
  function sanitizeFilename(value, fallback = "deepseek-chat", max = 80) {
    const cleaned = collapseLines(value)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/^[.\s]+/, "")
      .slice(0, max)
      .trim();
    return cleaned || fallback;
  }

  /** Blob + <a download>，不需要 downloads 权限 */
  function downloadText(filename, text, mime = "text/markdown;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /** 扩展被重载或卸载后，旧的 content script 仍会在页面里跑，用这个主动退出 */
  function isExtensionAlive() {
    try {
      return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /**
   * 监听 SPA 路由变化。
   *
   * content script 跑在隔离世界里，改写 history.pushState 拦不到页面自己发的调用
   * （两个 world 各有各的 JS 绑定），所以那套写法在这里无效。改用三层叠加：
   *   1. Navigation API —— 对同文档 SPA 导航也会触发，且隔离世界可用
   *   2. popstate / hashchange —— 覆盖前进后退
   *   3. 轮询比对 href —— 最笨但永远有效的兜底
   */
  function onLocationChange(callback) {
    let last = location.href;

    const fire = () => {
      if (location.href === last) return;
      last = location.href;
      callback(last);
    };

    if (window.navigation?.addEventListener) {
      window.navigation.addEventListener("navigate", () => setTimeout(fire, 0));
    }
    window.addEventListener("popstate", fire);
    window.addEventListener("hashchange", fire);

    const timer = setInterval(() => {
      if (!isExtensionAlive()) {
        clearInterval(timer);
        return;
      }
      fire();
    }, 500);

    callback(last);
    return () => clearInterval(timer);
  }

  NS.utils = {
    toMillis,
    toNumber,
    formatTime,
    isBlank,
    collapseLines,
    truncate,
    escapeHtml,
    sortMessages,
    sanitizeFilename,
    downloadText,
    debounce,
    isExtensionAlive,
    onLocationChange
  };
})();
