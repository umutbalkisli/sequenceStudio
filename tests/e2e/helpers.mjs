// Uçtan uca testler için ortak yardımcılar.
// - `test`: her testte sayfa hatalarını toplar ve test sonunda hata olmadığını doğrular.
// - `seed`: uygulama açılmadan önce, uygulamanın olmadığı boş bir sayfadan depolamayı hazırlar.
// - `openApp`: uygulamayı açar ve ilk çizimi bekler.
import { test as base, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const APP_URL = pathToFileURL(path.join(root, 'index.html')).href;
export const BLANK_URL = pathToFileURL(path.join(root, 'tests/fixtures/blank.html')).href;
export { expect };

export const test = base.extend({
  /** Bağlamdaki tüm sayfaların hatalarını toplar; test sonunda boş olmalı. */
  pageErrors: [async ({ context }, use) => {
    const errors = [];
    const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
    context.pages().forEach(watch);
    context.on('page', watch);
    await use(errors);
    expect(errors, 'sayfada JavaScript hatası olmamalı').toEqual([]);
  }, { auto: true }],
});

export const seq = (body) => 'sequenceDiagram\n' + body;
export const doc = (id, name, code, extra = {}) => ({ id, name, code, updated: Date.now(), ...extra });

/**
 * Depolamayı hazırlar. docs/folders/roles/catalog IndexedDB'ye (v2), settings/current localStorage'a yazılır.
 * Uygulama açılınca veritabanını güncel sürüme yükseltir ve bu veriyi yerel çalışma alanına öğe kayıtları olarak taşır.
 * workspace: çalışma alanı kaydı (ör. yetki testi için { role: 'viewer' }); verilmezse uygulama oluşturur.
 * legacy: eski sürümün localStorage anahtarları (taşıma testi için).
 */
export async function seed(context, { settings = {}, docs, folders, roles, catalog, current, legacy, workspace, idb = true } = {}) {
  const page = await context.newPage();
  await page.goto(BLANK_URL);
  await page.evaluate(async (o) => {
    localStorage.setItem('seqstudio.settings', JSON.stringify(Object.assign({ appTheme: 'light', lang: 'tr', view: 'builder', palCompact: true }, o.settings)));
    if (o.current) localStorage.setItem('seqstudio.current', JSON.stringify(o.current));
    if (o.legacy) Object.entries(o.legacy).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    if (!o.idb) return;
    await new Promise((res, rej) => {
      const r = indexedDB.open('sequence-studio', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('kv');
        db.createObjectStore('versions', { keyPath: 'vid' }).createIndex('docId', 'docId');
      };
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction(['docs', 'kv'], 'readwrite');
        (o.docs || []).forEach((d) => tx.objectStore('docs').put(d));
        if (o.folders) tx.objectStore('kv').put(o.folders, 'folders');
        if (o.roles) tx.objectStore('kv').put(o.roles, 'roles');
        if (o.catalog) tx.objectStore('kv').put(o.catalog, 'catalog');
        if (o.workspace) tx.objectStore('kv').put([Object.assign({ id: 'local', kind: 'local', name: '' }, o.workspace)], 'workspaces');
        tx.objectStore('kv').put(Date.now(), 'migrated');
        tx.oncomplete = () => { db.close(); res(); };
      };
    });
  }, { settings, docs, folders, roles, catalog, current, legacy, workspace, idb: idb && !legacy });
  await page.close();
}

/** Uygulamayı açar; diyagram çizilene (ya da boş durum görünene) kadar bekler. */
export async function openApp(context, { hash = '' } = {}) {
  const page = await context.newPage();
  await page.goto(APP_URL + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => document.querySelector('.paper svg') || !document.querySelector('#emptyState')?.hidden);
  return page;
}

/**
 * Kod editörüne yazar (kullanıcı girişi gibi) ve kaydın bitmesini bekler.
 * Editör modele gecikmeli aktarır: önce "kaydediliyor" (dirty), sonra "kaydedildi" beklenir.
 */
export async function setCode(page, code) {
  const state = page.locator('#saveState');
  await page.evaluate((c) => { const ta = document.querySelector('#code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); }, code);
  await expect(state).toHaveClass(/dirty/, { timeout: 3000 }).catch(() => { /* çok hızlı kaydedildiyse */ });
  await expect(state).not.toHaveClass(/dirty/);
}
export const getCode = (page) => page.locator('#code').inputValue();
export const setView = (page, v) => page.click(`[data-view=${v}]`);

const exact = (s) => new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
/** Akışlar sayfasında adı tam eşleşen satır */
export const flowRow = (page, name) => page.locator('.fp-row', { has: page.locator('.fp-name b', { hasText: exact(name) }) });
/** Akışlar sayfasından akışı düzenleyicide açar. */
export async function openDocFromFlows(page, name) {
  await page.locator('#mainNav [data-nav="flows"]').click();
  await flowRow(page, name).click();
  await expect(page.locator('#docName')).toHaveValue(name);
}
/** Akışlar sayfasından akışı siler (onay penceresini test kabul etmeli); sonra önceki ekrana döner. */
export async function deleteDocFromFlows(page, name) {
  await page.locator('#mainNav [data-nav="flows"]').click();
  const row = flowRow(page, name);
  await row.hover();
  await row.locator('.fp-row-actions .del').click();
  await expect(row).toHaveCount(0);
  await page.goBack();
}

/**
 * IndexedDB içeriği: { docs, kv, entities }. Öğe kayıtları (sürüm 4) eski biçimde de okunabilsin diye
 * silinmemiş akışlar `docs`, klasör/rol/katalog listeleri sıralarıyla `kv.folders|roles|catalog` olarak döner;
 * `entities` ham kayıtlardır (üstveri ve silme izleri dahil).
 */
export function idbDump(page) {
  return page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('sequence-studio');
    r.onsuccess = () => {
      const db = r.result, out = { docs: [], kv: {}, entities: [] };
      const tx = db.transaction(['entities', 'kv']);
      tx.objectStore('entities').getAll().onsuccess = (e) => { out.entities = e.target.result; };
      const kv = tx.objectStore('kv');
      kv.getAllKeys().onsuccess = (e) => e.target.result.forEach((k) => { kv.get(k).onsuccess = (ev) => { out.kv[k] = ev.target.result; }; });
      tx.oncomplete = () => {
        const live = (type) => out.entities.filter((x) => x.type === type && !x.meta.deleted).sort((a, b) => a.pos - b.pos).map((x) => x.data);
        out.docs = live('doc');
        out.kv.folders = live('folder');
        out.kv.catalog = live('catalog');
        const roles = out.entities.filter((x) => x.type === 'role');
        out.kv.roles = roles.length || out.kv['ws:local:rolesInit'] ? live('role') : undefined;
        db.close();
        res(out);
      };
    };
  }));
}

/** Bir tıklamanın tetiklediği indirmeyi kaydeder; { name, path, text(), buffer() } döner. */
export async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), path: file, text: () => fs.readFileSync(file, 'utf8'), buffer: () => fs.readFileSync(file) };
}

/** Dışa aktarma penceresini açıp formatı seçer. */
export async function openExport(page, format) {
  await page.click('#btnExport');
  await page.locator('.modal .fmt', { has: page.locator('b', { hasText: format }) }).click();
}

/** Uygulamanın ürettiği (sıkıştırmasız, "store") ZIP'i okur: { yol: Buffer } */
export function readZip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lName = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    files[name] = buf.slice(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
