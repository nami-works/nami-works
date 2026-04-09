import { createShopifyApp } from "@cpg-labs/shared-auth";
import prisma from "./db.server";
import { assertLalamoveEncryptionConfigured } from "./services/security/encryption.server";

assertLalamoveEncryptionConfigured();

const shopify = createShopifyApp({
  prisma,
  authPathPrefix: "/auth",
  customShopDomain: process.env.SHOP_CUSTOM_DOMAIN,
});

export default shopify;
export const apiVersion = "2025-10";
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
