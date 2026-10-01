"""Planificación Supply · bellochapplab

Aplicación web para el seguimiento de coberturas de producto terminado.
Flask + SQLite. Los datos entran subiendo el MM_Supply (Excel) desde la
sección Datos (solo administradores).
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
import zlib
from collections import defaultdict
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

import core
import desviacion
import parametros

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "supply.db"
STATIC = Path(__file__).parent / "static"
KEEP_LOADS = int(os.environ.get("KEEP_LOADS", "30"))
ROLES = ("admin", "planificador", "lector")
TZ = ZoneInfo(os.environ.get("APP_TZ", "Europe/Madrid"))
REF_RE = re.compile(r"[0-9A-Za-z._-]{1,20}")
ESCENARIOS = ("OF", "OFPF", "ALL")


def _secret_key() -> str:
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    f = DATA_DIR / "secret.key"
    try:
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # solo el primer proceso la crea
        os.write(fd, secrets.token_hex(32).encode())
        os.close(fd)
    except FileExistsError:
        pass
    for _ in range(50):
        k = f.read_text().strip()
        if k:
            return k
        time.sleep(0.05)
    raise RuntimeError("No se ha podido leer la clave de sesión")


app = Flask(__name__, static_folder=None)
if os.environ.get("TRUST_PROXY") == "1":  # detrás del proxy inverso del NAS: la IP real viene en X-Forwarded-For
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
app.config.update(
    SECRET_KEY=_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=dt.timedelta(hours=int(os.environ.get("SESSION_HOURS", "12"))),
    MAX_CONTENT_LENGTH=60 * 1024 * 1024,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  pwd TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','planificador','lector')),
  active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loads(
  id INTEGER PRIMARY KEY, created TEXT NOT NULL, user_id INTEGER, filename TEXT, version TEXT, base TEXT, hoy TEXT,
  n INTEGER, counts TEXT, sem TEXT, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notes_ref ON notes(ref);
CREATE TABLE IF NOT EXISTS actions(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, text TEXT NOT NULL, owner TEXT, due TEXT,
  status TEXT NOT NULL DEFAULT 'abierta' CHECK(status IN ('abierta','hecha','descartada')),
  created_by INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, load_id INTEGER);
CREATE INDEX IF NOT EXISTS actions_ref ON actions(ref);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS param_dec(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL, ss INTEGER NOT NULL, lote INTEGER NOT NULL,
  src_ss TEXT NOT NULL CHECK(src_ss IN ('erp','excel','estadistico','manual')),
  src_lote TEXT NOT NULL CHECK(src_lote IN ('erp','calculado','manual')),
  ss_antes INTEGER, lote_antes INTEGER, motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL,
  aplicado TEXT);
CREATE INDEX IF NOT EXISTS param_dec_ref ON param_dec(ref, id);
CREATE TABLE IF NOT EXISTS param_extra(
  ref TEXT PRIMARY KEY, dias INTEGER NOT NULL, motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prev_dec(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, md TEXT NOT NULL, version TEXT NOT NULL,
  pct REAL NOT NULL, src TEXT NOT NULL CHECK(src IN ('propuesta','manual','mantener')),
  motivo TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS prev_dec_ref ON prev_dec(ref, version, id);
CREATE INDEX IF NOT EXISTS prev_dec_ver ON prev_dec(version, ref, id);
CREATE TABLE IF NOT EXISTS linea_alias(codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL, user_id INTEGER NOT NULL, updated TEXT NOT NULL);
"""


def now() -> str:
    return dt.datetime.now(TZ).replace(tzinfo=None).isoformat(timespec="seconds")


def today() -> dt.date:
    return dt.datetime.now(TZ).date()


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def _close(_exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()


def init_db() -> None:
    """Crea las tablas y el primer administrador. Seguro con varios procesos arrancando a la vez."""
    c = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(SCHEMA)
    c.execute("BEGIN IMMEDIATE")
    try:
        if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            user = os.environ.get("ADMIN_USER", "admin")
            pwd = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(10)
            c.execute("INSERT INTO users(username,name,pwd,role,must_change,created) VALUES(?,?,?,?,?,?)",
                      (user, os.environ.get("ADMIN_NAME", "Administrador"), generate_password_hash(pwd), "admin",
                       0 if os.environ.get("ADMIN_PASSWORD") else 1, now()))
            if not os.environ.get("ADMIN_PASSWORD"):
                print(f"[supply] Usuario administrador creado: {user} / contraseña temporal: {pwd}", flush=True)
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK")
        raise
    finally:
        c.close()


def get_config() -> dict:
    cfg = {"horizonte": 3, "abc": json.loads(json.dumps(core.ABC_DEF)), "exceso": dict(core.EXCESO_DEF),
           "ns": json.loads(json.dumps(parametros.NS_DEF))}
    for r in db().execute("SELECT key,value FROM config"):
        cfg[r["key"]] = json.loads(r["value"])
    return cfg


# ---------------------------------------------------------------- seguridad
def err(msg: str, code: int = 400):
    return jsonify({"error": msg}), code


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    u = db().execute("SELECT id,username,name,role,active,must_change FROM users WHERE id=?", (uid,)).fetchone()
    if not u or not u["active"]:
        session.clear()
        return None
    return u


def need(*roles, temp_ok=False):
    """Exige sesión (y uno de los roles, si se indican). Con contraseña temporal
    solo se permiten las rutas marcadas con temp_ok."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return err("Inicia sesión para continuar", 401)
            if u["must_change"] and not temp_ok:
                return err("Cambia tu contraseña temporal para continuar", 403)
            if roles and u["role"] not in roles:
                return err("Tu usuario no tiene permiso para esta acción", 403)
            g.user = u
            return fn(*a, **kw)
        return wrapper
    return deco


@app.before_request
def _csrf():
    # Las peticiones que modifican datos deben venir de la propia app (cabecera personalizada)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.path.startswith("/api/"):
        if request.headers.get("X-Requested-With") != "supply-app":
            return err("Petición no permitida", 403)


@app.after_request
def _headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "same-origin"
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif request.path == "/" or request.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"  # el navegador comprueba si hay versión nueva: no hace falta Ctrl+F5
    if (resp.mimetype in ("application/json", "text/html", "text/css", "application/javascript", "text/javascript")
            and "gzip" in request.headers.get("Accept-Encoding", "") and not resp.direct_passthrough
            and resp.status_code == 200 and "Content-Encoding" not in resp.headers):
        data = resp.get_data()
        if len(data) > 2048:
            resp.set_data(gzip.compress(data, 6))
            resp.headers["Content-Encoding"] = "gzip"
            resp.headers["Vary"] = "Accept-Encoding"
    return resp


_fails: dict[str, list[float]] = defaultdict(list)


@app.post("/api/login")
def login():
    ip = request.remote_addr or "?"
    t = time.time()
    _fails[ip] = [x for x in _fails[ip] if t - x < 300]
    if len(_fails[ip]) >= 8:
        return err("Demasiados intentos. Espera unos minutos y vuelve a probar.", 429)
    body = request.get_json(silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE username=?", ((body.get("username") or "").strip(),)).fetchone()
    if not u or not u["active"] or not check_password_hash(u["pwd"], body.get("password") or ""):
        _fails[ip].append(t)
        return err("Usuario o contraseña incorrectos", 401)
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    return jsonify(user_json(u))


def user_json(u):
    return {"id": u["id"], "username": u["username"], "name": u["name"], "role": u["role"], "must_change": bool(u["must_change"])}


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@need(temp_ok=True)
def me():
    return jsonify({**user_json(g.user), "config": get_config()})


@app.post("/api/me/password")
@need(temp_ok=True)
def change_password():
    b = request.get_json(silent=True) or {}
    u = db().execute("SELECT pwd FROM users WHERE id=?", (g.user["id"],)).fetchone()
    if not check_password_hash(u["pwd"], b.get("current") or ""):
        return err("La contraseña actual no es correcta")
    new = b.get("new") or ""
    if len(new) < 8:
        return err("La nueva contraseña debe tener al menos 8 caracteres")
    db().execute("UPDATE users SET pwd=?, must_change=0 WHERE id=?", (generate_password_hash(new), g.user["id"]))
    db().commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- datos
def _load_row(load_id=None):
    # Hay una carga por fecha de datos; la vigente es la de fecha más reciente
    q = "SELECT * FROM loads WHERE id=?" if load_id else "SELECT * FROM loads ORDER BY hoy DESC, id DESC LIMIT 1"
    return db().execute(q, (load_id,) if load_id else ()).fetchone()


@app.get("/api/dataset")
@need()
def dataset():
    row = _load_row(request.args.get("load", type=int))
    if not row:
        return jsonify({"empty": True})
    ds = json.loads(zlib.decompress(row["data"]))
    _con_sx(ds["refs"])
    ds["alias"] = _alias()
    by = db().execute("SELECT name FROM users WHERE id=?", (row["user_id"],)).fetchone()
    ds["load"] = {"id": row["id"], "created": row["created"], "by": by["name"] if by else "", "filename": row["filename"]}
    prev = db().execute("SELECT id,created,hoy,data FROM loads WHERE hoy<? ORDER BY hoy DESC, id DESC LIMIT 1", (row["hoy"],)).fetchone()
    ds["prev"] = None
    if prev:
        # Se recalcula con el horizonte actual y los tres escenarios, para comparar con lo que ve el usuario
        refs = _con_sx(json.loads(zlib.decompress(prev["data"]))["refs"])
        cfg = get_config()
        hz, exc = cfg.get("horizonte", 3), cfg["exceso"]
        ds["prev"] = {"id": prev["id"], "created": prev["created"], "hoy": prev["hoy"],
                      "sem": {e + ("_C" if p == "C" else ""): {r["k"]: core.evaluate(r, hz, e, p, exc)["sem"] for r in refs}
                              for e in ESCENARIOS for p in ("T", "C")}}
    return jsonify(ds)


@app.get("/api/loads")
@need()
def loads():
    rows = db().execute("SELECT l.id,l.created,l.filename,l.version,l.hoy,l.n,l.counts,u.name AS by FROM loads l "
                        "LEFT JOIN users u ON u.id=l.user_id ORDER BY l.hoy DESC, l.id DESC").fetchall()
    return jsonify([{**dict(r), "counts": json.loads(r["counts"])} for r in rows])


@app.post("/api/upload")
@need("admin")
def upload():
    f = request.files.get("file")
    if not f or not f.filename.lower().endswith((".xlsx", ".xlsm")):
        return err("Sube el MM_Supply en formato Excel (.xlsx)")
    try:
        hoy = dt.date.fromisoformat(request.form.get("fecha") or today().isoformat())
    except ValueError:
        return err("La fecha de los datos no es válida")
    dry = request.form.get("dry") == "1"
    # Altas y bajas del porfolio frente a la última carga de una fecha anterior (la del mismo día se sustituye)
    last = db().execute("SELECT data FROM loads WHERE hoy<? ORDER BY hoy DESC, id DESC LIMIT 1", (hoy.isoformat(),)).fetchone()
    prev = {r["k"]: r["n"] for r in json.loads(zlib.decompress(last["data"]))["refs"]} if last else None
    mismo = db().execute("SELECT created FROM loads WHERE hoy=? ORDER BY id DESC LIMIT 1", (hoy.isoformat(),)).fetchone()
    cfg = get_config()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        f.save(tmp.name)
        path = tmp.name
    try:
        ds = core.parse(core.read_workbook(path), hoy, prev, cfg["abc"]["cortes"])
    except core.DataError as e:
        return err(str(e))
    except Exception as e:  # fichero corrupto u otro formato
        return err("No se ha podido leer el fichero: " + str(e)[:200])
    finally:
        os.unlink(path)
    sem = {r["k"]: core.evaluate(r, cfg.get("horizonte", 3), "ALL", "T", cfg["exceso"])["sem"] for r in _con_sx(json.loads(json.dumps(ds["refs"])))}
    counts = defaultdict(int)
    for s in sem.values():
        counts[s] += 1
    summary = {"version": ds["meta"]["version"], "hoy": ds["meta"]["hoy"], "n": ds["meta"]["n"], "counts": counts, "warn": ds["meta"]["warn"]}
    cb = ds["porfolio"]["cambios"]
    if cb is not None:
        summary["cambios"] = {"entran": len(cb["entran"]), "salen": len(cb["salen"])}
    if mismo:
        summary["sustituye"] = mismo["created"]
    if dry:
        return jsonify({"preview": summary})
    blob = zlib.compress(json.dumps(ds, separators=(",", ":")).encode(), 6)
    db().execute("DELETE FROM loads WHERE hoy=?", (ds["meta"]["hoy"],))  # una carga por fecha de datos
    cur = db().execute("INSERT INTO loads(created,user_id,filename,version,base,hoy,n,counts,sem,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (now(), g.user["id"], f.filename, ds["meta"]["version"], ds["meta"]["base"], ds["meta"]["hoy"], ds["meta"]["n"],
                        json.dumps(counts), json.dumps(sem), blob))
    db().execute("DELETE FROM loads WHERE id NOT IN (SELECT id FROM loads ORDER BY hoy DESC, id DESC LIMIT ?)", (KEEP_LOADS,))
    # Decisiones de parámetros que la carga nueva ya trae en el ERP: aplicadas
    erp = {r["k"]: (r["mn"], r["lt"]) for r in ds["refs"]}
    for d in _decisiones().values():
        if not d["aplicado"] and erp.get(d["ref"]) == (d["ss"], d["lote"]):
            db().execute("UPDATE param_dec SET aplicado=? WHERE id=?", (ds["meta"]["hoy"], d["id"]))
    db().commit()
    return jsonify({"ok": True, "id": cur.lastrowid, "summary": summary})


@app.route("/api/config", methods=["GET", "PUT"])
@need()
def config():
    if request.method == "GET":
        return jsonify(get_config())
    if g.user["role"] != "admin":
        return err("Solo un administrador puede cambiar los criterios", 403)
    b = request.get_json(silent=True) or {}
    if not any(k in b for k in ("horizonte", "abc", "exceso", "ns")):
        return err("No hay nada que guardar")
    save = {}
    if "horizonte" in b:
        hz = b["horizonte"]
        if not isinstance(hz, int) or not 1 <= hz <= 6:
            return err("El horizonte debe estar entre 1 y 6 meses")
        save["horizonte"] = hz
    if "abc" in b:
        problema = abc_invalido(b["abc"])
        if problema:
            return err(problema)
        save["abc"] = {k: b["abc"][k] for k in ("cortes", "freq", "ss")}
    if "exceso" in b:
        ex = b["exceso"]
        ok = isinstance(ex, dict) and all(isinstance(ex.get(md), int) and not isinstance(ex.get(md), bool) and 1 <= ex[md] <= 12 for md in ("Belloch", "Yunsey"))
        if not ok:
            return err("Los meses de exceso deben ser números enteros entre 1 y 12 para Belloch y Yunsey")
        save["exceso"] = {md: ex[md] for md in ("Belloch", "Yunsey")}
    if "ns" in b:
        ns = b["ns"]
        num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)  # noqa: E731
        if not (isinstance(ns, dict) and all(isinstance(ns.get(md), list) and len(ns[md]) == 4 and all(num(x) and 50 <= x <= 99.9 for x in ns[md])
                                             for md in ("Belloch", "Yunsey"))):
            return err("Los niveles de servicio deben ser cuatro porcentajes entre 50 y 99,9 para Belloch y Yunsey")
        save["ns"] = {md: ns[md] for md in ("Belloch", "Yunsey")}
    antes = get_config()["abc"]["cortes"]
    for k, v in save.items():
        db().execute("INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, json.dumps(v)))
    if "abc" in save and save["abc"]["cortes"] != antes:  # el ABC de la carga vigente se recalcula con los cortes nuevos
        row = _load_row()
        if row:
            ds = core.recalcular(json.loads(zlib.decompress(row["data"])), save["abc"]["cortes"])
            db().execute("UPDATE loads SET data=? WHERE id=?", (zlib.compress(json.dumps(ds, separators=(",", ":")).encode(), 6), row["id"]))
    db().commit()
    return jsonify(get_config())


def abc_invalido(a) -> str:
    """Devuelve el problema de unos parámetros del ABC, o "" si son válidos."""
    num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)  # noqa: E731
    if not isinstance(a, dict):
        return "Parámetros del ABC no válidos"
    c = a.get("cortes")
    if not (isinstance(c, list) and len(c) == 3 and all(isinstance(x, int) and 1 <= x <= 99 for x in c) and c[0] < c[1] < c[2]):
        return "Los cortes del ABC deben ser tres porcentajes crecientes entre 1 y 99 (por ejemplo 45, 80 y 95)"
    for clave, nombre, lo, hi in (("freq", "La frecuencia de fabricación", 0, 365), ("ss", "El % de SS", -1, 300)):
        d = a.get(clave)
        for md in ("Belloch", "Yunsey"):
            v = d.get(md) if isinstance(d, dict) else None
            if not (isinstance(v, list) and len(v) == 4 and all(num(x) and lo < x <= hi for x in v)):
                return f"{nombre} de {md} debe tener un valor por clase (A, B, C y D) entre {lo + 1} y {hi}"
    return ""


# ---------------------------------------------------------------- parámetros
def _refs(row) -> list[dict]:
    return json.loads(zlib.decompress(row["data"]))["refs"]


def _decisiones() -> dict:
    """Decisión vigente (la última) de cada referencia."""
    q = "SELECT d.* FROM param_dec d JOIN (SELECT ref, MAX(id) AS id FROM param_dec GROUP BY ref) u ON u.id=d.id"
    return {r["ref"]: dict(r) for r in db().execute(q)}


def _param_rows(refs: list[dict]) -> list[dict]:
    cfg = get_config()
    extra = {r["ref"]: r["dias"] for r in db().execute("SELECT ref,dias FROM param_extra")}
    return parametros.parametros(refs, cfg["abc"]["freq"], cfg["abc"]["ss"], cfg["ns"], _decisiones(), extra)


def _con_sx(refs: list[dict]) -> list[dict]:
    """Añade a cada referencia su stock máximo (decidido o del ERP) para el criterio de exceso."""
    sx = {p["k"]: p["smax"] for p in _param_rows(refs)}
    for r in refs:
        r["sx"] = sx.get(r["k"])
    return refs


@app.get("/api/parametros")
@need()
def param_list():
    row = _load_row()
    if not row:
        return jsonify({"empty": True})
    k, refs = request.args.get("ref"), _refs(row)
    if k:  # ficha: solo esa referencia (el cálculo es por referencia)
        return jsonify({"rows": _param_rows([r for r in refs if r["k"] == k]), "hoy": row["hoy"]})
    rows = _param_rows(refs)
    return jsonify({"rows": rows, "resumen": parametros.resumen(rows), "hoy": row["hoy"]})


SRC_SS, SRC_LOTE = {"erp": "mn", "excel": "xl", "estadistico": "est", "manual": None}, {"erp": "lt", "calculado": "lc", "manual": None}


@app.post("/api/parametros/decisiones")
@need("admin", "planificador")
def param_decidir():
    b = request.get_json(silent=True) or {}
    items, motivo = b.get("items"), (b.get("motivo") or "").strip()[:500]
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        return err("Indica entre 1 y 1.000 referencias")
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    P = {p["k"]: p for p in _param_rows(_refs(row))}
    ins = []
    for it in items:
        p = P.get(it.get("ref")) if isinstance(it, dict) else None
        if not p:
            return err("Alguna referencia no está entre los productos contra stock con ABC de la carga vigente")
        vals = []
        for key, SRC in (("ss", SRC_SS), ("lote", SRC_LOTE)):
            x = it.get(key) if isinstance(it.get(key), dict) else {}
            src = x.get("src")
            if src not in SRC:
                return err("Fuente no válida")
            if src == "manual":
                v = x.get("v")
                if not (isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100_000_000):
                    return err("Los valores manuales deben ser números enteros, cero o mayores")
                if not motivo:
                    return err("Indica el motivo de los valores manuales")
            else:
                v = p[SRC[src]]
                if v is None:
                    return err(f"{p['k']}: el método estadístico no da cifra (irregular o sin historia)")
            vals.append((src, int(v)))
        (sss, ss), (srl, lote) = vals
        aplicado = row["hoy"] if (ss, lote) == (p["mn"], p["lt"]) else None  # mantener el ERP: ya está aplicado
        ins.append((p["k"], p["md"], ss, lote, sss, srl, p["mn"], p["lt"], motivo, g.user["id"], now(), aplicado))
    db().executemany("INSERT INTO param_dec(ref,md,ss,lote,src_ss,src_lote,ss_antes,lote_antes,motivo,user_id,created,aplicado) "
                     "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ins)
    db().commit()
    return jsonify({"ok": True, "n": len(ins)})


@app.get("/api/parametros/<ref>/historial")
@need()
def param_historial(ref):
    if not REF_RE.fullmatch(ref):
        return err("La referencia no es válida")
    q = ("SELECT d.ss,d.lote,d.src_ss,d.src_lote,d.ss_antes,d.lote_antes,d.motivo,d.created,d.aplicado,u.name AS by "
         "FROM param_dec d LEFT JOIN users u ON u.id=d.user_id WHERE d.ref=? ORDER BY d.id DESC")
    return jsonify([dict(r) for r in db().execute(q, (ref,))])


@app.put("/api/parametros/<ref>/plazo")
@need("admin", "planificador")
def param_plazo(ref):
    b = request.get_json(silent=True) or {}
    dias = b.get("dias")
    if not REF_RE.fullmatch(ref) or not (isinstance(dias, int) and not isinstance(dias, bool) and 0 <= dias <= 250):
        return err("El plazo extra debe ser un número entero de días laborables entre 0 y 250")
    row = _load_row()
    if not row or ref not in {p["k"] for p in _param_rows(_refs(row))}:
        return err("La referencia no está entre los productos contra stock con ABC de la carga vigente")
    db().execute("INSERT INTO param_extra(ref,dias,motivo,user_id,created) VALUES(?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET "
                 "dias=excluded.dias, motivo=excluded.motivo, user_id=excluded.user_id, created=excluded.created",
                 (ref, dias, (b.get("motivo") or "").strip()[:500], g.user["id"], now()))
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/parametros/abas.csv")
@need()
def param_csv():
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    rows = [p for p in _param_rows(_refs(row)) if p["estado"] == "decidido"]
    txt = "Referencia;Mandante;Stock mínimo;Lote\r\n" + "".join(f'{p["k"]};{p["md"]};{p["ss"]};{p["lote"]}\r\n' for p in rows)
    nombre = f'parametros_abas_{today():%Y%m%d}.csv'
    return Response(txt.encode("latin-1"), mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


# ---------------------------------------------------------------- desviación de previsiones
def _acuerdos(version: str) -> dict:
    """Acuerdo vigente (el último) de cada referencia para la versión de previsión dada."""
    q = ("SELECT d.* FROM prev_dec d JOIN (SELECT ref, MAX(id) AS id FROM prev_dec WHERE version=? GROUP BY ref) u "
         "ON u.id=d.id")
    return {r["ref"]: dict(r) for r in db().execute(q, (version,))}


def _desv(row, ref: str = "") -> tuple[dict, list[dict]]:
    ds = json.loads(zlib.decompress(row["data"]))
    refs = [r for r in ds["refs"] if r["k"] == ref] if ref else ds["refs"]
    return ds, desviacion.filas(refs, _acuerdos(ds["meta"]["version"]))


@app.get("/api/desviacion")
@need()
def desv_list():
    row = _load_row()
    if not row:
        return jsonify({"empty": True})
    k = request.args.get("ref", "")
    ds, rows = _desv(row, k)  # con ?ref (ficha) solo esa referencia, sin resumen por marca
    return jsonify({"version": ds["meta"]["version"], "base": ds["meta"]["base"], "rows": rows,
                    "marcas": None if k else desviacion.resumen_marcas(rows, ds["refs"]), "vers": ds["meta"].get("vers")})


@app.post("/api/desviacion/acuerdos")
@need("admin", "planificador")
def desv_acordar():
    b = request.get_json(silent=True) or {}
    items, motivo = b.get("items"), (b.get("motivo") or "").strip()[:500]
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        return err("Indica entre 1 y 1.000 referencias")
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    ds, rows = _desv(row)
    P = {p["k"]: p for p in rows}
    ins = []
    for it in items:
        p = P.get(it.get("ref")) if isinstance(it, dict) else None
        if not p:
            return err("Alguna referencia no está entre los productos contra stock con ABC de la carga vigente")
        src = it.get("src")
        if src == "propuesta":
            if p["cp"] is None:
                return err(f"{p['k']}: no tiene corrección propuesta (los métodos no coinciden o no hay datos)")
            pct = p["cp"]
        elif src == "mantener":
            pct = 0.0
        elif src == "manual":
            v = it.get("pct")
            if not (isinstance(v, (int, float)) and not isinstance(v, bool) and -90 <= v <= 300):
                return err("La corrección manual debe ser un porcentaje entre −90 y 300")
            if not motivo:
                return err("Indica el motivo de las correcciones manuales")
            pct = round(v / 100, 4)
        else:
            return err("Fuente no válida")
        ins.append((p["k"], p["md"], ds["meta"]["version"], pct, src, motivo, g.user["id"], now()))
    db().executemany("INSERT INTO prev_dec(ref,md,version,pct,src,motivo,user_id,created) VALUES(?,?,?,?,?,?,?,?)", ins)
    db().commit()
    return jsonify({"ok": True, "n": len(ins)})


@app.get("/api/desviacion/<ref>/historial")
@need()
def desv_historial(ref):
    if not REF_RE.fullmatch(ref):
        return err("La referencia no es válida")
    q = ("SELECT d.version,d.pct,d.src,d.motivo,d.created,u.name AS by FROM prev_dec d LEFT JOIN users u ON u.id=d.user_id "
         "WHERE d.ref=? ORDER BY d.id DESC")
    return jsonify([dict(r) for r in db().execute(q, (ref,))])


@app.get("/api/desviacion/acuerdos.csv")
@need()
def desv_csv():
    row = _load_row()
    if not row:
        return err("No hay datos cargados")
    ds, rows = _desv(row)
    y, m = map(int, ds["meta"]["base"].split("-"))
    meses = [f"{(m - 1 + i) % 12 + 1:02d}/{(y + (m - 1 + i) // 12) % 100:02d}" for i in range(12)]
    limpio = lambda s: " ".join((s or "").replace(";", ",").split())  # noqa: E731
    pct = lambda x: ("%g" % round(x * 100, 1)).replace(".", ",")  # noqa: E731
    lineas = ["Referencia;Mandante;Marca;Versión;Corrección %;Motivo;" + ";".join(meses)]
    for p in rows:
        if p["estado"] == "acordado":
            lineas.append(";".join([p["k"], p["md"], limpio(p["mc"]), ds["meta"]["version"], pct(p["ca"]), limpio(p["mo"])] + [str(x) for x in p["pvc"]]))
    txt = "\r\n".join(lineas) + "\r\n"
    nombre = f'acuerdos_prevision_{ds["meta"]["version"]}_{today():%Y%m%d}.csv'
    return Response(txt.encode("latin-1", errors="replace"), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


# ---------------------------------------------------------------- nombres de las líneas
def _alias() -> dict:
    """Nombre corto de cada grupo de máquinas ("piedra Rosetta"); sin nombre, se muestra el código."""
    return {r["codigo"]: r["nombre"] for r in db().execute("SELECT codigo,nombre FROM linea_alias")}


@app.route("/api/lineas", methods=["GET", "PUT"])
@need()
def lineas():
    row = _load_row()
    if not row:
        return jsonify([]) if request.method == "GET" else err("No hay datos cargados")
    ds = json.loads(zlib.decompress(row["data"]))
    n: dict[str, int] = defaultdict(int)
    for r in ds["refs"]:
        if r.get("ln"):
            n[r["ln"]] += 1
    if request.method == "PUT":
        if g.user["role"] not in ("admin", "planificador"):
            return err("Tu usuario no tiene permiso para esta acción", 403)
        nombres = (request.get_json(silent=True) or {}).get("nombres")
        if not isinstance(nombres, dict) or not nombres:
            return err("No hay nombres que guardar")
        for cod, nom in nombres.items():
            if cod not in n:
                return err(f"La línea {cod} no está en la carga vigente")
            if not isinstance(nom, str) or len(nom.strip()) > 40:
                return err("Los nombres cortos deben tener como mucho 40 caracteres")
        for cod, nom in nombres.items():
            nom = " ".join(nom.split())
            if not nom or nom == cod:  # vacío o igual al código: vuelve al código
                db().execute("DELETE FROM linea_alias WHERE codigo=?", (cod,))
            else:
                db().execute("INSERT INTO linea_alias(codigo,nombre,user_id,updated) VALUES(?,?,?,?) ON CONFLICT(codigo) DO UPDATE SET "
                             "nombre=excluded.nombre, user_id=excluded.user_id, updated=excluded.updated", (cod, nom, g.user["id"], now()))
        db().commit()
    al, abas = _alias(), ds["meta"].get("lineas") or {}
    return jsonify([{"codigo": k, "abas": abas.get(k, ""), "n": n[k], "nombre": al.get(k, k)} for k in sorted(n)])


# ---------------------------------------------------------------- notas y acciones
@app.route("/api/notes/<ref>", methods=["GET", "POST"])
@need()
def notes(ref):
    if not REF_RE.fullmatch(ref):
        return err("La referencia no es válida")
    if request.method == "POST":
        if g.user["role"] == "lector":
            return err("Tu usuario es de solo lectura", 403)
        t = ((request.get_json(silent=True) or {}).get("text") or "").strip()
        if not t:
            return err("La nota está vacía")
        db().execute("INSERT INTO notes(ref,user_id,text,created) VALUES(?,?,?,?)", (ref, g.user["id"], t[:4000], now()))
        db().commit()
    rows = db().execute("SELECT n.id,n.text,n.created,u.name AS by FROM notes n JOIN users u ON u.id=n.user_id WHERE n.ref=? ORDER BY n.id DESC", (ref,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/notes-index")
@need()
def notes_index():
    return jsonify({r["ref"]: r["n"] for r in db().execute("SELECT ref, COUNT(*) AS n FROM notes GROUP BY ref")})


def valid_date(v) -> bool:
    if v is None:
        return True
    try:
        dt.date.fromisoformat(v)
        return True
    except (TypeError, ValueError):
        return False


ACTION_SQL = ("SELECT a.*, u.name AS created_by_name FROM actions a JOIN users u ON u.id=a.created_by ")


@app.route("/api/actions", methods=["GET", "POST"])
@need()
def actions():
    if request.method == "POST":
        if g.user["role"] == "lector":
            return err("Tu usuario es de solo lectura", 403)
        b = request.get_json(silent=True) or {}
        ref, text = (b.get("ref") or "").strip(), (b.get("text") or "").strip()
        if not ref or not text:
            return err("Indica la referencia y la acción")
        if not REF_RE.fullmatch(ref):
            return err("La referencia no es válida")
        due = b.get("due") or None
        if not valid_date(due):
            return err("La fecha límite no es válida")
        last = _load_row()
        db().execute("INSERT INTO actions(ref,text,owner,due,created_by,created,updated,load_id) VALUES(?,?,?,?,?,?,?,?)",
                     (ref, text[:2000], (b.get("owner") or "").strip()[:120], due, g.user["id"], now(), now(), last["id"] if last else None))
        db().commit()
    q, args = ACTION_SQL, []
    if request.args.get("ref"):
        q += "WHERE a.ref=? "
        args.append(request.args["ref"])
    elif request.args.get("status"):
        q += "WHERE a.status=? "
        args.append(request.args["status"])
    q += "ORDER BY CASE a.status WHEN 'abierta' THEN 0 ELSE 1 END, COALESCE(a.due,'9999'), a.id DESC"
    return jsonify([dict(r) for r in db().execute(q, args)])


@app.patch("/api/actions/<int:aid>")
@need("admin", "planificador")
def action_update(aid):
    b = request.get_json(silent=True) or {}
    a = db().execute("SELECT * FROM actions WHERE id=?", (aid,)).fetchone()
    if not a:
        return err("La acción no existe", 404)
    status = b.get("status", a["status"])
    if status not in ("abierta", "hecha", "descartada"):
        return err("Estado no válido")
    due = b.get("due", a["due"]) or None
    if not valid_date(due):
        return err("La fecha límite no es válida")
    db().execute("UPDATE actions SET status=?, text=?, owner=?, due=?, updated=? WHERE id=?",
                 (status, (b.get("text") or a["text"])[:2000], (b.get("owner", a["owner"]) or "")[:120], due, now(), aid))
    db().commit()
    return jsonify(dict(db().execute(ACTION_SQL + "WHERE a.id=?", (aid,)).fetchone()))


# ---------------------------------------------------------------- usuarios
@app.route("/api/users", methods=["GET", "POST"])
@need("admin")
def users():
    if request.method == "POST":
        b = request.get_json(silent=True) or {}
        un, name, role = (b.get("username") or "").strip(), (b.get("name") or "").strip(), b.get("role")
        if not un or not name or role not in ROLES:
            return err("Indica usuario, nombre y rol")
        if db().execute("SELECT 1 FROM users WHERE username=?", (un,)).fetchone():
            return err("Ya existe un usuario con ese nombre")
        pwd = secrets.token_urlsafe(8)
        db().execute("INSERT INTO users(username,name,pwd,role,must_change,created) VALUES(?,?,?,?,1,?)",
                     (un, name, generate_password_hash(pwd), role, now()))
        db().commit()
        return jsonify({"ok": True, "password": pwd})
    rows = db().execute("SELECT id,username,name,role,active,created FROM users ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.patch("/api/users/<int:uid>")
@need("admin")
def user_update(uid):
    b = request.get_json(silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        return err("El usuario no existe", 404)
    role, active = b.get("role", u["role"]), int(bool(b.get("active", u["active"])))
    if role not in ROLES:
        return err("Rol no válido")
    if uid == g.user["id"] and (role != "admin" or not active):
        return err("No puedes quitarte a ti mismo el rol de administrador ni desactivarte")
    out = {"ok": True}
    db().execute("UPDATE users SET role=?, active=?, name=? WHERE id=?", (role, active, (b.get("name") or u["name"]).strip(), uid))
    if b.get("reset"):
        pwd = secrets.token_urlsafe(8)
        db().execute("UPDATE users SET pwd=?, must_change=1 WHERE id=?", (generate_password_hash(pwd), uid))
        out["password"] = pwd
    db().commit()
    return jsonify(out)


# ---------------------------------------------------------------- estáticos
@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/static/<path:p>")
def static_files(p):
    return send_from_directory(STATIC, p)


@app.get("/health")
def health():
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    # En local se recarga sola al cambiar el código (RELOAD=0 para desactivarlo); en Docker se usa gunicorn
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=os.environ.get("DEBUG") == "1",
            use_reloader=os.environ.get("RELOAD", "1") == "1")
