import { pool } from './src/db/client';

async function queryLast() {
  const result = await pool.query('SELECT * FROM conversation_history ORDER BY timestamp DESC LIMIT 2');
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
queryLast();
