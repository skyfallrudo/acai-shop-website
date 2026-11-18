require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { createClient } = require('@libsql/client');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public')); 


const db = createClient({
    url: process.env.BMK_DATABASE_URL,
    authToken: process.env.BMK_AUTH_TOKEN
});

const JWT_SECRET = process.env.JWT_SECRET || "AcaiShop_Secret_Key_Default";
function generateCustomerId() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let str = '';
    for (let i = 0; i < 3; i++) {
        str += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    const nums = Math.floor(1000 + Math.random() * 9000); // 1000 to 9999
    return `${str}-${nums}`;
}
const verifyAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(403).json({ error: "Unauthorized access" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
};
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    const envUsername = process.env.BANK_ADMIN_USER;
    const envPassword = process.env.BANK_ADMIN_PASS;

    if (!envUsername || !envPassword) {
        return res.status(500).json({ error: "Server Configuration Error: Admin credentials not set in .env" });
    }

    if (username === envUsername && password === envPassword) {
        const token = jwt.sign({ username: envUsername }, JWT_SECRET, { expiresIn: '8h' });

        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ message: "Login successful" });
    } else {
        res.status(401).json({ error: "Username သို့မဟုတ် Password မှားယွင်းနေပါသည်" });
    }
});
app.get('/api/admin/check', verifyAdmin, (req, res) => {
    res.json({ loggedIn: true, admin: req.admin.username });
});
app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ message: "Logged out" });
});
app.get('/api/admin/dashboard-data', verifyAdmin, async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM customers ORDER BY name ASC');
        res.json({ customers: result.rows });
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ error: "Failed to fetch customer data" });
    }
});

app.post('/api/admin/customer/create', verifyAdmin, async (req, res) => {
    const { name, phone } = req.body;
    const customerId = generateCustomerId(); 
    
    try {
        await db.execute({
            sql: 'INSERT INTO customers (id, name, phone, balance, qr_id) VALUES (?, ?, ?, ?, ?)',
            args: [customerId, name, phone, 0, customerId] 
        });
        res.json({ message: "Customer created", customerId });
    } catch (error) {
        console.error("Create Customer Error:", error);
        res.status(400).json({ error: "ဖုန်းနံပါတ် တူနေနိုင်ပါသည်။ ထပ်မံကြိုးစားကြည့်ပါ။" });
    }
});
app.post('/api/admin/customer/balance', verifyAdmin, async (req, res) => {
    const { id, amount, type } = req.body;
    
    try {
        const result = await db.execute({
            sql: 'SELECT balance FROM customers WHERE id = ?',
            args: [id]
        });
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Customer မရှိပါ" });
        
        let currentBalance = result.rows[0].balance;
        let newBalance = type === 'add' ? currentBalance + amount : currentBalance - amount;

        if (newBalance < 0) return res.status(400).json({ error: "လက်ကျန်ငွေ မလုံလောက်ပါ" });

        await db.execute({
            sql: 'UPDATE customers SET balance = ? WHERE id = ?',
            args: [newBalance, id]
        });

        res.json({ message: "Success", newBalance });
    } catch (error) {
        console.error("Balance Update Error:", error);
        res.status(500).json({ error: "Server error during balance update" });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bank Server running on port ${PORT}`));