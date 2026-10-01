// Evaluación del semáforo en el navegador (gemela de core.evaluate en el servidor)
(function (root) {
  const H = 12;
  const SIN_ENT_MESES = 6;  // aviso de "sin stock ni entradas" si la demanda empieza en los 6 próximos meses
  const EXCESO_DEF = { Belloch: 6, Yunsey: 12 };  // exceso: stock para más de N meses de demanda (gemela de core.EXCESO_DEF)
  // escenario: 'OF' | 'OFPF' (OF + propuestas fijadas) | 'ALL' (OF + todas las propuestas)
  const counts = (t, esc) => t === 'OF' || (esc !== 'OF' && t === 'PF') || (esc === 'ALL' && t === 'P');
  // pv: 'T' previsión tal cual, 'C' corregida por el sesgo (si la carga la trae)
  function project(r, esc, pv) {
    const inc = (t) => counts(t, esc);
    const c = pv === 'C' && r.pvc, p = c ? r.pvc : r.pv, p0 = c ? r.pv0rc : r.pv0r;
    const dem = new Array(H), ent = new Array(H).fill(0), stk = new Array(H);
    for (let m = 0; m < H; m++) dem[m] = Math.max(m === 0 ? p0 : p[m], r.pd[m]);
    for (const e of r.en) if (inc(e.t)) ent[e.m] += e.q;
    let s = r.st;
    for (let m = 0; m < H; m++) { s = s - dem[m] + ent[m]; stk[m] = s; }
    return { dem, ent, stk };
  }

  // Primera entrada de este mes antes de la cual se acaba el stock, con la demanda del mes repartida
  // por igual en los días que quedan (e.f: parte de esos días que habrá pasado al llegar)
  function roturaAntes(r, d0, esc) {
    let s = r.st;
    for (const e of r.en.filter(e => e.m === 0 && counts(e.t, esc)).sort((a, b) => a.d < b.d ? -1 : 1)) {
      if (s - d0 * (e.f || 0) < 0) return e.d;
      s += e.q;
    }
    return '';
  }

  function evaluate(r, cfg) {
    const hz = cfg.horizonte || 3, pv = cfg.prevision === 'C' ? 'C' : 'T';
    const all = project(r, cfg.escenario || 'ALL', pv), of = project(r, 'OF', pv);
    const firstBelow = (p, lim) => { for (let m = 0; m < H; m++) if (p.stk[m] < lim) return m; return -1; };
    const rot = firstBelow(all, 0), bmin = r.mn > 0 ? firstBelow(all, r.mn) : -1;
    const rotOF = firstBelow(of, 0), bminOF = r.mn > 0 ? firstBelow(of, r.mn) : -1;
    // Demanda/mes: media de los 3 próximos meses completos (sin el mes en curso, que solo trae lo que queda)
    const d3 = all.dem.slice(1, 4).reduce((s, x) => s + x, 0) / 3;
    const cob = d3 > 0 ? r.st / d3 : 99;  // 99: sin demanda en los 3 próximos meses, no hay nada que cubrir
    // Cobertura prudente (informativa): demanda corregida de los 3 próximos meses más el error medio, con tope del 100 %
    const dc = project(r, 'ALL', 'C').dem.slice(1, 4).reduce((s, x) => s + x, 0) / 3 * (1 + Math.min(r.er == null ? 0 : r.er, 1));
    const cobp = !r.pvc ? null : dc > 0 ? r.st / dc : 99;  // null: carga antigua sin previsión corregida
    const next = r.en.filter(e => counts(e.t, cfg.escenario || 'ALL')).sort((a, b) => a.d < b.d ? -1 : 1)[0] || null;
    const lateOF = r.en.some(e => e.t === 'OF' && e.late);
    const hasP = r.en.some(e => e.t === 'P' && e.m < hz);
    let sem = 'verde', why = 'Cubierto en el horizonte';
    const d12 = all.dem.reduce((s, x) => s + x, 0);
    const cs = r.gp === 'Contra Stock';  // los bajo pedido se fabrican contra pedido: sin estos avisos
    if (d12 <= 0 && r.st >= 0) { if (r.en.length && cs) { sem = 'amarillo'; why = 'OF o propuestas sin demanda prevista'; } else { sem = 'gris'; why = r.st > 0 ? 'Sin demanda prevista' : 'Sin demanda ni stock'; } }
    else if (rot >= 0 && rot < hz) { sem = 'rojo'; why = (rot === 0 && r.at > r.st) ? 'Pedidos atrasados por encima del stock' : rot === 0 ? 'Rotura este mes' : 'Rotura en ' + rot + (rot === 1 ? ' mes' : ' meses'); }
    else if (bmin >= 0 && bmin < hz) { sem = 'naranja'; why = 'Por debajo del stock mínimo'; }
    else if (((rotOF >= 0 && rotOF < hz) || (bminOF >= 0 && bminOF < hz)) && hasP && cfg.escenario === 'ALL') { sem = 'amarillo'; why = 'Depende de propuestas sin fijar'; }
    if (sem === 'verde') {
      const antes = cs && roturaAntes(r, all.dem[0], cfg.escenario || 'ALL');
      if (antes) { sem = 'amarillo'; why = `Rotura antes de la entrada del ${antes.slice(8, 10)}/${antes.slice(5, 7)}`; }
      else if (lateOF) { sem = 'amarillo'; why = 'OF con fecha pasada'; }
      else if (cs && r.st <= 0 && !r.en.length && all.dem.slice(0, SIN_ENT_MESES).some(x => x > 0)) { sem = 'amarillo'; why = 'Sin stock ni entradas para la demanda prevista'; }
    }
    // Exceso: por encima del stock máximo (stock de seguridad + lote) si lo hay; si no, lo que seguiría
    // en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    const md = r.md || 'Belloch', n = Math.trunc((cfg.exceso && cfg.exceso[md]) || EXCESO_DEF[md] || 6), sx = r.sx;
    let ex = Math.max(0, Math.round(r.st - (sx ? sx : all.dem.slice(0, n).reduce((s, x) => s + x, 0))));
    if (sem === 'verde' && cs && ex > 0) { sem = 'exceso'; why = sx ? 'Por encima del stock máximo' : `Stock para más de ${n} meses`; }
    if (sem !== 'exceso') ex = 0;
    // Faltante: lo que falta en el peor mes del horizonte con el escenario de entradas elegido
    const fa = Math.max(0, Math.round(-Math.min(...all.stk.slice(0, hz))));
    return { all, of, rot, bmin, rotOF, cob, cobp, next, lateOF, sem, why, d3, d12, ex, fa };
  }

  root.Cob = { project, evaluate, H, EXCESO_DEF };
})(window);
