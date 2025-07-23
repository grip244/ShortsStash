/**
 * @fileoverview Configuration settings for the YouTube Shorts Downloader.
 */

// A list of YouTube channel URLs to track.
export const CHANNELS_TO_CHECK = [
 // 'PLACE_CHANNES_HERE(e.g; www.youtube.com/@user, dont include the trailing slash "/videos"),
 'https://www.youtube.com/@theplantslant2431', 'https://www.youtube.com/@DrewTalbert', 'https://www.youtube.com/@AWorldAccordingToAI'
];

// The browser to use for cookie authentication.
// Options: 'chrome', 'firefox', 'edge', 'opera', 'brave', 'vivaldi'
export const BROWSER = 'opera';

// The date to start searching from, in YYYYMMDD format.
export const DOWNLOAD_AFTER_DATE = '20250701';

// The number of the most recent videos to inspect on each channel.
export const VIDEOS_TO_INSPECT = 5;

// Set to true to run automatically twice a day, or false to run only once.
export const ENABLE_SCHEDULER = true; // true by default, runs 8AM and 8PM daily. 

// The target output format. Options: 'mp4', 'mp3', 'amv'
export const TARGET_FORMAT = 'amv';

// Custom video processing settings.
export const VIDEO_SETTINGS = {
  // Set the output resolution (width:height).
  scale: '128:128',
  // Set the output frame rate.
  frame_rate: '21',
};