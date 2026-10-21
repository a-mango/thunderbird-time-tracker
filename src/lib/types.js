// Schema v1 shapes (docs/SPEC.md, Data model). Times are epoch ms (UTC).

/**
 * @typedef {{id:string, parentId:string|null, name:string, color:string, order:number,
 *            archived:boolean, createdAt:number, updatedAt:number}} Project
 * @typedef {{id:string, projectId:string, name:string, status:'open'|'done', starred:boolean,
 *            estimateMin:number|null, billable:boolean, tags:string[], notes:string,
 *            order:number, createdAt:number, updatedAt:number, doneAt:number|null}} Task
 * @typedef {'timer'|'manual'|'split'|'idle'} EntrySource
 * @typedef {{id:string, taskId:string, start:number, end:number|null, note:string,
 *            source:EntrySource, createdAt:number, updatedAt:number,
 *            deletedAt:number|null}} Entry
 *   `end === null` is the running timer. `deletedAt` marks a soft-deleted entry, restorable
 *   until the next Thunderbird start.
 * @typedef {'compact'|'default'|'relaxed'} Density
 * @typedef {'system'|'thunderbird'|'purple'|'orange'|'pink'|'ink'|'teal'} Accent
 * @typedef {{density:Density, accent:Accent, weekStart:0|1, dailyTargetMin:number,
 *            durationFormat:'hm'|'decimal', showDone:boolean, confirmDelete:boolean,
 *            idleThresholdMin:number, roundingMin:0|5|6|15}} Settings
 *   `weekStart`: 0 = Sunday, 1 = Monday (the `Date#getDay` numbering).
 * @typedef {{format:'thunderbird-time-tracker', version:1, exportedAt:number,
 *            projects:Project[], tasks:Task[], entries:Entry[],
 *            settings?:Partial<Settings>}} Backup
 */

export {};
