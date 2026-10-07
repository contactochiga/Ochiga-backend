// IQ-8B: acknowledge a standing constraint in the user's own terms ("I won't ..." with the pronouns turned round), then state what is already true:
// nothing here sends, shares or changes anything unless the user asks and confirms. No durable state is created.
const LEAD = /^\s*(?:please\s+|kindly\s+)?(?:from now on,?\s+|going forward,?\s+)?(?:do not|don't|dont|never(?: ever)?|ever|no more|stop)\s+(?:ever\s+)?/i;
const flip = (s: string) => {
  // I/my/me -> you/your/you, then the original "you" -> "me" (marked first so it is not flipped twice)
  return s.replace(/\byou\b/gi, "\u0001").replace(/\bI\b/g, "you").replace(/\bmy\b/gi, "your").replace(/\bme\b/gi, "you").replace(/\bmine\b/gi, "yours").replace(/\u0001/g, "me");
};
export function acknowledgeConstraint(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  const m = LEAD.exec(text);
  const rest = m ? text.slice(m[0].length) : "";
  const tail = "Nothing I do here sends, shares or changes anything unless you ask and confirm it.";
  if (m && rest) return `Understood — I won't ${flip(rest)}. ${tail}`;
  const keep = /^\s*(?:please\s+)?keep\s+(.+)$/i.exec(text);
  if (keep) return `Understood — I'll treat ${flip(keep[1])} as confidential. ${tail}`;
  return `Understood — noted for this conversation: “${text.slice(0, 200)}”. ${tail}`;
}
