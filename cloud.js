/* Cloud : relie l'application à Firebase (connexion + base Firestore + photos).
   Expose window.claude.use("db" | "assets") avec la même forme que la page publiée dans Claude,
   pour que la logique de synchronisation de l'app soit identique dans les deux cas.
   Chaque document est stocké sous la forme {j:"<json>"} dans users/<uid>/… : aucune contrainte de format côté Firestore. */
(function () {
  var cfg = window.FIREBASE_CONFIG || {};
  var cfgOk = !!(cfg.apiKey && !/COLLE|XXXX/i.test(cfg.apiKey) && cfg.projectId && !/COLLE|XXXX/i.test(cfg.projectId));
  var fb = null, user = null, authKnown = false, sdkFail = false;
  var LIMITE = 900000;   /* caractères base64 max par photo (Firestore : 1 Mo par document) */

  function g(id) { return document.getElementById(id); }
  function full(p) { return "users/" + user.uid + "/" + p; }
  function wrapOut(d) { return { j: JSON.stringify(d) }; }
  function wrapIn(d) {
    if (d && typeof d.j === "string") { try { return JSON.parse(d.j); } catch (e) { return undefined; } }
    return d;
  }
  function mapErr(e) {
    var c = (e && e.code) || "";
    if (e && e.__mapped) return e;
    var m = "unavailable";
    if (/permission-denied|unauthenticated/.test(c)) m = "denied";
    else if (/resource-exhausted/.test(c)) m = "quota_exceeded";
    else if (/invalid-argument|out-of-range|failed-precondition/.test(c)) m = "invalid_argument";
    else if (c === "not_found") m = "not_found";
    return { code: m, message: (e && e.message) || c, __mapped: true };
  }
  function cap(p) { return p.then(function (v) { return v; }, function (e) { throw mapErr(e); }); }

  /* ---------- base de données (même forme que la capacité db) ---------- */
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      set: function (d) { return cap(fb.setDoc(full(path), wrapOut(d))); },
      delete: function () { return cap(fb.delDoc(full(path))); },
      get: function () {
        return cap(fb.getDoc(full(path))).then(function (d) { var v = wrapIn(d); return { exists: !!v, data: function () { return v; } }; });
      },
      onSnapshot: function (next, err) {
        return fb.docSnap(full(path), function (s) {
          var v = s.exists ? wrapIn(s.data) : undefined;
          next({ id: s.id, exists: !!v, data: function () { return v; }, metadata: { fromCache: !!s.fromCache, hasPendingWrites: false } });
        }, function (e) { if (err) err(mapErr(e)); });
      }
    };
  }
  function colRef(path) {
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + id); },
      onSnapshot: function (next, err) {
        return fb.colSnap(full(path), function (s) {
          var docs = [];
          s.docs.forEach(function (d) {
            var v = wrapIn(d.data);
            if (v !== undefined) docs.push({ id: d.id, exists: true, data: function () { return v; }, metadata: { fromCache: !!s.fromCache, hasPendingWrites: false } });
          });
          next({ docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: !!s.fromCache, hasPendingWrites: false } });
        }, function (e) { if (err) err(mapErr(e)); });
      }
    };
  }
  var DB = { collection: colRef, doc: docRef };

  /* ---------- photos : stockées dans Firestore (users/<uid>/photoData/<id>), en base64 ---------- */
  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); res(s.slice(s.indexOf(",") + 1)); };
      r.onerror = function () { rej({ code: "invalid_argument", message: "lecture de la photo impossible", __mapped: true }); };
      r.readAsDataURL(blob);
    });
  }
  function shrink(blob, max, q) {
    return new Promise(function (res) {
      var im = new Image(), u = URL.createObjectURL(blob);
      im.onload = function () {
        var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { res(b || blob); }, "image/jpeg", q);
      };
      im.onerror = function () { URL.revokeObjectURL(u); res(blob); };
      im.src = u;
    });
  }
  function prepare(blob) {
    var essais = [[1280, 0.75], [1000, 0.6], [800, 0.5]], cur = blob;
    function etape(i) {
      return toB64(cur).then(function (b) {
        if (b.length <= LIMITE) return { b64: b, type: cur.type || "image/jpeg", size: cur.size };
        if (i >= essais.length) throw { code: "invalid_argument", message: "photo trop lourde", __mapped: true };
        return shrink(blob, essais[i][0], essais[i][1]).then(function (nb) { cur = nb; return etape(i + 1); });
      });
    }
    return etape(0);
  }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: type || "image/jpeg" });
  }
  var ASSETS = {
    upload: function (blob) {
      return prepare(blob).then(function (r) {
        var id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return cap(fb.setDoc(full("photoData/" + id), wrapOut({ t: Date.now(), type: r.type, data: r.b64 }))).then(function () {
          return { id: id, url: "", sizeBytes: r.size, contentType: r.type };
        });
      });
    },
    get: function (id) {
      return cap(fb.getDoc(full("photoData/" + id))).then(function (d) {
        var v = wrapIn(d);
        if (!v || !v.data) throw { code: "not_found", message: "photo absente du cloud", __mapped: true };
        return b64ToBlob(v.data, v.type);
      });
    },
    delete: function (id) { return cap(fb.delDoc(full("photoData/" + id))).then(function () { return { deleted: true }; }); }
  };

  /* ---------- point d'entrée utilisé par l'app ---------- */
  var ready = new Promise(function (res) {
    if (!cfgOk) { res(); return; }
    (window.FBSDK_READY || Promise.resolve(null)).then(function (f) {
      fb = f;
      if (!f) { sdkFail = true; res(); return; }
      f.onAuth(function (u) {
        var premier = !authKnown;
        authKnown = true;
        user = u;
        if (u) {
          try {
            var prev = localStorage.getItem("suivi-uid");
            if (prev && prev !== u.uid) {   /* autre compte sur cet appareil : on repart d'une première liaison propre */
              localStorage.removeItem("suivi-sync-v1");
              localStorage.setItem("suivi-uid", u.uid);
              location.reload();
              return;
            }
            localStorage.setItem("suivi-uid", u.uid);
          } catch (e) {}
        }
        if (premier) res();
        else if (u && window.SY) { try { SY.start(); } catch (e) {} }
        try { if (window.SY) SY.repeindre(); } catch (e) {}
      });
    });
  });
  window.claude = {
    use: function (name) {
      if (name !== "db" && name !== "assets") return Promise.resolve(null);
      return ready.then(function () { return (fb && user) ? (name === "db" ? DB : ASSETS) : null; });
    }
  };

  /* ---------- interface : connexion / compte ---------- */
  var MSG = {
    "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/user-not-found": "Aucun compte avec cet e-mail : touche « Créer mon compte ».",
    "auth/email-already-in-use": "Ce compte existe déjà : touche « Se connecter ».",
    "auth/weak-password": "Mot de passe trop court (6 caractères minimum).",
    "auth/invalid-email": "Adresse e-mail invalide.",
    "auth/missing-password": "Saisis ton mot de passe.",
    "auth/network-request-failed": "Pas de connexion internet.",
    "auth/too-many-requests": "Trop d'essais : réessaie dans quelques minutes.",
    "auth/operation-not-allowed": "La connexion par e-mail n'est pas activée dans Firebase (voir le guide, étape 3).",
    "auth/user-disabled": "Ce compte est désactivé."
  };
  function msgAuth(e) { return MSG[e && e.code] || ("Échec de la connexion" + (e && e.code ? " (" + e.code + ")" : "") + "."); }

  function panel(b) {
    var P = function (cls, txt) { var p = document.createElement("p"); p.className = cls; p.textContent = txt; return p; };
    if (!cfgOk) {
      b.appendChild(P("sh-p", "La synchronisation n'est pas encore configurée : ouvre le fichier firebase-config.js du site et remplace les COLLE_ICI par les réglages de ton projet Firebase (voir le guide)."));
      return;
    }
    if (sdkFail) {
      b.appendChild(P("sh-p", "Impossible de charger Firebase (pas de connexion, ou réglages incorrects). Les données restent sur cet appareil ; réessaie quand tu es en ligne."));
      return;
    }
    if (user) {
      b.appendChild(el("hr", "sh-sep"));
      b.appendChild(P("sh-p", "Compte : " + user.email));
      var out = el("button", "pbtn sh-ok sh-alt", "Se déconnecter"); out.type = "button"; var a = false;
      out.onclick = function () {
        if (!a) { a = true; out.textContent = "Confirmer : se déconnecter de cet appareil"; setTimeout(function () { a = false; out.textContent = "Se déconnecter"; }, 6000); return; }
        try { localStorage.removeItem("suivi-sync-v1"); } catch (e) {}
        fb.signOut().then(function () { location.reload(); }, function () { location.reload(); });
      };
      b.appendChild(out);
      return;
    }
    b.appendChild(P("sh-p", "Connecte-toi (ou crée ton compte la première fois) pour retrouver tes dossiers sur tous tes appareils. Utilise le même e-mail et le même mot de passe partout."));
    var em = el("input", "note"); em.type = "email"; em.placeholder = "E-mail"; em.autocomplete = "email"; em.setAttribute("autocapitalize", "off");
    var pw = el("input", "note"); pw.type = "password"; pw.placeholder = "Mot de passe (6 caractères min.)"; pw.autocomplete = "current-password";
    var err = el("p", "sh-err");
    var bIn = el("button", "add sh-ok", "Se connecter"); bIn.type = "button";
    var bUp = el("button", "pbtn sh-ok sh-alt", "Créer mon compte"); bUp.type = "button";
    var bRe = el("button", "pbtn sh-ok sh-alt", "Mot de passe oublié"); bRe.type = "button";
    function occ(v) { bIn.disabled = bUp.disabled = bRe.disabled = v; }
    function go(fn) {
      var e = em.value.trim(), p = pw.value;
      if (!e) { err.textContent = "Saisis ton e-mail."; em.focus(); return; }
      err.textContent = ""; occ(true);
      fn(e, p).then(function () { occ(false); fermerSheet(); toast("Connecté"); }, function (x) { occ(false); err.textContent = msgAuth(x); });
    }
    bIn.onclick = function () { go(function (e, p) { return fb.signIn(e, p); }); };
    bUp.onclick = function () { go(function (e, p) { return fb.signUp(e, p); }); };
    bRe.onclick = function () {
      var e = em.value.trim(); if (!e) { err.textContent = "Saisis ton e-mail puis touche « Mot de passe oublié »."; em.focus(); return; }
      fb.resetPw(e).then(function () { err.style.color = "var(--muted)"; err.textContent = "E-mail de réinitialisation envoyé (regarde aussi les courriers indésirables)."; }, function (x) { err.style.color = ""; err.textContent = msgAuth(x); });
    };
    pw.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); bIn.click(); } };
    [em, pw, err, bIn, bUp, bRe].forEach(function (n) { b.appendChild(n); });
    setTimeout(function () { em.focus(); }, 80);
  }

  function libOff() {
    if (!cfgOk) return "Synchronisation non configurée : données sur cet appareil seulement";
    if (sdkFail) return "Firebase injoignable : données sur cet appareil seulement";
    if (authKnown && !user) return "Non connecté : données sur cet appareil seulement";
    return "Synchronisation indisponible : données sur cet appareil seulement";
  }

  window.CLOUD = {
    configured: cfgOk, panel: panel, libOff: libOff,
    connecte: function () { return !!user; },
    attendu: function () { return cfgOk && authKnown && !user && !sdkFail; }
  };

  /* première ouverture non connectée : on propose la connexion une fois */
  ready.then(function () {
    if (cfgOk && !sdkFail && !user) {
      var vu = false; try { vu = sessionStorage.getItem("suivi-login-vu") === "1"; } catch (e) {}
      if (!vu) { try { sessionStorage.setItem("suivi-login-vu", "1"); } catch (e) {} setTimeout(function () { try { SY.feuille(); } catch (e) {} }, 700); }
    }
  });
})();
