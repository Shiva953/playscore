import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
  getScoreErrorMessage,
  SCORE_ERROR__PAUSED,
  SCORE_ERROR__TREASURY_DECREASE,
  type ScoreError,
} from "@/generated/score";

// Anchor numbers a program's custom errors contiguously from 6000, in declaration order.
const SCORE_ERROR_FIRST = SCORE_ERROR__PAUSED;
const SCORE_ERROR_LAST = SCORE_ERROR__TREASURY_DECREASE;

function isScoreErrorCode(code: number): code is ScoreError {
  return code >= SCORE_ERROR_FIRST && code <= SCORE_ERROR_LAST;
}

export function parseTransactionError(err: unknown): string {
  // Wallet rejection (comes from wallet-standard, not a SolanaError)
  if (err instanceof Error && err.message.includes("User rejected")) {
    return "Transaction was rejected by the wallet.";
  }

  // score program custom errors: use the Codama-generated error messages
  if (
    isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof err.context?.code === "number" &&
    isScoreErrorCode(err.context.code)
  ) {
    return getScoreErrorMessage(err.context.code);
  }

  // For all other errors, kit's SolanaError already has readable messages.
  // Walk the cause chain to find the deepest message.
  const message = getDeepestMessage(err);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function getDeepestMessage(err: unknown): string {
  let deepest = err instanceof Error ? err.message : String(err);
  let current: unknown = err;

  while (current instanceof Error && current.cause) {
    current = current.cause;
    if (current instanceof Error) {
      deepest = current.message;
    }
  }

  return deepest;
}
