export interface TargetProfile {
  code: string;
  name: string;
  flag?: string;
  guidance?: string;
}

const DUTCH_GUIDANCE =
  "Write the way a native speaker in the Netherlands would naturally say it, in easy everyday Dutch that anyone can understand. " +
  "Use common words and short, clear sentences. Avoid stiff, literal or officialese wording and anglicisms, and restructure sentences freely so they do not read like a translation. " +
  "Keep names, numbers, dates and formatting, and never change the meaning.";

const SAUDI_ARABIC_GUIDANCE =
  "Write the way a native Arabic speaker in Saudi Arabia would naturally write it, in easy, grammatically correct Modern Standard Arabic that anyone can understand. " +
  "Use common words and short, clear sentences, and restructure sentences freely so they do not read like a translation. " +
  "Prefer vocabulary and phrasing familiar to Saudi readers, and avoid needlessly ornate or regionally unfamiliar expressions. " +
  "Do not use colloquial Saudi dialect unless the source is explicitly dialectal. " +
  "Keep names, numbers, dates and formatting, and never change the meaning in order to localise the wording.";

/** Adding a multilingual target is one entry here plus MULTILINGUAL_TARGETS. */
export const TARGET_PROFILES: Record<string, TargetProfile> = {
  dutch: { code: "nl", name: "Dutch", flag: "🇳🇱", guidance: DUTCH_GUIDANCE },
  english: { code: "en", name: "English", flag: "🇬🇧" },
  arabicSaudiArabia: { code: "ar-SA", name: "Arabic (Saudi Arabia)", flag: "🇸🇦", guidance: SAUDI_ARABIC_GUIDANCE },
};

export const guidanceFor = (code: string) => Object.values(TARGET_PROFILES).find((t) => t.code === code)?.guidance;
