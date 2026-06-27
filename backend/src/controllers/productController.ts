import { Request, Response } from 'express';
import Product from '../models/Product';

// Get all products
export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// Get a single product by ID
export const getProductById = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// Create a new product
export const createProduct = async (req: Request, res: Response) => {
  try {
    const product = new Product(req.body);
    const savedProduct = await product.save();
    res.status(201).json(savedProduct);
  } catch (error) {
    res.status(400).json({ message: 'Invalid product data', error });
  }
};

// Update a product
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(400).json({ message: 'Invalid product data', error });
  }
};

// Delete a product
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// Get at-risk products
export const getAtRiskProducts = async (req: Request, res: Response) => {
  try {
    const daysThreshold = req.query.days ? parseInt(req.query.days as string) : 7;
    const products = await Product.findAtRisk(daysThreshold);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// Create product from AI detection result (image or webcam)
export const createFromDetection = async (req: Request, res: Response) => {
  try {
    const { fruit, prediction, spoilage_score, sensor_data, pricing } = req.body;

    if (!fruit) {
      return res.status(400).json({ message: 'fruit is required' });
    }

    const isRotten = prediction?.includes('rotten') || spoilage_score > 0.8;
    const daysLeft: number = sensor_data?.estimated_days_left ?? (isRotten ? 0 : 3);

    const categoryMap: Record<string, string> = {
      apple: 'Produce', banana: 'Produce', orange: 'Produce',
      broccoli: 'Produce', carrot: 'Produce',
      'hot dog': 'Deli', pizza: 'Bakery', donut: 'Bakery',
      cake: 'Bakery', sandwich: 'Deli',
    };
    const category = categoryMap[fruit.toLowerCase()] || 'Produce';

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + daysLeft);

    // Mirror cascade logic
    let rescueStatus: 'none' | 'price-reduction' | 'food-bank-alert' | 'employee-discount' | 'final-sale' = 'none';
    let discountPercentage = 0;

    if (isRotten || daysLeft === 0) {
      rescueStatus = 'final-sale';
      discountPercentage = 70;
    } else if (daysLeft <= 2) {
      rescueStatus = 'food-bank-alert';
    } else if (daysLeft <= 4) {
      rescueStatus = 'price-reduction';
      discountPercentage = 30;
    } else if (daysLeft <= 7) {
      rescueStatus = 'price-reduction';
      discountPercentage = 10;
    }

    // Base price from pricing engine, reverse-calculate if discounted
    let basePrice = 1.00;
    let currentPrice: number | undefined;
    if (pricing?.price_usd > 0) {
      const disc = pricing.discount_percent || 0;
      basePrice = disc > 0
        ? Math.round((pricing.price_usd / (1 - disc / 100)) * 100) / 100
        : pricing.price_usd;
    }
    if (discountPercentage > 0) {
      currentPrice = Math.round(basePrice * (1 - discountPercentage / 100) * 100) / 100;
    }

    const productName = fruit.charAt(0).toUpperCase() + fruit.slice(1).toLowerCase();
    const displayName = isRotten ? `${productName} (AI: Rotten)` : `${productName} (AI: Fresh)`;

    const product = new Product({
      name: displayName,
      category,
      subCategory: 'AI Detected',
      price: basePrice,
      currentPrice,
      discountPercentage,
      expirationDate,
      atRisk: isRotten || daysLeft <= 3,
      rescueStatus,
      quantityInStock: 1,
      unit: 'each',
      imageUrl: '',
    });

    const saved = await product.save();
    res.status(201).json(saved);
  } catch (error: any) {
    console.error('Error creating product from detection:', error);
    res.status(500).json({ message: 'Failed to create product from detection', error: error.message });
  }
};

// Apply price reduction to a product
export const applyPriceReduction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { discountPercentage } = req.body;
    
    if (!discountPercentage || discountPercentage <= 0 || discountPercentage > 100) {
      return res.status(400).json({ message: 'Invalid discount percentage' });
    }
    
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    product.discountPercentage = discountPercentage;
    product.currentPrice = product.price * (1 - discountPercentage / 100);
    product.rescueStatus = 'price-reduction';
    product.rescueActionDate = new Date();
    
    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
}; 