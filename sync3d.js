/* Sync3D v1 (Pho Oct 24) — shared by 3D Master + 3D Agent.
   Plain script, no modules (the 3D apps are plain-script apps).
   Mirrors the Pho-approved 2D sync-simple design, adapted for 3D:
   - Server-ID-only FIFO queue, local id IS the PocketBase record id.
   - PocketBase ids must be EXACTLY 15 chars (2D utils v7 rule).
   - Session gate by (tenant, date), FAIL-CLOSED: never mint a twin
     round; adopt the server session instead (2D Oct 21 lesson).
   - Full pull, server wins per-id; orphan deletion ONLY after the
     first successful pull, and never for rows with a pending queue
     op (queue re-read at deletion time — 2D Oct 21 lesson).
   - Offline: failures stay queued, never dropped. Save appears
     instantly on the phone and never vanishes (Pho's product rule).
   - Master pushes sessions + people + records; Agent pushes people +
     records only and NEVER creates sessions (Master owns rounds:
     Agent adopts the server session by date).
   - Agent pulls sessions + people only (never other agents' records).
   Usage: Sync3D.init({role, authKey, queueKey, metaKey}) then
   Sync3D.queue(op, coll, localId, obj), Sync3D.syncNow(state, saveFn). */
(function () {
  'use strict';
  var PB = 'https://2d.skylinkvpn.stream/api';
  var _syncing = false, _lastPushError = null, _lastPullError = null;
  var _cfg = { role: 'master', authKey: '3dSyncAuth', queueKey: '3dSyncQueue', metaKey: '3dSyncMeta' };
  var _autoStarted = false;

  function uid15() {
    // 2D utils v7 verbatim: exactly 15 lowercase alphanumerics.
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var s = Date.now().toString(36);
    while (s.length < 15) s += chars[Math.floor(Math.random() * chars.length)];
    return s.slice(0, 15);
  }

  /* Migrate pre-sync local ids (old variable-length uid) to 15-char
     ids, remapping every reference. Returns true if anything changed. */
  function migrateState(state) {
    var map = {}, changed = false;
    function remap(list) {
      (list || []).forEach(function (o) {
        if (o && o.id && o.id.length !== 15) { map[o.id] = uid15(); o.id = map[o.id] || o.id; changed = true; }
      });
    }
    remap(state.sessions); remap(state.people); remap(state.records);
    // References: records point at sessions/people by id.
    (state.records || []).forEach(function (r) {
      if (r.sessionId && map[r.sessionId]) { r.sessionId = map[r.sessionId]; changed = true; }
      if (r.personId && map[r.personId]) { r.personId = map[r.personId]; changed = true; }
    });
    if (state.currentSessionId && map[state.currentSessionId]) {
      state.currentSessionId = map[state.currentSessionId]; changed = true;
    }
    return changed;
  }

  /* ---------- auth storage ---------- */
  function _auth() {
    try { return JSON.parse(localStorage.getItem(_cfg.authKey) || 'null'); } catch (e) { return null; }
  }
  function _setAuth(a) {
    try {
      if (a) localStorage.setItem(_cfg.authKey, JSON.stringify(a));
      else localStorage.removeItem(_cfg.authKey);
    } catch (e) {}
  }
  function isLoggedIn() { var a = _auth(); return !!(a && a.token); }
  function getTenant() { var a = _auth(); return (a && a.user && a.user.tenant) || null; }
  function getUser() { var a = _auth(); return a ? a.user : null; }

  /* Agent code -> PocketBase user credentials (mirrors the 2D agent
     pattern). Returns null when the code is not a server code — the
     app then stays local-only (v1 behaviour for test codes). */
  function codeToCreds(code) {
    var m = String(code || '').trim().match(/^([a-z0-9]{15})-(\d+)-([A-Za-z0-9]{8})$/);
    if (!m) return null;
    return {
      tenant: m[1], n: m[2], secret: m[3],
      email: 'agent3d_' + m[1] + '_' + m[2] + '@3d.local',
      password: 'Ag3D_' + m[1] + '_' + m[2] + '_' + m[3]
    };
  }

  /* ---------- REST ---------- */
  function _headers(auth) {
    var h = { 'Content-Type': 'application/json' };
    if (auth) h.Authorization = auth;
    return h;
  }
  function _req(method, path, body, useAuth) {
    var a = useAuth ? _auth() : null;
    var opt = { method: method, headers: _headers(a ? a.token : null) };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch(PB + path, opt).then(function (res) {
      if (res.ok) return res.status === 204 ? null : res.json().catch(function () { return null; });
      return res.json().catch(function () { return {}; }).then(function (d) {
        var e = new Error((d && d.message) || ('HTTP ' + res.status));
        e.code = res.status; e.pb = d; throw e;
      });
    }).catch(function (err) {
      if (err && err.code) throw err;
      var e = new Error('network');
      e.code = 'NETWORK_ERROR'; throw e;
    });
  }
  function _list(coll, params) {
    var q = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return _req('GET', '/collections/' + coll + '/records' + (q ? '?' + q : ''), undefined, true);
  }
  function _listAll(coll, params) {
    var out = [], page = 1;
    function next() {
      var p = Object.assign({}, params || {}, { page: page, perPage: 200 });
      return _list(coll, p).then(function (res) {
        var items = (res && res.items) || [];
        out = out.concat(items);
        if (res && res.totalPages && page < res.totalPages) { page++; return next(); }
        return out;
      });
    }
    return next();
  }
  function _getOne(coll, id) { return _req('GET', '/collections/' + coll + '/records/' + encodeURIComponent(id), undefined, true); }
  function _create(coll, payload) { return _req('POST', '/collections/' + coll + '/records', payload, true); }
  function _update(coll, id, payload) { return _req('PATCH', '/collections/' + coll + '/records/' + encodeURIComponent(id), payload, true); }
  function _del(coll, id) { return _req('DELETE', '/collections/' + coll + '/records/' + encodeURIComponent(id), undefined, true); }

  /* Agent code disabled? (checked after login; fail-open on error). */
  function checkAgentDisabled(code) {
    return _list('3d_agents', { filter: 'code="' + code + '"', perPage: 5 }).then(function (res) {
      var items = (res && res.items) || [];
      return items.length ? !!items[0].disabled : false;
    }).catch(function () { return false; });
  }

  function login(email, password) {
    return _req('POST', '/collections/users/auth-with-password', { identity: email, password: password }, false)
      .then(function (res) {
        _setAuth({ token: res.token, user: res.record });
        return res.record;
      });
  }
  function logout() { _setAuth(null); }

  /* ---------- queue ---------- */
  function _queue() {
    try { return JSON.parse(localStorage.getItem(_cfg.queueKey) || '[]'); } catch (e) { return []; }
  }
  function _setQueue(q) { try { localStorage.setItem(_cfg.queueKey, JSON.stringify(q)); } catch (e) {} }
  function queue(op, collection, localId, data) {
    var q = _queue();
    var entry = { id: uid15(), op: op, collection: collection, localId: localId, data: data || null, created: Date.now(), attempts: 0 };
    q.push(entry);
    _setQueue(q);
    return entry;
  }
  /* Queue a create for every local row (first-login migration:
     pre-sync local data was never queued, so without this it would
     never reach the server). Skips rows already queued as creates. */
  function repushAll(state, role) {
    var q = _queue();
    var pendingCreate = {};
    q.forEach(function (e) { if (e.op === 'create' && e.localId) pendingCreate[e.localId] = 1; });
    var n = 0;
    function add(coll, obj) {
      if (!obj || !obj.id || pendingCreate[obj.id]) return;
      queue('create', coll, obj.id, obj);
      pendingCreate[obj.id] = 1; n++;
    }
    if (role === 'master') (state.sessions || []).forEach(function (s) { add('3d_sessions', s); });
    (state.people || []).forEach(function (p) { add('3d_people', p); });
    (state.records || []).forEach(function (r) { add('3d_records', r); });
    return { queued: n };
  }
  /* Repush once per logged-in user (login + boot). Later mutations
     queue themselves, so this never needs to run twice. */
  function repushOnce(state, role) {
    var u = getUser();
    if (!u) return { queued: 0 };
    var meta = _meta();
    if (meta.repushedFor === u.id) return { queued: 0, skipped: true };
    var r = repushAll(state, role);
    meta.repushedFor = u.id;
    _setMeta(meta);
    return r;
  }

  function _meta() {
    try { return JSON.parse(localStorage.getItem(_cfg.metaKey) || '{}'); } catch (e) { return {}; }
  }
  function _setMeta(m) { try { localStorage.setItem(_cfg.metaKey, JSON.stringify(m)); } catch (e) {} }

  /* ---------- payload mapping (local shape -> server shape) ---------- */
  function _toServer(collection, o, tenant, agentCode) {
    if (!o) return {};
    if (collection === '3d_sessions') {
      return {
        date: o.date, winning: o.winning || '', closed: !!o.closed,
        limit: o.limit || 0, blocked: Array.isArray(o.blocked) ? o.blocked : [], tenant: tenant
      };
    }
    if (collection === '3d_people') {
      return {
        name: o.name, payout: o.payout, tote: o.tote || 0, commission: o.commission,
        closedLimit: (o.closedLimit == null ? null : o.closedLimit),
        role: o.role || 'bettor', agentId: o.agentId || agentCode || '', tenant: tenant
      };
    }
    if (collection === '3d_records') {
      return {
        sessionId: o.sessionId, personId: o.personId, batchNo: o.batchNo, lineId: o.lineId,
        number: o.number, amount: o.amount, formula: o.formula || '',
        isFormula: !!o.isFormula, agentId: o.agentId || agentCode || '', tenant: tenant
      };
    }
    var out = {};
    Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = o[k]; });
    out.tenant = tenant;
    return out;
  }
  function _fromServerSession(item) {
    return {
      id: item.id, date: item.date, limit: item.limit || 0,
      winning: item.winning || null, closed: !!item.closed,
      blocked: Array.isArray(item.blocked) ? item.blocked : []
    };
  }
  function _fromServerPerson(item) {
    return {
      id: item.id, name: item.name, payout: item.payout, tote: item.tote || 0,
      commission: item.commission, closedLimit: (item.closedLimit == null ? null : item.closedLimit),
      role: item.role || 'bettor', agentId: item.agentId || null
    };
  }
  function _fromServerRecord(item) {
    return {
      id: item.id, sessionId: item.sessionId, personId: item.personId, batchNo: item.batchNo,
      lineId: item.lineId, number: item.number, amount: item.amount,
      formula: item.formula || '', isFormula: !!item.isFormula, agentId: item.agentId || null
    };
  }

  /* Re-key a local session to the server's id (session gate adoption):
     the session row, its records, the current pointer and queued ops. */
  function _adoptSession(state, localId, srv) {
    var sid = srv.id;
    (state.sessions || []).forEach(function (s) { if (s.id === localId) s.id = sid; });
    (state.records || []).forEach(function (r) { if (r.sessionId === localId) r.sessionId = sid; });
    if (state.currentSessionId === localId) state.currentSessionId = sid;
    var q = _queue(), changed = false;
    q.forEach(function (e) {
      if (e.collection === '3d_sessions' && e.localId === localId) {
        e.localId = sid; if (e.data) e.data.id = sid; changed = true;
      } else if (e.data && e.data.sessionId === localId) {
        e.data.sessionId = sid; changed = true;
      }
    });
    if (changed) _setQueue(q);
  }

  /* Adopt a pulled server session by date: if a local session for the
     same round exists under another id, re-key it; else append. */
  function _adoptSessionByDate(state, srvSession) {
    var local = (state.sessions || []).find(function (s) { return s.date === srvSession.date; });
    if (local && local.id !== srvSession.id) _adoptSession(state, local.id, srvSession);
    var ex = (state.sessions || []).find(function (s) { return s.id === srvSession.id; });
    if (ex) {
      ex.date = srvSession.date; ex.limit = srvSession.limit; ex.winning = srvSession.winning;
      ex.closed = srvSession.closed; ex.blocked = srvSession.blocked;
    } else {
      state.sessions.push(srvSession);
      state.sessions.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
  }

  function _fmtErr(err) {
    if (!err) return 'Unknown error';
    var msg = (err.code || '') + ': ' + (err.message || String(err));
    if (err.pb && err.pb.data) {
      var fields = [];
      Object.keys(err.pb.data).forEach(function (k) {
        var v = err.pb.data[k];
        fields.push(k + '=' + (v.message || v.code || JSON.stringify(v)));
      });
      if (fields.length) msg += ' [' + fields.join(', ') + ']';
    }
    return msg;
  }

  function pushPending(state, saveFn, agentCode) {
    if (_syncing) return Promise.resolve({ pushed: 0, failed: 0, skipped: true });
    if (!isLoggedIn()) return Promise.resolve({ pushed: 0, failed: 0, skipped: true, reason: 'not-logged-in' });
    _syncing = true;
    _lastPushError = null;
    var tenant = getTenant();
    var pushed = 0, failed = 0;
    var queue = _queue().sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    var adopted = {};

    function preflight() {
      var byColl = {};
      queue.forEach(function (e) { if (e.op === 'create' && e.localId) (byColl[e.collection] = byColl[e.collection] || []).push(e); });
      var colls = Object.keys(byColl);
      var chain = Promise.resolve();
      colls.forEach(function (coll) {
        var ops = byColl[coll];
        for (var i = 0; i < ops.length; i += 20) {
          (function (chunk) {
            chain = chain.then(function () {
              var filter = chunk.map(function (e) { return 'id="' + e.localId + '"'; }).join(' || ');
              return _list(coll, { filter: filter, perPage: 50 }).then(function (res) {
                var found = {};
                ((res && res.items) || []).forEach(function (r) { found[r.id] = 1; });
                chunk.forEach(function (e) {
                  if (found[e.localId]) {
                    adopted[e.id] = 1; pushed++;
                    _setQueue(_queue().filter(function (x) { return x.id !== e.id; }));
                  }
                });
              }).catch(function () { /* offline: per-op path still protects via 400-adopt */ });
            });
          })(ops.slice(i, i + 20));
        }
      });
      return chain;
    }

    function pushOne(entry) {
      if (adopted[entry.id]) return Promise.resolve();
      var fresh = _queue().find(function (x) { return x.id === entry.id; });
      if (fresh) entry = fresh;
      var op = entry.op, coll = entry.collection, localId = entry.localId, data = entry.data;

      function doSend() {
        if (op === 'delete') {
          return _del(coll, localId).catch(function (err) {
            if (err && err.code === 404) return null;
            throw err;
          });
        }
        var payload = _toServer(coll, data, tenant, agentCode);
        if (localId) payload.id = localId;
        if (op === 'create') {
          return _create(coll, payload).catch(function (err) {
            if (localId && (err.code === 400 || err.code === 'NETWORK_ERROR')) {
              return _getOne(coll, localId).then(function () { return null; }).catch(function (e2) {
                if (e2 && e2.code === 404) throw err;
                if (e2 && e2.code === 'NETWORK_ERROR') throw e2;
                throw err;
              });
            }
            throw err;
          });
        }
        return _update(coll, localId, payload).catch(function (err) {
          if (err && err.code === 404) return _create(coll, payload);
          throw err;
        });
      }

      var gate = Promise.resolve();
      if (op === 'create' && coll === '3d_sessions' && _cfg.role === 'master' && data && data.date) {
        gate = _list('3d_sessions', { filter: 'tenant="' + tenant + '" && date="' + data.date + '"', perPage: 5 })
          .then(function (res) {
            var items = (res && res.items) || [];
            if (!items.length) return false;
            if (items[0].id === localId) return true; // already ours
            _adoptSession(state, localId, items[0]);
            if (saveFn) saveFn();
            return true; // adopted — never create a twin
          });
        // Gate failure = NO PROOF, NO CREATE: rethrow keeps it queued.
      }
      return gate.then(function (done) {
        if (done) return null;
        if (op === 'create' && coll !== '3d_sessions' && entry.attempts > 0 && localId) {
          return _getOne(coll, localId).then(function () { return null; }).catch(function (e) {
            if (e && e.code === 404) return doSend();
            throw e;
          });
        }
        return doSend();
      });
    }

    return preflight().then(function () {
      var chain = Promise.resolve();
      _queue().sort(function (a, b) { return (a.created || 0) - (b.created || 0); }).forEach(function (entry) {
        chain = chain.then(function () {
          if (adopted[entry.id]) return;
          /* Agent hold (Oct 24 phantom-session lesson): NEVER push
             records before the Agent has SEEN a server session. Until
             the first pull adopts the Master's round, local records
             carry the seed session id — pushing them orphans them on
             the server (Master shows 0). Held ops stay queued;
             adoption re-keys them, and the next push sends them
             under the server session id. */
          if (_cfg.role === 'agent' && entry.op === 'create' && entry.collection === '3d_records') {
            var seenNow = (_meta().seen || {})['3d_sessions'] || [];
            if (!seenNow.length) return;
          }
          return pushOne(entry).then(function () {
            _setQueue(_queue().filter(function (x) { return x.id !== entry.id; }));
            pushed++;
          }).catch(function (err) {
            var q = _queue();
            var f = q.find(function (x) { return x.id === entry.id; });
            if (f) { f.attempts = (f.attempts || 0) + 1; _setQueue(q); }
            _lastPushError = _fmtErr(err);
            failed++;
          });
        });
      });
      return chain;
    }).then(function () {
      _syncing = false;
      if (saveFn) saveFn();
      return { pushed: pushed, failed: failed, skipped: false };
    }).catch(function (err) {
      _syncing = false;
      _lastPushError = _fmtErr(err);
      return { pushed: pushed, failed: 1, skipped: false, error: _lastPushError };
    });
  }

  function pullUpdates(state, saveFn) {
    if (_syncing) return Promise.resolve({ pulled: 0, skipped: true });
    if (!isLoggedIn()) return Promise.resolve({ pulled: 0, skipped: true, reason: 'not-logged-in' });
    _syncing = true;
    _lastPullError = null;
    var tenant = getTenant();
    var colls = _cfg.role === 'agent' ? ['3d_sessions', '3d_people'] : ['3d_sessions', '3d_people', '3d_records'];
    var meta = _meta();
    /* Orphan rule (fixed Oct 24): a pull deletes ONLY rows it has
       SEEN on the server before (meta.seen) but that are gone now.
       A local row never seen on the server is NEVER deleted by pull
       — that was the v39 bug: pre-sync local data was wiped on the
       second sync because nothing had ever pushed it. */
    var seen = meta.seen || {};
    var pulled = 0, errors = [];
    var chain = Promise.resolve();

    colls.forEach(function (coll) {
      chain = chain.then(function () {
        return _listAll(coll, { filter: 'tenant="' + tenant + '"', sort: 'created' }).then(function (items) {
          var serverIds = {};
          items.forEach(function (it) { serverIds[it.id] = 1; });
          if (coll === '3d_sessions') {
            items.forEach(function (it) {
              _adoptSessionByDate(state, _fromServerSession(it));
              pulled++;
            });
          } else if (coll === '3d_people') {
            items.forEach(function (it) {
              var rec = _fromServerPerson(it);
              var ex = (state.people || []).find(function (p) { return p.id === rec.id; });
              if (ex) Object.assign(ex, rec); else state.people.push(rec);
              pulled++;
            });
          } else if (coll === '3d_records') {
            items.forEach(function (it) {
              var rec = _fromServerRecord(it);
              var ex = (state.records || []).find(function (r) { return r.id === rec.id; });
              if (ex) Object.assign(ex, rec); else state.records.push(rec);
              pulled++;
            });
          }
          // Orphan deletion: only rows seen on the server in an
          // EARLIER pull but absent now — and never rows with a
          // pending queue op (queue re-read NOW, at deletion time).
          var oldSeen = {};
          (seen[coll] || []).forEach(function (id) { oldSeen[id] = 1; });
          var pending = {};
          _queue().forEach(function (e) { if (e.localId) pending[e.localId] = 1; });
          var listKey = coll === '3d_sessions' ? 'sessions' : coll === '3d_people' ? 'people' : 'records';
          state[listKey] = (state[listKey] || []).filter(function (row) {
            return serverIds[row.id] || pending[row.id] || !oldSeen[row.id];
          });
          seen[coll] = Object.keys(serverIds);
        }).catch(function (err) { errors.push(coll + ': ' + err.message); });
      });
    });

    return chain.then(function () {
      if (state.sessions && state.sessions.length) {
        var cur = state.sessions.find(function (s) { return s.id === state.currentSessionId; });
        if (!cur) state.currentSessionId = state.sessions[0].id;
      }
      meta.seen = seen;
      _setMeta(meta);
      _syncing = false;
      if (saveFn) saveFn();
      if (errors.length) _lastPullError = errors.join('; ');
      return { pulled: pulled, skipped: false, error: errors.length ? errors.join('; ') : null };
    }).catch(function (err) {
      _syncing = false;
      _lastPullError = _fmtErr(err);
      return { pulled: pulled, skipped: false, error: _lastPullError };
    });
  }

  function syncNow(state, saveFn, agentCode) {
    if (_syncing) return Promise.resolve({ push: { skipped: true }, pull: { skipped: true } });
    return pushPending(state, saveFn, agentCode).then(function (pushRes) {
      return pullUpdates(state, saveFn).then(function (pullRes) {
        return { push: pushRes, pull: pullRes };
      });
    }).catch(function (err) {
      return { push: { failed: 1 }, pull: { skipped: true }, error: String(err && err.message || err) };
    });
  }

  function startAutoSync(state, saveFn, agentCode, onSync, intervalMs) {
    if (_autoStarted) return;
    _autoStarted = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', function () { syncNow(state, saveFn, agentCode).then(function (r) { if (onSync) onSync(r); }).catch(function () {}); });
    }
    // Pho Oct 25: sync immediately when the app returns to the
    // foreground — background timers freeze on phones, so without this
    // the outside phone can sit stale long past the 60s interval.
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (!isLoggedIn()) return;
        syncNow(state, saveFn, agentCode).then(function (r) { if (onSync) onSync(r); }).catch(function () {});
      });
    }
    if (typeof setInterval !== 'undefined') {
      setInterval(function () {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (!isLoggedIn()) return;
        syncNow(state, saveFn, agentCode).then(function (r) { if (onSync) onSync(r); }).catch(function () {});
      }, intervalMs || 60000);
    }
  }

  window.Sync3D = {
    init: function (cfg) { Object.assign(_cfg, cfg || {}); },
    uid15: uid15,
    migrateState: migrateState,
    codeToCreds: codeToCreds,
    login: login,
    checkAgentDisabled: checkAgentDisabled,
    logout: logout,
    isLoggedIn: isLoggedIn,
    getTenant: getTenant,
    getUser: getUser,
    queue: queue,
    repushAll: repushAll,
    repushOnce: repushOnce,
    queueCount: function () { return _queue().length; },
    pushPending: pushPending,
    pullUpdates: pullUpdates,
    syncNow: syncNow,
    startAutoSync: startAutoSync,
    getLastPushError: function () { return _lastPushError; },
    getLastPullError: function () { return _lastPullError; },
    isSyncing: function () { return _syncing; }
  };
})();
