import type { ExtensionMiddleware, Next } from "@rhythmjs/rhythm";

export interface RhythmPrompt {
  text(message: string, options?: { default?: string }): Promise<string>;
  confirm(message: string, options?: { default?: boolean }): Promise<boolean>;
  select<T extends string>(
    message: string,
    choices: readonly T[],
    options?: { allowCustom?: boolean },
  ): Promise<T | string>;
  multiSelect<T extends string>(
    message: string,
    choices: readonly T[],
    options?: { allowCustom?: boolean },
  ): Promise<(T | string)[]>;
}

export interface RhythmPromptIO {
  ask(this: void, query: string): Promise<string>;
  write(this: void, text: string): void;
  close?(this: void): void;
}

const CUSTOM_LABEL = "Other (type your own)";

export function createPrompt(io: RhythmPromptIO): { prompt: RhythmPrompt; close: () => void } {
  const { ask, write } = io;

  const text: RhythmPrompt["text"] = async (message, options) => {
    const suffix = options?.default ? ` (${options.default})` : "";
    const answer = (await ask(`${message}${suffix} `)).trim();
    return answer || options?.default || "";
  };

  const confirm: RhythmPrompt["confirm"] = async (message, options) => {
    const suffix = options?.default === undefined ? "(y/n)" : options.default ? "(Y/n)" : "(y/N)";
    while (true) {
      const answer = (await ask(`${message} ${suffix} `)).trim().toLowerCase();
      if (!answer && options?.default !== undefined) return options.default;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      write("Please answer y or n.\n");
    }
  };

  function listChoices<T extends string>(message: string, choices: readonly T[], allowCustom?: boolean): number {
    write(`${message}\n`);
    choices.forEach((choice, i) => write(`  ${i + 1}) ${choice}\n`));
    const customIndex = allowCustom ? choices.length + 1 : -1;
    if (allowCustom) write(`  ${customIndex}) ${CUSTOM_LABEL}\n`);
    return customIndex;
  }

  const select: RhythmPrompt["select"] = async (message, choices, options) => {
    const customIndex = listChoices(message, choices, options?.allowCustom);

    while (true) {
      const index = Number(await ask("Enter number: "));
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]!;
      if (index === customIndex) return text("Enter value:");
      write("Invalid choice, try again.\n");
    }
  };

  const multiSelect: RhythmPrompt["multiSelect"] = async (message, choices, options) => {
    const customIndex = listChoices(message, choices, options?.allowCustom);
    const maxIndex = options?.allowCustom ? customIndex : choices.length;
    write('(comma-separated numbers, e.g. "1,3")\n');

    while (true) {
      const raw = await ask("Enter numbers: ");
      const indices = raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n) => n !== 0 || raw.trim() === "0");

      const valid = indices.length > 0 && indices.every((n) => Number.isInteger(n) && n >= 1 && n <= maxIndex);

      if (!valid) {
        write("Invalid choices, try again.\n");
        continue;
      }

      const results: (string | (typeof choices)[number])[] = [];
      for (const n of indices) {
        results.push(n === customIndex ? await text("Enter value:") : choices[n - 1]!);
      }
      return results;
    }
  };

  return { prompt: { text, confirm, select, multiSelect }, close: () => io.close?.() };
}

export function createStdioPromptIO(): RhythmPromptIO {
  let lines: AsyncIterator<string> | undefined;
  return {
    ask: async (query) => {
      process.stdout.write(query);
      lines ??= console[Symbol.asyncIterator]();
      const { value } = await lines.next();
      return value ?? "";
    },
    write: (text) => {
      process.stdout.write(text);
    },
    close: () => {
      void lines?.return?.();
    },
  };
}

export function withPrompt(
  createIO: () => RhythmPromptIO = createStdioPromptIO,
): ExtensionMiddleware<{}, { prompt: RhythmPrompt }> {
  const middleware = async (ctx: { prompt?: RhythmPrompt }, next: Next) => {
    const { prompt, close } = createPrompt(createIO());
    ctx.prompt = prompt;
    try {
      await next();
    } finally {
      close();
    }
  };
  return middleware as ExtensionMiddleware<{}, { prompt: RhythmPrompt }>;
}
