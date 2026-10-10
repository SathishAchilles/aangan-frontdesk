import { randomUUID } from "node:crypto";
import { defaultRulesConfig } from "../../../src/lib/rules/config";
import type { CallerRecord, EnquiryRecord, TaskInput, ToolDeps, ToolRepo } from "../../../src/lib/tools/types";

export type FakeState = {
  callers: CallerRecord[];
  enquiries: (EnquiryRecord & { criteria?: unknown; flags?: string[]; consultType?: string | null; settingsVersion?: number })[];
  tasks: (TaskInput & { id: string })[];
};

export function fakeRepo(state: FakeState = { callers: [], enquiries: [], tasks: [] }): ToolRepo & { state: FakeState } {
  return {
    state,
    async findCallerByPhone(phone) {
      return state.callers.find((caller) => caller.phoneE164 === phone) ?? null;
    },
    async upsertCaller(phone) {
      const existing = state.callers.find((caller) => caller.phoneE164 === phone);
      if (existing) return existing;
      const caller = { id: randomUUID(), phoneE164: phone, name: null };
      state.callers.push(caller);
      return caller;
    },
    async latestEnquiry(callerId, since) {
      return (
        state.enquiries
          .filter((enquiry) => enquiry.callerId === callerId && enquiry.createdAt >= since)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },
    async getEnquiry(id) {
      return state.enquiries.find((enquiry) => enquiry.id === id) ?? null;
    },
    async createEnquiry(callerId, intent) {
      const enquiry: FakeState["enquiries"][number] = {
        id: randomUUID(),
        callerId,
        intent,
        outcome: "PENDING",
        facts: {},
        asked: [],
        createdAt: new Date(),
      };
      state.enquiries.push(enquiry);
      return enquiry;
    },
    async saveEvaluation(id, patch) {
      const enquiry = state.enquiries.find((row) => row.id === id);
      if (!enquiry) throw new Error(`no enquiry ${id}`);
      Object.assign(enquiry, patch, { asked: patch.asked as EnquiryRecord["asked"] });
    },
    async createTask(task) {
      const row = { ...task, id: randomUUID() };
      state.tasks.push(row);
      return { id: row.id };
    },
  };
}

export function fakeDeps(now: Date, repo = fakeRepo()): ToolDeps & { repo: ReturnType<typeof fakeRepo> } {
  return { repo, now: () => now, settings: async () => ({ rules: defaultRulesConfig(), version: 7 }) };
}
