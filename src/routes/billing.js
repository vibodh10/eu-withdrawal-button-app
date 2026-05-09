import express from "express";
import { prisma } from "../lib/db.js";
import verifyRequest from "../middleware/verifyRequest.js";
import {
  buildManagedPricingUrl,
  syncManagedPricingForShop
} from "../lib/shopify.js";

export const billingRouter = express.Router();

// 🔒 Protect ALL billing routes
billingRouter.use(verifyRequest);

// 📊 Status
billingRouter.get("/status", async (req, res) => {
  const shop = req.shop; // ✅ already loaded

  res.json({
    plan: shop.plan,
    isPro: shop.plan === "PRO",
    currentPlanHandle: shop.currentPlanHandle,
    currentSubscriptionStatus: shop.currentSubscriptionStatus,
    pricingUrl: buildManagedPricingUrl(shop.shopDomain)
  });
});

// 💳 Open Shopify pricing page
billingRouter.post("/manage", async (req, res) => {
  const shop = req.shop;

  res.json({
    ok: true,
    managedPricing: true,
    confirmationUrl: buildManagedPricingUrl(shop.shopDomain)
  });
});

// 🔄 Sync billing state from Shopify
billingRouter.post("/sync", async (req, res) => {
  const shop = req.shop;

  try {
    const result = await syncManagedPricingForShop(prisma, shop);

    res.json({
      ok: true,
      managedPricing: true,
      shop: result.shop,
      subscription: result.subscription,
      source: result.source
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to sync billing state" });
  }
});