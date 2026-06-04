/* ===== Config ===== */
const WHATS_NUMBER = "558587408457"; // seu número (DDI+DDD+telefone)
const PIX_KEY = "61000111000100";    // chave PIX (não exibida no checkout)
const CARD_PAYMENT_LINK = "";        // opcional: link de pagamento p/ cartão. Se vazio, não aparece.
// Entrega local via Moto Uber
const ORIGIN_CEP = "60360760";
const ORIGIN_COORDS = { lat: -3.7435155, lng: -38.5898999 };

const DELIVERY_MODE_LABEL = "Entrega via Moto Uber";
const DELIVERY_FREE_RADIUS_KM = 2;
const DELIVERY_FORTALEZA_CAUCAIA_PRICE = 12;
const DELIVERY_MARACANAU_PRICE = 15;
const DELIVERY_EUSEBIO_PRICE = 25;
let freteAtual = 0;
let cepAtual = "";
let entregaDisponivel = false;
let retiradaNaLoja = false;
let freteModo = null;           // 'uber'
let freteOpcoesCache = [];      // opções retornadas pelo Melhor Envio

// ── CRM ──────────────────────────────────────────────────────────────────
let _crmSessionId = null;
let _crmStartTime = Date.now();

function getCrmSessionId() {
  if (_crmSessionId) return _crmSessionId;
  const sid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  _crmSessionId = sid;
  return sid;
}

function crmTrack(type, extra = {}) {
  if (getCookieConsent() !== 'accepted') return;
  const region = getVisitorRegion();
  const qs = new URLSearchParams(location.search);
  const payload = {
    sessionId:    getCrmSessionId(),
    type,
    cidade:       region?.city    || '',
    bairro:       region?.bairro  || '',
    regiao:       region?.region  || '',
    pais:         region?.country || '',
    cep:          region?.postal  || '',
    clientId:     currentClientSession?.id   || null,
    clienteNome:  currentClientSession?.nome || '',
    origem:       document.referrer ? new URL(document.referrer).hostname : '',
    utm_source:   qs.get('utm_source')   || '',
    utm_medium:   qs.get('utm_medium')   || '',
    utm_campaign: qs.get('utm_campaign') || '',
    ...extra
  };
  fetch('/api/crm/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
}

// Enriquece o CRM com localização precisa (CEP digitado, GPS ou endereço do cliente)
function crmEnrichLocation({ cep, logradouro, bairro, cidade, lat, lng, source }) {
  if (getCookieConsent() !== 'accepted') return;
  const extra = {};
  if (cep)        extra.cep        = String(cep).replace(/\D/g, '');
  if (logradouro) extra.logradouro = String(logradouro).trim();
  if (bairro)     extra.bairro     = String(bairro).trim();
  if (cidade)     extra.cidade     = String(cidade).trim();
  if (lat)        extra.lat        = Number(lat);
  if (lng)        extra.lng        = Number(lng);
  if (source)     extra.cep_source = source; // 'cart_input' | 'gps' | 'client_address'
  if (Object.keys(extra).length === 0) return;
  crmTrack('location_enriched', extra);
}

// heartbeat de tempo no site
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    crmTrack('heartbeat', { timeOnSite: Math.round((Date.now() - _crmStartTime) / 1000) });
  }
});
// ─────────────────────────────────────────────────────────────────────────
let enderecoAutofill = null;
let selectedDeliveryAddress = null;
let currentClientSession = null;
let originCoordsCache = null;
let freteCepRequestSeq = 0;
let freteCepDebounceTimer = null;
let freteCepLoading = false;
let checkoutDiscountState = { cpf: "", cupom: "", discounts: [], discountTotal: 0 };
let cartCouponCode = "";
const FB_EVENT_MAP = {
  add_to_cart: "AddToCart",
  start_checkout: "InitiateCheckout",
  purchase: "Purchase"
};

function trackEvent(name, params = {}) {
  try {
    if (typeof gtag === "function" && window.LEMOOV_GA_ID && window.LEMOOV_GA_ID !== "G-XXXXXXXXXXXX") {
      gtag("event", name, params);
    }
  } catch (_e) {}
  try {
    if (typeof fbq === "function" && window.LEMOOV_PIXEL_ID && window.LEMOOV_PIXEL_ID !== "000000000000000") {
      const fbName = FB_EVENT_MAP[name];
      if (fbName) fbq("track", fbName, params);
      else fbq("trackCustom", name, params);
    }
  } catch (_e) {}
}

/* ------------------------------------------------------------
   Animações
------------------------------------------------------------ */
function animateCartIcon() {
  const cartIcon = document.querySelector("#cartIcon");
  if (cartIcon) {
    cartIcon.classList.add("cart-icon--animated");
    setTimeout(() => cartIcon.classList.remove("cart-icon--animated"), 500);
  }
}

function animateProductFly(sourceElement) {
  if (!sourceElement) return;
  const productImg = sourceElement.tagName === "IMG" ? sourceElement : sourceElement.querySelector("img");
  const cartIcon = document.querySelector("#cartIcon");
  if (!productImg || !cartIcon) return;

  const startRect = productImg.getBoundingClientRect();
  const endRect = cartIcon.getBoundingClientRect();
  const endX = endRect.left + endRect.width / 2;
  const endY = endRect.top + endRect.height / 2;

  const flyingImg = productImg.cloneNode();
  flyingImg.classList.add("fly-to-cart");
  Object.assign(flyingImg.style, {
    top: `${startRect.top}px`,
    left: `${startRect.left}px`,
    width: `${startRect.width}px`,
    height: `${startRect.height}px`,
    position: "fixed",
    borderRadius: "50%",
    objectFit: "cover",
    transition: "transform 0.8s ease-in-out, opacity 0.8s ease-in-out",
    zIndex: "9999",
  });
  document.body.appendChild(flyingImg);

  requestAnimationFrame(() => {
    flyingImg.style.transform = `translate(${endX - startRect.left - startRect.width / 2}px, ${endY - startRect.top - startRect.height / 2}px) scale(0.2)`;
    flyingImg.style.opacity = "0";
  });

  flyingImg.addEventListener("transitionend", () => flyingImg.remove());
}

/* ------------------------------------------------------------
   Catálogo (JSON com tamanhos por cor + descontos + DESCRIÇÕES)
------------------------------------------------------------ */
let produtos = [];

const FILTER_CARDS = [
  { label: "Macacão & Macaquinho", categories: ["Macacão","Macaquinho"], tagline: "Movimento total", image: "image/Macacao/preto.jpg" },
  { label: "Tops", categories: ["Top"], tagline: "Base do conjunto", image: "image/Top/top_iris_1.jpeg" },
  { label: "Shorts", categories: ["Short"], tagline: "Movimento livre", image: "image/Conjunto_Short/sunmoov_branco_0355.jpg" },
  { label: "Leggings", categories: ["Legging"], tagline: "Mix & Match", image: "image/Conjunto_Calca/iris_branco_0384.jpg" },
  { label: "Blusas & Casacos", categories: ["Blusa"], tagline: "Camadas leves", image: "image/Blusa/IMG_0350.JPG" }
];
const API_BASE = window.LEMOOV_API_BASE || "";
const IMAGE_BASE = window.LEMOOV_IMAGE_BASE || "";

/* ------------------------------------------------------------
   Estado & Helpers
------------------------------------------------------------ */
let filtroAtual = "Todos";
let ordenacaoAtual = "destaque";
let buscaAtual = "";
const CART_STORAGE_KEY = "lemoov_cart_v1";
const CART_TTL_MS = 30 * 60 * 1000;
let cartUpdatedAt = 0;
let cartExpiryTimer = null;
let paymentOriginPath = "";
let visitorRegionMemory = null;
let cookieConsentMemory = null;
function _loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
    const updatedAt = Number(Array.isArray(parsed) ? Date.now() : parsed?.updatedAt) || Date.now();
    if (items.length && Date.now() - updatedAt >= CART_TTL_MS) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }
    cartUpdatedAt = items.length ? updatedAt : 0;
    if (parsed?.retiradaNaLoja) retiradaNaLoja = true;
    return items;
  } catch (_) {
    return [];
  }
}
function _saveCart({ touch = false } = {}) {
  try {
    if (!carrinho.length) {
      cartUpdatedAt = 0;
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    if (touch || !cartUpdatedAt) cartUpdatedAt = Date.now();
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: carrinho, updatedAt: cartUpdatedAt, retiradaNaLoja }));
  } catch (_) {
    if (!carrinho.length) cartUpdatedAt = 0;
  }
}
function _scheduleCartExpiry() {
  if (cartExpiryTimer) window.clearTimeout(cartExpiryTimer);
  if (!carrinho.length || !cartUpdatedAt) return;
  const remaining = Math.max(0, cartUpdatedAt + CART_TTL_MS - Date.now());
  cartExpiryTimer = window.setTimeout(clearExpiredCart, remaining);
}
function _touchCart() {
  _saveCart({ touch: true });
  _scheduleCartExpiry();
}
function clearExpiredCart() {
  if (!carrinho.length || !cartUpdatedAt) return;
  if (Date.now() - cartUpdatedAt < CART_TTL_MS) {
    _scheduleCartExpiry();
    return;
  }
  carrinho = [];
  freteAtual = 0;
  cepAtual = "";
  entregaDisponivel = false;
  retiradaNaLoja = false;
  freteModo = null;
  enderecoAutofill = null;
  selectedDeliveryAddress = null;
  _saveCart();
  atualizarCart();
}
let carrinho = _loadCart();
let produtoAtual = null;
let corIndexAtual = 0;
let tamanhoAtual = null;
let ultimoNumeroPedido = null;
let orderSeqFallback = { date: "", seq: 0 };
let modalLastFocus = null;

const el = (sel) => document.querySelector(sel);
const formatBRL = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}
const cssEscape = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
  ? CSS.escape
  : (value) => String(value).replace(/[^a-zA-Z0-9_\-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);

function getCurrentStorePath() {
  return document.body?.classList?.contains("catalog-landing")
    ? "/catalogo-produtos.html"
    : (location.pathname || "/index.html");
}

function rememberPaymentOrigin() {
  paymentOriginPath = getCurrentStorePath();
}

function restorePaymentOriginIfNeeded() {
  const originPath = paymentOriginPath;
  if (!originPath || originPath === location.pathname) return false;
  const isHome = location.pathname === "/" || /\/index\.html$/i.test(location.pathname);
  const isFinal = /\/obrigado\.html$/i.test(location.pathname);
  if (isHome && !isFinal && originPath === "/catalogo-produtos.html") {
    paymentOriginPath = "";
    location.replace(originPath);
    return true;
  }
  return false;
}

async function loadProdutos(){
  let raw = [];
  try {
    const res = await fetch(`${API_BASE}/api/produtos`);
    if (res.ok) {
      const data = await res.json();
      raw = Array.isArray(data) ? data : [];
    }
  } catch (_e) {}
  raw = raw
    .filter(p => p.ativo !== false)
    .map(p => ({ ...p, cores: Array.isArray(p.cores) ? p.cores.filter(c => c.ativo !== false) : p.cores }))
    .sort((a, b) => (Number(a.ordem) || 9999) - (Number(b.ordem) || 9999));
  produtos = raw;
  return Array.isArray(produtos) && produtos.length > 0;
}

function formatBirthForInput(value){
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}/${mm}`;
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeCityName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isCearaCity(city, uf, cityName) {
  if (!city || !uf) return false;
  if (String(uf).trim().toUpperCase() !== "CE") return false;
  return normalizeCityName(city) === normalizeCityName(cityName);
}
function getLocalDeliveryPrice(city, uf) {
  if (isCearaCity(city, uf, "Fortaleza") || isCearaCity(city, uf, "Caucaia")) {
    return DELIVERY_FORTALEZA_CAUCAIA_PRICE;
  }
  if (isCearaCity(city, uf, "Maracanaú") || isCearaCity(city, uf, "Maracanau")) {
    return DELIVERY_MARACANAU_PRICE;
  }
  if (["Eusébio","Eusebio","Itaitinga","Pacatuba"].some(c => isCearaCity(city, uf, c))) {
    return DELIVERY_EUSEBIO_PRICE;
  }
  return null;
}
const CARRIER_LABELS = { sedex: 'SEDEX', total_express: 'Total Express', pac: 'PAC', jadlog: 'Jadlog', loggi: 'Loggi', azul_cargo: 'Azul Cargo', outro: 'Transportadora' };
function getDeliveryModeLabel(mode) {
  if (mode === "uber_free")  return `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
  if (mode === "local_12")   return `Entrega Local – R$ 12,00`;
  if (mode === "local_15")   return `Entrega Local – R$ 15,00`;
  if (mode === "local_25")   return `Entrega Local – R$ 25,00`;
  if (CARRIER_LABELS[mode])  return `${CARRIER_LABELS[mode]} – R$ ${freteAtual > 0 ? freteAtual.toFixed(2).replace(".", ",") : "--"}`;
  return "Consultar via WhatsApp";
}
function isFixedFreteMode(mode = freteModo) {
  return ["uber_free","local_12","local_15","local_25","sedex","total_express","pac","jadlog","loggi","azul_cargo","outro"].includes(mode);
}
function getFreteResumoLabel({ includeCep = false } = {}) {
  const cepInfo = includeCep && cepAtual ? ` (CEP ${formatCEPForInput(cepAtual)})` : "";
  if (retiradaNaLoja) return "Retirada pelo cliente";
  if (!entregaDisponivel) return "Informe o CEP";
  if (isFixedFreteMode()) return `${getDeliveryModeLabel(freteModo)}${cepInfo}`;
  return `Consultar via WhatsApp${cepInfo}`;
}
function buildPaymentItems(discountTotal = 0) {
  const cartItems = buildCartItems();
  const subtotal = cartItems.reduce((sum, item) => sum + (Number(item.price || item.preco || 0) * Number(item.quantity || item.quantidade || 1)), 0);
  const discount = Math.min(Math.max(0, Number(discountTotal) || 0), subtotal);
  let items = cartItems;
  if (discount > 0 && subtotal > 0) {
    const targetCents = Math.max(0, Math.round((subtotal - discount) * 100));
    let allocated = 0;
    items = cartItems.map((item, idx) => {
      const qty = Math.max(1, Number(item.quantity || item.quantidade || 1));
      const line = Number(item.price || item.preco || 0) * qty;
      let lineCents = Math.round((line / subtotal) * targetCents);
      if (idx === cartItems.length - 1) lineCents = Math.max(0, targetCents - allocated);
      allocated += lineCents;
      return { ...item, quantity: 1, quantidade: 1, price: Math.max(0.01, lineCents / 100) };
    });
  }
  if (!retiradaNaLoja && entregaDisponivel && isFixedFreteMode() && freteAtual > 0) {
    items.push({
      item_name: "Frete",
      item_category: "Entrega",
      price: freteAtual,
      quantity: 1
    });
  }
  return items;
}
function buildCartItems() {
  const items = carrinho.map(p => ({
    productId: p.productId,
    colorIndex: p.colorIndex,
    nome: p.nome,
    categoria: p.categoria,
    cor: p.corSelecionada,
    corSelecionada: p.corSelecionada,
    tamanho: p.tamanhoSelecionado,
    tamanhoSelecionado: p.tamanhoSelecionado,
    quantidade: getItemQty(p),
    preco: p.preco,
    precoUnitario: p.preco,
    imagemSelecionada: p.imagemSelecionada,
    descricaoCurta: p.descricaoCurta || "",
    item_name: p.nome,
    item_category: p.categoria,
    price: p.preco,
    quantity: getItemQty(p)
  }));
  return items;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const heroHighlights = [
  "Compressão inteligente para treinos intensos",
  "Proteção UV50+ para treinos ao ar livre",
  "Tecidos que respiram e secam rápido"
];
let heroHighlightIndex = 0;
function cycleHeroHighlight(){
  const span = document.getElementById("heroMicroCopy");
  if (!span) return;
  heroHighlightIndex = (heroHighlightIndex + 1) % heroHighlights.length;
  span.textContent = heroHighlights[heroHighlightIndex];
}
function initHeroCarousel(){
  const carousel = document.getElementById("heroCarousel");
  if (!carousel) return;
  const track = carousel.querySelector(".hero__slides");
  const slides = track ? Array.from(track.children) : [];
  if (!track || !slides.length) return;

  let current = 0;
  let autoId = null;
  let pointerStartX = null;
  const AUTO_MS = 5200;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const prevBtn = carousel.querySelector("[data-hero-prev]");
  const nextBtn = carousel.querySelector("[data-hero-next]");
  const dotsWrap = carousel.querySelector("[data-hero-dots]");
  const dots = dotsWrap ? slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hero__dot";
    dot.setAttribute("aria-label", `Ir para foto ${i + 1}`);
    dot.addEventListener("click", () => {
      goTo(i);
      restartAuto();
    });
    dotsWrap.appendChild(dot);
    return dot;
  }) : [];

  const SHARD_MS = 450;
  const goTo = (idx) => {
    const prev = current;
    current = (idx + slides.length) % slides.length;
    const prevSlide = slides[prev];
    const nextSlide = slides[current];
    if (prevSlide && prevSlide !== nextSlide) {
      prevSlide.classList.add("is-leaving");
      setTimeout(() => prevSlide.classList.remove("is-leaving"), SHARD_MS);
    }
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", active ? "false" : "true");
    });
    dots.forEach((dot, i) => {
      const active = i === current;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
    if (nextSlide) {
      nextSlide.classList.add("is-entering");
      setTimeout(() => nextSlide.classList.remove("is-entering"), SHARD_MS);
    }
  };

  const next = () => goTo(current + 1);
  const prev = () => goTo(current - 1);
  const manualNext = () => {
    next();
    restartAuto();
  };
  const manualPrev = () => {
    prev();
    restartAuto();
  };

  const stopAuto = () => {
    if (autoId) {
      clearInterval(autoId);
      autoId = null;
    }
  };
  const restartAuto = () => {
    stopAuto();
    if (prefersReducedMotion || slides.length < 2) return;
    autoId = window.setInterval(next, AUTO_MS);
  };

  prevBtn?.addEventListener("click", manualPrev);
  nextBtn?.addEventListener("click", manualNext);
  carousel.addEventListener("mouseenter", stopAuto);
  carousel.addEventListener("mouseleave", restartAuto);
  carousel.addEventListener("focusin", stopAuto);
  carousel.addEventListener("focusout", restartAuto);
  carousel.addEventListener("pointerdown", (event) => {
    pointerStartX = event.clientX;
  });
  carousel.addEventListener("pointerup", (event) => {
    if (pointerStartX === null) return;
    const delta = event.clientX - pointerStartX;
    pointerStartX = null;
    if (Math.abs(delta) < 36) return;
    if (delta > 0) manualPrev();
    else manualNext();
  });
  carousel.addEventListener("pointercancel", () => {
    pointerStartX = null;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAuto();
    else restartAuto();
  });

  goTo(0);
  restartAuto();
}

function initSocialProofSlider(){
  const slider = document.querySelector(".social-proof__slider");
  if (!slider) return;
  const cards = Array.from(slider.children);
  if (!cards.length) return;
  let idx = 0;
  const show = (i) => cards.forEach((card, index) => card.classList.toggle("is-active", index === i));
  show(0);
  setInterval(()=>{
    idx = (idx + 1) % cards.length;
    show(idx);
  }, 3500);
}

function initCookieBanner(){
  const banner = document.getElementById("cookieBanner");
  if (!banner) return;
  const consent = getCookieConsent();
  if (consent === "accepted" || consent === "rejected") {
    banner.remove();
    return;
  }
  // mostra o banner (pode estar com display:none no HTML)
  banner.style.display = '';

  const btnAccept = document.getElementById("btnAcceptCookies");
  const btnReject = document.getElementById("btnRejectCookies");

  if (btnAccept) {
    btnAccept.addEventListener("click", async () => {
      setCookieConsent("accepted");
      banner.classList.add("cookie-banner--hide");
      setTimeout(() => banner.remove(), 400);
      initTracking();
      await fetchVisitorRegion();
      crmTrack('page_view', { page: location.pathname });
    });
  }

  if (btnReject) {
    btnReject.addEventListener("click", () => {
      setCookieConsent("rejected");
      banner.classList.add("cookie-banner--hide");
      setTimeout(() => banner.remove(), 400);
    });
  }
}

const CONSENT_VERSION = "v2";

function getCookieConsent(){
  return cookieConsentMemory;
}

function setCookieConsent(value){
  cookieConsentMemory = value;
}

async function initTrackingIfConsented(){
  if (getCookieConsent() === "accepted") {
    initTracking();
    await fetchVisitorRegion();
    crmTrack('page_view', { page: location.pathname });
  }
}

function initTracking(){
  if (window.__lemoovTrackingInit) return;
  const gaId = window.LEMOOV_GA_ID;
  const pixelId = window.LEMOOV_PIXEL_ID;
  if (gaId && gaId !== "G-XXXXXXXXXXXX") {
    loadGtag(gaId);
  }
  if (pixelId && pixelId !== "000000000000000") {
    loadFacebookPixel(pixelId);
  }
  window.__lemoovTrackingInit = true;
}

function loadGtag(gaId){
  const gtagScript = document.createElement("script");
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(gtagScript);
  window.dataLayer = window.dataLayer || [];
  function gtag(){window.dataLayer.push(arguments);}
  window.gtag = window.gtag || gtag;
  gtag("js", new Date());
  gtag("config", gaId, { anonymize_ip: true });
}

function loadFacebookPixel(pixelId){
  if (window.fbq) return;
  const n = function(){n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments);};
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const t = document.createElement("script");
  t.async = true;
  t.src = "https://connect.facebook.net/en_US/fbevents.js";
  const s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(t, s);
  fbq("init", pixelId);
  fbq("track", "PageView");
}

async function fetchVisitorRegion(){
  if (visitorRegionMemory) return;
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return;
    const data = await res.json();
    const region = {
      ip:      data.ip,
      city:    data.city,
      region:  data.region,
      country: data.country_name,
      postal:  data.postal  || '',
      lat:     data.latitude  || null,
      lng:     data.longitude || null,
      bairro:  '',
    };
    // bairro via reverse geocoding (OpenStreetMap Nominatim)
    if (region.lat && region.lng) {
      try {
        const nom = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${region.lat}&lon=${region.lng}&format=json`,
          { headers: { 'Accept-Language': 'pt-BR,pt', 'User-Agent': 'Lemoov/1.0' } }
        );
        if (nom.ok) {
          const nd = await nom.json();
          region.bairro = nd.address?.suburb || nd.address?.neighbourhood || nd.address?.district || nd.address?.city_district || '';
        }
      } catch (_) {}
    }
    visitorRegionMemory = region;
    trackEvent("visit_location", region);
  } catch (_e) {}
}
function getVisitorRegion(){
  return visitorRegionMemory;
}
document.addEventListener("DOMContentLoaded", ()=>{
  const span = document.getElementById("heroMicroCopy");
  if (span){
    span.textContent = heroHighlights[0];
    setInterval(cycleHeroHighlight, 4500);
  }
  initHeroCarousel();
  initSocialProofSlider();
  initTrackingIfConsented();
  initCookieBanner();
  bindAccountLinks();
  hydrateClientSession();
});

/* ===== Descrição helpers ===== */
function hasDescContent(desc){
  if (!desc) return false;
  if (desc.texto && String(desc.texto).trim()) return true;
  if (desc.tecido && String(desc.tecido).trim()) return true;
  if (desc.compressao && String(desc.compressao).trim()) return true;
  if (desc.transparencia && String(desc.transparencia).trim()) return true;
  if (desc.recortes && String(desc.recortes).trim()) return true;
  if (Array.isArray(desc.extras) && desc.extras.length) return true;
  if (Array.isArray(desc.tecnologias) && desc.tecnologias.length) return true;
  if (Array.isArray(desc.indicacao) && desc.indicacao.length) return true;
  return false;
}
function resolveDesc(prod, colorIndex = 0){
  const cor = (prod.cores || [])[colorIndex];
  if (cor && hasDescContent(cor.desc)) return cor.desc;
  if (hasDescContent(prod.desc)) return prod.desc;
  return prod.descricao || {};
}
function formatShortDetalhamento(desc){
  if (!desc) return "Detalhamento indisponível";
  if (desc.texto) return desc.texto;
  const parts = [];
  if (desc.tecido) parts.push(desc.tecido);
  if (desc.compressao) parts.push(`Compressão ${desc.compressao}`);
  if (desc.transparencia) parts.push(`Transparência ${desc.transparencia}`);
  if (Array.isArray(desc.extras) && desc.extras.length) {
    parts.push(`Extras: ${desc.extras.slice(0, 2).join(", ")}`);
  }
  if (Array.isArray(desc.tecnologias) && desc.tecnologias.length) {
    parts.push(`Tecnologias: ${desc.tecnologias.slice(0, 2).join(", ")}`);
  }
  return parts.length ? parts.join(" • ") : "Detalhamento indisponível";
}
function formatDescricaoHTML(desc){
  if (!desc || !hasDescContent(desc)) return "<p>Detalhamento indisponível</p>";
  if (desc.texto) {
    return `<p>${desc.texto}</p>`;
  }
  const summary = formatShortDetalhamento(desc);
  const summaryHtml = summary && summary !== "Detalhamento indisponível"
    ? `<p class="modal__desc-summary">${summary}</p>`
    : "";
  const li = [];
  if (desc.tecido) li.push(`<li><strong>Tecido:</strong> ${desc.tecido}</li>`);
  if (Array.isArray(desc.tecnologias) && desc.tecnologias.length) li.push(`<li><strong>Tecnologias:</strong> ${desc.tecnologias.join(", ")}</li>`);
  if (desc.compressao) li.push(`<li><strong>Compressão:</strong> ${desc.compressao}</li>`);
  if (desc.transparencia) li.push(`<li><strong>Transparência:</strong> ${desc.transparencia}</li>`);
  if (desc.recortes) li.push(`<li><strong>Recortes:</strong> ${desc.recortes}</li>`);
  if (Array.isArray(desc.extras) && desc.extras.length) li.push(`<li><strong>Extras:</strong> ${desc.extras.join(", ")}</li>`);
  if (Array.isArray(desc.indicacao) && desc.indicacao.length) li.push(`<li><strong>Indicação de uso:</strong> ${desc.indicacao.join(", ")}</li>`);
  return `${summaryHtml}<ul class="product-desc-list">${li.join("")}</ul>`;
}

/* ===== Helpers de disponibilidade por cor/tamanho ===== */
function resolveImagePath(path){
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  if (path.startsWith("/") && IMAGE_BASE) return `${IMAGE_BASE}${path}`;
  if (IMAGE_BASE) return `${IMAGE_BASE}/${path}`;
  return path;
}
function getColorImages(cor){
  if (!cor) return [];
  if (Array.isArray(cor.imagens) && cor.imagens.length) {
    return cor.imagens.filter(Boolean).map(resolveImagePath);
  }
  if (cor.imagem) return [resolveImagePath(cor.imagem)];
  return [];
}
function getColorImage(cor){
  const imgs = getColorImages(cor);
  return imgs[0] || "";
}
function normalizeColorKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
const COLOR_SWATCH_MAP = {
  "preto": "#111111",
  "branco": "#f7f7f2",
  "azul": "#1a3d6b",
  "azul marinho": "#1a3d6b",
  "azul bic": "#0045c8",
  "azul frozen": "#b0d0e8",
  "cinza": "#7c8590",
  "grafite": "#4e4e6e",
  "verde": "#107878",
  "verde agua": "#a5e8d2",
  "verde suzy": "#1dafb0",
  "verde pavao": "#006f68",
  "verde militar": "#4a5520",
  "fucsia": "#c030cc",
  "rosa": "#e7a3b5",
  "lilas": "#b69bd8",
  "terracota": "#bf5030",
  "chocolate": "#7a4a2a",
  "cacau": "#6b3f2a",
  "manteiga": "#f0edd0",
  "amarelo": "#FFDF00",
  "vermelho": "#c0392b",
  "aurora": "#c05070",
  "sun moov rosa": "#c05070",
  "selene": "#111111",
  "iris": "#111111",
  "elara": "#111111"
};
const COLOR_SEARCH_TONES = {
  "#111111": "preto black escuro",
  "#f7f7f2": "branco off white gelo claro",
  "#f0edd0": "manteiga creme bege bege claro amarelo claro",
  "#1a3d6b": "azul azul marinho azul escuro marinho",
  "#0045c8": "azul bic azul royal azul vivo",
  "#b0d0e8": "azul frozen azul claro azul bebe azul bebê",
  "#7c8590": "cinza prata",
  "#4e4e6e": "grafite cinza escuro chumbo",
  "#107878": "verde verde medio verde médio",
  "#a5e8d2": "verde agua verde água verde claro menta",
  "#1dafb0": "verde suzy turquesa verde azulado",
  "#006f68": "verde pavao verde pavão verde petroleo verde petróleo",
  "#4a5520": "verde militar oliva",
  "#c030cc": "fucsia fúcsia pink magenta",
  "#e7a3b5": "rosa rosa claro",
  "#b69bd8": "lilas lilás roxo claro",
  "#bf5030": "terracota telha laranja queimado",
  "#7a4a2a": "chocolate marrom marrom escuro",
  "#6b3f2a": "cacau cafe café marrom medio marrom médio",
  "#ffdf00": "amarelo dourado",
  "#c0392b": "vermelho red",
  "#c05070": "aurora rose rosê rosa queimado"
};
function getSwatchColor(colorObj) {
  if (/^#[0-9a-f]{6}$/i.test(String(colorObj?.swatch || ""))) return colorObj.swatch;
  return COLOR_SWATCH_MAP[normalizeColorKey(colorObj?.nome)] || "#e6e6e6";
}
function getColorSearchTerms(colorObj) {
  const swatch = getSwatchColor(colorObj).toLowerCase();
  return COLOR_SEARCH_TONES[swatch] || "";
}
function getColorGroupImages(prod, colorIndex) {
  const colors = Array.isArray(prod?.cores) ? prod.cores : [];
  const selected = colors[colorIndex] || null;
  if (!selected) return [];
  const key = normalizeColorKey(selected.nome);
  const sameColor = key
    ? colors.filter(c => normalizeColorKey(c?.nome) === key)
    : [selected];
  const seen = new Set();
  return sameColor.flatMap(getColorImages).filter(src => {
    if (!src || seen.has(src)) return false;
    seen.add(src);
    return true;
  });
}
function getColorImageForProduct(prod, colorIndex) {
  return getColorGroupImages(prod, colorIndex)[0] || "";
}
function setMainImageForProduct(imgEl, prod, colorIndex, index = 0) {
  if (!imgEl) return false;
  const imgs = getColorGroupImages(prod, colorIndex);
  if (!imgs.length) return false;
  const safeIndex = ((index % imgs.length) + imgs.length) % imgs.length;
  imgEl.src = imgs[safeIndex];
  imgEl.dataset.imgIndex = String(safeIndex);
  imgEl.dataset.imgCount = String(imgs.length);
  return true;
}
let swatchTooltipEl = null;
function showSwatchTooltip(button) {
  const label = button?.dataset?.colorName || button?.getAttribute("aria-label") || "";
  if (!label) return;
  if (!swatchTooltipEl) {
    swatchTooltipEl = document.createElement("div");
    swatchTooltipEl.className = "color-tooltip";
    document.body.appendChild(swatchTooltipEl);
  }
  swatchTooltipEl.textContent = label;
  const rect = button.getBoundingClientRect();
  swatchTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
  swatchTooltipEl.style.top = `${Math.max(rect.top - 8, 12)}px`;
  swatchTooltipEl.hidden = false;
}
function hideSwatchTooltip() {
  if (swatchTooltipEl) swatchTooltipEl.hidden = true;
}
function pulseSwatchTooltip(button) {
  showSwatchTooltip(button);
  window.clearTimeout(button._swatchTooltipTimer);
  button._swatchTooltipTimer = window.setTimeout(hideSwatchTooltip, 1200);
}
function getColorStock(cor){
  return cor && cor.estoque && typeof cor.estoque === "object" && !Array.isArray(cor.estoque)
    ? cor.estoque
    : null;
}
function normalizeStockSize(size){
  return String(size || "UNICO").trim().toUpperCase();
}
function getStockQtyForSize(cor, size){
  const stock = getColorStock(cor);
  if (!stock) return 0;
  const key = normalizeStockSize(size);
  const qty = Number(stock[key]);
  return Number.isFinite(qty) ? qty : 0;
}
function pluralizeUnit(qty){
  return qty === 1 ? "unidade" : "unidades";
}
function getStockWarningMessage(stockQty){
  return `A quantidade selecionada é superior ao estoque atual. Estoque atual: ${stockQty} ${pluralizeUnit(stockQty)}.`;
}
function hasStockForSize(cor, size){
  const qty = getStockQtyForSize(cor, size);
  return qty > 0;
}
function setMainImage(imgEl, colorObj, index = 0){
  if (!imgEl) return false;
  const imgs = getColorImages(colorObj);
  if (!imgs.length) return false;
  const safeIndex = ((index % imgs.length) + imgs.length) % imgs.length;
  imgEl.src = imgs[safeIndex];
  imgEl.dataset.imgIndex = String(safeIndex);
  imgEl.dataset.imgCount = String(imgs.length);
  return true;
}
function appendSwatchContent(button, colorObj){
  const colorName = String(colorObj?.nome || "").trim();
  if (colorName) button.dataset.colorName = colorName;
  const dot = document.createElement("span");
  dot.className = "swatch__dot";
  dot.style.setProperty("--swatch-color", getSwatchColor(colorObj));
  button.appendChild(dot);
  button.addEventListener("mouseenter", () => showSwatchTooltip(button));
  button.addEventListener("focus", () => showSwatchTooltip(button));
  button.addEventListener("click", () => pulseSwatchTooltip(button));
  button.addEventListener("mouseleave", hideSwatchTooltip);
  button.addEventListener("blur", hideSwatchTooltip);
}
function isVariantSoldOut(prod, colorIndex = 0){
  if (prod && prod.soldOut) return true;
  const cor = (prod && prod.cores) ? prod.cores[colorIndex] : null;
  if (cor && cor.soldOut) return true;
  const stock = getColorStock(cor);
  if (!stock || Object.values(stock).every((qty) => Number(qty) <= 0)) return true;
  return false;
}
function isProductSoldOut(prod){
  if (!prod) return true;
  if (prod.soldOut) return true;
  const colors = Array.isArray(prod.cores) ? prod.cores : [];
  if (!colors.length) return true;
  const requiresSize = Array.isArray(prod.tamanhos) && prod.tamanhos.length > 0;
  return colors.every((_, idx) => {
    if (isVariantSoldOut(prod, idx)) return true;
    if (!requiresSize) return false;
    const available = getAvailableSizesForColor(prod, idx);
    return !available || available.length === 0;
  });
}
function getAvailableSizesForColor(prod, colorIndex){
  if (isVariantSoldOut(prod, colorIndex)) return [];
  const cor = (prod.cores || [])[colorIndex];
  const baseSizes = (() => {
    if (!cor) return prod.tamanhos || [];
    if (Array.isArray(cor.tamanhos) && cor.tamanhos.length) return cor.tamanhos;
    return prod.tamanhos || [];
  })();
  const stock = getColorStock(cor);
  if (!stock) return [];
  const stockSizes = Object.keys(stock).filter((size) => Number(stock[size]) > 0);
  if (!baseSizes.length) return stockSizes;
  return baseSizes.filter((size) => hasStockForSize(cor, size));
}
function getAllSizesForColor(prod, colorIndex){
  const cor = (prod.cores || [])[colorIndex];
  if (Array.isArray(cor?.tamanhos) && cor.tamanhos.length) return cor.tamanhos;
  return prod.tamanhos || [];
}
function getDisplayName(prod, colorIndex){
  const baseName = String(prod?.nome || "").trim();
  if (!baseName) return "";
  if (baseName !== "Top e Short Sun Moov") return baseName;
  const cor = (prod?.cores || [])[colorIndex] || null;
  const corNome = String(cor?.nome || "").trim().toLowerCase();
  return corNome === "branco" ? "Short Sun Moov" : baseName;
}
function getCardNote(prod, colorIndex){
  if (prod?.nome === "Blusa Duda") return "Preço referente somente à blusa.";
  return getDisplayName(prod, colorIndex) === "Short Sun Moov"
    ? "Preço referente somente ao short."
    : "";
}
function applySizeAvailability(container, allSizes, availableSizes, onChange){
  const setAvail = new Set(availableSizes);
  container.innerHTML = "";
  allSizes.forEach(t=>{
    const b = document.createElement("button");
    const isAvail = setAvail.has(t);
    b.className = "size";
    b.textContent = t;
    b.dataset.value = t;
    b.type = "button";
    b.setAttribute("aria-disabled", isAvail ? "false" : "true");
    b.setAttribute("aria-pressed", "false");
    b.disabled = !isAvail;
    if (!isAvail) b.tabIndex = -1;
    if (isAvail){
      b.addEventListener("click", (e)=>{
        e.preventDefault();
        container.querySelectorAll(".size").forEach(s=> {
          s.dataset.selected = "false";
          s.setAttribute("aria-pressed", "false");
        });
        b.dataset.selected = "true";
        b.setAttribute("aria-pressed", "true");
        onChange(t);
      });
    }
    container.appendChild(b);
  });

  const firstAvail = availableSizes[0] || null;
  if (firstAvail){
    const btn = container.querySelector(`.size[data-value="${cssEscape(firstAvail)}"]`);
    if (btn) {
      btn.dataset.selected = "true";
      btn.setAttribute("aria-pressed", "true");
      onChange(firstAvail);
    }
  }
  return availableSizes[0] || null;
}

/* ===== Preço por cor/produto (promo/%/base) ===== */
function computeColorPrice(prod, colorObj){
  const corBase = (colorObj && typeof colorObj.preco === "number" && colorObj.preco > 0) ? colorObj.preco : null;
  const base = corBase ?? (Number(prod.preco) || 0);
  const prodBase = Number(prod.preco) || 0;

  if (colorObj && typeof colorObj.precoPromo === "number" && colorObj.precoPromo > 0) {
    const final = colorObj.precoPromo;
    const original = base;
    const pct = Math.round((1 - final / original) * 100);
    return { final, original: final < original ? original : null, pct: Math.max(0, pct) };
  }
  if (colorObj && typeof colorObj.descontoPct === "number") {
    const final = +(base * (1 - colorObj.descontoPct/100)).toFixed(2);
    return { final, original: base, pct: Math.max(0, Math.round(colorObj.descontoPct)) };
  }
  if (corBase) {
    return { final: corBase, original: corBase !== prodBase ? prodBase : null, pct: 0 };
  }
  if (typeof prod.precoPromo === "number" && prod.precoPromo > 0) {
    const final = prod.precoPromo;
    const original = prodBase;
    const pct = Math.round((1 - final / original) * 100);
    return { final, original: final < original ? original : null, pct: Math.max(0, pct) };
  }
  if (typeof prod.descontoPct === "number") {
    const final = +(prodBase * (1 - prod.descontoPct/100)).toFixed(2);
    return { final, original: prodBase, pct: Math.max(0, Math.round(prod.descontoPct)) };
  }
  return { final: base, original: null, pct: 0 };
}

/* ------------------------------------------------------------
   Estilos extras injetados
------------------------------------------------------------ */
(function injectCartStyles(){
  const css = `
  /* ── Carrinho – paleta bandeira do Brasil ── */
  #cart {
    position: fixed !important;
    top: 0 !important; right: 0 !important; left: auto !important;
    transform: translateX(20px);
    width: min(480px, calc(100vw - 12px));
    height: 100dvh;
    max-width: none; max-height: none;
    border-radius: 28px 0 0 28px;
    background: #ffffff;
    outline: none !important;
    box-shadow: -12px 0 60px rgba(0,39,118,.14), -2px 0 0 rgba(0,156,59,.18);
    opacity: 0; pointer-events: none;
    transition: opacity .2s ease, transform .2s cubic-bezier(.22,1,.36,1);
    z-index: 10001;
    display: flex; flex-direction: column;
    border-left: 3px solid #009C3B;
  }
  #cart.show { opacity: 1; transform: translateX(0); pointer-events: auto; }
  @media (max-width: 640px){
    #cart{ width:100vw; height:100dvh; border-radius:0; border-left:none; border-top:3px solid #009C3B; }
  }
  @media (min-width: 860px){
    #cart{
      left:50% !important; right:auto !important;
      top:50% !important;
      width:min(660px,calc(100vw - 48px)) !important;
      height:auto !important;
      max-height:94vh !important;
      border-radius:24px !important;
      border-left:none !important;
      outline:none !important;
      box-shadow:0 28px 80px rgba(0,20,80,.2),0 4px 24px rgba(0,156,59,.1) !important;
      transform:translateX(-50%) translateY(calc(-50% + 28px));
      transition:opacity .22s ease, transform .22s cubic-bezier(.22,1,.36,1) !important;
    }
    #cart.show{
      transform:translateX(-50%) translateY(-50%) !important;
      opacity:1; pointer-events:auto;
    }
  }
  #cartBackdrop {
    position: fixed !important; inset: 0;
    background: rgba(0,20,50,.52);
    opacity: 0; transition: opacity .2s ease; z-index: 10000;
    pointer-events: none; backdrop-filter: blur(6px);
  }
  #cartBackdrop.show { opacity: 1; pointer-events: auto; }

  .cart, .cart * { font-size: 14px; }
  #cart .cart__header{
    padding: 20px 24px 16px;
    background: linear-gradient(135deg, #009C3B 0%, #002776 100%);
    border-bottom: none;
    display: flex; align-items: center; justify-content: space-between;
  }
  #cart .cart__header h3{
    font-size: 1.05rem; font-weight: 800;
    color: #FFDF00;
    letter-spacing: .02em;
  }
  #cart .cart__header h3::after{
    content: "Revise e finalize com segurança";
    display: block; margin-top: 3px;
    color: rgba(255,255,255,.65);
    font-size: 0.72rem; font-weight: 500;
  }
  #cart .cart__close{
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(255,223,0,.18);
    color: #FFDF00; font-size: 1rem;
    border: 1px solid rgba(255,223,0,.35);
    transition: background .15s;
  }
  #cart .cart__close:hover{ background: rgba(255,223,0,.32); }
  #cart .cart__client{
    margin:12px 16px 0;
    padding:10px 12px;
    border:1px solid rgba(0,156,59,.14);
    border-radius:14px;
    background:#f2fbf5;
    color:#153427;
    display:flex;
    align-items:center;
    gap:9px;
    font-size:.78rem;
    font-weight:600;
  }
  #cart .cart__client i{ color:#009C3B; }
  #cart .cart__client strong{ color:#002776; }
  #cart .cart__list{ padding: 12px 16px 0; flex: 1 1 180px; overflow-y: auto; min-height: 150px; overscroll-behavior: contain; }
  #cart .cart__item{
    display:grid; grid-template-columns:64px minmax(0,1fr) auto; align-items:start;
    background: #fafcff;
    border: 1px solid rgba(0,39,118,.08);
    border-radius: 16px;
    padding: 12px; margin-bottom: 10px;
    box-shadow: 0 2px 12px rgba(0,39,118,.06);
    transition: box-shadow .15s;
  }
  #cart .cart__item:hover{ box-shadow: 0 4px 20px rgba(0,156,59,.12); }
  #cart .cart__item-media{
    width: 64px; height: 78px; min-width: 64px;
    border-radius: 12px; background: #f0f4f8;
    overflow: hidden;
  }
  #cart .cart__item-name{ font-size: 0.9rem; font-weight: 700; color: #0a1628; }
  #cart .cart__item-info{ min-width:0; }
  #cart .cart__item-actions{ min-width:82px; }
  #cart .cart__item-desc{ display: none; }
  #cart .cart__item-details,
  #cart .cart__item-qty{ color: #5a6a80; font-size: 0.74rem; }
  #cart .cart__qty-control{
    display:inline-flex;align-items:center;gap:0;
    width:max-content;margin-top:7px;
    border:1px solid rgba(0,39,118,.14);
    border-radius:999px;overflow:hidden;background:#fff;
  }
  #cart .cart__qty-btn{
    width:30px;height:30px;border:0;background:#f8fbf2;
    color:#002776;font-weight:900;cursor:pointer;
    display:grid;place-items:center;line-height:1;
  }
  #cart .cart__qty-btn:hover:not(:disabled){ background:rgba(0,156,59,.13); }
  #cart .cart__qty-btn:disabled{ opacity:.42;cursor:not-allowed; }
  #cart .cart__qty-value{
    min-width:32px;text-align:center;font-size:.82rem;
    font-weight:800;color:#0a1628;padding:0 8px;
  }
  #cart .cart__item-price{ color: #002776; font-size: 0.94rem; font-weight: 700; }
  #cart .cart__remove-btn{
    border: 1px solid rgba(220,38,38,.2);
    background: rgba(254,226,226,.6);
    color: #b91c1c;
    padding: 5px 10px; font-size: 0.68rem; border-radius: 8px;
    transition: background .15s;
  }
  #cart .cart__remove-btn:hover{ background: rgba(254,202,202,.9); }
  #cart .cart__footer{
    flex:0 0 auto;
    display:flex;
    flex-direction:column;
    gap:8px;
    padding: 14px 16px 20px;
    background: #f8faff;
    border-top: 1px solid rgba(0,39,118,.08);
    max-height:min(62vh, calc(100dvh - 180px));
    overflow-y:auto;
    overflow-x:hidden;
  }
  #cart #btnCheckout{
    order:30;
    width:100%;
    position:sticky;
    bottom:0;
    z-index:2;
    margin-top:4px;
  }
  #cart #btnCheckout:disabled{ opacity:.55; cursor:not-allowed; filter:saturate(.5); }
  #cart #btnAddMore{
    order:40;
    width:100%;
    font-size:.78rem;
    font-weight:700;
    color:#002776;
    background:transparent;
    border:1.5px dashed rgba(0,39,118,.25);
    border-radius:12px;
    padding:10px;
    cursor:pointer;
    transition:all .15s;
  }
  #cart #btnAddMore:hover{ background:rgba(0,39,118,.05); border-color:rgba(0,39,118,.4); }
  #cart .cart-coupon{
    order:8;
    border:1px solid rgba(0,39,118,.1);
    background:#fff;
    border-radius:14px;
    padding:10px;
    display:grid;
    gap:7px;
  }
  #cart .cart-coupon__label{ font-size:.72rem; font-weight:800; color:#56677c; text-transform:uppercase; letter-spacing:.06em; }
  #cart .cart-coupon__row{ display:flex; gap:8px; }
  #cart .cart-coupon__input{ flex:1; min-width:0; border:1px solid #d8e1eb; border-radius:10px; padding:9px 10px; font:inherit; font-weight:700; text-transform:uppercase; }
  #cart .cart-coupon__btn{ border:0; border-radius:10px; padding:0 14px; font:inherit; font-size:.78rem; font-weight:900; color:#FFDF00; background:linear-gradient(120deg,#009C3B,#002776); cursor:pointer; }
  #cart .cart-coupon__btn:disabled{ opacity:.6; cursor:not-allowed; }
  #cart .cart-coupon__msg{ min-height:16px; font-size:.74rem; font-weight:700; color:#64748b; }
  #cart .cart-coupon__msg[data-status="ok"]{ color:#087a4d; }
  #cart .cart-coupon__msg[data-status="warn"]{ color:#b45309; }
  @media (max-width: 420px){
    #cart .cart__list{ min-height: 120px; padding-left:12px; padding-right:12px; }
    #cart .cart__item{ grid-template-columns:56px minmax(0,1fr); gap:10px; }
    #cart .cart__item-media{ width:56px; height:68px; min-width:56px; }
    #cart .cart__item-actions{ grid-column:2; flex-direction:row; align-items:center; justify-content:space-between; min-width:0; text-align:left; }
  }
  #cart .cart__total{
    order:20;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.88rem; color: #374151;
    padding: 4px 0;
  }
  #cart .cart__total:last-of-type{ font-size: 1rem; font-weight: 800; color: #0a1628; }
  #cart .cart__total strong{ color: #002776; }

  .frete__ui{ order:12; margin:4px 0 0; }
  .frete__ui[data-auth="logged-out"] #cartAddressSummary{ display:none !important; }
  /* CEP manual e link dos Correios sempre visíveis, antes e depois do login */
  #cart[data-cart-auth="logged-out"] .cart-coupon{ display:none !important; }
  .cart-address-summary{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px;border:1px solid rgba(0,39,118,.1);border-radius:12px;background:#fff;
    color:#334155;font-size:.78rem;line-height:1.35;
  }
  .cart-address-summary strong{display:block;color:#0a1628;font-size:.82rem}
  .cart-address-summary button{border:1px solid #dbe3ea;background:#fff;border-radius:9px;padding:7px 10px;font:inherit;font-size:.72rem;font-weight:800;color:#002776;cursor:pointer;white-space:nowrap}
  .pickup-toggle{
    display:grid;
    grid-template-columns:auto 1fr;
    gap:10px;
    align-items:center;
    padding:10px;
    margin-bottom:9px;
    border:1px solid rgba(0,156,59,.14);
    border-radius:16px;
    background:linear-gradient(135deg, rgba(255,255,255,.92), rgba(238,248,242,.82));
    cursor:pointer;
  }
  .pickup-toggle__control{
    width:46px;height:26px;border-radius:999px;
    background:#dbe7e1;position:relative;transition:background .2s;
  }
  .pickup-toggle__control::after{
    content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;
    border-radius:50%;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.18);transition:transform .2s;
  }
  .pickup-toggle input{position:absolute;opacity:0;pointer-events:none}
  .pickup-toggle:has(input:checked){border-color:rgba(0,156,59,.34);box-shadow:0 10px 24px rgba(0,156,59,.08)}
  .pickup-toggle input:checked + .pickup-toggle__control{background:linear-gradient(120deg,#009C3B,#002776)}
  .pickup-toggle input:checked + .pickup-toggle__control::after{transform:translateX(20px)}
  .pickup-toggle__text strong{display:block;color:#0a1628;font-size:.82rem}
  .pickup-toggle__text span{display:block;color:#5d6b76;font-size:.72rem;line-height:1.25;margin-top:2px}
  .frete__row{ display:flex; gap:8px; align-items:center; flex-wrap:nowrap; }
  .frete__msg{ font-size:0.78rem; color:#5d6b76; margin-top:6px; text-align:left; }
  .frete__ui[data-loading="true"] .frete__msg{ color:#0f766e; font-weight:700; }
  .frete__ui[data-loading="true"] .frete__msg::after{ content:""; display:inline-block; width:12px; height:12px; margin-left:7px; border:2px solid rgba(15,118,110,.25); border-top-color:#0f766e; border-radius:50%; vertical-align:-2px; animation:freteSpin .75s linear infinite; }
  @keyframes freteSpin{ to{ transform:rotate(360deg); } }
  .frete__opcoes{ margin-top:8px; display:flex; flex-direction:column; gap:6px; }
  .frete__opcao{ display:flex; align-items:center; gap:10px; padding:10px 12px; border:1.5px solid #dde3ea; border-radius:8px; cursor:pointer; font-size:0.8rem; transition:border-color .15s,background .15s; }
  .frete__opcao:hover{ border-color:#009C3B; background:#f5fff8; }
  .frete__opcao input[type="radio"]{ accent-color:#009C3B; width:16px; height:16px; flex-shrink:0; cursor:pointer; }
  .frete__opcao.selected{ border-color:#009C3B; background:#f0fdf4; }
  .frete__opcao-logo{ width:52px; height:32px; object-fit:contain; flex-shrink:0; }
  .frete__opcao-info{ display:flex; flex-direction:column; gap:1px; flex:1; }
  .frete__opcao-nome{ font-weight:600; color:#1a2a35; }
  .frete__opcao-empresa{ font-size:0.7rem; color:#6b7a85; }
  .frete__opcao-prazo{ font-size:0.72rem; color:#6b7a85; }
  .frete__opcao-preco{ font-weight:700; color:#1a2a35; white-space:nowrap; }
  .frete__ui input{
    flex: 1 1 0; min-width: 0;
    padding: 11px 14px !important;
    font-size: 0.84rem !important;
    border-radius: 14px !important;
    background: #fff !important;
    color: #0a1628 !important;
    border: 1.5px solid rgba(0,156,59,.3) !important;
    outline: none;
  }
  .frete__ui input:focus{ border-color: #009C3B !important; box-shadow: 0 0 0 3px rgba(0,156,59,.1) !important; }
  .frete__numero-form{ margin-top:8px; display:flex; flex-direction:column; gap:7px; }
  .frete__numero-full input,
  .frete__numero-row input{ width:100%; box-sizing:border-box; border:1.5px solid #dbe3ea; border-radius:10px; padding:9px 11px; font:inherit; font-size:.84rem; }
  .frete__numero-full input:focus,
  .frete__numero-row input:focus{ border-color:#009C3B; outline:none; box-shadow:0 0 0 2px rgba(0,156,59,.12); }
  .frete__numero-full input.err{ border-color:#e8445a; }
  .frete__numero-row{ display:grid; grid-template-columns:1fr 1.4fr; gap:8px; }
  .frete__endereco-preview{ font-size:.75rem; color:#56677c; line-height:1.35; min-height:14px; }
  .frete__confirmar-btn{ width:100%; padding:10px; font-size:.82rem; font-weight:800; border-radius:12px; }
  .frete__ui .btn{
    padding: 11px 14px !important;
    font-size: 0.75rem !important; font-weight: 700;
    letter-spacing: .04em; text-transform: uppercase;
    background: linear-gradient(120deg,#002776,#009C3B) !important;
    color: #FFDF00 !important;
    border: none !important; border-radius: 14px !important;
    white-space: nowrap; flex-shrink: 0;
  }
  #btnCheckout{
    width: 100%; margin-top: 10px;
    padding: 15px 14px;
    font-size: 0.9rem; font-weight: 800;
    letter-spacing: .04em; text-transform: uppercase;
    border-radius: 16px;
    background: linear-gradient(120deg, #009C3B 0%, #002776 100%);
    color: #FFDF00;
    box-shadow: 0 8px 28px rgba(0,39,118,.22);
    transition: filter .15s, box-shadow .15s;
  }
  #btnCheckout:hover{ filter: brightness(1.08); box-shadow: 0 12px 36px rgba(0,39,118,.3); }

  /* ===== Tela de transição para pagamento ===== */
  #payment-transition{
    position:fixed;
    inset:0;
    z-index:99999;
    display:flex;
    align-items:center;
    justify-content:center;
    background:#009C3B;
    opacity:0;
    animation:ptFadeIn .4s ease forwards;
    overflow:hidden;
  }
  @keyframes ptFadeIn{ to{ opacity:1; } }

  /* estrelas fixas de fundo */
  #payment-transition .pt-stars{
    position:absolute;
    inset:0;
    pointer-events:none;
  }
  #payment-transition .pt-stars span{
    position:absolute;
    color:rgba(255,255,255,.55);
    font-size:.45rem;
    animation:ptTwinkle 2.4s ease-in-out infinite;
  }
  @keyframes ptTwinkle{
    0%,100%{ opacity:.3; transform:scale(1); }
    50%    { opacity:.9; transform:scale(1.6); }
  }

  /* losango amarelo */
  #payment-transition .pt-diamond{
    position:absolute;
    width:min(82vw,460px);
    aspect-ratio:1/.7;
    background:#FFDF00;
    clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);
    animation:ptDiamondIn .5s .1s cubic-bezier(.22,1,.36,1) both;
  }
  @keyframes ptDiamondIn{
    from{ clip-path:polygon(50% 50%,50% 50%,50% 50%,50% 50%); opacity:0; }
    to  { clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%); opacity:1; }
  }

  /* círculo azul */
  #payment-transition .pt-circle{
    position:relative;
    width:min(44vw,200px);
    aspect-ratio:1;
    border-radius:50%;
    background:#002776;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:10px;
    animation:ptCircleIn .5s .25s cubic-bezier(.22,1,.36,1) both;
    box-shadow:0 0 0 2px rgba(255,255,255,.18);
  }
  @keyframes ptCircleIn{
    from{ transform:scale(0); opacity:0; }
    to  { transform:scale(1); opacity:1; }
  }

  /* faixa branca dentro do círculo */
  #payment-transition .pt-circle::before{
    content:'';
    position:absolute;
    left:0; right:0;
    top:50%; transform:translateY(-50%);
    height:14%;
    background:rgba(255,255,255,.12);
  }

  #payment-transition .pt-ordem{
    font-size:clamp(.48rem,1.8vw,.62rem);
    font-weight:900;
    letter-spacing:.18em;
    color:rgba(255,255,255,.9);
    text-transform:uppercase;
    text-align:center;
    line-height:1.3;
    position:relative;
    z-index:1;
    padding:0 8px;
  }
  #payment-transition .pt-lock{
    font-size:clamp(1.1rem,5vw,1.6rem);
    animation:ptPulse 1.8s ease-in-out infinite;
    line-height:1;
  }
  @keyframes ptPulse{
    0%,100%{ transform:scale(1);   opacity:.75; }
    50%    { transform:scale(1.2); opacity:1;   }
  }
  #payment-transition .pt-bar-wrap{
    width:min(26vw,90px);
    height:3px;
    border-radius:99px;
    background:rgba(255,255,255,.2);
    overflow:hidden;
  }
  #payment-transition .pt-bar{
    height:100%;
    border-radius:99px;
    background:#FFDF00;
    animation:ptSlide 1.3s ease-in-out infinite;
    width:45%;
  }
  @keyframes ptSlide{
    0%  { transform:translateX(-150%); }
    100%{ transform:translateX(400%);  }
  }

  /* mensagem abaixo do losango */
  #payment-transition .pt-msg{
    position:absolute;
    bottom:min(10vh,60px);
    left:0; right:0;
    text-align:center;
    color:rgba(255,255,255,.82);
    font-size:clamp(.75rem,3vw,.9rem);
    letter-spacing:.04em;
    animation:ptFadeIn .4s .6s both;
  }

  dialog.app-message-dialog:not([open]){ display:none !important; }
  dialog.app-message-dialog{
    width:min(420px, calc(100vw - 34px));
    border:0;
    border-radius:20px;
    padding:0;
    background:#fff;
    color:#0a1628;
    box-shadow:0 28px 80px rgba(7,24,32,.28);
    overflow:hidden;
  }
  dialog.app-message-dialog::backdrop{
    background:rgba(6,18,28,.46);
    backdrop-filter:blur(7px);
  }
  .app-message__body{padding:22px 22px 18px}
  .app-message__mark{
    width:42px;height:42px;border-radius:14px;
    display:grid;place-items:center;
    background:linear-gradient(135deg,#009C3B,#002776);
    color:#FFDF00;font-weight:900;margin-bottom:14px;
  }
  .app-message__title{font-size:1rem;font-weight:900;margin:0 0 7px;color:#0a1628}
  .app-message__text{font-size:.9rem;line-height:1.5;color:#4b5b68;margin:0}
  .app-message__actions{
    display:flex;justify-content:flex-end;gap:8px;
    padding:12px 16px 16px;background:#f8fbf2;
  }
	  .app-message__ok{
	    border:0;border-radius:12px;padding:11px 18px;
	    background:linear-gradient(120deg,#009C3B,#002776);
	    color:#FFDF00;font-weight:900;cursor:pointer;
	  }
	  dialog.cancel-request-dialog:not([open]){ display:none !important; }
	  dialog.cancel-request-dialog{
	    width:min(520px, calc(100vw - 28px));
	    border:0;
	    border-radius:20px;
	    padding:0;
	    background:#fff;
	    color:#0d1f2a;
	    box-shadow:0 28px 80px rgba(7,24,32,.3);
	    overflow:hidden;
	  }
	  dialog.cancel-request-dialog::backdrop{
	    background:rgba(6,18,28,.58);
	    backdrop-filter:blur(8px);
	  }
	  .cancel-request__header{
	    display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
	    padding:18px 20px 14px;
	    border-bottom:1px solid #eef0f2;
	    background:linear-gradient(120deg, rgba(0,156,59,.08), rgba(0,39,118,.06));
	  }
	  .cancel-request__title{font-size:1rem;font-weight:900;margin:0;color:#0d1f2a}
	  .cancel-request__subtitle{margin:4px 0 0;color:#607080;font-size:.82rem;line-height:1.4}
	  .cancel-request__close{
	    width:36px;height:36px;border-radius:50%;border:1px solid #dbe3ea;
	    background:#fff;color:#0d1f2a;cursor:pointer;font-weight:900;font-size:1.05rem;
	  }
	  .cancel-request__body{padding:18px 20px 4px}
	  .cancel-request__label{
	    display:block;margin-bottom:7px;color:#6b7b88;font-size:.72rem;font-weight:900;
	    text-transform:uppercase;letter-spacing:.07em;
	  }
	  .cancel-request__textarea{
	    width:100%;min-height:120px;resize:vertical;border:1px solid #dbe3ea;border-radius:12px;
	    padding:12px;font:700 .9rem/1.45 Inter,system-ui,sans-serif;color:#0d1f2a;outline:none;
	  }
	  .cancel-request__textarea:focus{border-color:#009C3B;box-shadow:0 0 0 3px rgba(0,156,59,.1)}
	  .cancel-request__status{min-height:18px;margin-top:8px;color:#b42323;font-size:.8rem;font-weight:800}
	  .cancel-request__actions{
	    display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;
	    padding:12px 20px 18px;background:#f8fbf2;
	  }
	  .cancel-request__secondary,.cancel-request__primary{
	    border-radius:10px;padding:10px 14px;font-weight:900;cursor:pointer;
	  }
	  .cancel-request__secondary{border:1px solid #dbe3ea;background:#fff;color:#425466}
	  .cancel-request__primary{border:0;background:linear-gradient(120deg,#009C3B,#002776);color:#FFDF00}
	  .cancel-request__primary:disabled{opacity:.6;cursor:not-allowed}

	  dialog.checkout-modal:not([open]){ display:none !important; }
  dialog.checkout-modal{
    border:none;
    border-radius:0;
    width:100vw;
    height:100vh;
    height:100dvh;
    max-width:none;
    max-height:none;
    padding:0;
    z-index:10002;
    background:
      radial-gradient(circle at 12% 12%, rgba(246,215,77,0.18), transparent 30%),
      linear-gradient(135deg,#f8fbf2,#edf7f2 55%, #eaf3ff 100%);
    color:#0d1f2a;
    box-shadow:none;
    overflow:hidden;
    display:flex;
    flex-direction:column;
  }
  #checkoutForm{
    flex:1 1 auto;
    min-height:0;
    display:flex;
    flex-direction:column;
    overflow:hidden;
  }
  dialog.checkout-modal::backdrop{
    background: rgba(2,8,16,0.85);
    backdrop-filter: blur(5px);
  }
  .checkout__header{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    padding:22px 28px 16px;
    border-bottom:1px solid rgba(0,0,0,0.05);
    background:
      linear-gradient(120deg, rgba(11,122,79,0.08), rgba(246,215,77,0.12), rgba(11,79,149,0.06)),
      #ffffff;
  }
  .checkout__title{
    font-size:1.02rem;
    font-weight:800;
    letter-spacing:0;
    text-transform:none;
    color:#08251f;
  }
  .checkout__subtitle{
    margin:6px 0 0;
    color:#4b5b68;
  }
  .checkout__body{
    padding:24px 28px;
    display:grid;
    gap:20px;
    grid-template-columns:1fr;
    background:transparent;
    overflow-y:auto;
    -webkit-overflow-scrolling:touch;
    touch-action:pan-y;
    flex:1 1 auto;
    min-height:0;
    overscroll-behavior:contain;
  }
  .checkout__summary{
    background:#ffffff;
    border:1px solid rgba(11,122,79,0.12);
    border-top: 4px solid #f6d74d;
    border-radius:18px;
    padding:18px 20px;
    box-shadow:0 20px 60px rgba(7,20,36,0.08);
  }
  .checkout__totals{
    margin-top:10px;
    display:grid;
    gap:5px;
    color:#0b1f2a;
    font-weight:600;
  }
  .checkout__note{
    margin-top:8px;
    padding:8px 10px;
    border-radius:12px;
    background:#fffdf0;
    color:#273746;
    font-size:0.82rem;
  }
  @media (min-width: 960px){
    dialog.checkout-modal{
      width:min(1080px,94vw);
      height:auto;
      max-height:90dvh;
      border-radius:24px;
      box-shadow:0 32px 80px rgba(2,8,16,0.36), 0 0 0 1px rgba(255,255,255,0.06);
    }
    .checkout__header{
      padding:16px 28px 14px;
      align-items:center;
    }
    .checkout__subtitle{ display:none; }
    .checkout__body{
      padding:20px 28px;
      gap:20px;
      grid-template-columns:minmax(240px,0.85fr) minmax(0,1.6fr);
      align-items:start;
    }
    .checkout__summary > p.checkout__muted{ display:none; }
    .checkout__step > .full > p.checkout__muted{ display:none; }
    .checkout__footer{ padding:12px 24px 16px; }
  }
  .checkout__right{
    display:flex;
    flex-direction:column;
    gap:14px;
  }
  .checkout__grid{
    display:grid;
    gap:14px;
  }
  .checkout__row{
    display:flex;
    gap:12px;
  }
  .checkout__row > *{ flex:1; }
  .checkout__row--stack{ flex-wrap:wrap; align-items:flex-start; }
  .checkout__row--stack .checkout__cepBtn{ flex:0 0 auto; }
  .checkout__row--stack{
    flex-wrap:wrap;
  }
  .checkout__step{
    border:1px solid rgba(11,122,79,0.12);
    border-top: 4px solid rgba(11,79,149,0.7);
    border-radius:18px;
    padding:16px 18px;
    display:grid;
    gap:12px;
    grid-template-columns:repeat(2,minmax(0,1fr));
    background:#ffffff;
    box-shadow:0 8px 28px rgba(12,25,40,0.08);
  }
  @media (max-width: 640px){
    .checkout__step{
      grid-template-columns:1fr;
    }
    .checkout__row{
      flex-direction:column;
    }
  }
  .checkout__step .full{ grid-column:1 / -1; }
  .checkout__step--hidden{ display:none !important; }
  .checkout__footer{
    padding:12px 20px 16px;
    border-top:1px solid rgba(0,0,0,0.05);
    display:flex;
    gap:10px;
    justify-content:flex-end;
    flex-wrap:wrap;
    background:#ffffff;
    position:sticky;
    bottom:0;
  }
  .checkout__footer .btn{ padding:10px 18px; font-size:0.82rem; }
  .checkout__label{
    font-size:0.83rem;
    letter-spacing:0;
    text-transform:none;
    color:#32404c;
    display:block;
    margin-bottom:4px;
    font-weight:600;
  }
  .checkout__input,
  .checkout__select{
    width:100%;
    padding:9px 12px;
    border:1px solid rgba(15,45,46,0.15);
    border-radius:14px;
    font-size:0.92rem;
    background:#fdfefe;
    color:#0d1f2a;
    transition:border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .checkout__input:focus,
  .checkout__select:focus{
    outline:none;
    border-color:#1ec28b;
    box-shadow:0 0 0 3px rgba(246,215,77,0.28);
  }
  .checkout__input::placeholder{
    color:rgba(30,30,30,0.45);
  }
  .checkout__muted{
    color:#4f6070;
    font-size:0.83rem;
  }
  .checkout__radio{
    display:grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap:12px;
  }
  .checkout__radio label{
    display:flex;
    align-items:center;
    gap:8px;
    padding:14px 16px;
    border-radius:18px;
    background:#f4f8fb;
    border:1px solid rgba(5,92,57,0.1);
    color:#0b1f2a;
    font-weight:700;
  }
  .checkout__radio label:has(input:checked){
    border-color: rgba(11,122,79,0.42);
    background: linear-gradient(120deg, rgba(246,215,77,0.18), rgba(11,122,79,0.08));
    box-shadow: 0 10px 24px rgba(11,122,79,0.1);
  }
  .checkout__radio input{
    accent-color:#67ffc4;
    width:16px;
    height:16px;
  }
  .badge{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    padding:2px 8px;
    border-radius:999px;
    background:#0f2d2e;
    color:#67ffc4;
    font-size:0.7rem;
    letter-spacing:0.15em;
    text-transform:uppercase;
  }
  .checkout-modal .btn--primary{
    background:linear-gradient(120deg,#075f42,#0b4f95);
    color:#ffffff;
    border:none;
    border-radius:18px;
    font-weight:700;
    letter-spacing:0;
    text-transform:none;
  }
  .checkout-modal .btn--ghost{
    background:#f4f8fb;
    color:#0d1f2a;
    border:1px solid rgba(15,45,46,0.15);
    border-radius:18px;
    letter-spacing:0;
    text-transform:none;
  }
  .checkout__cepBtn{
    padding:10px 16px;
    font-size:0.75rem;
    letter-spacing:0.2em;
  }
  .checkout__cepBtn:disabled{ opacity:0.4; pointer-events:none; }
  .checkout__link{
    margin:6px 0 0;
    font-size:0.78rem;
    color:#4b5b68;
  }
  .checkout__link a{ color:#0e6d4f; font-weight:600; }
  .checkout__status{
    margin:6px 0 0;
    font-size:0.78rem;
    color:#0f1f2a;
  }
  .checkout__status[data-status="warn"]{ color:#c77700; }
  .checkout__status[data-status="ok"]{ color:#117050; }
  .checkout__status[data-status="loading"]{ color:#006f9c; }

  .product-card__badge{ position:absolute; top:10px; left:10px; }
  .badge-off{
    display:inline-block; font-size:.75rem; line-height:1;
    padding:6px 8px; border-radius:8px; background:#ff3b30; color:#fff; font-weight:700; letter-spacing:.2px;
  }

  .size[aria-disabled="true"]{ pointer-events:none; filter: blur(0.3px) grayscale(0.9); opacity:.45; }

  .product-desc-list{ margin: 8px 0 0; padding-left: 18px; line-height: 1.45; }
  .product-card__desc{ color: var(--text-muted, #666); font-size: .92rem; }
  .color-tooltip{
    position: fixed;
    z-index: 10020;
    pointer-events: none;
    transform: translate(-50%, -100%);
    padding: 6px 10px;
    border-radius: 999px;
    background: linear-gradient(135deg, #008f46 0%, #007a52 46%, #063f92 100%);
    color: #fff;
    font-size: 0.68rem;
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
    box-shadow: 0 8px 22px rgba(0,75,70,0.22);
    text-shadow: 0 1px 2px rgba(0,0,0,0.32);
  }

  @media (max-width:640px){
    .checkout__grid{ grid-template-columns:1fr; }
    .checkout__row{ flex-direction:column; }
  }`;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);
})();

(function injectClientStyles(){
  const css = `
  dialog.addr-select-modal:not([open]){ display:none !important; }
  dialog.addr-select-modal{
    border:none; border-radius:20px; padding:0;
    width:min(520px,calc(100vw - 24px));
    background:#fff; color:#0d1f2a;
    box-shadow:0 28px 80px rgba(7,24,32,.28);
    overflow:hidden;
  }
  dialog.addr-select-modal::backdrop{
    background:rgba(6,18,28,.52); backdrop-filter:blur(8px);
  }
  .addrmodal__header{
    padding:18px 22px 14px; border-bottom:1px solid #eef0f2;
    display:flex; justify-content:space-between; align-items:flex-start;
  }
  .addrmodal__title{ font-size:1rem; font-weight:800; color:#0d1f2a; }
  .addrmodal__body{
    padding:14px 22px 8px;
    overflow-y:auto;
    max-height:min(54vh,400px);
    min-height:80px;
  }
  .addr-card{
    display:flex; align-items:flex-start; gap:12px; padding:13px 14px;
    border:1.5px solid #dde4ea; border-radius:12px; cursor:pointer;
    margin-bottom:9px; transition:border-color .18s,background .18s;
  }
  .addr-card:hover{ border-color:#009C3B; background:#f6fbf3; }
  .addr-card.selected{ border-color:#009C3B; background:#f0faf3; }
  .addr-card input[type="radio"]{ margin-top:3px; accent-color:#009C3B; flex-shrink:0; }
  .addr-card__line1{ font-size:.88rem; font-weight:700; color:#0d1f2a; }
  .addr-card__line2{ font-size:.8rem; color:#556b7d; margin-top:2px; }
  .addr-add-btn{
    width:100%; padding:12px; border:1.5px dashed #c0cdd6; border-radius:10px;
    background:none; font-size:.86rem; font-weight:700; color:#556b7d;
    cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;
    transition:border-color .18s, color .18s; margin-bottom:4px;
  }
  .addr-add-btn:hover{ border-color:#009C3B; color:#009C3B; }
  .addrmodal__footer{
    padding:12px 22px 14px; border-top:1px solid #eef0f2;
    display:flex; justify-content:flex-end; gap:10px; flex-shrink:0;
  }
  .addrmodal__footer .btn--primary:disabled{ opacity:.45; cursor:not-allowed; }
  .addr-new-form{
    margin-top:14px; padding:14px 16px; background:#f8fafc; border-radius:12px;
  }
  .addr-new-form .anf-label{
    display:block; font-size:.73rem; font-weight:700; letter-spacing:.07em;
    text-transform:uppercase; color:#778b9b; margin-bottom:5px;
  }
  .addr-new-form input{
    width:100%; padding:10px 12px; border:1.5px solid #dde4ea; border-radius:9px;
    font-size:.86rem; background:#fff; outline:none; color:#0d1f2a;
    transition:border-color .18s; font-family:inherit;
  }
  .addr-new-form input:focus{ border-color:#009C3B; }
  .addr-new-form input[readonly]{ color:#94a3b1; background:#f2f5f7; }
  .addr-new-form .anf-row{ display:grid; gap:8px; margin-bottom:10px; }
  .addr-new-form .anf-2{ grid-template-columns:1fr 1fr; }
  .addr-new-form .anf-3-1{ grid-template-columns:3fr 1fr; }
  .addr-new-form .anf-field{ margin-bottom:10px; }
  .addr-new-form .anf-save{
    margin-top:6px; width:100%; padding:12px; background:#009C3B; border:none;
    border-radius:10px; font-size:.86rem; font-weight:800; color:#fff;
    cursor:pointer; font-family:inherit; transition:background .18s;
  }
  .addr-new-form .anf-save:hover{ background:#007a2e; }
  .addr-new-form .anf-save:disabled{ opacity:.55; cursor:not-allowed; }
  .checkout__addr-banner{
    background:#f0faf3; border:1px solid rgba(0,156,59,.18);
    border-radius:12px; padding:12px 16px; margin-bottom:14px;
    display:flex; justify-content:space-between; align-items:flex-start; gap:10px;
  }
  .checkout__addr-banner-info{ flex:1; }
  .checkout__addr-banner-label{
    font-size:.72rem; font-weight:800; letter-spacing:.09em; text-transform:uppercase;
    color:#007a2e; margin-bottom:3px;
  }
  .checkout__addr-banner-text{ font-size:.84rem; color:#2a4a35; line-height:1.4; }
  .checkout__addr-banner-btn{
    background:none; border:1px solid rgba(0,156,59,.3); border-radius:8px;
    padding:4px 10px; font-size:.75rem; font-weight:700; color:#007a2e;
    cursor:pointer; white-space:nowrap; font-family:inherit; flex-shrink:0;
    transition:background .18s;
  }
  .checkout__addr-banner-btn:hover{ background:rgba(0,156,59,.1); }
  dialog.account-modal:not([open]){ display:none !important; }
  dialog.account-modal{
    border:none; border-radius:20px; padding:0;
    width:min(760px,calc(100vw - 24px));
    max-height:88dvh;
    background:#fff; color:#0d1f2a;
    box-shadow:0 28px 80px rgba(7,24,32,.28);
    overflow:hidden;
  }
  dialog.account-modal::backdrop{ background:rgba(6,18,28,.52); backdrop-filter:blur(8px); }
  .account__header{
    padding:18px 22px 14px;
    border-bottom:1px solid #eef0f2;
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
    background:linear-gradient(120deg, rgba(0,156,59,.08), rgba(0,39,118,.06));
  }
  .account__title{ font-size:1rem; font-weight:800; color:#0d1f2a; }
  .account__subtitle{ margin-top:3px; font-size:.82rem; color:#607080; }
  .account__close{
    width:36px; height:36px; border-radius:50%; border:1px solid #dbe3ea;
    background:#fff; color:#0d1f2a; cursor:pointer; font-weight:800;
  }
  .account__tabs{
    display:flex; gap:8px; padding:12px 18px 0; overflow-x:auto; scrollbar-width:none;
  }
  .account__tabs::-webkit-scrollbar{ display:none; }
  .account__tab{
    border:1px solid #dbe3ea; border-radius:999px; padding:9px 13px;
    background:#fff; color:#425466; font-weight:800; font-size:.76rem;
    letter-spacing:.04em; text-transform:uppercase; cursor:pointer; white-space:nowrap;
  }
  .account__tab[aria-selected="true"]{
    background:linear-gradient(120deg,#009C3B,#002776); color:#FFDF00; border-color:transparent;
  }
  .account__body{
    padding:18px 22px 20px;
    overflow-y:auto;
    height:clamp(420px,58dvh,620px);
    max-height:calc(88dvh - 132px);
  }
  .account__panel{ display:none; }
  .account__panel.is-active{
    display:flex;
    flex-direction:column;
    min-height:100%;
  }
  .account__profile{
    border:1px solid #e3e9ef;
    border-radius:14px;
    overflow:hidden;
    background:#fff;
  }
  .account__profile-row{
    display:grid;
    grid-template-columns:minmax(120px,0.42fr) minmax(0,1fr) auto;
    align-items:center;
    gap:12px;
    padding:14px 16px;
    border-bottom:1px solid #eef2f5;
  }
  .account__profile-row:last-child{ border-bottom:0; }
  .account__profile-label{
    color:#6b7b88; font-size:.74rem; font-weight:800;
    text-transform:uppercase; letter-spacing:.07em;
  }
  .account__profile-value{
    min-width:0; color:#0d1f2a; font-size:.92rem; font-weight:700;
    overflow-wrap:anywhere;
  }
  .account__profile-action{
    border:0; background:transparent; color:#0b6f52; font-weight:800;
    font-size:.76rem; cursor:pointer; padding:6px 0;
  }
  .account__profile-note{
    margin:12px 2px 0; color:#607080; font-size:.8rem; line-height:1.45;
  }
  .account__edit{ display:none; }
  .account__edit.is-active{ display:block; }
  .account__form{
    border:1px solid #e3e9ef;
    border-radius:14px;
    background:#fff;
    padding:14px;
    display:grid;
    gap:12px;
  }
  .account__form-row{ display:grid; gap:5px; }
  .account__form-row label{
    color:#6b7b88; font-size:.72rem; font-weight:800;
    text-transform:uppercase; letter-spacing:.07em;
  }
  .account__input{
    width:100%; min-height:42px; border:1px solid #dbe3ea; border-radius:10px;
    padding:0 12px; font:700 .9rem/1.2 Inter,system-ui,sans-serif; color:#0d1f2a; outline:none;
  }
  .account__input:focus{ border-color:#009C3B; box-shadow:0 0 0 3px rgba(0,156,59,.1); }
  .account__form-actions{ display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
  .account__save,.account__cancel{
    border-radius:10px; padding:10px 14px; font-weight:800; cursor:pointer;
  }
  .account__save{ border:0; background:linear-gradient(120deg,#009C3B,#002776); color:#FFDF00; }
  .account__cancel{ border:1px solid #dbe3ea; background:#fff; color:#425466; }
  .account__status{ min-height:18px; color:#b42323; font-size:.8rem; font-weight:700; }
  .account__card,.account__order{
    border:1px solid #e3e9ef; border-radius:14px; background:#fbfcfd; padding:12px 14px;
  }
  .account__card span{ display:block; color:#6b7b88; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; }
  .account__card strong{ display:block; margin-top:3px; color:#0d1f2a; font-size:.92rem; }
  .account__list{ display:grid; gap:10px; }
	  .account__order-head{ display:flex; justify-content:space-between; gap:10px; align-items:flex-start; font-weight:800; }
	  .account__order-meta{ margin-top:5px; color:#607080; font-size:.82rem; line-height:1.4; }
	  .account__items{ margin:8px 0 0; padding-left:18px; color:#344454; font-size:.82rem; }
	  .account__order-actions{ margin-top:10px; display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
	  .account__order-cancel{
	    border:1px solid #ffd1d1; border-radius:10px; background:#fff5f5; color:#b42323;
	    padding:9px 12px; font-weight:800; font-size:.76rem; cursor:pointer;
	  }
	  .account__order-cancel:disabled{ opacity:.6; cursor:not-allowed; }
	  .account__order-note{
	    margin-top:8px; border:1px solid #fde68a; border-radius:10px; background:#fffbeb;
	    color:#92400e; padding:8px 10px; font-size:.78rem; font-weight:700; line-height:1.35;
	  }
	  .account__empty{ color:#607080; padding:18px; border:1px dashed #d4dde5; border-radius:14px; background:#fbfcfd; }
  .account__actions{ margin-top:auto; padding-top:16px; display:flex; justify-content:flex-end; }
  .account__logout{
    border:1px solid #ffd1d1; border-radius:10px; background:#fff5f5; color:#b42323;
    padding:10px 14px; font-weight:800; cursor:pointer;
  }
  @media (max-width:640px){
    .account__profile-row{
      grid-template-columns:1fr;
      gap:4px;
      align-items:start;
    }
    .account__profile-action{ justify-self:start; }
    .account__body{ padding:16px; }
    .account__header{ padding:16px; }
  }
  `;
  const el = document.createElement("style");
  el.id = "lemoov-client-styles";
  el.innerHTML = css;
  document.head.appendChild(el);
})();

/* ------------------------------------------------------------
   Ordenação / Filtros / Grid
------------------------------------------------------------ */
function ordenar(lista){
  const arr = [...lista];
  switch(ordenacaoAtual){
    case 'preco-asc':   return arr.sort((a,b)=>a.preco - b.preco);
    case 'preco-desc':  return arr.sort((a,b)=>b.preco - a.preco);
    case 'nome-az':     return arr.sort((a,b)=>a.nome.localeCompare(b.nome));
    case 'nome-za':     return arr.sort((a,b)=>b.nome.localeCompare(a.nome));
    default:            return arr;
  }
}

function isLancamentoFilter(value){
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "lancamentos" || normalized === "lancamento";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function flattenSearchValue(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(flattenSearchValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(flattenSearchValue).join(" ");
  return String(value);
}

function getProductSearchText(prod) {
  const colors = Array.isArray(prod?.cores) ? prod.cores : [];
  return normalizeSearchText([
    prod?.nome,
    prod?.categoria,
    flattenSearchValue(prod?.desc),
    colors.map(c => [
      c?.nome,
      getColorSearchTerms(c),
      flattenSearchValue(c?.desc),
      Array.isArray(c?.tamanhos) ? c.tamanhos.join(" ") : "",
      c?.estoque ? Object.keys(c.estoque).join(" ") : ""
    ].join(" ")).join(" ")
  ].join(" "));
}

function matchesSearch(prod, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = getProductSearchText(prod);
  return terms.every(term => haystack.includes(term));
}

function updateCatalogSearchState(count) {
  const input = el("#catalogSearch");
  const clearBtn = el("#catalogSearchClear");
  const meta = el("#catalogSearchMeta");
  if (!input && !meta && !clearBtn) return;
  const query = buscaAtual.trim();
  if (input && input.value !== buscaAtual) input.value = buscaAtual;
  if (clearBtn) clearBtn.dataset.visible = query ? "true" : "false";
  if (!meta) return;
  if (query) {
    meta.textContent = `${count} resultado${count === 1 ? "" : "s"} para "${query}"`;
  } else {
    meta.textContent = "";
  }
}

function renderFiltros(){
  const wrap = el("#filters");
  if(!wrap) return;
  wrap.innerHTML = "";
  FILTER_CARDS.forEach(cardConf => {
    const card = document.createElement("article");
    card.className = "collection-card";
    if (cardConf.image) card.style.backgroundImage = `url('${cardConf.image}')`;
    const value = cardConf.categories.join("|");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `collection-card__content ${filtroAtual === value ? "collection-card__content--active" : ""}`;
    btn.dataset.applyFilter = value;
    btn.innerHTML = `
      <p>${cardConf.tagline}</p>
      <h3>${cardConf.label}</h3>
    `;
    btn.addEventListener("click", () => {
      filtroAtual = value;
      renderFiltros();
      renderGrid();
      const grid = el("#grid");
      if (grid) {
        grid.scrollIntoView({ behavior: "smooth", block: "start" });
        grid.classList.add("grid--highlight");
        setTimeout(() => grid.classList.remove("grid--highlight"), 1200);
        requestAnimationFrame(() => {
          const y = grid.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top: Math.max(y - 16, 0), behavior: "smooth" });
          if (location.hash !== "#grid") location.hash = "#grid";
        });
      }
    });
    card.appendChild(btn);
    wrap.appendChild(card);
  });
}

function buildSwatches(prod, onChange, selectedIndex = 0, mainImage = null, onColorAffectsDesc = null){
  const container = document.createElement("div");
  container.className = "swatches";
  const rendered = new Set();
  (prod.cores || []).forEach((c, idx)=>{
    const key = normalizeColorKey(c?.nome) || String(idx);
    if (rendered.has(key)) return;
    rendered.add(key);
    const b = document.createElement("button");
    b.className = "swatch";
    b.title = c.nome;
    b.dataset.index = idx;
    b.dataset.selected = (idx === selectedIndex) ? "true" : "false";
    b.type = "button";
    b.setAttribute("aria-pressed", (idx === selectedIndex) ? "true" : "false");
    b.setAttribute("aria-label", c.nome);
    appendSwatchContent(b, c);
    b.addEventListener("click", (e)=> {
      e.preventDefault(); e.stopPropagation();
      onChange(idx, c);
      container.querySelectorAll(".swatch").forEach(s => {
        s.dataset.selected = "false";
        s.setAttribute("aria-pressed", "false");
      });
      b.dataset.selected = "true";
      b.setAttribute("aria-pressed", "true");
      if (mainImage) setMainImageForProduct(mainImage, prod, idx, 0);
      if (typeof onColorAffectsDesc === "function") onColorAffectsDesc(idx);
    });
    container.appendChild(b);
  });
  return container;
}

function renderGrid(){
  const grid = el("#grid");
  if(!grid) return;

  let lista = produtos;
  if (filtroAtual && filtroAtual !== "Todos"){
    if (isLancamentoFilter(filtroAtual)) {
      lista = produtos.filter(p => p.lancamento);
    } else {
      const categorias = filtroAtual.split("|").map(s => s.trim());
      lista = produtos.filter(p => categorias.includes(p.categoria));
    }
  }
  if (buscaAtual.trim()) {
    lista = lista.filter(p => matchesSearch(p, buscaAtual));
  }
  lista = ordenar(lista);
  const disponiveis = lista.filter(p => !isProductSoldOut(p));
  const esgotados = lista.filter(p => isProductSoldOut(p));
  lista = [...disponiveis, ...esgotados];
  updateCatalogSearchState(lista.length);

  const countEl = document.querySelector("#productCount");
  if (countEl) countEl.textContent = "";

  grid.innerHTML = "";

  if (!lista.length) {
    const emptyText = buscaAtual.trim()
      ? "Nenhum produto encontrado para essa busca."
      : "Nenhum produto disponível no momento.";
    grid.innerHTML = `<div class="muted" style="padding:24px; text-align:center;">${emptyText}</div>`;
    attachCarouselAfterRender();
    return;
  }

  lista.forEach((p,i)=>{
    const artigo = document.createElement("article");
    artigo.className = "product-card";
    artigo.dataset.index = i;

    const primeiraImagem = (p.cores && p.cores.length) ? getColorImageForProduct(p, 0) : "";

    // estado local do card
    let selectedColorIndex = 0;
    let availableForColor = getAvailableSizesForColor(p, selectedColorIndex);
    let selectedSize = availableForColor[0] || null;
    const requiresSize = () => getAllSizesForColor(p, selectedColorIndex).length > 0;

    const desc0 = resolveDesc(p, 0);
    const short0 = formatShortDetalhamento(desc0);
    const cardNote = getCardNote(p, selectedColorIndex);
    const noteHtml = `<p class="product-card__note" data-card-note style="${cardNote ? "" : "display:none;"}">${cardNote}</p>`;

    artigo.innerHTML = `
      <a href="#" class="product-card__link">
        <figure class="product-card__media">
          <img src="${primeiraImagem}" alt="${getDisplayName(p, selectedColorIndex)}" loading="lazy" decoding="async"/>
          <span class="product-card__badge" data-badge-off style="display:none;">
            <span class="badge-off" data-badge-off-text></span>
          </span>
          <span class="product-card__badge product-card__badge--launch" data-badge-launch style="display:none;">
            <span class="badge-launch">Lançamento</span>
          </span>
          <span class="product-card__photo-hint" data-photo-hint>Clique para ver mais fotos</span>
        </figure>
        <div class="product-card__info">
          <h3 class="product-card__name" data-card-name>${getDisplayName(p, selectedColorIndex)}</h3>
          <p class="product-card__desc" data-short-desc>${short0}</p>
          <div class="product-card__price">
            <s class="original-price" data-price-original style="display:none;"></s>
            <span class="current-price" data-price-final></span>
          </div>
          ${noteHtml}
          <div class="product-card__options">
            <div class="product-card__colors">
              <legend class="product-card__legend">Cor:</legend>
              <div class="swatches" data-options-colors></div>
            </div>
            <div class="product-card__sizes">
              <legend class="product-card__legend">Tamanho:</legend>
              <div class="sizes__wrap" data-options-sizes></div>
            </div>
          </div>
        </div>
      </a>
      <button class="product-card__btn-add" data-add-quick>Adicionar ao carrinho</button>
    `;

    const colorsWrap = artigo.querySelector("[data-options-colors]");
    const sizesWrap  = artigo.querySelector("[data-options-sizes]");
    const $orig      = artigo.querySelector('[data-price-original]');
    const $final     = artigo.querySelector('[data-price-final]');
    const $badgeWrap = artigo.querySelector('[data-badge-off]');
    const $badgeTxt  = artigo.querySelector('[data-badge-off-text]');
    const $badgeLaunch = artigo.querySelector('[data-badge-launch]');
    const $shortDesc = artigo.querySelector('[data-short-desc]');
    const addBtn = artigo.querySelector("[data-add-quick]");
    const nameEl = artigo.querySelector("[data-card-name]");
    const noteEl = artigo.querySelector("[data-card-note]");
    const photoHint = artigo.querySelector("[data-photo-hint]");

    if ($badgeLaunch) {
      $badgeLaunch.style.display = p.lancamento ? "" : "none";
    }

    function refreshAddButton(){
      const soldOut = isVariantSoldOut(p, selectedColorIndex);
      const thereIsAvailable = availableForColor && availableForColor.length;
      const canAdd = !soldOut && (!requiresSize() || (thereIsAvailable && selectedSize));
      addBtn.disabled = !canAdd;
      if (canAdd) {
        addBtn.textContent = "Adicionar ao carrinho";
      } else {
        addBtn.textContent = soldOut ? "Esgotado" : "Indisponível";
      }
    }

    function updateCardPrice(colorIdx){
      const colorObj = (p.cores || [])[colorIdx] || null;
      const pr = computeColorPrice(p, colorObj);
      const soldOut = isVariantSoldOut(p, colorIdx);
      if (soldOut) {
        $orig.style.display = 'none';
        $badgeWrap.style.display = '';
        $badgeTxt.textContent = `Esgotado`;
      } else if (pr.original && pr.original > pr.final) {
        $orig.style.display = '';
        $orig.textContent = formatBRL(pr.original);
        $badgeWrap.style.display = '';
        $badgeTxt.textContent = `-${pr.pct}%`;
      } else {
        $orig.style.display = 'none';
        $badgeWrap.style.display = 'none';
      }
      $final.textContent = formatBRL(pr.final);
    }
    function updatePhotoHint(){
      const imgs = getColorGroupImages(p, selectedColorIndex);
      const hasMorePhotos = imgs.length > 1;
      if (photoHint) photoHint.dataset.visible = hasMorePhotos ? "true" : "false";
      const media = artigo.querySelector(".product-card__media");
      if (media) media.dataset.clickable = hasMorePhotos ? "true" : "false";
    }

    const mainImage = artigo.querySelector(".product-card__media img");
    if (mainImage) setMainImageForProduct(mainImage, p, 0, 0);
    updatePhotoHint();

    // Cores
    if (p.cores && p.cores.length) {
      colorsWrap.appendChild(
        buildSwatches(p, (idx, c) => {
          selectedColorIndex = idx;
          availableForColor = getAvailableSizesForColor(p, selectedColorIndex);
          const cardSizes = getAllSizesForColor(p, selectedColorIndex);
          selectedSize = applySizeAvailability(
            sizesWrap, cardSizes, availableForColor,
            (t)=>{ selectedSize = t; refreshAddButton(); }
          );
          if (nameEl) nameEl.textContent = getDisplayName(p, idx);
          if (mainImage) mainImage.alt = getDisplayName(p, idx);
          const nextNote = getCardNote(p, idx);
          if (noteEl) {
            if (nextNote) {
              noteEl.textContent = nextNote;
              noteEl.style.display = "";
            } else {
              noteEl.textContent = "";
              noteEl.style.display = "none";
            }
          }
          updateCardPrice(idx);
          updatePhotoHint();
          refreshAddButton();
        }, 0, mainImage, (idx)=>{
          const d = resolveDesc(p, idx);
          $shortDesc.textContent = formatShortDetalhamento(d);
        })
      );
    } else {
      colorsWrap.innerHTML = "<span class='muted'>Única cor</span>";
    }

    // Tamanhos (usa a cor inicial, índice 0)
    const cardSizes0 = getAllSizesForColor(p, 0);
    if (cardSizes0.length) {
      selectedSize = applySizeAvailability(
        sizesWrap, cardSizes0, availableForColor,
        (t)=>{ selectedSize = t; refreshAddButton(); }
      );
    } else {
      sizesWrap.innerHTML = "<span class='muted'>Tamanho único</span>";
      selectedSize = null;
    }

    updateCardPrice(0);
    updatePhotoHint();
    refreshAddButton();

    // Botão "Adicionar"
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();

      if (isVariantSoldOut(p, selectedColorIndex)) {
        showAppMessage("Esse item está esgotado.");
        refreshAddButton();
        return;
      }

      const thereIsAvailable = availableForColor && availableForColor.length;

      if (requiresSize() && (!thereIsAvailable || !selectedSize)) {
        showAppMessage("Selecione um tamanho disponível para essa cor.");
        return;
      }

      const priceNow = computeColorPrice(p, (p.cores||[])[selectedColorIndex]).final;

      const descAtual = formatShortDetalhamento(resolveDesc(p, selectedColorIndex));
      addCarrinho({
        productId: p.id,
        colorIndex: selectedColorIndex,
        nome: getDisplayName(p, selectedColorIndex),
        categoria: p.categoria,
        preco: priceNow,
        corSelecionada: (p.cores && p.cores[selectedColorIndex]) ? p.cores[selectedColorIndex].nome : undefined,
        tamanhoSelecionado: requiresSize() ? selectedSize : undefined,
        imagemSelecionada: (p.cores && p.cores[selectedColorIndex]) ? getColorImageForProduct(p, selectedColorIndex) : undefined,
        descricaoCurta: descAtual
      }, artigo.querySelector(".product-card__media img") || artigo);
    });

    const mediaFigure = artigo.querySelector(".product-card__media");
    if (mediaFigure && p.cores && p.cores.length) {
      mediaFigure.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const imgs = getColorGroupImages(p, selectedColorIndex);
        if (mainImage && imgs.length > 1) {
          const currentIndex = Number(mainImage.dataset.imgIndex) || 0;
          const nextIndex = (currentIndex + 1) % imgs.length;
          setMainImageForProduct(mainImage, p, selectedColorIndex, nextIndex);
          return;
        }
        if (p.cores.length > 1) {
          const swatches = colorsWrap.querySelectorAll(".swatch");
          if (!swatches.length) return;
          const nextIndex = (selectedColorIndex + 1) % swatches.length;
          swatches[nextIndex]?.click();
        }
      });
    }

    artigo.querySelector(".product-card__link").addEventListener("click", (e) => {
      if (e.target.closest(".swatch, .size")) return;
      e.preventDefault();
    });

    grid.appendChild(artigo);
  });

  attachCarouselAfterRender();
}

/* ==== Carrossel em cima do #grid sem reparent ==== */
function enableGridCarousel(options = {}) {
  const grid = document.getElementById('grid');
  if (!grid) return;

  grid.classList.add('carousel-active');

  let ctrls = document.querySelector('.grid-controls');
  if (!ctrls) {
    const container = document.querySelector('.content') || grid.parentElement;
    if (!container) return;

    ctrls = document.createElement('div');
    ctrls.className = 'grid-controls';
    ctrls.innerHTML = `
      <button type="button" id="gridPrev" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
      <button type="button" id="gridNext" aria-label="Próximo"><i class="fas fa-chevron-right"></i></button>
    `;
    container.style.position = container.style.position || 'relative';
    container.appendChild(ctrls);

    const page = () => grid.clientWidth;
    ctrls.querySelector('#gridPrev').addEventListener('click', () => {
      grid.scrollBy({ left: -page(), behavior: 'smooth' });
    });
    ctrls.querySelector('#gridNext').addEventListener('click', () => {
      grid.scrollBy({ left:  page(), behavior: 'smooth' });
    });

    // arrastar para rolar
    let down = false, startX = 0, startScroll = 0;
    grid.addEventListener('pointerdown', (e) => {
      const blocker = e.target.closest('.swatch, .size, [data-add-quick], .product-card__link');
      if (blocker) return;
      down = true; startX = e.clientX; startScroll = grid.scrollLeft;
      grid.setPointerCapture(e.pointerId);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!down) return;
      grid.scrollLeft = startScroll - (e.clientX - startX);
    });
    grid.addEventListener('pointerup',   () => { down = false; });
    grid.addEventListener('pointerleave',() => { down = false; });

  }
}
function attachCarouselAfterRender() {
  enableGridCarousel();
}

/* ------------------------------------------------------------
   Modal de produto
------------------------------------------------------------ */
function abrirModal(prodOrIndex){
  const base = (() => {
    if (!filtroAtual || filtroAtual === "Todos") return produtos;
    const cats = filtroAtual.split("|").map(s => s.trim());
    return produtos.filter(p => cats.includes(p.categoria));
  })();
  let prod = null;
  if (typeof prodOrIndex === "number") {
    prod = base[prodOrIndex] || null;
  } else if (prodOrIndex && typeof prodOrIndex === "object") {
    prod = prodOrIndex;
  } else if (typeof prodOrIndex === "string") {
    prod = base.find(p => String(p.id) === prodOrIndex || p.nome === prodOrIndex) || null;
  }
  if (!prod) return;
  produtoAtual = prod;
  corIndexAtual = 0;
  crmTrack('product_view', { productId: prod.id, productName: prod.nome });

  let allSizes = getAllSizesForColor(produtoAtual, 0);
  tamanhoAtual = null;

  const imgInicial = (produtoAtual.cores && produtoAtual.cores.length) ? getColorImageForProduct(produtoAtual, 0) : "";

  el("#modalImg").src = imgInicial;
  el("#modalNome").textContent = getDisplayName(produtoAtual, corIndexAtual);

  const desc0 = resolveDesc(produtoAtual, 0);
  el("#modalDesc").innerHTML = formatDescricaoHTML(desc0);

  const $modalPreco = el("#modalPreco");
  function renderModalPrice(){
    const cor = (produtoAtual.cores || [])[corIndexAtual] || null;
    const pr = computeColorPrice(produtoAtual, cor);
    const soldOut = isVariantSoldOut(produtoAtual, corIndexAtual);
    if (soldOut) {
      $modalPreco.innerHTML = `
        <strong>${formatBRL(pr.final)}</strong>
        <span class="badge-off" style="margin-left:8px;">Esgotado</span>
      `;
    } else if (pr.original && pr.original > pr.final) {
      $modalPreco.innerHTML = `
        <s class="original-price" style="margin-right:8px;">${formatBRL(pr.original)}</s>
        <strong>${formatBRL(pr.final)}</strong>
        <span class="badge-off" style="margin-left:8px;">-${pr.pct}%</span>
      `;
    } else {
      $modalPreco.innerHTML = `<strong>${formatBRL(pr.final)}</strong>`;
    }
  }
  renderModalPrice();

  // CORES
  const colorsWrap = el("#modalColors");
  colorsWrap.innerHTML = "";
  if (produtoAtual.cores && produtoAtual.cores.length){
    const renderedColors = new Set();
    produtoAtual.cores.forEach((c, idx)=>{
      const key = normalizeColorKey(c?.nome) || String(idx);
      if (renderedColors.has(key)) return;
      renderedColors.add(key);
      const b = document.createElement("button");
      b.className = "swatch";
      b.title = c.nome;
      b.dataset.index = idx;
      b.dataset.selected = (idx === 0) ? "true" : "false";
      b.type = "button";
      b.setAttribute("aria-pressed", (idx === 0) ? "true" : "false");
      b.setAttribute("aria-label", c.nome);
      appendSwatchContent(b, c);
      b.addEventListener("click", ()=>{
        corIndexAtual = idx;
        colorsWrap.querySelectorAll(".swatch").forEach(s=> {
          s.dataset.selected = "false";
          s.setAttribute("aria-pressed", "false");
        });
        b.dataset.selected = "true";
        b.setAttribute("aria-pressed", "true");
        setMainImageForProduct(el("#modalImg"), produtoAtual, idx, 0);
        el("#modalNome").textContent = getDisplayName(produtoAtual, corIndexAtual);

        allSizes = getAllSizesForColor(produtoAtual, corIndexAtual);
        const avail = getAvailableSizesForColor(produtoAtual, corIndexAtual);
        tamanhoAtual = applySizeAvailability(el("#modalSizes"), allSizes, avail, (t)=> { tamanhoAtual = t; updateAddButtonState(); });
        el("#modalDesc").innerHTML = formatDescricaoHTML(resolveDesc(produtoAtual, corIndexAtual));
        renderModalPrice();
        updateAddButtonState();
      });
      colorsWrap.appendChild(b);
    });
  } else {
    colorsWrap.textContent = "Única cor";
  }

  // TAMANHOS
  const sizesWrap = el("#modalSizes");
  sizesWrap.innerHTML = "";
  if (allSizes.length){
    const avail = getAvailableSizesForColor(produtoAtual, corIndexAtual);
    tamanhoAtual = applySizeAvailability(sizesWrap, allSizes, avail, (t)=> { tamanhoAtual = t; updateAddButtonState(); });
  } else {
    sizesWrap.textContent = "Tamanho único";
  }

  // Controle do botão "Adicionar"
  const btnAdd = el("#btnAdd");
  function updateAddButtonState(){
    const avail = getAvailableSizesForColor(produtoAtual, corIndexAtual);
    const requiresSize = allSizes.length > 0;
    const soldOut = isVariantSoldOut(produtoAtual, corIndexAtual);
    const canAdd = !soldOut && (!requiresSize || (avail.length && tamanhoAtual && avail.includes(tamanhoAtual)));
    btnAdd.disabled = !canAdd;
    if (canAdd) btnAdd.textContent = "Adicionar ao carrinho";
    else btnAdd.textContent = soldOut ? "Esgotado" : "Indisponível";
  }
  updateAddButtonState();

  const modal = el("#modal");
  if (modal) {
    modalLastFocus = document.activeElement;
    if (typeof modal.showModal === "function") {
      if (!modal.open) modal.showModal();
    }
    modal.classList.add("show");
    modal.setAttribute("aria-hidden","false");
    const closeBtn = el("#closeModal");
    if (closeBtn) closeBtn.focus();
  }

  const modalImg = el("#modalImg");
  if (modalImg) {
    modalImg.onclick = () => {
      const imgs = getColorGroupImages(produtoAtual, corIndexAtual);
      if (imgs.length <= 1) return;
      const curr = modalImg.getAttribute("data-img-index") || "0";
      const nextIndex = (parseInt(curr, 10) + 1) % imgs.length;
      modalImg.setAttribute("data-img-index", String(nextIndex));
      modalImg.src = imgs[nextIndex];
    };
  }

  el("#btnAdd").onclick = ()=>{
    if(!produtoAtual) return;
    const cor = (produtoAtual.cores && produtoAtual.cores.length) ? produtoAtual.cores[corIndexAtual] : null;

    if (isVariantSoldOut(produtoAtual, corIndexAtual)) {
      showAppMessage("Esse item está esgotado.");
      updateAddButtonState();
      return;
    }

    const avail = getAvailableSizesForColor(produtoAtual, corIndexAtual);
    const allSizes = produtoAtual.tamanhos || [];
    const requiresSize = allSizes.length > 0;
    const canAdd = !requiresSize || (avail.length && tamanhoAtual && avail.includes(tamanhoAtual));

    if (!canAdd){
      showAppMessage("Selecione um tamanho disponível para essa cor.");
      return;
    }

    const priceNow = computeColorPrice(produtoAtual, cor).final;

    const descricaoCurta = formatShortDetalhamento(resolveDesc(produtoAtual, corIndexAtual));
    addCarrinho({
      productId: produtoAtual.id,
      colorIndex: corIndexAtual,
      nome: getDisplayName(produtoAtual, corIndexAtual),
      categoria: produtoAtual.categoria,
      preco: priceNow,
      corSelecionada: cor ? cor.nome : undefined,
      tamanhoSelecionado: requiresSize ? tamanhoAtual : undefined,
      imagemSelecionada: cor ? getColorImageForProduct(produtoAtual, corIndexAtual) : undefined,
      descricaoCurta
    }, el(".modal__media img") || el("#modalImg") || el("#modal"));
  };
}
function fecharModal(){
  const modal = el("#modal");
  if (!modal) return;
  if (typeof modal.close === "function" && modal.open) {
    modal.close();
  } else {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    if (modalLastFocus) modalLastFocus.focus();
  }
}
const closeModalBtn = el("#closeModal");
if (closeModalBtn) closeModalBtn.onclick = fecharModal;
const modalEl = el("#modal");
if (modalEl) {
  modalEl.addEventListener("close", () => {
    modalEl.classList.remove("show");
    modalEl.setAttribute("aria-hidden","true");
    if (modalLastFocus) modalLastFocus.focus();
  });
}

/* ------------------------------------------------------------
   Carrinho
------------------------------------------------------------ */
function getItemQty(item){
  return Math.max(1, Number(item?.quantidade) || 1);
}
function getItemLineTotal(item){
  return (Number(item?.preco) || 0) * getItemQty(item);
}
function getCartSubtotal(){
  return carrinho.reduce((a, b) => a + getItemLineTotal(b), 0);
}
function getCartCount(){
  return carrinho.reduce((a, b) => a + getItemQty(b), 0);
}
function getEffectivePrice(prod){
  const base = Number(prod?.preco) || 0;
  const promo = Number(prod?.precoPromo) || 0;
  return promo > 0 && promo < base ? promo : base;
}
function getCartStockKey(item){
  return [
    String(item?.productId ?? ""),
    String(Number(item?.colorIndex) || 0),
    normalizeStockSize(item?.tamanhoSelecionado || "UNICO")
  ].join("|");
}
function getCartMergeKey(item){
  return [
    getCartStockKey(item),
    String(item?.tipoSelecionado || ""),
    String(item?.corSelecionada || "")
  ].join("|");
}
function getCartQtyForStockKey(stockKey){
  return carrinho.reduce((total, item) => {
    return getCartStockKey(item) === stockKey ? total + getItemQty(item) : total;
  }, 0);
}
function getSourceColorForCartItem(item){
  const sourceProduct = produtos.find((p) => String(p.id) === String(item?.productId));
  if (!sourceProduct) return { sourceProduct: null, sourceColor: null };
  const sourceColorIndex = Number(item?.colorIndex) || 0;
  const sourceColor = Array.isArray(sourceProduct.cores) ? sourceProduct.cores[sourceColorIndex] : null;
  return { sourceProduct, sourceColor };
}
function getCartItemStockQty(item){
  const { sourceColor } = getSourceColorForCartItem(item);
  return getStockQtyForSize(sourceColor, item?.tamanhoSelecionado || "UNICO");
}
function validateCartItemStock(item, incomingQty = 0){
  const stockQty = getCartItemStockQty(item);
  const requestedQty = getCartQtyForStockKey(getCartStockKey(item)) + Math.max(0, Number(incomingQty) || 0);
  if (requestedQty <= stockQty) return true;
  showAppMessage(getStockWarningMessage(stockQty), { title: "Estoque insuficiente" });
  return false;
}
function validateWholeCartStock(){
  const requestedByStockKey = new Map();
  for (const item of carrinho) {
    const stockKey = getCartStockKey(item);
    requestedByStockKey.set(stockKey, (requestedByStockKey.get(stockKey) || 0) + getItemQty(item));
  }
  for (const item of carrinho) {
    const stockQty = getCartItemStockQty(item);
    const requestedQty = requestedByStockKey.get(getCartStockKey(item)) || 0;
    if (requestedQty > stockQty) {
      showAppMessage(getStockWarningMessage(stockQty), { title: "Estoque insuficiente" });
      return false;
    }
  }
  return true;
}
function addCarrinho(prod, animateSource = null){
  const sourceProduct = produtos.find((p) => String(p.id) === String(prod.productId));
  const sourceColorIndex = Number(prod.colorIndex) || 0;
  if (sourceProduct && isVariantSoldOut(sourceProduct, sourceColorIndex)) {
    showAppMessage("Esse item está esgotado.");
    renderGrid();
    return;
  }
  const item = {
    productId: prod.productId,
    colorIndex: prod.colorIndex,
    nome: prod.nome,
    categoria: prod.categoria,
    preco: getEffectivePrice(prod),
    quantidade: getItemQty(prod),
    tipoSelecionado: prod.tipoSelecionado,
    corSelecionada: prod.corSelecionada,
    tamanhoSelecionado: prod.tamanhoSelecionado,
    imagemSelecionada: prod.imagemSelecionada,
    descricaoCurta: prod.descricaoCurta || ""
  };
  if (!validateCartItemStock(item, getItemQty(item))) return;
  const mergeKey = getCartMergeKey(item);
  const existing = carrinho.find((cartItem) => getCartMergeKey(cartItem) === mergeKey);
  if (existing) {
    existing.quantidade = getItemQty(existing) + getItemQty(item);
    existing.preco = item.preco;
    existing.imagemSelecionada = item.imagemSelecionada || existing.imagemSelecionada;
    existing.descricaoCurta = item.descricaoCurta || existing.descricaoCurta;
  } else {
    carrinho.push(item);
  }
  _touchCart();
  atualizarCart();
  animateCartIcon();
  if (animateSource) animateProductFly(animateSource);
  trackEvent("add_to_cart", {
    currency: "BRL",
    value: getItemLineTotal(item),
    item_name: item.nome,
    item_category: item.categoria,
    quantity: getItemQty(item)
  });
  crmTrack('add_to_cart', { productId: item.productId, productName: item.nome });
}
function removerCarrinho(index){
  carrinho.splice(index,1);
  _touchCart();
  atualizarCart();
}
function alterarQuantidadeCarrinho(index, delta){
  const item = carrinho[index];
  if (!item) return;
  const currentQty = getItemQty(item);
  const nextQty = currentQty + Number(delta || 0);
  if (nextQty <= 0) return;
  if (nextQty > currentQty && !validateCartItemStock(item, nextQty - currentQty)) return;
  item.quantidade = nextQty;
  _touchCart();
  atualizarCart();
}

function ensureAddMoreButton() {
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;
  if (!footer.querySelector("#btnAddMore")) {
    const btn = document.createElement("button");
    btn.id = "btnAddMore";
    btn.className = "btn btn--ghost";
    btn.textContent = "Adicionar mais itens";
    btn.addEventListener("click", () => {
      closeCart();
      setTimeout(() => {
        const grid = el("#grid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
          grid.classList.add("grid--highlight");
          setTimeout(()=> grid.classList.remove("grid--highlight"), 1200);
        }
      }, 150);
    });
    footer.insertBefore(btn, footer.firstChild);
  }
}

function ensureFreteSubtotalRows() {
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;

  // Compatível: encontra a linha de TOTAL sem usar :has()
  let totalRow = null;
  const totalStrong = footer.querySelector("#cartTotal");
  if (totalStrong) totalRow = totalStrong.closest(".cart__total");
  if (!totalRow) totalRow = footer.querySelector(".cart__total");
  if (!totalRow) return;

  if (!footer.querySelector("#cartSubtotal")) {
    const rowSubtotal = document.createElement("div");
    rowSubtotal.className = "cart__total";
    rowSubtotal.innerHTML = `<span>Produtos:</span><strong id="cartSubtotal">R$ 0,00</strong>`;
    footer.insertBefore(rowSubtotal, totalRow);
  }
  if (!footer.querySelector("#cartFrete")) {
    const rowFrete = document.createElement("div");
    rowFrete.className = "cart__total";
    rowFrete.innerHTML = `<span>Frete:</span><strong id="cartFrete">—</strong>`;
    footer.insertBefore(rowFrete, totalRow);
  }
  if (!footer.querySelector("#cartDiscountRow")) {
    const rowDiscount = document.createElement("div");
    rowDiscount.className = "cart__total";
    rowDiscount.id = "cartDiscountRow";
    rowDiscount.style.display = "none";
    rowDiscount.innerHTML = `<span>Desconto:</span><strong id="cartDiscount">R$ 0,00</strong>`;
    footer.insertBefore(rowDiscount, totalRow);
  }
}

function ensureCartCouponUI() {
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;
  const existing = footer.querySelector("#cartCouponBox");
  if (!currentClientSession) {
    if (existing) existing.style.display = "none";
    return;
  }
  if (existing) { existing.style.display = ""; return; }
  const box = document.createElement("div");
  box.id = "cartCouponBox";
  box.className = "cart-coupon";
  box.innerHTML = `
    <label class="cart-coupon__label" for="cartCouponInput">Cupom de desconto</label>
    <div class="cart-coupon__row">
      <input id="cartCouponInput" class="cart-coupon__input" placeholder="Digite seu cupom" autocomplete="off" />
      <button type="button" class="cart-coupon__btn" id="btnApplyCartCoupon">Aplicar</button>
    </div>
    <div class="cart-coupon__msg" id="cartCouponMsg" data-status="info"></div>
  `;
  const totalRow = footer.querySelector("#cartTotal")?.closest(".cart__total") || null;
  footer.insertBefore(box, totalRow);
  box.querySelector("#cartCouponInput").value = cartCouponCode || checkoutDiscountState.cupom || "";
  box.querySelector("#btnApplyCartCoupon").addEventListener("click", applyCartCoupon);
  box.querySelector("#cartCouponInput").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyCartCoupon();
    }
  });
}

// Esconde UI antiga de frete (se existir no HTML)
function hideLegacyFreteUI() {
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;
  footer.querySelectorAll('input[placeholder*="somente números" i]').forEach(inp => {
    (inp.closest("form, div, section") || inp).style.display = "none";
  });
  Array.from(footer.querySelectorAll("button")).forEach(btn => {
    if (btn.textContent.trim().toUpperCase() === "CALCULAR FRETE") {
      (btn.closest("form, div, section") || btn).style.display = "none";
    }
  });
  Array.from(footer.querySelectorAll("*")).forEach(node => {
    const txt = (node.textContent || "").trim();
    if (/^calcular frete$/i.test(txt)) {
      (node.closest("form, div, section") || node).style.display = "none";
    }
  });
}

// Cria UI de CEP/GPS (funcional) e esconde a antiga
function ensureFreteUI() {
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;

  if (!footer.querySelector(".frete__ui")) {
    const wrap = document.createElement("div");
    wrap.className = "frete__ui";
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `
      <label class="pickup-toggle" for="pickupToggle">
        <input id="pickupToggle" type="checkbox" />
        <span class="pickup-toggle__control" aria-hidden="true"></span>
        <span class="pickup-toggle__text">
          <strong>Vou retirar meu pedido</strong>
          <span>Marcando esta opção, você se compromete a retirar o item e o frete não é calculado.</span>
        </span>
      </label>
      <div class="frete__row">
        <input id="cepInput" type="text" inputmode="numeric"
          placeholder="CEP de entrega"
          autocomplete="postal-code"
          aria-label="Digite o CEP de entrega" />
        <button id="btnUseLocation" class="btn">📍 Localização</button>
      </div>
      <div id="freteMsg" class="frete__msg">
        Informe o CEP para calcular o frete (estimativa).
      </div>
      <div id="freteNumeroForm" class="frete__numero-form" style="display:none;">
        <div id="freteEnderecoPreview" class="frete__endereco-preview"></div>
        <div class="frete__numero-full">
          <input id="freteLogradouroInput" type="text" placeholder="Logradouro (Rua, Av…) *" maxlength="80">
        </div>
        <div class="frete__numero-row">
          <input id="freteNumeroInput" type="text" inputmode="numeric" placeholder="Número *" maxlength="10">
          <input id="freteComplementoInput" type="text" placeholder="Complemento" maxlength="40">
        </div>
        <button id="btnConfirmarNumero" type="button" class="btn btn--primary frete__confirmar-btn">Confirmar endereço</button>
      </div>
      <div id="cartAddressSummary" class="cart-address-summary" style="display:none;"></div>
      <div id="freteOpcoes" class="frete__opcoes" style="display:none;"></div>
      <div class="checkout__link">
        Não sabe o CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Consultar nos Correios</a>
      </div>
    `;
    footer.insertBefore(wrap, footer.firstChild);
  }
  hideLegacyFreteUI();
}

function mostrarOpcoesTransportadora(opcoes) {
  const container = el('#freteOpcoes');
  if (!container) return;
  container.style.display = 'flex';
  container.innerHTML = opcoes.map((op, i) => `
    <label class="frete__opcao${i === 0 ? ' selected' : ''}" data-modo="${op.modo}" data-valor="${op.valor}">
      <input type="radio" name="freteOpcao" value="${i}" ${i === 0 ? 'checked' : ''}>
      ${op.logo ? `<img class="frete__opcao-logo" src="${op.logo}" alt="${op.empresa || op.servico}">` : ''}
      <div class="frete__opcao-info">
        <span class="frete__opcao-nome">${op.servico}</span>
        ${op.empresa ? `<span class="frete__opcao-empresa">${op.empresa}</span>` : ''}
        ${op.prazo ? `<span class="frete__opcao-prazo">${op.prazo}${op.contingencia ? ' (estimativa)' : ''}</span>` : ''}
      </div>
      <span class="frete__opcao-preco">R$ ${op.valor.toFixed(2).replace('.', ',')}</span>
    </label>
  `).join('');

  // selecionar a primeira opção
  const primeira = opcoes[0];
  freteAtual = primeira.valor;
  freteModo  = primeira.modo;
  entregaDisponivel = true;
  atualizarCart();

  container.querySelectorAll('.frete__opcao').forEach((lbl) => {
    lbl.addEventListener('click', () => {
      container.querySelectorAll('.frete__opcao').forEach(l => l.classList.remove('selected'));
      lbl.classList.add('selected');
      freteAtual = parseFloat(lbl.dataset.valor);
      freteModo  = lbl.dataset.modo;
      entregaDisponivel = true;
      atualizarCart();
    });
  });
}

function esconderOpcoesTransportadora() {
  const container = el('#freteOpcoes');
  if (container) { container.style.display = 'none'; container.innerHTML = ''; }
}

function renderCartDeliveryState() {
  const box = document.querySelector(".frete__ui");
  if (!box) return;
  const msg = el("#freteMsg");
  const addrBox = el("#cartAddressSummary");
  box.dataset.auth = currentClientSession ? "logged-in" : "logged-out";
  const cartEl = document.querySelector("#cart");
  if (cartEl) cartEl.dataset.cartAuth = currentClientSession ? "logged-in" : "logged-out";
  if (!currentClientSession) {
    if (addrBox) { addrBox.style.display = "none"; addrBox.innerHTML = ""; }
    if (msg && !retiradaNaLoja && !msg.textContent) msg.textContent = "Informe o CEP para calcular o frete (estimativa).";
    return;
  }
  if (retiradaNaLoja) {
    if (addrBox) { addrBox.style.display = "none"; addrBox.innerHTML = ""; }
    if (msg) msg.textContent = "Retirada selecionada. Endereço não será usado para entrega e frete não será cobrado.";
    return;
  }
  if (selectedDeliveryAddress && !retiradaNaLoja) {
    const addr = selectedDeliveryAddress;
    const line1 = `${addr.logradouro || ""}, ${addr.numero || ""}${addr.complemento ? " - " + addr.complemento : ""}`;
    const line2 = `${addr.bairro ? addr.bairro + ", " : ""}${addr.cidade || ""}/${addr.uf || ""} - CEP ${formatCEPForInput(addr.cep || "")}`;
    if (addrBox) {
      addrBox.style.display = "";
      addrBox.innerHTML = `<div><strong>Entrega cadastrada</strong><span>${escapeHTML(line1)}<br>${escapeHTML(line2)}</span></div><button type="button" id="btnCartChangeAddr">Alterar</button>`;
      addrBox.querySelector("#btnCartChangeAddr")?.addEventListener("click", async () => {
        const addresses = await fetchClientAddresses();
        openAddressSelectionModal(addresses);
      });
    }
    if (msg) msg.textContent = entregaDisponivel ? getFreteResumoLabel({ includeCep: true }) : "Calculando frete pelo endereço cadastrado...";
    return;
  }
  if (addrBox) {
    addrBox.style.display = "none";
    addrBox.innerHTML = "";
  }
  if (msg) {
    if (entregaDisponivel && cepAtual) msg.textContent = getFreteResumoLabel({ includeCep: true });
    else if (!freteCepLoading) msg.textContent = "Digite o CEP acima para calcular o frete.";
  }
}

async function autoLoadDeliveryFromClient() {
  if (!currentClientSession || retiradaNaLoja) return;
  if (selectedDeliveryAddress) {
    if (!entregaDisponivel && selectedDeliveryAddress.cep) {
      renderCartDeliveryState();
      const backendOk = await calcularFreteBackend(selectedDeliveryAddress);
      if (!backendOk) {
        try { await calcularEntregaPorCEP(selectedDeliveryAddress.cep); } catch (_) {}
      }
      renderCartDeliveryState();
      atualizarCart();
    }
    return;
  }
  if (entregaDisponivel) return;
  const addresses = await fetchClientAddresses();
  if (!addresses.length) {
    renderCartDeliveryState();
    updateCheckoutButtonState();
    return;
  }
  setDeliveryAddress(addresses[0]);
  renderCartDeliveryState();
  const backendOk = await calcularFreteBackend(selectedDeliveryAddress);
  if (!backendOk && selectedDeliveryAddress.cep) {
    try { await calcularEntregaPorCEP(selectedDeliveryAddress.cep); } catch (_) {}
  }
  renderCartDeliveryState();
  atualizarCart();
}

async function calcularFreteBackend(addr, options = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Number(options.timeoutMs) || 12000);
  try {
    const r = await fetch('/api/frete', {
      method: 'POST',
      credentials: 'same-origin',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidade: addr.cidade, cep: addr.cep })
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d.ok) return false;
    if (options.seq && !isCurrentFreteCepRequest(options.seq, options.cep || addr.cep)) return false;
    cepAtual = String(addr.cep).replace(/\D/g, '');

    if (d.tipo === 'opcoes' && Array.isArray(d.opcoes) && d.opcoes.length) {
      freteOpcoesCache = d.opcoes;
      mostrarOpcoesTransportadora(d.opcoes);
      return true;
    }
    freteOpcoesCache = [];

    esconderOpcoesTransportadora();
    freteAtual = d.valor;
    entregaDisponivel = true;
    if (d.tipo === 'Entrega Local') {
      if (d.valor <= 12)      freteModo = 'local_12';
      else if (d.valor <= 15) freteModo = 'local_15';
      else                    freteModo = 'local_25';
    } else {
      freteModo = 'sedex';
    }
    atualizarCart();
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkClientSession() {
  try {
    const res = await fetch('/api/client/me', { credentials: 'same-origin' });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return data.ok ? { ok: true, client: data.client } : { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

async function initiateCheckout() {
  if (carrinho.length === 0) { showAppMessage("Seu carrinho está vazio."); return; }
  if (!validateWholeCartStock()) return;

  const sessionResult = await checkClientSession();
  if (!sessionResult.ok) {
    openLoginModal(async () => {
      // Após login: volta ao carrinho com todas as opções (frete, cupom, endereço)
      ensureCartClientSummary();
      atualizarCart();
      await autoLoadDeliveryFromClient();
      atualizarCart();
    });
    return;
  }
  currentClientSession = sessionResult.client;
  ensureCartClientSummary();
  atualizarCart();
  await autoLoadDeliveryFromClient();

  if (retiradaNaLoja) {
    openCheckoutModal();
    return;
  }

  if (selectedDeliveryAddress && !selectedDeliveryAddress.numero) {
    showAppMessage("Complete o número do endereço de entrega antes de gerar o pagamento.");
    openAddressSelectionModal(await fetchClientAddresses());
    return;
  }

  if (entregaDisponivel && isFixedFreteMode()) {
    openCheckoutModal();
    return;
  }

  openAddressSelectionModal(await fetchClientAddresses());
}

function openAddressSelectionModal(addresses) {
  const existing = document.getElementById('addrSelectModal');
  if (existing) existing.remove();

  const dlg = document.createElement('dialog');
  dlg.id = 'addrSelectModal';
  dlg.className = 'addr-select-modal';

  const hasAddresses = addresses.length > 0;
  const safeAddressLine = (addr) => {
    const line1 = `${addr.logradouro || ""}, ${addr.numero || ""}${addr.complemento ? ' – ' + addr.complemento : ''}`;
    const line2 = `${addr.bairro ? addr.bairro + ', ' : ''}${addr.cidade || ""} – ${addr.uf || ""} &bull; CEP ${formatCEPForInput(addr.cep || "")}`;
    return { line1: escapeHTML(line1), line2: escapeHTML(line2).replace("&amp;bull;", "&bull;") };
  };

  const clienteName = currentClientSession?.nome ? currentClientSession.nome.split(' ')[0] : '';

  dlg.innerHTML = `
    <div class="addrmodal__header">
      <div>
        <div class="addrmodal__title">Endereço de entrega</div>
        ${clienteName ? `<div style="font-size:.78rem;color:#556b7d;margin-top:2px;">Olá, <strong>${escapeHTML(clienteName)}</strong>! Selecione onde entregar.</div>` : ''}
      </div>
      <button type="button" class="btn btn--ghost" id="btnCloseAddrModal" style="padding:5px 11px;font-size:1rem;">✕</button>
    </div>
    <div class="addrmodal__body" id="addrModalBody">
      ${hasAddresses ? addresses.map((addr, i) => `
        <label class="addr-card${i === 0 ? ' selected' : ''}" data-addr-idx="${i}" style="cursor:pointer;">
          <input type="radio" name="addr_sel" value="${i}" ${i === 0 ? 'checked' : ''}>
          <div class="addr-card__body">
            <div class="addr-card__line1">${safeAddressLine(addr).line1}</div>
            <div class="addr-card__line2">${safeAddressLine(addr).line2}</div>
          </div>
        </label>
      `).join('') : ''}
      <button type="button" class="addr-add-btn" id="btnShowAddrForm">
        <span>+</span> Adicionar novo endereço
      </button>
      <div id="addrNewForm" class="addr-new-form" style="display:none;">
        <div class="anf-field">
          <label class="anf-label">CEP *</label>
          <input type="text" id="addrCep" placeholder="00000-000" inputmode="numeric" maxlength="9">
        </div>
        <div class="anf-field">
          <label class="anf-label">Logradouro *</label>
          <input type="text" id="addrRua" placeholder="Rua das Flores" readonly>
        </div>
        <div class="anf-row anf-3-1">
          <div class="anf-field"><label class="anf-label">Bairro</label><input type="text" id="addrBairro" placeholder="Bairro" readonly></div>
          <div class="anf-field"><label class="anf-label">UF</label><input type="text" id="addrUf" placeholder="SP" readonly maxlength="2"></div>
        </div>
        <div class="anf-row anf-2">
          <div class="anf-field">
            <label class="anf-label">Número *</label>
            <input type="text" id="addrNumero" placeholder="123" inputmode="text">
          </div>
          <div class="anf-field">
            <label class="anf-label">Complemento</label>
            <input type="text" id="addrComplemento" placeholder="Apto 42">
          </div>
        </div>
        <div class="anf-field">
          <label class="anf-label">Cidade *</label>
          <input type="text" id="addrCidade" placeholder="São Paulo" readonly>
        </div>
        <button type="button" class="anf-save" id="btnSaveNewAddr">Salvar e usar este endereço</button>
      </div>
    </div>
    <div class="addrmodal__footer">
      <button type="button" class="btn btn--ghost" id="btnCancelAddrModal">Cancelar</button>
      <button type="button" class="btn btn--primary" id="btnConfirmAddr" ${!hasAddresses ? 'disabled' : ''}>Confirmar →</button>
    </div>
  `;

  document.body.appendChild(dlg);
  dlg.showModal();

  let _lastAddrCep = '';
  if (hasAddresses) setDeliveryAddress(addresses[0]);
  else selectedDeliveryAddress = null;

  const showAddressForm = (addr = null) => {
    const form = dlg.querySelector('#addrNewForm');
    if (!form) return;
    form.style.display = 'block';
    dlg.querySelector('#btnConfirmAddr').disabled = true;
    dlg.querySelectorAll('.addr-card').forEach(c => c.classList.remove('selected'));
    if (addr) {
      dlg.querySelector('#addrCep').value = formatCEPForInput(addr.cep || "");
      dlg.querySelector('#addrRua').value = addr.logradouro || "";
      dlg.querySelector('#addrBairro').value = addr.bairro || "";
      dlg.querySelector('#addrNumero').value = addr.numero || "";
      dlg.querySelector('#addrComplemento').value = addr.complemento || "";
      dlg.querySelector('#addrCidade').value = addr.cidade || "";
      dlg.querySelector('#addrUf').value = addr.uf || "";
    } else {
      ['#addrCep','#addrRua','#addrBairro','#addrNumero','#addrComplemento','#addrCidade','#addrUf'].forEach((selector) => {
        const input = dlg.querySelector(selector);
        if (input) input.value = "";
      });
    }
    selectedDeliveryAddress = null;
    renderCartDeliveryState();
    setTimeout(() => dlg.querySelector('#addrNumero')?.focus(), 50);
  };

  if (selectedDeliveryAddress && !selectedDeliveryAddress.numero) {
    showAddressForm(selectedDeliveryAddress);
  }

  dlg.querySelectorAll('.addr-card').forEach((card) => {
    card.addEventListener('click', () => {
      dlg.querySelectorAll('.addr-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      setDeliveryAddress(addresses[Number(card.dataset.addrIdx)]);
      dlg.querySelector('#btnConfirmAddr').disabled = false;
    });
  });

  dlg.querySelector('#btnShowAddrForm').addEventListener('click', () => {
    const form = dlg.querySelector('#addrNewForm');
    const showing = form.style.display !== 'none';
    form.style.display = showing ? 'none' : 'block';
    if (!showing) {
      showAddressForm();
    } else if (hasAddresses) {
      setDeliveryAddress(addresses[0]);
      dlg.querySelectorAll('.addr-card')[0]?.classList.add('selected');
      dlg.querySelector('#btnConfirmAddr').disabled = false;
    }
  });

  const addrCepInput = dlg.querySelector('#addrCep');
  addrCepInput.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    this.value = v;
    const plain = v.replace('-', '');
    if (plain.length === 8 && plain !== _lastAddrCep) {
      _lastAddrCep = plain;
      _fetchAddrModalCEP(plain, dlg);
    }
  });
  addrCepInput.addEventListener('blur', function () {
    const plain = this.value.replace(/\D/g, '');
    if (plain.length === 8 && plain !== _lastAddrCep) {
      _lastAddrCep = plain;
      _fetchAddrModalCEP(plain, dlg);
    }
  });

  dlg.querySelector('#btnSaveNewAddr').addEventListener('click', async () => {
    const cep = dlg.querySelector('#addrCep').value.replace(/\D/g, '');
    const rua = dlg.querySelector('#addrRua').value.trim();
    const bairro = dlg.querySelector('#addrBairro').value.trim();
    const numero = dlg.querySelector('#addrNumero').value.trim();
    const complemento = dlg.querySelector('#addrComplemento').value.trim();
    const cidade = dlg.querySelector('#addrCidade').value.trim();
    const uf = dlg.querySelector('#addrUf').value.trim();

    if (!numero) {
      dlg.querySelector('#addrNumero').focus();
      showAppMessage("O campo Número é obrigatório para salvar o endereço.");
      return;
    }
    if (!cep || cep.length !== 8 || !rua || !cidade || !uf) {
      showAppMessage("Preencha o CEP e o endereço completo antes de continuar.");
      return;
    }
    const saveBtn = dlg.querySelector('#btnSaveNewAddr');
    saveBtn.disabled = true; saveBtn.textContent = 'Salvando…';
    try {
      const res = await fetch('/api/client/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cep, logradouro: rua, numero, complemento, bairro, cidade, uf })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 || res.status === 401) {
        showAppMessage(data.error || "Não foi possível salvar o endereço no banco. Tente novamente.");
        saveBtn.disabled = false; saveBtn.textContent = 'Salvar e usar este endereço';
        return;
      }
      if (!res.ok) {
        showAppMessage(data.error || 'Erro ao salvar endereço.');
        saveBtn.disabled = false; saveBtn.textContent = 'Salvar e usar este endereço';
        return;
      }
      setDeliveryAddress({ id: data.id, cep, logradouro: rua, numero, complemento, bairro, cidade, uf });
      dlg.querySelector('#btnConfirmAddr').disabled = false;
      dlg.querySelector('#addrNewForm').style.display = 'none';
    } catch (_) {
      showAppMessage("Não foi possível salvar o endereço no banco. Tente novamente.");
      saveBtn.disabled = false; saveBtn.textContent = 'Salvar e usar este endereço';
    }
  });

  dlg.querySelector('#btnConfirmAddr').addEventListener('click', async () => {
    if (!selectedDeliveryAddress) {
      showAppMessage("Selecione ou cadastre um endereço de entrega.");
      return;
    }
    if (!selectedDeliveryAddress.numero) {
      showAppMessage("Complete o número do endereço de entrega antes de continuar.");
      showAddressForm(selectedDeliveryAddress);
      return;
    }
    const btn = dlg.querySelector('#btnConfirmAddr');
    btn.disabled = true; btn.textContent = 'Calculando frete…';
    retiradaNaLoja = false;
    applyPickupUIState();
    if (!retiradaNaLoja && selectedDeliveryAddress.cep) {
      const backendOk = await calcularFreteBackend(selectedDeliveryAddress);
      if (!backendOk) {
        try { await calcularEntregaPorCEP(selectedDeliveryAddress.cep); } catch (_) {}
      }
    }
    dlg.close();
    dlg.remove();
    openCheckoutModal();
  });

  dlg.querySelector('#btnCloseAddrModal').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#btnCancelAddrModal').addEventListener('click', () => { dlg.close(); dlg.remove(); });
}

async function _fetchAddrModalCEP(cep, dlg) {
  try {
    const data = await getAddressByCEP(cep);
    if (!data) { showAppMessage("CEP não encontrado."); return; }
    const map = { '#addrRua': data.rua, '#addrBairro': data.bairro, '#addrCidade': data.cidade, '#addrUf': data.uf };
    for (const [sel, val] of Object.entries(map)) {
      const inp = dlg.querySelector(sel);
      if (inp) { inp.value = val || ''; inp.readOnly = !!val; }
    }
    const numInput = dlg.querySelector('#addrNumero');
    if (numInput) numInput.focus();
  } catch (_) {}
}

function ensureCheckoutButton(){
  const footer = document.querySelector(".cart__footer");
  if (!footer) return;

  const btnWhats = footer.querySelector("#btnWhats");
  if (btnWhats) btnWhats.style.display = "none";

  if (!footer.querySelector("#btnCheckout")) {
    const btn = document.createElement("button");
    btn.id = "btnCheckout";
    btn.className = "btn btn--primary";
    btn.textContent = "Ir para pagamento";
    btn.addEventListener("click", initiateCheckout);
    footer.insertBefore(btn, footer.firstChild);
  }
  updateCheckoutButtonState();
}

function updateCheckoutButtonState(){
  const btn = el("#btnCheckout");
  if (!btn) return;
  btn.disabled = carrinho.length === 0;
  btn.textContent = "Ir para pagamento";
}

function ensureCartClientSummary() {
  const cartEl = document.querySelector("#cart");
  const header = cartEl?.querySelector(".cart__header");
  if (!cartEl || !header) return;
  let box = cartEl.querySelector("#cartClientSummary");
  if (!currentClientSession?.nome) {
    if (box) box.style.display = "none";
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.id = "cartClientSummary";
    box.className = "cart__client";
    box.innerHTML = `<i class="fas fa-user-check" aria-hidden="true"></i><span>Cliente: <strong></strong></span>`;
    header.insertAdjacentElement("afterend", box);
  }
  const nameEl = box.querySelector("strong");
  if (nameEl) nameEl.textContent = currentClientSession.nome;
  box.style.display = "";
}

async function hydrateClientSession() {
  const result = await checkClientSession();
  currentClientSession = result.ok ? result.client : null;
  ensureCartClientSummary();
  renderCartDeliveryState();
  await autoLoadDeliveryFromClient();
  atualizarCart();
  // Enriquece CRM com endereço cadastrado do cliente logado
  if (currentClientSession && selectedDeliveryAddress?.cep) {
    const a = selectedDeliveryAddress;
    crmEnrichLocation({ cep: a.cep, logradouro: a.logradouro || '', bairro: a.bairro || '', cidade: a.cidade || '', source: 'client_address' });
  }
}

async function fetchClientAddresses() {
  try {
    const res = await fetch('/api/client/addresses', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.addresses) ? data.addresses : [];
  } catch (_) {
    return [];
  }
}

async function fetchClientOrders() {
  try {
    const res = await fetch('/api/client/orders', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.orders) ? data.orders : [];
  } catch (_) {
    return [];
  }
}

function formatAccountDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function renderAccountPanel({ client, addresses, orders }) {
  const safeClient = client || currentClientSession || {};
  const addressHtml = addresses.length ? addresses.map((addr) => `
    <div class="account__card" data-addr-id="${addr.id}">
      <div class="account__addr-view">
        <div>
          <strong>${escapeHTML(addr.logradouro || "")}, ${addr.numero ? escapeHTML(addr.numero) : '<span style="color:#e8445a">nº faltando</span>'}</strong>
          <div class="account__order-meta">
            ${addr.complemento ? `${escapeHTML(addr.complemento)}<br>` : ""}
            ${addr.bairro ? `${escapeHTML(addr.bairro)} · ` : ""}${escapeHTML(addr.cidade || "")}/${escapeHTML(addr.uf || "")}<br>
            CEP ${formatCEPForInput(addr.cep || "")}
          </div>
        </div>
        <button type="button" class="account__profile-action btn-edit-addr" data-addr-id="${addr.id}">Editar</button>
      </div>
      <form class="account__addr-edit-form" data-addr-id="${addr.id}" style="display:none;margin-top:12px;">
        <input type="hidden" name="cep" value="${escapeHTML(addr.cep || "")}">
        <div class="account__form-row">
          <label>Número *</label>
          <input class="account__input" name="numero" value="${escapeHTML(addr.numero || "")}" placeholder="123" required>
        </div>
        <div class="account__form-row">
          <label>Complemento</label>
          <input class="account__input" name="complemento" value="${escapeHTML(addr.complemento || "")}" placeholder="Apto 42">
        </div>
        <div class="account__form-row">
          <label>Logradouro *</label>
          <input class="account__input" name="logradouro" value="${escapeHTML(addr.logradouro || "")}" required>
        </div>
        <div class="account__form-row">
          <label>Bairro</label>
          <input class="account__input" name="bairro" value="${escapeHTML(addr.bairro || "")}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 80px;gap:8px">
          <div class="account__form-row">
            <label>Cidade *</label>
            <input class="account__input" name="cidade" value="${escapeHTML(addr.cidade || "")}" required>
          </div>
          <div class="account__form-row">
            <label>UF *</label>
            <input class="account__input" name="uf" value="${escapeHTML(addr.uf || "")}" maxlength="2" required style="text-transform:uppercase">
          </div>
        </div>
        <div class="account__status addr-edit-status" style="margin:6px 0;font-size:13px;color:#e8445a;"></div>
        <div class="account__form-actions">
          <button type="button" class="account__cancel btn-cancel-addr-edit" data-addr-id="${addr.id}">Cancelar</button>
          <button type="submit" class="account__save">Salvar</button>
        </div>
      </form>
    </div>
  `).join("") : `<div class="account__empty">Nenhum endereço cadastrado.</div>`;

	  const ordersHtml = orders.length ? orders.map((order) => {
	    const items = Array.isArray(order.itens) ? order.itens.slice(0, 4) : [];
	    const itemsHtml = items.length ? `<ul class="account__items">${items.map((item) => `
	      <li>${Number(item.quantity || 1)}x ${escapeHTML(item.item_name || "Item")} ${item.price ? `· ${formatBRL(Number(item.price))}` : ""}</li>
	    `).join("")}</ul>` : "";
	    const status = String(order.status || "").toLowerCase();
	    const cancelPending = order.cancellation_requested && String(order.cancellation_request_status || "pendente") !== "recusado";
	    const canRequestCancel = order.pedido && !cancelPending && status !== "cancelado" && status !== "entregue";
	    return `
	      <div class="account__order">
	        <div class="account__order-head">
	          <span>Pedido ${escapeHTML(order.pedido || "—")}</span>
	          <span>${formatBRL(Number(order.total || 0))}</span>
        </div>
        <div class="account__order-meta">
          Status: ${escapeHTML(order.status || "—")} · Data: ${formatAccountDate(order.createdAt)}
          ${order.frete_modo ? `<br>Frete: ${escapeHTML(getDeliveryModeLabel(order.frete_modo))}` : ""}
	        </div>
	        ${itemsHtml}
	        ${cancelPending ? `<div class="account__order-note">Solicitação de cancelamento enviada. A equipe vai analisar e confirmar o estorno.</div>` : ""}
	        ${canRequestCancel ? `
	          <div class="account__order-actions">
	            <button type="button" class="account__order-cancel" data-cancel-order="${escapeHTML(order.pedido)}">Solicitar cancelamento</button>
	          </div>
	        ` : ""}
	      </div>
	    `;
	  }).join("") : `<div class="account__empty">Você ainda não tem pedidos confirmados.</div>`;

  return `
    <div class="account__panel is-active" data-account-panel="dados">
      <div class="account__profile" id="accountProfileView" aria-label="Dados cadastrais">
        <div class="account__profile-row">
          <div class="account__profile-label">Nome</div>
          <div class="account__profile-value">${escapeHTML(safeClient.nome || "—")}</div>
          <button type="button" class="account__profile-action" data-account-edit>Editar</button>
        </div>
        <div class="account__profile-row">
          <div class="account__profile-label">E-mail</div>
          <div class="account__profile-value">${escapeHTML(safeClient.email || "—")}</div>
          <button type="button" class="account__profile-action" data-account-edit>Editar</button>
        </div>
        <div class="account__profile-row">
          <div class="account__profile-label">Telefone</div>
          <div class="account__profile-value">${escapeHTML(formatPhoneForInput(safeClient.telefone || "") || "—")}</div>
          <button type="button" class="account__profile-action" data-account-edit>Editar</button>
        </div>
        <div class="account__profile-row">
          <div class="account__profile-label">Código do cliente</div>
          <div class="account__profile-value">#${escapeHTML(safeClient.id || "—")}</div>
          <span></span>
        </div>
      </div>
      <div class="account__edit" id="accountProfileEdit">
        <form class="account__form" id="accountProfileForm">
          <div class="account__form-row">
            <label for="accountNome">Nome completo</label>
            <input class="account__input" id="accountNome" name="nome" autocomplete="name" value="${escapeHTML(safeClient.nome || "")}" required>
          </div>
          <div class="account__form-row">
            <label for="accountEmail">E-mail</label>
            <input class="account__input" id="accountEmail" name="email" type="email" autocomplete="email" value="${escapeHTML(safeClient.email || "")}" required>
          </div>
          <div class="account__form-row">
            <label for="accountTelefone">Telefone</label>
            <input class="account__input" id="accountTelefone" name="telefone" inputmode="tel" autocomplete="tel-national" value="${escapeHTML(formatPhoneForInput(safeClient.telefone || ""))}">
          </div>
          <div class="account__status" id="accountProfileStatus"></div>
          <div class="account__form-actions">
            <button type="button" class="account__cancel" id="btnCancelProfileEdit">Cancelar</button>
            <button type="submit" class="account__save" id="btnSaveProfile">Salvar alterações</button>
          </div>
        </form>
      </div>
      <p class="account__profile-note">Mantenha seus dados atualizados para evitar erros em pedidos, pagamento e entrega.</p>
      <div class="account__actions"><button type="button" class="account__logout" id="btnClientLogout">Sair da conta</button></div>
    </div>
    <div class="account__panel" data-account-panel="enderecos">
      <div class="account__list">${addressHtml}</div>
    </div>
    <div class="account__panel" data-account-panel="pedidos">
      <div class="account__list">${ordersHtml}</div>
    </div>
  `;
}

function bindAccountModal(dlg) {
  dlg.querySelector("#btnCloseAccount")?.addEventListener("click", () => dlg.close());
  dlg.querySelectorAll(".account__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.accountTab;
      dlg.querySelectorAll(".account__tab").forEach((btn) => btn.setAttribute("aria-selected", btn === tab ? "true" : "false"));
      dlg.querySelectorAll(".account__panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.accountPanel === target));
    });
  });
  dlg.querySelector("#btnClientLogout")?.addEventListener("click", async () => {
    try {
      await fetch('/api/client/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (_) {}
    currentClientSession = null;
    ensureCartClientSummary();
    dlg.close();
    showAppMessage("Você saiu da sua conta.");
  });
  const view = dlg.querySelector("#accountProfileView");
  const edit = dlg.querySelector("#accountProfileEdit");
  const form = dlg.querySelector("#accountProfileForm");
  const status = dlg.querySelector("#accountProfileStatus");
  const setEditMode = (enabled) => {
    if (view) view.style.display = enabled ? "none" : "";
    if (edit) edit.classList.toggle("is-active", enabled);
    if (enabled) dlg.querySelector("#accountNome")?.focus();
    if (status) status.textContent = "";
  };
  dlg.querySelectorAll("[data-account-edit]").forEach((btn) => {
    btn.addEventListener("click", () => setEditMode(true));
  });
  dlg.querySelector("#btnCancelProfileEdit")?.addEventListener("click", () => setEditMode(false));
  const phoneInput = dlg.querySelector("#accountTelefone");
  if (phoneInput && !phoneInput._lemoovMask) {
    phoneInput._lemoovMask = true;
    phoneInput.addEventListener("input", () => {
      phoneInput.value = formatPhoneForInput(phoneInput.value);
    });
  }
  dlg.querySelectorAll(".btn-edit-addr").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.addrId;
      const card = dlg.querySelector(`.account__card[data-addr-id="${id}"]`);
      if (!card) return;
      const editForm = card.querySelector(".account__addr-edit-form");
      const view     = card.querySelector(".account__addr-view");
      if (!editForm) return;
      const showing = editForm.style.display !== "none";
      editForm.style.display = showing ? "none" : "block";
      if (view) view.querySelector(".btn-edit-addr").textContent = showing ? "Editar" : "Cancelar";
      if (!showing) editForm.querySelector('[name="numero"]')?.focus();
    });
  });

	  dlg.querySelectorAll(".btn-cancel-addr-edit").forEach((btn) => {
	    btn.addEventListener("click", () => {
	      const id = btn.dataset.addrId;
	      const card = dlg.querySelector(`.account__card[data-addr-id="${id}"]`);
	      if (!card) return;
      card.querySelector(".account__addr-edit-form").style.display = "none";
      card.querySelector(".btn-edit-addr").textContent = "Editar";
	    });
	  });

	  dlg.querySelectorAll("[data-cancel-order]").forEach((btn) => {
	    btn.addEventListener("click", async () => {
	      const numero = btn.dataset.cancelOrder;
	      if (!numero) return;
	      const reason = await requestCancellationReason(numero);
	      if (reason === null) return;
	      btn.disabled = true;
	      btn.textContent = "Enviando...";
	      try {
	        const res = await fetch(`/api/client/orders/${encodeURIComponent(numero)}/cancel-request`, {
	          method: 'POST',
	          credentials: 'same-origin',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ reason })
	        });
	        const data = await res.json().catch(() => ({}));
	        if (!res.ok || !data.ok) {
	          alert(data.error || "Não foi possível solicitar o cancelamento.");
	          return;
	        }
	        const emailOk = Boolean(data.email?.store?.ok || data.email?.client?.ok);
	        showAppMessage(
	          emailOk
	            ? "Solicitação de cancelamento enviada."
	            : "Solicitação registrada, mas o e-mail não foi enviado. A loja já verá o pedido no admin."
	        );
	        const [addresses, orders] = await Promise.all([fetchClientAddresses(), fetchClientOrders()]);
	        const body = dlg.querySelector(".account__body");
	        if (body) body.innerHTML = renderAccountPanel({ client: currentClientSession, addresses, orders });
	        bindAccountModal(dlg);
	        dlg.querySelectorAll(".account__tab").forEach((tab) => tab.setAttribute("aria-selected", tab.dataset.accountTab === "pedidos" ? "true" : "false"));
	        dlg.querySelectorAll(".account__panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.accountPanel === "pedidos"));
	      } catch (_) {
	        alert("Erro de conexão. Tente novamente.");
	      } finally {
	        btn.disabled = false;
	        btn.textContent = "Solicitar cancelamento";
	      }
	    });
	  });

	  dlg.querySelectorAll(".account__addr-edit-form").forEach((editForm) => {
    if (editForm._lemoovBound) return;
    editForm._lemoovBound = true;
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = editForm.dataset.addrId;
      const statusEl = editForm.querySelector(".addr-edit-status");
      const saveBtn = editForm.querySelector('[type="submit"]');
      const payload = {
        cep:        editForm.querySelector('[name="cep"]')?.value || "",
        logradouro: editForm.querySelector('[name="logradouro"]')?.value.trim() || "",
        numero:     editForm.querySelector('[name="numero"]')?.value.trim() || "",
        complemento:editForm.querySelector('[name="complemento"]')?.value.trim() || "",
        bairro:     editForm.querySelector('[name="bairro"]')?.value.trim() || "",
        cidade:     editForm.querySelector('[name="cidade"]')?.value.trim() || "",
        uf:         editForm.querySelector('[name="uf"]')?.value.trim().toUpperCase() || "",
      };
      if (!payload.logradouro || !payload.numero || !payload.cidade || !payload.uf) {
        if (statusEl) statusEl.textContent = "Preencha os campos obrigatórios.";
        return;
      }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando..."; }
      if (statusEl) statusEl.textContent = "";
      try {
        const res = await fetch(`/api/client/addresses/${id}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (statusEl) statusEl.textContent = data.error || "Erro ao salvar.";
          return;
        }
        const [addresses, orders] = await Promise.all([fetchClientAddresses(), fetchClientOrders()]);
        const body = dlg.querySelector(".account__body");
        if (body) body.innerHTML = renderAccountPanel({ client: currentClientSession, addresses, orders });
        bindAccountModal(dlg);
      } catch (_) {
        if (statusEl) statusEl.textContent = "Erro de conexão.";
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salvar"; }
      }
    });
  });

  if (form && !form._lemoovBound) {
    form._lemoovBound = true;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = dlg.querySelector("#btnSaveProfile");
      const payload = {
        nome: dlg.querySelector("#accountNome")?.value.trim() || "",
        email: dlg.querySelector("#accountEmail")?.value.trim() || "",
        telefone: normalizePhone(dlg.querySelector("#accountTelefone")?.value || "")
      };
      if (!payload.nome || !payload.email) {
        if (status) status.textContent = "Preencha nome e e-mail.";
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
      if (status) status.textContent = "";
      try {
        const res = await fetch('/api/client/me', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (status) status.textContent = data.error || "Não foi possível salvar.";
          return;
        }
        currentClientSession = data.client;
        ensureCartClientSummary();
        const [addresses, orders] = await Promise.all([fetchClientAddresses(), fetchClientOrders()]);
        const body = dlg.querySelector(".account__body");
        if (body) body.innerHTML = renderAccountPanel({ client: currentClientSession, addresses, orders });
        bindAccountModal(dlg);
      } catch (_) {
        if (status) status.textContent = "Erro de conexão. Tente novamente.";
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Salvar alterações"; }
      }
    });
  }
}

async function openAccountModal() {
  if (!currentClientSession) {
    const session = await checkClientSession();
    if (!session.ok) {
      window.location.href = "cliente-login.html";
      return;
    }
    currentClientSession = session.client;
  }

  let dlg = document.getElementById("accountModal");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "accountModal";
    dlg.className = "account-modal";
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="account__header">
      <div>
        <div class="account__title">Minha conta</div>
        <div class="account__subtitle">Olá, ${escapeHTML((currentClientSession.nome || "").split(" ")[0] || "cliente")}</div>
      </div>
      <button type="button" class="account__close" id="btnCloseAccount" aria-label="Fechar">×</button>
    </div>
    <div class="account__tabs" role="tablist">
      <button type="button" class="account__tab" data-account-tab="dados" aria-selected="true">Dados</button>
      <button type="button" class="account__tab" data-account-tab="enderecos" aria-selected="false">Endereços</button>
      <button type="button" class="account__tab" data-account-tab="pedidos" aria-selected="false">Pedidos</button>
    </div>
    <div class="account__body"><div class="account__empty">Carregando dados da conta...</div></div>
  `;
  bindAccountModal(dlg);
  if (typeof dlg.showModal === "function" && !dlg.open) dlg.showModal();
  const [addresses, orders] = await Promise.all([fetchClientAddresses(), fetchClientOrders()]);
  const body = dlg.querySelector(".account__body");
  if (body) body.innerHTML = renderAccountPanel({ client: currentClientSession, addresses, orders });
  bindAccountModal(dlg);
}

function bindAccountLinks() {
  document.querySelectorAll('a[href*="cliente-login"]').forEach((link) => {
    if (link._lemoovAccountBound) return;
    link._lemoovAccountBound = true;
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!currentClientSession) {
        const session = await checkClientSession();
        if (!session.ok) {
          window.location.href = link.getAttribute("href") || "cliente-login.html";
          return;
        }
        currentClientSession = session.client;
      }
      openAccountModal();
    });
  });
}

let checkoutScrollPos = null;
function rememberCheckoutScroll(){
  checkoutScrollPos = window.scrollY || document.documentElement.scrollTop || 0;
}
function restoreCheckoutScroll(){
  if (checkoutScrollPos !== null) {
    window.scrollTo({ top: checkoutScrollPos, behavior: "auto" });
    checkoutScrollPos = null;
  }
}
function closeCheckoutModal(){
  const dlg = el("#checkoutModal");
  if (dlg) {
    if (typeof dlg.close === "function") dlg.close();
    dlg.removeAttribute("open");
    dlg.style.display = "none";
    dlg.setAttribute("aria-hidden","true");
  }
  restoreCheckoutScroll();
}

function _reopenCheckoutModalDisplay(){
  const dlg = el("#checkoutModal");
  if (dlg) dlg.style.display = "";
}

function atualizarCart(){
  _saveCart();
  try{ ensureFreteShownOnce(); }catch(e){}
  const cartEl = document.querySelector("#cart");
  if (cartEl) cartEl.dataset.cartAuth = currentClientSession ? "logged-in" : "logged-out";

  const cartCount = el("#cartCount");
  if (cartCount) cartCount.textContent = getCartCount();
  const list = el("#cartList");
  if (!list) return;
  ensureCartClientSummary();
  list.innerHTML = "";

  if (carrinho.length === 0) {
    list.innerHTML = `<li class="cart__empty-state" style="text-align:center; padding-top:40px; color:var(--text-muted);">
      Seu carrinho está vazio.
    </li>`;
  } else {
    carrinho.forEach((p, i) => {
      const nomeBits = [
        p.tipoSelecionado ? `Tipo: ${p.tipoSelecionado}` : null,
        p.corSelecionada ? `Cor: ${p.corSelecionada}` : null,
        p.tamanhoSelecionado ? `Tamanho: ${p.tamanhoSelecionado}` : null
      ].filter(Boolean).join(" | ");

      const descricaoLinha = p.descricaoCurta ? `<span class="cart__item-desc">${p.descricaoCurta}</span>` : "";
      const variacaoLinha = nomeBits ? `<span class="cart__item-details">${nomeBits}</span>` : "";
      const qty = getItemQty(p);
      const qtyLinha = `
        <div class="cart__qty-control" aria-label="Quantidade de ${p.nome}">
          <button class="cart__qty-btn" type="button" data-qty-dec="${i}" aria-label="Diminuir quantidade" ${qty <= 1 ? "disabled" : ""}>−</button>
          <span class="cart__qty-value" aria-live="polite">${qty}</span>
          <button class="cart__qty-btn" type="button" data-qty-inc="${i}" aria-label="Aumentar quantidade">+</button>
        </div>
      `;
      const lineTotal = getItemLineTotal(p);
      const li = document.createElement("li");
      li.className = "cart__item";
      li.innerHTML = `
        <div class="cart__item-media">
          <img src="${p.imagemSelecionada || ''}" alt="${p.nome}" loading="lazy" decoding="async">
        </div>
        <div class="cart__item-info">
          <span class="cart__item-name">${p.nome}</span>
          ${descricaoLinha}
          ${variacaoLinha}
          ${qtyLinha}
        </div>
        <div class="cart__item-actions">
          <strong class="cart__item-price">${formatBRL(lineTotal)}</strong>
          <button class="cart__remove-btn" data-del="${i}">Remover</button>
        </div>
      `;
      list.appendChild(li);
    });
  }

  ensureAddMoreButton();
  ensureFreteUI();
  ensureFreteSubtotalRows();
  ensureCartCouponUI();
  ensureCheckoutButton();
  renderCartDeliveryState();
  autoLoadDeliveryFromClient().catch(()=>{});

  const totalProdutos = getCartSubtotal();
  refreshDiscountAmountsForSubtotal();
  const descontoCarrinho = getCartDiscountTotal();
  const totalComFrete = Math.max(0, totalProdutos - descontoCarrinho) + (!retiradaNaLoja && entregaDisponivel ? (freteAtual || 0) : 0);

  const subtotalEl = el("#cartSubtotal");
  const freteEl = el("#cartFrete");
  if (subtotalEl) subtotalEl.textContent = formatBRL(totalProdutos);

  if (freteEl) {
    if (retiradaNaLoja) {
      freteEl.textContent = "Retirada";
    } else if (!entregaDisponivel) {
      freteEl.textContent = "Informe o CEP";
    } else if (freteModo === "uber_free") {
      freteEl.textContent = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
    } else if (["local_12","local_15","local_25"].includes(freteModo)) {
      freteEl.textContent = getDeliveryModeLabel(freteModo);
    } else if (freteAtual > 0) {
      // Melhor Envio ou Sedex — mostra transportadora + valor
      const opSel = freteOpcoesCache.find(o => o.modo === freteModo);
      if (opSel) {
        freteEl.textContent = `${opSel.servico} – ${formatBRL(freteAtual)}${opSel.prazo ? ` (${opSel.prazo})` : ''}`;
      } else {
        freteEl.textContent = getDeliveryModeLabel(freteModo) || formatBRL(freteAtual);
      }
    } else {
      freteEl.textContent = "Selecione a transportadora";
    }
  }
  renderCartDiscountSummary();

  const fixedFrete = isFixedFreteMode();
  const totalLabel = !retiradaNaLoja && entregaDisponivel
    ? (fixedFrete ? formatBRL(totalComFrete) : formatBRL(totalComFrete))
    : formatBRL(totalComFrete);
  el("#cartTotal").textContent = totalLabel;
  updateCheckoutButtonState();

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=> removerCarrinho(+btn.getAttribute("data-del")));
  });
  list.querySelectorAll("[data-qty-inc]").forEach(btn=>{
    btn.addEventListener("click", ()=> alterarQuantidadeCarrinho(+btn.getAttribute("data-qty-inc"), 1));
  });
  list.querySelectorAll("[data-qty-dec]").forEach(btn=>{
    btn.addEventListener("click", ()=> alterarQuantidadeCarrinho(+btn.getAttribute("data-qty-dec"), -1));
  });

  bindFreteUIEvents();
}

/* ------------------------------------------------------------
   Modal de Login/Cadastro Inline
------------------------------------------------------------ */
(function injectAuthModalStyles(){
  const css = `
  #authModal{ max-width:440px; width:calc(100vw - 24px); border:none; border-radius:20px; padding:0; overflow:hidden; box-shadow:0 28px 80px rgba(0,20,80,.22); }
  #authModal::backdrop{ background:rgba(0,20,50,.6); backdrop-filter:blur(6px); }
  .am-header{ background:linear-gradient(135deg,#009C3B 0%,#002776 100%); padding:20px 24px 16px; display:flex; align-items:center; justify-content:space-between; }
  .am-header h3{ color:#FFDF00; font-size:1rem; font-weight:800; margin:0; }
  .am-close{ width:34px;height:34px;border-radius:50%;background:rgba(255,223,0,.18);border:1px solid rgba(255,223,0,.35);color:#FFDF00;font-size:1rem;cursor:pointer;display:grid;place-items:center; }
  .am-tabs{ display:flex; border-bottom:2px solid #e8eef5; padding:0 24px; background:#fff; }
  .am-tab{ flex:1; padding:12px 8px; font:inherit; font-size:.82rem; font-weight:700; background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-2px; cursor:pointer; color:#5a6a80; transition:all .15s; }
  .am-tab.active{ color:#002776; border-bottom-color:#009C3B; }
  .am-panel{ display:none; padding:20px 24px 24px; background:#fff; max-height:70vh; overflow-y:auto; }
  .am-panel.active{ display:block; }
  .am-field{ margin-bottom:14px; }
  .am-label{ display:block; font-size:.74rem; font-weight:700; color:#56677c; text-transform:uppercase; letter-spacing:.05em; margin-bottom:5px; }
  .am-input{ width:100%; box-sizing:border-box; border:1.5px solid #dbe3ea; border-radius:10px; padding:10px 12px; font:inherit; font-size:.9rem; outline:none; transition:border-color .15s; }
  .am-input:focus{ border-color:#009C3B; }
  .am-input.err{ border-color:#e8445a; }
  .am-row{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .am-btn{ width:100%; padding:13px; border:none; border-radius:12px; font:inherit; font-size:.92rem; font-weight:800; color:#fff; background:linear-gradient(120deg,#009C3B,#002776); cursor:pointer; margin-top:6px; transition:filter .15s; }
  .am-btn:hover{ filter:brightness(1.08); }
  .am-btn:disabled{ opacity:.6;cursor:not-allowed; }
  .am-btn.ok{ background:linear-gradient(120deg,#087a4d,#003a8c); }
  .am-msg{ min-height:18px; font-size:.78rem; font-weight:700; margin-top:8px; text-align:center; }
  .am-msg.err{ color:#e8445a; }
  .am-msg.ok{ color:#087a4d; }
  .am-link{ font-size:.78rem; color:#002776; cursor:pointer; background:none; border:none; text-decoration:underline; font:inherit; }
  .am-divider{ border:none; border-top:1px solid #e8eef5; margin:14px 0; }
  .am-section-title{ font-size:.72rem; font-weight:800; color:#56677c; text-transform:uppercase; letter-spacing:.06em; margin:0 0 10px; }
  @media(max-width:440px){ #authModal{ border-radius:20px 20px 0 0; position:fixed; bottom:0; left:0; right:0; width:100%; max-width:100%; margin:0; } }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

function openLoginModal(onSuccess) {
  const existing = document.getElementById('authModal');
  if (existing) { existing.showModal(); return; }

  const dlg = document.createElement('dialog');
  dlg.id = 'authModal';
  dlg.innerHTML = `
    <div class="am-header">
      <h3>Identificação</h3>
      <button type="button" class="am-close" id="amClose">✕</button>
    </div>
    <div class="am-tabs">
      <button type="button" class="am-tab active" data-tab="login">Entrar</button>
      <button type="button" class="am-tab" data-tab="cadastro">Criar Conta</button>
    </div>

    <!-- LOGIN -->
    <div class="am-panel active" id="amPanelLogin">
      <div class="am-field">
        <label class="am-label">E-mail *</label>
        <input type="email" id="amLoginEmail" class="am-input" placeholder="seu@email.com" autocomplete="email">
      </div>
      <div class="am-field">
        <label class="am-label">Senha *</label>
        <input type="password" id="amLoginSenha" class="am-input" placeholder="Sua senha" autocomplete="current-password">
      </div>
      <button type="button" class="am-btn" id="amBtnLogin">Entrar</button>
      <div class="am-msg" id="amLoginMsg"></div>
    </div>

    <!-- CADASTRO -->
    <div class="am-panel" id="amPanelCadastro">
      <p class="am-section-title">Dados pessoais</p>
      <div class="am-field">
        <label class="am-label">Nome completo *</label>
        <input type="text" id="amRegNome" class="am-input" placeholder="Seu nome completo" autocomplete="name">
      </div>
      <div class="am-row">
        <div class="am-field">
          <label class="am-label">E-mail *</label>
          <input type="email" id="amRegEmail" class="am-input" placeholder="seu@email.com" autocomplete="email">
        </div>
        <div class="am-field">
          <label class="am-label">CPF *</label>
          <input type="text" id="amRegCpf" class="am-input" placeholder="000.000.000-00" inputmode="numeric" maxlength="14">
        </div>
      </div>
      <div class="am-row">
        <div class="am-field">
          <label class="am-label">Telefone *</label>
          <input type="text" id="amRegTel" class="am-input" placeholder="(85) 99999-0000" inputmode="tel">
        </div>
        <div class="am-field">
          <label class="am-label">Senha *</label>
          <input type="password" id="amRegSenha" class="am-input" placeholder="Mín. 8 caracteres" autocomplete="new-password">
        </div>
      </div>
      <hr class="am-divider">
      <p class="am-section-title">Endereço de entrega</p>
      <div class="am-row">
        <div class="am-field">
          <label class="am-label">CEP *</label>
          <input type="text" id="amRegCep" class="am-input" placeholder="00000-000" inputmode="numeric" maxlength="9">
        </div>
        <div class="am-field">
          <label class="am-label">Número *</label>
          <input type="text" id="amRegNumero" class="am-input" placeholder="123">
        </div>
      </div>
      <div class="am-field">
        <label class="am-label">Logradouro</label>
        <input type="text" id="amRegRua" class="am-input" placeholder="Rua das Flores" readonly>
      </div>
      <div class="am-row">
        <div class="am-field">
          <label class="am-label">Bairro</label>
          <input type="text" id="amRegBairro" class="am-input" placeholder="Bairro" readonly>
        </div>
        <div class="am-field">
          <label class="am-label">Cidade</label>
          <input type="text" id="amRegCidade" class="am-input" placeholder="Cidade" readonly>
        </div>
      </div>
      <input type="hidden" id="amRegUf">
      <button type="button" class="am-btn" id="amBtnCadastro">Criar conta</button>
      <div class="am-msg" id="amCadastroMsg"></div>
    </div>

    <!-- VERIFICAR EMAIL -->
    <div class="am-panel" id="amPanelVerify">
      <p style="font-size:.85rem;color:#374151;margin-bottom:14px;">Digite o código de 6 dígitos enviado para seu e-mail.</p>
      <div class="am-field">
        <input type="text" id="amVerifyCode" class="am-input" placeholder="000000" inputmode="numeric" maxlength="6" style="font-size:1.5rem;letter-spacing:10px;text-align:center;">
      </div>
      <button type="button" class="am-btn" id="amBtnVerify">Confirmar código</button>
      <div class="am-msg" id="amVerifyMsg"></div>
    </div>
  `;

  document.body.appendChild(dlg);

  let _amVerifyToken = null;
  let _amWelcomeCoupon = null;

  function amShowPanel(id) {
    dlg.querySelectorAll('.am-panel').forEach(p => p.classList.toggle('active', p.id === id));
    dlg.querySelectorAll('.am-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === (id === 'amPanelLogin' ? 'login' : 'cadastro')));
  }
  function amMsg(id, text, type = 'err') {
    const el = dlg.querySelector('#' + id);
    if (el) { el.textContent = text; el.className = 'am-msg ' + type; }
  }
  function amClear(id) { amMsg(id, ''); }

  // Tabs
  dlg.querySelectorAll('.am-tab').forEach(tab => {
    tab.addEventListener('click', () => amShowPanel(tab.dataset.tab === 'login' ? 'amPanelLogin' : 'amPanelCadastro'));
  });

  // Close
  dlg.querySelector('#amClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());

  // CPF mask
  const cpfInput = dlg.querySelector('#amRegCpf');
  if (cpfInput) cpfInput.addEventListener('input', () => { cpfInput.value = formatCpfForInput(cpfInput.value); });

  // Phone mask
  const telInput = dlg.querySelector('#amRegTel');
  if (telInput) telInput.addEventListener('input', () => { telInput.value = formatPhoneForInput(telInput.value); });

  // CEP autofill
  const cepIn = dlg.querySelector('#amRegCep');
  let _lastCep = '';
  if (cepIn) {
    cepIn.addEventListener('input', async function() {
      let v = this.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      this.value = v;
      const plain = v.replace('-', '');
      if (plain.length === 8 && plain !== _lastCep) {
        _lastCep = plain;
        try {
          const r = await fetch(`https://viacep.com.br/ws/${plain}/json/`);
          const d = await r.json();
          if (!d.erro) {
            dlg.querySelector('#amRegRua').value = d.logradouro || '';
            dlg.querySelector('#amRegBairro').value = d.bairro || '';
            dlg.querySelector('#amRegCidade').value = d.localidade || '';
            dlg.querySelector('#amRegUf').value = d.uf || '';
            dlg.querySelector('#amRegNumero').focus();
          }
        } catch(_){}
      }
    });
  }

  // LOGIN
  dlg.querySelector('#amBtnLogin').addEventListener('click', async () => {
    amClear('amLoginMsg');
    const email = dlg.querySelector('#amLoginEmail').value.trim();
    const senha = dlg.querySelector('#amLoginSenha').value;
    const btn = dlg.querySelector('#amBtnLogin');
    if (!email || !senha) { amMsg('amLoginMsg', 'Preencha e-mail e senha.'); return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { amMsg('amLoginMsg', data.error || 'E-mail ou senha incorretos.'); return; }
      currentClientSession = data.client;
      dlg.close();
      atualizarCart();
      if (typeof onSuccess === 'function') onSuccess();
    } catch(_) { amMsg('amLoginMsg', 'Erro de conexão. Tente novamente.'); }
    finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });

  // allow Enter key on login
  [dlg.querySelector('#amLoginEmail'), dlg.querySelector('#amLoginSenha')].forEach(inp => {
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') dlg.querySelector('#amBtnLogin').click(); });
  });

  // CADASTRO
  dlg.querySelector('#amBtnCadastro').addEventListener('click', async () => {
    amClear('amCadastroMsg');
    const nome = dlg.querySelector('#amRegNome').value.trim();
    const email = dlg.querySelector('#amRegEmail').value.trim();
    const cpf = dlg.querySelector('#amRegCpf').value.replace(/\D/g, '');
    const telefone = dlg.querySelector('#amRegTel').value.replace(/\D/g, '');
    const senha = dlg.querySelector('#amRegSenha').value;
    const cep = dlg.querySelector('#amRegCep').value.replace(/\D/g, '');
    const rua = dlg.querySelector('#amRegRua').value.trim();
    const bairro = dlg.querySelector('#amRegBairro').value.trim();
    const cidade = dlg.querySelector('#amRegCidade').value.trim();
    const uf = dlg.querySelector('#amRegUf').value.trim();
    const numero = dlg.querySelector('#amRegNumero').value.trim();
    const btn = dlg.querySelector('#amBtnCadastro');

    if (!nome) { amMsg('amCadastroMsg', 'Informe o nome completo.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { amMsg('amCadastroMsg', 'E-mail inválido.'); return; }
    if (cpf.length !== 11) { amMsg('amCadastroMsg', 'CPF inválido.'); return; }
    if (!senha || senha.length < 8) { amMsg('amCadastroMsg', 'Senha deve ter pelo menos 8 caracteres.'); return; }
    if (!cep || cep.length !== 8) { amMsg('amCadastroMsg', 'Informe o CEP de entrega.'); return; }
    if (!numero) { amMsg('amCadastroMsg', 'Informe o número do endereço.'); return; }

    btn.disabled = true; btn.textContent = 'Criando conta…';
    try {
      const res = await fetch('/api/client/register', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, cpf, telefone, senha, endereco: { cep, logradouro: rua, numero, bairro, cidade, uf } })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { amMsg('amCadastroMsg', data.error || 'Erro ao criar conta.'); return; }
      _amWelcomeCoupon = data.welcomeCoupon || null;
      if (data.needsVerification) {
        _amVerifyToken = data.verifyToken;
        amShowPanel('amPanelVerify');
        return;
      }
      currentClientSession = data.client;
      if (_amWelcomeCoupon) {
        amMsg('amCadastroMsg', `Conta criada! Cupom de 1ª compra: ${_amWelcomeCoupon}`, 'ok');
        await new Promise(r => setTimeout(r, 1800));
      }
      dlg.close();
      atualizarCart();
      if (typeof onSuccess === 'function') onSuccess();
    } catch(_) { amMsg('amCadastroMsg', 'Erro de conexão. Tente novamente.'); }
    finally { btn.disabled = false; btn.textContent = 'Criar conta'; }
  });

  // VERIFY
  dlg.querySelector('#amBtnVerify').addEventListener('click', async () => {
    amClear('amVerifyMsg');
    const code = dlg.querySelector('#amVerifyCode').value.trim();
    const btn = dlg.querySelector('#amBtnVerify');
    if (code.length !== 6) { amMsg('amVerifyMsg', 'Digite o código de 6 dígitos.'); return; }
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const res = await fetch('/api/client/verify-email', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyToken: _amVerifyToken, code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { amMsg('amVerifyMsg', data.error || 'Código inválido.'); return; }
      currentClientSession = data.client;
      if (_amWelcomeCoupon || data.welcomeCoupon) {
        const c = _amWelcomeCoupon || data.welcomeCoupon;
        amMsg('amVerifyMsg', `E-mail confirmado! Cupom de 1ª compra: ${c}`, 'ok');
        await new Promise(r => setTimeout(r, 1800));
      }
      dlg.close();
      atualizarCart();
      if (typeof onSuccess === 'function') onSuccess();
    } catch(_) { amMsg('amVerifyMsg', 'Erro de conexão. Tente novamente.'); }
    finally { btn.disabled = false; btn.textContent = 'Confirmar código'; }
  });

  dlg.showModal();
}

/* ------------------------------------------------------------
   Drawer carrinho (modal central)
------------------------------------------------------------ */
const cart = el("#cart");
const backdrop = el("#cartBackdrop");
let cartLastFocus = null;
function openCart(){
  if (!cart || !backdrop) return;
  cartLastFocus = document.activeElement;
  cart.classList.add("show");
  cart.setAttribute("aria-hidden","false");
  backdrop.classList.add("show");
  const closeBtn = el("#closeCart");
  if (closeBtn) closeBtn.focus();
}
function closeCart(){
  if (!cart || !backdrop) return;
  cart.classList.remove("show");
  cart.setAttribute("aria-hidden","true");
  backdrop.classList.remove("show");
  if (cartLastFocus) cartLastFocus.focus();
}
const openCartBtn = el("#openCart");
if (openCartBtn && cart) openCartBtn.onclick = openCart;
if (openCartBtn && !cart) {
  openCartBtn.disabled = true;
  openCartBtn.setAttribute("aria-disabled","true");
}
const openCartCta = el("#openCartCta");
if (openCartCta && cart) {
  openCartCta.addEventListener("click", (e) => {
    e.preventDefault();
    openCart();
  });
}
const closeCartBtn = el("#closeCart");
if (closeCartBtn && cart) closeCartBtn.addEventListener("click", closeCart);
// backdrop click intencional não fecha o carrinho — usa o botão fechar
document.addEventListener("keydown", (e)=> {
  if (e.key === "Escape") {
    const dlg = el("#checkoutModal");
    if (dlg && dlg.open) closeCheckoutModal();
    else if (cart && cart.classList.contains("show")) closeCart();
  }
});

/* ------------------------------------------------------------
   Sidebar filtros / Ordenação (se existirem)
------------------------------------------------------------ */
const filterModal = el('#filterModal');
const openFiltersBtn = el('#openFilters');
const closeFiltersBtn = el('#closeFilters');
if (openFiltersBtn && filterModal) openFiltersBtn.addEventListener('click', () => filterModal.showModal());
if (closeFiltersBtn && filterModal) closeFiltersBtn.addEventListener('click', () => filterModal.close());
const sortSelect = el('#sortSelect');
if (sortSelect) sortSelect.addEventListener('change', (e)=>{ ordenacaoAtual = e.target.value; renderGrid(); });
const catalogSearch = el("#catalogSearch");
const catalogSearchClear = el("#catalogSearchClear");
if (catalogSearch) {
  catalogSearch.addEventListener("input", (e) => {
    buscaAtual = e.target.value;
    renderGrid();
  });
}
if (catalogSearchClear) {
  catalogSearchClear.addEventListener("click", () => {
    buscaAtual = "";
    if (catalogSearch) {
      catalogSearch.value = "";
      catalogSearch.focus();
    }
    renderGrid();
  });
}

async function initCatalog(){
  const urlFilter = new URLSearchParams(window.location.search).get("filter");
  if (urlFilter) filtroAtual = urlFilter.trim();
  renderFiltros();
  const ok = await loadProdutos();
  renderGrid();
  if (!ok) {
    const grid = el("#grid");
    if (grid) {
      grid.innerHTML = `<div class="muted" style="padding:24px; text-align:center;">Não foi possível carregar os produtos. Atualize a página.</div>`;
    }
  }
}

/* ------------------------------------------------------------
   Boot
------------------------------------------------------------ */
if (!restorePaymentOriginIfNeeded()) {
  initCatalog().then(() => {
    const _qs = new URLSearchParams(location.search);
    const shouldResumeCheckout = _qs.get('initiateCheckout') === '1';
    if (shouldResumeCheckout) {
      history.replaceState(null, '', location.pathname);
      atualizarCart();
      openCart();
      setTimeout(() => initiateCheckout(), 250);
    } else if (_qs.get('p')) {
      // link direto do Instagram Shopping / Meta Catalog
      const prodId = _qs.get('p');
      history.replaceState(null, '', location.pathname);
      abrirModal(String(prodId));
    }
  });
}
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();
atualizarCart();
_scheduleCartExpiry();
const toggleWhats = el("#toggleWhats");
if (toggleWhats) {
  toggleWhats.addEventListener("click", ()=>{
    const waUrl = `https://wa.me/${WHATS_NUMBER}`;
    window.open(waUrl, "_blank", "noopener");
  });
}

/* ------------------------------------------------------------
   Hero vídeo (shrink on scroll) + largura variável do vídeo
------------------------------------------------------------ */
(function initHeroVideoShrink(){
  const root = document.documentElement;
  const section = document.querySelector('.hero--video');
  const video = document.getElementById('heroVideo');
  if (!section || !video) return;

  const minScale = 0.58;
  const roundAtEnd = true;
  let ticking = false;

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function onScroll(){
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(()=>{
      const rect = section.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const progress = clamp((0 - rect.top) / viewportH, 0, 1);
      const scale = 1 - (1 - minScale) * progress;
      root.style.setProperty('--video-scale', scale.toFixed(3));
      const radius = roundAtEnd ? Math.round(16 * progress) : 0;
      root.style.setProperty('--video-radius', radius + 'px');
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
})();

// Mantém uma CSS var com a largura visível do vídeo para alinhar o carrossel
(function syncGridToHeroWidth(){
  const root = document.documentElement;
  const video = document.getElementById('heroVideo');

  function apply(){
    const vw = video?.getBoundingClientRect?.().width || 0;
    const w = Math.max(320, Math.min(1200, Math.round(vw)));
    root.style.setProperty('--hero-w', w > 0 ? `${w}px` : '100%');
  }

  window.addEventListener('resize', apply);
  if (video) {
    if (video.readyState >= 1) apply();
    video.addEventListener('loadedmetadata', apply);
  }
  apply();
})();

/* ------------------------------------------------------------
   FRETE/CEP helpers
------------------------------------------------------------ */
function normalizeCEP(cep) {
  return (cep || "").toString().replace(/\D/g, "").slice(0, 8);
}
function formatCEPForInput(value){
  const digits = normalizeCEP(value);
  if (digits.length > 5) {
    return `${digits.slice(0,5)}-${digits.slice(5)}`;
  }
  return digits;
}
function normalizePhone(value){
  return (value || "").toString().replace(/\D/g, "").slice(0, 11);
}
function formatPhoneForInput(value){
  const digits = normalizePhone(value);
  if (!digits) return "";
  const ddd = digits.slice(0, 2);
  const first = digits.slice(2, digits.length > 10 ? 7 : 6);
  const last = digits.slice(digits.length > 10 ? 7 : 6);
  if (!first) return ddd.length === 2 ? `(${ddd})` : `(${ddd}`;
  if (!last) return `(${ddd}) ${first}`;
  return `(${ddd}) ${first}-${last}`;
}
function normalizeCpf(value) {
  return (value || "").toString().replace(/\D/g, "").slice(0, 11);
}
function formatCpfForInput(value) {
  const digits = normalizeCpf(value);
  if (digits.length > 9) return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
  if (digits.length > 6) return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
  if (digits.length > 3) return `${digits.slice(0,3)}.${digits.slice(3)}`;
  return digits;
}
async function validateCheckoutDiscounts({ cpf = "", cupom = "", subtotal = getCartSubtotal() } = {}) {
  const cleanCpf = normalizeCpf(cpf);
  const code = String(cupom || "").trim().toUpperCase();
  const payload = { cpf: cleanCpf, cupom: code, subtotal };
  const res = await fetch(`${API_BASE}/api/descontos/validar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new Error(data?.error || "Não foi possível validar o desconto.");
  checkoutDiscountState = {
    cpf: cleanCpf,
    cupom: data.couponCode || code,
    discounts: Array.isArray(data.discounts) ? data.discounts : [],
    discountTotal: Number(data.discountTotal) || 0
  };
  return checkoutDiscountState;
}
function renderCheckoutTotals() {
  const subtotal = getCartSubtotal();
  const frete = !retiradaNaLoja && entregaDisponivel ? (freteAtual || 0) : 0;
  const discount = Math.min(subtotal, Number(checkoutDiscountState.discountTotal) || 0);
  const total = Math.max(0, subtotal - discount) + frete;
  const subtotalEl = el("#ckSubtotal");
  const freteEl = el("#ckFrete");
  const discountRow = el("#ckDiscountRow");
  const discountEl = el("#ckDiscount");
  const totalEl = el("#ckTotal");
  if (subtotalEl) subtotalEl.textContent = formatBRL(subtotal);
  if (freteEl) freteEl.textContent = getFreteResumoLabel();
  if (discountRow && discountEl) {
    discountRow.style.display = discount > 0 ? "" : "none";
    const labels = (checkoutDiscountState.discounts || []).map((d) => d.code || d.label).filter(Boolean).join(" + ");
    discountEl.textContent = discount > 0 ? `-${formatBRL(discount)}${labels ? ` (${labels})` : ""}` : "—";
  }
  if (totalEl) {
    let totalLabel = formatBRL(total);
    if (!retiradaNaLoja && entregaDisponivel && !isFixedFreteMode()) {
      totalLabel = `${formatBRL(total)} + frete`;
    }
    totalEl.textContent = totalLabel;
  }
}
function getCartDiscountTotal() {
  return Math.min(getCartSubtotal(), Number(checkoutDiscountState.discountTotal) || 0);
}
function refreshDiscountAmountsForSubtotal() {
  const subtotal = getCartSubtotal();
  const discounts = Array.isArray(checkoutDiscountState.discounts) ? checkoutDiscountState.discounts : [];
  if (!discounts.length) return;
  const recalculated = discounts.map((item) => {
    const percent = Number(item.percent) || 0;
    if (percent > 0) return { ...item, amount: Math.round(subtotal * (percent / 100) * 100) / 100 };
    return item;
  });
  checkoutDiscountState = {
    ...checkoutDiscountState,
    discounts: recalculated,
    discountTotal: Math.min(subtotal, Math.round(recalculated.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) * 100) / 100)
  };
}
function renderCartDiscountSummary() {
  const discountRow = el("#cartDiscountRow");
  const discountEl = el("#cartDiscount");
  const msg = el("#cartCouponMsg");
  const discount = getCartDiscountTotal();
  if (discountRow && discountEl) {
    discountRow.style.display = discount > 0 ? "" : "none";
    discountEl.textContent = discount > 0 ? `-${formatBRL(discount)}` : "R$ 0,00";
  }
  if (msg && checkoutDiscountState.cupom) {
    msg.textContent = discount > 0 ? `Cupom ${checkoutDiscountState.cupom} aplicado.` : "";
    msg.dataset.status = discount > 0 ? "ok" : "info";
  }
}
async function applyCartCoupon() {
  const input = el("#cartCouponInput");
  const msg = el("#cartCouponMsg");
  const btn = el("#btnApplyCartCoupon");
  const code = String(input?.value || "").trim().toUpperCase();
  cartCouponCode = code;
  if (!code) {
    checkoutDiscountState = { ...checkoutDiscountState, cupom: "", discounts: [], discountTotal: 0 };
    renderCartDiscountSummary();
    atualizarCart();
    if (msg) { msg.textContent = "Informe um cupom para aplicar."; msg.dataset.status = "warn"; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Aplicando..."; }
    const state = await validateCheckoutDiscounts({ cpf: checkoutDiscountState.cpf || "", cupom: code, subtotal: getCartSubtotal() });
    cartCouponCode = state.cupom || code;
    if (input) input.value = cartCouponCode;
    renderCartDiscountSummary();
    atualizarCart();
  } catch (err) {
    checkoutDiscountState = { ...checkoutDiscountState, cupom: "", discounts: [], discountTotal: 0 };
    renderCartDiscountSummary();
    if (msg) { msg.textContent = err.message || "Cupom inválido."; msg.dataset.status = "warn"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Aplicar"; }
  }
}
function computeOrderNumber({ commit } = { commit: false }) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}${mm}${dd}`;
  let seq = 1;
  const data = orderSeqFallback.date === dateKey ? orderSeqFallback : null;
  if (data && typeof data.seq === "number") seq = data.seq + 1;
  if (commit) {
    orderSeqFallback = { date: dateKey, seq };
  }
  return `${dateKey}${seq}`;
}
const peekNextOrderNumber = () => computeOrderNumber({ commit: false });
const getNextOrderNumber = () => computeOrderNumber({ commit: true });

async function fetchJSON(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}
function withTimeout(promise, timeoutMs, fallback = null) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
function isCurrentFreteCepRequest(seq, cep) {
  const currentCep = normalizeCEP(el("#cepInput")?.value || cepAtual || "");
  return seq === freteCepRequestSeq && currentCep === normalizeCEP(cep);
}
function setFreteLoading(isLoading, message = "") {
  freteCepLoading = Boolean(isLoading);
  const wrap = document.querySelector(".frete__ui");
  const msg = el("#freteMsg");
  const btnUseLocation = el("#btnUseLocation");
  if (wrap) wrap.dataset.loading = freteCepLoading ? "true" : "false";
  if (msg && message) msg.textContent = message;
  if (btnUseLocation) btnUseLocation.disabled = freteCepLoading || retiradaNaLoja;
}
function cancelPendingFreteCep(message = "") {
  freteCepRequestSeq += 1;
  if (freteCepDebounceTimer) {
    clearTimeout(freteCepDebounceTimer);
    freteCepDebounceTimer = null;
  }
  setFreteLoading(false, message);
}
function scheduleFreteCepCalculation(cepRaw, delay = 450) {
  const cep = normalizeCEP(cepRaw);
  if (freteCepDebounceTimer) clearTimeout(freteCepDebounceTimer);
  const seq = ++freteCepRequestSeq;
  setFreteLoading(false, "Preparando consulta do CEP...");
  freteCepDebounceTimer = setTimeout(() => {
    freteCepDebounceTimer = null;
    calcularEntregaPorCEP(cep, { seq }).catch(() => {
      if (isCurrentFreteCepRequest(seq, cep)) {
        resetFreteUI("Não foi possível consultar o CEP agora. Verifique sua conexão e tente novamente.");
      }
    });
  }, delay);
}
const UF_NAME_TO_SIGLA = {
  "acre": "AC",
  "alagoas": "AL",
  "amapá": "AP",
  "amapa": "AP",
  "amazonas": "AM",
  "bahia": "BA",
  "ceará": "CE",
  "ceara": "CE",
  "distrito federal": "DF",
  "espírito santo": "ES",
  "espirito santo": "ES",
  "goiás": "GO",
  "goias": "GO",
  "maranhão": "MA",
  "maranhao": "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  "pará": "PA",
  "para": "PA",
  "paraíba": "PB",
  "paraiba": "PB",
  "paraná": "PR",
  "parana": "PR",
  "pernambuco": "PE",
  "piauí": "PI",
  "piaui": "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  "rondônia": "RO",
  "rondonia": "RO",
  "roraima": "RR",
  "santa catarina": "SC",
  "são paulo": "SP",
  "sao paulo": "SP",
  "sergipe": "SE",
  "tocantins": "TO"
};
function resolveUF(value){
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const key = trimmed.toLowerCase();
  return UF_NAME_TO_SIGLA[key] || "";
}
async function reverseGeocodeAddress(lat, lng){
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");
    const data = await fetchJSON(url.toString(), { headers: { "Accept-Language": "pt-BR" } }, 10000);
    const addr = data?.address;
    if (!addr) return null;
    const cep = normalizeCEP(addr.postcode || "");
    const cidade = addr.city || addr.town || addr.village || addr.municipality || addr.state_district || "";
    const uf = resolveUF(addr.state_code || addr.state);
    return { cep, cidade, uf };
  } catch {
    return null;
  }
}
// Endereço pelo CEP (auto-preencher no checkout)
async function brasilApiGetAddress(cep) {
  try {
    const data = await fetchJSON(`https://brasilapi.com.br/api/cep/v1/${cep}`, {}, 10000);
    if (data?.city && data?.state) {
      return {
        cep: normalizeCEP(cep),
        rua: data.street || "",
        bairro: data.neighborhood || "",
        cidade: data.city || "",
        uf: data.state || ""
      };
    }
    return null;
  } catch { return null; }
}
async function viaCepGetAddress(cep) {
  try {
    const data = await fetchJSON(`https://viacep.com.br/ws/${cep}/json/`, {}, 10000);
    if (!data?.erro) {
      return {
        cep: normalizeCEP(cep),
        rua: data.logradouro || "",
        bairro: data.bairro || "",
        cidade: data.localidade || "",
        uf: data.uf || ""
      };
    }
    return null;
  } catch { return null; }
}
async function getAddressByCEP(cep) {
  cep = normalizeCEP(cep);
  if (!cep || cep.length !== 8) return null;
  return (await brasilApiGetAddress(cep)) || (await viaCepGetAddress(cep));
}

async function brasilApiGetCoords(cep) {
  try {
    const data = await fetchJSON(`https://brasilapi.com.br/api/cep/v2/${cep}`, { headers: { "Accept": "application/json" } }, 10000);
    const lat = data?.location?.coordinates?.latitude;
    const lng = data?.location?.coordinates?.longitude;
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng, city: data?.city, state: data?.state };
    }
    return { lat: null, lng: null, city: data?.city, state: data?.state };
  } catch (_e) {
    return null;
  }
}

async function awesomeApiGetCoords(cep) {
  try {
    const data = await fetchJSON(`https://cep.awesomeapi.com.br/json/${cep}`, { headers: { "Accept": "application/json" } }, 10000);
    const lat = parseFloat(data?.lat);
    const lng = parseFloat(data?.lng);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng, city: data?.city, state: data?.state };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

async function geocodeByCEP(cep) {
  cep = normalizeCEP(cep);
  if (!cep || cep.length !== 8) return null;
  const br = await brasilApiGetCoords(cep);
  if (br && typeof br.lat === "number" && typeof br.lng === "number") return br;
  const aw = await awesomeApiGetCoords(cep);
  if (aw && typeof aw.lat === "number" && typeof aw.lng === "number") return aw;
  return br || null;
}

async function getOriginCoords() {
  if (originCoordsCache) return originCoordsCache;
  const coords = await geocodeByCEP(ORIGIN_CEP);
  originCoordsCache = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? coords : ORIGIN_COORDS;
  return originCoordsCache;
}

function resetFreteUI(message = "Informe o CEP para calcular a entrega.") {
  setFreteLoading(false);
  freteAtual = 0;
  cepAtual = "";
  entregaDisponivel = false;
  enderecoAutofill = null;
  freteModo = null;
  esconderOpcoesTransportadora();
  const freteMsg = el("#freteMsg");
  if (freteMsg) freteMsg.textContent = message;
  const form = el("#freteNumeroForm");
  if (form) { form.style.display = "none"; }
  atualizarCart();
}

async function setPickupMode(enabled, { recalculateDelivery = false } = {}) {
  retiradaNaLoja = Boolean(enabled);
  const cepInput = el("#cepInput");
  const freteMsg = el("#freteMsg");
  if (retiradaNaLoja) {
    freteAtual = 0;
    cepAtual = "";
    entregaDisponivel = false;
    enderecoAutofill = null;
    freteOpcoesCache = [];
    freteModo = "retirada";
    esconderOpcoesTransportadora();
    if (cepInput) cepInput.value = "";
    const _nf = el("#freteNumeroForm"); if (_nf) _nf.style.display = "none";
  } else {
    freteAtual = 0;
    cepAtual = "";
    entregaDisponivel = false;
    enderecoAutofill = null;
    freteOpcoesCache = [];
    freteModo = null;
    esconderOpcoesTransportadora();
    if (freteMsg) freteMsg.textContent = selectedDeliveryAddress
      ? "Calculando frete pelo endereço selecionado..."
      : "Selecione um endereço de entrega para calcular o frete.";
    if (recalculateDelivery && selectedDeliveryAddress?.cep) {
      const backendOk = await calcularFreteBackend(selectedDeliveryAddress);
      if (!backendOk) {
        try { await calcularEntregaPorCEP(selectedDeliveryAddress.cep); } catch (_) {}
      }
    }
  }
  applyPickupUIState();
  renderCartDeliveryState();
  atualizarCart();
}

function setDeliveryAddress(addr) {
  selectedDeliveryAddress = addr || null;
  if (selectedDeliveryAddress) {
    retiradaNaLoja = false;
    freteAtual = 0;
    cepAtual = "";
    entregaDisponivel = false;
    freteModo = null;
    enderecoAutofill = {
      cep: normalizeCEP(selectedDeliveryAddress.cep || ""),
      rua: selectedDeliveryAddress.logradouro || "",
      bairro: selectedDeliveryAddress.bairro || "",
      cidade: selectedDeliveryAddress.cidade || "",
      uf: selectedDeliveryAddress.uf || ""
    };
    esconderOpcoesTransportadora();
  }
  applyPickupUIState();
  renderCartDeliveryState();
}

function applyPickupUIState() {
  const pickupToggle = el("#pickupToggle");
  const cepInput = el("#cepInput");
  const btnUseLocation = el("#btnUseLocation");
  const freteMsg = el("#freteMsg");
  if (pickupToggle) pickupToggle.checked = retiradaNaLoja;
  if (cepInput) cepInput.disabled = retiradaNaLoja;
  if (btnUseLocation) btnUseLocation.disabled = retiradaNaLoja;
  if (retiradaNaLoja && freteMsg) {
    freteMsg.textContent = "Retirada selecionada. O frete não será calculado.";
  }
}

async function calcularEntregaPorCEP(cepRaw, options = {}) {
  const cep = normalizeCEP(cepRaw);
  const requestSeq = Number(options.seq) || ++freteCepRequestSeq;
  const freteMsg = el("#freteMsg");
  if (!cep || cep.length !== 8) {
    resetFreteUI("CEP inválido. Digite 8 números.");
    return;
  }
  setFreteLoading(true, "Verificando entrega...");
  cepAtual = cep;
  freteAtual = 0;
  entregaDisponivel = false;
  esconderOpcoesTransportadora();

  const lookup = await withTimeout(Promise.all([
    getAddressByCEP(cep),
    geocodeByCEP(cep),
    getOriginCoords()
  ]), 12000, null);
  if (!isCurrentFreteCepRequest(requestSeq, cep)) return;
  if (!lookup) {
    resetFreteUI("Consulta demorou demais. Verifique sua conexão e tente novamente.");
    return;
  }
  const [addr, coords, origin] = lookup;
  enderecoAutofill = addr || null;
  const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  const city = addr?.cidade || coords?.city;
  const uf = addr?.uf || coords?.state;
  if (!addr && !hasCoords && (!city || !uf)) {
    resetFreteUI("CEP não encontrado. Verifique e tente novamente.");
    return;
  }
  // Enriquece CRM com CEP completo + rua digitados pelo usuário
  crmEnrichLocation({ cep, logradouro: addr?.rua || '', bairro: addr?.bairro || '', cidade: city || '', lat: hasCoords ? coords.lat : null, lng: hasCoords ? coords.lng : null, source: 'cart_input' });

  if (hasCoords && origin) {
    const km = haversineKm(origin.lat, origin.lng, coords.lat, coords.lng);
    if (km <= DELIVERY_FREE_RADIUS_KM) {
      freteModo = "uber_free";
      freteAtual = 0;
      entregaDisponivel = true;
      if (freteMsg) freteMsg.textContent = `Entrega grátis (até ${DELIVERY_FREE_RADIUS_KM} km da loja).`;
      setFreteLoading(false);
      atualizarCart();
      return;
    }
  }

  const localPrice = getLocalDeliveryPrice(city, uf);
  if (localPrice === DELIVERY_FORTALEZA_CAUCAIA_PRICE) {
    freteModo = "local_12";
    freteAtual = DELIVERY_FORTALEZA_CAUCAIA_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em ${city || "Fortaleza/Caucaia"} — R$ ${DELIVERY_FORTALEZA_CAUCAIA_PRICE},00.`;
    entregaDisponivel = true;
    setFreteLoading(false);
    atualizarCart();
    return;
  }
  if (localPrice === DELIVERY_MARACANAU_PRICE) {
    freteModo = "local_15";
    freteAtual = DELIVERY_MARACANAU_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em Maracanaú — R$ ${DELIVERY_MARACANAU_PRICE},00.`;
    entregaDisponivel = true;
    setFreteLoading(false);
    atualizarCart();
    return;
  }
  if (localPrice === DELIVERY_EUSEBIO_PRICE) {
    freteModo = "local_25";
    freteAtual = DELIVERY_EUSEBIO_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em ${city} — R$ ${DELIVERY_EUSEBIO_PRICE},00.`;
    entregaDisponivel = true;
    setFreteLoading(false);
    atualizarCart();
    return;
  }

  // Fora da RMF → múltiplas opções via Melhor Envio
  setFreteLoading(true, "Consultando opções de frete...");
  esconderOpcoesTransportadora();
  const freteOk = await calcularFreteBackend({ cidade: city || '', cep }, { seq: requestSeq, cep });
  if (!isCurrentFreteCepRequest(requestSeq, cep)) return;
  if (!freteOk) {
    freteModo = "whatsapp";
    freteAtual = 0;
    if (freteMsg) freteMsg.textContent = "Não foi possível calcular o frete. Consulte via WhatsApp.";
    setFreteLoading(false);
    atualizarCart();
  } else {
    if (freteMsg) freteMsg.textContent = freteOpcoesCache.length > 1 ? "Escolha a transportadora:" : "";
    setFreteLoading(false);
    showFreteNumeroForm(cep);
  }
}

function showFreteNumeroForm(cep) {
  const form = el("#freteNumeroForm");
  if (!form) return;
  const preview = el("#freteEnderecoPreview");
  const addr = enderecoAutofill;

  // Verifica se o CEP digitado é diferente do endereço salvo do cliente
  const savedCep = (selectedDeliveryAddress?.cep || "").replace(/\D/g, "");
  const typedCep  = (cep || "").replace(/\D/g, "");
  const isSameCep = savedCep && savedCep === typedCep;

  if (isSameCep && selectedDeliveryAddress?.numero) {
    // CEP igual ao endereço já cadastrado — mantém e não pede número novamente
    form.style.display = "none";
    return;
  }

  const logInput  = el("#freteLogradouroInput");
  const numInput  = el("#freteNumeroInput");
  const compInput = el("#freteComplementoInput");

  // Pré-preenche logradouro do CEP (se disponível) ou do endereço salvo
  const ruaDoCep = (addr?.rua || addr?.logradouro || "").trim();
  if (logInput) {
    logInput.value = ruaDoCep || (isSameCep ? selectedDeliveryAddress?.logradouro || "" : "");
    logInput.readOnly = Boolean(ruaDoCep); // Apenas leitura se a API retornou
    logInput.style.background = ruaDoCep ? "#f5f8fc" : "";
    logInput.placeholder = ruaDoCep ? "Logradouro preenchido pelo CEP" : "Logradouro (Rua, Av…) *";
  }

  if (preview && addr) {
    const line = [ruaDoCep || "—", addr.bairro, addr.cidade + (addr.uf ? "/" + addr.uf : "")].filter(Boolean).join(", ");
    preview.textContent = line;
  }

  // Pré-preenche número/complemento se o endereço salvo tiver o mesmo CEP
  if (numInput  && !numInput.value  && isSameCep) numInput.value  = selectedDeliveryAddress?.numero  || "";
  if (compInput && !compInput.value && isSameCep) compInput.value = selectedDeliveryAddress?.complemento || "";

  form.style.display = "";
  if (!form._lemoovBound) {
    form._lemoovBound = true;
    form._lastCep = "";
    const confirmar = el("#btnConfirmarNumero");
    const confirmAddr = async () => {
      const logradouro = (el("#freteLogradouroInput")?.value || "").trim();
      const numero     = (el("#freteNumeroInput")?.value    || "").trim();
      if (!logradouro) {
        el("#freteLogradouroInput")?.classList.add("err");
        el("#freteLogradouroInput")?.focus();
        return;
      }
      if (!numero) { el("#freteNumeroInput")?.focus(); return; }
      el("#freteLogradouroInput")?.classList.remove("err");
      const complemento = (el("#freteComplementoInput")?.value || "").trim();
      const a = enderecoAutofill || {};
      const novoAddr = {
        cep:        (a.cep || cepAtual || "").replace(/\D/g, ""),
        logradouro,
        numero,
        complemento,
        bairro:     a.bairro || "",
        cidade:     a.cidade || "",
        uf:         a.uf || ""
      };

      if (confirmar) { confirmar.disabled = true; confirmar.textContent = "Salvando…"; }

      // Salva no cadastro do cliente se estiver logado
      if (currentClientSession) {
        try {
          const res = await fetch('/api/client/addresses', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novoAddr)
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.id) novoAddr.id = data.id;
        } catch (_) {}
      }

      selectedDeliveryAddress = novoAddr;
      form.style.display = "none";
      if (confirmar) { confirmar.disabled = false; confirmar.textContent = "Confirmar endereço"; }
      renderCartDeliveryState();
      atualizarCart();
    };
    if (confirmar) confirmar.addEventListener("click", confirmAddr);
    el("#freteLogradouroInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); el("#freteNumeroInput")?.focus(); } });
    el("#freteNumeroInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); el("#freteComplementoInput")?.focus(); } });
    el("#freteComplementoInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); confirmAddr(); } });
  }
}

/* ------------------------------------------------------------
   Binds da UI de Frete (CEP/GPS)
------------------------------------------------------------ */
function bindFreteUIEvents() {
  const cepInput = el("#cepInput");
  const freteMsg = el("#freteMsg");
  const btnUseLocation = el("#btnUseLocation");
  const pickupToggle = el("#pickupToggle");

  if (pickupToggle && !pickupToggle._lemoovBound) {
    pickupToggle._lemoovBound = true;
    pickupToggle.checked = retiradaNaLoja;
    pickupToggle.addEventListener("change", async () => {
      await setPickupMode(pickupToggle.checked, { recalculateDelivery: !pickupToggle.checked });
    });
  }
  applyPickupUIState();

  if (cepInput && !cepInput._lemoovBound) {
    cepInput._lemoovBound = true;
    cepInput.addEventListener("input", () => {
      if (retiradaNaLoja) return;
      cepInput.value = normalizeCEP(cepInput.value);
      if (cepInput.value.length === 0) {
        cancelPendingFreteCep();
        resetFreteUI();
      } else if (cepInput.value.length < 8) {
        cancelPendingFreteCep();
        if (freteMsg) freteMsg.textContent = "CEP inválido. Digite 8 números.";
        freteAtual = 0;
        entregaDisponivel = false;
        cepAtual = "";
        esconderOpcoesTransportadora();
        atualizarCart();
      } else if (cepInput.value.length === 8) {
        scheduleFreteCepCalculation(cepInput.value);
      }
    });
    cepInput.addEventListener("blur", () => {
      if (retiradaNaLoja) return;
      const cep = normalizeCEP(cepInput.value);
      if (cep.length === 8 && !freteCepLoading && (!entregaDisponivel || cep !== cepAtual)) {
        scheduleFreteCepCalculation(cep, 0);
      }
    });
  }
  if (btnUseLocation && !btnUseLocation._lemoovBound) {
    btnUseLocation._lemoovBound = true;
    btnUseLocation.addEventListener("click", () => {
      if (retiradaNaLoja) return;
      if (!navigator.geolocation) {
        if (freteMsg) freteMsg.textContent = "Seu navegador não suporta localização. Digite o CEP.";
        return;
      }
      if (freteMsg) freteMsg.textContent = "Obtendo localização…";
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords;
          const addr = await reverseGeocodeAddress(latitude, longitude);
          if (!addr?.cep || addr.cep.length !== 8) {
            if (freteMsg) freteMsg.textContent = "Não conseguimos identificar seu CEP. Digite manualmente.";
            return;
          }
          // Enriquece CRM com coordenadas GPS (precisão em metros disponível)
          crmEnrichLocation({ cep: addr.cep, logradouro: addr.rua || '', bairro: addr.bairro || '', cidade: addr.cidade || '', lat: latitude, lng: longitude, source: `gps_${Math.round(accuracy)}m` });
          if (cepInput) cepInput.value = formatCEPForInput(addr.cep);
          await calcularEntregaPorCEP(addr.cep);
        } catch (_e) {
          if (freteMsg) freteMsg.textContent = "Não foi possível obter o CEP pela localização.";
        }
      }, () => {
        if (freteMsg) freteMsg.textContent = "Permissão negada. Digite o CEP.";
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }
}

/* ------------------------------------------------------------
   CHECKOUT (WhatsApp) + limpa carrinho após enviar
------------------------------------------------------------ */
function openCheckoutModal(){
  if (carrinho.length === 0) { showAppMessage("Seu carrinho está vazio."); return; }
  if (!validateWholeCartStock()) return;
  const cepInput = el("#cepInput");
  const cepValue = normalizeCEP(cepInput?.value || cepAtual || "");
  if (!retiradaNaLoja && (!cepValue || cepValue.length !== 8)) {
    showAppMessage("Informe o CEP para calcular a entrega.");
    return;
  }
  if (!retiradaNaLoja && (!entregaDisponivel || !isFixedFreteMode())) {
    showAppMessage("Não foi possível fechar o valor do frete para este endereço. Consulte a Lemoov pelo WhatsApp antes de pagar.");
    return;
  }

  let dlg = el("#checkoutModal");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "checkoutModal";
    dlg.className = "checkout-modal";
    dlg.innerHTML = `
      <div class="checkout__header">
        <div>
          <div class="checkout__title">Finalizar Pedido</div>
          <p class="checkout__muted checkout__subtitle">
            Seus dados pessoais e de pagamento são coletados com segurança pela InfinitePay.
          </p>
        </div>
        <button type="button" class="btn btn--ghost" id="btnCloseCheckout">Fechar</button>
      </div>
      <form id="checkoutForm" novalidate>
        <div class="checkout__body">
          <div class="checkout__summary">
            <strong>Resumo do pedido</strong>
            <p class="checkout__muted" style="margin:4px 0 0;">
              Revise antes de gerar o pagamento. O estoque só é baixado quando o pagamento for confirmado.
            </p>
            <div id="checkoutItems" class="checkout__muted" style="margin-top:6px;"></div>
              <div class="checkout__totals">
                <div>Pedido <strong id="ckPedido">—</strong></div>
                <div>Produtos <strong id="ckSubtotal">—</strong></div>
                <div id="ckDiscountRow" style="display:none;">Desconto <strong id="ckDiscount">—</strong></div>
                <div>Frete <strong id="ckFrete">—</strong></div>
                <div>Total <strong id="ckTotal">—</strong></div>
              </div>
            <div class="checkout__note" id="checkoutFreteNote"></div>
          </div>

          <div class="checkout__right">
          <div id="ckAddrBanner" class="checkout__addr-banner" style="display:none;">
            <div class="checkout__addr-banner-info">
              <div class="checkout__addr-banner-label">Entregar em</div>
              <div class="checkout__addr-banner-text" id="ckAddrBannerText">—</div>
            </div>
            <button type="button" class="checkout__addr-banner-btn" id="btnChangeAddr">Alterar</button>
          </div>

          <div id="ckFreteOpcoes" style="display:none;margin-bottom:12px;">
            <div style="font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#556b7d;margin-bottom:6px;">Transportadora</div>
            <div id="ckFreteOpcoesLista" class="frete__opcoes"></div>
          </div>

          <div class="checkout__grid">
            <div class="checkout__step">
              <div class="full">
                <strong>1. Seus dados</strong>
                <p class="checkout__muted" style="margin:4px 0 0;">
                  Usados para identificar seu pedido e pré-preencher o checkout.
                </p>
              </div>
              <div class="full">
                <label class="checkout__label">Nome completo *</label>
                <input required name="nome" class="checkout__input" autocomplete="name"
                  placeholder="Ex.: Carla Souza">
              </div>
              <div>
                <label class="checkout__label">Telefone (WhatsApp)</label>
                <input name="telefone" class="checkout__input" inputmode="tel" autocomplete="tel-national"
                  placeholder="Ex.: (85) 99999-0000">
              </div>
              <div>
                <label class="checkout__label">E-mail</label>
                <input type="email" name="email" class="checkout__input" autocomplete="email"
                  placeholder="seuemail@exemplo.com">
              </div>
              <div class="full">
                <label class="checkout__label">CPF *</label>
                <input required name="cpf" class="checkout__input" inputmode="numeric" autocomplete="off"
                  placeholder="000.000.000-00">
              </div>
              <div class="full">
                <label class="checkout__label">Cupom de desconto</label>
                <div class="checkout__row checkout__row--stack">
                  <input name="cupom" class="checkout__input" id="ckCupom"
                    placeholder="Digite seu cupom">
                  <button type="button" class="btn btn--ghost checkout__cepBtn" id="btnApplyDiscount">Aplicar desconto</button>
                </div>
                <p class="checkout__status" id="checkoutDiscountMsg" data-status="info">Primeira compra vinculada ao CPF recebe o desconto ativo no cadastro de cupons.</p>
              </div>
              <div class="full">
                <label class="checkout__label">CEP (opcional)</label>
                <div class="checkout__row checkout__row--stack">
                  <input name="cep" class="checkout__input" id="ckCep"
                    placeholder="00000-000" inputmode="numeric" autocomplete="postal-code">
                  <button type="button" class="btn btn--ghost checkout__cepBtn" id="btnLocateCep">Usar CEP do cálculo</button>
                </div>
                <p class="checkout__status" id="checkoutCepMsg" data-status="info">CEP ajuda a confirmar a entrega.</p>
              </div>
            </div>

            <div class="checkout__step">
              <div class="full">
                <strong>2. Pagamento via InfinitePay</strong>
                <p class="checkout__muted" style="margin:4px 0 0;">
                  Você será redirecionado para o ambiente seguro da InfinitePay. Endereço e dados do cartão são preenchidos lá.
                </p>
              </div>
              <input type="hidden" name="pagamento" value="online" />
              <div class="full checkout__note">
                Seus dados já chegam pré-preenchidos na InfinitePay. PIX, cartão e parcelamento são escolhidos lá.
              </div>
            </div>
          </div>
          </div><!-- /.checkout__right -->
        </div>

        <div class="checkout__footer">
          <button type="button" class="btn btn--ghost" id="btnCancelarCheckout">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btnEnviarPedido">Ir para pagamento</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);

    dlg.querySelector("#btnCloseCheckout").addEventListener("click", closeCheckoutModal);
    dlg.querySelector("#btnCancelarCheckout").addEventListener("click", closeCheckoutModal);

    const ckCep = dlg.querySelector("#ckCep");
    const cepMsg = dlg.querySelector("#checkoutCepMsg");
    const setCepStatus = (text, status = "info") => {
      if (!cepMsg) return;
      cepMsg.textContent = text;
      cepMsg.dataset.status = status;
    };
    const handleCepInput = () => {
      const raw = normalizeCEP(ckCep.value);
      ckCep.value = formatCEPForInput(raw);
      if (raw.length === 8) setCepStatus("CEP ok.", "ok");
      else if (raw) setCepStatus("CEP incompleto.", "warn");
    };
    if (ckCep) {
      ckCep.addEventListener("input", handleCepInput);
      ckCep.addEventListener("blur", handleCepInput);
      const locateCepBtn = dlg.querySelector("#btnLocateCep");
      if (locateCepBtn) {
        locateCepBtn.disabled = !((enderecoAutofill?.cep && enderecoAutofill.cep.length === 8) || (cepAtual && cepAtual.length === 8));
        locateCepBtn.addEventListener("click", () => {
          const cepToUse = (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8)
            ? enderecoAutofill.cep
            : (cepAtual && cepAtual.length === 8 ? cepAtual : "");
          if (!cepToUse) { showAppMessage("Calcule o frete ou informe o CEP manualmente."); return; }
          ckCep.value = formatCEPForInput(cepToUse);
          handleCepInput();
        });
      }
      handleCepInput();
    }

    const telefoneInput = dlg.querySelector('input[name="telefone"]');
    if (telefoneInput && !telefoneInput._lemoovMask) {
      telefoneInput._lemoovMask = true;
      telefoneInput.addEventListener("input", () => {
        telefoneInput.value = formatPhoneForInput(telefoneInput.value);
      });
    }
    const cpfInput = dlg.querySelector('input[name="cpf"]');
    if (cpfInput && !cpfInput._lemoovMask) {
      cpfInput._lemoovMask = true;
      cpfInput.addEventListener("input", () => {
        cpfInput.value = formatCpfForInput(cpfInput.value);
      });
    }
    const applyDiscountBtn = dlg.querySelector("#btnApplyDiscount");
    if (applyDiscountBtn && !applyDiscountBtn._lemoovClick) {
      applyDiscountBtn._lemoovClick = true;
      applyDiscountBtn.addEventListener("click", async () => {
        const msg = dlg.querySelector("#checkoutDiscountMsg");
        try {
          applyDiscountBtn.disabled = true;
          applyDiscountBtn.textContent = "Validando...";
          await validateCheckoutDiscounts({
            cpf: dlg.querySelector('input[name="cpf"]')?.value || "",
            cupom: dlg.querySelector('input[name="cupom"]')?.value || "",
            subtotal: getCartSubtotal()
          });
          renderCheckoutTotals();
          if (msg) {
            const count = checkoutDiscountState.discounts.length;
            msg.textContent = count ? "Desconto aplicado ao pedido." : "Nenhum desconto disponível para este CPF/cupom.";
            msg.dataset.status = count ? "ok" : "info";
          }
        } catch (err) {
          checkoutDiscountState = { cpf: "", cupom: "", discounts: [], discountTotal: 0 };
          renderCheckoutTotals();
          if (msg) { msg.textContent = err.message; msg.dataset.status = "warn"; }
        } finally {
          applyDiscountBtn.disabled = false;
          applyDiscountBtn.textContent = "Aplicar desconto";
        }
      });
    }

    dlg.querySelector("#checkoutForm").addEventListener("submit", handleSubmitCheckout);

    const btnChangeAddr = dlg.querySelector("#btnChangeAddr");
    if (btnChangeAddr) {
      btnChangeAddr.addEventListener("click", async () => {
        closeCheckoutModal();
        let addrs = [];
        try {
          const r = await fetch('/api/client/addresses', { credentials: 'same-origin' });
          if (r.ok) { const d = await r.json(); addrs = d.addresses || []; }
        } catch (_) {}
        openAddressSelectionModal(addrs);
      });
    }
  }

  // Address banner
  const addrBanner = el("#ckAddrBanner");
  const addrBannerText = el("#ckAddrBannerText");
  if (addrBanner && addrBannerText) {
    if (selectedDeliveryAddress && !retiradaNaLoja) {
      const addr = selectedDeliveryAddress;
      const line1 = `${addr.logradouro}, ${addr.numero}${addr.complemento ? ' – ' + addr.complemento : ''}`;
      const line2 = `${addr.bairro ? addr.bairro + ', ' : ''}${addr.cidade} – ${addr.uf}`;
      addrBannerText.textContent = `${line1} · ${line2}`;
      addrBanner.style.display = '';
    } else {
      addrBanner.style.display = 'none';
    }
  }

  // Carrier selection inside checkout
  const ckFreteOpcoes = el("#ckFreteOpcoes");
  const ckFreteOpcoesLista = el("#ckFreteOpcoesLista");
  if (ckFreteOpcoes && ckFreteOpcoesLista && freteOpcoesCache.length > 1 && !retiradaNaLoja) {
    ckFreteOpcoesLista.innerHTML = freteOpcoesCache.map((op, i) => {
      const sel = op.modo === freteModo || (i === 0 && !freteOpcoesCache.find(o => o.modo === freteModo));
      return `<label class="frete__opcao${sel ? ' selected' : ''}" data-modo="${op.modo}" data-valor="${op.valor}">
        <input type="radio" name="ckFreteOpcao" value="${i}" ${sel ? 'checked' : ''}>
        ${op.logo ? `<img class="frete__opcao-logo" src="${op.logo}" alt="${op.empresa || op.servico}">` : ''}
        <div class="frete__opcao-info">
          <span class="frete__opcao-nome">${op.servico}</span>
          ${op.empresa ? `<span class="frete__opcao-empresa">${op.empresa}</span>` : ''}
          ${op.prazo ? `<span class="frete__opcao-prazo">${op.prazo}</span>` : ''}
        </div>
        <span class="frete__opcao-preco">R$ ${op.valor.toFixed(2).replace('.', ',')}</span>
      </label>`;
    }).join('');
    ckFreteOpcoes.style.display = '';
    ckFreteOpcoesLista.querySelectorAll('.frete__opcao').forEach((lbl) => {
      lbl.addEventListener('click', () => {
        ckFreteOpcoesLista.querySelectorAll('.frete__opcao').forEach(l => l.classList.remove('selected'));
        lbl.classList.add('selected');
        freteAtual = parseFloat(lbl.dataset.valor);
        freteModo  = lbl.dataset.modo;
        // também sincroniza no widget do catálogo
        const catalogLista = el('#freteOpcoes');
        if (catalogLista) catalogLista.querySelectorAll('.frete__opcao').forEach((cl) => {
          cl.classList.toggle('selected', cl.dataset.modo === freteModo);
          const r = cl.querySelector('input[type="radio"]');
          if (r) r.checked = cl.dataset.modo === freteModo;
        });
        atualizarCart();
      });
    });
  } else if (ckFreteOpcoes) {
    ckFreteOpcoes.style.display = 'none';
  }

  // Pre-fill client data from session
  if (currentClientSession) {
    const nomeInput     = dlg.querySelector('input[name="nome"]');
    const emailInput    = dlg.querySelector('input[name="email"]');
    const telefoneInput = dlg.querySelector('input[name="telefone"]');
    const cpfInputCk    = dlg.querySelector('input[name="cpf"]');
    const ckCepInput    = dlg.querySelector('#ckCep');
    if (nomeInput    && !nomeInput.value)    nomeInput.value    = currentClientSession.nome     || '';
    if (emailInput   && !emailInput.value)   emailInput.value   = currentClientSession.email    || '';
    if (cpfInputCk   && !cpfInputCk.value && currentClientSession.cpf) {
      cpfInputCk.value = formatCpfForInput(currentClientSession.cpf);
    }
    if (telefoneInput && !telefoneInput.value && currentClientSession.telefone) {
      telefoneInput.value = formatPhoneForInput(currentClientSession.telefone);
    }
    if (ckCepInput && !ckCepInput.value && selectedDeliveryAddress?.cep) {
      ckCepInput.value = formatCEPForInput(selectedDeliveryAddress.cep);
    }
  }

  const previewOrder = peekNextOrderNumber();
  const pedidoEl = el("#ckPedido");
  if (pedidoEl) pedidoEl.textContent = previewOrder || "—";

  const ckCupomInput = dlg.querySelector("#ckCupom");
  const initialCupom = cartCouponCode || checkoutDiscountState.cupom || "";
  checkoutDiscountState = { ...checkoutDiscountState, cpf: checkoutDiscountState.cpf || "", cupom: initialCupom };
  if (ckCupomInput) ckCupomInput.value = initialCupom;

  if (currentClientSession && ckCupomInput && !ckCupomInput.value) {
    fetchClientOrders().then(orders => {
      if (orders.length === 0 && ckCupomInput && !ckCupomInput.value) {
        const cpfVal = dlg.querySelector('input[name="cpf"]')?.value || '';
        if (cpfVal.replace(/\D/g,'').length === 11) {
          validateCheckoutDiscounts({ cpf: cpfVal, cupom: '', subtotal: getCartSubtotal() })
            .then((state) => {
              const firstPurchaseDiscount = (state.discounts || []).find(d => d.type === 'first_purchase');
              if (firstPurchaseDiscount?.code && ckCupomInput) ckCupomInput.value = firstPurchaseDiscount.code;
              renderCheckoutTotals();
            })
            .catch(() => {});
        }
        const discMsg = dlg.querySelector('#checkoutDiscountMsg');
        if (discMsg) discMsg.textContent = 'Desconto de primeira compra aplicado automaticamente.';
      }
    }).catch(() => {});
  }

  // Preencher resumo
  const itemsDiv = el("#checkoutItems");
  const subtotal = getCartSubtotal();
  itemsDiv.innerHTML = carrinho.map((p,i)=>{
    const qty = getItemQty(p);
    const lineTotal = getItemLineTotal(p);
    const det = [
      p.nome,
      p.tipoSelecionado ? `(Tipo: ${p.tipoSelecionado})` : "",
      p.corSelecionada ? `(Cor: ${p.corSelecionada})` : "",
      p.tamanhoSelecionado ? `(Tam: ${p.tamanhoSelecionado})` : ""
    ].filter(Boolean).join(" ");
    return `${i+1}. ${qty}x ${det} — ${formatBRL(lineTotal)}`;
  }).join("<br>");

  renderCheckoutTotals();
  const freteVia = el("#ckFreteVia");
  if (freteVia) freteVia.textContent = "";
  const freteNote = el("#checkoutFreteNote");
  if (freteNote) {
    if (retiradaNaLoja) {
      freteNote.textContent = "Você marcou retirada e se compromete a buscar o pedido.";
      freteNote.style.display = "";
    } else if (!isFixedFreteMode()) {
      freteNote.textContent = "Frete sem valor fechado. Consulte pelo WhatsApp antes de pagar.";
      freteNote.style.display = "";
    } else {
      freteNote.textContent = "";
      freteNote.style.display = "none";
    }
  }

  // Repassa CEP/endereço já calculado
  const ckCep = el("#ckCep");
  const applyCheckoutAddress = (addr) => {
    if (!addr) return;
    const rua = el("#ckRua");
    const bairro = el("#ckBairro");
    const cidade = el("#ckCidade");
    const uf = el("#ckUF");
    if (rua) rua.value = addr.rua || "";
    if (bairro) bairro.value = addr.bairro || "";
    if (cidade) cidade.value = addr.cidade || "";
    if (uf) uf.value = addr.uf || "";
  };
  const cepParaUsar = !retiradaNaLoja && (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8)
    ? enderecoAutofill.cep
    : (!retiradaNaLoja && cepAtual && cepAtual.length === 8 ? cepAtual : "");
  if (ckCep && cepParaUsar) {
    ckCep.value = formatCEPForInput(cepParaUsar);
    ckCep.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (enderecoAutofill) {
    applyCheckoutAddress(enderecoAutofill);
  } else if (cepAtual && cepAtual.length === 8) {
    (async ()=>{
      const addr = await getAddressByCEP(cepAtual);
      if (addr) {
        enderecoAutofill = addr;
        applyCheckoutAddress(addr);
      }
    })();
  }
  const locateBtnGlobal = el("#btnLocateCep");
  if (locateBtnGlobal) {
    const hasCep = !retiradaNaLoja && Boolean(
      (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8) ||
      (cepAtual && cepAtual.length === 8)
    );
    locateBtnGlobal.disabled = !hasCep;
  }

  const checkoutItemsPayload = buildCartItems();
  const checkoutValue = Math.max(0, subtotal - getCartDiscountTotal()) + (!retiradaNaLoja && entregaDisponivel ? (freteAtual || 0) : 0);
  trackEvent("start_checkout", {
    currency: "BRL",
    value: checkoutValue,
    items: checkoutItemsPayload,
    item_count: getCartCount()
  });
  crmTrack('checkout_start');
  rememberCheckoutScroll();
  _reopenCheckoutModalDisplay();
  dlg.showModal();
}

// Monta a mensagem do WhatsApp
function buildWhatsMessage(data, options = {}) {
  const { cliente, endereco, pagamento } = data;
  const numeroPedido = options.numeroPedido || ultimoNumeroPedido || null;

  const itemsMap = new Map();
  for (const p of carrinho){
    const key = [p.nome, p.tipoSelecionado||"", p.corSelecionada||"", p.tamanhoSelecionado||""].join("|");
    const qty = getItemQty(p);
    const curr = itemsMap.get(key) || {
      qtd: 0,
      nome: p.nome,
      tipo: p.tipoSelecionado,
      cor: p.corSelecionada,
      tam: p.tamanhoSelecionado,
      precoUnit: p.preco
    };
    curr.qtd += qty;
    itemsMap.set(key, curr);
  }
  const itensArr = Array.from(itemsMap.values()).map((obj,i)=>{
    const det = [
      obj.nome,
      obj.tipo ? `Tipo: ${obj.tipo}` : "",
      obj.cor ? `Cor: ${obj.cor}` : "",
      obj.tam ? `Tam: ${obj.tam}` : ""
    ].filter(Boolean).join(" | ");
    return `${i+1}) ${obj.qtd}× ${det} — ${formatBRL(obj.precoUnit)}`;
  });

  const subtotal = getCartSubtotal();
  const total = subtotal + (!retiradaNaLoja && entregaDisponivel ? (freteAtual||0) : 0);
  const linhas = [];
  linhas.push("📝 *Pedido Lemoov*");
  if (numeroPedido) linhas.push(`Pedido nº ${numeroPedido}`);
  linhas.push(`Cliente: ${cliente.nome || "-"}`);
  if (cliente.nascimento) linhas.push(`Nascimento: ${cliente.nascimento}`);
  if (cliente.telefone) linhas.push(`Telefone: ${cliente.telefone}`);
  if (cliente.email) linhas.push(`E-mail: ${cliente.email}`);

  linhas.push("");
  linhas.push(retiradaNaLoja ? "*Retirada*" : "*Endereço*");
  if (retiradaNaLoja) {
    linhas.push("Cliente marcou retirada e se compromete a buscar o pedido.");
  } else {
    linhas.push(`Rua: ${endereco.rua || "-"}, ${endereco.numero || "-"}`);
    if (endereco.complemento) linhas.push(`Compl.: ${endereco.complemento}`);
    linhas.push(`Cidade/UF: ${endereco.cidade || "-"} / ${endereco.uf || "-"}`);
    if (endereco.cep) linhas.push(`CEP: ${formatCEPForInput(endereco.cep)}`);
  }

  linhas.push("");
  linhas.push("*Pagamento*");
  const pagamentoTxt = pagamento === "pix" ? "PIX" : "Cartão";
  linhas.push(`Forma: ${pagamentoTxt}`);

  linhas.push("");
  linhas.push("*Itens*");
  if (itensArr.length) linhas.push(...itensArr);
  else linhas.push("Nenhum item no carrinho.");

  linhas.push("");
  linhas.push("*Resumo*");
  linhas.push(`Produtos: ${formatBRL(subtotal)}`);
  linhas.push(`Frete: ${getFreteResumoLabel({ includeCep: true })}`);
  const totalLabel = !retiradaNaLoja && entregaDisponivel
    ? (isFixedFreteMode() ? formatBRL(total) : `${formatBRL(total)} + frete`)
    : formatBRL(total);
  linhas.push(`Total: ${totalLabel}`);

  linhas.push("");
  linhas.push("Responda confirmando para darmos sequência. 😊");

  return linhas.join("\n");
}

// Envio p/ WhatsApp (nova aba) + limpa carrinho
function openWhatsAppWithMessage(message) {
  const waUrl = `https://wa.me/${WHATS_NUMBER}?text=${encodeURIComponent(message)}`;
  const w = window.open(waUrl, "_blank", "noopener");
  if (!w) {
    const a = document.createElement("a");
    a.href = waUrl;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function showPaymentTransition(){
  const existing = document.getElementById("payment-transition");
  if (existing) { existing.style.display = "flex"; return; }
  // Posições das estrelas da bandeira do Brasil
  const starPositions = [
    [12,18,0],[22,72,.17],[38,8,.34],[55,85,.51],[68,14,.68],
    [80,60,.85],[90,30,1.02],[6,50,1.19],[45,42,1.36],[75,78,1.53],
    [30,92,1.7],[60,5,1.87],[15,65,2.04],[85,45,2.21],[50,22,2.38],
    [35,35,.9],[65,55,1.1],[25,55,.6],[70,30,.4],[48,70,1.6]
  ];
  const stars = starPositions.map(([l,t,d]) =>
    `<span style="left:${l}%;top:${t}%;animation-delay:${d}s">★</span>`
  ).join("");
  const div = document.createElement("div");
  div.id = "payment-transition";
  div.innerHTML = `
    <div class="pt-stars">${stars}</div>
    <div class="pt-diamond"></div>
    <div class="pt-circle">
      <div class="pt-ordem">ORDEM E PROGRESSO</div>
      <div class="pt-lock">🔒</div>
      <div class="pt-bar-wrap"><div class="pt-bar"></div></div>
    </div>
    <div class="pt-msg">Redirecionando para pagamento seguro…</div>
  `;
  document.body.appendChild(div);
}

function showAppMessage(message, options = {}) {
  const title = options.title || "Atenção";
  let dlg = document.getElementById("appMessageDialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "appMessageDialog";
    dlg.className = "app-message-dialog";
    dlg.innerHTML = `
      <div class="app-message__body">
        <div class="app-message__mark">!</div>
        <h3 class="app-message__title"></h3>
        <p class="app-message__text"></p>
      </div>
      <div class="app-message__actions">
        <button type="button" class="app-message__ok">OK</button>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector(".app-message__ok").addEventListener("click", () => dlg.close());
  }
  dlg.querySelector(".app-message__title").textContent = title;
  dlg.querySelector(".app-message__text").textContent = message || "Não foi possível concluir a ação.";
  if (typeof dlg.showModal === "function") {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute("open", "");
  }
}

function requestCancellationReason(orderNumber) {
  return new Promise((resolve) => {
    let dlg = document.getElementById("cancelRequestDialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "cancelRequestDialog";
      dlg.className = "cancel-request-dialog";
      dlg.innerHTML = `
        <div class="cancel-request__header">
          <div>
            <h3 class="cancel-request__title">Solicitar cancelamento</h3>
            <p class="cancel-request__subtitle">Informe o motivo para a equipe analisar o pedido.</p>
          </div>
          <button type="button" class="cancel-request__close" aria-label="Fechar">×</button>
        </div>
        <div class="cancel-request__body">
          <label class="cancel-request__label" for="cancelRequestReason">Motivo do cancelamento</label>
          <textarea class="cancel-request__textarea" id="cancelRequestReason" maxlength="500" placeholder="Ex.: comprei por engano, quero trocar o tamanho, desisti da compra..."></textarea>
          <div class="cancel-request__status" aria-live="polite"></div>
        </div>
        <div class="cancel-request__actions">
          <button type="button" class="cancel-request__secondary">Fechar</button>
          <button type="button" class="cancel-request__primary">Enviar solicitação</button>
        </div>
      `;
      document.body.appendChild(dlg);
      dlg.addEventListener("cancel", (event) => event.preventDefault());
      dlg.addEventListener("click", (event) => {
        if (event.target === dlg) event.preventDefault();
      });
    }

    const textarea = dlg.querySelector("#cancelRequestReason");
    const status = dlg.querySelector(".cancel-request__status");
    const title = dlg.querySelector(".cancel-request__title");
    const primary = dlg.querySelector(".cancel-request__primary");
    const closeButtons = dlg.querySelectorAll(".cancel-request__close, .cancel-request__secondary");

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeButtons.forEach((btn) => btn.removeEventListener("click", onClose));
      primary.removeEventListener("click", onSubmit);
      dlg.close();
      resolve(value);
    };
    const onClose = () => finish(null);
    const onSubmit = () => {
      const reason = textarea.value.trim();
      if (!reason) {
        status.textContent = "Informe o motivo do cancelamento.";
        textarea.focus();
        return;
      }
      finish(reason);
    };

    if (title) title.textContent = orderNumber ? `Cancelar pedido ${orderNumber}` : "Solicitar cancelamento";
    if (textarea) textarea.value = "";
    if (status) status.textContent = "";
    closeButtons.forEach((btn) => btn.addEventListener("click", onClose));
    primary.addEventListener("click", onSubmit);

    if (typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
    setTimeout(() => textarea?.focus(), 30);
  });
}

async function createInfinityPayment(payload){
  const res = await fetch(`${API_BASE}/api/pagamentos/infinitypay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.error || "Não foi possível gerar o pagamento.");
    err.paymentData = data;
    throw err;
  }
  return data;
}

async function handleSubmitCheckout(ev){
  ev.preventDefault();
  if (!validateWholeCartStock()) return;
  const form = ev.currentTarget;
  const btn = el("#btnEnviarPedido");
  const subtotalCompra = getCartSubtotal();
  const taxaFrete = !retiradaNaLoja && entregaDisponivel ? (freteAtual || 0) : 0;
  const purchaseItems = buildCartItems();
  if (btn) {
    btn.disabled = true; btn.textContent = "Gerando pagamento...";
  }

  try {
    const fdUI = new FormData(form);
    const cliente = {
      nome: (fdUI.get("nome") || currentClientSession?.nome || "").toString().trim(),
      telefone: formatPhoneForInput((fdUI.get("telefone") || "").toString()),
      email: (fdUI.get("email") || currentClientSession?.email || "").toString().trim(),
      cpf: normalizeCpf((fdUI.get("cpf") || "").toString()),
    };
    const _sda = selectedDeliveryAddress;
    const endereco = {
      cep:         retiradaNaLoja ? "" : (_sda?.cep || normalizeCEP((fdUI.get("cep") || "").toString())),
      rua:         retiradaNaLoja ? "" : (_sda?.logradouro || enderecoAutofill?.rua    || ""),
      numero:      retiradaNaLoja ? "" : (_sda?.numero || ""),
      complemento: retiradaNaLoja ? "" : (_sda?.complemento || ""),
      bairro:      retiradaNaLoja ? "" : (_sda?.bairro || enderecoAutofill?.bairro || ""),
      cidade:      retiradaNaLoja ? "" : (_sda?.cidade || enderecoAutofill?.cidade || ""),
      uf:          retiradaNaLoja ? "" : (_sda?.uf     || enderecoAutofill?.uf     || ""),
    };
    const pagamento = (fdUI.get("pagamento") || "pix").toString();

    const faltantes = [];
    if (!cliente.nome) faltantes.push("nome completo");
    if (!cliente.cpf || cliente.cpf.length !== 11) faltantes.push("CPF");
    if (!retiradaNaLoja) {
      if (!endereco.cep || endereco.cep.length !== 8) faltantes.push("CEP");
      if (!endereco.rua) faltantes.push("rua");
      if (!endereco.numero) faltantes.push("número");
      if (!endereco.cidade) faltantes.push("cidade");
      if (!endereco.uf) faltantes.push("UF");
      if (!entregaDisponivel || !isFixedFreteMode()) {
        throw new Error("Calcule um frete com valor fechado antes de ir para pagamento.");
      }
    }
    if (faltantes.length) {
      throw new Error("Preencha: " + faltantes.join(", ") + ".");
    }
    const discountState = await validateCheckoutDiscounts({
      cpf: cliente.cpf,
      cupom: (fdUI.get("cupom") || "").toString(),
      subtotal: subtotalCompra
    });
    renderCheckoutTotals();
    const descontoCompra = Math.min(subtotalCompra, Number(discountState.discountTotal) || 0);
    const totalCompra = Math.max(0, subtotalCompra - descontoCompra) + taxaFrete;
    const paymentItems = buildPaymentItems(descontoCompra);

    const visitorRegion = getVisitorRegion();
    const numeroPedidoSugerido = getNextOrderNumber();
    const itensEstoque = carrinho.map((p) => ({
      productId: p.productId,
      colorIndex: p.colorIndex,
      nome: p.nome,
      corSelecionada: p.corSelecionada,
      tamanhoSelecionado: p.tamanhoSelecionado || "UNICO",
      quantidade: getItemQty(p)
    }));
    const pedidoPayload = {
      pedido: numeroPedidoSugerido,
      status: "reservado",
      total: totalCompra,
      subtotal: subtotalCompra,
      taxa: taxaFrete,
      desconto: descontoCompra,
      descontos: discountState.discounts,
      cupom: discountState.cupom || "",
      cliente_cpf: cliente.cpf,
      currency: "BRL",
      item_count: purchaseItems.length,
      itens: purchaseItems,
      itensEstoque,
      frete_modo: retiradaNaLoja ? "retirada" : (freteModo || ""),
      frete_prazo_dias: (() => { const op = freteOpcoesCache.find(o => o.modo === freteModo); return op?.prazoDias || null; })(),
      retirada: retiradaNaLoja,
      cep: endereco.cep || "",
      cidade: endereco.cidade || "",
      uf: endereco.uf || "",
      bairro: endereco.bairro || "",
      rua: endereco.rua || "",
      visitor_city: visitorRegion?.city || "",
      visitor_region: visitorRegion?.region || "",
      visitor_country: visitorRegion?.country || "",
      pagamento: pagamento || "",
      origem_cep: ORIGIN_CEP,
      cliente_nome: cliente.nome || "",
      cliente_telefone: cliente.telefone || "",
      cliente_email: cliente.email || "",
      cpf: cliente.cpf,
      numero: endereco.numero || "",
      complemento: endereco.complemento || "",
      ...(currentClientSession ? { client_id: currentClientSession.id } : {}),
      ...(_sda?.id ? { address_id: _sda.id } : {}),
      cliente: {
        nome:        cliente.nome || "",
        telefone:    cliente.telefone || "",
        email:       cliente.email || "",
        cpf:         cliente.cpf || "",
        cep:         endereco.cep || "",
        cidade:      endereco.cidade || "",
        uf:          endereco.uf || "",
        bairro:      endereco.bairro || "",
        rua:         endereco.rua || "",
        numero:      endereco.numero || "",
        complemento: endereco.complemento || "",
      },
    };
    const pagamentoOnline = await createInfinityPayment({
      pedido: numeroPedidoSugerido,
      metodo: pagamento,
      total: totalCompra,
      subtotal: subtotalCompra,
      taxa: taxaFrete,
      desconto: descontoCompra,
      cupom: discountState.cupom || "",
      currency: "BRL",
      cliente,
      endereco,
      itens: paymentItems,
      itensEstoque,
      pedidoPayload,
      returnPath: getCurrentStorePath()
    });
    const numeroPedido = pagamentoOnline.paymentId || pagamentoOnline.id || pagamentoOnline.pedido || numeroPedidoSugerido;
    ultimoNumeroPedido = numeroPedido;
    const pedidoEl = el("#ckPedido");
    if (pedidoEl) pedidoEl.textContent = numeroPedido;
    if (pagamentoOnline.checkoutUrl) {
      rememberPaymentOrigin();
      closeCheckoutModal();
      closeCart();
      showPaymentTransition();
      setTimeout(() => { window.location.href = pagamentoOnline.checkoutUrl; }, 600);
      return;
    } else {
      showAppMessage(pagamentoOnline.message || "Pedido preparado, mas não foi possível gerar o link de pagamento. Entre em contato com a Lemoov.");
      return;
    }

    // Limpa carrinho e interfaces abertas (apenas quando não há redirect)
    carrinho = [];
    atualizarCart();

    const dlg = el("#checkoutModal");
    if (dlg) {
      const formEl = dlg.querySelector("#checkoutForm");
      if (formEl) formEl.reset();
      ["ckCep"].forEach(id => {
        const input = el(`#${id}`);
        if (input) input.value = "";
      });
    }
    closeCheckoutModal();
    closeCart();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(()=> window.location.reload(), 400);
  } catch (err) {
    console.error(err);
    showAppMessage(err?.message || "Não foi possível preparar seu pedido. Tente novamente.");
  } finally {
    if (btn) {
      btn.disabled = false; btn.textContent = "Gerar pagamento";
    }
  }
}


// ========== LEMOOV: efeito ao adicionar ao carrinho (não remove nada existente) ==========
function flyToCart(imgEl){
  try{
    const cartIcon = document.querySelector(".cart-toggle, .header-cart, #btnCart");
    if (!imgEl || !cartIcon) return;
    const rectStart = imgEl.getBoundingClientRect();
    const rectEnd = cartIcon.getBoundingClientRect();
    const clone = imgEl.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.left = rectStart.left + "px";
    clone.style.top = rectStart.top + "px";
    clone.style.width = rectStart.width + "px";
    clone.style.height = rectStart.height + "px";
    clone.style.transition = "transform .6s ease, opacity .6s ease";
    clone.style.zIndex = 9999;
    document.body.appendChild(clone);
    const dx = rectEnd.left - rectStart.left;
    const dy = rectEnd.top - rectStart.top;
    requestAnimationFrame(()=>{
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
      clone.style.opacity = "0.2";
    });
    setTimeout(()=> clone.remove(), 650);
  }catch(e){}
}
document.addEventListener("click", (ev)=>{
  const btn = ev.target.closest("[data-add-cart], .btn-add-cart, .add-to-cart");
  if (!btn) return;
  const card = btn.closest(".product-card");
  const img = card ? card.querySelector(".product-card__media img, img") : null;
  if (img) flyToCart(img);
}, {passive:true});


// Garante que o frete apareça no resumo quando definido
function ensureFreteShownOnce(){
  try{
    const lbl = document.querySelector("#cartFreteLabel");
    const val = document.querySelector("#cartFreteValue");
    if (freteModo === "uber_free" && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
    } else if (["local_12","local_15","local_25","sedex"].includes(freteModo) && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = getDeliveryModeLabel(freteModo);
    } else if (freteModo === "whatsapp" && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = "Consultar via WhatsApp";
    } else if (typeof freteAtual === "number" && isFinite(freteAtual) && freteAtual > 0){
      if (lbl) lbl.textContent = "Frete:";
      if (val) val.textContent = formatBRL(freteAtual);
    }
  }catch(e){}
}
