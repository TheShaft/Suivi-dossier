/* Service worker : l'app démarre aussi hors connexion. Incrémenter V pour forcer une mise à jour. */
var V="suivi-v4";
var FICHIERS=["./","index.html","firebase-config.js","fb-sdk.js","cloud.js","manifest.webmanifest","icon-192.png","icon-512.png","icon-512-maskable.png","apple-touch-icon.png"];
self.addEventListener("install",function(e){
  e.waitUntil(caches.open(V).then(function(c){return Promise.all(FICHIERS.map(function(f){return c.add(f).catch(function(){});}));}).then(function(){return self.skipWaiting();}));
});
self.addEventListener("activate",function(e){
  e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));
});
function reseauPuisCache(r,cle){
  /* réseau d'abord (pour recevoir les mises à jour), copie en mémoire si hors connexion ou trop lent */
  return new Promise(function(res){
    var fini=false,t=setTimeout(function(){caches.match(cle||r).then(function(m){if(m&&!fini){fini=true;res(m);}});},4000);
    fetch(r).then(function(rep){
      clearTimeout(t);
      if(rep&&rep.ok){var cp=rep.clone();caches.open(V).then(function(c){c.put(cle||r,cp);});}
      if(!fini){fini=true;res(rep);}
    }).catch(function(){
      clearTimeout(t);
      caches.match(cle||r).then(function(m){if(!fini){fini=true;res(m||Response.error());}});
    });
  });
}
self.addEventListener("fetch",function(e){
  var r=e.request,u=new URL(r.url);
  if(r.method!=="GET")return;
  if(u.origin===location.origin){
    e.respondWith(reseauPuisCache(r,r.mode==="navigate"?"index.html":r));
    return;
  }
  /* SDK Firebase (versions figées, ne changent jamais) : mémoire d'abord */
  if(u.hostname==="www.gstatic.com"&&u.pathname.indexOf("/firebasejs/")===0){
    e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(rep){if(rep&&rep.ok){var cp=rep.clone();caches.open(V).then(function(c){c.put(r,cp);});}return rep;});}));
  }
});
