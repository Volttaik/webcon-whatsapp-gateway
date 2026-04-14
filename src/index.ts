import dotenv from "dotenv";
dotenv.config();

import express from "express";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import path from "path";
import { handleMessage } from "./message-handler.js";

const PORT       = Number(process.env.PORT ?? 4000);
const AUTH_DIR   = path.join(process.cwd(), "baileys_auth");
const logger     = pino({ level: "warn" });

const store      = makeInMemoryStore({ logger });
let qrCodeData: string | null = null;
let isConnected               = false;
let connectionStatus          = "disconnected";

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  console.log(`[baileys] Using WA version ${version.join(".")}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ["WebCon Gateway", "Chrome", "1.0.0"],
  });

  store.bind(sock.ev);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = qr;
      connectionStatus = "awaiting_qr";
      console.log("\n[baileys] Scan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      isConnected  = false;
      qrCodeData   = null;
      const code   = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      connectionStatus = loggedOut ? "logged_out" : "reconnecting";
      console.log(`[baileys] Connection closed (${code}). ${loggedOut ? "Logged out." : "Reconnecting…"}`);
      if (!loggedOut) setTimeout(() => startWhatsApp(), 5000);
    }

    if (connection === "open") {
      isConnected  = true;
      qrCodeData   = null;
      connectionStatus = "connected";
      console.log("[baileys] ✅ WhatsApp connected");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message)   continue;

      const phone =
        msg.key.remoteJid?.replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "") ?? "";
      if (!phone) continue;

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        "";
      if (!text.trim()) continue;

      console.log(`[msg] from ${phone}: ${text.slice(0, 80)}`);

      try {
        const reply = await handleMessage(phone, text);
        await sock.sendMessage(msg.key.remoteJid!, { text: reply });
      } catch (err) {
        console.error("[handler]", err);
      }
    }
  });
}

/* ─── Express status API ─── */
const app = express();
app.use(express.json());

app.get("/status", (_req, res) => {
  res.json({ connected: isConnected, status: connectionStatus });
});

app.get("/qr", (_req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else if (isConnected) {
    res.json({ message: "Already connected, no QR needed." });
  } else {
    res.status(404).json({ message: "No QR code available yet. Restart to generate one." });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, connected: isConnected, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[server] WebCon WhatsApp Gateway running on port ${PORT}`);
  startWhatsApp().catch(console.error);
});
