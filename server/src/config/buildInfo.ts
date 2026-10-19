/**
 * What this process is, for answering "did my deploy actually land?" without
 * the DigitalOcean console.
 *
 * This exists because of a real incident: a deploy failed, nobody noticed, and
 * the symptom surfaced days later as "the fix isn't in production". Confirming
 * it took reconstructing the answer from CI history and the DigitalOcean API,
 * when one `curl` should have done it. `/api/health` answered `{"status":"ok"}`
 * and could not tell you *which* run of the app was saying ok.
 *
 * ## Why there is no commit hash here
 *
 * There was one, resolved from `BUILD_COMMIT` and then from `git rev-parse`,
 * and **in production it reported `unknown`** — App Platform's buildpack leaves
 * no `.git` in the workspace and injects no commit variable, so the only branch
 * that could ever fire was the fallback. A field that is honest locally and
 * empty in production is worse than no field: it occupies the place where the
 * answer should be.
 *
 * The two things it would have bought are already covered.
 *
 *   - **Which commit is deployed** is on the deployment record, exactly and
 *     without a build step: `doctl apps get-deployment <app> <deployment>`
 *     carries `source_commit_hash`.
 *   - **Whether the deploy landed at all** is what `startedAt` answers, and it
 *     answers it well enough on its own: a process that started before you
 *     pushed is not running your code, whatever a commit field might claim.
 *
 * If the commit is ever wanted here, the way to get it is to have CI put it in
 * the environment as `BUILD_COMMIT` before creating the deployment, not to read
 * it at runtime. That is a change to the app spec on every deploy, which is why
 * it is not being done for a field the API already serves.
 *
 * ## Why this is safe to serve publicly
 *
 * A process start time identifies a deployment in time; it is not a credential
 * and describes nothing about the environment. The alternative — putting it
 * behind the operator allowlist — would defeat the point, which is a check that
 * works from anywhere with no setup at the moment something looks wrong.
 */

/**
 * Resolved once at module load rather than per request: the value cannot change
 * while the process lives, and an uptime monitor hits this endpoint every
 * minute.
 */
export const BUILD_INFO = {
  startedAt: new Date().toISOString(),
} as const;
