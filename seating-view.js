'use strict';

const SeatingView = (() => {
  const TABLES = [
    { number: 9, area: 'room', column: 1, row: 2 },
    { number: 10, area: 'room', column: 1, row: 3 },
    { number: 6, area: 'room', column: 2, row: 3 },
    { number: 3, area: 'room', column: 4, row: 3 },
    { number: 7, area: 'room', column: 5, row: 3 },
    { number: 8, area: 'room', column: 1, row: 4 },
    { number: 2, area: 'room', column: 2, row: 4 },
    { number: 1, area: 'room', column: 4, row: 4 },
    { number: 5, area: 'room', column: 5, row: 4 },
    { number: 11, area: 'foyer', column: 2, row: 7 },
    { number: 13, area: 'foyer', column: 4, row: 7 },
    { number: 12, area: 'foyer', column: 2, row: 8 },
    { number: 15, area: 'foyer', column: 4, row: 8 }
  ];

  const TABLE_NUMBERS = new Set(TABLES.map(table => table.number));

  function normaliseGuest(row) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || !Number.isInteger(row.table_number)) return null;
    return { name: row.name.trim(), table_number: row.table_number };
  }

  function normaliseSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('en');
  }

  function searchGuests(guests, value) {
    const query = normaliseSearch(value);
    if (!query) return [];
    const tableQuery = query.replace(/^table\s*/i, '').trim();
    return guests.filter(guest =>
      guest.name.toLocaleLowerCase('en').includes(query) ||
      (tableQuery && String(guest.table_number) === tableQuery)
    );
  }

  function buildViewModel(rows) {
    const guests = Array.isArray(rows) ? rows.map(normaliseGuest).filter(Boolean) : [];
    const byTable = new Map(TABLES.map(table => [table.number, []]));
    const outsidePlan = [];
    for (const guest of guests) {
      if (TABLE_NUMBERS.has(guest.table_number)) byTable.get(guest.table_number).push(guest);
      else outsidePlan.push(guest);
    }
    return { guests, byTable, outsidePlan };
  }

  async function fetchGuests(fetchImpl = globalThis.fetch) {
    const response = await fetchImpl('/api/seating-view', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.guests)) {
      throw new Error('Unable to load the seating plan');
    }
    return payload.guests.map(normaliseGuest).filter(Boolean);
  }

  function init(doc = document, locationLike = window.location, fetchImpl = window.fetch.bind(window)) {
    const params = new URLSearchParams(locationLike.search || '');
    if (params.get('hub') === '1') doc.body.classList.add('hub-mode');

    const status = doc.getElementById('status');
    const app = doc.getElementById('seating-app');
    const errorActions = doc.getElementById('error-actions');
    const retryButton = doc.getElementById('retry-button');
    const search = doc.getElementById('guest-search');
    const panelEyebrow = doc.getElementById('panel-eyebrow');
    const panelTitle = doc.getElementById('panel-title');
    const results = doc.getElementById('guest-results');
    const roomLayer = doc.getElementById('room-tables');
    const foyerLayer = doc.getElementById('foyer-tables');
    let model = buildViewModel([]);
    let selectedTable = 1;

    function tableButton(table) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'table-button';
      button.dataset.table = String(table.number);
      button.style.gridColumn = String(table.column);
      button.style.gridRow = String(table.row);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectTable(table.number));
      return button;
    }

    const buttons = new Map();
    for (const table of TABLES) {
      const button = tableButton(table);
      buttons.set(table.number, button);
      (table.area === 'room' ? roomLayer : foyerLayer).appendChild(button);
    }

    function updateButtons(matches = []) {
      const matchingTables = new Set(matches.map(guest => guest.table_number));
      for (const table of TABLES) {
        const count = model.byTable.get(table.number).length;
        const button = buttons.get(table.number);
        button.innerHTML = `<span class="table-number">Table ${table.number}</span><span class="table-count">${count} ${count === 1 ? 'guest' : 'guests'}</span>`;
        button.setAttribute('aria-label', `Table ${table.number}, ${count} ${count === 1 ? 'guest' : 'guests'}`);
        button.setAttribute('aria-pressed', String(table.number === selectedTable));
        button.classList.toggle('search-match', matchingTables.has(table.number));
      }
    }

    function renderTable(number) {
      const tableGuests = model.byTable.get(number) || [];
      panelEyebrow.textContent = 'Selected table';
      panelTitle.textContent = `Table ${number}`;
      results.replaceChildren();
      if (!tableGuests.length) {
        const empty = doc.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = 'No one is currently assigned to this table.';
        results.appendChild(empty);
        return;
      }
      const list = doc.createElement('ul');
      list.className = 'guest-list';
      for (const guest of tableGuests) {
        const item = doc.createElement('li');
        item.textContent = guest.name;
        list.appendChild(item);
      }
      results.appendChild(list);
    }

    function selectTable(number) {
      selectedTable = number;
      search.value = '';
      updateButtons();
      renderTable(number);
    }

    function renderSearch(value) {
      const query = normaliseSearch(value);
      if (!query) {
        updateButtons();
        renderTable(selectedTable);
        return;
      }
      const matches = searchGuests(model.guests, value);
      updateButtons(matches);
      panelEyebrow.textContent = 'Search results';
      panelTitle.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : 'No matches';
      results.replaceChildren();
      if (!matches.length) {
        const empty = doc.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = 'No assigned guest matches that search.';
        results.appendChild(empty);
        return;
      }
      for (const guest of matches) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        const name = doc.createElement('span');
        name.textContent = guest.name;
        const table = doc.createElement('span');
        table.textContent = `Table ${guest.table_number}`;
        button.append(name, table);
        button.addEventListener('click', () => selectTable(guest.table_number));
        results.appendChild(button);
      }
    }

    async function load() {
      status.hidden = false;
      status.textContent = 'Loading seating plan…';
      app.hidden = true;
      errorActions.hidden = true;
      try {
        model = buildViewModel(await fetchGuests(fetchImpl));
        const firstOccupied = TABLES.find(table => model.byTable.get(table.number).length);
        selectedTable = firstOccupied ? firstOccupied.number : 1;
        updateButtons();
        renderTable(selectedTable);
        status.hidden = true;
        app.hidden = false;
      } catch (error) {
        status.textContent = 'The seating plan could not be loaded. Please try again.';
        errorActions.hidden = false;
      }
    }

    search.addEventListener('input', event => renderSearch(event.target.value));
    retryButton.addEventListener('click', load);
    load();
    return { load, renderSearch, selectTable };
  }

  return { TABLES, buildViewModel, fetchGuests, init, normaliseGuest, searchGuests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SeatingView;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SeatingView.init());
  else SeatingView.init();
}
