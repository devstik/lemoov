/* ===== Config ===== */
const WHATS_NUMBER = "558587408457"; // seu número (DDI+DDD+telefone)
const PIX_KEY = "61000111000100";    // chave PIX (não exibida no checkout)
const CARD_PAYMENT_LINK = "";        // opcional: link de pagamento p/ cartão. Se vazio, não aparece.
// Entrega local via Moto Uber (valor combinado no WhatsApp)
const ORIGIN_CEP = "60360415";
const ORIGIN_COORDS = { lat: -3.7404691, lng: -38.5897018 };
const ORDER_SEQ_STORAGE_KEY = "lemoovOrderSeq";

const DELIVERY_MODE_LABEL = "Entrega via Moto Uber";
const DELIVERY_FREE_RADIUS_KM = 2;
const METRO_FORTALEZA = [
  "Fortaleza",
  "Caucaia",
  "Maracanaú",
  "Maranguape",
  "Aquiraz",
  "Eusébio",
  "Itaitinga",
  "Horizonte",
  "Pacajus",
  "Guaiúba",
  "Chorozinho",
  "São Gonçalo do Amarante",
  "Pacatuba",
  "Pindoretama",
  "Cascavel"
];
let freteAtual = 0;
let cepAtual = "";
let entregaDisponivel = false;
let freteModo = null;           // 'uber'
let enderecoAutofill = null;
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
  { label: "Macacão & Macaquinho", categories: ["Macacão","Macaquinho"], tagline: "Movimento total", image: "image/macacao/preto.jpg" },
  { label: "Conjuntos Legging", categories: ["Conjunto Legging"], tagline: "Mix & Match", image: "image/Conjunto_Calca/terracota1.jpg" },
  { label: "Shorts & Top", categories: ["Conjunto Short"], tagline: "Movimento livre", image: "image/Conjunto_Short/verde_agua2.jpg" },
  { label: "Blusas & Coletes", categories: ["Blusa"], tagline: "Camadas leves", image: "image/Blusa/blusa_preto1.jpg" }
];
const API_BASE = window.LEMOOV_API_BASE || "";
const PRODUCT_ENDPOINT = `${API_BASE}/api/produtos`;

/* ------------------------------------------------------------
   Estado & Helpers
------------------------------------------------------------ */
let filtroAtual = "Todos";
let ordenacaoAtual = "destaque";
let carrinho = [];
let produtoAtual = null;
let corIndexAtual = 0;
let tamanhoAtual = null;
let ultimoNumeroPedido = null;
let orderSeqFallback = { date: "", seq: 0 };
let modalLastFocus = null;

const el = (sel) => document.querySelector(sel);
const formatBRL = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cssEscape = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
  ? CSS.escape
  : (value) => String(value).replace(/[^a-zA-Z0-9_\-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);

async function loadProdutos(){
  try {
    const res = await fetch(PRODUCT_ENDPOINT);
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    produtos = Array.isArray(data) ? data : [];
    return true;
  } catch (_e) {
    try {
      const res = await fetch("data/produtos.json");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      produtos = Array.isArray(data) ? data : [];
      return true;
    } catch (_err) {
      produtos = [];
      return false;
    }
  }
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

function isInMetroFortaleza(city, uf) {
  if (!city || !uf) return false;
  if (String(uf).trim().toUpperCase() !== "CE") return false;
  const normalized = normalizeCityName(city);
  return METRO_FORTALEZA.some((name) => normalizeCityName(name) === normalized);
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

  const heroImages = [
    "image/Conjunto_Calca/verde_pavao2.jpg",
    "image/Conjunto_Calca/verde1.jpg",
    "image/Conjunto_Short/cacau1.jpeg",
    "image/Conjunto_Short/Manteiga2.jpeg",
    "image/Conjunto_Short/sunmov_chocolate1.jpg",
    "image/Conjunto_Calca/terracota2.jpg",
    "image/Conjunto_Calca/terracota1.jpg",
    "image/Conjunto_Calca/verde_pavao1.jpg",
    "image/Conjunto_Calca/verde_pavao2.jpg",
    "image/Macaquinho/fucsia1.jpg"
  ];
  slides.forEach((slide, idx) => {
    const img = slide.querySelector("img");
    if (img && heroImages[idx]) img.src = heroImages[idx];
  });

  let current = 0;
  let autoId = null;
  const AUTO_MS = 2000;

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
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === current));
    if (nextSlide) {
      nextSlide.classList.add("is-entering");
      setTimeout(() => nextSlide.classList.remove("is-entering"), SHARD_MS);
    }
  };

  const next = () => goTo(current + 1);

  const stopAuto = () => {
    if (autoId) {
      clearInterval(autoId);
      autoId = null;
    }
  };
  const restartAuto = () => {
    stopAuto();
    autoId = window.setInterval(next, AUTO_MS);
  };

  carousel.addEventListener("mouseenter", stopAuto);
  carousel.addEventListener("mouseleave", restartAuto);
  carousel.addEventListener("focusin", stopAuto);
  carousel.addEventListener("focusout", restartAuto);
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
});

/* ===== Descrição helpers ===== */
function resolveDesc(prod, colorIndex = 0){
  const cor = (prod.cores || [])[colorIndex];
  return (cor && cor.desc) ? cor.desc : (prod.desc || prod.descricao || {});
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
  return parts.join(" • ");
}
function formatDescricaoHTML(desc){
  if (!desc) return "";
  if (desc.texto) {
    return `<p>${desc.texto}</p>`;
  }
  const li = [];
  if (desc.tecido) li.push(`<li><strong>Tecido:</strong> ${desc.tecido}</li>`);
  if (Array.isArray(desc.tecnologias) && desc.tecnologias.length) li.push(`<li><strong>Tecnologias:</strong> ${desc.tecnologias.join(", ")}</li>`);
  if (desc.compressao) li.push(`<li><strong>Compressão:</strong> ${desc.compressao}</li>`);
  if (desc.transparencia) li.push(`<li><strong>Transparência:</strong> ${desc.transparencia}</li>`);
  if (desc.recortes) li.push(`<li><strong>Recortes:</strong> ${desc.recortes}</li>`);
  if (Array.isArray(desc.extras) && desc.extras.length) li.push(`<li><strong>Extras:</strong> ${desc.extras.join(", ")}</li>`);
  if (Array.isArray(desc.indicacao) && desc.indicacao.length) li.push(`<li><strong>Indicação de uso:</strong> ${desc.indicacao.join(", ")}</li>`);
  return `<ul class="product-desc-list">${li.join("")}</ul>`;
}

/* ===== Helpers de disponibilidade por cor/tamanho ===== */
function getColorImages(cor){
  if (!cor) return [];
  if (Array.isArray(cor.imagens) && cor.imagens.length) {
    return cor.imagens.filter(Boolean);
  }
  if (cor.imagem) return [cor.imagem];
  return [];
}
function getColorImage(cor){
  const imgs = getColorImages(cor);
  return imgs[0] || "";
}
function isVariantSoldOut(prod, colorIndex = 0){
  if (prod && prod.soldOut) return true;
  const cor = (prod && prod.cores) ? prod.cores[colorIndex] : null;
  if (cor && cor.soldOut) return true;
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
  if (!cor) return prod.tamanhos || [];
  if (Array.isArray(cor.tamanhos) && cor.tamanhos.length) return cor.tamanhos;
  return prod.tamanhos || [];
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
  const base = Number(prod.preco) || 0;

  if (colorObj && typeof colorObj.precoPromo === "number") {
    const final = colorObj.precoPromo;
    const original = base;
    const pct = Math.round((1 - final / original) * 100);
    return { final, original, pct: Math.max(0, pct) };
  }
  if (colorObj && typeof colorObj.descontoPct === "number") {
    const final = +(base * (1 - colorObj.descontoPct/100)).toFixed(2);
    return { final, original: base, pct: Math.max(0, Math.round(colorObj.descontoPct)) };
  }
  if (typeof prod.precoPromo === "number") {
    const final = prod.precoPromo;
    const original = base;
    const pct = Math.round((1 - final / original) * 100);
    return { final, original, pct: Math.max(0, pct) };
  }
  if (typeof prod.descontoPct === "number") {
    const final = +(base * (1 - prod.descontoPct/100)).toFixed(2);
    return { final, original: base, pct: Math.max(0, Math.round(prod.descontoPct)) };
  }
  return { final: base, original: null, pct: 0 };
}

/* ------------------------------------------------------------
   Estilos extras injetados
------------------------------------------------------------ */
(function injectCartStyles(){
  const css = `
  #cart {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    transform: none;
    width: 100vw;
    height: 100vh;
    max-width: none;
    max-height: none;
    border-radius: 0;
    background: linear-gradient(135deg,#fefefe,#f3f8ff 65%, #e7f5ff);
    box-shadow: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity .2s ease;
    z-index: 10001;
    display:flex;
    flex-direction:column;
  }
  #cart.show {
    opacity: 1;
    pointer-events: auto;
  }
  @media (max-width: 1024px){
    #cart{
      width: 100vw;
      height: 100vh;
      border-radius: 0;
    }
  }
  #cartBackdrop {
    position: fixed !important; inset: 0; background: rgba(0,0,0,.45);
    opacity: 0; transition: opacity .18s ease; z-index: 10000; pointer-events: none;
  }
  #cartBackdrop.show { opacity: 1; pointer-events: auto; }

  .cart, .cart * { font-size: 14px; }

  .frete__ui input{
    padding:10px 12px!important;
    font-size:0.85rem!important;
    max-width:none!important;
    border-radius:12px!important;
    background:#f4f8fb!important;
    color:#0d1f2a!important;
    border:1px solid rgba(15,45,46,0.15)!important;
  }
  .frete__ui .btn{
    padding:10px 16px!important;
    font-size:0.78rem!important;
    letter-spacing:0.2em;
    background:linear-gradient(120deg,#0ce38d,#00a2ff)!important;
    color:#03121a!important;
    border:none!important;
    border-radius:14px!important;
  }

  #btnCheckout{ width:100%; margin-top:10px; padding:10px 12px; font-size:14px; }

  dialog.checkout-modal{
    border:none;
    border-radius:0;
    width:100vw;
    height:100vh;
    max-width:none;
    max-height:none;
    padding:0;
    z-index:10002;
    background: radial-gradient(circle at 15% 15%, rgba(103,255,196,0.2), transparent 45%), linear-gradient(135deg,#f9fbff,#eef5ff 55%, #0f2d2e 110%);
    color:#0d1f2a;
    box-shadow:none;
    overflow-y:auto;
    overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
    display:flex;
    flex-direction:column;
  }
  dialog.checkout-modal::backdrop{
    background: rgba(2,8,16,0.85);
    backdrop-filter: blur(5px);
  }
  .checkout__header{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    padding:28px 34px 20px;
    border-bottom:1px solid rgba(0,0,0,0.05);
    background:#ffffff;
  }
  .checkout__title{
    font-size:0.88rem;
    font-weight:800;
    letter-spacing:0.3em;
    text-transform:uppercase;
    color:#0c3c2b;
  }
  .checkout__subtitle{
    margin:10px 0 0;
    color:#4b5b68;
  }
  .checkout__body{
    padding:32px;
    display:grid;
    gap:24px;
    grid-template-columns:1fr;
    background:transparent;
    overflow-y:auto;
    flex:1 1 auto;
    min-height:0;
    overscroll-behavior:contain;
  }
  @media (min-width: 960px){
    .checkout__body{
      grid-template-columns:minmax(280px,0.9fr) minmax(0,1.6fr);
      align-items:start;
    }
    .checkout__summary{ height:100%; }
  }
  .checkout__summary{
    background:#ffffff;
    border:1px solid rgba(0,0,0,0.05);
    border-radius:26px;
    padding:22px 24px;
    box-shadow:0 20px 60px rgba(7,20,36,0.08);
  }
  .checkout__totals{
    margin-top:12px;
    display:grid;
    gap:6px;
    color:#0b1f2a;
    font-weight:600;
  }
  .checkout__note{
    margin-top:10px;
    padding:10px 12px;
    border-radius:14px;
    background:#f4f8fb;
    color:#273746;
    font-size:0.82rem;
  }
  @media (min-width: 1100px){
    .checkout__summary{
      position:sticky;
      top:32px;
    }
  }
  .checkout__grid{
    display:grid;
    gap:20px;
  }
  @media (min-width: 640px){
    .checkout__grid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
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
    border:1px solid rgba(0,0,0,0.05);
    border-radius:24px;
    padding:20px 22px;
    display:grid;
    gap:16px;
    grid-template-columns:repeat(2,minmax(0,1fr));
    background:#ffffff;
    box-shadow:0 25px 65px rgba(12,25,40,0.12);
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
    padding:14px 20px 20px;
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
    font-size:0.85rem;
    letter-spacing:0;
    text-transform:none;
    color:#32404c;
    display:block;
    margin-bottom:6px;
    font-weight:600;
  }
  .checkout__input,
  .checkout__select{
    width:100%;
    padding:12px 14px;
    border:1px solid rgba(15,45,46,0.15);
    border-radius:16px;
    font-size:0.95rem;
    background:#fdfefe;
    color:#0d1f2a;
    transition:border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .checkout__input:focus,
  .checkout__select:focus{
    outline:none;
    border-color:#1ec28b;
    box-shadow:0 0 0 3px rgba(30,194,139,0.2);
  }
  .checkout__input::placeholder{
    color:rgba(30,30,30,0.45);
  }
  .checkout__muted{
    color:#4f6070;
    font-size:0.85rem;
  }
  .checkout__radio{
    display:flex;
    gap:14px;
    align-items:center;
    flex-wrap:wrap;
  }
  .checkout__radio label{
    display:flex;
    align-items:center;
    gap:8px;
    padding:10px 18px;
    border-radius:999px;
    background:#f4f8fb;
    border:1px solid rgba(0,0,0,0.04);
    color:#0b1f2a;
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
    background:linear-gradient(120deg,#0ce38d,#00a2ff);
    color:#03121a;
    border:none;
    border-radius:18px;
    font-weight:700;
    letter-spacing:0.25em;
    text-transform:uppercase;
  }
  .checkout-modal .btn--ghost{
    background:#f4f8fb;
    color:#0d1f2a;
    border:1px solid rgba(15,45,46,0.15);
    border-radius:18px;
    letter-spacing:0.2em;
    text-transform:uppercase;
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

  @media (max-width:640px){
    .checkout__grid{ grid-template-columns:1fr; }
    .checkout__row{ flex-direction:column; }
  }`;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);
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
    });
    card.appendChild(btn);
    wrap.appendChild(card);
  });
}

function buildSwatches(prod, onChange, selectedIndex = 0, mainImage = null, onColorAffectsDesc = null){
  const container = document.createElement("div");
  container.className = "swatches";
  (prod.cores || []).forEach((c, idx)=>{
    const b = document.createElement("button");
    b.className = "swatch";
    b.title = c.nome;
    b.dataset.index = idx;
    b.dataset.selected = (idx === selectedIndex) ? "true" : "false";
    b.type = "button";
    b.setAttribute("aria-pressed", (idx === selectedIndex) ? "true" : "false");
    b.setAttribute("aria-label", c.nome);
    const img = document.createElement("img");
    img.src = getColorImage(c); img.alt = c.nome;
    b.appendChild(img);
    b.addEventListener("click", (e)=> {
      e.preventDefault(); e.stopPropagation();
      onChange(idx, c);
      container.querySelectorAll(".swatch").forEach(s => {
        s.dataset.selected = "false";
        s.setAttribute("aria-pressed", "false");
      });
      b.dataset.selected = "true";
      b.setAttribute("aria-pressed", "true");
      if (mainImage) mainImage.src = getColorImage(c);
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
    const categorias = filtroAtual.split("|").map(s => s.trim());
    lista = produtos.filter(p => categorias.includes(p.categoria));
  }
  lista = ordenar(lista);
  const disponiveis = lista.filter(p => !isProductSoldOut(p));
  const esgotados = lista.filter(p => isProductSoldOut(p));
  lista = [...disponiveis, ...esgotados];

  const countEl = document.querySelector("#productCount");
  if (countEl) countEl.textContent = "";

  grid.innerHTML = "";

  if (!lista.length) {
    grid.innerHTML = `<div class="muted" style="padding:24px; text-align:center;">Nenhum produto disponível no momento.</div>`;
    attachCarouselAfterRender();
    return;
  }

  lista.forEach((p,i)=>{
    const artigo = document.createElement("article");
    artigo.className = "product-card";
    artigo.dataset.index = i;

    const primeiraImagem = (p.cores && p.cores.length) ? getColorImage(p.cores[0]) : "";

    // estado local do card
    let selectedColorIndex = 0;
    let availableForColor = getAvailableSizesForColor(p, selectedColorIndex);
    let selectedSize = availableForColor[0] || null;
    const requiresSize = Array.isArray(p.tamanhos) && p.tamanhos.length > 0;

    const desc0 = resolveDesc(p, 0);
    const short0 = formatShortDetalhamento(desc0);

    artigo.innerHTML = `
      <a href="#" class="product-card__link">
        <figure class="product-card__media">
          <img src="${primeiraImagem}" alt="${p.nome}" loading="lazy" decoding="async"/>
          <span class="product-card__badge" data-badge-off style="display:none;">
            <span class="badge-off" data-badge-off-text></span>
          </span>
        </figure>
        <div class="product-card__info">
          <h3 class="product-card__name">${p.nome}</h3>
          <p class="product-card__desc" data-short-desc>${short0}</p>
          <div class="product-card__price">
            <s class="original-price" data-price-original style="display:none;"></s>
            <span class="current-price" data-price-final></span>
          </div>
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

    const mainImage = artigo.querySelector(".product-card__media img");
    const colorsWrap = artigo.querySelector("[data-options-colors]");
    const sizesWrap  = artigo.querySelector("[data-options-sizes]");
    const $orig      = artigo.querySelector('[data-price-original]');
    const $final     = artigo.querySelector('[data-price-final]');
    const $badgeWrap = artigo.querySelector('[data-badge-off]');
    const $badgeTxt  = artigo.querySelector('[data-badge-off-text]');
    const $shortDesc = artigo.querySelector('[data-short-desc]');
    const addBtn = artigo.querySelector("[data-add-quick]");

    function refreshAddButton(){
      const soldOut = isVariantSoldOut(p, selectedColorIndex);
      const thereIsAvailable = availableForColor && availableForColor.length;
      const canAdd = !requiresSize || (thereIsAvailable && selectedSize);
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

    // Cores
    if (p.cores && p.cores.length) {
      colorsWrap.appendChild(
        buildSwatches(p, (idx, c) => {
          selectedColorIndex = idx;
          availableForColor = getAvailableSizesForColor(p, selectedColorIndex);
          selectedSize = applySizeAvailability(
            sizesWrap, (p.tamanhos || []), availableForColor,
            (t)=>{ selectedSize = t; refreshAddButton(); }
          );
          updateCardPrice(idx);
          refreshAddButton();
        }, 0, mainImage, (idx)=>{
          const d = resolveDesc(p, idx);
          $shortDesc.textContent = formatShortDetalhamento(d);
        })
      );
    } else {
      colorsWrap.innerHTML = "<span class='muted'>Única cor</span>";
    }

    // Tamanhos
    if (p.tamanhos && p.tamanhos.length) {
      selectedSize = applySizeAvailability(
        sizesWrap, p.tamanhos, availableForColor,
        (t)=>{ selectedSize = t; refreshAddButton(); }
      );
    } else {
      sizesWrap.innerHTML = "<span class='muted'>Tamanho único</span>";
      selectedSize = null;
    }

    updateCardPrice(0);
    refreshAddButton();

    // Botão "Adicionar"
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();

      const thereIsAvailable = availableForColor && availableForColor.length;

      if (requiresSize && (!thereIsAvailable || !selectedSize)) {
        alert("Selecione um tamanho disponível para essa cor.");
        return;
      }

      const priceNow = computeColorPrice(p, (p.cores||[])[selectedColorIndex]).final;

      const descAtual = formatShortDetalhamento(resolveDesc(p, selectedColorIndex));
      addCarrinho({
        nome: p.nome,
        categoria: p.categoria,
        preco: priceNow,
        corSelecionada: (p.cores && p.cores[selectedColorIndex]) ? p.cores[selectedColorIndex].nome : undefined,
        tamanhoSelecionado: requiresSize ? selectedSize : undefined,
        imagemSelecionada: (p.cores && p.cores[selectedColorIndex]) ? getColorImage(p.cores[selectedColorIndex]) : undefined,
        descricaoCurta: descAtual
      }, artigo.querySelector(".product-card__media img") || artigo);
    });

    const mediaFigure = artigo.querySelector(".product-card__media");
    if (mediaFigure && p.cores && p.cores.length > 1) {
      mediaFigure.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const swatches = colorsWrap.querySelectorAll(".swatch");
        if (!swatches.length) return;
        const nextIndex = (selectedColorIndex + 1) % swatches.length;
        swatches[nextIndex]?.click();
      });
    }

    artigo.querySelector(".product-card__link").addEventListener("click", (e) => {
      if (e.target.closest(".swatch, .size")) return;
      e.preventDefault();
      abrirModal(lista.indexOf(p));
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
function abrirModal(index){
  const base = (() => {
    if (!filtroAtual || filtroAtual === "Todos") return produtos;
    const cats = filtroAtual.split("|").map(s => s.trim());
    return produtos.filter(p => cats.includes(p.categoria));
  })();
  produtoAtual = base[index];
  corIndexAtual = 0;

  const allSizes = produtoAtual.tamanhos || [];
  tamanhoAtual = null;

  const imgInicial = (produtoAtual.cores && produtoAtual.cores.length) ? getColorImage(produtoAtual.cores[0]) : "";

  el("#modalImg").src = imgInicial;
  el("#modalNome").textContent = produtoAtual.nome;

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
    produtoAtual.cores.forEach((c, idx)=>{
      const b = document.createElement("button");
      b.className = "swatch";
      b.title = c.nome;
      b.dataset.index = idx;
      b.dataset.selected = (idx === 0) ? "true" : "false";
      b.type = "button";
      b.setAttribute("aria-pressed", (idx === 0) ? "true" : "false");
      b.setAttribute("aria-label", c.nome);
      const img = document.createElement("img");
      img.src = getColorImage(c); img.alt = c.nome;
      b.appendChild(img);
      b.addEventListener("click", ()=>{
        corIndexAtual = idx;
        colorsWrap.querySelectorAll(".swatch").forEach(s=> {
          s.dataset.selected = "false";
          s.setAttribute("aria-pressed", "false");
        });
        b.dataset.selected = "true";
        b.setAttribute("aria-pressed", "true");
        el("#modalImg").src = getColorImage(c);

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
    const canAdd = !requiresSize || (avail.length && tamanhoAtual && avail.includes(tamanhoAtual));
    btnAdd.disabled = !canAdd;
    if (canAdd) btnAdd.textContent = "Adicionar ao carrinho";
    else btnAdd.textContent = isVariantSoldOut(produtoAtual, corIndexAtual) ? "Esgotado" : "Indisponível";
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
      const cor = (produtoAtual.cores || [])[corIndexAtual] || null;
      const imgs = getColorImages(cor);
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

    const avail = getAvailableSizesForColor(produtoAtual, corIndexAtual);
    const allSizes = produtoAtual.tamanhos || [];
    const requiresSize = allSizes.length > 0;
    const canAdd = !requiresSize || (avail.length && tamanhoAtual && avail.includes(tamanhoAtual));

    if (!canAdd){
      alert("Selecione um tamanho disponível para essa cor.");
      return;
    }

    const priceNow = computeColorPrice(produtoAtual, cor).final;

    const descricaoCurta = formatShortDetalhamento(resolveDesc(produtoAtual, corIndexAtual));
    addCarrinho({
      nome: produtoAtual.nome,
      categoria: produtoAtual.categoria,
      preco: priceNow,
      corSelecionada: cor ? cor.nome : undefined,
      tamanhoSelecionado: requiresSize ? tamanhoAtual : undefined,
      imagemSelecionada: cor ? getColorImage(cor) : undefined,
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
function addCarrinho(prod, animateSource = null){
  const item = {
    nome: prod.nome,
    categoria: prod.categoria,
    preco: Number(prod.preco) || 0,
    corSelecionada: prod.corSelecionada,
    tamanhoSelecionado: prod.tamanhoSelecionado,
    imagemSelecionada: prod.imagemSelecionada,
    descricaoCurta: prod.descricaoCurta || ""
  };
  carrinho.push(item);
  atualizarCart();
  animateCartIcon();
  if (animateSource) animateProductFly(animateSource);
  trackEvent("add_to_cart", {
    currency: "BRL",
    value: item.preco,
    item_name: item.nome,
    item_category: item.categoria,
    quantity: 1
  });
}
function removerCarrinho(index){ carrinho.splice(index,1); atualizarCart(); }

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
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap;">
        <input id="cepInput" type="text" inputmode="numeric"
          placeholder="CEP de entrega"
          autocomplete="postal-code"
          aria-label="Digite o CEP de entrega"
          style="flex:1 1 0; min-width:0; max-width:160px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px;" />
        <button id="btnUseLocation" class="btn"
          style="background:#000; color:#fff; padding:8px 10px; border-radius:8px; flex:0 0 auto; white-space:nowrap;">Usar localização</button>
      </div>
      <div id="freteMsg" class="muted" style="text-align:left; margin-top:6px;">
        ${DELIVERY_MODE_LABEL}. Informe o CEP para continuar.
      </div>
      <div class="checkout__link" style="margin-top:6px;">
        Não sabe CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Consultar nos Correios</a>
      </div>
    `;
    footer.insertBefore(wrap, footer.firstChild);
  }
  hideLegacyFreteUI();
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
    btn.textContent = "Continuar";
    btn.addEventListener("click", openCheckoutModal);
    footer.appendChild(btn);
  }
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
    if (dlg.open && typeof dlg.close === "function") dlg.close();
    dlg.removeAttribute("open");
    dlg.setAttribute("aria-hidden","true");
  }
  restoreCheckoutScroll();
}

function atualizarCart(){
  try{ ensureFreteShownOnce(); }catch(e){}

  const cartCount = el("#cartCount");
  if (cartCount) cartCount.textContent = carrinho.length;
  const list = el("#cartList");
  if (!list) return;
  list.innerHTML = "";

  if (carrinho.length === 0) {
    list.innerHTML = `<li class="cart__empty-state" style="text-align:center; padding-top:40px; color:var(--text-muted);">
      Seu carrinho está vazio.
    </li>`;
  } else {
    carrinho.forEach((p, i) => {
      const nomeBits = [
        p.corSelecionada ? `Cor: ${p.corSelecionada}` : null,
        p.tamanhoSelecionado ? `Tamanho: ${p.tamanhoSelecionado}` : null
      ].filter(Boolean).join(" | ");

      const descricaoLinha = p.descricaoCurta ? `<span class="cart__item-desc">${p.descricaoCurta}</span>` : "";
      const variacaoLinha = nomeBits ? `<span class="cart__item-details">${nomeBits}</span>` : "";
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
        </div>
        <div class="cart__item-actions">
          <strong class="cart__item-price">${formatBRL(p.preco)}</strong>
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

  const totalProdutos = carrinho.reduce((a,b)=>a+b.preco,0);
  const totalComFrete = totalProdutos + (entregaDisponivel ? (freteAtual || 0) : 0);

  const subtotalEl = el("#cartSubtotal");
  const freteEl = el("#cartFrete");
  if (subtotalEl) subtotalEl.textContent = formatBRL(totalProdutos);

  if (freteEl) {
    if (!entregaDisponivel) {
      freteEl.textContent = "Informe o CEP";
    } else if (freteModo === "sedex") {
      freteEl.textContent = "SEDEX (a calcular)";
    } else if (freteModo === "uber_free") {
      freteEl.textContent = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
    } else {
      freteEl.textContent = "Moto Uber (a calcular)";
    }
  }

  const totalLabel = entregaDisponivel
    ? (freteModo === "uber_free" ? formatBRL(totalComFrete) : `${formatBRL(totalComFrete)} + frete`)
    : formatBRL(totalComFrete);
  el("#cartTotal").textContent = totalLabel;

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=> removerCarrinho(+btn.getAttribute("data-del")));
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
if (backdrop && cart) backdrop.addEventListener("click", closeCart);
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

async function initCatalog(){
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
initCatalog();
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();
atualizarCart();
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

  if (city && uf && !isInMetroFortaleza(city, uf)) {
    freteModo = "sedex";
    if (freteMsg) freteMsg.textContent = "Entrega via SEDEX. Valor calculado no WhatsApp.";
    atualizarCart();
    return;
  }

  if (hasCoords) {
    const km = haversineKm(origin.lat, origin.lng, coords.lat, coords.lng);
    if (km <= DELIVERY_FREE_RADIUS_KM) {
      freteModo = "uber_free";
      if (freteMsg) freteMsg.textContent = `Entrega grátis (até ${DELIVERY_FREE_RADIUS_KM} km).`;
      atualizarCart();
      return;
    }
  }

  freteModo = "uber_pending";
  if (freteMsg) freteMsg.textContent = "Entrega via Moto Uber. Valor calculado no WhatsApp.";
  atualizarCart();
}

/* ------------------------------------------------------------
   Binds da UI de Frete (CEP/GPS)
------------------------------------------------------------ */
function bindFreteUIEvents() {
  const cepInput = el("#cepInput");
  const freteMsg = el("#freteMsg");
  const btnUseLocation = el("#btnUseLocation");

  if (cepInput && !cepInput._lemoovBound) {
    cepInput._lemoovBound = true;
    cepInput.addEventListener("input", () => {
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
  if (carrinho.length === 0) { alert("Seu carrinho está vazio."); return; }
  const cepInput = el("#cepInput");
  const cepValue = normalizeCEP(cepInput?.value || cepAtual || "");
  if (!cepValue || cepValue.length !== 8) {
    alert("Informe o CEP para calcular a entrega.");
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
          <div class="checkout__title">Finalizar no WhatsApp</div>
          <p class="checkout__muted checkout__subtitle">
            Coletamos os dados essenciais e abrimos a conversa para concluir tudo por lá.
          </p>
        </div>
        <button class="btn btn--ghost" id="btnCloseCheckout">Fechar</button>
      </div>
      <form id="checkoutForm">
        <div class="checkout__body">
          <div class="checkout__summary">
            <strong>Resumo do pedido</strong>
            <p class="checkout__muted" style="margin:4px 0 0;">
              Revise abaixo. O próximo passo já abre o WhatsApp.
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

          <div class="checkout__grid">
            <div class="checkout__step" id="checkoutStepCep">
              <div class="full">
                <strong>Entrega via Moto Uber</strong>
                <p class="checkout__muted" style="margin:4px 0 0;">
                  Informe o endereço completo. O valor é calculado no WhatsApp.
                </p>
              </div>
              <div>
                <label class="checkout__label">CEP (opcional)</label>
                <div class="checkout__row checkout__row--stack">
                  <input name="cep" class="checkout__input" id="ckCep"
                    placeholder="00000-000" inputmode="numeric" autocomplete="postal-code">
                  <button type="button" class="btn btn--ghost checkout__cepBtn" id="btnLocateCep">Usar CEP do cálculo</button>
                </div>
                <p class="checkout__link">Não sabe CEP? <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Consultar nos Correios</a></p>
                <p class="checkout__status" id="checkoutCepMsg" data-status="info">CEP ajuda a confirmar a entrega.</p>
              </div>
              <div>
                <label class="checkout__label">Rua *</label>
                <input required name="rua" class="checkout__input" id="ckRua"
                  autocomplete="address-line1" placeholder="Rua e complemento">
              </div>
              <div>
                <label class="checkout__label">Número *</label>
                <input required name="numero" class="checkout__input" id="ckNumero"
                  inputmode="numeric" autocomplete="address-line2" placeholder="Ex.: 123">
              </div>
              <div>
                <label class="checkout__label">Bairro *</label>
                <input required name="bairro" class="checkout__input" id="ckBairro"
                  autocomplete="address-level3" placeholder="Ex.: Centro">
              </div>
              <div>
                <label class="checkout__label">Cidade *</label>
                <input required name="cidade" class="checkout__input" id="ckCidade"
                  autocomplete="address-level2" placeholder="Cidade">
              </div>
              <div>
                <label class="checkout__label">UF *</label>
                <input required name="uf" class="checkout__input" id="ckUF" maxlength="2"
                  autocomplete="address-level1" placeholder="Ex.: CE">
              </div>
              <div class="full">
                <label class="checkout__label">Complemento (opcional)</label>
                <input name="complemento" class="checkout__input" id="ckCompl"
                  placeholder="Casa, bloco, ponto de referência" autocomplete="address-line3">
              </div>
            </div>

            <div class="checkout__step" id="checkoutStepCliente" aria-hidden="false">
              <div class="full">
                <strong>Dados do cliente</strong>
                <p class="checkout__muted" style="margin:4px 0 0;">
                  Informe como deseja ser identificado.
                </p>
              </div>
              <div>
                <label class="checkout__label">Nome completo *</label>
                <input required name="nome" class="checkout__input" autocomplete="name"
                  placeholder="Ex.: Carla Souza">
              </div>
              <div>
                <label class="checkout__label">Data de nascimento *</label>
                <input required type="text" name="nascimento" class="checkout__input" id="ckNascimento"
                  inputmode="numeric" autocomplete="bday" placeholder="DD/MM/AAAA" maxlength="10">
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
                <strong>Pagamento</strong>
                <p class="checkout__muted" style="margin:4px 0 0;">
                  Escolha como prefere pagar. Finalizamos pelo WhatsApp.
                </p>
              </div>
              <div class="full checkout__radio">
                <label><input type="radio" name="pagamento" value="pix" checked> PIX</label>
                <label><input type="radio" name="pagamento" value="cartao"> Cartão</label>
              </div>
            </div>
          </div>
        </div>

        <div class="checkout__footer">
          <button type="button" class="btn btn--ghost" id="btnCancelarCheckout">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btnEnviarPedido">Enviar</button>
        </div>
      </form>
    `;
    const ckCep = dlg.querySelector("#ckCep");
    if (ckCep){
      ckCep.required = true;
      ckCep.placeholder = "00000-000";
    }
document.body.appendChild(dlg);

    // Binds do modal
    dlg.querySelector("#btnCloseCheckout").addEventListener("click", closeCheckoutModal);
    dlg.querySelector("#btnCancelarCheckout").addEventListener("click", closeCheckoutModal);

    // CEP do checkout: normaliza + auto-preenche endereço
    const cepMsg = dlg.querySelector("#checkoutCepMsg");
    const setCepStatus = (text, status = "info") => {
      if (!cepMsg) return;
      cepMsg.textContent = text;
      cepMsg.dataset.status = status;
    };
    const fillAddressByCep = async (raw) => {
      setCepStatus("Consultando CEP…", "loading");
      const addr = await getAddressByCEP(raw);
      if (addr) {
        el("#ckRua").value = addr.rua || "";
        el("#ckBairro").value = addr.bairro || "";
        el("#ckCidade").value = addr.cidade || "";
        el("#ckUF").value = addr.uf || "";
        setCepStatus("Endereço carregado automaticamente. Confira os dados.", "ok");
      } else {
        setCepStatus("Não encontramos este CEP. Preencha manualmente os campos abaixo.", "warn");
      }
    };
    const handleCepInput = async () => {
      const raw = normalizeCEP(ckCep.value);
      ckCep.value = formatCEPForInput(raw);
      if (raw.length === 8) {
        await fillAddressByCep(raw);
        setCepStatus("CEP ok. Confira o endereço abaixo.", "ok");
      } else if (!raw) {
        setCepStatus("Digite o CEP completo para continuar.", "warn");
      } else {
        setCepStatus("CEP incompleto. Digite 8 números.", "warn");
      }
    };
    ckCep.addEventListener("input", handleCepInput);
    ckCep.addEventListener("blur", handleCepInput);
    const locateCepBtn = dlg.querySelector("#btnLocateCep");
    if (locateCepBtn){
      locateCepBtn.disabled = !((enderecoAutofill?.cep && enderecoAutofill.cep.length === 8) || (cepAtual && cepAtual.length === 8));
      locateCepBtn.addEventListener("click", () => {
        const cepToUse = (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8)
          ? enderecoAutofill.cep
          : (cepAtual && cepAtual.length === 8 ? cepAtual : "");
        if (!cepToUse) {
          alert("Calcule o frete ou informe o CEP manualmente.");
          return;
        }
        ckCep.value = formatCEPForInput(cepToUse);
        handleCepInput();
      });
    }
    handleCepInput();

    const telefoneInput = dlg.querySelector('input[name="telefone"]');
    if (telefoneInput && !telefoneInput._lemoovMask) {
      telefoneInput._lemoovMask = true;
      telefoneInput.addEventListener("input", () => {
        telefoneInput.value = formatPhoneForInput(telefoneInput.value);
      });
      telefoneInput.value = formatPhoneForInput(telefoneInput.value);
    }

    const nascimentoInput = dlg.querySelector("#ckNascimento");
    if (nascimentoInput && !nascimentoInput._lemoovMask) {
      nascimentoInput._lemoovMask = true;
      nascimentoInput.addEventListener("input", () => {
        nascimentoInput.value = formatBirthForInput(nascimentoInput.value);
      });
      nascimentoInput.value = formatBirthForInput(nascimentoInput.value);
    }

    dlg.querySelector("#checkoutForm").addEventListener("submit", handleSubmitCheckout);
  }
  const previewOrder = peekNextOrderNumber();
  const pedidoEl = el("#ckPedido");
  if (pedidoEl) pedidoEl.textContent = previewOrder || "—";

  // Preencher resumo
  const itemsDiv = el("#checkoutItems");
  const subtotal = carrinho.reduce((a,b)=>a+b.preco,0);
  const total = subtotal + (entregaDisponivel ? (freteAtual||0) : 0);
  itemsDiv.innerHTML = carrinho.map((p,i)=>{
    const det = [
      p.nome,
      p.corSelecionada ? `(Cor: ${p.corSelecionada})` : "",
      p.tamanhoSelecionado ? `(Tam: ${p.tamanhoSelecionado})` : ""
    ].filter(Boolean).join(" ");
    return `${i+1}. ${det} — ${formatBRL(p.preco)}`;
  }).join("<br>");

  el("#ckSubtotal").textContent = formatBRL(subtotal);
  let freteResumo = "Informe o CEP";
  if (entregaDisponivel) {
    if (freteModo === "sedex") freteResumo = "SEDEX (a calcular)";
    else if (freteModo === "uber_free") freteResumo = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
    else freteResumo = "Moto Uber (a calcular)";
  }
  el("#ckFrete").textContent = freteResumo;
  const freteVia = el("#ckFreteVia");
  if (freteVia) freteVia.textContent = "";
  let totalLabel = formatBRL(total);
  if (entregaDisponivel) {
    totalLabel = freteModo === "uber_free" ? formatBRL(total) : `${formatBRL(total)} + frete`;
  }
  el("#ckTotal").textContent = totalLabel;
  const freteNote = el("#checkoutFreteNote");
  if (freteNote) {
    if (freteModo === "sedex") {
      freteNote.textContent = "Entrega via SEDEX. Valor calculado no WhatsApp.";
      freteNote.style.display = "";
    } else if (freteModo === "uber_pending") {
      freteNote.textContent = "Entrega via Moto Uber. Valor calculado no WhatsApp.";
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
  const cepParaUsar = (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8)
    ? enderecoAutofill.cep
    : (cepAtual && cepAtual.length === 8 ? cepAtual : "");
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
    const hasCep = Boolean(
      (enderecoAutofill?.cep && enderecoAutofill.cep.length === 8) ||
      (cepAtual && cepAtual.length === 8)
    );
    locateBtnGlobal.disabled = !hasCep;
  }

  const checkoutItemsPayload = carrinho.map(p => ({
    item_name: p.nome,
    item_category: p.categoria,
    price: p.preco
  }));
  trackEvent("start_checkout", {
    currency: "BRL",
    value: total,
    items: checkoutItemsPayload,
    item_count: checkoutItemsPayload.length
  });
  rememberCheckoutScroll();
  dlg.showModal();
}

// Monta a mensagem do WhatsApp
function buildWhatsMessage(data, options = {}) {
  const { cliente, endereco, pagamento } = data;
  const numeroPedido = options.numeroPedido || ultimoNumeroPedido || null;

  const itemsMap = new Map();
  for (const p of carrinho){
    const key = [p.nome, p.corSelecionada||"", p.tamanhoSelecionado||""].join("|");
    const curr = itemsMap.get(key) || {
      qtd: 0,
      nome: p.nome,
      cor: p.corSelecionada,
      tam: p.tamanhoSelecionado,
      precoUnit: p.preco
    };
    curr.qtd += 1;
    itemsMap.set(key, curr);
  }
  const itensArr = Array.from(itemsMap.values()).map((obj,i)=>{
    const det = [obj.nome, obj.cor ? `Cor: ${obj.cor}` : "", obj.tam ? `Tam: ${obj.tam}` : ""].filter(Boolean).join(" | ");
    return `${i+1}) ${obj.qtd}× ${det} — ${formatBRL(obj.precoUnit)}`;
  });

  const subtotal = carrinho.reduce((a,b)=>a+b.preco,0);
  const total = subtotal + (entregaDisponivel ? (freteAtual||0) : 0);
  const viaCEP = (typeof cepAtual === "string" && cepAtual.length === 8);
  let freteInfo = "";
  if (entregaDisponivel && viaCEP) {
    freteInfo = ` (CEP ${formatCEPForInput(cepAtual)})`;
  }

  const linhas = [];
  linhas.push("📝 *Pedido Lemoov*");
  if (numeroPedido) linhas.push(`Pedido nº ${numeroPedido}`);
  linhas.push(`Cliente: ${cliente.nome || "-"}`);
  if (cliente.nascimento) linhas.push(`Nascimento: ${cliente.nascimento}`);
  if (cliente.telefone) linhas.push(`Telefone: ${cliente.telefone}`);
  if (cliente.email) linhas.push(`E-mail: ${cliente.email}`);

  linhas.push("");
  linhas.push("*Endereço*");
  linhas.push(`Rua: ${endereco.rua || "-"}, ${endereco.numero || "-"}`);
  if (endereco.complemento) linhas.push(`Compl.: ${endereco.complemento}`);
  linhas.push(`Cidade/UF: ${endereco.cidade || "-"} / ${endereco.uf || "-"}`);
  if (endereco.cep) linhas.push(`CEP: ${formatCEPForInput(endereco.cep)}`);

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
  let freteLabel = "A calcular";
  if (entregaDisponivel) {
    if (freteModo === "sedex") freteLabel = `Entrega via SEDEX. Valor calculado no WhatsApp.${freteInfo}`;
    else if (freteModo === "uber_free") freteLabel = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)${freteInfo}`;
    else freteLabel = `Entrega via Moto Uber. Valor calculado no WhatsApp.${freteInfo}`;
  }
  linhas.push(`Frete: ${freteLabel}`);
  const totalLabel = entregaDisponivel
    ? (freteModo === "uber_free" ? formatBRL(total) : `${formatBRL(total)} + frete`)
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

async function savePedido(payload){
  try {
    await fetch(`${API_BASE}/api/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (_e) {}
}

async function handleSubmitCheckout(ev){
  ev.preventDefault();
  const form = ev.currentTarget;
  const btn = el("#btnEnviarPedido");
  const subtotalCompra = carrinho.reduce((a,b)=>a+b.preco,0);
  const totalCompra = subtotalCompra + (entregaDisponivel ? (freteAtual||0) : 0);
  const purchaseItems = carrinho.map(p => ({
    item_name: p.nome,
    item_category: p.categoria,
    price: p.preco,
    quantity: 1
  }));
  if (btn) {
    btn.disabled = true; btn.textContent = "Montando mensagem…";
  }

  try {
    const fdUI = new FormData(form);
    const cliente = {
      nome: (fdUI.get("nome") || "").toString().trim(),
      nascimento: (fdUI.get("nascimento") || "").toString(),
      telefone: formatPhoneForInput((fdUI.get("telefone") || "").toString()),
      email: (fdUI.get("email") || "").toString().trim(),
    };
    const endereco = {
      cep: normalizeCEP((fdUI.get("cep") || "").toString()),
      rua: (fdUI.get("rua") || "").toString().trim(),
      numero: (fdUI.get("numero") || "").toString().trim(),
      bairro: (fdUI.get("bairro") || "").toString().trim(),
      cidade: (fdUI.get("cidade") || "").toString().trim(),
      uf: (fdUI.get("uf") || "").toString().trim(),
      complemento: (fdUI.get("complemento") || "").toString().trim()
    };
    const pagamento = (fdUI.get("pagamento") || "pix").toString();

    const faltantes = [];
    if (!cliente.nome) faltantes.push("nome completo");
    if (!cliente.nascimento || !/^\d{2}\/\d{2}\/\d{4}$/.test(cliente.nascimento)) {
      faltantes.push("data de nascimento (DD/MM/AAAA)");
    }
    if (!cliente.telefone) faltantes.push("telefone/WhatsApp");
    if (!endereco.rua) faltantes.push("rua");
    if (!endereco.numero) faltantes.push("número");
    if (!endereco.bairro) faltantes.push("bairro");
    if (!endereco.cidade) faltantes.push("cidade");
    if (!endereco.uf) faltantes.push("UF");
    if (!pagamento) faltantes.push("forma de pagamento");
    if (!endereco.cep || endereco.cep.length !== 8) faltantes.push("CEP válido");
    if (faltantes.length) {
      throw new Error("Preencha: " + faltantes.join(", ") + ".");
    }

    const numeroPedido = getNextOrderNumber();
    ultimoNumeroPedido = numeroPedido;
    const pedidoEl = el("#ckPedido");
    if (pedidoEl) pedidoEl.textContent = numeroPedido;
    const mensagem = buildWhatsMessage({ cliente, endereco, pagamento }, { numeroPedido });
    const visitorRegion = getVisitorRegion();
    trackEvent("purchase", {
      currency: "BRL",
      value: totalCompra,
      transaction_id: numeroPedido,
      items: purchaseItems,
      item_count: purchaseItems.length
    });
    trackEvent("purchase_whatsapp", {
      currency: "BRL",
      value: totalCompra,
      transaction_id: numeroPedido,
      item_count: purchaseItems.length,
      city: endereco.cidade || visitorRegion?.city || "",
      region: endereco.uf || visitorRegion?.region || "",
      country: visitorRegion?.country || "Brasil",
      cep: endereco.cep || "",
      frete_modo: freteModo || ""
    });
    savePedido({
      pedido: numeroPedido,
      total: totalCompra,
      currency: "BRL",
      item_count: purchaseItems.length,
      itens: purchaseItems,
      frete_modo: freteModo || "",
      cep: endereco.cep || "",
      cidade: endereco.cidade || "",
      uf: endereco.uf || "",
      visitor_city: visitorRegion?.city || "",
      visitor_region: visitorRegion?.region || "",
      visitor_country: visitorRegion?.country || "",
      pagamento: pagamento || "",
      origem_cep: ORIGIN_CEP
    });
    openWhatsAppWithMessage(mensagem);

    // Limpa carrinho e interfaces abertas
    carrinho = [];
    atualizarCart();

    const dlg = el("#checkoutModal");
    if (dlg) {
      const formEl = dlg.querySelector("#checkoutForm");
      if (formEl) formEl.reset();
      ["ckRua","ckNumero","ckBairro","ckCidade","ckUF","ckCompl","ckCep"].forEach(id => {
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
    alert(err?.message || "Não foi possível preparar seu pedido. Tente novamente.");
  } finally {
    if (btn) {
      btn.disabled = false; btn.textContent = "Enviar";
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
    if (freteModo === "sedex" && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = "SEDEX (a calcular)";
    } else if (freteModo === "uber_free" && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = `Grátis (até ${DELIVERY_FREE_RADIUS_KM} km)`;
    } else if (freteModo === "uber_pending" && val) {
      if (lbl) lbl.textContent = "Frete:";
      val.textContent = "Moto Uber (a calcular)";
    } else if (typeof freteAtual === "number" && isFinite(freteAtual) && freteAtual > 0){
      if (lbl) lbl.textContent = "Frete:";
      if (val) val.textContent = formatBRL(freteAtual);
    }
  }catch(e){}
}
