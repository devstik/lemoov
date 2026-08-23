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

  // ── Impressão direta via ZPL (Zebra Browser Print) ────────────────────
  // Desenha a etiqueta na própria impressora (dots, não pixels de tela) — não
  // depende de tamanho de página, driver, calibração de "página" do navegador
  // nem cabeçalho/rodapé de impressão. Precisa do Zebra Browser Print instalado
  // (programa grátis da Zebra) rodando na máquina com a impressora conectada.
  let zebraDevice = null;

  function updatePrinterStatus(state, text) {
    const el = $('etqPrinterStatus');
    const label = $('etqPrinterStatusText');
    if (el) el.dataset.state = state;
    if (label) label.textContent = text;
    const zplBtn = $('etqPrintZplBtn');
    if (zplBtn) zplBtn.disabled = state !== 'ok';
  }

  function initZebraPrinter() {
    if (typeof BrowserPrint === 'undefined') {
      updatePrinterStatus('error', 'Zebra Browser Print não carregou (sem internet ou bloqueado). Use "Imprimir pelo navegador".');
      return;
    }
    updatePrinterStatus('', 'Procurando impressora Zebra…');
    BrowserPrint.getDefaultDevice('printer', (device) => {
      zebraDevice = device;
      updatePrinterStatus('ok', `Impressora conectada: ${device.name || 'Zebra'}`);
    }, () => {
      zebraDevice = null;
      updatePrinterStatus('error', 'Nenhuma impressora Zebra encontrada. Confira o Zebra Browser Print (instalado e aberto) e o cabo USB.');
    });
  }

  // Remove caracteres que quebrariam o parser de comandos ZPL (^ e ~ são
  // prefixo de comando/controle) — troca por espaço em vez de cortar o texto.
  function escapeZPL(text) {
    return String(text || '').replace(/[\^~]/g, ' ');
  }

  // Etiqueta 51,5mm x 31mm a 203dpi ≈ 412 x 248 dots (1mm ≈ 8 dots).
  // Todo campo (nome, código de barras, preço) usa ^FB com a MESMA largura e
  // margem esquerda/direita simétrica (10 dots de cada lado) pra centralizar
  // na largura; as posições Y são calculadas pra sobrar a mesma margem em
  // cima e embaixo, centralizando o bloco inteiro na altura.
  function buildZplLabel(item) {
    const nome = escapeZPL(item.nome).slice(0, 70);
    const preco = escapeZPL(item.preco != null ? fmtR(item.preco) : 'Sob consulta');
    const barcode = escapeZPL(item.barcode);

    const labelW = 412, labelH = 248;
    const margin = 10;
    const fieldW = labelW - margin * 2; // 392 — largura de centralização comum a todos os campos

    const nameH = 48;     // ^A0N,22,22 em até 2 linhas
    const barcodeH = 84;  // barra (64) + linha de texto legível
    const priceH = 34;    // ^A0N,34,34
    const gap = 8;
    const contentH = nameH + gap + barcodeH + gap + priceH;
    const topMargin = Math.max(0, Math.round((labelH - contentH) / 2));

    const nameY = topMargin;
    const barcodeY = nameY + nameH + gap;
    const priceY = barcodeY + barcodeH + gap;

    return [
      '^XA',
      '^CI28', // UTF-8, pros acentos do nome do produto
      `^PW${labelW}`,
      `^LL${labelH}`,
      `^FO${margin},${nameY}^A0N,22,22^FB${fieldW},2,2,C,0^FD${nome}^FS`,
      `^FO${margin},${barcodeY}^BY2,2,0`,
      '^BCN,64,Y,N,N',
      `^FB${fieldW},1,0,C,0^FD${barcode}^FS`,
      `^FO${margin},${priceY}^A0N,34,34^FB${fieldW},1,0,C,0^FD${preco}^FS`,
      '^XZ',
    ].join('');
  }

  function printViaZPL() {
    if (!zebraDevice) {
      toast('Nenhuma impressora Zebra conectada.', 'error');
      return;
    }
    if (!etqQueue.length) {
      const p = currentSelected();
      if (p) addToQueue();
      else {
        const notice = $('etqNotice');
        if (notice) { notice.textContent = 'Selecione um produto antes de imprimir.'; notice.style.display = 'block'; }
        toast('Selecione um produto antes de imprimir.', 'error');
        return;
      }
    }
    const labels = [];
    etqQueue.forEach((it) => {
      for (let i = 0; i < it.qty; i++) labels.push(it);
    });
    const zpl = labels.map(buildZplLabel).join('');

    const btn = $('etqPrintZplBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Enviando…';
    zebraDevice.send(zpl, () => {
      toast(`${labels.length} etiqueta${labels.length > 1 ? 's' : ''} enviada${labels.length > 1 ? 's' : ''} pra impressora.`, 'success');
      etqQueue = [];
      renderQueue();
      btn.disabled = false;
      btn.textContent = original;
    }, (err) => {
      toast(`Falha ao enviar pra impressora: ${err || 'erro desconhecido'}`, 'error');
      btn.disabled = false;
      btn.textContent = original;
    });
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

    ov.innerHTML = labels.map((it, i) => `
      <div class="print-label">
        <div class="print-label__name">${esc(it.nome)}</div>
        <svg data-label-barcode="${i}"></svg>
        <div class="print-label__price">${it.preco != null ? fmtR(it.preco) : 'Sob consulta'}</div>
      </div>`).join('');
    labels.forEach((it, i) => renderBarcode(ov.querySelector(`[data-label-barcode="${i}"]`), it.barcode));

    // Mostra a contagem antes de imprimir, pra qualquer número estranho ficar visível
    // na hora — e não só depois de gastar etiqueta física tentando descobrir por quê.
    toast(`Imprimindo ${labels.length} etiqueta${labels.length > 1 ? 's' : ''}.`, 'success');

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
    initZebraPrinter();
    if (_etqUIBound) return;
    _etqUIBound = true;
    $('etqProd')?.addEventListener('change', updatePreview);
    $('etqAddBtn')?.addEventListener('click', addToQueue);
    $('etqBulkGenBtn')?.addEventListener('click', bulkGenerateCodes);
    $('etqPrintZplBtn')?.addEventListener('click', printViaZPL);
    $('etqPrintBtn')?.addEventListener('click', printLabels);
  };
})();
