---
name: agent-tool-design
description: >
  Principles and patterns for designing agent tool interfaces, action spaces, and elicitation flows —
  distilled from production lessons building Claude Code. Use this skill whenever you are designing,
  reviewing, or iterating on the tools an AI agent can call. This includes deciding whether to add a
  new tool vs. using progressive disclosure, structuring search/context-building tools, handling
  capability upgrades across model generations, designing elicitation and user-input tools, or
  auditing an existing agent's tool set for bloat or constraint. Trigger this skill when the user
  mentions "agent tools", "action space", "tool design", "agent architecture", "elicitation",
  "progressive disclosure", or asks how to give an agent the right capabilities.
---

# Agent Tool Design — Seeing Like an Agent

This skill encodes production-tested patterns for designing the tools and action space of an AI agent.
The core mindset: **you want to give the agent tools shaped to its own abilities.** To know what those
abilities are, you pay attention, read its outputs, and experiment. You learn to see like the agent.

## Core Framework: Match Tools to Agent Ability

Think of it like giving someone a math problem:

- **Paper** (minimal tool) — works, but limited by manual effort.
- **Calculator** (structured tool) — more powerful, but requires knowledge of advanced operations.
- **Computer** (general tool like bash/code execution) — fastest and most powerful, but requires the
  agent to know how to compose its own solutions.

When designing tools, ask: *given this agent's demonstrated capabilities, which level of abstraction
lets it succeed most reliably?*

## Lesson 1: Elicitation — Design for Structured Agent-User Communication

**Problem:** Agents can ask questions in plain text, but answering feels slow and friction-heavy.
The goal is to lower friction and increase communication bandwidth between user and agent.

### What Doesn't Work

- **Overloading existing tools.** Adding question parameters to an unrelated tool (e.g. a plan tool)
  confuses the agent — it conflates two goals. If the user's answers conflict with the plan, the
  agent doesn't know which to trust.
- **Custom output formats.** Asking the agent to emit structured markdown (e.g. bullet questions with
  bracketed alternatives) is fragile. The agent appends extra sentences, omits options, or drifts
  from the format. Output-format hacks look general but are not reliable.

### What Works

- **A dedicated elicitation tool** the agent can call at any point, with structured parameters for
  questions and options. The harness renders these as UI and blocks the agent loop until the user
  responds.
- **Structured output via tool calling** is far more reliable than asking the agent to emit a custom
  text format. Tool schemas constrain the output naturally.
- **Composability matters.** A well-designed elicitation tool can be invoked from SDKs, referenced
  in skills, and used in different modes (plan mode, interview mode, etc.).

### The Key Test

> Even the best designed tool doesn't work if the agent doesn't understand how to call it.

Always check: does the agent *want* to call this tool? Are its outputs well-formed? If the agent
avoids calling it or produces malformed calls, the tool design is wrong regardless of how elegant
the schema is.

## Lesson 2: Evolve Tools with Model Capabilities

Tools that helped weaker models can *constrain* stronger ones. Revisit your assumptions as models improve.

### Pattern: Todos → Tasks

| Era | Tool | Purpose | Problem It Solved |
|-----|------|---------|-------------------|
| Early | TodoWrite + system reminders every 5 turns | Keep the agent on track | Agent forgot its goals |
| Later | Reminders became counterproductive | — | Agent treated the list as immutable instead of adapting |
| Current | Task Tool with dependencies, cross-subagent updates, alter/delete | Coordinate work across agents | Subagents needed shared state, not just a checklist |

### Rules of Thumb

- If you're inserting system reminders to compensate for agent forgetfulness, revisit whether newer
  models still need them — the reminders may now be constraining the agent.
- If a tool assumes the agent can't do X (e.g. can't track its own state), test whether that
  assumption still holds. Remove scaffolding that has become a cage.
- Stick to a small set of supported models with a similar capability profile — this makes it
  practical to keep tools matched to abilities.

## Lesson 3: Let the Agent Build Its Own Context

As agents get smarter, they become increasingly good at building their own context — if given the
right search tools.

### Evolution of Context-Building

1. **RAG / vector database** — Powerful and fast, but required indexing/setup, was fragile across
   environments, and the agent was *given* context rather than *finding* it.
2. **Grep / search tools** — Let the agent search the codebase itself. The agent decides what to
   look for and builds context on its own terms.
3. **Progressive disclosure via Skills** — Agents read skill files that reference other files,
   which reference more files. The agent does nested search across layers to find exactly the
   context it needs.

### Progressive Disclosure Pattern

Progressive disclosure lets you add new functionality to an agent **without adding a new tool.**

**How it works:**
- Agent reads a top-level file (e.g. a SKILL.md)
- That file references deeper files the agent can read when relevant
- Those files can reference even deeper resources
- The agent traverses only the branches it needs

**When to use it:**
- You want to add capability but the tool count is already high
- The information is rarely needed (so it shouldn't bloat the system prompt)
- The context is structured enough to be navigated via file references

**Example — Claude Code Guide Agent:**
Instead of adding a tool for "answer questions about Claude Code", the team gave the agent a link
to its docs. But the agent loaded too many results. So they built a **subagent** specialized in
searching docs well and returning concise answers. Result: new capability, no new tool in the
main agent's tool set.

## Lesson 4: The Bar for Adding a New Tool Is High

Claude Code has ~20 tools. Every new tool is one more option the agent has to consider on every turn.

### Before Adding a Tool, Try These First

1. **Progressive disclosure** — Can you give the agent a file/doc/skill that teaches it the new
   capability without a dedicated tool?
2. **Subagent** — Can a specialized subagent handle this, invoked through an existing tool?
3. **Existing tool composition** — Can the agent achieve the goal by combining tools it already has?

### When a New Tool IS Warranted

- The agent needs structured input/output that can't be reliably achieved via text
- The capability requires blocking the agent loop (e.g. waiting for user input)
- The action has side effects that need explicit harness control (e.g. file writes, API calls)
- No combination of existing tools can achieve the goal reliably

## Lesson 5: Prompt Caching Shapes Tool Design

If your agent uses prompt caching, tool design decisions have cost and latency implications.
See references/prompt-caching-for-tools.md for details on how caching constraints affect tool
architecture (plan mode as a tool instead of a tool-swap, deferred tool loading via stubs, etc.).

## Decision Checklist: Designing or Reviewing an Agent Tool

When designing a new tool or reviewing an existing tool set, walk through these questions:

1. **Ability match** — Is this tool shaped to the agent's demonstrated abilities, or does it assume
   capabilities the agent doesn't reliably have?
2. **Does the agent want to call it?** — In practice, does the agent call this tool correctly and
   at the right times? If not, the design needs to change.
3. **Capability check** — Is this tool compensating for a weakness the current model no longer has?
   Could it be removed or simplified?
4. **Context building** — Could this be replaced with progressive disclosure (files/skills the agent
   reads on demand)?
5. **Tool count** — Is the total tool count still manageable? Every tool adds cognitive load for the
   agent.
6. **Elicitation quality** — If this tool involves user input, does it use structured parameters
   rather than relying on the agent to emit a custom text format?
7. **Caching impact** — Does adding/removing/modifying this tool break prompt caching for the
   entire conversation?

## Summary

Designing agent tools is an art, not a science. It depends on the model, the goal, and the
environment. The through-line: **experiment often, read outputs, try new things. See like an agent.**
