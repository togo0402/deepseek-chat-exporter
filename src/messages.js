/**
 * messages.js — 把接口返回的 chat_messages 解析成归一化消息，再按「轮」分组。
 *
 * 数据结构（实测）：
 *   payload.data.biz_data.chat_messages[] = {
 *     message_id, role: "USER" | "ASSISTANT", inserted_at,
 *     fragments: [ { type: "REQUEST" | "RESPONSE" | "THINK" | "TIP", content } ]
 *   }
 * 角色一律以 role 字段为准，fragments 只用来取内容。
 */
(() => {
  const NS = (window.__DSEX__ = window.__DSEX__ || {});
  const { sortMessages, isBlank } = NS.utils;
  const { FRAGMENT } = NS;

  /* --------------------------------- 解析 --------------------------------- */

  /**
   * 从接口响应里取 chat_messages。
   * 先走实测的确定路径；失败则遍历整棵响应树找「元素带 fragments 数组」的那个数组，
   * 这样接口多包一层 data 也不会立刻失效。
   */
  function extractChatMessages(payload) {
    const direct = payload?.data?.biz_data?.chat_messages;
    if (Array.isArray(direct)) return direct;

    let found = [];
    walk(payload, (value, key) => {
      if (found.length || key !== "chat_messages" || !Array.isArray(value)) return;
      if (value.some((item) => item && typeof item === "object" && Array.isArray(item.fragments))) {
        found = value;
      }
    });
    return found;
  }

  function extractTitle(payload) {
    return payload?.data?.biz_data?.chat_session?.title || "";
  }

  function walk(value, visitor, key = "") {
    visitor(value, key);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visitor, key);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) walk(childValue, visitor, childKey);
  }

  /* -------------------------------- 归一化 -------------------------------- */

  function joinFragments(fragments, type) {
    return fragments
      .filter((fragment) => fragment && fragment.type === type)
      .map((fragment) => fragment.content || "")
      .filter((content) => !isBlank(content))
      .join("\n\n");
  }

  function normalizeRole(role) {
    const text = String(role || "").toUpperCase();
    if (text === "USER") return "user";
    if (text === "ASSISTANT") return "assistant";
    return text.toLowerCase() || "message";
  }

  function normalizeMessage(raw) {
    const fragments = Array.isArray(raw?.fragments) ? raw.fragments : [];
    const role = normalizeRole(raw?.role);

    // 按角色取对应的 fragment；取不到就退到「所有非提示、非思考的片段」拼起来
    let content = joinFragments(fragments, role === "assistant" ? FRAGMENT.RESPONSE : FRAGMENT.REQUEST);
    if (!content) {
      content = fragments
        .filter((fragment) => fragment && fragment.type !== FRAGMENT.TIP && fragment.type !== FRAGMENT.THINK)
        .map((fragment) => fragment.content || "")
        .filter((text) => !isBlank(text))
        .join("\n\n");
    }

    return {
      id: raw?.message_id ?? raw?.id ?? null,
      role,
      content,
      thinking: joinFragments(fragments, FRAGMENT.THINK),
      time: raw?.inserted_at ?? raw?.created_at ?? null
    };
  }

  function normalizeMessages(chatMessages) {
    return sortMessages(chatMessages.map(normalizeMessage));
  }

  /* --------------------------------- 分组 --------------------------------- */

  function createRound() {
    return {
      index: 0,
      user: [],
      assistant: [],
      other: [],
      orphan: false,
      userSelected: true,
      assistantSelected: true
    };
  }

  function hasContent(message) {
    return !isBlank(message.content) || !isBlank(message.thinking);
  }

  /**
   * 一轮 = 一条用户提问 + 紧随其后、直到下一条用户消息之前的全部 AI 回复。
   *
   * 连续 AI 回复（重新生成 / 分段输出）并入同一轮；连续提问各起一轮；
   * 首条就是 AI 时形成一个「没有提问的轮」，正常展示。
   */
  function buildRounds(chatMessages) {
    const sorted = normalizeMessages(chatMessages).filter(hasContent);
    const rounds = [];
    let current = null;

    for (const message of sorted) {
      if (message.role === "user") {
        if (current && current.orphan && current.assistant.length === 0) {
          // 先前单独冒出来的 AI 消息其实是这一问的回答，并进本轮而不是新开一轮
          current.user.push(message);
          current.orphan = false;
        } else {
          if (current) rounds.push(current);
          current = createRound();
          current.user.push(message);
        }
      } else if (message.role === "assistant") {
        if (!current) {
          current = createRound();
          current.orphan = true;
        }
        current.assistant.push(message);
      } else {
        // SYSTEM / TOOL / 未知角色，保守收下但默认不导出
        if (!current) {
          current = createRound();
          current.orphan = true;
        }
        current.other.push(message);
      }
    }
    if (current) rounds.push(current);

    return rounds
      .filter((round) => round.user.length > 0 || round.assistant.length > 0)
      .map((round, index) => {
        round.index = index + 1;
        return round;
      });
  }

  /**
   * 轮的勾选态由两个子项派生，不单独存字段，避免出现「父勾了子没勾」的不一致。
   */
  function roundCheckState(round) {
    const parts = [];
    if (round.user.length) parts.push(round.userSelected);
    if (round.assistant.length) parts.push(round.assistantSelected);

    const total = parts.length;
    const on = parts.filter(Boolean).length;
    return { checked: total > 0 && on === total, indeterminate: on > 0 && on < total };
  }

  function hasSelection(round) {
    return Boolean(
      (round.user.length && round.userSelected) || (round.assistant.length && round.assistantSelected)
    );
  }

  NS.messages = {
    extractChatMessages,
    extractTitle,
    normalizeMessage,
    normalizeMessages,
    buildRounds,
    roundCheckState,
    hasSelection
  };
})();
