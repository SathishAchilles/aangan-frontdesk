// Reference data seeded into the database. Admins can edit all of it later.

export type LocalitySeed = { name: string; aliases: string[]; status: "in" | "out"; note?: string };

// services.md lines 30-32, plus areas named in the case transcripts.
export const LOCALITIES: LocalitySeed[] = [
  // Pune city
  { name: "Kothrud", aliases: ["dahanukar colony", "karve nagar"], status: "in" },
  { name: "Baner", aliases: ["balewadi", "sus road"], status: "in" },
  { name: "Aundh", aliases: ["sunderban", "sundarban", "bopodi"], status: "in" },
  { name: "Wakad", aliases: [], status: "in" },
  { name: "Koregaon Park", aliases: ["kp", "koregaonpark"], status: "in" },
  { name: "Kalyani Nagar", aliases: ["kalyaninagar"], status: "in" },
  { name: "Viman Nagar", aliases: ["vimannagar"], status: "in" },
  { name: "Hadapsar", aliases: [], status: "in" },
  { name: "Magarpatta", aliases: ["magarpatta city", "cybercity", "cyber city"], status: "in" },
  { name: "NIBM", aliases: ["nibm road", "n i b m"], status: "in" },
  { name: "Kondhwa", aliases: [], status: "in" },
  { name: "Undri", aliases: [], status: "in" },
  { name: "Shivane", aliases: [], status: "in" },
  { name: "Warje", aliases: [], status: "in" },
  { name: "Erandwane", aliases: [], status: "in" },
  { name: "Deccan", aliases: ["deccan gymkhana"], status: "in" },
  { name: "Kharadi", aliases: [], status: "in", note: "Adjoining area (services.md 'and adjoining areas'); pending founder confirmation." },
  { name: "Nanded City", aliases: ["nanded"], status: "in", note: "Adjoining area; pending founder confirmation." },
  // PCMC
  { name: "Pimpri", aliases: [], status: "in" },
  { name: "Chinchwad", aliases: [], status: "in" },
  { name: "Pimple Saudagar", aliases: [], status: "in" },
  { name: "Pimple Nilakh", aliases: [], status: "in" },
  { name: "Ravet", aliases: [], status: "in" },
  { name: "Hinjewadi", aliases: ["hinjewadi phase 1", "hinjewadi phase 2", "hinjawadi"], status: "in" },
  // Outside the service area (services.md line 32)
  { name: "Talegaon", aliases: ["talegaon dabhade"], status: "out" },
  { name: "Lonavala", aliases: ["lonavla"], status: "out" },
  { name: "Nashik", aliases: ["nasik"], status: "out" },
  { name: "Mumbai", aliases: ["bombay", "navi mumbai", "thane"], status: "out" },
];

// Dates the agent may need to resolve ("before Diwali"). Verify each year before relying on them.
export const FESTIVAL_DATES: { name: string; year: number; date: string }[] = [
  { name: "Diwali", year: 2026, date: "2026-11-08" },
  { name: "Diwali", year: 2027, date: "2027-10-29" },
  { name: "Dussehra", year: 2026, date: "2026-10-20" },
  { name: "Ganesh Chaturthi", year: 2026, date: "2026-09-14" },
  { name: "Ganesh Chaturthi", year: 2027, date: "2027-09-04" },
  { name: "Christmas", year: 2026, date: "2026-12-25" },
  { name: "Christmas", year: 2027, date: "2027-12-25" },
  { name: "New Year", year: 2027, date: "2027-01-01" },
  { name: "New Year", year: 2028, date: "2028-01-01" },
];

// Placeholder people until the real roster is entered. Telegram ids are set later.
export const STAFF: { name: string; role: "admin" | "viewer" | "designer" | "front_desk"; consultTypes: string[] }[] = [
  { name: "Nikhil Deshpande (founder)", role: "admin", consultTypes: [] },
  { name: "Front desk", role: "front_desk", consultTypes: [] },
  { name: "Designer 1 (principal)", role: "designer", consultTypes: ["studio", "site", "principal"] },
  { name: "Designer 2", role: "designer", consultTypes: ["studio", "site"] },
  { name: "Designer 3", role: "designer", consultTypes: ["studio", "site"] },
];
