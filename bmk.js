require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@libsql/client');


const db = createClient({
    url: process.env.BMK_DATABASE_URL,
    authToken: process.env.BMK_AUTH_TOKEN
});


async function initBmkTable() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS bmk_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_username TEXT NOT NULL,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                commission_rate REAL NOT NULL,
                commission_amount REAL NOT NULL,
                status TEXT DEFAULT 'unpaid',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        try {
            await db.execute(`ALTER TABLE bmk_transactions ADD COLUMN status TEXT DEFAULT 'unpaid'`);
        } catch (e) {
           
        }
        console.log('✅ BMK Database (bmk-db) connected & ready!');
    } catch (err) {
        console.error('❌ BMK Database Error:', err.message);
    }
}
initBmkTable();


function getAdmins() {
    return [
        { username: process.env.BMK_ADMIN1_USER, pass: process.env.BMK_ADMIN1_PASS },
        { username: process.env.BMK_ADMIN2_USER, pass: process.env.BMK_ADMIN2_PASS }
    ].filter(a => a.username && a.pass);
}


function verifyAdmin(req, res, next) {
    const adminUser = req.headers['x-admin-user'];
    const adminPass = req.headers['x-admin-pass'] || req.headers['x-admin-pin'];
    const valid = getAdmins().find(a => a.username === adminUser && a.pass === adminPass);

    if (!valid) {
        return res.status(401).json({ success: false, message: 'Admin ခွင့်ပြုချက် မရှိပါ' });
    }
    req.adminUser = valid.username;
    next();
}


function getMyanmarTime() {
    const now = new Date();
    const mmt = new Date(now.getTime() + (6.5 * 60 * 60 * 1000));
    return mmt.toISOString().replace('Z', '+06:30');
}


router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const valid = getAdmins().find(a => a.username === username && a.pass === password);

    if (!valid) {
        return res.status(401).json({ success: false, message: 'Username သို့မဟုတ် Password မှားနေပါသည်' });
    }
    res.json({ success: true, username: valid.username });
});


router.get('/transactions', verifyAdmin, async (req, res) => {
    try {
        const result = await db.execute(`SELECT * FROM bmk_transactions ORDER BY id DESC LIMIT 500`);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database မှ စာရင်းဆွဲယူရာတွင် အမှားရှိနေပါသည်' });
    }
});


router.post('/transactions', verifyAdmin, async (req, res) => {
    try {
        const { user_id, type, amount, status } = req.body;
        const numAmount = parseFloat(amount);
        const txStatus = status === 'paid' ? 'paid' : 'unpaid';
        const myanmarTime = getMyanmarTime();

        if (!user_id || !type || isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ success: false, message: 'အချက်အလက် အပြည့်အစုံ ဖြည့်သွင်းပါ' });
        }

        const commissionRate = type === 'deposit' ? 0.05 : 0.02;
        const commissionAmount = numAmount * commissionRate;

        await db.execute({
            sql: `INSERT INTO bmk_transactions (admin_username, user_id, type, amount, commission_rate, commission_amount, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [req.adminUser, user_id.trim(), type, numAmount, commissionRate, commissionAmount, txStatus, myanmarTime]
        });

        res.json({ success: true, message: 'စာရင်းသွင်းပြီးပါပြီ' });
    } catch (err) {
        console.error('Insert Error:', err);
        res.status(500).json({ success: false, message: 'စာရင်းသွင်းရာတွင် အမှားရှိနေပါသည်' });
    }
});

router.patch('/transactions/:id/status', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['paid', 'unpaid'].includes(status)) {
            return res.status(400).json({ success: false, message: 'မှားယွင်းနေသော Status ဖြစ်သည်' });
        }

        await db.execute({
            sql: `UPDATE bmk_transactions SET status = ? WHERE id = ?`,
            args: [status, req.params.id]
        });

        res.json({ success: true, message: 'Status ပြောင်းလဲပြီးပါပြီ' });
    } catch (err) {
        console.error('Status Update Error:', err);
        res.status(500).json({ success: false, message: 'Status ပြောင်းရာတွင် အမှားရှိနေပါသည်' });
    }
});

router.delete('/transactions/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({
            sql: `DELETE FROM bmk_transactions WHERE id = ?`,
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete Error:', err);
        res.status(500).json({ success: false, message: 'ဖျက်ရာတွင် အမှားရှိနေပါသည်' });
    }
});

module.exports = router;