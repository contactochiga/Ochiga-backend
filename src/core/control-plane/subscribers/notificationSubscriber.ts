// src/core/control-plane/subscribers/notificationSubscriber.ts

import { Signal } from "../contracts/signal.types";
import { NotificationService } from "../../../services/NotificationService";

export function notificationSubscriber(signal: Signal) {
  switch (signal.type) {
    /* ---------------- COMMUNITY ---------------- */

    case "community.post.created": {
      return NotificationService.sendToEstate(signal.estateId, {
        title: "New Community Post",
        message: "A new post was created in your estate",
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
        message: "Someone commented on a community post",
        type: "community",
        payload: {
          postId: signal.postId,
          commentId: signal.commentId,
        },
      });
    }

    case "community.post.flagged": {
      return NotificationService.sendToRole(signal.estateId, "estate_admin", {
        title: "Post Flagged",
        message: "A community post was flagged for review",
        type: "moderation",
        payload: {
          postId: signal.postId,
        },
      });
    }

    /* ---------------- WALLET ---------------- */

    case "wallet.funded": {
      return NotificationService.sendToUser(signal.userId, {
        title: "Wallet Funded",
        message: `₦${signal.amount} added to your wallet`,
        type: "wallet",
        payload: {
          walletId: signal.walletId,
          amount: signal.amount,
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
          amount: signal.amount,
        },
      });
    }

    default:
      return;
  }
}
