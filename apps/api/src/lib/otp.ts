import { createHash, randomInt } from "node:crypto";
import { env } from "../env.js";

/** Равномерно выбирает один из 9000 четырёхзначных кодов (1000–9999). */
export function generateOtpCode(): string {
  return String(randomInt(1000, 10_000));
}

/** OTP хранится только как хеш с секретным pepper из окружения. */
export function hashOtpCode(code: string): string {
  return createHash("sha256").update(`${code}${env.otpPepper}`).digest("hex");
}
