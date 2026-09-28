export interface ParsedArgv {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let rawMode = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (rawMode) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      rawMode = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        flags[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
        continue;
      }
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const name = token.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}
