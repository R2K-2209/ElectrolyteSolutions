require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // 1. Create stock_receipts table
    console.log("Creating stock_receipts table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_receipts (
        id SERIAL PRIMARY KEY,
        vendor_name VARCHAR(255),
        invoice_no VARCHAR(255),
        received_date DATE,
        invoice_file_path TEXT,
        total_amount NUMERIC(12, 2),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Add columns to inventory_transactions
    console.log("Altering inventory_transactions table...");
    
    // Check if receipt_id exists first to avoid errors if run twice
    const checkRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='inventory_transactions' AND column_name='receipt_id'
    `);
    
    if (checkRes.rows.length === 0) {
      await client.query(`
        ALTER TABLE inventory_transactions 
        ADD COLUMN receipt_id INTEGER REFERENCES stock_receipts(id) ON DELETE SET NULL,
        ADD COLUMN unit_cost NUMERIC(10, 2)
      `);
      console.log("Columns added to inventory_transactions.");
    } else {
      console.log("Columns already exist in inventory_transactions. Skipping.");
    }

    await client.query("COMMIT");
    console.log("Migration successful.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
