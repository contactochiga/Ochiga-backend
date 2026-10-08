import type { AnswerTarget } from "./answerTarget";
import { clarificationQuestion, denialAnswer, limitationAnswer } from "./limitationTarget";
import { actionTruthLead, communicationTruthLead, type ActionTruth } from "./actionTruth";

// IQ-9A5 R2: fallback ownership. A capability menu or a generic "no evidence source" line is the LAST resort of the terminal fallbacks. Before either is
// shown, the carried AnswerTarget (and the facts the thread already holds) decide whether the user's actual question has a specific, truthful answer:
// an authority refusal, an action/communication truth, a pending-approval statement, a public held-facts answer, a presence limitation or one specific
// clarification. This module is pure: the orchestrator supplies the thread facts; nothing here reads data, calls a capability or executes anything.
export type FallbackFacts = {
  surface: string;
  raw: string;
  truth: ActionTruth;
  pending_approval: boolean;       // a governed proposal in this thread is waiting for the user's approval
  held_facts: Record<string, string> | null; // public opportunity facts the visitor shared in this conversation (null = none)
};
export type FallbackAnswer = { key: string; status: "answered" | "permission_restricted"; answer: string };

const nice = (k: string) => k.replace(/_/g, " ");
const recap = (held: Record<string, string> | null) => {
  const entries = Object.entries(held || {});
  return entries.length ? `What you've told me so far, held in this conversation only: ${entries.map(([k, v]) => `${nice(k)}: ${v}`).join("; ")}.` : "I don't have structured opportunity details stored for this conversation, so I can't list them back; anything you typed stays in this chat only.";
};

const RE = {
  emailMe: /\b(?:e-?mail|send)\b[^.?!]{0,40}\b(?:me|summary|recap|copy)\b/i,
  handedOver: /\b(?:passed|handed|forwarded|submitted|sent|given|shared|relayed)\b[^.?!]{0,40}\b(?:team|office|staff|sales|ochiga|management|anyone)\b|\b(?:team|office|staff|sales|ochiga)\b[^.?!]{0,30}\b(?:received|got|have|has|know|been\s+(?:told|given|sent))\b/i,
  withdrawCall: /\b(?:don'?t|do\s+not|never|no\s+longer|cancel|forget|skip)\b[^.?!]{0,30}\b(?:call|contact|ring|phone|reach)\b/i,
  arrangeCall: /\b(?:arrange|book|schedule|set\s+up|fix|organi[sz]e|line\s+up)\b[^.?!]{0,40}\b(?:call|meeting|appointment|visit|chat)\b/i,
  contactInquiry: /\b(?:what|how)\b[^.?!]{0,30}\b(?:can|could|do)\s+you\b[^.?!]{0,60}\b(?:talk|speak|call|contact|reach|connect|put\s+me\s+(?:in\s+touch|through)|get\s+(?:someone|somebody))\b|\b(?:can|could)\s+you\b[^.?!]{0,40}\b(?:connect|put)\s+me\b/i,
  structureChoice: /\b(?:lease|sale|sell|joint\s+venture|jv)\b[^.?!]{0,60}\b(?:best|better|which|should\s+i|recommend|right\s+(?:one|choice|structure))\b|\b(?:best|better|which|recommend)\b[^.?!]{0,60}\b(?:lease|sale|joint\s+venture|jv)\b/i,
  presence: /\b(?:at\s+the\s+(?:door|gate)|outside|here\s+(?:now|yet)|arrived|inside|in\s+the\s+(?:house|compound|estate))\b/i,
  elliptical: /^\s*(?:ok(?:ay)?|then|and|so|just|also|what\s+about|how\s+about|same)\b|\b(?:just\s+mine|the\s+other\s+one|that\s+one|those|them)\b/i,
};

/** Returns the specific answer a terminal fallback should give instead of a menu / generic unsupported line, or null when none applies (the menu stays for capability discovery and genuinely unclaimed requests). */
export function targetedFallbackAnswer(t: AnswerTarget | undefined, f: FallbackFacts): FallbackAnswer | null {
  if (!t || t.response_intent === "CAPABILITY_DISCOVERY") return null; // a capability menu is correct ONLY for an explicit capability question
  const asked = f.raw.replace(/\s+/g, " ").trim().slice(0, 120);
  const out = (key: string, answer: string, status: FallbackAnswer["status"] = "answered"): FallbackAnswer => ({ key: `answer_target.fallback_${key}`, status, answer });

  // 1 authority and privacy: preserved, never softened into a menu
  if (f.surface === "consumer" && t.subject_scope !== "own") return out("scope_refusal", denialAnswer("requested_scope_not_authorized", asked, false), "permission_restricted");
  if (t.response_intent === "REFUSAL") return out("refusal", limitationAnswer(t, f.raw));

  // 2 a question about whether something happened: the thread's own records answer it (never "yes" without a record)
  if (t.response_intent === "ACTION_RESULT") {
    if (f.pending_approval) return out("pending_approval", "No — nothing has been sent or changed. Your request is waiting for your approval, and it only happens if you approve it; saying cancel drops it.");
    return out("action_truth", t.action_domain === "communication" ? communicationTruthLead(f.truth, Boolean(t.future_event)) : actionTruthLead(f.truth));
  }

  // 3 Osa: what the visitor shared, what has (not) been submitted, contact and callback status
  if (f.surface === "public_corporate") return publicFallbackAnswer(t, f) ?? (t.ask_facet === "recall" ? out("public_recall", recap(f.held_facts)) : null);

  // 4 a resident or facility reader asking about presence from permission records
  if ((f.surface === "consumer" || f.surface === "facility") && (t.state_concept === "arrived" || t.state_concept === "departed" || RE.presence.test(f.raw)) && /\b(?:visitor|guest|pass|active\s+one|expected)\b/i.test(`${f.raw} ${(t.subject_tokens || []).join(" ")}`)) {
    return out("presence_limitation", "I can't say anyone is at the door or has arrived: visitor access records show permission (active or inactive), not whether anyone has turned up, is here or has left.");
  }

  // 5 an elliptical turn whose referent cannot be determined: one specific question, never a menu and never a guess from an unrelated list
  if ((f.surface === "consumer" || f.surface === "facility") && f.raw.trim().split(/\s+/).length <= 8 && RE.elliptical.test(f.raw)) {
    return out("clarify_referent", `I'm not sure what “${asked}” refers to, so I haven't looked anything up. Tell me what you want to see for your home — for example your visitors, wallet, devices or maintenance requests.`);
  }
  if (t.response_intent === "CLARIFICATION") return out("clarification", clarificationQuestion(t));
  return null;
}

const outKey = (key: string, answer: string, status: FallbackAnswer["status"] = "answered"): FallbackAnswer => ({ key: `answer_target.fallback_${key}`, status, answer });
/** The public (Osa) share of the fallback: also used by the public opportunity module for turns it owns but that are not opportunity statements (email, booking, withdrawal, contact options, structure choice, submission state). */
export function publicFallbackAnswer(t: AnswerTarget, f: FallbackFacts): FallbackAnswer | null {
  const out = outKey;
  if (t.response_intent === "REFUSAL") return out("refusal", limitationAnswer(t, f.raw));
  if (RE.contactInquiry.test(f.raw)) return out("public_contact_options", "Here is what I can do toward getting someone from Ochiga to talk to you: tell you about Ochiga and its developments, take the details of your opportunity in this conversation, and — if you ask me to — pass a callback request to the team. Passing it on is not the same as a call being booked: I only report that the team received it if I get a receipt, and I can't promise a time. Nothing is sent unless you ask for it.");
    if (RE.withdrawCall.test(f.raw)) return out("public_callback_withdrawn", `Understood — I won't ask the team to contact you, and nothing has been submitted from this conversation as far as my records show${f.truth.known && f.truth.attempted > 0 ? "; if a request was passed on earlier I can't recall it from here, so contact the team at ochiga.com.ng/contact" : ""}. ${recap(f.held_facts)}`);
    if (RE.emailMe.test(f.raw) && t.response_intent !== "COUNT") return out("public_no_email", `I can't email anything from this chat, so nothing has been sent to you. ${recap(f.held_facts)}`);
    if (t.ask_facet === "submission" || t.yes_no?.kind === "submission" || (RE.handedOver.test(f.raw) && (t.response_intent === "YES_NO_WITH_REASON" || /\?/.test(f.raw)))) return out("public_submission_state", `${f.truth.known && f.truth.attempted === 0 ? "No — nothing has been handed to the team: I have no handoff receipt for this conversation." : communicationTruthLead(f.truth)} ${recap(f.held_facts)} A callback request goes to the team only if you ask me to send one.`);
    if (RE.arrangeCall.test(f.raw)) return out("public_cannot_book", "I can't arrange or book a call from this chat, and nothing has been booked. If you'd like the team to contact you, say so and I'll pass a callback request on (the team receiving it is not a booked call). I only keep what you tell me in this conversation, so tell me how you'd like to be reached.");
    if (!f.held_facts && RE.structureChoice.test(f.raw)) return out("public_no_recommendation", "I can't tell you which structure is best for your land: that depends on details such as title, size, location and what you want from the deal, and any recommendation or terms come from Ochiga's team after a proper review. I can note what you tell me here and pass a callback request to the team if you ask.");
    return null;
  
}
