/**
 * @fileoverview Configuration settings for the YouTube Shorts Downloader.
 */

// The full URL of the YouTube channel you want to check.
export const CHANNEL_TO_CHECK = 'PASTE_YOUTUBE_CHANNEL_URL_HERE';

// The date to start searching from, in YYYYMMDD format.
export const DOWNLOAD_AFTER_DATE = '20250701';

// The number of the most recent videos to inspect on the channel. (Will take longer the higher the value)
export const VIDEOS_TO_INSPECT = 20;

// The name of the file used to cache the last downloaded video ID.
export const CACHE_FILE = 'cache.json';