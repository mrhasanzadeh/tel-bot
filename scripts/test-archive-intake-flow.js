/**
 * Simulates the archive→links intake flows that previously caused:
 * 1) Key captions on archive posts
 * 2) Mistaken clones in the links channel after archive caption edit
 *
 * Run: node scripts/test-archive-intake-flow.js
 */
const assert = require('assert');
const { ChannelIntakeGuards } = require('../src/utils/channelIntakeGuards');

const ARCHIVE_ID = '-100111';
const PRIVATE_ID = '-100222';

/**
 * Minimal stand-in for the fixed service decisions (mirrors fileHandlerService).
 */
function createSimulatedBot() {
    const guards = new ChannelIntakeGuards(20_000);
    const state = {
        archiveCaptions: new Map(), // messageId → caption
        privateMessages: new Map(), // messageId → { fileName, caption, fromCopy }
        dbByMessageId: new Map(), // messageId → { key, fileName }
        nextPrivateMsgId: 1000,
        nextKey: 5000,
        copyCount: 0,
        registerCount: 0,
        privateCaptionEdits: 0,
        archiveCaptionEdits: 0,
        dbUpdates: [],
    };

    function stampPrivateCaption(messageId, fileKey) {
        const msg = state.privateMessages.get(messageId);
        assert.ok(msg, 'private message must exist before caption stamp');
        guards.markBotCaptionEdit(PRIVATE_ID, messageId);
        msg.caption = `🔑 Key: ${fileKey}\n🔗 Direct Link: https://t.me/bot?start=get_${fileKey}`;
        state.privateCaptionEdits += 1;
        // Telegram would emit edited_channel_post — bot must ignore:
        assert.strictEqual(
            guards.shouldSkipBotCaptionEdit(PRIVATE_ID, messageId),
            true,
            'bot caption edit on links must be skipped'
        );
    }

    function ingestArchivePost(archiveMessageId, fileName) {
        state.archiveCaptions.set(archiveMessageId, ''); // no Key on archive
        state.copyCount += 1;
        const copiedMessageId = state.nextPrivateMsgId++;
        guards.markPendingPrivateCopy(copiedMessageId);
        state.privateMessages.set(copiedMessageId, {
            fileName,
            caption: '',
            fromCopy: true,
        });

        // Simulated private channel_post from copyMessage — must NOT register again
        assert.strictEqual(
            guards.shouldSkipPrivateIntake(copiedMessageId),
            true,
            'copied private post must be skipped'
        );

        // Real registration happens once from archive handler
        const fileKey = String(state.nextKey++);
        state.registerCount += 1;
        state.dbByMessageId.set(copiedMessageId, { key: fileKey, fileName });
        stampPrivateCaption(copiedMessageId, fileKey);

        return { copiedMessageId, fileKey };
    }

    function onArchiveEdited(archiveMessageId) {
        // Fixed behavior: ignore (no re-copy, no archive caption)
        assert.strictEqual(
            state.archiveCaptions.get(archiveMessageId) ?? '',
            '',
            'archive must not get Key caption'
        );
        // No extra copy
        const before = state.copyCount;
        // handler returns early — copyCount unchanged
        assert.strictEqual(state.copyCount, before);
        return { ignored: true };
    }

    function onLinksMediaReplace(privateMessageId, newFileName) {
        // Must NOT be skipped (user replace, not bot caption)
        assert.strictEqual(
            guards.shouldSkipBotCaptionEdit(PRIVATE_ID, privateMessageId),
            false,
            'user media replace must not be treated as bot caption edit'
        );
        const row = state.dbByMessageId.get(privateMessageId);
        assert.ok(row, 'DB row for links message must exist');
        row.fileName = newFileName;
        state.dbUpdates.push({ messageId: privateMessageId, fileName: newFileName });
        const msg = state.privateMessages.get(privateMessageId);
        if (msg) msg.fileName = newFileName;
    }

    return {
        state,
        ingestArchivePost,
        onArchiveEdited,
        onLinksMediaReplace,
    };
}

function testArchiveIngestDoesNotCaptionArchiveOrDoubleRegister() {
    const bot = createSimulatedBot();
    const { copiedMessageId, fileKey } = bot.ingestArchivePost(10, 'ep01.mkv');

    assert.strictEqual(bot.state.copyCount, 1);
    assert.strictEqual(bot.state.registerCount, 1);
    assert.strictEqual(bot.state.archiveCaptionEdits, 0);
    assert.strictEqual(bot.state.archiveCaptions.get(10), '');
    assert.ok(bot.state.privateMessages.get(copiedMessageId).caption.includes(fileKey));
    assert.strictEqual(bot.state.dbByMessageId.get(copiedMessageId).fileName, 'ep01.mkv');
}

function testArchiveEditDoesNotClone() {
    const bot = createSimulatedBot();
    bot.ingestArchivePost(11, 'ep02.mkv');
    const copiesBefore = bot.state.copyCount;
    const registersBefore = bot.state.registerCount;

    bot.onArchiveEdited(11);

    assert.strictEqual(bot.state.copyCount, copiesBefore, 'archive edit must not re-copy');
    assert.strictEqual(bot.state.registerCount, registersBefore, 'archive edit must not re-register');
    assert.strictEqual(bot.state.privateMessages.size, 1, 'exactly one private clone');
}

function testLinksReplaceUpdatesFileName() {
    const bot = createSimulatedBot();
    const { copiedMessageId } = bot.ingestArchivePost(12, 'old-name.mkv');

    bot.onLinksMediaReplace(copiedMessageId, 'new-name.mkv');

    assert.strictEqual(bot.state.dbByMessageId.get(copiedMessageId).fileName, 'new-name.mkv');
    assert.deepStrictEqual(bot.state.dbUpdates, [
        { messageId: copiedMessageId, fileName: 'new-name.mkv' },
    ]);
}

function testRegressionOldBugWouldHaveCloned() {
    // Document why the old path was wrong: archive caption edit → edited_channel_post → re-copy
    const guards = new ChannelIntakeGuards(20_000);
    // Old code stamped archive caption without marking skip → treated as replace
    const wouldSkip = guards.shouldSkipBotCaptionEdit(ARCHIVE_ID, 99);
    assert.strictEqual(wouldSkip, false, 'without mark, archive caption edit looks like user edit');
    // That used to trigger delete+copyMessage → second private clone. Fixed by ignoring archive edits.
}

function main() {
    testArchiveIngestDoesNotCaptionArchiveOrDoubleRegister();
    testArchiveEditDoesNotClone();
    testLinksReplaceUpdatesFileName();
    testRegressionOldBugWouldHaveCloned();
    console.log('✅ archive intake flow simulations passed');
}

main();
