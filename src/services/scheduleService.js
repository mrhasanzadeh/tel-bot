const config = require('../../config');
const scheduleDb = require('./scheduleDatabaseService');
const {
    parseAnimeFilename,
    normalizeFilenameTitle
} = require('../utils/animeFilenameParser');
const { slugFromRomaji } = require('../utils/animeSlug');
const { normalizeStaffInput } = require('../utils/staffFormat');
const { buildScheduleCaption } = require('./captionBuilderService');
const {
    getSchedulePublishChannelId,
    isScheduleTestMode,
    getAdminUserId
} = require('../utils/channelIds');
const { parsePackEpisodesSlug, parsePackSubtitleKey } = require('../utils/schedulePackParse');
const { e, htmlOpts, escapeHtml } = require('../utils/premiumEmoji');
const { channelCaptionOpts } = require('../utils/captionEntities');

class ScheduleService {
    constructor() {
        this.telegram = null;
    }

    /** @param {import('telegraf').Telegraf} bot */
    setTelegram(bot) {
        this.telegram = bot;
    }

    isEnabled() {
        if (process.env.SHIORI_API_URL?.trim()) {
            return false;
        }
        return Boolean(
            getAdminUserId() &&
            getSchedulePublishChannelId() &&
            this.telegram
        );
    }

    /**
     * TheShioriSub only — never PUBLIC_CHANNEL / TheShiori main.
     * @param {object} [anime]
     */
    _getScheduleChannelId(anime) {
        return getSchedulePublishChannelId() || anime?.channelId || '';
    }

    /** No existing schedule post to copy image from (first release for this anime). */
    _animeNeedsCoverPhoto(anime) {
        return !anime?.templateMessageId && !anime?.latestScheduleMessageId;
    }

    _isPackOnlySubtitles(anime) {
        return anime?.subtitleMode === 'pack_only';
    }

    async _getBotUsername(ctx) {
        if (ctx.botInfo?.username) return ctx.botInfo.username;
        const me = await ctx.telegram.getMe();
        return me.username;
    }

    /**
     * @param {object} anime
     * @param {object} pending
     * @param {string} botUsername
     */
    async _buildOngoingCaption(anime, pending, botUsername) {
        const episodes = await scheduleDb.listEpisodes(anime.id);
        const episodeMap = new Map(episodes.map((ep) => [ep.episode, ep]));
        episodeMap.set(pending.episode, {
            episode: pending.episode,
            videoKey: pending.videoKey,
            subtitleKey: pending.subtitleKey || null
        });
        const sorted = [...episodeMap.values()].sort((a, b) => a.episode - b.episode);
        const maxEp = Math.max(...sorted.map((ep) => ep.episode));

        return buildScheduleCaption({
            botUsername,
            title: anime.title,
            staff: anime.staff || 'Dawn',
            hasKaraoke: anime.hasKaraoke,
            season: anime.season,
            episodes: sorted,
            newEpisode: pending.episode,
            completed: false,
            hashtag: anime.hashtag,
            donationUrl: anime.donationUrl,
            synopsisUrl: anime.synopsisUrl,
            packEpisodesSlug: null,
            packSubtitleKey: null,
            episodeRangeEnd: maxEp,
            subtitleMode: anime.subtitleMode
        });
    }

    _previewKeyboard(pendingId, published = false) {
        const publishBtn = published
            ? { text: '🔄 انتشار مجدد', callback_data: `sched_rep_${pendingId}` }
            : { text: '✅ تأیید و انتشار', callback_data: `sched_a_${pendingId}` };
        return {
            inline_keyboard: [
                [
                    publishBtn,
                    { text: '✅ + انیمه تمام شد', callback_data: `sched_c_${pendingId}` }
                ],
                [{ text: '❌ رد', callback_data: `sched_r_${pendingId}` }]
            ]
        };
    }

    /**
     * @param {object} message
     * @returns {string | null}
     */
    _resolvePacks(pending, anime) {
        return {
            packEpisodesSlug: pending?.packEpisodesSlug ?? anime?.packEpisodesSlug ?? null,
            packSubtitleKey: pending?.packSubtitleKey ?? anime?.packSubtitleKey ?? null
        };
    }

    _packsAreComplete(pending, anime) {
        const packs = this._resolvePacks(pending, anime);
        return Boolean(packs.packEpisodesSlug && packs.packSubtitleKey);
    }

    /**
     * @param {object} anime
     * @param {object} pending
     * @param {string} botUsername
     */
    async _buildCompletedCaption(anime, pending, botUsername) {
        const existingEpisodes = await scheduleDb.listEpisodes(anime.id);
        const episodeMap = new Map(existingEpisodes.map((ep) => [ep.episode, ep]));
        episodeMap.set(pending.episode, {
            episode: pending.episode,
            videoKey: pending.videoKey,
            subtitleKey: pending.subtitleKey
        });
        const episodes = [...episodeMap.values()].sort((a, b) => a.episode - b.episode);
        const maxEp = Math.max(...episodes.map((ep) => ep.episode));
        const packs = this._resolvePacks(pending, anime);

        return buildScheduleCaption({
            botUsername,
            title: anime.title,
            staff: anime.staff || 'Dawn',
            hasKaraoke: anime.hasKaraoke,
            season: anime.season,
            episodes,
            newEpisode: pending.episode,
            completed: true,
            hashtag: anime.hashtag,
            donationUrl: anime.donationUrl,
            synopsisUrl: anime.synopsisUrl,
            packEpisodesSlug: packs.packEpisodesSlug,
            packSubtitleKey: packs.packSubtitleKey,
            episodeRangeEnd: maxEp,
            subtitleMode: anime.subtitleMode
        });
    }

    _extractPhotoFileId(message) {
        if (message?.photo?.length) {
            return message.photo[message.photo.length - 1].file_id;
        }
        const doc = message?.document;
        if (doc?.mime_type?.startsWith('image/')) {
            return doc.file_id;
        }
        return null;
    }

    /**
     * Called after a file is registered in the links channel.
     * @param {import('telegraf').Context} ctx
     * @param {{ key: string, fileName?: string }} fileData
     */
    async onFileRegistered(ctx, fileData) {
        if (!this.isEnabled()) return;

        const parsed = parseAnimeFilename(fileData.fileName);
        if (!parsed) return;

        const anime = await scheduleDb.findAnimeByFilenameTitle(parsed.title);
        if (!anime) {
            await this._handleUnregisteredAnime(ctx, parsed, fileData);
            return;
        }

        const batch = await scheduleDb.upsertUploadBatch(
            anime.id,
            parsed.episode,
            parsed.kind,
            fileData.key
        );

        const packOnly = this._isPackOnlySubtitles(anime);
        if (!batch.video_key || (!packOnly && !batch.subtitle_key)) {
            console.log(
                `📋 Schedule: waiting for pair anime=${anime.slug} ep=${parsed.episode} ` +
                    `video=${Boolean(batch.video_key)} sub=${Boolean(batch.subtitle_key)} ` +
                    `mode=${anime.subtitleMode}`
            );
            return;
        }

        if (batch.status === 'done') {
            console.log(
                `📋 Schedule: batch already processed ep=${parsed.episode} ` +
                    `(re-upload with new keys to trigger preview again)`
            );
            return;
        }

        await this._tryProposeNextInQueue(ctx, anime);
    }

    /**
     * New anime: collect E01 files, ask admin for English title (romaji from filename).
     * @param {import('telegraf').Context} ctx
     */
    async _handleUnregisteredAnime(ctx, parsed, fileData) {
        if (parsed.episode !== 1) {
            console.log(
                `📋 Schedule: unknown anime "${parsed.title}" — upload E01 first to register`
            );
            return;
        }

        const filenameTitle = normalizeFilenameTitle(parsed.title);
        const reg = await scheduleDb.upsertAnimeRegistration(
            filenameTitle,
            parsed.title.trim(),
            parsed.kind,
            fileData.key
        );

        if (!reg.video_key) {
            console.log(
                `📋 Schedule: new anime E01 waiting for video romaji="${parsed.title}"`
            );
            return;
        }

        if (
            reg.asked_at &&
            reg.registration_step === 'awaiting_e01_sub' &&
            reg.video_key &&
            reg.subtitle_key
        ) {
            const updated = await scheduleDb.updateAnimeRegistration(filenameTitle, {
                registration_step: 'cover_photo'
            });
            await this._askRegistrationCoverPhoto(ctx, updated);
            return;
        }

        if (reg.asked_at) {
            console.log(`📋 Schedule: registration in progress for "${filenameTitle}"`);
            return;
        }

        const adminId = getAdminUserId();
        if (!adminId) return;

        await scheduleDb.markAnimeRegistrationAsked(filenameTitle);
        await ctx.telegram.sendMessage(
            adminId,
            `${e('clipboard')} <b>انیمه جدید شناسایی شد</b>\n\n` +
                `روماجی (از نام فایل): <code>${escapeHtml(parsed.title.trim())}</code>\n\n` +
                `لطفاً <b>اسم انگلیسی انیمه</b> را برای پست کانال در همین چت بفرست.\n` +
                `(مثلاً: <code>Solo Leveling</code>)`,
            htmlOpts({ disable_web_page_preview: true })
        );
        console.log(`📋 Schedule: asked admin English title for new anime "${filenameTitle}"`);
    }

    _regCbEncode(filenameTitle) {
        return Buffer.from(filenameTitle, 'utf8').toString('base64url');
    }

    _regCbDecode(encoded) {
        return Buffer.from(encoded, 'base64url').toString('utf8');
    }

    _normalizeSynopsisUrl(input) {
        const text = String(input ?? '').trim();
        if (!text) return null;
        if (/^https?:\/\//i.test(text)) return text;
        if (/^t\.me\//i.test(text)) return `https://${text}`;
        return null;
    }

    _normalizeHashtag(input) {
        const text = String(input ?? '').trim();
        if (!text) return null;
        const tag = text.startsWith('#') ? text : `#${text}`;
        return tag.length > 1 ? tag : null;
    }

    async _askSynopsisChoice(ctx, reg) {
        const key = this._regCbEncode(reg.filename_title);
        await ctx.reply(
            `${e('speech')} آیا برای این انیمه <b>خلاصه داستان (Synopsis)</b> در پست می‌گذاریم؟`,
            {
                ...htmlOpts({ disable_web_page_preview: true }),
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'بله، دارد', callback_data: `areg_syn_y_${key}` },
                            { text: 'نه', callback_data: `areg_syn_n_${key}` }
                        ]
                    ]
                }
            }
        );
    }

    async _askSynopsisLink(ctx) {
        await ctx.reply(
            `${e('speech')} لینک <b>خلاصه داستان</b> را بفرست.\n` +
                `(مثلاً: <code>https://t.me/TheShioriArchive/507</code>)`,
            htmlOpts({ disable_web_page_preview: true })
        );
    }

    async _askHashtag(ctx) {
        await ctx.reply(
            `${e('flag')} <b>هشتگ انیمه</b> را بفرست.\n` +
                `(مثلاً: <code>#Chiramune</code>)`,
            htmlOpts({ disable_web_page_preview: true })
        );
    }

    async _askStaff(ctx) {
        await ctx.reply(
            `${e('pencil')} <b>اسم مترجم(ها)</b> را بفرست.\n\n` +
                `یک نفر: <code>Dawn</code>\n` +
                `دو نفر: <code>Dawn &amp; SayaKa</code>\n` +
                `سه‌نفر یا بیشتر: <code>SayaKa, Dawn &amp; Elixir</code>\n` +
                `(با ویرگول، <code>&amp;</code> یا «و» جدا کن)`,
            htmlOpts({ disable_web_page_preview: true })
        );
    }

    async _askKaraokeChoice(ctx, reg) {
        const key = this._regCbEncode(reg.filename_title);
        await ctx.reply(
            `${e('megaphone')} آیا این انیمه <b>کارائوکه (Karaoke)</b> هم دارد؟`,
            {
                ...htmlOpts({ disable_web_page_preview: true }),
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'بله، دارد', callback_data: `areg_kar_y_${key}` },
                            { text: 'نه', callback_data: `areg_kar_n_${key}` }
                        ]
                    ]
                }
            }
        );
    }

    /**
     * After karaoke choice: finalize or wait for E01 subtitle zip.
     * @param {import('telegraf').Context} ctx
     * @param {object} reg
     */
    async _continueRegistrationAfterKaraoke(ctx, reg) {
        const packOnly = reg.subtitle_mode === 'pack_only';
        if (!packOnly && !reg.subtitle_key) {
            await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                registration_step: 'awaiting_e01_sub'
            });
            await ctx.reply(
                `${e('package')} zip زیرنویس <b>E01</b> را در آرشیو آپلود کن.\n` +
                    `بعد از آپلود، ثبت انیمه ادامه پیدا می‌کند.`,
                htmlOpts()
            );
            return;
        }

        await scheduleDb.updateAnimeRegistration(reg.filename_title, {
            registration_step: 'cover_photo'
        });
        const fresh = await scheduleDb.getAnimeRegistration(reg.filename_title);
        await this._askRegistrationCoverPhoto(ctx, fresh);
    }

    async _askRegistrationCoverPhoto(ctx, reg) {
        const adminId = getAdminUserId();
        if (!adminId) return;

        await this._replyAdmin(
            ctx,
            `${e('clipboard')} <b>عکس پست انیمه</b>\n\n` +
                `روماجی: <code>${escapeHtml(reg.romaji_display)}</code>\n\n` +
                `قبل از ثبت نهایی، <b>عکس پست</b> را در همین چت بفرست.\n` +
                `بعد از آن پیام «انیمه ثبت شد» و پیش‌نمایش E01 ساخته می‌شود.`
        );
    }

    async _askSubtitleModeChoice(ctx, reg) {
        const key = this._regCbEncode(reg.filename_title);
        await ctx.reply(
            `${e('package')} <b>زیرنویس هر قسمت</b> جداگانه آپلود می‌کنی یا فقط <b>پک زیرنویس</b> در انتها؟`,
            {
                ...htmlOpts({ disable_web_page_preview: true }),
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'هر قسمت جدا', callback_data: `areg_sub_ep_${key}` },
                            { text: 'فقط پک', callback_data: `areg_sub_pk_${key}` }
                        ]
                    ]
                }
            }
        );
    }

    /**
     * @param {import('telegraf').Context} ctx
     * @param {object} reg
     */
    async _finalizeAnimeRegistration(ctx, reg) {
        const channelId = getSchedulePublishChannelId();
        if (!channelId) {
            await ctx.reply(
                `${e('error')} کانال انتشار تنظیم نشده (PUBLIC_POSTS_CHANNEL_ID یا SCHEDULE_TEST_CHANNEL_ID).`,
                htmlOpts()
            );
            return;
        }

        let slug = slugFromRomaji(reg.romaji_display);
        if (!slug) slug = `anime-${Date.now()}`;
        const existingSlug = await scheduleDb.getAnimeBySlug(slug);
        if (existingSlug) slug = `${slug}-${Date.now()}`;

        const subtitleMode = reg.subtitle_mode === 'pack_only' ? 'pack_only' : 'per_episode';
        const packOnly = subtitleMode === 'pack_only';

        if (!packOnly && !reg.subtitle_key) {
            await this._replyAdmin(
                ctx,
                `${e('warning')} برای حالت «هر قسمت جدا» ابتدا zip زیرنویس E01 را در آرشیو آپلود کن.`
            );
            return;
        }

        const anime = await scheduleDb.upsertAnime({
            slug,
            title: reg.english_title,
            filenameTitle: reg.filename_title,
            staff: reg.staff || config.SCHEDULE_DEFAULT_STAFF,
            hasKaraoke: Boolean(reg.has_karaoke),
            season: 1,
            status: 'ongoing',
            subtitleMode,
            hashtag: reg.hashtag,
            donationUrl: config.SCHEDULE_DEFAULT_DONATION_URL,
            synopsisUrl: reg.synopsis_url || null,
            coverPhotoFileId: reg.cover_photo_file_id || null,
            channelId: String(channelId)
        });

        await scheduleDb.deleteAnimeRegistration(reg.filename_title);
        await scheduleDb.upsertUploadBatch(anime.id, 1, 'video', reg.video_key);
        if (!packOnly && reg.subtitle_key) {
            await scheduleDb.upsertUploadBatch(anime.id, 1, 'subtitle', reg.subtitle_key);
        }

        const synopsisLine = reg.synopsis_url
            ? `Synopsis: ${escapeHtml(reg.synopsis_url)}\n`
            : 'Synopsis: (ندارد)\n';
        const subModeLine = packOnly
            ? 'زیرنویس: فقط پک (در انتها)\n'
            : 'زیرنویس: هر قسمت جدا\n';
        const karaokeLine = reg.has_karaoke ? 'Karaoke: بله\n' : '';

        await this._replyAdmin(
            ctx,
            `${e('success')} انیمه ثبت شد.\n` +
                `<b>English:</b> ${escapeHtml(reg.english_title)}\n` +
                `<b>Romaji:</b> <code>${escapeHtml(reg.romaji_display)}</code>\n` +
                `<b>Staff:</b> ${escapeHtml(reg.staff || config.SCHEDULE_DEFAULT_STAFF)}\n` +
                karaokeLine +
                `<b>Hashtag:</b> ${escapeHtml(reg.hashtag)}\n` +
                subModeLine +
                synopsisLine +
                `<b>slug:</b> <code>${escapeHtml(slug)}</code>\n\n` +
                `در حال ساخت پیش‌نمایش E01…`
        );

        console.log(`📋 Schedule: registered new anime slug=${slug} title="${reg.english_title}"`);
        try {
            await this._tryProposeNextInQueue(ctx, anime);
        } catch (error) {
            console.error('❌ Schedule preview after registration:', error);
            await this._replyAdmin(
                ctx,
                `${e('error')} ساخت پیش‌نمایش E01 ناموفق بود.\n` +
                    `<code>${escapeHtml(error.message || String(error))}</code>\n\n` +
                    `اگر ستون دیتابیس کم است، <code>scripts/sql/schedule_schema_catchup.sql</code> را روی Postgres اجرا کن.\n` +
                    `بعد ری‌استارت بات و دوباره E01 را در آرشیو آپلود کن.`
            );
        }
    }

    /**
     * Multi-step admin flow: English title → synopsis → hashtag → register.
     * @param {import('telegraf').Context} ctx
     * @returns {Promise<boolean>}
     */
    async handleAdminAnimeRegistration(ctx) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) return false;

        const text = ctx.message?.text?.trim();
        if (!text || text.startsWith('/')) return false;

        const reg = await scheduleDb.findActiveAnimeRegistration();
        if (!reg?.video_key) return false;

        const step = reg.registration_step || 'english';

        if (step === 'cover_photo') {
            await ctx.reply(
                `${e('warning')} عکس پست را در همین چت بفرست (نه متن).`,
                htmlOpts()
            );
            return true;
        }

        if (step === 'subtitle_mode' || step === 'karaoke') {
            await ctx.reply(
                `${e('warning')} با دکمه‌های پیام قبلی یکی از گزینه‌ها را انتخاب کن.`,
                htmlOpts()
            );
            return true;
        }

        if (step === 'staff') {
            if (text.length > 200) return false;
            const staff = normalizeStaffInput(text);
            if (!staff) {
                await ctx.reply(
                    `${e('warning')} اسم مترجم شناسایی نشد. مثال: <code>Dawn</code> یا <code>SayaKa, Dawn &amp; Elixir</code>`,
                    htmlOpts()
                );
                return true;
            }

            const updated = await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                staff,
                registration_step: 'karaoke'
            });
            await ctx.reply(`${e('check')} مترجم: <b>${escapeHtml(staff)}</b>`, htmlOpts());
            await this._askKaraokeChoice(ctx, updated);
            return true;
        }

        if (step === 'awaiting_e01_sub') {
            await ctx.reply(
                `${e('warning')} zip زیرنویس E01 را در <b>آرشیو</b> آپلود کن (نه در چت بات).`,
                htmlOpts()
            );
            return true;
        }

        if (step === 'synopsis') {
            await ctx.reply(
                `${e('warning')} با دکمه‌های پیام قبلی «بله» یا «نه» را انتخاب کن.`,
                htmlOpts()
            );
            return true;
        }

        if (step === 'english') {
            if (text.length > 200) return false;
            if (parsePackEpisodesSlug(text) || parsePackSubtitleKey(text)) return false;

            const updated = await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                english_title: text,
                registration_step: 'synopsis'
            });
            await ctx.reply(
                `${e('check')} اسم انگلیسی ثبت شد: <b>${escapeHtml(text)}</b>`,
                htmlOpts()
            );
            await this._askSynopsisChoice(ctx, updated);
            return true;
        }

        if (step === 'synopsis_link') {
            if (text.length > 500) return false;
            const synopsisUrl = this._normalizeSynopsisUrl(text);
            if (!synopsisUrl) {
                await ctx.reply(
                    `${e('warning')} لینک معتبر نیست. با <code>https://</code> یا <code>t.me/</code> شروع شود.`,
                    htmlOpts({ disable_web_page_preview: true })
                );
                return true;
            }

            const updated = await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                synopsis_url: synopsisUrl,
                registration_step: 'hashtag'
            });
            await ctx.reply(`${e('check')} لینک Synopsis ثبت شد.`, htmlOpts());
            await this._askHashtag(ctx);
            return true;
        }

        if (step === 'hashtag') {
            if (text.length > 100) return false;
            const hashtag = this._normalizeHashtag(text);
            if (!hashtag) {
                await ctx.reply(
                    `${e('warning')} هشتگ معتبر نیست. مثال: <code>#Chiramune</code>`,
                    htmlOpts()
                );
                return true;
            }

            const updated = await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                hashtag,
                registration_step: 'subtitle_mode'
            });
            await this._askSubtitleModeChoice(ctx, updated);
            return true;
        }

        return false;
    }

    /**
     * Inline button: synopsis yes/no during new anime registration.
     * @param {import('telegraf').Context} ctx
     * @param {boolean} hasSynopsis
     */
    async handleAnimeRegSynopsisChoice(ctx, hasSynopsis) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) {
            await ctx.answerCbQuery('فقط ادمین.');
            return;
        }

        const filenameTitle = this._regCbDecode(String(ctx.match[1]));
        const reg = await scheduleDb.getAnimeRegistration(filenameTitle);
        if (!reg?.video_key || reg.registration_step !== 'synopsis') {
            await ctx.answerCbQuery('این ثبت‌نام دیگر فعال نیست.');
            return;
        }

        await ctx.answerCbQuery(hasSynopsis ? 'بله' : 'نه');

        if (hasSynopsis) {
            await scheduleDb.updateAnimeRegistration(filenameTitle, {
                registration_step: 'synopsis_link'
            });
            await this._askSynopsisLink(ctx);
            return;
        }

        const updated = await scheduleDb.updateAnimeRegistration(filenameTitle, {
            synopsis_url: null,
            registration_step: 'hashtag'
        });
        await ctx.reply(`${e('check')} بدون Synopsis — فقط هشتگ مانده.`, htmlOpts());
        await this._askHashtag(ctx);
        return updated;
    }

    /**
     * Inline button: per-episode vs pack-only subtitles during registration.
     * @param {import('telegraf').Context} ctx
     * @param {'per_episode' | 'pack_only'} mode
     */
    async handleAnimeRegSubtitleModeChoice(ctx, mode) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) {
            await ctx.answerCbQuery('فقط ادمین.');
            return;
        }

        const filenameTitle = this._regCbDecode(String(ctx.match[1]));
        const reg = await scheduleDb.getAnimeRegistration(filenameTitle);
        if (!reg?.video_key || reg.registration_step !== 'subtitle_mode') {
            await ctx.answerCbQuery('این ثبت‌نام دیگر فعال نیست.');
            return;
        }

        const packOnly = mode === 'pack_only';
        await ctx.answerCbQuery(packOnly ? 'فقط پک' : 'هر قسمت جدا');

        const updated = await scheduleDb.updateAnimeRegistration(filenameTitle, {
            subtitle_mode: packOnly ? 'pack_only' : 'per_episode',
            registration_step: 'staff'
        });
        await this._askStaff(ctx);
        return updated;
    }

    /**
     * Inline button: karaoke yes/no during new anime registration.
     * @param {import('telegraf').Context} ctx
     * @param {boolean} hasKaraoke
     */
    async handleAnimeRegKaraokeChoice(ctx, hasKaraoke) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) {
            await ctx.answerCbQuery('فقط ادمین.');
            return;
        }

        const filenameTitle = this._regCbDecode(String(ctx.match[1]));
        const reg = await scheduleDb.getAnimeRegistration(filenameTitle);
        if (!reg?.video_key || !reg.staff || reg.registration_step !== 'karaoke') {
            await ctx.answerCbQuery('این ثبت‌نام دیگر فعال نیست.');
            return;
        }

        await ctx.answerCbQuery(hasKaraoke ? 'بله' : 'نه');

        await scheduleDb.updateAnimeRegistration(filenameTitle, { has_karaoke: hasKaraoke });
        const updated = await scheduleDb.getAnimeRegistration(filenameTitle);
        await this._continueRegistrationAfterKaraoke(ctx, updated);
    }

    /**
     * Send at most one preview: the next unpublished episode in order.
     * Later ready episodes wait until earlier ones are published.
     * @param {import('telegraf').Context} ctx
     * @param {object} anime
     */
    async _tryProposeNextInQueue(ctx, anime) {
        const active = await scheduleDb.findAnyActivePendingRelease(anime.id);
        if (active) {
            console.log(
                `📋 Schedule: awaiting admin on E${String(active.episode).padStart(2, '0')} ` +
                    `(pending=${active.id}) — later episodes queued`
            );
            return;
        }

        const packOnly = this._isPackOnlySubtitles(anime);
        const nextEpisode = (await scheduleDb.getMaxPublishedEpisode(anime.id)) + 1;
        const batch = await scheduleDb.getReadyBatch(anime.id, nextEpisode, packOnly);

        if (!batch) {
            const waiting = await scheduleDb.countReadyBatchesAfter(anime.id, nextEpisode, packOnly);
            if (waiting > 0) {
                console.log(
                    `📋 Schedule: ${waiting} later episode(s) ready but waiting for ` +
                        `E${String(nextEpisode).padStart(2, '0')} upload`
                );
            }
            return;
        }

        const previewSent = await this.proposeRelease(
            ctx,
            anime,
            nextEpisode,
            batch.video_key,
            batch.subtitle_key || null,
            false
        );
        if (previewSent) {
            await scheduleDb.markBatchDone(anime.id, nextEpisode);
            const queued = await scheduleDb.countReadyBatchesAfter(anime.id, nextEpisode, packOnly);
            if (queued > 0) {
                console.log(`📋 Schedule: ${queued} more episode(s) queued after publish`);
            }
        }
    }

    /**
     * @param {import('telegraf').Context} ctx
     * @returns {Promise<boolean>}
     */
    async proposeRelease(ctx, anime, episode, videoKey, subtitleKey, markCompleted) {
        const botUsername = await this._getBotUsername(ctx);
        if (!botUsername) return false;

        const completed = markCompleted || anime.status === 'completed';
        const draftPending = {
            episode,
            videoKey,
            subtitleKey: subtitleKey || null,
            markCompleted: completed
        };
        const caption = completed
            ? await this._buildCompletedCaption(anime, draftPending, botUsername)
            : await this._buildOngoingCaption(anime, draftPending, botUsername);

        if (caption.length > 4096) {
            console.error(`❌ Schedule post too long (${caption.length}/4096)`);
            await this._notifyAdmin(
                ctx,
                `${e('warning')} متن پیشنهادی برای ${anime.title} E${episode} خیلی بلند است (${caption.length} کاراکتر).`
            );
            return false;
        }

        const needsCoverPhoto =
            this._animeNeedsCoverPhoto(anime) && !anime.coverPhotoFileId;

        const pending = await scheduleDb.createPendingRelease({
            animeId: anime.id,
            episode,
            videoKey,
            subtitleKey,
            markCompleted: completed,
            proposedCaption: caption,
            needsCoverPhoto
        });

        if (anime.coverPhotoFileId) {
            await scheduleDb.updatePending(pending.id, {
                coverPhotoFileId: anime.coverPhotoFileId
            });
        }

        if (needsCoverPhoto) {
            await this._askCoverPhotoBeforePreview(ctx, anime, episode, pending.id);
            console.log(`📋 Schedule awaiting cover photo before preview pending=${pending.id}`);
            return true;
        }

        await this._sendAdminPreview(ctx, anime, pending, completed);
        return true;
    }

    async _askCoverPhotoBeforePreview(ctx, anime, episode, pendingId) {
        const adminId = getAdminUserId();
        if (!adminId) return;

        await ctx.telegram.sendMessage(
            adminId,
            `${e('clipboard')} <b>عکس پست لازم است</b>\n\n` +
                `انیمه: <b>${escapeHtml(anime.title)}</b>\n` +
                `قسمت: E${String(episode).padStart(2, '0')}\n\n` +
                `برای ساخت پیش‌نمایش، ابتدا <b>عکس پست</b> را در همین چت بفرست.\n` +
                `بعد از آن پیش‌نمایش با دکمه‌های تأیید ارسال می‌شود.`,
            htmlOpts({ disable_web_page_preview: true })
        );
    }

    /**
     * Admin preview — caption block matches exactly what will be published to the channel.
     */
    async _sendAdminPreview(ctx, anime, pending, completed) {
        const caption = pending.proposedCaption;
        const testBanner = isScheduleTestMode()
            ? `🧪 <b>حالت تست</b> — انتشار در کانال تست (نه TheShioriSub)\n\n`
            : '';

        const previewText =
            `${e('clipboard')} <b>پیش‌نمایش انتشار${isScheduleTestMode() ? ' (تست)' : ' TheShioriSub'}</b>\n\n` +
            testBanner +
            `انیمه: ${anime.title}\n` +
            `قسمت: E${String(pending.episode).padStart(2, '0')}\n` +
            `وضعیت: ${completed ? 'تمام‌شده (پک + تشکر)' : 'در حال پخش'}\n` +
            (this._isPackOnlySubtitles(anime)
                ? `\n📦 این انیمه <b>فقط پک زیرنویس</b> دارد — لینک Subtitle هر قسمت در پست نیست.\n`
                : `\n📦 با «+ انیمه تمام شد» اگر پک در سیستم نباشد، لینک <b>پک قسمت‌ها</b> و <b>پک زیرنویس</b> را می‌پرسیم.\n`) +
            `\n────────────\n` +
            `<i>متن پست کانال (همان چیزی که منتشر می‌شود):</i>\n\n` +
            caption;

        const adminId = getAdminUserId();
        const sent = await ctx.telegram.sendMessage(adminId, previewText, {
            ...htmlOpts({ disable_web_page_preview: true }),
            reply_markup: this._previewKeyboard(pending.id, false)
        });

        await scheduleDb.updatePending(pending.id, {
            adminPreviewChatId: sent.chat.id,
            adminPreviewMessageId: sent.message_id
        });

        console.log(`📋 Schedule preview sent to admin pending=${pending.id}`);
    }

    /**
     * Admin uploads cover image in private chat.
     * @param {import('telegraf').Context} ctx
     * @returns {Promise<boolean>}
     */
    async handleAdminCoverPhoto(ctx) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) return false;

        const fileId = this._extractPhotoFileId(ctx.message);
        if (!fileId) return false;

        const reg = await scheduleDb.findActiveAnimeRegistration();
        if (reg?.registration_step === 'cover_photo') {
            const updated = await scheduleDb.updateAnimeRegistration(reg.filename_title, {
                cover_photo_file_id: fileId,
                registration_step: 'done'
            });
            await this._finalizeAnimeRegistration(ctx, updated);
            return true;
        }

        const pending = await scheduleDb.findPendingAwaitingCover();
        if (!pending) {
            await ctx.reply(
                `${e('info')} پیش‌نمایشی در انتظار عکس نیست.`,
                htmlOpts()
            );
            return true;
        }

        const anime = await scheduleDb.getAnimeById(pending.animeId);
        await scheduleDb.updatePending(pending.id, { coverPhotoFileId: fileId });
        await scheduleDb.updateAnimeCoverPhoto(pending.animeId, fileId);

        if (!pending.adminPreviewMessageId) {
            const fresh = await scheduleDb.getPendingById(pending.id);
            const completed = fresh.markCompleted || anime?.status === 'completed';
            await ctx.reply(
                `${e('success')} عکس پست ثبت شد — در حال ساخت پیش‌نمایش…`,
                htmlOpts()
            );
            await this._sendAdminPreview(ctx, anime, { ...fresh, coverPhotoFileId: fileId }, completed);
            console.log(`📋 Schedule cover photo set + preview sent pending=${pending.id}`);
            return true;
        }

        await ctx.reply(
            `${e('success')} عکس پست برای <b>${anime?.title ?? 'انیمه'}</b> ` +
                `(E${String(pending.episode).padStart(2, '0')}) به‌روز شد.`,
            htmlOpts()
        );
        console.log(`📋 Schedule cover photo updated pending=${pending.id}`);
        return true;
    }

    /**
     * Admin sends pack links/keys in private chat (after «+ انیمه تمام شد»).
     * @param {import('telegraf').Context} ctx
     * @returns {Promise<boolean>}
     */
    async handleAdminPackInfo(ctx) {
        const adminId = getAdminUserId();
        if (!adminId || String(ctx.from?.id) !== adminId) return false;

        const text = ctx.message?.text?.trim();
        if (!text) return false;

        const pending = await scheduleDb.findPendingAwaitingPack();
        if (!pending) return false;

        const anime = await scheduleDb.getAnimeById(pending.animeId);
        const packs = this._resolvePacks(pending, anime);
        const patch = {};

        if (!packs.packEpisodesSlug) {
            const slug = parsePackEpisodesSlug(text);
            if (!slug) {
                await ctx.reply(
                    `${e('warning')} لینک پک <b>قسمت‌ها</b> شناسایی نشد.\n` +
                        `مثال: <code>https://t.me/Bot?start=pack_pack_slug</code>\n` +
                        `یا: <code>pack_pack_slug</code>`,
                    htmlOpts()
                );
                return true;
            }
            patch.packEpisodesSlug = slug;
        } else if (!packs.packSubtitleKey) {
            const key = parsePackSubtitleKey(text);
            if (!key) {
                await ctx.reply(
                    `${e('warning')} key پک <b>زیرنویس</b> شناسایی نشد.\n` +
                        `مثال: <code>https://t.me/Bot?start=get_123456789</code>\n` +
                        `یا فقط عدد key`,
                    htmlOpts()
                );
                return true;
            }
            patch.packSubtitleKey = key;
        } else {
            return false;
        }

        const updated = await scheduleDb.updatePending(pending.id, patch);
        const merged = { ...pending, ...updated };
        const resolved = this._resolvePacks(merged, anime);

        if (!resolved.packEpisodesSlug) {
            await ctx.reply(
                `${e('success')} پک قسمت‌ها ثبت شد.\n` +
                    `حالا لینک یا key <b>پک زیرنویس</b> را بفرست.`,
                htmlOpts()
            );
            return true;
        }

        if (!resolved.packSubtitleKey) {
            await ctx.reply(
                `${e('info')} پک قسمت‌ها از قبل ثبت بود.\n` +
                    `لطفاً لینک یا key <b>پک زیرنویس</b> را بفرست.`,
                htmlOpts()
            );
            return true;
        }

        const botUsername = ctx.botInfo?.username;
        const caption = await this._buildCompletedCaption(anime, merged, botUsername);

        if (caption.length > 4096) {
            await ctx.reply(
                `${e('error')} متن با پک‌ها خیلی بلند است (${caption.length}/4096).`,
                htmlOpts()
            );
            return true;
        }

        await scheduleDb.updatePending(pending.id, {
            proposedCaption: caption,
            needsPackInfo: false
        });
        await scheduleDb.updateAnimePacks(
            anime.id,
            resolved.packEpisodesSlug,
            resolved.packSubtitleKey
        );

        await ctx.reply(
            `${e('success')} هر دو پک برای <b>${anime.title}</b> ثبت شد.\n` +
                `کپشن به‌روز شد — دوباره «✅ + انیمه تمام شد» را بزن تا منتشر شود.`,
            htmlOpts()
        );
        console.log(`📋 Schedule pack info set pending=${pending.id}`);
        return true;
    }

    async _requestPackInfo(ctx, anime, pending, pendingId) {
        const packs = this._resolvePacks(pending, anime);
        const missing = [];
        if (!packs.packEpisodesSlug) missing.push('پک قسمت‌ها');
        if (!packs.packSubtitleKey) missing.push('پک زیرنویس');

        await scheduleDb.updatePending(pendingId, {
            markCompleted: true,
            needsPackInfo: true
        });

        await ctx.answerCbQuery('لینک پک‌ها را در چت بات بفرستید.', { show_alert: true });

        let stepHint;
        if (!packs.packEpisodesSlug) {
            stepHint =
                `1️⃣ لینک <b>پک قسمت‌ها</b> (مثلاً <code>?start=pack_...</code>)\n` +
                `2️⃣ بعد key یا لینک <b>پک زیرنویس</b> (مثلاً <code>?start=get_...</code>)`;
        } else {
            stepHint = `key یا لینک <b>پک زیرنویس</b> را بفرست (مثلاً <code>?start=get_...</code>).`;
        }

        await ctx.reply(
            `📦 برای انتشار <b>${anime.title}</b> (E${String(pending.episode).padStart(2, '0')}) ` +
                `به‌عنوان انیمه تمام‌شده، این موارد را در همین چت بفرست:\n\n` +
                `${stepHint}\n\n` +
                `فعلاً کمبود: ${missing.join('، ')}\n` +
                `بعد از ثبت هر دو، دوباره «✅ + انیمه تمام شد» را بزن.`,
            htmlOpts({ disable_web_page_preview: true })
        );
    }

    /**
     * @param {import('telegraf').Context} ctx
     * @param {number} pendingId
     * @param {'approve' | 'complete' | 'reject'} action
     */
    async handleApproval(ctx, pendingId, action) {
        const adminId = getAdminUserId();
        if (String(ctx.from?.id) !== adminId) {
            await ctx.answerCbQuery('فقط ادمین می‌تواند تأیید کند.', { show_alert: true });
            return;
        }

        const pending = await scheduleDb.getPendingById(pendingId);
        if (!pending || pending.status !== 'pending') {
            await ctx.answerCbQuery('این درخواست دیگر فعال نیست.', { show_alert: true });
            return;
        }

        if (action === 'reject') {
            if (pending.status !== 'pending') {
                await ctx.answerCbQuery('این درخواست قبلاً منتشر شده — رد فقط قبل از انتشار ممکن است.', {
                    show_alert: true
                });
                return;
            }
            await scheduleDb.updatePending(pendingId, { status: 'rejected' });
            await ctx.answerCbQuery('رد شد.');
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            return;
        }

        const anime = await scheduleDb.getAnimeById(pending.animeId);
        let markCompleted = pending.markCompleted;

        if (action === 'complete') {
            markCompleted = true;
            const botUsername = ctx.botInfo?.username;

            if (!this._packsAreComplete(pending, anime)) {
                const caption = await this._buildCompletedCaption(anime, pending, botUsername);
                if (caption.length > 4096) {
                    await ctx.answerCbQuery('متن با پک‌ها خیلی بلند است.', { show_alert: true });
                    return;
                }
                await scheduleDb.updatePending(pendingId, { proposedCaption: caption });
                pending.proposedCaption = caption;
                await this._requestPackInfo(ctx, anime, pending, pendingId);
                pending.markCompleted = true;
                pending.needsPackInfo = true;
                return;
            }

            const caption = await this._buildCompletedCaption(anime, pending, botUsername);
            if (caption.length > 4096) {
                await ctx.answerCbQuery('متن با پک‌ها خیلی بلند است.', { show_alert: true });
                return;
            }

            await scheduleDb.updatePending(pendingId, {
                markCompleted: true,
                proposedCaption: caption,
                needsPackInfo: false
            });
            pending.markCompleted = true;
            pending.proposedCaption = caption;
            pending.needsPackInfo = false;
        }

        const claimed = await scheduleDb.claimPendingRelease(pendingId);
        if (!claimed) {
            await ctx.answerCbQuery('این درخواست در حال پردازش یا قبلاً منتشر شده.', { show_alert: true });
            return;
        }

        await ctx.answerCbQuery('در حال انتشار...');

        try {
            const publishedId = await this._publish(claimed);
            await scheduleDb.updatePending(pendingId, {
                status: 'published',
                publishedMessageId: publishedId
            });
            await ctx.editMessageReplyMarkup(this._previewKeyboard(pendingId, true));
            const channelId = this._getScheduleChannelId(await scheduleDb.getAnimeById(claimed.animeId));
            const anime = await scheduleDb.getAnimeById(claimed.animeId);
            const channelLabel = isScheduleTestMode() ? 'کانال تست' : 'TheShioriSub';
            await ctx.reply(
                `${e('success')} پست در <b>${channelLabel}</b> منتشر شد.\n` +
                    `کانال: <code>${channelId}</code>\nmessage_id: ${publishedId}`,
                htmlOpts({ disable_web_page_preview: true })
            );
            await this._tryProposeNextInQueue(ctx, anime);
        } catch (error) {
            console.error('❌ Schedule publish failed:', error);
            await scheduleDb.releasePendingClaim(pendingId);
            await ctx.reply(`${e('error')} خطا در انتشار: ${error.message}`, htmlOpts());
        }
    }

    /**
     * Re-publish an already approved release (e.g. after deleting channel post).
     * @param {import('telegraf').Context} ctx
     * @param {number} pendingId
     */
    async handleRepublish(ctx, pendingId) {
        const adminId = getAdminUserId();
        if (String(ctx.from?.id) !== adminId) {
            await ctx.answerCbQuery('فقط ادمین می‌تواند تأیید کند.', { show_alert: true });
            return;
        }

        const pending = await scheduleDb.getPendingById(pendingId);
        if (!pending || pending.status !== 'published') {
            await ctx.answerCbQuery('انتشار مجدد فقط برای پست‌های منتشرشده ممکن است.', {
                show_alert: true
            });
            return;
        }

        await ctx.answerCbQuery('در حال انتشار مجدد...');

        try {
            const publishedId = await this._publish(pending);
            await scheduleDb.updatePending(pendingId, { publishedMessageId: publishedId });
            const channelId = this._getScheduleChannelId(
                await scheduleDb.getAnimeById(pending.animeId)
            );
            const channelLabel = isScheduleTestMode() ? 'کانال تست' : 'TheShioriSub';
            await ctx.reply(
                `${e('success')} پست دوباره در <b>${channelLabel}</b> منتشر شد.\n` +
                    `کانال: <code>${channelId}</code>\nmessage_id: ${publishedId}`,
                htmlOpts({ disable_web_page_preview: true })
            );
        } catch (error) {
            console.error('❌ Schedule republish failed:', error);
            await ctx.reply(`${e('error')} خطا در انتشار مجدد: ${error.message}`, htmlOpts());
        }
    }

    /**
     * @param {object} pending
     * @returns {Promise<number>}
     */
    async _publish(pending) {
        const anime = await scheduleDb.getAnimeById(pending.animeId);
        const channelId = this._getScheduleChannelId(anime);
        const sourceMessageId =
            anime.latestScheduleMessageId || anime.templateMessageId;

        if (!channelId) {
            throw new Error('کانال انتشار schedule تنظیم نشده');
        }

        if (isScheduleTestMode()) {
            console.log(`🧪 Schedule publish → TEST channel ${channelId}`);
        }

        const caption = pending.proposedCaption;
        if (!caption) {
            throw new Error('کپشن پست خالی است');
        }
        if (caption.length > 4096) {
            throw new Error(`متن پست خیلی بلند است (${caption.length}/4096)`);
        }

        const photoFileId =
            pending.coverPhotoFileId || anime.coverPhotoFileId || null;

        const captionPayload = channelCaptionOpts(caption);
        let newMessageId;

        if (photoFileId) {
            console.log(
                `📋 Schedule publishing pending=${pending.id} channel=${channelId} ` +
                    `sendPhoto ep=${pending.episode}`
            );

            const sent = await this.telegram.telegram.sendPhoto(channelId, photoFileId, captionPayload);
            newMessageId = sent.message_id;

            if (!anime.coverPhotoFileId) {
                await scheduleDb.updateAnimeCoverPhoto(anime.id, photoFileId);
            }
        } else if (sourceMessageId) {
            console.log(
                `📋 Schedule publishing pending=${pending.id} channel=${channelId} ` +
                    `copyMessage source_msg=${sourceMessageId} ep=${pending.episode}`
            );

            try {
                const copied = await this.telegram.telegram.copyMessage(
                    channelId,
                    channelId,
                    sourceMessageId,
                    captionPayload
                );
                newMessageId = typeof copied === 'number' ? copied : copied?.message_id;
            } catch (copyErr) {
                console.warn('📋 copyMessage with caption failed, fallback to edit:', copyErr.message);
                const copied = await this.telegram.telegram.copyMessage(
                    channelId,
                    channelId,
                    sourceMessageId
                );
                newMessageId = typeof copied === 'number' ? copied : copied?.message_id;
                if (!newMessageId) {
                    throw new Error('copyMessage did not return message_id');
                }
                await this.telegram.telegram.editMessageCaption(
                    channelId,
                    newMessageId,
                    undefined,
                    captionPayload.caption,
                    {
                        caption_entities: captionPayload.caption_entities,
                        disable_web_page_preview: true
                    }
                );
            }

            if (!newMessageId) {
                throw new Error('copyMessage did not return message_id');
            }
        } else {
            throw new Error('عکس پست تنظیم نشده — ابتدا عکس را برای بات بفرستید');
        }

        await scheduleDb.upsertEpisode(
            anime.id,
            pending.episode,
            pending.videoKey,
            pending.subtitleKey
        );

        await scheduleDb.updateAnimeScheduleMessage(
            anime.id,
            newMessageId,
            pending.markCompleted ? 'completed' : null
        );

        if (pending.markCompleted) {
            const packs = this._resolvePacks(pending, anime);
            if (packs.packEpisodesSlug && packs.packSubtitleKey) {
                await scheduleDb.updateAnimePacks(
                    anime.id,
                    packs.packEpisodesSlug,
                    packs.packSubtitleKey
                );
            }
        }

        console.log(
            `✅ Schedule published anime=${anime.slug} ep=${pending.episode} msg=${newMessageId}`
        );
        return newMessageId;
    }

    async _notifyAdmin(ctx, text) {
        const adminId = getAdminUserId();
        if (!adminId) return;
        await ctx.telegram.sendMessage(adminId, text, htmlOpts());
    }

    async _replyAdmin(ctx, text, opts = {}) {
        const adminId = getAdminUserId();
        if (!adminId) return;
        const options = htmlOpts(opts);
        if (String(ctx.chat?.id) === String(adminId)) {
            await ctx.reply(text, options);
        } else {
            await ctx.telegram.sendMessage(adminId, text, options);
        }
    }
}

module.exports = new ScheduleService();
