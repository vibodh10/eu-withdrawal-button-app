import "dotenv/config";

import { prisma } from "../src/lib/db.js";
import {
    syncManagedPricingForShop,
    validatePricingConfiguration,
} from "../src/lib/shopify.js";
import { getEntitlementKind } from "../src/lib/entitlements.js";
import {
    createRateLimitedPartnerQuery,
    pricingReconciliationSettings,
} from "../src/lib/pricingReconciliation.js";

const pricingConfiguration = validatePricingConfiguration();
const reconciliationSettings = pricingReconciliationSettings();
const partnerQuery = createRateLimitedPartnerQuery(undefined, {
    minimumIntervalMs: reconciliationSettings.partnerRequestIntervalMs,
});

console.log(JSON.stringify({
    legacyFreeHandle: pricingConfiguration.legacyFreeHandle,
    configuredPaidHandles: [...pricingConfiguration.paidHandles].sort(),
}));

const candidateShops = await prisma.shop.findMany({
    where: {
        grandfatheredFreeAt: { not: null },
        grandfatheredFreeRevokedAt: null,
        uninstalledAt: null,
    },
    orderBy: { shopDomain: "asc" },
});

const failures = [];

try {
    for (const shop of candidateShops) {
        try {
            const result = await syncManagedPricingForShop(prisma, shop, {
                partnerQuery,
            });
            console.log(JSON.stringify({
                shopDomain: shop.shopDomain,
                entitlement: getEntitlementKind(result.shop),
                historicalPaidActivation:
                    result.historicalPaidActivation,
            }));
        } catch (error) {
            failures.push({
                shopDomain: shop.shopDomain,
                error: error.message,
            });
            console.error(JSON.stringify(failures.at(-1)));
        }
    }
} finally {
    await prisma.$disconnect();
}

if (failures.length > 0) {
    console.error(`Pricing reconciliation failed for ${failures.length} shop(s).`);
    process.exitCode = 1;
} else {
    console.log(`Pricing reconciliation completed for ${candidateShops.length} shop(s).`);
}
