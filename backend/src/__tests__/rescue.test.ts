import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import { RescueRequest } from '../models/RescueRequest';
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
  await RescueRequest.deleteMany({});
  await Product.deleteMany({});
});

const storeId = new mongoose.Types.ObjectId();

const makeProduct = async (daysLeft: number, sku = 'SKU-001') => {
  return Product.create({
    name: 'Test Bread',
    category: 'Bakery',
    sku,
    price: 2.5,
    quantityInStock: 10,
    unit: 'each',
    expirationDate: new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000),
    shelfLife: 7,
    storageConditions: 'room temperature',
    storeId,
  });
};

const validRescuePayload = (productId: any) => ({
  products: [productId.toString()],
  storeId: storeId.toString(),
  rescueType: 'food-bank-alert',
  rescueCascadeStage: 3,
  daysUntilExpiration: 2,
  status: 'pending',
  totalWeight: 5,
  totalValue: 25,
});

describe('GET /api/rescue', () => {
  it('returns empty array when no rescue requests', async () => {
    const res = await request(app).get('/api/rescue');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns rescue requests', async () => {
    const product = await makeProduct(2);
    await request(app).post('/api/rescue').send(validRescuePayload(product._id));
    const res = await request(app).get('/api/rescue');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('POST /api/rescue', () => {
  it('creates rescue request and returns 201', async () => {
    const product = await makeProduct(2);
    const res = await request(app)
      .post('/api/rescue')
      .send(validRescuePayload(product._id));
    expect(res.status).toBe(201);
    expect(res.body.rescueType).toBe('food-bank-alert');
    expect(res.body.status).toBe('pending');
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app).post('/api/rescue').send({ status: 'pending' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/rescue/:id/status', () => {
  it('updates status from pending to accepted', async () => {
    const product = await makeProduct(2);
    const created = await request(app)
      .post('/api/rescue')
      .send(validRescuePayload(product._id));
    const id = created.body._id;

    const res = await request(app)
      .patch(`/api/rescue/${id}/status`)
      .send({ status: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
  });

  it('rejects invalid status with 400', async () => {
    const product = await makeProduct(2);
    const created = await request(app)
      .post('/api/rescue')
      .send(validRescuePayload(product._id));
    const id = created.body._id;

    const res = await request(app)
      .patch(`/api/rescue/${id}/status`)
      .send({ status: 'flying' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent rescue request', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/rescue/${fakeId}/status`)
      .send({ status: 'accepted' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/rescue/foodbanks/nearby', () => {
  it('returns 400 when lat/lng missing', async () => {
    const res = await request(app).get('/api/rescue/foodbanks/nearby');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/latitude and longitude/i);
  });

  it('returns array when lat/lng provided', async () => {
    const res = await request(app).get('/api/rescue/foodbanks/nearby?lat=19.0&lng=72.8');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
