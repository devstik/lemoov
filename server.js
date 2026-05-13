const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const app = express();

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
async function updatePedidoStore(numero, updates) {
  if (!MYSQL_ENABLED) {
    const pedidos = readPedidos();
    const idx = pedidos.findIndex((p) => String(p.pedido) === String(numero));
    if (idx === -1) throw new Error('Pedido não encontrado');
    pedidos[idx] = { ...pedidos[idx], ...updates, pedido: numero };
    writePedidos(pedidos);
    return pedidos[idx];
  }
  await initDatabase();
  const [rows] = await mysqlPool.execute('SELECT data FROM lemoov_orders WHERE order_number = ?', [String(numero)]);
  if (!rows.length) throw new Error('Pedido não encontrado');
  const updated = { ...JSON.parse(rows[0].data), ...updates, pedido: numero };
  await mysqlPool.execute('UPDATE lemoov_orders SET data = ? WHERE order_number = ?', [JSON.stringify(updated), String(numero)]);
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
  const stockItems = itens
    .map((item) => ({
      productId: Number(item.productId),
      colorIndex: Number(item.colorIndex) || 0,
      tamanho: normalizeKey(item.tamanhoSelecionado || item.tamanho || 'UNICO'),
      quantidade: Math.max(1, Number(item.quantidade) || 1),
      nome: item.nome || ''
    }))
    .filter((item) => Number.isFinite(item.productId));

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
      throw new Error(`Estoque insuficiente para ${label}.`);
    }
  }

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

app.post('/api/pedidos', async (req, res) => {
  let conn = null;
  try {
    const status = String(req.body?.status || '').toLowerCase();
    const paymentStatus = String(req.body?.pagamento_status || '').toLowerCase();
    const isPaidOrder = ['confirmado', 'enviado', 'entregue'].includes(status) || paymentStatus === 'pago';
    if (!isPaidOrder) {
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
    const isStockError = /Estoque insuficiente|Produto não encontrado/.test(e?.message || '');
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
      payload.address = { cep: String(endereco.cep).replace(/\D/g, '') };
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
    res.status(500).json({ ok: false, error: 'Falha ao preparar pagamento.' });
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
          recebidoEm: new Date().toISOString(),
          ...paymentUpdates
        };
        await appendPedidoStore(pedido, conn);
        await deletePendingPaymentStore(orderNsu, conn);
      }
      if (conn) await conn.commit();
      return res.json({ ok: true });
    }

    await updatePedidoStore(orderNsu, paymentUpdates);
    if (conn) await conn.commit();

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
  try {
    const item = await updatePedidoStore(req.params.numero, req.body);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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
  try {
    const pedidos = await readPedidosStore();
    const numeroPedido = String(req.body?.pedido || '').trim() || generateOrderNumber(pedidos);
    const pedido = { ...req.body, pedido: numeroPedido, status: req.body?.status || 'confirmado', recebidoEm: new Date().toISOString(), origem: 'admin' };
    await appendPedidoStore(pedido);
    res.json({ ok: true, pedido: numeroPedido, item: pedido });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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
