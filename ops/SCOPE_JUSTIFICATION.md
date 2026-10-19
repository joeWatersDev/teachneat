# Teachneat Google OAuth Scope Justification

| Field | Value |
|---|---|
| Version | 1.0 (draft) |
| Effective date | 2026-09-12 |
| Owner | Joe Waters, operator of Teachneat |
| Status | Pending legal review |
| Application | Teachneat web application at https://teachneat.com |
| OAuth client ID | 7262198699-4r40af2fc95c5uu2fmgfgk2e9vd5em33.apps.googleusercontent.com |
| Next scheduled review | 2027-09-12, or before any change to the requested scopes |

## 1. Purpose

This document states each Google OAuth scope Teachneat requests, what the application does with it, and
why no narrower scope would serve. It is written for Google's OAuth verification review and for a school
board's privacy or IT review of the application before it is allowlisted in a Google Workspace for
Education domain.

Teachneat is a classroom management tool for teachers: a class roster, attendance, a random name picker,
student grouping, and email to students and their parents or guardians. Every record the teacher creates
is stored in a single Google Sheet in the teacher's own Google Drive. Teachneat's database holds account
information only, and no durable copy of student information is kept on Teachneat's servers, in its
database, in its logs or in its backups.

## 2. Scopes requested

The application requests exactly the following five scopes, and no others. The same list is published at
https://teachneat.com/for-admins, where it is read directly from the application's configuration, and
in the privacy policy at https://teachneat.com/privacy.

| Scope | Google classification | Used for |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Sensitive | Sending email the teacher composes, from the teacher's own address |
| `https://www.googleapis.com/auth/drive.file` | Non-sensitive | Creating, finding, reading and writing the one spreadsheet the application creates |
| `openid` | Non-sensitive | Identifying the account at sign-in |
| `email` | Non-sensitive | The teacher's email address, used as the account's contact address and as the sender address |
| `profile` | Non-sensitive | The teacher's name and profile picture, shown in the application |

None of these is a restricted scope.

## 3. `gmail.send`

### How the scope is used

The Email tool lets a teacher write a message, choose which students it concerns, and send it to those
students, to their parents or guardians, or to both. Each message is sent through the Gmail API
(`users.messages.send`) from the teacher's own Gmail or Google Workspace address, so replies from parents
return to the teacher's inbox rather than to Teachneat.

- **Every message is sent because the teacher pressed Send.** The application has no automated,
  scheduled or background sending that uses this scope.
- **Recipients are resolved on the server** from the email addresses recorded on each student's row in
  the teacher's spreadsheet. The browser sends only which students were selected and whether to include
  the student, the guardians, or both. The teacher may add one copy address, such as a principal.
- **Messages may be personalised** with placeholders such as a student's name or course name, which the
  server substitutes into the teacher's text at the moment of sending. Substituted values are HTML-escaped.
- **Sending is capped** at 120 messages per teacher per day and 200 recipients per request, both enforced
  on the server.
- **Message content is not stored or logged.** A record of each send (recipient address, time and
  status, without the message body) is written to the teacher's own spreadsheet and not to Teachneat's
  database.

### Why a narrower scope is not sufficient

`gmail.send` is the narrowest Gmail scope that permits sending. It grants no ability to read, search,
modify, label or delete anything in the mailbox. The broader alternatives (`gmail.compose`,
`gmail.modify`, `gmail.readonly` and full mail access) are not requested.

Sending through Teachneat's own mail provider instead of the teacher's Gmail was considered and rejected
for two reasons. Messages to parents about their child need to come from the teacher's own address,
because that is the address parents recognise and reply to. Relaying the messages through a third-party
mail service would also give that service a copy of student names and teacher-written content about
students, which the application is designed to avoid. Teachneat's own mail provider sends only messages
about the teacher's account, such as a welcome message, and those messages contain no student
information.

## 4. `drive.file`

### How the scope is used

On a teacher's first sign-in, the application creates a folder named "TEACHNEAT DATA" in the teacher's
Drive and a spreadsheet inside it. The spreadsheet holds the roster, course enrolments, attendance,
groupings, email templates and the send record described in section 3. On later sign-ins the
application finds that spreadsheet again by a private application property it set on the file, and reads
and writes it through the Google Sheets API. Before an update to the spreadsheet's structure that
rewrites existing data, the application saves a copy of the spreadsheet in the teacher's Drive.

### Why a narrower scope is not sufficient

`drive.file` is already the narrowest Drive scope. It limits the application to files the application
itself created, or that the user opened with it, and gives no visibility into anything else in the
teacher's Drive.

The broader Google Sheets scope (`spreadsheets`), which would allow access to every spreadsheet the
teacher owns, is not requested. The application needs access to one spreadsheet that it created itself,
and `drive.file` covers the Google Sheets API for that file. This was confirmed by testing the application
with only `drive.file` granted: an existing teacher's spreadsheet was found, read and updated, and a new
teacher's folder and spreadsheet were created.

## 5. `openid`, `email` and `profile`

These are Google's standard sign-in scopes and are the only way the application identifies a teacher.
From them the application stores the Google account identifier, the teacher's email address and name, a
link to the profile picture, and, for a managed Google Workspace account, the Workspace domain. The
domain is recorded so that requests from several teachers at the same school board can be handled as one
conversation with that board's administrator. These scopes give no access to Drive, Gmail or any other
Google service.

## 6. Access not requested

Teachneat does not request, and the application has no use for, access to the rest of the teacher's
Google Drive, the contents of the teacher's mailbox, the teacher's contacts, calendar, Google Classroom
data, or any administrative or directory information in a Google Workspace domain.

## 7. Handling of data obtained through these scopes

- **Tokens.** The refresh token is encrypted before it is stored in Teachneat's database, with a key held
  in Google Cloud Key Management Service in Canada and not stored with the database. Access tokens are
  held on the server only and are never sent to the teacher's browser.
- **Student information.** Student information read from the spreadsheet is held in the server's memory
  while the teacher is working, so the application does not re-read the spreadsheet on every action, and
  is discarded within minutes. It is not written to disk, to the database or to the logs.
- **Limited Use.** Teachneat's use and transfer of information received from Google APIs adheres to the
  Google API Services User Data Policy, including its Limited Use requirements. Data obtained through
  Google APIs is used only to provide the application's features to the teacher, is not transferred or
  sold for advertising or any other purpose, is not read by any person except with the teacher's explicit
  permission for a specific purpose, for security purposes or where required by law, and is not used to
  develop, improve or train generalised artificial intelligence or machine learning models.
- **Hosting.** Teachneat's servers and database are hosted by DigitalOcean in Toronto, Canada.

## 8. Revocation

A teacher can withdraw these permissions at any time from the Third-party apps and services page of their
Google Account, and a Google Workspace administrator can block or remove the application for the domain
from the Admin console. Either stops the application's access immediately. When a teacher deletes their
Teachneat account, the application revokes the refresh token with Google and then deletes it. The
teacher's spreadsheet remains in their own Drive in every case.

## 9. Summary statements

Short statements of the justification for each sensitive scope, for use where a form limits length.

**`gmail.send`.** Teachneat's Email tool lets a teacher write a message and send it to selected students
and their parents or guardians from the teacher's own address, so replies return to the teacher. Each
message is sent only when the teacher presses Send; there is no automated sending. Recipients are the
addresses recorded in the teacher's own roster spreadsheet, sending is capped at 120 messages per day,
and message content is not stored or logged. `gmail.send` is the narrowest scope that permits sending
and grants no access to read or modify the mailbox. Sending through our own mail provider instead would
not come from the teacher's address and would give a third party a copy of student information.

**`drive.file`.** Teachneat stores each teacher's roster, attendance and groupings in one spreadsheet that
the application creates in the teacher's own Drive. `drive.file` lets the application create that
spreadsheet, find it again and read and write it, and gives no access to any other file. The broader
`spreadsheets` scope is not requested.
