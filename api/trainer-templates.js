// Trainer mode (TG14): the trainer's templates and copying routines to clients (docs/telegram/TRAINER_MODE.md, section 17).
// Pure helpers here, plus the little file store; the routes are in server.js.
//
// A template is a snapshot: the trainer's routines (and the custom exercises they use) cleaned of bookkeeping, kept in
// DATA_DIR/trainer-templates-<uid>.json. Assigning it makes an independent copy (new ids) in the client's diary, or an
// offer the client accepts in their own app; nothing stays linked to the template afterwards.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';

export const TEMPLATES_MAX = 50;
export const TEMPLATE_ROUTINES_MAX = 20;
export const TEMPLATE_BYTES_MAX = 200 * 1024;
export const TEMPLATE_NAME_MAX = 60;
export const TEMPLATE_NOTE_MAX = 300;
export const ROUTINE_NAME_MAX = 80;
export const ROUTINE_EX_MAX = 60;
export const CUSTOM_EX_MAX = 200;
export const ASSIGN_MAX = 20;           // clients in one assignment
export const OFFERS_MAX = 5;            // open offers on one link; the oldest is pushed out
export const OFFER_BYTES_MAX = 60 * 1024;

const isRec = x => !!x && typeof x === 'object' && !Array.isArray(x);
const list = v => (Array.isArray(v) ? v : []);
const clone = v => JSON.parse(JSON.stringify(v));
const plainText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const newTemplateId = () => crypto.randomBytes(9).toString('base64url');
// Ids the app makes for a routine or a custom exercise (frontend lib/format.js uid): time in base 36 and five random characters.
export const newEntryId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex').slice(0, 5);

// What never travels in a template: the writer's bookkeeping (stamps, authorship), media (a photo or a video belongs to the
// person who took it), and the marks of an earlier copy.
const STRIP = new Set(['_ts', '_f', '_u', 'by', 'via', 'fromTemplate', 'fromOffer', 'media', 'photo', 'photos', 'video', 'videos', 'img', 'image']);

function stripDeep(v, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map(x => stripDeep(x, depth + 1)).filter(x => x !== undefined);
  if (isRec(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (STRIP.has(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const y = stripDeep(x, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  return v;
}

const bad = (error, text, status = 400) => ({ error, text, status });

export const UNNAMED_ROUTINE = 'Без названия';

/** One routine as a template keeps it, or an error naming the routine. An entry of `ex` that is no exercise (no id) is left
 *  out and counted in `dropped`; a routine with no name is called «Без названия». */
export function cleanRoutine(raw) {
  if (!isRec(raw)) return bad('routine-invalid', 'Рутина записана неверно');
  const name = plainText(raw.name, ROUTINE_NAME_MAX) || UNNAMED_ROUTINE;
  if (!Array.isArray(raw.ex)) return bad('routine-invalid', `Рутина «${name}» записана неверно: нет списка упражнений`);
  if (raw.ex.length > ROUTINE_EX_MAX) return bad('routine-invalid', `В рутине «${name}» больше ${ROUTINE_EX_MAX} упражнений, шаблон их не вместит`);
  const r = stripDeep(raw);
  r.name = name;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64) r.id = newEntryId();
  const before = r.ex.length;
  r.ex = r.ex.filter(e => isRec(e) && typeof e.id === 'string' && e.id && e.id.length <= 100);
  return { routine: r, dropped: before - r.ex.length };
}

/** One custom exercise as a template keeps it, or an error. */
export function cleanCustom(raw) {
  if (!isRec(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100) return bad('custom-invalid', 'Своё упражнение записано неверно');
  const c = stripDeep(raw);
  c.n = plainText(c.n, 80);
  if (!c.n) return bad('custom-invalid', 'У своего упражнения нет названия');
  return { custom: c };
}

/** Ids of the exercises the routines use. */
export const usedExerciseIds = routines => new Set(routines.flatMap(r => list(r.ex).map(e => e.id)));

// The catalogue's ids are numbers (frontend lib/exercises.js, "0025", "5965"). Anything else is a custom exercise of the person's
// own (a base-36 `uid()`, or an import's `im_...`), and the routines carry its definition in `customEx`.
const isCatalogueId = id => /^\d{1,8}$/.test(id);

/**
 * The cleaned content of a template from what the app sends: { routines, customEx, dropped }.
 * The custom exercises kept are only those a routine uses; routine ids are made unique. An exercise that points at a custom
 * exercise the list does not have (deleted since) or that is no exercise at all is left out and counted in `dropped`.
 */
export function cleanContent(body) {
  const rawRoutines = list(body.routines);
  if (!Array.isArray(body.routines) || !rawRoutines.length) return bad('routines-required', 'Выберите хотя бы одну рутину');
  if (rawRoutines.length > TEMPLATE_ROUTINES_MAX) return bad('too-many-routines', `В шаблоне до ${TEMPLATE_ROUTINES_MAX} рутин`);
  if (body.customEx !== undefined && body.customEx !== null && !Array.isArray(body.customEx)) return bad('custom-invalid', 'Свои упражнения записаны неверно');
  const routines = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of rawRoutines) {
    const r = cleanRoutine(raw);
    if (r.error) return r;
    dropped += r.dropped;
    if (seen.has(r.routine.id)) r.routine.id = newEntryId() + routines.length;
    seen.add(r.routine.id);
    routines.push(r.routine);
  }
  const defined = new Map();
  for (const raw of list(body.customEx)) {
    if (!isRec(raw) || defined.has(raw.id)) continue;
    const c = cleanCustom(raw);
    if (c.error) return c;
    defined.set(c.custom.id, c.custom);
  }
  for (const r of routines) {
    const kept = r.ex.filter(e => defined.has(e.id) || isCatalogueId(e.id));
    dropped += r.ex.length - kept.length;
    r.ex = kept;
  }
  const used = usedExerciseIds(routines);
  const customEx = [...defined.values()].filter(c => used.has(c.id));
  if (customEx.length > CUSTOM_EX_MAX) return bad('custom-invalid', 'Слишком много своих упражнений');
  return { routines, customEx, dropped };
}

const unitOf = v => (v === 'lb' ? 'lb' : 'kg');
const tooBig = () => bad('template-too-big', 'Шаблон слишком большой: уберите часть рутин', 413);

/** A new template from the body of "make a template", or an error. */
export function buildTemplate(body, now = Date.now()) {
  if (!isRec(body)) return bad('bad-request', 'Не указан шаблон');
  const name = plainText(body.name, TEMPLATE_NAME_MAX);
  if (!name) return bad('name-required', 'Назовите шаблон');
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return bad('bad-request', 'Заметка должна быть текстом');
  const { dropped, ...content } = cleanContent(body);
  if (content.error) return content;
  const at = new Date(now).toISOString();
  const template = { id: newTemplateId(), name, note: plainText(body.note, TEMPLATE_NOTE_MAX), unit: unitOf(body.unit), ...content, createdAt: at, updatedAt: at };
  if (JSON.stringify(template).length > TEMPLATE_BYTES_MAX) return tooBig();
  return { template, dropped };
}

/**
 * The template after "change a template": a new name or note, and/or `routineIds`, the routines that stay, in the order
 * wanted (a subset of what it holds: a template is edited by taking routines out and moving them, not by adding).
 */
export function changeTemplate(template, body, now = Date.now()) {
  if (!isRec(body)) return bad('bad-request', 'Не указано, что изменить');
  const next = clone(template);
  let touched = false;
  if (body.name !== undefined) {
    const name = plainText(body.name, TEMPLATE_NAME_MAX);
    if (!name) return bad('name-required', 'Назовите шаблон');
    next.name = name; touched = true;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') return bad('bad-request', 'Заметка должна быть текстом');
    next.note = plainText(body.note, TEMPLATE_NOTE_MAX); touched = true;
  }
  if (body.routineIds !== undefined) {
    if (!Array.isArray(body.routineIds) || !body.routineIds.every(x => typeof x === 'string')) return bad('bad-request', 'Состав шаблона указан неверно');
    const ids = [...new Set(body.routineIds)];
    if (!ids.length) return bad('routines-required', 'В шаблоне должна остаться хотя бы одна рутина. Чтобы убрать всё, удалите шаблон');
    const byId = new Map(next.routines.map(r => [r.id, r]));
    if (!ids.every(id => byId.has(id))) return bad('routine-gone', 'В шаблоне нет такой рутины');
    next.routines = ids.map(id => byId.get(id));
    const used = usedExerciseIds(next.routines);
    next.customEx = next.customEx.filter(c => used.has(c.id));
    touched = true;
  }
  if (!touched) return bad('bad-request', 'Не указано, что изменить');
  next.updatedAt = new Date(now).toISOString();
  return { template: next };
}

/** A row of the list of templates. */
export const summaryOf = t => ({
  id: t.id, name: t.name, note: t.note || '', unit: unitOf(t.unit),
  routineCount: t.routines.length, routineNames: t.routines.map(r => r.name), exerciseCount: t.routines.reduce((n, r) => n + list(r.ex).length, 0),
  updatedAt: t.updatedAt,
});

// ---- units: a template is in the unit of the trainer who made it ----
const LB_PER_KG = 2.2046226218;
// Same rounding as the app (frontend lib/units.js convertWeight): to the half pound, to the quarter kilogram.
export function convertWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value;
  const v = Number(value);
  return to === 'lb' ? Math.round(v * LB_PER_KG * 2) / 2 : Math.round(v / LB_PER_KG * 4) / 4;
}
function convertEx(e, from, to) {
  if (from === to) return e;
  const out = { ...e };
  if (out.weight != null) out.weight = convertWeight(out.weight, from, to);
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = convertWeight(out.inc, from, to);
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map(w => (w > 0 ? convertWeight(w, from, to) : w));
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(w => (isRec(w) && w.weight != null ? { ...w, weight: convertWeight(w.weight, from, to) } : w));
  return out;
}

/** "Тяни", then "Тяни (2)", "Тяни (3)"... : a name not yet taken (compared without case), kept within the length limit. */
export function freeName(name, taken) {
  const used = new Set([...taken].map(n => String(n).trim().toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = name.slice(0, ROUTINE_NAME_MAX - suffix.length) + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Independent copies of a template's routines for a diary that already holds `existing` ({ routines, customEx, unit }).
 * Routines get new ids, `fromTemplate`, and a free name; a custom exercise the diary has under the same name and body part
 * is reused, any other is added under a new id, and the routines point at it. Weights are converted to the diary's unit.
 * Returns { routines, customEx } to append; nothing of `existing` is touched.
 */
export function copyContent(content, existing, { templateId = '', now = Date.now(), newId = newEntryId } = {}) {
  const toUnit = unitOf(existing.unit);
  const fromUnit = unitOf(content.unit);
  const have = list(existing.customEx).filter(isRec);
  // An id is new against everything the diary holds and against what this copy has handed out already.
  const usedIds = new Set([...list(existing.routines), ...have].filter(isRec).map(x => x.id));
  const fresh = () => { let id = newId(); while (usedIds.has(id)) id = newId(); usedIds.add(id); return id; };
  const idMap = new Map();
  const addedCustom = [];
  for (const c of list(content.customEx)) {
    const same = have.concat(addedCustom).find(x => String(x.n || '').trim().toLowerCase() === String(c.n || '').trim().toLowerCase() && (x.bp || '') === (c.bp || ''));
    if (same) { idMap.set(c.id, same.id); continue; }
    const id = fresh();
    idMap.set(c.id, id);
    // As the app stores one made by hand (lib/plan-share.js mergePlan): `custom`, and `sm` mirroring the secondaries.
    addedCustom.push({ ...clone(c), id, custom: true, ...(Array.isArray(c.secondaries) && c.secondaries.length ? { sm: clone(c.secondaries) } : {}), _ts: now });
  }
  const taken = list(existing.routines).filter(isRec).map(r => r.name);
  const routines = [];
  for (const r of list(content.routines)) {
    const name = freeName(r.name, [...taken, ...routines.map(x => x.name)]);
    routines.push({
      ...clone(r), id: fresh(), name,
      ...(templateId ? { fromTemplate: templateId } : {}),
      ex: list(r.ex).map(e => convertEx({ ...clone(e), id: idMap.get(e.id) || e.id }, fromUnit, toUnit)),
      _ts: now,
    });
  }
  return { routines, customEx: addedCustom };
}

/** The diary with the copies appended, or an error. `doc` is not changed. */
export function addToDoc(doc, content, opts = {}) {
  const base = isRec(doc) ? clone(doc) : {};
  base.routines = list(base.routines).filter(isRec);
  base.customEx = list(base.customEx).filter(isRec);
  const copies = copyContent(content, { routines: base.routines, customEx: base.customEx, unit: base.unit }, opts);
  base.routines.push(...copies.routines);
  base.customEx.push(...copies.customEx);
  return { doc: base, routineIds: copies.routines.map(r => r.id), routineNames: copies.routines.map(r => r.name) };
}

// ---- an offer to a client who signed in with Telegram: the server holds it on the link, the client's app adds it ----
/** The offer to put on a link, or an error. */
export function buildOffer(content, { templateId = '', templateName = '', now = Date.now(), newId = newTemplateId } = {}) {
  const offer = { id: newId(), templateId, templateName: plainText(templateName, TEMPLATE_NAME_MAX), unit: unitOf(content.unit),
    routines: clone(content.routines), customEx: clone(content.customEx || []), at: new Date(now).toISOString() };
  if (JSON.stringify(offer).length > OFFER_BYTES_MAX) return bad('offer-too-big', 'Программа слишком большая для предложения: отправьте её частями');
  return { offer };
}

/** `offers` with `offer` added: an older offer of the same template is replaced, and at most OFFERS_MAX stay (the oldest go). */
export function pushOffer(offers, offer) {
  const kept = list(offers).filter(o => isRec(o) && !(offer.templateId && o.templateId === offer.templateId));
  return [...kept, offer].slice(-OFFERS_MAX);
}

/** The content without the notes of its routines and exercises: what a trainer wrote about one client is not handed to another. */
export function withoutNotes(content) {
  const out = clone(content);
  for (const r of list(out.routines)) {
    delete r.note;
    for (const e of list(r.ex)) delete e.note;
  }
  return out;
}

/** What the client sees of an offer in the list: who, what, when. The routines come with the offer itself. */
export const offerSummary = (o, coachName) => ({
  id: o.id, templateName: o.templateName, coachName, routineNames: o.routines.map(r => r.name), at: o.at,
});

/** The whole offer: the composition, and everything the app needs to add it. */
export const offerView = o => ({
  id: o.id, templateName: o.templateName, unit: unitOf(o.unit), at: o.at,
  routineCount: o.routines.length, routineNames: o.routines.map(r => r.name),
  routines: o.routines, customEx: o.customEx || [],
});

// ---- a repeated request: the same `requestId` on the same link answers what it answered, writing nothing ----
// The app makes one id per opened sheet. A lost answer then costs a retry, not a second «Тяни (2)». The link keeps the last
// ASSIGN_KEYS_MAX results for ASSIGN_KEYS_TTL_MS; an error is not kept, so a retry of what failed does try again.
export const ASSIGN_KEYS_MAX = 20;
export const ASSIGN_KEYS_TTL_MS = 24 * 3600 * 1000;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The request id of a body: '' when it has none, null when it is not one. */
export const requestIdOf = raw => (raw === undefined || raw === null || raw === '' ? '' : typeof raw === 'string' && REQUEST_ID_RE.test(raw) ? raw : null);

/** The result this link already gave for `key` handed over as `scope` (a template, or a copy of named routines), or null. */
export function seenResult(link, key, scope, now = Date.now()) {
  if (!key) return null;
  const hit = list(link && link.assigned).find(a => isRec(a) && a.key === key && a.scope === scope && now - a.at < ASSIGN_KEYS_TTL_MS);
  return hit ? clone(hit.result) : null;
}

/** `assigned` of a link with the new result added: old ones past their time go, the newest ASSIGN_KEYS_MAX stay. */
export function rememberResult(assigned, key, scope, result, now = Date.now()) {
  const kept = list(assigned).filter(a => isRec(a) && now - a.at < ASSIGN_KEYS_TTL_MS && !(a.key === key && a.scope === scope));
  return [...kept, { key, scope, at: now, result: clone(result) }].slice(-ASSIGN_KEYS_MAX);
}

// ---- the file store: DATA_DIR/trainer-templates-<uid>.json, written temp-then-rename ----
export const templatesFile = (dir, uid) => path.join(dir, `trainer-templates-${uid}.json`);

/** The trainer's templates, or null when the file is there and cannot be read (nothing is overwritten then). */
export function readTemplates(dir, uid) {
  let text;
  try { text = fs.readFileSync(templatesFile(dir, uid), 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
  try {
    const doc = JSON.parse(text);
    return list(doc && doc.templates).filter(t => isRec(t) && typeof t.id === 'string' && Array.isArray(t.routines));
  } catch { return null; }
}

export function writeTemplates(dir, uid, templates) {
  atomicWrite(templatesFile(dir, uid), JSON.stringify({ version: 1, templates }), 0o600);
}

export function removeTemplates(dir, uid) {
  try { fs.unlinkSync(templatesFile(dir, uid)); } catch { /* none stored */ }
}
