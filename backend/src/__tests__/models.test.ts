import mongoose from 'mongoose';
import { User } from '../models/User';
import Product from '../models/Product';

const TEST_DB = 'mongodb://localhost:27017/resqcart_test';

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

afterEach(async () => {
  await User.deleteMany({});
  await Product.deleteMany({});
});

const storeId = new mongoose.Types.ObjectId();

describe('User model', () => {
  it('hashes password before save', async () => {
    const user = new User({
      email: 'hash@test.com',
      password: 'plaintext',
      firstName: 'A',
      lastName: 'B',
      phone: '0000000000',
    });
    await user.save();
    expect(user.password).not.toBe('plaintext');
    expect(user.password.startsWith('$2')).toBe(true);
  });

  it('comparePassword returns true for correct password', async () => {
    const user = new User({
      email: 'compare@test.com',
      password: 'mysecret',
      firstName: 'X',
      lastName: 'Y',
      phone: '1111111111',
    });
    await user.save();
    const result = await user.comparePassword('mysecret');
    expect(result).toBe(true);
  });

  it('comparePassword returns false for wrong password', async () => {
    const user = new User({
      email: 'wrong@test.com',
      password: 'correct',
      firstName: 'P',
      lastName: 'Q',
      phone: '2222222222',
    });
    await user.save();
    const result = await user.comparePassword('wrong');
    expect(result).toBe(false);
  });

  it('enforces unique email constraint', async () => {
    await User.create({
      email: 'dupe@test.com',
      password: 'password1',
      firstName: 'D',
      lastName: 'U',
      phone: '3333333333',
    });
    await expect(
      User.create({
        email: 'dupe@test.com',
        password: 'password2',
        firstName: 'D2',
        lastName: 'U2',
        phone: '4444444444',
      })
    ).rejects.toThrow();
  });
});

describe('Product model', () => {
  const baseProduct = () => ({
    name: 'Cheddar',
    category: 'Dairy' as const,
    sku: `CHDR-${Math.random().toString(36).slice(2)}`,
    barcode: `BC-${Math.random().toString(36).slice(2)}`,
    price: 5.0,
    quantityInStock: 30,
    unit: 'each' as const,
    expirationDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
    shelfLife: 30,
    storageConditions: 'refrigerated' as const,
    storeId,
  });

  it('saves with defaults: atRisk=false, rescueStatus=none, discountPercentage=0', async () => {
    const p = await Product.create(baseProduct());
    expect(p.atRisk).toBe(false);
    expect(p.rescueStatus).toBe('none');
    expect(p.discountPercentage).toBe(0);
  });

  it('findAtRisk returns only atRisk=true products within threshold', async () => {
    await Product.create({ ...baseProduct(), atRisk: true });
    await Product.create({ ...baseProduct(), atRisk: false });
    const atRisk = await (Product as any).findAtRisk(7);
    expect(atRisk.length).toBe(1);
    expect(atRisk[0].atRisk).toBe(true);
  });

  it('findAtRisk excludes out-of-stock products', async () => {
    await Product.create({ ...baseProduct(), atRisk: true, quantityInStock: 0 });
    const atRisk = await (Product as any).findAtRisk(7);
    expect(atRisk.length).toBe(0);
  });

  it('rejects invalid category', async () => {
    await expect(
      Product.create({ ...baseProduct(), category: 'Candy' as any })
    ).rejects.toThrow();
  });

  it('rejects invalid rescueStatus', async () => {
    await expect(
      Product.create({ ...baseProduct(), rescueStatus: 'unknown' as any })
    ).rejects.toThrow();
  });

  it('discountPercentage max 100 enforced', async () => {
    await expect(
      Product.create({ ...baseProduct(), discountPercentage: 150 })
    ).rejects.toThrow();
  });
});
