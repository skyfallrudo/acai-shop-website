require("dotenv").config();

const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Resend } = require("resend");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

// ---------------- Turso Client ----------------
const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// ---------------- Resend ----------------
const resend = new Resend(process.env.RESEND_API_KEY);

// ---------------- Turso Wrapper ----------------
const db = {
  get: (sql, params = [], callback) => {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const row = res.rows[0] ? { ...res.rows[0] } : null;
        callback && callback(null, row);
        return row;
      })
      .catch(err => {
        console.log(err);
        callback && callback(err, null);
      });
  },

  all: (sql, params = [], callback) => {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const rows = res.rows.map(r => ({ ...r }));
        callback && callback(null, rows);
        return rows;
      })
      .catch(err => {
        console.log(err);
        callback && callback(err, []);
      });
  },

  run: (sql, params = [], callback) => {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const info = {
          lastID: Number(res.lastInsertRowid),
          changes: Number(res.rowsAffected)
        };
        callback && callback.call(info, null);
        return info;
      })
      .catch(err => {
        console.log(err);
        callback && callback(err);
      });
  },

  exec: (sql, callback) => {
    return tursoClient.executeMultiple(sql)
      .then(() => callback && callback(null))
      .catch(err => {
        console.log(err);
        callback && callback(err);
      });
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || "acai-shop-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// ---------------- Multer ----------------
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

const otpStore = {};
const resetOtpStore = {};

// ---------------- Auth ----------------
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

// ---------------- Send OTP ----------------
html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#0b1220;font-family:Arial,sans-serif;">

<div style="max-width:500px;margin:40px auto;padding:20px;">

  <div style="background:#111827;border:1px solid #263449;border-radius:18px;
              padding:35px 25px;text-align:center;color:#fff;">

    <h1 style="margin:0 0 8px;font-size:28px;color:#ffffff;">
      Acai Shop
    </h1>

    <p style="margin:0 0 30px;color:#94a3b8;font-size:14px;">
      Account Verification
    </p>

    <p style="font-size:16px;color:#e5e7eb;margin-bottom:25px;">
      Your verification code is:
    </p>

    <div style="display:inline-block;background:#1e293b;
                border:1px solid #334155;border-radius:14px;
                padding:18px 30px;margin-bottom:25px;">

      <span style="font-size:36px;font-weight:700;
                   letter-spacing:8px;color:#ffffff;">
        ${otp}
      </span>

    </div>

    <p style="font-size:14px;color:#94a3b8;line-height:1.6;">
      Enter this code in Acai Shop to finish creating your account.
    </p>

    <div style="margin-top:25px;padding:12px;
                background:#172033;border-radius:10px;
                color:#fbbf24;font-size:13px;">
      ⏱ Expires in 5 minutes
    </div>

    <p style="margin-top:30px;font-size:12px;color:#64748b;">
      If you did not request this code, you can safely ignore this email.
    </p>

  </div>

</div>

</body>
</html>
`
// ---------------- Verify OTP ----------------
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (otpStore[email] && otpStore[email] === otp) {
    return res.json({ success: true });
  }

  res.json({ success: false });
});

// ---------------- Register ----------------
app.post("/register", async (req, res) => {
  const { username, email, password, otp } = req.body;

  if (!otpStore[email] || otpStore[email] !== otp) {
    return res.json({
      success: false,
      message: "Wrong or expired OTP"
    });
  }

  delete otpStore[email];

  const hash = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO customers(username,email,password) VALUES(?,?,?)",
    [username || "", email, hash],
    function (err) {
      if (err) {
        return res.json({
          success: false,
          message: "Email already exists"
        });
      }

      req.session.userId = this.lastID;
      res.json({ success: true });
    }
  );
});

// ---------------- Forgot Password ----------------
html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#0b1220;font-family:Arial,sans-serif;">

<div style="max-width:500px;margin:40px auto;padding:20px;">

  <div style="background:#111827;border:1px solid #263449;border-radius:18px;
              padding:35px 25px;text-align:center;color:#fff;">

    <h1 style="margin:0 0 8px;font-size:28px;color:#ffffff;">
      Acai Shop
    </h1>

    <p style="margin:0 0 30px;color:#94a3b8;font-size:14px;">
     Password Resets
    </p>

    <p style="font-size:16px;color:#e5e7eb;margin-bottom:25px;">
      Your verification code is:
    </p>

    <div style="display:inline-block;background:#1e293b;
                border:1px solid #334155;border-radius:14px;
                padding:18px 30px;margin-bottom:25px;">

      <span style="font-size:36px;font-weight:700;
                   letter-spacing:8px;color:#ffffff;">
        ${otp}
      </span>

    </div>

    <p style="font-size:14px;color:#94a3b8;line-height:1.6;">
      Enter this code in Acai Shop to reset your password.
    </p>

    <div style="margin-top:25px;padding:12px;
                background:#172033;border-radius:10px;
                color:#fbbf24;font-size:13px;">
      ⏱ Expires in 5 minutes
    </div>

    <p style="margin-top:30px;font-size:12px;color:#64748b;">
      If you did not request this code, you can safely ignore this email.
    </p>

  </div>

</div>

</body>
</html>
`

// ---------------- Reset Password ----------------
app.post("/reset-password", async (req, res) => {
  const { email, otp, password } = req.body;

  if (!resetOtpStore[email] || resetOtpStore[email] !== otp) {
    return res.json({
      success: false,
      message: "Wrong or expired OTP."
    });
  }

  const hash = await bcrypt.hash(password, 10);

  db.run(
    "UPDATE customers SET password=? WHERE email=?",
    [hash, email],
    function (err) {
      if (err) return res.json({ success: false });

      delete resetOtpStore[email];

      res.json({
        success: true,
        message: "Password updated successfully."
      });
    }
  );
});

// ---------------- Login ----------------
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get(
    "SELECT * FROM customers WHERE email=?",
    [email],
    async (err, user) => {
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
    }
  );
});

// ---------------- Current User ----------------
app.get("/me", auth, (req, res) => {
  db.get(
    "SELECT id,username,email,phone,address FROM customers WHERE id=?",
    [req.session.userId],
    (err, user) => {
      if (!user) return res.json({ loggedIn: false });
      res.json({ loggedIn: true, user });
    }
  );
});

// ---------------- Logout ----------------
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ---------------- Products ----------------
app.get("/products", (req, res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post("/add-product", upload.single("image"), (req, res) => {
  const { name, price, stock, description } = req.body;
  const image = req.file ? req.file.filename : "";

  db.run(
    `INSERT INTO products(name,price,stock,image,description)
     VALUES(?,?,?,?,?)`,
    [name, Number(price), Number(stock), image, description],
    function (err) {
      if (err) return res.json({ success: false });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.put("/update-product/:id", (req, res) => {
  const { name, price, stock, description } = req.body;

  db.run(
    `UPDATE products
     SET name=?,price=?,stock=?,description=?
     WHERE id=?`,
    [name, Number(price), Number(stock), description, req.params.id],
    function () {
      res.json({ success: true });
    }
  );
});

app.delete("/delete-product/:id", (req, res) => {
  db.run(
    "DELETE FROM products WHERE id=?",
    [req.params.id],
    function () {
      res.json({ success: true });
    }
  );
});

// ---------------- Checkout ----------------
app.post("/place-order", auth, async (req, res) => {
    try {
    const {
      name,
      phone,
      telegram,
      altSocial,
      city,
      township,
      road,
      building,
      address,
      payment_method,
      deliFee,
      cart
    } = req.body;

    if (!cart || cart.length === 0) {
      return res.json({ success: false, message: "Cart is empty" });
    }

    let subtotal = 0;
    cart.forEach(item => {
      subtotal += Number(item.price) * Number(item.qty);
    });

    const deliveryFee = Number(deliFee) || 0;
    const total = subtotal + deliveryFee;
    const fullAddress = `${road || ""}, ${building || ""}, ${address || ""}`.trim();

    const userResult = await tursoClient.execute({
      sql: "SELECT email FROM customers WHERE id=?",
      args: [req.session.userId]
    });

    if (userResult.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const userEmail = userResult.rows[0].email;

    for (const item of cart) {
      const p = await tursoClient.execute({
        sql: "SELECT stock FROM products WHERE name=?",
        args: [item.name]
      });

      if (p.rows.length === 0 || p.rows[0].stock < item.qty) {
        return res.json({
          success: false,
          message: `${item.name} out of stock`
        });
      }
    }

    const insert = await tursoClient.execute({
      sql: `INSERT INTO orders(
        customer,email,phone,telegram,alt_social,address,
        items,total,status,city,township,road,building,
        deli_fee,payment_method
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        name,
        userEmail,
        phone,
        telegram || "",
        altSocial || "",
        fullAddress,
        JSON.stringify(cart),
        total,
        "Pending",
        city || "",
        township || "",
        road || "",
        building || "",
        deliveryFee,
        payment_method || "COD"
      ]
    });

    for (const item of cart) {
      await tursoClient.execute({
        sql: "UPDATE products SET stock=stock-? WHERE name=?",
        args: [item.qty, item.name]
      });
    }

    res.json({
      success: true,
      orderId: Number(insert.lastInsertRowid)
    });

  } catch (err) {
    console.log(err);
    res.json({
      success: false,
      message: "Failed to place order"
    });
  }
});

// ---------------- Admin Orders ----------------

app.get("/admin/orders", adminAuth, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.get("/admin/orders/:id", adminAuth, (req, res) => {
  db.get(
    "SELECT * FROM orders WHERE id=?",
    [req.params.id],
    (err, row) => {
      if (!row) return res.status(404).json({ success: false });

      res.json({
        ...row,
        items: JSON.parse(row.items || "[]")
      });
    }
  );
});

app.put("/admin/orders/:id/status", adminAuth, (req, res) => {
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

  db.run(
    "UPDATE orders SET status=? WHERE id=?",
    [status, req.params.id],
    function () {
      res.json({ success: true });
    }
  );
});

app.delete("/admin/orders/:id", adminAuth, (req, res) => {
  db.run(
    "DELETE FROM orders WHERE id=?",
    [req.params.id],
    function () {
      res.json({ success: true });
    }
  );
});

// ---------------- Customers ----------------

app.get("/admin/customers", adminAuth, (req, res) => {
  db.all(
    `SELECT id,username,email,phone,address,created_at
     FROM customers
     ORDER BY id DESC`,
    [],
    (err, rows) => {
      res.json(rows || []);
    }
  );
});

app.delete("/admin/customers/:id", adminAuth, (req, res) => {
  db.run(
    "DELETE FROM customers WHERE id=?",
    [req.params.id],
    function () {
      res.json({ success: true });
    }
  );
});

// ---------------- Profile ----------------

app.get("/profile", auth, (req, res) => {
  db.get(
    `SELECT id,username,email,phone,address
     FROM customers
     WHERE id=?`,
    [req.session.userId],
    (err, user) => {
      if (!user) {
        return res.json({ success: false });
      }

      res.json({
        success: true,
        user
      });
    }
  );
});

app.put("/profile", auth, (req, res) => {
  const { username, phone, address } = req.body;

  db.run(
    `UPDATE customers
     SET username=?,phone=?,address=?
     WHERE id=?`,
    [username || "", phone || "", address || "", req.session.userId],
    function () {
      res.json({ success: true });
    }
  );
});

// ---------------- My Orders ----------------

app.get("/my-orders", auth, (req, res) => {
  db.get(
    "SELECT email FROM customers WHERE id=?",
    [req.session.userId],
    (err, user) => {
      if (!user) return res.json([]);

      db.all(
        `SELECT *
         FROM orders
         WHERE email=?
         ORDER BY id DESC`,
        [user.email],
        (err2, rows) => {
          res.json(rows || []);
        }
      );
    }
  );
});

// ---------------- Dashboard (Delivery Fee Separated) ----------------

app.get("/admin/dashboard", adminAuth, (req, res) => {

  db.get("SELECT COUNT(*) AS totalOrders FROM orders", [], (e1, orders) => {

    db.get("SELECT COUNT(*) AS totalCustomers FROM customers", [], (e2, customers) => {

      db.get("SELECT COUNT(*) AS totalProducts FROM products", [], (e3, products) => {

        db.get(
          `SELECT
             COALESCE(SUM(total-COALESCE(deli_fee,0)),0)
             AS productRevenue
           FROM orders
           WHERE status!='Cancelled'`,
          [],
          (e4, revenue) => {

            db.get(
              `SELECT
                 COALESCE(SUM(deli_fee),0)
                 AS deliveryRevenue
               FROM orders
               WHERE status!='Cancelled'`,
              [],
              (e5, delivery) => {

                db.get(
                  `SELECT
                     COALESCE(SUM(total-COALESCE(deli_fee,0)),0)
                     AS todayRevenue
                   FROM orders
                   WHERE status!='Cancelled'
                     AND DATE(created_at)=DATE('now','localtime')`,
                  [],
                  (e6, today) => {

                    db.all(
                      `SELECT items,total,created_at
                       FROM orders
                       WHERE status!='Cancelled'`,
                      [],
                      (e7, allOrders) => {

                        const seller = {};
                        const weekly = {};

                        (allOrders || []).forEach(o => {

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

                          todayRevenue: today?.todayRevenue || 0,
                          productRevenue: revenue?.productRevenue || 0,
                          deliveryRevenue: delivery?.deliveryRevenue || 0,

                          bestProduct,
                          weekly
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  });
});

// ---------------- Revenue Chart ----------------

app.get("/admin/revenue", adminAuth, (req, res) => {
  db.all(
    `SELECT
       DATE(created_at) AS date,
       COALESCE(SUM(total),0) AS revenue
     FROM orders
     WHERE status!='Cancelled'
     GROUP BY DATE(created_at)
     ORDER BY DATE(created_at) ASC`,
    [],
    (err, rows) => {
      res.json(rows || []);
    }
  );
});

// ---------------- Pending Orders ----------------

app.get("/admin/new-orders", adminAuth, (req, res) => {
  db.get(
    "SELECT COUNT(*) AS count FROM orders WHERE status='Pending'",
    [],
    (err, row) => {
      res.json({
        count: row?.count || 0
      });
    }
  );
});

// ---------------- Admin Login ----------------

app.post("/admin-login", (req, res) => {

  const { username, password } = req.body;

  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPass =
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASS ||
    "admin123";

  if (username === adminUser && password === adminPass) {
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

// ---------------- Start Server ----------------

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});s