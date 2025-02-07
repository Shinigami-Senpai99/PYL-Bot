require("dotenv").config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");
const stringSimilarity = require("string-similarity");
const sqlite3 = require("sqlite3").verbose();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

console.log("Environment variables loaded.");
console.log("Youtube API Key:", !!YOUTUBE_API_KEY);
console.log("YouTube Channel ID:", YOUTUBE_CHANNEL_ID);
console.log("Discord Token exists:", !!DISCORD_TOKEN);

// Connect to the SQLite database (or create it if it doesn't exist)
const db = new sqlite3.Database("./videos.db", (err) => {
    if (err) {
        console.error("Error connecting to the database:", err);
    } else {
        console.log("Connected to the SQLite database.");
    }
});

// Create the 'videos' table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS videos (
    title TEXT PRIMARY KEY,
    videoUrl TEXT
)`, (err) => {
    if (err) {
        console.error("Error creating videos table:", err);
    } else {
        console.log("Videos table is ready.");
    }
});

// Create a 'metadata' table to store additional information (like last update time)
db.run(`CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
)`, (err) => {
    if (err) {
        console.error("Error creating metadata table:", err);
    } else {
        console.log("Metadata table is ready.");
    }
});

// Fetch the uploads playlist ID for the channel
async function fetchUploadsPlaylistId() {
    console.log("Fetching uploads playlist ID...");
    try {
        const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${YOUTUBE_CHANNEL_ID}&key=${YOUTUBE_API_KEY}`;
        const response = await axios.get(url);
        const uploadsPlaylistId = response.data.items[0].contentDetails.relatedPlaylists.uploads;
        console.log("Obtained uploads playlist ID:", uploadsPlaylistId);
        return uploadsPlaylistId;
    } catch (error) {
        console.error("Error fetching uploads playlist ID:", error);
        return null;
    }
}

// Load video list from the uploads playlist and update the database
async function loadVideoList() {
    console.log("Loading video list...");
    const playlistId = await fetchUploadsPlaylistId();
    if (!playlistId) {
        console.error("No uploads playlist found.");
        return;
    }

    try {
        let nextPageToken = '';
        // Clear existing videos from the table
        db.run("DELETE FROM videos", (err) => {
            if (err) console.error("Error clearing videos table:", err);
            else console.log("Cleared existing videos from the database.");
        });

        // Loop through pages (each page returns up to 50 videos)
        do {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}&maxResults=50&pageToken=${nextPageToken}`;
            console.log("Fetching video list from URL:", url);
            const response = await axios.get(url);
            const items = response.data.items;

            // Insert each video into the database
            for (const item of items) {
                const title = item.snippet.title.toLowerCase().trim();
                const videoId = item.snippet.resourceId.videoId;
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                db.run("INSERT OR REPLACE INTO videos (title, videoUrl) VALUES (?, ?)", [title, videoUrl], (err) => {
                    if (err) {
                        console.error("Error inserting video into database:", err);
                    } else {
                        console.log("Inserted video:", title, videoUrl);
                    }
                });
            }

            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);

        // After successfully updating the video list, update the lastUpdate timestamp in metadata
        const now = new Date().toISOString();
        db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", ["lastUpdate", now], (err) => {
            if (err) {
                console.error("Error updating lastUpdate in metadata:", err);
            } else {
                console.log("Updated lastUpdate timestamp to:", now);
            }
        });
        console.log("Finished loading videos from channel.");
    } catch (error) {
        console.error("Error loading video list:", error);
    }
}

// Check if the video list needs updating (once every 24 hours)
function checkAndUpdateVideoList() {
    db.get("SELECT value FROM metadata WHERE key = ?", ["lastUpdate"], (err, row) => {
        if (err) {
            console.error("Error fetching lastUpdate from metadata:", err);
            return;
        }
        const now = new Date();
        if (!row) {
            console.log("No lastUpdate found. Loading video list for the first time...");
            loadVideoList();
        } else {
            const lastUpdate = new Date(row.value);
            const diff = now - lastUpdate;
            // 24 hours = 24 * 60 * 60 * 1000 milliseconds
            if (diff >= 24 * 60 * 60 * 1000) {
                console.log("More than 24 hours since last update. Loading video list...");
                loadVideoList();
            } else {
                console.log("Video list is up-to-date. Last update was at:", row.value);
            }
        }
    });
}

// check if update is needed
checkAndUpdateVideoList();

// Schedule a daily update (every 24 hours)
setInterval(loadVideoList, 24 * 60 * 60 * 1000);


client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Listen for new messages
client.on("messageCreate", async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check permissions if in a guild
    if (message.guild) {
        const botPermissions = message.channel.permissionsFor(message.guild.members.me);
        if (!botPermissions || !botPermissions.has(PermissionFlagsBits.SendMessages)) {
            console.log(`Missing permission to send messages in channel: ${message.channel.name}`);
            return;
        }
    }

    console.log(`Received message from ${message.author.tag}: ${message.content}`);

    // Normalize the incoming message
    const input = message.content.toLowerCase().trim();

    // Query the database for all video titles and URLs
    db.all("SELECT title, videoUrl FROM videos", [], async (err, rows) => {
        if (err) {
            console.error("Error querying videos from database:", err);
            return;
        }

        if (!rows || rows.length === 0) {
            console.log("No videos found in the database.");
            return;
        }

        // Extract titles and create a mapping for quick lookup
        const titles = rows.map(row => row.title);
        const videoMapping = {};
        rows.forEach(row => {
            videoMapping[row.title] = row.videoUrl;
        });

        console.log("Available video titles:", titles);

        
        const bestMatch = stringSimilarity.findBestMatch(input, titles);
        console.log("Best match rating:", bestMatch.bestMatch.rating, "for title:", bestMatch.bestMatch.target);

        
        const threshold = 0.448;
        if (bestMatch.bestMatch.rating >= threshold) {
            const matchedTitle = bestMatch.bestMatch.target;
            const videoUrl = videoMapping[matchedTitle];
            console.log(`Matched title "${matchedTitle}" with URL ${videoUrl}`);
            try {
                await message.reply(`Here's the video you mentioned: ${videoUrl}`);
                console.log("Reply sent successfully.");
            } catch (error) {
                console.error("Failed to send reply:", error);
            }
        } else {
            console.log("No matching video found.");
        }
    });
});


client.login(DISCORD_TOKEN)
    .then(() => {
        console.log("Discord client logged in successfully.");
    })
    .catch(err => {
        console.error("Error during Discord login:", err);
    });


process.on("unhandledRejection", (error) => {
    console.error("Unhandled promise rejection:", error);
});
