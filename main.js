import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import cliProgress from 'cli-progress';
import ora from 'ora';
import chalk from 'chalk';

// --- 1. CONFIGURATION ---
import {
  CHANNEL_TO_CHECK,
  DOWNLOAD_AFTER_DATE,
  VIDEOS_TO_INSPECT,
  CACHE_FILE,
} from './config.js';


// --- 2. CACHE & COMMAND HELPERS ---

/**
 * Reads the last processed video ID from the cache file.
 * @returns {Promise<{lastVideoId: string|null}>} The cached data.
 */
async function readCache() {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { lastVideoId: null };
  }
}

/**
 * Writes the latest video ID to the cache file.
 * @param {{lastVideoId: string}} data The data to write to the cache.
 */
async function writeCache(data) {
  await writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
}

/**
 * Executes a command-line process.
 * @param {string} command The command to execute.
 * @param {string[]} args An array of arguments.
 * @returns {Promise<string>} The stdout from the command.
 */
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

// --- 3. CORE LOGIC ---

/**
 * Fetches and filters videos from a YouTube channel to find new shorts.
 * @param {string} channelUrl The URL of the channel.
 * @param {string} afterDate The date in YYYYMMDD format.
 * @param {string|null} lastVideoId The ID of the last processed video.
 * @returns {Promise<object[]>} An array of video metadata objects to download.
 */
async function findMatchingShorts(channelUrl, afterDate, lastVideoId) {
  const spinner = ora(
    chalk.yellow(`Fetching data for the ${VIDEOS_TO_INSPECT} newest videos...`)
  ).start();
  let videos;

  try {
    const args = [
      '--playlist-items',
      `1-${VIDEOS_TO_INSPECT}`,
      '--socket-timeout',
      '30',
      '--dump-single-json',
      channelUrl,
    ];
    const jsonOutput = await runCommand('yt-dlp', args);
    const channelData = JSON.parse(jsonOutput);
    videos = channelData.entries;
    spinner.succeed(chalk.green(`Fetched data for ${videos.length} videos.`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch video list.'));
    throw error;
  }

  if (!videos || videos.length === 0) {
    console.log(chalk.yellow('Could not retrieve any videos from the channel.'));
    return [];
  }

  if (videos[0].id === lastVideoId) {
    console.log(chalk.blue('No new videos found since last run.'));
    return [];
  }

  const videosToDownload = [];
  console.log(chalk.cyan('Inspecting videos from newest to oldest...'));

  for (const video of videos) {
    if (!video || !video.upload_date) continue;
    if (video.id === lastVideoId) {
      console.log(
        chalk.blue(
          `\nFound the last downloaded video ("${video.title}"). Halting search.`
        )
      );
      break;
    }
    if (video.upload_date < afterDate) {
      console.log(
        chalk.blue(
          `\nFound a video from ${video.upload_date}, which is outside our date range. Halting search.`
        )
      );
      break;
    }

    const isShortFormat = video.duration < 181 && video.width < video.height;
    if (!isShortFormat) {
      console.log(
        chalk.grey(`\n- Skipping "${video.title}" (Not a valid short format)`)
      );
    } else {
      videosToDownload.push(video);
    }
  }

  console.log(chalk.green(`\n✅ Found ${videosToDownload.length} new shorts to download.`));
  return videosToDownload;
}

/**
 * Downloads, transcodes, and saves a single video.
 * @param {object} videoInfo The metadata object for the video.
 */
async function downloadAndProcessVideo(videoInfo) {
  // ... (This function remains the same, but you could add more chalk logging inside if desired)
}


// --- 4. MAIN EXECUTION ---

/**
 * The main function that orchestrates the entire process.
 */
async function runAutomation() {
  try {
    const cache = await readCache();
    console.log(
      chalk.magenta(`Last known video ID from cache: ${cache.lastVideoId || 'None'}`)
    );

    const videosToProcess = await findMatchingShorts(
      CHANNEL_TO_CHECK,
      DOWNLOAD_AFTER_DATE,
      cache.lastVideoId
    );

    if (videosToProcess.length === 0) {
      console.log(chalk.green('Nothing new to process. All done!'));
      return;
    }

    console.log(
      chalk.cyan(`\nStarting process for ${videosToProcess.length} new video(s)...`)
    );
    for (const video of videosToProcess) {
      console.log(chalk.cyan(`\n--- Processing: ${video.title} ---`));
      await downloadAndProcessVideo(video);
    }

    const newLatestId = videosToProcess[0].id;
    await writeCache({ lastVideoId: newLatestId });
    console.log(chalk.green(`\nCache updated. New latest video ID: ${newLatestId}`));
  } catch (error) {
    console.error(chalk.red('❌ A fatal error occurred:'), error.message);
  }
}

runAutomation();