import type { sheets_v4, drive_v3, gmail_v1 } from 'googleapis';

/** Stand-in for the Drive root, which the real API also addresses as 'root'. */
export const FAKE_ROOT_ID = 'root_folder_id';

interface FakeFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
  mimeType: string;
  /** Drive allows one parent; new files land in the root. */
  parents: string[];
  /**
   * Whether the signed-in account owns the file. Defaults to true, because
   * everything the app creates is owned by the teacher; set false to model a
   * file somebody else shared in, which discovery must refuse to adopt.
   */
  ownedByMe?: boolean;
}

interface FakeSheet {
  title: string;
  rows: string[][];
}

interface FakeSpreadsheet {
  id: string;
  title: string;
  sheets: FakeSheet[];
}

export interface SentEmail {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

export class FakeGoogleEnv {
  files: Map<string, FakeFile> = new Map();
  spreadsheets: Map<string, FakeSpreadsheet> = new Map();
  nextId = 1;
  callCounts: Record<string, number> = {};
  /** Every message the Gmail mock accepted, decoded from the raw payload. */
  sentEmails: SentEmail[] = [];
  /** Addresses the Gmail mock should reject (simulates a send failure). */
  gmailFailFor: Set<string> = new Set();
  /**
   * When set, the next `values.batchGet` throws and the flag clears itself.
   * For asserting that a failed read leaves no poisoned in-flight state behind,
   * which is only observable if the *following* attempt still issues a real
   * request.
   */
  failNextBatchGet = false;
  /** When set, the next `values.clear` throws and the flag clears itself. */
  failNextClear = false;
  /**
   * When set to N, the next N clears succeed and the one after that throws,
   * then the flag resets. For reaching a specific clear in an operation that
   * rewrites several tabs, where `failNextClear` would only ever hit the first.
   */
  failClearAfter: number | null = null;
  /** When set, the next `values.append` throws and the flag clears itself. */
  failNextAppend = false;
  /**
   * When set to N, the next N `values.batchUpdate` calls succeed and the one
   * after that throws, then the flag resets.
   */
  failBatchUpdateAfter: number | null = null;

  bump(key: string): void {
    this.callCounts[key] = (this.callCounts[key] ?? 0) + 1;
  }

  /** Throws if either clear-failure flag is due, consuming it. */
  maybeFailClear(): void {
    if (this.failClearAfter !== null) {
      if (this.failClearAfter > 0) {
        this.failClearAfter--;
      } else {
        this.failClearAfter = null;
        const err: any = new Error('Simulated clear failure');
        err.code = 500;
        throw err;
      }
    }
    if (this.failNextClear) {
      this.failNextClear = false;
      const err: any = new Error('Simulated clear failure');
      err.code = 500;
      throw err;
    }
  }

  newId(): string {
    return `id_${this.nextId++}`;
  }

  buildSheets(): sheets_v4.Sheets {
    const env = this;
    const api = {
      spreadsheets: {
        async create({ requestBody }: any) {
          env.bump('sheets.create');
          const id = env.newId();
          const sheets: FakeSheet[] = (requestBody?.sheets ?? []).map((s: any) => ({
            title: s.properties.title,
            rows: [],
          }));
          env.spreadsheets.set(id, { id, title: requestBody.properties.title, sheets });
          env.files.set(id, {
            id,
            name: requestBody.properties.title,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: [FAKE_ROOT_ID],
          });
          return { data: { spreadsheetId: id } };
        },
        async get({ spreadsheetId }: any) {
          env.bump('sheets.get');
          const ss = env.spreadsheets.get(spreadsheetId);
          if (!ss) {
            const err: any = new Error('Not found');
            err.code = 404;
            throw err;
          }
          return { data: { sheets: ss.sheets.map((s) => ({ properties: { title: s.title } })) } };
        },
        async batchUpdate({ spreadsheetId, requestBody }: any) {
          env.bump('sheets.batchUpdate');
          const ss = env.spreadsheets.get(spreadsheetId);
          if (!ss) throw new Error('No spreadsheet');
          for (const req of requestBody.requests ?? []) {
            if (req.addSheet) {
              ss.sheets.push({ title: req.addSheet.properties.title, rows: [] });
            }
          }
          return { data: {} };
        },
        values: {
          async get({ spreadsheetId, range }: any) {
            env.bump('values.get');
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) {
              const err: any = new Error('Not found');
              err.code = 404;
              throw err;
            }
            const [tab, cellRange] = String(range).split('!');
            const sheet = ss.sheets.find((s) => s.title === tab);
            if (!sheet) {
              const err: any = new Error('No tab');
              err.code = 400;
              throw err;
            }
            const rows = readRange(sheet.rows, cellRange);
            return { data: { values: rows } };
          },
          async batchGet({ spreadsheetId, ranges }: any) {
            env.bump('values.batchGet');
            if (env.failNextBatchGet) {
              env.failNextBatchGet = false;
              const err: any = new Error('Simulated batchGet failure');
              err.code = 500;
              throw err;
            }
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) {
              const err: any = new Error('Not found');
              err.code = 404;
              throw err;
            }
            const valueRanges = (ranges ?? []).map((range: string) => {
              const [tab, cellRange] = String(range).split('!');
              const sheet = ss.sheets.find((s) => s.title === tab);
              if (!sheet) {
                const err: any = new Error('No tab');
                err.code = 400;
                throw err;
              }
              return { range, values: readRange(sheet.rows, cellRange) };
            });
            return { data: { valueRanges } };
          },
          async update({ spreadsheetId, range, requestBody }: any) {
            env.bump('values.update');
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) throw new Error('No spreadsheet');
            const [tab, cellRange] = String(range).split('!');
            const sheet = ss.sheets.find((s) => s.title === tab);
            if (!sheet) throw new Error('No tab');
            writeRange(sheet, cellRange, requestBody.values);
            return { data: {} };
          },
          async batchUpdate({ spreadsheetId, requestBody }: any) {
            env.bump('values.batchUpdate');
            if (env.failBatchUpdateAfter !== null) {
              if (env.failBatchUpdateAfter > 0) {
                env.failBatchUpdateAfter--;
              } else {
                env.failBatchUpdateAfter = null;
                const err: any = new Error('Simulated batchUpdate failure');
                err.code = 500;
                throw err;
              }
            }
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) throw new Error('No spreadsheet');
            for (const d of requestBody.data ?? []) {
              const [tab, cellRange] = String(d.range).split('!');
              const sheet = ss.sheets.find((s) => s.title === tab);
              if (!sheet) throw new Error('No tab');
              writeRange(sheet, cellRange, d.values);
            }
            return { data: {} };
          },
          async clear({ spreadsheetId, range }: any) {
            env.bump('values.clear');
            env.maybeFailClear();
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) throw new Error('No spreadsheet');
            clearRange(ss, String(range));
            return { data: {} };
          },
          async batchClear({ spreadsheetId, requestBody }: any) {
            env.bump('values.batchClear');
            env.maybeFailClear();
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) throw new Error('No spreadsheet');
            for (const range of requestBody?.ranges ?? []) clearRange(ss, String(range));
            return { data: {} };
          },
          async append({ spreadsheetId, range, requestBody }: any) {
            env.bump('values.append');
            if (env.failNextAppend) {
              env.failNextAppend = false;
              const err: any = new Error('Simulated append failure');
              err.code = 500;
              throw err;
            }
            const ss = env.spreadsheets.get(spreadsheetId);
            if (!ss) throw new Error('No spreadsheet');
            const [tab] = String(range).split('!');
            const sheet = ss.sheets.find((s) => s.title === tab);
            if (!sheet) throw new Error('No tab');
            for (const r of requestBody.values ?? []) {
              sheet.rows.push(r.map((c: any) => String(c ?? '')));
            }
            return { data: {} };
          },
        },
      },
    };
    return api as unknown as sheets_v4.Sheets;
  }

  buildDrive(): drive_v3.Drive {
    const env = this;
    const api = {
      files: {
        async list({ q }: any) {
          env.bump('drive.list');
          let files = Array.from(env.files.values()).filter((f) => !f.trashed);
          const qStr = String(q ?? '');
          const mimeMatch = qStr.match(/mimeType='([^']+)'/);
          if (mimeMatch) {
            files = files.filter((f) => f.mimeType === mimeMatch[1]);
          }
          const propsMatch = qStr.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/);
          if (propsMatch) {
            const [, key, value] = propsMatch;
            files = files.filter((f) => f.appProperties?.[key] === value);
          }
          // Honoured rather than ignored on purpose. Discovery relies on this
          // clause to refuse a spreadsheet the teacher does not own, and a fake
          // that silently drops the term would let that guard be deleted with
          // every test still green.
          if (qStr.includes("'me' in owners")) {
            files = files.filter((f) => f.ownedByMe !== false);
          }
          return { data: { files: files.map((f) => ({ id: f.id, name: f.name, appProperties: f.appProperties })) } };
        },
        async get({ fileId, fields }: any) {
          env.bump('drive.get');
          if (fileId === 'root') return { data: { id: FAKE_ROOT_ID } };
          const file = env.files.get(fileId);
          if (!file) {
            const err: any = new Error('Not found');
            err.code = 404;
            throw err;
          }
          const requested = String(fields ?? '');
          const data: Record<string, unknown> = { id: file.id };
          if (requested.includes('parents')) data.parents = file.parents;
          if (requested.includes('appProperties')) data.appProperties = file.appProperties;
          if (requested.includes('name')) data.name = file.name;
          return { data };
        },
        async create({ requestBody, fields }: any) {
          env.bump('drive.create');
          const id = env.newId();
          env.files.set(id, {
            id,
            name: requestBody?.name ?? '',
            mimeType: requestBody?.mimeType ?? 'application/octet-stream',
            appProperties: requestBody?.appProperties,
            parents: requestBody?.parents ?? [FAKE_ROOT_ID],
          });
          return { data: String(fields ?? '').includes('id') ? { id } : {} };
        },
        async update({ fileId, requestBody, addParents, removeParents }: any) {
          env.bump('drive.update');
          const file = env.files.get(fileId);
          if (!file) throw new Error('No file');
          file.appProperties = { ...(file.appProperties ?? {}), ...(requestBody?.appProperties ?? {}) };
          if (removeParents) {
            // The real API accepts the 'root' alias as well as the root's id.
            const removing = String(removeParents)
              .split(',')
              .map((p) => (p === 'root' ? FAKE_ROOT_ID : p));
            file.parents = file.parents.filter((p) => !removing.includes(p));
          }
          if (addParents) file.parents = [...file.parents, ...String(addParents).split(',')];
          return { data: {} };
        },
        async copy({ fileId, requestBody }: any) {
          env.bump('drive.copy');
          const src = env.files.get(fileId);
          if (!src) throw new Error('No file');
          const id = env.newId();
          env.files.set(id, {
            id,
            name: requestBody?.name ?? `${src.name} (copy)`,
            mimeType: src.mimeType,
            parents: [...src.parents],
          });
          return { data: { id } };
        },
      },
    };
    return api as unknown as drive_v3.Drive;
  }

  buildGmail(): gmail_v1.Gmail {
    const env = this;
    const api = {
      users: {
        messages: {
          async send({ requestBody }: any) {
            env.bump('gmail.send');
            const parsed = decodeRawMessage(String(requestBody?.raw ?? ''));
            if (env.gmailFailFor.has(parsed.to)) {
              const err: any = new Error('Simulated Gmail failure');
              err.code = 500;
              throw err;
            }
            env.sentEmails.push(parsed);
            return { data: { id: env.newId() } };
          },
        },
      },
    };
    return api as unknown as gmail_v1.Gmail;
  }
}

function decodeHeaderValue(value: string): string {
  const m = value.match(/^=\?UTF-8\?B\?(.+)\?=$/i);
  if (m) return Buffer.from(m[1], 'base64').toString('utf8');
  return value;
}

function decodeRawMessage(raw: string): SentEmail {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [headerBlock, ...bodyParts] = text.split('\r\n\r\n');
  const body = bodyParts.join('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
  }
  return {
    from: headers.from ?? '',
    to: headers.to ?? '',
    cc: headers.cc ?? '',
    bcc: headers.bcc ?? '',
    subject: decodeHeaderValue(headers.subject ?? ''),
    body,
  };
}

/**
 * Clears a tab from a given data row down, keeping everything above it. Covers
 * the `A<n>:ZZ` form the app uses, of which `A2:ZZ` (drop every data row) is the
 * special case.
 */
function clearRange(ss: FakeSpreadsheet, range: string): void {
  const [tab, cellRange] = range.split('!');
  const sheet = ss.sheets.find((s) => s.title === tab);
  if (!sheet) throw new Error('No tab');
  const m = cellRange.match(/^A(\d+):ZZ$/);
  if (!m) throw new Error(`Unsupported clear range: ${cellRange}`);
  sheet.rows = sheet.rows.slice(0, Number.parseInt(m[1], 10) - 1);
}

function parseColRow(cell: string): { col: number; row: number | null } {
  const m = cell.match(/^([A-Z]+)(\d+)?$/);
  if (!m) return { col: 0, row: null };
  const letters = m[1];
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = m[2] ? Number.parseInt(m[2], 10) : null;
  return { col: col - 1, row: row !== null ? row - 1 : null };
}

function readRange(rows: string[][], range: string): string[][] {
  // Supports forms: "1:1", "A1", "A2:ZZ", "A2:B"
  const m = range.match(/^(\d+):(\d+)$/);
  if (m) {
    const start = Number.parseInt(m[1], 10) - 1;
    const end = Number.parseInt(m[2], 10) - 1;
    return rows.slice(start, end + 1).map((r) => [...r]);
  }
  const m2 = range.match(/^([A-Z]+\d+):([A-Z]+\d*)$/);
  if (m2) {
    const start = parseColRow(m2[1]);
    const end = parseColRow(m2[2]);
    const startRow = start.row ?? 0;
    const endRow = end.row ?? rows.length - 1;
    return rows.slice(startRow, endRow + 1).map((r) =>
      r.slice(start.col, end.col + 1),
    );
  }
  const single = parseColRow(range);
  if (single.row != null) return [[rows[single.row]?.[single.col] ?? '']];
  return rows.map((r) => [...r]);
}

function writeRange(sheet: FakeSheet, range: string, values: any[][]): void {
  const m = range.match(/^(\d+):(\d+)$/);
  if (m) {
    const start = Number.parseInt(m[1], 10) - 1;
    values.forEach((row, i) => {
      sheet.rows[start + i] = row.map((c) => String(c ?? ''));
    });
    return;
  }
  const m2 = range.match(/^([A-Z]+\d+)/);
  if (m2) {
    const { col, row } = parseColRow(m2[1]);
    values.forEach((r, i) => {
      const target = sheet.rows[(row ?? 0) + i] ?? [];
      r.forEach((c, j) => {
        target[col + j] = String(c ?? '');
      });
      sheet.rows[(row ?? 0) + i] = target;
    });
    return;
  }
  throw new Error(`Unsupported write range: ${range}`);
}
