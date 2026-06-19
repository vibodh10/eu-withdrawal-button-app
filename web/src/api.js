import { getSessionToken } from "@shopify/app-bridge-utils";
import { app } from "./appBridge.js"; // make sure this is correct

export async function getAuthHeaders() {
  const token = await getSessionToken(app);
  console.log("TOKEN TYPE:", typeof token);
  console.log("TOKEN VALUE:", token);

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function withShopifyParams(url) {
  const params = window.location.search;

  if (!params) return url;

  return url.includes("?")
      ? `${url}&${params.slice(1)}`
      : `${url}${params}`;
}

export async function apiGet(url) {
  const headers = await getAuthHeaders();

  const res = await fetch(withShopifyParams(url), {
    headers,
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

  return res.json();
}

export async function apiSend(url, method, body) {
  const headers = await getAuthHeaders();

  const res = await fetch(withShopifyParams(url), {
    method,
    headers,
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