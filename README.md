# Teachneat

Teachneat was a web app for secondary school teachers. It kept one class list in a Google Sheet on the
teacher's own Drive and used it for attendance, random groups, a name picker and personalized emails to
students and parents. I researched, built and ran it on my own between January and October 2026. It went live
in August, passed Google's OAuth verification in September, and I shut it down in October after testing it
with colleagues at my school.

The case study is at **https://joewatersdev.github.io/teachneat/**, and its source is in
[`portfolio/index.html`](portfolio/index.html). It covers the research, the
requirements, the main decisions, the user testing and why I shut it down. The screenshots in
[`portfolio/screenshots`](portfolio/screenshots) are from a demo account with made-up students, taken before
the site came down.

![Students roster](portfolio/screenshots/app-students-roster.png)

## Summary

| | |
|---|---|
| Role | Sole developer: research, design, development and operations |
| Research | Survey of 39 teachers and 4 interviews, January 2026 |
| Stack | React 19, TypeScript, Vite, Tailwind; Express 5, Postgres; Google Sheets, Drive and Gmail APIs; Stripe |
| Size | 281 commits, about 36,000 lines of TypeScript, 1,139 automated tests |
| Outcome | Shut down after user testing, October 2026 |

## What is in this repository

- `client/` and `server/`: the app. The server holds the Google tokens and calls Google's APIs for the
  teacher, and student data is only stored in the teacher's spreadsheet.
- Planning documents in the root folder: `IMPLEMENTATION_PLAN.md` (phases, design principles and the backlog
  of future ideas), `DESIGN_SYSTEM.md`, `TESTING_PLAN.md`, `SHEETS_SCHEMA.md`, `API_CONTRACT.md` and
  `DEPENDENCIES.md`. `HISTORY.md` is the full work log, including the reasons behind each major decision.
- `ops/`: the incident response plan, the backup and restore procedure with its test record, and the
  explanation of OAuth scopes submitted to Google.
- `portfolio/`: the case study, screenshots, the data behind its charts, and resume and interview notes.

## Data and privacy

This repository contains no student data. The usage numbers in the case study are totals from the production
database, which never stored student data. Feedback form answers are included without names. The repository
was published as a new copy, without the history of the private repository it came from.

## License

Copyright 2026 Joe Waters. The code and documents are available under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). You can read, run and adapt them for personal,
educational and other noncommercial purposes. Commercial use is not permitted without my written permission.

## Running it

The app needs a Google Cloud OAuth client, a Postgres database and a Google Cloud KMS key. The settings are
listed in `server/.env.example`. To run the client, use `cd client && npm install && npm run dev`, and for the
server, `cd server && npm install && npm run dev`. Run `npm test` in either folder for the tests.
