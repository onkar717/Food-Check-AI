import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
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
  await Product.deleteMany({});
});

const storeId = new mongoose.Types.ObjectId();

const seedProduct = (overrides: Record<string, any> = {}) =>
  Product.create({
    name: 'Test Milk',
    category: 'Dairy',
    sku: `SKU-${Math.random().toString(36).slice(2)}`,
    barcode: `BC-${Math.random().toString(36).slice(2)}`,
    price: 3.0,
    currentPrice: 2.5,
    quantityInStock: 20,
    unit: 'gallon',
    expirationDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    shelfLife: 14,
    storageConditions: 'refrigerated',
    storeId,
    atRisk: true,
    rescueStatus: 'price-reduction',
    ...overrides,
  });

describe('GET /api/dashboard/stats', () => {
  it('returns stats shape', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(res.body).toHaveProperty('categoryDistribution');
    expect(res.body).toHaveProperty('monthlyTrends');
    expect(res.body.stats).toHaveProperty('atRiskProducts');
  });

  it('counts at-risk products correctly', async () => {
    await seedProduct();
    await seedProduct({ sku: `SKU-${Math.random()}` });
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats.atRiskProducts).toBe(2);
  });

  it('returns 6 monthly trend entries', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.monthlyTrends.length).toBe(6);
  });

  it('returns category distribution for at-risk products', async () => {
    await seedProduct({ category: 'Dairy' });
    await seedProduct({ category: 'Produce', sku: `SKU-${Math.random()}` });
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.categoryDistribution.length).toBeGreaterThan(0);
  });
});

describe('GET /api/dashboard/impact', () => {
  it('returns impact metrics shape', async () => {
    const res = await request(app).get('/api/dashboard/impact');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalWastePrevented');
    expect(res.body).toHaveProperty('co2Saved');
    expect(res.body).toHaveProperty('waterSaved');
    expect(res.body).toHaveProperty('equivalents');
    expect(res.body.equivalents).toHaveProperty('carMiles');
    expect(res.body.equivalents).toHaveProperty('showerMinutes');
  });

  it('calculates CO2 as 2.5x waste prevented', async () => {
    await seedProduct();
    const res = await request(app).get('/api/dashboard/impact');
    expect(res.status).toBe(200);
    const { totalWastePrevented, co2Saved } = res.body;
    expect(co2Saved).toBeCloseTo(totalWastePrevented * 2.5, 1);
  });
});

describe('GET /api/dashboard/predictions', () => {
  it('returns insights array', async () => {
    const res = await request(app).get('/api/dashboard/predictions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('insights');
    expect(Array.isArray(res.body.insights)).toBe(true);
  });

  it('returns aimlServiceAvailable flag', async () => {
    const res = await request(app).get('/api/dashboard/predictions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('aimlServiceAvailable');
  });
});
