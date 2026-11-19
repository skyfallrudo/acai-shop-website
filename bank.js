require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { createClient } = require('@libsql/client');

// 1. Turso Database ချိတ်ဆက်ခြင်း
const db = createClient({
    url: (process.env.BMK_DATABASE_URL || process.env.TURSO_DATABASE_URL || '').trim(),
    authToken: (process.env.BMK_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim()
});

// 2. Bank Tables အော်တိုဆောက်ခြင်း (Cold start မှာ Table မဆောက်ရသေးဘဲ Error မတက်စေရန် Promise ဖြင့် ထိန်းထားသည်)
const bankTablesReady = (async () => {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS bank_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT UNIQUE NOT NULL,
                qr_token TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                balance REAL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS bank_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT NOT NULL,
                customer_name TEXT NOT NULL,
                admin_username TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                balance_after REAL NOT NULL,
                note TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        `);
        console.log('✅ Acai Bank Database tables ready!');
    } catch (err) {
        console.error('❌ Acai Bank DB Error:', err.message);
    }
})();

// 3. Admin စစ်ဆေးခြင်း (Render Env ထဲက BANK_ADMIN_USER / BANK_ADMIN_PASS ကို အဓိကသုံးသည်)
function getAdmins() {
    const list = [
        { username: process.env.BANK_ADMIN_USER, pass: process.env.BANK_ADMIN_PASS },
        { username: process.env.BANK_ADMIN1_USER, pass: process.env.BANK_ADMIN1_PASS },
        { username: process.env.BANK_ADMIN2_USER, pass: process.env.BANK_ADMIN2_PASS }
    ];

    return list
        .filter(a => a.username && a.pass)
        .map(a => ({
            username: String(a.username).trim(),
            pass: String(a.pass).trim()
        }));
}

function verifyAdmin(req, res, next) {
    const adminUser = String(req.headers['x-admin-user'] || '').trim();
    const adminPass = String(req.headers['x-admin-pass'] || '').trim();
    const valid = getAdmins().find(a => a.username === adminUser && a.pass === adminPass);

    if (!valid) {
        return res.status(401).json({ success: false, message: 'Admin ခွင့်ပြုချက် မရှိပါ။ ပြန်လည် Login ဝင်ပါ။' });
    }
    req.adminUser = valid.username;
    next();
}

// မြန်မာစံတော်ချိန် (+06:30)
function getMyanmarTime() {
    const now = new Date();
    const mmt = new Date(now.getTime() + (6.5 * 60 * 60 * 1000));
    return mmt.toISOString().replace('Z', '+06:30');
}

// API 1: Admin Login
router.post('/login', (req, res) => {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    const admins = getAdmins();

    if (admins.length === 0) {
        return res.status(500).json({
            success: false,
            message: 'Server တွင် BANK_ADMIN_USER နှင့် BANK_ADMIN_PASS မထည့်ရသေးပါ။'
        });
    }

    const valid = admins.find(a => a.username === username && a.pass === password);
    if (!valid) {
        return res.status(401).json({
            success: false,
            message: 'Username သို့မဟုတ် Password မှားနေပါသည်။'
        });
    }

    res.json({ success: true, username: valid.username });
});

// API 2: Dashboard Data (Customer အကောင့်များ + ငွေသွင်း/ထုတ် မှတ်တမ်းများ)
router.get('/dashboard', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const accountsRes = await db.execute(`SELECT * FROM bank_accounts ORDER BY id DESC`);
        const txRes = await db.execute(`SELECT * FROM bank_transactions ORDER BY id DESC LIMIT 150`);

        res.json({
            success: true,
            accounts: accountsRes.rows,
            transactions: txRes.rows
        });
    } catch (err) {
        console.error('Bank Dashboard Error:', err);
        res.status(500).json({ success: false, message: 'Data ဆွဲယူရာတွင် အမှားရှိနေပါသည်။' });
    }
});

// API 3: Customer အကောင့်အသစ် ဖွင့်ပေးရန်
router.post('/accounts', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const body = req.body || {};
        const cleanName = String(body.name || '').trim();
        const cleanPhone = String(body.phone || '').trim();
        const initAmt = parseFloat(body.initial_deposit) || 0;

        if (!cleanName || !cleanPhone) {
            return res.status(400).json({ success: false, message: 'နာမည်နှင့် ဖုန်းနံပါတ် အပြည့်အစုံ ဖြည့်ပါ။' });
        }
        if (!Number.isFinite(initAmt) || initAmt < 0) {
            return res.status(400).json({ success: false, message: 'ငွေပမာဏ မှားယွင်းနေပါသည်။' });
        }

        const countRes = await db.execute(`SELECT MAX(id) AS maxId FROM bank_accounts`);
        const nextNum = (Number(countRes.rows[0]?.maxId) || 0) + 1001;
        const customerId = `AC-${nextNum}`;
        const qrToken = crypto.randomBytes(12).toString('hex');
        const createdAt = getMyanmarTime();

        await db.execute({
            sql: `INSERT INTO bank_accounts (customer_id, qr_token, name, phone, balance, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [customerId, qrToken, cleanName, cleanPhone, initAmt, createdAt]
        });

        if (initAmt > 0) {
            await db.execute({
                sql: `INSERT INTO bank_transactions (customer_id, customer_name, admin_username, type, amount, balance_after, note, created_at)
                      VALUES (?, ?, ?, 'deposit', ?, ?, 'အကောင့်ဖွင့် ကနဦးငွေသွင်း', ?)`,
                args: [customerId, cleanName, req.adminUser, initAmt, initAmt, createdAt]
            });
        }

        res.json({
            success: true,
            customer_id: customerId,
            qr_token: qrToken
        });
    } catch (err) {
        console.error('Create Account Error:', err);
        res.status(500).json({ success: false, message: 'အကောင့်ဖွင့်ရာတွင် အမှားရှိနေပါသည်။' });
    }
});

// API 4: ငွေသွင်း (Deposit) / ငွေထုတ် (Withdraw) လုပ်ဆောင်ရန်
router.post('/transaction', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const body = req.body || {};
        const customerId = String(body.customer_id || '').trim();
        const type = String(body.type || '').trim();
        const numAmount = parseFloat(body.amount);
        const note = String(body.note || '').trim();

        if (!customerId || !['deposit', 'withdraw'].includes(type) || !Number.isFinite(numAmount) || numAmount <= 0) {
            return res.status(400).json({ success: false, message: 'အချက်အလက် မှန်ကန်စွာ ဖြည့်သွင်းပါ။' });
        }

        const accRes = await db.execute({
            sql: `SELECT * FROM bank_accounts WHERE customer_id = ?`,
            args: [customerId]
        });

        if (accRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer အကောင့် ရှာမတွေ့ပါ။' });
        }

        const account = accRes.rows[0];
        const currentBalance = Number(account.balance) || 0;

        if (type === 'withdraw' && numAmount > currentBalance) {
            return res.status(400).json({
                success: false,
                message: `လက်ကျန်ငွေ မလုံလောက်ပါ (လက်ရှိ Balance: ${currentBalance.toLocaleString()} Ks)`
            });
        }

        const newBalance = type === 'deposit' ? currentBalance + numAmount : currentBalance - numAmount;
        const createdAt = getMyanmarTime();

        await db.execute({
            sql: `UPDATE bank_accounts SET balance = ? WHERE customer_id = ?`,
            args: [newBalance, customerId]
        });

        await db.execute({
            sql: `INSERT INTO bank_transactions (customer_id, customer_name, admin_username, type, amount, balance_after, note, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [customerId, account.name, req.adminUser, type, numAmount, newBalance, note, createdAt]
        });

        res.json({ success: true, new_balance: newBalance });
    } catch (err) {
        console.error('Bank Transaction Error:', err);
        res.status(500).json({ success: false, message: 'လုပ်ဆောင်ရာတွင် အမှားရှိနေပါသည်။' });
    }
});

// API 5: Customer QR Scan ဖတ်လျှင် ကြည့်ရန် Public API (Name, ID, Phone, Balance ၄ မျိုးသာ)
router.get('/public/:token', async (req, res) => {
    try {
        await bankTablesReady;
        const token = String(req.params.token || '').trim();

        const resDb = await db.execute({
            sql: `SELECT customer_id, name, phone, balance FROM bank_accounts WHERE qr_token = ?`,
            args: [token]
        });

        if (resDb.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'အကောင့် ရှာမတွေ့ပါ သို့မဟုတ် QR Code မှားယွင်းနေပါသည်။'
            });
        }

        res.json({ success: true, data: resDb.rows[0] });
    } catch (err) {
        console.error('Public Card Error:', err);
        res.status(500).json({ success: false, message: 'Server ချိတ်ဆက်မှု အမှားရှိနေပါသည်။' });
    }
});

module.exports = router;