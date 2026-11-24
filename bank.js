require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { createClient } = require('@libsql/client');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const db = createClient({
    url: (process.env.BMK_DATABASE_URL || process.env.TURSO_DATABASE_URL || '').trim(),
    authToken: (process.env.BMK_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim()
});
const hasCloudinary = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (hasCloudinary) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

const photoStorage = hasCloudinary
    ? new CloudinaryStorage({
          cloudinary,
          params: {
              folder: 'acai-shop-bank-members',
              allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
          }
      })
    : multer.memoryStorage();

const uploadPhoto = multer({
    storage: photoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            return cb(null, true);
        }
        cb(new Error('Only image files (JPG, PNG, WEBP) are allowed.'));
    }
});
const LEVEL_RULES = {
    1: { level: 1, label: 'Level 1', minDeposit: 1000, minWithdraw: 1000 },
    2: { level: 2, label: 'Level 2', minDeposit: 10000, minWithdraw: 10000 },
    3: { level: 3, label: 'Level 3', minDeposit: 100000, minWithdraw: 100000 }
};

function getLevelRule(level) {
    return LEVEL_RULES[Number(level)] || LEVEL_RULES[1];
}
const pinAttempts = new Map();
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;
function getMyanmarISO() {
    const now = new Date();
    const mmt = new Date(now.getTime() + 6.5 * 60 * 60 * 1000);
    return mmt.toISOString().replace('Z', '+06:30');
}

function getMyanmarMemberSince(dateObj = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Yangon',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).formatToParts(dateObj);

    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.day}/${map.month}/${map.year}`;
}

function normalizeCardDigits(val) {
    return String(val || '').replace(/\D/g, '');
}

function formatCardNumber(digits) {
    const clean = normalizeCardDigits(digits).slice(0, 16);
    return clean.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function maskCardNumber(cardNumber) {
    const digits = normalizeCardDigits(cardNumber);
    const last4 = digits.slice(-4) || '0000';
    return `•••• •••• •••• ${last4}`;
}

function generateSixDigitPin() {
    return String(crypto.randomInt(100000, 1000000));
}

async function generateUniqueCardNumber() {
    for (let attempt = 0; attempt < 20; attempt++) {
        let digits = String(crypto.randomInt(1, 10));
        for (let i = 0; i < 15; i++) {
            digits += String(crypto.randomInt(0, 10));
        }
        const formatted = formatCardNumber(digits);
        const existing = await db.execute({
            sql: `SELECT id FROM bank_accounts WHERE card_number = ? OR customer_id = ?`,
            args: [formatted, formatted]
        });
        if (existing.rows.length === 0) {
            return formatted;
        }
    }
    throw new Error('Failed to generate unique card number.');
}
const bankTablesReady = (async () => {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS bank_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT UNIQUE NOT NULL,
                card_number TEXT DEFAULT '',
                qr_token TEXT UNIQUE NOT NULL,
                pin_code TEXT DEFAULT '',
                name TEXT NOT NULL,
                father_name TEXT DEFAULT '',
                phone TEXT NOT NULL,
                address TEXT DEFAULT '',
                distinguishing_mark TEXT DEFAULT '',
                dob TEXT DEFAULT '',
                issued_by TEXT DEFAULT '',
                card_level INTEGER DEFAULT 1,
                blood_type TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                photo_url TEXT DEFAULT '',
                member_since TEXT DEFAULT '',
                balance REAL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        const accountMigrations = [
            ['card_number', "TEXT DEFAULT ''"],
            ['pin_code', "TEXT DEFAULT ''"],
            ['father_name', "TEXT DEFAULT ''"],
            ['address', "TEXT DEFAULT ''"],
            ['distinguishing_mark', "TEXT DEFAULT ''"],
            ['dob', "TEXT DEFAULT ''"],
            ['issued_by', "TEXT DEFAULT ''"],
            ['card_level', 'INTEGER DEFAULT 1'],
            ['blood_type', "TEXT DEFAULT ''"],
            ['gender', "TEXT DEFAULT ''"],
            ['photo_url', "TEXT DEFAULT ''"],
            ['member_since', "TEXT DEFAULT ''"]
        ];

        for (const [col, def] of accountMigrations) {
            try {
                await db.execute(`ALTER TABLE bank_accounts ADD COLUMN ${col} ${def}`);
            } catch (e) {}
        }

        await db.execute(`
            CREATE TABLE IF NOT EXISTS bank_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT NOT NULL,
                card_number TEXT DEFAULT '',
                customer_name TEXT NOT NULL,
                admin_username TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                balance_after REAL NOT NULL,
                note TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        `);

        try {
            await db.execute(`ALTER TABLE bank_transactions ADD COLUMN card_number TEXT DEFAULT ''`);
        } catch (e) {}

        // Backfill older accounts missing card_number, member_since, or 6-digit pin_code
        const legacyRows = await db.execute(
            `SELECT id, created_at, card_number, member_since, pin_code
             FROM bank_accounts
             WHERE card_number IS NULL OR card_number = ''
                OR member_since IS NULL OR member_since = ''
                OR pin_code IS NULL OR pin_code = ''`
        );
        for (const row of legacyRows.rows) {
            const newCard = row.card_number && normalizeCardDigits(row.card_number).length === 16
                ? formatCardNumber(row.card_number)
                : await generateUniqueCardNumber();

            let memberSince = row.member_since;
            if (!memberSince) {
                const parsedDate = row.created_at ? new Date(row.created_at) : new Date();
                memberSince = getMyanmarMemberSince(isNaN(parsedDate.getTime()) ? new Date() : parsedDate);
            }

            const pinCode = /^\d{6}$/.test(String(row.pin_code || ''))
                ? String(row.pin_code)
                : generateSixDigitPin();

            await db.execute({
                sql: `UPDATE bank_accounts SET card_number = ?, member_since = ?, pin_code = ? WHERE id = ?`,
                args: [newCard, memberSince, pinCode, row.id]
            });
        }

        console.log('✅ Acai Bank Database tables & PIN migrations ready!');
    } catch (err) {
        console.error('❌ Acai Bank DB Error:', err.message);
    }
})();
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
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in again.' });
    }
    req.adminUser = valid.username;
    next();
}
router.post('/login', (req, res) => {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    const admins = getAdmins();

    if (admins.length === 0) {
        return res.status(500).json({
            success: false,
            message: 'Server configuration error: BANK_ADMIN_USER / BANK_ADMIN_PASS not set.'
        });
    }

    const valid = admins.find(a => a.username === username && a.pass === password);
    if (!valid) {
        return res.status(401).json({
            success: false,
            message: 'Invalid username or password.'
        });
    }

    res.json({ success: true, username: valid.username });
});
router.get('/dashboard', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const accountsRes = await db.execute(`SELECT * FROM bank_accounts ORDER BY id DESC`);
        const txRes = await db.execute(`SELECT * FROM bank_transactions ORDER BY id DESC LIMIT 200`);

        res.json({
            success: true,
            accounts: accountsRes.rows,
            transactions: txRes.rows
        });
    } catch (err) {
        console.error('Bank Dashboard Error:', err);
        res.status(500).json({ success: false, message: 'Failed to load dashboard data.' });
    }
});
router.post(
    '/accounts',
    verifyAdmin,
    (req, res, next) => {
        uploadPhoto.single('photo')(req, res, err => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message || 'Photo upload failed.'
                });
            }
            next();
        });
    },
    async (req, res) => {
        try {
            await bankTablesReady;
            const body = req.body || {};

            const name = String(body.name || '').trim();
            const fatherName = String(body.father_name || '').trim();
            const phone = String(body.phone || '').trim();
            const address = String(body.address || '').trim();
            const distinguishingMark = String(body.distinguishing_mark || '').trim();
            const dob = String(body.dob || '').trim();
            const issuedBy = String(body.issued_by || '').trim();
            const cardLevel = Number(body.card_level || 1);
            const bloodType = String(body.blood_type || '').trim();
            const gender = String(body.gender || '').trim();
            const rawPin = String(body.pin_code || '').trim();
            const initAmtRaw = String(body.initial_deposit ?? '').trim();
            const initAmt = initAmtRaw === '' ? 0 : parseFloat(initAmtRaw);

            if (!name || !fatherName || !phone || !address || !dob || !issuedBy || !bloodType || !gender) {
                return res.status(400).json({
                    success: false,
                    message: 'Please fill in all required customer information fields.'
                });
            }

            if (![1, 2, 3].includes(cardLevel)) {
                return res.status(400).json({
                    success: false,
                    message: 'Card level must be Level 1, Level 2, or Level 3.'
                });
            }

            if (rawPin !== '' && !/^\d{6}$/.test(rawPin)) {
                return res.status(400).json({
                    success: false,
                    message: 'PIN must be exactly 6 digits (or leave blank to auto-generate).'
                });
            }

            const pinCode = rawPin || generateSixDigitPin();
            const rule = getLevelRule(cardLevel);

            if (!Number.isFinite(initAmt) || initAmt < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid initial deposit amount.'
                });
            }

            if (initAmt > 0 && initAmt < rule.minDeposit) {
                return res.status(400).json({
                    success: false,
                    message: `Minimum initial deposit for ${rule.label} is ${rule.minDeposit.toLocaleString()} Ks.`
                });
            }

            let photoUrl = '';
            if (req.file) {
                if (req.file.path || req.file.secure_url) {
                    photoUrl = req.file.path || req.file.secure_url;
                } else if (req.file.buffer) {
                    photoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
                }
            }

            const cardNumber = await generateUniqueCardNumber();
            const qrToken = crypto.randomBytes(12).toString('hex');
            const createdAt = getMyanmarISO();
            const memberSince = getMyanmarMemberSince();

            await db.execute({
                sql: `INSERT INTO bank_accounts (
                    customer_id, card_number, qr_token, pin_code, name, father_name, phone,
                    address, distinguishing_mark, dob, issued_by, card_level,
                    blood_type, gender, photo_url, member_since, balance, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    cardNumber,
                    cardNumber,
                    qrToken,
                    pinCode,
                    name,
                    fatherName,
                    phone,
                    address,
                    distinguishingMark,
                    dob,
                    issuedBy,
                    cardLevel,
                    bloodType,
                    gender,
                    photoUrl,
                    memberSince,
                    initAmt,
                    createdAt
                ]
            });

            if (initAmt > 0) {
                await db.execute({
                    sql: `INSERT INTO bank_transactions (
                        customer_id, card_number, customer_name, admin_username,
                        type, amount, balance_after, note, created_at
                    ) VALUES (?, ?, ?, ?, 'deposit', ?, ?, 'Initial Opening Deposit', ?)`,
                    args: [cardNumber, cardNumber, name, req.adminUser, initAmt, initAmt, createdAt]
                });
            }

            res.json({
                success: true,
                card_number: cardNumber,
                member_since: memberSince,
                qr_token: qrToken,
                pin_code: pinCode
            });
        } catch (err) {
            console.error('Create Account Error:', err);
            res.status(500).json({ success: false, message: 'Failed to create customer account.' });
        }
    }
);
router.patch('/accounts/:cardNumber/pin', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const digits = normalizeCardDigits(req.params.cardNumber);
        const rawPin = String((req.body || {}).pin_code || '').trim();

        if (digits.length !== 16) {
            return res.status(400).json({ success: false, message: 'Invalid 16-digit card number.' });
        }

        if (rawPin !== '' && !/^\d{6}$/.test(rawPin)) {
            return res.status(400).json({
                success: false,
                message: 'PIN must be exactly 6 digits (or leave blank to auto-generate).'
            });
        }

        const newPin = rawPin || generateSixDigitPin();
        const formattedCard = formatCardNumber(digits);

        const accRes = await db.execute({
            sql: `SELECT id FROM bank_accounts WHERE card_number = ? OR REPLACE(card_number, ' ', '') = ?`,
            args: [formattedCard, digits]
        });

        if (accRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }

        await db.execute({
            sql: `UPDATE bank_accounts SET pin_code = ? WHERE id = ?`,
            args: [newPin, accRes.rows[0].id]
        });

        res.json({ success: true, pin_code: newPin });
    } catch (err) {
        console.error('Update PIN Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update PIN.' });
    }
});
router.post('/transaction', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const body = req.body || {};
        const digits = normalizeCardDigits(body.card_number);
        const type = String(body.type || '').trim();
        const numAmount = parseFloat(body.amount);
        const note = String(body.note || '').trim();

        if (digits.length !== 16) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 16-digit card number.'
            });
        }

        if (!['deposit', 'withdraw'].includes(type) || !Number.isFinite(numAmount) || numAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid transaction type and amount.'
            });
        }

        const formattedCard = formatCardNumber(digits);
        const accRes = await db.execute({
            sql: `SELECT * FROM bank_accounts WHERE card_number = ? OR REPLACE(card_number, ' ', '') = ?`,
            args: [formattedCard, digits]
        });

        if (accRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this 16-digit card number.'
            });
        }

        const account = accRes.rows[0];
        const currentBalance = Number(account.balance) || 0;
        const rule = getLevelRule(account.card_level);

        if (type === 'deposit' && numAmount < rule.minDeposit) {
            return res.status(400).json({
                success: false,
                message: `${rule.label} minimum deposit is ${rule.minDeposit.toLocaleString()} Ks.`
            });
        }

        if (type === 'withdraw') {
            if (numAmount < rule.minWithdraw) {
                return res.status(400).json({
                    success: false,
                    message: `${rule.label} minimum withdrawal is ${rule.minWithdraw.toLocaleString()} Ks.`
                });
            }
            if (numAmount > currentBalance) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient balance. Current balance: ${currentBalance.toLocaleString()} Ks.`
                });
            }
        }

        const newBalance = type === 'deposit' ? currentBalance + numAmount : currentBalance - numAmount;
        const createdAt = getMyanmarISO();

        await db.execute({
            sql: `UPDATE bank_accounts SET balance = ? WHERE id = ?`,
            args: [newBalance, account.id]
        });

        await db.execute({
            sql: `INSERT INTO bank_transactions (
                customer_id, card_number, customer_name, admin_username,
                type, amount, balance_after, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                account.customer_id,
                account.card_number,
                account.name,
                req.adminUser,
                type,
                numAmount,
                newBalance,
                note,
                createdAt
            ]
        });

        res.json({
            success: true,
            new_balance: newBalance,
            card_number: account.card_number,
            customer_name: account.name
        });
    } catch (err) {
        console.error('Bank Transaction Error:', err);
        res.status(500).json({ success: false, message: 'Transaction failed. Please try again.' });
    }
});
router.get('/transactions/:cardNumber', verifyAdmin, async (req, res) => {
    try {
        await bankTablesReady;
        const digits = normalizeCardDigits(req.params.cardNumber);

        if (digits.length !== 16) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 16-digit card number.'
            });
        }

        const formattedCard = formatCardNumber(digits);

        const accRes = await db.execute({
            sql: `SELECT card_number, customer_id, name, phone, card_level, balance, member_since, photo_url
                  FROM bank_accounts
                  WHERE card_number = ? OR REPLACE(card_number, ' ', '') = ?`,
            args: [formattedCard, digits]
        });

        if (accRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this 16-digit card number.'
            });
        }

        const account = accRes.rows[0];

        const txRes = await db.execute({
            sql: `SELECT * FROM bank_transactions
                  WHERE REPLACE(card_number, ' ', '') = ? OR REPLACE(customer_id, ' ', '') = ? OR customer_id = ?
                  ORDER BY id DESC`,
            args: [digits, digits, account.customer_id]
        });

        let totalDeposit = 0;
        let totalWithdraw = 0;
        for (const tx of txRes.rows) {
            const amt = Number(tx.amount) || 0;
            if (tx.type === 'deposit') totalDeposit += amt;
            else if (tx.type === 'withdraw') totalWithdraw += amt;
        }

        res.json({
            success: true,
            account,
            summary: {
                total_deposit: totalDeposit,
                total_withdraw: totalWithdraw,
                tx_count: txRes.rows.length
            },
            transactions: txRes.rows
        });
    } catch (err) {
        console.error('Card Transaction Lookup Error:', err);
        res.status(500).json({ success: false, message: 'Failed to load card transaction history.' });
    }
});
router.get('/public/:token', async (req, res) => {
    try {
        await bankTablesReady;
        const token = String(req.params.token || '').trim();

        const resDb = await db.execute({
            sql: `SELECT card_number, card_level FROM bank_accounts WHERE qr_token = ?`,
            args: [token]
        });

        if (resDb.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Card not found or invalid QR code.'
            });
        }

        const row = resDb.rows[0];
        res.json({
            success: true,
            locked: true,
            data: {
                masked_card: maskCardNumber(row.card_number),
                card_level: row.card_level
            }
        });
    } catch (err) {
        console.error('Public Card Check Error:', err);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});
router.post('/public/:token/unlock', async (req, res) => {
    try {
        await bankTablesReady;
        const token = String(req.params.token || '').trim();
        const pin = String((req.body || {}).pin || '').trim();

        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 6-digit PIN.'
            });
        }

        const attemptKey = `${token}:${req.ip || 'unknown'}`;
        const now = Date.now();
        const record = pinAttempts.get(attemptKey);

        if (record && record.lockedUntil && record.lockedUntil > now) {
            const minsLeft = Math.ceil((record.lockedUntil - now) / 60000);
            return res.status(429).json({
                success: false,
                message: `Too many incorrect attempts. Please try again in ${minsLeft} minute(s).`
            });
        }

        const resDb = await db.execute({
            sql: `SELECT card_number, member_since, name, phone, card_level, balance, pin_code, photo_url
                  FROM bank_accounts
                  WHERE qr_token = ?`,
            args: [token]
        });

        if (resDb.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Card not found or invalid QR code.'
            });
        }

        const account = resDb.rows[0];

        if (String(account.pin_code || '').trim() !== pin) {
            const fails = (record && (!record.lockedUntil || record.lockedUntil <= now) ? record.fails : 0) + 1;
            if (fails >= MAX_PIN_ATTEMPTS) {
                pinAttempts.set(attemptKey, { fails, lockedUntil: now + PIN_LOCK_MS });
                return res.status(429).json({
                    success: false,
                    message: 'Too many incorrect PIN attempts. Card locked for 5 minutes.'
                });
            }
            pinAttempts.set(attemptKey, { fails, lockedUntil: 0 });
            return res.status(401).json({
                success: false,
                message: `Incorrect PIN. ${MAX_PIN_ATTEMPTS - fails} attempt(s) remaining.`
            });
        }
        pinAttempts.delete(attemptKey);
res.json({
    success: true,
    data: {
        card_number: account.card_number,
        member_since: account.member_since,
        name: account.name,
        phone: account.phone,
        card_level: account.card_level,
        balance: account.balance,
        photo_url: account.photo_url || ''
    }
});
    } catch (err) {
        console.error('Public Card Unlock Error:', err);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

module.exports = router;