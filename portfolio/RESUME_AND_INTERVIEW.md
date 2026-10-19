# Teachneat: Resume Material and Interview Notes

## Resume entry

**Founder, Teachneat** (classroom administration web app for secondary teachers) · Jan 2026 to Oct 2026

- Ran discovery research with 39 survey respondents and 4 interviews, quantified the leading pain points (70% of teachers had missed a required accommodation; about 74% spent 5+ minutes a week on parent-communication logistics), and wrote a PRD that tied every module to a research baseline and a measurable target.
- Built and launched a full-stack product (React, TypeScript, Express, Postgres, Google Sheets and Gmail APIs) with 1,139 automated tests, passing Google's OAuth app verification by limiting requests to non-restricted data scopes.
- Designed a privacy-first architecture in which student data stayed in each teacher's own Google Sheet and no durable copy was kept on company servers, the core of the pitch to school-board IT departments.
- Designed freemium pricing and the entitlement model, then switched billing off behind a single flag when a legal review narrowed the launch to a free Ontario year.
- Instrumented activation milestones and monthly per-tool usage in a form simple enough to explain in a board privacy review, and used it to run a structured user test with an exit poll.
- Recommended and executed a sunset after behavioral data showed no repeat use despite positive stated intent, stopping before insurance, legal and tax commitments were made.

### Shorter variant (three lines)

- Founded and built Teachneat, a teacher productivity web app, from a 39-respondent research study and PRD to a live, Google-verified product.
- Defined activation and retention instrumentation and ran a structured user test combining behavioral data with an exit poll.
- Sunset the product on evidence that testers did not return, before committing to insurance, legal and tax costs.

## Profile summary (LinkedIn or portfolio)

Teachneat was a web app I researched, designed, built and operated for secondary school teachers, combining attendance, grouping, a name picker and personalized parent email around one class list stored in the teacher's own Google Drive. It reached production with Google's OAuth verification approved. A structured test with teaching colleagues showed that stated interest did not translate into repeat use, and with the most severe researched problem ruled out by a legal review, I retired the product before taking on its fixed costs. The case study covers the research, the product decisions, the test design and the reasoning behind the decision to stop.

## Interview stories

Each story follows situation, action, result, with the numbers that hold it up.

### Choosing what to build

- **Situation:** Teachers described many frustrations, and I could not build all of them.
- **Action:** Surveyed 39 teachers and interviewed 4, then ranked problems by measured frequency and by satisfaction with existing tools. Grouping scored 3.75 out of 5 with existing tools, so I treated it as a convenience feature; the accommodation system scored 2.4 out of 5 and 70% of respondents reported a missed accommodation, so it led the scope.
- **Result:** A PRD with a baseline and target for each module, for example mass parent email from 15 to 30+ minutes down to under 5.

### A decision that removed the strongest feature

- **Situation:** A legal review found that authority over special education records sits with the school board, not the teacher.
- **Action:** Removed accommodation tracking permanently rather than hiding it behind a flag, narrowed the launch to Ontario and made it free for the first year so no one paid for a reduced product.
- **Result:** Lower legal risk, and a clear view that the remaining product competed with free tools teachers already rated as adequate.
- **What I would change:** That question was listed as open question two in February. I would now test it first, before writing code.

### Stated intent against behavior

- **Situation:** Two colleagues created accounts and answered an anonymous exit poll.
- **Action:** Compared what they said with what the accounts recorded.
- **Result:** Both rated their likelihood of signing up at 4 out of 5 and expected frequent use of attendance and grouping, yet neither account saved attendance or generated a group, and each recorded one session. I treated the behavioral data as the stronger signal.
- **On sample size:** The sample cannot estimate a rate, and I do not claim it does. The test was designed to check whether unprompted repeat use appeared at all among motivated, well-informed users. It did not.

### Deciding to stop

- **Situation:** The next steps were insurance, a lawyer's review, a business mailing address and, eventually, tax registration and a months-long approval process with each school board.
- **Action:** Weighed four lines of evidence: the lost top feature, no repeat use, no use through school-managed accounts, and fixed costs (hosting alone was about $31 USD a month, roughly seven subscribers at the planned price) that arrive well before revenue.
- **Result:** Stopped before any of those commitments were signed, kept the specifications for a possible future version, and documented the outcome.

## Questions to expect

- **Why not keep going with a free product?** Free still carries hosting, insurance and privacy obligations to every teacher whose class list passes through the server, and without repeat use there was no path to the paid tier that would cover them.
- **What would make you revisit it?** Evidence that a board would allowlist the app for its teachers, and roster import (Google Classroom or CSV) to remove setup cost. Both are specified in the project's backlog.
- **What metric would you have used to decide to continue?** Repeat weekly use by testers without prompting over the trial period. Two single-session accounts did not reach the point where a threshold mattered.
