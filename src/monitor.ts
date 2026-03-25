/**
 * Inbound WhatsApp message monitor.
 * Listens for incoming messages via Baileys and normalizes them for the channel.
 */
import {
  type WASocket,
  type WAMessage,
  type AnyMessageContent,
  type ConnectionState,
  DisconnectReason,
  isJidGroup,
} from "@whiskeysockets/baileys";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWhatsAppSocket, waitForConnection, resolveAuthDir } from "./session.js";

// ── Debug log file ──────────────────────────────────────────────────
const LOG_FILE = path.join(os.homedir(), ".claude", "whatsapp-channel", "debug.log");
function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
  console.error(msg);
}

// ── Types ───────────────────────────────────────────────────────────
export interface InboundMessage {
  id?: string;
  from: string;           // E.164 phone or group JID
  senderPhone: string | null;
  senderName?: string;
  chatId: string;         // remoteJid
  chatType: "direct" | "group";
  body: string;
  timestamp?: number;
  groupSubject?: string;
  isFromMe: boolean;
  replyToBody?: string;
  mediaPlaceholder?: string;
}

export interface MonitorOptions {
  authDir?: string;
  verbose?: boolean;
  allowFrom?: string[];   // E.164 phone numbers to allow (empty = allow all)
  onMessage: (msg: InboundMessage) => Promise<void>;
  onQr?: (qr: string) => void;
  onConnected?: () => void;
  onClose?: (reason: CloseReason) => void;
}

export interface CloseReason {
  statusCode?: number;
  isLoggedOut: boolean;
  error?: unknown;
}

// ── Deduplication ───────────────────────────────────────────────────
const recentMessages = new Map<string, number>();
const DEDUPE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const DEDUPE_MAX = 5000;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  // Prune old entries
  if (recentMessages.size > DEDUPE_MAX) {
    for (const [k, ts] of recentMessages) {
      if (now - ts > DEDUPE_TTL_MS) recentMessages.delete(k);
    }
  }
  if (recentMessages.has(key)) return true;
  recentMessages.set(key, now);
  return false;
}

// ── JID helpers ─────────────────────────────────────────────────────
function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const match = jid.match(/^(\d+)[@:]/);
  return match ? `+${match[1]}` : null;
}

// ── Text extraction ─────────────────────────────────────────────────
function extractText(message: any): string {
  if (!message) return "";
  // Standard text
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  // Captions on media
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  return "";
}

function extractMediaPlaceholder(message: any): string {
  if (!message) return "";
  if (message.imageMessage) return "<media:image>";
  if (message.videoMessage) return "<media:video>";
  if (message.audioMessage) return "<media:audio>";
  if (message.documentMessage) return `<media:document ${message.documentMessage.fileName ?? ""}>`;
  if (message.stickerMessage) return "<media:sticker>";
  if (message.contactMessage || message.contactsArrayMessage) return "<media:contact>";
  if (message.locationMessage || message.liveLocationMessage) {
    const loc = message.locationMessage ?? message.liveLocationMessage;
    return `<location lat="${loc.degreesLatitude}" lng="${loc.degreesLongitude}">`;
  }
  return "";
}

function extractReplyContext(message: any): string | undefined {
  const ctx = message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return undefined;
  const quoted = extractText(ctx.quotedMessage);
  return quoted || undefined;
}

// ── JID type detection ──────────────────────────────────────────────
function isLidJid(jid: string | null | undefined): boolean {
  return Boolean(jid && jid.endsWith("@lid"));
}

// ── Access control ──────────────────────────────────────────────────
function isAllowed(phone: string | null, allowList: string[], remoteJid?: string): boolean {
  if (allowList.length === 0) return true; // no allowlist = allow all
  if (!phone) return false;
  // Normalize: strip + prefix for comparison
  const normalize = (p: string) => p.replace(/^\+/, "");
  const match = allowList.some((a) => normalize(a) === normalize(phone));
  if (match) return true;

  // LID JIDs (Linked Identity) don't carry the real phone number.
  // WhatsApp is migrating to LID — allow these through when we can't resolve the real number.
  // The user can still restrict via pushName or by disabling the allowlist.
  if (remoteJid && isLidJid(remoteJid)) {
    debugLog(`[allowlist] LID JID detected (${remoteJid}), allowing through — real phone unknown`);
    return true;
  }

  return false;
}

// ── Monitor ─────────────────────────────────────────────────────────
const MAX_RETRIES = 3;

async function connectWithRetry(options: MonitorOptions, attempt = 1): Promise<WASocket> {
  const sock = await createWhatsAppSocket({
    authDir: options.authDir,
    printQrToTerminal: false,
    verbose: options.verbose,
    onQr: (qr) => options.onQr?.(qr),
    onConnection: (update) => {
      if (update.connection === "open") options.onConnected?.();
    },
  });

  try {
    await waitForConnection(sock);
    return sock;
  } catch (err) {
    const statusCode = (err as any)?.output?.statusCode ?? (err as any)?.statusCode;
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;

    if (isLoggedOut && attempt < MAX_RETRIES) {
      console.error("[whatsapp] Session logged out. Clearing stale credentials and retrying with QR...");
      // Clear the stale auth directory so Baileys generates a fresh QR
      const authDir = resolveAuthDir(options.authDir);
      try { await fsp.rm(authDir, { recursive: true, force: true }); } catch {}
      return connectWithRetry(options, attempt + 1);
    }

    // For status 515 (restart required), retry without clearing creds
    if (statusCode === 515 && attempt < MAX_RETRIES) {
      console.error("[whatsapp] Server requested restart. Retrying...");
      try { sock.end(undefined); } catch {}
      return connectWithRetry(options, attempt + 1);
    }

    throw err;
  }
}

export async function monitorWhatsApp(options: MonitorOptions) {
  const allowFrom = options.allowFrom ?? [];

  const sock = await connectWithRetry(options);
  const connectedAtMs = Date.now();

  // Send available presence
  try {
    await sock.sendPresenceUpdate("available");
  } catch (err) {
    if (options.verbose) console.error("[whatsapp] Failed to send presence:", String(err));
  }

  const selfJid = sock.user?.id;
  const selfPhone = jidToPhone(selfJid);

  // Track message IDs sent by the bot to avoid echo loops in self-chat
  const botSentIds = new Set<string>();
  const BOT_SENT_MAX = 500;

  // Group metadata cache
  const groupCache = new Map<string, { subject?: string; expires: number }>();
  const GROUP_CACHE_TTL = 5 * 60 * 1000;

  const getGroupSubject = async (jid: string): Promise<string | undefined> => {
    const cached = groupCache.get(jid);
    if (cached && cached.expires > Date.now()) return cached.subject;
    try {
      const meta = await sock.groupMetadata(jid);
      groupCache.set(jid, { subject: meta.subject, expires: Date.now() + GROUP_CACHE_TTL });
      return meta.subject;
    } catch {
      return undefined;
    }
  };

  // Handle incoming messages
  const handleUpsert = async (upsert: { type?: string; messages?: WAMessage[] }) => {
    debugLog(`[upsert] type=${upsert.type} count=${upsert.messages?.length ?? 0}`);
    if (upsert.type !== "notify" && upsert.type !== "append") return;

    for (const msg of upsert.messages ?? []) {
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) { debugLog("[skip] no remoteJid"); continue; }

      // Skip status/broadcast
      if (remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) {
        debugLog(`[skip] status/broadcast: ${remoteJid}`);
        continue;
      }

      // Deduplicate
      const msgId = msg.key?.id;
      if (msgId && isDuplicate(`${remoteJid}:${msgId}`)) {
        debugLog(`[skip] duplicate: ${msgId}`);
        continue;
      }

      // Skip history catch-up
      if (upsert.type === "append") {
        const ts = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : 0;
        if (ts < connectedAtMs - 60_000) {
          debugLog(`[skip] old append message ts=${ts}`);
          continue;
        }
      }

      const isGroup = isJidGroup(remoteJid) === true;
      const participantJid = msg.key?.participant;
      const senderPhone = isGroup ? jidToPhone(participantJid) : jidToPhone(remoteJid);
      const fromMe = Boolean(msg.key?.fromMe);

      debugLog(`[msg] jid=${remoteJid} sender=${senderPhone} fromMe=${fromMe} pushName=${msg.pushName} group=${isGroup}`);

      // Skip bot-sent messages (replies we sent), allow user-typed self-messages
      if (fromMe) {
        if (msgId && botSentIds.has(msgId)) {
          botSentIds.delete(msgId);
          debugLog("[skip] bot-sent message");
          continue;
        }
        if (isGroup) {
          debugLog("[skip] fromMe in group");
          continue;
        }
        debugLog("[allow] fromMe but not bot-sent — treating as user self-message");
      }

      // Access control
      if (!isAllowed(senderPhone, allowFrom, remoteJid)) {
        debugLog(`[skip] not allowed: ${senderPhone} jid=${remoteJid} allowList=[${allowFrom.join(",")}]`);
        continue;
      }

      // Extract content
      let body = extractText(msg.message);
      const mediaPlaceholder = extractMediaPlaceholder(msg.message);
      debugLog(`[msg] body="${body?.slice(0, 80)}" media="${mediaPlaceholder}"`);
      if (!body && !mediaPlaceholder) { debugLog("[skip] no content"); continue; }
      if (!body) body = mediaPlaceholder;

      const replyToBody = extractReplyContext(msg.message);
      const groupSubject = isGroup ? await getGroupSubject(remoteJid) : undefined;
      const from = isGroup ? remoteJid : (senderPhone ?? remoteJid);

      // Mark as read
      if (msgId) {
        try {
          await sock.readMessages([{
            remoteJid,
            id: msgId,
            participant: participantJid ?? undefined,
            fromMe: false,
          }]);
        } catch {}
      }

      const inbound: InboundMessage = {
        id: msgId ?? undefined,
        from,
        senderPhone,
        senderName: msg.pushName ?? undefined,
        chatId: remoteJid,
        chatType: isGroup ? "group" : "direct",
        body,
        timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : undefined,
        groupSubject,
        isFromMe: fromMe,
        replyToBody,
        mediaPlaceholder: mediaPlaceholder || undefined,
      };

      try {
        await options.onMessage(inbound);
      } catch (err) {
        console.error("[whatsapp] Error handling inbound message:", String(err));
      }
    }
  };

  sock.ev.on("messages.upsert", handleUpsert);

  // Track disconnection
  let closeResolve: ((reason: CloseReason) => void) | null = null;
  const onClose = new Promise<CloseReason>((resolve) => {
    closeResolve = resolve;
  });

  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    if (update.connection === "close") {
      const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
      const reason: CloseReason = {
        statusCode,
        isLoggedOut: statusCode === DisconnectReason.loggedOut,
        error: update.lastDisconnect?.error,
      };
      closeResolve?.(reason);
      options.onClose?.(reason);
    }
  });

  return {
    sock,
    selfJid,
    selfPhone,
    onClose,
    sendMessage: async (to: string, text: string) => {
      const jid = to.includes("@") ? to : `${to.replace(/^\+/, "")}@s.whatsapp.net`;
      await sock.sendPresenceUpdate("composing", jid);
      const result = await sock.sendMessage(jid, { text });
      const sentId = result?.key?.id;
      if (sentId) {
        // Track bot-sent IDs to avoid echo in self-chat
        if (botSentIds.size > BOT_SENT_MAX) botSentIds.clear();
        botSentIds.add(sentId);
      }
      return { messageId: sentId ?? "unknown" };
    },
    sendReaction: async (chatJid: string, messageId: string, emoji: string) => {
      await sock.sendMessage(chatJid, {
        react: { text: emoji, key: { remoteJid: chatJid, id: messageId, fromMe: false } },
      });
    },
    close: async () => {
      try {
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("connection.update");
        sock.end(undefined);
      } catch {}
    },
  };
}
