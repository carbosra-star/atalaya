/* Planificación Supply · bellochapplab — aplicación de página única */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Enteros con punto de miles siempre (toLocaleString no agrupa 4 cifras: 5341 → 5.341)
const fmt = (n) => (n == null || isNaN(n)) ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const eur = (n) => fmt(n) + ' €';
const keur = (n) => Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M€' : fmt(n / 1000) + ' k€';
// Fechas siempre en números: 29/09/2026, 29/09 (corta), 29/09/2026 10:25 (con hora), 09/26 (mes)
const pad = (n) => String(n).padStart(2, '0');
const toDate = (iso) => new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
const fdate = (iso, short) => { if (!iso) return ''; const d = toDate(iso); if (isNaN(d)) return esc(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + (short ? String(d.getFullYear()).slice(2) : d.getFullYear()); };  // short: año con dos cifras
const fdt = (iso) => { if (!iso) return ''; const d = toDate(iso); if (isNaN(d)) return esc(iso); return fdate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const refHref = (k) => '#/ref/' + encodeURIComponent(k);
// Líneas: nombre corto ("piedra Rosetta", se edita en Líneas); sin nombre, el código. Al pasar el ratón, código y nombre en ABAS
const lnNom = (c) => !c || c === '—' ? '—' : ((S.ds && S.ds.alias) || {})[c] || c;
const lnTit = (c) => !c || c === '—' ? 'Sin línea asignada' : c + (((S.ds && S.ds.meta.lineas) || {})[c] ? ' · ' + S.ds.meta.lineas[c] : '');
// Lo que acompaña al nombre en gris, sin repetir lo que ya se ve: el código si hay nombre corto y el nombre en ABAS si es distinto
const lnSub = (c) => { if (!c || c === '—') return 'Sin línea asignada'; const ab = ((S.ds && S.ds.meta.lineas) || {})[c]; return [lnNom(c) !== c ? c : '', ab && ab !== c && ab !== lnNom(c) ? ab : ''].filter(Boolean).join(' · '); };
// Área: agrupa varias líneas; maestro de la app (se edita en Líneas). '' = sin área
const lnArea = (c) => !c || c === '—' ? '' : ((S.ds && S.ds.areas) || {})[c] || '';
const SIN_AREA = 'Sin área';
const lnSpan = (c) => `<span title="${esc(lnTit(c))}">${esc(lnNom(c))}</span>`;
const lnLink = (c) => c ? `<a class="nowrap" href="#/linea/${encodeURIComponent(c)}" title="${esc(lnTit(c))}">${esc(lnNom(c))}</a>` : '—';
const lnOpts = (codes, cur) => '<option value="">Todas</option>' + codes.slice().sort((a, b) => lnNom(a).localeCompare(lnNom(b), 'es')).map(c => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c === '—' ? 'Sin línea' : lnNom(c))}</option>`).join('');
const SEM = [['rojo', 'Rotura'], ['naranja', 'Bajo mínimo'], ['amarillo', 'A revisar'], ['verde', 'Cubierto'], ['exceso', 'Exceso'], ['gris', 'Sin demanda']];
const SEMT = Object.fromEntries(SEM);
const SEMORD = { rojo: 0, naranja: 1, amarillo: 2, verde: 3, exceso: 4, gris: 5 };
// Firmes: OF y pedidos de compra a proveedor (PT fabricados fuera); cuentan en todos los escenarios
const ESC = { OF: 'Solo firmes: OF y pedidos de compra', OFPF: 'Firmes y propuestas fijadas', ALL: 'Firmes y todas las propuestas' };
const ESC_TXT = { OF: 'solo OF y pedidos de compra', OFPF: 'OF, pedidos de compra y propuestas fijadas', ALL: 'OF, pedidos de compra y todas las propuestas' };  // para mitad de frase
const escLower = () => ESC_TXT[S.esc] + (S.pv === 'C' ? ' y previsión corregida' : '');
const PV = { T: 'Tal cual', C: 'Corregida' };
const pvKey = () => S.esc + (S.pv === 'C' ? '_C' : '');  // clave de la carga anterior evaluada
const cobTxt = (v) => Cob.cobTxt(v);  // stock negativo: 0 m
const ENT = { OF: 'OF', PC: 'Compra', PF: 'PROP fijada', P: 'PROP' };
// Valor que importa según el estado (a coste, Precio Mixto): exceso, lo que falta en rotura o el stock.
// null = sin precio (con algo que valorar); 0 = nada que valorar
function valor(r, e) {
  const u = e.sem === 'exceso' ? e.ex : e.sem === 'rojo' ? e.fa : Math.max(r.st, 0);
  return !u ? 0 : r.pr > 0 ? u * r.pr : null;
}
const valorCell = (r, e) => { const v = valor(r, e), t = e.sem === 'exceso' ? 'Exceso' : e.sem === 'rojo' ? 'Falta' : 'Stock';
  return v == null ? '<td class="r"><span class="muted" title="Sin precio">—<span class="sr"> sin precio</span></span></td>' : `<td class="r num" title="${t}">${v ? eur(v) : '–'}</td>`; };

const S = { me: null, cfg: { horizonte: 3 }, ds: null, ev: [], byK: {}, notes: {}, actions: [], esc: localStorage.getItem('esc') || 'ALL',
  pv: (() => { try { return localStorage.getItem('prev') === 'C' ? 'C' : 'T'; } catch (e) { return 'T'; } })() };

// ---------------------------------------------------------------- API
async function api(path, opt = {}) {
  const o = { credentials: 'same-origin', headers: { 'X-Requested-With': 'supply-app' }, ...opt };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  let res;
  try { res = await fetch(path, o); } catch (e) { throw new Error('No hay conexión con el servidor'); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && path !== '/api/login') { S.me = null; go('#/login'); throw new Error((data && data.error) || 'Sesión caducada'); }
  if (!res.ok) throw new Error((data && data.error) || ('Error ' + res.status));
  return data;
}
// Copiar al portapapeles (como en BellFlow): navigator.clipboard solo existe en contexto seguro (HTTPS o localhost);
// en el NAS, por HTTP, se cae al textarea + execCommand, que funciona sin TLS
function copiar(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); return Promise.resolve(); } catch (e) { return Promise.reject(e); } finally { ta.remove(); }
}
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" class="i-copy"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  + '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" class="i-ok"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Botón de copiar; en las tablas aparece al pasar por la fila (siempre: visible también fuera de ellas)
const copyBtn = (text, que = 'código', siempre = false) => `<button type="button" class="copy${siempre ? ' on' : ''}" data-copy="${esc(text)}" title="Copiar ${que} ${esc(text)}" aria-label="Copiar ${que} ${esc(text)}">${ICON_COPY}</button>`;
// Un solo manejador para todos (en captura: que el clic no abra además la fila del buscador)
document.addEventListener('click', (ev) => {
  const b = ev.target.closest && ev.target.closest('button[data-copy]');
  if (!b) return;
  ev.preventDefault(); ev.stopPropagation();
  copiar(b.dataset.copy).then(() => { b.classList.add('ok'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('ok'), 1200); toast('Copiado: ' + b.dataset.copy); },
    () => toast('No se ha podido copiar'));
}, true);
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
function announce(t) { $('#live').textContent = t; }
const can = (...roles) => S.me && roles.includes(S.me.role);

// ---------------------------------------------------------------- datos
function monthLabel(i) {
  if (!S.ds) return ''; const [y, m] = S.ds.meta.base.split('-').map(Number); const d = new Date(y, m - 1 + i, 1);
  return pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
}
// "Previsión operativa: 09/26 de 2026Q3; 10/26 a 08/27 de 2026Q4. "
function prevSrcText() {
  const src = S.ds && S.ds.meta.prev_src; if (!src) return '';
  const tramos = [];
  src.forEach((v, i) => { const t = tramos[tramos.length - 1]; if (t && t.v === v) t.b = i; else tramos.push({ v, a: i, b: i }); });
  return 'Previsión operativa: ' + tramos.map(t => (t.a === t.b ? monthLabel(t.a) : monthLabel(t.a) + ' a ' + monthLabel(t.b)) + ' ' + (t.v ? 'de ' + esc(t.v) : 'sin previsión')).join('; ') + '. ';
}
// Previsión que se está mirando: {c: corregida, p: 12 meses, p0: resto del mes en curso}
const pvSel = (r) => S.pv === 'C' && r.pvc ? { c: true, p: r.pvc, p0: r.pv0rc } : { c: false, p: r.pv, p0: r.pv0r };
// Cómo se ha calculado la previsión que queda del mes en curso
function restoText(r) {
  const s = pvSel(r), p0 = s.p[0];
  if (!p0) return '';
  return `Mes en curso: quedan ${fmt(s.p0)} de ${fmt(p0)} previstas${r.v0 ? ` (vendidas ${fmt(r.v0)})` : ''}.`;
}
// Acierto de la previsión de los 12 últimos meses cerrados frente a la venta real
function aciertoHTML(r) {
  if (!r.hp) return '<p class="muted">Esta carga no trae el histórico de previsión. Vuelve a cargar el MM_Supply para verlo.</p>';
  const pct = (x) => Math.round(x * 100) + ' %', sv = r.vt.reduce((s, x) => s + x, 0), sp = r.hp.reduce((s, x) => s + x, 0);
  const grupo = `de su grupo ${esc(r.md)} · ${esc(r.abc)}`;
  const orig = r.fo === 'ref' ? 'propio' : r.fo === 'grupo' ? grupo : 'sin datos, no se corrige';
  const txt = (r.hm >= 6 && sp > 0 ? `Vendido / previsto: ${pct(sv / sp)}` : r.hm ? `Solo ${r.hm} meses con previsión` : 'Sin previsión vigente') +
    ` · Error medio: ${r.er == null ? 'sin dato' : pct(r.er) + (r.eo === 'grupo' ? ' (' + grupo + ')' : '')} · Factor: ${String(r.fc).replace('.', ',')} (${orig})`;
  const src = S.ds.meta.hist_src || [];
  return `<p>${txt}</p><div class="tw"><table class="mt"><caption class="sr">Previsión vigente y venta de los 12 últimos meses</caption><thead><tr><th scope="col">Unidades</th>${r.hp.map((_, i) => `<th scope="col" class="r">${monthLabel(i - 12)}</th>`).join('')}</tr></thead><tbody>
    <tr><th scope="row">Previsión vigente</th>${r.hp.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Venta</th>${r.vt.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Desviación</th>${r.hp.map((p, i) => `<td class="r num ${p > 0 && Math.abs(r.vt[i] - p) / p > 0.3 ? 'neg' : ''}">${p > 0 ? pct((r.vt[i] - p) / p) : ''}</td>`).join('')}</tr>
    <tr><th scope="row">Versión</th>${src.map(v => `<td class="r small muted">${esc(v)}</td>`).join('')}</tr></tbody></table></div>`;
}
function recompute() {
  const cfg = { horizonte: S.cfg.horizonte || 3, escenario: S.esc, prevision: S.pv, exceso: S.cfg.exceso, dias: S.ds && S.ds.meta.dias, hoy: S.ds && S.ds.meta.hoy };
  S.ev = S.ds ? S.ds.refs.map(r => ({ r, e: Cob.evaluate(r, cfg) })) : [];
  S.byK = {}; for (const x of S.ev) S.byK[x.r.k] = x;
}
async function loadData() {
  const [ds, notes, acts] = await Promise.all([api('/api/dataset'), api('/api/notes-index'), api('/api/actions?status=abierta')]);
  S.ds = ds.empty ? null : ds; S.notes = notes || {}; S.actions = acts || [];
  recompute();
}
// Reunión semanal y acciones: apagadas de momento (la API y las tablas siguen; true para recuperarlas)
const ACCIONES = false;
async function refreshActions() { S.actions = await api('/api/actions?status=abierta'); }
const openActs = (k) => S.actions.filter(a => a.ref === k);

// ---------------------------------------------------------------- router
const go = (h) => { if (location.hash !== h) location.hash = h; else render(); };
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const i = h.indexOf('?'); const path = i < 0 ? h : h.slice(0, i); const q = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
  const dec = (p) => { try { return decodeURIComponent(p); } catch (e) { return p; } };
  return { parts: path.split('/').filter(Boolean).map(dec), q, path };
}
function setQuery(patch) {
  const { path, q } = parseHash();
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) q.delete(k); else q.set(k, v); }
  const s = q.toString(); history.replaceState(null, '', '#' + path + (s ? '?' + s : ''));
}
window.addEventListener('hashchange', render);

const ROUTES = {
  '': pageHome, coberturas: pageList, ref: pageRef, lineas: pageLines, linea: pageLine, capacidad: pageCap, ...(ACCIONES ? { reunion: pageMeeting } : {}), porfolio: pagePortfolio,
  datos: pageData, usuarios: pageUsers, cuenta: pageAccount, pronto: pageSoon, parametros: pageParams, desviacion: pageDesv,
};
async function render() {
  const { parts } = parseHash();
  if (!S.me) {
    if (parts[0] !== 'login') { go('#/login'); return; }
    return pageLogin();
  }
  if (parts[0] === 'login') { go('#/'); return; }
  if (S.me.must_change && parts[0] !== 'cuenta') { go('#/cuenta'); return; }
  shell();
  const fn = ROUTES[parts[0] || ''] || pageNotFound;
  const main = $('#main');
  main.innerHTML = '';
  try { await fn(main, parts.slice(1)); } catch (e) { main.innerHTML = `<h1 tabindex="-1">No se ha podido abrir esta página</h1><p class="lead">${esc(e.message)}</p>`; }
  markNav(parts[0] || '');
  const h1 = $('h1', main); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); document.title = h1.textContent + ' · Atalaya'; }
  window.scrollTo(0, 0); $('#side') && $('#side').classList.remove('open');
}

// ---------------------------------------------------------------- estructura
const ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const LOGO = '<img src="/static/img/atalaya.svg" width="34" height="34" alt="">';
let globalBound = false;
function shell() {
  if ($('#main') && $('#side')) { updateChrome(); return; }
  const soon = [['consolidador', 'Consolidador de previsiones']];
  $('#app').innerHTML = `<div class="shell">
    <nav class="side" id="side" aria-label="Menú principal">
      <a class="brand" href="#/">${LOGO}<span><b>Atalaya</b><span>Supply · bellochapplab</span></span></a>
      <div class="nav-g" id="g1">Seguimiento</div>
      <div class="nav" role="list" aria-labelledby="g1">
        <a role="listitem" href="#/" data-nav="">Inicio</a>
        <a role="listitem" href="#/coberturas" data-nav="coberturas">Coberturas <span class="badge r" id="bRojo" hidden></span></a>
        <a role="listitem" href="#/lineas" data-nav="lineas">Líneas</a>
        <a role="listitem" href="#/capacidad" data-nav="capacidad">Capacidad</a>
        <a role="listitem" href="#/porfolio" data-nav="porfolio">Porfolio</a>
        ${ACCIONES ? '<a role="listitem" href="#/reunion" data-nav="reunion">Reunión semanal <span class="badge" id="bAct" hidden></span></a>' : ''}
      </div>
      <div class="nav-g" id="g2">Parámetros y previsión</div>
      <div class="nav" role="list" aria-labelledby="g2"><a role="listitem" href="#/parametros" data-nav="parametros">Stock mínimo y lotes</a><a role="listitem" href="#/desviacion" data-nav="desviacion">Desviación de previsiones</a>${soon.map(([k, t]) => `<a role="listitem" class="soon" href="#/pronto/${k}" data-nav="pronto/${k}">${t} <span class="badge">pronto</span></a>`).join('')}</div>
      ${can('admin') ? `<div class="nav-g" id="g3">Administración</div><div class="nav" role="list" aria-labelledby="g3">
        <a role="listitem" href="#/datos" data-nav="datos">Datos</a><a role="listitem" href="#/usuarios" data-nav="usuarios">Usuarios</a></div>` : ''}
      <div class="side-foot"><img src="/static/img/lab_belloch.png" alt="Belloch International Group" height="22"></div>
    </nav>
    <div class="content">
      <header class="bar">
        <button class="menu-btn" id="menuBtn" aria-controls="side" aria-expanded="false">Menú</button>
        <div class="search" role="search">${ICON_SEARCH}
          <input id="gs" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="gsList" placeholder="Buscar referencia por código o nombre" aria-label="Buscar referencia" autocomplete="off">
          <ul id="gsList" role="listbox" hidden></ul></div>
        <span class="stamp" id="stamp"></span>
        <div class="user"><button id="userBtn" aria-haspopup="menu" aria-expanded="false">${esc(S.me.name)}</button>
          <div role="menu" id="userMenu" hidden>
            <a role="menuitem" href="#/cuenta">Mi cuenta</a>
            <button role="menuitem" id="themeBtn">Cambiar tema claro / oscuro</button>
            <button role="menuitem" id="logoutBtn">Cerrar sesión</button></div></div>
      </header>
      <main id="main" tabindex="-1"></main>
    </div></div>`;
  $('#app').removeAttribute('aria-busy');
  const side = $('#side'), mb = $('#menuBtn');
  mb.onclick = () => { const o = side.classList.toggle('open'); mb.setAttribute('aria-expanded', o); if (o) $('a', side).focus(); };
  if (!globalBound) {
    globalBound = true;
    document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; const sd = $('#side'), m = $('#menuBtn'); if (sd && sd.classList.contains('open')) { sd.classList.remove('open'); m.setAttribute('aria-expanded', 'false'); m.focus(); } closeUserMenu(); });
    document.addEventListener('click', e => { if (!e.target.closest('.user')) closeUserMenu(); if (!e.target.closest('.search')) closeSearch(); });
  }
  const ub = $('#userBtn'), um = $('#userMenu');
  ub.onclick = () => { const o = um.hidden; um.hidden = !o; ub.setAttribute('aria-expanded', o); if (o) $('[role=menuitem]', um).focus(); };
  um.addEventListener('keydown', e => { const items = $$('[role=menuitem]', um); const i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } });
  $('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; $('#app').innerHTML = ''; go('#/login'); };
  $('#themeBtn').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem('theme', r.dataset.theme); closeUserMenu(); };
  setupSearch();
  updateChrome();
}
function closeUserMenu() { const um = $('#userMenu'); if (um && !um.hidden) { um.hidden = true; $('#userBtn').setAttribute('aria-expanded', 'false'); } }
function updateChrome() {
  const st = $('#stamp'); if (!st) return;
  st.textContent = S.ds ? `Datos del ${fdate(S.ds.meta.hoy)} · previsión ${S.ds.meta.version}` : 'Sin datos cargados';
  const nr = S.ev.filter(x => x.e.sem === 'rojo' && x.r.gp === 'Contra Stock').length;
  const b = $('#bRojo'); b.hidden = !nr; b.textContent = nr; b.setAttribute('aria-label', nr + ' en rotura');
  const ba = $('#bAct'); if (ba) { ba.hidden = !S.actions.length; ba.textContent = S.actions.length; ba.setAttribute('aria-label', S.actions.length + ' acciones abiertas'); }
}
function markNav(key) {
  const { parts } = parseHash(); const k = parts[0] === 'ref' ? 'coberturas' : parts[0] === 'linea' ? 'lineas' : parts[0] === 'pronto' ? 'pronto/' + parts[1] : key;
  $$('.nav a').forEach(a => a.dataset.nav === k ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}

// Búsqueda global (combobox accesible)
function setupSearch() {
  const inp = $('#gs'), ul = $('#gsList'); let items = [], act = -1;
  const draw = () => {
    ul.innerHTML = items.map((x, i) => `<li role="option" id="gso${i}" aria-selected="${i === act}" data-k="${esc(x.r.k)}"><span class="pill s-${x.e.sem}"><span class="sr">${SEMT[x.e.sem]}</span></span><span><b>${esc(x.r.k)}</b>${copyBtn(x.r.k)} ${x.r.ext ? EXT_TAG : ''}${esc(x.r.n)}</span></li>`).join('') || '<li role="option" aria-disabled="true">Sin resultados</li>';
    ul.hidden = false; inp.setAttribute('aria-expanded', 'true'); inp.setAttribute('aria-activedescendant', act >= 0 ? 'gso' + act : '');
    $$('li[data-k]', ul).forEach(li => li.onclick = () => { closeSearch(); go(refHref(li.dataset.k)); });
  };
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase(); act = -1;
    if (q.length < 2 || !S.ds) { closeSearch(); return; }
    const toks = q.split(/\s+/).filter(Boolean);
    items = S.ev.filter(x => { const h = (x.r.k + ' ' + x.r.n).toLowerCase(); return toks.every(t => h.includes(t)); }).sort((a, b) => (a.r.k.startsWith(q) ? 0 : 1) - (b.r.k.startsWith(q) ? 0 : 1) || b.e.d3 - a.e.d3).slice(0, 8);
    draw();
  };
  inp.onkeydown = (e) => {
    if (ul.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(items.length - 1, act + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const x = items[act >= 0 ? act : 0]; if (x) { closeSearch(); inp.value = ''; go(refHref(x.r.k)); } }
    else if (e.key === 'Escape') closeSearch();
  };
}
function closeSearch() { const ul = $('#gsList'); if (ul && !ul.hidden) { ul.hidden = true; $('#gs').setAttribute('aria-expanded', 'false'); } }

// ---------------------------------------------------------------- piezas comunes
const pill = (sem, text) => `<span class="pill s-${sem}">${esc(text || SEMT[sem])}</span>`;
// Estado corto para las tablas: el mes de rotura ya está en su columna y el motivo completo va en el title
function semCorto(e) {
  if (e.sem === 'rojo') return e.why.startsWith('Pedidos atrasados') ? 'Rotura · atrasos' : e.why.startsWith('Pedidos sin stock') ? 'Rotura · pedidos' : 'Rotura';
  if (e.sem === 'amarillo') return e.why === 'OF con fecha pasada' ? 'OF atrasada' : e.why === 'Falta ZT para el pedido' ? 'Falta ZT' : e.why.startsWith('ZT tarde') ? 'ZT tarde' : e.why === 'Pedido de compra con fecha pasada' ? 'Compra atrasada' : e.why.startsWith('Rotura antes') ? 'Rotura antes de entrada'
    : e.why.startsWith('Sin stock') ? 'Sin entradas' : e.why === 'Entradas sin demanda' ? 'Entradas sin demanda' : e.why.startsWith('Lanzar ya') ? 'Lanzar ya' : 'Propuestas';
  return { naranja: 'Bajo mínimo', verde: 'Cubierto', exceso: 'Exceso', gris: 'Sin demanda' }[e.sem];
}
// PT fabricado fuera: el ZT (semiterminado) que fabricamos y enviamos al proveedor; cubre su stock + sus OF (no las propuestas)
function ztBloque(r) {
  if (!r.zt || !r.zt.length) return '';
  const pcs = r.en.filter(e => e.t === 'PC').sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0), pend = pcs.reduce((t, e) => t + e.q, 0);
  return `<h2>Semiterminado (ZT)</h2><p class="muted small">Lo fabricamos nosotros y lo recibe el proveedor para el pedido de compra. Cubre el pedido con su stock y sus OF (terminadas ${Cob.ZT_MARGEN} días antes de la fecha del pedido); las propuestas aún no están fabricadas.</p>
    ${r.zt.map(z => { const c = Math.floor(Cob.ztCubre(z)), falta = c < pend - 0.5;
      return `<p><b>${esc(z.k)}</b>${copyBtn(z.k, 'código', true)} ${esc(z.n)} · stock <b class="num">${fmt(z.st)}</b>${z.q !== 1 ? ` · ${String(z.q).replace('.', ',')} por PT` : ''}</p>
      ${z.en.length ? `<ul class="list">${z.en.map(v => `<li>${entTag(v.t, false)}<span class="num">${fdate(v.d)}</span><b class="num">${fmt(v.q)} uds</b>${v.late ? '<span class="neg">fecha pasada</span>' : ''}${v.id ? `<span class="muted small">nº ${esc(v.id)}${copyBtn(v.id, 'nº de OF', true)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Sin OF ni propuestas del ZT.</p>'}
      <p class="${falta ? 'neg' : ''}">Cubre <b class="num">${fmt(c)}</b> de <b class="num">${fmt(pend)}</b> uds pendientes de pedido${falta ? ` · faltan ${fmt(pend - c)}` : ''}.</p>
      ${falta ? '' : ztPlazos(z, pcs)}`; }).join('')}`;
}
// Por cada pedido de compra: el ZT tiene que estar hecho ZT_MARGEN días antes (lo acumulado de los pedidos hasta esa fecha)
function ztPlazos(z, pcs) {
  let acum = 0;
  const li = pcs.filter(e => e.d).map(e => { acum += e.q; const h = Cob.ztLimite(e.d), c = Math.floor(Cob.ztCubre(z, h)), tarde = c < acum - 0.5;
    return `<li><span class="num">${fdate(e.d)}</span><span class="muted small">pedido · ZT antes del ${fdate(h)}</span><b class="num">${fmt(c)} / ${fmt(acum)}</b>${tarde ? `<span class="neg">ZT tarde · faltan ${fmt(acum - c)}</span>` : '<span class="muted small">a tiempo</span>'}</li>`; });
  return li.length ? `<ul class="list">${li.join('')}</ul>` : '';
}
const pillShort = (e) => `<span class="pill s-${e.sem}" title="${esc(e.why)}">${semCorto(e)}<span class="sr"> (${esc(e.why)})</span></span>`;
// ABC: una sola tinta de más a menos intensa (A → D), NA con borde discontinuo
// ABC por venta: el asterisco marca un ABC provisional (lanzamiento con menos de 12 meses de venta)
const ABC_CL = ['A', 'B', 'C', 'D'];
const abcCfg = () => (S.cfg && S.cfg.abc) || { cortes: [45, 80, 95], freq: {}, ss: {} };
function abcTxt(c) { const k = abcCfg().cortes; return { A: `hasta el ${k[0]} % de la venta`, B: `hasta el ${k[1]} %`, C: `hasta el ${k[2]} %`, D: 'resto', NA: 'bajo pedido' }[c] || ''; }
const abcTag = (c, prov) => `<span class="abc abc-${esc(c)}" title="${esc(abcTxt(c) + (prov ? ' · provisional' : ''))}">${esc(c)}${prov ? '*' : ''}</span>`;
const abcRef = (r) => abcTag(r.abc, r.abcp && r.abc !== 'NA');
function abcDetalle(r) {
  if (r.abc === 'NA') return '';
  const f = (abcCfg().freq[r.md] || [])[ABC_CL.indexOf(r.abc)];
  const prov = r.abcx === 'anual' ? `provisional: ${r.abcn} meses de venta, anualizada` : r.abcx === 'prev' ? (r.abcn ? `provisional: por previsión (${r.abcn} ${r.abcn === 1 ? 'mes' : 'meses'} de venta)` : 'provisional: sin venta todavía, por previsión') : '';
  return [prov, f ? `${String(f).replace('.', ',')} fab/año` : ''].filter(Boolean).map(esc).join(' · ');
}
// Mes de más demanda de los 12, si destaca sobre la demanda/mes (estacionalidad, lanzamientos)
function pico(e) {
  const d = e.all.dem, m = d.indexOf(Math.max(...d));
  return d[m] > 1.5 * e.d3 && d[m] > 0 ? `<div class="kpi"><div class="v">${monthLabel(m)}</div><div class="l">Pico de demanda · ${fmt(d[m])}</div></div>` : '';
}
// Cobertura normal y prudente, en dos columnas bajo el grupo «Cobertura»
function cobCell(e) {
  if (e.cob >= 99) return '<td class="r num"><span class="muted">—</span></td><td class="r num"><span class="muted">—</span></td>';
  return `<td class="r num cobc">${cobTxt(e.cob)}</td><td class="r num cobc cobp">${e.cobp == null ? '<span class="muted">—</span>' : cobTxt(e.cobp)}</td>`;
}
function leyendaCob(rows) {
  const n = {}; rows.forEach(({ r }) => n[r.abc] = (n[r.abc] || 0) + 1);
  const np = rows.filter(({ r }) => r.abcp && r.abc !== 'NA').length;
  return `<span class="lg"><b>ABC</b> ${['A', 'B', 'C', 'D', 'NA'].map(c => `<span class="lgi">${abcTag(c)} ${fmt(n[c] || 0)}</span>`).join('')}${np ? `<span class="lgi muted">* provisional: ${fmt(np)}</span>` : ''}</span>`;
}
const refLink = (r) => `<a href="${refHref(r.k)}">${esc(r.k)}</a>`;
// Celda de referencia: código y nombre en la misma línea (extra: marcas de notas y acciones)
// A extinguir: se consume el stock y no se repone (yartextin en ABAS)
const esExt = (r) => r.ext != null ? !!r.ext : !!(S.byK[r.k] && S.byK[r.k].r.ext);
const EXT_TAG = '<span class="tag ext" title="A extinguir: se consume el stock y no se repone">A extinguir</span> ';
const EXT_CORTA = '<span class="tag ext" title="A extinguir: se consume el stock y no se repone">EXT</span> ';  // en tablas, delante del código
const refCell = (r, extra = '') => `<td class="art" title="${esc(r.k + ' ' + r.n)}${esExt(r) ? ' · a extinguir' : ''}">${esExt(r) ? EXT_CORTA : ''}${refLink(r)}${copyBtn(r.k)} ${extra}<span class="nm">${esc(r.n)}</span></td>`;
// Demanda que queda del mes en curso (máx. de previsión restante y pedidos): la demanda/mes no la incluye.
// Se resalta si supera al stock actual: aunque entre algo este mes, puede romper antes de que llegue.
const mesCell = (r, e) => { const d = e.all.dem[0]; return `<td class="r num${d > Math.max(r.st, 0) ? ' neg' : ''}"${d > Math.max(r.st, 0) ? ' title="Supera el stock actual"' : ''}>${fmt(d)}</td>`; };
// Tipo de entrada como etiqueta: OF azul relleno, propuesta fijada con borde azul, propuesta con borde gris
const ENT_CORTO = { OF: 'OF', PC: 'COMPRA', PF: 'PROP F', P: 'PROP' }, ENT_TIT = { OF: 'Orden de fabricación', PC: 'Pedido de compra a proveedor', PF: 'Propuesta fijada', P: 'Propuesta sin fijar' };
const entTag = (t, corto = true) => `<span class="ent ent-${t}" title="${ENT_TIT[t]}">${corto ? ENT_CORTO[t] : ENT[t]}</span>`;
function nextEntry(e) {
  const n = e.next;
  if (!n) return '<span class="muted" title="Sin entradas">—<span class="sr"> sin entradas</span></span>';
  return `<span class="nowrap">${entTag(n.t)} ${fmt(n.q)} · <span class="${n.late || n.dm != null ? 'neg' : ''}"${n.late ? ` title="${n.t === 'PC' ? 'Pedido de compra' : 'OF'} con fecha pasada"` : n.dm != null ? ` title="Propuesta del MRP ${n.dm ? fdate(n.dm) : 'sin fecha'}: no llega en 3 semanas, primera fecha posible"` : ''}>${fdate(n.d, true)}</span></span>`;
}
// Fecha estimada de rotura (demanda de cada mes repartida por igual entre sus días, entradas en su fecha)
const rfTxt = (e) => e.rf ? '≈ ' + fdate(e.rf, true) : e.rot < 0 ? '' : monthLabel(e.rot);
const RF_TIP = 'Fecha estimada: la demanda de cada mes repartida por igual entre sus días y cada entrada en su fecha';
function rotCell(e) {
  if (e.rot < 0 && !e.rf) return '<span class="muted" title="Sin rotura en 12 meses">—<span class="sr"> sin rotura en 12 meses</span></span>';
  const ped = e.sem === 'rojo' && e.why.startsWith('Pedidos sin stock');  // pedidos con fecha que no caben antes de la entrada
  const tip = ped ? `Pedidos con fecha sin stock hasta la entrada del ${e.why.slice(-8, -3)}` : e.rot < 0 ? 'Se queda sin stock hasta la siguiente entrada. ' + RF_TIP : RF_TIP;
  return `<span class="nowrap${ped || (e.rot >= 0 && e.rot < (S.cfg.horizonte || 3)) ? ' neg' : ''}" title="${tip}">${rfTxt(e)}</span>`;
}
function strip(list, hrefFor, current) {
  const c = {}, cx = {}; list.forEach(x => { c[x.e.sem] = (c[x.e.sem] || 0) + 1; if (x.r.ext) cx[x.e.sem] = (cx[x.e.sem] || 0) + 1; });
  return `<section class="strip" aria-label="Referencias por estado">
    <div class="bar2">${SEM.filter(([k]) => c[k]).map(([k, t]) => `<a class="s-${k}" style="flex:${c[k]}" href="${hrefFor(k)}" aria-label="${t}: ${c[k]} referencias" title="${t}: ${c[k]}"></a>`).join('')}</div>
    <div class="legend">${SEM.map(([k, t]) => `<a class="s-${k}" href="${hrefFor(k)}" ${current === k ? 'aria-current="true"' : ''}><span class="d"></span><span class="n">${c[k] || 0}</span><span class="t">${t}</span></a>`).join('')}</div>
    ${Object.keys(cx).length && list.some(x => !x.r.ext) ? `<p class="strip-x">${EXT_TAG}${SEM.filter(([k]) => cx[k]).map(([k, t]) => `${cx[k]} ${t.toLowerCase()}`).join(' · ')}</p>` : ''}</section>`;
}
function scenarioCtl() {
  return `<div class="fld"><span id="escL">Entradas que se cuentan</span><div class="seg" role="group" aria-labelledby="escL">${Object.entries(ESC).map(([k, t]) => `<button type="button" data-esc="${k}" aria-pressed="${S.esc === k}">${k === 'OF' ? 'Solo firmes' : k === 'OFPF' ? '+ fijadas' : '+ todas las propuestas'}<span class="sr"> (${t})</span></button>`).join('')}</div></div>
    ${pvCtl()}`;
}
const pvCtl = () => `<div class="fld"><span id="pvL">Previsión</span><div class="seg" role="group" aria-labelledby="pvL">${Object.entries(PV).map(([k, t]) => `<button type="button" data-pv="${k}" aria-pressed="${S.pv === k}">${t}</button>`).join('')}</div></div>`;
function bindScenario(root, rerender) {
  $$('[data-esc]', root).forEach(b => b.onclick = () => { S.esc = b.dataset.esc; localStorage.setItem('esc', S.esc); recompute(); updateChrome(); rerender(); announce('Escenario: ' + ESC[S.esc]); });
  $$('[data-pv]', root).forEach(b => b.onclick = () => { S.pv = b.dataset.pv; try { localStorage.setItem('prev', S.pv); } catch (e) {} recompute(); updateChrome(); rerender(); announce('Previsión: ' + PV[S.pv]); });
}
function noData(main, title) {
  main.innerHTML = `<h1>${title}</h1><p class="lead">Todavía no hay datos cargados.${can('admin') ? ' Sube el MM_Supply desde <a href="#/datos">Datos</a>.' : ' Cuando se cargue el MM_Supply aparecerán aquí las coberturas.'}</p>`;
}
function sortTable(rows, key, dir, getters) { const g = getters[key]; return rows.slice().sort((a, b) => { const va = g(a), vb = g(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; }); }
// Encabezado simple; tip = nombre completo al pasar el ratón
const thc = (label, cls = '', tip = '') => `<th scope="col"${cls ? ` class="${cls}"` : ''}${tip ? ` title="${tip}"` : ''}>${label}</th>`;
// Encabezado en dos filas: columnas sueltas (ocupan las dos) y grupos { g, c: [th…] } con el nombre común arriba
function head2(cols) {
  return `<tr>${cols.map(c => typeof c === 'string' ? c.replace('<th ', '<th rowspan="2" ') : `<th scope="colgroup" colspan="${c.c.length}" class="grp">${c.g}</th>`).join('')}</tr>
    <tr>${cols.filter(c => typeof c !== 'string').map(c => c.c.map((h, i) => i ? h : h.replace('<th ', '<th data-g1 ')).join('')).join('')}</tr>`;
}
function thSort(label, key, cur, dir, cls = '', tip = '') {
  const s = cur === key ? (dir > 0 ? 'ascending' : 'descending') : null;
  return `<th scope="col" class="${cls}" ${s ? `aria-sort="${s}"` : ''}${tip ? ` title="${tip}"` : ''}><button class="sort" data-sort="${key}">${label}${s ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
}

// ---------------------------------------------------------------- Inicio
async function pageHome(main) {
  if (!S.ds) return noData(main, 'Inicio');
  const cs = S.ev.filter(x => x.r.gp === 'Contra Stock');
  const prev = S.ds.prev ? (S.ds.prev.sem[pvKey()] || S.ds.prev.sem[S.esc]) : null;
  const into = prev ? cs.filter(x => x.e.sem === 'rojo' && prev[x.r.k] && prev[x.r.k] !== 'rojo') : [];
  const out = prev ? cs.filter(x => prev[x.r.k] === 'rojo' && x.e.sem !== 'rojo') : [];
  const urg = cs.filter(x => x.e.sem === 'rojo').sort((a, b) => semKey(a) - semKey(b)).slice(0, 10);
  const today = todayISO();
  const late = S.actions.filter(a => a.due && a.due < today);
  const wo = cs.filter(x => (x.e.sem === 'rojo' || x.e.sem === 'naranja') && !openActs(x.r.k).length).length;
  const li = (x) => `<li>${refLink(x.r)} ${esc(x.r.n)}</li>`;
  const conPr = (xs, u) => xs.filter(x => u(x) > 0 && x.r.pr > 0).reduce((s, x) => s + u(x) * x.r.pr, 0);
  const stk = x => Math.max(x.r.st, 0), exc = cs.filter(x => x.e.sem === 'exceso'), sdm = S.ev.filter(x => x.e.sem === 'gris' && x.r.st > 0);
  const sinPr = S.ev.filter(x => x.r.st > 0 && !(x.r.pr > 0)).length;
  // Pedidos con más de 30 días de retraso: no cuentan en la demanda; se listan para servirlos o anularlos en ABAS
  const aoQ = x => (x.r.ao || []).reduce((s, p) => s + p[1], 0);
  const viejos = S.ev.filter(x => aoQ(x) > 0).sort((a, b) => aoQ(b) - aoQ(a));
  const kpi = (href, v, l) => `<a class="kpi kpi-link" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  main.innerHTML = `<h1>Semana del ${fdate(S.ds.meta.hoy)}</h1>
    <p class="lead">Contra stock · ${escLower()}.</p>
    ${strip(cs, k => '#/coberturas?sem=' + k)}
    <div class="kpis">${kpi('#/coberturas?gp=', keur(conPr(S.ev, stk)), `Valor del stock · contra stock ${keur(conPr(cs, stk))}`)}
      ${kpi('#/coberturas?sem=exceso&sort=val&dir=-1', keur(conPr(exc, x => x.e.ex)), `En exceso · ${fmt(exc.length)} refs`)}
      ${kpi('#/coberturas?gp=&sem=gris&sort=val&dir=-1', keur(conPr(sdm, stk)), `Sin demanda con stock · ${fmt(sdm.length)} refs`)}</div>
    ${sinPr ? `<p class="muted small">${fmt(sinPr)} referencias con stock y sin precio no suman.</p>` : ''}
    <div class="grid">
      <section class="card"><h2>Entran en rotura</h2>${prev ? `<p class="big">${into.length}</p><p class="muted small">Frente a la carga del ${fdate(S.ds.prev.created)}</p>${into.length ? `<ul>${into.slice(0, 6).map(li).join('')}</ul>` : ''}` : '<p class="muted">Se verá a partir de la segunda carga.</p>'}</section>
      <section class="card"><h2>Salen de rotura</h2>${prev ? `<p class="big">${out.length}</p>${out.length ? `<ul>${out.slice(0, 6).map(li).join('')}</ul>` : ''}` : '<p class="muted">Se verá a partir de la segunda carga.</p>'}</section>
      ${ACCIONES ? `<section class="card"><h2>Acciones abiertas</h2><p class="big">${S.actions.length}</p><p class="muted small">${late.length ? `<span class="neg">${late.length} con fecha vencida</span> · ` : ''}${wo} en rotura o bajo mínimo sin acción</p><p><a class="btn ghost sm" href="#/reunion">Ir a la reunión semanal</a></p></section>` : ''}
      <section class="card"><h2>Pedidos con más de 30 días de retraso</h2><p class="big">${viejos.length}</p><p class="muted small">${fmt(viejos.reduce((s, x) => s + aoQ(x), 0))} uds que no cuentan en la demanda: servir o anular en ABAS</p>${viejos.length ? `<ul>${viejos.slice(0, 6).map(x => `<li>${refLink(x.r)} ${esc(x.r.n)} · <span class="num">${fmt(aoQ(x))}</span></li>`).join('')}</ul>` : ''}</section>
    </div>
    <h2>Las 10 más urgentes</h2>
    <div class="tw"><table><thead><tr><th scope="col">Referencia</th><th scope="col">Línea</th><th scope="col" class="r">Stock</th><th scope="col" class="r">Demanda media/mes</th><th scope="col">Rotura</th><th scope="col" title="Próxima entrada">Entrada</th>${ACCIONES ? '<th scope="col">Acción</th>' : ''}<th scope="col">Estado</th></tr></thead><tbody>
    ${urg.map(({ r, e }) => `<tr>${refCell(r)}<td>${lnSpan(r.ln)}</td><td class="r num">${fmt(r.st)}</td><td class="r num">${fmt(e.d3)}</td><td>${rotCell(e)}</td><td>${nextEntry(e)}</td>${ACCIONES ? `<td>${openActs(r.k).length ? esc(openActs(r.k)[0].text) : '<span class="muted">Sin acción</span>'}</td>` : ''}<td>${pillShort(e)}</td></tr>`).join('') || `<tr><td colspan="${ACCIONES ? 8 : 7}" class="empty">No hay referencias en rotura.</td></tr>`}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- Coberturas
// Orden por estado y, dentro de cada estado: rotura, bajo mínimo y a revisar por fecha estimada de rotura (la más próxima
// primero; sin fecha, al final) y luego por demanda; exceso por valor del exceso; cubierto y sin demanda por demanda
const rfDias = (x) => x.e.rf ? Math.round(Date.parse(x.e.rf) / 864e5) : 1e5;
const semKey = (x) => SEMORD[x.e.sem] * 1e13 + (['rojo', 'naranja', 'amarillo'].includes(x.e.sem) ? rfDias(x) * 1e7 - Math.min(x.e.d3, 9e6)
  : x.e.sem === 'exceso' ? 1e12 - (valor(x.r, x.e) || 0) : 1e12 - Math.min(x.e.d3, 9e6));
const LIST_GET = {
  sem: semKey, k: x => x.r.k, ln: x => x.r.ln ? lnNom(x.r.ln) : 'zzz', abc: x => x.r.abc, st: x => x.r.st, mn: x => x.r.mn,
  d0: x => x.e.all.dem[0], d3: x => x.e.d3, val: x => { const v = valor(x.r, x.e); return v == null ? -1 : v; }, cob: x => x.e.cob, cobp: x => x.e.cobp == null ? 999 : x.e.cobp, rot: x => x.e.rf || (x.e.rot < 0 ? 'z' : String(x.e.rot)), next: x => x.e.next ? x.e.next.d : 'z',
};
function listFilter(q) {
  const t = (q.get('q') || '').toLowerCase(), md = q.get('md') || '', ln = q.get('ln') || '', mc = q.get('mc') || '', abc = q.get('abc') || '', gp = q.has('gp') ? q.get('gp') : 'Contra Stock', ext = q.get('ext') || '', ar = q.get('ar') || '';
  const toks = t.split(/\s+/).filter(Boolean);
  return (ignoreSem) => S.ev.filter(({ r, e }) => (!md || r.md === md) && (!ln || (r.ln || '—') === ln) && (!mc || r.mc === mc) && (!abc || r.abc === abc) && (!gp || r.gp === gp) && (!ext || (ext === '1') === !!r.ext) && (!ar || (lnArea(r.ln) || SIN_AREA) === ar) &&
    (ignoreSem || !q.get('sem') || e.sem === q.get('sem')) && (!toks.length || toks.every(w => (r.k + ' ' + r.n).toLowerCase().includes(w))));
}
// Tabla de cobertura por referencia, la misma en Coberturas y en cada Línea (allí sin la columna Línea)
const covExtra = (r) => (S.notes[r.k] ? `<span class="note-dot">${S.notes[r.k]} nota${S.notes[r.k] > 1 ? 's' : ''}</span>` : '') + (ACCIONES && openActs(r.k).length ? '<span class="note-dot">acción abierta</span>' : '');
const covCols = (conLn = true) => conLn ? 13 : 12;
const covRow = ({ r, e }, conLn = true) => `<tr class="s-${e.sem}">
      ${refCell(r, covExtra(r))}${conLn ? `<td>${lnLink(r.ln)}</td>` : ''}<td>${abcRef(r)}</td>
      <td class="r num">${fmt(r.st)}</td><td class="r num">${r.mn ? fmt(r.mn) : '–'}</td><td class="r num">${fmt(e.d3)}</td>${mesCell(r, e)}
      ${cobCell(e)}
      <td>${rotCell(e)}</td><td>${nextEntry(e)}</td>${valorCell(r, e)}<td>${pillShort(e)}</td></tr>`;
const covHead = (key, dir, conLn = true) => head2([thSort('Referencia', 'k', key, dir), ...(conLn ? [thSort('Línea', 'ln', key, dir)] : []), thSort('ABC', 'abc', key, dir), thSort('Stock', 'st', key, dir, 'r'), thSort('Mínimo', 'mn', key, dir, 'r', 'Stock mínimo'),
  { g: 'Demanda', c: [thSort('Media/mes', 'd3', key, dir, 'r', 'Demanda media de los 3 próximos meses'), thSort('Resto/mes', 'd0', key, dir, 'r', 'Demanda que queda del mes en curso')] },
  { g: 'Cobertura', c: [thSort('Meses', 'cob', key, dir, 'r', 'Meses que dura el stock de hoy con la demanda prevista'), thSort('Prudente', 'cobp', key, dir, 'r', 'Cobertura en meses con la previsión corregida y aumentada en su error')] },
  thSort('Rotura', 'rot', key, dir), thSort('Entrada', 'next', key, dir, '', 'Próxima entrada'), thSort('Valor', 'val', key, dir, 'r'), thSort('Estado', 'sem', key, dir)]);
// Ordenar pulsando la cabecera: el orden se guarda en la dirección (sort, dir) y se repinta
function covSort(thead, key, dir, redraw) {
  $$('[data-sort]', thead).forEach(b => b.onclick = () => { const k2 = b.dataset.sort; setQuery({ sort: k2, dir: key === k2 ? -dir : (['st', 'd0', 'd3', 'mn', 'val'].includes(k2) ? -1 : 1) }); redraw(); $(`[data-sort="${k2}"]`, thead).focus(); });
}
const areasUsadas = () => [...new Set(Object.values((S.ds && S.ds.areas) || {}))].sort((a, b) => a.localeCompare(b, 'es'));
async function pageList(main) {
  if (!S.ds) return noData(main, 'Coberturas');
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const lines = [...new Set(S.ds.refs.map(r => r.ln || '—'))].sort(), brands = [...new Set(S.ds.refs.map(r => r.mc).filter(Boolean))].sort();
  let limit = 200;
  const draw = () => {
    const { q } = parseHash(); const f = listFilter(q);
    const porValor = !q.get('sort') && ['exceso', 'rojo'].includes(q.get('sem'));
    const key = q.get('sort') || (porValor ? 'val' : 'sem'), dir = parseInt(q.get('dir') || (porValor ? '-1' : '1'), 10);
    const rows = sortTable(f(false), key, dir, LIST_GET);
    const qsNoSem = new URLSearchParams(q); qsNoSem.delete('sem');
    $('#stripBox').innerHTML = strip(f(true), k => { const p = new URLSearchParams(qsNoSem); if (q.get('sem') !== k) p.set('sem', k); return '#/coberturas' + (p.toString() ? '?' + p : ''); }, q.get('sem'));
    $('#count').textContent = fmt(rows.length) + ' referencias';
    $('#leyenda').innerHTML = leyendaCob(rows);
    const tb = $('#tbl tbody');
    tb.innerHTML = rows.slice(0, limit).map(x => covRow(x)).join('') || `<tr><td colspan="${covCols()}" class="empty">Ninguna referencia cumple estos filtros.</td></tr>`;
    $('#more').hidden = rows.length <= limit; $('#more').textContent = `Mostrar ${Math.min(200, rows.length - limit)} más`;
    $('#thead').innerHTML = covHead(key, dir);
    covSort($('#thead'), key, dir, draw);
    main._rows = rows;
  };
  const { q } = parseHash();
  main.innerHTML = `<h1>Coberturas</h1>
    <div id="stripBox"></div>
    <form class="filters" id="flt" role="search" aria-label="Filtros" onsubmit="return false">
      <label class="fld">Buscar<input type="search" name="q" value="${esc(q.get('q') || '')}" placeholder="Código o artículo"></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], q.get('md'), 'Todos')}</select></label>
      ${areasUsadas().length ? `<label class="fld">Área<select name="ar">${opts([...areasUsadas(), SIN_AREA], q.get('ar'), 'Todas')}</select></label>` : ''}
      <label class="fld">Línea<select name="ln">${lnOpts(lines, q.get('ln'))}</select></label>
      <label class="fld">Marca<select name="mc">${opts(brands, q.get('mc'), 'Todas')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D', 'NA'], q.get('abc'), 'Todas')}</select></label>
      <label class="fld">Planificación<select name="gp"><option value="Contra Stock" ${!q.has('gp') || q.get('gp') === 'Contra Stock' ? 'selected' : ''}>Contra stock</option><option value="Bajo Pedido" ${q.get('gp') === 'Bajo Pedido' ? 'selected' : ''}>Bajo pedido</option><option value="" ${q.has('gp') && !q.get('gp') ? 'selected' : ''}>Todas</option></select></label>
      <label class="fld">A extinguir<select name="ext"><option value="">Todas</option><option value="1" ${q.get('ext') === '1' ? 'selected' : ''}>Solo a extinguir</option><option value="0" ${q.get('ext') === '0' ? 'selected' : ''}>Sin las a extinguir</option></select></label>
      ${scenarioCtl()}
    </form>
    <div class="toolbar"><span class="count" id="count" aria-live="polite"></span><button class="btn ghost sm" id="csv">Descargar lista (CSV)</button></div>
    <div class="leyenda" id="leyenda"></div>
    <div class="tw"><table id="tbl" class="oneline"><caption class="sr">Referencias y su cobertura</caption><thead id="thead"></thead><tbody></tbody></table></div>
    <button class="btn ghost more" id="more" hidden></button>
    <p class="muted small">Cobertura: meses que dura el stock de hoy con la demanda prevista desde hoy, mes a mes (el mes en curso, por lo que queda). No cuenta las entradas. Prudente: igual, con la previsión corregida y aumentada en su error. Media/mes: media de los 3 próximos meses completos. Resto/mes: demanda que falta del mes en curso.</p>`;
  const fl = $('#flt');
  fl.addEventListener('input', (ev) => { const n = ev.target.name; if (!n) return; if (n === 'q') { clearTimeout(fl.t); fl.t = setTimeout(() => { setQuery({ q: ev.target.value.trim() }); limit = 200; draw(); }, 200); } });
  fl.addEventListener('change', (ev) => { const n = ev.target.name; if (!n || n === 'q') return; setQuery({ [n]: n === 'gp' ? (ev.target.value || '') : ev.target.value }); if (n === 'gp' && !ev.target.value) { const { path, q: qq } = parseHash(); qq.set('gp', ''); history.replaceState(null, '', '#' + path + '?' + qq); } limit = 200; draw(); });
  bindScenario(main, () => { $$('[data-esc]', main).forEach(b => b.setAttribute('aria-pressed', b.dataset.esc === S.esc)); $$('[data-pv]', main).forEach(b => b.setAttribute('aria-pressed', b.dataset.pv === S.pv)); draw(); });
  $('#more').onclick = () => { limit += 200; draw(); };
  $('#csv').onclick = () => downloadCSV(main._rows || []);
  draw();
}
function downloadCSV(rows, name = 'coberturas') {
  const head = ['Estado', 'Motivo', 'Referencia', 'Artículo', 'Mandante', 'Marca', 'A extinguir', 'Sucesor', 'Área', 'Línea', 'Nombre línea', 'ABC', 'Stock', 'Stock mínimo', 'Demanda que queda del mes en curso', 'Demanda media 3 próximos meses', 'Cobertura meses', 'Cobertura prudente meses', 'Valor stock €', 'Exceso €', 'Rotura €', 'Factor sesgo', 'Error previsión %', 'Fecha rotura (estimada)', 'Próxima entrada', 'Cantidad', 'Fecha'];
  const lines = rows.map(({ r, e }) => [SEMT[e.sem], e.why, r.k, r.n, r.md, r.mc, r.ext ? 'Sí' : '', r.sc || '', lnArea(r.ln), r.ln, r.ln ? lnNom(r.ln) : '', r.abc, r.st, r.mn, Math.round(e.all.dem[0]), Math.round(e.d3), e.cob >= 99 ? '' : e.cob > 12 ? '>12' : Math.max(0, e.cob).toFixed(1).replace('.', ','), e.cobp == null || e.cobp >= 99 ? '' : e.cobp > 12 ? '>12' : Math.max(0, e.cobp).toFixed(1).replace('.', ','), r.pr > 0 ? Math.round(Math.max(r.st, 0) * r.pr) : '', r.pr > 0 && e.ex ? Math.round(e.ex * r.pr) : '', r.pr > 0 && e.sem === 'rojo' && e.fa ? Math.round(e.fa * r.pr) : '', r.fc == null ? '' : String(r.fc).replace('.', ','), r.er == null ? '' : Math.round(r.er * 100), e.rf || (e.rot < 0 ? '' : monthLabel(e.rot)), e.next ? ENT[e.next.t] : '', e.next ? e.next.q : '', e.next ? fdate(e.next.d) : '']);
  saveCSV(head, lines, name);
}
function saveCSV(head, lines, name) {
  const csv = '\ufeff' + [head, ...lines].map(l => l.map(v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}_${S.ds.meta.hoy}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- Ficha de referencia
function chartSVG(r, e) {
  // Se dibuja al ancho real (menos márgenes de main y de la caja) para que los textos no crezcan en pantallas anchas
  const W = Math.max(560, ($('#main') ? $('#main').clientWidth : 800) - 80), Hh = 260, pl = 52, pr = 12, pt = 14, pb = 28, n = Cob.H;
  const st = e.all.stk, dm = e.all.dem, en = e.all.ent;
  const vals = [...st, ...dm, ...en, r.mn, r.st, 0], max = Math.max(...vals), min = Math.min(...vals, 0);
  const y = v => pt + (Hh - pt - pb) * (max - v) / ((max - min) || 1), bw = (W - pl - pr) / n, x = i => pl + bw * i + bw / 2;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-labelledby="chT chD"><title id="chT">Proyección de stock de ${esc(r.n)}</title><desc id="chD">Stock a fin de mes durante 12 meses: ${st.map((v, i) => monthLabel(i) + ' ' + fmt(v)).join(', ')}.</desc>`;
  for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--soft)"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="var(--ink2)">${Math.abs(v) >= 1000 ? Math.round(v / 1000) + ' k' : Math.round(v)}</text>`; }
  s += `<rect class="chband" x="0" width="${bw}" y="${pt}" height="${Hh - pt - pb}" fill="var(--sel)" visibility="hidden"/>`;
  for (let i = 0; i < n; i++) {
    s += `<rect x="${x(i) - bw * .34}" width="${bw * .3}" y="${y(Math.max(dm[i], 0))}" height="${Math.max(0, y(0) - y(dm[i]))}" fill="var(--gris)" opacity=".5"/>`;
    if (en[i] > 0) s += `<rect x="${x(i) + bw * .04}" width="${bw * .3}" y="${y(en[i])}" height="${Math.max(0, y(0) - y(en[i]))}" fill="var(--link)" opacity=".7"/>`;
    s += `<text x="${x(i)}" y="${Hh - 9}" font-size="11" text-anchor="middle" fill="var(--ink2)">${monthLabel(i)}</text>`;
  }
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink2)"/>`;
  if (r.mn > 0) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(r.mn)}" y2="${y(r.mn)}" stroke="var(--naranja)" stroke-dasharray="6 4"/><text x="${W - pr}" y="${y(r.mn) - 5}" font-size="11" text-anchor="end" fill="var(--naranja)">stock mínimo</text>`;
  s += `<polyline fill="none" stroke="var(--ink)" stroke-width="2.4" points="${st.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>`;
  st.forEach((v, i) => s += `<circle cx="${x(i)}" cy="${y(v)}" r="3.6" fill="${v < 0 ? 'var(--rojo)' : v < r.mn ? 'var(--naranja)' : 'var(--ink)'}"/>`);
  // Zona de cada mes (columna entera) para el detalle al pasar el ratón o con el teclado
  for (let i = 0; i < n; i++) s += `<rect class="chhit" data-m="${i}" x="${pl + bw * i}" width="${bw}" y="${pt}" height="${Hh - pt - pb}" fill="transparent" tabindex="0" aria-label="${monthLabel(i)}: stock fin de mes ${fmt(st[i])}"/>`;
  return s + '</svg><div class="chtip" hidden></div>';
}
// Detalle de un mes del gráfico de la ficha: stock fin de mes, demanda (previsión y pedidos), entradas una a una y mínimo
function chartTip(r, e, m) {
  const ps = pvSel(r), pv = m === 0 ? ps.p0 : ps.p[m], stk = e.all.stk[m];
  const ens = r.en.filter(x => x.m === m && Cob.counts(x.t, S.esc));
  const fila = (l, v, cls = '') => `<div class="row"><span>${l}</span><b class="num ${cls}">${v}</b></div>`;
  return `<div class="t">${monthLabel(m)}</div>
    ${fila('Stock fin de mes', fmt(stk), stk < 0 ? 'neg' : '')}
    ${fila('Demanda', fmt(e.all.dem[m]))}
    <div class="sub">${m === 0 ? 'previsión que queda' : 'previsión'} ${fmt(pv)} · pedidos ${fmt(r.pd[m])}${m === 0 && r.ab ? ` · ${fmt(r.ab)} atrasados de meses anteriores` : ''}</div>
    ${fila('Entradas', e.all.ent[m] ? fmt(e.all.ent[m]) : '—')}
    ${ens.map(x => `<div class="sub">${entTag(x.t)} ${fmt(x.q)} · ${fdate(x.d, true)}${x.dm != null ? ' · MRP ' + (x.dm ? fdate(x.dm, true) : 'sin fecha') : ''}</div>`).join('')}
    ${r.mn > 0 ? fila('Stock mínimo', fmt(r.mn)) : ''}
    ${stk < 0 ? '<div class="sub neg">Rotura a fin de mes</div>' : r.mn > 0 && stk < r.mn ? '<div class="sub neg">Por debajo del stock mínimo</div>' : ''}`;
}
function bindChart(root, r, e) {
  const box = $('.chartbox', root); if (!box) return;
  const tip = $('.chtip', box), band = $('.chband', box);
  const show = (h) => {
    const m = +h.dataset.m;
    band.setAttribute('x', h.getAttribute('x')); band.setAttribute('visibility', 'visible');
    tip.innerHTML = chartTip(r, e, m); tip.hidden = false;
    const b = box.getBoundingClientRect(), c = h.getBoundingClientRect();
    const left = c.right - b.left + 8 + tip.offsetWidth > b.width ? c.left - b.left - tip.offsetWidth - 8 : c.right - b.left + 8;
    tip.style.left = Math.max(4, left) + 'px'; tip.style.top = (c.top - b.top + 4) + 'px';
  };
  const hide = () => { tip.hidden = true; band.setAttribute('visibility', 'hidden'); };
  $$('.chhit', box).forEach(h => { h.onpointerenter = () => show(h); h.onfocus = () => show(h); h.onblur = hide; });
  $('svg', box).onpointerleave = hide;
}
// Ficha: pedidos y entradas día a día hasta fin del mes que viene, con el stock tras cada movimiento. Las entradas,
// según el escenario; la previsión que no cubren los pedidos, a fin de cada mes (cuadra con el stock fin de mes)
const DIARIO_MESES = 2;
function diarioHTML(r, e) {
  const hoy = S.ds.meta.hoy, [by, bm] = S.ds.meta.base.split('-').map(Number);
  const fin = (m) => new Date(Date.UTC(by, bm + m, 0)).toISOString().slice(0, 10);
  const ev = [], conFecha = Array.isArray(r.pdd);
  const ped = {};
  if (conFecha) for (const [d, m, q] of r.pdd) if (m < DIARIO_MESES) ped[d] = (ped[d] || 0) + q;
  // los atrasados (hasta 30 días) vienen con fecha de hoy: se separan de los pedidos de hoy
  const atr = Math.min(r.at || 0, ped[hoy] || 0);
  if (atr) { ped[hoy] -= atr; ev.push({ d: hoy, o: 1, q: -atr, t: `Pedidos atrasados${r.ab ? ` <span class="muted small">(${fmt(r.ab)} de meses anteriores)</span>` : ''}` }); }
  for (const [d, q] of Object.entries(ped)) if (q) ev.push({ d, o: 1, q: -q, t: d === hoy ? 'Pedidos de hoy' : 'Pedidos' });
  for (let m = 0; m < DIARIO_MESES; m++) {
    const pm = conFecha ? r.pdd.filter(p => p[1] === m).reduce((t, p) => t + p[2], 0) : r.pd[m];
    if (!conFecha && pm) ev.push({ d: fin(m), o: 1, q: -pm, t: `Pedidos de ${monthLabel(m)} <span class="muted small">(sin fecha en esta carga)</span>` });
    const resto = Math.round(e.all.dem[m] - pm);
    if (resto > 0) ev.push({ d: fin(m), o: 2, q: -resto, t: `Resto de previsión de ${monthLabel(m)} sin pedido` });
  }
  for (const x of r.en) if (x.m < DIARIO_MESES && Cob.counts(x.t, S.esc))
    ev.push({ d: x.d || hoy, o: 0, q: x.q, t: `${entTag(x.t, false)}${x.id ? ` <span class="muted small">nº ${esc(x.id)}</span>` : ''}${x.dm != null ? ` <span class="neg small">MRP ${x.dm ? fdate(x.dm, true) : 'sin fecha'} · no llega en 3 semanas</span>` : ''}` });
  ev.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.o - b.o);  // el mismo día, primero la entrada
  let s = r.st, roto = false;
  const filas = ev.map(x => {
    s += x.q;
    const neg = s < -0.5, primera = neg && !roto; if (neg) roto = true;
    return `<tr${primera ? ' class="rotura" title="Primer día sin stock"' : ''}><td class="num">${fdate(x.d, true)}</td><td>${x.t}</td><td class="r num">${x.q > 0 ? '+' : '−'}${fmt(Math.abs(x.q))}</td><td class="r num ${neg ? 'neg' : ''}"><b>${fmt(s)}</b></td></tr>`;
  });
  return `<div class="tw"><table class="fit diario"><caption class="sr">Pedidos y entradas día a día</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Movimiento</th><th scope="col" class="r">Uds</th><th scope="col" class="r">Stock</th></tr></thead><tbody>
    <tr><td class="num">${fdate(hoy, true)}</td><td>Stock hoy</td><td></td><td class="r num"><b>${fmt(r.st)}</b></td></tr>${filas.join('')}</tbody></table></div>
    <p class="muted small">Hasta fin de ${monthLabel(DIARIO_MESES - 1)}. Pedidos en su fecha de envío (los atrasados, hoy); entradas: ${ESC_TXT[S.esc]}.</p>`;
}
// Ficha: bloques de consulta plegados; se recuerda cuáles se han abierto mientras dura la sesión
const FICHA_ABIERTOS = new Set();
const blkFicha = (id, titulo, resumen, cuerpo) => `<details class="blk" data-fb="${id}"${FICHA_ABIERTOS.has(id) ? ' open' : ''}><summary><h2>${titulo}</h2>${resumen ? `<span class="muted small">${resumen}</span>` : ''}</summary>${cuerpo}</details>`;

async function pageRef(main, [k]) {
  if (!S.ds) return noData(main, 'Referencia');
  const x = S.byK[k];
  if (!x) { main.innerHTML = `<p class="crumbs"><a href="#/coberturas">Coberturas</a></p><h1>Referencia ${esc(k)}</h1><p class="lead">No está entre los productos terminados activos de la última carga. Puede que esté inactiva, no sea producto terminado o no tenga stock, previsión, pedidos ni entradas.</p>`; return; }
  const draw = async () => {
    const { r, e } = S.byK[k]; const n = Cob.H;
    const [notes, acts, par, hist, dvr, dvh] = await Promise.all([api('/api/notes/' + encodeURIComponent(k)), api('/api/actions?ref=' + encodeURIComponent(k)),
      api('/api/parametros?ref=' + encodeURIComponent(k)), api('/api/parametros/' + encodeURIComponent(k) + '/historial'),
      api('/api/desviacion?ref=' + encodeURIComponent(k)), api('/api/desviacion/' + encodeURIComponent(k) + '/historial')]);
    const canW = can('admin', 'planificador');
    main.innerHTML = `<p class="crumbs"><a href="#/coberturas">Coberturas</a> › ${esc(r.k)}</p>
      <div class="head"><div><h1><span class="num">${esc(r.k)}</span>${copyBtn(r.k, 'código', true)} ${esc(r.n)}</h1>
        <p class="meta">${esc(r.md)} · ${esc(r.mc || 'sin marca')} · línea ${lnLink(r.ln)} · ABC ${abcRef(r)}${abcDetalle(r) ? ` <span class="small">(${abcDetalle(r)})</span>` : ''} · ${esc(r.gp)}${!r.ext && r.sc ? ` · sucesor <a href="${refHref(r.sc)}">${esc(r.sc)}</a>` : ''}</p>
        ${r.ext ? `<p class="extbar">${EXT_TAG}Se consume el stock y no se repone.${r.sc ? ` Sucesor: <a href="${refHref(r.sc)}">${esc(r.sc)}</a>${S.byK[r.sc] ? ' ' + esc(S.byK[r.sc].r.n) : ''}.` : ' Sin sucesor activo.'}</p>` : ''}
        <p>${pill(e.sem, e.why)}</p></div>
        <form onsubmit="return false">${scenarioCtl()}</form></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmt(r.st)}</div><div class="l">Stock hoy</div></div>
        <div class="kpi"><div class="v">${r.st > 0 ? (r.pr > 0 ? eur(r.st * r.pr) : 'sin precio') : '–'}</div><div class="l">Valor del stock${e.sem === 'exceso' ? `<br>Exceso: ${fmt(e.ex)} uds${r.pr > 0 ? ' · ' + eur(e.ex * r.pr) : ''}` : e.sem === 'rojo' && e.fa ? `<br>Falta: ${fmt(e.fa)} uds${r.pr > 0 ? ' · ' + eur(e.fa * r.pr) : ''}` : ''}</div></div>
        <div class="kpi"><div class="v">${r.mn ? fmt(r.mn) : '–'}</div><div class="l">Stock mínimo${r.lt ? ` · Lote ${fmt(r.lt)}` : ''}</div></div>
        <div class="kpi"><div class="v">${cobTxt(e.cob)}</div><div class="l">Cobertura</div></div>
        <div class="kpi"><div class="v">${cobTxt(e.cobp)}</div><div class="l">Cobertura prudente</div></div>
        <div class="kpi"><div class="v">${e.rot < 0 && !e.rf ? 'No' : rfTxt(e)}</div><div class="l" title="${RF_TIP}">Primera rotura</div></div>${pico(e)}</div>
      <div class="chartbox">${chartSVG(r, e)}<p class="muted small">Línea: stock fin de mes · gris: demanda · azul: entradas (${ESC_TXT[S.esc]}) · discontinua: stock mínimo</p></div>
      <h2>Mes a mes</h2>
      <div class="tw"><table class="mt"><caption class="sr">Proyección mes a mes</caption><thead><tr><th scope="col">Concepto</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}</tr></thead><tbody>
        <tr><th scope="row">Previsión${pvSel(r).c ? ' corregida' : ''}</th>${pvSel(r).p.map((v, i) => `<td class="r num">${fmt(i === 0 ? pvSel(r).p0 : v)}</td>`).join('')}</tr>
        <tr><th scope="row">Pedidos</th>${r.pd.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
        <tr><th scope="row">Demanda</th>${e.all.dem.map(v => `<td class="r num"><b>${fmt(v)}</b></td>`).join('')}</tr>
        <tr><th scope="row">Entradas</th>${e.all.ent.map(v => `<td class="r num">${v ? fmt(v) : ''}</td>`).join('')}</tr>
        <tr><th scope="row">Stock fin de mes</th>${e.all.stk.map(v => `<td class="r num ${v < 0 ? 'neg' : ''}"><b>${fmt(v)}</b></td>`).join('')}</tr>
      </tbody></table></div>
      <ul class="notas muted small">${[prevSrcText(), restoText(r),
        r.at ? `Pedidos atrasados: ${fmt(r.at)}${r.ab ? ` (${fmt(r.ab)} de meses anteriores, encima de la previsión)` : ''}.` : '',
        r.ao && r.ao.length ? `<span class="neg">Con más de 30 días de retraso, no cuentan: ${r.ao.map(p => `${fdate(p[0], true)} · ${fmt(p[1])}`).join('; ')}. Revisar en ABAS.</span>` : ''].filter(Boolean).map(t => `<li>${t}</li>`).join('')}</ul>
      <div class="two">
        <section><h2>Próximas semanas</h2>${diarioHTML(r, e)}</section>
        <section><h2>Entradas previstas</h2>${r.en.length ? `<ul class="list">${r.en.map(v => `<li>${entTag(v.t, false)}<span class="num">${fdate(v.d)}</span><b class="num">${fmt(v.q)} uds</b>${v.late ? '<span class="neg">fecha pasada</span>' : ''}${v.dm != null ? `<span class="neg" title="Sin fijar y con fecha del MRP dentro del plazo de fabricación: se cuenta en la primera fecha posible si se lanzara hoy">MRP ${v.dm ? fdate(v.dm) : 'sin fecha'} · no llega en 3 semanas</span>` : ''}${v.id ? `<span class="muted small">${v.t === 'PC' ? 'pedido' : 'nº'} ${esc(v.id)}${copyBtn(v.id, v.t === 'PC' ? 'nº de pedido' : 'nº de OF', true)}${v.mq ? ' · ' + esc(v.mq) : ''}${v.pv ? ' · ' + esc(v.pv) : ''}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Sin OF, pedidos de compra ni propuestas.</p>'}${ztBloque(r)}</section></div>
      ${(() => { const p = par && par.rows && par.rows[0]; if (!p) return '';
        const SRC = { erp: 'ERP', excel: 'Excel', estadistico: 'estadístico', manual: 'manual', calculado: 'calculado' };
        return blkFicha('par', 'Parámetros', `ERP ${fmt(p.mn)} · ${fmt(p.lt)} · propuesta ${fmt(p.ssp)} · ${fmt(p.ltp)}`, `
        <div class="kpis"><div class="kpi"><div class="v">${fmt(p.mn)} · ${fmt(p.lt)}</div><div class="l">ERP: Stock mínimo · Lote</div></div>
          <div class="kpi"><div class="v">${fmt(p.xl)} · ${p.est == null ? '—' : fmt(p.est)}</div><div class="l">Stock mínimo Excel · Estadístico${PTIPO[p.tipo] ? ' (' + PTIPO[p.tipo] + ')' : ''}${p.flag ? ' · corregir previsión' : ''}</div></div>
          <div class="kpi"><div class="v">${fmt(p.ssp)} · ${fmt(p.ltp)}</div><div class="l">Propuesta: Stock mínimo · Lote</div></div>
          <div class="kpi"><div class="v">${p.d ? fmt(p.ss) + ' · ' + fmt(p.lote) : '—'}</div><div class="l">${PEST[p.estado]}${p.smax ? ' · Stock máximo ' + fmt(p.smax) : ''}</div></div></div>
        ${can('admin', 'planificador') ? `<form class="form" id="plzF" style="max-width:none"><div class="row"><label>Plazo extra de material (días laborables)<input type="number" name="dias" min="0" max="250" value="${p.dx}"></label><label style="flex:1">Motivo<input name="motivo" maxlength="500"></label><button class="btn ghost">Guardar plazo</button></div></form>` : (p.dx ? `<p class="muted small">Plazo extra de material: ${p.dx} días laborables.</p>` : '')}
        ${hist.length ? `<div class="tw"><table class="fit"><caption class="sr">Historial de decisiones</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Usuario</th><th scope="col" class="r">Stock mínimo</th><th scope="col" class="r">Lote</th><th scope="col">Antes (ERP)</th><th scope="col">Motivo</th><th scope="col">Aplicado</th></tr></thead><tbody>
          ${hist.map(h => `<tr><td class="num">${fdt(h.created)}</td><td>${esc(h.by || '')}</td><td class="r num">${fmt(h.ss)} <span class="muted small">${SRC[h.src_ss]}</span></td><td class="r num">${fmt(h.lote)} <span class="muted small">${SRC[h.src_lote]}</span></td><td class="num">${fmt(h.ss_antes)} · ${fmt(h.lote_antes)}</td><td>${esc(h.motivo)}</td><td class="num">${h.aplicado ? fdate(h.aplicado) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Sin decisiones todavía. Se deciden en <a href="#/parametros">Stock mínimo y lotes</a>.</p>'}`); })()}
      ${(() => { const p = dvr && dvr.rows && dvr.rows[0]; if (!p) return '';
        const SRCD = { propuesta: 'propuesta', manual: 'manual', mantener: 'mantener' };
        return blkFicha('rev', 'Revisión de la previsión ' + esc(dvr.version), `propuesta ${pctTxt(p.cp)}${p.estado === 'acordado' ? ' · acordado ' + pctTxt(p.ca) : ' · sin acuerdo'}`, `
        <div class="kpis"><div class="kpi"><div class="v">${fmt(p.p12)} · ${fmt(p.v12)}</div><div class="l">Previsión 12 m · Venta 12 m</div></div>
          <div class="kpi"><div class="v">${pctTxt(p.cr)} · ${pctTxt(p.cs)}</div><div class="l">Corrección por ritmo · Por sesgo</div></div>
          <div class="kpi"><div class="v">${pctTxt(p.cp)}</div><div class="l">Propuesta (${DEST[p.tipo]})</div></div>
          <div class="kpi"><div class="v">${p.estado === 'acordado' ? pctTxt(p.ca) : '—'}</div><div class="l">${p.estado === 'acordado' ? 'Acordado · Previsión corregida ' + fmt(p.pvc.reduce((s, x) => s + x, 0)) : 'Sin acuerdo · se decide en <a href="#/desviacion?mc=' + encodeURIComponent(p.mc) + '">Desviación</a>'}</div></div></div>
        ${dvh.length ? `<div class="tw"><table class="fit"><caption class="sr">Historial de acuerdos de previsión</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Versión</th><th scope="col">Usuario</th><th scope="col" class="r">Corrección</th><th scope="col">Motivo</th></tr></thead><tbody>
          ${dvh.map(h => `<tr><td class="num">${fdt(h.created)}</td><td>${esc(h.version)}</td><td>${esc(h.by || '')}</td><td class="r num">${pctTxt(h.pct)} <span class="muted small">${SRCD[h.src]}</span></td><td>${esc(h.motivo)}</td></tr>`).join('')}</tbody></table></div>` : ''}`); })()}
      ${blkFicha('aci', 'Acierto de la previsión', r.er == null ? '' : `error ${Math.round(r.er * 100)} %${r.fc == null ? '' : ' · factor ' + String(r.fc).replace('.', ',')}`, aciertoHTML(r))}
      ${r.hp ? '' : blkFicha('vta', 'Venta de los últimos 12 meses', '', `<div class="tw"><table class="mt" style="min-width:0"><thead><tr>${r.vt.map((_, i) => `<th scope="col" class="r">${monthLabel(i - 12)}</th>`).join('')}</tr></thead><tbody><tr>${r.vt.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr></tbody></table></div>`)}
      <div${ACCIONES ? ' class="two"' : ''}>
        ${ACCIONES ? `<section><h2>Acciones</h2>
          ${acts.length ? acts.map(a => `<div class="act ${a.status !== 'abierta' ? 'done' : ''}"><div><div class="t">${esc(a.text)}</div><div class="st muted">${a.owner ? esc(a.owner) + ' · ' : ''}${a.due ? 'para el ' + fdate(a.due) + ' · ' : ''}${esc(a.status)}</div></div>
            ${canW && a.status === 'abierta' ? `<div><button class="btn ghost sm" data-done="${a.id}">Hecha</button></div>` : '<div></div>'}</div>`).join('') : '<p class="muted">Sin acciones.</p>'}
          ${canW ? `<form class="form" id="actF" style="margin-top:10px"><label>Nueva acción<input name="text" required maxlength="2000"></label>
            <div class="row"><label>Responsable<input name="owner" maxlength="120"></label><label>Fecha límite<input type="date" name="due"></label><button class="btn">Añadir acción</button></div></form>` : ''}</section>` : ''}
        <section><h2>Notas</h2>
          ${notes.map(nt => `<div class="note"><div>${esc(nt.text)}</div><div class="by">${esc(nt.by)} · ${fdt(nt.created)}${S.me && (S.me.role === 'admin' || (S.me.role === 'planificador' && S.me.id === nt.uid)) ? ` · <button type="button" class="btn ghost sm" data-delnote="${nt.id}">Borrar</button>` : ''}</div></div>`).join('') || '<p class="muted">Sin notas.</p>'}
          ${canW ? `<form class="form" id="noteF"><label>Nueva nota<textarea name="text" required maxlength="4000"></textarea></label><div><button class="btn">Guardar nota</button></div></form>` : ''}
        </section></div>`;
    bindScenario(main, draw);
    bindChart(main, r, e);
    $$('details[data-fb]', main).forEach(d => d.ontoggle = () => { if (d.open) FICHA_ABIERTOS.add(d.dataset.fb); else FICHA_ABIERTOS.delete(d.dataset.fb); });
    const af = $('#actF'); if (af) af.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(af); try { await api('/api/actions', { method: 'POST', body: { ref: k, text: fd.get('text'), owner: fd.get('owner'), due: fd.get('due') } }); await refreshActions(); updateChrome(); toast('Acción añadida'); draw(); } catch (e2) { toast(e2.message); } };
    const nf = $('#noteF'); if (nf) nf.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/notes/' + encodeURIComponent(k), { method: 'POST', body: { text: new FormData(nf).get('text') } }); S.notes[k] = (S.notes[k] || 0) + 1; toast('Nota guardada'); draw(); } catch (e2) { toast(e2.message); } };
    $$('[data-delnote]', main).forEach(b => b.onclick = async () => {
      if (!confirm('¿Borrar esta nota? No se puede deshacer.')) return;
      try { const quedan = await api('/api/notes/' + encodeURIComponent(k) + '/' + b.dataset.delnote, { method: 'DELETE' }); if (quedan.length) S.notes[k] = quedan.length; else delete S.notes[k]; toast('Nota borrada'); draw(); } catch (e2) { toast(e2.message); }
    });
    const pz = $('#plzF'); if (pz) pz.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/parametros/' + encodeURIComponent(k) + '/plazo', { method: 'PUT', body: { dias: parseInt(pz.dias.value, 10), motivo: pz.motivo.value } }); toast('Plazo guardado'); draw(); } catch (e2) { toast(e2.message); } };
    $$('[data-done]', main).forEach(b => b.onclick = async () => { try { await api('/api/actions/' + b.dataset.done, { method: 'PATCH', body: { status: 'hecha' } }); await refreshActions(); updateChrome(); toast('Acción marcada como hecha'); draw(); } catch (e2) { toast(e2.message); } });
  };
  await draw();
}

// ---------------------------------------------------------------- Capacidad
// Carga de cada línea (contra stock y bajo pedido: OF + necesidad neta, ver Cob.carga) frente a su capacidad mensual
const CAP_GEN = { horas_turno: 7.75, holgura: 0.2, dias: {} };
const capGen = () => (S.cfg && S.cfg.capacidad) || CAP_GEN;
// Meses de Capacidad: los 12 de la app más los que lleguen hasta el último mes con previsión (hx; 0 en cargas antiguas)
const capN = () => Cob.H + ((S.ds && S.ds.meta.hx) || 0);
function mesYM(i) { const [y, m] = S.ds.meta.base.split('-').map(Number); const d = new Date(y, m - 1 + i, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function capLineas() {
  const gen = capGen(), n = capN(), out = {};
  const dias = Array.from({ length: n }, (_, i) => Cob.diasLab(mesYM(i), gen.dias));
  for (const r of S.ds.refs) {
    const k = r.ln || '—', L = out[k] = out[k] || { k, carga: new Array(n).fill(0), n: 0 };
    L.n++; Cob.carga(r, S.pv, n - Cob.H).forEach((v, i) => { L.carga[i] += v; });
  }
  for (const L of Object.values(out)) {
    const p = k => k === '—' ? null : (S.ds.cap || {})[k] || null;
    L.p = p(L.k);
    L.cap = dias.map(d => Cob.capMes(L.p, gen, d));
    L.cap1 = dias.map(d => Cob.capMes(L.p && { ...L.p, turnos: 1 }, gen, d));
    L.sat = L.cap.map((c, i) => c ? L.carga[i] / c : null);
    L.tn = L.cap1.map((c, i) => c ? Math.ceil(L.carga[i] / c - 1e-9) : null);
    L.s3 = satAgg([L], 0, 3); L.sAll = satAgg([L], 0, n);
    L.t3 = L.p ? Math.max(...L.tn.slice(0, 3)) : null;
  }
  return out;
}
// Saturación de un grupo de líneas: suma de cargas ÷ suma de capacidades (solo las que tienen parámetros)
function satAgg(Ls, a, b) { let c = 0, k = 0; Ls.forEach(L => { for (let i = a; i < b; i++) if (L.cap[i]) { c += L.carga[i]; k += L.cap[i]; } }); return k ? c / k : null; }
const satCls = (s) => s == null ? '' : s > 1 ? 'sat-r' : s >= 0.85 ? 'sat-a' : 'sat-v';
const pctS = (s) => s == null ? '—' : Math.round(s * 100) + ' %';
const satCell = (s, tip = '') => `<td class="r num sat ${satCls(s)}"${tip ? ` title="${esc(tip)}"` : ''}>${pctS(s)}</td>`;
const turnTxt = (t) => t == null ? '—' : String(t).replace('.', ',');
const CAP_NOTA = 'Carga: contra stock y bajo pedido; OF del mes + lo que falta fabricar para cubrir la demanda y mantener el stock mínimo (las propuestas del MRP no cuentan). Capacidad: V.max × OEE × horas por turno × turnos × días laborables × (1 − holgura). Verde &lt; 85 %, ámbar 85–100 %, rojo &gt; 100 %.';
async function pageCap(main) {
  if (!S.ds) return noData(main, 'Capacidad');
  const CL = capLineas(), n = capN(), Ls = Object.values(CL);
  const ord = (a, b) => (b.s3 ?? -1) - (a.s3 ?? -1) || lnNom(a.k).localeCompare(lnNom(b.k), 'es');
  const tip = (L, i) => `${lnNom(L.k)} · ${monthLabel(i)}\nCarga ${fmt(L.carga[i])} uds\nCapacidad ${L.cap[i] ? fmt(L.cap[i]) + ' uds (' + turnTxt(L.p.turnos) + ' turnos)' : 'sin parámetros'}${L.tn[i] != null ? '\nTurnos necesarios ' + L.tn[i] : ''}`;
  const fila = (L) => `<tr><td class="art"><a href="#/linea/${encodeURIComponent(L.k)}">${esc(L.k === '—' ? 'Sin línea asignada' : lnNom(L.k))}</a> <span class="nm">${esc(lnSub(L.k))}</span></td>
    <td class="r num">${L.p ? turnTxt(L.p.turnos) : '—'}</td>${L.sat.map((s, i) => satCell(s, tip(L, i))).join('')}${satCell(L.sAll)}</tr>`;
  const grupos = {}; Ls.forEach(L => (grupos[lnArea(L.k) || SIN_AREA] = grupos[lnArea(L.k) || SIN_AREA] || []).push(L));
  const areas = Object.keys(grupos).sort((a, b) => (a === SIN_AREA) - (b === SIN_AREA) || a.localeCompare(b, 'es'));
  const cuerpo = !areasUsadas().length ? Ls.sort(ord).map(fila).join('') : areas.map(a => {
    const xs = grupos[a].sort(ord);
    return `<tr class="area-row"><th scope="rowgroup">${esc(a)}</th><td></td>${Array.from({ length: n }, (_, i) => satCell(satAgg(xs, i, i + 1))).join('')}${satCell(satAgg(xs, 0, n))}</tr>${xs.map(fila).join('')}`;
  }).join('');
  const rojas = Ls.filter(L => L.s3 > 1).length;
  main.innerHTML = `<h1>Capacidad</h1><p class="lead">Saturación de cada línea de ${monthLabel(0)} a ${monthLabel(n - 1)} (hasta el último mes con previsión)${rojas ? ` · <b>${rojas} ${rojas === 1 ? 'línea' : 'líneas'} por encima del 100 %</b> en los 3 próximos meses` : ''}.</p>
    <form onsubmit="return false" class="filters">${pvCtl()}<div class="fld"><span>&nbsp;</span><button type="button" class="btn ghost sm" id="capCsv">Descargar (CSV)</button></div></form>
    <div class="tw"><table class="mt capm"><caption class="sr">Saturación por línea y mes</caption><thead><tr><th scope="col">Línea</th><th scope="col" class="r">Turnos</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}<th scope="col" class="r">Media ${n} m</th></tr></thead><tbody>
    ${cuerpo}</tbody></table></div>
    <p class="muted small">${CAP_NOTA} Turnos, V.max y OEE se cambian en <a href="#/lineas">Líneas › Editar líneas</a>; horas, holgura y días laborables en Datos.</p>`;
  bindScenario(main, () => pageCap(main));
  $('#capCsv').onclick = () => {
    const head = ['Área', 'Línea', 'Nombre línea', 'Turnos', 'Fila', ...Array.from({ length: n }, (_, i) => monthLabel(i))];
    const lines = [];
    Ls.sort(ord).forEach(L => [['Carga uds', L.carga.map(Math.round)], ['Capacidad uds', L.cap.map(c => c == null ? '' : Math.round(c))],
      ['Saturación %', L.sat.map(s => s == null ? '' : Math.round(s * 100))], ['Turnos necesarios', L.tn.map(t => t == null ? '' : t)]]
      .forEach(([f, v]) => lines.push([lnArea(L.k), L.k, L.k === '—' ? 'Sin línea' : lnNom(L.k), L.p ? turnTxt(L.p.turnos) : '', f, ...v])));
    saveCSV(head, lines, 'capacidad');
  };
}

// ---------------------------------------------------------------- Líneas
function groupLines(list) { const g = {}; for (const x of list) (g[x.r.ln || '—'] = g[x.r.ln || '—'] || []).push(x); return g; }
async function pageLines(main) {
  if (!S.ds) return noData(main, 'Líneas');
  const cs = S.ev.filter(x => x.r.gp === 'Contra Stock');
  const L = S.ds.meta.lineas || {};
  // Todas las líneas con carga (también las que solo fabrican bajo pedido); las más saturadas primero
  const CL = capLineas(), gl = groupLines(cs);
  const rows = [...new Set([...Object.keys(gl), ...Object.keys(CL)])].map(k => { const xs = gl[k] || [], c = {}; xs.forEach(x => c[x.e.sem] = (c[x.e.sem] || 0) + 1); return { k, xs, c, L: CL[k] }; })
    .sort((a, b) => ((b.L && b.L.s3) ?? -1) - ((a.L && a.L.s3) ?? -1) || (b.c.rojo || 0) - (a.c.rojo || 0) || (b.c.naranja || 0) - (a.c.naranja || 0) || b.xs.length - a.xs.length);
  const capCols = (Ls) => { const L = Ls.length === 1 ? Ls[0] : null, d = Ls.filter(Boolean);
    return `${satCell(satAgg(d, 0, 3))}${satCell(satAgg(d, 0, Cob.H))}<td class="r num">${L && L.p ? turnTxt(L.p.turnos) + ' → ' + L.t3 : ''}</td>`; };
  const canW = can('admin', 'planificador');
  const barra = (c) => `<div class="bar2" style="display:flex;height:12px;border-radius:3px;overflow:hidden;gap:1px;min-width:160px" aria-hidden="true">${SEM.filter(([s]) => c[s]).map(([s]) => `<span class="s-${s}" style="flex:${c[s]};background:var(--c)"></span>`).join('')}</div>`;
  const fila = ({ k, xs, c, L }) => `<tr><td class="art"><a href="#/linea/${encodeURIComponent(k)}">${esc(lnNom(k))}</a> <span class="nm">${esc(lnSub(k))}</span></td><td class="r num">${xs.length}</td>
      <td>${barra(c)}</td><td class="r num">${c.rojo || 0}</td><td class="r num">${c.naranja || 0}</td><td class="r num">${c.amarillo || 0}</td>${capCols([L])}</tr>`;
  // Con áreas: cada área con su fila de totales y debajo sus líneas (las líneas sin área, al final)
  const grupos = {}; rows.forEach(x => (grupos[lnArea(x.k) || SIN_AREA] = grupos[lnArea(x.k) || SIN_AREA] || []).push(x));
  const nombresArea = Object.keys(grupos).sort((a, b) => (a === SIN_AREA) - (b === SIN_AREA) || a.localeCompare(b, 'es'));
  const cuerpo = !areasUsadas().length ? rows.map(fila).join('') : nombresArea.map(a => {
    const ls = grupos[a], c = {}; ls.forEach(x => SEM.forEach(([s]) => c[s] = (c[s] || 0) + (x.c[s] || 0)));
    const n = ls.reduce((t, x) => t + x.xs.length, 0);
    return `<tr class="area-row"><th scope="rowgroup">${esc(a)}</th><td class="r num">${n}</td><td>${barra(c)}</td>
      <td class="r num">${c.rojo || 0}</td><td class="r num">${c.naranja || 0}</td><td class="r num">${c.amarillo || 0}</td>${capCols(ls.map(x => x.L))}</tr>${ls.map(fila).join('')}`;
  }).join('');
  main.innerHTML = `<h1>Líneas</h1><p class="lead">Por grupo de máquina: estado de las referencias y saturación de la línea.</p>
    <form onsubmit="return false" class="filters">${scenarioCtl()}<div class="fld"><span>&nbsp;</span><button type="button" class="btn ghost sm" id="lnCsv">Descargar todas (CSV)</button></div>${canW ? '<div class="fld"><span>&nbsp;</span><button type="button" class="btn ghost sm" id="lnEd">Editar líneas</button></div>' : ''}</form>
    <div id="lnBox"></div>
    <div class="tw"><table><caption class="sr">Estado por línea</caption><thead><tr><th scope="col">Línea</th><th scope="col" class="r">Referencias</th><th scope="col">Reparto</th><th scope="col" class="r">Rotura</th><th scope="col" class="r">Bajo mínimo</th><th scope="col" class="r">A revisar</th><th scope="col" class="r" title="Carga ÷ capacidad con los turnos actuales, 3 próximos meses">Saturación 3 m</th><th scope="col" class="r">Media 12 m</th><th scope="col" class="r" title="Turnos actuales → turnos necesarios (máximo de los 3 próximos meses)">Turnos</th></tr></thead><tbody>
    ${cuerpo}
    </tbody></table></div>
    <p class="muted small">Estado: referencias contra stock. Saturación y turnos: ${CAP_NOTA} Detalle mes a mes en <a href="#/capacidad">Capacidad</a>.</p>`;
  bindScenario(main, () => pageLines(main));
  $('#lnCsv').onclick = () => downloadCSV(cs.slice().sort((a, b) => lnNom(a.r.ln || '—').localeCompare(lnNom(b.r.ln || '—')) || SEMORD[a.e.sem] - SEMORD[b.e.sem]), 'lineas');
  const ed = $('#lnEd');
  if (ed) ed.onclick = async () => {
    const ls = await api('/api/lineas');
    const yaAreas = [...new Set(ls.map(x => x.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    $('#lnBox').innerHTML = `<section class="card"><h2>Líneas: nombre, área y capacidad</h2><p class="muted small">Nombre corto para usar en toda la app (vacío o igual al código: se muestra el código). Área: agrupa varias líneas; vacío = sin área. Capacidad: V.max en uds/hora, OEE en % y turnos (0 a 3); los tres vacíos = sin capacidad.</p>
      <form class="form" id="lnF" style="max-width:none"><datalist id="lnAreas">${yaAreas.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
      <div class="tw"><table class="fit"><thead><tr><th scope="col">Código</th><th scope="col">Nombre en ABAS</th><th scope="col" class="r">Referencias</th><th scope="col">Nombre corto</th><th scope="col">Área</th><th scope="col" class="r">V.max (uds/h)</th><th scope="col" class="r">OEE %</th><th scope="col" class="r">Turnos</th></tr></thead><tbody>
      ${ls.map(x => `<tr><th scope="row">${esc(x.codigo)}</th><td>${esc(x.abas)}</td><td class="r num">${fmt(x.n)}</td><td><input name="${esc(x.codigo)}" value="${esc(x.nombre)}" maxlength="40" aria-label="Nombre corto de ${esc(x.codigo)}" style="width:200px"></td>
        <td><input name="area:${esc(x.codigo)}" value="${esc(x.area)}" list="lnAreas" maxlength="40" aria-label="Área de ${esc(x.codigo)}" style="width:180px"></td>
        <td><input name="vmax:${esc(x.codigo)}" value="${x.cap ? x.cap.vmax : ''}" inputmode="decimal" aria-label="V.max de ${esc(x.codigo)}" style="width:80px" class="r"></td>
        <td><input name="oee:${esc(x.codigo)}" value="${x.cap ? String(Math.round(x.cap.oee * 1000) / 10).replace('.', ',') : ''}" inputmode="decimal" aria-label="OEE de ${esc(x.codigo)}" style="width:64px" class="r"></td>
        <td><input name="tur:${esc(x.codigo)}" value="${x.cap ? turnTxt(x.cap.turnos) : ''}" inputmode="decimal" aria-label="Turnos de ${esc(x.codigo)}" style="width:56px" class="r"></td></tr>`).join('')}
      </tbody></table></div><div><button class="btn">Guardar</button> <button type="button" class="btn ghost" id="lnX">Cerrar</button></div></form></section>`;
    $('#lnX').onclick = () => { $('#lnBox').innerHTML = ''; };
    $('#lnF').onsubmit = async (ev) => {
      ev.preventDefault();
      const nombres = {}, areas = {}, cap = {}, el = ev.target.elements, num = (v) => v.trim() === '' ? null : Number(v.trim().replace(',', '.'));
      for (const x of ls) {
        const v = el[x.codigo].value.trim(), a = el['area:' + x.codigo].value.trim(); if (v !== x.nombre) nombres[x.codigo] = v; if (a !== x.area) areas[x.codigo] = a;
        const vm = num(el['vmax:' + x.codigo].value), oe = num(el['oee:' + x.codigo].value), tu = num(el['tur:' + x.codigo].value);
        if (vm == null && oe == null && tu == null) { if (x.cap) cap[x.codigo] = null; continue; }
        if ([vm, oe, tu].some(n => n == null || isNaN(n))) { toast(`Capacidad de ${x.codigo}: rellena V.max, OEE y turnos con números (o deja los tres vacíos)`); return; }
        const nv = { vmax: vm, oee: Math.round(oe * 10) / 1000, turnos: tu };
        if (!x.cap || x.cap.vmax !== nv.vmax || Math.abs(x.cap.oee - nv.oee) > 1e-9 || x.cap.turnos !== nv.turnos) cap[x.codigo] = nv;
      }
      if (!Object.keys(nombres).length && !Object.keys(areas).length && !Object.keys(cap).length) { toast('No hay cambios'); return; }
      try {
        const r = await api('/api/lineas', { method: 'PUT', body: { nombres, areas, cap } });
        S.ds.cap = Object.fromEntries(r.filter(x => x.cap).map(x => [x.codigo, x.cap]));
        S.ds.alias = Object.fromEntries(r.filter(x => x.nombre !== x.codigo).map(x => [x.codigo, x.nombre]));
        S.ds.areas = Object.fromEntries(r.filter(x => x.area).map(x => [x.codigo, x.area]));
        toast('Cambios guardados'); pageLines(main);
      } catch (e2) { toast(e2.message); }
    };
  };
}
function capBlock(L) {
  if (!L) return '';
  const n = capN(), fila = (t, v) => `<tr><th scope="row">${t}</th>${v.join('')}</tr>`;
  return `<h2>Capacidad</h2>${L.p ? `<p class="muted small">${fmt(L.p.vmax)} uds/h · OEE ${pctS(L.p.oee)} · ${turnTxt(L.p.turnos)} ${L.p.turnos === 1 ? 'turno' : 'turnos'}.</p>` : `<p class="muted small">Sin parámetros de capacidad: ponlos en <a href="#/lineas">Líneas › Editar líneas</a>.</p>`}
    <div class="tw"><table class="mt"><thead><tr><th scope="col">Unidades</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}</tr></thead><tbody>
      ${L.p ? fila('Capacidad', L.cap.map(v => `<td class="r num">${fmt(v)}</td>`)) : ''}
      ${fila('Carga', L.carga.map(v => `<td class="r num">${fmt(v)}</td>`))}
      ${L.p ? fila('Saturación', L.sat.map(s => satCell(s))) + fila('Turnos necesarios', L.tn.map(t => `<td class="r num${t > L.p.turnos ? ' neg' : ''}">${t}</td>`)) : ''}
    </tbody></table></div><p class="muted small">${CAP_NOTA}</p>`;
}
async function pageLine(main, [ln]) {
  if (!S.ds) return noData(main, 'Línea');
  const xs = S.ev.filter(x => (x.r.ln || '—') === ln && x.r.gp === 'Contra Stock');
  const n = Cob.H, dem = new Array(n).fill(0), ent = new Array(n).fill(0);
  xs.forEach(({ e }) => { for (let i = 0; i < n; i++) { dem[i] += e.all.dem[i]; ent[i] += e.all.ent[i]; } });
  main.innerHTML = `<p class="crumbs"><a href="#/lineas">Líneas</a> › ${esc(lnNom(ln))}</p><h1>${esc(lnNom(ln))}</h1><p class="lead">${[lnArea(ln) ? 'Área ' + lnArea(ln) : '', lnSub(ln), xs.length + ' referencias contra stock.'].filter(Boolean).map(esc).join(' · ')}</p>
    ${strip(xs, k => `#/coberturas?ln=${encodeURIComponent(ln)}&sem=${k}`)}
    ${capBlock(capLineas()[ln])}
    <h2>Demanda y entradas de la línea</h2>
    <div class="tw"><table class="mt"><thead><tr><th scope="col">Unidades</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}</tr></thead><tbody>
      <tr><th scope="row">Demanda</th>${dem.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
      <tr><th scope="row">Entradas</th>${ent.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr></tbody></table></div>
    <p class="muted small">Entradas: ${ESC_TXT[S.esc]}${S.pv === 'C' ? '; demanda con previsión corregida' : ''}.</p>
    <div class="toolbar"><h2>Referencias</h2><button class="btn ghost sm" id="csv">Descargar lista (CSV)</button></div>
    <div class="tw"><table class="oneline"><caption class="sr">Referencias de la línea y su cobertura</caption><thead id="lnHead"></thead><tbody id="lnBody"></tbody></table></div>`;
  let rows = [];
  const draw = () => {
    const { q } = parseHash(), key = q.get('sort') || 'sem', dir = parseInt(q.get('dir') || '1', 10);
    rows = sortTable(xs, key, dir, LIST_GET);
    $('#lnBody').innerHTML = rows.map(x => covRow(x, false)).join('') || `<tr><td colspan="${covCols(false)}" class="empty">Sin referencias.</td></tr>`;
    $('#lnHead').innerHTML = covHead(key, dir, false);
    covSort($('#lnHead'), key, dir, draw);
  };
  draw();
  $('#csv').onclick = () => downloadCSV(rows, 'linea_' + (ln === '—' ? 'sin_linea' : lnNom(ln).replace(/[^\w-]+/g, '_')));
}

// ---------------------------------------------------------------- Reunión semanal
async function pageMeeting(main) {
  if (!S.ds) return noData(main, 'Reunión semanal');
  await refreshActions(); updateChrome();
  const { q } = parseHash();
  const semF = q.get('sem') || 'rojo,naranja', onlyNo = q.get('sin') === '1';
  const canW = can('admin', 'planificador');
  const list = S.ev.filter(x => x.r.gp === 'Contra Stock' && semF.split(',').includes(x.e.sem) && (!onlyNo || !openActs(x.r.k).length))
    .sort(semF === 'exceso' ? (a, b) => (valor(b.r, b.e) ?? -1) - (valor(a.r, a.e) ?? -1)  // exceso: primero lo que más dinero inmoviliza
      : (a, b) => semKey(a) - semKey(b));  // como Coberturas: estado y, dentro, fecha estimada de rotura
  const today = todayISO();
  main.innerHTML = `<h1>Reunión semanal</h1>
    <form class="filters" onsubmit="return false">
      <label class="fld">Qué revisar<select id="mSem"><option value="rojo,naranja" ${semF === 'rojo,naranja' ? 'selected' : ''}>Rotura y bajo mínimo</option><option value="rojo" ${semF === 'rojo' ? 'selected' : ''}>Solo rotura</option><option value="rojo,naranja,amarillo" ${semF === 'rojo,naranja,amarillo' ? 'selected' : ''}>Rotura, bajo mínimo y a revisar</option><option value="exceso" ${semF === 'exceso' ? 'selected' : ''}>Exceso (por valor)</option></select></label>
      <label class="fld" style="flex-direction:row;align-items:center;gap:6px;padding-bottom:8px"><input type="checkbox" id="mSin" ${onlyNo ? 'checked' : ''}> Solo sin acción abierta</label>
      ${scenarioCtl()}</form>
    <h2>Por decidir (${list.length})</h2>
    <div class="tw"><table><thead><tr><th scope="col">Referencia</th><th scope="col">Línea</th><th scope="col">Rotura</th><th scope="col" title="Próxima entrada">Entrada</th><th scope="col">Acción abierta</th><th scope="col">Estado</th>${canW ? '<th scope="col"><span class="sr">Añadir</span></th>' : ''}</tr></thead><tbody>
    ${list.map(({ r, e }) => { const a = openActs(r.k)[0]; return `<tr>${refCell(r)}<td>${lnSpan(r.ln)}</td><td>${rotCell(e)}</td><td>${nextEntry(e)}</td>
      <td>${a ? `${esc(a.text)}<br><span class="muted small">${a.owner ? esc(a.owner) : ''}${a.due ? ' · ' + fdate(a.due) : ''}</span>` : '<span class="muted">—</span>'}</td><td>${pillShort(e)}</td>
      ${canW ? `<td><button class="btn ghost sm" data-add="${esc(r.k)}" aria-label="Añadir acción a ${esc(r.k)}">Añadir acción</button></td>` : ''}</tr>
      ${canW ? `<tr hidden id="af-${esc(r.k)}"><td colspan="7"><form class="form" data-f="${esc(r.k)}" style="max-width:none"><div class="row"><label>Acción<input name="text" required maxlength="2000"></label><label>Responsable<input name="owner" maxlength="120"></label><label>Fecha límite<input type="date" name="due"></label><button class="btn">Guardar</button></div></form></td></tr>` : ''}`; }).join('') || '<tr><td colspan="7" class="empty">Nada pendiente con estos criterios.</td></tr>'}
    </tbody></table></div>
    <h2>Acciones abiertas (${S.actions.length})</h2>
    <div class="tw"><table><thead><tr><th scope="col">Referencia</th><th scope="col">Acción</th><th scope="col">Responsable</th><th scope="col">Fecha límite</th><th scope="col">Creada</th>${canW ? '<th scope="col"><span class="sr">Estado</span></th>' : ''}</tr></thead><tbody>
    ${S.actions.map(a => `<tr><td class="art" title="${esc((S.byK[a.ref] || { r: { n: '' } }).r.n)}"><a href="${refHref(a.ref)}">${esc(a.ref)}</a> <span class="nm">${esc((S.byK[a.ref] || { r: { n: '' } }).r.n)}</span></td><td>${esc(a.text)}</td><td>${esc(a.owner || '')}</td><td class="${a.due && a.due < today ? 'neg' : ''}">${a.due ? fdate(a.due) : ''}</td><td class="small muted">${fdate(a.created)} · ${esc(a.created_by_name)}</td>
      ${canW ? `<td><button class="btn ghost sm" data-st="hecha" data-id="${a.id}">Hecha</button> <button class="btn ghost sm" data-st="descartada" data-id="${a.id}">Descartar</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">No hay acciones abiertas.</td></tr>'}
    </tbody></table></div>`;
  $('#mSem').onchange = (e) => { setQuery({ sem: e.target.value }); pageMeeting(main); };
  $('#mSin').onchange = (e) => { setQuery({ sin: e.target.checked ? '1' : '' }); pageMeeting(main); };
  bindScenario(main, () => pageMeeting(main));
  $$('[data-add]', main).forEach(b => b.onclick = () => { const tr = document.getElementById('af-' + b.dataset.add); tr.hidden = !tr.hidden; if (!tr.hidden) $('input', tr).focus(); });
  $$('form[data-f]', main).forEach(f => f.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(f); try { await api('/api/actions', { method: 'POST', body: { ref: f.dataset.f, text: fd.get('text'), owner: fd.get('owner'), due: fd.get('due') } }); toast('Acción añadida'); pageMeeting(main); } catch (e) { toast(e.message); } });
  $$('[data-st]', main).forEach(b => b.onclick = async () => { try { await api('/api/actions/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.st } }); toast(b.dataset.st === 'hecha' ? 'Acción marcada como hecha' : 'Acción descartada'); pageMeeting(main); } catch (e) { toast(e.message); } });
}

// ---------------------------------------------------------------- Datos (admin)
function abcForm() {
  const a = abcCfg(), inp = (name, v, w = 64) => `<input name="${name}" value="${esc(String(v).replace('.', ','))}" inputmode="decimal" style="width:${w}px">`;
  const src = (pre) => pre === 'ns' ? (S.cfg.ns || {}) : a[pre === 'fr' ? 'freq' : 'ss'];
  const fila = (md, pre, lbl) => `<tr><th scope="row">${md} · ${lbl}</th>${ABC_CL.map((c, i) => `<td>${inp(`${pre}_${md}_${c}`, (src(pre)[md] || [])[i] ?? '')}</td>`).join('')}</tr>`;
  return `<form class="form" id="abcF" style="max-width:none"><p class="muted small" style="margin:0">Pareto por mandante sobre la venta de 12 meses. Al guardar se recalcula la carga vigente.</p>
    <div class="row">${[0, 1, 2].map(i => `<label>Corte ${ABC_CL[i]} (% acumulado de venta)<input type="number" name="corte${i}" min="1" max="99" value="${a.cortes[i]}"></label>`).join('')}</div>
    <div class="tw"><table class="fit abcp"><thead><tr><th scope="col">Por clase</th>${ABC_CL.map(c => `<th scope="col">${abcTag(c)}</th>`).join('')}</tr></thead><tbody>
      ${['Belloch', 'Yunsey'].map(md => fila(md, 'fr', 'fabricaciones/año') + fila(md, 'ss', '% stock mínimo (Excel)') + fila(md, 'ns', 'nivel de servicio %')).join('')}</tbody></table></div>
    <div><button class="btn ghost">Guardar parámetros del ABC</button></div></form>`;
}
async function pageData(main) {
  if (!can('admin')) return pageNotFound(main);
  const loads = await api('/api/loads');
  main.innerHTML = `<h1>Datos</h1><p class="lead">Sube el MM_Supply: primero se comprueba y después se publica.</p>
    <div class="grid2"><section class="card"><h2>Cargar MM_Supply</h2>
      <form class="form" id="upF" style="max-width:none">
        <label class="drop" id="drop">Arrastra aquí el fichero o haz clic para elegirlo<input type="file" name="file" accept=".xlsx,.xlsm" class="sr" id="upFile"></label>
        <p class="muted small" id="fname"></p>
        <div class="row"><label>Fecha de los datos<input type="date" name="fecha" value="${todayISO()}"></label><button class="btn" id="chk" type="submit">Comprobar fichero</button></div>
      </form>
      <div id="prev" aria-live="polite"></div></section>
    <section class="card"><h2>Criterios del semáforo</h2>
      <form class="form" id="cfgF"><label>Horizonte de alerta (meses)<input type="number" name="hz" min="1" max="6" value="${S.cfg.horizonte}"></label>
        <div class="row"><label>Exceso Belloch (meses de stock)<input type="number" name="exB" min="1" max="12" value="${(S.cfg.exceso || {}).Belloch || 6}"></label><label>Exceso Yunsey (meses de stock)<input type="number" name="exY" min="1" max="12" value="${(S.cfg.exceso || {}).Yunsey || 12}"></label></div>
        <div><button class="btn ghost">Guardar criterios</button></div></form>
      <p class="muted small">Rotura: stock proyectado &lt; 0 en el horizonte. Bajo mínimo: &lt; stock mínimo. A revisar: depende de propuestas sin fijar, OF atrasada, rotura antes de la entrada de este mes, sin stock ni entradas, o entradas sin demanda. Exceso (contra stock): el stock de hoy supera el stock máximo (stock mínimo + lote); si no tiene lote, la demanda de los próximos meses indicados. Sin demanda: nada previsto en 12 meses.</p></section>
    <section class="card"><h2>ABC y fabricación</h2>${abcForm()}</section>
    ${S.ds ? `<section class="card"><h2>Capacidad</h2>
      <form class="form" id="capF" style="max-width:none"><div class="row"><label>Horas por turno<input name="ht" inputmode="decimal" value="${String(capGen().horas_turno).replace('.', ',')}"></label><label>Holgura y esperas (%)<input name="hg" inputmode="decimal" value="${String(Math.round(capGen().holgura * 1000) / 10).replace('.', ',')}"></label></div>
        <p class="muted small">Días laborables de cada mes (vacío: de lunes a viernes).</p>
        <div class="row" style="flex-wrap:wrap">${Array.from({ length: capN() }, (_, i) => `<label style="width:64px">${monthLabel(i)}<input name="d_${mesYM(i)}" inputmode="numeric" value="${capGen().dias[mesYM(i)] ?? ''}" placeholder="${Cob.diasLab(mesYM(i), {})}"></label>`).join('')}</div>
        <div><button class="btn ghost">Guardar capacidad</button></div></form>
      <p class="muted small">Capacidad del mes = V.max × OEE × horas por turno × turnos × días × (1 − holgura). V.max, OEE y turnos de cada línea, en Líneas › Editar líneas.</p></section>` : ''}</div>
    <h2>Historial de cargas</h2>
    <div class="tw"><table><thead><tr><th scope="col">Cargado</th><th scope="col">Fichero</th><th scope="col">Fecha datos</th><th scope="col">Previsión</th><th scope="col" class="r">Referencias</th><th scope="col">Estado</th><th scope="col">Usuario</th></tr></thead><tbody>
    ${loads.map(l => `<tr><td>${fdt(l.created)}</td><td>${esc(l.filename)}</td><td>${fdate(l.hoy)}</td><td>${esc(l.version)}</td><td class="r num">${l.n}</td>
      <td class="small">${SEM.map(([k, t]) => l.counts[k] ? `<span class="pill s-${k}">${l.counts[k]}<span class="sr"> ${t}</span></span>` : '').join(' ')}</td><td>${esc(l.by || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Todavía no hay cargas.</td></tr>'}
    </tbody></table></div>`;
  const f = $('#upF'), inp = $('#upFile'), drop = $('#drop');
  inp.onchange = () => { $('#fname').textContent = inp.files[0] ? 'Fichero: ' + inp.files[0].name : ''; $('#prev').innerHTML = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('hover'); }; drop.ondragleave = () => drop.classList.remove('hover');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('hover'); if (e.dataTransfer.files[0]) { inp.files = e.dataTransfer.files; inp.onchange(); } };
  const send = async (dry) => {
    if (!inp.files[0]) { $('#prev').innerHTML = '<p class="msg err">Elige primero el fichero MM_Supply.</p>'; return null; }
    const fd = new FormData(); fd.append('file', inp.files[0]); fd.append('fecha', f.fecha.value); fd.append('dry', dry ? '1' : '0');
    return api('/api/upload', { method: 'POST', body: fd });
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const b = $('#chk'); b.disabled = true; $('#prev').innerHTML = '<p class="msg">Leyendo y calculando…</p>';
    try {
      const r = await send(true); if (!r) return; const p = r.preview;
      $('#prev').innerHTML = `<div class="notice"><p><b>Fichero correcto.</b> Previsión ${esc(p.version)}, ${p.n} referencias de PT activas, datos del ${fdate(p.hoy)}.</p>
        <p>${SEM.map(([k, t]) => `${t}: <b>${p.counts[k] || 0}</b>`).join(' · ')}</p>${p.sustituye ? `<p><b>Sustituirá la carga del ${fdate(p.hoy)}</b> publicada el ${fdt(p.sustituye)}: hay una carga por fecha de datos.</p>` : ''}${p.cambios ? `<p>Frente a la carga anterior: entran <b>${p.cambios.entran}</b> · salen <b>${p.cambios.salen}</b> referencias (detalle en <a href="#/porfolio">Porfolio</a>).</p>` : ''}${p.warn.length ? `<p class="msg err">${p.warn.map(esc).join('<br>')}</p>` : ''}
        <button class="btn" id="pubB">Publicar para todos</button></div>`;
      $('#pubB').onclick = async () => { $('#pubB').disabled = true; try { await send(false); await loadData(); updateChrome(); toast('Datos publicados'); pageData(main); } catch (e) { $('#prev').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; } };
    } catch (e) { $('#prev').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
    b.disabled = false;
  };
  $('#abcF').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target, n = (x) => Number(String(x).replace(',', '.'));
    const por = (pre) => Object.fromEntries(['Belloch', 'Yunsey'].map(md => [md, ABC_CL.map(c => n(f[`${pre}_${md}_${c}`].value))]));
    const body = { abc: { cortes: [0, 1, 2].map(i => parseInt(f['corte' + i].value, 10)), freq: por('fr'), ss: por('ss') }, ns: por('ns') };
    try { S.cfg = await api('/api/config', { method: 'PUT', body }); await loadData(); updateChrome(); toast('Parámetros guardados'); } catch (e) { toast(e.message); }
  };
  if ($('#capF')) $('#capF').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target, n = (x) => Number(String(x).trim().replace(',', '.'));
    const dias = {};
    for (let i = 0; i < capN(); i++) { const v = f['d_' + mesYM(i)].value.trim(); dias[mesYM(i)] = v === '' ? null : n(v); }
    try { S.cfg = await api('/api/config', { method: 'PUT', body: { capacidad: { horas_turno: n(f.ht.value), holgura: n(f.hg.value) / 100, dias } } }); toast('Capacidad guardada'); } catch (e) { toast(e.message); }
  };
  $('#cfgF').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { S.cfg = await api('/api/config', { method: 'PUT', body: { horizonte: parseInt(f.hz.value, 10), exceso: { Belloch: parseInt(f.exB.value, 10), Yunsey: parseInt(f.exY.value, 10) } } }); recompute(); updateChrome(); toast('Criterios guardados'); } catch (e) { toast(e.message); } };
}

// ---------------------------------------------------------------- Stock mínimo y lotes
const PEST = { decidir: 'Decidir a mano', cambio: 'Con cambio', igual: 'Igual', decidido: 'Pendiente de ABAS', aplicado: 'Aplicado' };
const PTIPO = { irregular: 'irregular', sin_hist: 'sin historia', extinguir: 'a extinguir', sin_prev: 'sin previsión' };
// Fuentes que corresponden a la propuesta, para aceptarla tal cual
const srcProp = (p) => ({ ss: { src: p.ssp === p.mn ? 'erp' : 'estadistico' }, lote: { src: p.ltp === p.lt ? 'erp' : 'calculado' } });
async function pageParams(main) {
  if (!S.ds) return noData(main, 'Stock mínimo y lotes');
  const P = await api('/api/parametros');
  if (P.empty) return noData(main, 'Stock mínimo y lotes');
  const canW = can('admin', 'planificador'), { q } = parseHash();
  const estF = (q.get('estado') || 'decidir,cambio').split(','), md = q.get('md') || '', abc = q.get('abc') || '', ln = q.get('ln') || '';
  const xs = P.rows.filter(p => estF.includes(p.estado) && (!md || p.md === md) && (!abc || p.abc === abc) && (!ln || (p.ln || '—') === ln))
    .sort((a, b) => Math.abs(b.de) - Math.abs(a.de) || (a.k < b.k ? -1 : 1));
  const E = P.resumen.estados, nAbas = E.decidido || 0;
  const tot = (k) => P.resumen.grupos.reduce((s, g) => s + g[k], 0);
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const cnt = (est, t) => `<a class="kpi kpi-link" href="#/parametros?estado=${est}"><div class="v">${fmt(E[est] || 0)}</div><div class="l">${t}</div></a>`;
  const pct = (x) => x == null ? '<span class="muted">—</span>' : Math.round(x * 100) + ' %';
  const n0 = (v) => v == null ? '<span class="muted">—</span>' : fmt(v);
  const fila = (p) => {
    const marca = [PTIPO[p.tipo], p.flag ? 'corregir previsión' : ''].filter(Boolean).join(' · ');
    const ctl = canW ? `<td class="nowrap"><select data-ss="${esc(p.k)}" aria-label="Stock mínimo de ${esc(p.k)}"><option value="erp">ERP</option><option value="excel">Excel</option><option value="estadistico" ${p.est == null ? 'disabled' : ''}>Estadístico</option><option value="manual">Manual</option></select>
        <input type="number" min="0" step="100" data-ssv="${esc(p.k)}" hidden aria-label="Stock mínimo manual" style="width:90px">
        <select data-lt="${esc(p.k)}" aria-label="Lote de ${esc(p.k)}"><option value="erp">ERP</option><option value="calculado">Calculado</option><option value="manual">Manual</option></select>
        <input type="number" min="0" step="100" data-ltv="${esc(p.k)}" hidden aria-label="Lote manual" style="width:90px">
        <button class="btn ghost sm" data-dec="${esc(p.k)}">Decidir</button></td>` : '';
    return `<tr>${refCell({ k: p.k, n: p.n })}<td>${abcTag(p.abc)}</td><td class="r num">${fmt(p.pm)}</td><td class="r num">${pct(p.er)}</td>
      <td class="r num">${fmt(p.mn)}</td><td class="r num">${fmt(p.xl)}</td><td class="r num">${n0(p.est)}</td><td class="r num"><b>${fmt(p.d ? p.ss : p.ssp)}</b></td>
      <td class="r num">${fmt(p.lt)}</td><td class="r num"><b>${fmt(p.d ? p.lote : p.ltp)}</b></td><td class="r num ${p.de > 0 ? 'neg' : ''}">${p.pr > 0 ? eur(p.de) : '<span class="muted">sin precio</span>'}</td>
      <td class="nowrap">${PEST[p.estado]}${marca ? ` <span class="muted small">(${marca})</span>` : ''}</td>${ctl}</tr>`;
  };
  const lim = 300;
  main.innerHTML = `<h1>Stock mínimo y lotes</h1>
    <p class="lead">Contra stock con ABC. Stock mínimo: ERP, método Excel (lote × % de la clase) y estadístico (nivel de servicio × error de previsión × plazo). Propuesta: estadístico si hay cifra; si no, el ERP.</p>
    <div class="tw"><table class="fit"><caption class="sr">Valor por mandante y clase</caption><thead>${head2([thc('Mandante · Clase'), thc('Referencias', 'r'),
      { g: 'Stock mínimo €', c: [thc('ERP', 'r', 'Stock mínimo del ERP'), thc('Prop.', 'r', 'Stock mínimo propuesto'), thc('Dec.', 'r', 'Stock mínimo decidido')] },
      { g: 'Stock medio €', c: [thc('ERP', 'r', 'Stock medio del ERP'), thc('Prop.', 'r', 'Stock medio propuesto'), thc('Dec.', 'r', 'Stock medio decidido')] }])}</thead><tbody>
      ${P.resumen.grupos.map(g => `<tr><th scope="row">${esc(g.md)} · ${abcTag(g.abc)}</th><td class="r num">${fmt(g.n)}</td><td class="r num">${keur(g.ss_erp)}</td><td class="r num">${keur(g.ss_prop)}</td><td class="r num">${keur(g.ss_dec)}</td><td class="r num">${keur(g.med_erp)}</td><td class="r num">${keur(g.med_prop)}</td><td class="r num">${keur(g.med_dec)}</td></tr>`).join('')}
      <tr><th scope="row"><b>Total</b></th><td class="r num"><b>${fmt(tot('n'))}</b></td>${['ss_erp', 'ss_prop', 'ss_dec', 'med_erp', 'med_prop', 'med_dec'].map(k => `<td class="r num"><b>${keur(tot(k))}</b></td>`).join('')}</tr></tbody></table></div>
    <div class="kpis">${cnt('decidir', 'Por decidir a mano')}${cnt('cambio', 'Con cambio propuesto')}${cnt('decidido', 'Decididos, pendientes de ABAS')}${cnt('aplicado', 'Aplicados')}</div>
    <p>${nAbas ? `<a class="btn" href="/api/parametros/abas.csv" download>Descargar cambios para ABAS (${fmt(nAbas)})</a>` : '<span class="muted">No hay cambios pendientes de cargar en ABAS.</span>'}</p>
    <form class="filters" id="pF" onsubmit="return false">
      <label class="fld">Estado<select name="estado">${[['decidir,cambio', 'Por decidir y con cambio'], ['decidir', PEST.decidir], ['cambio', PEST.cambio], ['decidido', PEST.decidido], ['aplicado', PEST.aplicado], ['igual', PEST.igual]].map(([v, t]) => `<option value="${v}" ${estF.join(',') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], md, 'Todos')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D'], abc, 'Todas')}</select></label>
      <label class="fld">Línea<select name="ln">${lnOpts([...new Set(P.rows.map(p => p.ln || '—'))], ln)}</select></label>
      ${canW ? `<label class="fld" style="flex:1 1 260px">Motivo (obligatorio si hay valores manuales)<input name="motivo" maxlength="500" id="pMot" value="${esc(S.pMot || '')}"></label>` : ''}
    </form>
    <div class="toolbar"><span class="count">${fmt(xs.length)} referencias${xs.length > lim ? ` · se muestran las ${lim} de más impacto` : ''}</span>
      ${canW && xs.some(p => p.estado === 'cambio') ? `<button class="btn ghost sm" id="pBulk">Aceptar las ${fmt(xs.filter(p => p.estado === 'cambio').length)} propuestas con cambio</button>` : ''}</div>
    <div class="tw"><table class="ptab"><caption class="sr">Parámetros por referencia</caption><thead>${head2([thc('Referencia'), thc('ABC'), thc('Previsión/mes', 'r'), thc('Error previsión', 'r'),
      { g: 'Stock mínimo', c: [thc('ERP', 'r', 'Stock mínimo del ERP'), thc('Excel', 'r', 'Stock mínimo método Excel'), thc('Estadístico', 'r', 'Stock mínimo estadístico'), thc('Propuesta · Decidido', 'r', 'Stock mínimo propuesto · decidido')] },
      { g: 'Lote', c: [thc('ERP', 'r', 'Lote del ERP'), thc('Propuesta · Decidido', 'r', 'Lote propuesto · decidido')] },
      thc('Δ € stock medio', 'r'), thc('Estado'), ...(canW ? [thc('Decisión')] : [])])}</thead>
      <tbody>${xs.slice(0, lim).map(fila).join('') || `<tr><td colspan="${canW ? 13 : 12}" class="empty">Nada con estos filtros.</td></tr>`}</tbody></table></div>
    <p class="muted small">Δ € = variación del stock medio (stock mínimo + lote/2) a coste frente al ERP. Previsión/mes: media de los 3 próximos meses. Error: desviación típica de (venta − previsión) ÷ venta media, 12 meses cerrados.</p>`;
  xs.slice(0, lim).forEach(p => { const sp = srcProp(p), e = CSS.escape(p.k); const a = $(`[data-ss="${e}"]`, main), b = $(`[data-lt="${e}"]`, main); if (a) a.value = sp.ss.src; if (b) b.value = sp.lote.src; });
  $('#pF').addEventListener('change', (ev) => { const n = ev.target.name; if (!n || n === 'motivo') return; setQuery({ [n]: ev.target.value }); pageParams(main); });
  const motivo = () => ($('#pMot') ? $('#pMot').value.trim() : '');
  if ($('#pMot')) $('#pMot').oninput = (ev) => { S.pMot = ev.target.value; };  // se conserva al cambiar de filtro
  const enviar = async (items) => { try { const r = await api('/api/parametros/decisiones', { method: 'POST', body: { items, motivo: motivo() } }); toast(`${r.n} ${r.n === 1 ? 'decisión guardada' : 'decisiones guardadas'}`); await pageParams(main); } catch (e) { toast(e.message); } };
  $$('[data-ss],[data-lt]', main).forEach(s => s.onchange = () => { const k = s.dataset.ss || s.dataset.lt, inp = $(`[data-${s.dataset.ss ? 'ssv' : 'ltv'}="${CSS.escape(k)}"]`, main); inp.hidden = s.value !== 'manual'; if (!inp.hidden) inp.focus(); });
  $$('[data-dec]', main).forEach(b => b.onclick = () => {
    const k = b.dataset.dec, e = CSS.escape(k), it = { ref: k };
    for (const [key, sel, val] of [['ss', 'ss', 'ssv'], ['lote', 'lt', 'ltv']]) {
      const src = $(`[data-${sel}="${e}"]`, main).value;
      it[key] = src === 'manual' ? { src, v: parseInt($(`[data-${val}="${e}"]`, main).value, 10) } : { src };
      if (src === 'manual' && !(it[key].v >= 0)) { toast('Escribe el valor manual'); return; }
    }
    enviar([it]);
  });
  const bulk = $('#pBulk');
  if (bulk) bulk.onclick = () => { const its = xs.filter(p => p.estado === 'cambio').map(p => ({ ref: p.k, ...srcProp(p) })); if (confirm(`¿Aceptar la propuesta en ${its.length} referencias?`)) enviar(its); };
}

// ---------------------------------------------------------------- Desviación de previsiones
const DEST = { propuesta: 'Con propuesta', revisar: 'Revisar con comercial', sin: 'Sin corrección', sin_dato: 'Sin datos', extinguir: 'A extinguir', acordado: 'Acordado' };
const pctTxt = (x) => x == null ? '<span class="muted">—</span>' : x > 3 ? '&gt; +300 %' : (x > 0 ? '+' : '') + Math.round(x * 100) + ' %';  // casi sin venta (lanzamientos): no se da la cifra
async function pageDesv(main) {
  if (!S.ds) return noData(main, 'Desviación de previsiones');
  const D = await api('/api/desviacion');
  if (D.empty) return noData(main, 'Desviación de previsiones');
  const canW = can('admin', 'planificador'), { q } = parseHash();
  const mc = q.get('mc') || '', estF = (q.get('estado') || 'propuesta,revisar').split(','), md = q.get('md') || '', abc = q.get('abc') || '';
  const xs = D.rows.filter(p => (!mc || p.mc === mc) && estF.includes(p.estado) && (!md || p.md === md) && (!abc || p.abc === abc))
    .sort((a, b) => Math.abs(b.ee) - Math.abs(a.ee) || Math.abs(b.eu) - Math.abs(a.eu));
  const vs = (D.vers || []).filter(x => !mc || x.mc === mc), V = {};
  vs.forEach(x => { const a = V[x.v] = V[x.v] || { e: 0, s: 0, p: 0, n: 0, m: 0 }; a.e += x.e; a.s += x.s; a.p += x.p; a.n += x.n; a.m = Math.max(a.m, x.m); });
  const ratio = (a, b) => b ? a / b : null, lim = 300;
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const marcaFila = (x) => `<tr${x.mc === mc ? ' aria-current="true" class="sel"' : ''}><th scope="row">${x.mc === 'Total' ? '<a href="#/desviacion">Total</a>' : `<a href="#/desviacion?mc=${encodeURIComponent(x.mc)}">${esc(x.mc)}</a>`}</th>
    <td class="r num">${fmt(x.n)}</td><td class="r num">${fmt(x.p12)}</td><td class="r num">${fmt(x.v12)}</td><td class="r num">${pctTxt(x.dv)}</td><td class="r num">${pctTxt(x.sh)}</td><td class="r num">${x.er == null ? '—' : Math.round(x.er * 100) + ' %'}</td>
    <td class="r num">${fmt(x.prop)}</td><td class="r num">${fmt(x.rev)}</td><td class="r num">${fmt(x.acu)}</td><td class="r num">${fmt(x.eu)}</td><td class="r num">${eur(x.ee)}</td></tr>`;
  const ctl = (p) => canW ? `<td class="nowrap">${p.cp != null && p.cp !== 0 ? `<button class="btn ghost sm" data-acc="${esc(p.k)}">Aceptar</button> ` : ''}<input type="number" step="1" min="-90" max="300" data-pct="${esc(p.k)}" aria-label="Corrección en % de ${esc(p.k)}" style="width:70px"> <button class="btn ghost sm" data-otro="${esc(p.k)}">Otro %</button> <button class="btn ghost sm" data-man="${esc(p.k)}">Mantener</button></td>` : '';
  const fila = (p) => `<tr>${refCell({ k: p.k, n: p.n })}<td>${abcTag(p.abc)}</td><td class="r num">${fmt(p.p12)}</td><td class="r num">${fmt(p.v12)}</td><td class="r num">${pctTxt(p.cr)}</td><td class="r num">${pctTxt(p.cs)}</td>
    <td class="r num"><b>${p.estado === 'acordado' ? pctTxt(p.ca) : pctTxt(p.cp)}</b></td><td class="r num">${fmt(p.pvc.reduce((s, x) => s + x, 0))}</td><td class="r num">${p.pr > 0 ? eur(p.ee) : '<span class="muted">sin precio</span>'}</td><td class="nowrap">${DEST[p.estado]}</td>${ctl(p)}</tr>`;
  main.innerHTML = `<h1>Desviación de previsiones${mc ? ' · ' + esc(mc) : ''}</h1>
    <p class="lead">Contra stock con ABC · previsión ${esc(D.version)}. Corrección propuesta: la más prudente entre el ritmo de venta (venta de 12 meses frente a la previsión de 12 meses) y el sesgo histórico de la referencia; si se contradicen, revisar con comercial; menos del 10 %, sin corrección.</p>
    <div class="tw"><table class="fit"><caption class="sr">Desviación por marca</caption><thead><tr><th scope="col">Marca</th><th scope="col" class="r">Referencias</th><th scope="col" class="r">Previsión 12 m</th><th scope="col" class="r">Venta 12 m</th><th scope="col" class="r" title="Previsión 12 m ÷ venta 12 m">Prev./venta</th><th scope="col" class="r">Sesgo pasado</th><th scope="col" class="r">Error pasado</th><th scope="col" class="r">Con propuesta</th><th scope="col" class="r">A revisar</th><th scope="col" class="r">Acordadas</th><th scope="col" class="r">Efecto uds</th><th scope="col" class="r">Efecto €</th></tr></thead>
      <tbody>${D.marcas.map(marcaFila).join('')}</tbody></table></div>
    <h2>Acierto por versión${mc ? ' · ' + esc(mc) : ''}</h2>
    ${D.vers ? `<div class="tw"><table class="fit"><caption class="sr">Acierto por versión</caption><thead><tr><th scope="col">Versión</th><th scope="col" class="r">Meses cerrados</th><th scope="col" class="r">Referencias</th><th scope="col" class="r">Error previsión</th><th scope="col" class="r">Sesgo</th></tr></thead><tbody>
      ${Object.keys(V).sort().map(v => `<tr><th scope="row">${esc(v)}</th><td class="r num">${V[v].m}</td><td class="r num">${fmt(V[v].n)}</td><td class="r num">${V[v].s ? Math.round(V[v].e / V[v].s * 100) + ' %' : '—'}</td><td class="r num">${pctTxt(ratio(V[v].p, V[v].s) == null ? null : V[v].p / V[v].s - 1)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin versiones con meses cerrados.</td></tr>'}
      </tbody></table></div><p class="muted small">Error = Σ |venta − previsión| ÷ Σ venta en los meses cerrados que cubría cada versión desde el inicio de su trimestre. Sesgo positivo: se previó más de lo vendido.</p>` : '<p class="muted">Esta carga no trae el acierto por versión. Vuelve a cargar el MM_Supply desde Datos para verlo.</p>'}
    <h2>Para la reunión</h2>
    <form class="filters" id="dF" onsubmit="return false">
      <label class="fld">Estado<select name="estado">${[['propuesta,revisar', 'Con propuesta y a revisar'], ['propuesta', DEST.propuesta], ['revisar', DEST.revisar], ['acordado', DEST.acordado], ['sin', DEST.sin], ['sin_dato', DEST.sin_dato]].map(([v, t]) => `<option value="${v}" ${estF.join(',') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], md, 'Todos')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D'], abc, 'Todas')}</select></label>
      ${canW ? `<label class="fld" style="flex:1 1 260px">Motivo (obligatorio con "Otro %")<input id="dMot" maxlength="500" value="${esc(S.dMot || '')}"></label>` : ''}
    </form>
    <div class="toolbar"><span class="count">${fmt(xs.length)} referencias${xs.length > lim ? ` · se muestran las ${lim} de más efecto` : ''}</span>
      ${canW && xs.some(p => p.estado === 'propuesta') ? `<button class="btn ghost sm" id="dBulk">Aceptar las ${fmt(xs.filter(p => p.estado === 'propuesta').length)} propuestas</button>` : ''}
      <a class="btn ghost sm" href="/api/desviacion/acuerdos.csv" download>Descargar acuerdos (CSV)</a></div>
    <div class="tw"><table><caption class="sr">Referencias para la reunión</caption><thead>${head2([thc('Referencia'), thc('ABC'), thc('Previsión 12 m', 'r'), thc('Venta 12 m', 'r'),
      { g: 'Corrección', c: [thc('Ritmo', 'r', 'Corrección por ritmo de venta'), thc('Sesgo', 'r', 'Corrección por sesgo histórico')] },
      thc('Propuesta · Acordado', 'r'), thc('Prev. corregida', 'r', 'Previsión corregida'), thc('Efecto €', 'r'), thc('Estado'), ...(canW ? [thc('Acuerdo')] : [])])}</thead>
      <tbody>${xs.slice(0, lim).map(fila).join('') || `<tr><td colspan="${canW ? 11 : 10}" class="empty">Nada con estos filtros.</td></tr>`}</tbody></table></div>
    <p class="muted small">Las correcciones van en el sentido de lo que hay que hacer con la previsión (negativo: bajarla). Corrección por ritmo: venta de los 12 últimos meses cerrados ÷ previsión de los 12 próximos − 1. Corrección por sesgo: venta ÷ previsión vigente de los 12 meses pasados − 1 (solo con historia propia). En la tabla por marca, en cambio, el sesgo positivo indica que se previó de más. Efecto a coste.</p>`;
  $('#dF').addEventListener('change', (ev) => { const n = ev.target.name; if (!n) return; setQuery({ [n]: ev.target.value }); pageDesv(main); });
  const mot = $('#dMot'); if (mot) mot.oninput = (ev) => { S.dMot = ev.target.value; };
  const enviar = async (items) => { try { const r = await api('/api/desviacion/acuerdos', { method: 'POST', body: { items, motivo: mot ? mot.value.trim() : '' } }); toast(`${r.n} ${r.n === 1 ? 'acuerdo guardado' : 'acuerdos guardados'}`); await pageDesv(main); } catch (e) { toast(e.message); } };
  $$('[data-acc]', main).forEach(b => b.onclick = () => enviar([{ ref: b.dataset.acc, src: 'propuesta' }]));
  $$('[data-man]', main).forEach(b => b.onclick = () => enviar([{ ref: b.dataset.man, src: 'mantener' }]));
  $$('[data-otro]', main).forEach(b => b.onclick = () => { const v = parseFloat(String($(`[data-pct="${CSS.escape(b.dataset.otro)}"]`, main).value).replace(',', '.')); if (isNaN(v)) { toast('Escribe la corrección en %'); return; } enviar([{ ref: b.dataset.otro, src: 'manual', pct: v }]); });
  const bulk = $('#dBulk'); if (bulk) bulk.onclick = () => { const its = xs.filter(p => p.estado === 'propuesta').map(p => ({ ref: p.k, src: 'propuesta' })); if (confirm(`¿Aceptar la propuesta en ${its.length} referencias?`)) enviar(its); };
}

// ---------------------------------------------------------------- Usuarios (admin)
async function pageUsers(main) {
  if (!can('admin')) return pageNotFound(main);
  const us = await api('/api/users');
  const roleSel = (u) => `<select data-role="${u.id}" aria-label="Rol de ${esc(u.name)}">${['admin', 'planificador', 'lector'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${{ admin: 'Administrador', planificador: 'Planificador', lector: 'Lector' }[r]}</option>`).join('')}</select>`;
  main.innerHTML = `<h1>Usuarios</h1><p class="lead">Administrador: carga datos y gestiona usuarios. Planificador: añade notas y acciones. Lector: solo consulta.</p>
    <div id="pwMsg" aria-live="polite"></div>
    <div class="tw"><table><thead><tr><th scope="col">Nombre</th><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Activo</th><th scope="col"><span class="sr">Contraseña</span></th></tr></thead><tbody>
    ${us.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${roleSel(u)}</td><td><input type="checkbox" data-active="${u.id}" ${u.active ? 'checked' : ''} aria-label="${esc(u.name)} activo"></td><td><button class="btn ghost sm" data-reset="${u.id}">Nueva contraseña</button></td></tr>`).join('')}
    </tbody></table></div>
    <h2>Nuevo usuario</h2>
    <form class="form" id="nuF"><div class="row"><label>Nombre<input name="name" required></label><label>Usuario<input name="username" required autocomplete="off"></label>
      <label>Rol<select name="role"><option value="planificador">Planificador</option><option value="lector">Lector</option><option value="admin">Administrador</option></select></label><button class="btn">Crear</button></div></form>`;
  const showPw = (who, pw) => { $('#pwMsg').innerHTML = `<div class="notice">Contraseña temporal de <b>${esc(who)}</b>: <code>${esc(pw)}</code>. Se le pedirá cambiarla al entrar. Cópiala ahora: no se volverá a mostrar.</div>`; };
  const patch = async (id, body) => { try { const r = await api('/api/users/' + id, { method: 'PATCH', body }); return r; } catch (e) { toast(e.message); pageUsers(main); } };
  $$('[data-role]', main).forEach(s => s.onchange = async () => { if (await patch(s.dataset.role, { role: s.value })) toast('Rol actualizado'); });
  $$('[data-active]', main).forEach(c => c.onchange = async () => { if (await patch(c.dataset.active, { active: c.checked })) toast(c.checked ? 'Usuario activado' : 'Usuario desactivado'); });
  $$('[data-reset]', main).forEach(b => b.onclick = async () => { const r = await patch(b.dataset.reset, { reset: true }); if (r && r.password) showPw(b.closest('tr').cells[0].textContent, r.password); });
  $('#nuF').onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); try { const r = await api('/api/users', { method: 'POST', body: Object.fromEntries(fd) }); await pageUsers(main); showPw(fd.get('name'), r.password); } catch (e) { toast(e.message); } };
}

// ---------------------------------------------------------------- Cuenta, login y otros
async function pageAccount(main) {
  main.innerHTML = `<h1>Mi cuenta</h1><p class="lead">${esc(S.me.name)} · usuario ${esc(S.me.username)} · ${{ admin: 'Administrador', planificador: 'Planificador', lector: 'Lector' }[S.me.role]}</p>
    ${S.me.must_change ? '<div class="notice">Estás usando una contraseña temporal. Cámbiala para continuar.</div>' : ''}
    <section class="card" style="max-width:520px"><h2>Cambiar contraseña</h2>
    <form class="form" id="pwF"><label>Contraseña actual<input type="password" name="current" required autocomplete="current-password"></label>
      <label>Nueva contraseña (mínimo 8 caracteres)<input type="password" name="new" required minlength="8" autocomplete="new-password"></label>
      <label>Repite la nueva contraseña<input type="password" name="new2" required minlength="8" autocomplete="new-password"></label>
      <div><button class="btn">Cambiar contraseña</button></div><p class="msg" id="pwM" aria-live="polite"></p></form></section>`;
  $('#pwF').onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.target);
    if (fd.get('new') !== fd.get('new2')) { $('#pwM').className = 'msg err'; $('#pwM').textContent = 'Las dos contraseñas nuevas no coinciden.'; return; }
    try { await api('/api/me/password', { method: 'POST', body: { current: fd.get('current'), new: fd.get('new') } }); const was = S.me.must_change; S.me.must_change = false; toast('Contraseña cambiada'); if (was) { await loadData(); updateChrome(); go('#/'); } else { ev.target.reset(); $('#pwM').className = 'msg ok'; $('#pwM').textContent = 'Contraseña cambiada.'; } }
    catch (e) { $('#pwM').className = 'msg err'; $('#pwM').textContent = e.message; }
  };
}
const SOON = {
  'consolidador': ['Consolidador de previsiones', 'Validación de la previsión de controlling contra el maestro (extinguir, sucesores, inactivos, lanzamientos) y generación del fichero de carga para ABAS y Power BI.'],
};
// ---------------------------------------------------------------- Porfolio
const MOTIVO = { alta: 'Alta nueva', vuelve: 'Vuelve a tener movimiento', inactiva: 'Inactivada en el maestro', no_pt: 'Ya no es producto terminado', sin_mov: 'Se ha quedado sin movimiento', no_maestro: 'Ya no está en el maestro' };
const CATSM = { nada: 'Sin ningún dato', venta_antigua: 'Solo venta de hace más de 13 meses', prev_futura: 'Previsión solo más allá de 12 meses', prev_pasada: 'Solo previsión de meses pasados' };
// Referencia de porfolio: enlaza a la ficha solo si está en seguimiento
const pfRef = (k, n) => `<td class="art" title="${esc(k + ' ' + n)}">${S.byK[k] ? refLink({ k }) : `<b>${esc(k)}</b>`} <span class="nm">${esc(n)}</span></td>`;
const chk = (v) => v == null ? '<span class="muted">—</span>' : v ? '<span class="ok">✓<span class="sr"> sí</span></span>' : '<span class="no">✗<span class="sr"> no</span></span>';
// cols: [nombre, clase, título] o { g, c: [cols…] } para un grupo
const pfTabla = (rows, cols, empty, fit = true) => {
  const th = (c) => thc(c[0], c[1], c[2]), n = cols.reduce((t, c) => t + (c.g ? c.c.length : 1), 0);
  const head = cols.some(c => c.g) ? head2(cols.map(c => c.g ? { g: c.g, c: c.c.map(th) } : th(c))) : `<tr>${cols.map(th).join('')}</tr>`;
  return `<div class="tw"><table${fit ? ' class="fit"' : ''}><thead>${head}</thead><tbody>${rows || `<tr><td colspan="${n}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
};
// Columnas comunes de Porfolio: ABC (solo en seguimiento) y a extinguir con su sucesor si está activo
const pfAbc = (k) => `<td>${S.byK[k] ? abcRef(S.byK[k].r) : '<span class="muted">—</span>'}</td>`;
const pfExt = (x) => `<td class="nowrap">${x.ext ? `Sí${x.sc ? ` · sucesor ${S.byK[x.sc] ? refLink({ k: x.sc }) : `<b>${esc(x.sc)}</b>`}` : ''}` : '<span class="muted">—</span>'}</td>`;
const lanzCompleto = (x) => x.app && x.pv && x.ln && x.mn !== false && x.lt && x.en;

// Bloques: cada uno sabe pintar su tabla y es a la vez sección desplegable y vista de detalle
const PF_BLOQUES = {
  cambios: {
    t: 'Altas y bajas', n: (pf) => pf.cambios ? `entran ${pf.cambios.entran.length} · salen ${pf.cambios.salen.length}` : '—',
    lead: () => S.ds.prev ? `Frente a la carga del ${fdate(S.ds.prev.created)}.` : '',
    html: (pf) => {
      if (!pf.cambios) return '<p class="muted">Se verá a partir de la próxima carga: esta es la primera con la sección Porfolio.</p>';
      const tb = (xs) => pfTabla(xs.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="nowrap">${MOTIVO[x.m] || esc(x.m)}</td>${pfExt(x)}</tr>`).join(''), [['Referencia'], ['ABC'], ['Motivo'], ['A extinguir']], 'Ninguna.');
      return `<h3>Entran (${pf.cambios.entran.length})</h3>${tb(pf.cambios.entran)}<h3>Salen (${pf.cambios.salen.length})</h3>${tb(pf.cambios.salen)}`;
    },
  },
  lanzamientos: {
    t: 'Lanzamientos', n: (pf) => fmt(pf.lanz.length),
    lead: (pf) => `Altas de los últimos ${pf.cfg.lanz} meses.`,
    html: (pf, q) => {
      const pend = q.get('pend') === '1', xs = pf.lanz.filter(x => !pend || !lanzCompleto(x));
      return `<form class="filters" onsubmit="return false"><label class="fld" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-pend ${pend ? 'checked' : ''}> Solo con algo pendiente (${pf.lanz.filter(x => !lanzCompleto(x)).length})</label></form>` +
        pfTabla(xs.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="num">${fdate(x.alta)}</td><td class="nowrap">${esc(x.gp || '—')}</td><td class="c">${chk(x.app)}</td><td class="c">${chk(x.pv)}</td><td class="c">${chk(x.ln)}</td><td class="c">${chk(x.mn)}</td><td class="c">${chk(x.lt)}</td><td class="c">${chk(x.en)}</td>${pfExt(x)}</tr>`).join(''),
          [['Referencia'], ['ABC'], ['Alta'], ['Planificación'], ['En seguimiento', 'c'], ['Previsión', 'c'], ['Línea', 'c'], ['Stock mínimo', 'c'], ['Lote', 'c'], ['OF o propuesta', 'c'], ['A extinguir']], 'Ningún lanzamiento con estos criterios.', false);
    },
  },
  'sin-movimiento': {
    t: 'Sin movimiento', n: (pf) => fmt(pf.fuera.length),
    lead: () => 'Sin stock, previsión, pedidos, entradas ni venta reciente: candidatos a inactivar en ABAS.',
    html: (pf) => pfTabla(pf.fuera.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="num">${fdate(x.alta)}</td><td class="nowrap">${CATSM[x.cat] || esc(x.cat)}${x.uv ? ` <span class="muted">(última ${esc(x.uv)})</span>` : ''}</td>${pfExt(x)}</tr>`).join(''), [['Referencia'], ['ABC'], ['Alta'], ['Qué tiene'], ['A extinguir']], 'Ninguno.'),
  },
  inactivos: {
    t: 'Inactivos con stock', n: (pf) => fmt(pf.inact.length) + (pf.inact.some(x => x.pr > 0) ? ' · ' + keur(pf.inact.reduce((s, x) => s + (x.pr > 0 ? x.st * x.pr : 0), 0)) : ''),
    lead: () => '',
    html: (pf) => pfTabla(pf.inact.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="r num">${fmt(x.st)}</td><td class="r num">${x.pr == null ? '<span class="muted">—</span>' : x.pr > 0 ? eur(x.st * x.pr) : '<span class="muted">sin precio</span>'}</td><td class="num">${fdate(x.fina)}</td>${pfExt(x)}</tr>`).join(''), [['Referencia'], ['ABC'], ['Stock', 'r'], ['Valor', 'r'], ['Inactivo desde'], ['A extinguir']], 'Ninguno.'),
  },
  activos: {
    t: 'PT activos', n: (pf) => fmt(pf.res.activos), soloVista: true,
    lead: () => '',
    html: (pf, q) => {
      const ver = q.get('ver') || '';
      const rows = [...S.ds.refs.map(r => ({ k: r.k, n: r.n, alta: r.al || '', gp: r.gp, seg: true, m: '', ext: r.ext, sc: r.sc })), ...pf.fuera.map(x => ({ k: x.k, n: x.n, alta: x.alta, gp: x.gp || '', seg: false, m: CATSM[x.cat] || x.cat, ext: x.ext, sc: x.sc }))]
        .filter(x => !ver || (ver === 'seg') === x.seg).sort((a, b) => a.k < b.k ? -1 : 1);
      const op = (v, t) => `<option value="${v}" ${ver === v ? 'selected' : ''}>${t}</option>`;
      return `<form class="filters" onsubmit="return false"><label class="fld">Mostrar<select data-ver>${op('', 'Todos')}${op('seg', 'En seguimiento')}${op('fuera', 'Sin movimiento')}</select></label></form><p class="muted small">${fmt(rows.length)} referencias</p>` +
        pfTabla(rows.map(x => `<tr>${pfRef(x.k, x.n)}${pfAbc(x.k)}<td class="num">${x.alta ? fdate(x.alta) : '<span class="muted">—</span>'}</td><td class="nowrap">${esc(x.gp || '—')}</td><td class="c">${chk(x.seg)}</td><td class="nowrap">${x.seg ? '' : esc(x.m)}</td>${pfExt(x)}</tr>`).join(''),
          [['Referencia'], ['ABC'], ['Alta'], ['Planificación'], ['En seguimiento', 'c'], ['Motivo si no está'], ['A extinguir']], 'Ninguna.');
    },
  },
  extinguir: {
    t: 'A extinguir', n: (pf) => fmt(S.ev.filter(x => x.r.ext).length + pf.fuera.filter(x => x.ext).length) + (S.ev.some(x => x.r.ext && x.r.pr > 0 && x.r.st > 0) ? ' · ' + keur(S.ev.reduce((s, { r }) => s + (r.ext && r.pr > 0 ? Math.max(r.st, 0) * r.pr : 0), 0)) : ''),
    lead: () => 'PT activos marcados a extinguir en ABAS: se consume el stock y no se repone. El valor es el del stock que queda por consumir.',
    html: (pf) => {
      const suc = (sc) => sc ? (S.byK[sc] ? refLink({ k: sc }) : `<b>${esc(sc)}</b>`) : '<span class="muted">—</span>';
      const seg = S.ev.filter(x => x.r.ext).sort((a, b) => (b.r.pr > 0 ? Math.max(b.r.st, 0) * b.r.pr : 0) - (a.r.pr > 0 ? Math.max(a.r.st, 0) * a.r.pr : 0) || (a.r.k < b.r.k ? -1 : 1));
      const fu = pf.fuera.filter(x => x.ext);
      return `<h3>En seguimiento (${seg.length})</h3>` +
        pfTabla(seg.map(({ r, e }) => `<tr>${refCell(r)}<td>${abcRef(r)}</td><td>${pillShort(e)}</td><td class="r num">${fmt(r.st)}</td><td class="r num">${r.pr > 0 ? eur(Math.max(r.st, 0) * r.pr) : '<span class="muted">sin precio</span>'}</td><td class="r num">${fmt(e.d3)}</td>${cobCell(e)}<td class="nowrap">${suc(r.sc)}</td></tr>`).join(''),
          [['Referencia'], ['ABC'], ['Estado'], ['Stock', 'r'], ['Valor', 'r'], ['Demanda/mes', 'r', 'Demanda media de los 3 próximos meses'], { g: 'Cobertura', c: [['Meses', 'r', 'Meses que dura el stock de hoy con la demanda prevista'], ['Prudente', 'r', 'Cobertura en meses con la previsión corregida y aumentada en su error']] }, ['Sucesor']], 'Ninguna.') +
        `<h3>Sin movimiento (${fu.length})</h3>` +
        pfTabla(fu.map(x => `<tr>${pfRef(x.k, x.n)}<td class="num">${fdate(x.alta)}</td><td class="nowrap">${CATSM[x.cat] || esc(x.cat)}${x.uv ? ` <span class="muted">(última ${esc(x.uv)})</span>` : ''}</td><td class="nowrap">${suc(x.sc)}</td></tr>`).join(''), [['Referencia'], ['Alta'], ['Qué tiene'], ['Sucesor']], 'Ninguna.');
    },
  },
  abc: {
    t: 'Vista ABC', n: () => fmt(S.ev.filter(x => x.r.abc !== 'NA').length), soloVista: true,
    lead: () => 'Referencias en seguimiento, sobre la venta de 12 meses.',
    html: (pf, q) => `<div class="abcs">${['Belloch', 'Yunsey'].map(md => {
      const xs = S.ev.filter(x => x.r.md === md), con = xs.filter(x => x.r.abc !== 'NA');
      const tot = con.reduce((s, x) => s + (x.r.abcm || 0), 0) || 1, sel = ABC_CL.includes(q.get('c' + md)) ? q.get('c' + md) : 'A';
      const cl = (c) => con.filter(x => x.r.abc === c), pct = (c) => (cl(c).reduce((s, x) => s + (x.r.abcm || 0), 0) / tot * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 });
      const filas = cl(sel).sort((a, b) => (b.r.abcm || 0) - (a.r.abcm || 0) || (a.r.k < b.r.k ? -1 : 1))
        .map(({ r, e }) => `<tr>${refCell(r)}<td class="r num">${fmt(r.abcm)}${r.abcp ? '*' : ''}</td><td class="r num">${fmt(e.d3)}</td>${mesCell(r, e)}<td>${pillShort(e)}</td><td class="r num">${fmt(r.st)}</td>${cobCell(e)}</tr>`).join('');
      const na = xs.length - con.length;
      return `<section class="card abcv" aria-label="${md}"><h2>${md} <span class="muted">· ${fmt(con.length)} referencias con ABC${na ? ` · ${fmt(na)} bajo pedido (NA)` : ''}</span></h2>
        <div class="abcc">${ABC_CL.map(c => `<button type="button" class="abc-${c}" data-abcsel="${md}" data-c="${c}" aria-pressed="${c === sel}"><b>${c}</b><span>${fmt(cl(c).length)} refs</span><span>${pct(c)} % venta</span></button>`).join('')}</div>
        <h3>Clase ${sel} <span class="muted small">(${esc(abcTxt(sel))})</span></h3>
        ${pfTabla(filas, [['Referencia'], ['Venta 12 m', 'r'], { g: 'Demanda', c: [['Media/mes', 'r', 'Demanda media de los 3 próximos meses'], ['Resto/mes', 'r', 'Demanda que queda del mes en curso']] }, ['Estado'], ['Stock', 'r'], { g: 'Cobertura', c: [['Meses', 'r', 'Meses que dura el stock de hoy con la demanda prevista'], ['Prudente', 'r', 'Cobertura en meses con la previsión corregida y aumentada en su error']] }], 'Ninguna referencia en esta clase.')}</section>`;
    }).join('')}</div><p class="muted small">* ABC provisional (menos de 12 meses de venta).</p>`,
  },
};
const PF_ORDEN = ['cambios', 'lanzamientos', 'sin-movimiento', 'inactivos', 'extinguir'];
function pfAbiertos() { try { return JSON.parse(localStorage.getItem('pfOpen')) || { cambios: true }; } catch (e) { return { cambios: true }; } }

async function pagePortfolio(main, [sub]) {
  if (!S.ds) return noData(main, 'Porfolio');
  const pf = S.ds.porfolio;
  if (!pf) { main.innerHTML = '<h1>Porfolio</h1><p class="lead">Esta carga es anterior a la sección Porfolio. Vuelve a cargar el MM_Supply desde Datos para verla.</p>'; return; }
  const { q } = parseHash(), rerender = () => pagePortfolio(main, [sub]);
  const bindFiltros = () => {
    $$('[data-pend]', main).forEach(c => c.onchange = () => { setQuery({ pend: c.checked ? '1' : '' }); rerender(); });
    $$('[data-ver]', main).forEach(s => s.onchange = () => { setQuery({ ver: s.value }); rerender(); });
    $$('[data-abcsel]', main).forEach(b => b.onclick = () => { const { abcsel: md, c } = b.dataset; setQuery({ ['c' + md]: c }); rerender().then(() => { const n = $(`[data-abcsel="${md}"][data-c="${c}"]`, main); if (n) n.focus(); }); });
  };
  const B = PF_BLOQUES[sub];
  if (sub && !B) return pageNotFound(main);
  if (B) {  // vista de detalle de un caso
    main.innerHTML = `<p class="crumbs"><a href="#/porfolio">Porfolio</a> › ${B.t}</p><h1>${B.t} <span class="muted">(${B.n(pf)})</span></h1>${B.lead(pf) ? `<p class="lead">${B.lead(pf)}</p>` : ''}${B.html(pf, q)}`;
    return bindFiltros();
  }
  const card = (href, v, l) => `<a class="kpi kpi-link" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  const ab = pfAbiertos();
  main.innerHTML = `<h1>Porfolio</h1>
    <div class="kpis">${card('#/porfolio/activos', fmt(pf.res.activos), 'PT activos')}${card('#/coberturas?gp=', fmt(pf.res.seguimiento), 'En seguimiento')}
      ${card('#/porfolio/cambios', pf.cambios ? `${pf.cambios.entran.length} · ${pf.cambios.salen.length}` : '—', 'Entran · salen')}${card('#/porfolio/lanzamientos', fmt(pf.lanz.length), 'Lanzamientos')}
      ${card('#/porfolio/sin-movimiento', fmt(pf.fuera.length), 'Sin movimiento')}${card('#/porfolio/inactivos', fmt(pf.inact.length), 'Inactivos con stock')}${card('#/porfolio/extinguir', fmt(S.ev.filter(x => x.r.ext).length + pf.fuera.filter(x => x.ext).length), 'A extinguir')}${card('#/porfolio/abc', fmt(S.ev.filter(x => x.r.abc !== 'NA').length), 'Vista ABC')}</div>
    ${PF_ORDEN.map(k => { const b = PF_BLOQUES[k]; return `<details class="blk" data-blk="${k}" ${ab[k] ? 'open' : ''}><summary><h2>${b.t} <span class="muted">(${b.n(pf)})</span></h2><a class="small" href="#/porfolio/${k}">ver en detalle</a></summary>${b.lead(pf) ? `<p class="muted small">${b.lead(pf)}</p>` : ''}${b.html(pf, q)}</details>`; }).join('')}`;
  $$('details.blk', main).forEach(d => d.addEventListener('toggle', () => { const o = pfAbiertos(); o[d.dataset.blk] = d.open; try { localStorage.setItem('pfOpen', JSON.stringify(o)); } catch (e) {} }));
  bindFiltros();
}
async function pageSoon(main, [k]) { const s = SOON[k] || ['Próximamente', '']; main.innerHTML = `<h1>${s[0]}</h1><p class="lead">${s[1]}</p><p class="muted">Este módulo está en preparación.</p>`; }
async function pageNotFound(main) { main.innerHTML = '<h1>Página no encontrada</h1><p class="lead">La dirección no corresponde a ninguna sección. Vuelve al <a href="#/">inicio</a>.</p>'; }

function pageLogin() {
  $('#app').removeAttribute('aria-busy');
  $('#app').innerHTML = `<main class="login" id="main"><section class="card"><img class="login-logo" src="/static/img/lab_belloch.png" alt="Belloch International Group" height="34"><h1 tabindex="-1" class="login-t">${LOGO}Atalaya</h1><p class="muted">Supply · bellochapplab · entra con tu usuario</p>
    <form class="form" id="lf"><label>Usuario<input name="username" required autocomplete="username" autofocus></label>
    <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
    <div><button class="btn">Entrar</button></div><p class="msg err" id="lm" aria-live="assertive"></p></form></section></main>`;
  document.title = 'Entrar · Atalaya';
  $('#lf').onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.target); $('#lm').textContent = '';
    try { await api('/api/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } }); await boot(); location.hash = '#/'; }
    catch (e) { $('#lm').textContent = e.message; }
  };
}

async function boot() {
  const me = await api('/api/me'); S.me = me; S.cfg = me.config || S.cfg;
  if (me.must_change) return;  // el servidor no da datos hasta cambiar la contraseña temporal
  $('#app').innerHTML = '<p class="boot">Cargando datos…</p>';
  await loadData();
}
(async () => {
  const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t;
  try { await boot(); } catch (e) { S.me = null; }
  render();
})();
})();
