/* 3D Master — local prototype (localStorage only, no network). */
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
    var s = { id: uid(), date: nextDraw(todayISO()), limit: 50000, winning: null };
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
    var map = {};
    sessRecords().forEach(function (r) { map[r.number] = (map[r.number] || 0) + r.amount; });
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
      var s = { id: uid(), date: nd, limit: 50000, winning: null };
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
  }

  /* ---------- people ---------- */
  function renderPeople() {
    // entry + voucher dropdowns
    var opts = state.people.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + (p.role === 'akan' ? ' (အကန်)' : '') + '</option>';
    }).join('');
    var ep = $('entryPerson'), vp = $('voucherPerson');
    var keepE = ep.value, keepV = vp.value;
    ep.innerHTML = state.people.length ? opts : '<option value="">—</option>';
    if (keepE && person(keepE)) ep.value = keepE;
    vp.innerHTML = state.people.length ? opts : '<option value="">—</option>';
    if (keepV && person(keepV)) vp.value = keepV;
    // list
    $('peopleList').innerHTML = state.people.map(function (p) {
      return '<div class="prow">' + (p.role === 'akan' ? '<span class="tag">အကန်</span>' : '') + '<span class="nm">' + esc(p.name) + '</span>' +
        '<span>အဆ ' + esc(fmt(p.payout)) + '</span><span>ကော် ' + esc(fmt(p.commission)) + '%</span>' +
        '<button class="del" data-del="' + p.id + '">ဖျက်</button></div>';
    }).join('');
    document.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        state.people = state.people.filter(function (p) { return p.id !== id; });
        save(); render();
      });
    });
  }
  $('addPersonBtn').addEventListener('click', function () {
    var name = $('pName').value.trim();
    var payout = Number($('pPayout').value);
    var comm = Number($('pComm').value);
    if (!name || !($('pPayout').value.trim()) || !($('pComm').value.trim())) {
      $('peopleStatus').textContent = 'အမည် / အဆ / ကော် အကုန် ဖြည့်ပါ';
      return;
    }
    state.people.push({ id: uid(), name: name, payout: payout, commission: comm, role: $('pRole').value });
    $('pName').value = ''; $('pPayout').value = ''; $('pComm').value = '';
    $('peopleStatus').textContent = '';
    save(); render();
  });

  /* ---------- entry board ---------- */
  var lastParse = [];
  function parseBoard() {
    var lines = $('board').value.split('\n');
    lastParse = [];
    lines.forEach(function (ln) {
      if (!ln.trim()) return;
      lastParse.push(parseLine(ln));
    });
    var valid = lastParse.filter(function (r) { return r.ok; });
    var bad = lastParse.filter(function (r) { return !r.ok; });
    var pv = $('preview');
    if (valid.length) {
      var html = valid.map(function (r) {
        return '<div>' + esc(r.formula) + ' → ' + r.count + ' ကွက် × ' + fmt(r.items[0].amount) + '</div>';
      }).join('');
      var tc = valid.reduce(function (a, r) { return a + r.count; }, 0);
      var tt = valid.reduce(function (a, r) { return a + r.total; }, 0);
      html += '<div class="pt">စုစုပေါင်း ' + tc + ' ကွက် · ' + fmt(tt) + '</div>';
      pv.innerHTML = html; pv.style.display = 'block';
    } else pv.style.display = 'none';
    var bb = $('badbox');
    if (bad.length) {
      bb.innerHTML = bad.map(function (r) { return '<div>' + esc(r.formula) + '</div>'; }).join('');
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
  $('entryPerson').addEventListener('change', parseBoard);

  $('pasteBtn').addEventListener('click', function () {
    if (!(navigator.clipboard && navigator.clipboard.readText)) {
      $('entryStatus').textContent = 'Paste မရ — လက်နဲ့ ထည့်ပါ'; return;
    }
    navigator.clipboard.readText().then(function (t) {
      if (!t) return;
      var b = $('board');
      b.value = b.value ? b.value.replace(/\n?$/, '\n') + t : t;
      parseBoard();
    }, function () { $('entryStatus').textContent = 'Paste မရ — လက်နဲ့ ထည့်ပါ'; });
  });

  $('saveBtn').addEventListener('click', function () {
    var pid = $('entryPerson').value;
    if (!pid) return;
    var valid = lastParse.filter(function (r) { return r.ok; });
    if (!valid.length) return;
    var s = sess();
    var batchNo = 1;
    sessRecords().forEach(function (r) {
      if (r.personId === pid && r.batchNo >= batchNo) batchNo = r.batchNo + 1;
    });
    valid.forEach(function (r) {
      var lineId = uid();
      r.items.forEach(function (it) {
        state.records.push({
          id: uid(), sessionId: s.id, personId: pid, batchNo: batchNo,
          lineId: lineId, number: it.number, amount: it.amount,
          formula: r.formula, isFormula: r.kind !== 'single'
        });
      });
    });
    $('board').value = '';
    parseBoard();
    save(); render();
    $('entryStatus').textContent = 'NO ' + batchNo + ' သိမ်းပြီး';
  });

  /* ---------- ledger ---------- */
  var hundred = 0;
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
    var tSum = 0, tCnt = 0;
    Object.keys(totals).forEach(function (k) { if (totals[k] > 0) { tSum += totals[k]; tCnt++; } });
    $('ledTotal').textContent = fmt(tSum);
    $('ledCount').textContent = fmt(tCnt);
    var html = '';
    for (var i = 0; i < 100; i++) {
      var num = String(hundred * 100 + i).padStart(3, '0');
      var amt = totals[num] || 0;
      var cls = 'cell';
      if (amt > s.limit) cls += ' hot';
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
    var byPerson = {};
    recs.forEach(function (r) {
      byPerson[r.personId] = byPerson[r.personId] || { bet: 0, win: 0 };
      byPerson[r.personId].bet += r.amount;
      if (s.winning && r.number === s.winning) byPerson[r.personId].win += r.amount;
    });
    var rows = '', T = { bet: 0, win: 0, pay: 0, net: 0 };
    state.people.forEach(function (p) {
      if (p.role === 'akan') return;
      var d = byPerson[p.id];
      if (!d) return;
      var pay = d.win * p.payout;
      var net = d.bet * (1 - p.commission / 100) - pay;
      T.bet += d.bet; T.win += d.win; T.pay += pay; T.net += net;
      rows += '<tr><td>' + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td class="' + (net < 0 ? 'neg' : '') + '">' + fmt(net) + '</td></tr>';
    });
    var html =
      '<table class="grid"><tr><th>အမည်</th><th>တက်ငွေ</th><th>အပေါက်</th><th>ကျန်</th></tr>' +
      rows +
      '<tr class="tot"><td>စုစုပေါင်း</td><td>' + fmt(T.bet) + '</td><td>' + fmt(T.win) +
      '</td><td class="' + (T.net < 0 ? 'neg' : '') + '">' + fmt(T.net) + '</td></tr></table>';
    // akan (hedge bookies): ကျန် = bet − commission + win × payout (bookie pays Pho)
    var arows = '', A = { bet: 0, win: 0, net: 0 };
    state.people.forEach(function (p) {
      if (p.role !== 'akan') return;
      var d = byPerson[p.id];
      if (!d) return;
      var net = d.bet * (1 - p.commission / 100) + d.win * p.payout;
      A.bet += d.bet; A.win += d.win; A.net += net;
      arows += '<tr><td>' + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td>' + fmt(net) + '</td></tr>';
    });
    if (arows) {
      html += '<div class="akanhead">အကန်ဒိုင် (ဒိုင် ပေးရန်)</div>' +
        '<table class="grid akan"><tr><th>အမည်</th><th>တက်ငွေ</th><th>အပေါက်</th><th>ကျန်</th></tr>' +
        arows +
        '<tr class="tot"><td>စုစုပေါင်း</td><td>' + fmt(A.bet) + '</td><td>' + fmt(A.win) +
        '</td><td>' + fmt(A.net) + '</td></tr></table>';
    }
    $('dailyBox').innerHTML = html;
  }

  /* ---------- vouchers ---------- */
  $('voucherPerson').addEventListener('change', renderVoucher);
  function renderVoucher() {
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
        body += '<tr class="vline" data-x="' + xid + '"><td class="frm">' + label + '</td>' +
          '<td class="amt">' + fmt(lt) + '</td></tr>';
        var chips = lineRecs.map(function (r) { return '<span>' + r.number + ' · ' + fmt(r.amount) + '</span>'; }).join('');
        body += '<tr id="' + xid + '" style="display:none"><td class="xpand" colspan="2"><div class="xgrid">' + chips + '</div></td></tr>';
      });
      body += '<tr class="vtot"><td colspan="2">Total ' + fmt(total) + '</td></tr>';
      html += '<div class="vbatch"><div class="vhead">NO ' + bn + '</div>' +
        '<table class="vt">' + body + '</table></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.vline').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var x = document.getElementById(tr.getAttribute('data-x'));
        if (x) x.style.display = x.style.display === 'none' ? 'table-row' : 'none';
      });
    });
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
    ta.select();
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
    parseBoard();
  }
  go('home');
})();
