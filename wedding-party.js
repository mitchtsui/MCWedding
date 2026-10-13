(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const $ = id => document.getElementById(id);
  let activeTab = 'day', captionInvite = null, captionActive = false, hubLocked = false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validInvite = (event, token) => uuid.test(event || '') && typeof token === 'string' && /^[A-Za-z0-9_+/=-]{20,512}$/.test(token);
  function signIn() {
    if (hubLocked) return;
    hubLocked = true;
    if ($('operatorFrame').getAttribute('src')) $('operatorFrame').contentWindow.postMessage({type:'wedding-hub-session-lock'}, location.origin);
    $('hubReauth').showModal();$('hubReauthPassword').focus();
  }
  async function checkSession() {
    try {
      const response = await fetch('/api/hub-session.js', { credentials:'same-origin', cache:'no-store' });
      const body = await response.json();
      if (!response.ok || !body.data?.authenticated) { signIn(); return false; }
      return true;
    } catch { return false; }
  }
  function load(frame) { if (!frame.getAttribute('src')) frame.src = frame.dataset.src; }
  function writeRoute() {
    const query = captionInvite ? '?' + new URLSearchParams(captionInvite).toString() : '';
    // Keep invite tokens in the fragment, never in server request URLs or storage.
    history.replaceState(null, '', '#' + activeTab + query);
  }
  function activate(name, write = true) {
    activeTab = tabs.some(tab => tab.dataset.tab === name) ? name : 'day';
    tabs.forEach(tab => {
      const selected = tab.dataset.tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
    });
    const frame = $('panel-' + activeTab).querySelector('iframe[data-src]');
    if (activeTab !== 'captions' && frame) load(frame);
    if (write) writeRoute();
  }
  function captionMode(operate) {
    $('watchButton').setAttribute('aria-pressed', String(!operate));
    $('operateButton').setAttribute('aria-pressed', String(operate));
    $('watchPanel').hidden = operate;
    $('operatePanel').hidden = !operate;
    if (operate) load($('operatorFrame'));
  }
  function openInvite(event, token) {
    if (!validInvite(event, token)) return false;
    if (!captionInvite || captionInvite.event !== event || captionInvite.token !== token) {
      captionInvite = {event, token};
      $('viewerFrame').src = 'live-captions.html?' + new URLSearchParams({hub:'1',live:'1',event}) + '#' + new URLSearchParams({token});
    }
    $('captionWelcome').hidden = true;
    $('viewerFrame').hidden = false;
    return true;
  }
  function readRoute() {
    const [name, raw = ''] = location.hash.slice(1).split('?');
    const values = new URLSearchParams(raw);
    openInvite(values.get('event'), values.get('token'));
    activate(name, false);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); tabs[next].focus(); activate(tabs[next].dataset.tab);
    });
  });
  $('watchButton').addEventListener('click', () => captionMode(false));
  $('operateButton').addEventListener('click', () => captionMode(true));
  $('captionLinkForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const url = new URL($('captionLink').value.trim());
      if (url.origin !== location.origin) throw new Error('wrong-origin');
      let values, eventId;
      if (url.pathname.endsWith('/wedding-party.html')) {
        values = new URLSearchParams(url.hash.slice(1).split('?')[1] || ''); eventId = values.get('event');
      } else if (url.pathname.endsWith('/live-captions.html')) {
        values = new URLSearchParams(url.hash.slice(1)); eventId = url.searchParams.get('event');
      } else throw new Error('wrong-page');
      if (!openInvite(eventId, values.get('token'))) throw new Error('invalid');
      $('captionLink').value = ''; $('captionLinkError').textContent = '';
      writeRoute(); $('viewerFrame').focus();
    } catch { $('captionLinkError').textContent = 'Use the complete caption viewing link shared from this wedding website.'; }
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('operatorFrame').contentWindow) return;
    if (event.data?.type === 'wedding-hub-caption-state' && typeof event.data.active === 'boolean') {
      captionActive = event.data.active;
      $('captionSession').hidden = !captionActive;
      $('hubLogout').disabled = captionActive;
      $('hubLogout').title = captionActive ? 'End the caption session before logging out of the hub.' : '';
    }
    if (event.data?.type === 'wedding-hub-caption-invite' && openInvite(event.data.eventId, event.data.token)) writeRoute();
    if (event.data?.type === 'wedding-hub-session-expired') signIn();
  });
  window.addEventListener('beforeunload', event => { if (captionActive) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('hashchange', readRoute);
  $('hubReauth').addEventListener('cancel',event=>event.preventDefault());
  $('hubReauthForm').addEventListener('submit',async event=>{
    event.preventDefault();$('hubReauthButton').disabled=true;
    try{
      const response=await fetch('/api/hub-session.js',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',password:$('hubReauthPassword').value})});
      const result=await response.json();
      if(!response.ok||!result.data?.authenticated)throw new Error(response.status===401?'That password isn’t right. Please try again.':'Unable to unlock the hub. Please try again later.');
      $('hubReauthPassword').value='';$('hubReauthStatus').textContent='';hubLocked=false;$('hubReauth').close();
      readRoute();
      if($('operatorFrame').getAttribute('src'))$('operatorFrame').contentWindow.postMessage({type:'wedding-hub-session-restored'},location.origin);
    }catch(error){$('hubReauthPassword').value='';$('hubReauthStatus').textContent=error.message;}
    finally{$('hubReauthButton').disabled=false;}
  });
  $('hubLogout').addEventListener('click', async () => {
    if (captionActive) return;
    $('hubLogout').disabled = true;
    try {
      // Server logout atomically clears both the hub and caption operator cookies.
      const response = await fetch('/api/hub-session.js', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
      if (!response.ok) throw new Error('Sign-out failed');
      location.replace('/wedding-party-login.html');
    } catch { $('hubLogout').textContent='Retry logout';$('hubLogout').disabled=false; }
  });
  checkSession().then(ok => { if(ok)readRoute();else signIn(); });
  setInterval(checkSession, 60000);
})();
