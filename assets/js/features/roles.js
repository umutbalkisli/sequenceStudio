/* Sequence Studio — roller
 *
 * Rol kütüphanesi (hazır set, ön/son ek), rol düzenleme ekranı, değişikliklerin tüm diyagramlara yayılması,
 * dışa aktarılan koda rol tanımlarını ekleme ve tanımsız rolleri içe alma.
 */
(function (Seq) {
  'use strict';
  const { $, $$, I18N, M, PCOLORS, S, T, add, debounce, downloadBlob, h, ico, openModal, toast, events } = Seq.core;

  // ---------------------------------------------------------------------------
  // Katılımcı rolleri: ad + şekil (tip) + renk + ön/son ek. Kütüphane bu tarayıcıda
  // global tutulur; diyagram koduna "%% @role id" ile birlikte çözülmüş tip ve renk de
  // yazılır, böylece paylaşılan diyagram kütüphane olmadan da aynı görünür.
  // Tip ya da renk elle değiştirilirse katılımcının rol bağlantısı kopar.
  // ---------------------------------------------------------------------------
  const PRESET_ROLES = [
    { id: 'user', tr: 'Kullanıcı', en: 'User', type: 'actor', color: '#6c7cff', prefix: '', suffix: '' },
    { id: 'client', tr: 'İstemci uygulama', en: 'Client app', type: 'boundary', color: '#20b8a6', prefix: '', suffix: ' App' },
    { id: 'gateway', tr: 'API Gateway', en: 'API Gateway', type: 'collections', color: '#f0a020', prefix: '', suffix: ' Gateway' },
    { id: 'service', tr: 'Servis', en: 'Service', type: 'participant', color: '#2fbf7f', prefix: '', suffix: ' Service' },
    { id: 'external', tr: 'Dış sistem', en: 'External system', type: 'boundary', color: '#3aa0ff', prefix: '', suffix: '' },
    { id: 'database', tr: 'Veritabanı', en: 'Database', type: 'database', color: '#f97a3c', prefix: '', suffix: ' DB' },
    { id: 'queue', tr: 'Kuyruk', en: 'Message queue', type: 'queue', color: '#9b6bff', prefix: '', suffix: ' Queue' },
  ];
  const presetRole = (r) => ({ id: r.id, name: r[I18N.getLang()] || r.en, type: r.type, color: r.color, prefix: r.prefix, suffix: r.suffix });

  const saveRoles = () => window.SeqStorage.saveKV('roles', S.roles).catch(Seq.docs.storageError);
  const roleById = (id) => id && (S.roles || []).find((r) => r.id === id);
  // Ekler isteğe bağlı satır sonuyla ayrılır: ön ekten sonra (prefixBreak) / son ekten önce (suffixBreak)
  // (satır sonu varken ekin o taraftaki boşluğu kırpılır: " Service" → "\nService")
  const prefixStr = (r) => (r && r.prefix ? (r.prefixBreak ? r.prefix.trimEnd() + '\n' : r.prefix) : '');
  const suffixStr = (r) => (r && r.suffix ? (r.suffixBreak ? '\n' + r.suffix.trimStart() : r.suffix) : '');
  /** Ön/son eki ayıklanmış ad (rolün o anki tanımına göre) */
  function stripAffixes(label, r) {
    let l = String(label || '');
    const pre = prefixStr(r), suf = suffixStr(r);
    if (pre && l.startsWith(pre)) l = l.slice(pre.length);
    if (suf && l.endsWith(suf) && l.length > suf.length) l = l.slice(0, -suf.length);
    return l;
  }
  const composeLabel = (r, base) => prefixStr(r) + base + suffixStr(r);
  const baseName = (p) => stripAffixes(p.label, roleById(p.role));

  /** Rolü katılımcıya uygular; adın çekirdeği korunur, ekler yenilenir. */
  function applyRole(p, r) {
    const base = baseName(p);
    p.role = r.id;
    p.type = r.type;
    p.color = r.color;
    p.label = composeLabel(r, base);
    p.implicit = false;
    if (p.autoId) {
      const nid = Seq.participants.uniqueId(p.label, p.uid);
      Seq.participants.renameRefs(p.id, nid);
      p.id = nid;
    }
  }

  /** Bir rolün tanımı değişti/silindi: bu tarayıcıdaki tüm diyagramlarda katılımcıları güncelle. */
  function updateRoleEverywhere(old, cur) {
    const transform = (model) => {
      let changed = false;
      model.participants.forEach((p) => {
        if (p.role !== old.id) return;
        changed = true;
        if (!cur) { delete p.role; return; }
        const base = stripAffixes(p.label, old);
        p.type = cur.type;
        p.color = cur.color;
        p.label = composeLabel(cur, base);
      });
      return changed;
    };
    const marker = new RegExp('^\\s*%%\\s*@role\\s+' + old.id + '\\s*$', 'm');
    S.docs.forEach((d) => {
      if (S.doc && d.id === S.doc.id) return;
      if (!marker.test(d.code)) return;
      const m = M.parse(d.code);
      if (transform(m)) d.code = M.serialize(m);
    });
    Seq.docs.persistDocs();
    if (transform(S.model)) Seq.editor.commit();
  }
  /** Rolü kullanan diyagram sayısı */
  function roleUsage(id) {
    const marker = new RegExp('^\\s*%%\\s*@role\\s+' + id + '\\s*$', 'm');
    return S.docs.filter((d) => marker.test(S.doc && d.id === S.doc.id ? S.code : d.code)).length;
  }

  // ---------------------------------------------------------------------------
  // Rol tanımlarını taşıma ve tanımsız rolleri içe alma
  // ---------------------------------------------------------------------------
  const roleDef = (r) => {
    const d = { name: r.name, type: r.type, color: r.color, prefix: r.prefix || '', suffix: r.suffix || '' };
    if (r.prefixBreak) d.prefixBreak = true;
    if (r.suffixBreak) d.suffixBreak = true;
    return d;
  };
  /** Dışarı çıkan koda (paylaşım linki, .mmd/.txt) kullanılan rollerin tanımlarını "%% @roledef" olarak ekler. */
  function withRoleDefs(code) {
    let m;
    try { m = M.parse(code); } catch (e) { return code; }
    const used = [...new Set(m.participants.map((p) => p.role).filter((id) => id && roleById(id)))];
    if (!used.length) return code;
    m.roleDefs = Object.assign({}, m.roleDefs);
    used.forEach((id) => { m.roleDefs[id] = roleDef(roleById(id)); });
    return M.serialize(m);
  }
  /** Dışarıdan gelen kodda (link/dosya), kütüphanede zaten olan rollerin "@roledef" satırlarını atar. */
  function stripKnownRoleDefs(code) {
    if (!/@roledef\b/.test(code)) return code;
    let m;
    try { m = M.parse(code); } catch (e) { return code; }
    if (!m.roleDefs) return code;
    Object.keys(m.roleDefs).forEach((id) => { if (roleById(id)) delete m.roleDefs[id]; });
    if (!Object.keys(m.roleDefs).length) delete m.roleDefs;
    return M.serialize(m);
  }
  const prettyId = (id) => id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  /** Tanımsız rolün tanımı: koddaki "@roledef" varsa ondan, yoksa diyagramdaki kullanımından çıkarılır. */
  function inferRoleDef(id, model) {
    const okType = (t) => M.PARTICIPANT_TYPES.some((x) => x.v === t);
    const rd = (model.roleDefs || {})[id] || {};
    const p = model.participants.find((x) => x.role === id) || {};
    const r = {
      id,
      name: typeof rd.name === 'string' && rd.name.trim() ? rd.name.trim() : prettyId(id),
      type: okType(rd.type) ? rd.type : okType(p.type) ? p.type : 'participant',
      color: /^#[0-9a-f]{6}$/i.test(rd.color || '') ? rd.color.toLowerCase() : p.color || PCOLORS[(S.roles || []).length % PCOLORS.length],
      prefix: typeof rd.prefix === 'string' ? rd.prefix : '',
      suffix: typeof rd.suffix === 'string' ? rd.suffix : '',
    };
    if (rd.prefixBreak) r.prefixBreak = true;
    if (rd.suffixBreak) r.suffixBreak = true;
    return r;
  }
  /** Açık diyagramda kütüphanede olmayan roller varsa editörün üstünde bilgi çubuğu gösterir. */
  function checkUnknownRoles() {
    const box = $('#notice');
    if (!box) return;
    if (!S.doc) { box.hidden = true; return; }
    const ignored = S.doc.ignoredRoles || [];
    const ids = [...new Set(S.model.participants.map((p) => p.role).filter((id) => id && !roleById(id) && !ignored.includes(id)))];
    if (!ids.length) { box.hidden = true; return; }
    const defs = ids.map((id) => inferRoleDef(id, S.model));
    box.innerHTML = '';
    add(box,
      ico('help'),
      h('div', { class: 'nt-text' },
        h('b', null, T('roles.unknown', { n: defs.length })),
        h('span', { class: 'nt-chips' }, defs.map((d) => h('span', { class: 'rp-chip', style: `--c:${d.color}` }, ico('t-' + d.type), d.name)))),
      h('div', { class: 'nt-actions' },
        h('button', { class: 'btn primary sm', onclick: () => {
          S.roles = (S.roles || []).concat(defs);
          saveRoles();
          Seq.palette.renderPalette();
          // Tanımlar artık kütüphanede: koddaki "@roledef" satırlarına gerek yok
          if (S.model.roleDefs) {
            ids.forEach((id) => delete S.model.roleDefs[id]);
            if (!Object.keys(S.model.roleDefs).length) delete S.model.roleDefs;
            Seq.editor.commit(); Seq.editor.flushHistory();
          } else Seq.flow.renderBuilder();
          box.hidden = true;
          toast(T('roles.added', { n: defs.length }));
        } }, ico('plus'), T('roles.addBtn')),
        h('button', { class: 'btn ghost sm', onclick: () => {
          S.doc.ignoredRoles = ignored.concat(ids);
          Seq.docs.persistDocs();
          box.hidden = true;
        } }, T('roles.ignore'))));
    box.hidden = false;
  }

  // --- Şablonlar ---
  // --- Katılımcı rolleri ---
  function openRoles() {
    // Değişiklikler gecikmeli olarak tüm diyagramlara yayılır; eski tanım "snap" içinde tutulur
    const snap = new Map((S.roles || []).map((r) => [r.id, { ...r }]));
    const pending = new Set();
    const flush = debounce(() => {
      pending.forEach((id) => {
        const old = snap.get(id);
        const cur = roleById(id);
        if (old) updateRoleEverywhere(old, cur || null);
        if (cur) snap.set(id, { ...cur }); else snap.delete(id);
      });
      pending.clear();
      Seq.palette.renderPalette();
    }, 300);
    const changed = (r) => { saveRoles(); pending.add(r.id); flush(); };

    const list = h('div', { class: 'role-list' });
    const renderRows = () => {
      list.innerHTML = '';
      list.append(h('div', { class: 'role-row role-head' },
        h('span'), h('span', null, T('role.name')), h('span', null, T('pe.type')), h('span', null, T('pe.color')),
        h('span', null, T('role.prefix')), h('span', null, T('role.suffix')), h('span', null, T('role.usage')), h('span')));
      S.roles.forEach((r) => {
        const icon = h('span', { class: 'role-icon', style: `--c:${r.color}` }, ico('t-' + r.type));
        const example = h('small', { class: 'role-example' });
        const refresh = () => {
          icon.style.setProperty('--c', r.color);
          icon.innerHTML = '';
          icon.append(ico('t-' + r.type));
          example.textContent = T('role.example', { name: composeLabel(r, T('role.exampleBase')) });
        };
        const name = h('input', { class: 'input', value: r.name, placeholder: T('role.name') });
        name.addEventListener('input', () => { r.name = name.value.trim() || r.id; saveRoles(); Seq.palette.renderPalette(); });
        const type = h('select', { class: 'select' }, M.PARTICIPANT_TYPES.map((t) => h('option', { value: t.v }, t.label)));
        type.value = r.type;
        type.addEventListener('change', () => { r.type = type.value; refresh(); changed(r); });
        const color = h('input', { type: 'color', class: 'role-color', value: r.color, title: T('pe.color') });
        color.addEventListener('input', () => { r.color = color.value.toLowerCase(); refresh(); changed(r); });
        const affix = (key) => {
          const inp = h('input', { class: 'input mono', value: r[key] || '', placeholder: '—', spellcheck: 'false' });
          inp.addEventListener('input', () => { r[key] = inp.value; refresh(); changed(r); });
          // ↵: ön ekten sonra / son ekten önce satır sonu
          const bk = key + 'Break';
          const br = h('button', { class: 'affix-break' + (r[bk] ? ' on' : ''), 'aria-pressed': String(!!r[bk]),
            title: T(key === 'prefix' ? 'role.breakAfter' : 'role.breakBefore') }, ico('enter'));
          br.addEventListener('click', () => {
            if (r[bk]) delete r[bk]; else r[bk] = true;
            br.classList.toggle('on', !!r[bk]);
            br.setAttribute('aria-pressed', String(!!r[bk]));
            refresh(); changed(r);
          });
          return h('div', { class: 'affix-cell' }, key === 'prefix' ? [inp, br] : [br, inp]);
        };
        const used = roleUsage(r.id);
        const del = h('button', { class: 'icon-btn sm del', title: T('delete'), onclick: () => {
          if (used && !confirm(T('role.confirmDelete', { name: r.name, n: used }))) return;
          S.roles = S.roles.filter((x) => x !== r);
          changed(r);
          renderRows();
        } }, ico('trash'));
        refresh();
        list.append(h('div', { class: 'role-row' },
          icon,
          h('div', { class: 'role-name' }, name, example),
          type, color, affix('prefix'), affix('suffix'),
          h('span', { class: 'role-usage', title: T('role.usageTitle') }, T('role.usageN', { n: used })),
          del));
      });
    };
    renderRows();

    const uniqueRoleId = (name) => {
      const base = M.slugify(name).toLowerCase() || 'role';
      let id = base, k = 2;
      while (roleById(id)) id = base + k++;
      return id;
    };
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const arr = JSON.parse(await f.text());
        const okType = (t) => M.PARTICIPANT_TYPES.some((x) => x.v === t);
        let n = 0;
        (Array.isArray(arr) ? arr : arr.roles || []).forEach((x) => {
          if (!x || !x.id || !/^[A-Za-z0-9_-]+$/.test(x.id) || !okType(x.type) || !/^#[0-9a-f]{6}$/i.test(x.color)) return;
          const r = { id: x.id, name: String(x.name || x.id), type: x.type, color: x.color.toLowerCase(), prefix: String(x.prefix || ''), suffix: String(x.suffix || '') };
          if (x.prefixBreak) r.prefixBreak = true;
          if (x.suffixBreak) r.suffixBreak = true;
          const i = S.roles.findIndex((y) => y.id === r.id);
          if (i >= 0) { if (!snap.has(r.id)) snap.set(r.id, { ...S.roles[i] }); S.roles[i] = r; } else S.roles.push(r);
          changed(r);
          n++;
        });
        renderRows();
        toast(T('role.imported', { n }));
      } catch (e) { toast(T('role.importFailed'), 'err'); }
    });

    const body = h('div', { class: 'roles' },
      h('p', { class: 'roles-intro' }, T('role.intro')),
      list,
      h('div', { class: 'roles-foot' },
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', onclick: () => {
            const r = { id: uniqueRoleId(T('role.newName')), name: T('role.newName'), type: 'participant', color: PCOLORS[S.roles.length % PCOLORS.length], prefix: '', suffix: '' };
            S.roles.push(r);
            saveRoles(); Seq.palette.renderPalette(); renderRows();
            const inputs = $$('.role-name .input', list);
            if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
          } }, ico('plus'), T('role.add')),
          h('button', { class: 'btn sm ghost', title: T('role.presetTitle'), onclick: () => {
            const missing = PRESET_ROLES.filter((x) => !roleById(x.id)).map(presetRole);
            S.roles.push(...missing);
            saveRoles(); Seq.palette.renderPalette(); renderRows();
            toast(T('role.presetAdded', { n: missing.length }));
          } }, T('role.preset'))),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm ghost', onclick: () => {
            downloadBlob(new Blob([JSON.stringify(S.roles, null, 2)], { type: 'application/json' }), 'sequence-studio-roles.json');
          } }, ico('download'), T('role.export')),
          h('button', { class: 'btn sm ghost', onclick: () => fileIn.click() }, ico('upload'), T('role.import')),
          fileIn)),
      h('p', { class: 'roles-note' }, ico('help'), T('role.note')));
    openModal(T('role.title'), body, true);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    events.on('doc:opened', () => checkUnknownRoles());
    S.roles = null;
  }

  Seq.roles = { init, PRESET_ROLES, applyRole, baseName, checkUnknownRoles, composeLabel, openRoles, presetRole, prettyId, roleById, saveRoles, stripKnownRoleDefs, withRoleDefs };
})(window.Seq = window.Seq || {});
