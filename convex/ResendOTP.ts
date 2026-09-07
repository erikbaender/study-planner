import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { Resend } from "resend";
import { normalizeEmail, sha256 } from "./authEmail";

const random: RandomReader = { read: (bytes) => crypto.getRandomValues(bytes) };

function resendOtp(id: "email-otp" | "email-change-verification", subject: string) {
  return Email({
  id,
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM,
  maxAge: 10 * 60,
  normalizeIdentifier(identifier) {
    const email = normalizeEmail(identifier);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    return email;
  },
  async generateVerificationToken() {
    return generateRandomString(random, "0123456789", 8);
  },
  ...(id === "email-change-verification"
    ? {
        async authorize(params, account) {
          if (
            typeof params.email !== "string" ||
            account.provider !== "email-change" ||
            typeof account.providerAccountId !== "string" ||
            !account.providerAccountId.endsWith(`:${await sha256(normalizeEmail(params.email))}`)
          ) {
            throw new Error("The verification code does not match this email change.");
          }
        },
      }
    : {}),
  async sendVerificationRequest({ identifier, provider, token }) {
    if (!provider.apiKey || !provider.from) throw new Error("Email delivery is not configured.");
    const mode = process.env.AUTH_EMAIL_MODE ?? "preview";
    if (mode !== "production" && mode !== "preview") throw new Error("Email delivery mode is invalid.");
    if (mode === "preview") {
      const allowed = (process.env.AUTH_EMAIL_PREVIEW_RECIPIENTS ?? "")
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean);
      if (!allowed.includes(identifier)) throw new Error("Email delivery is restricted in this preview.");
    }
    const { error } = await new Resend(provider.apiKey).emails.send({
      from: provider.from,
      to: identifier,
      subject,
      text: `Your sign-in code is ${token}. It expires in 10 minutes.`,
    });
    if (error) throw new Error("Email delivery failed. Please try again.");
  },
  });
}

export const ResendOTP = resendOtp("email-otp", "Your Study Planner sign-in code");
export const ResendChangeOTP = resendOtp("email-change-verification", "Confirm your Study Planner email");
