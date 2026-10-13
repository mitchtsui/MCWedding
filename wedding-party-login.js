(() => {
  'use strict';
  const form = document.getElementById('hubLoginForm'), input = document.getElementById('hubPassword');
  const button = document.getElementById('hubLoginButton'), status = document.getElementById('hubLoginStatus');
  function destination() {
    const raw = new URLSearchParams(location.search).get('return') || '/wedding-party.html';
    const allowed = /^\/(?:wedding-party|wedding-day|vip-guide|seating-view|live-captions-admin)(?:\.html)?(?:\?[^#]*)?$/;
    return (allowed.test(raw) ? raw : '/wedding-party.html') + location.hash;
  }
  async function request(body) {
    const response = await fetch('/api/hub-session.js', { method: 'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(response.status === 401 ? 'That password isn’t right. Please try again.' : response.status === 429 ? 'Too many attempts. Please wait and try again later.' : 'The hub is unavailable right now. Please try again later.');
    return result.data;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();button.disabled=true;status.textContent='Opening the hub…';
    try { const session=await request({action:'login',password:input.value});if(!session.authenticated)throw new Error('Please try signing in again.');input.value='';location.replace(destination()); }
    catch(error){status.textContent=error.message;input.value='';input.focus();}
    finally{button.disabled=false;}
  });
})();
