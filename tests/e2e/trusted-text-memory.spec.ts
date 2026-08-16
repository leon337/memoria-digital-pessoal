import { expect, test } from '@playwright/test';

test('stores and retrieves a trusted text memory with provenance and UNKNOWN fallback', async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:3000/health/ready')).status())
    .toBe(200);

  await page.goto('/');
  await expect(page.getByRole('status', { name: '' }).first()).toHaveText('API pronta');

  await page.getByLabel('O que você quer guardar?').fill('Minha irmã se chama Ana.');
  await page.getByRole('button', { name: 'Guardar lembrança' }).click();
  await expect(page.getByText('Lembrança guardada.')).toBeVisible();

  const query = page.getByLabel('Palavra ou frase');
  await query.fill('Ana');
  await page.getByRole('button', { name: 'Consultar lembranças' }).click();
  await expect(page.getByText('Minha irmã se chama Ana.')).toBeVisible();
  await expect(page.getByText(/Fonte registrada · memória .* · evidência/)).toBeVisible();

  await query.fill('termo-sintético-inexistente-918273');
  await page.getByRole('button', { name: 'Consultar lembranças' }).click();
  await expect(page.getByText('Não encontrei uma lembrança com essas palavras.')).toBeVisible();
  await expect(page.getByText('Minha irmã se chama Ana.')).not.toBeVisible();
});
