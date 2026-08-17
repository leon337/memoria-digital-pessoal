import { expect, test } from '@playwright/test';

test('corrects text, preserves history and restores an old version by appending a correction', async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => (await request.get('http://127.0.0.1:3000/health/ready')).status())
    .toBe(200);

  await page.goto('/');
  await expect(page.getByLabel('Ambiente de laboratório')).toContainText(
    'Use somente dados sintéticos',
  );

  await page.getByRole('textbox', { name: 'Lembrança' }).fill('Minha irmã sintética se chama Ana.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Lembrança guardada.')).toBeVisible();

  const query = page.getByRole('searchbox', { name: 'Palavra ou frase' });
  const submitQuery = page.getByRole('button', { name: 'Consultar' });

  await query.fill('Ana');
  await submitQuery.click();
  await expect(page.getByText('Minha irmã sintética se chama Ana.')).toBeVisible();

  await page.getByRole('button', { name: 'Corrigir' }).click();
  await page
    .getByRole('textbox', { name: 'Texto corrigido' })
    .fill('Minha irmã sintética se chama Beatriz.');
  await page.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(page.getByText('Minha irmã sintética se chama Beatriz.')).toBeVisible();

  await query.fill('Ana');
  await submitQuery.click();
  await expect(
    page.getByText('Não encontrei uma lembrança registrada que corresponda a essa busca.'),
  ).toBeVisible();

  await query.fill('Beatriz');
  await submitQuery.click();
  await expect(page.getByText('Minha irmã sintética se chama Beatriz.')).toBeVisible();

  await page.getByRole('button', { name: 'Ver histórico' }).click();
  const history = page.getByRole('region', { name: 'Histórico da lembrança' });
  await expect(history).toBeVisible();
  const versions = history.getByRole('listitem');
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText('Original');
  await expect(versions.nth(0)).toContainText('Minha irmã sintética se chama Ana.');
  await expect(versions.nth(1)).toContainText('Atual');
  await expect(versions.nth(1)).toContainText('Minha irmã sintética se chama Beatriz.');

  await versions.nth(0).getByRole('button', { name: 'Usar este texto como nova correção' }).click();
  await expect(page.getByRole('textbox', { name: 'Texto corrigido' })).toHaveValue(
    'Minha irmã sintética se chama Ana.',
  );
  await page.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(page.getByText('Minha irmã sintética se chama Ana.')).toBeVisible();

  await page.getByRole('button', { name: 'Ver histórico' }).click();
  const restoredHistory = page.getByRole('region', { name: 'Histórico da lembrança' });
  const restoredVersions = restoredHistory.getByRole('listitem');
  await expect(restoredVersions).toHaveCount(3);
  await expect(restoredVersions.nth(0)).toContainText('Minha irmã sintética se chama Ana.');
  await expect(restoredVersions.nth(1)).toContainText('Minha irmã sintética se chama Beatriz.');
  await expect(restoredVersions.nth(2)).toContainText('Minha irmã sintética se chama Ana.');
  await expect(restoredVersions.nth(2)).toContainText('Atual');
});
