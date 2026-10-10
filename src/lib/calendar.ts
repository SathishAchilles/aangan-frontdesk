// Cal.com API v2 client: available slots, bookings, cancellation. Plain fetch with a timeout,
// because mid-call tools must answer inside Vaani's 2-3 second window.

const BASE = "https://api.cal.com/v2";
// The slots route used here answers only without a version header (newer versions moved it).
const VERSIONS = { slots: "", bookings: "2024-08-13", eventTypes: "2024-06-14" } as const;

export type CalSlot = { start: string }; // ISO with offset, e.g. 2026-12-14T11:00:00.000+05:30

export type CalBooking = { uid: string; start: string; end: string; status: string };

export class CalcomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CalcomError";
  }
}

export type CalcomClient = {
  availableSlots(eventTypeId: number, startUtc: string, endUtc: string, timeZone: string): Promise<CalSlot[]>;
  createBooking(input: {
    eventTypeId: number;
    startUtc: string;
    name: string;
    phone: string;
    email?: string;
    timeZone: string;
    metadata?: Record<string, string>;
    // Site and principal visits take place at the caller's address.
    attendeeAddress?: string;
  }): Promise<CalBooking>;
  cancelBooking(uid: string, reason: string): Promise<void>;
};

async function call<T>(apiKey: string, version: string, path: string, init: RequestInit = {}, timeoutMs = 2500): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(version ? { "cal-api-version": version } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: { status?: string; data?: T; error?: { message?: string; code?: string } } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new CalcomError(`Cal.com returned non-JSON (${response.status})`, response.status);
  }
  if (!response.ok || body.status === "error") {
    throw new CalcomError(body.error?.message ?? `Cal.com error ${response.status}`, response.status, body.error?.code);
  }
  return body.data as T;
}

export function createCalcomClient(apiKey: string): CalcomClient {
  return {
    async availableSlots(eventTypeId, startUtc, endUtc, timeZone) {
      const query = new URLSearchParams({ eventTypeId: String(eventTypeId), startTime: startUtc, endTime: endUtc, timeZone });
      const data = await call<{ slots: Record<string, { time: string }[]> }>(apiKey, VERSIONS.slots, `/slots/available?${query}`);
      return Object.keys(data.slots ?? {})
        .sort()
        .flatMap((day) => data.slots[day].map((slot) => ({ start: slot.time })));
    },

    async createBooking(input) {
      const body = {
        start: input.startUtc,
        eventTypeId: input.eventTypeId,
        attendee: {
          name: input.name,
          timeZone: input.timeZone,
          phoneNumber: input.phone,
          language: "en",
          ...(input.email ? { email: input.email } : {}),
        },
        bookingFieldsResponses: { attendeePhoneNumber: input.phone },
        ...(input.attendeeAddress ? { location: { type: "attendeeAddress", address: input.attendeeAddress } } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      return call<CalBooking>(apiKey, VERSIONS.bookings, "/bookings", { method: "POST", body: JSON.stringify(body) }, 4000);
    },

    async cancelBooking(uid, reason) {
      await call(apiKey, VERSIONS.bookings, `/bookings/${encodeURIComponent(uid)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancellationReason: reason }),
      });
    },
  };
}
