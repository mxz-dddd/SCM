import { spawnSync } from 'node:child_process';

const databaseName = 'scm_p5_readiness';
const restoreDatabaseName = 'scm_p5_restore_verify';
const jwtSecret = 'scm-p5-readiness-jwt-secret-at-least-32-characters';
const seedPassword = 'scm-p5-readiness-admin-password';
const postgresUser = process.env.POSTGRES_USER ?? 'scm';
const workerActorId = '10000000-0000-4000-8000-000000000099';
const workerControlToken =
  'scm-p5-readiness-worker-control-token-at-least-32-characters';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: options.environment ?? process.env,
    input: options.input,
    maxBuffer: 100 * 1024 * 1024,
    stdio: options.capture
      ? ['pipe', 'pipe', 'inherit']
      : options.input === undefined
        ? 'inherit'
        : ['pipe', 'ignore', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stdout.trim())
      process.stdout.write(`${result.stdout.trim()}\n`);
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}`,
    );
  }
  if (options.capture) {
    const output = result.stdout.trim();
    if (options.display && output) process.stdout.write(`${output}\n`);
    return output;
  }
  return '';
}

function composePsql(database, args, options = {}) {
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
      ...args,
    ],
    options,
  );
}

function databaseCommand(sql) {
  composePsql('postgres', ['-c', sql]);
}

function snapshot(database) {
  const result = composePsql(
    database,
    [
      '-At',
      '-c',
      `SELECT json_build_object(
        'migrations', (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL),
        'usageMetrics', (SELECT count(*) FROM platform.ops_usage_metric),
        'replayedEvents', (SELECT count(*) FROM platform.outbox WHERE event_name = 'platform.readiness-probe.v1' AND status = 'PENDING'),
        'pickConfirmations', (SELECT count(*) FROM wms.pick_confirmation)
      )::text`,
    ],
    { capture: true },
  );
  return JSON.parse(result);
}

let created = false;
try {
  const published = run('docker', ['compose', 'port', 'postgres', '5432'], {
    capture: true,
  });
  const port = published.match(/:(\d+)$/)?.[1];
  if (!port)
    throw new Error(`Cannot determine PostgreSQL port from ${published}`);

  databaseCommand(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  databaseCommand(
    `DROP DATABASE IF EXISTS ${restoreDatabaseName} WITH (FORCE)`,
  );
  databaseCommand(`CREATE DATABASE ${databaseName}`);
  created = true;

  const user = encodeURIComponent(postgresUser);
  const password = encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? 'scm-local-only',
  );
  const environment = {
    ...process.env,
    DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/${databaseName}`,
    JWT_SECRET: jwtSecret,
    SEED_ADMIN_PASSWORD: seedPassword,
    WORKER_ACTOR_ID: workerActorId,
    WORKER_CONTROL_TOKEN: workerControlToken,
  };

  run('pnpm', ['audit', '--prod', '--audit-level', 'high']);
  run('pnpm', ['--dir', 'apps/api', 'exec', 'prisma', 'migrate', 'deploy'], {
    environment,
  });
  run('pnpm', ['--filter', '@scm/api', 'db:seed'], { environment });
  const playwrightOutput = run(
    'pnpm',
    ['exec', 'playwright', 'test', 'apps/api/e2e/p5.readiness.spec.ts'],
    { capture: true, display: true, environment },
  );
  const metricsMatch = playwrightOutput.match(
    /P5_READINESS_METRICS=(\{[^\n]+\})/,
  );
  if (!metricsMatch)
    throw new Error('Playwright did not report readiness metrics');
  const performance = JSON.parse(metricsMatch[1]);

  const source = snapshot(databaseName);
  const dump = run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      postgresUser,
      '-d',
      databaseName,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
    ],
    { capture: true },
  );
  const restoreStartedAt = Date.now();
  databaseCommand(`CREATE DATABASE ${restoreDatabaseName}`);
  composePsql(restoreDatabaseName, [], { input: dump });
  const restored = snapshot(restoreDatabaseName);
  const restoreSeconds = Number(
    ((Date.now() - restoreStartedAt) / 1_000).toFixed(2),
  );
  if (JSON.stringify(source) !== JSON.stringify(restored))
    throw new Error(
      `Recovery mismatch: source=${JSON.stringify(source)} restored=${JSON.stringify(restored)}`,
    );
  if (restoreSeconds >= 3_600)
    throw new Error(`Recovery exceeded the 60 minute RTO: ${restoreSeconds}s`);

  console.log(
    `P5_READINESS_RESULT=${JSON.stringify({
      crossTenantGate: 'PASSED',
      eventReplayGate: 'PASSED',
      performance,
      recovery: {
        achievedRpoMinutes: 0,
        achievedRtoSeconds: restoreSeconds,
        restored,
      },
      security: { highOrCriticalProductionAdvisories: 0 },
    })}`,
  );
} finally {
  if (created) {
    databaseCommand(
      `DROP DATABASE IF EXISTS ${restoreDatabaseName} WITH (FORCE)`,
    );
    databaseCommand(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  }
}
