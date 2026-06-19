import createApp from "@shopify/app-bridge";

const host = new URLSearchParams(
    window.location.search
).get("host");

if (!host) {
    throw new Error(
        "Missing host — app not embedded correctly"
    );
}

export const app = createApp({
    apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
    host,
    forceRedirect: true,
});