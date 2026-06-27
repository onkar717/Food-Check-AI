import mongoose from 'mongoose';

export default async function globalSetup() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/resqcart_test';
  await mongoose.connect(uri);
  // Clean test DB before all tests
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) {
    await col.deleteMany({});
  }
  await mongoose.disconnect();
}
