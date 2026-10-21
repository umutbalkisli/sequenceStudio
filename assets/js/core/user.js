/* Sequence Studio — kullanıcı kimliği
 *
 * Yerel sürümde kullanıcı bu tarayıcıdır: ilk açılışta rastgele bir kimlik üretilir ve localStorage'da saklanır.
 * Kayıtların üstverisindeki createdBy/updatedBy ve sürüm geçmişindeki "by" bu kimliktir; ad isteğe bağlıdır
 * (Ayarlar › Kişisel). Bulut sürümünde kimlik ve ad oturum açan hesaptan gelir; aynı API korunur.
 */
(function (Seq) {
  'use strict';
  const { store } = Seq.core;
  const KEY = 'seqstudio.user';

  const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let me = store.get(KEY, null);
  if (!me || !me.id) { me = { id: newId(), name: '' }; store.set(KEY, me); }

  const id = () => me.id;
  const name = () => me.name || '';
  function rename(v) {
    me = Object.assign({}, me, { name: String(v || '').trim() });
    store.set(KEY, me);
    Seq.core.events.emit('user:changed');
  }
  /** Bir kullanıcı kimliğinin görünen adı: kendisi için ad (yoksa "Siz"); bilinmeyen kimlik olduğu gibi */
  const label = (uid) => (!uid ? '' : uid === me.id ? (me.name || Seq.core.T('user.you')) : uid);

  Seq.user = { id, name, rename, label };
})(window.Seq = window.Seq || {});
