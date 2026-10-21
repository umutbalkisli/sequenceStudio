// Sürüm geçmişi (otomatik/elle sürümler, karşılaştırma, geri dönme) ve ⌘K arama.
import { test, expect, seed, openApp, setCode, getCode, setView, openDocFromFlows, deleteDocFromFlows, doc, seq, BLANK_URL } from './helpers.mjs';

const C0 = seq('participant O as Ödeme Servisi\nU->>O: GET api/merchants\n');
const versions = (page, id) => page.evaluate((id) => window.SeqStorage.listVersions(id), id);
/** Sayfa saatini ileri almak için (window.__skew ms) */
const controllableClock = (context) => context.addInitScript(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew; });

const docs = () => [
  doc('dA', 'Ödeme akışı', C0, { folder: 'fP', updated: Date.now() - 5000 }),
  doc('dB', 'Sipariş', seq('A->>B: 409 Conflict\nB->>A: api retry\n'), { updated: Date.now() - 9000 }),
  doc('dC', 'Kayıt', seq('U->>S: register\nNote over S: KVKK onayı\nalt doğrulandı\nS-->>U: ok\nend\n'), { updated: Date.now() - 20000 }),
];
const folders = [{ id: 'fP', name: 'Payments', collapsed: false }];

test.describe('sürüm geçmişi', () => {
  test('önceki sürümden (v1) yükseltmede veri korunur', async ({ context }) => {
    const prep = await context.newPage();
    await prep.goto(BLANK_URL);
    await prep.evaluate((code) => new Promise((res) => {
      localStorage.setItem('seqstudio.settings', JSON.stringify({ lang: 'tr', view: 'code' }));
      const r = indexedDB.open('sequence-studio', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('docs', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
      r.onsuccess = () => { const tx = r.result.transaction(['docs', 'kv'], 'readwrite'); tx.objectStore('docs').put({ id: 'dA', name: 'Ödeme akışı', code, updated: Date.now() }); tx.objectStore('kv').put(Date.now(), 'migrated'); tx.oncomplete = () => { r.result.close(); res(); }; };
    }), C0);
    await prep.close();
    const page = await openApp(context);
    const stores = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('sequence-studio'); r.onsuccess = () => { res([r.result.version, [...r.result.objectStoreNames]]); r.result.close(); }; }));
    expect(stores).toEqual([4, ['entities', 'kv', 'versions']]); // 4: öğe bazlı kayıtlar
    expect(await getCode(page)).toBe(C0);
  });

  test('otomatik sürüm kuralları: düzenleme öncesi hâl, 10 dk aralık, diyagram değişimi', async ({ context }) => {
    await controllableClock(context);
    await seed(context, { docs: docs(), folders, current: 'dA', settings: { view: 'code' } });
    const page = await openApp(context);
    expect(await versions(page, 'dA')).toHaveLength(0);

    await setCode(page, C0 + 'O-->>U: 200 OK\n');
    await expect.poll(() => versions(page, 'dA')).toHaveLength(1);
    expect((await versions(page, 'dA'))[0]).toMatchObject({ code: C0, kind: 'auto' });

    await setCode(page, C0 + 'O-->>U: 200 OK\nU->>O: tekrar\n');
    await page.waitForTimeout(300);
    expect(await versions(page, 'dA')).toHaveLength(1); // 10 dk dolmadı

    await page.evaluate(() => { window.__skew += 11 * 60 * 1000; });
    await setCode(page, C0 + 'O-->>U: 204\n');
    await expect.poll(async () => (await versions(page, 'dA')).length).toBe(2);

    await setCode(page, C0 + 'O->>O: SON\n');
    await openDocFromFlows(page, 'Sipariş');
    await expect.poll(async () => (await versions(page, 'dA'))[0]?.code).toContain('SON');
  });

  test('elle kayıt, karşılaştırma, sürüme dönme ve kopya olarak açma', async ({ context }) => {
    await seed(context, { docs: docs(), folders, current: 'dA', settings: { view: 'code' } });
    const page = await openApp(context);
    await setCode(page, C0 + 'O-->>U: 200 OK\n');
    await expect.poll(async () => (await versions(page, 'dA')).length).toBe(1);

    await page.click('#btnHistory');
    await page.fill('.hist-top .input', 'Elle kayıt testi');
    await page.click('.hist-top .btn');
    await expect(page.locator('.hist-item')).toHaveCount(2);
    expect((await versions(page, 'dA'))[0]).toMatchObject({ kind: 'manual', label: 'Elle kayıt testi' });

    await page.locator('.hist-item').last().click(); // en eski: düzenleme öncesi
    await expect(page.locator('.hist-img img')).toHaveCount(2);
    await page.locator('.hist-dhead .seg button', { hasText: 'Kod farkı' }).click();
    await expect(page.locator('.hd-line.add')).toHaveCount(1);
    await expect(page.locator('.hd-line.add')).toContainText('200 OK');

    await page.locator('.hist-actions .btn.primary').click(); // bu sürüme dön
    await expect(page.locator('#code')).toHaveValue(C0);
    expect((await versions(page, 'dA'))[0]).toMatchObject({ kind: 'restore' });

    await page.click('#btnHistory');
    await page.locator('.hist-item').nth(1).click();
    await page.locator('.hist-actions .btn', { hasText: 'Kopya olarak aç' }).click();
    await expect(page.locator('#docName')).toHaveValue(/^Ödeme akışı \(/);
  });

  test('saklama sınırı: son 50 otomatik sürüm tutulur, elle olanlar silinmez', async ({ context }) => {
    await seed(context, { docs: docs(), current: 'dA' });
    const page = await openApp(context);
    const [total, manual] = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) await window.SeqStorage.addVersion({ vid: 'x' + i, docId: 'zz', ts: 1000 + i, code: 'c' + i, name: 'z', kind: 'auto' }, 50);
      await window.SeqStorage.addVersion({ vid: 'm1', docId: 'zz', ts: 1, code: 'm', name: 'z', kind: 'manual' }, 50);
      const v = await window.SeqStorage.listVersions('zz');
      return [v.length, v.filter((x) => x.kind === 'manual').length];
    });
    expect([total, manual]).toEqual([51, 1]);
  });

  test('silinen diyagramın sürümleri de silinir', async ({ context }) => {
    await seed(context, { docs: docs(), folders, current: 'dA' });
    const page = await openApp(context);
    page.on('dialog', (d) => d.accept());
    await page.evaluate(() => window.SeqStorage.addVersion({ vid: 'k1', docId: 'dB', ts: Date.now(), code: 'x', name: 'k', kind: 'manual' }, 50));
    await deleteDocFromFlows(page, 'Sipariş');
    await expect.poll(async () => (await versions(page, 'dB')).length).toBe(0);
  });
});

test.describe('arama (⌘K)', () => {
  test.beforeEach(async ({ context }) => { await seed(context, { docs: docs(), folders, current: 'dB' }); });

  test('boş aramada son açılanlar; Türkçe duyarsız ad araması; çoklu kelime', async ({ context }) => {
    const page = await openApp(context);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('.search-sec')).toHaveText('Son açılanlar');
    await expect(page.locator('.search-item')).toHaveCount(3);
    await page.keyboard.type('odeme');
    await expect(page.locator('.search-item .si-name').first()).toContainText('Ödeme akışı');
    await page.fill('.search-input', '409 retry');
    await expect(page.locator('.search-item')).toHaveCount(1);
    await expect(page.locator('.search-item .si-name')).toContainText('Sipariş');
    await page.fill('.search-input', 'payments');
    await expect(page.locator('.search-item .si-name').first()).toContainText('Payments');
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-root')).toBeHidden();
  });

  test('eşleşen mesaj gösterilir; Enter diyagramı açıp adımı seçer (görsel ve kod)', async ({ context }) => {
    const page = await openApp(context);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('merchants');
    await expect(page.locator('.search-item .si-hit').first()).toContainText(/Mesaj.*merchants/);
    await page.fill('.search-input', 'kvkk');
    await page.keyboard.press('Enter');
    await expect(page.locator('#docName')).toHaveValue('Kayıt');
    await expect(page.locator('#flow .step.selected textarea')).toHaveValue('KVKK onayı');

    await setView(page, 'code');
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('merchants');
    await page.keyboard.press('Enter');
    await expect(page.locator('#docName')).toHaveValue('Ödeme akışı');
    // Satıra bir sonraki karede gidilir: seçim gelene kadar yokla
    await expect.poll(() => page.evaluate(() => { const t = document.querySelector('#code'); return t.value.slice(t.selectionStart, t.selectionEnd); })).toContain('GET api/merchants');
  });
});
