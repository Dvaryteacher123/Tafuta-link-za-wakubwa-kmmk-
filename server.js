// =========================================================
// PATA LINK WHATSAPP GROUPS - BACKEND SERVER
// =========================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "*"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: '*',
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(__dirname));
console.log('📁 Current directory:', __dirname);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' }
});
app.use('/api', limiter);

// =========================================================
// FIREBASE INITIALIZATION
// =========================================================

let db, auth;

try {
  if (!admin.apps.length) {
    console.log('🔐 Initializing Firebase...');
    
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!privateKey) {
      console.error('❌ FIREBASE_PRIVATE_KEY is missing!');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('✅ Firebase Admin SDK initialized');
  }
  
  db = admin.firestore();
  auth = admin.auth();
  db.settings({ ignoreUndefinedProperties: true, timestampsInSnapshots: true });
  console.log('✅ Firestore connected');
} catch (error) {
  console.error('❌ Firebase error:', error.message);
  process.exit(1);
}

// =========================================================
// COLLECTIONS
// =========================================================

const COLLECTIONS = {
  USERS: 'users',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  PAYMENTS: 'payments'
};

// =========================================================
// HELPERS
// =========================================================

const successResponse = (data, message = 'Success') => ({
  success: true, 
  message, 
  data, 
  timestamp: new Date().toISOString()
});

const errorResponse = (message = 'Error', status = 400) => ({
  success: false, 
  message, 
  timestamp: new Date().toISOString()
});

const generateToken = (uid, email) => {
  return jwt.sign(
    { uid, email },
    process.env.JWT_SECRET || 'default_secret',
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// =========================================================
// MIDDLEWARE: VERIFY TOKEN
// =========================================================

const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      // Allow admin access with dummy token
      if (req.headers.authorization?.includes('admin_direct')) {
        req.user = { uid: 'admin', email: 'dullamanyama0@gmail.com', isAdmin: true, role: 'admin' };
        return next();
      }
      return res.status(401).json(errorResponse('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    
    if (!userDoc.exists) {
      // Create user if admin
      if (decoded.email === 'dullamanyama0@gmail.com') {
        const userData = {
          uid: decoded.uid,
          email: decoded.email,
          fullName: 'Super Admin',
          role: 'admin',
          isAdmin: true,
          status: 'active',
          createdAt: new Date().toISOString()
        };
        await db.collection(COLLECTIONS.USERS).doc(decoded.uid).set(userData);
        req.user = { uid: decoded.uid, ...userData };
        return next();
      }
      return res.status(401).json(errorResponse('User not found'));
    }

    const userData = userDoc.data();
    if (userData.status === 'suspended') {
      return res.status(403).json(errorResponse('Account suspended'));
    }

    req.user = { uid: decoded.uid, ...userData };
    next();
  } catch (error) {
    console.error('Token error:', error.message);
    // Allow admin access for testing
    if (req.headers.authorization?.includes('admin_direct')) {
      req.user = { uid: 'admin', email: 'dullamanyama0@gmail.com', isAdmin: true, role: 'admin' };
      return next();
    }
    return res.status(401).json(errorResponse('Invalid or expired token'));
  }
};

// =========================================================
// MIDDLEWARE: VERIFY ADMIN
// =========================================================

const verifyAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required'));
  }
  if (req.user.email !== 'dullamanyama0@gmail.com' && !req.user.isAdmin) {
    return res.status(403).json(errorResponse('Access denied. Admin only.'));
  }
  next();
};

// =========================================================
// HEALTH CHECK
// =========================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// =========================================================
// AUTH ROUTES
// =========================================================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json(errorResponse('All fields are required'));
    }

    const existingUser = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email).limit(1).get();
    if (!existingUser.empty) {
      return res.status(400).json(errorResponse('Email already registered'));
    }

    const userRecord = await auth.createUser({
      email, password, displayName: fullName, emailVerified: false
    });

    const userData = {
      uid: userRecord.uid, email, fullName, phone: phone || null,
      role: 'user', isAdmin: email === 'dullamanyama0@gmail.com',
      status: 'active', emailVerified: false,
      createdAt: new Date().toISOString()
    };

    await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set(userData);
    const token = generateToken(userRecord.uid, email);

    res.status(201).json(successResponse({
      user: { uid: userRecord.uid, email, fullName, phone: phone || null, role: 'user', isAdmin: email === 'dullamanyama0@gmail.com' },
      token
    }, 'Account created successfully'));
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json(errorResponse(error.message || 'Signup failed'));
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json(errorResponse('Email and password required'));
    }

    const userSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email).limit(1).get();

    if (userSnapshot.empty) {
      return res.status(401).json(errorResponse('Invalid credentials'));
    }

    const userData = userSnapshot.docs[0].data();
    if (userData.status === 'suspended') {
      return res.status(403).json(errorResponse('Account suspended'));
    }

    const token = generateToken(userData.uid, email);
    await db.collection(COLLECTIONS.USERS).doc(userData.uid).update({
      lastLogin: new Date().toISOString()
    });

    res.json(successResponse({
      user: {
        uid: userData.uid, email: userData.email, fullName: userData.fullName,
        phone: userData.phone, role: userData.role || 'user',
        isAdmin: userData.isAdmin || false, status: userData.status
      },
      token
    }, 'Login successful'));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(errorResponse('Login failed'));
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'User retrieved'));
});

// =========================================================
// PRODUCT ROUTES (Public)
// =========================================================

app.get('/api/products', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
      .where('isVisible', '==', true)
      .orderBy('createdAt', 'desc')
      .get();

    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));

    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    console.error('Products error:', error);
    res.status(500).json(errorResponse('Failed to get products'));
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Product not found'));
    res.json(successResponse({ id: doc.id, ...doc.data() }, 'Product retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to get product'));
  }
});

// =========================================================
// ADMIN ROUTES
// =========================================================

app.get('/api/admin/dashboard', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    const productsSnap = await db.collection(COLLECTIONS.PRODUCTS).get();
    const ordersSnap = await db.collection(COLLECTIONS.ORDERS).get();

    let totalRevenue = 0;
    ordersSnap.forEach(doc => {
      const data = doc.data();
      if (data.paymentStatus === 'completed') totalRevenue += data.amount || 0;
    });

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('lastLogin', '>=', fiveMinAgo)
      .get();

    res.json(successResponse({
      users: { total: usersSnap.size },
      products: { total: productsSnap.size },
      orders: { total: ordersSnap.size },
      revenue: { total: totalRevenue },
      online: { count: onlineSnapshot.size }
    }, 'Dashboard stats'));
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json(errorResponse('Failed to get dashboard stats'));
  }
});

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const onlineSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('lastLogin', '>=', fiveMinAgo)
      .get();
    const onlineUids = new Set();
    onlineSnapshot.forEach(doc => onlineUids.add(doc.id));

    const snapshot = await db.collection(COLLECTIONS.USERS).orderBy('createdAt', 'desc').get();
    const users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      users.push({ 
        uid: doc.id, 
        ...data,
        isOnline: onlineUids.has(doc.id)
      });
    });
    res.json(successResponse(users, 'Users retrieved'));
  } catch (error) {
    console.error('Users error:', error);
    res.status(500).json(errorResponse('Failed to get users'));
  }
});

// =========================================================
// ADMIN PRODUCTS - GET
// =========================================================

app.get('/api/admin/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS).orderBy('createdAt', 'desc').get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    console.error('Products error:', error);
    res.status(500).json(errorResponse('Failed to get products'));
  }
});

// =========================================================
// ADMIN PRODUCTS - CREATE (ADD PRODUCT)
// =========================================================

app.post('/api/admin/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    console.log('📦 POST /api/admin/products - Received request');
    console.log('📦 Body:', req.body);
    
    const { 
      title, description, category, price, whatsappLink, 
      imageUrl, videoUrl, isFree, isPremium, isFeatured, isTrending 
    } = req.body;

    // Validate required fields
    if (!title || !description || !category || !whatsappLink) {
      console.log('❌ Validation failed: Missing required fields');
      return res.status(400).json(errorResponse('Title, description, category and WhatsApp link are required'));
    }

    // Validate WhatsApp link
    if (!whatsappLink.includes('whatsapp.com')) {
      console.log('❌ Validation failed: Invalid WhatsApp link');
      return res.status(400).json(errorResponse('Invalid WhatsApp link. Must contain whatsapp.com'));
    }

    // Build product data
    const productData = {
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      price: parseFloat(price) || 0,
      whatsappLink: whatsappLink.trim(),
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      isFree: isFree || false,
      isPremium: isPremium || false,
      isFeatured: isFeatured || false,
      isTrending: isTrending || false,
      isVisible: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('📦 Product data:', productData);

    // Save to Firestore
    const docRef = await db.collection(COLLECTIONS.PRODUCTS).add(productData);
    console.log('✅ Product created with ID:', docRef.id);
    
    res.status(201).json(successResponse(
      { id: docRef.id, ...productData }, 
      'Product created successfully'
    ));
  } catch (error) {
    console.error('❌ Create product error:', error);
    res.status(500).json(errorResponse(error.message || 'Failed to create product'));
  }
});

// =========================================================
// ADMIN PRODUCTS - UPDATE
// =========================================================

app.put('/api/admin/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(id).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Product not found'));

    await db.collection(COLLECTIONS.PRODUCTS).doc(id).update({
      ...updates,
      updatedAt: new Date().toISOString()
    });
    res.json(successResponse({ id, ...updates }, 'Product updated'));
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json(errorResponse('Failed to update product'));
  }
});

// =========================================================
// ADMIN PRODUCTS - DELETE
// =========================================================

app.delete('/api/admin/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(id).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Product not found'));

    await db.collection(COLLECTIONS.PRODUCTS).doc(id).delete();
    res.json(successResponse({ id }, 'Product deleted'));
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json(errorResponse('Failed to delete product'));
  }
});

// =========================================================
// ADMIN USERS - SUSPEND/ACTIVATE
// =========================================================

app.put('/api/admin/users/:uid/suspend', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json(errorResponse('User not found'));
    }

    const userData = userDoc.data();
    const newStatus = userData.status === 'suspended' ? 'active' : 'suspended';
    
    await db.collection(COLLECTIONS.USERS).doc(uid).update({
      status: newStatus,
      updatedAt: new Date().toISOString()
    });

    res.json(successResponse({ uid, status: newStatus }, `User ${newStatus} successfully`));
  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(500).json(errorResponse('Failed to update user status'));
  }
});

// =========================================================
// ADMIN ORDERS
// =========================================================

app.get('/api/admin/orders', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.ORDERS).orderBy('createdAt', 'desc').get();
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(orders, 'Orders retrieved'));
  } catch (error) {
    console.error('Orders error:', error);
    res.status(500).json(errorResponse('Failed to get orders'));
  }
});

// =========================================================
// USER ROUTES
// =========================================================

app.get('/api/users/profile', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'Profile retrieved'));
});

// =========================================================
// PAYMENT ROUTES
// =========================================================

app.post('/api/payments/initiate', verifyToken, async (req, res) => {
  try {
    const { productId, phone } = req.body;
    if (!productId || !phone) {
      return res.status(400).json(errorResponse('Product ID and phone required'));
    }

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

    // Simulate payment
    setTimeout(async () => {
      await db.collection(COLLECTIONS.ORDERS).doc(orderRef.id).update({
        paymentStatus: 'completed',
        completedAt: new Date().toISOString()
      });
    }, 5000);

    res.json(successResponse({
      orderId: orderRef.id,
      amount: product.price,
      status: 'pending',
      message: 'Payment initiated. Please wait.'
    }, 'Payment initiated'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to initiate payment'));
  }
});

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
    res.status(500).json(errorResponse('Failed to get payment status'));
  }
});

// =========================================================
// SERVE FRONTEND
// =========================================================

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found. Path: ' + indexPath);
  }
});

app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminPath)) {
    res.sendFile(adminPath);
  } else {
    res.status(404).send('admin.html not found. Path: ' + adminPath);
  }
});

// =========================================================
// 404 HANDLER
// =========================================================

app.use((req, res) => {
  res.status(404).send('Page not found');
});

// =========================================================
// START SERVER
// =========================================================

app.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 PATA LINK WHATSAPP GROUPS');
  console.log('========================================');
  console.log(`📡 Server running on port: ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log('========================================');
  console.log('📁 Static files from:', __dirname);
  console.log(`📄 index.html exists: ${fs.existsSync(path.join(__dirname, 'index.html'))}`);
  console.log(`📄 admin.html exists: ${fs.existsSync(path.join(__dirname, 'admin.html'))}`);
  console.log('========================================');
  console.log('📧 Admin: dullamanyama0@gmail.com');
  console.log('========================================');
});

module.exports = app;
