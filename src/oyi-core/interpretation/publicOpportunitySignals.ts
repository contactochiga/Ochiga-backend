import type { SemanticFrame } from "../contracts/semanticFrame";
import { analyse, isCapabilityInquiryText } from "./semanticObjective";

// IQ-7: inside an active public qualification thread, what the visitor says next is about THEIR opportunity unless it asks for something
// private or about the company itself. This is a structural/contextual rule, not a list of accepted sentences: a thread with an established
// opportunity objective + a statement or question that is not a private-data probe, a company-knowledge question or a capability inquiry.
const PRIVATE = new Set(["private", "internal", "confidential", "investor", "investors", "staff", "employee", "employees", "restriction", "restrictions", "ignore", "bypass", "override", "credentials", "password", "passwords", "clients", "client", "competitors", "competitor"]);
const SOCIAL = new Set(["hello", "hi", "hey", "thanks", "thank", "bye", "goodbye", "cheers"]);
export function isPrivateProbe(text: string): boolean {
  const T = analyse(text).tokens;
  if (T.some(t => PRIVATE.has(t))) return true;
  if (T.includes("who") && (T.includes("else") || T.includes("other") || T.includes("others"))) return true;
  if (T.includes("your") && T.some(t => ["other", "others", "clients", "investors", "leads", "pipeline"].includes(t))) return true;
  if (T.includes("contact") && T.includes("details")) return true;
  if (T.some(t => ["phone", "email", "emails", "numbers"].includes(t)) && T.some(t => ["their", "his", "her", "them", "your"].includes(t))) return true;
  return false;
}
export function isOpportunityContinuation(text: string, frame: Pick<SemanticFrame, "domain">, hasObjective: boolean): boolean {
  if (!hasObjective) return false;
  const u = analyse(text), T = u.tokens;
  if (T.length < 2 || T.every(t => SOCIAL.has(t))) return false;
  if (isCapabilityInquiryText(text) || isPrivateProbe(text)) return false;
  if (frame.domain === "corporate_company" || frame.domain === "corporate_oyi" || frame.domain === "corporate_private") return false;
  return true;
}
