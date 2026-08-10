const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Hapa tumeweka Project ID yako sahihi kabisa kutoka kwenye Firebase config yako
initializeApp({
    projectId: 'pata-link-za-magroup-whatsapp' 
});
const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 1. Tuma ombi la malipo kwenda HarakaPay na uhifadhi pending kwenye Firestore
app.post('/api/v1/collect', async (req, res) => {
    const { phone, amount, description, productId, customerEmail } = req.body;

    if (!phone || !amount) {
        return res.status(400).json({ success: false, message: 'Namba ya simu na kiasi zinahitajika.' });
    }

    try {
        const harakaPayUrl = 'https://harakapay.net/api/v1/collect';
        const apiKey = process.env.HARAKAPAY_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ success: false, message: 'HARAKAPAY_API_KEY haijawekwa kwenye Render.' });
        }
        
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${protocol}://${host}/api/v1/webhook`;

        const payload = {
            phone: phone,
            amount: Number(amount),
            description: description || 'Malipo ya WhatsApp Group Link',
            webhook_url: webhookUrl
        };

        const response = await fetch(harakaPayUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Tumia order_id ya HarakaPay au tengeneza ya kwako kama haijapatikana
        const orderId = data.order_id || ('HP_' + Date.now());

        // Hifadhi kwenye Firestore salama kabisa
        const orderRef = db.collection('orders').doc(orderId);
        await orderRef.set({
            order_id: orderId,
            phone: phone,
            amount: Number(amount),
            description: description || 'WhatsApp Link',
            productId: productId || '',
            customerEmail: customerEmail || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: data.message || 'USSD push imetumwa kwenye simu yako.',
            order_id: orderId
        });

    } catch (error) {
        console.error('HarakaPay/Firestore Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Hitilafu ya seva wakati wa kuwasiliana na HarakaPay.'
        });
    }
});

// 2. Webhook: Inapokea taarifa kutoka HarakaPay ikisema malipo yamekamilika
app.post('/api/v1/webhook', async (req, res) => {
    const { order_id, status, fee_amount, net_amount } = req.body;
    
    if (!order_id) return res.status(400).json({ success: false, message: 'Order ID haipo' });

    try {
        const orderRef = db.collection('orders').doc(order_id);
        const docSnap = await orderRef.get();

        if (docSnap.exists) {
            await orderRef.update({
                status: status || 'pending', 
                net_amount: net_amount || 0,
                fee: fee_amount || 0,
                updatedAt: new Date().toISOString()
            });
        }
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ success: false });
    }
});

// 3. Endpoint ya Mteja kuangalia hali yake kupitia namba ya simu
app.post('/api/v1/check-status', async (req, res) => {
    const { phone } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Weka namba ya simu.' });
    }

    try {
        const ordersRef = db.collection('orders');
        const snapshot = await ordersRef.where('phone', '==', phone).orderBy('createdAt', 'desc').limit(1).get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Hakuna oda iliyopatikana kwa namba hii.' });
        }

        let orderData = null;
        snapshot.forEach(doc => {
            orderData = doc.data();
        });

        return res.status(200).json({
            success: true,
            status: orderData.status, 
            order_id: orderData.order_id,
            groupLink: orderData.status === 'completed' ? 'https://chat.whatsapp.com/LINK_YA_GROUP_YAKO_HAPA' : null
        });

    } catch (error) {
        console.error('Check Status Error:', error);
        return res.status(500).json({ success: false, message: 'Hitilafu ya seva.' });
    }
});

app.post('/api/admin/approve-order', async (req, res) => {
    const { orderId } = req.body;
    try {
        const orderRef = db.collection('orders').doc(orderId);
        await orderRef.update({
            status: 'completed',
            approvedByAdmin: true,
            updatedAt: new Date().toISOString()
        });
        return res.json({ success: true, message: 'Oda imethibitishwa mafanikio!' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Imeshindikana kuidhinisha' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Seva inaendelea kwenye port ${PORT}`);
});

