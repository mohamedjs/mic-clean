// Install as an app (Chrome / Edge on Ubuntu & macOS) + "server is off" notice.
(() => {
  'use strict';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.id = 'pwaInstall'; btn.textContent = '⬇ ثبّت كتطبيق'; btn.style.display = 'none';
  btn.title = 'يثبّت الداشبورد كأبلكيشن ليه أيقونة وشباك لوحده';
  const place = () => { const h = document.querySelector('header'); if (!h) return; const ref = document.getElementById('refreshBtn') || h.lastElementChild; h.insertBefore(btn, ref); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.style.display = ''; });
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; btn.style.display = 'none'; return; }
    alert('عشان تثبّته: افتح الداشبورد في Google Chrome ← القائمة ⋮ ← «Cast, save and share» ← «Install page as app».');
  };
  addEventListener('appinstalled', () => { btn.style.display = 'none'; });
  // show the manual hint on browsers without the install prompt (e.g. Safari) — only when not installed already
  setTimeout(() => { if (!deferred && !standalone && !/Chrome|Edg/.test(navigator.userAgent)) { btn.style.display = ''; } }, 3000);

  // If the local server is not running, say so clearly instead of a broken page
  let down = false;
  setInterval(async () => {
    try { const r = await fetch('/api/status', { cache: 'no-store' }); if (!r.ok) throw 0; if (down) location.reload(); }
    catch {
      if (down) return; down = true;
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:50;padding:14px 18px;border-radius:18px;background:#ffd9df;color:#7a1027;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.2)';
      bar.innerHTML = '⚠ السيرفر المحلي واقف. على أوبونتو: <code>systemctl --user start mic-mohamed</code> · على الماك: <code>launchctl kickstart -k gui/$(id -u)/com.mohamed.mic</code> (أو <code>node server.js</code> في الفولدر). الصفحة هترجع لوحدها أول ما يشتغل.';
      document.body.appendChild(bar);
    }
  }, 5000);
})();
