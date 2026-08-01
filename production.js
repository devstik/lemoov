const crypto = require('crypto');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');

const CHARS = ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';

async function initProductionSchema(pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS production_units (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(80) NOT NULL, decimal_precision TINYINT UNSIGNED NOT NULL DEFAULT 3,
      active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS production_suppliers (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL,
      document VARCHAR(14) NULL, email VARCHAR(200) NULL, phone VARCHAR(30) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_production_supplier_document (document)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS production_materials (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL, category VARCHAR(100) NULL, unit_id INT NOT NULL,
      min_stock DECIMAL(18,6) NOT NULL DEFAULT 0, current_stock DECIMAL(18,6) NOT NULL DEFAULT 0,
      reserved_stock DECIMAL(18,6) NOT NULL DEFAULT 0, average_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
      nominal_grammage DECIMAL(10,3) NULL, nominal_width DECIMAL(10,4) NULL,
      consumption_unit_id INT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_material_unit FOREIGN KEY (unit_id) REFERENCES production_units(id),
      CONSTRAINT fk_material_consumption_unit FOREIGN KEY (consumption_unit_id) REFERENCES production_units(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS production_sectors (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE,
      description VARCHAR(500) NULL, daily_capacity DECIMAL(12,3) NULL,
      hourly_overhead DECIMAL(14,4) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS production_operations (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, sector_id INT NOT NULL, name VARCHAR(160) NOT NULL,
      cost_method ENUM('piece','hour','batch') NOT NULL DEFAULT 'piece',
      standard_minutes DECIMAL(12,3) NOT NULL DEFAULT 0, standard_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_operation_sector FOREIGN KEY (sector_id) REFERENCES production_sectors(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS material_purchases (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, supplier_id INT NULL, source ENUM('manual','nfe_xml') NOT NULL DEFAULT 'manual',
      nfe_key VARCHAR(44) NULL, document_number VARCHAR(30) NULL, document_series VARCHAR(10) NULL,
      issued_at DATETIME NULL, status ENUM('draft','open','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
      products_total DECIMAL(14,2) NOT NULL DEFAULT 0, freight_total DECIMAL(14,2) NOT NULL DEFAULT 0,
      discount_total DECIMAL(14,2) NOT NULL DEFAULT 0, other_total DECIMAL(14,2) NOT NULL DEFAULT 0,
      invoice_total DECIMAL(14,2) NOT NULL DEFAULT 0, created_by VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_material_purchase_nfe (nfe_key), CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS material_purchase_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, purchase_id INT NOT NULL, material_id INT NULL,
      external_code VARCHAR(100) NULL, ean VARCHAR(30) NULL, description VARCHAR(255) NOT NULL,
      ncm VARCHAR(20) NULL, cfop VARCHAR(10) NULL, fiscal_unit VARCHAR(20) NULL,
      ordered_qty DECIMAL(18,6) NOT NULL, conversion_factor DECIMAL(18,6) NOT NULL DEFAULT 1,
      unit_price DECIMAL(18,6) NOT NULL, discount DECIMAL(14,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(14,2) NOT NULL, taxes_json LONGTEXT NULL,
      CONSTRAINT fk_purchase_item_purchase FOREIGN KEY (purchase_id) REFERENCES material_purchases(id) ON DELETE CASCADE,
      CONSTRAINT fk_purchase_item_material FOREIGN KEY (material_id) REFERENCES production_materials(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS material_nfe_imports (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, access_key VARCHAR(44) NOT NULL UNIQUE,
      file_hash CHAR(64) NOT NULL, original_xml MEDIUMBLOB NOT NULL, issuer_document VARCHAR(14) NULL,
      issuer_name VARCHAR(200) NULL, recipient_document VARCHAR(14) NULL, number VARCHAR(30) NULL,
      series VARCHAR(10) NULL, issued_at DATETIME NULL, normalized_json LONGTEXT NOT NULL,
      status ENUM('pending_mapping','ready','draft_created','rejected') NOT NULL DEFAULT 'pending_mapping',
      error_message VARCHAR(1000) NULL, purchase_id INT NULL, created_by VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_nfe_purchase FOREIGN KEY (purchase_id) REFERENCES material_purchases(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS material_supplier_item_mappings (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, supplier_id INT NOT NULL, external_code VARCHAR(100) NOT NULL,
      material_id INT NOT NULL, conversion_factor DECIMAL(18,6) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_supplier_external_item (supplier_id, external_code),
      CONSTRAINT fk_mapping_supplier FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id),
      CONSTRAINT fk_mapping_material FOREIGN KEY (material_id) REFERENCES production_materials(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS material_stock_movements (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, material_id INT NOT NULL,
      movement_type ENUM('receipt','consumption','reversal','inventory_adjustment','loss','supplier_return','manual_issue') NOT NULL,
      quantity DECIMAL(18,6) NOT NULL, alternative_quantity DECIMAL(18,6) NULL,
      unit_cost DECIMAL(18,6) NOT NULL DEFAULT 0, origin_type VARCHAR(50) NULL, origin_id BIGINT NULL,
      reason VARCHAR(500) NULL, actor VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_material_movement (material_id, created_at),
      CONSTRAINT fk_movement_material FOREIGN KEY (material_id) REFERENCES production_materials(id)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS bom_headers (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, variant_key VARCHAR(160) NULL,
      version INT NOT NULL, yield_qty DECIMAL(12,3) NOT NULL DEFAULT 1, default_loss_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
      status ENUM('draft','active','inactive') NOT NULL DEFAULT 'draft', valid_from DATE NULL, valid_to DATE NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bom_version (product_id, variant_key, version)
    )${CHARS}`,
    `CREATE TABLE IF NOT EXISTS bom_materials (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, bom_id INT NOT NULL, material_id INT NOT NULL,
      quantity DECIMAL(18,6) NOT NULL, unit_id INT NOT NULL, loss_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
      CONSTRAINT fk_bom_material_header FOREIGN KEY (bom_id) REFERENCES bom_headers(id) ON DELETE CASCADE,
      CONSTRAINT fk_bom_material_material FOREIGN KEY (material_id) REFERENCES production_materials(id),
      CONSTRAINT fk_bom_material_unit FOREIGN KEY (unit_id) REFERENCES production_units(id)
    )${CHARS}`
  ];
  for (const sql of statements) await pool.execute(sql);
  // Migração compatível com a primeira versão, que armazenava o XML em arquivo privado.
  try { await pool.execute('ALTER TABLE material_nfe_imports ADD COLUMN original_xml MEDIUMBLOB NULL AFTER file_hash'); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  try { await pool.execute('ALTER TABLE material_nfe_imports MODIFY original_path VARCHAR(500) NULL'); } catch (error) { if (error.code !== 'ER_BAD_FIELD_ERROR') throw error; }
  await pool.execute(`INSERT IGNORE INTO production_units (code, name, decimal_precision) VALUES ('UN','Unidade',0),('M','Metro',3),('KG','Quilograma',3),('RL','Rolo',0),('CX','Caixa',0)`);
}

function cleanDocument(value) { return String(value || '').replace(/\D/g, '').slice(0, 14) || null; }
function text(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function first(value) { return Array.isArray(value) ? value[0] : value; }
function adminActor(req) { return req.adminSession?.user || 'admin'; }

function parseNfe(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML com declaração externa não permitida.');
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: false });
  const root = parser.parse(xml);
  const proc = root.nfeProc || root.NFe || root;
  const nfe = proc.NFe || proc;
  const info = nfe.infNFe;
  if (!info || !info.ide || !info.emit) throw new Error('O arquivo não contém uma NF-e válida.');
  const idKey = text(info['@_Id']).replace(/^NFe/, '');
  const protocolKey = text(proc?.protNFe?.infProt?.chNFe);
  const accessKey = (protocolKey || idKey).replace(/\D/g, '');
  if (!/^\d{44}$/.test(accessKey)) throw new Error('Chave de acesso da NF-e inválida.');
  const details = (Array.isArray(info.det) ? info.det : [info.det]).filter(Boolean).map((det) => {
    const p = det.prod || {};
    const taxes = det.imposto || {};
    return {
      itemNumber: Number(det['@_nItem']) || 0, externalCode: text(p.cProd), ean: text(p.cEAN),
      description: text(p.xProd), ncm: text(p.NCM), cfop: text(p.CFOP), unit: text(p.uCom),
      quantity: num(p.qCom), unitPrice: num(p.vUnCom), total: num(p.vProd), discount: num(p.vDesc), taxes
    };
  });
  if (!details.length) throw new Error('A NF-e não possui itens.');
  const total = info.total?.ICMSTot || {};
  return {
    accessKey, number: text(info.ide.nNF), series: text(info.ide.serie), issuedAt: text(info.ide.dhEmi || info.ide.dEmi),
    issuer: { document: cleanDocument(info.emit.CNPJ || info.emit.CPF), name: text(info.emit.xNome) },
    recipient: { document: cleanDocument(info.dest?.CNPJ || info.dest?.CPF), name: text(info.dest?.xNome) },
    totals: { products: num(total.vProd), freight: num(total.vFrete), discount: num(total.vDesc), other: num(total.vOutro), invoice: num(total.vNF) },
    items: details
  };
}

function registerProductionRoutes({ app, pool, authRequired }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'text/xml' || file.mimetype === 'application/xml' || /\.xml$/i.test(file.originalname)) });
  const route = (method, url, handler) => app[method](url, authRequired, async (req, res) => {
    try { await initProductionSchema(pool); await handler(req, res); }
    catch (error) { console.error(`[production] ${method.toUpperCase()} ${url}:`, error); res.status(error.status || 500).json({ ok: false, error: error.message || 'Erro interno.' }); }
  });

  route('get', '/api/admin/production/bootstrap', async (_req, res) => {
    const [[units], [materials], [suppliers], [sectors], [operations], [imports]] = await Promise.all([
      pool.execute('SELECT * FROM production_units WHERE active=1 ORDER BY name'),
      pool.execute(`SELECT m.*, u.code unit_code, cu.code consumption_unit_code FROM production_materials m JOIN production_units u ON u.id=m.unit_id LEFT JOIN production_units cu ON cu.id=m.consumption_unit_id ORDER BY m.name`),
      pool.execute('SELECT * FROM production_suppliers ORDER BY name'),
      pool.execute('SELECT * FROM production_sectors ORDER BY name'),
      pool.execute('SELECT o.*, s.name sector_name FROM production_operations o JOIN production_sectors s ON s.id=o.sector_id ORDER BY s.name,o.name'),
      pool.execute('SELECT id,access_key,issuer_name,number,series,issued_at,status,purchase_id,created_at FROM material_nfe_imports ORDER BY id DESC LIMIT 50')
    ]);
    res.json({ ok: true, units, materials, suppliers, sectors, operations, imports });
  });

  route('post', '/api/admin/production/materials', async (req, res) => {
    const b = req.body || {}; if (!text(b.code) || !text(b.name) || !Number(b.unitId)) return res.status(400).json({ ok:false,error:'Código, nome e unidade são obrigatórios.' });
    const [result] = await pool.execute(`INSERT INTO production_materials (code,name,category,unit_id,min_stock,nominal_grammage,nominal_width,consumption_unit_id) VALUES (?,?,?,?,?,?,?,?)`, [text(b.code).toUpperCase(),text(b.name),text(b.category)||null,Number(b.unitId),num(b.minStock),b.nominalGrammage?num(b.nominalGrammage):null,b.nominalWidth?num(b.nominalWidth):null,b.consumptionUnitId?Number(b.consumptionUnitId):null]);
    res.status(201).json({ ok:true,id:result.insertId });
  });
  route('put', '/api/admin/production/materials/:id', async (req, res) => {
    const b=req.body||{}; await pool.execute(`UPDATE production_materials SET code=?,name=?,category=?,unit_id=?,min_stock=?,nominal_grammage=?,nominal_width=?,consumption_unit_id=?,active=? WHERE id=?`,[text(b.code).toUpperCase(),text(b.name),text(b.category)||null,Number(b.unitId),num(b.minStock),b.nominalGrammage?num(b.nominalGrammage):null,b.nominalWidth?num(b.nominalWidth):null,b.consumptionUnitId?Number(b.consumptionUnitId):null,b.active===false?0:1,Number(req.params.id)]); res.json({ok:true});
  });
  route('post', '/api/admin/production/suppliers', async (req,res)=>{ const b=req.body||{}; if(!text(b.name)) return res.status(400).json({ok:false,error:'Nome obrigatório.'}); const [r]=await pool.execute('INSERT INTO production_suppliers (name,document,email,phone) VALUES (?,?,?,?)',[text(b.name),cleanDocument(b.document),text(b.email)||null,text(b.phone)||null]); res.status(201).json({ok:true,id:r.insertId}); });
  route('post', '/api/admin/production/sectors', async (req,res)=>{ const b=req.body||{}; if(!text(b.name)) return res.status(400).json({ok:false,error:'Nome obrigatório.'}); const [r]=await pool.execute('INSERT INTO production_sectors (name,description,daily_capacity,hourly_overhead) VALUES (?,?,?,?)',[text(b.name),text(b.description)||null,b.dailyCapacity?num(b.dailyCapacity):null,num(b.hourlyOverhead)]); res.status(201).json({ok:true,id:r.insertId}); });
  route('post', '/api/admin/production/operations', async (req,res)=>{ const b=req.body||{}; if(!text(b.name)||!Number(b.sectorId)) return res.status(400).json({ok:false,error:'Nome e setor obrigatórios.'}); const method=['piece','hour','batch'].includes(b.costMethod)?b.costMethod:'piece'; const [r]=await pool.execute('INSERT INTO production_operations (sector_id,name,cost_method,standard_minutes,standard_cost) VALUES (?,?,?,?,?)',[Number(b.sectorId),text(b.name),method,num(b.standardMinutes),num(b.standardCost)]); res.status(201).json({ok:true,id:r.insertId}); });

  app.post('/api/admin/production/nfe-imports', authRequired, upload.single('xml'), async (req,res)=>{
    try {
      await initProductionSchema(pool); if(!req.file) return res.status(400).json({ok:false,error:'Selecione um arquivo XML.'});
      const xml=req.file.buffer.toString('utf8'); const parsed=parseNfe(xml); const hash=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const [existing]=await pool.execute('SELECT id FROM material_nfe_imports WHERE access_key=?',[parsed.accessKey]); if(existing.length) return res.status(409).json({ok:false,error:'Esta NF-e já foi importada.',id:existing[0].id});
      const [result]=await pool.execute(`INSERT INTO material_nfe_imports (access_key,file_hash,original_xml,issuer_document,issuer_name,recipient_document,number,series,issued_at,normalized_json,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[parsed.accessKey,hash,req.file.buffer,parsed.issuer.document,parsed.issuer.name,parsed.recipient.document,parsed.number,parsed.series,parsed.issuedAt?new Date(parsed.issuedAt):null,JSON.stringify(parsed),'pending_mapping',adminActor(req)]);
      res.status(201).json({ok:true,id:result.insertId,nfe:parsed});
    } catch(error) { console.error('[nfe-import]',error); res.status(error.code==='ER_DUP_ENTRY'?409:400).json({ok:false,error:error.message||'XML inválido.'}); }
  });
  route('get','/api/admin/production/nfe-imports/:id',async(req,res)=>{ const [rows]=await pool.execute('SELECT id,access_key,file_hash,issuer_document,issuer_name,recipient_document,number,series,issued_at,normalized_json,status,error_message,purchase_id,created_by,created_at FROM material_nfe_imports WHERE id=?',[Number(req.params.id)]); if(!rows.length)return res.status(404).json({ok:false,error:'Importação não encontrada.'}); const item=rows[0]; item.normalized=JSON.parse(item.normalized_json); delete item.normalized_json; const [supplier]=item.issuer_document?await pool.execute('SELECT id,name FROM production_suppliers WHERE document=?',[item.issuer_document]):[[]]; const [maps]=supplier.length?await pool.execute('SELECT external_code,material_id,conversion_factor FROM material_supplier_item_mappings WHERE supplier_id=?',[supplier[0].id]):[[]]; res.json({ok:true,import:item,supplier:first(supplier)||null,mappings:maps}); });
  route('post','/api/admin/production/nfe-imports/:id/create-draft',async(req,res)=>{
    const importId=Number(req.params.id), mappings=Array.isArray(req.body?.items)?req.body.items:[]; const conn=await pool.getConnection();
    try { await conn.beginTransaction(); const [rows]=await conn.execute('SELECT * FROM material_nfe_imports WHERE id=? FOR UPDATE',[importId]); if(!rows.length){await conn.rollback();return res.status(404).json({ok:false,error:'Importação não encontrada.'});} const imp=rows[0]; if(imp.purchase_id){await conn.rollback();return res.status(409).json({ok:false,error:'Esta NF-e já gerou uma compra.'});} const nfe=JSON.parse(imp.normalized_json); let [suppliers]=await conn.execute('SELECT id FROM production_suppliers WHERE document=?',[imp.issuer_document]); let supplierId=suppliers[0]?.id; if(!supplierId){const [sr]=await conn.execute('INSERT INTO production_suppliers (name,document) VALUES (?,?)',[imp.issuer_name,imp.issuer_document]);supplierId=sr.insertId;}
      const mapByCode=new Map(mappings.map(m=>[String(m.externalCode),m])); for(const item of nfe.items){const m=mapByCode.get(String(item.externalCode)); if(!m?.materialId) throw new Error(`Associe o item "${item.description}" a um insumo.`);}
      const [pr]=await conn.execute(`INSERT INTO material_purchases (supplier_id,source,nfe_key,document_number,document_series,issued_at,status,products_total,freight_total,discount_total,other_total,invoice_total,created_by) VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?)`,[supplierId,'nfe_xml',nfe.accessKey,nfe.number,nfe.series,nfe.issuedAt?new Date(nfe.issuedAt):null,nfe.totals.products,nfe.totals.freight,nfe.totals.discount,nfe.totals.other,nfe.totals.invoice,adminActor(req)]);
      for(const item of nfe.items){const m=mapByCode.get(String(item.externalCode)),factor=num(m.conversionFactor)||1; await conn.execute(`INSERT INTO material_purchase_items (purchase_id,material_id,external_code,ean,description,ncm,cfop,fiscal_unit,ordered_qty,conversion_factor,unit_price,discount,total_price,taxes_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[pr.insertId,Number(m.materialId),item.externalCode||null,item.ean||null,item.description,item.ncm||null,item.cfop||null,item.unit||null,item.quantity,factor,item.unitPrice,item.discount,item.total,JSON.stringify(item.taxes||{})]); await conn.execute(`INSERT INTO material_supplier_item_mappings (supplier_id,external_code,material_id,conversion_factor) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE material_id=VALUES(material_id),conversion_factor=VALUES(conversion_factor)`,[supplierId,item.externalCode,Number(m.materialId),factor]); }
      await conn.execute(`UPDATE material_nfe_imports SET status='draft_created',purchase_id=? WHERE id=?`,[pr.insertId,importId]); await conn.commit(); res.status(201).json({ok:true,purchaseId:pr.insertId});
    } catch(error){await conn.rollback().catch(()=>{}); throw error;} finally{conn.release();}
  });
}

module.exports = { initProductionSchema, registerProductionRoutes, parseNfe };
