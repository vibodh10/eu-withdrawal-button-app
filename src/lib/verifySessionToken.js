import { jwtVerify } from "jose";

export async function verifySessionToken(token) {
    const secret = new TextEncoder().encode(process.env.SHOPIFY_API_SECRET);

    const { payload } = await jwtVerify(token, secret);

    return payload;
}