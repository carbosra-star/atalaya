"""Prueba rápida de extremo a extremo de la API.

Uso:  DATA_DIR=/tmp/supply-test python tests/test_api.py ruta/al/MM_Supply.xlsx
"""
import io
import os
import sys

os.environ.setdefault("ADMIN_USER", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "admin12345")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import app as A  # noqa: E402

H = {"X-Requested-With": "supply-app"}
c = A.app.test_client()
assert c.post("/api/login", json={"username": "admin", "password": "admin12345"}, headers=H).status_code == 200
data = open(sys.argv[1], "rb").read()
r = c.post("/api/upload", data={"file": (io.BytesIO(data), "MM_Supply.xlsx"), "dry": "1"}, headers=H, content_type="multipart/form-data")
assert r.status_code == 200, r.json
print("Comprobación:", r.json["preview"])
r = c.post("/api/upload", data={"file": (io.BytesIO(data), "MM_Supply.xlsx"), "dry": "0"}, headers=H, content_type="multipart/form-data")
assert r.json["ok"]
ds = c.get("/api/dataset").json
print("Referencias publicadas:", len(ds["refs"]), "· previsión", ds["meta"]["version"])
print("OK")
