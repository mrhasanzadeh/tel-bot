/**
 * Unit tests for channel draft bind helpers (no Telegram / API).
 * Run: node scripts/test-channel-bind-helpers.js
 */
const assert = require('assert');
const {
    extractSearchQueryFromCaption,
    extractChannelPostPayload
} = require('../src/services/channelDraftService');

function testExtractPrefersBold() {
    const caption = 'Other line\nDan Da Dan S2\nmore';
    // "Dan Da Dan S2" starts after "Other line\n" (11 chars), length 13
    const entities = [{ type: 'bold', offset: 11, length: 13 }];
    assert.strictEqual(
        extractSearchQueryFromCaption(caption, entities),
        'Dan Da Dan S2'
    );
}

function testExtractFallsBackToFirstLine() {
    assert.strictEqual(
        extractSearchQueryFromCaption('Chiramune\nE01 Softsub', []),
        'Chiramune'
    );
}

function testExtractEmpty() {
    assert.strictEqual(extractSearchQueryFromCaption('', []), '');
    assert.strictEqual(extractSearchQueryFromCaption('   \n  ', []), '');
}

function testExtractPayloadFromPhotoCaption() {
    const payload = extractChannelPostPayload({
        message_id: 10,
        chat: { type: 'private', id: 1 },
        photo: [{ file_id: 'small' }, { file_id: 'large' }],
        caption: 'Title here',
        caption_entities: [],
        forward_from_chat: { id: -100123 },
        forward_from_message_id: 99
    });
    assert.ok(payload);
    assert.strictEqual(payload.coverFileId, 'large');
    assert.strictEqual(payload.captionText, 'Title here');
    assert.strictEqual(payload.channelId, '-100123');
    assert.strictEqual(payload.channelMessageId, 99);
}

function testExtractPayloadRequiresPhotoAndCaption() {
    assert.strictEqual(
        extractChannelPostPayload({
            message_id: 1,
            text: 'no photo'
        }),
        null
    );
}

testExtractPrefersBold();
testExtractFallsBackToFirstLine();
testExtractEmpty();
testExtractPayloadFromPhotoCaption();
testExtractPayloadRequiresPhotoAndCaption();
console.log('✅ channel bind helper tests passed');
