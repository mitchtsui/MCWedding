// Shared read-only pages retain their direct links while fitting the party hub.
(() => {
  if (new URLSearchParams(location.search).get('hub') !== '1') return;
  document.documentElement.classList.add('hub-embedded');
  const style = document.createElement('style');
  style.textContent = '.hub-embedded .topbar{display:none!important}.hub-embedded footer a[href="admin.html"]{display:none!important}.hub-embedded .hero{padding-top:26px}.hub-embedded main{padding-top:20px}.hub-embedded .page-intro{padding-top:24px}.hub-embedded main>.hero{display:block;padding:8px 0 20px}.hub-embedded main>.hero h1{font-size:clamp(38px,5vw,64px);line-height:1.05}.hub-embedded main>.hero .intro{display:none}.hub-embedded .directory{padding-top:12px}.hub-embedded .directory .controls{margin-bottom:20px}.hub-embedded .row-hint{margin-bottom:14px}@media(max-width:600px){.hub-embedded .hero{padding-top:20px}.hub-embedded main{padding-top:16px}.hub-embedded main>.hero h1 .zh{display:inline-block;margin:0 0 0 .15em}.hub-embedded .section-head{margin-bottom:16px}}';
  document.head.appendChild(style);
})();
