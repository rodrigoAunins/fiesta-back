const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

for (const rawLine of envContent.split(/\r?\n/)) {
  const line = rawLine.trim();

  if (!line || line.startsWith('#')) {
    continue;
  }

  const separatorIndex = line.indexOf('=');

  if (separatorIndex === -1) {
    continue;
  }

  const key = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();

  if (!(key in process.env)) {
    process.env[key] = value;
  }
}

const normalize = (value) => String(value ?? '').trim().toLowerCase();

async function main() {
  const masterEmails = String(process.env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);

  if (!masterEmails.length) {
    throw new Error('SUPERADMIN_EMAILS no está configurado');
  }

  const password = 'Master123!';

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();

  try {
    let targetEmail = null;

    for (const candidateEmail of masterEmails) {
      const existing = await client.query(
        'select email from users where lower(email) = $1 limit 1',
        [candidateEmail],
      );

      if (existing.rowCount) {
        targetEmail = candidateEmail;
        break;
      }
    }

    if (!targetEmail) {
      throw new Error(
        `No existe un usuario maestro para los emails configurados: ${masterEmails.join(', ')}`,
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'update users set "passwordHash" = $1, "isActive" = true where lower(email) = $2 returning email, role, "isActive"',
      [passwordHash, targetEmail],
    );

    console.log(
      JSON.stringify(
        {
          alias: 'master',
          email: result.rows[0].email,
          role: result.rows[0].role,
          isActive: result.rows[0].isActive,
          password,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});