/**
 * The only content rule the site enforces itself: sexual content involving minors is illegal and always refused.
 * Everything else is left to the user's own instructions and the chosen model.
 */
const MINOR = /\b(child|children|kid|kids|minor|minors|underage|under[- ]?age|preteen|pre-teen|toddler|infant|schoolgirl|schoolboy|loli|lolita|shota|teen|teens|teenage|(?:[1-9]|1[0-7])[- ]?(?:yo|y\/o|years?[- ]old))\b|طفل|أطفال|اطفال|طفلة|قاصر|قاصرة|قصّر|صغيرة السن|صغير السن|مراهق|مراهقة|رضيع|بنت (?:[0-9١-٩]|1[0-7]|١[٠-٧]) سن|عمرها (?:[0-9١-٩]|1[0-7]|١[٠-٧]) |عمره (?:[0-9١-٩]|1[0-7]|١[٠-٧]) /i;
const SEXUAL = /\b(sex|sexual|sexy|nude|nudes|naked|nsfw|porn|porno|erotic|explicit|lewd|hentai|undress(?:ed|ing)?|topless|genital|genitals|breasts?|boobs?|penis|vagina|intercourse|orgasm|fetish|seductive|strip(?:ping)?)\b|جنس|جنسي|جنسية|عاري|عارية|عري|إباحي|اباحي|إباحية|اباحية|نيك|سكس|شهواني|شهوانية|بدون ملابس|عضو ذكري|أعضاء تناسلية|اغتصاب/i;

export function violatesMinorSafety(text: string | null | undefined) {
  if (!text) return false;
  return MINOR.test(text) && SEXUAL.test(text);
}

export const MINOR_SAFETY_MESSAGE = "هذا الطلب مرفوض: أي محتوى جنسي يخص القاصرين ممنوع نهائيًا.";
