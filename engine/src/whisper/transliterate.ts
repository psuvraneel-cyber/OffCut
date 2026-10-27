/**
 * Devanagari to Roman Hinglish Phonetic Transliterator.
 * Zero external dependencies. Converts Devanagari script tokens into natural, readable
 * Roman script (Hinglish) while preserving English loanwords, casing, and punctuation.
 */

const VOWELS: Record<string, string> = {
  "अ": "a",
  "आ": "aa",
  "इ": "i",
  "ई": "ee",
  "उ": "u",
  "ऊ": "oo",
  "ऋ": "ri",
  "ए": "e",
  "ऐ": "ai",
  "ओ": "o",
  "औ": "au",
};

const MATRAS: Record<string, string> = {
  "ा": "a",
  "ि": "i",
  "ी": "ee",
  "ु": "u",
  "ू": "oo",
  "ृ": "ri",
  "े": "e",
  "ै": "ai",
  "ो": "o",
  "ौ": "au",
};

const CONSONANTS: Record<string, string> = {
  "क": "k",
  "ख": "kh",
  "ग": "g",
  "घ": "gh",
  "ङ": "ng",
  "च": "ch",
  "छ": "chh",
  "ज": "j",
  "झ": "jh",
  "ञ": "ny",
  "ट": "t",
  "ठ": "th",
  "ड": "d",
  "ढ": "dh",
  "ण": "n",
  "त": "t",
  "थ": "th",
  "द": "d",
  "ध": "dh",
  "न": "n",
  "प": "p",
  "फ": "ph",
  "ब": "b",
  "भ": "bh",
  "म": "m",
  "य": "y",
  "र": "r",
  "ल": "l",
  "व": "v",
  "श": "sh",
  "ष": "sh",
  "स": "s",
  "ह": "h",
  // Common conjuncts
  "क्ष": "ksh",
  "त्र": "tr",
  "ज्ञ": "gya",
};

// Common Nukta forms in Hindi / Urdu loanwords
const NUKTA_CONSONANTS: Record<string, string> = {
  "क़": "q",
  "ख़": "kh",
  "ग़": "gh",
  "ज़": "z",
  "ड़": "r",
  "ढ़": "rh",
  "फ़": "f",
};

// Common conversational words with standardized colloquial Hinglish spellings
const COLLOQUIAL_MAP: Record<string, string> = {
  "हम": "hum",
  "और": "aur",
  "एक": "ek",
  "घर": "ghar",
  "देखने": "dekhne",
  "दिखाने": "dikhane",
  "लगा": "laga",
  "लगे": "lage",
  "गया": "gaya",
  "गए": "gaye",
  "गयी": "gayi",
  "था": "tha",
  "थी": "thi",
  "थे": "the",
  "है": "hai",
  "हैं": "hain",
  "हो": "ho",
  "हूं": "hoon",
  "हूँ": "hoon",
  "क्या": "kya",
  "क्यों": "kyun",
  "कैसे": "kaise",
  "कहा": "kaha",
  "कहाथा": "kaha tha",
  "बोला": "bola",
  "बोली": "boli",
  "बोले": "bole",
  "बहुत": "bahut",
  "नहीं": "nahi",
  "नही": "nahi",
  "नमस्ते": "namaste",
  "दोस्तों": "dosto",
  "दोस्तो": "dosto",
  "भाई": "bhai",
  "लोग": "log",
  "बात": "baat",
  "कुछ": "kuch",
  "सब": "sab",
  "सबको": "sabko",
  "पैसा": "paisa",
  "पैसे": "paise",
  "काम": "kaam",
  "हाल": "haal",
  "कर": "kar",
  "करना": "karna",
  "करते": "karte",
  "करती": "karti",
  "करूंगा": "karunga",
  "करूँगा": "karunga",
  "करेंगे": "karenge",
  "रहा": "raha",
  "रही": "rahi",
  "रहे": "rahe",
  "आया": "aaya",
  "जाएगा": "jaayega",
};

const VIRAMA = "्";
const NUKTA = "़";
const ANUSVARA = "ं";
const CANDRABINDU = "ँ";
const VISARGA = "ः";

/**
 * Transliterates a single Devanagari word into Roman script.
 */
export function transliterateWord(word: string): string {
  // 1. Check exact colloquial dictionary first for natural Hinglish spelling
  const trimmed = word.trim();
  const lowerMatch = COLLOQUIAL_MAP[trimmed];
  if (lowerMatch) {
    return lowerMatch;
  }

  // If word does not contain Devanagari, return as-is
  if (!/[\u0900-\u097F]/.test(word)) {
    return word;
  }

  let result = "";
  const chars = Array.from(word);
  const len = chars.length;

  for (let i = 0; i < len; i++) {
    const ch = chars[i];
    const next = i + 1 < len ? chars[i + 1] : "";
    const afterNext = i + 2 < len ? chars[i + 2] : "";

    // Handle Nukta combination (e.g. क + ़ = क़)
    if (next === NUKTA) {
      const combined = ch + next;
      const nuktaChar = NUKTA_CONSONANTS[combined] ?? CONSONANTS[ch] ?? "";
      i++; // Skip nukta

      // Check if followed by virama (suppress vowel)
      if (afterNext === VIRAMA) {
        result += nuktaChar;
        i++; // Skip virama
      } else if (afterNext in MATRAS) {
        result += nuktaChar + MATRAS[afterNext];
        i++; // Skip matra
      } else {
        // Schwa at end of word is deleted in Hindi
        const isEndOfWord = i + 1 >= len || !/[\u0900-\u097F]/.test(chars[i + 1]);
        result += isEndOfWord ? nuktaChar : nuktaChar + "a";
      }
      continue;
    }

    // Independent Vowel
    if (ch in VOWELS) {
      result += VOWELS[ch];
      continue;
    }

    // Matra on previous consonant
    if (ch in MATRAS) {
      result += MATRAS[ch];
      continue;
    }

    // Consonant
    if (ch in CONSONANTS) {
      const romanConsonant = CONSONANTS[ch];

      if (next === VIRAMA) {
        // Halant suppresses the inherent 'a'
        result += romanConsonant;
        i++; // Skip virama
      } else if (next in MATRAS) {
        // Matra replaces inherent 'a'
        result += romanConsonant + MATRAS[next];
        i++; // Skip matra
      } else {
        // Inherent 'a' handling:
        // Hindi applies schwa deletion at word boundaries:
        const isEndOfWord = i + 1 >= len || !/[\u0900-\u097F]/.test(next);
        result += isEndOfWord ? romanConsonant : romanConsonant + "a";
      }
      continue;
    }

    // Anusvara / Chandrabindu (nasal sound)
    if (ch === ANUSVARA || ch === CANDRABINDU) {
      result += "n";
      continue;
    }

    // Visarga (aspirated h)
    if (ch === VISARGA) {
      result += "h";
      continue;
    }

    // Virama standalone
    if (ch === VIRAMA) {
      continue;
    }

    // Any punctuation, digit, or non-Devanagari char remains untouched
    result += ch;
  }

  return result;
}

/**
 * Transliterates a full sentence from Devanagari into natural Romanized Hinglish,
 * keeping existing English words, numbers, and punctuation intact.
 */
export function transliterateDevanagariToHinglish(text: string): string {
  if (!/[\u0900-\u097F]/.test(text)) {
    return text;
  }

  // Split on whitespace or sentence boundaries while preserving delimiter spacing
  return text.replace(/[\u0900-\u097F]+/g, (match) => {
    return transliterateWord(match);
  });
}
