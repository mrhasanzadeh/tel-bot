/**
 * Integration-style test against real FileHandlerService methods with mocks.
 * Run: node scripts/test-file-handler-archive-fix.js
 */
const assert = require('assert');
const path = require('path');

const ARCHIVE_ID = '-100111111';
const PRIVATE_ID = '-100222222';

// Stub config before loading service graph
process.env.PRIVATE_CHANNEL_ID = PRIVATE_ID;
process.env.LINKS_CHANNEL_ID = ARCHIVE_ID;
process.env.ARCHIVE_CHANNEL_ID = ARCHIVE_ID;

const root = path.join(__dirname, '..');

/** @type {Map<string, any>} */
const stubs = new Map();

function stubModule(absPath, exports) {
    const resolved = require.resolve(absPath);
    stubs.set(resolved, exports);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: [],
    };
}

const dbCalls = {
    createFile: [],
    updateFileByMessageId: [],
};

stubModule(path.join(root, 'src/services/databaseService.js'), {
    createFile: async (data) => {
        dbCalls.createFile.push(data);
        return data;
    },
    updateFileByMessageId: async (messageId, updateData) => {
        dbCalls.updateFileByMessageId.push({ messageId, updateData });
        return { nModified: 1 };
    },
    getFileByKey: async () => null,
    getFileByMessageId: async () => null,
    upsertFile: async () => ({}),
    incrementFileDownloads: async () => null,
    deactivateFilesByMessageId: async () => 0,
});

stubModule(path.join(root, 'src/services/scheduleService.js'), {
    onFileRegistered: async () => {},
});

stubModule(path.join(root, 'src/utils/botReply.js'), {
    reply: async () => ({}),
});

stubModule(path.join(root, 'config.js'), {
    PRIVATE_CHANNEL_ID: PRIVATE_ID,
    LINKS_CHANNEL_ID: ARCHIVE_ID,
    ARCHIVE_CHANNEL_ID: ARCHIVE_ID,
    PACK_FILE_DELETE_MS: 30_000,
});

// Clear fileHandlerService from cache so it picks up stubs
const fhsPath = require.resolve(path.join(root, 'src/services/fileHandlerService.js'));
delete require.cache[fhsPath];
delete require.cache[require.resolve(path.join(root, 'src/utils/channelIntakeGuards.js'))];
delete require.cache[require.resolve(path.join(root, 'src/utils/channelIds.js'))];
delete require.cache[require.resolve(path.join(root, 'src/utils/fileUtils.js'))];

const fileHandlerService = require(path.join(root, 'src/services/fileHandlerService.js'));

function makeCtx({ chatId, channelPost, editedChannelPost }) {
    const editedCaptions = [];
    const copies = [];
    return {
        chat: { id: chatId },
        channelPost,
        editedChannelPost,
        botInfo: { id: 1, username: 'test_bot' },
        telegram: {
            copyMessage: async (toChatId, fromChatId, messageId) => {
                copies.push({ toChatId, fromChatId, messageId });
                return { message_id: 9001 };
            },
            getChatMember: async () => ({
                status: 'administrator',
                can_edit_messages: true,
            }),
            editMessageCaption: async (channelId, messageId, _inline, caption) => {
                editedCaptions.push({ channelId, messageId, caption });
                return true;
            },
            deleteMessage: async () => true,
        },
        _copies: copies,
        _editedCaptions: editedCaptions,
    };
}

async function testArchiveIngestCopiesOnceAndCaptionsOnlyPrivate() {
    dbCalls.createFile.length = 0;
    const ctx = makeCtx({
        chatId: ARCHIVE_ID,
        channelPost: {
            message_id: 42,
            caption: 'raw archive',
            document: {
                file_id: 'fid-1',
                file_name: 'episode.mkv',
                file_size: 123,
            },
        },
    });

    await fileHandlerService.handleArchiveChannelPost(ctx);

    assert.strictEqual(ctx._copies.length, 1, 'exactly one copyMessage');
    assert.strictEqual(String(ctx._copies[0].toChatId), PRIVATE_ID);
    assert.strictEqual(dbCalls.createFile.length, 1, 'exactly one DB create');

    // Caption only on private copy (9001), never on archive (42)
    assert.strictEqual(ctx._editedCaptions.length, 1);
    assert.strictEqual(String(ctx._editedCaptions[0].channelId), PRIVATE_ID);
    assert.strictEqual(ctx._editedCaptions[0].messageId, 9001);
    assert.ok(ctx._editedCaptions[0].caption.includes('Key:'));

    // Simulated private channel_post from copy — must be skipped
    const privateCtx = makeCtx({
        chatId: PRIVATE_ID,
        channelPost: {
            message_id: 9001,
            document: {
                file_id: 'fid-1',
                file_name: 'episode.mkv',
                file_size: 123,
            },
        },
    });
    await fileHandlerService.handleNewFile(privateCtx);
    assert.strictEqual(dbCalls.createFile.length, 1, 'copy intake must not double-register');
}

async function testArchiveEditDoesNotRecopy() {
    const ctx = makeCtx({
        chatId: ARCHIVE_ID,
        editedChannelPost: {
            message_id: 42,
            caption: 'edited',
            document: {
                file_id: 'fid-2',
                file_name: 'episode-v2.mkv',
                file_size: 456,
            },
        },
    });
    ctx.chat = { id: ARCHIVE_ID };

    await fileHandlerService.handleEditedArchiveChannelPost(
        ctx,
        ctx.editedChannelPost
    );

    assert.strictEqual(ctx._copies.length, 0, 'archive edit must not copyMessage');
    assert.strictEqual(ctx._editedCaptions.length, 0, 'archive edit must not caption');
}

async function testLinksReplaceUpdatesDbFileName() {
    dbCalls.updateFileByMessageId.length = 0;
    const message = {
        message_id: 777,
        caption: 'user replaced',
        document: {
            file_id: 'fid-3',
            file_name: 'renamed-episode.mkv',
            file_size: 999,
        },
    };
    const ctx = makeCtx({
        chatId: PRIVATE_ID,
        editedChannelPost: message,
    });

    await fileHandlerService.handleEditedPrivateChannelPost(ctx, message);

    assert.strictEqual(dbCalls.updateFileByMessageId.length, 1);
    assert.strictEqual(dbCalls.updateFileByMessageId[0].messageId, 777);
    assert.strictEqual(
        dbCalls.updateFileByMessageId[0].updateData.fileName,
        'renamed-episode.mkv'
    );
}

async function testBotCaptionEditOnLinksIsSkipped() {
    dbCalls.updateFileByMessageId.length = 0;
    // Pretend bot just stamped caption on msg 888
    fileHandlerService._intakeGuards.markBotCaptionEdit(PRIVATE_ID, 888);

    const message = {
        message_id: 888,
        caption: '🔑 Key: 123\n🔗 Direct Link: https://t.me/bot?start=get_123',
        document: {
            file_id: 'fid-4',
            file_name: 'same.mkv',
            file_size: 1,
        },
    };
    const ctx = makeCtx({ chatId: PRIVATE_ID, editedChannelPost: message });
    await fileHandlerService.handleEditedPrivateChannelPost(ctx, message);

    assert.strictEqual(
        dbCalls.updateFileByMessageId.length,
        0,
        'bot caption stamp must not trigger DB update'
    );
}

async function main() {
    await testArchiveIngestCopiesOnceAndCaptionsOnlyPrivate();
    await testArchiveEditDoesNotRecopy();
    await testLinksReplaceUpdatesDbFileName();
    await testBotCaptionEditOnLinksIsSkipped();
    console.log('✅ fileHandlerService archive fix tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
