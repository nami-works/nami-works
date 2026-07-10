# Claude.ai org instruction — shortcut discovery nudge

Purpose: teach the GE Beauty team the slash-command/skill shortcuts by surfacing a
lightbulb tip whenever someone manually describes a task that an available command
already does.

## Where it goes

Claude.ai **Teams/Enterprise** → org admin settings → **organization custom
instructions** (applies to every member's conversations). Lucas is admin.

## Hard dependency (sequence matters)

The nudge points people to `/commands`. Those commands must **exist on claude.ai**
first — Lucas's `/challenge`, `/recap`, `/design-engineer` etc. are today **Claude
Code** skills (in this repo's `.claude/`), which do NOT exist on claude.ai. So:

1. **First**: publish the skills you want the team to have as claude.ai **Skills**
   (org-published), and maintain a shortcuts index they can open.
2. **Then**: turn on the instruction below. It only ever names commands that are
   actually published — it must never invent one.

Until step 1 is done, the instruction is harmless (nothing will match) but useless.

## The instruction (paste into org custom instructions)

> When a member's plain-language request matches something an available published
> skill/command already does (e.g. they ask you to pressure-test or poke holes in a
> plan → `/challenge`; to summarize where things stand → `/recap`; to mock up a UI →
> `/design-engineer`), first do the task exactly as asked. Then, at the very END of
> your reply, add one highlighted callout in this exact shape:
>
> > 💡 **Atalho:** da próxima vez, é só digitar **/{comando}** que eu já faço isso direto. Veja todos os atalhos em **/help**.
>
> Rules:
> - Only add it when a **real, published** command matches. Never invent or guess a
>   command that isn't available to this org.
> - Name the single best-fit command (not a list).
> - Show a given command's tip **at most once per conversation** — don't repeat it.
> - Keep it to that one line. It's a helpful nudge, not a lecture, and never replaces
>   actually doing the task.
> - Match the member's language (Portuguese in → Portuguese tip).

## Open items to finalize

- Confirm the exact claude.ai admin path for org custom instructions + Skills
  publishing (verify against current claude.ai Teams/Enterprise UI).
- Decide the "learn other shortcuts" destination: `/help`, a pinned org resource, or
  a maintained "Atalhos" doc. Wire that into the instruction's last sentence.
- Choose which Claude Code skills to port to claude.ai first (the team-useful ones:
  e.g. challenge, recap; the deep engineering ones like design-engineer may not fit
  a non-Code surface).
