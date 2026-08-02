/**
 * Suppress bot self-effects on channel intake (archive mirror + caption stamps).
 * Prevents:
 * - private channel_post from copyMessage registering a second file key
 * - edited_channel_post from editMessageCaption being treated as a media replace
 */
class ChannelIntakeGuards {
  /**
   * @param {number} [ttlMs=20000]
   */
  constructor(ttlMs = 20_000) {
    this.ttlMs = ttlMs;
    /** @type {Map<number, number>} messageId → expiresAt */
    this._pendingPrivateCopies = new Map();
    /** @type {Map<string, number>} `${chatId}:${messageId}` → expiresAt */
    this._botCaptionEdits = new Map();
  }

  _prune(map) {
    const now = Date.now();
    for (const [key, expiresAt] of map.entries()) {
      if (expiresAt <= now) map.delete(key);
    }
  }

  /**
   * @param {string | number} messageId
   */
  markPendingPrivateCopy(messageId) {
    const id = Number(messageId);
    if (!Number.isFinite(id)) return;
    this._prune(this._pendingPrivateCopies);
    this._pendingPrivateCopies.set(id, Date.now() + this.ttlMs);
  }

  /**
   * @param {string | number} messageId
   * @returns {boolean}
   */
  shouldSkipPrivateIntake(messageId) {
    const id = Number(messageId);
    if (!Number.isFinite(id)) return false;
    this._prune(this._pendingPrivateCopies);
    const expiresAt = this._pendingPrivateCopies.get(id);
    if (expiresAt == null) return false;
    this._pendingPrivateCopies.delete(id);
    return expiresAt > Date.now();
  }

  /**
   * @param {string | number} chatId
   * @param {string | number} messageId
   */
  markBotCaptionEdit(chatId, messageId) {
    const key = `${String(chatId).trim()}:${Number(messageId)}`;
    if (!key.includes(':') || key.endsWith(':NaN')) return;
    this._prune(this._botCaptionEdits);
    this._botCaptionEdits.set(key, Date.now() + this.ttlMs);
  }

  /**
   * @param {string | number} chatId
   * @param {string | number} messageId
   * @returns {boolean}
   */
  shouldSkipBotCaptionEdit(chatId, messageId) {
    const key = `${String(chatId).trim()}:${Number(messageId)}`;
    this._prune(this._botCaptionEdits);
    const expiresAt = this._botCaptionEdits.get(key);
    if (expiresAt == null) return false;
    this._botCaptionEdits.delete(key);
    return expiresAt > Date.now();
  }
}

module.exports = {
  ChannelIntakeGuards,
};
