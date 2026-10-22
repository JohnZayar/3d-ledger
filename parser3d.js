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
    var m, amount, nums, i;

    // /// — the ten triples
    m = s.match(/^\/\/\/\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[1], 10);
      if (!(amount > 0)) return invalid(raw);
      nums = [];
      for (i = 0; i <= 9; i++) nums.push('' + i + i + i);
      return finish(nums, amount, raw, 'triples');
    }

    // Series keywords (Pho Oct 22): 29ထိပ်စီးရီး500 ≡ /29, 29အလည်စီးရီး ≡ 2/9,
    // 29နောက်စီးရီး ≡ 29/ — 10 numbers, amount per number.
    m = s.match(/^(\d)(\d)\s*(ထိပ်စီးရီး|အလည်စီးရီး|နောက်စီးရီး)\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[4], 10);
      if (!(amount > 0)) return invalid(raw);
      nums = [];
      for (i = 0; i <= 9; i++) {
        if (m[3] === 'ထိပ်စီးရီး') nums.push('' + i + m[1] + m[2]);
        else if (m[3] === 'အလည်စီးရီး') nums.push(m[1] + i + m[2]);
        else nums.push(m[1] + m[2] + i);
      }
      return finish(nums, amount, raw, 'series');
    }

    // /23 — head position is any digit
    m = s.match(/^\/(\d)(\d)\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[3], 10);
      if (!(amount > 0)) return invalid(raw);
      nums = [];
      for (i = 0; i <= 9; i++) nums.push('' + i + m[1] + m[2]);
      return finish(nums, amount, raw, 'series');
    }

    // 2/3 — middle position is any digit
    m = s.match(/^(\d)\/(\d)\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[3], 10);
      if (!(amount > 0)) return invalid(raw);
      nums = [];
      for (i = 0; i <= 9; i++) nums.push(m[1] + i + m[2]);
      return finish(nums, amount, raw, 'series');
    }

    // 23/ — tail position is any digit
    m = s.match(/^(\d)(\d)\/\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[3], 10);
      if (!(amount > 0)) return invalid(raw);
      nums = [];
      for (i = 0; i <= 9; i++) nums.push(m[1] + m[2] + i);
      return finish(nums, amount, raw, 'series');
    }

    // ဒဲ့ + ကျန်/အာ split pricing (Pho Oct 22): 123ဒဲ့1000အာ500 —
    // straight number at the ဒဲ့ amount, each REMAINING distinct
    // permutation at the second amount (အာ and ကျန် equivalent here).
    m = s.match(/^(\d)(\d)(\d)\s*ဒဲ့\s*\-?\s*(\d+)\s*(?:အာ|ကျန်)\s*\-?\s*(\d+)$/);
    if (m) {
      var dAmt = parseInt(m[4], 10), rAmt = parseInt(m[5], 10);
      if (!(dAmt > 0) || !(rAmt > 0)) return invalid(raw);
      var straight = m[1] + m[2] + m[3];
      var items = [{ number: straight, amount: dAmt }];
      perms3(m[1], m[2], m[3]).forEach(function (pn) {
        if (pn !== straight) items.push({ number: pn, amount: rAmt });
      });
      return finishItems(items, raw, 'daekyan');
    }

    // Number lists (Pho Oct 22): separators - , . ~ between 3-digit numbers.
    // Split: list/single + =A + R + B -> listed at A each, remaining perms at B each.
    m = s.match(/^(\d{3}(?:\s*[-~,.]\s*\d{3})*)\s*=\s*(\d+)\s*(?:R|r|အာ)\s*(\d+)$/);
    if (m) {
      var subs = m[1].split(/\s*[-~,.]\s*/);
      var sAmt = parseInt(m[2], 10), oAmt = parseInt(m[3], 10);
      if (!(sAmt > 0) || !(oAmt > 0)) return invalid(raw);
      var seenS = {}, items = [];
      subs.forEach(function (n) {
        if (!seenS[n]) { seenS[n] = 1; items.push({ number: n, amount: sAmt }); }
      });
      subs.forEach(function (n) {
        perms3(n[0], n[1], n[2]).forEach(function (pn) {
          if (!seenS[pn]) { seenS[pn] = 1; items.push({ number: pn, amount: oAmt }); }
        });
      });
      var r = finishItems(items, raw, 'split');
      r.head = subs.length;
      return r;
    }

    // List, one price: list + =A -> each listed number at A.
    m = s.match(/^(\d{3}(?:\s*[-~,.]\s*\d{3})+)\s*=\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[2], 10);
      if (!(amount > 0)) return invalid(raw);
      return finish(m[1].split(/\s*[-~,.]\s*/), amount, raw, 'list');
    }

    // List permutations: list + marker + A -> union of perms of each, at A.
    m = s.match(/^(\d{3}(?:\s*[-~,.]\s*\d{3})+)\s*(?:@|R|r|\*|အာ)\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[2], 10);
      if (!(amount > 0)) return invalid(raw);
      var seenP = {}, all = [];
      m[1].split(/\s*[-~,.]\s*/).forEach(function (n) {
        perms3(n[0], n[1], n[2]).forEach(function (pn) {
          if (!seenP[pn]) { seenP[pn] = 1; all.push(pn); }
        });
      });
      return finish(all, amount, raw, 'listperm');
    }

    // Permutation: 123@500 — markers @ R r * အာ are equivalent
    m = s.match(/^(\d)(\d)(\d)\s*(?:@|R|r|\*|အာ)\s*[=\-]?\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[4], 10);
      if (!(amount > 0)) return invalid(raw);
      return finish(perms3(m[1], m[2], m[3]), amount, raw, 'perm');
    }

    // Single: 123=500 / 123-500 / 123 500
    m = s.match(/^(\d{3})\s*[=\- ]\s*(\d+)$/);
    if (m) {
      amount = parseInt(m[2], 10);
      if (!(amount > 0)) return invalid(raw);
      return finish([m[1]], amount, raw, 'single');
    }

    return invalid(raw);
  }

  var api = { parseLine: parseLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Parser3D = api;
})(typeof window !== 'undefined' ? window : globalThis);
