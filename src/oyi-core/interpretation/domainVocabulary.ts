// IQ-7: domain vocabulary shared by fact classification and subject derivation. These are NOUN STEMS naming the things Oyi governs (leads,
// projects, leaks, cameras, visitors ...), i.e. legitimate domain vocabulary. No place names, no people's roles, no benchmark phrases.
export type DomainHit = { domain: string; at: number };
const VOCAB: Array<[string, string[]]> = [
  ["office_reports", ["report*", "approvals", "approval"]],
  ["office_financial", ["financ*", "fund*", "budget*", "cash", "revenue", "collections", "money", "loan*", "capital", "payment*", "invoice*", "profit*", "mortgage"]],
  ["crm", ["lead", "leads", "prospect*", "deal", "deals", "opportunit*", "pipeline", "buyer*", "investor*", "enquir*", "inquir*", "client*", "offer", "offers", "offering"]],
  ["office_development", ["project", "projects", "development", "developments", "scheme*", "survey*", "surveyor*", "contractor*", "builder*", "construction", "storey*", "zoning", "permit*", "planning", "title", "blocker*"]],
  ["maintenance", ["leak*", "pipe*", "repair*", "plumb*", "maintenance", "fault*", "lift", "elevator", "generator", "pump", "drain*", "flood*", "water", "broken", "damp", "crack*", "problem*", "issue*", "ticket*"]],
  ["security", ["detector*", "smoke", "security", "incident*", "alarm*", "intruder*", "theft", "burglar*", "guard*", "gate", "gates", "patrol*"]],
  ["cameras", ["camera*", "cctv", "footage"]],
  ["visitors", ["visitor*", "guest*", "arriv*", "expected", "deliver*", "courier", "come", "coming", "visiting", "visited"]],
  ["devices", ["device*", "light", "lights", "lamp*", "switch*", "plug*", "socket*", "tv", "lock", "locks", "locked", "door", "doors", "window*", "sensor*", "thermostat", "fan", "heater", "ac", "aircon", "air", "conditioner", "appliance*"]],
  ["utilities", ["electricity", "power", "energy", "bill", "bills", "meter*", "tariff*", "gas", "internet", "solar", "kwh", "consumption", "usage"]],
  ["wallet", ["wallet", "balance", "spend*", "spent", "spending", "transaction*"]],
  ["rooms", ["bedroom*", "kitchen", "bathroom", "lounge", "study", "room", "rooms", "garage", "porch", "hall", "hallway", "balcony", "attic", "basement"]],
  // property / opportunity vocabulary (public qualification and Office development)
  ["corporate_opportunity", ["land", "plot", "plots", "property", "building", "buildings", "house", "estate", "owner*", "owns", "own", "family", "heir*", "relative*", "inherit*", "title", "survey*", "zoning", "planning", "permit*", "storey*", "acre*", "hectare*", "sqm", "metres", "metre", "jv", "joint", "venture", "lease*", "sale", "sell*", "tenant*", "agree*", "consent*", "sign*", "residential", "commercial", "access", "road"]],
  ["environment", ["hot", "cold", "warm", "stuffy", "stifling", "humid", "freezing", "boiling", "noisy", "loud", "smell*"]],
];
const match = (t: string, stem: string) => (stem.endsWith("*") ? t.startsWith(stem.slice(0, -1)) : t === stem);
export function domainHits(tokens: string[]): DomainHit[] {
  const hits: DomainHit[] = [];
  tokens.forEach((t, at) => { for (const [domain, stems] of VOCAB) if (stems.some(s => match(t, s))) hits.push({ domain, at }); });
  return hits.sort((a, b) => a.at - b.at);
}
export const hasDomainVocabulary = (tokens: string[]) => domainHits(tokens).length > 0;
