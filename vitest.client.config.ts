import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest finds these files itself on Windows and POSIX. Do not pass a shell
// wildcard from package.json; PowerShell leaves it literal and returns no tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
