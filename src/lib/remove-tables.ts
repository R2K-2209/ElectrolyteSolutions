// This script is now a NO-OP.
// The normalized schema no longer uses sheet_data or consumption_entries tables.
// Kept for backward compatibility so package.json scripts don't break.

import pool from './pg-db';

async function removeTables() {
  try {
    console.log('Removing obsolete tables (if they exist)...');
    
    // Remove sheet_data table if it exists
    try {
      await pool.query(`DROP TABLE IF EXISTS sheet_data CASCADE`);
      console.log('Table sheet_data removed (if it existed)');
    } catch (error) {
      console.error('Error removing sheet_data table:', error);
    }
    
    // Remove consumption_entries table if it exists
    try {
      await pool.query(`DROP TABLE IF EXISTS consumption_entries CASCADE`);
      console.log('Table consumption_entries removed (if it existed)');
    } catch (error) {
      console.error('Error removing consumption_entries table:', error);
    }

    // Remove old consolidated_data table if it exists (data is now in normalized tables)
    try {
      await pool.query(`DROP TABLE IF EXISTS consolidated_data CASCADE`);
      console.log('Table consolidated_data removed (data now in normalized tables)');
    } catch (error) {
      console.error('Error removing consolidated_data table:', error);
    }
    
    console.log('Tables cleanup completed!');
  } catch (error) {
    console.error('Error during table removal:', error);
    throw error;
  }
}

// Run the removal function
removeTables()
  .then(() => {
    console.log('Table removal process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Table removal process failed:', error);
    process.exit(1);
  });