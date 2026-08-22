/* Caixa (PDV) — tela cheia estilo app. Lê código de barras (leitor funciona como
   teclado: digita o código + Enter), monta o carrinho, aplica desconto/forma de
   pagamento e finaliza a venda como pedido confirmado — reaproveitando o mesmo
   endpoint /api/admin/pedido usado pelo "Novo Pedido". Ao confirmar, mostra um QR
   de comprovante (gerado via /api/qrcode/generate) que aponta pra /recibo.html. */
(function () {
  const $ = (id) => document.getElementById(id);
  const els = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  let caixaCart = [];
  let caixaPending = null; // { produto, colorIndex, tamanho, qty }
  let _caixaUIBound = false;
  let _caixaClockTimer = null;

  function caixaSellable() {
    return typeof sellableItems === 'function' ? sellableItems() : [];
  }

  function resolveImg(src) {
    if (!src) return '';
    return src.startsWith('http') ? src : '/' + src;
  }

  function corSizes(p, colorIndex) {
    const cor = p?.cores?.[colorIndex];
    const estoque = (cor?.estoque && typeof cor.estoque === 'object' && !Array.isArray(cor.estoque)) ? cor.estoque : {};
    const base = cor?.tamanhos?.length ? cor.tamanhos : (p?.tamanhos?.length ? p.tamanhos : []);
    const sizes = Array.from(new Set([...base, ...Object.keys(estoque)]));
    return sizes.length ? sizes : ['UNICO'];
  }

  // ── Clock ──────────────────────────────────────────────────
  function tickClock() {
    const el = $('caixaClock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString('pt-BR') + ' · ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Scan ───────────────────────────────────────────────────
  function showScanMsg(text, kind) {
    const el = $('caixaScanMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'caixa-scan__msg' + (kind ? ` caixa-scan__msg--${kind}` : '');
  }

  function handleScan() {
    const input = $('caixaBarcodeInput');
    const code = (input.value || '').trim();
    input.value = '';
    if (!code) return;
    const p = caixaSellable().find((item) => item.barcode && item.barcode.toUpperCase() === code.toUpperCase());
    if (!p) {
      showScanMsg(`Nenhum produto encontrado pro código "${code}".`, 'error');
      return;
    }
    showScanMsg('', '');
    openPicker(p);
  }

  // ── Busca manual por nome (pra quem não tem leitor de código de barras) ──
  function renderSearchResults(list) {
    const wrap = $('caixaSearchResults');
    if (!list.length) {
      wrap.innerHTML = '<div class="caixa-search__empty">Nenhum produto encontrado.</div>';
    } else {
      wrap.innerHTML = list.slice(0, 12).map((p, i) => {
        const img = resolveImg(p.cores?.[0]?.imagens?.[0] || p.cores?.[0]?.imagem || '');
        const price = p.precoPromo ?? p.preco;
        return `
          <div class="caixa-search__result" data-i="${i}">
            ${img ? `<img class="caixa-search__result-img" src="${esc(img)}" alt="">` : '<div class="caixa-search__result-img"></div>'}
            <div class="caixa-search__result-info">
              <div class="caixa-search__result-name">${esc(p.nome)}${p.tipoProduto === 'combo' ? ' (combo)' : ''}</div>
              <div class="caixa-search__result-price">${typeof price === 'number' ? fmtR(price) : 'Sob consulta'}</div>
            </div>
          </div>`;
      }).join('');
      els('[data-i]', wrap).forEach((row) => {
        row.addEventListener('click', () => {
          const p = list[Number(row.dataset.i)];
          wrap.hidden = true;
          $('caixaProductSearch').value = '';
          openPicker(p);
        });
      });
    }
    wrap.hidden = false;
  }

  function handleProductSearch() {
    const q = ($('caixaProductSearch').value || '').trim().toLowerCase();
    const wrap = $('caixaSearchResults');
    if (!q) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    const matches = caixaSellable().filter((p) => (p.nome || '').toLowerCase().includes(q));
    renderSearchResults(matches);
  }

  // ── Picker (cor/tamanho) ──────────────────────────────────
  function openPicker(p) {
    const cores = Array.isArray(p.cores) && p.cores.length ? p.cores : [{ nome: '', estoque: {} }];
    caixaPending = { produto: p, colorIndex: 0, tamanho: null, qty: 1 };

    const singleColor = cores.length <= 1;
    const sizesForColor0 = corSizes(p, 0);
    const singleSize = sizesForColor0.length <= 1;

    if (singleColor && singleSize) {
      // Sem variação real pra escolher — adiciona direto.
      caixaPending.tamanho = sizesForColor0[0];
      confirmPending();
      return;
    }
    renderPicker();
  }

  function renderPicker() {
    const wrap = $('caixaPicker');
    if (!caixaPending) { wrap.hidden = true; return; }
    const { produto: p, colorIndex } = caixaPending;
    const cores = Array.isArray(p.cores) && p.cores.length ? p.cores : [{ nome: '' }];
    const cor = cores[colorIndex];
    const img = resolveImg(cor?.imagens?.[0] || cor?.imagem || '');
    const price = p.precoPromo ?? p.preco;
    const sizes = corSizes(p, colorIndex);
    if (!caixaPending.tamanho || !sizes.includes(caixaPending.tamanho)) caixaPending.tamanho = sizes[0];

    wrap.hidden = false;
    wrap.innerHTML = `
      <div class="caixa-picker__head">
        ${img ? `<img class="caixa-picker__img" src="${esc(img)}" alt="">` : ''}
        <div>
          <div class="caixa-picker__name">${esc(p.nome)}</div>
          <div class="caixa-picker__price">${typeof price === 'number' ? fmtR(price) : 'Sob consulta'}</div>
        </div>
      </div>
      ${cores.length > 1 ? `
      <div class="caixa-picker__group">
        <span class="caixa-picker__group-label">Cor</span>
        <div class="caixa-picker__opts" id="caixaPickerCores">
          ${cores.map((c, i) => `<button type="button" class="caixa-picker__opt ${i === colorIndex ? 'active' : ''}" data-color="${i}">${esc(c.nome || 'Única')}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="caixa-picker__group">
        <span class="caixa-picker__group-label">Tamanho</span>
        <div class="caixa-picker__opts" id="caixaPickerSizes">
          ${sizes.map((s) => `<button type="button" class="caixa-picker__opt ${s === caixaPending.tamanho ? 'active' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>
      <div class="caixa-picker__actions">
        <div class="caixa-picker__qty">
          <button type="button" id="caixaPickerQtyDec">−</button>
          <input type="number" id="caixaPickerQtyInput" min="1" value="${caixaPending.qty}">
          <button type="button" id="caixaPickerQtyInc">+</button>
        </div>
        <button type="button" class="caixa-picker__add" id="caixaPickerAdd">Adicionar ao carrinho</button>
      </div>`;

    els('#caixaPickerCores [data-color]', wrap).forEach((btn) => {
      btn.addEventListener('click', () => {
        caixaPending.colorIndex = Number(btn.dataset.color);
        caixaPending.tamanho = null;
        renderPicker();
      });
    });
    els('#caixaPickerSizes [data-size]', wrap).forEach((btn) => {
      btn.addEventListener('click', () => {
        caixaPending.tamanho = btn.dataset.size;
        renderPicker();
      });
    });
    $('caixaPickerQtyDec')?.addEventListener('click', () => setPendingQty(caixaPending.qty - 1));
    $('caixaPickerQtyInc')?.addEventListener('click', () => setPendingQty(caixaPending.qty + 1));
    $('caixaPickerQtyInput')?.addEventListener('change', (e) => setPendingQty(Number(e.target.value)));
    $('caixaPickerAdd')?.addEventListener('click', confirmPending);
  }

  function setPendingQty(v) {
    caixaPending.qty = Math.max(1, Number(v) || 1);
    const input = $('caixaPickerQtyInput');
    if (input) input.value = caixaPending.qty;
  }

  function confirmPending() {
    if (!caixaPending) return;
    const { produto: p, colorIndex, tamanho, qty } = caixaPending;
    const cor = p.cores?.[colorIndex];
    const price = p.precoPromo ?? p.preco ?? 0;
    addLineToCart({
      productId: p.tipoProduto === 'combo' ? p.id : Number(p.id),
      colorIndex,
      nome: p.nome,
      cor: p.tipoProduto === 'combo' ? '' : (cor?.nome || ''),
      tamanho: tamanho === 'UNICO' ? '' : tamanho,
      tamanhoSelecionado: tamanho,
      quantidade: qty,
      precoUnitario: price,
    });
    caixaPending = null;
    $('caixaPicker').hidden = true;
    showScanMsg(`${p.nome} adicionado.`, 'ok');
    $('caixaBarcodeInput')?.focus();
  }

  // ── Carrinho ───────────────────────────────────────────────
  function cartKey(it) {
    return `${it.productId}::${it.colorIndex}::${it.tamanhoSelecionado || it.tamanho || ''}`;
  }

  function addLineToCart(item) {
    const key = cartKey(item);
    const existing = caixaCart.find((it) => cartKey(it) === key);
    if (existing) existing.quantidade += item.quantidade;
    else caixaCart.push(item);
    renderCart();
  }

  function renderCart() {
    const list = $('caixaCartList');
    const count = $('caixaCartCount');
    if (!list) return;
    if (!caixaCart.length) {
      list.innerHTML = '<div class="caixa-cart__empty">Escaneie um produto pra começar a venda.</div>';
    } else {
      list.innerHTML = caixaCart.map((it, i) => `
        <div class="caixa-cart__row" data-i="${i}">
          <div class="caixa-cart__row-info">
            <div class="caixa-cart__row-name">${esc(it.nome)}</div>
            <div class="caixa-cart__row-meta">${[it.cor, it.tamanho].filter(Boolean).map(esc).join(' · ') || '&nbsp;'} · ${fmtR(it.precoUnitario)}</div>
          </div>
          <div class="caixa-cart__row-qty">
            <button type="button" data-dec="${i}">−</button>
            <span>${it.quantidade}</span>
            <button type="button" data-inc="${i}">+</button>
          </div>
          <div class="caixa-cart__row-total">${fmtR(it.precoUnitario * it.quantidade)}</div>
          <button type="button" class="caixa-cart__row-remove" data-rm="${i}">✕</button>
        </div>`).join('');
      els('[data-dec]', list).forEach((b) => b.addEventListener('click', () => changeQty(Number(b.dataset.dec), -1)));
      els('[data-inc]', list).forEach((b) => b.addEventListener('click', () => changeQty(Number(b.dataset.inc), 1)));
      els('[data-rm]', list).forEach((b) => b.addEventListener('click', () => { caixaCart.splice(Number(b.dataset.rm), 1); renderCart(); }));
    }
    if (count) count.textContent = `${caixaCart.reduce((s, it) => s + it.quantidade, 0)} itens`;
    updateTotals();
  }

  function changeQty(i, delta) {
    const it = caixaCart[i];
    if (!it) return;
    it.quantidade = Math.max(1, it.quantidade + delta);
    renderCart();
  }

  function cartSubtotal() {
    return caixaCart.reduce((s, it) => s + it.precoUnitario * it.quantidade, 0);
  }

  function updateTotals() {
    const sub = cartSubtotal();
    const desconto = Math.min(sub, Math.max(0, Number($('caixaDesconto')?.value) || 0));
    const total = Math.max(0, sub - desconto);
    $('caixaSubtotal').textContent = fmtR(sub);
    $('caixaDescontoLabel').textContent = desconto > 0 ? `- ${fmtR(desconto)}` : fmtR(0);
    $('caixaTotal').textContent = fmtR(total);
    const pagamento = $('caixaPagamento')?.value;
    $('caixaFinishBtn').disabled = !(caixaCart.length && pagamento);
  }

  // ── Finalizar venda ────────────────────────────────────────
  async function finalizarVenda() {
    const btn = $('caixaFinishBtn');
    const notice = $('caixaFinishNotice');
    if (notice) notice.style.display = 'none';
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Finalizando…';
    try {
      const sub = cartSubtotal();
      const desconto = Math.min(sub, Math.max(0, Number($('caixaDesconto')?.value) || 0));
      const total = Math.max(0, sub - desconto);
      const nome = ($('caixaClienteNome')?.value || '').trim() || 'Cliente balcão';
      const telefone = ($('caixaClienteTel')?.value || '').trim();
      const eventoSel = $('caixaEvento');
      const eventoNome = eventoSel?.selectedOptions?.[0]?.dataset.nome || '';
      const payload = {
        cliente: { nome, telefone },
        status: 'confirmado',
        pagamento: $('caixaPagamento')?.value || '',
        origem: 'loja_fisica',
        evento: eventoNome || undefined,
        obs: '',
        itens: caixaCart,
        itensEstoque: caixaCart.map((it) => ({
          productId: it.productId, colorIndex: it.colorIndex,
          tamanhoSelecionado: it.tamanhoSelecionado, quantidade: it.quantidade, nome: it.nome,
        })),
        subtotal: sub,
        taxa: 0,
        desconto,
        descontoManual: desconto,
        cupom: '',
        cupomPercentual: 0,
        descontos: desconto > 0 ? [{ type: 'manual', label: 'Desconto', amount: desconto }] : [],
        total,
      };
      const r = await fetch('/api/admin/pedido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || 'Falha ao finalizar a venda.');
      if (typeof loadProdutos === 'function') await loadProdutos();
      if (typeof loadCombos === 'function') await loadCombos();
      await showReceipt(d.pedido, total);
    } catch (e) {
      if (notice) { notice.textContent = e.message || 'Falha ao finalizar a venda.'; notice.style.display = 'block'; }
    } finally {
      btn.disabled = false;
      btn.textContent = original;
      updateTotals();
    }
  }

  let _lastReceipt = null; // { numero, qrLoaded }

  // O QR do comprovante é secundário — só é gerado se o operador clicar em
  // "Mostrar comprovante", não trava a tela toda vez que uma venda é fechada.
  async function showReceipt(numero, total) {
    _lastReceipt = { numero, qrLoaded: false };
    $('caixaReceiptNumero').textContent = `Pedido #${numero}`;
    $('caixaReceiptTotal').textContent = fmtR(total);
    $('caixaReceiptQr').removeAttribute('src');
    $('caixaQrWrap').hidden = true;
    $('caixaQrToggleBtn').textContent = '📄 Mostrar comprovante (QR)';
    $('caixaReceiptScreen').hidden = false;
  }

  async function toggleReceiptQr() {
    const wrap = $('caixaQrWrap');
    const toggleBtn = $('caixaQrToggleBtn');
    const showing = !wrap.hidden;
    if (showing) { wrap.hidden = true; toggleBtn.textContent = '📄 Mostrar comprovante (QR)'; return; }
    wrap.hidden = false;
    toggleBtn.textContent = 'Ocultar comprovante';
    if (!_lastReceipt || _lastReceipt.qrLoaded) return;
    try {
      const url = `${location.origin}/recibo.html?pedido=${encodeURIComponent(_lastReceipt.numero)}`;
      const r = await fetch('/api/qrcode/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: url, size: 500, fg: '#292c27', bg: '#ffffff' }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.dataUrl) { $('caixaReceiptQr').src = d.dataUrl; _lastReceipt.qrLoaded = true; }
    } catch (_e) { /* QR é um extra — a venda já foi confirmada mesmo sem ele */ }
  }

  function resetSale() {
    caixaCart = [];
    caixaPending = null;
    _lastReceipt = null;
    $('caixaPicker').hidden = true;
    $('caixaDesconto').value = 0;
    $('caixaPagamento').value = '';
    $('caixaClienteNome').value = '';
    $('caixaClienteTel').value = '';
    // Evento fica selecionado entre vendas de propósito — o mesmo evento vale
    // pra várias vendas seguidas até o operador trocar manualmente.
    showScanMsg('', '');
    $('caixaReceiptScreen').hidden = true;
    $('caixaQrWrap').hidden = true;
    renderCart();
    $('caixaBarcodeInput')?.focus();
  }

  // ── PWA: instalar app do Caixa ───────────────────────────────
  let deferredCaixaInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredCaixaInstall = e;
    $('caixaInstallBtn').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredCaixaInstall = null;
    $('caixaInstallBtn').hidden = true;
  });

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function bindInstallButton() {
    const btn = $('caixaInstallBtn');
    if (!btn || isStandalone()) return;
    btn.addEventListener('click', async () => {
      if (deferredCaixaInstall) {
        deferredCaixaInstall.prompt();
        await deferredCaixaInstall.userChoice.catch(() => null);
        deferredCaixaInstall = null;
        btn.hidden = true;
        return;
      }
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/i.test(ua);
      alert(isIOS
        ? 'No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".'
        : 'Abra o menu do navegador e escolha "Instalar app" ou "Adicionar à tela inicial".');
    });
  }

  // Escopo restrito a /produtos-admin.html — importante: registrar com escopo '/'
  // aqui substituiria silenciosamente o service-worker.js do catálogo pra quem
  // visita as duas páginas no mesmo navegador (o registro mais recente numa
  // mesma origem+escopo sobrescreve o anterior).
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/caixa-sw.js', { scope: '/produtos-admin.html' }).catch(() => {});
  }

  // ── Eventos (opcional, marca de qual feira/evento veio a venda) ──────
  async function loadCaixaEventos() {
    const sel = $('caixaEvento');
    if (!sel) return;
    try {
      const r = await fetch('/api/admin/eventos');
      if (!r.ok) return;
      const eventos = await r.json();
      const current = sel.value;
      sel.innerHTML = '<option value="">Loja / sem evento</option>' + eventos
        .filter((e) => e.ativo !== false)
        .map((e) => `<option value="${e.id}" data-nome="${esc(e.nome)}">${esc(e.nome)}</option>`).join('');
      if (current && Array.from(sel.options).some((o) => o.value === current)) sel.value = current;
    } catch (_e) { /* sem eventos cadastrados ainda — tudo bem, fica só "Loja" */ }
  }

  // ── Init ───────────────────────────────────────────────────
  window.initCaixa = function initCaixa() {
    if (!_caixaClockTimer) {
      tickClock();
      _caixaClockTimer = setInterval(tickClock, 1000);
    }
    renderCart();
    loadCaixaEventos();
    $('caixaBarcodeInput')?.focus();
    if (_caixaUIBound) return;
    _caixaUIBound = true;

    $('caixaBarcodeInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleScan(); }
    });
    $('caixaBarcodeInput')?.addEventListener('blur', () => {
      // Mantém o leitor sempre pronto pra próxima leitura — mas só rouba o foco de
      // volta se o operador não estiver de propósito preenchendo outro campo
      // (busca por nome, desconto, pagamento, cliente, evento etc).
      setTimeout(() => {
        if (!document.body.classList.contains('caixa-fullscreen')) return;
        if (!$('caixaReceiptScreen').hidden) return;
        const active = document.activeElement;
        const isOtherField = active && active.id !== 'caixaBarcodeInput'
          && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(active.tagName);
        if (isOtherField) return;
        $('caixaBarcodeInput')?.focus();
      }, 50);
    });
    $('caixaProductSearch')?.addEventListener('input', handleProductSearch);
    document.addEventListener('click', (e) => {
      const wrap = $('caixaSearchResults');
      if (!wrap || wrap.hidden) return;
      if (!e.target.closest('.caixa-search-wrap')) wrap.hidden = true;
    });
    $('caixaDesconto')?.addEventListener('input', updateTotals);
    $('caixaPagamento')?.addEventListener('change', updateTotals);
    $('caixaFinishBtn')?.addEventListener('click', finalizarVenda);
    $('caixaNewSaleBtn')?.addEventListener('click', resetSale);
    $('caixaQrToggleBtn')?.addEventListener('click', toggleReceiptQr);
    $('caixaExitBtn')?.addEventListener('click', () => {
      document.querySelector('.tab-btn[data-tab="produtos"]')?.click();
    });
    bindInstallButton();
    if (isStandalone()) $('caixaInstallBtn').hidden = true;
  };

  // Aberto pelo ícone instalado (start_url=?view=caixa) — entra direto na tela de caixa.
  if (new URLSearchParams(location.search).get('view') === 'caixa') {
    document.querySelector('.tab-btn[data-tab="caixa"]')?.click();
  }
})();
