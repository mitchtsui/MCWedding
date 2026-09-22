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
  const nowNext = window.WeddingDayNow.create({
    getEvents: () => events.filter(e => selected().role === 'all' || participates(e, selected().role)),
    getRole: () => selected().role,
    getDuty: (event, role) => role === 'all' ? '' : event.duties[role]?.trim() || '',
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
  function render() {
    const list = filtered();
    const { role, person } = selected();
    $('taskScope').textContent = person ? `${person.name} · ${roles[role][0]} team schedule` : role === 'all' ? 'Everyone’s schedule' : `${roles[role][0]} · ${roles[role][1]}`;
    nowNext.update();
    $('roleNote').textContent = roleNote();
    $('resultCount').textContent = `${list.length} moments · ${period === 'all' ? '05:30–23:45' : `${clock(periods[period][0])}–${period === 'evening' ? '23:45' : clock(periods[period][1])}`} HKT · Tap for full instructions`;
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
    const area = $('timelineInner'), [start, end] = periods[period], scale = 2;
    const labelWidth = window.innerWidth <= 540 ? 96 : 130;
    area.style.width = `${labelWidth + (end - start) * scale + 140}px`;
    if (!list.length) { area.style.width = '100%'; area.innerHTML = '<p class="empty">No matching moments. Try another team, time, or search.</p>'; return; }
    let html = '<div class="ruler"><div class="ruler-label">12 NOV · HKT</div>';
    for (let t = Math.ceil(start / 60) * 60; t < end; t += 60) html += `<span class="tick" style="left:${labelWidth + (t - start) * scale}px">${clock(t)}</span>`;
    html += '</div>';
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
        blocks.push(`<button class="event ${lane}${e.issues?.length ? ' flagged' : ''}" data-event="${text(e.id)}" style="left:${labelWidth + left}px;top:${10 + track * 70}px;width:${width}px" aria-label="${text(range(e) + ', ' + roles[lane][0] + ', ' + e.title)}"><small>${text(e.start)}${e.end ? '–' + text(e.end) : ' ◆'}</small><strong lang="zh-Hant">${text(e.title)}</strong></button>`);
      }
      html += `<div class="lane" style="height:${Math.max(1, rowEnds.length) * 70 + 20}px"><div class="lane-label">${roles[lane][0]}<small lang="zh-Hant">${roles[lane][1]}</small></div>${blocks.join('')}</div>`;
    }
    area.innerHTML = html;
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
  document.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { period = b.dataset.period; render(); $('timeline').scrollLeft = 0; }));
  document.addEventListener('click', event => {
    const moment = event.target.closest('[data-event]'); if (moment) openEvent(moment.dataset.event);
    const ref = event.target.closest('[data-reference]'); if (ref) showReference(ref.dataset.reference);
  });
  $('details').querySelector('.close').addEventListener('click', () => $('details').close());
  $('details').addEventListener('click', event => { if (event.target === $('details')) { const rect = $('details').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('details').close(); } });
  let mobile = window.innerWidth <= 540;
  window.addEventListener('resize', () => { const next = window.innerWidth <= 540; if (next !== mobile) { mobile = next; renderTimeline(filtered()); } });
  render();
})();
