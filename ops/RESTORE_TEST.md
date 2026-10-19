# Teachneat Database Backup and Restore Procedure

| Field | Value |
|---|---|
| Version | 1.0 |
| Effective date | 2026-09-11 |
| Owner | Joe Waters, operator of Teachneat |
| Last tested | 2026-09-11 |
| Next test due | 2027-09-11 |

## 1. Purpose

This document describes how Teachneat's database is backed up, how it is restored, and how a restore is
tested. The same procedure is used for a test and for a real recovery, except where section 3 states
otherwise.

## 2. System

| Item | Detail |
|---|---|
| Database | DigitalOcean Managed PostgreSQL 17, single node |
| Region | Toronto, Canada (`tor1`) |
| Backups | Taken automatically by DigitalOcean once a day, at about 09:50 UTC. Eight daily backups were available on 2026-09-11 |
| Contents | Account information only. Student information is stored in teachers' own Google Drive and is not included in any Teachneat backup |
| Encryption | Refresh tokens in the database, and therefore in every backup, are encrypted. Decrypting them requires access to Google Cloud Key Management Service, so every restore is verified by decrypting the stored tokens |

A restore always creates a new database cluster. It does not overwrite the existing one. Restored clusters
are created in the Toronto region so that the data remains in Canada; `doctl` uses New York (`nyc1`) when
no region is given, so the region is always specified.

## 3. Restore procedure

1. Identify the backup to restore from:
   `doctl databases backups <cluster-id>`
2. Record the start time, then create a new cluster from that backup:
   `doctl databases create <new-cluster-name> --engine pg --version 17 --region tor1 --size db-s-1vcpu-1gb --num-nodes 1 --restore-from-cluster-name teachneat-db --restore-from-timestamp "<backup timestamp>" --wait`
   The command prints the new cluster's connection string, including its password. The output is not
   copied or stored.
3. Confirm that the new cluster is online:
   `doctl databases get <new-cluster-id> --format Status`
4. Load the new cluster's connection string and CA certificate into environment variables for the current
   shell session only. They are not written to any file.
5. Run the verification script from the `server` directory of the application repository:
   `npx tsx scripts/check-restore.ts`
   The script reports the number of rows in every table and attempts to decrypt each stored refresh token.
   It reports counts only and does not display any token. It exits with an error if any token fails to
   decrypt.
6. Record the time at which verification succeeds. The elapsed time from step 2 to this point is the
   restore time.
7. For a test, delete the restored cluster in the DigitalOcean console and record the deletion. For a real
   recovery, update the database connection settings in the application configuration on DigitalOcean App
   Platform to point to the restored cluster, and deploy.

## 4. Testing

The restore procedure is tested at least once a year and after any change to the database hosting or to key
management. Each test is recorded in section 5.

## 5. Test record

| Date | Backup restored | Started | Cluster online | Verification passed | Elapsed | Result | Restored cluster deleted |
|---|---|---|---|---|---|---|---|
| 2026-09-11 | Daily backup of 2026-09-10, 09:50:13 UTC | 00:12:12 UTC | 00:18:18 UTC | About 00:22 UTC | About 10 minutes | Passed | Yes, 2026-09-11 |

Notes on the 2026-09-11 test:

- Tables and row counts in the restored database: `_migrations` 17, `users` 1, `lifecycle_emails` 1,
  `usage_counters` 1, `sessions` 0, `support_requests` 0.
- The one stored refresh token was decrypted successfully under the current key.
- Decryption used the key management service account credential held on the operator workstation.
- Row counts were not compared against the production database at the time of the test.
- The elapsed time includes one repeated step.
- Switching production to the restored cluster was not performed. A real recovery adds the time of one
  application deployment to the elapsed time above.
