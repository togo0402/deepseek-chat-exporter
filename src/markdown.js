/**
 * markdown.js — 把选中的轮渲染成 Markdown 文本。
 *
 * 转义上的取舍：
 *   - 用户 / AI 正文原样输出，不转义。AI 回复本身就是 Markdown（代码块、表格、公式），
 *     转义会把它们毁掉。代价是用户消息若以 # 或 > 开头会被解析成标题 / 引用。
 *   - 深度思考内容必须转义 & < >。<details> 在 CommonMark 里属于 type-6 HTML block，
 *     内容按原始 HTML 解析，思考文本里出现 < 或 </details> 会破坏标签闭合、
 *     甚至把后面的正文全吞进去。
 */
(() => {
  const NS = (window.__DSEX__ = window.__DSEX__ || {});
  const { escapeHtml, collapseLines, isBlank, sanitizeFilename } = NS.utils;

  /** H1 标题：折叠换行并剥掉行首的 #，避免接口给的标题破坏文档结构 */
  function headingText(title) {
    return collapseLines(title).replace(/^#+\s*/, "") || "未命名会话";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  /** 2026-10-16 18:20:33 (GMT+8) */
  function formatStamp(input) {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return String(input ?? "");

    const offsetHours = -date.getTimezoneOffset() / 60;
    const gmt = `GMT${offsetHours >= 0 ? "+" : "-"}${Math.abs(offsetHours)}`;

    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} (${gmt})`
    );
  }

  function renderThinking(thinking) {
    return ["<details>", "<summary>深度思考</summary>", "", escapeHtml(thinking), "", "</details>"].join("\n");
  }

  function renderAssistantMessage(message, includeThinking) {
    const parts = [];
    if (includeThinking && !isBlank(message.thinking)) {
      parts.push(renderThinking(message.thinking));
    }
    if (!isBlank(message.content)) {
      parts.push(message.content);
    }
    return parts.join("\n\n");
  }

  function renderRound(round, includeThinking) {
    const blocks = [];

    if (round.userSelected) {
      const userText = round.user.map((message) => message.content).filter((text) => !isBlank(text)).join("\n\n");
      if (userText) blocks.push("**用户**", userText);
    }

    if (round.assistantSelected) {
      const assistantText = round.assistant
        .map((message) => renderAssistantMessage(message, includeThinking))
        .filter(Boolean)
        .join("\n\n");
      if (assistantText) blocks.push("**AI**", assistantText);
    }

    return blocks.join("\n\n");
  }

  /**
   * @param {object}   options
   * @param {string}   options.title           会话标题
   * @param {string}   options.sourceUrl       会话地址
   * @param {Date}     options.exportedAt      导出时间
   * @param {object[]} options.rounds          要导出的轮（已按需过滤）
   * @param {boolean}  options.includeThinking 是否保留深度思考
   * @param {number}   options.totalRounds     导出前的总轮数，用于显示「3 / 共 12 轮」
   */
  function renderMarkdown({ title, sourceUrl, exportedAt, rounds, includeThinking, totalRounds }) {
    const parts = [];

    parts.push(`# ${headingText(title)}`);
    parts.push(
      [
        `> 来源：${sourceUrl || "https://chat.deepseek.com"}`,
        `> 导出时间：${formatStamp(exportedAt || new Date())}`,
        `> 导出轮数：${rounds.length}${totalRounds ? ` / 共 ${totalRounds} 轮` : ""}`
      ].join("\n")
    );

    for (const round of rounds) {
      const body = renderRound(round, includeThinking);
      if (!body) continue;
      parts.push("---");
      parts.push(`## 第 ${round.index} 轮`);
      parts.push(body);
    }

    // 分块拼接，各块之间正好一个空行；不做全局换行压缩，否则会破坏代码块里的空行
    return parts.join("\n\n") + "\n";
  }

  function buildFilename(title) {
    return `${sanitizeFilename(title, "deepseek-chat")}.md`;
  }

  NS.markdown = { renderMarkdown, buildFilename, formatStamp, headingText };
})();
