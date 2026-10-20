// Mimari (C4) ekranı: ilişkilerin diyagramlardan türetilmesi, içine girme / konum çubuğu, düğüm menüsünden
// akışa geçiş, kalıcı ekran ve odak, katalog değişince yeniden çizim, dışa aktarma ve boş katalog.
import { test, expect, seed, openApp, download, doc, seq } from './helpers.mjs';

const CATALOG = [
  { id: 'customer', name: 'Müşteri', role: 'user' },
  { id: 'pay', name: 'Ödeme sistemi', role: 'external' },
  { id: 'ledger', name: 'Ledger', role: 'service', parent: 'pay' },
  { id: 'ledger-db', name: 'Ledger', role: 'database', parent: 'ledger' },
  { id: 'gw', name: 'Ödeme', role: 'gateway', parent: 'pay' },
  { id: 'orders', name: 'Sipariş sistemi', role: 'external' },
  { id: 'order-api', name: 'Order', role: 'service', parent: 'orders' },
];
const part = (id, item, role, label) => `%% @item ${item}\n%% @role ${role}\nparticipant ${id} as ${label}\n`;
const DOCS = () => [
  doc('a', 'Sipariş akışı', seq(part('C', 'customer', 'user', 'Müşteri') + part('O', 'order-api', 'service', 'Order Service') + part('G', 'gw', 'gateway', 'Ödeme Gateway')
    + part('L', 'ledger', 'service', 'Ledger Service') + part('D', 'ledger-db', 'database', 'Ledger DB')
    + 'participant X\nC->>O: sipariş ver\nO->>G: öde\nG->>L: kaydet\nL->>D: insert\nD-->>L: ok\nO->>X: bilinmeyen\n')),
];
const nodes = (page) => page.locator('#archCanvas .arch-node').evaluateAll((els) => els.map((e) => e.dataset.item).sort());
const edgeLabels = (page) => page.locator('#archCanvas .edgeLabel').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean).sort());

test('C1 → C2 → C3: ilişkiler diyagramlardan türetilir; konum çubuğuyla geri dönülür', async ({ context }) => {
  await seed(context, { docs: DOCS(), current: 'a', catalog: CATALOG });
  const page = await openApp(context);
  await page.locator('#screenSeg [data-screen="arch"]').click();
  await expect(page.locator('#archScreen')).toBeVisible();
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('.arch-level')).toHaveText(/C1/);
  await expect.poll(() => nodes(page)).toEqual(['customer', 'orders', 'pay']);
  await expect.poll(() => edgeLabels(page)).toEqual(['sipariş ver', 'öde']);
  await expect(page.locator('#archInfo')).toContainText('2 ilişki');
  await expect(page.locator('#archInfo')).toContainText('1 mesaj sayılmadı');

  await page.locator('.arch-node[data-item="pay"]').click();
  await page.locator('.dropdown .dd-item', { hasText: 'İçine gir' }).click();
  await expect(page.locator('.arch-level')).toHaveText(/C2/);
  await expect.poll(() => nodes(page)).toEqual(['gw', 'ledger', 'orders']);
  await expect.poll(() => edgeLabels(page)).toEqual(['kaydet', 'öde']);

  await page.locator('.arch-node[data-item="ledger"]').click();
  await page.locator('.dropdown .dd-item', { hasText: 'İçine gir' }).click();
  await expect(page.locator('.arch-level')).toHaveText(/C3/);
  // Mesajlar konteynerin kendisine gidiyor (bileşenine değil): C3'te yalnızca bileşenler görünür
  await expect.poll(() => nodes(page)).toEqual(['ledger-db']);
  await expect(page.locator('#archCrumbs .crumb')).toHaveText(['Tüm sistemler', 'Ödeme sistemi', 'Ledger Service']);

  // Ekran ve odak yeniden açılışta korunur
  await page.reload();
  await expect(page.locator('.arch-level')).toHaveText(/C3/);
  await page.locator('#archCrumbs .crumb', { hasText: 'Tüm sistemler' }).click();
  await expect(page.locator('.arch-level')).toHaveText(/C1/);
});

test('düğüm menüsünden diyagram açılınca akış ekranına geçilir ve katılımcı gösterilir', async ({ context }) => {
  await seed(context, { docs: DOCS().concat([doc('b', 'Boş', seq('participant Z\nZ->>Z: z\n'))]), current: 'b', catalog: CATALOG, settings: { screen: 'arch' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['customer', 'orders', 'pay']);
  await page.locator('.arch-node[data-item="pay"]').click();
  await page.locator('.dropdown .dd-item', { hasText: 'Sipariş akışı' }).click();
  await expect(page.locator('#archScreen')).toBeHidden();
  await expect(page.locator('#docName')).toHaveValue('Sipariş akışı');
  await expect(page.locator('.pcard.flash')).toContainText('Ödeme Gateway'); // sistemin ilk bağlı katılımcısı
  await expect(page.locator('#screenSeg [data-screen="seq"]')).toHaveClass(/active/);
});

test('katalog değişince yeniden çizilir; dışa aktarma; boş katalogda yönlendirme', async ({ context }) => {
  await seed(context, { docs: DOCS(), current: 'a', catalog: CATALOG, settings: { screen: 'arch' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['customer', 'orders', 'pay']);
  await page.locator('#archEditCatalog').click();
  await page.locator('.cat-row[data-id="pay"] .cat-name .input').fill('Ödeme platformu');
  await page.locator('.modal [data-close]').click();
  await expect(page.locator('#archCanvas .arch-node[data-item="pay"]')).toContainText('Ödeme platformu');

  const mmd = await download(page, () => page.locator('#archExport [data-fmt="mmd"]').click());
  expect(mmd.name).toBe('mimari.mmd');
  expect(mmd.text()).toMatch(/^flowchart LR\n/);
  expect(mmd.text()).toContain('**Ödeme platformu**');
  const svg = await download(page, () => page.locator('#archExport [data-fmt="svg"]').click());
  expect(svg.text()).toContain('<svg');

  // ⌘Z gibi akış kısayolları mimari ekranında çalışmaz, ⌘K çalışır
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.search-root')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => { window.Seq.core.S.catalog = []; window.Seq.arch.render(); });
  await expect(page.locator('.arch-empty')).toContainText('katalogdan oluşur');
});
