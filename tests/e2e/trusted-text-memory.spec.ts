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
  await expect(page.getByLabel('Ambiente de laboratório')).toContainText(
    'Use somente dados sintéticos',
  );

  await page.getByRole('textbox', { name: 'Lembrança' }).fill('Minha irmã se chama Ana.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Lembrança guardada.')).toBeVisible();

  const query = page.getByRole('searchbox', { name: 'Palavra ou frase' });
  await query.fill('Ana');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Minha irmã se chama Ana.')).toBeVisible();
  await expect(page.getByText('Fonte: lembrança guardada')).toBeVisible();

  await query.fill('termo-sintético-inexistente-918273');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(
    page.getByText('Não encontrei uma lembrança registrada que corresponda a essa busca.'),
  ).toBeVisible();
  await expect(page.getByText('Minha irmã se chama Ana.')).not.toBeVisible();
});
