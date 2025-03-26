const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const generateFileKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 6; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
};

const createFileLog = (file, fileKey, fileKeys) => {
    return `📥 New File Received\n\n` +
        `File Name: ${file.file_name}\n` +
        `File Size: ${formatFileSize(file.file_size)}\n` +
        `File ID: ${file.file_id}\n` +
        `File Key: ${fileKey}\n` +
        `Date: ${new Date().toLocaleString('en-US')}\n\n` +
        `📋 Stored Files:\n` +
        Array.from(fileKeys.entries()).map(([key, info]) => 
            `Key: ${key} - Name: ${info.name} - Date: ${new Date(info.date).toLocaleString('en-US')}`
        ).join('\n');
};

module.exports = {
    formatFileSize,
    generateFileKey,
    createFileLog
}; 