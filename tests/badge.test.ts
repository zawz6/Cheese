import { describe, expect, it, vi } from "vitest";
import { applyBadge } from "@/lib/badge";

describe("applyBadge", () => {
  it("shows the count, capped at 99", async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn().mockResolvedValue(undefined) };
    await applyBadge(3, nav);
    await applyBadge(250, nav);
    expect(nav.setAppBadge.mock.calls).toEqual([[3], [99]]);
    expect(nav.clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the badge at zero", async () => {
    const nav = { setAppBadge: vi.fn(), clearAppBadge: vi.fn().mockResolvedValue(undefined) };
    await applyBadge(0, nav);
    expect(nav.clearAppBadge).toHaveBeenCalledOnce();
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });

  it("does nothing where the browser has no badge support, and never throws", async () => {
    await expect(applyBadge(2, {})).resolves.toBeUndefined();
    await expect(applyBadge(2, undefined)).resolves.toBeUndefined();
    const refusing = { setAppBadge: vi.fn().mockRejectedValue(new Error("not installed")) };
    await expect(applyBadge(2, refusing)).resolves.toBeUndefined();
  });
});
