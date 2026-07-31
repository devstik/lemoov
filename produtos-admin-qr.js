(function(){
  let _qrgCurrentType  = 'url';
  let _qrgLogoMode     = 'lemoov';
  let _qrgFmtMode      = 'padrao';
  let _qrgFgColor      = '#1a1a1a';
  let _qrgBgColor      = '#ffffff';
  let _qrgCustomDataUrl = null;
  let _qrgUIBound      = false;

  // Polyfill roundRect
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      this.beginPath();
      this.moveTo(x+r,y); this.lineTo(x+w-r,y);
      this.quadraticCurveTo(x+w,y,x+w,y+r); this.lineTo(x+w,y+h-r);
      this.quadraticCurveTo(x+w,y+h,x+w-r,y+h); this.lineTo(x+r,y+h);
      this.quadraticCurveTo(x,y+h,x,y+h-r); this.lineTo(x,y+r);
      this.quadraticCurveTo(x,y,x+r,y); this.closePath();
    };
  }

  function qrgContent() {
    if (_qrgCurrentType === 'url') {
      const v = document.getElementById('qrgUrl').value.trim();
      if (!v) return null;
      return /^https?:\/\//i.test(v) ? v : 'https://'+v;
    }
    if (_qrgCurrentType === 'text') {
      return document.getElementById('qrgText').value.trim() || null;
    }
    if (_qrgCurrentType === 'whatsapp') {
      const num = document.getElementById('qrgWa').value.replace(/\D/g,'');
      if (!num) return null;
      const phone = num.startsWith('55') ? num : '55'+num;
      const msg = encodeURIComponent(document.getElementById('qrgWaMsg').value.trim());
      return msg ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/${phone}`;
    }
    return null;
  }

  function qrgLoadLogo(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Retorna altura do rodapé com logo (0 se sem logo)
  function qrgLogoFooterH(size) {
    return _qrgLogoMode === 'none' ? 0 : Math.round(size * 0.26);
  }

  // Desenha logo no rodapé abaixo do QR — não toca nos módulos do código
  async function qrgDrawLogoFooter(ctx, size, bgColor) {
    let src = null;
    if (_qrgLogoMode === 'lemoov') src = '/image/logo_lemoov_semfundo.png';
    else if (_qrgLogoMode === 'upload' && _qrgCustomDataUrl) src = _qrgCustomDataUrl;
    if (!src) return;
    const img = await qrgLoadLogo(src);
    if (!img) return;
    const footerH = qrgLogoFooterH(size);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, size, size, footerH);
    // Cabe na caixa do rodapé: limita W e H separadamente
    const maxW = Math.round(size * 0.55);
    const maxH = Math.round(footerH * 0.85);
    const ratio = img.naturalWidth / img.naturalHeight;
    let lw, lh;
    if (maxW / maxH >= ratio) {
      lh = maxH; lw = Math.round(lh * ratio);
    } else {
      lw = maxW; lh = Math.round(lw / ratio);
    }
    const lx = Math.round((size - lw) / 2);
    const ly = size + Math.round((footerH - lh) / 2);
    ctx.globalAlpha = 0.88;
    ctx.drawImage(img, lx, ly, lw, lh);
    ctx.globalAlpha = 1;
  }

  async function qrgBuildInstagram(qrDataUrl, size) {
    const CANVAS = 1080;
    const canvas = document.getElementById('qrgCanvas');
    canvas.width  = CANVAS;
    canvas.height = CANVAS;
    const ctx = canvas.getContext('2d');

    // Fundo gradiente marca
    const grad = ctx.createLinearGradient(0, 0, CANVAS, CANVAS);
    grad.addColorStop(0, '#EBD8C7');
    grad.addColorStop(1, '#F7F1EB');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    // Logo Lemoov no topo
    const topLogo = await qrgLoadLogo('/image/logo_lemoov_semfundo.png');
    if (topLogo) {
      const lw = 280, lh = Math.round(280 * topLogo.naturalHeight / topLogo.naturalWidth);
      ctx.drawImage(topLogo, (CANVAS-lw)/2, 60, lw, lh);
    }

    // QR code centralizado
    const qrImg = await qrgLoadLogo(qrDataUrl);
    if (qrImg) {
      const qrSize = 620;
      const qrX = (CANVAS - qrSize) / 2;
      const qrY = (CANVAS - qrSize) / 2 + 40;
      // Fundo branco arredondado atrás do QR
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 20); ctx.fill();
      ctx.restore();
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    }

    // Texto na base
    const customText = document.getElementById('qrgInstaText').value.trim() || 'Escaneie e conheça a Lemoov!';
    ctx.fillStyle = '#383838';
    ctx.font = 'bold 38px Montserrat, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(customText, CANVAS/2, CANVAS - 70);
    ctx.font = '24px Inter, sans-serif';
    ctx.fillStyle = '#6F8522';
    ctx.fillText('lemoov.com.br', CANVAS/2, CANVAS - 28);
  }

  window.qrgGenerate = async function() {
    const errEl = document.getElementById('qrgErrMsg');
    errEl.style.display = 'none';
    const content = qrgContent();
    if (!content) {
      errEl.textContent = 'Preencha o conteúdo antes de gerar.';
      errEl.style.display = '';
      return;
    }
    const btn = document.getElementById('qrgGenBtn');
    btn.disabled = true; btn.textContent = 'Gerando…';
    try {
      const size = _qrgFmtMode === 'instagram' ? 620 : Number(document.getElementById('qrgSize').value);
      // Geração via servidor (não precisa de lib JS externa)
      const res  = await fetch('/api/qrcode/generate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, size, fg: _qrgFgColor, bg: _qrgBgColor })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Erro do servidor');
      const canvas = document.getElementById('qrgCanvas');

      if (_qrgFmtMode === 'instagram') {
        await qrgBuildInstagram(data.dataUrl, size);
      } else {
        // Modo simples: QR limpo + logo no rodapé (fora dos módulos)
        const footerH = qrgLogoFooterH(size);
        canvas.width  = size;
        canvas.height = size + footerH;
        const ctx = canvas.getContext('2d');
        const qrImg = await qrgLoadLogo(data.dataUrl);
        ctx.drawImage(qrImg, 0, 0, size, size);
        if (_qrgLogoMode !== 'none') await qrgDrawLogoFooter(ctx, size, _qrgBgColor);
      }

      document.getElementById('qrgPlaceholder').style.display = 'none';
      canvas.style.display = '';
      document.getElementById('qrgDlBtn').style.display = '';
      document.getElementById('qrgClearBtn').style.display = '';
      document.getElementById('qrgHint').textContent = _qrgFmtMode === 'instagram'
        ? '✓ Post 1080×1080 pronto'
        : '✓ Pronto — legível pela câmera';
    } catch(e) {
      errEl.textContent = 'Erro: ' + e.message;
      errEl.style.display = '';
    } finally {
      btn.disabled = false; btn.textContent = '▶  Gerar QR Code';
    }
  };

  window.qrgDownload = function() {
    const canvas = document.getElementById('qrgCanvas');
    if (canvas.style.display === 'none') return;
    const labels = { url:'link', text:'texto', whatsapp:'whatsapp' };
    const suffix = _qrgFmtMode === 'instagram' ? 'instagram' : (labels[_qrgCurrentType]||'qr');
    const a = document.createElement('a');
    a.download = `qrcode-lemoov-${suffix}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  function qrgResetPreview() {
    document.getElementById('qrgCanvas').style.display = 'none';
    document.getElementById('qrgPlaceholder').style.display = '';
    document.getElementById('qrgDlBtn').style.display = 'none';
    document.getElementById('qrgClearBtn').style.display = 'none';
    document.getElementById('qrgHint').textContent = 'Configure e gere';
  }

  window.qrgClear = function() {
    // Limpa inputs de conteúdo
    ['qrgUrl','qrgText','qrgPhone','qrgInstaText'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // Remove imagem personalizada
    _qrgCustomDataUrl = null;
    const fileInput = document.getElementById('qrgFileInput');
    if (fileInput) fileInput.value = '';
    qrgResetPreview();
  };

  function qrgSetColor(group, color) {
    if (group === 'fg') { _qrgFgColor = color; document.getElementById('qrgFgDot').style.background = color; document.getElementById('qrgFgLabel').textContent = color; }
    else               { _qrgBgColor = color; document.getElementById('qrgBgDot').style.background = color; document.getElementById('qrgBgLabel').textContent = color;
                         document.getElementById('qrgBgDot').style.border = color.toLowerCase()==='#ffffff' ? '1.5px solid var(--brd2)' : 'none'; }
    qrgResetPreview();
  }

  window.qrgInitUI = function() {
    if (_qrgUIBound) return;
    _qrgUIBound = true;

    // Tipo de conteúdo
    document.querySelectorAll('[data-qrtype]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qrtype]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _qrgCurrentType = btn.dataset.qrtype;
        document.querySelectorAll('.qrg-fields').forEach(g => g.style.display='none');
        const map = { url:'qrg-f-url', text:'qrg-f-text', whatsapp:'qrg-f-whatsapp' };
        document.getElementById(map[_qrgCurrentType]).style.display = '';
        qrgResetPreview();
      });
    });

    // Formato
    document.querySelectorAll('[data-qrfmt]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qrfmt]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _qrgFmtMode = btn.dataset.qrfmt;
        document.getElementById('qrgSizeRow').style.display   = _qrgFmtMode === 'instagram' ? 'none' : '';
        document.getElementById('qrgInstaRow').style.display  = _qrgFmtMode === 'instagram' ? '' : 'none';
        qrgResetPreview();
      });
    });

    // Logo
    document.querySelectorAll('[data-qrlogo]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-qrlogo]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _qrgLogoMode = btn.dataset.qrlogo;
        document.getElementById('qrgLogoUploadWrap').style.display = _qrgLogoMode==='upload' ? '' : 'none';
        qrgResetPreview();
      });
    });

    // Color swatches
    ['fg','bg'].forEach(group => {
      document.querySelectorAll(`#qrg${group.charAt(0).toUpperCase()+group.slice(1)}Swatches .qrg-swatch[data-color]`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#qrg${group.charAt(0).toUpperCase()+group.slice(1)}Swatches .qrg-swatch`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          qrgSetColor(group, btn.dataset.color);
        });
      });
      // Input color personalizado
      const customInput   = document.getElementById(`qrg${group === 'fg' ? 'Fg' : 'Bg'}Custom`);
      const customPreview = document.getElementById(`qrg${group === 'fg' ? 'Fg' : 'Bg'}CustomPreview`);
      const customLabel   = customInput.closest('.qrg-swatch--custom');
      customLabel.addEventListener('click', () => customInput.click());
      customInput.addEventListener('input', () => {
        const c = customInput.value;
        customPreview.style.background = c;
        document.querySelectorAll(`#qrg${group === 'fg' ? 'Fg' : 'Bg'}Swatches .qrg-swatch`).forEach(b => b.classList.remove('active'));
        customLabel.classList.add('active');
        qrgSetColor(group, c);
      });
    });

    // Upload personalizado
    document.getElementById('qrgLogoFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => { _qrgCustomDataUrl = ev.target.result; };
      reader.readAsDataURL(f);
    });

    // Enter gera
    ['qrgUrl','qrgWa','qrgWaMsg','qrgInstaText'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); qrgGenerate(); }
      });
    });
  };
})();
