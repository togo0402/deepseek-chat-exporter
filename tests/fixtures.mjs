/**
 * fixtures.mjs — 手写的假 chat_messages 样本，覆盖分组算法会遇到的各种边界情况。
 * 每个样本都尽量贴近接口真实返回的形状。
 */

function chat(messageId, role, fragments, insertedAt) {
  return { message_id: messageId, role, inserted_at: insertedAt, fragments };
}

const request = (content) => ({ type: "REQUEST", content });
const response = (content) => ({ type: "RESPONSE", content });
const think = (content) => ({ type: "THINK", content });
const tip = (content) => ({ type: "TIP", content });

function payload(messages, title = "测试会话") {
  return {
    code: 0,
    msg: "",
    data: {
      biz_data: {
        chat_session: { id: "sess-1", title },
        chat_messages: messages
      }
    }
  };
}

/** 标准两轮，每轮一问一答 */
const basic = payload([
  chat(1, "USER", [request("问题一")], 1700000001),
  chat(2, "ASSISTANT", [think("想一下一"), response("回答一")], 1700000002),
  chat(3, "USER", [request("问题二")], 1700000003),
  chat(4, "ASSISTANT", [response("回答二")], 1700000004)
], "如何用 Python 读取 CSV");

/** 连续两条用户消息，前一轮没有 AI 回复 */
const consecutiveUser = payload([
  chat(1, "USER", [request("第一个问题")], 1700000001),
  chat(2, "USER", [request("第二个问题")], 1700000002),
  chat(3, "ASSISTANT", [response("对第二个问题的回答")], 1700000003)
]);

/** 同一个问题被重新生成，产生连续两条 AI 回复 */
const consecutiveAssistant = payload([
  chat(1, "USER", [request("写首诗")], 1700000001),
  chat(2, "ASSISTANT", [response("第一版诗")], 1700000002),
  chat(3, "ASSISTANT", [response("第二版诗")], 1700000003)
]);

/** 首条就是 AI，没有提问 */
const leadingAssistant = payload([
  chat(1, "ASSISTANT", [response("欢迎语，这条没有对应的提问")], 1700000001),
  chat(2, "USER", [request("接着问")], 1700000002),
  chat(3, "ASSISTANT", [response("接着答")], 1700000003)
]);

/** AI 只输出了深度思考，没有正文 */
const thinkOnly = payload([
  chat(1, "USER", [request("这道题怎么做")], 1700000001),
  chat(2, "ASSISTANT", [think("我还在推演，暂时没有结论")], 1700000002)
]);

/** 空消息、纯 TIP、以及长度正常的消息混在一起 */
const noise = payload([
  chat(1, "USER", [request("正常问题")], 1700000001),
  chat(2, "ASSISTANT", [tip("正在生成中")], 1700000002),
  chat(3, "ASSISTANT", [response("")], 1700000003),
  chat(4, "ASSISTANT", [response("正常回答")], 1700000004)
]);

/** inserted_at 顺序与 message_id 顺序不一致，用来验证排序 */
const messyOrder = payload([
  chat(30, "ASSISTANT", [response("后发生的回答")], 1700000030),
  chat(10, "USER", [request("先问的")], 1700000010),
  chat(20, "ASSISTANT", [response("先答的")], 1700000020),
  chat(40, "USER", [request("后问的")], 1700000040)
]);

/** 正文含 Markdown 特殊字符，深度思考含会破坏 <details> 的尖括号 */
const withSpecials = payload([
  chat(1, "USER", [request("# 这是个以井号开头的问题\n\n还有 > 引用符号")], 1700000001),
  chat(2, "ASSISTANT", [
    think("判断条件写错了：if (a < b && c > d) { ... } 而且 </details> 也出现了"),
    response("修正后的代码：\n\n```python\nif a < b and c > d:\n    pass\n```\n\n就这些。")
  ], 1700000002)
], "含特殊字符的会话");

/** 标题里带会破坏 H1 的字符 */
const nastyTitle = payload([
  chat(1, "USER", [request("随便问问")], 1700000001),
  chat(2, "ASSISTANT", [response("随便答答")], 1700000002)
], "## 带 / 斜杠 和 : 冒号 的标题");

export const cases = {
  basic,
  consecutiveUser,
  consecutiveAssistant,
  leadingAssistant,
  thinkOnly,
  noise,
  messyOrder,
  withSpecials,
  nastyTitle
};

export { payload, chat, request, response, think, tip };
