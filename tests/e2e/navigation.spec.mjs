// Uygulama iskeleti: yönlendirme ve derin linkler, akışlar sayfası (kütüphane), ayarlar, ⌘K ile ekranlar arası
// gezinme, ekrana özgü kısayollar.
import { test, expect, seed, openApp, getCode, idbDump, doc, seq } from './helpers.mjs';

const FOLDERS = [{ id: 'f1', name: 'Ödeme' }, { id: 'f2', name: 'Raporlar', parent: 'f1' }];
const CAT = [{ id: 'pay', name: 'Ödeme sistemi', kind: 'system' }, { id: 'ledger', name: 'Ledger', kind: 'container', parent: 'pay' }];
const docs = () => [
  doc('a', 'Sepet', seq('participant A\nA->>A: x\n'), { updated: Date.now() - 3000 }),
  doc('b', 'Ödeme onayı', seq('%% @item ledger\nparticipant L as Ledger\nparticipant U\nU->>L: kaydet\n'), { folder: 'f1', updated: Date.now() - 2000 }),
  doc('c', 'Aylık rapor', seq('participant R\nR->>R: y\n'), { folder: 'f2', updated: Date.now() - 1000 }),
];
const rows = (page) => page.locator('.fp-table .fp-row:not(.fp-head) .fp-name b');

test.describe('yönlendirme', () => {
  test('açılışta son akış düzenleyicide; derin link akışı açar; geri düğmesi önceki ekrana döner; bilinmeyen akış listeye düşer', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a', folders: FOLDERS, catalog: CAT });
    const page = await openApp(context);
    await expect(page).toHaveURL(/#\/flows\/a$/);
    await expect(page.locator('#mainNav [data-nav="flows"]')).toHaveClass(/active/);
    await expect(page.locator('#palette')).toBeVisible();

    await page.goto(page.url().replace(/#.*$/, '#/flows/b'));
    await expect(page.locator('#docName')).toHaveValue('Ödeme onayı');
    // Akışlar sayfasından başka akış açılınca adres izler; geri düğmesi önce listeye, sonra önceki akışa döner
    await page.locator('#mainNav [data-nav="flows"]').click();
    await page.locator('.fp-row[data-id="a"]').click();
    await expect(page).toHaveURL(/#\/flows\/a$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/flows$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/flows\/b$/);
    await expect(page.locator('#docName')).toHaveValue('Ödeme onayı');

    await page.locator('#mainNav [data-nav="catalog"]').click();
    await expect(page.locator('#catalogScreen')).toBeVisible();
    await expect(page.locator('#palette')).toBeHidden();
    await expect(page.locator('#docName')).toBeHidden(); // düzenleyiciye özgü üst bar öğeleri gizli
    await page.goBack();
    await expect(page.locator('#docName')).toHaveValue('Ödeme onayı');

    await page.goto(page.url().replace(/#.*$/, '#/flows/yok'));
    await expect(page).toHaveURL(/#\/flows$/);
    await expect(page.locator('.toast.err').last()).toContainText('bulunamadı');
  });

  test('ekrana özgü kısayollar yalnızca düzenleyicide çalışır; ⌘K her yerden akışa ve katalog öğesine götürür', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a', folders: FOLDERS, catalog: CAT });
    const page = await openApp(context, { hash: '/catalog' });
    await page.keyboard.press('p'); // sunum: düzenleyiciye özgü
    await expect(page.locator('.pres-root')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.search-input').fill('ledger');
    await page.locator('.search-item[data-item="ledger"]').click();
    await expect(page).toHaveURL(/#\/catalog\/ledger$/);
    await expect(page.locator('.cp-title')).toContainText('Ledger');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.search-input').fill('aylık');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/flows\/c$/);
    await expect(page.locator('#docName')).toHaveValue('Aylık rapor');
  });
});

test.describe('akışlar sayfası', () => {
  test('liste, arama, klasör ve katalog öğesi süzgeçleri, sıralama; satıra tıklayınca düzenleyici açılır', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a', folders: FOLDERS, catalog: CAT });
    const page = await openApp(context, { hash: '/flows' });
    await expect(page.locator('#flowsSum')).toHaveText('3 akış · 2 klasör');
    await expect(rows(page)).toHaveText(['Aylık rapor', 'Ödeme onayı', 'Sepet']); // son güncellenen üstte
    await page.locator('.fp-th', { hasText: 'Ad' }).click();
    await expect(rows(page)).toHaveText(['Aylık rapor', 'Ödeme onayı', 'Sepet'].sort((x, y) => x.localeCompare(y, 'tr')));
    // Klasör: alt klasörleriyle
    await page.locator('.fp-folder[data-folder="f1"]').click();
    await expect(rows(page)).toHaveText(['Aylık rapor', 'Ödeme onayı']);
    await page.locator('.fp-folder[data-folder=""]').click();
    await expect(rows(page)).toHaveText(['Sepet']);
    await page.locator('.fp-folder[data-folder="*"]').click();
    // Katalog öğesi: sistemi seçmek içindekileri kullananları da getirir
    await page.locator('.fp-filters select').selectOption('pay');
    await expect(rows(page)).toHaveText(['Ödeme onayı']);
    await page.locator('.fp-filters select').selectOption('');
    await page.locator('.fp-filters .input').fill('rapor');
    await expect(rows(page)).toHaveText(['Aylık rapor']);
    await rows(page).first().click();
    await expect(page).toHaveURL(/#\/flows\/c$/);
    await expect(page.locator('#docName')).toHaveValue('Aylık rapor');
  });

  test('yeni akış seçili klasörde oluşur ve düzenleyicide açılır; çoğalt; toplu taşı ve sil', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a', folders: FOLDERS });
    const page = await openApp(context, { hash: '/flows' });
    await page.locator('.fp-folder[data-folder="f2"]').click();
    await page.locator('#flowsNew').click();
    await expect(page).toHaveURL(/#\/flows\/d[\w]+$/);
    await expect.poll(async () => (await idbDump(page)).docs.find((d) => d.name === 'Adsız diyagram')?.folder).toBe('f2');

    await page.locator('#mainNav [data-nav="flows"]').click();
    await page.locator('.fp-folder[data-folder="*"]').click();
    await page.locator('.fp-row', { hasText: 'Sepet' }).hover();
    await page.locator('.fp-row', { hasText: 'Sepet' }).locator('button[title="Kopyasını oluştur"]').click();
    await expect(rows(page)).toContainText(['Sepet (kopya)']);

    // Toplu: iki akışı Raporlar'a taşı, sonra sil
    await page.locator('.fp-row', { hasText: 'Sepet (kopya)' }).locator('input[type=checkbox]').check();
    await page.locator('.fp-row', { hasText: /^.*Sepet(?! \(kopya\)).*$/ }).first().locator('input[type=checkbox]').check();
    await expect(page.locator('.fp-bulk')).toContainText('2 akış seçili');
    await page.locator('.fp-bulk select').selectOption('f2');
    await expect.poll(async () => (await idbDump(page)).docs.filter((d) => d.folder === 'f2').length).toBe(4);
    await page.locator('.fp-folder[data-folder="f2"]').click();
    await page.locator('.fp-head input[type=checkbox]').check();
    page.once('dialog', (d) => d.accept());
    await page.locator('.fp-bulk .btn.danger').click();
    await expect(rows(page)).toHaveCount(0);
    await expect.poll(async () => (await idbDump(page)).docs.map((d) => d.name).sort()).toEqual(['Ödeme onayı']);
  });

  test('klasör oluşturulur, yeniden adlandırılır, silinir; akış klasöre sürüklenir', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a', folders: FOLDERS });
    const page = await openApp(context, { hash: '/flows' });
    await page.locator('.fp-side-actions .btn', { hasText: 'Klasör' }).click();
    const inp = page.locator('.fp-rename');
    await expect(inp).toBeFocused();
    await inp.fill('Arşiv');
    await inp.press('Enter');
    await expect(page.locator('.fp-folder', { hasText: 'Arşiv' })).toBeVisible();
    const arsiv = await page.locator('.fp-folder', { hasText: 'Arşiv' }).getAttribute('data-folder');
    await expect(page.locator(`.fp-folder[data-folder="${arsiv}"]`)).toHaveClass(/active/); // yeni klasör seçili
    await page.locator('.fp-folder[data-folder="*"]').click();
    await page.locator('.fp-row', { hasText: 'Sepet' }).dragTo(page.locator(`.fp-folder[data-folder="${arsiv}"]`));
    await expect.poll(async () => (await idbDump(page)).docs.find((d) => d.id === 'a').folder).toBe(arsiv);
    await page.locator(`.fp-folder[data-folder="${arsiv}"]`).click();
    await page.locator('.fp-side-actions .btn', { hasText: 'Yeniden adlandır' }).click();
    await page.locator('.fp-rename').fill('Eski');
    await page.locator('.fp-rename').press('Enter');
    await expect(page.locator('.fp-folder', { hasText: 'Eski' })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.locator('.fp-side-actions .btn', { hasText: 'Klasörü sil' }).click();
    await expect(page.locator('.fp-folder', { hasText: 'Eski' })).toHaveCount(0);
    await expect.poll(async () => (await idbDump(page)).docs.find((d) => d.id === 'a').folder).toBeUndefined();
  });

  test('alt klasör, akış ve klasör sürükle-bırak, döngü engeli; dolu klasör silinince içerik bir üst düzeye çıkar', async ({ context }) => {
    await seed(context, {
      docs: [doc('d1', 'Kart ile ödeme', seq('A->>B: x\n'), { folder: 'fa' }), doc('d2', '3DS doğrulama', seq('A->>B: y\n')), doc('d3', 'Sipariş iptali', seq('A->>B: z\n'), { folder: 'fb' })],
      folders: [{ id: 'fa', name: 'Ödeme' }, { id: 'fb', name: 'Sipariş' }],
      current: 'd1',
    });
    const page = await openApp(context, { hash: '/flows' });
    page.on('dialog', (d) => d.accept());
    const folder = (name) => page.locator('.fp-folder', { has: page.locator('.fp-fname', { hasText: new RegExp('^' + name + '$') }) });
    const state = async () => {
      const { docs, kv } = await idbDump(page);
      const fname = (id) => kv.folders.find((f) => f.id === id)?.name;
      return { folders: kv.folders.map((f) => f.name + (f.parent ? '<' + fname(f.parent) : '')).sort(), docs: Object.fromEntries(docs.map((d) => [d.name, fname(d.folder) || 'kök'])) };
    };
    await folder('Ödeme').click();
    await page.locator('.fp-side-actions .btn', { hasText: 'Alt klasör' }).click();
    await page.locator('.fp-rename').fill('Kart');
    await page.locator('.fp-rename').press('Enter');
    await page.locator('.fp-folder[data-folder="*"]').click();
    await page.locator('.fp-row', { hasText: '3DS' }).dragTo(folder('Kart'));
    await folder('Sipariş').dragTo(folder('Kart'));
    await folder('Ödeme').dragTo(folder('Sipariş')); // döngü: reddedilmeli
    await expect.poll(state).toEqual({ folders: ['Kart<Ödeme', 'Sipariş<Kart', 'Ödeme'], docs: { 'Kart ile ödeme': 'Ödeme', '3DS doğrulama': 'Kart', 'Sipariş iptali': 'Sipariş' } });
    await expect(folder('Ödeme').locator('small')).toHaveText('3');

    await folder('Kart').click();
    await page.locator('.fp-side-actions .btn', { hasText: 'Klasörü sil' }).click();
    await expect.poll(state).toEqual({ folders: ['Sipariş<Ödeme', 'Ödeme'], docs: { 'Kart ile ödeme': 'Ödeme', '3DS doğrulama': 'Ödeme', 'Sipariş iptali': 'Sipariş' } });
    // Klasör "Tüm akışlar"a bırakılınca köke çıkar
    await folder('Sipariş').dragTo(page.locator('.fp-folder[data-folder="*"]'));
    await expect.poll(state).toEqual({ folders: ['Sipariş', 'Ödeme'], docs: { 'Kart ile ödeme': 'Ödeme', '3DS doğrulama': 'Ödeme', 'Sipariş iptali': 'Sipariş' } });
  });

  test('düzenleyicide akışın klasör yolu gösterilir; klasöre tıklayınca Akışlar o klasörde açılır', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'c', folders: FOLDERS });
    const page = await openApp(context);
    await expect(page.locator('#docName')).toHaveValue('Aylık rapor');
    const crumbs = page.locator('#docCrumbs .crumb');
    await expect(crumbs).toHaveText(['Ödeme', 'Raporlar']);
    await expect(page.locator('#btnDocs')).toHaveCount(0); // eski çekmece yok
    // Dar üst barda yalnızca akışın kendi klasörü görünür; ipucu tam yolu verir
    await expect(crumbs.last()).toHaveAttribute('title', '"Ödeme / Raporlar" klasöründeki akışlar');
    await crumbs.last().click();
    await expect(page).toHaveURL(/#\/flows\?folder=f2$/);
    await expect(page.locator('.fp-folder[data-folder="f2"]')).toHaveClass(/active/);
    await expect(rows(page)).toHaveText(['Aylık rapor']);
    await page.goto(page.url().replace(/#.*$/, '#/flows?folder=f1'));
    await expect(rows(page)).toHaveText(['Aylık rapor', 'Ödeme onayı']); // alt klasörleriyle
    // Klasörsüz akışta yol boş; klasör değişince yol güncellenir
    await page.locator('.fp-folder[data-folder="*"]').click();
    await page.locator('.fp-row[data-id="a"]').click();
    await expect(page.locator('#docCrumbs')).toBeHidden();
    await page.evaluate(() => window.Seq.folders.moveDoc('a', 'f2'));
    await expect(crumbs).toHaveText(['Ödeme', 'Raporlar']);
  });
});

test.describe('ayarlar', () => {
  test('çalışma alanı ve kişisel bölümler: dil değişince sayfa ve gezinme yenilenir; tema seçilir; roller ve veri', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'a' });
    const page = await openApp(context, { hash: '/settings' });
    await expect(page.locator('.set-main h2')).toHaveText('Genel'); // çalışma alanının genel bölümü
    await expect(page.locator('.set-group').first()).toHaveText('Çalışma alanı · Yerel çalışma alanı');
    await page.locator('.set-nav a[data-section="general"]').click();
    await expect(page.locator('.set-main h2')).toHaveText('Tercihler');
    await page.locator('#setTheme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#setLang').selectOption('en');
    await expect(page.locator('.set-main h2')).toHaveText('Preferences');
    await expect(page.locator('#mainNav [data-nav="catalog"]')).toHaveText('Catalog');
    await page.locator('.set-nav a[data-section="roles"]').click();
    await expect(page).toHaveURL(/#\/settings\/roles$/);
    await expect(page.locator('.role-row:not(.role-head)')).toHaveCount(7);
    await page.locator('.set-nav a[data-section="data"]').click();
    await expect(page.locator('.set-main .backup-box .bk-actions .btn').first()).toBeVisible();
    expect(await getCode(page)).toContain('A->>A: x'); // düzenleyici durumu korunur
  });
});
