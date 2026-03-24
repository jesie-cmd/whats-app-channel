# WhatsApp Channel for Claude Code — Setup Guide

> Keep this page open on your screen throughout the setup. Everything you need is right here.

You are setting up a WhatsApp channel that connects your phone to Claude Code. Send a message on WhatsApp, and Claude reads it and replies — all running on YOUR computer.

---

## What You Are Building

| What | Description |
| --- | --- |
| **WhatsApp Channel** | Bridges WhatsApp messages into your Claude Code session |
| **Two-Way Chat** | Send messages from WhatsApp, Claude replies back |
| **Permission Relay** | Approve or deny Claude's actions from your phone |
| **Sender Allowlist** | Control who can message Claude through your WhatsApp |
| **QR Code Login** | Scan once with your phone, session persists automatically |

---

## Before You Start — Requirements

### A) Claude Code Must Be Working

You need Claude Code installed and signed in. If you don't have it yet:

1. Open VS Code
2. Click the **Extensions** icon (4 small squares) — or press **Cmd+Shift+X** (Mac) / **Ctrl+Shift+X** (Windows)
3. Search for **Claude Code** by **Anthropic** and click **Install**
4. Click the Claude icon in the sidebar and **sign in**

Done when: You can type a message to Claude in VS Code and get a response.

### B) Install Node.js

**Mac:**

1. Go to [nodejs.org](https://nodejs.org)
2. Click **"Download"** (the LTS version)
3. Open the downloaded `.pkg` file and follow the installer
4. Restart VS Code after installing

**Windows:**

1. Go to [nodejs.org](https://nodejs.org)
2. Click **"Download"** (the LTS version)
3. Run the `.msi` installer — click **Next** through all screens
4. Make sure **"Add to PATH"** is ticked
5. Click **Install**, then **Finish**
6. Restart VS Code after installing

Done when: Open a terminal in VS Code (**Ctrl+`**) and type `node --version` — you should see `v20` or higher.

### C) Install Git (Windows Only)

> Mac users: skip this. Git installs automatically on Mac when needed.

1. Go to [git-scm.com/download/win](https://git-scm.com/download/win)
2. Download should start automatically
3. Run the installer — click **Next** through every screen (defaults are fine)
4. Click **Install**, then **Finish**

**Fix the PATH (important):**

1. Press the **Windows key**
2. Type: **Environment Variables**
3. Click **"Edit the system environment variables"**
4. Click **"Environment Variables"** at the bottom
5. In System variables, find **Path**, click it, click **Edit**
6. Click **New**, type: `C:\Program Files\Git\cmd`
7. Click **OK**, **OK**, **OK**
8. **Close and reopen VS Code completely**

Done when: Type `git --version` in the VS Code terminal and see a version number.

---

## Setting Up the WhatsApp Channel

### Step 1 — Open Claude Code

1. Open VS Code
2. Click the **Claude icon** in the left sidebar
3. You should see the Claude chat panel

### Step 2 — Paste the Setup Prompt

**Copy everything in the box below** and paste it into the Claude chat. Press **Enter** and follow what Claude tells you.

```
I want to set up the WhatsApp Channel for Claude Code so I can chat with Claude from my phone.

Do these steps one at a time, telling me what you are doing in plain English.
Use the correct commands for my operating system (detect whether I am on Mac or Windows).

1. Check if I have the right tools installed:
   - Node.js version 20 or higher (run: node --version)
   - npm (run: npm --version)
   - git (run: git --version)

   If anything is missing, tell me exactly what to install and wait
   for me to confirm before continuing.

2. Download the WhatsApp Channel by running:

   git clone https://github.com/jesie-cmd/whats-app-channel.git ~/whatsapp-channel

   Tell me: "I'm downloading the WhatsApp channel code from GitHub.
   This should only take a few seconds."

   NOTE: On Mac, if a popup appears asking to install developer tools,
   tell me to click "Install" and wait a few minutes before continuing.
   Then run the git clone command again.

   On Windows, use:
   git clone https://github.com/jesie-cmd/whats-app-channel.git %USERPROFILE%\whatsapp-channel

3. Install all the required packages by running "npm install" inside
   the whatsapp-channel folder.

   Tell me: "I'm downloading the packages this needs. This might take
   a minute or two — that's normal."

   If it fails, help me fix it before continuing.

4. Now let's set up security. Open the file ".mcp.json" inside the
   whatsapp-channel folder.

   Explain to me in plain English:
   - "There's a security setting that controls who can message Claude
     through your WhatsApp. Right now it's open to everyone."
   - Ask me: "Do you want to restrict who can message Claude through
     WhatsApp? If yes, tell me the phone number(s) with country code
     (like +1 for US, +44 for UK, +63 for Philippines)."
   - If I give you numbers, put them in WA_ALLOW_FROM separated by commas.
   - If I say no or skip, leave it empty.

5. Now tell me we are ready to connect WhatsApp. Explain in plain English:

   "Everything is installed! Now we need to link your WhatsApp to Claude.
   Here's what will happen:

   a) We'll start Claude Code with the WhatsApp channel
   b) A webpage will automatically open in your browser showing a QR code
   c) On your phone, open WhatsApp
   d) Go to Settings (tap the three dots or gear icon)
   e) Tap 'Linked Devices'
   f) Tap 'Link a Device'
   g) Point your phone camera at the QR code on your screen
   h) Once it scans, WhatsApp is connected to Claude!"

   Tell me to open the VS Code terminal (Ctrl+` or menu: Terminal → New Terminal)
   and run this command:

   Mac/Linux:
     cd ~/whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp

   Windows:
     cd %USERPROFILE%\whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp

   Tell me: "The flag in that command sounds scary but it's completely
   normal — it just means this channel isn't in the official store yet.
   It's safe because it runs entirely on your computer."

   If the QR code page does NOT open automatically, tell me to open
   my browser and go to: http://localhost:8787

6. After I confirm WhatsApp is connected, tell me:

   "You're all set! Here's what you need to know:

   TO START (every time):
   - Open VS Code
   - Open the terminal (Ctrl+` or menu: Terminal → New Terminal)
   - Run:
     Mac/Linux: cd ~/whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp
     Windows: cd %USERPROFILE%\whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp

   GOOD NEWS:
   - You only need to scan the QR code once. Next time it connects
     automatically.

   TRY IT NOW:
   Send a message from another phone to your WhatsApp number
   and see if Claude responds!"

Talk to me like I am not technical. Plain English, one step at a time.
Wait for me to confirm each step before moving to the next.
If something goes wrong, help me fix it before continuing.
```

**What happens next:** Claude will download the channel, install packages, ask about security, and walk you through connecting WhatsApp. This takes about 5 minutes.

---

## After Setup — How to Use It

### Starting the Channel

Every time you want Claude to listen on WhatsApp:

1. Open **VS Code**
2. Open the terminal: press **Ctrl+`** or go to **Terminal → New Terminal**
3. Run:

**Mac/Linux:**
```
cd ~/whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp
```

**Windows:**
```
cd %USERPROFILE%\whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp
```

That's it. Claude is now listening on your WhatsApp.

### What You Can Do

| Action | How |
| --- | --- |
| **Message Claude** | Send a WhatsApp message from another phone to your linked number |
| **Get replies** | Claude reads your message and replies back through WhatsApp |
| **Approve actions** | When Claude needs permission, it sends you a yes/no prompt on WhatsApp |
| **Group chats** | Add the linked number to a group — Claude can participate |

---

## Changing Settings

### Who Can Message Claude

Edit the file `.mcp.json` inside your `whatsapp-channel` folder:

```json
"WA_ALLOW_FROM": "+1234567890, +0987654321"
```

- **Empty** (`""`) = anyone can message Claude
- **Phone numbers** = only those numbers can message Claude
- Use country codes (e.g. `+1` for US, `+44` for UK, `+63` for Philippines)

After changing, restart the channel for changes to take effect.

---

## If Something Breaks

> Don't worry. Everything is fixable.

| Problem | Solution |
| --- | --- |
| "node is not recognized" | Install Node.js from [nodejs.org](https://nodejs.org) and restart VS Code |
| "git is not recognized" (Windows) | Follow the Git + PATH fix steps in the requirements section above |
| QR code not showing | Open your browser and go to `http://localhost:8787` manually |
| QR code page says "Generating..." | Wait 5-10 seconds — Baileys is connecting to WhatsApp servers |
| Messages not arriving | Check the debug log: `~/.claude/whatsapp-channel/debug.log` |
| Messages blocked by allowlist | Add the sender's phone number to `WA_ALLOW_FROM` in `.mcp.json` |
| "Session logged out" | Delete the auth folder and restart (see below) |
| WhatsApp disconnected | Just restart the channel with the same command |
| Mac popup about developer tools | Click **"Install"** (NOT "Get Xcode") and wait 3-5 minutes |

### Reset WhatsApp Session

If you need to re-scan the QR code (for example if your phone was offline too long):

**Mac/Linux:**
```
rm -rf ~/.claude/whatsapp-channel/auth/
```

**Windows:**
```
Delete the folder: C:\Users\[your username]\.claude\whatsapp-channel\auth\
```

Then restart the channel — a new QR code will appear.

---

## Useful Links

| Resource | Link |
| --- | --- |
| WhatsApp Channel (GitHub) | [github.com/jesie-cmd/whats-app-channel](https://github.com/jesie-cmd/whats-app-channel) |
| Claude Code Extension | Search "Claude Code" in VS Code Extensions |
| Node.js | [nodejs.org](https://nodejs.org) |
| Git for Windows | [git-scm.com/download/win](https://git-scm.com/download/win) |
| VS Code | [code.visualstudio.com](https://code.visualstudio.com) |

---

*WhatsApp Channel for Claude Code — Built with Baileys + MCP*
