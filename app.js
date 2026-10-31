/* 3D Master v63 — local-first + server sync (sync3d). Agent-terms settlement (Pho Oct 24): each agent auto-appears as a person row in Master's လူစာရင်း (role 'agent'); Master sets that agent's အဆ/ကော်/တွဒ်/ဟော့ဂဏန်း limit there; Master အချုပ် settles each agent's total at those terms (fallback: per-bettor math until terms set). Strict separation: Master ≠ Agent, Agent 1 ≠ Agent 9, each agent's list its own alone. */
(function () {
  'use strict';
  var LS_KEY = '3dMasterV1';
  var parseLine = window.Parser3D.parseLine;
  var BUR = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];

  /* ---------- state ---------- */
  function todayISO() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function uid() { return window.Sync3D ? window.Sync3D.uid15() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }

  function nextDraw(fromISO) {
    // 3D draws on the 1st and 16th — next draw date >= fromISO (a round
    // collects bets for ~15 days; one session per round).
    var d = new Date(fromISO + 'T00:00:00');
    var y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    var c = day <= 1 ? new Date(y, m, 1) : day <= 16 ? new Date(y, m, 16) : new Date(y, m + 1, 1);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return c.getFullYear() + '-' + p(c.getMonth() + 1) + '-' + p(c.getDate());
  }
  function seed() {
    var s = { id: uid(), date: nextDraw(todayISO()), limit: 50000, winning: null, closed: false };
    return { people: [], sessions: [s], currentSessionId: s.id, records: [] };
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
  if (!state.agentNames) state.agentNames = {}; // code -> agent display name (3d_agents)
  if (!state.ackedKeys) state.ackedKeys = {}; // ack key -> 1 (posted or seen on server)
  if (window.Sync3D) {
    try {
      window.Sync3D.init({ role: 'master', authKey: '3dMasterAuth', queueKey: '3dMasterQueue', metaKey: '3dMasterMeta' });
      window.Sync3D.migrateState(state);
    } catch (e) {}
  }
  var memFallback = null;
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { memFallback = JSON.stringify(state); }
  }
  save();

  /* ---------- sync wiring (Pho Oct 24) ---------- */
  function Q(op, coll, id, obj) { try { if (window.Sync3D) window.Sync3D.queue(op, coll, id, obj); } catch (e) {} }
  function syncAfter() { save(); render(); refreshAgentNames(); if (ensureAgentPeople()) { save(); render(); } autoAck(); }
  function syncStatusText() {
    if (!window.Sync3D) return 'Sync မရှိ';
    if (!window.Sync3D.isLoggedIn()) return 'Server မချိတ်သေး — အောက် login မှာ ဝင်ပါ';
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
    window.Sync3D.syncNow(state, syncAfter, '').then(function () { renderSyncStatus(); render(); });
  }

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  // Null-safe wiring: if the HTML is a cached older version, a missing
  // element must never stop the app from booting (Pho's black screen, Oct 22).
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

  /* ---------- agent privacy (Pho Oct 24) ----------
     Agent bettors are NOT Master's people: they never appear in
     Master's lists, and their records show only under the agent's
     name, e.g. "(Agent) Agent 1". Their rates stay in state for
     math only and are never rendered. */
  function isAgentPerson(p) { return !!(p && p.agentId); }
  function visiblePeople() { return state.people.filter(function (p) { return !isAgentPerson(p); }); }
  // လူစာရင်း screen: Master's own people PLUS agent-registry rows
  // (role 'agent', tagged) — agent bettors stay hidden. Entry and
  // voucher dropdowns keep using visiblePeople() (no registry rows).
  function listPeople() { return state.people.filter(function (p) { return !p.agentId || p.role === 'agent'; }); }
  function agentName(code) {
    if (state.agentNames && state.agentNames[code]) return state.agentNames[code];
    var m = String(code || '').match(/^[^-]+-(\d+)-/);
    return m ? ('Agent ' + m[1]) : '';
  }
  function agentLabel(code) { var n = agentName(code); return '(Agent)' + (n ? ' ' + n : ''); }
  function agentCodesInSession() {
    var seen = {}, out = [];
    sessRecords().forEach(function (r) { if (r.agentId && !seen[r.agentId]) { seen[r.agentId] = 1; out.push(r.agentId); } });
    return out;
  }
  function restoreSel(sel, val) {
    if (!val) return;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === val) { sel.value = val; return; }
    }
  }
  // Agent display names come from the 3d_agents collection (same
  // PocketBase as sync3d). Throttled; failures are silent and the
  // code-derived "Agent N" fallback still renders.
  var lastAgentNamesFetch = 0;
  var agentRecords = [];
  // Agent registry (Pho Oct 24): one person row per agent code, so
  // Master can set that agent's terms (payout/tote/commission/
  // closedLimit). Rows live in 3d_people with role 'agent' and are
  // shown in Master's လူစာရင်း (tagged) but never in entry
  // dropdowns and never in the Agent app's bettor lists. Terms
  // unset (payout 0) = fall back to per-bettor math; deleting a
  // row only resets terms (auto-create re-adds it blank). The
  // agent ACCOUNT itself is never touched here.
  function agentPersonFor(code) { return state.people.find(function (p) { return p.role === 'agent' && p.agentId === code; }); }
  // Pho Oct 30 fix (login-duplication race): refreshAgentNames can
  // run ensureAgentPeople BEFORE the pull lands server people on a
  // fresh state, so the local-only check missed real rows and
  // created blank (0-term) duplicates. Codes missing locally are
  // now checked against SERVER 3d_people first: a server row is
  // adopted locally, never re-created blank; only a code with no
  // server row is created. One check runs at a time (shared
  // promise) so concurrent callers cannot double-create. A failed
  // check creates nothing (fail-closed); the next sync retries.
  // Existing rows are never touched.
  var agentPeopleServerCheck = null;
  function ensureAgentPeople() {
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) return 0;
    var myTenant = ownTenant();
    var missing = [];
    (agentRecords || []).forEach(function (it) {
      var tid = (typeof it.tenant === 'string') ? it.tenant : (it.tenant && it.tenant.id);
      if (myTenant && tid && tid !== myTenant) return; // Pho-exception fetch may include other tenants
      if (agentPersonFor(it.code)) return;
      if (missing.indexOf(it.code) === -1) missing.push(it.code);
    });
    if (!missing.length) return 0;
    if (agentPeopleServerCheck) return 0; // a check is already running; it covers these codes
    var tok = null;
    try { var a = JSON.parse(localStorage.getItem('3dMasterAuth') || 'null'); tok = a && a.token; } catch (e) {}
    if (!tok) return 0;
    var url = 'https://2d.skylinkvpn.stream/api/collections/3d_people/records?perPage=200';
    if (myTenant) url += '&filter=' + encodeURIComponent('tenant="' + myTenant + '"');
    function done() { agentPeopleServerCheck = null; }
    agentPeopleServerCheck = fetch(url, { headers: { Authorization: tok } })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        var serverByCode = {};
        (d.items || []).forEach(function (row) { if (row.agentId) serverByCode[row.agentId] = row; });
        var changed = false;
        (agentRecords || []).forEach(function (it) {
          if (missing.indexOf(it.code) === -1) return;
          if (agentPersonFor(it.code)) return;
          var srv = serverByCode[it.code];
          if (srv) {
            state.people.push({ id: srv.id, name: srv.name, payout: srv.payout, tote: srv.tote || 0, commission: srv.commission, closedLimit: (srv.closedLimit == null ? null : srv.closedLimit), role: srv.role || 'agent', agentId: srv.agentId });
            changed = true;
          } else {
            var np = { id: uid(), name: it.name || agentName(it.code), role: 'agent', payout: 0, tote: 0, commission: 0, closedLimit: null, agentId: it.code };
            state.people.push(np);
            Q('create', '3d_people', np.id, np);
            changed = true;
          }
        });
        if (changed) { save(); render(); }
        done();
      })
      .catch(function () { done(); });
    return 0;
  }
  function refreshAgentNames() {
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) return;
    var now = Date.now();
    if (now - lastAgentNamesFetch < 300000) return;
    lastAgentNamesFetch = now;
    var tok = null;
    try { var a = JSON.parse(localStorage.getItem('3dMasterAuth') || 'null'); tok = a && a.token; } catch (e) {}
    if (!tok) return;
    fetch('https://2d.skylinkvpn.stream/api/collections/3d_agents/records?perPage=200', { headers: { Authorization: tok } })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        var map = {};
        agentRecords = [];
        (d.items || []).forEach(function (it) { if (it.code) { map[it.code] = it.name || ''; agentRecords.push(it); } });
        var changed = JSON.stringify(map) !== JSON.stringify(state.agentNames || {});
        state.agentNames = map;
        var created = ensureAgentPeople();
        if (changed || created) { save(); render(); }
      })
      .catch(function () {});
  }

  /* ---------- acks (Pho Oct 24, 2D-style) ----------
     AUTOMATIC, no button: when an agent's save enters Master's
     ledger (it is in state after a pull), Master posts a 3d_acks
     row so the Agent's voucher can show "ok". Ledger entry IS the
     acknowledgement. Runs after every sync; already-acked saves
     are never re-posted (server list + local set dedup). */
  function ackKey(sid, aid, pid, bn) { return sid + '|' + aid + '|' + pid + '|' + bn; }
  var ackRunning = false;
  function pbListAll(coll, params) {
    var out = [], page = 1;
    function next() {
      var p = Object.assign({}, params || {}, { page: page, perPage: 200 });
      return pbList(coll, p).then(function (res) {
        out = out.concat(res.items || []);
        if (res.totalPages && page < res.totalPages) { page++; return next(); }
        return out;
      });
    }
    return next();
  }
  function autoAck() {
    if (ackRunning) return;
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) return;
    var saves = {}, order = [];
    state.records.forEach(function (r) {
      if (!r.agentId) return;
      var k = ackKey(r.sessionId, r.agentId, r.personId, r.batchNo);
      if (!saves[k]) { saves[k] = { sessionId: r.sessionId, agentId: r.agentId, personId: r.personId, batchNo: r.batchNo }; order.push(k); }
    });
    if (!order.length) return;
    ackRunning = true;
    pbListAll('3d_acks', {}).then(function (items) {
      var have = {};
      items.forEach(function (it) {
        var k = ackKey(it.sessionId, it.agentId, it.personId, it.batchNo);
        have[k] = 1;
        if (!state.ackedKeys[k]) state.ackedKeys[k] = 1;
      });
      var missing = order.filter(function (k) { return !have[k]; });
      var chain = Promise.resolve(), posted = false;
      missing.forEach(function (k) {
        chain = chain.then(function () {
          state.ackedKeys[k] = 1; // optimistic: blocks duplicate posts across overlapping syncs
          var sv = saves[k];
          var t = window.Sync3D.getTenant();
          if (t && typeof t === 'object') t = t.id;
          return pbReq('POST', '/collections/3d_acks/records', { tenant: t, sessionId: sv.sessionId, agentId: sv.agentId, personId: sv.personId, batchNo: sv.batchNo })
            .then(function () { posted = true; })
            .catch(function () { delete state.ackedKeys[k]; });
        });
      });
      return chain.then(function () { return posted; });
    }).then(function (posted) {
      ackRunning = false;
      save();
      if (posted) render();
    }).catch(function () { ackRunning = false; });
  }
  function sessRecords() {
    var sid = sess().id;
    return state.records.filter(function (r) { return r.sessionId === sid; });
  }
  function totalsByNumber() {
    // Net exposure per number: bettor bets add, အကန် (hedge) bets SUBTRACT —
    // the hedge bookie carries that part, so it must not inflate အကျွံ.
    var map = {};
    sessRecords().forEach(function (r) {
      var p = person(r.personId);
      var sign = (p && p.role === 'akan') ? -1 : 1;
      map[r.number] = (map[r.number] || 0) + sign * r.amount;
    });
    return map;
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
  var currentSec = 'home';
  function go(secName) {
    currentSec = secName;
    document.querySelectorAll('.sec').forEach(function (el) { el.classList.remove('on'); });
    $('sec-' + secName).classList.add('on');
    render();
  }
  document.querySelectorAll('[data-go]').forEach(function (el) {
    el.addEventListener('click', function () { go(el.getAttribute('data-go')); });
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
      var s = { id: uid(), date: nd, limit: 50000, winning: null, closed: false };
      state.sessions.push(s);
      Q('create', '3d_sessions', s.id, s);
      state.sessions.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      state.currentSessionId = s.id;
    }
    save(); render();
  });

  /* ---------- home ---------- */
  function renderHome() {
    var t = sessRecords().reduce(function (a, r) {
      var p = person(r.personId);
      return a + ((p && p.role === 'akan') ? -r.amount : r.amount);
    }, 0);
    $('homeTotal').textContent = fmt(t);
  }

  /* ---------- people ---------- */
  // Master agent entry (Pho Oct 31): the already-registered agent
  // rows (role 'agent' terms rows) offered as entry substitutes, so
  // Master can enter message-sent bets under just the agent name.
  function entryAgentRows() { return state.people.filter(function (p) { return p.role === 'agent'; }); }
  function renderPeople() {
    // entry + voucher dropdowns — Master's own people ONLY. Agent
    // bettors never list here (privacy rule); the voucher dropdown
    // gets one row per agent instead, e.g. "(Agent) Agent 1".
    var vis = visiblePeople();
    var opts = vis.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + (p.role === 'akan' ? ' (အကန်)' : '') + '</option>';
    }).join('');
    var agentOpts = agentCodesInSession().map(function (c) {
      return '<option value="agent:' + esc(c) + '">' + esc(agentLabel(c)) + '</option>';
    }).join('');
    var ep = $('entryPerson'), vp = $('voucherPerson');
    var keepE = ep.value, keepV = vp.value;
    var agentEntryOpts = entryAgentRows().map(function (p) {
      return '<option value="' + p.id + '">' + esc('(Agent) ' + p.name) + '</option>';
    }).join('');
    ep.innerHTML = (vis.length || agentEntryOpts) ? (opts + agentEntryOpts) : '<option value="">—</option>';
    restoreSel(ep, keepE);
    vp.innerHTML = (vis.length || agentOpts) ? (opts + agentOpts) : '<option value="">—</option>';
    restoreSel(vp, keepV);
    // list (registry rows included, tagged; agent bettors excluded)
    var listVis = listPeople();
    $('peopleList').innerHTML = listVis.map(function (p) {
      return '<div class="prow" data-pid="' + p.id + '">' + (p.role === 'akan' ? '<span class="tag">အကန်</span>' : '') + (p.role === 'agent' ? '<span class="tag">Agent</span>' : '') + '<span class="nm">' + esc(p.name) + '</span>' +
        '<span>အဆ ' + esc(fmt(p.payout)) + (p.tote ? '-' + esc(fmt(p.tote)) : '') + '</span><span>ကော် ' + esc(fmt(p.commission)) + '%</span>' + (p.closedLimit != null ? '<span>ပိတ် ' + esc(fmt(p.closedLimit)) + '</span>' : '') + '</div>';
    }).join('');
    // Long-press a row (Pho Oct 22): edit / delete menu, same pattern
    // as the voucher line menu.
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
  // Pho Oct 22: numbers only - the dash inserts itself after the
  // 3-digit payout ("55010" -> "550-10"). His keyboard has no '/'.
  $('pPayout').addEventListener('input', function () {
    var d = normNum($('pPayout').value).replace(/\D/g, '');
    $('pPayout').value = d.length >= 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
  });

  $('addPersonBtn').addEventListener('click', function () {
    var name = $('pName').value.trim();
    // One field carries both rates: payout/tote, e.g. "550/10" (Pho Oct 22).
    var pr = normNum($('pPayout').value).split(/[\/-]/); // Pho's keyboard has no '/', so '-' works too
    var payout = Number(pr[0]);
    var tote = pr.length > 1 ? Number(pr[1]) : 0;
    var comm = Number(normNum($('pComm').value));
    if (!name || !(payout > 0) || !($('pComm').value.trim())) {
      $('peopleStatus').textContent = 'အမည် / အဆ / ကော် အကုန် ဖြည့်ပါ';
      return;
    }
    var pcEl = $('pClosed');
    var closedLimit = (pcEl && pcEl.value.trim() !== '') ? Number(normNum(pcEl.value)) : null;
    var np = { id: uid(), name: name, payout: payout, tote: tote, commission: comm, role: $('pRole').value, closedLimit: closedLimit };
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
      $('entryStatus').textContent = (visiblePeople().length || entryAgentRows().length)
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
  $('board').addEventListener('input', hideExcl);
  $('entryPerson').addEventListener('change', hideExcl);

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

  /* ---------- quick keyboard (mock-approved layout, Oct 24) ---------- */
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

  /* ---------- photo scan intake (Pho Oct 22) ----------
     Pick a photo -> cloud OCR (ocr.space engine 3, handwriting) ->
     cleaned DRAFT lines appended to the board. Nothing is saved by the
     scan: Pho checks every line on the board, then presses Save.
     Cleanup never invents an amount: bare numbers are grouped into one
     list line WITHOUT a price; totals/symbol-only lines are dropped. */
  function scanCleanup(text) {
    var out = [], bareRun = [];
    function flushBare() {
      if (bareRun.length) { out.push(bareRun.join(',')); bareRun = []; }
    }
    String(text || '').split(/\r?\n/).forEach(function (ln) {
      var s = ln.replace(/[^0-9.\- ]/g, '').replace(/\s+/g, '');
      var m = s.match(/^(\d{3})[-.](\d{3,})$/);
      if (m) { flushBare(); out.push(m[1] + '=' + m[2]); return; }
      if (/^\d{3}$/.test(s)) { bareRun.push(s); return; }
      if (/^\d{3}[-.]$/.test(s)) { bareRun.push(s.slice(0, 3)); return; }
      // anything else (totals, separators, junk) is not a bet line: drop
    });
    flushBare();
    return out.length ? out.join('\n') + '\n' : '';
  }
  window.ScanClean = scanCleanup;

  function shrinkImage(file) {
    return new Promise(function (resolve) {
      var url, img = new Image();
      var done = false;
      function fin(b) { if (!done) { done = true; resolve(b || file); } }
      try { url = URL.createObjectURL(file); } catch (e) { return fin(null); }
      img.onload = function () {
        try {
          var max = 1600, w = img.width, hgt = img.height;
          var sc = Math.min(1, max / Math.max(w, hgt));
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * sc); cv.height = Math.round(hgt * sc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          if (cv.toBlob) cv.toBlob(function (b) { fin(b); }, 'image/jpeg', 0.85);
          else fin(null);
        } catch (e) { fin(null); }
      };
      img.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 4000);
      img.src = url;
    });
  }

  function ocrImage(blob) {
    var fd = new FormData();
    fd.append('file', blob, 'scan.jpg');
    fd.append('apikey', 'helloworld');
    fd.append('OCREngine', '3');
    fd.append('scale', 'true');
    return fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        if (!d || !d.ParsedResults || !d.ParsedResults.length) throw new Error('ocr');
        return d.ParsedResults[0].ParsedText || '';
      });
  }

  on('scanBtn', 'click', function () { var sf = $('scanFile'); if (sf) sf.click(); });
  on('scanFile', 'change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    $('entryStatus').textContent = 'စကန် ဖတ် နေ တယ်…';
    shrinkImage(f).then(ocrImage).then(function (text) {
      var draft = scanCleanup(text);
      if (!draft) {
        $('entryStatus').textContent = 'စကန် က ဘာ မှ မဖတ် ရ — ပုံ ကြည် အောင် ပြန် ရိုက် ပါ';
        return;
      }
      var b = $('board');
      b.value = (b.value.trim() ? b.value.replace(/\n*$/, '\n') : '') + draft;
      parseBoard();
      $('entryStatus').textContent = 'စကန် ပြီး — ဘုတ် မှာ တိုက် စစ် ပါ';
    }).catch(function () {
      $('entryStatus').textContent = 'စကန် မရ — internet စစ် ပြီး ပြန် ကြိုး စား ပါ';
    });
  });

  // In-app hedge transfer (Pho Oct 22): the clipboard round-trip
  // (copy over-limit text -> paste on the entry board) is blocked by
  // Chrome, so the excess lines go straight from app state to the board.
  on('overBtn', 'click', function () {
    if (!overLines) { $('entryStatus').textContent = 'အကျွံ မရှိ'; return; }
    var b = $('board');
    b.value = (b.value.trim() ? b.value.replace(/\n*$/, '\n') : '') + overLines + '\n';
    parseBoard();
    $('entryStatus').textContent = 'အကျွံ ထည့်ပြီး — စစ် ပြီး သိမ်းပါ';
  });

  // Session lock (Pho Oct 24): once the winning number is entered,
  // the session's bets are frozen - no new entries, edits or deletes.
  // The winning number itself can still be corrected on its screen.
  function winLocked() { var s = sess(); return !!(s && (s.winning || s.closed)); }
  var LOCK_MSG = '\u1015\u1031\u102b\u1000\u103a\u101e\u102e\u1038 \u1011\u100a\u103a\u1037\u1015\u103c\u102e\u1038';
  function lockPrefix() { var s = sess(); return (s && s.winning) ? LOCK_MSG : 'ပွဲစဉ် ပိတ်ထားသည်'; }
  function renderCloseToggle() {
    var b = $('closeToggle'); if (!b) return;
    var s = sess();
    if (s && s.closed) { b.textContent = '\u1015\u102d\u1010\u103a\u1011\u102c\u1038\u101e\u100a\u103a \u00b7 \u1015\u103c\u1014\u103a\u1016\u103d\u1004\u103a\u1037\u1019\u100a\u103a'; b.className = 'sbtn'; }
    else { b.textContent = 'ပွဲစဉ် ပိတ်မည်'; b.className = 'danger'; }
  }
  on('closeToggle', 'click', function () {
    var s = sess(); if (!s) return;
    s.closed = !s.closed;
    /* closedAt (Pho Oct 31): the close moment — server pushes created
       before it still ledger; pushes after it never do. */
    s.closedAt = s.closed ? Date.now() : null;
    Q('update', '3d_sessions', s.id, s); save(); renderCloseToggle(); render();
  });

  $('exclSaveBtn').addEventListener('click', function () {
    if (!exclPending) return;
    var nums = exclPending.all || [exclPending.n];
    hideExcl();
    var out = $('board').value.split('\n').map(function (ln) {
      var r = parseLine(ln);
      if (!r.ok) return ln;
      var hit = r.items.filter(function (it) { return nums.indexOf(it.number) >= 0; }).map(function (it) { return it.number; });
      var uniq = hit.filter(function (x, i) { return hit.indexOf(x) === i; });
      if (!uniq.length) return ln;
      return ln + '{-' + uniq.join('/') + '}';
    });
    $('board').value = out.join('\n');
    parseBoard();
    if (!lastParse.every(function (r) { return r.ok; })) { $('entryStatus').textContent = 'ပုံစံ မမှန် — ပြန် စစ် ပါ'; return; }
    $('saveBtn').click();
  });

  $('saveBtn').addEventListener('click', function () {
    hideExcl();
    if (winLocked()) { $('entryStatus').textContent = lockPrefix() + ' — ထိုး မရတော့ပါ'; return; }
    var pid = $('entryPerson').value;
    if (!pid) return;
    var valid = lastParse.filter(function (r) { return r.ok; });
    if (!valid.length) return;
    var s = sess();
    var newItems = [];
    valid.forEach(function (r) { r.items.forEach(function (it) { newItems.push(it); }); });
    // Master agent entry (Pho Oct 31): selecting an agent row enters
    // under the agent name — no bettor split. The aggregate cap
    // (agentClosedViolation) applies, not the per-person check.
    var selPerson = person(pid);
    var selAgentCode = (selPerson && selPerson.agentId) || null;
    var badC = selAgentCode ? agentClosedViolation(selAgentCode, newItems, null) : closedViolation(pid, newItems, null);
    if (badC) { showExcl(badC); return; }
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
          formula: r.formula, isFormula: r.kind !== 'single',
          agentId: selAgentCode
        };
        state.records.push(rec);
        Q('create', '3d_records', rec.id, rec);
      });
    });
    // Pho Oct 22: only the saved (green) lines leave the board —
    // invalid (red) lines STAY so they can be fixed and resubmitted.
    var leftover = lastParse.filter(function (r) { return !r.ok && r.formula; })
      .map(function (r) { return r.formula; }).join('\n');
    $('board').value = leftover;
    parseBoard();
    save(); render();
    $('entryStatus').textContent = 'NO ' + batchNo + ' သိမ်းပြီး' +
      (leftover ? ' — နီ တဲ့ လိုင်း ကျန် နေ တယ်' : '');
  });

  /* ---------- ledger ---------- */
  var hundred = 0;
  // Tote set of a session's winning number (Pho's canon): its other
  // permutations + the whole number -1/+1. Null when no winning set.
  function toteSetOf(s) {
    if (!s.winning) return null;
    var set = {};
    Parser3D.perms3(s.winning[0], s.winning[1], s.winning[2]).forEach(function (n) { if (n !== s.winning) set[n] = 1; });
    var wv = parseInt(s.winning, 10);
    if (wv > 0) set[String(wv - 1).padStart(3, '0')] = 1;
    if (wv < 999) set[String(wv + 1).padStart(3, '0')] = 1;
    return set;
  }

  function renderLedger() {
    var s = sess();
    $('limitBtn').textContent = 'Limit ' + fmt(s.limit);
    $('digits').innerHTML = BUR.map(function (d, i) {
      return '<div class="dig' + (i === hundred ? ' on' : '') + '" data-h="' + i + '">' + i + '</div>';
    }).join('');
    document.querySelectorAll('#digits .dig').forEach(function (el) {
      el.addEventListener('click', function () { hundred = Number(el.getAttribute('data-h')); renderLedger(); });
    });
    var totals = totalsByNumber();
    var ltset = toteSetOf(s);
    // Pho Oct 31 (net total): All Total = net sum over all numbers,
    // negatives included — an over-hedged number reduces the total, so it
    // reconciles with home တက်ငွေ. Grid cells still show negatives hed.
    var tSum = 0;
    Object.keys(totals).forEach(function (k) { tSum += totals[k]; });
    $('ledTotal').textContent = fmt(tSum);
    // Trade custom (Pho Oct 22): the count is an exposure gauge, NOT a
    // number/line count - akwets = All Total / Limit (floor).
    // 700,600 / 19,000 = 36 akwets; 100,000 / 5,000 = 20.
    $('ledCount').textContent = fmt(s.limit > 0 ? Math.floor(tSum / s.limit) : 0);
    var html = '';
    for (var i = 0; i < 100; i++) {
      var num = String(hundred * 100 + i).padStart(3, '0');
      var amt = totals[num] || 0;
      var cls = 'cell';
      if (amt < 0) cls += ' hed';
      if (amt > s.limit) cls += ' hot';
      if (ltset && ltset[num]) cls += ' tote';
      if (s.winning && s.winning === num) cls += ' win';
      html += '<div class="' + cls + '"><div class="n">' + num + '</div><div class="a">' +
        (amt ? fmt(amt) : '—') + '</div></div>';
    }
    $('ledgerGrid').innerHTML = html;
  }
  $('limitBtn').addEventListener('click', function () {
    $('limitInput').value = sess().limit;
    $('limitModal').classList.remove('hidden');
  });
  $('limitCancel').addEventListener('click', function () { $('limitModal').classList.add('hidden'); });
  $('limitSave').addEventListener('click', function () {
    var v = Number($('limitInput').value);
    if (v > 0) { sess().limit = v; Q('update', '3d_sessions', sess().id, sess()); save(); }
    $('limitModal').classList.add('hidden');
    render();
  });

  /* ---------- winning ---------- */
  $('winBtn').addEventListener('click', function () {
    var v = normNum($('winInput').value.trim());
    if (!/^\d{3}$/.test(v)) { $('winStatus').textContent = 'ဂဏန်း ၃ လုံး ထည့်ပါ'; return; }
    sess().winning = v; Q('update', '3d_sessions', sess().id, sess()); save();
    $('winStatus').textContent = 'ပေါက်သီး ' + v;
    render();
  });

  /* ---------- daily summary ---------- */
  function renderDaily() {
    var s = sess();
    var recs = sessRecords();
    if (!recs.length) { $('dailyBox').innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
    // Tote set of the winning number (Pho's canon): its other
    // permutations + the whole number -1/+1 (789 -> 788, 790).
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
    var agentAgg = {}, agentOrder = [];
    state.people.forEach(function (p) {
      var d = byPerson[p.id];
      if (!d) return;
      var pay = d.win * p.payout + d.tote * (p.tote || 0);
      // bettors PLUS / akan MINUS (Pho hand-verified Oct 23: NN 104,100 @25% + tote 6,000x10 = -18,075)
      var net = p.role === 'akan'
        ? -d.bet * (1 - p.commission / 100) + pay
        : d.bet * (1 - p.commission / 100) - pay;
      T.bet += d.bet; T.win += d.win; T.tote += d.tote;
      if (isAgentPerson(p)) {
        // Agent bettors roll up under the agent's name ONLY (privacy
        // rule) — their names and rates never render. The agent
        // row's net is settled at the AGENT's Master-set terms
        // below, not at bettor rates (bettorNet is only the
        // fallback until terms are set).
        if (!agentAgg[p.agentId]) { agentAgg[p.agentId] = { bet: 0, win: 0, tote: 0, bettorNet: 0, net: 0 }; agentOrder.push(p.agentId); }
        var a = agentAgg[p.agentId];
        a.bet += d.bet; a.win += d.win; a.tote += d.tote; a.bettorNet += net;
        return;
      }
      T.net += net;
      var nc = net < 0 ? 'neg' : (net > 0 ? 'pos' : '');
      rows += '<tr><td>' + (p.role === 'akan' ? '<span class="tag">အကန်</span> ' : '') + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td>' + fmt(d.tote) +
        '</td><td class="' + nc + '">' + fmt(net) + '</td></tr>';
    });
    agentOrder.forEach(function (code) {
      var a = agentAgg[code];
      // Master-set agent terms (Pho Oct 24): if Master registered
      // this agent with terms (payout > 0), settle the whole agent
      // total at those terms; otherwise fall back to bettor math.
      var ap = agentPersonFor(code);
      if (ap && ap.payout > 0) a.net = a.bet * (1 - ap.commission / 100) - a.win * ap.payout - a.tote * (ap.tote || 0);
      else a.net = a.bettorNet;
      T.net += a.net;
      var nc = a.net < 0 ? 'neg' : (a.net > 0 ? 'pos' : '');
      rows += '<tr><td>' + esc(agentLabel(code)) + '</td><td>' + fmt(a.bet) + '</td><td>' + fmt(a.win) +
        '</td><td>' + fmt(a.tote) +
        '</td><td class="' + nc + '">' + fmt(a.net) + '</td></tr>';
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

  /* ---------- vouchers ---------- */
  /* ---------- voucher copy (Pho Oct 31): Copy on a NO row copies that NO batch ---------- */
  var vcopyTexts = {};
  function copyVoucherText(text, btn) {
    var old = btn ? btn.textContent : '';
    function done(ok) {
      if (!btn) return;
      btn.textContent = ok ? 'Copy ပြီး' : 'ကူးမရပါ';
      setTimeout(function () { btn.textContent = old; }, 1500);
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta); done(!!ok);
      } catch (e) { done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else fallback();
  }
  $('voucherPerson').addEventListener('change', renderVoucher);
  function renderVoucher() {
    var s = sess();
    var vtset = toteSetOf(s);
    var pid = $('voucherPerson').value;
    var box = $('voucherBox');
    if (!pid) { box.innerHTML = '<div class="empty">လူ မရှိသေး</div>'; return; }
    // batches = [{no, lines: [[recs of one line]...]}]. Person view
    // groups by batchNo; agent view (privacy rule) groups by save
    // (lineId) under the agent's name — never by bettor.
    var batches = [];
    if (pid.indexOf('agent:') === 0) {
      var code = pid.slice(6);
      var arecs = sessRecords().filter(function (r) { return r.agentId === code; });
      if (!arecs.length) { box.innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
      // Group by SAVE (person + batchNo), in first-seen order — one
      // NO per save, so Master sees the same batches the Agent sees
      // (and acks them per save). v43 grouped by lineId, which split
      // a multi-line save into several NOs.
      var bySave = {}, order = [];
      arecs.forEach(function (r) {
        var k = r.personId + '|' + r.batchNo;
        if (!bySave[k]) { bySave[k] = { personId: r.personId, batchNo: r.batchNo, lines: {}, lineOrder: [] }; order.push(k); }
        var sv = bySave[k];
        if (!sv.lines[r.lineId]) { sv.lines[r.lineId] = []; sv.lineOrder.push(r.lineId); }
        sv.lines[r.lineId].push(r);
      });
      order.forEach(function (k, i) {
        var sv = bySave[k];
        batches.push({ no: i + 1, lines: sv.lineOrder.map(function (lid) { return sv.lines[lid]; }),
          ok: !!state.ackedKeys[ackKey(s.id, code, sv.personId, sv.batchNo)] });
      });
    } else {
      var recs = sessRecords().filter(function (r) { return r.personId === pid; });
      if (!recs.length) { box.innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
      var bmap = {};
      recs.forEach(function (r) { (bmap[r.batchNo] = bmap[r.batchNo] || []).push(r); });
      Object.keys(bmap).map(Number).sort(function (a, b) { return a - b; }).forEach(function (bn) {
        var rows = bmap[bn];
        var lines = [], seen = {};
        rows.forEach(function (r) {
          if (!seen[r.lineId]) { seen[r.lineId] = []; lines.push(seen[r.lineId]); }
          seen[r.lineId].push(r);
        });
        batches.push({ no: bn, lines: lines });
      });
    }
    var html = '';
    batches.forEach(function (b) {
      var body = '', total = 0, tlines = [];
      b.lines.forEach(function (lineRecs, li) {
        var lt = lineRecs.reduce(function (a, r) { return a + r.amount; }, 0);
        total += lt;
        var label = esc(lineRecs[0].formula);
        if (lineRecs[0].isFormula || lineRecs.length > 1) label += ' (' + lineRecs.length + ')';
        var tlabel = lineRecs[0].formula;
        if (lineRecs[0].isFormula || lineRecs.length > 1) tlabel += ' (' + lineRecs.length + ')';
        tlines.push(tlabel + ' ' + fmt(lt));
        var xid = 'x' + b.no + '-' + li;
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
      vcopyTexts[b.no] = ($('voucherPerson').selectedOptions[0] ? $('voucherPerson').selectedOptions[0].textContent : '') + '\n' + (s.date || '') + '\nNO ' + b.no + '\n' + tlines.join('\n') + '\nTotal ' + fmt(total);
      html += '<div class="vbatch"><div class="vhead">NO ' + b.no + (b.ok ? ' <span class="pos">ok</span>' : '') + '<button class="vcopy" data-no="' + b.no + '" style="float:right;background:#3a3b41;color:#ffd970;border:1px solid #55565e;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700">Copy</button></div>' +
        '<table class="vt">' + body + '</table></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.vcopy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = vcopyTexts[btn.getAttribute('data-no')];
        if (t) copyVoucherText(t, btn);
      });
    });
    box.querySelectorAll('.vline').forEach(function (tr) {
      tr.addEventListener('click', function () {
        if (suppressClick) { suppressClick = false; return; }
        var x = document.getElementById(tr.getAttribute('data-x'));
        if (x) x.style.display = x.style.display === 'none' ? 'table-row' : 'none';
      });
      // Long-press (Pho Oct 22): action menu - edit / delete this line.
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
    // Pho Oct 25: agent bettors have no per-person hot limit (Agent-side
    // removal) — the agent-aggregate cap below is their only cap.
    var badL = recs[0].agentId ? null : closedViolation(recs[0].personId, r.items, menuLineId);
    var badA = recs[0].agentId ? agentClosedViolation(recs[0].agentId, r.items, menuLineId) : null;
    if (badA) { $('lmHint').textContent = 'ပိတ်ဂဏန်း ' + (badA.all || [badA.n]).join('/') + exclTag(badA); return; }
    if (badL) { $('lmHint').textContent = 'ပိတ်ဂဏန်း ' + (badL.all || [badL.n]).join('/') + exclTag(badL); return; }
    var first = recs[0];
    var idx = state.records.indexOf(first);
    state.records = state.records.filter(function (x) { return x.lineId !== menuLineId; });
    var newLineId = uid();
    var newRecs = r.items.map(function (it) {
      return {
        id: uid(), sessionId: first.sessionId, personId: first.personId,
        batchNo: first.batchNo, lineId: newLineId, number: it.number,
        amount: it.amount, formula: r.formula, isFormula: r.kind !== 'single',
        // Preserve agent ownership on edit — otherwise an edited agent
        // line would lose its agentId and leak into Master views.
        agentId: first.agentId || null
      };
    });
    // Splice back at the same position so voucher line order never moves.
    recs.forEach(function (r) { Q('delete', '3d_records', r.id, null); });
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
    $('pmTitle').textContent = p.name + (p.role === 'akan' ? ' (\u1021\u1000\u1014\u103a)' : '');
    $('pmView').style.display = 'block';
    $('pmEdit').style.display = 'none';
    $('personMenu').style.display = 'flex';
  }
  on('pmCloseBtn', 'click', closePersonMenu);
  on('personMenu', 'click', function (e) { if (e.target === $('personMenu')) closePersonMenu(); });
  on('pmDelBtn', 'click', function () {
    var p = person(menuPersonId); if (!p) return closePersonMenu();
    var n = state.records.filter(function (r) { return r.personId === p.id; }).length;
    if (!confirm('\u1012\u102e \u101c\u1030 \u1016\u103b\u1000\u103a \u1019\u101c\u102c\u1038? ' + p.name + (n ? ' \u2014 \u1005\u102c\u101b\u1004\u103a\u1038 ' + n + ' \u1001\u102f \u101b\u103e\u102d \u1014\u1031 \u1010\u101a\u103a, \u1021\u1032 \u1005\u102c\u101b\u1004\u103a\u1038 \u1010\u103d\u1031 \u1015\u102b \u1015\u103b\u1031\u102c\u1000\u103a \u1019\u101a\u103a' : ''))) return;
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
    $('pmRole').value = p.role;
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
      $('pmHint').textContent = '\u1021\u1019\u100a\u103a / \u1021\u1006 / \u1000\u1031\u102c\u103a \u1021\u1000\u102f\u1014\u103a \u1016\u103c\u100a\u1037\u203a\u1015\u102b';
      return;
    }
    p.name = name; p.role = (p.role === 'agent' ? 'agent' : $('pmRole').value); p.payout = payout; p.tote = tote;
    p.commission = Number(normNum(commRaw));
    var pcv = $('pmClosed').value.trim();
    var cl = Number(normNum(pcv));
    p.closedLimit = (pcv === '' || isNaN(cl)) ? null : cl;
    Q('update', '3d_people', p.id, p);
    save(); render(); closePersonMenu();
  });

  /* ---------- blocked numbers (Pho Oct 22) ---------- */
  function blockedNums() { var s = sess(); if (!s.blocked) s.blocked = []; return s.blocked; }
  function renderBlocked() {
    var box = $('blockedList'); if (!box) return;
    var list = blockedNums();
    box.innerHTML = list.length
      ? '<div class="bchips">' + list.map(function (n) {
          return '<span class="bchip" data-unblock="' + n + '">' + n + ' \u00d7</span>';
        }).join('') + '</div>'
      : '<div class="empty">\u1015\u102d\u1010\u103a \u1002\u100f\u1014\u103a\u1038 \u1019\u101b\u103e\u102d</div>';
    box.querySelectorAll('[data-unblock]').forEach(function (el) {
      el.addEventListener('click', function () {
        var n = el.getAttribute('data-unblock');
        sess().blocked = blockedNums().filter(function (x) { return x !== n; });
        Q('update', '3d_sessions', sess().id, sess());
        save(); renderBlocked();
      });
    });
  }
  on('blockedAdd', 'click', function () {
    var v = normNum($('blockedInput').value);
    var found = v.match(/\d{3}/g) || [];
    var list = blockedNums(), added = 0;
    found.forEach(function (n) { if (list.indexOf(n) < 0) { list.push(n); added++; } });
    $('blockedInput').value = '';
    $('blockedStatus').textContent = added ? added + ' \u101c\u102f\u1036\u1038 \u1011\u100a\u1037\u103a\u1015\u103c\u102e\u1038' : '\u1002\u100f\u1014\u103a\u1038 \u1043 \u101c\u102f\u1036\u1038 \u1011\u100a\u1037\u103a\u1015\u102b';
    Q('update', '3d_sessions', sess().id, sess());
    save(); renderBlocked();
  });
  // Per-person closed-number cap: ONLY for numbers on the Home closed
  // list, ONLY when the person has a limit set (blank = no limit).
  // Block UI (Pho Oct 25): short message + one-tap exclude-and-save.
  // No long explanation (Pho: 'စာတွေများလွန်းတယ်, Appရှုပ်တယ်').
  var exclPending = null;
  function exclTag(bad) { return ' {-'+(bad.all || [bad.n]).join('/')+'}'; }
  function hideExcl() { exclPending = null; var b = $('exclSaveBtn'); if (b) b.style.display = 'none'; }
  function showExcl(bad) {
    exclPending = bad;
    $('entryStatus').textContent = 'ပိတ်ဂဏန်း ' + (bad.all || [bad.n]).join('/');
    var b = $('exclSaveBtn'); if (b) b.style.display = '';
  }
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
    var bad = null, all = [];
    Object.keys(sums).forEach(function (n) {
      var tot = (existing[n] || 0) + sums[n];
      if (tot > p.closedLimit) { if (!bad) bad = { n: n, cap: p.closedLimit, tot: tot }; all.push(n); }
    });
    if (bad) bad.all = all;
    return bad;
  }
  // Agent aggregate hot-limit (Pho Oct 24): the agent-person's
  // closedLimit caps the AGENT's total for blocked-list numbers
  // across all its bettors in the session (not per bettor).
  function agentClosedViolation(code, items, excludeLineId) {
    var ap = agentPersonFor(code);
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
    var bad = null, all = [];
    Object.keys(sums).forEach(function (n) {
      var tot = (existing[n] || 0) + sums[n];
      if (tot > ap.closedLimit) { if (!bad) bad = { n: n, cap: ap.closedLimit, tot: tot }; all.push(n); }
    });
    if (bad) bad.all = all;
    return bad;
  }

  /* ---------- over-limit ---------- */
  var overLines = '';
  function renderOver() {
    var s = sess();
    var totals = totalsByNumber();
    var rows = Object.keys(totals)
      .filter(function (n) { return totals[n] > s.limit; })
      .sort(function (a, b) { return totals[b] - totals[a]; });
    overLines = rows.map(function (n) { return n + '=' + (totals[n] - s.limit); }).join('\n');
    $('overCopyBtn').style.display = rows.length ? 'block' : 'none';
    if (!rows.length) { $('overBox').innerHTML = '<div class="empty">မရှိသေး</div>'; return; }
    var html = '<table class="grid"><tr><th>ဂဏန်း</th><th>စုစုပေါင်း</th><th>အကျွံ</th></tr>';
    rows.forEach(function (n) {
      html += '<tr><td>' + n + '</td><td>' + fmt(totals[n]) + '</td><td class="neg">' +
        fmt(totals[n] - s.limit) + '</td></tr>';
    });
    $('overBox').innerHTML = html + '</table>';
  }
  $('overCopyBtn').addEventListener('click', function () {
    if (!overLines) return;
    var ta = $('overText');
    ta.value = overLines;
    ta.style.display = 'block';
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) {}
    function done(ok) { $('overStatus').textContent = ok ? 'Copy ပြီး' : 'အပေါ်က စာကို ရွေး copy ပါ'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(overLines).then(function () { done(true); }, function () {
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
      });
    } else {
      try { done(document.execCommand('copy')); } catch (e) { done(false); }
    }
  });

  /* ---------- settings ---------- */
  $('resetBtn').addEventListener('click', function () {
    if (!confirm('အကုန် ရှင်းမလား?')) return;
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem('3dMasterQueue');
    localStorage.removeItem('3dMasterAuth');
    localStorage.removeItem('3dMasterMeta');
    location.reload();
  });

  /* ---------- server login (Master owns the server copy) ---------- */
  on('serverLoginBtn', 'click', function () {
    if (!window.Sync3D) return;
    var em = $('serverEmail').value.trim(), pw = $('serverPass').value;
    if (!em || !pw) { renderSyncStatus('Email / password ထည့်ပါ'); return; }
    renderSyncStatus('Login နေ တယ်…');
    window.Sync3D.login(em, pw).then(function () {
      $('serverPass').value = '';
      window.Sync3D.repushOnce(state, 'master'); /* push pre-sync local data once */
      window.Sync3D.syncNow(state, syncAfter, '').then(function () { renderSyncStatus(); render(); });
      window.Sync3D.startAutoSync(state, syncAfter, '', function () { renderSyncStatus(); render(); });
      refreshAgentNames();
      renderSyncStatus('Login အိုကေ — sync နေ တယ်…');
    }).catch(function (e) {
      renderSyncStatus('Login မရ: ' + (e.message || e));
    });
  });
  on('serverLogoutBtn', 'click', function () {
    if (window.Sync3D) window.Sync3D.logout();
    buyerListLoaded = false; myAgentListLoaded = false;
    renderSyncStatus(); render();
  });
  on('syncNowBtn', 'click', syncNowUI);

  /* ---------- buyers + agents (Pho only, mirrors 2D) ----------
     Prerequisite: 3d_agents API rules carry a Pho-email exception
     (like 2D users), otherwise cross-tenant creates/updates are
     denied. Agent limit is 5 per tenant by default, stored in
     app_settings as agent_limit_<tenantId> (2D mirror); Pho raises
     it from the Buyer list. Direct PB calls (not the
     sync queue): buyer/agent management is admin work, and the
     queue only carries sessions/people/records. */
  var PB_BASE = 'https://2d.skylinkvpn.stream/api';
  function pbToken() {
    try { var a = JSON.parse(localStorage.getItem('3dMasterAuth') || 'null'); return a && a.token; } catch (e) { return null; }
  }
  function pbReq(method, path, body) {
    var tok = pbToken();
    if (!tok) return Promise.reject(new Error('Server login မဝင်ရသေး'));
    return fetch(PB_BASE + path, {
      method: method,
      headers: { Authorization: tok, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok) {
          var m = (d && d.message) || ('error ' + res.status);
          if (d && d.data) { try { m += ' | ' + JSON.stringify(d.data).slice(0, 200); } catch (e) {} }
          throw new Error(m);
        }
        return d;
      });
    });
  }
  function pbList(coll, params) {
    var q = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return pbReq('GET', '/collections/' + coll + '/records' + (q ? '?' + q : ''));
  }
  function isPho() {
    if (!window.Sync3D || !window.Sync3D.isLoggedIn()) return false;
    var u = window.Sync3D.getUser();
    return !!(u && u.email === 'johnzyt7@gmail.com');
  }
  function randChars(chars, n) {
    var out = '', rnd = new Uint8Array(n);
    crypto.getRandomValues(rnd);
    for (var i = 0; i < n; i++) out += chars[rnd[i] % chars.length];
    return out;
  }
  function agent3dEmail(tid, n) { return 'agent3d_' + tid + '_' + n + '@3d.local'; }
  function agent3dPass(tid, n, secret) { return 'Ag3D_' + tid + '_' + n + '_' + secret; }
  function agent3dCode(tid, n, secret) { return tid + '-' + n + '-' + secret; }
  function agentNumFromCode(code) {
    var m = String(code || '').match(/^[^-]+-(\d+)-/);
    return m ? parseInt(m[1], 10) : 0;
  }
  var buyerListLoaded = false, myAgentListLoaded = false;
  function renderBuyerSec() {
    var sec = $('buyerSec'); if (sec) {
      if (!isPho()) { sec.style.display = 'none'; }
      else { sec.style.display = ''; if (!buyerListLoaded) { buyerListLoaded = true; renderBuyerList(); } }
    }
    // Own-agent section (2D mirror): EVERY logged-in Master user
    // manages their own tenant's agents here; Pho additionally has
    // the cross-tenant Buyer section above.
    var my = $('myAgentsSec'); if (my) {
      if (!window.Sync3D || !window.Sync3D.isLoggedIn()) { my.style.display = 'none'; }
      else { my.style.display = ''; if (!myAgentListLoaded) { myAgentListLoaded = true; renderMyAgentList(); } }
    }
  }
  function buyerTenantOf(u) { return typeof u.tenant === 'string' ? u.tenant : (u.tenant && u.tenant.id); }
  /* ---------- agent limit (2D mirror) ----------
     Default 5 agents per tenant. The per-tenant limit lives in
     app_settings as agent_limit_<tenantId> (2D's key); Pho raises
     it from the Buyer list, and the buyer can then self-create
     more agents within the new limit. A failed limit read falls
     back to 5 (safe default, never unlimited). */
  var DEFAULT_MAX_AGENTS = 5;
  function getAgentLimit(tid) {
    var key = 'agent_limit_' + tid;
    return pbList('app_settings', { filter: 'key="' + key + '"', perPage: 1 }).then(function (res) {
      var item = (res.items || [])[0];
      if (item && item.value) { var n = parseInt(item.value, 10); if (n >= 1 && n <= 99) return n; }
      return DEFAULT_MAX_AGENTS;
    }).catch(function () { return DEFAULT_MAX_AGENTS; });
  }
  function setAgentLimit(tid, limit) {
    var key = 'agent_limit_' + tid;
    return pbList('app_settings', { filter: 'key="' + key + '"', perPage: 1 }).then(function (res) {
      var item = (res.items || [])[0];
      if (item) return pbReq('PATCH', '/collections/app_settings/records/' + encodeURIComponent(item.id), { value: String(limit) });
      return pbReq('POST', '/collections/app_settings/records', { key: key, value: String(limit), tenant: tid });
    });
  }
  function ownTenant() { var t = window.Sync3D ? window.Sync3D.getTenant() : null; if (t && typeof t === 'object') t = t.id; return t || ''; }
  function ownShop() { var u = window.Sync3D ? window.Sync3D.getUser() : null; return (u && u.name) || ''; }
  function renderBuyerList() {
    var box = $('buyerList'); if (!box) return;
    box.innerHTML = '<div class="status">တင်နေတယ်…</div>';
    var limitMap = {};
    pbList('app_settings', { filter: 'key ~ "agent_limit_"', perPage: 100 }).then(function (r) {
      (r.items || []).forEach(function (it) { var t = (it.key || '').replace('agent_limit_', ''); limitMap[t] = parseInt(it.value, 10) || 5; });
    }).catch(function () {}).then(function () { return pbList('users', { perPage: 200 }); }).then(function (res) {
      var buyers = (res.items || []).filter(function (u) {
        var email = (u.email || '').toLowerCase();
        var name = (u.name || '').trim();
        if (email === 'johnzyt7@gmail.com') return false;
        if (name.toLowerCase().indexOf('agent ') === 0) return false;
        if (email.indexOf('agent3d_') === 0) return false;
        return true;
      });
      if (!buyers.length) { box.innerHTML = '<div class="status">Buyer မရှိသေးပါ</div>'; return; }
      var html = '';
      buyers.forEach(function (b) {
        var tid = buyerTenantOf(b) || '';
        var dis = !!b.disabled;
        var lim = limitMap[tid] || 5;
        var em = b.email || '';
        // Best-effort: buyers created before v46 never got
        // emailVisibility, so their emails hide (shows "undefined").
        // Enabling it here fixes the row on the next refresh.
        if (!b.email) pbReq('PATCH', '/collections/users/records/' + encodeURIComponent(b.id), { emailVisibility: true }).catch(function () {});
        html += '<div class="setrow"><span>' + esc(em ? em + ' · ' + (b.name || '') : (b.name || '')) + '</span><span class="' + (dis ? 'neg' : 'pos') + '">' + (dis ? 'ပိတ်' : 'ဖွင့်') + '</span></div>' +
          '<div class="btnrow">' +
          '<button class="btn ' + (dis ? 'gray' : '') + '" data-buyer-toggle="' + b.id + '" data-disable="' + (dis ? '0' : '1') + '">' + (dis ? 'ဖွင့်' : 'ပိတ်') + '</button>' +
          '<button class="btn gray" data-buyer-del="' + b.id + '" data-email="' + esc(em) + '">ဖျက်</button>' +
          '<button class="btn gray" data-limit-edit="' + esc(tid) + '" data-limit="' + lim + '">Agent ' + lim + ' ဦး ✏️</button></div>';
      });
      box.innerHTML = html;
      box.querySelectorAll('[data-buyer-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleBuyer(btn.getAttribute('data-buyer-toggle'), btn.getAttribute('data-disable') === '1');
        });
      });
      box.querySelectorAll('[data-buyer-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          deleteBuyer(btn.getAttribute('data-buyer-del'), btn.getAttribute('data-email'));
        });
      });
      box.querySelectorAll('[data-limit-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tid = btn.getAttribute('data-limit-edit');
          var cur = parseInt(btn.getAttribute('data-limit'), 10) || 5;
          var v = prompt('Agent limit အသစ် (1-99)', cur);
          var n = parseInt(v, 10);
          if (isNaN(n) || n < 1 || n > 99) return;
          setAgentLimit(tid, n).then(function () { renderBuyerList(); })
            .catch(function (e) { $('buyerStatus').textContent = 'မရဘူး: ' + (e.message || 'error'); });
        });
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="status">မရဘူး: ' + esc(e.message || 'error') + '</div>';
    });
  }
  function toggleBuyer(bid, disable) {
    if (!confirm('ဒီ buyer ကို ' + (disable ? 'ပိတ်' : 'ဖွင့်') + 'မလား? (agent လည်း ' + (disable ? 'ပိတ်' : 'ဖွင့်') + 'မယ်)')) return;
    pbReq('GET', '/collections/users/records/' + encodeURIComponent(bid)).then(function (buyer) {
      var tid = buyerTenantOf(buyer);
      return pbReq('PATCH', '/collections/users/records/' + encodeURIComponent(bid), { disabled: disable }).then(function () { return tid; });
    }).then(function (tid) {
      if (!tid) return;
      var jobs = [];
      jobs.push(pbList('users', { filter: 'email ~ "agent3d_' + tid + '_"', perPage: 100 }).then(function (res) {
        return Promise.all((res.items || []).map(function (a) {
          return pbReq('PATCH', '/collections/users/records/' + a.id, { disabled: disable }).catch(function () {});
        }));
      }).catch(function () {}));
      jobs.push(pbList('3d_agents', { filter: 'tenant="' + tid + '"', perPage: 100 }).then(function (res) {
        return Promise.all((res.items || []).map(function (a) {
          return pbReq('PATCH', '/collections/3d_agents/records/' + a.id, { disabled: disable }).catch(function () {});
        }));
      }).catch(function () {}));
      return Promise.all(jobs);
    }).then(function () {
      $('buyerStatus').textContent = disable ? 'ပိတ်ပြီးပြီ' : 'ဖွင့်ပြီးပြီ';
      renderBuyerList();
    }).catch(function (e) { $('buyerStatus').textContent = 'မရဘူး: ' + (e.message || 'error'); });
  }
  function deleteBuyer(bid, email) {
    if (!confirm('"' + email + '" ကို အပြီးဖျက်မလား? (agent တွေလည်း ပျက်မယ်, ပြန်မရဘူး)')) return;
    if (!confirm('သေချာလား? နောက်ဆုံး အကြိမ် မေးတာ')) return;
    pbReq('GET', '/collections/users/records/' + encodeURIComponent(bid)).then(function (buyer) {
      var tid = buyerTenantOf(buyer);
      var jobs = [];
      if (tid) {
        jobs.push(pbList('users', { filter: 'email ~ "agent3d_' + tid + '_"', perPage: 100 }).then(function (res) {
          return Promise.all((res.items || []).map(function (a) {
            return pbReq('DELETE', '/collections/users/records/' + a.id).catch(function () {});
          }));
        }).catch(function () {}));
        jobs.push(pbList('3d_agents', { filter: 'tenant="' + tid + '"', perPage: 100 }).then(function (res) {
          return Promise.all((res.items || []).map(function (a) {
            return pbReq('DELETE', '/collections/3d_agents/records/' + a.id).catch(function () {});
          }));
        }).catch(function () {}));
      }
      return Promise.all(jobs);
    }).then(function () {
      return pbReq('DELETE', '/collections/users/records/' + encodeURIComponent(bid));
    }).then(function () {
      $('buyerStatus').textContent = 'ဖျက်ပြီးပြီ';
      renderBuyerList();
    }).catch(function (e) { $('buyerStatus').textContent = 'မရဘူး: ' + (e.message || 'error'); });
  }
  function toggleAgent(aid, code, disable, tidArg) {
    if (!confirm('ဒီ agent ကို ' + (disable ? 'ပိတ်' : 'ဖွင့်') + 'မလား?')) return;
    var n = agentNumFromCode(code);
    var tid = tidArg;
    pbReq('PATCH', '/collections/3d_agents/records/' + encodeURIComponent(aid), { disabled: disable }).then(function () {
      if (tid && n) {
        return pbList('users', { filter: 'email="' + agent3dEmail(tid, n) + '"', perPage: 5 }).then(function (res) {
          var u = (res.items || [])[0];
          if (u) return pbReq('PATCH', '/collections/users/records/' + u.id, { disabled: disable }).catch(function () {});
        }).catch(function () {});
      }
    }).then(function () { renderMyAgentList(); })
    .catch(function (e) { $('buyerStatus').textContent = 'မရဘူး: ' + (e.message || 'error'); });
  }
  function deleteAgent(aid, code, tidArg) {
    if (!confirm('ဒီ agent (' + code + ') ကို အပြီးဖျက်မလား? သူ့လူတွေပါ အတွဲလိုက် ပျက်မယ်။')) return;
    var n = agentNumFromCode(code);
    var tid = tidArg;
    // Cascade (Pho Oct 31): deleting an agent deletes its whole set --
    // every 3d_people row with this agentId (bettors + the agent's own
    // terms row) -- FIRST. If any people delete fails, abort before
    // touching the login or agent row, so no new orphans are created.
    // Records stay (ledger history, not people).
    var job = pbList('3d_people', { filter: 'agentId="' + code + '"', perPage: 200 }).then(function (res) {
      var rows = res.items || [];
      var chain = Promise.resolve();
      rows.forEach(function (row) {
        chain = chain.then(function () {
          return pbReq('DELETE', '/collections/3d_people/records/' + encodeURIComponent(row.id));
        });
      });
      return chain;
    });
    if (tid && n) {
      job = job.then(function () {
        return pbList('users', { filter: 'email="' + agent3dEmail(tid, n) + '"', perPage: 5 }).then(function (res) {
          var u = (res.items || [])[0];
          if (u) return pbReq('DELETE', '/collections/users/records/' + u.id).catch(function () {});
        }).catch(function () {});
      });
    }
    job.then(function () {
      return pbReq('DELETE', '/collections/3d_agents/records/' + encodeURIComponent(aid));
    }).then(function () {
      $('buyerStatus').textContent = 'ဖျက်ပြီးပြီ';
      renderMyAgentList();
    }).catch(function (e) { $('buyerStatus').textContent = 'မရဘူး: ' + (e.message || 'error'); });
  }
  on('buyerRefreshBtn', 'click', renderBuyerList);
  on('buyerCreateBtn', 'click', function () {
    if (!isPho()) { $('buyerStatus').textContent = 'ခွင့်မရှိပါ'; return; }
    var email = ($('buyerEmail').value || '').trim().toLowerCase();
    var shop = ($('buyerShop').value || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('buyerStatus').textContent = 'Email မှန်အောင်ရိုက်ပါ'; return; }
    if (!shop) { $('buyerStatus').textContent = 'ဆိုင်နာမည် ရိုက်ပါ'; return; }
    var btn = $('buyerCreateBtn'); btn.disabled = true; btn.textContent = 'လုပ်နေတယ်…';
    var box = $('buyerResult'); box.style.display = 'none';
    var tmp = randChars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 8);
    var tenantId = null, agentCode = null;
    pbReq('POST', '/collections/tenants/records', { name: shop }).then(function (t) {
      tenantId = t.id;
      return pbReq('POST', '/collections/users/records', { email: email, password: tmp, passwordConfirm: tmp, name: shop, tenant: tenantId, emailVisibility: true });
    }).then(function () {
      var secret = randChars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', 8);
      agentCode = agent3dCode(tenantId, 1, secret);
      var pass = agent3dPass(tenantId, 1, secret);
      return pbReq('POST', '/collections/users/records', { email: agent3dEmail(tenantId, 1), password: pass, passwordConfirm: pass, name: 'Agent 1 (' + shop + ')', tenant: tenantId, emailVisibility: true });
    }).then(function () {
      return pbReq('POST', '/collections/3d_agents/records', { tenant: tenantId, code: agentCode, name: 'Agent 1', disabled: false });
    }).then(function () {
      box.style.display = '';
      box.innerHTML = '<div class="setrow"><span>Buyer account ရပြီ</span></div>' +
        '<div>Email: <b>' + esc(email) + '</b></div>' +
        '<div>Temp password: <b>' + esc(tmp) + '</b></div>' +
        '<div class="status">Buyer ကို ပို့ပေးပါ — သူ Settings မှာ password ချိန်းရမယ်</div>' +
        '<div>Agent 1 Code: <b>' + esc(agentCode) + '</b></div>' +
        '<div class="status">ကူးယူထားပါ — temp password နောက်မှ ပြန်မရဘူး</div>';
      $('buyerEmail').value = ''; $('buyerShop').value = '';
      $('buyerStatus').textContent = 'Buyer ထုတ်ပြီးပြီ';
      renderBuyerList();
    }).catch(function (e) {
      var msg = 'မရဘူး: ' + (e.message || 'error');
      if (/already|exists|unique/i.test(e.message || '')) msg = 'ဒီ email ရှိနေပြီးသား';
      $('buyerStatus').textContent = msg;
    }).then(function () { btn.disabled = false; btn.textContent = 'Buyer အသစ် ဖန်တီး'; });
  });
  /* ---------- own agents (buyer self-service, 2D mirror) ----------
     Any logged-in Master user lists/creates/toggles/deletes agents
     of their OWN tenant only, within their tenant's limit (default
     5; Pho raises it from the Buyer list). Agent 1 already exists
     from buyer creation; this section adds Agents 2..limit. */
  function renderMyAgentList() {
    var box = $('myAgentList'); if (!box) return;
    var tid = ownTenant();
    if (!tid) { box.innerHTML = '<div class="status">Server login မဝင်ရသေး</div>'; return; }
    box.innerHTML = '<div class="status">တင်နေတယ်…</div>';
    pbList('3d_agents', { filter: 'tenant="' + tid + '"', perPage: 100 }).then(function (res) {
      var items = res.items || [];
      if (!items.length) { box.innerHTML = '<div class="status">Agent မရှိသေးပါ</div>'; return; }
      var html = '';
      items.forEach(function (a) {
        var dis = !!a.disabled;
        html += '<div class="setrow"><span>' + esc(a.name || '') + '</span><span class="' + (dis ? 'neg' : 'pos') + '">' + (dis ? 'ပိတ်' : 'ဖွင့်') + '</span></div>' +
          '<div class="status">Code: <b>' + esc(a.code || '') + '</b></div>' +
          '<div class="btnrow"><button class="btn ' + (dis ? 'gray' : '') + '" data-myagent-toggle="' + a.id + '" data-disable="' + (dis ? '0' : '1') + '" data-code="' + esc(a.code || '') + '">' + (dis ? 'ဖွင့်' : 'ပိတ်') + '</button>' +
          '<button class="btn gray" data-myagent-del="' + a.id + '" data-code="' + esc(a.code || '') + '">ဖျက်</button></div>';
      });
      box.innerHTML = html;
      box.querySelectorAll('[data-myagent-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleAgent(btn.getAttribute('data-myagent-toggle'), btn.getAttribute('data-code'), btn.getAttribute('data-disable') === '1', tid); });
      });
      box.querySelectorAll('[data-myagent-del]').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteAgent(btn.getAttribute('data-myagent-del'), btn.getAttribute('data-code'), tid); });
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="status">မရဘူး: ' + esc(e.message || 'error') + '</div>';
    });
  }
  on('myAgentRefreshBtn', 'click', function () { renderMyAgentList(); });
  on('myAgentCreateBtn', 'click', function () {
    var tid = ownTenant();
    if (!tid) { $('myAgentStatus').textContent = 'Server login မဝင်ရသေး'; return; }
    var btn = $('myAgentCreateBtn'); btn.disabled = true; btn.textContent = 'လုပ်နေတယ်…';
    var box = $('myAgentResult'); box.style.display = 'none';
    pbList('3d_agents', { filter: 'tenant="' + tid + '"', perPage: 100 }).then(function (res) {
      var items = res.items || [];
      return getAgentLimit(tid).then(function (lim) {
      if (items.length >= lim) throw new Error('Agent ' + lim + ' ဦးပြည့်နေပြီ — ပိုလိုချင်ရင် Admin ကို တောင်း');
      var maxN = 0;
      items.forEach(function (a) { var n = agentNumFromCode(a.code); if (n > maxN) maxN = n; });
      var n = maxN + 1;
      var name = ($('myAgentName').value || '').trim() || ('Agent ' + n);
      var secret = randChars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', 8);
      var code = agent3dCode(tid, n, secret);
      var pass = agent3dPass(tid, n, secret);
      var userName = ownShop() ? (name + ' (' + ownShop() + ')') : name;
      return pbReq('POST', '/collections/users/records', { email: agent3dEmail(tid, n), password: pass, passwordConfirm: pass, name: userName, tenant: tid, emailVisibility: true }).then(function () {
        return pbReq('POST', '/collections/3d_agents/records', { tenant: tid, code: code, name: name, disabled: false }).then(function () { return { code: code, name: name }; });
      });
      });
    }).then(function (ag) {
      box.style.display = '';
      box.innerHTML = '<div>Agent ' + esc(ag.name) + ' Code: <b>' + esc(ag.code) + '</b></div><div class="status">ကူးယူထားပါ — agent ကို ပို့ပေးပါ</div>';
      $('myAgentName').value = '';
      renderMyAgentList();
    }).catch(function (e) {
      $('myAgentStatus').textContent = 'မရဘူး: ' + (e.message || 'error');
    }).then(function () { btn.disabled = false; btn.textContent = 'Agent အသစ် ဖန်တီး'; });
  });

  /* ---------- render all ---------- */
  function render() {
    renderSessions();
    renderHome();
    renderPeople();
    renderLedger();
    if (sess().winning) $('winStatus').textContent = 'ပေါက်သီး ' + sess().winning;
    renderDaily();
    renderVoucher();
    renderOver();
    renderBlocked();
    renderCloseToggle();
    renderBuyerSec();
    parseBoard();
    renderSyncStatus();
  }
  go('home');
  if (window.Sync3D && window.Sync3D.isLoggedIn()) {
    window.Sync3D.repushOnce(state, 'master'); /* push pre-sync local data once */
    window.Sync3D.syncNow(state, syncAfter, '').then(function () { renderSyncStatus(); render(); });
    window.Sync3D.startAutoSync(state, syncAfter, '', function () { renderSyncStatus(); render(); });
    refreshAgentNames();
  }
})();
