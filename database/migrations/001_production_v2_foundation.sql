-- Lemoov Admin — Produção v2
-- Migration 001: unidades, insumos, fornecedores, estrutura produtiva,
-- compras, NF-e, estoque de matéria-prima e composição.
-- Compatível com MySQL 8 / InnoDB / utf8mb4.

CREATE TABLE IF NOT EXISTS lemoov_schema_migrations (
  version VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_units (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  decimal_precision TINYINT UNSIGNED NOT NULL DEFAULT 3,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_suppliers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  document VARCHAR(14) NULL,
  email VARCHAR(200) NULL,
  phone VARCHAR(30) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_production_supplier_document (document)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_materials (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NULL,
  unit_id INT NOT NULL,
  min_stock DECIMAL(18,6) NOT NULL DEFAULT 0,
  current_stock DECIMAL(18,6) NOT NULL DEFAULT 0,
  reserved_stock DECIMAL(18,6) NOT NULL DEFAULT 0,
  average_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
  nominal_grammage DECIMAL(10,3) NULL,
  nominal_width DECIMAL(10,4) NULL,
  consumption_unit_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_material_unit FOREIGN KEY (unit_id) REFERENCES production_units(id),
  CONSTRAINT fk_material_consumption_unit FOREIGN KEY (consumption_unit_id) REFERENCES production_units(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_sectors (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  daily_capacity DECIMAL(12,3) NULL,
  hourly_overhead DECIMAL(14,4) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_operations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sector_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  cost_method ENUM('piece','hour','batch') NOT NULL DEFAULT 'piece',
  standard_minutes DECIMAL(12,3) NOT NULL DEFAULT 0,
  standard_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_operation_sector (sector_id),
  CONSTRAINT fk_operation_sector FOREIGN KEY (sector_id) REFERENCES production_sectors(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_purchases (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NULL,
  source ENUM('manual','nfe_xml') NOT NULL DEFAULT 'manual',
  nfe_key VARCHAR(44) NULL,
  document_number VARCHAR(30) NULL,
  document_series VARCHAR(10) NULL,
  issued_at DATETIME NULL,
  status ENUM('draft','open','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  products_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  freight_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  invoice_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_material_purchase_nfe (nfe_key),
  INDEX idx_purchase_supplier (supplier_id),
  INDEX idx_purchase_status (status),
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_purchase_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  material_id INT NULL,
  external_code VARCHAR(100) NULL,
  ean VARCHAR(30) NULL,
  description VARCHAR(255) NOT NULL,
  ncm VARCHAR(20) NULL,
  cfop VARCHAR(10) NULL,
  fiscal_unit VARCHAR(20) NULL,
  ordered_qty DECIMAL(18,6) NOT NULL,
  conversion_factor DECIMAL(18,6) NOT NULL DEFAULT 1,
  unit_price DECIMAL(18,6) NOT NULL,
  discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(14,2) NOT NULL,
  taxes_json LONGTEXT NULL,
  INDEX idx_purchase_item_purchase (purchase_id),
  INDEX idx_purchase_item_material (material_id),
  CONSTRAINT fk_purchase_item_purchase FOREIGN KEY (purchase_id) REFERENCES material_purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_item_material FOREIGN KEY (material_id) REFERENCES production_materials(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_nfe_imports (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  access_key VARCHAR(44) NOT NULL UNIQUE,
  file_hash CHAR(64) NOT NULL,
  original_xml MEDIUMBLOB NOT NULL,
  issuer_document VARCHAR(14) NULL,
  issuer_name VARCHAR(200) NULL,
  recipient_document VARCHAR(14) NULL,
  number VARCHAR(30) NULL,
  series VARCHAR(10) NULL,
  issued_at DATETIME NULL,
  normalized_json LONGTEXT NOT NULL,
  status ENUM('pending_mapping','ready','draft_created','rejected') NOT NULL DEFAULT 'pending_mapping',
  error_message VARCHAR(1000) NULL,
  purchase_id INT NULL,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nfe_purchase (purchase_id),
  INDEX idx_nfe_issuer (issuer_document),
  CONSTRAINT fk_nfe_purchase FOREIGN KEY (purchase_id) REFERENCES material_purchases(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_supplier_item_mappings (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  external_code VARCHAR(100) NOT NULL,
  material_id INT NOT NULL,
  conversion_factor DECIMAL(18,6) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_external_item (supplier_id, external_code),
  INDEX idx_mapping_material (material_id),
  CONSTRAINT fk_mapping_supplier FOREIGN KEY (supplier_id) REFERENCES production_suppliers(id),
  CONSTRAINT fk_mapping_material FOREIGN KEY (material_id) REFERENCES production_materials(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_purchase_receipts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  receipt_number INT NOT NULL,
  received_at DATETIME NOT NULL,
  status ENUM('draft','confirmed','reversed') NOT NULL DEFAULT 'draft',
  notes VARCHAR(500) NULL,
  confirmed_by VARCHAR(100) NULL,
  confirmed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_receipt_number (purchase_id, receipt_number),
  CONSTRAINT fk_receipt_purchase FOREIGN KEY (purchase_id) REFERENCES material_purchases(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_purchase_receipt_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL,
  purchase_item_id INT NOT NULL,
  received_qty DECIMAL(18,6) NOT NULL,
  stock_qty DECIMAL(18,6) NOT NULL,
  allocated_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  formed_unit_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
  CONSTRAINT fk_receipt_item_receipt FOREIGN KEY (receipt_id) REFERENCES material_purchase_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_item_purchase_item FOREIGN KEY (purchase_item_id) REFERENCES material_purchase_items(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_purchase_expenses (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL,
  expense_type VARCHAR(80) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  allocation_method ENUM('value','quantity','weight') NOT NULL DEFAULT 'value',
  composes_cost TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_receipt FOREIGN KEY (receipt_id) REFERENCES material_purchase_receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_lots (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  receipt_item_id INT NULL,
  lot_code VARCHAR(100) NULL,
  received_qty DECIMAL(18,6) NOT NULL,
  current_qty DECIMAL(18,6) NOT NULL,
  unit_cost DECIMAL(18,6) NOT NULL,
  actual_grammage DECIMAL(10,3) NULL,
  actual_width DECIMAL(10,4) NULL,
  checked_length DECIMAL(18,6) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_material_lot_balance (material_id, current_qty),
  CONSTRAINT fk_lot_material FOREIGN KEY (material_id) REFERENCES production_materials(id),
  CONSTRAINT fk_lot_receipt_item FOREIGN KEY (receipt_item_id) REFERENCES material_purchase_receipt_items(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_stock_movements (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  lot_id BIGINT NULL,
  movement_type ENUM('receipt','consumption','reversal','inventory_adjustment','loss','supplier_return','manual_issue') NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  alternative_quantity DECIMAL(18,6) NULL,
  unit_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
  origin_type VARCHAR(50) NULL,
  origin_id BIGINT NULL,
  reason VARCHAR(500) NULL,
  actor VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_material_movement (material_id, created_at),
  INDEX idx_movement_origin (origin_type, origin_id),
  CONSTRAINT fk_movement_material FOREIGN KEY (material_id) REFERENCES production_materials(id),
  CONSTRAINT fk_movement_lot FOREIGN KEY (lot_id) REFERENCES material_lots(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_headers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  variant_key VARCHAR(160) NULL,
  version INT NOT NULL,
  yield_qty DECIMAL(12,3) NOT NULL DEFAULT 1,
  default_loss_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
  status ENUM('draft','active','inactive') NOT NULL DEFAULT 'draft',
  valid_from DATE NULL,
  valid_to DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bom_version (product_id, variant_key, version),
  INDEX idx_bom_active_period (product_id, variant_key, status, valid_from, valid_to)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_materials (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bom_id INT NOT NULL,
  material_id INT NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  unit_id INT NOT NULL,
  loss_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
  CONSTRAINT fk_bom_material_header FOREIGN KEY (bom_id) REFERENCES bom_headers(id) ON DELETE CASCADE,
  CONSTRAINT fk_bom_material_material FOREIGN KEY (material_id) REFERENCES production_materials(id),
  CONSTRAINT fk_bom_material_unit FOREIGN KEY (unit_id) REFERENCES production_units(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_routes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bom_id INT NOT NULL,
  operation_id INT NOT NULL,
  sequence_number INT NOT NULL,
  standard_minutes DECIMAL(12,3) NOT NULL DEFAULT 0,
  standard_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
  executor_type ENUM('internal','third_party') NOT NULL DEFAULT 'internal',
  UNIQUE KEY uq_bom_route_sequence (bom_id, sequence_number),
  CONSTRAINT fk_bom_route_header FOREIGN KEY (bom_id) REFERENCES bom_headers(id) ON DELETE CASCADE,
  CONSTRAINT fk_bom_route_operation FOREIGN KEY (operation_id) REFERENCES production_operations(id)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO production_units (code, name, decimal_precision) VALUES
  ('UN', 'Unidade', 0),
  ('M', 'Metro', 3),
  ('KG', 'Quilograma', 3),
  ('RL', 'Rolo', 0),
  ('CX', 'Caixa', 0);

INSERT IGNORE INTO lemoov_schema_migrations (version)
VALUES ('001_production_v2_foundation');

