import '@shopify/shopify-api/adapters/node';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';

import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { billingRouter } from './routes/billing.js';
import { webhookRouter } from './routes/webhooks.js';

import { prisma } from "./lib/db.js";
import cronRouter from "./routes/cron.js";
import {shopify} from "./lib/shopify.js";
import {exchangeOfflineToken} from "./lib/offlineTokens.js";

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../web/dist');

console.log("🚀 CORRECT SERVER FILE LOADED");

app.disable('x-powered-by');
app.set('trust proxy', true);

//
// 🔒 Helmet (Shopify embedded fix)
//
app.use(
    helmet({
      frameguard: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: [
            "'self'",
            "https://admin.shopify.com",
            "https://*.myshopify.com"
          ],
        },
      },
    })
);

//
// 🔥 FORCE headers (important for Shopify iframe)
//
app.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.removeHeader("Cross-Origin-Resource-Policy");

  res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );

  next();
});

//
// ⚡ GLOBAL CORS FIX (CRITICAL)
//
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200); // 🔥 MUST respond
  }

  next();
});

app.use(compression());
app.use(cors()); // keep this too (safe)

app.use(cookieParser());

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({
  extended: true,
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(morgan('dev'));

//
// ❤️ Health check
//
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      ok: true,
      db: true
    });

  } catch (err) {
    console.error("Health check DB failure:", err);

    res.status(500).json({
      ok: false,
      db: false
    });
  }
});

//
// 🔐 OAuth start
//
app.get("/auth", async (req, res) => {
  return shopify.auth.begin({
    shop: req.query.shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
});

app.get("/auth/callback", async (req, res) => {
  try {
    const authResult = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    console.log("🔥 AUTH RESULT:", authResult);

    const shop = authResult.session.shop;
    const oldAccessToken = authResult.session.accessToken;

    if (!shop) {
      throw new Error("Missing shop from Shopify auth callback session");
    }

    if (!oldAccessToken) {
      throw new Error("Missing offline access token from Shopify auth callback session");
    }

    console.log("🔥 SHOP:", shop);
    console.log("🔥 OLD OFFLINE TOKEN RECEIVED");

    const exchanged = await exchangeOfflineToken({
      shop,
      oldAccessToken,
    });

    console.log("✅ EXPIRING OFFLINE TOKEN CREATED");

    await prisma.shop.upsert({
      where: { shopDomain: shop },
      update: {
        accessToken: exchanged.accessToken,
        accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
        refreshToken: exchanged.refreshToken,
        refreshTokenExpiresAt: exchanged.refreshTokenExpiresAt,
        tokenType: "EXPIRING_OFFLINE",
      },
      create: {
        shopDomain: shop,
        accessToken: exchanged.accessToken,
        accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
        refreshToken: exchanged.refreshToken,
        refreshTokenExpiresAt: exchanged.refreshTokenExpiresAt,
        tokenType: "EXPIRING_OFFLINE",
        plan: "BASIC",
        installedAt: new Date(),
      },
    });

    const redirectUrl = await shopify.auth.getEmbeddedAppUrl({
      rawRequest: req,
      rawResponse: res,
    });

    res.redirect(redirectUrl);
  } catch (err) {
    console.error("❌ Auth callback failed:", err);

    res.status(500).send(`
      <h1>App installation failed</h1>
      <p>${err.message}</p>
    `);
  }
});

// 🔐 ENSURE SHOP IS AUTHENTICATED (ADMIN ROUTES ONLY)
app.use('/admin', async (req, res, next) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(401).json({
      message: "Missing shop parameter"
    });
  }

  const existing = await prisma.shop.findUnique({
    where: { shopDomain: shop },
  });

  if (!existing || !existing.accessToken) {
    console.log("⚠️ No token found → redirecting to auth");

    return res.status(401).json({
      redirectTo: `/auth?shop=${shop}`
    });
  }

  next();
});

//
// 🚀 ROUTES
//
app.use('/public', publicRouter);
app.use('/admin', adminRouter);
app.use('/billing', billingRouter);
app.use('/webhooks', webhookRouter);
app.use('/cron', cronRouter);

//
// 🖥 Frontend
//
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`<h1>Backend running</h1>`);
  });
}

//
// 🚀 START
//
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});