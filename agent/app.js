/* 3D Agent v15 — local-first + server sync (sync3d).
   Scope (Pho, Oct 24): ထိုးကွက် + လူစာရင်း + ဘောက်ချာ + အချုပ်.
   Separateness (Pho Oct 24, သတ်သတ်စီ): this app shows ONLY its
   own bettors — never Master people, never other agents' bettors,
   never agent-registry rows. Agent-terms settlement lives in
   Master; this app's own အချုပ် stays on bettor rates.
   Acks (Pho Oct 24, 2D-style): a save entering Master's ledger is
   auto-acked; this app's vouchers show "ok" on acked batches.
   No ledger / winning / over-limit / blocked screens — those are Master's.
   People here are bettors only; Master owns အကန်ဒိုင်. */
(function () {
  'use strict';
  var LS_KEY = '3dAgentV1';
  var parseLine = window.Parser3D.parseLine;

  /* ---------- state ---------- */
  function todayISO() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function uid() { return window.Sync3D ? window.Sync3D.uid15() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  function nextDraw(fromISO) {
    // Same rounds as Master: draws on the 1st and 16th only.
    var d = new Date(fromISO + 'T00:00:00');
    var y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    var c = day <= 1 ? new Date(y, m, 1) : day <= 16 ? new Date(y, m, 16) : new Date(y, m + 1, 1);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return c.getFullYear() + '-' + p(c.getMonth() + 1) + '-' + p(c.getDate());
  }
  function seed() {
    var s = { id: uid(), date: nextDraw(todayISO()), winning: null, closed: false };
    return { agentCode: '', people: [], sessions: [s], currentSessionId: s.id, records: [] };
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var st = JSON.parse(raw);
      if (!st || !Array.isArray(st.sessions) || !st.sessions.length) return null;
      return st;
    } catch (e) { return null; }
  }
  var state = load() || seed();
  if (!state.ackKeys) state.ackKeys = {}; // ack key -> 1 (seen on server)
  if (window.Sync3D) {
    try {
      window.Sync3D.init({ role: 'agent', authKey: '3dAgentAuth', queueKey: '3dAgentQueue', metaKey: '3dAgentMeta' });
      window.Sync3D.migrateState(state);
    } catch (e) {}
  }
  var memFallback = null;
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { memFallback = JSON.stringify(state); }
  }
  save();

  /* ---------- sync wiring (Pho Oct 24; Agent pushes people+records only) ---------- */
  function Q(op, coll, id, obj) { try { if (window.Sync3D) window.Sync3D.queue(op, coll, id, obj); } catch (e) {} }
  function syncAfter() { save(); render(); refreshAcks(); }

  /* ---------- acks (Pho Oct 24, 2D-style) ----------
     Master auto-acks a save once it enters Master's ledger; the
     ack rows live in 3d_acks and are fetched directly here (not
     via the sync queue). Matching is by full key, so another
     agent's acks can never badge this agent's batches. */
  function ackKey(sid, aid, pid, bn) { return sid + '|' + aid + '|' + pid + '|' + bn; }
  var lastAckFetch = 0;
  function refreshAcks() {
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) return;
    var now = Date.now();
    if (now - lastAckFetch < 300000) return;
    lastAckFetch = now;
    var tok = null;
    try { var a = JSON.parse(localStorage.getItem('3dAgentAuth') || 'null'); tok = a && a.token; } catch (e) {}
    if (!tok) return;
    var out = [], page = 1;
    function next() {
      return fetch('https://2d.skylinkvpn.stream/api/collections/3d_acks/records?page=' + page + '&perPage=200', { headers: { Authorization: tok } })
        .then(function (res) { return res.json(); })
        .then(function (d) {
          out = out.concat(d.items || []);
          if (d.totalPages && page < d.totalPages) { page++; return next(); }
          var changed = false;
          out.forEach(function (it) {
            var k = ackKey(it.sessionId, it.agentId, it.personId, it.batchNo);
            if (!state.ackKeys[k]) { state.ackKeys[k] = 1; changed = true; }
          });
          if (changed) { save(); render(); }
        });
    }
    next().catch(function () {});
  }
  function syncStatusText() {
    if (!window.Sync3D) return 'Sync မရှိ';
    if (!window.Sync3D.isLoggedIn()) return 'Server မချိတ်သေး (local ပဲ သိမ်းမယ်)';
    var q = window.Sync3D.queueCount();
    var err = window.Sync3D.getLastPushError() || window.Sync3D.getLastPullError();
    return err ? ('Sync အမှား: ' + err) : (q ? ('တင်ကျန် ' + q + ' ခု') : 'Sync အိုကေ');
  }
  function renderSyncStatus(msg) {
    var el = $('syncStatus'); if (el) el.textContent = msg || syncStatusText();
  }
  function syncNowUI() {
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) { renderSyncStatus(); return; }
    renderSyncStatus('Sync နေ တယ်…');
    window.Sync3D.syncNow(state, syncAfter, state.agentCode).then(function () { renderSyncStatus(); render(); });
  }

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  // Null-safe wiring: a missing element (stale cached HTML) must never
  // stop the app from booting.
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    var neg = n < 0; n = Math.abs(n);
    var s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }
  function sess() {
    return state.sessions.find(function (x) { return x.id === state.currentSessionId; }) || state.sessions[0];
  }
  function person(id) { return state.people.find(function (p) { return p.id === id; }); }
  function sessRecords() {
    var sid = sess().id;
    return state.records.filter(function (r) { return r.sessionId === sid; });
  }
  function fmtDate(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function normNum(v) {
    var map = { '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4', '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9' };
    return String(v).replace(/[၀-၉]/g, function (c) { return map[c]; });
  }

  /* ---------- navigation ---------- */
  function go(secName) {
    document.querySelectorAll('.sec').forEach(function (el) { el.classList.remove('on'); });
    var sec = $('sec-' + secName);
    if (sec) sec.classList.add('on');
    render();
  }
  document.querySelectorAll('[data-go]').forEach(function (el) {
    el.addEventListener('click', function () { go(el.getAttribute('data-go')); });
  });

  /* ---------- login ---------- */
  on('loginBtn', 'click', function () {
    var code = $('agentCode').value.trim();
    if (!code) { $('loginStatus').textContent = 'Agent code ထည့်ပါ'; return; }
    if (!window.Sync3D) { state.agentCode = code; save(); go('home'); return; }
    var creds = window.Sync3D.codeToCreds(code);
    if (!creds) { state.agentCode = code; save(); go('home'); return; } // test code: local-only (v1)
    $('loginStatus').textContent = 'Login နေ တယ်…';
    window.Sync3D.login(creds.email, creds.password).then(function () {
      return window.Sync3D.checkAgentDisabled(code);
    }).then(function (disabled) {
      if (disabled) {
        window.Sync3D.logout();
        $('loginStatus').textContent = 'ဒီ code ပိတ်ထားသည်';
        return;
      }
      state.agentCode = code; save(); go('home');
      window.Sync3D.repushOnce(state, 'agent'); /* push pre-sync local data once */
      window.Sync3D.syncNow(state, syncAfter, state.agentCode).then(function () { renderSyncStatus(); render(); });
      window.Sync3D.startAutoSync(state, syncAfter, state.agentCode, function () { renderSyncStatus(); render(); });
    }).catch(function () {
      // offline / wrong code: stay local-only, retry at next open
      state.agentCode = code; save(); go('home');
    });
  });

  /* ---------- sessions ---------- */
  function renderSessions() {
    var sel = $('sessSel');
    sel.innerHTML = state.sessions.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === sess().id ? ' selected' : '') + '>' +
        esc(fmtDate(s.date)) + ' ပွဲ</option>';
    }).join('');
    $('hdrDate').textContent = fmtDate(sess().date);
  }
  $('sessSel').addEventListener('change', function () {
    state.currentSessionId = this.value; save(); render();
  });
  $('newSessBtn').addEventListener('click', function () {
    var latest = state.sessions.reduce(function (a, s) { return s.date > a ? s.date : a; }, '');
    var base = latest ? new Date(latest + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + 1);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var fromISO = base.getFullYear() + '-' + p(base.getMonth() + 1) + '-' + p(base.getDate());
    var nd = nextDraw(fromISO);
    if (nd < todayISO()) nd = nextDraw(todayISO());
    var ex = state.sessions.find(function (s) { return s.date === nd; });
    if (ex) { state.currentSessionId = ex.id; }
    else {
      var s = { id: uid(), date: nd, winning: null, closed: false };
      state.sessions.push(s);
      state.sessions.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      state.currentSessionId = s.id;
    }
    save(); render();
  });

  /* ---------- home ---------- */
  function renderHome() {
    var t = sessRecords().reduce(function (a, r) { return a + r.amount; }, 0);
    $('homeTotal').textContent = fmt(t);
    var cs = $('agentCodeShow'); if (cs) cs.textContent = state.agentCode || '—';
  }

  /* ---------- people ---------- */
  // Pho Oct 24 (သတ်သတ်စီ): the Agent shows ONLY its own bettors.
  // Master people, other agents' bettors and agent-registry rows
  // never list here — each agent's list is its own alone.
  function agentVisiblePeople() { return state.people.filter(function (p) { return p.role !== 'agent' && p.agentId === state.agentCode; }); }
  function renderPeople() {
    var opts = agentVisiblePeople().map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    var ep = $('entryPerson'), vp = $('voucherPerson');
    var keepE = ep.value, keepV = vp.value;
    ep.innerHTML = state.people.length ? opts : '<option value="">—</option>';
    if (keepE && person(keepE)) ep.value = keepE;
    vp.innerHTML = state.people.length ? opts : '<option value="">—</option>';
    if (keepV && person(keepV)) vp.value = keepV;
    $('peopleList').innerHTML = agentVisiblePeople().map(function (p) {
      return '<div class="prow" data-pid="' + p.id + '"><span class="nm">' + esc(p.name) + '</span>' +
        '<span>အဆ ' + esc(fmt(p.payout)) + (p.tote ? '-' + esc(fmt(p.tote)) : '') + '</span><span>ကော် ' + esc(fmt(p.commission)) + '%</span>' + (p.closedLimit != null ? '<span>ပိတ် ' + esc(fmt(p.closedLimit)) + '</span>' : '') + '</div>';
    }).join('');
    $('peopleList').querySelectorAll('.prow').forEach(function (row) {
      var timer = null;
      row.addEventListener('pointerdown', function () {
        timer = setTimeout(function () { openPersonMenu(row.getAttribute('data-pid')); }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
        row.addEventListener(ev, function () { if (timer) clearTimeout(timer); });
      });
      row.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }
  $('pPayout').addEventListener('input', function () {
    var d = normNum($('pPayout').value).replace(/\D/g, '');
    $('pPayout').value = d.length >= 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
  });
  $('addPersonBtn').addEventListener('click', function () {
    var name = $('pName').value.trim();
    var pr = normNum($('pPayout').value).split(/[\/-]/);
    var payout = Number(pr[0]);
    var tote = pr.length > 1 ? Number(pr[1]) : 0;
    if (!name || !(payout > 0) || !$('pComm').value.trim()) {
      $('peopleStatus').textContent = 'အမည် / အဆ / ကော် အကုန် ဖြည့်ပါ';
      return;
    }
    var pcEl = $('pClosed');
    var closedLimit = (pcEl && pcEl.value.trim() !== '') ? Number(normNum(pcEl.value)) : null;
    var np = { id: uid(), name: name, payout: payout, tote: tote, commission: Number(normNum($('pComm').value)), role: 'bettor', closedLimit: closedLimit, agentId: state.agentCode || null };
    state.people.push(np);
    Q('create', '3d_people', np.id, np);
    $('pName').value = ''; $('pPayout').value = ''; $('pComm').value = ''; if (pcEl) pcEl.value = '';
    $('peopleStatus').textContent = '';
    save(); render();
  });

  /* ---------- entry board ---------- */
  var lastParse = [];
  function parseBoard() {
    var lines = $('board').value.split('\n');
    lastParse = [];
    var lineIdx = [];
    lines.forEach(function (ln, li) {
      if (!ln.trim()) return;
      lineIdx.push(li);
      lastParse.push(parseLine(ln));
    });
    var valid = lastParse.filter(function (r) { return r.ok; });
    var bad = lastParse.filter(function (r) { return !r.ok; });
    var pv = $('preview');
    if (valid.length) {
      var html = valid.map(function (r) {
        if (r.kind === 'split') {
          var head = r.head || 1;
          var sIt = r.items.slice(0, head), rIt = r.items.slice(head);
          return '<div data-idx="' + lineIdx[lastParse.indexOf(r)] + '" style="-webkit-touch-callout:none;user-select:none">' + esc(r.formula) + ' → ' + head + ' လုံး × ' + fmt(sIt[0].amount) +
            (rIt.length ? ' + ကျန် ' + rIt.length + ' × ' + fmt(rIt[0].amount) : '') + '</div>';
        }
        if (r.kind === 'daekyan') {
          var rest = r.items.slice(1);
          return '<div data-idx="' + lineIdx[lastParse.indexOf(r)] + '" style="-webkit-touch-callout:none;user-select:none">' + esc(r.formula) + ' → ဒဲ့ ' + fmt(r.items[0].amount) +
            (rest.length ? ' + ကျန် ' + rest.length + ' × ' + fmt(rest[0].amount) : '') + '</div>';
        }
        return '<div data-idx="' + lineIdx[lastParse.indexOf(r)] + '" style="-webkit-touch-callout:none;user-select:none">' + esc(r.formula) + ' → ' + r.count + ' ကွက် × ' + fmt(r.items[0].amount) + '</div>';
      }).join('');
      var tc = valid.reduce(function (a, r) { return a + r.count; }, 0);
      var tt = valid.reduce(function (a, r) { return a + r.total; }, 0);
      html += '<div class="pt">စုစုပေါင်း ' + tc + ' ကွက် · ' + fmt(tt) + '</div>';
      pv.innerHTML = html; pv.style.display = 'block';
    } else pv.style.display = 'none';
    var bb = $('badbox');
    if (bad.length) {
      bb.innerHTML = bad.map(function (r) { return '<div data-idx="' + lineIdx[lastParse.indexOf(r)] + '" style="-webkit-touch-callout:none;user-select:none">' + esc(r.formula) + '</div>'; }).join('');
      bb.style.display = 'block';
    } else bb.style.display = 'none';
    $('saveBtn').disabled = !(valid.length && $('entryPerson').value);
    if (valid.length && !$('entryPerson').value) {
      $('entryStatus').textContent = state.people.length
        ? 'အရင် လူ ရွေးပါ'
        : 'လူ မရှိသေး — လူစာရင်း မှာ အရင် ထည့်ပါ';
    } else if ($('entryStatus').textContent.indexOf('လူ') === 0 || $('entryStatus').textContent.indexOf('အရင်') === 0) {
      $('entryStatus').textContent = '';
    }
    var tc2 = valid.reduce(function (a, r) { return a + r.count; }, 0);
    var tt2 = valid.reduce(function (a, r) { return a + r.total; }, 0);
    $('boardCount').textContent = fmt(tc2);
    $('boardTotal').textContent = fmt(tt2);
    var pid = $('entryPerson').value, last = 0, maxB = 0;
    sessRecords().forEach(function (r) { if (r.personId === pid && r.batchNo > maxB) maxB = r.batchNo; });
    if (maxB) sessRecords().forEach(function (r) { if (r.personId === pid && r.batchNo === maxB) last += r.amount; });
    $('lastTotal').textContent = fmt(last);
  }
  $('board').addEventListener('input', parseBoard);

  /* Long-press a preview/badbox row to delete that board line (Pho, Oct 24):
     hold ~0.5s on a row and the line is gone — no confirm, like the
     competitor apps. Rows carry their board line index in data-idx.
     A small finger tremor (<=12px) must NOT cancel the hold — only a
     real drag/scroll does (Pho, Oct 25: plain pointermove cancel was
     too eager and the hold never fired). */
  function deleteBoardLine(li) {
    var ls = $('board').value.split('\n');
    if (li < 0 || li >= ls.length) return;
    ls.splice(li, 1);
    $('board').value = ls.join('\n');
    parseBoard();
    $('board').focus();
  }
  function bindRowDelete(el) {
    var timer = null, sx = 0, sy = 0;
    el.addEventListener('pointerdown', function (e) {
      var row = e.target.closest ? e.target.closest('[data-idx]') : null;
      if (!row) return;
      var li = parseInt(row.getAttribute('data-idx'), 10);
      sx = e.clientX || 0; sy = e.clientY || 0;
      timer = setTimeout(function () { timer = null; deleteBoardLine(li); }, 500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function () { if (timer) { clearTimeout(timer); timer = null; } });
    });
    el.addEventListener('pointermove', function (e) {
      if (!timer) return;
      var dx = (e.clientX || 0) - sx, dy = (e.clientY || 0) - sy;
      if (dx * dx + dy * dy > 144) { clearTimeout(timer); timer = null; }
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  bindRowDelete($('preview'));
  bindRowDelete($('badbox'));

  /* ---------- quick keyboard (same layout as Master) ---------- */
  var kbOpen = false;
  function kbSetCaret(pos) { try { $('board').setSelectionRange(pos, pos); } catch (e) {} }
  on('kbToggle', 'click', function () {
    kbOpen = !kbOpen;
    var kb = $('kb'); if (!kb) return;
    kb.style.display = kbOpen ? 'block' : 'none';
    $('kbToggle').classList.toggle('on', kbOpen);
    $('sec-entry').style.paddingBottom = kbOpen ? (kb.offsetHeight + 18) + 'px' : '';
    if (kbOpen) $('board').focus();
  });
  on('kb', 'click', function (e) {
    var k = e.target.closest('.k'); if (!k) return;
    var t = k.getAttribute('data-t');
    var b = $('board'); if (!b) return;
    var st = b.selectionStart == null ? b.value.length : b.selectionStart;
    var en = b.selectionEnd == null ? st : b.selectionEnd;
    b.focus();
    if (t === '⌫') {
      if (en > st) { b.value = b.value.slice(0, st) + b.value.slice(en); kbSetCaret(st); }
      else if (st > 0) { b.value = b.value.slice(0, st - 1) + b.value.slice(st); kbSetCaret(st - 1); }
    } else {
      var ins = t === '⏎' ? '\n' : t;
      b.value = b.value.slice(0, st) + ins + b.value.slice(en);
      kbSetCaret(st + ins.length);
    }
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('entryPerson').addEventListener('change', parseBoard);

  // Session lock (same rule as Master): a closed session, or one with a
  // winning number, takes no new entries / edits / deletes. The lock
  // state arrives from Master via sync; locally it starts open.
  function winLocked() { var s = sess(); return !!(s && (s.winning || s.closed)); }
  function lockPrefix() { var s = sess(); return (s && s.winning) ? 'ပေါက်သီး ထည့်ပြီး' : 'ပွဲစဉ် ပိတ်ထားသည်'; }

  function closedViolation(pid, items, excludeLineId) {
    var p = person(pid);
    if (!p || p.closedLimit == null) return null;
    var list = sess().blocked || [];
    if (!list.length) return null;
    var sums = {};
    (items || []).forEach(function (it) {
      if (list.indexOf(it.number) >= 0) sums[it.number] = (sums[it.number] || 0) + it.amount;
    });
    if (!Object.keys(sums).length) return null;
    var existing = {};
    sessRecords().forEach(function (r) {
      if (r.personId !== pid) return;
      if (excludeLineId && r.lineId === excludeLineId) return;
      if (list.indexOf(r.number) >= 0) existing[r.number] = (existing[r.number] || 0) + r.amount;
    });
    var bad = null;
    Object.keys(sums).forEach(function (n) {
      var tot = (existing[n] || 0) + sums[n];
      if (tot > p.closedLimit && !bad) bad = { n: n, cap: p.closedLimit, tot: tot };
    });
    return bad;
  }
  // Agent aggregate hot-limit (Pho Oct 24): the agent-person's
  // closedLimit (set by Master) caps THIS agent's total for
  // blocked-list numbers across all its bettors in the session.
  function agentClosedViolation(code, items, excludeLineId) {
    var ap = state.people.find(function (p) { return p.role === 'agent' && p.agentId === code; });
    if (!ap || ap.closedLimit == null) return null;
    var list = sess().blocked || [];
    if (!list.length) return null;
    var sums = {};
    (items || []).forEach(function (it) {
      if (list.indexOf(it.number) >= 0) sums[it.number] = (sums[it.number] || 0) + it.amount;
    });
    if (!Object.keys(sums).length) return null;
    var existing = {};
    sessRecords().forEach(function (r) {
      if (r.agentId !== code) return;
      if (excludeLineId && r.lineId === excludeLineId) return;
      if (list.indexOf(r.number) >= 0) existing[r.number] = (existing[r.number] || 0) + r.amount;
    });
    var bad = null;
    Object.keys(sums).forEach(function (n) {
      var tot = (existing[n] || 0) + sums[n];
      if (tot > ap.closedLimit && !bad) bad = { n: n, cap: ap.closedLimit, tot: tot };
    });
    return bad;
  }

  $('saveBtn').addEventListener('click', function () {
    if (winLocked()) { $('entryStatus').textContent = lockPrefix() + ' — ထိုး မရတော့ပါ'; return; }
    var pid = $('entryPerson').value;
    if (!pid) return;
    var valid = lastParse.filter(function (r) { return r.ok; });
    if (!valid.length) return;
    var s = sess();
    var newItems = [];
    valid.forEach(function (r) { r.items.forEach(function (it) { newItems.push(it); }); });
    var sp = person(pid);
    if (!sp || sp.role === 'agent' || sp.agentId !== state.agentCode) { $('entryStatus').textContent = 'ဒီလူကို ရွေးလို့ မရပါ'; return; }
    var badC = closedViolation(pid, newItems, null);
    var badA = agentClosedViolation(state.agentCode, newItems, null);
    if (badA) { $('entryStatus').textContent = 'ပိတ်ဂဏန်း ' + badA.n + ' — Agent စုစုပေါင်း limit ' + fmt(badA.cap) + ' ကျော် နေတယ် (' + fmt(badA.tot) + ' ဖက် နေ)'; return; }
    if (badC) {
      $('entryStatus').textContent = 'ပိတ်ဂဏန်း ' + badC.n + ' — ' + person(pid).name +
        ' limit ' + fmt(badC.cap) + ' ကျော် နေတယ် (' + fmt(badC.tot) + ' ဖက် နေ)';
      return;
    }
    var batchNo = 1;
    sessRecords().forEach(function (r) {
      if (r.personId === pid && r.batchNo >= batchNo) batchNo = r.batchNo + 1;
    });
    valid.forEach(function (r) {
      var lineId = uid();
      r.items.forEach(function (it) {
        var rec = {
          id: uid(), sessionId: s.id, personId: pid, batchNo: batchNo,
          lineId: lineId, number: it.number, amount: it.amount,
          formula: r.formula, isFormula: r.kind !== 'single', agentId: state.agentCode || null
        };
        state.records.push(rec);
        Q('create', '3d_records', rec.id, rec);
      });
    });
    // Only saved lines leave the board — invalid lines STAY to be fixed.
    var leftover = lastParse.filter(function (r) { return !r.ok && r.formula; })
      .map(function (r) { return r.formula; }).join('\n');
    $('board').value = leftover;
    parseBoard();
    save(); render();
    $('entryStatus').textContent = 'NO ' + batchNo + ' သိမ်းပြီး' +
      (leftover ? ' — နီ တဲ့ လိုင်း ကျန် နေ တယ်' : '');
  });

  /* ---------- vouchers ---------- */
  $('voucherPerson').addEventListener('change', renderVoucher);
  function toteSetOf(s) {
    if (!s.winning) return null;
    var set = {};
    Parser3D.perms3(s.winning[0], s.winning[1], s.winning[2]).forEach(function (n) { if (n !== s.winning) set[n] = 1; });
    var wv = parseInt(s.winning, 10);
    if (wv > 0) set[String(wv - 1).padStart(3, '0')] = 1;
    if (wv < 999) set[String(wv + 1).padStart(3, '0')] = 1;
    return set;
  }
  function renderVoucher() {
    var s = sess();
    var vtset = toteSetOf(s);
    var pid = $('voucherPerson').value;
    var box = $('voucherBox');
    if (!pid) { box.innerHTML = '<div class="empty">လူ မရှိသေး</div>'; return; }
    var recs = sessRecords().filter(function (r) { return r.personId === pid; });
    if (!recs.length) { box.innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
    var batches = {};
    recs.forEach(function (r) { (batches[r.batchNo] = batches[r.batchNo] || []).push(r); });
    var html = '';
    Object.keys(batches).map(Number).sort(function (a, b) { return a - b; }).forEach(function (bn) {
      var rows = batches[bn];
      var lines = [], seen = {};
      rows.forEach(function (r) {
        if (!seen[r.lineId]) { seen[r.lineId] = []; lines.push(seen[r.lineId]); }
        seen[r.lineId].push(r);
      });
      var body = '', total = 0;
      lines.forEach(function (lineRecs, li) {
        var lt = lineRecs.reduce(function (a, r) { return a + r.amount; }, 0);
        total += lt;
        var label = esc(lineRecs[0].formula);
        if (lineRecs[0].isFormula || lineRecs.length > 1) label += ' (' + lineRecs.length + ')';
        var xid = 'x' + bn + '-' + li;
        var rowCls = 'vline';
        if (s.winning && lineRecs.some(function (r) { return r.number === s.winning; })) rowCls += ' vwin';
        else if (vtset && lineRecs.some(function (r) { return vtset[r.number]; })) rowCls += ' vtote';
        body += '<tr class="' + rowCls + '" data-x="' + xid + '" data-line="' + lineRecs[0].lineId + '"><td class="frm">' + label + '</td>' +
          '<td class="amt">' + fmt(lt) + '</td></tr>';
        var chips = lineRecs.map(function (r) {
          var cc = (s.winning && r.number === s.winning) ? ' class="w"' : (vtset && vtset[r.number]) ? ' class="t"' : '';
          return '<span' + cc + '>' + r.number + ' · ' + fmt(r.amount) + '</span>';
        }).join('');
        body += '<tr id="' + xid + '" style="display:none"><td class="xpand" colspan="2"><div class="xgrid">' + chips + '</div></td></tr>';
      });
      body += '<tr class="vtot"><td colspan="2">Total ' + fmt(total) + '</td></tr>';
      var okHere = !!state.ackKeys[ackKey(s.id, (rows[0] && rows[0].agentId) || state.agentCode, pid, bn)];
      html += '<div class="vbatch"><div class="vhead">NO ' + bn + (okHere ? ' <span class="pos">ok</span>' : '') + '</div>' +
        '<table class="vt">' + body + '</table></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.vline').forEach(function (tr) {
      tr.addEventListener('click', function () {
        if (suppressClick) { suppressClick = false; return; }
        var x = document.getElementById(tr.getAttribute('data-x'));
        if (x) x.style.display = x.style.display === 'none' ? 'table-row' : 'none';
      });
      var timer = null;
      tr.addEventListener('pointerdown', function () {
        timer = setTimeout(function () {
          suppressClick = true;
          openLineMenu(tr.getAttribute('data-line'));
        }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
        tr.addEventListener(ev, function () { if (timer) clearTimeout(timer); });
      });
      tr.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  /* ---------- voucher line edit / delete ---------- */
  var suppressClick = false, menuLineId = null;
  function lineRecsOf(lineId) {
    return state.records.filter(function (r) { return r.lineId === lineId && r.sessionId === sess().id; });
  }
  function closeLineMenu() { var lm = $('lineMenu'); if (lm) lm.style.display = 'none'; menuLineId = null; }
  function openLineMenu(lineId) {
    if (!$('lineMenu')) return;
    var recs = lineRecsOf(lineId);
    if (!recs.length) return;
    menuLineId = lineId;
    $('lmTitle').textContent = recs[0].formula;
    $('lmView').style.display = 'block';
    $('lmEdit').style.display = 'none';
    $('lineMenu').style.display = 'flex';
  }
  on('lmCloseBtn', 'click', closeLineMenu);
  on('lineMenu', 'click', function (e) { if (e.target === $('lineMenu')) closeLineMenu(); });
  on('lmDelBtn', 'click', function () {
    if (winLocked()) { alert(lockPrefix() + ' — ဖျက် မရတော့ပါ'); return closeLineMenu(); }
    var recs = lineRecsOf(menuLineId);
    if (!recs.length) return closeLineMenu();
    if (!confirm('ဒီ လိုင်း ဖျက် မလား? ' + recs[0].formula)) return;
    recs.forEach(function (r) { Q('delete', '3d_records', r.id, null); });
    state.records = state.records.filter(function (r) { return r.lineId !== menuLineId; });
    save(); render(); closeLineMenu();
  });
  on('lmEditBtn', 'click', function () {
    if (winLocked()) { alert(lockPrefix() + ' — ပြင် မရတော့ပါ'); return closeLineMenu(); }
    var recs = lineRecsOf(menuLineId);
    if (!recs.length) return closeLineMenu();
    $('lmView').style.display = 'none';
    $('lmEdit').style.display = 'block';
    $('lmInput').value = recs[0].formula;
    $('lmHint').textContent = '';
  });
  on('lmBackBtn', 'click', function () {
    $('lmEdit').style.display = 'none';
    $('lmView').style.display = 'block';
  });
  on('lmInput', 'input', function () {
    var r = window.Parser3D.parseLine($('lmInput').value);
    $('lmHint').textContent = r.ok
      ? '→ ' + r.count + ' ကွက် · ' + fmt(r.total)
      : 'ပုံစံ မမှန် — သိမ်း လို့ မရ';
  });
  on('lmSaveBtn', 'click', function () {
    if (winLocked()) { $('lmHint').textContent = lockPrefix() + ' — ပြင် မရတော့ပါ'; return; }
    var recs = lineRecsOf(menuLineId);
    if (!recs.length) return closeLineMenu();
    var r = window.Parser3D.parseLine($('lmInput').value);
    if (!r.ok) { $('lmHint').textContent = 'ပုံစံ မမှန် — ပြန် စစ် ပါ'; return; }
    var badL = closedViolation(recs[0].personId, r.items, menuLineId);
    var badA = recs[0].agentId ? agentClosedViolation(recs[0].agentId, r.items, menuLineId) : null;
    if (badA) { $('lmHint').textContent = 'ပိတ်ဂဏန်း ' + badA.n + ' Agent စုစုပေါင်း limit ' + fmt(badA.cap) + ' ကျော် နေတယ်'; return; }
    if (badL) { $('lmHint').textContent = 'ပိတ်ဂဏန်း ' + badL.n + ' limit ' + fmt(badL.cap) + ' ကျော် နေတယ်'; return; }
    var first = recs[0];
    var idx = state.records.indexOf(first);
    state.records = state.records.filter(function (x) { return x.lineId !== menuLineId; });
    var newLineId = uid();
    var newRecs = r.items.map(function (it) {
      return {
        id: uid(), sessionId: first.sessionId, personId: first.personId,
        batchNo: first.batchNo, lineId: newLineId, number: it.number,
        amount: it.amount, formula: r.formula, isFormula: r.kind !== 'single', agentId: state.agentCode || null
      };
    });
    recs.forEach(function (r0) { Q('delete', '3d_records', r0.id, null); });
    newRecs.forEach(function (rec) { Q('create', '3d_records', rec.id, rec); });
    newRecs.forEach(function (rec, i) { state.records.splice(idx + i, 0, rec); });
    save(); render(); closeLineMenu();
  });

  /* ---------- person edit / delete (long-press menu) ---------- */
  var menuPersonId = null;
  function closePersonMenu() { var pm = $('personMenu'); if (pm) pm.style.display = 'none'; menuPersonId = null; }
  function openPersonMenu(pid) {
    if (!$('personMenu')) return;
    var p = person(pid); if (!p) return;
    menuPersonId = pid;
    $('pmTitle').textContent = p.name;
    $('pmView').style.display = 'block';
    $('pmEdit').style.display = 'none';
    $('personMenu').style.display = 'flex';
  }
  on('pmCloseBtn', 'click', closePersonMenu);
  on('personMenu', 'click', function (e) { if (e.target === $('personMenu')) closePersonMenu(); });
  on('pmDelBtn', 'click', function () {
    var p = person(menuPersonId); if (!p) return closePersonMenu();
    var n = state.records.filter(function (r) { return r.personId === p.id; }).length;
    if (!confirm('ဒီ လူ ဖျက် မလား? ' + p.name + (n ? ' — စာရင်း ' + n + ' ကွက် ပါ ပျက် မယ်' : ''))) return;
    state.records.filter(function (r) { return r.personId === p.id; }).forEach(function (r) { Q('delete', '3d_records', r.id, null); });
    Q('delete', '3d_people', p.id, null);
    state.people = state.people.filter(function (x) { return x.id !== p.id; });
    state.records = state.records.filter(function (r) { return r.personId !== p.id; });
    save(); render(); closePersonMenu();
  });
  on('pmEditBtn', 'click', function () {
    var p = person(menuPersonId); if (!p) return closePersonMenu();
    $('pmView').style.display = 'none';
    $('pmEdit').style.display = 'block';
    $('pmName').value = p.name;
    $('pmPayout').value = p.payout + (p.tote ? '-' + p.tote : '');
    $('pmComm').value = p.commission;
    $('pmClosed').value = p.closedLimit == null ? '' : p.closedLimit;
    $('pmHint').textContent = '';
  });
  on('pmBackBtn', 'click', function () {
    $('pmEdit').style.display = 'none';
    $('pmView').style.display = 'block';
  });
  on('pmPayout', 'input', function () {
    var d = normNum($('pmPayout').value).replace(/\D/g, '');
    $('pmPayout').value = d.length >= 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
  });
  on('pmSaveBtn', 'click', function () {
    var p = person(menuPersonId); if (!p) return closePersonMenu();
    var name = $('pmName').value.trim();
    var pr = normNum($('pmPayout').value).split(/[\/-]/);
    var payout = Number(pr[0]);
    var tote = (pr.length > 1 && pr[1] !== '') ? Number(pr[1]) : 0;
    var commRaw = $('pmComm').value.trim();
    if (!name || !(payout > 0) || commRaw === '') {
      $('pmHint').textContent = 'အမည် / အဆ / ကော် အကုန် ဖြည့်ပါ';
      return;
    }
    p.name = name; p.payout = payout; p.tote = tote;
    p.commission = Number(normNum(commRaw));
    var pcv = $('pmClosed').value.trim();
    var cl = Number(normNum(pcv));
    p.closedLimit = (pcv === '' || isNaN(cl)) ? null : cl;
    Q('update', '3d_people', p.id, p);
    save(); render(); closePersonMenu();
  });

  /* ---------- summary (အချုပ်) ---------- */
  function renderDaily() {
    var s = sess();
    var recs = sessRecords();
    if (!recs.length) { $('dailyBox').innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
    var tset = null;
    if (s.winning) {
      tset = {};
      Parser3D.perms3(s.winning[0], s.winning[1], s.winning[2]).forEach(function (n) {
        if (n !== s.winning) tset[n] = 1;
      });
      var wv = parseInt(s.winning, 10);
      if (wv > 0) tset[String(wv - 1).padStart(3, '0')] = 1;
      if (wv < 999) tset[String(wv + 1).padStart(3, '0')] = 1;
    }
    var byPerson = {};
    recs.forEach(function (r) {
      byPerson[r.personId] = byPerson[r.personId] || { bet: 0, win: 0, tote: 0 };
      byPerson[r.personId].bet += r.amount;
      if (s.winning && r.number === s.winning) byPerson[r.personId].win += r.amount;
      else if (tset && tset[r.number]) byPerson[r.personId].tote += r.amount;
    });
    var rows = '', T = { bet: 0, win: 0, tote: 0, net: 0 };
    state.people.forEach(function (p) {
      var d = byPerson[p.id];
      if (!d) return;
      var pay = d.win * p.payout + d.tote * (p.tote || 0);
      // Agent's people are bettors: PLUS rule (bet×(1−comm%) − payout).
      var net = d.bet * (1 - p.commission / 100) - pay;
      T.bet += d.bet; T.win += d.win; T.tote += d.tote; T.net += net;
      var nc = net < 0 ? 'neg' : (net > 0 ? 'pos' : '');
      rows += '<tr><td>' + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td>' + fmt(d.tote) +
        '</td><td class="' + nc + '">' + fmt(net) + '</td></tr>';
    });
    var tc = T.net < 0 ? 'neg' : (T.net > 0 ? 'pos' : '');
    var html =
      '<table class="grid"><tr><th>အမည်</th><th>တက်ငွေ</th><th>အပေါက်</th><th>တွဒ်</th><th>ကျန်</th></tr>' +
      rows +
      '<tr class="tot"><td>စုစုပေါင်း</td><td>' + fmt(T.bet) + '</td><td>' + fmt(T.win) +
      '</td><td>' + fmt(T.tote) +
      '</td><td class="' + tc + '">' + fmt(T.net) + '</td></tr></table>';
    $('dailyBox').innerHTML = html;
  }

  /* ---------- settings ---------- */
  on('syncNowBtn', 'click', syncNowUI);
  $('resetBtn').addEventListener('click', function () {
    if (!confirm('အကုန် ရှင်းမလား?')) return;
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem('3dAgentQueue');
    localStorage.removeItem('3dAgentAuth');
    localStorage.removeItem('3dAgentMeta');
    location.reload();
  });

  /* ---------- render all ---------- */
  function render() {
    renderSessions();
    renderHome();
    renderPeople();
    renderDaily();
    renderVoucher();
    parseBoard();
    renderSyncStatus();
  }
  if (state.agentCode) {
    go('home');
    if (window.Sync3D) {
      var creds0 = window.Sync3D.codeToCreds(state.agentCode);
      if (creds0) {
        window.Sync3D.login(creds0.email, creds0.password).then(function () {
          window.Sync3D.repushOnce(state, 'agent'); /* push pre-sync local data once */
          window.Sync3D.syncNow(state, syncAfter, state.agentCode).then(function () { renderSyncStatus(); render(); });
          window.Sync3D.startAutoSync(state, syncAfter, state.agentCode, function () { renderSyncStatus(); render(); });
        }).catch(function () { renderSyncStatus(); });
      }
    }
  } else go('login');
})();
