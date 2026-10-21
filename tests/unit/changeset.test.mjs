// Değişiklik kümesi (assets/js/lib/changeset.js) birim testleri: revizyon, sıra, silme izi.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../assets/js/lib/changeset.js');

const at = (now, by = 'u1') => ({ now, by });
const summary = (puts) => puts.map((p) => `${p.id}@${p.meta.rev}${p.meta.deleted ? ' sil' : ''}:${p.pos}`);

describe('değişiklik kümesi', () => {
  test('ilk yazmada her öğe rev 1; değişmeyen öğe yazılmaz; değişen ve sırası değişen rev artar', () => {
    let { puts, next } = C.diff(new Map(), [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], at(10));
    assert.deepEqual(summary(puts), ['a@1:0', 'b@1:1']);
    assert.deepEqual(puts[0].meta, { rev: 1, createdAt: 10, createdBy: 'u1', updatedAt: 10, updatedBy: 'u1' });
    ({ puts, next } = C.diff(next, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], at(20)));
    assert.deepEqual(puts, []);
    ({ puts, next } = C.diff(next, [{ id: 'b', n: 3 }, { id: 'a', n: 1 }], at(30, 'u2')));
    assert.deepEqual(summary(puts), ['b@2:0', 'a@2:1']);
    assert.deepEqual(puts[0].meta, { rev: 2, createdAt: 10, createdBy: 'u1', updatedAt: 30, updatedBy: 'u2' });
  });

  test('listeden çıkan öğe silme izi bırakır; geri gelirse yeniden yaşar; iz bir kez yazılır', () => {
    let { next } = C.diff(new Map(), [{ id: 'a' }, { id: 'b' }], at(1));
    let puts;
    ({ puts, next } = C.diff(next, [{ id: 'a' }], at(2)));
    assert.deepEqual(summary(puts), ['b@2 sil:1']);
    assert.equal(puts[0].data, null);
    assert.deepEqual(C.deletedIds(next), ['b']);
    ({ puts, next } = C.diff(next, [{ id: 'a' }], at(3)));
    assert.deepEqual(puts, []);
    ({ puts } = C.diff(next, [{ id: 'a' }, { id: 'b', back: true }], at(4)));
    assert.deepEqual(summary(puts), ['b@3:1']);
    assert.ok(!('deleted' in puts[0].meta));
  });

  test('sırasız koleksiyonda başa ekleme yalnızca yeni öğeyi yazar', () => {
    const { next } = C.diff(new Map(), [{ id: 'a' }, { id: 'b' }], { now: 1, by: 'u', ordered: false });
    const { puts } = C.diff(next, [{ id: 'c' }, { id: 'a' }, { id: 'b' }], { now: 2, by: 'u', ordered: false });
    assert.deepEqual(summary(puts), ['c@1:0']);
  });

  test('kayıtlardan durum ve sıralı canlı liste kurulur; silinenler listede yok', () => {
    const recs = [
      { id: 'b', pos: 1, data: { id: 'b' }, meta: { rev: 1 } },
      { id: 'a', pos: 0, data: { id: 'a' }, meta: { rev: 2 } },
      { id: 'x', pos: 2, data: null, meta: { rev: 3, deleted: true } },
    ];
    const { state, items } = C.fromRecords(recs);
    assert.deepEqual(items.map((e) => e.id), ['a', 'b']);
    assert.equal(state.size, 3);
    assert.deepEqual(C.diff(state, items, at(5)).puts, []); // yeniden yazmaya gerek yok
  });
});
