import { BaseSignal } from "./signal.types";

export interface WalletCreatedSignal extends BaseSignal {
  type: "wallet.created";
  walletId: string;
  ownerId: string;
}

export interface WalletFundedSignal extends BaseSignal {
  type: "wallet.funded";
  walletId: string;
  amount: number;
  source: "bank" | "card" | "transfer";
}

export interface WalletDebitedSignal extends BaseSignal {
  type: "wallet.debited";
  walletId: string;
  amount: number;
  reason: string;
}

export interface WalletBalanceUpdatedSignal extends BaseSignal {
  type: "wallet.balance.updated";
  walletId: string;
  balance: number;
}

export interface WalletPaymentCompletedSignal extends BaseSignal {
  type: "wallet.payment.completed";
  walletId: string;
  reference: string;
}

export type WalletSignal =
  | WalletCreatedSignal
  | WalletFundedSignal
  | WalletDebitedSignal
  | WalletBalanceUpdatedSignal
  | WalletPaymentCompletedSignal;
