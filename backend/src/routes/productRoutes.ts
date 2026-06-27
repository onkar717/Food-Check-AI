import express from 'express';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAtRiskProducts,
  applyPriceReduction
} from '../controllers/productController';

const router = express.Router();

// Custom routes for food waste management
router.get('/at-risk', getAtRiskProducts);

// Basic CRUD routes
router.get('/', getAllProducts);
router.post('/', createProduct);
router.get('/:id', getProductById);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);
router.post('/:id/price-reduction', applyPriceReduction);

export default router;