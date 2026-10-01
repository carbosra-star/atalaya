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


def art(n, alta=None, inact=False, estado="Producto terminado", gp="Contra Stock", lote=0, mn=0, fina=None, ext=False, suc="", precio=0.0):
    return dict(name=n, estado=estado, inact=inact, alta=alta, fina=fina, gp=gp, lote=lote, min=mn, ext=ext, suc=suc, precio=precio)


A = {
    "L1": art("Lanz. listo", alta=dt.date(2026, 5, 1), lote=1000, mn=500),   # en la app, todo preparado
    "L2": art("Lanz. vacío", alta=dt.date(2026, 8, 1), ext=True, suc="L1"),   # sin nada todavía; a extinguir con sucesor activo
    "L3": art("Alta antigua", alta=dt.date(2025, 11, 1)),                      # 11 meses: no es lanzamiento
    "F1": art("Futura", alta=dt.date(2024, 1, 1)),                             # previsión solo más allá de 12 meses
    "F2": art("Venta vieja", alta=dt.date(2023, 1, 1), ext=True, suc="I1"),   # última venta hace 15 meses; sucesor inactivo
    "F3": art("Previsión pasada", alta=dt.date(2023, 1, 1), ext=True, suc="ZZ"),  # solo previsión pasada; sucesor inexistente
    "I1": art("Inactiva con stock", inact=True, fina=dt.date(2026, 3, 2), precio=0.5),
    "I3": art("Inactiva cara", inact=True, precio=10.0),
    "I2": art("Inactiva sin stock", inact=True),
    "S1": art("Semielaborado", estado="Semielaborado"),
    "V1": art("Vuelve", alta=dt.date(2022, 1, 1)),
}
refs_p = [dict(k="L1", n="Lanz. listo", md="Belloch", gp="Contra Stock", ln="CS1-1", mn=500, lt=1000),
          dict(k="V1", n="Vuelve", md="Belloch", gp="Contra Stock", ln="", mn=0, lt=0)]
sig = dict(ST={"I1": 120.0, "I2": 0.0, "I3": 50.0}, PREV={"L1": [10] * 12}, PFUT={"F1"}, PPAS={"F3"}, VL={"F2": -15},
           LIN={"L1": "CS1-1"}, E={"L1": [{"t": "OF"}]}, TLY={})
prev_p = {"V0": "Ya no existe", "I2": "Inactiva sin stock", "S1": "Semielaborado", "L3": "Alta antigua", "L1": "Lanz. listo"}
pf = core.porfolio(A, refs_p, hoy, 2026, 8, prev=prev_p, **sig)
check("resumen del porfolio", pf["res"] == dict(maestro=10, activos=7, seguimiento=2, fuera=5), pf["res"])
lz = {x["k"]: x for x in pf["lanz"]}
check("lanzamientos: altas de los últimos 9 meses", set(lz) == {"L1", "L2"}, sorted(lz))
check("lanzamiento preparado", lz["L1"]["app"] and all(lz["L1"][c] for c in ("pv", "ln", "mn", "lt", "en")), lz["L1"])
check("lanzamiento sin nada", not lz["L2"]["app"] and not any(lz["L2"][c] for c in ("pv", "ln", "mn", "lt", "en")), lz["L2"])
fu = {x["k"]: x["cat"] for x in pf["fuera"]}
check("sin movimiento por categorías", fu == {"L2": "nada", "L3": "nada", "F1": "prev_futura", "F2": "venta_antigua", "F3": "prev_pasada"}, fu)
check("sin movimiento con su planificación", all(x["gp"] == "Contra Stock" for x in pf["fuera"]), pf["fuera"][0])
check("última venta de la venta antigua", next(x for x in pf["fuera"] if x["k"] == "F2")["uv"] == "06/2025")
check("inactivos con stock, ordenados por valor", [(x["k"], x["st"], x.get("pr")) for x in pf["inact"]] == [("I3", 50, 10.0), ("I1", 120, 0.5)], pf["inact"])
check("inactivos con su fecha de baja", next(x for x in pf["inact"] if x["k"] == "I1")["fina"] == "2026-03-02")
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
ex = {x["k"]: (x["ext"], x["sc"]) for x in pf["lanz"] + pf["fuera"] + pf["inact"]}
check("a extinguir con sucesor activo", ex["L2"] == (True, "L1"), ex["L2"])
check("a extinguir con sucesor inactivo: sin sucesor", ex["F2"] == (True, ""), ex["F2"])
check("a extinguir con sucesor que no existe: sin sucesor", ex["F3"] == (True, ""), ex["F3"])
check("no a extinguir", ex["L1"] == (False, "") and ex["I1"] == (False, ""), (ex["L1"], ex["I1"]))
check("altas y bajas también dicen si están a extinguir", all("ext" in x and "sc" in x for x in pf["cambios"]["entran"] + pf["cambios"]["salen"]))
check("sucesor válido", core.sucesor(A, "L2") == "L1" and core.sucesor(A, "F2") == "" and core.sucesor(A, "F3") == "" and core.sucesor(A, "L1") == "")
check("sin carga anterior no hay cambios", core.porfolio(A, refs_p, hoy, 2026, 8, prev=None, **sig)["cambios"] is None)

# ABC por venta: 12 meses cerrados; lanzamientos con venta anualizada (3-11 meses) o previsión (< 3 meses)
def rabc(k, vt, fv, pv=0, gp="Contra Stock", md="Belloch"):
    r = dict(k=k, md=md, gp=gp, vt=vt, pv=[pv] * 12)
    if fv != "sin":
        r["fv"] = fv
    return r


R = [rabc("R1", [100] * 12, -20), rabc("R2", [10] * 12, -15), rabc("R3", [0] * 7 + [50] * 5, -5), rabc("R4", [0] * 11 + [5], -1, pv=30),
     rabc("R5", [0] * 12, None), rabc("R6", [99] * 12, -30, gp="Bajo Pedido")]
core.clasificar(R, [45, 80, 95])
d = {r["k"]: r for r in R}
check("ABC: la más vendida es A aunque supere sola el corte", d["R1"]["abc"] == "A", d["R1"]["abc"])
check("ABC: reparto por venta con cortes 45/80/95", [d[k]["abc"] for k in ("R1", "R3", "R4", "R2", "R5", "R6")] == ["A", "B", "B", "C", "D", "NA"],
      [d[k]["abc"] for k in ("R1", "R3", "R4", "R2", "R5", "R6")])
check("ABC: 12 meses de venta, definitivo", d["R1"]["abcx"] == "venta" and not d["R1"]["abcp"] and d["R1"]["abcm"] == 1200)
check("ABC: 5 meses de venta, anualizada y provisional", d["R3"]["abcx"] == "anual" and d["R3"]["abcp"] and d["R3"]["abcm"] == 600 and d["R3"]["abcn"] == 5, d["R3"])
check("ABC: 1 mes de venta, por previsión y provisional", d["R4"]["abcx"] == "prev" and d["R4"]["abcp"] and d["R4"]["abcm"] == 360, d["R4"])
core.clasificar(R, [60, 90, 99])
check("ABC: con cortes 60/90/99", [d[k]["abc"] for k in ("R1", "R3", "R4", "R2")] == ["A", "A", "B", "C"], [d[k]["abc"] for k in ("R1", "R3", "R4", "R2")])
viejo = rabc("V", [0] * 4 + [20] * 8, "sin")
core.clasificar([viejo], [45, 80, 95])
check("ABC: carga antigua sin primera venta, se deduce de los 12 meses", viejo["abcx"] == "anual" and viejo["abcn"] == 8, viejo)

# Evaluación con previsión corregida y cargas antiguas sin pvc
base = dict(st=500, mn=0, at=0, en=[], pd=[0] * 12, pv=[100] * 12, pv0r=100)
nueva = dict(base, pvc=[50] * 12, pv0rc=50)
check("tal cual rompe en el mes 5", core.evaluate(nueva, 6, "ALL", "T")["rot"] == 5)
check("corregida rompe en el mes 10", core.evaluate(nueva, 6, "ALL", "C")["rot"] == 10)
check("carga antigua: corregida = tal cual", core.evaluate(base, 6, "ALL", "C") == core.evaluate(base, 6, "ALL", "T"))

# Avisos en amarillo (solo contra stock)
cs = dict(base, gp="Contra Stock", st=100, pv=[1000] * 12, pv0r=1000)
of = lambda q, d, f=None, t="OF": dict(t=t, q=q, m=0, d=d, late=False, **({"f": f} if f is not None else {}))  # noqa: E731
ev = lambda r, esc="ALL": core.evaluate(r, 3, esc)  # noqa: E731
check("rotura antes de la entrada", ev(dict(cs, en=[of(3000, "2026-10-15", 0.5)]))["why"] == "Rotura antes de la entrada del 15/10")
check("la entrada llega antes de acabar el stock", ev(dict(cs, en=[of(3000, "2026-10-02", 0.05)]))["sem"] == "verde")
check("la segunda entrada llega tarde", ev(dict(cs, en=[of(400, "2026-10-02", 0.05), of(3000, "2026-10-20", 0.7)]))["why"] == "Rotura antes de la entrada del 20/10")
check("propuesta que no cuenta en el escenario", ev(dict(cs, en=[of(3000, "2026-10-01", 0, "OF"), of(9, "2026-10-29", 0.95, "P")]), "OF")["sem"] == "verde")
check("rotura antes de la entrada: bajo pedido no", ev(dict(cs, gp="Bajo Pedido", en=[of(3000, "2026-10-15", 0.5)]))["sem"] == "verde")
futura = dict(cs, st=0, pv=[0] * 4 + [1000] * 8, pv0r=0)
check("sin stock ni entradas con demanda en 6 meses", ev(futura)["why"] == "Sin stock ni entradas para la demanda prevista")
check("sin stock ni entradas: demanda a más de 6 meses no avisa", ev(dict(futura, pv=[0] * 6 + [1000] * 6))["sem"] == "verde")
check("entradas sin demanda", ev(dict(cs, pv=[0] * 12, pv0r=0, en=[of(500, "2026-10-15", 0.5)]))["why"] == "OF o propuestas sin demanda prevista")
check("entradas sin demanda: bajo pedido sigue en gris", ev(dict(cs, gp="Bajo Pedido", pv=[0] * 12, pv0r=0, en=[of(500, "2026-10-15", 0.5)]))["sem"] == "gris")

# Exceso: stock por encima de la demanda de los próximos N meses (Belloch 6, Yunsey 12), solo contra stock
exb = dict(base, gp="Contra Stock", md="Belloch", st=700, pv=[100] * 12, pv0r=100)
r1 = core.evaluate(exb, 3, "ALL")
check("exceso Belloch: 700 > 6 × 100", r1["sem"] == "exceso" and r1["ex"] == 100 and r1["why"] == "Stock para más de 6 meses", r1)
check("exceso: en el límite no hay exceso", core.evaluate(dict(exb, st=600), 3, "ALL")["sem"] == "verde")
exy = dict(exb, md="Yunsey", st=1100)
check("Yunsey a 12 meses: 1100 no es exceso", core.evaluate(exy, 3, "ALL")["sem"] == "verde")
check("Yunsey a 12 meses: 1300 sí", core.evaluate(dict(exy, st=1300), 3, "ALL")["ex"] == 100)
check("meses de exceso configurables", core.evaluate(exb, 3, "ALL", "T", {"Belloch": 3, "Yunsey": 12})["ex"] == 400)
check("configuración incompleta usa el valor por defecto", core.evaluate(exb, 3, "ALL", "T", {"Yunsey": 12})["ex"] == 100)
check("bajo pedido nunca es exceso", core.evaluate(dict(exb, gp="Bajo Pedido"), 3, "ALL")["sem"] == "verde")
check("sin demanda sigue en gris", core.evaluate(dict(exb, pv=[0] * 12, pv0r=0), 3, "ALL")["sem"] == "gris")
check("bajo mínimo manda sobre el exceso", core.evaluate(dict(exb, mn=800), 3, "ALL")["sem"] == "naranja")
check("OF atrasada manda sobre el exceso", core.evaluate(dict(exb, en=[dict(t="OF", q=10, m=0, d="2026-09-01", late=True)]), 3, "ALL")["sem"] == "amarillo")
exc = dict(exb, st=500, pvc=[50] * 12, pv0rc=50)
check("con la previsión corregida aparece el exceso", core.evaluate(exc, 3, "ALL", "C")["ex"] == 200 and core.evaluate(exc, 3, "ALL", "T")["ex"] == 0)
check("sin exceso, ex = 0", core.evaluate(dict(exb, st=100), 3, "ALL")["ex"] == 0)
# Faltante: lo que falta en el peor mes del horizonte
fal = dict(exb, st=150)
check("faltante en el horizonte de 3 meses", core.evaluate(fal, 3, "ALL")["fa"] == 150, core.evaluate(fal, 3, "ALL"))
check("faltante con stock negativo", core.evaluate(dict(fal, st=-50), 3, "ALL")["fa"] == 350)
check("sin rotura en el horizonte, faltante 0", core.evaluate(exb, 3, "ALL")["fa"] == 0)
# Exceso por stock máximo (stock de seguridad + lote): sustituye al criterio de meses cuando hay sx
check("exceso por encima del stock máximo", core.evaluate(dict(exb, sx=650), 3, "ALL")["ex"] == 50 and core.evaluate(dict(exb, sx=650), 3, "ALL")["why"] == "Por encima del stock máximo")
check("con stock máximo no cuentan los meses", core.evaluate(dict(exb, sx=800), 3, "ALL")["sem"] == "verde")
check("sin stock máximo vuelve a los meses", core.evaluate(dict(exb, sx=None), 3, "ALL")["ex"] == 100)

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
