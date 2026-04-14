import {
  getSession, upsertSession, findAndActivateCode,
  getAgent, getRecentMessages, saveMessage,
} from "./db.js";
import { chat } from "./ai.js";

const WELCOME =
  "👋 Welcome to *WebCon*!\n\n" +
  "To get started, generate an activation code for one of your agents in the WebCon platform, then send:\n\n" +
  "  */int YOUR_CODE* — activate an agent\n" +
  "  */reset NEW_CODE* — switch to a different agent\n\n" +
  "Visit webcon.app to manage your agents.";

const INT_USAGE  = "Usage: */int YOUR_CODE*\n\nGenerate a code for your agent in the WebCon platform first.";
const RESET_USAGE = "Usage: */reset YOUR_CODE*\n\nGenerate a new code for your agent in the WebCon platform first.";

export async function handleMessage(
  phone: string,
  text: string
): Promise<string> {
  const trimmed = text.trim();
  const lower   = trimmed.toLowerCase();

  if (lower === "hi" || lower === "hello" || lower === "hey") {
    return WELCOME;
  }

  if (lower.startsWith("/int")) {
    const parts = trimmed.split(/\s+/);
    const code  = parts[1];
    if (!code) return INT_USAGE;

    const record = await findAndActivateCode(code, phone);
    if (!record) {
      return "❌ Invalid or already used code. Generate a new one from the WebCon platform.";
    }

    await upsertSession(phone, record.user_id, record.agent_id);
    const agent = await getAgent(record.agent_id);

    return `✅ *${agent?.name ?? "Agent"}* is now active!\n\nYou can start chatting. Send */reset NEW_CODE* any time to switch agents.`;
  }

  if (lower.startsWith("/reset")) {
    const parts = trimmed.split(/\s+/);
    const code  = parts[1];
    if (!code) return RESET_USAGE;

    const record = await findAndActivateCode(code, phone);
    if (!record) {
      return "❌ Invalid or already used code. Generate a new one from the WebCon platform.";
    }

    await upsertSession(phone, record.user_id, record.agent_id);
    const agent = await getAgent(record.agent_id);

    return `🔄 Switched to *${agent?.name ?? "Agent"}*. Start chatting!`;
  }

  const session = await getSession(phone);
  if (!session?.active_agent_id || !session?.user_id) {
    return WELCOME;
  }

  const agent = await getAgent(session.active_agent_id);
  if (!agent) {
    return "⚠️ Your active agent could not be found. Please generate a new activation code.";
  }

  const history = await getRecentMessages(session.user_id, session.active_agent_id);
  await saveMessage(session.user_id, session.active_agent_id, "user", trimmed);

  let reply: string;
  try {
    reply = await chat(agent, history, trimmed);
  } catch (err) {
    console.error("[ai]", err);
    reply = "⚠️ I had trouble generating a response. Please try again.";
  }

  await saveMessage(session.user_id, session.active_agent_id, "assistant", reply);
  return reply;
}
