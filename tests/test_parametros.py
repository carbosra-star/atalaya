"""Pruebas del cálculo de parámetros de planificación (lote, stock de seguridad, stock máximo).

Uso:  python tests/test_parametros.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import parametros as P  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


FREQ = {"Belloch": [12, 6, 4, 2], "Yunsey": [6, 4, 2, 1]}
SSP = {"Belloch": [75, 75, 50, 0], "Yunsey": [75, 75, 50, 0]}
NS = P.NS_DEF


def ref(k="P1", **kw):
    r = dict(k=k, n="Prueba", md="Belloch", abc="A", gp="Contra Stock", ln="L1", pr=1.0, st=0, mn=1000, lt=20000,
             pv=[2000] * 12, vt=[800, 1200] * 6, hp=[1000] * 12)
    r.update(kw)
    return r


def calc(rs, dec=None, extra=None):
    return {p["k"]: p for p in P.parametros(rs, FREQ, SSP, NS, dec or {}, extra or {})}


# Lote: previsión anual / fabricaciones; ≥ 10.000 a miles, por debajo a centenas, mínimo 100
check("lote 24.000 / 12 = 2.000", P.lote_calc(24000, 12) == 2000)
check("redondeo a centenas: la mitad sube", P.round100(250) == 300 and P.round100(249) == 200, P.round100(250))
check("redondeo a miles: la mitad sube", P.lote_calc(126000, 12) == 11000, P.lote_calc(126000, 12))
check("lote ≥ 10.000 a miles", P.lote_calc(130000, 12) == 11000, P.lote_calc(130000, 12))
check("lote pequeño a centenas, mínimo 100", P.lote_calc(1000, 12) == 100 and P.lote_calc(500, 12) == 100)
check("sin previsión, lote 0", P.lote_calc(0, 12) == 0)

p = calc([ref()])["P1"]
check("lote calculado", p["lc"] == 2000, p["lc"])
check("SS método Excel: lote × 75 %", p["xl"] == 1500, p["xl"])
# Estadístico: error 200/1000 = 0,2; z(95 %) 1,645; previsión trimestre 2.000; √(15/21) → 556 → 600
check("SS estadístico", p["est"] == 600 and p["tipo"] == "ok" and abs(p["er"] - 0.2) < 1e-9, (p["est"], p["tipo"], p["er"]))
check("propuesta = estadístico", p["ssp"] == 600 and p["ltp"] == 2000)
check("con cambio", p["estado"] == "cambio" and not p["d"])
check("Δ € del stock medio", p["de"] == -9400, p["de"])
check("stock máximo con el ERP mientras no se decida", p["smax"] == 21000, p["smax"])
check("previsión/mes del trimestre", p["pm"] == 2000)
check("plazo extra de material", calc([ref()], extra={"P1": 27})["P1"]["est"] == 900)

# Reglas
irr = calc([ref(vt=[0, 0, 0, 3000] * 3)])["P1"]
check("error > 100 %: irregular, sin cifra y a decidir", irr["tipo"] == "irregular" and irr["est"] is None and irr["estado"] == "decidir" and irr["ssp"] == 1000, irr)
check("irregular con sobreprevisión: corregir previsión", irr["flag"] == "corregir")
sh = calc([ref(hp=[0] * 7 + [1000] * 5)])["P1"]
check("menos de 6 meses: sin historia", sh["tipo"] == "sin_hist" and sh["est"] is None and sh["estado"] == "decidir")
sob = calc([ref(mn=500, vt=[600, 1000] * 6)])["P1"]
check("sobreprevisión > 20 %: no sube", sob["est"] == 500 and sob["flag"] == "corregir", (sob["est"], sob["sg"]))
inf = calc([ref(vt=[1300, 1500] * 6)])["P1"]
check("infraprevisión > 20 %: se calcula y se marca corregir previsión", inf["tipo"] == "ok" and inf["flag"] == "corregir" and inf["sg"] < -0.2 and inf["est"] is not None, (inf["sg"], inf["est"]))
sinhp = ref(); del sinhp["hp"]
check("carga sin histórico de previsión: sin historia, sin fallar", calc([sinhp])["P1"]["tipo"] == "sin_hist")
check("límite ×2 del ERP", calc([ref(mn=200)])["P1"]["est"] == 400)
check("límite ×0,5 del ERP", calc([ref(mn=4000)])["P1"]["est"] == 2000)
yun = calc([ref(md="Yunsey")])["P1"]
check("Yunsey no baja del ERP", yun["est"] == 1000 and yun["lc"] == 4000, (yun["est"], yun["lc"]))
check("Yunsey con ERP no múltiplo de 100 no baja", calc([ref(md="Yunsey", mn=250)])["P1"]["est"] >= 250)
check("ruido en el SS: se propone el ERP", calc([ref(mn=650)])["P1"]["ssp"] == 650)
check("ruido en el lote: se propone el ERP", calc([ref(lt=2050)])["P1"]["ltp"] == 2050)
igual = calc([ref(mn=600, lt=2000)])["P1"]
check("igual al ERP", igual["estado"] == "igual" and igual["de"] == 0, igual["estado"])
check("sin lote en el ERP y sin decisión: stock máximo nulo", calc([ref(lt=0)])["P1"]["smax"] is None)
# Sin previsión o a extinguir: no se propone nada automático (ni lote 0 ni la mitad del SS), se decide a mano
ext = calc([ref(ext=True)])["P1"]
check("a extinguir: se propone dejar de reponer (SS 0 y lote 0)", ext["tipo"] == "extinguir" and ext["estado"] == "cambio" and ext["ssp"] == 0 and ext["ltp"] == 0 and ext["est"] is None and ext["de"] == -11000, ext)
check("a extinguir ya a 0 en el ERP: igual", calc([ref(ext=True, mn=0, lt=0)])["P1"]["estado"] == "igual")
sp = calc([ref(pv=[0] * 12)])["P1"]
check("sin previsión en 12 meses: a decidir con el ERP", sp["tipo"] == "sin_prev" and sp["estado"] == "decidir" and sp["ssp"] == 1000 and sp["ltp"] == 20000, sp)
tq = calc([ref(pv=[2000, 0, 0, 0] + [3000] * 8)])["P1"]
check("sin previsión el próximo trimestre (temporada): a decidir con el ERP", tq["tipo"] == "sin_prev" and tq["estado"] == "decidir" and tq["ssp"] == 1000, tq)
check("bajo pedido fuera", calc([ref(gp="Bajo Pedido")]) == {})
check("ABC NA fuera", calc([ref(abc="NA")]) == {})
check("sin precio: Δ € 0", calc([ref(pr=0)])["P1"]["de"] == 0 and calc([ref(pr=None)])["P1"]["de"] == 0)

# Decisiones
dd = calc([ref()], dec={"P1": dict(ss=800, lote=2000, aplicado=None)})["P1"]
check("decidido", dd["estado"] == "decidido" and dd["ss"] == 800 and dd["lote"] == 2000 and dd["d"], dd["estado"])
check("stock máximo con lo decidido", dd["smax"] == 2800)
ap = calc([ref()], dec={"P1": dict(ss=1000, lote=20000, aplicado="2026-10-01")})["P1"]
check("aplicado", ap["estado"] == "aplicado" and ap["smax"] == 21000)
ign = calc([ref()], dec={"P1": dict(ss=800, lote=2000, aplicado="2026-09-22")})["P1"]
check("aplicada y cambiada después en ABAS: se ignora", ign["estado"] == "cambio" and not ign["d"] and ign["smax"] == 21000, ign["estado"])

# Resumen en € por mandante y clase
rs = P.parametros([ref("A1"), ref("A2", pr=2.0), ref("Y1", md="Yunsey", abc="B")], FREQ, SSP, NS, {"A1": dict(ss=800, lote=2000, aplicado=None)}, {})
res = P.resumen(rs)
ba = next(x for x in res["grupos"] if x["md"] == "Belloch" and x["abc"] == "A")
check("resumen: SS del ERP", ba["ss_erp"] == 1000 * 1 + 1000 * 2, ba)
check("resumen: SS propuesto", ba["ss_prop"] == 600 * 1 + 600 * 2, ba)
check("resumen: SS decidido (decisión o ERP)", ba["ss_dec"] == 800 * 1 + 1000 * 2, ba)
check("resumen: stock medio decidido", ba["med_dec"] == (800 + 1000) * 1 + (1000 + 10000) * 2, ba)
check("resumen: estados", res["estados"] == {"decidido": 1, "cambio": 2}, res["estados"])

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
