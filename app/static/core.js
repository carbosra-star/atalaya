// Evaluación del semáforo en el navegador (gemela de core.evaluate en el servidor)
(function (root) {
  const H = 12;
  // escenario: 'OF' | 'OFPF' (OF + propuestas fijadas) | 'ALL' (OF + todas las propuestas)
  function project(r, esc) {
    const inc = (t) => t === 'OF' || (esc !== 'OF' && t === 'PF') || (esc === 'ALL' && t === 'P');
    const dem = new Array(H), ent = new Array(H).fill(0), stk = new Array(H);
    for (let m = 0; m < H; m++) dem[m] = Math.max(m === 0 ? r.pv0r : r.pv[m], r.pd[m]);
    for (const e of r.en) if (inc(e.t)) ent[e.m] += e.q;
    let s = r.st;
    for (let m = 0; m < H; m++) { s = s - dem[m] + ent[m]; stk[m] = s; }
    return { dem, ent, stk };
  }

  function evaluate(r, cfg) {
    const hz = cfg.horizonte || 3;
    const all = project(r, cfg.escenario || 'ALL'), of = project(r, 'OF');
    const firstBelow = (p, lim) => { for (let m = 0; m < H; m++) if (p.stk[m] < lim) return m; return -1; };
    const rot = firstBelow(all, 0), bmin = r.mn > 0 ? firstBelow(all, r.mn) : -1;
    const rotOF = firstBelow(of, 0), bminOF = r.mn > 0 ? firstBelow(of, r.mn) : -1;
    const d3 = all.dem.slice(0, 3).reduce((s, x) => s + x, 0) / 3;
    const cob = d3 > 0 ? r.st / d3 : (r.st > 0 ? 99 : 0);
    const next = r.en.filter(e => e.t === 'OF' || e.t === 'PF' || (cfg.escenario === 'ALL' && e.t === 'P')).sort((a, b) => a.d < b.d ? -1 : 1)[0] || null;
    const lateOF = r.en.some(e => e.t === 'OF' && e.late);
    const hasP = r.en.some(e => e.t === 'P' && e.m < hz);
    let sem = 'verde', why = 'Cubierto en el horizonte';
    const d12 = all.dem.reduce((s, x) => s + x, 0);
    if (d12 <= 0 && r.st > 0) { sem = 'gris'; why = 'Sin demanda prevista'; }
    else if (rot >= 0 && rot < hz) { sem = 'rojo'; why = (rot === 0 && r.at > r.st) ? 'Pedidos atrasados por encima del stock' : rot === 0 ? 'Rotura este mes' : 'Rotura en ' + rot + (rot === 1 ? ' mes' : ' meses'); }
    else if (bmin >= 0 && bmin < hz) { sem = 'naranja'; why = 'Por debajo del stock mínimo'; }
    else if (((rotOF >= 0 && rotOF < hz) || (bminOF >= 0 && bminOF < hz)) && hasP && cfg.escenario === 'ALL') { sem = 'amarillo'; why = 'Depende de propuestas sin fijar'; }
    if (lateOF && sem === 'verde') { sem = 'amarillo'; why = 'OF con fecha pasada'; }
    return { all, of, rot, bmin, rotOF, cob, next, lateOF, sem, why, d3, d12 };
  }

  root.Cob = { project, evaluate, H };
})(window);
