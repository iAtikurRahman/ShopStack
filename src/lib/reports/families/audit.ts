import { add, finish, num, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { productMap, userMap } from "../lookups";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Audit reports - what changed, who changed it, and when.
 *
 * AuditLog is the only record of these events in this schema, and it is written
 * opportunistically by whichever mutation paths bother to log. Two reports that
 * were asked for cannot exist here at all:
 *
 *  - Login / logout history and failed-login attempts. Nothing is written when
 *    someone signs in or fails to; there is no session or auth-attempt table, so
 *    there is no row to read. See UNAVAILABLE_REPORTS in ../catalog.
 *  - Stock adjustments / physical count variances. WarehouseStock is a balance,
 *    not a ledger of movements - there is no adjustment table, only purchases,
 *    sales, returns and transfers. See reports.note.stockHasNoMovementTable.
 *
 * The log is also unfiltered by store: a single AuditLog table serves the whole
 * company, so for a store manager these reports show what that user did, not
 * what happened inside their shop. Both notes say so.
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

type LogRow = {
  id: number;
  createdAt: Date;
  userId: number | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  before: unknown;
  after: unknown;
};

/** The logs for the window, newest first. Every audit report starts here. */
async function windowLogs(ctx: ReportContext): Promise<LogRow[]> {
  return ctx.db.auditLog.findMany({
    where: { createdAt: inWindow(ctx) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      userId: true,
      userEmail: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
    },
  });
}

/** Read one field out of a Prisma Json blob, tolerating a missing or malformed
 *  one. The log stores whatever the mutation path passed, so the same key is not
 *  guaranteed to exist on every row of the same entityType. */
function jsonField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return null;
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

const NOTE_STORE_UNSCOPED = "reports.note.auditLogIsCompanyWide";

export const auditReports: ReportDefinition[] = [
  {
    key: "audit-log",
    family: "audit",
    title: "reports.report.auditLog",
    description: "reports.desc.auditLog",
    build: async (ctx) => {
      const [logs, users] = await Promise.all([windowLogs(ctx), userMap(ctx.db)]);
      const rows: ReportRow[] = logs.map((log) => ({
        date: log.createdAt.toISOString(),
        user: log.userId === null ? log.userEmail : (users.get(log.userId)?.name ?? log.userEmail),
        userId: log.userId,
        role: log.userId === null ? null : (users.get(log.userId)?.role ?? null),
        action: log.action,
        entity: log.entityType,
        entityId: log.entityId,
        changed: log.before === null || log.after === null ? false : true,
        before: log.before === null ? null : JSON.stringify(log.before),
        after: log.after === null ? null : JSON.stringify(log.after),
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "action", label: "reports.col.action", type: "badge" },
        { key: "entity", label: "reports.col.entity", type: "text" },
        { key: "entityId", label: "reports.col.entityId", type: "number" },
        { key: "changed", label: "reports.col.hasDiff", type: "text" },
        { key: "before", label: "reports.col.before", type: "text" },
        { key: "after", label: "reports.col.after", type: "text" },
      ];
      return finish({
        key: "audit-log",
        title: "reports.report.auditLog",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "users", label: "reports.col.users", value: new Set(logs.map((log) => log.userId)).size, type: "number" },
          { key: "entities", label: "reports.col.distinctEntities", value: new Set(logs.map((log) => log.entityType)).size, type: "number" },
          { key: "diffs", label: "reports.col.entriesWithDiff", value: logs.filter((log) => log.before !== null && log.after !== null).length, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.auditLogOnlyRecordsWhatIsWritten", "reports.detailLimitNote"],
      });
    },
  },
  {
    key: "audit-by-user",
    family: "audit",
    title: "reports.report.auditByUser",
    description: "reports.desc.auditByUser",
    build: async (ctx) => {
      const [logs, users] = await Promise.all([windowLogs(ctx), userMap(ctx.db)]);
      const groups = new Map<number, ReportRow>();
      for (const log of logs) {
        const id = log.userId ?? -1;
        let row = groups.get(id);
        if (!row) {
          const user = log.userId === null ? null : users.get(log.userId);
          row = {
            user: user?.name ?? log.userEmail ?? "reports.value.system",
            email: log.userEmail,
            role: user?.role ?? null,
            entries: 0,
            entities: 0,
            changes: 0,
            first: log.createdAt.toISOString(),
            last: log.createdAt.toISOString(),
          };
          groups.set(id, row);
        }
        row.entries = num(row.entries) + 1;
        if (String(row.first) > log.createdAt.toISOString()) row.first = log.createdAt.toISOString();
        if (String(row.last) < log.createdAt.toISOString()) row.last = log.createdAt.toISOString();
      }
      for (const [id, row] of groups) {
        const matching = logs.filter((log) => (log.userId ?? -1) === id);
        row.entities = new Set(matching.map((log) => `${log.entityType}:${log.entityId}`)).size;
        row.changes = matching.filter((log) => log.before !== null && log.after !== null).length;
      }
      const grouped = [...groups.values()];
      const columns: ReportColumn[] = [
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "email", label: "reports.col.email", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "entries", label: "reports.col.entries", type: "number", sum: true },
        { key: "changes", label: "reports.col.entriesWithDiff", type: "number", sum: true },
        { key: "entities", label: "reports.col.entitiesTouched", type: "number", sum: true },
        { key: "first", label: "reports.col.firstSeen", type: "datetime" },
        { key: "last", label: "reports.col.lastSeen", type: "datetime" },
      ];
      return finish({
        key: "audit-by-user",
        title: "reports.report.auditByUser",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "entries"),
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "users", label: "reports.col.users", value: grouped.length, type: "number" },
          { key: "changes", label: "reports.col.entriesWithDiff", value: logs.filter((log) => log.before !== null && log.after !== null).length, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.auditLogOnlyRecordsWhatIsWritten"],
      });
    },
  },
  {
    key: "audit-by-action",
    family: "audit",
    title: "reports.report.auditByAction",
    description: "reports.desc.auditByAction",
    build: async (ctx) => {
      const logs = await windowLogs(ctx);
      const groups = new Map<string, ReportRow>();
      for (const log of logs) {
        let row = groups.get(log.action);
        if (!row) {
          row = { action: log.action, entries: 0, users: 0, entities: 0, changes: 0 };
          groups.set(log.action, row);
        }
        row.entries = num(row.entries) + 1;
        if (log.before !== null && log.after !== null) row.changes = num(row.changes) + 1;
      }
      for (const [action, row] of groups) {
        const matching = logs.filter((log) => log.action === action);
        row.users = new Set(matching.map((log) => log.userId)).size;
        row.entities = new Set(matching.map((log) => `${log.entityType}:${log.entityId}`)).size;
      }
      const grouped = [...groups.values()];
      const columns: ReportColumn[] = [
        { key: "action", label: "reports.col.action", type: "badge" },
        { key: "entries", label: "reports.col.entries", type: "number", sum: true },
        { key: "users", label: "reports.col.users", type: "number", sum: true },
        { key: "entities", label: "reports.col.entitiesTouched", type: "number", sum: true },
        { key: "changes", label: "reports.col.entriesWithDiff", type: "number", sum: true },
      ];
      return finish({
        key: "audit-by-action",
        title: "reports.report.auditByAction",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "entries"),
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "actions", label: "reports.col.distinctActions", value: grouped.length, type: "number" },
          { key: "changes", label: "reports.col.entriesWithDiff", value: logs.filter((log) => log.before !== null && log.after !== null).length, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED],
      });
    },
  },
  {
    key: "audit-by-entity",
    family: "audit",
    title: "reports.report.auditByEntity",
    description: "reports.desc.auditByEntity",
    build: async (ctx) => {
      const logs = await windowLogs(ctx);
      const groups = new Map<string, ReportRow>();
      for (const log of logs) {
        const key = `${log.entityType}:${log.entityId ?? "-"}`;
        let row = groups.get(key);
        if (!row) {
          row = { entity: log.entityType, entityId: log.entityId, entries: 0, actions: 0, users: 0, changes: 0, last: log.createdAt.toISOString() };
          groups.set(key, row);
        }
        row.entries = num(row.entries) + 1;
        if (String(row.last) < log.createdAt.toISOString()) row.last = log.createdAt.toISOString();
      }
      for (const [key, row] of groups) {
        const matching = logs.filter((log) => `${log.entityType}:${log.entityId ?? "-"}` === key);
        row.actions = new Set(matching.map((log) => log.action)).size;
        row.users = new Set(matching.map((log) => log.userId)).size;
        row.changes = matching.filter((log) => log.before !== null && log.after !== null).length;
      }
      const grouped = [...groups.values()];
      const columns: ReportColumn[] = [
        { key: "entity", label: "reports.col.entity", type: "text" },
        { key: "entityId", label: "reports.col.entityId", type: "number" },
        { key: "entries", label: "reports.col.entries", type: "number", sum: true },
        { key: "actions", label: "reports.col.distinctActions", type: "number", sum: true },
        { key: "users", label: "reports.col.users", type: "number", sum: true },
        { key: "changes", label: "reports.col.entriesWithDiff", type: "number", sum: true },
        { key: "last", label: "reports.col.lastChange", type: "datetime" },
      ];
      return finish({
        key: "audit-by-entity",
        title: "reports.report.auditByEntity",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "last"),
        metrics: [
          { key: "entities", label: "reports.col.distinctEntities", value: grouped.length, type: "number" },
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "types", label: "reports.col.distinctEntityTypes", value: new Set(logs.map((log) => log.entityType)).size, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED],
      });
    },
  },
  {
    key: "audit-recent-changes",
    family: "audit",
    title: "reports.report.auditRecentChanges",
    description: "reports.desc.auditRecentChanges",
    build: async (ctx) => {
      const [logs, users] = await Promise.all([windowLogs(ctx), userMap(ctx.db)]);
      const changed = logs.filter((log) => log.before !== null && log.after !== null);
      const rows: ReportRow[] = changed.map((log) => {
        const before = (log.before ?? {}) as Record<string, unknown>;
        const after = (log.after ?? {}) as Record<string, unknown>;
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
        );
        return {
          date: log.createdAt.toISOString(),
          user: log.userId === null ? log.userEmail : (users.get(log.userId)?.name ?? log.userEmail),
          action: log.action,
          entity: log.entityType,
          entityId: log.entityId,
          fields: fields.join(", ") || null,
          detail: fields
            .map((field) => `${field}: ${JSON.stringify(before[field] ?? null)} -> ${JSON.stringify(after[field] ?? null)}`)
            .join(" | "),
        };
      });
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "action", label: "reports.col.action", type: "badge" },
        { key: "entity", label: "reports.col.entity", type: "text" },
        { key: "entityId", label: "reports.col.entityId", type: "number" },
        { key: "fields", label: "reports.col.changedFields", type: "text" },
        { key: "detail", label: "reports.col.changeDetail", type: "text" },
      ];
      return finish({
        key: "audit-recent-changes",
        title: "reports.report.auditRecentChanges",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "changes", label: "reports.col.entriesWithDiff", value: changed.length, type: "number" },
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "users", label: "reports.col.users", value: new Set(changed.map((log) => log.userId)).size, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.auditLogOnlyRecordsWhatIsWritten", "reports.detailLimitNote"],
      });
    },
  },
  {
    key: "audit-price-changes",
    family: "audit",
    title: "reports.report.auditPriceChanges",
    description: "reports.desc.auditPriceChanges",
    build: async (ctx) => {
      const logs = await windowLogs(ctx);
      const productLogs = logs.filter((log) => log.entityType.toLowerCase() === "product");
      const productIds = productLogs
        .map((log) => log.entityId)
        .filter((id): id is number => id !== null);
      const [users, products] = await Promise.all([userMap(ctx.db), productMap(ctx.db, productIds)]);
      const rows: ReportRow[] = [];
      for (const log of productLogs) {
        const beforePurchase = jsonField(log.before, "purchasePrice");
        const afterPurchase = jsonField(log.after, "purchasePrice");
        const beforeSale = jsonField(log.before, "salePrice");
        const afterSale = jsonField(log.after, "salePrice");
        if (beforePurchase === afterPurchase && beforeSale === afterSale) continue;
        const product = log.entityId === null ? undefined : products.get(log.entityId);
        rows.push({
          date: log.createdAt.toISOString(),
          user: log.userId === null ? log.userEmail : (users.get(log.userId)?.name ?? log.userEmail),
          action: log.action,
          productId: log.entityId,
          product: product?.name ?? null,
          sku: product?.sku ?? null,
          purchaseFrom: beforePurchase,
          purchaseTo: afterPurchase,
          saleFrom: beforeSale,
          saleTo: afterSale,
          purchaseChange: beforePurchase === null || afterPurchase === null ? null : num(afterPurchase) - num(beforePurchase),
          saleChange: beforeSale === null || afterSale === null ? null : num(afterSale) - num(beforeSale),
        });
      }
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "action", label: "reports.col.action", type: "badge" },
        { key: "purchaseFrom", label: "reports.col.purchaseFrom", type: "money" },
        { key: "purchaseTo", label: "reports.col.purchaseTo", type: "money" },
        { key: "purchaseChange", label: "reports.col.purchaseChange", type: "money" },
        { key: "saleFrom", label: "reports.col.saleFrom", type: "money" },
        { key: "saleTo", label: "reports.col.saleTo", type: "money" },
        { key: "saleChange", label: "reports.col.saleChange", type: "money" },
      ];
      return finish({
        key: "audit-price-changes",
        title: "reports.report.auditPriceChanges",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "changes", label: "reports.col.priceChanges", value: rows.length, type: "number" },
          {
            key: "purchaseChange",
            label: "reports.col.purchaseChange",
            value: add(...rows.map((row) => num(row.purchaseChange))),
            type: "money",
          },
          {
            key: "saleChange",
            label: "reports.col.saleChange",
            value: add(...rows.map((row) => num(row.saleChange))),
            type: "money",
          },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.priceChangeNeedsProductAuditEntries"],
      });
    },
  },
  {
    key: "audit-by-hour",
    family: "audit",
    title: "reports.report.auditByHour",
    description: "reports.desc.auditByHour",
    build: async (ctx) => {
      const logs = await windowLogs(ctx);
      const buckets = new Map<number, ReportRow>();
      for (let hour = 0; hour < 24; hour += 1) {
        buckets.set(hour, { hour, label: `${String(hour).padStart(2, "0")}:00`, entries: 0, users: 0, entities: 0, changes: 0 });
      }
      for (const log of logs) {
        const row = buckets.get(log.createdAt.getHours()) as ReportRow;
        row.entries = num(row.entries) + 1;
        if (log.before !== null && log.after !== null) row.changes = num(row.changes) + 1;
      }
      for (const hour of buckets.keys()) {
        const matching = logs.filter((log) => log.createdAt.getHours() === hour);
        const row = buckets.get(hour) as ReportRow;
        row.users = new Set(matching.map((log) => log.userId)).size;
        row.entities = new Set(matching.map((log) => `${log.entityType}:${log.entityId}`)).size;
      }
      const rows = [...buckets.values()];
      const columns: ReportColumn[] = [
        { key: "label", label: "reports.col.hour", type: "text" },
        { key: "entries", label: "reports.col.entries", type: "number", sum: true },
        { key: "users", label: "reports.col.users", type: "number", sum: true },
        { key: "entities", label: "reports.col.entitiesTouched", type: "number", sum: true },
        { key: "changes", label: "reports.col.entriesWithDiff", type: "number", sum: true },
      ];
      const busiest = sortRows(rows, "entries")[0];
      return finish({
        key: "audit-by-hour",
        title: "reports.report.auditByHour",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          {
            key: "busiestHour",
            label: "reports.col.busiestHour",
            // An empty window has no busiest hour; midnight would be a claim the
            // report cannot back up.
            value: num(busiest?.entries) > 0 ? String(busiest.label) : "—",
            type: "text",
          },
          { key: "changes", label: "reports.col.entriesWithDiff", value: logs.filter((log) => log.before !== null && log.after !== null).length, type: "number" },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.hourIsServerLocal"],
      });
    },
  },
  {
    key: "audit-daily-activity",
    family: "audit",
    title: "reports.report.auditDailyActivity",
    description: "reports.desc.auditDailyActivity",
    build: async (ctx) => {
      const logs = await windowLogs(ctx);
      const buckets = new Map<string, ReportRow>();
      for (const log of logs) {
        const day = log.createdAt.toISOString().slice(0, 10);
        let row = buckets.get(day);
        if (!row) {
          row = { date: day, entries: 0, users: 0, entities: 0, changes: 0, creates: 0, updates: 0, deletes: 0 };
          buckets.set(day, row);
        }
        row.entries = num(row.entries) + 1;
        if (log.before !== null && log.after !== null) row.changes = num(row.changes) + 1;
        const action = log.action.toLowerCase();
        if (action.includes("create") || action.includes("add")) row.creates = num(row.creates) + 1;
        else if (action.includes("delete") || action.includes("remove")) row.deletes = num(row.deletes) + 1;
        else row.updates = num(row.updates) + 1;
      }
      for (const [day, row] of buckets) {
        const matching = logs.filter((log) => log.createdAt.toISOString().slice(0, 10) === day);
        row.users = new Set(matching.map((log) => log.userId)).size;
        row.entities = new Set(matching.map((log) => `${log.entityType}:${log.entityId}`)).size;
      }
      const grouped = [...buckets.values()];
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "entries", label: "reports.col.entries", type: "number", sum: true },
        { key: "users", label: "reports.col.users", type: "number", sum: true },
        { key: "creates", label: "reports.col.creates", type: "number", sum: true },
        { key: "updates", label: "reports.col.updates", type: "number", sum: true },
        { key: "deletes", label: "reports.col.deletes", type: "number", sum: true },
        { key: "entities", label: "reports.col.entitiesTouched", type: "number", sum: true },
      ];
      return finish({
        key: "audit-daily-activity",
        title: "reports.report.auditDailyActivity",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "date", "asc"),
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "days", label: "reports.col.daysWithActivity", value: grouped.length, type: "number" },
          {
            key: "average",
            label: "reports.col.averageEntriesPerDay",
            value: grouped.length ? Math.round(logs.length / grouped.length) : 0,
            type: "number",
          },
        ],
        notes: [NOTE_STORE_UNSCOPED, "reports.note.auditLogOnlyRecordsWhatIsWritten"],
      });
    },
  },
];