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

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

import core

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
    cfg = {"horizonte": 3}
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
    q = "SELECT * FROM loads WHERE id=?" if load_id else "SELECT * FROM loads ORDER BY id DESC LIMIT 1"
    return db().execute(q, (load_id,) if load_id else ()).fetchone()


@app.get("/api/dataset")
@need()
def dataset():
    row = _load_row(request.args.get("load", type=int))
    if not row:
        return jsonify({"empty": True})
    ds = json.loads(zlib.decompress(row["data"]))
    by = db().execute("SELECT name FROM users WHERE id=?", (row["user_id"],)).fetchone()
    ds["load"] = {"id": row["id"], "created": row["created"], "by": by["name"] if by else "", "filename": row["filename"]}
    prev = db().execute("SELECT id,created,data FROM loads WHERE id<? ORDER BY id DESC LIMIT 1", (row["id"],)).fetchone()
    ds["prev"] = None
    if prev:
        # Se recalcula con el horizonte actual y los tres escenarios, para comparar con lo que ve el usuario
        refs = json.loads(zlib.decompress(prev["data"]))["refs"]
        hz = get_config().get("horizonte", 3)
        ds["prev"] = {"id": prev["id"], "created": prev["created"],
                      "sem": {e + ("_C" if p == "C" else ""): {r["k"]: core.evaluate(r, hz, e, p)["sem"] for r in refs}
                              for e in ESCENARIOS for p in ("T", "C")}}
    return jsonify(ds)


@app.get("/api/loads")
@need()
def loads():
    rows = db().execute("SELECT l.id,l.created,l.filename,l.version,l.hoy,l.n,l.counts,u.name AS by FROM loads l "
                        "LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC").fetchall()
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
    last = _load_row()  # carga anterior, para las altas y bajas del porfolio
    prev = {r["k"]: r["n"] for r in json.loads(zlib.decompress(last["data"]))["refs"]} if last else None
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        f.save(tmp.name)
        path = tmp.name
    try:
        ds = core.parse(core.read_workbook(path), hoy, prev)
    except core.DataError as e:
        return err(str(e))
    except Exception as e:  # fichero corrupto u otro formato
        return err("No se ha podido leer el fichero: " + str(e)[:200])
    finally:
        os.unlink(path)
    hz = get_config().get("horizonte", 3)
    sem = {r["k"]: core.evaluate(r, hz, "ALL")["sem"] for r in ds["refs"]}
    counts = defaultdict(int)
    for s in sem.values():
        counts[s] += 1
    summary = {"version": ds["meta"]["version"], "hoy": ds["meta"]["hoy"], "n": ds["meta"]["n"], "counts": counts, "warn": ds["meta"]["warn"]}
    cb = ds["porfolio"]["cambios"]
    if cb is not None:
        summary["cambios"] = {"entran": len(cb["entran"]), "salen": len(cb["salen"])}
    if dry:
        return jsonify({"preview": summary})
    blob = zlib.compress(json.dumps(ds, separators=(",", ":")).encode(), 6)
    cur = db().execute("INSERT INTO loads(created,user_id,filename,version,base,hoy,n,counts,sem,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (now(), g.user["id"], f.filename, ds["meta"]["version"], ds["meta"]["base"], ds["meta"]["hoy"], ds["meta"]["n"],
                        json.dumps(counts), json.dumps(sem), blob))
    db().execute("DELETE FROM loads WHERE id NOT IN (SELECT id FROM loads ORDER BY id DESC LIMIT ?)", (KEEP_LOADS,))
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
    hz = b.get("horizonte")
    if not isinstance(hz, int) or not 1 <= hz <= 6:
        return err("El horizonte debe estar entre 1 y 6 meses")
    db().execute("INSERT INTO config(key,value) VALUES('horizonte',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(hz),))
    db().commit()
    return jsonify(get_config())


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
