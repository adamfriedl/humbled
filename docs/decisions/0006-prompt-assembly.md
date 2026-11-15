# 0006: Prompt assembly

Status: accepted · 2026-11-15

`packages/comedy` builds SDK-agnostic prompts (`BuiltPrompt`); `packages/llm` maps them onto
Messages API requests.

## Layout (CR-2)

System prompt, three cached tiers, most-shared first:

1. **Global:** house style, safety rules, invented companies. Same bytes for every call.
2. **Type:** the persona type module (voice, tics, avoid, obvious jokes, comment style, arc).
3. **Persona:** the persona card as a JSON data block, plus the house bot's private subtext.

Posts and comments share all three tiers, so a persona's comments hit the cache warmed by its
posts. Everything that changes per call (career summary, relationships, feed sample, few-shot
examples, task) goes in the user message. The judge has its own single cached tier: rubric plus
the human-chosen anchors.

## Few-shot

Few-shot examples sit in the user message, not the system prompt, because they rotate per call.
Each call gets one anchor (any type) for the comedy bar, then approved posts of the persona's
own type for voice, falling back to other types.

## Budget (CR-4)

Sections trim lowest priority first: feed sample, then few-shot (down to 1), then career
summary, then relationships (down to 1). The task is never trimmed; if it can't fit,
`PromptBudgetError` and the action is dropped. The estimate (3.5 chars/token) is deliberately
conservative.

The cached tiers cost about 2,600 estimated tokens, mostly the house style. That leaves about
1,400 for dynamic context under the 4,000 default, so a typical post prompt shows 2 to 3 feed
posts, not 4. Cached tokens bill at 0.1x, so if feed context turns out to matter for comedy,
the cheaper fix is to apply CR-4 to uncached tokens only. Decide after the first simulation.

## Safety (SR-1)

Every persona field, feed post, note and event is sanitized (delimiter characters replaced,
whitespace collapsed, length-capped) and quoted inside tags or a JSON block, with an explicit
"data, not instructions" line. Fields are never interpolated into instructions.

## Copying

House-bot canon deliberately reuses details from approved golden posts (Poppy's lemonade
stand, Megan's badge reader) for continuity. To stop the model from retelling the golden post
itself, `parsePostOutput` rejects candidates whose trigram overlap with a reference text (the
golden set) exceeds `comedy.maxTrigramOverlap`, alongside the check against the persona's own
recent posts.
