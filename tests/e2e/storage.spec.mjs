// Depolama: IndexedDB'ye taşıma, kalıcılık, ani kapanış, yedekleme/geri yükleme, büyük veri, hatırlatma, yedek yol.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, seed, openApp, setCode, getCode, setView, idbDump, download, doc, seq, BLANK_URL } from './helpers.mjs';

const legacy = {
  'seqstudio.folders': [{ id: 'fa', name: 'Ödeme', collapsed: false }],
  'seqstudio.roles': [{ id: 'svc', name: 'Svc', type: 'participant', color: '#2fbf7f', prefix: '', suffix: ' Service' }],
  'seqstudio.docs': [
    doc('d1', 'Kart', seq('A->>B: kart\n'), { folder: 'fa', updated: Date.now() - 1000 }),
    doc('d2', 'İptal', seq('A->>B: iptal\n'), { updated: Date.now() - 2000 }),
    doc('d3', 'Kayıt', seq('A->>B: kayit\n'), { updated: Date.now() - 3000 }),
  ],
  'seqstudio.current': 'd2',
};
const tmpFile = (name, content) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-')), name); fs.writeFileSync(f, content); return f; };

test('eski localStorage verisi IndexedDB\'ye taşınır ve güvenlik kopyası kalır', async ({ context }) => {
  await seed(context, { legacy });
  const page = await openApp(context);
  const dump = await idbDump(page);
  expect(dump.docs.map((d) => d.name).sort()).toEqual(['Kart', 'Kayıt', 'İptal']);
  expect(dump.kv.folders[0].name).toBe('Ödeme');
  expect(dump.kv.roles.some((r) => r.id === 'svc')).toBe(true);
  const ls = await page.evaluate(() => ({ docs: localStorage.getItem('seqstudio.docs'), legacy: !!localStorage.getItem('seqstudio.legacy.docs'), flag: localStorage.getItem('seqstudio.storage') }));
  expect(ls).toEqual({ docs: null, legacy: true, flag: '"idb"' });
  await expect(page.locator('.toast').filter({ hasText: 'taşındı' })).toBeVisible();
  await expect(page.locator('#docName')).toHaveValue('İptal');
});

test('kayıtta yalnızca değişen diyagram yazılır ve yeniden açılışta durur', async ({ context }) => {
  await seed(context, { docs: legacy['seqstudio.docs'], folders: legacy['seqstudio.folders'], current: 'd2', settings: { view: 'code' } });
  const page = await openApp(context);
  const revBefore = async () => (await idbDump(page)).entities.find((e) => e.key === 'local|doc|d2').meta.rev;
  await page.evaluate(() => window.Seq.repo.flush());
  const before = await revBefore();
  await page.evaluate(() => { window.__puts = 0; const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'entities' && a[0].type === 'doc') window.__puts++; return put.apply(this, a); }; });
  await setCode(page, seq('A->>B: DEGISTI\n'));
  // Yazma kuyruğu asenkron: 1 olana kadar bekle, sonra bir süre daha 1'de kaldığını doğrula
  await expect.poll(() => page.evaluate(() => window.__puts)).toBe(1);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__puts)).toBe(1);
  await page.reload();
  await expect(page.locator('#code')).toHaveValue(/DEGISTI/);
  // Her kayıt üstveri taşır: değişen akışın revizyonu arttı, yazan bu tarayıcının kullanıcısı
  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.user')).id);
  const rec = (await idbDump(page)).entities.find((e) => e.key === 'local|doc|d2');
  expect(rec.meta).toMatchObject({ rev: before + 1, updatedBy: user });
  expect(rec.meta.updatedAt).toBeGreaterThan(rec.meta.createdAt);
});

test('kayıt beklemesi dolmadan kapatılsa da son değişiklik kaybolmaz', async ({ context }) => {
  await seed(context, { docs: legacy['seqstudio.docs'], current: 'd2', settings: { view: 'code' } });
  const page = await openApp(context);
  await page.evaluate(() => { const ta = document.querySelector('#code'); ta.value = 'sequenceDiagram\nA->>B: SON TUS\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.close({ runBeforeUnload: true });
  const again = await openApp(context);
  expect(await getCode(again)).toContain('SON TUS');
  expect(await again.evaluate(() => localStorage.getItem('seqstudio.rescue'))).toBeNull();
});

test('yedek alınır; birleştir ve değiştir doğru çalışır, geçersiz dosya reddedilir', async ({ context }) => {
  const catalog = [{ id: 'pay', name: 'Ödeme', role: 'svc' }, { id: 'ledger', name: 'Ledger', role: 'svc', parent: 'pay' }];
  await seed(context, { docs: legacy['seqstudio.docs'], folders: legacy['seqstudio.folders'], roles: legacy['seqstudio.roles'], catalog, current: 'd2' });
  const page = await openApp(context);
  page.on('dialog', (d) => d.accept());
  const box = '.set-main .backup-box';
  const toData = () => page.goto(page.url().replace(/#.*$/, '#/settings/data'));
  await toData();
  const dl = await download(page, () => page.locator(box + ' .btn', { hasText: 'Yedekle' }).click());
  const backup = JSON.parse(dl.text());
  expect(dl.name).toMatch(/^sequence-studio-yedek-\d{4}-\d{2}-\d{2}\.json$/);
  expect([backup.kind, backup.docs.length, backup.folders.length, backup.roles.length]).toEqual(['sequence-studio-workspace', 3, 1, 1]);
  // Eski katalog açılışta türlerle geçirilir
  expect(backup.catalog).toEqual([{ ...catalog[0], kind: 'system' }, { ...catalog[1], kind: 'component' }]);
  await expect(page.locator(box + ' .bk-status')).toContainText('Son yedek');

  // Birleştir: yeni diyagram eklenir; farklı içerikli aynı diyagram "(yedek)" kopyası olur
  const changed = structuredClone(backup);
  changed.docs.push(doc('d9', 'Yedekteki yeni', seq('X->>Y: yeni\n')));
  changed.docs.find((d) => d.id === 'd1').code = seq('A->>B: farkli\n');
  changed.catalog.push({ id: 'orders', name: 'Sipariş', role: 'svc' });
  await page.setInputFiles(box + ' input[type=file]', tmpFile('b.json', JSON.stringify(changed)));
  await page.locator('.restore-opt', { hasText: 'Birleştir' }).click();
  await expect(page.locator('.toast').last()).toContainText('1 diyagram eklendi, 1 kopya oluşturuldu');
  await expect.poll(async () => (await idbDump(page)).docs.map((d) => d.name).sort()).toEqual(['Kart', 'Kart (yedek)', 'Kayıt', 'Yedekteki yeni', 'İptal']);
  await expect.poll(async () => (await idbDump(page)).kv.catalog.map((x) => x.id)).toEqual(['pay', 'ledger', 'orders']);

  // Değiştir
  await page.setInputFiles(box + ' input[type=file]', dl.path);
  await page.locator('.restore-opt', { hasText: 'Tümünü değiştir' }).click();
  await expect.poll(async () => (await idbDump(page)).docs.map((d) => d.name).sort()).toEqual(['Kart', 'Kayıt', 'İptal']);
  await expect.poll(async () => (await idbDump(page)).kv.catalog.map((x) => x.id)).toEqual(['pay', 'ledger']);

  // Geçersiz dosya
  await page.setInputFiles(box + ' input[type=file]', tmpFile('x.json', '{"hello":1}'));
  await expect(page.locator('.toast.err').last()).toContainText('yedeği değil');
});

test('eski 5 MB sınırının üstündeki veri yüklenir ve kaydedilir', async ({ context }) => {
  const code = seq(('A->>B: ' + 'x'.repeat(200) + '\n').repeat(200));
  const docs = Array.from({ length: 160 }, (_, i) => doc('big' + i, 'Büyük ' + i, code, { updated: Date.now() - i }));
  await seed(context, { docs, current: 'big0', settings: { view: 'code' } });
  const page = await openApp(context);
  await page.locator('#mainNav [data-nav="flows"]').click();
  await expect(page.locator('.fp-row[data-id]')).toHaveCount(160);
  await page.goto(page.url().replace(/#.*$/, '#/settings/data'));
  await expect(page.locator('.bk-usage')).toContainText('MB');
  await page.goto(page.url().replace(/#.*$/, '#/flows/big0'));
  await setCode(page, seq('A->>B: buyuk veride kayit\n'));
  await expect(page.locator('.toast.err')).toHaveCount(0);
});

test('7 günden eski yedek ve yeni değişiklik varsa hatırlatılır', async ({ context }) => {
  await seed(context, { docs: legacy['seqstudio.docs'], current: 'd2', settings: { lastBackup: Date.now() - 9 * 86400000, firstUse: Date.now() - 30 * 86400000 } });
  const page = await openApp(context);
  await expect(page.locator('#btnSettings.needs-backup')).toHaveCount(1);
  await page.click('#btnSettings');
  await page.locator('.set-nav a[data-section="data"]').click();
  await expect(page.locator('.set-main .backup-box.due')).toContainText('yedeklenmemiş değişiklikler');
});

test('IndexedDB yoksa localStorage ile çalışır ve kullanıcı uyarılır', async ({ context }) => {
  await context.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) { /* yok */ } });
  await seed(context, { idb: false, settings: { view: 'code' } });
  const prep = await context.newPage();
  await prep.goto(BLANK_URL);
  await prep.evaluate(() => localStorage.setItem('seqstudio.docs', JSON.stringify([{ id: 'x1', name: 'LS diyagram', code: 'sequenceDiagram\nA->>B: ls\n', updated: Date.now() }])));
  await prep.close();
  const page = await openApp(context);
  await expect(page.locator('#docName')).toHaveValue('LS diyagram');
  await expect(page.locator('.toast.err').filter({ hasText: 'IndexedDB kullanılamıyor' })).toBeVisible();
  await setCode(page, seq('A->>B: ls kaydi\n'));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('seqstudio.docs'))).toContain('ls kaydi');
});

