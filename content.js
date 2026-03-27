(() => {

if (window.__NA__) return;
window.__NA__ = true;

const ok =
  location.protocol.startsWith("http") ||
  location.protocol === "file:" ||
  document.contentType === "application/pdf";

if (!ok) return;

const PAGE = location.origin + location.pathname;
const FEEDBACK_URL = "https://docs.google.com/forms/d/e/1FAIpQLScVyMy7wcVUluyuxndSUmcMebgi3kLGUsU1Tr5x4kEugofg2w/viewform?usp=publish-editor";

let notes = {};
let settings = {
  theme: "light",
  fontSize: 16,
  fontFamily: "sans",
  ruled: false,
  glass: 0.45,
  customColor: "#ffe066",
  shortcutPanel: "Ctrl+Shift+N",
  shortcutNote: "Ctrl+Shift+M"
};

let tempSettings = { ...settings };
let hidden = false;
let maxZ = 1000;
let currentTopZ = 1000;

init();

/* ─────────── VALIDATION ─────────── */

function validateNote(n) {
  return (
    n &&
    typeof n.id === "string" && n.id.length > 0 &&
    typeof n.text === "string" &&
    typeof n.title === "string" &&
    typeof n.x === "number" && typeof n.y === "number" &&
    typeof n.w === "number" && typeof n.h === "number"
  );
}

function validateSettings(s) {
  if (!s || typeof s !== "object") return false;
  const validThemes = ["light", "dark", "glass", "custom", "sticky"];
  const validFonts  = ["sans", "serif", "mono", "hand"];
  return (
    (!s.theme      || validThemes.includes(s.theme)) &&
    (!s.fontFamily || validFonts.includes(s.fontFamily)) &&
    (!s.fontSize   || (typeof s.fontSize === "number" && s.fontSize >= 12 && s.fontSize <= 26)) &&
    (!s.glass      || (typeof s.glass    === "number" && s.glass >= 0.25  && s.glass <= 0.85))
  );
}

function sanitizeNotes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const page of Object.keys(raw)) {
    try {
      const url = new URL(page);
      if (!["http:", "https:", "file:"].includes(url.protocol)) continue;
    } catch { continue; }
    const pageNotes  = Array.isArray(raw[page]) ? raw[page] : [];
    const validNotes = pageNotes.filter(validateNote).map(n => ({
      id:    String(n.id),
      title: String(n.title).slice(0, 40),
      text:  String(n.text).slice(0, 50000),
      x: isFinite(n.x) ? Number(n.x) : 220,
      y: isFinite(n.y) ? Number(n.y) : 200,
      w: Math.max(260, Math.min(isFinite(n.w) ? Number(n.w) : 360, 2000)),
      h: Math.max(240, Math.min(isFinite(n.h) ? Number(n.h) : 380, 2000)),
      fixed: !!n.fixed,
      min:   !!n.min,
      z:     isFinite(n.z) ? Number(n.z) : 1000
    }));
    if (validNotes.length > 0) out[page] = validNotes;
  }
  return out;
}

/* ─────────── INIT ─────────── */

async function init() {
  try {
    const r = await chrome.storage.local.get(["notes", "noteSettings"]);
    notes = sanitizeNotes(r.notes);
    const loaded = r.noteSettings;
    if (loaded && validateSettings(loaded)) settings = { ...settings, ...loaded };
    tempSettings = { ...settings };
    Object.keys(notes).forEach(p =>
      (notes[p] || []).forEach(n => { if (n.z > maxZ) maxZ = n.z; })
    );
    currentTopZ = maxZ;
  } catch { notes = {}; }
  applySettings(settings);
  setupKeyboardShortcuts();
  chrome.runtime?.onMessage?.addListener(msg => {
    if (msg.type === "TOGGLE_PANEL") togglePanel();
  });
  renderNotes();
}

/* ─────────── KEYBOARD SHORTCUTS ─────────── */

function parseShortcut(str) {
  if (!str || typeof str !== "string") return null;
  const parts = str.toLowerCase().split("+").map(s => s.trim());
  const mods  = ["ctrl","shift","alt","meta","cmd","command","win"];
  const key   = parts.find(p => !mods.includes(p));
  return {
    ctrl:  parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt:   parts.includes("alt"),
    meta:  parts.some(p => ["meta","cmd","command","win"].includes(p)),
    key:   key ? key.toUpperCase() : null
  };
}

function matchesShortcut(e, shortcutStr) {
  const s = parseShortcut(shortcutStr);
  if (!s?.key) return false;
  const hasCtrl  = e.ctrlKey || e.metaKey;
  const needCtrl = s.ctrl || s.meta;
  return (hasCtrl === needCtrl) &&
         (e.shiftKey === s.shift) &&
         (e.altKey   === s.alt) &&
         (e.key.toUpperCase() === s.key);
}

function formatShortcut(str) {
  if (!str) return "";
  return str.split("+").map(p => {
    p = p.trim().toLowerCase();
    if (p === "ctrl")    return "Ctrl";
    if (p === "shift")   return "Shift";
    if (p === "alt")     return "Alt";
    if (p === "meta" || p === "cmd" || p === "command") return "⌘";
    return p.toUpperCase();
  }).join("+");
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (settings.shortcutPanel && matchesShortcut(e, settings.shortcutPanel)) {
      e.preventDefault();
      togglePanel();
    } else if (settings.shortcutNote && matchesShortcut(e, settings.shortcutNote)) {
      e.preventDefault();
      hidden = false;
      if (!panel) buildPanel();
      panel.style.display = "block";
      bringPanelToTop();
      createNote();
      showAll();
    }
  }, true);
}

/* ─────────── SAVE ─────────── */

async function save() {
  try {
    await chrome.storage.local.set({ notes });
  } catch (e) {
    if ((e?.message || "").match(/QUOTA_BYTES|quota/i))
      showToast("Storage almost full! Delete some notes.", "warn");
  }
}

/* ─────────── TOAST ─────────── */

function showToast(message, type = "info") {
  document.querySelector(".na-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "na-toast" + (type === "warn" ? " na-toast-warn" : "");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("na-toast-in"));
  setTimeout(() => {
    toast.classList.remove("na-toast-in");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ─────────── MODAL ─────────── */

function showModal(message, onConfirm, confirmLabel = "Delete") {
  const overlay = document.createElement("div");
  overlay.className = "na-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="na-modal">
      <p class="na-modal-msg"></p>
      <div class="na-modal-btns">
        <button class="na-modal-cancel">Cancel</button>
        <button class="na-modal-confirm"></button>
      </div>
    </div>
  `;
  overlay.querySelector(".na-modal-msg").textContent     = message;
  overlay.querySelector(".na-modal-confirm").textContent = confirmLabel;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("na-modal-in"));
  const close = () => { overlay.classList.remove("na-modal-in"); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector(".na-modal-cancel").onclick  = close;
  overlay.querySelector(".na-modal-confirm").onclick = () => { close(); onConfirm(); };
  overlay.onclick = e => { if (e.target === overlay) close(); };
  setTimeout(() => overlay.querySelector(".na-modal-confirm")?.focus(), 50);
}

/* ─────────── FONT HELPER ─────────── */

function getFontFamilyValue(key) {
  return key === "serif" ? "Georgia, Times, serif" :
         key === "mono"  ? "JetBrains Mono, Consolas, monospace" :
         key === "hand"  ? "'Comic Sans MS', cursive" :
                           "-apple-system, BlinkMacSystemFont, Inter, sans-serif";
}

/* ─────────── APPLY SETTINGS ─────────── */

function applySettings(s) {
  document.documentElement.setAttribute("data-na-theme", s.theme);
  document.documentElement.style.setProperty("--user-font-size",   s.fontSize + "px");
  document.documentElement.style.setProperty("--user-line-height", (s.fontSize * 1.55) + "px");
  document.documentElement.style.setProperty("--user-font-family", getFontFamilyValue(s.fontFamily));
  document.documentElement.style.setProperty("--glass", s.glass);
  if (s.customColor) {
    document.documentElement.style.setProperty("--na-custom-color", s.customColor);
    const hex = s.customColor.replace("#", "");
    const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    document.documentElement.style.setProperty("--na-custom-text",   lum < 0.45 ? "#f0f0f0" : "#111");
    document.documentElement.style.setProperty("--na-custom-sub",    lum < 0.45 ? "#ccc"    : "#555");
    document.documentElement.style.setProperty("--na-custom-border", lum < 0.45 ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.14)");
  }
  if (s.ruled) document.documentElement.setAttribute("data-na-ruled", "1");
  else         document.documentElement.removeAttribute("data-na-ruled");
}

function saveSettings() {
  settings = { ...tempSettings };
  chrome.storage.local.set({ noteSettings: settings });
  applySettings(settings);
  document.querySelectorAll(".na-note textarea").forEach(ta => {
    ta.style.fontSize   = settings.fontSize + "px";
    ta.style.lineHeight = (settings.fontSize * 1.55) + "px";
  });
}

/* ─────────── Z-INDEX ─────────── */

function normalizeZIndices() {
  const all = Object.values(notes).flat().sort((a, b) => a.z - b.z);
  all.forEach((n, i) => {
    n.z = 1000 + i;
    const el = document.querySelector(`[data-id="${n.id}"]`);
    if (el) el.style.zIndex = n.z;
  });
  currentTopZ = maxZ = 1000 + all.length;
}

function bringToFront(el, n) {
  currentTopZ++;
  if (currentTopZ > 2000000) normalizeZIndices();
  n.z = maxZ = currentTopZ;
  el.style.zIndex = n.z;
  save();
}

/* ─────────── PANEL ─────────── */

let panel = null;
let settingsPanel = null;
let helpPanel = null;

function togglePanel() {
  if (!panel) { buildPanel(); return; }
  const isVisible = panel.style.display !== "none";
  panel.style.display = isVisible ? "none" : "block";
  if (!isVisible) bringPanelToTop();
  refreshList();
  refreshPagesList();
}

function bringPanelToTop() {
  currentTopZ += 10;
  if (panel) panel.style.zIndex = currentTopZ;
}

function buildPanel() {
  panel = document.createElement("div");
  panel.id = "na-panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Notes — Anywhere");
  panel.innerHTML = `
    <div class="na-panel-header">
      <span>Notes — Anywhere</span>
      <button id="na-close" aria-label="Close panel">×</button>
    </div>
    <div class="na-buttons">
      <button id="add"    aria-label="Add a new note">+ Add Note</button>
      <button id="minall" aria-label="Minimize all notes">Minimize All</button>
      <button id="hide"   aria-label="Hide all notes">Hide All</button>
      <button id="del"    aria-label="Delete all notes on this page">Delete All</button>
    </div>
    <div class="na-section">
      <h3>Notes on this page</h3>
      <ul id="list" role="list"></ul>
    </div>
    <div class="na-section na-pages-section">
      <h3>Pages with notes</h3>
      <ul id="pages-list" role="list"></ul>
    </div>
    <div class="na-bottom-btns">
      <button id="na-settings-btn" aria-label="Open settings">⚙ Settings</button>
      <button id="na-help-btn"     aria-label="Help and feedback">? Help</button>
    </div>
  `;
  document.body.appendChild(panel);
  bringPanelToTop();
  panel.querySelector("#na-close").onclick        = () => (panel.style.display = "none");
  panel.querySelector("#add").onclick             = () => { hidden = false; createNote(); showAll(); };
  panel.querySelector("#hide").onclick            = toggleHide;
  panel.querySelector("#del").onclick             = deleteAll;
  panel.querySelector("#na-settings-btn").onclick = openSettings;
  panel.querySelector("#minall").onclick          = minimizeAll;
  panel.querySelector("#na-help-btn").onclick     = openHelp;
  refreshList();
  refreshPagesList();
}

/* ─────────── PAGES LIST ─────────── */

function refreshPagesList() {
  if (!panel) return;
  const ul = panel.querySelector("#pages-list");
  if (!ul) return;
  ul.innerHTML = "";
  const pages = Object.keys(notes).filter(p => notes[p]?.length > 0);
  if (!pages.length) {
    ul.innerHTML = '<li class="empty">No notes on any pages yet.</li>';
    return;
  }
  pages.forEach(page => {
    const li     = document.createElement("li");
    const count  = notes[page].length;
    const isCur  = page === PAGE;
    li.className = "page-item" + (isCur ? " current-page" : "");
    li.title     = isCur ? "Current page" : "Click to open this page";

    const pageUrl = document.createElement("div");
    pageUrl.className = "page-url";
    const urlSpan = document.createElement("span");
    urlSpan.textContent = page; urlSpan.title = page;
    const badge = document.createElement("span");
    badge.className = "page-badge"; badge.textContent = count;
    pageUrl.append(urlSpan, badge);

    const del = document.createElement("button");
    del.className = "page-delete"; del.textContent = "×";
    del.title = "Delete all notes from this page";
    del.setAttribute("aria-label", `Delete all notes from ${page}`);
    del.onclick = e => {
      e.stopPropagation();
      showModal(`Delete all ${count} note${count>1?"s":""} from this page?`, () => {
        delete notes[page]; save(); refreshPagesList();
        if (page === PAGE) { renderNotes(); refreshList(); }
      });
    };

    li.append(pageUrl, del);
    if (!isCur) {
      li.style.opacity = "0.7";
      li.setAttribute("role", "button"); li.setAttribute("tabindex", "0");
      li.onclick = () => {
        try {
          const url = new URL(page);
          if (["http:","https:","file:"].includes(url.protocol)) window.location.href = page;
        } catch {}
      };
      li.onkeydown = e => { if (e.key === "Enter" || e.key === " ") li.onclick(); };
    }
    ul.appendChild(li);
  });
}

/* ─────────── MINIMIZE ALL ─────────── */

function minimizeAll() {
  const pageNotes = notes[PAGE] || [];
  const allMin = pageNotes.every(n => n.min);
  pageNotes.forEach(n => {
    n.min = !allMin;
    document.querySelector(`[data-id="${n.id}"]`)?.classList.toggle("minimized", n.min);
  });
  save(); refreshList(); updateMinAllButton();
}

function updateMinAllButton() {
  if (!panel) return;
  const btn = panel.querySelector("#minall");
  if (!btn) return;
  const pn = notes[PAGE] || [];
  const allMin = pn.length > 0 && pn.every(n => n.min);
  btn.textContent = allMin ? "Maximize All" : "Minimize All";
}

/* ─────────── COLOUR UTILS ─────────── */

function isValidHex(hex) { return /^#[0-9a-fA-F]{6}$/.test(hex); }

function normalizeHex(str) {
  str = (str || "").trim();
  if (!str.startsWith("#")) str = "#" + str;
  if (/^#[0-9a-fA-F]{3}$/.test(str))
    str = "#" + str[1]+str[1]+str[2]+str[2]+str[3]+str[3];
  return isValidHex(str) ? str : null;
}

/* ─────────── SETTINGS PANEL ─────────── */

function openSettings() {
  if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; }
  tempSettings = { ...settings };

  settingsPanel = document.createElement("div");
  settingsPanel.className = "na-settings";
  settingsPanel.setAttribute("role", "dialog");
  settingsPanel.setAttribute("aria-modal", "true");
  settingsPanel.setAttribute("aria-label", "Settings");

  const spDisp = formatShortcut(settings.shortcutPanel);
  const snDisp = formatShortcut(settings.shortcutNote);
  const curColor = settings.customColor || "#ffe066";

  settingsPanel.innerHTML = `
    <div class="na-settings-box">
      <div class="s-header">
        <strong>Settings</strong>
        <button class="s-close" aria-label="Close settings">×</button>
      </div>

      <div class="s-block">
        <h3>Theme</h3>
        <div class="theme-grid">
          <div data-theme="light"  class="theme-card${settings.theme==="light"?" active":""}"  role="button" tabindex="0">
            <div class="theme-swatch swatch-light"></div><span>Light</span>
          </div>
          <div data-theme="dark"   class="theme-card${settings.theme==="dark"?" active":""}"   role="button" tabindex="0">
            <div class="theme-swatch swatch-dark"></div><span>Dark</span>
          </div>
          <div data-theme="glass"  class="theme-card${settings.theme==="glass"?" active":""}"  role="button" tabindex="0">
            <div class="theme-swatch swatch-glass"></div><span>Glass</span>
          </div>
          <div data-theme="custom" class="theme-card${settings.theme==="custom"?" active":""}" role="button" tabindex="0">
            <div class="theme-swatch swatch-custom" id="na-small-swatch" style="background:${curColor}"></div>
            <span>Custom</span>
          </div>
        </div>
      </div>

      <div class="s-block glassBlock" style="display:${settings.theme==="glass"?"block":"none"}">
        <h3>Glass Intensity</h3>
        <input type="range" min="0.25" max="0.85" step="0.02"
               value="${settings.glass}" class="glassRange" aria-label="Glass intensity"/>
      </div>

      <div class="s-block customColorBlock" style="display:${settings.theme==="custom"?"block":"none"}">
        <h3>Note Colour</h3>
        <div class="colour-picker-row">
          <div class="colour-swatch-btn" id="na-big-swatch" style="background:${curColor}"
               role="button" tabindex="0" aria-label="Click to open colour picker" title="Click to open colour picker">
            <input type="color" id="na-color-wheel" value="${curColor}" aria-hidden="true" tabindex="-1"/>
          </div>
          <input type="text" id="na-hex-input" class="na-hex-input"
                 value="${curColor}" placeholder="#ffe066" maxlength="7"
                 spellcheck="false" autocomplete="off" aria-label="Hex colour code"/>
        </div>
        <div class="colour-presets" role="group" aria-label="Colour presets">
          <button class="colour-preset" style="background:#ffe066" data-color="#ffe066" title="Yellow"  aria-label="Yellow"></button>
          <button class="colour-preset" style="background:#ffcdd2" data-color="#ffcdd2" title="Pink"    aria-label="Pink"></button>
          <button class="colour-preset" style="background:#c8e6c9" data-color="#c8e6c9" title="Green"   aria-label="Green"></button>
          <button class="colour-preset" style="background:#bbdefb" data-color="#bbdefb" title="Blue"    aria-label="Blue"></button>
          <button class="colour-preset" style="background:#e1bee7" data-color="#e1bee7" title="Purple"  aria-label="Purple"></button>
          <button class="colour-preset" style="background:#ffe0b2" data-color="#ffe0b2" title="Orange"  aria-label="Orange"></button>
          <button class="colour-preset" style="background:#f5f5f5" data-color="#f5f5f5" title="White"   aria-label="White"></button>
          <button class="colour-preset" style="background:#263238" data-color="#263238" title="Charcoal" aria-label="Charcoal"></button>
        </div>
      </div>

      <div class="s-block">
        <h3>Font</h3>
        <label class="s-range-label">Size: <span class="fontSizeLabel">${settings.fontSize}px</span></label>
        <input type="range" min="12" max="26" value="${settings.fontSize}" class="fontRange" aria-label="Font size"/>
        <select class="fontSelect" aria-label="Font family">
          <option value="sans">System (default)</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
          <option value="hand">Handwriting</option>
        </select>
        <div class="font-preview" id="na-font-preview">Aa The quick brown fox jumps</div>
      </div>

      <div class="s-block">
        <label class="ruled-row">
          <input type="checkbox" class="ruledCheck" aria-label="Show ruled lines"/>
          <span class="ruled-label">Notes with lines</span>
        </label>
      </div>

      <div class="s-block">
        <h3>Keyboard Shortcuts</h3>
        <p class="s-hint">Click a field, then press any key combination.</p>
        <div class="sc-row">
          <span class="sc-label">Open panel</span>
          <input type="text" class="shortcut-recorder" id="sc-panel"
                 value="${spDisp}" placeholder="e.g. Ctrl+Shift+N" readonly
                 aria-label="Shortcut to open/close panel"/>
        </div>
        <div class="sc-row">
          <span class="sc-label">New note</span>
          <input type="text" class="shortcut-recorder" id="sc-note"
                 value="${snDisp}" placeholder="e.g. Ctrl+Shift+M" readonly
                 aria-label="Shortcut to create a new note"/>
        </div>
      </div>

      <div class="s-block">
        <h3>Data</h3>
        <div class="data-btns">
          <button class="exportBtn" aria-label="Export notes as JSON">⬇ Export</button>
          <label class="importLabel" role="button" tabindex="0" aria-label="Import notes from JSON">
            ⬆ Import
            <input type="file" class="importInput" accept=".json" aria-hidden="true"/>
          </label>
        </div>
        <div class="storage-usage">
          <div class="storage-bar-track"><div class="storage-bar-fill" id="na-storage-fill"></div></div>
          <span class="storage-label" id="na-storage-label">Checking…</span>
        </div>
      </div>

      <button class="saveBtn">Save Changes</button>
      <button class="reset smallReset">Reset App</button>
    </div>
  `;

  document.body.appendChild(settingsPanel);
  bringPanelZ(settingsPanel);
  loadStorageUsage();

  /* Theme cards */
  settingsPanel.querySelectorAll(".theme-card").forEach(card => {
    const activate = () => {
      settingsPanel.querySelectorAll(".theme-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      tempSettings.theme = card.dataset.theme;
      settingsPanel.querySelector(".glassBlock").style.display       = tempSettings.theme === "glass"  ? "block" : "none";
      settingsPanel.querySelector(".customColorBlock").style.display = tempSettings.theme === "custom" ? "block" : "none";
      applySettings(tempSettings);
    };
    card.onclick   = activate;
    card.onkeydown = e => { if (e.key === "Enter" || e.key === " ") activate(); };
  });

  /* Glass slider */
  settingsPanel.querySelector(".glassRange").oninput = e => {
    tempSettings.glass = Number(e.target.value);
    applySettings(tempSettings);
  };

  /* Colour picker — swatch + wheel + hex input in sync */
  const bigSwatch  = settingsPanel.querySelector("#na-big-swatch");
  const colorWheel = settingsPanel.querySelector("#na-color-wheel");
  const hexInput   = settingsPanel.querySelector("#na-hex-input");
  const smallSwatch = settingsPanel.querySelector("#na-small-swatch");

  const applyColor = (hex) => {
    if (!isValidHex(hex)) return;
    tempSettings.customColor = hex;
    bigSwatch.style.background = hex;
    if (smallSwatch) smallSwatch.style.background = hex;
    if (colorWheel.value !== hex) colorWheel.value = hex;
    if (hexInput.value   !== hex) hexInput.value   = hex;
    applySettings(tempSettings);
  };

  bigSwatch.onclick  = () => colorWheel.click();
  bigSwatch.onkeydown = e => { if (e.key === "Enter" || e.key === " ") colorWheel.click(); };
  colorWheel.oninput = e => applyColor(e.target.value);

  hexInput.oninput = e => {
    const h = normalizeHex(e.target.value);
    if (h) applyColor(h);
  };
  hexInput.onblur = e => {
    const h = normalizeHex(e.target.value);
    hexInput.value = h || (tempSettings.customColor || "#ffe066");
    if (h) applyColor(h);
  };
  hexInput.onkeydown = e => { if (e.key === "Enter") hexInput.blur(); };

  settingsPanel.querySelectorAll(".colour-preset").forEach(btn => {
    btn.onclick = () => applyColor(btn.dataset.color);
  });

  /* Font controls */
  const preview       = settingsPanel.querySelector("#na-font-preview");
  const fontSizeLabel = settingsPanel.querySelector(".fontSizeLabel");
  preview.style.fontSize   = settings.fontSize + "px";
  preview.style.fontFamily = getFontFamilyValue(settings.fontFamily);

  settingsPanel.querySelector(".fontRange").oninput = e => {
    tempSettings.fontSize = Number(e.target.value);
    fontSizeLabel.textContent = tempSettings.fontSize + "px";
    preview.style.fontSize    = tempSettings.fontSize + "px";
    applySettings(tempSettings);
  };

  const fontSel = settingsPanel.querySelector(".fontSelect");
  fontSel.value = settings.fontFamily;
  fontSel.onchange = e => {
    tempSettings.fontFamily = e.target.value;
    preview.style.fontFamily = getFontFamilyValue(e.target.value);
    applySettings(tempSettings);
  };

  /* Ruled lines */
  const ruled = settingsPanel.querySelector(".ruledCheck");
  ruled.checked  = settings.ruled;
  ruled.onchange = e => { tempSettings.ruled = e.target.checked; applySettings(tempSettings); };

  /* Shortcut recorder */
  function attachRecorder(inputId, key) {
    const inp = settingsPanel.querySelector("#" + inputId);
    if (!inp) return;
    let recording = false;
    inp.onfocus = () => {
      recording = true;
      inp.value = "Press keys…";
      inp.classList.add("recording");
    };
    inp.onblur = () => {
      recording = false;
      inp.classList.remove("recording");
      if (inp.value === "Press keys…") inp.value = formatShortcut(tempSettings[key]) || "";
    };
    inp.onkeydown = e => {
      if (!recording) return;
      e.preventDefault();
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl"); // normalise Mac Cmd → Ctrl
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey)   parts.push("Alt");
      const k = e.key;
      if (!["Control","Shift","Alt","Meta"].includes(k)) {
        parts.push(k.length === 1 ? k.toUpperCase() : k);
        inp.value = parts.join("+");
        tempSettings[key] = parts.join("+");
        recording = false;
        inp.classList.remove("recording");
        inp.blur();
      }
    };
  }
  attachRecorder("sc-panel", "shortcutPanel");
  attachRecorder("sc-note",  "shortcutNote");

  /* Save / Close / Reset */
  const closeSettings = () => {
    applySettings(settings);
    settingsPanel.remove(); settingsPanel = null;
  };
  settingsPanel.querySelector(".s-close").onclick = closeSettings;
  settingsPanel.onclick = e => { if (e.target === settingsPanel) closeSettings(); };
  settingsPanel.querySelector(".saveBtn").onclick = () => {
    saveSettings();
    settingsPanel.remove(); settingsPanel = null;
    showToast("Settings saved!");
  };
  settingsPanel.querySelector(".reset").onclick = () => {
    showModal("Reset everything? This will delete all notes and settings.", () => {
      chrome.storage.local.clear(); location.reload();
    }, "Reset");
  };
  settingsPanel.querySelector(".exportBtn").onclick    = exportNotes;
  settingsPanel.querySelector(".importInput").onchange = importNotes;
}

function bringPanelZ(el) {
  currentTopZ += 10;
  el.style.zIndex = currentTopZ;
}

/* ─────────── STORAGE BAR ─────────── */

function loadStorageUsage() {
  if (!chrome.storage?.local?.getBytesInUse) return;
  chrome.storage.local.getBytesInUse(null, bytes => {
    const fill  = settingsPanel?.querySelector("#na-storage-fill");
    const label = settingsPanel?.querySelector("#na-storage-label");
    if (!fill || !label) return;
    const pct = Math.min(100, (bytes / (5 * 1024 * 1024)) * 100);
    fill.style.width      = pct + "%";
    fill.style.background = pct > 80 ? "#ff3b30" : pct > 60 ? "#f4bf4f" : "#28c940";
    label.textContent     = `${(bytes / 1024).toFixed(1)} KB of 5,120 KB`;
  });
}

/* ─────────── EXPORT / IMPORT ─────────── */

function exportNotes() {
  const data = { version: "1.0.0", exported: new Date().toISOString(), notes, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "notes-anywhere-backup.json" });
  a.click();
  URL.revokeObjectURL(url);
  showToast("Notes exported!");
}

function importNotes(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.notes || typeof data.notes !== "object") throw new Error("bad format");
      const imported = sanitizeNotes(data.notes);
      const count    = Object.keys(imported).length;
      if (!count) throw new Error("empty");
      showModal(`Import ${count} page${count>1?"s":""} of notes? They'll be merged with existing notes.`, () => {
        Object.keys(imported).forEach(page => {
          if (!notes[page]) notes[page] = [];
          const ids = new Set(notes[page].map(n => n.id));
          imported[page].forEach(n => { if (!ids.has(n.id)) notes[page].push(n); });
        });
        save(); renderNotes(); refreshList(); refreshPagesList();
        if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; }
        showToast("Notes imported!");
      }, "Import");
    } catch { showToast("Import failed — use a valid backup file.", "warn"); }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ─────────── HELP PANEL ─────────── */

function openHelp() {
  if (helpPanel) { helpPanel.remove(); helpPanel = null; }

  const sp = formatShortcut(settings.shortcutPanel) || "—";
  const sn = formatShortcut(settings.shortcutNote)  || "—";

  helpPanel = document.createElement("div");
  helpPanel.className = "na-settings";
  helpPanel.setAttribute("role", "dialog");
  helpPanel.setAttribute("aria-modal", "true");

  helpPanel.innerHTML = `
    <div class="na-settings-box na-help-box">
      <div class="s-header">
        <strong>Help &amp; Feedback</strong>
        <button class="s-close" aria-label="Close help">×</button>
      </div>
      <div class="help-tabs" role="tablist">
        <button class="help-tab active" data-tab="howto"    role="tab" aria-selected="true">How to use</button>
        <button class="help-tab"        data-tab="shortcuts" role="tab" aria-selected="false">Shortcuts</button>
        <button class="help-tab"        data-tab="feedback"  role="tab" aria-selected="false">Feedback</button>
      </div>

      <div class="help-panel active" id="ht-howto" role="tabpanel">
        <div class="help-tip">
          <div class="help-tip-icon">📋</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Open the panel</div>
            <div class="help-tip-desc">Click the toolbar icon or press <kbd>${sp}</kbd>. Change this in ⚙ Settings.</div>
          </div>
        </div>
        <div class="help-tip">
          <div class="help-tip-icon">✏️</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Create &amp; write</div>
            <div class="help-tip-desc">Click <strong>+ Add Note</strong> or press <kbd>${sn}</kbd>. The first line becomes the note title.</div>
          </div>
        </div>
        <div class="help-tip">
          <div class="help-tip-icon">🖱️</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Move &amp; resize</div>
            <div class="help-tip-desc">Drag by the header bar. Pull the <strong>◢</strong> corner to resize.</div>
          </div>
        </div>
        <div class="help-tip">
          <div class="help-tip-icon">📍</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Pin to viewport</div>
            <div class="help-tip-desc">Click the <span class="dot-green">●</span> green button to lock a note in place while scrolling.</div>
          </div>
        </div>
        <div class="help-tip">
          <div class="help-tip-icon">🎨</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Themes &amp; custom colour</div>
            <div class="help-tip-desc">In ⚙ Settings pick Light, Dark, Glass, or Custom. Custom lets you enter any hex code or use the colour picker.</div>
          </div>
        </div>
        <div class="help-tip">
          <div class="help-tip-icon">💾</div>
          <div class="help-tip-body">
            <div class="help-tip-title">Back up your notes</div>
            <div class="help-tip-desc">⚙ Settings → Export downloads a JSON backup. Use Import to restore anytime.</div>
          </div>
        </div>
      </div>

      <div class="help-panel" id="ht-shortcuts" role="tabpanel">
        <div class="shortcut-row"><span class="shortcut-desc">Open / close panel</span><kbd>${sp}</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">New note</span><kbd>${sn}</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Drag note</span><kbd>Drag header</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Resize note</span><kbd>Drag ◢ handle</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Pin / unpin</span><kbd>● Green dot</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Minimize</span><kbd>● Yellow dot</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Delete note</span><kbd>● Red dot</kbd></div>
        <div class="shortcut-row"><span class="shortcut-desc">Jump to note</span><kbd>Click list item</kbd></div>
        <div class="shortcut-note">
          Customise shortcuts in ⚙ Settings.<br>On Mac, <kbd>Ctrl</kbd> and <kbd>⌘</kbd> both work.
        </div>
      </div>

      <div class="help-panel" id="ht-feedback" role="tabpanel">
        <div class="feedback-hero">
          <div class="feedback-emoji">💬</div>
          <div class="feedback-title">We'd love to hear from you</div>
          <div class="feedback-desc">Found a bug? Have a feature idea? Your feedback shapes the next version.</div>
          <a class="feedback-btn" href="${FEEDBACK_URL}" target="_blank" rel="noopener noreferrer">
            Open Feedback Form ↗
          </a>
        </div>
        <div class="feedback-categories">
          <div class="feedback-cat">🐛<span>Bug report</span></div>
          <div class="feedback-cat">✨<span>Feature request</span></div>
          <div class="feedback-cat">⭐<span>General feedback</span></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(helpPanel);
  bringPanelZ(helpPanel);

  const closeHelp = () => { helpPanel.remove(); helpPanel = null; };
  helpPanel.querySelector(".s-close").onclick = closeHelp;
  helpPanel.onclick = e => { if (e.target === helpPanel) closeHelp(); };

  helpPanel.querySelectorAll(".help-tab").forEach(tab => {
    tab.onclick = () => {
      helpPanel.querySelectorAll(".help-tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected","false"); });
      helpPanel.querySelectorAll(".help-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active"); tab.setAttribute("aria-selected","true");
      helpPanel.querySelector("#ht-" + tab.dataset.tab).classList.add("active");
    };
  });
}

/* ─────────── CREATE NOTE ─────────── */

function createNote() {
  notes[PAGE] ??= [];
  const n = { id: crypto.randomUUID(), title: "New note", text: "",
    x: 220, y: 200, w: 360, h: 380, fixed: false, min: false, z: ++maxZ };
  currentTopZ = maxZ;
  notes[PAGE].push(n);
  save(); renderNote(n); refreshList(); refreshPagesList(); updateMinAllButton();
  setTimeout(() => document.querySelector(`[data-id="${n.id}"]`)?.querySelector("textarea")?.focus(), 100);
}

function renderNotes() {
  document.querySelectorAll(".na-note").forEach(e => e.remove());
  (notes[PAGE] || []).forEach(renderNote);
  updateMinAllButton();
}

function renderNote(n) {
  const el = document.createElement("div");
  el.className = "na-note";
  el.dataset.id = n.id;
  el.setAttribute("role", "note");
  el.setAttribute("aria-label", `Note: ${n.title}`);
  el.style.cssText = `position:${n.fixed?"fixed":"absolute"};left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;z-index:${n.z}`;
  if (n.min) el.classList.add("minimized");

  el.innerHTML = `
    <div class="na-header">
      <span class="na-title">${escapeHtml(n.title)}</span>
      <div class="na-controls">
        <button class="pin" title="${n.fixed?"Unpin":"Pin"}" aria-label="${n.fixed?"Unpin note":"Pin note to viewport"}"></button>
        <button class="min" title="${n.min?"Restore":"Minimize"}" aria-label="${n.min?"Restore note":"Minimize note"}"></button>
        <button class="cls" title="Delete" aria-label="Delete note"></button>
      </div>
    </div>
    <div class="na-body">
      <textarea placeholder="Start typing…" aria-label="Note content"></textarea>
      <div class="na-resize" aria-hidden="true"></div>
    </div>
  `;
  document.body.appendChild(el);

  const ta = el.querySelector("textarea");
  ta.value = n.text;
  ta.style.fontSize = settings.fontSize + "px";
  ta.style.lineHeight = (settings.fontSize * 1.55) + "px";

  ta.oninput = () => {
    n.text  = ta.value;
    n.title = ta.value.split("\n")[0].trim().slice(0,40) || "New note";
    el.querySelector(".na-title").textContent = n.title;
    el.setAttribute("aria-label", `Note: ${n.title}`);
    save(); refreshList();
  };

  const pin = el.querySelector(".pin");
  if (n.fixed) pin.classList.add("active");
  pin.onclick = () => {
    n.fixed = !n.fixed;
    if (n.fixed) {
      const r = el.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = (n.x = r.left) + "px";
      el.style.top  = (n.y = r.top)  + "px";
    } else {
      const r = el.getBoundingClientRect();
      el.style.position = "absolute";
      el.style.left = (n.x = r.left + window.pageXOffset) + "px";
      el.style.top  = (n.y = r.top  + window.pageYOffset) + "px";
    }
    pin.classList.toggle("active");
    pin.title = n.fixed ? "Unpin" : "Pin";
    pin.setAttribute("aria-label", n.fixed ? "Unpin note" : "Pin note to viewport");
    save(); bringToFront(el, n);
  };

  el.querySelector(".min").onclick = () => {
    n.min = !n.min;
    el.classList.toggle("minimized", n.min);
    const b = el.querySelector(".min");
    b.title = n.min ? "Restore" : "Minimize";
    b.setAttribute("aria-label", n.min ? "Restore note" : "Minimize note");
    save(); refreshList(); bringToFront(el, n); updateMinAllButton();
  };

  el.querySelector(".cls").onclick = () => {
    el.remove();
    notes[PAGE] = notes[PAGE].filter(x => x.id !== n.id);
    save(); refreshList(); refreshPagesList(); updateMinAllButton();
  };

  el.onmousedown = () => bringToFront(el, n);
  drag(el, n);
  resize(el, n, ta);
}

/* ─────────── DRAG ─────────── */

function drag(el, n) {
  const hdr = el.querySelector(".na-header");
  hdr.onmousedown = e => {
    if (e.target.closest(".na-controls")) return;
    e.preventDefault();
    document.body.style.userSelect = "none";
    hdr.style.cursor = "grabbing";
    bringToFront(el, n);
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;

    const onMove = m => {
      let l = m.clientX - dx, t = m.clientY - dy;
      if (n.fixed) {
        l = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  l));
        t = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, t));
      }
      el.style.left = l + "px"; el.style.top = t + "px";
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      hdr.style.cursor = "";
      if (n.fixed) { const r = el.getBoundingClientRect(); n.x = r.left; n.y = r.top; }
      else { n.x = el.offsetLeft; n.y = el.offsetTop; }
      save();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };
}

/* ─────────── RESIZE ─────────── */

function resize(el, n, ta) {
  el.querySelector(".na-resize").onmousedown = e => {
    e.stopPropagation();
    document.body.style.userSelect = "none";
    ta.style.pointerEvents = "none";
    const sw = el.offsetWidth, sh = el.offsetHeight, sx = e.clientX, sy = e.clientY;

    const onMove = m => {
      n.w = Math.max(260, Math.min(sw + m.clientX - sx, 2000));
      n.h = Math.max(240, Math.min(sh + m.clientY - sy, 2000));
      el.style.width = n.w + "px"; el.style.height = n.h + "px";
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      ta.style.pointerEvents = "";
      save();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };
}

/* ─────────── LIST ─────────── */

function refreshList() {
  if (!panel) return;
  const ul = panel.querySelector("#list");
  ul.innerHTML = "";
  const pn = notes[PAGE] || [];
  if (!pn.length) {
    ul.innerHTML = '<li class="empty">No notes yet — click "+ Add Note".</li>';
    return;
  }
  pn.forEach(n => {
    const li  = document.createElement("li");
    const ttl = document.createElement("span");
    ttl.className = "note-title"; ttl.textContent = n.title;
    const del = document.createElement("button");
    del.className = "note-delete"; del.textContent = "×";
    del.title = "Delete note";
    del.setAttribute("aria-label", `Delete: ${n.title}`);
    del.onclick = e => {
      e.stopPropagation();
      document.querySelector(`[data-id="${n.id}"]`)?.remove();
      notes[PAGE] = notes[PAGE].filter(x => x.id !== n.id);
      save(); refreshList(); refreshPagesList(); updateMinAllButton();
    };
    const ctrl = document.createElement("div");
    ctrl.className = "note-controls"; ctrl.appendChild(del);
    li.append(ttl, ctrl);
    li.onclick = () => {
      if (hidden) { hidden = false; showAll(); }
      const el = document.querySelector(`[data-id="${n.id}"]`);
      if (!el) return;
      if (n.min) { n.min = false; el.classList.remove("minimized"); save(); refreshList(); updateMinAllButton(); }
      bringToFront(el, n);
      el.classList.add("highlight");
      setTimeout(() => el?.classList.remove("highlight"), 600);
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth)
        el.scrollIntoView({ behavior:"smooth", block:"center" });
    };
    ul.appendChild(li);
  });
}

function toggleHide() {
  hidden = !hidden;
  const btn = panel?.querySelector("#hide");
  if (btn) btn.textContent = hidden ? "Show All" : "Hide All";
  hidden ? hideAll() : showAll();
}
function hideAll() { document.querySelectorAll(".na-note").forEach(n => (n.style.display = "none")); }
function showAll() { document.querySelectorAll(".na-note").forEach(n => (n.style.display = ""));    }

function deleteAll() {
  const count = (notes[PAGE] || []).length;
  if (!count) return;
  showModal(`Delete all ${count} note${count>1?"s":""} on this page? Cannot be undone.`, () => {
    document.querySelectorAll(".na-note").forEach(n => n.remove());
    delete notes[PAGE];
    save(); refreshList(); refreshPagesList(); updateMinAllButton();
  });
}

/* ─────────── UTILITIES ─────────── */

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, m =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[m]
  );
}

})();
