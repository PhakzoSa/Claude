#!/usr/bin/env node
// Captures the screenshots, the phone walkthrough video and the promo video
// in docs/media/.
//
//   xvfb-run -a node tools/capture-media.js [screenshots|walkthrough|promo] [--before <dir>]
//
// --before points at a v1.0 copy of app/ (e.g. `git archive f618d90 app`)
// for the before/after shots. Needs Playwright (`npm i -D playwright`) and
// ffmpeg on PATH.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const media = path.join(root, 'docs/media');
const shots = path.join(media, 'screenshots');
const phone = devices['Pixel 7'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

function serve(dir) {
  const server = http.createServer((req, res) => {
    let file = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (file.endsWith('/')) file += 'index.html';
    fs.readFile(file, (err, body) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const pause = (page, ms) => page.waitForTimeout(ms);
const tab = (page, name) => page.getByRole('button', { name, exact: true }).click();
const signUpSheet = (page) => page.getByRole('dialog', { name: 'Create your Varsity Mart account' });

async function openBot(page) {
  await tab(page, 'Me');
  await pause(page, 400);
  await page.getByRole('button', { name: /Ask VarsityBot/ }).click();
  await pause(page, 900);
}

async function openConversation(page) {
  await tab(page, 'Chats');
  await pause(page, 500);
  await page.locator('main button.w-full.text-left').first().click();
  await pause(page, 900);
}

async function skipIntroAndSignUp(page) {
  await page.getByRole('button', { name: 'Skip' }).click();
  await pause(page, 600);
  const sheet = signUpSheet(page);
  if (await sheet.isVisible().catch(() => false)) {
    await sheet.getByRole('button', { name: 'Skip' }).click();
    await pause(page, 400);
  }
}

async function screenshots(browser, url, beforeUrl) {
  fs.mkdirSync(shots, { recursive: true });
  const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

  let ctx = await browser.newContext(phone);
  let page = await ctx.newPage();
  await page.goto(url);
  await pause(page, 900);
  await shot(page, 'after-01-tutorial');
  await page.getByRole('button', { name: 'Skip' }).click();
  await pause(page, 900);
  await shot(page, 'after-02-signup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await pause(page, 250);
  await shot(page, 'after-03-connecting');
  await pause(page, 900);
  await shot(page, 'after-04-welcome');
  await pause(page, 2400); // let the welcome toast clear
  await openBot(page);
  await shot(page, 'after-06-bot');
  await page.keyboard.press('Escape');
  await pause(page, 400);
  await openConversation(page);
  await shot(page, 'after-07-conversation');
  await ctx.close();

  ctx = await browser.newContext(phone);
  page = await ctx.newPage();
  await page.goto(url);
  await pause(page, 600);
  await skipIntroAndSignUp(page);
  await tab(page, 'Me');
  await pause(page, 400);
  // scrollIntoViewIfNeeded is a no-op here because the row counts as visible
  // behind the bottom nav, so centre it explicitly.
  await page.getByRole('button', { name: /Create your account/ }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await pause(page, 400);
  await shot(page, 'after-05-me-signup-later');
  await ctx.close();

  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  await page.goto(url);
  await pause(page, 600);
  await page.getByRole('button', { name: 'Skip' }).click();
  await pause(page, 900);
  await shot(page, 'after-08-desktop-signup');
  await signUpSheet(page).getByRole('button', { name: 'Skip' }).click();
  await pause(page, 400);
  await tab(page, 'Chats');
  await pause(page, 700);
  await shot(page, 'after-09-desktop-chats');
  await ctx.close();

  if (beforeUrl) {
    ctx = await browser.newContext(phone);
    page = await ctx.newPage();
    await page.goto(beforeUrl);
    await pause(page, 600);
    await skipIntroAndSignUp(page);
    await openBot(page);
    await shot(page, 'before-06-bot');
    await page.keyboard.press('Escape');
    await pause(page, 400);
    await openConversation(page);
    await shot(page, 'before-07-conversation');
    await ctx.close();
  }
}

// A soft ripple wherever the "finger" taps, so viewers can follow along.
const tapRipple = () => {
  addEventListener('pointerdown', (e) => {
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;z-index:2147483647;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(18,19,23,.28);border:2px solid rgba(255,255,255,.9);pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
    document.documentElement.appendChild(dot);
    requestAnimationFrame(() => { dot.style.transform = 'scale(1.8)'; dot.style.opacity = '0'; });
    setTimeout(() => dot.remove(), 500);
  }, true);
};

// Playwright's recordVideo and headless screencasts are CSS-pixel sized, so
// the walkthrough records the screencast of a headed browser with a forced
// device scale factor (on Linux run the script under `xvfb-run -a`).
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    // Frames from before the phone viewport applies would set the video size.
    if (Math.round(metadata.deviceHeight) === phone.viewport.height) frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 2400 });
  return async (out) => {
    await cdp.send('Page.stopScreencast');
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vm-video-'));
    const list = frames.map((f, i) => {
      const file = path.join(tmp, `${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      const duration = i + 1 < frames.length ? frames[i + 1].t - f.t : 1;
      return `file '${file}'\nduration ${duration.toFixed(4)}`;
    });
    // The concat demuxer ignores the last duration unless the file repeats.
    list.push(`file '${path.join(tmp, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
    fs.writeFileSync(path.join(tmp, 'list.txt'), list.join('\n'));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    fs.rmSync(tmp, { recursive: true, force: true });
  };
}

async function walkthrough(url) {
  const browser = await chromium.launch({ headless: false, args: [`--force-device-scale-factor=${phone.deviceScaleFactor}`] });
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(tapRipple);
  const page = await ctx.newPage();
  const stop = await startScreencast(page);
  await page.goto(url);
  await pause(page, 1500);
  await page.getByRole('button', { name: 'Next' }).click();
  await pause(page, 1300);
  await page.getByRole('button', { name: 'Skip' }).click();
  await pause(page, 2600);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await pause(page, 2400);
  await page.mouse.wheel(0, 500);
  await pause(page, 1200);
  await openConversation(page);
  await pause(page, 600);
  const box = page.getByRole('textbox', { name: 'Type a message' });
  await box.click();
  await box.pressSequentially('Cool, see you at 13:00 at the Piazza 👋', { delay: 45 });
  await pause(page, 400);
  await page.getByRole('button', { name: 'Send message' }).click();
  await pause(page, 1600);
  await page.mouse.click(phone.viewport.width / 2, 12);
  await pause(page, 900);
  await openBot(page);
  const ask = page.getByRole('textbox', { name: 'Message VarsityBot' });
  await ask.click();
  await ask.pressSequentially('Where can I meet a seller safely?', { delay: 45 });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await pause(page, 3200);
  await stop(path.join(media, 'walkthrough.mp4'));
  await browser.close();
}

// The promo is a CSS timeline; step it frame by frame for a smooth render.
async function promo(browser, rootUrl) {
  const fps = 30;
  const frames = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vm-promo-'));
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${rootUrl}tools/promo/index.html`);
  await page.evaluate(() => document.fonts.ready);
  await pause(page, 500);
  const duration = await page.evaluate(() => Number(document.body.dataset.duration));
  for (let i = 0; i * 1000 / fps < duration; i++) {
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    }, i * 1000 / fps);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.png`) });
  }
  await page.close();
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(frames, '%05d.png'), '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(media, 'promo.mp4')]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(frames, '00150.png'), path.join(media, 'promo-poster.jpg')]);
  fs.rmSync(frames, { recursive: true, force: true });
}

(async () => {
  const beforeIdx = process.argv.indexOf('--before');
  const beforeDir = beforeIdx > 0 ? path.resolve(process.argv[beforeIdx + 1]) : null;
  const only = process.argv.find((a) => ['screenshots', 'walkthrough', 'promo'].includes(a));
  const app = await serve(path.join(root, 'app'));
  const before = beforeDir ? await serve(beforeDir) : null;
  const repo = await serve(root);
  const browser = await chromium.launch();
  try {
    if (!only || only === 'screenshots') await screenshots(browser, app.url, before?.url);
    if (!only || only === 'walkthrough') await walkthrough(app.url);
    if (!only || only === 'promo') await promo(browser, repo.url);
  } finally {
    await browser.close();
    for (const s of [app, before, repo]) s?.server.close();
  }
})();
