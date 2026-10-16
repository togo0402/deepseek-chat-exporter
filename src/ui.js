/**
 * ui.js — 悬浮「导出」按钮 + 选择面板。
 *
 * 渲染策略和参考实现一样朴素：改 state → 整体重建 #dsex-ui 的 innerHTML。
 * 面板最多几十轮，重建足够快，比手写 diff 更不容易出 bug。
 * 事件监听委托在 #dsex-root 上只绑一次，所以重建 innerHTML 不会丢事件。
 */
(() => {
  const NS = (window.__DSEX__ = window.__DSEX__ || {});
  const { escapeHtml, truncate, isBlank } = NS.utils;

  const state = {
    open: false,
    phase: "idle", // idle | loading | ready | exporting | error
    error: "",
    title: "",
    sourceUrl: "",
    rounds: [],
    totalRounds: 0,
    includeThinking: true,
    expanded: new Set(),
    sessionId: null,
    /** 打开面板时冻结的会话 id，用来发现用户中途切了对话 */
    boundSessionId: null,
    sessionChanged: false
  };

  let toastTimer = 0;
  /** 每次打开面板自增。关掉面板后又有异步结果返回时，靠它判断该结果是否已过期 */
  let openToken = 0;

  /* -------------------------------- 生命周期 -------------------------------- */

  function mount() {
    if (document.getElementById(NS.ROOT_ID)) return;

    const root = document.createElement("div");
    root.id = NS.ROOT_ID;
    root.innerHTML = '<div id="dsex-ui"></div><div class="dsex-toast" role="status"></div>';
    document.body.append(root);

    root.addEventListener("click", onRootClick);
    root.addEventListener("change", onRootChange);
    document.addEventListener("keydown", onKeyDown, true);

    render();
  }

  function render() {
    const ui = document.getElementById("dsex-ui");
    if (!ui) return;

    // 重建会重置滚动位置，先存后恢复
    const list = ui.querySelector(".dsex-list");
    const scrollTop = list ? list.scrollTop : 0;

    ui.innerHTML = fabHtml() + (state.open ? panelHtml() : "");

    const nextList = ui.querySelector(".dsex-list");
    if (nextList) nextList.scrollTop = scrollTop;

    syncRoundCheckboxes(ui);
  }

  /* --------------------------------- 事件 --------------------------------- */

  function onRootClick(event) {
    // 点遮罩空白处 = 关闭
    if (event.target.id === "dsex-mask") {
      closePanel();
      return;
    }

    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;

    const index = Number(trigger.dataset.index);

    switch (trigger.dataset.action) {
      case "toggle":
        if (state.open) closePanel();
        else openPanel();
        break;
      case "close":
        closePanel();
        break;
      case "expand":
        toggleExpand(index);
        break;
      case "select-all":
        setAllSelected(true);
        break;
      case "select-none":
        setAllSelected(false);
        break;
      case "export":
        doExport();
        break;
      case "reload":
        openPanel();
        break;
      default:
        break;
    }
  }

  function onRootChange(event) {
    const input = event.target;
    if (!input || input.type !== "checkbox") return;

    const index = Number(input.dataset.index);

    switch (input.dataset.role) {
      case "thinking":
        state.includeThinking = input.checked;
        render();
        break;
      case "round":
        setRoundSelected(index, input.checked);
        break;
      case "user":
        setPartSelected(index, "user", input.checked);
        break;
      case "assistant":
        setPartSelected(index, "assistant", input.checked);
        break;
      default:
        break;
    }
  }

  function onKeyDown(event) {
    if (event.key !== "Escape" || !state.open) return;
    event.stopPropagation();
    closePanel();
  }

  /* --------------------------------- 面板 --------------------------------- */

  async function openPanel() {
    const token = (openToken += 1);

    state.open = true;
    state.phase = "loading";
    state.error = "";
    state.rounds = [];
    state.totalRounds = 0;
    state.expanded = new Set();
    state.sessionChanged = false;
    state.sessionId = null;
    state.boundSessionId = null;
    render();

    try {
      const sessionId = await NS.api.resolveSessionId();
      if (token !== openToken) return;
      if (!sessionId) {
        throw new NS.api.ApiError("session", "当前是新对话，请先发送一条消息后再导出");
      }

      state.sessionId = sessionId;
      state.boundSessionId = sessionId;
      state.sourceUrl = new URL(`/a/chat/s/${sessionId}`, location.origin).href;

      const payload = await NS.api.fetchSession(sessionId);
      if (token !== openToken) return;
      const chatMessages = NS.messages.extractChatMessages(payload);

      if (!chatMessages.length) {
        console.warn("[DeepSeek 导出助手] 响应里找不到 chat_messages，接口结构可能已变更", payload);
        throw new NS.api.ApiError("parse", "无法解析会话数据，DeepSeek 接口可能已更新");
      }

      const rounds = NS.messages.buildRounds(chatMessages);
      if (!rounds.length) {
        throw new NS.api.ApiError("empty", "该对话暂无消息");
      }

      state.rounds = rounds;
      state.totalRounds = rounds.length;
      state.title = pickTitle(payload, rounds);
      state.phase = "ready";
    } catch (error) {
      if (token !== openToken) return;
      state.error = error?.name === "ApiError" ? error.message : `读取失败：${error?.message || error}`;
      state.phase = "error";
    }

    // 读取期间用户可能已经关掉面板，或者又打开了另一个会话
    if (state.open && token === openToken) render();
  }

  function closePanel() {
    openToken += 1; // 让还在路上的读取结果作废
    state.open = false;
    state.phase = "idle";
    state.error = "";
    state.rounds = [];
    state.totalRounds = 0;
    state.expanded = new Set();
    state.sessionId = null;
    state.boundSessionId = null;
    state.sessionChanged = false;
    render();
  }

  function doExport() {
    const selected = state.rounds.filter(NS.messages.hasSelection);
    if (!selected.length) return;

    state.phase = "exporting";
    render();

    try {
      const markdown = NS.markdown.renderMarkdown({
        title: state.title,
        sourceUrl: state.sourceUrl,
        exportedAt: new Date(),
        rounds: selected,
        includeThinking: state.includeThinking,
        totalRounds: state.totalRounds
      });

      NS.utils.downloadText(NS.markdown.buildFilename(state.title), markdown);
      toast(`已导出 ${selected.length} 轮对话`);
      closePanel();
    } catch (error) {
      state.phase = "error";
      state.error = `导出失败：${error?.message || error}`;
      render();
    }
  }

  /** 由 main.js 在路由变化时调用 */
  function handleLocationChange() {
    if (!state.open || !state.boundSessionId) return;

    const current = NS.api.getSessionIdFromUrl();
    const changed = Boolean(current) && current !== state.boundSessionId;
    if (changed === state.sessionChanged) return;

    state.sessionChanged = changed;
    render();
  }

  function toast(message) {
    const element = document.querySelector(`#${NS.ROOT_ID} .dsex-toast`);
    if (!element) return;

    element.textContent = message;
    element.classList.add("dsex-toast-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("dsex-toast-show"), 3000);
  }

  /* -------------------------------- 勾选操作 -------------------------------- */

  function setRoundSelected(index, checked) {
    const round = state.rounds[index];
    if (!round) return;
    round.userSelected = checked;
    round.assistantSelected = checked;
    render();
  }

  function setPartSelected(index, part, checked) {
    const round = state.rounds[index];
    if (!round) return;
    if (part === "user") round.userSelected = checked;
    else round.assistantSelected = checked;
    render();
  }

  function setAllSelected(checked) {
    for (const round of state.rounds) {
      round.userSelected = checked;
      round.assistantSelected = checked;
    }
    render();
  }

  function toggleExpand(index) {
    if (state.expanded.has(index)) state.expanded.delete(index);
    else state.expanded.add(index);
    render();
  }

  /* --------------------------------- 模板 --------------------------------- */

  function fabHtml() {
    return `<button type="button" id="dsex-fab" class="dsex-fab" data-action="toggle"
      aria-haspopup="dialog" aria-expanded="${state.open}" title="导出当前对话为 Markdown">
      <span class="dsex-fab-icon" aria-hidden="true">↓</span><span>导出</span>
    </button>`;
  }

  function panelHtml() {
    const selectedCount = state.rounds.filter(NS.messages.hasSelection).length;

    return `<div id="dsex-mask" class="dsex-mask">
  <div class="dsex-dialog" role="dialog" aria-modal="true" aria-label="导出当前对话">
    <div class="dsex-head">
      <div class="dsex-head-text">
        <div class="dsex-caption">导出当前对话</div>
        <div class="dsex-subtitle">${escapeHtml(state.title || "")}</div>
      </div>
      <button type="button" class="dsex-icon-btn" data-action="close" aria-label="关闭">×</button>
    </div>
    ${state.sessionChanged ? sessionChangedHtml() : ""}
    ${state.phase === "loading" ? loadingHtml() : ""}
    ${state.phase === "error" ? errorHtml() : ""}
    ${state.phase === "ready" || state.phase === "exporting" ? bodyHtml(selectedCount) : ""}
  </div>
</div>`;
  }

  function loadingHtml() {
    return `<div class="dsex-state"><span class="dsex-spinner" aria-hidden="true"></span>正在读取对话…</div>`;
  }

  function errorHtml() {
    return `<div class="dsex-state dsex-state-error">
      <div>${escapeHtml(state.error)}</div>
      <div><button type="button" class="dsex-btn" data-action="close">关闭</button></div>
    </div>`;
  }

  function sessionChangedHtml() {
    return `<div class="dsex-warn">
      <span>页面已切换到其它对话，下面仍是打开面板时的内容。</span>
      <button type="button" class="dsex-btn" data-action="reload">重新加载</button>
    </div>`;
  }

  function bodyHtml(selectedCount) {
    const exportable = selectedCount > 0 && state.phase !== "exporting";

    return `<div class="dsex-toolbar">
      <button type="button" class="dsex-btn" data-action="select-all">全选</button>
      <button type="button" class="dsex-btn" data-action="select-none">全不选</button>
      <label class="dsex-switch">
        <input type="checkbox" data-role="thinking" ${state.includeThinking ? "checked" : ""}>
        <span>保留深度思考</span>
      </label>
      <span class="dsex-count">已选 ${selectedCount} / ${state.rounds.length} 轮</span>
    </div>
    <div class="dsex-list">${roundsHtml()}</div>
    <div class="dsex-foot">
      <button type="button" class="dsex-btn" data-action="close">取消</button>
      <button type="button" class="dsex-btn dsex-primary" data-action="export" ${exportable ? "" : "disabled"}>
        ${state.phase === "exporting" ? "正在导出…" : "导出 Markdown"}
      </button>
    </div>`;
  }

  function roundsHtml() {
    if (!state.rounds.length) return `<div class="dsex-empty">该对话暂无可导出的消息</div>`;
    return state.rounds.map(roundHtml).join("");
  }

  function roundHtml(round, index) {
    const expanded = state.expanded.has(index);
    const userText = round.user.map((message) => message.content).join(" ");
    const aiText = round.assistant.map((message) => message.content).join(" ");

    const preview =
      [
        userText ? `用户：${truncate(userText, 36)}` : "",
        aiText ? `AI：${truncate(aiText, 36)}` : ""
      ]
        .filter(Boolean)
        .join("　·　") || "（无内容）";

    return `<div class="dsex-round">
      <div class="dsex-round-head">
        <input type="checkbox" class="dsex-ck" data-role="round" data-index="${index}">
        <button type="button" class="dsex-expand" data-action="expand" data-index="${index}"
          aria-expanded="${expanded}" aria-label="${expanded ? "收起" : "展开"}第 ${round.index} 轮"
        >${expanded ? "▾" : "▸"}</button>
        <span class="dsex-round-no">第 ${round.index} 轮</span>
        <span class="dsex-round-preview">${escapeHtml(preview)}</span>
      </div>
      ${expanded ? roundBodyHtml(round, index) : ""}
    </div>`;
  }

  function roundBodyHtml(round, index) {
    const rows = [];

    if (round.user.length) {
      const text = truncate(round.user.map((message) => message.content).join(" "), 140);
      rows.push(`<label class="dsex-part">
        <input type="checkbox" class="dsex-ck" data-role="user" data-index="${index}" ${round.userSelected ? "checked" : ""}>
        <span class="dsex-part-role">用户</span>
        <span class="dsex-part-preview">${escapeHtml(text || "（无文字）")}</span>
      </label>`);
    } else {
      rows.push(`<div class="dsex-part dsex-part-muted">
        <span class="dsex-part-role">用户</span><span class="dsex-part-preview">（该轮没有提问）</span>
      </div>`);
    }

    if (round.assistant.length) {
      const text = truncate(round.assistant.map((message) => message.content).join(" "), 140);
      const hasThinking = round.assistant.some((message) => !isBlank(message.thinking));
      rows.push(`<label class="dsex-part">
        <input type="checkbox" class="dsex-ck" data-role="assistant" data-index="${index}" ${round.assistantSelected ? "checked" : ""}>
        <span class="dsex-part-role">AI</span>
        <span class="dsex-part-preview">${escapeHtml(text || "（仅深度思考）")}</span>
        ${
          hasThinking
            ? `<span class="dsex-badge${state.includeThinking ? "" : " dsex-badge-off"}">含深度思考</span>`
            : ""
        }
      </label>`);
    } else {
      rows.push(`<div class="dsex-part dsex-part-muted">
        <span class="dsex-part-role">AI</span><span class="dsex-part-preview">（该轮没有回复）</span>
      </div>`);
    }

    return `<div class="dsex-round-body">${rows.join("")}</div>`;
  }

  /** 轮的勾选态是派生的，HTML 里写不出来，重建后必须用 JS 补 indeterminate */
  function syncRoundCheckboxes(ui) {
    for (const input of ui.querySelectorAll('input[data-role="round"]')) {
      const round = state.rounds[Number(input.dataset.index)];
      if (!round) continue;
      const { checked, indeterminate } = NS.messages.roundCheckState(round);
      input.checked = checked;
      input.indeterminate = indeterminate;
    }
  }

  function pickTitle(payload, rounds) {
    const fromApi = NS.messages.extractTitle(payload);
    if (!isBlank(fromApi)) return fromApi.trim();

    const fromTab = (document.title || "").replace(/\s*[-|｜]\s*DeepSeek\s*$/i, "").trim();
    if (fromTab && !/^deepseek$/i.test(fromTab)) return fromTab;

    const firstUser = rounds.find((round) => round.user.length)?.user[0]?.content;
    if (!isBlank(firstUser)) return truncate(firstUser, 50);

    return "未命名会话";
  }

  NS.ui = { mount, render, handleLocationChange, state, toast };
})();
