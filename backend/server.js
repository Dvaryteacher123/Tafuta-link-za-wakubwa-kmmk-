// ==========================================
// SERVER - Pata Link WhatsApp Groups
// ==========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors());
app.use(express.json());

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '..', 'frontend')));

console.log('📁 Serving static files from:', path.join(__dirname, '..', 'frontend'));

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================

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
      })
    });
    console.log('✅ Firebase initialized successfully');
  }
} catch (error) {
  console.error('❌ Firebase init error:', error.message);
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
  PAYMENTS: 'payments'
};

// ==========================================
// HELPERS
// ==========================================

const successResponse = (data, message = 'Success') => ({
  success: true,
  message,
  data
});

const errorResponse = (message, status = 400) => ({
  success: false,
  message
});

// ==========================================
// MIDDLEWARE: VERIFY TOKEN
// ==========================================

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

    req.user = { uid: decoded.uid, ...userDoc.data() };
    next();
  } catch (error) {
    return res.status(401).json(errorResponse('Invalid token'));
  }
};

// ==========================================
// MIDDLEWARE: IS ADMIN
// ==========================================

const isAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required'));
  }
  if (req.user.email !== 'dullamanyama0@gmail.com') {
    return res.status(403).json(errorResponse('Access denied. Admin only.'));
  }
  next();
};

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
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

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: fullName
    });

    const userData = {
      uid: userRecord.uid,
      email,
      fullName,
      phone: phone || null,
      role: 'user',
      isAdmin: email === 'dullamanyama0@gmail.com',
      status: 'active',
      createdAt: new Date().toISOString()
    };

    await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set(userData);

    const token = jwt.sign(
      { uid: userRecord.uid, email },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '7d' }
    );

    res.status(201).json(successResponse({ user: userData, token }, 'Account created'));
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json(errorResponse(error.message));
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
      .where('email', '==', email)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(401).json(errorResponse('Invalid credentials'));
    }

    const userData = userSnapshot.docs[0].data();
    
    if (userData.status === 'suspended') {
      return res.status(403).json(errorResponse('Account suspended'));
    }

    const token = jwt.sign(
      { uid: userData.uid, email },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '7d' }
    );

    res.json(successResponse({ user: userData, token }, 'Login successful'));
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json(errorResponse(error.message));
  }
});

// Get current user
app.get('/api/auth/me', verifyToken, async (req, res) => {
  res.json(successResponse(req.user, 'User retrieved'));
});

// ==========================================
// PRODUCT ROUTES (Public)
// ==========================================

app.get('/api/products', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
      .where('isVisible', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const products = [];
    snapshot.forEach(doc => {
      products.push({ id: doc.id, ...doc.data() });
    });

    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    console.error('Products error:', error);
    res.status(500).json(errorResponse(error.message));
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json(errorResponse('Product not found'));
    }
    res.json(successResponse({ id: doc.id, ...doc.data() }, 'Product retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// ADMIN ROUTES
// ==========================================

app.get('/api/admin/dashboard', verifyToken, isAdmin, async (req, res) => {
  try {
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    const productsSnap = await db.collection(COLLECTIONS.PRODUCTS).get();
    const ordersSnap = await db.collection(COLLECTIONS.ORDERS).get();

    let revenue = 0;
    ordersSnap.forEach(doc => {
      const data = doc.data();
      if (data.paymentStatus === 'completed') {
        revenue += data.amount || 0;
      }
    });

    res.json(successResponse({
      users: { total: usersSnap.size },
      products: { total: productsSnap.size },
      orders: { total: ordersSnap.size },
      revenue: { total: revenue }
    }, 'Dashboard stats'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    const users = [];
    snapshot.forEach(doc => {
      users.push({ uid: doc.id, ...doc.data() });
    });
    res.json(successResponse(users, 'Users retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.get('/api/admin/products', verifyToken, isAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
      .orderBy('createdAt', 'desc')
      .get();

    const products = [];
    snapshot.forEach(doc => {
      products.push({ id: doc.id, ...doc.data() });
    });
    res.json(successResponse(products, 'Products retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.post('/api/admin/products', verifyToken, isAdmin, async (req, res) => {
  try {
    const { title, description, category, price, whatsappLink, imageUrl, isFree, isPremium, isFeatured, isTrending } = req.body;

    if (!title || !description || !category || !whatsappLink) {
      return res.status(400).json(errorResponse('All fields are required'));
    }

    const productData = {
      title,
      description,
      category,
      price: price || 0,
      whatsappLink,
      imageUrl: imageUrl || null,
      isFree: isFree || false,
      isPremium: isPremium || false,
      isFeatured: isFeatured || false,
      isTrending: isTrending || false,
      isVisible: true,
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection(COLLECTIONS.PRODUCTS).add(productData);
    res.status(201).json(successResponse({ id: docRef.id, ...productData }, 'Product created'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.put('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await db.collection(COLLECTIONS.PRODUCTS).doc(id).update({
      ...updates,
      updatedAt: new Date().toISOString()
    });
    res.json(successResponse({ id, ...updates }, 'Product updated'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.delete('/api/admin/products/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await db.collection(COLLECTIONS.PRODUCTS).doc(req.params.id).delete();
    res.json(successResponse({ id: req.params.id }, 'Product deleted'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

app.get('/api/admin/orders', verifyToken, isAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .orderBy('createdAt', 'desc')
      .get();

    const orders = [];
    snapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });
    res.json(successResponse(orders, 'Orders retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// USER ROUTES
// ==========================================

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
    snapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });
    res.json(successResponse(orders, 'Orders retrieved'));
  } catch (error) {
    res.status(500).json(errorResponse(error.message));
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
    res.status(500).json(errorResponse(error.message));
  }
});

// ==========================================
// PAYMENT ROUTES
// ==========================================

app.post('/api/payments/initiate', verifyToken, async (req, res) => {
  try {
    const { productId, phone } = req.body;
    
    if (!productId || !phone) {
      return res.status(400).json(errorResponse('Product ID and phone required'));
    }

    const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
    if (!productDoc.exists) {
      return res.status(404).json(errorResponse('Product not found'));
    }

    const product = productDoc.data();

    if (product.isFree) {
      return res.status(400).json(errorResponse('Product is free'));
    }

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

    // Simulate payment (for testing)
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
      message: 'Payment initiated. Please wait for confirmation.'
    }, 'Payment initiated'));
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json(errorResponse(error.message));
  }
});

app.get('/api/payments/status/:orderId', verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const doc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse('Order not found'));
    }

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

// ==========================================
// SERVE FRONTEND
// ==========================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'));
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📧 Admin: dullamanyama0@gmail.com`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`========================================`);
});
