// src/core/control-plane/subscribers/notificationSubscriber.ts

import { Signal } from "../contracts/signal.types";
import { NotificationService } from "../../services/NotificationService";

export async function notificationSubscriber(signal: Signal) {
  switch (signal.type) {
    /* ================= COMMUNITY ================= */

    case "community.post.created": {
      return NotificationService.sendToEstate(signal.estateId, {
        title: "New Community Post",
        message: "A new post was created",
        type: "community",
        payload: {
          postId: signal.postId,
          authorId: signal.authorId,
        },
      });
    }

    case "community.comment.created": {
      return NotificationService.sendToEstate(signal.estateId, {
        title: "New Comment",
        message: "Someone commented on a post",
        type: "community",
        payload: {
          postId: signal.postId,
          commentId: signal.commentId,
          authorId: signal.authorId,
        },
      });
    }

    /* ================= WALLET ================= */

    case "wallet.funded": {
      return NotificationService.sendToUser(signal.userId, {
        title: "Wallet Funded",
        message: `₦${signal.amount} added to your wallet`,
        type: "wallet",
        payload: {
          walletId: signal.walletId,
        },
      });
    }

    case "wallet.debited": {
      return NotificationService.sendToUser(signal.userId, {
        title: "Wallet Debited",
        message: `₦${signal.amount} deducted from your wallet`,
        type: "wallet",
        payload: {
          walletId: signal.walletId,
        },
      });
    }

    default:
      return;
  }
}
