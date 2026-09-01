/**
 * شاشة العرض الذكية — M Tech
 * خادم كامل بوحدات Node المدمجة فقط. لا يحتاج npm install.
 *
 *   node server.js
 *   الشاشة:  http://localhost:3000/tv/yalanji
 *   اللوحة:  http://localhost:3000/admin/yalanji
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const DB = require('./lib/store');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIR = __dirname;
const PUB = path.join(DIR, 'public');

// ══════════════════════════════════════════════
//  التخزين
// ══════════════════════════════════════════════
const SEED = {
  yalanji: {
    title: 'يلنجي',
    latin: 'YALANJI RESTAURANT',
    cols: 3,
    cur: '₪',
    lang: 'ar',
    menu: [
      { n: 'أطباق رئيسية', n2: 'מנות עיקריות', i: [
        ['منسف كدر خروف', 95, 'מנסף קדר כבש'],
        ['منسف كدر عجل', 85, 'מנסף קדר עגל'],
        ['منسف قبوله', 65, 'מנסף קבולה'],
        ['منسف عائلي', 330, 'מנסף משפחתי'],
        ['ورق عنب', 65, 'עלי גפן'],
        ['فته يلنجي', 65, "פתה יאלנג'י"],
        ['نودلز', 55, 'נודלס'],
        ['ششبرك', 60, 'שישברכ'],
        ['شريمس وكلاماري', 90, 'שרימפס וקלמארי'],
        ['رز ساده وسط', 35, 'אורז לבן בינוני']] },
      { n: 'معجنات', n2: 'מאפים', i: [
        ['كبة مقلية بالحبة', 7, 'קובה מטוגנת ליחידה'],
        ['صفيحة أرمنية', 7, 'ספיחה ארמנית'],
        ['صفيحة عربية', 7, 'ספיחה ערבית'],
        ['ملوّح أجبان', 5, 'מלוח גבינות'],
        ['كرات زيتون', 5, 'כדורי זיתים'],
        ['مثلثات بيتسا', 6, 'משולשי פיצה'],
        ['أصابع جبنة وزعتر', 5, 'אצבעות גבינה וזעתר'],
        ['ميكس أجبان', 7, 'מיקס גבינות'],
        ['سيجاريم باللحمة', 8, 'סיגרים בשר']] },
      { n: 'مقبّلات', n2: 'מתאבנים', i: [
        ['حمص', 13, 'חומוס'],
        ['متبل', 13, 'מתבל'],
        ['ذرة', 15, 'תירס'],
        ['معكرونة باردة', 15, 'פסטה קרה'],
        ['باذنجان ميكس', 15, 'חצילים מיקס'],
        ['لبنة مثوّمة', 15, 'לבנה בשום'],
        ['زهرة بطحينة', 15, 'כרובית בטחינה']] },
      { n: 'سلطات', n2: 'סלטים', i: [
        ['تبولة', 45, 'טאבולה'],
        ['فتوش', 55, 'פתוש'],
        ['حلومة', 60, 'חלומי'],
        ['عربية', 40, 'סלט ערבי']] },
      { n: 'مشروبات', n2: 'משקאות', i: [
        ['قهوة عربية', 20, 'קפה ערבי'],
        ['شاي أعشاب', 25, 'תה עשבים'],
        ['عصير برتقال / ليمون', 18, 'מיץ תפוזים / לימון'],
        ['عصير رمان وبرتقال', 25, 'מיץ רימונים ותפוזים'],
        ['مشروبات غازية', 12, 'משקאות קלים'],
        ['ماء معدنية', 8, 'מים מינרלים'],
        ['إبريق برتقال / ليمون', 39, 'קנקן תפוזים / לימון']] },
    ],
    gone: {},
    ticker: [],
  },
};

let store = {};

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPw(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32);
  const want = Buffer.from(h, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

async function boot() {
  await DB.init();
  store = await DB.load();

  for (const [slug, d] of Object.entries(SEED)) {
    if (!store[slug]) {
      store[slug] = { ...JSON.parse(JSON.stringify(d)), pw: hashPw('yalanji1'), updated: Date.now() };
      await DB.save(slug, store[slug]);
      console.log(`  أُنشئ محل جديد: ${slug}`);
      continue;
    }
    // ترقية مستند قديم أُنشئ قبل دعم العبرية
    if (await backfill(store[slug], d)) {
      await DB.save(slug, store[slug]);
      console.log(`  حُدّث ${slug}: أُضيفت أسماء الأقسام بالعبرية`);
    }
  }
}

/** يملأ الأسماء العبرية الناقصة من البذرة، بمطابقة الاسم العربي */
async function backfill(doc, seed) {
  let changed = false;
  if (doc.lang === undefined) { doc.lang = 'ar'; changed = true; }
  if (!Array.isArray(doc.menu)) return changed;

  const byName = new Map();
  for (const c of seed.menu) {
    if (c.n2) byName.set(c.n, c.n2);
    for (const r of c.i) if (r[2]) byName.set(r[0], r[2]);
  }
  for (const c of doc.menu) {
    if (!c.n2 && byName.has(c.n)) { c.n2 = byName.get(c.n); changed = true; }
    for (const r of c.i) {
      if (!r[2] && byName.has(r[0])) { r[2] = byName.get(r[0]); changed = true; }
    }
  }
  return changed;
}

process.on('SIGTERM', async () => { await DB.close(); process.exit(0); });
process.on('SIGINT', async () => { await DB.close(); process.exit(0); });

// ══════════════════════════════════════════════
//  الجلسات
// ══════════════════════════════════════════════
const sessions = new Map();               // token -> { slug, exp }
const TTL = 12 * 3600e3;

function newSession(slug) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, { slug, exp: Date.now() + TTL });
  return t;
}
function sessionOf(req, slug) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now() || s.slug !== slug) return null;
  return { token: m[1], ...s };
}
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
}, 600e3).unref();

// ══════════════════════════════════════════════
//  بث مباشر للشاشات (SSE)
// ══════════════════════════════════════════════
const screens = new Map();                // slug -> Set<res>

function publish(slug) {
  const set = screens.get(slug);
  if (!set) return;
  const body = `data: ${JSON.stringify(publicState(slug))}\n\n`;
  for (const res of set) { try { res.write(body); } catch (e) {} }
}
setInterval(() => {                        // نبضة تُبقي الاتصال حيًا عبر Nginx
  for (const set of screens.values())
    for (const res of set) { try { res.write(': ping\n\n'); } catch (e) {} }
}, 25e3).unref();

function publicState(slug) {
  const d = store[slug];
  if (!d) return null;
  const { pw, ...rest } = d;
  return rest;
}

// ══════════════════════════════════════════════
//  أدوات
// ══════════════════════════════════════════════
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('كبير جدًا')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('JSON غير صالح')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  const p = path.join(PUB, file);
  if (!p.startsWith(PUB) || !fs.existsSync(p)) return fail(res, 404, 'غير موجود');
  send(res, 200, fs.readFileSync(p), 'text/html; charset=utf-8');
}

/** ينظّف ويتحقّق من الحالة القادمة من اللوحة */
function sanitize(body, old) {
  const S = {};
  S.title = String(body.title ?? old.title ?? '').slice(0, 60);
  S.latin = String(body.latin ?? old.latin ?? '').slice(0, 60);
  S.cur = String(body.cur ?? old.cur ?? '₪').slice(0, 4);
  S.cols = Math.min(4, Math.max(2, parseInt(body.cols, 10) || 3));
  S.lang = ['ar', 'he', 'both'].includes(body.lang) ? body.lang : (old.lang || 'ar');

  const menu = Array.isArray(body.menu) ? body.menu : old.menu;
  S.menu = menu.slice(0, 20).map((c) => ({
    n: String(c.n || '').slice(0, 40).trim() || 'بدون اسم',
    n2: String(c.n2 || '').slice(0, 40).trim(),        // الاسم بالعبرية
    i: (Array.isArray(c.i) ? c.i : []).slice(0, 60)
      .map((r) => [String(r[0] || '').slice(0, 60).trim(),
                   Math.min(99999, Math.max(0, Math.round(Number(r[1]) || 0))),
                   String(r[2] || '').slice(0, 60).trim()])
      .filter((r) => r[0] !== '' || r[2] !== ''),
  })).filter((c) => c.i.length);

  const names = new Set();
  S.menu.forEach((c) => c.i.forEach((r) => names.add(r[0])));
  S.gone = {};
  for (const k of Object.keys(body.gone || {})) if (names.has(k)) S.gone[k] = 1;

  S.ticker = (Array.isArray(body.ticker) ? body.ticker : []).slice(0, 8)
    .map((o) => ({ t: String(o.t || '').slice(0, 160).trim(), h: !!o.h }))
    .filter((o) => o.t !== '');

  S.updated = Date.now();
  return S;
}

// ══════════════════════════════════════════════
//  المسارات
// ══════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);
  const seg = pathname.split('/').filter(Boolean);

  try {
    // ── الصفحات ──
    if (seg.length === 0) return send(res, 200,
      '<meta charset=utf-8><body style="font-family:sans-serif;background:#0C1420;color:#F3EDE1;padding:40px" dir=rtl>'
      + '<h2>شاشة العرض الذكية</h2><p><a style="color:#D9A93C" href="/tv/yalanji">الشاشة</a> · '
      + '<a style="color:#D9A93C" href="/admin/yalanji">لوحة التحكم</a></p>',
      'text/html; charset=utf-8');

    if (seg[0] === 'tv' && seg[1]) {
      if (!store[seg[1]]) return fail(res, 404, 'الشاشة غير موجودة');
      return serveFile(res, 'tv.html');
    }
    if (seg[0] === 'admin' && seg[1]) {
      if (!store[seg[1]]) return fail(res, 404, 'الشاشة غير موجودة');
      return serveFile(res, 'admin.html');
    }

    // ── الواجهة البرمجية ──
    if (seg[0] === 'api' && seg[1]) {
      const slug = seg[1], act = seg[2];
      const d = store[slug];
      if (!d) return fail(res, 404, 'الشاشة غير موجودة');

      // القائمة العامة — التلفزيون
      if (act === 'menu' && req.method === 'GET')
        return send(res, 200, publicState(slug));

      // بث مباشر
      if (act === 'events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 4000\n\n');
        res.write(`data: ${JSON.stringify(publicState(slug))}\n\n`);
        if (!screens.has(slug)) screens.set(slug, new Set());
        screens.get(slug).add(res);
        req.on('close', () => {
          const s = screens.get(slug);
          if (s) { s.delete(res); if (!s.size) screens.delete(slug); }
        });
        return;
      }

      // دخول
      if (act === 'login' && req.method === 'POST') {
        const b = await readBody(req);
        const https = req.headers['x-forwarded-proto'] === 'https';
        await new Promise((r) => setTimeout(r, 250));       // إبطاء التخمين
        if (!checkPw(String(b.password || ''), d.pw))
          return fail(res, 401, 'كلمة المرور غير صحيحة');
        const t = newSession(slug);
        return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
          'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL / 1000}`
            + (https ? '; Secure' : ''),
        });
      }

      if (act === 'logout' && req.method === 'POST') {
        const s = sessionOf(req, slug);
        if (s) sessions.delete(s.token);
        return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
          'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        });
      }

      // ── ما بعده يحتاج جلسة ──
      const sess = sessionOf(req, slug);

      if (act === 'state' && req.method === 'GET') {
        if (!sess) return fail(res, 401, 'الجلسة منتهية');
        return send(res, 200, {
          state: publicState(slug),
          screens: (screens.get(slug) || new Set()).size,
        });
      }

      if (act === 'state' && req.method === 'PUT') {
        if (!sess) return fail(res, 401, 'الجلسة منتهية');
        const b = await readBody(req);
        const next = { ...sanitize(b, d), pw: d.pw };
        await DB.save(slug, next);          // لا نردّ "تم" قبل أن يُحفظ فعلًا
        store[slug] = next;
        publish(slug);
        return send(res, 200, { ok: true, state: publicState(slug) });
      }

      if (act === 'password' && req.method === 'POST') {
        if (!sess) return fail(res, 401, 'الجلسة منتهية');
        const b = await readBody(req);
        if (!checkPw(String(b.old || ''), d.pw))
          return fail(res, 403, 'كلمة المرور الحالية غير صحيحة');
        if (String(b.next || '').length < 6)
          return fail(res, 400, 'الكلمة الجديدة قصيرة — ٦ خانات على الأقل');
        const prev = d.pw;
        d.pw = hashPw(String(b.next));
        try {
          await DB.save(slug, d);
        } catch (e) {
          d.pw = prev;                       // تراجع حتى لا تختلف الذاكرة عن القاعدة
          return fail(res, 503, 'تعذّر الحفظ — حاول مرة أخرى');
        }
        return send(res, 200, { ok: true });
      }

      return fail(res, 404, 'مسار غير معروف');
    }

    fail(res, 404, 'غير موجود');
  } catch (e) {
    fail(res, 400, e.message || 'خطأ');
  }
});

boot().then(() => {
server.listen(PORT, HOST, () => {
  console.log(`\n  شاشة العرض تعمل على ${HOST}:${PORT}\n`);
  for (const slug of Object.keys(store)) {
    console.log(`   الشاشة   http://localhost:${PORT}/tv/${slug}`);
    console.log(`   اللوحة   http://localhost:${PORT}/admin/${slug}\n`);
  }
  console.log('  كلمة المرور الأولية: yalanji1  (غيّرها من الإعدادات)\n');
});
}).catch((e) => {
  console.error('\n  فشل الإقلاع: ' + e.message + '\n');
  process.exit(1);
});
