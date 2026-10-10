import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolRoute } from "../../../src/lib/tools/route";

const SECRET = "test-tool-secret";
const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));

function request(body: string, key?: string) {
  return new Request("http://localhost/api/vaani/tools/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-tool-key": key } : {}) },
    body,
  });
}

beforeEach(() => {
  process.env.TOOL_SECRET = SECRET;
  handler.mockClear();
});
afterEach(() => {
  delete process.env.TOOL_SECRET;
});

describe("toolRoute", () => {
  it("rejects a missing key with 401 and never calls the handler", async () => {
    const response = await toolRoute(handler)(request("{}"));
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a wrong key with 401", async () => {
    expect((await toolRoute(handler)(request("{}", "wrong"))).status).toBe(401);
  });

  it("rejects everything when the server has no secret configured", async () => {
    delete process.env.TOOL_SECRET;
    expect((await toolRoute(handler)(request("{}", SECRET))).status).toBe(401);
  });

  it("returns 400 with a spoken retry line for a non-JSON body", async () => {
    const response = await toolRoute(handler)(request("not json", SECRET));
    expect(response.status).toBe(400);
    expect((await response.json()).say_line).toMatch(/say that again/);
  });

  it("returns 500 with a spoken fallback when the handler throws", async () => {
    const failing = vi.fn(async () => {
      throw new Error("db down");
    });
    const response = await toolRoute(failing)(request("{}", SECRET));
    expect(response.status).toBe(500);
    expect((await response.json()).say_line).toMatch(/call you back/);
  });
});
