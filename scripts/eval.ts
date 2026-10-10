// Usage: npm run eval -- <name> [--budget-inr 300] [--key value]
import { Budget } from "../src/evals/budget";
import { EVALS } from "../src/evals/registry";
import { summarise, writeReportFile } from "../src/evals/report";

function parseArgs(argv: string[]) {
  const [name, ...rest] = argv;
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[token.slice(2)] = true;
    } else {
      args[token.slice(2)] = next;
      i += 1;
    }
  }
  return { name, args };
}

async function main() {
  const { name, args } = parseArgs(process.argv.slice(2));
  const runner = name ? EVALS[name] : undefined;
  if (!runner) {
    console.error(`Unknown eval "${name ?? ""}". Available: ${Object.keys(EVALS).join(", ")}`);
    process.exit(2);
  }
  const cap = Number(args["budget-inr"] ?? process.env.EVAL_BUDGET_INR ?? 300);
  const report = await runner({ budget: new Budget(cap), args });
  const path = writeReportFile(report);
  console.log(summarise(report));
  console.log(`report: ${path}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
