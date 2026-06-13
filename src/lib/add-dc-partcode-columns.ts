// This script is now a NO-OP.
// The normalized schema uses dc_numbers_new + dc_product_map instead of
// adding columns to the old consolidated_data table.
// Kept for backward compatibility so package.json scripts don't break.

import pool from './pg-db';

async function addDcPartcodeColumns() {
  try {
    console.log('addDcPartcodeColumns: no-op in normalized schema.');
    console.log('DC numbers are stored in dc_numbers_new table.');
    console.log('Part codes are stored in products table and linked via dc_product_map.');
    console.log('Database schema is up to date.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addDcPartcodeColumns();