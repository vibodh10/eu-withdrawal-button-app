import { getSessionToken } from "@shopify/app-bridge-utils";
import { app } from "./appBridge.js";
import i18next from "i18next";


const API_ERROR_KEYS = {
    "Shop not found": "shopNotFound",
    "Shop not found.": "shopNotFound",
    "Could not verify Shopify App Pricing entitlement.":
        "entitlementUnavailable",
    "A paid Shopify App Pricing plan is required.":
        "planRequired",
    "enabledLanguages must be an array":
        "languagesInvalid",
    "The Basic plan includes English plus 1 additional language.":
        "basicLanguageLimit",
    "Withdrawal period must be between 1 and 365 days.":
        "withdrawalPeriod",
    "SMTP host is required.": "smtpHost",
    "SMTP verification is limited to ports 465 and 587.":
        "smtpPort",
    "SMTP username is required.": "smtpUsername",
    "From email is required.": "smtpFromEmail",
    "SMTP password is required.": "smtpPassword",
    "Could not update settings": "settingsUpdate",
    "Request not found": "requestNotFound",
    "Invalid status": "invalidStatus",
    "Could not load setup status.": "setupStatus",
    "Upgrade to Pro": "upgradeRequired",
};

export async function getAuthHeaders() {
  const token = await getSessionToken(app);

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function authenticatedFetch(url, options = {}) {
  let response;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = await getAuthHeaders();

    response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });

    const shouldRetry =
      response.status === 401 &&
      response.headers.get("X-Shopify-Retry-Invalid-Session-Request") === "1";

    if (!shouldRetry || attempt === 1) {
      return response;
    }
  }

  return response;
}

async function parseResponseError(res) {
  const text = await res.text();

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}

  const message =
    data?.error ||
    data?.message ||
    text ||
    `Request failed with status ${res.status}`;

    const translationKey = API_ERROR_KEYS[message];

    const displayMessage = translationKey
        ? i18next.t(`apiErrors.${translationKey}`)
        : message;

    const err = new Error(displayMessage);

    err.status = res.status;
    err.data = data;
    err.originalMessage = message;
    err.translationKey = translationKey || null;

    return err;
}

export async function apiGet(url) {
  const res = await authenticatedFetch(url);

  if (!res.ok) {
    throw await parseResponseError(res);
  }

  return res.json();
}

export async function apiSend(url, method, body) {
  const res = await authenticatedFetch(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw await parseResponseError(res);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function syncBilling() {
  return apiSend("/billing/sync", "POST");
}

export async function openManagedPricing() {
  return apiSend("/billing/manage", "POST");
}
