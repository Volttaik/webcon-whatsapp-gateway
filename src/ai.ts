import https from "https";
import { Agent, Message } from "./db.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL        = "llama-3.3-70b-versatile";

function buildSystemPrompt(agent: Agent): string {
  return (
    agent.system_prompt?.trim() ||
    `You are ${agent.name}, an AI study agent for the subject "${agent.subject}". ` +
    `Your tone is ${agent.tone} and you explain at a ${agent.level} level. ` +
    `Help the student understand concepts, answer questions, and guide their learning.`
  );
}

export async function chat(agent: Agent, history: Message[], userMessage: string): Promise<string> {
  const messages = [
    { role: "system",    content: buildSystemPrompt(agent) },
    ...history.slice(-10),
    { role: "user",      content: userMessage },
  ];

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 512,
      temperature: 0.7,
    });

    const req = https.request(
      {
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as {
              choices?: { message?: { content?: string } }[];
              error?: { message?: string };
            };
            if (parsed.error) return reject(new Error(parsed.error.message));
            const content = parsed.choices?.[0]?.message?.content ?? "I could not generate a response.";
            resolve(content);
          } catch {
            reject(new Error("Failed to parse AI response"));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
