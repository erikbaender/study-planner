import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    "https://*.convex.cloud",
    "https://*.convex.site",
    "wss://*.convex.cloud",
    ...(isDevelopment
      ? ["http://127.0.0.1:*", "http://localhost:*", "ws://127.0.0.1:*", "ws://localhost:*"]
      : []),
  ].join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  ...(!isDevelopment
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
