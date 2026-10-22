# ccmaf-blank-workspace

A sample CCMAF workspace-type kit: a general-purpose "Blank workspace" for notes and tasks.

- `.claude-plugin/plugin.json` : plain Claude Code plugin manifest (nothing custom).
- `ccmaf-type/type.json` : the workspace-type manifest (tier T1, Claude only, asks before deletions).
- `ccmaf-type/scaffold/` : files copied into a new workspace (persona `CLAUDE.md`, `README.md`, `notes/`, `inbox/`).

It requires the `ccmaf-skills-core` and `ccmaf-skills-workspace` skill packs. To build your own, follow the `workspace-kit-authoring` skill (in the `ccmaf-skills-workspace` pack).

## Install

At a Claude Code prompt:

    /plugin install ccmaf-blank-workspace --marketplace drushegh/CCMAF-Mods
