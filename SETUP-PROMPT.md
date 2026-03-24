# WhatsApp Channel Setup Prompt

Copy and paste the prompt below into Claude Code to guide a non-technical user through the setup process.

---

```
I want to set up the WhatsApp Channel for Claude Code so I can chat with Claude from my phone.

Do these steps one at a time, telling me what you are doing in plain English.
Use the correct commands for my operating system (detect whether I am on Mac or Windows).

1. Check if I have the right tools installed:
   - Node.js version 20 or higher (run: node --version)
   - npm (run: npm --version)

   If Node.js is NOT installed or is too old:
   - Mac: Tell me to go to https://nodejs.org and download the "LTS" version.
     Click the .pkg file and follow the installer. Then restart Claude Code.
   - Windows: Tell me to go to https://nodejs.org and download the "LTS" version.
     Run the .msi installer and follow the prompts. Then restart Claude Code.

   Wait for me to confirm before continuing.

2. Create a folder called "whatsapp-channel" in my home directory:
   - Mac: ~/whatsapp-channel
   - Windows: C:\Users\[my username]\whatsapp-channel

   Inside it, create a subfolder called "src".

3. Create the file "package.json" in the whatsapp-channel folder with this content:

   {
     "name": "whatsapp-channel",
     "version": "0.1.0",
     "type": "module",
     "description": "WhatsApp channel for Claude Code",
     "dependencies": {
       "@modelcontextprotocol/sdk": "^1.12.1",
       "@whiskeysockets/baileys": "^7.0.0-rc.9",
       "qrcode": "^1.5.4",
       "qrcode-terminal": "^0.12.0",
       "zod": "^3.24.0"
     },
     "devDependencies": {
       "tsx": "^4.21.0",
       "typescript": "^5.7.0"
     }
   }

4. Create the file "tsconfig.json" in the whatsapp-channel folder with this content:

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

5. Now create 5 files inside the "src" folder. These are the channel source code.
   Read each file from this project's source:
   - src/types.d.ts
   - src/session.ts
   - src/qr-server.ts
   - src/monitor.ts
   - src/index.ts

   Copy each one exactly as-is into the user's whatsapp-channel/src/ folder.
   Tell me: "I'm copying the channel source code — 5 files total."

6. Run "npm install" inside the whatsapp-channel folder to download all the
   required packages. Tell me: "I'm downloading the packages this needs.
   This might take a minute."

   If it fails, check if there is a network issue or if Node.js is not
   properly installed. Help me fix it before continuing.

7. Now configure Claude Code to know about the WhatsApp channel.
   Create a file called ".mcp.json" in the whatsapp-channel folder with this:

   {
     "mcpServers": {
       "whatsapp": {
         "command": "npx",
         "args": ["tsx", "./src/index.ts"],
         "env": {
           "WA_ALLOW_FROM": "",
           "WA_VERBOSE": "1"
         }
       }
     }
   }

   Explain to me:
   - WA_ALLOW_FROM is a security setting. If I leave it empty, anyone who
     messages my WhatsApp can talk to Claude. If I want to restrict it,
     I should put my phone number(s) here like: "+1234567890"
   - Ask me: "Do you want to restrict who can message Claude through
     WhatsApp? If yes, tell me the phone number(s) with country code
     (like +1 for US, +44 for UK, +63 for Philippines)."
   - If I give you numbers, put them in WA_ALLOW_FROM separated by commas.
   - If I say no or skip, leave it empty.

8. Create a ".gitignore" file in the whatsapp-channel folder with:

   node_modules/
   dist/
   auth/
   *.log
   .DS_Store
   .env

9. Now tell me we are ready to connect WhatsApp. Explain in plain English:

   "Everything is installed! Now we need to link your WhatsApp to Claude.
   Here's what will happen:

   a) I'll start Claude Code with the WhatsApp channel
   b) A webpage will open in your browser showing a QR code
   c) On your phone, open WhatsApp
   d) Go to Settings (tap the three dots or gear icon)
   e) Tap 'Linked Devices'
   f) Tap 'Link a Device'
   g) Point your phone camera at the QR code on your screen
   h) Once it scans, WhatsApp is connected to Claude!

   After this, anyone you've allowed can message your WhatsApp number
   and Claude will receive it and reply."

   Tell me to start Claude Code with this command:
   - Mac/Linux: claude --dangerously-load-development-channels server:whatsapp
   - Windows: claude --dangerously-load-development-channels server:whatsapp

   NOTE: The flag "--dangerously-load-development-channels" sounds scary
   but it's normal — it just means this is a custom channel not yet in
   the official store. It's safe because it runs on your own computer.

10. After I confirm everything is working, tell me:

    "You're all set! Here's what you need to know:

    - To start the WhatsApp channel, always use:
      claude --dangerously-load-development-channels server:whatsapp

    - Your WhatsApp session is saved, so you only need to scan the
      QR code once. Next time it will connect automatically.

    - If WhatsApp disconnects, just restart Claude Code with the
      same command.

    - To see what's happening behind the scenes, check the log file at:
      Mac/Linux: ~/.claude/whatsapp-channel/debug.log
      Windows: C:\Users\[username]\.claude\whatsapp-channel\debug.log

    - If you need to re-scan the QR code, delete the auth folder:
      Mac/Linux: rm -rf ~/.claude/whatsapp-channel/auth/
      Windows: Delete the folder at C:\Users\[username]\.claude\whatsapp-channel\auth\

    - To change who can message Claude, edit .mcp.json and update
      WA_ALLOW_FROM with phone numbers separated by commas.

    Try it now! Send a message from another phone to your WhatsApp
    and see if Claude responds."

Talk to me like I am not technical. Plain English, one step at a time.
Wait for me to confirm each step before moving to the next.
If something goes wrong, help me fix it before continuing.
```
