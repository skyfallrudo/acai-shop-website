require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { createClient } = require('@libsql/client');
const db = createClient({
    url: process.env.BMK_DATABASE_URL,
    authToken: process.env.BMK_AUTH_TOKEN
});
async function initBankTables() {
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
        console.log('✅ Shop Bank Database tables ready!');
    } catch (err) {
        console.error('❌ Bank DB Error:', err.message);
    }
}
initBankTables();
function getAdmins() {
    return [
        { username: process.env.BANK_ADMIN_USER, pass: process.env.BANK_ADMIN_PASS },
        { username: process.env.BANK_ADMIN1_USER, pass: process.env.BANK_ADMIN1_PASS },
        { username: process.env.BANK_ADMIN2_USER, pass: process.env.BANK_ADMIN2_PASS }
    ].filter(a => a.username && a.pass);
}

function verifyAdmin(req, res, next) {
    const adminUser = req.headers['x-admin-user'];
    const adminPass = req.headers['x-admin-pass'];
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
router.get('/dashboard', verifyAdmin, async (req, res) => {
    try {
        const accountsRes = await db.execute(`SELECT * FROM bank_accounts ORDER BY id DESC`);
        const txRes = await db.execute(`SELECT * FROM bank_transactions ORDER BY id DESC LIMIT 100`);
        res.json({
            success: true,
            accounts: accountsRes.rows,
            transactions: txRes.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Data ဆွဲယူရာတွင် အမှားရှိနေပါသည်' });
    }
});
router.post('/accounts', verifyAdmin, async (req, res) => {
    try {
        const { name, phone, initial_deposit } = req.body;
        const cleanName = (name || '').trim();
        const cleanPhone = (phone || '').trim();
        const initAmt = parseFloat(initial_deposit) || 0;

        if (!cleanName || !cleanPhone) {
            return res.status(400).json({ success: false, message: 'နာမည်နှင့် ဖုန်းနံပါတ် အပြည့်အစုံ ဖြည့်ပါ' });
        }
        if (initAmt < 0) {
            return res.status(400).json({ success: false, message: 'ငွေပမာဏ မှားယွင်းနေပါသည်' });
        }

        const countRes = await db.execute(`SELECT MAX(id) as maxId FROM bank_accounts`);
        const nextNum = (Number(countRes.rows[0]?.maxId) || 0) + 1001;
        const customerId = `AC-${nextNum}`;

        const qrToken = crypto.randomBytes(10).toString('hex');
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

        res.json({ success: true, customer_id: customerId, qr_token: qrToken });
    } catch (err) {
        console.error('Create Account Error:', err);
        res.status(500).json({ success: false, message: 'အကောင့်ဖွင့်ရာတွင် အမှားရှိနေပါသည်' });
    }
});
router.post('/transaction', verifyAdmin, async (req, res) => {
    try {
        const { customer_id, type, amount, note } = req.body;
        const numAmount = parseFloat(amount);

        if (!customer_id || !['deposit', 'withdraw'].includes(type) || isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ success: false, message: 'အချက်အလက် မှန်ကန်စွာ ဖြည့်သွင်းပါ' });
        }

        const accRes = await db.execute({
            sql: `SELECT * FROM bank_accounts WHERE customer_id = ?`,
            args: [customer_id]
        });

        if (accRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer အကောင့် ရှာမတွေ့ပါ' });
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
            args: [newBalance, customer_id]
        });

        await db.execute({
            sql: `INSERT INTO bank_transactions (customer_id, customer_name, admin_username, type, amount, balance_after, note, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [customer_id, account.name, req.adminUser, type, numAmount, newBalance, (note || '').trim(), createdAt]
        });

        res.json({ success: true, new_balance: newBalance });
    } catch (err) {
        console.error('Transaction Error:', err);
        res.status(500).json({ success: false, message: 'လုပ်ဆောင်ရာတွင် အမှားရှိနေပါသည်' });
    }
});
router.get('/public/:token', async (req, res) => {
    try {
        const resDb = await db.execute({
            sql: `SELECT customer_id, name, phone, balance FROM bank_accounts WHERE qr_token = ?`,
            args: [req.params.token]
        });

        if (resDb.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'အကောင့် ရှာမတွေ့ပါ သို့မဟုတ် QR မှားယွင်းနေပါသည်' });
        }

        res.json({ success: true, data: resDb.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;