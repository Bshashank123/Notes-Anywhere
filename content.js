(() => {

if(window.__NA__) return;
window.__NA__=true;

const ok =
 location.protocol.startsWith("http") ||
 location.protocol==="file:" ||
 document.contentType==="application/pdf";

if(!ok) return;

const PAGE = location.origin+location.pathname;
let notes={};
let settings={
  theme:"light",
  fontSize:16,
  fontFamily:"sans",
  ruled:false,
  glass:0.45
};

let tempSettings = {...settings};
let hidden=false;
let maxZ = 1000;
let currentTopZ = 1000;

init();

/* ================= INIT ================= */
async function init(){
  try{
    const r=await chrome.storage.local.get(["notes","noteSettings"]);
    notes=r.notes||{};
    settings=r.noteSettings||settings;
    tempSettings = {...settings};
    
    Object.keys(notes).forEach(page=>{
      (notes[page]||[]).forEach(n=>{
        if(n.z > maxZ) maxZ = n.z;
      });
    });
    currentTopZ = maxZ;
  }catch(e){ notes={}; }

  applySettings(settings);

  chrome.runtime?.onMessage?.addListener(msg=>{
    if(msg.type==="TOGGLE_PANEL") togglePanel();
  });

  renderNotes();
}

/* ================= APPLY SETTINGS ================= */
function applySettings(s){
  document.documentElement.setAttribute("data-na-theme",s.theme);

  document.documentElement.style.setProperty("--user-font-size", s.fontSize+"px");
  
  const lineHeight = s.fontSize * 1.55;
  document.documentElement.style.setProperty("--user-line-height", lineHeight+"px");

  const ff =
    s.fontFamily==="serif" ? "Georgia, Times, serif" :
    s.fontFamily==="mono" ? "JetBrains Mono, Consolas, monospace" :
    s.fontFamily==="hand" ? "'Comic Sans MS', cursive" :
                             "-apple-system,BlinkMacSystemFont,Inter";

  document.documentElement.style.setProperty("--user-font-family", ff);
  document.documentElement.style.setProperty("--glass", s.glass);

  if(s.ruled)
    document.documentElement.setAttribute("data-na-ruled","1");
  else
    document.documentElement.removeAttribute("data-na-ruled");
}

function saveSettings(){
  settings = {...tempSettings};
  chrome.storage.local.set({noteSettings:settings});
  applySettings(settings);
  
  document.querySelectorAll(".na-note textarea").forEach(ta=>{
    ta.style.fontSize = settings.fontSize+"px";
    ta.style.lineHeight = (settings.fontSize * 1.55)+"px";
  });
}

function save(){
  chrome.storage.local.set({notes});
}

/* ================= PANEL ================= */
let panel=null;
let settingsPanel=null;

function togglePanel(){
  if(!panel){
    buildPanel();
    return;
  }
  const isVisible = panel.style.display !== "none";
  panel.style.display = isVisible ? "none" : "block";
  
  if(!isVisible){
    bringPanelToTop();
  }
  
  refreshList();
  refreshPagesList();
}

function bringPanelToTop(){
  currentTopZ += 10;
  if(panel) panel.style.zIndex = currentTopZ;
}

function buildPanel(){
  panel=document.createElement("div");
  panel.id="na-panel";

  panel.innerHTML=`
   <div class="na-panel-header">
     <span>Notes — Anywhere</span>
     <button id="na-close">×</button>
   </div>

   <div class="na-buttons">
     <button id="add">+ Add Note</button>
     <button id="minall">Minimize All</button>
     <button id="hide">Hide All</button>
     <button id="del">Delete All</button>
   </div>

   <div class="na-section">
     <h3>Notes on this page</h3>
     <ul id="list"></ul>
   </div>

   <div class="na-section na-pages-section">
     <h3>Pages with notes</h3>
     <ul id="pages-list"></ul>
   </div>

   <button id="settings">⚙ Settings</button>
  `;

  document.body.appendChild(panel);
  bringPanelToTop();

  panel.querySelector("#na-close").onclick=()=>panel.style.display="none";
  panel.querySelector("#add").onclick=()=>{hidden=false;createNote();showAll();};
  panel.querySelector("#hide").onclick=toggleHide;
  panel.querySelector("#del").onclick=deleteAll;
  panel.querySelector("#settings").onclick=openSettings;
  panel.querySelector("#minall").onclick=minimizeAll;

  refreshList();
  refreshPagesList();
}

/* ================= PAGES LIST ================= */
function refreshPagesList(){
  if(!panel) return;
  const ul = panel.querySelector("#pages-list");
  if(!ul) return;
  
  ul.innerHTML = "";
  
  const pages = Object.keys(notes).filter(p => notes[p] && notes[p].length > 0);
  
  if(pages.length === 0){
    ul.innerHTML='<li class="empty">No notes on any pages yet.</li>';
    return;
  }
  
  pages.forEach(page=>{
    const li = document.createElement("li");
    li.className = "page-item";
    
    const count = notes[page].length;
    const isCurrentPage = page === PAGE;
    
    const pageUrl = document.createElement("div");
    pageUrl.className = "page-url";
    
    const urlText = document.createElement("span");
    urlText.textContent = page;
    urlText.title = page;
    
    const badge = document.createElement("span");
    badge.className = "page-badge";
    badge.textContent = count;
    
    pageUrl.appendChild(urlText);
    pageUrl.appendChild(badge);
    
    if(isCurrentPage){
      li.classList.add("current-page");
    }
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "page-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete all notes from this page";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if(confirm(`Delete all ${count} note${count>1?'s':''} from this page?`)){
        delete notes[page];
        save();
        refreshPagesList();
        if(page === PAGE){
          renderNotes();
          refreshList();
        }
      }
    };
    
    li.appendChild(pageUrl);
    li.appendChild(deleteBtn);
    
    if(!isCurrentPage){
      li.style.opacity = "0.7";
      li.title = "Click to open this page";
      li.onclick = () => {
        window.location.href = page;
      };
    } else {
      li.title = "Current page";
    }
    
    ul.appendChild(li);
  });
}

/* ================= MIN ALL ================= */
function minimizeAll(){
  const pageNotes = notes[PAGE]||[];
  const allMinimized = pageNotes.every(n => n.min);
  
  pageNotes.forEach(n=>{
    n.min = !allMinimized;
    const el=document.querySelector(`[data-id="${n.id}"]`);
    if(el) {
      if(n.min) {
        el.classList.add("minimized");
      } else {
        el.classList.remove("minimized");
      }
    }
  });
  
  save();
  refreshList();
  updateMinAllButton();
}

function updateMinAllButton(){
  if(!panel) return;
  const btn = panel.querySelector("#minall");
  if(!btn) return;
  
  const pageNotes = notes[PAGE]||[];
  const allMinimized = pageNotes.length > 0 && pageNotes.every(n => n.min);
  
  btn.textContent = allMinimized ? "Maximize All" : "Minimize All";
}

/* ================= SETTINGS ================= */
function openSettings(){
  if(settingsPanel){
    settingsPanel.style.display="flex";
    bringSettingsToTop();
    return;
  }

  tempSettings = {...settings};

  settingsPanel=document.createElement("div");
  settingsPanel.className="na-settings";

  settingsPanel.innerHTML=`
    <div class="na-settings-box">
      <div class="s-header">
        <strong>Settings</strong>
        <button class="s-close">×</button>
      </div>

      <div class="s-block">
        <h3>Theme</h3>
        <div class="theme-grid">
          <div data-theme="light" class="theme-card"><div class="preview light"></div><span>Light</span></div>
          <div data-theme="dark" class="theme-card"><div class="preview dark"></div><span>Dark</span></div>
          <div data-theme="glass" class="theme-card"><div class="preview glass"></div><span>Glass</span></div>
          <div data-theme="sticky" class="theme-card"><div class="preview sticky"></div><span>Sticky</span></div>
        </div>
      </div>

      <div class="s-block glassBlock" style="display:${settings.theme==="glass"?"block":"none"}">
        <h3>Glass Intensity</h3>
        <input type="range" min="0.25" max="0.85" step="0.02" value="${settings.glass}" class="glassRange"/>
      </div>

      <div class="s-block">
        <h3>Font</h3>

        <label>Font Size: <span class="fontSizeLabel">${settings.fontSize}px</span></label>
        <input type="range" min="12" max="26" value="${settings.fontSize}" class="fontRange"/>

        <select class="fontSelect">
          <option value="sans">System</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
          <option value="hand">Handwriting</option>
        </select>

        <div class="font-preview">
          Aa The quick brown fox jumps
        </div>
      </div>

      <div class="s-block">
        <label class="ruled-row">
          <input type="checkbox" class="ruledCheck"/>
          Notes with lines
        </label>
      </div>

      <button class="saveBtn">Save Changes</button>
      <button class="reset smallReset">Reset App</button>
    </div>
  `;

  document.body.appendChild(settingsPanel);
  bringSettingsToTop();

  const preview = settingsPanel.querySelector(".font-preview");
  const fontSizeLabel = settingsPanel.querySelector(".fontSizeLabel");

  settingsPanel.querySelector(".s-close").onclick=
    ()=>settingsPanel.style.display="none";

  settingsPanel.querySelectorAll(".theme-card").forEach(card=>{
    if(card.dataset.theme===settings.theme)
        card.classList.add("active");

    card.onclick=()=>{
      settingsPanel.querySelectorAll(".theme-card")
        .forEach(c=>c.classList.remove("active"));
      card.classList.add("active");

      tempSettings.theme = card.dataset.theme;

      const gb = settingsPanel.querySelector(".glassBlock");
      if(gb) gb.style.display = tempSettings.theme==="glass" ? "block" : "none";

      applySettings(tempSettings);
    };
  });

  const glass = settingsPanel.querySelector(".glassRange");
  if(glass){
    glass.oninput=e=>{
      tempSettings.glass = Number(e.target.value);
      applySettings(tempSettings);
    };
  }

  const range = settingsPanel.querySelector(".fontRange");
  preview.style.fontSize = settings.fontSize+"px";
  range.oninput=e=>{
    tempSettings.fontSize = Number(e.target.value);
    fontSizeLabel.textContent = tempSettings.fontSize+"px";
    preview.style.fontSize=tempSettings.fontSize+"px";
    applySettings(tempSettings);
  };

  const select = settingsPanel.querySelector(".fontSelect");
  select.value=settings.fontFamily;
  select.onchange=e=>{
    tempSettings.fontFamily=e.target.value;
    applySettings(tempSettings);
  };

  const ruled = settingsPanel.querySelector(".ruledCheck");
  ruled.checked=settings.ruled;
  ruled.onchange=e=>{
    tempSettings.ruled=e.target.checked;
    applySettings(tempSettings);
  };

  settingsPanel.querySelector(".saveBtn").onclick=()=>{
    saveSettings();
    settingsPanel.style.display="none";
  };

  settingsPanel.querySelector(".reset").onclick=()=>{
    if(!confirm("Reset everything? This will delete all notes and settings."))return;
    chrome.storage.local.clear();
    location.reload();
  };
}

function bringSettingsToTop(){
  currentTopZ += 10;
  if(settingsPanel) settingsPanel.style.zIndex = currentTopZ;
}

/* ================= NOTES ================= */
function createNote(){
  notes[PAGE] ??=[];
  
  maxZ++;
  currentTopZ = maxZ;
  
  const n={
    id:crypto.randomUUID(),
    title:"New note",
    text:"",
    x:220,y:200,
    w:360,h:380,
    fixed:false,
    min:false,
    z:maxZ
  };

  notes[PAGE].push(n);
  save();
  renderNote(n);
  refreshList();
  refreshPagesList();
  updateMinAllButton();
  
  setTimeout(()=>{
    const el=document.querySelector(`[data-id="${n.id}"]`);
    const ta=el?.querySelector("textarea");
    if(ta) ta.focus();
  },100);
}

function renderNotes(){
  document.querySelectorAll(".na-note").forEach(e=>e.remove());
  (notes[PAGE]||[]).forEach(renderNote);
  updateMinAllButton();
}

function renderNote(n){
  const el=document.createElement("div");
  el.className="na-note";
  el.dataset.id=n.id;

  el.style.position=n.fixed?"fixed":"absolute";
  el.style.left=n.x+"px";
  el.style.top=n.y+"px";
  el.style.width=n.w+"px";
  el.style.height=n.h+"px";
  el.style.zIndex=n.z;

  if(n.min) el.classList.add("minimized");

  el.innerHTML=`
    <div class="na-header">
      <span class="na-title">${escapeHtml(n.title)}</span>
      <div class="na-controls">
        <button class="pin" title="${n.fixed?'Unpin':'Pin to viewport'}"></button>
        <button class="min" title="${n.min?'Restore':'Minimize'}"></button>
        <button class="cls" title="Delete note"></button>
      </div>
    </div>

    <div class="na-body">
      <textarea placeholder="Start typing..."></textarea>
      <div class="na-resize"></div>
    </div>
  `;

  document.body.appendChild(el);

  const ta=el.querySelector("textarea");
  ta.value=n.text;
  ta.style.fontSize = settings.fontSize+"px";
  ta.style.lineHeight = (settings.fontSize * 1.55)+"px";

  ta.oninput=()=>{
    n.text=ta.value;
    const t=ta.value.split("\n")[0];
    if(t.trim()){
      n.title=t.slice(0,40);
      el.querySelector(".na-title").textContent=n.title;
    } else {
      n.title="New note";
      el.querySelector(".na-title").textContent=n.title;
    }
    save();
    refreshList();
  };

  const pin=el.querySelector(".pin");
  if(n.fixed) pin.classList.add("active");
  pin.onclick=()=>{
    n.fixed=!n.fixed;
    
    if(n.fixed){
      // Switching to fixed: convert absolute position to fixed (relative to viewport)
      const rect = el.getBoundingClientRect();
      el.style.position = "fixed";
      el.style.left = rect.left + "px";
      el.style.top = rect.top + "px";
      n.x = rect.left;
      n.y = rect.top;
    } else {
      // Switching to absolute: convert fixed position to absolute (relative to page)
      const rect = el.getBoundingClientRect();
      el.style.position = "absolute";
      el.style.left = (rect.left + window.pageXOffset) + "px";
      el.style.top = (rect.top + window.pageYOffset) + "px";
      n.x = rect.left + window.pageXOffset;
      n.y = rect.top + window.pageYOffset;
    }
    
    pin.classList.toggle("active");
    pin.title=n.fixed?'Unpin':'Pin to viewport';
    save();
    bringToFront(el, n);
  };

  el.querySelector(".min").onclick=()=>{
    n.min=!n.min;
    el.classList.toggle("minimized",n.min);
    const minBtn = el.querySelector(".min");
    minBtn.title=n.min?'Restore':'Minimize';
    save();
    refreshList();
    bringToFront(el, n);
    updateMinAllButton();
  };

  el.querySelector(".cls").onclick=()=>{
    el.remove();
    notes[PAGE]=notes[PAGE].filter(x=>x.id!==n.id);
    save();
    refreshList();
    refreshPagesList();
  };

  el.onmousedown=(e)=>{
    bringToFront(el, n);
  };

  drag(el,n);
  resize(el,n,ta);
}

function bringToFront(el, n){
  currentTopZ++;
  maxZ = currentTopZ;
  n.z = maxZ;
  el.style.zIndex = maxZ;
  save();
}

function drag(el,n){
  const h=el.querySelector(".na-header");
  let drag=false,dx,dy;

  h.onmousedown=e=>{
    if(e.target.closest('.na-controls')) return;
    
    drag=true;
    document.body.style.userSelect="none";

    bringToFront(el, n);

    dx=e.clientX-el.offsetLeft;
    dy=e.clientY-el.offsetTop;

    document.onmousemove=m=>{
      if(!drag)return;
      el.style.left=m.clientX-dx+"px";
      el.style.top=m.clientY-dy+"px";
    };

    document.onmouseup=()=>{
      drag=false;
      document.body.style.userSelect="";
      n.x=el.offsetLeft;
      n.y=el.offsetTop;
      save();
      document.onmousemove=null;
      document.onmouseup=null;
    };
  };
}

function resize(el,n,ta){
  const r=el.querySelector(".na-resize");

  r.onmousedown=e=>{
    e.stopPropagation();

    document.body.style.userSelect="none";
    ta.style.pointerEvents="none";

    const sw=el.offsetWidth;
    const sh=el.offsetHeight;
    const sx=e.clientX;
    const sy=e.clientY;

    document.onmousemove=m=>{
      let w=sw+(m.clientX-sx);
      let h=sh+(m.clientY-sy);

      if(w<260)w=260;
      if(h<240)h=240;

      el.style.width=w+"px";
      el.style.height=h+"px";

      n.w=w;
      n.h=h;
    };

    document.onmouseup=()=>{
      document.body.style.userSelect="";
      ta.style.pointerEvents="";
      save();
      document.onmousemove=null;
      document.onmouseup=null;
    };
  };
}

function refreshList(){
  if(!panel)return;
  const ul=panel.querySelector("#list");
  ul.innerHTML="";

  const pageNotes = notes[PAGE]||[];
  
  if(pageNotes.length === 0){
    ul.innerHTML='<li class="empty">No notes yet. Click "Add Note" to create one.</li>';
    return;
  }

  pageNotes.forEach(n=>{
    const li=document.createElement("li");
    
    const title = document.createElement("span");
    title.className="note-title";
    title.textContent=n.title;
    
    const controls = document.createElement("div");
    controls.className="note-controls";
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className="note-delete";
    deleteBtn.textContent="×";
    deleteBtn.title="Delete note";
    deleteBtn.onclick=(e)=>{
      e.stopPropagation();
      const el=document.querySelector(`[data-id="${n.id}"]`);
      el?.remove();
      notes[PAGE]=notes[PAGE].filter(x=>x.id!==n.id);
      save();
      refreshList();
      refreshPagesList();
    };
    
    controls.appendChild(deleteBtn);
    li.appendChild(title);
    li.appendChild(controls);

    li.onclick=()=>{
      if(hidden){
        hidden=false;
        showAll();
      }
      
      const el=document.querySelector(`[data-id="${n.id}"]`);
      if(!el) return;
      
      if(n.min){
        n.min=false;
        el.classList.remove("minimized");
        save();
        refreshList();
      }
      
      bringToFront(el, n);
      el.classList.add("highlight");
      setTimeout(()=>el?.classList.remove("highlight"),600);
      
      const rect = el.getBoundingClientRect();
      if(rect.top < 0 || rect.bottom > window.innerHeight || 
         rect.left < 0 || rect.right > window.innerWidth){
        el.scrollIntoView({behavior:'smooth', block:'center'});
      }
    };

    ul.appendChild(li);
  });
}

function toggleHide(){
 hidden=!hidden;
 const btn = panel?.querySelector("#hide");
 if(btn) btn.textContent = hidden ? "Show All" : "Hide All";
 hidden?hideAll():showAll();
}

function hideAll(){
 document.querySelectorAll(".na-note").forEach(n=>n.style.display="none");
}

function showAll(){
 document.querySelectorAll(".na-note").forEach(n=>n.style.display="block");
}

function deleteAll(){
 const count = (notes[PAGE]||[]).length;
 if(count === 0) return;
 
 if(!confirm(`Delete all ${count} note${count>1?'s':''}? This cannot be undone.`)) return;
 document.querySelectorAll(".na-note").forEach(n=>n.remove());
 delete notes[PAGE];
 save();
 refreshList();
 refreshPagesList();
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

})();