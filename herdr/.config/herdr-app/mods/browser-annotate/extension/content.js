// Herdr ADE Browser Annotate - Content Script
(() => {
  if (window.__herdr_annotate_loaded) {
    return;
  }
  window.__herdr_annotate_loaded = true;

  let currentMode = null; // 'inspect' | 'block' | null
  let activeTerminal = "";
  let hoveredEl = null;
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let currentSelection = null; // { type: 'element'|'area', rect, el, text, selector, component }
  let lastCapturedTabUrl = null;

  // Root container
  let root = document.getElementById("herdr-annotate-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "herdr-annotate-root";
    document.body.appendChild(root);
  }

  // Elements in overlay
  const inspectBox = document.createElement("div");
  inspectBox.className = "herdr-inspect-box";
  inspectBox.style.display = "none";
  const inspectBadge = document.createElement("div");
  inspectBadge.className = "herdr-inspect-badge";
  inspectBox.appendChild(inspectBadge);
  root.appendChild(inspectBox);

  const marqueeBox = document.createElement("div");
  marqueeBox.className = "herdr-marquee-box";
  marqueeBox.style.display = "none";
  const marqueeDim = document.createElement("div");
  marqueeDim.className = "herdr-marquee-dim";
  marqueeBox.appendChild(marqueeDim);
  root.appendChild(marqueeBox);

  let toolbar = null;
  let popover = null;

  // ---------------------------------------------------------------------------
  // Helper: Get Component Name (React/Vue/WebComponent)
  // ---------------------------------------------------------------------------
  function getComponentName(el) {
    if (!el) return null;
    let curr = el;
    while (curr && curr !== document.body) {
      if (curr.getAttribute("data-component")) return curr.getAttribute("data-component");
      if (curr.getAttribute("data-testid")) return curr.getAttribute("data-testid");
      for (const key of Object.keys(curr)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
          let fiber = curr[key];
          while (fiber) {
            const name = fiber.type?.displayName || fiber.type?.name;
            if (name && typeof name === "string" && !name.startsWith("_")) {
              return `<${name} />`;
            }
            fiber = fiber.return;
          }
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Helper: Clean CSS Selector
  // ---------------------------------------------------------------------------
  function getSelector(el) {
    if (!el || el === document.body) return "body";
    if (el.id) return `#${el.id}`;
    let path = [];
    let curr = el;
    while (curr && curr !== document.body && path.length < 3) {
      let segment = curr.tagName.toLowerCase();
      if (curr.className && typeof curr.className === "string") {
        const classes = curr.className.trim().split(/\s+/).filter(c => !c.startsWith("herdr-") && !c.includes(":"));
        if (classes.length > 0) {
          segment += "." + classes.slice(0, 2).join(".");
        }
      }
      path.unshift(segment);
      curr = curr.parentElement;
    }
    return path.join(" > ");
  }

  // ---------------------------------------------------------------------------
  // Floating Toolbar
  // ---------------------------------------------------------------------------
  function createToolbar() {
    if (toolbar) {
      toolbar.style.display = toolbar.style.display === "none" ? "flex" : "none";
      return;
    }

    toolbar = document.createElement("div");
    toolbar.className = "herdr-toolbar";
    toolbar.innerHTML = `
      <div class="herdr-brand">
        <div class="herdr-logo-icon">H</div>
        <div class="herdr-brand-name">ADE</div>
      </div>
      <button class="herdr-tool-btn" id="herdr-btn-inspect" title="Cek & Inspect Element (C)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6z"/></svg>
        <span>Cek Element</span>
      </button>
      <button class="herdr-tool-btn" id="herdr-btn-block" title="Block Area / Marquee (B)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="3 3"/><path d="M3 9h18M9 21V3"/></svg>
        <span>Block Area</span>
      </button>
      <div class="herdr-status-badge" id="herdr-status-badge">
        <div class="herdr-status-indicator"></div>
        <span id="herdr-target-label">Agent: Auto</span>
      </div>
      <button class="herdr-close-btn" id="herdr-btn-close" title="Tutup Toolbar (Esc)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;
    root.appendChild(toolbar);

    const btnInspect = toolbar.querySelector("#herdr-btn-inspect");
    const btnBlock = toolbar.querySelector("#herdr-btn-block");
    const btnClose = toolbar.querySelector("#herdr-btn-close");

    btnInspect.addEventListener("click", () => setMode(currentMode === "inspect" ? null : "inspect"));
    btnBlock.addEventListener("click", () => setMode(currentMode === "block" ? null : "block"));
    btnClose.addEventListener("click", () => setMode(null, true));

    // Fetch bridge status and live agent
    updateBridgeStatus();
  }

  async function updateBridgeStatus() {
    try {
      const res = await fetch("http://127.0.0.1:7890/api/terminals", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const working = data.terminals?.find(t => t.status === "working");
        const targetLabel = document.getElementById("herdr-target-label");
        if (targetLabel) {
          if (working) {
            targetLabel.textContent = `Agent: ${working.address} [${working.agent || "active"}]`;
            activeTerminal = working.address;
          } else if (data.terminals?.length > 0) {
            const first = data.terminals[0];
            targetLabel.textContent = `Agent: ${first.address}`;
            activeTerminal = first.address;
          }
        }
      }
    } catch {
      const targetLabel = document.getElementById("herdr-target-label");
      if (targetLabel) targetLabel.textContent = "Bridge Offline";
    }
  }

  function setMode(mode, closeToolbar = false) {
    currentMode = mode;
    const btnInspect = toolbar?.querySelector("#herdr-btn-inspect");
    const btnBlock = toolbar?.querySelector("#herdr-btn-block");

    if (btnInspect) btnInspect.classList.toggle("active", mode === "inspect");
    if (btnBlock) btnBlock.classList.toggle("active", mode === "block");

    if (!mode) {
      inspectBox.style.display = "none";
      marqueeBox.style.display = "none";
      document.body.style.cursor = "default";
      if (closeToolbar && toolbar) toolbar.style.display = "none";
    } else if (mode === "inspect") {
      document.body.style.cursor = "pointer";
      marqueeBox.style.display = "none";
    } else if (mode === "block") {
      document.body.style.cursor = "crosshair";
      inspectBox.style.display = "none";
    }
  }

  // ---------------------------------------------------------------------------
  // Event Listeners for Hover & Selection
  // ---------------------------------------------------------------------------
  window.addEventListener("mousemove", (e) => {
    if (currentMode === "inspect") {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || target.closest("#herdr-annotate-root")) return;
      hoveredEl = target;

      const rect = target.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      inspectBox.style.display = "block";
      inspectBox.style.top = `${rect.top + scrollY}px`;
      inspectBox.style.left = `${rect.left + scrollX}px`;
      inspectBox.style.width = `${rect.width}px`;
      inspectBox.style.height = `${rect.height}px`;

      const tag = target.tagName.toLowerCase();
      const firstClass = target.className && typeof target.className === "string" ? "." + target.className.trim().split(/\s+/)[0] : "";
      inspectBadge.textContent = `<${tag}${firstClass}> ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    } else if (currentMode === "block" && isDragging) {
      const currentX = e.clientX + window.scrollX;
      const currentY = e.clientY + window.scrollY;

      const left = Math.min(dragStart.x, currentX);
      const top = Math.min(dragStart.y, currentY);
      const width = Math.abs(currentX - dragStart.x);
      const height = Math.abs(currentY - dragStart.y);

      marqueeBox.style.display = "block";
      marqueeBox.style.left = `${left}px`;
      marqueeBox.style.top = `${top}px`;
      marqueeBox.style.width = `${width}px`;
      marqueeBox.style.height = `${height}px`;
      marqueeDim.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
    }
  }, { passive: true });

  window.addEventListener("mousedown", (e) => {
    if (e.target.closest("#herdr-annotate-root")) return;

    if (currentMode === "block") {
      e.preventDefault();
      isDragging = true;
      dragStart = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      marqueeBox.style.display = "block";
      marqueeBox.style.left = `${dragStart.x}px`;
      marqueeBox.style.top = `${dragStart.y}px`;
      marqueeBox.style.width = "0px";
      marqueeBox.style.height = "0px";
    }
  });

  window.addEventListener("mouseup", async (e) => {
    if (e.target.closest("#herdr-annotate-root")) return;

    if (currentMode === "block" && isDragging) {
      isDragging = false;
      const currentX = e.clientX + window.scrollX;
      const currentY = e.clientY + window.scrollY;
      const left = Math.min(dragStart.x, currentX);
      const top = Math.min(dragStart.y, currentY);
      const width = Math.abs(currentX - dragStart.x);
      const height = Math.abs(currentY - dragStart.y);

      if (width > 15 && height > 15) {
        currentSelection = {
          type: "area",
          rect: {
            x: left - window.scrollX,
            y: top - window.scrollY,
            width,
            height,
            pageX: left,
            pageY: top
          },
          text: `Area ${Math.round(width)}×${Math.round(height)} px`,
          selector: `Selected Area (${Math.round(width)}×${Math.round(height)})`,
          component: null
        };
        setMode(null);
        openAnnotationPopover(currentSelection);
      } else {
        marqueeBox.style.display = "none";
      }
    }
  });

  window.addEventListener("click", async (e) => {
    if (e.target.closest("#herdr-annotate-root")) return;

    if (currentMode === "inspect" && hoveredEl) {
      e.preventDefault();
      e.stopPropagation();

      const el = hoveredEl;
      const rect = el.getBoundingClientRect();
      currentSelection = {
        type: "element",
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          pageX: rect.left + window.scrollX,
          pageY: rect.top + window.scrollY
        },
        el,
        text: el.innerText ? el.innerText.trim().slice(0, 100) : "",
        selector: getSelector(el),
        component: getComponentName(el),
        tag: el.tagName.toLowerCase(),
        classes: el.className && typeof el.className === "string" ? el.className.trim() : ""
      };
      setMode(null);
      openAnnotationPopover(currentSelection);
    }
  }, true);

  // Keyboard shortcut Esc
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (popover) {
        closePopover();
      } else if (currentMode) {
        setMode(null);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Crop Screenshot from Tab Capture
  // ---------------------------------------------------------------------------
  async function cropScreenshot(rect) {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "capture-visible-tab" }, (response) => {
          if (!response || !response.success || !response.dataUrl) {
            resolve(null);
            return;
          }

          const img = new Image();
          img.onload = () => {
            const dpr = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            const sx = Math.max(0, rect.x * dpr);
            const sy = Math.max(0, rect.y * dpr);
            const sw = Math.min(img.width - sx, rect.width * dpr);
            const sh = Math.min(img.height - sy, rect.height * dpr);

            canvas.width = sw;
            canvas.height = sh;
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

            try {
              const croppedData = canvas.toDataURL("image/png");
              resolve(croppedData);
            } catch {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = response.dataUrl;
        });
      });
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Annotation Popover (ADE Prompt Card)
  // ---------------------------------------------------------------------------
  async function openAnnotationPopover(selection) {
    closePopover();

    popover = document.createElement("div");
    popover.className = "herdr-popover";

    // Position popover intelligently near selection
    let popoverTop = selection.rect.pageY + selection.rect.height + 12;
    let popoverLeft = selection.rect.pageX;

    // Check bounds
    if (popoverLeft + 360 > window.innerWidth + window.scrollX) {
      popoverLeft = window.innerWidth + window.scrollX - 370;
    }
    if (popoverLeft < 10) popoverLeft = 10;

    popover.style.top = `${popoverTop}px`;
    popover.style.left = `${popoverLeft}px`;

    const titleBadge = selection.component
      ? selection.component
      : selection.type === "element"
      ? `<${selection.tag}>`
      : `${Math.round(selection.rect.width)}×${Math.round(selection.rect.height)} Area`;

    popover.innerHTML = `
      <div class="herdr-popover-header">
        <div class="herdr-element-chip" title="${selection.selector}">
          <span>🎯</span>
          <span>${titleBadge}</span>
        </div>
        <button class="herdr-close-btn" id="herdr-pop-close">✕</button>
      </div>

      <div class="herdr-preview-wrap" id="herdr-preview-wrap">
        <span style="font-size:11px; color:#6A7875;">Mengambil snapshot...</span>
      </div>

      <div class="herdr-chips-row">
        <div class="herdr-chip" data-text="Perbaiki styling dan layout elemen ini">🎨 UI / Styling</div>
        <div class="herdr-chip" data-text="Perbaiki bug pada bagian ini">🐛 Fix Bug</div>
        <div class="herdr-chip" data-text="Jelaskan alur dan fungsi komponen ini">💡 Jelaskan</div>
        <div class="herdr-chip" data-text="Refactor kode bagian ini agar lebih rapi">🧹 Refactor</div>
      </div>

      <textarea class="herdr-textarea" id="herdr-prompt-input" placeholder="Ketik instruksi untuk AI coding agent... (Cmd+Enter untuk kirim)"></textarea>

      <div class="herdr-popover-footer">
        <div class="herdr-target-info">
          <span>Kirim ke:</span>
          <span class="herdr-target-badge" id="herdr-pop-target">${activeTerminal || "Auto Agent"}</span>
        </div>
        <div class="herdr-actions">
          <button class="herdr-btn-cancel" id="herdr-pop-cancel">Batal</button>
          <button class="herdr-btn-send" id="herdr-pop-send">
            <span>Kirim ke Agent</span>
            <span style="font-size:10px; opacity:0.8;">↵</span>
          </button>
        </div>
      </div>
    `;

    root.appendChild(popover);

    const textarea = popover.querySelector("#herdr-prompt-input");
    const btnSend = popover.querySelector("#herdr-pop-send");
    const btnCancel = popover.querySelector("#herdr-pop-cancel");
    const btnClose = popover.querySelector("#herdr-pop-close");
    const previewWrap = popover.querySelector("#herdr-preview-wrap");

    textarea.focus();

    // Attach quick chip clicks
    popover.querySelectorAll(".herdr-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        textarea.value = chip.getAttribute("data-text");
        textarea.focus();
      });
    });

    btnCancel.addEventListener("click", closePopover);
    btnClose.addEventListener("click", closePopover);

    // Asynchronously crop screenshot and update preview
    let croppedImage = await cropScreenshot(selection.rect);
    if (croppedImage && previewWrap) {
      previewWrap.innerHTML = `<img class="herdr-preview-img" src="${croppedImage}" alt="Annotated Element">`;
    } else if (previewWrap) {
      previewWrap.style.display = "none";
    }

    // Submit handler
    const doSend = async () => {
      const instruction = textarea.value.trim() || "Periksa dan perbaiki elemen yang dianotasi ini.";
      btnSend.disabled = true;
      btnSend.innerHTML = `<span>Mengirim...</span>`;

      const payload = {
        instruction,
        targetTerminal: activeTerminal || null,
        pageUrl: window.location.href,
        pageTitle: document.title,
        element: {
          tag: selection.tag,
          selector: selection.selector,
          classes: selection.classes,
          text: selection.text,
          component: selection.component,
          rect: selection.rect
        },
        screenshotBase64: croppedImage
      };

      try {
        const res = await fetch("http://127.0.0.1:7890/api/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const result = await res.json();
          showToast(`✓ Berhasil dikirim ke agent [${result.terminal || "active"}]!`);
          closePopover();
        } else {
          throw new Error("Gagal mengirim payload ke bridge");
        }
      } catch (err) {
        showToast(`❌ Bridge error: ${err.message}`, true);
        btnSend.disabled = false;
        btnSend.innerHTML = `<span>Kirim ke Agent</span>`;
      }
    };

    btnSend.addEventListener("click", doSend);

    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    });
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
    inspectBox.style.display = "none";
    marqueeBox.style.display = "none";
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = "herdr-toast";
    if (isError) {
      toast.style.borderColor = "var(--herdr-red)";
    }
    toast.innerHTML = `
      <span class="herdr-toast-icon">${isError ? "⚠" : "✓"}</span>
      <span>${message}</span>
    `;
    root.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = "opacity 0.3s ease";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ---------------------------------------------------------------------------
  // Message listener from background / popup
  // ---------------------------------------------------------------------------
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "toggle-toolbar") {
        if (request.targetTerminal) {
          activeTerminal = request.targetTerminal;
        }
        createToolbar();
        sendResponse({ success: true });
      }
    });
  }

  // Automatically create toolbar on launch
  createToolbar();
})();
