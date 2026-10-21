// Bulut hazırlığı (2): sekmeler arası değişiklik yayımı ve çakışma, sürüm yükseltmesinde eski sekme, yazma
// birleştirme, kişisel klasör görünümü, çalışma alanı kaydının üstverisi, yetki ayrıntıları.
import { test, expect, seed, openApp, setCode, getCode, idbDump, doc, seq } from './helpers.mjs';

const CATALOG = [{ id: 'pay', name: 'Ödeme sistemi', kind: 'system' }, { id: 'ledger', name: 'Ledger', kind: 'container', parent: 'pay' }];
const docs = () => [
  doc('d1', 'Sepet', seq('A->>B: ilk\n'), { updated: Date.now() - 1000 }),
  doc('d2', 'İade', seq('A->>B: iade\n'), { folder: 'f1', updated: Date.now() - 2000 }),
];
const FOLDERS = [{ id: 'f1', name: 'Ödeme' }];
const entity = async (page, key) => (await idbDump(page)).entities.find((e) => e.key === key);
const S = (page, expr) => page.evaluate((e) => new Function('S', 'return ' + e)(window.Seq.core.S), expr);

test('başka sekmedeki katalog, klasör, akış ve çalışma alanı değişiklikleri bu sekmeye yansır', async ({ context }) => {
  await seed(context, { docs: docs(), folders: FOLDERS, catalog: CATALOG, current: 'd1' });
  const a = await openApp(context);
  const b = await openApp(context, { hash: '/catalog/ledger' });
  await b.locator('.cp-detail .cp-name').fill('Defter');
  await expect.poll(() => S(a, "S.catalog.find((x) => x.id === 'ledger').name")).toBe('Defter');
  // Diğer akış ve klasör
  await b.evaluate(() => { const d = window.Seq.core.S.docs.find((x) => x.id === 'd2'); d.name = 'İade v2'; window.Seq.folders.renameFolder('f1', 'Ödemeler'); });
  await expect.poll(() => S(a, "S.docs.find((d) => d.id === 'd2').name")).toBe('İade v2');
  await expect.poll(() => S(a, "S.folders[0].name")).toBe('Ödemeler');
  await a.locator('#mainNav [data-nav="flows"]').click();
  await expect(a.locator('.fp-row[data-id="d2"]')).toContainText('İade v2');
  // Yeni akış ve silinen akış
  await b.evaluate(() => window.Seq.docs.deleteDoc('d2', { confirmed: true }));
  await expect(a.locator('.fp-row[data-id="d2"]')).toHaveCount(0);
  // Çalışma alanı adı
  await b.evaluate(() => window.Seq.workspace.rename('Ekip'));
  await expect(a.locator('#btnWorkspace')).toHaveText('Ekip');
  // Alan sekme kendi kaydında eski hâlin üstüne yazmaz: kendi değişikliği yeni revizyon olur
  await a.evaluate(() => { window.Seq.catalog.updateItem('pay', { desc: 'A sekmesinden' }); });
  await expect.poll(async () => (await entity(a, 'local|catalog|ledger')).data.name).toBe('Defter');
  await expect.poll(async () => (await entity(a, 'local|catalog|pay')).data.desc).toBe('A sekmesinden');
});

test('açık akış başka sekmede değişince: temizse güncellenir, kaydedilmemiş değişiklik varsa çakışma sorulur', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'd1', settings: { view: 'code' } });
  const a = await openApp(context);
  const b = await openApp(context);
  // Temiz: sessizce güncellenir
  await setCode(b, seq('A->>B: B yazdı\n'));
  await expect.poll(() => getCode(a)).toContain('B yazdı');
  await expect(a.locator('.toast').last()).toContainText('başka bir sekmede değiştirildi');

  // Kaydedilmemiş değişiklik: çakışma çubuğu; "Benimkini koru" yeni revizyon olarak yazar
  await a.evaluate(() => { document.querySelector('#code').value = 'sequenceDiagram\nA->>B: A yazıyor\n'; });
  await setCode(b, seq('A->>B: B yine yazdı\n'));
  const bar = a.locator('#syncNotice');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('çakışıyor');
  const revB = await (async () => { await b.evaluate(() => window.Seq.repo.flush()); return (await entity(b, 'local|doc|d1')).meta.rev; })();
  await bar.locator('button', { hasText: 'Benimkini koru' }).click();
  await expect(bar).toBeHidden();
  await expect.poll(async () => (await entity(a, 'local|doc|d1')).data.code).toContain('A yazıyor');
  expect((await entity(a, 'local|doc|d1')).meta.rev).toBeGreaterThan(revB);
  await expect.poll(() => getCode(b)).toContain('A yazıyor'); // diğer sekme de güncellenir

  // "Diğer sekmedekini yükle"
  await a.evaluate(() => { document.querySelector('#code').value = 'sequenceDiagram\nA->>B: atılacak\n'; });
  await setCode(b, seq('A->>B: kazanan\n'));
  await bar.locator('button', { hasText: 'Diğer sekmedekini yükle' }).click();
  await expect.poll(() => getCode(a)).toContain('kazanan');
  await expect(bar).toBeHidden();
});

test('veritabanı başka sekmede yükseltilince eski sekme bağlantıyı bırakır ve yenileme ister', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'd1' });
  const a = await openApp(context);
  const b = await context.newPage();
  await b.goto(a.url().replace(/#.*$/, ''));
  // Daha yeni bir sürüm: eski sekme bırakmazsa bu açılış hiç bitmezdi
  const version = await b.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('sequence-studio', 99);
    r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); };
    r.onerror = () => rej(r.error);
  }));
  expect(version).toBe(99);
  await expect(a.locator('#staleBanner')).toBeVisible();
  await expect(a.locator('#staleBanner')).toContainText('sayfayı yenile');
});

test('art arda yazılan ad tek revizyon olur; klasörün açık/kapalı durumu kişiseldir', async ({ context }) => {
  await seed(context, { docs: docs(), folders: [{ id: 'f1', name: 'Ödeme', collapsed: true }, { id: 'f2', name: 'Alt', parent: 'f1' }], catalog: CATALOG, current: 'd1' });
  const page = await openApp(context, { hash: '/catalog/ledger' });
  await page.evaluate(() => window.Seq.repo.flush());
  const before = (await entity(page, 'local|catalog|ledger')).meta.rev;
  await page.locator('.cp-detail .cp-name').fill('');
  await page.locator('.cp-detail .cp-name').pressSequentially('Muhasebe', { delay: 30 });
  await expect.poll(async () => (await entity(page, 'local|catalog|ledger')).data.name).toBe('Muhasebe');
  expect((await entity(page, 'local|catalog|ledger')).meta.rev).toBe(before + 1);

  // Eski kayıttaki "collapsed" kişisel ayara taşındı; klasör kaydında yok
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.settings')).foldersCollapsed)).toEqual(['f1']);
  await expect.poll(async () => (await idbDump(page)).kv.folders.map((f) => 'collapsed' in f)).toEqual([false, false]);
  await page.locator('#mainNav [data-nav="flows"]').click();
  await expect(page.locator('.fp-folder[data-folder="f2"]')).toHaveCount(0);
  await page.locator('.fp-folder[data-folder="f1"] .cp-caret').click();
  await expect(page.locator('.fp-folder[data-folder="f2"]')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.settings')).foldersCollapsed)).toEqual([]);
  const rev = (await entity(page, 'local|folder|f1')).meta.rev;
  await page.waitForTimeout(600);
  expect((await entity(page, 'local|folder|f1')).meta.rev).toBe(rev); // aç/kapa kayıt yazmaz
});

test('çalışma alanı kaydı revizyon taşır; sürümler çalışma alanına bağlıdır', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'd1' });
  const page = await openApp(context);
  const ws = async () => (await idbDump(page)).kv.workspaces[0];
  await expect.poll(async () => (await ws()).meta?.rev).toBeGreaterThan(0);
  const r0 = (await ws()).meta.rev;
  await page.evaluate(() => window.Seq.workspace.rename('Ekip'));
  const me = await page.evaluate(() => window.Seq.user.id());
  await expect.poll(async () => (await ws()).meta).toMatchObject({ rev: r0 + 1, updatedBy: me });
  await page.evaluate(() => window.Seq.repo.versions.add({ vid: 'v1', docId: 'd1', ts: Date.now(), code: 'x', name: 'n', kind: 'manual' }, 50));
  expect((await page.evaluate(() => window.Seq.repo.versions.list('d1')))[0]).toMatchObject({ vid: 'v1', ws: 'local' });
});

test('yetki: bilinmeyen rol en dar yetkidir (salt okunur)', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'd1', workspace: { kind: 'cloud', role: 'gizemli' } });
  const page = await openApp(context);
  await expect(page.locator('body')).toHaveClass(/readonly/);
});

test('yetki: düzenleyici içeriği değiştirir ama çalışma alanı ayarlarını değiştiremez', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'd1', workspace: { role: 'editor', name: 'Ekip' } });
  const page = await openApp(context);
  await expect(page.locator('body')).not.toHaveClass(/readonly/);
  await expect(page.locator('#optLegend')).toBeDisabled();
  await expect(page.locator('#mmTheme')).toBeDisabled();
  await expect(page.locator('label:has(#optLegend)')).toHaveAttribute('title', /yalnızca sahibi/);
  expect(await page.evaluate(() => { window.Seq.workspace.rename('Başka'); window.Seq.workspace.set('legend', false); return [window.Seq.core.S.workspace.name, window.Seq.workspace.get('legend')]; })).toEqual(['Ekip', true]);
  await expect(page.locator('.toast.err').last()).toContainText('yalnızca çalışma alanı sahibi');
  // İçerik düzenlenebilir
  await page.evaluate(() => window.Seq.layout.setView('code'));
  await setCode(page, seq('A->>B: editör\n'));
  await expect.poll(async () => (await entity(page, 'local|doc|d1')).data.code).toContain('editör');
  // Yedekten "Tümünü değiştir" kapalı
  await page.goto(page.url().replace(/#.*$/, '#/settings/data'));
  const file = test.info().outputPath('bk.json');
  const fs = await import('node:fs');
  fs.writeFileSync(file, JSON.stringify({ kind: 'sequence-studio-workspace', version: 1, docs: docs(), folders: [], roles: [], catalog: [] }));
  await page.locator('.set-main .backup-box input[type=file]').setInputFiles(file);
  await expect(page.locator('.restore-opt.danger')).toHaveClass(/disabled/);
  await expect(page.locator('.restore-opt.danger')).toContainText('yalnızca çalışma alanı sahibine');
});
