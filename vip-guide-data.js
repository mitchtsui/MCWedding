// Personal names and photographs are returned only to an authenticated hub session.
window.VIP_READY = fetch('/api/vip-assets.js?asset=data', {credentials:'same-origin',cache:'no-store'})
  .then(response => { if(!response.ok)throw new Error('Family guide unavailable');return response.json(); })
  .then(data => {window.VIP_PEOPLE=data.people;window.VIP_ROWS=data.rows;})
  .catch(() => {window.VIP_PEOPLE=null;});
