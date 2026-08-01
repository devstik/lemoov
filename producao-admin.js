(function () {
  const state = { data: null, view: 'overview', pendingNfe: null };
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const quantity = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits:3 });
  const api = async (url, options = {}) => {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) location.href = '/login?redirect=/api/produtos-admin';
    if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
    return payload;
  };
  function notify(message, type = 'success') {
    if (typeof window.toast === 'function') return window.toast(message, type);
    const el = byId('productionNotice'); if (!el) return;
    el.textContent = message; el.className = `notice show ${type === 'error' ? 'error' : 'success'}`;
  }
  async function load() {
    state.data = await api('/api/admin/production/bootstrap');
    render();
  }
  function metric(label, value, hint) { return `<div class="quick-stat"><div class="quick-stat__label">${escapeHtml(label)}</div><div class="quick-stat__value">${escapeHtml(value)}</div><div class="quick-stat__hint">${escapeHtml(hint)}</div></div>`; }
  function render() {
    const root = byId('productionContent'); if (!root || !state.data) return;
    if (state.view === 'materials') return renderMaterials(root);
    if (state.view === 'purchases') return renderPurchases(root);
    if (state.view === 'structure') return renderStructure(root);
    if (state.view === 'compositions' || state.view === 'orders') {
      root.innerHTML = `<div class="card"><div class="form-empty"><strong>${state.view === 'orders' ? 'Ordens de produção' : 'Composições'}</strong><br>Fundação de dados criada. Esta etapa será liberada após os cadastros de insumos e operações.</div></div>`;
      return;
    }
    const d=state.data, low=d.materials.filter(m=>Number(m.current_stock)<=Number(m.min_stock)&&Number(m.min_stock)>0).length;
    root.innerHTML = `<div class="quick-stats">${metric('Insumos',d.materials.length,'itens cadastrados')}${metric('Estoque baixo',low,'abaixo do mínimo')}${metric('Setores',d.sectors.filter(s=>s.active).length,'setores ativos')}${metric('NF-e importadas',d.imports.length,'últimas importações')}</div>
      <div class="production-grid"><div class="card"><div class="card-head"><h2>Estoque de insumos</h2></div><div class="production-table-wrap">${materialsTable(d.materials.slice(0,8))}</div></div>
      <div class="card"><div class="card-head"><h2>Últimas NF-e</h2></div><div class="production-table-wrap">${importsTable(d.imports.slice(0,8))}</div></div></div>`;
  }
  function materialsTable(items) {
    if (!items.length) return '<div class="form-empty">Nenhum insumo cadastrado.</div>';
    return `<table class="production-table"><thead><tr><th>Código</th><th>Insumo</th><th>Saldo</th><th>Reservado</th><th>Custo médio</th><th>Situação</th></tr></thead><tbody>${items.map(m=>`<tr><td>${escapeHtml(m.code)}</td><td><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.category||'Sem categoria')}</small></td><td>${quantity(m.current_stock)} ${escapeHtml(m.unit_code)}</td><td>${quantity(m.reserved_stock)}</td><td>${money(m.average_cost)}</td><td><span class="badge ${m.active?'badge--ok':'badge--na'}">${m.active?'Ativo':'Inativo'}</span></td></tr>`).join('')}</tbody></table>`;
  }
  function renderMaterials(root) {
    const units=state.data.units;
    root.innerHTML=`<div class="production-grid production-grid--form"><div class="card"><div class="card-head"><h2>Novo insumo</h2></div><form class="card-body" id="materialForm">
      <div class="frow"><div class="fg"><label class="fl">Código *</label><input class="fc" name="code" required placeholder="TEC-001"></div><div class="fg"><label class="fl">Nome *</label><input class="fc" name="name" required placeholder="Tecido poliamida"></div></div>
      <div class="frow"><div class="fg"><label class="fl">Categoria</label><input class="fc" name="category" placeholder="Tecidos"></div><div class="fg"><label class="fl">Unidade de estoque *</label><select class="fc" name="unitId" required>${units.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.code)})</option>`).join('')}</select></div></div>
      <div class="frow"><div class="fg"><label class="fl">Estoque mínimo</label><input class="fc" name="minStock" type="number" min="0" step="0.001" value="0"></div><div class="fg"><label class="fl">Unidade de consumo</label><select class="fc" name="consumptionUnitId"><option value="">Mesma do estoque</option>${units.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.code)})</option>`).join('')}</select></div></div>
      <details><summary>Dados para tecido comprado por peso</summary><div class="frow production-details"><div class="fg"><label class="fl">Gramatura (g/m²)</label><input class="fc" name="nominalGrammage" type="number" min="0" step="0.001"></div><div class="fg"><label class="fl">Largura útil (m)</label><input class="fc" name="nominalWidth" type="number" min="0" step="0.001"></div></div></details>
      <div class="form-actions"><button class="btn btn--primary" type="submit">Cadastrar insumo</button></div></form></div>
      <div class="card"><div class="card-head"><h2>Insumos cadastrados</h2><span class="production-count">${state.data.materials.length}</span></div><div class="production-table-wrap">${materialsTable(state.data.materials)}</div></div></div>`;
    byId('materialForm').addEventListener('submit', saveMaterial);
  }
  async function saveMaterial(event) {
    event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type=submit]'); button.disabled=true;
    try { const data=Object.fromEntries(new FormData(form)); await api('/api/admin/production/materials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); notify('Insumo cadastrado.'); await load(); }
    catch(e){notify(e.message,'error');} finally{button.disabled=false;}
  }
  function importsTable(items) {
    if(!items.length)return '<div class="form-empty">Nenhum XML importado.</div>';
    const labels={pending_mapping:'Pendente',ready:'Pronta',draft_created:'Compra criada',rejected:'Rejeitada'};
    return `<table class="production-table"><thead><tr><th>NF-e</th><th>Fornecedor</th><th>Emissão</th><th>Status</th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${escapeHtml(i.number||'—')}</strong><small>Série ${escapeHtml(i.series||'—')}</small></td><td>${escapeHtml(i.issuer_name||'—')}</td><td>${i.issued_at?new Date(i.issued_at).toLocaleDateString('pt-BR'):'—'}</td><td><span class="badge ${i.status==='draft_created'?'badge--ok':'badge--na'}">${escapeHtml(labels[i.status]||i.status)}</span></td></tr>`).join('')}</tbody></table>`;
  }
  function renderPurchases(root) {
    root.innerHTML=`<div class="card"><div class="card-head"><h2>Importações de NF-e</h2><button class="btn btn--primary btn--sm" id="prodNfeInside" style="margin-left:auto">Importar XML</button></div><div class="production-table-wrap">${importsTable(state.data.imports)}</div></div>`;
    byId('prodNfeInside').addEventListener('click',()=>byId('prodNfeFile').click());
  }
  function renderStructure(root) {
    const d=state.data;
    root.innerHTML=`<div class="production-grid"><div class="card"><div class="card-head"><h2>Novo setor</h2></div><form class="card-body" id="sectorForm"><div class="fg"><label class="fl">Nome *</label><input class="fc" name="name" required placeholder="Corte"></div><div class="frow"><div class="fg"><label class="fl">Capacidade diária</label><input class="fc" name="dailyCapacity" type="number" step="0.001"></div><div class="fg"><label class="fl">Custo indireto/hora</label><input class="fc" name="hourlyOverhead" type="number" step="0.01"></div></div><button class="btn btn--primary" type="submit">Cadastrar setor</button></form></div>
      <div class="card"><div class="card-head"><h2>Nova operação</h2></div><form class="card-body" id="operationForm"><div class="frow"><div class="fg"><label class="fl">Setor *</label><select class="fc" name="sectorId" required><option value="">Selecione</option>${d.sectors.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></div><div class="fg"><label class="fl">Operação *</label><input class="fc" name="name" required placeholder="Cortar enfesto"></div></div><div class="frow"><div class="fg"><label class="fl">Forma de custo</label><select class="fc" name="costMethod"><option value="piece">Por peça</option><option value="hour">Por hora</option><option value="batch">Por lote</option></select></div><div class="fg"><label class="fl">Custo padrão</label><input class="fc" name="standardCost" type="number" step="0.01"></div></div><div class="fg"><label class="fl">Tempo padrão (min)</label><input class="fc" name="standardMinutes" type="number" step="0.001"></div><button class="btn btn--primary" type="submit">Cadastrar operação</button></form></div></div>
      <div class="card production-spacer"><div class="card-head"><h2>Estrutura produtiva</h2></div><div class="production-table-wrap"><table class="production-table"><thead><tr><th>Setor</th><th>Operação</th><th>Tempo padrão</th><th>Custo</th></tr></thead><tbody>${d.operations.map(o=>`<tr><td>${escapeHtml(o.sector_name)}</td><td><strong>${escapeHtml(o.name)}</strong></td><td>${quantity(o.standard_minutes)} min</td><td>${money(o.standard_cost)} / ${{piece:'peça',hour:'hora',batch:'lote'}[o.cost_method]||o.cost_method}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma operação cadastrada.</td></tr>'}</tbody></table></div></div>`;
    byId('sectorForm').addEventListener('submit',e=>saveSimple(e,'sectors','Setor cadastrado.'));
    byId('operationForm').addEventListener('submit',e=>saveSimple(e,'operations','Operação cadastrada.'));
  }
  async function saveSimple(event,endpoint,message){event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api(`/api/admin/production/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});notify(message);await load();}catch(e){notify(e.message,'error');}finally{button.disabled=false;}}
  async function importNfe(file) {
    const form=new FormData();form.append('xml',file);notify('Lendo XML da NF-e…');
    try { const result=await api('/api/admin/production/nfe-imports',{method:'POST',body:form}); state.pendingNfe={id:result.id,nfe:result.nfe}; await load(); renderNfeMapping(); }
    catch(e){notify(e.message,'error');}
  }
  function renderNfeMapping(){
    const pending=state.pendingNfe,root=byId('productionContent');if(!pending||!root)return;state.view='purchases';document.querySelectorAll('.production-subtab').forEach(b=>b.classList.toggle('active',b.dataset.productionView==='purchases'));
    const options=state.data.materials.map(m=>`<option value="${m.id}">${escapeHtml(m.code)} — ${escapeHtml(m.name)}</option>`).join('');
    root.innerHTML=`<div class="card"><div class="card-head"><h2>Conferir NF-e ${escapeHtml(pending.nfe.number)}</h2><span class="production-count">${escapeHtml(pending.nfe.issuer.name)}</span></div><div class="card-body"><div class="nfe-summary"><span>Chave <strong>${escapeHtml(pending.nfe.accessKey)}</strong></span><span>Total <strong>${money(pending.nfe.totals.invoice)}</strong></span></div><p class="screen-copy">Associe cada item fiscal ao insumo correspondente. Nenhum estoque será alterado nesta etapa.</p></div><div class="production-table-wrap"><table class="production-table"><thead><tr><th>Item da NF-e</th><th>Qtd.</th><th>Valor</th><th>Insumo Lemoov *</th><th>Conversão</th></tr></thead><tbody>${pending.nfe.items.map((i,index)=>`<tr data-nfe-row data-code="${escapeHtml(i.externalCode)}"><td><strong>${escapeHtml(i.description)}</strong><small>${escapeHtml(i.externalCode)} · ${escapeHtml(i.unit)}</small></td><td>${quantity(i.quantity)}</td><td>${money(i.total)}</td><td><select class="fc" data-material><option value="">Selecione…</option>${options}</select></td><td><input class="fc" data-factor type="number" min="0.000001" step="0.000001" value="1" title="Quantidade em estoque para cada unidade fiscal"></td></tr>`).join('')}</tbody></table></div><div class="card-body production-actions"><button class="btn btn--ghost" id="cancelNfeMapping">Deixar pendente</button><button class="btn btn--primary" id="createNfeDraft">Criar compra em rascunho</button></div></div>`;
    byId('cancelNfeMapping').addEventListener('click',()=>{state.pendingNfe=null;render();}); byId('createNfeDraft').addEventListener('click',createNfeDraft);
  }
  async function createNfeDraft(){const rows=[...document.querySelectorAll('[data-nfe-row]')];const items=rows.map(r=>({externalCode:r.dataset.code,materialId:r.querySelector('[data-material]').value,conversionFactor:r.querySelector('[data-factor]').value}));const button=byId('createNfeDraft');button.disabled=true;try{await api(`/api/admin/production/nfe-imports/${state.pendingNfe.id}/create-draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});state.pendingNfe=null;notify('NF-e conferida e compra criada em rascunho.');await load();}catch(e){notify(e.message,'error');button.disabled=false;}}
  function bind(){
    document.querySelectorAll('.tab-btn[data-tab="producao"]').forEach(b=>b.addEventListener('click',()=>load().catch(e=>notify(e.message,'error'))));
    document.querySelectorAll('.production-subtab').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.productionView;document.querySelectorAll('.production-subtab').forEach(x=>x.classList.toggle('active',x===b));render();}));
    byId('prodNfeButton')?.addEventListener('click',()=>byId('prodNfeFile').click());
    byId('prodNfeFile')?.addEventListener('change',e=>{const file=e.target.files[0];if(file)importNfe(file);e.target.value='';});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
