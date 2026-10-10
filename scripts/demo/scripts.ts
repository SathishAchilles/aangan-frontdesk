// What demo callers say and what the agent answers, in Vaani's "[hh:mm:ss] SPEAKER: text" format.
// The agent lines reuse the studio's real wording (src/lib/rules/wording.ts): it never speaks a
// price figure and never asks about budget. Only the two safety-check stories break that rule, on
// purpose, so the grader flags have something to show.
import { FAIL_LINES, MESSAGE_LINE, NEEDS_HUMAN_LINE, PRICE_LINE, QUESTIONS } from "../../src/lib/rules/wording";

export type Turn = ["AGENT" | "USER", string];

export const GREETING = "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded. How can I help you today?";

export type Persona = {
  first: string;
  locality: string;
  home: string; // "3BHK", "villa"
  sqft: number;
  scope: string; // "the whole 3BHK, with a modular kitchen and wardrobes"
  deadline: string; // "before Diwali next year"
  decider: string | null; // "my wife and I decide together"
  style: string | null;
  referral: string | null;
  askedPrice: boolean;
  siteVisit: boolean;
  booked: boolean;
  consult: "studio" | "site" | "principal";
};

const CONSULT_WORDS = {
  studio: "a consultation at our studio in Baner",
  site: "a site visit by one of our designers",
  principal: "a visit from our principal designer",
} as const;

export function qualifiedTurns(p: Persona, notes: "none" | "decider" | "behalf"): Turn[] {
  const turns: Turn[] = [
    ["AGENT", GREETING],
    ["USER", `Hi, I'm ${p.first}. We've just taken possession of a ${p.home} in ${p.locality} and we want to get the interiors done.`],
    ["AGENT", `Congratulations on the new home, ${p.first}. Could you tell me a little about what you'd like done?`],
    ["USER", `${p.scope[0].toUpperCase()}${p.scope.slice(1)}. It's about ${p.sqft.toLocaleString("en-IN")} square feet.`],
    ["AGENT", QUESTIONS.C1],
    ["USER", "Design and execution both. We don't want to manage contractors ourselves."],
    ["AGENT", QUESTIONS.C3],
    ["USER", `Ideally ${p.deadline}.`],
  ];
  if (p.style) turns.push(["AGENT", "That works well. Do you have a style in mind?"], ["USER", p.style]);
  if (p.referral) turns.push(["USER", `By the way, ${p.referral}.`], ["AGENT", "That's lovely to hear, thank you for telling me."]);
  if (p.askedPrice) turns.push(["USER", "Roughly what does something like this cost?"], ["AGENT", PRICE_LINE]);
  if (notes === "decider") turns.push(["AGENT", "Who else will be part of the decision on the design?"], ["USER", "I'm not sure yet, we'll see."]);
  if (notes === "behalf") turns.push(["USER", "Actually I'm calling for my parents, it's their flat. They'll decide."], ["AGENT", "Of course. It would be good to have them at the consultation."]);
  if (notes === "none" && p.decider) turns.push(["AGENT", "Who else will be part of the decision on the design?"], ["USER", `${p.decider[0].toUpperCase()}${p.decider.slice(1)}.`]);
  turns.push(
    ["AGENT", `Thank you, that's everything I need. The next step is ${CONSULT_WORDS[p.consult]}. Shall I book the earliest slot for you?`],
    ...(p.booked
      ? ([
          ["USER", p.siteVisit ? "Yes, please. Someone seeing the flat in person would really help." : "Yes, that works."],
          ["AGENT", "Done. You'll get a confirmation on WhatsApp with the date and time, and a designer from our team will call you before then. Is there anything else I can help with?"],
        ] as Turn[])
      : ([
          ["USER", "I need to check dates with my family first. Can someone call me?"],
          ["AGENT", "Of course. A designer from our team will call you to find a time that suits you. Is there anything else I can help with?"],
        ] as Turn[])),
    ["USER", "No, that's all. Thank you!"],
    ["AGENT", "Thank you for calling Aangan Studio. Have a lovely day."],
  );
  return turns;
}

// The two safety-check stories: the agent slips once. The grader flags exactly that line.
export function slipTurns(p: Persona, slip: "price" | "budget"): Turn[] {
  const turns = qualifiedTurns({ ...p, askedPrice: false }, "none");
  const at = turns.length - 5;
  const extra: Turn[] =
    slip === "price"
      ? [
          ["USER", "Can you give me a ballpark? Even roughly."],
          ["AGENT", "Most full-home projects of this size come to around eight lakh, but your designer will confirm at the consultation."],
        ]
      : [
          ["USER", "We want it done properly, not cheaply."],
          ["AGENT", "Understood. What budget do you have in mind for the project?"],
          ["USER", "I'd rather discuss that with the designer."],
          ["AGENT", "Of course, that's completely fine."],
        ];
  return [...turns.slice(0, at), ...extra, ...turns.slice(at)];
}

export type NotQualifiedReason = "C1" | "C2" | "C3" | "C4" | "segment" | "structural" | "too_large";

export function notQualifiedTurns(first: string, reason: NotQualifiedReason, detail: { locality: string; home: string }): Turn[] {
  const open: Turn[] = [["AGENT", GREETING]];
  const close: Turn[] = [["USER", "Okay, I understand. Thanks anyway."], ["AGENT", "Thank you for calling Aangan Studio, and all the best with the project."]];
  const line = (key: keyof typeof FAIL_LINES): Turn => ["AGENT", FAIL_LINES[key]];
  switch (reason) {
    case "C1":
      return [
        ...open,
        ["USER", `Hi, this is ${first}. I have a ${detail.home} in ${detail.locality}. We'll do the work ourselves with our own carpenter, I just want someone to come and give us ideas.`],
        ["AGENT", QUESTIONS.C1],
        ["USER", "Just the advice, really. A one-time visit."],
        line("C1"),
        ...close,
      ];
    case "C2":
      return [
        ...open,
        ["USER", `Hello, I'm ${first}. We have a ${detail.home} in ${detail.locality} and we're looking for a full interior job, design and execution.`],
        ["AGENT", `Thank you. Just to confirm, the site is in ${detail.locality}?`],
        ["USER", `Yes, in ${detail.locality}. Is that a problem?`],
        line("C2"),
        ...close,
      ];
    case "C3":
      return [
        ...open,
        ["USER", `Hi, ${first} here. We need our ${detail.home} in ${detail.locality} done up completely, kitchen, wardrobes, everything.`],
        ["AGENT", QUESTIONS.C3],
        ["USER", "We're moving in about three weeks, so it has to be finished before that."],
        line("C3"),
        ["USER", "Maybe. Things might move after the move-in."],
        ["AGENT", "I've noted that. Thank you for calling Aangan Studio."],
      ];
    case "C4":
      return [
        ...open,
        ["USER", `Hello, I'm ${first}. I want my ${detail.home} in ${detail.locality} fully done, all rooms, with execution.`],
        ["AGENT", QUESTIONS.C3],
        ["USER", "Sometime next year is fine. We have about two lakh for the whole flat."],
        line("C4"),
        ...close,
      ];
    case "segment":
      return [
        ...open,
        ["USER", `Hi, this is ${first}. I'm opening a small cafe in ${detail.locality} and want the interiors designed and built.`],
        line("segment"),
        ...close,
      ];
    case "structural":
      return [
        ...open,
        ["USER", `Hello, ${first} here. In our ${detail.home} in ${detail.locality} we want to knock down the wall between the kitchen and the hall and add a beam.`],
        ["AGENT", "Is it only the wall you'd like changed, or the interiors as well?"],
        ["USER", "Just the wall for now."],
        line("structural"),
        ...close,
      ];
    case "too_large":
      return [
        ...open,
        ["USER", `Hi, I'm ${first} from a software company. We're fitting out a new office in ${detail.locality}, around eight thousand square feet.`],
        line("too_large"),
        ...close,
      ];
  }
}

export function needsHumanTurns(first: string, locality: string, when: string): Turn[] {
  return [
    ["AGENT", GREETING],
    ["USER", `Hi, I'm ${first}. We have a duplex in ${locality} and a few complicated questions. Can I talk to a person, please?`],
    ["AGENT", "Of course. May I ask what it's about, so the right person calls you?"],
    ["USER", "Joining two flats and redoing both. I'd rather explain it to someone directly."],
    ["AGENT", NEEDS_HUMAN_LINE.replace("{when}", when)],
    ["USER", "Great, thank you."],
    ["AGENT", "Thank you for calling Aangan Studio."],
  ];
}

export function existingClientTurns(first: string, issue: string, when: string, repeat: boolean): Turn[] {
  return [
    ["AGENT", GREETING],
    ["USER", repeat ? `Hi, it's ${first} again. I called earlier about ${issue} and nobody has come yet.` : `Hello, this is ${first}. You're doing our flat right now and ${issue}.`],
    ["AGENT", `I'm really sorry about that. I've passed this to a senior member of the team, and someone senior will call you back ${when}.`],
    ["USER", repeat ? "Please make sure they do. This is the second time." : "Okay. Please make it quick."],
    ["AGENT", "I understand, and I've marked it as urgent. Thank you for your patience."],
  ];
}

export function messageTurns(first: string, about: "vendor" | "job" | "reschedule"): Turn[] {
  const ask = {
    vendor: `Hello, this is ${first} from a laminates distributor in Bhosari. We have a new catalogue and I wanted to drop off samples for your designers.`,
    job: `Hi, I'm ${first}. I've just finished my interior design course and wanted to ask whether the studio is hiring juniors or interns.`,
    reschedule: `Hi, it's ${first}. I have a consultation booked with you and I need to move it to another day.`,
  }[about];
  return [
    ["AGENT", GREETING],
    ["USER", ask],
    ["AGENT", MESSAGE_LINE],
    ["USER", "Thank you."],
    ["AGENT", "Thank you for calling Aangan Studio."],
  ];
}

export function droppedTurns(first: string | null, locality: string): Turn[] {
  return [
    ["AGENT", GREETING],
    ["USER", `Hi${first ? `, I'm ${first}` : ""}. I'm calling about interiors for our flat in ${locality}, we just`],
    ["AGENT", "Sorry, I think the line broke up. Could you say that again?"],
  ];
}

export function callbackTurns(first: string): Turn[] {
  return [
    ["AGENT", `Hello, this is the AI assistant from Aangan Studio calling back, as our call earlier got cut off. Is this a good time, ${first}?`],
    ["USER", "Oh, I'm driving right now. Can I call you back this evening?"],
    ["AGENT", "Of course. You can call this number any time, and we'll pick up where we left off. Drive safely."],
  ];
}

export function renderTranscript(turns: Turn[], startIst: { hour: number; minute: number }, seconds: number): string {
  const step = Math.max(4, Math.floor(seconds / Math.max(1, turns.length)));
  return turns
    .map(([speaker, text], index) => {
      const total = startIst.hour * 3600 + startIst.minute * 60 + 2 + index * step;
      const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      return `[${hh}:${mm}:${ss}] ${speaker}: ${text}`;
    })
    .join("\n\n");
}
