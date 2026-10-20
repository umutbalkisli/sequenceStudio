// Sunum modu: adım adım oynatma, perde, alt yazı, seçili mesajdan başlama, otomatik oynatma ve
// sunum açıkken uygulama kısayollarının devre dışı kalması.
import { test, expect, seed, openApp, getCode, setCode, setView, doc, seq } from './helpers.mjs';

const CODE = seq('participant A as İstemci\nparticipant B as Servis\nA->>B: bir\nB-->>A: iki\nNote over A: düşün\nA->>B: üç\n');
const counter = (page) => page.locator('.pres-counter');
const caption = (page) => page.locator('.pres-caption');
/** Perdenin üst kenarı ve o anki adımın alt kenarı (SVG koordinatları) */
const geometry = (page) => page.evaluate(() => {
  const c = document.querySelector('.pres-curtain');
  const cur = document.querySelector('.pres-paper .pres-current');
  return { cut: +c.getAttribute('y'), shown: c.style.display !== 'none', hide: c.classList.contains('hide'), cur: cur ? cur.getBBox().y + cur.getBBox().height : null };
});

test('adım adım ilerler: perde o anki adımın altını örter, alt yazı mesajı okur, sonda kalkar', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Akış', CODE)], current: 'd1' });
  const page = await openApp(context);
  await page.locator('#btnPresent').click();
  await expect(page.locator('.pres-root')).toBeVisible();
  await expect(counter(page)).toHaveText('0 / 4');
  await expect(caption(page)).toContainText('başlamak için');
  expect((await geometry(page)).shown).toBe(true);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(counter(page)).toHaveText('2 / 4');
  await expect(caption(page)).toHaveText('Servis → İstemci: iki');
  const g = await geometry(page);
  expect(g.cut).toBeGreaterThan(g.cur);

  await page.keyboard.press('ArrowRight');
  await expect(caption(page)).toHaveText('Not · İstemci: düşün');
  await page.keyboard.press('End');
  await expect(counter(page)).toHaveText('4 / 4');
  expect((await geometry(page)).shown).toBe(false);
  await page.keyboard.press('ArrowLeft');
  await expect(counter(page)).toHaveText('3 / 4');
  // Tıklama da ilerletir
  await page.locator('.pres-stage').click();
  await expect(counter(page)).toHaveText('4 / 4');

  // Sonrası gizli: perde tam örter
  await page.keyboard.press('Home');
  await page.locator('.pres-bar select').nth(1).selectOption('hide');
  expect((await geometry(page)).hide).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('.pres-root')).toHaveCount(0);
});

test('seçili mesajdan başlar (P kısayolu); sunum açıkken uygulama kısayolları çalışmaz', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Akış', CODE)], current: 'd1' });
  const page = await openApp(context);
  const before = await getCode(page);
  await page.locator('#flow .step-message').nth(1).locator('.handle').click();
  await page.keyboard.press('p');
  await expect(counter(page)).toHaveText('2 / 4');
  // Backspace/Delete adımı silmez, yalnızca sunumda geri gider
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expect(counter(page)).toHaveText('1 / 4');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pres-root')).toHaveCount(0);
  expect(await getCode(page)).toBe(before);
  await expect(page.locator('#flow .step.selected')).toHaveCount(1); // seçim korunur
});

test('otomatik oynatma seçilen hızda ilerler ve sonda durur', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Akış', CODE)], current: 'd1' });
  const page = await openApp(context);
  await page.locator('#btnPresent').click();
  await page.locator('.pres-speed').selectOption('1500');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(counter(page)).toHaveText('3 / 4');
  await page.locator('.pres-play').click(); // hemen bir adım ilerler
  await expect(counter(page)).toHaveText('4 / 4');
  await expect(page.locator('.pres-play')).not.toHaveClass(/\bon\b/); // sona gelince durdu
  // Baştan oynat: sondayken başa döner
  await page.keyboard.press('p');
  await expect(counter(page)).toHaveText('1 / 4');
  await expect(counter(page)).toHaveText('2 / 4', { timeout: 4000 });
  await page.keyboard.press('p');
  await expect(page.locator('.pres-play')).not.toHaveClass(/\bon\b/);
});

test('hatalı diyagram sunulmaz', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Akış', CODE)], current: 'd1' });
  const page = await openApp(context);
  await setView(page, 'code');
  await setCode(page, seq('A->>B: x\nend\nend\nloop\n'));
  await expect(page.locator('#renderError')).toBeVisible();
  await page.locator('#btnPresent').click();
  await expect(page.locator('.toast.err').last()).toContainText('hata');
  await expect(page.locator('.pres-root')).toHaveCount(0);
});
