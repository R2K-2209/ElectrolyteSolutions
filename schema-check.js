require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bom_new'", (err, res) => {
  console.log(res?.rows);
  pool.end();
});
