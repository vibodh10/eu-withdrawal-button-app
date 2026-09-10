import { hasPaidEntitlement } from "./entitlements.js";

export const PLANS = {
  BASIC: {
    code: 'BASIC',
    handle: process.env.SHOPIFY_MANAGED_PRICING_BASIC_HANDLE || 'basic',
    name: 'Basic',
    priceLabel: 'Free',
    features: [
      'EU-compliant withdrawal flow',
      'Unlimited withdrawal requests',
      'Automatic confirmation emails',
      'Theme app block support',
      'Request dashboard',
      'Merchant notifications',
      'Basic compliance included'
    ]
  },
  PRO: {
    code: 'PRO',
    handle: process.env.SHOPIFY_MANAGED_PRICING_PRO_HANDLE || 'pro',
    name: 'Pro',
    priceLabel: '$1/month',
    features: [
      'Core withdrawal request management',
      'All supported EU languages',
      'Custom withdrawal period with validation',
      'Custom branding and brand colors',
      'CSV export & advanced request management',
]
  }
};

export function isPro(shop) {
  if (process.env.TESTING_PRO === "true") {
    return true;
  }

  return hasPaidEntitlement(shop);
}
