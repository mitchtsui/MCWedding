(() => {
  'use strict';

  const liveRequested = new URLSearchParams(location.search).get('live') === '1';

  const copy = {
    en: {
      pageNavigation: 'Page navigation',
      back: '← Wedding website',
      eyebrow: 'Wedding captions',
      title: 'Follow every word.',
      subtitle: 'Readable captions in English, Japanese and Simplified Chinese.',
      preferences: 'Caption preferences',
      language: 'Language',
      textSize: 'Text size',
      smaller: 'Make text smaller',
      larger: 'Make text larger',
      sizes: ['Small', 'Medium', 'Large'],
      preview: 'Preview · sample captions',
      previewNote: 'Sample text only. This is not a live connection.',
      noticeStopped: 'Preview stopped. No audio was captured or uploaded.',
      noticeUpdated: 'Sample text updated in this browser preview.',
      latest: 'Latest caption',
      history: 'Earlier captions',
      empty: 'Captions will appear here when they begin.',
      historyEmpty: 'Earlier captions will collect here.',
      unavailable: 'No caption was provided for this language.',
      sample: 'Explore a sample',
      follow: 'Return to latest caption',
      footerDate: '12 November 2026 · Hong Kong',
      status: {
        waiting: 'Waiting for captions',
        playing: 'Captions in progress',
        paused: 'Captions paused',
        ended: 'Captions ended'
      }
    },
    ja: {
      pageNavigation: 'ページナビゲーション',
      back: '← 結婚式サイトへ',
      eyebrow: 'ウェディング字幕',
      title: 'すべての言葉を、ここで。',
      subtitle: '英語・日本語・簡体字中国語の字幕を、読みやすい大きさで表示します。',
      preferences: '字幕の設定',
      language: '言語',
      textSize: '文字サイズ',
      smaller: '文字を小さくする',
      larger: '文字を大きくする',
      sizes: ['小', '標準', '大'],
      preview: 'プレビュー · サンプル字幕',
      previewNote: 'サンプル文です。ライブ接続ではありません。',
      noticeStopped: 'プレビューを停止しました。音声の録音やアップロードは行われていません。',
      noticeUpdated: 'このブラウザーのプレビューでサンプル文を更新しました。',
      latest: '最新の字幕',
      history: 'これまでの字幕',
      empty: '字幕が始まると、ここに表示されます。',
      historyEmpty: 'これまでの字幕は、ここに表示されます。',
      unavailable: 'この言語の字幕は提供されていません。',
      sample: 'サンプルを見る',
      follow: '最新の字幕へ戻る',
      footerDate: '2026年11月12日 · 香港',
      status: {
        waiting: '字幕を待っています',
        playing: '字幕を表示中',
        paused: '字幕は一時停止中です',
        ended: '字幕は終了しました'
      }
    },
    'zh-CN': {
      pageNavigation: '页面导航',
      back: '← 返回婚礼网站',
      eyebrow: '婚礼字幕',
      title: '不错过每一句话。',
      subtitle: '以清晰易读的方式显示英语、日语和简体中文字幕。',
      preferences: '字幕设置',
      language: '语言',
      textSize: '文字大小',
      smaller: '缩小文字',
      larger: '放大文字',
      sizes: ['小', '标准', '大'],
      preview: '预览 · 示例字幕',
      previewNote: '这里只显示示例文字，并未连接现场直播。',
      noticeStopped: '预览已停止。没有录制或上传任何音频。',
      noticeUpdated: '已更新此浏览器预览中的示例文字。',
      latest: '最新字幕',
      history: '较早字幕',
      empty: '字幕开始后会显示在这里。',
      historyEmpty: '较早的字幕会依次显示在这里。',
      unavailable: '没有提供此语言的字幕。',
      sample: '查看示例',
      follow: '返回最新字幕',
      footerDate: '2026年11月12日 · 香港',
      status: {
        waiting: '正在等待字幕',
        playing: '字幕正在播放',
        paused: '字幕已暂停',
        ended: '字幕已结束'
      }
    }
  };

  const languageKey = 'mc-captions-language';
  const sizeKey = 'mc-captions-size';
  const sizeNames = ['small', 'medium', 'large'];
  const sizeValues = [
    'clamp(1.75rem, 6vw, 3.6rem)',
    'clamp(2.1rem, 7vw, 4.5rem)',
    'clamp(2.5rem, 8.5vw, 5.6rem)'
  ];
  const $ = id => document.getElementById(id);

  function readPreference(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* Preferences remain in memory. */ }
  }

  function initialLanguage() {
    const saved = readPreference(languageKey);
    if (Object.prototype.hasOwnProperty.call(copy, saved)) return saved;
    const browser = navigator.language || 'en';
    if (browser.toLowerCase().startsWith('ja')) return 'ja';
    if (browser.toLowerCase().startsWith('zh')) return 'zh-CN';
    return 'en';
  }

  function initialSize() {
    const saved = readPreference(sizeKey);
    const index = sizeNames.indexOf(saved);
    return index === -1 ? 1 : index;
  }

  let language = initialLanguage();
  let sizeIndex = initialSize();
  let snapshot = { status: 'waiting', revision: 0, segments: [], notice: '' };

  let preview = window.CaptionsPreview || {
    enabled: false,
    getSnapshot: () => snapshot,
    subscribe: callback => { callback(snapshot); return () => {}; }
  };

  function normalizedSnapshot(value) {
    const input = value && typeof value === 'object' ? value : {};
    const statuses = ['waiting', 'playing', 'paused', 'ended'];
    const segments = Array.isArray(input.segments) ? input.segments.filter(segment => (
      segment && typeof segment === 'object' && segment.text && typeof segment.text === 'object'
    )) : [];
    return {
      status: statuses.includes(input.status) ? input.status : 'waiting',
      revision: input.revision ?? 0,
      segments: [...segments].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      notice: typeof input.notice === 'string' ? input.notice : ''
    };
  }

  function segmentText(segment) {
    const value = segment?.text?.[language];
    if (typeof value === 'string' && value.trim()) return value;
    return copy[language].unavailable;
  }

  function readingAnchor() {
    const nodes = [...document.querySelectorAll('[data-segment-id]')];
    if (!nodes.length) return null;
    const visible = nodes.find(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    const node = visible || nodes[0];
    return { id: node.dataset.segmentId, top: node.getBoundingClientRect().top };
  }

  function restoreReadingAnchor(anchor) {
    if (!anchor) return;
    requestAnimationFrame(() => {
      const node = [...document.querySelectorAll('[data-segment-id]')]
        .find(item => item.dataset.segmentId === anchor.id);
      if (!node) return;
      const delta = node.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    });
  }

  function isReadingHistory() {
    const history = $('historyList');
    if (!history.children.length) return false;
    const latestRect = $('latestCaption').getBoundingClientRect();
    const hasVisibleHistory = [...history.children].some(item => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    return latestRect.bottom < 0 && hasVisibleHistory;
  }

  function renderSegments({ preserveAnchor = false } = {}) {
    const anchor = preserveAnchor ? readingAnchor() : null;
    const segments = snapshot.segments;
    const latest = segments[segments.length - 1];

    $('latestText').textContent = latest ? segmentText(latest) : '';
    $('latestText').hidden = !latest;
    $('latestCaption').dataset.segmentId = latest ? String(latest.id) : '';
    if (latest) $('latestCaption').setAttribute('data-segment-id', String(latest.id));
    else $('latestCaption').removeAttribute('data-segment-id');
    $('latestEmpty').hidden = Boolean(latest);
    $('sampleLink').hidden = Boolean(preview.enabled);

    const history = $('historyList');
    history.replaceChildren();
    segments.slice(0, -1).reverse().forEach(segment => {
      const item = document.createElement('article');
      item.className = 'paper history-item';
      item.dataset.segmentId = String(segment.id);
      const text = document.createElement('p');
      text.textContent = segmentText(segment);
      item.append(text);
      history.append(item);
    });
    $('historyEmpty').hidden = segments.length > 1;
    restoreReadingAnchor(anchor);
  }

  function renderStatus() {
    const status = snapshot.status;
    const notices = {
      'Preview stopped. No audio was captured or uploaded.': copy[language].noticeStopped,
      'Sample text updated in this browser preview.': copy[language].noticeUpdated
    };
    const notice = notices[snapshot.notice] || snapshot.notice;
    $('statusLine').dataset.status = status;
    $('statusDot').className = `status-dot status-${status}`;
    $('statusLabel').textContent = copy[language].status[status];
    $('statusNotice').textContent = notice;
    $('statusNotice').hidden = !notice;
  }

  function localize({ preserveAnchor = true } = {}) {
    const anchor = preserveAnchor ? readingAnchor() : null;
    const text = copy[language];
    document.documentElement.lang = language;
    document.title = `${text.eyebrow} · Christy & Mitchell`;
    $('pageNavigation').setAttribute('aria-label', text.pageNavigation);
    $('backLink').textContent = text.back;
    $('pageEyebrow').textContent = text.eyebrow;
    $('pageTitle').textContent = text.title;
    $('pageSubtitle').textContent = text.subtitle;
    $('captionToolbar').setAttribute('aria-label', text.preferences);
    $('languageLabel').textContent = text.language;
    $('textSizeLabel').textContent = text.textSize;
    $('decreaseText').setAttribute('aria-label', text.smaller);
    $('increaseText').setAttribute('aria-label', text.larger);
    $('previewBannerText').textContent = text.preview;
    $('previewBannerNote').textContent = text.previewNote;
    $('latestHeading').textContent = text.latest;
    $('historyHeading').textContent = text.history;
    $('emptyTitle').textContent = text.empty;
    $('historyEmpty').textContent = text.historyEmpty;
    $('sampleLink').textContent = text.sample;
    $('followLatest').textContent = text.follow;
    $('footerDate').textContent = text.footerDate;
    document.querySelectorAll('[data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
    applySize(false);
    renderStatus();
    renderSegments({ preserveAnchor: false });
    restoreReadingAnchor(anchor);
  }

  function applySize(preserveAnchor = true) {
    const anchor = preserveAnchor ? readingAnchor() : null;
    document.documentElement.style.setProperty('--caption-size', sizeValues[sizeIndex]);
    $('resetText').textContent = copy[language].sizes[sizeIndex];
    $('decreaseText').disabled = sizeIndex === 0;
    $('increaseText').disabled = sizeIndex === sizeNames.length - 1;
    restoreReadingAnchor(anchor);
  }

  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => {
      language = button.dataset.language;
      savePreference(languageKey, language);
      localize();
      if (liveLanguageChanged) void liveLanguageChanged();
    });
  });

  $('decreaseText').addEventListener('click', () => {
    if (sizeIndex === 0) return;
    sizeIndex -= 1;
    savePreference(sizeKey, sizeNames[sizeIndex]);
    applySize();
  });

  $('increaseText').addEventListener('click', () => {
    if (sizeIndex === sizeNames.length - 1) return;
    sizeIndex += 1;
    savePreference(sizeKey, sizeNames[sizeIndex]);
    applySize();
  });

  $('resetText').addEventListener('click', () => {
    sizeIndex = 1;
    savePreference(sizeKey, sizeNames[sizeIndex]);
    applySize();
  });

  $('followLatest').addEventListener('click', () => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('latestCaption').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    $('followLatest').hidden = true;
  });

  $('previewBanner').hidden = !preview.enabled;
  applySize(false);
  localize({ preserveAnchor: false });

  let liveLanguageChanged = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src; script.onload = resolve;
      script.onerror = () => reject(new Error('Live caption code did not load')); document.head.append(script);
    });
  }
  function liveStatus(value, notice) {
    const allowed = ['waiting', 'playing', 'paused', 'ended'];
    snapshot.status = allowed.includes(value) ? value : 'waiting'; snapshot.notice = notice || '';
    renderStatus(); renderSegments();
  }
  async function initLive() {
    let client, api, token = '', eventId = '', runId = '', subscription = null, store = null, syncing = false, buffered = [], heartbeatTimer = null, fallbackTimer = null;
    const savedKey = 'mc-captions-guest-event';
    let selectionEpoch = 0;
    const request = async (action, payload) => {
      token = await window.CaptionsLive.accessToken(client); if (!token) throw new Error('Caption access expired');
      return api.request(action, payload, token);
    };
    const statusFromBatch = value => value === 'paused' ? 'paused' : ['ended', 'stopped'].includes(value) ? 'ended' :
      ['publisher.expired', 'stream.gap', 'waiting', 'disconnected'].includes(value) ? 'waiting' : 'playing';
    const noticeFromBatch = value => ['publisher.expired', 'disconnected'].includes(value) ? 'The live publisher connection expired. Waiting for the operator to reconnect.' :
      value === 'stream.gap' ? 'A caption delivery gap was detected. Resynchronizing from the private snapshot.' : '';
    const renderStore = value => {
      snapshot = { status: statusFromBatch(value?.status), revision: value?.messageSeq || 0,
        segments: store.segments(language).map(item => ({ id: item.segmentId, order: item.segmentOrder, text: { [language]: item.text } })), notice: noticeFromBatch(value?.status) };
      renderStatus(); renderSegments({ preserveAnchor: isReadingHistory() });
    };
    function adoptRun(value) {
      if (value.runId === runId) return;
      runId = value.runId;
      store = new window.CaptionsLive.CaptionStore(() => void resync()); store.eventId = eventId;
      try { localStorage.setItem(savedKey, JSON.stringify({ eventId, runId })); } catch (_) { /* Auth remains authoritative. */ }
    }
    async function resync() {
      if (!eventId || !runId || !store || syncing) return; syncing = true;
      const selected = selectionEpoch;
      try { const value = await window.CaptionsLive.currentSnapshot(request, { eventId, runId, language });
        if (selected !== selectionEpoch) return;
        adoptRun(value); store.merge(value); buffered.forEach(batch => store.merge(batch)); buffered = []; renderStore(value); }
      catch (error) { if (selected === selectionEpoch) liveStatus('waiting', error.message); }
      finally { if (selected === selectionEpoch) syncing = false; }
    }
    function scheduleFallback() {
      clearTimeout(fallbackTimer); fallbackTimer = setTimeout(async () => { await resync(); scheduleFallback(); }, 45000 + Math.floor(Math.random() * 15000));
    }
    function heartbeat(value) {
      if (!value || value.eventId !== eventId || value.language !== language) return;
      if (value.runId !== runId) { void resync(); return; }
      if (window.CaptionsLive.heartbeatNeedsSnapshot(store, value)) void resync();
      clearTimeout(heartbeatTimer); heartbeatTimer = setTimeout(() => liveStatus('waiting', 'The private caption heartbeat expired. Waiting for the operator to reconnect.'), 25000);
      snapshot.status = statusFromBatch(value.status); snapshot.notice = noticeFromBatch(value.status); renderStatus();
    }
    async function selectLanguage() {
      const selected = ++selectionEpoch;
      subscription?.close(); clearTimeout(heartbeatTimer); clearTimeout(fallbackTimer); subscription = null; buffered = []; syncing = true;
      store = new window.CaptionsLive.CaptionStore(() => void resync()); store.eventId = eventId;
      const initial = await window.CaptionsLive.currentSnapshot(request, { eventId, runId, language });
      if (selected !== selectionEpoch) return;
      adoptRun(initial);
      if (!initial.topic) throw new Error('Private caption channel unavailable');
      await new Promise((resolve, reject) => { let subscribed = false;
        const timer = setTimeout(() => reject(new Error('Private caption channel timed out')), 5000);
        subscription = window.CaptionsLive.subscribe(client, initial.topic,
          batch => { if (selected !== selectionEpoch) return; if (syncing) buffered.push(batch); else if (batch.runId !== runId) { void resync(); } else { const changed = store.merge(batch); if (changed && !syncing) renderStore(batch); } },
          state => { if (state === 'SUBSCRIBED') { if (subscribed) void resync(); else { subscribed = true; clearTimeout(timer); resolve(); } } else if (state === 'CHANNEL_ERROR') { if (!subscribed) { clearTimeout(timer); reject(new Error('Private caption channel failed')); } } }, heartbeat);
      });
      if (selected !== selectionEpoch) return;
      const current = await window.CaptionsLive.currentSnapshot(request, { eventId, runId, language });
      if (selected !== selectionEpoch) return;
      adoptRun(current);
      store.merge(current); buffered.forEach(batch => store.merge(batch)); buffered = []; syncing = false; renderStore(current); scheduleFallback();
    }
    try {
      liveStatus('waiting', 'Checking private caption access...');
      await loadScript('/api/config.js'); await loadScript('vendor/supabase.js'); await loadScript('live-captions-client.js');
      api = window.CaptionsLive.create(); const config = await api.request('config');
      if (!config.enabled || !config.guestAuthReady) throw new Error('Live captions are not available yet');
      client = window.CaptionsLive.createSupabase(window, 'mc-captions-guest-auth', false); if (!client) throw new Error('Private caption access is unavailable');
      let session = (await client.auth.getSession())?.data?.session;
      if (!session) { const result = await client.auth.signInAnonymously(); if (result.error) throw result.error; session = result.data?.session; }
      if (!session?.access_token) throw new Error('Private caption access could not be established'); token = session.access_token;
      const query = new URLSearchParams(location.search), invite = window.CaptionsLive.fragmentToken(location.hash);
      const fragmentEvent = query.get('event') || window.CaptionsLive.fragmentEventId(location.hash), fragmentRun = query.get('run') || window.CaptionsLive.fragmentRunId(location.hash);
      if (invite && fragmentEvent) {
        const redeemed = await request('redeem', { eventId: fragmentEvent, token: invite });
        eventId = redeemed.eventId || fragmentEvent; runId = redeemed.runId || fragmentRun; window.CaptionsLive.clearFragment(history, location);
        try { localStorage.setItem(savedKey, JSON.stringify({ eventId, runId })); } catch (_) { /* Identity remains in the auth session. */ }
      } else {
        try { const saved = JSON.parse(localStorage.getItem(savedKey) || '{}'); eventId = saved.eventId || ''; runId = saved.runId || ''; } catch (_) { /* A fresh invite is required. */ }
      }
      if (!eventId || !runId) throw new Error('Open the private guest link supplied by the operator');
      preview = { enabled: true }; $('previewBanner').hidden = true; $('sampleLink').hidden = true;
      window.CaptionsLive.keepRealtimeAuth(client); await selectLanguage(); liveLanguageChanged = selectLanguage;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (client.realtime?.setAuth) void window.CaptionsLive.accessToken(client).then(value => client.realtime.setAuth(value)); void resync(); } });
      window.addEventListener('pagehide', event => { if (!event.persisted) { clearTimeout(heartbeatTimer); clearTimeout(fallbackTimer); subscription?.close(); } });
    } catch (error) { liveStatus('ended', error.message); $('previewBanner').hidden = false; $('previewBannerText').textContent = 'Live captions unavailable'; $('previewBannerNote').textContent = error.message; }
  }

  if (liveRequested) { void initLive(); return; }

  let unsubscribe = () => {};
  try {
    unsubscribe = preview.subscribe(value => {
      const wasReadingHistory = isReadingHistory();
      const next = normalizedSnapshot(value);
      const previousLatest = snapshot.segments[snapshot.segments.length - 1];
      const nextLatest = next.segments[next.segments.length - 1];
      const hasNewLatest = Boolean(nextLatest) && nextLatest.id !== previousLatest?.id;
      snapshot = next;
      renderStatus();
      renderSegments({ preserveAnchor: wasReadingHistory });
      if (hasNewLatest && wasReadingHistory) $('followLatest').hidden = false;
    });
  } catch (_) {
    snapshot = normalizedSnapshot(preview.getSnapshot?.());
    renderStatus();
    renderSegments();
  }

  window.addEventListener('pagehide', event => {
    if (!event.persisted) unsubscribe();
  });
})();
