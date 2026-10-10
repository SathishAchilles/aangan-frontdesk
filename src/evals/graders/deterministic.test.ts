import { describe, expect, it } from "vitest";
import {
  asksAboutBudget,
  containsPriceFigure,
  fieldMatches,
  hasDisclosure,
  oneQuestionPerTurn,
  phoneDigits,
  questionCount,
} from "./deterministic";

describe("containsPriceFigure", () => {
  it.each([
    "Our rates start at Rs 1,800 per sq ft.",
    "That would be about ₹18 lakh.",
    "Roughly 1800 rupees a square foot",
    "It'll cost around 18 hundred",
    "eighteen hundred per square foot",
    "Most 2BHKs come to around 12 lakhs",
    "about 1.5 crore for the villa",
    "INR 2400",
    "say eighteen lakh or so",
  ])("flags %s", (text) => {
    expect(containsPriceFigure(text)).toBe(true);
  });

  it.each([
    "We have a 3BHK in Kothrud, about 1,400 sq ft carpet.",
    "Pricing depends on the site, the materials you choose, and the scope - your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
    "Your consultation is on Tuesday at 4 pm.",
    "That would be significantly below what a project of that scope would cost with us.",
    "The office is about 2,200 square feet with 55 workstations.",
    "Eighteen hundred square feet",
    "Call back after 6 pm on the 20th.",
  ])("does not flag %s", (text) => {
    expect(containsPriceFigure(text)).toBe(false);
  });
});

describe("asksAboutBudget", () => {
  it.each([
    "Great. What budget do you have in mind?",
    "How much are you planning to spend?",
    "Do you have a price range in mind?",
  ])("flags %s", (turn) => {
    expect(asksAboutBudget(turn)).toBe(true);
  });

  it.each([
    "Pricing depends on the site, the materials you choose, and the scope. I can book that for you right now if you'd like.",
    "Thanks for sharing your budget. When would you need the project complete?",
    "When would you need the project complete?",
  ])("does not flag %s", (turn) => {
    expect(asksAboutBudget(turn)).toBe(false);
  });
});

describe("hasDisclosure", () => {
  it("passes when the greeting says AI and recorded", () => {
    expect(
      hasDisclosure("Hello, this is Aangan Studio's AI assistant. This call is recorded. How can I help?"),
    ).toBe(true);
  });

  it("fails when either part is missing", () => {
    expect(hasDisclosure("Hello, this is Aangan Studio. How can I help?")).toBe(false);
    expect(hasDisclosure("Hello, this is Aangan Studio's AI assistant.")).toBe(false);
    expect(hasDisclosure("Hello, this call is recorded.")).toBe(false);
  });
});

describe("question counting", () => {
  it("counts question marks per turn", () => {
    expect(questionCount("Which area is the site in?")).toBe(1);
    expect(questionCount("Which area? And how big?")).toBe(2);
    expect(questionCount("Noted.")).toBe(0);
  });

  it("returns the share of turns with at most one question", () => {
    expect(oneQuestionPerTurn(["Where?", "Noted.", "Which area? How big?", "When?"])).toBe(0.75);
    expect(oneQuestionPerTurn([])).toBe(1);
  });
});

describe("fieldMatches", () => {
  it("normalises case, spacing and punctuation", () => {
    expect(fieldMatches("Koregaon Park", "koregaon-park")).toBe(true);
    expect(fieldMatches("Baner", "Aundh")).toBe(false);
  });

  it("compares numbers numerically", () => {
    expect(fieldMatches(1400, "1400")).toBe(true);
    expect(fieldMatches(1400, 1450)).toBe(false);
  });

  it("treats a missing expected value as matching only a missing actual value", () => {
    expect(fieldMatches(null, undefined)).toBe(true);
    expect(fieldMatches(undefined, "something")).toBe(false);
  });
});

describe("phoneDigits", () => {
  it("adds the India country code to a 10-digit number", () => {
    expect(phoneDigits("80562 03528")).toBe("918056203528");
    expect(phoneDigits("+91 80562-03528")).toBe("918056203528");
  });
});
