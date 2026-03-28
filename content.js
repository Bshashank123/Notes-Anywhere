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

const NOTE_COLOURS = [
  { hex: null,      label: "Default"  },
  { hex: "#fef9c3", label: "Lemon"    },
  { hex: "#fce7f3", label: "Rose"     },
  { hex: "#dcfce7", label: "Mint"     },
  { hex: "#dbeafe", label: "Sky"      },
  { hex: "#ede9fe", label: "Lavender" },
  { hex: "#ffedd5", label: "Peach"    },
  { hex: "#f0fdf4", label: "Sage"     },
  { hex: "#fdf4ff", label: "Lilac"    },
];

let notes    = {};
let settings = {
  theme: "light", fontSize: 16, fontFamily: "sans",
  ruled: false, glass: 0.45, customColor: "#fef9c3",
  shortcutPanel: "Ctrl+Shift+N", shortcutNote: "Ctrl+Shift+M",
};
let tempSettings = { ...settings };
let hidden = false;
let maxZ = 1000;
let currentTopZ = 1000;
let searchQuery = "";

init();

/* ─── VALIDATION ─── */

function validateNote(n) {
  return n && typeof n.id === "string" && n.id.length > 0 &&
    typeof n.text === "string" && typeof n.title === "string" &&
    typeof n.x === "number" && typeof n.y === "number" &&
    typeof n.w === "number" && typeof n.h === "number";
}

function validateSettings(s) {
  if (!s || typeof s !== "object") return false;
  const vt = ["light","dark","glass","custom","sticky"];
  const vf = ["sans","inter","nunito","lora","merriweather","serif","mono","hand"];
  return (!s.theme || vt.includes(s.theme)) &&
         (!s.fontFamily || vf.includes(s.fontFamily)) &&
         (!s.fontSize || (typeof s.fontSize === "number" && s.fontSize >= 12 && s.fontSize <= 26)) &&
         (!s.glass    || (typeof s.glass    === "number" && s.glass >= 0.25  && s.glass <= 0.85));
}

function sanitizeNotes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const page of Object.keys(raw)) {
    try { const u = new URL(page); if (!["http:","https:","file:"].includes(u.protocol)) continue; }
    catch { continue; }
    const valid = (Array.isArray(raw[page]) ? raw[page] : []).filter(validateNote).map(n => ({
      id:    String(n.id), title: String(n.title).slice(0,40), text: String(n.text).slice(0,50000),
      x: isFinite(n.x)?Number(n.x):220, y: isFinite(n.y)?Number(n.y):200,
      w: Math.max(260,Math.min(isFinite(n.w)?Number(n.w):360,2000)),
      h: Math.max(240,Math.min(isFinite(n.h)?Number(n.h):380,2000)),
      fixed: !!n.fixed, min: !!n.min, z: isFinite(n.z)?Number(n.z):1000,
      color: typeof n.color === "string" ? n.color : null,
      tags:  Array.isArray(n.tags) ? n.tags.map(t=>String(t).slice(0,20)).slice(0,5) : [],
      markdown: !!n.markdown,
    }));
    if (valid.length) out[page] = valid;
  }
  return out;
}

/* ─── INIT ─── */

async function init() {
  try {
    const r = await chrome.storage.local.get(["notes","noteSettings"]);
    notes = sanitizeNotes(r.notes);
    const loaded = r.noteSettings;
    if (loaded && validateSettings(loaded)) settings = { ...settings, ...loaded };
    tempSettings = { ...settings };
    Object.keys(notes).forEach(p => (notes[p]||[]).forEach(n => { if (n.z > maxZ) maxZ = n.z; }));
    currentTopZ = maxZ;
  } catch { notes = {}; }
  applySettings(settings);
  setupKeyboardShortcuts();
  chrome.runtime?.onMessage?.addListener(msg => { if (msg.type === "TOGGLE_PANEL") togglePanel(); });
  renderNotes();
}

/* ─── SHORTCUTS ─── */

function parseShortcut(str) {
  if (!str) return null;
  const parts = str.toLowerCase().split("+").map(s => s.trim());
  const mods = ["ctrl","shift","alt","meta","cmd","command","win"];
  const key  = parts.find(p => !mods.includes(p));
  return { ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt"),
           meta: parts.some(p=>["meta","cmd","command","win"].includes(p)), key: key?key.toUpperCase():null };
}

function matchesShortcut(e, str) {
  const s = parseShortcut(str);
  if (!s?.key) return false;
  return ((e.ctrlKey||e.metaKey) === (s.ctrl||s.meta)) &&
         (e.shiftKey === s.shift) && (e.altKey === s.alt) &&
         (e.key.toUpperCase() === s.key);
}

function formatShortcut(str) {
  if (!str) return "";
  return str.split("+").map(p => {
    p = p.trim().toLowerCase();
    if (p==="ctrl") return "Ctrl"; if (p==="shift") return "Shift"; if (p==="alt") return "Alt";
    if (["meta","cmd","command"].includes(p)) return "⌘";
    return p.toUpperCase();
  }).join("+");
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if (tag==="TEXTAREA"||tag==="INPUT") return;
    if (settings.shortcutPanel && matchesShortcut(e, settings.shortcutPanel)) {
      e.preventDefault(); togglePanel();
    } else if (settings.shortcutNote && matchesShortcut(e, settings.shortcutNote)) {
      e.preventDefault(); hidden=false;
      if (!panel) buildPanel();
      panel.style.display = "block"; bringPanelToTop(); createNote(); showAll();
    }
  }, true);
}

/* ─── SAVE ─── */

async function save() {
  try { await chrome.storage.local.set({ notes }); }
  catch (e) { if ((e?.message||"").match(/QUOTA_BYTES|quota/i)) showToast("Storage almost full!","warn"); }
}

/* ─── TOAST ─── */

function showToast(msg, type="info") {
  document.querySelector(".na-toast")?.remove();
  const t = document.createElement("div");
  t.className = "na-toast" + (type==="warn"?" na-toast-warn":"");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("na-toast-in"));
  setTimeout(() => { t.classList.remove("na-toast-in"); setTimeout(()=>t.remove(),300); }, 3500);
}

/* ─── MODAL ─── */

function showModal(msg, onConfirm, confirmLabel="Delete") {
  const ov = document.createElement("div");
  ov.className = "na-modal-overlay";
  ov.setAttribute("role","dialog"); ov.setAttribute("aria-modal","true");
  ov.innerHTML = `<div class="na-modal"><p class="na-modal-msg"></p>
    <div class="na-modal-btns"><button class="na-modal-cancel">Cancel</button>
    <button class="na-modal-confirm"></button></div></div>`;
  ov.querySelector(".na-modal-msg").textContent = msg;
  ov.querySelector(".na-modal-confirm").textContent = confirmLabel;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add("na-modal-in"));
  const close = () => { ov.classList.remove("na-modal-in"); setTimeout(()=>ov.remove(),200); };
  ov.querySelector(".na-modal-cancel").onclick = close;
  ov.querySelector(".na-modal-confirm").onclick = () => { close(); onConfirm(); };
  ov.onclick = e => { if (e.target===ov) close(); };
  setTimeout(()=>ov.querySelector(".na-modal-confirm")?.focus(),50);
}

/* ─── HELPERS ─── */

function getFontFamilyValue(key) {
  return key==="nunito"       ? '"Nunito", -apple-system, sans-serif' :
         key==="lora"         ? '"Lora", Georgia, serif' :
         key==="merriweather" ? '"Merriweather", Georgia, serif' :
         key==="serif"        ? 'Georgia, "Times New Roman", serif' :
         key==="mono"         ? '"JetBrains Mono", Consolas, "Courier New", monospace' :
         key==="hand"         ? '"Caveat", "Comic Sans MS", cursive' :
                                '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';
}

function isValidHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h); }

function normalizeHex(str) {
  str = (str||"").trim();
  if (!str.startsWith("#")) str="#"+str;
  if (/^#[0-9a-fA-F]{3}$/.test(str)) str="#"+str[1]+str[1]+str[2]+str[2]+str[3]+str[3];
  return isValidHex(str)?str:null;
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[m]);
}

/* ─── APPLY SETTINGS ─── */

function applySettings(s) {
  document.documentElement.setAttribute("data-na-theme", s.theme);
  document.documentElement.style.setProperty("--user-font-size",   s.fontSize+"px");
  document.documentElement.style.setProperty("--user-line-height", (s.fontSize*1.55)+"px");
  document.documentElement.style.setProperty("--user-font-family", getFontFamilyValue(s.fontFamily));
  document.documentElement.style.setProperty("--glass", s.glass);
  if (s.customColor) {
    document.documentElement.style.setProperty("--na-custom-color", s.customColor);
    const hex=s.customColor.replace("#","");
    const r=parseInt(hex.substr(0,2),16),g=parseInt(hex.substr(2,2),16),b=parseInt(hex.substr(4,2),16);
    const lum=(0.299*r+0.587*g+0.114*b)/255;
    document.documentElement.style.setProperty("--na-custom-text",   lum<0.45?"#f0f0f0":"#111");
    document.documentElement.style.setProperty("--na-custom-sub",    lum<0.45?"#ccc":"#555");
    document.documentElement.style.setProperty("--na-custom-border", lum<0.45?"rgba(255,255,255,.22)":"rgba(0,0,0,.14)");
  }
  if (s.ruled) document.documentElement.setAttribute("data-na-ruled","1");
  else         document.documentElement.removeAttribute("data-na-ruled");
}

function saveSettings() {
  settings = { ...tempSettings };
  chrome.storage.local.set({ noteSettings: settings });
  applySettings(settings);
  document.querySelectorAll(".na-note textarea").forEach(ta => {
    ta.style.fontSize = settings.fontSize+"px";
    ta.style.lineHeight = (settings.fontSize*1.55)+"px";
  });
}

/* ─── Z-INDEX ─── */

function normalizeZIndices() {
  const all = Object.values(notes).flat().sort((a,b)=>a.z-b.z);
  all.forEach((n,i) => { n.z=1000+i; const el=document.querySelector(`[data-id="${n.id}"]`); if(el) el.style.zIndex=n.z; });
  currentTopZ=maxZ=1000+all.length;
}

function bringToFront(el, n) {
  currentTopZ++; if (currentTopZ>2000000) normalizeZIndices();
  n.z=maxZ=currentTopZ; el.style.zIndex=n.z; save();
}

/* ─── NOTE COLOUR ─── */

function applyNoteColor(el, n) {
  const hex = n.color;
  if (!hex || !isValidHex(hex)) {
    el.style.removeProperty("--note-bg-override");
    el.style.removeProperty("--note-text-override");
    el.style.removeProperty("--note-sub-override");
    el.style.removeProperty("--note-border-override");
    el.removeAttribute("data-note-color");
    return;
  }
  const r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16);
  const lum=(0.299*r+0.587*g+0.114*b)/255;
  el.style.setProperty("--note-bg-override",     hex);
  el.style.setProperty("--note-text-override",   lum<0.4?"#f0f0f0":"#111");
  el.style.setProperty("--note-sub-override",    lum<0.4?"#ccc":"#555");
  el.style.setProperty("--note-border-override", lum<0.4?"rgba(255,255,255,.2)":"rgba(0,0,0,.12)");
  el.setAttribute("data-note-color","1");
}

function updateDotColor(dotBtn, n) {
  if (n.color && isValidHex(n.color)) {
    dotBtn.style.background = n.color;
    dotBtn.style.boxShadow  = "0 0 0 2px rgba(0,0,0,.18)";
  } else {
    dotBtn.style.background = "";
    dotBtn.style.boxShadow  = "";
  }
}

function openNoteColorPicker(el, n, dotBtn) {
  document.querySelector(".na-note-color-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "na-note-color-popup";
  NOTE_COLOURS.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "na-ncp-swatch";
    btn.title = c.label;
    btn.setAttribute("aria-label", c.label);
    btn.style.background = c.hex || "transparent";
    if (!c.hex) { btn.classList.add("na-ncp-clear"); btn.textContent = "✕"; }
    if (n.color === c.hex) btn.classList.add("active");
    btn.onclick = e => {
      e.stopPropagation();
      n.color = c.hex;
      applyNoteColor(el, n);
      updateDotColor(dotBtn, n);
      save(); popup.remove();
    };
    popup.appendChild(btn);
  });
  document.body.appendChild(popup);
  const rect = dotBtn.getBoundingClientRect();
  const pw   = popup.offsetWidth || 210;
  popup.style.top  = (rect.bottom + 6) + "px";
  popup.style.left = Math.max(4, rect.left - pw/2 + dotBtn.offsetWidth/2) + "px";
  bringPanelZ(popup);
  const close = e => { if (!popup.contains(e.target)&&e.target!==dotBtn) { popup.remove(); document.removeEventListener("mousedown",close); } };
  setTimeout(()=>document.addEventListener("mousedown",close),0);
}

/* ─── MARKDOWN ─── */

function renderMarkdown(text) {
  let h = escapeHtml(text);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/__(.+?)__/g,     "<strong>$1</strong>");
  h = h.replace(/\*(.+?)\*/g,     "<em>$1</em>");
  h = h.replace(/_(.+?)_/g,       "<em>$1</em>");
  h = h.replace(/~~(.+?)~~/g,     "<del>$1</del>");
  h = h.replace(/`([^`]+)`/g,     "<code>$1</code>");
  h = h.replace(/^### (.+)$/gm,   "<h3>$1</h3>");
  h = h.replace(/^## (.+)$/gm,    "<h2>$1</h2>");
  h = h.replace(/^# (.+)$/gm,     "<h1>$1</h1>");
  h = h.replace(/^[*\-+] (.+)$/gm,"<li>$1</li>");
  h = h.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  h = h.replace(/(<li>.*<\/li>\n?)+/g, m => "<ul>"+m+"</ul>");
  h = h.replace(/^---$/gm,        "<hr>");
  h = h.replace(/\n/g,            "<br>");
  return h;
}

/* ─── PANEL ─── */

let panel = null, settingsPanel = null, helpPanel = null;

function togglePanel() {
  if (!panel) { buildPanel(); return; }
  const vis = panel.style.display !== "none";
  panel.style.display = vis ? "none" : "block";
  if (!vis) bringPanelToTop();
  refreshList(); refreshPagesList();
}

function bringPanelToTop() { currentTopZ+=10; if(panel) panel.style.zIndex=currentTopZ; }

function buildPanel() {
  panel = document.createElement("div");
  panel.id = "na-panel";
  panel.setAttribute("role","complementary");
  panel.setAttribute("aria-label","Notes — Anywhere");
  panel.innerHTML = `
    <div class="na-panel-header"><span>Notes — Anywhere</span>
      <button id="na-close" aria-label="Close panel">×</button></div>
    <div class="na-search-wrap">
      <input id="na-search" type="text" placeholder="🔍 Search notes…"
        autocomplete="off" spellcheck="false" aria-label="Search notes"/>
    </div>
    <div class="na-buttons">
      <button id="add"    aria-label="Add a new note">+ Add Note</button>
      <button id="minall" aria-label="Minimize all notes">Minimize All</button>
      <button id="hide"   aria-label="Hide all notes">Hide All</button>
      <button id="del"    aria-label="Delete all notes on this page">Delete All</button>
    </div>
    <div class="na-section"><h3>Notes on this page</h3><ul id="list" role="list"></ul></div>
    <div class="na-section na-pages-section"><h3>Pages with notes</h3><ul id="pages-list" role="list"></ul></div>
    <div class="na-bottom-btns">
      <button id="na-settings-btn" aria-label="Open settings">⚙ Settings</button>
      <button id="na-help-btn"     aria-label="Help and feedback">? Help</button>
    </div>`;
  document.body.appendChild(panel);
  bringPanelToTop();
  panel.querySelector("#na-close").onclick        = () => (panel.style.display="none");
  panel.querySelector("#add").onclick             = () => { hidden=false; createNote(); showAll(); };
  panel.querySelector("#hide").onclick            = toggleHide;
  panel.querySelector("#del").onclick             = deleteAll;
  panel.querySelector("#na-settings-btn").onclick = openSettings;
  panel.querySelector("#minall").onclick          = minimizeAll;
  panel.querySelector("#na-help-btn").onclick     = openHelp;
  const si = panel.querySelector("#na-search");
  si.value = searchQuery;
  si.oninput = e => { searchQuery=e.target.value.trim().toLowerCase(); refreshList(); filterNotesOnPage(); };
  refreshList(); refreshPagesList();
}

/* ─── SEARCH ─── */

function filterNotesOnPage() {
  document.querySelectorAll(".na-note").forEach(el => {
    if (!searchQuery) { el.style.display=""; return; }
    const n = (notes[PAGE]||[]).find(x=>x.id===el.dataset.id);
    const ok = n && (n.title.toLowerCase().includes(searchQuery)||n.text.toLowerCase().includes(searchQuery)||(n.tags||[]).some(t=>t.toLowerCase().includes(searchQuery)));
    el.style.display = ok?"":"none";
  });
}

/* ─── PAGES LIST ─── */

function refreshPagesList() {
  if (!panel) return;
  const ul = panel.querySelector("#pages-list");
  if (!ul) return;
  ul.innerHTML = "";
  const pages = Object.keys(notes).filter(p=>notes[p]?.length>0);
  if (!pages.length) { ul.innerHTML='<li class="empty">No notes on any pages yet.</li>'; return; }
  pages.forEach(page => {
    const count=notes[page].length, isCur=page===PAGE;
    const li=document.createElement("li");
    li.className="page-item"+(isCur?" current-page":"");
    li.title=isCur?"Current page":"Click to open in a new tab";
    const pu=document.createElement("div"); pu.className="page-url";
    const us=document.createElement("span"); us.textContent=page; us.title=page;
    const badge=document.createElement("span"); badge.className="page-badge"; badge.textContent=count;
    pu.append(us,badge);
    const del=document.createElement("button"); del.className="page-delete"; del.textContent="×";
    del.title="Delete all notes from this page";
    del.setAttribute("aria-label",`Delete all notes from ${page}`);
    del.onclick=e=>{e.stopPropagation();showModal(`Delete all ${count} note${count>1?"s":""} from this page?`,()=>{delete notes[page];save();refreshPagesList();if(page===PAGE){renderNotes();refreshList();}});};
    li.append(pu,del);
    if (!isCur) {
      li.style.opacity="0.7"; li.setAttribute("role","button"); li.setAttribute("tabindex","0");
      li.onclick=()=>{try{const u=new URL(page);if(["http:","https:","file:"].includes(u.protocol))window.open(page,"_blank","noopener,noreferrer");}catch{}};
      li.onkeydown=e=>{if(e.key==="Enter"||e.key===" ")li.onclick();};
    }
    ul.appendChild(li);
  });
}

/* ─── MINIMIZE ALL ─── */

function minimizeAll() {
  const pn=notes[PAGE]||[], allMin=pn.every(n=>n.min);
  pn.forEach(n=>{n.min=!allMin;document.querySelector(`[data-id="${n.id}"]`)?.classList.toggle("minimized",n.min);});
  save();refreshList();updateMinAllButton();
}

function updateMinAllButton() {
  if (!panel) return;
  const btn=panel.querySelector("#minall"); if(!btn) return;
  const pn=notes[PAGE]||[];
  btn.textContent=(pn.length>0&&pn.every(n=>n.min))?"Maximize All":"Minimize All";
}

/* ─── SETTINGS ─── */

function openSettings() {
  if (settingsPanel) { settingsPanel.remove(); settingsPanel=null; }
  tempSettings={...settings};
  settingsPanel=document.createElement("div");
  settingsPanel.className="na-settings";
  settingsPanel.setAttribute("role","dialog"); settingsPanel.setAttribute("aria-modal","true");
  const curColor=settings.customColor||"#ffe066";
  const spDisp=formatShortcut(settings.shortcutPanel), snDisp=formatShortcut(settings.shortcutNote);

  settingsPanel.innerHTML=`
    <div class="na-settings-box">
      <div class="s-header"><strong>Settings</strong><button class="s-close" aria-label="Close settings">×</button></div>
      <div class="s-block"><h3>Theme</h3><div class="theme-grid">
        <div data-theme="light"  class="theme-card${settings.theme==="light"?" active":""}"  role="button" tabindex="0"><div class="theme-swatch swatch-light"></div><span>Light</span></div>
        <div data-theme="dark"   class="theme-card${settings.theme==="dark"?" active":""}"   role="button" tabindex="0"><div class="theme-swatch swatch-dark"></div><span>Dark</span></div>
        <div data-theme="glass"  class="theme-card${settings.theme==="glass"?" active":""}"  role="button" tabindex="0"><div class="theme-swatch swatch-glass"></div><span>Glass</span></div>
        <div data-theme="custom" class="theme-card${settings.theme==="custom"?" active":""}" role="button" tabindex="0"><div class="theme-swatch swatch-custom" id="na-small-swatch" style="background:${curColor}"></div><span>Custom</span></div>
      </div></div>
      <div class="s-block glassBlock" style="display:${settings.theme==="glass"?"block":"none"}">
        <h3>Glass Intensity</h3>
        <input type="range" min="0.25" max="0.85" step="0.02" value="${settings.glass}" class="glassRange"/>
      </div>
      <div class="s-block customColorBlock" style="display:${settings.theme==="custom"?"block":"none"}">
        <h3>Note Colour</h3>
        <div class="colour-picker-row">
          <div class="colour-swatch-btn" id="na-big-swatch" style="background:${curColor}" role="button" tabindex="0">
            <input type="color" id="na-color-wheel" value="${curColor}" aria-hidden="true" tabindex="-1"/>
          </div>
          <input type="text" id="na-hex-input" class="na-hex-input" value="${curColor}" placeholder="#ffe066" maxlength="7" spellcheck="false" autocomplete="off"/>
        </div>
        <div class="colour-presets">
          ${["#fef9c3","#fce7f3","#dcfce7","#dbeafe","#ede9fe","#ffedd5","#f0fdf4","#fdf4ff"].map(c=>`<button class="colour-preset" style="background:${c}" data-color="${c}"></button>`).join("")}
        </div>
      </div>
      <div class="s-block"><h3>Font</h3>
        <label class="s-range-label">Size: <span class="fontSizeLabel">${settings.fontSize}px</span></label>
        <input type="range" min="12" max="26" value="${settings.fontSize}" class="fontRange"/>
        <select class="fontSelect">
          <option value="sans">Inter (default)</option>
          <option value="nunito">Nunito — rounded</option>
          <option value="lora">Lora — elegant serif</option>
          <option value="merriweather">Merriweather — editorial</option>
          <option value="serif">Georgia — classic serif</option>
          <option value="mono">JetBrains Mono — code</option>
          <option value="hand">Caveat — handwritten</option>
        </select>
        <div class="font-preview" id="na-font-preview">Aa The quick brown fox jumps</div>
      </div>
      <div class="s-block"><label class="ruled-row">
        <input type="checkbox" class="ruledCheck"/><span class="ruled-label">Notes with lines</span>
      </label></div>
      <div class="s-block"><h3>Keyboard Shortcuts</h3>
        <p class="s-hint">Click a field, then press any key combination.</p>
        <div class="sc-row"><span class="sc-label">Open panel</span>
          <input type="text" class="shortcut-recorder" id="sc-panel" value="${spDisp}" placeholder="e.g. Ctrl+Shift+N" readonly/></div>
        <div class="sc-row"><span class="sc-label">New note</span>
          <input type="text" class="shortcut-recorder" id="sc-note" value="${snDisp}" placeholder="e.g. Ctrl+Shift+M" readonly/></div>
      </div>
      <div class="s-block"><h3>Data</h3>
        <div class="data-btns">
          <button class="exportBtn">⬇ Export</button>
          <label class="importLabel" role="button" tabindex="0">⬆ Import<input type="file" class="importInput" accept=".json"/></label>
        </div>
        <div class="storage-usage">
          <div class="storage-bar-track"><div class="storage-bar-fill" id="na-storage-fill"></div></div>
          <span class="storage-label" id="na-storage-label">Checking…</span>
        </div>
      </div>
      <button class="saveBtn">Save Changes</button>
      <button class="reset smallReset">Reset App</button>
    </div>`;

  document.body.appendChild(settingsPanel);
  bringPanelZ(settingsPanel);
  loadStorageUsage();

  settingsPanel.querySelectorAll(".theme-card").forEach(card=>{
    const go=()=>{
      settingsPanel.querySelectorAll(".theme-card").forEach(c=>c.classList.remove("active"));
      card.classList.add("active"); tempSettings.theme=card.dataset.theme;
      settingsPanel.querySelector(".glassBlock").style.display       = tempSettings.theme==="glass" ?"block":"none";
      settingsPanel.querySelector(".customColorBlock").style.display = tempSettings.theme==="custom"?"block":"none";
      applySettings(tempSettings);
    };
    card.onclick=go; card.onkeydown=e=>{if(e.key==="Enter"||e.key===" ")go();};
  });

  settingsPanel.querySelector(".glassRange").oninput=e=>{tempSettings.glass=Number(e.target.value);applySettings(tempSettings);};

  const bs=settingsPanel.querySelector("#na-big-swatch"), cw=settingsPanel.querySelector("#na-color-wheel");
  const hi=settingsPanel.querySelector("#na-hex-input"), ss=settingsPanel.querySelector("#na-small-swatch");
  const apC=hex=>{
    if(!isValidHex(hex))return; tempSettings.customColor=hex;
    bs.style.background=hex; if(ss)ss.style.background=hex;
    if(cw.value!==hex)cw.value=hex; if(hi.value!==hex)hi.value=hex;
    applySettings(tempSettings);
  };
  bs.onclick=()=>cw.click(); bs.onkeydown=e=>{if(e.key==="Enter"||e.key===" ")cw.click();};
  cw.oninput=e=>apC(e.target.value);
  hi.oninput=e=>{const h=normalizeHex(e.target.value);if(h)apC(h);};
  hi.onblur=e=>{const h=normalizeHex(e.target.value);hi.value=h||(tempSettings.customColor||"#ffe066");if(h)apC(h);};
  hi.onkeydown=e=>{if(e.key==="Enter")hi.blur();};
  settingsPanel.querySelectorAll(".colour-preset").forEach(b=>{b.onclick=()=>apC(b.dataset.color);});

  const prev=settingsPanel.querySelector("#na-font-preview"), fsl=settingsPanel.querySelector(".fontSizeLabel");
  prev.style.fontSize=settings.fontSize+"px"; prev.style.fontFamily=getFontFamilyValue(settings.fontFamily);
  settingsPanel.querySelector(".fontRange").oninput=e=>{
    tempSettings.fontSize=Number(e.target.value); fsl.textContent=tempSettings.fontSize+"px";
    prev.style.fontSize=tempSettings.fontSize+"px"; applySettings(tempSettings);
  };
  const fs=settingsPanel.querySelector(".fontSelect"); fs.value=settings.fontFamily;
  fs.onchange=e=>{tempSettings.fontFamily=e.target.value;prev.style.fontFamily=getFontFamilyValue(e.target.value);applySettings(tempSettings);};
  const ruled=settingsPanel.querySelector(".ruledCheck"); ruled.checked=settings.ruled;
  ruled.onchange=e=>{tempSettings.ruled=e.target.checked;applySettings(tempSettings);};

  function attachRecorder(id,key){
    const inp=settingsPanel.querySelector("#"+id); if(!inp)return; let rec=false;
    inp.onfocus=()=>{rec=true;inp.value="Press keys…";inp.classList.add("recording");};
    inp.onblur =()=>{rec=false;inp.classList.remove("recording");if(inp.value==="Press keys…")inp.value=formatShortcut(tempSettings[key])||"";};
    inp.onkeydown=e=>{if(!rec)return;e.preventDefault();const pts=[];
      if(e.ctrlKey||e.metaKey)pts.push("Ctrl");if(e.shiftKey)pts.push("Shift");if(e.altKey)pts.push("Alt");
      const k=e.key;if(!["Control","Shift","Alt","Meta"].includes(k)){pts.push(k.length===1?k.toUpperCase():k);
        inp.value=pts.join("+");tempSettings[key]=pts.join("+");rec=false;inp.classList.remove("recording");inp.blur();}};
  }
  attachRecorder("sc-panel","shortcutPanel"); attachRecorder("sc-note","shortcutNote");

  const closeS=()=>{applySettings(settings);settingsPanel.remove();settingsPanel=null;};
  settingsPanel.querySelector(".s-close").onclick=closeS;
  settingsPanel.onclick=e=>{if(e.target===settingsPanel)closeS();};
  settingsPanel.querySelector(".saveBtn").onclick=()=>{saveSettings();settingsPanel.remove();settingsPanel=null;showToast("Settings saved!");};
  settingsPanel.querySelector(".reset").onclick=()=>{showModal("Reset everything? This will delete all notes and settings.",()=>{chrome.storage.local.clear();location.reload();},"Reset");};
  settingsPanel.querySelector(".exportBtn").onclick=exportNotes;
  settingsPanel.querySelector(".importInput").onchange=importNotes;
}

function bringPanelZ(el) { currentTopZ+=10; el.style.zIndex=currentTopZ; }

function loadStorageUsage() {
  if (!chrome.storage?.local?.getBytesInUse) return;
  chrome.storage.local.getBytesInUse(null,bytes=>{
    const fill=settingsPanel?.querySelector("#na-storage-fill"), label=settingsPanel?.querySelector("#na-storage-label");
    if(!fill||!label) return;
    const pct=Math.min(100,(bytes/(5*1024*1024))*100);
    fill.style.width=pct+"%"; fill.style.background=pct>80?"#ff3b30":pct>60?"#f4bf4f":"#28c940";
    label.textContent=`${(bytes/1024).toFixed(1)} KB of 5,120 KB`;
  });
}

/* ─── EXPORT / IMPORT ─── */

function exportNotes() {
  const blob=new Blob([JSON.stringify({version:"2.0.0",exported:new Date().toISOString(),notes,settings},null,2)],{type:"application/json"});
  const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"notes-anywhere-backup.json"});
  a.click(); URL.revokeObjectURL(a.href); showToast("Notes exported!");
}

function importNotes(e) {
  const file=e.target.files?.[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try {
      const data=JSON.parse(ev.target.result);
      if(!data.notes||typeof data.notes!=="object") throw new Error();
      const imp=sanitizeNotes(data.notes), count=Object.keys(imp).length;
      if(!count) throw new Error();
      showModal(`Import ${count} page${count>1?"s":""} of notes? They'll be merged with existing notes.`,()=>{
        Object.keys(imp).forEach(page=>{
          if(!notes[page])notes[page]=[];
          const ids=new Set(notes[page].map(n=>n.id));
          imp[page].forEach(n=>{if(!ids.has(n.id))notes[page].push(n);});
        });
        save();renderNotes();refreshList();refreshPagesList();
        if(settingsPanel){settingsPanel.remove();settingsPanel=null;}
        showToast("Notes imported!");
      },"Import");
    } catch { showToast("Import failed — use a valid backup file.","warn"); }
  };
  reader.readAsText(file); e.target.value="";
}

/* ─── HELP ─── */

function openHelp() {
  if (helpPanel) { helpPanel.remove(); helpPanel=null; }
  const sp=formatShortcut(settings.shortcutPanel)||"—", sn=formatShortcut(settings.shortcutNote)||"—";
  helpPanel=document.createElement("div");
  helpPanel.className="na-settings"; helpPanel.setAttribute("role","dialog"); helpPanel.setAttribute("aria-modal","true");
  helpPanel.innerHTML=`
    <div class="na-settings-box na-help-box">
      <div class="s-header"><strong>Help &amp; Feedback</strong><button class="s-close" aria-label="Close help">×</button></div>
      <div class="help-tabs" role="tablist">
        <button class="help-tab active" data-tab="howto"     role="tab" aria-selected="true">How to use</button>
        <button class="help-tab"        data-tab="shortcuts"  role="tab" aria-selected="false">Shortcuts</button>
        <button class="help-tab"        data-tab="feedback"   role="tab" aria-selected="false">Feedback</button>
      </div>
      <div class="help-panel active" id="ht-howto">
        ${[
          ["📋","Open the panel",`Click the toolbar icon or press <kbd>${sp}</kbd>.`],
          ["✏️","Create &amp; write",`Click <strong>+ Add Note</strong> or press <kbd>${sn}</kbd>. First line = title.`],
          ["🎨","Per-note colour","Click the colour dot in any note's header to pick a unique colour."],
          ["✳️","Markdown mode","Click the <strong>M↓</strong> button to toggle rendered markdown."],
          ["🔍","Search notes","Use the search box to filter by title, text, or #tag."],
          ["🏷️","Tags","Type #tag inside a note. Tags appear as chips and are searchable."],
          ["📍","Pin to viewport","● Green button locks a note in place while scrolling."],
          ["📱","Touch drag","Drag notes by header on Android tablets and touch screens."],
          ["💾","Back up","⚙ Settings → Export downloads a JSON backup. Import to restore."],
        ].map(([i,t,d])=>`<div class="help-tip"><div class="help-tip-icon">${i}</div><div class="help-tip-body"><div class="help-tip-title">${t}</div><div class="help-tip-desc">${d}</div></div></div>`).join("")}
      </div>
      <div class="help-panel" id="ht-shortcuts">
        ${[
          ["Open / close panel",sp],["New note",sn],["Drag note","Drag header"],
          ["Touch drag (tablet)","Touch &amp; drag header"],["Resize note","Drag ◢ handle"],
          ["Pin / unpin","● Green dot"],["Minimize","● Yellow dot"],["Delete note","● Red dot"],
          ["Per-note colour","Colour dot in header"],["Markdown toggle","M↓ button"],
          ["Search notes","Search box in panel"],
        ].map(([d,k])=>`<div class="shortcut-row"><span class="shortcut-desc">${d}</span><kbd>${k}</kbd></div>`).join("")}
        <div class="shortcut-note">Customise shortcuts in ⚙ Settings.<br>On Mac, <kbd>Ctrl</kbd> and <kbd>⌘</kbd> both work.</div>
      </div>
      <div class="help-panel" id="ht-feedback">
        <div class="feedback-hero">
          <div class="feedback-emoji">💬</div>
          <div class="feedback-title">We'd love to hear from you</div>
          <div class="feedback-desc">Found a bug? Have a feature idea? Your feedback shapes the next version.</div>
          <a class="feedback-btn" href="${FEEDBACK_URL}" target="_blank" rel="noopener noreferrer">Open Feedback Form ↗</a>
        </div>
        <div class="feedback-categories">
          <div class="feedback-cat">🐛<span>Bug report</span></div>
          <div class="feedback-cat">✨<span>Feature request</span></div>
          <div class="feedback-cat">⭐<span>General feedback</span></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(helpPanel);
  bringPanelZ(helpPanel);
  const closeH=()=>{helpPanel.remove();helpPanel=null;};
  helpPanel.querySelector(".s-close").onclick=closeH;
  helpPanel.onclick=e=>{if(e.target===helpPanel)closeH();};
  helpPanel.querySelectorAll(".help-tab").forEach(tab=>{
    tab.onclick=()=>{
      helpPanel.querySelectorAll(".help-tab").forEach(t=>{t.classList.remove("active");t.setAttribute("aria-selected","false");});
      helpPanel.querySelectorAll(".help-panel").forEach(p=>p.classList.remove("active"));
      tab.classList.add("active"); tab.setAttribute("aria-selected","true");
      helpPanel.querySelector("#ht-"+tab.dataset.tab).classList.add("active");
    };
  });
}

/* ─── CREATE NOTE ─── */

function createNote() {
  notes[PAGE]??=[];
  const n={id:crypto.randomUUID(),title:"New note",text:"",x:220,y:200,w:360,h:380,
           fixed:false,min:false,z:++maxZ,color:null,tags:[],markdown:false};
  currentTopZ=maxZ;
  notes[PAGE].push(n); save(); renderNote(n); refreshList(); refreshPagesList(); updateMinAllButton();
  setTimeout(()=>document.querySelector(`[data-id="${n.id}"]`)?.querySelector("textarea")?.focus(),100);
}

function renderNotes() {
  document.querySelectorAll(".na-note").forEach(e=>e.remove());
  (notes[PAGE]||[]).forEach(renderNote); updateMinAllButton();
}

/* ─── RENDER NOTE ─── */

function renderNote(n) {
  const el=document.createElement("div");
  el.className="na-note"; el.dataset.id=n.id;
  el.setAttribute("role","note"); el.setAttribute("aria-label",`Note: ${n.title}`);
  el.style.cssText=`position:${n.fixed?"fixed":"absolute"};left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;z-index:${n.z}`;
  if (n.min) el.classList.add("minimized");
  applyNoteColor(el,n);

  el.innerHTML=`
    <div class="na-header">
      <button class="na-color-dot" title="Note colour" aria-label="Pick note colour"></button>
      <span class="na-title">${escapeHtml(n.title)}</span>
      <div class="na-controls">
        <button class="md-toggle${n.markdown?" md-active":""}" title="${n.markdown?"Edit text":"Render markdown"}" aria-label="Toggle markdown">M↓</button>
        <button class="pin${n.fixed?" active":""}" title="${n.fixed?"Unpin":"Pin"}" aria-label="${n.fixed?"Unpin":"Pin"} note"></button>
        <button class="min" title="${n.min?"Restore":"Minimize"}" aria-label="${n.min?"Restore":"Minimize"} note"></button>
        <button class="cls" title="Delete" aria-label="Delete note"></button>
      </div>
    </div>
    <div class="na-body">
      <textarea placeholder="Start typing…" aria-label="Note content" style="display:${n.markdown?"none":"block"}"></textarea>
      <div class="na-md-view" style="display:${n.markdown?"block":"none"}"></div>
      <div class="na-resize" aria-hidden="true"></div>
    </div>`;
  document.body.appendChild(el);

  const ta=el.querySelector("textarea"), mdv=el.querySelector(".na-md-view");
  const dotBtn=el.querySelector(".na-color-dot"), mdBtn=el.querySelector(".md-toggle");

  ta.value=n.text; ta.style.fontSize=settings.fontSize+"px"; ta.style.lineHeight=(settings.fontSize*1.55)+"px";
  if (n.markdown) mdv.innerHTML=renderMarkdown(n.text);
  updateDotColor(dotBtn,n);

  dotBtn.onclick=e=>{e.stopPropagation();openNoteColorPicker(el,n,dotBtn);};

  mdBtn.onclick=()=>{
    n.markdown=!n.markdown; mdBtn.classList.toggle("md-active",n.markdown);
    mdBtn.title=n.markdown?"Edit text":"Render markdown";
    ta.style.display=n.markdown?"none":"block"; mdv.style.display=n.markdown?"block":"none";
    if(n.markdown)mdv.innerHTML=renderMarkdown(n.text); else ta.focus();
    save();
  };

  ta.oninput=()=>{
    n.text=ta.value;
    n.tags=[...new Set((n.text.match(/#(\w+)/g)||[]).map(t=>t.slice(1).toLowerCase()))].slice(0,5);
    n.title=n.text.split("\n")[0].replace(/#\w+/g,"").trim().slice(0,40)||"New note";
    el.querySelector(".na-title").textContent=n.title;
    el.setAttribute("aria-label",`Note: ${n.title}`);
    if(n.markdown)mdv.innerHTML=renderMarkdown(n.text);
    save(); refreshList();
  };

  const pinBtn=el.querySelector(".pin");
  pinBtn.onclick=()=>{
    n.fixed=!n.fixed;
    if(n.fixed){const r=el.getBoundingClientRect();el.style.position="fixed";el.style.left=(n.x=r.left)+"px";el.style.top=(n.y=r.top)+"px";}
    else{const r=el.getBoundingClientRect();el.style.position="absolute";el.style.left=(n.x=r.left+window.pageXOffset)+"px";el.style.top=(n.y=r.top+window.pageYOffset)+"px";}
    pinBtn.classList.toggle("active"); pinBtn.title=n.fixed?"Unpin":"Pin";
    save(); bringToFront(el,n);
  };

  el.querySelector(".min").onclick=()=>{
    n.min=!n.min; el.classList.toggle("minimized",n.min);
    const b=el.querySelector(".min"); b.title=n.min?"Restore":"Minimize";
    save(); refreshList(); bringToFront(el,n); updateMinAllButton();
  };

  el.querySelector(".cls").onclick=()=>{
    el.remove(); notes[PAGE]=notes[PAGE].filter(x=>x.id!==n.id);
    save(); refreshList(); refreshPagesList(); updateMinAllButton();
  };

  el.onmousedown=()=>bringToFront(el,n);
  drag(el,n); resize(el,n,ta); addTouchDrag(el,n);
}

/* ─── DRAG (mouse) ─── */

function drag(el,n) {
  const hdr=el.querySelector(".na-header");
  hdr.onmousedown=e=>{
    if(e.target.closest(".na-controls")||e.target.closest(".na-color-dot"))return;
    e.preventDefault(); document.body.style.userSelect="none"; hdr.style.cursor="grabbing";
    bringToFront(el,n);
    const rect=el.getBoundingClientRect(), dx=e.clientX-rect.left, dy=e.clientY-rect.top;
    const onMove=m=>{
      let l=m.clientX-dx, t=m.clientY-dy;
      if(n.fixed){l=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,l));t=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,t));}
      el.style.left=l+"px"; el.style.top=t+"px";
    };
    const onUp=()=>{
      document.body.style.userSelect=""; hdr.style.cursor="";
      if(n.fixed){const r=el.getBoundingClientRect();n.x=r.left;n.y=r.top;}
      else{n.x=el.offsetLeft;n.y=el.offsetTop;}
      save(); document.removeEventListener("mousemove",onMove); document.removeEventListener("mouseup",onUp);
    };
    document.addEventListener("mousemove",onMove); document.addEventListener("mouseup",onUp);
  };
}

/* ─── TOUCH DRAG ─── */

function addTouchDrag(el,n) {
  const hdr=el.querySelector(".na-header");
  hdr.addEventListener("touchstart",e=>{
    if(e.target.closest(".na-controls")||e.target.closest(".na-color-dot"))return;
    const t0=e.touches[0]; bringToFront(el,n);
    const rect=el.getBoundingClientRect(), dx=t0.clientX-rect.left, dy=t0.clientY-rect.top;
    let moved=false;
    const onMove=m=>{
      m.preventDefault(); moved=true;
      const t2=m.touches[0]; let l=t2.clientX-dx, t=t2.clientY-dy;
      if(n.fixed){l=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,l));t=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,t));}
      el.style.left=l+"px"; el.style.top=t+"px";
    };
    const onEnd=()=>{
      if(moved){if(n.fixed){const r=el.getBoundingClientRect();n.x=r.left;n.y=r.top;}else{n.x=el.offsetLeft;n.y=el.offsetTop;}save();}
      hdr.removeEventListener("touchmove",onMove); hdr.removeEventListener("touchend",onEnd);
    };
    hdr.addEventListener("touchmove",onMove,{passive:false});
    hdr.addEventListener("touchend",onEnd);
  },{passive:true});
}

/* ─── RESIZE ─── */

function resize(el,n,ta) {
  el.querySelector(".na-resize").onmousedown=e=>{
    e.stopPropagation(); document.body.style.userSelect="none"; ta.style.pointerEvents="none";
    const sw=el.offsetWidth, sh=el.offsetHeight, sx=e.clientX, sy=e.clientY;
    const onMove=m=>{
      n.w=Math.max(260,Math.min(sw+m.clientX-sx,2000));
      n.h=Math.max(240,Math.min(sh+m.clientY-sy,2000));
      el.style.width=n.w+"px"; el.style.height=n.h+"px";
    };
    const onUp=()=>{document.body.style.userSelect="";ta.style.pointerEvents="";save();document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);};
    document.addEventListener("mousemove",onMove); document.addEventListener("mouseup",onUp);
  };
}

/* ─── LIST ─── */

function refreshList() {
  if(!panel) return;
  const ul=panel.querySelector("#list"); ul.innerHTML="";
  const pn=notes[PAGE]||[], q=searchQuery;
  const filtered=q?pn.filter(n=>n.title.toLowerCase().includes(q)||n.text.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.toLowerCase().includes(q))):pn;
  if(!filtered.length){ul.innerHTML=q?`<li class="empty">No notes match "<em>${escapeHtml(q)}</em>".</li>`:'<li class="empty">No notes yet — click "+ Add Note".</li>';return;}
  filtered.forEach(n=>{
    const li=document.createElement("li");
    if(n.color&&isValidHex(n.color)){const dot=document.createElement("span");dot.className="list-color-dot";dot.style.background=n.color;li.appendChild(dot);}
    const ttl=document.createElement("span"); ttl.className="note-title"; ttl.textContent=n.title;
    const right=document.createElement("div"); right.className="note-controls";
    if(n.tags?.length){const tw=document.createElement("div");tw.className="note-tags";
      n.tags.slice(0,3).forEach(t=>{const c=document.createElement("span");c.className="note-tag-chip";c.textContent="#"+t;tw.appendChild(c);});right.appendChild(tw);}
    const del=document.createElement("button"); del.className="note-delete"; del.textContent="×";
    del.setAttribute("aria-label",`Delete: ${n.title}`);
    del.onclick=e=>{e.stopPropagation();document.querySelector(`[data-id="${n.id}"]`)?.remove();notes[PAGE]=notes[PAGE].filter(x=>x.id!==n.id);save();refreshList();refreshPagesList();updateMinAllButton();};
    right.appendChild(del); li.append(ttl,right);
    li.onclick=()=>{
      if(hidden){hidden=false;showAll();}
      const el2=document.querySelector(`[data-id="${n.id}"]`); if(!el2)return;
      if(n.min){n.min=false;el2.classList.remove("minimized");save();refreshList();updateMinAllButton();}
      bringToFront(el2,n); el2.classList.add("highlight");
      setTimeout(()=>el2?.classList.remove("highlight"),600);
      const r=el2.getBoundingClientRect();
      if(r.top<0||r.bottom>window.innerHeight||r.left<0||r.right>window.innerWidth)el2.scrollIntoView({behavior:"smooth",block:"center"});
    };
    ul.appendChild(li);
  });
}

function toggleHide(){hidden=!hidden;const btn=panel?.querySelector("#hide");if(btn)btn.textContent=hidden?"Show All":"Hide All";hidden?hideAll():showAll();}
function hideAll(){document.querySelectorAll(".na-note").forEach(n=>(n.style.display="none"));}
function showAll(){document.querySelectorAll(".na-note").forEach(n=>(n.style.display=""));}

function deleteAll(){
  const count=(notes[PAGE]||[]).length; if(!count)return;
  showModal(`Delete all ${count} note${count>1?"s":""} on this page? Cannot be undone.`,()=>{
    document.querySelectorAll(".na-note").forEach(n=>n.remove());
    delete notes[PAGE]; save();refreshList();refreshPagesList();updateMinAllButton();
  });
}

})();
