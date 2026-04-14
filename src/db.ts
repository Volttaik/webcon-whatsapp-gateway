import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export interface WhatsappSession {
  phone_number: string;
  user_id: number | null;
  active_agent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsappAgentCode {
  id: number;
  code: string;
  agent_id: number;
  user_id: number;
  used: boolean;
  phone_number: string | null;
  created_at: string;
  used_at: string | null;
}

export interface Agent {
  id: number;
  name: string;
  subject: string;
  system_prompt: string | null;
  tone: string;
  level: string;
}

export async function getSession(phone: string): Promise<WhatsappSession | null> {
  const rows = await query<WhatsappSession>(
    "SELECT * FROM whatsapp_sessions WHERE phone_number = $1",
    [phone]
  );
  return rows[0] ?? null;
}

export async function upsertSession(
  phone: string,
  userId: number | null,
  activeAgentId: number | null
): Promise<void> {
  await query(
    `INSERT INTO whatsapp_sessions (phone_number, user_id, active_agent_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW()::text, NOW()::text)
     ON CONFLICT (phone_number) DO UPDATE
     SET user_id = $2, active_agent_id = $3, updated_at = NOW()::text`,
    [phone, userId, activeAgentId]
  );
}

export async function findAndActivateCode(
  code: string,
  phone: string
): Promise<WhatsappAgentCode | null> {
  const rows = await query<WhatsappAgentCode>(
    `UPDATE whatsapp_agent_codes
     SET used = true, phone_number = $2, used_at = NOW()::text
     WHERE code = $1 AND used = false
     RETURNING *`,
    [code.trim().toUpperCase(), phone]
  );
  return rows[0] ?? null;
}

export async function getAgent(agentId: number): Promise<Agent | null> {
  const rows = await query<Agent>(
    "SELECT id, name, subject, system_prompt, tone, level FROM agents WHERE id = $1",
    [agentId]
  );
  return rows[0] ?? null;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function getRecentMessages(
  userId: number,
  agentId: number,
  limit = 10
): Promise<Message[]> {
  const rows = await query<{ role: string; content: string }>(
    `SELECT m.role, m.content
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.user_id = $1 AND c.agent_id = $2
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [userId, agentId, limit]
  );
  return rows.reverse().map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
}

export async function saveMessage(
  userId: number,
  agentId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  let rows = await query<{ id: number }>(
    `SELECT id FROM conversations WHERE user_id = $1 AND agent_id = $2 ORDER BY updated_at DESC LIMIT 1`,
    [userId, agentId]
  );

  let convId: number;
  if (rows.length === 0) {
    const created = await query<{ id: number }>(
      `INSERT INTO conversations (user_id, agent_id, title, message_count, created_at, updated_at)
       VALUES ($1, $2, 'WhatsApp Chat', 0, NOW()::text, NOW()::text) RETURNING id`,
      [userId, agentId]
    );
    convId = created[0].id;
  } else {
    convId = rows[0].id;
  }

  await query(
    `INSERT INTO messages (conversation_id, role, content, think_ms, created_at)
     VALUES ($1, $2, $3, 0, NOW()::text)`,
    [convId, role, content]
  );

  await query(
    `UPDATE conversations SET message_count = message_count + 1, updated_at = NOW()::text WHERE id = $1`,
    [convId]
  );
}
