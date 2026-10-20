// Diyagram denetimi (assets/js/lib/lint.js) birim testleri.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../assets/js/lib/model.js');
const L = require('../../assets/js/lib/lint.js');

const seq = (body) => 'sequenceDiagram\n' + body;
/** Kodu denetler; [kural, ilgili öğe] çiftlerini döndürür. Öğe: mesaj/not metni, katılımcı kimliği ya da kol etiketi. */
function lint(code, ctx = {}, only) {
  const m = M.parse(code);
  const byUid = new Map();
  m.participants.forEach((p) => byUid.set(p.uid, p.id));
  M.walk(m.items, (it) => {
    byUid.set(it.uid, it.text != null ? it.text : it.kind + ':' + (it.participant || ''));
    if (it.kind === 'block') it.branches.forEach((b) => byUid.set(b.uid, it.type + ':' + b.label));
  });
  return L.run(m, ctx).filter((x) => !only || only.includes(x.rule)).map((x) => [x.rule, byUid.get(x.uid)]);
}

describe('diyagram denetimi', () => {
  test('temiz diyagramda bulgu yok', () => {
    assert.deepEqual(lint(seq('participant A\nparticipant B\nA->>B: istek\nB-->>A: yanıt\n')), []);
  });

  test('kopuk ve kendine giden bağlantı', () => {
    const code = seq('participant A\nA->>A: x\n%% @ref d2\nNote over A: Hedef\n%% @ref me\nNote over A: Kendisi\n');
    assert.deepEqual(lint(code, { docExists: (id) => id === 'me', selfId: 'me' }, ['brokenRef', 'selfRef']),
      [['brokenRef', 'Hedef'], ['selfRef', 'Kendisi']]);
  });

  test('yanıtsız çağrı: yalnızca yanıt kullanan diyagramda; kuyruk ve kollara bölünmüş yanıt hariç', () => {
    const code = seq([
      'participant A', 'participant B', 'participant Q@{ "type": "queue" }',
      'A->>B: yanıtlı', 'alt ok', 'B-->>A: tamam', 'else hata', 'B-->>A: hata', 'end',
      'A->>B: yanıtsız', 'A->>Q: olay',
    ].join('\n'));
    assert.deepEqual(lint(code, {}, ['unansweredCall']), [['unansweredCall', 'yanıtsız']]);
    // Hiç yanıt yoksa (tek yönlü mesajlaşma) uyarılmaz
    assert.deepEqual(lint(seq('A->>B: bir\nB->>C: iki\n'), {}, ['unansweredCall']), []);
  });

  test('aktivasyon: aktif değilken kapatma hata, kapanmayan uyarı', () => {
    const code = seq('participant A\nparticipant B\ndeactivate B\nactivate A\nA->>B: x\n');
    assert.deepEqual(lint(code, {}, ['inactiveDeactivate', 'unclosedActivation']),
      [['inactiveDeactivate', 'activation:B'], ['unclosedActivation', 'activation:A']]);
    assert.deepEqual(lint(seq('A->>+B: x\nB-->>-A: y\n'), {}, ['inactiveDeactivate', 'unclosedActivation']), []);
  });

  test('otomatik aktivasyonun ürettiği satırlar bulgu üretmez', () => {
    const m = M.parse(seq('participant A\nparticipant B\nA->>B: x\nalt a\nB-->>A: y\nelse b\nB-->>A: z\nend\n'));
    M.inferActivations(m);
    assert.deepEqual(L.run(m, {}).filter((x) => /ctivat/.test(x.rule)), []);
  });

  test('kullanılmayan ve aynı adlı katılımcı', () => {
    const code = seq('participant A as Servis\nparticipant B as servis\nparticipant C\nA->>B: x\nB-->>A: y\n');
    assert.deepEqual(lint(code, {}, ['unusedParticipant', 'duplicateLabel']), [['unusedParticipant', 'C'], ['duplicateLabel', 'B']]);
  });

  test('katalogla eşleşen ama bağlı olmayan katılımcı (eşleştirme işlevi bağlamdan gelir)', () => {
    const code = seq('%% @item db\nparticipant D as Ledger DB\nparticipant L as Ledger\nparticipant X\nL->>D: x\nX->>L: y\n');
    const ctx = { catalogMatch: (p) => (p.label === 'Ledger' ? ['svc', 'db2'] : ['nope']) };
    const m = M.parse(code);
    const out = L.run(m, ctx).filter((x) => x.rule === 'catalogMatch');
    // Bağlı olan (D) sorulmaz; eşleşmesi olanlar raporlanır
    assert.deepEqual(out.map((x) => [x.params.p, x.params.items]), [['L', ['svc', 'db2']], ['X', ['nope']]]);
    assert.deepEqual(L.run(m, {}).filter((x) => x.rule === 'catalogMatch'), []);
  });

  test('boş blok kolu ve metinsiz mesaj', () => {
    const code = seq('A->>B: x\nalt dolu\nB-->>A: y\nelse boş\nend\nloop\nend\nA->>B:\n');
    assert.deepEqual(lint(code, {}, ['emptyBranch', 'emptyMessage']), [['emptyBranch', 'alt:boş'], ['emptyBranch', 'loop:'], ['emptyMessage', '']]);
  });

  test('düzeye göre sıralanır; yeni kural eklenebilir ve hatalı kural diğerlerini durdurmaz', () => {
    L.register({ id: 'boom', level: 'error', check() { throw new Error('x'); } });
    L.register({ id: 'custom', level: 'error', check(m, ctx, report) { report('u1', { n: 1 }); } });
    try {
      const out = L.run(M.parse(seq('A->>B:\n')), {});
      assert.deepEqual(out.map((x) => x.level), ['error', 'info']);
      assert.deepEqual(out[0], { rule: 'custom', level: 'error', uid: 'u1', params: { n: 1 } });
    } finally {
      L.rules.splice(L.rules.findIndex((r) => r.id === 'boom'), 2);
    }
  });
});
