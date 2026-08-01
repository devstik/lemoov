const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
  socketPath: process.env.DB_SOCKET || null,
  host: (process.env.DB_HOST || process.env.MYSQL_HOST || '').replace(/^localhost$/i, '127.0.0.1'),
  user: process.env.DB_USER || process.env.MYSQL_USER,
  password: process.env.DB_PASS || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
  multipleStatements: true,
  charset: 'utf8mb4'
};

if (!(config.socketPath || config.host) || !config.user || !config.database) {
  console.error('Configure DB_HOST/DB_SOCKET, DB_USER e DB_NAME antes de executar as migrations.');
  process.exitCode = 1;
  return;
}

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  const connection = await mysql.createConnection({
    ...(config.socketPath ? { socketPath: config.socketPath } : { host: config.host }),
    user: config.user,
    password: config.password,
    database: config.database,
    multipleStatements: true,
    charset: config.charset
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS lemoov_schema_migrations (
      version VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const [appliedRows] = await connection.query('SELECT version FROM lemoov_schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.version));
    for (const file of files) {
      const version = path.basename(file, '.sql');
      if (applied.has(version)) {
        console.log(`Ignorando ${version} (já aplicada).`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Aplicando ${version}...`);
      await connection.query(sql);
      await connection.execute('INSERT IGNORE INTO lemoov_schema_migrations (version) VALUES (?)', [version]);
      console.log(`Concluída: ${version}`);
    }
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Falha na migration:', error.message);
  process.exitCode = 1;
});

