// Dışa aktarma: arka plan seçenekleri, draw.io yapısı, klasör ZIP'i ve referansları içine çizme.
import { test, expect, seed, openApp, getCode, openExport, download, readZip, doc, seq } from './helpers.mjs';

const primary = (page) => page.locator('.export-actions .btn.primary');

/** Dosyanın sol üst köşe pikseli (PNG ya da SVG, tarayıcıda çizilerek) → [r,g,b,a] */
async function cornerPixel(page, file, mime) {
  const data = file.buffer().toString('base64');
  return page.evaluate(async ([data, mime]) => {
    const img = new Image(); img.src = `data:${mime};base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(2, 2, 1, 1).data);
  }, [data, mime]);
}

test.describe('arka plan', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme} tema: tema / beyaz / şeffaf (PNG ve SVG)`, async ({ context }) => {
      await seed(context, { docs: [doc('d1', 'T', seq('A->>B: hi\n'))], current: 'd1', settings: { appTheme: theme } });
      const page = await openApp(context);
      const themeRgb = theme === 'dark' ? [18, 21, 28, 255] : [255, 255, 255, 255];
      for (const [bg, label] of [['theme', 'Tema'], ['white', 'Beyaz'], ['transparent', 'Şeffaf']]) {
        for (const [fmt, mime] of [['PNG', 'image/png'], ['SVG', 'image/svg+xml']]) {
          await openExport(page, fmt);
          await page.locator('.modal .seg button', { hasText: label }).click();
          const file = await download(page, () => primary(page).click());
          const px = await cornerPixel(page, file, mime);
          const want = bg === 'theme' ? themeRgb : bg === 'white' ? [255, 255, 255, 255] : null;
          if (want) expect(px, `${fmt} ${bg}`).toEqual(want);
          else expect(px[3], `${fmt} şeffaf`).toBe(0);
        }
      }
    });
  }

  test('draw.io: tema rengi ya da açıkça "none" yazılır; şeffafta not gösterilir', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'T', seq('A->>B: hi\n'))], current: 'd1', settings: { appTheme: 'dark' } });
    const page = await openApp(context);
    await openExport(page, 'draw.io');
    await page.locator('.modal .seg button', { hasText: 'Tema' }).click();
    expect((await download(page, () => primary(page).click())).text()).toContain('background="#12151c"');
    await openExport(page, 'draw.io');
    await page.locator('.modal .seg button', { hasText: 'Şeffaf' }).click();
    await expect(page.locator('.bg-note')).toContainText('Şeffaf arka plan');
    expect((await download(page, () => primary(page).click())).text()).toContain('background="none"');
  });
});

test.describe('draw.io', () => {
  test('metinler şekil/ok etiketi; iç içe blok dıştakinin üstünde; lejant katılımcı sanılmaz', async ({ context }) => {
    const code = seq('%% @role gateway\n%% @color #f0a020\nparticipant G@{ "type": "collections" } as Abu Channel<br/>Gateway\nparticipant J as Janus\nG->>+J: req\n%% @color #3aa0ff\nalt Başarılı\n%% @tone success\nJ-->>-G: test response<br/>qqq\nalt Success\nG->>J: inner\nelse Failure\nG->>J: inner2\nend\nend\n');
    await seed(context, { docs: [doc('d1', 'Abu', code)], current: 'd1' });
    const page = await openApp(context);
    await openExport(page, 'draw.io');
    const xml = (await download(page, () => primary(page).click())).text();
    const cells = [...xml.matchAll(/<mxCell id="(c\d+)" value="([^"]*)" style="([^"]*)" (vertex|edge)="1"/g)].map((m) => ({ id: m[1], value: m[2], style: m[3], kind: m[4] }));
    // Katılımcı adı şeklin etiketi (iki satır), mesaj metni okun etiketi
    expect(cells.filter((c) => c.value === 'Abu Channel&lt;br&gt;Gateway').length).toBe(2);
    expect(cells.some((c) => c.kind === 'edge' && c.value === 'test response&lt;br&gt;qqq')).toBe(true);
    // İç içe alt: dış çerçeve (mavi) iç çerçeveden önce (altında) gelir
    const frames = cells.filter((c) => c.kind === 'vertex' && /dashed=1/.test(c.style) && /fillColor=#/.test(c.style) && !c.value);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(xml.indexOf(frames[0].id)).toBeLessThan(xml.indexOf(frames[1].id));
    // Lejant: gateway rolü bir kez ("API Gateway" metni), katılımcı sayısı değişmez (üst+alt = 2 Janus)
    expect(cells.filter((c) => c.value === 'API Gateway').length).toBe(1);
    expect(cells.filter((c) => c.value === 'Janus').length).toBe(2);
  });
});

test.describe('klasör ve referanslar', () => {
  const CO = seq('actor U as User\nparticipant G as Gateway\nparticipant O as Order Service\nU->>+G: checkout\nG->>+O: create order\n%% @ref dPay\nNote over O: Ödeme akışı\nO-->>-G: 201\nG-->>-U: done\n');
  const PAY = seq('participant O as Order Service\nparticipant P as Payment Service\nparticipant G as Bank Gateway\nO->>+P: charge\nP->>+G: authorize\nalt 3DS gerekli\n%% @ref d3ds\nNote over G: 3DS doğrulama\nend\nG-->>-P: approved\nP-->>-O: paid\n');
  const TDS = seq('participant G as Bank Gateway\nactor U as User\nG->>U: challenge\nU-->>G: OTP\n%% @ref dCo\nNote over U: Checkout\n');
  const docs = () => [
    doc('dCo', 'Checkout', CO, { folder: 'fA', updated: Date.now() }),
    doc('dPay', 'Ödeme akışı', PAY, { folder: 'fA', updated: Date.now() - 1000 }),
    doc('d3ds', '3DS doğrulama', TDS, { folder: 'fS', updated: Date.now() - 2000 }),
    doc('dPlain', 'Referanssız', seq('A->>B: x\n'), { updated: Date.now() - 3000 }),
  ];
  const folders = [{ id: 'fA', name: 'Ödeme', collapsed: false }, { id: 'fS', name: 'Kart/3DS', parent: 'fA', collapsed: false }];

  test('referanssız diyagramda seçenek yok; içine çizince tek akış, rapor ve döngü uyarısı', async ({ context }) => {
    await seed(context, { docs: docs(), folders, current: 'dPlain' });
    const page = await openApp(context);
    await openExport(page, 'SVG');
    await expect(page.locator('.modal .opt-row', { hasText: 'Referanslar' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.click('#btnDocs');
    await page.locator('.doc-item', { hasText: 'Checkout' }).click();
    const saved = await getCode(page);
    await openExport(page, 'SVG');
    const refRow = page.locator('.modal .opt-row', { hasText: 'Referanslar' });
    await expect(refRow.locator('.seg button.active')).toHaveText('Bağlantı olarak');
    await refRow.locator('button', { hasText: 'İçine çiz' }).click();
    await expect(page.locator('.ref-report li')).toHaveText(['Ödeme akışı', '3DS doğrulama']);
    await expect(page.locator('.ref-report .rr-warn')).toContainText('Checkout');
    await expect(page.locator('.export-preview img')).toBeVisible();
    const svg = (await download(page, () => primary(page).click())).text();
    for (const t of ['Payment Service', 'Bank Gateway', 'authorize', 'challenge', 'OTP', 'create order']) expect(svg).toContain(t);

    await openExport(page, 'Mermaid');
    const mmd = (await download(page, () => primary(page).click())).text();
    expect(mmd).not.toMatch(/@ref (dPay|d3ds)/);
    expect(mmd).toMatch(/@ref dCo/);
    expect((mmd.match(/actor U\b/g) || []).length).toBe(1); // User birleşti
    expect(mmd).toMatch(/participant G_2 as Bank Gateway/); // kimlik çakışması
    expect(await getCode(page)).toBe(saved); // kayıtlı diyagram değişmedi
  });

  test('klasör ZIP: yapı, Türkçe adlar, hatalı diyagram raporu ve içine çizilmiş referanslar', async ({ context }) => {
    const all = docs();
    all.push(doc('dBad', 'Bozuk', seq('A->>B: x\nend\nloop\n'), { folder: 'fS' }));
    await seed(context, { docs: all, folders, current: 'dPlain', settings: { exp: { format: 'svg', scale: 1, bg: 'theme', refs: 'inline' } } });
    const page = await openApp(context);
    await page.click('#btnDocs');
    const head = page.locator('.folder-head', { has: page.locator('.fh-name', { hasText: /^Ödeme$/ }) });
    await head.hover();
    await head.locator('button[title="Klasörü dışa aktar"]').click();
    await expect(page.locator('.fx-info')).toContainText('4 diyagram · 1 alt klasör');
    const zip = await download(page, () => primary(page).click());
    expect(zip.name).toBe('Ödeme.zip');
    const files = readZip(zip.buffer());
    expect(Object.keys(files).sort()).toEqual(['Ödeme/', 'Ödeme/Checkout.svg', 'Ödeme/Kart-3DS/', 'Ödeme/Kart-3DS/3DS doğrulama.svg', 'Ödeme/_hatalar.txt', 'Ödeme/Ödeme akışı.svg']);
    expect(files['Ödeme/Checkout.svg'].toString()).toContain('challenge');
    expect(files['Ödeme/_hatalar.txt'].toString()).toMatch(/# Ödeme\/Kart-3DS\/Bozuk\n\s+Parse error/);
  });
});
