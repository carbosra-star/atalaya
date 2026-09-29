/* Planificación Supply · bellochapplab — aplicación de página única */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Enteros con punto de miles siempre (toLocaleString no agrupa 4 cifras: 5341 → 5.341)
const fmt = (n) => (n == null || isNaN(n)) ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// Fechas siempre en números: 29/09/2026, 29/09 (corta), 29/09/2026 10:25 (con hora), 09/26 (mes)
const pad = (n) => String(n).padStart(2, '0');
const toDate = (iso) => new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
const fdate = (iso, short) => { if (!iso) return ''; const d = toDate(iso); if (isNaN(d)) return esc(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (short ? '' : '/' + d.getFullYear()); };
const fdt = (iso) => { if (!iso) return ''; const d = toDate(iso); if (isNaN(d)) return esc(iso); return fdate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const refHref = (k) => '#/ref/' + encodeURIComponent(k);
const SEM = [['rojo', 'Rotura'], ['naranja', 'Bajo mínimo'], ['amarillo', 'Pendiente de propuestas'], ['verde', 'Cubierto'], ['gris', 'Sin demanda']];
const SEMT = Object.fromEntries(SEM);
const SEMORD = { rojo: 0, naranja: 1, amarillo: 2, verde: 3, gris: 4 };
const ESC = { OF: 'Solo OF', OFPF: 'OF y propuestas fijadas', ALL: 'OF y todas las propuestas' };
const ESC_TXT = { OF: 'solo OF', OFPF: 'OF y propuestas fijadas', ALL: 'OF y todas las propuestas' };  // para mitad de frase
const escLower = () => ESC_TXT[S.esc] + (S.pv === 'C' ? ' y previsión corregida' : '');
const PV = { T: 'Tal cual', C: 'Corregida' };
const pvKey = () => S.esc + (S.pv === 'C' ? '_C' : '');  // clave de la carga anterior evaluada
const cobTxt = (v) => v == null || v >= 99 ? '—' : Math.max(0, v).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' m';  // stock negativo: 0 m
const ENT = { OF: 'OF', PF: 'Propuesta fijada', P: 'Propuesta' };

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
  const d = S.ds.meta.dias, s = pvSel(r), p0 = s.p[0];
  if (!d) return `Mes en curso: previsión restante tras descontar ${fmt(r.v0)} unidades ya vendidas.`;
  return `Mes en curso: quedan ${fmt(s.p0)} de la previsión${s.c ? ' corregida' : ''} (${fmt(p0)}), la menor entre lo que falta tras vender ${fmt(r.v0)} (${fmt(Math.max(0, p0 - r.v0))}) y lo que corresponde a ${d[0]} de ${d[1]} días naturales (${fmt(p0 * d[0] / d[1])}).`;
}
// Acierto de la previsión de los 12 últimos meses cerrados frente a la venta real
function aciertoHTML(r) {
  if (!r.hp) return '<p class="muted">Esta carga no trae el histórico de previsión. Vuelve a cargar el MM_Supply para verlo.</p>';
  const pct = (x) => Math.round(x * 100) + ' %', sv = r.vt.reduce((s, x) => s + x, 0), sp = r.hp.reduce((s, x) => s + x, 0);
  const grupo = `de su grupo ${esc(r.md)} · ${esc(r.abc)}`;
  const orig = r.fo === 'ref' ? 'propio' : r.fo === 'grupo' ? grupo : 'sin datos, no se corrige';
  const txt = (r.hm >= 6 && sp > 0 ? `En 12 meses se vendió el ${pct(sv / sp)} de lo previsto. ` : r.hm ? `Solo ${r.hm} de 12 meses con previsión: no basta para un factor propio. ` : 'Sin previsión vigente en los 12 últimos meses. ') +
    `Error medio mes a mes: ${r.er == null ? 'sin dato' : pct(r.er) + (r.eo === 'grupo' ? ' (' + grupo + ')' : '')}. Factor de corrección: ${String(r.fc).replace('.', ',')} (${orig}).`;
  const src = S.ds.meta.hist_src || [];
  return `<p>${txt}</p><div class="tw"><table class="mt"><caption class="sr">Previsión vigente y venta de los 12 últimos meses</caption><thead><tr><th scope="col">Unidades</th>${r.hp.map((_, i) => `<th scope="col" class="r">${monthLabel(i - 12)}</th>`).join('')}</tr></thead><tbody>
    <tr><th scope="row">Previsión vigente</th>${r.hp.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Venta</th>${r.vt.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
    <tr><th scope="row">Desviación</th>${r.hp.map((p, i) => `<td class="r num ${p > 0 && Math.abs(r.vt[i] - p) / p > 0.3 ? 'neg' : ''}">${p > 0 ? pct((r.vt[i] - p) / p) : ''}</td>`).join('')}</tr>
    <tr><th scope="row">Versión</th>${src.map(v => `<td class="r small muted">${esc(v)}</td>`).join('')}</tr></tbody></table></div>`;
}
function recompute() {
  const cfg = { horizonte: S.cfg.horizonte || 3, escenario: S.esc, prevision: S.pv };
  S.ev = S.ds ? S.ds.refs.map(r => ({ r, e: Cob.evaluate(r, cfg) })) : [];
  S.byK = {}; for (const x of S.ev) S.byK[x.r.k] = x;
}
async function loadData() {
  const [ds, notes, acts] = await Promise.all([api('/api/dataset'), api('/api/notes-index'), api('/api/actions?status=abierta')]);
  S.ds = ds.empty ? null : ds; S.notes = notes || {}; S.actions = acts || [];
  recompute();
}
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
  '': pageHome, coberturas: pageList, ref: pageRef, lineas: pageLines, linea: pageLine, reunion: pageMeeting,
  datos: pageData, usuarios: pageUsers, cuenta: pageAccount, pronto: pageSoon,
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
  const h1 = $('h1', main); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); document.title = h1.textContent + ' · Planificación Supply'; }
  window.scrollTo(0, 0); $('#side') && $('#side').classList.remove('open');
}

// ---------------------------------------------------------------- estructura
const ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="rgba(255,255,255,.1)"/><rect x="6" y="18" width="5" height="8" fill="#5DB07C"/><rect x="13.5" y="12" width="5" height="14" fill="#D9B73A"/><rect x="21" y="6" width="5" height="20" fill="#E0574A"/></svg>';
let globalBound = false;
function shell() {
  if ($('#main') && $('#side')) { updateChrome(); return; }
  const soon = [['stock-minimo', 'Stock mínimo y lotes'], ['desviacion', 'Desviación de previsiones'], ['consolidador', 'Consolidador de previsiones']];
  $('#app').innerHTML = `<div class="shell">
    <nav class="side" id="side" aria-label="Menú principal">
      <a class="brand" href="#/">${LOGO}<span><b>Planificación Supply</b><span>bellochapplab</span></span></a>
      <div class="nav-g" id="g1">Seguimiento</div>
      <div class="nav" role="list" aria-labelledby="g1">
        <a role="listitem" href="#/" data-nav="">Inicio</a>
        <a role="listitem" href="#/coberturas" data-nav="coberturas">Coberturas <span class="badge r" id="bRojo" hidden></span></a>
        <a role="listitem" href="#/lineas" data-nav="lineas">Líneas</a>
        <a role="listitem" href="#/reunion" data-nav="reunion">Reunión semanal <span class="badge" id="bAct" hidden></span></a>
      </div>
      <div class="nav-g" id="g2">Parámetros y previsión</div>
      <div class="nav" role="list" aria-labelledby="g2">${soon.map(([k, t]) => `<a role="listitem" class="soon" href="#/pronto/${k}" data-nav="pronto/${k}">${t} <span class="badge">pronto</span></a>`).join('')}</div>
      ${can('admin') ? `<div class="nav-g" id="g3">Administración</div><div class="nav" role="list" aria-labelledby="g3">
        <a role="listitem" href="#/datos" data-nav="datos">Datos</a><a role="listitem" href="#/usuarios" data-nav="usuarios">Usuarios</a></div>` : ''}
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
  const ba = $('#bAct'); ba.hidden = !S.actions.length; ba.textContent = S.actions.length; ba.setAttribute('aria-label', S.actions.length + ' acciones abiertas');
}
function markNav(key) {
  const { parts } = parseHash(); const k = parts[0] === 'ref' ? 'coberturas' : parts[0] === 'linea' ? 'lineas' : parts[0] === 'pronto' ? 'pronto/' + parts[1] : key;
  $$('.nav a').forEach(a => a.dataset.nav === k ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}

// Búsqueda global (combobox accesible)
function setupSearch() {
  const inp = $('#gs'), ul = $('#gsList'); let items = [], act = -1;
  const draw = () => {
    ul.innerHTML = items.map((x, i) => `<li role="option" id="gso${i}" aria-selected="${i === act}" data-k="${esc(x.r.k)}"><span class="pill s-${x.e.sem}"><span class="sr">${SEMT[x.e.sem]}</span></span><span><b>${esc(x.r.k)}</b> ${esc(x.r.n)}</span></li>`).join('') || '<li role="option" aria-disabled="true">Sin resultados</li>';
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
const refLink = (r) => `<a href="${refHref(r.k)}">${esc(r.k)}</a>`;
function nextEntry(e) { const n = e.next; return n ? `${ENT[n.t]} ${fmt(n.q)} · ${fdate(n.d, true)}` : '<span class="muted">Sin entradas</span>'; }
function rotCell(e) { return e.rot < 0 ? '<span class="muted">No en 12 meses</span>' : `<span class="${e.rot < (S.cfg.horizonte || 3) ? 'neg' : ''}">${monthLabel(e.rot)}</span>`; }
function strip(list, hrefFor, current) {
  const c = {}; list.forEach(x => c[x.e.sem] = (c[x.e.sem] || 0) + 1);
  return `<section class="strip" aria-label="Referencias por estado">
    <div class="bar2">${SEM.filter(([k]) => c[k]).map(([k, t]) => `<a class="s-${k}" style="flex:${c[k]}" href="${hrefFor(k)}" aria-label="${t}: ${c[k]} referencias" title="${t}: ${c[k]}"></a>`).join('')}</div>
    <div class="legend">${SEM.map(([k, t]) => `<a class="s-${k}" href="${hrefFor(k)}" ${current === k ? 'aria-current="true"' : ''}><span class="d"></span><span class="n">${c[k] || 0}</span><span class="t">${t}</span></a>`).join('')}</div></section>`;
}
function scenarioCtl() {
  return `<div class="fld"><span id="escL">Entradas que se cuentan</span><div class="seg" role="group" aria-labelledby="escL">${Object.entries(ESC).map(([k, t]) => `<button type="button" data-esc="${k}" aria-pressed="${S.esc === k}">${k === 'OF' ? 'Solo OF' : k === 'OFPF' ? '+ fijadas' : '+ todas las propuestas'}<span class="sr"> (${t})</span></button>`).join('')}</div></div>
    <div class="fld"><span id="pvL">Previsión</span><div class="seg" role="group" aria-labelledby="pvL">${Object.entries(PV).map(([k, t]) => `<button type="button" data-pv="${k}" aria-pressed="${S.pv === k}">${t}</button>`).join('')}</div></div>`;
}
function bindScenario(root, rerender) {
  $$('[data-esc]', root).forEach(b => b.onclick = () => { S.esc = b.dataset.esc; localStorage.setItem('esc', S.esc); recompute(); updateChrome(); rerender(); announce('Escenario: ' + ESC[S.esc]); });
  $$('[data-pv]', root).forEach(b => b.onclick = () => { S.pv = b.dataset.pv; try { localStorage.setItem('prev', S.pv); } catch (e) {} recompute(); updateChrome(); rerender(); announce('Previsión: ' + PV[S.pv]); });
}
function noData(main, title) {
  main.innerHTML = `<h1>${title}</h1><p class="lead">Todavía no hay datos cargados.${can('admin') ? ' Sube el MM_Supply desde <a href="#/datos">Datos</a>.' : ' Cuando se cargue el MM_Supply aparecerán aquí las coberturas.'}</p>`;
}
function sortTable(rows, key, dir, getters) { const g = getters[key]; return rows.slice().sort((a, b) => { const va = g(a), vb = g(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; }); }
function thSort(label, key, cur, dir, cls = '') {
  const s = cur === key ? (dir > 0 ? 'ascending' : 'descending') : null;
  return `<th scope="col" class="${cls}" ${s ? `aria-sort="${s}"` : ''}><button class="sort" data-sort="${key}">${label}${s ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
}

// ---------------------------------------------------------------- Inicio
async function pageHome(main) {
  if (!S.ds) return noData(main, 'Inicio');
  const cs = S.ev.filter(x => x.r.gp === 'Contra Stock');
  const prev = S.ds.prev ? (S.ds.prev.sem[pvKey()] || S.ds.prev.sem[S.esc]) : null;
  const into = prev ? cs.filter(x => x.e.sem === 'rojo' && prev[x.r.k] && prev[x.r.k] !== 'rojo') : [];
  const out = prev ? cs.filter(x => prev[x.r.k] === 'rojo' && x.e.sem !== 'rojo') : [];
  const urg = cs.filter(x => x.e.sem === 'rojo').sort((a, b) => a.e.rot - b.e.rot || b.e.d3 - a.e.d3).slice(0, 10);
  const today = todayISO();
  const late = S.actions.filter(a => a.due && a.due < today);
  const wo = cs.filter(x => (x.e.sem === 'rojo' || x.e.sem === 'naranja') && !openActs(x.r.k).length).length;
  const li = (x) => `<li>${refLink(x.r)} ${esc(x.r.n)}</li>`;
  main.innerHTML = `<h1>Semana del ${fdate(S.ds.meta.hoy)}</h1>
    <p class="lead">Productos terminados contra stock, con ${escLower()}. Datos cargados el ${fdt(S.ds.load.created)}${S.ds.load.by ? ' por ' + esc(S.ds.load.by) : ''}.</p>
    ${strip(cs, k => '#/coberturas?sem=' + k)}
    <div class="grid">
      <section class="card"><h2>Entran en rotura</h2>${prev ? `<p class="big">${into.length}</p><p class="muted small">Referencias que no estaban en rotura en la carga anterior (${fdt(S.ds.prev.created)}).</p>${into.length ? `<ul>${into.slice(0, 6).map(li).join('')}</ul>` : ''}` : '<p class="muted">Se verá a partir de la segunda carga.</p>'}</section>
      <section class="card"><h2>Salen de rotura</h2>${prev ? `<p class="big">${out.length}</p><p class="muted small">Estaban en rotura en la carga anterior y ya no.</p>${out.length ? `<ul>${out.slice(0, 6).map(li).join('')}</ul>` : ''}` : '<p class="muted">Se verá a partir de la segunda carga.</p>'}</section>
      <section class="card"><h2>Acciones abiertas</h2><p class="big">${S.actions.length}</p><p class="muted small">${late.length ? `<span class="neg">${late.length} con fecha vencida</span> · ` : ''}${wo} referencias en rotura o bajo mínimo sin acción asignada.</p><p><a class="btn ghost sm" href="#/reunion">Ir a la reunión semanal</a></p></section>
    </div>
    <h2>Las 10 más urgentes</h2>
    <div class="tw"><table><thead><tr><th scope="col">Estado</th><th scope="col">Referencia</th><th scope="col">Línea</th><th scope="col" class="r">Stock</th><th scope="col" class="r">Demanda/mes</th><th scope="col">Rotura</th><th scope="col">Próxima entrada</th><th scope="col">Acción</th></tr></thead><tbody>
    ${urg.map(({ r, e }) => `<tr><td>${pill(e.sem, e.why)}</td><td class="art">${refLink(r)}<small>${esc(r.n)}</small></td><td>${esc(r.ln || '—')}</td><td class="r num">${fmt(r.st)}</td><td class="r num">${fmt(e.d3)}</td><td>${rotCell(e)}</td><td>${nextEntry(e)}</td><td>${openActs(r.k).length ? esc(openActs(r.k)[0].text) : '<span class="muted">Sin acción</span>'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No hay referencias en rotura.</td></tr>'}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- Coberturas
const LIST_GET = {
  sem: x => SEMORD[x.e.sem] * 1e9 - x.e.d3, k: x => x.r.k, ln: x => x.r.ln || 'zzz', abc: x => x.r.abc, st: x => x.r.st, mn: x => x.r.mn,
  d3: x => x.e.d3, cob: x => x.e.cob, cobp: x => x.e.cobp == null ? 999 : x.e.cobp, rot: x => x.e.rot < 0 ? 99 : x.e.rot, next: x => x.e.next ? x.e.next.d : 'z',
};
function listFilter(q) {
  const t = (q.get('q') || '').toLowerCase(), md = q.get('md') || '', ln = q.get('ln') || '', mc = q.get('mc') || '', abc = q.get('abc') || '', gp = q.has('gp') ? q.get('gp') : 'Contra Stock';
  const toks = t.split(/\s+/).filter(Boolean);
  return (ignoreSem) => S.ev.filter(({ r, e }) => (!md || r.md === md) && (!ln || (r.ln || '—') === ln) && (!mc || r.mc === mc) && (!abc || r.abc === abc) && (!gp || r.gp === gp) &&
    (ignoreSem || !q.get('sem') || e.sem === q.get('sem')) && (!toks.length || toks.every(w => (r.k + ' ' + r.n).toLowerCase().includes(w))));
}
async function pageList(main) {
  if (!S.ds) return noData(main, 'Coberturas');
  const opts = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const lines = [...new Set(S.ds.refs.map(r => r.ln || '—'))].sort(), brands = [...new Set(S.ds.refs.map(r => r.mc).filter(Boolean))].sort();
  let limit = 200;
  const draw = () => {
    const { q } = parseHash(); const f = listFilter(q);
    const key = q.get('sort') || 'sem', dir = parseInt(q.get('dir') || '1', 10);
    const rows = sortTable(f(false), key, dir, LIST_GET);
    const qsNoSem = new URLSearchParams(q); qsNoSem.delete('sem');
    $('#stripBox').innerHTML = strip(f(true), k => { const p = new URLSearchParams(qsNoSem); if (q.get('sem') !== k) p.set('sem', k); return '#/coberturas' + (p.toString() ? '?' + p : ''); }, q.get('sem'));
    $('#count').textContent = fmt(rows.length) + ' referencias';
    const tb = $('#tbl tbody');
    tb.innerHTML = rows.slice(0, limit).map(({ r, e }) => `<tr>
      <td>${pill(e.sem, e.why)}</td>
      <td class="art">${refLink(r)}${S.notes[r.k] ? `<span class="note-dot">${S.notes[r.k]} nota${S.notes[r.k] > 1 ? 's' : ''}</span>` : ''}${openActs(r.k).length ? '<span class="note-dot">acción abierta</span>' : ''}<small>${esc(r.n)}</small></td>
      <td>${r.ln ? `<a href="#/linea/${encodeURIComponent(r.ln)}">${esc(r.ln)}</a>` : '—'}</td><td><span class="abc">${esc(r.abc)}</span></td>
      <td class="r num">${fmt(r.st)}</td><td class="r num">${r.mn ? fmt(r.mn) : '–'}</td><td class="r num">${fmt(e.d3)}</td>
      <td class="r num">${cobTxt(e.cob)}</td><td class="r num">${cobTxt(e.cobp)}</td>
      <td>${rotCell(e)}</td><td>${nextEntry(e)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">Ninguna referencia cumple estos filtros.</td></tr>';
    $('#more').hidden = rows.length <= limit; $('#more').textContent = `Mostrar ${Math.min(200, rows.length - limit)} más`;
    $('#thead').innerHTML = `<tr>${thSort('Estado', 'sem', key, dir)}${thSort('Referencia', 'k', key, dir)}${thSort('Línea', 'ln', key, dir)}${thSort('ABC', 'abc', key, dir)}${thSort('Stock', 'st', key, dir, 'r')}${thSort('Mínimo', 'mn', key, dir, 'r')}${thSort('Demanda/mes', 'd3', key, dir, 'r')}${thSort('Cobertura', 'cob', key, dir, 'r')}${thSort('Cob. prudente', 'cobp', key, dir, 'r')}${thSort('Rotura', 'rot', key, dir)}${thSort('Próxima entrada', 'next', key, dir)}</tr>`;
    $$('#thead [data-sort]').forEach(b => b.onclick = () => { const k2 = b.dataset.sort; setQuery({ sort: k2, dir: key === k2 ? -dir : (['st', 'd3', 'mn'].includes(k2) ? -1 : 1) }); draw(); $(`#thead [data-sort="${k2}"]`).focus(); });
    main._rows = rows;
  };
  const { q } = parseHash();
  main.innerHTML = `<h1>Coberturas</h1><p class="lead">Proyección de stock a 12 meses de cada producto terminado. La demanda de cada mes es la mayor entre la previsión y los pedidos pendientes.</p>
    <div id="stripBox"></div>
    <form class="filters" id="flt" role="search" aria-label="Filtros" onsubmit="return false">
      <label class="fld">Buscar<input type="search" name="q" value="${esc(q.get('q') || '')}" placeholder="Código o artículo"></label>
      <label class="fld">Mandante<select name="md">${opts(['Belloch', 'Yunsey'], q.get('md'), 'Todos')}</select></label>
      <label class="fld">Línea<select name="ln">${opts(lines, q.get('ln'), 'Todas')}</select></label>
      <label class="fld">Marca<select name="mc">${opts(brands, q.get('mc'), 'Todas')}</select></label>
      <label class="fld">ABC<select name="abc">${opts(['A', 'B', 'C', 'D', 'NA'], q.get('abc'), 'Todas')}</select></label>
      <label class="fld">Planificación<select name="gp"><option value="Contra Stock" ${!q.has('gp') || q.get('gp') === 'Contra Stock' ? 'selected' : ''}>Contra stock</option><option value="Bajo Pedido" ${q.get('gp') === 'Bajo Pedido' ? 'selected' : ''}>Bajo pedido</option><option value="" ${q.has('gp') && !q.get('gp') ? 'selected' : ''}>Todas</option></select></label>
      ${scenarioCtl()}
    </form>
    <div class="toolbar"><span class="count" id="count" aria-live="polite"></span><button class="btn ghost sm" id="csv">Descargar lista (CSV)</button></div>
    <div class="tw"><table id="tbl"><caption class="sr">Referencias y su cobertura</caption><thead id="thead"></thead><tbody></tbody></table></div>
    <button class="btn ghost more" id="more" hidden></button>`;
  const fl = $('#flt');
  fl.addEventListener('input', (ev) => { const n = ev.target.name; if (!n) return; if (n === 'q') { clearTimeout(fl.t); fl.t = setTimeout(() => { setQuery({ q: ev.target.value.trim() }); limit = 200; draw(); }, 200); } });
  fl.addEventListener('change', (ev) => { const n = ev.target.name; if (!n || n === 'q') return; setQuery({ [n]: n === 'gp' ? (ev.target.value || '') : ev.target.value }); if (n === 'gp' && !ev.target.value) { const { path, q: qq } = parseHash(); qq.set('gp', ''); history.replaceState(null, '', '#' + path + '?' + qq); } limit = 200; draw(); });
  bindScenario(main, () => { $$('[data-esc]', main).forEach(b => b.setAttribute('aria-pressed', b.dataset.esc === S.esc)); $$('[data-pv]', main).forEach(b => b.setAttribute('aria-pressed', b.dataset.pv === S.pv)); draw(); });
  $('#more').onclick = () => { limit += 200; draw(); };
  $('#csv').onclick = () => downloadCSV(main._rows || []);
  draw();
}
function downloadCSV(rows) {
  const head = ['Estado', 'Motivo', 'Referencia', 'Artículo', 'Mandante', 'Marca', 'Línea', 'ABC', 'Stock', 'Stock mínimo', 'Demanda media 3 próximos meses', 'Cobertura meses', 'Cobertura prudente meses', 'Factor sesgo', 'Error previsión %', 'Mes rotura', 'Próxima entrada', 'Cantidad', 'Fecha'];
  const lines = rows.map(({ r, e }) => [SEMT[e.sem], e.why, r.k, r.n, r.md, r.mc, r.ln, r.abc, r.st, r.mn, Math.round(e.d3), e.cob >= 99 ? '' : Math.max(0, e.cob).toFixed(1).replace('.', ','), e.cobp == null || e.cobp >= 99 ? '' : Math.max(0, e.cobp).toFixed(1).replace('.', ','), r.fc == null ? '' : String(r.fc).replace('.', ','), r.er == null ? '' : Math.round(r.er * 100), e.rot < 0 ? '' : monthLabel(e.rot), e.next ? ENT[e.next.t] : '', e.next ? e.next.q : '', e.next ? fdate(e.next.d) : '']);
  const csv = '\ufeff' + [head, ...lines].map(l => l.map(v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `coberturas_${S.ds.meta.hoy}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- Ficha de referencia
function chartSVG(r, e) {
  const W = 760, Hh = 250, pl = 52, pr = 12, pt = 14, pb = 28, n = Cob.H;
  const st = e.all.stk, dm = e.all.dem, en = e.all.ent;
  const vals = [...st, ...dm, ...en, r.mn, r.st, 0], max = Math.max(...vals), min = Math.min(...vals, 0);
  const y = v => pt + (Hh - pt - pb) * (max - v) / ((max - min) || 1), bw = (W - pl - pr) / n, x = i => pl + bw * i + bw / 2;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-labelledby="chT chD"><title id="chT">Proyección de stock de ${esc(r.n)}</title><desc id="chD">Stock a fin de mes durante 12 meses: ${st.map((v, i) => monthLabel(i) + ' ' + fmt(v)).join(', ')}.</desc>`;
  for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--soft)"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="var(--ink2)">${Math.abs(v) >= 1000 ? Math.round(v / 1000) + ' k' : Math.round(v)}</text>`; }
  for (let i = 0; i < n; i++) {
    s += `<rect x="${x(i) - bw * .34}" width="${bw * .3}" y="${y(Math.max(dm[i], 0))}" height="${Math.max(0, y(0) - y(dm[i]))}" fill="var(--gris)" opacity=".5"/>`;
    if (en[i] > 0) s += `<rect x="${x(i) + bw * .04}" width="${bw * .3}" y="${y(en[i])}" height="${Math.max(0, y(0) - y(en[i]))}" fill="var(--link)" opacity=".7"/>`;
    s += `<text x="${x(i)}" y="${Hh - 9}" font-size="11" text-anchor="middle" fill="var(--ink2)">${monthLabel(i)}</text>`;
  }
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink2)"/>`;
  if (r.mn > 0) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(r.mn)}" y2="${y(r.mn)}" stroke="var(--naranja)" stroke-dasharray="6 4"/><text x="${W - pr}" y="${y(r.mn) - 5}" font-size="11" text-anchor="end" fill="var(--naranja)">stock mínimo</text>`;
  s += `<polyline fill="none" stroke="var(--ink)" stroke-width="2.4" points="${st.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>`;
  st.forEach((v, i) => s += `<circle cx="${x(i)}" cy="${y(v)}" r="3.6" fill="${v < 0 ? 'var(--rojo)' : v < r.mn ? 'var(--naranja)' : 'var(--ink)'}"/>`);
  return s + '</svg>';
}
async function pageRef(main, [k]) {
  if (!S.ds) return noData(main, 'Referencia');
  const x = S.byK[k];
  if (!x) { main.innerHTML = `<p class="crumbs"><a href="#/coberturas">Coberturas</a></p><h1>Referencia ${esc(k)}</h1><p class="lead">No está entre los productos terminados activos de la última carga. Puede que esté inactiva, no sea producto terminado o no tenga stock, previsión, pedidos ni entradas.</p>`; return; }
  const draw = async () => {
    const { r, e } = S.byK[k]; const n = Cob.H;
    const [notes, acts] = await Promise.all([api('/api/notes/' + encodeURIComponent(k)), api('/api/actions?ref=' + encodeURIComponent(k))]);
    const canW = can('admin', 'planificador');
    main.innerHTML = `<p class="crumbs"><a href="#/coberturas">Coberturas</a> › ${esc(r.k)}</p>
      <div class="head"><div><h1>${esc(r.n)}</h1>
        <p class="meta">${esc(r.k)} · ${esc(r.md)} · ${esc(r.mc || 'sin marca')} · línea ${r.ln ? `<a href="#/linea/${encodeURIComponent(r.ln)}">${esc(r.ln)}</a>` : '—'} · ABC ${esc(r.abc)} · ${esc(r.gp)}${r.ext ? ' · <b>a extinguir</b>' : ''}${r.sc ? ` · sucesor <a href="${refHref(r.sc)}">${esc(r.sc)}</a>` : ''}</p>
        <p>${pill(e.sem, e.why)}</p></div>
        <form onsubmit="return false">${scenarioCtl()}</form></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmt(r.st)}</div><div class="l">Stock hoy</div></div>
        <div class="kpi"><div class="v">${r.mn ? fmt(r.mn) : '–'}</div><div class="l">Stock mínimo${r.lt ? ` · lote ${fmt(r.lt)}` : ''}</div></div>
        <div class="kpi"><div class="v">${cobTxt(e.cob)}</div><div class="l">Cobertura (3 próximos meses completos)</div></div>
        <div class="kpi"><div class="v">${cobTxt(e.cobp)}</div><div class="l">Cobertura prudente (previsión corregida)</div></div>
        <div class="kpi"><div class="v">${e.rot < 0 ? 'No' : monthLabel(e.rot)}</div><div class="l">Primera rotura</div></div></div>
      <div class="chartbox">${chartSVG(r, e)}<p class="muted small">Línea: stock a fin de mes. Barras grises: demanda. Barras azules: entradas (${ESC_TXT[S.esc]}). Línea discontinua: stock mínimo.</p></div>
      <h2>Mes a mes</h2>
      <div class="tw"><table class="mt"><caption class="sr">Proyección mes a mes</caption><thead><tr><th scope="col">Concepto</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}</tr></thead><tbody>
        <tr><th scope="row">Previsión${pvSel(r).c ? ' corregida' : ''}</th>${pvSel(r).p.map((v, i) => `<td class="r num">${fmt(i === 0 ? pvSel(r).p0 : v)}</td>`).join('')}</tr>
        <tr><th scope="row">Pedidos</th>${r.pd.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
        <tr><th scope="row">Demanda</th>${e.all.dem.map(v => `<td class="r num"><b>${fmt(v)}</b></td>`).join('')}</tr>
        <tr><th scope="row">Entradas</th>${e.all.ent.map(v => `<td class="r num">${v ? fmt(v) : ''}</td>`).join('')}</tr>
        <tr><th scope="row">Stock fin de mes</th>${e.all.stk.map(v => `<td class="r num ${v < 0 ? 'neg' : ''}"><b>${fmt(v)}</b></td>`).join('')}</tr>
      </tbody></table></div>
      <p class="muted small">${prevSrcText()}${restoText(r)}${r.at ? ` Incluye ${fmt(r.at)} unidades de pedidos con fecha pasada sin servir.` : ''}</p>
      <h2>Acierto de la previsión</h2>${aciertoHTML(r)}
      <div class="two">
        <section><h2>Entradas previstas</h2>${r.en.length ? `<ul class="list">${r.en.map(v => `<li><span class="tag">${ENT[v.t]}</span><span class="num">${fdate(v.d)}</span><b class="num">${fmt(v.q)} uds</b>${v.late ? '<span class="neg">fecha pasada</span>' : ''}${v.id ? `<span class="muted small">nº ${esc(v.id)}${v.mq ? ' · ' + esc(v.mq) : ''}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No hay OF ni propuestas en los próximos 12 meses.</p>'}
          ${r.hp ? '' : `<h2>Venta de los últimos 12 meses</h2><div class="tw"><table class="mt" style="min-width:0"><thead><tr>${r.vt.map((_, i) => `<th scope="col" class="r">${monthLabel(i - 12)}</th>`).join('')}</tr></thead><tbody><tr>${r.vt.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr></tbody></table></div>`}</section>
        <section><h2>Acciones</h2>
          ${acts.length ? acts.map(a => `<div class="act ${a.status !== 'abierta' ? 'done' : ''}"><div><div class="t">${esc(a.text)}</div><div class="st muted">${a.owner ? esc(a.owner) + ' · ' : ''}${a.due ? 'para el ' + fdate(a.due) + ' · ' : ''}${esc(a.status)}</div></div>
            ${canW && a.status === 'abierta' ? `<div><button class="btn ghost sm" data-done="${a.id}">Hecha</button></div>` : '<div></div>'}</div>`).join('') : '<p class="muted">Sin acciones.</p>'}
          ${canW ? `<form class="form" id="actF" style="margin-top:10px"><label>Nueva acción<input name="text" required maxlength="2000" placeholder="Qué se va a hacer"></label>
            <div class="row"><label>Responsable<input name="owner" maxlength="120"></label><label>Fecha límite<input type="date" name="due"></label><button class="btn">Añadir acción</button></div></form>` : ''}
          <h2>Notas</h2>
          ${notes.map(nt => `<div class="note"><div>${esc(nt.text)}</div><div class="by">${esc(nt.by)} · ${fdt(nt.created)}</div></div>`).join('') || '<p class="muted">Sin notas.</p>'}
          ${canW ? `<form class="form" id="noteF"><label>Nueva nota<textarea name="text" required maxlength="4000" placeholder="Qué se ha visto o decidido con esta referencia"></textarea></label><div><button class="btn">Guardar nota</button></div></form>` : ''}
        </section></div>`;
    bindScenario(main, draw);
    const af = $('#actF'); if (af) af.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(af); try { await api('/api/actions', { method: 'POST', body: { ref: k, text: fd.get('text'), owner: fd.get('owner'), due: fd.get('due') } }); await refreshActions(); updateChrome(); toast('Acción añadida'); draw(); } catch (e2) { toast(e2.message); } };
    const nf = $('#noteF'); if (nf) nf.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/api/notes/' + encodeURIComponent(k), { method: 'POST', body: { text: new FormData(nf).get('text') } }); S.notes[k] = (S.notes[k] || 0) + 1; toast('Nota guardada'); draw(); } catch (e2) { toast(e2.message); } };
    $$('[data-done]', main).forEach(b => b.onclick = async () => { try { await api('/api/actions/' + b.dataset.done, { method: 'PATCH', body: { status: 'hecha' } }); await refreshActions(); updateChrome(); toast('Acción marcada como hecha'); draw(); } catch (e2) { toast(e2.message); } });
  };
  await draw();
}

// ---------------------------------------------------------------- Líneas
function groupLines(list) { const g = {}; for (const x of list) (g[x.r.ln || '—'] = g[x.r.ln || '—'] || []).push(x); return g; }
async function pageLines(main) {
  if (!S.ds) return noData(main, 'Líneas');
  const cs = S.ev.filter(x => x.r.gp === 'Contra Stock');
  const L = S.ds.meta.lineas || {};
  const rows = Object.entries(groupLines(cs)).map(([k, xs]) => { const c = {}; xs.forEach(x => c[x.e.sem] = (c[x.e.sem] || 0) + 1); return { k, xs, c }; })
    .sort((a, b) => (b.c.rojo || 0) - (a.c.rojo || 0) || (b.c.naranja || 0) - (a.c.naranja || 0) || b.xs.length - a.xs.length);
  main.innerHTML = `<h1>Líneas</h1><p class="lead">Referencias contra stock agrupadas por grupo de máquina, ordenadas por número de roturas.</p>
    <form onsubmit="return false" class="filters">${scenarioCtl()}</form>
    <div class="tw"><table><caption class="sr">Estado por línea</caption><thead><tr><th scope="col">Línea</th><th scope="col" class="r">Referencias</th><th scope="col">Reparto</th><th scope="col" class="r">Rotura</th><th scope="col" class="r">Bajo mínimo</th><th scope="col" class="r">Pendiente de propuestas</th></tr></thead><tbody>
    ${rows.map(({ k, xs, c }) => `<tr><td class="art"><a href="#/linea/${encodeURIComponent(k)}">${esc(k)}</a><small>${esc(L[k] || (k === '—' ? 'Sin línea asignada' : ''))}</small></td><td class="r num">${xs.length}</td>
      <td><div class="bar2" style="display:flex;height:12px;border-radius:3px;overflow:hidden;gap:1px;min-width:160px" aria-hidden="true">${SEM.filter(([s]) => c[s]).map(([s]) => `<span class="s-${s}" style="flex:${c[s]};background:var(--c)"></span>`).join('')}</div></td>
      <td class="r num">${c.rojo || 0}</td><td class="r num">${c.naranja || 0}</td><td class="r num">${c.amarillo || 0}</td></tr>`).join('')}
    </tbody></table></div>`;
  bindScenario(main, () => pageLines(main));
}
async function pageLine(main, [ln]) {
  if (!S.ds) return noData(main, 'Línea');
  const xs = S.ev.filter(x => (x.r.ln || '—') === ln && x.r.gp === 'Contra Stock');
  const name = (S.ds.meta.lineas || {})[ln] || '';
  const n = Cob.H, dem = new Array(n).fill(0), ent = new Array(n).fill(0);
  xs.forEach(({ e }) => { for (let i = 0; i < n; i++) { dem[i] += e.all.dem[i]; ent[i] += e.all.ent[i]; } });
  const rows = xs.slice().sort((a, b) => SEMORD[a.e.sem] - SEMORD[b.e.sem] || b.e.d3 - a.e.d3);
  main.innerHTML = `<p class="crumbs"><a href="#/lineas">Líneas</a> › ${esc(ln)}</p><h1>${esc(ln)}${name ? ' · ' + esc(name) : ''}</h1><p class="lead">${xs.length} referencias contra stock.</p>
    ${strip(xs, k => `#/coberturas?ln=${encodeURIComponent(ln)}&sem=${k}`)}
    <h2>Demanda y entradas de la línea</h2>
    <div class="tw"><table class="mt"><thead><tr><th scope="col">Unidades</th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="r">${monthLabel(i)}</th>`).join('')}</tr></thead><tbody>
      <tr><th scope="row">Demanda</th>${dem.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr>
      <tr><th scope="row">Entradas</th>${ent.map(v => `<td class="r num">${fmt(v)}</td>`).join('')}</tr></tbody></table></div>
    <p class="muted small">Entradas: ${ESC_TXT[S.esc]}${S.pv === 'C' ? '; demanda con previsión corregida' : ''}. Sin capacidad de la línea todavía: cuando esté ese dato se comparará aquí.</p>
    <h2>Referencias</h2>
    <div class="tw"><table><thead><tr><th scope="col">Estado</th><th scope="col">Referencia</th><th scope="col" class="r">Stock</th><th scope="col" class="r">Demanda/mes</th><th scope="col">Rotura</th><th scope="col">Próxima entrada</th></tr></thead><tbody>
    ${rows.map(({ r, e }) => `<tr><td>${pill(e.sem, e.why)}</td><td class="art">${refLink(r)}<small>${esc(r.n)}</small></td><td class="r num">${fmt(r.st)}</td><td class="r num">${fmt(e.d3)}</td><td>${rotCell(e)}</td><td>${nextEntry(e)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin referencias.</td></tr>'}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- Reunión semanal
async function pageMeeting(main) {
  if (!S.ds) return noData(main, 'Reunión semanal');
  await refreshActions(); updateChrome();
  const { q } = parseHash();
  const semF = q.get('sem') || 'rojo,naranja', onlyNo = q.get('sin') === '1';
  const canW = can('admin', 'planificador');
  const list = S.ev.filter(x => x.r.gp === 'Contra Stock' && semF.split(',').includes(x.e.sem) && (!onlyNo || !openActs(x.r.k).length))
    .sort((a, b) => SEMORD[a.e.sem] - SEMORD[b.e.sem] || (a.e.rot < 0 ? 99 : a.e.rot) - (b.e.rot < 0 ? 99 : b.e.rot) || b.e.d3 - a.e.d3);
  const today = todayISO();
  main.innerHTML = `<h1>Reunión semanal</h1><p class="lead">Referencias que necesitan una decisión y las acciones acordadas. Cada acción queda en la ficha de la referencia.</p>
    <form class="filters" onsubmit="return false">
      <label class="fld">Qué revisar<select id="mSem"><option value="rojo,naranja" ${semF === 'rojo,naranja' ? 'selected' : ''}>Rotura y bajo mínimo</option><option value="rojo" ${semF === 'rojo' ? 'selected' : ''}>Solo rotura</option><option value="rojo,naranja,amarillo" ${semF === 'rojo,naranja,amarillo' ? 'selected' : ''}>Rotura, bajo mínimo y pendientes de propuestas</option></select></label>
      <label class="fld" style="flex-direction:row;align-items:center;gap:6px;padding-bottom:8px"><input type="checkbox" id="mSin" ${onlyNo ? 'checked' : ''}> Solo sin acción abierta</label>
      ${scenarioCtl()}</form>
    <h2>Por decidir (${list.length})</h2>
    <div class="tw"><table><thead><tr><th scope="col">Estado</th><th scope="col">Referencia</th><th scope="col">Línea</th><th scope="col">Rotura</th><th scope="col">Próxima entrada</th><th scope="col">Acción abierta</th>${canW ? '<th scope="col"><span class="sr">Añadir</span></th>' : ''}</tr></thead><tbody>
    ${list.map(({ r, e }) => { const a = openActs(r.k)[0]; return `<tr><td>${pill(e.sem, e.why)}</td><td class="art">${refLink(r)}<small>${esc(r.n)}</small></td><td>${esc(r.ln || '—')}</td><td>${rotCell(e)}</td><td>${nextEntry(e)}</td>
      <td>${a ? `${esc(a.text)}<br><span class="muted small">${a.owner ? esc(a.owner) : ''}${a.due ? ' · ' + fdate(a.due) : ''}</span>` : '<span class="muted">—</span>'}</td>
      ${canW ? `<td><button class="btn ghost sm" data-add="${esc(r.k)}" aria-label="Añadir acción a ${esc(r.k)}">Añadir acción</button></td>` : ''}</tr>
      ${canW ? `<tr hidden id="af-${esc(r.k)}"><td colspan="7"><form class="form" data-f="${esc(r.k)}" style="max-width:none"><div class="row"><label>Acción<input name="text" required maxlength="2000"></label><label>Responsable<input name="owner" maxlength="120"></label><label>Fecha límite<input type="date" name="due"></label><button class="btn">Guardar</button></div></form></td></tr>` : ''}`; }).join('') || '<tr><td colspan="7" class="empty">Nada pendiente con estos criterios.</td></tr>'}
    </tbody></table></div>
    <h2>Acciones abiertas (${S.actions.length})</h2>
    <div class="tw"><table><thead><tr><th scope="col">Referencia</th><th scope="col">Acción</th><th scope="col">Responsable</th><th scope="col">Fecha límite</th><th scope="col">Creada</th>${canW ? '<th scope="col"><span class="sr">Estado</span></th>' : ''}</tr></thead><tbody>
    ${S.actions.map(a => `<tr><td><a href="${refHref(a.ref)}">${esc(a.ref)}</a><br><span class="muted small">${esc((S.byK[a.ref] || { r: { n: '' } }).r.n)}</span></td><td>${esc(a.text)}</td><td>${esc(a.owner || '')}</td><td class="${a.due && a.due < today ? 'neg' : ''}">${a.due ? fdate(a.due) : ''}</td><td class="small muted">${fdate(a.created)} · ${esc(a.created_by_name)}</td>
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
async function pageData(main) {
  if (!can('admin')) return pageNotFound(main);
  const loads = await api('/api/loads');
  main.innerHTML = `<h1>Datos</h1><p class="lead">Sube el MM_Supply exportado de ABAS. Primero se comprueba y te enseña el resultado; después lo publicas para todos.</p>
    <section class="card" style="max-width:760px"><h2>Cargar MM_Supply</h2>
      <form class="form" id="upF" style="max-width:none">
        <label class="drop" id="drop">Arrastra aquí el fichero o haz clic para elegirlo<input type="file" name="file" accept=".xlsx,.xlsm" class="sr" id="upFile"></label>
        <p class="muted small" id="fname"></p>
        <div class="row"><label>Fecha de los datos<input type="date" name="fecha" value="${todayISO()}"></label><button class="btn" id="chk" type="submit">Comprobar fichero</button></div>
      </form>
      <div id="prev" aria-live="polite"></div></section>
    <section class="card" style="max-width:760px;margin-top:14px"><h2>Criterios del semáforo</h2>
      <form class="form" id="cfgF"><label>Horizonte de alerta (meses)<input type="number" name="hz" min="1" max="6" value="${S.cfg.horizonte}"></label><div><button class="btn ghost">Guardar criterios</button></div></form>
      <p class="muted small">Rotura: el stock proyectado cae por debajo de 0 dentro del horizonte. Bajo mínimo: cae por debajo del stock mínimo. Pendiente de propuestas: con solo las OF habría problema y lo resuelven propuestas sin fijar, o hay una OF con fecha pasada. Sin demanda: no tiene demanda prevista en 12 meses (tenga stock o no).</p></section>
    <h2>Historial de cargas</h2>
    <div class="tw"><table><thead><tr><th scope="col">Cargado</th><th scope="col">Fichero</th><th scope="col">Fecha datos</th><th scope="col">Previsión</th><th scope="col" class="r">Referencias</th><th scope="col">Estado</th><th scope="col">Por</th></tr></thead><tbody>
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
        <p>${SEM.map(([k, t]) => `${t}: <b>${p.counts[k] || 0}</b>`).join(' · ')}</p>${p.warn.length ? `<p class="msg err">${p.warn.map(esc).join('<br>')}</p>` : ''}
        <button class="btn" id="pubB">Publicar para todos</button></div>`;
      $('#pubB').onclick = async () => { $('#pubB').disabled = true; try { await send(false); await loadData(); updateChrome(); toast('Datos publicados'); pageData(main); } catch (e) { $('#prev').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; } };
    } catch (e) { $('#prev').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
    b.disabled = false;
  };
  $('#cfgF').onsubmit = async (ev) => { ev.preventDefault(); try { S.cfg = await api('/api/config', { method: 'PUT', body: { horizonte: parseInt(ev.target.hz.value, 10) } }); recompute(); updateChrome(); toast('Criterios guardados'); } catch (e) { toast(e.message); } };
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
  'stock-minimo': ['Stock mínimo y lotes', 'Cálculo del stock mínimo según el error de previsión y el plazo, y del lote según la frecuencia de fabricación de cada clase, con la comparación contra los valores de ABAS y el fichero de carga.'],
  'desviacion': ['Desviación de previsiones', 'Acierto y sesgo de cada versión de previsión frente a la venta real, por referencia, marca y mandante, y cuánto mejora cada revisión trimestral.'],
  'consolidador': ['Consolidador de previsiones', 'Validación de la previsión de controlling contra el maestro (extinguir, sucesores, inactivos, lanzamientos) y generación del fichero de carga para ABAS y Power BI.'],
};
async function pageSoon(main, [k]) { const s = SOON[k] || ['Próximamente', '']; main.innerHTML = `<h1>${s[0]}</h1><p class="lead">${s[1]}</p><p class="muted">Este módulo está en preparación.</p>`; }
async function pageNotFound(main) { main.innerHTML = '<h1>Página no encontrada</h1><p class="lead">La dirección no corresponde a ninguna sección. Vuelve al <a href="#/">inicio</a>.</p>'; }

function pageLogin() {
  $('#app').removeAttribute('aria-busy');
  $('#app').innerHTML = `<main class="login" id="main"><section class="card"><h1 tabindex="-1">Planificación Supply</h1><p class="muted">bellochapplab · entra con tu usuario</p>
    <form class="form" id="lf"><label>Usuario<input name="username" required autocomplete="username" autofocus></label>
    <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
    <div><button class="btn">Entrar</button></div><p class="msg err" id="lm" aria-live="assertive"></p></form></section></main>`;
  document.title = 'Entrar · Planificación Supply';
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
