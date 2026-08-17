import { readFileSync, writeFileSync } from 'node:fs';

const baseUrl = 'http://127.0.0.1:3000';
const statePath = '/tmp/mdp-slice02-correction-outage.json';
const mode = process.argv[2];

if (mode === 'prepare') {
  const response = await fetch(`${baseUrl}/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Registro sintético base para correção de indisponibilidade.' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 201) {
    throw new Error(`prepare expected 201, received ${response.status}`);
  }
  const body = await response.json();
  if (!body?.memory?.id || !body?.fact?.id) {
    throw new Error('prepare response did not contain memory/fact identifiers');
  }
  writeFileSync(statePath, JSON.stringify({ memoryId: body.memory.id, factId: body.fact.id }));
  console.log('slice02 correction outage fixture prepared');
} else if (mode === 'verify') {
  const { memoryId, factId } = JSON.parse(readFileSync(statePath, 'utf8'));
  const submittedText = 'Texto sintético corrigido durante indisponibilidade.';
  const response = await fetch(`${baseUrl}/memories/${memoryId}/corrections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: submittedText, expectedCurrentFactId: factId }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (response.status !== 503) {
    throw new Error(`verify expected 503, received ${response.status}`);
  }
  const body = JSON.parse(raw);
  if (body?.error?.code !== 'SERVICE_UNAVAILABLE') {
    throw new Error('verify expected SERVICE_UNAVAILABLE');
  }
  if (raw.includes(submittedText) || /sql/i.test(raw)) {
    throw new Error('verify response leaked submitted text or SQL details');
  }
  console.log('slice02 correction outage=503 SERVICE_UNAVAILABLE safe-envelope');
} else {
  throw new Error('usage: node scripts/verify-slice02-correction-outage.mjs <prepare|verify>');
}
