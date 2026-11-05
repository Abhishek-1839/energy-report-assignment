import { readFileSync } from "node:fs";
import { parseLine } from "./decode.js";
import { buildReport } from "./report.js";

function main(argv: string[]): void {
  const path = argv[2];
  if (!path) {
    console.error("usage: npm start -- <telemetry.jsonl> > output.json");
    process.exit(2);
  }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  const report = buildReport(lines.map(parseLine));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

try {
  main(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
