// Real Foliate and comic rendering, with mocked native IPC; never starts Tauri.
// Run: node scripts/check-ebook-reader.mjs [chromium|webkit]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { chromium, webkit } from '@playwright/test';
const root = path.resolve(import.meta.dirname, '..');
const samples = new Map(['alice-gutenberg.mobi','alice-gutenberg.azw3','ebook-reader.fb2','comic-reader.cbz'].map(name => [name,path.join(root,'example test files',name)]));
const comicPath = process.env.GHOST_COMIC_SAMPLE || samples.get('comic-reader.cbz');
const names = execFileSync('/usr/bin/tar',['-tf',comicPath],{encoding:'utf8'}).trim().split('\n').filter(name => /\.(png|jpe?g|webp)$/i.test(name));
const artifacts = new Map();
// Materialize three representative pages in the harness only. Production uses
// Ghost's bounded native cache and image inspection, covered by Rust tests.
for (const [index,name] of names.slice(0,3).entries()) artifacts.set(String(index),execFileSync('/usr/bin/tar',['-xOf',comicPath,name],{maxBuffer:32*1024*1024}));
const comicManifest = {archive_size_bytes:fs.statSync(comicPath).size,modified_ms:1,entry_count:3,total_uncompressed_bytes:1000,entries:names.slice(0,3).map((name,index)=>({path:name,kind:'file',size_bytes:artifacts.get(String(index)).length,modified_ms:1,link_target:null}))};
const csp = JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8')).app.security.csp;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { EbookViewer } from '/src/components/viewer/ebook-viewer.tsx';
import { ComicViewer } from '/src/components/viewer/comic-viewer.tsx';
import '/src/styles/globals.css';
const urls = new Set();
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
window.liveBookUrls = urls;
window.heldComicPages = new Set();
mockConvertFileSrc();
window.__TAURI_INTERNALS__.convertFileSrc = path => path;
const manifest = await fetch('/comic-manifest').then(r=>r.json());
mockIPC(async (command, args) => {
  if (command === 'prepare_media_asset') return {canonical_path:args.path,size_bytes:6000,modified_ms:1};
  if (command === 'read_ebook' && window.pauseBookRead) { window.bookReadPending = true; await new Promise(resolve => {window.resumeBookRead = resolve}); }
  if (command === 'read_ebook') return fetch('/samples/'+encodeURIComponent(args.path.split('/').pop())).then(r=>r.arrayBuffer());
  if (command === 'list_archive') return manifest;
  if (command === 'materialize_archive_entry') {
    const token = String(manifest.entries.findIndex(entry=>entry.path===args.entryPath));
    window.heldComicPages.add(token);
    return {token,path:'/comic-entry/'+token,display_name:args.entryPath,mime_type:'image/png',size_bytes:1000};
  }
  if (command === 'release_archive_preview') { window.heldComicPages.delete(args.token); return; }
  if (command === 'cancel_archive_preview') return;
  if (command === 'inspect_image') return {width:100,height:160,needs_thumbnail:false};
  throw new Error('Unexpected IPC: '+command);
}, {shouldMockEvents:true});
const app = createRoot(document.getElementById('root'));
window.openBook = name => app.render(React.createElement(name.endsWith('.cbz') || name.endsWith('.cbr') ? ComicViewer : EbookViewer,{key:name,filePath:'/books/'+name}));
window.closeBook = () => app.render(null);
window.openBook('ebook-reader.fb2');
`;
const server = await createServer({
  root, configFile: false, cacheDir: '/tmp/ghost-ebook-check-vite',
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/mocks', 'lucide-react', 'epubjs'] },
  resolve: { alias: { '@': path.join(root, 'src') } },
  esbuild: { jsx: 'automatic' },
  plugins: [tailwindcss(), {
    name: 'epub-check-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/samples/')) { const name = decodeURIComponent(req.url.slice(9)); const file = samples.get(name); if (!file) { res.statusCode = 404; res.end(); return; } res.end(fs.readFileSync(file)); return; }
        if (req.url?.startsWith('/comic-entry/')) { const token = req.url.slice(13); const bytes = artifacts.get(token); if (!bytes) { res.statusCode = 404; res.end(); return; } res.setHeader('Content-Type', 'image/png'); res.end(bytes); return; }
        if (req.url === '/comic-manifest') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(comicManifest)); return; }
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
  browser = await (process.argv[2] === 'webkit' ? webkit : chromium).launch({headless:true,...(process.argv[2] === 'webkit' ? {} : {channel:'chrome'})});
  const page = await browser.newPage({viewport:{width:1000,height:800}});
  page.setDefaultTimeout(15000);
  const errors=[];
  const remote=[];
  page.on('pageerror',error=>{errors.push(error.message); console.error(error.stack)});
  page.on('request',request=>{if (/^https?:/.test(request.url()) && !request.url().includes('127.0.0.1')) remote.push(request.url())});
  page.on('console',message=>{if (message.type()==='error') console.error(message.text())});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/epub-check`);
  const waitReady=async()=>page.waitForFunction(()=>!document.querySelector('select')?.disabled && !document.querySelector('[role="alert"]'));
  const chapter=()=>page.frames().find(frame=>frame.url().startsWith('blob:'));
  const bookmark=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ghost:ebook:'+document.querySelector('[data-ebook-path]').dataset.ebookPath)));
  const waitMoved=async previous=>page.waitForFunction(previous=>{
    const root=document.querySelector('[data-ebook-path]');
    const saved=JSON.parse(localStorage.getItem('ghost:ebook:'+root.dataset.ebookPath));
    return (saved?.cfi!==previous.cfi || saved?.section!==previous.section) && !document.querySelector('select').disabled;
  },previous);
  for (const name of ['ebook-reader.fb2','alice-gutenberg.mobi','alice-gutenberg.azw3']) {
    await page.evaluate(name=>window.openBook(name),name);
    await waitReady();
    console.log('Opened',name,await page.locator('select option').count(),'contents entries');
    const contents=page.getByRole('combobox',{name:'Table of contents'});
    const options=await contents.locator('option').evaluateAll(items=>items.filter(x=>!x.disabled).map(x=>x.value));
    assert.ok(options.length>=2);
    await contents.focus();
    await contents.selectOption(options[1]);
    await waitReady();
    const selected=await bookmark();
    await page.keyboard.press('ArrowRight');
    await waitMoved(selected);
    // Cross a chapter boundary with the iframe focused, then immediately cross back.
    if(name==='ebook-reader.fb2') {
      await contents.selectOption(options[1]); await waitReady();
      await chapter().locator('body').click({position:{x:60,y:60}});
      let prev=await bookmark();
      await page.keyboard.press('ArrowLeft'); await waitMoved(prev);
      assert.equal((await bookmark()).section,0);
      prev=await bookmark(); await page.keyboard.press('ArrowRight'); await waitMoved(prev);
      assert.equal((await bookmark()).section,1);
      await contents.selectOption(options[0]); await waitReady();
      await chapter().getByRole('link',{name:'Continue to chapter two'}).click(); await waitReady();
      assert.equal((await bookmark()).section,1);
    }
    await page.getByRole('button',{name:'Larger text'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ghost:ebook:'+document.querySelector('[data-ebook-path]').dataset.ebookPath)).fontSize===110);
    for(const [fg,bg] of [['#e8e6e2','#121518'],['#242526','#faf6ed']]) {
      await page.evaluate(([fg,bg])=>{document.documentElement.style.setProperty('--foreground',fg);document.documentElement.style.setProperty('--background',bg)},[fg,bg]);
      await chapter().waitForFunction(([fg,bg])=>{
        const probe=document.createElement('span');probe.style.color=fg;probe.style.backgroundColor=bg;
        return getComputedStyle(document.body).color===probe.style.color && getComputedStyle(document.body).backgroundColor===probe.style.backgroundColor;
      },[fg,bg]);
    }
    await chapter().locator('body').evaluate(body=>{
      const script=document.createElement('script');script.textContent='parent.__bookScriptRan=true';body.append(script);
      const external=document.createElement('script');external.src='/epub-script-probe.js';body.append(external);
      body.setAttribute('onclick','parent.__bookScriptRan=true');body.click();
    });
    assert.equal(await page.evaluate(()=>!!window.__bookScriptRan),false);
    const saved=await bookmark();
    await page.screenshot({path:'/tmp/ghost-'+name+'.png'});
    await page.evaluate(()=>window.closeBook());
    await page.waitForFunction(()=>!document.querySelector('[data-ebook-path]'));
    // FB2's shared stylesheet lives for the module lifetime; book resources must go.
    await page.waitForFunction(()=>window.liveBookUrls.size===1);
    await page.evaluate(name=>window.openBook(name),name); await waitReady();
    const restored=await bookmark(); assert.equal(restored.section,saved.section);assert.equal(restored.fontSize,110);
    assert.equal(restored.cfi,saved.cfi);
    await page.setViewportSize({width:390,height:740});
    await chapter().waitForFunction(()=>document.body.clientWidth>0);
    await page.screenshot({path:'/tmp/ghost-'+name+'-narrow.png'});
    await page.setViewportSize({width:1000,height:800});
    console.log('Passed navigation, focus, bookmark, theme, CSP, resize and cleanup:',name);
  }
  await page.evaluate(()=>window.openBook('comic-reader.cbz'));
  await page.getByRole('img',{name:'Page 1',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role="status"]'));
  const pages=page.getByRole('combobox',{name:'Pages'});
  const options=await pages.locator('option').evaluateAll(items=>items.filter(x=>!x.disabled).map(x=>x.value));
  await pages.focus(); await pages.selectOption(options[1]);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('img',{name:'Page 3',exact:true}).waitFor();
  await page.getByRole('button',{name:'Read right to left'}).click();
  await page.locator('[data-comic-path]').focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('img',{name:'Page 2',exact:true}).waitFor();
  await page.getByRole('button',{name:'Zoom in'}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ghost:comic:/books/comic-reader.cbz')).zoom===125);
  await page.screenshot({path:'/tmp/ghost-comic-reader.png'});
  await page.evaluate(()=>window.closeBook()); await page.waitForFunction(()=>window.heldComicPages.size===0);
  await page.evaluate(()=>window.openBook('comic-reader.cbz'));
  await page.getByRole('img',{name:'Page 2',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Read right to left'}).getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>window.closeBook()); await page.waitForFunction(()=>window.heldComicPages.size===0);
  // Leaving during native I/O must not create a late renderer or retain URLs.
  await page.evaluate(()=>{window.pauseBookRead=true;window.openBook('ebook-reader.fb2')});
  await page.waitForFunction(()=>window.bookReadPending);
  await page.evaluate(()=>window.closeBook());
  await page.waitForFunction(()=>!document.querySelector('[data-ebook-path]'));
  await page.evaluate(()=>{window.pauseBookRead=false;window.resumeBookRead()});
  await page.waitForFunction(()=>window.liveBookUrls.size===1);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('Passed comic selection, arrows, direction, zoom, saved page and cache cleanup.');
} finally {await browser?.close();await server.close()}
