"""Pruebas de la lógica de acierto de la previsión, con datos inventados (sin Excel).

Uso:  python tests/test_core.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import core  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


def ref(k, md="Belloch", abc="A", hp=None, vt=None, pv=None, v0=0):
    return dict(k=k, md=md, abc=abc, hp=hp or [0] * 12, vt=vt or [0] * 12, pv=pv or [100] * 12, v0=v0)


# Previsión vigente: base 09/2026 (base_m = 8). Mes -8 = 01/2026, -4 = 05/2026, -1 = 08/2026
cover = {"2026Q1": set(range(-8, 4)), "2026Q2": set(range(-8, 4)), "2026Q3": set(range(-2, 4)), "2025Q4": set(range(-11, 4))}
v = core.vigentes(cover, 2026, 8)
check("01/26 sale de 2026Q1 aunque 2026Q2 lo cubra", v[-8 + 12] == "2026Q1", v)
check("05/26 sale de 2026Q2", v[-4 + 12] == "2026Q2")
check("08/26 sale de 2026Q3", v[-1 + 12] == "2026Q3")
check("09/25 sin versión vigente", v[0] == "", v[0])

# Factor propio, con límites
a = ref("a", hp=[100] * 12, vt=[90] * 12)
b = ref("b", hp=[100] * 12, vt=[300] * 12)
c = ref("c", hp=[100] * 12, vt=[10] * 12)
core.acierto([a, b, c], 30, 30)
check("factor propio 0,90", a["fc"] == 0.9 and a["fo"] == "ref", (a["fc"], a["fo"]))
check("factor limitado a 1,5", b["fc"] == 1.5)
check("factor limitado a 0,5", c["fc"] == 0.5)
check("error propio 120 / 1080", abs(a["er"] - round(120 / 1080, 3)) < 1e-9 and a["eo"] == "ref", a["er"])
check("previsión corregida", a["pvc"] == [90] * 12 and a["pv0rc"] == 90, (a["pvc"][:2], a["pv0rc"]))

# Pocos meses: factor y error del grupo (mandante, ABC)
g1 = ref("g1", hp=[100] * 12, vt=[80] * 12)
g2 = ref("g2", hp=[100] * 12, vt=[120] * 12)
nuevo = ref("n", hp=[0] * 9 + [100] * 3, vt=[0] * 9 + [500] * 3)
otro = ref("o", md="Yunsey", hp=[0] * 12, vt=[50] * 12)
core.acierto([g1, g2, nuevo, otro], 30, 30)
check("con 3 meses usa el grupo", nuevo["fo"] == "grupo" and nuevo["fc"] == 1.0 and nuevo["hm"] == 3, (nuevo["fc"], nuevo["fo"]))
check("error del grupo", nuevo["eo"] == "grupo" and abs(nuevo["er"] - 0.2) < 1e-9, nuevo["er"])
check("grupo sin historia: factor 1 y sin error", otro["fc"] == 1.0 and otro["fo"] == "sin" and otro["er"] is None and otro["eo"] == "sin")

# Historia sin venta y venta negativa
s = ref("s", hp=[100] * 12, vt=[0] * 12)
d = ref("d", hp=[100] * 12, vt=[100] * 11 + [-50])
core.acierto([g1, s, d], 30, 30)
check("sin venta: factor 0,5 y error del grupo", s["fc"] == 0.5 and s["eo"] == "grupo", (s["fc"], s["eo"]))
check("venta negativa: error con valor absoluto", abs(d["er"] - round(150 / 1050, 3)) < 1e-9, d["er"])

# Resto del mes en curso corregido: 2 de 30 días, previsión 300 × 0,9 = 270, vendido 0 → 18
m = ref("m", hp=[100] * 12, vt=[90] * 12, pv=[300] + [100] * 11)
core.acierto([m], 2, 30)
check("resto del mes con previsión corregida", m["pv0rc"] == 18, m["pv0rc"])

# El factor compara solo los meses que tenían previsión (la venta de un mes sin previsión, p. ej. un
# lanzamiento, no infla el factor); el error sí cuenta todos los meses
lz = ref("lz", hp=[0] * 6 + [100] * 6, vt=[100] * 6 + [90] * 6)
core.acierto([lz], 30, 30)
check("factor solo con meses con previsión", lz["fc"] == 0.9, lz["fc"])
check("error con todos los meses", abs(lz["er"] - round((600 + 60) / 1140, 3)) < 1e-9, lz["er"])
gz1 = ref("gz1", abc="B", hp=[0] * 6 + [100] * 6, vt=[100] * 6 + [80] * 6)
gz2 = ref("gz2", abc="B", hp=[0] * 12, vt=[50] * 12)
core.acierto([gz1, gz2], 30, 30)
check("factor del grupo solo con meses con previsión", gz2["fo"] == "grupo" and gz2["fc"] == 0.8, gz2["fc"])

# Porfolio: resumen, lanzamientos, limpieza del maestro y cambios frente a la carga anterior
import datetime as dt  # noqa: E402
hoy = dt.date(2026, 9, 29)


def art(n, alta=None, inact=False, estado="Producto terminado", gp="Contra Stock", lote=0, mn=0, fina=None):
    return dict(name=n, estado=estado, inact=inact, alta=alta, fina=fina, gp=gp, lote=lote, min=mn)


A = {
    "L1": art("Lanz. listo", alta=dt.date(2026, 5, 1), lote=1000, mn=500),   # en la app, todo preparado
    "L2": art("Lanz. vacío", alta=dt.date(2026, 8, 1)),                        # sin nada todavía
    "L3": art("Alta antigua", alta=dt.date(2025, 11, 1)),                      # 11 meses: no es lanzamiento
    "F1": art("Futura", alta=dt.date(2024, 1, 1)),                             # previsión solo más allá de 12 meses
    "F2": art("Venta vieja", alta=dt.date(2023, 1, 1)),                        # última venta hace 15 meses
    "F3": art("Previsión pasada", alta=dt.date(2023, 1, 1)),                   # solo previsión de meses pasados
    "I1": art("Inactiva con stock", inact=True, fina=dt.date(2026, 3, 2)),
    "I2": art("Inactiva sin stock", inact=True),
    "S1": art("Semielaborado", estado="Semielaborado"),
    "V1": art("Vuelve", alta=dt.date(2022, 1, 1)),
}
refs_p = [dict(k="L1", n="Lanz. listo", md="Belloch", gp="Contra Stock", ln="CS1-1", mn=500, lt=1000),
          dict(k="V1", n="Vuelve", md="Belloch", gp="Contra Stock", ln="", mn=0, lt=0)]
sig = dict(ST={"I1": 120.0, "I2": 0.0}, PREV={"L1": [10] * 12}, PFUT={"F1"}, PPAS={"F3"}, VL={"F2": -15},
           LIN={"L1": "CS1-1"}, E={"L1": [{"t": "OF"}]}, TLY={})
prev_p = {"V0": "Ya no existe", "I2": "Inactiva sin stock", "S1": "Semielaborado", "L3": "Alta antigua", "L1": "Lanz. listo"}
pf = core.porfolio(A, refs_p, hoy, 2026, 8, prev=prev_p, **sig)
check("resumen del porfolio", pf["res"] == dict(maestro=9, activos=7, seguimiento=2, fuera=5), pf["res"])
lz = {x["k"]: x for x in pf["lanz"]}
check("lanzamientos: altas de los últimos 9 meses", set(lz) == {"L1", "L2"}, sorted(lz))
check("lanzamiento preparado", lz["L1"]["app"] and all(lz["L1"][c] for c in ("pv", "ln", "mn", "lt", "en")), lz["L1"])
check("lanzamiento sin nada", not lz["L2"]["app"] and not any(lz["L2"][c] for c in ("pv", "ln", "mn", "lt", "en")), lz["L2"])
fu = {x["k"]: x["cat"] for x in pf["fuera"]}
check("sin movimiento por categorías", fu == {"L2": "nada", "L3": "nada", "F1": "prev_futura", "F2": "venta_antigua", "F3": "prev_pasada"}, fu)
check("sin movimiento con su planificación", all(x["gp"] == "Contra Stock" for x in pf["fuera"]), pf["fuera"][0])
check("última venta de la venta antigua", next(x for x in pf["fuera"] if x["k"] == "F2")["uv"] == "06/2025")
check("inactivos con stock", [(x["k"], x["st"], x["fina"]) for x in pf["inact"]] == [("I1", 120, "2026-03-02")], pf["inact"])
en = {x["k"]: x["m"] for x in pf["cambios"]["entran"]}
sa = {x["k"]: x["m"] for x in pf["cambios"]["salen"]}
check("entran: vuelve a tener movimiento", en == {"V1": "vuelve"}, en)
check("salen con su motivo", sa == {"V0": "no_maestro", "I2": "inactiva", "S1": "no_pt", "L3": "sin_mov"}, sa)
pf2 = core.porfolio(A, refs_p, hoy, 2026, 8, prev={"L1": "Lanz. listo"}, **sig)
check("entran: un alta antigua no cuenta como alta nueva", {x["k"]: x["m"] for x in pf2["cambios"]["entran"]} == {"V1": "vuelve"})
refs_n = refs_p + [dict(k="L2", n="Lanz. vacío", md="Belloch", gp="Contra Stock", ln="", mn=0, lt=0)]
pf3 = core.porfolio(A, refs_n, hoy, 2026, 8, prev={"L1": "Lanz. listo", "V1": "Vuelve"}, **sig)
check("entran: alta nueva", {x["k"]: x["m"] for x in pf3["cambios"]["entran"]} == {"L2": "alta"})
pf4 = core.porfolio(A, refs_p, hoy, 2026, 8, prev=None, **dict(sig, PFUTV={"L2"}))
check("lanzamiento con previsión solo más allá de 12 meses: previsión ✓", next(x for x in pf4["lanz"] if x["k"] == "L2")["pv"])
check("sin carga anterior no hay cambios", core.porfolio(A, refs_p, hoy, 2026, 8, prev=None, **sig)["cambios"] is None)

# Evaluación con previsión corregida y cargas antiguas sin pvc
base = dict(st=500, mn=0, at=0, en=[], pd=[0] * 12, pv=[100] * 12, pv0r=100)
nueva = dict(base, pvc=[50] * 12, pv0rc=50)
check("tal cual rompe en el mes 5", core.evaluate(nueva, 6, "ALL", "T")["rot"] == 5)
check("corregida rompe en el mes 10", core.evaluate(nueva, 6, "ALL", "C")["rot"] == 10)
check("carga antigua: corregida = tal cual", core.evaluate(base, 6, "ALL", "C") == core.evaluate(base, 6, "ALL", "T"))

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
