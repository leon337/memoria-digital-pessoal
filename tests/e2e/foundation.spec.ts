import { expect, test } from '@playwright/test';

test('web uses healthy local persistence while API and PostgreSQL readiness remain independently observable', async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:3000/health/ready')).status())
    .toBe(200);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeVisible();
  await expect(page.getByText('Armazenamento local pronto')).toBeVisible();

  const ready = await request.get('http://127.0.0.1:3000/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});
