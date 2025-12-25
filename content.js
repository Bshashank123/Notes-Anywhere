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

init();

/* ================= INIT ================= */
async function init(){
  try{
    const r=await chrome.storage.local.get(["notes","noteSettings"]);
    notes=r.notes||{};
    settings=r.noteSettings||settings;
    tempSettings = {...settings};
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
  panel.style.display =
    panel.style.display==="none" ? "block" : "none";
  refreshList();
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
     <button id="add">Add</button>
     <button id="minall">Min All</button>
     <button id="hide">Hide</button>
     <button id="del">Delete</button>
   </div>

   <div class="na-section">
     <h3>Notes</h3>
     <ul id="list"></ul>
   </div>

   <button id="settings">⚙ Settings</button>
  `;

  document.body.appendChild(panel);

  panel.querySelector("#na-close").onclick=()=>panel.style.display="none";
  panel.querySelector("#add").onclick=()=>{hidden=false;createNote();showAll();};
  panel.querySelector("#hide").onclick=toggleHide;
  panel.querySelector("#del").onclick=deleteAll;
  panel.querySelector("#settings").onclick=openSettings;
  panel.querySelector("#minall").onclick=minimizeAll;

  refreshList();
}

/* ================= MIN ALL ================= */
function minimizeAll(){
  (notes[PAGE]||[]).forEach(n=>{
    n.min=true;
    const el=document.querySelector(`[data-id="${n.id}"]`);
    if(el) el.classList.add("minimized");
  });
  save();
}

/* ================= SETTINGS ================= */
function openSettings(){
  if(settingsPanel){
    settingsPanel.style.display="flex";
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

        <label>Font Size</label>
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

  const preview = settingsPanel.querySelector(".font-preview");

  settingsPanel.querySelector(".s-close").onclick=
    ()=>settingsPanel.style.display="none";

  /* Theme */
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

  /* Glass */
  const glass = settingsPanel.querySelector(".glassRange");
  if(glass){
    glass.oninput=e=>{
      tempSettings.glass = Number(e.target.value);
      applySettings(tempSettings);
    };
  }

  /* Font */
  const range = settingsPanel.querySelector(".fontRange");
  preview.style.fontSize = settings.fontSize+"px";
  range.oninput=e=>{
    tempSettings.fontSize = Number(e.target.value);
    preview.style.fontSize=tempSettings.fontSize+"px";
    applySettings(tempSettings);
  };

  const select = settingsPanel.querySelector(".fontSelect");
  select.value=settings.fontFamily;
  select.onchange=e=>{
    tempSettings.fontFamily=e.target.value;
    applySettings(tempSettings);
  };

  /* Ruled */
  const ruled = settingsPanel.querySelector(".ruledCheck");
  ruled.checked=settings.ruled;
  ruled.onchange=e=>{
    tempSettings.ruled=e.target.checked;
    applySettings(tempSettings);
  };

  /* Save */
  settingsPanel.querySelector(".saveBtn").onclick=()=>{
    saveSettings();
    settingsPanel.style.display="none";
  };

  /* Reset */
  settingsPanel.querySelector(".reset").onclick=()=>{
    if(!confirm("Reset everything?"))return;
    chrome.storage.local.clear();
    location.reload();
  };
}

/* ================= NOTES ================= */
function createNote(){
  notes[PAGE] ??=[];
  const n={
    id:crypto.randomUUID(),
    title:"New note",
    text:"",
    x:220,y:200,
    w:360,h:380,
    fixed:false,
    min:false,
    z:Date.now()
  };

  notes[PAGE].push(n);
  save();
  renderNote(n);
  refreshList();
}

function renderNotes(){
  document.querySelectorAll(".na-note").forEach(e=>e.remove());
  (notes[PAGE]||[]).forEach(renderNote);
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
      <span class="na-title">${n.title}</span>
      <div class="na-controls">
        <button class="pin"></button>
        <button class="min"></button>
        <button class="cls"></button>
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

  ta.oninput=()=>{
    n.text=ta.value;
    const t=ta.value.split("\n")[0];
    if(t){
      n.title=t.slice(0,40);
      el.querySelector(".na-title").textContent=n.title;
    }
    save();
    refreshList();
  };

  const pin=el.querySelector(".pin");
  if(n.fixed) pin.classList.add("active");
  pin.onclick=()=>{
    n.fixed=!n.fixed;
    el.style.position=n.fixed?"fixed":"absolute";
    pin.classList.toggle("active");
    save();
  };

  el.querySelector(".min").onclick=()=>{
    n.min=!n.min;
    el.classList.toggle("minimized",n.min);
    save();
  };

  el.querySelector(".cls").onclick=()=>{
    el.remove();
    notes[PAGE]=notes[PAGE].filter(x=>x.id!==n.id);
    save();
    refreshList();
  };

  drag(el,n);
  resize(el,n,ta);
}

/* DRAG */
function drag(el,n){
  const h=el.querySelector(".na-header");
  let drag=false,dx,dy;

  h.onmousedown=e=>{
    drag=true;
    document.body.style.userSelect="none";

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
    };
  };
}

/* RESIZE */
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
    };
  };
}

/* LIST */
function refreshList(){
  if(!panel)return;
  const ul=panel.querySelector("#list");
  ul.innerHTML="";

  (notes[PAGE]||[]).forEach(n=>{
    const li=document.createElement("li");
    li.textContent=n.title;

    li.onclick=()=>{
      const el=document.querySelector(`[data-id="${n.id}"]`);
      el?.classList.add("highlight");
      setTimeout(()=>el?.classList.remove("highlight"),600);
      el.style.zIndex=Date.now();
    };

    ul.appendChild(li);
  });
}

/* OTHERS */
function toggleHide(){
 hidden=!hidden;
 hidden?hideAll():showAll();
}
function hideAll(){
 document.querySelectorAll(".na-note").forEach(n=>n.style.display="none");
}
function showAll(){
 document.querySelectorAll(".na-note").forEach(n=>n.style.display="block");
}

function deleteAll(){
 if(!confirm("Delete all notes?")) return;
 document.querySelectorAll(".na-note").forEach(n=>n.remove());
 delete notes[PAGE];
 save();
}

})();
