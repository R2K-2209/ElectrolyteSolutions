require('dotenv').config();
const { Pool } = require('pg');
const xlsx = require('xlsx');
const path = require('path');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '2209',
  database: process.env.PG_DATABASE || 'nexscan',
});

const files = [
  "C:/Users/Ranjit Kadam/Documents/Electrolyte/Jan 26_May 26 Bajaj PCB Repair Report (1).xlsm",
  "C:/Users/Ranjit Kadam/Documents/Electrolyte/Aug 25_Dec 25 Bajaj PCB Repair Report.xlsm"
];

// Helper to convert Excel serial date to JS Date
function excelDateToJSDate(serial) {
  if (!serial) return null;
  try {
    if (typeof serial === 'number') {
      const utc_days  = Math.floor(serial - 25569);
      const utc_value = utc_days * 86400;                                        
      const date_info = new Date(utc_value * 1000);
      if (isNaN(date_info.getTime())) return null;
      return date_info.toISOString().split('T')[0];
    }
    if (typeof serial === 'string') {
      if (serial.trim().toUpperCase() === 'NA' || serial.trim().toUpperCase() === 'ND' || serial.trim() === '-') return null;
      const d = new Date(serial);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function run() {
  console.log('Starting Excel Migration...');
  const client = await pool.connect();
  
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    // 1. Pre-populate the 4 master defects and 3 failures to ensure they exist
    await client.query("INSERT INTO defect_types (name) VALUES ('DEAD'), ('NOT WORKING'), ('DAMAGED'), ('BURNT') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO failure_types (name) VALUES ('NOT WORKING'), ('FOUND OK'), ('COMPONENT') ON CONFLICT DO NOTHING");

    for (const file of files) {
      console.log(`\nProcessing file: ${path.basename(file)}`);
      const wb = xlsx.readFile(file);
      
      for (const sheetName of wb.SheetNames) {
        // Skip summary sheets
        if (['Master_Summary', 'Dashboard', 'Pivot', 'Summary'].includes(sheetName)) continue;
        
        console.log(`  Processing sheet: ${sheetName}`);
        const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
        
        for (const row of rows) {
          // Dynamic column mapping to handle both Excel formats
          const srNo = row['SR NO'] || row['Sr. No.'] || row['SR. NO'];
          if (!srNo) continue; // Skip empty rows

          const dcNo = row['DC No.'] || row['DC No'] || '';
          const dcDate = excelDateToJSDate(row['DC Date']);

          const branch = row['Branch'] || '';
          const bccdName = row['BCCD Name'] || '';
          const productDescription = row['Product Description'] || row['Description'] || '';
          const productSrNo = row['Product Sr No'] || row['Product Sr. No.'] || null;
          
          const dateOfPurchase = excelDateToJSDate(row['Date of Purchase']);

          const complaintNo = row['Complaint No'] || row['Complaint No.'] || '';
          const partCode = row['Part Code'] || row['Spare Part code'] || sheetName;
          const defectRaw = row['Defect'] || '';
          const visitingTechName = row['Visiting Tech Name'] || row['Visiting Tech'] || '';
          const mfgMonthYear = row['Mfg Month/Year'] || '';
          
          const repairDate = excelDateToJSDate(row['Repair Date']);

          const pcbSrNo = row['PCB Sr NO'] || row['PCB Sr. No.'] || '';
          const rfObservation = row['RF Observation'] || '';
          const testing = row['Testing'] || '';
          const failureRaw = row['Failure'] || '';
          const analysis = row['Analysis'] || '';
          const componentChange = row['Component Change'] || row['Component Consumption'] || '';
          const status = row['Status'] || '';
          
          const dispatchDate = excelDateToJSDate(row['Send Date'] || row['Dispatch Date']);

          const enggName = row['Engg Nmae'] || row['Engg. Name'] || row['Engineer'] || '';
          const tagEntryBy = row['Tag Entry By'] || '';
          const consumptionEntryBy = row['Consumption Entry'] || row['Consumption Entry By'] || '';

          await client.query('BEGIN');

          // --- Lookup Insertions ---

          // Product
          let productId = null;
          if (partCode) {
            const pRes = await client.query('INSERT INTO products (part_code, description) VALUES ($1, $2) ON CONFLICT (part_code) DO UPDATE SET description = COALESCE(products.description, EXCLUDED.description) RETURNING id', [partCode, productDescription]);
            productId = pRes.rows[0].id;
          }

          // Branch
          let branchId = null;
          if (branch && String(branch).trim()) {
            const bRes = await client.query('INSERT INTO branches (name) VALUES (INITCAP(TRIM($1))) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [String(branch)]);
            branchId = bRes.rows[0].id;
          }

          // Defect Mapping
          let defectId = null;
          const defectRawStr = String(defectRaw || '');
          if (defectRawStr && defectRawStr.trim() && defectRawStr.trim().toUpperCase() !== 'NA') {
            const dRaw = defectRawStr.trim().toUpperCase();
            let mappedDefect = null;
            if (['DEAD', 'DADA', 'DADE', 'DEAD,', 'DEAD.', 'DEADQ', 'DEDA', 'DEED', 'DWAD', 'NDEAD', 'SDEAD', 'DISPLAY / DEAD.', 'DISPLAY DEAD', 'DISPLAY PCB / PUB DEAD', 'MAIN PCB DEAD'].includes(dRaw)) mappedDefect = 'DEAD';
            else if (['NOT WORKING', 'NO WORKING', 'NOT-WORKING', 'NOT WOKING', 'NOT WORING', 'NOT WORK', 'NOT WORKIING', 'NOT WORKING-', 'NOT WORKING -', 'NOT WORKING.', 'DISPLAY', 'DISPLAY NOT WORKING', 'DISPLAY PCB / TOUCH NOT WORK', 'DISPLAY PROPER', 'IC FAULT', 'NOTHING', 'PCB', 'PCB NOT WORKING', 'TOUCH PROBLEM', 'SHORT', 'SHUNT', 'DNA', 'SUAR'].includes(dRaw)) mappedDefect = 'NOT WORKING';
            else if (['DAMAGE', 'DAMAGED', 'DAMEGE'].includes(dRaw)) mappedDefect = 'DAMAGED';
            else if (['BURN', 'BURNT'].includes(dRaw)) mappedDefect = 'BURNT';

            if (mappedDefect) {
              const defRes = await client.query('SELECT id FROM defect_types WHERE name = $1', [mappedDefect]);
              if (defRes.rows.length > 0) defectId = defRes.rows[0].id;
            }
          }

          // Failure Mapping
          let failureId = null;
          const failureRawStr = String(failureRaw || '');
          if (failureRawStr && failureRawStr.trim()) {
            const fRaw = failureRawStr.trim().toUpperCase();
            let mappedFailure = null;
            if (['NOT WORKING', 'NIOT WORKING', 'NOT WOTKING', 'NOT WPRKING', 'NOTWORKING', 'NOPT WORKING', 'NOT BWORKING'].includes(fRaw)) mappedFailure = 'NOT WORKING';
            else if (['FOUND OK'].includes(fRaw)) mappedFailure = 'FOUND OK';
            else if (['COMPONENT'].includes(fRaw)) mappedFailure = 'COMPONENT';

            if (mappedFailure) {
              const fRes = await client.query('SELECT id FROM failure_types WHERE name = $1', [mappedFailure]);
              if (fRes.rows.length > 0) failureId = fRes.rows[0].id;
            }
          }

          // Engineer
          let enggId = null;
          const enggNameStr = String(enggName || '');
          if (enggNameStr && enggNameStr.trim() && enggNameStr.trim().toUpperCase() !== 'NA') {
            const cleanName = enggNameStr.trim();
            // Case insensitive lookup
            let eRes = await client.query('SELECT id FROM engineers WHERE LOWER(TRIM(name)) = LOWER($1)', [cleanName]);
            if (eRes.rows.length === 0) {
              eRes = await client.query('INSERT INTO engineers (name) VALUES ($1) RETURNING id', [cleanName]);
            }
            enggId = eRes.rows[0].id;
          }

          // DC Number
          let dcId = null;
          if (dcNo && dcNo.trim()) {
            const dcRes = await client.query('INSERT INTO dc_numbers_new (dc_number, dc_date) VALUES ($1, $2) ON CONFLICT (dc_number) DO UPDATE SET dc_date = COALESCE(dc_numbers_new.dc_date, EXCLUDED.dc_date) RETURNING id', [dcNo.trim(), dcDate || null]);
            dcId = dcRes.rows[0].id;
            
            if (productId) {
              await client.query('INSERT INTO dc_product_map (dc_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dcId, productId]);
            }
          }

          // --- Main Insert ---
          
          let jobId = null;

          // Check if it already exists by product_sr_no
          if (productSrNo) {
            const existing = await client.query('SELECT id FROM repair_jobs WHERE product_sr_no = $1', [productSrNo]);
            if (existing.rows.length > 0) {
              jobId = existing.rows[0].id;
              // Update core details
              await client.query(`
                UPDATE repair_jobs SET 
                  sr_no = $1, dc_id = $2, branch_id = $3, bccd_name = $4, date_of_purchase = $5, complaint_no = $6, 
                  defect_id = $7, defect_raw = $8, visiting_tech_name = $9, mfg_month_year = $10, status = $11, pcb_sr_no = $12, tag_entry_by = $13
                WHERE id = $14
              `, [String(srNo).padStart(4, '0'), dcId, branchId, bccdName, dateOfPurchase || null, complaintNo, defectId, defectRaw, visitingTechName, mfgMonthYear, status, pcbSrNo, tagEntryBy, jobId]);
              updated++;
            }
          }

          // Check by sr_no and partCode if no product_sr_no or not found
          if (!jobId) {
            const paddedSrNo = String(srNo).padStart(4, '0');
            const existing = await client.query('SELECT id FROM repair_jobs WHERE sr_no = $1 AND product_id = $2', [paddedSrNo, productId]);
            if (existing.rows.length > 0) {
              jobId = existing.rows[0].id;
              updated++;
            } else {
              // Insert new
              const rjRes = await client.query(`
                INSERT INTO repair_jobs (
                  sr_no, dc_id, product_id, branch_id, bccd_name, product_sr_no, date_of_purchase, complaint_no, 
                  defect_id, defect_raw, visiting_tech_name, mfg_month_year, status, pcb_sr_no, tag_entry_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id
              `, [String(srNo).padStart(4, '0'), dcId, productId, branchId, bccdName, productSrNo, dateOfPurchase || null, complaintNo, defectId, defectRaw, visitingTechName, mfgMonthYear, status, pcbSrNo, tagEntryBy]);
              jobId = rjRes.rows[0].id;
              inserted++;
            }
          }

          // Insert / Update repair_details
          if (jobId) {
            const rdExisting = await client.query('SELECT job_id FROM repair_details WHERE job_id = $1', [jobId]);
            if (rdExisting.rows.length > 0) {
              await client.query(`
                UPDATE repair_details SET 
                  repair_date = $1, testing = $2, failure_type_id = $3, failure_raw = $4, rf_observation = $5, 
                  analysis = $6, component_change = $7, engg_id = $8, consumption_entry_by = $9
                WHERE job_id = $10
              `, [repairDate || null, testing, failureId, failureRaw, rfObservation, analysis, componentChange, enggId, consumptionEntryBy, jobId]);
            } else {
              await client.query(`
                INSERT INTO repair_details (
                  job_id, repair_date, testing, failure_type_id, failure_raw, rf_observation, analysis, component_change, engg_id, consumption_entry_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `, [jobId, repairDate || null, testing, failureId, failureRaw, rfObservation, analysis, componentChange, enggId, consumptionEntryBy]);
            }
          }

          // Insert / Update dispatch_details
          if (jobId && (dispatchDate || row['Dispatch Entry By'])) {
             const dispExisting = await client.query('SELECT job_id FROM dispatch_details WHERE job_id = $1', [jobId]);
             if (dispExisting.rows.length > 0) {
               await client.query('UPDATE dispatch_details SET dispatch_date = $1, dispatch_entry_by = $2 WHERE job_id = $3', [dispatchDate || null, row['Dispatch Entry By'] || null, jobId]);
             } else {
               await client.query('INSERT INTO dispatch_details (job_id, dispatch_date, dispatch_entry_by) VALUES ($1, $2, $3)', [jobId, dispatchDate || null, row['Dispatch Entry By'] || null]);
             }
          }

          await client.query('COMMIT');
        }
      }
    }
    
    console.log(`\\nMigration Complete!`);
    console.log(`Inserted: ${inserted} new records`);
    console.log(`Updated/Merged: ${updated} existing records`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    pool.end();
  }
}

run();
