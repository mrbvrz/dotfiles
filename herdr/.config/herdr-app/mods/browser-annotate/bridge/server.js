#!/usr/bin/env node
// Herdr ADE Browser Annotate - Local Bridge Server
// Listens on 127.0.0.1:7890 to bridge Chrome Browser Annotations to Herdr Core (hc)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = 7890;
const HOST = "127.0.0.1";
const recentHistory = [];
const projectMap = new Map(); // spaceId -> { spaceId, spaceName, folder, terminal, url, updatedAt }
let lastActiveSpaceId = null;

async function getLiveTerminals() {
  try {
    const { stdout } = await execFileAsync("hc", ["ls", "--json"]);
    const data = JSON.parse(stdout);
    return data.terminals || [];
  } catch (err) {
    try {
      const hcPath = path.join(process.env.HOME || "", ".local/bin/hc");
      const { stdout } = await execFileAsync(hcPath, ["ls", "--json"]);
      const data = JSON.parse(stdout);
      return data.terminals || [];
    } catch {
      return [];
    }
  }
}

async function sendToHerdr(terminal, text, screenshotPath) {
  const hcCmd = fs.existsSync(path.join(process.env.HOME || "", ".local/bin/hc"))
    ? path.join(process.env.HOME || "", ".local/bin/hc")
    : "hc";

  // If screenshot exists, try to put it beside terminal workspace
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    try {
      await execFileAsync(hcCmd, ["put", terminal, screenshotPath]);
    } catch (err) {
      // Non-fatal if put fails
    }
  }

  // Send prompt to terminal
  await execFileAsync(hcCmd, ["send", terminal, text]);
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  // Static files for extension / bookmarklet injection
  if (url.pathname === "/content.js") {
    const filePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../extension/content.js");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(fs.readFileSync(filePath, "utf8"));
      return;
    }
  }

  if (url.pathname === "/content.css") {
    const filePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../extension/content.css");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(fs.readFileSync(filePath, "utf8"));
      return;
    }
  }

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", app: "herdr-browser-annotate-bridge", version: "1.0.0" }));
    return;
  }

  // Get live terminals
  if (url.pathname === "/api/terminals") {
    try {
      const terminals = await getLiveTerminals();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", terminals }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: err.message }));
    }
    return;
  }

  // Get recent history
  if (url.pathname === "/api/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", history: recentHistory }));
    return;
  }

  // Get registered projects
  if (url.pathname === "/api/projects") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      projects: Array.from(projectMap.values()),
      lastActiveSpaceId
    }));
    return;
  }

  // Register active project from Herdr
  if (url.pathname === "/api/active-project" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data.spaceId) {
          projectMap.set(data.spaceId, {
            spaceId: data.spaceId,
            spaceName: data.spaceName || data.spaceId,
            folder: data.folder || "",
            terminal: data.terminal || null,
            url: data.url || "",
            updatedAt: Date.now()
          });
          lastActiveSpaceId = data.spaceId;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, activeSpaceId: lastActiveSpaceId }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Post annotation
  if (url.pathname === "/api/annotate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { instruction, pageUrl, pageTitle, element, screenshotBase64 } = payload;
        let target = payload.targetTerminal;
        let matchedProject = null;

        // Try to match project by pageUrl
        if (pageUrl) {
          try {
            const parsedUrl = new URL(pageUrl);
            const hostPort = parsedUrl.host; // e.g. "localhost:5173"
            for (const proj of projectMap.values()) {
              if (proj.url) {
                try {
                  const projUrl = new URL(proj.url);
                  if (projUrl.host === hostPort) {
                    matchedProject = proj;
                    break;
                  }
                } catch {}
              }
            }
          } catch {}
        }

        // If no URL match, fallback to last active space project
        if (!matchedProject && lastActiveSpaceId && projectMap.has(lastActiveSpaceId)) {
          matchedProject = projectMap.get(lastActiveSpaceId);
        }

        // 1. Save screenshot to disk if provided
        let savedImagePath = null;
        if (screenshotBase64 && screenshotBase64.startsWith("data:image/")) {
          const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          const filename = `herdr-annotate-${Date.now()}.png`;
          savedImagePath = path.join("/tmp", filename);
          fs.writeFileSync(savedImagePath, buffer);
        }

        // 2. Resolve target terminal
        const terminals = await getLiveTerminals();
        if (!target) {
          if (matchedProject?.terminal) {
            // Verify if project's terminal is live
            const isLive = terminals.some((t) => t.address === matchedProject.terminal && t.state === "live");
            if (isLive) target = matchedProject.terminal;
          }
          if (!target) {
            const workingAgent = terminals.find((t) => t.status === "working");
            const anyAgent = terminals.find((t) => t.agent && t.agent !== "zsh" && t.agent !== "bash");
            target = workingAgent?.address || anyAgent?.address || terminals[0]?.address || "t1";
          }
        }

        // 3. Format ADE prompt
        const headerTitle = matchedProject
          ? `[Browser Annotate] Project: ${matchedProject.spaceName}`
          : `[Browser Annotate]`;

        const lines = [
          headerTitle,
          `- Page: ${pageUrl || "Unknown URL"}${pageTitle ? ` ("${pageTitle}")` : ""}`,
        ];

        if (matchedProject?.folder) {
          lines.push(`- Workspace: ${matchedProject.folder}`);
        }

        if (element) {
          if (element.component) lines.push(`- Component: ${element.component}`);
          if (element.tag) lines.push(`- Tag: <${element.tag}>`);
          if (element.selector) lines.push(`- Selector: \`${element.selector}\``);
          if (element.classes) lines.push(`- Classes: \`${element.classes}\``);
          if (element.rect) {
            lines.push(`- Dimensions: ${Math.round(element.rect.width)}×${Math.round(element.rect.height)} px`);
          }
          if (element.text) lines.push(`- Text content: "${element.text}"`);
        }

        if (savedImagePath) {
          lines.push(`- Screenshot: ${savedImagePath}`);
        }

        lines.push(``, `Instruksi:`, instruction || "Tolong periksa dan perbaiki elemen ini.");

        const finalPrompt = lines.join("\n");

        // 4. Send to Herdr
        await sendToHerdr(target, finalPrompt, savedImagePath);

        // 5. Store in history
        const entry = {
          id: `ann-${Date.now()}`,
          timestamp: new Date().toISOString(),
          terminal: target,
          instruction,
          pageUrl,
          element,
          screenshotPath: savedImagePath,
          prompt: finalPrompt
        };
        recentHistory.unshift(entry);
        if (recentHistory.length > 50) recentHistory.pop();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          terminal: target,
          screenshotPath: savedImagePath,
          message: `Sent to terminal ${target}`
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`Herdr ADE Browser Annotate Bridge running at http://${HOST}:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
