import { Router } from 'express';
import { z } from 'zod';
import { resolveSheetsContext } from '../middleware/sheetsContext.js';
import { createActivityRecorder, type ActivityRecorder } from '../services/activity.js';
import { createPgUsageStore } from '../services/usageStore.js';
import { planOf, requirePremium } from '../middleware/entitlements.js';
import { createPgAccountStore, type AccountStore } from '../services/accountStore.js';
import { isPremium } from '../services/plan.js';
import { GROUPING_CONSTRAINT_TYPE_KEYS } from '../config/schema.js';
import { generateGrouping, saveCurrentGrouping, getCurrentGrouping } from '../services/groupings.js';
import {
  listConstraints,
  createConstraint,
  updateConstraint,
  softDeleteConstraint,
} from '../services/groupingConstraints.js';

const studentIdSchema = z.string().min(1).max(40);

const constraintBodySchema = z
  .object({
    constraintTypeKey: z.enum([...GROUPING_CONSTRAINT_TYPE_KEYS]),
    studentIds: z.array(studentIdSchema).min(2).max(10),
    notes: z.string().max(200).nullish(),
  })
  .strict();

const adHocConstraintSchema = z
  .object({
    constraintTypeKey: z.enum([...GROUPING_CONSTRAINT_TYPE_KEYS]),
    studentIds: z.array(studentIdSchema).min(2).max(10),
  })
  .strict();

// Exactly one of groupSize / groupCount, matching API_CONTRACT.md §Grouping.
const exactlyOneParam = (data: { groupSize?: number; groupCount?: number }): boolean =>
  (data.groupSize === undefined) !== (data.groupCount === undefined);
const oneParamMessage = 'Provide exactly one of groupSize or groupCount.';

const generateSchema = z
  .object({
    course: z.string().min(1).max(60),
    groupSize: z.number().int().min(2).max(10).optional(),
    groupCount: z.number().int().min(2).max(20).optional(),
    adHocConstraints: z.array(adHocConstraintSchema).max(50).optional(),
  })
  .strict()
  .refine(exactlyOneParam, { message: oneParamMessage, path: ['groupSize'] });

const saveSchema = z
  .object({
    course: z.string().min(1).max(60),
    groupSize: z.number().int().min(2).max(10).optional(),
    groupCount: z.number().int().min(2).max(20).optional(),
    groups: z
      .array(z.object({ studentIds: z.array(studentIdSchema) }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .refine(exactlyOneParam, { message: oneParamMessage, path: ['groupSize'] });

const constraintUpdateSchema = constraintBodySchema.partial();

export function buildGroupingRouter(
  store: AccountStore = createPgAccountStore(),
  activity: ActivityRecorder = createActivityRecorder(store, createPgUsageStore()),
): Router {
  const router = Router();
  // Keep-together / keep-apart rules are premium. Generating and saving a
  // grouping are not, so only the constraint routes carry the gate.
  const constraintsPremium = requirePremium(store, 'Grouping constraints');

  router.post('/generate', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey, accountId } = await resolveSheetsContext(req, store);
      const { plan } = await planOf(req, store);
      const { course, groupSize, groupCount, adHocConstraints } = generateSchema.parse(req.body);
      const result = await generateGrouping(
        sheets,
        spreadsheetId,
        userKey,
        course,
        { groupSize, groupCount },
        adHocConstraints ?? [],
        // Random generation is free; the rules that shape it are not. A free
        // account's request succeeds with its constraints ignored.
        isPremium(plan),
      );
      // Counted on generate rather than on the auto-saving PUT below, which
      // fires on every drag and would measure fiddling rather than use.
      await activity.recordToolUse({ googleSub: userKey, accountId }, 'grouping');
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // Upsert the current grouping for a course (auto-save on every change).
  router.put('/current', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const { course, groupSize, groupCount, groups } = saveSchema.parse(req.body);
      res.json(
        await saveCurrentGrouping(sheets, spreadsheetId, userKey, course, { groupSize, groupCount }, groups),
      );
    } catch (e) {
      next(e);
    }
  });

  // The saved grouping for a course, or null when the class has none yet.
  router.get('/current', async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const course = z.string().min(1).max(60).parse(req.query.course);
      res.json(await getCurrentGrouping(sheets, spreadsheetId, userKey, course));
    } catch (e) {
      next(e);
    }
  });

  router.get('/constraints', constraintsPremium, async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      res.json(await listConstraints(sheets, spreadsheetId, userKey));
    } catch (e) {
      next(e);
    }
  });

  router.post('/constraints', constraintsPremium, async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const input = constraintBodySchema.parse(req.body);
      res.status(201).json(await createConstraint(sheets, spreadsheetId, userKey, input));
    } catch (e) {
      next(e);
    }
  });

  router.put('/constraints/:id', constraintsPremium, async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      const patch = constraintUpdateSchema.parse(req.body);
      const id = String(req.params.id);
      res.json(await updateConstraint(sheets, spreadsheetId, userKey, id, patch));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/constraints/:id', constraintsPremium, async (req, res, next) => {
    try {
      const { sheets, spreadsheetId, userKey } = await resolveSheetsContext(req, store);
      await softDeleteConstraint(sheets, spreadsheetId, userKey, String(req.params.id));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
