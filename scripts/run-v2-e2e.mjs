import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const databaseName = 'scm_v2_e2e';
const artifacts = 'artifacts/v2';
const postgresUser = process.env.POSTGRES_USER ?? 'scm';
const jwtSecret = 'scm-v2-e2e-jwt-secret-at-least-32-characters';
const seedPassword = 'scm-v2-e2e-admin-password';
const workerControlToken =
  'scm-v2-e2e-worker-control-token-at-least-32-characters';
const workerActorId = '10000000-0000-4000-8000-000000000099';
const children = [];
const composeEnvironment = {
  ...process.env,
  POSTGRES_PORT: process.env.V2_POSTGRES_PORT ?? '55434',
  REDIS_PORT: process.env.V2_REDIS_PORT ?? '56379',
};

rmSync(artifacts, { force: true, recursive: true });
mkdirSync(artifacts, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: options.environment ?? process.env,
    maxBuffer: 100 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (options.logPath) {
    writeFileSync(
      options.logPath,
      `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}`,
    );
  }
  return options.capture ? String(result.stdout).trim() : '';
}

function composePsql(database, sql, capture = false) {
  return run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      postgresUser,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...(capture ? ['-At'] : []),
      '-c',
      sql,
    ],
    { capture, environment: composeEnvironment },
  );
}

function startService(name, command, args, environment) {
  const logPath = `${artifacts}/${name}.log`;
  const descriptor = openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: false,
    env: environment,
    stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  children.push({ child, logPath, name });
  return child;
}

async function waitFor(name, url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let last = 'not attempted';
  while (Date.now() - startedAt < timeoutMs) {
    const service = children.find((candidate) => candidate.name === name);
    if (service?.child.exitCode !== null) {
      throw new Error(
        `${name} exited with ${service?.child.exitCode}; inspect ${service?.logPath}`,
      );
    }
    try {
      const response = await fetch(url);
      last = `${response.status} ${response.statusText}`;
      if (response.ok) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} was not ready at ${url}: ${last}`);
}

async function stopServices() {
  for (const { child } of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve(undefined);
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve(undefined);
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        }),
    ),
  );
}

let databaseCreated = false;
try {
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'redis'], {
    environment: composeEnvironment,
  });
  const published = run('docker', ['compose', 'port', 'postgres', '5432'], {
    capture: true,
    environment: composeEnvironment,
  });
  const port = published.match(/:(\d+)$/)?.[1];
  if (!port)
    throw new Error(`Cannot determine PostgreSQL port from ${published}`);
  composePsql(
    'postgres',
    `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
  );
  composePsql('postgres', `CREATE DATABASE ${databaseName}`);
  databaseCreated = true;
  run(
    'docker',
    ['compose', 'exec', '-T', 'redis', 'redis-cli', '-n', '15', 'FLUSHDB'],
    { environment: composeEnvironment },
  );

  const user = encodeURIComponent(postgresUser);
  const password = encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? 'scm-local-only',
  );
  const environment = {
    ...process.env,
    API_CREDENTIAL_MASTER_KEY:
      'scm-v2-e2e-api-credential-master-key-32-characters',
    API_RATE_LIMIT_PER_MINUTE: '10000',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
    DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/${databaseName}`,
    JWT_SECRET: jwtSecret,
    LOGIN_RATE_LIMIT_PER_MINUTE: '10000',
    PORT: '3100',
    REDIS_DB: '15',
    REDIS_PORT: composeEnvironment.REDIS_PORT,
    SEED_ADMIN_PASSWORD: seedPassword,
    V2_API_URL: 'http://127.0.0.1:3100',
    V2_COMMIT_SHA: run('git', ['rev-parse', 'HEAD'], { capture: true }),
    V2_WEB_URL: 'http://127.0.0.1:4173',
    WORKER_ACTOR_ID: workerActorId,
    WORKER_API_URL: 'http://127.0.0.1:3100',
    WORKER_CONTROL_TOKEN: workerControlToken,
    WORKER_EVENT_DELIVERY_INTERVAL_MS: '2000',
    WORKER_HEALTH_PORT: '3101',
    WORKER_RELAY_INTERVAL_MS: '500',
    WORKER_TENANT_CONCURRENCY: '4',
    WORKER_TENANT_REFRESH_INTERVAL_MS: '500',
    WORKER_WEBHOOK_INTERVAL_MS: '1000',
  };

  run('pnpm', ['--dir', 'apps/api', 'exec', 'prisma', 'migrate', 'deploy'], {
    capture: true,
    environment,
    logPath: `${artifacts}/migration.log`,
  });
  run('pnpm', ['--filter', '@scm/api', 'db:seed'], { environment });

  startService(
    'api',
    'pnpm',
    ['--dir', 'apps/api', 'exec', 'tsx', 'src/main.ts'],
    environment,
  );
  await waitFor('api', 'http://127.0.0.1:3100/health');
  startService(
    'worker',
    'pnpm',
    ['--filter', '@scm/worker', 'exec', 'tsx', 'src/main.ts'],
    environment,
  );
  startService(
    'web',
    'pnpm',
    [
      '--dir',
      'apps/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      '4173',
    ],
    environment,
  );
  await Promise.all([
    waitFor('worker', 'http://127.0.0.1:3101/health'),
    waitFor('web', 'http://127.0.0.1:4173/workbench'),
  ]);

  const output = run(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.v2.config.ts'],
    {
      capture: true,
      environment,
      logPath: `${artifacts}/playwright.log`,
    },
  );
  process.stdout.write(`${output}\n`);

  const migrations = Number(
    composePsql(
      databaseName,
      'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL',
      true,
    ),
  );
  const resultMatch = output.match(/V2_E2E_RESULT=(\{[^\n]+\})/);
  if (!resultMatch) throw new Error('V2 E2E result marker was not produced');
  const result = {
    ...JSON.parse(resultMatch[1]),
    migrations,
    runCommand: 'pnpm test:v2-e2e',
  };
  writeFileSync(
    `${artifacts}/result.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(`V2_E2E_FINAL=${JSON.stringify(result)}`);
} finally {
  await stopServices();
  if (databaseCreated) {
    composePsql(
      'postgres',
      `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
    );
  }
}
