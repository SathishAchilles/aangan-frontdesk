import { describe, expect, it, vi } from "vitest";
import { type CallbackQuery, handleCallbackQuery, type TelegramActionRepo } from "../../../src/lib/telegram/actions";
import type { OutgoingMessage, TelegramClient } from "../../../src/lib/telegram/client";
import { chatsForTask, type DispatchRepo, dispatchPending, type StaffChats } from "../../../src/lib/telegram/dispatch";
import { type HandoffView, handoffMessage, parseCallbackData, qualitySummaryMessage, reminderMessage, taskMessage } from "../../../src/lib/telegram/templates";

const HANDOFF_ID = "0f7e2c9a-3b1d-4c5e-8f6a-1b2c3d4e5f60";
const ENQUIRY_ID = "5b0f6f63-62c5-4a51-9d0e-1a0d4c8d2b10";
const TASK_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const view: HandoffView = {
  handoffId: HANDOFF_ID,
  enquiryId: ENQUIRY_ID,
  outcome: "QUALIFIED_WITH_NOTES",
  callerName: "Priya",
  phone: "+918056203528",
  slotLabel: "Wednesday 14 October at 4 pm",
  consultType: "studio",
  designerName: "Designer 2",
  designerTelegramId: 111222333,
  note: { one_line_summary: "3BHK in Kothrud, full redesign", area: "Kothrud - Dahanukar Colony", size_sqft: 1400, scope: "kitchen, living room, both bedrooms", timeline: "done by March", decision_maker: null, referral: "Shruti Joshi" },
  criteria: [
    { id: "C1", state: "pass", reason: "", evidence: "redo the whole thing" },
    { id: "C2", state: "pass", reason: "", evidence: "Kothrud" },
    { id: "C3", state: "pass", reason: "", evidence: "done by March" },
    { id: "C4", state: "not_mentioned", reason: "", evidence: "" },
    { id: "C5", state: "unclear", reason: "", evidence: "" },
  ],
  flags: ["referral", "unclear_C5"],
  callUrl: "https://aangan-frontdesk.vercel.app/dashboard/calls/abc",
};

function fakeTelegram() {
  const sent: OutgoingMessage[] = [];
  const edits: { chatId: number; html: string }[] = [];
  const answers: string[] = [];
  const telegram: TelegramClient = {
    async send(message) {
      sent.push(message);
      return { messageId: sent.length };
    },
    async edit(chatId, _messageId, html) {
      edits.push({ chatId, html });
    },
    async answer(_id, text) {
      answers.push(text);
    },
  };
  return { telegram, sent, edits, answers };
}

describe("templates", () => {
  it("renders the handoff note with checks, flags and an Accept button", () => {
    expect(handoffMessage(view)).toMatchSnapshot();
  });

  it("escapes HTML in caller-provided text", () => {
    const { html } = handoffMessage({ ...view, callerName: "<script>x</script>" });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders a task, reminders and the weekly quality summary", () => {
    expect(taskMessage({ taskId: TASK_ID, kind: "callback", reason: "Caller needs a person", phone: "+918056203528", callerName: "Priya", dueLabel: "Wednesday 14 October at 10:30 am", summary: null, callUrl: null })).toMatchSnapshot();
    expect(reminderMessage("reminder", "Handoff for Priya", 15, "Designer 2")).toMatchSnapshot();
    expect(reminderMessage("escalation", "Handoff for Priya", 30, "Designer 2")).toMatchSnapshot();
    expect(qualitySummaryMessage({ week: "5-11 Oct", sampled: 20, outcomeRate: 0.9, hardZeroHits: 0, failingLinks: [] })).toMatchSnapshot();
  });

  it("keeps callback data within Telegram's 64-byte limit and parses it back", () => {
    const { buttons } = handoffMessage(view);
    expect(Buffer.byteLength(buttons[0][0].callback_data)).toBeLessThanOrEqual(64);
    expect(parseCallbackData(buttons[0][0].callback_data)).toEqual({ action: "acc", id: HANDOFF_ID });
    expect(parseCallbackData("acc:not-a-uuid")).toBeNull();
  });
});

describe("button presses", () => {
  function repo(overrides: Partial<TelegramActionRepo> = {}): TelegramActionRepo {
    let accepted: string | null = null;
    return {
      staffByTelegramId: async (id) => (id === 111222333 ? { id: "s2", name: "Designer 2", role: "designer" } : id === 444 ? { id: "s3", name: "Designer 3", role: "designer" } : null),
      acceptHandoff: async (_handoffId, staffId) => {
        if (accepted) return { won: false, enquiryId: ENQUIRY_ID, acceptedBy: accepted };
        accepted = staffId === "s2" ? "Designer 2" : "Designer 3";
        return { won: true, enquiryId: ENQUIRY_ID, acceptedBy: null };
      },
      completeTask: async () => true,
      recordResult: async () => true,
      ...overrides,
    };
  }
  const press = (from: number, data: string): CallbackQuery => ({ id: `q${from}`, from: { id: from }, data, message: { message_id: 7, chat: { id: -100 }, text: "New enquiry" } });

  it("lets the first designer accept and tells the second it is taken", async () => {
    const actions = repo();
    const tg = fakeTelegram();
    const deps = { repo: actions, telegram: tg.telegram, now: () => new Date("2026-10-13T08:30:00Z") };
    expect(await handleCallbackQuery(press(111222333, `acc:${HANDOFF_ID}`), deps)).toEqual({ action: "acc", ok: true });
    expect(tg.edits[0].html).toContain("Accepted by Designer 2</b> at 14:00");
    expect(await handleCallbackQuery(press(444, `acc:${HANDOFF_ID}`), deps)).toMatchObject({ ok: false, reason: "already accepted" });
    expect(tg.answers.at(-1)).toBe("Already accepted by Designer 2.");
  });

  it("ignores a press from someone who is not staff", async () => {
    const accept = vi.fn();
    const tg = fakeTelegram();
    const result = await handleCallbackQuery(press(999, `acc:${HANDOFF_ID}`), { repo: repo({ acceptHandoff: accept }), telegram: tg.telegram, now: () => new Date() });
    expect(result).toMatchObject({ ok: false, reason: "not staff" });
    expect(accept).not.toHaveBeenCalled();
  });

  it("rejects malformed button data", async () => {
    const tg = fakeTelegram();
    expect((await handleCallbackQuery(press(111222333, "drop table"), { repo: repo(), telegram: tg.telegram, now: () => new Date() })).ok).toBe(false);
  });

  it("records Won once", async () => {
    let saved = false;
    const tg = fakeTelegram();
    const actions = repo({ recordResult: async () => (saved ? false : (saved = true)) });
    const deps = { repo: actions, telegram: tg.telegram, now: () => new Date() };
    expect((await handleCallbackQuery(press(111222333, `won:${ENQUIRY_ID}`), deps)).ok).toBe(true);
    expect((await handleCallbackQuery(press(111222333, `won:${ENQUIRY_ID}`), deps)).ok).toBe(false);
  });
});

describe("dispatch", () => {
  const chats: StaffChats = { designers: -1001, front_desk: -1002, founder: 55 };
  const dispatchRepo = (): DispatchRepo & { posted: string[] } => {
    const posted: string[] = [];
    return {
      posted,
      pendingHandoffs: async () => [view],
      markHandoffPosted: async (id) => void posted.push(id),
      pendingTasks: async () => [
        { taskId: TASK_ID, kind: "callback", reason: "Caller needs a person", phone: "+918056203528", callerName: "Priya", dueLabel: null, summary: null, callUrl: null },
        { taskId: "11111111-2222-4333-8444-555555555555", kind: "urgent", reason: "Existing client", phone: "+919800000001", callerName: null, dueLabel: null, summary: "Designer not replying", callUrl: null },
      ],
      markTaskPosted: async (id) => void posted.push(id),
    };
  };

  it("sends only to the configured staff chats, never to a caller", async () => {
    const tg = fakeTelegram();
    const result = await dispatchPending({ repo: dispatchRepo(), telegram: tg.telegram, chats });
    expect(result).toEqual({ handoffs: 1, tasks: 2, skipped: [] });
    const allowed = new Set([chats.designers, chats.front_desk, chats.founder]);
    expect(tg.sent.every((message) => allowed.has(message.chatId))).toBe(true);
    expect(tg.sent.some((message) => String(message.chatId).includes("8056203528"))).toBe(false);
  });

  it("sends urgent items to the founder and the front desk, others to the front desk", () => {
    expect(chatsForTask("urgent", chats)).toEqual([55, -1002]);
    expect(chatsForTask("callback", chats)).toEqual([-1002]);
  });

  it("posts nothing to designers until their chat is configured", async () => {
    const tg = fakeTelegram();
    const result = await dispatchPending({ repo: dispatchRepo(), telegram: tg.telegram, chats: { designers: null, front_desk: null, founder: null } });
    expect(result.handoffs).toBe(0);
    expect(result.skipped).toContain("no designers chat configured");
    expect(tg.sent).toHaveLength(0);
  });
});
