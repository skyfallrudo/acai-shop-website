require("dotenv").config();

const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Resend } = require("resend");
const multer = require("multer");
const path = require("path");
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const PDFDocument = require("pdfkit"); 

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);



const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const resend = new Resend(process.env.RESEND_API_KEY);



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



cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'acai-shop-products',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
  }
});

const upload = multer({ storage });
function generateInvoicePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // 🌟 မြန်မာစာ Font Register လုပ်ခြင်း
    doc.registerFont("MyanmarFont", "fonts/Pyidaungsu-2.5.3_Regular.ttf");

    const primaryDark = "#1E293B";

    // Header Section (Açaí Brand Name & Title) - Logo ကို Async မလုပ်တော့ဘဲ Text ဖြင့် သပ်ရပ်စွာပြခြင်း
    doc.fontSize(28).fillColor("#818CF8").font("Helvetica-Bold").text("Açaí", { align: "center" });
    doc.fontSize(9).fillColor("#64748B").font("Helvetica").text("Official Purchase Invoice & Voucher", { align: "center" });
    doc.moveDown(1.2);

    // Decorative Line
    doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(1);

    // Invoice & Customer Info Box
    doc.fontSize(10).fillColor(primaryDark).font("Helvetica-Bold");
    doc.text(`Invoice ID: #INV-${data.orderId}`, { continued: true });
    doc.text(`Date & Time: ${data.date || new Date().toLocaleString('en-GB', { timeZone: 'Asia/Yangon' })}`, { align: "right" });
    
    // မြန်မာစာပါသော Customer အချက်အလက်များ
    doc.font("MyanmarFont").fontSize(10);
    doc.text(`Customer Name: ${data.name}`);
    doc.text(`Email: ${data.userEmail}`);
    doc.text(`Phone: ${data.phone}`);
    doc.text(`Shipping Address: ${data.fullAddress}`);
    doc.text(`Payment Method: ${data.payment_method}`);
    doc.moveDown(1.5);

    // Table Header with Logo Theme Color
    const tableTop = doc.y;
    doc.rect(40, tableTop - 4, 510, 20).fill("#818CF8");
    
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10);
    doc.text("Item Name", 48, tableTop);
    doc.text("Qty", 320, tableTop, { width: 40, align: "center" });
    doc.text("Price (MMK)", 370, tableTop, { width: 90, align: "right" });
    doc.text("Total (MMK)", 460, tableTop, { width: 80, align: "right" });
    doc.moveDown(1.5);

    // Table Rows
    doc.font("MyanmarFont").fontSize(9).fillColor("#334155");
    let subtotal = 0;
    
    data.cart.forEach((item, index) => {
      const itemTotal = Number(item.price) * Number(item.qty);
      subtotal += itemTotal;
      const y = doc.y;

      if (index % 2 === 0) {
        doc.rect(40, y - 2, 510, 16).fill("#F8FAFC");
        doc.fillColor("#334155");
      }

      doc.text(item.name, 48, y, { width: 260 });
      doc.text(String(item.qty), 320, y, { width: 40, align: "center" });
      doc.text(Number(item.price).toLocaleString(), 370, y, { width: 90, align: "right" });
      doc.text(itemTotal.toLocaleString(), 460, y, { width: 80, align: "right" });
      doc.moveDown(1);
    });

    doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor("#CBD5E1").stroke();
    doc.moveDown(1);

    // Totals Section
    doc.fontSize(10).font("Helvetica").fillColor(primaryDark);
    doc.text(`Subtotal: ${subtotal.toLocaleString()} MMK`, { align: "right" });
    doc.text(`Delivery Fee: ${Number(data.deliveryFee).toLocaleString()} MMK`, { align: "right" });
    doc.moveDown(0.4);
    
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#818CF8");
    doc.text(`Grand Total: ${Number(data.total).toLocaleString()} MMK`, { align: "right" });
    doc.moveDown(2.5);

    // Footer Note
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#475569").text("Thank you for shopping with Açaí Shop!", { align: "center" });
    doc.fontSize(8).fillColor("#94A3B8").text("If you have any questions regarding your order, please contact our support.", { align: "center" });

    doc.end();
  });
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
</head>
<body style="margin:0;padding:0;background-color:#0b1220;font-family:Arial,sans-serif;">
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#0b1220;padding:30px 10px;">
  <tr>
    <td align="center">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:420px;background-color:#111827;border-radius:24px;padding:30px 20px;text-align:center;border:1px solid rgba(255,255,255,0.15);">
        <tr>
          <td align="center">
            <!-- Logo -->
            <table border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td style="width:80px;height:80px;border-radius:50%;background-color:#ffffff;border:4px solid #E8ECFF;overflow:hidden;" align="center" valign="middle">
                  <img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg" width="80" height="80" style="display:block;border-radius:50%;object-fit:cover;" alt="Acai Shop">
                </td>
              </tr>
            </table>

            <h1 style="margin:16px 0 0 0;color:#ffffff;font-size:28px;font-weight:bold;">Acai Shop</h1>
            <p style="color:#CBD5E1;font-size:15px;margin:8px 0 24px 0;">Verify your email address</p>

            <!-- OTP Box -->
            <div style="background-color:#1F2937;border:2px solid #3B82F6;border-radius:18px;padding:20px;margin-bottom:24px;">
              <div style="font-size:12px;letter-spacing:3px;color:#6C8CFF;margin-bottom:8px;font-weight:bold;">VERIFICATION CODE</div>
              <div style="font-size:42px;font-weight:800;letter-spacing:8px;color:#ffffff;line-height:1;">${otp}</div>
            </div>

            <p style="color:#CBD5E1;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Enter this code in <b style="color:#ffffff;">Acai Shop</b> to finish creating your account.</p>

            <!-- Expire Badge -->
            <div style="display:inline-block;background-color:#1E3A8A;border-radius:99px;padding:10px 20px;font-size:14px;color:#FDE68A;font-weight:bold;">
              ⏱ Expires in 5 minutes
            </div>

            <p style="color:#64748B;font-size:11px;line-height:1.4;margin:24px 0 0 0;">If you did not request this code, you can safely ignore this email.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
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
</head>
<body style="margin:0;padding:0;background-color:#0b1220;font-family:Arial,sans-serif;">
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#0b1220;padding:30px 10px;">
  <tr>
    <td align="center">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:420px;background-color:#111827;border-radius:24px;padding:30px 20px;text-align:center;border:1px solid rgba(255,255,255,0.15);">
        <tr>
          <td align="center">
            <!-- Logo -->
            <table border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td style="width:80px;height:80px;border-radius:50%;background-color:#ffffff;border:4px solid #E8ECFF;overflow:hidden;" align="center" valign="middle">
                  <img src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/main/logo.jpg.jpg" width="80" height="80" style="display:block;border-radius:50%;object-fit:cover;" alt="Acai Shop">
                </td>
              </tr>
            </table>

            <h1 style="margin:16px 0 0 0;color:#ffffff;font-size:28px;font-weight:bold;">Acai Shop</h1>
            <p style="color:#CBD5E1;font-size:15px;margin:8px 0 24px 0;">Reset your password</p>

            <!-- OTP Box -->
            <div style="background-color:#1F2937;border:2px solid #3B82F6;border-radius:18px;padding:20px;margin-bottom:24px;">
              <div style="font-size:12px;letter-spacing:3px;color:#6C8CFF;margin-bottom:8px;font-weight:bold;">VERIFICATION CODE</div>
              <div style="font-size:42px;font-weight:800;letter-spacing:8px;color:#ffffff;line-height:1;">${otp}</div>
            </div>

            <p style="color:#CBD5E1;font-size:15px;line-height:1.5;margin:0 0 20px 0;">Enter this code in <b style="color:#ffffff;">Acai Shop</b> to reset your password.</p>

            <!-- Expire Badge -->
            <div style="display:inline-block;background-color:#1E3A8A;border-radius:99px;padding:10px 20px;font-size:14px;color:#FDE68A;font-weight:bold;">
              ⏱ Expires in 5 minutes
            </div>

            <p style="color:#64748B;font-size:11px;line-height:1.4;margin:24px 0 0 0;">If you did not request this code, you can safely ignore this email.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
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



app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true
    });
  });
});


app.get("/products", (req, res) => {
  db.all(
    "SELECT * FROM products ORDER BY id DESC",
    [],
    (err, rows) => {
      res.json(rows || []);
    }
  );
});

app.post("/add-product", adminAuth, (req, res) => {
  upload.single("image")(req, res, async (err) => {

    if (err) {
      console.error("UPLOAD ERROR:", err);
      return res.json({
        success: false,
        message: err.message
      });
    }

    try {
      const { name, price, stock, description } = req.body;
      const image = req.file?.secure_url || req.file?.path || "";

      const result = await db.run(
        `INSERT INTO products(name,price,stock,image,description)
         VALUES(?,?,?,?,?)`,
        [name, Number(price), Number(stock), image, description]
      );

      res.json({
        success: true,
        id: result.lastID,
        image
      });

    } catch (e) {
      console.error("DB ERROR:", e);
      res.json({
        success: false,
        message: "Database error"
      });
    }
  });
});



app.put("/update-product/:id", adminAuth, async (req, res) => {
  try {
    const { name, price, stock, description } = req.body;
    const id = req.params.id;

    if (!name || price === undefined || stock === undefined) {
      return res.json({
        success: false,
        message: "Name, price and stock are required."
      });
    }

    const product = await db.get(
      "SELECT id FROM products WHERE id=?",
      [id]
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    await db.run(
      `UPDATE products
       SET name=?, price=?, stock=?, description=?
       WHERE id=?`,
      [
        name.trim(),
        Number(price),
        Number(stock),
        description || "",
        id
      ]
    );

    res.json({
      success: true,
      message: "Product updated successfully."
    });

  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update product."
    });
  }
});



app.delete("/delete-product/:id", adminAuth, async (req, res) => {
  try {
    const id = req.params.id;

    const product = await db.get(
      "SELECT id FROM products WHERE id=?",
      [id]
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    await db.run(
      "DELETE FROM products WHERE id=?",
      [id]
    );

    res.json({
      success: true,
      message: "Product deleted successfully."
    });

  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete product."
    });
  }
});



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

   const fullAddress = `${road || ""}, ${building || ""}, ${address || ""}, ${township || ""}, ${city || ""}`.trim();

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

    const orderId = Number(insert.lastInsertRowid);

    
    for (const item of cart) {
      await tursoClient.execute({
        sql: "UPDATE products SET stock=stock-? WHERE name=?",
        args: [item.qty, item.name]
      });
    }

    
    try {
      const pdfBuffer = await generateInvoicePDF({
        orderId,
        name,
        userEmail,
        phone,
        fullAddress,
        cart,
        deliveryFee,
        total,
        payment_method: payment_method || "COD"
      });

      await resend.emails.send({
        from: "Acai Shop <support@acaishopmm.store>",
        to: userEmail,
        subject: `Order Confirmation & Invoice #${orderId} - Acai Shop`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #1E293B;">
            <h2 style="color: #2563EB;">Order Confirmed!</h2>
            <p>Dear <b>${name}</b>,</p>
            <p>Thank you for shopping at <b>Acai Shop</b>! We have received your order and attached your official purchase invoice PDF to this email.</p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 15px 0;">
            <p><b>Order ID:</b> #INV-${orderId}</p>
            <p><b>Total Amount:</b> ${total.toLocaleString()} MMK</p>
            <p><b>Payment Method:</b> ${payment_method || "COD"}</p>
            <br>
            <p>Best regards,<br><b>Acai Shop Team</b></p>
          </div>
        `,
        attachments: [
          {
            filename: `Invoice_AcaiShop_${orderId}.pdf`,
            content: pdfBuffer
          }
        ]
      });
    } catch (emailError) {
      console.error("INVOICE EMAIL ERROR:", emailError);
    
    }

    res.json({
      success: true,
      orderId
    });

  } catch (err) {
    console.log(err);
    res.json({
      success: false,
      message: "Failed to place order"
    });
  }
});



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


app.get("/admin/orders/:id/pdf", adminAuth, async (req, res) => {
  try {
    const orderId = req.params.id;


    const orderRow = await db.get("SELECT * FROM orders WHERE id=?", [orderId]);

    if (!orderRow) {
      return res.status(404).send("Order not found");
    }

    let cartItems = [];
    try {
      cartItems = JSON.parse(orderRow.items || "[]");
    } catch (e) {
      cartItems = [];
    }
const pdfBuffer = await generateInvoicePDF({
      orderId: orderRow.id,
      date: orderRow.created_at,
      name: orderRow.customer || "N/A",
      userEmail: orderRow.email || "N/A",
      phone: orderRow.phone || "N/A",
      fullAddress: `${orderRow.road || ""}, ${orderRow.building || ""}, ${orderRow.address || ""}, ${orderRow.township || ""}, ${orderRow.city || ""}`.trim(), 
      deliveryFee: Number(orderRow.deli_fee || 0),
      total: Number(orderRow.total || 0),
      payment_method: orderRow.payment_method || "COD"
    });


    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=Voucher_Order_${orderRow.id}.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("ADMIN PDF GENERATE ERROR:", err);
    res.status(500).send("Error generating PDF");
  }
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



app.get("/admin/dashboard", adminAuth, async (req, res) => {
  try {
    const orders = await db.get("SELECT COUNT(*) AS totalOrders FROM orders");
    const customers = await db.get("SELECT COUNT(*) AS totalCustomers FROM customers");
    const products = await db.get("SELECT COUNT(*) AS totalProducts FROM products");

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

  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false
    });
  }
});



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



app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;

  const adminUser = process.env.ADMIN_USER || "admin";
  const adminPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "admin123";

  if (username === adminUser && password === adminPass) {
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


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});