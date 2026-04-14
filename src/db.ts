import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseKey);

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

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function getSession(phone: string): Promise<WhatsappSession | null> {
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("phone_number", phone)
    .single();

  if (error || !data) return null;
  return data as WhatsappSession;
}

export async function upsertSession(
  phone: string,
  userId: number | null,
  activeAgentId: number | null
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("whatsapp_sessions")
    .upsert(
      {
        phone_number: phone,
        user_id: userId,
        active_agent_id: activeAgentId,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "phone_number" }
    );

  if (error) throw new Error(`upsertSession: ${error.message}`);
}

export async function findAndActivateCode(
  code: string,
  phone: string
): Promise<WhatsappAgentCode | null> {
  const upperCode = code.trim().toUpperCase();
  const now = new Date().toISOString();

  const { data: rows, error: fetchErr } = await supabase
    .from("whatsapp_agent_codes")
    .select("*")
    .eq("code", upperCode)
    .eq("used", false)
    .limit(1);

  if (fetchErr || !rows || rows.length === 0) return null;

  const record = rows[0] as WhatsappAgentCode;

  const { error: updateErr } = await supabase
    .from("whatsapp_agent_codes")
    .update({ used: true, phone_number: phone, used_at: now })
    .eq("id", record.id);

  if (updateErr) throw new Error(`findAndActivateCode update: ${updateErr.message}`);

  return { ...record, used: true, phone_number: phone, used_at: now };
}

export async function getAgent(agentId: number): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, subject, system_prompt, tone, level")
    .eq("id", agentId)
    .single();

  if (error || !data) return null;
  return data as Agent;
}

export async function getRecentMessages(
  userId: number,
  agentId: number,
  limit = 10
): Promise<Message[]> {
  const { data: convRows, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (convErr || !convRows || convRows.length === 0) return [];

  const convId = convRows[0].id;

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (msgErr || !msgRows) return [];

  return (msgRows as { role: string; content: string }[])
    .reverse()
    .map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
}

export async function saveMessage(
  userId: number,
  agentId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const now = new Date().toISOString();

  const { data: convRows, error: convFetchErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (convFetchErr) throw new Error(`saveMessage fetch conv: ${convFetchErr.message}`);

  let convId: number;

  if (!convRows || convRows.length === 0) {
    const { data: newConv, error: createErr } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        agent_id: agentId,
        title: "WhatsApp Chat",
        message_count: 0,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (createErr || !newConv) throw new Error(`saveMessage create conv: ${createErr?.message}`);
    convId = newConv.id;
  } else {
    convId = convRows[0].id;
  }

  const { error: msgErr } = await supabase.from("messages").insert({
    conversation_id: convId,
    role,
    content,
    think_ms: 0,
    created_at: now,
  });

  if (msgErr) throw new Error(`saveMessage insert: ${msgErr.message}`);

  await supabase
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", convId);
}
