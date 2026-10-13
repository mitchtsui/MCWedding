/* UI demonstration only. No audio, Auth, database, provider or production publisher. */
(function () {
  'use strict';
  const enabled = new URLSearchParams(location.search).get('preview') === '1';
  const operator = document.body.dataset.captionsRole === 'operator';
  const languages = ['en', 'ja', 'zh-CN'];
  const samples = [
    { source: '多謝大家今日嚟到，同我哋一齊分享呢份喜悅。', text: {
      en: 'Thank you for being here, and for sharing in this joyful day.',
      ja: '本日はお越しいただき、この喜びを共にしてくださり、ありがとうございます。',
      'zh-CN': '感谢大家今天来到这里，与我们一同分享这份喜悦。' } },
    { source: '有你哋喺身邊，呢個晚上就更加有意義。', text: {
      en: 'Having you here makes this evening all the more meaningful.',
      ja: '皆さまがそばにいてくださることで、今夜がいっそう大切な時間になります。',
      'zh-CN': '有大家陪伴，这个夜晚变得更加有意义。' } },
    { source: '願我哋記住今晚嘅笑聲，同埋呢一刻嘅溫暖。', text: {
      en: 'May we remember the laughter of tonight, and the warmth of this moment.',
      ja: '今夜の笑い声と、この瞬間の温かさを、いつまでも心に留めておけますように。',
      'zh-CN': '愿我们记住今晚的欢笑，以及此刻的温暖。' } },
    { source: '而家，請大家一齊舉杯。', text: {
      en: 'And now, please raise your glasses with us.',
      ja: 'それでは、皆さま、どうぞご一緒にグラスをお持ちください。',
      'zh-CN': '现在，请大家与我们一同举杯。' } },
    { source: '為愛、為友誼，同埋未來一齊度過嘅日子，乾杯！', text: {
      en: 'To love, to friendship, and to the days we will share. Cheers!',
      ja: '愛に、友情に、そして共に過ごすこれからの日々に。乾杯！',
      'zh-CN': '为爱、为友谊，也为未来共同度过的日子，干杯！' } },
  ];
  const listeners = new Set();
  const sender = Math.random().toString(36).slice(2);
  let timer = null;
  let sampleIndex = 3;
  let state = { status: enabled ? 'paused' : 'waiting', revision: 0,
    segments: enabled ? samples.slice(0, 3).map((s, i) => ({ ...s, id: 'sample-' + i, order: i, manual: false })) : [], notice: '' };
  let channel = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => clone(state);
  function notify() { for (const listener of listeners) listener(snapshot()); }
  function publish() {
    state.revision += 1;
    notify();
    if (channel && operator) channel.postMessage({ kind: 'state', sender, state: snapshot() });
  }
  function cancelTimer() { if (timer !== null) clearInterval(timer); timer = null; }
  function allowed() { return enabled && operator; }
  function validState(value) {
    return value && ['waiting', 'playing', 'paused', 'ended'].includes(value.status) &&
      Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.segments) && value.segments.length <= 50 &&
      value.segments.every(s => typeof s.id === 'string' && s.id.length < 100 && Number.isSafeInteger(s.order) &&
        s.text && languages.every(l => typeof s.text[l] === 'string' && s.text[l].length <= 1200) &&
        typeof s.source === 'string' && s.source.length <= 1200);
  }
  function connectChannel() {
    if (!enabled || channel || !('BroadcastChannel' in window)) return;
    try {
      channel = new BroadcastChannel('mcwedding-caption-interface-preview');
      channel.onmessage = event => {
        const data = event.data;
        if (!data || data.sender === sender) return;
        if (data.kind === 'request' && operator) {
          channel.postMessage({ kind: 'state', sender, state: snapshot() });
        } else if (data.kind === 'state' && !operator && validState(data.state)) {
          state = clone(data.state); notify();
        }
      };
      if (!operator) channel.postMessage({ kind: 'request', sender });
    } catch { channel = null; }
  }
  connectChannel();
  function next() {
    if (!allowed()) return false;
    if (sampleIndex >= samples.length) { cancelTimer(); state.status = 'ended'; publish(); return false; }
    const order = (state.segments.at(-1)?.order ?? -1) + 1;
    state.segments.push({ ...clone(samples[sampleIndex]), id: 'sample-' + Date.now() + '-' + order, order, manual: false });
    sampleIndex += 1;
    state.segments = state.segments.slice(-50);
    publish(); return true;
  }
  function start() {
    if (!allowed()) return false;
    cancelTimer();
    if (state.status === 'ended') {
      state.segments = []; sampleIndex = 0; next();
    }
    state.status = 'playing'; publish();
    timer = setInterval(next, 5000); return true;
  }
  function pause() {
    if (!allowed()) return false;
    cancelTimer(); state.status = 'paused'; publish(); return true;
  }
  function end() {
    if (!allowed()) return false;
    cancelTimer(); state.status = 'ended'; publish(); return true;
  }
  function stop() {
    if (!allowed()) return false;
    cancelTimer(); state.status = 'paused'; state.notice = 'Preview stopped. No audio was captured or uploaded.'; publish(); return true;
  }
  function sendManual(text) {
    if (!allowed()) return false;
    if (!text || !languages.every(l => typeof text[l] === 'string' && text[l].length <= 1200)) return false;
    const sanitized = Object.fromEntries(languages.map(l => [l, text[l].trim()]));
    if (!Object.values(sanitized).some(Boolean)) return false;
    cancelTimer(); state.status = 'paused';
    const order = (state.segments.at(-1)?.order ?? -1) + 1;
    state.segments.push({ id: 'manual-' + Date.now() + '-' + order, order, text: sanitized, source: '', manual: true });
    state.segments = state.segments.slice(-50); state.notice = 'Sample text updated in this browser preview.';
    publish(); return true;
  }
  window.CaptionsPreview = Object.freeze({ enabled, languages, getSnapshot: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    start, resume: start, pause, end, stop, next, sendManual });
  window.addEventListener('pagehide', () => {
    cancelTimer();
    if (allowed() && state.status === 'playing') {
      state.status = 'paused';
      state.notice = 'Preview stopped. No audio was captured or uploaded.';
      publish();
    }
    if (channel) channel.close();
    channel = null;
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { connectChannel(); notify(); }
  });
}());
