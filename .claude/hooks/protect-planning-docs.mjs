#!/usr/bin/env node
// PreToolUse hook: prompts for confirmation on Edit/Write/MultiEdit to protected
// planning documents. Set ALLOW_PLANNING_EDITS=1 in the environment to skip the prompt.

const PROTECTED = new Set([
  "CLAUDE.md",
  "IMPLEMENTATION_PLAN.md",
  "DESIGN_SYSTEM.md",
  "TESTING_PLAN.md",
  "SHEETS_SCHEMA.md",
  "API_CONTRACT.md",
  "DEPENDENCIES.md",
  "TODO.md",
]);

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(buf || "{}");
  } catch {
    process.exit(0);
  }
  const filePath = payload?.tool_input?.file_path ?? "";
  const basename = filePath.split(/[\/\\]/).pop();
  if (!PROTECTED.has(basename)) process.exit(0);
  if (process.env.ALLOW_PLANNING_EDITS === "1") process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `${basename} is a planning document. Confirm before editing.`,
      },
    }),
  );
});
