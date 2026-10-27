import { describe, expect, it } from "vitest";
import {
  transliterateDevanagariToHinglish,
  transliterateWord,
} from "../src/whisper/transliterate";

describe("Devanagari to Hinglish transliterator", () => {
  it("translates colloquial conversational Hindi words accurately", () => {
    expect(transliterateWord("हम")).toBe("hum");
    expect(transliterateWord("और")).toBe("aur");
    expect(transliterateWord("घर")).toBe("ghar");
    expect(transliterateWord("देखने")).toBe("dekhne");
    expect(transliterateWord("लगा")).toBe("laga");
    expect(transliterateWord("नमस्ते")).toBe("namaste");
    expect(transliterateWord("दोस्तों")).toBe("dosto");
    expect(transliterateWord("क्या")).toBe("kya");
  });

  it("transliterates full sentences containing Hindi and mixed English words", () => {
    const input = "हम गए घर देखने broker एक";
    const expected = "hum gaye ghar dekhne broker ek";
    expect(transliterateDevanagariToHinglish(input)).toBe(expected);
  });

  it("handles English text untouched", () => {
    const english = "This is 100% pure English text with broker, flat, and ULC.";
    expect(transliterateDevanagariToHinglish(english)).toBe(english);
  });

  it("handles matras, conjuncts, and punctuation properly", () => {
    expect(transliterateDevanagariToHinglish("नमस्ते!")).toBe("namaste!");
    expect(transliterateDevanagariToHinglish("क्या हाल है?")).toBe("kya haal hai?");
  });

  it("transliterates stand-up comedy conversational dialogue accurately", () => {
    const input = "अरे यार मतलब मैं वहां स्टेज पर गया और ऑडियंस हंसने लगी";
    const expected = "arey yaar matlab main wahan stage par gaya aur audience hansne lagi";
    expect(transliterateDevanagariToHinglish(input)).toBe(expected);
  });
});
