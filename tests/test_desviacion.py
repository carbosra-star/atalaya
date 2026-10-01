"""Pruebas de la desviación de previsiones: corrección por ritmo de venta y por sesgo histórico.

Uso:  python tests/test_desviacion.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
import desviacion as D  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        fails += 1


def ref(k="P1", **kw):
    r = dict(k=k, n="Prueba", md="Belloch", mc="NELLY", abc="A", gp="Contra Stock", pr=2.0, ext=False, abcx="venta",
             pv=[100] * 12, vt=[80] * 12, hp=[100] * 12, fc=0.75, fo="ref")
    r.update(kw)
    return r


def f(rs, ac=None):
    return {p["k"]: p for p in D.filas(rs, ac or {})}


p = f([ref()])["P1"]
check("ritmo: venta 960 / previsión 1.200 − 1", abs(p["cr"] - (-0.2)) < 1e-9, p["cr"])
check("sesgo: factor 0,75 − 1", abs(p["cs"] - (-0.25)) < 1e-9, p["cs"])
check("mismo sentido: la menor", p["cp"] == -0.2 and p["tipo"] == "propuesta" and p["estado"] == "propuesta", (p["cp"], p["tipo"]))
check("previsión corregida y efecto", p["pvc"] == [80] * 12 and p["eu"] == -240 and p["ee"] == -480, (p["pvc"][:2], p["eu"], p["ee"]))
rv = f([ref(fc=1.3)])["P1"]
check("sentidos contrarios: revisar sin cifra", rv["tipo"] == "revisar" and rv["cp"] is None and rv["ca"] == 0 and rv["eu"] == 0, rv["tipo"])
check("tope −50 %", f([ref(vt=[20] * 12, fc=0.5)])["P1"]["cp"] == -0.5)
check("tope con solo el ritmo", f([ref(vt=[20] * 12, fo="grupo")])["P1"]["cp"] == -0.5)
sn = f([ref(vt=[95] * 12, fo="grupo")])["P1"]
check("menos del 10 %: sin corrección", sn["cp"] == 0 and sn["tipo"] == "sin", (sn["cp"], sn["tipo"]))
check("redondeo a porcentaje entero", f([ref(vt=[77] * 12)])["P1"]["cp"] == -0.23)
ex = f([ref(ext=True)])["P1"]
check("a extinguir: sin propuesta aunque tenga sesgo propio", ex["tipo"] == "extinguir" and ex["cp"] is None and ex["cs"] is None and ex["cr"] is None, (ex["tipo"], ex["cs"]))
check("sin marca: se agrupa como —", f([ref(mc="")])["P1"]["mc"] == "—")
check("ABC provisional (menos de 12 meses de venta): sin ritmo", f([ref(abcx="anual")])["P1"]["cr"] is None)
check("sin venta: sin ritmo", f([ref(vt=[0] * 12)])["P1"]["cr"] is None)
check("sesgo de grupo: no cuenta", f([ref(fo="grupo")])["P1"]["cs"] is None)
ac = f([ref()], {"P1": dict(pct=-0.1, src="manual")})["P1"]
check("acuerdo vigente", ac["estado"] == "acordado" and ac["ca"] == -0.1 and ac["pvc"] == [90] * 12 and ac["eu"] == -120 and ac["src"] == "manual", ac)
check("previsión corregida nunca negativa", min(f([ref()], {"P1": dict(pct=-0.9, src="manual")})["P1"]["pvc"]) >= 0)
check("bajo pedido fuera", f([ref(gp="Bajo Pedido")]) == {})
check("ABC NA, vacío o ausente fuera", f([ref(abc="NA")]) == {} and f([ref(abc="")]) == {} and f([ref(abc=None)]) == {})
check("sin precio: efecto € 0", f([ref(pr=0)])["P1"]["ee"] == 0 and f([ref(pr=None)])["P1"]["ee"] == 0)

# Resumen por marca: sesgo y error históricos con los meses que tenían previsión
rs = [ref("A1"), ref("A2"), ref("B1", mc="DRN", vt=[100] * 12)]
filas = D.filas(rs, {})
res = D.resumen_marcas(filas, rs)
check("primera fila: total", res[0]["mc"] == "Total" and res[0]["n"] == 3, res[0])
nel = next(x for x in res if x["mc"] == "NELLY")
check("marca: previsión y venta 12 meses", nel["p12"] == 2400 and nel["v12"] == 1920 and abs(nel["dv"] - 0.25) < 1e-9, nel)
check("marca: sesgo histórico", abs(nel["sh"] - 0.25) < 1e-9 and abs(nel["er"] - 0.25) < 1e-9, nel)
check("marca: propuestas y efecto", nel["prop"] == 2 and nel["eu"] == -480, nel)
check("marcas ordenadas por venta", [x["mc"] for x in res[1:]] == ["NELLY", "DRN"])
sinhp = ref("H1"); del sinhp["hp"]
check("sin histórico de previsión: no falla", D.resumen_marcas(D.filas([sinhp], {}), [sinhp])[1]["sh"] is None)

print("\nTodo correcto" if not fails else f"\n{fails} comprobaciones fallidas")
sys.exit(1 if fails else 0)
