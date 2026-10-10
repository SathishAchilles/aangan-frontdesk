// Every sentence the gate asks the agent to say. The agent speaks these verbatim.
// None of them may contain a cost figure (pricing.md); a test enforces this.

// pricing.md line 39: the only acceptable response to a pricing question.
export const PRICE_LINE =
  "Pricing depends on the site, the materials you choose, and the scope - your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

export const QUESTIONS = {
  C1: "Are you looking for design and full execution, or design advice?",
  C2: "Which area is the site in?",
  C3: "When would you need the project complete?",
} as const;

export type FailReason =
  | "segment"
  | "too_large"
  | "too_small"
  | "structural"
  | "service_only"
  | "C1"
  | "C2"
  | "C3"
  | "C4";

export const FAIL_LINES: Record<FailReason, string> = {
  segment:
    "Thank you for thinking of us. We focus on homes and offices, so restaurants, hotels, shops and gyms are outside what we do - they need a specialist studio. I'm sorry we can't help with this one.",
  too_large:
    "Thank you for calling. We take on offices up to about three thousand square feet, so this one is larger than we could do well. I'm sorry we can't help with it.",
  too_small:
    "Thank you for calling. Our design and execution team is set up for larger spaces, so this one is below what we could do well. A local designer who specialises in smaller spaces would suit you better.",
  structural:
    "We're interior designers rather than architects, so we don't move walls or handle structural changes. If you'd like interiors done once that work is finished, we'd be happy to help.",
  service_only:
    "Our projects always include design and execution together, so we don't offer that on its own. If you decide on a full redesign with execution, we'd love to help.",
  C1: "We're a full-service studio - our projects include design and execution together, so we don't do advice-only visits. If you decide to go ahead with a full redesign, we'd love to help.",
  C2: "We only work in Pune and PCMC at the moment, because our execution depends on our own contractors being on site. I'm sorry we can't help with this one.",
  C3: "A redesign with execution needs more time than that to be done well, and we wouldn't want to rush it. If a later start works for you, I can note your details and we can plan for that.",
  C4: "Thank you for sharing that. For the scope you've described, that would be significantly below what a project like this would cost with us, so I wouldn't want to bring you to a consultation if the numbers don't align.",
};

// qualified.md line 28, for two or more failed criteria.
export const MULTI_FAIL_LINE =
  "This sounds like it may not be the right fit for us right now - but feel free to reach out if your timeline or scope changes.";

export const EXISTING_CLIENT_LINE =
  "I'm really sorry about that. I'm passing this to a senior member of the team right now, and someone senior will call you back {when}.";

export const MESSAGE_LINE = "Thank you. I'll pass your message to our front desk team and they'll get back to you.";

export const NEEDS_HUMAN_LINE = "I'd like someone from our team to help you with this. They'll call you back {when}.";

export const ALL_SAY_LINES: string[] = [
  PRICE_LINE,
  ...Object.values(QUESTIONS),
  ...Object.values(FAIL_LINES),
  MULTI_FAIL_LINE,
  EXISTING_CLIENT_LINE,
  MESSAGE_LINE,
  NEEDS_HUMAN_LINE,
];
