// src/core/control-plane/contracts/wallet.signal.types.ts

import { BaseSignal } from "./signal.types";

export type WalletFundingMethod = "bank" | "card" | "transfer";

export interface WalletFundedSignal extends BaseSignal {
  type: "wallet.funded";

  walletId: string;
  userId: string;

  amount: number;
  currency: "NGN";

  method: WalletFundingMethod; // 👈 moved here
  reference?: string;
}

export interface WalletDebitedSignal extends BaseSignal {
  type: "wallet.debited";

  walletId: string;
  userId: string;

  amount: number;
  currency: "NGN";

  reason: string;
}

export type WalletSignal =
  | WalletFundedSignal
  | WalletDebitedSignal;
