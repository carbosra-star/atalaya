"""Prueba de extremo a extremo de la API y de la lógica de coberturas.

Uso:  DATA_DIR=/tmp/supply-test python tests/test_api.py ruta/al/MM_Supply.xlsx

DATA_DIR debe ser una carpeta vacía o nueva: la prueba crea su propia base de datos.
Si hay Node.js instalado, comprueba también que static/core.js evalúa igual que core.py.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

os.environ.setdefault("ADMIN_USER", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "admin12345")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app")
sys.path.insert(0, ROOT)
import app as A  # noqa: E402
import core  # noqa: E402

H = {"X-Requested-With": "supply-app"}
data = open(sys.argv[1], "rb").read()


def upload(c, dry):
    return c.post("/api/upload", data={"file": (io.BytesIO(data), "MM_Supply.xlsx"), "dry": "1" if dry else "0"},
                  headers=H, content_type="multipart/form-data")


def check(name, cond, detail=""):
    print(("OK   " if cond else "FALLO"), name, detail)
    if not cond:
        check.fails += 1


check.fails = 0
c = A.app.test_client()

# Sesión y protección de peticiones
check("sin cabecera de la app se rechaza", c.post("/api/login", json={"username": "admin", "password": "admin12345"}).status_code == 403)
check("login del administrador", c.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers=H).status_code == 200)

# Carga de datos
r = upload(c, True)
check("comprobación del fichero", r.status_code == 200, r.json.get("preview") if r.json else r.status_code)
check("primera publicación", upload(c, False).json.get("ok"))
check("segunda publicación", upload(c, False).json.get("ok"))
ds = c.get("/api/dataset").json
check("referencias publicadas", len(ds["refs"]) > 0, f'{len(ds["refs"])} · previsión {ds["meta"]["version"]}')
pf = ds.get("porfolio") or {}
check("porfolio: resumen del maestro", pf.get("res", {}).get("seguimiento") == len(ds["refs"]) and pf["res"]["fuera"] == len(pf["fuera"]), pf.get("res"))
check("porfolio: 69 PT activos sin movimiento y 6 inactivos con stock", len(pf.get("fuera", [])) == 69 and len(pf.get("inact", [])) == 6,
      (len(pf.get("fuera", [])), len(pf.get("inact", []))))
check("porfolio: lanzamientos de los últimos 9 meses", len(pf.get("lanz", [])) > 0 and all(x["alta"] >= "2025-12-29" for x in pf["lanz"]), len(pf.get("lanz", [])))
check("porfolio: misma carga dos veces, sin altas ni bajas", pf.get("cambios") == {"entran": [], "salen": []}, pf.get("cambios"))
r = upload(c, True)
check("la comprobación del fichero resume altas y bajas", r.json["preview"].get("cambios") == {"entran": 0, "salen": 0}, r.json["preview"].get("cambios"))
bel = [r for r in ds["refs"] if r["md"] == "Belloch" and r["gp"] == "Contra Stock"]
check("stock mínimo de Belloch desde mindest del maestro", sum(r["mn"] > 0 for r in bel) > len(bel) // 3, f'{sum(r["mn"] > 0 for r in bel)} de {len(bel)}')
laca = next((r for r in ds["refs"] if r["k"] == "010010001200"), None)
check("la laca 010010001200 tiene stock mínimo 20.000", laca is not None and laca["mn"] == 20000, laca and laca["mn"])
check("previsión operativa: todos los meses tienen versión", all(ds["meta"]["prev_src"]), ds["meta"]["prev_src"])
check("carga anterior evaluada en las seis combinaciones", ds["prev"] and set(ds["prev"]["sem"]) == {"OF", "OFPF", "ALL", "OF_C", "OFPF_C", "ALL_C"})

# Validaciones de acciones
r = c.post("/api/actions", json={"ref": "<img src=x onerror=alert(1)>", "text": "x"}, headers=H)
check("acción con referencia no válida se rechaza", r.status_code == 400)
k = ds["refs"][0]["k"]
r = c.post("/api/actions", json={"ref": k, "text": "Revisar", "due": "2026-10-15"}, headers=H)
aid = r.json[0]["id"] if r.status_code == 200 else None
check("acción válida", aid is not None)
check("fecha límite no válida se rechaza", c.patch(f"/api/actions/{aid}", json={"due": "no-es-fecha"}, headers=H).status_code == 400)

# Contraseña temporal: sin cambiarla no se ven datos
pw = c.post("/api/users", json={"username": "lec", "name": "Lector", "role": "lector"}, headers=H).json["password"]
c2 = A.app.test_client()
c2.post("/api/login", json={"username": "lec", "password": pw}, headers=H)
check("con contraseña temporal /api/me responde", c2.get("/api/me").status_code == 200)
check("con contraseña temporal no hay datos", c2.get("/api/dataset").status_code == 403)
c2.post("/api/me/password", json={"current": pw, "new": "nueva-clave-1"}, headers=H)
check("tras cambiarla sí hay datos", c2.get("/api/dataset").status_code == 200)
check("un lector no puede crear acciones", c2.post("/api/actions", json={"ref": k, "text": "x"}, headers=H).status_code == 403)

# Límite de intentos: la IP de X-Forwarded-For no cuenta si no hay proxy de confianza
c3 = A.app.test_client()
for i in range(8):
    c3.post("/api/login", json={"username": "admin", "password": "mal"}, headers={**H, "X-Forwarded-For": f"10.0.0.{i}"})
r = c3.post("/api/login", json={"username": "admin", "password": "mal"}, headers={**H, "X-Forwarded-For": "10.9.9.9"})
check("cambiar X-Forwarded-For no evita el bloqueo", r.status_code == 429)

# Paridad core.py / static/core.js
node = shutil.which("node")
if node:
    out = {f"{e}{p}{h}": {r["k"]: core.evaluate(r, h, e, p)["sem"] for r in ds["refs"]}
           for e in ("OF", "OFPF", "ALL") for p in ("T", "C") for h in (1, 3, 6)}
    with tempfile.TemporaryDirectory() as tmp:
        fj = os.path.join(tmp, "d.json")
        json.dump({"refs": ds["refs"], "py": out}, open(fj, "w"))
        js = ("global.window={};require(process.argv[1]);const d=require(process.argv[2]);let n=0;"
              "for(const e of ['OF','OFPF','ALL'])for(const p of ['T','C'])for(const h of [1,3,6])for(const r of d.refs)"
              "if(window.Cob.evaluate(r,{horizonte:h,escenario:e,prevision:p}).sem!==d.py[e+p+h][r.k])n++;console.log(n)")
        diff = subprocess.check_output([node, "-e", js, os.path.join(ROOT, "static", "core.js"), fj], text=True).strip()
    check("core.js evalúa igual que core.py", diff == "0", f"{diff} diferencias")
else:
    print("--   sin Node.js: no se comprueba la paridad con core.js")

print("\nTodo correcto" if not check.fails else f"\n{check.fails} comprobaciones fallidas")
sys.exit(1 if check.fails else 0)
