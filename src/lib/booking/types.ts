import { z } from "zod";
import type { CalcomClient } from "../calendar";
import type { RulesConfig } from "../rules/config";
import type { ConsultType, Outcome } from "../rules/gate";
import type { Facts } from "../rules/facts";
import type { TaskInput } from "../tools/types";

export const getSlotsRequest = z.object({
  enquiry_id: z.uuid(),
  consult_type: z.enum(["studio", "site", "principal"]).optional(),
  constraints_text: z.string().max(500).optional(),
});

export const bookSlotRequest = z.object({
  enquiry_id: z.uuid(),
  slot_id: z.iso.datetime({ offset: true }),
  name: z.string().min(1).max(120),
  phone: z.string().min(1),
  address: z.string().max(300).optional(),
});

export type BookingEnquiry = {
  id: string;
  callerId: string;
  outcome: Outcome;
  consultType: ConsultType | null;
  facts: Partial<Facts>;
  flags: string[];
};

export type Designer = { id: string; name: string };

export interface BookingRepo {
  getEnquiry(id: string): Promise<BookingEnquiry | null>;
  updateEnquiry(id: string, patch: { outcome?: Outcome; flags?: string[]; assignedDesignerId?: string }): Promise<void>;
  setCallerName(callerId: string, name: string): Promise<void>;
  // Active designers for the type, fewest upcoming bookings first, then least recently assigned.
  designersFor(consultType: ConsultType, now: Date): Promise<Designer[]>;
  insertBooking(booking: {
    enquiryId: string;
    calcomUid: string;
    consultType: ConsultType;
    startAt: Date;
    endAt: Date;
    designerId: string | null;
  }): Promise<void>;
  createTask(task: TaskInput): Promise<{ id: string }>;
}

export type BookingDeps = {
  repo: BookingRepo;
  calendar: CalcomClient;
  now: () => Date;
  settings: () => Promise<{ rules: RulesConfig; values: Record<string, unknown> }>;
};
