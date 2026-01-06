const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
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
const PROD_PATH = path.join(__dirname, 'data', 'produtos.json');
const BASIC_USER = process.env.REPORT_USER || 'lemoov';
const BASIC_PASS = process.env.REPORT_PASS || 'Lemo4v@';
const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000;

// garante arquivo
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]', 'utf-8');
if (!fs.existsSync(PROD_PATH)) fs.writeFileSync(PROD_PATH, '[]', 'utf-8');
const IMAGE_DIR = path.join(__dirname, 'image');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

function readPedidos() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
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
function ensureProductIds(list) {
  let maxId = 0;
  list.forEach((p) => { if (Number.isFinite(p.id)) maxId = Math.max(maxId, p.id); });
  return list.map((p) => {
    if (Number.isFinite(p.id)) return p;
    maxId += 1;
    return { ...p, id: maxId };
  });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
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

app.post('/api/pedidos', (req, res) => {
  try {
    const pedidos = readPedidos();
    pedidos.push({ ...req.body, recebidoEm: new Date().toISOString() });
    fs.writeFileSync(DB_PATH, JSON.stringify(pedidos, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Falha ao salvar' });
  }
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { user, pass, redirect } = req.body || {};
  if (user === BASIC_USER && pass === BASIC_PASS) {
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

app.get('/api/pedidos', authRequired, (req, res) => {
  try {
    const pedidos = readPedidos();
    res.json(pedidos);
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/relatorio', authRequired, (req, res) => {
  res.sendFile(path.join(__dirname, 'relatorio.html'));
});

app.get('/api/produtos', (req, res) => {
  try {
    const produtos = readProdutos();
    res.json(produtos);
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/produtos-admin', authRequired, (req, res) => {
  res.sendFile(path.join(__dirname, 'produtos-admin.html'));
});

app.get('/api/admin/produtos', authRequired, (req, res) => {
  try {
    const produtos = readProdutos();
    res.json(produtos);
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/admin/produtos', authRequired, (req, res) => {
  try {
    const produtos = ensureProductIds(readProdutos());
    const nextId = produtos.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
    const item = { ...req.body, id: nextId };
    produtos.push(item);
    writeProdutos(produtos);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/admin/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false });
  const relPath = path.join('image', req.file.filename).replace(/\\/g, '/');
  res.json({ ok: true, path: relPath });
});

app.put('/api/admin/produtos/:id', authRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const produtos = ensureProductIds(readProdutos());
    const idx = produtos.findIndex((p) => Number(p.id) === id);
    if (idx === -1) return res.status(404).json({ ok: false });
    produtos[idx] = { ...produtos[idx], ...req.body, id };
    writeProdutos(produtos);
    res.json({ ok: true, item: produtos[idx] });
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

app.delete('/api/admin/produtos/:id', authRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const produtos = ensureProductIds(readProdutos());
    const next = produtos.filter((p) => Number(p.id) !== id);
    writeProdutos(next);
    res.json({ ok: true });
  } catch (_e) {
    res.status(500).json({ ok: false });
  }
});

app.use(express.static(__dirname)); // serve index.html, script.js, etc.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor no ar http://localhost:${PORT}`));
