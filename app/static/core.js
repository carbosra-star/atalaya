// Evaluación del semáforo en el navegador (gemela de core.evaluate en el servidor)
(function (root) {
  const H = 12;
  const SIN_ENT_MESES = 6;  // aviso de "sin stock ni entradas" si la demanda empieza en los 6 próximos meses
  const EXCESO_DEF = { Belloch: 6, Yunsey: 12 };  // exceso: stock para más de N meses de demanda (gemela de core.EXCESO_DEF)
  // escenario: 'OF' (solo firmes: OF y pedidos de compra a proveedor) | 'OFPF' (+ propuestas fijadas) | 'ALL' (+ todas las propuestas)
  const counts = (t, esc) => t === 'OF' || t === 'PC' || (esc !== 'OF' && t === 'PF') || (esc === 'ALL' && t === 'P');
  // pv: 'T' previsión tal cual, 'C' corregida por el sesgo (si la carga la trae)
  function project(r, esc, pv) {
    const inc = (t) => counts(t, esc);
    const c = pv === 'C' && r.pvc, p = c ? r.pvc : r.pv, p0 = c ? r.pv0rc : r.pv0r;
    const dem = new Array(H), ent = new Array(H).fill(0), stk = new Array(H);
    // mes en curso: los atrasados vivos de meses anteriores (ab, incluidos en pd) van encima de la previsión
    const ab = r.ab || 0;
    for (let m = 0; m < H; m++) dem[m] = m === 0 ? ab + Math.max(p0, r.pd[0] - ab) : Math.max(p[m], r.pd[m]);
    for (const e of r.en) if (inc(e.t)) ent[e.m] += e.q;
    let s = r.st;
    for (let m = 0; m < H; m++) { s = s - dem[m] + ent[m]; stk[m] = s; }
    return { dem, ent, stk };
  }

  // Cobertura desde hoy: meses que dura el stock consumiendo la demanda prevista mes a mes (el mes en curso
  // por lo que queda de él, que pesa los días que quedan ÷ días del mes). 99: sin demanda en 12 meses (sin dato);
  // 50: dura más de 12 meses
  function cobertura(st, dem, dias) {
    if (!dem.some(x => x > 0)) return 99;
    if (st <= 0) return 0;
    const f0 = dias && dias[1] ? dias[0] / dias[1] : 1;
    let s = st, t = 0;
    for (let m = 0; m < dem.length; m++) {
      const w = m === 0 ? f0 : 1;
      if (s < dem[m]) return t + w * s / dem[m];
      s -= dem[m]; t += w;
    }
    return 50;
  }
  const cobTxt = (v) => v == null || v >= 99 ? '—' : v > 12 ? '> 12 m' : Math.max(0, v).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' m';

  // Parte del mes que ha pasado al llegar la entrada: en el mes en curso la trae la carga (e.f, sobre los días
  // que quedan); en los siguientes, (día − 1) ÷ días del mes
  const diasMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();  // m de 1 a 12
  function fraccion(e) {
    if (e.m === 0) return e.f || 0;
    if (!e.d) return 0;
    return (+e.d.slice(8, 10) - 1) / diasMes(+e.d.slice(0, 4), +e.d.slice(5, 7));
  }
  // Rotura día a día: la demanda de cada mes repartida por igual en sus días (el mes en curso, en los que quedan)
  // y cada entrada en su fecha. Devuelve el primer momento sin stock { m: mes, t: parte del mes, antes: fecha de la
  // entrada que llega tarde o '' si no la hay ese mes, ped: lo que faltaría por los pedidos con fecha (pdd) que vencen
  // antes de esa entrada (0 si es solo por el reparto), dia: fecha del primer pedido que no cabe } o null. Hasta cada
  // entrada cuenta lo mayor entre el reparto y esos pedidos; los del mismo día se sirven con la entrada. Gemela de core.rotura_dia
  function roturaDia(r, p, esc) {
    let s = r.st;
    const pdd = r.pdd || [];
    const at = (m, d, c) => ({ m, t: d > 0 ? Math.max(0, (c + s) / d) : 0 });
    for (let m = 0; m < H; m++) {
      const d = p.dem[m];
      const es = r.en.filter(e => e.m === m && counts(e.t, esc)).map(e => [fraccion(e), e]).sort((a, b) => a[0] - b[0] || (a[1].d < b[1].d ? -1 : 1));
      let c = 0;  // demanda del mes ya descontada de s
      for (const [f, e] of es) {
        const ps = pdd.filter(x => x[1] === m && x[0] < e.d), ped = ps.reduce((t, x) => t + x[2], 0);
        const hasta = Math.min(d, Math.max(d * f, ped));
        if (s - (hasta - c) < -1e-9) {
          const falta = Math.round(Math.max(0, ped - c - s));
          let dia = '';
          if (falta > 0) { let a = c; for (const x of ps) { a += x[2]; if (a - c > s + 1e-9) { dia = x[0]; break; } } }
          return { ...at(m, d, c), antes: e.d, ped: falta, dia };
        }
        s += e.q - (hasta - c);
        c = hasta;
      }
      if (s - (d - c) < -1e-9) return { ...at(m, d, c), antes: '', ped: 0, dia: '' };
      s -= d - c;
    }
    return null;
  }
  // Fecha estimada (ISO) de la rotura; '' sin rotura o sin fecha de hoy (cargas antiguas)
  function fechaRotura(rd, hoy, dias) {
    if (rd && rd.dia) return rd.dia;
    if (!rd || !hoy || !dias) return '';
    const y = +hoy.slice(0, 4), m0 = +hoy.slice(5, 7) - 1;
    const d = rd.m === 0 ? new Date(Date.UTC(y, m0, +hoy.slice(8, 10) + Math.min(dias[0] - 1, Math.floor(rd.t * dias[0]))))
      : new Date(Date.UTC(y, m0 + rd.m, 1 + Math.min(diasMes(y, m0 + rd.m + 1) - 1, Math.floor(rd.t * diasMes(y, m0 + rd.m + 1)))));
    return d.toISOString().slice(0, 10);
  }

  // PT fabricado fuera: el proveedor necesita el ZT del escandallo que fabricamos nosotros. Las propuestas del ZT no
  // cuentan: aún no está fabricado. Motivo o '': "Falta ZT para el pedido" si los pedidos de compra pendientes superan lo
  // que cubre algún ZT con lo firme (stock + OF, en PT: ÷ ZT por PT); "ZT tarde para el pedido del dd/mm/aa" si lo hay
  // pero no estará ZT_MARGEN días antes de ese pedido (con lo acumulado de los pedidos hasta esa fecha). Gemela de core.falta_zt
  const ZT_MARGEN = 7;
  const ztCubre = (z, hasta) => (Math.max(z.st, 0) + z.en.filter(e => e.t === 'OF' && (hasta == null || e.d <= hasta)).reduce((t, e) => t + e.q, 0)) / (z.q || 1);
  const ztLimite = (d) => { const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) - ZT_MARGEN)); return x.toISOString().slice(0, 10); };
  function faltaZT(r) {
    const pcs = r.en.filter(e => e.t === 'PC').sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
    const pend = pcs.reduce((t, e) => t + e.q, 0);
    if (!pend || !r.zt || !r.zt.length) return '';
    if (r.zt.some(z => ztCubre(z) < pend - 0.5)) return 'Falta ZT para el pedido';
    let acum = 0;
    for (const e of pcs) {
      acum += e.q;
      if (!e.d) continue;
      const hasta = ztLimite(e.d);
      if (r.zt.some(z => ztCubre(z, hasta) < acum - 0.5)) return `ZT tarde para el pedido del ${e.d.slice(8, 10)}/${e.d.slice(5, 7)}/${e.d.slice(2, 4)}`;
    }
    return '';
  }

  function evaluate(r, cfg) {
    const hz = cfg.horizonte || 3, pv = cfg.prevision === 'C' ? 'C' : 'T';
    const all = project(r, cfg.escenario || 'ALL', pv), of = project(r, 'OF', pv);
    const firstBelow = (p, lim) => { for (let m = 0; m < H; m++) if (p.stk[m] < lim) return m; return -1; };
    const rot = firstBelow(all, 0), bmin = r.mn > 0 ? firstBelow(all, r.mn) : -1;
    const rotOF = firstBelow(of, 0), bminOF = r.mn > 0 ? firstBelow(of, r.mn) : -1;
    const rd = roturaDia(r, all, cfg.escenario || 'ALL'), rf = fechaRotura(rd, cfg.hoy, cfg.dias);
    // Demanda/mes: media de los 3 próximos meses completos (sin el mes en curso, que solo trae lo que queda)
    const d3 = all.dem.slice(1, 4).reduce((s, x) => s + x, 0) / 3;
    const cob = cobertura(r.st, all.dem, cfg.dias);
    // Cobertura prudente (informativa): igual, con la demanda corregida aumentada en el error medio (tope del 100 %)
    const kp = 1 + Math.min(r.er == null ? 0 : r.er, 1);
    const cobp = !r.pvc ? null : cobertura(r.st, project(r, 'ALL', 'C').dem.map(x => x * kp), cfg.dias);  // null: carga antigua sin previsión corregida
    const next = r.en.filter(e => counts(e.t, cfg.escenario || 'ALL')).sort((a, b) => a.d < b.d ? -1 : 1)[0] || null;
    const lateOF = r.en.some(e => e.t === 'OF' && e.late), latePC = r.en.some(e => e.t === 'PC' && e.late);
    const hasP = r.en.some(e => e.t === 'P' && e.m < hz);
    let sem = 'verde', why = 'Cubierto en el horizonte';
    const d12 = all.dem.reduce((s, x) => s + x, 0);
    const cs = r.gp === 'Contra Stock';  // los bajo pedido se fabrican contra pedido: sin estos avisos
    const pedAntes = cs && rd && rd.m < hz && rd.antes && rd.ped > 0;  // pedidos firmes que no caben antes de la entrada
    if (d12 <= 0 && r.st >= 0) { if (r.en.length && cs) { sem = 'amarillo'; why = 'Entradas sin demanda'; } else { sem = 'gris'; why = r.st > 0 ? 'Sin demanda prevista' : 'Sin demanda ni stock'; } }
    else if (rot >= 0 && rot < hz) { sem = 'rojo'; why = (rot === 0 && r.at > r.st) ? 'Pedidos atrasados por encima del stock' : rot === 0 ? 'Rotura este mes' : 'Rotura en ' + rot + (rot === 1 ? ' mes' : ' meses'); }
    else if (pedAntes) { sem = 'rojo'; why = `Pedidos sin stock hasta la entrada del ${rd.antes.slice(8, 10)}/${rd.antes.slice(5, 7)}/${rd.antes.slice(2, 4)}`; }
    else if (bmin >= 0 && bmin < hz) { sem = 'naranja'; why = 'Por debajo del stock mínimo'; }
    else if (((rotOF >= 0 && rotOF < hz) || (bminOF >= 0 && bminOF < hz)) && hasP && cfg.escenario === 'ALL') { sem = 'amarillo'; why = r.en.some(e => e.t === 'P' && e.dm != null && e.m < hz) ? 'Lanzar ya: propuesta sin fijar que no llega en 3 semanas' : 'Depende de propuestas sin fijar'; }  // dm: el MRP la quería antes de lo que da el plazo
    if (sem === 'verde') {
      const antes = cs && rd && rd.m < hz && rd.antes;
      if (antes) { sem = 'amarillo'; why = `Rotura antes de la entrada del ${antes.slice(8, 10)}/${antes.slice(5, 7)}/${antes.slice(2, 4)}`; }
      else if (faltaZT(r)) { sem = 'amarillo'; why = faltaZT(r); }  // también bajo pedido: el pedido de compra es firme
      else if (lateOF) { sem = 'amarillo'; why = 'OF con fecha pasada'; }
      else if (latePC) { sem = 'amarillo'; why = 'Pedido de compra con fecha pasada'; }
      else if (cs && r.st <= 0 && !r.en.length && all.dem.slice(0, SIN_ENT_MESES).some(x => x > 0)) { sem = 'amarillo'; why = 'Sin stock ni entradas para la demanda prevista'; }
    }
    // Exceso: por encima del stock máximo (stock mínimo + lote) si lo hay; si no, lo que seguiría
    // en el almacén pasados N meses sin fabricar nada más (solo contra stock)
    const md = r.md || 'Belloch', n = Math.trunc((cfg.exceso && cfg.exceso[md]) || EXCESO_DEF[md] || 6), sx = r.sx;
    let ex = Math.max(0, Math.round(r.st - (sx ? sx : all.dem.slice(0, n).reduce((s, x) => s + x, 0))));
    if (sem === 'verde' && cs && ex > 0) { sem = 'exceso'; why = sx ? 'Por encima del stock máximo' : `Stock para más de ${n} meses`; }
    if (sem !== 'exceso') ex = 0;
    // Faltante: lo que falta en el peor mes del horizonte con el escenario de entradas elegido
    const fa = Math.max(0, Math.round(-Math.min(...all.stk.slice(0, hz))), pedAntes ? rd.ped : 0);
    return { all, of, rot, rf, bmin, rotOF, cob, cobp, next, lateOF, sem, why, d3, d12, ex, fa };
  }

  root.Cob = { project, evaluate, H, EXCESO_DEF, cobertura, cobTxt, ztCubre, ztLimite, ZT_MARGEN };
})(window);
