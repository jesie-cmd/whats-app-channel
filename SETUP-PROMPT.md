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
   - git (run: git --version)

   If Node.js is NOT installed or is too old:
   - Mac: Tell me to go to https://nodejs.org and download the "LTS" version.
     Click the .pkg file and follow the installer. Then restart Claude Code.
   - Windows: Tell me to go to https://nodejs.org and download the "LTS" version.
     Run the .msi installer and follow the prompts. Then restart Claude Code.

   If git is NOT installed:
   - Mac: A popup may appear asking to install developer tools.
     Tell me to click "Install" and wait a few minutes before continuing.
   - Windows: Tell me to go to https://git-scm.com and download the installer.
     Run it and click "Next" through all the steps. Then restart Claude Code.

   Wait for me to confirm before continuing.

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

   If it fails, check if there is a network issue or if Node.js is not
   properly installed. Help me fix it before continuing.

4. Now let's set up security. Open the file ".mcp.json" inside the
   whatsapp-channel folder.

   Explain to me in plain English:
   - "There's a security setting that controls who can message Claude
     through your WhatsApp. Right now it's open to everyone."
   - Ask me: "Do you want to restrict who can message Claude through
     WhatsApp? If yes, tell me the phone number(s) with country code
     (like +1 for US, +44 for UK, +63 for Philippines)."
   - If I give you numbers, put them in WA_ALLOW_FROM separated by commas.
     For example: "+1234567890, +0987654321"
   - If I say no or skip, leave WA_ALLOW_FROM as "" (empty means
     anyone can message).

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
   h) Once it scans, WhatsApp is connected to Claude!

   After this, anyone you've allowed can message your WhatsApp number
   and Claude will receive it and reply."

   Now open a terminal and run these commands directly:

   Mac/Linux:
     cd ~/whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp

   Windows:
     cd %USERPROFILE%\whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp

   Tell me how to open a terminal if I don't know:
   - Mac: Press Cmd+Space, type "Terminal", press Enter
   - Windows: Press the Windows key, type "Terminal" or "Command Prompt", press Enter

   NOTE: The flag "--dangerously-load-development-channels" sounds scary
   but it's normal — it just means this is a custom channel not yet in
   the official store. It's safe because it runs on your own computer.

   If the QR code page does NOT open automatically, tell me to open
   my browser and go to: http://localhost:8787

6. After I confirm WhatsApp is connected and working, tell me:

   "You're all set! Here's what you need to know:

   HOW TO START:
   - Open a terminal (Mac: Cmd+Space → Terminal / Windows: Start → Terminal)
   - Run this command:
     Mac/Linux: cd ~/whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp
     Windows: cd %USERPROFILE%\whatsapp-channel && claude --dangerously-load-development-channels server:whatsapp
   - That's it! Claude is now listening on your WhatsApp.

   GOOD NEWS:
   - Your WhatsApp session is saved, so you only need to scan the
     QR code once. Next time it will connect automatically.

   IF SOMETHING GOES WRONG:
   - If WhatsApp disconnects, just restart Claude Code with the
     same command above.

   - If you need to re-scan the QR code (for example if your phone
     was offline for too long), run this to reset:
     Mac/Linux: rm -rf ~/.claude/whatsapp-channel/auth/
     Windows: Delete the folder at C:\Users\[username]\.claude\whatsapp-channel\auth\
     Then restart Claude Code — a new QR code will appear.

   - To see what's happening behind the scenes, check the log file:
     Mac/Linux: ~/.claude/whatsapp-channel/debug.log
     Windows: C:\Users\[username]\.claude\whatsapp-channel\debug.log

   CHANGING SETTINGS:
   - To change who can message Claude, edit the file .mcp.json
     inside the whatsapp-channel folder and update WA_ALLOW_FROM
     with phone numbers separated by commas.

   TRY IT NOW:
   Send a message from another phone to your WhatsApp number
   and see if Claude responds!"

Talk to me like I am not technical. Plain English, one step at a time.
Wait for me to confirm each step before moving to the next.
If something goes wrong, help me fix it before continuing.
```
