// Real EPUB.js integration against mocked native IPC, without launching Ghost.
// Run: node scripts/check-epub-reader.mjs [chromium|webkit]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium, webkit } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const csp = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { EpubViewer } from '/src/components/viewer/epub-viewer.tsx';
import '/src/styles/globals.css';
const urls = new Set();
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
window.liveEpubUrls = urls;
mockConvertFileSrc();
mockIPC(async (command, args) => {
  if (command === 'prepare_media_asset') return { canonical_path: args.path, size_bytes: 6000, modified_ms: 1 };
  if (command === 'read_epub') return fetch('/example%20test%20files/' + args.path.split('/').pop()).then(r => r.arrayBuffer());
  throw new Error('Unexpected IPC: ' + command);
}, { shouldMockEvents: true });
const host = document.getElementById('root');
const app = createRoot(host);
window.openBook = (name = 'epub-reader.epub') => app.render(React.createElement(EpubViewer, { key: name, filePath: '/books/' + name }));
window.closeBook = () => app.render(null);
window.openBook();
`;
const server = await createServer({
  root, configFile: false, cacheDir: '/tmp/ghost-epub-check-vite',
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/mocks', 'lucide-react', 'epubjs'] },
  resolve: { alias: { '@': path.join(root, 'src') } },
  esbuild: { jsx: 'automatic' },
  plugins: [tailwindcss(), {
    name: 'epub-check-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/epub-script-probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('parent.__epubScriptRan = true'); return; }
        if (req.url !== '/epub-check') return next();
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Security-Policy', csp);
        res.end('<!doctype html><html><head><title>EPUB reader check</title></head><body><div id="root" style="height:100vh"></div><script type="module" src="/epub-check-entry.jsx"></script></body></html>');
      });
    },
    resolveId(id) { if (id === '/epub-check-entry.jsx') return id; },
    load(id) { if (id === '/epub-check-entry.jsx') return entry; },
  }],
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await (process.argv[2] === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.argv[2] === 'webkit' ? {} : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') { const text = message.text(); if (!text.includes("Blocked script execution in 'about:srcdoc'") && !text.includes('404')) console.error(text); } });
  await page.goto(`http://127.0.0.1:${address.port}/epub-check`);
  const contents = page.getByRole('combobox', { name: 'Table of contents' });
  await contents.waitFor();
  await page.waitForFunction(() => !document.querySelector('select').disabled, { timeout: 25000 });
  assert.equal(await contents.locator('option').count(), 3);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'A quiet beginning' }).waitFor();
  assert.equal(await frame.getByAltText('Moon over the hills').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-same-origin allow-scripts');
  assert.equal(await frame.locator('h1').evaluate(h => getComputedStyle(h).fontWeight), '400');
  const bookmark = () => page.evaluate(() => JSON.parse(localStorage.getItem('ghost:epub:/books/epub-reader.epub')));
  const waitMoved = async (previous) => page.waitForFunction(cfi => {
    const saved = JSON.parse(localStorage.getItem('ghost:epub:/books/epub-reader.epub'));
    return saved?.cfi && saved.cfi !== cfi && !document.querySelector('select').disabled;
  }, previous?.cfi);
  for (const input of ['buttons', 'keyboard']) {
    await contents.selectOption('Text/one.xhtml');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ghost:epub:/books/epub-reader.epub'))?.href === 'Text/one.xhtml');
    if (input === 'keyboard') await frame.getByRole('heading', { name: 'A quiet beginning' }).click();
    for (let step = 0; step < 20; step++) {
      const previous = await bookmark();
      if (previous.href === 'Text/two.xhtml') break;
      if (input === 'keyboard') await page.keyboard.press('ArrowRight');
      else await page.getByRole('button', { name: 'Next page' }).click();
      await waitMoved(previous);
    }
    assert.equal((await bookmark()).href, 'Text/two.xhtml');
    for (const [key, button, expected] of [
      ['ArrowLeft', 'Previous page', 'Text/one.xhtml'],
      ['ArrowRight', 'Next page', 'Text/two.xhtml'],
    ]) {
      const previous = await bookmark();
      if (input === 'keyboard') await page.keyboard.press(key);
      else await page.getByRole('button', { name: button }).click();
      await waitMoved(previous);
      assert.equal((await bookmark()).href, expected);
    }
  }
  console.log('Repeated chapter crossings passed for buttons and keyboard.');
  await contents.selectOption('Text/one.xhtml');
  await frame.getByRole('heading', { name: 'A quiet beginning' }).waitFor();
  for (const [foreground, background] of [['#e8e6e2', '#121518'], ['#242526', '#faf6ed']]) {
    await page.evaluate(([fg, bg]) => {
      document.documentElement.style.setProperty('--foreground', fg);
      document.documentElement.style.setProperty('--background', bg);
    }, [foreground, background]);
    await page.waitForFunction(([fg, bg]) => {
      const doc = document.querySelector('iframe').contentDocument;
      const color = document.createElement('span');
      color.style.color = fg; color.style.backgroundColor = bg;
      return getComputedStyle(doc.querySelector('p')).color === color.style.color
        && getComputedStyle(doc.body).backgroundColor === color.style.backgroundColor;
    }, [foreground, background]);
    assert.equal(await frame.locator('p').first().evaluate(p => getComputedStyle(p).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  // Even with Ghost's event listeners enabled, book script execution is blocked.
  await frame.locator('body').evaluate(body => {
    const script = body.ownerDocument.createElement('script');
    script.textContent = 'parent.__epubScriptRan = true';
    body.append(script);
    body.setAttribute('onclick', 'parent.__epubScriptRan = true');
    body.click();
  });
  await frame.locator('body').evaluate(body => new Promise(resolve => {
    const script = body.ownerDocument.createElement('script');
    script.src = '/epub-script-probe.js';
    script.onload = script.onerror = () => resolve();
    body.append(script);
  }));
  assert.equal(await page.evaluate(() => window.__epubScriptRan), undefined);
  await page.screenshot({ path: '/tmp/ghost-epub-reader-light.png' });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--foreground', '#e8e6e2');
    document.documentElement.style.setProperty('--background', '#121518');
  });
  await page.screenshot({ path: '/tmp/ghost-epub-reader.png' });
  await frame.getByRole('link', { name: 'Skip to the next morning' }).click();
  await frame.getByRole('heading', { name: 'The next morning' }).waitFor();
  await page.getByRole('button', { name: 'Larger text' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ghost:epub:/books/epub-reader.epub')).fontSize === 110);
  await page.evaluate(() => window.closeBook());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0 && window.liveEpubUrls.size === 0);
  await page.evaluate(() => window.openBook());
  await frame.getByRole('heading', { name: 'The next morning' }).waitFor();
  assert.match(await page.locator('#root').innerText(), /110%/);
  await contents.selectOption('Text/one.xhtml');
  await frame.getByRole('heading', { name: 'A quiet beginning' }).waitFor();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ghost:epub:/books/epub-reader.epub')).cfi.includes('epubcfi('));
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForFunction(() => {
    const f = document.querySelector('iframe');
    if (!f?.contentDocument?.body || parseFloat(getComputedStyle(f.contentDocument.body).columnWidth) > 375) return false;
    const frame = f.getBoundingClientRect();
    return [...f.contentDocument.querySelectorAll('p')].some(p => {
      const rect = p.getBoundingClientRect();
      return rect.right + frame.left > 30 && rect.left + frame.left < 345
        && rect.bottom + frame.top > 140 && rect.top + frame.top < 570;
    });
  });
  await page.screenshot({ path: '/tmp/ghost-epub-reader-narrow.png' });
  await page.evaluate(() => window.openBook('epub-reader-legacy.epub'));
  await page.waitForFunction(() => document.querySelector('[data-epub-path]')?.dataset.epubPath.endsWith('epub-reader-legacy.epub') && !document.querySelector('select').disabled);
  assert.equal(await contents.locator('option').count(), 3);
  await contents.selectOption('Text/two.xhtml');
  await frame.getByRole('heading', { name: 'The next morning' }).waitFor();
  await page.evaluate(() => window.closeBook());
  await page.waitForFunction(() => window.liveEpubUrls.size === 0);
  assert.deepEqual(errors, []);
  console.log('EPUB 2/3 rendering, image/CSS loading, chapter links, arrow keys across chapters, navigation, reading position, font size, light/dark colors, script blocking, resize, and URL cleanup passed.');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { console.error(await page.locator('#root').innerText()); console.error(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => ({ style: f.style.cssText, text: f.contentDocument?.body?.innerText.slice(0, 300), parent: f.parentElement.style.cssText })))); await page.screenshot({ path: '/tmp/ghost-epub-failure.png' }); }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
