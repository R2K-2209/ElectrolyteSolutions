-- migrate.sql
-- Full schema migration script with backward compatibility VIEW and TRIGGERS

BEGIN;

-- 1. Rename old table to preserve data safely
ALTER TABLE consolidated_data RENAME TO consolidated_data_old;

-- Drop constraints/indexes on old table so they don't clash
ALTER TABLE consolidated_data_old DROP CONSTRAINT IF EXISTS consolidated_data_pkey CASCADE;
DROP INDEX IF EXISTS idx_consolidated_data_dc_no;
DROP INDEX IF EXISTS idx_consolidated_data_part_code;
DROP INDEX IF EXISTS idx_consolidated_data_product_sr_no;
DROP INDEX IF EXISTS idx_consolidated_data_pcb_sr_no;
DROP INDEX IF EXISTS idx_consolidated_data_created_at;

-- 2. Create New Tables
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    part_code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS engineers CASCADE;

CREATE TABLE IF NOT EXISTS engineers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engineers_name_ci ON engineers (LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS dc_numbers_new (
    id SERIAL PRIMARY KEY,
    dc_number VARCHAR(255) UNIQUE NOT NULL,
    dc_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dc_product_map (
    dc_id INTEGER REFERENCES dc_numbers_new(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (dc_id, product_id)
);

CREATE TABLE IF NOT EXISTS defect_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS failure_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spare_parts (
    id SERIAL PRIMARY KEY,
    part_name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    initial_quantity INTEGER NOT NULL DEFAULT 0,
    reorder_threshold INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bom_new (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location VARCHAR(50) NOT NULL,
    spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE RESTRICT,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, location)
);

CREATE TABLE IF NOT EXISTS repair_jobs (
    id SERIAL PRIMARY KEY,
    sr_no VARCHAR(50) NOT NULL,
    dc_id INTEGER REFERENCES dc_numbers_new(id) ON DELETE RESTRICT,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    bccd_name VARCHAR(255),
    product_sr_no VARCHAR(255) UNIQUE,
    date_of_purchase DATE,
    complaint_no VARCHAR(255),
    defect_id INTEGER REFERENCES defect_types(id) ON DELETE SET NULL,
    defect_raw TEXT,
    visiting_tech_name VARCHAR(255),
    mfg_month_year VARCHAR(50),
    status VARCHAR(50) DEFAULT '',
    pcb_sr_no VARCHAR(255),
    tag_entry_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS repair_details (
    job_id INTEGER PRIMARY KEY REFERENCES repair_jobs(id) ON DELETE CASCADE,
    repair_date DATE,
    testing VARCHAR(10),
    failure_type_id INTEGER REFERENCES failure_types(id) ON DELETE SET NULL,
    failure_raw TEXT,
    rf_observation TEXT,
    analysis TEXT,
    validation_result TEXT,
    component_change TEXT,
    engg_id INTEGER REFERENCES engineers(id) ON DELETE SET NULL,
    consumption_entry_by VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_consumptions (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    bom_id INTEGER REFERENCES bom_new(id) ON DELETE SET NULL,
    spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dispatch_details (
    job_id INTEGER PRIMARY KEY REFERENCES repair_jobs(id) ON DELETE CASCADE,
    dispatch_date DATE,
    dispatch_entry_by VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
    txn_type VARCHAR(20) NOT NULL CHECK (txn_type IN ('STOCK_IN', 'CONSUMED', 'ADJUSTMENT', 'RETURN')),
    quantity INTEGER NOT NULL,
    job_id INTEGER REFERENCES repair_jobs(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Data Migration from consolidated_data_old
INSERT INTO products (part_code, description)
SELECT DISTINCT ON (part_code)
    part_code,
    CASE WHEN product_description IS NOT NULL AND product_description != '' THEN product_description ELSE NULL END
FROM consolidated_data_old
WHERE part_code IS NOT NULL AND part_code != ''
ORDER BY part_code, 
    CASE WHEN product_description IS NOT NULL AND product_description != '' THEN 0 ELSE 1 END;

INSERT INTO branches (name)
SELECT DISTINCT INITCAP(TRIM(branch))
FROM consolidated_data_old
WHERE branch IS NOT NULL AND TRIM(branch) != ''
ORDER BY INITCAP(TRIM(branch))
ON CONFLICT (name) DO NOTHING;

INSERT INTO engineers (name)
SELECT DISTINCT ON (LOWER(TRIM(name))) TRIM(name)
FROM (
    SELECT DISTINCT engg_name AS name FROM consolidated_data_old 
    WHERE engg_name IS NOT NULL AND TRIM(engg_name) != '' AND TRIM(engg_name) != 'NA'
) raw
ORDER BY LOWER(TRIM(name)), name;

INSERT INTO dc_numbers_new (dc_number, dc_date)
SELECT DISTINCT ON (dc_no) dc_no, dc_date
FROM consolidated_data_old
WHERE dc_no IS NOT NULL AND dc_no != ''
ORDER BY dc_no, dc_date DESC NULLS LAST
ON CONFLICT (dc_number) DO NOTHING;

INSERT INTO dc_product_map (dc_id, product_id)
SELECT DISTINCT d.id, p.id
FROM consolidated_data_old cd
JOIN dc_numbers_new d ON d.dc_number = cd.dc_no
JOIN products p ON p.part_code = cd.part_code
WHERE cd.dc_no IS NOT NULL AND cd.dc_no != ''
  AND cd.part_code IS NOT NULL AND cd.part_code != ''
ON CONFLICT DO NOTHING;

INSERT INTO defect_types (name)
SELECT DISTINCT UPPER(TRIM(defect))
FROM consolidated_data_old
WHERE defect IS NOT NULL AND TRIM(defect) != ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO failure_types (name) VALUES 
    ('NOT WORKING'), ('FOUND OK'), ('COMPONENT')
ON CONFLICT (name) DO NOTHING;

-- Map IDs over explicitly to guarantee preservation of row logic
INSERT INTO repair_jobs (
    id, sr_no, dc_id, product_id, branch_id, bccd_name,
    product_sr_no, date_of_purchase, complaint_no,
    defect_id, defect_raw, visiting_tech_name, mfg_month_year,
    status, pcb_sr_no, tag_entry_by, created_at, updated_at
)
SELECT
    cd.id,
    cd.sr_no,
    d.id,
    p.id,
    br.id,
    cd.bccd_name,
    NULLIF(cd.product_sr_no, ''),
    cd.date_of_purchase,
    cd.complaint_no,
    dt.id,
    cd.defect,
    cd.visiting_tech_name,
    cd.mfg_month_year,
    COALESCE(cd.status, ''),
    cd.pcb_sr_no,
    cd.tag_entry_by,
    cd.created_at,
    cd.updated_at
FROM consolidated_data_old cd
LEFT JOIN dc_numbers_new d ON d.dc_number = cd.dc_no
LEFT JOIN products p ON p.part_code = cd.part_code
LEFT JOIN branches br ON br.name = INITCAP(TRIM(cd.branch))
LEFT JOIN defect_types dt ON dt.name = UPPER(TRIM(cd.defect));

SELECT setval('repair_jobs_id_seq', (SELECT MAX(id) FROM repair_jobs));

INSERT INTO repair_details (
    job_id, repair_date, testing, failure_type_id, failure_raw,
    rf_observation, analysis, validation_result, component_change,
    engg_id, consumption_entry_by, updated_at
)
SELECT
    cd.id,
    cd.repair_date,
    cd.testing,
    ft.id,
    cd.failure,
    cd.rf_observation,
    cd.analysis,
    cd.validation_result,
    cd.component_change,
    eng.id,
    cd.consumption_entry_by,
    cd.updated_at
FROM consolidated_data_old cd
LEFT JOIN failure_types ft ON 
    CASE 
        WHEN UPPER(TRIM(cd.failure)) IN ('NOT WORKING', 'NIOT WORKING', 'NOPT WORKING', 
             'NOT BWORKING', 'NOT WOTKING', 'NOT WPRKING', 'NOTWORKING', 'Not Working') 
            THEN 'NOT WORKING'
        WHEN UPPER(TRIM(cd.failure)) IN ('FOUND OK', 'found ok') 
            THEN 'FOUND OK'
        WHEN UPPER(TRIM(cd.failure)) = 'COMPONENT' 
            THEN 'COMPONENT'
        ELSE NULL
    END = ft.name
LEFT JOIN engineers eng ON LOWER(TRIM(eng.name)) = LOWER(TRIM(cd.engg_name))
WHERE cd.repair_date IS NOT NULL 
   OR cd.testing IS NOT NULL 
   OR (cd.engg_name IS NOT NULL AND cd.engg_name != '' AND cd.engg_name != 'NA')
   OR cd.analysis IS NOT NULL
   OR cd.component_change IS NOT NULL
   OR cd.failure IS NOT NULL;

INSERT INTO dispatch_details (job_id, dispatch_date, dispatch_entry_by, updated_at)
SELECT cd.id, cd.dispatch_date, cd.dispatch_entry_by, cd.updated_at
FROM consolidated_data_old cd
WHERE cd.dispatch_date IS NOT NULL 
   OR (cd.dispatch_entry_by IS NOT NULL AND cd.dispatch_entry_by != '');

-- Fix BOM mapping
INSERT INTO bom_new (product_id, location, description, created_at)
SELECT p.id, b.location, b.description, b.created_at
FROM bom b
JOIN products p ON p.part_code = b.part_code
ON CONFLICT (product_id, location) DO NOTHING;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_rj_dc_id ON repair_jobs(dc_id);
CREATE INDEX IF NOT EXISTS idx_rj_product_id ON repair_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_rj_branch_id ON repair_jobs(branch_id);
CREATE INDEX IF NOT EXISTS idx_rj_product_sr_no ON repair_jobs(product_sr_no);
CREATE INDEX IF NOT EXISTS idx_rj_pcb_sr_no ON repair_jobs(pcb_sr_no);
CREATE INDEX IF NOT EXISTS idx_rj_complaint_no ON repair_jobs(complaint_no);
CREATE INDEX IF NOT EXISTS idx_rj_created_at ON repair_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_rj_status ON repair_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rj_sr_no_created ON repair_jobs(sr_no, created_at);
CREATE INDEX IF NOT EXISTS idx_rj_tag_entry_by ON repair_jobs(tag_entry_by);
CREATE INDEX IF NOT EXISTS idx_rd_engg_id ON repair_details(engg_id);
CREATE INDEX IF NOT EXISTS idx_rd_consumption_by ON repair_details(consumption_entry_by);
CREATE INDEX IF NOT EXISTS idx_jc_job_id ON job_consumptions(job_id);
CREATE INDEX IF NOT EXISTS idx_jc_spare_part_id ON job_consumptions(spare_part_id);
CREATE INDEX IF NOT EXISTS idx_sp_stock ON spare_parts(stock_quantity);

-- 5. Triggers for Timestamps and Inventory
CREATE OR REPLACE FUNCTION update_timestamp() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rj_ts BEFORE UPDATE ON repair_jobs FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_rd_ts BEFORE UPDATE ON repair_details FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_dd_ts BEFORE UPDATE ON dispatch_details FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_eng_ts BEFORE UPDATE ON engineers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_dc_ts BEFORE UPDATE ON dc_numbers_new FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_sp_ts BEFORE UPDATE ON spare_parts FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE OR REPLACE FUNCTION update_stock_on_consumption() RETURNS TRIGGER AS $$
BEGIN
    UPDATE spare_parts SET stock_quantity = stock_quantity - NEW.quantity, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.spare_part_id;
    INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, job_id, notes) VALUES (NEW.spare_part_id, 'CONSUMED', -NEW.quantity, NEW.job_id, 'Auto-decremented on job consumption');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consumption_stock AFTER INSERT ON job_consumptions FOR EACH ROW EXECUTE FUNCTION update_stock_on_consumption();

-- 6. The Backward Compatible View
CREATE VIEW consolidated_data AS
SELECT
    rj.id,
    rj.sr_no,
    dc.dc_number AS dc_no,
    dc.dc_date,
    br.name AS branch,
    rj.bccd_name,
    p.description AS product_description,
    rj.product_sr_no,
    rj.date_of_purchase,
    rj.complaint_no,
    p.part_code,
    rj.defect_raw AS defect,
    rj.visiting_tech_name,
    rj.mfg_month_year,
    rd.repair_date,
    rd.testing,
    rd.failure_raw AS failure,
    rj.status,
    rj.pcb_sr_no,
    rd.rf_observation,
    rd.analysis,
    rd.validation_result,
    rd.component_change,
    e.name AS engg_name,
    rj.tag_entry_by,
    rd.consumption_entry_by,
    dd.dispatch_entry_by,
    dd.dispatch_date,
    rj.created_at,
    rj.updated_at
FROM repair_jobs rj
LEFT JOIN dc_numbers_new dc ON rj.dc_id = dc.id
LEFT JOIN branches br ON rj.branch_id = br.id
LEFT JOIN products p ON rj.product_id = p.id
LEFT JOIN repair_details rd ON rj.id = rd.job_id
LEFT JOIN dispatch_details dd ON rj.id = dd.job_id
LEFT JOIN engineers e ON rd.engg_id = e.id;

-- 7. INSTEAD OF Triggers to support App Writes
CREATE OR REPLACE FUNCTION instead_of_insert_consolidated() RETURNS TRIGGER AS $$
DECLARE
    v_dc_id INT; v_product_id INT; v_branch_id INT; v_defect_id INT;
    v_failure_type_id INT; v_engg_id INT; v_job_id INT;
BEGIN
    IF NEW.dc_no IS NOT NULL AND NEW.dc_no != '' THEN
        INSERT INTO dc_numbers_new (dc_number, dc_date) VALUES (NEW.dc_no, NEW.dc_date)
        ON CONFLICT (dc_number) DO UPDATE SET dc_date = COALESCE(dc_numbers_new.dc_date, EXCLUDED.dc_date) RETURNING id INTO v_dc_id;
    END IF;

    IF NEW.part_code IS NOT NULL AND NEW.part_code != '' THEN
        INSERT INTO products (part_code, description) VALUES (NEW.part_code, NEW.product_description)
        ON CONFLICT (part_code) DO UPDATE SET description = COALESCE(products.description, EXCLUDED.description) RETURNING id INTO v_product_id;
    END IF;

    IF NEW.branch IS NOT NULL AND TRIM(NEW.branch) != '' THEN
        INSERT INTO branches (name) VALUES (INITCAP(TRIM(NEW.branch)))
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_branch_id;
    END IF;

    IF NEW.defect IS NOT NULL AND TRIM(NEW.defect) != '' THEN
        INSERT INTO defect_types (name) VALUES (UPPER(TRIM(NEW.defect)))
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_defect_id;
    END IF;

    INSERT INTO repair_jobs (
        sr_no, dc_id, product_id, branch_id, bccd_name, product_sr_no, date_of_purchase, complaint_no,
        defect_id, defect_raw, visiting_tech_name, mfg_month_year, status, pcb_sr_no, tag_entry_by,
        created_at, updated_at
    ) VALUES (
        NEW.sr_no, v_dc_id, v_product_id, v_branch_id, NEW.bccd_name, NEW.product_sr_no, NEW.date_of_purchase, NEW.complaint_no,
        v_defect_id, NEW.defect, NEW.visiting_tech_name, NEW.mfg_month_year, COALESCE(NEW.status, ''), NEW.pcb_sr_no, NEW.tag_entry_by,
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at, CURRENT_TIMESTAMP)
    ) RETURNING id INTO v_job_id;

    IF NEW.failure IS NOT NULL AND TRIM(NEW.failure) != '' THEN
        INSERT INTO failure_types (name) VALUES (UPPER(TRIM(NEW.failure)))
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_failure_type_id;
    END IF;

    IF NEW.engg_name IS NOT NULL AND TRIM(NEW.engg_name) != '' AND TRIM(NEW.engg_name) != 'NA' THEN
        INSERT INTO engineers (name) VALUES (TRIM(NEW.engg_name))
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_engg_id;
    END IF;

    IF NEW.repair_date IS NOT NULL OR NEW.testing IS NOT NULL OR NEW.failure IS NOT NULL OR NEW.analysis IS NOT NULL OR NEW.component_change IS NOT NULL OR NEW.engg_name IS NOT NULL OR NEW.consumption_entry_by IS NOT NULL THEN
        INSERT INTO repair_details (
            job_id, repair_date, testing, failure_type_id, failure_raw, rf_observation, analysis, validation_result,
            component_change, engg_id, consumption_entry_by, updated_at
        ) VALUES (
            v_job_id, NEW.repair_date, NEW.testing, v_failure_type_id, NEW.failure, NEW.rf_observation, NEW.analysis, NEW.validation_result,
            NEW.component_change, v_engg_id, NEW.consumption_entry_by, COALESCE(NEW.updated_at, CURRENT_TIMESTAMP)
        );
    END IF;

    IF NEW.dispatch_date IS NOT NULL OR NEW.dispatch_entry_by IS NOT NULL THEN
        INSERT INTO dispatch_details (job_id, dispatch_date, dispatch_entry_by, updated_at)
        VALUES (v_job_id, NEW.dispatch_date, NEW.dispatch_entry_by, COALESCE(NEW.updated_at, CURRENT_TIMESTAMP));
    END IF;

    NEW.id := v_job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_instead_of_insert_consolidated INSTEAD OF INSERT ON consolidated_data FOR EACH ROW EXECUTE FUNCTION instead_of_insert_consolidated();

CREATE OR REPLACE FUNCTION instead_of_update_consolidated() RETURNS TRIGGER AS $$
DECLARE
    v_dc_id INT; v_product_id INT; v_branch_id INT; v_defect_id INT;
    v_failure_type_id INT; v_engg_id INT;
BEGIN
    IF NEW.dc_no IS DISTINCT FROM OLD.dc_no OR NEW.dc_date IS DISTINCT FROM OLD.dc_date THEN
        IF NEW.dc_no IS NOT NULL AND NEW.dc_no != '' THEN
            INSERT INTO dc_numbers_new (dc_number, dc_date) VALUES (NEW.dc_no, NEW.dc_date)
            ON CONFLICT (dc_number) DO UPDATE SET dc_date = COALESCE(dc_numbers_new.dc_date, EXCLUDED.dc_date) RETURNING id INTO v_dc_id;
        END IF;
    ELSE
        SELECT dc_id INTO v_dc_id FROM repair_jobs WHERE id = OLD.id;
    END IF;

    IF NEW.part_code IS DISTINCT FROM OLD.part_code OR NEW.product_description IS DISTINCT FROM OLD.product_description THEN
        IF NEW.part_code IS NOT NULL AND NEW.part_code != '' THEN
            INSERT INTO products (part_code, description) VALUES (NEW.part_code, NEW.product_description)
            ON CONFLICT (part_code) DO UPDATE SET description = COALESCE(products.description, EXCLUDED.description) RETURNING id INTO v_product_id;
        END IF;
    ELSE
        SELECT product_id INTO v_product_id FROM repair_jobs WHERE id = OLD.id;
    END IF;

    IF NEW.branch IS DISTINCT FROM OLD.branch THEN
        IF NEW.branch IS NOT NULL AND TRIM(NEW.branch) != '' THEN
            INSERT INTO branches (name) VALUES (INITCAP(TRIM(NEW.branch)))
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_branch_id;
        END IF;
    ELSE
        SELECT branch_id INTO v_branch_id FROM repair_jobs WHERE id = OLD.id;
    END IF;

    IF NEW.defect IS DISTINCT FROM OLD.defect THEN
        IF NEW.defect IS NOT NULL AND TRIM(NEW.defect) != '' THEN
            INSERT INTO defect_types (name) VALUES (UPPER(TRIM(NEW.defect)))
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_defect_id;
        END IF;
    ELSE
        SELECT defect_id INTO v_defect_id FROM repair_jobs WHERE id = OLD.id;
    END IF;

    UPDATE repair_jobs SET
        sr_no = NEW.sr_no, dc_id = v_dc_id, product_id = v_product_id, branch_id = v_branch_id,
        bccd_name = NEW.bccd_name, product_sr_no = NEW.product_sr_no, date_of_purchase = NEW.date_of_purchase,
        complaint_no = NEW.complaint_no, defect_id = v_defect_id, defect_raw = NEW.defect,
        visiting_tech_name = NEW.visiting_tech_name, mfg_month_year = NEW.mfg_month_year,
        status = COALESCE(NEW.status, ''), pcb_sr_no = NEW.pcb_sr_no, tag_entry_by = NEW.tag_entry_by,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.id;

    IF NEW.failure IS DISTINCT FROM OLD.failure THEN
        IF NEW.failure IS NOT NULL AND TRIM(NEW.failure) != '' THEN
            INSERT INTO failure_types (name) VALUES (UPPER(TRIM(NEW.failure)))
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_failure_type_id;
        END IF;
    ELSE
        SELECT failure_type_id INTO v_failure_type_id FROM repair_details WHERE job_id = OLD.id;
    END IF;

    IF NEW.engg_name IS DISTINCT FROM OLD.engg_name THEN
        IF NEW.engg_name IS NOT NULL AND TRIM(NEW.engg_name) != '' AND TRIM(NEW.engg_name) != 'NA' THEN
            INSERT INTO engineers (name) VALUES (TRIM(NEW.engg_name))
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_engg_id;
        END IF;
    ELSE
        SELECT engg_id INTO v_engg_id FROM repair_details WHERE job_id = OLD.id;
    END IF;

    IF NEW.repair_date IS NOT NULL OR NEW.testing IS NOT NULL OR NEW.failure IS NOT NULL OR NEW.analysis IS NOT NULL OR NEW.component_change IS NOT NULL OR NEW.engg_name IS NOT NULL OR NEW.consumption_entry_by IS NOT NULL THEN
        INSERT INTO repair_details (
            job_id, repair_date, testing, failure_type_id, failure_raw, rf_observation, analysis, validation_result,
            component_change, engg_id, consumption_entry_by, updated_at
        ) VALUES (
            OLD.id, NEW.repair_date, NEW.testing, v_failure_type_id, NEW.failure, NEW.rf_observation, NEW.analysis, NEW.validation_result,
            NEW.component_change, v_engg_id, NEW.consumption_entry_by, CURRENT_TIMESTAMP
        ) ON CONFLICT (job_id) DO UPDATE SET
            repair_date = EXCLUDED.repair_date, testing = EXCLUDED.testing, failure_type_id = EXCLUDED.failure_type_id,
            failure_raw = EXCLUDED.failure_raw, rf_observation = EXCLUDED.rf_observation, analysis = EXCLUDED.analysis,
            validation_result = EXCLUDED.validation_result, component_change = EXCLUDED.component_change,
            engg_id = EXCLUDED.engg_id, consumption_entry_by = EXCLUDED.consumption_entry_by, updated_at = CURRENT_TIMESTAMP;
    END IF;

    IF NEW.dispatch_date IS NOT NULL OR NEW.dispatch_entry_by IS NOT NULL THEN
        INSERT INTO dispatch_details (job_id, dispatch_date, dispatch_entry_by, updated_at)
        VALUES (OLD.id, NEW.dispatch_date, NEW.dispatch_entry_by, CURRENT_TIMESTAMP)
        ON CONFLICT (job_id) DO UPDATE SET dispatch_date = EXCLUDED.dispatch_date, dispatch_entry_by = EXCLUDED.dispatch_entry_by, updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_instead_of_update_consolidated INSTEAD OF UPDATE ON consolidated_data FOR EACH ROW EXECUTE FUNCTION instead_of_update_consolidated();

CREATE OR REPLACE FUNCTION instead_of_delete_consolidated() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM repair_jobs WHERE id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_instead_of_delete_consolidated INSTEAD OF DELETE ON consolidated_data FOR EACH ROW EXECUTE FUNCTION instead_of_delete_consolidated();

COMMIT;
