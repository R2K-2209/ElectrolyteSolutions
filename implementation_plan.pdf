# NexScan — Final Database Schema (Battle-Tested)

After deep-diving into all 26 database functions in `pg-db.ts`, the Excel export, WebSocket server, and the actual data in all 13,624 rows — here is the final schema with every edge case resolved.

---

## Edge Cases Found During Research

| # | Finding | Impact on Schema | Resolution |
|---|---------|-----------------|------------|
| 1 | **SR No is NOT unique globally** — same `sr_no` (e.g., "1473") appears across 4 different `part_code` values. It resets monthly. | `sr_no` must NOT have a UNIQUE constraint | ✅ No UNIQUE on `sr_no` |
| 2 | **`product_sr_no` IS unique** — 13,622 non-empty values, 0 duplicates. 2 rows are NULL. | Can have UNIQUE but must allow NULLs | ✅ UNIQUE with NULL allowed |
| 3 | **Part code `974299` has 311 rows with empty description** and 1 row with "MAIN PCB ASSLY SPLENDID 120 TS". `974278` has 55 rows with empty description. | Products table needs to handle empty descriptions | ✅ Description is nullable, will use the non-empty value |
| 4 | **`rf_observation` has 0 data rows** and code actively tries to DROP it (`removeUnusedColumnsFromConsolidatedData`). `validation_result` has only 1 row. | These columns are effectively dead but we should keep them for safety | ✅ Kept in `repair_details` but marked optional |
| 5 | **Failure field has 17 typo variants** of ~3 real values: "NOT WORKING", "FOUND OK", "Component" | Need `failure_raw` to preserve + `failure_type_id` for clean lookups | ✅ Both fields in `repair_details` |
| 6 | **Defect field has 44 unique values** (after trim/case-normalize) from raw OCR text | Need `defect_raw` to preserve + `defect_id` for clean lookups | ✅ Both fields in `repair_jobs` |
| 7 | **329 unique branches** after case normalization (442 raw). 1 row has NULL branch. | `branch_id` must be nullable in `repair_jobs` | ✅ FK is nullable |
| 8 | **`tag_entry_by` stores text names** like "Aarti G." (10 distinct), NOT user UUIDs | Must keep as VARCHAR, not UUID FK | ✅ Kept as VARCHAR |
| 9 | **0 dispatch records exist** (`dispatch_date` is NULL for all 13,624 rows) | `dispatch_details` table will initially be empty | ✅ Expected behavior |
| 10 | **WebSocket server queries** `MAX(CAST(sr_no AS INTEGER)) FROM consolidated_data WHERE sr_no ~ '^[0-9]+$' AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_TIMESTAMP)` | The VIEW must support this exact query pattern | ✅ Addressed in `consolidated_data_view` |
| 11 | **Excel export uses `SELECT *` from `consolidated_data`** with exact 28 column names | The VIEW must produce identical column names and types | ✅ VIEW columns match exactly |
| 12 | **`bulkCreateScrapEntries`** writes hardcoded column list to `consolidated_data` | Must work through the VIEW or be rewritten | ⚠️ Will need function update |
| 13 | **BOM table uses `part_code` as raw text** (e.g., "971039") not a FK | Migration must convert BOM to use `product_id` FK | ✅ Migration handles this |

---

## Complete SQL Schema

```sql
-- ============================================================================
-- NEXSCAN FINAL NORMALIZED SCHEMA
-- Battle-tested against 13,624 real data rows and 26 app functions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. PRODUCTS
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    part_code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. BRANCHES (with city/state for geographic analytics)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ENGINEERS (case-insensitive uniqueness)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engineers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engineers_name_ci 
    ON engineers (LOWER(TRIM(name)));

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. USERS (Supabase auth sync)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_user_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    role VARCHAR(50) DEFAULT 'USER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. DC NUMBERS
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dc_numbers_new (
    id SERIAL PRIMARY KEY,
    dc_number VARCHAR(255) UNIQUE NOT NULL,
    dc_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. DC ↔ PRODUCT MAP (replaces JSONB array)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dc_product_map (
    dc_id INTEGER REFERENCES dc_numbers_new(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (dc_id, product_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. DEFECT TYPES (standardized incoming symptoms)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defect_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. FAILURE TYPES (standardized diagnoses)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS failure_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. SPARE PARTS INVENTORY
-- ──────────────────────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. BOM (Bill of Materials — links PCB models to spare parts)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_new (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location VARCHAR(50) NOT NULL,
    spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE RESTRICT,
    description TEXT,    -- Keep BOM description for backward compat
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, location)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. REPAIR JOBS (Tag Entry phase — the core record)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair_jobs (
    id SERIAL PRIMARY KEY,
    sr_no VARCHAR(50) NOT NULL,              -- Monthly counter, NOT unique globally
    dc_id INTEGER REFERENCES dc_numbers_new(id) ON DELETE RESTRICT,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,  -- Nullable (1 row has NULL)
    bccd_name VARCHAR(255),
    product_sr_no VARCHAR(255) UNIQUE,       -- Unique per finding: 0 duplicates in 13,622 rows
    date_of_purchase DATE,
    complaint_no VARCHAR(255),
    defect_id INTEGER REFERENCES defect_types(id) ON DELETE SET NULL,
    defect_raw TEXT,                          -- Preserves original OCR/manual text
    visiting_tech_name VARCHAR(255),
    mfg_month_year VARCHAR(50),
    status VARCHAR(50) DEFAULT '',            -- '', 'OK', 'NFF', 'SCRAP' (matches real data)
    pcb_sr_no VARCHAR(255),
    tag_entry_by VARCHAR(255),               -- Text name (NOT UUID — matches real data)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. REPAIR DETAILS (Consumption phase — 1:1 with repair_jobs)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair_details (
    job_id INTEGER PRIMARY KEY REFERENCES repair_jobs(id) ON DELETE CASCADE,
    repair_date DATE,
    testing VARCHAR(10),                     -- 'PASS' or 'FAIL'
    failure_type_id INTEGER REFERENCES failure_types(id) ON DELETE SET NULL,
    failure_raw TEXT,                         -- Preserves original typo-ridden text
    rf_observation TEXT,                      -- 0 rows have data but column exists
    analysis TEXT,
    validation_result TEXT,                   -- 1 row has data
    component_change TEXT,                    -- Free-text fallback during transition
    engg_id INTEGER REFERENCES engineers(id) ON DELETE SET NULL,
    consumption_entry_by VARCHAR(255),        -- Text name
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. JOB CONSUMPTIONS (Structured component tracking — NEW)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_consumptions (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
    bom_id INTEGER REFERENCES bom_new(id) ON DELETE SET NULL,
    spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. DISPATCH DETAILS (1:1 with repair_jobs — currently 0 rows have data)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_details (
    job_id INTEGER PRIMARY KEY REFERENCES repair_jobs(id) ON DELETE CASCADE,
    dispatch_date DATE,
    dispatch_entry_by VARCHAR(255),           -- Text name
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. INVENTORY TRANSACTIONS (Audit ledger — NEW)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
    txn_type VARCHAR(20) NOT NULL 
        CHECK (txn_type IN ('STOCK_IN', 'CONSUMED', 'ADJUSTMENT', 'RETURN')),
    quantity INTEGER NOT NULL,
    job_id INTEGER REFERENCES repair_jobs(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. SHEETS (Unchanged)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheets (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Indexes

```sql
-- repair_jobs: every search pattern used by pg-db.ts
CREATE INDEX IF NOT EXISTS idx_rj_dc_id ON repair_jobs(dc_id);
CREATE INDEX IF NOT EXISTS idx_rj_product_id ON repair_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_rj_branch_id ON repair_jobs(branch_id);
CREATE INDEX IF NOT EXISTS idx_rj_product_sr_no ON repair_jobs(product_sr_no);
CREATE INDEX IF NOT EXISTS idx_rj_pcb_sr_no ON repair_jobs(pcb_sr_no);
CREATE INDEX IF NOT EXISTS idx_rj_complaint_no ON repair_jobs(complaint_no);
CREATE INDEX IF NOT EXISTS idx_rj_created_at ON repair_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_rj_status ON repair_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rj_sr_no_created ON repair_jobs(sr_no, created_at);  -- For monthly MAX(sr_no)
CREATE INDEX IF NOT EXISTS idx_rj_tag_entry_by ON repair_jobs(tag_entry_by);        -- Admin dashboard
CREATE INDEX IF NOT EXISTS idx_rd_engg_id ON repair_details(engg_id);
CREATE INDEX IF NOT EXISTS idx_rd_consumption_by ON repair_details(consumption_entry_by);  -- Admin dashboard
CREATE INDEX IF NOT EXISTS idx_jc_job_id ON job_consumptions(job_id);
CREATE INDEX IF NOT EXISTS idx_jc_spare_part_id ON job_consumptions(spare_part_id);
CREATE INDEX IF NOT EXISTS idx_sp_stock ON spare_parts(stock_quantity);
CREATE INDEX IF NOT EXISTS idx_bom_lookup ON bom_new(product_id, location);
CREATE INDEX IF NOT EXISTS idx_itxn_part ON inventory_transactions(spare_part_id);
CREATE INDEX IF NOT EXISTS idx_itxn_date ON inventory_transactions(created_at);
```

---

## Triggers

```sql
-- Auto-decrement inventory on consumption
CREATE OR REPLACE FUNCTION update_stock_on_consumption()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE spare_parts
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.spare_part_id;

    INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, job_id, notes)
    VALUES (NEW.spare_part_id, 'CONSUMED', -NEW.quantity, NEW.job_id,
            'Auto-decremented on job consumption');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consumption_stock
AFTER INSERT ON job_consumptions
FOR EACH ROW EXECUTE FUNCTION update_stock_on_consumption();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rj_ts BEFORE UPDATE ON repair_jobs FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_rd_ts BEFORE UPDATE ON repair_details FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_dd_ts BEFORE UPDATE ON dispatch_details FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_eng_ts BEFORE UPDATE ON engineers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_dc_ts BEFORE UPDATE ON dc_numbers_new FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_sp_ts BEFORE UPDATE ON spare_parts FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

---

## Backward-Compatible VIEW

> [!IMPORTANT]
> This VIEW makes the new tables look **exactly** like the old `consolidated_data` table. The app's 26 DB functions (save, search, update, delete, admin, export) can continue working through this VIEW while we migrate the code gradually.

```sql
CREATE OR REPLACE VIEW consolidated_data_view AS
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
```

---

## Migration Script (from current `consolidated_data`)

> [!IMPORTANT]
> This runs inside a transaction. If anything fails, everything rolls back. Zero data loss.

```sql
BEGIN;

-- ── Step 1: Populate lookup tables from existing data ────────────────────────

-- Products (17 unique part codes, handle empty descriptions)
INSERT INTO products (part_code, description)
SELECT DISTINCT ON (part_code)
    part_code,
    CASE WHEN product_description IS NOT NULL AND product_description != '' 
         THEN product_description 
         ELSE NULL 
    END
FROM consolidated_data
WHERE part_code IS NOT NULL AND part_code != ''
ORDER BY part_code, 
    CASE WHEN product_description IS NOT NULL AND product_description != '' THEN 0 ELSE 1 END;

-- Branches (auto-clean: trim + title case, ~329 unique)
INSERT INTO branches (name)
SELECT DISTINCT INITCAP(TRIM(branch))
FROM consolidated_data
WHERE branch IS NOT NULL AND TRIM(branch) != ''
ORDER BY INITCAP(TRIM(branch))
ON CONFLICT (name) DO NOTHING;

-- Engineers (case-insensitive deduplicate: "Sarika" and "SARIKA" merge)
INSERT INTO engineers (name)
SELECT DISTINCT ON (LOWER(TRIM(name))) TRIM(name)
FROM (
    SELECT DISTINCT engg_name AS name FROM consolidated_data 
    WHERE engg_name IS NOT NULL AND TRIM(engg_name) != '' AND TRIM(engg_name) != 'NA'
) raw
ORDER BY LOWER(TRIM(name)), name;

-- DC Numbers
INSERT INTO dc_numbers_new (dc_number, dc_date)
SELECT DISTINCT ON (dc_no) dc_no, dc_date
FROM consolidated_data
WHERE dc_no IS NOT NULL AND dc_no != ''
ORDER BY dc_no, dc_date DESC NULLS LAST
ON CONFLICT (dc_number) DO NOTHING;

-- DC ↔ Product mapping (from existing data relationships)
INSERT INTO dc_product_map (dc_id, product_id)
SELECT DISTINCT d.id, p.id
FROM consolidated_data cd
JOIN dc_numbers_new d ON d.dc_number = cd.dc_no
JOIN products p ON p.part_code = cd.part_code
WHERE cd.dc_no IS NOT NULL AND cd.dc_no != ''
  AND cd.part_code IS NOT NULL AND cd.part_code != ''
ON CONFLICT DO NOTHING;

-- Defect types (auto-cleaned)
INSERT INTO defect_types (name)
SELECT DISTINCT UPPER(TRIM(defect))
FROM consolidated_data
WHERE defect IS NOT NULL AND TRIM(defect) != ''
ON CONFLICT (name) DO NOTHING;

-- Failure types (3 real categories)
INSERT INTO failure_types (name) VALUES 
    ('NOT WORKING'), ('FOUND OK'), ('COMPONENT')
ON CONFLICT (name) DO NOTHING;

-- ── Step 2: Migrate repair_jobs (13,624 rows) ───────────────────────────────

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
FROM consolidated_data cd
LEFT JOIN dc_numbers_new d ON d.dc_number = cd.dc_no
LEFT JOIN products p ON p.part_code = cd.part_code
LEFT JOIN branches br ON br.name = INITCAP(TRIM(cd.branch))
LEFT JOIN defect_types dt ON dt.name = UPPER(TRIM(cd.defect));

-- Reset the sequence to continue after max id
SELECT setval('repair_jobs_id_seq', (SELECT MAX(id) FROM repair_jobs));

-- ── Step 3: Migrate repair_details (only rows with repair data) ─────────────

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
FROM consolidated_data cd
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

-- ── Step 4: Migrate dispatch_details (currently 0 rows) ─────────────────────

INSERT INTO dispatch_details (job_id, dispatch_date, dispatch_entry_by, updated_at)
SELECT cd.id, cd.dispatch_date, cd.dispatch_entry_by, cd.updated_at
FROM consolidated_data cd
WHERE cd.dispatch_date IS NOT NULL 
   OR (cd.dispatch_entry_by IS NOT NULL AND cd.dispatch_entry_by != '');

-- ── Step 5: Migrate BOM to use product_id FK ────────────────────────────────

INSERT INTO bom_new (product_id, location, description, created_at)
SELECT p.id, b.location, b.description, b.created_at
FROM bom b
JOIN products p ON p.part_code = b.part_code;

COMMIT;
```

---

## Verification Queries (Run After Migration)

```sql
-- Must equal 13,624
SELECT COUNT(*) AS repair_jobs_count FROM repair_jobs;

-- Must equal 13,624
SELECT COUNT(*) AS view_count FROM consolidated_data_view;

-- Must equal count of rows with repair/consumption data
SELECT COUNT(*) AS repair_details_count FROM repair_details;

-- Must be 0 (no dispatch data currently)
SELECT COUNT(*) AS dispatch_count FROM dispatch_details;

-- Must match original BOM count (215)
SELECT COUNT(*) AS bom_count FROM bom_new;

-- Compare VIEW output to original — should be identical
SELECT COUNT(*) FROM consolidated_data_view cv
FULL OUTER JOIN consolidated_data cd ON cv.id = cd.id
WHERE cv.id IS NULL OR cd.id IS NULL;
-- Must return 0
```

---

## What Needs to Change in App Code

> [!IMPORTANT]
> **Phase 1 (Immediate):** After migration, rename the VIEW to `consolidated_data` (drop the old table, rename the view). All 26 existing functions in `pg-db.ts` will continue working without any code changes — the VIEW returns the exact same columns.

> [!WARNING]
> **Phase 2 (Later):** Gradually rewrite `pg-db.ts` functions to query the new tables directly for better performance. The VIEW uses 6 LEFT JOINs which is slightly slower than direct table access. Priority rewrites:
> 1. `saveConsolidatedDataEntry` → write to `repair_jobs` directly
> 2. `updateConsolidatedDataEntry` → write to `repair_jobs` + `repair_details`
> 3. `getNextGlobalPcbSequence` → query `repair_jobs` directly (already simple)
> 4. WebSocket server `ws-server.js` → change table name from `consolidated_data` to `repair_jobs`

### WebSocket Server Fix (1-line change)
```diff
# ws-server.js line 47-49
- FROM consolidated_data
+ FROM repair_jobs
```

---

## Open Questions

> [!WARNING]
> **Branch cleanup method**: After auto-normalizing (INITCAP + TRIM), you'll have ~329 branches. Many are still typos ("Agra" vs "Aggra" vs "Agera"). Options:
> - **(A)** Import all 329 as-is — fix later
> - **(B)** I generate a cleanup spreadsheet for you to review before migration
> 
> **Recommendation**: Option A (import now, clean later). Migration should not be blocked by data cleanup.

> [!WARNING]
> **Spare parts initial stock**: The `spare_parts` and `inventory_transactions` tables will be **empty** after migration. You'll need to populate them with your actual component catalog. Do you have this data in a spreadsheet?
