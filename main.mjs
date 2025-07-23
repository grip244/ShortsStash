import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import cliProgress from 'cli-progress';
import ora from 'ora';
import chalk from 'chalk';
import cron from 'node-cron';
import inquirer from 'inquirer';
import figlet from 'figlet';


import { dbPromise } from './database.mjs';
import {
  BROWSER,
  CHANNELS_TO_CHECK,
  DOWNLOAD_AFTER_DATE,
  VIDEOS_TO_INSPECT,
  ENABLE_SCHEDULER,
  TARGET_FORMAT,
  VIDEO_SETTINGS,
} from './config.mjs';
import { FORMAT_PRESETS } from './formats.mjs';

// --- 1. Argument Validation ---
const ALLOWED_FLAGS = ['--skip-videos', '--reset-config'];
const providedArgs = process.argv.slice(2);

// Filter for flags that are NOT Node.js-specific before validating them
const appFlags = providedArgs.filter(arg => 
    arg.startsWith('-') && !arg.startsWith('--no-') && !arg.startsWith('--trace-')
);

const invalidFlag = appFlags.find(flag => !ALLOWED_FLAGS.includes(flag));

if (invalidFlag) {
  console.error(chalk.red(`Error: Invalid flag provided: ${invalidFlag}`));
  console.log(chalk.yellow(`Allowed flags are: ${ALLOWED_FLAGS.join(', ')}`));
  process.exit(1);
}

const SKIP_NORMAL_VIDEOS = providedArgs.includes('--skip-videos');

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

    // 1. Add new channels from config to the DB or reactivate them.
    for (const url of configChannels) {
      // This will add the channel if it's new, or do nothing if it exists.
      await db.run('INSERT OR IGNORE INTO channels(url) VALUES(?)', url);
      // Ensure the channel is marked as active.
      await db.run('UPDATE channels SET is_active = 1 WHERE url = ?', url);
    }

    // 2. Deactivate channels that are no longer in the config.
    const channelsToDeactivate = dbChannels.filter(
      (dbChannel) => !configChannels.includes(dbChannel.url)
    );

    for (const channel of channelsToDeactivate) {
      console.log(chalk.yellow(`Deactivating channel (data retained): ${channel.url}`));
      await db.run('UPDATE channels SET is_active = 0 WHERE id = ?', channel.id);
    }

    // 3. Get only the active channels to process.
    const channelsToProcess = await db.all('SELECT * FROM channels WHERE is_active = 1');
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
 * Processes a single channel by checking both its /videos and /shorts tabs.
 * @param {object} db - The database instance.
 * @param {object} channel - The channel object from the database.
 */
async function processChannel(db, channel) {
  console.log(chalk.blue('Checking both /videos and /shorts tabs...'));
  const videosTabUrl = `${channel.url}/videos`;
  const shortsTabUrl = `${channel.url}/shorts`;

  const [videosResult, shortsResult] = await Promise.all([
    findNewVideos(videosTabUrl, DOWNLOAD_AFTER_DATE, channel.last_video_id),
    findNewVideos(shortsTabUrl, DOWNLOAD_AFTER_DATE, channel.last_video_id),
  ]);

  const uniqueVideos = new Map();
  const combinedResults = [
    ...videosResult.shorts, ...shortsResult.shorts,
    ...videosResult.normalVideos, ...shortsResult.normalVideos,
  ];
  for (const video of combinedResults) {
    if (video) uniqueVideos.set(video.id, video);
  }

  if (uniqueVideos.size === 0) {
    console.log(chalk.green('No new videos found on either tab for this channel.'));
    return;
  }

  const sortedVideos = Array.from(uniqueVideos.values()).sort((a, b) => b.upload_date.localeCompare(a.upload_date));
  const lastIdIndex = channel.last_video_id ? sortedVideos.findIndex(v => v.id === channel.last_video_id) : -1;
  const newVideos = lastIdIndex !== -1 ? sortedVideos.slice(0, lastIdIndex) : sortedVideos;
  
  if (newVideos.length === 0) {
    console.log(chalk.green('No new videos found since last check.'));
    return;
  }

  const shorts = newVideos.filter(v => v.duration < 181 && v.width < v.height);
  const normalVideos = newVideos.filter(v => !(v.duration < 181 && v.width < v.height));
  let newLatestId = newVideos[0].id;

  if (shorts.length > 0) {
    console.log(chalk.cyan(`\nFound ${shorts.length} new short(s). Processing automatically...`));
    for (const video of shorts) {
      await downloadAndProcessVideo(video);
      await db.run('INSERT OR IGNORE INTO videos(id, title, channel_id, upload_date) VALUES(?, ?, ?, ?)', video.id, video.title, channel.id, video.upload_date);
    }
  }

  let skipNormalVideos;
  if (ENABLE_SCHEDULER) {
    const normalVideoMode = (await db.get("SELECT value FROM settings WHERE key = 'normal_video_mode'")).value;
    skipNormalVideos = normalVideoMode === 'skip';
  } else {
    skipNormalVideos = SKIP_NORMAL_VIDEOS;
  }

  if (normalVideos.length > 0 && !skipNormalVideos) {
    console.log(chalk.yellow(`\nFound ${normalVideos.length} new normal video(s).`));
    const { count } = await inquirer.prompt([
      {
        type: 'input',
        name: 'count',
        message: 'How many of the newest ones would you like to see?',
        default: Math.min(5, normalVideos.length),
        validate: (input) => !isNaN(parseInt(input)) || 'Please enter a number.',
      },
    ]);
    const videosToShow = normalVideos.slice(0, parseInt(count));
    if (videosToShow.length > 0) {
      const { videosToDownload } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'videosToDownload',
          message: 'Which normal videos would you like to download?',
          prefix: '✅',
          choices: videosToShow.map((v) => ({
            name: ` ${v.title} ${chalk.grey(`(${Math.floor(v.duration / 60)}m ${v.duration % 60}s)`)}`,
            value: v
          })),
        },
      ]);
      if (videosToDownload.length > 0) {
        for (const video of videosToDownload) {
          await downloadAndProcessVideo(video);
          await db.run('INSERT OR IGNORE INTO videos(id, title, channel_id, upload_date) VALUES(?, ?, ?, ?)', video.id, video.title, channel.id, video.upload_date);
        }
      }
    }
  } else if (normalVideos.length > 0 && skipNormalVideos) {
    const reason = ENABLE_SCHEDULER ? 'saved setting' : '--skip-videos flag';
    console.log(chalk.grey(`Skipping ${normalVideos.length} new normal video(s) as per ${reason}.`));
  }

  if (newLatestId) {
    await db.run('UPDATE channels SET last_video_id = ? WHERE id = ?', newLatestId, channel.id);
    console.log(chalk.green(`\nCache updated for channel. New latest video ID: ${newLatestId}`));
  }
}
/*
 * Fetches and separates new videos from a specific channel tab.
 * @returns {Promise<{shorts: object[], normalVideos: object[]}>}
 */
async function findNewVideos(channelUrl, afterDate, lastVideoId) {
  const spinner = ora(chalk.yellow(`Fetching data from ${channelUrl}...`)).start();
  let videos;
  try {
    const args = [
      '--cookies-from-browser', BROWSER,
      '--playlist-items', `1-${VIDEOS_TO_INSPECT}`,
      // Add extractor args to ensure consistent data format
      '--extractor-args', 'youtube:player_client=web',
      '--dump-single-json', channelUrl,
    ];
    const jsonOutput = await runCommand('yt-dlp', args);
    videos = JSON.parse(jsonOutput)?.entries;
    spinner.succeed(chalk.green(`Fetched data for ${videos?.length || 0} videos from ${channelUrl}.`));
  } catch (error) {
    spinner.fail(chalk.red(`Failed to fetch video list from ${channelUrl}.`));
    return { shorts: [], normalVideos: [] };
  }

  if (!videos || videos.length === 0) return { shorts: [], normalVideos: [] };

  const allFoundVideos = [];
  for (const video of videos) {
    if (!video || !video.upload_date || video.upload_date < afterDate) {
      continue;
    }
    allFoundVideos.push(video);
  }

  const shorts = allFoundVideos.filter(v => v.duration < 181 && v.width < v.height);
  const normalVideos = allFoundVideos.filter(v => !(v.duration < 181 && v.width < v.height));
  
  return { shorts, normalVideos };
}


/**
 * Downloads, processes, and saves a single video, ensuring English audio.
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

    // --- NEW: Define format selectors to prioritize English ---
    // Best video (bv) in English (lang=en) + Best audio (ba) in English (lang=en)
    // Fallback to any language if English is not available.
    const videoFormatSelector = 'bv*[lang=en] / bv';
    const audioFormatSelector = 'ba*[lang=en] / ba';

    console.log(chalk.blue(`\nProcessing: "${videoInfo.title}"`));
    const multibar = new cliProgress.MultiBar({ format: ' {bar} | {filename} | {value}/{total}%' }, cliProgress.Presets.shades_classic);
    const videoBar = multibar.create(100, 0, { filename: 'video.mp4' });
    const audioBar = multibar.create(100, 0, { filename: 'audio.m4a' });

    await Promise.all([
      downloadFormat(videoInfo.webpage_url, videoFormatSelector, tempVideoFile, (p) => videoBar.update(p)),
      downloadFormat(videoInfo.webpage_url, audioFormatSelector, tempAudioFile, (p) => audioBar.update(p)),
    ]);
    multibar.stop();
    await processFile(tempVideoFile, tempAudioFile, outputPath);
  } catch (error) {
    console.error(chalk.red(`❌ An error occurred while processing "${videoInfo.title}":`), error.message);
  } finally {
    await unlink(tempVideoFile).catch(() => {});
    await unlink(tempAudioFile).catch(() => {});
  }
}

// ===================================================================
// --- UTILITY & FFMPEG HELPERS ---
// ===================================================================

async function processFile(videoPath, audioPath, outputPath) {
  const format = FORMAT_PRESETS[TARGET_FORMAT] || FORMAT_PRESETS.mp4;
  const finalOutputFile = `${outputPath}.${format.extension}`;
  console.log(chalk.blue(`Processing to ${TARGET_FORMAT.toUpperCase()} format...`));
  const args = ['-y', '-i', videoPath, '-i', audioPath];
  if (TARGET_FORMAT !== 'mp3' && TARGET_FORMAT !== 'mp4' && TARGET_FORMAT !== 'mkv') {
    args.push('-vf', `scale=${VIDEO_SETTINGS.scale}`, '-r', VIDEO_SETTINGS.frame_rate);
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
      if (code !== 0) return reject(new Error(`Command failed with code ${code}:\n${error}`));
      resolve(output);
    });
    process.on('error', (err) => reject(err));
  });
}

async function downloadFormat(url, formatId, outputFilename, onProgress) {
  return new Promise((resolve, reject) => {
    const args = ['--cookies-from-browser', BROWSER, '--progress', '-f', formatId, url, '-o', outputFilename];
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

/**
 * Checks if the user has configured the normal video mode and prompts them if not.
 * @param {object} db - The database instance.
 */
async function configureNormalVideoMode(db) {
  const setting = await db.get("SELECT value FROM settings WHERE key = 'normal_video_mode'");
  
  if (setting.value === 'prompt') {
    console.log(chalk.yellow('🔧 One-time setup required!'));
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'How should the scheduler handle normal (non-short) videos by default?',
        choices: [
          { name: chalk.green('Always ask which ones to download'), value: 'ask' },
          { name: chalk.yellow('Always skip them automatically'), value: 'skip' },
        ],
      },
    ]);
    await db.run("UPDATE settings SET value = ? WHERE key = 'normal_video_mode'", mode);
    console.log(chalk.green('✅ Preference saved!'));
  }
}

// ===================================================================
// --- START SCRIPT ---
// ===================================================================

/**
 * Calculates the next scheduled run time based on the hardcoded schedule.
 * @returns {string} The formatted string for the next run date.
 */
function calculateNextRunTime() {
  const now = new Date();
  const today8AM = new Date();
  today8AM.setHours(8, 0, 0, 0); // Set to 8:00:00.000 today

  const today8PM = new Date();
  today8PM.setHours(20, 0, 0, 0); // Set to 20:00:00.000 today

  if (now < today8AM) {
    return today8AM.toLocaleString();
  } else if (now < today8PM) {
    return today8PM.toLocaleString();
  } else {
    // If it's past 8 PM, the next run is 8 AM tomorrow
    const tomorrow8AM = new Date();
    tomorrow8AM.setDate(now.getDate() + 1);
    tomorrow8AM.setHours(8, 0, 0, 0);
    return tomorrow8AM.toLocaleString();
  }
}

/**
 * The main entry point for the application.
 */
async function startApp() {
  
  console.log(
    chalk.blue(
      figlet.textSync('ShortStash', {
        font: 'Standard',
        horizontalLayout: 'full',
      })
    )
  );
  console.log(chalk.yellow('            Your Automated Shorts Archiver'));
  console.log('\n' + '-'.repeat(50) + '\n');
  
  const db = await dbPromise;
  process.stdout.write('\x1b]2;ShortStash\x07');
  // --- Graceful Shutdown Handler ---
  const cleanup = async () => {
    console.log(chalk.yellow('\nShutting down gracefully...'));
    await db.close();
    console.log(chalk.blue('Database connection closed.'));
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // --- Argument Validation & Handling ---
  const providedArgs = process.argv.slice(2);
  const RESET_CONFIG = providedArgs.includes('--reset-config');

  if (RESET_CONFIG) {
    await db.run("UPDATE settings SET value = 'prompt' WHERE key = 'normal_video_mode'");
    console.log(chalk.green('Configuration has been reset. You will be prompted to choose a new setting.'));
  }

  // --- Main Logic ---
  if (ENABLE_SCHEDULER) {
    await configureNormalVideoMode(db);
    
    const schedule = '0 8,20 * * *';
    cron.schedule(schedule, () => {
      console.log(chalk.bgGreen.black('\n-- Running scheduled check... --'));
      runAutomation();
    });
    
    const nextRun = calculateNextRunTime();
    
    console.log(chalk.cyan('✅ Scheduler is active.'));
    console.log(chalk.green(`   Next check scheduled for: ${nextRun}`));
    console.log(chalk.magenta('   Watching Channels:'));
    CHANNELS_TO_CHECK.forEach(url => console.log(chalk.magenta(`     - ${url}`)));
    console.log(chalk.magenta(`   Target Format: ${TARGET_FORMAT.toUpperCase()}`));

  } else {
    console.log(chalk.yellow('Scheduler is disabled. Running a one-time check...'));
    runAutomation();
  }
}

startApp();