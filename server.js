// ==========================================
// SERVER - MAIN ENTRY POINT
// ==========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

// ==========================================
// INITIALIZE EXPRESS
// ==========================================

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' }
});
app.use('/api', limiter);

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}
const db = admin.firestore();
const auth = admin.auth();

// ==========================================
// COLLECTIONS
// ==========================================

const COLLECTIONS = {
  USERS: 'users',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  CATEGORIES: 'categories',
  SETTINGS: 'settings'
};

// ==========================================
// HELPERS
// ==========================================

const generateToken = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
const successResponse = (data, message = 'Success') => ({ success: true, message, data });
const errorResponse = (message, status = 400) => ({ success: false, message });

// ==========================================
// MIDDLEWARE: VERIFY TOKEN
// ==========================================

const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json(errorResponse('No token provided'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    if (!userDoc.exists) return res.status(401).json(errorResponse('User not found'));

    req.user = { uid: decoded.uid, ...userDoc.data() };
    next();
  } catch (error) {
    return res.status(401).json(errorResponse('Invalid token'));
  }
};

// ==========================================
// MIDDLEWARE: IS ADMIN (WEWE PEKEE)
// ==========================================

const isAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json(errorResponse('Authentication required'));
  if (req.user.email !== 'dullamanyama0@gmail.com') {
    return res.status(403).json(errorResponse('Access denied. Admin only.'));
  }
  next();
};

// ==========================================
// ROUTES
// ==========================================

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==========================================
// AUTH ROUTES
// ==========================================

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json(errorResponse('All fields are required'));
    }

    const userRecord = await auth.createUser({ email, password, displayName: fullName });
    const userData = { uid: userRecord.uid, email, fullName, phone: phone || null, role: 'user', isAdmin: false, status: 'active', createdAt: new Date().toISOString() };
    await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set(userData);

    const token = generateToken(userRecord.uid);
    res.status(201).json(successResponse({ user: userData, token }, 'Account created'));
  } catch (error) {
    res.status(400).json(errorResponse(error.message));
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json(errorResponse('Email and password required'));

    const userSnapshot = await db.collection(COLLECTIONS.USERS).where('email', '==', email).limit(1).get();
    if (userSnapshot.empty) return res.status(401).json(errorResponse('Invalid credentials'));

    const userData = userSnapshot.docs[0].data();
    if (userData.status === 'suspended') return res.status(403).json(errorResponse('Account suspended'));

    const token = generateToken(userData.uid);
    res.json(successResponse({ user: userData, token }, 'Login successful'));
  } catch (error) {
    res.status(400).json(errorResponse(error.message));
  }
});

// Get Current User
app.get('/api/auth/me', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'User retrieved'));
});

// ==========================================
// PRODUCT ROUTES
// ==========================================

// Get all products (Public)
app.get('/api/products', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS).where('isVisible', '==', true).orderBy('createdAt', 'desc').limit(50).get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get product by ID (Public)
app.get('/api/products/:id', async (req, res) => {
  try {
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Product not found'));
    res.json(successResponse({ id: doc.id, ...doc.data() }, 'Product retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// ADMIN ROUTES (WEWE PEKEE)
// ==========================================

// Create Product (Admin)
app.post('/api/admin/products', verifyToken, isAdmin, async (req, res) => {
  try {
    const { title, description, category, price, whatsappLink, imageUrl, isFree, isPremium, isFeatured, isTrending } = req.body;
    if (!title || !description || !category || !whatsappLink) {
      return res.status(400).json(errorResponse('All fields are required'));
    }

    const productData = {
      title, description, category, price: price || 0,
      whatsappLink, imageUrl: imageUrl || null,
      isFree: isFree || false, isPremium: isPremium || false,
      isFeatured: isFeatured || false, isTrending: isTrending || false,
      isVisible: true, createdAt: new Date().toISOString()
    };

    const docRef = await db.collection(COLLECTIONS.PRODUCTS).add(productData);
    res.status(201).json(successResponse({ id: docRef.id, ...productData }, 'Product created'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Update Product (Admin)
app.put('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db.collection(COLLECTIONS.PRODUCTS).doc(id).update({ ...updates, updatedAt: new Date().toISOString() });
    res.json(successResponse({ id, ...updates }, 'Product updated'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Delete Product (Admin)
app.delete('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await db.collection(COLLECTIONS.PRODUCTS).doc(req.params.id).delete();
    res.json(successResponse({ id: req.params.id }, 'Product deleted'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get All Products (Admin)
app.get('/api/admin/products', verifyToken, isAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS).orderBy('createdAt', 'desc').get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get Dashboard Stats (Admin)
app.get('/api/admin/dashboard', verifyToken, isAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    const productsSnapshot = await db.collection(COLLECTIONS.PRODUCTS).get();
    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS).get();

    let totalRevenue = 0;
    ordersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.paymentStatus === 'completed') totalRevenue += data.amount || 0;
    });

    res.json(successResponse({
      users: { total: usersSnapshot.size },
      products: { total: productsSnapshot.size },
      orders: { total: ordersSnapshot.size },
      revenue: { total: totalRevenue }
    }, 'Dashboard stats'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get All Users (Admin)
app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    const users = [];
    snapshot.forEach(doc => users.push({ uid: doc.id, ...doc.data() }));
    res.json(successResponse(users, 'Users retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// PAYMENT ROUTES
// ==========================================

// Initiate Payment
app.post('/api/payments/initiate', verifyToken, async (req, res) => {
  try {
    const { productId, phone } = req.body;
    if (!productId || !phone) return res.status(400).json(errorResponse('Product ID and phone required'));

    const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
    if (!productDoc.exists) return res.status(404).json(errorResponse('Product not found'));
    const product = productDoc.data();

    if (product.isFree) return res.status(400).json(errorResponse('Product is free'));

    const orderData = {
      userId: req.user.uid,
      productId,
      productTitle: product.title,
      amount: product.price,
      phone,
      paymentStatus: 'pending',
      whatsappLink: product.whatsappLink,
      createdAt: new Date().toISOString()
    };

    const orderRef = await db.collection(COLLECTIONS.ORDERS).add(orderData);
    const orderId = orderRef.id;

    // Call HarakaPay API
    const harakaPayResponse = await axios.post(
      `${process.env.HARAKAPAY_BASE_URL}/api/v1/collect`,
      {
        amount: product.price,
        phone: phone.replace(/^0/, '255'),
        reference: orderId,
        description: `Payment for ${product.title}`
      },
      { headers: { 'Authorization': `Bearer ${process.env.HARAKAPAY_API_KEY}` } }
    );

    res.json(successResponse({
      orderId,
      paymentId: harakaPayResponse.data?.paymentId || orderId,
      amount: product.price,
      status: 'pending'
    }, 'Payment initiated'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Check Payment Status
app.get('/api/payments/status/:orderId', verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const doc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Order not found'));

    const order = doc.data();
    if (order.userId !== req.user.uid && req.user.email !== 'dullamanyama0@gmail.com') {
      return res.status(403).json(errorResponse('Access denied'));
    }

    res.json(successResponse({
      orderId,
      status: order.paymentStatus,
      whatsappLink: order.paymentStatus === 'completed' ? order.whatsappLink : null,
      amount: order.amount
    }, 'Payment status'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Payment Webhook (HarakaPay calls this)
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const { paymentId, status, reference, transactionId } = req.body;

    if (status === 'completed' || status === 'success') {
      await db.collection(COLLECTIONS.ORDERS).doc(reference).update({
        paymentStatus: 'completed',
        paymentId,
        transactionId,
        completedAt: new Date().toISOString()
      });
    } else if (status === 'failed') {
      await db.collection(COLLECTIONS.ORDERS).doc(reference).update({
        paymentStatus: 'failed'
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false });
  }
});

// ==========================================
// USER ROUTES
// ==========================================

// Get user profile
app.get('/api/users/profile', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'Profile retrieved'));
});

// Update user profile
app.put('/api/users/profile', verifyToken, async (req, res) => {
  try {
    const { fullName, phone, displayName } = req.body;
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (phone) updates.phone = phone;
    if (displayName) updates.displayName = displayName;

    await db.collection(COLLECTIONS.USERS).doc(req.user.uid).update(updates);
    res.json(successResponse({ uid: req.user.uid, ...updates }, 'Profile updated'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get user orders
app.get('/api/users/orders', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(orders, 'Orders retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get user payments
app.get('/api/users/payments', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    const payments = [];
    snapshot.forEach(doc => payments.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(payments, 'Payments retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// Get purchased links
app.get('/api/users/links', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('userId', '==', req.user.uid)
      .where('paymentStatus', '==', 'completed')
      .get();
    const links = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      links.push({
        orderId: doc.id,
        productTitle: data.productTitle,
        whatsappLink: data.whatsappLink,
        purchasedAt: data.completedAt || data.createdAt,
        amount: data.amount
      });
    });
    res.json(successResponse(links, 'Links retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// SERVE FRONTEND
// ==========================================

const path = require('path');
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Admin: dullamanyama0@gmail.com`);
});
