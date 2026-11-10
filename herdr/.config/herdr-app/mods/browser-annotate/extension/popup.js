// Popup logic for Herdr ADE Annotate

document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const terminalSelect = document.getElementById("terminalSelect");
  const btnToggle = document.getElementById("btnToggle");

  // Load saved target terminal preference
  const saved = await chrome.storage.local.get(["targetTerminal"]);
  const savedTarget = saved.targetTerminal || "";

  // Check bridge status
  try {
    const res = await fetch("http://127.0.0.1:7890/health", { cache: "no-store" });
    if (res.ok) {
      statusDot.className = "dot online";
      statusText.textContent = "Bridge Online";

      // Load terminals
      const tRes = await fetch("http://127.0.0.1:7890/api/terminals", { cache: "no-store" });
      if (tRes.ok) {
        const { terminals } = await tRes.json();
        terminalSelect.innerHTML = '<option value="">Auto (Active / Focused Agent)</option>';
        if (terminals && terminals.length > 0) {
          terminals.forEach((t) => {
            const opt = document.createElement("option");
            opt.value = t.address;
            const statusBadge = t.status === "working" ? " [working]" : "";
            const desc = t.where ? ` (${t.where.split("/")[0].trim()})` : "";
            opt.textContent = `${t.address}: ${t.agent || "terminal"}${desc}${statusBadge}`;
            if (t.address === savedTarget) {
              opt.selected = true;
            }
            terminalSelect.appendChild(opt);
          });
        }
      }
    } else {
      throw new Error("Bridge not ready");
    }
  } catch (err) {
    statusDot.className = "dot offline";
    statusText.textContent = "Bridge Offline";
  }

  terminalSelect.addEventListener("change", async () => {
    const val = terminalSelect.value;
    await chrome.storage.local.set({ targetTerminal: val });
  });

  btnToggle.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: "toggle-toolbar",
        targetTerminal: terminalSelect.value
      }).then(() => {
        window.close();
      }).catch(async () => {
        // Content script might need manual injection if on existing tab
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content.css"]
        });
        chrome.tabs.sendMessage(tab.id, {
          action: "toggle-toolbar",
          targetTerminal: terminalSelect.value
        });
        window.close();
      });
    }
  });
});
