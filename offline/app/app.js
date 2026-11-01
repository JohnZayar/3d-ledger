/* 3D Master Offline v2.3 - phone-local only, no network (localStorage, PIN/license gate via gate.js). Ported from web Master v58 + parser v27. Network/sync code stripped; Master's own people, ledger, vouchers and limits kept. */
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
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
  var memFallback = null;
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { memFallback = JSON.stringify(state); }
  }
  save();

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
  function renderPeople() {
    // entry + voucher dropdowns - Master's own people.
    var vis = state.people;
    var opts = vis.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + (p.role === 'akan' ? ' (အကန်)' : '') + '</option>';
    }).join('');
    var ep = $('entryPerson'), vp = $('voucherPerson');
    var keepE = ep.value, keepV = vp.value;
    ep.innerHTML = vis.length ? opts : '<option value="">—</option>';
    if (keepE && person(keepE)) ep.value = keepE;
    vp.innerHTML = vis.length ? opts : '<option value="">—</option>';
    if (keepV && person(keepV)) vp.value = keepV;
    // list
    var listVis = state.people;
    $('peopleList').innerHTML = listVis.map(function (p) {
      return '<div class="prow" data-pid="' + p.id + '">' + (p.role === 'akan' ? '<span class="tag">အကန်</span>' : '') + '<span class="nm">' + esc(p.name) + '</span>' +
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
    $('pName').value = ''; $('pPayout').value = ''; $('pComm').value = ''; if (pcEl) pcEl.value = '';
    $('peopleStatus').textContent = '';
    save(); render();
  });

  /* ---------- entry board ---------- */
  var lastParse = [];
  // Board inheritance (Pho, Nov 1): a bare 3-digit line takes the
  // amount + form of the nearest amount-bearing line above it since
  // the last blank line ('ငွေတူလို့ထပ်မရေးတော့တာ' — 100 after
  // 500.1000 is straight@1000; 864 after 371r500 is perms@500). A
  // blank line clears the state ('လိုင်းခြားရင်ဖြတ် အုပ်စုမတူ').
  // Only exactly 3 digits inherit; anything else stays red. The
  // preview/voucher keep the TYPED line; only numbers/amounts come
  // from the synthesized parse.
  function inheritState(r) {
    if (!r || !r.ok || !r.items || !r.items.length) return null;
    return { amount: r.items[0].amount, perm: (r.kind === 'perm' || r.kind === 'listperm') };
  }
  function effectiveParse(ln, inh) {
    var r = parseLine(ln);
    if (r.ok) return { r: r, inh: inheritState(r), inherited: false, synth: null };
    if (!inh) return { r: r, inh: null, inherited: false, synth: null };
    var num = String(ln).trim().split('').map(function (c) { var code = c.charCodeAt(0); return (code >= 0x1040 && code <= 0x1049) ? String(code - 0x1040) : c; }).join('');
    if (!/^\d{3}$/.test(num)) return { r: r, inh: inh, inherited: false, synth: null };
    var synth = num + (inh.perm ? 'r' : '=') + inh.amount;
    var syn = parseLine(synth);
    if (!syn.ok) return { r: r, inh: inh, inherited: false, synth: null };
    syn.formula = String(ln).trim();
    return { r: syn, inh: inh, inherited: true, synth: synth };
  }
  function parseBoard() {
    var lines = $('board').value.split('\n');
    lastParse = [];
    var lineIdx = [];
    var inh = null;
    lines.forEach(function (ln, li) {
      if (!ln.trim()) { inh = null; return; }
      lineIdx.push(li);
      var e = effectiveParse(ln, inh);
      inh = e.inh;
      lastParse.push(e.r);
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
     Pick a photo -> photo pick (offline: decorative only, no OCR call) ->
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
      var t = ln.trim();
      if (!/[0-9\u1040-\u1049]/.test(t)) return; // no digits: drop
      // Strip a leading Latin name word (not a lone R/r marker).
      var lead = t.match(/^[A-Za-z]+(?=\s)/);
      if (lead && lead[0] !== 'R' && lead[0] !== 'r') t = t.slice(lead[0].length).trim();
      // Strip a trailing lone R/r (noise; a real split has an amount after R).
      t = t.replace(/\s+[Rr]$/, '');
      // Keep only digits, Burmese, and the parser's own separators/markers.
      var norm = t.replace(/[^0-9\u1000-\u109F=.,\/\-Rr@(){}~:* ]/g, '').replace(/\s+/g, ' ').trim();
      if (!norm) return;
      // 3 digits with trailing dot/dash: bare number, as before.
      var tb = norm.match(/^([0-9\u1040-\u1049]{3})[-.]$/);
      if (tb) { bareRun.push(tb[1]); return; }
      // Digits (and spaces) only: one group -> bare (3) or total (drop);
      // several groups -> a spaced single/list: emit, parser decides.
      if (/^[0-9\u1040-\u1049\s]+$/.test(norm)) {
        var parts = norm.split(' ');
        if (parts.length === 1) {
          if (parts[0].length === 3) { bareRun.push(parts[0]); return; }
          return;
        }
      } else {
        // Single number + dash + amount: dash was the old scan's '='.
        var dm = norm.match(/^([0-9\u1040-\u1049]{3})\s*-\s*([0-9\u1040-\u1049]{3,})$/);
        if (dm) { flushBare(); out.push(dm[1] + '=' + dm[2]); return; }
      }
      flushBare();
      out.push(norm); // parser decides green/red on the board
    });
    flushBare();
    return out.length ? out.join('\n') + '\n' : '';
  }
  window.ScanClean = scanCleanup;

  // Scan chooser (Pho, Nov 1): like other scanners — pick Camera or Photo.
  // Skew-safe: old HTML has no chooser div, so scanBtn falls back to the
  // plain gallery input, exactly as before.
  function hideScanChoice() { var c = $('scanChoice'); if (c) c.style.display = 'none'; }
  on('scanBtn', 'click', function () {
    var c = $('scanChoice');
    if (!c) { var sf0 = $('scanFile'); if (sf0) sf0.click(); return; }
    c.style.display = (c.style.display === 'none' || !c.style.display) ? 'block' : 'none';
  });
  on('scanCamBtn', 'click', function () { hideScanChoice(); var sf = $('scanCam'); if (sf) sf.click(); });
  on('scanPhotoBtn', 'click', function () { hideScanChoice(); var sf = $('scanFile'); if (sf) sf.click(); });
  on('scanChoiceClose', 'click', hideScanChoice);
  function onScanPicked() {
    this.value = '';
    $('entryStatus').textContent = 'စကန် — offline မှာ မရပါ';
  }
  on('scanFile', 'change', onScanPicked);
  on('scanCam', 'change', onScanPicked);

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
    s.closed = !s.closed; save(); renderCloseToggle(); render();
  });

  $('exclSaveBtn').addEventListener('click', function () {
    if (!exclPending) return;
    var nums = exclPending.all || [exclPending.n];
    hideExcl();
    var inh = null;
    var out = $('board').value.split('\n').map(function (ln) {
      if (!ln.trim()) { inh = null; return ln; }
      var e = effectiveParse(ln, inh);
      inh = e.inh;
      var r = e.r;
      if (!r.ok) return ln;
      var hit = r.items.filter(function (it) { return nums.indexOf(it.number) >= 0; }).map(function (it) { return it.number; });
      var uniq = hit.filter(function (x, i) { return hit.indexOf(x) === i; });
      if (!uniq.length) return ln;
      // An inherited line cannot carry {-...} on its typed text (the
      // bare number alone does not parse), so the exclusion rides on
      // the synthesized line, which parses and saves correctly.
      return (e.inherited ? e.synth : ln) + '{-' + uniq.join('/') + '}';
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
    var badC = closedViolation(pid, newItems, null);
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
          formula: r.formula, isFormula: r.kind !== 'single'
        };
        state.records.push(rec);
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
    if (v > 0) { sess().limit = v; save(); }
    $('limitModal').classList.add('hidden');
    render();
  });

  /* ---------- winning ---------- */
  $('winBtn').addEventListener('click', function () {
    var v = normNum($('winInput').value.trim());
    if (!/^\d{3}$/.test(v)) { $('winStatus').textContent = 'ဂဏန်း ၃ လုံး ထည့်ပါ'; return; }
    sess().winning = v; save();
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
    state.people.forEach(function (p) {
      var d = byPerson[p.id];
      if (!d) return;
      var pay = d.win * p.payout + d.tote * (p.tote || 0);
      // bettors PLUS / akan MINUS (Pho hand-verified Oct 23: NN 104,100 @25% + tote 6,000x10 = -18,075)
      var net = p.role === 'akan'
        ? -d.bet * (1 - p.commission / 100) + pay
        : d.bet * (1 - p.commission / 100) - pay;
      T.bet += d.bet; T.win += d.win; T.tote += d.tote;
      T.net += net;
      var nc = net < 0 ? 'neg' : (net > 0 ? 'pos' : '');
      rows += '<tr><td>' + (p.role === 'akan' ? '<span class="tag">အကန်</span> ' : '') + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
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
    var recs = sessRecords().filter(function (r) { return r.personId === pid; });
    if (!recs.length) { box.innerHTML = '<div class="empty">စာရင်း မရှိသေး</div>'; return; }
    var bmap = {};
    recs.forEach(function (r) { (bmap[r.batchNo] = bmap[r.batchNo] || []).push(r); });
    var batches = [];
    Object.keys(bmap).map(Number).sort(function (a, b) { return a - b; }).forEach(function (bn) {
      var rows = bmap[bn];
      var lines = [], seen = {};
      rows.forEach(function (r) {
        if (!seen[r.lineId]) { seen[r.lineId] = []; lines.push(seen[r.lineId]); }
        seen[r.lineId].push(r);
      });
      batches.push({ no: bn, lines: lines });
    });
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
      html += '<div class="vbatch"><div class="vhead">NO ' + b.no + '<button class="vcopy" data-no="' + b.no + '" style="float:right;background:#3a3b41;color:#ffd970;border:1px solid #55565e;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700">Copy</button></div>' +
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
    if (badL) { $('lmHint').textContent = 'ပိတ်ဂဏန်း ' + (badL.all || [badL.n]).join('/') + exclTag(badL); return; }
    var first = recs[0];
    var idx = state.records.indexOf(first);
    state.records = state.records.filter(function (x) { return x.lineId !== menuLineId; });
    var newLineId = uid();
    var newRecs = r.items.map(function (it) {
      return {
        id: uid(), sessionId: first.sessionId, personId: first.personId,
        batchNo: first.batchNo, lineId: newLineId, number: it.number,
        amount: it.amount, formula: r.formula, isFormula: r.kind !== 'single'
      };
    });
    // Splice back at the same position so voucher line order never moves.
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
    p.name = name; p.role = $('pmRole').value; p.payout = payout; p.tote = tote;
    p.commission = Number(normNum(commRaw));
    var pcv = $('pmClosed').value.trim();
    var cl = Number(normNum(pcv));
    p.closedLimit = (pcv === '' || isNaN(cl)) ? null : cl;
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
    location.reload();
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
    parseBoard();
  }
  go('home');
})();
