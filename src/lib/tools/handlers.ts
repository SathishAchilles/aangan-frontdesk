// Mid-call tools. Each must answer well inside Vaani's 2-3 second limit, so they touch only the
// database and pure rules code: no AI calls, no outbound HTTP.
import type { Facts } from "../rules/facts";
import { evaluateEnquiry as runGate } from "../rules/gate";
import { describeCallback, isOfficeOpen, nextOfficeOpen } from "../rules/office-time";
import { addDays } from "../rules/time";
import { maskPhone, toE164 } from "../phone";
import {
  type EnquiryRecord,
  evaluateEnquiryRequest,
  logIntentRequest,
  lookupCallerRequest,
  type ToolDeps,
  type ToolResponse,
} from "./types";

export const REPEAT_CALLER_DAYS = 30;
const ASK_NUMBER = "Could you tell me the best number to reach you on?";
const RETRY_LINE = "Sorry, I didn't catch that properly. Could you say that again?";

function badRequest(issues: string): ToolResponse {
  return { status: 400, body: { ok: false, error: issues, say_line: RETRY_LINE } };
}

function istString(date: Date): string {
  const shifted = new Date(date.getTime() + 330 * 60_000).toISOString();
  return `${shifted.slice(0, 16)}+05:30`;
}

// Merge newly heard facts over stored ones; an empty or missing value never erases a stored one.
export function mergeFacts(stored: Partial<Facts>, incoming: Partial<Facts>): Partial<Facts> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  return merged as Partial<Facts>;
}

export async function lookupCaller(input: unknown, deps: ToolDeps): Promise<ToolResponse> {
  const parsed = lookupCallerRequest.safeParse(input ?? {});
  if (!parsed.success) return badRequest(parsed.error.message);
  const now = deps.now();
  const { rules } = await deps.settings();
  const office = {
    now_ist: istString(now),
    office_open: isOfficeOpen(now, rules.office),
    next_office_open: istString(nextOfficeOpen(now, rules.office)),
  };
  const phone = toE164(parsed.data.phone);
  if (!phone) return { status: 200, body: { ok: true, ...office, caller: null, open_enquiry: null, ask_for_number: ASK_NUMBER } };

  const caller = await deps.repo.findCallerByPhone(phone);
  if (!caller) return { status: 200, body: { ok: true, ...office, caller: null, open_enquiry: null } };
  const enquiry = await deps.repo.latestEnquiry(caller.id, addDays(now, -REPEAT_CALLER_DAYS));
  return {
    status: 200,
    body: {
      ok: true,
      ...office,
      caller: { name: caller.name, phone_masked: maskPhone(caller.phoneE164) },
      open_enquiry: enquiry
        ? {
            id: enquiry.id,
            called_on: istString(enquiry.createdAt).slice(0, 10),
            last_outcome: enquiry.outcome,
            known_facts: enquiry.facts,
          }
        : null,
    },
  };
}

export async function evaluateEnquiry(input: unknown, deps: ToolDeps): Promise<ToolResponse> {
  const parsed = evaluateEnquiryRequest.safeParse(input ?? {});
  if (!parsed.success) return badRequest(parsed.error.message);
  const existing = parsed.data.enquiry_id ? await deps.repo.getEnquiry(parsed.data.enquiry_id) : null;
  // The model does not always pass the phone. An existing enquiry identifies the caller; without
  // either, nothing can be saved yet, so the agent is told to ask for the number.
  if (parsed.data.phone === undefined && !existing) {
    return { status: 200, body: { ok: true, outcome: "PENDING", asking: "phone", next_question: ASK_NUMBER } };
  }
  const phone = parsed.data.phone === undefined ? null : toE164(parsed.data.phone);
  if (parsed.data.phone !== undefined && !phone) return { status: 400, body: { ok: false, error: "invalid phone", say_line: ASK_NUMBER } };

  const now = deps.now();
  const { rules, version } = await deps.settings();
  const callerId = phone ? (await deps.repo.upsertCaller(phone)).id : existing!.callerId;

  let enquiry: EnquiryRecord | null = existing && existing.callerId === callerId ? existing : null;
  enquiry ??= await deps.repo.createEnquiry(callerId, parsed.data.intent);

  const facts = mergeFacts(enquiry.facts, { ...parsed.data.facts, intent: parsed.data.intent });
  const asked = [...new Set([...enquiry.asked, ...parsed.data.asked])];
  const result = runGate({ facts: { intent: "new", ...facts } as Facts, asked, now, config: rules });

  await deps.repo.saveEvaluation(enquiry.id, {
    intent: parsed.data.intent,
    outcome: result.outcome,
    facts,
    asked: result.ask ? [...asked, result.ask] : asked,
    criteria: result.criteria,
    flags: result.flags,
    consultType: result.consult_type ?? null,
    settingsVersion: version,
  });

  return {
    status: 200,
    body: {
      ok: true,
      enquiry_id: enquiry.id,
      outcome: result.outcome,
      criteria: result.criteria.map(({ id, state, reason }) => ({ id, state, reason })),
      flags: result.flags,
      ...(result.next_question ? { next_question: result.next_question, asking: result.ask } : {}),
      ...(result.say_line ? { say_line: result.say_line } : {}),
      ...(result.consult_type ? { consult_type: result.consult_type } : {}),
      ...(result.callback_at ? { callback_at: istString(new Date(result.callback_at)) } : {}),
    },
  };
}

export async function logIntent(input: unknown, deps: ToolDeps): Promise<ToolResponse> {
  const parsed = logIntentRequest.safeParse(input ?? {});
  if (!parsed.success) return badRequest(parsed.error.message);
  const now = deps.now();
  const { rules } = await deps.settings();
  const phone = toE164(parsed.data.phone);

  if (parsed.data.intent === "existing_client") {
    const promise = describeCallback(now, rules.office, rules.seniorCallbackWithinMin, rules.afterHoursCallbackTime);
    const task = await deps.repo.createTask({
      kind: "urgent",
      reason: "Existing client needs a senior callback",
      payload: { phone: phone ?? null, summary: parsed.data.summary, notify: ["founder", "front_desk"] },
      dueAt: promise.at,
    });
    return {
      status: 200,
      body: {
        ok: true,
        task_id: task.id,
        say_line: `I'm really sorry about that. I've passed this to a senior member of the team, and someone senior will call you back ${promise.words}.`,
      },
    };
  }

  const task = await deps.repo.createTask({
    kind: "message",
    reason: "Message for the front desk",
    payload: { phone: phone ?? null, summary: parsed.data.summary, notify: ["front_desk"] },
  });
  return {
    status: 200,
    body: { ok: true, task_id: task.id, say_line: "Thank you. I'll pass your message to our front desk team and they'll get back to you." },
  };
}
