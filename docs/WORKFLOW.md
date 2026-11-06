# Working on Somae

We work from direct prompts. Scott describes the desired outcome; the coding agent handles finding context, implementation, verification and keeping the relevant repo documentation current. The result should be working code and clear evidence that it was checked.

## Start a piece of work

A prompt can be as simple as “make replies advance to the next signal” or “build the first hosted-agent connection.” No ticket, prompt template or separate test plan is required.

For a substantial change, the agent briefly states the outcome and how we will know it works before proceeding. Useful details are the goal, scope and observable completion condition. Small edits can proceed directly. Clarify product decisions that affect behavior; resolve routine implementation choices from the repo and conversation.

Keep one coherent deliverable in progress in a chat. New messages normally steer that work. Break a large feature into working pieces that can be reviewed and verified independently.

## Implement and check

The agent runs `npm run context -- <area-or-path>` and reads the selected guides. Context comes from the repository map, module guides and domain contract; use their links to inspect current source and relevant tests.

The agent implements the change and reuses existing checks. Add or extend an ordinary test when important behavior lacks coverage. These tests check Somae's behavior; Scott does not need to write evaluation tasks or score coding agents.

Before completion, run `npm run verify`. For UI changes, also inspect the working page in a browser. For new infrastructure, languages or integrations, add the appropriate build/integration checks to the same gate. A normal return from an agent or a convincing explanation is not verification.

Finish with the changed behavior, reviewable files or preview, checks actually run and any unresolved limitation. Report failures honestly. Publishing, deployment and merging follow the user's authorization; a local verification pass does not perform them.

## Keep context current

The agent maintains context with the code change:

- Behavior or usage changed: update the affected module guide.
- A path, module or check moved: update the repository map and references.
- A product rule changed: update the contract, ontology, guarded implementation, types and relevant tests together.
- Only implementation details changed: review the relevant context, but don't create a documentation diff that adds no useful information.

Verification checks references and regenerates source-based graph/report artifacts. It also suggests guides to review when source files changed since the previous saved verification report. That comparison is a convenience; it cannot detect every outdated explanation. The agent still reads the sources and preserves intended requirements when code disagrees.

Maintain one source for each fact. Guides explain usage and decisions; the map points to code and commands; domain records connect business rules to enforcement and tests. Don't invent historical rationale, mirror every helper in prose or add a second catalog.

## When an issue is useful

Prompts are the default during design, exploration and small changes. Use a durable issue for work we want to remember later, a deliverable spanning several chats or contributors, or a dependency/blocker we need to track. Linear can hold that backlog if we choose it; it is not required to use this repo workflow.

An issue needs only a short title, goal, relevant context and a few observable completion conditions. Its description becomes the brief for a chat. Keep the implementation discussion in the chat and the lasting decisions in the repo; avoid maintaining the same details in several places.

For now, send the next desired outcome here. The agent owns the checks and context updates as part of doing the work.
