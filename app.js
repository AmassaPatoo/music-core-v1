/* Music Core — player independente de arquivos locais/autorizados.
   Importações JSON usam apenas metadados e NÃO acessam streams do Spotify. */
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
  const state = {db:null, tracks:[], playlists:[], view:'home', selectedPlaylist:null, query:'', queue:[], index:-1, current:null, shuffled:false, repeat:'off', objectUrl:null, toastTimer:null};
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
    const existing = await transact('tracks','readonly', s=>s.count());
    if(existing===0){
      try {
        const response=await fetch('./assets/demo-original.wav');
        if(response.ok){
          const blob=await response.blob();
          await transact('tracks','readwrite',s=>s.put({id:'demo-original',source:'local',title:'Teste de áudio — composição original',artist:'Music Core',album:'Demonstração',durationMs:7000,coverUrl:null,liked:false,audioBlob:blob,fileName:'demo-original.wav',fileSize:blob.size,fileLastModified:0,addedAt:Date.now()}));
        }
      } catch {/* Apps abertas sem servidor podem importar arquivos normalmente. */}
    }
    await refresh();
  }
  async function refresh() {
    state.tracks = await transact('tracks','readonly', s=>s.getAll());
    state.playlists = await transact('playlists','readonly', s=>s.getAll());
    state.tracks.sort((a,b)=> (b.addedAt||0)-(a.addedAt||0));
    state.playlists.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    render();
  }
  async function saveTrack(t){await transact('tracks','readwrite',s=>s.put(t));await refresh();}
  async function savePlaylist(p){await transact('playlists','readwrite',s=>s.put(p));await refresh();}
  function lookup(id){return state.tracks.find(t=>t.id === id);}
  function notice(msg){ const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>t.classList.remove('show'),4500); }
  function canPlay(t){return Boolean(t?.audioBlob instanceof Blob || t?.demoUrl);}
  function cover(t, cls='track-cover') {
    const src=t?.coverUrl;
    if(src && /^https:\/\//.test(src)) return `<div class="${cls}" style="background:#332a50;overflow:hidden"><img src="${esc(src)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`;
    const hue = (t?.title || '♪').split('').reduce((sum,c)=>sum+c.charCodeAt(0),0)%360;
    return `<div class="${cls}" style="background:linear-gradient(140deg,hsl(${hue} 40% 42%),hsl(${(hue+65)%360} 35% 28%))">♫</div>`;
  }
  function heading(text,subtitle=''){return `<h1 class="page-title">${esc(text)}</h1>${subtitle?`<p class="muted micro">${esc(subtitle)}</p>`:''}`;}
  function buttons(){return `<div class="hero-actions"><button class="primary-btn" data-action="import-audio" type="button">＋ Importar áudio</button><button class="outline-btn" data-action="import-json" type="button">Importar metadados JSON</button></div>`;}
  function empty(title,msg){return `<div class="empty"><div class="empty-icon">♫</div><h3>${esc(title)}</h3><p>${esc(msg)}</p>${buttons()}</div>`;}
  function trackTable(tracks, options={}) {
    if(!tracks.length) return empty(options.emptyTitle||'Nenhuma música encontrada',options.emptyText||'Importe arquivos de áudio autorizados ou um JSON de metadados.');
    return `<div class="track-list"><div class="track-table-head"><span>#</span><span>MÚSICA</span><span class="album-col">ÁLBUM</span><span class="duration-col">DURAÇÃO</span><span></span></div>${tracks.map((t,i)=>`<div class="track-row ${t.id===state.current?'active':''}" data-track="${esc(t.id)}"><span class="idx">${i+1}</span><div class="track-main">${cover(t)}<div class="track-meta"><span class="track-title" title="${esc(t.title)}">${esc(t.title)}</span><span class="track-artist" title="${esc(t.artist)}">${esc(t.artist||'Artista desconhecido')}${canPlay(t)?'':' · Apenas catálogo'}</span></div></div><span class="track-size album-col" title="${esc(t.album||'')}">${esc(t.album||'—')}</span><span class="duration-col muted micro">${fmt(t.durationMs)}</span><div class="table-actions"><button class="table-btn ${t.liked?'on':''}" data-action="like" data-id="${esc(t.id)}" title="Favoritar">${t.liked?'♥':'♡'}</button><button class="table-btn more-btn" data-action="add" data-id="${esc(t.id)}" title="Adicionar à playlist">＋</button><button class="play-row" data-action="play" data-id="${esc(t.id)}" title="Reproduzir">${t.id===state.current && !audio.paused?'Ⅱ':'▶'}</button></div></div>`).join('')}</div>`;
  }
  function filter(arr) {if(!state.query.trim()) return arr;const q=norm(state.query);return arr.filter(t=>norm(`${t.title} ${t.artist} ${t.album}`).includes(q));}
  function playlistItems(){const p=state.playlists.find(p=>p.id===state.selectedPlaylist);return p ? p.trackIds.map(lookup).filter(Boolean) : [];}
  function render() {
    $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));
    $('#playlist-nav').innerHTML=state.playlists.map(p=>`<button class="playlist-item ${state.view==='playlist'&&state.selectedPlaylist===p.id?'active':''}" data-playlist="${esc(p.id)}" type="button"><span>▤</span><span>${esc(p.name)}</span></button>`).join('');
    const count=state.tracks.length, playable=state.tracks.filter(canPlay).length, favorites=state.tracks.filter(t=>t.liked).length;
    let html='';
    if(state.view==='home'){
      html=`<section class="hero"><div><div class="eyebrow">SUA BIBLIOTECA INDEPENDENTE</div><h1>A música começa<br>no seu espaço.</h1><p>Organize faixas, favoritos e playlists. Reproduza seus arquivos locais e visualize metadados importados.</p>${buttons()}</div></section><div class="stats"><div class="stat"><strong>${count}</strong><span>faixas cadastradas</span></div><div class="stat"><strong>${playable}</strong><span>arquivos reproduzíveis</span></div><div class="stat"><strong>${favorites}</strong><span>favoritas</span></div></div><div class="section-heading"><h2>Adicionadas recentemente</h2><span class="muted micro">${count} cadastradas</span></div>${trackTable(filter(state.tracks.slice(0,60)))}`;
    } else if(state.view==='library'){
      html=heading('Sua biblioteca',`${count} faixas, ${playable} com áudio local`)+`<div class="sub-actions">${buttons()}</div>${trackTable(filter(state.tracks))}`;
    } else if(state.view==='liked'){
      const t=filter(state.tracks.filter(t=>t.liked));html=heading('Músicas favoritas',`${favorites} faixas marcadas`)+trackTable(t,{emptyText:'Use o coração ♡ para salvar suas favoritas.'});
    } else if(state.view==='playlist'){
      const p=state.playlists.find(p=>p.id===state.selectedPlaylist);
      html=p?`<div class="playlist-top"><div class="playlist-art">♫</div><div><div class="eyebrow">SUA PLAYLIST</div><h1>${esc(p.name)}</h1><p>${p.trackIds.length} músicas · edição local</p></div></div><div class="sub-actions"><button class="outline-btn" data-action="delete-playlist" data-id="${esc(p.id)}">Excluir playlist</button><button class="outline-btn" data-action="import-audio">Adicionar músicas à biblioteca</button></div>${trackTable(filter(playlistItems()),{emptyText:'Adicione músicas usando o botão ＋ ao lado de uma faixa.'})}`:empty('Playlist não encontrada','Selecione outra playlist.');
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
    $('#player-artist').textContent=t?.artist||(state.tracks.length?'Selecione uma faixa':'Importe suas músicas para começar');
    $('#now-cover').innerHTML=t?cover(t,'now-cover-inner'):'<span>♫</span>';
    $('#mini-cover').innerHTML=t?'♫':'♫';
    $('#like-current').textContent=t?.liked?'♥':'♡';
    $('#like-current').classList.toggle('on',!!t?.liked);
    $('#play-btn').textContent=audio.paused?'▶':'Ⅱ';
    $('#shuffle-btn').classList.toggle('on',state.shuffled);
    $('#repeat-btn').classList.toggle('on',state.repeat!=='off');
    $('#repeat-btn').title=`Repetição: ${state.repeat}`;
    $('#duration').textContent=fmt(Number.isFinite(audio.duration)?audio.duration*1000:t?.durationMs);
    $('#current-time').textContent=fmt(audio.currentTime*1000);
    $('#seek').value=Number.isFinite(audio.duration)&&audio.duration>0?Math.floor(audio.currentTime/audio.duration*1000):0;
    $('#mini-queue').innerHTML=state.queue.slice(state.index+1,state.index+5).map(lookup).filter(Boolean).map(item=>`<div class="queue-mini-row">${cover(item)}<div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div></div>`).join('')||'<small class="muted">Sem próximas faixas</small>';
  }
  async function play(id, fromList=null) {
    const t=lookup(id); if(!t)return;
    if(!canPlay(t)){notice('Esta faixa contém apenas metadados. Para ouvir, importe um arquivo de áudio autorizado.');return;}
    if(state.current===id){ if(audio.paused){try{await audio.play();}catch{notice('Não foi possível iniciar o áudio.');}}else audio.pause();render();return; }
    if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null;}
    if(fromList){state.queue=[...new Set(fromList.map(t=>typeof t==='string'?t:t.id))];state.index=state.queue.indexOf(id);}
    else if(state.queue.includes(id)) state.index=state.queue.indexOf(id);
    else {state.queue=[id,...state.tracks.filter(canPlay).map(x=>x.id).filter(x=>x!==id)];state.index=0;}
    state.current=id;
    if(t.audioBlob){state.objectUrl=URL.createObjectURL(t.audioBlob);audio.src=state.objectUrl;}else audio.src=t.demoUrl;
    audio.load();
    try {await audio.play();} catch(err){notice('A reprodução falhou. Confira o formato do arquivo.');}
    if('mediaSession' in navigator){
      navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist||'',album:t.album||''});
    }
    render();
  }
  function playNext(direction=1) {
    if(!state.queue.length)return;
    let next=state.index;
    for(let tries=0;tries<state.queue.length;tries++){
      if(state.shuffled && direction>0){
        const playable=state.queue.map((id,i)=>({id,i})).filter(x=>x.i!==state.index&&canPlay(lookup(x.id)));
        if(!playable.length){audio.pause();renderPlayer();return;}
        next=playable[Math.floor(Math.random()*playable.length)].i;
      } else {
        next+=direction;
        if(next>=state.queue.length){if(state.repeat==='all')next=0;else{audio.pause();audio.currentTime=0;renderPlayer();return;}}
        if(next<0){if(state.repeat==='all')next=state.queue.length-1;else next=0;}
      }
      const t=lookup(state.queue[next]);
      if(t && canPlay(t)){
        state.index=next;state.current=null;
        play(t.id).catch(()=>notice('Falha ao avançar música.'));
        return;
      }
    }
    audio.pause();notice('Não há mais arquivos de áudio reproduzíveis na fila.');
  }
  async function importFiles(files){
    const candidates=[...files].filter(f=>f.type.startsWith('audio/')||/\.(mp3|m4a|ogg|wav|flac|aac|opus)$/i.test(f.name));
    if(!candidates.length){notice('Selecione arquivos de áudio.');return;}
    let imported=0;
    for(const file of candidates){
      const existing=state.tracks.find(t=>t.source==='local'&&t.fileName===file.name&&t.fileSize===file.size&&t.fileLastModified===file.lastModified);
      if(existing) continue;
      const label=file.name.replace(/\.[^.]+$/,'');
      const parts=label.split(/\s+-\s+/);
      const artist=parts.length>1?parts.shift():'Arquivo local';
      const title=parts.length?parts.join(' - '):label;
      await transact('tracks','readwrite',s=>s.put({id:guid(),source:'local',title,artist,album:'Arquivos locais',durationMs:0,coverUrl:null,liked:false,audioBlob:file,fileName:file.name,fileSize:file.size,fileLastModified:file.lastModified,addedAt:Date.now()}));
      imported++;
    }
    await refresh(); notice(`${imported} arquivo(s) de áudio importado(s)${candidates.length-imported?' (duplicados ignorados)':''}.`);
  }
  function normalizePlaylist(json){
    const p=json?.data?.playlistV2;
    if(!p?.content || !Array.isArray(p.content.items)) throw Error('Não encontrei data.playlistV2.content.items.');
    const snapshot={name:String(p.name||'Playlist importada'),total:Number(p.content.totalCount||0),offset:Number(p.content.pagingInfo?.offset||0),limit:Number(p.content.pagingInfo?.limit||p.content.items.length),revision:p.revisionId||null};
    snapshot.items=p.content.items.map((item,index)=>{
      const t=item?.itemV2?.data; if(!t?.uri || !t?.name)return null;
      const image=t.albumOfTrack?.coverArt?.sources||[];
      const best=image.find(c=>c.height===300)||image.find(c=>c.height===640)||image[0];
      return {sourceUri:t.uri,itemUid:item.uid||null,position:snapshot.offset+index,title:t.name,artist:(t.artists?.items||[]).map(a=>a.profile?.name).filter(Boolean).join(', '),album:t.albumOfTrack?.name||'',durationMs:t.trackDuration?.totalMilliseconds||0,coverUrl:best?.url||null,explicit:t.contentRating?.label==='EXPLICIT',bpm:t.playlistAudioAttributes?.bpm??null,musicalKey:t.playlistAudioAttributes?.key?.key||null,musicalMode:t.playlistAudioAttributes?.key?.mode||null,playableInSource:t.playability?.playable===true,addedAt:item.addedAt?.isoString||null};
    }).filter(Boolean);
    return snapshot;
  }
  async function importJson(file){
    let snap;
    try{snap=normalizePlaylist(JSON.parse(await file.text()));}
    catch(err){notice(`JSON inválido para playlist: ${err.message}`);return;}
    let count=0;
    for(const t of snap.items){
      const id=`meta:${t.sourceUri}`;
      if(state.tracks.find(x=>x.id===id))continue;
      await transact('tracks','readwrite',s=>s.put({id,source:'metadata',title:t.title,artist:t.artist,album:t.album,durationMs:t.durationMs,coverUrl:t.coverUrl,liked:false,addedAt:Date.now()-count,sourceInfo:{sourceUri:t.sourceUri,explicit:t.explicit,bpm:t.bpm,musicalKey:t.musicalKey,musicalMode:t.musicalMode}}));count++;
    }
    const id=guid();
    const collection={id,name:`${snap.name} (importado)`,createdAt:Date.now(),trackIds:snap.items.map(t=>`meta:${t.sourceUri}`),sourceEntries:snap.items.map(t=>({uid:t.itemUid,sourceUri:t.sourceUri,position:t.position,addedAt:t.addedAt})),importedPage:{offset:snap.offset,limit:snap.limit,total:snap.total,revision:snap.revision}};
    await transact('playlists','readwrite',s=>s.put(collection));
    state.selectedPlaylist=id;state.view='playlist';await refresh();
    notice(`Importadas ${snap.items.length} das ${snap.total} faixas da coleção. ${count} novos metadados, sem áudios.`);
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
  function currentList(){if(state.view==='liked')return filter(state.tracks.filter(t=>t.liked)); if(state.view==='playlist')return filter(playlistItems()); if(state.view==='queue')return state.queue.map(lookup).filter(Boolean);return filter(state.tracks);}
  function setupUI(){
    $('#import-top').onclick=()=>$('#file-input').click();
    $('#new-playlist').onclick=()=>{$('#playlist-name').value='';$('#playlist-dialog').showModal();};
    $('#cancel-playlist').onclick=()=>$('#playlist-dialog').close();
    $('#cancel-add').onclick=()=>$('#add-dialog').close();
    $('#playlist-form').onsubmit=async e=>{e.preventDefault();const name=$('#playlist-name').value.trim();if(!name)return;await createPlaylist(name);$('#playlist-dialog').close();};
    $('#file-input').onchange=async e=>{await importFiles(e.target.files);e.target.value='';};
    const jf=document.createElement('input');jf.type='file';jf.accept='.json,.txt,application/json,text/plain';jf.hidden=true;document.body.append(jf);
    jf.onchange=async e=>{if(e.target.files[0])await importJson(e.target.files[0]);e.target.value='';};
    document.addEventListener('click',async e=>{
      const nav=e.target.closest('[data-nav]');if(nav){state.view=nav.dataset.nav;render();return;}
      const pnav=e.target.closest('[data-playlist]');if(pnav){state.view='playlist';state.selectedPlaylist=pnav.dataset.playlist;render();return;}
      const addTo=e.target.closest('[data-add-to]');if(addTo){const p=state.playlists.find(p=>p.id===addTo.dataset.addTo);if(p){const id=addTo.dataset.trackId; if(!p.trackIds.includes(id))p.trackIds.push(id);await savePlaylist(p);notice('Música adicionada à playlist.');$('#add-dialog').close();}return;}
      const btn=e.target.closest('[data-action]');if(!btn)return;
      const {action,id}=btn.dataset;
      if(action==='import-audio')$('#file-input').click();
      else if(action==='import-json')jf.click();
      else if(action==='like')await toggleLiked(id);
      else if(action==='add')openAdd(id);
      else if(action==='play'){
        const t=lookup(id);if(t){const list=currentList();await play(id,list.map(x=>x.id));}
      } else if(action==='delete-playlist') await removePlaylist(id);
      else if(action==='clear-queue'){state.queue=[];state.index=-1;audio.pause();state.current=null;audio.removeAttribute('src');render();}
    });
    $('#search-input').oninput=e=>{state.query=e.target.value;render();};
    $('#play-btn').onclick=()=>{if(state.current){if(audio.paused)audio.play().catch(()=>notice('Não foi possível reproduzir.'));else audio.pause();}else{const t=state.tracks.find(canPlay);if(t)play(t.id,[t.id,...state.tracks.filter(canPlay).map(x=>x.id).filter(x=>x!==t.id)]);else notice('Importe uma música para começar.');}};
    $('#prev-btn').onclick=()=>{if(audio.currentTime>3)audio.currentTime=0;else playNext(-1);};
    $('#next-btn').onclick=()=>playNext(1);
    $('#shuffle-btn').onclick=()=>{state.shuffled=!state.shuffled;renderPlayer();};
    $('#repeat-btn').onclick=()=>{state.repeat=state.repeat==='off'?'all':state.repeat==='all'?'one':'off';renderPlayer();};
    $('#queue-toggle').onclick=$('#open-queue').onclick=()=>{state.view='queue';render();};
    $('#like-current').onclick=()=>{if(state.current)toggleLiked(state.current);};
    $('#seek').oninput=e=>{if(Number.isFinite(audio.duration)&&audio.duration>0) audio.currentTime=audio.duration*(Number(e.target.value)/1000);};
    $('#volume').oninput=e=>{audio.volume=Number(e.target.value)/100;};
    audio.addEventListener('timeupdate',renderPlayer);
    audio.addEventListener('durationchange',async()=>{const t=lookup(state.current);if(t && canPlay(t)&&Number.isFinite(audio.duration)&&Math.abs((t.durationMs||0)-audio.duration*1000)>1200){t.durationMs=Math.round(audio.duration*1000);await transact('tracks','readwrite',s=>s.put(t));}});
    audio.addEventListener('play',()=>{renderPlayer();$$('.track-row').forEach(row=>{if(row.dataset.track===state.current){const b=$('[data-action=play]',row);if(b)b.textContent='Ⅱ';}});});
    audio.addEventListener('pause',()=>{renderPlayer();$$('.track-row').forEach(row=>{if(row.dataset.track===state.current){const b=$('[data-action=play]',row);if(b)b.textContent='▶';}});});
    audio.addEventListener('ended',()=>{if(state.repeat==='one'){audio.currentTime=0;audio.play().catch(()=>{});}else playNext(1);});
    audio.addEventListener('error',()=>notice('Falha ao carregar áudio. O formato pode não ser suportado.'));
    if('mediaSession' in navigator){
      for(const [act,fn] of Object.entries({'play':()=>audio.play(),'pause':()=>audio.pause(),'nexttrack':()=>playNext(1),'previoustrack':()=>playNext(-1),'seekto':d=>{if(Number.isFinite(d.seekTime))audio.currentTime=d.seekTime;}}))try{navigator.mediaSession.setActionHandler(act,fn);}catch{}
    }
    document.addEventListener('keydown',e=>{const active=document.activeElement;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-input').focus();}else if(e.code==='Space'&&!e.repeat&&!['INPUT','TEXTAREA','BUTTON'].includes(active?.tagName)&&!active?.isContentEditable){e.preventDefault();$('#play-btn').click();}});
    let drag=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types?.includes('Files')){drag++;$('#drop-overlay').classList.add('show');}});
    document.addEventListener('dragleave',()=>{drag=Math.max(0,drag-1);if(!drag)$('#drop-overlay').classList.remove('show');});
    document.addEventListener('dragover',e=>e.preventDefault());
    document.addEventListener('drop',async e=>{e.preventDefault();drag=0;$('#drop-overlay').classList.remove('show');await importFiles(e.dataTransfer.files);});
  }
  async function init(){
    setupUI();
    try {await initDB();} catch(err){console.error(err);notice('Erro no armazenamento do navegador. Verifique se o modo privado está desativado.');return;}
    if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  init();
})();
