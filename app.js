/* =========================================================================
   lunaci — музыкальный плеер. Чистый JS (ES6+), без библиотек.
   ========================================================================= */

/* ==================== Утилиты ==================== */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = (p = 'id') =>
  p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* ==================== IndexedDB (офлайн-аудио) ==================== */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('lunaci_audio_db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbPromise;
}
async function idbPut(key, blob) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
async function idbClear() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').clear();
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

/* ==================== Состояние ==================== */
const state = {
  tracks: [],
  playlists: [],
  queue: [],
  queueIndex: -1,
  currentTrack: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  volume: 0.8,
  currentView: 'home',
  activePlaylistId: null,
  search: '',
};

const LS = {
  tracks: 'lunaci_tracks',
  playlists: 'lunaci_playlists',
  settings: 'lunaci_settings',
};

/* ==================== Демо-треки ==================== */
const DEMO_TRACKS = [
  { title: 'Sunrise',   artist: 'SoundHelix', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { title: 'Moonlight', artist: 'SoundHelix', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { title: 'Ocean',     artist: 'SoundHelix', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { title: 'Forest',    artist: 'SoundHelix', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { title: 'Desert',    artist: 'SoundHelix', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
];

/* ==================== Загрузка / сохранение ==================== */
function loadLibrary() {
  try {
    const raw = localStorage.getItem(LS.tracks);
    state.tracks = raw ? JSON.parse(raw) : DEMO_TRACKS.map((t) => ({
      id: uid('tr'), ...t, cover: '', liked: false, offline: false
    }));
    if (!raw) saveTracks();
  } catch { state.tracks = []; }

  try {
    const raw = localStorage.getItem(LS.playlists);
    state.playlists = raw ? JSON.parse(raw) : [];
  } catch { state.playlists = []; }

  try {
    const raw = localStorage.getItem(LS.settings);
    if (raw) {
      const s = JSON.parse(raw);
      state.volume  = typeof s.volume === 'number' ? s.volume : 0.8;
16:58
state.shuffle = !!s.shuffle;
      state.repeat  = s.repeat || 'off';
    }
  } catch {}
}

function saveTracks() {
  const data = state.tracks.map((t) => ({
    id: t.id, title: t.title, artist: t.artist,
    url: t.url, cover: t.cover || '',
    liked: !!t.liked, offline: !!t.offline
  }));
  localStorage.setItem(LS.tracks, JSON.stringify(data));
}
function savePlaylists() {
  localStorage.setItem(LS.playlists, JSON.stringify(state.playlists));
}
function saveSettings() {
  localStorage.setItem(LS.settings, JSON.stringify({
    volume: state.volume, shuffle: state.shuffle, repeat: state.repeat
  }));
}

/* ==================== Toast ==================== */
function toast(msg, type = 'info', ms = 3000) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, ms);
}

/* ==================== Онлайн / офлайн ==================== */
function updateOnlineStatus() {
  const el = $('#status');
  if (navigator.onLine) {
    el.className = 'status online';
    el.textContent = '● Онлайн';
  } else {
    el.className = 'status offline';
    el.textContent = '● Офлайн';
  }
}

/* ==================== Рендер ==================== */
function render() {
  const content = $('#content');
  switch (state.currentView) {
    case 'import':    return renderImport(content);
    case 'settings':  return renderSettings(content);
    case 'playlists': return renderPlaylists(content);
    case 'playlist':  return renderPlaylistDetail(content);
    case 'my':        return renderTracksView(content, 'Моя музыка', state.tracks.filter(t => t.liked));
    case 'home':
    default:          return renderTracksView(content, 'Главная', state.tracks);
  }
}

function filterTracks(list) {
  const q = state.search.trim().toLowerCase();
  if (!q) return list;
  return list.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q)
  );
}

function renderTracksView(root, title, list) {
  const filtered = filterTracks(list);
  if (filtered.length === 0) {
    root.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🎵 </div>
        <div class="empty-title">${state.search ? 'Ничего не найдено' : 'Пока пусто'}</div>
        <p>${state.search ? 'Попробуйте другой запрос' : 'Импортируйте треки во вкладке «Импорт»'}</p>
      </div>`;
    return;
  }
  root.innerHTML = `
    <div class="section-title">${escapeHTML(title)} <span style="color:var(--text-dim);font-size:15px;font-weight:400">• ${filtered.length}</span></div>
    <div class="grid">${filtered.map(trackCardHTML).join('')}</div>
  `;
  bindCardEvents(filtered);
}

function trackCardHTML(t) {
  const coverInner = t.cover
    ? `<img src="${escapeHTML(t.cover)}" alt="" loading="lazy"
         onerror="this.parentElement.innerHTML='♪'; this.parentElement.style.color='rgba(255,255,255,.3)'">`
    : '♪';
  return `
    <div class="card${state.currentTrack && state.currentTrack.id === t.id ? ' playing' : ''}" data-id="${t.id}">
      <div class="card-cover">${coverInner}
        <div class="card-actions">
          <button class="card-action play-main" data-action="play" title="Играть">▶</button>
          <button class="card-action${t.offline ? ' offline-ok' : ''}" data-action="download" title="${t.offline ? 'Офлайн' : 'Скачать для офлайна'}">${t.offline ? '✓' : '⬇'}</button>
          <button class="card-action${t.liked ? ' liked' : ''}" data-action="like" title="Мне нравится">${t.liked ? '♥' : '♡'}</button>
          <button class="card-action" data-action="playlist" title="В плейлист">＋</button>
        </div>
      </div>
      <div class="card-title">${escapeHTML(t.title)}</div>
      <div class="card-artist">${escapeHTML(t.artist)}</div>
    </div>
  `;
}

function bindCardEvents(list) {
16:58
$$('.card').forEach(card => {
    const id = card.dataset.id;
    const track = state.tracks.find(t => t.id === id);
    if (!track) return;

    card.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'play')     { e.stopPropagation(); playFromList(id, list); }
      else if (action === 'download') { e.stopPropagation(); downloadForOffline(id); }
      else if (action === 'like')     { e.stopPropagation(); toggleLike(id); }
      else if (action === 'playlist') { e.stopPropagation(); addToPlaylistDialog(id); }
      else { playFromList(id, list); }
    });
  });
}

/* ==================== Импорт ==================== */
function renderImport(root) {
  root.innerHTML = `
    <div class="section-title">Импорт треков</div>
    <div class="import-zone" id="importZone">
      <h3>📥  Загрузить JSON-файл</h3>
      <p>Перетащите файл сюда или нажмите кнопку. Формат: массив объектов.</p>
      <p><code>{"title":"...","artist":"...","url":"...","cover":"..."}</code></p>
      <button class="btn" id="chooseFileBtn">Выбрать файл</button>
    </div>
    <div class="section-title">Библиотека (${state.tracks.length})</div>
    ${state.tracks.length
      ? `<div class="grid">${state.tracks.map(trackCardHTML).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">📭 </div><div class="empty-title">Библиотека пуста</div></div>`}
  `;

  const zone = $('#importZone');
  const input = $('#fileInput');

  $('#chooseFileBtn').onclick = () => input.click();
  input.onchange = () => {
    if (input.files[0]) handleImportFile(input.files[0]);
    input.value = '';
  };

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) handleImportFile(f);
  });

  bindCardEvents(state.tracks);
}

async function handleImportFile(file) {
  try {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Файл не является корректным JSON'); }

    if (!Array.isArray(data))
      throw new Error('Ожидается массив объектов треков');
    if (data.length === 0)
      throw new Error('Массив треков пуст');

    const added = [];
    data.forEach((item, i) => {
      const n = i + 1;
      if (!item || typeof item !== 'object') throw new Error(`Трек #${n}: не объект`);
      if (typeof item.title !== 'string' || !item.title.trim())
        throw new Error(`Трек #${n}: отсутствует "title"`);
      if (typeof item.artist !== 'string' || !item.artist.trim())
        throw new Error(`Трек #${n}: отсутствует "artist"`);
      if (typeof item.url !== 'string' || !item.url.trim())
        throw new Error(`Трек #${n}: отсутствует "url"`);
      if (item.cover && typeof item.cover !== 'string')
        throw new Error(`Трек #${n}: "cover" должен быть строкой`);

      added.push({
        id: uid('tr'),
        title: item.title.trim(),
        artist: item.artist.trim(),
        url: item.url.trim(),
        cover: (item.cover || '').trim(),
        liked: false,
        offline: false,
      });
    });

    state.tracks.push(...added);
    saveTracks();
    render();
    toast(`✅  Импортировано треков: ${added.length}`, 'success');
  } catch (e) {
    toast('❌  ' + e.message, 'error', 5000);
  }
}

/* ==================== Офлайн ==================== */
async function downloadForOffline(trackId) {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;
  if (track.offline) { toast('Уже доступен офлайн', 'info'); return; }

  toast('Скачивание...', 'info', 1500);
  try {
    const resp = await fetch(track.url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
16:58
if (blob.size === 0) throw new Error('Пустой файл');
    await idbPut(track.id, blob);
    track.offline = true;
    saveTracks();
    render();
    toast('✅  Сохранено для офлайна', 'success');
  } catch (e) {
    toast('❌  Не удалось скачать: ' + e.message + ' (возможно CORS)', 'error', 5000);
  }
}

/* ==================== Лайки ==================== */
function toggleLike(trackId) {
  const t = state.tracks.find(x => x.id === trackId);
  if (!t) return;
  t.liked = !t.liked;
  saveTracks();
  render();
  toast(t.liked ? '♥ Добавлено в «Моя музыка»' : 'Убрано из «Моя музыка»',
        t.liked ? 'success' : 'info', 1800);
}

/* ==================== Плейлисты ==================== */
function addToPlaylistDialog(trackId) {
  if (state.playlists.length === 0) {
    const name = prompt('Создать новый плейлист. Введите название:');
    if (!name || !name.trim()) return;
    const pl = { id: uid('pl'), name: name.trim(), trackIds: [trackId] };
    state.playlists.push(pl);
    savePlaylists();
    render();
    toast(`✅  Создан плейлист «${pl.name}»`, 'success');
    return;
  }
  const names = state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const input = prompt(
    `В какой плейлист добавить трек?\n\n${names}\n\n` +
    `Введите номер, или введите новое название для создания плейлиста:`
  );
  if (!input) return;

  const num = parseInt(input, 10);
  if (!isNaN(num) && state.playlists[num - 1]) {
    state.playlists[num - 1].trackIds.push(trackId);
    savePlaylists();
    render();
    toast(`✅  Добавлено в «${state.playlists[num - 1].name}»`, 'success');
  } else {
    const pl = { id: uid('pl'), name: input.trim(), trackIds: [trackId] };
    state.playlists.push(pl);
    savePlaylists();
    render();
    toast(`✅  Создан плейлист «${pl.name}»`, 'success');
  }
}

function renderPlaylists(root) {
  root.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>Плейлисты</span>
      <button class="btn" id="newPlaylistBtn">+ Создать</button>
    </div>
    ${state.playlists.length
      ? `<div class="playlists-grid">${state.playlists.map(pl => `
          <div class="playlist-card" data-plid="${pl.id}">
            <div class="playlist-icon">📁 </div>
            <div class="playlist-name">${escapeHTML(pl.name)}</div>
            <div class="playlist-count">${pl.trackIds.length} трек(ов)</div>
          </div>
        `).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">📁 </div><div class="empty-title">Нет плейлистов</div><p>Создайте первый плейлист</p></div>`}
  `;

  $('#newPlaylistBtn').onclick = () => {
    const name = prompt('Название плейлиста:');
    if (!name || !name.trim()) return;
    const pl = { id: uid('pl'), name: name.trim(), trackIds: [] };
    state.playlists.push(pl);
    savePlaylists();
    render();
    toast(`✅  Создан плейлист «${pl.name}»`, 'success');
  };

  $$('.playlist-card').forEach(card => {
    card.onclick = () => {
      state.activePlaylistId = card.dataset.plid;
      state.currentView = 'playlist';
      render();
    };
  });
}

function renderPlaylistDetail(root) {
  const pl = state.playlists.find(p => p.id === state.activePlaylistId);
  if (!pl) { state.currentView = 'playlists'; return render(); }

  const tracks = pl.trackIds
    .map(id => state.tracks.find(t => t.id === id))
    .filter(Boolean);

  root.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <span>📁  ${escapeHTML(pl.name)}</span>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" id="backToPlBtn">← Назад</button>
        <button class="btn-danger" id="delPlBtn" style="padding:10px 16px;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer">Удалить плейлист</button>
      </div>
    </div>
    ${tracks.length
16:58
? `<div class="grid">${tracks.map(trackCardHTML).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">📭 </div><div class="empty-title">Плейлист пуст</div><p>Добавьте треки через меню карточки (＋)</p></div>`}
  `;

  $('#backToPlBtn').onclick = () => { state.currentView = 'playlists'; render(); };
  $('#delPlBtn').onclick = () => {
    if (!confirm(`Удалить плейлист «${pl.name}»?`)) return;
    state.playlists = state.playlists.filter(p => p.id !== pl.id);
    savePlaylists();
    state.currentView = 'playlists';
    render();
    toast('Плейлист удалён', 'info');
  };

  bindCardEvents(tracks);
}

/* ==================== Настройки ==================== */
function renderSettings(root) {
  root.innerHTML = `
    <div class="section-title">Настройки</div>

    <div class="settings-block">
      <h3>📦  Библиотека</h3>
      <p>Всего треков: <b>${state.tracks.length}</b> • Плейлистов: <b>${state.playlists.length}</b></p>
      <div class="settings-actions">
        <button class="btn-secondary" id="exportBtn">⬇ Экспорт в JSON</button>
        <button class="btn-danger" id="clearBtn" style="padding:10px 20px;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer">🗑 Очистить библиотеку</button>
      </div>
    </div>

    <div class="settings-block">
      <h3>ℹ️  О приложении</h3>
      <p>lunaci — музыкальный плеер на чистом HTML/CSS/JS.<br>
         Метаданные — в localStorage, аудио — в IndexedDB.<br>
         Работает офлайн после скачивания треков.</p>
    </div>
  `;

  $('#exportBtn').onclick = exportLibrary;
  $('#clearBtn').onclick = clearLibrary;
}

function exportLibrary() {
  const data = state.tracks.map(t => ({
    title: t.title, artist: t.artist, url: t.url, cover: t.cover || ''
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lunaci-library-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('✅  Библиотека экспортирована', 'success');
}

async function clearLibrary() {
  if (!confirm('Удалить все треки, плейлисты и офлайн-кэш?')) return;
  state.tracks = [];
  state.playlists = [];
  state.currentTrack = null;
  state.queue = [];
  state.queueIndex = -1;
  saveTracks();
  savePlaylists();
  await idbClear();
  const audio = $('#audio');
  audio.pause();
  audio.removeAttribute('src');
  updatePlayerInfo();
  render();
  toast('🗑 Библиотека очищена', 'info');
}

/* ==================== Плеер ==================== */
const audio = $('#audio');

async function resolveSrc(track) {
  if (track._src) return track._src;
  const blob = await idbGet(track.id);
  if (blob) {
    track._src = URL.createObjectURL(blob);
    return track._src;
  }
  return track.url;
}

async function playFromList(trackId, list) {
  state.queue = [...list];
  state.queueIndex = state.queue.findIndex(t => t.id === trackId);
  await playTrack(state.queue[state.queueIndex]);
}

async function playTrack(track) {
  if (!track) return;
  try {
    const src = await resolveSrc(track);
    audio.src = src;
    state.currentTrack = track;
    updatePlayerInfo();
    await audio.play();
    highlightCurrent();
  } catch (e) {
    toast('❌  Не удалось воспроизвести: ' + e.message, 'error', 4000);
  }
}

function updatePlayerInfo() {
  const t = state.currentTrack;
  const coverEl = $('#playerCover');
  if (!t) {
    $('#playerTitle').textContent = 'Ничего не играет';
    $('#playerArtist').textContent = '—';
    coverEl.innerHTML = '♪';
    return;
  }
  $('#playerTitle').textContent = t.title;
  $('#playerArtist').textContent = t.artist;
  coverEl.innerHTML = t.cover
    ? `<img src="${escapeHTML(t.cover)}" alt="" onerror="this.parentElement.innerHTML='♪'">`
    : '♪';
}

function updatePlayButton() {
  $('#playBtn').textContent = state.playing ? '⏸' : '▶';
}

function highlightCurrent() {
  $$('.card').forEach(c => {
16:58
c.classList.toggle('playing',
      state.currentTrack && c.dataset.id === state.currentTrack.id);
  });
}

function togglePlay() {
  if (!state.currentTrack) {
    let list = state.tracks;
    if (state.currentView === 'my') list = state.tracks.filter(t => t.liked);
    if (state.currentView === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.activePlaylistId);
      list = pl ? pl.trackIds.map(id => state.tracks.find(t => t.id === id)).filter(Boolean) : [];
    }
    list = filterTracks(list);
    if (list.length) playFromList(list[0].id, list);
    return;
  }
  if (audio.paused) audio.play();
  else audio.pause();
}

function playNext(manual = false) {
  if (!state.queue.length) return;

  if (state.repeat === 'one' && !manual) {
    audio.currentTime = 0;
    audio.play();
    return;
  }

  if (state.shuffle && state.queue.length > 1) {
    let idx;
    do { idx = Math.floor(Math.random() * state.queue.length); }
    while (idx === state.queueIndex);
    state.queueIndex = idx;
  } else {
    state.queueIndex++;
    if (state.queueIndex >= state.queue.length) {
      if (manual || state.repeat === 'all') state.queueIndex = 0;
      else { audio.pause(); state.queueIndex = state.queue.length - 1; return; }
    }
  }
  playTrack(state.queue[state.queueIndex]);
}

function playPrev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.shuffle && state.queue.length > 1) {
    let idx;
    do { idx = Math.floor(Math.random() * state.queue.length); }
    while (idx === state.queueIndex);
    state.queueIndex = idx;
  } else {
    state.queueIndex--;
    if (state.queueIndex < 0) state.queueIndex = state.queue.length - 1;
  }
  playTrack(state.queue[state.queueIndex]);
}

function updateShuffleRepeatUI() {
  $('#shuffleBtn').classList.toggle('active', state.shuffle);
  const r = $('#repeatBtn');
  r.classList.toggle('active', state.repeat !== 'off');
  r.textContent = state.repeat === 'one' ? '🔂 ' : '🔁 ';
}

/* ==================== События плеера ==================== */
function bindPlayer() {
  $('#playBtn').onclick  = togglePlay;
  $('#nextBtn').onclick  = () => playNext(true);
  $('#prevBtn').onclick  = playPrev;

  $('#shuffleBtn').onclick = () => {
    state.shuffle = !state.shuffle;
    saveSettings();
    updateShuffleRepeatUI();
    toast(state.shuffle ? '🔀  Перемешать: вкл' : '🔀  Перемешать: выкл', 'info', 1500);
  };

  $('#repeatBtn').onclick = () => {
    state.repeat = state.repeat === 'off' ? 'all'
                 : state.repeat === 'all' ? 'one' : 'off';
    saveSettings();
    updateShuffleRepeatUI();
    const txt = state.repeat === 'off' ? 'выкл'
              : state.repeat === 'all' ? 'все' : 'один трек';
    toast('🔁  Повтор: ' + txt, 'info', 1500);
  };

  audio.addEventListener('play',  () => { state.playing = true;  updatePlayButton(); highlightCurrent(); });
  audio.addEventListener('pause', () => { state.playing = false; updatePlayButton(); });
  audio.addEventListener('ended', () => playNext(false));

  audio.addEventListener('loadedmetadata', () => {
    $('#duration').textContent = fmtTime(audio.duration);
  });

  let isSeeking = false;
  const progress = $('#progress');

  audio.addEventListener('timeupdate', () => {
    if (isSeeking) return;
    const d = audio.duration || 0;
    progress.value = d ? (audio.currentTime / d) * 100 : 0;
    $('#currentTime').textContent = fmtTime(audio.currentTime);
  });

  progress.addEventListener('input', () => {
    isSeeking = true;
    const d = audio.duration || 0;
    if (d) {
      audio.currentTime = (progress.value / 100) * d;
      $('#currentTime').textContent = fmtTime(audio.currentTime);
    }
  });
  progress.addEventListener('change', () => { isSeeking = false; });

  $('#volume').addEventListener('input', (e) => {
    state.volume = parseFloat(e.target.value);
    audio.volume = state.volume;
    saveSettings();
  });

  audio.addEventListener('error', () => {
16:58
if (!state.currentTrack) return;
    if (navigator.onLine) {
      toast('❌  Ошибка воспроизведения (CORS или неверный URL)', 'error', 4000);
    } else {
      toast('📴  Трек недоступен офлайн. Скачайте его для офлайна.', 'error', 4000);
    }
  });
}

/* ==================== Навигация ==================== */
function bindNav() {
  $$('.nav-item').forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      state.currentView = item.dataset.view;
      state.activePlaylistId = null;
      if (state.currentView !== 'home' && state.currentView !== 'my') {
        state.search = '';
        $('#search').value = '';
      }
      updateNav();
      render();
      closeSidebar();
    };
  });

  $('#burger').onclick = () => $('#sidebar').classList.toggle('open');

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    if (state.currentView === 'import' || state.currentView === 'settings' ||
        state.currentView === 'playlists' || state.currentView === 'playlist') {
      state.currentView = 'home';
      updateNav();
    }
    render();
  });
}

function updateNav() {
  $$('.nav-item').forEach(i => {
    const v = i.dataset.view;
    i.classList.toggle('active',
      v === state.currentView ||
      (v === 'playlists' && state.currentView === 'playlist'));
  });
}

function closeSidebar() {
  if (window.innerWidth <= 768) $('#sidebar').classList.remove('open');
}

/* ==================== Service Worker ==================== */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) {
    console.info('[SW] file:// — Service Worker недоступен (запустите через HTTP-сервер)');
    return;
  }
  navigator.serviceWorker.register('sw.js')
    .then(() => console.info('[SW] Зарегистрирован'))
    .catch(err => console.warn('[SW] Ошибка:', err));
}

/* ==================== Инициализация ==================== */
function init() {
  loadLibrary();

  audio.volume = state.volume;
  $('#volume').value = state.volume;

  updateShuffleRepeatUI();
  updatePlayerInfo();
  updateOnlineStatus();

  bindNav();
  bindPlayer();
  registerSW();

  window.addEventListener('online',  updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 &&
        !$('#sidebar').contains(e.target) &&
        !$('#burger').contains(e.target)) {
      closeSidebar();
    }
  });

  render();
  console.info('%c🎵  lunaci готов', 'color:#ffcc00;font-weight:bold');
}

init();