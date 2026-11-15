const CACHE = 'music-core-shell-v5';
const SHELL = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event => {event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event => {event.waitUntil(Promise.all([caches.keys().then(names=>Promise.all(names.filter(n=>n!==CACHE).map(n=>caches.delete(n)))),self.clients.claim()]));});
self.addEventListener('fetch',event => {
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin) return;
  event.respondWith((async()=>{
    try { const r=await fetch(req); if(r.ok && !req.headers.has('range')) { const c=await caches.open(CACHE); await c.put(req,r.clone()); } return r; }
    catch { const r=await caches.match(req,{ignoreSearch:true}); return r || (req.mode==='navigate' ? caches.match('./index.html') : Response.error()); }
  })());
});
