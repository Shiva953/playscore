"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFunds, useSession } from "@/lib/protocol/react/hooks";
import { qk } from "@/lib/protocol/react/keys";
import { useProtocolClient } from "@/lib/protocol/react/provider";
import { useUi } from "@/lib/protocol/react/ui-store";

/** Below this, wallet USDC waits: a deposit transaction for cents isn't worth the relayer's fee. */
export const AUTO_ADD_MIN = 1;

/**
 * One balance for the user: USDC that lands in their wallet (their deposit address) is moved into
 * trading as soon as a balance poll sees it. It's the same relayer-paid deposit the user would
 * otherwise make by hand before trading, so it adds no cost, and it happens before they trade, so it
 * adds no latency to the trade. The client skips a sweep while any other money movement is running.
 */
export function AutoAddDeposits() {
  const c = useProtocolClient();
  const session = useSession();
  const auto = useUi((s) => s.autoAdd);
  const funds = useFunds();
  const qc = useQueryClient();
  const wallet = funds.data?.wallet ?? 0;
  const retryAt = useRef(0);
  const fails = useRef(0);

  useEffect(() => {
    if (!auto || !c.funds || !session.data || wallet < AUTO_ADD_MIN || Date.now() < retryAt.current) return;
    c.funds
      .sweep(AUTO_ADD_MIN)
      .then((r) => {
        if (!r) return;
        fails.current = 0;
        void qc.invalidateQueries();
      })
      .catch(() => {
        // Back off (30s, 60s, … up to 5 min) so a stuck deposit doesn't ask to sign on every poll.
        fails.current++;
        retryAt.current = Date.now() + Math.min(300_000, 15_000 * 2 ** fails.current);
        void qc.invalidateQueries({ queryKey: qk.funds() });
      });
  }, [auto, c, session.data, wallet, funds.dataUpdatedAt, qc]);

  return null;
}
