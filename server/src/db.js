'use strict';
const { MongoClient } = require('mongodb');
const { hashPassword } = require('./auth');

// Seeded demo accounts. Reviewers log in with these to exercise sharing.
const SEED_USERS = [
  { email: 'alice@ajaia.dev', name: 'Alice Owner', password: 'password123' },
  { email: 'bob@ajaia.dev', name: 'Bob Editor', password: 'password123' },
  { email: 'carol@ajaia.dev', name: 'Carol Viewer', password: 'password123' },
];

async function connect(url, dbName) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const store = {
    client,
    db,
    users: db.collection('users'),
    sessions: db.collection('sessions'),
    documents: db.collection('documents'),
  };
  await ensureIndexes(store);
  await seedUsers(store);
  return store;
}

async function ensureIndexes({ users, sessions, documents }) {
  await users.createIndex({ email: 1 }, { unique: true });
  // Sessions expire automatically after 7 days via a TTL index.
  await sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
  await documents.createIndex({ ownerId: 1, updatedAt: -1 });
  await documents.createIndex({ 'shares.userId': 1, updatedAt: -1 });
}

async function seedUsers({ users }) {
  for (const u of SEED_USERS) {
    const exists = await users.findOne({ email: u.email });
    if (exists) continue;
    await users.insertOne({
      email: u.email,
      name: u.name,
      passwordHash: hashPassword(u.password),
      createdAt: new Date(),
    });
  }
}

module.exports = { connect, SEED_USERS };
