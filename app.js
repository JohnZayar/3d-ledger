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
      var s = { id: uid(), date: nd, limit: 50000, winning: null };
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
        '<span>အဆ ' + esc(fmt(p.payout)) + (p.tote ? '/' + esc(fmt(p.tote)) : '') + '</span><span>ကော် ' + esc(fmt(p.commission)) + '%</span>' +
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
    // One field carries both rates: payout/tote, e.g. "550/10" (Pho Oct 22).
    var pr = normNum($('pPayout').value).split('/');
    var payout = Number(pr[0]);
    var tote = pr.length > 1 ? Number(pr[1]) : 0;
    var comm = Number(normNum($('pComm').value));
    if (!name || !(payout > 0) || !($('pComm').value.trim())) {
      $('peopleStatus').textContent = 'အမည် / အဆ / ကော် အကုန် ဖြည့်ပါ';
      return;
    }
    state.people.push({ id: uid(), name: name, payout: payout, tote: tote, commission: comm, role: $('pRole').value });
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
        if (r.kind === 'split') {
          var head = r.head || 1;
          var sIt = r.items.slice(0, head), rIt = r.items.slice(head);
          return '<div>' + esc(r.formula) + ' → ' + head + ' လုံး × ' + fmt(sIt[0].amount) +
            (rIt.length ? ' + ကျန် ' + rIt.length + ' × ' + fmt(rIt[0].amount) : '') + '</div>';
        }
        if (r.kind === 'daekyan') {
          var rest = r.items.slice(1);
          return '<div>' + esc(r.formula) + ' → ဒဲ့ ' + fmt(r.items[0].amount) +
            (rest.length ? ' + ကျန် ' + rest.length + ' × ' + fmt(rest[0].amount) : '') + '</div>';
        }
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
    var tSum = 0;
    Object.keys(totals).forEach(function (k) { if (totals[k] > 0) tSum += totals[k]; });
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
    var rows = '', T = { bet: 0, win: 0, tote: 0, pay: 0, net: 0 };
    state.people.forEach(function (p) {
      if (p.role === 'akan') return;
      var d = byPerson[p.id];
      if (!d) return;
      var pay = d.win * p.payout + d.tote * (p.tote || 0);
      var net = d.bet * (1 - p.commission / 100) - pay;
      T.bet += d.bet; T.win += d.win; T.tote += d.tote; T.pay += pay; T.net += net;
      rows += '<tr><td>' + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td>' + fmt(d.tote) +
        '</td><td class="' + (net < 0 ? 'neg' : '') + '">' + fmt(net) + '</td></tr>';
    });
    var html =
      '<table class="grid"><tr><th>အမည်</th><th>တက်ငွေ</th><th>အပေါက်</th><th>တွဒ်</th><th>ကျန်</th></tr>' +
      rows +
      '<tr class="tot"><td>စုစုပေါင်း</td><td>' + fmt(T.bet) + '</td><td>' + fmt(T.win) +
      '</td><td>' + fmt(T.tote) +
      '</td><td class="' + (T.net < 0 ? 'neg' : '') + '">' + fmt(T.net) + '</td></tr></table>';
    // akan (hedge bookies): ကျန် = bet − commission + win × payout (bookie pays Pho)
    var arows = '', A = { bet: 0, win: 0, tote: 0, net: 0 };
    state.people.forEach(function (p) {
      if (p.role !== 'akan') return;
      var d = byPerson[p.id];
      if (!d) return;
      var net = d.bet * (1 - p.commission / 100) + d.win * p.payout + d.tote * (p.tote || 0);
      A.bet += d.bet; A.win += d.win; A.tote += d.tote; A.net += net;
      arows += '<tr><td>' + esc(p.name) + '</td><td>' + fmt(d.bet) + '</td><td>' + fmt(d.win) +
        '</td><td>' + fmt(d.tote) +
        '</td><td>' + fmt(net) + '</td></tr>';
    });
    if (arows) {
      html += '<div class="akanhead">အကန်ဒိုင် (ဒိုင် ပေးရန်)</div>' +
        '<table class="grid akan"><tr><th>အမည်</th><th>တက်ငွေ</th><th>အပေါက်</th><th>တွဒ်</th><th>ကျန်</th></tr>' +
        arows +
        '<tr class="tot"><td>စုစုပေါင်း</td><td>' + fmt(A.bet) + '</td><td>' + fmt(A.win) +
        '</td><td>' + fmt(A.tote) +
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
        body += '<tr class="vline" data-x="' + xid + '" data-line="' + lineRecs[0].lineId + '"><td class="frm">' + label + '</td>' +
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
    var recs = lineRecsOf(menuLineId);
    if (!recs.length) return closeLineMenu();
    if (!confirm('ဒီ လိုင်း ဖျက် မလား? ' + recs[0].formula)) return;
    state.records = state.records.filter(function (r) { return r.lineId !== menuLineId; });
    save(); render(); closeLineMenu();
  });
  on('lmEditBtn', 'click', function () {
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
    var recs = lineRecsOf(menuLineId);
    if (!recs.length) return closeLineMenu();
    var r = window.Parser3D.parseLine($('lmInput').value);
    if (!r.ok) { $('lmHint').textContent = 'ပုံစံ မမှန် — ပြန် စစ် ပါ'; return; }
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
