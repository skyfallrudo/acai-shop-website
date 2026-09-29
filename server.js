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

const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// Temporary OTP stores
const otpStore = Object.create(null);
const resetOtpStore = Object.create(null);

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

    if (!Array.isArray(params)) {
      params = [params];
    }

    return tursoClient.execute({
      sql,
      args: params
    })
      .then(r => {

        const row = r.rows[0]
          ? { ...r.rows[0] }
          : null;

        if (callback) {
          callback(null, row);
        }

        return row;
      })
      .catch(err => {

        console.log(err);

        if (callback) {
          callback(err);
        }

        return null;
      });
  },

  all: (sql, params = [], callback) => {

    if (typeof params === "function") {
      callback = params;
      params = [];
    }

    if (!Array.isArray(params)) {
      params = [params];
    }

    return tursoClient.execute({
      sql,
      args: params
    })
      .then(r => {

        const rows = r.rows.map(x => ({
          ...x
        }));

        if (callback) {
          callback(null, rows);
        }

        return rows;
      })
      .catch(err => {

        console.log(err);

        if (callback) {
          callback(err, []);
        }

        return [];
      });
  },

  run: (sql, params = [], callback) => {

    if (typeof params === "function") {
      callback = params;
      params = [];
    }

    if (!Array.isArray(params)) {
      params = [params];
    }

    return tursoClient.execute({
      sql,
      args: params
    })
      .then(r => {

        const info = {
          lastID: Number(r.lastInsertRowid),
          changes: Number(r.rowsAffected)
        };

        if (callback) {
          callback.call(info, null);
        }

        return info;
      })
      .catch(err => {

        console.log(err);

        if (callback) {
          callback(err);
        }

        return null;
      });
  },

  exec: (sql, callback) => {

    return tursoClient.executeMultiple(sql)
      .then(() => {

        if (callback) {
          callback(null);
        }

      })
      .catch(err => {

        console.log(err);

        if (callback) {
          callback(err);
        }

      });
  }

};

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

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

    folder: "acai-shop-products",

    allowed_formats: [
      "jpg",
      "png",
      "jpeg",
      "webp"
    ]

  }

});

const upload = multer({
  storage
});
async function generateInvoicePDF(data) {

  const safeNumber = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const safeText = value => {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value);
  };

  const escapeHTML = value => {
    return safeText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const cart = Array.isArray(data.cart)
    ? data.cart
    : [];

  const subtotal = cart.reduce(
    (sum, item) => {

      const price = safeNumber(item.price);

      const qty = Math.max(
        0,
        safeNumber(item.qty)
      );

      return sum + (price * qty);

    },
    0
  );

  const deliveryFee =
    safeNumber(data.deliveryFee);

  const grandTotal =
    safeNumber(data.total);

  const itemsHTML = cart.map(item => {

    const price =
      safeNumber(item.price);

    const qty =
      Math.max(
        0,
        safeNumber(item.qty)
      );

    const itemTotal =
      price * qty;

    return `
      <tr>

        <td>
          ${escapeHTML(item.name)}
        </td>

        <td class="center">
          ${qty}
        </td>

        <td class="right">
          ${price.toLocaleString()}
        </td>

        <td class="right">
          ${itemTotal.toLocaleString()}
        </td>

      </tr>
    `;

  }).join("");



  const html = `

<!DOCTYPE html>

<html lang="my">

<head>

<meta charset="UTF-8">

<style>

@font-face {

  font-family: "Pyidaungsu";

  src: url("file://${path.join(
    __dirname,
    "fonts/Pyidaungsu-2.5.3_Regular.ttf"
  )}");

}

* {

  box-sizing: border-box;

}

body {

  margin: 0;

  padding: 35px;

  font-family:
    "Pyidaungsu",
    "Noto Sans Myanmar",
    Arial,
    sans-serif;

  color: #1E293B;

  font-size: 12px;

}

.header {

  text-align: center;

  margin-bottom: 18px;

}

.logo-title {

  font-family:
    Arial,
    sans-serif;

  font-size: 26px;

  font-weight: bold;

  color: #818CF8;

}

.subtitle {

  font-family:
    Arial,
    sans-serif;

  font-size: 10px;

  color: #64748B;

  margin-top: 4px;

}

.line {

  border-top: 1px solid #E2E8F0;

  margin: 15px 0;

}

.info-table {

  width: 100%;

  border-collapse: collapse;

  margin-bottom: 12px;

}

.info-table td {

  padding: 4px 0;

  vertical-align: top;

}

.info-label {

  font-weight: bold;

  width: 145px;

}

.info-value {

  word-break: break-word;

}

.items {

  width: 100%;

  border-collapse: collapse;

  margin-top: 15px;

  margin-bottom: 15px;

}

.items th {

  background: #818CF8;

  color: white;

  padding: 8px;

  font-family:
    "Pyidaungsu",
    Arial,
    sans-serif;

  font-weight: bold;

}

.items td {

  padding: 8px;

  border-bottom: 1px solid #E2E8F0;

  vertical-align: top;

}

.center {

  text-align: center;

}

.right {

  text-align: right;

}

.total-box {

  width: 100%;

  margin-top: 10px;

}

.total-row {

  text-align: right;

  padding: 4px 0;

}

.grand-total {

  font-size: 15px;

  font-weight: bold;

  color: #818CF8;

  margin-top: 5px;

}

.footer {

  text-align: center;

  margin-top: 35px;

  font-family:
    "Pyidaungsu",
    Arial,
    sans-serif;

}

.footer-main {

  font-weight: bold;

  font-size: 11px;

  color: #475569;

}

.footer-sub {

  font-size: 9px;

  color: #94A3B8;

  margin-top: 5px;

}

</style>

</head>


<body>


<div class="header">

  <div class="logo-title">
    Açaí
  </div>

  <div class="subtitle">
    Official Purchase Invoice & Voucher
  </div>

</div>


<div class="line"></div>


<table class="info-table">

<tr>

<td class="info-label">
Invoice ID:
</td>

<td class="info-value">
#INV-${escapeHTML(data.orderId)}
</td>

<td class="info-label" style="width:100px;">
Date & Time:
</td>

<td class="info-value">
${escapeHTML(
  data.date ||
  new Date().toLocaleString(
    "en-GB",
    {
      timeZone: "Asia/Yangon"
    }
  )
)}
</td>

</tr>


<tr>

<td class="info-label">
Customer Name:
</td>

<td colspan="3" class="info-value">
${escapeHTML(data.name)}
</td>

</tr>


<tr>

<td class="info-label">
Email:
</td>

<td colspan="3" class="info-value">
${escapeHTML(data.userEmail)}
</td>

</tr>


<tr>

<td class="info-label">
Phone:
</td>

<td colspan="3" class="info-value">
${escapeHTML(data.phone)}
</td>

</tr>


<tr>

<td class="info-label">
Shipping Address:
</td>

<td colspan="3" class="info-value">
${escapeHTML(data.fullAddress)}
</td>

</tr>


<tr>

<td class="info-label">
Payment Method:
</td>

<td colspan="3" class="info-value">
${escapeHTML(
  data.payment_method || "COD"
)}
</td>

</tr>

</table>


<table class="items">

<thead>

<tr>

<th>
Item Name
</th>

<th style="width:45px;">
Qty
</th>

<th style="width:90px;">
Price (MMK)
</th>

<th style="width:90px;">
Total (MMK)
</th>

</tr>

</thead>


<tbody>

${itemsHTML}

</tbody>

</table>


<div class="total-box">

<div class="total-row">

Subtotal:
<strong>
${subtotal.toLocaleString()} MMK
</strong>

</div>


<div class="total-row">

Delivery Fee:
<strong>
${deliveryFee.toLocaleString()} MMK
</strong>

</div>


<div class="total-row grand-total">

Grand Total:
${grandTotal.toLocaleString()} MMK

</div>

</div>


<div class="footer">

<div class="footer-main">

Thank you for shopping with Açaí Shop!

</div>

<div class="footer-sub">

If you have any questions regarding your order,
please contact our support.

</div>

</div>


</body>

</html>

`;



  let browser;

  try {

    browser = await puppeteer.launch({

      headless: true,

      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]

    });


    const page =
      await browser.newPage();


    await page.setContent(
      html,
      {
        waitUntil: "networkidle0"
      }
    );


    await page.evaluate(async () => {

      await document.fonts.ready;

    });


    const pdfBuffer =
      await page.pdf({

        format: "A4",

        printBackground: true,

        margin: {

          top: "15mm",

          right: "15mm",

          bottom: "15mm",

          left: "15mm"

        }

      });


    await browser.close();


    return Buffer.from(pdfBuffer);


  } catch (error) {

    if (browser) {

      try {

        await browser.close();

      } catch {}

    }

    throw error;

  }

}

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


app.post("/send-otp", (req, res) => {

  const email =
    (req.body.email || "")
      .trim()
      .toLowerCase();

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

          message:
            "Email already exists. Please Sign In."

        });

      }

      const otp =
        Math.floor(
          100000 +
          Math.random() * 900000
        ).toString();

      otpStore[email] = otp;

      setTimeout(() => {

        if (otpStore[email] === otp) {

          delete otpStore[email];

        }

      }, 5 * 60 * 1000);

      try {

        await resend.emails.send({

          from:
            "Acai Shop <support@acaishopmm.store>",

          to: email,

          subject:
            "Verify your Acai Shop account",

          html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background-color:#0b1220;font-family:Arial,sans-serif;">

<table width="100%" border="0" cellspacing="0" cellpadding="0"
style="background-color:#0b1220;padding:30px 10px;">

<tr>
<td align="center">

<table width="100%" border="0" cellspacing="0" cellpadding="0"
style="max-width:420px;background-color:#111827;border-radius:24px;padding:30px 20px;text-align:center;border:1px solid rgba(255,255,255,0.15);">

<tr>
<td align="center">

<table border="0" cellspacing="0" cellpadding="0">

<tr>

<td style="width:80px;height:80px;border-radius:50%;background-color:#ffffff;border:4px solid #E8ECFF;overflow:hidden;"
align="center"
valign="middle">

<img
src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg"
width="80"
height="80"
style="display:block;border-radius:50%;object-fit:cover;"
alt="Acai Shop">

</td>

</tr>

</table>

<h1 style="margin:16px 0 0 0;color:#ffffff;font-size:28px;font-weight:bold;">
Acai Shop
</h1>

<p style="color:#CBD5E1;font-size:15px;margin:8px 0 24px 0;">
Verify your email address
</p>

<div style="background-color:#1F2937;border:2px solid #3B82F6;border-radius:18px;padding:20px;margin-bottom:24px;">

<div style="font-size:12px;letter-spacing:3px;color:#6C8CFF;margin-bottom:8px;font-weight:bold;">
VERIFICATION CODE
</div>

<div style="font-size:42px;font-weight:800;letter-spacing:8px;color:#ffffff;line-height:1;">
${otp}
</div>

</div>

<p style="color:#CBD5E1;font-size:15px;line-height:1.5;margin:0 0 20px 0;">
Enter this code in
<b style="color:#ffffff;">Acai Shop</b>
to finish creating your account.
</p>

<div style="display:inline-block;background-color:#1E3A8A;border-radius:99px;padding:10px 20px;font-size:14px;color:#FDE68A;font-weight:bold;">
⏱ Expires in 5 minutes
</div>

<p style="color:#64748B;font-size:11px;line-height:1.4;margin:24px 0 0 0;">
If you did not request this code, you can safely ignore this email.
</p>

</td>
</tr>

</table>

</td>
</tr>

</table>

</body>
</html>
`

        });

        res.json({

          success: true,

          message:
            "Verification code sent."

        });

      } catch (error) {

        if (otpStore[email] === otp) {

          delete otpStore[email];

        }

        console.error(
          "SEND OTP ERROR:",
          error
        );

        return res.status(500).json({

          success: false,

          message:
            "Failed to send verification email."

        });

      }

    }

  );

});


app.post("/verify-otp", (req, res) => {

  const email =
    (req.body.email || "")
      .trim()
      .toLowerCase();

  const otp =
    (req.body.otp || "")
      .trim();

  if (
    !email ||
    !otp
  ) {

    return res.json({

      success: false,

      message:
        "Email and OTP are required."

    });

  }

  if (
    otpStore[email] &&
    otpStore[email] === otp
  ) {

    return res.json({

      success: true,

      message:
        "OTP verified."

    });

  }

  return res.json({

    success: false,

    message:
      "Invalid or expired OTP."

  });

});


app.post("/register", async (req, res) => {

  try {

    const {
      username,
      email,
      phone,
      password,
      address,
      otp
    } = req.body;

    const cleanEmail =
      (email || "")
        .trim()
        .toLowerCase();

    const cleanUsername =
      (username || "")
        .trim();

    if (
      !cleanUsername ||
      !cleanEmail ||
      !password
    ) {

      return res.json({

        success: false,

        message:
          "Username, email and password are required."

      });

    }

    if (
      !otp ||
      otpStore[cleanEmail] !==
        String(otp).trim()
    ) {

      return res.json({

        success: false,

        message:
          "Please verify your OTP first."

      });

    }

    const existing =
      await db.get(
        "SELECT id FROM customers WHERE LOWER(email)=LOWER(?)",
        [cleanEmail]
      );

    if (existing) {

      delete otpStore[cleanEmail];

      return res.json({

        success: false,

        message:
          "Email already exists. Please Sign In."

      });

    }

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    await db.run(

      `INSERT INTO customers
      (username,email,phone,password,address)
      VALUES (?,?,?,?,?)`,

      [
        cleanUsername,
        cleanEmail,
        phone || "",
        hashedPassword,
        address || ""
      ]

    );

    delete otpStore[cleanEmail];

    const user =
      await db.get(
        `SELECT id,username,email,phone,address,created_at
         FROM customers
         WHERE LOWER(email)=LOWER(?)`,
        [cleanEmail]
      );

    if (!user) {

      return res.status(500).json({

        success: false,

        message:
          "Registration completed but user session could not be created."

      });

    }

    req.session.userId =
      user.id;

    req.session.userEmail =
      user.email;

    return res.json({

      success: true,

      user

    });

  } catch (error) {

    console.error(
      "REGISTER ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Registration failed."

    });

  }

});


app.post("/forgot-password", (req, res) => {

  const email =
    (req.body.email || "")
      .trim()
      .toLowerCase();

  if (!email) {

    return res.json({

      success: false,

      message:
        "Email is required."

    });

  }

  db.get(

    "SELECT id,username FROM customers WHERE LOWER(email)=LOWER(?)",

    [email],

    async (err, user) => {

      if (err) {

        return res.json({

          success: false,

          message:
            "Database error."

        });

      }

      if (!user) {

        return res.json({

          success: false,

          message:
            "No account found with this email."

        });

      }

      const otp =
        Math.floor(
          100000 +
          Math.random() * 900000
        ).toString();

      resetOtpStore[email] =
        otp;

      setTimeout(() => {

        if (
          resetOtpStore[email] ===
          otp
        ) {

          delete resetOtpStore[email];

        }

      }, 5 * 60 * 1000);

      try {

        await resend.emails.send({

          from:
            "Acai Shop <support@acaishopmm.store>",

          to: email,

          subject:
            "Reset Your Acai Shop Password",

          html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#0b1220;font-family:Arial,sans-serif;">

<div style="max-width:500px;margin:40px auto;background:#111827;padding:30px;border-radius:20px;color:white;text-align:center;">

<img
src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg"
width="80"
height="80"
style="border-radius:50%;object-fit:cover;">

<h2 style="margin-top:20px;">
Reset Your Password
</h2>

<p style="color:#CBD5E1;">
Use the verification code below to reset your Acai Shop password.
</p>

<div style="font-size:40px;font-weight:bold;letter-spacing:8px;background:#1F2937;border:2px solid #3B82F6;padding:20px;border-radius:15px;margin:20px 0;">
${otp}
</div>

<p style="color:#CBD5E1;">
This code expires in 5 minutes.
</p>

<p style="font-size:12px;color:#64748B;">
If you did not request a password reset, you can safely ignore this email.
</p>

</div>

</body>
</html>
`

        });

        return res.json({

          success: true,

          message:
            "Password reset code sent."

        });

      } catch (error) {

        if (
          resetOtpStore[email] ===
          otp
        ) {

          delete resetOtpStore[email];

        }

        console.error(
          "FORGOT PASSWORD EMAIL ERROR:",
          error
        );

        return res.status(500).json({

          success: false,

          message:
            "Failed to send reset email."

        });

      }

    }

  );

});


app.post("/reset-password", async (req, res) => {

  try {

    const email =
      (req.body.email || "")
        .trim()
        .toLowerCase();

    const otp =
      (req.body.otp || "")
        .trim();

    const password =
      req.body.password || "";

    if (!email || !otp) {

      return res.json({

        success: false,

        message:
          "Email and OTP are required."

      });

    }

    if (
      resetOtpStore[email] !== otp
    ) {

      return res.json({

        success: false,

        message:
          "Invalid or expired OTP."

      });

    }

    // OTP verification only
    if (password === "__VERIFY__") {

      return res.json({

        success: true,

        message:
          "OTP verified."

      });

    }

    if (
      password.length < 6
    ) {

      return res.json({

        success: false,

        message:
          "Password must be at least 6 characters."

      });

    }

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    const result =
      await db.run(

        `UPDATE customers
         SET password=?
         WHERE LOWER(email)=LOWER(?)`,

        [
          hashedPassword,
          email
        ]

      );

    if (
      !result ||
      Number(result.changes || 0) !== 1
    ) {

      return res.json({

        success: false,

        message:
          "Account not found."

      });

    }

    delete resetOtpStore[email];

    return res.json({

      success: true,

      message:
        "Password reset successfully."

    });

  } catch (error) {

    console.error(
      "RESET PASSWORD ERROR:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Failed to reset password."

    });

  }

});


app.post("/login", (req, res) => {

  const email =
    (req.body.email || "")
      .trim()
      .toLowerCase();

  const password =
    req.body.password || "";

  if (
    !email ||
    !password
  ) {

    return res.json({

      success: false,

      message:
        "Email and password are required."

    });

  }

  db.get(

    `SELECT
      id,
      username,
      email,
      phone,
      address,
      password,
      created_at
     FROM customers
     WHERE LOWER(email)=LOWER(?)`,

    [email],

    async (err, user) => {

      if (err) {

        console.error(
          "LOGIN DB ERROR:",
          err
        );

        return res.status(500).json({

          success: false,

          message:
            "Database error."

        });

      }

      if (!user) {

        return res.json({

          success: false,

          message:
            "Invalid email or password."

        });

      }

      try {

        const valid =
          await bcrypt.compare(
            password,
            user.password
          );

        if (!valid) {

          return res.json({

            success: false,

            message:
              "Invalid email or password."

          });

        }

        req.session.userId =
          user.id;

        req.session.userEmail =
          user.email;

        delete user.password;

        return res.json({

          success: true,

          user

        });

      } catch (compareError) {

        console.error(
          "PASSWORD COMPARE ERROR:",
          compareError
        );

        return res.status(500).json({

          success: false,

          message:
            "Login failed."

        });

      }

    }

  );

});


app.get("/me", auth, (req, res) => {

  db.get(

    `SELECT
      id,
      username,
      email,
      phone,
      address,
      created_at
     FROM customers
     WHERE id=?`,

    [req.session.userId],

    (err, user) => {

      if (err) {

        return res.status(500).json({

          success: false,

          message:
            "Database error."

        });

      }

      if (!user) {

        return res.status(404).json({

          success: false,

          message:
            "User not found."

        });

      }

      res.json({

        success: true,

        user

      });

    }

  );

});


app.post("/logout", (req, res) => {

  req.session.destroy(err => {

    if (err) {

      return res.status(500).json({

        success: false,

        message:
          "Logout failed."

      });

    }

    res.clearCookie(
      "connect.sid"
    );

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

      if (err) {

        return res.status(500).json({

          success: false,

          message:
            "Failed to load products."

        });

      }

      res.json(rows || []);

    }

  );

});


app.post(
  "/admin/products",
  adminAuth,
  upload.single("image"),
  async (req, res) => {

    try {

      const {
        name,
        description,
        price,
        stock,
        category
      } = req.body;

      const cleanName =
        String(name || "").trim();

      const cleanDescription =
        String(description || "").trim();

      const cleanCategory =
        String(category || "").trim();

      const cleanPrice =
        Number(price);

      const cleanStock =
        Number(stock);

      if (!cleanName) {

        return res.json({

          success: false,

          message:
            "Product name is required."

        });

      }

      if (
        !Number.isFinite(cleanPrice) ||
        cleanPrice < 0
      ) {

        return res.json({

          success: false,

          message:
            "Invalid product price."

        });

      }

      if (
        !Number.isInteger(cleanStock) ||
        cleanStock < 0
      ) {

        return res.json({

          success: false,

          message:
            "Invalid stock quantity."

        });

      }

      const image =
        req.file?.path ||
        req.file?.secure_url ||
        req.file?.url ||
        "";

      await db.run(

        `INSERT INTO products
        (name,description,price,stock,category,image)
        VALUES (?,?,?,?,?,?)`,

        [
          cleanName,
          cleanDescription,
          cleanPrice,
          cleanStock,
          cleanCategory,
          image
        ]

      );

      return res.json({

        success: true,

        message:
          "Product added successfully."

      });

    } catch (error) {

      console.error(
        "ADD PRODUCT ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to add product."

      });

    }

  }
);
app.put("/update-product/:id", adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const price = Number(req.body.price);
    const stock = Number(req.body.stock);
    const category = String(req.body.category || "").trim();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID."
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Product name is required."
      });
    }

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product price."
      });
    }

    if (!Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock quantity."
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
       SET name=?,
           price=?,
           stock=?,
           description=?,
           category=?
       WHERE id=?`,
      [
        name,
        price,
        stock,
        description,
        category,
        id
      ]
    );

    return res.json({
      success: true,
      message: "Product updated successfully."
    });

  } catch (error) {
    console.error("UPDATE PRODUCT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update product."
    });
  }
});


app.delete("/delete-product/:id", adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID."
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
      "DELETE FROM products WHERE id=?",
      [id]
    );

    return res.json({
      success: true,
      message: "Product deleted successfully."
    });

  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete product."
    });
  }
});


app.get("/profile", auth, async (req, res) => {
  try {
    const user = await db.get(
      `SELECT
        id,
        username,
        email,
        phone,
        address,
        created_at
       FROM customers
       WHERE id=?`,
      [req.session.userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    return res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error("PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load profile."
    });
  }
});


app.put("/profile", auth, async (req, res) => {
  try {
    const username =
      String(req.body.username || "").trim();

    const phone =
      String(req.body.phone || "").trim();

    const address =
      String(req.body.address || "").trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username is required."
      });
    }

    await db.run(
      `UPDATE customers
       SET username=?,
           phone=?,
           address=?
       WHERE id=?`,
      [
        username,
        phone,
        address,
        req.session.userId
      ]
    );

    return res.json({
      success: true,
      message: "Profile updated successfully."
    });

  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile."
    });
  }
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


    if (!Array.isArray(cart) || cart.length === 0) {

      return res.status(400).json({
        success: false,
        message: "Cart is empty."
      });

    }


    // Validate cart items first
    for (const item of cart) {

      const qty = Number(item.qty);

      if (
        !Number.isInteger(qty) ||
        qty <= 0
      ) {

        return res.status(400).json({
          success: false,
          message: `Invalid quantity for ${item.name || "item"}.`
        });

      }

      if (
        !item.id &&
        !item.productId
      ) {

        return res.status(400).json({
          success: false,
          message:
            `Product ID missing for ${item.name || "item"}.`
        });

      }

    }


    const deliveryFee =
      Number(deliFee) || 0;


    if (
      !Number.isFinite(deliveryFee) ||
      deliveryFee < 0
    ) {

      return res.status(400).json({
        success: false,
        message: "Invalid delivery fee."
      });

    }


    const user = await db.get(
      `SELECT
        id,
        email
       FROM customers
       WHERE id=?`,
      [req.session.userId]
    );


    if (!user) {

      return res.status(404).json({
        success: false,
        message: "User not found."
      });

    }


    const verifiedCart = [];

    let subtotal = 0;


    // Get real product prices from database.
    // Do NOT trust price sent from browser.
    for (const item of cart) {

      const productId =
        Number(item.id || item.productId);

      const qty =
        Number(item.qty);


      if (
        !Number.isInteger(productId) ||
        productId <= 0
      ) {

        return res.status(400).json({
          success: false,
          message:
            `Invalid product ID for ${item.name || "item"}.`
        });

      }


      const product = await db.get(
        `SELECT
          id,
          name,
          price,
          stock,
          image
         FROM products
         WHERE id=?`,
        [productId]
      );


      if (!product) {

        return res.status(400).json({
          success: false,
          message:
            `${item.name || "Product"} no longer exists.`
        });

      }


      if (
        Number(product.stock) < qty
      ) {

        return res.status(400).json({
          success: false,
          message:
            `${product.name} out of stock. Only ${product.stock} left.`
        });

      }


      const realPrice =
        Number(product.price);


      if (
        !Number.isFinite(realPrice) ||
        realPrice < 0
      ) {

        return res.status(500).json({
          success: false,
          message:
            `Invalid price for ${product.name}.`
        });

      }


      subtotal +=
        realPrice * qty;


      verifiedCart.push({

        id: product.id,

        productId: product.id,

        name: product.name,

        price: realPrice,

        qty,

        image:
          item.image ||
          product.image ||
          ""

      });

    }


    const total =
      subtotal + deliveryFee;


    const fullAddress =
      [
        road,
        building,
        address,
        township,
        city
      ]
      .filter(v =>
        String(v || "").trim()
      )
      .map(v =>
        String(v).trim()
      )
      .join(", ");


    /*
      Stock must be reduced only when enough
      stock still exists.

      This prevents two customers from buying
      the same last item at the same time.
    */

    const changedProducts = [];


    try {

      for (const item of verifiedCart) {

        const result =
          await tursoClient.execute({

            sql:
              `UPDATE products
               SET stock=stock-?
               WHERE id=?
               AND stock>=?`,

            args: [
              item.qty,
              item.productId,
              item.qty
            ]

          });


        if (
          Number(result.rowsAffected) !== 1
        ) {

          throw new Error(
            `${item.name} is no longer available in the requested quantity.`
          );

        }


        changedProducts.push({

          id: item.productId,

          qty: item.qty

        });

      }


      /*
        Insert order only after all stock updates
        succeed.
      */

      const insert =
        await tursoClient.execute({

          sql:
            `INSERT INTO orders(
              customer,
              email,
              phone,
              telegram,
              alt_social,
              address,
              items,
              total,
              status,
              city,
              township,
              road,
              building,
              deli_fee,
              payment_method
            )
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

          args: [

            String(name || "").trim(),

            user.email,

            String(phone || "").trim(),

            String(telegram || "").trim(),

            String(altSocial || "").trim(),

            fullAddress,

            JSON.stringify(verifiedCart),

            total,

            "Pending",

            String(city || "").trim(),

            String(township || "").trim(),

            String(road || "").trim(),

            String(building || "").trim(),

            deliveryFee,

            String(
              payment_method || "COD"
            ).trim()

          ]

        });


      const orderId =
        Number(insert.lastInsertRowid);


      if (!orderId) {

        throw new Error(
          "Order ID was not generated."
        );

      }


      /*
        Send invoice email.

        If email/PDF fails, the order itself
        remains successfully created.
      */

      try {

        const pdfBuffer =
          await generateInvoicePDF({

            orderId,

            date:
              new Date().toLocaleString(
                "en-GB",
                {
                  timeZone:
                    "Asia/Yangon"
                }
              ),

            name:
              String(name || "").trim(),

            userEmail:
              user.email,

            phone:
              String(phone || "").trim(),

            fullAddress,

            cart:
              verifiedCart,

            deliveryFee,

            total,

            payment_method:
              payment_method || "COD"

          });


        await resend.emails.send({

          from:
            "Acai Shop <support@acaishopmm.store>",

          to:
            user.email,

          subject:
            `Order Confirmation & Invoice #${orderId} - Acai Shop`,

          html: `
<div style="font-family:Arial,sans-serif;padding:20px;color:#1E293B">

<h2 style="color:#2563EB">
Order Confirmed!
</h2>

<p>
Dear <b>${String(name || "").replace(
            /[<>&"]/g,
            ""
          )}</b>,
</p>

<p>
Thank you for shopping at
<b>Acai Shop</b>.
</p>

<p>
Your order has been received successfully.
</p>

<hr>

<p>
<b>Order ID:</b>
#${orderId}
</p>

<p>
<b>Total:</b>
${total.toLocaleString()} MMK
</p>

<p>
<b>Payment Method:</b>
${String(
  payment_method || "COD"
)}
</p>

<br>

<p>
Best regards,<br>
<b>Acai Shop Team</b>
</p>

</div>
`,

          attachments: [

            {
              filename:
                `Invoice_AcaiShop_${orderId}.pdf`,

              content:
                pdfBuffer
            }

          ]

        });

      } catch (emailError) {

        console.error(
          "INVOICE EMAIL ERROR:",
          emailError
        );

      }


      return res.json({

        success: true,

        orderId

      });


    } catch (orderError) {

      console.error(
        "PLACE ORDER ERROR:",
        orderError
      );


      /*
        If order insertion/email process fails
        after stock was reduced, restore stock.
      */

      for (
        const changed of changedProducts
      ) {

        try {

          await tursoClient.execute({

            sql:
              `UPDATE products
               SET stock=stock+?
               WHERE id=?`,

            args: [
              changed.qty,
              changed.id
            ]

          });

        } catch (restoreError) {

          console.error(
            "STOCK RESTORE ERROR:",
            restoreError
          );

        }

      }


      throw orderError;

    }


  } catch (error) {

    console.error(
      "PLACE ORDER ERROR:",
      error
    );


    return res.status(500).json({

      success: false,

      message:
        error.message ||
        "Failed to place order."

    });

  }

});


app.get("/my-orders", auth, async (req, res) => {

  try {

    const user =
      await db.get(
        "SELECT email FROM customers WHERE id=?",
        [req.session.userId]
      );


    if (!user) {

      return res.json([]);

    }


    const orders =
      await db.all(

        `SELECT *
         FROM orders
         WHERE email=?
         ORDER BY id DESC`,

        [user.email]

      );


    return res.json(
      orders || []
    );


  } catch (error) {

    console.error(
      "MY ORDERS ERROR:",
      error
    );


    return res.status(500).json({

      success: false,

      message:
        "Failed to load orders."

    });

  }

});


app.get(
  "/admin/orders",
  adminAuth,
  async (req, res) => {

    try {

      const orders =
        await db.all(
          "SELECT * FROM orders ORDER BY id DESC"
        );


      return res.json(
        orders || []
      );


    } catch (error) {

      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load orders."

      });

    }

  }
);


app.get(
  "/admin/orders/:id",
  adminAuth,
  async (req, res) => {

    try {

      const order =
        await db.get(
          "SELECT * FROM orders WHERE id=?",
          [req.params.id]
        );


      if (!order) {

        return res.status(404).json({

          success: false,

          message:
            "Order not found."

        });

      }


      let items = [];

      try {

        items =
          JSON.parse(
            order.items || "[]"
          );

      } catch {

        items = [];

      }


      return res.json({

        ...order,

        items

      });


    } catch (error) {

      console.error(
        "ADMIN ORDER DETAIL ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load order."

      });

    }

  }
);


app.get(
  "/admin/orders/:id/pdf",
  adminAuth,
  async (req, res) => {

    try {

      const orderId =
        Number(req.params.id);


      const orderRow =
        await db.get(
          "SELECT * FROM orders WHERE id=?",
          [orderId]
        );


      if (!orderRow) {

        return res.status(404).send(
          "Order not found"
        );

      }


      let cartItems = [];


      try {

        cartItems =
          JSON.parse(
            orderRow.items || "[]"
          );

      } catch {

        cartItems = [];

      }


      const fullAddress =
        [
          orderRow.road,
          orderRow.building,
          orderRow.address,
          orderRow.township,
          orderRow.city
        ]
        .filter(v =>
          String(v || "").trim()
        )
        .join(", ");


      const pdfBuffer =
        await generateInvoicePDF({

          orderId:
            orderRow.id,

          date:
            orderRow.created_at,

          name:
            orderRow.customer || "N/A",

          userEmail:
            orderRow.email || "N/A",

          phone:
            orderRow.phone || "N/A",

          fullAddress,

          cart:
            cartItems,

          deliveryFee:
            Number(
              orderRow.deli_fee || 0
            ),

          total:
            Number(
              orderRow.total || 0
            ),

          payment_method:
            orderRow.payment_method ||
            "COD"

        });


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(
        "Content-Disposition",
        `attachment; filename=Voucher_Order_${orderRow.id}.pdf`
      );


      return res.send(
        pdfBuffer
      );


    } catch (error) {

      console.error(
        "ADMIN PDF GENERATE ERROR:",
        error
      );


      return res.status(500).send(
        "Error generating PDF"
      );

    }

  }
);
app.put(
  "/admin/orders/:id/status",
  adminAuth,
  async (req, res) => {

    try {

      const status =
        String(req.body.status || "").trim();

      const allowedStatuses = [
        "Pending",
        "Confirmed",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled"
      ];

      if (!allowedStatuses.includes(status)) {

        return res.status(400).json({

          success: false,

          message:
            "Invalid order status."

        });

      }


      const order =
        await db.get(
          "SELECT id,status FROM orders WHERE id=?",
          [req.params.id]
        );


      if (!order) {

        return res.status(404).json({

          success: false,

          message:
            "Order not found."

        });

      }


      await db.run(

        "UPDATE orders SET status=? WHERE id=?",

        [
          status,
          req.params.id
        ]

      );


      return res.json({

        success: true,

        message:
          "Order status updated successfully."

      });


    } catch (error) {

      console.error(
        "UPDATE ORDER STATUS ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to update order status."

      });

    }

  }
);


app.delete(
  "/admin/orders/:id",
  adminAuth,
  async (req, res) => {

    try {

      const order =
        await db.get(
          "SELECT id FROM orders WHERE id=?",
          [req.params.id]
        );


      if (!order) {

        return res.status(404).json({

          success: false,

          message:
            "Order not found."

        });

      }


      await db.run(

        "DELETE FROM orders WHERE id=?",

        [req.params.id]

      );


      return res.json({

        success: true,

        message:
          "Order deleted successfully."

      });


    } catch (error) {

      console.error(
        "DELETE ORDER ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to delete order."

      });

    }

  }
);


app.get(
  "/admin/customers",
  adminAuth,
  async (req, res) => {

    try {

      const customers =
        await db.all(

          `SELECT
             id,
             username,
             email,
             phone,
             address,
             created_at
           FROM customers
           ORDER BY id DESC`

        );


      return res.json(
        customers || []
      );


    } catch (error) {

      console.error(
        "ADMIN CUSTOMERS ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load customers."

      });

    }

  }
);


app.delete(
  "/admin/customers/:id",
  adminAuth,
  async (req, res) => {

    try {

      const customer =
        await db.get(
          "SELECT id FROM customers WHERE id=?",
          [req.params.id]
        );


      if (!customer) {

        return res.status(404).json({

          success: false,

          message:
            "Customer not found."

        });

      }


      await db.run(

        "DELETE FROM customers WHERE id=?",

        [req.params.id]

      );


      return res.json({

        success: true,

        message:
          "Customer deleted successfully."

      });


    } catch (error) {

      console.error(
        "DELETE CUSTOMER ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to delete customer."

      });

    }

  }
);


app.get(
  "/admin/dashboard",
  adminAuth,
  async (req, res) => {

    try {

      const orders =
        await db.get(
          "SELECT COUNT(*) AS totalOrders FROM orders"
        );


      const customers =
        await db.get(
          "SELECT COUNT(*) AS totalCustomers FROM customers"
        );


      const products =
        await db.get(
          "SELECT COUNT(*) AS totalProducts FROM products"
        );


      const revenue =
        await db.get(`

          SELECT
            COALESCE(
              SUM(
                total -
                COALESCE(deli_fee,0)
              ),
              0
            ) AS productRevenue

          FROM orders

          WHERE status!='Cancelled'

        `);


      const delivery =
        await db.get(`

          SELECT
            COALESCE(
              SUM(
                COALESCE(deli_fee,0)
              ),
              0
            ) AS deliveryRevenue

          FROM orders

          WHERE status!='Cancelled'

        `);


      const today =
        await db.get(`

          SELECT
            COALESCE(
              SUM(
                total -
                COALESCE(deli_fee,0)
              ),
              0
            ) AS todayRevenue

          FROM orders

          WHERE status!='Cancelled'

          AND DATE(created_at)
            = DATE('now','localtime')

        `);


      const allOrders =
        await db.all(`

          SELECT
            items,
            total,
            deli_fee,
            created_at

          FROM orders

          WHERE status!='Cancelled'

        `);


      const seller = {};

      const weekly = {};


      (allOrders || []).forEach(order => {

        const date =
          String(
            order.created_at || ""
          ).split(" ")[0];


        if (date) {

          weekly[date] =
            (
              weekly[date] || 0
            ) +
            Number(
              order.total || 0
            );

        }


        try {

          const items =
            JSON.parse(
              order.items || "[]"
            );


          if (Array.isArray(items)) {

            items.forEach(item => {

              const itemName =
                String(
                  item.name || "Unknown"
                );


              seller[itemName] =
                (
                  seller[itemName] || 0
                ) +
                Number(
                  item.qty || 0
                );

            });

          }

        } catch {

          // Ignore invalid order items JSON

        }

      });


      let bestProduct = "-";

      let maxQuantity = 0;


      Object.entries(
        seller
      ).forEach(
        ([name, quantity]) => {

          if (
            Number(quantity) >
            maxQuantity
          ) {

            maxQuantity =
              Number(quantity);

            bestProduct =
              name;

          }

        }
      );


      return res.json({

        totalOrders:
          Number(
            orders?.totalOrders || 0
          ),

        totalCustomers:
          Number(
            customers?.totalCustomers || 0
          ),

        totalProducts:
          Number(
            products?.totalProducts || 0
          ),

        todayRevenue:
          Number(
            today?.todayRevenue || 0
          ),

        productRevenue:
          Number(
            revenue?.productRevenue || 0
          ),

        deliveryRevenue:
          Number(
            delivery?.deliveryRevenue || 0
          ),

        bestProduct,

        weekly

      });


    } catch (error) {

      console.error(
        "ADMIN DASHBOARD ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load dashboard."

      });

    }

  }
);


app.get(
  "/admin/revenue",
  adminAuth,
  async (req, res) => {

    try {

      const rows =
        await db.all(`

          SELECT

            DATE(created_at)
              AS date,

            COALESCE(
              SUM(total),
              0
            ) AS revenue

          FROM orders

          WHERE status!='Cancelled'

          GROUP BY
            DATE(created_at)

          ORDER BY
            DATE(created_at) ASC

        `);


      return res.json(
        rows || []
      );


    } catch (error) {

      console.error(
        "ADMIN REVENUE ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load revenue."

      });

    }

  }
);


app.get(
  "/admin/new-orders",
  adminAuth,
  async (req, res) => {

    try {

      const row =
        await db.get(

          `SELECT
             COUNT(*) AS count
           FROM orders
           WHERE status='Pending'`

        );


      return res.json({

        count:
          Number(
            row?.count || 0
          )

      });


    } catch (error) {

      console.error(
        "NEW ORDERS ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Failed to load new orders."

      });

    }

  }
);


app.post(
  "/admin-login",
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ""
        ).trim();

      const password =
        String(
          req.body.password || ""
        );


      const adminUser =
        process.env.ADMIN_USER ||
        "admin";


      const adminPass =
        process.env.ADMIN_PASSWORD ||
        process.env.ADMIN_PASS ||
        "admin123";


      if (
        username === adminUser &&
        password === adminPass
      ) {

        req.session.admin =
          true;


        return res.json({

          success: true

        });

      }


      return res.status(401).json({

        success: false,

        message:
          "Invalid admin login."

      });


    } catch (error) {

      console.error(
        "ADMIN LOGIN ERROR:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Admin login failed."

      });

    }

  }
);


app.get(
  "/admin-check",
  (req, res) => {

    res.json({

      loggedIn:
        !!req.session.admin

    });

  }
);


app.post(
  "/admin-logout",
  (req, res) => {

    req.session.admin =
      false;


    res.json({

      success: true

    });

  }
);


app.get(
  "/health",
  (req, res) => {

    res.json({

      success: true,

      status: "OK",

      time:
        new Date().toISOString()

    });

  }
);


app.listen(
  PORT,
  () => {

    console.log(
      `Server running on http://localhost:${PORT}`
    );

  }
);