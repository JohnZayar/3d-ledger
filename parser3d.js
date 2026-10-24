/* 3D formula parser — implements ONLY the confirmed canon (Pho, Oct 22, 2026).
 *
 * Pure function:
 *   parseLine(line) -> { ok, items: [{number, amount}], formula, count, total, kind }
 *   - number: 3-char string, leading zeros kept ("023")
 *   - amount: per-ကွက် (every expanded number gets the full amount)
 *   - formula: the line verbatim as typed (for voucher display)
 *   - kind: 'single' | 'perm' | 'series' | 'triples' | null
 *
 * Canon:
 *   123=500 / 123-500 / 123 500        single
 *   123@500 (also R r * အာ)            all distinct permutations
 *   /23, 2/3, 23/  + amount            slash = any digit 0-9 in that spot (10)
 *   /// + amount                       the ten triples 000,111,...,999
 * Burmese digits in the input are normalized before parsing.
 * Anything else is invalid — never guessed.
 */
(function (global) {
  'use strict';

  var BURMESE = {
    '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
    '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9'
  };

  function normalizeDigits(s) {
    return String(s).replace(/[၀-၉]/g, function (c) { return BURMESE[c]; });
  }

  // Distinct permutations of 3 digits, first-occurrence order.
  function perms3(a, b, c) {
    var src = [a, b, c];
    var order = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    var seen = {}, out = [];
    for (var i = 0; i < order.length; i++) {
      var o = order[i];
      var s = src[o[0]] + src[o[1]] + src[o[2]];
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    }
    return out;
  }

  // Rule B split builder (Pho, Oct 24): consecutive numbers sharing one
  // digit-set form ONE group - straights are the listed members, kyan is the
  // set's remaining perms. A different number in between BREAKS the group:
  // each lone number then carries its own family (its other perms at the
  // second price, cross-listed perms and duplicates kept).
  // 236-263 -> 2 + 4 | 356-563-365 -> 3 + 3 | 895-632-958 -> 3 + 15.
  function splitItems(orderedNums, sAmt, oAmt) {
    var straights = [], kyans = [];
    function keyOf(n) { return n.split('').sort().join(''); }
    var i = 0;
    while (i < orderedNums.length) {
      var key = keyOf(orderedNums[i]), group = [];
      while (i < orderedNums.length && keyOf(orderedNums[i]) === key) { group.push(orderedNums[i]); i++; }
      var listed = {};
      group.forEach(function (n) { listed[n] = 1; straights.push({ number: n, amount: sAmt }); });
      perms3(group[0][0], group[0][1], group[0][2]).forEach(function (pn) {
        if (!listed[pn]) kyans.push({ number: pn, amount: oAmt });
      });
    }
    return { straights: straights, kyans: kyans };
  }

  function finish(numbers, amount, formula, kind) {
    var items = numbers.map(function (n) { return { number: n, amount: amount }; });
    return finishItems(items, formula, kind);
  }

  function finishItems(items, formula, kind) {
    var total = items.reduce(function (a, it) { return a + it.amount; }, 0);
    return {
      ok: true, items: items, formula: formula,
      count: items.length, total: total, kind: kind
    };
  }

  function invalid(formula) {
    return { ok: false, items: [], formula: formula, count: 0, total: 0, kind: null };
  }

  function parseLine(line) {
    var raw = (line == null ? '' : String(line)).trim();
    if (!raw) return invalid(raw);
    var s = normalizeDigits(raw);
    var m;

    // Dae + Kyan split pricing (single plain number only, Pho Oct 22):
    // 123dae1000ar500 - straight at the dae amount, remaining perms at second.
    m = s.match(/^(\d)(\d)(\d)\s*ဒဲ့\s*\-?\s*(\d+)\s*(?:အာ|ကျန်)\s*\-?\s*(\d+)$/);
    if (m) {
      var dAmt = parseInt(m[4], 10), rAmt = parseInt(m[5], 10);
      if (!(dAmt > 0) || !(rAmt > 0)) return invalid(raw);
      var straight = m[1] + m[2] + m[3];
      var dItems = [{ number: straight, amount: dAmt }];
      perms3(m[1], m[2], m[3]).forEach(function (pn) {
        if (pn !== straight) dItems.push({ number: pn, amount: rAmt });
      });
      return finishItems(dItems, raw, 'daekyan');
    }

    // Bettor typed formats (Pho Oct 22, from forwarded Viber messages):
    // (a) Chained-= list: 750=755=214=1000 -> numbers share the last amount.
    if (s.indexOf('=') !== -1) {
      var parts = s.split('=');
      var lastP = parts[parts.length - 1].trim();
      var headParts = parts.slice(0, -1).map(function (x) { return x.trim(); });
      if (parts.length >= 2 && /^\d+$/.test(lastP) &&
          headParts.every(function (x) { return /^\d{3}$/.test(x); })) {
        var cAmt = parseInt(lastP, 10);
        if (cAmt > 0) return finish(headParts, cAmt, raw, headParts.length === 1 ? 'single' : 'list');
      }
    }
    // (b) Dots split: 387...500r100 -> straight @500, remaining perms @100.
    m = s.match(/^(\d{3})\.{2,}\s*(\d+)\s*(?:r|R|အာ|@)\s*(\d+)$/);
    if (m) {
      var dA2 = parseInt(m[2], 10), rA2 = parseInt(m[3], 10);
      if (!(dA2 > 0) || !(rA2 > 0)) return invalid(raw);
      var st2 = m[1];
      var it2 = [{ number: st2, amount: dA2 }];
      perms3(st2[0], st2[1], st2[2]).forEach(function (pn) {
        if (pn !== st2) it2.push({ number: pn, amount: rA2 });
      });
      var rr2 = finishItems(it2, raw, 'split');
      rr2.head = 1;
      return rr2;
    }
    // (c) Dots straight: 387...500 -> 387 @500.
    m = s.match(/^(\d{3})\.{2,}\s*(\d+)$/);
    if (m) {
      var dA3 = parseInt(m[2], 10);
      if (!(dA3 > 0)) return invalid(raw);
      return finish([m[1]], dA3, raw, 'single');
    }
    // (d) Dot amount (typed like the handwritten slips): 740.1000 / 740. 1000.
    m = s.match(/^(\d{3})\.\s*(\d+)$/);
    if (m) {
      var dA4 = parseInt(m[2], 10);
      if (!(dA4 > 0)) return invalid(raw);
      return finish([m[1]], dA4, raw, 'single');
    }

    // Space-separated subjects (Pho Oct 22): "567 765 15000k1000"-family.
    // Split with optional kyan-count check + stacked marker.
    m = s.match(/^(\d{3}(?:\s+\d{3})+?)\s*(\d+)\s*(?:ကျန်အာ|ကျန်|အာ|R|r|@|\/)\s*(?:(\d+)\s*ကွက်\s*)?(\d+)$/);
    if (m) {
      var subs2 = m[1].split(/\s+/);
      var sA = parseInt(m[2], 10), oA = parseInt(m[4], 10);
      if (!(sA > 0) || !(oA > 0)) return invalid(raw);
      var spA = splitItems(subs2, sA, oA);
      var items2 = spA.straights.concat(spA.kyans);
      // If the bettor wrote the remaining count (k<n>), it must agree.
      if (m[3] !== undefined && parseInt(m[3], 10) !== spA.kyans.length) return invalid(raw);
      var rS = finishItems(items2, raw, 'split');
      rS.head = subs2.length;
      return rS;
    }
    // Space subjects + ကျန်<count>ကွက် form: "567 765 15000k4q5000".
    m = s.match(/^(\d{3}(?:\s+\d{3})+?)\s*(\d+)ကျန်\s*(\d+)\s*ကွက်\s*(\d+)$/);
    if (m) {
      var subs3 = m[1].split(/\s+/);
      var sA3 = parseInt(m[2], 10), cnt3 = parseInt(m[3], 10), oA3 = parseInt(m[4], 10);
      if (!(sA3 > 0) || !(oA3 > 0)) return invalid(raw);
      var spB = splitItems(subs3, sA3, oA3);
      var items3 = spB.straights.concat(spB.kyans);
      if (cnt3 !== spB.kyans.length) return invalid(raw);
      var rS3 = finishItems(items3, raw, 'split');
      rS3.head = subs3.length;
      return rS3;
    }
    // Space subjects, straight list: "567 765 15000".
    m = s.match(/^(\d{3}(?:\s+\d{3})+?)\s+(\d+)$/);
    if (m) {
      var sA4 = parseInt(m[2], 10);
      if (!(sA4 > 0)) return invalid(raw);
      return finish(m[1].split(/\s+/), sA4, raw, 'list');
    }

    // General member-list parser (Pho's symbol canon, Oct 22):
    // line = MEMBERS joined by separators ~ - , . * plus one TAIL.
    // Members: 123 | slash series /23 2/3 23/ | keyword series 29series |
    //          triple set /// or its keyword names (10 numbers).
    // Tails: (=|space) A straight | (@|R|r) A perms | = A (R|r) B split.
    var TRIPLES = ['000', '111', '222', '333', '444', '555', '666', '777', '888', '999'];
    function matchMember(str) {
      var mm, i;
      if (str.indexOf('///') === 0) return { nums: TRIPLES, len: 3, bareOk: true };
      mm = str.match(/^ထွိုင်ဆယ်ကွက်|^ထွိုင်|^အပူးစုံ/);
      if (mm) return { nums: TRIPLES, len: mm[0].length, bareOk: true };
      // Pair covers (Pho, Oct 24): bare keyword = whole pair set (100
      // numbers); digit + keyword = that pair digit only (10 numbers).
      // နောက်ပူး = last two equal (XYY); ထိပ်ပူး / ရှေ့ပူး = first two equal (YYX).
      // Triples (000,111,...,999) belong to both bare sets.
      // နောက်ပူး 500 -> 50,000 | 5နောက်ပူး 500 -> 5,000 (055,155,...,955).
      // NOTE: digit+ပူး must precede the positional branch, else "5နောက်"
      // would misread as the 5နောက် positional cover (005...995).
      mm = str.match(/^(\d)(နောက်ပူး|ထိပ်ပူး|ရှေ့ပူး)/);
      if (mm) {
        var pd = mm[1], outd = [], q;
        if (mm[2] === 'နောက်ပူး') {
          for (q = 0; q < 10; q++) outd.push(String(q) + pd + pd);
        } else {
          for (q = 0; q < 10; q++) outd.push(pd + pd + String(q));
        }
        return { nums: outd, len: mm[0].length, bareOk: true };
      }
      mm = str.match(/^(နောက်ပူး|ထိပ်ပူး|ရှေ့ပူး)/);
      if (mm) {
        var out3 = [], pa, pb;
        if (mm[1] === 'နောက်ပူး') {
          for (pa = 0; pa < 10; pa++) for (pb = 0; pb < 10; pb++)
            out3.push(String(pa) + String(pb) + String(pb));
        } else {
          for (pa = 0; pa < 10; pa++) for (pb = 0; pb < 10; pb++)
            out3.push(String(pa) + String(pa) + String(pb));
        }
        return { nums: out3, len: mm[0].length, bareOk: true };
      }
      mm = str.match(/^(\d)(\d)\s*(ထိပ်|အလယ်|အလည်|နောက်)စီးရီး/);
      if (mm) {
        var a = mm[1], b = mm[2], out = [];
        if (mm[3] === 'ထိပ်') { for (i = 0; i < 10; i++) out.push(String(i) + a + b); }
        else if (mm[3] === 'အလယ်' || mm[3] === 'အလည်') { for (i = 0; i < 10; i++) out.push(a + String(i) + b); }
        else { for (i = 0; i < 10; i++) out.push(a + b + String(i)); }
        return { nums: out, len: mm[0].length, bareOk: true };
      }
      mm = str.match(/^(\d{0,2})\/(\d{0,2})/);
      if (mm && (mm[1].length + mm[2].length) === 2) {
        var pre = mm[1], post = mm[2], res = [], k;
        var digs = (pre + post).split('');
        if (pre.length === 0) { for (k = 0; k < 10; k++) res.push(String(k) + digs[0] + digs[1]); }
        else if (post.length === 0) { for (k = 0; k < 10; k++) res.push(digs[0] + digs[1] + String(k)); }
        else { for (k = 0; k < 10; k++) res.push(digs[0] + String(k) + digs[1]); }
        return { nums: res, len: mm[0].length, bareOk: true };
      }
      // Positional covers (Pho, Oct 24): 4htate 500 / 7nauk500 / 3alel 600 -
      // one digit fixed in its position, the other two run free (100 numbers).
      mm = str.match(/^(\d)(ထိပ်|နောက်|အလယ်|အလည်)(?!စီးရီး)/);
      if (mm) {
        var d = mm[1], out2 = [], x, y;
        if (mm[2] === 'ထိပ်') { for (x = 0; x < 100; x++) out2.push(d + (x < 10 ? '0' : '') + x); }
        else if (mm[2] === 'နောက်') { for (x = 0; x < 100; x++) out2.push((x < 10 ? '0' : '') + x + d); }
        else { for (x = 0; x < 10; x++) for (y = 0; y < 10; y++) out2.push(String(x) + d + String(y)); }
        return { nums: out2, len: mm[0].length, bareOk: true };
      }
      mm = str.match(/^\d{3}(?!\d)/);
      if (mm) return { nums: [mm[0]], len: 3 };
      return null;
    }

    var members = [], lastSep = null, pos = 0, rest = null;
    while (true) {
      var mem = matchMember(s.slice(pos));
      if (!mem) return invalid(raw);
      members.push(mem);
      pos += mem.len;
      var savePos = pos;
      while (pos < s.length && s[pos] === ' ') pos++;
      if (pos >= s.length) { rest = ''; break; }
      var ch = s[pos];
      // Chained '=' list with a split tail (Pho ex. 4): 234=890=324=098dae6000ar3000.
      // '=' counts as a member separator only when another member clearly
      // follows: exactly 3 digits, then a separator / '=' / dae keyword -
      // never a split marker (R r @ / kyan ar), which would mean price tail.
      if (ch === '=' && /^=\d{3}(?!\d)/.test(s.slice(pos)) && pos + 4 < s.length &&
          '= -~,. *ဒ'.indexOf(s[pos + 4]) >= 0) {
        lastSep = '='; pos++; continue;
      }
      if (ch === '-' || ch === '~' || ch === ',' || ch === '.' || ch === '*') {
        lastSep = ch;
        var runStart = pos;
        while (pos < s.length && '-~,. *'.indexOf(s[pos]) >= 0 && s[pos] !== ' ') pos++;
        var runLen = pos - runStart;
        while (pos < s.length && s[pos] === ' ') pos++;
        if (pos >= s.length) return invalid(raw);
        // Pho's writing (Oct 23): an ellipsis-style run ("...") before
        // the price means the rest is the TAIL, not more members:
        // 123.235.345.567...5000 = the four numbers at 5000 each.
        if (runLen >= 2) { rest = s.slice(pos); break; }
        continue;
      }
      rest = s.slice(savePos);
      break;
    }

    var seen = {}, S = [];
    members.forEach(function (mem2) {
      mem2.nums.forEach(function (n) { if (!seen[n]) { seen[n] = 1; S.push(n); } });
    });

    if (rest === '') {
      // Dash-amount fallback: exactly 123-500 reads as number + amount.
      if (members.length === 2 && lastSep === '-' && members[1].nums.length === 1) {
        var amt0 = parseInt(members[1].nums[0], 10);
        if (amt0 > 0) return finish(members[0].nums, amt0, raw, members[0].nums.length === 1 ? 'single' : 'list');
      }
      return invalid(raw);
    }

    var tm;
    // Bare amount tail after an ellipsis run: 123.567...5000.
    tm = rest.match(/^(\d+)$/);
    if (tm) {
      var bAmt = parseInt(tm[1], 10);
      if (!(bAmt > 0)) return invalid(raw);
      return finish(S, bAmt, raw, (members.length === 1 && members[0].nums.length === 1) ? 'single' : 'list');
    }
    // Split tails: = A (marker) B, or a list + dae A ar B (Pho's ex. 4 form).
    tm = rest.match(/^\s*=\s*(\d+)\s*(?:ကျန်အာ|ကျန်|R|r|အာ|@|\/)\s*(\d+)$/) ||
         rest.match(/^\s*ဒဲ့\s*(\d+)\s*(?:အာ|ကျန်)\s*(\d+)$/);
    if (tm) {
      var sAmt = parseInt(tm[1], 10), oAmt = parseInt(tm[2], 10);
      if (!(sAmt > 0) || !(oAmt > 0)) return invalid(raw);
      // Segments: runs of plain numbers follow Rule B grouping; a block
      // member (series/triple set) keeps the old union behaviour, scoped so
      // its kyan never re-prices a number already listed anywhere.
      var allS = [], allK = [], run = [], listedAll = {};
      members.forEach(function (mem) { mem.nums.forEach(function (n) { listedAll[n] = 1; }); });
      function flushRun() {
        if (!run.length) return;
        var sp = splitItems(run, sAmt, oAmt);
        allS = allS.concat(sp.straights); allK = allK.concat(sp.kyans); run = [];
      }
      members.forEach(function (mem) {
        if (mem.nums.length === 1) { run.push(mem.nums[0]); return; }
        flushRun();
        var bSeen = {};
        mem.nums.forEach(function (n) { if (!bSeen[n]) { bSeen[n] = 1; allS.push({ number: n, amount: sAmt }); } });
        var bK = {};
        mem.nums.forEach(function (n) {
          perms3(n[0], n[1], n[2]).forEach(function (pn) {
            if (!listedAll[pn] && !bK[pn]) { bK[pn] = 1; allK.push({ number: pn, amount: oAmt }); }
          });
        });
      });
      flushRun();
      var rr = finishItems(allS.concat(allK), raw, 'split');
      rr.head = allS.length;
      return rr;
    }
    // Permutation tail: (@|R|r|ar) A
    tm = rest.match(/^\s*(?:@|R|r|အာ)\s*(\d+)$/);
    if (tm) {
      var pAmt = parseInt(tm[1], 10);
      if (!(pAmt > 0)) return invalid(raw);
      var seenP = {}, all = [];
      S.forEach(function (n) {
        perms3(n[0], n[1], n[2]).forEach(function (pn) {
          if (!seenP[pn]) { seenP[pn] = 1; all.push(pn); }
        });
      });
      return finish(all, pAmt, raw, (members.length === 1 && S.length === 1) ? 'perm' : 'listperm');
    }
    // Straight tail: = A or space A
    tm = rest.match(/^\s*=\s*(\d+)$/) || rest.match(/^\s+(\d+)$/);
    if (!tm && members[members.length - 1].bareOk) tm = rest.match(/^\s*(\d+)$/);
    if (tm) {
      var tAmt = parseInt(tm[1], 10);
      if (!(tAmt > 0)) return invalid(raw);
      return finish(S, tAmt, raw, (members.length === 1 && S.length === 1) ? 'single' : 'list');
    }
    return invalid(raw);
  }


  var api = { parseLine: parseLine, perms3: perms3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Parser3D = api;
})(typeof window !== 'undefined' ? window : globalThis);
