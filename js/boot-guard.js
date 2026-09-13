/**
 * Boot guard — the one script that is NOT an ES module.
 *
 * Scrubs is delivered as ES modules, which browsers refuse to load over
 * `file://` (the origin is `null`, so the module fetch is blocked by CORS).
 * Opening index.html by double-clicking it therefore leaves the page stuck on
 * its loading state with nothing in the UI to explain why — and the only code
 * that can explain it is code that still runs in that situation. A classic
 * script does; a module does not. Hence this file.
 *
 * It handles three failure modes:
 *   1. the page was opened from the filesystem;
 *   2. the entry module failed to load (404, syntax error, blocked by an extension);
 *   3. the entry module loaded but never finished booting.
 */
(function () {
  'use strict';

  var BOOT_TIMEOUT_MS = 10000;
  var panel = document.getElementById('app-boot');
  if (!panel) return;

  var settled = false;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char];
    });
  }

  /**
   * Replace the loading state with an explanation.
   * Inline styles are used deliberately: this has to stay legible even if the
   * stylesheet is the thing that failed.
   */
  function fail(title, bodyHtml) {
    if (settled) return;
    settled = true;
    panel.innerHTML = [
      '<div role="alert" style="max-width:46rem;margin:0 auto;padding:24px;',
      'font:15px/1.6 system-ui,-apple-system,\'Segoe UI\',sans-serif;',
      'color:#11201d;background:#fff;border:1px solid #cdd6d3;border-radius:14px;text-align:left">',
      '<h1 style="margin:0 0 8px;font-size:19px;letter-spacing:-.015em">', escapeHtml(title), '</h1>',
      bodyHtml,
      '</div>',
    ].join('');
    panel.style.background = '#f4f6f5';
    panel.style.padding = '24px';
    panel.style.alignContent = 'center';
  }

  var CODE_STYLE = 'display:block;margin:12px 0;padding:12px 14px;background:#11201d;color:#eaf0ee;'
    + 'border-radius:8px;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto';
  var LINK_STYLE = 'color:#08544a';

  if (window.location.protocol === 'file:') {
    fail('Scrubs needs to be served over http, not opened as a file', [
      '<p style="margin:0 0 12px">You have opened this page directly from the filesystem. ',
      'Browsers block JavaScript modules on <code>file://</code> URLs, and Google sign-in ',
      'will not work there either — it requires a real origin.</p>',
      '<p style="margin:0">Run any static web server from the project folder and open the ',
      'address it prints:</p>',
      '<code style="', CODE_STYLE, '">cd ', escapeHtml(directoryOf(window.location.pathname)), '\n',
      'python3 -m http.server 8000\n\n',
      '# then open http://localhost:8000</code>',
      '<p style="margin:0;color:#4c5a57;font-size:13px">Any equivalent works: <code>npx serve</code>, ',
      '<code>php -S localhost:8000</code>, or the “Live Server” extension in VS&nbsp;Code. ',
      'See <a href="docs/SETUP.md" style="', LINK_STYLE, '">docs/SETUP.md</a>.</p>',
    ].join(''));
    return;
  }

  function directoryOf(pathname) {
    var decoded = decodeURIComponent(pathname);
    // Strip the filename, and the /dev/ subdirectory if this is the preview page.
    return decoded.replace(/\/[^/]*$/, '').replace(/\/dev$/, '') || '/';
  }

  // The entry module failing outright — 404, syntax error, blocked by an extension.
  document.addEventListener('error', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'SCRIPT' || target.type !== 'module') return;
    fail('Scrubs could not start', [
      '<p style="margin:0 0 12px">The application script failed to load:</p>',
      '<code style="', CODE_STYLE, '">', escapeHtml(target.src), '</code>',
      '<p style="margin:0;color:#4c5a57;font-size:13px">Check that the whole project folder was ',
      'copied to the server, and that no browser extension is blocking scripts.</p>',
    ].join(''));
  }, true);

  // Loaded but never finished — usually a runtime error during boot.
  window.setTimeout(function () {
    if (!document.body.contains(panel)) return;
    fail('Scrubs is taking longer than expected to start', [
      '<p style="margin:0 0 12px">The application loaded but has not finished starting. ',
      'The browser console usually says why.</p>',
      '<p style="margin:0;color:#4c5a57;font-size:13px">Open developer tools ',
      '(<kbd>⌥⌘I</kbd> on macOS, <kbd>F12</kbd> on Windows) and look at the Console tab, ',
      'then reload.</p>',
    ].join(''));
  }, BOOT_TIMEOUT_MS);

  // main.js removes the loading panel once it is running; that also cancels the
  // watchdog above, since it checks whether the panel is still in the document.
}());
