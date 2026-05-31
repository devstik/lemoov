const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    'https://lemoov.com.br',
    'https://www.lemoov.com.br',
    'http://localhost:3000',
    'http://localhost:5500'
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const DB_PATH = path.join(__dirname, 'data', 'pedidos.json');
const PENDING_PAYMENTS_PATH = path.join(__dirname, 'data', 'pagamentos-pendentes.json');
const PROD_PATH = path.join(__dirname, 'data', 'produtos.json');
const ADMIN_USER = process.env.REPORT_USER || 'lemoov';
const ADMIN_PASS = process.env.REPORT_PASS || 'L3moov@';
const MYSQL_CONFIG = {
  socketPath: process.env.DB_SOCKET || null,
  host: (process.env.DB_HOST || process.env.MYSQL_HOST || '').replace(/^localhost$/i, '127.0.0.1'),
  user: process.env.DB_USER || process.env.MYSQL_USER,
  password: process.env.DB_PASS || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE
};
const MYSQL_ENABLED = Boolean((MYSQL_CONFIG.socketPath || MYSQL_CONFIG.host) && MYSQL_CONFIG.user && MYSQL_CONFIG.database);
const mysqlPool = MYSQL_ENABLED ? mysql.createPool({
  ...(MYSQL_CONFIG.socketPath ? { socketPath: MYSQL_CONFIG.socketPath } : { host: MYSQL_CONFIG.host }),
  user: MYSQL_CONFIG.user,
  password: MYSQL_CONFIG.password,
  database: MYSQL_CONFIG.database,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
  charset: 'utf8mb4'
}) : null;
let mysqlInitPromise = null;
const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000;
const clientSessions = new Map();
const CLIENT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const resetTokens = new Map();
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const verificationCodes = new Map();
const VERIFY_CODE_TTL_MS = 15 * 60 * 1000;

// garante arquivo
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]', 'utf-8');
if (!fs.existsSync(PENDING_PAYMENTS_PATH)) fs.writeFileSync(PENDING_PAYMENTS_PATH, '[]', 'utf-8');
if (!fs.existsSync(PROD_PATH)) fs.writeFileSync(PROD_PATH, '[]', 'utf-8');
const IMAGE_DIR = path.join(__dirname, 'image');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
const UPLOAD_PUBLIC_PREFIX = (process.env.UPLOAD_PUBLIC_PREFIX || 'uploads').replace(/^\/+|\/+$/g, '');
// Default: one level above __dirname (outside the nodejs/ deploy folder) so uploads
// survive git-based redeploys on Hostinger. Set UPLOAD_DIR in .env to override.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', UPLOAD_PUBLIC_PREFIX);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
console.log(`[uploads] salvando em: ${UPLOAD_DIR}`);
const INFINITEPAY_API_URL = process.env.INFINITEPAY_API_URL || 'https://api.checkout.infinitepay.io/links';
const INFINITEPAY_HANDLE = (process.env.INFINITEPAY_HANDLE || process.env.INFINITYPAY_HANDLE || '').replace(/^\$/, '');
const PUBLIC_SITE_URL = (process.env.SITE_URL || process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');

function readPedidos() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (_e) {
    return [];
  }
}
function readPendingPayments() {
  try {
    return JSON.parse(fs.readFileSync(PENDING_PAYMENTS_PATH, 'utf-8'));
  } catch (_e) {
    return [];
  }
}
function readProdutos() {
  try {
    return JSON.parse(fs.readFileSync(PROD_PATH, 'utf-8'));
  } catch (_e) {
    return [];
  }
}
function writeProdutos(list) {
  fs.writeFileSync(PROD_PATH, JSON.stringify(list, null, 2), 'utf-8');
}
function writePedidos(list) {
  fs.writeFileSync(DB_PATH, JSON.stringify(list, null, 2), 'utf-8');
}
function writePendingPayments(list) {
  fs.writeFileSync(PENDING_PAYMENTS_PATH, JSON.stringify(list, null, 2), 'utf-8');
}
async function initDatabase() {
  if (!MYSQL_ENABLED) return;
  if (mysqlInitPromise) return mysqlInitPromise;
  mysqlInitPromise = (async () => {
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_products (
        id INT NOT NULL PRIMARY KEY,
        data LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_orders (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        order_number VARCHAR(40) NOT NULL UNIQUE,
        data LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_payment_intents (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        order_number VARCHAR(40) NOT NULL UNIQUE,
        data LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_clients (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        email VARCHAR(200) NOT NULL UNIQUE,
        senha_hash VARCHAR(255) NOT NULL,
        cpf VARCHAR(14),
        telefone VARCHAR(20),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_client_addresses (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL,
        cep VARCHAR(8) NOT NULL,
        logradouro VARCHAR(200) NOT NULL,
        numero VARCHAR(20) NOT NULL,
        complemento VARCHAR(100),
        bairro VARCHAR(100),
        cidade VARCHAR(100) NOT NULL,
        uf VARCHAR(2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES lemoov_clients(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    for (const colDef of ['client_id INT NULL', 'address_id INT NULL']) {
      try { await mysqlPool.execute(`ALTER TABLE lemoov_orders ADD COLUMN ${colDef}`); } catch (_) {}
    }
    for (const colDef of ['nome VARCHAR(200) NOT NULL DEFAULT \'\'', 'cpf VARCHAR(14) NULL', 'telefone VARCHAR(20) NULL']) {
      try { await mysqlPool.execute(`ALTER TABLE lemoov_clients ADD COLUMN ${colDef}`); } catch (_) {}
    }
    for (const colDef of ['complemento VARCHAR(100) NULL', 'bairro VARCHAR(100) NULL', 'uf VARCHAR(2) NOT NULL DEFAULT \'\'']) {
      try { await mysqlPool.execute(`ALTER TABLE lemoov_client_addresses ADD COLUMN ${colDef}`); } catch (_) {}
    }
    const [rows] = await mysqlPool.execute('SELECT COUNT(*) AS total FROM lemoov_products');
    if (Number(rows?.[0]?.total || 0) === 0) {
      const localProducts = ensureProductIds(readProdutos());
      for (const item of localProducts) {
        await mysqlPool.execute(
          'INSERT INTO lemoov_products (id, data) VALUES (?, ?)',
          [Number(item.id), JSON.stringify(item)]
        );
      }
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(ADMIN_PASS, salt, 64).toString('hex');
    await mysqlPool.execute('DELETE FROM lemoov_users WHERE username = ?', [ADMIN_USER]);
    await mysqlPool.execute(
      'INSERT INTO lemoov_users (username, password_hash) VALUES (?, ?)',
      [ADMIN_USER, `${salt}:${hash}`]
    );
  })().catch((err) => {
    console.error('[initDatabase] erro:', err.message);
    mysqlInitPromise = null;
    throw err;
  });
  return mysqlInitPromise;
}
async function readProdutosStore(conn = null) {
  if (!MYSQL_ENABLED) return readProdutos();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT id, data FROM lemoov_products ORDER BY id');
  return rows.map((row) => {
    const item = JSON.parse(row.data);
    return { ...item, id: Number(item.id || row.id) };
  });
}
async function writeProdutosStore(list, conn = null) {
  const canonical = ensureProductIds(list);
  // Always keep JSON in sync so Sync JSON doesn't lose MySQL-only additions
  writeProdutos(canonical);
  if (!MYSQL_ENABLED) return;
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute('DELETE FROM lemoov_products');
  for (const item of canonical) {
    await db.execute(
      'INSERT INTO lemoov_products (id, data) VALUES (?, ?)',
      [Number(item.id), JSON.stringify(item)]
    );
  }
}
async function readPedidosStore(conn = null) {
  if (!MYSQL_ENABLED) return readPedidos();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_orders ORDER BY id');
  return rows.map((row) => {
    const item = JSON.parse(row.data);
    return { ...item, pedido: item.pedido || row.order_number };
  });
}
async function readPedidoStore(numero, conn = null) {
  const pedidoNumero = String(numero);
  if (!MYSQL_ENABLED) {
    return readPedidos().find((p) => String(p.pedido) === pedidoNumero) || null;
  }
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_orders WHERE order_number = ?', [pedidoNumero]);
  if (!rows.length) return null;
  const item = JSON.parse(rows[0].data);
  return { ...item, pedido: item.pedido || rows[0].order_number };
}
async function appendPedidoStore(item, conn = null) {
  if (!MYSQL_ENABLED) {
    const pedidos = readPedidos();
    pedidos.push(item);
    writePedidos(pedidos);
    return;
  }
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute(
    'INSERT INTO lemoov_orders (order_number, data) VALUES (?, ?)',
    [String(item.pedido), JSON.stringify(item)]
  );
}
async function readPendingPaymentStore(numero, conn = null) {
  const orderNumber = String(numero);
  if (!MYSQL_ENABLED) {
    return readPendingPayments().find((p) => String(p.pedido || p.order_nsu) === orderNumber) || null;
  }
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_payment_intents WHERE order_number = ?', [orderNumber]);
  if (!rows.length) return null;
  const item = JSON.parse(rows[0].data);
  return { ...item, pedido: item.pedido || rows[0].order_number, order_nsu: item.order_nsu || rows[0].order_number };
}
async function readPendingPaymentsStore(conn = null) {
  if (!MYSQL_ENABLED) return readPendingPayments();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_payment_intents ORDER BY id');
  return rows.map((row) => {
    const item = JSON.parse(row.data);
    return { ...item, pedido: item.pedido || row.order_number, order_nsu: item.order_nsu || row.order_number };
  });
}
async function savePendingPaymentStore(item, conn = null) {
  const orderNumber = String(item.pedido || item.order_nsu);
  const payload = { ...item, pedido: orderNumber, order_nsu: orderNumber };
  if (!MYSQL_ENABLED) {
    const pending = readPendingPayments().filter((p) => String(p.pedido || p.order_nsu) !== orderNumber);
    pending.push(payload);
    writePendingPayments(pending);
    return;
  }
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute(
    `INSERT INTO lemoov_payment_intents (order_number, data) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [orderNumber, JSON.stringify(payload)]
  );
}
async function deletePendingPaymentStore(numero, conn = null) {
  const orderNumber = String(numero);
  if (!MYSQL_ENABLED) {
    writePendingPayments(readPendingPayments().filter((p) => String(p.pedido || p.order_nsu) !== orderNumber));
    return;
  }
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute('DELETE FROM lemoov_payment_intents WHERE order_number = ?', [orderNumber]);
}
async function updatePedidoStore(numero, updates, conn = null) {
  if (!MYSQL_ENABLED) {
    const pedidos = readPedidos();
    const idx = pedidos.findIndex((p) => String(p.pedido) === String(numero));
    if (idx === -1) throw new Error('Pedido não encontrado');
    pedidos[idx] = { ...pedidos[idx], ...updates, pedido: numero };
    writePedidos(pedidos);
    return pedidos[idx];
  }
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT data FROM lemoov_orders WHERE order_number = ?', [String(numero)]);
  if (!rows.length) throw new Error('Pedido não encontrado');
  const updated = { ...JSON.parse(rows[0].data), ...updates, pedido: numero };
  await db.execute('UPDATE lemoov_orders SET data = ? WHERE order_number = ?', [JSON.stringify(updated), String(numero)]);
  return updated;
}
async function deletePedidoStore(numero) {
  if (!MYSQL_ENABLED) {
    writePedidos(readPedidos().filter((p) => String(p.pedido) !== String(numero)));
    return;
  }
  await initDatabase();
  await mysqlPool.execute('DELETE FROM lemoov_orders WHERE order_number = ?', [String(numero)]);
}
function ensureProductIds(list) {
  let maxId = 0;
  list.forEach((p) => { if (Number.isFinite(p.id)) maxId = Math.max(maxId, p.id); });
  return list.map((p) => {
    if (Number.isFinite(p.id)) return p;
    maxId += 1;
    return { ...p, id: maxId };
  });
}
function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}
function getColorStock(cor) {
  return cor && cor.estoque && typeof cor.estoque === 'object' && !Array.isArray(cor.estoque)
    ? cor.estoque
    : null;
}
function normalizeStockItems(itens = []) {
  const grouped = new Map();
  itens.forEach((item) => {
    const productId = Number(item.productId);
    if (!Number.isFinite(productId)) return;
    const colorIndex = Number(item.colorIndex) || 0;
    const tamanho = normalizeKey(item.tamanhoSelecionado || item.tamanho || 'UNICO');
    const quantidade = Math.max(1, Number(item.quantidade) || 1);
    const key = [productId, colorIndex, tamanho].join('|');
    const current = grouped.get(key) || {
      productId,
      colorIndex,
      tamanho,
      quantidade: 0,
      nome: item.nome || ''
    };
    current.quantidade += quantidade;
    if (!current.nome && item.nome) current.nome = item.nome;
    grouped.set(key, current);
  });
  return Array.from(grouped.values());
}
function validateStockAvailability(produtos, itens = []) {
  const stockItems = normalizeStockItems(itens);
  for (const item of stockItems) {
    const prod = produtos.find((p) => Number(p.id) === item.productId);
    if (!prod) throw new Error(`Produto não encontrado: ${item.nome || item.productId}`);
    const cor = Array.isArray(prod.cores) ? prod.cores[item.colorIndex] : null;
    if (prod.soldOut || cor?.soldOut) {
      const label = [prod.nome, cor?.nome].filter(Boolean).join(' - ');
      throw new Error(`Item esgotado: ${label || item.nome || item.productId}.`);
    }
    const stock = getColorStock(cor);
    if (!stock) continue;
    const current = Number(stock[item.tamanho]);
    if (!Number.isFinite(current) || current < item.quantidade) {
      const label = [prod.nome, cor?.nome, item.tamanho].filter(Boolean).join(' - ');
      throw new Error(`Estoque insuficiente para ${label}. Estoque atual: ${Number.isFinite(current) ? Math.max(0, current) : 0}.`);
    }
  }
  return stockItems;
}
function isPaidOrderStatus(order = {}) {
  const status = String(order.status || '').toLowerCase();
  const paymentStatus = String(order.pagamento_status || '').toLowerCase();
  return ['confirmado', 'enviado', 'entregue'].includes(status) || paymentStatus === 'pago';
}
function generateOrderNumber(pedidos) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateKey = `${yyyy}${mm}${dd}`;
  const todays = pedidos
    .map((p) => String(p.pedido || ''))
    .filter((p) => p.startsWith(dateKey));
  let maxSeq = 0;
  todays.forEach((pedido) => {
    const seq = Number(pedido.slice(dateKey.length));
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  });
  return `${dateKey}${maxSeq + 1}`;
}
function getPublicBaseUrl(req) {
  if (PUBLIC_SITE_URL) return PUBLIC_SITE_URL;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${req.get('host')}`.replace(/\/$/, '');
}
function toCents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}
function normalizePaymentItems(itens = []) {
  return itens
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || item.quantidade || 1));
      const cents = item.price_cents || item.price_centavos || item.valor_centavos;
      const price = cents ? Number(cents) : toCents(item.price || item.preco || item.valor || 0);
      const description = String(item.description || item.item_name || item.nome || 'Produto Lemoov').slice(0, 180);
      return { quantity, price, description };
    })
    .filter((item) => item.price > 0);
}
function reserveStock(produtos, itens = []) {
  const stockItems = validateStockAvailability(produtos, itens);

  for (const item of stockItems) {
    const prod = produtos.find((p) => Number(p.id) === item.productId);
    const cor = Array.isArray(prod?.cores) ? prod.cores[item.colorIndex] : null;
    const stock = getColorStock(cor);
    if (!stock) continue;
    stock[item.tamanho] = Math.max(0, Number(stock[item.tamanho]) - item.quantidade);
    cor.tamanhos = Object.keys(stock).filter((size) => Number(stock[size]) > 0);
    cor.soldOut = cor.tamanhos.length === 0;
    prod.updatedAt = new Date().toISOString();
  }

  produtos.forEach((prod) => {
    if (!Array.isArray(prod.cores) || !prod.cores.length) return;
    const allManaged = prod.cores.every((cor) => Boolean(getColorStock(cor)));
    if (!allManaged) return;
    prod.soldOut = prod.cores.every((cor) => {
      const stock = getColorStock(cor);
      return !stock || Object.values(stock).every((qty) => Number(qty) <= 0);
    });
  });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^\w\-]+/g, '_');
      cb(null, `${Date.now()}_${base}${ext}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png)/.test(file.mimetype);
    cb(ok ? null : new Error('Tipo inválido'), ok);
  },
  limits: { fileSize: 6 * 1024 * 1024 }
});

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function clientSessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `lemoov_client_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function authRequired(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.lemoov_session;
  if (token && sessions.has(token)) {
    const session = sessions.get(token);
    if (session && Date.now() - session.createdAt <= SESSION_TTL_MS) {
      return next();
    }
    sessions.delete(token);
  }
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  const redirectTo = encodeURIComponent(req.originalUrl || req.path || '/');
  if (wantsHtml || req.path === '/api/produtos-admin' || req.path === '/api/relatorio') {
    return res.redirect(`/login?redirect=${redirectTo}`);
  }
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

function clientAuthRequired(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.lemoov_client_session;
  if (token && clientSessions.has(token)) {
    const session = clientSessions.get(token);
    if (session && Date.now() - session.createdAt <= CLIENT_SESSION_TTL_MS) {
      req.clientSession = session;
      return next();
    }
    clientSessions.delete(token);
  }
  return res.status(401).json({ ok: false, error: 'não autenticado' });
}

function hashClientPwd(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyClientPwd(pwd, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.scryptSync(pwd, salt, 64).toString('hex') === hash;
}

// ─── Rotas de cliente ──────────────────────────────────────────────────────

app.get('/cliente-login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'cliente-login.html'));
});
app.get('/cliente-login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'cliente-login.html'));
});

app.get('/api/client/me', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.lemoov_client_session;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ ok: false, error: 'não autenticado' });
  const session = clientSessions.get(token);
  if (!session || Date.now() - session.createdAt > CLIENT_SESSION_TTL_MS) {
    if (token) clientSessions.delete(token);
    return res.status(401).json({ ok: false, error: 'sessão expirada' });
  }
  return res.json({ ok: true, client: { id: session.clientId, nome: session.nome, email: session.email, telefone: session.telefone || '' } });
});

app.put('/api/client/me', clientAuthRequired, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const telefone = String(req.body?.telefone || '').replace(/\D/g, '');
  if (!nome || nome.length < 3) return res.status(400).json({ ok: false, error: 'Nome inválido.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  if (telefone && (telefone.length < 10 || telefone.length > 11)) return res.status(400).json({ ok: false, error: 'Telefone inválido.' });

  try {
    if (MYSQL_ENABLED) {
      await initDatabase();
      const [existing] = await mysqlPool.execute(
        'SELECT id FROM lemoov_clients WHERE email = ? AND id <> ?',
        [email, req.clientSession.clientId]
      );
      if (existing.length) return res.status(409).json({ ok: false, error: 'Este e-mail já está em uso.' });
      await mysqlPool.execute(
        'UPDATE lemoov_clients SET nome = ?, email = ?, telefone = ? WHERE id = ?',
        [nome, email, telefone || null, req.clientSession.clientId]
      );
    }
    req.clientSession.nome = nome;
    req.clientSession.email = email;
    req.clientSession.telefone = telefone;
    return res.json({ ok: true, client: { id: req.clientSession.clientId, nome, email, telefone } });
  } catch (e) {
    console.error('[client/me PUT]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar cadastro.' });
  }
});

app.post('/api/client/login', async (req, res) => {
  if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios.' });
  try {
    await initDatabase();
    const [rows] = await mysqlPool.execute('SELECT id, nome, email, senha_hash, telefone FROM lemoov_clients WHERE email = ?', [String(email).toLowerCase().trim()]);
    if (!rows.length || !verifyClientPwd(String(senha), rows[0].senha_hash)) {
      return res.status(401).json({ ok: false, error: 'E-mail ou senha incorretos.' });
    }
    const client = rows[0];
    const token = crypto.randomBytes(24).toString('hex');
    clientSessions.set(token, { clientId: client.id, nome: client.nome, email: client.email, telefone: client.telefone || '', createdAt: Date.now() });
    res.setHeader('Set-Cookie', clientSessionCookie(token, Math.floor(CLIENT_SESSION_TTL_MS / 1000)));
    return res.json({ ok: true, client: { id: client.id, nome: client.nome, email: client.email, telefone: client.telefone || '' } });
  } catch (e) {
    console.error('[client/login]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro interno.' });
  }
});

app.post('/api/client/register', async (req, res) => {
  if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
  const { nome, email, cpf, telefone, senha, endereco } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ ok: false, error: 'Nome, e-mail e senha são obrigatórios.' });
  if (!endereco?.numero) return res.status(400).json({ ok: false, error: 'Número do endereço é obrigatório.' });
  try {
    await initDatabase();
    const emailNorm = String(email).toLowerCase().trim();
    const [existing] = await mysqlPool.execute('SELECT id FROM lemoov_clients WHERE email = ?', [emailNorm]);
    if (existing.length) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado.' });
    const senhaHash = hashClientPwd(String(senha));
    const [result] = await mysqlPool.execute(
      'INSERT INTO lemoov_clients (nome, email, senha_hash, cpf, telefone) VALUES (?, ?, ?, ?, ?)',
      [String(nome).trim(), emailNorm, senhaHash, String(cpf || '').replace(/\D/g, '') || null, String(telefone || '').replace(/\D/g, '') || null]
    );
    const clientId = result.insertId;
    if (endereco?.cep) {
      await mysqlPool.execute(
        'INSERT INTO lemoov_client_addresses (client_id, cep, logradouro, numero, complemento, bairro, cidade, uf) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [clientId, String(endereco.cep).replace(/\D/g, ''), String(endereco.logradouro || ''), String(endereco.numero), String(endereco.complemento || '') || null, String(endereco.bairro || '') || null, String(endereco.cidade || ''), String(endereco.uf || '')]
      );
    }
    if (process.env.SMTP_HOST || process.env.RESEND_API_KEY) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const verifyToken = crypto.randomBytes(24).toString('hex');
      verificationCodes.set(verifyToken, { clientId, nome: String(nome).trim(), email: emailNorm, telefone: String(telefone || '').replace(/\D/g, ''), code, expiresAt: Date.now() + VERIFY_CODE_TTL_MS });
      await sendVerificationEmail(emailNorm, String(nome).trim(), code).catch((e) => console.error('[verify-email]', e.message));
      return res.status(201).json({ ok: true, needsVerification: true, verifyToken });
    }
    const token = crypto.randomBytes(24).toString('hex');
    clientSessions.set(token, { clientId, nome: String(nome).trim(), email: emailNorm, telefone: String(telefone || '').replace(/\D/g, ''), createdAt: Date.now() });
    res.setHeader('Set-Cookie', clientSessionCookie(token, Math.floor(CLIENT_SESSION_TTL_MS / 1000)));
    return res.status(201).json({ ok: true, client: { id: clientId, nome: String(nome).trim(), email: emailNorm, telefone: String(telefone || '').replace(/\D/g, '') } });
  } catch (e) {
    console.error('[client/register]', e.message);
    if (e.code === 'ER_DUP_ENTRY') {
      const field = /for key '([^']+)'/.exec(e.message)?.[1] || '';
      if (field.includes('email')) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado.' });
      if (field.includes('cpf'))   return res.status(409).json({ ok: false, error: 'CPF já cadastrado.' });
      return res.status(409).json({ ok: false, error: 'Dados já cadastrados.' });
    }
    return res.status(500).json({ ok: false, error: 'Erro ao criar conta.' });
  }
});

app.post('/api/client/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.lemoov_client_session;
  if (token) clientSessions.delete(token);
  res.setHeader('Set-Cookie', clientSessionCookie('', 0));
  res.json({ ok: true });
});

let _smtpTransport = null;
function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  _smtpTransport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _smtpTransport;
}

async function sendEmail(to, subject, html) {
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER || `noreply@${(process.env.SITE_URL || 'lemoov.com.br').replace(/https?:\/\//, '')}`;

  const smtp = getSmtpTransport();
  if (smtp) {
    await smtp.sendMail({ from, to, subject, html });
    return;
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] nenhum serviço configurado (SMTP_HOST ou RESEND_API_KEY). Email não enviado para: ${to}`);
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

async function sendVerificationEmail(toEmail, toNome, code) {
  await sendEmail(toEmail, 'Confirme seu cadastro – Lemoov',
    `<p>Olá, ${toNome}!</p><p>Use o código abaixo para confirmar seu e-mail. Válido por 15 minutos.</p><h2 style="letter-spacing:6px">${code}</h2>`
  );
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function sendWhatsApp(phone, message) {
  const instance = process.env.ZAPI_INSTANCE;
  const token    = process.env.ZAPI_TOKEN;
  if (!instance || !token) return;
  const digits = String(phone).replace(/\D/g, '');
  const phoneE164 = digits.startsWith('55') ? digits : `55${digits}`;
  const r = await fetch(`https://api.z-api.io/instances/${instance}/token/${token}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phoneE164, message }),
  });
  if (!r.ok) throw new Error(`Z-API ${r.status}`);
}

async function notifyOrderConfirmed(pedido) {
  const cliente   = pedido.cliente || pedido.pedidoPayload?.cliente || {};
  const nome      = (cliente.nome || pedido.cliente_nome || '').split(' ')[0] || 'Cliente';
  const email     = cliente.email || pedido.cliente_email || '';
  const telefone  = cliente.telefone || pedido.cliente_telefone || '';
  const numero    = pedido.pedido || pedido.order_nsu || '';
  const total     = formatBRL(pedido.total || pedido.payment_paid_amount);
  const retirada  = Boolean(pedido.retirada);
  const entrega   = retirada ? 'Retirada na loja' : [pedido.rua, pedido.numero, pedido.cidade, pedido.uf].filter(Boolean).join(', ');

  const itensTexto = (pedido.itens || []).map((i) =>
    `• ${i.nome || i.description || 'Item'}${i.cor ? ` – ${i.cor}` : ''}${i.tamanho ? ` (${i.tamanho})` : ''} x${i.quantidade || i.qty || 1}`
  ).join('\n') || '–';

  const itensHtml = (pedido.itens || []).map((i) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${i.nome || i.description || 'Item'}${i.cor ? ` – ${i.cor}` : ''}${i.tamanho ? ` (${i.tamanho})` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">x${i.quantidade || i.qty || 1}</td></tr>`
  ).join('');

  if (email) {
    await sendEmail(
      email,
      `✅ Pedido #${numero} confirmado – Lemoov`,
      `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;color:#1a2a35">
        <h2 style="color:#1ec28b">Pagamento aprovado! 🎉</h2>
        <p>Olá, <strong>${nome}</strong>! Seu pedido foi confirmado e já estamos separando tudo com carinho.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">${itensHtml}</table>
        <p><strong>Total:</strong> ${total}</p>
        <p><strong>${retirada ? 'Retirada' : 'Entrega'}:</strong> ${entrega || '–'}</p>
        <p style="margin-top:24px;color:#7f8ba4;font-size:13px">Em breve entraremos em contato para combinar ${retirada ? 'a retirada' : 'a entrega'}. Qualquer dúvida, fale com a gente pelo WhatsApp!</p>
        <p style="color:#7f8ba4;font-size:12px">Lemoov Fitness</p>
      </div>`
    ).catch((e) => console.error('[notify email]', e.message));
  }

  if (telefone) {
    const wppMsg = `✅ *Pedido #${numero} confirmado!*\n\nOlá, ${nome}! Seu pagamento foi aprovado. 🎉\n\n${itensTexto}\n\n💰 *Total:* ${total}\n📦 *${retirada ? 'Retirada na loja' : `Entrega: ${entrega || '–'}`}*\n\nEm breve entraremos em contato para combinar ${retirada ? 'a retirada' : 'a entrega'}. Obrigada pela compra! 💚\n\n_Lemoov Fitness_`;
    await sendWhatsApp(telefone, wppMsg).catch((e) => console.error('[notify whatsapp]', e.message));
  }
}

async function sendResetEmail(toEmail, toNome, resetUrl) {
  const hasService = process.env.SMTP_HOST || process.env.RESEND_API_KEY;
  if (!hasService) {
    console.log(`[reset-password] link para ${toEmail}: ${resetUrl}`);
    return;
  }
  await sendEmail(toEmail, 'Redefinir senha – Lemoov',
    `<p>Olá, ${toNome}!</p><p>Clique no link abaixo para criar uma nova senha. Válido por 1 hora.</p><p><a href="${resetUrl}" style="color:#1ec28b">${resetUrl}</a></p><p>Se não foi você, ignore este e-mail.</p>`
  );
}

app.post('/api/client/verify-email', async (req, res) => {
  const { verifyToken, code } = req.body || {};
  if (!verifyToken || !code) return res.status(400).json({ ok: false, error: 'Dados inválidos.' });
  const entry = verificationCodes.get(String(verifyToken));
  if (!entry || Date.now() > entry.expiresAt) {
    verificationCodes.delete(String(verifyToken));
    return res.status(400).json({ ok: false, error: 'Código expirado. Faça o cadastro novamente.' });
  }
  if (String(code).trim() !== entry.code)
    return res.status(400).json({ ok: false, error: 'Código incorreto.' });
  verificationCodes.delete(String(verifyToken));
  const sessionToken = crypto.randomBytes(24).toString('hex');
  clientSessions.set(sessionToken, { clientId: entry.clientId, nome: entry.nome, email: entry.email, telefone: entry.telefone, createdAt: Date.now() });
  res.setHeader('Set-Cookie', clientSessionCookie(sessionToken, Math.floor(CLIENT_SESSION_TTL_MS / 1000)));
  return res.json({ ok: true, client: { id: entry.clientId, nome: entry.nome, email: entry.email } });
});

app.post('/api/client/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail obrigatório.' });
  try {
    if (MYSQL_ENABLED) {
      await initDatabase();
      const [rows] = await mysqlPool.execute('SELECT id, nome FROM lemoov_clients WHERE email = ?', [email]);
      if (rows.length) {
        const { id, nome } = rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        resetTokens.set(token, { clientId: id, email, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });
        const resetUrl = `${getPublicBaseUrl(req)}/cliente-login.html?token=${token}`;
        await sendResetEmail(email, nome, resetUrl).catch((e) => console.error('[reset-email]', e.message));
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[forgot-password]', e.message);
    return res.json({ ok: true });
  }
});

app.post('/api/client/reset-password', async (req, res) => {
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha || String(novaSenha).length < 8)
    return res.status(400).json({ ok: false, error: 'Token e senha (mínimo 8 caracteres) são obrigatórios.' });
  const entry = resetTokens.get(String(token));
  if (!entry || Date.now() > entry.expiresAt) {
    resetTokens.delete(String(token));
    return res.status(400).json({ ok: false, error: 'Link expirado ou inválido. Solicite um novo.' });
  }
  try {
    if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
    await initDatabase();
    const senhaHash = hashClientPwd(String(novaSenha));
    await mysqlPool.execute('UPDATE lemoov_clients SET senha_hash = ? WHERE id = ?', [senhaHash, entry.clientId]);
    resetTokens.delete(String(token));
    const sessionToken = crypto.randomBytes(24).toString('hex');
    const [rows] = await mysqlPool.execute('SELECT nome, email, telefone FROM lemoov_clients WHERE id = ?', [entry.clientId]);
    const client = rows[0] || {};
    clientSessions.set(sessionToken, { clientId: entry.clientId, nome: client.nome || '', email: entry.email, telefone: client.telefone || '', createdAt: Date.now() });
    res.setHeader('Set-Cookie', clientSessionCookie(sessionToken, Math.floor(CLIENT_SESSION_TTL_MS / 1000)));
    return res.json({ ok: true });
  } catch (e) {
    console.error('[reset-password]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao redefinir senha.' });
  }
});

app.get('/api/client/addresses', clientAuthRequired, async (req, res) => {
  if (!MYSQL_ENABLED) {
    // Modo offline: retorna endereço fictício para testes
    return res.json({ ok: true, addresses: [{
      id: 1,
      cep: '60360760',
      logradouro: 'Rua das Esmeraldas',
      numero: '42',
      complemento: 'Apto 3',
      bairro: 'Maraponga',
      cidade: 'Fortaleza',
      uf: 'CE'
    }]});
  }
  try {
    await initDatabase();
    const [rows] = await mysqlPool.execute(
      'SELECT id, cep, logradouro, numero, complemento, bairro, cidade, uf FROM lemoov_client_addresses WHERE client_id = ? ORDER BY id',
      [req.clientSession.clientId]
    );
    return res.json({ ok: true, addresses: rows });
  } catch (e) {
    console.error('[client/addresses GET]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar endereços.' });
  }
});

app.post('/api/client/addresses', clientAuthRequired, async (req, res) => {
  if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
  const { cep, logradouro, numero, complemento, bairro, cidade, uf } = req.body || {};
  if (!cep || !logradouro || !numero || !cidade || !uf) return res.status(400).json({ ok: false, error: 'CEP, logradouro, número, cidade e UF são obrigatórios.' });
  try {
    await initDatabase();
    const [result] = await mysqlPool.execute(
      'INSERT INTO lemoov_client_addresses (client_id, cep, logradouro, numero, complemento, bairro, cidade, uf) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.clientSession.clientId, String(cep).replace(/\D/g, ''), String(logradouro), String(numero), String(complemento || '') || null, String(bairro || '') || null, String(cidade), String(uf)]
    );
    return res.status(201).json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error('[client/addresses POST]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao salvar endereço.' });
  }
});

app.delete('/api/client/addresses/:id', clientAuthRequired, async (req, res) => {
  if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
  try {
    await initDatabase();
    await mysqlPool.execute(
      'DELETE FROM lemoov_client_addresses WHERE id = ? AND client_id = ?',
      [Number(req.params.id), req.clientSession.clientId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[client/addresses DELETE]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao remover endereço.' });
  }
});

app.get('/api/client/orders', clientAuthRequired, async (req, res) => {
  try {
    const pedidos = await readPedidosStore();
    const clientId = String(req.clientSession.clientId || '');
    const email = String(req.clientSession.email || '').toLowerCase();
    const mine = pedidos
      .filter((pedido) => {
        const pedidoClientId = String(pedido.client_id || pedido.cliente?.id || '');
        const pedidoEmail = String(pedido.cliente_email || pedido.cliente?.email || '').toLowerCase();
        return (clientId && pedidoClientId === clientId) || (email && pedidoEmail === email);
      })
      .sort((a, b) => new Date(b.recebidoEm || b.confirmedAt || b.createdAt || 0) - new Date(a.recebidoEm || a.confirmedAt || a.createdAt || 0))
      .map((pedido) => ({
        pedido: pedido.pedido || pedido.order_number || '',
        status: pedido.status || pedido.pagamento_status || '',
        total: Number(pedido.total || 0),
        createdAt: pedido.recebidoEm || pedido.confirmedAt || pedido.createdAt || '',
        frete_modo: pedido.frete_modo || '',
        retirada: Boolean(pedido.retirada),
        itens: Array.isArray(pedido.itens) ? pedido.itens.map((item) => ({
          item_name: item.item_name || item.nome || item.name || '',
          quantity: Number(item.quantity || item.quantidade || 1),
          price: Number(item.price || item.preco || 0)
        })) : []
      }));
    return res.json({ ok: true, orders: mine });
  } catch (e) {
    console.error('[client/orders GET]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar pedidos.' });
  }
});

// Rota dev: cria sessão de cliente sem MySQL (só disponível fora de produção)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/test-session', (req, res) => {
    const nome = req.query.nome || 'Cliente Teste';
    const email = req.query.email || 'teste@lemoov.com.br';
    const token = crypto.randomBytes(24).toString('hex');
    clientSessions.set(token, { clientId: 999, nome, email, telefone: req.query.telefone || '85999990000', createdAt: Date.now() });
    res.setHeader('Set-Cookie', clientSessionCookie(token, 3600));
    const redirect = req.query.redirect || '/catalogo-produtos.html';
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${redirect}"></head><body>
      <p style="font-family:sans-serif;padding:20px">Sessão de teste criada para <strong>${nome}</strong>. Redirecionando…</p>
    </body></html>`);
  });
}

// ── Motor de Frete Híbrido ────────────────────────────────────────────────

function _normalizarCidade(cidade) {
  return (cidade || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function _consultarMelhorEnvioSedex(cepDestino) {
  const token = process.env.MELHOR_ENVIO_TOKEN;
  if (!token) throw new Error('MELHOR_ENVIO_TOKEN não configurado');

  const cepOrigem = (process.env.CEP_ORIGEM || '60360760').replace(/\D/g, '');
  const cepDest   = String(cepDestino).replace(/\D/g, '');

  const baseUrl = process.env.NODE_ENV === 'production'
    ? 'https://www.melhorenvio.com.br'
    : 'https://sandbox.melhorenvio.com.br';

  const resp = await fetch(`${baseUrl}/api/v2/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Lemoov/1.0 (contato@lemoov.com.br)'
    },
    body: JSON.stringify({
      from: { postal_code: cepOrigem },
      to:   { postal_code: cepDest },
      package: { height: 5, width: 20, length: 25, weight: 0.5 },
      options: { insurance_value: 50, receipt: false, own_hand: false },
      services: '4'   // 4 = SEDEX na Melhor Envio
    })
  });

  if (!resp.ok) throw new Error(`Melhor Envio HTTP ${resp.status}`);
  const data = await resp.json();

  // Retorna o primeiro serviço com preço válido (sem campo error)
  const option = Array.isArray(data)
    ? data.find(s => s.price && !s.error)
    : (data.price && !data.error ? data : null);
  if (!option) throw new Error('Nenhuma opção SEDEX disponível para esta rota');

  return parseFloat(option.price);
}

async function calcularFreteDoPedido(cidade, cepDestino) {
  const cidadeLimpa = _normalizarCidade(cidade);

  // Região Metropolitana de Fortaleza — taxas fixas
  if (cidadeLimpa === 'fortaleza' || cidadeLimpa === 'caucaia') {
    return { tipo: 'Entrega Local', valor: 12.00, label: 'Entrega Local – R$ 12,00' };
  }
  if (cidadeLimpa === 'maracanau') {
    return { tipo: 'Entrega Local', valor: 15.00, label: 'Entrega Local – R$ 15,00' };
  }
  if (['eusebio', 'itaitinga', 'pacatuba'].includes(cidadeLimpa)) {
    return { tipo: 'Entrega Local', valor: 25.00, label: 'Entrega Local – R$ 25,00' };
  }

  // Demais localidades — SEDEX via Melhor Envio (com contingência)
  try {
    const valorSedex = await _consultarMelhorEnvioSedex(cepDestino);
    return { tipo: 'SEDEX', valor: valorSedex, label: `SEDEX – R$ ${valorSedex.toFixed(2).replace('.', ',')}` };
  } catch (err) {
    console.error('[frete] Falha na API SEDEX, aplicando contingência:', err.message);
    return { tipo: 'SEDEX', valor: 30.00, label: 'SEDEX – R$ 30,00 (estimativa)', contingencia: true };
  }
}

app.post('/api/frete', async (req, res) => {
  const { cidade, cep } = req.body || {};
  if (!cidade && !cep) {
    return res.status(400).json({ ok: false, error: 'Informe cidade ou CEP.' });
  }
  try {
    const resultado = await calcularFreteDoPedido(
      String(cidade || ''),
      String(cep || '').replace(/\D/g, '')
    );
    return res.json({ ok: true, ...resultado });
  } catch (e) {
    console.error('[/api/frete]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao calcular frete.' });
  }
});

// ──────────────────────────────────────────────────────────────────────────

app.post('/api/pedidos', async (req, res) => {
  let conn = null;
  try {
    if (!isPaidOrderStatus(req.body || {})) {
      return res.status(400).json({
        ok: false,
        error: 'Pedido só é registrado após confirmação de pagamento.'
      });
    }
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const pedidos = await readPedidosStore(conn);
    const produtos = ensureProductIds(await readProdutosStore(conn));
    const numeroPedido = String(req.body?.pedido || '').trim() || generateOrderNumber(pedidos);
    const itensReserva = Array.isArray(req.body?.itensEstoque)
      ? req.body.itensEstoque
      : (Array.isArray(req.body?.itens) ? req.body.itens : []);

    reserveStock(produtos, itensReserva);
    await writeProdutosStore(produtos, conn);
    const pedido = {
      ...req.body,
      pedido: numeroPedido,
      status: req.body?.status || 'confirmado',
      estoqueBaixado: true,
      recebidoEm: new Date().toISOString()
    };
    await appendPedidoStore(pedido, conn);
    if (conn) await conn.commit();
    res.json({ ok: true, pedido: numeroPedido });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    console.error(e);
    const isStockError = /Estoque insuficiente|Produto não encontrado|Item esgotado/.test(e?.message || '');
    res.status(isStockError ? 409 : 500).json({ ok: false, error: e?.message || 'Falha ao salvar' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const { user, pass, redirect } = req.body || {};
  let valid = user === ADMIN_USER && pass === ADMIN_PASS;
  if (!valid && MYSQL_ENABLED) {
    try {
      await initDatabase();
      const [rows] = await mysqlPool.execute(
        'SELECT password_hash FROM lemoov_users WHERE username = ?',
        [user]
      );
      if (rows.length > 0) {
        const [salt, storedHash] = rows[0].password_hash.split(':');
        const hash = crypto.scryptSync(String(pass || ''), salt, 64).toString('hex');
        valid = hash === storedHash;
      }
    } catch (e) {
      console.error('Erro no login via banco:', e.message);
    }
  }
  if (valid) {
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, { user, createdAt: Date.now() });
    res.setHeader('Set-Cookie', `lemoov_session=${token}; HttpOnly; Path=/; SameSite=Lax`);
    return res.json({ ok: true, redirect: redirect || '/api/produtos-admin' });
  }
  return res.status(401).json({ ok: false });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.lemoov_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'lemoov_session=; Max-Age=0; Path=/; SameSite=Lax');
  res.json({ ok: true });
});

app.post('/api/admin/reset-admin-user', authRequired, async (_req, res) => {
  if (!MYSQL_ENABLED) return res.status(400).json({ ok: false, error: 'MySQL não configurado' });
  try {
    await initDatabase();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(ADMIN_PASS, salt, 64).toString('hex');
    await mysqlPool.execute('DELETE FROM lemoov_users WHERE username = ?', [ADMIN_USER]);
    await mysqlPool.execute(
      'INSERT INTO lemoov_users (username, password_hash) VALUES (?, ?)',
      [ADMIN_USER, `${salt}:${hash}`]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/pagamentos/infinitypay', async (req, res) => {
  try {
    const { metodo, total, itens, itensEstoque, cliente, endereco, pedidoPayload } = req.body || {};
    const returnPathRaw = String(req.body?.returnPath || '/catalogo-produtos.html');
    const returnPath = /^\/[a-z0-9._~/%-]*$/i.test(returnPathRaw) ? returnPathRaw : '/catalogo-produtos.html';
    const pedidos = await readPedidosStore();
    const pendingPayments = await readPendingPaymentsStore();
    const orderNsu = generateOrderNumber([...pedidos, ...pendingPayments]);
    const paymentItems = normalizePaymentItems(itens);
    const intent = {
      pedido: orderNsu,
      order_nsu: orderNsu,
      status: 'aguardando_pagamento',
      total: Number(total || 0),
      currency: req.body?.currency || 'BRL',
      metodo: metodo || 'online',
      cliente: cliente || {},
      endereco: endereco || {},
      itens: Array.isArray(pedidoPayload?.itens) ? pedidoPayload.itens : [],
      itensEstoque: Array.isArray(itensEstoque) ? itensEstoque : [],
      pedidoPayload: pedidoPayload && typeof pedidoPayload === 'object' ? pedidoPayload : {},
      createdAt: new Date().toISOString()
    };
    const produtos = ensureProductIds(await readProdutosStore());
    validateStockAvailability(produtos, intent.itensEstoque);

    if (!INFINITEPAY_HANDLE) {
      await savePendingPaymentStore({
        ...intent,
        payment_reference: `dev-${orderNsu}`,
        configured: false
      });
      return res.json({
        ok: true,
        configured: false,
        provider: 'infinitepay',
        paymentId: `dev-${orderNsu}`,
        checkoutUrl: '',
        message: 'InfinitePay ainda sem handle configurado. Pedido segue em modo assistido.'
      });
    }

    if (!paymentItems.length) {
      return res.status(400).json({ ok: false, error: 'Pedido sem itens válidos para pagamento.' });
    }

    const baseUrl = getPublicBaseUrl(req);
    const redirectUrl = new URL(`${baseUrl}/obrigado.html`);
    redirectUrl.searchParams.set('pedido', orderNsu);
    redirectUrl.searchParams.set('voltar', returnPath);
    const payload = {
      handle: INFINITEPAY_HANDLE,
      redirect_url: redirectUrl.toString(),
      webhook_url: `${baseUrl}/api/webhooks/infinitepay`,
      order_nsu: orderNsu,
      items: paymentItems
    };

    if (cliente?.nome || cliente?.email || cliente?.telefone) {
      payload.customer = {};
      if (cliente.nome) payload.customer.name = cliente.nome;
      if (cliente.email) payload.customer.email = cliente.email;
      if (cliente.telefone) {
        const digits = cliente.telefone.replace(/\D/g, '');
        payload.customer.phone_number = digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
      }
    }

    if (endereco?.cep) {
      payload.address = {
        cep:         String(endereco.cep).replace(/\D/g, ''),
        logradouro:  String(endereco.rua || endereco.logradouro || ''),
        numero:      String(endereco.numero || ''),
        complemento: String(endereco.complemento || '') || undefined,
        bairro:      String(endereco.bairro || ''),
        cidade:      String(endereco.cidade || ''),
        uf:          String(endereco.uf || ''),
      };
      if (!payload.address.complemento) delete payload.address.complemento;
    }
    const response = await fetch(INFINITEPAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    const checkoutUrl = data.checkout_url || data.url || '';
    if (!response.ok || !checkoutUrl) {
      return res.status(response.status || 502).json({
        ok: false,
        configured: true,
        provider: 'infinitepay',
        error: data?.message || data?.error || 'Não foi possível gerar o link de pagamento InfinitePay.'
      });
    }

    await savePendingPaymentStore({
      ...intent,
      payment_reference: orderNsu,
      checkout: data,
      configured: true
    });

    return res.json({
      ok: true,
      configured: true,
      provider: 'infinitepay',
      paymentId: orderNsu,
      method: metodo || 'pix',
      amount: Number(total || 0),
      checkoutUrl,
      checkout: data
    });
  } catch (e) {
    console.error('[infinitepay] erro:', e.message);
    const isStockError = /Estoque insuficiente|Produto não encontrado|Item esgotado/.test(e?.message || '');
    res.status(isStockError ? 409 : 500).json({ ok: false, error: isStockError ? e.message : 'Falha ao preparar pagamento.' });
  }
});

app.post('/api/webhooks/infinitepay', async (req, res) => {
  let conn = null;
  try {
    const body = req.body || {};
    const orderNsu = String(body.order_nsu || '').trim();
    if (!orderNsu) {
      return res.status(400).json({ ok: false, error: 'order_nsu ausente.' });
    }

    const paymentUpdates = {
      status: 'confirmado',
      pagamento_status: 'pago',
      payment_provider: 'infinitepay',
      payment_method: body.capture_method || '',
      payment_transaction_nsu: body.transaction_nsu || '',
      payment_invoice_slug: body.invoice_slug || '',
      payment_receipt_url: body.receipt_url || '',
      payment_amount: Number(body.amount || 0) / 100,
      payment_paid_amount: Number(body.paid_amount || 0) / 100,
      payment_installments: Number(body.installments || 1),
      payment_webhook: body,
      confirmedAt: new Date().toISOString()
    };

    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }

    const pending = await readPendingPaymentStore(orderNsu, conn);
    if (pending) {
      const existing = await readPedidoStore(orderNsu, conn);
      if (existing) {
        await updatePedidoStore(orderNsu, paymentUpdates);
        await deletePendingPaymentStore(orderNsu, conn);
      } else {
        const produtos = ensureProductIds(await readProdutosStore(conn));
        const itensReserva = Array.isArray(pending.itensEstoque) ? pending.itensEstoque : [];
        reserveStock(produtos, itensReserva);
        await writeProdutosStore(produtos, conn);
        const basePedido = pending.pedidoPayload || {};
        const pedido = {
          ...basePedido,
          pedido: orderNsu,
          status: 'confirmado',
          total: Number(basePedido.total || pending.total || paymentUpdates.payment_amount || 0),
          currency: basePedido.currency || pending.currency || 'BRL',
          itens: Array.isArray(basePedido.itens) && basePedido.itens.length ? basePedido.itens : (pending.itens || []),
          subtotal: Number(basePedido.subtotal || 0),
          taxa: Number(basePedido.taxa || 0),
          frete_modo: basePedido.frete_modo || pending.frete_modo || '',
          retirada: Boolean(basePedido.retirada || pending.retirada),
          cep: basePedido.cep || pending.endereco?.cep || '',
          cidade: basePedido.cidade || pending.endereco?.cidade || '',
          uf: basePedido.uf || pending.endereco?.uf || '',
          bairro: basePedido.bairro || pending.endereco?.bairro || '',
          rua: basePedido.rua || pending.endereco?.rua || '',
          itensEstoque: itensReserva,
          cliente: pending.cliente || basePedido.cliente || {},
          estoqueBaixado: true,
          recebidoEm: new Date().toISOString(),
          ...paymentUpdates
        };
        await appendPedidoStore(pedido, conn);
        await deletePendingPaymentStore(orderNsu, conn);
        notifyOrderConfirmed(pedido).catch((e) => console.error('[notify]', e.message));
      }
      if (conn) await conn.commit();
      return res.json({ ok: true });
    }

    const pedidoExistente = await readPedidoStore(orderNsu, conn);
    await updatePedidoStore(orderNsu, paymentUpdates);
    if (conn) await conn.commit();
    if (pedidoExistente) {
      notifyOrderConfirmed({ ...pedidoExistente, ...paymentUpdates }).catch((e) => console.error('[notify]', e.message));
    }
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    console.error('[infinitepay:webhook] erro:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    storage: MYSQL_ENABLED ? 'mysql' : 'json',
    mysqlEnabled: MYSQL_ENABLED
  });
});

app.get('/api/pedidos', authRequired, async (req, res) => {
  try {
    const pedidos = await readPedidosStore();
    res.json(pedidos);
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/relatorio', authRequired, (req, res) => {
  res.sendFile(path.join(__dirname, 'relatorio.html'));
});

app.get('/relatorio.html', authRequired, (_req, res) => {
  res.sendFile(path.join(__dirname, 'relatorio.html'));
});

app.get('/api/produtos', async (req, res) => {
  try {
    const all = await readProdutosStore();
    const publicos = all
      .filter(p => p.ativo !== false)
      .map(p => ({
        ...p,
        cores: Array.isArray(p.cores) ? p.cores.filter(c => c.ativo !== false) : p.cores
      }))
      .sort((a, b) => (Number(a.ordem) || 9999) - (Number(b.ordem) || 9999));
    res.json(publicos);
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/produtos-admin', authRequired, (req, res) => {
  res.sendFile(path.join(__dirname, 'produtos-admin.html'));
});

app.get('/produtos-admin.html', authRequired, (_req, res) => {
  res.sendFile(path.join(__dirname, 'produtos-admin.html'));
});

app.get('/api/admin/produtos', authRequired, async (req, res) => {
  try {
    const produtos = await readProdutosStore();
    res.json(produtos);
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

// Diagnóstico: mostra ativo de cada produto e cor como salvo no banco
app.get('/api/admin/debug-ativo', authRequired, async (_req, res) => {
  try {
    const produtos = await readProdutosStore();
    res.json(produtos.map(p => ({
      id: p.id, nome: p.nome, ativo: p.ativo,
      cores: (p.cores || []).map(c => ({ nome: c.nome, ativo: c.ativo }))
    })));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/produtos', authRequired, async (req, res) => {
  try {
    const produtos = ensureProductIds(await readProdutosStore());
    const nextId = produtos.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
    const item = { ...req.body, id: nextId, updatedAt: new Date().toISOString() };
    produtos.push(item);
    await writeProdutosStore(produtos);
    res.json({ ok: true, item });
  } catch (e) {
    console.error('[POST /api/admin/produtos]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false });
  const relPath = path.join(UPLOAD_PUBLIC_PREFIX, req.file.filename).replace(/\\/g, '/');
  res.json({ ok: true, path: relPath });
});

app.put('/api/admin/produtos/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const produtos = ensureProductIds(await readProdutosStore());
    const idx = produtos.findIndex((p) => Number(p.id) === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    produtos[idx] = { ...produtos[idx], ...req.body, id, updatedAt: new Date().toISOString() };
    const coresLog = (produtos[idx].cores || []).map(c => `${c.nome}:ativo=${c.ativo}`).join(', ');
    console.log(`[PUT produto ${id}] cores: ${coresLog}`);
    await writeProdutosStore(produtos);
    res.json({ ok: true, item: produtos[idx] });
  } catch (e) {
    console.error('[PUT /api/admin/produtos]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/admin/produtos/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const produtos = ensureProductIds(await readProdutosStore());
    const next = produtos.filter((p) => Number(p.id) !== id);
    await writeProdutosStore(next);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/admin/produtos]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/sync-produtos', authRequired, async (req, res) => {
  try {
    const local = ensureProductIds(readProdutos());
    await writeProdutosStore(local);
    res.json({ ok: true, total: local.length });
  } catch (e) {
    console.error('[sync-produtos]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/admin/produtos/ordem', authRequired, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ ok: false, error: 'ids required' });
    const produtos = await readProdutosStore();
    const idSet = new Set(ids.map(Number));
    ids.forEach((id, index) => {
      const p = produtos.find(p => Number(p.id) === Number(id));
      if (p) p.ordem = index + 1;
    });
    produtos.filter(p => !idSet.has(Number(p.id))).forEach((p, i) => {
      p.ordem = ids.length + i + 1;
    });
    await writeProdutosStore(produtos);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/entrada-estoque', authRequired, async (req, res) => {
  try {
    const { produtoId, corIndex, quantidades } = req.body || {};
    if (!produtoId || !quantidades || typeof quantidades !== 'object') {
      return res.status(400).json({ ok: false, error: 'Dados inválidos' });
    }
    const produtos = ensureProductIds(await readProdutosStore());
    const prod = produtos.find((p) => Number(p.id) === Number(produtoId));
    if (!prod) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    const cor = Array.isArray(prod.cores) ? prod.cores[Number(corIndex) || 0] : null;
    if (!cor) return res.status(404).json({ ok: false, error: 'Cor não encontrada' });
    if (!cor.estoque || typeof cor.estoque !== 'object' || Array.isArray(cor.estoque)) {
      cor.estoque = {};
    }
    Object.entries(quantidades).forEach(([size, qty]) => {
      const s = String(size).trim().toUpperCase();
      if (!s) return;
      cor.estoque[s] = Math.max(0, (Number(cor.estoque[s]) || 0) + (Math.max(0, Number(qty)) || 0));
    });
    cor.tamanhos = Object.keys(cor.estoque).filter((s) => Number(cor.estoque[s]) > 0);
    cor.soldOut = cor.tamanhos.length === 0;
    const allManaged = prod.cores.every((c) => c.estoque && typeof c.estoque === 'object' && !Array.isArray(c.estoque));
    if (allManaged) {
      prod.soldOut = prod.cores.every((c) => Object.values(c.estoque).every((q) => Number(q) <= 0));
    }
    prod.updatedAt = new Date().toISOString();
    await writeProdutosStore(produtos);
    res.json({ ok: true, produto: prod });
  } catch (e) {
    console.error('[entrada-estoque]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/admin/pedido/:numero', authRequired, async (req, res) => {
  let conn = null;
  try {
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const existing = await readPedidoStore(req.params.numero, conn);
    if (!existing) throw new Error('Pedido não encontrado');
    const nextOrder = { ...existing, ...req.body, pedido: req.params.numero };
    const shouldDebitStock = !existing.estoqueBaixado && !isPaidOrderStatus(existing) && isPaidOrderStatus(nextOrder);
    const updates = { ...req.body };
    if (shouldDebitStock) {
      const produtos = ensureProductIds(await readProdutosStore(conn));
      const itensReserva = Array.isArray(nextOrder.itensEstoque)
        ? nextOrder.itensEstoque
        : (Array.isArray(nextOrder.itens) ? nextOrder.itens : []);
      reserveStock(produtos, itensReserva);
      await writeProdutosStore(produtos, conn);
      updates.estoqueBaixado = true;
    }
    const item = await updatePedidoStore(req.params.numero, updates, conn);
    if (conn) await conn.commit();
    res.json({ ok: true, item });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    const isStockError = /Estoque insuficiente|Produto não encontrado|Item esgotado/.test(e?.message || '');
    res.status(isStockError ? 409 : 500).json({ ok: false, error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/admin/pedido/:numero', authRequired, async (req, res) => {
  try {
    await deletePedidoStore(req.params.numero);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/pedido', authRequired, async (req, res) => {
  let conn = null;
  try {
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const pedidos = await readPedidosStore(conn);
    const numeroPedido = String(req.body?.pedido || '').trim() || generateOrderNumber(pedidos);
    const pedido = { ...req.body, pedido: numeroPedido, status: req.body?.status || 'confirmado', recebidoEm: new Date().toISOString(), origem: 'admin' };
    if (isPaidOrderStatus(pedido)) {
      const produtos = ensureProductIds(await readProdutosStore(conn));
      const itensReserva = Array.isArray(pedido.itensEstoque)
        ? pedido.itensEstoque
        : (Array.isArray(pedido.itens) ? pedido.itens : []);
      reserveStock(produtos, itensReserva);
      await writeProdutosStore(produtos, conn);
      pedido.estoqueBaixado = true;
    }
    await appendPedidoStore(pedido, conn);
    if (conn) await conn.commit();
    res.json({ ok: true, pedido: numeroPedido, item: pedido });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    const isStockError = /Estoque insuficiente|Produto não encontrado|Item esgotado/.test(e?.message || '');
    res.status(isStockError ? 409 : 500).json({ ok: false, error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

// Prevent proxy/CDN caching of HTML pages so updates reach users immediately
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(__dirname)); // serve index.html, script.js, etc.
if (path.resolve(UPLOAD_DIR) !== path.resolve(path.join(__dirname, UPLOAD_PUBLIC_PREFIX))) {
  app.use(`/${UPLOAD_PUBLIC_PREFIX}`, express.static(UPLOAD_DIR));
}

const PORT = process.env.PORT || 3000;
initDatabase()
  .catch((err) => {
    console.error('Falha ao inicializar banco de dados. O site vai subir, mas APIs com MySQL podem falhar:', err);
  })
  .then(() => {
    app.listen(PORT, () => {
      const storage = MYSQL_ENABLED ? 'MySQL' : 'JSON local';
      console.log(`Servidor no ar http://localhost:${PORT} (${storage})`);
    });
  });
