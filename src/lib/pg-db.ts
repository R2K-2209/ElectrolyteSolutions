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

// Initialize the database tables
export async function initializeDatabase() {
  try {
    const databaseName = process.env.PG_DATABASE || 'nexscan';

    // Create BOM table for component validation
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

    // Create dc_numbers table for storing DC numbers and their part codes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_numbers (
        id SERIAL PRIMARY KEY,
        dc_number VARCHAR(255) NOT NULL UNIQUE,
        part_codes JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create consolidated_data table that matches the Excel export structure
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consolidated_data (
        id SERIAL PRIMARY KEY,
        sr_no VARCHAR(255),
        dc_no VARCHAR(255),
        dc_date DATE,
        branch VARCHAR(255),
        bccd_name VARCHAR(255),
        product_description TEXT,
        product_sr_no VARCHAR(255),
        date_of_purchase DATE,
        complaint_no VARCHAR(255),
        part_code VARCHAR(255),
        defect TEXT,
        visiting_tech_name VARCHAR(255),
        mfg_month_year VARCHAR(255),
        repair_date DATE,
        testing VARCHAR(50),
        failure VARCHAR(50),
        status VARCHAR(50),
        pcb_sr_no VARCHAR(255),
        analysis TEXT,
        component_change TEXT,
        engg_name VARCHAR(255),
        tag_entry_by VARCHAR(255),
        consumption_entry_by VARCHAR(255),
        dispatch_entry_by VARCHAR(255),
        dispatch_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Remove UNIQUE constraint on product_sr_no if it exists (to allow any Product Sr No to be saved)
    try {
      await pool.query(`
        ALTER TABLE repair_dashboard_view DROP CONSTRAINT IF EXISTS consolidated_data_product_sr_no_key;
      `);
      console.log('Removed UNIQUE constraint on product_sr_no column');
    } catch (error) {
      // Constraint might not exist or already removed
      console.log('Attempted to remove UNIQUE constraint on product_sr_no - may not have existed');
      console.log('Error details:', error);
    }

    // Also ensure indexes are created for better query performance
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_consolidated_data_dc_no ON consolidated_data(dc_no);
        CREATE INDEX IF NOT EXISTS idx_consolidated_data_part_code ON consolidated_data(part_code);
        CREATE INDEX IF NOT EXISTS idx_consolidated_data_product_sr_no ON consolidated_data(product_sr_no);
        CREATE INDEX IF NOT EXISTS idx_consolidated_data_pcb_sr_no ON consolidated_data(pcb_sr_no);
        CREATE INDEX IF NOT EXISTS idx_consolidated_data_created_at ON consolidated_data(created_at);
      `);
      console.log('Created indexes for consolidated_data table');
    } catch (error) {
      // Indexes might already exist, which is fine
      console.log('Indexes creation attempted - may already exist');
      console.log('Error details:', error);
    }

    // Create users table for Supabase user synchronization
    // Enable the pgcrypto extension for gen_random_uuid() if not already enabled
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

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

    // Create engineers table for storing engineer names
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_engineer_name ON engineers (name);`);
    } catch (indexError) {
      // Index might already exist, which is fine
      console.log('Engineer index creation attempted - may already exist');
    }

    // Add name column if it doesn't exist (for existing databases)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
    } catch (alterError) {
      // Column may already exist, which is fine
      console.log('Name column addition attempted - may already exist');
    }

    // Create indexes for better query performance
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_supabase_user_id ON users (supabase_user_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_email ON users (email);`);
    } catch (indexError) {
      // Indexes might already exist, which is fine
      console.log('Indexes creation attempted - may already exist');
    }

    // Create sheets table for grouping data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sheets (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Get the next sequential SR No for a given Partcode
export async function getNextSrNoForPartcode(partcode: string): Promise<string> {
  try {
    console.log('Getting next SR No for Partcode:', partcode);

    const result = await pool.query(
      'SELECT MAX(CAST(sr_no AS INTEGER)) as max_sr_no FROM repair_dashboard_view WHERE part_code = $1',
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

// Find consolidated data entry by part_code and sr_no
export async function findConsolidatedDataEntryByPartCodeAndSrNo(partCode: string, srNo: string): Promise<any> {
  try {
    const result = await pool.query(
      'SELECT * FROM repair_dashboard_view WHERE part_code = $1 AND sr_no = $2 LIMIT 1',
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
      'SELECT * FROM repair_dashboard_view WHERE product_sr_no = $1 LIMIT 1',
      [productSrNo]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error finding consolidated data entry by product_sr_no:', error);
    return null;
  }
}

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
    } else if (entry.testing !== undefined && entry.testing !== null) {
      updates.push(`testing = $${paramCount}`);
      values.push(entry.testing);
      paramCount++;
    }
    if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    } else if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    }
    if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    } else if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    }

    if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    } else if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    }
    // validation_result column has been removed from database
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

    const query = `UPDATE repair_dashboard_view SET ${updates.join(', ')} WHERE product_sr_no = $${paramCount}`;

    console.log('Executing query:', query);
    console.log('With values:', values);

    const result = await pool.query(query, values);

    console.log('Query result:', result);
    console.log('Rows affected:', result.rowCount);

    return true;
  } catch (error) {
    console.error('Error updating consolidated data entry by product_sr_no:', error);
    throw error;
  }
}

// Test function to verify database updates are working
export async function testDatabaseUpdate(): Promise<boolean> {
  try {
    console.log('Testing database update...');

    // First, try to get a test record
    const testResult = await pool.query(
      'SELECT product_sr_no FROM repair_dashboard_view LIMIT 1'
    );

    if (testResult.rows.length === 0) {
      console.log('No records found in consolidated_data table');
      return false;
    }

    const testProductSrNo = testResult.rows[0].product_sr_no;
    console.log('Testing update for product_sr_no:', testProductSrNo);

    // Try a simple update
    const updateResult = await pool.query(
      'UPDATE repair_dashboard_view SET updated_at = CURRENT_TIMESTAMP WHERE product_sr_no = $1',
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

// Engineer service functions
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

// BOM service functions
export async function getBomDescription(partCode: string, location: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT b.description FROM bom_new b JOIN products p ON b.product_id = p.id WHERE p.part_code = $1 AND b.location = $2`,
      [partCode, location]
    );

    if (result.rows.length > 0) {
      return result.rows[0].description;
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
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM bom_new WHERE location = $1',
      [location]
    );

    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking if location exists:', error);
    return false;
  }
}

// Check if a component exists in the BOM for a specific part code
export async function checkComponentForPartCode(partCode: string, location: string, parentPartCode: string): Promise<boolean> {
  try {
    // This would check if the component is valid for the specific parent part code
    // For now, we'll just check if it exists in the BOM
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM bom_new b JOIN products p ON b.product_id = p.id WHERE p.part_code = $1 AND b.location = $2`,
      [partCode, location]
    );

    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking component for part code:', error);
    return false;
  }
}

// DC Number service functions
export async function getAllDcNumbers(): Promise<{ dcNumber: string, partCodes: string[] }[]> {
  try {
    const result = await pool.query(`
      SELECT d.dc_number, array_agg(p.part_code) as part_codes
      FROM dc_numbers_new d
      LEFT JOIN dc_product_map m ON d.id = m.dc_id
      LEFT JOIN products p ON m.product_id = p.id
      GROUP BY d.id, d.dc_number, d.created_at
      ORDER BY d.created_at ASC
    `);

    return result.rows.map((row: any) => ({
      dcNumber: row.dc_number,
      partCodes: Array.isArray(row.part_codes) ? row.part_codes.filter((p: string | null) => p !== null) : []
    }));
  } catch (error) {
    console.error('Error fetching DC numbers:', error);
    return [];
  }
}

export async function addDcNumber(dcNumber: string, partCodes: string[]): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'INSERT INTO dc_numbers_new (dc_number) VALUES ($1) ON CONFLICT (dc_number) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id',
      [dcNumber]
    );
    const dcId = res.rows[0].id;
    await client.query('DELETE FROM dc_product_map WHERE dc_id = $1', [dcId]);
    for (const pc of partCodes) {
      if (!pc) continue;
      const prodRes = await client.query(
        'INSERT INTO products (part_code) VALUES ($1) ON CONFLICT (part_code) DO UPDATE SET part_code = EXCLUDED.part_code RETURNING id',
        [pc]
      );
      const prodId = prodRes.rows[0].id;
      await client.query('INSERT INTO dc_product_map (dc_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dcId, prodId]);
    }
    await client.query('COMMIT');
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
  return addDcNumber(dcNumber, partCodes);
}

export async function deleteDcNumber(dcNumber: string): Promise<boolean> {
  try {
    await pool.query(
      'DELETE FROM dc_numbers_new WHERE dc_number = $1',
      [dcNumber]
    );
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
    const countResult = await pool.query('SELECT COUNT(*) as count FROM bom_new');
    if (parseInt(countResult.rows[0].count) > 0) {
      return; // Already has data
    }

    // No sample data to add - keeping database empty as per requirements
    console.log('No sample BOM data added - database kept empty');
  } catch (error) {
    console.error('Error checking BOM data:', error);
  }
}

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
      FROM repair_dashboard_view
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
      INSERT INTO repair_dashboard_view 
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
      FROM repair_dashboard_view
      WHERE sr_no ~ '^[0-9]+$'
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `);

    const maxSrNo = seqResult.rows[0]?.max_sr_no ?? 0;
    const startSrNo = maxSrNo + 1;
    const endSrNo = maxSrNo + count;

    console.log(`Bulk SR No range: ${startSrNo} to ${endSrNo}`);

    // Build batch INSERT with all entries
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
      INSERT INTO repair_dashboard_view 
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

// Get consolidated data entries with pagination
export async function getConsolidatedDataEntriesPaginated(limit: number, offset: number): Promise<any[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM repair_dashboard_view ORDER BY created_at DESC LIMIT $1 OFFSET $2',
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
      `SELECT * FROM repair_dashboard_view
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
    const result = await pool.query('SELECT COUNT(*) FROM repair_dashboard_view');
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
    } else if (entry.testing !== undefined && entry.testing !== null) {
      updates.push(`testing = $${paramCount}`);
      values.push(entry.testing);
      paramCount++;
    }
    if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    } else if (entry.failure !== undefined && entry.failure !== null) {
      updates.push(`failure = $${paramCount}`);
      values.push(entry.failure);
      paramCount++;
    }
    if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    } else if (entry.status !== undefined && entry.status !== null) {
      updates.push(`status = $${paramCount}`);
      values.push(entry.status);
      paramCount++;
    }

    if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    } else if (entry.analysis !== undefined && entry.analysis !== null) {
      updates.push(`analysis = $${paramCount}`);
      values.push(entry.analysis);
      paramCount++;
    }
    // validation_result column has been removed from database
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

    const query = `UPDATE repair_dashboard_view SET ${updates.join(', ')} WHERE id = $${paramCount}`;

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
    await pool.query(
      'DELETE FROM repair_dashboard_view WHERE id = $1',
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
    await pool.query('DELETE FROM repair_dashboard_view');
  } catch (error) {
    console.error('Error clearing consolidated data:', error);
    throw error;
  }
}

// Search for consolidated data entries by DC number, part code, and product serial number
export async function searchConsolidatedDataEntries(dcNo?: string, partCode?: string, productSrNo?: string): Promise<any[]> {
  try {
    let query = 'SELECT * FROM repair_dashboard_view WHERE TRUE';
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
export async function searchConsolidatedDataEntriesByPcb(dcNo?: string, partCode?: string, pcbSrNo?: string, srNo?: string): Promise<any[]> {
  try {
    let query = 'SELECT * FROM repair_dashboard_view WHERE TRUE';
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

    
    if (srNo && srNo.trim() !== '') {
      const paddedSrNo = srNo.trim().padStart(4, '0');
      query += ` AND sr_no = $${paramCount}`;
      params.push(paddedSrNo);
      paramCount++;
    } else if (pcbSrNo && pcbSrNo.trim() !== '') {

      // Allow searching with or without the trailing check digit (error bit)
      // AND with or without the legacy '0' separator between PartCode and MonthCode

      const permutations = [pcbSrNo]; // 1. Exact match (New format: ES971039B260247R)

      if (pcbSrNo.length > 14) {
        // 2. Base match without check digit (ES971039B260247)
        const basePcbSrNo = pcbSrNo.substring(0, pcbSrNo.length - 1);
        permutations.push(basePcbSrNo);

        // Calculate where to insert the legacy '0'
        // New Format: ES + PartCode(N) + MonthCode(1) + Year(2) + SrNo(4) + Check(1)
        // Example: ES971039B262427R
        // Legacy Format: ES + PartCode(N) + MonthCode(1) + Year(2) + '0' + SrNo(4) (usually no check digit)
        // Example: ES971039B2602427

        // We know SrNo is 4 digits. Check digit is 1 char. Total 5 chars at the end.
        // So the MonthYear part ends right before the last 5 characters.
        if (pcbSrNo.length >= 10) { // Safety check for minimum expected length
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
      'SELECT * FROM repair_dashboard_view WHERE dc_no = $1 ORDER BY created_at DESC',
      [dcNo]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting consolidated data entries by DC number:', error);
    return [];
  }
}

// Remove unused columns from consolidated_data table
export async function removeUnusedColumnsFromConsolidatedData() {
  try {
    // Check if rf_observation column exists before attempting to drop it
    const rfObsCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'consolidated_data' AND column_name = 'rf_observation'
    `);

    if (rfObsCheck.rows.length > 0) {
      await pool.query('ALTER TABLE repair_dashboard_view DROP COLUMN rf_observation');
      console.log('Column rf_observation removed successfully');
    } else {
      console.log('Column rf_observation does not exist, skipping');
    }

    // Check if validation_result column exists before attempting to drop it
    const valResCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'consolidated_data' AND column_name = 'validation_result'
    `);

    if (valResCheck.rows.length > 0) {
      await pool.query('ALTER TABLE repair_dashboard_view DROP COLUMN validation_result');
      console.log('Column validation_result removed successfully');
    } else {
      console.log('Column validation_result does not exist, skipping');
    }

    return true;
  } catch (error) {
    console.error('Error removing unused columns from consolidated_data:', error);
    return false;
  }
}

// Get entry counts by user for a specific date (for admin dashboard)
export async function getAdminEntryCountsByDate(date: string): Promise<{
  tagEntries: { user_name: string; count: number }[];
  consumptionEntries: { user_name: string; count: number }[];
}> {
  try {
    // Build date filter conditionally — skip it for 'overall' (all-time) view
    const isOverall = !date || date === 'overall';
    const tagDateFilter = isOverall ? '' : `AND created_at::date = $1::date`;
    const consumptionDateFilter = isOverall ? '' : `AND updated_at::date = $1::date`;
    const params = isOverall ? [] : [date];

    // Tag entries: count rows where tag_entry_by is set
    const tagResult = await pool.query(
      `SELECT tag_entry_by AS user_name, COUNT(*)::int AS count
       FROM repair_dashboard_view
       WHERE tag_entry_by IS NOT NULL
         AND tag_entry_by != ''
         ${tagDateFilter}
       GROUP BY tag_entry_by
       ORDER BY tag_entry_by ASC`,
      params
    );

    // Consumption entries: count rows where consumption_entry_by is set
    const consumptionResult = await pool.query(
      `SELECT consumption_entry_by AS user_name, COUNT(*)::int AS count
       FROM repair_dashboard_view
       WHERE consumption_entry_by IS NOT NULL
         AND consumption_entry_by != ''
         ${consumptionDateFilter}
       GROUP BY consumption_entry_by
       ORDER BY consumption_entry_by ASC`,
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

// Get next SR No: MAX(sr_no) for the current calendar month + 1.
// Resets to 1 at the start of each new month.
export async function getNextGlobalPcbSequence(_mfgMonthYear?: string): Promise<string> {
  try {
    // Find the highest sr_no among rows inserted in the current calendar month
    const result = await pool.query(`
      SELECT MAX(CAST(sr_no AS INTEGER)) AS max_sr_no
      FROM repair_dashboard_view
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

// Get today's entry counts for a specific user (for user dashboard footer)
export async function getUserEntryCountsToday(userName: string): Promise<{ tagCount: number; consumptionCount: number }> {
  try {
    // Use CURRENT_DATE from PostgreSQL to avoid any timezone mismatch between Node.js and the DB
    const tagResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM repair_dashboard_view
       WHERE tag_entry_by = $1
         AND created_at::date = CURRENT_DATE`,
      [userName]
    );

    const consumptionResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM repair_dashboard_view
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
      dateFilter = `AND created_at::date = $1::date`;
      params.push(date);
    }

    // Tag entries by part_code
    const tagQuery = `
      SELECT part_code, COUNT(*)::int AS count
      FROM repair_dashboard_view
      WHERE tag_entry_by IS NOT NULL AND tag_entry_by != ''
        AND part_code IS NOT NULL AND part_code != ''
        ${dateFilter}
      GROUP BY part_code
      ORDER BY part_code ASC`;

    // Consumption entries by part_code (use updated_at for consumption date filtering)
    const consumptionDateFilter = date && date !== 'overall'
      ? `AND updated_at::date = $1::date`
      : '';

    const consumptionQuery = `
      SELECT part_code, COUNT(*)::int AS count
      FROM repair_dashboard_view
      WHERE consumption_entry_by IS NOT NULL AND consumption_entry_by != ''
        AND part_code IS NOT NULL AND part_code != ''
        ${consumptionDateFilter}
      GROUP BY part_code
      ORDER BY part_code ASC`;

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
      dateFilter = `AND created_at::date = $1::date`;
      params.push(date);
    }

    // Tag entries by dc_no
    const tagQuery = `
      SELECT dc_no, COUNT(*)::int AS count
      FROM repair_dashboard_view
      WHERE tag_entry_by IS NOT NULL AND tag_entry_by != ''
        AND dc_no IS NOT NULL AND dc_no != ''
        ${dateFilter}
      GROUP BY dc_no
      ORDER BY dc_no ASC`;

    // Consumption entries by dc_no
    const consumptionDateFilter = date && date !== 'overall'
      ? `AND updated_at::date = $1::date`
      : '';

    const consumptionQuery = `
      SELECT dc_no, COUNT(*)::int AS count
      FROM repair_dashboard_view
      WHERE consumption_entry_by IS NOT NULL AND consumption_entry_by != ''
        AND dc_no IS NOT NULL AND dc_no != ''
        ${consumptionDateFilter}
      GROUP BY dc_no
      ORDER BY dc_no ASC`;

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

// ============================================================================
// INVENTORY MANAGEMENT FUNCTIONS
// ============================================================================

// Type definitions for inventory operations
export interface ProductWithBomCount {
  id: number;
  part_code: string;
  description: string;
  component_count: number;
}

export interface BomComponent {
  id: number;
  product_id: number;
  location: string;
  spare_part_id: number | null;
  description: string;
  quantity: number;
  product_part_code: string;
  product_description: string;
  // Joined from spare_parts if linked
  current_stock: number | null;
  reorder_threshold: number | null;
}

export interface SparePart {
  id: number;
  part_name: string;
  description: string | null;
  stock_quantity: number;
  initial_quantity: number;
  reorder_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryTransaction {
  id: number;
  spare_part_id: number;
  txn_type: string;
  quantity: number;
  job_id: number | null;
  notes: string | null;
  created_at: string;
  part_name?: string;
}

export interface StockItem {
  bomId: number;
  partName: string;
  description: string;
  quantity: number;
  reorderThreshold: number;
}

export interface InventorySummary {
  totalUniqueComponents: number;
  totalInStock: number;
  totalLowStock: number;
  totalOutOfStock: number;
  totalStockValue: number;
  todayTransactions: number;
}

/**
 * Get all PCB products with the count of BOM components each has.
 * Used to populate the PCB selector dropdown in the Inventory UI.
 */
export async function getProductsWithBomCount(): Promise<ProductWithBomCount[]> {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.part_code,
        p.description,
        COUNT(b.id)::int AS component_count
      FROM products p
      LEFT JOIN bom_new b ON b.product_id = p.id
      GROUP BY p.id, p.part_code, p.description
      ORDER BY p.part_code
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching products with BOM count:', error);
    return [];
  }
}

/**
 * Get all BOM components for a specific product (PCB), enriched with
 * spare_parts stock data if a link exists.
 */
export async function getBomComponentsByProductId(productId: number): Promise<BomComponent[]> {
  try {
    const result = await pool.query(`
      SELECT 
        b.id,
        b.product_id,
        b.location,
        b.spare_part_id,
        b.description,
        b.quantity,
        p.part_code AS product_part_code,
        p.description AS product_description,
        sp.stock_quantity AS current_stock,
        sp.reorder_threshold
      FROM bom_new b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN spare_parts sp ON b.spare_part_id = sp.id
      WHERE b.product_id = $1
      ORDER BY b.location
    `, [productId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching BOM components by product ID:', error);
    return [];
  }
}

/**
 * Get all spare parts with current stock information.
 * Optionally filter by low-stock or search term.
 */
export async function getAllSpareParts(options?: {
  lowStockOnly?: boolean;
  search?: string;
}): Promise<SparePart[]> {
  try {
    let query = 'SELECT * FROM spare_parts WHERE TRUE';
    const params: any[] = [];
    let paramIdx = 1;

    if (options?.lowStockOnly) {
      query += ` AND stock_quantity <= reorder_threshold`;
    }

    if (options?.search && options.search.trim() !== '') {
      query += ` AND (part_name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`;
      params.push(`%${options.search.trim()}%`);
      paramIdx++;
    }

    query += ' ORDER BY part_name ASC';

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all spare parts:', error);
    return [];
  }
}

/**
 * Upsert a single spare part. If part_name already exists, ADD the quantity
 * to existing stock. Returns the spare_part id.
 * 
 * This is the core function — it guarantees idempotent part creation and
 * additive stock updates in a single atomic operation.
 */
export async function upsertSparePart(
  partName: string,
  description: string,
  quantity: number,
  reorderThreshold: number = 5
): Promise<number | null> {
  try {
    const result = await pool.query(`
      INSERT INTO spare_parts (part_name, description, stock_quantity, initial_quantity, reorder_threshold, updated_at)
      VALUES ($1, $2, $3, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (part_name) DO UPDATE SET
        stock_quantity = spare_parts.stock_quantity + $3,
        initial_quantity = spare_parts.initial_quantity + $3,
        description = COALESCE(NULLIF(EXCLUDED.description, ''), spare_parts.description),
        reorder_threshold = GREATEST(spare_parts.reorder_threshold, EXCLUDED.reorder_threshold),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [partName.trim(), description.trim(), quantity, reorderThreshold]);

    return result.rows[0]?.id ?? null;
  } catch (error) {
    console.error('Error upserting spare part:', error);
    return null;
  }
}

/**
 * Log an inventory transaction. This is the audit trail for all stock
 * movements (STOCK_IN, STOCK_OUT, CONSUMPTION, ADJUSTMENT).
 */
export async function addInventoryTransaction(
  sparePartId: number,
  txnType: 'STOCK_IN' | 'STOCK_OUT' | 'CONSUMPTION' | 'ADJUSTMENT',
  quantity: number,
  notes?: string,
  jobId?: number
): Promise<boolean> {
  try {
    await pool.query(`
      INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, job_id, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    `, [sparePartId, txnType, quantity, jobId || null, notes || null]);
    return true;
  } catch (error) {
    console.error('Error adding inventory transaction:', error);
    return false;
  }
}

/**
 * Link a BOM entry to a spare part by setting bom_new.spare_part_id.
 * This connects the BOM reference to the inventory tracking system.
 */
export async function linkBomToSparePart(bomId: number, sparePartId: number): Promise<boolean> {
  try {
    await pool.query(
      'UPDATE bom_new SET spare_part_id = $1 WHERE id = $2',
      [sparePartId, bomId]
    );
    return true;
  } catch (error) {
    console.error('Error linking BOM to spare part:', error);
    return false;
  }
}

/**
 * BATCH add stock for multiple components in a single database transaction.
 * 
 * For each item:
 *  1. Upsert into spare_parts (create or add quantity)
 *  2. Link bom_new.spare_part_id to the spare part
 *  3. Log a STOCK_IN transaction
 * 
 * If ANY step fails, the entire batch is rolled back.
 */
export async function addStockForComponents(
  items: StockItem[],
  addedBy?: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let processedCount = 0;

    for (const item of items) {
      if (item.quantity <= 0) continue;

      // 1. Upsert spare part and get its ID
      const upsertResult = await client.query(`
        INSERT INTO spare_parts (part_name, description, stock_quantity, initial_quantity, reorder_threshold, updated_at)
        VALUES ($1, $2, $3, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (part_name) DO UPDATE SET
          stock_quantity = spare_parts.stock_quantity + $3,
          initial_quantity = spare_parts.initial_quantity + $3,
          description = COALESCE(NULLIF(EXCLUDED.description, ''), spare_parts.description),
          reorder_threshold = GREATEST(spare_parts.reorder_threshold, EXCLUDED.reorder_threshold),
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [item.partName.trim(), item.description.trim(), item.quantity, item.reorderThreshold]);

      const sparePartId = upsertResult.rows[0].id;

      // 2. Link BOM entry to spare part (if bomId provided and valid)
      if (item.bomId > 0) {
        await client.query(
          'UPDATE bom_new SET spare_part_id = $1 WHERE id = $2',
          [sparePartId, item.bomId]
        );
      }

      // 3. Log the STOCK_IN transaction
      const notes = addedBy ? `Stock added by ${addedBy}` : 'Stock added';
      await client.query(`
        INSERT INTO inventory_transactions (spare_part_id, txn_type, quantity, notes, created_at)
        VALUES ($1, 'STOCK_IN', $2, $3, CURRENT_TIMESTAMP)
      `, [sparePartId, item.quantity, notes]);

      processedCount++;
    }

    await client.query('COMMIT');
    return { success: true, count: processedCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in batch addStockForComponents:', error);
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error during batch stock operation'
    };
  } finally {
    client.release();
  }
}

/**
 * Get aggregated inventory summary statistics.
 */
export async function getInventorySummary(): Promise<InventorySummary> {
  try {
    const [totalRes, lowRes, outRes, stockRes, txnRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM spare_parts'),
      pool.query('SELECT COUNT(*)::int AS count FROM spare_parts WHERE stock_quantity > 0 AND stock_quantity <= reorder_threshold'),
      pool.query('SELECT COUNT(*)::int AS count FROM spare_parts WHERE stock_quantity = 0'),
      pool.query('SELECT COALESCE(SUM(stock_quantity), 0)::int AS total FROM spare_parts'),
      pool.query(`SELECT COUNT(*)::int AS count FROM inventory_transactions WHERE created_at::date = CURRENT_DATE`),
    ]);

    const totalUnique = totalRes.rows[0].count;
    const lowStock = lowRes.rows[0].count;
    const outOfStock = outRes.rows[0].count;
    const inStock = totalUnique - outOfStock;

    return {
      totalUniqueComponents: totalUnique,
      totalInStock: inStock,
      totalLowStock: lowStock,
      totalOutOfStock: outOfStock,
      totalStockValue: stockRes.rows[0].total,
      todayTransactions: txnRes.rows[0].count,
    };
  } catch (error) {
    console.error('Error fetching inventory summary:', error);
    return {
      totalUniqueComponents: 0,
      totalInStock: 0,
      totalLowStock: 0,
      totalOutOfStock: 0,
      totalStockValue: 0,
      todayTransactions: 0,
    };
  }
}

/**
 * Get recent inventory transactions, optionally filtered by spare part.
 */
export async function getInventoryTransactions(
  sparePartId?: number,
  limit: number = 50
): Promise<InventoryTransaction[]> {
  try {
    let query = `
      SELECT it.*, sp.part_name
      FROM inventory_transactions it
      JOIN spare_parts sp ON it.spare_part_id = sp.id
    `;
    const params: any[] = [];

    if (sparePartId) {
      query += ' WHERE it.spare_part_id = $1';
      params.push(sparePartId);
    }

    query += ' ORDER BY it.created_at DESC';
    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error fetching inventory transactions:', error);
    return [];
  }
}
