/* Current and upcoming wedding-day tasks. Read-only; all times are Hong Kong time. */
(() => {
  'use strict';

  const WEDDING = { year: 2026, month: 11, day: 12 };
  const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const DEFAULT_PREVIEW_TIME = '09:30';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const renderedHtml = new WeakMap();

  function parseTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour < 24 && minute < 60 ? { hour, minute } : null;
  }

  function weddingInstant(time) {
    return Date.UTC(WEDDING.year, WEDDING.month - 1, WEDDING.day, time.hour - 8, time.minute);
  }

  function hktParts(date) {
    const shifted = new Date(date.getTime() + HKT_OFFSET_MS);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes()
    };
  }

  function compareWeddingDate(parts) {
    const value = parts.year * 10000 + parts.month * 100 + parts.day;
    const wedding = WEDDING.year * 10000 + WEDDING.month * 100 + WEDDING.day;
    return Math.sign(value - wedding);
  }

  function preparedEvents(events) {
    return (Array.isArray(events) ? events : []).map((event, index) => {
      const startTime = parseTime(event && event.start);
      if (!startTime) return null;
      const start = weddingInstant(startTime);
      const hasEnd = event.end !== null && event.end !== undefined && event.end !== '';
      const endTime = hasEnd ? parseTime(event.end) : null;
      if (hasEnd && !endTime) return null;
      let end = endTime ? weddingInstant(endTime) : start + MINUTE_MS;
      if (endTime && end <= start) end += 24 * 60 * MINUTE_MS;
      return { event, start, end, index, row: Number(event.row) };
    }).filter(Boolean).sort((a, b) =>
      a.start - b.start ||
      (Number.isFinite(a.row) ? a.row : a.index) - (Number.isFinite(b.row) ? b.row : b.index) ||
      a.index - b.index
    );
  }

  function getState(events, date) {
    const now = date instanceof Date ? date : new Date(date);
    const validDate = Number.isFinite(now.getTime());
    const prepared = preparedEvents(events);
    if (!validDate) return { current: [], next: prepared.slice(0, 2).map(item => item.event), phase: 'before' };

    const datePosition = compareWeddingDate(hktParts(now));
    if (datePosition < 0) {
      return { current: [], next: prepared.slice(0, 2).map(item => item.event), phase: 'before' };
    }
    if (datePosition > 0) return { current: [], next: [], phase: 'after' };

    const nowMs = now.getTime();
    const current = prepared.filter(item => item.start <= nowMs && nowMs < item.end);
    const next = prepared.filter(item => item.start > nowMs).slice(0, 2);
    const lastEnd = prepared.reduce((latest, item) => Math.max(latest, item.end), -Infinity);
    const phase = prepared.length && nowMs >= lastEnd ? 'after' : 'during';
    return {
      current: current.map(item => item.event),
      next: next.map(item => item.event),
      phase
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function safeCall(callback, fallback, ...args) {
    if (typeof callback !== 'function') return fallback;
    try {
      const result = callback(...args);
      return result === null || result === undefined ? fallback : result;
    } catch {
      return fallback;
    }
  }

  function eventMarkup(event, role, eventPlace, range, getDuty) {
    const id = escapeHtml(event && event.id);
    const time = escapeHtml(safeCall(range, event && event.start || '', event));
    const title = escapeHtml(event && event.title);
    const place = escapeHtml(safeCall(eventPlace, event && event.location || '', event, role));
    const duty = escapeHtml(safeCall(getDuty, '', event, role));
    const context = duty
      ? `<span class="summary-context" lang="zh-Hant">During: ${title}</span>`
      : role && role !== 'all' ? '<span class="summary-context">Separate duty not entered; see the event notes.</span>' : '';
    return `<button type="button" class="summary-event" data-event="${id}"><span class="summary-time">${time}</span><strong class="summary-duty" lang="zh-Hant">${duty || title}</strong>${context}<span class="summary-place">${place}</span></button>`;
  }

  function setHtml(element, html) {
    if (!element || renderedHtml.get(element) === html) return;
    element.innerHTML = html;
    renderedHtml.set(element, html);
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function clockText(date, preview) {
    const parts = hktParts(date);
    const day = String(parts.day).padStart(2, '0');
    const hour = String(parts.hour).padStart(2, '0');
    const minute = String(parts.minute).padStart(2, '0');
    return `${preview ? 'Preview · ' : ''}${day} ${MONTHS[parts.month - 1]} ${parts.year} · ${hour}:${minute} HKT`;
  }

  function create(options = {}) {
    const taskClock = document.getElementById('taskClock');
    const currentTask = document.getElementById('currentTask');
    const nextTaskOne = document.getElementById('nextTaskOne');
    const nextTaskTwo = document.getElementById('nextTaskTwo');
    const previewClock = document.getElementById('previewClock');
    const previewTime = document.getElementById('previewTime');
    const previewTimeField = document.getElementById('previewTimeField');

    function effectiveNow() {
      if (!previewClock || !previewClock.checked) return { date: new Date(), preview: false };
      const time = parseTime(previewTime && previewTime.value) || parseTime(DEFAULT_PREVIEW_TIME);
      return { date: new Date(weddingInstant(time)), preview: true };
    }

    function update() {
      const effective = effectiveNow();
      const events = safeCall(options.getEvents, []);
      const role = safeCall(options.getRole, '');
      const state = getState(events, effective.date);
      const currentEmpty = state.phase === 'before'
        ? 'The wedding day hasn’t started yet.'
        : state.phase === 'after'
          ? 'Your schedule is complete.'
          : 'No task scheduled right now.';
      const noNext = '<p class="summary-empty">No later task scheduled.</p>';

      setText(taskClock, clockText(effective.date, effective.preview));
      setHtml(currentTask, state.current.length
        ? state.current.map(event => eventMarkup(event, role, options.eventPlace, options.range, options.getDuty)).join('')
        : `<p class="summary-empty">${currentEmpty}</p>`);
      setHtml(nextTaskOne, state.next[0] ? eventMarkup(state.next[0], role, options.eventPlace, options.range, options.getDuty) : noNext);
      setHtml(nextTaskTwo, state.next[1] ? eventMarkup(state.next[1], role, options.eventPlace, options.range, options.getDuty) : noNext);
      if (previewTimeField) previewTimeField.hidden = !(previewClock && previewClock.checked);
      const parts = hktParts(effective.date);
      if (typeof options.onClock === 'function') options.onClock({
        minutes: parts.hour * 60 + parts.minute,
        isWeddingDay: compareWeddingDate(parts) === 0,
        preview: effective.preview
      });
      return state;
    }

    if (previewClock) previewClock.addEventListener('change', update);
    if (previewTime) {
      previewTime.addEventListener('input', update);
      previewTime.addEventListener('change', update);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
    window.addEventListener('pageshow', update);
    window.setInterval(() => { if (!document.hidden) update(); }, 30000);
    update();
    return { update };
  }

  window.WeddingDayNow = { create, getState };
})();
