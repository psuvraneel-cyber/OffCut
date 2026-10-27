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
  // Pronouns
  "मैं": "main",
  "हम": "hum",
  "तू": "tu",
  "तुम": "tum",
  "आप": "aap",
  "मेरा": "mera",
  "मेरी": "meri",
  "मेरे": "mere",
  "तेरा": "tera",
  "तेरी": "teri",
  "तेरे": "tere",
  "उसका": "uska",
  "उसकी": "uski",
  "उसके": "uske",
  "इनका": "inka",
  "इनकी": "inki",
  "इनके": "inke",
  "उनका": "unka",
  "उनकी": "unki",
  "उनके": "unke",
  "अपना": "apna",
  "अपनी": "apni",
  "अपने": "apne",
  "यह": "yeh",
  "ये": "yeh",
  "वह": "woh",
  "वो": "woh",
  // Common particles & conjunctions
  "और": "aur",
  "एक": "ek",
  "तो": "to",
  "भी": "bhi",
  "ही": "hi",
  "से": "se",
  "को": "ko",
  "ने": "ne",
  "पर": "par",
  "पे": "pe",
  "में": "mein",
  "का": "ka",
  "की": "ki",
  "के": "ke",
  "कि": "ki",
  // Questions & adverbs
  "क्या": "kya",
  "क्यों": "kyun",
  "कैसे": "kaise",
  "कब": "kab",
  "कहा": "kaha",
  "कहाँ": "kahan",
  "कहां": "kahan",
  "यहाँ": "yahan",
  "यहां": "yahan",
  "वहाँ": "wahan",
  "वहां": "wahan",
  "जहाँ": "jahan",
  "जहां": "jahan",
  "इधर": "idhar",
  "उधर": "udhar",
  "किधर": "kidhar",
  "जैसे": "jaise",
  "वैसे": "waise",
  "ऐसे": "aise",
  "कोई": "koi",
  "किसी": "kisi",
  "कुछ": "kuch",
  "सब": "sab",
  "सबको": "sabko",
  "बहुत": "bahut",
  "नहीं": "nahi",
  "नही": "nahi",
  "ना": "na",
  "हाँ": "haan",
  "हां": "haan",
  // Conversational & comedy slang
  "अरे": "arey",
  "यार": "yaar",
  "मतलब": "matlab",
  "लेकिन": "lekin",
  "मगर": "magar",
  "फिर": "phir",
  "भाई": "bhai",
  "लोग": "log",
  "बात": "baat",
  "बातचीत": "baatchit",
  "नमस्ते": "namaste",
  "दोस्तों": "dosto",
  "दोस्तो": "dosto",
  "हाल": "haal",
  "काम": "kaam",
  "घर": "ghar",
  "पैसा": "paisa",
  "पैसे": "paise",
  "पता": "pata",
  "अच्छा": "achha",
  "अच्छी": "achhi",
  "अच्छे": "achhe",
  "बुरा": "bura",
  "पागल": "pagal",
  "खुद": "khud",
  "सिर्फ": "sirf",
  "शायद": "shayad",
  "ज़रूर": "zaroor",
  "जरूर": "zaroor",
  "सच": "sach",
  "झूठ": "jhooth",
  "सही": "sahi",
  "गलत": "galat",
  "टाइम": "time",
  "शो": "show",
  "स्टेज": "stage",
  "ऑडियंस": "audience",
  "जोक": "joke",
  "जोक्स": "jokes",
  "कॉमेडी": "comedy",
  // Auxiliary verbs & tenses
  "था": "tha",
  "थी": "thi",
  "थे": "the",
  "है": "hai",
  "हैं": "hain",
  "हो": "ho",
  "हूं": "hoon",
  "हूँ": "hoon",
  "होगा": "hoga",
  "होगी": "hogi",
  "होंगे": "honge",
  "रहा": "raha",
  "रही": "rahi",
  "रहे": "rahe",
  "लगा": "laga",
  "लगी": "lagi",
  "लगे": "lage",
  "गया": "gaya",
  "गए": "gaye",
  "गयी": "gayi",
  "गई": "gayi",
  "आया": "aaya",
  "आए": "aaye",
  "आई": "aayi",
  "जाएगा": "jaayega",
  "जाएगी": "jaayegi",
  "जाएंगे": "jaayenge",
  // Common action verbs
  "कर": "kar",
  "करना": "karna",
  "करते": "karte",
  "करती": "karti",
  "करूंगा": "karunga",
  "करूँगा": "karunga",
  "करेंगे": "karenge",
  "किया": "kiya",
  "किए": "kiye",
  "देख": "dekh",
  "देखा": "dekha",
  "देखे": "dekhe",
  "देखी": "dekhi",
  "देखने": "dekhne",
  "दिखाने": "dikhane",
  "बोल": "bol",
  "बोला": "bola",
  "बोली": "boli",
  "बोले": "bole",
  "बोलना": "bolna",
  "बोलते": "bolte",
  "सुन": "sun",
  "सुना": "suna",
  "सुने": "sune",
  "सुनी": "suni",
  "हंस": "hans",
  "हंसी": "hansi",
  "हंसने": "hansne",
  "हंसते": "hanste",
  "समझ": "samajh",
  "समझे": "samjhe",
  "समझना": "samajhna",
  "बैठा": "baitha",
  "बैठे": "baithe",
  "बैठी": "baithi",
  "खड़ा": "khada",
  "खड़े": "khade",
  "खड़ी": "khadi",
  "चला": "chala",
  "चले": "chale",
  "चली": "chali",
  "कहाथा": "kaha tha",
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
