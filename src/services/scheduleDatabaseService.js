const supabase = require('./supabaseClient');
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

class ScheduleDatabaseService {
    async findAnimeByFilenameTitle(title) {
        const normalized = normalizeFilenameTitle(title);
        const { data, error } = await supabase
            .from('anime_posts')
            .select('*')
            .eq('filename_title', normalized)
            .maybeSingle();
        if (error) throw error;
        return mapAnime(data);
    }

    async getAnimeById(id) {
        const { data, error } = await supabase
            .from('anime_posts')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return mapAnime(data);
    }

    async getAnimeBySlug(slug) {
        const { data, error } = await supabase
            .from('anime_posts')
            .select('*')
            .eq('slug', slug)
            .maybeSingle();
        if (error) throw error;
        return mapAnime(data);
    }

    async upsertAnime(anime) {
        const row = {
            slug: anime.slug,
            title: anime.title,
            filename_title: anime.filenameTitle,
            staff: anime.staff ?? null,
            has_karaoke: anime.hasKaraoke ?? false,
            season: anime.season ?? 1,
            status: anime.status ?? 'ongoing',
            subtitle_mode: anime.subtitleMode ?? 'per_episode',
            hashtag: anime.hashtag ?? null,
            donation_url: anime.donationUrl ?? null,
            synopsis_url: anime.synopsisUrl ?? null,
            pack_episodes_slug: anime.packEpisodesSlug ?? null,
            pack_subtitle_key: anime.packSubtitleKey ?? null,
            template_message_id: anime.templateMessageId ?? null,
            latest_schedule_message_id: anime.latestScheduleMessageId ?? null,
            cover_photo_file_id: anime.coverPhotoFileId ?? null,
            channel_id: anime.channelId,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('anime_posts')
            .upsert(row, { onConflict: 'slug' })
            .select('*')
            .single();
        if (error) throw error;
        return mapAnime(data);
    }

    async listEpisodes(animeId) {
        const { data, error } = await supabase
            .from('anime_episode_files')
            .select('*')
            .eq('anime_id', animeId)
            .order('episode', { ascending: true });
        if (error) throw error;
        return (data || []).map(mapEpisode);
    }

    async upsertEpisode(animeId, episode, videoKey, subtitleKey) {
        const { data, error } = await supabase
            .from('anime_episode_files')
            .upsert(
                {
                    anime_id: animeId,
                    episode,
                    video_key: videoKey,
                    subtitle_key: subtitleKey
                },
                { onConflict: 'anime_id,episode' }
            )
            .select('*')
            .single();
        if (error) throw error;
        return mapEpisode(data);
    }

    async upsertUploadBatch(animeId, episode, kind, fileKey) {
        const { data: existing, error: fetchErr } = await supabase
            .from('episode_upload_batches')
            .select('*')
            .eq('anime_id', animeId)
            .eq('episode', episode)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        let videoKey = kind === 'video' ? fileKey : (existing?.video_key ?? null);
        let subtitleKey = kind === 'subtitle' ? fileKey : (existing?.subtitle_key ?? null);

        // Re-uploading one half (new key) invalidates the other — not the first arrival.
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

        // Allow re-test uploads: new file keys reopen a previously done batch.
        const status =
            existing?.status === 'done' && !keysChanged ? 'done' : 'pending';

        const row = {
            anime_id: animeId,
            episode,
            video_key: videoKey,
            subtitle_key: subtitleKey,
            status,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('episode_upload_batches')
            .upsert(row, { onConflict: 'anime_id,episode' })
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    async markBatchDone(animeId, episode) {
        const { error } = await supabase
            .from('episode_upload_batches')
            .update({ status: 'done', updated_at: new Date().toISOString() })
            .eq('anime_id', animeId)
            .eq('episode', episode);
        if (error) throw error;
    }

    async getMaxPublishedEpisode(animeId) {
        const episodes = await this.listEpisodes(animeId);
        if (!episodes.length) return 0;
        return Math.max(...episodes.map((ep) => ep.episode));
    }

    async getReadyBatch(animeId, episode, packOnly = false) {
        const { data, error } = await supabase
            .from('episode_upload_batches')
            .select('*')
            .eq('anime_id', animeId)
            .eq('episode', episode)
            .eq('status', 'pending')
            .maybeSingle();
        if (error) throw error;
        if (!data?.video_key) return null;
        if (!packOnly && !data.subtitle_key) return null;
        return data;
    }

    async countReadyBatchesAfter(animeId, afterEpisode, packOnly = false) {
        let query = supabase
            .from('episode_upload_batches')
            .select('episode')
            .eq('anime_id', animeId)
            .eq('status', 'pending')
            .gt('episode', afterEpisode)
            .not('video_key', 'is', null);

        if (!packOnly) {
            query = query.not('subtitle_key', 'is', null);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []).length;
    }

    async findAnyActivePendingRelease(animeId) {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('anime_id', animeId)
            .in('status', ['pending', 'publishing'])
            .order('episode', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    async findActivePendingRelease(animeId, episode) {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('anime_id', animeId)
            .eq('episode', episode)
            .in('status', ['pending', 'publishing'])
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    /** Atomically mark pending → publishing; returns null if already claimed. */
    async claimPendingRelease(id) {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .update({
                status: 'publishing',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('status', 'pending')
            .select('*')
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    async releasePendingClaim(id) {
        const { error } = await supabase
            .from('schedule_pending_releases')
            .update({
                status: 'pending',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('status', 'publishing');
        if (error) throw error;
    }

    async createPendingRelease(payload) {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .insert({
                anime_id: payload.animeId,
                episode: payload.episode,
                video_key: payload.videoKey,
                subtitle_key: payload.subtitleKey,
                mark_completed: payload.markCompleted ?? false,
                proposed_caption: payload.proposedCaption,
                status: 'pending',
                admin_preview_chat_id: payload.adminPreviewChatId ?? null,
                admin_preview_message_id: payload.adminPreviewMessageId ?? null,
                needs_cover_photo: payload.needsCoverPhoto ?? false
            })
            .select('*')
            .single();
        if (error) throw error;
        return mapPending(data);
    }

    async getPendingById(id) {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    async updatePending(id, patch) {
        const dbPatch = { updated_at: new Date().toISOString() };
        if (patch.status !== undefined) dbPatch.status = patch.status;
        if (patch.markCompleted !== undefined) dbPatch.mark_completed = patch.markCompleted;
        if (patch.proposedCaption !== undefined) dbPatch.proposed_caption = patch.proposedCaption;
        if (patch.adminPreviewChatId !== undefined) dbPatch.admin_preview_chat_id = patch.adminPreviewChatId;
        if (patch.adminPreviewMessageId !== undefined) {
            dbPatch.admin_preview_message_id = patch.adminPreviewMessageId;
        }
        if (patch.publishedMessageId !== undefined) dbPatch.published_message_id = patch.publishedMessageId;
        if (patch.publishAt !== undefined) dbPatch.publish_at = patch.publishAt;
        if (patch.needsCoverPhoto !== undefined) dbPatch.needs_cover_photo = patch.needsCoverPhoto;
        if (patch.coverPhotoFileId !== undefined) dbPatch.cover_photo_file_id = patch.coverPhotoFileId;
        if (patch.needsPackInfo !== undefined) dbPatch.needs_pack_info = patch.needsPackInfo;
        if (patch.packEpisodesSlug !== undefined) dbPatch.pack_episodes_slug = patch.packEpisodesSlug;
        if (patch.packSubtitleKey !== undefined) dbPatch.pack_subtitle_key = patch.packSubtitleKey;

        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .update(dbPatch)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return mapPending(data);
    }

    async findPendingAwaitingPack() {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('status', 'pending')
            .eq('needs_pack_info', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    async updateAnimeCoverPhoto(animeId, coverPhotoFileId) {
        const { data, error } = await supabase
            .from('anime_posts')
            .update({
                cover_photo_file_id: coverPhotoFileId,
                updated_at: new Date().toISOString()
            })
            .eq('id', animeId)
            .select('*')
            .single();
        if (error) throw error;
        return mapAnime(data);
    }

    async updateAnimePacks(animeId, packEpisodesSlug, packSubtitleKey) {
        const { data, error } = await supabase
            .from('anime_posts')
            .update({
                pack_episodes_slug: packEpisodesSlug,
                pack_subtitle_key: packSubtitleKey,
                updated_at: new Date().toISOString()
            })
            .eq('id', animeId)
            .select('*')
            .single();
        if (error) throw error;
        return mapAnime(data);
    }

    async findPendingAwaitingCover() {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('status', 'pending')
            .eq('needs_cover_photo', true)
            .is('cover_photo_file_id', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return mapPending(data);
    }

    async listScheduledReleases() {
        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .select('*')
            .eq('status', 'scheduled')
            .order('publish_at', { ascending: true });
        if (error) throw error;
        return (data || []).map(mapPending);
    }

    async upsertAnimeRegistration(filenameTitle, romajiDisplay, kind, fileKey) {
        const { data: existing, error: fetchErr } = await supabase
            .from('anime_registration_pending')
            .select('*')
            .eq('filename_title', filenameTitle)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        const row = {
            filename_title: filenameTitle,
            romaji_display: romajiDisplay,
            video_key: kind === 'video' ? fileKey : (existing?.video_key ?? null),
            subtitle_key: kind === 'subtitle' ? fileKey : (existing?.subtitle_key ?? null),
            asked_at: existing?.asked_at ?? null,
            registration_step: existing?.registration_step ?? null,
            english_title: existing?.english_title ?? null,
            synopsis_url: existing?.synopsis_url ?? null,
            hashtag: existing?.hashtag ?? null,
            subtitle_mode: existing?.subtitle_mode ?? null,
            staff: existing?.staff ?? null,
            has_karaoke: existing?.has_karaoke ?? null,
            cover_photo_file_id: existing?.cover_photo_file_id ?? null,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('anime_registration_pending')
            .upsert(row, { onConflict: 'filename_title' })
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    async markAnimeRegistrationAsked(filenameTitle) {
        const { data, error } = await supabase
            .from('anime_registration_pending')
            .update({
                asked_at: new Date().toISOString(),
                registration_step: 'english',
                updated_at: new Date().toISOString()
            })
            .eq('filename_title', filenameTitle)
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    async findActiveAnimeRegistration() {
        const { data, error } = await supabase
            .from('anime_registration_pending')
            .select('*')
            .not('asked_at', 'is', null)
            .order('asked_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async getAnimeRegistration(filenameTitle) {
        const { data, error } = await supabase
            .from('anime_registration_pending')
            .select('*')
            .eq('filename_title', filenameTitle)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async updateAnimeRegistration(filenameTitle, patch) {
        const { data, error } = await supabase
            .from('anime_registration_pending')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('filename_title', filenameTitle)
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    async deleteAnimeRegistration(filenameTitle) {
        const { error } = await supabase
            .from('anime_registration_pending')
            .delete()
            .eq('filename_title', filenameTitle);
        if (error) throw error;
    }

    async updateAnimeScheduleMessage(animeId, messageId, status) {
        const patch = {
            latest_schedule_message_id: messageId,
            updated_at: new Date().toISOString()
        };
        if (status) patch.status = status;

        const { data, error } = await supabase
            .from('anime_posts')
            .update(patch)
            .eq('id', animeId)
            .select('*')
            .single();
        if (error) throw error;
        return mapAnime(data);
    }
}

module.exports = new ScheduleDatabaseService();
