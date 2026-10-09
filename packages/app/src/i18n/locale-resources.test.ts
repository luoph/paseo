import { describe, expect, it } from "vitest";
import { i18n } from "./i18next";

describe("deferred locale resources", () => {
  it("keeps English registered without loading another locale", () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(false);
    expect(i18n.t("settings.loading")).toBe("Loading settings...");
  });

  it("loads a non-English bundle before changeLanguage resolves", async () => {
    await i18n.changeLanguage("fr");

    expect(i18n.language).toBe("fr");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
    expect(i18n.t("settings.loading")).not.toBe("Loading settings...");
    expect(i18n.t("settings.loading")).not.toBe("settings.loading");

    await i18n.changeLanguage("zh-CN");
    expect(i18n.hasResourceBundle("zh-CN", "translation")).toBe(true);
    expect(i18n.t("settings.addHost")).not.toBe("Add host");

    await i18n.changeLanguage("en");
    expect(i18n.t("settings.loading")).toBe("Loading settings...");
  });
});
