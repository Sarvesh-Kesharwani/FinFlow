#!/usr/bin/env node

const baseUrl = (process.env.HEALTHCHECK_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const checks = [
  { path: '/', expected: [200], note: 'App shell' },
  { path: '/api/auth/session', expected: [200], note: 'Auth session endpoint' },
  { path: '/api/auth/providers', expected: [200], note: 'Auth providers endpoint' },
  { path: '/api/finance/state', expected: [200], note: 'Local finance state API' },
  { path: '/api/drive/sync', expected: [200, 401], note: 'Signed-in dependent sync API' },
];

function expectedLabel(expected) {
  return expected.join(' or ');
}

async function run() {
  const failures = [];
  const rows = [];

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json, text/html;q=0.9,*/*;q=0.8' },
      });
      const elapsedMs = Date.now() - startedAt;
      const ok = check.expected.includes(res.status);

      rows.push({
        route: check.path,
        status: res.status,
        expected: expectedLabel(check.expected),
        ms: elapsedMs,
        note: check.note,
        result: ok ? 'PASS' : 'FAIL',
      });

      if (!ok) {
        failures.push(`${check.path} returned ${res.status} (expected ${expectedLabel(check.expected)})`);
      }
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      rows.push({
        route: check.path,
        status: 'ERR',
        expected: expectedLabel(check.expected),
        ms: elapsedMs,
        note: check.note,
        result: 'FAIL',
      });
      failures.push(`${check.path} request failed (${reason})`);
    }
  }

  console.table(rows);

  if (failures.length > 0) {
    console.error('\nPost-build health check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nPost-build health check passed.');
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
