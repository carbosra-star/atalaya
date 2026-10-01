// Pruebas de static/core.js que no tienen gemela en core.py.  Uso: node tests/test_core_js.js
global.window = {};
require('../app/static/core.js');
const { evaluate } = window.Cob;
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

// Avisos en amarillo (gemelos de core.py, ver test_core.py)
const cs = { ...base, gp: 'Contra Stock', st: 100, pv: new Array(12).fill(1000), pv0r: 1000 };
const of = (q, d, f, t = 'OF') => ({ t, q, m: 0, d, late: false, f });
check('rotura antes de la entrada', evaluate({ ...cs, en: [of(3000, '2026-10-15', 0.5)] }, cfg).why === 'Rotura antes de la entrada del 15/10');
check('la entrada llega antes de acabar el stock', evaluate({ ...cs, en: [of(3000, '2026-10-02', 0.05)] }, cfg).sem === 'verde');
const futura = { ...cs, st: 0, pv: [0, 0, 0, 0, ...new Array(8).fill(1000)], pv0r: 0 };
check('sin stock ni entradas con demanda en 6 meses', evaluate(futura, cfg).why === 'Sin stock ni entradas para la demanda prevista');
check('entradas sin demanda', evaluate({ ...cs, pv: new Array(12).fill(0), pv0r: 0, en: [of(500, '2026-10-15', 0.5)] }, cfg).why === 'OF o propuestas sin demanda prevista');

console.log(fails ? `\n${fails} comprobaciones fallidas` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
