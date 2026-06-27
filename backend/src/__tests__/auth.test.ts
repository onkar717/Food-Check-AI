import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import { User } from '../models/User';

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
});

const validUser = {
  userType: 'user',
  email: 'test@example.com',
  password: 'password123',
  firstName: 'John',
  lastName: 'Doe',
  phone: '1234567890',
};

describe('GET /api/auth/test', () => {
  it('returns 200 with working message', async () => {
    const res = await request(app).get('/api/auth/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Auth routes are working');
  });
});

describe('POST /api/auth/register', () => {
  it('registers new user and returns token', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.firstName).toBe('John');
  });

  it('rejects duplicate email with 400', async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app).post('/api/auth/register').send(validUser);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('rejects invalid userType with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, userType: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid user type/i);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
  });

  it('logs in with correct credentials and returns token', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: validUser.email,
      password: validUser.password,
      userType: 'user',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.message).toBe('Login successful');
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: validUser.email,
      password: 'wrongpassword',
      userType: 'user',
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });

  it('rejects non-existent email with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'password123',
      userType: 'user',
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid userType with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: validUser.email,
      password: validUser.password,
      userType: 'ghost',
    });
    expect(res.status).toBe(400);
  });
});
