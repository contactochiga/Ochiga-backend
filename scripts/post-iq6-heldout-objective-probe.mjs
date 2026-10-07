// POST-IQ6 DIAGNOSTIC (analysis only): held-out paraphrases of frozen corpus prompts, scored against the cognitive objective the ORIGINAL
// prompt receives. Measures how much of the IQ-2 objective parser is vocabulary-shaped. No runtime change; not a benchmark grade.
import fs from 'node:fs';
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const pairs = [
 ['Which three things can actually move Ochiga forward?', 'Of everything on the table, what are the three moves that really advance the company?'],
 ['Which opportunity deserves my time this morning?', 'Where should I spend my energy first today among the opportunities?'],
 ['What are we neglecting in development?', 'Is there anything in the development pipeline we are letting slide?'],
 ['What can I delegate and what needs my decision?', 'What can I hand off and what must I decide myself?'],
 ['Give me the next move, not a menu of things you can do.', 'Tell me the single thing to do now, not a list of options.'],
 ['Why is the second one more important than the others?', 'What makes number two rank above the rest?'],
 ['Does that change your priority?', 'Would that alter the order you gave me?'],
 ['What can safely wait until next week?', 'Which items are fine to postpone for a week?'],
 ['Compare the Abuja JV and the speculative large lead.', 'How does the JV stack up against the big speculative prospect?'],
 ['Should we commit now or investigate first?', 'Do we go ahead today or look into it more before deciding?'],
 ['What is the most useful missing document?', 'Which absent document would help us most?'],
 ['Anything dangerous that you actually know?', 'Is there a real hazard here that you can confirm, not guess?'],
 ['Give me a short order of work.', 'Put the jobs in a sensible running order for me.'],
 ['Does the water problem still come first?', 'Is the leak still the top issue?'],
 ['What can you actually tell me?', 'What do you genuinely know about this?'],
 ['Is this confirmed by your systems?', 'Do your own records back that up?'],
 ['I am going to bed.', 'I am heading to sleep now.'],
 ['The bedroom feels too hot.', 'It is stuffy and warm in the bedroom.'],
 ['Do you know the current temperature?', 'What temperature is it in there right now, do you have it?'],
 ['What can you safely conclude right now?', 'Based on what you can see, what is it safe to say?'],
 ['Does expired access prove they left?', 'If a visitor pass has run out, does that show they have gone?'],
 ['Does no alert mean no problem?', 'If nothing has alerted, can I assume everything is fine?'],
 ['Why is my electricity usage high?', 'What is behind my power consumption being so high?'],
 ['What should I do first?', 'Where do I begin?'],
 ['Can you mark it verified just from that?', 'Will you record it as confirmed on that basis?'],
 ['Would you send this now?', 'Is it the right moment to send this?'],
 ['What would you verify?', 'What would you double-check before relying on it?'],
 ['What evidence would change your view?', 'What new information would make you reconsider?'],
 ['Explain the conditional recommendation briefly.', 'Briefly, why is the recommendation conditional?'],
 ['What is our financial position?', 'How are we doing financially right now?'],
 ['Who is expected today?', 'Which visitors are due today?'],
];
const rows = pairs.map(([orig, para]) => { const a = parseSemanticFrame(orig).cognitiveObjective ?? null, b = parseSemanticFrame(para).cognitiveObjective ?? null; return {orig, para, original_objective: a, paraphrase_objective: b, agrees: a === b}; });
const agree = rows.filter(r => r.agrees).length;
const out = {status: 'DIAGNOSTIC', note: 'Intended objective = what the original corpus prompt receives; a disagreement means the objective parser depends on that prompt\'s vocabulary. Not graded.', pairs: rows.length, agree, disagree: rows.length - agree, agreement_rate: +(agree / rows.length).toFixed(2), rows};
fs.writeFileSync('/tmp/pi6-heldout.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify({pairs: rows.length, agree, rate: out.agreement_rate})); for (const r of rows.filter(r => !r.agrees)) console.log(`${r.original_objective} vs ${r.paraphrase_objective} :: ${r.para.slice(0, 70)}`);
