
import { List } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const FEATURE_TRANSLATION_KEYS = {
    "EU-compliant withdrawal flow": "withdrawalFlow",
    "Unlimited withdrawal requests": "unlimitedRequests",
    "Automatic confirmation emails": "confirmationEmails",
    "Theme app block support": "themeBlock",
    "Request dashboard": "requestDashboard",
    "Merchant notifications": "merchantNotifications",
    "Basic compliance included": "basicCompliance",
    "Core withdrawal request management": "coreManagement",
    "All supported EU languages": "euLanguages",
    "Custom withdrawal period with validation": "customPeriod",
    "Custom branding and brand colors": "customBranding",
    "CSV export & advanced request management": "advancedManagement",
};

export default function FeatureList({ items = [] }) {
    const { t } = useTranslation();

    return (
        <List type="bullet">
            {items.map((item, index) => {
                const key = FEATURE_TRANSLATION_KEYS[item];

                const label = key
                    ? t(`plans.features.${key}`)
                    : item;

                return (
                    <List.Item key={`${index}-${item}`}>
                        {label}
                    </List.Item>
                );
            })}
        </List>
    );
}
