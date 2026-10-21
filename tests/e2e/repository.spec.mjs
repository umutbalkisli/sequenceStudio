// Bulut hazırlığı: öğe kayıtlarının üstverisi ve silme izleri, kullanıcı kimliği, benzersiz kimlikler,
// kayıt durumu göstergesi ve salt okunur (yetkisiz) çalışma alanı.
import { test, expect, seed, openApp, setCode, getCode, idbDump, doc, seq, BLANK_URL } from './helpers.mjs';

const CATALOG = [
  { id: 'pay', name: 'Ödeme sistemi', kind: 'system' },
  { id: 'ledger', name: 'Ledger', kind: 'container', role: 'service', parent: 'pay' },
];
const LINKED = seq('%% @item ledger\n%% @role service\n%% @color #2fbf7f\nparticipant L as Ledger Service\nL->>L: x\n');
const userId = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.user')).id);
const entity = async (page, key) => (await idbDump(page)).entities.find((e) => e.key === key);

test('silinen öğe ve akış silme izi bırakır; diğer akıştaki bağ açılınca kalkar', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Boş', seq('participant X\nX->>X: y\n')), doc('d2', 'Defter', LINKED, { updated: Date.now() - 1000 })], current: 'd1', catalog: CATALOG });
  const page = await openApp(context, { hash: '/catalog/ledger' });
  page.on('dialog', (d) => d.accept());
  await page.locator('.cp-detail .btn.danger').click();
  await expect.poll(async () => (await entity(page, 'local|catalog|ledger')).meta).toMatchObject({ deleted: true, rev: 2, updatedBy: await userId(page) });
  expect((await entity(page, 'local|catalog|ledger')).data).toBeNull();
  // Diğer akış kayıtta değişmedi; açılınca bağ kaldırılır, katılımcı ve görünümü korunur
  expect((await entity(page, 'local|doc|d2')).data.code).toContain('@item ledger');
  await page.evaluate(() => window.Seq.router.openFlow('d2'));
  await expect(page.locator('#docName')).toHaveValue('Defter');
  await page.evaluate(() => window.Seq.layout.setView('code'));
  await expect.poll(() => getCode(page)).not.toContain('@item');
  expect(await getCode(page)).toMatch(/%% @role service\n\s*%% @color #2fbf7f\n\s*participant L as Ledger Service/);

  // Akış silinince de iz kalır (senkronizasyon başka cihaza bildirebilsin)
  await page.evaluate(() => window.Seq.docs.deleteDoc('d1', { confirmed: true }));
  await expect.poll(async () => (await entity(page, 'local|doc|d1')).meta.deleted).toBe(true);
  expect((await idbDump(page)).docs.map((d) => d.id)).toEqual(['d2']);
});

test('kullanıcı kimliği: kayıtlar ve sürümler yazanı taşır; ad ayarlardan verilir; yeni kimlikler çakışmaz', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('participant X\nX->>X: y\n'))], current: 'd1', catalog: CATALOG });
  const page = await openApp(context, { hash: '/settings/general' });
  const me = await userId(page);
  expect(me).toMatch(/^u[a-z0-9]+$/);
  await page.locator('#userName').fill('Ayşe');
  await page.locator('#userName').press('Enter');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.user')))).toEqual({ id: me, name: 'Ayşe' });

  // Aynı adla iki öğe: kimlikler ad kısaltması + rastgele sonek, birbirinden farklı
  const ids = await page.evaluate(() => [window.Seq.catalog.createItem({ name: 'Ledger' }).id, window.Seq.catalog.createItem({ name: 'Ledger' }).id]);
  ids.forEach((id) => expect(id).toMatch(/^ledger-[a-z0-9]{4}$/));
  expect(ids[0]).not.toBe(ids[1]);
  expect(ids).not.toContain('ledger');
  await expect.poll(async () => (await entity(page, 'local|catalog|' + ids[0]))?.meta).toMatchObject({ rev: 1, createdBy: me, updatedBy: me });

  // Sürüm geçmişi: elle kaydedilen sürüm yazanı taşır ve adıyla gösterilir
  await page.locator('#mainNav [data-nav="flows"]').click();
  await page.locator('.fp-row[data-id="d1"]').click();
  await page.locator('#btnHistory').click();
  await page.locator('.hist-top .btn').click();
  await expect(page.locator('.hist-meta .hist-by')).toHaveText('· Ayşe');
  const versions = await page.evaluate(() => window.Seq.repo.versions.list('d1'));
  expect(versions[0].by).toBe(me);
});

test('kayıt durumu göstergesi depodan gelir: yazma hatasında uyarı, sonraki başarılı kayıtta düzelir', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'A', seq('A->>B: x\n'))], current: 'd1', settings: { view: 'code' } });
  const page = await openApp(context);
  const state = page.locator('#saveState');
  await expect(state).toHaveText('Kaydedildi');
  // Öğe deposuna yazma bir süreliğine başarısız olsun
  await page.evaluate(() => {
    const orig = IDBDatabase.prototype.transaction;
    window.__restore = () => { IDBDatabase.prototype.transaction = orig; };
    IDBDatabase.prototype.transaction = function (stores, mode) {
      if (mode === 'readwrite' && [].concat(stores).includes('entities')) throw new DOMException('disk dolu', 'QuotaExceededError');
      return orig.call(this, stores, mode);
    };
  });
  await page.evaluate(() => { const ta = document.querySelector('#code'); ta.value = 'sequenceDiagram\nA->>B: HATA\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(state).toHaveText('Kaydedilemedi');
  await expect(state).toHaveClass(/error/);
  await expect(page.locator('.toast.err')).toBeVisible();
  // Depo düzelince bir sonraki kayıtta bekleyen değişiklik de yazılır
  await page.evaluate(() => window.__restore());
  await setCode(page, seq('A->>B: TAMAM\n'));
  await expect(state).toHaveText('Kaydedildi');
  await expect(state).not.toHaveClass(/error/);
  await expect.poll(async () => (await entity(page, 'local|doc|d1')).data.code).toContain('TAMAM');
});

test('salt okunur çalışma alanı: düzenleme arayüzü kilitli, değişiklik yazılmaz', async ({ context }) => {
  await seed(context, { docs: [doc('d1', 'Defter', LINKED)], current: 'd1', catalog: CATALOG, workspace: { role: 'viewer' } });
  const page = await openApp(context);
  await expect(page.locator('body')).toHaveClass(/readonly/);
  await expect(page.locator('#roPill')).toBeVisible();
  await expect(page.locator('#roPill')).toHaveText('Salt okunur');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#btnTemplates')).toBeHidden();
  await expect(page.locator('.paper svg[aria-roledescription]')).toBeVisible(); // önizleme çalışır
  await page.locator('#btnWorkspace').click();
  await expect(page.locator('.ws-panel .ws-role')).toHaveText('Yetkin: Görüntüleyici');
  await page.keyboard.press('Escape');

  // Kod düzenleyici salt okunur; dışarıdan gelen değişiklik geri alınır
  await page.evaluate(() => window.Seq.layout.setView('code'));
  await expect(page.locator('#code')).toHaveJSProperty('readOnly', true);
  const before = await getCode(page);
  await page.evaluate(() => { const ta = document.querySelector('#code'); ta.value = 'sequenceDiagram\nA->>B: yasak\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('.toast.err')).toContainText('Salt okunur');
  await expect.poll(() => getCode(page)).toBe(before);
  // Değişiklik yapan işlemler reddedilir
  const res = await page.evaluate(() => ({
    item: window.Seq.catalog.createItem({ name: 'X' }),
    moved: window.Seq.catalog.moveItem('ledger', null),
    doc: window.Seq.docs.createDoc('Yeni', 'sequenceDiagram\n'),
  }));
  expect(res).toEqual({ item: null, moved: false, doc: null });

  // Sayfalarda oluşturma düğmeleri yok; ayar bölümleri kilitli
  await page.locator('#mainNav [data-nav="flows"]').click();
  await expect(page.locator('#flowsNew')).toBeHidden();
  await page.locator('#mainNav [data-nav="catalog"]').click();
  await expect(page.locator('#catNew')).toBeHidden();
  await page.goto(page.url().replace(/#.*$/, '#/settings/roles'));
  await expect(page.locator('.set-main')).toHaveClass(/locked/);

  // Hiçbir şey yazılmadı
  const dump = await idbDump(page);
  expect(dump.entities.filter((e) => e.meta.rev > 1)).toEqual([]);
  expect(dump.docs.map((d) => d.code)).toEqual([LINKED]);
});

test('sürüm 3 veritabanı öğe kayıtlarına yükseltilir: sıra, roller ve çalışma alanı korunur', async ({ context }) => {
  const prep = await context.newPage();
  await prep.goto(BLANK_URL);
  const roles = [{ id: 'svc', name: 'Servis', type: 'participant', color: '#2fbf7f', prefix: '', suffix: ' Service' }];
  await prep.evaluate(({ code, roles, catalog }) => new Promise((res) => {
    localStorage.setItem('seqstudio.settings', JSON.stringify({ lang: 'tr', view: 'builder' }));
    const r = indexedDB.open('sequence-studio', 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('docs', { keyPath: 'id' }).createIndex('ws', 'workspaceId');
      db.createObjectStore('kv');
      db.createObjectStore('versions', { keyPath: 'vid' }).createIndex('docId', 'docId');
    };
    r.onsuccess = () => {
      const tx = r.result.transaction(['docs', 'kv', 'versions'], 'readwrite');
      tx.objectStore('docs').put({ id: 'dA', name: 'Ödeme', code, updated: 1000, workspaceId: 'local' });
      const kv = tx.objectStore('kv');
      kv.put(Date.now(), 'migrated');
      kv.put([{ id: 'local', kind: 'local', name: 'Ekip', settings: { legend: false } }], 'workspaces');
      kv.put([{ id: 'f2', name: 'İkinci' }, { id: 'f1', name: 'Birinci' }], 'ws:local:folders');
      kv.put(roles, 'ws:local:roles');
      kv.put(catalog, 'ws:local:catalog');
      tx.objectStore('versions').put({ vid: 'v1', docId: 'dA', ts: 5, code, name: 'Ödeme', kind: 'manual' });
      tx.oncomplete = () => { r.result.close(); res(); };
    };
  }), { code: seq('A->>B: eski\n'), roles, catalog: CATALOG });
  await prep.close();
  const page = await openApp(context);
  await expect(page.locator('#btnWorkspace')).toHaveText('Ekip');
  const dump = await idbDump(page);
  expect(dump.docs.map((d) => d.name)).toEqual(['Ödeme']);
  expect(dump.kv.folders.map((f) => f.id)).toEqual(['f2', 'f1']); // sıra korunur
  expect(dump.kv.roles).toEqual(roles); // hazır roller eklenmez
  expect(dump.kv.catalog.map((x) => x.id)).toEqual(['pay', 'ledger']);
  expect(Object.keys(dump.kv).filter((k) => k.startsWith('ws:'))).toEqual(['ws:local:rolesInit']);
  expect(dump.entities.find((e) => e.key === 'local|doc|dA').meta).toMatchObject({ rev: expect.any(Number), createdAt: 1000 });
  expect(await page.evaluate(() => window.Seq.repo.versions.list('dA'))).toHaveLength(1);
});
