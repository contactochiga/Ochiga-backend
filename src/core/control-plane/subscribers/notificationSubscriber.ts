import { Signal } from "../contracts/signal.types";
import { NotificationService } from "../../services/NotificationService";

export async function notificationSubscriber(signal: Signal) {
  switch (signal.type) {
    /* ---------------- COMMUNITY ---------------- */

    case "community.post.created":
      return NotificationService.sendToEstate(signal.estateId, {
        title: "New Community Post",
        message: signal.title,
        type: "community",
        payload: { postId: signal.postId },
      });

    case "community.comment.created":
      return NotificationService.sendToEstate(signal.estateId, {
        title: "New Comment",
        message: "Someone commented on a post",
        type: "community",
        payload: {
          postId: signal.postId,
          commentId: signal.commentId,
        },
      });

    case "community.post.flagged":
      return NotificationService.sendToRole("estate_admin", {
        title: "Post Flagged",
        message: "A community post was flagged for review",
        type: "moderation",
        payload: {
          postId: signal.postId,
          reason: signal.reason,
        },
      });

    /* ---------------- WALLET ---------------- */

    case "wallet.funded":
      return NotificationService.sendToUser(signal.userId, {
        title: "Wallet Funded",
        message: `₦${signal.amount} added to your wallet`,
        type: "wallet",
        payload: { walletId: signal.walletId },
      });

    case "wallet.debited":
      return NotificationService.sendToUser(signal.userId, {
        title: "Wallet Debited",
        message: `₦${signal.amount} deducted`,
        type: "wallet",
        payload: { walletId: signal.walletId },
      });
  }
}
