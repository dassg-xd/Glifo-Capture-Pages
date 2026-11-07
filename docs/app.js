import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, push, update, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp, onDisconnect, set, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const LETRAS = "abcdefghijklmnñopqrstuvwxyz".split("");
const META = 70, ESPACIO = 1000;
const GUIAS = { ascendente: 180, alturaX: 420, base: 700, descendente: 900 };
const clave = l => l === "ñ" ? "enie" : l;
const SIN_GRUPO = "Sin grupo";
const LOCAL_KEY = "glifo-captura-local-v1";

const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const normGrupo = g => (g || "").trim().replace(/\s+/g, " ") || SIN_GRUPO;

let actual = "a", trazos = [], t0 = null, dibujando = false, tipoPuntero = "mouse";
let indice = {};          // id -> {uid, autor, grupo, letra, creado, puntos}
let trazosCache = {};     // id -> [[x,y,t,...], ...] (solo la letra actual)
let pares = [];           // [{uid, autor, grupo, letra, esYo}]
let db = null, auth = null, uid = null, esDirector = false, modo = "wait", conectado = false;
let soltarTrazos = null, soltarPresencia = null;
let borrandoTodo = false;  // mientras dura el borrado total, el botón queda bloqueado

// ---------- autor y grupo ----------
for (const k of ["autor", "grupo"]) {
  try { $(k).value = localStorage.getItem("glifo-" + k) || ""; } catch (e) {}
  $(k).addEventListener("input", () => {
    try { localStorage.setItem("glifo-" + k, $(k).value.trim()); } catch (e) {}
    anunciar(); pedirRender(); actualizarLectura();
  });
}
const miGrupo = () => normGrupo($("grupo").value);
const miNombre = () => $("autor").value.trim() || "anonimo";
const nombreOk = () => $("autor").value.trim().length >= 2;
const grupoOk = () => $("grupo").value.trim().length >= 1;

// ---------- lienzo ----------
function ajustar() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  dibujar();
}
const aLienzoY = v => v / ESPACIO * cv.height;
function dibujarGuias() {
  const w = cv.width, dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.font = `${12 * dpr}px ${tok("--sans")}`;
  ctx.textBaseline = "bottom";
  const nombres = { ascendente: "ascendente", alturaX: "altura x", base: "línea base", descendente: "descendente" };
  for (const [nombre, y] of Object.entries(GUIAS)) {
    const yy = aLienzoY(y);
    ctx.strokeStyle = nombre === "base" ? tok("--guide-strong") : tok("--guide");
    ctx.lineWidth = (nombre === "base" ? 1.5 : 1) * dpr;
    ctx.setLineDash(nombre === "base" ? [] : [6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(12 * dpr, yy); ctx.lineTo(w - 12 * dpr, yy); ctx.stroke();
    ctx.fillStyle = tok("--muted");
    ctx.fillText(nombres[nombre], 16 * dpr, yy - 3 * dpr);
  }
  ctx.restore();
}
function dibujarTrazos(c, lista, escala, grosor, colorTrazo, colorInicio) {
  const sx = Array.isArray(escala) ? escala[0] : escala, sy = Array.isArray(escala) ? escala[1] : escala;
    c.lineCap = "round"; c.lineJoin = "round"; c.setLineDash([]);
  for (const p of lista) {
    if (!p.length) continue;
    c.strokeStyle = colorTrazo; c.lineWidth = grosor;
    c.beginPath(); c.moveTo(p[0][0] * sx, p[0][1] * sy);
    for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * sx, p[i][1] * sy);
    if (p.length === 1) c.lineTo(p[0][0] * sx + 0.1, p[0][1] * sy);
    c.stroke();
    if (colorInicio) { c.fillStyle = colorInicio; c.beginPath(); c.arc(p[0][0] * sx, p[0][1] * sy, grosor * 0.9, 0, Math.PI * 2); c.fill(); }
  }
}
function dibujar() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  dibujarGuias();
  const dpr = window.devicePixelRatio || 1;
  dibujarTrazos(ctx, trazos.map(s => s.puntos), [cv.width / ESPACIO, cv.height / ESPACIO], 5 * dpr, tok("--ink"), tok("--teal"));
  actualizarLectura();
}
let raf = 0;
const pedirDibujo = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; dibujar(); }); };
function punto(e) {
  const r = cv.getBoundingClientRect();
  const x = Math.min(ESPACIO, Math.max(0, (e.clientX - r.left) / r.width * ESPACIO));
  const y = Math.min(ESPACIO, Math.max(0, (e.clientY - r.top) / r.height * ESPACIO));
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(performance.now() - t0)];
}
cv.addEventListener("pointerdown", e => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  cv.setPointerCapture(e.pointerId);
  if (t0 === null) t0 = performance.now();
  tipoPuntero = e.pointerType || "mouse";
  dibujando = true;
  trazos.push({ puntos: [punto(e)] });
  pedirDibujo();
});
cv.addEventListener("pointermove", e => {
  if (!dibujando) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const s = trazos[trazos.length - 1].puntos;
  for (const ev of (evs.length ? evs : [e])) {
    const p = punto(ev), u = s[s.length - 1];
    if (Math.hypot(p[0] - u[0], p[1] - u[1]) >= 1.5) s.push(p);
  }
  pedirDibujo();
});
const terminar = () => { if (dibujando) { dibujando = false; pedirDibujo(); } };
cv.addEventListener("pointerup", terminar);
cv.addEventListener("pointercancel", terminar);

const totalPuntos = () => trazos.reduce((a, s) => a + s.puntos.length, 0);
function actualizarLectura() {
  $("rTrazos").textContent = trazos.length;
  $("rPuntos").textContent = totalPuntos();
  const ult = trazos.length ? trazos[trazos.length - 1].puntos : null;
  $("rDur").textContent = ((ult && ult.length ? ult[ult.length - 1][2] : 0) / 1000).toFixed(2) + " s";
  $("bUndo").disabled = !trazos.length;
  $("bClear").disabled = !trazos.length;
  const faltan = [];
  if (!nombreOk()) faltan.push("tu nombre");
  if (!grupoOk()) faltan.push("tu grupo");
  $("autor").setAttribute("aria-invalid", (!nombreOk() && trazos.length > 0) ? "true" : "false");
  $("grupo").setAttribute("aria-invalid", (!grupoOk() && trazos.length > 0) ? "true" : "false");
  const aviso = $("aviso");
  if (faltan.length) { aviso.hidden = false; aviso.textContent = "Para guardar, escribe " + faltan.join(" y ") + " en el panel de la derecha."; }
  else aviso.hidden = true;
  $("bSave").disabled = totalPuntos() < 8 || modo === "wait" || faltan.length > 0;
}
function limpiar() { trazos = []; t0 = null; dibujar(); }
function deshacer() { trazos.pop(); if (!trazos.length) t0 = null; dibujar(); }
$("bClear").onclick = limpiar;
$("bUndo").onclick = deshacer;
$("bSave").onclick = guardar;
document.addEventListener("keydown", e => {
  if (e.target.closest("input,textarea,select")) return;
  if (e.key === "Enter" && !$("bSave").disabled) { e.preventDefault(); guardar(); }
  else if (e.key === "Escape") limpiar();
  else if (e.key === "z" || e.key === "Z") { if (e.ctrlKey || e.metaKey) e.preventDefault(); deshacer(); }
});

// ---------- letras ----------
function seleccionar(l) {
  actual = l; $("promptLetter").textContent = l;
  limpiar(); anunciar(); seguirLetra(); render();
}
function construirGrid() {
  for (const l of LETRAS) {
    const b = document.createElement("button");
    b.className = "tile"; b.id = "tile-" + clave(l);
    b.innerHTML = `<span class="l"></span><span class="c">0/${META}</span><span class="f" style="width:0%"></span><span class="vivo" hidden></span>`;
    b.querySelector(".l").textContent = l;
    b.onclick = () => seleccionar(l);
    $("grid").appendChild(b);
  }
}
const muestras = () => Object.entries(indice).map(([id, m]) => ({ id, ...m }));
const contarLetra = l => muestras().filter(m => m.letra === l).length;
const otrosEn = l => pares.filter(p => !p.esYo && p.letra === l).length;
function siguiente() {
  const puntaje = l => contarLetra(l) * 10 + otrosEn(l) * 5;
  const cand = LETRAS.filter(l => l !== actual);
  const min = Math.min(...cand.map(puntaje));
  const opciones = cand.filter(l => puntaje(l) === min);
  seleccionar(opciones[Math.floor(Math.random() * opciones.length)]);
}
$("bNext").onclick = siguiente;

// ---------- render ----------
let rafRender = 0;
const pedirRender = () => { if (!rafRender) rafRender = requestAnimationFrame(() => { rafRender = 0; render(); }); };
function render() {
  const todas = muestras();
  const cuenta = Object.fromEntries(LETRAS.map(l => [l, 0]));
  for (const m of todas) if (m.letra in cuenta) cuenta[m.letra]++;
  let total = 0, pend = 0;
  for (const l of LETRAS) {
    const n = cuenta[l]; total += Math.min(n, META); if (n < META) pend++;
    const t = $("tile-" + clave(l));
    t.querySelector(".c").textContent = `${n}/${META}`;
    t.querySelector(".f").style.width = Math.min(100, n / META * 100) + "%";
    t.classList.toggle("done", n >= META);
    t.setAttribute("aria-pressed", l === actual ? "true" : "false");
    const v = otrosEn(l), vb = t.querySelector(".vivo");
    vb.hidden = !v; vb.textContent = v;
    t.setAttribute("aria-label", `Letra ${l}, ${n} muestras` + (v ? `, ${v} dibujándola ahora` : ""));
  }
  $("totalN").innerHTML = `${todas.length} <small>/ ${META * LETRAS.length}</small>`;
  $("totalBar").style.width = (total / (META * LETRAS.length) * 100) + "%";
  $("pendientes").textContent = pend ? `${pend} letras por completar` : "Todas las letras tienen su meta";
  if (!borrandoTodo) $("bBorrarTodo").disabled = !todas.length;
  renderMiniaturas(todas); renderGrupos(todas); renderVivo(todas);
}

const confirmando = new Set();
const puedeBorrar = m => esDirector || (!!uid && m.uid === uid);
function renderMiniaturas(todas) {
  const lista = todas.filter(m => m.letra === actual).sort((a, b) => (b.creado || 0) - (a.creado || 0));
  $("recentTitle").textContent = `Muestras de «${actual}»`;
  $("recentCount").textContent = lista.length ? `${lista.length} guardadas` : "";
  $("thumbsEmpty").hidden = lista.length > 0;
  const cont = $("thumbs"); cont.textContent = "";
  for (const m of lista) {
    const d = document.createElement("div"); d.className = "thumb";
    d.title = [m.autor || "anonimo", normGrupo(m.grupo), m.creado ? new Date(m.creado).toLocaleString("es-CO") : ""].join(" · ");
    const c = document.createElement("canvas"); c.width = 120; c.height = 120; d.appendChild(c);
    const cx = c.getContext("2d");
    cx.strokeStyle = tok("--guide-strong"); cx.lineWidth = 1;
    cx.beginPath(); const yb = GUIAS.base / ESPACIO * 120; cx.moveTo(6, yb); cx.lineTo(114, yb); cx.stroke();
    const t = trazosCache[m.id];
    if (t) dibujarTrazos(cx, aPuntos(t), 120 / ESPACIO, 3, tok("--ink"), null);
    const g = document.createElement("span"); g.className = "g"; g.textContent = normGrupo(m.grupo); d.appendChild(g);
    if (puedeBorrar(m)) {
      const x = document.createElement("button");
      const conf = confirmando.has(m.id);
      x.textContent = conf ? "¿Borrar?" : "✕";
      x.className = conf ? "confirm" : "";
      x.setAttribute("aria-label", conf ? "Confirmar borrado de la muestra" : "Borrar muestra");
      x.onclick = ev => {
        ev.stopPropagation();
        if (confirmando.has(m.id)) { confirmando.delete(m.id); borrar(m); }
        else { confirmando.add(m.id); pedirRender(); setTimeout(() => { if (confirmando.delete(m.id)) pedirRender(); }, 3500); }
      };
      d.appendChild(x);
    }
    cont.appendChild(d);
  }
}
function renderGrupos(todas) {
  const mapa = new Map();
  for (const m of todas) {
    const g = normGrupo(m.grupo);
    if (!mapa.has(g)) mapa.set(g, { n: 0, personas: new Set(), letras: new Set() });
    const e = mapa.get(g); e.n++; e.personas.add((m.autor || "anonimo").toLowerCase()); e.letras.add(m.letra);
  }
  const filas = [...mapa.entries()].sort((a, b) => b[1].n - a[1].n);
  const max = Math.max(1, ...filas.map(f => f[1].n));
  const ul = $("grupos"); ul.textContent = "";
  for (const [g, e] of filas) {
    const li = document.createElement("li"); li.className = "grp" + (g === miGrupo() ? " mio" : "");
    li.innerHTML = `<span class="nm"></span><span class="num"></span><span class="det"></span><span class="meter"><i></i></span>`;
    li.querySelector(".nm").textContent = g;
    li.querySelector(".num").textContent = e.n + (e.n === 1 ? " muestra" : " muestras");
    li.querySelector(".det").textContent = `${e.personas.size} ${e.personas.size === 1 ? "persona" : "personas"} · ${e.letras.size} de 27 letras`;
    li.querySelector(".meter i").style.width = (e.n / max * 100) + "%";
    ul.appendChild(li);
  }
  $("gruposEmpty").hidden = filas.length > 0;
  $("nGrupos").textContent = filas.length ? `${filas.length} ${filas.length === 1 ? "grupo" : "grupos"}` : "";
  const dl = $("gruposLista"); dl.textContent = "";
  const sel = $("filtro"), prev = sel.value;
  sel.length = 1;
  for (const [g] of filas) {
    const o = document.createElement("option"); o.value = g; dl.appendChild(o);
    const s = document.createElement("option"); s.value = g; s.textContent = g; sel.appendChild(s);
  }
  sel.value = filas.some(f => f[0] === prev) ? prev : "";
}
function haceCuanto(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "ahora";
  const m = Math.round(s / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  return new Date(ms).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}
function filaAct(letra, nombre, grupo, cuando, vivo) {
  const li = document.createElement("li"); li.className = "act" + (vivo ? " vivo" : "");
  li.innerHTML = `<span class="lt"></span><span class="who"><b></b> <span></span></span><time></time>`;
  li.querySelector(".lt").textContent = letra || "·";
  li.querySelector(".who b").textContent = nombre;
  li.querySelector(".who span").textContent = grupo;
  li.querySelector("time").textContent = cuando;
  return li;
}
function renderVivo(todas) {
  const otros = pares.filter(p => !p.esYo && p.autor);
  const ul = $("ahora"); ul.textContent = "";
  for (const p of otros.slice(0, 8)) ul.appendChild(filaAct(String(p.letra || "").slice(0, 1), String(p.autor).slice(0, 40), normGrupo(String(p.grupo || "")).slice(0, 30), "dibujando", true));
  $("ahoraEmpty").hidden = otros.length > 0;
  $("ahoraEmpty").textContent = db ? "Nadie más tiene la página abierta en este momento." : "La vista en vivo necesita la conexión a Firebase.";
  $("nLinea").textContent = db && pares.length ? `${pares.length} en línea` : "";
  const rec = (todas || muestras()).sort((a, b) => (b.creado || 0) - (a.creado || 0)).slice(0, 8);
  const ur = $("recientes"); ur.textContent = "";
  for (const m of rec) ur.appendChild(filaAct(m.letra, m.autor || "anonimo", normGrupo(m.grupo), m.creado ? haceCuanto(m.creado) : "", false));
  $("recientesEmpty").hidden = rec.length > 0;
}
setInterval(() => renderVivo(), 30000);

function sello(txt, err) {
  const s = $("stamp"); s.hidden = true; void s.offsetWidth;
  s.textContent = txt; s.className = "stamp" + (err ? " err" : ""); s.hidden = false;
  clearTimeout(sello.t); sello.t = setTimeout(() => s.hidden = true, err ? 6000 : 2200);
}
function estado(s, txt) { modo = s; $("status").dataset.s = s; $("statusTxt").textContent = txt; actualizarLectura(); }

// Formato en la base: cada trazo es una lista plana [x, y, t, x, y, t, ...]
const aPlano = lista => lista.map(s => s.puntos.flat());
function aPuntos(planos) {
  return (planos || []).map(f => { const out = []; for (let i = 0; i + 2 < f.length; i += 3) out.push([f[i], f[i + 1], f[i + 2]]); return out; });
}

// ---------- guardar y borrar ----------
async function guardar() {
  if (totalPuntos() < 8 || !nombreOk() || !grupoOk()) { actualizarLectura(); return; }
  const letra = actual;
  const base = {
    uid: uid || "local", autor: miNombre().slice(0, 40), grupo: miGrupo().slice(0, 30), letra,
    puntos: totalPuntos(), dispositivo: tipoPuntero
  };
  const planos = aPlano(trazos);
  $("bSave").disabled = true;
  if (db) {
    if (!uid) { sello("Aún no hay conexión con la base de datos. Espera un momento.", true); actualizarLectura(); return; }
    const id = push(ref(db, "indice")).key;
    try {
      await update(ref(db), {
        ["indice/" + id]: { ...base, creado: serverTimestamp() },
        ["trazos/" + id]: { uid, letra, trazos: planos }
      });
    } catch (e) {
      actualizarLectura();
      sello(String(e && e.code || "").includes("PERMISSION") ? "La base rechazó la muestra. Revisa tu nombre y grupo." : "No se pudo guardar. Revisa tu conexión.", true);
      return;
    }
  } else {
    const id = "local-" + Date.now();
    indice[id] = { ...base, creado: Date.now() };
    trazosCache[id] = planos;
    guardarLocal();
  }
  limpiar();
  sello(`«${letra}» guardada para ${base.grupo}`);
  pedirRender();
}
async function borrar(m) {
  if (db) {
    try { await update(ref(db), { ["indice/" + m.id]: null, ["trazos/" + m.id]: null }); }
    catch (e) {
      sello(esDirector ? "Firebase rechazó el borrado. Revisa que el correo de las reglas sea el mismo con el que entraste."
                       : "Solo puedes borrar las muestras que publicaste tú.", true);
    }
  } else {
    delete indice[m.id]; delete trazosCache[m.id]; guardarLocal(); pedirRender();
  }
}
// Borra TODAS las muestras del dataset (solo el director). Las reglas no dejan borrar /indice ni /trazos
// de un golpe, pero sí cada muestra por separado: se envían actualizaciones de varias rutas por lotes,
// cada una con el índice y los trazos de LOTE_BORRADO muestras, para no mandar una sola escritura enorme.
const LOTE_BORRADO = 200;
async function borrarTodo(alAvanzar) {
  if (!db || !esDirector) throw new Error("solo-director");
  const ids = Object.keys(indice);
  let hechas = 0;
  for (let i = 0; i < ids.length; i += LOTE_BORRADO) {
    const rutas = {};
    for (const id of ids.slice(i, i + LOTE_BORRADO)) { rutas["indice/" + id] = null; rutas["trazos/" + id] = null; }
    await update(ref(db), rutas);
    hechas += Object.keys(rutas).length / 2;
    if (alAvanzar) alAvanzar(hechas, ids.length);
  }
  return hechas;
}
function guardarLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Object.entries(indice).map(([id, m]) => ({ id, ...m, trazos: trazosCache[id] })))); } catch (e) {}
}
function cargarLocal() {
  try { for (const m of JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]")) { const { id, trazos: t, ...r } = m; indice[id] = r; trazosCache[id] = t; } } catch (e) {}
}

// ---------- tiempo real ----------
function seguirLetra() {
  if (!db || !uid) return;
  if (soltarTrazos) soltarTrazos();
  trazosCache = {};
  const q = query(ref(db, "trazos"), orderByChild("letra"), equalTo(actual));
  soltarTrazos = onValue(q, snap => {
    const nuevo = {};
    snap.forEach(ch => { nuevo[ch.key] = (ch.val() || {}).trazos || []; });
    trazosCache = nuevo; pedirRender();
  }, () => {});
}
let tAnuncio = 0;
function anunciar() {
  if (!db || !uid) return;
  clearTimeout(tAnuncio);
  tAnuncio = setTimeout(() => {
    set(ref(db, "presencia/" + uid), { autor: miNombre().slice(0, 40), grupo: miGrupo().slice(0, 30), letra: actual, t: serverTimestamp() }).catch(() => {});
  }, 300);
}
function arrancarTiempoReal() {
  onValue(ref(db, "indice"), snap => { indice = snap.val() || {}; pedirRender(); },
    () => estado("local", "Sin permiso para leer el dataset"));
  onValue(ref(db, ".info/connected"), snap => {
    conectado = !!snap.val();
    if (conectado && uid) {
      onDisconnect(ref(db, "presencia/" + uid)).remove().then(anunciar).catch(() => {});
      estado("ok", esDirector ? "Dataset compartido · director" : "Dataset compartido");
    } else if (!conectado && modo !== "wait") estado("local", "Sin conexión, reintentando…");
  });
  onValue(ref(db, "presencia"), snap => {
    const v = snap.val() || {};
    pares = Object.entries(v).map(([k, p]) => ({ uid: k, esYo: k === uid, autor: p && p.autor, grupo: p && p.grupo, letra: p && p.letra }));
    pedirRender();
  }, () => {});
}

// ---------- director ----------
const espera = ms => new Promise(r => setTimeout(r, ms));
// La regla de /director solo deja leer al correo del director: si la lectura no es rechazada, es el director.
// Justo después de iniciar sesión con Google, la conexión con la base puede seguir usando la identidad
// anónima unos instantes, así que se reintenta varias veces antes de concluir que no es el director.
async function comprobarDirector(intentos = 1) {
  esDirector = false;
  const u = auth.currentUser;
  if (u && !u.isAnonymous) {
    for (let i = 0; i < intentos && !esDirector; i++) {
      if (i) await espera(700);
      try { await get(ref(db, "director")); esDirector = true; } catch (e) { esDirector = false; }
    }
  }
  const correo = u && !u.isAnonymous ? (u.email || (u.providerData[0] || {}).email || "Google") : "";
  $("bDirector").textContent = esDirector ? "Salir del modo director" : (correo ? `Salir (${correo})` : "Entrar como director");
  $("bDirector").title = correo ? "Sesión iniciada con " + correo : "";
  $("admin").hidden = !esDirector;
  if (conectado) estado("ok", esDirector ? "Dataset compartido · director" : "Dataset compartido");
  pedirRender();
}
function mensajeGoogle(code) {
  const m = {
    "auth/operation-not-allowed": "Google no está activado en Firebase: Authentication → Método de acceso → Google.",
    "auth/unauthorized-domain": "Este dominio no está autorizado: agrégalo en Authentication → Configuración → Dominios autorizados.",
    "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta página.",
    "auth/network-request-failed": "No hay conexión con Google. Revisa tu internet."
  };
  return m[code] || `No se pudo iniciar sesión con Google (${code || "error desconocido"}).`;
}
$("bDirector").onclick = async () => {
  if (!auth) { sello("Primero hay que configurar Firebase (ver README).", true); return; }
  const u = auth.currentUser;
  if (u && !u.isAnonymous) {
    if (uid) await set(ref(db, "presencia/" + uid), null).catch(() => {});
    await signOut(auth); await signInAnonymously(auth).catch(() => {});
    return;
  }
  const prov = new GoogleAuthProvider();
  try {
    try { await linkWithPopup(u, prov); }
    catch (e) {
      if (e && e.code === "auth/credential-already-in-use") {
        if (uid) await set(ref(db, "presencia/" + uid), null).catch(() => {});
        await signInWithPopup(auth, prov);
      }
      else throw e;
    }
    await auth.currentUser.getIdToken(true);
    await comprobarDirector(6);
    if (!esDirector) {
      const c = auth.currentUser && (auth.currentUser.email || (auth.currentUser.providerData[0] || {}).email);
      sello(`La cuenta ${c || ""} no coincide con el correo del director en las reglas de Firebase.`, true);
    }
  } catch (e) {
    if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") sello(mensajeGoogle(e && e.code), true);
  }
};

// ---------- exportar ----------
// Formato para entrenar: un grupo por letra (a … z, con la ñ) y una fila por muestra.
// Cada fila es la lista de trazos de esa muestra; cada trazo es una lista de puntos [x, y, t_ms].
function jsonPorLetra(muestrasOrdenadas) {
  const g = Object.fromEntries(LETRAS.map(l => [l, []]));
  for (const m of muestrasOrdenadas) if (g[m.letra]) g[m.letra].push(m.trazos);
  return "{\n" + LETRAS.map(l => g[l].length
    ? "  " + JSON.stringify(l) + ": [\n" + g[l].map(t => "    " + JSON.stringify(t)).join(",\n") + "\n  ]"
    : "  " + JSON.stringify(l) + ": []").join(",\n") + "\n}\n";
}
async function exportar({ todos: todosLosGrupos = false, msg = $("exportMsg") } = {}) {
  const filtro = todosLosGrupos ? "" : $("filtro").value;
  let todos = {};
  try {
    msg.textContent = "Preparando archivo…";
    if (db) { const snap = await get(ref(db, "trazos")); snap.forEach(ch => { todos[ch.key] = (ch.val() || {}).trazos || []; }); }
    else todos = trazosCache;
  } catch (e) { msg.textContent = "No se pudieron descargar los trazos. Revisa tu conexión."; return; }
  const lista = muestras().filter(m => !filtro || normGrupo(m.grupo) === filtro).sort((a, b) => (a.creado || 0) - (b.creado || 0));
  const salida = lista.filter(m => todos[m.id]).map(m => ({ letra: m.letra, trazos: aPuntos(todos[m.id]) }));
  if (!salida.length) { msg.textContent = "Aún no hay muestras para exportar."; return; }
  const sufijo = filtro ? "-" + filtro.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
  const nombre = `glifo-dataset${sufijo}-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([jsonPorLetra(salida)], { type: "application/json" }));
  a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  msg.textContent = `${salida.length} muestras exportadas en ${nombre}.`;
}
$("bExport").onclick = () => exportar();

// ---------- borrar todo (director) ----------
// Doble protección contra borrados accidentales: un diálogo que muestra cuántas muestras se pierden
// y exige escribir BORRAR. El botón de confirmar solo se activa con esa palabra exacta.
const PALABRA = "BORRAR";
const dlg = $("dlgBorrar");
const nMuestras = n => `${n} ${n === 1 ? "muestra" : "muestras"}`;
function abrirBorrado() {
  if (!esDirector) { sello("Solo el director puede borrar todo el dataset.", true); return; }
  const n = muestras().length;
  if (!n) { $("adminMsg").textContent = "El dataset ya está vacío."; return; }
  $("dlgN").textContent = nMuestras(n);
  $("dlgConfirmar").textContent = `Borrar ${nMuestras(n)}`;
  $("dlgTexto").value = ""; $("dlgTexto").disabled = false;
  $("dlgConfirmar").disabled = true; $("dlgCancelar").disabled = false;
  $("dlgMsg").textContent = "";
  dlg.showModal();
  $("dlgCancelar").focus();   // el foco empieza en Cancelar, no en el botón peligroso
}
$("bBorrarTodo").onclick = abrirBorrado;
$("dlgTexto").addEventListener("input", () => {
  $("dlgConfirmar").disabled = $("dlgTexto").value.trim().toUpperCase() !== PALABRA;
});
$("dlgCancelar").onclick = () => dlg.close();
dlg.addEventListener("cancel", e => { if (borrandoTodo) e.preventDefault(); });   // Esc no cierra a mitad del borrado
$("dlgRespaldo").onclick = () => exportar({ todos: true, msg: $("dlgMsg") });
$("formBorrar").addEventListener("submit", async e => {
  e.preventDefault();
  if ($("dlgTexto").value.trim().toUpperCase() !== PALABRA || borrandoTodo) return;
  borrandoTodo = true;
  for (const id of ["dlgConfirmar", "dlgCancelar", "dlgTexto", "dlgRespaldo", "bBorrarTodo"]) $(id).disabled = true;
  $("dlgMsg").textContent = "Borrando…";
  try {
    const n = await borrarTodo((hechas, total) => { $("dlgMsg").textContent = `Borrando… ${hechas} de ${total}`; });
    dlg.close();
    $("adminMsg").textContent = `Se borraron ${nMuestras(n)}.`;
    sello(`Dataset borrado: ${nMuestras(n)}`);
  } catch (err) {
    $("dlgMsg").textContent = String(err && err.code || "").includes("PERMISSION")
      ? "Firebase rechazó el borrado. Revisa que entraste con el correo del director. Lo que alcanzó a borrarse no se recupera."
      : "Se cortó el borrado. Revisa tu conexión y vuelve a intentarlo: seguirá con las muestras que quedan.";
    $("dlgCancelar").disabled = false;
  } finally {
    borrandoTodo = false; $("dlgRespaldo").disabled = false;
    pedirRender();
  }
});

// ---------- inicio ----------
construirGrid();
new ResizeObserver(ajustar).observe(cv);
const repintar = () => { dibujar(); pedirRender(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", repintar);
if (document.fonts) document.fonts.ready.then(repintar);
render();

const configurado = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGA");
if (!configurado) {
  cargarLocal(); pedirRender();
  $("configAviso").hidden = false;
  estado("local", "Falta configurar Firebase · solo este navegador");
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getDatabase(app);
    let arrancado = false;
    onAuthStateChanged(auth, async u => {
      if (!u) { uid = null; signInAnonymously(auth).catch(() => estado("local", "Activa el acceso anónimo en Firebase")); return; }
      uid = u.uid;
      if (!arrancado) { arrancado = true; arrancarTiempoReal(); }
      onDisconnect(ref(db, "presencia/" + uid)).remove().catch(() => {});
      seguirLetra(); anunciar();
      await comprobarDirector(4);
      if (modo === "wait") estado("ok", esDirector ? "Dataset compartido · director" : "Dataset compartido");
    });
  } catch (e) {
    db = null; auth = null; cargarLocal(); pedirRender();
    estado("local", "La configuración de Firebase no es válida");
  }
}
