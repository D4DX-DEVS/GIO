// Test environment: in-memory MongoDB, an in-memory stand-in for DigitalOcean
// Spaces, real app. Nothing here talks to the network.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters';
process.env.PASS_SIGNING_SECRET = 'test-pass-secret-that-is-at-least-32-characters';
process.env.ADMIN_USERNAME = 'chief';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.EVENT_NAME = 'Test Conference';
process.env.EVENT_DATE = '1 Jan 2027';
process.env.EVENT_VENUE = 'Test Hall';
// Dummy Spaces settings. Set before ../src is loaded: dotenv never overrides
// variables that already exist, so a developer's real server/.env cannot leak in.
process.env.DO_SPACES_KEY = 'test-spaces-key';
process.env.DO_SPACES_SECRET = 'test-spaces-secret';
process.env.DO_SPACES_ENDPOINT = 'https://test.example-spaces.com';
process.env.DO_SPACES_REGION = 'test1';
process.env.DO_SPACES_BUCKET = 'test-bucket';
process.env.DO_SPACES_CDN_URL = 'https://cdn.test.example';
process.env.DO_SPACES_FOLDER = 'TEST';
process.env.DISTRICTS = 'North District, East District, West District, South District';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const { S3Client } = require('@aws-sdk/client-s3');
const { env } = require('../src/config/env');
const { createApp } = require('../src/app');

let mongo;

async function start() {
  spaces.reset();
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

/**
 * In-memory DigitalOcean Spaces. Replaces S3Client.send, so the real
 * assetStore code (key building, ACLs, error handling) runs unchanged and no
 * request ever leaves the process.
 *
 *   spaces.objects          Map of full object key -> { body, contentType, acl, cacheControl, modified }
 *   spaces.keys('passes/')  object keys under TEST/<prefix>, without the TEST/ folder
 *   spaces.failPuts = true  makes every upload fail, as when Spaces is unreachable
 *   spaces.reset()          empties the store, clears the failure switch and
 *                           puts the TEST_PHOTO registrant photo back
 */
const spaces = {
  objects: new Map(),
  failPuts: false,
  folder: process.env.DO_SPACES_FOLDER,
  cdn: process.env.DO_SPACES_CDN_URL,
  keys(prefix = '') {
    const full = `${this.folder}/${prefix}`;
    return [...this.objects.keys()].filter((k) => k.startsWith(full)).map((k) => k.slice(this.folder.length + 1));
  },
  reset() {
    this.objects.clear();
    this.failPuts = false;
    this.objects.set(`${this.folder}/photos/${TEST_PHOTO}`, {
      body: Buffer.from(testPhotoJpeg()),
      contentType: 'image/jpeg',
      acl: 'public-read',
      cacheControl: 'public, max-age=31536000, immutable',
      modified: new Date(),
    });
  },
};

// A registrant's photo that is already in the fake bucket after every reset,
// so the version 3 form (which requires a photo) can be submitted with
// sampleV3() as it is. Tests that cover the upload itself use their own.
const TEST_PHOTO = '0123456789abcdef0123456789abcdef.jpg';
let photoJpeg;
const testPhotoJpeg = () => (photoJpeg ??= image(400, 500, 'jpeg', '#204060'));

const s3Error = (name, status, message) => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });

S3Client.prototype.send = async function fakeSend(command) {
  const input = command.input || {};
  switch (command.constructor.name) {
    case 'PutObjectCommand': {
      if (spaces.failPuts) throw s3Error('ServiceUnavailable', 503, 'Spaces is unreachable');
      const body = Buffer.isBuffer(input.Body) ? Buffer.from(input.Body) : Buffer.from(input.Body ?? '');
      spaces.objects.set(input.Key, { body, contentType: input.ContentType, acl: input.ACL, cacheControl: input.CacheControl, modified: new Date() });
      return { ETag: '"fake"', $metadata: { httpStatusCode: 200 } };
    }
    case 'GetObjectCommand': {
      const o = spaces.objects.get(input.Key);
      if (!o) throw s3Error('NoSuchKey', 404, 'The specified key does not exist.');
      return {
        Body: { transformToByteArray: async () => new Uint8Array(o.body) },
        ContentType: o.contentType,
        $metadata: { httpStatusCode: 200 },
      };
    }
    case 'HeadObjectCommand': {
      const o = spaces.objects.get(input.Key);
      if (!o) throw s3Error('NotFound', 404, 'NotFound');
      return { ContentLength: o.body.length, ContentType: o.contentType, $metadata: { httpStatusCode: 200 } };
    }
    case 'DeleteObjectCommand':
      spaces.objects.delete(input.Key);
      return { $metadata: { httpStatusCode: 204 } };
    case 'ListObjectsV2Command': {
      const prefix = input.Prefix || '';
      const Contents = [...spaces.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([Key, o]) => ({ Key, Size: o.body.length, LastModified: o.modified }));
      return { Contents, IsTruncated: false, $metadata: { httpStatusCode: 200 } };
    }
    default:
      throw new Error(`Test Spaces fake does not handle ${command.constructor.name}`);
  }
};

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

// Current (version 3) form submission. "Same as phone number" is ticked by
// default and no children are added, as on the form. The photo is TEST_PHOTO,
// which spaces.reset() keeps in the fake bucket.
const sampleV3 = (over = {}) => ({
  name: 'Asha Menon',
  age: 29,
  email: 'Asha@Example.com',
  district: 'North District',
  area: 'Central Area',
  unit: 'Unit 4',
  formVersion: 3,
  photo: TEST_PHOTO,
  place: 'Kakkanad',
  mobileCountry: 'IN',
  mobile: '9876543210',
  whatsappSameAsMobile: true,
  childrenCount: 0,
  children: [],
  ...over,
});

const LEGACY_DATE = new Date('2026-10-20T10:00:00Z');

/**
 * A registration exactly as the original code saved it: waiting for an admin
 * (status submitted, no pass). Insert it with Registration.collection.insertOne
 * so Mongoose adds no defaults. Pass a unique regNo, nameKey and mobile.
 */
function legacyRegistration(over = {}) {
  return {
    regNo: 'REG-09001',
    name: 'Old Submitted',
    nameKey: 'old submitted',
    age: 34,
    mobile: '+919847000001',
    email: 'old.one@example.com',
    district: 'North District',
    area: 'Old Area',
    unit: 'Old Unit',
    status: 'submitted',
    statusChangedAt: LEGACY_DATE,
    statusHistory: [{ from: null, to: 'submitted', by: null, byName: 'system', note: 'Submitted online', at: LEGACY_DATE }],
    confirmedAt: null,
    confirmedBy: null,
    confirmedByName: '',
    passId: null,
    passStatus: 'not_generated',
    passGeneratedAt: null,
    passSentAt: null,
    createdAt: LEGACY_DATE,
    updatedAt: LEGACY_DATE,
    __v: 0,
    ...over,
  };
}

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

module.exports = { start, stop, login, spaces, TEST_PHOTO, sample, sampleV3, legacyRegistration, LEGACY_DATE, image, jpegWithExif, pngSize, request, env };
