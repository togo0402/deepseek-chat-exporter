/**
 * run.mjs — 纯逻辑单测，直接 `node tests/run.mjs` 即可，不需要任何依赖。
 *
 * 在 Node 的 vm 里造一个带 window 的沙箱，把 src/ 下不碰 DOM 的三个模块跑起来，
 * 于是「轮分组」和「Markdown 生成」这两块最容易出错、又最依赖真实登录态的逻辑，
 * 可以脱离浏览器验证。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { cases } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [通过] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  [失败] ${name}`);
    console.error(`         ${error.message.replace(/\n/g, "\n         ")}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n期望: ${JSON.stringify(expected)}\n实际: ${JSON.stringify(actual)}`
    );
  }
}

function loadNamespace() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    navigator: { language: "zh-CN" },
    location: { href: "https://chat.deepseek.com/a/chat/s/sess-1", origin: "https://chat.deepseek.com" },
    document: { title: "", body: { append: () => {} }, createElement: () => ({}) }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ["shared.js", "messages.js", "markdown.js"]) {
    const code = fs.readFileSync(path.join(SRC, file), "utf8");
    vm.runInContext(code, sandbox, { filename: file });
  }

  return sandbox.window.__DSEX__;
}

const NS = loadNamespace();

/** 便捷入口：payload → 轮数组 */
const toRounds = (payload) => NS.messages.buildRounds(NS.messages.extractChatMessages(payload));

console.log(`\nDeepSeek 对话导出助手 — 逻辑测试 (src v${NS.VERSION})\n`);

/* ---------------------------- 1. 解析与容错 ---------------------------- */

console.log("1. 响应解析");

test("能从 data.biz_data.chat_messages 直取消息", () => {
  const messages = NS.messages.extractChatMessages(cases.basic);
  assertEqual(messages.length, 4, "消息条数不对");
});

test("接口多包一层时仍能靠遍历找到消息", () => {
  const wrapped = { code: 0, data: { outer: { inner: cases.basic.data.biz_data } } };
  assertEqual(NS.messages.extractChatMessages(wrapped).length, 4, "遍历兜底失败");
});

test("能取到会话标题", () => {
  assertEqual(NS.messages.extractTitle(cases.basic), "如何用 Python 读取 CSV", "标题不对");
});

test("接口结构完全变了时返回空数组而不是抛错", () => {
  assertEqual(NS.messages.extractChatMessages({ code: 0, data: {} }).length, 0, "应返回空数组");
});

/* ------------------------------ 2. 轮分组 ------------------------------ */

console.log("\n2. 轮分组");

test("标准对话分成两轮，问与答一一对应", () => {
  const rounds = toRounds(cases.basic);
  assertEqual(rounds.length, 2, "轮数不对");
  assertEqual(rounds[0].user[0].content, "问题一", "第 1 轮提问不对");
  assertEqual(rounds[0].assistant[0].content, "回答一", "第 1 轮回答不对");
  assertEqual(rounds[1].user[0].content, "问题二", "第 2 轮提问不对");
  assertEqual(rounds[0].index, 1, "编号应从 1 开始");
  assertEqual(rounds[1].index, 2, "编号应递增");
});

test("连续两条提问各成一轮，前一轮没有回答", () => {
  const rounds = toRounds(cases.consecutiveUser);
  assertEqual(rounds.length, 2, "轮数不对");
  assertEqual(rounds[0].assistant.length, 0, "第 1 轮不该有回答");
  assertEqual(rounds[1].user[0].content, "第二个问题", "第 2 轮提问不对");
  assertEqual(rounds[1].assistant[0].content, "对第二个问题的回答", "第 2 轮回答不对");
});

test("重新生成产生的连续两条 AI 回复并入同一轮", () => {
  const rounds = toRounds(cases.consecutiveAssistant);
  assertEqual(rounds.length, 1, "轮数不对");
  assertEqual(rounds[0].assistant.length, 2, "两条回复应并入同一轮");
});

test("首条就是 AI 时形成没有提问的轮", () => {
  const rounds = toRounds(cases.leadingAssistant);
  assertEqual(rounds.length, 2, "轮数不对");
  assertEqual(rounds[0].orphan, true, "第 1 轮应标记为无提问");
  assertEqual(rounds[0].user.length, 0, "第 1 轮不该有提问");
  assertEqual(rounds[1].user[0].content, "接着问", "第 2 轮提问不对");
});

test("只有深度思考、没有正文的回复不会被丢掉", () => {
  const rounds = toRounds(cases.thinkOnly);
  assertEqual(rounds.length, 1, "轮数不对");
  assertEqual(rounds[0].assistant.length, 1, "思考消息不应被过滤");
  assertEqual(rounds[0].assistant[0].content, "", "正文应为空");
  assertEqual(rounds[0].assistant[0].thinking, "我还在推演，暂时没有结论", "思考内容不对");
});

test("纯 TIP 和空消息被丢弃", () => {
  const rounds = toRounds(cases.noise);
  assertEqual(rounds.length, 1, "轮数不对");
  assertEqual(rounds[0].assistant.length, 1, "只有一条有效回复");
  assertEqual(rounds[0].assistant[0].content, "正常回答", "留下的应该是有效回复");
});

test("消息顺序错乱时按时间重新排好", () => {
  const rounds = toRounds(cases.messyOrder);
  assertEqual(rounds.length, 2, "轮数不对");
  assertEqual(rounds[0].user[0].content, "先问的", "第 1 轮提问不对");
  assertEqual(rounds[0].assistant.length, 2, "两条回答应归入第 1 轮");
  assertEqual(rounds[1].user[0].content, "后问的", "第 2 轮提问不对");
});

test("TIP 片段不会混进正文", () => {
  assert(!toRounds(cases.noise)[0].assistant[0].content.includes("正在生成中"), "TIP 内容泄漏了");
});

/* ------------------------------- 3. 排序 ------------------------------- */

console.log("\n3. 排序");

test("message_id 不是数字时不会乱序", () => {
  const list = [
    { id: "b-uuid", time: null },
    { id: "a-uuid", time: null },
    { id: "c-uuid", time: null }
  ];
  const ids = NS.utils.sortMessages(list).map((item) => item.id);
  assertEqual(ids.join(","), "a-uuid,b-uuid,c-uuid", "字符串 id 应按字典序稳定排列");
});

test("时间相同时退化到 message_id 比较", () => {
  const list = [
    { id: 3, time: 1700000000 },
    { id: 1, time: 1700000000 },
    { id: 2, time: 1700000000 }
  ];
  assertEqual(
    NS.utils.sortMessages(list).map((item) => item.id).join(","),
    "1,2,3",
    "时间相同的消息应按 id 排"
  );
});

/* ---------------------------- 4. Markdown 生成 ---------------------------- */

console.log("\n4. Markdown 生成");

const renderBasic = (options = {}) =>
  NS.markdown.renderMarkdown({
    title: "如何用 Python 读取 CSV",
    sourceUrl: "https://chat.deepseek.com/a/chat/s/abc123",
    exportedAt: new Date(2026, 9, 16, 18, 20, 33),
    rounds: toRounds(cases.basic),
    includeThinking: true,
    totalRounds: 2,
    ...options
  });

test("标题、元信息、轮次结构齐全", () => {
  const md = renderBasic();
  assert(md.startsWith("# 如何用 Python 读取 CSV"), "缺少 H1 标题");
  assert(md.includes("> 来源：https://chat.deepseek.com/a/chat/s/abc123"), "缺少来源");
  assert(md.includes("> 导出时间：2026-10-16 18:20:33 (GMT"), "导入时间格式不对");
  assert(md.includes("> 导出轮数：2 / 共 2 轮"), "缺少轮数统计");
  assert(md.includes("## 第 1 轮"), "缺少第 1 轮标题");
  assert(md.includes("## 第 2 轮"), "缺少第 2 轮标题");
  assert(md.includes("**用户**") && md.includes("**AI**"), "缺少说话人标记");
});

test("Markdown 换行干净，不出现三个以上连续空行", () => {
  const md = renderBasic();
  assert(!/\n{3,}/.test(md), "出现了多余的连续空行");
});

test("深度思考写成 details 折叠块", () => {
  const md = renderBasic();
  assert(md.includes("<details>"), "缺少 details 标签");
  assert(md.includes("<summary>深度思考</summary>"), "缺少 summary");
  assert(md.includes("想一下一"), "思考内容丢失");
});

test("关掉思考开关后不输出 details", () => {
  const md = renderBasic({ includeThinking: false });
  assert(!md.includes("<details>"), "不应出现 details");
  assert(!md.includes("想一下一"), "不应出现思考内容");
  assert(md.includes("回答一"), "正文仍应保留");
});

test("思考内容里的尖括号被转义，不会破坏 details 标签", () => {
  const md = NS.markdown.renderMarkdown({
    title: "含特殊字符的会话",
    sourceUrl: "https://chat.deepseek.com/a/chat/s/abc123",
    exportedAt: new Date(2026, 9, 16),
    rounds: toRounds(cases.withSpecials),
    includeThinking: true,
    totalRounds: 1
  });

  assert(md.includes("&lt;/details&gt;"), "思考内容里的 </details> 应被转义");
  assert(md.includes("&amp;&amp;"), "思考内容里的 && 应被转义");
  assertEqual((md.match(/<details>/g) || []).length, 1, "details 开标签应恰好一个");
  assertEqual((md.match(/<\/details>/g) || []).length, 1, "details 闭标签应恰好一个");
});

test("正文里的代码块和井号原样保留", () => {
  const md = NS.markdown.renderMarkdown({
    title: "含特殊字符的会话",
    sourceUrl: "",
    exportedAt: new Date(2026, 9, 16),
    rounds: toRounds(cases.withSpecials),
    includeThinking: true,
    totalRounds: 1
  });

  assert(md.includes("```python"), "代码块围栏丢失");
  assert(md.includes("if a < b and c > d:"), "代码块内容被改动");
  assert(md.includes("# 这是个以井号开头的问题"), "提问正文应原样保留");
});

test("只导出部分轮时保留原始编号", () => {
  const rounds = toRounds(cases.basic);
  rounds[0].userSelected = false;
  rounds[0].assistantSelected = false;

  const md = NS.markdown.renderMarkdown({
    title: "只导出第二轮",
    sourceUrl: "",
    exportedAt: new Date(2026, 9, 16),
    rounds: rounds.filter(NS.messages.hasSelection),
    includeThinking: true,
    totalRounds: 2
  });

  assert(!md.includes("问题一"), "第 1 轮不该被导出");
  assert(md.includes("## 第 2 轮"), "第 2 轮应保留原始编号");
  assert(md.includes("> 导出轮数：1 / 共 2 轮"), "轮数统计不对");
});

test("只勾某轮里的用户消息时不导出该轮的 AI 回复", () => {
  const rounds = toRounds(cases.basic);
  rounds[0].assistantSelected = false;

  const md = NS.markdown.renderMarkdown({
    title: "测试",
    sourceUrl: "",
    exportedAt: new Date(2026, 9, 16),
    rounds: [rounds[0]],
    includeThinking: true,
    totalRounds: 2
  });

  assert(md.includes("问题一"), "提问应被导出");
  assert(!md.includes("回答一"), "未勾选的回答不该出现");
});

test("关闭思考后仅剩思考的回复不会留下空段落", () => {
  const md = NS.markdown.renderMarkdown({
    title: "测试",
    sourceUrl: "",
    exportedAt: new Date(2026, 9, 16),
    rounds: toRounds(cases.thinkOnly),
    includeThinking: false,
    totalRounds: 1
  });

  assert(!md.includes("**AI**"), "只含思考的回复在关闭开关后不该输出空段落");
  assert(md.includes("这道题怎么做"), "提问仍应保留");
});

/* ------------------------------ 5. 勾选态 ------------------------------ */

console.log("\n5. 勾选态");

test("整轮勾选时父复选框为选中", () => {
  const state = NS.messages.roundCheckState(toRounds(cases.basic)[0]);
  assertEqual(state.checked, true, "应选中");
  assertEqual(state.indeterminate, false, "不该是半选");
});

test("只勾一部分时父复选框为半选", () => {
  const round = toRounds(cases.basic)[0];
  round.assistantSelected = false;
  const state = NS.messages.roundCheckState(round);
  assertEqual(state.checked, false, "不该是选中");
  assertEqual(state.indeterminate, true, "应是半选");
});

test("全部取消后父复选框为未选中", () => {
  const round = toRounds(cases.basic)[0];
  round.userSelected = false;
  round.assistantSelected = false;
  const state = NS.messages.roundCheckState(round);
  assertEqual(state.checked, false, "不该是选中");
  assertEqual(state.indeterminate, false, "不该是半选");
});

/* ------------------------------ 6. 文件名 ------------------------------ */

console.log("\n6. 文件名与工具函数");

test("文件名里的非法字符被替换", () => {
  assertEqual(
    NS.utils.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'),
    "a_b_c_d_e_f_g_h_i_j",
    "非法字符处理不对"
  );
});

test("标题里的井号不会进入 H1", () => {
  const md = NS.markdown.renderMarkdown({
    title: "## 带 / 斜杠 和 : 冒号 的标题",
    sourceUrl: "",
    exportedAt: new Date(2026, 9, 16),
    rounds: toRounds(cases.nastyTitle),
    includeThinking: true,
    totalRounds: 1
  });
  assert(md.startsWith("# 带 / 斜杠 和 : 冒号 的标题\n"), "H1 应剥掉井号且只保留一个 #");
});

test("导出文件名以 .md 结尾且不含路径分隔符", () => {
  const name = NS.markdown.buildFilename("## 带 / 斜杠 和 : 冒号 的标题");
  assert(name.endsWith(".md"), "应以 .md 结尾");
  assert(!/[\\/:*?"<>|]/.test(name), "不应含非法字符");
});

test("标题为空时回退到默认名", () => {
  assertEqual(NS.markdown.buildFilename(""), "deepseek-chat.md", "空标题应回退");
});

test("HTML 转义覆盖五个字符", () => {
  assertEqual(
    NS.utils.escapeHtml(`<a href="x" & 'y'>`),
    "&lt;a href=&quot;x&quot; &amp; &#039;y&#039;&gt;",
    "转义结果不对"
  );
});

test("秒级与毫秒级时间戳都能识别", () => {
  assertEqual(NS.utils.toMillis(1700000000), 1700000000000, "秒级时间戳应乘以 1000");
  assertEqual(NS.utils.toMillis(1700000000000), 1700000000000, "毫秒级时间戳应保持不变");
});

/* ------------------------------- 预览输出 ------------------------------- */

console.log("\n------------------------- 生成的 Markdown 预览 -------------------------\n");
console.log(renderBasic({ includeThinking: false }));
console.log("------------------------- 含特殊字符的样本 -------------------------\n");
console.log(
  NS.markdown.renderMarkdown({
    title: "含特殊字符的会话",
    sourceUrl: "https://chat.deepseek.com/a/chat/s/abc123",
    exportedAt: new Date(2026, 9, 16, 18, 20, 33),
    rounds: toRounds(cases.withSpecials),
    includeThinking: true,
    totalRounds: 1
  })
);

/* -------------------------------- 结果 -------------------------------- */

console.log("------------------------------------------------------------------------\n");
console.log(`通过 ${passed} 项，失败 ${failed} 项\n`);

process.exit(failed > 0 ? 1 : 0);
