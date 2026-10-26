// Creates an admin account or resets its password.
//
//   npm run create-admin -- --username alice --name "Alice" --role admin
//
// The password is read from the RMS_ADMIN_PASSWORD environment variable or
// typed at the prompt (hidden), never passed on the command line.
const readline = require('readline');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { Admin } = require('../src/models');
const { ROLES } = require('../src/config/constants');
const { hashPassword, validatePassword } = require('../src/services/auth');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const username = (arg('username') || '').trim().toLowerCase();
  const name = (arg('name') || username).trim();
  const role = arg('role') || ROLES.ADMIN;
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw new Error('--username: 3-60 chars of a-z 0-9 . _ -');
  if (!Object.values(ROLES).includes(role)) throw new Error(`--role must be one of ${Object.values(ROLES).join(', ')}`);
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');

  const password = process.env.RMS_ADMIN_PASSWORD || (await promptHidden('Password: '));
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);

  await mongoose.connect(env.mongoUri);
  const passwordHash = await hashPassword(password);
  const existing = await Admin.findOne({ username });
  if (existing) {
    await Admin.updateOne(
      { _id: existing._id },
      { $set: { passwordHash, name, role, active: true, failedLogins: 0, lockUntil: null }, $inc: { tokenVersion: 1 } }
    );
    console.log(`Updated ${role} "${username}" (existing sessions signed out).`);
  } else {
    await Admin.create({ username, name, role, passwordHash });
    console.log(`Created ${role} "${username}".`);
  }
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
