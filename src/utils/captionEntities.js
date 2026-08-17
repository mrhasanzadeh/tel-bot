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
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {number} messageId
 * @param {object} [replyMarkup]
 */
async function applyReplyMarkup(telegram, chatId, messageId, replyMarkup) {
    if (!replyMarkup || !messageId) return;
    try {
        await telegram.editMessageReplyMarkup(
            chatId,
            messageId,
            undefined,
            replyMarkup
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`editMessageReplyMarkup failed: ${msg}`);
    }
}

/**
 * If Telegram accepted the photo but dropped custom_emoji, re-apply via editMessageCaption.
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {import('telegraf/types').Message.PhotoMessage} sent
 * @param {string} caption
 * @param {object[]} entities
 * @param {object} [replyMarkup]
 * @param {number} expectedCustom
 */
async function repairCaptionIfPremiumLost(
    telegram,
    chatId,
    sent,
    caption,
    entities,
    replyMarkup,
    expectedCustom
) {
    const got = countCustomEmoji(sent?.caption_entities);
    if (expectedCustom > 0 && got < expectedCustom) {
        console.warn(
            `premium emoji lost after send (${got}/${expectedCustom}); repairing via editMessageCaption`
        );
        const repaired = await telegram.editMessageCaption(
            chatId,
            sent.message_id,
            undefined,
            caption,
            {
                caption_entities: entities,
                ...(replyMarkup ? { reply_markup: replyMarkup } : {})
            }
        );
        return repaired && typeof repaired === 'object' ? repaired : sent;
    }
    await applyReplyMarkup(telegram, chatId, sent.message_id, replyMarkup);
    return sent;
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

/**
 * Largest photo file_id from a Telegram message, if any.
 * @param {import('telegraf/types').Message} [message]
 * @returns {string|null}
 */
function photoFileIdFromMessage(message) {
    const photos = message?.photo;
    if (!Array.isArray(photos) || !photos.length) return null;
    return photos[photos.length - 1]?.file_id || null;
}

/**
 * Build a reusable caption snapshot from a Message Telegram already accepted.
 * @param {import('telegraf/types').Message} [message]
 * @param {string} [fallbackPhotoFileId]
 */
function snapshotFromMessage(message, fallbackPhotoFileId) {
    if (!message || !message.caption) return null;
    const truncated = truncateCaption(
        message.caption,
        message.caption_entities || [],
        PHOTO_CAPTION_MAX
    );
    return {
        photoFileId: photoFileIdFromMessage(message) || fallbackPhotoFileId || null,
        caption: truncated.caption,
        caption_entities: truncated.caption_entities,
        customEmojiCount: countCustomEmoji(truncated.caption_entities)
    };
}

function sameChatId(a, b) {
    return normalizeChatIdForCompare(a) === normalizeChatIdForCompare(b);
}

function normalizeChatIdForCompare(id) {
    return String(id ?? '').trim();
}

function balanceSimpleHtmlTags(html, tagNames) {
    let out = String(html ?? '');
    for (const tag of tagNames) {
        const tokenRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
        let depth = 0;
        let rebuilt = '';
        let last = 0;
        let m;
        while ((m = tokenRe.exec(out))) {
            rebuilt += out.slice(last, m.index);
            if (m[0].startsWith('</')) {
                if (depth > 0) {
                    rebuilt += m[0];
                    depth -= 1;
                }
            } else {
                rebuilt += m[0];
                depth += 1;
            }
            last = m.index + m[0].length;
        }
        rebuilt += out.slice(last);
        while (depth > 0) {
            rebuilt += `</${tag}>`;
            depth -= 1;
        }
        out = rebuilt;
    }
    return out;
}

/** Close orphan &lt;a&gt;/&lt;b&gt; tags before Telegram HTML parse or entity parsing. */
function repairHtmlCaption(htmlCaption) {
    let out = String(htmlCaption ?? '');
    if (!out) return out;
    out = balanceSimpleHtmlTags(out, ['a', 'b']);
    return out;
}

/**
 * Apply caption to an existing channel photo message via caption_entities (preferred).
 * @param {import('telegraf').Telegram} telegram
 * @param {string|number} chatId
 * @param {number} messageId
 * @param {string} htmlCaption
 * @param {object} [replyMarkup]
 */
async function applyChannelCaptionEdits(telegram, chatId, messageId, htmlCaption, replyMarkup) {
    const safeHtml = repairHtmlCaption(htmlCaption);
    if (utf16Length(safeHtml) > PHOTO_CAPTION_MAX) {
        throw new Error(
            `channel publish caption too long (${utf16Length(safeHtml)}/${PHOTO_CAPTION_MAX})`
        );
    }
    const extra = replyMarkup ? { reply_markup: replyMarkup } : {};

    try {
        const edited = await telegram.editMessageCaption(
            chatId,
            messageId,
            undefined,
            safeHtml,
            {
                parse_mode: 'HTML',
                ...extra
            }
        );
        console.log('channel publish: editCaption HTML ok');
        if (edited && typeof edited === 'object') return edited;
        return { message_id: messageId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`channel publish editCaption HTML failed: ${msg}`);
    }

    const payload = channelCaptionOpts(safeHtml, { maxLen: PHOTO_CAPTION_MAX });
    try {
        const edited = await telegram.editMessageCaption(
            chatId,
            messageId,
            undefined,
            payload.caption,
            {
                caption_entities: payload.caption_entities,
                ...extra
            }
        );
        console.log('channel publish: editCaption entities ok (fallback)');
        if (edited && typeof edited === 'object') return edited;
        return { message_id: messageId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`channel publish editCaption entities failed: ${msg}`);
        throw err instanceof Error ? err : new Error(msg);
    }
}

/**
 * Copy an existing post into the target channel, then set caption.
 * Same-channel: schedule-style copy+entities. Cross-channel: copy as-is, then edit HTML.
 *
 * @param {import('telegraf').Telegram} telegram
 * @param {object} opts
 * @param {string|number} opts.targetChatId
 * @param {string|number} opts.sourceChatId
 * @param {string|number} opts.sourceMessageId
 * @param {string} opts.htmlCaption
 * @param {object} [opts.replyMarkup]
 * @returns {Promise<object|null>}
 */
async function copyChannelPostThenSetCaption(telegram, opts) {
    const { targetChatId, sourceChatId, sourceMessageId, htmlCaption, replyMarkup } =
        opts;
    if (targetChatId == null || sourceChatId == null || sourceMessageId == null) {
        return null;
    }

    const crossChannel = !sameChatId(targetChatId, sourceChatId);

    if (!crossChannel) {
        const safeHtml = repairHtmlCaption(htmlCaption);
        if (utf16Length(safeHtml) > PHOTO_CAPTION_MAX) {
            throw new Error(
                `channel publish caption too long (${utf16Length(safeHtml)}/${PHOTO_CAPTION_MAX})`
            );
        }
        try {
            const copied = await telegram.copyMessage(
                targetChatId,
                sourceChatId,
                Number(sourceMessageId),
                {
                    caption: safeHtml,
                    parse_mode: 'HTML',
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
                }
            );
            const messageId = typeof copied === 'number' ? copied : copied?.message_id;
            if (!messageId) return null;
            console.log(
                `channel publish: same-channel copy+HTML ${sourceChatId}/${sourceMessageId}`
            );
            return { message_id: messageId };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`channel publish same-channel copy+HTML failed: ${msg}`);
        }

        let copiedId = null;
        try {
            const copied = await telegram.copyMessage(
                targetChatId,
                sourceChatId,
                Number(sourceMessageId)
            );
            copiedId = typeof copied === 'number' ? copied : copied?.message_id ?? null;
            if (!copiedId) return null;
            return applyChannelCaptionEdits(
                telegram,
                targetChatId,
                copiedId,
                htmlCaption,
                replyMarkup
            );
        } catch (err) {
            const fail = err instanceof Error ? err.message : String(err);
            console.warn(`channel publish same-channel copy+edit failed: ${fail}`);
            if (copiedId) {
                try {
                    await telegram.deleteMessage(targetChatId, copiedId);
                } catch {
                    /* ignore */
                }
            }
            return null;
        }
    }

    // Cross-channel template fallback (prefer admin preview copy-only instead).
    let copiedId = null;
    try {
        const copied = await telegram.copyMessage(
            targetChatId,
            sourceChatId,
            Number(sourceMessageId)
        );
        copiedId = typeof copied === 'number' ? copied : copied?.message_id ?? null;
        if (!copiedId) return null;
        console.log(
            `channel publish: cross-channel copied ${sourceChatId}/${sourceMessageId} → ${targetChatId}/${copiedId}`
        );
        const edited = await applyChannelCaptionEdits(
            telegram,
            targetChatId,
            copiedId,
            htmlCaption,
            replyMarkup
        );
        console.log(
            `channel publish: cross-channel after edit custom_emoji=${countCustomEmoji(edited?.caption_entities)}`
        );
        return edited;
    } catch (err) {
        const fail = err instanceof Error ? err.message : String(err);
        console.warn(`channel publish cross-channel copy+edit failed: ${fail}`);
        if (copiedId) {
            try {
                await telegram.deleteMessage(targetChatId, copiedId);
            } catch {
                /* ignore */
            }
        }
        return null;
    }
}

/**
 * Copy the admin preview DM into the target channel without touching the caption.
 * Preview was already sent with premium emoji; editMessageCaption strips them in channels.
 *
 * @param {import('telegraf').Telegram} telegram
 * @param {object} opts
 * @param {string|number} opts.targetChatId
 * @param {import('telegraf/types').Message} opts.previewMessage
 * @param {object} [opts.replyMarkup]
 */
async function copyAdminPreviewToChannel(telegram, opts) {
    const { targetChatId, previewMessage, replyMarkup } = opts;
    const previewChatId = previewMessage?.chat?.id;
    const previewMessageId = previewMessage?.message_id;
    if (previewChatId == null || previewMessageId == null) return null;
    if (sameChatId(previewChatId, targetChatId)) return null;

    try {
        const copied = await telegram.copyMessage(
            targetChatId,
            previewChatId,
            Number(previewMessageId)
        );
        const messageId = typeof copied === 'number' ? copied : copied?.message_id ?? null;
        if (!messageId) return null;
        console.log(
            `channel publish: preview copy-only ${previewChatId}/${previewMessageId} → ${targetChatId}/${messageId}`
        );
        await applyReplyMarkup(telegram, targetChatId, messageId, replyMarkup);
        return { message_id: messageId };
    } catch (err) {
        const fail = err instanceof Error ? err.message : String(err);
        console.warn(`channel publish preview copy-only failed: ${fail}`);
        return null;
    }
}

/** @deprecated use copyAdminPreviewToChannel — kept for tests */
async function copyPreviewThenSetCaption(telegram, opts) {
    return copyAdminPreviewToChannel(telegram, opts);
}

/**
 * Copy a bound CHANNEL post as-is. Bot API drops custom_emoji when sending or
 * editing captions on channels, and when copying a private preview into a channel.
 */
async function sendPhotoPreservingPremiumEmoji(telegram, opts) {
    const {
        chatId,
        coverFileId,
        htmlCaption,
        replyMarkup,
        previewMessage,
        sourceChatId,
        sourceMessageId
    } = opts;

    if (sourceChatId != null && sourceMessageId != null) {
        try {
            // Copy with no caption/markup override so custom_emoji stay intact.
            const copied = await telegram.copyMessage(
                chatId,
                sourceChatId,
                Number(sourceMessageId)
            );
            const messageId =
                typeof copied === 'number' ? copied : copied?.message_id ?? null;
            if (messageId) {
                console.log(
                    `channel publish: template copy-only ${sourceChatId}/${sourceMessageId} → ${chatId}/${messageId}`
                );
                if (replyMarkup) {
                    await applyReplyMarkup(telegram, chatId, messageId, replyMarkup);
                    console.log('channel publish: glass button applied via reply_markup');
                }
                return { message_id: messageId };
            }
        } catch (err) {
            const fail = err instanceof Error ? err.message : String(err);
            console.warn(`channel publish template copy-only failed: ${fail}`);
        }
    }

    throw new Error(
        'channel publish failed: bind TheShioriSub template is missing or copy failed'
    );
}

module.exports = {
    utf16Length,
    htmlToCaptionPayload,
    channelCaptionOpts,
    sanitizeEntities,
    countCustomEmoji,
    sendPhotoWithHtmlCaption,
    sendPhotoPreservingPremiumEmoji,
    copyChannelPostThenSetCaption,
    copyAdminPreviewToChannel,
    copyPreviewThenSetCaption,
    applyChannelCaptionEdits,
    repairHtmlCaption,
    photoFileIdFromMessage,
    snapshotFromMessage,
    PHOTO_CAPTION_MAX
};
