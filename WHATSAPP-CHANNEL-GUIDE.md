# WhatsApp Channel for Claude Code — Complete Build Guide

A step-by-step guide to building a two-way WhatsApp channel for Claude Code using Baileys (WhatsApp Web). This channel lets you send messages to Claude from WhatsApp, and Claude replies back — all through the MCP (Model Context Protocol) channel system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Project Setup](#4-project-setup)
5. [Step 1: Session Manager (session.ts)](#5-step-1-session-manager)
6. [Step 2: QR Code Server (qr-server.ts)](#6-step-2-qr-code-server)
7. [Step 3: Message Monitor (monitor.ts)](#7-step-3-message-monitor)
8. [Step 4: MCP Channel Server (index.ts)](#8-step-4-mcp-channel-server)
9. [Step 5: Type Declarations (types.d.ts)](#9-step-5-type-declarations)
10. [Step 6: Configuration (.mcp.json)](#10-step-6-configuration)
11. [Running the Channel](#11-running-the-channel)
12. [How It Works End-to-End](#12-how-it-works-end-to-end)
13. [Environment Variables](#13-environment-variables)
14. [Permission Relay](#14-permission-relay)
15. [Troubleshooting](#15-troubleshooting)
16. [Known Issues & Limitations](#16-known-issues--limitations)

---

## 1. Overview

This channel bridges WhatsApp into a Claude Code session using:

- **Baileys** — an open-source WhatsApp Web client (no Business API needed)
- **MCP SDK** — the Model Context Protocol for Claude Code channels
- **QR Code authentication** — scan once, session persists across restarts

### Features

| Feature | Description |
|---------|-------------|
| Two-way messaging | Receive WhatsApp messages, Claude replies back |
| QR code login | Browser-based QR page at `http://localhost:8787` |
| Permission relay | Approve/deny Claude's tool use from WhatsApp |
| Sender allowlist | Restrict who can message your Claude session |
| Group chat | Group messages include subject and participant info |
| Reactions | Claude can react to messages with emoji |
| Deduplication | 20-minute TTL cache prevents double-processing |
| Auto-retry | Clears stale sessions and retries with fresh QR |
| Debug logging | Logs to `~/.claude/whatsapp-channel/debug.log` |

---

## 2. Architecture

```
WhatsApp (your phone)
    |
    v
WhatsApp Web servers (E2E encrypted)
    |
    v
Baileys WebSocket client (local)
    |
    v
monitor.ts ── inbound message handler
    |            - deduplication
    |            - access control (allowlist + LID support)
    |            - text/media extraction
    |
    v
index.ts ── MCP channel server (stdio)
    |            - channel notifications to Claude
    |            - permission relay
    |            - reply tool + react tool
    |
    v  (stdio)
Claude Code session
    |
    v  (whatsapp_reply tool)
index.ts ── sends reply back
    |
    v
monitor.ts ── sock.sendMessage()
    |
    v
WhatsApp (recipient's phone)
```

### File Structure

```
whatsapp-channel/
├── .mcp.json              # Claude Code MCP server config
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
└── src/
    ├── types.d.ts         # Type declarations for qrcode libs
    ├── session.ts         # Baileys socket, QR auth, credential management
    ├── qr-server.ts       # Local HTTP server for QR code display
    ├── monitor.ts         # Inbound message listener, dedup, access control
    └── index.ts           # MCP channel server entry point
```

---

## 3. Prerequisites

- **Node.js 20+** (or Bun)
- **Claude Code v2.1.80+** with channels enabled
- **claude.ai login** (not API keys — channels require it)
- **A WhatsApp account** on your phone

---

## 4. Project Setup

### Create the project directory

```bash
mkdir whatsapp-channel && cd whatsapp-channel
mkdir src
```

### package.json

```json
{
  "name": "whatsapp-channel",
  "version": "0.1.0",
  "type": "module",
  "description": "WhatsApp channel for Claude Code using Baileys (WhatsApp Web)",
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@whiskeysockets/baileys": "^7.0.0-rc.9",
    "qrcode": "^1.5.4",
    "qrcode-terminal": "^0.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

### Install dependencies

```bash
npm install
npm install --save-dev tsx
```

---

## 5. Step 1: Session Manager

**File: `src/session.ts`**

This file handles the Baileys WebSocket connection, QR code authentication, and credential persistence. It's the foundation everything else builds on.

### What it does:

- Creates a Baileys socket connected to WhatsApp Web servers
- Manages credential storage at `~/.claude/whatsapp-channel/auth/`
- Queues credential saves to prevent corruption
- Auto-restores from backup if `creds.json` is corrupted
- Provides callbacks for QR codes and connection state changes

### Key concepts:

- **Multi-file auth state**: Baileys stores session keys across multiple JSON files
- **Credential save queue**: Prevents race conditions when multiple credential updates fire rapidly
- **Backup rotation**: Before each save, the current `creds.json` is backed up to `creds.json.bak`

### Code:

```typescript
/**
 * WhatsApp Web session management via Baileys.
 * Handles socket creation, QR authentication, credential persistence, and reconnection.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

// ── Auth directory ──────────────────────────────────────────────────
const DEFAULT_AUTH_DIR = path.join(os.homedir(), ".claude", "whatsapp-channel", "auth");

export function resolveAuthDir(custom?: string): string {
  return custom ?? DEFAULT_AUTH_DIR;
}

function credsPath(authDir: string): string {
  return path.join(authDir, "creds.json");
}

function credsBackupPath(authDir: string): string {
  return path.join(authDir, "creds.json.bak");
}

// ── Credential helpers ──────────────────────────────────────────────
export function hasCredentials(authDir: string = DEFAULT_AUTH_DIR): boolean {
  try {
    const stats = fs.statSync(credsPath(authDir));
    return stats.isFile() && stats.size > 1;
  } catch {
    return false;
  }
}

function maybeRestoreBackup(authDir: string): void {
  try {
    const cp = credsPath(authDir);
    const bp = credsBackupPath(authDir);
    const raw = fs.existsSync(cp) ? fs.readFileSync(cp, "utf-8") : null;
    if (raw && raw.length > 1) {
      JSON.parse(raw); // validate
      return;
    }
    // Try backup
    if (!fs.existsSync(bp)) return;
    const backup = fs.readFileSync(bp, "utf-8");
    JSON.parse(backup); // validate
    fs.copyFileSync(bp, cp);
    try { fs.chmodSync(cp, 0o600); } catch {}
    console.error("[whatsapp] Restored creds from backup");
  } catch {}
}

// ── Credential save queue (prevents corruption) ─────────────────────
const saveQueues = new Map<string, Promise<void>>();

function enqueueSave(authDir: string, saveCreds: () => Promise<void>): void {
  const prev = saveQueues.get(authDir) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      // Backup current creds before overwriting
      try {
        const cp = credsPath(authDir);
        const bp = credsBackupPath(authDir);
        if (fs.existsSync(cp)) {
          const raw = fs.readFileSync(cp, "utf-8");
          JSON.parse(raw); // only backup valid JSON
          fs.copyFileSync(cp, bp);
          try { fs.chmodSync(bp, 0o600); } catch {}
        }
      } catch {}
      await saveCreds();
      try { fs.chmodSync(credsPath(authDir), 0o600); } catch {}
    })
    .catch((err) => console.error("[whatsapp] Creds save error:", String(err)))
    .finally(() => {
      if (saveQueues.get(authDir) === next) saveQueues.delete(authDir);
    });
  saveQueues.set(authDir, next);
}

// ── Socket creation ─────────────────────────────────────────────────
export type QrCallback = (qr: string) => void;
export type ConnectionCallback = (update: Partial<ConnectionState>) => void;

export interface CreateSocketOptions {
  authDir?: string;
  onQr?: QrCallback;
  onConnection?: ConnectionCallback;
  printQrToTerminal?: boolean;
  verbose?: boolean;
}

export async function createWhatsAppSocket(
  opts: CreateSocketOptions = {},
): Promise<WASocket> {
  const authDir = resolveAuthDir(opts.authDir);
  await fsp.mkdir(authDir, { recursive: true });
  maybeRestoreBackup(authDir);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  // Baileys wants a pino-like logger; silence it unless verbose
  const logger = {
    level: opts.verbose ? "info" : "silent",
    info: opts.verbose ? console.log.bind(console) : () => {},
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: () => {},
    trace: () => {},
    fatal: console.error.bind(console),
    child: () => logger,
  } as any;

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    version,
    logger,
    printQRInTerminal: false,
    browser: ["Claude Code WhatsApp", "CLI", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Save credentials on update
  sock.ev.on("creds.update", () => enqueueSave(authDir, saveCreds));

  // Connection state changes
  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        opts.onQr?.(qr);
        if (opts.printQrToTerminal) {
          console.error("\nScan this QR code in WhatsApp > Linked Devices:\n");
          qrcode.generate(qr, { small: true }, (output: string) => {
            console.error(output);
          });
        }
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          console.error("[whatsapp] Session logged out. Re-run to scan a new QR code.");
        }
      }
      if (connection === "open") {
        console.error("[whatsapp] Connected to WhatsApp Web.");
      }
      opts.onConnection?.(update);
    } catch (err) {
      console.error("[whatsapp] connection.update error:", String(err));
    }
  });

  // Prevent unhandled WS errors from crashing
  if (sock.ws && typeof (sock.ws as any).on === "function") {
    (sock.ws as any).on("error", (err: Error) => {
      console.error("[whatsapp] WebSocket error:", String(err));
    });
  }

  return sock;
}

// ── Wait for connection ─────────────────────────────────────────────
export function waitForConnection(sock: WASocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handler = (update: Partial<ConnectionState>) => {
      if (update.connection === "open") {
        (sock.ev as any).off?.("connection.update", handler);
        resolve();
      }
      if (update.connection === "close") {
        (sock.ev as any).off?.("connection.update", handler);
        reject(update.lastDisconnect?.error ?? new Error("Connection closed"));
      }
    };
    sock.ev.on("connection.update", handler);
  });
}

// ── Read self identity ──────────────────────────────────────────────
export function readSelfId(authDir: string = DEFAULT_AUTH_DIR): {
  phone: string | null;
  jid: string | null;
} {
  try {
    const raw = fs.readFileSync(credsPath(authDir), "utf-8");
    const parsed = JSON.parse(raw) as { me?: { id?: string } };
    const jid = parsed?.me?.id ?? null;
    const phone = jid ? jid.split("@")[0].split(":")[0] : null;
    return { phone, jid };
  } catch {
    return { phone: null, jid: null };
  }
}

// ── Logout ──────────────────────────────────────────────────────────
export async function logout(authDir: string = DEFAULT_AUTH_DIR): Promise<boolean> {
  const dir = resolveAuthDir(authDir);
  if (!hasCredentials(dir)) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  console.error("[whatsapp] Cleared WhatsApp session.");
  return true;
}
```

---

## 6. Step 2: QR Code Server

**File: `src/qr-server.ts`**

Since Claude Code spawns the MCP server as a subprocess, stderr goes to a debug log file — not your terminal. This file serves a styled QR code page at `http://localhost:8787` so you can scan it in your browser.

### What it does:

- Starts a local HTTP server on port 8787
- Converts Baileys' raw QR data string into a scannable SVG using the `qrcode` library
- Auto-refreshes the page every 3 seconds (QR codes rotate)
- Shows "Connected!" once WhatsApp links, then auto-closes after 10 seconds

### Code:

```typescript
/**
 * Local HTTP server that displays the QR code for WhatsApp linking.
 * Opens at http://localhost:8787 — accessible in your browser.
 * Automatically closes once WhatsApp connects.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import QRCode from "qrcode";

let currentQr: string | null = null;
let currentQrSvg: string | null = null;
let isConnected = false;
let server: http.Server | null = null;

const QR_PORT = parseInt(process.env.WA_QR_PORT ?? "8787", 10);
const QR_FILE = path.join(os.tmpdir(), "claude-whatsapp-qr.txt");

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WhatsApp QR — Claude Code</title>
  <meta http-equiv="refresh" content="3">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #eee;
           display: flex; flex-direction: column; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; }
    .container { text-align: center; max-width: 500px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: #888; margin-bottom: 2rem; font-size: 0.95rem; }
    .qr-box { background: #ffffff; padding: 24px; border-radius: 16px;
              display: inline-block; margin: 1.5rem 0; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
    .qr-box svg { display: block; }
    .connected { color: #4ade80; font-size: 1.5rem; margin: 2rem 0; }
    .instructions { color: #aaa; font-size: 0.9rem; margin-top: 1.5rem; line-height: 1.8;
                    text-align: left; display: inline-block; }
    .instructions strong { color: #ddd; }
    .step { margin-bottom: 0.3rem; }
    .waiting { color: #facc15; margin-top: 1rem; font-size: 0.85rem; }
    .badge { display: inline-block; background: #1a1a2e; border: 1px solid #333;
             border-radius: 8px; padding: 0.5rem 1rem; margin-top: 1rem;
             font-size: 0.8rem; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>WhatsApp Channel</h1>
    <div class="subtitle">Link your WhatsApp to Claude Code</div>
    %%CONTENT%%
    <div class="badge">Claude Code &middot; WhatsApp Channel</div>
  </div>
</body>
</html>`;

async function renderQrHtml(): Promise<string> {
  if (!currentQrSvg) return renderWaitingHtml();
  return HTML_TEMPLATE.replace(
    "%%CONTENT%%",
    [
      `<div class="qr-box">${currentQrSvg}</div>`,
      '<div class="instructions">',
      '<div class="step">1. Open <strong>WhatsApp</strong> on your phone</div>',
      '<div class="step">2. Go to <strong>Settings &rarr; Linked Devices</strong></div>',
      '<div class="step">3. Tap <strong>Link a Device</strong></div>',
      '<div class="step">4. Point your phone at this QR code</div>',
      "</div>",
      '<div class="waiting">Waiting for scan... (page auto-refreshes)</div>',
    ].join("\n"),
  );
}

function renderConnectedHtml(): string {
  return HTML_TEMPLATE.replace(
    "%%CONTENT%%",
    '<div class="connected">&#10003; WhatsApp connected!<br>'
    + '<span style="font-size:0.9rem;color:#888;">You can close this page.</span></div>',
  );
}

function renderWaitingHtml(): string {
  return HTML_TEMPLATE.replace(
    "%%CONTENT%%",
    '<div class="waiting">Generating QR code... (page auto-refreshes every 3s)</div>',
  );
}

export async function updateQr(qr: string): Promise<void> {
  currentQr = qr;
  try {
    currentQrSvg = await QRCode.toString(qr, {
      type: "svg",
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (err) {
    console.error("[qr-server] Failed to generate QR SVG:", String(err));
    currentQrSvg = null;
  }
  try {
    fs.writeFileSync(QR_FILE, qr, "utf-8");
  } catch {}
}

export function markConnected(): void {
  isConnected = true;
  currentQr = null;
  currentQrSvg = null;
  try { fs.unlinkSync(QR_FILE); } catch {}
  setTimeout(() => { server?.close(); server = null; }, 10_000);
}

function createHandler() {
  return async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (isConnected) {
      res.end(renderConnectedHtml());
    } else if (currentQrSvg) {
      res.end(await renderQrHtml());
    } else {
      res.end(renderWaitingHtml());
    }
  };
}

export function startQrServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer(createHandler());
    server.listen(QR_PORT, "127.0.0.1", () => resolve(QR_PORT));
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        server?.close();
        server = http.createServer(createHandler());
        server.listen(QR_PORT + 1, "127.0.0.1", () => resolve(QR_PORT + 1));
      } else {
        reject(err);
      }
    });
  });
}

export function stopQrServer(): void {
  server?.close();
  server = null;
  try { fs.unlinkSync(QR_FILE); } catch {}
}
```

---

## 7. Step 3: Message Monitor

**File: `src/monitor.ts`**

This is the core inbound message handler. It listens for WhatsApp messages via Baileys, normalizes them, and passes them to the channel server.

### What it does:

- **Connects with retry**: If Baileys detects a logged-out session, it clears stale credentials and retries with a fresh QR code (up to 3 attempts)
- **Deduplication**: 20-minute TTL cache (max 5000 entries) prevents processing the same message twice
- **Access control**: Checks sender phone against allowlist. Handles WhatsApp's new LID (Linked Identity) JIDs which don't carry real phone numbers
- **Text extraction**: Pulls text from conversation messages, extended text, and media captions
- **Media placeholders**: Detects images, videos, audio, documents, stickers, contacts, and locations
- **Reply context**: Extracts quoted message text when someone replies to a message
- **Group support**: Fetches group metadata (subject) with 5-minute cache
- **Debug logging**: Writes to `~/.claude/whatsapp-channel/debug.log` for troubleshooting

### Important: LID JIDs

WhatsApp is migrating from phone-based JIDs (`1234567890@s.whatsapp.net`) to LID JIDs (`86200000000000@lid`). LID JIDs don't contain the real phone number, so the allowlist can't match them by phone. The monitor detects LID JIDs and allows them through with a log warning.

### Code:

```typescript
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
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
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
  if (message.documentMessage)
    return `<media:document ${message.documentMessage.fileName ?? ""}>`;
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
  return extractText(ctx.quotedMessage) || undefined;
}

// ── JID type detection ──────────────────────────────────────────────
function isLidJid(jid: string | null | undefined): boolean {
  return Boolean(jid && jid.endsWith("@lid"));
}

// ── Access control ──────────────────────────────────────────────────
function isAllowed(
  phone: string | null,
  allowList: string[],
  remoteJid?: string,
): boolean {
  if (allowList.length === 0) return true;
  if (!phone) return false;
  const normalize = (p: string) => p.replace(/^\+/, "");
  const match = allowList.some((a) => normalize(a) === normalize(phone));
  if (match) return true;

  // LID JIDs don't carry the real phone number — allow through
  if (remoteJid && isLidJid(remoteJid)) {
    debugLog(
      `[allowlist] LID JID detected (${remoteJid}), allowing through — real phone unknown`,
    );
    return true;
  }
  return false;
}

// ── Connect with retry ──────────────────────────────────────────────
const MAX_RETRIES = 3;

async function connectWithRetry(
  options: MonitorOptions,
  attempt = 1,
): Promise<WASocket> {
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
    const statusCode =
      (err as any)?.output?.statusCode ?? (err as any)?.statusCode;
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;

    if (isLoggedOut && attempt < MAX_RETRIES) {
      console.error(
        "[whatsapp] Session logged out. Clearing stale credentials and retrying...",
      );
      const authDir = resolveAuthDir(options.authDir);
      try {
        await fsp.rm(authDir, { recursive: true, force: true });
      } catch {}
      return connectWithRetry(options, attempt + 1);
    }

    if (statusCode === 515 && attempt < MAX_RETRIES) {
      console.error("[whatsapp] Server requested restart. Retrying...");
      try { sock.end(undefined); } catch {}
      return connectWithRetry(options, attempt + 1);
    }

    throw err;
  }
}

// ── Main monitor function ───────────────────────────────────────────
export async function monitorWhatsApp(options: MonitorOptions) {
  const allowFrom = options.allowFrom ?? [];
  const sock = await connectWithRetry(options);
  const connectedAtMs = Date.now();

  try {
    await sock.sendPresenceUpdate("available");
  } catch (err) {
    if (options.verbose)
      console.error("[whatsapp] Failed to send presence:", String(err));
  }

  const selfJid = sock.user?.id;
  const selfPhone = jidToPhone(selfJid);

  // Group metadata cache
  const groupCache = new Map<string, { subject?: string; expires: number }>();
  const GROUP_CACHE_TTL = 5 * 60 * 1000;

  const getGroupSubject = async (jid: string): Promise<string | undefined> => {
    const cached = groupCache.get(jid);
    if (cached && cached.expires > Date.now()) return cached.subject;
    try {
      const meta = await sock.groupMetadata(jid);
      groupCache.set(jid, {
        subject: meta.subject,
        expires: Date.now() + GROUP_CACHE_TTL,
      });
      return meta.subject;
    } catch {
      return undefined;
    }
  };

  // Handle incoming messages
  const handleUpsert = async (upsert: {
    type?: string;
    messages?: WAMessage[];
  }) => {
    debugLog(
      `[upsert] type=${upsert.type} count=${upsert.messages?.length ?? 0}`,
    );
    if (upsert.type !== "notify" && upsert.type !== "append") return;

    for (const msg of upsert.messages ?? []) {
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) continue;
      if (
        remoteJid.endsWith("@status") ||
        remoteJid.endsWith("@broadcast")
      )
        continue;

      const msgId = msg.key?.id;
      if (msgId && isDuplicate(`${remoteJid}:${msgId}`)) continue;

      if (upsert.type === "append") {
        const ts = msg.messageTimestamp
          ? Number(msg.messageTimestamp) * 1000
          : 0;
        if (ts < connectedAtMs - 60_000) continue;
      }

      const isGroup = isJidGroup(remoteJid) === true;
      const participantJid = msg.key?.participant;
      const senderPhone = isGroup
        ? jidToPhone(participantJid)
        : jidToPhone(remoteJid);
      const fromMe = Boolean(msg.key?.fromMe);

      debugLog(
        `[msg] jid=${remoteJid} sender=${senderPhone} fromMe=${fromMe} pushName=${msg.pushName}`,
      );

      if (fromMe) continue;

      if (!isAllowed(senderPhone, allowFrom, remoteJid)) {
        debugLog(
          `[skip] not allowed: ${senderPhone} jid=${remoteJid}`,
        );
        continue;
      }

      let body = extractText(msg.message);
      const mediaPlaceholder = extractMediaPlaceholder(msg.message);
      if (!body && !mediaPlaceholder) continue;
      if (!body) body = mediaPlaceholder;

      const replyToBody = extractReplyContext(msg.message);
      const groupSubject = isGroup
        ? await getGroupSubject(remoteJid)
        : undefined;
      const from = isGroup ? remoteJid : (senderPhone ?? remoteJid);

      // Mark as read
      if (msgId) {
        try {
          await sock.readMessages([
            {
              remoteJid,
              id: msgId,
              participant: participantJid ?? undefined,
              fromMe: false,
            },
          ]);
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
        timestamp: msg.messageTimestamp
          ? Number(msg.messageTimestamp) * 1000
          : undefined,
        groupSubject,
        isFromMe: fromMe,
        replyToBody,
        mediaPlaceholder: mediaPlaceholder || undefined,
      };

      try {
        await options.onMessage(inbound);
      } catch (err) {
        console.error(
          "[whatsapp] Error handling inbound message:",
          String(err),
        );
      }
    }
  };

  sock.ev.on("messages.upsert", handleUpsert);

  // Track disconnection
  let closeResolve: ((reason: CloseReason) => void) | null = null;
  const onClose = new Promise<CloseReason>((resolve) => {
    closeResolve = resolve;
  });

  sock.ev.on(
    "connection.update",
    (update: Partial<ConnectionState>) => {
      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as any)?.output
          ?.statusCode;
        const reason: CloseReason = {
          statusCode,
          isLoggedOut: statusCode === DisconnectReason.loggedOut,
          error: update.lastDisconnect?.error,
        };
        closeResolve?.(reason);
        options.onClose?.(reason);
      }
    },
  );

  return {
    sock,
    selfJid,
    selfPhone,
    onClose,
    sendMessage: async (to: string, text: string) => {
      const jid = to.includes("@")
        ? to
        : `${to.replace(/^\+/, "")}@s.whatsapp.net`;
      await sock.sendPresenceUpdate("composing", jid);
      const result = await sock.sendMessage(jid, { text });
      return { messageId: result?.key?.id ?? "unknown" };
    },
    sendReaction: async (
      chatJid: string,
      messageId: string,
      emoji: string,
    ) => {
      await sock.sendMessage(chatJid, {
        react: {
          text: emoji,
          key: { remoteJid: chatJid, id: messageId, fromMe: false },
        },
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
```

---

## 8. Step 4: MCP Channel Server

**File: `src/index.ts`**

This is the entry point. It creates the MCP channel server, registers tools, wires everything together, and communicates with Claude Code over stdio.

### What it does:

1. **Creates the MCP server** with `claude/channel` (notification listener), `claude/channel/permission` (permission relay), and `tools` (reply/react) capabilities
2. **Registers two tools**:
   - `whatsapp_reply` — sends a text message back to a WhatsApp chat
   - `whatsapp_react` — reacts to a message with an emoji
3. **Handles permission relay** — when Claude needs tool approval, forwards the prompt to WhatsApp and intercepts `yes/no <code>` replies
4. **Starts the QR server** and notifies Claude if login is needed
5. **Starts the WhatsApp monitor** and forwards inbound messages as `<channel>` notifications

### The `instructions` field

This is critical — it's added to Claude's system prompt so Claude knows:
- What format messages arrive in (`<channel source="whatsapp" ...>`)
- What attributes are available (`chat_id`, `sender_phone`, `sender_name`, `chat_type`)
- Which tool to use for replies (`whatsapp_reply`)
- How to format text for WhatsApp (`*bold*`, `_italic_`)

### Code:

```typescript
#!/usr/bin/env bun
/**
 * WhatsApp Channel for Claude Code
 *
 * An MCP channel server that bridges WhatsApp messages into a Claude Code session.
 * Uses Baileys (WhatsApp Web) for authentication via QR code — no Business API needed.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { monitorWhatsApp, type InboundMessage } from "./monitor.js";
import { hasCredentials, resolveAuthDir, readSelfId } from "./session.js";
import {
  startQrServer,
  updateQr,
  markConnected,
  stopQrServer,
} from "./qr-server.js";

// ── Configuration from environment ──────────────────────────────────
const AUTH_DIR = process.env.WA_AUTH_DIR ?? undefined;
const ALLOW_FROM = process.env.WA_ALLOW_FROM
  ? process.env.WA_ALLOW_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const VERBOSE =
  process.env.WA_VERBOSE === "1" || process.env.WA_VERBOSE === "true";

// ── MCP Channel Server ─────────────────────────────────────────────
const mcp = new Server(
  { name: "whatsapp", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},             // registers as a channel
        "claude/channel/permission": {},  // opt in to permission relay
      },
      tools: {},                          // two-way: Claude can reply
    },
    instructions: [
      'WhatsApp messages arrive as <channel source="whatsapp" chat_id="..."',
      'sender_phone="..." sender_name="..." chat_type="direct|group">.',
      "Each message includes the sender's phone number and name when available.",
      'Reply using the "whatsapp_reply" tool, passing the chat_id from the tag.',
      "For group messages, the group subject is included when available.",
      "If a message is a reply to a previous message, reply_to_body contains",
      "the quoted text.",
      "Media messages show placeholders like <media:image>, <media:video>, etc.",
      "Be conversational and helpful. Format replies for WhatsApp",
      "(no markdown links, use *bold* and _italic_).",
    ].join(" "),
  },
);

// ── Reply Tool ──────────────────────────────────────────────────────
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "whatsapp_reply",
      description:
        "Send a reply message back to a WhatsApp chat. Use chat_id from the inbound <channel> tag.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description:
              "The WhatsApp chat JID to reply to (from the channel tag's chat_id attribute)",
          },
          text: {
            type: "string",
            description:
              "The message text to send. Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```code```",
          },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "whatsapp_react",
      description: "React to a WhatsApp message with an emoji.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string", description: "The WhatsApp chat JID" },
          message_id: {
            type: "string",
            description: "The message ID to react to",
          },
          emoji: {
            type: "string",
            description: "The emoji to react with",
          },
        },
        required: ["chat_id", "message_id", "emoji"],
      },
    },
  ],
}));

// Store the monitor instance so tools can send messages
let waMonitor: Awaited<ReturnType<typeof monitorWhatsApp>> | null = null;

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "whatsapp_reply") {
    const { chat_id, text } = req.params.arguments as {
      chat_id: string;
      text: string;
    };
    if (!waMonitor)
      return { content: [{ type: "text", text: "WhatsApp not connected" }] };
    try {
      const result = await waMonitor.sendMessage(chat_id, text);
      return {
        content: [{ type: "text", text: `Sent (id: ${result.messageId})` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to send: ${String(err)}` }],
      };
    }
  }

  if (req.params.name === "whatsapp_react") {
    const { chat_id, message_id, emoji } = req.params.arguments as {
      chat_id: string;
      message_id: string;
      emoji: string;
    };
    if (!waMonitor)
      return { content: [{ type: "text", text: "WhatsApp not connected" }] };
    try {
      await waMonitor.sendReaction(chat_id, message_id, emoji);
      return { content: [{ type: "text", text: `Reacted with ${emoji}` }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to react: ${String(err)}` }],
      };
    }
  }

  throw new Error(`Unknown tool: ${req.params.name}`);
});

// ── Permission Relay ────────────────────────────────────────────────
const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  if (!waMonitor || !permissionReplyTarget) return;
  const prompt = [
    `*Claude wants to run ${params.tool_name}:*`,
    params.description,
    "",
    `Reply *yes ${params.request_id}* or *no ${params.request_id}*`,
  ].join("\n");
  try {
    await waMonitor.sendMessage(permissionReplyTarget, prompt);
  } catch (err) {
    console.error("[whatsapp] Failed to send permission prompt:", String(err));
  }
});

let permissionReplyTarget: string | null = null;

// ── Permission verdict regex ────────────────────────────────────────
// [a-km-z] = Claude Code's ID alphabet (lowercase, no 'l')
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

// ── Inbound message handler ─────────────────────────────────────────
async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  if (msg.chatType === "direct") {
    permissionReplyTarget = msg.chatId;
  }

  // Check if this is a permission verdict
  const verdictMatch = PERMISSION_REPLY_RE.exec(msg.body);
  if (verdictMatch) {
    await mcp.notification({
      method: "notifications/claude/channel/permission" as any,
      params: {
        request_id: verdictMatch[2].toLowerCase(),
        behavior: verdictMatch[1].toLowerCase().startsWith("y")
          ? "allow"
          : "deny",
      },
    });
    return;
  }

  // Build meta attributes for the <channel> tag
  const meta: Record<string, string> = {
    chat_id: msg.chatId,
    chat_type: msg.chatType,
  };
  if (msg.senderPhone) meta.sender_phone = msg.senderPhone;
  if (msg.senderName) meta.sender_name = msg.senderName;
  if (msg.id) meta.message_id = msg.id;
  if (msg.groupSubject) meta.group_subject = msg.groupSubject;
  if (msg.replyToBody) meta.reply_to_body = msg.replyToBody;
  if (msg.timestamp) meta.timestamp = String(msg.timestamp);

  let content = msg.body;
  if (msg.mediaPlaceholder && msg.body !== msg.mediaPlaceholder) {
    content = `${msg.mediaPlaceholder}\n${msg.body}`;
  }

  await mcp.notification({
    method: "notifications/claude/channel",
    params: { content, meta },
  });
}

// ── Start everything ────────────────────────────────────────────────
async function main() {
  await mcp.connect(new StdioServerTransport());

  console.error("[whatsapp-channel] MCP server connected to Claude Code.");
  console.error(`[whatsapp-channel] Auth dir: ${resolveAuthDir(AUTH_DIR)}`);

  const authDir = resolveAuthDir(AUTH_DIR);
  const needsQr = !hasCredentials(authDir);

  // Start QR web server
  let qrPort: number | null = null;
  try {
    qrPort = await startQrServer();
    console.error(
      `[whatsapp-channel] QR login page: http://localhost:${qrPort}`,
    );
  } catch (err) {
    console.error("[whatsapp-channel] QR server failed:", String(err));
  }

  // Notify Claude if login is needed
  if (needsQr && qrPort) {
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: `WhatsApp needs to be linked. Open http://localhost:${qrPort} in your browser to scan the QR code with your phone (WhatsApp > Settings > Linked Devices > Link a Device).`,
        meta: { type: "system", action: "qr_login_required" },
      },
    });
  }

  // Start WhatsApp monitor
  try {
    waMonitor = await monitorWhatsApp({
      authDir: AUTH_DIR,
      verbose: VERBOSE,
      allowFrom: ALLOW_FROM,
      onMessage: handleInboundMessage,
      onQr: (qr) => {
        updateQr(qr).catch(() => {});
        console.error(
          "[whatsapp-channel] New QR code generated. Scan at http://localhost:" +
            (qrPort ?? 8787),
        );
      },
      onConnected: () => {
        markConnected();
        console.error("[whatsapp-channel] WhatsApp connected!");
        mcp
          .notification({
            method: "notifications/claude/channel",
            params: {
              content:
                "WhatsApp connected successfully! Now listening for messages.",
              meta: { type: "system", action: "connected" },
            },
          })
          .catch(() => {});
      },
      onClose: (reason) => {
        console.error(
          "[whatsapp-channel] Connection closed:",
          JSON.stringify(reason),
        );
        stopQrServer();
      },
    });

    console.error("[whatsapp-channel] WhatsApp monitor active.");

    // Wait for disconnection
    const closeReason = await waMonitor.onClose;
    console.error("[whatsapp-channel] Stopped:", JSON.stringify(closeReason));
    process.exit(1);
  } catch (err) {
    console.error("[whatsapp-channel] Failed to start:", String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[whatsapp-channel] Fatal:", String(err));
  process.exit(1);
});
```

---

## 9. Step 5: Type Declarations

**File: `src/types.d.ts`**

Type declarations for libraries that don't ship their own types.

```typescript
declare module "qrcode-terminal" {
  export function generate(
    text: string,
    options?: { small?: boolean },
    callback?: (output: string) => void,
  ): void;
}

declare module "qrcode" {
  export function toString(
    text: string,
    options?: {
      type?: "svg" | "utf8" | "terminal";
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
  export function toDataURL(
    text: string,
    options?: {
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
}
```

---

## 10. Step 6: Configuration

**File: `.mcp.json`**

This tells Claude Code how to start the WhatsApp channel server.

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["tsx", "./src/index.ts"],
      "env": {
        "WA_ALLOW_FROM": "+1234567890, +0987654321",
        "WA_VERBOSE": "1"
      }
    }
  }
}
```

### Where to place it:

- **Project-level** (`.mcp.json` in your project root) — channel available for that project only
- **User-level** (`~/.claude.json`) — channel available globally, use full absolute paths in `args`

### For user-level config:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["tsx", "/full/path/to/whatsapp-channel/src/index.ts"],
      "env": {
        "WA_ALLOW_FROM": "+1234567890",
        "WA_VERBOSE": "0"
      }
    }
  }
}
```

---

## 11. Running the Channel

### First time (QR code login):

```bash
# 1. Install dependencies
cd whatsapp-channel
npm install

# 2. Start Claude Code with the channel
claude --dangerously-load-development-channels server:whatsapp

# 3. Open http://localhost:8787 in your browser

# 4. Scan the QR code with WhatsApp > Settings > Linked Devices > Link a Device

# 5. Send a message from another phone to the linked WhatsApp number
```

### Subsequent runs (session persists):

```bash
claude --dangerously-load-development-channels server:whatsapp
# No QR needed — credentials are cached at ~/.claude/whatsapp-channel/auth/
```

### What Claude sees:

When a WhatsApp message arrives, Claude receives:

```xml
<channel source="whatsapp" chat_id="1234567890@s.whatsapp.net" sender_phone="+1234567890" sender_name="John" chat_type="direct" message_id="ABC123">
Hello Claude, can you help me with something?
</channel>
```

Claude reads this and can reply using the `whatsapp_reply` tool.

---

## 12. How It Works End-to-End

### Inbound flow (WhatsApp -> Claude):

1. Someone sends a WhatsApp message to the linked phone number
2. Baileys receives it over its WebSocket connection to WhatsApp servers
3. `monitor.ts` fires `messages.upsert` event
4. The message is:
   - Checked for duplicates (20-min TTL cache)
   - Filtered (skip status, broadcast, fromMe, old catch-up messages)
   - Checked against the sender allowlist (with LID JID fallback)
   - Text and media content extracted
5. `index.ts` receives the normalized `InboundMessage`
6. Checks if it's a permission verdict (matches `yes/no <5-letter-code>`)
7. If not, builds a `<channel>` notification with meta attributes and pushes to Claude Code via `mcp.notification()`
8. Claude reads the `<channel>` tag and responds

### Outbound flow (Claude -> WhatsApp):

1. Claude decides to reply and calls the `whatsapp_reply` tool with `chat_id` and `text`
2. `index.ts` receives the tool call via `CallToolRequestSchema` handler
3. Calls `waMonitor.sendMessage(chat_id, text)`
4. `monitor.ts` resolves the JID, sends a "composing" presence update, then calls `sock.sendMessage(jid, { text })`
5. Baileys sends the message to WhatsApp servers
6. The recipient sees the reply on their phone

---

## 13. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WA_ALLOW_FROM` | Comma-separated E.164 phone numbers to allow | `""` (allow all) |
| `WA_AUTH_DIR` | Custom auth directory path | `~/.claude/whatsapp-channel/auth/` |
| `WA_VERBOSE` | Enable verbose logging (`1` or `true`) | `0` |
| `WA_QR_PORT` | Port for the QR code web server | `8787` |

---

## 14. Permission Relay

When Claude needs to run a tool that requires your approval (like `Bash` or `Write`), the permission prompt is forwarded to WhatsApp:

```
*Claude wants to run Bash:*
List files in the current directory

Reply *yes abcde* or *no abcde*
```

### How to respond:

- Reply `yes abcde` (or `y abcde`) to approve
- Reply `no abcde` (or `n abcde`) to deny
- The 5-letter code must match exactly

### How it works internally:

1. Claude Code generates a `permission_request` notification with a 5-letter request ID
2. `index.ts` receives it via `PermissionRequestSchema` notification handler
3. Sends the formatted prompt to the most recent DM sender via WhatsApp
4. When the user replies, the inbound handler checks against `PERMISSION_REPLY_RE` regex
5. If it matches, emits a `notifications/claude/channel/permission` verdict back to Claude Code
6. Claude Code applies the verdict (allow or deny) and closes the terminal dialog

Both the local terminal and WhatsApp stay live — whichever answer arrives first is used.

---

## 15. Troubleshooting

### QR code not showing at http://localhost:8787

- Check if the server is running: `lsof -i :8787`
- If "address in use", kill the old process: `kill $(lsof -t -i :8787)`
- Check if a different port was assigned (logged to stderr)
- Try `http://localhost:8788` (fallback port)

### Messages not arriving in Claude

Check the debug log:

```bash
cat ~/.claude/whatsapp-channel/debug.log | tail -20
```

Common issues:

| Log message | Cause | Fix |
|------------|-------|-----|
| `[skip] fromMe` | You're sending from the linked phone | Send from a different phone |
| `[skip] not allowed: +123...` | Sender not in allowlist | Add their number to `WA_ALLOW_FROM` |
| `[skip] duplicate` | Message already processed | Normal — deduplication working |
| `[skip] old append message` | History catch-up message | Normal — only processes new messages |
| `[allowlist] LID JID detected` | WhatsApp LID migration | Normal — allowed through automatically |

### Session logged out / Connection Failure

```bash
# Clear stale credentials
rm -rf ~/.claude/whatsapp-channel/auth/

# Restart Claude Code — will prompt for new QR scan
```

### "blocked by org policy"

Your Team or Enterprise admin needs to enable channels in Claude Code settings.

### Two WhatsApp processes competing

Check for competing processes:

```bash
ps aux | grep whatsapp | grep -v grep
```

Kill any old ones:

```bash
kill <PID>
```

---

## 16. Known Issues & Limitations

| Issue | Details |
|-------|---------|
| **LID JIDs** | WhatsApp is migrating to Linked Identity JIDs which don't contain real phone numbers. The allowlist can't match these by phone — they're allowed through automatically. |
| **No media download** | Media files (images, videos, etc.) are detected but not downloaded. Claude sees placeholders like `<media:image>`. |
| **Phone must be online** | WhatsApp Web requires your phone to have internet access (WhatsApp's requirement). |
| **Unofficial protocol** | Uses Baileys (WhatsApp Web reverse-engineering) — not endorsed by Meta. Your account could theoretically be banned. |
| **Research preview** | Custom channels need `--dangerously-load-development-channels` flag during Claude Code's research preview. |
| **Single session** | Only one Baileys connection per WhatsApp account. Running multiple instances will cause conflicts. |
| **QR code expires** | QR codes rotate every ~20 seconds. The browser page auto-refreshes to show the latest. |
