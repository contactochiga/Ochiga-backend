// IQ-8: small, general synonym sets for the STATE concepts answer targeting keys on (is it open / resolved / stale / overdue / present / gone).
// Words, not phrases; each maps to ONE canonical concept so "gone cold", "neglected" and "untouched" are all "stale". Not tied to any benchmark.
export type StateConcept = "open" | "resolved" | "stale" | "overdue" | "arrived" | "departed";
const SETS: Record<StateConcept, string[]> = {
  open: ["open", "active", "unresolved", "outstanding", "pending", "ongoing", "live", "happening", "continuing", "persisting", "unfinished", "unsettled", "unaddressed", "unclosed"],
  resolved: ["resolved", "fixed", "closed", "done", "completed", "repaired", "finished", "solved", "sorted", "dealt", "handled", "settled", "addressed", "cleared", "remedied", "mended", "concluded"],
  stale: ["stale", "old", "outdated", "dated", "cold", "quiet", "dormant", "neglected", "untouched", "idle", "forgotten", "lapsed", "unattended", "inactive", "expired"],
  overdue: ["overdue", "late", "behind", "slipped", "delayed", "lagging", "pastdue"],
  arrived: ["arrive", "arrived", "arrives", "arriving", "turned", "shown", "inside", "premises", "onsite", "present", "here", "entered", "checked", "come", "came", "comes", "coming", "showed", "turn", "turns"],
  departed: ["left", "gone", "departed", "exited", "leaving", "away"],
};
const INDEX = new Map<string, StateConcept>();
for (const [c, ws] of Object.entries(SETS) as Array<[StateConcept, string[]]>) for (const w of ws) INDEX.set(w, c);
export const conceptOf = (token: string): StateConcept | undefined => INDEX.get(token);
export const isConcept = (token: string, c: StateConcept) => INDEX.get(token) === c;
export const conceptTokens = (c: StateConcept) => SETS[c];
