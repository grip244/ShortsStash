/**
 * @fileoverview Defines the FFmpeg settings for various output formats.
 */

export const FORMAT_PRESETS = {
  // ----------------------------------------------------------------
  // --- Recommended Presets for AGPTEK A65 & Similar Players ---
  // ----------------------------------------------------------------

  /**
   * Most compatible video format for basic MP4/video players.
   * Low resolution, small file size.
   */
  amv: {
    extension: 'amv',
    ffmpeg_args: [
      // The -vf and -r arguments are generated dynamically from config.mjs
      '-c:v', 'amv',
      '-c:a', 'adpcm_ima_amv',
      '-ar', '22050',
      '-ac', '1',
      '-block_size', '1050',
    ],
  },

  /**
   * A higher quality video option than AMV that should be compatible.
   * Uses the very common Xvid video and MP3 audio codecs.
   */
  avi_xvid: {
    extension: 'avi',
    ffmpeg_args: [
      '-c:v', 'libxvid', // Use the Xvid codec
      '-q:v', '10',      // Video quality (lower is better)
      '-c:a', 'libmp3lame', // Use the MP3 codec
      '-q:a', '5',      // Audio quality (lower is better)
    ],
  },

  /**
   * Most compatible audio format. Constant Bitrate (CBR) is safer
   * for older hardware than Variable Bitrate (VBR).
   */
  mp3_cbr: {
    extension: 'mp3',
    ffmpeg_args: [
      '-vn', // No video
      '-c:a', 'libmp3lame',
      '-b:a', '128k', // Set a constant bitrate of 128kbps
    ],
  },


  // ----------------------------------------------------------------
  // --- General Purpose / Modern Formats ---
  // ----------------------------------------------------------------

  mp4: {
    extension: 'mp4',
    ffmpeg_args: ['-c:v', 'copy', '-c:a', 'copy'],
  },

  mkv: {
    extension: 'mkv',
    ffmpeg_args: ['-c:v', 'copy', '-c:a', 'copy'],
  },

  webm: {
    extension: 'webm',
    ffmpeg_args: [
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', '30',
      '-c:a', 'libopus',
      '-b:a', '128k',
    ],
  }
  
};