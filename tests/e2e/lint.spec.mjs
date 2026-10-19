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
  const items = page.locator('.lint-panel .lp-item');
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
  await page.locator('.lint-panel .lp-item', { hasText: 'Kullanılmayan' }).click();
  const selected = await page.locator('#code').evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(selected).toContain('participant C as Kullanılmayan');

  // Düzeltince bulgular kaybolur
  await page.locator('#code').fill(seq('participant A\nparticipant B\nA->>B: istek\nB-->>A: yanıt\n'));
  await expect(badge).toBeHidden();
});
