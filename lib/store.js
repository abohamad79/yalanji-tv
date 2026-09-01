/**
 * التخزين — MongoDB فقط.
 * كل محل مستند واحد في مجموعة displays، معرّفه هو الـ slug.
 */
'use strict';

const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'tvdisplay';
const COLL = 'displays';

let client = null;
let coll = null;

async function init() {
  if (!URI) {
    throw new Error(
      'MONGODB_URI غير مضبوط.\n' +
      '  أضفه في متغيرات البيئة، بالشكل:\n' +
      '  mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/?retryWrites=true'
    );
  }
  client = new MongoClient(URI, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: true,
  });
  await client.connect();
  await client.db(DB_NAME).command({ ping: 1 });   // تأكيد فعلي لا مجرد اتصال
  coll = client.db(DB_NAME).collection(COLL);
  console.log(`  التخزين: MongoDB — قاعدة ${DB_NAME}`);
}

/** كل المحلات ككائن { slug: doc } */
async function load() {
  const rows = await coll.find({}).toArray();
  const out = {};
  for (const r of rows) {
    const { _id, ...rest } = r;
    out[_id] = rest;
  }
  return out;
}

/** حفظ محل واحد. يرمي عند الفشل حتى يعرف المستخدم أن التعديل لم يُحفظ. */
async function save(slug, doc) {
  await coll.replaceOne({ _id: slug }, doc, { upsert: true });
}

async function close() {
  if (client) { try { await client.close(); } catch (e) {} }
}

module.exports = { init, load, save, close };
