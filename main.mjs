import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import cliProgress from 'cli-progress';
import ora from 'ora';
import chalk from 'chalk';
import cron from 'node-cron';

import { dbPromise } from './database.mjs';
import {
  CHANNELS_TO_CHECK,
  DOWNLOAD_AFTER_DATE,
  VIDEOS_TO_INSPECT,
  ENABLE_SCHEDULER,
  TARGET_FORMAT,
  VIDEO_SETTINGS,
} from './config.mjs';
import { FORMAT_PRESETS } from './formats.mjs';

// ===================================================================
// --- CORE LOGIC ---
// ===================================================================

/**
 * The main function that orchestrates the entire process.
 */
async function runAutomation() {
  const db = await dbPromise;

  try {
    console.log(chalk.blue('Syncing config file with the database...'));

    const configChannels = CHANNELS_TO_CHECK;
    const dbChannels = await db.all('SELECT * FROM channels');

    for (const url of configChannels) {
      await db.run('INSERT OR IGNORE INTO channels(url) VALUES(?)', url);
    }

    const channelsToRemove = dbChannels.filter(
      (dbChannel) => !configChannels.includes(dbChannel.url)
    );

    for (const channel of channelsToRemove) {
      console.log(chalk.yellow(`Removing stale channel from database: ${channel.url}`));
      await db.run('DELETE FROM videos WHERE channel_id = ?', channel.id);
      await db.run('DELETE FROM channels WHERE id = ?', channel.id);
    }

    const channelsToProcess = await db.all('SELECT * FROM channels');
    console.log(chalk.magenta(`Found ${channelsToProcess.length} active channel(s) to check.`));

    for (const channel of channelsToProcess) {
      console.log(
        chalk.cyan(`\n--- Starting check for channel: ${channel.url} ---`)
      );
      await processChannel(db, channel);
    }

    console.log(chalk.green('\nAutomation run completed for all channels.'));
  } catch (error) {
    console.error(chalk.red('❌ A fatal error occurred:'), error.message);
  } finally {
    if (!ENABLE_SCHEDULER) {
      await db.close();
    }
  }
}

/**
 * Processes a single channel: finds, downloads, and processes new shorts.
 * @param {object} db - The database instance.
 * @param {object} channel - The channel object from the database.
 */
async function processChannel(db, channel) {
  const videosToProcess = await findMatchingShorts(
    channel.url,
    DOWNLOAD_AFTER_DATE,
    channel.last_video_id
  );

  if (videosToProcess.length === 0) {
    console.log(chalk.green('No new shorts to process for this channel.'));
    return;
  }

  console.log(
    chalk.cyan(
      `\nStarting download for ${videosToProcess.length} new video(s)...`
    )
  );

  for (const video of videosToProcess) {
    await downloadAndProcessVideo(video);
    await db.run(
      'INSERT OR IGNORE INTO videos(id, title, channel_id, upload_date) VALUES(?, ?, ?, ?)',
      video.id,
      video.title,
      channel.id,
      video.upload_date
    );
  }

  const newLatestId = videosToProcess[0].id;
  await db.run(
    'UPDATE channels SET last_video_id = ? WHERE id = ?',
    newLatestId,
    channel.id
  );
  console.log(
    chalk.green(`\nCache updated for channel. New latest video ID: ${newLatestId}`)
  );
}

/**
 * Fetches and filters videos from a YouTube channel to find new shorts.
 * @param {string} channelUrl - The URL of the channel.
 * @param {string} afterDate - The date in YYYYMMDD format.
 * @param {string|null} lastVideoId - The ID of the last processed video.
 * @returns {Promise<object[]>} An array of video metadata objects.
 */
async function findMatchingShorts(channelUrl, afterDate, lastVideoId) {
  const spinner = ora(
    chalk.yellow(`Fetching data for the ${VIDEOS_TO_INSPECT} newest videos...`)
  ).start();
  let videos;
  try {
    const args = [
      '--cookies-from-browser', 'opera',
      '--playlist-items',
      `1-${VIDEOS_TO_INSPECT}`,
      '--dump-single-json',
      channelUrl,
    ];
    const jsonOutput = await runCommand('yt-dlp', args);
    videos = JSON.parse(jsonOutput)?.entries;
    spinner.succeed(chalk.green(`Fetched data for ${videos?.length || 0} videos.`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch video list.'));
    throw error;
  }

  if (!videos || videos.length === 0) return [];
  if (videos[0].id === lastVideoId) return [];

  const videosToDownload = [];
  for (const video of videos) {
    if (!video || !video.upload_date) continue;
    if (video.id === lastVideoId) break;
    if (video.upload_date < afterDate) break;

    const isShortFormat = video.duration < 181 && video.width < video.height;
    if (isShortFormat) {
      videosToDownload.push(video);
    }
  }
  return videosToDownload;
}

/**
 * Downloads, transcodes, and saves a single video.
 * @param {object} videoInfo - The metadata object for the video.
 */
async function downloadAndProcessVideo(videoInfo) {
  const tempId = randomUUID();
  const tempVideoFile = `temp_video_${tempId}.mp4`;
  const tempAudioFile = `temp_audio_${tempId}.m4a`;
  try {
    const sanitizedTitle = videoInfo.title.replace(/[^a-zA-Z0-9]/g, '_');
    const channelDir = join(process.cwd(), videoInfo.channel || 'Unknown_Channel');
    await mkdir(channelDir, { recursive: true });
    const outputPath = join(channelDir, sanitizedTitle);

    const videoFormat = videoInfo.formats.find(
      (f) =>
        f.vcodec !== 'none' &&
        f.acodec === 'none' &&
        f.ext === 'mp4' &&
        f.width < f.height
    );
    const audioFormat = videoInfo.formats.find(
      (f) => f.acodec !== 'none' && f.vcodec === 'none' && f.ext === 'm4a'
    );
    if (!videoFormat || !audioFormat)
      throw new Error(`Could not find suitable formats for "${videoInfo.title}".`);

    console.log(chalk.blue(`\nProcessing: "${videoInfo.title}"`));
    const multibar = new cliProgress.MultiBar(
      { format: ' {bar} | {filename} | {value}/{total}%' },
      cliProgress.Presets.shades_classic
    );
    const videoBar = multibar.create(100, 0, { filename: 'video.mp4' });
    const audioBar = multibar.create(100, 0, { filename: 'audio.m4a' });

    await Promise.all([
      downloadFormat(videoInfo.webpage_url, videoFormat.format_id, tempVideoFile, (p) =>
        videoBar.update(p)
      ),
      downloadFormat(videoInfo.webpage_url, audioFormat.format_id, tempAudioFile, (p) =>
        audioBar.update(p)
      ),
    ]);
    multibar.stop();

    await processFile(tempVideoFile, tempAudioFile, outputPath);

  } catch (error) {
    console.error(
      chalk.red(`❌ An error occurred while processing "${videoInfo.title}":`),
      error.message
    );
  } finally {
    await unlink(tempVideoFile).catch(() => {});
    await unlink(tempAudioFile).catch(() => {});
  }
}

// ===================================================================
// --- UTILITY & FFMPEG HELPERS ---
// ===================================================================

/**
 * Processes downloaded video and audio using FFmpeg based on the selected format.
 * @param {string} videoPath - Path to the downloaded video file.
 * @param {string} audioPath - Path to the downloaded audio file.
 * @param {string} outputPath - The final output path without extension.
 */
async function processFile(videoPath, audioPath, outputPath) {
  const format = FORMAT_PRESETS[TARGET_FORMAT] || FORMAT_PRESETS.mp4;
  const finalOutputFile = `${outputPath}.${format.extension}`;
  
  console.log(chalk.blue(`Processing to ${TARGET_FORMAT.toUpperCase()} format...`));

  const args = ['-y', '-i', videoPath, '-i', audioPath];

  if (TARGET_FORMAT !== 'mp3') {
    args.push(
      '-vf', `scale=${VIDEO_SETTINGS.scale}`,
      '-r', VIDEO_SETTINGS.frame_rate
    );
  }

  args.push(...format.ffmpeg_args, finalOutputFile);

  await runCommand('ffmpeg', args);
  console.log(chalk.green(`✅ Success! File saved as ${finalOutputFile}`));
  return finalOutputFile;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args);
    let output = '';
    let error = '';
    process.stdout.on('data', (data) => (output += data.toString()));
    process.stderr.on('data', (data) => (error += data.toString()));
    process.on('close', (code) => {
      if (code !== 0)
        return reject(new Error(`Command failed with code ${code}:\n${error}`));
      resolve(output);
    });
    process.on('error', (err) => reject(err));
  });
}

async function downloadFormat(url, formatId, outputFilename, onProgress) {
  return new Promise((resolve, reject) => {
    const args = ['--cookies-from-browser', 'opera', '--progress', '-f', formatId, url, '-o', outputFilename];
    const process = spawn('yt-dlp', args);
    let error = '';
    process.stdout.on('data', (data) => {
      const match = data.toString().match(/\[download\]\s+([0-9\.]+)%/);
      if (match && match[1]) onProgress(parseFloat(match[1]));
    });
    process.stderr.on('data', (data) => (error += data.toString()));
    process.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Command failed: ${error}`));
      onProgress(100);
      resolve();
    });
    process.on('error', (err) => reject(err));
  });
}

// ===================================================================
// --- START SCRIPT ---
// ===================================================================

if (ENABLE_SCHEDULER) {
  cron.schedule('0 8,20 * * *', () => {
    console.log(chalk.bgGreen.black('\n-- Running scheduled check... --'));
    runAutomation();
  });

  console.log(chalk.cyan('✅ Scheduler is active.'));
  console.log(chalk.yellow('Checks will run automatically twice a day at 8 AM and 8 PM.'));
} else {
  console.log(chalk.yellow('Scheduler is disabled. Running a one-time check...'));
  runAutomation();
}