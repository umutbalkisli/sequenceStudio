// Katılımcı kataloğu: C4 tarzı hiyerarşi (öğe → rol), kataloğa kaydetme, aranabilir seçici, değişikliklerin
// yayılması, sürükleyerek taşıma, tanımların dışarı taşınması/içe alınması ve rol silme koruması.
import { test, expect, seed, openApp, getCode, openExport, openDocFromDrawer, download, idbDump, doc, seq } from './helpers.mjs';

// Ödeme sistemi › Ledger servisi › Ledger DB (roller hazır setten)
const CATALOG = [
  { id: 'payments', name: 'Ödeme sistemi', role: 'external' },
  { id: 'ledger', name: 'Ledger', role: 'service', parent: 'payments', desc: 'Muhasebe kayıtları' },
  { id: 'ledger-db', name: 'Ledger', role: 'database', parent: 'ledger' },
];
const linked = (item, role, color, type, id, label) =>
  `%% @item ${item}\n%% @role ${role}\n%% @color ${color}\nparticipant ${id}${type ? `@{ "type": "${type}" }` : ''} as ${label}\n`;
const docCode = (page, id) => page.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('sequence-studio');
  r.onsuccess = () => { r.result.transaction('docs').objectStore('docs').get(id).onsuccess = (e) => res(e.target.result.code); };
}), id);
const openLibrary = async (page, tab) => {
  await page.locator('#palRoles .chip-edit').click();
  await page.locator(`.lib-tabs [data-tab="${tab}"]`).click();
};

test('katılımcı kataloğa kaydedilir: ad rol eklerinden arındırılır, üst öğe seçilir, yol gösterilir', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('participant P@{ "type": "database" } as Ledger DB\nP->>P: x\n'))], current: 'd1', catalog: CATALOG.slice(0, 2) });
  const page = await openApp(context);
  await page.locator('.pcard', { hasText: 'Ledger DB' }).click();
  await page.locator('#popover .rp-edit', { hasText: 'Kataloğa kaydet' }).click();
  const dlg = page.locator('.cat-save');
  await expect(dlg.locator('input').first()).toHaveValue('Ledger'); // "Veritabanı" rolünün " DB" eki çıkarıldı
  await expect(dlg.locator('.cs-preview')).toHaveText('Diyagramda: Ledger DB');
  await dlg.locator('select').nth(1).selectOption('ledger');
  await dlg.locator('.btn.primary').click();
  await expect.poll(() => getCode(page)).toMatch(/%% @item ledger-2\n\s*%% @role database\n\s*%% @color #[0-9a-f]{6}\n\s*participant P@\{ "type": "database" \} as Ledger DB/);
  await page.locator('.pcard', { hasText: 'Ledger DB' }).click();
  await expect(page.locator('#popover .cat-path')).toHaveText('Ödeme sistemi › Ledger Service › Ledger DB');
  // Rol öğeden gelir: rol çipleri yerine bilgi gösterilir
  await expect(page.locator('#popover .rp-chip', { hasText: 'Yok' })).toHaveCount(0);
});

test('paletteki seçici: arama atalarıyla gösterir; eklenen öğe ikinci kez eklenmez', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: CATALOG });
  const page = await openApp(context);
  await page.locator('#palRoles .cat-open').click();
  const picker = page.locator('.catalog-picker');
  await expect(picker.locator('.cp-item')).toHaveCount(3);
  await picker.locator('.cp-search').fill('db');
  await expect(picker.locator('.cp-item')).toHaveText([/Ödeme sistemi/, /Ledger Service/, /Ledger DB/]);
  await expect(picker.locator('.cp-item.dim')).toHaveCount(2); // eşleşmeyen atalar soluk
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect.poll(() => getCode(page)).toMatch(/%% @item ledger-db\n\s*%% @role database\n[\s\S]*as Ledger DB/);
  await expect(page.locator('.pcard')).toHaveCount(2);

  await page.locator('#palRoles .cat-open').click();
  await picker.locator('.cp-item', { hasText: 'Ledger DB' }).click();
  await expect(page.locator('.toast').last()).toContainText('zaten var');
  await expect(page.locator('.pcard')).toHaveCount(2);
});

test('öğe değişiklikleri yayılır: adı izleyenler güncellenir, özel ad korunur; rol değişince görünüm değişir', async ({ context }) => {
  await seed(context, {
    docs: [
      doc('d1', 'Aktif', seq(linked('ledger', 'service', '#2fbf7f', '', 'L', 'Ledger Service') + 'L->>L: x\n')),
      doc('d2', 'Diğer', seq(linked('ledger', 'service', '#2fbf7f', '', 'L', 'Muhasebe') + 'L->>L: x\n'), { updated: Date.now() - 1000 }),
    ],
    current: 'd1', catalog: CATALOG,
  });
  const page = await openApp(context);
  await openLibrary(page, 'catalog');
  const row = page.locator('.cat-row[data-id="ledger"]');
  await row.locator('.cat-name .input').fill('Defter');
  await expect.poll(() => getCode(page)).toContain('participant L as Defter Service');
  await row.locator('select').selectOption('database');
  await expect.poll(() => getCode(page)).toMatch(/%% @role database\n\s*%% @color #f97a3c\n\s*participant L@\{ "type": "database" \} as Defter DB/);
  await expect.poll(() => docCode(page, 'd2')).toMatch(/participant L@\{ "type": "database" \} as Muhasebe/);
});

test('ağaçta sürükleyerek taşınır; silinen öğenin alt öğeleri bir üst düzeye çıkar', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: CATALOG.concat([{ id: 'orders', name: 'Sipariş sistemi', role: 'external' }]) });
  const page = await openApp(context);
  await openLibrary(page, 'catalog');
  const ids = () => page.locator('.cat-row').evaluateAll((rows) => rows.map((r) => r.dataset.id + ':' + r.style.getPropertyValue('--depth')));
  await expect.poll(ids).toEqual(['payments:0', 'ledger:1', 'ledger-db:2', 'orders:0']);
  await page.locator('.cat-row[data-id="ledger-db"] .handle').dragTo(page.locator('.cat-row[data-id="orders"]'));
  await expect.poll(ids).toEqual(['payments:0', 'ledger:1', 'orders:0', 'ledger-db:1']);
  // "ledger"in altına alınan "payments" döngü olurdu: bırakma kabul edilmez
  await page.locator('.cat-row[data-id="payments"] .handle').dragTo(page.locator('.cat-row[data-id="ledger"]'));
  await expect.poll(ids).toEqual(['payments:0', 'ledger:1', 'orders:0', 'ledger-db:1']);

  page.once('dialog', (d) => d.accept());
  await page.locator('.cat-row[data-id="payments"] .del').click();
  await expect.poll(ids).toEqual(['ledger:0', 'orders:0', 'ledger-db:1']);
  await expect.poll(async () => (await idbDump(page)).kv.catalog.find((x) => x.id === 'ledger').parent).toBe(null);
});

test('kullanım listesinden diyagram açılır; öğeyi kullanan rol silinemez', async ({ context }) => {
  await seed(context, {
    docs: [doc('d1', 'Boş', seq('participant X\nX->>X: y\n')), doc('d2', 'Sipariş', seq(linked('ledger-db', 'database', '#f97a3c', 'database', 'D', 'Ledger DB') + 'D->>D: x\n'), { updated: Date.now() - 1000 })],
    current: 'd1', catalog: CATALOG,
  });
  const page = await openApp(context);
  await openLibrary(page, 'roles');
  await page.locator('.role-row:not(.role-head)').filter({ has: page.locator('.role-example', { hasText: 'Order DB' }) }).locator('.del').click();
  await expect(page.locator('.toast').last()).toContainText('katalog öğesi kullanıyor');
  await expect(page.locator('.role-row:not(.role-head)')).toHaveCount(7);

  await page.locator('.lib-tabs [data-tab="catalog"]').click();
  await page.locator('.cat-row[data-id="ledger-db"] button.cat-usage').click();
  await page.locator('.dropdown .dd-item', { hasText: 'Sipariş' }).click();
  await expect(page.locator('.modal-root')).toBeHidden();
  await expect(page.locator('#docName')).toHaveValue('Sipariş');
});

test('dışarı çıkan kod öğe, üst öğe ve rol tanımlarını taşır; boş profilde hiyerarşiyle içe alınır', async ({ context, browser }) => {
  const code = seq(linked('ledger-db', 'database', '#f97a3c', 'database', 'D', 'Ledger DB') + 'participant U\nU->>D: x\n');
  await seed(context, { docs: [doc('d1', 'Kayıt', code)], current: 'd1', catalog: CATALOG });
  const page = await openApp(context);
  await openExport(page, 'Mermaid');
  const mmd = await download(page, () => page.locator('.export-actions .btn.primary').click());
  expect(mmd.text()).toMatch(/%% @itemdef ledger-db \{"name":"Ledger","role":"database","parent":"ledger"\}/);
  expect(mmd.text()).toMatch(/%% @itemdef payments \{"name":"Ödeme sistemi","role":"external"\}/);
  expect(await getCode(page)).not.toContain('@itemdef'); // kayıtlı kod temiz kalır

  const fresh = await browser.newContext();
  await seed(fresh, {});
  const p2 = await openApp(fresh);
  await p2.setInputFiles('#fileInput', mmd.path);
  await expect(p2.locator('#notice')).toContainText('3 katalog öğesi');
  await p2.locator('#notice .btn.primary').click();
  await expect(p2.locator('#notice')).toBeHidden();
  expect(await getCode(p2)).not.toContain('@itemdef');
  await p2.locator('.pcard', { hasText: 'Ledger DB' }).click();
  await expect(p2.locator('#popover .cat-path')).toHaveText('Ödeme sistemi › Ledger Service › Ledger DB');
  await fresh.close();
});

test('aynı öğeye bağlı katılımcılar referans içine çizilince birleşir', async ({ context }) => {
  await seed(context, {
    docs: [
      doc('d1', 'Ana', seq(linked('ledger', 'service', '#2fbf7f', '', 'L', 'Ledger Service') + 'participant U\nU->>L: kaydet\n%% @ref d2\nNote over L: Detay\n')),
      doc('d2', 'Detay', seq(linked('ledger', 'service', '#2fbf7f', '', 'Svc', 'Defter') + 'participant DB\nSvc->>DB: insert\n')),
    ],
    current: 'd1', catalog: CATALOG,
  });
  const page = await openApp(context);
  await openExport(page, 'Mermaid');
  await page.locator('.opt-row .seg button', { hasText: 'İçine çiz' }).click();
  const text = await page.locator('.export-code').textContent();
  expect(text).toContain('L->>DB: insert'); // "Svc" ana diyagramdaki "L" ile eşleşti
  expect(text).not.toMatch(/participant Svc/);
});
