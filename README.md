# ShortStash 🎞️
An automated Node.js script to find and download YouTube Shorts from specific channels, convert them to AMV format, and organize them locally.

# Features
Automated Fetching: Checks a specific YouTube channel for new videos.

Efficient Caching: Remembers the last downloaded video to only process new content, making subsequent runs much faster.

Smart Filtering: Filters videos by upload date, duration (< 3 minutes), and vertical aspect ratio to target shorts accurately.

AMV Conversion: Uses ffmpeg to transcode videos into the .amv format, ready for older media players.

Organized Output: Automatically saves downloaded files into a folder named after the YouTube channel.

Rich Console UI: Provides clear, color-coded status updates, spinners for waiting, and progress bars for downloads.

# Prerequisites
Before you begin, ensure you have the following tools installed and accessible from your system's command line (PATH).

Node.js (v23 or newer)

Python (for pip)

yt-dlp: The latest version is required.

pip install --upgrade yt-dlp

FFmpeg: The core video processing engine. (Can be gotten from yt-dlp, or FFMPEG website)

# Installation & Setup
Clone or Download: Get the project files (main.js, package.json, etc.) onto your local machine.

Fill in Configuration: Open config.js and replace 'PASTE_YOUTUBE_CHANNEL_URL_HERE' with the URL of the channel you want to track. Adjust other settings as needed.

Install Dependencies: Open your terminal in the project folder and run:

npm install
This will install chalk, ora, and cli-progress from your package.json file.

Usage
To run the script, simply open your terminal in the project folder and execute:

npm start
The script will begin fetching and processing videos according to your configuration. On the first run, it will create a database file to speed up future runs.

# License
*This project is licensed under the MIT License.
