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
