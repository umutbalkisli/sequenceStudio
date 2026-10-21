// Görsel oluşturucu ve çalışma alanı: palet, katılımcı seçici, tonlar, renkler, çok satırlı metin,
// sabitleme/kaydırma, palet modları ve iç içe klasörler.
import { test, expect, seed, openApp, getCode, setView, idbDump, doc, seq } from './helpers.mjs';

const basic = () => [doc('d1', 'Checkout', seq('actor U as User\nparticipant G as Gateway\nparticipant O as Order Service\nparticipant P as Ödeme Servisi\nU->>G: checkout\nG->>O: create\nNote over G: n\n'))];
const steps = (page) => page.locator('#stepCount');

test.describe('palet', () => {
  test('tıklama ve sürükle-bırak ile adım ve katılımcı eklenir', async ({ context }) => {
    await seed(context, { docs: basic(), current: 'd1', settings: { palCompact: false } });
    const page = await openApp(context);
    await expect(steps(page)).toHaveText('3');
    await page.locator('#palSteps .chip', { hasText: 'Loop' }).click();
    await expect(steps(page)).toHaveText('4');
    await page.locator('#palSteps .chip', { hasText: 'Not' }).dragTo(page.locator('#flow .step').first());
    await expect(steps(page)).toHaveText('5');
    await page.locator('#palRoles .role-chip', { hasText: 'Veritabanı' }).dragTo(page.locator('#participants .pcard').first());
    await page.keyboard.press('Escape');
    await expect(page.locator('.pcard')).toHaveCount(5);
  });

  test('kompakt mod hatırlanır; kod görünümünde palet devre dışı ama yerinde', async ({ context }) => {
    await seed(context, { docs: basic(), current: 'd1', settings: { palCompact: false } });
    const page = await openApp(context);
    await page.click('#btnPalToggle');
    await expect(page.locator('#palette')).toHaveClass(/compact/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.settings')).palCompact)).toBe(true);
    const before = await page.locator('#paneEditor').boundingBox();
    await setView(page, 'code');
    await expect(page.locator('.pal-off-note')).toBeVisible();
    expect((await page.locator('#paneEditor').boundingBox()).height).toBe(before.height); // panel zıplamaz
  });
});

test.describe('katılımcı seçici', () => {
  test('Türkçe duyarsız arama, kelime başı eşleşme, klavye ve hızlı ekleme', async ({ context }) => {
    await seed(context, { docs: basic(), current: 'd1' });
    const page = await openApp(context);
    const first = page.locator('.step-message').first();
    await first.locator('.pselect').nth(1).click();
    await page.keyboard.type('odeme');
    await expect(page.locator('.pcombo-opt').first()).toContainText('Ödeme Servisi');
    await page.keyboard.press('Enter');
    expect(await getCode(page)).toContain('U->>P: checkout');

    await first.locator('.pselect').nth(0).click();
    await page.keyboard.type('serv');
    await expect(page.locator('.pcombo-opt')).toHaveCount(3); // Order Service, Ödeme Servisi + "Ekle"
    await page.keyboard.press('Escape');
    await expect(page.locator('.pcombo')).toHaveCount(0);

    await first.locator('.pselect').nth(1).click();
    await page.keyboard.type('Fraud Engine');
    await page.keyboard.press('Enter');
    const code = await getCode(page);
    expect(code).toContain('participant FraudEngine as Fraud Engine');
    expect(code).toContain('U->>FraudEngine: checkout');
  });
});

test.describe('renkler ve tonlar', () => {
  test('ok tonu koda, builder\'a ve önizlemeye yansır; kaydırma yerinde kalır', async ({ context }) => {
    let code = 'participant A\nparticipant B\n';
    for (let i = 0; i < 30; i++) code += `A->>B: req ${i}\nB-->>A: res ${i}\n`;
    await seed(context, { docs: [doc('d1', 'Uzun', seq(code))], current: 'd1' });
    const page = await openApp(context);
    // 28. mesaj görünür olacak kadar aşağı kaydır (tıklama ek kaydırma gerektirmesin)
    const top = await page.evaluate(() => {
      const s = document.querySelector('#builderScroll');
      const r = document.querySelectorAll('.step-message')[28];
      s.style.scrollBehavior = 'auto';
      s.scrollTop += r.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight / 2;
      s.style.scrollBehavior = '';
      return s.scrollTop;
    });
    expect(top).toBeGreaterThan(1000);
    const row = page.locator('.step-message').nth(28);
    await row.locator('.tone-btn').click();
    await page.locator('.tone-menu .tm-opt', { hasText: 'Hata' }).click();
    await expect(page.locator('.step-message').nth(28)).toHaveClass(/toned/);
    expect(await page.evaluate(() => document.querySelector('#builderScroll').scrollTop)).toBeGreaterThan(top - 60); // kaydırma yerinde
    expect(await getCode(page)).toMatch(/%% @tone error\n\s*A->>\+?B: req 14/);
    // Önizleme kısa bir gecikmeyle yeniden çizilir
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.paper svg [data-et="message"]')[28]?.style.stroke)).toBe('rgb(229, 72, 77)');
  });

  test('blok ve katılımcı için özel renk koda yazılır', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'B', seq('participant A\nparticipant B\nA->>B: x\nalt ok\nB-->>A: y\nend\n'))], current: 'd1' });
    const page = await openApp(context);
    await page.locator('.block-alt > .block-head .block-color').click();
    await page.locator('.color-menu .swatch[title="#ec5a8f"]').click();
    await page.locator('.pcard', { hasText: 'B' }).first().click();
    await page.locator('#popover .pe-colors .swatch[title="#2fbf7f"]').click();
    await page.keyboard.press('Escape');
    const code = await getCode(page);
    expect(code).toMatch(/%% @color #ec5a8f\n\s*alt ok/);
    expect(code).toMatch(/%% @color #2fbf7f\n\s*participant B/);
  });
});

test.describe('metin', () => {
  test('Alt+Enter yeni satır ekler; Mermaid\'e <br/> yazılır; Shift+Enter mesajda yanıt ekler', async ({ context }) => {
    await seed(context, { docs: [doc('d1', 'M', seq('participant U as User\nparticipant S as Server\nU->>S: pay\n'))], current: 'd1' });
    const page = await openApp(context);
    const msg = page.locator('.step-message textarea').first();
    await msg.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Alt+Enter');
    await page.keyboard.type('(amount)');
    await page.keyboard.press('Shift+Enter');
    await expect(steps(page)).toHaveText('2');
    const code = await getCode(page);
    expect(code).toContain('U->>+S: pay<br/>(amount)');
    expect(code).toContain('S-->>-U: ✓'); // yeni yanıt ✓ ile gelir
  });
});

test.describe('katılımcılar bölümü', () => {
  test('varsayılan olarak üste sabitlenir; sabitleme kaldırılabilir ve hatırlanır', async ({ context }) => {
    let code = 'actor U as User\nparticipant G as Public<br/>API<br/>Gateway\n';
    for (let i = 0; i < 25; i++) code += `U->>G: step ${i}\n`;
    await seed(context, { docs: [doc('d1', 'Uzun', seq(code))], current: 'd1' });
    const page = await openApp(context);
    const cardH = await page.locator('.pcard', { hasText: 'Gateway' }).evaluate((c) => c.scrollHeight <= c.clientHeight + 1);
    expect(cardH).toBe(true); // çok satırlı ad taşmaz
    await page.evaluate(() => { const s = document.querySelector('#builderScroll'); s.style.scrollBehavior = 'auto'; s.scrollTop = 900; s.dispatchEvent(new Event('scroll')); });
    await expect(page.locator('#partSection')).toHaveClass(/stuck/);
    await page.click('#btnPinParts');
    await expect(page.locator('#partSection')).not.toHaveClass(/pinned/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seqstudio.settings')).pinParts)).toBe(false);
  });
});
