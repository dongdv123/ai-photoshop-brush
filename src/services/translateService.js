
/**
 * Simple translation service using the free public endpoint.
 * Useful for prototyping or low-volume client-side usage.
 */

export async function translateToEnglish(text) {
    if (!text || !text.trim()) return "";

    // Basic check: if text is largely ASCII/English, skip to save time.
    // But for better UX, usually safe to just try translating.
    // Exception: if text is very short or looks like a command.

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();

        // Data structure is usually [[["Translated Text", "Original", ...], ...], ...]
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            // Collect all parts if multi-sentence
            return data[0].map(part => part[0]).join('');
        }
        return text;
    } catch (err) {
        console.error("Translation failed:", err);
        return text; // Fallback to original
    }
}
