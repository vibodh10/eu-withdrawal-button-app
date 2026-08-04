import "@shopify/shopify-api/adapters/node";

import { prisma } from "../src/lib/db.js";
import { shopify } from "../src/lib/shopify.js";
import { getValidOfflineToken } from "../src/lib/offlineTokens.js";

const shopDomain = "77drac-08.myshopify.com";

try {
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });

    if (!shop) {
        throw new Error("Shop not found");
    }

    const accessToken = await getValidOfflineToken(shop);

    const client = new shopify.clients.Graphql({
        session: {
            shop: shop.shopDomain,
            accessToken,
        },
    });

    const response = await client.request(`
    query GetShopContact {
      shop {
        name
        email
        contactEmail
        myshopifyDomain
      }
    }
  `);

    console.log(JSON.stringify(response.data.shop, null, 2));
} catch (error) {
    console.error("Could not retrieve shop contact:", error);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}