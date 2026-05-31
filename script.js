/* ===== Config ===== */
const WHATS_NUMBER = "558587408457"; // seu número (DDI+DDD+telefone)
const PIX_KEY = "61000111000100";    // chave PIX (não exibida no checkout)
const CARD_PAYMENT_LINK = "";        // opcional: link de pagamento p/ cartão. Se vazio, não aparece.
// Entrega local via Moto Uber
const ORIGIN_CEP = "60360760";
const ORIGIN_COORDS = { lat: -3.7435155, lng: -38.5898999 };
const ORDER_SEQ_STORAGE_KEY = "lemoovOrderSeq";

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
let enderecoAutofill = null;
let selectedDeliveryAddress = null;
let currentClientSession = null;
let originCoordsCache = null;
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
const PAYMENT_ORIGIN_KEY = "lemoovPaymentOriginPath";

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
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: carrinho, updatedAt: cartUpdatedAt }));
  } catch (_) {}
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
  try {
    sessionStorage.setItem(PAYMENT_ORIGIN_KEY, getCurrentStorePath());
  } catch (_e) {}
}

function restorePaymentOriginIfNeeded() {
  try {
    const originPath = sessionStorage.getItem(PAYMENT_ORIGIN_KEY);
    if (!originPath || originPath === location.pathname) return false;
    const isHome = location.pathname === "/" || /\/index\.html$/i.test(location.pathname);
    const isFinal = /\/obrigado\.html$/i.test(location.pathname);
    if (isHome && !isFinal && originPath === "/catalogo-produtos.html") {
      sessionStorage.removeItem(PAYMENT_ORIGIN_KEY);
      location.replace(originPath);
      return true;
    }
  } catch (_e) {}
  return false;
}

async function loadProdutos(){
  const fetchList = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch (_e) {
      return null;
    }
  };

  const [apiList, localList] = await Promise.all([
    fetchList(`${API_BASE}/api/produtos`),
    fetchList("data/produtos.json")
  ]);

  // Always prefer the API: it applies ativo filtering and ordem sorting server-side.
  // Fall back to local JSON only when the API failed or returned nothing.
  const pickBest = (a, b) => {
    if (Array.isArray(a) && a.length > 0) return a;
    if (Array.isArray(b) && b.length > 0) return b;
    return Array.isArray(a) ? a : [];
  };

  let raw = pickBest(apiList, localList);
  // Belt-and-suspenders: apply ativo filtering and ordem sorting client-side
  // so the local-JSON fallback still respects visibility and drag order.
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
function getDeliveryModeLabel(mode) {
  if (mode === "uber_free")  return `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
  if (mode === "local_12")   return `Entrega Local – R$ 12,00`;
  if (mode === "local_15")   return `Entrega Local – R$ 15,00`;
  if (mode === "local_25")   return `Entrega Local – R$ 25,00`;
  if (mode === "sedex")      return `SEDEX – R$ ${freteAtual > 0 ? freteAtual.toFixed(2).replace(".", ",") : "--"}`;
  return "Consultar via WhatsApp";
}
function isFixedFreteMode(mode = freteModo) {
  return ["uber_free","local_12","local_15","local_25","sedex"].includes(mode);
}
function getFreteResumoLabel({ includeCep = false } = {}) {
  const cepInfo = includeCep && cepAtual ? ` (CEP ${formatCEPForInput(cepAtual)})` : "";
  if (retiradaNaLoja) return "Retirada pelo cliente";
  if (!entregaDisponivel) return "Informe o CEP";
  if (isFixedFreteMode()) return `${getDeliveryModeLabel(freteModo)}${cepInfo}`;
  return `Consultar via WhatsApp${cepInfo}`;
}
function buildPaymentItems() {
  const items = buildCartItems();
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
  if (consent === "accepted") {
    banner.remove();
    return;
  }
  const btn = document.getElementById("btnAcceptCookies");
  if (btn) {
    btn.addEventListener("click", ()=>{
      setCookieConsent("accepted");
      banner.classList.add("cookie-banner--hide");
      setTimeout(()=> banner.remove(), 400);
      initTracking();
      fetchVisitorRegion();
    });
  }
}

function getCookieConsent(){
  try {
    return localStorage.getItem("lemoovCookieConsent");
  } catch (_e) {
    return null;
  }
}

function setCookieConsent(value){
  try {
    localStorage.setItem("lemoovCookieConsent", value);
  } catch (_e) {}
}

function initTrackingIfConsented(){
  if (getCookieConsent() === "accepted") {
    initTracking();
    fetchVisitorRegion();
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
  if (sessionStorage.getItem("lemoovRegion")) return;
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return;
    const data = await res.json();
    const region = {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name
    };
    sessionStorage.setItem("lemoovRegion", JSON.stringify(region));
    trackEvent("visit_location", region);
  } catch (_e) {}
}
function getVisitorRegion(){
  try {
    const raw = sessionStorage.getItem("lemoovRegion");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
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
  if (!stock) return null;
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
  return qty === null ? true : qty > 0;
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
  if (stock && Object.values(stock).every((qty) => Number(qty) <= 0)) return true;
  return false;
}
function isProductSoldOut(prod){
  if (!prod) return true;
  if (prod.soldOut) return true;
  const colors = Array.isArray(prod.cores) ? prod.cores : [];
  if (!colors.length) return false;
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
  if (!stock) return baseSizes;
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
    height: 100vh;
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
    #cart{ width:100vw; border-radius:0; border-left:none; border-top:3px solid #009C3B; }
  }
  @media (min-width: 860px){
    #cart{
      left:50% !important; right:auto !important;
      top:50% !important;
      width:min(660px,calc(100vw - 48px)) !important;
      height:auto !important;
      max-height:88vh !important;
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
  #cart .cart__list{ padding: 12px 16px 0; flex: 1; overflow-y: auto; min-height: 0; }
  #cart .cart__item{
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
    padding: 14px 16px 20px;
    background: #f8faff;
    border-top: 1px solid rgba(0,39,118,.08);
  }
  #cart .cart__total{
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.88rem; color: #374151;
    padding: 4px 0;
  }
  #cart .cart__total:last-of-type{ font-size: 1rem; font-weight: 800; color: #0a1628; }
  #cart .cart__total strong{ color: #002776; }

  .frete__ui{ margin-bottom: 10px; }
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

  #payment-transition .pt-logo{
    font-size:clamp(.8rem,3.5vw,1rem);
    font-weight:900;
    letter-spacing:.22em;
    color:#FFDF00;
    text-transform:uppercase;
    text-shadow:0 1px 8px rgba(0,0,0,.4);
    position:relative;
    z-index:1;
  }
  #payment-transition .pt-lock{
    font-size:clamp(1rem,4vw,1.3rem);
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
  if (stockQty === null) return true;
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
    if (stockQty === null) continue;
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
        ${DELIVERY_MODE_LABEL}. Informe o CEP para continuar.
      </div>
      <div class="checkout__link">
        Não sabe o CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Consultar nos Correios</a>
      </div>
    `;
    footer.insertBefore(wrap, footer.firstChild);
  }
  hideLegacyFreteUI();
}

async function calcularFreteBackend(addr) {
  try {
    const r = await fetch('/api/frete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidade: addr.cidade, cep: addr.cep })
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d.ok) return false;
    freteAtual = d.valor;
    cepAtual   = String(addr.cep).replace(/\D/g, '');
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

  // Sempre verifica sessão primeiro — sem exceção para modo offline
  const sessionResult = await checkClientSession();
  if (!sessionResult.ok) {
    const redirectTarget = encodeURIComponent(window.location.pathname + '?initiateCheckout=1');
    window.location.href = `/cliente-login?redirect=${redirectTarget}`;
    return;
  }
  currentClientSession = sessionResult.client;

  let addresses = [];
  try {
    const addrRes = await fetch('/api/client/addresses', { credentials: 'same-origin' });
    if (addrRes.ok) {
      const addrData = await addrRes.json();
      addresses = addrData.addresses || [];
    }
  } catch (_) {}

  openAddressSelectionModal(addresses);
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
  selectedDeliveryAddress = hasAddresses ? addresses[0] : null;

  dlg.querySelectorAll('.addr-card').forEach((card) => {
    card.addEventListener('click', () => {
      dlg.querySelectorAll('.addr-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      selectedDeliveryAddress = addresses[Number(card.dataset.addrIdx)];
      dlg.querySelector('#btnConfirmAddr').disabled = false;
    });
  });

  dlg.querySelector('#btnShowAddrForm').addEventListener('click', () => {
    const form = dlg.querySelector('#addrNewForm');
    const showing = form.style.display !== 'none';
    form.style.display = showing ? 'none' : 'block';
    if (!showing) {
      dlg.querySelector('#btnConfirmAddr').disabled = true;
      selectedDeliveryAddress = null;
      dlg.querySelectorAll('.addr-card').forEach(c => c.classList.remove('selected'));
    } else if (hasAddresses) {
      selectedDeliveryAddress = addresses[0];
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
        // Banco offline ou sessão expirada: usa endereço localmente
        selectedDeliveryAddress = { id: null, cep, logradouro: rua, numero, complemento, bairro, cidade, uf };
        dlg.querySelector('#btnConfirmAddr').disabled = false;
        dlg.querySelector('#addrNewForm').style.display = 'none';
        return;
      }
      if (!res.ok) {
        showAppMessage(data.error || 'Erro ao salvar endereço.');
        saveBtn.disabled = false; saveBtn.textContent = 'Salvar e usar este endereço';
        return;
      }
      selectedDeliveryAddress = { id: data.id, cep, logradouro: rua, numero, complemento, bairro, cidade, uf };
      dlg.querySelector('#btnConfirmAddr').disabled = false;
      dlg.querySelector('#addrNewForm').style.display = 'none';
    } catch (_) {
      // Sem conexão: usa endereço localmente para não bloquear o fluxo
      selectedDeliveryAddress = { id: null, cep, logradouro: rua, numero, complemento, bairro, cidade, uf };
      dlg.querySelector('#btnConfirmAddr').disabled = false;
      dlg.querySelector('#addrNewForm').style.display = 'none';
    }
  });

  dlg.querySelector('#btnConfirmAddr').addEventListener('click', async () => {
    if (!selectedDeliveryAddress) {
      showAppMessage("Selecione ou cadastre um endereço de entrega.");
      return;
    }
    const btn = dlg.querySelector('#btnConfirmAddr');
    btn.disabled = true; btn.textContent = 'Calculando frete…';
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
    footer.appendChild(btn);
  }
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
    <div class="account__card">
      <strong>${escapeHTML(addr.logradouro || "")}, ${escapeHTML(addr.numero || "")}</strong>
      <div class="account__order-meta">
        ${addr.complemento ? `${escapeHTML(addr.complemento)}<br>` : ""}
        ${addr.bairro ? `${escapeHTML(addr.bairro)} · ` : ""}${escapeHTML(addr.cidade || "")}/${escapeHTML(addr.uf || "")}<br>
        CEP ${formatCEPForInput(addr.cep || "")}
      </div>
    </div>
  `).join("") : `<div class="account__empty">Nenhum endereço cadastrado.</div>`;

  const ordersHtml = orders.length ? orders.map((order) => {
    const items = Array.isArray(order.itens) ? order.itens.slice(0, 4) : [];
    const itemsHtml = items.length ? `<ul class="account__items">${items.map((item) => `
      <li>${Number(item.quantity || 1)}x ${escapeHTML(item.item_name || "Item")} ${item.price ? `· ${formatBRL(Number(item.price))}` : ""}</li>
    `).join("")}</ul>` : "";
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
  ensureCheckoutButton();

  const totalProdutos = getCartSubtotal();
  const totalComFrete = totalProdutos + (!retiradaNaLoja && entregaDisponivel ? (freteAtual || 0) : 0);

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
    } else if (["local_12","local_15","local_25","sedex"].includes(freteModo)) {
      freteEl.textContent = getDeliveryModeLabel(freteModo);
    } else {
      freteEl.textContent = "Consultar via WhatsApp";
    }
  }

  const fixedFrete = isFixedFreteMode();
  const totalLabel = !retiradaNaLoja && entregaDisponivel
    ? (fixedFrete ? formatBRL(totalComFrete) : `${formatBRL(totalComFrete)} + frete`)
    : formatBRL(totalComFrete);
  el("#cartTotal").textContent = totalLabel;

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
    if (new URLSearchParams(location.search).get('initiateCheckout') === '1') {
      history.replaceState(null, '', location.pathname);
      initiateCheckout();
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
function computeOrderNumber({ commit } = { commit: false }) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}${mm}${dd}`;
  let seq = 1;
  let data = null;
  try {
    const raw = localStorage.getItem(ORDER_SEQ_STORAGE_KEY);
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (data && data.date === dateKey && typeof data.seq === "number") {
    seq = data.seq + 1;
  }
  if (commit) {
    try {
      localStorage.setItem(ORDER_SEQ_STORAGE_KEY, JSON.stringify({ date: dateKey, seq }));
    } catch {
      orderSeqFallback = { date: dateKey, seq };
    }
  } else if (!data && orderSeqFallback.date === dateKey) {
    seq = orderSeqFallback.seq + 1;
  }
  if (commit && (!data || data.date !== dateKey)) {
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
  freteAtual = 0;
  cepAtual = "";
  entregaDisponivel = false;
  enderecoAutofill = null;
  freteModo = null;
  const freteMsg = el("#freteMsg");
  if (freteMsg) freteMsg.textContent = message;
  atualizarCart();
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

async function calcularEntregaPorCEP(cepRaw) {
  const cep = normalizeCEP(cepRaw);
  const freteMsg = el("#freteMsg");
  if (!cep || cep.length !== 8) {
    resetFreteUI("CEP inválido. Digite 8 números.");
    return;
  }
  if (freteMsg) freteMsg.textContent = "Verificando entrega…";
  cepAtual = cep;
  freteAtual = 0;
  entregaDisponivel = true;

  const [addr, coords, origin] = await Promise.all([
    getAddressByCEP(cep),
    geocodeByCEP(cep),
    getOriginCoords()
  ]);
  enderecoAutofill = addr || null;
  const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  const city = addr?.cidade || coords?.city;
  const uf = addr?.uf || coords?.state;
  if (!addr && !hasCoords && (!city || !uf)) {
    resetFreteUI("CEP não encontrado. Verifique e tente novamente.");
    return;
  }

  if (hasCoords && origin) {
    const km = haversineKm(origin.lat, origin.lng, coords.lat, coords.lng);
    if (km <= DELIVERY_FREE_RADIUS_KM) {
      freteModo = "uber_free";
      freteAtual = 0;
      if (freteMsg) freteMsg.textContent = `Entrega grátis (até ${DELIVERY_FREE_RADIUS_KM} km da loja).`;
      atualizarCart();
      return;
    }
  }

  const localPrice = getLocalDeliveryPrice(city, uf);
  if (localPrice === DELIVERY_FORTALEZA_CAUCAIA_PRICE) {
    freteModo = "local_12";
    freteAtual = DELIVERY_FORTALEZA_CAUCAIA_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em ${city || "Fortaleza/Caucaia"} — R$ ${DELIVERY_FORTALEZA_CAUCAIA_PRICE},00.`;
    atualizarCart();
    return;
  }
  if (localPrice === DELIVERY_MARACANAU_PRICE) {
    freteModo = "local_15";
    freteAtual = DELIVERY_MARACANAU_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em Maracanaú — R$ ${DELIVERY_MARACANAU_PRICE},00.`;
    atualizarCart();
    return;
  }
  if (localPrice === DELIVERY_EUSEBIO_PRICE) {
    freteModo = "local_25";
    freteAtual = DELIVERY_EUSEBIO_PRICE;
    if (freteMsg) freteMsg.textContent = `Entrega em ${city} — R$ ${DELIVERY_EUSEBIO_PRICE},00.`;
    atualizarCart();
    return;
  }

  // Fora da RMF → consulta SEDEX no backend
  if (freteMsg) freteMsg.textContent = "Consultando frete SEDEX…";
  const sedexOk = await calcularFreteBackend({ cidade: city || '', cep });
  if (!sedexOk) {
    freteModo = "whatsapp";
    freteAtual = 0;
    if (freteMsg) freteMsg.textContent = "Não foi possível calcular o frete. Consulte via WhatsApp.";
    atualizarCart();
  } else if (freteMsg) {
    const contingencia = freteModo === "sedex" ? " (estimativa)" : "";
    freteMsg.textContent = `SEDEX – R$ ${freteAtual.toFixed(2).replace(".", ",")}${contingencia}.`;
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
    pickupToggle.addEventListener("change", () => {
      retiradaNaLoja = pickupToggle.checked;
      if (retiradaNaLoja) {
        freteAtual = 0;
        cepAtual = "";
        entregaDisponivel = false;
        enderecoAutofill = null;
        freteModo = "retirada";
        if (cepInput) cepInput.value = "";
      } else {
        freteModo = null;
        if (freteMsg) freteMsg.textContent = "Informe o CEP para calcular a entrega.";
      }
      applyPickupUIState();
      atualizarCart();
    });
  }
  applyPickupUIState();

  if (cepInput && !cepInput._lemoovBound) {
    cepInput._lemoovBound = true;
    cepInput.addEventListener("input", () => {
      if (retiradaNaLoja) return;
      cepInput.value = normalizeCEP(cepInput.value);
      if (cepInput.value.length === 0) {
        resetFreteUI();
      } else if (cepInput.value.length < 8) {
        if (freteMsg) freteMsg.textContent = "CEP inválido. Digite 8 números.";
        freteAtual = 0;
        entregaDisponivel = false;
        cepAtual = "";
        atualizarCart();
      } else if (cepInput.value.length === 8) {
        if (cepInput._lastCep === cepInput.value) return;
        cepInput._lastCep = cepInput.value;
        calcularEntregaPorCEP(cepInput.value);
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
          const addr = await reverseGeocodeAddress(pos.coords.latitude, pos.coords.longitude);
          if (!addr?.cep || addr.cep.length !== 8) {
            if (freteMsg) freteMsg.textContent = "Não conseguimos identificar seu CEP. Digite manualmente.";
            return;
          }
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
                  Você será redirecionado para o ambiente seguro da InfinitePay. Endereço, CPF e dados do cartão são preenchidos lá.
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

  // Pre-fill client data from session
  if (currentClientSession) {
    const nomeInput    = dlg.querySelector('input[name="nome"]');
    const emailInput   = dlg.querySelector('input[name="email"]');
    const telefoneInput = dlg.querySelector('input[name="telefone"]');
    const ckCepInput   = dlg.querySelector('#ckCep');
    if (nomeInput    && !nomeInput.value)    nomeInput.value    = currentClientSession.nome  || '';
    if (emailInput   && !emailInput.value)   emailInput.value   = currentClientSession.email || '';
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

  // Preencher resumo
  const itemsDiv = el("#checkoutItems");
  const subtotal = getCartSubtotal();
  const total = subtotal + (!retiradaNaLoja && entregaDisponivel ? (freteAtual||0) : 0);
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

  el("#ckSubtotal").textContent = formatBRL(subtotal);
  el("#ckFrete").textContent = getFreteResumoLabel();
  const freteVia = el("#ckFreteVia");
  if (freteVia) freteVia.textContent = "";
  const fixedFrete2 = isFixedFreteMode();
  let totalLabel = formatBRL(total);
  if (!retiradaNaLoja && entregaDisponivel) {
    totalLabel = fixedFrete2 ? formatBRL(total) : `${formatBRL(total)} + frete`;
  }
  el("#ckTotal").textContent = totalLabel;
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
  trackEvent("start_checkout", {
    currency: "BRL",
    value: total,
    items: checkoutItemsPayload,
    item_count: getCartCount()
  });
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
  const stars = [
    [12,18],[22,72],[38,8],[55,85],[68,14],[80,60],[90,30],[6,50],
    [45,42],[75,78],[30,92],[60,5],[15,65],[85,45],[50,22]
  ].map(([l,t],i) =>
    `<span style="left:${l}%;top:${t}%;animation-delay:${(i*0.17).toFixed(2)}s">★</span>`
  ).join("");
  const div = document.createElement("div");
  div.id = "payment-transition";
  div.innerHTML = `
    <div class="pt-stars">${stars}</div>
    <div class="pt-diamond"></div>
    <div class="pt-circle">
      <div class="pt-lock">🔒</div>
      <div class="pt-logo">Lemoov</div>
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
  const totalCompra = subtotalCompra + (!retiradaNaLoja && entregaDisponivel ? (freteAtual||0) : 0);
  const purchaseItems = buildCartItems();
  const paymentItems = buildPaymentItems();
  if (btn) {
    btn.disabled = true; btn.textContent = "Gerando pagamento...";
  }

  try {
    const fdUI = new FormData(form);
    const cliente = {
      nome: (fdUI.get("nome") || currentClientSession?.nome || "").toString().trim(),
      telefone: formatPhoneForInput((fdUI.get("telefone") || "").toString()),
      email: (fdUI.get("email") || currentClientSession?.email || "").toString().trim(),
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
      currency: "BRL",
      item_count: purchaseItems.length,
      itens: purchaseItems,
      itensEstoque,
      frete_modo: retiradaNaLoja ? "retirada" : (freteModo || ""),
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
      numero: endereco.numero || "",
      complemento: endereco.complemento || "",
      ...(currentClientSession ? { client_id: currentClientSession.id } : {}),
      ...(_sda?.id ? { address_id: _sda.id } : {}),
      cliente: {
        nome:        cliente.nome || "",
        telefone:    cliente.telefone || "",
        email:       cliente.email || "",
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
      carrinho = [];
      atualizarCart();
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
