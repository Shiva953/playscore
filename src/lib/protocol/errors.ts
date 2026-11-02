export type ProtocolErrorCode =
  | "NOT_SIGNED_IN"
  | "RESTRICTED"
  | "TERMS_NOT_ACCEPTED"
  | "INSUFFICIENT_USDC"
  | "INSUFFICIENT_TOKENS"
  | "CAP_PER_PURCHASE"
  | "CAP_PER_ACCOUNT"
  | "NOT_LAUNCHED"
  | "NOT_TRADING"
  | "ALREADY_BONDED"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_LIQUIDITY"
  | "INSUFFICIENT_SHARES"
  | "NOTHING_TO_CLAIM"
  | "NOT_FOUND"
  | "NETWORK";

export class ProtocolError extends Error {
  constructor(
    public readonly code: ProtocolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function isProtocolError(e: unknown): e is ProtocolError {
  return e instanceof ProtocolError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Something went wrong. Try again.";
}
