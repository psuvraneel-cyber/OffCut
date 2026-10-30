import { describe, expect, it } from "vitest";
import {
  countForeignScriptWords,
  detectWordScript,
  filterForeignScriptWords,
  hasForeignScript,
  isWordAllowedInLanguage,
} from "../src/whisper/script";

describe("script detection and sanity filter", () => {
  it("detects script types correctly", () => {
    expect(detectWordScript("hello")).toBe("latin");
    expect(detectWordScript("World123")).toBe("latin");
    expect(detectWordScript("नमस्ते")).toBe("devanagari");
    expect(detectWordScript("घर")).toBe("devanagari");
    expect(detectWordScript("میں")).toBe("perso_arabic"); // Urdu 'mein'
    expect(detectWordScript("دیکھانے")).toBe("perso_arabic"); // Urdu 'dikhane'
    expect(detectWordScript("யுஎல்சி")).toBe("tamil"); // Tamil 'ULC'
    expect(detectWordScript("12345")).toBe("symbol");
    expect(detectWordScript("...")).toBe("symbol");
    // Chinese and Cyrillic mixed tokens should be detected as "other"
    expect(detectWordScript("似乎")).toBe("other");
    expect(detectWordScript("र議")).toBe("other");
    expect(detectWordScript("चИचै")).toBe("other");
  });

  it("identifies foreign script presence", () => {
    // Exact text from user's bug report:
    const urduHallucination = "میں ہم اور لگیا دیکھانے گھر مرہو بروکر ایک";
    const tamilPrefix = "யுஎல்சி";

    expect(hasForeignScript(urduHallucination, "hi")).toBe(true);
    expect(hasForeignScript(urduHallucination, "hinglish")).toBe(true);
    expect(hasForeignScript(urduHallucination, "en")).toBe(true);
    expect(hasForeignScript(tamilPrefix, "hi")).toBe(true);

    // Clean Hindi text:
    expect(hasForeignScript("हम गए घर देखने ब्रोकर एक", "hi")).toBe(false);
    expect(hasForeignScript("हम गए घर देखने ब्रोकर एक", "hinglish")).toBe(false);
    expect(hasForeignScript("हम गए घर देखने", "en")).toBe(true); // Devanagari in pure English mode

    // Clean English text:
    expect(hasForeignScript("Hello this is a test", "en")).toBe(false);
    expect(hasForeignScript("Hello this is a test", "hi")).toBe(false);
  });

  it("checks whether words are allowed in target language", () => {
    // English mode
    expect(isWordAllowedInLanguage("Hello", "en")).toBe(true);
    expect(isWordAllowedInLanguage("broker", "en")).toBe(true);
    expect(isWordAllowedInLanguage("नमस्ते", "en")).toBe(false);
    expect(isWordAllowedInLanguage("میں", "en")).toBe(false);

    // Hindi mode
    expect(isWordAllowedInLanguage("नमस्ते", "hi")).toBe(true);
    expect(isWordAllowedInLanguage("घर", "hi")).toBe(true);
    expect(isWordAllowedInLanguage("broker", "hi")).toBe(true); // English loanwords allowed
    expect(isWordAllowedInLanguage("میں", "hi")).toBe(false); // Urdu rejected
    expect(isWordAllowedInLanguage("யுஎல்சி", "hi")).toBe(false); // Tamil rejected

    // Hinglish mode
    expect(isWordAllowedInLanguage("Namaste", "hinglish")).toBe(true);
    expect(isWordAllowedInLanguage("broker", "hinglish")).toBe(true);
    expect(isWordAllowedInLanguage("घर", "hinglish")).toBe(true);
    expect(isWordAllowedInLanguage("میں", "hinglish")).toBe(false);
    expect(isWordAllowedInLanguage("யுஎல்சி", "hinglish")).toBe(false);
    expect(isWordAllowedInLanguage("र議", "hinglish")).toBe(false);
    expect(isWordAllowedInLanguage("चИचै", "hinglish")).toBe(false);
  });

  it("counts and filters foreign script words in window transcripts", () => {
    const rawWords = [
      { text: "யுஎல்சி" },
      { text: "میں" },
      { text: "ہم" },
      { text: "aur" },
      { text: "broker" },
      { text: "ek" },
      { text: "र議" },
      { text: "चИचै" },
    ];

    expect(countForeignScriptWords(rawWords, "hinglish")).toBe(5); // tamil + 2 urdu words + 2 cjk/cyrillic hybrid words

    const filtered = filterForeignScriptWords(rawWords, "hinglish");
    expect(filtered).toHaveLength(3);
    expect(filtered.map((w) => w.text)).toEqual(["aur", "broker", "ek"]);
  });
});
