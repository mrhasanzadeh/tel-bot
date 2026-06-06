const config = require('../../config');
const scheduleDb = require('./scheduleDatabaseService');
const { parseAnimeFilename } = require('../utils/animeFilenameParser');
const { buildScheduleCaption } = require('./captionBuilderService');
const { getPublicPostsChannelId, getAdminUserId } = require('../utils/channelIds');

class ScheduleService {
    constructor() {
        this.telegram = null;
    }

    /** @param {import('telegraf').Telegraf} bot */
    setTelegram(bot) {
        this.telegram = bot;
    }

    isEnabled() {
        return Boolean(
            getAdminUserId() &&
            getPublicPostsChannelId() &&
            this.telegram
        );
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
            console.log(`📋 Schedule: no anime registered for filename title "${parsed.title}"`);
            return;
        }

        const batch = await scheduleDb.upsertUploadBatch(
            anime.id,
            parsed.episode,
            parsed.kind,
            fileData.key
        );

        if (!batch.video_key || !batch.subtitle_key) {
            console.log(
                `📋 Schedule: waiting for pair anime=${anime.slug} ep=${parsed.episode} ` +
                    `video=${Boolean(batch.video_key)} sub=${Boolean(batch.subtitle_key)}`
            );
            return;
        }

        if (batch.status === 'done') {
            console.log(`📋 Schedule: batch already processed ep=${parsed.episode}`);
            return;
        }

        await this.proposeRelease(ctx, anime, parsed.episode, batch.video_key, batch.subtitle_key, false);
        await scheduleDb.markBatchDone(anime.id, parsed.episode);
    }

    /**
     * @param {import('telegraf').Context} ctx
     */
    async proposeRelease(ctx, anime, episode, videoKey, subtitleKey, markCompleted) {
        const botUsername = ctx.botInfo?.username;
        if (!botUsername) return;

        const existingEpisodes = await scheduleDb.listEpisodes(anime.id);
        const episodeMap = new Map(existingEpisodes.map((e) => [e.episode, e]));

        episodeMap.set(episode, { episode, videoKey, subtitleKey });

        const episodes = [...episodeMap.values()].sort((a, b) => a.episode - b.episode);
        const maxEp = Math.max(...episodes.map((e) => e.episode));

        const completed = markCompleted || anime.status === 'completed';
        const caption = buildScheduleCaption({
            botUsername,
            title: anime.title,
            staff: anime.staff || 'Dawn',
            season: anime.season,
            episodes,
            newEpisode: episode,
            completed,
            hashtag: anime.hashtag,
            donationUrl: anime.donationUrl,
            synopsisUrl: anime.synopsisUrl,
            packEpisodesSlug: completed ? anime.packEpisodesSlug : null,
            packSubtitleKey: completed ? anime.packSubtitleKey : null,
            episodeRangeEnd: maxEp
        });

        if (caption.length > 4096) {
            console.error(`❌ Schedule post too long (${caption.length}/4096)`);
            await this._notifyAdmin(
                ctx,
                `⚠️ متن پیشنهادی برای ${anime.title} E${episode} خیلی بلند است (${caption.length} کاراکتر).`
            );
            return;
        }

        const pending = await scheduleDb.createPendingRelease({
            animeId: anime.id,
            episode,
            videoKey,
            subtitleKey,
            markCompleted: completed,
            proposedCaption: caption
        });

        const previewText =
            `📋 پیش‌نمایش انتشار اسکجول\n\n` +
            `انیمه: ${anime.title}\n` +
            `قسمت: E${String(episode).padStart(2, '0')}\n` +
            `وضعیت: ${completed ? 'تمام‌شده (پک + تشکر)' : 'در حال پخش'}\n\n` +
            `────────────\n` +
            caption;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ تأیید و انتشار', callback_data: `sched_a_${pending.id}` },
                    { text: '✅ + انیمه تمام شد', callback_data: `sched_c_${pending.id}` }
                ],
                [{ text: '❌ رد', callback_data: `sched_r_${pending.id}` }]
            ]
        };

        const adminId = getAdminUserId();
        const sent = await ctx.telegram.sendMessage(adminId, previewText, {
            reply_markup: keyboard,
            disable_web_page_preview: true
        });

        await scheduleDb.updatePending(pending.id, {
            adminPreviewChatId: sent.chat.id,
            adminPreviewMessageId: sent.message_id
        });

        console.log(`📋 Schedule preview sent to admin pending=${pending.id}`);
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
            await scheduleDb.updatePending(pendingId, { status: 'rejected' });
            await ctx.answerCbQuery('رد شد.');
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            return;
        }

        let markCompleted = pending.markCompleted;
        if (action === 'complete') {
            markCompleted = true;
            const anime = await scheduleDb.getAnimeById(pending.animeId);
            const botUsername = ctx.botInfo?.username;
            const existingEpisodes = await scheduleDb.listEpisodes(anime.id);
            const episodeMap = new Map(existingEpisodes.map((e) => [e.episode, e]));
            episodeMap.set(pending.episode, {
                episode: pending.episode,
                videoKey: pending.videoKey,
                subtitleKey: pending.subtitleKey
            });
            const episodes = [...episodeMap.values()].sort((a, b) => a.episode - b.episode);
            const maxEp = Math.max(...episodes.map((e) => e.episode));

            const caption = buildScheduleCaption({
                botUsername,
                title: anime.title,
                staff: anime.staff || 'Dawn',
                season: anime.season,
                episodes,
                newEpisode: pending.episode,
                completed: true,
                hashtag: anime.hashtag,
                donationUrl: anime.donationUrl,
                synopsisUrl: anime.synopsisUrl,
                packEpisodesSlug: anime.packEpisodesSlug,
                packSubtitleKey: anime.packSubtitleKey,
                episodeRangeEnd: maxEp
            });

            if (caption.length > 4096) {
                await ctx.answerCbQuery('متن با پک‌ها خیلی بلند است.', { show_alert: true });
                return;
            }

            await scheduleDb.updatePending(pendingId, {
                markCompleted: true,
                proposedCaption: caption
            });
            pending.markCompleted = true;
            pending.proposedCaption = caption;
        }

        await ctx.answerCbQuery('در حال انتشار...');

        try {
            const publishedId = await this._publish(pending);
            await scheduleDb.updatePending(pendingId, {
                status: 'published',
                publishedMessageId: publishedId
            });
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            await ctx.reply(`✅ پست اسکجول منتشر شد (message_id: ${publishedId})`);
        } catch (error) {
            console.error('❌ Schedule publish failed:', error);
            await ctx.reply(`❌ خطا در انتشار: ${error.message}`);
        }
    }

    /**
     * @param {object} pending
     * @returns {Promise<number>}
     */
    async _publish(pending) {
        const anime = await scheduleDb.getAnimeById(pending.animeId);
        const channelId = getPublicPostsChannelId();
        const sourceMessageId =
            anime.latestScheduleMessageId || anime.templateMessageId;

        if (!sourceMessageId) {
            throw new Error('template_message_id یا latest_schedule_message_id تنظیم نشده');
        }

        const copied = await this.telegram.telegram.copyMessage(
            channelId,
            channelId,
            sourceMessageId
        );
        const newMessageId = typeof copied === 'number' ? copied : copied?.message_id;
        if (!newMessageId) {
            throw new Error('copyMessage did not return message_id');
        }

        try {
            await this.telegram.telegram.editMessageText(
                channelId,
                newMessageId,
                undefined,
                pending.proposedCaption,
                { disable_web_page_preview: true }
            );
        } catch (textErr) {
            await this.telegram.telegram.editMessageCaption(
                channelId,
                newMessageId,
                undefined,
                pending.proposedCaption
            );
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

        console.log(
            `✅ Schedule published anime=${anime.slug} ep=${pending.episode} msg=${newMessageId}`
        );
        return newMessageId;
    }

    async _notifyAdmin(ctx, text) {
        const adminId = getAdminUserId();
        if (!adminId) return;
        await ctx.telegram.sendMessage(adminId, text);
    }
}

module.exports = new ScheduleService();
