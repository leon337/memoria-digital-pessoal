import { expect, test } from '@playwright/test';

test('web observes API and PostgreSQL readiness', async ({ page, request }) => {
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:3000/health/ready')).status())
    .toBe(200);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Memória Digital Pessoal' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API pronta');

  const ready = await request.get('http://127.0.0.1:3000/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});
