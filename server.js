const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
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

// 1. Endpoint ya Kuanzisha Malipo na Kutunza Pending kwenye Firestore
app.post('/api/v1/collect', async (req, res) => {
    const { phone, amount, description, productId, customerEmail } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, message: 'Namba ya simu inahitajika.' });
    }

    try {
        const harakaPayUrl = 'https://harakapay.net/api/v1/collect';
        const apiKey = process.env.HARAKAPAY_API_KEY;
        
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${protocol}://${host}/api/v1/webhook`;

        // Tunatengeneza order_id ya kipekee kutumia namba ya simu na muda
        const orderId = 'ORD_' + phone + '_' + Date.now();

        // Tunahifadhi mara moja kwenye Firestore ikiwa PENDING hata kama mteja haijalipia bado
        const orderRef = db.collection('orders').doc(orderId);
        await orderRef.set({
            order_id: orderId,
            phone: phone,
            amount: Number(amount || 0),
            description: description || 'WhatsApp Group Link',
            productId: productId || '',
            customerEmail: customerEmail || '',
            status: 'pending', // Hali inaanzaikiwa pending
            createdAt: new Date().toISOString()
        });

        // Kama hakuna API Key (Test Mode) tunairudishia mafanikio ya simu kuitwa
        if (!apiKey) {
            return res.status(200).json({
                success: true,
                message: 'USSD push imetumwa (Test Mode)',
                order_id: orderId
            });
        }

        const payload = {
            phone: phone,
            amount: Number(amount || 0),
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

        return res.status(200).json({
            success: true,
            message: data.message || 'USSD push imetumwa kwenye simu yako.',
            order_id: orderId
        });

    } catch (error) {
        console.error('Collect Error:', error);
        // Hata ikitokea error ya mtandao, tunazuia server isife, tunairudishia mafanikio ya pending
        return res.status(200).json({
            success: true,
            message: 'Ombi limepokelewa na limewekwa pending.',
        });
    }
});

// 2. Webhook: HarakaPay ikituma taarifa kuwa malipo yamekamilika (Success)
app.post('/api/v1/webhook', async (req, res) => {
    const { order_id, status, fee_amount } = req.body;
    
    if (!order_id) return res.status(400).json({ success: false, message: 'Order ID haipo' });

    try {
        const orderRef = db.collection('orders').doc(order_id);
        const docSnap = await orderRef.get();

        if (docSnap.exists) {
            // Kama HarakaPay imerudisha status ya mafanikio, tunabadilisha kuwa completed
            let newStatus = 'pending';
            if (status === 'success' || status === 'completed' || status === 'SUCCESS') {
                newStatus = 'completed';
            } else if (status === 'failed' || status === 'cancelled') {
                newStatus = 'failed';
            }

            await orderRef.update({
                status: newStatus,
                net_amount: req.body.net_amount || 0,
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

// 3. Endpoint ya Kuangalia Hali ya Oda (Mteja akiandika namba yake kwenye index.html)
app.post('/api/v1/check-status', async (req, res) => {
    const { phone } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Weka namba ya simu.' });
    }

    try {
        // Tunatafuta oda ya mwisho iliyosajiliwa kwa namba hiyo ya simu kwenye Firestore
        const ordersRef = db.collection('orders');
        const snapshot = await ordersRef.where('phone', '==', phone).orderBy('createdAt', 'desc').limit(1).get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'Hakuna oda iliyopatikana kwa namba hii.' });
        }

        let orderData = null;
        snapshot.forEach(doc => {
            orderData = doc.data();
        });

        // Tunamrudishia hali halisi (pending au completed) na link ya group kama imekamilika
        return res.status(200).json({
            success: true,
            status: orderData.status, // Itakuwa 'pending', 'completed', au 'failed'
            order_id: orderData.order_id,
            // Weka hapa link yako ya WhatsApp au group utakalotaka mteja apewe
            groupLink: orderData.status === 'completed' ? 'https://chat.whatsapp.com/MFANO_WA_LINK_YAKO_HAPA' : null
        });

    } catch (error) {
        console.error('Check Status Error:', error);
        return res.status(500).json({ success: false, message: 'Hitilafu ya seva wakati wa kuangalia hali.' });
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

