import { defineConfig } from "vitest/config";

// Vitest finds these files itself on Windows and POSIX. Do not pass a shell
// wildcard from package.json; PowerShell leaves it literal and returns no tests.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
