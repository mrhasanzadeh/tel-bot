const pg = require('./postgresClient');
const { normalizeFilenameTitle } = require('../utils/animeFilenameParser');

function mapAnime(row) {
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        filenameTitle: row.filename_title,
        staff: row.staff,
        hasKaraoke: row.has_karaoke ?? false,
        season: row.season ?? 1,
        status: row.status,
        subtitleMode: row.subtitle_mode ?? 'per_episode',
        hashtag: row.hashtag,
        donationUrl: row.donation_url,
        synopsisUrl: row.synopsis_url,
        packEpisodesSlug: row.pack_episodes_slug,
        packSubtitleKey: row.pack_subtitle_key,
        templateMessageId: row.template_message_id,
        latestScheduleMessageId: row.latest_schedule_message_id,
        coverPhotoFileId: row.cover_photo_file_id,
        channelId: row.channel_id
    };
}

function mapEpisode(row) {
    if (!row) return null;
    return {
        id: row.id,
        animeId: row.anime_id,
        episode: row.episode,
        videoKey: row.video_key,
        subtitleKey: row.subtitle_key
    };
}

function mapPending(row) {
    if (!row) return null;
    return {
        id: row.id,
        animeId: row.anime_id,
        episode: row.episode,
        videoKey: row.video_key,
        subtitleKey: row.subtitle_key,
        markCompleted: row.mark_completed,
        proposedCaption: row.proposed_caption,
        status: row.status,
        adminPreviewChatId: row.admin_preview_chat_id,
        adminPreviewMessageId: row.admin_preview_message_id,
        publishedMessageId: row.published_message_id,
        publishAt: row.publish_at,
        needsCoverPhoto: row.needs_cover_photo ?? false,
        coverPhotoFileId: row.cover_photo_file_id,
        needsPackInfo: row.needs_pack_info ?? false,
        packEpisodesSlug: row.pack_episodes_slug,
        packSubtitleKey: row.pack_subtitle_key
    };
}

async function one(sql, params = []) {
    const { rows } = await pg.query(sql, params);
    return rows[0] ?? null;
}

async function many(sql, params = []) {
    const { rows } = await pg.query(sql, params);
    return rows;
}

class ScheduleDatabaseService {
    async findAnimeByFilenameTitle(title) {
        const normalized = normalizeFilenameTitle(title);
        const row = await one('SELECT * FROM anime_posts WHERE filename_title = $1', [normalized]);
        return mapAnime(row);
    }

    async getAnimeById(id) {
        const row = await one('SELECT * FROM anime_posts WHERE id = $1', [id]);
        return mapAnime(row);
    }

    async getAnimeBySlug(slug) {
        const row = await one('SELECT * FROM anime_posts WHERE slug = $1', [slug]);
        return mapAnime(row);
    }

    async upsertAnime(anime) {
        const row = await one(
            `INSERT INTO anime_posts (
                slug, title, filename_title, staff, has_karaoke, season, status,
                subtitle_mode, hashtag, donation_url, synopsis_url, pack_episodes_slug,
                pack_subtitle_key, template_message_id, latest_schedule_message_id,
                cover_photo_file_id, channel_id, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now()
            )
            ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title,
                filename_title = EXCLUDED.filename_title,
                staff = EXCLUDED.staff,
                has_karaoke = EXCLUDED.has_karaoke,
                season = EXCLUDED.season,
                status = EXCLUDED.status,
                subtitle_mode = EXCLUDED.subtitle_mode,
                hashtag = EXCLUDED.hashtag,
                donation_url = EXCLUDED.donation_url,
                synopsis_url = EXCLUDED.synopsis_url,
                pack_episodes_slug = EXCLUDED.pack_episodes_slug,
                pack_subtitle_key = EXCLUDED.pack_subtitle_key,
                template_message_id = EXCLUDED.template_message_id,
                latest_schedule_message_id = EXCLUDED.latest_schedule_message_id,
                cover_photo_file_id = EXCLUDED.cover_photo_file_id,
                channel_id = EXCLUDED.channel_id,
                updated_at = now()
            RETURNING *`,
            [
                anime.slug,
                anime.title,
                anime.filenameTitle,
                anime.staff ?? null,
                anime.hasKaraoke ?? false,
                anime.season ?? 1,
                anime.status ?? 'ongoing',
                anime.subtitleMode ?? 'per_episode',
                anime.hashtag ?? null,
                anime.donationUrl ?? null,
                anime.synopsisUrl ?? null,
                anime.packEpisodesSlug ?? null,
                anime.packSubtitleKey ?? null,
                anime.templateMessageId ?? null,
                anime.latestScheduleMessageId ?? null,
                anime.coverPhotoFileId ?? null,
                anime.channelId
            ]
        );
        return mapAnime(row);
    }

    async listEpisodes(animeId) {
        const rows = await many(
            'SELECT * FROM anime_episode_files WHERE anime_id = $1 ORDER BY episode ASC',
            [animeId]
        );
        return rows.map(mapEpisode);
    }

    async upsertEpisode(animeId, episode, videoKey, subtitleKey) {
        const row = await one(
            `INSERT INTO anime_episode_files (anime_id, episode, video_key, subtitle_key)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (anime_id, episode) DO UPDATE SET
                video_key = EXCLUDED.video_key,
                subtitle_key = EXCLUDED.subtitle_key
             RETURNING *`,
            [animeId, episode, videoKey, subtitleKey]
        );
        return mapEpisode(row);
    }

    async upsertUploadBatch(animeId, episode, kind, fileKey) {
        const existing = await one(
            'SELECT * FROM episode_upload_batches WHERE anime_id = $1 AND episode = $2',
            [animeId, episode]
        );

        let videoKey = kind === 'video' ? fileKey : (existing?.video_key ?? null);
        let subtitleKey = kind === 'subtitle' ? fileKey : (existing?.subtitle_key ?? null);

        if (existing) {
            if (kind === 'video' && existing.video_key && existing.video_key !== fileKey) {
                subtitleKey = null;
            }
            if (kind === 'subtitle' && existing.subtitle_key && existing.subtitle_key !== fileKey) {
                videoKey = null;
            }
        }

        const keysChanged =
            !existing ||
            videoKey !== existing.video_key ||
            subtitleKey !== existing.subtitle_key;

        const status =
            existing?.status === 'done' && !keysChanged ? 'done' : 'pending';

        return one(
            `INSERT INTO episode_upload_batches (
                anime_id, episode, video_key, subtitle_key, status, updated_at
            ) VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (anime_id, episode) DO UPDATE SET
                video_key = EXCLUDED.video_key,
                subtitle_key = EXCLUDED.subtitle_key,
                status = EXCLUDED.status,
                updated_at = now()
            RETURNING *`,
            [animeId, episode, videoKey, subtitleKey, status]
        );
    }

    async markBatchDone(animeId, episode) {
        await pg.query(
            `UPDATE episode_upload_batches
             SET status = 'done', updated_at = now()
             WHERE anime_id = $1 AND episode = $2`,
            [animeId, episode]
        );
    }

    async getMaxPublishedEpisode(animeId) {
        const episodes = await this.listEpisodes(animeId);
        if (!episodes.length) return 0;
        return Math.max(...episodes.map((ep) => ep.episode));
    }

    async getReadyBatch(animeId, episode, packOnly = false) {
        const row = await one(
            `SELECT * FROM episode_upload_batches
             WHERE anime_id = $1 AND episode = $2 AND status = 'pending'`,
            [animeId, episode]
        );
        if (!row?.video_key) return null;
        if (!packOnly && !row.subtitle_key) return null;
        return row;
    }

    async countReadyBatchesAfter(animeId, afterEpisode, packOnly = false) {
        const sql = packOnly
            ? `SELECT episode FROM episode_upload_batches
               WHERE anime_id = $1 AND status = 'pending' AND episode > $2 AND video_key IS NOT NULL`
            : `SELECT episode FROM episode_upload_batches
               WHERE anime_id = $1 AND status = 'pending' AND episode > $2
                 AND video_key IS NOT NULL AND subtitle_key IS NOT NULL`;
        const rows = await many(sql, [animeId, afterEpisode]);
        return rows.length;
    }

    async findAnyActivePendingRelease(animeId) {
        const row = await one(
            `SELECT * FROM schedule_pending_releases
             WHERE anime_id = $1 AND status IN ('pending', 'publishing')
             ORDER BY episode ASC
             LIMIT 1`,
            [animeId]
        );
        return mapPending(row);
    }

    async findActivePendingRelease(animeId, episode) {
        const row = await one(
            `SELECT * FROM schedule_pending_releases
             WHERE anime_id = $1 AND episode = $2 AND status IN ('pending', 'publishing')`,
            [animeId, episode]
        );
        return mapPending(row);
    }

    async claimPendingRelease(id) {
        const row = await one(
            `UPDATE schedule_pending_releases
             SET status = 'publishing', updated_at = now()
             WHERE id = $1 AND status = 'pending'
             RETURNING *`,
            [id]
        );
        return mapPending(row);
    }

    async releasePendingClaim(id) {
        await pg.query(
            `UPDATE schedule_pending_releases
             SET status = 'pending', updated_at = now()
             WHERE id = $1 AND status = 'publishing'`,
            [id]
        );
    }

    async createPendingRelease(payload) {
        const row = await one(
            `INSERT INTO schedule_pending_releases (
                anime_id, episode, video_key, subtitle_key, mark_completed,
                proposed_caption, status, admin_preview_chat_id, admin_preview_message_id,
                needs_cover_photo
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
            RETURNING *`,
            [
                payload.animeId,
                payload.episode,
                payload.videoKey,
                payload.subtitleKey,
                payload.markCompleted ?? false,
                payload.proposedCaption,
                payload.adminPreviewChatId ?? null,
                payload.adminPreviewMessageId ?? null,
                payload.needsCoverPhoto ?? false
            ]
        );
        return mapPending(row);
    }

    async getPendingById(id) {
        const row = await one('SELECT * FROM schedule_pending_releases WHERE id = $1', [id]);
        return mapPending(row);
    }

    async updatePending(id, patch) {
        const fields = [];
        const values = [];
        let i = 1;

        const add = (col, val) => {
            fields.push(`${col} = $${i++}`);
            values.push(val);
        };

        if (patch.status !== undefined) add('status', patch.status);
        if (patch.markCompleted !== undefined) add('mark_completed', patch.markCompleted);
        if (patch.proposedCaption !== undefined) add('proposed_caption', patch.proposedCaption);
        if (patch.adminPreviewChatId !== undefined) add('admin_preview_chat_id', patch.adminPreviewChatId);
        if (patch.adminPreviewMessageId !== undefined) {
            add('admin_preview_message_id', patch.adminPreviewMessageId);
        }
        if (patch.publishedMessageId !== undefined) add('published_message_id', patch.publishedMessageId);
        if (patch.publishAt !== undefined) add('publish_at', patch.publishAt);
        if (patch.needsCoverPhoto !== undefined) add('needs_cover_photo', patch.needsCoverPhoto);
        if (patch.coverPhotoFileId !== undefined) add('cover_photo_file_id', patch.coverPhotoFileId);
        if (patch.needsPackInfo !== undefined) add('needs_pack_info', patch.needsPackInfo);
        if (patch.packEpisodesSlug !== undefined) add('pack_episodes_slug', patch.packEpisodesSlug);
        if (patch.packSubtitleKey !== undefined) add('pack_subtitle_key', patch.packSubtitleKey);

        fields.push('updated_at = now()');
        values.push(id);

        const row = await one(
            `UPDATE schedule_pending_releases SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
            values
        );
        return mapPending(row);
    }

    async findPendingAwaitingPack() {
        const row = await one(
            `SELECT * FROM schedule_pending_releases
             WHERE status = 'pending' AND needs_pack_info = true
             ORDER BY created_at DESC
             LIMIT 1`
        );
        return mapPending(row);
    }

    async updateAnimeCoverPhoto(animeId, coverPhotoFileId) {
        const row = await one(
            `UPDATE anime_posts
             SET cover_photo_file_id = $2, updated_at = now()
             WHERE id = $1
             RETURNING *`,
            [animeId, coverPhotoFileId]
        );
        return mapAnime(row);
    }

    async updateAnimePacks(animeId, packEpisodesSlug, packSubtitleKey) {
        const row = await one(
            `UPDATE anime_posts
             SET pack_episodes_slug = $2, pack_subtitle_key = $3, updated_at = now()
             WHERE id = $1
             RETURNING *`,
            [animeId, packEpisodesSlug, packSubtitleKey]
        );
        return mapAnime(row);
    }

    async findPendingAwaitingCover() {
        const row = await one(
            `SELECT * FROM schedule_pending_releases
             WHERE status = 'pending' AND needs_cover_photo = true AND cover_photo_file_id IS NULL
             ORDER BY created_at DESC
             LIMIT 1`
        );
        return mapPending(row);
    }

    async listScheduledReleases() {
        const rows = await many(
            `SELECT * FROM schedule_pending_releases
             WHERE status = 'scheduled'
             ORDER BY publish_at ASC`
        );
        return rows.map(mapPending);
    }

    async upsertAnimeRegistration(filenameTitle, romajiDisplay, kind, fileKey) {
        const existing = await one(
            'SELECT * FROM anime_registration_pending WHERE filename_title = $1',
            [filenameTitle]
        );

        const row = await one(
            `INSERT INTO anime_registration_pending (
                filename_title, romaji_display, video_key, subtitle_key, asked_at,
                registration_step, english_title, synopsis_url, hashtag, subtitle_mode,
                staff, has_karaoke, cover_photo_file_id, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
            ON CONFLICT (filename_title) DO UPDATE SET
                romaji_display = EXCLUDED.romaji_display,
                video_key = EXCLUDED.video_key,
                subtitle_key = EXCLUDED.subtitle_key,
                asked_at = EXCLUDED.asked_at,
                registration_step = EXCLUDED.registration_step,
                english_title = EXCLUDED.english_title,
                synopsis_url = EXCLUDED.synopsis_url,
                hashtag = EXCLUDED.hashtag,
                subtitle_mode = EXCLUDED.subtitle_mode,
                staff = EXCLUDED.staff,
                has_karaoke = EXCLUDED.has_karaoke,
                cover_photo_file_id = EXCLUDED.cover_photo_file_id,
                updated_at = now()
            RETURNING *`,
            [
                filenameTitle,
                romajiDisplay,
                kind === 'video' ? fileKey : (existing?.video_key ?? null),
                kind === 'subtitle' ? fileKey : (existing?.subtitle_key ?? null),
                existing?.asked_at ?? null,
                existing?.registration_step ?? null,
                existing?.english_title ?? null,
                existing?.synopsis_url ?? null,
                existing?.hashtag ?? null,
                existing?.subtitle_mode ?? null,
                existing?.staff ?? null,
                existing?.has_karaoke ?? null,
                existing?.cover_photo_file_id ?? null
            ]
        );
        return row;
    }

    async markAnimeRegistrationAsked(filenameTitle) {
        return one(
            `UPDATE anime_registration_pending
             SET asked_at = now(), registration_step = 'english', updated_at = now()
             WHERE filename_title = $1
             RETURNING *`,
            [filenameTitle]
        );
    }

    async findActiveAnimeRegistration() {
        return one(
            `SELECT * FROM anime_registration_pending
             WHERE asked_at IS NOT NULL
             ORDER BY asked_at DESC
             LIMIT 1`
        );
    }

    async getAnimeRegistration(filenameTitle) {
        return one(
            'SELECT * FROM anime_registration_pending WHERE filename_title = $1',
            [filenameTitle]
        );
    }

    async updateAnimeRegistration(filenameTitle, patch) {
        const keys = Object.keys(patch);
        if (!keys.length) {
            return this.getAnimeRegistration(filenameTitle);
        }

        const fields = keys.map((key, idx) => `${key} = $${idx + 2}`);
        fields.push('updated_at = now()');
        const values = [filenameTitle, ...keys.map((key) => patch[key])];

        return one(
            `UPDATE anime_registration_pending SET ${fields.join(', ')}
             WHERE filename_title = $1
             RETURNING *`,
            values
        );
    }

    async deleteAnimeRegistration(filenameTitle) {
        await pg.query('DELETE FROM anime_registration_pending WHERE filename_title = $1', [
            filenameTitle
        ]);
    }

    async updateAnimeScheduleMessage(animeId, messageId, status) {
        const row = status
            ? await one(
                  `UPDATE anime_posts
                   SET latest_schedule_message_id = $2, status = $3, updated_at = now()
                   WHERE id = $1
                   RETURNING *`,
                  [animeId, messageId, status]
              )
            : await one(
                  `UPDATE anime_posts
                   SET latest_schedule_message_id = $2, updated_at = now()
                   WHERE id = $1
                   RETURNING *`,
                  [animeId, messageId]
              );
        return mapAnime(row);
    }
}

module.exports = new ScheduleDatabaseService();
