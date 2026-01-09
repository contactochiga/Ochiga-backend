import { BaseSignal } from "./signal.types";

export interface CommunityPostCreatedSignal extends BaseSignal {
  type: "community.post.created";
  postId: string;
  estateId: string;
  authorId: string;
}

export interface CommunityPostUpdatedSignal extends BaseSignal {
  type: "community.post.updated";
  postId: string;
  estateId: string;
}

export interface CommunityPostDeletedSignal extends BaseSignal {
  type: "community.post.deleted";
  postId: string;
  estateId: string;
}

export interface CommunityCommentCreatedSignal extends BaseSignal {
  type: "community.comment.created";
  postId: string;
  commentId: string;
  estateId: string;
  authorId: string;
}

export interface CommunityReactionAddedSignal extends BaseSignal {
  type: "community.reaction.added";
  targetType: "post" | "comment";
  targetId: string;
  estateId: string;
  userId: string;
}

export interface CommunityPollVotedSignal extends BaseSignal {
  type: "community.poll.voted";
  postId: string;
  estateId: string;
  userId: string;
  option: string;
}

export type CommunitySignal =
  | CommunityPostCreatedSignal
  | CommunityPostUpdatedSignal
  | CommunityPostDeletedSignal
  | CommunityCommentCreatedSignal
  | CommunityReactionAddedSignal
  | CommunityPollVotedSignal;
