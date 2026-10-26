const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectDB(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Make sure unique indexes (duplicate protection) exist before serving traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  console.log('[db] connected');
}

module.exports = { connectDB };
