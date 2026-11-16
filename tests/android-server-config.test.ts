import { describe, expect, it } from "vitest";
import { parseAndroidServerConfig } from "../src/network/android-server-config";

describe("Android server settings", () => {
  it("normalizes a LAN server and database", () => {
    expect(parseAndroidServerConfig(" http://192.168.1.50:3000/ ", " sea-siege-dev ")).toEqual({ host: "http://192.168.1.50:3000", database: "sea-siege-dev" });
  });
  it("rejects loopback, paths, credentials, and missing database", () => {
    for (const host of ["http://localhost:3000", "http://127.0.0.1:3000", "http://host/path", "http://user:pass@host"]) expect(parseAndroidServerConfig(host, "db")).toBeNull();
    expect(parseAndroidServerConfig("http://host", " ")).toBeNull();
  });
});
