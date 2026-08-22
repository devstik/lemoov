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

  // Estado dos filtros/ordenação da área de produtos (mesmo padrão do catalogo-produtos.html)
  let filtroCategoriasAtivas = new Set();
  let filtroCoresAtivas = new Set();
  let filtroPrecoMin = null;
  let filtroPrecoMax = null;
  let ordenacaoAtual = "destaque";

  function normalizeColorKey(value) {
    return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // Transforma a descri\u00e7\u00e3o em texto livre do produto num bloco elegante: par\u00e1grafos de
  // introdu\u00e7\u00e3o normais, e uma se\u00e7\u00e3o "R\u00f3tulo:" seguida de linhas vira uma lista com marcadores.
  function formatAtacadoDesc(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const lines = raw.split(/\r?\n/).map((l) => l.trim());
    let html = "";
    let mode = "paragraph";
    let paraBuf = [];
    let listOpen = false;

    const closeParagraph = () => {
      if (paraBuf.length) {
        html += `<p>${escapeHTML(paraBuf.join(" "))}</p>`;
        paraBuf = [];
      }
    };
    const closeList = () => {
      if (listOpen) { html += "</ul>"; listOpen = false; }
    };

    lines.forEach((line) => {
      if (!line) { closeParagraph(); return; }
      const headingMatch = /^([A-Za-z\u00c0-\u00ff][^:]{1,38}):\s*$/.exec(line);
      if (headingMatch) {
        closeParagraph();
        closeList();
        html += `<span class="atacado-modal__detail-label">${escapeHTML(headingMatch[1])}</span>`;
        mode = "list";
        return;
      }
      if (mode === "list") {
        if (!listOpen) { html += `<ul class="atacado-modal__detail-list">`; listOpen = true; }
        html += `<li>${escapeHTML(line)}</li>`;
      } else {
        paraBuf.push(line);
      }
    });
    closeParagraph();
    closeList();
    return html || `<p>${escapeHTML(raw)}</p>`;
  }

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
    renderCatalogFilters();
    renderGrid();
    renderCart();
  }

  function getCoresAtivas(p) {
    return Array.isArray(p.cores) ? p.cores.filter((c) => c.ativo !== false) : [];
  }
  function resolvePath(src) {
    if (!src) return "";
    if (src.startsWith("http") || src.startsWith("/")) return src;
    return "/" + src;
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

  // ── Filtros da sidebar + ordenação (mesmo padrão do catalogo-produtos.html) ──
  function matchesSidebarFilters(p) {
    if (filtroCoresAtivas.size) {
      const cores = getCoresAtivas(p);
      const tem = cores.some((c) => filtroCoresAtivas.has(normalizeColorKey(c?.nome)));
      if (!tem) return false;
    }
    if ((filtroPrecoMin != null || filtroPrecoMax != null) && typeof p.preco === "number") {
      if (filtroPrecoMin != null && p.preco < filtroPrecoMin) return false;
      if (filtroPrecoMax != null && p.preco > filtroPrecoMax) return false;
    }
    return true;
  }

  function ordenar(lista) {
    const arr = [...lista];
    switch (ordenacaoAtual) {
      case "preco-asc": return arr.sort((a, b) => (Number(a.preco) || Infinity) - (Number(b.preco) || Infinity));
      case "preco-desc": return arr.sort((a, b) => (Number(b.preco) || -Infinity) - (Number(a.preco) || -Infinity));
      case "nome-az": return arr.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      case "nome-za": return arr.sort((a, b) => String(b.nome).localeCompare(String(a.nome), "pt-BR"));
      default: return arr;
    }
  }

  function updateSearchState(count) {
    const input = el("#atacadoSearch");
    const clearBtn = el("#atacadoSearchClear");
    const meta = el("#atacadoSearchMeta");
    const query = buscaAtual.trim();
    if (input && input.value !== buscaAtual) input.value = buscaAtual;
    if (clearBtn) clearBtn.dataset.visible = query ? "true" : "false";
    if (!meta) return;
    meta.textContent = query ? `${count} resultado${count === 1 ? "" : "s"} para "${query}"` : "";
  }

  function buildSwatchButton(cor, selected) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.title = cor?.nome || "";
    btn.setAttribute("aria-label", cor?.nome || "");
    btn.dataset.selected = selected ? "true" : "false";
    const dot = document.createElement("span");
    dot.className = "swatch__dot";
    dot.style.setProperty("--swatch-color", cor?.swatch || "#e6e6e6");
    btn.appendChild(dot);
    return btn;
  }

  // ── Sidebar de filtros ───────────────────────────────────────
  function renderFilterCategorias() {
    const wrap = el("#atacadoFilterCategorias");
    if (!wrap) return;
    const counts = {};
    produtos.forEach((p) => { if (p.categoria) counts[p.categoria] = (counts[p.categoria] || 0) + 1; });
    const categorias = Object.keys(counts).sort((a, b) => a.localeCompare(b, "pt-BR"));
    wrap.innerHTML = "";
    const allLabel = document.createElement("label");
    allLabel.innerHTML = `<input type="checkbox" data-cat-all ${filtroCategoriasAtivas.size ? "" : "checked"}> Todos os produtos <span class="catalog-filters__count">${produtos.length}</span>`;
    wrap.appendChild(allLabel);
    categorias.forEach((cat) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" data-cat="${escapeHTML(cat)}" ${filtroCategoriasAtivas.has(cat) ? "checked" : ""}> ${escapeHTML(cat)} <span class="catalog-filters__count">${counts[cat]}</span>`;
      wrap.appendChild(label);
    });
    wrap.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        const allInput = wrap.querySelector("input[data-cat-all]");
        if (input.hasAttribute("data-cat-all")) {
          wrap.querySelectorAll("input[data-cat]").forEach((i) => { i.checked = false; });
          filtroCategoriasAtivas = new Set();
        } else {
          const marcadas = Array.from(wrap.querySelectorAll("input[data-cat]:checked")).map((i) => i.dataset.cat);
          if (!marcadas.length) {
            allInput.checked = true;
            filtroCategoriasAtivas = new Set();
          } else {
            allInput.checked = false;
            filtroCategoriasAtivas = new Set(marcadas);
          }
        }
        renderGrid();
      });
    });
  }

  function renderFilterCores() {
    const wrap = el("#atacadoFilterCores");
    if (!wrap) return;
    const map = new Map();
    produtos.forEach((p) => getCoresAtivas(p).forEach((c) => {
      const key = normalizeColorKey(c?.nome);
      if (key && !map.has(key)) map.set(key, c);
    }));
    wrap.innerHTML = "";
    map.forEach((cor, key) => {
      const btn = buildSwatchButton(cor, filtroCoresAtivas.has(key));
      btn.addEventListener("click", () => {
        if (filtroCoresAtivas.has(key)) filtroCoresAtivas.delete(key); else filtroCoresAtivas.add(key);
        btn.dataset.selected = filtroCoresAtivas.has(key) ? "true" : "false";
        renderGrid();
      });
      wrap.appendChild(btn);
    });
  }

  function renderFilterPreco() {
    const precos = produtos.map((p) => Number(p.preco)).filter((v) => Number.isFinite(v) && v > 0);
    const min = precos.length ? Math.floor(Math.min(...precos)) : 0;
    const max = precos.length ? Math.ceil(Math.max(...precos)) : 0;
    const inputMin = el("#atacadoFilterPrecoMin");
    const inputMax = el("#atacadoFilterPrecoMax");
    const labelMin = el("#atacadoFilterPrecoMinLabel");
    const labelMax = el("#atacadoFilterPrecoMaxLabel");
    const fill = el("#atacadoFilterPrecoFill");
    if (!inputMin || !inputMax) return;
    const updateFill = () => {
      if (!fill) return;
      const range = (max - min) || 1;
      const leftPct = ((Number(inputMin.value) - min) / range) * 100;
      const rightPct = 100 - ((Number(inputMax.value) - min) / range) * 100;
      fill.style.left = `${leftPct}%`;
      fill.style.right = `${rightPct}%`;
    };
    inputMin.min = String(min); inputMax.min = String(min);
    inputMin.max = String(max); inputMax.max = String(max);
    inputMin.value = String(filtroPrecoMin ?? min);
    inputMax.value = String(filtroPrecoMax ?? max);
    if (labelMin) labelMin.textContent = formatBRL(inputMin.value);
    if (labelMax) labelMax.textContent = formatBRL(inputMax.value);
    updateFill();
    inputMin.oninput = () => {
      if (Number(inputMin.value) > Number(inputMax.value)) inputMin.value = inputMax.value;
      filtroPrecoMin = Number(inputMin.value);
      if (labelMin) labelMin.textContent = formatBRL(inputMin.value);
      updateFill();
      renderGrid();
    };
    inputMax.oninput = () => {
      if (Number(inputMax.value) < Number(inputMin.value)) inputMax.value = inputMin.value;
      filtroPrecoMax = Number(inputMax.value);
      if (labelMax) labelMax.textContent = formatBRL(inputMax.value);
      updateFill();
      renderGrid();
    };
  }

  function renderCatalogFilters() {
    renderFilterCategorias();
    renderFilterCores();
    renderFilterPreco();
  }

  function initCatalogFiltersDrawer() {
    const sidebar = el("#atacadoFilters");
    if (!sidebar) return;
    const backdrop = el("#atacadoFiltersBackdrop");
    const triggers = [el("#atacadoFiltersTrigger"), el("#bottomNavFilters")].filter(Boolean);
    const closeBtn = el("#atacadoFiltersClose");
    const clearBtn = el("#atacadoFiltersClear");

    function openDrawer() {
      sidebar.dataset.open = "true";
      if (backdrop) backdrop.dataset.open = "true";
      document.body.style.overflow = "hidden";
    }
    function closeDrawer() {
      sidebar.dataset.open = "false";
      if (backdrop) backdrop.dataset.open = "false";
      document.body.style.overflow = "";
    }
    triggers.forEach((t) => t.addEventListener("click", openDrawer));
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);
    if (clearBtn) clearBtn.addEventListener("click", () => {
      filtroCategoriasAtivas = new Set();
      filtroCoresAtivas = new Set();
      filtroPrecoMin = null;
      filtroPrecoMax = null;
      renderCatalogFilters();
      renderGrid();
    });
  }

  function initCatalogToolbar() {
    const sortSelect = el("#atacadoSort");
    if (!sortSelect) return;
    sortSelect.value = ordenacaoAtual;
    sortSelect.addEventListener("change", () => {
      ordenacaoAtual = sortSelect.value;
      renderGrid();
    });
  }

  // ── Grid ─────────────────────────────────────────────────────
  function renderGrid() {
    const grid = el("#atacadoGrid");
    if (!grid) return;

    let lista = produtos;
    if (filtroCategoriasAtivas.size) lista = lista.filter((p) => filtroCategoriasAtivas.has(p.categoria));
    if (buscaAtual.trim()) lista = lista.filter((p) => matchesSearch(p, buscaAtual.trim()));
    lista = lista.filter(matchesSidebarFilters);
    lista = ordenar(lista);

    updateSearchState(lista.length);
    const toolbarCount = el("#atacadoResultCount");
    if (toolbarCount) {
      toolbarCount.textContent = `${lista.length} produto${lista.length === 1 ? "" : "s"} encontrado${lista.length === 1 ? "" : "s"}`;
    }

    grid.innerHTML = "";

    if (!lista.length) {
      grid.innerHTML = `<div class="atacado-empty">${
        buscaAtual.trim() ? "Nenhum produto encontrado para essa busca." : "Nenhum produto disponível no momento."
      }</div>`;
      return;
    }

    lista.forEach((p) => {
      const article = document.createElement("article");
      article.className = "product-card";

      let selectedColorIndex = 0;
      const cores = getCoresAtivas(p);
      const img0 = getImagemProduto(p, 0);
      const precoHtml = p.preco
        ? `<span class="current-price">${formatBRL(p.preco)}</span>`
        : `<span class="price-consult">Sob consulta</span>`;

      article.innerHTML = `
        <div class="product-card__media" data-clickable="true">
          ${img0 ? `<img src="${escapeHTML(img0)}" alt="${escapeHTML(p.nome)}" loading="lazy" decoding="async">`
                : `<div class="atacado-card__noimg">Sem foto</div>`}
          <span class="product-card__photo-hint" data-photo-hint>Clique para ver mais fotos</span>
        </div>
        <div class="product-card__info">
          <h3 class="product-card__name" data-card-name>${escapeHTML(p.nome)}</h3>
          ${p.descricao ? `<p class="product-card__desc">${escapeHTML(p.descricao)}</p>` : ""}
          <div class="product-card__price">${precoHtml}</div>
          ${cores.length ? `
          <div class="product-card__options">
            <div class="product-card__colors">
              <span class="product-card__legend">Cores</span>
              <div class="swatches" data-options-colors></div>
            </div>
          </div>` : ""}
        </div>
        <div class="product-card__actions">
          <div class="atacado-qty" data-qty>
            <button type="button" class="atacado-qty__btn" data-qty-dec aria-label="Diminuir quantidade">−</button>
            <input type="number" class="atacado-qty__input" data-qty-input value="1" min="1" inputmode="numeric" />
            <button type="button" class="atacado-qty__btn" data-qty-inc aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="product-card__btn-add" data-add>
            <i class="fas fa-cart-plus" aria-hidden="true"></i> Adicionar
          </button>
        </div>`;

      const mediaFigure = article.querySelector(".product-card__media");
      const mainImg = mediaFigure.querySelector("img");
      const photoHint = article.querySelector("[data-photo-hint]");
      const nameEl = article.querySelector("[data-card-name]");
      const colorsWrap = article.querySelector("[data-options-colors]");

      function updatePhotoHint(colorIdx) {
        const media = getMediaList(p, colorIdx);
        const photoCount = media.filter((m) => m.type === "image").length;
        const show = photoCount > 1 || cores.length > 1;
        if (photoHint) photoHint.dataset.visible = show ? "true" : "false";
      }
      updatePhotoHint(0);

      const media0 = getMediaList(p, 0);
      if (media0.some((m) => m.type === "video")) {
        const vbtn = document.createElement("button");
        vbtn.type = "button";
        vbtn.className = "product-card__video-badge";
        vbtn.setAttribute("aria-label", "Ver vídeo do produto");
        mediaFigure.appendChild(vbtn);
        vbtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const media = getMediaList(p, selectedColorIndex);
          openModal(p, media.length - 1, selectedColorIndex);
        });
      }

      if (colorsWrap && cores.length) {
        cores.forEach((c, idx) => {
          const btn = buildSwatchButton(c, idx === 0);
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedColorIndex = idx;
            colorsWrap.querySelectorAll(".swatch").forEach((s) => { s.dataset.selected = "false"; });
            btn.dataset.selected = "true";
            const newImg = getImagemProduto(p, idx);
            if (mainImg && newImg) mainImg.src = newImg;
            updatePhotoHint(idx);
          });
          colorsWrap.appendChild(btn);
        });
      }

      mediaFigure.addEventListener("click", () => openModal(p, 0, selectedColorIndex));
      nameEl.addEventListener("click", () => openModal(p, 0, selectedColorIndex));

      const qty = wireQtyStepper(article);
      const addBtn = article.querySelector("[data-add]");
      addBtn.addEventListener("click", () => {
        addToCart(p, selectedColorIndex, qty.get());
        qty.set(1);
        flashAdded(addBtn);
      });

      grid.appendChild(article);
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
  function openModal(p, initialMediaIndex = 0, initialColorIndex = 0) {
    modalProduto = p;
    modalCorIndex = initialColorIndex;
    modalMediaIndex = initialMediaIndex;
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

    const eyebrow = el("#atacadoModalEyebrow");
    if (eyebrow) eyebrow.textContent = p.categoria || "Coleção Lemoov";
    el("#atacadoModalNome").textContent = p.nome;
    el("#atacadoModalDesc").innerHTML = formatAtacadoDesc(p.descricao);
    el("#atacadoModalPreco").textContent = p.preco ? formatBRL(p.preco) : "Preço sob consulta";
    renderGallery();

    const colorsSection = el("#atacadoModalColorsWrap");
    if (colorsSection) colorsSection.style.display = cores.length ? "" : "none";
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
    const bottomBadge = el("#atacadoBottomCartBadge");
    if (bottomBadge) {
      bottomBadge.textContent = String(cartCount());
      bottomBadge.dataset.count = String(cartCount());
    }

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

  // Mensagem de texto pura — usada só como último recurso, se a geração do PDF falhar.
  function buildWhatsAppMessage() {
    const linhas = ["Olá! Gostaria de fazer um pedido de atacado:", ""];
    cart.forEach((item, idx) => {
      linhas.push(`${idx + 1}) ${item.nome}${item.corNome ? ` (cor: ${item.corNome})` : ""}`);
      if (item.imagem) linhas.push(`Foto: ${item.imagem}`);
      if (item.descricao) linhas.push(`Descrição: ${item.descricao}`);
      linhas.push(`Preço unitário: ${item.preco ? formatBRL(item.preco) : "Sob consulta"}`);
      linhas.push(`Quantidade: ${item.qty}`);
      linhas.push("");
    });
    const total = cartTotal();
    if (total > 0) linhas.push(`Total estimado: ${formatBRL(total)}`);
    linhas.push("Pode me passar as condições de atacado?");
    return linhas.join("\n");
  }

  async function loadImageAsDataUrl(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (_e) {
      return null;
    }
  }
  function dataUrlImageFormat(dataUrl) {
    const match = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl || "");
    const ext = (match?.[1] || "jpeg").toLowerCase();
    if (ext === "png") return "PNG";
    if (ext === "webp") return "WEBP";
    return "JPEG";
  }

  // Monta um PDF com todos os itens do carrinho — foto, descrição, preço e quantidade —
  // pra funcionar bem com qualquer quantidade de itens (o WhatsApp só aceita 1 legenda por
  // envio, então várias fotos + texto separado se perdem; um único PDF resolve isso).
  async function buildOrderPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    const imgBox = 32;
    const rowGap = 6;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Pedido de Atacado — Lemoov Fitness", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, y);
    doc.setTextColor(30);
    y += 10;

    for (const item of cart) {
      const textX = margin + imgBox + 6;
      const textWidth = contentWidth - imgBox - 6;
      doc.setFontSize(11);
      const descLines = item.descricao ? doc.splitTextToSize(item.descricao, textWidth) : [];
      const blockHeight = Math.max(imgBox, 8 + descLines.length * 4.5 + 14) + rowGap;

      if (y + blockHeight > pageHeight - margin - 20) {
        doc.addPage();
        y = margin;
      }

      const topY = y;
      if (item.imagem) {
        const dataUrl = await loadImageAsDataUrl(item.imagem);
        if (dataUrl) {
          try { doc.addImage(dataUrl, dataUrlImageFormat(dataUrl), margin, topY, imgBox, imgBox, undefined, "FAST"); }
          catch (_e) {}
        }
      }
      doc.setDrawColor(225);
      doc.rect(margin, topY, imgBox, imgBox);

      let ty = topY + 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(item.nome, textX, ty);
      ty += 5.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      if (item.corNome) { doc.text(`Cor: ${item.corNome}`, textX, ty); ty += 4.5; }
      if (descLines.length) { doc.text(descLines, textX, ty); ty += descLines.length * 4.5; }
      doc.text(`Preço unitário: ${item.preco ? formatBRL(item.preco) : "Sob consulta"}`, textX, ty); ty += 4.5;
      doc.text(`Quantidade: ${item.qty}`, textX, ty); ty += 4.5;
      doc.setFont("helvetica", "bold");
      doc.text(`Subtotal: ${item.preco ? formatBRL(item.preco * item.qty) : "Sob consulta"}`, textX, ty);

      y = topY + blockHeight;
      doc.setDrawColor(220);
      doc.line(margin, y - rowGap / 2, pageWidth - margin, y - rowGap / 2);
    }

    if (y + 20 > pageHeight - margin) { doc.addPage(); y = margin; }
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const total = cartTotal();
    doc.text(`Total estimado: ${total > 0 ? formatBRL(total) : "Sob consulta"}`, margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Pode me passar as condições de atacado?", margin, y);

    return doc;
  }

  async function finalizarNoWhatsApp() {
    if (!cart.length) return;
    const btn = el("#atacadoCartWhats");
    if (btn) btn.disabled = true;
    const totalItens = cart.length;
    const resumo = `Olá! Segue em anexo meu pedido de atacado (${totalItens} ${totalItens > 1 ? "itens" : "item"}). Pode me passar as condições?`;
    try {
      const doc = await buildOrderPdf();
      const pdfFile = new File([doc.output("blob")], `pedido-atacado-${Date.now()}.pdf`, { type: "application/pdf" });

      let compartilhado = false;
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({ text: resumo, files: [pdfFile] });
          compartilhado = true;
        } catch (err) {
          compartilhado = Boolean(err && err.name === "AbortError");
        }
      }
      if (!compartilhado) {
        doc.save(pdfFile.name);
        const texto = encodeURIComponent(`${resumo}\n\nBaixei o PDF do pedido agora — é só anexar aqui no chat.`);
        window.open(`https://wa.me/${WHATS_NUMBER}?text=${texto}`, "_blank", "noopener");
      }
    } catch (_e) {
      const texto = encodeURIComponent(buildWhatsAppMessage());
      window.open(`https://wa.me/${WHATS_NUMBER}?text=${texto}`, "_blank", "noopener");
    } finally {
      if (btn) btn.disabled = false;
      cart = [];
      saveCart();
      renderCart();
      closeCart();
    }
  }

  // ── Gate de acesso (cadastro + confirmação por WhatsApp) ─────
  function showAtacadoMain() {
    el("#atacadoGate")?.remove();
    const main = el("#atacadoMain");
    if (main) {
      main.dataset.stage = "presentation";
      main.style.display = "block";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function showCatalog() {
    const main = el("#atacadoMain");
    if (!main) return;
    main.dataset.stage = "catalog";
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => el("#atacadoCatalogTitle")?.focus({ preventScroll: true }), 350);
  }
  function showPresentation() {
    const main = el("#atacadoMain");
    if (!main) return;
    main.dataset.stage = "presentation";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showGateError(msg) {
    const box = el("#atacadoGateError");
    if (!box) return;
    box.textContent = msg;
    box.classList.add("show");
  }
  function clearGateError() {
    el("#atacadoGateError")?.classList.remove("show");
  }
  function switchGateView(name) {
    ["Quick", "Register", "Code"].forEach((v) => {
      const view = el(`#gateView${v}`);
      if (view) view.hidden = v.toLowerCase() !== name;
    });
    clearGateError();
  }

  async function initGate() {
    try {
      const res = await fetch("/api/atacado/access/check");
      const data = res.ok ? await res.json() : { access: false };
      if (data.access) {
        showAtacadoMain();
        loadAtacado();
        return;
      }
    } catch (_e) {}
    wireGateForms();
  }

  function wireGateForms() {
    let pendingWhats = "";

    el("#gateGoRegister")?.addEventListener("click", () => {
      const typed = el("#gateQuickWhats")?.value || "";
      if (typed) el("#gateWhats").value = typed;
      switchGateView("register");
    });
    el("#gateBackToQuick")?.addEventListener("click", () => switchGateView("quick"));

    el("#gateFormQuick")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearGateError();
      const whatsapp = el("#gateQuickWhats").value;
      const btn = el("#gateQuickSubmit");
      btn.disabled = true;
      try {
        const res = await fetch("/api/atacado/access/check-phone", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whatsapp })
        });
        const data = await res.json();
        if (data.access) {
          showAtacadoMain();
          loadAtacado();
          return;
        }
        el("#gateWhats").value = whatsapp;
        switchGateView("register");
        showGateError("Esse WhatsApp ainda não está cadastrado. Complete seus dados abaixo.");
      } catch (_e) {
        showGateError("Falha ao verificar. Tente novamente.");
      } finally {
        btn.disabled = false;
      }
    });

    el("#gateFormRegister")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearGateError();
      const nome = el("#gateNome").value.trim();
      const whatsapp = el("#gateWhats").value;
      const cidade = el("#gateCidade").value.trim();
      const email = el("#gateEmail").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showGateError("Informe um e-mail válido.");
        return;
      }
      const btn = el("#gateRegisterSubmit");
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = "Cadastrando…";
      try {
        const res = await fetch("/api/atacado/access/register", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome, whatsapp, cidade, email })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showGateError(data.error || "Falha ao cadastrar.");
          return;
        }
        showAtacadoMain();
        loadAtacado();
      } catch (_e) {
        showGateError("Falha ao cadastrar. Tente novamente.");
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    el("#gateFormCode")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearGateError();
      const code = el("#gateCode").value.trim();
      const btn = el("#gateCodeSubmit");
      btn.disabled = true;
      try {
        const res = await fetch("/api/atacado/access/verify-code", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whatsapp: pendingWhats, code })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showGateError(data.error || "Código incorreto.");
          return;
        }
        showAtacadoMain();
        loadAtacado();
      } catch (_e) {
        showGateError("Falha ao confirmar código. Tente novamente.");
      } finally {
        btn.disabled = false;
      }
    });

    let resendCooldown = false;
    el("#gateResendCode")?.addEventListener("click", async () => {
      if (resendCooldown || !pendingWhats) return;
      resendCooldown = true;
      const link = el("#gateResendCode");
      link.textContent = "Reenviando…";
      try {
        const res = await fetch("/api/atacado/access/resend-code", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whatsapp: pendingWhats })
        });
        const data = await res.json();
        link.textContent = (res.ok && data.ok) ? "Código reenviado!" : "Falha ao reenviar";
      } catch (_e) {
        link.textContent = "Falha ao reenviar";
      }
      setTimeout(() => { link.textContent = "Reenviar código"; resendCooldown = false; }, 20000);
    });
  }

  function bootstrap() {
    initGate();
    initCatalogFiltersDrawer();
    initCatalogToolbar();
    const search = el("#atacadoSearch");
    search?.addEventListener("input", () => { buscaAtual = search.value || ""; renderGrid(); });
    el("#atacadoSearchClear")?.addEventListener("click", () => {
      buscaAtual = "";
      if (search) search.value = "";
      renderGrid();
      search?.focus();
    });
    el("#atacadoBreadcrumbHome")?.addEventListener("click", showPresentation);
    el("#bottomNavHome")?.addEventListener("click", showPresentation);
    el("#bottomNavCart")?.addEventListener("click", openCart);
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
    el("#atacadoOpenCatalog")?.addEventListener("click", showCatalog);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
