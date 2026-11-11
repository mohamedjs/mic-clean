// Browser use only: "install as an app" in Chrome / Edge, and a notice when the
// local server is off. Inside the desktop app (Electron) neither is needed.
(() => {
  'use strict';
  const desktop = /Electron/.test(navigator.userAgent);
  if (!desktop && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (desktop) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.id = 'pwaInstall'; btn.textContent = '⬇ ثبّت كتطبيق'; btn.style.display = 'none';
  btn.title = 'يثبّت الصفحة كأبلكيشن ليه أيقونة وشباك لوحده';
  const place = () => { const h = document.querySelector('header'); if (!h) return; const ref = document.getElementById('refreshBtn') || h.lastElementChild; h.insertBefore(btn, ref); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.style.display = ''; });
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; btn.style.display = 'none'; return; }
    alert('عشان تثبّته: افتح الصفحة في Google Chrome ← القائمة ⋮ ← «Cast, save and share» ← «Install page as app». أو نزّل الأبلكيشن من mohamedjs.github.io/mic-clean');
  };
  addEventListener('appinstalled', () => { btn.style.display = 'none'; });
  setTimeout(() => { if (!deferred && !standalone && !/Chrome|Edg/.test(navigator.userAgent)) { btn.style.display = ''; } }, 3000);

  // If the local server is not running, say so clearly instead of a broken page
  let down = false;
  setInterval(async () => {
    try { const r = await fetch('/api/app', { cache: 'no-store' }); if (!r.ok) throw 0; if (down) location.reload(); }
    catch {
      if (down) return; down = true;
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:50;padding:14px 18px;border-radius:18px;background:#ffd9df;color:#7a1027;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.2)';
      bar.innerHTML = '⚠ Mic Clean مقفول. افتح الأبلكيشن تاني (أو <code>node server.js</code> في الفولدر). الصفحة هترجع لوحدها أول ما يشتغل.';
      document.body.appendChild(bar);
    }
  }, 5000);
})();
