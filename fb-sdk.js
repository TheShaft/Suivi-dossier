/* Couche minimale entre l'application et Firebase.
   Le SDK officiel est chargé depuis le CDN de Google (version figée) puis gardé en mémoire
   par le service worker : après un premier lancement en ligne, l'app démarre aussi hors connexion. */
const V = "10.14.1";
const B = "https://www.gstatic.com/firebasejs/" + V + "/";
(async function () {
  const fin = window.__fbr || function () {};
  try {
    const c = window.FIREBASE_CONFIG;
    if (!c || !c.apiKey || /COLLE|XXXX/i.test(c.apiKey) || !c.projectId || /COLLE|XXXX/i.test(c.projectId)) { fin(null); return; }
    const [A, AU, FS] = await Promise.all([
      import(B + "firebase-app.js"),
      import(B + "firebase-auth.js"),
      import(B + "firebase-firestore.js")
    ]);
    const app = A.initializeApp(c);
    const auth = AU.getAuth(app);
    let fs;
    try {
      fs = FS.initializeFirestore(app, { localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() }) });
    } catch (e) {
      fs = FS.getFirestore(app);
    }
    const usr = (cr) => ({ uid: cr.user.uid, email: cr.user.email });
    fin({
      onAuth: (cb) => AU.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
      signIn: (e, p) => AU.signInWithEmailAndPassword(auth, e, p).then(usr),
      signUp: (e, p) => AU.createUserWithEmailAndPassword(auth, e, p).then(usr),
      signOut: () => AU.signOut(auth),
      resetPw: (e) => AU.sendPasswordResetEmail(auth, e),
      colSnap: (path, next, err) => FS.onSnapshot(
        FS.collection(fs, path), { includeMetadataChanges: true },
        (s) => next({ docs: s.docs.map((d) => ({ id: d.id, data: d.data() })), fromCache: s.metadata.fromCache }),
        err),
      docSnap: (path, next, err) => FS.onSnapshot(
        FS.doc(fs, path), { includeMetadataChanges: true },
        (s) => next({ id: s.id, exists: s.exists(), data: s.exists() ? s.data() : undefined, fromCache: s.metadata.fromCache }),
        err),
      setDoc: (path, data) => FS.setDoc(FS.doc(fs, path), data),
      delDoc: (path) => FS.deleteDoc(FS.doc(fs, path)),
      getDoc: (path) => FS.getDoc(FS.doc(fs, path)).then((s) => (s.exists() ? s.data() : null))
    });
  } catch (e) {
    console.error("Firebase indisponible", e);
    fin(null);
  }
})();
