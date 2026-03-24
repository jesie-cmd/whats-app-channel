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
             border-radius: 8px; padding: 0.5rem 1rem; margin-top: 1rem; font-size: 0.8rem; color: #888; }
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
    '<div class="connected">&#10003; WhatsApp connected!<br><span style="font-size:0.9rem;color:#888;">You can close this page.</span></div>',
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
  // Generate SVG from the raw QR data string
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
  // Also save QR data to a temp file
  try {
    fs.writeFileSync(QR_FILE, qr, "utf-8");
  } catch {}
}

export function markConnected(): void {
  isConnected = true;
  currentQr = null;
  currentQrSvg = null;
  try { fs.unlinkSync(QR_FILE); } catch {}
  // Close server after a brief delay so the connected page loads
  setTimeout(() => {
    server?.close();
    server = null;
  }, 10_000);
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

    server.listen(QR_PORT, "0.0.0.0", () => {
      resolve(QR_PORT);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        server?.close();
        server = http.createServer(createHandler());
        server.listen(QR_PORT + 1, "0.0.0.0", () => {
          resolve(QR_PORT + 1);
        });
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
