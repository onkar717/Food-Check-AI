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

const validProduct = {
  name: 'Whole Milk',
  category: 'Dairy',
  sku: 'MILK-001',
  price: 3.99,
  quantityInStock: 50,
  unit: 'gallon',
  expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days
  shelfLife: 14,
  storageConditions: 'refrigerated',
  storeId: new mongoose.Types.ObjectId().toString(),
};

describe('GET /api/products', () => {
  it('returns empty array when no products', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns list of products', async () => {
    await Product.create(validProduct);
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Whole Milk');
  });
});

describe('POST /api/products', () => {
  it('creates product and returns 201', async () => {
    const res = await request(app).post('/api/products').send(validProduct);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Whole Milk');
    expect(res.body.category).toBe('Dairy');
    expect(res.body.sku).toBe('MILK-001');
  });

  it('rejects product missing required fields with 400', async () => {
    const res = await request(app).post('/api/products').send({ name: 'Bad Product' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid category with 400', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ ...validProduct, sku: 'MILK-999', category: 'InvalidCategory' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/at-risk', () => {
  it('returns empty when no at-risk products', async () => {
    const res = await request(app).get('/api/products/at-risk');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('returns at-risk products within threshold', async () => {
    // Product expiring in 3 days, marked atRisk
    await Product.create({
      ...validProduct,
      sku: 'MILK-002',
      atRisk: true,
      expirationDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    const res = await request(app).get('/api/products/at-risk?days=7');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('excludes products not at-risk', async () => {
    await Product.create({ ...validProduct, sku: 'MILK-003', atRisk: false });
    const res = await request(app).get('/api/products/at-risk');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe('GET /api/products/:id', () => {
  it('returns product by valid id', async () => {
    const created = await Product.create(validProduct);
    const res = await request(app).get(`/api/products/${created._id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Whole Milk');
  });

  it('returns 404 for non-existent id', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/products/${fakeId}`);
    expect(res.status).toBe(404);
  });
});
