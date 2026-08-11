/**
 * Convert schedule/channel HTML captions (tg-emoji, bold, links) to Telegram caption_entities.
 * Photo captions need explicit custom_emoji entities — parse_mode HTML alone often drops them.
 */

const PHOTO_CAPTION_MAX = 1024;

/**
 * Telegram entity offset/length are measured in UTF-16 code units — same as JS string.length.
 * @param {string} str
 * @returns {number}
 */
function utf16Length(str) {
    return String(str ?? '').length;
}

/**
 * @param {string} chunk
 * @returns {string}
 */
function decodeHtmlEntities(chunk) {
    return String(chunk)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/**
 * Drop entities Telegram would reject (ENTITY_TEXT_INVALID).
 * @param {string} text
 * @param {object[]} entities
 * @returns {object[]}
 */
function sanitizeEntities(text, entities) {
    const max = utf16Length(text);
    return (entities || []).filter((ent) => {
        if (!ent || typeof ent !== 'object') return false;
        const offset = Number(ent.offset);
        const length = Number(ent.length);
        if (!Number.isFinite(offset) || !Number.isFinite(length)) return false;
        if (offset < 0 || length <= 0) return false;
        if (offset + length > max) return false;
        if (ent.type === 'text_link' && !String(ent.url || '').trim()) return false;
        if (ent.type === 'custom_emoji' && !String(ent.custom_emoji_id || '').trim()) {
            return false;
        }
        return true;
    });
}

/**
 * @param {string} text
 * @param {object[]} entities
 * @param {number} maxLen
 */
function truncateCaption(text, entities, maxLen) {
    const raw = String(text ?? '');
    if (!maxLen || utf16Length(raw) <= maxLen) {
        return { caption: raw, caption_entities: sanitizeEntities(raw, entities) };
    }
    const caption = raw.slice(0, maxLen);
    return {
        caption,
        caption_entities: sanitizeEntities(caption, entities)
    };
}

/**
 * Append parsed inner payload into outer buffers.
 * @param {{ text: string, entities: object[] }} target
 * @param {{ text: string, entities: object[] }} inner
 */
function appendParsed(target, inner) {
    const base = utf16Length(target.text);
    target.text += inner.text;
    for (const ent of inner.entities) {
        target.entities.push({ ...ent, offset: ent.offset + base });
    }
}

/**
 * @param {string} html
 * @returns {{ text: string, entities: object[] }}
 */
function parseHtmlChunk(html) {
    const out = { text: '', entities: [] };
    let pos = 0;
    const src = String(html ?? '');

    while (pos < src.length) {
        let m = src.slice(pos).match(/^<tg-emoji emoji-id="(\d+)">([\s\S]*?)<\/tg-emoji>/);
        if (m) {
            const fallback = decodeHtmlEntities(m[2]);
            // Telegram custom_emoji must wrap plain text, not nested tags
            const plain = fallback.replace(/<[^>]+>/g, '');
            if (plain) {
                const start = utf16Length(out.text);
                out.text += plain;
                out.entities.push({
                    type: 'custom_emoji',
                    offset: start,
                    length: utf16Length(plain),
                    custom_emoji_id: m[1]
                });
            }
            pos += m[0].length;
            continue;
        }

        m = src.slice(pos).match(/^<a href="([^"]*)">([\s\S]*?)<\/a>/);
        if (m) {
            const url = decodeHtmlEntities(m[1]).trim();
            const start = utf16Length(out.text);
            const inner = parseHtmlChunk(m[2]);
            appendParsed(out, inner);
            const len = utf16Length(inner.text);
            if (len > 0 && url) {
                out.entities.push({
                    type: 'text_link',
                    offset: start,
                    length: len,
                    url
                });
            }
            pos += m[0].length;
            continue;
        }

        m = src.slice(pos).match(/^<b>([\s\S]*?)<\/b>/);
        if (m) {
            const start = utf16Length(out.text);
            const inner = parseHtmlChunk(m[1]);
            appendParsed(out, inner);
            const len = utf16Length(inner.text);
            if (len > 0) {
                out.entities.push({
                    type: 'bold',
                    offset: start,
                    length: len
                });
            }
            pos += m[0].length;
            continue;
        }

        // Unsupported tags: keep inner text by skipping the tag itself
        m = src.slice(pos).match(/^<\/?(?:i|em|u|s|code|pre|span|div|p|br\s*\/?)[^>]*>/i);
        if (m) {
            if (/^<br/i.test(m[0])) out.text += '\n';
            pos += m[0].length;
            continue;
        }

        if (src.startsWith('&amp;', pos)) {
            out.text += '&';
            pos += 5;
            continue;
        }
        if (src.startsWith('&lt;', pos)) {
            out.text += '<';
            pos += 4;
            continue;
        }
        if (src.startsWith('&gt;', pos)) {
            out.text += '>';
            pos += 4;
            continue;
        }
        if (src.startsWith('&quot;', pos)) {
            out.text += '"';
            pos += 6;
            continue;
        }
        if (src.startsWith('&#39;', pos)) {
            out.text += "'";
            pos += 5;
            continue;
        }

        out.text += src[pos];
        pos++;
    }

    out.entities.sort((a, b) => a.offset - b.offset || a.length - b.length);
    out.entities = sanitizeEntities(out.text, out.entities);
    return out;
}

/**
 * @param {string} html
 * @returns {{ caption: string, caption_entities: object[] }}
 */
function htmlToCaptionPayload(html) {
    const parsed = parseHtmlChunk(html);
    return {
        caption: parsed.text,
        caption_entities: parsed.entities
    };
}

/**
 * Options for sendPhoto / editMessageCaption (premium emoji via caption_entities).
 * @param {string} htmlCaption
 * @param {{ maxLen?: number | null }} [opts]
 */
function channelCaptionOpts(htmlCaption, opts = {}) {
    const maxLen = opts.maxLen == null ? null : opts.maxLen;
    const payload = htmlToCaptionPayload(htmlCaption);
    const truncated = truncateCaption(
        payload.caption,
        payload.caption_entities,
        maxLen
    );
    return {
        caption: truncated.caption,
        caption_entities: truncated.caption_entities,
        disable_web_page_preview: true
    };
}

/**
 * Send photo with caption, trying entities → entities without custom_emoji → HTML → plain.
 * Never leaves a caption-less photo as the only result when caption exists.
 *
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {string} photo
 * @param {string} htmlCaption
 * @param {object} [extra] reply_markup etc.
 */
async function sendPhotoWithHtmlCaption(telegram, chatId, photo, htmlCaption, extra = {}) {
    const entityOpts = channelCaptionOpts(htmlCaption, { maxLen: PHOTO_CAPTION_MAX });
    const { reply_markup, ...rest } = extra;
    const base = {
        disable_web_page_preview: true,
        ...(reply_markup ? { reply_markup } : {}),
        ...rest
    };

    try {
        return await telegram.sendPhoto(chatId, photo, {
            caption: entityOpts.caption,
            caption_entities: entityOpts.caption_entities,
            ...base
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendPhoto entities failed: ${msg}; retry without custom_emoji`);
    }

    try {
        const withoutCustom = (entityOpts.caption_entities || []).filter(
            (e) => e.type !== 'custom_emoji'
        );
        return await telegram.sendPhoto(chatId, photo, {
            caption: entityOpts.caption,
            caption_entities: withoutCustom,
            ...base
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendPhoto entities(no custom) failed: ${msg}; trying HTML`);
    }

    try {
        const escaped = entityOpts.caption
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return await telegram.sendPhoto(chatId, photo, {
            caption: escaped,
            parse_mode: 'HTML',
            ...base
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendPhoto HTML failed: ${msg}; trying plain caption`);
    }

    return telegram.sendPhoto(chatId, photo, {
        caption: entityOpts.caption,
        ...base
    });
}

module.exports = {
    utf16Length,
    htmlToCaptionPayload,
    channelCaptionOpts,
    sanitizeEntities,
    sendPhotoWithHtmlCaption,
    PHOTO_CAPTION_MAX
};
