// Roller (ön/son ek, değişikliğin yayılması), lejant ve tanımsız rolleri içe alma.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, seed, openApp, getCode, setView, openExport, download, doc, seq } from './helpers.mjs';

const FRAUD = { id: 'fraud', name: 'Fraud Engine', type: 'control', color: '#ec5a8f', prefix: '', suffix: ' Fraud' };
const CODE = seq('%% @role user\n%% @color #6c7cff\nactor U as User\n%% @role gateway\n%% @color #f0a020\nparticipant G@{ "type": "collections" } as Public Gateway\n%% @role fraud\n%% @color #ec5a8f\nparticipant F@{ "type": "control" } as Card Fraud\nU->>+G: checkout\nG->>+F: score\n%% @tone success\nF-->>-G: ok\n%% @tone error\nG-->>-U: 409\n');

/** Hazır set + özel "fraud" rolü: hazır seti uygulama üretsin diye önce bir kez açılır */
async function withPresetPlusFraud(context) {
  const page = await openApp(context);
  await page.evaluate((f) => new Promise((res) => {
    const r = indexedDB.open('sequence-studio');
    const meta = { rev: 1, createdAt: 1, createdBy: '', updatedAt: 1, updatedBy: '' };
    r.onsuccess = () => { const tx = r.result.transaction('entities', 'readwrite'); tx.objectStore('entities').put({ key: 'local|role|' + f.id, ws: 'local', type: 'role', id: f.id, pos: 999, data: f, meta }); tx.oncomplete = () => { r.result.close(); res(); }; };
  }), FRAUD);
  await page.close();
}

test.describe('roller', () => {
  test('rol çipiyle eklenen katılımcıya son ek uygulanır; rol düzenlemesi diğer diyagramlara açılınca yansır', async ({ context }) => {
    await seed(context, {
      docs: [doc('d1', 'Aktif', seq('actor U as User\nU->>U: x\n')), doc('d2', 'Diğer', seq('%% @role service\n%% @color #2fbf7f\nparticipant S as Stock Service\nS->>S: x\n'), { updated: Date.now() - 1000 })],
      current: 'd1',
    });
    const page = await openApp(context);
    await page.locator('#palRoles .role-chip', { hasText: 'Servis' }).click();
    await page.keyboard.type('Order');
    await page.keyboard.press('Escape');
    expect(await getCode(page)).toMatch(/%% @role service\n\s*%% @color #2fbf7f\n\s*participant OrderService as Order Service/);

    await page.locator('#palRoles .chip-edit').click();
    const row = page.locator('.role-row:not(.role-head)').filter({ has: page.locator('.role-example', { hasText: 'Order Service' }) });
    await row.locator('.affix-cell').nth(1).locator('input').fill(' Svc');
    await expect.poll(() => getCode(page)).toContain('as Order Svc');
    // Diğer diyagram kayıtta değişmez; açılınca yeni ekle görünür
    const stored = () => page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('sequence-studio'); r.onsuccess = () => { r.result.transaction('entities').objectStore('entities').get('local|doc|d2').onsuccess = (e) => res(e.target.result.data.code); };
    }));
    await page.waitForTimeout(500);
    expect(await stored()).toContain('as Stock Service');
    await page.evaluate(() => window.Seq.router.openFlow('d2'));
    await expect.poll(() => getCode(page)).toContain('as Stock Svc');
    await expect.poll(stored).toContain('as Stock Svc');
  });

  test('tip elle değiştirilince rol bağlantısı kopar', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'A', seq('%% @role service\n%% @color #2fbf7f\nparticipant B as Billing Service\nB->>B: x\n'))], current: 'd1' });
    const page = await openApp(context);
    await page.locator('.pcard', { hasText: 'Billing' }).click();
    await page.locator('#popover summary').click();
    await page.locator('#popover .type-opt', { hasText: 'Database' }).click();
    const code = await getCode(page);
    expect(code).not.toContain('@role service');
    expect(code).toContain('participant B@{ "type": "database" } as Billing Service');
  });
});

test.describe('lejant', () => {
  test('kullanılan roller ve ok renkleri gösterilir; kapatılabilir; SVG\'ye girer', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'Checkout', CODE)], current: 'd1' });
    await withPresetPlusFraud(context);
    const page = await openApp(context);
    await expect(page.locator('.paper .seq-legend .lg-text')).toHaveText(['Kullanıcı', 'API Gateway', 'Fraud Engine', 'Başarılı', 'Hata']);
    await expect(page.locator('.paper .seq-legend svg path').first()).toBeAttached(); // rol ikonları çizildi
    await page.locator('label:has(#optLegend)').click();
    await expect(page.locator('.paper .seq-legend')).toHaveCount(0);
    await page.locator('label:has(#optLegend)').click();
    await openExport(page, 'SVG');
    const svg = await download(page, () => page.locator('.export-actions .btn.primary').click());
    expect(svg.text()).toContain('seq-legend');
  });

  test('dar diyagramda lejant tuvale sığar', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'Tek', seq('%% @role gateway\n%% @color #f0a020\nparticipant G as Gateway\n%% @tone error\nG->>G: x\n'))], current: 'd1' });
    const page = await openApp(context);
    const fits = await page.evaluate(() => { const s = document.querySelector('.paper svg'); const vb = s.viewBox.baseVal; const f = s.querySelector('.lg-frame').getBBox(); return f.x >= vb.x - 0.5 && f.x + f.width <= vb.x + vb.width + 0.5 && f.y + f.height <= vb.y + vb.height + 0.5; });
    expect(fits).toBe(true);
  });
});

test.describe('tanımsız roller', () => {
  test('dışarı çıkan kod rol tanımlarını taşır; boş profilde bilgi çubuğuyla eklenir', async ({ context, browser }) => {
    await seed(context, { docs: [doc('d1', 'Checkout', CODE)], current: 'd1' });
    await withPresetPlusFraud(context);
    const page = await openApp(context);
    await openExport(page, 'Mermaid');
    const mmd = await download(page, () => page.locator('.export-actions .btn.primary').click());
    expect(mmd.text()).toMatch(/%% @roledef fraud \{"name":"Fraud Engine"/);
    expect(await getCode(page)).not.toContain('@roledef'); // kayıtlı kod temiz kalır

    const fresh = await browser.newContext();
    await seed(fresh, {});
    const p2 = await openApp(fresh);
    await p2.setInputFiles('#fileInput', mmd.path);
    await expect(p2.locator('#notice')).toContainText('Fraud Engine');
    await expect(p2.locator('#notice .rp-chip')).toHaveCount(1); // hazır set rolleri zaten biliniyor
    await p2.locator('#notice .btn.primary').click();
    await expect(p2.locator('#palRoles .role-chip', { hasText: 'Fraud Engine' })).toHaveCount(1);
    expect(await getCode(p2)).not.toContain('@roledef');
    await fresh.close();
  });

  test('tanım yoksa ad kimlikten çıkarılır; "Yoksay" kalıcıdır', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'Ledger', seq('%% @role ledger_svc\n%% @color #9b6bff\nparticipant L@{ "type": "database" } as Ledger\nA->>L: write\n'))], current: 'd1' });
    const page = await openApp(context);
    await expect(page.locator('#notice')).toContainText('Ledger svc');
    await page.locator('#notice .btn.ghost').click();
    await page.reload();
    await page.waitForSelector('.paper svg');
    await expect(page.locator('#notice')).toBeHidden();
  });
});
