// Test environment: in-memory MongoDB, mock or fake-HTTP DXing, real app.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters';
process.env.PASS_SIGNING_SECRET = 'test-pass-secret-that-is-at-least-32-characters';
process.env.ADMIN_USERNAME = 'chief';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.DXING_MODE = 'mock';
process.env.EVENT_NAME = 'Test Conference';
process.env.EVENT_DATE = '1 Jan 2027';
process.env.EVENT_VENUE = 'Test Hall';
process.env.PUBLIC_BASE_URL = 'http://public.example';
process.env.DISTRICTS = 'North District, East District, West District, South District';

const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const { env } = require('../src/config/env');
const { createApp } = require('../src/app');

let mongo;

async function start() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return createApp();
}

async function stop() {
  await mongoose.disconnect();
  await mongo.stop();
}

/** Signs in as the admin from ADMIN_USERNAME / ADMIN_PASSWORD above. */
async function login(app) {
  const { username, password } = env.admin;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'rms').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Local stand-in for the DXing HTTP API. */
function fakeDxing() {
  const received = [];
  const state = { status: 200, body: { status: 200, message: 'Message has been queued for sending!', data: { messageId: 'abc' } } };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(state.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        received,
        state,
        use() {
          env.dxing.mode = 'live';
          env.dxing.baseUrl = `http://127.0.0.1:${port}/api`;
          env.dxing.secret = 'fake-secret';
          env.dxing.account = 'fake-account';
        },
        restore() {
          env.dxing.mode = 'mock';
        },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const sample = (over = {}) => ({
  name: 'Asha Menon',
  age: 29,
  mobile: '9876543210',
  email: 'Asha@Example.com',
  district: 'North District',
  area: 'Central Area',
  unit: 'Unit 4',
  ...over,
});

// Version 2 form submission (new fields). "Same as phone number" is ticked
// by default, as on the form.
const sampleV2 = (over = {}) => ({
  ...sample(),
  formVersion: 2,
  place: 'Kakkanad',
  whatsappSameAsMobile: true,
  childrenCount: 0,
  ...over,
});

/** A solid-colour test image. type: 'png' | 'jpeg' */
function image(width, height, type = 'png', color = '#7a1020') {
  const { createCanvas } = require('canvas');
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, Math.ceil(width / 4), Math.ceil(height / 4));
  return type === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', { quality: 0.9 });
}

/**
 * A JPEG carrying an EXIF segment with the given orientation and some text
 * standing in for GPS data, so tests can check both are handled.
 */
function jpegWithExif(width, height, orientation) {
  const jpeg = image(width, height, 'jpeg');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from('GPS-SECRET-LOCATION', 'ascii')]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

/** Width and height from a PNG header. */
const pngSize = (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

module.exports = { start, stop, login, fakeDxing, sample, sampleV2, image, jpegWithExif, pngSize, request, env };
