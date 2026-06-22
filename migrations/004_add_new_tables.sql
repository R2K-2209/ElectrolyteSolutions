-- Migration 004: Add new tables for procurement, warranty, and audit tracking
-- Date: 2026-06-17
-- Description: Adds purchase_orders, purchase_order_items, warranty_claims, and audit_log tables
-- Compatible with existing database1.sql schema (PostgreSQL 18.4)

BEGIN;

-- ============================================================================
-- 1. PURCHASE ORDERS — Track procurement lifecycle for spare parts
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_name VARCHAR(255) NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'ORDERED', 'RECEIVED', 'CANCELLED')),
    total_amount NUMERIC(12,2) DEFAULT 0,
    notes TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE purchase_orders IS 'Tracks procurement orders for spare parts from vendors';
COMMENT ON COLUMN purchase_orders.po_number IS 'Unique purchase order number (e.g. PO-2026-0001)';
COMMENT ON COLUMN purchase_orders.status IS 'Order lifecycle: PENDING → APPROVED → ORDERED → RECEIVED or CANCELLED';

-- ============================================================================
-- 2. PURCHASE ORDER ITEMS — Line items for each purchase order
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_cost NUMERIC(10,2),
    received_quantity INTEGER DEFAULT 0 CHECK (received_quantity >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE purchase_order_items IS 'Individual spare part line items within a purchase order';
COMMENT ON COLUMN purchase_order_items.received_quantity IS 'Actual quantity received (may differ from ordered quantity)';

-- ============================================================================
-- 3. WARRANTY CLAIMS — Track warranty information for repaired products
-- ============================================================================

CREATE TABLE IF NOT EXISTS warranty_claims (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    claim_number VARCHAR(100) UNIQUE,
    claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
    warranty_expiry_date DATE,
    claim_status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (claim_status IN ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')),
    claim_type VARCHAR(50),
    description TEXT,
    resolution TEXT,
    resolved_date DATE,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE warranty_claims IS 'Warranty claim tracking linked to repair jobs';
COMMENT ON COLUMN warranty_claims.claim_status IS 'Claim lifecycle: OPEN → IN_REVIEW → APPROVED/REJECTED → CLOSED';
COMMENT ON COLUMN warranty_claims.claim_type IS 'Type of warranty claim (e.g. Manufacturing Defect, DOA, Field Failure)';

-- ============================================================================
-- 4. AUDIT LOG — Track all data changes for compliance
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_log IS 'Immutable audit trail of all data changes for compliance and debugging';
COMMENT ON COLUMN audit_log.old_data IS 'JSONB snapshot of the row before the change (NULL for INSERTs)';
COMMENT ON COLUMN audit_log.new_data IS 'JSONB snapshot of the row after the change (NULL for DELETEs)';

-- ============================================================================
-- 5. INDEXES — For query performance
-- ============================================================================

-- Purchase Orders indexes
CREATE INDEX IF NOT EXISTS idx_po_vendor_name ON purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_order_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders(created_at);

-- Purchase Order Items indexes
CREATE INDEX IF NOT EXISTS idx_poi_po_id ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_spare_part_id ON purchase_order_items(spare_part_id);

-- Warranty Claims indexes
CREATE INDEX IF NOT EXISTS idx_wc_job_id ON warranty_claims(job_id);
CREATE INDEX IF NOT EXISTS idx_wc_claim_status ON warranty_claims(claim_status);
CREATE INDEX IF NOT EXISTS idx_wc_claim_date ON warranty_claims(claim_date);
CREATE INDEX IF NOT EXISTS idx_wc_warranty_expiry ON warranty_claims(warranty_expiry_date);
CREATE INDEX IF NOT EXISTS idx_wc_created_at ON warranty_claims(created_at);

-- Audit Log indexes (optimized for lookups by table + record and by time)
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_changed_by ON audit_log(changed_by);

-- ============================================================================
-- 6. TIMESTAMP TRIGGERS — Auto-update updated_at on modifications
-- ============================================================================

-- Reuse existing update_timestamp() function (already exists in database)
-- CREATE OR REPLACE FUNCTION update_timestamp() RETURNS TRIGGER AS $$
-- BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
-- $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_ts
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_wc_ts
    BEFORE UPDATE ON warranty_claims
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- 7. AUDIT TRIGGER FUNCTION — Automatically logs changes
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), current_setting('app.current_user', true));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), current_setting('app.current_user', true));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), current_setting('app.current_user', true));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_trigger_func() IS 'Generic audit trigger: logs INSERT/UPDATE/DELETE to audit_log table. Uses app.current_user session variable for changed_by.';

-- ============================================================================
-- 8. ATTACH AUDIT TRIGGERS to critical tables
-- ============================================================================

CREATE TRIGGER trg_audit_repair_jobs
    AFTER INSERT OR UPDATE OR DELETE ON repair_jobs
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_audit_repair_details
    AFTER INSERT OR UPDATE OR DELETE ON repair_details
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_audit_dispatch_details
    AFTER INSERT OR UPDATE OR DELETE ON dispatch_details
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_audit_purchase_orders
    AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER trg_audit_warranty_claims
    AFTER INSERT OR UPDATE OR DELETE ON warranty_claims
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============================================================================
-- 9. AUTO-UPDATE stock when PO items are received
-- ============================================================================

CREATE OR REPLACE FUNCTION update_stock_on_po_receive() RETURNS TRIGGER AS $$
DECLARE
    qty_diff INTEGER;
BEGIN
    -- Only trigger when received_quantity increases
    IF TG_OP = 'UPDATE' AND NEW.received_quantity > OLD.received_quantity THEN
        qty_diff := NEW.received_quantity - OLD.received_quantity;

        -- Update spare_parts stock
        UPDATE spare_parts
        SET stock_quantity = stock_quantity + qty_diff,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.spare_part_id;

        -- Log the inventory transaction
        INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, notes)
        VALUES (
            NEW.spare_part_id,
            'STOCK_IN',
            qty_diff,
            'Auto-incremented from PO item #' || NEW.id || ' (PO #' || NEW.po_id || ')'
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_stock_on_po_receive() IS 'Auto-updates spare_parts stock and creates inventory_transaction when PO items are marked as received';

CREATE TRIGGER trg_po_item_received
    AFTER UPDATE ON purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION update_stock_on_po_receive();

COMMIT;
