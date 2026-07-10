# Handover Request Prompt
# Paste this into each project in the OLD Claude.ai account.
# Claude will generate the project instructions for the new account.

---

```
I'm migrating to a new Claude.ai account and need you to generate the project instructions
for this project so I can initialize it in the new account.

Review our full conversation history in this project and produce a structured document
with everything a fresh Claude instance needs to be immediately useful — not a summary of
what we discussed, but a durable knowledge base it can operate from.

Structure the output as follows:

## [Project name]

### What this project is
One paragraph: what we're working on, why it exists, what role I play.

### Key people
Names, roles, and anything non-obvious about how I interact with each one.

### What has been decided or built
Decisions, conclusions, or work that is already settled and shouldn't be re-derived.
Facts only — no task lists, no "we discussed", no in-progress items.

### How I think and operate here
Patterns, frameworks, or preferences I've shown consistently in this project.
Things that would make a new Claude produce better output from day one.

### Rules and constraints
Hard rules that apply to all outputs in this project. Include the reason if it's
non-obvious.

### Long-term goals
The underlying goals driving the work — not current tasks.

---

Guidelines for what to include vs. exclude:

INCLUDE:
- Durable facts: decisions made, conclusions reached, things that won't change week to week
- Constraints and rules I've stated or that are clearly implied by how I operate
- Structural context: what the project IS, who is involved, what's been built
- Recurring patterns: how I frame problems, what I optimize for, what I avoid

EXCLUDE:
- Transient tasks: "evaluate X", "migrate Y", "onboard Z" — anything that sounds like a
  to-do list item
- In-progress work that will be resolved soon
- Conversation meta: references to what we discussed, when, or how many times
- Technical implementation details that only matter inside this project, not for strategy

Be complete. A new Claude instance reading this should be able to start a conversation
with me in this project without asking clarifying questions about who I am, what I'm
building, or what the rules are.
```
