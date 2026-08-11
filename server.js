const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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

// Endpoint ya kupata bei na link zilizowekwa
app.get('/api/settings', async (req, res) => {
    try {
        const docRef = db.collection('settings').doc('config');
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return res.json({ success: true, ...docSnap.data() });
        }
        return res.json({ success: true, price: 1000, groupLink: 'https://chat.whatsapp.com/EXAMPLE' });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

// Endpoint ya admin kusave bei na link
app.post('/api/admin/save-settings', async (req, res) => {
    const { price, groupLink } = req.body;
    try {
        await db.collection('settings').doc('config').set({
            price: Number(price) || 1000,
            groupLink: groupLink || ''
        }, { merge: true });
        return res.json({ success: true, message: 'Imetunzwa kikamilifu!' });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/v1/collect', async (req, res) => {
    const { phone, amount } = req.body;

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
            description: 'Malipo ya Kikundi',
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

        if (!response.ok || !data.success) {
            return res.status(500).json({
                success: false,
                message: data.message || 'Hitilafu kutoka HarakaPay.'
            });
        }

        const orderId = data.order_id || ('HP_' + Date.now());

        const orderRef = db.collection('orders').doc(orderId);
        await orderRef.set({
            order_id: orderId,
            phone: phone,
            amount: Number(amount),
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: data.message || 'USSD push imetumwa kwenye simu yako.',
            order_id: orderId
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Hitilafu ya seva: ' + error.message
        });
    }
});

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
        return res.status(500).json({ success: false });
    }
});

app.post('/api/v1/check-status', async (req, res) => {
    const { order_id, phone } = req.body;
    
    try {
        let orderRef = db.collection('orders');
        let snapshot;
        if (order_id) {
            snapshot = await orderRef.where('order_id', '==', order_id).limit(1).get();
        } else if (phone) {
            snapshot = await orderRef.where('phone', '==', phone).orderBy('createdAt', 'desc').limit(1).get();
        } else {
            return res.status(400).json({ success: false, message: 'Weka namba au order_id.' });
        }

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Hakuna oda iliyopatikana.' });
        }

        let orderData = null;
        snapshot.forEach(doc => {
            orderData = doc.data();
        });

        let groupLink = '';
        if (orderData.status === 'completed') {
            const settingsSnap = await db.collection('settings').doc('config').get();
            if (settingsSnap.exists) {
                groupLink = settingsSnap.data().groupLink || '';
            }
        }

        return res.status(200).json({
            success: true,
            status: orderData.status, 
            order_id: orderData.order_id,
            groupLink: groupLink
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'Hitilafu ya seva.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Seva inaendelea kwenye port ${PORT}`);
});

