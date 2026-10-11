# IQ-10E review discoveries

The original frozen development contract and scenarios are unchanged. Review of
the first canonical 21-turn run found failures that its coarse save/truth checks
did not detect. They were preserved in `scripts/iq10e-live-review.mjs` before
the corresponding context repairs, not turned into passes by changing prompts.

1. Osa's auxiliary *have* in a title-verification statement was interpreted as
   possession of a second property, introducing an empty third entity. The
   existing concept bridge now requires the ordinal to be in the possession
   complement. The existing title extractor retains explicit unverified status.
   No entity store, canonical record write or qualification criterion was added.
2. A suspended device assessment swallowed a later visitor-arrival question
   despite its explicit visitor subject. Existing assessment transition logic
   now lets a newer authorised retrieval, matching the explicit question's
   domain, replace a suspended subject even when the question has pronouns.
   A broader domain-only attempt lost utility and visitor-access context during
   preservation review and was rejected. New evidence passes the same planner
   authority/scope gates. This is not a privilege restoration.
3. Open questions about verification were projected as generic assessments or
   lists. Existing AnswerTarget now represents that question shape as NEXT_STEP;
   imperative verification, action results and ordinary status retain owners.
4. Provider-off explanations without a ranking must say no ordering exists,
   not merely ask which record. Initial focused output violated IQ-5/IQ-6
   regressions. Restored the no-ordering contract; no old assertion changed.
5. A request for missing evidence with no recorded uncertainty fell back to the
   whole business summary. It now states the missing comparative-judgment
   requirement and preserves the supplied-view limitation.

The first full run is diagnostic only: source changed during it, and its guard
correctly rejected certification. Only the final unchanged-source run qualifies.
All authorship is maintainer development; no independently authored paraphrase
or blinded certification claim is made. No sealed IQ-9B utterances were used.
