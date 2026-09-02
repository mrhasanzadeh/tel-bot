/**
 * Convert schedule/channel HTML captions (tg-emoji, bold, links) to Telegram caption_entities.
 * Photo captions need explicit custom_emoji entities — parse_mode HTML alone often drops them.
 */

const PHOTO_CAPTION_MAX = 1024;
const MESSAGE_TEXT_MAX = 4096;

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

/** @param {string} text */
function escapeHtmlLite(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Rebuild tg-emoji HTML from a Telegram message body + entities (picker / forwarded text).
 * @param {string} text
 * @param {object[] | undefined | null} entities
 * @returns {string}
 */
function messageToHtml(text, entities) {
    const raw = String(text ?? '');
    const ents = normalizeOutboundEntities(entities)
        .filter((ent) => {
            const offset = Number(ent.offset);
            const length = Number(ent.length);
            return offset >= 0 && length > 0 && offset + length <= utf16Length(raw);
        })
        .sort((a, b) => a.offset - b.offset || a.length - b.length);

    let html = '';
    let cursor = 0;
    for (const ent of ents) {
        if (ent.offset < cursor) continue;
        html += escapeHtmlLite(raw.slice(cursor, ent.offset));
        const inner = raw.slice(ent.offset, ent.offset + ent.length);
        const esc = escapeHtmlLite(inner);
        switch (ent.type) {
            case 'custom_emoji':
                html += `<tg-emoji emoji-id="${String(ent.custom_emoji_id ?? '').trim()}">${esc}</tg-emoji>`;
                break;
            case 'bold':
                html += `<b>${esc}</b>`;
                break;
            case 'italic':
                html += `<i>${esc}</i>`;
                break;
            case 'underline':
                html += `<u>${esc}</u>`;
                break;
            case 'strikethrough':
                html += `<s>${esc}</s>`;
                break;
            case 'text_link':
                html += `<a href="${escapeHtmlLite(String(ent.url ?? ''))}">${esc}</a>`;
                break;
            case 'code':
                html += `<code>${esc}</code>`;
                break;
            default:
                html += esc;
        }
        cursor = ent.offset + ent.length;
    }
    html += escapeHtmlLite(raw.slice(cursor));
    return html;
}

/**
 * Drop entities Telegram would reject (ENTITY_TEXT_INVALID).
 * @param {string} text
 * @param {object[]} entities
 * @returns {object[]}
 */
function sanitizeEntities(text, entities) {
    const max = utf16Length(text);
    return normalizeOutboundEntities(entities).filter((ent) => {
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
 * Telegram rejects re-sent entities if they include fields from incoming updates.
 * @param {object[] | undefined | null} entities
 * @returns {object[]}
 */
function normalizeOutboundEntities(entities) {
    return (entities || [])
        .map((ent) => {
            if (!ent || typeof ent !== 'object') return null;
            const type = String(ent.type ?? '').trim();
            const offset = Number(ent.offset);
            const length = Number(ent.length);
            if (!type || !Number.isFinite(offset) || !Number.isFinite(length)) return null;

            const base = { type, offset, length };
            switch (type) {
                case 'custom_emoji':
                    return {
                        ...base,
                        custom_emoji_id: String(ent.custom_emoji_id ?? '').trim()
                    };
                case 'text_link':
                    return { ...base, url: String(ent.url ?? '').trim() };
                case 'text_mention': {
                    const user = ent.user;
                    if (!user || user.id == null) return null;
                    return {
                        ...base,
                        user: {
                            id: user.id,
                            is_bot: Boolean(user.is_bot),
                            first_name: String(user.first_name ?? 'User')
                        }
                    };
                }
                case 'pre':
                    return ent.language
                        ? { ...base, language: String(ent.language) }
                        : base;
                default:
                    return base;
            }
        })
        .filter(Boolean);
}

/**
 * @param {object[]|undefined|null} entities
 * @returns {number}
 */
function countCustomEmoji(entities) {
    return (entities || []).filter((e) => e && e.type === 'custom_emoji').length;
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
        let m = src.slice(pos).match(
            /^<tg-emoji\b[^>]*\bemoji-id=["'](\d+)["'][^>]*>([\s\S]*?)<\/tg-emoji>/i
        );
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
 * Drop leftover tg-emoji markup when HTML was truncated or malformed.
 * @param {string} text
 * @returns {string}
 */
function stripResidualTgEmojiMarkup(text) {
    return String(text ?? '')
        .replace(/<tg-emoji\b[^>]*>/gi, '')
        .replace(/<\/tg-emoji>/gi, '');
}

/**
 * @param {string} html
 * @returns {boolean}
 */
function isBalancedTgEmojiHtml(html) {
    const src = String(html ?? '');
    const opens = (src.match(/<tg-emoji\b/gi) || []).length;
    const closes = (src.match(/<\/tg-emoji>/gi) || []).length;
    return opens > 0 && opens === closes;
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
 * Build sendMessage payload from Telegram message text/entities or HTML tg-emoji markup.
 * @param {string} rawText
 * @param {object[] | undefined | null} rawEntities
 * @param {{ maxLen?: number | null }} [opts]
 */
function messageEntityOpts(rawText, rawEntities, opts = {}) {
    const maxLen = opts.maxLen == null ? MESSAGE_TEXT_MAX : opts.maxLen;
    const text = String(rawText ?? '');
    const fromClient = sanitizeEntities(text, rawEntities ?? []);
    const hasClientCustomEmoji = fromClient.some((ent) => ent.type === 'custom_emoji');

    // Prefer live Telegram entities (picker) over re-parsing HTML in the same message.
    if (hasClientCustomEmoji && !/<tg-emoji\b/i.test(text)) {
        const truncated = truncateCaption(text, fromClient, maxLen);
        return {
            text: truncated.caption,
            entities: truncated.caption_entities
        };
    }

    if (/<tg-emoji\b/i.test(text)) {
        const payload = htmlToCaptionPayload(text);
        let cleanText = stripResidualTgEmojiMarkup(payload.caption);
        let entities = sanitizeEntities(cleanText, payload.caption_entities);
        const truncated = truncateCaption(cleanText, entities, maxLen);
        return {
            text: truncated.caption,
            entities: truncated.caption_entities
        };
    }

    const truncated = truncateCaption(text, fromClient, maxLen);
    return {
        text: truncated.caption,
        entities: truncated.caption_entities
    };
}

/**
 * Send a text message preserving premium emoji via entities (with HTML / plain fallbacks).
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {string} rawText
 * @param {object[] | undefined | null} rawEntities
 * @param {object} [extra]
 */
async function sendMessageWithEntities(
    telegram,
    chatId,
    rawText,
    rawEntities,
    extra = {}
) {
    const allowStripPremium = extra.allowStripPremium !== false;
    const attachMarkupAfterSend = extra.attachMarkupAfterSend === true;
    const entityOpts = messageEntityOpts(rawText, rawEntities);
    const {
        reply_markup,
        allowStripPremium: _a,
        attachMarkupAfterSend: _b,
        ...rest
    } = extra;
    const base = { ...rest };
    delete base.disable_web_page_preview;
    delete base.allowStripPremium;
    delete base.attachMarkupAfterSend;

    const sendOnce = async (entities, withMarkup) => {
        const payload = {
            entities,
            ...base
        };
        if (withMarkup && reply_markup) {
            payload.reply_markup = reply_markup;
        }
        return telegram.sendMessage(chatId, entityOpts.text, payload);
    };

    try {
        if (attachMarkupAfterSend && reply_markup) {
            const sent = await sendOnce(entityOpts.entities, false);
            await telegram.editMessageReplyMarkup(
                chatId,
                sent.message_id,
                undefined,
                reply_markup
            );
            return sent;
        }

        return await sendOnce(entityOpts.entities, Boolean(reply_markup));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendMessage entities failed: ${msg}; retrying without custom_emoji`);
    }

    if (!allowStripPremium) {
        throw new Error('sendMessage failed while preserving premium emoji');
    }

    try {
        const withoutCustom = (entityOpts.entities || []).filter(
            (e) => e.type !== 'custom_emoji'
        );
        if (attachMarkupAfterSend && reply_markup) {
            const sent = await sendOnce(withoutCustom, false);
            await telegram.editMessageReplyMarkup(
                chatId,
                sent.message_id,
                undefined,
                reply_markup
            );
            return sent;
        }
        return await sendOnce(withoutCustom, Boolean(reply_markup));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendMessage entities(no custom) failed: ${msg}; trying plain text`);
    }

    if (attachMarkupAfterSend && reply_markup) {
        const sent = await telegram.sendMessage(chatId, entityOpts.text, base);
        await telegram.editMessageReplyMarkup(
            chatId,
            sent.message_id,
            undefined,
            reply_markup
        );
        return sent;
    }

    return telegram.sendMessage(chatId, entityOpts.text, {
        ...(reply_markup ? { reply_markup } : {}),
        ...base
    });
}

/**
 * Send a text message from HTML caption markup (tg-emoji, bold, links).
 * Note: Telegram strips custom_emoji in channel posts unless the bot has a Fragment username.
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {string} html
 * @param {object} [extra]
 */
async function sendMessageWithHtml(telegram, chatId, html, extra = {}) {
    const allowStripPremium = extra.allowStripPremium !== false;
    const attachMarkupAfterSend = extra.attachMarkupAfterSend === true;
    const htmlText = String(html ?? '').slice(0, MESSAGE_TEXT_MAX);
    const {
        reply_markup,
        allowStripPremium: _a,
        attachMarkupAfterSend: _b,
        ...rest
    } = extra;
    const base = {
        ...rest,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    delete base.allowStripPremium;
    delete base.attachMarkupAfterSend;

    const attachMarkup = async (sent) => {
        if (attachMarkupAfterSend && reply_markup && sent?.message_id != null) {
            await telegram.editMessageReplyMarkup(
                chatId,
                sent.message_id,
                undefined,
                reply_markup
            );
        }
        return sent;
    };

    try {
        console.warn(
            `sendMessage HTML: chat=${chatId} len=${htmlText.length} tg_emoji=${(
                htmlText.match(/<tg-emoji\b/gi) || []
            ).length}`
        );
        return await attachMarkup(await telegram.sendMessage(chatId, htmlText, base));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendMessage HTML failed: ${msg}; trying parsed entities`);
        if (!allowStripPremium) {
            throw err instanceof Error ? err : new Error(msg);
        }
    }

    const payload = htmlToCaptionPayload(htmlText);
    return sendMessageWithEntities(telegram, chatId, payload.caption, payload.caption_entities, {
        ...extra,
        attachMarkupAfterSend,
        allowStripPremium
    });
}

/**
 * Send photo with caption.
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {string} photo
 * @param {string} htmlCaption
 * @param {object} [extra] reply_markup, allowStripPremium (default true for non-channel callers)
 */
async function sendPhotoWithHtmlCaption(telegram, chatId, photo, htmlCaption, extra = {}) {
    const allowStripPremium = extra.allowStripPremium !== false;
    const entityOpts = channelCaptionOpts(htmlCaption, { maxLen: PHOTO_CAPTION_MAX });
    const { reply_markup, allowStripPremium: _a, ...rest } = extra;
    const base = {
        ...(reply_markup ? { reply_markup } : {}),
        ...rest
    };
    // Strip unknown/non-photo flags that some Telegram builds reject with entities.
    delete base.disable_web_page_preview;
    delete base.allowStripPremium;

    try {
        return await telegram.sendPhoto(chatId, photo, {
            caption: entityOpts.caption,
            caption_entities: entityOpts.caption_entities,
            ...base
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`sendPhoto entities failed: ${msg}; trying HTML tg-emoji`);
    }

    try {
        return await telegram.sendPhoto(chatId, photo, {
            caption: String(htmlCaption ?? '').slice(0, PHOTO_CAPTION_MAX),
            parse_mode: 'HTML',
            ...base
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
            `sendPhoto HTML(tg-emoji) failed: ${msg}` +
                (allowStripPremium ? '; retry without custom_emoji' : '')
        );
        if (!allowStripPremium) throw err instanceof Error ? err : new Error(msg);
    }

    if (!allowStripPremium) {
        throw new Error('sendPhoto failed while preserving premium emoji');
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
        console.warn(`sendPhoto entities(no custom) failed: ${msg}; trying plain caption`);
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
    messageEntityOpts,
    sanitizeEntities,
    normalizeOutboundEntities,
    countCustomEmoji,
    stripResidualTgEmojiMarkup,
    isBalancedTgEmojiHtml,
    messageToHtml,
    sendPhotoWithHtmlCaption,
    sendMessageWithEntities,
    sendMessageWithHtml,
    PHOTO_CAPTION_MAX,
    MESSAGE_TEXT_MAX
};

