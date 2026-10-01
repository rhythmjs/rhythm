#!/usr/bin/env bun
import { toCliHandler } from "@rhythmjs/cli/run";
import { app } from "./app";

process.exitCode = await toCliHandler(app)(process.argv.slice(2));
await app.teardown();
