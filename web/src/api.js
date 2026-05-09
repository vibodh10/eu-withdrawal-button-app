import { getSessionToken } from "@shopify/app-bridge-utils";
import { app } from "./main.jsx"; // make sure this is correct

export async function getAuthHeaders() {
  const token = await getSessionToken(app);
  console.log("TOKEN TYPE:", typeof token);
  console.log("TOKEN VALUE:", token);

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function apiGet(url) {
  const headers = await getAuthHeaders();

  const res = await fetch(url, { headers });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiSend(url, method, body) {
  const headers = await getAuthHeaders();

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function syncBilling() {
  return apiSend("/billing/sync", "POST");
}

export async function openManagedPricing() {
  return apiSend("/billing/manage", "POST");
}