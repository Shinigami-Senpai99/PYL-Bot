require("dotenv").config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");
const stringSimilarity = require("string-similarity");

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
console.log("YouTube Channel ID:", YOUTUBE_CHANNEL_ID);
console.log("Discord Token exists:", !!DISCORD_TOKEN);

// Map to store video titles (lowercase) -> video URL
let videoMap = new Map();

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

// Load video list from the uploads playlist
async function loadVideoList() {
    console.log("Loading video list...");
    const playlistId = await fetchUploadsPlaylistId();
    if (!playlistId) {
        console.error("No uploads playlist found.");
        return;
    }

    try {
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}&maxResults=50`;
        console.log("Fetching video list from URL:", url);
        const response = await axios.get(url);
        const items = response.data.items;

        // Clear existing map
        videoMap.clear();

        for (const item of items) {
            const title = item.snippet.title.toLowerCase().trim();
            const videoId = item.snippet.resourceId.videoId;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            videoMap.set(title, videoUrl);
            console.log("Loaded video:", title, videoUrl);
        }
        console.log(`Loaded ${videoMap.size} videos from channel.`);
    } catch (error) {
        console.error("Error loading video list:", error);
    }
}

// Load video list on startup and refresh every hour
loadVideoList();
setInterval(loadVideoList, 60 * 60 * 1000);

// Log when the Discord client is ready
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Listen for new messages
client.on("messageCreate", async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // If the message is in a guild, check if the bot has permission to send messages in that channel
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

    // If no videos are loaded yet, log and do nothing
    if (videoMap.size === 0) {
        console.log("Video list is empty. Ignoring message.");
        return;
    }

    // Get all stored video titles as an array
    const titles = Array.from(videoMap.keys());
    console.log("Available video titles:", titles);

    // Use string-similarity to find the best match for the message
    const bestMatch = stringSimilarity.findBestMatch(input, titles);
    console.log("Best match rating:", bestMatch.bestMatch.rating, "for title:", bestMatch.bestMatch.target);

    // Set a threshold for similarity (0.48 in this example)
    const threshold = 0.48;
    if (bestMatch.bestMatch.rating >= threshold) {
        const matchedTitle = bestMatch.bestMatch.target;
        const videoUrl = videoMap.get(matchedTitle);
        console.log(`Matched title "${matchedTitle}" with URL ${videoUrl}`);
        try {
            await message.reply(`Here's the video you mentioned: ${videoUrl}`);
            console.log("Reply sent successfully.");
        } catch (error) {
            console.error("Failed to send reply:", error);
        }
    }
});

// Login to Discord and log the process
client.login(DISCORD_TOKEN)
    .then(() => {
        console.log("Discord client logged in successfully.");
    })
    .catch(err => {
        console.error("Error during Discord login:", err);
    });

// Global handler for unhandled promise rejections
process.on("unhandledRejection", (error) => {
    console.error("Unhandled promise rejection:", error);
});
