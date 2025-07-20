/**
 * @fileoverview Configuration settings for the YouTube Shorts Downloader.
 */

// A list of YouTube channel URLs to track.
export const CHANNELS_TO_CHECK = [
  'https://www.youtube.com/@bartenderfromtiktok/shorts', 'https://www.youtube.com/@theplantslant2431/shorts'
];

// The date to start searching from, in YYYYMMDD format.
export const DOWNLOAD_AFTER_DATE = '20250701';

// The number of the most recent videos to inspect on each channel.
export const VIDEOS_TO_INSPECT = 20;

// Set to true to run automatically twice a day, or false to run only once.
export const ENABLE_SCHEDULER = false;

// The name of the file used to cache the last downloaded video ID.
export const CACHE_FILE = 'cache.json';