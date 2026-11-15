/* Music Core — player de música online: Audius, Internet Archive e a conta Spotify de cada usuário.
   Sem servidor: biblioteca, playlists e login ficam apenas no navegador de cada pessoa. */
(() => {
  'use strict';
  const DB_NAME = 'music-core-v1', DB_VERSION = 1;
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmt = ms => { const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };
  const guid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const norm = str => String(str || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const state = {db:null, tracks:[], playlists:[], view:'home', selectedPlaylist:null, query:'', queue:[], index:-1, current:null, shuffled:false, repeat:'off', objectUrl:null, toastTimer:null,
    engine:'audio', remote:new Map(), explore:{source:'audius', query:'', items:[], tracks:[], album:null, loading:false, error:null, loaded:false, req:0}};
  /* Fontes online com API pública e streaming autorizado pela própria plataforma. */
  const APP_NAME='MusicCore', AUDIUS='https://api.audius.co', IA='https://archive.org';
  const SOURCES={audius:'Audius',archive:'Internet Archive',spotify:'Spotify'};
  const audio = $('#audio');
  audio.volume = 0.78;

  function transact(storeName, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, mode);
      const req = action(tx.objectStore(storeName));
      let value;
      if (req && 'onsuccess' in req) {req.onsuccess = () => value = req.result;req.onerror = () => reject(req.error);}
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function initDB() {
    state.db = await new Promise((resolve,reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db=req.result;
        if(!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks',{keyPath:'id'});
        if(!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists',{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    await refresh();
  }
  async function refresh() {
    state.tracks = await transact('tracks','readonly', s=>s.getAll());
    state.playlists = await transact('playlists','readonly', s=>s.getAll());
    state.tracks.sort((a,b)=> (b.addedAt||0)-(a.addedAt||0));
    state.playlists.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    render();
  }
  async function saveTrack(t){t.addedAt??=Date.now();await transact('tracks','readwrite',s=>s.put(t));await refresh();}
  async function savePlaylist(p){await transact('playlists','readwrite',s=>s.put(p));await refresh();}
  function lookup(id){return state.tracks.find(t=>t.id === id) || state.remote.get(id);}
  function isSaved(id){return state.tracks.some(t=>t.id===id);}
  async function ensureSaved(id){if(isSaved(id))return;const t=state.remote.get(id);if(t)await saveTrack({...t});}
  function notice(msg){ const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>t.classList.remove('show'),4500); }
  function canPlay(t){return Boolean(t?.audioBlob instanceof Blob || t?.demoUrl || t?.streamUrl || t?.spotifyUri);}
  function cover(t, cls='track-cover') {
    const src=t?.coverUrl;
    if(src && /^https:\/\//.test(src)) return `<div class="${cls}" style="background:#332a50;overflow:hidden"><img src="${esc(src)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`;
    const hue = (t?.title || '♪').split('').reduce((sum,c)=>sum+c.charCodeAt(0),0)%360;
    return `<div class="${cls}" style="background:linear-gradient(140deg,hsl(${hue} 40% 42%),hsl(${(hue+65)%360} 35% 28%))">♫</div>`;
  }
  function heading(text,subtitle=''){return `<h1 class="page-title">${esc(text)}</h1>${subtitle?`<p class="muted micro">${esc(subtitle)}</p>`:''}`;}
  function buttons(){return `<div class="hero-actions"><button class="primary-btn" data-nav="explore" type="button">◎ Explorar músicas online</button></div>`;}
  function empty(title,msg){return `<div class="empty"><div class="empty-icon">♫</div><h3>${esc(title)}</h3><p>${esc(msg)}</p>${buttons()}</div>`;}
  function trackTable(tracks, options={}) {
    if(!tracks.length) return empty(options.emptyTitle||'Nenhuma música encontrada',options.emptyText||'Busque músicas em Explorar e salve as que gostar.');
    return `<div class="track-list ${options.remote?'remote':''}"><div class="track-table-head"><span>#</span><span>MÚSICA</span><span class="album-col">ÁLBUM</span><span class="duration-col">DURAÇÃO</span><span></span></div>${tracks.map((t,i)=>`<div class="track-row ${t.id===state.current?'active':''}" data-track="${esc(t.id)}"><span class="idx">${i+1}</span><div class="track-main">${cover(t)}<div class="track-meta"><span class="track-title" title="${esc(t.title)}">${esc(t.title)}</span><span class="track-artist" title="${esc(t.artist)}">${esc(t.artist||'Artista desconhecido')}${canPlay(t)?'':' · Apenas catálogo'}${(t.streamUrl||t.spotifyUri)&&!options.remote?` · ${esc(SOURCES[t.source]||'Online')}`:''}</span></div></div><span class="track-size album-col" title="${esc(t.album||'')}">${esc(t.album||'—')}</span><span class="duration-col muted micro">${fmt(t.durationMs)}</span><div class="table-actions">${options.remote?`<button class="table-btn ${isSaved(t.id)?'on':''}" data-action="save" data-id="${esc(t.id)}" title="${isSaved(t.id)?'Já está na biblioteca':'Salvar na biblioteca'}">${isSaved(t.id)?'✓':'⤓'}</button>`:''}<button class="table-btn ${t.liked?'on':''}" data-action="like" data-id="${esc(t.id)}" title="Favoritar">${t.liked?'♥':'♡'}</button><button class="table-btn more-btn" data-action="add" data-id="${esc(t.id)}" title="Adicionar à playlist">＋</button><button class="play-row" data-action="play" data-id="${esc(t.id)}" title="Reproduzir">${t.id===state.current && !isPaused()?'Ⅱ':'▶'}</button></div></div>`).join('')}</div>`;
  }
  function filter(arr) {if(!state.query.trim()) return arr;const q=norm(state.query);return arr.filter(t=>norm(`${t.title} ${t.artist} ${t.album}`).includes(q));}
  async function getJson(url){const r=await fetch(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
  function remember(t){if(!isSaved(t.id))state.remote.set(t.id,t);return t.id;}
  function parseLength(v){const s=String(v||'');if(s.includes(':'))return s.split(':').reduce((acc,p)=>acc*60+Number(p),0)*1000||0;return Math.round(Number(s)*1000)||0;}
  async function searchAudius(q){
    const url=q?`${AUDIUS}/v1/tracks/search?query=${encodeURIComponent(q)}&limit=40&app_name=${APP_NAME}`:`${AUDIUS}/v1/tracks/trending?limit=40&app_name=${APP_NAME}`;
    const {data=[]}=await getJson(url);
    return data.filter(t=>t.is_streamable!==false&&!t.is_stream_gated).map(t=>remember({id:`audius:${t.id}`,source:'audius',title:t.title,artist:t.user?.name||'',album:t.genre||'Audius',durationMs:(t.duration||0)*1000,coverUrl:t.artwork?.['480x480']||null,liked:false,streamUrl:`${AUDIUS}/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=${APP_NAME}`,sourceInfo:{pageUrl:t.permalink?`https://audius.co${t.permalink}`:null}}));
  }
  async function searchArchive(q){
    const params=new URLSearchParams({q:`${q?`(${q})`:'collection:etree'} AND mediatype:audio AND format:"VBR MP3"`,rows:'40',output:'json'});
    for(const f of ['identifier','title','creator','year'])params.append('fl[]',f);
    params.append('sort[]','downloads desc');
    const data=await getJson(`${IA}/advancedsearch.php?${params}`);
    return (data.response?.docs||[]).map(d=>({id:d.identifier,title:[].concat(d.title||d.identifier)[0],artist:[].concat(d.creator||'')[0],info:d.year||'',coverUrl:`${IA}/services/img/${encodeURIComponent(d.identifier)}`}));
  }
  async function archiveTracks(ident,item){
    const meta=await getJson(`${IA}/metadata/${encodeURIComponent(ident)}`);
    const album=[].concat(meta.metadata?.title||item?.title||ident)[0], creator=[].concat(meta.metadata?.creator||item?.artist||'')[0];
    const files=(meta.files||[]).filter(f=>f.format==='VBR MP3').sort((a,b)=>(parseInt(a.track)||0)-(parseInt(b.track)||0));
    return {title:album,tracks:files.map(f=>remember({id:`archive:${ident}/${f.name}`,source:'archive',title:f.title||f.name.replace(/^.*\//,'').replace(/\.[^.]+$/,''),artist:f.creator||f.artist||creator,album,durationMs:parseLength(f.length),coverUrl:`${IA}/services/img/${encodeURIComponent(ident)}`,liked:false,streamUrl:`${IA}/download/${encodeURIComponent(ident)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,sourceInfo:{pageUrl:`${IA}/details/${encodeURIComponent(ident)}`,license:meta.metadata?.licenseurl||null}}))};
  }
  async function runExplore(){
    const ex=state.explore,req=++ex.req,q=ex.query.trim();
    Object.assign(ex,{loading:true,error:null,album:null,loaded:true,items:[],tracks:[]});render();
    try{
      if(ex.source==='audius')ex.tracks=await searchAudius(q);
      else if(ex.source==='archive')ex.items=await searchArchive(q);
      else if(spLogged()){if(q)ex.tracks=await searchSpotify(q);else ex.items=await spotifyLibrary();}
    }catch(err){if(req!==ex.req)return;ex.error=ex.source==='spotify'?`Spotify: ${err.message}`:'Verifique sua conexão com a internet e tente novamente.';}
    if(req!==ex.req)return;
    ex.loading=false;render();
  }
  async function openItem(id){
    const ex=state.explore,req=++ex.req,item=ex.items.find(i=>i.id===id);
    ex.loading=true;ex.error=null;render();
    try{
      const res=ex.source==='spotify'?{title:item?.title,tracks:(await spotifyListTracks(id)).map(spTrack)}:await archiveTracks(id,item);
      if(req!==ex.req)return;
      ex.tracks=res.tracks;ex.album={id,title:res.title||id};
    }catch(err){if(req!==ex.req)return;ex.error=ex.source==='spotify'?`Spotify: ${err.message}`:'Não foi possível abrir este item.';}
    ex.loading=false;render();
  }
  function exploreTracks(){return state.explore.tracks.map(lookup).filter(Boolean);}
  function itemList(items){return `<div class="track-list">${items.map((it,i)=>`<div class="track-row"><span class="idx">${i+1}</span><div class="track-main">${cover(it)}<div class="track-meta"><span class="track-title" title="${esc(it.title)}">${esc(it.title)}</span><span class="track-artist">${esc(it.artist||'Autor desconhecido')}</span></div></div><span class="track-size album-col">${esc(it.info||'—')}</span><span class="duration-col"></span><div class="table-actions"><button class="chip" data-action="explore-open" data-id="${esc(it.id)}" type="button">Abrir ▸</button></div></div>`).join('')}</div>`;}
  function spotifySetupView(){
    if(!spClientId())return `<div class="setup-card"><h3>Conectar sua conta do Spotify</h3><ol><li>Abra <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> e entre com a sua conta do Spotify.</li><li>Clique em <b>Create app</b>. Nome e descrição podem ser quaisquer (ex.: Music Core).</li><li>Em <b>Redirect URIs</b>, cole exatamente <code>${esc(spRedirect())}</code> e clique em <b>Add</b>.</li><li>Marque <b>Web API</b> e <b>Web Playback SDK</b>, aceite os termos e salve.</li><li>Abra o app criado, copie o <b>Client ID</b> e cole abaixo.</li></ol><form id="sp-client-form" class="explore-form"><input id="sp-client-input" placeholder="Cole aqui o Client ID" autocomplete="off" required pattern="[A-Za-z0-9]{16,64}"><button class="primary-btn" type="submit">Salvar</button></form><p class="info-note">O Client ID não é senha e fica salvo só neste navegador. Nunca cole aqui o Client Secret. Tocar músicas exige Spotify Premium e funciona no navegador do computador (Chrome, Edge ou Firefox).</p></div>`;
    return `<div class="setup-card"><h3>Entre com a sua conta do Spotify</h3><p>Você será levado à página oficial do Spotify para autorizar o Music Core e depois voltará para cá. Sua senha nunca passa por este app.</p><div class="hero-actions"><button class="primary-btn" data-action="sp-login" type="button">Entrar com Spotify</button>${store.get('mc-spotify-client-id')?'<button class="outline-btn" data-action="sp-reset" type="button">Trocar Client ID</button>':''}</div></div>`;
  }
  function exploreView(){
    const ex=state.explore, spSetup=ex.source==='spotify'&&!spLogged();
    const tabs=Object.entries(SOURCES).map(([k,label])=>`<button class="chip ${ex.source===k?'on':''}" data-action="explore-source" data-id="${k}" type="button">${label}</button>`).join('')+(ex.source==='spotify'&&!spSetup?`<button class="chip" data-action="sp-logout" type="button">Sair do Spotify</button>`:'');
    const form=`<form class="explore-form" id="explore-form"><input id="explore-input" type="search" value="${esc(ex.query)}" placeholder="${ex.source==='archive'?'Artista, álbum, show, gênero...':'Artista, música, gênero...'}" autocomplete="off"><button class="primary-btn" type="submit">Buscar</button></form>`;
    const label=ex.album?esc(ex.album.title):ex.query.trim()?`Resultados para “${esc(ex.query.trim())}”`:{audius:'Em alta no Audius',archive:'Mais ouvidos no Internet Archive (shows ao vivo)',spotify:'Sua biblioteca do Spotify'}[ex.source];
    const none='<div class="empty"><div class="empty-icon">♫</div><h3>Nada encontrado</h3><p>Tente outra busca.</p></div>';
    let body;
    if(spSetup)body=spotifySetupView();
    else if(ex.loading)body='<div class="empty"><div class="empty-icon">⌕</div><p>Buscando...</p></div>';
    else if(ex.error)body=`<div class="empty"><div class="empty-icon">!</div><h3>Não foi possível buscar</h3><p>${esc(ex.error)}</p></div>`;
    else if(!ex.album&&ex.items.length)body=itemList(ex.items);
    else body=(ex.album?`<div class="sub-actions"><button class="outline-btn" data-action="explore-back" type="button">← Voltar aos resultados</button></div>`:'')+(ex.tracks.length?trackTable(exploreTracks(),{remote:true}):none);
    return heading('Explorar','Músicas completas de plataformas abertas e da sua conta do Spotify. Toque direto ou salve na sua biblioteca.')+`<div class="explore-tabs">${tabs}</div>${spSetup?body:`${form}<div class="section-heading"><h2>${label}</h2></div>${body}`}<p class="info-note">Fontes: Audius (artistas independentes que publicam para streaming livre), Internet Archive (domínio público, Creative Commons e gravações autorizadas) e Spotify (com a sua própria conta Premium, pelo player oficial). As faixas tocam via internet direto da plataforma de origem.</p>`;
  }
  /* Spotify: conta do próprio usuário via Web API + Web Playback SDK oficiais (login PKCE, sem segredo no app). */
  const SP_SCOPES='streaming user-read-email user-read-private user-library-read playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state';
  const store={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch{}}};
  const sp={player:null,ready:null,state:null,stamp:0,refreshing:null};
  const spRedirect=()=>location.origin+location.pathname.replace(/index.html$/,'');
  /* Client ID público do app no Spotify Developer Dashboard (não é segredo). Vazio = cada pessoa cola o próprio. */
  const SPOTIFY_CLIENT_ID='';
  const spClientId=()=>store.get('mc-spotify-client-id')||SPOTIFY_CLIENT_ID;
  function spTokens(){try{return JSON.parse(store.get('mc-spotify-token')||'null');}catch{return null;}}
  const spLogged=()=>Boolean(spClientId()&&spTokens()?.refresh);
  const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  async function spLogin(){
    const verifier=b64url(crypto.getRandomValues(new Uint8Array(48))), st=b64url(crypto.getRandomValues(new Uint8Array(12)));
    const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    store.set('mc-spotify-pkce',JSON.stringify({verifier,state:st}));
    location.href='https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:spClientId(),response_type:'code',redirect_uri:spRedirect(),code_challenge_method:'S256',code_challenge:challenge,scope:SP_SCOPES,state:st});
  }
  async function spTokenRequest(body){
    const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:spClientId(),...body})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error_description||data.error||`HTTP ${r.status}`);
    const tok={access:data.access_token,refresh:data.refresh_token||spTokens()?.refresh,expiresAt:Date.now()+((data.expires_in||3600)-60)*1000};
    store.set('mc-spotify-token',JSON.stringify(tok));return tok;
  }
  async function spHandleRedirect(){
    const params=new URLSearchParams(location.search);
    if(!params.has('code')&&!params.has('error'))return false;
    let saved=null;try{saved=JSON.parse(store.get('mc-spotify-pkce')||'null');}catch{}
    store.set('mc-spotify-pkce',null);history.replaceState(null,'',spRedirect());
    if(params.get('error'))notice('Login no Spotify cancelado.');
    else if(!saved||saved.state!==params.get('state'))notice('Login no Spotify inválido. Tente novamente.');
    else try{await spTokenRequest({grant_type:'authorization_code',code:params.get('code'),redirect_uri:spRedirect(),code_verifier:saved.verifier});notice('Conta do Spotify conectada.');}
    catch(err){notice(`Falha no login do Spotify: ${err.message}`);}
    return true;
  }
  async function spToken(){
    const t=spTokens();if(!t?.refresh)throw Error('entre novamente na sua conta.');
    if(t.access&&Date.now()<t.expiresAt)return t.access;
    sp.refreshing??=spTokenRequest({grant_type:'refresh_token',refresh_token:t.refresh}).catch(err=>{spLogout();throw Error(`sessão expirada (${err.message}), entre novamente.`);}).finally(()=>{sp.refreshing=null;});
    return (await sp.refreshing).access;
  }
  function spLogout(){store.set('mc-spotify-token',null);sp.player?.disconnect();sp.player=null;sp.ready=null;sp.state=null;if(state.engine==='spotify')state.engine='audio';}
  async function spApi(path,opts={}){
    const r=await fetch(`https://api.spotify.com/v1${path}`,{...opts,headers:{Authorization:`Bearer ${await spToken()}`,...(opts.body?{'Content-Type':'application/json'}:{})}});
    if(r.status===204||r.status===202)return null;
    const data=await r.json().catch(()=>null);
    if(!r.ok){
      const msg=data?.error?.message||`HTTP ${r.status}`, blocked=r.status===403&&/regist|allowlist|not.*(allowed|enabled)/i.test(msg);
      const e=Error(blocked?'sua conta do Spotify ainda não foi liberada neste app. Peça ao administrador para adicionar o seu e-mail do Spotify.':msg);e.status=r.status;e.blocked=blocked;throw e;
    }
    return data;
  }
  const spTrack=t=>remember({id:t.uri,source:'spotify',title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),album:t.album?.name||'',durationMs:t.duration_ms||0,coverUrl:(t.album?.images||[]).find(i=>i.width&&i.width<=320)?.url||t.album?.images?.[0]?.url||null,liked:false,spotifyUri:t.uri,sourceInfo:{pageUrl:t.external_urls?.spotify||null}});
  async function searchSpotify(q){
    const page=offset=>spApi(`/search?${new URLSearchParams({q,type:'track',limit:'10',offset:String(offset)})}`);
    const pages=[await page(0),...await Promise.all([10,20].map(o=>page(o).catch(()=>null)))];
    const seen=new Set();
    return pages.flatMap(p=>p?.tracks?.items||[]).filter(t=>t?.uri&&!seen.has(t.uri)&&seen.add(t.uri)).map(spTrack);
  }
  async function spotifyLibrary(){
    const data=await spApi('/me/playlists?limit=50');
    return [{id:'liked',title:'Músicas curtidas',artist:'Sua biblioteca do Spotify',info:'',coverUrl:null},...(data?.items||[]).filter(Boolean).map(p=>{const n=p.items?.total??p.tracks?.total;return {id:p.id,title:p.name,artist:p.owner?.display_name||'',info:n!=null?`${n} músicas`:'',coverUrl:p.images?.[0]?.url||null};})];
  }
  async function spotifyListTracks(id){
    let d;
    if(id==='liked')d=await spApi('/me/tracks?limit=50');
    else try{d=await spApi(`/playlists/${encodeURIComponent(id)}/items?limit=100`);}catch(e){if(e.status!==404)throw e;d=await spApi(`/playlists/${encodeURIComponent(id)}/tracks?limit=100`);}
    return (d?.items||[]).map(i=>i.item||i.track).filter(t=>t?.uri?.startsWith('spotify:track:')&&!t.is_local);
  }
  function spLoadPlayer(){
    sp.ready??=new Promise((resolve,reject)=>{
      const fail=msg=>{notice(msg);sp.player?.disconnect();sp.player=null;sp.ready=null;reject(Error(msg));};
      const setup=()=>{
        const player=new window.Spotify.Player({name:'Music Core',getOAuthToken:cb=>spToken().then(cb).catch(err=>notice(`Spotify: ${err.message}`)),volume:audio.volume});
        player.addListener('ready',({device_id})=>resolve(device_id));
        player.addListener('initialization_error',()=>fail('Este navegador não suporta o player do Spotify. Use Chrome, Edge ou Firefox no computador.'));
        player.addListener('authentication_error',()=>fail('Sessão do Spotify expirada. Entre novamente na aba Explorar → Spotify.'));
        player.addListener('account_error',()=>fail('Tocar músicas do Spotify aqui exige conta Premium.'));
        player.addListener('player_state_changed',spOnState);
        sp.player=player;player.connect();
      };
      if(window.Spotify?.Player)setup();
      else{window.onSpotifyWebPlaybackSDKReady=setup;const s=document.createElement('script');s.src='https://sdk.scdn.co/spotify-player.js';s.onerror=()=>fail('Não foi possível carregar o player do Spotify.');document.head.append(s);}
    });
    return sp.ready;
  }
  async function spPlay(uri){
    const device=await spLoadPlayer(), body=JSON.stringify({uris:[uri]});
    try{await spApi(`/me/player/play?device_id=${device}`,{method:'PUT',body});}
    catch(e){if(e.status!==404)throw e;await new Promise(r=>setTimeout(r,1500));await spApi(`/me/player/play?device_id=${device}`,{method:'PUT',body});}
  }
  function spOnState(s){
    const prev=sp.state, wasPlaying=prev&&!prev.paused;
    sp.state=s;sp.stamp=Date.now();
    if(state.engine!=='spotify')return;
    syncPlayIcons();
    if(s&&wasPlaying&&s.paused&&s.position===0){if(state.repeat==='one')spPlay(lookup(state.current)?.spotifyUri).catch(()=>{});else playNext(1);}
  }
  function status(){
    if(state.engine==='spotify'){const s=sp.state;if(!s)return {paused:true,pos:0,dur:NaN};return {paused:s.paused,pos:Math.min(s.position+(s.paused?0:Date.now()-sp.stamp),s.duration)/1000,dur:s.duration/1000};}
    return {paused:audio.paused,pos:audio.currentTime,dur:audio.duration};
  }
  const isPaused=()=>status().paused;
  async function togglePlayback(){
    if(state.engine==='spotify'){await sp.player?.togglePlay();return;}
    if(audio.paused){try{await audio.play();}catch{notice('Não foi possível iniciar o áudio.');}}else audio.pause();
  }
  function pausePlayback(){if(state.engine==='spotify')sp.player?.pause();else audio.pause();}
  function seekTo(sec){if(state.engine==='spotify')sp.player?.seek(Math.round(sec*1000));else audio.currentTime=sec;}
  function syncPlayIcons(){renderPlayer();const icon=isPaused()?'▶':'Ⅱ';$$('.track-row').forEach(row=>{if(row.dataset.track===state.current){const b=$('[data-action=play]',row);if(b)b.textContent=icon;}});}
  function playlistItems(){const p=state.playlists.find(p=>p.id===state.selectedPlaylist);return p ? p.trackIds.map(lookup).filter(Boolean) : [];}
  function render() {
    $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));
    $('#playlist-nav').innerHTML=state.playlists.map(p=>`<button class="playlist-item ${state.view==='playlist'&&state.selectedPlaylist===p.id?'active':''}" data-playlist="${esc(p.id)}" type="button"><span>▤</span><span>${esc(p.name)}</span></button>`).join('');
    const count=state.tracks.length, favorites=state.tracks.filter(t=>t.liked).length;
    let html='';
    if(state.view==='home'){
      html=`<section class="hero"><div><div class="eyebrow">SEU ESPAÇO DE MÚSICA</div><h1>A música começa<br>no seu espaço.</h1><p>Ouça Spotify, Audius e Internet Archive num só lugar. Organize favoritos e playlists — tudo fica só no seu navegador.</p>${buttons()}</div></section><div class="stats"><div class="stat"><strong>${count}</strong><span>músicas salvas</span></div><div class="stat"><strong>${state.playlists.length}</strong><span>playlists</span></div><div class="stat"><strong>${favorites}</strong><span>favoritas</span></div></div><div class="section-heading"><h2>Adicionadas recentemente</h2><span class="muted micro">${count} salvas</span></div>${trackTable(filter(state.tracks.slice(0,60)))}`;
    } else if(state.view==='library'){
      html=heading('Sua biblioteca',`${count} músicas salvas`)+`<div class="sub-actions">${buttons()}</div>${trackTable(filter(state.tracks))}`;
    } else if(state.view==='liked'){
      const t=filter(state.tracks.filter(t=>t.liked));html=heading('Músicas favoritas',`${favorites} faixas marcadas`)+trackTable(t,{emptyText:'Use o coração ♡ para salvar suas favoritas.'});
    } else if(state.view==='playlist'){
      const p=state.playlists.find(p=>p.id===state.selectedPlaylist);
      html=p?`<div class="playlist-top"><div class="playlist-art">♫</div><div><div class="eyebrow">SUA PLAYLIST</div><h1>${esc(p.name)}</h1><p>${p.trackIds.length} músicas · edição local</p></div></div><div class="sub-actions"><button class="outline-btn" data-action="delete-playlist" data-id="${esc(p.id)}">Excluir playlist</button><button class="outline-btn" data-nav="explore" type="button">Buscar músicas</button></div>${trackTable(filter(playlistItems()),{emptyText:'Adicione músicas usando o botão ＋ ao lado de uma faixa.'})}`:empty('Playlist não encontrada','Selecione outra playlist.');
    } else if(state.view==='explore'){
      html=exploreView();
    } else if(state.view==='queue'){
      const list=state.queue.slice(Math.max(0,state.index)).map(lookup).filter(Boolean);
      html=heading('Fila de reprodução',`${list.length} faixas na fila atual`)+`<div class="sub-actions"><button class="outline-btn" data-action="clear-queue">Limpar fila</button></div>${trackTable(filter(list),{emptyText:'Reproduza uma faixa para criar sua fila.'})}`;
    }
    $('#view').innerHTML=html;
    renderPlayer();
  }
  function renderPlayer() {
    const t=lookup(state.current);
    $('#now-title').textContent=t?.title||'Escolha uma música';
    $('#now-artist').textContent=t?.artist||'Sua sessão começa aqui';
    $('#player-title').textContent=t?.title||'Nada tocando';
    $('#player-artist').textContent=t?.artist||(state.tracks.length?'Selecione uma faixa':'Busque músicas em Explorar para começar');
    $('#now-cover').innerHTML=t?cover(t,'now-cover-inner'):'<span>♫</span>';
    $('#mini-cover').innerHTML=t?'♫':'♫';
    $('#like-current').textContent=t?.liked?'♥':'♡';
    $('#like-current').classList.toggle('on',!!t?.liked);
    const st=status();
    $('#play-btn').textContent=st.paused?'▶':'Ⅱ';
    $('#shuffle-btn').classList.toggle('on',state.shuffled);
    $('#repeat-btn').classList.toggle('on',state.repeat!=='off');
    $('#repeat-btn').title=`Repetição: ${state.repeat}`;
    $('#duration').textContent=fmt(Number.isFinite(st.dur)?st.dur*1000:t?.durationMs);
    $('#current-time').textContent=fmt(st.pos*1000);
    $('#seek').value=Number.isFinite(st.dur)&&st.dur>0?Math.floor(st.pos/st.dur*1000):0;
    $('#mini-queue').innerHTML=state.queue.slice(state.index+1,state.index+5).map(lookup).filter(Boolean).map(item=>`<div class="queue-mini-row">${cover(item)}<div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div></div>`).join('')||'<small class="muted">Sem próximas faixas</small>';
  }
  async function play(id, fromList=null) {
    const t=lookup(id); if(!t)return;
    if(!canPlay(t)){notice('Esta faixa não tem áudio disponível.');return;}
    if(t.spotifyUri&&!spLogged()){notice('Para tocar músicas do Spotify, entre na sua conta em Explorar → Spotify.');return;}
    sp.player?.activateElement?.();
    if(state.current===id){await togglePlayback();render();return;}
    if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null;}
    if(fromList){state.queue=[...new Set(fromList.map(t=>typeof t==='string'?t:t.id))];state.index=state.queue.indexOf(id);}
    else if(state.queue.includes(id)) state.index=state.queue.indexOf(id);
    else {state.queue=[id,...state.tracks.filter(canPlay).map(x=>x.id).filter(x=>x!==id)];state.index=0;}
    state.current=id;
    if(t.spotifyUri){
      audio.pause();state.engine='spotify';sp.state=null;render();
      try{await spPlay(t.spotifyUri);}catch(err){if(err.status===403&&!err.blocked)notice('Tocar músicas do Spotify aqui exige conta Premium.');else if(err.status)notice(`Spotify: ${err.message}`);}
    } else {
      if(state.engine==='spotify'){sp.player?.pause();state.engine='audio';}
      if(t.audioBlob){state.objectUrl=URL.createObjectURL(t.audioBlob);audio.src=state.objectUrl;}else audio.src=t.streamUrl||t.demoUrl;
      audio.load();
      try {await audio.play();} catch(err){notice('A reprodução falhou. Confira o formato do arquivo.');}
    }
    if('mediaSession' in navigator){
      navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist||'',album:t.album||'',artwork:t.coverUrl?[{src:t.coverUrl}]:[]});
    }
    render();
  }
  function playNext(direction=1) {
    if(!state.queue.length)return;
    let next=state.index;
    for(let tries=0;tries<state.queue.length;tries++){
      if(state.shuffled && direction>0){
        const playable=state.queue.map((id,i)=>({id,i})).filter(x=>x.i!==state.index&&canPlay(lookup(x.id)));
        if(!playable.length){pausePlayback();renderPlayer();return;}
        next=playable[Math.floor(Math.random()*playable.length)].i;
      } else {
        next+=direction;
        if(next>=state.queue.length){if(state.repeat==='all')next=0;else{pausePlayback();renderPlayer();return;}}
        if(next<0){if(state.repeat==='all')next=state.queue.length-1;else next=0;}
      }
      const t=lookup(state.queue[next]);
      if(t && canPlay(t)){
        state.index=next;state.current=null;
        play(t.id).catch(()=>notice('Falha ao avançar música.'));
        return;
      }
    }
    pausePlayback();notice('Não há mais músicas reproduzíveis na fila.');
  }
  function openAdd(id){
    const t=lookup(id);if(!t)return;
    $('#add-track-caption').textContent=`${t.title} · ${t.artist}`;
    const box=$('#add-playlist-options');
    box.innerHTML=state.playlists.length ? state.playlists.map(p=>`<button type="button" data-add-to="${esc(p.id)}" data-track-id="${esc(id)}">${esc(p.name)} ${p.trackIds.includes(id)?'✓':''}</button>`).join(''):'<p>Crie uma playlist primeiro.</p>';
    $('#add-dialog').showModal();
  }
  async function toggleLiked(id){const t=lookup(id);if(!t)return;t.liked=!t.liked;await saveTrack(t);}
  async function createPlaylist(name){ const p={id:guid(),name,trackIds:[],createdAt:Date.now()};await savePlaylist(p);state.view='playlist';state.selectedPlaylist=p.id;render(); }
  async function removePlaylist(id){if(!confirm('Excluir esta playlist? As músicas permanecerão na biblioteca.'))return;await transact('playlists','readwrite',s=>s.delete(id));state.view='library';state.selectedPlaylist=null;await refresh();}
  function currentList(){if(state.view==='explore')return exploreTracks(); if(state.view==='liked')return filter(state.tracks.filter(t=>t.liked)); if(state.view==='playlist')return filter(playlistItems()); if(state.view==='queue')return state.queue.map(lookup).filter(Boolean);return filter(state.tracks);}
  function setupUI(){
    $('#new-playlist').onclick=()=>{$('#playlist-name').value='';$('#playlist-dialog').showModal();};
    $('#cancel-playlist').onclick=()=>$('#playlist-dialog').close();
    $('#cancel-add').onclick=()=>$('#add-dialog').close();
    $('#playlist-form').onsubmit=async e=>{e.preventDefault();const name=$('#playlist-name').value.trim();if(!name)return;await createPlaylist(name);$('#playlist-dialog').close();};
    document.addEventListener('click',async e=>{
      const nav=e.target.closest('[data-nav]');if(nav){state.view=nav.dataset.nav;render();if(state.view==='explore'&&!state.explore.loaded)runExplore();return;}
      const pnav=e.target.closest('[data-playlist]');if(pnav){state.view='playlist';state.selectedPlaylist=pnav.dataset.playlist;render();return;}
      const addTo=e.target.closest('[data-add-to]');if(addTo){const id=addTo.dataset.trackId;await ensureSaved(id);const p=state.playlists.find(p=>p.id===addTo.dataset.addTo);if(p){ if(!p.trackIds.includes(id))p.trackIds.push(id);await savePlaylist(p);notice('Música adicionada à playlist.');$('#add-dialog').close();}return;}
      const btn=e.target.closest('[data-action]');if(!btn)return;
      const {action,id}=btn.dataset;
      if(action==='like')await toggleLiked(id);
      else if(action==='add')openAdd(id);
      else if(action==='play'){
        const t=lookup(id);if(t){const list=currentList();await play(id,list.map(x=>x.id));}
      } else if(action==='delete-playlist') await removePlaylist(id);
      else if(action==='save'){if(!isSaved(id)){await ensureSaved(id);notice('Música salva na biblioteca. Ela toca pela internet, direto da plataforma de origem.');}}
      else if(action==='explore-source'){if(state.explore.source!==id){state.explore.source=id;await runExplore();}}
      else if(action==='explore-open')await openItem(id);
      else if(action==='sp-login')await spLogin();
      else if(action==='sp-logout'){pausePlayback();spLogout();await runExplore();}
      else if(action==='sp-reset'){store.set('mc-spotify-client-id',null);spLogout();render();}
      else if(action==='explore-back'){state.explore.album=null;state.explore.tracks=[];render();}
      else if(action==='clear-queue'){state.queue=[];state.index=-1;pausePlayback();state.current=null;audio.removeAttribute('src');render();}
    });
    $('#search-input').oninput=e=>{state.query=e.target.value;render();};
    document.addEventListener('submit',e=>{
      if(e.target.id==='explore-form'){e.preventDefault();state.explore.query=$('#explore-input').value;runExplore();}
      else if(e.target.id==='sp-client-form'){e.preventDefault();store.set('mc-spotify-client-id',$('#sp-client-input').value.trim());render();}
    });
    setInterval(()=>{if(state.engine==='spotify'&&sp.state&&!sp.state.paused)renderPlayer();},500);
    $('#play-btn').onclick=()=>{if(state.current){sp.player?.activateElement?.();togglePlayback();}else{const t=state.tracks.find(canPlay);if(t)play(t.id,[t.id,...state.tracks.filter(canPlay).map(x=>x.id).filter(x=>x!==t.id)]);else notice('Importe uma música para começar.');}};
    $('#prev-btn').onclick=()=>{if(status().pos>3)seekTo(0);else playNext(-1);};
    $('#next-btn').onclick=()=>playNext(1);
    $('#shuffle-btn').onclick=()=>{state.shuffled=!state.shuffled;renderPlayer();};
    $('#repeat-btn').onclick=()=>{state.repeat=state.repeat==='off'?'all':state.repeat==='all'?'one':'off';renderPlayer();};
    $('#queue-toggle').onclick=$('#open-queue').onclick=()=>{state.view='queue';render();};
    $('#like-current').onclick=()=>{if(state.current)toggleLiked(state.current);};
    $('#seek').oninput=e=>{const {dur}=status();if(Number.isFinite(dur)&&dur>0)seekTo(dur*(Number(e.target.value)/1000));};
    $('#volume').oninput=e=>{audio.volume=Number(e.target.value)/100;sp.player?.setVolume(audio.volume);};
    audio.addEventListener('timeupdate',renderPlayer);
    audio.addEventListener('durationchange',async()=>{const t=state.tracks.find(x=>x.id===state.current);if(t && canPlay(t)&&Number.isFinite(audio.duration)&&Math.abs((t.durationMs||0)-audio.duration*1000)>1200){t.durationMs=Math.round(audio.duration*1000);await transact('tracks','readwrite',s=>s.put(t));}});
    audio.addEventListener('play',syncPlayIcons);
    audio.addEventListener('pause',syncPlayIcons);
    audio.addEventListener('ended',()=>{if(state.repeat==='one'){audio.currentTime=0;audio.play().catch(()=>{});}else playNext(1);});
    audio.addEventListener('error',()=>notice('Falha ao carregar áudio. O formato pode não ser suportado.'));
    if('mediaSession' in navigator){
      for(const [act,fn] of Object.entries({'play':()=>{if(isPaused())togglePlayback();},'pause':()=>pausePlayback(),'nexttrack':()=>playNext(1),'previoustrack':()=>playNext(-1),'seekto':d=>{if(Number.isFinite(d.seekTime))seekTo(d.seekTime);}}))try{navigator.mediaSession.setActionHandler(act,fn);}catch{}
    }
    document.addEventListener('keydown',e=>{const active=document.activeElement;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-input').focus();}else if(e.code==='Space'&&!e.repeat&&!['INPUT','TEXTAREA','BUTTON'].includes(active?.tagName)&&!active?.isContentEditable){e.preventDefault();$('#play-btn').click();}});
  }
  async function init(){
    setupUI();
    try {await initDB();} catch(err){console.error(err);notice('Erro no armazenamento do navegador. Verifique se o modo privado está desativado.');return;}
    if(await spHandleRedirect()){state.view='explore';state.explore.source='spotify';runExplore();}
    if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  init();
})();
