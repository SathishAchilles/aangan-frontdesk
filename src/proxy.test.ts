import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("proxy", () => {
  it("redirects an anonymous dashboard request to login with the page to return to", async () => {
    const { proxy, config } = await import("./proxy");
    const response = await proxy(new NextRequest("https://aangan-frontdesk.vercel.app/dashboard/settings"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://aangan-frontdesk.vercel.app/login?next=%2Fdashboard%2Fsettings");
    expect(config.matcher).toEqual(["/dashboard/:path*", "/designer/:path*"]);
  });

  it("protects the designer area the same way", async () => {
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest("https://aangan-frontdesk.vercel.app/designer/leads"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://aangan-frontdesk.vercel.app/login?next=%2Fdesigner%2Fleads");
  });
});
