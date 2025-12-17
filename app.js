if (!window.Konva) { console.warn('Konva failed to load'); }
// NOTE: iOS Safari + GitHub Pages can sometimes block PDF.js web worker loading.
// Disabling the worker makes loading more reliable (a bit slower for huge PDFs).
if (window.pdfjsLib) {
  try { window.window.pdfjsLib.disableWorker = true; } catch(e) {}
}
const els = {
  openBtn: document.getElementById("openBtn"),
  file: document.getElementById("file"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  overlay: document.getElementById("overlay"),
  pgLabel: document.getElementById("pgLabel"),
  fileStatus: document.getElementById("fileStatus"),
  prevPg: document.getElementById("prevPg"),
  nextPg: document.getElementById("nextPg"),
  toolCount: document.getElementById("toolCount"),
  toolLine: document.getElementById("toolLine"),
  toolScale: document.getElementById("toolScale"),
  modeLabel: document.getElementById("modeLabel"),
  addSymbol: document.getElementById("addSymbol"),
  symbols: document.getElementById("symbols"),
  summary: document.getElementById("summary"),
  linearList: document.getElementById("linearList"),
  exportCsv: document.getElementById("exportCsv"),
  exportPng: document.getElementById("exportPng"),
  clearPage: document.getElementById("clearPage"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  zoomFit: document.getElementById("zoomFit"),
  zoomLabel: document.getElementById("zoomLabel"),
  toast: document.getElementById("toast"),
  scaleLabel: document.getElementById("scaleLabel"),
  units: document.getElementById("units"),
};

let pdfDoc = null;
let pageNum = 1;
let viewport = null;
let baseFitScale = null;
let zoom = 1.0;
let scaleFactor = null; // real units per pixel
let units = "ft";

let stage = null;
let layer = null;

let mode = "idle"; // count | line | scale
let activeSymbol = null;

const project = {
  symbols: [
    { key: "DUP", label: "Duplex Recept", color: "#ff4b4b" },
    { key: "GFCI", label: "GFCI", color: "#2aa3ff" },
    { key: "SW", label: "Switch", color: "#44f0a6" },
    { key: "LT", label: "Light Fixture", color: "#ffd35a" },
  ],
  pages: {}
};

function toast(msg){
  els.toast.textContent = msg;
  els.toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>els.toast.style.display="none", 2400);
}

function setMode(newMode){
  mode = newMode;
  els.toolCount.classList.toggle("ghost", mode !== "count");
  els.toolLine.classList.toggle("ghost", mode !== "line");
  els.toolScale.classList.toggle("ghost", mode !== "scale");

  let label = "Mode: Idle";
  if(mode === "count") label = "Mode: Count (click to place)";
  if(mode === "line") label = "Mode: Linear (click points, double-click to finish)";
  if(mode === "scale") label = "Mode: Set Scale (click two points)";
  els.modeLabel.textContent = label;
}

function ensurePageData(pg){
  if(!project.pages[pg]) project.pages[pg] = { counts: [], lines: [] };
  return project.pages[pg];
}

function getSymbol(key){ return project.symbols.find(s => s.key === key); }

function renderSymbols(){
  els.symbols.innerHTML = "";
  project.symbols.forEach(sym => {
    const row = document.createElement("div");
    row.className = "sym" + (activeSymbol === sym.key ? " active" : "");
    row.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center">
        <span style="width:12px;height:12px;border-radius:4px;background:${sym.color};display:inline-block"></span>
        <div>
          <div style="font-weight:800">${sym.key}</div>
          <div style="font-size:12px;color:var(--muted)">${sym.label}</div>
        </div>
      </div>
      <span class="badge" id="badge_${sym.key}">0</span>
    `;
    row.addEventListener("click", () => {
      activeSymbol = sym.key;
      setMode("count");
      renderSymbols();
      updateSummary();
      toast(`Selected: ${sym.key}`);
    });
    els.symbols.appendChild(row);
  });
}

function sumRow(left, right){
  const d = document.createElement("div");
  d.className = "sumRow";
  d.innerHTML = `<span>${escapeHtml(left)}</span><span>${escapeHtml(String(right))}</span>`;
  return d;
}

function escapeHtml(s){
  return String(s).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function round(n, d=2){
  const p = Math.pow(10,d);
  return Math.round(n*p)/p;
}

function formatLen(n){
  if(n == null || Number.isNaN(n)) return "—";
  return `${round(n,2)} ${units}`;
}

function updateSummary(){
  const pd = ensurePageData(pageNum);
  const countsBy = {};
  pd.counts.forEach(c => { countsBy[c.key] = (countsBy[c.key]||0) + 1; });
  project.symbols.forEach(sym => {
    const b = document.getElementById(`badge_${sym.key}`);
    if(b) b.textContent = String(countsBy[sym.key] || 0);
  });

  // totals all pages
  const totals = {};
  Object.keys(project.pages).forEach(pg => {
    project.pages[pg].counts.forEach(c => totals[c.key] = (totals[c.key]||0)+1);
  });
  els.summary.innerHTML = "";
  const keys = Object.keys(totals).sort();
  if(keys.length === 0){
    els.summary.innerHTML = `<div class="sumRow"><span>No counts yet</span><span>—</span></div>`;
  } else {
    keys.forEach(k => els.summary.appendChild(sumRow(k, totals[k])));
  }

  // linear list
  els.linearList.innerHTML = "";
  let anyLine = false;
  Object.keys(project.pages).forEach(pg => {
    project.pages[pg].lines.forEach(l => {
      anyLine = true;
      els.linearList.appendChild(sumRow(`${l.name} (p${pg})`, formatLen(l.realLen)));
    });
  });
  if(!anyLine){
    els.linearList.innerHTML = `<div class="sumRow"><span>No linear yet</span><span>—</span></div>`;
  }
}

async function loadPdf(file){
  if (!window.pdfjsLib) { toast('PDF.js is still loading. Refresh the page and try again.'); return; }

  try {
    if (els.fileStatus) els.fileStatus.textContent = `${file.name} (${Math.round(file.size/1024)} KB)`;
  } catch(e) {}

  const ab = await file.arrayBuffer();
  let loadingTask;
  try {
    loadingTask = window.pdfjsLib.getDocument({data: ab});
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    console.error(err);
    toast(`PDF load failed: ${err && err.message ? err.message : err}`);
    return;
  }
  pageNum = 1;
  toast(`Loaded PDF (${pdfDoc.numPages} pages)`);
  await renderPage(pageNum);
}

async function renderPage(num){
  if(!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const canvas = els.pdfCanvas;
  const ctx = canvas.getContext("2d");

  const viewer = document.getElementById("viewer");
  const viewerW = viewer.clientWidth;
  const unscaled = page.getViewport({ scale: 1.0 });
  baseFitScale = (viewerW - 20) / unscaled.width;
  if (!baseFitScale || baseFitScale <= 0) baseFitScale = 1.0;
  viewport = page.getViewport({ scale: baseFitScale * zoom });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({canvasContext: ctx, viewport}).promise;

  setupStage(canvas.width, canvas.height);
  redrawPageMarkups();

  els.pgLabel.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;
  updateZoomLabel();
  setMode(mode === "idle" ? "count" : mode);
  updateScaleLabel();
  updateSummary();
}

function setupStage(w,h){
  els.overlay.innerHTML = "";
  stage = new Konva.Stage({ container: "overlay", width: w, height: h });
  layer = new Konva.Layer();
  stage.add(layer);

  stage.on("click tap", () => {
    if(!pdfDoc) return;
    const pos = stage.getPointerPosition();
    if(!pos) return;

    if(mode === "count"){
      if(!activeSymbol){ toast("Pick a count item first"); return; }
      placeCount(activeSymbol, pos.x, pos.y);
      return;
    }
    if(mode === "line"){ handleLineClick(pos.x, pos.y); return; }
    if(mode === "scale"){ handleScaleClick(pos.x, pos.y); return; }
  });

  stage.on("dblclick dbltap", () => {
    if(mode === "line") finishLine();
  });

  // Ctrl/Trackpad wheel zoom (Mac)
  stage.on("wheel", async (e) => {
    e.evt.preventDefault();
    if (!pdfDoc) return;
    const delta = e.evt.deltaY;
    const factor = delta > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.25, Math.min(6, zoom * factor));
    await renderPage(pageNum);
  });

  els.overlay.style.touchAction = "manipulation";
}

function placeCount(key,x,y){
  const sym = getSymbol(key);
  const pd = ensurePageData(pageNum);
  const mark = { key, x, y };
  pd.counts.push(mark);

  const dot = new Konva.Circle({
    x, y, radius: 7, fill: sym?.color || "#ff4b4b", opacity: 0.85,
    stroke: "rgba(255,255,255,.65)", strokeWidth: 1
  });
  const txt = new Konva.Text({
    x: x + 10, y: y - 8, text: key, fontSize: 12, fontStyle: "bold",
    fill: "rgba(255,255,255,.9)",
    shadowColor: "rgba(0,0,0,.6)", shadowBlur: 6
  });
  const grp = new Konva.Group({ draggable: true });
  grp.add(dot); grp.add(txt);

  grp.on("contextmenu", (e)=>{
    e.evt.preventDefault();
    removeMarkup(grp, "count", mark);
  });

  layer.add(grp);
  layer.draw();
  updateSummary();
}

function removeMarkup(group, type, ref){
  const pd = ensurePageData(pageNum);
  if(type === "count"){
    const idx = pd.counts.indexOf(ref);
    if(idx >= 0) pd.counts.splice(idx,1);
  }
  if(type === "line"){
    const idx = pd.lines.indexOf(ref);
    if(idx >= 0) pd.lines.splice(idx,1);
  }
  group.destroy();
  layer.draw();
  updateSummary();
  toast("Removed markup");
}

let lineWorking = null;
let linePoints = [];
let lineName = "3/4 EMT";

function handleLineClick(x,y){
  if(!scaleFactor){ toast("Set scale first (Set Scale)"); return; }
  if(!lineWorking){
    lineName = prompt("Line name (ex: 3/4 EMT, 1 EMT, FMC whip)", lineName) || lineName;
    linePoints = [x,y];
    lineWorking = new Konva.Line({
      points: linePoints,
      stroke: "#2aa3ff",
      strokeWidth: 3,
      lineCap: "round",
      lineJoin: "round",
      shadowColor: "rgba(0,0,0,.55)",
      shadowBlur: 6
    });
    layer.add(lineWorking);
  } else {
    linePoints.push(x,y);
    lineWorking.points(linePoints);
  }
  layer.draw();
}

function polylinePxLength(pts){
  let len = 0;
  for(let i=0;i<pts.length-2;i+=2){
    const x1 = pts[i], y1 = pts[i+1];
    const x2 = pts[i+2], y2 = pts[i+3];
    const dx = x2-x1, dy = y2-y1;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

function finishLine(){
  if(!lineWorking || linePoints.length < 4) return;
  const pd = ensurePageData(pageNum);
  const pxLen = polylinePxLength(linePoints);
  const realLen = pxLen * scaleFactor;

  const ref = { name: lineName, points: [...linePoints], pxLen, realLen };
  pd.lines.push(ref);

  const lastX = linePoints[linePoints.length-2];
  const lastY = linePoints[linePoints.length-1];

  const lbl = new Konva.Text({
    x: lastX + 8, y: lastY + 6,
    text: `${lineName} • ${formatLen(realLen)}`,
    fontSize: 12, fill: "rgba(255,255,255,.9)",
    shadowColor: "rgba(0,0,0,.6)", shadowBlur: 6
  });

  const grp = new Konva.Group({ draggable: true });

  const finalLine = new Konva.Line({
    points: [...linePoints],
    stroke: "#2aa3ff",
    strokeWidth: 3,
    lineCap: "round",
    lineJoin: "round",
    shadowColor: "rgba(0,0,0,.55)",
    shadowBlur: 6
  });

  grp.add(finalLine); grp.add(lbl);
  grp.on("contextmenu", (e)=>{
    e.evt.preventDefault();
    removeMarkup(grp, "line", ref);
  });

  lineWorking.destroy();
  layer.add(grp);
  lineWorking = null;
  linePoints = [];
  layer.draw();
  updateSummary();
  toast("Linear saved (right-click / long-press to remove)");
}

let scaleClicks = [];
function handleScaleClick(x,y){
  scaleClicks.push({x,y});
  const dot = new Konva.Circle({x,y,radius:6,fill:"#ffd35a",opacity:.9,stroke:"rgba(255,255,255,.7)",strokeWidth:1});
  layer.add(dot); layer.draw();

  if(scaleClicks.length === 2){
    const a = scaleClicks[0], b = scaleClicks[1];
    const px = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2);
    const real = prompt(`Enter REAL distance between points (in ${units}). Example: 3 for 3 ft`, "3");
    const realNum = parseFloat(real);
    if(!realNum || realNum <= 0 || !px || px <= 0){
      toast("Scale not set (invalid input)");
      scaleClicks = [];
      redrawPageMarkups();
      return;
    }
    scaleFactor = realNum / px;
    toast(`Scale set: 1 px = ${round(scaleFactor,6)} ${units}`);
    scaleClicks = [];
    updateScaleLabel();
    redrawPageMarkups();
    updateSummary();
  }
}

function updateScaleLabel(){
  units = els.units.value;
  if(scaleFactor){
    els.scaleLabel.textContent = `1 px = ${round(scaleFactor,6)} ${units}`;
  } else {
    els.scaleLabel.textContent = "Not set";
  }
}

function redrawPageMarkups(){
  const pd = ensurePageData(pageNum);
  layer.destroyChildren();

  pd.counts.forEach(c => {
    const sym = getSymbol(c.key);
    const grp = new Konva.Group({ draggable: true });
    const dot = new Konva.Circle({ x:c.x, y:c.y, radius:7, fill:sym?.color||"#ff4b4b", opacity:.85, stroke:"rgba(255,255,255,.65)", strokeWidth:1 });
    const txt = new Konva.Text({ x:c.x+10, y:c.y-8, text:c.key, fontSize:12, fontStyle:"bold", fill:"rgba(255,255,255,.9)",
      shadowColor:"rgba(0,0,0,.6)", shadowBlur:6 });
    grp.add(dot); grp.add(txt);
    grp.on("contextmenu", (e)=>{ e.evt.preventDefault(); removeMarkup(grp,"count",c); });
    layer.add(grp);
  });

  pd.lines.forEach(l => {
    const grp = new Konva.Group({ draggable: true });
    const ln = new Konva.Line({ points:l.points, stroke:"#2aa3ff", strokeWidth:3, lineCap:"round", lineJoin:"round",
      shadowColor:"rgba(0,0,0,.55)", shadowBlur:6 });
    const lastX = l.points[l.points.length-2];
    const lastY = l.points[l.points.length-1];
    const lbl = new Konva.Text({ x:lastX+8, y:lastY+6, text:`${l.name} • ${formatLen(l.realLen)}`,
      fontSize:12, fill:"rgba(255,255,255,.9)", shadowColor:"rgba(0,0,0,.6)", shadowBlur:6 });
    grp.add(ln); grp.add(lbl);
    grp.on("contextmenu", (e)=>{ e.evt.preventDefault(); removeMarkup(grp,"line",l); });
    layer.add(grp);
  });

  layer.draw();
}

function download(url, filename){
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

function exportCSV(){
  const rows = [];
  rows.push(["Type","Item","Qty/Length","Units","Page","Notes"].join(","));

  Object.keys(project.pages).forEach(pg => {
    const map = {};
    project.pages[pg].counts.forEach(c => map[c.key] = (map[c.key]||0)+1);
    Object.keys(map).sort().forEach(k => rows.push(["COUNT",k,map[k],"ea",pg,""].join(",")));
  });

  Object.keys(project.pages).forEach(pg => {
    project.pages[pg].lines.forEach(l => rows.push(["LINE",l.name,round(l.realLen,2),units,pg,""].join(",")));
  });

  const blob = new Blob([rows.join("\n")], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  download(url, `clearpath_takeoff_${Date.now()}.csv`);
  toast("CSV exported");
}

function exportMarkedPNG(){
  if(!pdfDoc) return;
  const pdfCanvas = els.pdfCanvas;
  const out = document.createElement("canvas");
  out.width = pdfCanvas.width;
  out.height = pdfCanvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(pdfCanvas, 0, 0);

  const overlayURL = stage.toDataURL({ pixelRatio: 1 });
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    const url = out.toDataURL("image/png");
    download(url, `clearpath_marked_page${pageNum}.png`);
    toast("Marked PNG exported");
  };
  img.src = overlayURL;
}

function clearCurrentPage(){
  if(!pdfDoc) return;
  if(!confirm("Clear ALL markups on this page?")) return;
  project.pages[pageNum] = { counts: [], lines: [] };
  redrawPageMarkups();
  updateSummary();
  toast("Page cleared");
}

function randomColor(){
  const palette = ["#ff4b4b","#2aa3ff","#44f0a6","#ffd35a","#b388ff","#ff7ad9","#7ff3ff","#ff9f43"];
  return palette[Math.floor(Math.random()*palette.length)];
}

function addSymbol(){
  const key = (prompt("Symbol key (short) e.g., EXIT, PB, JBOX", "EXIT") || "").trim().toUpperCase();
  if(!key) return;
  if(project.symbols.some(s => s.key === key)){ toast("That key already exists"); return; }
  const label = (prompt("Label/Description", key) || "").trim();
  project.symbols.push({ key, label, color: randomColor() });
  activeSymbol = key;
  renderSymbols();
  updateSummary();
  toast(`Added symbol: ${key}`);
}

els.openBtn.addEventListener("click", ()=>{
  els.file.click();
});

els.file.addEventListener("change", (e)=>{
  const f = e.target.files && e.target.files[0];
  if(f) loadPdf(f);
});

els.prevPg.addEventListener("click", async ()=>{
  if(!pdfDoc) return;
  pageNum = Math.max(1, pageNum-1);
  await renderPage(pageNum);
});

els.nextPg.addEventListener("click", async ()=>{
  if(!pdfDoc) return;
  pageNum = Math.min(pdfDoc.numPages, pageNum+1);
  await renderPage(pageNum);
});

els.zoomIn.addEventListener("click", async ()=>{
  if (!pdfDoc) return;
  zoom = Math.min(6, zoom * 1.25);
  await renderPage(pageNum);
});
els.zoomOut.addEventListener("click", async ()=>{
  if (!pdfDoc) return;
  zoom = Math.max(0.25, zoom / 1.25);
  await renderPage(pageNum);
});
els.zoomFit.addEventListener("click", async ()=>{
  if (!pdfDoc) return;
  zoom = 1.0;
  await renderPage(pageNum);
});

els.toolCount.addEventListener("click", ()=> setMode("count"));
els.toolLine.addEventListener("click", ()=> setMode("line"));
els.toolScale.addEventListener("click", ()=>{ setMode("scale"); toast("Click two points on a known dimension"); });

els.exportCsv.addEventListener("click", exportCSV);
els.exportPng.addEventListener("click", exportMarkedPNG);
els.clearPage.addEventListener("click", clearCurrentPage);
els.addSymbol.addEventListener("click", addSymbol);

els.units.addEventListener("change", ()=>{
  units = els.units.value;
  updateScaleLabel();
  redrawPageMarkups();
  updateSummary();
});

activeSymbol = project.symbols[0].key;
renderSymbols();
setMode("idle");
updateSummary();


function updateZoomLabel(){
  if (els.zoomLabel){
    const pct = Math.round(zoom * 100);
    els.zoomLabel.textContent = `${pct}%`;
  }
}
