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
  await dlg.locator('.cat-parent').selectOption('ledger');
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
  await row.locator('.cat-role').selectOption('database');
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
  // Türü olmayan eski öğelere açılışta yerlerine göre tür yazılır (kök → sistem, yaprak → bileşen)
  expect(mmd.text()).toMatch(/%% @itemdef ledger-db \{"name":"Ledger","kind":"component","role":"database","parent":"ledger"\}/);
  expect(mmd.text()).toMatch(/%% @itemdef payments \{"name":"Ödeme sistemi","kind":"system","role":"external"\}/);
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

test.describe('eşleşenleri bağla', () => {
  const MORE = CATALOG.concat([{ id: 'orders', name: 'Sipariş sistemi', role: 'external' }, { id: 'order-api', name: 'Order', role: 'service', parent: 'orders' }]);

  test('denetim eşleşmeyi bildirir: tek adayda "Bağla", birden çok adayda "Seç…"', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant D@{ "type": "database" } as Ledger DB\nparticipant L as Ledger\nL->>D: x\n'))], current: 'd1', catalog: CATALOG });
    const page = await openApp(context);
    await page.locator('#lintBadge').click();
    const rows = page.locator('.lint-panel .dd-row');
    await expect(rows.filter({ hasText: 'Ledger DB' })).toContainText('Ödeme sistemi › Ledger Service › Ledger DB');
    await rows.filter({ hasText: 'Ledger DB' }).locator('.dd-fix', { hasText: 'Bağla' }).click();
    await expect.poll(() => getCode(page)).toMatch(/%% @item ledger-db\n\s*%% @role database\n[\s\S]*as Ledger DB/);

    // "Ledger": hem servis hem veritabanı öğesinin adı; DB artık bağlı olduğundan tek aday kalır.
    // Liste açık kalır ve denetim yeniden çalışınca güncellenir
    await expect(page.locator('.lint-panel')).toBeVisible();
    const l = page.locator('.lint-panel .dd-row', { hasText: 'eşleşiyor' });
    await expect(l).toHaveCount(1);
    await expect(l).toContainText('Ödeme sistemi › Ledger Service');
    await l.locator('.dd-fix').click();
    await expect.poll(() => getCode(page)).toMatch(/%% @item ledger\n\s*%% @role service\n[\s\S]*participant L as Ledger Service/);
  });

  test('belirsiz eşleşmede seçici yalnızca adayları seçtirir', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant L as Ledger\nL->>L: x\n'))], current: 'd1', catalog: CATALOG });
    const page = await openApp(context);
    await page.locator('#lintBadge').click();
    await expect(page.locator('.lint-panel .dd-row')).toContainText('2 öğeyle eşleşiyor');
    await page.locator('.lint-panel .dd-fix', { hasText: 'Seç…' }).click();
    const picker = page.locator('.catalog-picker');
    await expect(picker.locator('.cp-item')).toHaveCount(3); // aday olmayan ata bağlam için görünür
    await expect(picker.locator('.cp-item[disabled]')).toHaveText([/Ödeme sistemi/]);
    await picker.locator('.cp-item', { hasText: 'Ledger DB' }).click();
    await expect.poll(() => getCode(page)).toMatch(/%% @item ledger-db\n[\s\S]*participant L@\{ "type": "database" \} as Ledger DB/);
  });

  test('toplu bağlama: kesin eşleşmeler seçili gelir, belirsizler seçilince bağlanır; tüm diyagramlara yazılır', async ({ context }) => {
    await seed(context, {
      docs: [
        doc('d1', 'Aktif', seq('participant D@{ "type": "database" } as Ledger DB\nparticipant X as Bilinmeyen\nX->>D: x\n')),
        doc('d2', 'Diğer', seq('%% @role service\n%% @color #2fbf7f\nparticipant O as Order Service\nparticipant L as Ledger\nO->>L: y\n'), { updated: Date.now() - 1000 }),
      ],
      current: 'd1', catalog: MORE,
    });
    const page = await openApp(context);
    await page.locator('#palRoles .chip-edit').click();
    await page.locator('.lib-tabs [data-tab="catalog"]').click();
    await page.locator('.roles-foot .btn', { hasText: 'Eşleşenleri bağla' }).click();
    const rows = page.locator('.cm-row');
    await expect(rows).toHaveText([/Ledger DB.*Ledger DB.*aynı ad/, /Ledger.*2 aday/, /Order Service.*Order Service.*aynı ad/]);
    expect(await rows.locator('input[type=checkbox]').evaluateAll((cbs) => cbs.map((c) => c.checked))).toEqual([true, false, true]);
    await rows.nth(1).locator('select').selectOption('ledger');
    await page.locator('.cat-match .btn.primary', { hasText: 'Bağla (3)' }).click();
    await expect(page.locator('.toast').last()).toContainText('3 katılımcı');
    await expect.poll(() => getCode(page)).toMatch(/%% @item ledger-db\n/);
    await expect.poll(() => docCode(page, 'd2')).toMatch(/%% @item order-api\n[\s\S]*%% @item ledger\n[\s\S]*participant L as Ledger Service/);
    // Ağaç görünümüne dönülür; bekleyen eşleşme kalmadığı için düğme pasif
    await expect(page.locator('.roles-foot .btn', { hasText: 'Eşleşenleri bağla' })).toBeDisabled();
  });

  test('mimari ekranı bağlı olmayan eşleşmeleri bildirir ve toplu bağlamayı açar', async ({ context }) => {
    await seed(context, {
      docs: [doc('d1', 'A', seq('%% @item order-api\n%% @role service\nparticipant O as Order Service\nparticipant D@{ "type": "database" } as Ledger DB\nO->>D: oku\n'))],
      current: 'd1', catalog: MORE, settings: { screen: 'arch' },
    });
    const page = await openApp(context);
    await expect(page.locator('#archInfo')).toContainText('1 mesaj sayılmadı');
    await page.locator('#archInfo .link-btn', { hasText: '1 eşleşeni bağla' }).click();
    await expect(page.locator('.cm-row')).toHaveCount(1);
    await page.locator('.cat-match .btn.primary').click();
    await page.locator('.modal [data-close]').click();
    await expect(page.locator('#archInfo')).not.toContainText('sayılmadı');
    await expect(page.locator('#archCanvas .edgeLabel', { hasText: 'oku' })).toHaveCount(1);
  });
});

test.describe('C4 türleri', () => {
  const KCAT = [
    { id: 'co', name: 'Şirketim', kind: 'group' },
    { id: 'pay', name: 'Ödeme', role: 'external', kind: 'system', parent: 'co' },
    { id: 'ledger', name: 'Ledger', role: 'service', kind: 'container', parent: 'pay' },
    { id: 'api', name: 'Ledger API', role: 'service', kind: 'component', parent: 'pay' }, // yanlış: sistemde bileşen
    { id: 'orders', name: 'Sipariş', role: 'external', kind: 'system', parent: 'co' },
  ];

  test('ağaçta tür seçilir; grup çizilmez ve rolsüzdür; yanlış yerleşim uyarılır ve düzeltilince kalkar', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: KCAT });
    const page = await openApp(context);
    await openLibrary(page, 'catalog');
    await expect(page.locator('.cat-row[data-id="co"] .cat-norole')).toBeVisible();
    await expect(page.locator('.cat-row[data-id="co"] .cat-kind')).toHaveValue('group');
    await expect(page.locator('.cat-row.warn')).toHaveCount(1);
    await expect(page.locator('.cat-row[data-id="api"] .cat-warn')).toContainText('konteynerin içinde');
    // Bileşeni Ledger konteynerinin altına taşı → uyarı kalkar
    await page.locator('.cat-row[data-id="api"] .handle').dragTo(page.locator('.cat-row[data-id="ledger"]'));
    await expect(page.locator('.cat-row.warn')).toHaveCount(0);
    // Ledger'ı sisteme çevir → sistemin içinde sistem olamaz: uyarı
    await page.locator('.cat-row[data-id="ledger"] .cat-kind').selectOption('system');
    await expect(page.locator('.cat-row[data-id="ledger"] .cat-warn')).toContainText('en üstte');
    await expect.poll(async () => (await idbDump(page)).kv.catalog.find((x) => x.id === 'ledger').kind).toBe('system');
  });

  test('seçicide gruplar başlık olarak görünür ama seçilemez', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: KCAT });
    const page = await openApp(context);
    await page.locator('#palRoles .cat-open').click();
    await expect(page.locator('.catalog-picker .cp-item[data-id="co"]')).toBeDisabled();
    await expect(page.locator('.catalog-picker .cp-item[data-id="ledger"]')).toContainText('Konteyner');
  });

  test('kaydederken tür üst öğeye göre önerilir; uyumsuz seçim uyarılır', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant Q as Kuyruk\nQ->>Q: x\n'))], current: 'd1', catalog: KCAT });
    const page = await openApp(context);
    await page.locator('.pcard', { hasText: 'Kuyruk' }).click();
    await page.locator('#popover .rp-edit', { hasText: 'Kataloğa kaydet' }).click();
    const dlg = page.locator('.cat-save');
    const kind = dlg.locator('.cat-kind');
    await expect(kind).toHaveValue('system');
    await dlg.locator('.cat-parent').selectOption('pay');
    await expect(kind).toHaveValue('container');
    await dlg.locator('.cat-parent').selectOption('ledger');
    await expect(kind).toHaveValue('component');
    await kind.selectOption('system');
    await expect(dlg.locator('.cat-warn')).toContainText('en üstte');
    await kind.selectOption('component');
    await expect(dlg.locator('.cat-warn')).toHaveText('');
    await dlg.locator('.btn.primary').click();
    await expect.poll(async () => (await idbDump(page)).kv.catalog.find((x) => x.name === 'Kuyruk')).toMatchObject({ kind: 'component', parent: 'ledger' });
  });

  test('türü olmayan eski katalog açılışta yerine göre türlenir', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: CATALOG });
    const page = await openApp(context);
    await expect.poll(async () => (await idbDump(page)).kv.catalog.map((x) => x.id + ':' + x.kind)).toEqual(['payments:system', 'ledger:container', 'ledger-db:component']);
  });
});

test('rol isteğe bağlı: rolsüz öğenin görünümü türden gelir; tür değişince diyagramlara yansır; alan sırası tür → ad → rol', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: [{ id: 'billing', name: 'Billing', kind: 'system' }] });
  const page = await openApp(context);
  await page.locator('#palRoles .cat-open').click();
  await page.locator('.catalog-picker .cp-item', { hasText: 'Billing' }).click();
  await expect.poll(() => getCode(page)).toMatch(/%% @item billing\n\s*%% @color #3a8dde\n\s*participant Billing\n/);
  expect(await getCode(page)).not.toContain('@role');

  await openLibrary(page, 'catalog');
  const row = page.locator('.cat-row[data-id="billing"]');
  // Satırda sıra: tür, ad, rol
  expect(await row.evaluate((r) => [...r.children].map((c) => c.className.split(' ')[0] || c.tagName))).toEqual(
    ['handle', 'role-icon', 'select', 'cat-name', 'select', 'input', 'cat-usage', 'cat-actions']);
  await expect(row.locator('.cat-role')).toHaveValue('');
  await row.locator('.cat-kind').selectOption('person');
  await expect.poll(() => getCode(page)).toMatch(/%% @item billing\n\s*%% @color #6c7cff\n\s*actor Billing\n/);
  // Rol seçilince görünüm rolden gelir
  await row.locator('.cat-role').selectOption('database');
  await expect.poll(() => getCode(page)).toMatch(/%% @item billing\n\s*%% @role database\n\s*%% @color #f97a3c\n\s*participant Billing@\{ "type": "database" \} as Billing DB/);
  // Rol kaldırılınca türün görünümüne döner
  await row.locator('.cat-role').selectOption('');
  await expect.poll(() => getCode(page)).toMatch(/%% @item billing\n\s*%% @color #6c7cff\n\s*actor Billing as Billing\n|%% @item billing\n\s*%% @color #6c7cff\n\s*actor Billing\n/);
});
