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

  test('kenar, geçtiği akışları ve her akıştaki mesajları taşır; alt öğeler kümesi', () => {
    const v = C4.view(ITEMS, rels, null, roleType);
    const e = v.edges.find((x) => x.from === 'orders' && x.to === 'pay');
    assert.deepEqual(e.flows, [{ doc: 'd1', texts: [{ text: 'öde', n: 2 }] }, { doc: 'd2', texts: [{ text: 'bakiye', n: 1 }] }]);
    assert.deepEqual([...C4.subtree(ITEMS, 'pay')].sort(), ['gw', 'ledger', 'ledger-api', 'ledger-db', 'pay']);
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

describe('C4 türleri', () => {
  // Şirket (grup) › Ödeme alanı (grup) › Ödeme (sistem) › Ledger (konteyner) › Ledger API (bileşen)
  const K = [
    { id: 'co', name: 'Şirketim', role: 'x', kind: 'group' },
    { id: 'area', name: 'Ödeme alanı', role: 'x', kind: 'group', parent: 'co' },
    { id: 'pay', name: 'Ödeme', role: 'svc', kind: 'system', parent: 'area' },
    { id: 'ledger', name: 'Ledger', role: 'svc', kind: 'container', parent: 'pay' },
    { id: 'ledger-api', name: 'Ledger API', role: 'svc', kind: 'component', parent: 'ledger' },
    { id: 'gw', name: 'Gateway', role: 'svc', kind: 'container', parent: 'pay' },
    { id: 'orders', name: 'Sipariş', role: 'svc', kind: 'system', parent: 'co' },
    { id: 'customer', name: 'Müşteri', role: 'user', kind: 'person', parent: 'co' },
    { id: 'stray', name: 'Yalnız DB', role: 'db', kind: 'container' }, // sistemi yok (yanlış yerleşim)
  ];
  const pp = (id, item) => `%% @item ${item}\nparticipant ${id}\n`;
  const kdocs = [{ id: 'd', model: M.parse('sequenceDiagram\n' + pp('C', 'customer') + pp('O', 'orders') + pp('A', 'ledger-api') + pp('G', 'gw') + pp('S', 'stray')
    + 'C->>O: sipariş\nO->>G: öde\nG->>A: kaydet\nA->>S: yaz\n') }];
  const krels = C4.relations(K, kdocs);

  test('C1: gruplar görünmez; tek kök grubun altındaki kişiler ve sistemler gösterilir', () => {
    const v = C4.view(K, krels, null, roleType);
    assert.deepEqual(nodes(v), ['customer:person', 'orders:system', 'pay:system', 'stray:container']);
    assert.deepEqual(edges(v), ['customer>orders: sipariş', 'orders>pay: öde', 'pay>stray: yaz']);
    assert.equal(v.nodes.find((n) => n.id === 'pay').hasChildren, true);
    assert.equal(v.nodes.find((n) => n.id === 'customer').hasChildren, false);
  });

  test('C2/C3 türe göre; konum çubuğunda gruplar atlanır; grup odak olamaz', () => {
    const c2 = C4.view(K, krels, 'pay', roleType);
    assert.equal(c2.focusLevel, 'system');
    assert.deepEqual(c2.path.map((x) => x.id), ['pay']);
    assert.deepEqual(nodes(c2), ['gw:container', 'ledger:container', 'orders(dış):system', 'stray(dış):container']);
    const c3 = C4.view(K, krels, 'ledger', roleType);
    assert.deepEqual(nodes(c3), ['gw(dış):container', 'ledger-api:component', 'stray(dış):container']);
    assert.equal(C4.view(K, krels, 'co', roleType).focus, null);
  });

  test('düz katalog: türü olmayan öğeler kişi/sistem sayılır; varsayılan tür ve yerleşim kuralları', () => {
    const flat = [{ id: 'a', name: 'A', role: 'svc' }, { id: 'u', name: 'U', role: 'user' }];
    assert.deepEqual(nodes(C4.view(flat, [], null, roleType)), ['a:system', 'u:person']);
    assert.equal(C4.defaultKind(null, 'actor'), 'person');
    assert.equal(C4.defaultKind('group', 'participant'), 'system');
    assert.equal(C4.defaultKind('system', 'database'), 'container');
    assert.equal(C4.defaultKind('container', 'participant'), 'component');
    assert.equal(C4.placementIssue('component', 'container'), null);
    assert.deepEqual(C4.placementIssue('component', 'system'), ['container']);
    assert.deepEqual(C4.placementIssue('system', 'container'), [null, 'group']);
    assert.equal(C4.placementIssue('person', null), null);
  });
});
