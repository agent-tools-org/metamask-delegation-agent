import * as fs from "node:fs";
import * as path from "node:path";
import solc from "solc";

export interface CompileResult {
  abi: unknown[];
  bytecode: string;
  contractName: string;
}

/**
 * Compile a Solidity source file and return ABI + bytecode for each contract.
 * Uses the solc JSON input/output interface.
 */
export function compileSolidity(sourcePath: string): CompileResult[] {
  const absolutePath = path.resolve(sourcePath);
  const source = fs.readFileSync(absolutePath, "utf-8");
  const fileName = path.basename(absolutePath);

  const input = {
    language: "Solidity",
    sources: {
      [fileName]: { content: source },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const severe = output.errors.filter(
      (e: { severity: string }) => e.severity === "error",
    );
    if (severe.length > 0) {
      const messages = severe.map(
        (e: { formattedMessage: string }) => e.formattedMessage,
      );
      throw new Error(`Solidity compilation failed:\n${messages.join("\n")}`);
    }
  }

  const results: CompileResult[] = [];
  const fileContracts = output.contracts?.[fileName] ?? {};

  for (const [contractName, contractData] of Object.entries(fileContracts)) {
    const contract = contractData as {
      abi: unknown[];
      evm: { bytecode: { object: string } };
    };
    results.push({
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
      contractName,
    });
  }

  return results;
}

/**
 * Compile and write artifacts to the given output directory.
 * Returns the list of written artifact paths.
 */
export function compileAndWrite(
  sourcePath: string,
  outDir: string,
): string[] {
  const contracts = compileSolidity(sourcePath);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const written: string[] = [];
  for (const c of contracts) {
    const artifactPath = path.join(outDir, `${c.contractName}.json`);
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({ contractName: c.contractName, abi: c.abi, bytecode: c.bytecode }, null, 2),
    );
    written.push(artifactPath);
  }

  return written;
}

/* --- CLI entry point --- */
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\.ts$/, "") ===
    path.resolve(new URL(import.meta.url).pathname).replace(/\.ts$/, "");

if (isDirectRun) {
  const contractsDir = path.resolve("contracts");
  const outDir = path.resolve("artifacts");

  const solFiles = fs.readdirSync(contractsDir).filter((f) => f.endsWith(".sol"));

  if (solFiles.length === 0) {
    console.log("No .sol files found in contracts/");
    process.exit(0);
  }

  for (const file of solFiles) {
    const srcPath = path.join(contractsDir, file);
    console.log(`Compiling ${file}...`);
    const paths = compileAndWrite(srcPath, outDir);
    for (const p of paths) {
      console.log(`  ✓ ${path.relative(".", p)}`);
    }
  }

  console.log("Done.");
}
