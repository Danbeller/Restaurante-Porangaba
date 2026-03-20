#!/usr/bin/env python3
"""
server.py — Servidor backend com banco de dados SQLite (local) ou PostgreSQL (produção)
Inclui: usuários, sessões, catálogo, pedidos, status
Uso: python3 server.py  →  http://localhost:8080

Em produção (Railway), define DATABASE_URL e PORT automaticamente.
"""

import hashlib, json, os, time, secrets, random
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT     = int(os.environ.get("PORT", 8080))
DB_URL   = os.environ.get("DATABASE_URL", "")   # vazio → usa SQLite local
DB_FILE  = "database.db"                         # usado só no modo SQLite

# ── detecta qual driver usar ──
USE_PG = bool(DB_URL)

if USE_PG:
    import psycopg2
    import psycopg2.extras
else:
    import sqlite3

DEFAULT_CATALOG = [
    {"name": "X-Burguer Clássico",       "desc": "Pão brioche, carne 180g, queijo, alface, tomate",  "price": 2490, "category": "Lanches",    "emoji": "🍔", "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80"},
    {"name": "X-Bacon Duplo",            "desc": "Dois burgers, bacon crocante, molho especial",      "price": 3490, "category": "Lanches",    "emoji": "🥓", "image": "https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600&q=80"},
    {"name": "Frango Grelhado",           "desc": "Filé de frango, maionese de ervas, salada",         "price": 2290, "category": "Lanches",    "emoji": "🐔", "image": "https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=600&q=80"},
    {"name": "Pizza Margherita",          "desc": "Molho de tomate, mussarela, manjericão",            "price": 3990, "category": "Pizzas",     "emoji": "🍕", "image": "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600&q=80"},
    {"name": "Pizza Calabresa",           "desc": "Calabresa fatiada, cebola, azeitonas, mussarela",   "price": 4290, "category": "Pizzas",     "emoji": "🍕", "image": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80"},
    {"name": "Pizza Frango c/ Catupiry",  "desc": "Frango desfiado, requeijão, catupiry cremoso",      "price": 4590, "category": "Pizzas",     "emoji": "🍕", "image": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80"},
    {"name": "Batata Frita P",            "desc": "Porção pequena de batata frita crocante",           "price":  990, "category": "Porções",    "emoji": "🍟", "image": "https://images.unsplash.com/photo-1518013431117-eb1465fa5752?w=600&q=80"},
    {"name": "Batata Frita G",            "desc": "Porção grande de batata frita crocante",            "price": 1590, "category": "Porções",    "emoji": "🍟", "image": "https://images.unsplash.com/photo-1576107232684-1279f390859f?w=600&q=80"},
    {"name": "Onion Rings",               "desc": "Anéis de cebola empanados, molho ranch",            "price": 1890, "category": "Porções",    "emoji": "🧅", "image": "https://images.unsplash.com/photo-1639024471283-03518883512d?w=600&q=80"},
    {"name": "Refrigerante Lata",         "desc": "Coca, Guaraná ou Sprite 350ml",                     "price":  590, "category": "Bebidas",    "emoji": "🥤", "image": "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&q=80"},
    {"name": "Suco Natural 500ml",        "desc": "Laranja, Limão ou Maracujá",                        "price":  990, "category": "Bebidas",    "emoji": "🧃", "image": "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600&q=80"},
    {"name": "Milk-shake",                "desc": "Chocolate, Morango ou Baunilha 400ml",              "price": 1590, "category": "Bebidas",    "emoji": "🥛", "image": "https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600&q=80"},
    {"name": "Açaí 300ml",               "desc": "Açaí cremoso, granola, banana, leite condensado",   "price": 1890, "category": "Sobremesas", "emoji": "🫐", "image": "https://images.unsplash.com/photo-1590301157890-4810ed352733?w=600&q=80"},
    {"name": "Sorvete 2 Bolas",          "desc": "Escolha 2 sabores, calda de chocolate",             "price":  990, "category": "Sobremesas", "emoji": "🍦", "image": "https://images.unsplash.com/photo-1560008581-09826d1de69e?w=600&q=80"},
]

ORDER_STATUSES = ["pendente", "confirmado", "preparando", "pronto", "entregue", "cancelado"]

def _gen_delivery_token():
    return f"{random.randint(0, 9999):04d}"

# ================================================================
# CAMADA DE ABSTRAÇÃO DO BANCO
# Normaliza diferenças entre SQLite e PostgreSQL
# ================================================================

def db_connect():
    if USE_PG:
        # Railway injeta DATABASE_URL como postgres:// mas psycopg2 precisa de postgresql://
        url = DB_URL
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn
    else:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

def _ph(n=1):
    """Retorna placeholder correto: %s para PG, ? para SQLite."""
    return "%s" if USE_PG else "?"

def _placeholders(n):
    """Retorna n placeholders separados por vírgula."""
    ph = "%s" if USE_PG else "?"
    return ",".join([ph] * n)

def _exec(conn, sql, params=()):
    """Executa SQL normalizando placeholders."""
    if USE_PG:
        sql = sql.replace("?", "%s")
        # Converte AUTOINCREMENT para SERIAL (já tratado nas DDLs abaixo)
    c = conn.cursor()
    c.execute(sql, params)
    return c

def _fetchone(cursor):
    row = cursor.fetchone()
    if row is None:
        return None
    return dict(row)

def _fetchall(cursor):
    return [dict(r) for r in cursor.fetchall()]

def _lastrowid(conn, cursor, table=""):
    if USE_PG:
        c2 = conn.cursor()
        c2.execute(f"SELECT lastval()")
        return c2.fetchone()[0]
    return cursor.lastrowid

def _now_expr():
    """Expressão SQL para data/hora atual."""
    if USE_PG:
        return "NOW() AT TIME ZONE 'America/Sao_Paulo'"
    return "datetime('now','localtime')"

# ================================================================
# INIT / MIGRATIONS
# ================================================================

def db_init():
    conn = db_connect()

    if USE_PG:
        _init_pg(conn)
    else:
        _init_sqlite(conn)

    conn.commit()
    conn.close()
    print(f"[DB] Banco pronto ({'PostgreSQL' if USE_PG else 'SQLite'}).")

def _init_pg(conn):
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            phone      TEXT NOT NULL UNIQUE,
            password   TEXT NOT NULL,
            address    TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),
            last_login TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS admin (
            id       INTEGER PRIMARY KEY CHECK (id=1),
            username TEXT NOT NULL,
            password TEXT NOT NULL
        )
    """)
    c.execute("SELECT COUNT(*) FROM admin")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO admin VALUES (1,%s,%s)", ("danbeller088@gmail.com", _hash("admin123")))

    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            user_id    INTEGER,
            role       TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS catalog (
            id       SERIAL PRIMARY KEY,
            name     TEXT NOT NULL,
            desc     TEXT DEFAULT '',
            price    INTEGER NOT NULL,
            category TEXT NOT NULL,
            emoji    TEXT DEFAULT 'X',
            active   INTEGER DEFAULT 1,
            image    TEXT DEFAULT ''
        )
    """)
    # Migration PG: garante que a coluna image existe (para bancos antigos sem a coluna)
    c.execute("ALTER TABLE catalog ADD COLUMN IF NOT EXISTS image TEXT DEFAULT ''")
    conn.commit()

    c.execute("SELECT COUNT(*) FROM catalog")
    count = c.fetchone()[0]
    if count == 0:
        for item in DEFAULT_CATALOG:
            c.execute(
                "INSERT INTO catalog (name,desc,price,category,emoji,image) VALUES (%s,%s,%s,%s,%s,%s)",
                (item["name"], item["desc"], item["price"], item["category"], item["emoji"], item.get("image", ""))
            )
    else:
        # Popula image nos registros que ainda não têm (banco existia antes do campo image)
        for item in DEFAULT_CATALOG:
            if item.get("image"):
                c.execute(
                    "UPDATE catalog SET image=%s WHERE name=%s AND (image IS NULL OR image='')",
                    (item["image"], item["name"])
                )

    c.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id             SERIAL PRIMARY KEY,
            user_id        INTEGER NOT NULL,
            items_json     TEXT NOT NULL,
            total          INTEGER NOT NULL,
            address        TEXT NOT NULL,
            note           TEXT DEFAULT '',
            status         TEXT NOT NULL DEFAULT 'pendente',
            delivery_token TEXT NOT NULL DEFAULT '0000',
            entregador_id  INTEGER DEFAULT NULL,
            created_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),
            updated_at     TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS entregadores (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            phone      TEXT NOT NULL,
            email      TEXT DEFAULT '',
            address    TEXT DEFAULT '',
            cpf        TEXT DEFAULT '',
            fila_idx   INTEGER NOT NULL DEFAULT 0,
            online     INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')
        )
    """)
    conn.commit()

def _init_sqlite(conn):
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE, password TEXT NOT NULL, address TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), last_login TEXT)""")

    existing_cols = {row[1] for row in c.execute("PRAGMA table_info(users)").fetchall()}
    if "address"    not in existing_cols:
        c.execute("ALTER TABLE users ADD COLUMN address TEXT DEFAULT ''")
    if "last_login" not in existing_cols:
        c.execute("ALTER TABLE users ADD COLUMN last_login TEXT")

    c.execute("""CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK (id=1), username TEXT NOT NULL, password TEXT NOT NULL)""")
    c.execute("SELECT COUNT(*) FROM admin")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO admin VALUES (1,?,?)", ("danbeller088@gmail.com", _hash("admin123")))

    c.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id INTEGER, role TEXT NOT NULL, created_at INTEGER NOT NULL)""")

    c.execute("""CREATE TABLE IF NOT EXISTS catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, desc TEXT DEFAULT '',
        price INTEGER NOT NULL, category TEXT NOT NULL, emoji TEXT DEFAULT 'X', active INTEGER DEFAULT 1,
        image TEXT DEFAULT '')""")
    c.execute("SELECT COUNT(*) FROM catalog")
    if c.fetchone()[0] == 0:
        for item in DEFAULT_CATALOG:
            c.execute("INSERT INTO catalog (name,desc,price,category,emoji,image) VALUES (?,?,?,?,?,?)",
                      (item["name"], item["desc"], item["price"], item["category"], item["emoji"], item.get("image", "")))

    # Migration: adiciona coluna image se não existir e popula registros existentes
    cat_cols = {row[1] for row in c.execute("PRAGMA table_info(catalog)").fetchall()}
    if "image" not in cat_cols:
        c.execute("ALTER TABLE catalog ADD COLUMN image TEXT DEFAULT ''")

    # Popula image nos registros que ainda não têm (tanto após ALTER quanto nos inseridos sem image)
    _IMAGE_MAP = {item["name"]: item.get("image", "") for item in DEFAULT_CATALOG}
    for name, image_url in _IMAGE_MAP.items():
        if image_url:
            c.execute("UPDATE catalog SET image=? WHERE name=? AND (image IS NULL OR image='')", (image_url, name))

    c.execute("""CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        items_json TEXT NOT NULL, total INTEGER NOT NULL, address TEXT NOT NULL,
        note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente',
        delivery_token TEXT NOT NULL DEFAULT '0000',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(user_id) REFERENCES users(id))""")

    order_cols = {row[1] for row in c.execute("PRAGMA table_info(orders)").fetchall()}
    if "delivery_token" not in order_cols:
        c.execute("ALTER TABLE orders ADD COLUMN delivery_token TEXT NOT NULL DEFAULT '0000'")
        rows = c.execute("SELECT id FROM orders").fetchall()
        for row in rows:
            c.execute("UPDATE orders SET delivery_token=? WHERE id=?", (_gen_delivery_token(), row[0]))
    if "entregador_id" not in order_cols:
        c.execute("ALTER TABLE orders ADD COLUMN entregador_id INTEGER DEFAULT NULL")

    c.execute("""CREATE TABLE IF NOT EXISTS entregadores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        phone      TEXT NOT NULL,
        email      TEXT DEFAULT '',
        address    TEXT DEFAULT '',
        cpf        TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))""")

    ent_cols = {row[1] for row in c.execute("PRAGMA table_info(entregadores)").fetchall()}
    if "fila_idx" not in ent_cols:
        c.execute("ALTER TABLE entregadores ADD COLUMN fila_idx INTEGER NOT NULL DEFAULT 0")
    if "online" not in ent_cols:
        c.execute("ALTER TABLE entregadores ADD COLUMN online INTEGER DEFAULT 1")
        c.execute("UPDATE entregadores SET online=1 WHERE online IS NULL")

    conn.commit()

# ================================================================
# HELPERS
# ================================================================

def _hash(s): return hashlib.sha256(s.encode()).hexdigest()
def _token(): return secrets.token_hex(32)

def _session_create(user_id, role):
    t = _token()
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"INSERT INTO sessions VALUES ({ph},{ph},{ph},{ph})", (t, user_id, role, int(time.time())))
    conn.commit(); conn.close(); return t

def _session_get(token):
    if not token: return None
    conn = db_connect()
    ph = _ph()
    c = _exec(conn, f"SELECT * FROM sessions WHERE token={ph}", (token,))
    row = _fetchone(c)
    conn.close(); return row

def _session_del(token):
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"DELETE FROM sessions WHERE token={ph}", (token,))
    conn.commit(); conn.close()

def _cookies(header):
    out = {}
    for part in (header or "").split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1); out[k.strip()] = v.strip()
    return out

def _auth(h): return _session_get(_cookies(h.headers.get("Cookie","")).get("session"))

def _json(h, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode()
    h.send_response(status)
    h.send_header("Content-Type","application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.end_headers(); h.wfile.write(body)

def _json_cookie(h, data, token):
    body = json.dumps(data, ensure_ascii=False).encode()
    h.send_response(200)
    h.send_header("Content-Type","application/json; charset=utf-8")
    h.send_header("Set-Cookie", f"session={token}; Path=/; HttpOnly; SameSite=Lax")
    h.send_header("Content-Length", str(len(body))); h.end_headers(); h.wfile.write(body)

def _serve(h, fp):
    if not os.path.exists(fp): h.send_error(404); return
    mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"}.get(os.path.splitext(fp)[1],"application/octet-stream")
    with open(fp,"rb") as f: content = f.read()
    h.send_response(200); h.send_header("Content-Type",mime); h.send_header("Content-Length",str(len(content))); h.end_headers(); h.wfile.write(content)

# ================================================================
# AUTH
# ================================================================

def api_register(h, b):
    name,phone,password,address = b.get("name","").strip(),b.get("phone","").strip(),b.get("password",""),b.get("address","").strip()
    if not name or not phone or not password: return _json(h,{"ok":False,"message":"Preencha todos os campos."},400)
    if len(phone)<10: return _json(h,{"ok":False,"message":"Número inválido."},400)
    if len(password)<6: return _json(h,{"ok":False,"message":"Senha muito curta."},400)
    conn = db_connect()
    ph = _ph()
    try:
        _exec(conn, f"INSERT INTO users (name,phone,password,address) VALUES ({_placeholders(4)})", (name,phone,_hash(password),address))
        conn.commit()
        c2 = _exec(conn, f"SELECT * FROM users WHERE phone={ph}", (phone,))
        user = _fetchone(c2)
        token = _session_create(user["id"],"user"); conn.close()
        _json_cookie(h,{"ok":True,"message":"Conta criada!","user":{"name":user["name"],"phone":user["phone"]}},token)
    except Exception as e:
        conn.close()
        msg = str(e)
        if "unique" in msg.lower() or "duplicate" in msg.lower():
            _json(h,{"ok":False,"message":"Celular já cadastrado!"},409)
        else:
            _json(h,{"ok":False,"message":"Erro ao criar conta."},500)

def api_login(h, b):
    phone,password = b.get("phone","").strip(),b.get("password","")
    conn = db_connect()
    ph = _ph()
    c = _exec(conn, f"SELECT * FROM users WHERE phone={ph}", (phone,))
    user = _fetchone(c)
    if not user or user["password"]!=_hash(password):
        conn.close(); return _json(h,{"ok":False,"message":"Celular ou senha incorretos."},401)
    now_expr = _now_expr()
    if USE_PG:
        _exec(conn, f"UPDATE users SET last_login=to_char({now_expr},'YYYY-MM-DD HH24:MI:SS') WHERE id={ph}", (user["id"],))
    else:
        _exec(conn, f"UPDATE users SET last_login=({now_expr}) WHERE id={ph}", (user["id"],))
    conn.commit(); conn.close()
    _json_cookie(h,{"ok":True},_session_create(user["id"],"user"))

def api_admin_login(h, b):
    conn = db_connect()
    c = _exec(conn, "SELECT * FROM admin WHERE id=1")
    admin = _fetchone(c); conn.close()
    if not admin or admin["username"]!=b.get("email","") or admin["password"]!=_hash(b.get("password","")):
        return _json(h,{"ok":False,"message":"Credenciais inválidas."},401)
    _json_cookie(h,{"ok":True},_session_create(None,"admin"))

def api_logout(h):
    _session_del(_cookies(h.headers.get("Cookie","")).get("session",""))
    body = json.dumps({"ok":True}).encode()
    h.send_response(200); h.send_header("Content-Type","application/json; charset=utf-8")
    h.send_header("Set-Cookie","session=; Path=/; Max-Age=0"); h.send_header("Content-Length",str(len(body))); h.end_headers(); h.wfile.write(body)

def api_me(h):
    s = _auth(h)
    if not s: return _json(h,{"ok":False,"role":None})
    if s["role"]=="admin": return _json(h,{"ok":True,"role":"admin"})
    conn = db_connect()
    ph = _ph()
    c = _exec(conn, f"SELECT * FROM users WHERE id={ph}", (s["user_id"],))
    user = _fetchone(c); conn.close()
    if not user: return _json(h,{"ok":False,"role":None})
    _json(h,{"ok":True,"role":"user","user":{"id":user["id"],"name":user["name"],"phone":user["phone"],"address":user["address"] or "","created_at":user["created_at"],"last_login":user["last_login"] or "Primeiro acesso"}})

# ================================================================
# CATÁLOGO
# ================================================================

def api_catalog(h):
    conn = db_connect()
    c = _exec(conn, "SELECT * FROM catalog WHERE active=1 ORDER BY category,name")
    items = _fetchall(c); conn.close()
    _json(h,{"ok":True,"items":items})

def api_catalog_all(h):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    conn = db_connect()
    c = _exec(conn, "SELECT * FROM catalog ORDER BY category,name")
    items = _fetchall(c); conn.close()
    _json(h,{"ok":True,"items":items})

def api_catalog_add(h, b):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False,"message":"Acesso negado."},403)
    conn = db_connect()
    _exec(conn, f"INSERT INTO catalog (name,desc,price,category,emoji) VALUES ({_placeholders(5)})",
          (b.get("name"),b.get("desc",""),int(b.get("price",0)),b.get("category","Outros"),b.get("emoji","X")))
    conn.commit(); conn.close(); _json(h,{"ok":True})

def api_catalog_toggle(h, item_id):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    conn = db_connect()
    ph = _ph()
    if USE_PG:
        _exec(conn, f"UPDATE catalog SET active=CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id={ph}", (item_id,))
    else:
        _exec(conn, f"UPDATE catalog SET active=CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id={ph}", (item_id,))
    conn.commit(); conn.close(); _json(h,{"ok":True})

def api_catalog_update_price(h, item_id, b):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False,"message":"Acesso negado."},403)
    try:
        price = int(round(float(b.get("price",0)) * 100))
    except (ValueError, TypeError):
        return _json(h,{"ok":False,"message":"Valor invalido."},400)
    if price <= 0: return _json(h,{"ok":False,"message":"Valor deve ser maior que zero."},400)
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"UPDATE catalog SET price={ph} WHERE id={ph}", (price, item_id))
    conn.commit(); conn.close()
    _json(h,{"ok":True,"price":price})

def api_catalog_update_info(h, item_id, b):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False,"message":"Acesso negado."},403)
    name = b.get("name","").strip()
    desc = b.get("desc","").strip()
    if not name: return _json(h,{"ok":False,"message":"Nome não pode ficar vazio."},400)
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"UPDATE catalog SET name={ph},desc={ph} WHERE id={ph}", (name, desc, item_id))
    conn.commit(); conn.close()
    _json(h,{"ok":True,"name":name,"desc":desc})

# ================================================================
# PEDIDOS
# ================================================================

def api_order_create(h, b):
    s = _auth(h)
    if not s or s["role"]!="user": return _json(h,{"ok":False,"message":"Faça login primeiro."},401)
    items,address,note = b.get("items",[]),b.get("address","").strip(),b.get("note","").strip()
    if not items: return _json(h,{"ok":False,"message":"Carrinho vazio."},400)
    if not address: return _json(h,{"ok":False,"message":"Informe o endereço de entrega."},400)
    total = sum(i.get("price",0)*i.get("qty",1) for i in items)
    delivery_token = _gen_delivery_token()
    conn = db_connect()
    c = _exec(conn,
        f"INSERT INTO orders (user_id,items_json,total,address,note,delivery_token) VALUES ({_placeholders(6)})",
        (s["user_id"], json.dumps(items,ensure_ascii=False), total, address, note, delivery_token)
    )
    order_id = _lastrowid(conn, c, "orders")
    conn.commit(); conn.close()
    _json(h,{"ok":True,"order_id":order_id,"total":total,"delivery_token":delivery_token})

def api_orders_mine(h):
    s = _auth(h)
    if not s or s["role"]!="user": return _json(h,{"ok":False},401)
    conn = db_connect()
    ph = _ph()
    c = _exec(conn, f"SELECT * FROM orders WHERE user_id={ph} ORDER BY created_at DESC", (s["user_id"],))
    rows = _fetchall(c); conn.close()
    result = []
    for o in rows:
        o["items"] = json.loads(o["items_json"]); del o["items_json"]; result.append(o)
    _json(h,{"ok":True,"orders":result})

def api_orders_all(h):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    conn = db_connect()
    c = _exec(conn, """SELECT o.*,u.name as user_name,u.phone as user_phone
        FROM orders o JOIN users u ON o.user_id=u.id ORDER BY o.created_at DESC""")
    rows = _fetchall(c); conn.close()
    result = []
    for o in rows:
        o["items"] = json.loads(o["items_json"]); del o["items_json"]; result.append(o)
    _json(h,{"ok":True,"orders":result})

def api_order_status(h, order_id, b):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    new_status = b.get("status","")
    if new_status not in ORDER_STATUSES: return _json(h,{"ok":False,"message":"Status inválido."},400)

    conn = db_connect()
    ph = _ph()
    entregador = None

    if new_status == "pronto":
        try:
            c = _exec(conn, f"""SELECT * FROM entregadores
                WHERE COALESCE(online,1)=1
                AND NOT EXISTS (
                    SELECT 1 FROM orders
                    WHERE orders.entregador_id=entregadores.id
                    AND orders.status='pronto'
                )
                ORDER BY COALESCE(fila_idx,0) ASC, id ASC
                LIMIT 1""")
            ent = _fetchone(c)
            if not ent:
                conn.close()
                return _json(h, {"ok": False, "message": "Nenhum entregador disponível. Aguarde um entregador ficar livre."}, 409)
            entregador = ent
        except Exception as e:
            print(f"[ERRO] verificar entregador: {e}")
            conn.close()
            return _json(h, {"ok": False, "message": "Erro ao verificar entregadores."}, 500)

    now_expr = _now_expr()
    if USE_PG:
        _exec(conn, f"UPDATE orders SET status={ph},updated_at=to_char({now_expr},'YYYY-MM-DD HH24:MI:SS') WHERE id={ph}", (new_status, order_id))
    else:
        _exec(conn, f"UPDATE orders SET status={ph},updated_at=({now_expr}) WHERE id={ph}", (new_status, order_id))
    conn.commit()

    if new_status == "pronto" and entregador:
        try:
            _exec(conn, f"UPDATE entregadores SET fila_idx=COALESCE(fila_idx,0)+1 WHERE id={ph}", (entregador["id"],))
            _exec(conn, f"UPDATE orders SET entregador_id={ph} WHERE id={ph}", (entregador["id"], order_id))
            conn.commit()
        except Exception as e:
            print(f"[ERRO] escalar entregador: {e}")

    conn.close()
    if entregador:
        _json(h, {"ok": True, "entregador": {
            "id":    entregador["id"],
            "name":  entregador["name"],
            "phone": entregador["phone"],
            "email": entregador["email"],
        }})
    else:
        _json(h, {"ok": True})

def api_delete_order(h, order_id):
    s = _auth(h)
    if not s or s["role"] != "admin": return _json(h, {"ok": False}, 403)
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"DELETE FROM orders WHERE id={ph}", (order_id,))
    conn.commit(); conn.close()
    _json(h, {"ok": True})

# ================================================================
# PERFIL
# ================================================================

def api_update_profile(h, b):
    s = _auth(h)
    if not s or s["role"] != "user": return _json(h, {"ok": False, "message": "Não autorizado."}, 401)
    name     = b.get("name",    "").strip()
    address  = b.get("address", "").strip()
    phone    = b.get("phone",   "").strip()
    new_pass  = b.get("new_password", "").strip()
    curr_pass = b.get("current_password", "").strip()

    if not name:  return _json(h, {"ok": False, "message": "Nome não pode ficar vazio."}, 400)
    if not phone: return _json(h, {"ok": False, "message": "Celular não pode ficar vazio."}, 400)

    conn = db_connect()
    ph = _ph()
    c = _exec(conn, f"SELECT * FROM users WHERE id={ph}", (s["user_id"],))
    user = _fetchone(c)

    if new_pass:
        if not curr_pass or user["password"] != _hash(curr_pass):
            conn.close()
            return _json(h, {"ok": False, "message": "Senha atual incorreta."}, 400)
        if len(new_pass) < 6:
            conn.close()
            return _json(h, {"ok": False, "message": "Nova senha muito curta (mínimo 6)."}, 400)

    c2 = _exec(conn, f"SELECT id FROM users WHERE phone={ph} AND id!={ph}", (phone, s["user_id"]))
    existing = _fetchone(c2)
    if existing:
        conn.close()
        return _json(h, {"ok": False, "message": "Este celular já está em uso."}, 409)

    if new_pass:
        _exec(conn, f"UPDATE users SET name={ph},phone={ph},address={ph},password={ph} WHERE id={ph}",
              (name, phone, address, _hash(new_pass), s["user_id"]))
    else:
        _exec(conn, f"UPDATE users SET name={ph},phone={ph},address={ph} WHERE id={ph}",
              (name, phone, address, s["user_id"]))
    conn.commit()
    c3 = _exec(conn, f"SELECT * FROM users WHERE id={ph}", (s["user_id"],))
    updated = _fetchone(c3); conn.close()
    _json(h, {"ok": True, "message": "Dados atualizados com sucesso!", "user": {
        "id": updated["id"], "name": updated["name"], "phone": updated["phone"],
        "address": updated["address"] or "", "created_at": updated["created_at"],
        "last_login": updated["last_login"] or "Primeiro acesso"
    }})

# ================================================================
# USUÁRIOS
# ================================================================

def api_users(h):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    conn = db_connect()
    c = _exec(conn, "SELECT id,name,phone,address,created_at,last_login FROM users ORDER BY created_at DESC")
    users = _fetchall(c); conn.close()
    _json(h,{"ok":True,"users":users})

def api_delete_user(h, uid):
    s = _auth(h)
    if not s or s["role"]!="admin": return _json(h,{"ok":False},403)
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"DELETE FROM users WHERE id={ph}", (uid,))
    conn.commit(); conn.close()
    _json(h,{"ok":True})

# ================================================================
# ENTREGADORES
# ================================================================

def api_entregadores_list(h):
    s = _auth(h)
    if not s or s["role"] != "admin": return _json(h, {"ok": False}, 403)
    conn = db_connect()
    c = _exec(conn, "SELECT * FROM entregadores ORDER BY name ASC")
    rows = _fetchall(c); conn.close()
    _json(h, {"ok": True, "entregadores": rows})

def api_entregadores_create(h, b):
    s = _auth(h)
    if not s or s["role"] != "admin": return _json(h, {"ok": False, "message": "Acesso negado."}, 403)
    name    = b.get("name",    "").strip()
    phone   = b.get("phone",   "").strip()
    email   = b.get("email",   "").strip()
    address = b.get("address", "").strip()
    cpf     = b.get("cpf",     "").strip()
    if not name:  return _json(h, {"ok": False, "message": "Nome é obrigatório."}, 400)
    if not phone: return _json(h, {"ok": False, "message": "Celular é obrigatório."}, 400)
    conn = db_connect()
    c = _exec(conn,
        f"INSERT INTO entregadores (name,phone,email,address,cpf) VALUES ({_placeholders(5)})",
        (name, phone, email, address, cpf)
    )
    new_id = _lastrowid(conn, c, "entregadores")
    conn.commit(); conn.close()
    _json(h, {"ok": True, "id": new_id})

def api_entregadores_delete(h, eid):
    s = _auth(h)
    if not s or s["role"] != "admin": return _json(h, {"ok": False}, 403)
    conn = db_connect()
    ph = _ph()
    _exec(conn, f"DELETE FROM entregadores WHERE id={ph}", (eid,))
    conn.commit(); conn.close()
    _json(h, {"ok": True})

def COALESCE_int(v, default=1):
    return v if v is not None else default

def api_entregadores_toggle_online(h, eid):
    s = _auth(h)
    if not s or s["role"] != "admin": return _json(h, {"ok": False}, 403)
    conn = db_connect()
    ph = _ph()

    c = _exec(conn, f"SELECT online, fila_idx FROM entregadores WHERE id={ph}", (eid,))
    cur = _fetchone(c)
    era_offline = cur and COALESCE_int(cur["online"]) == 0

    _exec(conn, f"UPDATE entregadores SET online=CASE WHEN COALESCE(online,1)=1 THEN 0 ELSE 1 END WHERE id={ph}", (eid,))
    conn.commit()

    if era_offline:
        c2 = _exec(conn, f"SELECT MAX(COALESCE(fila_idx,0)) as m FROM entregadores WHERE id!={ph}", (eid,))
        max_row = _fetchone(c2)
        max_idx = max_row["m"] if max_row and max_row["m"] is not None else 0
        _exec(conn, f"UPDATE entregadores SET fila_idx={ph} WHERE id={ph}", (max_idx, eid))
        conn.commit()

    c3 = _exec(conn, f"SELECT online FROM entregadores WHERE id={ph}", (eid,))
    row = _fetchone(c3); conn.close()
    _json(h, {"ok": True, "online": row["online"] if row else 1})

# ================================================================
# HANDLER HTTP
# ================================================================

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): print(f"[{self.address_string()}] {fmt%args}")

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (ValueError, TypeError):
            n = 0
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw: return {}
        try: return json.loads(raw)
        except Exception: return {}

    def do_GET(self):
        p = urlparse(self.path).path
        routes = {
            "/api/me": api_me,
            "/api/catalog": api_catalog,
            "/api/catalog/all": api_catalog_all,
            "/api/orders/mine": api_orders_mine,
            "/api/orders": api_orders_all,
            "/api/users": api_users,
            "/api/entregadores": api_entregadores_list,
        }
        if p in routes: return routes[p](self)

        if p.startswith("/img/"):
            filepath = p.lstrip("/")
            if os.path.isfile(filepath):
                ext  = os.path.splitext(filepath)[1].lower()
                mime = {".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",
                        ".webp":"image/webp",".gif":"image/gif"}.get(ext,"application/octet-stream")
                with open(filepath,"rb") as f: content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            self.send_error(404); return

        static = {"/":"index.html","/index.html":"index.html","/styles.css":"styles.css","/app.js":"app.js"}
        if p in static: return _serve(self, static[p])
        self.send_error(404)

    def do_POST(self):
        p, b = urlparse(self.path).path, self._body()
        if p=="/api/register":     return api_register(self,b)
        if p=="/api/login":        return api_login(self,b)
        if p=="/api/admin/login":  return api_admin_login(self,b)
        if p=="/api/logout":       return api_logout(self)
        if p=="/api/orders":       return api_order_create(self,b)
        if p=="/api/catalog":      return api_catalog_add(self,b)
        if p=="/api/entregadores": return api_entregadores_create(self,b)
        self.send_error(404)

    def do_PATCH(self):
        p, b = urlparse(self.path).path, self._body()
        parts = p.strip("/").split("/")
        if p == "/api/users/me":
            return api_update_profile(self, b)
        if len(parts)==4 and parts[0]=="api" and parts[1]=="orders" and parts[3]=="status":
            try: return api_order_status(self,int(parts[2]),b)
            except ValueError: pass
        if len(parts)==4 and parts[0]=="api" and parts[1]=="catalog" and parts[3]=="toggle":
            try: return api_catalog_toggle(self,int(parts[2]))
            except ValueError: pass
        if len(parts)==4 and parts[0]=="api" and parts[1]=="catalog" and parts[3]=="price":
            try: return api_catalog_update_price(self,int(parts[2]),b)
            except ValueError: pass
        if len(parts)==4 and parts[0]=="api" and parts[1]=="catalog" and parts[3]=="info":
            try: return api_catalog_update_info(self,int(parts[2]),b)
            except ValueError: pass
        if len(parts)==4 and parts[0]=="api" and parts[1]=="entregadores" and parts[3]=="online":
            try: return api_entregadores_toggle_online(self,int(parts[2]))
            except ValueError: pass
        self.send_error(404)

    def do_DELETE(self):
        p = urlparse(self.path).path
        parts = p.strip("/").split("/")
        if len(parts)==3 and parts[0]=="api" and parts[1]=="orders":
            try: return api_delete_order(self, int(parts[2]))
            except ValueError: pass
        if len(parts)==3 and parts[0]=="api" and parts[1]=="users":
            try: return api_delete_user(self, int(parts[2]))
            except ValueError: pass
        if len(parts)==3 and parts[0]=="api" and parts[1]=="entregadores":
            try: return api_entregadores_delete(self, int(parts[2]))
            except ValueError: pass
        self.send_error(404)

    def do_OPTIONS(self): self.send_response(204); self.end_headers()


if __name__ == "__main__":
    db_init()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    mode = "PostgreSQL (Railway)" if USE_PG else f"SQLite local ({DB_FILE})"
    print("=" * 52)
    print(f"  http://localhost:{PORT}")
    print(f"  Banco: {mode}")
    print(f"  Admin: danbeller088@gmail.com / admin123")
    print("=" * 52)
    try: srv.serve_forever()
    except KeyboardInterrupt: print("\n[!] Encerrado.")
