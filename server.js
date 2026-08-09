const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // Hakikisha umesakinisha au tumia built-in fetch ya Node
const app = express();

const PORT = process.env.PORT || 3000;

// Middleware ya kusoma JSON na kutoa huduma kwenye folda ya sasa
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// 1. Route ya kusoma Index.html (Client Side & 3D Carousel)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Route ya kusoma Admin.html (Admin Panel)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 3. HarakaPay Integration Endpoint
app.post('/api/v1/collect', async (req, res) => {
    const { phone, amount, description, whatsappLink } = req.body;

    if (!phone || !amount) {
        return res.status(400).json({ success: false, message: 'Namba ya simu na kiasi zinahitajika.' });
    }

    try {
        // Taarifa za HarakaPay API (Weka vigezo vyako hapa au kwenye Environment Variables)
        const harakaPayUrl = 'https://api.harakapay.com/v1/collect'; // Badilisha kulingana na docs zao kama ni tofauti
        const apiKey = process.env.HARAKAPAY_API_KEY || 'HARAKAPAY_PUBLIC_OR_SECRET_KEY';

        const payload = {
            phone: phone,
            amount: amount,
            reference: 'PATA_LINK_' + Date.now(),
            description: description || 'Malipo ya WhatsApp Group Link'
        };

        const response = await fetch(harakaPayUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            // Hapa unaweza pia kutunza order kwenye Firestore au Database yako ikiwa inahitajika
            return res.status(200).json({
                success: true,
                message: 'USSD Push imetumwa kikamilifu.',
                order_id: data.order_id || payload.reference,
                data: data
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

// Anzisha Seva
app.listen(PORT, () => {
    console.log(`🚀 Seva inaendelea vizuri kwenye port ${PORT}`);
    console.log(`👉 Fungua Index: http://localhost:${PORT}`);
    console.log(`👉 Fungua Admin: http://localhost:${PORT}/admin`);
});

