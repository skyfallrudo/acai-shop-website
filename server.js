require("dotenv").config();

const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Resend } = require("resend");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

app.use(express.static(__dirname));

/* =========================================================
   DATABASE
========================================================= */

const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const db = {

  async get(sql, params = []) {
    try {
      if (!Array.isArray(params)) params = [params];

      const result = await tursoClient.execute({
        sql,
        args: params
      });

      return result.rows[0]
        ? { ...result.rows[0] }
        : null;

    } catch (error) {
      console.error("DB GET ERROR:", error);
      throw error;
    }
  },

  async all(sql, params = []) {
    try {
      if (!Array.isArray(params)) params = [params];

      const result = await tursoClient.execute({
        sql,
        args: params
      });

      return (result.rows || []).map(row => ({
        ...row
      }));

    } catch (error) {
      console.error("DB ALL ERROR:", error);
      throw error;
    }
  },

  async run(sql, params = []) {
    try {
      if (!Array.isArray(params)) params = [params];

      const result = await tursoClient.execute({
        sql,
        args: params
      });

      return {
        lastID: Number(result.lastInsertRowid),
        changes: Number(result.rowsAffected)
      };

    } catch (error) {
      console.error("DB RUN ERROR:", error);
      throw error;
    }
  },

  async exec(sql) {
    return tursoClient.executeMultiple(sql);
  }

};

/* =========================================================
   SESSION
========================================================= */

app.use(session({
  secret:
    process.env.SESSION_SECRET ||
    "acai-shop-secret",

  resave: false,

  saveUninitialized: false,

  cookie: {
    httpOnly: true,

    secure:
      process.env.NODE_ENV === "production",

    sameSite: "lax",

    maxAge:
      1000 * 60 * 60 * 24
  }
}));

/* =========================================================
   EMAIL
========================================================= */

const resend = new Resend(
  process.env.RESEND_API_KEY
);

/* =========================================================
   OTP
========================================================= */

const otpStore =
  Object.create(null);

const resetOtpStore =
  Object.create(null);

/* =========================================================
   CLOUDINARY
========================================================= */

cloudinary.config({

  cloud_name:
    process.env.CLOUDINARY_CLOUD_NAME,

  api_key:
    process.env.CLOUDINARY_API_KEY,

  api_secret:
    process.env.CLOUDINARY_API_SECRET

});

const storage =
  new CloudinaryStorage({

    cloudinary,

    params: {

      folder:
        "acai-shop-products",

      allowed_formats: [
        "jpg",
        "jpeg",
        "png",
        "webp"
      ]

    }

  });

const upload =
  multer({
    storage
  });

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHTML(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

function sendJSONError(
  res,
  status,
  message
) {

  return res.status(status).json({
    success: false,
    message
  });

}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function auth(req, res, next) {

  if (!req.session.userId) {

    return res.status(401).json({

      success: false,

      loggedIn: false,

      message:
        "Login required."

    });

  }

  next();

}

/* =========================================================
   ADMIN MIDDLEWARE
========================================================= */

function adminAuth(req, res, next) {

  if (!req.session.admin) {

    return res.status(401).json({

      success: false,

      message:
        "Admin login required."

    });

  }

  next();

}

/* =========================================================
   SEND OTP
========================================================= */

app.post(
  "/send-otp",
  async (req, res) => {

    try {

      const email =
        clean(req.body.email)
          .toLowerCase();

      if (!email) {

        return sendJSONError(
          res,
          400,
          "Email is required."
        );

      }

      const existing =
        await db.get(
          `SELECT id
           FROM customers
           WHERE LOWER(email)=LOWER(?)`,
          [email]
        );

      if (existing) {

        return res.json({

          success: false,

          message:
            "Email already exists. Please Sign In."

        });

      }

      const otp =
        String(
          Math.floor(
            100000 +
            Math.random() * 900000
          )
        );

      otpStore[email] = otp;

      setTimeout(() => {

        if (
          otpStore[email] === otp
        ) {
          delete otpStore[email];
        }

      }, 5 * 60 * 1000);

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
</head>

<body style="
margin:0;
padding:30px;
background:#0b1220;
font-family:Arial,sans-serif;
">

<div style="
max-width:450px;
margin:auto;
background:#111827;
padding:30px;
border-radius:20px;
text-align:center;
color:white;
">

<img
src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg"
width="80"
height="80"
style="
border-radius:50%;
object-fit:cover;
"
>

<h1>Acai Shop</h1>

<p style="color:#CBD5E1;">
Verify your email address
</p>

<div style="
background:#1F2937;
border:2px solid #3B82F6;
border-radius:15px;
padding:20px;
margin:20px 0;
">

<div style="
font-size:12px;
color:#93C5FD;
letter-spacing:3px;
">
VERIFICATION CODE
</div>

<div style="
font-size:40px;
font-weight:bold;
letter-spacing:8px;
margin-top:10px;
">
${otp}
</div>

</div>

<p style="color:#CBD5E1;">
This code expires in 5 minutes.
</p>

</div>

</body>
</html>

`

      });

      return res.json({

        success: true,

        message:
          "Verification code sent."

      });

    } catch (error) {

      console.error(
        "SEND OTP ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to send verification email."
      );

    }

  }
);

/* =========================================================
   VERIFY OTP
========================================================= */

app.post(
  "/verify-otp",
  (req, res) => {

    const email =
      clean(req.body.email)
        .toLowerCase();

    const otp =
      clean(req.body.otp);

    if (!email || !otp) {

      return sendJSONError(
        res,
        400,
        "Email and OTP are required."
      );

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

  }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
  "/register",
  async (req, res) => {

    try {

      const username =
        clean(req.body.username);

      const email =
        clean(req.body.email)
          .toLowerCase();

      const phone =
        clean(req.body.phone);

      const password =
        req.body.password || "";

      const address =
        clean(req.body.address);

      const otp =
        clean(req.body.otp);

      if (
        !username ||
        !email ||
        !password
      ) {

        return sendJSONError(
          res,
          400,
          "Username, email and password are required."
        );

      }

      if (
        !otp ||
        otpStore[email] !== otp
      ) {

        return sendJSONError(
          res,
          400,
          "Please verify your OTP first."
        );

      }

      const existing =
        await db.get(
          `SELECT id
           FROM customers
           WHERE LOWER(email)=LOWER(?)`,
          [email]
        );

      if (existing) {

        delete otpStore[email];

        return sendJSONError(
          res,
          400,
          "Email already exists. Please Sign In."
        );

      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      await db.run(
        `INSERT INTO customers
        (
          username,
          email,
          phone,
          password,
          address
        )
        VALUES (?,?,?,?,?)`,
        [
          username,
          email,
          phone,
          hashedPassword,
          address
        ]
      );

      delete otpStore[email];

      const user =
        await db.get(
          `SELECT
             id,
             username,
             email,
             phone,
             address,
             created_at
           FROM customers
           WHERE LOWER(email)=LOWER(?)`,
          [email]
        );

      if (!user) {

        return sendJSONError(
          res,
          500,
          "Account created but session could not be created."
        );

      }

      req.session.userId =
        user.id;

      req.session.userEmail =
        user.email;

      req.session.save(error => {

        if (error) {

          console.error(
            "REGISTER SESSION ERROR:",
            error
          );

          return sendJSONError(
            res,
            500,
            "Session could not be saved."
          );

        }

        return res.json({

          success: true,

          user

        });

      });

    } catch (error) {

      console.error(
        "REGISTER ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Registration failed."
      );

    }

  }
);

/* =========================================================
   FORGOT PASSWORD
========================================================= */

app.post(
  "/forgot-password",
  async (req, res) => {

    try {

      const email =
        clean(req.body.email)
          .toLowerCase();

      if (!email) {

        return sendJSONError(
          res,
          400,
          "Email is required."
        );

      }

      const user =
        await db.get(
          `SELECT id,username
           FROM customers
           WHERE LOWER(email)=LOWER(?)`,
          [email]
        );

      if (!user) {

        return sendJSONError(
          res,
          404,
          "Account not found. Please create an account first."
        );

      }

      const otp =
        String(
          Math.floor(
            100000 +
            Math.random() * 900000
          )
        );

      resetOtpStore[email] =
        otp;

      setTimeout(() => {

        if (
          resetOtpStore[email] === otp
        ) {
          delete resetOtpStore[email];
        }

      }, 5 * 60 * 1000);

      await resend.emails.send({

        from:
          "Acai Shop <support@acaishopmm.store>",

        to: email,

        subject:
          "Reset Your Acai Shop Password",

        html: `

<!DOCTYPE html>
<html>

<body style="
margin:0;
padding:30px;
background:#0b1220;
font-family:Arial;
">

<div style="
max-width:450px;
margin:auto;
background:#111827;
color:white;
padding:30px;
border-radius:20px;
text-align:center;
">

<img
src="https://raw.githubusercontent.com/skyfallrudo/acai-assets/refs/heads/main/logo.jpg.jpg"
width="80"
height="80"
style="border-radius:50%;"
>

<h2>Reset Your Password</h2>

<p style="color:#CBD5E1;">
Use this code to reset your Acai Shop password.
</p>

<div style="
font-size:40px;
font-weight:bold;
letter-spacing:8px;
background:#1F2937;
border:2px solid #3B82F6;
padding:20px;
border-radius:15px;
">

${otp}

</div>

<p style="color:#CBD5E1;">
This code expires in 5 minutes.
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

      console.error(
        "FORGOT PASSWORD ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to send reset email."
      );

    }

  }
);

/* =========================================================
   RESET PASSWORD
========================================================= */

app.post(
  "/reset-password",
  async (req, res) => {

    try {

      const email =
        clean(req.body.email)
          .toLowerCase();

      const otp =
        clean(req.body.otp);

      const password =
        req.body.password || "";

      if (!email || !otp) {

        return sendJSONError(
          res,
          400,
          "Email and OTP are required."
        );

      }

      if (
        resetOtpStore[email] !== otp
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid or expired OTP."
        );

      }
if (
  password === "__VERIFY__"
) {

  return res.json({

    success: true,

    verified: true,

    message:
      "OTP verified."

  });

}

      if (
        password.length < 6
      ) {

        return sendJSONError(
          res,
          400,
          "Password must be at least 6 characters."
        );

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
        Number(result.changes || 0) !== 1
      ) {

        return sendJSONError(
          res,
          404,
          "Account not found."
        );

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

      return sendJSONError(
        res,
        500,
        "Failed to reset password."
      );

    }

  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/login",
  async (req, res) => {

    try {

      const email =
        clean(req.body.email)
          .toLowerCase();

      const password =
        req.body.password || "";

      if (!email || !password) {

        return sendJSONError(
          res,
          400,
          "Email and password are required."
        );

      }

      const user =
        await db.get(
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
          [email]
        );

      if (!user) {

        return sendJSONError(
          res,
          401,
          "Invalid email or password."
        );

      }

      const valid =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!valid) {

        return sendJSONError(
          res,
          401,
          "Invalid email or password."
        );

      }

      delete user.password;

      req.session.userId =
        user.id;

      req.session.userEmail =
        user.email;

      req.session.save(error => {

        if (error) {

          console.error(
            "LOGIN SESSION ERROR:",
            error
          );

          return sendJSONError(
            res,
            500,
            "Login session could not be saved."
          );

        }

        return res.json({

          success: true,

          loggedIn: true,

          user

        });

      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Login failed."
      );

    }

  }
);

/* =========================================================
   ME
========================================================= */

app.get(
  "/me",
  async (req, res) => {

    if (!req.session.userId) {

      return res.json({

        success: true,

        loggedIn: false,

        user: null

      });

    }

    try {

      const user =
        await db.get(
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

        return res.json({

          success: true,

          loggedIn: false,

          user: null

        });

      }

      return res.json({

        success: true,

        loggedIn: true,

        user

      });

    } catch (error) {

      console.error(
        "ME ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load account."
      );

    }

  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/logout",
  (req, res) => {

    req.session.destroy(error => {

      if (error) {

        return sendJSONError(
          res,
          500,
          "Logout failed."
        );

      }

      res.clearCookie(
        "connect.sid"
      );

      return res.json({

        success: true

      });

    });

  }
);

/* =========================================================
   PRODUCTS
========================================================= */

app.get(
  "/products",
  async (req, res) => {

    try {

      const products =
        await db.all(
          `SELECT *
           FROM products
           ORDER BY id DESC`
        );

      return res.json(
        products || []
      );

    } catch (error) {

      console.error(
        "PRODUCTS ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load products."
      );

    }

  }
);

/* =========================================================
   ADD PRODUCT
   IMPORTANT:
   Both /add-product and /admin/products work.
========================================================= */

app.post(
  [
    "/add-product",
    "/admin/products"
  ],
  adminAuth,

  (req, res, next) => {

    upload.single("image")(
      req,
      res,
      error => {

        if (error) {

          console.error(
            "PRODUCT IMAGE UPLOAD ERROR:",
            error
          );

          return sendJSONError(
            res,
            400,
            error.message ||
            "Image upload failed."
          );

        }

        next();

      }
    );

  },

  async (req, res) => {

    try {

      const name =
        clean(req.body.name);

      const description =
        clean(req.body.description);

      const price =
        Number(req.body.price);

      const stock =
        Number(req.body.stock);

      if (!name) {

        return sendJSONError(
          res,
          400,
          "Product name is required."
        );

      }

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid product price."
        );

      }

      if (
        !Number.isInteger(stock) ||
        stock < 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid stock quantity."
        );

      }

      const image =
        req.file?.path ||
        req.file?.secure_url ||
        req.file?.url ||
        "";

      await db.run(
        `INSERT INTO products
        (
          name,
          description,
          price,
          stock,
          image
        )
        VALUES (?,?,?,?,?)`,
        [
          name,
          description,
          price,
          stock,
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

      return sendJSONError(
        res,
        500,
        error.message ||
        "Failed to add product."
      );

    }

  }
);

/* =========================================================
   UPDATE PRODUCT
========================================================= */

app.put(
  "/update-product/:id",
  adminAuth,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const name =
        clean(req.body.name);

      const description =
        clean(req.body.description);

      const price =
        Number(req.body.price);

      const stock =
        Number(req.body.stock);

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid product ID."
        );

      }

      if (!name) {

        return sendJSONError(
          res,
          400,
          "Product name is required."
        );

      }

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid product price."
        );

      }

      if (
        !Number.isInteger(stock) ||
        stock < 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid stock quantity."
        );

      }

      const product =
        await db.get(
          "SELECT id FROM products WHERE id=?",
          [id]
        );

      if (!product) {

        return sendJSONError(
          res,
          404,
          "Product not found."
        );

      }

      await db.run(
        `UPDATE products
         SET
           name=?,
           price=?,
           stock=?,
           description=?
         WHERE id=?`,
        [
          name,
          price,
          stock,
          description,
          id
        ]
      );

      return res.json({

        success: true,

        message:
          "Product updated successfully."

      });

    } catch (error) {

      console.error(
        "UPDATE PRODUCT ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to update product."
      );

    }

  }
);

/* =========================================================
   DELETE PRODUCT
========================================================= */

app.delete(
  "/delete-product/:id",
  adminAuth,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid product ID."
        );

      }

      const product =
        await db.get(
          "SELECT id FROM products WHERE id=?",
          [id]
        );

      if (!product) {

        return sendJSONError(
          res,
          404,
          "Product not found."
        );

      }

      await db.run(
        "DELETE FROM products WHERE id=?",
        [id]
      );

      return res.json({

        success: true,

        message:
          "Product deleted successfully."

      });

    } catch (error) {

      console.error(
        "DELETE PRODUCT ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to delete product."
      );

    }

  }
);

/* =========================================================
   PROFILE
========================================================= */

app.get(
  "/profile",
  auth,
  async (req, res) => {

    try {

      const user =
        await db.get(
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

        return sendJSONError(
          res,
          404,
          "User not found."
        );

      }

      return res.json({

        success: true,

        user

      });

    } catch (error) {

      console.error(
        "PROFILE ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load profile."
      );

    }

  }
);

app.put(
  "/profile",
  auth,
  async (req, res) => {

    try {

      const username =
        clean(req.body.username);

      const phone =
        clean(req.body.phone);

      const address =
        clean(req.body.address);

      if (!username) {

        return sendJSONError(
          res,
          400,
          "Username is required."
        );

      }

      await db.run(
        `UPDATE customers
         SET
           username=?,
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

        message:
          "Profile updated successfully."

      });

    } catch (error) {

      console.error(
        "PROFILE UPDATE ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to update profile."
      );

    }

  }
);

/* =========================================================
   PLACE ORDER
   - Uses real DB price
   - Checks stock
   - Saves delivery fee
   - Sends HTML email
   - NO PDF
========================================================= */

app.post(
  "/place-order",
  auth,
  async (req, res) => {

    let changedProducts = [];

    try {

      const name =
        clean(req.body.name);

      const phone =
        clean(req.body.phone);

      const telegram =
        clean(req.body.telegram);

      const altSocial =
        clean(req.body.altSocial);

      const city =
        clean(req.body.city);

      const township =
        clean(req.body.township);

      const road =
        clean(req.body.road);

      const building =
        clean(req.body.building);

      const address =
        clean(req.body.address);

      const paymentMethod =
        clean(
          req.body.payment_method ||
          "COD"
        );

      const deliveryFee =
        Number(req.body.deliFee || 0);

      const cart =
        req.body.cart;

      if (
        !Array.isArray(cart) ||
        cart.length === 0
      ) {

        return sendJSONError(
          res,
          400,
          "Cart is empty."
        );

      }

      if (
        !Number.isFinite(deliveryFee) ||
        deliveryFee < 0
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid delivery fee."
        );

      }

      const customer =
        await db.get(
          `SELECT
             id,
             username,
             email
           FROM customers
           WHERE id=?`,
          [req.session.userId]
        );

      if (!customer) {

        return sendJSONError(
          res,
          404,
          "User not found."
        );

      }

      const verifiedCart = [];

      let subtotal = 0;

      for (const item of cart) {

        const productId =
          Number(
            item.id ||
            item.productId
          );

        const qty =
          Number(item.qty);

        if (
          !Number.isInteger(productId) ||
          productId <= 0
        ) {

          return sendJSONError(
            res,
            400,
            `Invalid product ID for ${item.name || "item"}.`
          );

        }

        if (
          !Number.isInteger(qty) ||
          qty <= 0
        ) {

          return sendJSONError(
            res,
            400,
            `Invalid quantity for ${item.name || "item"}.`
          );

        }

        const product =
          await db.get(
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

          return sendJSONError(
            res,
            400,
            `${item.name || "Product"} no longer exists.`
          );

        }

        if (
          Number(product.stock) < qty
        ) {

          return sendJSONError(
            res,
            400,
            `${product.name} out of stock. Only ${product.stock} left.`
          );

        }

        const realPrice =
          Number(product.price);

        subtotal +=
          realPrice * qty;

        verifiedCart.push({

          id:
            Number(product.id),

          productId:
            Number(product.id),

          name:
            product.name,

          price:
            realPrice,

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
        .filter(v => clean(v))
        .join(", ");

      /* -----------------------------------------
         REDUCE STOCK
      ----------------------------------------- */

      for (
        const item of verifiedCart
      ) {

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

          id:
            item.productId,

          qty:
            item.qty

        });

      }

      /* -----------------------------------------
         INSERT ORDER
      ----------------------------------------- */

      const inserted =
        await tursoClient.execute({

          sql:
            `INSERT INTO orders
            (
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
            VALUES
            (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

          args: [

            name,

            customer.email,

            phone,

            telegram,

            altSocial,

            fullAddress,

            JSON.stringify(
              verifiedCart
            ),

            total,

            "Pending",

            city,

            township,

            road,

            building,

            deliveryFee,

            paymentMethod

          ]

        });

      const orderId =
        Number(
          inserted.lastInsertRowid
        );

      if (!orderId) {

        throw new Error(
          "Order ID was not generated."
        );

      }

      /* -----------------------------------------
         HTML EMAIL ONLY
         NO PDF ATTACHMENT
      ----------------------------------------- */

      try {

        const itemRows =
          verifiedCart
            .map(item => `

<tr>

<td style="
padding:10px;
border-bottom:1px solid #E2E8F0;
">
${escapeHTML(item.name)}
</td>

<td style="
padding:10px;
text-align:center;
border-bottom:1px solid #E2E8F0;
">
${item.qty}
</td>

<td style="
padding:10px;
text-align:right;
border-bottom:1px solid #E2E8F0;
">
${Number(item.price).toLocaleString()} MMK
</td>

<td style="
padding:10px;
text-align:right;
border-bottom:1px solid #E2E8F0;
">
${(
  Number(item.price) *
  Number(item.qty)
).toLocaleString()} MMK
</td>

</tr>

`)
            .join("");

        await resend.emails.send({

          from:
            "Acai Shop <support@acaishopmm.store>",

          to:
            customer.email,

          subject:
            `Order Confirmation #${orderId} - Acai Shop`,

          html: `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width,initial-scale=1">

</head>

<body style="
margin:0;
padding:20px;
background:#F1F5F9;
font-family:Arial,sans-serif;
color:#1E293B;
">

<div style="
max-width:680px;
margin:auto;
background:white;
border-radius:18px;
padding:25px;
">

<h2 style="
color:#2563EB;
margin-top:0;
">
Order Confirmed!
</h2>

<p>
Dear
<b>${escapeHTML(
  name || "Customer"
)}</b>,
</p>

<p>
Thank you for shopping with
<b>Acai Shop</b>.
Your order has been received successfully.
</p>

<div style="
background:#EFF6FF;
border-radius:12px;
padding:15px;
margin:20px 0;
">

<p>
<b>Order ID:</b>
#${orderId}
</p>

<p>
<b>Payment:</b>
${escapeHTML(
  paymentMethod
)}
</p>

<p>
<b>Delivery Fee:</b>
${deliveryFee.toLocaleString()} MMK
</p>

<p>
<b>Total:</b>
${total.toLocaleString()} MMK
</p>

</div>

<p>
<b>Shipping Address:</b>
<br>
${escapeHTML(
  fullAddress || "N/A"
)}
</p>

<table style="
width:100%;
border-collapse:collapse;
margin-top:20px;
">

<thead>

<tr style="
background:#2563EB;
color:white;
">

<th style="
padding:10px;
text-align:left;
">
Item
</th>

<th style="
padding:10px;
">
Qty
</th>

<th style="
padding:10px;
text-align:right;
">
Price
</th>

<th style="
padding:10px;
text-align:right;
">
Total
</th>

</tr>

</thead>

<tbody>

${itemRows}

</tbody>

</table>

<p style="
margin-top:25px;
">

We will process your order and update
the order status when there is a change.

</p>

<p>
Best regards,<br>
<b>Acai Shop Team</b>
</p>

</div>

</body>

</html>

`

        });

      } catch (emailError) {

        console.error(
          "ORDER EMAIL ERROR:",
          emailError
        );

        /*
          Email failure should NOT cancel
          an already-created order.
        */

      }

      return res.json({

        success: true,

        orderId

      });

    } catch (error) {

      console.error(
        "PLACE ORDER ERROR:",
        error
      );

      /*
        Restore stock if something failed
        after stock was reduced.
      */

      for (
        const changed
        of changedProducts
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

        } catch (
          restoreError
        ) {

          console.error(
            "STOCK RESTORE ERROR:",
            restoreError
          );

        }

      }

      return sendJSONError(
        res,
        500,
        error.message ||
        "Failed to place order."
      );

    }

  }
);

/* =========================================================
   MY ORDERS
========================================================= */

app.get(
  "/my-orders",
  auth,
  async (req, res) => {

    try {

      const user =
        await db.get(
          `SELECT email
           FROM customers
           WHERE id=?`,
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

      return sendJSONError(
        res,
        500,
        "Failed to load orders."
      );

    }

  }
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/admin-login",
  async (req, res) => {

    try {

      const username =
        clean(req.body.username);

      const password =
        String(
          req.body.password || ""
        );

      const adminUser =
        process.env.ADMIN_USER ||
        "admin";

      const adminPassword =
        process.env.ADMIN_PASSWORD ||
        process.env.ADMIN_PASS ||
        "admin123";

      if (
        username !== adminUser ||
        password !== adminPassword
      ) {

        return res.status(401).json({

          success: false,

          message:
            "Invalid admin login."

        });

      }

      req.session.admin =
        true;

      req.session.save(error => {

        if (error) {

          console.error(
            "ADMIN SESSION ERROR:",
            error
          );

          return sendJSONError(
            res,
            500,
            "Admin session could not be saved."
          );

        }

        return res.json({

          success: true

        });

      });

    } catch (error) {

      console.error(
        "ADMIN LOGIN ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Admin login failed."
      );

    }

  }
);

/* =========================================================
   ADMIN CHECK
========================================================= */

app.get(
  "/admin-check",
  (req, res) => {

    res.json({

      loggedIn:
        !!req.session.admin

    });

  }
);

/* =========================================================
   ADMIN LOGOUT
========================================================= */

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

/* =========================================================
   ADMIN PRODUCTS
========================================================= */

app.get(
  "/admin/products",
  adminAuth,
  async (req, res) => {

    try {

      const products =
        await db.all(
          `SELECT *
           FROM products
           ORDER BY id DESC`
        );

      return res.json(
        products || []
      );

    } catch (error) {

      console.error(
        "ADMIN PRODUCTS ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load products."
      );

    }

  }
);

/* =========================================================
   ADMIN ORDERS
========================================================= */

app.get(
  "/admin/orders",
  adminAuth,
  async (req, res) => {

    try {

      const orders =
        await db.all(
          `SELECT *
           FROM orders
           ORDER BY id DESC`
        );

      return res.json(
        orders || []
      );

    } catch (error) {

      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load orders."
      );

    }

  }
);

/* =========================================================
   ADMIN ORDER DETAIL
========================================================= */

app.get(
  "/admin/orders/:id",
  adminAuth,
  async (req, res) => {

    try {

      const order =
        await db.get(
          `SELECT *
           FROM orders
           WHERE id=?`,
          [req.params.id]
        );

      if (!order) {

        return sendJSONError(
          res,
          404,
          "Order not found."
        );

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

      return sendJSONError(
        res,
        500,
        "Failed to load order."
      );

    }

  }
);

/* =========================================================
   ADMIN ORDER STATUS
========================================================= */

app.put(
  "/admin/orders/:id/status",
  adminAuth,
  async (req, res) => {

    try {

      const status =
        clean(req.body.status);

      const allowed = [

        "Pending",

        "Confirmed",

        "Processing",

        "Shipped",

        "Delivered",

        "Cancelled"

      ];

      if (
        !allowed.includes(status)
      ) {

        return sendJSONError(
          res,
          400,
          "Invalid order status."
        );

      }

      const order =
        await db.get(
          `SELECT id
           FROM orders
           WHERE id=?`,
          [req.params.id]
        );

      if (!order) {

        return sendJSONError(
          res,
          404,
          "Order not found."
        );

      }

      await db.run(
        `UPDATE orders
         SET status=?
         WHERE id=?`,
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
        "ORDER STATUS ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to update order status."
      );

    }

  }
);

/* =========================================================
   DELETE ORDER
========================================================= */

app.delete(
  "/admin/orders/:id",
  adminAuth,
  async (req, res) => {

    try {

      const order =
        await db.get(
          `SELECT id
           FROM orders
           WHERE id=?`,
          [req.params.id]
        );

      if (!order) {

        return sendJSONError(
          res,
          404,
          "Order not found."
        );

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

      return sendJSONError(
        res,
        500,
        "Failed to delete order."
      );

    }

  }
);

/* =========================================================
   ADMIN CUSTOMERS
========================================================= */

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

      return sendJSONError(
        res,
        500,
        "Failed to load customers."
      );

    }

  }
);

/* =========================================================
   DELETE CUSTOMER
========================================================= */

app.delete(
  "/admin/customers/:id",
  adminAuth,
  async (req, res) => {

    try {

      const customer =
        await db.get(
          `SELECT id
           FROM customers
           WHERE id=?`,
          [req.params.id]
        );

      if (!customer) {

        return sendJSONError(
          res,
          404,
          "Customer not found."
        );

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

      return sendJSONError(
        res,
        500,
        "Failed to delete customer."
      );

    }

  }
);

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
  "/admin/dashboard",
  adminAuth,
  async (req, res) => {

    try {

      const orders =
        await db.get(
          `SELECT
             COUNT(*) AS totalOrders
           FROM orders`
        );

      const customers =
        await db.get(
          `SELECT
             COUNT(*) AS totalCustomers
           FROM customers`
        );

      const products =
        await db.get(
          `SELECT
             COUNT(*) AS totalProducts
           FROM products`
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

      for (
        const order
        of allOrders
      ) {

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

          if (
            Array.isArray(items)
          ) {

            for (
              const item
              of items
            ) {

              const itemName =
                String(
                  item.name ||
                  "Unknown"
                );

              seller[itemName] =
                (
                  seller[itemName] ||
                  0
                ) +
                Number(
                  item.qty || 0
                );

            }

          }

        } catch {}

      }

      let bestProduct =
        "-";

      let maxQuantity =
        0;

      for (
        const [name, quantity]
        of Object.entries(seller)
      ) {

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

      return sendJSONError(
        res,
        500,
        "Failed to load dashboard."
      );

    }

  }
);

/* =========================================================
   ADMIN REVENUE
========================================================= */

app.get(
  "/admin/revenue",
  adminAuth,
  async (req, res) => {

    try {

      const rows =
        await db.all(`
          SELECT
            DATE(created_at) AS date,
            COALESCE(
              SUM(total),
              0
            ) AS revenue
          FROM orders
          WHERE status!='Cancelled'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at) ASC
        `);

      return res.json(
        rows || []
      );

    } catch (error) {

      console.error(
        "ADMIN REVENUE ERROR:",
        error
      );

      return sendJSONError(
        res,
        500,
        "Failed to load revenue."
      );

    }

  }
);

/* =========================================================
   ADMIN NEW ORDERS
========================================================= */

app.get(
  "/admin/new-orders",
  adminAuth,
  async (req, res) => {

    try {

      const row =
        await db.get(`
          SELECT
            COUNT(*) AS count
          FROM orders
          WHERE status='Pending'
        `);

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

      return sendJSONError(
        res,
        500,
        "Failed to load new orders."
      );

    }

  }
);

/* =========================================================
   HEALTH
========================================================= */

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

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on http://localhost:${PORT}`
    );

  }
);