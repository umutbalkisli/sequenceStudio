// C4 mimari görünümü (assets/js/lib/c4.js) birim testleri.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../assets/js/lib/model.js');
const C4 = require('../../assets/js/lib/c4.js');

// Ödeme sistemi › (Ledger › Ledger API, Ledger DB), (Gateway); Sipariş sistemi › Order API; Müşteri (kişi)
const ITEMS = [
  { id: 'pay', name: 'Ödeme', role: 'ext' },
  { id: 'ledger', name: 'Ledger', role: 'svc', parent: 'pay' },
  { id: 'ledger-api', name: 'Ledger API', role: 'svc', parent: 'ledger' },
  { id: 'ledger-db', name: 'Ledger DB', role: 'db', parent: 'ledger' },
  { id: 'gw', name: 'Gateway', role: 'svc', parent: 'pay' },
  { id: 'orders', name: 'Sipariş', role: 'ext' },
  { id: 'order-api', name: 'Order API', role: 'svc', parent: 'orders' },
  { id: 'customer', name: 'Müşteri', role: 'user' },
];
const roleType = (r) => ({ user: 'actor', db: 'database' }[r] || 'participant');
const p = (id, item) => `%% @item ${item}\nparticipant ${id}\n`;
const docs = [
  { id: 'd1', model: M.parse('sequenceDiagram\n' + p('C', 'customer') + p('O', 'order-api') + p('G', 'gw') + p('L', 'ledger-api') + p('D', 'ledger-db') + 'participant X\n'
    + 'C->>O: sipariş ver\nO->>G: öde\nG->>L: kaydet\nL->>D: insert\nD-->>L: ok\nL-->>G: ok\nG-->>O: ok\nO->>X: bilinmeyen\nalt tekrar\nO->>G: öde\nend\n') },
  { id: 'd2', model: M.parse('sequenceDiagram\n' + p('O', 'order-api') + p('L', 'ledger-api') + 'O->>L: bakiye\n') },
];
const rels = C4.relations(ITEMS, docs);
const edges = (v) => v.edges.map((e) => `${e.from}>${e.to}: ${e.labels.map((l) => l.text + (l.n > 1 ? '×' + l.n : '')).join(', ')}`).sort();
const nodes = (v) => v.nodes.map((n) => `${n.id}${n.outer ? '(dış)' : ''}:${n.level}`).sort();

describe('C4 görünümü', () => {
  test('ilişkiler mesajlardan türetilir; yanıtlar ve kataloğa bağlı olmayanlar sayılmaz', () => {
    const r = rels.map((x) => `${x.from}>${x.to}:${x.labels.map((l) => l.text + '×' + l.n).join(',')}:${x.docs.join(',')}`).sort();
    assert.deepEqual(r, [
      'customer>order-api:sipariş ver×1:d1',
      'gw>ledger-api:kaydet×1:d1',
      'ledger-api>ledger-db:insert×1:d1',
      'order-api>gw:öde×2:d1',
      'order-api>ledger-api:bakiye×1:d2',
    ]);
    assert.equal(rels.unlinked, 1);
  });

  test('C1: kökler (sistemler ve kişiler); ilişkiler sistem düzeyine toplanır', () => {
    const v = C4.view(ITEMS, rels, null, roleType);
    assert.deepEqual(nodes(v), ['customer:person', 'orders:system', 'pay:system']);
    assert.deepEqual(edges(v), ['customer>orders: sipariş ver', 'orders>pay: öde×2, bakiye']);
  });

  test('C2: sistemin konteynerleri içeride; dış sistemler ortak atadan sonraki düzeyde', () => {
    const v = C4.view(ITEMS, rels, 'pay', roleType);
    assert.deepEqual(nodes(v), ['gw:component', 'ledger:container', 'orders(dış):system']);
    assert.deepEqual(edges(v), ['gw>ledger: kaydet', 'orders>gw: öde×2', 'orders>ledger: bakiye']);
    assert.equal(v.focusLevel, 'system');
  });

  test('C3: konteynerin bileşenleri; komşu konteyner ve dış sistem dışarıda', () => {
    const v = C4.view(ITEMS, rels, 'ledger', roleType);
    assert.deepEqual(nodes(v), ['gw(dış):component', 'ledger-api:component', 'ledger-db:component', 'orders(dış):system']);
    assert.deepEqual(edges(v), ['gw>ledger-api: kaydet', 'ledger-api>ledger-db: insert', 'orders>ledger-api: bakiye']);
    assert.deepEqual(v.path.map((x) => x.id), ['pay', 'ledger']);
  });

  test('ilişkisi olmayan iç öğeler de gösterilir; Mermaid kodu sınır ve kenar etiketleriyle üretilir', () => {
    const v = C4.view(ITEMS, [], 'pay', roleType);
    assert.deepEqual(nodes(v), ['gw:component', 'ledger:container']);
    const v2 = C4.view(ITEMS, rels, 'pay', roleType);
    const { code, ids } = C4.toMermaid(v2, {
      name: (x) => x.name, roleOf: (x) => ({ type: roleType(x.role), color: '#2fbf7f' }), levelLabel: (l) => '[' + l + ']', maxLabels: 1,
    });
    assert.match(code, /^flowchart LR\n {2}subgraph focus\["`\*\*Ödeme\*\* \[system\]`"\]\n/);
    assert.match(code, /n\d\(\["`\*\*Sipariş\*\*\n\[system\]`"\]\)|n\d\("`\*\*Sipariş\*\*\n\[system\]`"\)/);
    assert.match(code, /-->\|"`öde`"\|/);
    assert.match(code, /stroke-dasharray:5 3/); // dış öğe kesikli
    assert.equal(ids.size, 3);
  });
});
