// Pruebas de static/core.js que no tienen gemela en core.py.  Uso: node tests/test_core_js.js
global.window = {};
require('../app/static/core.js');
const { evaluate } = window.Cob;
const cobTxt = (v) => window.Cob.cobTxt(v);
let fails = 0;
const check = (name, cond, detail) => { console.log((cond ? 'OK   ' : 'FALLO'), name, detail === undefined ? '' : detail); if (!cond) fails++; };

const base = { st: 300, mn: 0, at: 0, en: [], pd: new Array(12).fill(0), pv: new Array(12).fill(100), pv0r: 100 };
const nueva = { ...base, pvc: new Array(12).fill(50), pv0rc: 50, er: 0.5 };
const cfg = { horizonte: 3, escenario: 'ALL', prevision: 'T' };
check('cobertura prudente con previsión corregida y error', Math.abs(evaluate(nueva, cfg).cobp - 300 / (50 * 1.5)) < 1e-9, evaluate(nueva, cfg).cobp);
check('error por encima del 100 % se limita', Math.abs(evaluate({ ...nueva, er: 3 }, cfg).cobp - 300 / 100) < 1e-9);
check('carga antigua sin previsión corregida: sin cobertura prudente', evaluate(base, cfg).cobp === null, evaluate(base, cfg).cobp);

// Sin demanda en los 3 próximos meses no hay nada que cubrir: cobertura "sin dato" (99 → '—'), tenga stock o no
const sinDem = { ...nueva, st: 0, pv: new Array(12).fill(0), pv0r: 0, pvc: new Array(12).fill(0), pv0rc: 0 };
check('sin stock ni demanda: cobertura sin dato', evaluate(sinDem, cfg).cob === 99, evaluate(sinDem, cfg).cob);
check('sin stock ni demanda: cobertura prudente sin dato', evaluate(sinDem, cfg).cobp === 99, evaluate(sinDem, cfg).cobp);

// Cobertura desde hoy, mes a mes: lo que dura el stock con la demanda prevista (mes en curso por lo que queda)
const { cobertura } = window.Cob;
const dm = [43, 18, 7, 19, 19, 19, 19, 29, 19, 20, 39, 48];
check('cobertura: rompe este mes (día 1)', Math.abs(cobertura(34, dm, [31, 31]) - 34 / 43) < 1e-9, cobertura(34, dm, [31, 31]));
check('cobertura: día 25, el mes en curso pesa lo que queda', Math.abs(cobertura(34, [10, ...dm.slice(1)], [7, 31]) - (7 / 31 + 1 + 6 / 7)) < 1e-9, cobertura(34, [10, ...dm.slice(1)], [7, 31]));
check('cobertura: sin stock, 0', cobertura(0, dm, [31, 31]) === 0 && cobertura(-5, dm, [31, 31]) === 0);
check('cobertura: más de 12 meses', cobertura(10000, new Array(12).fill(100), [31, 31]) > 12 && cobTxt(cobertura(10000, new Array(12).fill(100), [31, 31])) === '> 12 m');
check('cobertura: sin demanda en 12 meses, sin dato', cobertura(500, new Array(12).fill(0), [31, 31]) === 99);
check('cobertura: meses sin demanda en medio no consumen', Math.abs(cobertura(150, [100, 0, 0, 100, 100, 0, 0, 0, 0, 0, 0, 0], [31, 31]) - 3.5) < 1e-9);
check('evaluate usa la cobertura desde hoy', Math.abs(evaluate({ ...base, st: 34, pv: dm, pv0r: 43 }, { ...cfg, dias: [31, 31] }).cob - 34 / 43) < 1e-9);

// Avisos en amarillo (gemelos de core.py, ver test_core.py)
const cs = { ...base, gp: 'Contra Stock', st: 100, pv: new Array(12).fill(1000), pv0r: 1000 };
const of = (q, d, f, t = 'OF') => ({ t, q, m: 0, d, late: false, f });
check('rotura antes de la entrada', evaluate({ ...cs, en: [of(3000, '2026-10-15', 0.5)] }, cfg).why === 'Rotura antes de la entrada del 15/10/26');
const fm = (q, d, m, t = 'OF') => ({ t, q, m, d, late: false });
const cs2 = { ...cs, st: 1500 };
check('rotura antes de la entrada del mes siguiente', evaluate({ ...cs2, en: [fm(3000, '2026-11-21', 1)] }, cfg).why === 'Rotura antes de la entrada del 21/11/26', evaluate({ ...cs2, en: [fm(3000, '2026-11-21', 1)] }, cfg).why);
check('entrada del mes siguiente a tiempo', evaluate({ ...cs2, en: [fm(3000, '2026-11-05', 1)] }, cfg).sem === 'verde');
check('rotura antes de la entrada fuera del horizonte no avisa', evaluate({ ...cs, st: 3500, en: [fm(3000, '2027-01-21', 3)] }, cfg).sem === 'verde');
// Fecha estimada de rotura: hoy 02/10 con 30 días por delante en octubre
const cfgF = { ...cfg, hoy: '2026-10-02', dias: [30, 31] };
check('fecha de rotura en el mes en curso', evaluate(cs, cfgF).rf === '2026-10-05', evaluate(cs, cfgF).rf);
const prot = { ...cs, st: 10603, pv: [17126, 12730, 26416, 14824, ...new Array(8).fill(15000)], pv0r: 16574, en: [{ t: 'OF', q: 16000, m: 0, d: '2026-10-13', late: false, f: 0.367 }] };
check('fecha de rotura en un mes siguiente (017380000600 con solo OF)', evaluate(prot, { ...cfgF, escenario: 'OF' }).rf === '2026-11-24', evaluate(prot, { ...cfgF, escenario: 'OF' }).rf);
check('sin rotura, sin fecha', evaluate({ ...cs, st: 1e6 }, cfgF).rf === '');
check('sin fecha de hoy (carga antigua), sin fecha', evaluate(cs, cfg).rf === '');
// Pedidos con fecha antes de la entrada por encima del stock: rojo y fecha de rotura = la del pedido que no cabe (010280001200)
const esp = { ...cs, st: 7848, pv: [2850, 9282, 9586, ...new Array(9).fill(5189)], pv0r: 2482, pd: [8688, 240, ...new Array(10).fill(0)], at: 4608,
  pdd: [['2026-10-05', 0, 4608], ['2026-10-05', 0, 12], ['2026-10-06', 0, 360], ['2026-10-15', 0, 3600], ['2026-10-19', 0, 108], ['2026-11-05', 1, 240]],
  en: [of(15000, '2026-10-21', 0.593, 'PF'), fm(12000, '2026-11-01', 1, 'P'), fm(12000, '2026-12-01', 2, 'P')] };
const eEsp = evaluate(esp, { ...cfg, hoy: '2026-10-05', dias: [27, 31] });
check('pedidos antes de la entrada por encima del stock: rojo', eEsp.sem === 'rojo' && eEsp.why === 'Pedidos sin stock hasta la entrada del 21/10/26', eEsp.why);
check('faltante de los pedidos antes de la entrada', eEsp.fa === 840, eEsp.fa);
const lz = evaluate({ ...esp, pdd: [], en: [{ t: 'P', q: 15000, m: 0, d: '2026-10-26', late: false, f: 0.78, dm: '2026-10-10' }, ...esp.en.slice(1)] }, cfg);
check('propuesta sin fijar movida por el plazo: lanzar ya', lz.why === 'Lanzar ya: propuesta sin fijar que no llega en 3 semanas', lz.why);
const bk = { ...cs, st: 1e6, pd: [300, ...new Array(11).fill(0)], at: 300 };
check('atrasados de meses anteriores encima de la previsión', evaluate({ ...bk, ab: 300 }, cfg).all.dem[0] === 1300, evaluate({ ...bk, ab: 300 }, cfg).all.dem[0]);
check('atrasados del mes en curso dentro de la previsión', evaluate(bk, cfg).all.dem[0] === 1000);
check('fecha de rotura = pedido que no cabe', eEsp.rf === '2026-10-15', eEsp.rf);
const pc = (q, d, late = false, f = 0) => ({ t: 'PC', q, m: 0, d, late, f, id: '637475', pv: 'TALENTO Y EXPERIENCIA S.L.U.' });
check('pedido de compra evita la rotura (también con solo firmes)', !['rojo', 'naranja'].includes(evaluate({ ...cs, en: [pc(9000, '2026-10-02')] }, { ...cfg, escenario: 'OF' }).sem));
check('pedido de compra con fecha pasada', evaluate({ ...cs, en: [pc(9000, '2026-09-11', true)] }, cfg).why === 'Pedido de compra con fecha pasada', evaluate({ ...cs, en: [pc(9000, '2026-09-11', true)] }, cfg).why);
check('pedido de compra es la próxima entrada', evaluate({ ...cs, en: [pc(9000, '2026-10-20', false, 0.6)] }, { ...cfg, escenario: 'OF' }).next?.t === 'PC');
const zt = (st, en = []) => [{ k: '01822000ZT', n: 'COLOR MASK MARRON', q: 1, st, en }];
const conpc = { ...cs, en: [pc(9000, '2026-10-02')] };
check('falta ZT para el pedido', evaluate({ ...conpc, zt: zt(2838) }, cfg).why === 'Falta ZT para el pedido', evaluate({ ...conpc, zt: zt(2838) }, cfg).why);
check('el stock del ZT cubre el pedido', evaluate({ ...conpc, zt: zt(10000) }, cfg).why !== 'Falta ZT para el pedido');
check('stock + OF del ZT cubren el pedido', evaluate({ ...conpc, zt: zt(2838, [{ t: 'OF', q: 7000, d: '2026-10-20', late: false }]) }, cfg).why !== 'Falta ZT para el pedido');
check('las propuestas del ZT no cubren', evaluate({ ...conpc, zt: zt(2838, [{ t: 'P', q: 9000, d: '2026-10-20', late: false }]) }, cfg).why === 'Falta ZT para el pedido');
check('falta ZT manda sobre el pedido atrasado', evaluate({ ...cs, en: [pc(9000, '2026-09-11', true)], zt: zt(0) }, cfg).why === 'Falta ZT para el pedido');
// ZT a tiempo: sus OF tienen que terminar 7 días antes de la fecha del pedido (acumulando los pedidos)
const csz = { ...cs, st: 3000 };  // con stock del PT: sin rotura antes de la entrada
const pc20 = { ...csz, en: [pc(9000, '2026-10-20', false, 0.6)] };
const zof = (d) => zt(2838, [{ t: 'OF', q: 7000, d, late: false }]);
check('OF del ZT 7 días antes del pedido: a tiempo', !evaluate({ ...pc20, zt: zof('2026-10-13') }, cfg).why.startsWith('ZT'), evaluate({ ...pc20, zt: zof('2026-10-13') }, cfg).why);
check('OF del ZT a menos de 7 días del pedido: tarde', evaluate({ ...pc20, zt: zof('2026-10-14') }, cfg).why === 'ZT tarde para el pedido del 20/10/26', evaluate({ ...pc20, zt: zof('2026-10-14') }, cfg).why);
const dos = { ...csz, en: [pc(2000, '2026-10-10', false, 0.3), { ...pc(7000, '2026-11-20'), m: 1 }] };
check('el stock cubre el primer pedido y la OF llega para el segundo', !evaluate({ ...dos, zt: zof('2026-11-05') }, cfg).why.startsWith('ZT'));
check('el ZT llega tarde para el segundo pedido', evaluate({ ...dos, zt: zof('2026-11-15') }, cfg).why === 'ZT tarde para el pedido del 20/11/26', evaluate({ ...dos, zt: zof('2026-11-15') }, cfg).why);
check('ZT tarde también en bajo pedido', evaluate({ ...pc20, gp: 'Bajo Pedido', zt: zof('2026-10-14') }, cfg).why === 'ZT tarde para el pedido del 20/10/26', evaluate({ ...pc20, gp: 'Bajo Pedido', zt: zof('2026-10-14') }, cfg).why);
check('límite del ZT cruza de mes', window.Cob.ztLimite('2026-11-03') === '2026-10-27', window.Cob.ztLimite('2026-11-03'));
check('la entrada llega antes de acabar el stock', evaluate({ ...cs, en: [of(3000, '2026-10-02', 0.05)] }, cfg).sem === 'verde');
const futura = { ...cs, st: 0, pv: [0, 0, 0, 0, ...new Array(8).fill(1000)], pv0r: 0 };
check('sin stock ni entradas con demanda en 6 meses', evaluate(futura, cfg).why === 'Sin stock ni entradas para la demanda prevista');
check('entradas sin demanda', evaluate({ ...cs, pv: new Array(12).fill(0), pv0r: 0, en: [of(500, '2026-10-15', 0.5)] }, cfg).why === 'Entradas sin demanda');

// Exceso y faltante (gemelos de core.py, ver test_core.py)
const exb = { ...base, gp: 'Contra Stock', md: 'Belloch', st: 700 };
check('exceso Belloch', evaluate(exb, cfg).sem === 'exceso' && evaluate(exb, cfg).ex === 100 && evaluate(exb, cfg).why === 'Stock para más de 6 meses', evaluate(exb, cfg));
check('exceso: en el límite no hay exceso', evaluate({ ...exb, st: 600 }, cfg).sem === 'verde');
check('Yunsey a 12 meses', evaluate({ ...exb, md: 'Yunsey', st: 1100 }, cfg).sem === 'verde' && evaluate({ ...exb, md: 'Yunsey', st: 1300 }, cfg).ex === 100);
check('meses de exceso configurables', evaluate(exb, { ...cfg, exceso: { Belloch: 3, Yunsey: 12 } }).ex === 400);
check('configuración incompleta usa el valor por defecto', evaluate(exb, { ...cfg, exceso: { Yunsey: 12 } }).ex === 100);
check('bajo pedido nunca es exceso', evaluate({ ...exb, gp: 'Bajo Pedido' }, cfg).sem === 'verde');
check('bajo mínimo manda sobre el exceso', evaluate({ ...exb, mn: 800 }, cfg).sem === 'naranja');
check('faltante en el horizonte', evaluate({ ...exb, st: 150 }, cfg).fa === 150 && evaluate({ ...exb, st: -50 }, cfg).fa === 350 && evaluate(exb, cfg).fa === 0);
check('exceso por stock máximo', evaluate({ ...exb, sx: 650 }, cfg).ex === 50 && evaluate({ ...exb, sx: 650 }, cfg).why === 'Por encima del stock máximo');
check('con stock máximo no cuentan los meses', evaluate({ ...exb, sx: 800 }, cfg).sem === 'verde');
check('sin stock máximo vuelve a los meses', evaluate({ ...exb, sx: null }, cfg).ex === 100);

console.log(fails ? `\n${fails} comprobaciones fallidas` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
