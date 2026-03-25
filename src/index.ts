#!/usr/bin/env bun
/**
 * WhatsApp Channel for Claude Code
 *
 * An MCP channel server that bridges WhatsApp messages into a Claude Code session.
 * Uses Baileys (WhatsApp Web) for authentication via QR code — no Business API needed.
 *
 * Features:
 * - Two-way messaging: receive WhatsApp messages, Claude replies back
 * - QR code authentication (scan with your phone)
 * - Sender allowlist for security
 * - Permission relay (approve/deny Claude's tool use from WhatsApp)
 * - Group chat support
 * - Media placeholders
 * - Message deduplication
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exec } from "node:child_process";
import { monitorWhatsApp, type InboundMessage } from "./monitor.js";
import { hasCredentials, resolveAuthDir, readSelfId } from "./session.js";
import { startQrServer, updateQr, markConnected, stopQrServer } from "./qr-server.js";

// ── Configuration from environment ──────────────────────────────────
const AUTH_DIR = process.env.WA_AUTH_DIR ?? undefined;
const ALLOW_FROM = process.env.WA_ALLOW_FROM
  ? process.env.WA_ALLOW_FROM.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const VERBOSE = process.env.WA_VERBOSE === "1" || process.env.WA_VERBOSE === "true";

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
      'WhatsApp messages arrive as <channel source="whatsapp" chat_id="..." sender_phone="..." sender_name="..." chat_type="direct|group">.',
      "Each message includes the sender's phone number and name when available.",
      'Reply using the "whatsapp_reply" tool, passing the chat_id from the tag.',
      "For group messages, the group subject is included when available.",
      "If a message is a reply to a previous message, reply_to_body contains the quoted text.",
      "Media messages show placeholders like <media:image>, <media:video>, etc.",
      "Be conversational and helpful. Format replies for WhatsApp (no markdown links, use *bold* and _italic_).",
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
            description: "The WhatsApp chat JID to reply to (from the channel tag's chat_id attribute)",
          },
          text: {
            type: "string",
            description: "The message text to send. Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```code```",
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
          chat_id: {
            type: "string",
            description: "The WhatsApp chat JID",
          },
          message_id: {
            type: "string",
            description: "The message ID to react to",
          },
          emoji: {
            type: "string",
            description: "The emoji to react with (e.g., '👍', '❤️', '😂')",
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
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string };
    if (!waMonitor) {
      return { content: [{ type: "text", text: "WhatsApp not connected" }] };
    }
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
    if (!waMonitor) {
      return { content: [{ type: "text", text: "WhatsApp not connected" }] };
    }
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
// When Claude wants to run a tool that needs approval, forward the prompt to WhatsApp
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

  pendingPermissionId = params.request_id;
  const prompt = `Allow *${params.tool_name}*? Reply *yes ${params.request_id}* or *no ${params.request_id}*`;

  try {
    await waMonitor.sendMessage(permissionReplyTarget, prompt);
  } catch (err) {
    console.error("[whatsapp] Failed to send permission prompt:", String(err));
  }
});

// Track which chat to send permission prompts to (most recent DM sender)
let permissionReplyTarget: string | null = null;

// Track the most recent pending permission request ID
let pendingPermissionId: string | null = null;

// ── Permission verdict regex ────────────────────────────────────────
// Matches: "y", "yes", "n", "no" (with optional request ID)
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s*([a-km-z]{5})?\s*$/i;

// ── Inbound message handler ─────────────────────────────────────────
async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  // Track the most recent DM sender for permission relay
  if (msg.chatType === "direct") {
    permissionReplyTarget = msg.chatId;
  }

  // Check if this is a permission verdict
  const verdictMatch = PERMISSION_REPLY_RE.exec(msg.body);
  if (verdictMatch) {
    const requestId = verdictMatch[2]?.toLowerCase() ?? pendingPermissionId;
    if (requestId) {
      pendingPermissionId = null;
      await mcp.notification({
        method: "notifications/claude/channel/permission" as any,
        params: {
          request_id: requestId,
          behavior: verdictMatch[1].toLowerCase().startsWith("y") ? "allow" : "deny",
        },
      });
      return; // Don't forward verdict as chat
    }
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

  // Build content
  let content = msg.body;
  if (msg.mediaPlaceholder && msg.body !== msg.mediaPlaceholder) {
    content = `${msg.mediaPlaceholder}\n${msg.body}`;
  }

  // Push to Claude Code session
  await mcp.notification({
    method: "notifications/claude/channel",
    params: { content, meta },
  });
}

// ── Start everything ────────────────────────────────────────────────
async function main() {
  // Connect MCP to Claude Code over stdio
  await mcp.connect(new StdioServerTransport());

  console.error("[whatsapp-channel] MCP server connected to Claude Code.");
  console.error(`[whatsapp-channel] Auth dir: ${resolveAuthDir(AUTH_DIR)}`);
  if (ALLOW_FROM.length > 0) {
    console.error(`[whatsapp-channel] Allowlist: ${ALLOW_FROM.join(", ")}`);
  } else {
    console.error("[whatsapp-channel] No allowlist set — accepting messages from anyone.");
    console.error("[whatsapp-channel] Set WA_ALLOW_FROM=+1234567890,+0987654321 to restrict.");
  }

  // Check for existing credentials
  const authDir = resolveAuthDir(AUTH_DIR);
  const needsQr = !hasCredentials(authDir);

  if (!needsQr) {
    const self = readSelfId(authDir);
    console.error(`[whatsapp-channel] Existing session found: ${self.phone ?? "unknown"}`);
  } else {
    console.error("[whatsapp-channel] No existing session. Starting QR server...");
  }

  // Start QR web server so user can scan from browser
  let qrPort: number | null = null;
  try {
    qrPort = await startQrServer();
    console.error(`[whatsapp-channel] QR login page: http://127.0.0.1:${qrPort}`);
  } catch (err) {
    console.error("[whatsapp-channel] QR server failed to start:", String(err));
  }

  // Auto-open browser and notify Claude if login is needed
  if (needsQr && qrPort) {
    // Open browser automatically (cross-platform)
    const url = `http://127.0.0.1:${qrPort}`;
    const openCmd = process.platform === "win32" ? `start "" "${url}"`
      : process.platform === "darwin" ? `open "${url}"`
      : `xdg-open "${url}"`;
    exec(openCmd, (err) => {
      if (err) console.error("[whatsapp-channel] Failed to open browser:", String(err));
    });

    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: `WhatsApp needs to be linked. A browser window has been opened at ${url}. Scan the QR code with your phone (WhatsApp > Settings > Linked Devices > Link a Device).`,
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
        console.error("[whatsapp-channel] New QR code generated. Scan at http://127.0.0.1:" + (qrPort ?? 8787));
      },
      onConnected: () => {
        markConnected();
        console.error("[whatsapp-channel] WhatsApp connected!");
        // Notify Claude
        mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content: "WhatsApp connected successfully! Now listening for messages.",
            meta: { type: "system", action: "connected" },
          },
        }).catch(() => {});
      },
      onClose: (reason) => {
        console.error("[whatsapp-channel] Connection closed:", JSON.stringify(reason));
        stopQrServer();
        if (reason.isLoggedOut) {
          console.error("[whatsapp-channel] Logged out. Restart to re-authenticate.");
        }
      },
    });

    console.error("[whatsapp-channel] WhatsApp monitor active. Listening for messages...");
    if (waMonitor.selfPhone) {
      console.error(`[whatsapp-channel] Linked to: ${waMonitor.selfPhone}`);
    }

    // Wait for disconnection
    const closeReason = await waMonitor.onClose;
    console.error("[whatsapp-channel] Monitor stopped:", JSON.stringify(closeReason));

    // If logged out, don't auto-reconnect
    if (closeReason.isLoggedOut) {
      process.exit(1);
    }

    // For other disconnects (network issues, etc.), exit so Claude Code can restart
    process.exit(1);
  } catch (err) {
    console.error("[whatsapp-channel] Failed to start:", String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[whatsapp-channel] Fatal error:", String(err));
  process.exit(1);
});
