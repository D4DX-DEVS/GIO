// Test environment: in-memory MongoDB, mock or fake-HTTP DXing, real app.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters';
process.env.PASS_SIGNING_SECRET = 'test-pass-secret-that-is-at-least-32-characters';
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
const { Admin } = require('../src/models');
const { hashPassword } = require('../src/services/auth');

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

async function createAdmin(username, role = 'admin', password = 'correct-horse-battery') {
  return Admin.create({ username, name: `${username} user`, role, passwordHash: await hashPassword(password) });
}

async function login(app, username, password = 'correct-horse-battery') {
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

module.exports = { start, stop, createAdmin, login, fakeDxing, sample, request, env };
