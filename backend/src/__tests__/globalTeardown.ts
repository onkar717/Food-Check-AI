import mongoose from 'mongoose';

export default async function globalTeardown() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/resqcart_test';
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}
