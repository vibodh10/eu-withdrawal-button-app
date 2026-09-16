from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "test/emailDeliveryGuard.test.js",
    '''const resendShop = {
    id: "shop-resend",
    shopDomain: "resend-shop.myshopify.com",
    plan: "PRO",
''',
    '''const resendShop = {
    id: "shop-resend",
    shopDomain: "resend-shop.myshopify.com",
    plan: "PRO",
    currentSubscriptionStatus: "ACTIVE",
    billingSyncedAt: new Date(),
''',
    "Resend paid fixture",
)

replace_once(
    "test/emailDeliveryGuard.test.js",
    '''const smtpShop = {
    id: "shop-smtp",
    shopDomain: "smtp-shop.myshopify.com",
    plan: "PRO",
''',
    '''const smtpShop = {
    id: "shop-smtp",
    shopDomain: "smtp-shop.myshopify.com",
    plan: "PRO",
    currentSubscriptionStatus: "ACTIVE",
    billingSyncedAt: new Date(),
''',
    "SMTP paid fixture",
)

replace_once(
    "test/withdrawalConfirmation.test.js",
    '''        plan: "BASIC",
        emailDeliveryMethod: "GL6",
''',
    '''        plan: "BASIC",
        currentSubscriptionStatus: "ACTIVE",
        billingSyncedAt: new Date(),
        emailDeliveryMethod: "GL6",
''',
    "confirmation shop entitlement fixture",
)

print("Paid entitlement fixtures updated")
