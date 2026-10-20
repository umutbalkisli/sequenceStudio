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

test('kenara tıklayınca ilişkinin geçtiği akışlar mesajlarıyla listelenir; seçilen akışta mesaj gösterilir', async ({ context }) => {
  const docs = DOCS().concat([doc('b', 'Bakiye', seq(part('O', 'order-api', 'service', 'Order Service') + part('L', 'ledger', 'service', 'Ledger Service')
    + 'O->>O: hazırla\nO->>L: bakiye sorgula\nL-->>O: bakiye\n'))]);
  await seed(context, { docs, current: 'a', catalog: CATALOG, settings: { screen: 'arch' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['customer', 'orders', 'pay']);

  // Sipariş sistemi → Ödeme sistemi: iki akışta geçer (etikete tıklanır)
  await page.locator('#archCanvas .edgeLabel.arch-edge', { hasText: 'öde' }).click();
  const items = page.locator('.arch-edge-menu .dd-item');
  await expect(page.locator('.arch-edge-menu .dd-head')).toContainText('Sipariş sistemi → Ödeme sistemi');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Bakiye');
  await expect(items.nth(0)).toContainText('bakiye sorgula');
  await expect(items.nth(1)).toContainText('Sipariş akışı');
  await items.nth(0).click();
  await expect(page.locator('#archScreen')).toBeHidden();
  await expect(page.locator('#docName')).toHaveValue('Bakiye');
  await expect(page.locator('#flow .step.selected .text-input')).toHaveValue('bakiye sorgula'); // "hazırla" değil, ilişkinin mesajı

  // Çizginin kendisine (görünmez geniş alan) tıklamak da çalışır
  await page.locator('#screenSeg [data-screen="arch"]').click();
  // Eğrinin sınır kutusunun ortası çizginin üstünde olmayabilir: yolun orta noktasına tıklanır
  const pt = await page.locator('#archCanvas .arch-edge-hit[data-edge="customer>orders"]').evaluate((p) => {
    const m = p.getPointAtLength(p.getTotalLength() / 3);
    const q = p.ownerSVGElement.createSVGPoint(); q.x = m.x; q.y = m.y;
    const s = q.matrixTransform(p.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('.arch-edge-menu .dd-item')).toHaveText([/Sipariş akışı[\s\S]*sipariş ver/]);
});

test('tek kök grup kullanan katalogda C1 grubun içindeki sistemleri gösterir; konum çubuğunda grup yok', async ({ context }) => {
  const cat = [
    { id: 'co', name: 'Şirketim', kind: 'group' },
    { id: 'orders', name: 'Sipariş sistemi', role: 'external', kind: 'system', parent: 'co' },
    { id: 'order-api', name: 'Order', role: 'service', kind: 'container', parent: 'orders' },
    { id: 'pay', name: 'Ödeme sistemi', role: 'external', kind: 'system', parent: 'co' },
    { id: 'gw', name: 'Ödeme', role: 'gateway', kind: 'container', parent: 'pay' },
  ];
  const code = seq(part('O', 'order-api', 'service', 'Order Service') + part('G', 'gw', 'gateway', 'Ödeme Gateway') + 'O->>G: öde\n');
  await seed(context, { docs: [doc('a', 'Akış', code)], current: 'a', catalog: cat, settings: { screen: 'arch' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['orders', 'pay']);
  await page.locator('.arch-node[data-item="pay"]').click();
  await page.locator('.dropdown .dd-item', { hasText: 'İçine gir' }).click();
  await expect(page.locator('#archCrumbs .crumb')).toHaveText(['Tüm sistemler', 'Ödeme sistemi']);
  await expect.poll(() => nodes(page)).toEqual(['gw', 'orders']);
});

test('yakınlaştırma: çubuk, ⌘/Ctrl + tekerlek, klavye, sığdır; boş alandan sürükleyerek kaydırma', async ({ context }) => {
  await seed(context, { docs: DOCS(), current: 'a', catalog: CATALOG, settings: { screen: 'arch' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['customer', 'orders', 'pay']);
  const val = page.locator('#archZoomVal');
  const width = () => page.locator('#archCanvas svg').evaluate((s) => s.getBoundingClientRect().width);
  const fitText = await val.textContent();
  const w0 = await width();
  await page.locator('#archZoomIn').click();
  await expect(val).not.toHaveText(fitText);
  expect(await width()).toBeCloseTo(w0 * 1.2, 0);
  await val.click();
  await expect(val).toHaveText('100%');
  // Klavye
  await page.keyboard.press('+');
  await expect(val).toHaveText('120%');
  await page.keyboard.press('-');
  await expect(val).toHaveText('100%');
  await page.keyboard.press('0');
  await expect(val).toHaveText(fitText);
  // ⌘/Ctrl + tekerlek
  await page.locator('#archCanvas').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(async () => parseInt(await val.textContent(), 10)).toBeGreaterThan(parseInt(fitText, 10));
  // Büyütünce kaydırılabilir; boş alandan sürükleme kaydırır
  for (let i = 0; i < 4; i++) await page.locator('#archZoomIn').click();
  const box = await page.locator('#archCanvas').boundingBox();
  const scroll = () => page.locator('#archCanvas').evaluate((c) => [c.scrollLeft, c.scrollTop]);
  const before = await scroll();
  await page.mouse.move(box.x + 8, box.y + box.height - 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 8 + 120, box.y + box.height - 8 - 80, { steps: 5 });
  await page.mouse.up();
  const after = await scroll();
  expect(after[0] + after[1]).not.toBe(before[0] + before[1]);
  // Yeni düzeye geçince görünüme yeniden sığdırılır
  await page.locator('.arch-node[data-item="pay"]').click();
  await page.locator('.dropdown .dd-item', { hasText: 'İçine gir' }).click();
  await expect.poll(async () => parseInt(await val.textContent(), 10)).toBeLessThanOrEqual(125);
});

test('draw.io dışa aktarma: sınır kapsayıcı, iç düğümler onun içinde, oklar düğümlere bağlı', async ({ context }) => {
  await seed(context, { docs: DOCS(), current: 'a', catalog: CATALOG, settings: { screen: 'arch', archFocus: 'pay' } });
  const page = await openApp(context);
  await expect.poll(() => nodes(page)).toEqual(['gw', 'ledger', 'orders']);
  const file = await download(page, () => page.locator('#archExport [data-fmt="drawio"]').click());
  expect(file.name).toBe('mimari - Ödeme sistemi.drawio');
  const xml = file.text();
  expect(xml).toMatch(/<diagram name="Ödeme sistemi"/);
  expect(xml).toMatch(/<mxCell id="focus" value="&lt;b&gt;Ödeme sistemi&lt;\/b&gt; \[Sistem\]"[^>]*container=1;/);
  const cells = [...xml.matchAll(/<mxCell id="(n\d+)" value="&lt;b&gt;([^&]+)&lt;\/b&gt;[^"]*" style="([^"]*)" vertex="1" parent="(\w+)"><mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g)]
    .map((m) => ({ id: m[1], name: m[2], style: m[3], parent: m[4], x: +m[5], y: +m[6], w: +m[7], h: +m[8] }));
  const by = Object.fromEntries(cells.map((c) => [c.name, c]));
  expect(by['Ödeme Gateway'].parent).toBe('focus');
  expect(by['Ledger Service'].parent).toBe('focus');
  expect(by['Sipariş sistemi'].parent).toBe('1');
  expect(by['Sipariş sistemi'].style).toContain('dashed=1');
  const focus = /id="focus"[^>]*><mxGeometry x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(xml).slice(1).map(Number);
  // İç düğümler sınırın içine sığar (göreli konum)
  [by['Ödeme Gateway'], by['Ledger Service']].forEach((c) => {
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(focus[2] + 1);
    expect(c.y + c.h).toBeLessThanOrEqual(focus[3] + 1);
  });
  expect(xml).toContain(`source="${by['Sipariş sistemi'].id}" target="${by['Ödeme Gateway'].id}"`);
  expect(xml).toContain(`source="${by['Ödeme Gateway'].id}" target="${by['Ledger Service'].id}"`);
});
