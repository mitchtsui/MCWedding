(async function () {
  'use strict';

  await window.VIP_READY;

  const people = Array.isArray(window.VIP_PEOPLE) ? window.VIP_PEOPLE : null;
  const searchInput = document.getElementById('vipSearch');
  const clearSearch = document.getElementById('clearSearch');
  const resultCount = document.getElementById('resultCount');
  const familySections = document.getElementById('familySections');
  const noResults = document.getElementById('noResults');
  const loadError = document.getElementById('loadError');
  const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const sections = {
    christy: {
      section: document.getElementById('christyFamily'),
      grid: document.getElementById('christyPeople'),
      count: document.getElementById('christyCount')
    },
    mitchell: {
      section: document.getElementById('mitchellFamily'),
      grid: document.getElementById('mitchellPeople'),
      count: document.getElementById('mitchellCount')
    }
  };

  let activeFilter = 'all';

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase();
  }

  function initialsFor(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return '·';

    const words = cleanName.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.slice(0, 2).map(function (word) { return word.charAt(0); }).join('').toLocaleUpperCase();
    }
    return Array.from(cleanName).slice(0, 2).join('').toLocaleUpperCase();
  }

  function validPhotoPath(photo) {
    const path = String(photo || '').trim();
    return /^\/api\/vip-assets\.js\?asset=[a-zA-Z0-9_-]+\.jpg$/.test(path) ? path : '';
  }

  function createPersonCard(person) {
    const card = document.createElement('article');
    card.className = 'person-card';

    const portrait = document.createElement('div');
    portrait.className = 'portrait';

    const placeholder = document.createElement('span');
    placeholder.className = 'portrait-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = initialsFor(person.name);
    portrait.appendChild(placeholder);

    const photoPath = validPhotoPath(person.photo);
    if (photoPath) {
      const image = document.createElement('img');
      image.src = photoPath;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('load', function () {
        placeholder.hidden = true;
      });
      image.addEventListener('error', function () {
        image.hidden = true;
        placeholder.hidden = false;
      });
      portrait.appendChild(image);
    }

    const name = document.createElement('h3');
    name.textContent = String(person.name || '');

    const relationship = document.createElement('p');
    relationship.className = 'relationship';
    relationship.textContent = String(person.relationship || '');

    card.append(portrait, name, relationship);
    return card;
  }

  function updateDirectory() {
    const query = normalize(searchInput.value.trim());
    const visibleByFamily = { christy: [], mitchell: [] };

    people.forEach(function (person) {
      if (!person || !Object.prototype.hasOwnProperty.call(sections, person.family)) return;
      if (activeFilter !== 'all' && person.family !== activeFilter) return;

      const searchText = normalize(person.name) + ' ' + normalize(person.relationship);
      if (query && !searchText.includes(query)) return;
      visibleByFamily[person.family].push(person);
    });

    let visibleTotal = 0;
    Object.keys(sections).forEach(function (family) {
      const items = visibleByFamily[family];
      const target = sections[family];
      target.grid.replaceChildren();

      const fragment = document.createDocumentFragment();
      const remaining = new Map(items.map(person => [person.id, person]));
      const rows = Array.isArray(window.VIP_ROWS) ? window.VIP_ROWS.filter(row => row.family === family) : [];
      function appendRow(rowItems, breakBefore) {
        if (!rowItems.length) return;
        const row = document.createElement('div');
        row.className = 'family-row' + (breakBefore && !query ? ' family-row-break' : '');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', rowItems.map(person => person.name).join(', '));
        row.tabIndex = 0;
        rowItems.forEach(person => row.appendChild(createPersonCard(person)));
        fragment.appendChild(row);
      }
      rows.forEach(function (row) {
        const rowItems = row.ids.map(id => remaining.get(id)).filter(Boolean);
        row.ids.forEach(id => remaining.delete(id));
        appendRow(rowItems, row.breakBefore);
      });
      appendRow([...remaining.values()], false);
      target.grid.appendChild(fragment);

      target.count.textContent = String(items.length).padStart(2, '0');
      target.section.hidden = items.length === 0;
      visibleTotal += items.length;
    });

    resultCount.textContent = visibleTotal + (visibleTotal === 1 ? ' person' : ' people') + ' · ' + visibleTotal + ' 位';
    familySections.hidden = visibleTotal === 0;
    noResults.hidden = visibleTotal !== 0;
    clearSearch.hidden = query.length === 0;
  }

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });
    updateDirectory();
  }

  if (!people) {
    familySections.hidden = true;
    resultCount.hidden = true;
    loadError.hidden = false;
    searchInput.disabled = true;
    filterButtons.forEach(function (button) { button.disabled = true; });
    return;
  }

  searchInput.addEventListener('input', updateDirectory);
  clearSearch.addEventListener('click', function () {
    searchInput.value = '';
    searchInput.focus();
    updateDirectory();
  });
  filterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setFilter(button.dataset.filter);
    });
  });

  updateDirectory();
}());
