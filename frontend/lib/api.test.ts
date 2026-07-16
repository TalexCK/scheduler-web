import { describe, expect, it } from "vitest";
import { validIdentifier, validMonthKey } from "@/lib/api";
import { offlineMinecraftStatus } from "@/lib/minecraft-status";

describe("API 参数验证", () => {
  it("只接受安全的排行榜标识符", () => {
    expect(validIdentifier("hard_3")).toBe(true);
    expect(validIdentifier("Hard-3")).toBe(false);
    expect(validIdentifier("")).toBe(false);
  });

  it("验证真实日历月份", () => {
    expect(validMonthKey("2026-01")).toBe(true);
    expect(validMonthKey("2026-12")).toBe(true);
    expect(validMonthKey("2026-00")).toBe(false);
    expect(validMonthKey("2026-13")).toBe(false);
  });

  it("状态探测失败时不泄露内部错误", () => {
    expect(offlineMinecraftStatus("localhost:25565")).toMatchObject({ online: false, host: "localhost", port: 25565 });
  });
});
