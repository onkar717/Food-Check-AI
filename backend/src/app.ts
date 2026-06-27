import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/productRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import aimlRoutes from './routes/aimlRoutes';
import rescueRoutes from './routes/rescueRoutes';
import alertRoutes from './routes/alertRoutes';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to Food Check AI API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/aiml', aimlRoutes);
app.use('/api/rescue', rescueRoutes);
app.use('/api/alerts', alertRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

export default app;
