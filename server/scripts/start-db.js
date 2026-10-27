// Starts a local MongoDB for development, at the host and port in MONGODB_URI,
// with its data in server/.data/db. Keep this terminal open while the server runs.
//
//   npm run db
//
// Uses the mongod program that mongodb-memory-server keeps for the tests
// (downloaded on first use). Only for local development; it refuses any
// MONGODB_URI that is not on this computer.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { MongoBinary } = require('mongodb-memory-server');
const { env } = require('../src/config/env');

(async () => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  const uri = new URL(env.mongoUri);
  if (uri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(uri.hostname)) {
    throw new Error('MONGODB_URI does not point at this computer; start that database another way');
  }
  const port = uri.port || '27017';
  const dbpath = path.resolve(__dirname, '../.data/db');
  fs.mkdirSync(dbpath, { recursive: true });

  const mongod = await MongoBinary.getPath();
  console.log(`MongoDB on 127.0.0.1:${port}, data in ${dbpath}. Press Ctrl+C to stop.`);
  const child = spawn(mongod, ['--dbpath', dbpath, '--port', port, '--bind_ip', '127.0.0.1', '--quiet'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  child.on('exit', (code) => {
    if (code) console.error(`mongod stopped with code ${code}. Is another MongoDB already using port ${port}?`);
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
