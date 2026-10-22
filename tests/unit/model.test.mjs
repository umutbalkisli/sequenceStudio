// Model katmanı (assets/js/model.js) birim testleri: tarayıcı gerektirmez.
// Çalıştırma: npm run test:unit
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../assets/js/lib/model.js');

const seq = (body) => 'sequenceDiagram\n' + body;
/** Ayrıştırıp yeniden yazar; ikinci tur aynı çıktıyı vermeli (kararlılık). */
function roundTrip(code) {
  const once = M.serialize(M.parse(code));
  assert.equal(M.serialize(M.parse(once)), once, 'serialize(parse(x)) kararlı olmalı');
  return once;
}
const items = (model, kind) => { const out = []; M.walk(model.items, (it) => { if (it.kind === kind) out.push(it); }); return out; };

describe('ayrıştırma ve yazma', () => {
  test('katılımcı, tip, box ve takma ad korunur', () => {
    const out = roundTrip(seq('actor U as User\nbox Aqua Backend\nparticipant G@{ "type": "collections" } as Gateway\nend\nU->>G: hi\n'));
    const m = M.parse(out);
    assert.deepEqual(m.participants.map((p) => [p.id, p.type, p.label]), [['U', 'actor', 'User'], ['G', 'collections', 'Gateway']]);
    assert.equal(m.boxes.length, 1);
  });

  test('# ve ; mesaj metninde kaçışlanır', () => {
    const m = M.parse(seq('A->>B: a#59; b#35;c\n'));
    assert.equal(items(m, 'message')[0].text, 'a; b#c');
    assert.match(M.serialize(m), /a#59; b#35;c/);
  });

  test('çok satırlı metin: <br>, <br/>, <br /> → \\n; yazarken <br/>', () => {
    const m = M.parse(seq('participant P as Ödeme<br>Servisi\nA->>P: bir<br />iki<br/>üç\nNote over A: not<BR>satır\n'));
    assert.equal(m.participants.find((p) => p.id === 'P').label, 'Ödeme\nServisi');
    assert.equal(items(m, 'message')[0].text, 'bir\niki\nüç');
    assert.equal(items(m, 'note')[0].text, 'not\nsatır');
    const out = M.serialize(m);
    assert.match(out, /as Ödeme<br\/>Servisi/);
    assert.match(out, /bir<br\/>iki<br\/>üç/);
  });
});

describe('Studio yönergeleri (%% @…)', () => {
  test('@color bloğa ve katılımcıya bağlanır', () => {
    const out = roundTrip(seq('%% @color #e5484d\nparticipant A\n%% @color #2fbf7f\nloop L\nA->>A: x\nend\n'));
    const m = M.parse(out);
    assert.equal(m.participants[0].color, '#e5484d');
    assert.equal(items(m, 'block')[0].color, '#2fbf7f');
  });

  test('@role, @color ile birlikte katılımcının üstünde durur', () => {
    const m = M.parse(roundTrip(seq('%% @role gateway\n%% @color #f0a020\nparticipant G@{ "type": "collections" } as API Gateway\n')));
    assert.equal(m.participants[0].role, 'gateway');
    assert.equal(m.participants[0].color, '#f0a020');
  });

  test('@item, @role ve @color ile birlikte katılımcıya bağlanır; @itemdef/@roledef taşınır', () => {
    const out = roundTrip(seq('%% @itemdef ledger {"name":"Ledger","role":"database","parent":"pay"}\n%% @item ledger\n%% @role database\n%% @color #f97a3c\nparticipant D@{ "type": "database" } as Ledger DB\n'));
    const m = M.parse(out);
    assert.equal(m.participants[0].item, 'ledger');
    assert.equal(m.participants[0].role, 'database');
    assert.deepEqual(m.itemDefs, { ledger: { name: 'Ledger', role: 'database', parent: 'pay' } });
    assert.match(out, /%% @item ledger\n\s*%% @role database\n\s*%% @color #f97a3c\n\s*participant D/);
    // Katılımcı önünde değilse yorum olarak kalır
    assert.equal(items(M.parse(seq('%% @item x\nA->>B: y\n')), 'raw').length, 1);
  });

  test('@tone mesaja bağlanır; mesaj önünde değilse yorum olarak kalır', () => {
    const m = M.parse(seq('%% @tone error\nA->>B: x\n%% @tone info\nNote over A: n\n'));
    assert.equal(items(m, 'message')[0].tone, 'error');
    assert.deepEqual(items(m, 'raw').map((r) => r.text), ['%% @tone info']);
  });

  test('@ref yalnızca notun önünde tanınır', () => {
    const m = M.parse(roundTrip(seq('%% @ref dPay\nNote over A,B: Ödeme akışı\n%% @ref dX\nA->>B: x\n')));
    assert.equal(items(m, 'note')[0].ref, 'dPay');
    assert.deepEqual(items(m, 'raw').map((r) => r.text), ['%% @ref dX']);
  });

  test('@roledef ayrı alanda tutulur ve başa yazılır', () => {
    const def = { name: 'API Gateway', type: 'collections', color: '#f0a020', prefix: '', suffix: ' Gateway' };
    const out = roundTrip(seq(`%% @roledef gateway ${JSON.stringify(def)}\n%% @role gateway\nparticipant G as Public Gateway\n`));
    assert.deepEqual(M.parse(out).roleDefs, { gateway: def });
    assert.match(out.split('\n')[1], /^\s*%% @roledef gateway /);
  });

  test('@auto ardışık aktivasyon grubunu işaretler; boş satır grubu bitirir', () => {
    const m = M.parse(seq('A->>B: x\n%% @auto\nactivate B\ndeactivate B\n\nactivate A\n'));
    assert.deepEqual(items(m, 'activation').map((a) => !!a.auto), [true, true, false]);
  });

  test('otomatik grubun hemen arkasındaki elle aktivasyon yazıp okuyunca elle kalır', () => {
    const m = M.parse(seq('A->>B: x\n'));
    m.items.push({ uid: 'a1', kind: 'activation', action: 'activate', participant: 'B', auto: true },
      { uid: 'a2', kind: 'activation', action: 'activate', participant: 'A' });
    const back = M.parse(M.serialize(m));
    assert.deepEqual(items(back, 'activation').map((a) => !!a.auto), [true, false]);
  });
});

describe('otomatik aktivasyon (inferActivations)', () => {
  /** Çıkarım yapar; sonuç kararlı olmalı (ikinci çalıştırma değişiklik üretmez). */
  function infer(body) {
    const m = M.parse(seq(body));
    M.inferActivations(m);
    const out = M.serialize(m);
    const again = M.parse(out);
    assert.equal(M.inferActivations(again), false, 'ikinci çıkarım değişiklik üretmemeli');
    assert.equal(M.serialize(again), out);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  test('alt: her kolda yanıt → else başında yeniden aktive edilir', () => {
    const l = infer('A->>B: req\nalt ok\nB-->>A: ok\nelse fail\nB-->>A: fail\nend\n');
    assert.deepEqual(l.slice(1), ['A->>+B: req', 'alt ok', 'B-->>-A: ok', 'else fail', '%% @auto', 'activate B', 'B-->>-A: fail', 'end']);
  });

  test('erken dönüş + blok sonrası yanıt', () => {
    const l = infer('A->>B: req\nalt hit\nB-->>A: cached\nelse miss\nB->>D: q\nD-->>B: rows\nend\nB-->>A: result\n');
    assert.ok(l.includes('B-->>-A: cached') && l.includes('B-->>-A: result'));
    assert.equal(l[l.indexOf('else miss') + 2], 'activate B');
  });

  test('opt: blok sonrası durum düzeltilir', () => {
    const l = infer('A->>B: req\nopt invalid\nB-->>A: 400\nend\nB-->>A: 200\n');
    assert.deepEqual(l.slice(l.indexOf('end')), ['end', '%% @auto', 'activate B', 'B-->>-A: 200']);
  });

  test('break: girilmeyen yoldan devam edilir', () => {
    const l = infer('A->>B: req\nbreak timeout\nB-->>A: 504\nend\nB-->>A: 200\n');
    assert.ok(l.includes('activate B') && l.includes('B-->>-A: 200'));
  });

  test('yanıtsız kol: kolun sonunda kapatılır', () => {
    const l = infer('A->>B: req\nalt ok\nB-->>A: ok\nelse fail\nB->>D: log\nend\n');
    const i = l.indexOf('else fail');
    assert.deepEqual(l.slice(i + 1, i + 6), ['%% @auto', 'activate B', 'B->>D: log', '%% @auto', 'deactivate B']);
  });

  test('elle yazılmış aktivasyonlar korunur', () => {
    const l = infer('activate A\nA->>B: req\nB-->>A: ok\ndeactivate A\n');
    assert.equal(l[1], 'activate A');
    assert.equal(l[l.length - 1], 'deactivate A');
  });

  test('yanıtı olmayan çağrı aktive edilmez', () => {
    const l = infer('A->>B: fire\nA->>B: and forget\n');
    assert.ok(!l.some((x) => /[+-][A-Z]/.test(x.split(':')[0].replace(/->>|-->>/g, ''))));
  });
});

describe('önizleme yardımcıları', () => {
  test('previewSafeModel boş kollara yer tutucu not ekler, girdiyi değiştirmez', () => {
    const m = M.parse(seq('A->>B: x\nalt boş\nend\n'));
    const safe = M.previewSafeModel(m);
    assert.equal(items(safe, 'note').length, 1);
    assert.equal(items(m, 'note').length, 0);
    assert.equal(M.previewSafeModel(M.parse(seq('A->>B: x\n'))), null);
  });
});

describe('referansları açma (expandRefs)', () => {
  const docs = {
    co: { name: 'Checkout', code: seq('actor U as User\nparticipant G as Gateway\nparticipant O as Order\nU->>G: checkout\nG->>O: create\n%% @ref pay\nNote over O: Ödeme\nO-->>G: 201\n') },
    pay: { name: 'Ödeme akışı', code: seq('participant O as Order\nparticipant P as Payment\nparticipant G as Bank Gateway\nO->>P: charge\nalt 3DS\n%% @ref tds\nNote over P: 3DS\nend\nP-->>O: paid\n') },
    tds: { name: '3DS', code: seq('participant P as Payment\nactor U as User\nP->>U: challenge\n%% @ref co\nNote over U: geri\n') },
  };
  const resolve = (id) => (docs[id] ? { name: docs[id].name, model: M.parse(docs[id].code) } : null);
  const expand = () => M.expandRefs(M.parse(docs.co.code), resolve, { rootId: 'co' });

  test('iç içe referanslar açılır, döngü bağlantı olarak kalır', () => {
    const r = expand();
    assert.deepEqual(r.included.map((x) => [x.name, x.depth]), [['Ödeme akışı', 1], ['3DS', 2]]);
    assert.deepEqual(r.cycles, ['Checkout']);
    const msgs = items(r.model, 'message').map((x) => x.text);
    assert.deepEqual(msgs, ['checkout', 'create', 'charge', 'challenge', 'paid', '201']);
  });

  test('aynı adlı katılımcılar birleşir; yeniler bağlı katılımcının sağına eklenir', () => {
    const ids = expand().model.participants.map((p) => p.label);
    assert.deepEqual(ids, ['User', 'Gateway', 'Order', 'Payment', 'Bank Gateway']);
  });

  test('kimlik çakışması yeniden adlandırılır ve mesajlar güncellenir', () => {
    const m = expand().model;
    const bank = m.participants.find((p) => p.label === 'Bank Gateway');
    assert.equal(bank.id, 'G_2');
    assert.equal(m.participants.find((p) => p.label === 'Gateway').id, 'G');
  });

  test('aynı katalog öğesine bağlı katılımcılar adları farklı olsa da birleşir', () => {
    const host = M.parse(seq('%% @item ledger\nparticipant L as Ledger Service\nparticipant U\nU->>L: kaydet\n%% @ref d\nNote over L: Detay\n'));
    const sub = M.parse(seq('%% @item ledger\nparticipant Svc as Defter\nparticipant DB\nSvc->>DB: insert\n'));
    const m = M.expandRefs(host, (id) => (id === 'd' ? { name: 'Detay', model: sub } : null)).model;
    assert.deepEqual(m.participants.map((p) => p.id), ['L', 'DB', 'U']);
    assert.ok(items(m, 'message').some((x) => x.from === 'L' && x.to === 'DB'));
  });

  test('"expand" soneki korunur; seçmeli açma yol anahtarlarıyla yapılır; açılan öğeler işaretlenir', () => {
    const src = seq('participant O as Order\n%% @ref pay expand\nNote over O: Ödeme\n%% @ref pay\nNote over O: Tekrar\n');
    assert.match(roundTrip(src), /%% @ref pay expand\n\s*Note over O: Ödeme\n\s*%% @ref pay\n\s*Note over O: Tekrar/);
    const m = M.parse(src);
    assert.deepEqual(items(m, 'note').map((n) => !!n.expand), [true, false]);
    const keys = [];
    const r = M.expandRefs(m, resolve, { rootId: 'co', shouldExpand: (n, k) => { keys.push(k); return !!n.expand; } });
    // İlk not açıldı (içindeki 3DS referansı kendi bayrağına göre kapalı kaldı), ikincisi not olarak durdu
    assert.deepEqual(keys, ['/pay#1', '/pay#1/tds#1', '/pay#2']);
    const notes = items(r.model, 'note');
    assert.deepEqual(notes.filter((n) => n.ref).map((n) => [n.text, n.refKey, !!n.refHeader]),
      [['Ödeme', '/pay#1', true], ['3DS', '/pay#1/tds#1', false], ['Tekrar', '/pay#2', false]]);
    assert.ok(items(r.model, 'message').every((x) => x.fromRef === 'pay'));
  });

  test('açılan referansın başlığı not metnidir (açıklama); not boşsa akışın adı', () => {
    const r = M.expandRefs(M.parse(seq('participant O as Order\n%% @ref pay\nNote over O: Kart ödemesi\n%% @ref pay\nNote over O: \n')), resolve, { shouldExpand: (n, k) => k.split('/').length === 2 }); // yalnızca ilk düzey
    assert.deepEqual(items(r.model, 'note').filter((n) => n.refHeader).map((n) => n.text), ['Kart ödemesi', 'Ödeme akışı']);
  });

  test('eksik hedef raporlanır; girdi model değişmez', () => {
    const src = M.parse(seq('%% @ref yok\nNote over A: x\n'));
    const before = M.serialize(src);
    const r = M.expandRefs(src, () => null);
    assert.deepEqual(r.missing, ['yok']);
    assert.equal(M.serialize(src), before);
  });

  test('açılmış model geçerli koda yazılır (kararlı)', () => {
    roundTrip(M.serialize(expand().model));
  });
});
