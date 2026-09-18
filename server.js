require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");

// Turso Database Client ကို database.js မှ Import လုပ်ခြင်း
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || "acai-shop-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24
  }
}));

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

const otpStore = {};
const resetOtpStore = {};

function auth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Login required"
    });
  }
  next();
}

function adminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      success: false,
      message: "Admin login required"
    });
  }
  next();
}

// ---------------- OTP Send ----------------
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ success: false });
  }

  try {
    const result = await db.execute({
      sql: "SELECT id FROM customers WHERE email=?",
      args: [email]
    });

    const user = result.rows[0];

    if (user) {
      return res.json({
        success: false,
        message: "Email already exists. Please Sign In."
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = otp;

    await transporter.sendMail({
      from: `"Acai Shop" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Verify your Acai Shop account",
      html: `
<div style="margin:0;padding:40px;background:url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg.jpg.jpg') center/cover no-repeat;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="420" cellpadding="0" cellspacing="0" style="background:rgba(17,24,39,.82);backdrop-filter:blur(12px);border-radius:30px;padding:34px;text-align:center;border:1px solid rgba(255,255,255,.15);">
          <tr>
            <td>
              <div style="width:90px;height:90px;border-radius:50%;background:white;border:8px solid #E8ECFF;margin:0 auto 18px;display:flex;justify-content:center;align-items:center;overflow:hidden;">
                <img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/logo.jpg.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">
              </div>
              <h1 style="margin:0;color:white;font-size:34px;font-weight:700;">Acai Shop</h1>
              <p style="color:#CBD5E1;font-size:17px;margin:14px 0 28px;">Verify your email address</p>
              <div style="background:#1F2937;border:2px solid #3B82F6;border-radius:24px;padding:22px;">
                <div style="font-size:14px;letter-spacing:4px;color:#6C8CFF;margin-bottom:10px;">VERIFICATION CODE</div>
                <div style="font-size:58px;font-weight:800;letter-spacing:12px;color:white;">${otp}</div>
              </div>
              <p style="color:#CBD5E1;font-size:18px;line-height:1.6;margin:34px 0 26px;">Enter this code in <b style="color:white;">Acai Shop</b> to finish creating your account.</p>
              <div style="display:inline-block;background:#1E3A8A;border-radius:999px;padding:14px 26px;font-size:18px;color:#FDE68A;">⏱ Expires in 5 minutes</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`
    });

    res.json({ success: true });
  } catch (e) {
    console.log(e);
    res.json({ success: false });
  }
});

// ---------------- Verify OTP ----------------
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore[email] === otp) {
    return res.json({ success: true });
  }

  res.json({ success: false });
});

// ---------------- Register ----------------
app.post("/register", async (req, res) => {
  const { username, email, password, otp } = req.body;

  if (otpStore[email] !== otp) {
    return res.json({
      success: false,
      message: "Wrong OTP"
    });
  }

  delete otpStore[email];

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await db.execute({
      sql: "INSERT INTO customers(username,email,password) VALUES(?,?,?)",
      args: [username || "", email, hash]
    });

    req.session.userId = Number(result.lastInsertRowid);
    res.json({ success: true });
  } catch (err) {
    res.json({
      success: false,
      message: "Email already exists"
    });
  }
});

// ---------------- Forgot Password ----------------
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({
      success: false,
      message: "Email is required."
    });
  }

  try {
    const result = await db.execute({
      sql: "SELECT id FROM customers WHERE email=?",
      args: [email]
    });

    const user = result.rows[0];

    if (!user) {
      return res.json({
        success: false,
        message: "Account not found. Please create an account first."
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    resetOtpStore[email] = otp;

    setTimeout(() => {
      if (resetOtpStore[email] === otp) {
        delete resetOtpStore[email];
      }
    }, 5 * 60 * 1000);

    await transporter.sendMail({
      from: `"Acai Shop" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Reset Your Acai Shop Password",
      html: `
<div style="margin:0;padding:40px;background:url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg.jpg.jpg') center/cover no-repeat;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="420" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:30px;padding:34px;text-align:center;border:1px solid rgba(255,255,255,.15);">
          <tr>
            <td>
              <div style="width:90px;height:90px;border-radius:50%;background:white;border:8px solid #E8ECFF;margin:0 auto 18px;overflow:hidden;">
                <img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/logo.jpg.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">
              </div>
              <h1 style="margin:0;color:white;font-size:34px;font-weight:700;">Acai Shop</h1>
              <p style="color:#CBD5E1;font-size:17px;margin:14px 0 28px;">Reset your password</p>
              <div style="background:#1F2937;border:2px solid #3B82F6;border-radius:24px;padding:22px;">
                <div style="font-size:14px;letter-spacing:4px;color:#6C8CFF;margin-bottom:10px;">VERIFICATION CODE</div>
                <div style="font-size:58px;font-weight:800;letter-spacing:12px;color:white;">${otp}</div>
              </div>
              <p style="color:#CBD5E1;font-size:18px;line-height:1.6;margin:34px 0 26px;">Enter this code in <b style="color:white;">Acai Shop</b> to reset your password.</p>
              <div style="display:inline-block;background:#1E3A8A;border-radius:999px;padding:14px 26px;font-size:18px;color:#FDE68A;">⏱ Expires in 5 minutes</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`
    });

    res.json({ success: true });
  } catch (error) {
    console.log("Forgot password email error:", error);
    if (resetOtpStore[email]) delete resetOtpStore[email];
    res.json({
      success: false,
      message: "Failed to send OTP."
    });
  }
});

// ---------------- Reset Password ----------------
app.post("/reset-password", async (req, res) => {
  const { email, otp, password } = req.body;

  if (!email || !otp) {
    return res.json({
      success: false,
      message: "Please fill all fields."
    });
  }

  if (!resetOtpStore[email]) {
    return res.json({
      success: false,
      message: "OTP expired. Please request a new OTP."
    });
  }

  if (password === "__VERIFY__") {
    if (resetOtpStore[email] !== otp) {
      return res.json({
        success: false,
        verified: false,
        message: "Wrong OTP."
      });
    }

    return res.json({
      success: true,
      verified: true,
      message: "OTP verified."
    });
  }

  if (resetOtpStore[email] !== otp) {
    return res.json({
      success: false,
      message: "Wrong OTP."
    });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    await db.execute({
      sql: "UPDATE customers SET password=? WHERE email=?",
      args: [hash, email]
    });

    delete resetOtpStore[email];

    res.json({
      success: true,
      message: "Password updated successfully."
    });
  } catch {
    res.json({
      success: false,
      message: "Server error."
    });
  }
});

// ---------------- Login ----------------
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.execute({
      sql: "SELECT * FROM customers WHERE email=?",
      args: [email]
    });

    const user = result.rows[0];

    if (!user) {
      return res.json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.json({
        success: false,
        message: "Invalid email or password"
      });
    }

    req.session.userId = user.id;
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Database error" });
  }
});

// ---------------- Current User ----------------
app.get("/me", auth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id,username,email,phone,address FROM customers WHERE id=?",
      args: [req.session.userId]
    });

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ loggedIn: false });
    }

    res.json({ loggedIn: true, user });
  } catch (err) {
    res.status(401).json({ loggedIn: false });
  }
});

// ---------------- Logout ----------------
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ---------------- Products ----------------

// Product List
app.get("/products", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// Add Product
app.post("/add-product", upload.single("image"), async (req, res) => {
  const { name, price, stock, description } = req.body;
  const image = req.file ? req.file.filename : "";

  try {
    const result = await db.execute({
      sql: `INSERT INTO products(name,price,stock,image,description) VALUES(?,?,?,?,?)`,
      args: [name, Number(price), Number(stock), image, description]
    });

    res.json({
      success: true,
      id: Number(result.lastInsertRowid)
    });
  } catch (err) {
    res.json({ success: false });
  }
});

// Update Product
app.put("/update-product/:id", async (req, res) => {
  const { name, price, stock, description } = req.body;

  try {
    await db.execute({
      sql: `UPDATE products SET name=?,price=?,stock=?,description=? WHERE id=?`,
      args: [name, Number(price), Number(stock), description, req.params.id]
    });

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Delete Product
app.delete("/delete-product/:id", async (req, res) => {
  try {
    await db.execute({
      sql: "DELETE FROM products WHERE id=?",
      args: [req.params.id]
    });

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ---------------- Checkout ----------------
app.post("/place-order", auth, async (req, res) => {
  const {
    name,
    phone,
    city,
    township,
    road,
    building,
    address,
    payment,
    cart
  } = req.body;

  if (!cart || cart.length === 0) {
    return res.json({
      success: false,
      message: "Cart is empty"
    });
  }

  let total = 0;
  for (const item of cart) {
    total += Number(item.price) * Number(item.qty);
  }

  const fullAddress = `${city}, ${township}, ${road}, ${building || ""}, ${address}`;

  try {
    // Stock Check
    const ids = cart.map(() => "?").join(",");
    const productsRes = await db.execute({
      sql: `SELECT id,name,stock FROM products WHERE name IN (${ids})`,
      args: cart.map(i => i.name)
    });

    const products = productsRes.rows;

    for (const item of cart) {
      const p = products.find(x => x.name === item.name);
      if (!p || p.stock < item.qty) {
        return res.json({
          success: false,
          message: `${item.name} out of stock`
        });
      }
    }

    // Get Customer Email
    const userRes = await db.execute({
      sql: "SELECT email FROM customers WHERE id=?",
      args: [req.session.userId]
    });
    const user = userRes.rows[0];

    // Insert Order
    const orderRes = await db.execute({
      sql: `INSERT INTO orders(customer,email,phone,address,items,total,status) VALUES(?,?,?,?,?,?,?)`,
      args: [
        name,
        user.email,
        phone,
        fullAddress,
        JSON.stringify(cart),
        total,
        "Pending"
      ]
    });

    // Reduce Stock
    for (const item of cart) {
      await db.execute({
        sql: `UPDATE products SET stock = stock - ? WHERE name=?`,
        args: [item.qty, item.name]
      });
    }

    res.json({
      success: true,
      orderId: Number(orderRes.lastInsertRowid)
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

// ---------------- Admin: Orders ----------------
app.get("/admin/orders", adminAuth, async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

// ---------------- Admin: Customers ----------------
app.get("/admin/customers", adminAuth, async (req, res) => {
  try {
    const result = await db.execute(
      "SELECT id, username, email, phone, address, created_at FROM customers ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

// ---------------- Admin: Update Order Status ----------------
app.put("/admin/orders/:id/status", adminAuth, async (req, res) => {
  const { status } = req.body;

  const allowed = [
    "Pending",
    "Confirmed",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled"
  ];

  if (!allowed.includes(status)) {
    return res.json({
      success: false,
      message: "Invalid status"
    });
  }

  try {
    await db.execute({
      sql: "UPDATE orders SET status=? WHERE id=?",
      args: [status, req.params.id]
    });

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

// ---------------- Admin: Order Details ----------------
app.get("/admin/orders/:id", adminAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT * FROM orders WHERE id=?",
      args: [req.params.id]
    });

    const row = result.rows[0];

    if (!row) {
      return res.status(404).json({ success: false });
    }

    res.json({
      ...row,
      items: JSON.parse(row.items || "[]")
    });
  } catch (err) {
    res.status(404).json({ success: false });
  }
});

// ---------------- Admin: Delete Order ----------------
app.delete("/admin/orders/:id", adminAuth, async (req, res) => {
  try {
    await db.execute({
      sql: "DELETE FROM orders WHERE id=?",
      args: [req.params.id]
    });

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

// ---------------- Admin: Delete Customer ----------------
app.delete("/admin/customers/:id", adminAuth, async (req, res) => {
  try {
    await db.execute({
      sql: "DELETE FROM customers WHERE id=?",
      args: [req.params.id]
    });

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ---------------- Profile ----------------
app.get("/profile", auth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, username, email, phone, address FROM customers WHERE id=?",
      args: [req.session.userId]
    });

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ success: false });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(404).json({ success: false });
  }
});

// ---------------- Update Profile ----------------
app.put("/profile", auth, async (req, res) => {
  const { username, phone, address } = req.body;

  try {
    await db.execute({
      sql: "UPDATE customers SET username=?, phone=?, address=? WHERE id=?",
      args: [username || "", phone || "", address || "", req.session.userId]
    });

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

// ---------------- My Orders ----------------
app.get("/my-orders", auth, async (req, res) => {
  try {
    const userRes = await db.execute({
      sql: "SELECT email FROM customers WHERE id=?",
      args: [req.session.userId]
    });

    const user = userRes.rows[0];

    if (!user) {
      return res.json([]);
    }

    const ordersRes = await db.execute({
      sql: "SELECT * FROM orders WHERE email=? ORDER BY id DESC",
      args: [user.email]
    });

    res.json(ordersRes.rows);
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

// ---------------- Dashboard Stats ----------------
app.get("/admin/dashboard", adminAuth, async (req, res) => {
  try {
    const ordersRes = await db.execute("SELECT COUNT(*) AS totalOrders FROM orders");
    const customersRes = await db.execute("SELECT COUNT(*) AS totalCustomers FROM customers");
    const productsRes = await db.execute("SELECT COUNT(*) AS totalProducts FROM products");
    const revenueRes = await db.execute(
      "SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE status!='Cancelled'"
    );
    const allOrdersRes = await db.execute(
      "SELECT items,total,created_at FROM orders WHERE status!='Cancelled'"
    );

    const orders = ordersRes.rows[0];
    const customers = customersRes.rows[0];
    const products = productsRes.rows[0];
    const revenue = revenueRes.rows[0];
    const allOrders = allOrdersRes.rows || [];

    const seller = {};
    const weekly = {};

    allOrders.forEach(o => {
      const day = (o.created_at || "").split(" ")[0];
      weekly[day] = (weekly[day] || 0) + Number(o.total || 0);

      try {
        JSON.parse(o.items || "[]").forEach(i => {
          seller[i.name] = (seller[i.name] || 0) + Number(i.qty || 0);
        });
      } catch {}
    });

    let bestProduct = "-";
    let max = 0;

    Object.entries(seller).forEach(([name, qty]) => {
      if (qty > max) {
        max = qty;
        bestProduct = name;
      }
    });

    res.json({
      totalOrders: orders?.totalOrders || 0,
      totalCustomers: customers?.totalCustomers || 0,
      totalProducts: products?.totalProducts || 0,
      revenue: revenue?.revenue || 0,
      bestProduct,
      weekly
    });
  } catch (err) {
    console.log(err);
    res.json({
      totalOrders: 0,
      totalCustomers: 0,
      totalProducts: 0,
      revenue: 0,
      bestProduct: "-",
      weekly: {}
    });
  }
});

// ---------------- Revenue Chart ----------------
app.get("/admin/revenue", async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT
        DATE(created_at) AS date,
        COALESCE(SUM(total),0) AS revenue
      FROM orders
      WHERE status != 'Cancelled'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

// ---------------- New Order Notification ----------------
app.get("/admin/new-orders", async (req, res) => {
  try {
    const result = await db.execute(
      "SELECT COUNT(*) AS count FROM orders WHERE status='Pending'"
    );

    res.json({
      count: result.rows[0]?.count || 0
    });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// ---------------- Admin Auth Routes ----------------
app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;
  const adminUsername = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASS || "admin123";

  if (username === adminUsername && password === adminPassword) {
    req.session.admin = true;
    return res.json({ success: true });
  }

  res.json({
    success: false,
    message: "Invalid admin login"
  });
});

app.get("/admin-check", (req, res) => {
  res.json({
    loggedIn: !!req.session.admin
  });
});

app.post("/admin-logout", (req, res) => {
  req.session.admin = false;
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});