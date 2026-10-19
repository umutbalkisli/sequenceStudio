// Diyagramlar arası bağlantı (ref) ve paylaşım linki.
import zlib from 'node:zlib';
import { test, expect, seed, openApp, getCode, setView, openDocFromDrawer, doc, seq } from './helpers.mjs';

const refDocs = () => [
  doc('dPay', 'Ödeme akışı', seq('participant G as Gateway\nparticipant P as Payment\nG->>P: charge\nP-->>G: ok\n'), { updated: Date.now() - 1000 }),
  doc('dCo', 'Checkout', seq('actor U as User\nparticipant G as Gateway\nparticipant O as Order\nU->>G: checkout\nalt boş kol\nend\nNote over G: normal not\nG->>O: create\n'), { updated: Date.now() - 500 }),
  doc('dOther', 'Kayıt', seq('A->>B: x\n'), { updated: Date.now() - 5000 }),
];
/** Koddaki referans notu (bir "%% @ref" satırının hemen arkasındaki not) */
const refLine = async (page) => (await getCode(page)).match(/%% @ref \S+\n\s*(Note over [^:]*: .*)/)?.[1];

test.describe('referans', () => {
  test('tek katılımcıya eklenir; genişletilebilir ve geri alınabilir', async ({ context }) => {
    await seed(context, { docs: refDocs(), current: 'dCo' });
    const page = await openApp(context);
    await page.locator('.step-message').last().click({ position: { x: 5, y: 5 } }); // seçili: G->>O
    await page.locator('#palSteps .chip', { hasText: 'Referans' }).click();
    expect(await getCode(page)).toMatch(/%% @ref dPay\n\s*Note over O: Ödeme akışı/);

    await page.locator('.step-ref .ref-span').click();
    expect(await refLine(page)).toBe('Note over O,G: Ödeme akışı');
    await page.locator('.step-ref .pselect').nth(1).click();
    await page.locator('.pcombo-opt', { hasText: '—' }).click();
    expect(await refLine(page)).toBe('Note over O: Ödeme akışı');
  });

  test('önizlemede işaretli çizilir; tıklayınca açılır ve geri dönülür', async ({ context }) => {
    const docs = refDocs();
    docs[1].code = docs[1].code.replace('G->>O: create\n', 'G->>O: create\n%% @ref dPay\nNote over O: Ödeme akışı\n');
    await seed(context, { docs, current: 'dCo' });
    const page = await openApp(context);
    await expect(page.locator('.paper g.ref-note text.noteText')).toHaveText('↗ Ödeme akışı');

    // Boş kol (yer tutucu not) varken normal nota tıklama doğru adımı seçer
    await page.locator('.paper g[data-et=note]', { hasText: 'normal not' }).locator('text').first().click();
    await expect(page.locator('#flow .step.selected textarea')).toHaveValue('normal not');

    await page.locator('.paper g.ref-note text.noteText').click();
    await expect(page.locator('#docName')).toHaveValue('Ödeme akışı');
    await expect(page.locator('#navBack')).toContainText('Checkout');
    await page.click('#navBack');
    await expect(page.locator('#docName')).toHaveValue('Checkout');
    await expect(page.locator('#navBack')).toBeHidden();
  });

  test('hedef yeniden adlandırılınca etiket güncellenir; elle etiket korunur; silinen hedef kopuk görünür', async ({ context }) => {
    const docs = refDocs();
    docs[1].code += '%% @ref dPay\nNote over O: Ödeme akışı\n';
    await seed(context, { docs, current: 'dPay' });
    const page = await openApp(context);
    page.on('dialog', (d) => d.accept());
    await page.fill('#docName', 'Ödeme akışı v2');
    await page.locator('#docName').press('Enter');
    await expect(page.locator('.toast').last()).toContainText('güncellendi');
    await openDocFromDrawer(page, 'Checkout');
    expect(await refLine(page)).toBe('Note over O: Ödeme akışı v2');

    await page.locator('.step-ref textarea.text-input').fill('Ödeme detayları');
    await page.locator('.step-ref .ref-select').selectOption('dOther');
    expect(await getCode(page)).toMatch(/@ref dOther\n\s*Note over O: Ödeme detayları/);

    await page.click('#btnDocs');
    const item = page.locator('.doc-item', { hasText: 'Kayıt' });
    await item.hover();
    await item.locator('button[title="Sil"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.paper g.ref-note.ref-broken text.noteText')).toHaveText('✕ Ödeme detayları');
    await expect(page.locator('.step-ref.ref-broken')).toHaveCount(1);
    await page.locator('.paper g.ref-note text.noteText').click();
    await expect(page.locator('.toast.err').last()).toContainText('bulunamadı');
  });
});

test.describe('paylaşım linki', () => {
  const NAME = 'Abu merchant listesi — ödeme akışı';
  const CODE = seq('    actor U as User\n    participant M as Mobile<br/>App\n\n    U->>M: list\n    alt ok\n        M-->>U: ✓\n    end\n');

  /** Linki "Paylaşım linki" düğmesinden al (pano reddedilir → prompt'tan okunur) */
  async function shareUrl(page) {
    let url = null;
    page.on('dialog', async (d) => { if (d.type() === 'prompt') { url = d.defaultValue(); await d.dismiss(); } else await d.accept(); });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('x')) }, configurable: true }));
    await page.click('#btnExport');
    await page.locator('.export-actions button', { hasText: 'Paylaşım linki' }).click();
    await expect.poll(() => url).not.toBeNull();
    return url;
  }

  test('yeni biçim: ad linkin içinde; açılınca ad ve kod birebir aynı', async ({ context, browser }) => {
    await seed(context, { docs: [doc('d1', NAME, CODE)], current: 'd1' });
    const page = await openApp(context);
    const original = await getCode(page);
    const url = await shareUrl(page);
    const hash = url.split('#')[1];
    expect(hash).toMatch(/^s=y/);
    expect(hash).not.toContain('&n=');

    const other = await browser.newContext();
    const p2 = await openApp(other, { hash });
    await expect(p2.locator('#docName')).toHaveValue(NAME);
    expect(await getCode(p2)).toBe(original);
    await other.close();
  });

  test('eski biçimdeki link açılmaya devam eder', async ({ context }) => {
    const b64 = zlib.deflateRawSync(Buffer.from(CODE)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const page = await openApp(context, { hash: 's=z' + b64 + '&n=' + encodeURIComponent(NAME) });
    await expect(page.locator('#docName')).toHaveValue(NAME);
    // Açılan diyagrama otomatik aktivasyon uygulanır; içerik eksiksiz gelmeli
    const code = await getCode(page);
    for (const line of ['actor U as User', 'participant M as Mobile<br/>App', 'U->>', 'alt ok', ': ✓']) expect(code).toContain(line);
  });

  test('çok uzun linkte uyarı verilir', async ({ context }) => {
    let code = 'sequenceDiagram\n';
    // Rastgele metin iyi sıkışmaz: ~450 satır, sıkıştırılmış link 8.000 karakter eşiğini rahatça aşar
    for (let i = 0; i < 450; i++) code += 'A->>B: ' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + '\n';
    await seed(context, { docs: [doc('d1', 'Uzun', code)], current: 'd1' });
    const page = await openApp(context);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true }));
    await page.click('#btnExport');
    await page.locator('.export-actions button', { hasText: 'Paylaşım linki' }).click();
    await expect(page.locator('.toast.err').filter({ hasText: 'çok uzun' })).toBeVisible();
  });
});

