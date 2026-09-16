import { getSessionToken } from "@shopify/app-bridge-utils";
import { app } from "./appBridge.js";

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

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function requestError(res, payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const fallbackText = typeof payload === "string" ? payload : "";
  const message =
    data.error ||
    data.message ||
    fallbackText ||
    `Request failed with status ${res.status}`;

  const err = new Error(message);
  err.status = res.status;
  err.data = data;
  return err;
}

export async function apiGet(url) {
  const res = await authenticatedFetch(url);
  const payload = await parseResponse(res);

  if (!res.ok) {
    throw requestError(res, payload);
  }

  return payload;
}

export async function apiSend(url, method, body) {
  const res = await authenticatedFetch(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await parseResponse(res);

  if (!res.ok) {
    throw requestError(res, payload);
  }

  return payload;
}

export async function syncBilling() {
  return apiSend("/billing/sync", "POST");
}

export async function openManagedPricing() {
  return apiSend("/billing/manage", "POST");
}
