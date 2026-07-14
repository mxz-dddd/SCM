import { spawnSync } from 'node:child_process';

const databaseName = 'scm_p2_e2e';
const jwtSecret = 'scm-p2-e2e-jwt-secret-at-least-32-characters';
const seedPassword = 'scm-p2-e2e-admin-password';

function run(command, args, environment = process.env, capture = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}`,
    );
  return capture ? result.stdout.trim() : '';
}

function databaseCommand(sql) {
  run('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    process.env.POSTGRES_USER ?? 'scm',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

let managedDatabase = false;
let databaseUrl = process.env.E2E_DATABASE_URL;

try {
  if (!databaseUrl) {
    const published = run(
      'docker',
      ['compose', 'port', 'postgres', '5432'],
      process.env,
      true,
    );
    const port = published.match(/:(\d+)$/)?.[1];
    if (!port)
      throw new Error(`Cannot determine PostgreSQL port from ${published}`);
    databaseCommand(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    databaseCommand(`CREATE DATABASE ${databaseName}`);
    const user = encodeURIComponent(process.env.POSTGRES_USER ?? 'scm');
    const password = encodeURIComponent(
      process.env.POSTGRES_PASSWORD ?? 'scm-local-only',
    );
    databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${databaseName}`;
    managedDatabase = true;
  }

  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    SEED_ADMIN_PASSWORD: seedPassword,
  };
  run(
    'pnpm',
    ['--dir', 'apps/api', 'exec', 'prisma', 'migrate', 'deploy'],
    environment,
  );
  run('pnpm', ['--filter', '@scm/api', 'db:seed'], environment);
  run('pnpm', ['exec', 'playwright', 'test'], environment);
} finally {
  if (managedDatabase)
    databaseCommand(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
}
