require("dotenv").config();
const { createClient } = require("@libsql/client");

// Turso Cloud သို့မဟုတ် Local SQLite File နဲ့ ချိတ်ဆက်ခြင်း
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN || ""
});

// Table များ မရှိသေးပါက အလိုအလျောက် ဆောက်ပေးမည့် Function
async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        email TEXT UNIQUE,
        password TEXT,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL,
        stock INTEGER,
        image TEXT,
        description TEXT
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        items TEXT,
        total REAL,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Turso Database connection & tables initialized successfully!");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

initDb();

module.exports = db;