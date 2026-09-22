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

// ---------------- Turso ----------------

const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------------- DB Wrapper ----------------

const db = {
  get: (sql, params = [], callback) => {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }

    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(r => {
        const row = r.rows[0] ? { ...r.rows[0] } : null;
        callback && callback(null, row);
        return row;
      })
      .catch(err => {
        console.log(err);
        callback && callback(err);
      });
  },

  all: (sql, params = [], callback) => {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }

    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(r => {
        const rows = r.rows.map(x => ({ ...x }));
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
      .then(r => {
        const info = {
          lastID: Number(r.lastInsertRowid),
          changes: Number(r.rowsAffected)
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

// ---------------- Middlewares ----------------

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

// ---------------- Upload ----------------

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// ---------------- Stores ----------------

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

// ---------------- Register OTP ----------------

app.post("/send-otp", (req, res) => {

  const email = (req.body.email || "").trim().toLowerCase();

  if (!email) {
    return res.json({
      success: false,
      message: "Email is required."
    });
  }

  db.get(
    "SELECT id FROM customers WHERE LOWER(email)=LOWER(?)",
    [email],
    async (err, user) => {

      if (err) {
        return res.json({
          success: false,
          message: "Database error."
        });
      }

      if (user) {
        return res.json({
          success: false,
          message: "Email already exists. Please Sign In."
        });
      }

      const otp = Math.floor(
        100000 + Math.random() * 900000
      ).toString();

      otpStore[email] = otp;

      setTimeout(() => {
        if (otpStore[email] === otp) {
          delete otpStore[email];
        }
      }, 5 * 60 * 1000);

      try {

        await resend.emails.send({
          from: "Acai Shop <support@acaishopmm.store>",
          to: email,
          subject: "Verify your Acai Shop account",

          html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<style>
@media only screen and (max-width:600px){

body{
background-image:url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg-mobile.jpg') !important;
background-repeat:no-repeat !important;
background-position:center top !important;
background-size:cover !important;
}

.wrapper{padding:24px 12px !important;}
.card{max-width:340px !important;padding:24px !important;border-radius:24px !important;}
.logo{width:76px !important;height:76px !important;border-width:6px !important;}
.title{font-size:28px !important;}
.subtitle{font-size:15px !important;margin:10px 0 20px !important;}
.otp-box{padding:18px !important;border-radius:18px !important;}
.otp-code{font-size:42px !important;letter-spacing:8px !important;}
.message{font-size:15px !important;margin:20px 0 16px !important;}
.expire{padding:10px 18px !important;font-size:14px !important;}
.footer{font-size:11px !important;margin-top:18px !important;}
}
</style>
</head>

<body style="margin:0;padding:0;background:#0b1220 url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg-desktop.jpg') center/cover no-repeat;font-family:Arial,sans-serif;">

<div class="wrapper" style="padding:40px 15px;">
<table width="100%"><tr><td align="center">

<table class="card" width="420" style="max-width:420px;width:100%;background:#111827;border-radius:30px;padding:34px;text-align:center;border:1px solid rgba(255,255,255,.15);">
<tr><td>

<div class="logo" style="width:90px;height:90px;border-radius:50%;background:#fff;border:8px solid #E8ECFF;margin:0 auto 18px;overflow:hidden;">
<img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">
</div>

<h1 class="title" style="margin:0;color:#fff;font-size:34px;">Acai Shop</h1>

<p class="subtitle" style="color:#CBD5E1;font-size:17px;margin:14px 0 28px;">
Verify your email address
</p>

<div class="otp-box" style="background:#1F2937;border:2px solid #3B82F6;border-radius:24px;padding:22px;">

<div style="font-size:14px;letter-spacing:4px;color:#6C8CFF;margin-bottom:10px;">
VERIFICATION CODE
</div>

<div class="otp-code" style="font-size:58px;font-weight:800;letter-spacing:12px;color:#fff;">
${otp}
</div>

</div>

<p class="message" style="color:#CBD5E1;font-size:18px;line-height:1.6;margin:34px 0 26px;">
Enter this code in <b style="color:#fff;">Acai Shop</b> to finish creating your account.
</p>

<div class="expire" style="display:inline-block;background:#1E3A8A;border-radius:999px;padding:14px 26px;font-size:18px;color:#FDE68A;">
⏱ Expires in 5 minutes
</div>

<p class="footer" style="color:#64748B;font-size:12px;line-height:1.5;margin:28px 0 0;">
If you did not request this code, you can safely ignore this email.
</p>

</td></tr></table>

</td></tr></table>
</div>

</body>
</html>
`
        });

        res.json({
          success: true,
          message: "Verification code sent."
        });

      } catch (error) {

        if (otpStore[email] === otp) {
          delete otpStore[email];
        }

        res.json({
          success: false,
          message: "Failed to send verification code."
        });

      }

    }

  );

});
// ---------------- Verify OTP ----------------

app.post("/verify-otp", (req, res) => {

  const email = (req.body.email || "").trim().toLowerCase();
  const otp = (req.body.otp || "").trim();

  if (!email || !otp) {
    return res.json({
      success: false,
      message: "Please enter the verification code."
    });
  }

  if (otpStore[email] && otpStore[email] === otp) {
    return res.json({
      success: true,
      message: "OTP verified."
    });
  }

  res.json({
    success: false,
    message: "Wrong or expired OTP."
  });

});

// ---------------- Register ----------------

app.post("/register", async (req, res) => {

  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const otp = (req.body.otp || "").trim();

  if (!email || !password || !otp) {
    return res.json({
      success: false,
      message: "Please fill all required fields."
    });
  }

  if (!otpStore[email] || otpStore[email] !== otp) {
    return res.json({
      success: false,
      message: "Wrong or expired OTP."
    });
  }

  try {

    const existingUser = await db.get(
      "SELECT id FROM customers WHERE LOWER(email)=LOWER(?)",
      [email]
    );

    if (existingUser) {
      delete otpStore[email];
      return res.json({
        success: false,
        message: "Email already exists. Please Sign In."
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await db.run(
      "INSERT INTO customers(username,email,password) VALUES(?,?,?)",
      [username, email, hash]
    );

    delete otpStore[email];
    req.session.userId = result.lastID;

    res.json({
      success: true,
      message: "Account created successfully."
    });

  } catch (error) {

    console.error("REGISTER ERROR:", error);

    res.json({
      success: false,
      message: "Failed to create account."
    });

  }

});

// ---------------- Forgot Password ----------------

app.post("/forgot-password", (req, res) => {

  const email = (req.body.email || "").trim().toLowerCase();

  if (!email) {
    return res.json({
      success: false,
      message: "Email is required."
    });
  }

  db.get(
    "SELECT id FROM customers WHERE LOWER(email)=LOWER(?)",
    [email],
    async (err, user) => {

      if (err) {
        return res.json({
          success: false,
          message: "Database error."
        });
      }

      if (!user) {
        return res.json({
          success: false,
          message: "Account not found. Please create an account first."
        });
      }

      const otp = Math.floor(
        100000 + Math.random() * 900000
      ).toString();

      resetOtpStore[email] = otp;

      setTimeout(() => {
        if (resetOtpStore[email] === otp) {
          delete resetOtpStore[email];
        }
      }, 5 * 60 * 1000);

      try {

        await resend.emails.send({
          from: "Acai Shop <support@acaishopmm.store>",
          to: email,
          subject: "Reset Your Acai Shop Password",

          html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<style>
@media only screen and (max-width:600px){

body{
background-image:url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg-mobile.jpg') !important;
background-repeat:no-repeat !important;
background-position:center top !important;
background-size:cover !important;
}

.wrapper{padding:24px 12px !important;}
.card{max-width:340px !important;padding:24px !important;border-radius:24px !important;}
.logo{width:76px !important;height:76px !important;border-width:6px !important;}
.title{font-size:28px !important;}
.subtitle{font-size:15px !important;margin:10px 0 20px !important;}
.otp-box{padding:18px !important;border-radius:18px !important;}
.otp-code{font-size:42px !important;letter-spacing:8px !important;}
.message{font-size:15px !important;margin:20px 0 16px !important;}
.expire{padding:10px 18px !important;font-size:14px !important;}
.footer{font-size:11px !important;margin-top:18px !important;}
}
</style>
</head>

<body style="margin:0;padding:0;background:#0b1220 url('https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/bg-desktop.jpg') center/cover no-repeat;font-family:Arial,sans-serif;">

<div class="wrapper" style="padding:40px 15px;">

<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center">

<table class="card" width="420" cellpadding="0" cellspacing="0" border="0"
style="max-width:420px;width:100%;background:#111827;border-radius:30px;padding:34px;text-align:center;border:1px solid rgba(255,255,255,.15);">

<tr>
<td>

<div class="logo"
style="width:90px;height:90px;border-radius:50%;background:#fff;border:8px solid #E8ECFF;margin:0 auto 18px;overflow:hidden;">
<img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg"
style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">
</div>

<h1 class="title" style="margin:0;color:#fff;font-size:34px;">Acai Shop</h1>

<p class="subtitle" style="color:#CBD5E1;font-size:17px;margin:14px 0 28px;">
Reset your password
</p>

<div class="otp-box"
style="background:#1F2937;border:2px solid #3B82F6;border-radius:24px;padding:22px;">

<div style="font-size:14px;letter-spacing:4px;color:#6C8CFF;margin-bottom:10px;">
VERIFICATION CODE
</div>

<div class="otp-code"
style="font-size:58px;font-weight:800;letter-spacing:12px;color:#fff;">
${otp}
</div>

</div>

<p class="message"
style="color:#CBD5E1;font-size:18px;line-height:1.6;margin:34px 0 26px;">
Enter this code in
<b style="color:#fff;">Acai Shop</b>
to reset your password.
</p>

<div class="expire"
style="display:inline-block;background:#1E3A8A;border-radius:999px;padding:14px 26px;font-size:18px;color:#FDE68A;">
⏱ Expires in 5 minutes
</div>

<p class="footer"
style="color:#64748B;font-size:12px;line-height:1.5;margin:28px 0 0;">
If you did not request this code,
you can safely ignore this email.
</p>

</td>
</tr>

</table>

</td>
</tr>

</table>

</div>

</body>
</html>
`
        });

        res.json({
          success: true,
          message: "Password reset code sent."
        });

      } catch (error) {

        if (resetOtpStore[email] === otp) {
          delete resetOtpStore[email];
        }

        res.json({
          success: false,
          message: "Failed to send OTP."
        });

      }

    }

  );

});
// ---------------- Reset Password ----------------

app.post("/reset-password", async (req, res) => {

  const email = (req.body.email || "").trim().toLowerCase();
  const otp = (req.body.otp || "").trim();
  const password = req.body.password || "";

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

  // Verify OTP only
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
      message: "Wrong or expired OTP."
    });
  }

  if (!password) {
    return res.json({
      success: false,
      message: "Password is required."
    });
  }

  try {

    const user = await db.get(
      "SELECT id FROM customers WHERE LOWER(email)=LOWER(?)",
      [email]
    );

    if (!user) {
      delete resetOtpStore[email];

      return res.json({
        success: false,
        message: "Account not found."
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.run(
      "UPDATE customers SET password=? WHERE email=?",
      [hash, email]
    );

    delete resetOtpStore[email];

    res.json({
      success: true,
      message: "Password updated successfully."
    });

  } catch (error) {

    console.error("RESET PASSWORD ERROR:", error);

    res.json({
      success: false,
      message: "Failed to reset password."
    });

  }

});

// ---------------- Login ----------------

app.post("/login", (req, res) => {

  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  db.get(
    "SELECT * FROM customers WHERE LOWER(email)=LOWER(?)",
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

      res.json({
        success: true
      });

    }
  );

});

// ---------------- Current User ----------------

app.get("/me", auth, (req, res) => {

  db.get(
    "SELECT id,username,email,phone,address FROM customers WHERE id=?",
    [req.session.userId],
    (err, user) => {

      if (!user) {
        return res.json({
          loggedIn: false
        });
      }

      res.json({
        loggedIn: true,
        user
      });

    }
  );

});

// ---------------- Logout ----------------

app.post("/logout", (req, res) => {

  req.session.destroy(() => {

    res.json({
      success: true
    });

  });

});

// ---------------- Products ----------------

app.get("/products", (req, res) => {

  db.all(
    "SELECT * FROM products ORDER BY id DESC",
    [],
    (err, rows) => {

      res.json(rows || []);

    }
  );

});

app.post("/add-product", upload.single("image"), (req, res) => {

  const { name, price, stock, description } = req.body;
  const image = req.file ? req.file.filename : "";

  db.run(
    `INSERT INTO products(name,price,stock,image,description)
     VALUES(?,?,?,?,?)`,
    [name, Number(price), Number(stock), image, description],
    function (err) {

      if (err) {
        return res.json({
          success: false
        });
      }

      res.json({
        success: true,
        id: this.lastID
      });

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

      res.json({
        success: true
      });

    }
  );

});

app.delete("/delete-product/:id", (req, res) => {

  db.run(
    "DELETE FROM products WHERE id=?",
    [req.params.id],
    function () {

      res.json({
        success: true
      });

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
        return res.json({
          success: false
        });
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

      res.json({
        success: true
      });

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
      return res.json({
        success: false,
        message: "Cart is empty"
      });
    }

    let subtotal = 0;

    cart.forEach(item => {
      subtotal += Number(item.price) * Number(item.qty);
    });

    const deliveryFee = Number(deliFee) || 0;
    const total = subtotal + deliveryFee;

    const fullAddress =
      `${road || ""}, ${building || ""}, ${address || ""}`.trim();

    const userResult = await tursoClient.execute({
      sql: "SELECT email FROM customers WHERE id=?",
      args: [req.session.userId]
    });

    if (userResult.rows.length === 0) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    const userEmail = userResult.rows[0].email;

    for (const item of cart) {

      const p = await tursoClient.execute({
        sql: "SELECT stock FROM products WHERE name=?",
        args: [item.name]
      });

      if (
        p.rows.length === 0 ||
        p.rows[0].stock < item.qty
      ) {

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

// ---------------- Admin Orders ----------------

app.get("/admin/orders", adminAuth, (req, res) => {

  db.all(
    "SELECT * FROM orders ORDER BY id DESC",
    [],
    (err, rows) => res.json(rows || [])
  );

});

app.get("/admin/orders/:id", adminAuth, (req, res) => {

  db.get(
    "SELECT * FROM orders WHERE id=?",
    [req.params.id],
    (err, row) => {

      if (!row) {
        return res.status(404).json({ success: false });
      }

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

// ---------------- Dashboard ----------------

app.get("/admin/dashboard", adminAuth, async (req, res) => {

  try {

    const orders =
      await db.get("SELECT COUNT(*) AS totalOrders FROM orders");

    const customers =
      await db.get("SELECT COUNT(*) AS totalCustomers FROM customers");

    const products =
      await db.get("SELECT COUNT(*) AS totalProducts FROM products");

    const revenue = await db.get(`
      SELECT COALESCE(SUM(total-COALESCE(deli_fee,0)),0)
      AS productRevenue
      FROM orders
      WHERE status!='Cancelled'
    `);

    const delivery = await db.get(`
      SELECT COALESCE(SUM(deli_fee),0)
      AS deliveryRevenue
      FROM orders
      WHERE status!='Cancelled'
    `);

    const today = await db.get(`
      SELECT COALESCE(SUM(total-COALESCE(deli_fee,0)),0)
      AS todayRevenue
      FROM orders
      WHERE status!='Cancelled'
      AND DATE(created_at)=DATE('now','localtime')
    `);

    const allOrders = await db.all(`
      SELECT items,total,created_at
      FROM orders
      WHERE status!='Cancelled'
    `);

    const seller = {};
    const weekly = {};

    (allOrders || []).forEach(o => {

      const day = (o.created_at || "").split(" ")[0];

      weekly[day] =
        (weekly[day] || 0) + Number(o.total || 0);

      try {

        JSON.parse(o.items || "[]").forEach(i => {

          seller[i.name] =
            (seller[i.name] || 0) + Number(i.qty || 0);

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

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false
    });

  }

});

// ---------------- Revenue ----------------

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

  const adminUser =
    process.env.ADMIN_USER || "admin";

  const adminPass =
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASS ||
    "admin123";

  if (
    username === adminUser &&
    password === adminPass
  ) {

    req.session.admin = true;

    return res.json({
      success: true
    });

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

  res.json({
    success: true
  });

});

// ---------------- Start ----------------

app.listen(PORT, () => {

  console.log(
    `Server running on http://localhost:${PORT}`
  );

});