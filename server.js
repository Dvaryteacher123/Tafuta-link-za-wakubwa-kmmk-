const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Anzisha Firebase Admin (Hakikisha una faili la serviceAccountKey.json au tumia default)
initializeApp();
const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Routes za kurasa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 1. HarakaPay Collect Endpoint (Inatuma USSD Push na kutunza order Firestore ikiwa pending)
app.post('/api/v1/collect', async (req, res) => {
    const { phone, amount, description, productId, customerEmail } = req.body;

    if (!phone || !amount) {
        return res.status(400).json({ success: false, message: 'Namba ya simu na kiasi zinahitajika.' });
    }

    try {
        const harakaPayUrl = 'https://harakapay.net/api/v1/collect';
        const apiKey = process.env.HARAKAPAY_API_KEY || 'hpk_your_api_key_here';
        
        // Jenga URL kamili ya webhook kulingana na domain yako ya Render au Server
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

        if (response.ok && data.success) {
            // Hifadhi Order kwenye Firestore ikiwa na status ya pending ili Admin aidhinishe
            const orderRef = db.collection('orders').doc(data.order_id);
            await orderRef.set({
                order_id: data.order_id,
                phone: phone,
                amount: Number(amount),
                description: description || 'WhatsApp Link',
                productId: productId || '',
                customerEmail: customerEmail || '',
                status: 'pending', // Inasubiri uthibitisho
                createdAt: new Date().toISOString()
            });

            return res.status(200).json({
                success: true,
                message: data.message || 'USSD push sent to phone',
                order_id: data.order_id
            });
        } else {
            return res.status(400).json({
                success: false,
                message: data.message || 'Imeshindikana kuchakata malipo kupitia HarakaPay.'
            });
        }

    } catch (error) {
        console.error('HarakaPay Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Hitilafu ya seva wakati wa kuwasiliana na HarakaPay.'
        });
    }
});

// 2. Webhook Endpoint ya kupokea matokeo kutoka HarakaPay
app.post('/api/v1/webhook', async (req, res) => {
    const { order_id, status, amount, fee_amount } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id haipo' });
    }

    try {
        const orderRef = db.collection('orders').doc(order_id);
        const docSnap = await orderRef.get();

        if (docSnap.exists) {
            await orderRef.update({
                status: status, // 'completed' au 'failed'
                net_amount: req.body.net_amount || 0,
                fee: fee_amount || 0,
                updatedAt: new Date().toISOString()
            });
        }

        // HarakaPay inahitaji tugawane jibu la HTTP 200 ili ithibitishe tulipokea webhook
        return.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ success: false });
    }
});

// 3. Admin Endpoint ya Kuidhinisha Order (Approve Order)
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

