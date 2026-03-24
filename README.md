# WhatsApp Channel for Claude Code

A two-way WhatsApp channel for Claude Code sessions, built on [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web). Send messages to Claude from WhatsApp, and Claude replies back.

## Features

- **QR Code Login** — scan with your phone to link (no Business API needed)
- **Two-way messaging** — receive messages in Claude, Claude replies via WhatsApp
- **Permission relay** — approve/deny Claude's tool use from WhatsApp
- **Sender allowlist** — restrict who can message your Claude session
- **Group chat support** — works in group chats with group metadata
- **Reactions** — Claude can react to messages with emoji
- **Deduplication** — prevents duplicate message processing
- **Auto-reconnect** — Claude Code restarts the server on disconnect

## Requirements

- [Bun](https://bun.sh) runtime (or Node.js 22+)
- Claude Code v2.1.80+ with channels enabled
- A WhatsApp account on your phone

## Quick Start

### 1. Install dependencies

```bash
cd whatsapp-channel
bun install
```

### 2. Configure Claude Code

Copy the `.mcp.json` to your project or add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "bun",
      "args": ["/full/path/to/whatsapp-channel/src/index.ts"],
      "env": {
        "WA_ALLOW_FROM": "+1234567890,+0987654321",
        "WA_VERBOSE": "0"
      }
    }
  }
}
```

### 3. Start Claude Code with the channel

```bash
claude --dangerously-load-development-channels server:whatsapp
```

### 4. Scan the QR code

A QR code will appear in the terminal. Open WhatsApp on your phone:
1. Go to **Settings > Linked Devices**
2. Tap **Link a Device**
3. Scan the QR code

Once linked, your session persists across restarts (credentials stored in `~/.claude/whatsapp-channel/auth/`).

### 5. Send a message

Message the linked WhatsApp number from another phone, or from a group. The message arrives in your Claude Code session as:

```
<channel source="whatsapp" chat_id="1234567890@s.whatsapp.net" sender_phone="+1234567890" sender_name="John" chat_type="direct">
Hello Claude, can you help me with something?
</channel>
```

Claude reads it, acts on it, and replies back through WhatsApp.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WA_ALLOW_FROM` | Comma-separated E.164 phone numbers to allow | `""` (allow all) |
| `WA_AUTH_DIR` | Custom auth directory path | `~/.claude/whatsapp-channel/auth/` |
| `WA_VERBOSE` | Enable verbose logging (`1` or `true`) | `0` |

### Sender Allowlist

**Important for security**: without an allowlist, anyone who messages your linked WhatsApp number can interact with your Claude session.

```json
"env": {
  "WA_ALLOW_FROM": "+1234567890,+0987654321"
}
```

## Permission Relay

When Claude needs to run a tool that requires approval, the permission prompt is forwarded to WhatsApp:

```
🔧 *Claude wants to run Bash:*
List files in the current directory

Reply *yes abcde* or *no abcde*
```

Reply with `yes <code>` or `no <code>` to approve or deny. You can also answer in the Claude Code terminal — whichever comes first is used.

## Architecture

```
WhatsApp (phone)
    │
    ▼
Baileys WebSocket ──── WhatsApp Web servers
    │
    ▼
monitor.ts (inbound message handler)
    │
    ▼
index.ts (MCP channel server) ──── stdio ──── Claude Code
    │                                              │
    └── reply tool ◄───────────────────────────────┘
```

- **session.ts** — Baileys socket creation, QR auth, credential management
- **monitor.ts** — Inbound message listener, deduplication, access control
- **index.ts** — MCP server with channel capability, reply tool, permission relay

## Troubleshooting

### QR code doesn't appear
- Make sure no other WhatsApp Web session is active for this account
- Delete `~/.claude/whatsapp-channel/auth/` and restart

### Messages not arriving
- Check `WA_ALLOW_FROM` — is the sender's number listed?
- Run with `WA_VERBOSE=1` to see blocked messages
- Verify Claude Code started with `--dangerously-load-development-channels`

### Session expired
- WhatsApp Web sessions can expire if your phone is offline too long
- Delete the auth directory and scan a new QR code

### "blocked by org policy"
- Your Team or Enterprise admin needs to enable channels in the Claude Code settings

## Limitations

- Media files are detected but not downloaded (shown as placeholders like `<media:image>`)
- WhatsApp Web requires your phone to have internet access
- Uses the unofficial WhatsApp Web protocol (Baileys) — not endorsed by Meta
- Custom channels need `--dangerously-load-development-channels` during the research preview

## License

MIT
