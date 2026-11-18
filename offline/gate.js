/* 3D Master Offline - device-bound license + PIN gate.
   License scheme (Pho Nov 3): one phone + one app = one license.
   Key = "deviceId|app|expiry.sig" where app is 2D/3D and expiry is
   YYYYMMDD (trial, fixed from issue date) or NEVER (paid, no expiry).
   Signature = ECDSA P-256 over the UTF-8 payload, base64url.
   Binding = the phone's ANDROID_ID, exposed by the Java DeviceBridge.
   Without the bridge (browser/jsdom test) it falls back to the persisted
   install ID so the code stays testable. A 2D key can never open 3D and
   vice versa (app marker in the signed payload).
   Migration: installs activated under the old scheme (legacy flag, no new
   license stored) are grandfathered with no expiry. A stored new license
   always governs over the legacy flag, so an expired trial can never fall
   back to permanent access. Expiry never wipes data or PIN — it only
   shows the key-entry screen again. */
(function () {
  var PUB = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAECmHe8rKGM3xv4VCKtrg1CyNkeCl0rZfWSbZDX9R1LgslGQqbWxEq10N8UaZI6meL3CXqrq78dgXN4+vqMZux6w==';
  var APP = '3D';
  var K = { id: 'off3d_install_id', act: 'off3d_activated', pin: 'off3d_pin_hash', lic: 'off3d_license' };
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function installId() {
    var id = ls(K.id);
    if (!id) {
      id = 'off3d-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      set(K.id, id);
    }
    return id;
  }
  /* Stable device ID: ANDROID_ID from the Java bridge survives app delete +
     reinstall on the same phone (changes only on factory reset). The old
     random install ID lived in localStorage and died with the app, so it
     could never satisfy "same phone, reinstall works". */
  function deviceId() {
    try {
      if (typeof window !== 'undefined' && window.DeviceBridge && typeof window.DeviceBridge.getDeviceId === 'function') {
        var d = window.DeviceBridge.getDeviceId();
        if (d) return String(d);
      }
    } catch (e) {}
    return installId();
  }
  /* Padding-tolerant base64/base64url decoder (keygen may emit unpadded). */
  function b64b(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  function shaHex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (d) {
      return Array.from(new Uint8Array(d)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function verifySig(payload, sigB64) {
    return crypto.subtle.importKey('spki', b64b(PUB), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (pk) {
        return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, b64b(sigB64), new TextEncoder().encode(payload));
      })
      .catch(function () { return false; });
  }
  function todayYMD() {
    var n = new Date();
    return n.getFullYear() + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0');
  }
  /* Check a stored/entered license string "payload.sig".
     Returns { ok:true } or { ok:false, reason:'expired'|'mismatch'|'bad'|'none' }. */
  function checkLicense(stored) {
    if (!stored) return Promise.resolve({ ok: false, reason: 'none' });
    var dot = stored.lastIndexOf('.');
    if (dot <= 0) return Promise.resolve({ ok: false, reason: 'bad' });
    var payload = stored.slice(0, dot);
    var sig = stored.slice(dot + 1);
    var parts = payload.split('|');
    if (parts.length !== 3) return Promise.resolve({ ok: false, reason: 'bad' });
    if (parts[1] !== APP) return Promise.resolve({ ok: false, reason: 'mismatch' });
    if (parts[0] !== deviceId()) return Promise.resolve({ ok: false, reason: 'mismatch' });
    if (parts[2] !== 'NEVER') {
      if (!/^\d{8}$/.test(parts[2])) return Promise.resolve({ ok: false, reason: 'bad' });
      if (parts[2] < todayYMD()) return Promise.resolve({ ok: false, reason: 'expired' });
    }
    return verifySig(payload, sig).then(function (ok) {
      return ok ? { ok: true } : { ok: false, reason: 'bad' };
    });
  }
  function $(id) { return document.getElementById(id); }
  function gate() { return $('gate'); }
  function show(html) { var g = gate(); g.innerHTML = html; g.style.display = 'flex'; }
  function hide() { gate().style.display = 'none'; }
  var LOGO = '<img class="gate-logo" src="logo.png" alt="3D Master">';
  function err() { return '<div class="gate-err" id="gateErr"></div>'; }
  function setErr(t) { var e = $('gateErr'); if (e) e.textContent = t; }

  function renderActivation(expired) {
    var id = deviceId();
    show('<div class="gate-card">' + LOGO +
      '<h2>3D <span class="g">MASTER</span></h2><div class="gate-sub">Offline — ' + (expired ? 'Key သက်တမ်းကုန်ပြီ — Key အသစ် ထည့်ပါ' : 'Activate လုပ်ပါ') + '</div>' +
      '<div class="gate-lab">Device ID (ရောင်းသူ့ဆီ ပို့ပါ)</div>' +
      '<div class="gate-id" id="gateId">' + id + '</div>' +
      '<button class="btn gray" id="gateCopy">ID ကူးမယ်</button>' +
      '<input class="inp" id="gateKey" placeholder="License Key ထည့်ပါ" autocomplete="off">' +
      '<button class="btn" id="gateGo">Activate လုပ်မယ်</button>' + err() + '</div>');
    $('gateCopy').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(deviceId()).then(function () { setErr('ကူးပြီးပြီ'); });
      }
    });
    $('gateGo').addEventListener('click', function () {
      var key = $('gateKey').value || '';
      if (!key.trim()) { setErr('License Key ထည့်ပါ'); return; }
      setErr('စစ်နေတယ်…');
      checkLicense(key.trim()).then(function (r) {
        if (!r.ok) {
          setErr(r.reason === 'expired' ? 'Key သက်တမ်းကုန်နေပြီ — အသစ် တောင်းပါ' : 'Key မှားနေတယ် — ရောင်းသူ့ကို ပြန်မေးပါ');
          return;
        }
        set(K.lic, key.trim());
        if (ls(K.pin)) renderPinEntry(); else renderSetPin();
      });
    });
  }
  function renderSetPin() {
    show('<div class="gate-card">' + LOGO +
      '<h2>3D <span class="g">MASTER</span></h2><div class="gate-sub">PIN သတ်မှတ်ပါ (ဂဏန်း ၄ လုံး အထက်)</div>' +
      '<input class="inp" id="gatePin1" type="password" inputmode="numeric" placeholder="PIN အသစ်" autocomplete="new-password">' +
      '<input class="inp" id="gatePin2" type="password" inputmode="numeric" placeholder="PIN ထပ်ရိုက်ပါ" autocomplete="new-password">' +
      '<button class="btn" id="gatePinSave">သိမ်းမယ်</button>' + err() + '</div>');
    $('gatePinSave').addEventListener('click', function () {
      var p1 = $('gatePin1').value || '', p2 = $('gatePin2').value || '';
      if (!/^\d{4,}$/.test(p1)) { setErr('PIN က ဂဏန်း ၄ လုံးအထက် ဖြစ်ရမယ်'); return; }
      if (p1 !== p2) { setErr('PIN ၂ ခု မတူဘူး'); return; }
      shaHex('off3dpin:' + p1).then(function (h) { set(K.pin, h); hide(); });
    });
  }
  function renderPinEntry() {
    show('<div class="gate-card">' + LOGO +
      '<h2>3D <span class="g">MASTER</span></h2><div class="gate-sub">Offline</div>' +
      '<input class="inp" id="gatePin" type="password" inputmode="numeric" placeholder="PIN ထည့်ပါ" autocomplete="current-password">' +
      '<button class="btn" id="gateEnter">ဝင်မည်</button>' + err() + '</div>');
    function go() {
      var p = $('gatePin').value || '';
      shaHex('off3dpin:' + p).then(function (h) {
        if (h === ls(K.pin)) hide();
        else setErr('PIN မှားနေတယ်');
      });
    }
    $('gateEnter').addEventListener('click', go);
    $('gatePin').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  function boot() {
    var lic = ls(K.lic);
    if (lic) {
      /* A stored new license always governs: valid -> PIN, expired/invalid
         -> key screen. It never falls back to the legacy flag, or an
         expired trial could silently regain permanent access. */
      show('<div class="gate-card">' + LOGO + '<h2>3D <span class="g">MASTER</span></h2><div class="gate-sub">စစ်နေတယ်…</div></div>');
      checkLicense(lic).then(function (r) {
        if (r.ok) { if (!ls(K.pin)) renderSetPin(); else renderPinEntry(); }
        else if (r.reason === 'expired') renderActivation(true);
        else renderActivation(false);
      });
      return;
    }
    /* Grandfathered: activated under the old scheme, no new license stored. */
    if (ls(K.act) === '1') { if (!ls(K.pin)) renderSetPin(); else renderPinEntry(); return; }
    renderActivation(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
