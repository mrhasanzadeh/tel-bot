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
        season: row.season ?? 1,
        status: row.status,
        hashtag: row.hashtag,
        donationUrl: row.donation_url,
        synopsisUrl: row.synopsis_url,
        packEpisodesSlug: row.pack_episodes_slug,
        packSubtitleKey: row.pack_subtitle_key,
        templateMessageId: row.template_message_id,
        latestScheduleMessageId: row.latest_schedule_message_id,
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
        publishedMessageId: row.published_message_id
    };
}

class ScheduleDatabaseService {
    async findAnimeByFilenameTitle(title) {
        const normalized = normalizeFilenameTitle(title);
        const { data: rows, error } = await supabase.from('anime_posts').select('*');
        if (error) throw error;
        const match = (rows || []).find(
            (r) => normalizeFilenameTitle(r.filename_title) === normalized
        );
        return mapAnime(match);
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
            season: anime.season ?? 1,
            status: anime.status ?? 'ongoing',
            hashtag: anime.hashtag ?? null,
            donation_url: anime.donationUrl ?? null,
            synopsis_url: anime.synopsisUrl ?? null,
            pack_episodes_slug: anime.packEpisodesSlug ?? null,
            pack_subtitle_key: anime.packSubtitleKey ?? null,
            template_message_id: anime.templateMessageId ?? null,
            latest_schedule_message_id: anime.latestScheduleMessageId ?? null,
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

        const row = {
            anime_id: animeId,
            episode,
            video_key: kind === 'video' ? fileKey : (existing?.video_key ?? null),
            subtitle_key: kind === 'subtitle' ? fileKey : (existing?.subtitle_key ?? null),
            status: existing?.status === 'done' ? 'done' : 'pending',
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
                admin_preview_message_id: payload.adminPreviewMessageId ?? null
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

        const { data, error } = await supabase
            .from('schedule_pending_releases')
            .update(dbPatch)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return mapPending(data);
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
