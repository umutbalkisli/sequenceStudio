// Çalışma alanı: yerelde tek ve sabit çalışma alanı; tüm içerik ve diyagram görünümü ona bağlı.
// Eski veritabanından yükseltme, rozet, yeniden adlandırma, görünüm ayarlarının taşınması, yedek.
import { test, expect, seed, openApp, download, idbDump, doc, seq } from './helpers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const docs = () => [doc('a', 'Sepet', seq('participant A\nA->>A: x\n'))];
const personal = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.settings')));
const workspaces = async (page) => (await idbDump(page)).kv.workspaces;

test('eski veritabanı yükseltilince içerik yerel çalışma alanına taşınır; yeni akış ona bağlanır', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'a', folders: [{ id: 'f1', name: 'Klasör' }], catalog: [{ id: 'x', name: 'X', kind: 'system' }] });
  const page = await openApp(context);
  const dump = await idbDump(page);
  expect(dump.docs.map((d) => d.workspaceId)).toEqual(['local']);
  // Ham anahtarlar: eski listeler öğe kayıtlarına taşındı, kv'de yalnızca işaretler ve çalışma alanları kalır
  const keys = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('sequence-studio');
    r.onsuccess = () => { r.result.transaction('kv').objectStore('kv').getAllKeys().onsuccess = (e) => { res(e.target.result.sort()); r.result.close(); }; };
  }));
  expect(keys).toEqual(['migrated', 'workspaces', 'ws:local:rolesInit']);
  expect(dump.kv.folders).toEqual([{ id: 'f1', name: 'Klasör' }]);
  expect(dump.kv.catalog).toEqual([expect.objectContaining({ id: 'x', name: 'X', kind: 'system' })]);
  expect(dump.kv.workspaces).toEqual([expect.objectContaining({ id: 'local', kind: 'local' })]);
  await page.locator('#mainNav [data-nav="flows"]').click();
  await page.locator('#flowsNew').click();
  await expect.poll(async () => (await idbDump(page)).docs.map((d) => d.workspaceId)).toEqual(['local', 'local']);
});

test('rozet etkin çalışma alanını gösterir; yeni çalışma alanı açılamaz; ad ayarlardan değişir', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'a' });
  const page = await openApp(context);
  await expect(page.locator('#btnWorkspace')).toHaveText('Yerel çalışma alanı');
  await page.locator('#btnWorkspace').click();
  const panel = page.locator('.ws-panel');
  await expect(panel.locator('.ws-card')).toHaveCount(1);
  await expect(panel).toContainText('Yerel · yalnızca bu tarayıcıda');
  await expect(panel).toContainText('1 akış');
  await expect(panel.getByText(/yeni|oluştur/i)).toHaveCount(0); // oluşturma seçeneği yok
  await panel.locator('a.dd-item').click();
  await expect(page).toHaveURL(/#\/settings\/workspace$/);
  await page.locator('#wsName').fill('Ödeme ekibi');
  await page.locator('#wsName').press('Enter');
  await expect(page.locator('#btnWorkspace')).toHaveText('Ödeme ekibi');
  await expect(page.locator('.set-group').first()).toHaveText('Çalışma alanı · Ödeme ekibi');
  await expect.poll(async () => (await workspaces(page))[0].name).toBe('Ödeme ekibi');
  await page.reload();
  await expect(page.locator('#btnWorkspace')).toHaveText('Ödeme ekibi');
});

test('diyagram görünümü çalışma alanında saklanır; eski kişisel ayarlardan taşınır; önizleme ve ayarlar eşleşir', async ({ context }) => {
  // Önceki sürümde görünüm ayarları kişisel ayarlardaydı
  await seed(context, { docs: docs(), current: 'a', settings: { legend: false, mirror: false, mmTheme: 'neutral' } });
  const page = await openApp(context);
  await expect.poll(async () => (await workspaces(page))[0].settings).toEqual({ legend: false, mirror: false, mmTheme: 'neutral' });
  const p = await personal(page);
  ['legend', 'mirror', 'mmTheme'].forEach((k) => expect(p).not.toHaveProperty(k));
  await expect(page.locator('#mmTheme')).toHaveValue('neutral');
  await expect(page.locator('#optLegend')).not.toBeChecked();

  // Önizleme başlığından değişince çalışma alanına yazılır ve ayarlar sayfası aynı değeri gösterir
  await page.locator('label:has(#optLegend)').click();
  await expect.poll(async () => (await workspaces(page))[0].settings.legend).toBe(true);
  await page.goto(page.url().replace(/#.*$/, '#/settings/workspace'));
  await expect(page.locator('#wsLegend')).toBeChecked();
  await expect(page.locator('#wsMmTheme')).toHaveValue('neutral');
  await page.locator('#wsMmTheme').selectOption('forest');
  await expect.poll(async () => (await workspaces(page))[0].settings.mmTheme).toBe('forest');
  await page.locator('#mainNav [data-nav="flows"]').click();
  await page.locator('.fp-row', { hasText: 'Sepet' }).click();
  await expect(page.locator('#mmTheme')).toHaveValue('forest');
});

test('yedek çalışma alanını taşır; "Tümünü değiştir" adı ve görünüm ayarlarını da geri yükler', async ({ context }) => {
  await seed(context, { docs: docs(), current: 'a' });
  const page = await openApp(context, { hash: '/settings/workspace' });
  await page.locator('#wsName').fill('Ekip A');
  await page.locator('#wsName').press('Enter');
  await page.locator('label:has(#wsMirror)').click();
  await page.locator('.set-nav a[data-section="data"]').click();
  const dl = await download(page, () => page.locator('.set-main .backup-box .bk-actions .btn').first().click());
  const bk = JSON.parse(dl.text());
  expect(bk.workspace).toEqual({ id: 'local', kind: 'local', name: 'Ekip A', settings: { mirror: false } });
  expect(bk.docs.every((d) => d.workspaceId === 'local')).toBe(true);

  // Değiştirip yedekten geri yükle
  await page.locator('.set-nav a[data-section="workspace"]').click();
  await page.locator('#wsName').fill('Başka');
  await page.locator('#wsName').press('Enter');
  await page.locator('label:has(#wsMirror)').click();
  await page.locator('.set-nav a[data-section="data"]').click();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-')), 'yedek.json');
  fs.writeFileSync(file, JSON.stringify(bk));
  page.on('dialog', (d) => d.accept());
  await page.locator('.set-main .backup-box input[type=file]').setInputFiles(file);
  await page.locator('.restore-opt', { hasText: 'Tümünü değiştir' }).click();
  await expect(page.locator('#btnWorkspace')).toHaveText('Ekip A');
  await expect.poll(async () => (await workspaces(page))[0]).toMatchObject({ name: 'Ekip A', settings: { mirror: false } });
});
