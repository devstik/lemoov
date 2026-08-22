/* Etiquetas de produto (código de barras) — sub-aba dentro de QR Code.
   Gera preview e imprime etiquetas em rolo térmico 51,5mm x 31mm com nome, código
   de barras (Code128, via JsBarcode) e preço. */
(function () {
  const $ = (id) => document.getElementById(id);
  const els = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  let etqQueue = []; // {key, id, tipo, nome, barcode, preco, qty}
  let _etqUIBound = false;

  function etqSellable() {
    return typeof sellableItems === 'function' ? sellableItems() : [];
  }

  function labelPrice(p) {
    const v = p?.precoPromo ?? p?.preco;
    return typeof v === 'number' ? v : null;
  }

  function itemBarcode(p) {
    if (p.barcode) return p.barcode;
    if (p.tipoProduto === 'combo') return suggestBarcode('combo', p.comboId ?? p.id);
    return suggestBarcode('produto', p.id);
  }

  function populateProdSelect() {
    const sel = $('etqProd');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '';
    etqSellable().forEach((p) => {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = p.tipoProduto === 'combo' ? `${p.nome} (combo)` : p.nome;
      sel.appendChild(o);
    });
    if (current && Array.from(sel.options).some((o) => o.value === current)) sel.value = current;
  }

  function currentSelected() {
    const sel = $('etqProd');
    if (!sel || !sel.value) return null;
    return etqSellable().find((p) => String(p.id) === sel.value) || null;
  }

  function updatePreview() {
    const p = currentSelected();
    const nameEl = $('etqPreviewName');
    const priceEl = $('etqPreviewPrice');
    const svg = $('etqPreviewBarcode');
    if (!p) {
      nameEl.textContent = 'Selecione um produto';
      priceEl.textContent = '';
      if (svg) svg.innerHTML = '';
      return;
    }
    const price = labelPrice(p);
    nameEl.textContent = p.nome;
    priceEl.textContent = price != null ? fmtR(price) : 'Sob consulta';
    renderBarcode(svg, itemBarcode(p));
  }

  function renderBarcode(svgEl, value) {
    if (!svgEl || typeof JsBarcode === 'undefined') return;
    try {
      JsBarcode(svgEl, value, {
        format: 'CODE128', displayValue: true, fontSize: 11, height: 34, margin: 2, width: 1.6,
      });
    } catch (_e) {
      svgEl.innerHTML = '';
    }
  }

  function renderQueue() {
    const list = $('etqQueueList');
    const count = $('etqCount');
    if (!list) return;
    if (!etqQueue.length) {
      list.innerHTML = '<div class="etq-queue-empty">Nenhum produto adicionado ainda.</div>';
    } else {
      list.innerHTML = etqQueue.map((it, i) => `
        <div class="etq-queue-row" data-i="${i}">
          <div class="etq-queue-row__info">
            <div class="etq-queue-row__name">${esc(it.nome)}</div>
            <div class="etq-queue-row__meta">${esc(it.barcode)} · ${it.preco != null ? fmtR(it.preco) : 'Sob consulta'}</div>
          </div>
          <input type="number" min="1" class="etq-queue-row__qty" value="${it.qty}" data-qtyfor="${i}" />
          <button type="button" class="btn btn--ghost btn--sm" data-rm="${i}">✕</button>
        </div>`).join('');
      els('[data-qtyfor]', list).forEach((input) => {
        input.addEventListener('change', () => {
          const i = Number(input.dataset.qtyfor);
          etqQueue[i].qty = Math.max(1, Number(input.value) || 1);
        });
      });
      els('[data-rm]', list).forEach((btn) => {
        btn.addEventListener('click', () => {
          etqQueue.splice(Number(btn.dataset.rm), 1);
          renderQueue();
        });
      });
    }
    if (count) count.textContent = etqQueue.length ? `${etqQueue.length} produto${etqQueue.length > 1 ? 's' : ''} na lista` : '';
  }

  function addToQueue() {
    const p = currentSelected();
    const notice = $('etqNotice');
    if (!p) return;
    const qty = Math.max(1, Number($('etqQty').value) || 1);
    const key = String(p.id);
    const existing = etqQueue.find((it) => it.key === key);
    if (existing) {
      existing.qty += qty;
    } else {
      etqQueue.push({ key, nome: p.nome, barcode: itemBarcode(p), preco: labelPrice(p), qty });
    }
    renderQueue();
    if (notice) notice.style.display = 'none';
  }

  async function bulkGenerateCodes() {
    const btn = $('etqBulkGenBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Gerando…';
    try {
      let count = 0;
      for (const p of produtos) {
        if (p.barcode) continue;
        const r = await fetch(`/api/admin/produtos/${p.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: suggestBarcode('produto', p.id) }),
        });
        if (r.ok) count++;
      }
      for (const c of combos) {
        if (c.barcode) continue;
        const r = await fetch(`/api/admin/combos/${c.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...c, barcode: suggestBarcode('combo', c.id) }),
        });
        if (r.ok) count++;
      }
      if (typeof loadProdutos === 'function') await loadProdutos();
      if (typeof loadCombos === 'function') await loadCombos();
      populateProdSelect();
      updatePreview();
      toast(count ? `${count} código${count > 1 ? 's' : ''} gerado${count > 1 ? 's' : ''}.` : 'Todos os produtos já têm código.', 'success');
    } catch (_e) {
      toast('Falha ao gerar códigos em lote.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function printLabels() {
    // Se a lista de impressão está vazia mas há um produto selecionado, adiciona ele
    // automaticamente — sem isso, clicar em "Imprimir" sem antes clicar em "+ Adicionar"
    // não fazia nada visível (só um aviso de texto fácil de não notar).
    if (!etqQueue.length) {
      const p = currentSelected();
      if (p) {
        addToQueue();
      } else {
        const notice = $('etqNotice');
        if (notice) { notice.textContent = 'Selecione um produto antes de imprimir.'; notice.style.display = 'block'; }
        toast('Selecione um produto antes de imprimir.', 'error');
        return;
      }
    }
    const ov = $('printLabelsOv');
    if (!ov) return;
    const labels = [];
    etqQueue.forEach((it) => {
      for (let i = 0; i < it.qty; i++) labels.push(it);
    });
    // O rolo sai 2 etiquetas por linha — se sobrar uma etiqueta ímpar no final,
    // repete a última em vez de deixar a segunda posição da linha em branco
    // (o rolo avança a linha inteira de qualquer forma).
    if (labels.length % 2 !== 0) labels.push(labels[labels.length - 1]);

    const labelHtml = (it, i) => `
      <div class="print-label">
        <div class="print-label__name">${esc(it.nome)}</div>
        <svg data-label-barcode="${i}"></svg>
        <div class="print-label__price">${it.preco != null ? fmtR(it.preco) : 'Sob consulta'}</div>
      </div>`;
    const rows = [];
    for (let i = 0; i < labels.length; i += 2) {
      rows.push(`<div class="print-row">${labelHtml(labels[i], i)}${labelHtml(labels[i + 1], i + 1)}</div>`);
    }
    ov.innerHTML = rows.join('');
    labels.forEach((it, i) => renderBarcode(ov.querySelector(`[data-label-barcode="${i}"]`), it.barcode));

    // Mostra a contagem antes de imprimir, pra qualquer número estranho ficar visível
    // na hora — e não só depois de gastar etiqueta física tentando descobrir por quê.
    toast(`Imprimindo ${labels.length} etiqueta${labels.length > 1 ? 's' : ''} em ${rows.length} linha${rows.length > 1 ? 's' : ''} do rolo.`, 'success');

    window.print();

    // A lista não fica acumulando entre impressões — cada clique em "Imprimir"
    // começa uma lista nova. Antes disso, testar imprimir de novo somava em cima
    // do que já estava na lista (por isso a contagem ia crescendo a cada tentativa).
    etqQueue = [];
    renderQueue();
  }

  window.addEventListener('afterprint', () => {
    const ov = $('printLabelsOv');
    if (ov) ov.innerHTML = '';
  });

  window.etiquetasInitUI = function etiquetasInitUI() {
    populateProdSelect();
    updatePreview();
    renderQueue();
    if (_etqUIBound) return;
    _etqUIBound = true;
    $('etqProd')?.addEventListener('change', updatePreview);
    $('etqAddBtn')?.addEventListener('click', addToQueue);
    $('etqBulkGenBtn')?.addEventListener('click', bulkGenerateCodes);
    $('etqPrintBtn')?.addEventListener('click', printLabels);
  };
})();
