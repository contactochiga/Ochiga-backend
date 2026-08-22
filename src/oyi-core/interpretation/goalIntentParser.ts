// Oyi Autonomous Work Runtime -- pure NL parsing for goal creation,
// status queries, and safety controls (pause/resume/cancel/preference
// change). Mirrors communicationIntentParser.ts's own style and
// conservatism exactly: deliberately narrow grammar, explicit markers,
// no guessing beyond what the phrase actually says -- an unmatched
// phrase returns null and falls through to normal routing rather than
// being force-fit into a goal.
import type { GoalPlanStepChannel, GoalSuccessCondition } from "../../contracts/goal";

function text(value: unknown) {
  return String(value ?? "").trim();
}

const CHANNEL_WORD: Record<string, GoalPlanStepChannel> = {
  email: "email",
  mail: "email",
  whatsapp: "whatsapp",
  sms: "sms",
  text: "sms",
  call: "voice_call",
  phone: "voice_call",
  ring: "voice_call",
};

export type StagedChannelStep = { channel: GoalPlanStepChannel; waitHours: number };

export type GoalCreationIntent = {
  rawObjective: string; // the full phrase, minus leading verb -- stored as GoalRecord.objective verbatim
  recipientToken: string;
  messageBody: string | null; // explicit "saying ..." content; null means the caller builds a default line
  stagedPlan: StagedChannelStep[] | null; // explicit "email now, then whatsapp in 2 days" plan; null means the caller builds a default recurring single-channel plan
  requestedChannel: GoalPlanStepChannel | null; // a single channel word mentioned without a staged plan ("follow up with David by email until...")
  successCondition: GoalSuccessCondition;
  escalateAtEnd: boolean;
  deadlineHint: string | null; // raw phrase, resolved to an ISO date by resolveGoalDeadline()
  recurrenceHours: number | null; // "every 2 days" / "every 48 hours" -- used for the default plan's wait_hours when no staged plan is given
  interestedTaskTitle: string | null; // "...if he says he's interested, create a task to call him" -- non-null means a reply_branches entry should be built
};

// "...if he says he's interested, create a task for me to call him." --
// a branch, not a plan step: doesn't fire on a schedule, fires when the
// classified reply outcome is interested/positive_reply (see
// GoalReplyBranch in contracts/goal.ts). Stripped before the escalate/
// saying/until clauses since it can appear anywhere in the phrase.
function stripInterestedTaskClause(input: string): { rest: string; interestedTaskTitle: string | null } {
  const match = input.match(/^(.*?)[.,]?\s*if\s+(?:he|she|they)\s+(?:says?|is|are)\s+interested,?\s*create\s+a\s+task(?:\s+for\s+me)?(?:\s+to\s+(.+?))?\.?$/i);
  if (match && text(match[1])) {
    const taskAction = text(match[2]);
    return { rest: text(match[1]), interestedTaskTitle: taskAction ? `${taskAction.charAt(0).toUpperCase()}${taskAction.slice(1)}` : "Follow up -- they're interested" };
  }
  return { rest: input, interestedTaskTitle: null };
}

function stripEscalateClause(input: string): { rest: string; escalateAtEnd: boolean } {
  const match = input.match(/^(.*?)[,.]?\s*(?:otherwise|and if (?:that|there's|there is) no (?:reply|response|luck))?\s*(?:then\s+)?(?:escalate(?: it)?(?: to me)?|let me know|flag it for me|notify me)\.?$/i);
  if (match && text(match[1])) return { rest: text(match[1]), escalateAtEnd: true };
  return { rest: input, escalateAtEnd: false };
}

function stripSayingClause(input: string): { rest: string; messageBody: string | null } {
  const match = input.match(/^(.*?)[,]?\s+saying\s+["“]?(.+?)["”]?$/i);
  if (match && text(match[2])) return { rest: text(match[1]), messageBody: text(match[2]) };
  return { rest: input, messageBody: null };
}

const WAIT_UNIT_HOURS: Record<string, number> = { hour: 1, hours: 1, day: 24, days: 24, week: 168, weeks: 168 };

function parseStagedPlan(input: string): { rest: string; stagedPlan: StagedChannelStep[] | null } {
  if (!/\bthen\b/i.test(input) || !new RegExp(`\\b(${Object.keys(CHANNEL_WORD).join("|")})\\b`, "i").test(input)) {
    return { rest: input, stagedPlan: null };
  }
  const segments = input.split(/\s*,?\s+then\s+/i).map((s) => text(s));
  if (segments.length < 2) return { rest: input, stagedPlan: null };
  const steps: StagedChannelStep[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const channelMatch = segment.match(new RegExp(`\\b(${Object.keys(CHANNEL_WORD).join("|")})\\b`, "i"));
    if (!channelMatch) return { rest: input, stagedPlan: null }; // one segment doesn't name a channel -- not a genuine staged plan, bail out honestly rather than guessing
    const channel = CHANNEL_WORD[channelMatch[1].toLowerCase()];
    const waitMatch = segment.match(/\bin\s+(\d+)\s+(hour|hours|day|days|week|weeks)\b/i);
    const waitHours = i === 0 ? 0 : waitMatch ? Number(waitMatch[1]) * WAIT_UNIT_HOURS[waitMatch[2].toLowerCase()] : 48;
    steps.push({ channel, waitHours });
  }
  return { rest: "", stagedPlan: steps };
}

function parseRecurrence(input: string): { rest: string; recurrenceHours: number | null } {
  const match = input.match(/\bevery\s+(\d+)\s+(hour|hours|day|days|week|weeks)\b/i);
  if (!match) return { rest: input, recurrenceHours: null };
  const hours = Number(match[1]) * WAIT_UNIT_HOURS[match[2].toLowerCase()];
  return { rest: text(input.replace(match[0], "")), recurrenceHours: hours };
}

function parseDeadlineHint(input: string): { rest: string; deadlineHint: string | null } {
  const byWeekday = input.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (byWeekday) return { rest: text(input.replace(byWeekday[0], "")), deadlineHint: byWeekday[0] };
  const within = input.match(/\b(?:within|for)\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (within) return { rest: text(input.replace(within[0], "")), deadlineHint: within[0] };
  return { rest: input, deadlineHint: null };
}

function classifySuccessCondition(untilClause: string | null): GoalSuccessCondition {
  if (!untilClause) return { type: "reply_received" };
  const lower = untilClause.toLowerCase();
  if (/\b(yes|agree|confirm|positive|interested|says yes|on board)\b/.test(lower)) return { type: "positive_reply" };
  if (/\b(repl(y|ies|ied)|respond|response|hears? back|answers?)\b/.test(lower)) return { type: "reply_received" };
  return { type: "manual" };
}

const CREATION_VERB = /^(?:please\s+)?(?:follow up with|keep following up with|keep chasing|chase|check in with|make sure)\s+(.+)$/i;

// "Follow up with David until he replies, saying 'just checking in',
// otherwise escalate to me." / "Follow up with the Acme lead: email now,
// then whatsapp in 2 days, then call in 2 more days." / "Follow up with
// David every 2 days until we get a response." -- see the module header
// for the deliberately-narrow grammar this covers.
export function parseGoalCreationIntent(rawMessage: string): GoalCreationIntent | null {
  const message = text(rawMessage);
  if (!message) return null;
  const verbMatch = message.match(CREATION_VERB);
  if (!verbMatch) return null;
  let rest = text(verbMatch[1]);
  if (!rest) return null;

  const rawObjective = `follow up with ${rest}`;

  const interestedTaskStripped = stripInterestedTaskClause(rest);
  rest = interestedTaskStripped.rest;
  const escalateStripped = stripEscalateClause(rest);
  rest = escalateStripped.rest;
  const sayingStripped = stripSayingClause(rest);
  rest = sayingStripped.rest;

  // Split off an "until <condition>" tail before looking for a staged
  // plan, so the plan grammar only ever has to look at the part of the
  // phrase that's actually about channels/timing.
  let untilClause: string | null = null;
  const untilMatch = rest.match(/^(.*?)\s+until\s+(.+)$/i);
  if (untilMatch) {
    rest = text(untilMatch[1]);
    untilClause = text(untilMatch[2]);
  }

  const recurrenceParsed = parseRecurrence(rest);
  rest = recurrenceParsed.rest;

  const deadlineParsed = parseDeadlineHint(untilClause || rest);
  if (untilClause) untilClause = deadlineParsed.rest;
  else rest = deadlineParsed.rest;

  // A staged plan is only ever expressed after a colon or "by" split
  // from the recipient token, e.g. "the Acme lead: email now, then...".
  let stagedPlan: StagedChannelStep[] | null = null;
  let requestedChannel: GoalPlanStepChannel | null = null;
  const colonSplit = rest.match(/^(.+?)\s*:\s*(.+)$/);
  if (colonSplit) {
    const planParsed = parseStagedPlan(text(colonSplit[2]));
    if (planParsed.stagedPlan) {
      stagedPlan = planParsed.stagedPlan;
      rest = text(colonSplit[1]);
    }
  }
  if (!stagedPlan) {
    const byChannel = rest.match(new RegExp(`^(.+?)\\s+by\\s+(${Object.keys(CHANNEL_WORD).join("|")})\\b(.*)$`, "i"));
    if (byChannel) {
      requestedChannel = CHANNEL_WORD[byChannel[2].toLowerCase()];
      rest = text(`${byChannel[1]}${byChannel[3] || ""}`);
    }
  }

  const recipientToken = text(rest.replace(/[.,]$/, ""));
  if (!recipientToken) return null;

  return {
    rawObjective,
    recipientToken,
    messageBody: sayingStripped.messageBody,
    stagedPlan,
    requestedChannel,
    successCondition: classifySuccessCondition(untilClause),
    escalateAtEnd: escalateStripped.escalateAtEnd,
    deadlineHint: deadlineParsed.deadlineHint,
    recurrenceHours: recurrenceParsed.recurrenceHours,
    interestedTaskTitle: interestedTaskStripped.interestedTaskTitle,
  };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Resolves a raw deadline phrase ("by friday", "within 3 days") to an
// ISO timestamp. Pure date arithmetic -- not the automation scheduler's
// cron-like recurrence grammar (a different concern: this is a single
// goal's hard deadline, not a repeating trigger).
export function resolveGoalDeadline(hint: string | null, now: Date = new Date()): string | null {
  if (!hint) return null;
  const byWeekday = hint.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (byWeekday) {
    const target = WEEKDAYS.indexOf(byWeekday[1].toLowerCase());
    const result = new Date(now);
    let daysAhead = (target - result.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // "by friday" said on a Friday means next Friday, not right now
    result.setDate(result.getDate() + daysAhead);
    result.setHours(17, 0, 0, 0); // end of business day, honest default -- not claiming a specific deadline time the user never gave
    return result.toISOString();
  }
  const within = hint.match(/\b(?:within|for)\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (within) {
    const hours = Number(within[1]) * WAIT_UNIT_HOURS[within[2].toLowerCase()];
    return new Date(now.getTime() + hours * 3600_000).toISOString();
  }
  return null;
}

export type GoalQueryIntent = { recipientToken: string | null };

// "How's the follow-up with David going?" / "What's the status of the
// goal?" / "Any update on following up with the Acme lead?" / "Is the
// follow-up with David done?" -- deliberately DISTINCT phrasing from
// parseReplyOrThreadQuery's "did he answer?" (that already works against
// the raw communication thread and keeps working unchanged; this is
// specifically about the GOAL's own lifecycle/plan state).
export function parseGoalQueryIntent(rawMessage: string): GoalQueryIntent | null {
  const message = text(rawMessage);
  if (!message) return null;
  if (/^(?:what'?s|what is)\s+the\s+status\s+of\s+(?:the\s+)?(?:goal|follow[\s-]?up)(?:\s+with\s+(.+?))?\??$/i.test(message)) {
    const m = message.match(/\bwith\s+(.+?)\??$/i);
    return { recipientToken: m ? text(m[1]) : null };
  }
  if (/^(?:how'?s|how is)\s+the\s+follow[\s-]?up(?:\s+with\s+(.+?))?\s+going\??$/i.test(message)) {
    const m = message.match(/\bwith\s+(.+?)\s+going\??$/i);
    return { recipientToken: m ? text(m[1]) : null };
  }
  if (/^(?:any\s+update|what'?s\s+the\s+latest)\s+on\s+(?:the\s+follow[\s-]?up\s+with\s+)?(.+?)\??$/i.test(message)) {
    const m = message.match(/\bon\s+(?:the\s+follow[\s-]?up\s+with\s+)?(.+?)\??$/i);
    return { recipientToken: m ? text(m[1]) : null };
  }
  if (/^is\s+the\s+follow[\s-]?up(?:\s+with\s+(.+?))?\s+(?:done|complete|finished)\??$/i.test(message)) {
    const m = message.match(/\bwith\s+(.+?)\s+(?:done|complete|finished)\??$/i);
    return { recipientToken: m ? text(m[1]) : null };
  }
  return null;
}

// "Show me my active follow-ups" / "What follow-ups do I have going?" /
// "List my follow-up goals" -- Part M, Office visibility via the
// EXISTING conversational surface (no new dashboard): a list of every
// non-terminal goal, not one goal in particular.
export function isGoalListQuery(rawMessage: string): boolean {
  const message = text(rawMessage).toLowerCase();
  if (!message) return false;
  return (
    /^(?:show me|what are|list)\s+(?:my\s+)?(?:active\s+|current\s+|pending\s+)?follow[\s-]?ups?[\s.?!]*$/.test(message) ||
    /^what\s+follow[\s-]?ups?\s+(?:do i have|are (?:active|going|in progress))[\s.?!]*$/.test(message) ||
    /^(?:show me|list)\s+(?:my\s+)?(?:active\s+)?goals?[\s.?!]*$/.test(message)
  );
}

// "Which leads have not replied?" / "Who hasn't replied yet?" -- Programme
// B. Reuses the SAME goal-list mechanism as isGoalListQuery, filtered to
// goals with zero inbound_reply observations, rather than a new
// aggregate query system.
export function isNoReplyGoalsQuery(rawMessage: string): boolean {
  const message = text(rawMessage).toLowerCase();
  if (!message) return false;
  return (
    /^which\s+(?:leads?|contacts?|people)\s+(?:have\s+not|haven'?t)\s+repl(?:y|ied)/.test(message) ||
    /^who\s+(?:has(?:n'?t| not)|hasn'?t)\s+repl(?:y|ied)/.test(message) ||
    /^(?:show me\s+)?(?:leads?|contacts?|people)\s+(?:that|who)\s+(?:have\s+not|haven'?t)\s+repl(?:y|ied)/.test(message)
  );
}

export type GoalControlIntent =
  | { kind: "pause"; recipientToken: string | null }
  | { kind: "resume"; recipientToken: string | null }
  | { kind: "cancel"; recipientToken: string | null }
  | { kind: "restrict_to_channel"; channel: GoalPlanStepChannel; recipientToken: string | null }
  | { kind: "block_channel"; channel: GoalPlanStepChannel; recipientToken: string | null };

// Safety controls (Part N) -- must take effect immediately, so this is
// checked at the same high precedence as pause/resume/cancel of any
// other governed action in this codebase. "Stop contacting him" reads as
// a full cancel (the goal's entire purpose is contacting them); "don't
// call again"/"only email from now on" narrow the channel instead of
// stopping the goal outright.
export function parseGoalControlIntent(rawMessage: string): GoalControlIntent | null {
  const message = text(rawMessage);
  if (!message) return null;

  const withToken = message.match(/\bwith\s+(.+?)\.?$/i);
  const recipientToken = withToken ? text(withToken[1]) : null;

  if (/^(?:please\s+)?pause\s+(?:the\s+)?(?:goal|follow[\s-]?up|that)/i.test(message)) return { kind: "pause", recipientToken };
  if (/^(?:please\s+)?resume\s+(?:the\s+)?(?:goal|follow[\s-]?up|that)/i.test(message)) return { kind: "resume", recipientToken };
  if (/^(?:please\s+)?(?:cancel|stop)\s+(?:the\s+)?(?:goal|follow[\s-]?up|that)/i.test(message)) return { kind: "cancel", recipientToken };
  if (/^stop\s+following\s+up\s+with\s+/i.test(message)) return { kind: "cancel", recipientToken };
  if (/^stop\s+contacting\s+(him|her|them|[a-z][a-z .'-]{1,40})\b/i.test(message)) {
    const m = message.match(/^stop\s+contacting\s+(him|her|them|[a-z][a-z .'-]{1,40})\b/i);
    return { kind: "cancel", recipientToken: m ? text(m[1]) : null };
  }
  if (/^don'?t\s+contact\s+(him|her|them|[a-z][a-z .'-]{1,40})\s+(?:anymore|again)\b/i.test(message)) {
    const m = message.match(/^don'?t\s+contact\s+(him|her|them|[a-z][a-z .'-]{1,40})\s+(?:anymore|again)\b/i);
    return { kind: "cancel", recipientToken: m ? text(m[1]) : null };
  }

  const dontChannelAgain = message.match(new RegExp(`^don'?t\\s+(${Object.keys(CHANNEL_WORD).join("|")})\\s+(him|her|them|[a-z][a-z .'-]{1,40})?\\s*(?:again|anymore)\\b`, "i"));
  if (dontChannelAgain) return { kind: "block_channel", channel: CHANNEL_WORD[dontChannelAgain[1].toLowerCase()], recipientToken: dontChannelAgain[2] ? text(dontChannelAgain[2]) : recipientToken };

  // "Stop calling this person." / "Stop calling David." / "Stop emailing her."
  const stopChannelWord = message.match(/^stop\s+(calling|emailing|texting|messaging)\s*(him|her|them|this person|[a-z][a-z .'-]{1,40})?\b/i);
  if (stopChannelWord) {
    const channel = stopChannelWord[1].toLowerCase() === "calling" ? "voice_call" : stopChannelWord[1].toLowerCase() === "emailing" ? "email" : "sms";
    const named = stopChannelWord[2] && stopChannelWord[2].toLowerCase() !== "this person" ? text(stopChannelWord[2]) : null;
    return { kind: "block_channel", channel, recipientToken: named || recipientToken };
  }

  const onlyChannel = message.match(new RegExp(`^only\\s+(${Object.keys(CHANNEL_WORD).join("|")})\\s+(?:him|her|them|[a-z][a-z .'-]{1,40})?\\s*from\\s+now\\s+on\\b`, "i"));
  if (onlyChannel) return { kind: "restrict_to_channel", channel: CHANNEL_WORD[onlyChannel[1].toLowerCase()], recipientToken };

  return null;
}
