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

function readProdutos() {
  try {
    return JSON.parse(fs.readFileSync(PROD_PATH, 'utf-8'));
  } catch (_e) {
    return [];
  }
}
function requireMysqlStorage() {
  if (!MYSQL_ENABLED) throw new Error('Banco de dados MySQL obrigatório. Persistência local/JSON desativada.');
}
async function initDatabase() {
  requireMysqlStorage();
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
      CREATE TABLE IF NOT EXISTS lemoov_stock_movements (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        data LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_stock_created_at (created_at)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_coupons (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(60) NOT NULL UNIQUE,
        percent DECIMAL(5,2) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_crm_sessions (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL UNIQUE,
        ip VARCHAR(45),
        cidade VARCHAR(100),
        regiao VARCHAR(100),
        pais VARCHAR(100),
        client_id INT NULL,
        cliente_nome VARCHAR(200),
        first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        time_on_site INT NOT NULL DEFAULT 0
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS lemoov_crm_events (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        type VARCHAR(50) NOT NULL,
        product_id VARCHAR(50),
        product_name VARCHAR(200),
        order_id VARCHAR(50),
        total DECIMAL(10,2),
        page VARCHAR(500),
        ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_crm_session (session_id),
        INDEX idx_crm_ts (ts)
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
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT id, data FROM lemoov_products ORDER BY id');
  return rows.map((row) => {
    const item = JSON.parse(row.data);
    return { ...item, id: Number(item.id || row.id) };
  });
}
async function writeProdutosStore(list, conn = null) {
  requireMysqlStorage();
  const canonical = ensureProductIds(list);
  await initDatabase();
  if (conn) {
    await conn.execute('DELETE FROM lemoov_products');
    for (const item of canonical) {
      await conn.execute(
        'INSERT INTO lemoov_products (id, data) VALUES (?, ?)',
        [Number(item.id), JSON.stringify(item)]
      );
    }
    return;
  }
  // When no external transaction is provided, wrap in one to prevent partial writes
  const localConn = await mysqlPool.getConnection();
  try {
    await localConn.beginTransaction();
    await localConn.execute('DELETE FROM lemoov_products');
    for (const item of canonical) {
      await localConn.execute(
        'INSERT INTO lemoov_products (id, data) VALUES (?, ?)',
        [Number(item.id), JSON.stringify(item)]
      );
    }
    await localConn.commit();
  } catch (e) {
    await localConn.rollback().catch(() => {});
    throw e;
  } finally {
    localConn.release();
  }
}
async function readPedidosStore(conn = null) {
  requireMysqlStorage();
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
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_orders WHERE order_number = ?', [pedidoNumero]);
  if (!rows.length) return null;
  const item = JSON.parse(rows[0].data);
  return { ...item, pedido: item.pedido || rows[0].order_number };
}
async function readStockMovementsStore(conn = null) {
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT id, data, created_at FROM lemoov_stock_movements ORDER BY id DESC LIMIT 300');
  return rows.map((row) => {
    const item = JSON.parse(row.data);
    return { ...item, id: item.id || row.id, createdAt: item.createdAt || row.created_at };
  });
}
async function appendStockMovementsStore(items = [], conn = null) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return;
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  for (const item of list) {
    const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
    await db.execute('INSERT INTO lemoov_stock_movements (data, created_at) VALUES (?, ?)', [JSON.stringify(item), createdAt]);
  }
}
function requireStockMovementDatabase() {
  requireMysqlStorage();
}
function requireDatabaseFeature(name) {
  requireMysqlStorage();
}
async function readCouponsStore() {
  requireDatabaseFeature('Cupons');
  await initDatabase();
  const [rows] = await mysqlPool.execute('SELECT id, code, percent, active, created_at AS createdAt, updated_at AS updatedAt FROM lemoov_coupons ORDER BY code');
  return rows.map((r) => ({ ...r, percent: Number(r.percent), active: Boolean(r.active) }));
}
async function getCouponStore(code) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  requireDatabaseFeature('Cupons');
  await initDatabase();
  const [rows] = await mysqlPool.execute('SELECT id, code, percent, active FROM lemoov_coupons WHERE code = ? LIMIT 1', [normalized]);
  if (!rows.length) return null;
  return { ...rows[0], percent: Number(rows[0].percent), active: Boolean(rows[0].active) };
}
async function calculateDiscounts({ subtotal = 0, cpf = '', couponCode = '', pedidos = null } = {}) {
  requireDatabaseFeature('Descontos');
  const base = Math.max(0, Number(subtotal) || 0);
  const currentPedidos = Array.isArray(pedidos) ? pedidos : await readPedidosStore();
  const discounts = [];
  const cleanCpf = normalizeCpf(cpf);
  if (cleanCpf.length === 11 && !hasCpfPurchase(currentPedidos, cleanCpf)) {
    discounts.push({ type: 'first_purchase', label: 'Primeira compra CPF', percent: 20, amount: roundMoney(base * 0.20) });
  }
  const normalizedCoupon = normalizeCouponCode(couponCode);
  if (normalizedCoupon) {
    const coupon = await getCouponStore(normalizedCoupon);
    if (!coupon || !coupon.active) {
      const err = new Error('Cupom inválido ou inativo.');
      err.status = 400;
      throw err;
    }
    discounts.push({ type: 'coupon', label: `Cupom ${coupon.code}`, code: coupon.code, percent: coupon.percent, amount: roundMoney(base * (coupon.percent / 100)) });
  }
  let discountTotal = roundMoney(discounts.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  discountTotal = Math.min(base, discountTotal);
  return {
    cpf: cleanCpf,
    couponCode: normalizedCoupon,
    discounts,
    discountTotal,
    subtotalWithDiscount: roundMoney(Math.max(0, base - discountTotal))
  };
}
async function appendPedidoStore(item, conn = null) {
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute(
    'INSERT INTO lemoov_orders (order_number, data) VALUES (?, ?)',
    [String(item.pedido), JSON.stringify(item)]
  );
}
async function readPendingPaymentStore(numero, conn = null) {
  const orderNumber = String(numero);
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT order_number, data FROM lemoov_payment_intents WHERE order_number = ?', [orderNumber]);
  if (!rows.length) return null;
  const item = JSON.parse(rows[0].data);
  return { ...item, pedido: item.pedido || rows[0].order_number, order_nsu: item.order_nsu || rows[0].order_number };
}
async function readPendingPaymentsStore(conn = null) {
  requireMysqlStorage();
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
  requireMysqlStorage();
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
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  await db.execute('DELETE FROM lemoov_payment_intents WHERE order_number = ?', [orderNumber]);
}
async function updatePedidoStore(numero, updates, conn = null) {
  requireMysqlStorage();
  await initDatabase();
  const db = conn || mysqlPool;
  const [rows] = await db.execute('SELECT data FROM lemoov_orders WHERE order_number = ?', [String(numero)]);
  if (!rows.length) throw new Error('Pedido não encontrado');
  const updated = { ...JSON.parse(rows[0].data), ...updates, pedido: numero };
  await db.execute('UPDATE lemoov_orders SET data = ? WHERE order_number = ?', [JSON.stringify(updated), String(numero)]);
  return updated;
}
async function deletePedidoStore(numero) {
  requireMysqlStorage();
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
function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}
function normalizeCouponCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}
function getOrderCpf(order = {}) {
  return normalizeCpf(order.cpf || order.cliente_cpf || order.cliente?.cpf || order.pedidoPayload?.cliente?.cpf || order.pedidoPayload?.cpf);
}
function orderCountsAsPurchase(order = {}) {
  const status = String(order.status || '').toLowerCase();
  if (status === 'cancelado') return false;
  return ['confirmado', 'enviado', 'entregue'].includes(status) || String(order.pagamento_status || '').toLowerCase() === 'pago';
}
function hasCpfPurchase(pedidos = [], cpf) {
  const clean = normalizeCpf(cpf);
  if (!clean || clean.length !== 11) return false;
  return pedidos.some((pedido) => getOrderCpf(pedido) === clean && orderCountsAsPurchase(pedido));
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
    if (!stock) {
      const label = [prod.nome, cor?.nome, item.tamanho].filter(Boolean).join(' - ');
      throw new Error(`Estoque insuficiente para ${label}. Estoque atual: 0.`);
    }
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
function shouldHoldStock(order = {}) {
  const status = String(order.status || '').toLowerCase();
  return ['confirmado', 'enviado', 'entregue'].includes(status);
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
  const movements = [];

  for (const item of stockItems) {
    const prod = produtos.find((p) => Number(p.id) === item.productId);
    const cor = Array.isArray(prod?.cores) ? prod.cores[item.colorIndex] : null;
    const stock = getColorStock(cor);
    if (!stock) continue;
    const before = Number(stock[item.tamanho]) || 0;
    const after = Math.max(0, before - item.quantidade);
    stock[item.tamanho] = after;
    movements.push({
      type: 'saida',
      reason: 'venda',
      productId: item.productId,
      productName: prod?.nome || item.nome || '',
      colorIndex: item.colorIndex,
      colorName: cor?.nome || '',
      size: item.tamanho,
      quantity: item.quantidade,
      before,
      after
    });
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
  return movements;
}

function restoreStock(produtos, itens = []) {
  const stockItems = normalizeStockItems(itens);
  const movements = [];

  for (const item of stockItems) {
    const prod = produtos.find((p) => Number(p.id) === item.productId);
    const cor = Array.isArray(prod?.cores) ? prod.cores[item.colorIndex] : null;
    const stock = getColorStock(cor);
    if (!stock) continue;
    const before = Math.max(0, Number(stock[item.tamanho]) || 0);
    const after = before + item.quantidade;
    stock[item.tamanho] = after;
    movements.push({
      type: 'entrada',
      reason: 'devolucao',
      productId: item.productId,
      productName: prod?.nome || item.nome || '',
      colorIndex: item.colorIndex,
      colorName: cor?.nome || '',
      size: item.tamanho,
      quantity: item.quantidade,
      before,
      after
    });
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
  return movements;
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
    const info = await smtp.sendMail({ from, to, subject, html });
    return { ok: true, provider: 'smtp', to, messageId: info?.messageId || '' };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] nenhum serviço configurado (SMTP_HOST ou RESEND_API_KEY). Email não enviado para: ${to}`);
    return { ok: false, provider: 'none', to, error: 'Nenhum serviço de e-mail configurado.' };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return { ok: true, provider: 'resend', to };
}

async function sendVerificationEmail(toEmail, toNome, code) {
  await sendEmail(toEmail, 'Confirme seu cadastro – Lemoov',
    `<p>Olá, ${toNome}!</p><p>Use o código abaixo para confirmar seu e-mail. Válido por 15 minutos.</p><h2 style="letter-spacing:6px">${code}</h2>`
  );
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

const CIDADES_LOCAIS = ['fortaleza','caucaia','maracanaú','maracanau','eusébio','eusebio','maranguape'];

function _addWorkingDays(base, days) {
  let d = new Date(base);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

function calcDeliveryEstimate(cidade, freteModo, confirmedAt, prazoDias) {
  const cidadeNorm = String(cidade || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const isLocal = CIDADES_LOCAIS.some((c) => cidadeNorm.includes(c.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  const base = confirmedAt ? new Date(confirmedAt) : new Date();
  const dow = base.getDay();
  const fmt = (d) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (isLocal) {
    let delivery;
    if (dow >= 1 && dow <= 4) {
      delivery = new Date(base); delivery.setDate(base.getDate() + 1);
    } else {
      const daysUntilMon = (8 - dow) % 7 || 7;
      delivery = new Date(base); delivery.setDate(base.getDate() + daysUntilMon);
    }
    return fmt(delivery);
  }

  if (prazoDias && Number(prazoDias) > 0) {
    const delivery = _addWorkingDays(base, Number(prazoDias));
    const carrier = String(freteModo || '').includes('sedex') ? 'SEDEX'
      : String(freteModo || '').includes('total') ? 'Total Express'
      : String(freteModo || '').includes('pac') ? 'PAC'
      : 'transportadora';
    return `até ${fmt(delivery)} (${prazoDias} dias úteis via ${carrier})`;
  }

  const modoLabel = String(freteModo || '').toLowerCase();
  if (modoLabel.includes('sedex'))                              return 'conforme prazo SEDEX (geralmente 1–3 dias úteis)';
  if (modoLabel.includes('total') || modoLabel.includes('express')) return 'conforme prazo Total Express';
  if (modoLabel.includes('pac'))                                return 'conforme prazo PAC (geralmente 5–10 dias úteis)';
  return 'conforme prazo da transportadora escolhida';
}

async function notifyOrderConfirmed(pedido) {
  const cliente   = pedido.cliente || pedido.pedidoPayload?.cliente || {};
  const nomeCliente = cliente.nome || pedido.cliente_nome || 'Cliente';
  const nome      = nomeCliente.split(' ')[0];
  const email     = cliente.email || pedido.cliente_email || '';
  const telefone  = cliente.telefone || pedido.cliente_telefone || '';
  const numero    = pedido.pedido || pedido.order_nsu || '';
  const total     = formatBRL(pedido.total || pedido.payment_paid_amount);
  const retirada    = Boolean(pedido.retirada);
  const cidade      = pedido.cidade || pedido.endereco?.cidade || '';
  const cep         = pedido.cep || pedido.endereco?.cep || '';
  const bairro      = pedido.bairro || pedido.endereco?.bairro || '';
  const complemento = pedido.complemento || pedido.endereco?.complemento || '';
  const uf          = pedido.uf || pedido.endereco?.uf || '';
  const entrega     = retirada ? 'Retirada na loja' : [
    pedido.rua, pedido.numero, complemento, bairro, cidade, uf, cep ? `CEP ${cep}` : ''
  ].filter(Boolean).join(', ');
  const prazo       = retirada ? '' : calcDeliveryEstimate(cidade, pedido.frete_modo, pedido.confirmedAt, pedido.frete_prazo_dias);

  const itensTexto = (pedido.itens || []).map((i) =>
    `• ${i.nome || i.description || 'Item'}${i.cor ? ` – ${i.cor}` : ''}${i.tamanho ? ` (${i.tamanho})` : ''} x${i.quantidade || i.qty || 1}`
  ).join('\n') || '–';

  const itensHtml = (pedido.itens || []).map((i) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${i.nome || i.description || 'Item'}${i.cor ? ` – ${i.cor}` : ''}${i.tamanho ? ` (${i.tamanho})` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">x${i.quantidade || i.qty || 1}</td></tr>`
  ).join('');

  const prazoHtml = prazo ? `<p><strong>Previsão de entrega:</strong> ${prazo}</p>` : '';
  const prazoWpp  = prazo ? `\n📅 *Previsão:* ${prazo}` : '';

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
        ${prazoHtml}
        <p style="margin-top:24px;color:#7f8ba4;font-size:13px">Qualquer dúvida, fale com a gente pelo WhatsApp!</p>
        <p style="color:#7f8ba4;font-size:12px">Lemoov Fitness</p>
      </div>`
    ).catch((e) => console.error('[notify email]', e.message));
  }

  if (telefone) {
    const wppMsg = `✅ *Pedido #${numero} confirmado!*\n\nOlá, ${nome}! Seu pagamento foi aprovado. 🎉\n\n${itensTexto}\n\n💰 *Total:* ${total}\n📦 *${retirada ? 'Retirada na loja' : `Entrega: ${entrega || '–'}`}*${prazoWpp}\n\nQualquer dúvida, fale com a gente pelo WhatsApp! 💚\n\n_Lemoov Fitness_`;
    await sendWhatsApp(telefone, wppMsg).catch((e) => console.error('[notify whatsapp]', e.message));
  }

  const storePhone = process.env.LEMOOV_WHATSAPP;
  if (storePhone) {
    const storeMsg = `🛍️ *Novo pedido recebido!*\n\n📦 *Pedido:* #${numero}\n👤 *Cliente:* ${nomeCliente}\n📱 *Telefone:* ${telefone || '–'}\n📧 *Email:* ${email || '–'}\n\n${itensTexto}\n\n💰 *Total:* ${total}\n🏠 *Endereço:* ${entrega || 'Retirada'}${prazoWpp}`;
    await sendWhatsApp(storePhone, storeMsg).catch((e) => console.error('[notify loja]', e.message));
  }

  const storeEmail = process.env.LEMOOV_STORE_EMAIL || process.env.ADMIN_EMAIL || process.env.FROM_EMAIL || '';
  if (storeEmail) {
    const confirmedAt = pedido.confirmedAt ? new Date(pedido.confirmedAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    const pagamento = pedido.payment_method || pedido.method || 'Pix';
    const itensLojaHtml = (pedido.itens || []).map((i) => {
      const preco = Number(i.price || i.preco || i.valor || 0);
      const qty = Number(i.quantidade || i.qty || 1);
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(i.nome || i.description || 'Item')}${i.cor ? ` – ${escapeHtml(i.cor)}` : ''}${i.tamanho ? ` (${escapeHtml(i.tamanho)})` : ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${preco ? formatBRL(preco) : '–'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${preco ? formatBRL(preco * qty) : '–'}</td>
      </tr>`;
    }).join('');
    await sendEmail(
      storeEmail,
      `🛍️ Novo pedido #${numero} – ${nomeCliente}`,
      `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a2a35">
        <h2 style="color:#009C3B;margin-bottom:4px">Novo pedido confirmado!</h2>
        <p style="color:#607080;margin-top:0">Pagamento aprovado em ${confirmedAt}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="background:#f8fafc">
            <th style="padding:8px 0;text-align:left;font-size:12px;color:#607080;border-bottom:2px solid #e2e8f0">Produto</th>
            <th style="padding:8px 0;text-align:center;font-size:12px;color:#607080;border-bottom:2px solid #e2e8f0">Qtd</th>
            <th style="padding:8px 0;text-align:right;font-size:12px;color:#607080;border-bottom:2px solid #e2e8f0">Unit.</th>
            <th style="padding:8px 0;text-align:right;font-size:12px;color:#607080;border-bottom:2px solid #e2e8f0">Linha</th>
          </tr>
          ${itensLojaHtml}
          <tr>
            <td colspan="3" style="padding:10px 0;text-align:right;font-weight:700">Total</td>
            <td style="padding:10px 0;text-align:right;font-weight:700;color:#009C3B">${total}</td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
          <tr><td style="padding:5px 0;color:#607080;width:120px">Pedido</td><td style="padding:5px 0;font-weight:600">#${escapeHtml(String(numero))}</td></tr>
          <tr><td style="padding:5px 0;color:#607080">Pagamento</td><td style="padding:5px 0;font-weight:600">${escapeHtml(pagamento)}</td></tr>
          <tr><td style="padding:5px 0;color:#607080">Cliente</td><td style="padding:5px 0">${escapeHtml(nomeCliente)}</td></tr>
          <tr><td style="padding:5px 0;color:#607080">Telefone</td><td style="padding:5px 0">${escapeHtml(telefone || '–')}</td></tr>
          <tr><td style="padding:5px 0;color:#607080">E-mail</td><td style="padding:5px 0">${escapeHtml(email || '–')}</td></tr>
          <tr><td style="padding:5px 0;color:#607080">${retirada ? 'Retirada' : 'Entrega'}</td><td style="padding:5px 0">${escapeHtml(entrega || '–')}</td></tr>
          ${prazo ? `<tr><td style="padding:5px 0;color:#607080">Previsão</td><td style="padding:5px 0">${escapeHtml(prazo)}</td></tr>` : ''}
        </table>
      </div>`
    ).catch((e) => console.error('[notify loja email]', e.message));
  }
}

async function notifyCancellationRequested(pedido) {
  const cliente = pedido.cliente || pedido.pedidoPayload?.cliente || {};
  const nomeCliente = cliente.nome || pedido.cliente_nome || 'Cliente';
  const email = cliente.email || pedido.cliente_email || '';
  const telefone = cliente.telefone || pedido.cliente_telefone || '';
  const numero = pedido.pedido || pedido.order_nsu || '';
  const total = formatBRL(pedido.total || pedido.payment_paid_amount);
  const reason = pedido.cancellation_reason || 'Cliente não informou motivo.';
  const requestedAt = pedido.cancellation_requestedAt
    ? new Date(pedido.cancellation_requestedAt).toLocaleString('pt-BR')
    : new Date().toLocaleString('pt-BR');
  const storeEmail = process.env.LEMOOV_STORE_EMAIL || process.env.ADMIN_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER || '';
  const result = {
    store: storeEmail ? { ok: false, to: storeEmail } : { ok: false, to: '', error: 'E-mail da loja não configurado.' },
    client: email ? { ok: false, to: email } : { ok: false, to: '', error: 'E-mail do cliente não informado.' }
  };

  const itensHtml = (pedido.itens || []).map((i) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(i.nome || i.description || i.item_name || 'Item')}${i.cor ? ` – ${escapeHtml(i.cor)}` : ''}${i.tamanho ? ` (${escapeHtml(i.tamanho)})` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">x${escapeHtml(i.quantidade || i.qty || i.quantity || 1)}</td></tr>`
  ).join('');

  if (storeEmail) {
    try {
      result.store = await sendEmail(
        storeEmail,
        `Solicitação de cancelamento #${numero} – Lemoov`,
        `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a2a35">
          <h2 style="color:#b42323">Solicitação de cancelamento</h2>
          <p>O cliente solicitou cancelamento do pedido <strong>#${escapeHtml(numero)}</strong>.</p>
          <p><strong>Cliente:</strong> ${escapeHtml(nomeCliente)}<br>
          <strong>E-mail:</strong> ${escapeHtml(email || '–')}<br>
          <strong>Telefone:</strong> ${escapeHtml(telefone || '–')}<br>
          <strong>Total:</strong> ${escapeHtml(total)}<br>
          <strong>Solicitado em:</strong> ${escapeHtml(requestedAt)}</p>
          <p><strong>Motivo:</strong><br>${escapeHtml(reason)}</p>
          ${itensHtml ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">${itensHtml}</table>` : ''}
          <p style="margin-top:20px;color:#7f8ba4;font-size:13px">Acesse o admin, analise o pedido, marque como cancelado se aprovado e faça o estorno no app InfinitePay.</p>
        </div>`
      );
      console.log(`[cancel email loja] enviado para ${storeEmail}`);
    } catch (e) {
      console.error('[cancel email loja]', e.message);
      result.store = { ok: false, to: storeEmail, error: e.message };
    }
  }

  if (email) {
    try {
      result.client = await sendEmail(
        email,
        `Recebemos sua solicitação de cancelamento #${numero} – Lemoov`,
        `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;color:#1a2a35">
          <h2 style="color:#1ec28b">Solicitação recebida</h2>
          <p>Olá, <strong>${escapeHtml(nomeCliente.split(' ')[0] || 'cliente')}</strong>! Recebemos sua solicitação de cancelamento do pedido <strong>#${escapeHtml(numero)}</strong>.</p>
          <p><strong>Total:</strong> ${escapeHtml(total)}</p>
          <p><strong>Motivo informado:</strong><br>${escapeHtml(reason)}</p>
          <p style="margin-top:24px;color:#7f8ba4;font-size:13px">A equipe vai analisar o pedido e confirmar os próximos passos pelo atendimento. O estorno, quando aplicável, será processado pela InfinitePay.</p>
          <p style="color:#7f8ba4;font-size:12px">Lemoov Fitness</p>
        </div>`
      );
      console.log(`[cancel email cliente] enviado para ${email}`);
    } catch (e) {
      console.error('[cancel email cliente]', e.message);
      result.client = { ok: false, to: email, error: e.message };
    }
  }
  return result;
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
    if (!MYSQL_ENABLED) {
      console.warn('[forgot-password] MySQL desabilitado — não é possível buscar cliente.');
      return res.json({ ok: true });
    }
    await initDatabase();
    const [rows] = await mysqlPool.execute('SELECT id, nome FROM lemoov_clients WHERE email = ?', [email]);
    if (!rows.length) {
      console.log(`[forgot-password] email não encontrado no banco: ${email}`);
      return res.json({ ok: true });
    }
    const { id, nome } = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, { clientId: id, email, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });
    const resetUrl = `${getPublicBaseUrl(req)}/cliente-login.html?token=${token}`;
    console.log(`[forgot-password] token gerado para ${email}, enviando email…`);
    await sendResetEmail(email, nome, resetUrl).catch((e) => console.error('[reset-email]', e.message));
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

app.put('/api/client/addresses/:id', clientAuthRequired, async (req, res) => {
  if (!MYSQL_ENABLED) return res.status(503).json({ ok: false, error: 'Banco de dados não disponível.' });
  const { cep, logradouro, numero, complemento, bairro, cidade, uf } = req.body || {};
  if (!cep || !logradouro || !numero || !cidade || !uf)
    return res.status(400).json({ ok: false, error: 'CEP, logradouro, número, cidade e UF são obrigatórios.' });
  try {
    await initDatabase();
    const [result] = await mysqlPool.execute(
      'UPDATE lemoov_client_addresses SET cep=?, logradouro=?, numero=?, complemento=?, bairro=?, cidade=?, uf=? WHERE id=? AND client_id=?',
      [String(cep).replace(/\D/g,''), String(logradouro), String(numero), String(complemento||'')||null, String(bairro||'')||null, String(cidade), String(uf), Number(req.params.id), req.clientSession.clientId]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'Endereço não encontrado.' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[client/addresses PUT]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar endereço.' });
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
        cancellation_requested: Boolean(pedido.cancellation_requested),
        cancellation_request_status: pedido.cancellation_request_status || '',
        cancellation_reason: pedido.cancellation_reason || '',
        cancellation_requestedAt: pedido.cancellation_requestedAt || '',
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

app.post('/api/client/orders/:numero/cancel-request', clientAuthRequired, async (req, res) => {
  try {
    const numero = String(req.params.numero || '').trim();
    const pedido = await readPedidoStore(numero);
    if (!pedido) {
      return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });
    }

    const clientId = String(req.clientSession.clientId || '');
    const email = String(req.clientSession.email || '').toLowerCase();
    const pedidoClientId = String(pedido.client_id || pedido.cliente?.id || '');
    const pedidoEmail = String(pedido.cliente_email || pedido.cliente?.email || '').toLowerCase();
    const isOwner = (clientId && pedidoClientId === clientId) || (email && pedidoEmail === email);
    if (!isOwner) {
      return res.status(403).json({ ok: false, error: 'Pedido não pertence a esta conta.' });
    }

    const status = String(pedido.status || '').toLowerCase();
    if (status === 'cancelado') {
      return res.status(409).json({ ok: false, error: 'Este pedido já está cancelado.' });
    }
    if (pedido.cancellation_requested && pedido.cancellation_request_status !== 'recusado') {
      return res.status(409).json({ ok: false, error: 'Solicitação de cancelamento já enviada.' });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    const updates = {
      cancellation_requested: true,
      cancellation_request_status: 'pendente',
      cancellation_reason: reason,
      cancellation_requestedAt: new Date().toISOString()
    };
    const item = await updatePedidoStore(numero, updates);
    const emailResult = await notifyCancellationRequested(item);
    const emailOk = Boolean(emailResult?.store?.ok || emailResult?.client?.ok);
    const emailUpdates = {
      cancellation_email_status: emailOk ? 'enviado' : 'erro',
      cancellation_email_result: emailResult,
      cancellation_email_checkedAt: new Date().toISOString()
    };
    if (emailOk) emailUpdates.cancellation_email_sentAt = new Date().toISOString();
    const updatedItem = await updatePedidoStore(numero, emailUpdates);
    return res.json({ ok: true, item: updatedItem, email: emailResult });
  } catch (e) {
    console.error('[client/orders cancel-request]', e.message);
    return res.status(500).json({ ok: false, error: 'Erro ao solicitar cancelamento.' });
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

function _modoTransportadora(nome) {
  const n = (nome || '').toLowerCase();
  if (n.includes('sedex'))                              return 'sedex';
  if (n.includes('total express') || n.includes('totalexpress')) return 'total_express';
  if (n.includes('pac'))                                return 'pac';
  if (n.includes('jadlog'))                             return 'jadlog';
  if (n.includes('loggi'))                              return 'loggi';
  if (n.includes('azul'))                               return 'azul_cargo';
  return 'outro';
}

async function _consultarMelhorEnvioOpcoes(cepDestino) {
  const token = process.env.MELHOR_ENVIO_TOKEN;
  if (!token) throw new Error('MELHOR_ENVIO_TOKEN não configurado');

  const cepOrigem = (process.env.CEP_ORIGEM || '60360760').replace(/\D/g, '');
  const cepDest   = String(cepDestino).replace(/\D/g, '');
  const baseUrl   = process.env.NODE_ENV === 'production'
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
      options: { insurance_value: 50, receipt: false, own_hand: false }
    })
  });

  if (!resp.ok) throw new Error(`Melhor Envio HTTP ${resp.status}`);
  const data = await resp.json();

  const services = Array.isArray(data) ? data : [data];

  const _permitida = (s) => {
    const nome    = (s.name || '').toLowerCase();
    const empresa = (s.company?.name || '').toLowerCase();
    return nome === 'pac' || nome === 'sedex' ||
           empresa.includes('total express') || nome.includes('total express');
  };

  const opcoes = services
    .filter(s => s.price && !s.error && _permitida(s))
    .map(s => ({
      modo:      _modoTransportadora(s.name),
      servico:   s.name || 'Transportadora',
      empresa:   s.company?.name || '',
      logo:      s.company?.picture || '',
      valor:     parseFloat(s.price),
      prazoDias: s.delivery_time || null,
      prazo:     s.delivery_time ? `${s.delivery_time} dia${s.delivery_time > 1 ? 's úteis' : ' útil'}` : '',
      label:     `${s.name} – R$ ${parseFloat(s.price).toFixed(2).replace('.', ',')}${s.delivery_time ? ` (${s.delivery_time} dias úteis)` : ''}`
    }))
    .sort((a, b) => a.valor - b.valor);

  if (!opcoes.length) throw new Error('Nenhuma opção de frete disponível para esta rota');
  return opcoes;
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

  // Demais localidades — múltiplas opções via Melhor Envio
  try {
    const opcoes = await _consultarMelhorEnvioOpcoes(cepDestino);
    return { tipo: 'opcoes', opcoes };
  } catch (err) {
    console.error('[frete] Falha no Melhor Envio, aplicando contingência:', err.message);
    return { tipo: 'opcoes', opcoes: [{ modo: 'sedex', servico: 'SEDEX', valor: 30.00, prazo: '1–3 dias úteis', label: 'SEDEX – R$ 30,00 (estimativa)', contingencia: true }] };
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
    requireStockMovementDatabase();
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

    const movements = reserveStock(produtos, itensReserva);
    await writeProdutosStore(produtos, conn);
    const pedido = {
      ...req.body,
      pedido: numeroPedido,
      status: req.body?.status || 'confirmado',
      origem: 'ecommerce',
      estoqueBaixado: true,
      recebidoEm: new Date().toISOString()
    };
    await appendStockMovementsStore(movements.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      orderNumber: numeroPedido,
      source: 'checkout',
      createdAt: new Date().toISOString()
    })), conn);
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
    const { metodo, itens, itensEstoque, cliente, endereco } = req.body || {};
    const pedidoPayload = req.body?.pedidoPayload && typeof req.body.pedidoPayload === 'object' ? req.body.pedidoPayload : {};
    const returnPathRaw = String(req.body?.returnPath || '/catalogo-produtos.html');
    const returnPath = /^\/[a-z0-9._~/%-]*$/i.test(returnPathRaw) ? returnPathRaw : '/catalogo-produtos.html';
    const pedidos = await readPedidosStore();
    const pendingPayments = await readPendingPaymentsStore();
    const orderNsu = generateOrderNumber([...pedidos, ...pendingPayments]);
    const subtotal = roundMoney(Number(req.body?.subtotal ?? pedidoPayload?.subtotal ?? 0) || 0);
    const taxa = roundMoney(Number(req.body?.taxa ?? pedidoPayload?.taxa ?? 0) || 0);
    const discountResult = await calculateDiscounts({
      subtotal,
      cpf: cliente?.cpf || pedidoPayload?.cliente?.cpf || pedidoPayload?.cpf || pedidoPayload?.cliente_cpf || '',
      couponCode: req.body?.cupom || req.body?.couponCode || pedidoPayload?.cupom || '',
      pedidos
    });
    const finalTotal = roundMoney(Math.max(0, subtotal - discountResult.discountTotal) + taxa);
    const paymentItems = normalizePaymentItems(itens);
    const enrichedPedidoPayload = {
      ...pedidoPayload,
      total: finalTotal,
      subtotal,
      taxa,
      desconto: discountResult.discountTotal,
      descontos: discountResult.discounts,
      cupom: discountResult.couponCode || pedidoPayload?.cupom || '',
      cliente_cpf: discountResult.cpf || pedidoPayload?.cliente_cpf || '',
      cliente: {
        ...(pedidoPayload?.cliente || {}),
        cpf: discountResult.cpf || pedidoPayload?.cliente?.cpf || ''
      }
    };
    const intent = {
      pedido: orderNsu,
      order_nsu: orderNsu,
      status: 'aguardando_pagamento',
      total: finalTotal,
      currency: req.body?.currency || 'BRL',
      metodo: metodo || 'online',
      cliente: { ...(cliente || {}), cpf: discountResult.cpf || cliente?.cpf || '' },
      endereco: endereco || {},
      itens: Array.isArray(enrichedPedidoPayload?.itens) ? enrichedPedidoPayload.itens : [],
      itensEstoque: Array.isArray(itensEstoque) ? itensEstoque : [],
      pedidoPayload: enrichedPedidoPayload,
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
      const _num  = String(endereco.numero || '');
      const _comp = String(endereco.complemento || '') || undefined;
      payload.address = {
        cep:         String(endereco.cep).replace(/\D/g, ''),
        logradouro:  String(endereco.rua || endereco.logradouro || ''),
        street:      String(endereco.rua || endereco.logradouro || ''),
        numero:      _num,
        number:      _num,
        complemento: _comp,
        complement:  _comp,
        bairro:      String(endereco.bairro || ''),
        neighborhood: String(endereco.bairro || ''),
        cidade:      String(endereco.cidade || ''),
        city:        String(endereco.cidade || ''),
        uf:          String(endereco.uf || ''),
        state:       String(endereco.uf || ''),
      };
      if (!payload.address.complemento) { delete payload.address.complemento; delete payload.address.complement; }
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
    requireStockMovementDatabase();
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
        const movements = reserveStock(produtos, itensReserva);
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
          origem: basePedido.origem || pending.origem || 'ecommerce',
          estoqueBaixado: true,
          recebidoEm: new Date().toISOString(),
          ...paymentUpdates
        };
        await appendStockMovementsStore(movements.map((m) => ({
          ...m,
          id: crypto.randomUUID(),
          orderNumber: orderNsu,
          source: 'checkout_webhook',
          createdAt: new Date().toISOString()
        })), conn);
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

app.get('/api/catalog-feed.xml', async (req, res) => {
  try {
    const produtos = ensureProductIds(await readProdutosStore());
    const base = PUBLIC_SITE_URL || `https://${req.headers.host}`;

    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const price = (val) => `${Number(val || 0).toFixed(2)} BRL`;

    const CAT_MAP = {
      'Macacão':'Apparel & Accessories > Clothing > One-Pieces > Jumpsuits & Rompers',
      'Top':'Apparel & Accessories > Clothing > Activewear > Sports Bras & Tops',
      'Calça':'Apparel & Accessories > Clothing > Pants',
      'Conjunto':'Apparel & Accessories > Clothing > Activewear',
      'Short':'Apparel & Accessories > Clothing > Shorts',
      'Legging':'Apparel & Accessories > Clothing > Pants > Leggings',
    };
    const defaultCat = 'Apparel & Accessories > Clothing > Activewear';

    const items = [];
    for (const prod of produtos) {
      const cores = Array.isArray(prod.cores) && prod.cores.length ? prod.cores : [{ nome: 'Único', imagem: '' }];
      const descRaw = Array.isArray(prod.desc) ? prod.desc.map(d => (typeof d === 'string' ? d : (d.texto || d.text || ''))).filter(Boolean).join(' ') : String(prod.desc || prod.nome);
      const descText = esc(descRaw || `${prod.nome} - Lemoov Fitness`).slice(0, 5000);
      const cat = esc(CAT_MAP[prod.categoria] || defaultCat);
      const prodUrl = `${base}/catalogo-produtos.html?p=${prod.id}`;

      for (const cor of cores) {
        const img = cor.imagem ? `${base}/${cor.imagem}` : '';
        if (!img) continue;

        const corPreco = cor.preco || prod.preco || 0;
        const corPromo = cor.precoPromo || prod.precoPromo || null;
        const inStock  = !cor.soldOut && Array.isArray(cor.tamanhos) ? cor.tamanhos.length > 0 : !cor.soldOut;
        const varId    = esc(`${prod.id}-${(cor.nome||'').replace(/\s+/g,'-').toLowerCase()}`);

        items.push(`    <item>
      <g:id>${varId}</g:id>
      <g:item_group_id>${prod.id}</g:item_group_id>
      <g:title>${esc(`${prod.nome} – ${cor.nome}`)}</g:title>
      <g:description>${descText}</g:description>
      <g:link>${esc(prodUrl)}</g:link>
      <g:image_link>${esc(img)}</g:image_link>
      <g:price>${price(corPreco)}</g:price>
      ${corPromo ? `<g:sale_price>${price(corPromo)}</g:sale_price>` : ''}
      <g:availability>${inStock ? 'in stock' : 'out of stock'}</g:availability>
      <g:condition>new</g:condition>
      <g:brand>Lemoov</g:brand>
      <g:color>${esc(cor.nome)}</g:color>
      <g:gender>female</g:gender>
      <g:age_group>adult</g:age_group>
      <g:google_product_category>${cat}</g:google_product_category>
    </item>`);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Lemoov Fitness</title>
    <link>${esc(base)}</link>
    <description>Catálogo Lemoov Fitness – moda fitness premium</description>
${items.join('\n')}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (e) {
    console.error('[catalog-feed]', e.message);
    res.status(500).send('Erro ao gerar feed');
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

app.get('/api/admin/cupons', authRequired, async (_req, res) => {
  try {
    res.json(await readCouponsStore());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/cupons', authRequired, async (req, res) => {
  try {
    requireDatabaseFeature('Cupons');
    await initDatabase();
    const code = normalizeCouponCode(req.body?.code);
    const percent = Number(req.body?.percent);
    const active = req.body?.active === false ? 0 : 1;
    if (!code) return res.status(400).json({ ok: false, error: 'Informe o código do cupom.' });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ ok: false, error: 'Percentual deve ficar entre 0,01 e 100.' });
    }
    await mysqlPool.execute(
      `INSERT INTO lemoov_coupons (code, percent, active)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE percent = VALUES(percent), active = VALUES(active)`,
      [code, percent, active]
    );
    res.json({ ok: true, item: await getCouponStore(code) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/admin/cupons/:code', authRequired, async (req, res) => {
  try {
    requireDatabaseFeature('Cupons');
    await initDatabase();
    await mysqlPool.execute('DELETE FROM lemoov_coupons WHERE code = ?', [normalizeCouponCode(req.params.code)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/descontos/validar', async (req, res) => {
  try {
    const pedidos = await readPedidosStore();
    const result = await calculateDiscounts({
      subtotal: req.body?.subtotal,
      cpf: req.body?.cpf,
      couponCode: req.body?.cupom || req.body?.couponCode,
      pedidos
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
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
  let conn = null;
  try {
    requireStockMovementDatabase();
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const { produtoId, corIndex, quantidades } = req.body || {};
    if (!produtoId || !quantidades || typeof quantidades !== 'object') {
      const err = new Error('Dados inválidos');
      err.status = 400;
      throw err;
    }
    const produtos = ensureProductIds(await readProdutosStore(conn));
    const prod = produtos.find((p) => Number(p.id) === Number(produtoId));
    if (!prod) {
      const err = new Error('Produto não encontrado');
      err.status = 404;
      throw err;
    }
    const cor = Array.isArray(prod.cores) ? prod.cores[Number(corIndex) || 0] : null;
    if (!cor) {
      const err = new Error('Cor não encontrada');
      err.status = 404;
      throw err;
    }
    if (!cor.estoque || typeof cor.estoque !== 'object' || Array.isArray(cor.estoque)) {
      cor.estoque = {};
    }
    const movements = [];
    const now = new Date().toISOString();
    Object.entries(quantidades).forEach(([size, qty]) => {
      const s = String(size).trim().toUpperCase();
      if (!s) return;
      const addQty = Math.max(0, Number(qty)) || 0;
      if (addQty <= 0) return;
      const before = Math.max(0, Number(cor.estoque[s]) || 0);
      const after = before + addQty;
      cor.estoque[s] = after;
      movements.push({
        id: crypto.randomUUID(),
        type: 'entrada',
        reason: 'entrada_manual',
        productId: Number(produtoId),
        productName: prod.nome || '',
        colorIndex: Number(corIndex) || 0,
        colorName: cor.nome || '',
        size: s,
        quantity: addQty,
        before,
        after,
        source: 'admin',
        createdAt: now
      });
    });
    cor.tamanhos = Object.keys(cor.estoque).filter((s) => Number(cor.estoque[s]) > 0);
    cor.soldOut = cor.tamanhos.length === 0;
    const allManaged = prod.cores.every((c) => c.estoque && typeof c.estoque === 'object' && !Array.isArray(c.estoque));
    if (allManaged) {
      prod.soldOut = prod.cores.every((c) => Object.values(c.estoque).every((q) => Number(q) <= 0));
    }
    prod.updatedAt = new Date().toISOString();
    await writeProdutosStore(produtos, conn);
    await appendStockMovementsStore(movements, conn);
    if (conn) await conn.commit();
    res.json({ ok: true, produto: prod });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    console.error('[entrada-estoque]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/admin/estoque-movimentos', authRequired, async (_req, res) => {
  try {
    const items = await readStockMovementsStore();
    res.json(items);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/admin/pedido/:numero', authRequired, async (req, res) => {
  let conn = null;
  try {
    requireStockMovementDatabase();
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const existing = await readPedidoStore(req.params.numero, conn);
    if (!existing) throw new Error('Pedido não encontrado');
    const nextOrder = { ...existing, ...req.body, pedido: req.params.numero };
    const shouldDebitStock = !existing.estoqueBaixado && !shouldHoldStock(existing) && shouldHoldStock(nextOrder);
    const shouldRestoreStock = Boolean(existing.estoqueBaixado) && !shouldHoldStock(nextOrder);
    const updates = { ...req.body };
    if (shouldDebitStock) {
      const produtos = ensureProductIds(await readProdutosStore(conn));
      const itensReserva = Array.isArray(nextOrder.itensEstoque)
        ? nextOrder.itensEstoque
        : (Array.isArray(nextOrder.itens) ? nextOrder.itens : []);
      const movements = reserveStock(produtos, itensReserva);
      await writeProdutosStore(produtos, conn);
      await appendStockMovementsStore(movements.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        orderNumber: req.params.numero,
        source: 'admin_status',
        createdAt: new Date().toISOString()
      })), conn);
      updates.estoqueBaixado = true;
    }
    if (shouldRestoreStock) {
      const produtos = ensureProductIds(await readProdutosStore(conn));
      const itensReserva = Array.isArray(existing.itensEstoque)
        ? existing.itensEstoque
        : (Array.isArray(existing.itens) ? existing.itens : []);
      const movements = restoreStock(produtos, itensReserva);
      await writeProdutosStore(produtos, conn);
      await appendStockMovementsStore(movements.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        orderNumber: req.params.numero,
        source: 'admin_status',
        createdAt: new Date().toISOString()
      })), conn);
      updates.estoqueBaixado = false;
      if (String(nextOrder.status || '').toLowerCase() === 'cancelado') {
        updates.cancelledAt = updates.cancelledAt || new Date().toISOString();
        updates.cancellation_request_status = updates.cancellation_request_status || 'aprovado';
        updates.cancellation_reviewedAt = updates.cancellation_reviewedAt || new Date().toISOString();
        updates.refund_status = updates.refund_status || 'pendente_infinitepay';
      }
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

app.post('/api/admin/inventario-estoque', authRequired, async (req, res) => {
  let conn = null;
  try {
    requireStockMovementDatabase();
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const { produtoId, corIndex, contagem } = req.body || {};
    if (!produtoId || !contagem || typeof contagem !== 'object') {
      const err = new Error('Dados inválidos');
      err.status = 400;
      throw err;
    }
    const produtos = ensureProductIds(await readProdutosStore(conn));
    const prod = produtos.find((p) => Number(p.id) === Number(produtoId));
    if (!prod) {
      const err = new Error('Produto não encontrado');
      err.status = 404;
      throw err;
    }
    const cor = Array.isArray(prod.cores) ? prod.cores[Number(corIndex) || 0] : null;
    if (!cor) {
      const err = new Error('Cor não encontrada');
      err.status = 404;
      throw err;
    }
    if (!cor.estoque || typeof cor.estoque !== 'object' || Array.isArray(cor.estoque)) {
      cor.estoque = {};
    }
    const movements = [];
    const now = new Date().toISOString();
    Object.entries(contagem).forEach(([size, qty]) => {
      const s = String(size).trim().toUpperCase();
      if (!s) return;
      const counted = Math.max(0, Number(qty) || 0);
      const before = Math.max(0, Number(cor.estoque[s]) || 0);
      const delta = counted - before;
      if (delta === 0) return;
      cor.estoque[s] = counted;
      movements.push({
        id: crypto.randomUUID(),
        type: 'ajuste',
        reason: 'inventario',
        productId: Number(produtoId),
        productName: prod.nome || '',
        colorIndex: Number(corIndex) || 0,
        colorName: cor.nome || '',
        size: s,
        quantity: delta,
        before,
        after: counted,
        source: 'admin',
        createdAt: now
      });
    });
    cor.tamanhos = Object.keys(cor.estoque).filter((s) => Number(cor.estoque[s]) > 0);
    cor.soldOut = cor.tamanhos.length === 0;
    const allManaged = prod.cores.every((c) => c.estoque && typeof c.estoque === 'object' && !Array.isArray(c.estoque));
    if (allManaged) {
      prod.soldOut = prod.cores.every((c) => Object.values(c.estoque).every((q) => Number(q) <= 0));
    }
    prod.updatedAt = new Date().toISOString();
    await writeProdutosStore(produtos, conn);
    await appendStockMovementsStore(movements, conn);
    if (conn) await conn.commit();
    res.json({ ok: true, produto: prod, movements: movements.length });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_rollbackError) {}
    }
    console.error('[inventario-estoque]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/admin/pedido', authRequired, async (req, res) => {
  let conn = null;
  try {
    requireStockMovementDatabase();
    if (MYSQL_ENABLED) {
      await initDatabase();
      conn = await mysqlPool.getConnection();
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM lemoov_products FOR UPDATE');
    }
    const pedidos = await readPedidosStore(conn);
    const numeroPedido = String(req.body?.pedido || '').trim() || generateOrderNumber(pedidos);
    const pedido = { ...req.body, pedido: numeroPedido, status: req.body?.status || 'confirmado', recebidoEm: new Date().toISOString(), origem: req.body?.origem || 'admin' };
    if (isPaidOrderStatus(pedido)) {
      const produtos = ensureProductIds(await readProdutosStore(conn));
      const itensReserva = Array.isArray(pedido.itensEstoque)
        ? pedido.itensEstoque
        : (Array.isArray(pedido.itens) ? pedido.itens : []);
      const movements = reserveStock(produtos, itensReserva);
      await writeProdutosStore(produtos, conn);
      await appendStockMovementsStore(movements.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        orderNumber: numeroPedido,
        source: 'admin_pedido',
        createdAt: new Date().toISOString()
      })), conn);
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
// ── CRM ──────────────────────────────────────────────────────────────────
const CRM_MAX_SESSIONS = 10000;
const CRM_RETENTION_DAYS = 90;

function parseUserAgent(ua) {
  if (!ua) return { dispositivo: 'desconhecido', browser: 'desconhecido', so: 'desconhecido' };
  const mob = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
  const tab = /iPad|Android(?!.*Mobile)/i.test(ua);
  const dispositivo = tab ? 'tablet' : mob ? 'mobile' : 'desktop';
  const browser =
    /Edg\//i.test(ua)    ? 'Edge' :
    /OPR\//i.test(ua)    ? 'Opera' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /Safari\//i.test(ua) ? 'Safari' :
    /Firefox\//i.test(ua)? 'Firefox' : 'Outro';
  const so =
    /iPhone|iPad|iPod/i.test(ua) ? 'iOS' :
    /Android/i.test(ua)          ? 'Android' :
    /Windows/i.test(ua)          ? 'Windows' :
    /Mac OS X/i.test(ua)         ? 'macOS' :
    /Linux/i.test(ua)            ? 'Linux' : 'Outro';
  return { dispositivo, browser, so };
}

let _crmTablesReady = false;
async function ensureCrmTables() {
  if (_crmTablesReady) return;
  await mysqlPool.execute(`
    CREATE TABLE IF NOT EXISTS lemoov_crm_sessions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL UNIQUE,
      ip VARCHAR(45),
      cidade VARCHAR(100),
      bairro VARCHAR(100),
      regiao VARCHAR(100),
      pais VARCHAR(100),
      cep VARCHAR(10),
      client_id INT NULL,
      cliente_nome VARCHAR(200),
      dispositivo VARCHAR(30),
      browser VARCHAR(50),
      so VARCHAR(30),
      origem VARCHAR(300),
      utm_source VARCHAR(100),
      utm_medium VARCHAR(100),
      utm_campaign VARCHAR(100),
      first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      time_on_site INT NOT NULL DEFAULT 0
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await mysqlPool.execute(`
    CREATE TABLE IF NOT EXISTS lemoov_crm_events (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL,
      type VARCHAR(50) NOT NULL,
      product_id VARCHAR(50),
      product_name VARCHAR(200),
      order_id VARCHAR(50),
      total DECIMAL(10,2),
      page VARCHAR(500),
      ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  try { await mysqlPool.execute('CREATE INDEX idx_crm_session ON lemoov_crm_events (session_id)'); } catch (_) {}
  try { await mysqlPool.execute('CREATE INDEX idx_crm_ts ON lemoov_crm_events (ts)'); } catch (_) {}
  // migrações para tabelas já existentes
  const newCols = ['bairro VARCHAR(100)','cep VARCHAR(10)','dispositivo VARCHAR(30)','browser VARCHAR(50)','so VARCHAR(30)','origem VARCHAR(300)','utm_source VARCHAR(100)','utm_medium VARCHAR(100)','utm_campaign VARCHAR(100)'];
  for (const col of newCols) {
    try { await mysqlPool.execute(`ALTER TABLE lemoov_crm_sessions ADD COLUMN ${col}`); } catch (_) {}
  }
  _crmTablesReady = true;
  console.log('[crm] tabelas prontas');
}

function readCrmJson() { try { return JSON.parse(fs.readFileSync(CRM_PATH, 'utf-8')); } catch (_) { return []; } }
function writeCrmJson(list) {
  const cutoff = Date.now() - CRM_RETENTION_DAYS * 86400000;
  const pruned = list.filter(s => new Date(s.lastSeen).getTime() > cutoff).slice(-CRM_MAX_SESSIONS);
  fs.writeFileSync(CRM_PATH, JSON.stringify(pruned), 'utf-8');
}
function anonIp(ip) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::';
  const p = ip.split('.'); p[3] = '0'; return p.join('.');
}

const _geoCache = new Map();
async function geolocateIp(rawIp) {
  const ip = (rawIp || '').replace(/^::ffff:/, ''); // desembrulha IPv4-mapped
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) return {};
  if (_geoCache.has(ip)) return _geoCache.get(ip);
  try {
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,zip,lat,lon,district&lang=pt-BR`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) return {};
    const d = await r.json();
    if (d.status !== 'success') return {};
    const result = {
      cidade: d.city        || '',
      bairro: d.district    || '',
      regiao: d.regionName  || '',
      pais:   d.country     || '',
      cep:    d.zip         || '',
    };
    // tenta bairro via Nominatim se ip-api não retornou
    if (!result.bairro && d.lat && d.lon) {
      try {
        const nom = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${d.lat}&lon=${d.lon}&format=json`,
          { headers: { 'User-Agent': 'Lemoov/1.0 (contato@lemoov.com.br)' }, signal: AbortSignal.timeout(4000) }
        );
        if (nom.ok) {
          const nd = await nom.json();
          result.bairro = nd.address?.suburb || nd.address?.neighbourhood || nd.address?.district || '';
        }
      } catch (_) {}
    }
    _geoCache.set(ip, result);
    setTimeout(() => _geoCache.delete(ip), 3_600_000); // 1h TTL
    return result;
  } catch (_) {
    return {};
  }
}

app.post('/api/crm/event', async (req, res) => {
  try {
    const body = req.body || {};
    const { sessionId, type, cidade, bairro, regiao, pais, cep, clientId, clienteNome,
            productId, productName, orderId, total, timeOnSite, page,
            origem, utm_source, utm_medium, utm_campaign } = body;

    if (!sessionId || !type) {
      console.warn('[crm/event] body inválido. body:', JSON.stringify(body).slice(0, 200));
      return res.json({ ok: false, error: 'sessionId e type obrigatórios' });
    }

    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    const ip = anonIp(rawIp);
    const ua = parseUserAgent(req.headers['user-agent'] || '');

    if (MYSQL_ENABLED) {
      await ensureCrmTables();
      const [existing] = await mysqlPool.execute(
        'SELECT id, client_id FROM lemoov_crm_sessions WHERE session_id = ?', [sessionId]
      );
      if (!existing.length) {
        // geolocalização server-side — mais confiável que a do browser
        const geo = await geolocateIp(rawIp);
        const finalCidade = geo.cidade || cidade || '';
        const finalBairro = geo.bairro || bairro || '';
        const finalRegiao = geo.regiao || regiao || '';
        const finalPais   = geo.pais   || pais   || '';
        const finalCep    = geo.cep    || cep    || '';
        await mysqlPool.execute(
          `INSERT INTO lemoov_crm_sessions
            (session_id, ip, cidade, bairro, regiao, pais, cep, client_id, cliente_nome,
             dispositivo, browser, so, origem, utm_source, utm_medium, utm_campaign)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [sessionId, ip, finalCidade, finalBairro, finalRegiao, finalPais, finalCep,
           clientId||null, clienteNome||'',
           ua.dispositivo, ua.browser, ua.so,
           origem||'', utm_source||'', utm_medium||'', utm_campaign||'']
        );
        console.log(`[crm] nova sessão: ${sessionId.slice(0,8)}… | ${cidade||'?'}/${bairro||'?'} | ${ua.dispositivo} ${ua.browser} | origem: ${origem||'direto'}`);
      } else {
        const updates = ['last_seen = NOW()'];
        const params = [];
        if (clientId && !existing[0].client_id) { updates.push('client_id = ?', 'cliente_nome = ?'); params.push(clientId, clienteNome||''); }
        if (cidade)      { updates.push('cidade = COALESCE(NULLIF(cidade,""), ?)');  params.push(cidade); }
        if (bairro)      { updates.push('bairro = COALESCE(NULLIF(bairro,""), ?)');  params.push(bairro); }
        if (cep)         { updates.push('cep = COALESCE(NULLIF(cep,""), ?)');         params.push(cep); }
        if (timeOnSite)  { updates.push('time_on_site = ?');  params.push(Number(timeOnSite)); }
        params.push(sessionId);
        await mysqlPool.execute(`UPDATE lemoov_crm_sessions SET ${updates.join(', ')} WHERE session_id = ?`, params);
      }
      if (type !== 'heartbeat') {
        await mysqlPool.execute(
          'INSERT INTO lemoov_crm_events (session_id, type, product_id, product_name, order_id, total, page) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [sessionId, type, productId||null, productName||null, orderId||null, total||null, page||null]
        );
      }
      return res.json({ ok: true });
    }

    // fallback JSON
    const sessions = readCrmJson();
    let session = sessions.find(s => s.sessionId === sessionId);
    const now = new Date().toISOString();
    if (!session) {
      session = { sessionId, ip, cidade: cidade||'', regiao: regiao||'', pais: pais||'', clientId: clientId||null, clienteNome: clienteNome||'', firstSeen: now, lastSeen: now, timeOnSite: 0, events: [] };
      sessions.push(session);
    } else {
      session.lastSeen = now;
      if (clientId && !session.clientId) { session.clientId = clientId; session.clienteNome = clienteNome||''; }
      if (cidade && !session.cidade) session.cidade = cidade;
    }
    if (timeOnSite) session.timeOnSite = Number(timeOnSite);
    if (type !== 'heartbeat') {
      session.events.push({ type, productId, productName, orderId, total, page, ts: now });
      if (session.events.length > 200) session.events = session.events.slice(-200);
    }
    writeCrmJson(sessions);
    res.json({ ok: true });
  } catch (e) {
    console.error('[crm/event]', e.message);
    res.json({ ok: false });
  }
});

app.get('/api/crm/sessions', authRequired, async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    if (MYSQL_ENABLED) {
      await initDatabase();
      const [rows] = await mysqlPool.execute(`
        SELECT s.session_id AS sessionId, s.cidade, s.bairro, s.regiao, s.pais, s.cep,
               s.client_id AS clientId, s.cliente_nome AS clienteNome,
               s.dispositivo, s.browser, s.so, s.origem, s.utm_source, s.utm_medium, s.utm_campaign,
               s.first_seen AS firstSeen, s.last_seen AS lastSeen, s.time_on_site AS timeOnSite,
               COUNT(e.id) AS eventCount,
               MAX(CASE WHEN e.type='product_view'   THEN 1 ELSE 0 END) AS viewed,
               MAX(CASE WHEN e.type='add_to_cart'    THEN 1 ELSE 0 END) AS carted,
               MAX(CASE WHEN e.type='checkout_start' THEN 1 ELSE 0 END) AS \`checkout\`,
               MAX(CASE WHEN e.type='purchase'       THEN 1 ELSE 0 END) AS purchased
        FROM lemoov_crm_sessions s
        LEFT JOIN lemoov_crm_events e ON e.session_id = s.session_id
        WHERE s.first_seen >= NOW() - INTERVAL ? DAY
        GROUP BY s.session_id
        ORDER BY s.last_seen DESC
        LIMIT 2000
      `, [days]);
      return res.json({ ok: true, sessions: rows.map(r => ({ ...r, viewed: !!r.viewed, carted: !!r.carted, checkout: !!r.checkout, purchased: !!r.purchased })) });
    }
    const cutoff = Date.now() - days * 86400000;
    const sessions = readCrmJson().filter(s => new Date(s.firstSeen).getTime() > cutoff)
      .map(s => ({ sessionId: s.sessionId, cidade: s.cidade, regiao: s.regiao, clientId: s.clientId, clienteNome: s.clienteNome, firstSeen: s.firstSeen, lastSeen: s.lastSeen, timeOnSite: s.timeOnSite, eventCount: s.events.length, viewed: s.events.some(e => e.type==='product_view'), carted: s.events.some(e => e.type==='add_to_cart'), checkout: s.events.some(e => e.type==='checkout_start'), purchased: s.events.some(e => e.type==='purchase') })).reverse();
    res.json({ ok: true, sessions });
  } catch (e) {
    console.error('[crm/sessions]', e.message);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/crm/sessions/:id', authRequired, async (req, res) => {
  try {
    const sid = req.params.id;
    if (MYSQL_ENABLED) {
      await initDatabase();
      const [[session]] = await mysqlPool.execute('SELECT * FROM lemoov_crm_sessions WHERE session_id = ?', [sid]);
      if (!session) return res.status(404).json({ ok: false });
      const [events] = await mysqlPool.execute('SELECT * FROM lemoov_crm_events WHERE session_id = ? ORDER BY ts ASC', [sid]);
      return res.json({ ok: true, session: {
        sessionId:    session.session_id,
        ip:           session.ip,
        cidade:       session.cidade,
        bairro:       session.bairro,
        regiao:       session.regiao,
        pais:         session.pais,
        cep:          session.cep,
        clientId:     session.client_id,
        clienteNome:  session.cliente_nome,
        dispositivo:  session.dispositivo,
        browser:      session.browser,
        so:           session.so,
        origem:       session.origem,
        utm_source:   session.utm_source,
        utm_medium:   session.utm_medium,
        utm_campaign: session.utm_campaign,
        firstSeen:    session.first_seen,
        lastSeen:     session.last_seen,
        timeOnSite:   session.time_on_site,
        events: events.map(e => ({ type: e.type, productId: e.product_id, productName: e.product_name, orderId: e.order_id, total: e.total, page: e.page, ts: e.ts }))
      } });
    }
    const session = readCrmJson().find(s => s.sessionId === sid);
    if (!session) return res.status(404).json({ ok: false });
    res.json({ ok: true, session });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/crm/funnel', authRequired, async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    if (MYSQL_ENABLED) {
      await initDatabase();
      const [[counts]] = await mysqlPool.execute(`
        SELECT
          COUNT(DISTINCT s.session_id)                                                  AS total,
          COUNT(DISTINCT CASE WHEN e.type='product_view'   THEN s.session_id END)      AS viewed,
          COUNT(DISTINCT CASE WHEN e.type='add_to_cart'    THEN s.session_id END)      AS carted,
          COUNT(DISTINCT CASE WHEN e.type='checkout_start' THEN s.session_id END)      AS \`checkout\`,
          COUNT(DISTINCT CASE WHEN e.type='purchase'       THEN s.session_id END)      AS purchased
        FROM lemoov_crm_sessions s
        LEFT JOIN lemoov_crm_events e ON e.session_id = s.session_id
        WHERE s.first_seen >= NOW() - INTERVAL ? DAY
      `, [days]);
      return res.json({ ok: true, ...counts });
    }
    const cutoff = Date.now() - days * 86400000;
    const period = readCrmJson().filter(s => new Date(s.firstSeen).getTime() > cutoff);
    res.json({ ok: true, total: period.length, viewed: period.filter(s => s.events.some(e => e.type==='product_view')).length, carted: period.filter(s => s.events.some(e => e.type==='add_to_cart')).length, checkout: period.filter(s => s.events.some(e => e.type==='checkout_start')).length, purchased: period.filter(s => s.events.some(e => e.type==='purchase')).length });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.delete('/api/crm/sessions/:id', authRequired, async (req, res) => {
  try {
    const sid = req.params.id;
    if (MYSQL_ENABLED) {
      await initDatabase();
      await mysqlPool.execute('DELETE FROM lemoov_crm_events WHERE session_id = ?', [sid]);
      await mysqlPool.execute('DELETE FROM lemoov_crm_sessions WHERE session_id = ?', [sid]);
      return res.json({ ok: true });
    }
    writeCrmJson(readCrmJson().filter(s => s.sessionId !== sid));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});
// ─────────────────────────────────────────────────────────────────────────

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
