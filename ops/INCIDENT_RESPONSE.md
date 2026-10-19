# Teachneat Incident Response Plan

| Field | Value |
|---|---|
| Version | 1.0 (draft) |
| Effective date | 2026-09-10 |
| Owner | Joe Waters, operator of Teachneat |
| Status | Pending legal review |
| Next scheduled review | 2027-09-10 |

## 1. Purpose and scope

This plan describes how Teachneat identifies, contains, assesses, reports and recovers from security
incidents involving personal information. It covers the Teachneat web application at teachneat.com, its
hosting and database, and the administrative accounts listed in the Teachneat Administrative Account
Register.

## 2. Roles and contacts

Teachneat is operated by a sole proprietor. The operator, Joe Waters, carries out every activity in this
plan, including detection, containment, assessment, notification and recovery. No other staff are
involved.

| Party | Role in an incident | Contact |
|---|---|---|
| Joe Waters, operator | All internal roles | To be completed |
| Insurer | Notified first once coverage is in place; may provide forensic and legal support | To be completed when coverage is bound |
| Legal counsel | Reviews external notices before they are sent | To be completed |
| Office of the Privacy Commissioner of Canada | Receives breach reports where PIPEDA requires them | Online breach report form at priv.gc.ca |

## 3. Definitions

**Incident.** Any event that has caused, or may have caused, unauthorized access to, disclosure of, or loss
of personal information handled by Teachneat, or unauthorized access to a system or account through which
that could occur.

**Breach of security safeguards.** As defined in PIPEDA: the loss of, unauthorized access to, or
unauthorized disclosure of personal information resulting from a breach of an organization's security
safeguards or from a failure to establish them.

## 4. Information handled

### 4.1 Account information

Teachneat is the organization responsible for this information under PIPEDA. It is held in a managed
PostgreSQL database hosted by DigitalOcean in Toronto, Canada, and consists of:

- teacher name, email address and profile image URL;
- Google account identifier;
- Google OAuth refresh token, encrypted;
- session records;
- support requests;
- records of service emails sent to the teacher;
- usage counters.

Refresh tokens are encrypted with AES-256-GCM under a data key that is itself encrypted by Google Cloud Key
Management Service.

### 4.2 Student information

Student information is stored in Google Sheets in each teacher's own Google Drive. The teacher, and the
school board that employs the teacher, are responsible for it. Teachneat does not keep a durable copy:
student information is not written to Teachneat's database, logs or backups, and is held in server memory
only while it is being used.

A teacher's refresh token, used together with Teachneat's OAuth client credentials, gives access to the
spreadsheets that teacher has authorized and can send email from the teacher's Gmail address. An incident
that exposes refresh tokens is therefore handled as an incident affecting student information.

## 5. Indicators of an incident

Each of the following is logged as a potential incident and assessed under section 6:

- an operator alert reporting failures to decrypt stored tokens, or an unexplained increase in server
  errors;
- a sign-in, password reset or change of second factor on an administrative account that the operator did
  not perform;
- a credential found in source control, logs, screenshots, support correspondence or any other location
  where it should not be;
- a report from a teacher of email sent from their address that they did not send through Teachneat;
- a breach notice from a service provider (Google, DigitalOcean, Cloudflare, Resend or Stripe);
- theft of, or malware on, the operator's workstation;
- any report that account or student information was accessed by someone not entitled to it.

## 6. Response procedure

The steps are carried out in order. Evidence is preserved at step 2 before any repair is made.

1. **Record.** Open an entry in the incident log (Appendix A) with the date and time of detection and a
   description of what was observed. Add to the entry at each later step.
2. **Preserve evidence.** Export application logs for the relevant period before any redeployment, since
   the hosting platform keeps runtime logs for a limited time. Create a restored copy of the database before
   changing any data in it. Take screenshots of any administrative console showing relevant activity. Do
   not delete files, accounts or records connected with the incident.
3. **Contain.** Follow the applicable procedure in section 8. Containment that requires users to sign in
   again is acceptable. Containment that would destroy data is not used.
4. **Assess.** Determine what information was involved, whose it is, and whether the breach creates a real
   risk of significant harm under section 7.1. Record the reasoning and the conclusion.
5. **Notify.** Notify the parties listed in section 7.4, in that order.
6. **Recover.** Restore data where necessary using the Teachneat Database Backup and Restore Procedure,
   redeploy from a known-good version of the application, and replace any credential that was or may have
   been exposed.
7. **Review.** Within 14 days of closing the incident, record its cause, how it was detected, and the
   changes made as a result.

## 7. Assessment and notification

### 7.1 Real risk of significant harm

Under PIPEDA, significant harm includes bodily harm, humiliation, damage to reputation or relationships,
loss of employment, business or professional opportunities, financial loss, identity theft, negative
effects on a credit record, and damage to or loss of property. Whether the risk is real depends on the
sensitivity of the information and the probability that it has been, is being or will be misused.
Information about students, who are generally minors, is treated as sensitive.

### 7.2 Account information

Where a breach of security safeguards involving account information creates a real risk of significant
harm, Teachneat:

- reports the breach to the Office of the Privacy Commissioner of Canada as soon as feasible after
  determining that it occurred;
- notifies affected individuals directly and as soon as feasible;
- notifies any other organization or government institution that may be able to reduce or mitigate the
  risk of harm.

### 7.3 Student information

Where an incident affects or may affect student information, Teachneat notifies the affected teachers and
their school boards promptly and provides the information they need to meet their own obligations.
Ontario school boards are subject to the Municipal Freedom of Information and Protection of Privacy Act and
determine their own obligations to students, parents and the Information and Privacy Commissioner of
Ontario.

### 7.4 Notification order

1. The insurer, once coverage is in place, in accordance with the notice conditions of the policy.
2. Legal counsel, before any external notice is sent.
3. Affected teachers.
4. The school boards of affected teachers. Where the board is not known, the teacher is asked to identify
   it, and Teachneat and the teacher agree which of them informs it.
5. The Office of the Privacy Commissioner of Canada, where section 7.2 requires a report.
6. Google, where the incident involves Google user data or OAuth credentials.

### 7.5 Content of a notice to an individual

A notice to an affected individual is sent by email from the Teachneat support address and includes:

- a description of the circumstances of the breach;
- the date or period during which it occurred, or an approximate period if the exact dates are not known;
- a description of the personal information involved;
- the steps Teachneat has taken to reduce the risk of harm;
- the steps the individual can take to reduce the risk of harm, including, for an incident involving
  refresh tokens, reviewing the Sent folder in Gmail and removing Teachneat's access from the third-party
  connections page of their Google Account;
- contact information for questions about the breach;
- information about the right to complain to the Office of the Privacy Commissioner of Canada.

## 8. Incident-specific procedures

### 8.1 Exposure of refresh tokens

1. Rotate the OAuth client secret in the Google Cloud console and deploy the new secret to production.
   Stored refresh tokens cannot be exchanged for access without the current client secret. Where the
   console allows a new secret to be added before the old one is disabled, add the new secret, deploy it,
   and then disable the old one, so that the application remains available.
2. After the database copy required by section 6 step 2 has been made, revoke every stored refresh token
   through Google's OAuth revocation endpoint and clear the tokens from the database. Each teacher is asked
   to grant access again at their next sign-in.
3. Where the database and the key management credential may both have been exposed, disable the key
   management service account key and issue a new one.
4. Handle the incident as affecting student information for the purposes of section 7.

This procedure has not yet been rehearsed. A rehearsal is scheduled before public launch.

### 8.2 Exposure of a credential

| Credential | Containment | Effect on the service |
|---|---|---|
| Google OAuth client secret | Rotate in the Google Cloud console and deploy | None if the new secret is deployed before the old one is disabled |
| Key management service account key | Disable the key, issue a new one and deploy | The application cannot start until the new key is deployed |
| Session signing secret | Replace and deploy | All users are signed out |
| Database password | Reset the database user in DigitalOcean, update the application configuration and deploy | Brief interruption |
| Email service API key (Resend) | Revoke, issue a new key and update the configuration | Service emails and operator alerts stop until the key is replaced |
| Payment processor API keys (Stripe) | Roll the keys in Stripe | None; billing is not active |
| DigitalOcean API token | Revoke in the DigitalOcean console and issue a replacement | Automated deployment stops until the replacement is stored |
| GitHub token | Revoke in GitHub settings | None beyond reauthenticating the affected tool |

Configuration changes are made to the running application specification through the DigitalOcean console
or API.

### 8.3 Compromise of an administrative account

Recover the account through the provider, end all of its sessions, revoke its API tokens, enrol a new
second factor and regenerate its recovery codes. Then review what the account could reach:

- GitHub: commits to the production branch, which are deployed automatically;
- DigitalOcean: application configuration, database users, database firewall rules and backups;
- Cloudflare: DNS records, including mail records;
- Google: the OAuth client, permissions on the key management key, and the audit logs for both.

### 8.4 Theft of, or malware on, the operator's workstation

Treat every credential stored on the workstation as exposed and replace it, including the key management
service account key, the DigitalOcean and GitHub tokens, and the application secrets held in local
configuration. From another device, end the sessions of every administrative account and regenerate the
recovery codes for each.

### 8.5 Report of email the teacher did not send

Compare the teacher's report with the email log in the teacher's spreadsheet. If the messages were sent
through Teachneat, end the teacher's sessions, ask the teacher to remove Teachneat's access from their
Google Account while the cause is investigated, and investigate the incident as an application fault or a
compromised session. If they were not sent through Teachneat, follow section 8.1.

### 8.6 Breach notice from a service provider

Record the notice, determine whether Teachneat data or credentials held by that provider were affected,
replace any affected credential under section 8.2, and continue from section 6 step 4.

## 9. Records

Every incident is recorded in Appendix A, whether or not it is reported. Records are kept for at least 24
months after the date on which Teachneat determined that the breach occurred, and contain enough
information for the Office of the Privacy Commissioner of Canada to verify compliance with the reporting
and notification requirements.

## 10. Review of this plan

This plan is reviewed at least once a year, after every incident, and whenever the systems or service
providers it describes change.

## Appendix A. Incident log

| Reference | Detected | Description | Information involved | Real risk of significant harm, with reasons | Notifications made (party and date) | Closed |
|---|---|---|---|---|---|---|
| | | | | | | |
