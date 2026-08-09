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
      connectSrc: ["'self'", process.env.FRONTEND_URL || "http://localhost:3000"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =========================================================
// SERVE STATIC FILES - MUHIMU SANA!
// =========================================================

// Hii inasoma mafaili yote kwenye folder ya project
app.use(express.static(__dirname));

// Log paths for debugging
console.log('📁 Current directory:', __dirname);
console.log('📄 Index.html path:', path.join(__dirname, 'index.html'));
console.log('📄 Admin.html path:', path.join(__dirname, 'admin.html'));
console.log('📁 Static files served from:', __dirname);

// =========================================================
// RATE LIMITER
// =========================================================

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
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

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
  success: true, message, data, timestamp: new Date().toISOString()
});

const errorResponse = (message = 'Error', status = 400) => ({
  success: false, message, timestamp: new Date().toISOString()
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
      return res.status(401).json(errorResponse('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    
    if (!userDoc.exists) {
      return res.status(401).json(errorResponse('User not found'));
    }

    const userData = userDoc.data();
    if (userData.status === 'suspended') {
      return res.status(403).json(errorResponse('Account suspended'));
    }

    req.user = { uid: decoded.uid, ...userData };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json(errorResponse('Invalid or expired token'));
    }
    return res.status(500).json(errorResponse('Authentication failed'));
  }
};

// =========================================================
// MIDDLEWARE: VERIFY ADMIN (WEWE PEKEE)
// =========================================================

const verifyAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required'));
  }
  if (req.user.email !== 'dullamanyama0@gmail.com') {
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
    environment: process.env.NODE_ENV || 'development',
    staticFiles: {
      indexExists: fs.existsSync(path.join(__dirname, 'index.html')),
      adminExists: fs.existsSync(path.join(__dirname, 'admin.html'))
    }
  });
});

// =========================================================
// AUTH ROUTES
// =========================================================

// Signup
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
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json(errorResponse('Email already registered'));
    }
    if (error.code === 'auth/weak-password') {
      return res.status(400).json(errorResponse('Password must be at least 8 characters'));
    }
    res.status(500).json(errorResponse(error.message || 'Signup failed'));
  }
});

// Login
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

// Get current user
app.get('/api/auth/me', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'User retrieved'));
});

// =========================================================
// PRODUCT ROUTES
// =========================================================

// Get all products (Public)
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

// Get single product
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
// ADMIN ROUTES (WEWE PEKEE)
// =========================================================

// Dashboard stats
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

    // Count online users (last 5 minutes)
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

// Get all users (Admin)
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

// Get all products (Admin)
app.get('/api/admin/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS).orderBy('createdAt', 'desc').get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to get products'));
  }
});

// Create product (Admin)
app.post('/api/admin/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { 
      title, description, category, price, whatsappLink, 
      imageUrl, videoUrl, isFree, isPremium, isFeatured, isTrending 
    } = req.body;

    if (!title || !description || !category || !whatsappLink) {
      return res.status(400).json(errorResponse('All fields are required'));
    }

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

    const docRef = await db.collection(COLLECTIONS.PRODUCTS).add(productData);
    res.status(201).json(successResponse({ id: docRef.id, ...productData }, 'Product created'));
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json(errorResponse('Failed to create product'));
  }
});

// Update product (Admin)
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
    res.status(500).json(errorResponse('Failed to update product'));
  }
});

// Delete product (Admin)
app.delete('/api/admin/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(id).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Product not found'));

    await db.collection(COLLECTIONS.PRODUCTS).doc(id).delete();
    res.json(successResponse({ id }, 'Product deleted'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to delete product'));
  }
});

// Get orders (Admin)
app.get('/api/admin/orders', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.ORDERS).orderBy('createdAt', 'desc').get();
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    res.json(successResponse(orders, 'Orders retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to get orders'));
  }
});

// =========================================================
// USER ROUTES
// =========================================================

app.get('/api/users/profile', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'Profile retrieved'));
});

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
    res.status(500).json(errorResponse('Failed to get orders'));
  }
});

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
    res.status(500).json(errorResponse('Failed to get links'));
  }
});

// =========================================================
// PAYMENT ROUTES (HARAKAPAY INTEGRATION)
// =========================================================

// Initiate Payment with HarakaPay
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

    // Format phone number for HarakaPay
    let formattedPhone = phone.replace(/\s/g, '').replace(/^0/, '255');
    if (!formattedPhone.startsWith('255')) {
      formattedPhone = '255' + formattedPhone;
    }

    // Create order in Firestore
    const orderData = {
      userId: req.user.uid,
      productId,
      productTitle: product.title,
      amount: product.price,
      phone: formattedPhone,
      paymentStatus: 'pending',
      whatsappLink: product.whatsappLink,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const orderRef = await db.collection(COLLECTIONS.ORDERS).add(orderData);

    // Call HarakaPay API
    try {
      const harakaPayResponse = await axios.post(
        process.env.HARAKAPAY_BASE_URL + '/api/v1/collect',
        {
          amount: product.price,
          phone: formattedPhone,
          reference: orderRef.id,
          description: `Payment for ${product.title}`,
          metadata: {
            orderId: orderRef.id,
            userId: req.user.uid,
            productId: productId
          }
        },
        {
          headers: {
            'Authorization': 'Bearer ' + process.env.HARAKAPAY_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (harakaPayResponse.data && harakaPayResponse.data.success) {
        await db.collection(COLLECTIONS.ORDERS).doc(orderRef.id).update({
          paymentId: harakaPayResponse.data.paymentId || harakaPayResponse.data.id,
          updatedAt: new Date().toISOString()
        });

        res.json(successResponse({
          orderId: orderRef.id,
          paymentId: harakaPayResponse.data.paymentId || harakaPayResponse.data.id,
          amount: product.price,
          status: 'pending',
          message: 'Payment initiated. Please check your phone for confirmation.'
        }, 'Payment initiated'));
      } else {
        throw new Error(harakaPayResponse.data?.message || 'HarakaPay initiation failed');
      }
    } catch (harakaError) {
      console.error('HarakaPay error:', harakaError.response?.data || harakaError.message);
      
      await db.collection(COLLECTIONS.ORDERS).doc(orderRef.id).update({
        paymentStatus: 'failed',
        updatedAt: new Date().toISOString()
      });

      return res.status(400).json(errorResponse(
        harakaError.response?.data?.message || 'Payment service error. Please try again.'
      ));
    }

  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json(errorResponse('Failed to initiate payment'));
  }
});

// Payment Webhook (HarakaPay calls this)
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-webhook-signature'] || req.headers['signature'];

    if (process.env.HARAKAPAY_WEBHOOK_SECRET) {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.HARAKAPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      if (signature !== expectedSignature) {
        console.warn('Invalid webhook signature');
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
    }

    const { paymentId, status, reference, transactionId } = payload;

    if (!reference) {
      console.error('Webhook missing reference:', payload);
      return res.status(400).json({ success: false, message: 'Missing reference' });
    }

    if (status === 'completed' || status === 'success') {
      await db.collection(COLLECTIONS.ORDERS).doc(reference).update({
        paymentStatus: 'completed',
        paymentId: paymentId,
        transactionId: transactionId,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await db.collection(COLLECTIONS.PAYMENTS).add({
        orderId: reference,
        paymentId: paymentId,
        transactionId: transactionId,
        amount: payload.amount || 0,
        phone: payload.phone || '',
        status: 'completed',
        createdAt: new Date().toISOString()
      });

      console.log(`✅ Payment completed for order: ${reference}`);
    } else if (status === 'failed' || status === 'cancelled') {
      await db.collection(COLLECTIONS.ORDERS).doc(reference).update({
        paymentStatus: 'failed',
        updatedAt: new Date().toISOString()
      });
      console.log(`❌ Payment failed for order: ${reference}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

// Check payment status
app.get('/api/payments/status/:orderId', verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const doc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    if (!doc.exists) return res.status(404).json(errorResponse('Order not found'));

    const order = doc.data();
    if (order.userId !== req.user.uid && req.user.email !== 'dullamanyama0@gmail.com') {
      return res.status(403).json(errorResponse('Access denied'));
    }

    if (order.paymentStatus === 'pending' && order.paymentId) {
      try {
        const statusResponse = await axios.get(
          process.env.HARAKAPAY_BASE_URL + '/api/v1/status/' + order.paymentId,
          {
            headers: {
              'Authorization': 'Bearer ' + process.env.HARAKAPAY_API_KEY
            },
            timeout: 10000
          }
        );

        if (statusResponse.data && statusResponse.data.status) {
          const harakaStatus = statusResponse.data.status;
          if (harakaStatus === 'completed' || harakaStatus === 'success') {
            await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
              paymentStatus: 'completed',
              completedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              transactionId: statusResponse.data.transactionId || order.transactionId
            });
          } else if (harakaStatus === 'failed' || harakaStatus === 'cancelled') {
            await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
              paymentStatus: 'failed',
              updatedAt: new Date().toISOString()
            });
          }
        }
      } catch (statusError) {
        console.error('HarakaPay status check error:', statusError.message);
      }
    }

    const updatedDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    const updatedOrder = updatedDoc.data();

    res.json(successResponse({
      orderId,
      status: updatedOrder.paymentStatus,
      whatsappLink: updatedOrder.paymentStatus === 'completed' ? updatedOrder.whatsappLink : null,
      amount: updatedOrder.amount,
      productTitle: updatedOrder.productTitle
    }, 'Payment status'));
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json(errorResponse('Failed to get payment status'));
  }
});

// =========================================================
// SERVE FRONTEND - MUHIMU SANA!
// =========================================================

// Serve index.html
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found. Please check deployment.');
  }
});

// Serve admin.html
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminPath)) {
    res.sendFile(adminPath);
  } else {
    res.status(404).send('admin.html not found. Please check deployment.');
  }
});

// Serve admin.html also at /admin.html for direct access
app.get('/admin.html', (req, res) => {
  const adminPath = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminPath)) {
    res.sendFile(adminPath);
  } else {
    res.status(404).send('admin.html not found.');
  }
});

// Serve index.html also at /index.html
app.get('/index.html', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found.');
  }
});

// =========================================================
// 404 HANDLER
// =========================================================

app.use((req, res) => {
  // Try to serve index.html for any unknown route (SPA behavior)
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.status(404).sendFile(indexPath);
  } else {
    res.status(404).send('Page not found. index.html is missing.');
  }
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
