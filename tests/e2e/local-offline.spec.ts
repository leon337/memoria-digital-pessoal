import { expect, test, type Page } from '@playwright/test';

async function waitLocalReady(page: Page): Promise<void> {
  await expect(page.getByText('Armazenamento local pronto')).toBeVisible();
}

async function signalOffline(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
}

async function primeServiceWorker(page: Page): Promise<void> {
  await page.goto('/');
  await waitLocalReady(page);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker unavailable');
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await waitLocalReady(page);
  }
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

async function createMemory(page: Page, text: string): Promise<void> {
  await page.getByLabel('Lembrança', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Lembrança guardada.')).toBeVisible();
}

async function queryMemory(page: Page, query: string, answer: string): Promise<void> {
  await page.getByLabel('Palavra ou frase', { exact: true }).fill(query);
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
}

async function seedVersionOneDatabase(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mdp-local', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('memories', { keyPath: 'id' });
        db.createObjectStore('evidence', { keyPath: 'id' });
        db.createObjectStore('ledgerEvents', { keyPath: 'id' });
        db.createObjectStore('facts', { keyPath: 'id' });
        db.createObjectStore('currentFacts', { keyPath: 'factId' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(
          ['memories', 'evidence', 'ledgerEvents', 'facts', 'currentFacts'],
          'readwrite',
        );
        const recordedAt = new Date('2026-08-17T07:00:00.000Z');
        tx.objectStore('memories').add({
          id: 'm-v1',
          recordedAt,
          occurredAt: null,
          temporalPrecision: 'unknown',
        });
        tx.objectStore('evidence').add({
          id: 'e-v1',
          memoryId: 'm-v1',
          kind: 'text',
          content: 'Memória sintética migrada da versão um.',
          createdAt: recordedAt,
        });
        tx.objectStore('ledgerEvents').add({
          id: 'ev-v1',
          memoryId: 'm-v1',
          evidenceId: 'e-v1',
          type: 'MEMORY_CREATED',
          createdAt: recordedAt,
        });
        tx.objectStore('facts').add({
          id: 'f-v1',
          memoryId: 'm-v1',
          evidenceId: 'e-v1',
          kind: 'autobiographical_statement',
          content: 'Memória sintética migrada da versão um.',
          createdAt: recordedAt,
        });
        tx.objectStore('currentFacts').add({
          factId: 'f-v1',
          memoryId: 'm-v1',
          evidenceId: 'e-v1',
          content: 'Memória sintética migrada da versão um.',
          recordedAt,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  });
}

test('reopens offline and completes create/query/correct/history/restore without API traffic', async ({
  context,
  page,
}) => {
  const forbiddenRequests: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (url.includes(':3000') || /\/(memories|query)(\/|\?|$)/.test(new URL(url).pathname)) {
      forbiddenRequests.push(url);
    }
  });

  await primeServiceWorker(page);
  await createMemory(page, 'Minha irmã se chama Ana.');

  await context.setOffline(true);
  await page.close();
  const offlinePage = await context.newPage();
  await offlinePage.goto('/');
  await waitLocalReady(offlinePage);
  await signalOffline(offlinePage);

  await queryMemory(offlinePage, 'Ana', 'Minha irmã se chama Ana.');
  await offlinePage.getByRole('button', { name: 'Corrigir' }).click();
  await offlinePage
    .getByLabel('Texto corrigido', { exact: true })
    .fill('Minha irmã se chama Beatriz.');
  await offlinePage.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(offlinePage.getByText('Correção salva.', { exact: true })).toBeVisible();

  await offlinePage.getByLabel('Palavra ou frase', { exact: true }).fill('Ana');
  await offlinePage.getByRole('button', { name: 'Consultar' }).click();
  await expect(
    offlinePage.getByText('Não encontrei uma lembrança registrada que corresponda a essa busca.'),
  ).toBeVisible();

  await queryMemory(offlinePage, 'Beatriz', 'Minha irmã se chama Beatriz.');
  await offlinePage.getByRole('button', { name: 'Ver histórico' }).click();
  let versions = offlinePage
    .getByRole('region', { name: 'Histórico da lembrança' })
    .getByRole('listitem');
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText('Original');
  await expect(versions.nth(1)).toContainText('Atual');

  await versions.nth(0).getByRole('button', { name: 'Usar este texto como nova correção' }).click();
  await offlinePage.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(offlinePage.getByText('Correção salva.', { exact: true })).toBeVisible();
  await expect(offlinePage.locator('p.recorded-memory')).toHaveText('Minha irmã se chama Ana.');

  await offlinePage.getByRole('button', { name: 'Ver histórico' }).click();
  versions = offlinePage
    .getByRole('region', { name: 'Histórico da lembrança' })
    .getByRole('listitem');
  await expect(versions).toHaveCount(3);

  await offlinePage.reload();
  await waitLocalReady(offlinePage);
  await signalOffline(offlinePage);
  await queryMemory(offlinePage, 'Ana', 'Minha irmã se chama Ana.');
  await offlinePage.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(
    offlinePage.getByRole('region', { name: 'Histórico da lembrança' }).getByRole('listitem'),
  ).toHaveCount(3);

  expect(forbiddenRequests).toEqual([]);
});

test('same-base corrections across two tabs yield one success and one stale rejection', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await waitLocalReady(page);
  await createMemory(page, 'Base concorrente sintética.');
  await queryMemory(page, 'Base concorrente', 'Base concorrente sintética.');

  const second = await context.newPage();
  await second.goto('/');
  await waitLocalReady(second);
  await queryMemory(second, 'Base concorrente', 'Base concorrente sintética.');

  await page.getByRole('button', { name: 'Corrigir' }).click();
  await second.getByRole('button', { name: 'Corrigir' }).click();
  await page.getByLabel('Texto corrigido', { exact: true }).fill('Correção concorrente A.');
  await second.getByLabel('Texto corrigido', { exact: true }).fill('Correção concorrente B.');

  await page.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(page.getByText('Correção salva.', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(second.getByRole('alert')).toContainText('A lembrança mudou');
});

test('local storage failure never reports a successful memory write', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    IDBObjectStore.prototype.add = function () {
      throw new DOMException('synthetic quota failure', 'QuotaExceededError');
    };
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await waitLocalReady(page);

  await page.getByLabel('Lembrança', { exact: true }).fill('Registro sintético que deve falhar.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('alert')).toContainText('armazenamento local');
  await expect(page.getByText('Lembrança guardada.', { exact: true })).toHaveCount(0);

  await page.getByLabel('Palavra ou frase', { exact: true }).fill('deve falhar');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(
    page.getByText('Não encontrei uma lembrança registrada que corresponda a essa busca.'),
  ).toBeVisible();
  await context.close();
});

test('browser upgrades seeded v1 data to v2 without loss and remains writable', async ({
  page,
}) => {
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await seedVersionOneDatabase(page);
  await page.unroute('**/assets/*.js');
  await page.reload();
  await waitLocalReady(page);

  const schema = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mdp-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {
      version: db.version,
      evidenceMemoryIndex: db
        .transaction('evidence')
        .objectStore('evidence')
        .indexNames.contains('memoryId'),
      predecessorUnique: db.transaction('facts').objectStore('facts').index('supersedesFactId')
        .unique,
    };
    db.close();
    return result;
  });
  expect(schema).toEqual({ version: 2, evidenceMemoryIndex: true, predecessorUnique: true });

  await queryMemory(page, 'migrada', 'Memória sintética migrada da versão um.');
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(
    page.getByRole('region', { name: 'Histórico da lembrança' }).getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Ocultar histórico' }).click();
  await page.getByRole('button', { name: 'Corrigir' }).click();
  await page
    .getByLabel('Texto corrigido', { exact: true })
    .fill('Memória sintética migrada e corrigida.');
  await page.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(page.getByText('Correção salva.', { exact: true })).toBeVisible();
});

test('service worker update check and controlled reload preserve IndexedDB', async ({ page }) => {
  await primeServiceWorker(page);
  await createMemory(page, 'Memória sintética preservada após atualização.');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
  });
  await page.reload();
  await waitLocalReady(page);
  await queryMemory(page, 'após atualização', 'Memória sintética preservada após atualização.');
});
