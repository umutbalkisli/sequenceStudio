// Diyagram denetimi: rozet, sorun listesi, oluşturucu işaretleri ve sorunlu adıma gitme.
import { test, expect, seed, openApp, setView, doc, seq } from './helpers.mjs';

const code = seq([
  'participant A as İstemci', 'participant B as Servis', 'participant C as Kullanılmayan',
  'A->>B: istek',
  'alt başarılı', 'B-->>A: ok', 'else hata', 'end',
  'A->>B: unutulan',
  '%% @ref gone', 'Note over B: Silinmiş',
].join('\n'));

test('rozet ve liste bulguları gösterir; tıklayınca adım seçilir; düzeltince kaybolur', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Denetim', code)], current: 'd1' });
  const page = await openApp(context);
  const badge = page.locator('#lintBadge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/lv-error/);
  await expect(badge).toHaveText('4');

  // Oluşturucu işaretleri: kopuk bağlantı (hata), yanıtsız çağrı, boş kol, kullanılmayan katılımcı (uyarı)
  await expect(page.locator('#flow .lint-flag.lint-error')).toHaveCount(1);
  await expect(page.locator('#flow .lint-flag.lint-warning')).toHaveCount(2);
  await expect(page.locator('#participants .pcard.lint-flag')).toHaveCount(1);

  await badge.click();
  const items = page.locator('.lint-panel .dd-item');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('silinmiş');
  await items.nth(1).click(); // yanıtsız çağrı
  await expect(page.locator('#flow .step.selected .text-input')).toHaveValue('unutulan');

  // Escape önce listeyi kapatır, seçim kalır
  await page.keyboard.press('Escape');
  await expect(page.locator('.lint-panel')).toHaveCount(0);
  await expect(page.locator('#flow .step.selected')).toHaveCount(1);

  // Kod görünümünde listeden tıklama ilgili satırı seçer
  await setView(page, 'code');
  await badge.click();
  await page.locator('.lint-panel .dd-item', { hasText: 'Kullanılmayan' }).click();
  const selected = await page.locator('#code').evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(selected).toContain('participant C as Kullanılmayan');

  // Düzeltince bulgular kaybolur
  await page.locator('#code').fill(seq('participant A\nparticipant B\nA->>B: istek\nB-->>A: yanıt\n'));
  await expect(badge).toBeHidden();
});

test('geri bağlantılar: rozet yalnızca bağlanan varsa görünür; listeden açılır, not seçilir, geri dönülür', async ({ context }) => {
  const linkTo = (id, label) => `%% @ref ${id}\nNote over A: ${label}\n`;
  await seed(context, {
    docs: [
      doc('t', 'Ödeme', seq('participant P\nP->>P: öde\n')),
      doc('a', 'Sepet', seq('participant A\nA->>A: x\n' + linkTo('t', 'Ödeme') + 'A->>A: y\n' + linkTo('t', 'Ödeme tekrar'))),
      doc('b', 'Checkout', seq('participant A\n' + linkTo('t', 'Ödeme'))),
      doc('c', 'Bağımsız', seq('participant A\nA->>A: z\n')),
    ],
    current: 't',
  });
  const page = await openApp(context);
  const btn = page.locator('#btnBacklinks');
  await expect(btn).toHaveText('2');
  await btn.click();
  const items = page.locator('.dropdown .bl-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Checkout');
  await expect(items.nth(1)).toContainText('Sepet');
  await expect(items.nth(1)).toContainText('2 bağlantı');

  await items.nth(1).click();
  await expect(page.locator('#docName')).toHaveValue('Sepet');
  await expect(page.locator('.dropdown')).toHaveCount(0);
  await expect(page.locator('#flow .step.selected')).toHaveClass(/step-ref/);
  await expect(btn).toBeHidden(); // Sepet'e kimse bağlanmıyor
  await page.click('#navBack');
  await expect(page.locator('#docName')).toHaveValue('Ödeme');
  await expect(btn).toHaveText('2');
});
