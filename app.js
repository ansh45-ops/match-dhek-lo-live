const PLAYLISTS = [
  'https://iptv-org.github.io/iptv/countries/in.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u'
];
const $ = id => document.getElementById(id);
let channels = [], hls = null, currentFilter = 'all', favorites = new Set(),
    activeChannel = null, loadTimer = null, hlsErrors = { network: 0, media: 0 };

const rules = {
  sports:/sport|cricket|football|tennis|sony ten|star sports|eurosport/i,
  news:/news|aaj tak|republic|ndtv|zee news|india tv|cnn|bbc|tv9|abp|news18/i,
  movies:/movie|cinema|picture|film|flix|star gold|zee cinema/i,
  entertainment:/entertainment|zee |sony|colors|star |sun tv|vijay|gemini|music|mtv|comedy|serial/i,
  kids:/kids|cartoon|nick|pogo|disney|hungama/i,
  music:/music|mtv|9xm|b4u music/i
};

function parseM3U(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let meta = null, out = [], seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      for (const m of line.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
      const comma = line.indexOf(',');
      meta = {
        name: (comma >= 0 ? line.slice(comma + 1).trim() : '') || attrs['tvg-name'] || 'Live Channel',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        userAgent: attrs['http-user-agent'] || ''
      };
    } else if (line.startsWith('#')) {
      // Playlist directives are intentionally ignored; browser security prevents
      // setting some VLC-only headers (for example User-Agent) from JavaScript.
    } else if (meta) {
      try {
        const u = new URL(line);
        if (['http:', 'https:'].includes(u.protocol) && !seen.has(u.href)) {
          seen.add(u.href);
          out.push({ ...meta, url:u.href, id:out.length });
        }
      } catch (_) {}
      meta = null;
    }
  }
  return out;
}

function type(c) {
  const s = c.name + ' ' + c.group;
  for (const k of Object.keys(rules)) if (rules[k].test(s)) return k;
  return 'other';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function render() {
  const q = $('searchInput').value.trim().toLowerCase();
  const list = channels.filter(c =>
    (currentFilter === 'all' || type(c) === currentFilter) &&
    (!q || c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
  );
  $('channelGrid').innerHTML = list.slice(0, 240).map((c, i) => `
    <article class="channel-card" data-id="${c.id}" tabindex="0" role="button" aria-label="Play ${esc(c.name)}">
      <div class="channel-visual" style="--accent:${['#501020','#132c52','#493019','#2a1644','#17463b'][i%5]}">
        <span class="live-label">▶ PLAY</span>
        ${c.logo ? `<img src="${esc(c.logo)}" alt="${esc(c.name)}" loading="lazy" onerror="this.remove()">` : `<span class="channel-fallback">${esc(c.name.split(/\s+/).slice(0,2).join(' ').toUpperCase())}</span>`}
      </div>
      <div class="channel-meta"><strong>${esc(c.name)}</strong><small>${esc(c.group || 'Live channel')}</small></div>
    </article>`).join('');
  $('emptyState').hidden = !!list.length;
  $('channelGrid').querySelectorAll('.channel-card').forEach(el => {
    const fn = () => play(channels[+el.dataset.id]);
    el.onclick = fn;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
  });
  const count = $('channelCount');
  if (count) count.textContent = `${channels.length} channels loaded`;
}

function status(message, isError = false) {
  $('playerError').textContent = message;
  $('playerError').classList.toggle('is-error', isError);
}
function showError(message) {
  clearTimeout(loadTimer);
  status(message, true);
  $('retryPlayer').hidden = false;
}
function cleanupStream() {
  clearTimeout(loadTimer);
  if (hls) { hls.destroy(); hls = null; }
  const v = $('video');
  v.onerror = null; v.onplaying = null; v.onwaiting = null;
  v.pause(); v.removeAttribute('src'); v.load();
}
function play(c) {
  if (!c) return;
  activeChannel = c;
  cleanupStream();
  hlsErrors = { network:0, media:0 };
  $('playerName').textContent = c.name;
  $('retryPlayer').hidden = true;
  status('Connecting… If the broadcaster is offline or blocks third-party playback, this channel may not start.');
  const modal = $('player'), v = $('video');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  v.crossOrigin = 'anonymous';
  v.setAttribute('playsinline', '');
  v.controls = true;
  v.onerror = () => {
    const code = v.error ? v.error.code : 0;
    const detail = ({1:'Playback was interrupted.',2:'A network error stopped the stream.',3:'The stream format or codec is unsupported.',4:'This stream format is not supported by the browser.'})[code] || 'The stream could not be decoded.';
    showError(`${detail} Try another channel. Some broadcasters block playback outside their own apps/sites.`);
  };
  v.onplaying = () => { clearTimeout(loadTimer); status(''); $('retryPlayer').hidden = true; };
  v.onwaiting = () => status('Buffering live stream…');
  loadTimer = setTimeout(() => {
    if (v.readyState < 2) showError('No video data arrived within 25 seconds. This stream may be offline, blocked by CORS/region rules, or require broadcaster authorization.');
  }, 25000);

  // Native HLS is preferred where the browser genuinely supports it.
  if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = c.url;
    const p = v.play();
    if (p && p.catch) p.catch(() => showError('Tap the video Play control. If it still fails, the source may block browser playback.'));
    return;
  }
  if (!window.Hls || !Hls.isSupported()) {
    showError('This browser cannot play HLS. Update Chrome or try a browser with Media Source Extensions.');
    return;
  }

  hls = new Hls({
    enableWorker:true,
    lowLatencyMode:false,
    backBufferLength:30,
    maxBufferLength:30,
    maxMaxBufferLength:60,
    manifestLoadingTimeOut:20000,
    manifestLoadingMaxRetry:3,
    manifestLoadingRetryDelay:1000,
    levelLoadingTimeOut:20000,
    levelLoadingMaxRetry:3,
    levelLoadingRetryDelay:1000,
    fragLoadingTimeOut:25000,
    fragLoadingMaxRetry:4,
    fragLoadingRetryDelay:1000,
    startLevel:-1
  });
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(c.url));
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const p = v.play();
    if (p && p.catch) p.catch(() => status('Stream loaded. Press Play in the video controls to begin.'));
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) status('Buffering… waiting for the live stream.');
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsErrors.network < 2) {
      hlsErrors.network++;
      status(`Connection interrupted. Retrying (${hlsErrors.network}/2)…`);
      hls.startLoad();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsErrors.media < 2) {
      hlsErrors.media++;
      status(`Recovering video decoder (${hlsErrors.media}/2)…`);
      hls.recoverMediaError();
      return;
    }
    const reason = data.details || data.type || 'unknown error';
    showError(`Stream failed (${reason}). The source may be offline, CORS-blocked, geo-restricted, or require a broadcaster app. Try another channel.`);
  });
  hls.attachMedia(v);
}
function closePlayer() {
  cleanupStream();
  activeChannel = null;
  $('player').classList.remove('open');
  $('player').setAttribute('aria-hidden', 'true');
}
document.querySelectorAll('.category').forEach(b => b.onclick = () => {
  document.querySelectorAll('.category').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); currentFilter = b.dataset.filter; render();
});
$('exploreBtn').onclick = () => $('live').scrollIntoView({behavior:'smooth'});
$('viewAll').onclick = () => {
  currentFilter='all';
  document.querySelectorAll('.category').forEach(x => x.classList.toggle('active', x.dataset.filter === 'all'));
  render();
};
$('searchToggle').onclick = () => $('searchPanel').classList.add('open');
$('closeSearch').onclick = () => $('searchPanel').classList.remove('open');
$('searchInput').oninput = render;
$('closePlayer').onclick = closePlayer;
$('retryPlayer').onclick = () => play(activeChannel);
$('player').onclick = e => { if (e.target === $('player')) closePlayer(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePlayer(); $('searchPanel').classList.remove('open'); }
});
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected');
  if (b.dataset.tab === 'live') $('live').scrollIntoView({behavior:'smooth'});
  else if (b.dataset.tab === 'home') window.scrollTo({top:0,behavior:'smooth'});
  else if (b.dataset.tab === 'favorites') {
    const list = channels.filter(c => favorites.has(c.url));
    $('channelGrid').innerHTML = list.length ? list.map(c => `
      <article class="channel-card" data-id="${c.id}" tabindex="0">
        <div class="channel-visual"><span class="channel-fallback">${esc(c.name)}</span></div>
        <div class="channel-meta"><strong>${esc(c.name)}</strong><small>Favorite</small></div>
      </article>`).join('') : '<div class="loading-card">No favorites saved yet.</div>';
    $('channelGrid').querySelectorAll('.channel-card').forEach(el => el.onclick = () => play(channels[+el.dataset.id]));
  } else $('live').scrollIntoView({behavior:'smooth'});
});

async function init() {
  const errors = [];
  for (const source of PLAYLISTS) {
    try {
      const r = await fetch(source, {cache:'no-store'});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = parseM3U(await r.text());
      if (!parsed.length) throw new Error('Playlist contained no usable streams');
      channels = parsed;
      render();
      return;
    } catch (e) { errors.push(e.message); console.warn('Playlist source failed:', source, e); }
  }
  $('channelGrid').innerHTML = `<div class="loading-card">Could not load channels (${esc(errors.join('; '))}). Open this site over HTTPS and check your connection.</div>`;
}
init();
