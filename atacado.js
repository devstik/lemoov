/* Catálogo de Atacado — independente do script.js do varejo.
   Sem checkout: monta um carrinho local e envia o pedido pro WhatsApp como texto. */
(function () {
  const WHATS_NUMBER = "558587408457";
  const CART_STORAGE_KEY = "lemoov_atacado_cart_v1";
  const el = (sel, ctx) => (ctx || document).querySelector(sel);
  const els = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const formatBRL = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  let produtos = [];
  let buscaAtual = "";
  let modalProduto = null;
  let modalCorIndex = 0;
  let modalMediaIndex = 0;
  let lightboxOpen = false;
  let cart = loadCart();

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }
  function saveCart() {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (_e) {}
  }

  async function loadAtacado() {
    try {
      const res = await fetch("/api/atacado");
      produtos = res.ok ? await res.json() : [];
    } catch (_e) {
      produtos = [];
    }
    if (!Array.isArray(produtos)) produtos = [];
    renderGrid();
    renderCart();
  }

  function getCoresAtivas(p) {
    return Array.isArray(p.cores) ? p.cores.filter((c) => c.ativo !== false) : [];
  }
  function resolvePath(src) {
    if (!src) return "";
    return src.startsWith("http") ? src : "/" + src;
  }
  function getImagemProduto(p, corIndex = 0) {
    const cores = getCoresAtivas(p);
    const c = cores[corIndex] || cores[0];
    const img = c?.imagens?.[0] || c?.imagem || "";
    return resolvePath(img);
  }
  function getImagemAbsoluta(p, corIndex = 0) {
    const src = getImagemProduto(p, corIndex);
    if (!src) return "";
    return src.startsWith("http") ? src : `${location.origin}${src}`;
  }
  // Fotos da cor selecionada + vídeo do produto (se houver), na ordem em que aparecem na galeria.
  function getMediaList(p, corIndex = 0) {
    const cores = getCoresAtivas(p);
    const c = cores[corIndex] || cores[0];
    const imagens = Array.isArray(c?.imagens) && c.imagens.length ? c.imagens : [c?.imagem].filter(Boolean);
    const media = imagens.filter(Boolean).map((src) => ({ type: "image", src: resolvePath(src) }));
    if (p.video) media.push({ type: "video", src: resolvePath(p.video) });
    return media;
  }

  function matchesSearch(p, termo) {
    const alvo = [p.nome, p.categoria, ...(p.cores || []).map((c) => c.nome)]
      .filter(Boolean).join(" ").toLowerCase();
    return alvo.includes(termo.toLowerCase());
  }

  function clampQty(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function wireQtyStepper(root) {
    const wrap = el("[data-qty]", root);
    if (!wrap) return { get: () => 1, set: () => {} };
    const input = el("[data-qty-input]", wrap);
    const dec = el("[data-qty-dec]", wrap);
    const inc = el("[data-qty-inc]", wrap);
    const set = (v) => { input.value = clampQty(v); };
    dec.addEventListener("click", () => set(clampQty(input.value) - 1));
    inc.addEventListener("click", () => set(clampQty(input.value) + 1));
    input.addEventListener("change", () => set(input.value));
    return { get: () => clampQty(input.value), set };
  }

  // ── Grid ─────────────────────────────────────────────────────
  function renderGrid() {
    const grid = el("#atacadoGrid");
    if (!grid) return;
    let lista = produtos;
    if (buscaAtual.trim()) lista = lista.filter((p) => matchesSearch(p, buscaAtual.trim()));

    const meta = el("#atacadoSearchMeta");
    if (meta) meta.textContent = lista.length ? `${lista.length} produto${lista.length > 1 ? "s" : ""}` : "";

    if (!lista.length) {
      grid.innerHTML = `<div class="atacado-empty">${
        buscaAtual.trim() ? "Nenhum produto encontrado para essa busca." : "Nenhum produto disponível no momento."
      }</div>`;
      return;
    }

    grid.innerHTML = lista.map((p, i) => {
      const img = getImagemProduto(p, 0);
      const cores = getCoresAtivas(p);
      const media = getMediaList(p, 0);
      const photoCount = media.filter((m) => m.type === "image").length;
      const hasVideo = media.some((m) => m.type === "video");
      const hintParts = [];
      if (photoCount > 1) hintParts.push(`<i class="fas fa-images" aria-hidden="true"></i> ${photoCount}`);
      if (hasVideo) hintParts.push(`<i class="fas fa-video" aria-hidden="true"></i>`);
      const precoHtml = p.preco
        ? `<span class="atacado-card__price">${formatBRL(p.preco)}</span>`
        : `<span class="atacado-card__price atacado-card__price--consult">Sob consulta</span>`;
      return `
        <article class="atacado-card" data-index="${i}">
          <div class="atacado-card__media">
            ${img ? `<img src="${escapeHTML(img)}" alt="${escapeHTML(p.nome)}" loading="lazy" decoding="async">`
                  : `<div class="atacado-card__noimg">Sem foto</div>`}
            ${hintParts.length ? `<span class="atacado-card__hint">${hintParts.join(" ")}</span>` : ""}
          </div>
          <div class="atacado-card__info">
            <h3 class="atacado-card__name">${escapeHTML(p.nome)}</h3>
            ${precoHtml}
            ${cores.length ? `<div class="atacado-card__swatches">${cores.slice(0, 6).map((c) =>
              `<span class="atacado-swatch" style="--sw:${escapeHTML(c.swatch || "#e6e6e6")}" title="${escapeHTML(c.nome || "")}"></span>`
            ).join("")}</div>` : ""}
          </div>
          <div class="atacado-card__actions">
            <div class="atacado-qty" data-qty>
              <button type="button" class="atacado-qty__btn" data-qty-dec aria-label="Diminuir quantidade">−</button>
              <input type="number" class="atacado-qty__input" data-qty-input value="1" min="1" inputmode="numeric" />
              <button type="button" class="atacado-qty__btn" data-qty-inc aria-label="Aumentar quantidade">+</button>
            </div>
            <button type="button" class="atacado-card__add" data-add>
              <i class="fas fa-cart-plus" aria-hidden="true"></i> Adicionar
            </button>
          </div>
        </article>`;
    }).join("");

    els(".atacado-card", grid).forEach((card) => {
      const p = lista[Number(card.dataset.index)];
      card.querySelector(".atacado-card__media")?.addEventListener("click", () => openModal(p));
      card.querySelector(".atacado-card__name")?.addEventListener("click", () => openModal(p));
      const qty = wireQtyStepper(card);
      const addBtn = card.querySelector("[data-add]");
      addBtn?.addEventListener("click", () => {
        addToCart(p, 0, qty.get());
        qty.set(1);
        flashAdded(addBtn);
      });
    });
  }

  function flashAdded(btn) {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.dataset.added = "true";
    btn.innerHTML = `<i class="fas fa-check" aria-hidden="true"></i> Adicionado`;
    setTimeout(() => { btn.dataset.added = "false"; btn.innerHTML = original; }, 1200);
  }

  // ── Modal de produto ─────────────────────────────────────────
  function openModal(p) {
    modalProduto = p;
    modalCorIndex = 0;
    modalMediaIndex = 0;
    renderModal();
    const modal = el("#atacadoModal");
    if (modal && typeof modal.showModal === "function") modal.showModal();
  }
  function closeModal() {
    const modal = el("#atacadoModal");
    if (modal && typeof modal.close === "function") modal.close();
    modalProduto = null;
    if (lightboxOpen) closeLightbox();
  }
  function renderModal() {
    if (!modalProduto) return;
    const p = modalProduto;
    const cores = getCoresAtivas(p);

    el("#atacadoModalNome").textContent = p.nome;
    el("#atacadoModalDesc").textContent = p.descricao || "";
    el("#atacadoModalPreco").textContent = p.preco ? formatBRL(p.preco) : "Preço sob consulta";
    renderGallery();

    const colorsWrap = el("#atacadoModalColors");
    colorsWrap.innerHTML = cores.map((c, idx) =>
      `<li><button type="button" class="atacado-swatch-btn" data-idx="${idx}" data-selected="${idx === modalCorIndex}" title="${escapeHTML(c.nome || "")}">
        <span class="atacado-swatch" style="--sw:${escapeHTML(c.swatch || "#e6e6e6")}"></span>
      </button></li>`
    ).join("");
    els("[data-idx]", colorsWrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        modalCorIndex = Number(btn.dataset.idx);
        modalMediaIndex = 0;
        renderGallery();
      });
    });

    const qty = wireQtyStepper(el("#atacadoModal"));
    const addBtn = el("#atacadoModalAdd");
    addBtn.onclick = () => {
      addToCart(p, modalCorIndex, qty.get());
      qty.set(1);
      flashAdded(addBtn);
    };
  }

  // ── Galeria (fotos + vídeo, com navegação e zoom) ────────────
  function currentMediaList() {
    return modalProduto ? getMediaList(modalProduto, modalCorIndex) : [];
  }
  function mediaMarkup(item, alt) {
    if (!item) return "";
    return item.type === "video"
      ? `<video src="${escapeHTML(item.src)}" controls playsinline></video>`
      : `<img src="${escapeHTML(item.src)}" alt="${escapeHTML(alt)}" />`;
  }
  function renderGallery() {
    const media = currentMediaList();
    if (modalMediaIndex >= media.length) modalMediaIndex = 0;
    const stage = el("#atacadoGalleryStage");
    const dots = el("#atacadoGalleryDots");
    const prevBtn = el("#atacadoGalleryPrev");
    const nextBtn = el("#atacadoGalleryNext");
    const item = media[modalMediaIndex];

    stage.innerHTML = mediaMarkup(item, modalProduto?.nome || "");
    if (item?.type === "image") {
      stage.style.cursor = "zoom-in";
      stage.onclick = () => openLightbox();
    } else {
      stage.style.cursor = "default";
      stage.onclick = null;
    }

    const multi = media.length > 1;
    prevBtn.hidden = !multi;
    nextBtn.hidden = !multi;
    dots.innerHTML = multi ? media.map((_, idx) =>
      `<button type="button" class="atacado-gallery__dot" data-dot="${idx}" data-active="${idx === modalMediaIndex}" aria-label="Ir para mídia ${idx + 1}"></button>`
    ).join("") : "";
    els("[data-dot]", dots).forEach((btn) => {
      btn.addEventListener("click", () => { modalMediaIndex = Number(btn.dataset.dot); renderGallery(); });
    });

    if (lightboxOpen) renderLightbox();
  }
  function galleryStep(delta) {
    const media = currentMediaList();
    if (!media.length) return;
    modalMediaIndex = (modalMediaIndex + delta + media.length) % media.length;
    renderGallery();
  }

  function openLightbox() {
    lightboxOpen = true;
    el("#atacadoLightbox")?.classList.add("show");
    el("#atacadoModal")?.classList.add("lightbox-open");
    renderLightbox();
  }
  function closeLightbox() {
    lightboxOpen = false;
    el("#atacadoLightbox")?.classList.remove("show");
    el("#atacadoModal")?.classList.remove("lightbox-open");
  }
  function renderLightbox() {
    const media = currentMediaList();
    const item = media[modalMediaIndex];
    const stage = el("#atacadoLightboxStage");
    if (stage) stage.innerHTML = mediaMarkup(item, modalProduto?.nome || "");
    const multi = media.length > 1;
    el("#atacadoLightboxPrev").hidden = !multi;
    el("#atacadoLightboxNext").hidden = !multi;
  }

  // ── Carrinho ─────────────────────────────────────────────────
  function addToCart(p, corIndex, quantidade) {
    const cores = getCoresAtivas(p);
    const cor = cores[corIndex] || null;
    const key = `${p.id}::${corIndex}`;
    const existing = cart.find((item) => item.key === key);
    if (existing) {
      existing.qty += quantidade;
    } else {
      cart.push({
        key,
        productId: p.id,
        corIndex,
        nome: p.nome,
        corNome: cor?.nome || "",
        preco: p.preco || null,
        descricao: p.descricao || "",
        imagem: getImagemAbsoluta(p, corIndex),
        qty: quantidade
      });
    }
    saveCart();
    renderCart();
  }
  function removeFromCart(key) {
    cart = cart.filter((item) => item.key !== key);
    saveCart();
    renderCart();
  }
  function changeCartQty(key, delta) {
    const item = cart.find((i) => i.key === key);
    if (!item) return;
    item.qty = clampQty(item.qty + delta);
    saveCart();
    renderCart();
  }
  function cartTotal() {
    return cart.reduce((sum, item) => sum + (Number(item.preco) || 0) * item.qty, 0);
  }
  function cartCount() {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }

  function renderCart() {
    const countEl = el("#atacadoCartCount");
    if (countEl) countEl.textContent = String(cartCount());

    const list = el("#atacadoCartList");
    const whatsBtn = el("#atacadoCartWhats");
    if (!list) return;

    if (!cart.length) {
      list.innerHTML = `<li class="atacado-cart__empty">Seu carrinho está vazio.</li>`;
      if (whatsBtn) whatsBtn.disabled = true;
    } else {
      list.innerHTML = cart.map((item) => `
        <li class="atacado-cart__item" data-key="${escapeHTML(item.key)}">
          <div class="atacado-cart__item-media">
            ${item.imagem ? `<img src="${escapeHTML(item.imagem)}" alt="${escapeHTML(item.nome)}">` : ""}
          </div>
          <div>
            <p class="atacado-cart__item-name">${escapeHTML(item.nome)}</p>
            ${item.corNome ? `<p class="atacado-cart__item-color">Cor: ${escapeHTML(item.corNome)}</p>` : ""}
            <div class="atacado-cart__item-qty">
              <button type="button" class="atacado-qty__btn" data-cart-dec>−</button>
              <span>${item.qty}</span>
              <button type="button" class="atacado-qty__btn" data-cart-inc>+</button>
            </div>
          </div>
          <div class="atacado-cart__item-actions">
            <span class="atacado-cart__item-price">${item.preco ? formatBRL(item.preco * item.qty) : "Sob consulta"}</span>
            <button type="button" class="atacado-cart__remove" data-cart-remove>Remover</button>
          </div>
        </li>`).join("");
      if (whatsBtn) whatsBtn.disabled = false;
    }

    els(".atacado-cart__item", list).forEach((row) => {
      const key = row.dataset.key;
      row.querySelector("[data-cart-inc]")?.addEventListener("click", () => changeCartQty(key, 1));
      row.querySelector("[data-cart-dec]")?.addEventListener("click", () => changeCartQty(key, -1));
      row.querySelector("[data-cart-remove]")?.addEventListener("click", () => removeFromCart(key));
    });

    const totalEl = el("#atacadoCartTotal");
    if (totalEl) {
      const total = cartTotal();
      const temSobConsulta = cart.some((item) => !item.preco);
      totalEl.textContent = total > 0
        ? formatBRL(total) + (temSobConsulta ? " + itens sob consulta" : "")
        : "Sob consulta";
    }
  }

  function openCart() {
    el("#atacadoCart")?.classList.add("show");
    el("#atacadoCartBackdrop")?.classList.add("show");
  }
  function closeCart() {
    el("#atacadoCart")?.classList.remove("show");
    el("#atacadoCartBackdrop")?.classList.remove("show");
  }

  // Sem `includePhotoLinks`, cada item só entra com nome/cor/descrição/preço/qtd —
  // usado quando as fotos vão anexadas de verdade via compartilhamento nativo.
  function buildWhatsAppMessage({ includePhotoLinks = true } = {}) {
    const linhas = ["Olá! Gostaria de fazer um pedido de atacado:", ""];
    cart.forEach((item, idx) => {
      linhas.push(`${idx + 1}) ${item.nome}${item.corNome ? ` (cor: ${item.corNome})` : ""}`);
      if (includePhotoLinks && item.imagem) linhas.push(`Foto: ${item.imagem}`);
      if (item.descricao) linhas.push(`Descrição: ${item.descricao}`);
      linhas.push(`Preço unitário: ${item.preco ? formatBRL(item.preco) : "Sob consulta"}`);
      linhas.push(`Quantidade: ${item.qty}`);
      linhas.push("");
    });
    const total = cartTotal();
    if (total > 0) linhas.push(`Total estimado: ${formatBRL(total)}`);
    linhas.push(includePhotoLinks
      ? "Pode me passar as condições de atacado?"
      : "Fotos em anexo. Pode me passar as condições de atacado?");
    return linhas.join("\n");
  }

  function slugify(text) {
    return String(text || "produto")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "produto";
  }

  // Baixa as fotos do carrinho como File[] pra anexar de verdade no compartilhamento nativo.
  async function loadCartPhotosAsFiles() {
    const comFoto = cart.filter((item) => item.imagem);
    const arquivos = await Promise.all(comFoto.map(async (item, idx) => {
      try {
        const res = await fetch(item.imagem);
        if (!res.ok) return null;
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
        return new File([blob], `${slugify(item.nome)}-${idx + 1}.${ext}`, { type: blob.type || "image/jpeg" });
      } catch (_e) {
        return null;
      }
    }));
    return arquivos.filter(Boolean);
  }

  // Tenta abrir o menu nativo de compartilhar com as fotos anexadas de verdade (mobile).
  // Retorna true se conseguiu compartilhar (ou se o usuário cancelou de propósito),
  // false se o navegador não suporta — nesse caso cai no link de texto do WhatsApp.
  async function tryShareWithPhotos() {
    if (!navigator.share || !navigator.canShare) return false;
    try {
      const files = await loadCartPhotosAsFiles();
      if (!files.length || !navigator.canShare({ files })) return false;
      await navigator.share({ text: buildWhatsAppMessage({ includePhotoLinks: false }), files });
      return true;
    } catch (err) {
      return err && err.name === "AbortError" ? true : false;
    }
  }

  async function finalizarNoWhatsApp() {
    if (!cart.length) return;
    const btn = el("#atacadoCartWhats");
    if (btn) { btn.disabled = true; }
    const compartilhado = await tryShareWithPhotos();
    if (!compartilhado) {
      const texto = encodeURIComponent(buildWhatsAppMessage());
      window.open(`https://wa.me/${WHATS_NUMBER}?text=${texto}`, "_blank", "noopener");
    }
    if (btn) { btn.disabled = false; }
    cart = [];
    saveCart();
    renderCart();
    closeCart();
  }

  function bootstrap() {
    loadAtacado();
    const search = el("#atacadoSearch");
    search?.addEventListener("input", () => { buscaAtual = search.value || ""; renderGrid(); });
    el("#atacadoModalClose")?.addEventListener("click", closeModal);
    // Só fecha pelo botão ✕ — clique fora e tecla Esc não fecham o modal.
    el("#atacadoModal")?.addEventListener("cancel", (e) => e.preventDefault());
    el("#atacadoGalleryPrev")?.addEventListener("click", () => galleryStep(-1));
    el("#atacadoGalleryNext")?.addEventListener("click", () => galleryStep(1));

    el("#atacadoLightboxClose")?.addEventListener("click", closeLightbox);
    el("#atacadoLightbox")?.addEventListener("click", (e) => { if (e.target.id === "atacadoLightbox") closeLightbox(); });
    el("#atacadoLightboxPrev")?.addEventListener("click", () => galleryStep(-1));
    el("#atacadoLightboxNext")?.addEventListener("click", () => galleryStep(1));
    document.addEventListener("keydown", (e) => {
      if (!lightboxOpen) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") galleryStep(-1);
      else if (e.key === "ArrowRight") galleryStep(1);
    });

    el("#atacadoCartBtn")?.addEventListener("click", openCart);
    el("#atacadoCartClose")?.addEventListener("click", closeCart);
    el("#atacadoCartBackdrop")?.addEventListener("click", closeCart);
    el("#atacadoCartWhats")?.addEventListener("click", finalizarNoWhatsApp);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
