/**
 * Convert schedule HTML captions (tg-emoji, bold, links) to Telegram caption_entities.
 * Photo captions in channels need explicit custom_emoji entities — parse_mode HTML alone
 * often shows only the fallback unicode character.
 */

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
        .replace(/&gt;/g, '>');
}

/**
 * @param {string} html
 * @returns {{ caption: string, caption_entities: object[] }}
 */
function htmlToCaptionPayload(html) {
    const entities = [];
    let text = '';

    const offset = () => utf16Length(text);

    const appendEntities = (inner, baseOffset) => {
        for (const ent of inner.entities) {
            entities.push({ ...ent, offset: ent.offset + baseOffset });
        }
    };

    let pos = 0;
    const src = String(html ?? '');

    while (pos < src.length) {
        let m = src.slice(pos).match(/^<tg-emoji emoji-id="(\d+)">([\s\S]*?)<\/tg-emoji>/);
        if (m) {
            const fallback = decodeHtmlEntities(m[2]);
            const start = offset();
            text += fallback;
            entities.push({
                type: 'custom_emoji',
                offset: start,
                length: utf16Length(fallback),
                custom_emoji_id: m[1]
            });
            pos += m[0].length;
            continue;
        }

        m = src.slice(pos).match(/^<a href="([^"]*)">([\s\S]*?)<\/a>/);
        if (m) {
            const label = decodeHtmlEntities(m[2]);
            const start = offset();
            text += label;
            entities.push({
                type: 'text_link',
                offset: start,
                length: utf16Length(label),
                url: m[1]
            });
            pos += m[0].length;
            continue;
        }

        m = src.slice(pos).match(/^<b>([\s\S]*?)<\/b>/);
        if (m) {
            const start = offset();
            const inner = parseInner(m[1]);
            text += inner.text;
            appendEntities(inner, start);
            entities.push({
                type: 'bold',
                offset: start,
                length: utf16Length(inner.text)
            });
            pos += m[0].length;
            continue;
        }

        if (src.startsWith('&amp;', pos)) {
            text += '&';
            pos += 5;
            continue;
        }
        if (src.startsWith('&lt;', pos)) {
            text += '<';
            pos += 4;
            continue;
        }
        if (src.startsWith('&gt;', pos)) {
            text += '>';
            pos += 4;
            continue;
        }

        text += src[pos];
        pos++;
    }

    entities.sort((a, b) => a.offset - b.offset || a.length - b.length);
    return { caption: text, caption_entities: entities };
}

/**
 * Parse inline chunk (inside bold) — links and entities only.
 * @param {string} chunk
 */
function parseInner(chunk) {
    const payload = htmlToCaptionPayload(chunk);
    return { text: payload.caption, entities: payload.caption_entities };
}

/**
 * Options for sendPhoto / editMessageCaption in channels (premium emoji).
 * @param {string} htmlCaption
 * @returns {{ caption: string, caption_entities: object[], disable_web_page_preview: boolean }}
 */
function channelCaptionOpts(htmlCaption) {
    const payload = htmlToCaptionPayload(htmlCaption);
    return {
        caption: payload.caption,
        caption_entities: payload.caption_entities,
        disable_web_page_preview: true
    };
}

module.exports = {
    utf16Length,
    htmlToCaptionPayload,
    channelCaptionOpts
};
