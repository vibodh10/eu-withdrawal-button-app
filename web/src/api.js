import { getSessionToken } from "@shopify/app-bridge-utils";
import { app } from "./appBridge.js"; // make sure this is correct

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

function withShopifyParams(url) {
  const params = window.location.search;

  if (!params) return url;

  return url.includes("?")
      ? `${url}&${params.slice(1)}`
      : `${url}${params}`;
}

export async function apiGet(url) {
  const res = await authenticatedFetch(withShopifyParams(url));

  if (!res.ok) {
    const text = await res.text();

    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}

    const err = new Error(data.message || text);
    err.status = res.status;
    err.data = data;

    throw err;
  }

  return res.json();
}

export async function apiSend(url, method, body) {
  const res = await authenticatedFetch(withShopifyParams(url), {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();

    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}

    const err = new Error(data.message || text);
    err.status = res.status;
    err.data = data;

    throw err;
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
