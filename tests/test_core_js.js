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
check('rotura antes de la entrada', evaluate({ ...cs, en: [of(3000, '2026-10-15', 0.5)] }, cfg).why === 'Rotura antes de la entrada del 15/10');
check('la entrada llega antes de acabar el stock', evaluate({ ...cs, en: [of(3000, '2026-10-02', 0.05)] }, cfg).sem === 'verde');
const futura = { ...cs, st: 0, pv: [0, 0, 0, 0, ...new Array(8).fill(1000)], pv0r: 0 };
check('sin stock ni entradas con demanda en 6 meses', evaluate(futura, cfg).why === 'Sin stock ni entradas para la demanda prevista');
check('entradas sin demanda', evaluate({ ...cs, pv: new Array(12).fill(0), pv0r: 0, en: [of(500, '2026-10-15', 0.5)] }, cfg).why === 'OF o propuestas sin demanda prevista');

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
