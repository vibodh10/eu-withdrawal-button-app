import "dotenv/config";

import { validatePricingConfiguration } from "../src/lib/shopify.js";
import { paidEntitlementMaxAgeMs } from "../src/lib/entitlements.js";
import { pricingReconciliationSettings } from "../src/lib/pricingReconciliation.js";

const pricing = validatePricingConfiguration();
const reconciliation = pricingReconciliationSettings();
const paidMaxAgeMs = paidEntitlementMaxAgeMs();

if (paidMaxAgeMs <= reconciliation.staleAfterMs) {
    throw new Error(
        "Paid entitlement maximum age must exceed the scheduled reconciliation interval"
    );
}

console.log(JSON.stringify({
    legacyFreeHandle: pricing.legacyFreeHandle,
    configuredPaidHandles: [...pricing.paidHandles].sort(),
    paidEntitlementMaxAgeMinutes: paidMaxAgeMs / 60_000,
    reconciliationStaleAfterMinutes:
        reconciliation.staleAfterMs / 60_000,
    partnerRequestIntervalMs: reconciliation.partnerRequestIntervalMs,
}));
