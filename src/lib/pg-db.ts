import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Create a PostgreSQL connection pool
const poolConfig: PoolConfig = {
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
};

// Use DATABASE_URL if provided (e.g., from Render PostgreSQL add-on)
if (process.env.DATABASE_URL) {
  Object.assign(poolConfig, {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL_DISABLED === 'true' ? false : {
      rejectUnauthorized: false
    }
  });
} else {
  // Use individual connection parameters
  Object.assign(poolConfig, {
    host: process.env.PG_HOST?.replace(/'/g, '') || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER?.replace(/'/g, '') || 'postgres',
    password: process.env.PG_PASSWORD?.replace(/'/g, '') || '',
    database: process.env.PG_DATABASE?.replace(/'/g, '') || 'nexscan',
    ssl: process.env.DB_SSL_DISABLED === 'true' ? false : {
      rejectUnauthorized: false
    }
  });
}

const pool = new Pool(poolConfig);

// ---------------------------------------------------------------------------
// The normalized schema uses these core tables:
//   products, branches, engineers, dc_numbers_new, dc_product_map,
//   defect_types, failure_types, spare_parts, bom_new,
//   repair_jobs, repair_details, dispatch_details,
//   job_consumptions, inventory_transactions
//
// A view called "repair_dashboard_view" joins them back into the flat
// column layout the frontend expects (sr_no, dc_no, branch, part_code …).
// INSTEAD OF triggers on the view handle INSERT / UPDATE / DELETE so the
// backend can keep using the same column names it always did.
// ---------------------------------------------------------------------------

// ── Name of the view that replaces the old consolidated_data table ──────────
const VIEW_NAME = 'repair_dashboard_view';

// Initialize the database tables (normalized schema)
export async function initializeDatabase() {
  try {
    const databaseName = process.env.PG_DATABASE || 'nexscan';

    // Enable pgcrypto for gen_random_uuid()
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // ── Users table ──────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supabase_user_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'USER',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add name column if it doesn't exist (for existing databases)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
    } catch (alterError) {
      console.log('Name column addition attempted - may already exist');
    }

    // Create indexes for user table
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_supabase_user_id ON users (supabase_user_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_email ON users (email);`);
    } catch (indexError) {
      console.log('User indexes creation attempted - may already exist');
    }

    // ── Sheets table ─────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sheets (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Products table ───────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        part_code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Branches table ───────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        city VARCHAR(100),
        state VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Engineers table ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_engineer_name ON engineers (name);`);
    } catch (indexError) {
      console.log('Engineer index creation attempted - may already exist');
    }

    // ── DC Numbers table ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_numbers_new (
        id SERIAL PRIMARY KEY,
        dc_number VARCHAR(255) NOT NULL UNIQUE,
        dc_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── DC ↔ Product mapping table ───────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_product_map (
        dc_id INTEGER NOT NULL REFERENCES dc_numbers_new(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        PRIMARY KEY (dc_id, product_id)
      )
    `);

    // ── Defect types table ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS defect_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Failure types table ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS failure_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Spare parts table ────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spare_parts (
        id SERIAL PRIMARY KEY,
        part_name VARCHAR(255) NOT NULL,
        description TEXT,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        initial_quantity INTEGER NOT NULL DEFAULT 0,
        reorder_threshold INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── BOM table (new) ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bom_new (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        location VARCHAR(50) NOT NULL,
        spare_part_id INTEGER REFERENCES spare_parts(id) ON DELETE RESTRICT,
        description TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Also keep legacy bom table for backward compat ───────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bom (
        id SERIAL PRIMARY KEY,
        part_code VARCHAR(255) NOT NULL,
        location VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (part_code, location)
      )
    `);

    // ── Repair jobs (core table) ─────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS repair_jobs (
        id SERIAL PRIMARY KEY,
        sr_no VARCHAR(50) NOT NULL,
        dc_id INTEGER REFERENCES dc_numbers_new(id) ON DELETE RESTRICT,
        product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        bccd_name VARCHAR(255),
        product_sr_no VARCHAR(255),
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
      )
    `);

    // ── Repair details (1:1 with repair_jobs) ────────────────────────────────
    await pool.query(`
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
      )
    `);

    // ── Dispatch details (1:1 with repair_jobs) ──────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_details (
        job_id INTEGER PRIMARY KEY REFERENCES repair_jobs(id) ON DELETE CASCADE,
        dispatch_date DATE,
        dispatch_entry_by VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Job consumptions ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_consumptions (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
        bom_id INTEGER REFERENCES bom_new(id) ON DELETE SET NULL,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL DEFAULT 1,
        consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Inventory transactions ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id SERIAL PRIMARY KEY,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
        txn_type VARCHAR(20) NOT NULL CHECK (txn_type IN ('STOCK_IN','CONSUMED','ADJUSTMENT','RETURN')),
        quantity INTEGER NOT NULL,
        job_id INTEGER REFERENCES repair_jobs(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Create indexes on normalized tables ──────────────────────────────────
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_dc_id ON repair_jobs(dc_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_product_id ON repair_jobs(product_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_branch_id ON repair_jobs(branch_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_product_sr_no ON repair_jobs(product_sr_no);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_pcb_sr_no ON repair_jobs(pcb_sr_no);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_complaint_no ON repair_jobs(complaint_no);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_created_at ON repair_jobs(created_at);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_status ON repair_jobs(status);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_sr_no_created ON repair_jobs(sr_no, created_at);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rj_tag_entry_by ON repair_jobs(tag_entry_by);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rd_engg_id ON repair_details(engg_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rd_consumption_by ON repair_details(consumption_entry_by);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sp_stock ON spare_parts(stock_quantity);`);
    } catch (indexError) {
      console.log('Index creation attempted - some may already exist');
    }

    // ── Create the update_timestamp() utility trigger function ───────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_timestamp() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
      $$;
    `);

    // ── Create the stock-consumption trigger function ─────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_stock_on_consumption() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE spare_parts SET stock_quantity = stock_quantity - NEW.quantity, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.spare_part_id;
        INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, job_id, notes)
          VALUES (NEW.spare_part_id, 'CONSUMED', -NEW.quantity, NEW.job_id, 'Auto-decremented on job consumption');
        RETURN NEW;
      END;
      $$;
    `);

    // ── Attach update_timestamp triggers ─────────────────────────────────────
    const timestampTables = [
      { table: 'repair_jobs',    trigger: 'trg_rj_ts' },
      { table: 'repair_details', trigger: 'trg_rd_ts' },
      { table: 'dispatch_details', trigger: 'trg_dd_ts' },
      { table: 'engineers',      trigger: 'trg_eng_ts' },
      { table: 'dc_numbers_new', trigger: 'trg_dc_ts' },
      { table: 'spare_parts',    trigger: 'trg_sp_ts' },
    ];
    for (const { table, trigger } of timestampTables) {
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${trigger}') THEN
            CREATE TRIGGER ${trigger} BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION update_timestamp();
          END IF;
        END $$;
      `);
    }

    // ── Consumption stock trigger ────────────────────────────────────────────
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_consumption_stock') THEN
          CREATE TRIGGER trg_consumption_stock AFTER INSERT ON job_consumptions FOR EACH ROW EXECUTE FUNCTION update_stock_on_consumption();
        END IF;
      END $$;
    `);

    // ── Create the repair_dashboard_view ──────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE VIEW repair_dashboard_view AS
      SELECT
        rj.id,
        rj.sr_no,
        dc.dc_number AS dc_no,
        dc.dc_date,
        br.name       AS branch,
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
        LEFT JOIN branches       br ON rj.branch_id = br.id
        LEFT JOIN products        p ON rj.product_id = p.id
        LEFT JOIN repair_details rd ON rj.id = rd.job_id
        LEFT JOIN dispatch_details dd ON rj.id = dd.job_id
        LEFT JOIN engineers       e ON rd.engg_id = e.id;
    `);

    // ── INSTEAD OF INSERT trigger ────────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION instead_of_insert_consolidated() RETURNS trigger
      LANGUAGE plpgsql AS $$
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
      $$;
    `);

    // ── INSTEAD OF UPDATE trigger ────────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION instead_of_update_consolidated() RETURNS trigger
      LANGUAGE plpgsql AS $$
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
      $$;
    `);

    // ── INSTEAD OF DELETE trigger ────────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION instead_of_delete_consolidated() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM repair_jobs WHERE id = OLD.id;
        RETURN OLD;
      END;
      $$;
    `);

    // ── Attach INSTEAD OF triggers to the view ───────────────────────────────
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_instead_of_insert_dashboard') THEN
          CREATE TRIGGER trg_instead_of_insert_dashboard INSTEAD OF INSERT ON repair_dashboard_view FOR EACH ROW EXECUTE FUNCTION instead_of_insert_consolidated();
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_instead_of_update_dashboard') THEN
          CREATE TRIGGER trg_instead_of_update_dashboard INSTEAD OF UPDATE ON repair_dashboard_view FOR EACH ROW EXECUTE FUNCTION instead_of_update_consolidated();
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_instead_of_delete_dashboard') THEN
          CREATE TRIGGER trg_instead_of_delete_dashboard INSTEAD OF DELETE ON repair_dashboard_view FOR EACH ROW EXECUTE FUNCTION instead_of_delete_consolidated();
        END IF;
      END $$;
    `);

    // ── Keep the old dc_numbers table for backward compat (if it exists) ─────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_numbers (
        id SERIAL PRIMARY KEY,
        dc_number VARCHAR(255) NOT NULL UNIQUE,
        part_codes JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully (normalized schema)');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SR No helpers — query the actual repair_jobs table for sequencing
// ──────────────────────────────────────────────────────────────────────────────

// Get the next sequential SR No for a given Partcode
export async function getNextSrNoForPartcode(partcode: string): Promise<string> {
  try {
    console.log('Getting next SR No for Partcode:', partcode);

    const result = await pool.query(
      `SELECT MAX(CAST(sr_no AS INTEGER)) as max_sr_no
       FROM repair_jobs
       WHERE sr_no ~ '^[0-9]+$'
         AND product_id = (SELECT id FROM products WHERE part_code = $1 LIMIT 1)`,
      [partcode]
    );

    console.log('Database query result:', result.rows);
    const maxSrNo = result.rows[0]?.max_sr_no || 0;
    console.log('Max SR No found:', maxSrNo);

    const nextSrNo = maxSrNo + 1;
    console.log('Next SR No calculated:', nextSrNo);

    const formattedSrNo = String(nextSrNo).padStart(3, '0');
    console.log('Formatted SR No:', formattedSrNo);

    return formattedSrNo;
  } catch (error) {
    console.error('Error getting next SR No for Partcode:', error);
    return '001'; // Default fallback
  }
}

// Get next SR No: MAX(sr_no) for the current calendar month + 1.
// Resets to 1 at the start of each new month.
export async function getNextGlobalPcbSequence(_mfgMonthYear?: string): Promise<string> {
  try {
    // Find the highest sr_no among rows inserted in the current calendar month
    const result = await pool.query(`
      SELECT MAX(CAST(sr_no AS INTEGER)) AS max_sr_no
      FROM repair_jobs
      WHERE
        sr_no ~ '^[0-9]+$'
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `);

    const maxSrNo = result.rows[0]?.max_sr_no ?? 0;
    const nextSrNo = (maxSrNo ?? 0) + 1;

    console.log(`Max SR No this month: ${maxSrNo}, Next SR No: ${nextSrNo}`);

    return String(nextSrNo).padStart(4, '0');
  } catch (error) {
    console.error('Error getting next SR No:', error);
    return '0001'; // Fallback
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Data lookup functions — query from the view
// ──────────────────────────────────────────────────────────────────────────────

// Find consolidated data entry by part_code and sr_no
export async function findConsolidatedDataEntryByPartCodeAndSrNo(partCode: string, srNo: string): Promise<any> {
  try {
    const result = await pool.query(
      `SELECT * FROM ${VIEW_NAME} WHERE part_code = $1 AND sr_no = $2 LIMIT 1`,
      [partCode, srNo]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error finding consolidated data entry by part_code and sr_no:', error);
    return null;
  }
}

// Find consolidated data entry by product_sr_no
export async function findConsolidatedDataEntryByProductSrNo(productSrNo: string): Promise<any> {
  try {
    const result = await pool.query(
      `SELECT * FROM ${VIEW_NAME} WHERE product_sr_no = $1 LIMIT 1`,
      [productSrNo]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error finding consolidated data entry by product_sr_no:', error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Update functions — UPDATE on the view (INSTEAD OF trigger distributes)
// ──────────────────────────────────────────────────────────────────────────────

// Update consolidated data entry by product_sr_no
export async function updateConsolidatedDataEntryByProductSrNo(productSrNo: string, entry: any): Promise<boolean> {
  try {
    console.log('Updating consolidated data entry for product_sr_no:', productSrNo);
    console.log('Entry data being sent:', entry);

    // Build dynamic query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Handle tag entry fields (only update if provided)
    if (entry.srNo !== undefined && entry.srNo !== null) {
      updates.push(`sr_no = $${paramCount}`);
      values.push(entry.srNo);
      paramCount++;
    }
    if (entry.dcNo !== undefined && entry.dcNo !== null) {
      updates.push(`dc_no = $${paramCount}`);
      values.push(entry.dcNo);
      paramCount++;
    }
    if (entry.dcDate !== undefined && entry.dcDate !== null) {
      const dcDateValue = convertToPostgresDate(entry.dcDate);
      updates.push(`dc_date = $${paramCount}`);
      values.push(dcDateValue);
      paramCount++;
    }
    if (entry.branch !== undefined && entry.branch !== null) {
      updates.push(`branch = $${paramCount}`);
      values.push(entry.branch);
      paramCount++;
    }
    if (entry.bccdName !== undefined && entry.bccdName !== null) {
      updates.push(`bccd_name = $${paramCount}`);
      values.push(entry.bccdName);
      paramCount++;
    }
    if (entry.productDescription !== undefined && entry.productDescription !== null) {
      updates.push(`product_description = $${paramCount}`);
      values.push(entry.productDescription);
      paramCount++;
    }
    if (entry.productSrNo !== undefined && entry.productSrNo !== null) {
      updates.push(`product_sr_no = $${paramCount}`);
      values.push(entry.productSrNo);
      paramCount++;
    }
    if (entry.dateOfPurchase !== undefined && entry.dateOfPurchase !== null) {
      const dateOfPurchaseValue = convertToPostgresDate(entry.dateOfPurchase);
      updates.push(`date_of_purchase = $${paramCount}`);
      values.push(dateOfPurchaseValue);
      paramCount++;
    }
    if (entry.complaintNo !== undefined && entry.complaintNo !== null) {
      updates.push(`complaint_no = $${paramCount}`);
      values.push(entry.complaintNo);
      paramCount++;
    }
    if (entry.partCode !== undefined && entry.partCode !== null) {
      updates.push(`part_code = $${paramCount}`);
      values.push(entry.partCode);
      paramCount++;
    }
    if (entry.defect !== undefined && entry.defect !== null) {
      updates.push(`defect = $${paramCount}`);
      values.push(entry.defect);
      paramCount++;
    }
    if (entry.visitingTechName !== undefined && entry.visitingTechName !== null) {
      updates.push(`visiting_tech_name = $${paramCount}`);
      values.push(entry.visitingTechName);
      paramCount++;
    }
    if (entry.mfgMonthYear !== undefined && entry.mfgMonthYear !== null) {
      updates.push(`mfg_month_year = $${paramCount}`);
      values.push(entry.mfgMonthYear);
      paramCount++;
    }
    if (entry.pcbSrNo !== undefined && entry.pcbSrNo !== null) {
      updates.push(`pcb_sr_no = $${paramCount}`);
      values.push(entry.pcbSrNo);
      paramCount++;
    }

    // Handle consumption fields (only update if provided)
    if (entry.repairDate !== undefined && entry.repairDate !== null) {
      const repairDateValue = convertToPostgresDate(entry.repairDate);
      updates.push(`repair_date = $${paramCount}`);
      values.push(repairDateValue);
      paramCount++;
    } else if (entry.repair_date !== undefined && entry.repair_date !== null) {
      const repairDateValue = convertToPostgresDate(entry.repair_date);
      updates.push(`repair_date = $${paramCount}`);
      values.push(repairDateValue);
      paramCount++;
    }
    if (entry.testing !== undefined && entry.testing !== null) {
      updates.push(`testing = $${paramCount}`);
      values.push(entry.testing);
      paramCount++;
    }
    if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    }
    if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    }

    if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    }
    if (entry.componentChange !== undefined && entry.componentChange !== null) {
      updates.push(`component_change = $${paramCount}`);
      values.push(entry.componentChange);
      paramCount++;
    } else if (entry.component_change !== undefined && entry.component_change !== null) {
      updates.push(`component_change = $${paramCount}`);
      values.push(entry.component_change);
      paramCount++;
    }
    if (entry.enggName !== undefined && entry.enggName !== null) {
      updates.push(`engg_name = $${paramCount}`);
      values.push(entry.enggName);
      paramCount++;
    } else if (entry.engg_name !== undefined && entry.engg_name !== null) {
      updates.push(`engg_name = $${paramCount}`);
      values.push(entry.engg_name);
      paramCount++;
    }

    // Handle new separate engineer name fields
    if (entry.tagEntryBy !== undefined && entry.tagEntryBy !== null) {
      updates.push(`tag_entry_by = $${paramCount}`);
      values.push(entry.tagEntryBy);
      paramCount++;
    } else if (entry.tag_entry_by !== undefined && entry.tag_entry_by !== null) {
      updates.push(`tag_entry_by = $${paramCount}`);
      values.push(entry.tag_entry_by);
      paramCount++;
    }
    if (entry.consumptionEntryBy !== undefined && entry.consumptionEntryBy !== null) {
      updates.push(`consumption_entry_by = $${paramCount}`);
      values.push(entry.consumptionEntryBy);
      paramCount++;
    } else if (entry.consumption_entry_by !== undefined && entry.consumption_entry_by !== null) {
      updates.push(`consumption_entry_by = $${paramCount}`);
      values.push(entry.consumption_entry_by);
      paramCount++;
    }
    if (entry.dispatchEntryBy !== undefined && entry.dispatchEntryBy !== null) {
      updates.push(`dispatch_entry_by = $${paramCount}`);
      values.push(entry.dispatchEntryBy);
      paramCount++;
    } else if (entry.dispatch_entry_by !== undefined && entry.dispatch_entry_by !== null) {
      updates.push(`dispatch_entry_by = $${paramCount}`);
      values.push(entry.dispatch_entry_by);
      paramCount++;
    }

    if ((entry.dispatchDate !== undefined && entry.dispatchDate !== null) || (entry.dispatch_date !== undefined && entry.dispatch_date !== null)) {
      const dispatchDateValue = convertToPostgresDate(entry.dispatchDate || entry.dispatch_date);
      updates.push(`dispatch_date = $${paramCount}`);
      values.push(dispatchDateValue);
      paramCount++;
    }

    if (updates.length === 0) {
      console.log('No fields to update');
      return true; // Nothing to update, but not an error
    }

    // Add updated_at and product_sr_no to the end
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(productSrNo);

    const query = `UPDATE ${VIEW_NAME} SET ${updates.join(', ')} WHERE product_sr_no = $${paramCount}`;

    console.log('Executing query:', query);
    console.log('With values:', values);

    const result = await pool.query(query, values);

    console.log('Query result:', result);
    console.log('Rows affected:', result.rowCount);

    return true;
  } catch (error) {
    console.error('Error updating consolidated data entry by product_sr_no:', error);
    return false;
  }
}

// Test function to verify database updates are working
export async function testDatabaseUpdate(): Promise<boolean> {
  try {
    console.log('Testing database update...');

    // First, try to get a test record
    const testResult = await pool.query(
      `SELECT product_sr_no FROM ${VIEW_NAME} LIMIT 1`
    );

    if (testResult.rows.length === 0) {
      console.log('No records found in repair_dashboard_view');
      return false;
    }

    const testProductSrNo = testResult.rows[0].product_sr_no;
    console.log('Testing update for product_sr_no:', testProductSrNo);

    // Try a simple update on the underlying table
    const updateResult = await pool.query(
      'UPDATE repair_jobs SET updated_at = CURRENT_TIMESTAMP WHERE product_sr_no = $1',
      [testProductSrNo]
    );

    console.log('Test update result:', updateResult);
    console.log('Rows affected:', updateResult.rowCount);

    return (updateResult.rowCount || 0) > 0;
  } catch (error) {
    console.error('Error testing database update:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Engineer service functions
// ──────────────────────────────────────────────────────────────────────────────

export async function getAllEngineers(): Promise<{ id: number, name: string }[]> {
  try {
    const result = await pool.query(
      'SELECT id, name FROM engineers ORDER BY name ASC'
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching engineers:', error);
    return [];
  }
}

export async function addEngineer(name: string): Promise<boolean> {
  try {
    await pool.query(
      'INSERT INTO engineers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [name.trim()]
    );

    return true;
  } catch (error) {
    console.error('Error adding engineer:', error);
    return false;
  }
}

export async function deleteEngineer(id: number): Promise<boolean> {
  try {
    await pool.query(
      'DELETE FROM engineers WHERE id = $1',
      [id]
    );

    return true;
  } catch (error) {
    console.error('Error deleting engineer:', error);
    return false;
  }
}

// Export the pool for use in other files
export default pool;

// ──────────────────────────────────────────────────────────────────────────────
// BOM service functions
// ──────────────────────────────────────────────────────────────────────────────

export async function getBomDescription(partCode: string, location: string): Promise<string | null> {
  try {
    // Try bom_new first (normalized), fall back to legacy bom table
    const result = await pool.query(
      `SELECT bn.description FROM bom_new bn
       JOIN products p ON bn.product_id = p.id
       WHERE p.part_code = $1 AND bn.location = $2`,
      [partCode, location]
    );

    if (result.rows.length > 0) {
      return result.rows[0].description;
    }

    // Fallback to legacy bom table
    const legacyResult = await pool.query(
      'SELECT description FROM bom WHERE part_code = $1 AND location = $2',
      [partCode, location]
    );

    if (legacyResult.rows.length > 0) {
      return legacyResult.rows[0].description;
    }

    return null;
  } catch (error) {
    console.error('Error fetching BOM description:', error);
    return null;
  }
}

// Check if a location exists in the BOM
export async function checkIfLocationExists(location: string): Promise<boolean> {
  try {
    // Try bom_new first, then legacy
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM bom_new WHERE location = $1',
      [location]
    );

    if (parseInt(result.rows[0].count) > 0) return true;

    const legacyResult = await pool.query(
      'SELECT COUNT(*) as count FROM bom WHERE location = $1',
      [location]
    );

    return parseInt(legacyResult.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking if location exists:', error);
    return false;
  }
}

// Check if a component exists in the BOM for a specific part code
export async function checkComponentForPartCode(partCode: string, location: string, parentPartCode: string): Promise<boolean> {
  try {
    // Try bom_new first
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM bom_new bn
       JOIN products p ON bn.product_id = p.id
       WHERE p.part_code = $1 AND bn.location = $2`,
      [partCode, location]
    );

    if (parseInt(result.rows[0].count) > 0) return true;

    // Fallback to legacy bom
    const legacyResult = await pool.query(
      'SELECT COUNT(*) as count FROM bom WHERE part_code = $1 AND location = $2',
      [partCode, location]
    );

    return parseInt(legacyResult.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking component for part code:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DC Number service functions — uses dc_numbers_new + dc_product_map
// Also keeps backward compat with old dc_numbers (JSONB) table
// ──────────────────────────────────────────────────────────────────────────────

export async function getAllDcNumbers(): Promise<{ dcNumber: string, partCodes: string[] }[]> {
  try {
    // Query from the normalized dc_numbers_new + dc_product_map + products
    const result = await pool.query(`
      SELECT dn.dc_number,
             COALESCE(array_agg(p.part_code ORDER BY p.part_code) FILTER (WHERE p.part_code IS NOT NULL), '{}') AS part_codes
      FROM dc_numbers_new dn
      LEFT JOIN dc_product_map dpm ON dn.id = dpm.dc_id
      LEFT JOIN products p ON dpm.product_id = p.id
      GROUP BY dn.id, dn.dc_number
      ORDER BY dn.created_at ASC
    `);

    return result.rows.map((row: any) => ({
      dcNumber: row.dc_number,
      partCodes: Array.isArray(row.part_codes) ? row.part_codes : []
    }));
  } catch (error) {
    console.error('Error fetching DC numbers:', error);

    // Fallback: try legacy dc_numbers table
    try {
      const legacyResult = await pool.query(
        'SELECT dc_number, part_codes FROM dc_numbers ORDER BY created_at ASC'
      );

      return legacyResult.rows.map((row: any) => {
        let partCodes: string[] = [];
        if (row.part_codes) {
          if (Array.isArray(row.part_codes)) {
            partCodes = row.part_codes;
          } else if (typeof row.part_codes === 'object') {
            partCodes = Object.values(row.part_codes);
          } else {
            try {
              partCodes = JSON.parse(row.part_codes);
            } catch (parseError) {
              partCodes = row.part_codes.split(',').map((code: string) => code.trim()).filter((code: string) => code.length > 0);
            }
          }
        }
        return { dcNumber: row.dc_number, partCodes };
      });
    } catch (legacyError) {
      console.error('Error fetching DC numbers from legacy table:', legacyError);
      return [];
    }
  }
}

export async function addDcNumber(dcNumber: string, partCodes: string[] = []): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert or get the dc_numbers_new row
    const dcResult = await client.query(
      `INSERT INTO dc_numbers_new (dc_number) VALUES ($1)
       ON CONFLICT (dc_number) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [dcNumber]
    );
    const dcId = dcResult.rows[0].id;

    // Clear existing mappings and re-insert
    await client.query('DELETE FROM dc_product_map WHERE dc_id = $1', [dcId]);

    for (const partCode of partCodes) {
      if (partCode && partCode.trim()) {
        // Ensure product exists
        const productResult = await client.query(
          `INSERT INTO products (part_code) VALUES ($1)
           ON CONFLICT (part_code) DO UPDATE SET part_code = EXCLUDED.part_code
           RETURNING id`,
          [partCode.trim()]
        );
        const productId = productResult.rows[0].id;

        await client.query(
          'INSERT INTO dc_product_map (dc_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [dcId, productId]
        );
      }
    }

    await client.query('COMMIT');

    // Also update legacy table for backward compat
    try {
      await pool.query(
        `INSERT INTO dc_numbers (dc_number, part_codes) VALUES ($1, $2)
         ON CONFLICT (dc_number) DO UPDATE SET part_codes = $2, updated_at = CURRENT_TIMESTAMP`,
        [dcNumber, JSON.stringify(partCodes)]
      );
    } catch (legacyErr) {
      // Legacy table may not exist; that's fine
    }

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding DC number:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateDcNumberPartCodes(dcNumber: string, partCodes: string[]): Promise<boolean> {
  // Re-use addDcNumber which does upsert
  return addDcNumber(dcNumber, partCodes);
}

export async function deleteDcNumber(dcNumber: string): Promise<boolean> {
  try {
    // Delete from normalized table (cascades to dc_product_map)
    await pool.query('DELETE FROM dc_numbers_new WHERE dc_number = $1', [dcNumber]);

    // Also delete from legacy table
    try {
      await pool.query('DELETE FROM dc_numbers WHERE dc_number = $1', [dcNumber]);
    } catch (legacyErr) {
      // Legacy table may not exist
    }

    return true;
  } catch (error) {
    console.error('Error deleting DC number:', error);
    return false;
  }
}

// Add sample BOM data for testing
export async function addSampleBomData() {
  try {
    // Check if we already have data
    const countResult = await pool.query('SELECT COUNT(*) as count FROM bom');
    if (parseInt(countResult.rows[0].count) > 0) {
      return; // Already has data
    }

    // No sample data to add - keeping database empty as per requirements
    console.log('No sample BOM data added - database kept empty');
  } catch (error) {
    console.error('Error checking BOM data:', error);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PCB Number generation (server side)
// ──────────────────────────────────────────────────────────────────────────────

// Helper: generate PCB number on the server side (mirrors pcb-utils.ts logic)
function generatePcbNumberServer(partCode: string, srNo: string): string {
  if (!partCode) return '';
  const cleanPartCode = partCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const partCodeSegment = cleanPartCode.substring(0, 7).padEnd(7, '0');
  const dateObj = new Date();
  const monthCodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const monthCode = monthCodes[dateObj.getMonth()] ?? 'A';
  const yearStr = String(dateObj.getFullYear()).slice(-2);
  const srNum = parseInt(srNo, 10);
  const identifier = isNaN(srNum) ? '0001' : String(srNum).padStart(4, '0');
  return `ES${partCodeSegment}${monthCode}${yearStr}${identifier}R`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Save / Insert — INSERT into the view (INSTEAD OF trigger handles normalization)
// ──────────────────────────────────────────────────────────────────────────────

// Save consolidated data entry with atomic server-side SR No assignment.
// Uses a transaction to prevent duplicate SR numbers across concurrent saves.
// Returns { success, srNo } where srNo is the actual assigned serial number.
export async function saveConsolidatedDataEntry(
  entry: any,
  sessionDcNumber?: string,
  sessionPartcode?: string
): Promise<{ success: boolean; srNo?: string }> {
  const client = await pool.connect();
  try {
    console.log('=== saveConsolidatedDataEntry CALLED (atomic) ===');
    console.log('Input entry:', entry);
    console.log('Session data - DC Number:', sessionDcNumber, 'Partcode:', sessionPartcode);

    // Validate required fields (srNo no longer required from client)
    const requiredFields = ['dcNo', 'complaintNo'];
    const missingFields = requiredFields.filter(field => !entry[field]);

    if (missingFields.length > 0) {
      console.log('MISSING REQUIRED FIELDS:', missingFields);
      return { success: false };
    }

    console.log('All required fields present');

    // Handle empty dates by converting them to NULL
    const dcDateValue = convertToPostgresDate(entry.dcDate);
    const dateOfPurchaseValue = convertToPostgresDate(entry.dateOfPurchase);
    const repairDateValue = convertToPostgresDate(entry.repairDate);
    const dispatchDateValue = convertToPostgresDate(entry.dispatchDate);

    // BEGIN TRANSACTION — atomically assign next SR No
    await client.query('BEGIN');

    // Acquire an advisory lock to serialize SR No assignment across concurrent transactions.
    // Lock ID 1 is reserved for SR No sequencing. Released automatically on COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(1)');

    // Now safe to read the max SR No without FOR UPDATE
    const seqResult = await client.query(`
      SELECT COALESCE(MAX(CAST(sr_no AS INTEGER)), 0) AS max_sr_no
      FROM repair_jobs
      WHERE sr_no ~ '^[0-9]+$'
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `);

    const maxSrNo = seqResult.rows[0]?.max_sr_no ?? 0;
    const assignedSrNo = String((maxSrNo ?? 0) + 1).padStart(4, '0');
    console.log(`Atomic SR No assignment: MAX=${maxSrNo}, assigned=${assignedSrNo}`);

    // Regenerate PCB Sr No using the server-assigned SR No
    const partCode = sessionPartcode || entry.partCode || '';
    const pcbSrNo = partCode ? generatePcbNumberServer(partCode, assignedSrNo) : (entry.pcbSrNo || '');

    console.log('Executing database insert with assignedSrNo:', assignedSrNo, 'pcbSrNo:', pcbSrNo);
    const result = await client.query(`
      INSERT INTO ${VIEW_NAME}
      (sr_no, dc_no, dc_date, branch, bccd_name, product_description, product_sr_no,
       date_of_purchase, complaint_no, part_code, defect, visiting_tech_name, mfg_month_year,
       repair_date, testing, failure, status, pcb_sr_no, analysis,
       component_change, engg_name, tag_entry_by, consumption_entry_by, dispatch_entry_by, dispatch_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      RETURNING id, sr_no
    `, [
      assignedSrNo,
      sessionDcNumber || entry.dcNo,
      dcDateValue,
      entry.branch,
      entry.bccdName,
      entry.productDescription,
      entry.productSrNo,
      dateOfPurchaseValue,
      entry.complaintNo,
      partCode,
      entry.defect,
      entry.visitingTechName,
      entry.mfgMonthYear,
      repairDateValue,
      entry.testing,
      entry.failure,
      entry.status,
      pcbSrNo,
      entry.analysis,
      entry.componentChange,
      entry.enggName,
      entry.tagEntryBy,
      entry.consumptionEntryBy,
      entry.dispatchEntryBy,
      dispatchDateValue
    ]);

    await client.query('COMMIT');

    console.log('Database insert result:', result);
    console.log('Inserted record ID:', result.rows[0]?.id, 'SR No:', result.rows[0]?.sr_no);

    if (result.rows.length > 0) {
      console.log('SUCCESS: Record inserted with ID:', result.rows[0].id, 'SR No:', assignedSrNo);
      return { success: true, srNo: assignedSrNo };
    } else {
      console.log('WARNING: No rows returned from insert');
      return { success: false };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('=== DATABASE SAVE ERROR ===');
    console.error('Error details:', error);

    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }

    return { success: false };
  } finally {
    client.release();
  }
}

// Bulk create scrap PCB entries with atomic SR No assignment.
// Creates N entries in a single transaction with consecutive SR numbers.
// All text fields are set to "NA", date fields to null, and PCB Sr Nos are auto-generated.
export async function bulkCreateScrapEntries(
  dcNo: string,
  partCode: string,
  count: number,
  tagEntryBy: string,
  productDescription?: string
): Promise<{ success: boolean; startSrNo?: string; endSrNo?: string }> {
  const client = await pool.connect();
  try {
    console.log(`=== bulkCreateScrapEntries CALLED: ${count} entries for DC=${dcNo}, Part=${partCode} ===`);

    // BEGIN TRANSACTION
    await client.query('BEGIN');

    // Acquire advisory lock (same lock ID as saveConsolidatedDataEntry)
    await client.query('SELECT pg_advisory_xact_lock(1)');

    // Get the current max SR No for the current month
    const seqResult = await client.query(`
      SELECT COALESCE(MAX(CAST(sr_no AS INTEGER)), 0) AS max_sr_no
      FROM repair_jobs
      WHERE sr_no ~ '^[0-9]+$'
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `);

    const maxSrNo = seqResult.rows[0]?.max_sr_no ?? 0;
    const startSrNo = maxSrNo + 1;
    const endSrNo = maxSrNo + count;

    console.log(`Bulk SR No range: ${startSrNo} to ${endSrNo}`);

    // Build batch INSERT with all entries — insert into the view
    const valuesList: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (let i = 0; i < count; i++) {
      const currentSrNo = String(startSrNo + i).padStart(4, '0');
      const pcbSrNo = generatePcbNumberServer(partCode, currentSrNo);

      valuesList.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13})`
      );
      params.push(
        currentSrNo,       // sr_no
        dcNo,              // dc_no
        'NA',              // branch
        'NA',              // bccd_name
        productDescription || 'NA',  // product_description
        `SCRAP-${dcNo}-${currentSrNo}`,  // product_sr_no (must be unique per row)
        'NA',              // complaint_no
        partCode,          // part_code
        'NA',              // defect
        'NA',              // visiting_tech_name
        pcbSrNo,           // pcb_sr_no
        tagEntryBy,        // tag_entry_by
        'NA',              // engg_name
        'NA'               // mfg_month_year
      );
      paramIndex += 14;
    }

    const query = `
      INSERT INTO ${VIEW_NAME}
      (sr_no, dc_no, branch, bccd_name, product_description, product_sr_no,
       complaint_no, part_code, defect, visiting_tech_name, pcb_sr_no,
       tag_entry_by, engg_name, mfg_month_year)
      VALUES ${valuesList.join(', ')}
    `;

    await client.query(query, params);
    await client.query('COMMIT');

    const formattedStart = String(startSrNo).padStart(4, '0');
    const formattedEnd = String(endSrNo).padStart(4, '0');

    console.log(`Bulk insert complete: SR No ${formattedStart} to ${formattedEnd}`);
    return { success: true, startSrNo: formattedStart, endSrNo: formattedEnd };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('=== BULK CREATE SCRAP ENTRIES ERROR ===');
    console.error('Error details:', error);
    return { success: false };
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Read / Query functions — SELECT from the view
// ──────────────────────────────────────────────────────────────────────────────

// Get consolidated data entries with pagination
export async function getConsolidatedDataEntriesPaginated(limit: number, offset: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM ${VIEW_NAME} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching consolidated data entries paginated:', error);
    return [];
  }
}

// Get ALL consolidated data entries (no pagination, for export)
export async function getAllConsolidatedDataEntries(): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM ${VIEW_NAME}
       ORDER BY part_code ASC, CAST(NULLIF(REGEXP_REPLACE(sr_no, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching all consolidated data entries:', error);
    return [];
  }
}

// Get total count of consolidated data entries
export async function getConsolidatedDataCount(): Promise<number> {
  try {
    // Count from the actual table for performance (avoids joining the view)
    const result = await pool.query('SELECT COUNT(*) FROM repair_jobs');
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Error fetching consolidated data count:', error);
    return 0;
  }
}

// Update a specific consolidated data entry
export async function updateConsolidatedDataEntry(id: string, entry: any): Promise<boolean> {
  try {
    // Build dynamic query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Handle tag entry fields (only update if provided)
    if (entry.srNo !== undefined && entry.srNo !== null) {
      updates.push(`sr_no = $${paramCount}`);
      values.push(entry.srNo);
      paramCount++;
    }
    if (entry.dcNo !== undefined && entry.dcNo !== null) {
      updates.push(`dc_no = $${paramCount}`);
      values.push(entry.dcNo);
      paramCount++;
    }
    if (entry.dcDate !== undefined && entry.dcDate !== null) {
      const dcDateValue = convertToPostgresDate(entry.dcDate);
      updates.push(`dc_date = $${paramCount}`);
      values.push(dcDateValue);
      paramCount++;
    }
    if (entry.branch !== undefined && entry.branch !== null) {
      updates.push(`branch = $${paramCount}`);
      values.push(entry.branch);
      paramCount++;
    }
    if (entry.bccdName !== undefined && entry.bccdName !== null) {
      updates.push(`bccd_name = $${paramCount}`);
      values.push(entry.bccdName);
      paramCount++;
    }
    if (entry.productDescription !== undefined && entry.productDescription !== null) {
      updates.push(`product_description = $${paramCount}`);
      values.push(entry.productDescription);
      paramCount++;
    }
    if (entry.productSrNo !== undefined && entry.productSrNo !== null) {
      updates.push(`product_sr_no = $${paramCount}`);
      values.push(entry.productSrNo);
      paramCount++;
    }
    if (entry.dateOfPurchase !== undefined && entry.dateOfPurchase !== null) {
      const dateOfPurchaseValue = convertToPostgresDate(entry.dateOfPurchase);
      updates.push(`date_of_purchase = $${paramCount}`);
      values.push(dateOfPurchaseValue);
      paramCount++;
    }
    if (entry.complaintNo !== undefined && entry.complaintNo !== null) {
      updates.push(`complaint_no = $${paramCount}`);
      values.push(entry.complaintNo);
      paramCount++;
    }
    if (entry.partCode !== undefined && entry.partCode !== null) {
      updates.push(`part_code = $${paramCount}`);
      values.push(entry.partCode);
      paramCount++;
    }
    if (entry.defect !== undefined && entry.defect !== null) {
      updates.push(`defect = $${paramCount}`);
      values.push(entry.defect);
      paramCount++;
    }
    if (entry.visitingTechName !== undefined && entry.visitingTechName !== null) {
      updates.push(`visiting_tech_name = $${paramCount}`);
      values.push(entry.visitingTechName);
      paramCount++;
    }
    if (entry.mfgMonthYear !== undefined && entry.mfgMonthYear !== null) {
      updates.push(`mfg_month_year = $${paramCount}`);
      values.push(entry.mfgMonthYear);
      paramCount++;
    }
    if (entry.pcbSrNo !== undefined && entry.pcbSrNo !== null) {
      updates.push(`pcb_sr_no = $${paramCount}`);
      values.push(entry.pcbSrNo);
      paramCount++;
    }

    // Handle consumption fields (only update if provided)
    if (entry.repairDate !== undefined && entry.repairDate !== null) {
      const repairDateValue = convertToPostgresDate(entry.repairDate);
      updates.push(`repair_date = $${paramCount}`);
      values.push(repairDateValue);
      paramCount++;
    }
    if (entry.testing !== undefined && entry.testing !== null) {
      updates.push(`testing = $${paramCount}`);
      values.push(entry.testing);
      paramCount++;
    }
    if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    }
    if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    }

    if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    }
    if (entry.componentChange !== undefined && entry.componentChange !== null) {
      updates.push(`component_change = $${paramCount}`);
      values.push(entry.componentChange);
      paramCount++;
    } else if (entry.component_change !== undefined && entry.component_change !== null) {
      updates.push(`component_change = $${paramCount}`);
      values.push(entry.component_change);
      paramCount++;
    }
    if (entry.enggName !== undefined && entry.enggName !== null) {
      updates.push(`engg_name = $${paramCount}`);
      values.push(entry.enggName);
      paramCount++;
    } else if (entry.engg_name !== undefined && entry.engg_name !== null) {
      updates.push(`engg_name = $${paramCount}`);
      values.push(entry.engg_name);
      paramCount++;
    }

    // Handle new separate engineer name fields
    if (entry.tagEntryBy !== undefined && entry.tagEntryBy !== null) {
      updates.push(`tag_entry_by = $${paramCount}`);
      values.push(entry.tagEntryBy);
      paramCount++;
    } else if (entry.tag_entry_by !== undefined && entry.tag_entry_by !== null) {
      updates.push(`tag_entry_by = $${paramCount}`);
      values.push(entry.tag_entry_by);
      paramCount++;
    }
    if (entry.consumptionEntryBy !== undefined && entry.consumptionEntryBy !== null) {
      updates.push(`consumption_entry_by = $${paramCount}`);
      values.push(entry.consumptionEntryBy);
      paramCount++;
    } else if (entry.consumption_entry_by !== undefined && entry.consumption_entry_by !== null) {
      updates.push(`consumption_entry_by = $${paramCount}`);
      values.push(entry.consumption_entry_by);
      paramCount++;
    }
    if (entry.dispatchEntryBy !== undefined && entry.dispatchEntryBy !== null) {
      updates.push(`dispatch_entry_by = $${paramCount}`);
      values.push(entry.dispatchEntryBy);
      paramCount++;
    } else if (entry.dispatch_entry_by !== undefined && entry.dispatch_entry_by !== null) {
      updates.push(`dispatch_entry_by = $${paramCount}`);
      values.push(entry.dispatch_entry_by);
      paramCount++;
    }

    if (entry.dispatchDate !== undefined && entry.dispatchDate !== null) {
      const dispatchDateValue = convertToPostgresDate(entry.dispatchDate);
      updates.push(`dispatch_date = $${paramCount}`);
      values.push(dispatchDateValue);
      paramCount++;
    } else if (entry.dispatch_date !== undefined && entry.dispatch_date !== null) {
      const dispatchDateValue = convertToPostgresDate(entry.dispatch_date);
      updates.push(`dispatch_date = $${paramCount}`);
      values.push(dispatchDateValue);
      paramCount++;
    }

    if (updates.length === 0) {
      console.log('No fields to update');
      return true; // Nothing to update, but not an error
    }

    // Add updated_at and id to the end
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE ${VIEW_NAME} SET ${updates.join(', ')} WHERE id = $${paramCount}`;

    await pool.query(query, values);

    return true;
  } catch (error) {
    console.error('Error updating consolidated data entry:', error);
    return false;
  }
}

// Delete a specific consolidated data entry
export async function deleteConsolidatedDataEntry(id: string): Promise<boolean> {
  try {
    // Delete via the view (INSTEAD OF trigger cascades to repair_jobs)
    await pool.query(
      `DELETE FROM ${VIEW_NAME} WHERE id = $1`,
      [id]
    );
    return true;
  } catch (error) {
    console.error('Error deleting consolidated data entry:', error);
    return false;
  }
}

// Helper function to convert date to PostgreSQL compatible format (YYYY-MM-DD)
export function convertToPostgresDate(dateInput: any): string | null {
  if (!dateInput) return null;
  
  // Handle Date objects directly
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return null; // Invalid date
    return dateInput.toISOString().split('T')[0];
  }
  
  // Handle strings safely without crashing
  const dateStr = typeof dateInput === 'string' ? dateInput.trim() : String(dateInput).trim();
  if (dateStr === '') return null;
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try to parse DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY format
  const parts = dateStr.split(/[\/-]/);
  if (parts.length === 3) {
    const [first, second, year] = parts;

    // If year is 2 digits, convert to 4 digits (assuming 20xx)
    let fullYear = year.length === 2 ? `20${year}` : year;

    // Check if first part looks like day (1-31) or month (1-12)
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);

    // If first number is more than 12, assume it's DD/MM/YYYY or DD-MM-YYYY
    if (firstNum > 12) {
      // DD/MM/YYYY or DD-MM-YYYY format
      const day = first.padStart(2, '0');
      const month = second.padStart(2, '0');
      return `${fullYear}-${month}-${day}`;
    } else {
      // Assume MM/DD/YYYY or MM-DD-YYYY format
      const month = first.padStart(2, '0');
      const day = second.padStart(2, '0');
      return `${fullYear}-${month}-${day}`;
    }
  }

  // If we can't parse it, return as is and let PostgreSQL handle the error
  return dateStr;
}

// Clear all consolidated data entries
export async function clearConsolidatedData(): Promise<void> {
  try {
    // Delete from the actual table (cascades to repair_details, dispatch_details)
    await pool.query('DELETE FROM repair_jobs');
  } catch (error) {
    console.error('Error clearing consolidated data:', error);
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Search functions
// ──────────────────────────────────────────────────────────────────────────────

// Search for consolidated data entries by DC number, part code, and product serial number
export async function searchConsolidatedDataEntries(dcNo?: string, partCode?: string, productSrNo?: string): Promise<any[]> {
  try {
    let query = `SELECT * FROM ${VIEW_NAME} WHERE TRUE`;
    const params: any[] = [];
    let paramCount = 1;

    if (dcNo) {
      query += ` AND dc_no = $${paramCount}`;
      params.push(dcNo);
      paramCount++;
    }

    if (partCode) {
      query += ` AND part_code = $${paramCount}`;
      params.push(partCode);
      paramCount++;
    }

    if (productSrNo) {
      query += ` AND product_sr_no = $${paramCount}`;
      params.push(productSrNo);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error searching consolidated data entries:', error);
    return [];
  }
}

// Search for consolidated data entries by DC number, part code, and PCB serial number
export async function searchConsolidatedDataEntriesByPcb(dcNo?: string, partCode?: string, pcbSrNo?: string): Promise<any[]> {
  try {
    let query = `SELECT * FROM ${VIEW_NAME} WHERE TRUE`;
    const params: any[] = [];
    let paramCount = 1;

    // Only add conditions for non-empty parameters
    if (dcNo && dcNo.trim() !== '') {
      query += ` AND dc_no = $${paramCount}`;
      params.push(dcNo);
      paramCount++;
    }

    if (partCode && partCode.trim() !== '') {
      query += ` AND part_code = $${paramCount}`;
      params.push(partCode);
      paramCount++;
    }

    if (pcbSrNo && pcbSrNo.trim() !== '') {
      // Allow searching with or without the trailing check digit (error bit)
      // AND with or without the legacy '0' separator between PartCode and MonthCode

      const permutations = [pcbSrNo]; // 1. Exact match (New format: ES971039B260247R)

      if (pcbSrNo.length > 14) {
        // 2. Base match without check digit (ES971039B260247)
        const basePcbSrNo = pcbSrNo.substring(0, pcbSrNo.length - 1);
        permutations.push(basePcbSrNo);

        if (pcbSrNo.length >= 10) {
          const beforeSrNo = pcbSrNo.substring(0, pcbSrNo.length - 5);
          const srNoAndCheck = pcbSrNo.substring(pcbSrNo.length - 5);

          const legacyWithCheck = `${beforeSrNo}0${srNoAndCheck}`;
          const legacyBase = legacyWithCheck.substring(0, legacyWithCheck.length - 1);

          // 3. Legacy match with check digit
          permutations.push(legacyWithCheck);
          // 4. Legacy match without check digit
          permutations.push(legacyBase);
        }

        // Build the dynamic OR clause
        const orClauses = [];
        for (const perm of permutations) {
          orClauses.push(`pcb_sr_no = $${paramCount}`);
          params.push(perm);
          paramCount++;
        }

        query += ` AND (${orClauses.join(' OR ')})`;
      } else {
        query += ` AND pcb_sr_no = $${paramCount}`;
        params.push(pcbSrNo);
        paramCount++;
      }
    }

    query += ' ORDER BY created_at DESC';

    console.log('Executing search query:', query, 'with params:', params);

    const result = await pool.query(query, params);
    console.log('Search returned', result.rows.length, 'results');
    return result.rows;
  } catch (error) {
    console.error('Error searching consolidated data entries by PCB:', error);
    return [];
  }
}

// Get consolidated data entries by DC number
export async function getConsolidatedDataEntriesByDcNo(dcNo: string): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM ${VIEW_NAME} WHERE dc_no = $1 ORDER BY created_at DESC`,
      [dcNo]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting consolidated data entries by DC number:', error);
    return [];
  }
}

// Remove unused columns from consolidated_data table — NO-OP in normalized schema
// Kept for backward compatibility so callers don't break
export async function removeUnusedColumnsFromConsolidatedData() {
  console.log('removeUnusedColumnsFromConsolidatedData: no-op in normalized schema');
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Admin / Analytics functions
// ──────────────────────────────────────────────────────────────────────────────

// Get entry counts by user for a specific date (for admin dashboard)
export async function getAdminEntryCountsByDate(date: string): Promise<{
  tagEntries: { user_name: string; count: number }[];
  consumptionEntries: { user_name: string; count: number }[];
}> {
  try {
    // Build date filter conditionally — skip it for 'overall' (all-time) view
    const isOverall = !date || date === 'overall';
    const tagDateFilter = isOverall ? '' : `AND rj.created_at::date = $1::date`;
    const consumptionDateFilter = isOverall ? '' : `AND rd.updated_at::date = $1::date`;
    const params = isOverall ? [] : [date];

    // Tag entries: count rows where tag_entry_by is set (from repair_jobs)
    const tagResult = await pool.query(
      `SELECT rj.tag_entry_by AS user_name, COUNT(*)::int AS count
       FROM repair_jobs rj
       WHERE rj.tag_entry_by IS NOT NULL
         AND rj.tag_entry_by != ''
         ${tagDateFilter}
       GROUP BY rj.tag_entry_by
       ORDER BY rj.tag_entry_by ASC`,
      params
    );

    // Consumption entries: count rows where consumption_entry_by is set (from repair_details)
    const consumptionResult = await pool.query(
      `SELECT rd.consumption_entry_by AS user_name, COUNT(*)::int AS count
       FROM repair_details rd
       WHERE rd.consumption_entry_by IS NOT NULL
         AND rd.consumption_entry_by != ''
         ${consumptionDateFilter}
       GROUP BY rd.consumption_entry_by
       ORDER BY rd.consumption_entry_by ASC`,
      params
    );

    return {
      tagEntries: tagResult.rows,
      consumptionEntries: consumptionResult.rows,
    };
  } catch (error) {
    console.error('Error fetching admin entry counts by date:', error);
    return { tagEntries: [], consumptionEntries: [] };
  }
}

// Get all users from the users table (for admin dashboard)
export async function getAllUsersFromDb(): Promise<{ id: string; email: string; name: string | null; role: string }[]> {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role FROM users ORDER BY name ASC, email ASC'
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching all users:', error);
    return [];
  }
}

// Get today's entry counts for a specific user (for user dashboard footer)
export async function getUserEntryCountsToday(userName: string): Promise<{ tagCount: number; consumptionCount: number }> {
  try {
    // Use CURRENT_DATE from PostgreSQL to avoid any timezone mismatch between Node.js and the DB
    const tagResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM repair_jobs
       WHERE tag_entry_by = $1
         AND created_at::date = CURRENT_DATE`,
      [userName]
    );

    const consumptionResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM repair_details
       WHERE consumption_entry_by = $1
         AND updated_at::date = CURRENT_DATE`,
      [userName]
    );

    console.log('getUserEntryCountsToday - userName:', userName, 'tag:', tagResult.rows[0]?.count, 'consumption:', consumptionResult.rows[0]?.count);

    return {
      tagCount: tagResult.rows[0]?.count ?? 0,
      consumptionCount: consumptionResult.rows[0]?.count ?? 0,
    };
  } catch (error) {
    console.error('Error fetching user entry counts today:', error);
    return { tagCount: 0, consumptionCount: 0 };
  }
}

// Get entry counts grouped by part_code (for admin Part Code analytics tab)
// If date is provided, filter by that date. If date is 'overall', return all-time counts.
export async function getEntryCountsByPartCode(date?: string): Promise<{
  rows: { part_code: string; tag_count: number; consumption_count: number }[];
  totalTag: number;
  totalConsumption: number;
}> {
  try {
    let dateFilter = '';
    const params: string[] = [];

    if (date && date !== 'overall') {
      dateFilter = `AND rj.created_at::date = $1::date`;
      params.push(date);
    }

    // Tag entries by part_code (join products for part_code)
    const tagQuery = `
      SELECT p.part_code, COUNT(*)::int AS count
      FROM repair_jobs rj
      JOIN products p ON rj.product_id = p.id
      WHERE rj.tag_entry_by IS NOT NULL AND rj.tag_entry_by != ''
        AND p.part_code IS NOT NULL AND p.part_code != ''
        ${dateFilter}
      GROUP BY p.part_code
      ORDER BY p.part_code ASC`;

    // Consumption entries by part_code (use updated_at for consumption date filtering)
    const consumptionDateFilter = date && date !== 'overall'
      ? `AND rd.updated_at::date = $1::date`
      : '';

    const consumptionQuery = `
      SELECT p.part_code, COUNT(*)::int AS count
      FROM repair_jobs rj
      JOIN products p ON rj.product_id = p.id
      JOIN repair_details rd ON rj.id = rd.job_id
      WHERE rd.consumption_entry_by IS NOT NULL AND rd.consumption_entry_by != ''
        AND p.part_code IS NOT NULL AND p.part_code != ''
        ${consumptionDateFilter}
      GROUP BY p.part_code
      ORDER BY p.part_code ASC`;

    const [tagResult, consumptionResult] = await Promise.all([
      pool.query(tagQuery, params),
      pool.query(consumptionQuery, params),
    ]);

    // Merge results
    const partCodeMap = new Map<string, { tag_count: number; consumption_count: number }>();

    for (const row of tagResult.rows) {
      partCodeMap.set(row.part_code, { tag_count: row.count, consumption_count: 0 });
    }
    for (const row of consumptionResult.rows) {
      const existing = partCodeMap.get(row.part_code) || { tag_count: 0, consumption_count: 0 };
      existing.consumption_count = row.count;
      partCodeMap.set(row.part_code, existing);
    }

    const rows = Array.from(partCodeMap.entries())
      .map(([part_code, counts]) => ({ part_code, ...counts }))
      .sort((a, b) => a.part_code.localeCompare(b.part_code));

    const totalTag = rows.reduce((sum, r) => sum + r.tag_count, 0);
    const totalConsumption = rows.reduce((sum, r) => sum + r.consumption_count, 0);

    return { rows, totalTag, totalConsumption };
  } catch (error) {
    console.error('Error fetching entry counts by part code:', error);
    return { rows: [], totalTag: 0, totalConsumption: 0 };
  }
}

// Get entry counts grouped by dc_no (for admin DC Number analytics tab)
// If date is provided, filter by that date. If date is 'overall', return all-time counts.
export async function getEntryCountsByDcNumber(date?: string): Promise<{
  rows: { dc_no: string; tag_count: number; consumption_count: number }[];
  totalTag: number;
  totalConsumption: number;
}> {
  try {
    let dateFilter = '';
    const params: string[] = [];

    if (date && date !== 'overall') {
      dateFilter = `AND rj.created_at::date = $1::date`;
      params.push(date);
    }

    // Tag entries by dc_no (join dc_numbers_new for dc_number)
    const tagQuery = `
      SELECT dc.dc_number AS dc_no, COUNT(*)::int AS count
      FROM repair_jobs rj
      JOIN dc_numbers_new dc ON rj.dc_id = dc.id
      WHERE rj.tag_entry_by IS NOT NULL AND rj.tag_entry_by != ''
        AND dc.dc_number IS NOT NULL AND dc.dc_number != ''
        ${dateFilter}
      GROUP BY dc.dc_number
      ORDER BY dc.dc_number ASC`;

    // Consumption entries by dc_no
    const consumptionDateFilter = date && date !== 'overall'
      ? `AND rd.updated_at::date = $1::date`
      : '';

    const consumptionQuery = `
      SELECT dc.dc_number AS dc_no, COUNT(*)::int AS count
      FROM repair_jobs rj
      JOIN dc_numbers_new dc ON rj.dc_id = dc.id
      JOIN repair_details rd ON rj.id = rd.job_id
      WHERE rd.consumption_entry_by IS NOT NULL AND rd.consumption_entry_by != ''
        AND dc.dc_number IS NOT NULL AND dc.dc_number != ''
        ${consumptionDateFilter}
      GROUP BY dc.dc_number
      ORDER BY dc.dc_number ASC`;

    const [tagResult, consumptionResult] = await Promise.all([
      pool.query(tagQuery, params),
      pool.query(consumptionQuery, params),
    ]);

    // Merge results
    const dcNoMap = new Map<string, { tag_count: number; consumption_count: number }>();

    for (const row of tagResult.rows) {
      dcNoMap.set(row.dc_no, { tag_count: row.count, consumption_count: 0 });
    }
    for (const row of consumptionResult.rows) {
      const existing = dcNoMap.get(row.dc_no) || { tag_count: 0, consumption_count: 0 };
      existing.consumption_count = row.count;
      dcNoMap.set(row.dc_no, existing);
    }

    const rows = Array.from(dcNoMap.entries())
      .map(([dc_no, counts]) => ({ dc_no, ...counts }))
      .sort((a, b) => a.dc_no.localeCompare(b.dc_no));

    const totalTag = rows.reduce((sum, r) => sum + r.tag_count, 0);
    const totalConsumption = rows.reduce((sum, r) => sum + r.consumption_count, 0);

    return { rows, totalTag, totalConsumption };
  } catch (error) {
    console.error('Error fetching entry counts by DC number:', error);
    return { rows: [], totalTag: 0, totalConsumption: 0 };
  }
}
