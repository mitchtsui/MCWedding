/* Phone layout (540px and below): move the same controls into their phone slots; never duplicate IDs or form state. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const phone = window.matchMedia('(max-width: 540px)');
  const controls = document.querySelector('.controls');
  const moves = [
    ['personField', 'mobilePerson'],
    ['rundownNotice', 'mobilePlanningContent'],
    ['roleNote', 'mobilePlanningContent'],
    ['clockControls', 'mobilePlanningContent'],
    ['showCurrentTime', 'mobileJump'],
    ['toggleSearch', 'controlRow'],
    ['searchField', 'controlRow']
  ].map(([id, target]) => {
    const node = $(id), origin = document.createComment(`${id} desktop position`);
    node.before(origin);
    return { node, origin, target: $(target) };
  });
  function updateSearchState() {
    const active = Boolean($('search').value.trim());
    $('toggleSearch').classList.toggle('has-query', active);
    $('toggleSearch').setAttribute('aria-label', active ? `Search, active filter: ${$('search').value}` : 'Search moments or places');
    $('clearSearch').hidden = !phone.matches || !active || controls.classList.contains('search-open');
    $('clearSearch').setAttribute('aria-label', `Clear filter: ${$('search').value}`);
  }
  function setSearchOpen(open) {
    controls.classList.toggle('search-open', open);
    $('toggleSearch').setAttribute('aria-expanded', String(open));
    updateSearchState();
  }
  function applyLayout() {
    const active = document.activeElement;
    const movedFocus = moves.some(({ node }) => node.contains(active));
    moves.forEach(({ node, origin, target }) => {
      if (phone.matches) target.append(node);
      else origin.after(node);
    });
    // Preserve an in-progress edit when rotation moves its control into a disclosure.
    if (phone.matches && movedFocus && $('mobilePlanningContent').contains(active)) $('mobilePlanningNotes').open = true;
    setSearchOpen(phone.matches && (Boolean($('search').value.trim()) || active === $('search')));
    updateSearchState();
    if (!phone.matches && active === $('toggleSearch')) $('search').focus({ preventScroll: true });
    else if (movedFocus) active.focus({ preventScroll: true });
  }
  $('toggleSearch').addEventListener('click', () => {
    const open = !controls.classList.contains('search-open');
    setSearchOpen(open);
    if (open) $('search').focus({ preventScroll: true });
  });
  $('clearSearch').addEventListener('click', () => {
    $('search').value = '';
    $('search').dispatchEvent(new Event('input', { bubbles: true }));
    $('toggleSearch').focus({ preventScroll: true });
  });
  $('search').addEventListener('input', updateSearchState);
  $('search').addEventListener('search', updateSearchState);
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape' && phone.matches && !$('search').value) {
      setSearchOpen(false);
      $('toggleSearch').focus({ preventScroll: true });
    }
  });
  $('mobileSourceStatus').addEventListener('click', event => {
    event.preventDefault();
    const notes = $('mobilePlanningNotes');
    notes.open = true;
    notes.querySelector('summary').focus({ preventScroll: true });
    notes.scrollIntoView({ block: 'start' });
  });
  phone.addEventListener('change', applyLayout);
  applyLayout();
})();

/* Read-only, source-based prototype. No RSVP, guest database, or shared writes. */
(() => {
  'use strict';
  const data = window.WEDDING_DAY;
  const $ = id => document.getElementById(id);
  if (!data || !Array.isArray(data.events)) {
    $('resultCount').textContent = 'The schedule could not load. Please reload the page or open the source workbook below.';
    $('currentTask').textContent = 'The schedule could not load. Please reload the page.';
    return;
  }
  const roles = {
    overview: ['The day', '全日流程'], bride: ['Bride', '新娘'], bridesmaids: ['Bridesmaids', '姊妹'],
    groom: ['Groom', '新郎'], groomsmen: ['Groomsmen', '兄弟'],
    brideFamily: ['Bride’s family', '女家屋企人'], groomFamily: ['Groom’s family', '男家屋企人'], vendors: ['Vendors', '各單位']
  };
  const periods = { all: [330, 1440], morning: [330, 840], afternoon: [840, 1020], evening: [1020, 1440] };
  const timelineLayout = { scale: 2, trackHeight: 50, padding: 6 };
  let timelineClock = null;
  let initialTimePositionPending = true;
  let savedScrollLeft = 0;
  let period = 'all', view = 'timeline';
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => escape(value);
  const events = [...data.events].sort((a, b) => minutes(a.start) - minutes(b.start) || a.row - b.row);
  // Explicit participation in source titles/notes, even where a role's duty cell is blank.
  // These links add no instructions: original notes remain available in the details.
  const namedInSource = {
    r5: ['bride'], r8: ['bride', 'bridesmaids', 'brideFamily'], r9: ['groom'],
    r10: ['groom'], r11: ['groom', 'groomsmen'], r12: ['groomsmen'],
    r14: ['groom'], r26: ['groom', 'brideFamily', 'groomsmen'],
    r29: ['bride', 'brideFamily', 'groomFamily']
  };
  const participates = (e, role) => Boolean(e.duties[role]?.trim()) || namedInSource[e.id]?.includes(role);
  const instructions = (e, role) => e.duties[role]?.trim() || 'This activity names you or your team in its title or notes. Your separate duty cell is blank; open the details for the source instructions.';
  function eventPlace(e, role) {
    // Rundown J5 explicitly places the groom at home while D5 names the bridal venue.
    if (e.id === 'r5' && role === 'groom') return 'Your location · 男家（滿名山）';
    return `Event location · ${e.location || 'To confirm · 地點待確認'}`;
  }
  const range = e => e.end ? `${e.start}–${e.end}` : `${e.start} · Arrival / milestone`;
  const people = data.people || [];
  const group = document.createElement('optgroup');
  group.label = 'Wedding party · 按名字';
  people.forEach((p, i) => {
    const option = document.createElement('option'); option.value = `person-${i}`;
    option.textContent = `${p.name} · ${roles[p.role]?.[1] || p.role}`; group.append(option);
  });
  $('person').append(group);
  // URL-selected views can be copied directly, without storing a person's choice on a shared device.
  const params = new URLSearchParams(location.search);
  if ([...$('person').options].some(o => o.value === params.get('who'))) $('person').value = params.get('who');
  if (params.get('view') === 'duties') view = 'duties';
  function selected() {
    const value = $('person').value;
    const person = value.startsWith('person-') ? people[Number(value.slice(7))] : null;
    return { role: person?.role || value, person };
  }
  // A reader who has scrolled past the summary panel keeps the same visual spot when a clock
  // update changes the panel's height. Native scroll anchoring is off (html{overflow-anchor:none}),
  // so this is the only adjustment; a scroll or an open dialog in the meantime wins.
  const readingAnchor = (() => {
    let snapshot = null, frame = 0;
    return {
      before() {
        cancelAnimationFrame(frame);
        const panel = document.querySelector('.now-next'), anchor = document.querySelector('.section-heading');
        snapshot = panel.getBoundingClientRect().bottom <= 0 && !$('details').open
          ? { anchor, top: anchor.getBoundingClientRect().top, scrollY: window.scrollY } : null;
      },
      after() {
        const saved = snapshot; snapshot = null;
        if (!saved) return;
        frame = requestAnimationFrame(() => {
          if (Math.abs(window.scrollY - saved.scrollY) > 1) return;
          const delta = saved.anchor.getBoundingClientRect().top - saved.top;
          if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
        });
      }
    };
  })();
  const nowNext = window.WeddingDayNow.create({
    getEvents: () => { readingAnchor.before(); return events.filter(e => selected().role === 'all' || participates(e, selected().role)); },
    getRole: () => selected().role,
    getDuty: (event, role) => role === 'all' ? '' : event.duties[role]?.trim() || '',
    onClock: value => { timelineClock = value; updateTimeMarker(); readingAnchor.after(); },
    eventPlace, range
  });
  function filtered() {
    const { role } = selected(), query = $('search').value.trim().toLocaleLowerCase();
    const [start, end] = periods[period];
    return events.filter(e => minutes(e.start) < end && (e.end ? minutes(e.end) > start : minutes(e.start) >= start))
      .filter(e => role === 'all' || participates(e, role))
      .filter(e => !query || [e.title, e.location, e.notes, ...Object.values(e.duties)].join(' ').toLocaleLowerCase().includes(query));
  }
  function roleNote() {
    const { role, person } = selected();
    if (person) return `${person.name}${person.responsibility ? ' · ' + person.responsibility : ''}. Showing the ${roles[role][0].toLowerCase()} team’s duties; unnamed tasks are not individual assignments.`;
    return role === 'all' ? 'Everyone’s schedule. Select your name or team to focus on your duties.' : `${roles[role][0]} activities and team instructions from the sheet. A blank duty cell does not mean you can skip an activity; 【一人】 / 【兩人】 need named owners.`;
  }
  function rememberScroll() {
    if (!$('timelineView').hidden && $('timelineInner').dataset.hasEvents === 'true') savedScrollLeft = $('timeline').scrollLeft;
  }
  function syncRuler() {
    $('rulerInner').style.transform = `translateX(${-$('timeline').scrollLeft}px)`;
  }
  function render({ resetPosition = false } = {}) {
    if (resetPosition) savedScrollLeft = 0;
    else rememberScroll();
    const list = filtered();
    const { role, person } = selected();
    $('taskScope').textContent = person ? `${person.name} · ${roles[role][0]} team schedule` : role === 'all' ? 'Everyone’s schedule' : `${roles[role][0]} · ${roles[role][1]}`;
    nowNext.update();
    $('roleNote').textContent = roleNote();
    const periodText = period === 'all' ? '05:30–23:45' : `${clock(periods[period][0])}–${period === 'evening' ? '23:45' : clock(periods[period][1])}`;
    $('resultCount').innerHTML = `${list.length} moments<span class="result-range"> · ${periodText}</span> · HKT<span class="result-hint"> · Tap for full instructions</span>`;
    $('timelineView').hidden = view !== 'timeline'; $('agendaView').hidden = view !== 'duties';
    $('timelineButton').setAttribute('aria-pressed', view === 'timeline');
    $('agendaButton').setAttribute('aria-pressed', view === 'duties');
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', b.dataset.period === period));
    renderTimeline(list); renderAgenda(list);
    try {
      const url = new URL(location.href); url.searchParams.set('who', $('person').value); url.searchParams.set('view', view);
      history.replaceState(null, '', url);
    } catch { /* file previews may not permit history updates */ }
  }
  function renderTimeline(list) {
    const area = $('timelineInner'), [start, end] = periods[period];
    const { scale, trackHeight, padding } = timelineLayout;
    const labelWidth = window.innerWidth <= 540 ? 96 : 130;
    const visibleTimeWidth = Math.max(0, $('timeline').clientWidth - labelWidth);
    const width = Math.ceil(labelWidth + (end - start) * scale + visibleTimeWidth * 0.9);
    area.style.width = `${width}px`;
    area.style.setProperty('--grid-offset', `${labelWidth + ((60 - start % 60) % 60) * scale}px`);
    area.dataset.hasEvents = String(Boolean(list.length));
    $('timelineRuler').hidden = !list.length;
    if (!list.length) { area.style.width = '100%'; area.innerHTML = '<p class="empty">No matching moments. Try another team, time, or search.</p>'; return; }
    let ticks = '';
    for (let t = Math.ceil(start / 60) * 60; t < end; t += 60) ticks += `<span class="tick" style="left:${labelWidth + (t - start) * scale}px">${clock(t)}</span>`;
    $('rulerInner').style.width = `${width}px`;
    $('rulerInner').innerHTML = ticks + '<span id="timeMarkerLabel" class="time-marker-label" hidden></span><span id="timeMarkerDot" class="ruler-marker" hidden></span>';
    let html = '';
    const { role } = selected();
    const lanes = role === 'all' ? ['overview', 'bride', 'bridesmaids', 'groom', 'groomsmen'] : ['overview', role];
    for (const lane of lanes) {
      const rowEnds = [], blocks = [];
      const laneEvents = list.filter(e => lane === 'overview' || participates(e, lane));
      for (const e of laneEvents) {
        const left = Math.max(0, minutes(e.start) - start) * scale;
        const duration = e.end ? (Math.min(end, minutes(e.end)) - Math.max(start, minutes(e.start))) * scale : 0;
        // Minimum-width blocks remain tappable. Tracks also account for their visual width.
        const width = Math.max(105, duration - 4);
        let track = rowEnds.findIndex(last => last <= left);
        if (track < 0) track = rowEnds.length;
        rowEnds[track] = left + width + 5;
        blocks.push(`<button class="event ${lane}${e.issues?.length ? ' flagged' : ''}" data-event="${text(e.id)}" title="${text(range(e) + ' · ' + e.title)}" style="left:${labelWidth + left}px;top:${padding + track * trackHeight}px;width:${width}px" aria-label="${text(range(e) + ', ' + roles[lane][0] + ', ' + e.title)}"><small>${text(e.start)}${e.end ? '–' + text(e.end) : ' ◆'}</small><strong lang="zh-Hant">${text(e.title)}</strong></button>`);
      }
      html += `<div class="lane" style="height:${Math.max(1, rowEnds.length) * trackHeight + padding * 2}px"><div class="lane-label">${roles[lane][0]}<small lang="zh-Hant">${roles[lane][1]}</small></div>${blocks.join('')}</div>`;
    }
    area.innerHTML = html + '<div id="timeMarker" class="time-marker" aria-hidden="true" hidden></div>';
    updateTimeMarker();
    if (!$('timelineView').hidden) {
      $('timeline').scrollLeft = savedScrollLeft;
      syncRuler();
      if (initialTimePositionPending && positionAtCurrentTime()) initialTimePositionPending = false;
    }
  }
  function positionAtCurrentTime() {
    const marker = $('timeMarker'), timeline = $('timeline');
    if (!marker || marker.hidden || !timeline.clientWidth) return false;
    const labelWidth = window.innerWidth <= 540 ? 96 : 130;
    const visibleTimeWidth = Math.max(0, timeline.clientWidth - labelWidth);
    const markerLeft = parseFloat(marker.style.left);
    // Keep 10% of the visible time grid before the line, outside the fixed labels.
    const target = Math.max(0, markerLeft - labelWidth - visibleTimeWidth * 0.1);
    timeline.scrollLeft = target;
    savedScrollLeft = timeline.scrollLeft;
    syncRuler();
    return true;
  }
  function updateTimeMarker() {
    const marker = $('timeMarker'), label = $('timeMarkerLabel'), dot = $('timeMarkerDot');
    const [start, end] = periods[period];
    const available = timelineClock?.isWeddingDay && timelineClock.minutes >= periods.all[0] && timelineClock.minutes < periods.all[1];
    $('showCurrentTime').disabled = !available;
    $('showCurrentTime').textContent = timelineClock?.preview ? (window.innerWidth <= 540 ? `Preview ${clock(timelineClock.minutes)}` : 'Show preview time') : 'Show now';
    $('showCurrentTime').setAttribute('aria-label', timelineClock?.preview ? `Show preview time ${clock(timelineClock.minutes)} Hong Kong time` : 'Show current time on the timeline');
    if (!marker || !label) return;
    const visible = available && timelineClock.minutes >= start && timelineClock.minutes < end;
    marker.hidden = label.hidden = dot.hidden = !visible;
    if (!visible) return;
    const left = (window.innerWidth <= 540 ? 96 : 130) + (timelineClock.minutes - start) * timelineLayout.scale;
    marker.style.left = `${left}px`;
    dot.style.left = `${left}px`;
    label.style.left = `${left + 6}px`;
    label.textContent = `${timelineClock.preview ? 'Preview' : 'Now'} ${clock(timelineClock.minutes)}`;
    label.setAttribute('aria-label', `${timelineClock.preview ? 'Preview time' : 'Current time'} ${clock(timelineClock.minutes)} Hong Kong time`);
  }
  function renderAgenda(list) {
    const { role } = selected();
    $('agendaView').innerHTML = list.length ? list.map(e => `<button class="agenda-card" data-event="${text(e.id)}"><span class="card-top"><span>${text(range(e))}</span>${e.issues?.length ? '<span class="badge">Check</span>' : ''}</span><h3 lang="zh-Hant">${text(e.title)}</h3><span class="location" lang="zh-Hant">↗ ${text(eventPlace(e, role))}</span><span class="task-preview" lang="zh-Hant">${text(role === 'all' ? e.notes || 'View each team’s instructions →' : instructions(e, role))}</span><span class="card-bottom">View duties &amp; what to bring ↗</span></button>`).join('') : '<p class="empty">No matching moments. Try another team, time, or search.</p>';
  }
  function openEvent(id) {
    const e = events.find(item => item.id === id); if (!e) return;
    const { role } = selected();
    const roleOrder = Object.keys(roles).filter(r => r !== 'overview');
    if (role !== 'all') roleOrder.sort((a, b) => (b === role) - (a === role));
    $('dialogEyebrow').textContent = `${range(e)} · HKT`;
    $('dialogBody').innerHTML = `<h2 id="dialogTitle" lang="zh-Hant">${text(e.title)}</h2><p class="location">↗ ${text(eventPlace(e, role))}</p><p class="source-line">The event location may differ from an individual’s whereabouts. Follow the role instructions below.</p>${(e.issues || []).map(issue => `<p class="notice" style="margin-top:16px">${text(issue)}</p>`).join('')}<h3>Who does what · 各人安排</h3>${roleOrder.filter(r => participates(e, r)).map(r => `<div class="duty"><strong>${roles[r][0]} · ${roles[r][1]}</strong><p class="preline" lang="zh-Hant">${text(instructions(e, r))}</p></div>`).join('') || '<p class="preline">No team instructions entered in the sheet yet.</p>'}${e.notes ? `<h3>Notes &amp; things to bring · 備註 / 物資</h3><p class="preline" lang="zh-Hant">${text(e.notes)}</p>` : ''}<p class="source-line">Source: Rundown · row ${text(e.row)} · ${text(data.snapshotDate)} snapshot.<br>【一人】 / 【兩人】 mean an owner still needs to be assigned. Times are as entered in the workbook. Minimum-width timeline blocks aid tapping and do not imply a longer duration; ◆ marks an event without an end time.</p>`;
    $('details').showModal(); $('details').scrollTop = 0;
  }
  function showReference(key) {
    const titles = { tea: '敬茶 · Tea order', photos: '合照 · Photo order', supplies: '物資 · Packing list' };
    $('dialogEyebrow').textContent = 'From the workbook';
    const rows = data.references?.[key] || [];
    $('dialogBody').innerHTML = `<h2 id="dialogTitle">${titles[key]}</h2><p class="source-line">Source snapshot · ${text(data.snapshotDate)}. Statuses shown are from the sheet.</p>${rows.map(row => `<div class="reference-row" lang="zh-Hant">${text(Array.isArray(row) ? row.map(cell => cell ?? '—').join(' · ') : JSON.stringify(row))}</div>`).join('') || '<p>See the source workbook for this list.</p>'}`;
    $('details').showModal(); $('details').scrollTop = 0;
  }
  const flagged = events.filter(e => e.issues?.length);
  $('issues').innerHTML = flagged.map(e => `<li><button data-event="${text(e.id)}">${text(e.start)} · ${text(e.title.split('\n')[0])}<br>${e.issues.map(text).join('<br>')} ↗</button></li>`).join('') + '<li>Named owners are still needed for duties marked 【一人】 / 【兩人】. Transport seating and several checklist details are also unfinished in the sheet.</li>';
  $('person').addEventListener('change', render);
  $('search').addEventListener('input', render);
  $('timelineButton').addEventListener('click', () => { view = 'timeline'; render(); });
  $('agendaButton').addEventListener('click', () => { view = 'duties'; render(); });
  function jumpToCurrentTime() {
    if ($('showCurrentTime').disabled) return;
    if (timelineClock.minutes < periods[period][0] || timelineClock.minutes >= periods[period][1]) period = 'all';
    // Clear a search that would leave no timeline to locate the time on.
    if (!filtered().length) {
      $('search').value = '';
      $('search').dispatchEvent(new Event('search'));
    }
    view = 'timeline'; render();
    if (positionAtCurrentTime()) initialTimePositionPending = false;
  }
  $('showCurrentTime').addEventListener('click', jumpToCurrentTime);
  function previewTimeChanged() {
    if (view === 'timeline') jumpToCurrentTime();
    else initialTimePositionPending = true;
  }
  $('previewClock').addEventListener('change', previewTimeChanged);
  $('previewTime').addEventListener('input', previewTimeChanged);
  $('previewTime').addEventListener('change', previewTimeChanged);
  document.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
    period = b.dataset.period; render({ resetPosition: true });
    if (!positionAtCurrentTime() && view !== 'timeline') initialTimePositionPending = true;
  }));
  document.addEventListener('click', event => {
    const moment = event.target.closest('[data-event]'); if (moment) openEvent(moment.dataset.event);
    const ref = event.target.closest('[data-reference]'); if (ref) showReference(ref.dataset.reference);
  });
  $('details').querySelector('.close').addEventListener('click', () => $('details').close());
  $('details').addEventListener('click', event => { if (event.target === $('details')) { const rect = $('details').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('details').close(); } });
  function updateRulerTop() {
    const controls = document.querySelector('.controls');
    $('timelineRuler').style.top = `${getComputedStyle(controls).position === 'sticky' ? controls.getBoundingClientRect().height : 0}px`;
  }
  $('timeline').addEventListener('scroll', syncRuler, { passive: true });
  new ResizeObserver(updateRulerTop).observe(document.querySelector('.controls'));
  let resizeFrame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { rememberScroll(); renderTimeline(filtered()); updateRulerTop(); });
  });
  render();
  updateRulerTop();
})();
