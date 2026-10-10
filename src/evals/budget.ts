// Tracks model spend during an eval run and stops it at the cap.

// USD per million tokens. Check https://ai.google.dev/gemini-api/docs/pricing before relying on these.
export const MODEL_PRICES_USD_PER_M: Record<string, { input: number; output: number }> = {
  // Promotional price until 2026-12-31; doubles to 1.5 / 7.5 from 2027-01-01.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
};

export const INR_PER_USD = 88;

export class BudgetExceededError extends Error {
  constructor(spentInr: number, capInr: number) {
    super(`Eval budget exceeded: spent Rs ${spentInr.toFixed(2)} of Rs ${capInr}`);
    this.name = "BudgetExceededError";
  }
}

export class Budget {
  private spent = 0;

  constructor(readonly capInr: number) {}

  get spentInr(): number {
    return this.spent;
  }

  costInr(model: string, inputTokens: number, outputTokens: number): number {
    const price = MODEL_PRICES_USD_PER_M[model];
    if (!price) throw new Error(`No price configured for model ${model}`);
    const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
    return usd * INR_PER_USD;
  }

  charge(model: string, inputTokens: number, outputTokens: number): number {
    const cost = this.costInr(model, inputTokens, outputTokens);
    this.spent += cost;
    if (this.spent > this.capInr) throw new BudgetExceededError(this.spent, this.capInr);
    return cost;
  }
}
