/* Catálogo de Atacado — independente do script.js do varejo.
   Sem carrinho/checkout: cada produto tem um CTA direto pro WhatsApp. */
(function () {
  const WHATS_NUMBER = "558587408457";
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

  async function loadAtacado() {
    const grid = el("#atacadoGrid");
    try {
      const res = await fetch("/api/atacado");
      produtos = res.ok ? await res.json() : [];
    } catch (_e) {
      produtos = [];
    }
    if (!Array.isArray(produtos)) produtos = [];
    renderGrid();
  }

  function getCoresAtivas(p) {
    return Array.isArray(p.cores) ? p.cores.filter((c) => c.ativo !== false) : [];
  }
  function getImagemProduto(p, corIndex = 0) {
    const cores = getCoresAtivas(p);
    const c = cores[corIndex] || cores[0];
    const img = c?.imagens?.[0] || c?.imagem || "";
    if (!img) return "";
    return img.startsWith("http") ? img : "/" + img;
  }
  function whatsLink(p, corNome) {
    const partes = [`Olá! Tenho interesse no atacado do produto *${p.nome}*`];
    if (corNome) partes.push(`(cor: ${corNome})`);
    partes.push("— pode me passar condições de atacado?");
    const texto = encodeURIComponent(partes.join(" "));
    return `https://wa.me/${WHATS_NUMBER}?text=${texto}`;
  }

  function matchesSearch(p, termo) {
    const alvo = [p.nome, p.categoria, ...(p.cores || []).map((c) => c.nome)]
      .filter(Boolean).join(" ").toLowerCase();
    return alvo.includes(termo.toLowerCase());
  }

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
      const precoHtml = p.preco
        ? `<span class="atacado-card__price">${formatBRL(p.preco)}</span>`
        : `<span class="atacado-card__price atacado-card__price--consult">Sob consulta</span>`;
      return `
        <article class="atacado-card" data-index="${i}">
          <div class="atacado-card__media">
            ${img ? `<img src="${escapeHTML(img)}" alt="${escapeHTML(p.nome)}" loading="lazy" decoding="async">`
                  : `<div class="atacado-card__noimg">Sem foto</div>`}
          </div>
          <div class="atacado-card__info">
            <h3 class="atacado-card__name">${escapeHTML(p.nome)}</h3>
            ${p.categoria ? `<p class="atacado-card__cat">${escapeHTML(p.categoria)}</p>` : ""}
            ${precoHtml}
            ${cores.length ? `<div class="atacado-card__swatches">${cores.slice(0, 6).map((c) =>
              `<span class="atacado-swatch" style="--sw:${escapeHTML(c.swatch || "#e6e6e6")}" title="${escapeHTML(c.nome || "")}"></span>`
            ).join("")}</div>` : ""}
          </div>
          <a class="atacado-card__whats" href="${whatsLink(p, cores[0]?.nome)}" target="_blank" rel="noopener">
            <i class="fab fa-whatsapp" aria-hidden="true"></i> Pedir no WhatsApp
          </a>
        </article>`;
    }).join("");

    els(".atacado-card", grid).forEach((card) => {
      card.querySelector(".atacado-card__media")?.addEventListener("click", () => openModal(lista[Number(card.dataset.index)]));
      card.querySelector(".atacado-card__name")?.addEventListener("click", () => openModal(lista[Number(card.dataset.index)]));
    });
  }

  function openModal(p) {
    modalProduto = p;
    modalCorIndex = 0;
    renderModal();
    const modal = el("#atacadoModal");
    if (modal && typeof modal.showModal === "function") modal.showModal();
  }
  function closeModal() {
    const modal = el("#atacadoModal");
    if (modal && typeof modal.close === "function") modal.close();
    modalProduto = null;
  }
  function renderModal() {
    if (!modalProduto) return;
    const p = modalProduto;
    const cores = getCoresAtivas(p);
    const corAtual = cores[modalCorIndex] || cores[0];

    el("#atacadoModalNome").textContent = p.nome;
    el("#atacadoModalDesc").textContent = p.descricao || "";
    el("#atacadoModalPreco").textContent = p.preco ? formatBRL(p.preco) : "Preço sob consulta";
    const img = el("#atacadoModalImg");
    const src = getImagemProduto(p, modalCorIndex);
    img.src = src || "";
    img.alt = p.nome;

    const colorsWrap = el("#atacadoModalColors");
    colorsWrap.innerHTML = cores.map((c, idx) =>
      `<li><button type="button" class="atacado-swatch-btn" data-idx="${idx}" data-selected="${idx === modalCorIndex}" title="${escapeHTML(c.nome || "")}">
        <span class="atacado-swatch" style="--sw:${escapeHTML(c.swatch || "#e6e6e6")}"></span>
      </button></li>`
    ).join("");
    els("[data-idx]", colorsWrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        modalCorIndex = Number(btn.dataset.idx);
        renderModal();
      });
    });

    const btnWhats = el("#atacadoModalWhats");
    btnWhats.href = whatsLink(p, corAtual?.nome);
  }

  function bootstrap() {
    loadAtacado();
    const search = el("#atacadoSearch");
    search?.addEventListener("input", () => { buscaAtual = search.value || ""; renderGrid(); });
    el("#atacadoModalClose")?.addEventListener("click", closeModal);
    el("#atacadoModal")?.addEventListener("click", (e) => { if (e.target.id === "atacadoModal") closeModal(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
