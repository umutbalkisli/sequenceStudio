// Adım türleri kaydı ve klavye kısayolları tablosu.
import { test, expect, seed, openApp, getCode, doc, seq } from './helpers.mjs';

const twoParts = () => [
  doc('d1', 'Akış', seq('participant A\nparticipant B\nA->>B: bir\nB->>A: iki\n')),
  doc('d2', 'Hedef', seq('participant X\nX->>X: x\n')),
];
const stepCount = (page) => page.locator('#stepCount');
const lastOk = (page) => page.evaluate(() => window.Seq.core.S.lastOk);

test('paletteki her adım türü eklenebilir ve geçerli Mermaid üretir', async ({ context }) => {
  await seed(context, { docs: twoParts(), current: 'd1', settings: { palCompact: false } });
  const page = await openApp(context);
  const ids = await page.evaluate(() => window.Seq.steps.list().map((s) => s.id));
  expect(ids.length).toBeGreaterThan(10);
  await expect(page.locator('#palSteps .chip')).toHaveCount(ids.length);
  for (let i = 0; i < ids.length; i++) {
    await page.keyboard.press('Escape');
    await page.locator('#palSteps .chip').nth(i).click();
    await expect(stepCount(page)).toHaveText(String(2 + i + 1));
  }
  const code = await getCode(page);
  expect(code).toContain('loop');
  expect(code).toContain('@ref d2');
  expect(code).toContain('activate A');
  await expect.poll(() => lastOk(page)).toBe(true);
});

test('kısayollar: sil, geri al, yinele, çoğalt, taşı, görünüm, seçimi bırak', async ({ context }) => {
  await seed(context, { docs: twoParts(), current: 'd1' });
  const page = await openApp(context);
  const rows = page.locator('#flow .step-message');
  const select = (i) => rows.nth(i).locator('.handle').click();
  await expect(rows).toHaveCount(2);

  await select(1);
  await expect(rows.nth(1)).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(2);

  await select(0);
  await page.keyboard.press('ControlOrMeta+d');
  await expect(rows).toHaveCount(3);

  await select(2);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => (await getCode(page)).trim().split('\n').slice(-3).map((l) => l.trim())).toEqual(['A->>B: bir', 'B->>A: iki', 'A->>B: bir']);

  await page.keyboard.press('Escape');
  await expect(page.locator('#flow .selected')).toHaveCount(0);
  // Seçim yokken Delete hiçbir şey silmez
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(3);

  await page.keyboard.press('ControlOrMeta+2');
  await expect(page.locator('#code')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page.locator('#flow')).toBeVisible();
});
