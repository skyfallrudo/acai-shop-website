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

// Turso Client Setup
const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Resend Email Client Setup
const resend = new Resend(process.env.RESEND_API_KEY);

// Turso SQLite Wrapper
const db = {
  get: (sql, params = [], callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const row = res.rows[0] ? { ...res.rows[0] } : null;
        if (callback) callback(null, row);
        return row;
      })
      .catch(err => {
        console.error("Turso DB Get Error:", err);
        if (callback) callback(err, null);
        else throw err;
      });
  },

  all: (sql, params = [], callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const rows = res.rows.map(r => ({ ...r }));
        if (callback) callback(null, rows);
        return rows;
      })
      .catch(err => {
        console.error("Turso DB All Error:", err);
        if (callback) callback(err, null);
        else throw err;
      });
  },

  run: (sql, params = [], callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    if (!Array.isArray(params)) params = [params];

    return tursoClient.execute({ sql, args: params })
      .then(res => {
        const info = {
          lastID: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
          changes: Number(res.rowsAffected)
        };
        if (callback) callback.call(info, null);
        return info;
      })
      .catch(err => {
        console.error("Turso DB Run Error:", err);
        if (callback) callback(err);
        else throw err;
      });
  },

  exec: (sql, callback) => {
    return tursoClient.executeMultiple(sql)
      .then(() => {
        if (callback) callback(null);
      })
      .catch(err => {
        console.error("Turso DB Exec Error:", err);
        if (callback) callback(err);
        else throw err;
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

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

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

app.post("/send-otp", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ success: false, message: "Email is required" });
  }

  db.get(
    "SELECT id FROM customers WHERE email=?",
    [email],
    async (err, user) => {
      if (err) return res.json({ success: false });

      if (user) {
        return res.json({
          success: false,
          message: "Email already exists. Please Sign In."
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore[email] = otp;

      setTimeout(() => {
        if (otpStore[email] === otp) {
          delete otpStore[email];
        }
      }, 5 * 60 * 1000);

      try {
        await resend.emails.send({
          from: 'Acai Shop <onboarding@resend.dev>',
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
</div>
`
        });

        res.json({ success: true });
      } catch (e) {
        console.log(e);
        res.json({ success: false });
      }
    }
  );
});

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

app.post("/forgot-password", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({
      success: false,
      message: "Email is required."
    });
  }

  db.get(
    "SELECT id FROM customers WHERE email=?",
    [email],
    async (err, user) => {
      if (err) {
        console.log(err);
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

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      resetOtpStore[email] = otp;

      setTimeout(() => {
        if (resetOtpStore[email] === otp) {
          delete resetOtpStore[email];
        }
      }, 5 * 60 * 1000);

      try {
        await resend.emails.send({
          from: 'Acai Shop <onboarding@resend.dev>',
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
</div>
`
        });

        res.json({ success: true });
      } catch (error) {
        console.log("Forgot password email error:", error);
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

    db.run(
      "UPDATE customers SET password=? WHERE email=?",
      [hash, email],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Database error."
          });
        }

        delete resetOtpStore[email];

        res.json({
          success: true,
          message: "Password updated successfully."
        });
      }
    );
  } catch {
    res.json({
      success: false,
      message: "Server error."
    });
  }
});

// ---------------- Login ----------------

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get(
    "SELECT * FROM customers WHERE email=?",
    [email],
    async (err, user) => {
      if (err || !user) {
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
      if (err || !user) {
        return res.status(401).json({
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
    res.json({ success: true });
  });
});

// ---------------- Products ----------------

app.get("/products", (req, res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.post("/add-product", upload.single("image"), (req, res) => {
  const { name, price, stock, description } = req.body;
  const image = req.file ? req.file.filename : "";

  db.run(
    `INSERT INTO products(name,price,stock,image,description) VALUES(?,?,?,?,?)`,
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
    `UPDATE products SET name=?,price=?,stock=?,description=? WHERE id=?`,
    [name, Number(price), Number(stock), description, req.params.id],
    function (err) {
      if (err) return res.json({ success: false });
      res.json({ success: true });
    }
  );
});

app.delete("/delete-product/:id", (req, res) => {
  db.run("DELETE FROM products WHERE id=?", [req.params.id], function (err) {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// ---------------- Checkout ----------------

app.post("/place-order", auth, (req, res) => {
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
  const ids = cart.map(() => "?").join(",");

  db.all(
    `SELECT id,name,stock FROM products WHERE name IN (${ids})`,
    cart.map(i => i.name),
    async (err, products) => {
      if (err) {
        return res.json({ success: false });
      }

      for (const item of cart) {
        const p = products.find(x => x.name === item.name);
        if (!p || p.stock < item.qty) {
          return res.json({
            success: false,
            message: `${item.name} out of stock`
          });
        }
      }

      db.get(
        "SELECT email FROM customers WHERE id=?",
        [req.session.userId],
        async (err2, user) => {
          if (err2 || !user) return res.json({ success: false });

          db.run(
            `INSERT INTO orders(customer,email,phone,address,items,total,status) VALUES(?,?,?,?,?,?,?)`,
            [
              name,
              user.email,
              phone,
              fullAddress,
              JSON.stringify(cart),
              total,
              "Pending"
            ],
            async function (err3) {
              if (err3) {
                return res.json({ success: false });
              }

              const orderId = this.lastID;

              try {
                for (const item of cart) {
                  await db.run(
                    `UPDATE products SET stock = stock - ? WHERE name=?`,
                    [item.qty, item.name]
                  );
                }
                res.json({ success: true, orderId });
              } catch (stockErr) {
                console.error("Stock update error:", stockErr);
                res.json({ success: false, message: "Error updating stock" });
              }
            }
          );
        }
      );
    }
  );
});

// ---------------- Admin: Orders ----------------

app.get("/admin/orders", adminAuth, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
    if (err) {
      console.log(err);
      return res.json([]);
    }
    res.json(rows);
  });
});

// ---------------- Admin: Customers ----------------

app.get("/admin/customers", adminAuth, (req, res) => {
  db.all(
    `SELECT id, username, email, phone, address, created_at FROM customers ORDER BY id DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.log(err);
        return res.json([]);
      }
      res.json(rows);
    }
  );
});

// ---------------- Admin: Update Order Status ----------------

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
    `UPDATE orders SET status=? WHERE id=?`,
    [status, req.params.id],
    function (err) {
      if (err) {
        console.log(err);
        return res.json({ success: false });
      }
      res.json({ success: true });
    }
  );
});

// ---------------- Admin: Order Details ----------------

app.get("/admin/orders/:id", adminAuth, (req, res) => {
  db.get("SELECT * FROM orders WHERE id=?", [req.params.id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ success: false });
    }

    res.json({
      ...row,
      items: JSON.parse(row.items || "[]")
    });
  });
});

// ---------------- Admin: Delete Order ----------------

app.delete("/admin/orders/:id", adminAuth, (req, res) => {
  db.run("DELETE FROM orders WHERE id=?", [req.params.id], function (err) {
    if (err) {
      console.log(err);
      return res.json({ success: false });
    }
    res.json({ success: true });
  });
});

// ---------------- Admin: Delete Customer ----------------

app.delete("/admin/customers/:id", adminAuth, (req, res) => {
  db.run("DELETE FROM customers WHERE id=?", [req.params.id], function (err) {
    if (err) {
      return res.json({ success: false });
    }
    res.json({ success: true });
  });
});

// ---------------- Profile ----------------

app.get("/profile", auth, (req, res) => {
  db.get(
    `SELECT id, username, email, phone, address FROM customers WHERE id=?`,
    [req.session.userId],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ success: false });
      }

      res.json({
        success: true,
        user
      });
    }
  );
});

// ---------------- Update Profile ----------------

app.put("/profile", auth, (req, res) => {
  const { username, phone, address } = req.body;

  db.run(
    `UPDATE customers SET username=?, phone=?, address=? WHERE id=?`,
    [username || "", phone || "", address || "", req.session.userId],
    function (err) {
      if (err) {
        console.log(err);
        return res.json({ success: false });
      }
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
      if (err || !user) {
        return res.json([]);
      }

      db.all(
        `SELECT * FROM orders WHERE email=? ORDER BY id DESC`,
        [user.email],
        (err2, orders) => {
          if (err2) {
            console.log(err2);
            return res.json([]);
          }
          res.json(orders);
        }
      );
    }
  );
});

// ---------------- Dashboard Stats ----------------

app.get("/admin/dashboard", adminAuth, (req, res) => {
  db.get(`SELECT COUNT(*) AS totalOrders FROM orders`, [], (err, orders) => {
    db.get(`SELECT COUNT(*) AS totalCustomers FROM customers`, [], (err2, customers) => {
      db.get(`SELECT COUNT(*) AS totalProducts FROM products`, [], (err3, products) => {
        db.get(
          `SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE status!='Cancelled'`,
          [],
          (err4, revenue) => {
            db.all(
              `SELECT items,total,created_at FROM orders WHERE status!='Cancelled'`,
              [],
              (err5, allOrders) => {
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
                  revenue: revenue?.revenue || 0,
                  bestProduct,
                  weekly
                });
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
    `SELECT DATE(created_at) AS date, COALESCE(SUM(total),0) AS revenue FROM orders WHERE status != 'Cancelled' GROUP BY DATE(created_at) ORDER BY DATE(created_at) ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.log(err);
        return res.json([]);
      }
      res.json(rows);
    }
  );
});

// ---------------- New Order Notification ----------------

app.get("/admin/new-orders", adminAuth, (req, res) => {
  db.get(
    `SELECT COUNT(*) AS count FROM orders WHERE status='Pending'`,
    [],
    (err, row) => {
      if (err) {
        return res.json({ count: 0 });
      }
      res.json({ count: row.count || 0 });
    }
  );
});

// ---------------- Admin Auth Routes ----------------

app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;

  const adminUsername = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "admin123";

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