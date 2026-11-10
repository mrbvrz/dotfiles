// Background service worker for Herdr ADE Browser Annotate

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-annotate") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "toggle-toolbar" }).catch(() => {
        // Tab might not have content script loaded yet (e.g. chrome:// or restricted page)
      });
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "capture-visible-tab") {
    chrome.tabs.captureVisibleTab(null, { format: "png" })
      .then((dataUrl) => {
        sendResponse({ success: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async sendResponse
  }

  if (request.action === "check-bridge") {
    fetch("http://127.0.0.1:7890/health")
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "get-terminals") {
    fetch("http://127.0.0.1:7890/api/terminals")
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, terminals: data.terminals ?? [] }))
      .catch((err) => sendResponse({ success: false, error: err.message, terminals: [] }));
    return true;
  }

  if (request.action === "send-annotation") {
    fetch("http://127.0.0.1:7890/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.payload)
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
