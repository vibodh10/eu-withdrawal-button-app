import '@shopify/shopify-api/adapters/node';

import express from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/db.js';
import { sendEmail, buildConfirmationEmail } from '../lib/email.js';
import {shopify} from "../lib/shopify.js";
import {getValidOfflineToken} from "../lib/offlineTokens.js";
import {sendCustomerConfirmation} from "../lib/merchantEmail.js";

export const publicRouter = express.Router();

publicRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      ok: true,
      db: true
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      db: false
    });
  }
});