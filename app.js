require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
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


let videoMap = new Map();


async function fetchUploadsPlaylistId() {
    try {
        const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${YOUTUBE_CHANNEL_ID}&key=${YOUTUBE_API_KEY}`;
        const response = await axios.get(url);
        const uploadsPlaylistId = response.data.items[0].contentDetails.relatedPlaylists.uploads;
        return uploadsPlaylistId;
    } catch (error) {
        console.error("Error fetching uploads playlist ID:", error);
        return null;
    }
}

// Load video list 
async function loadVideoList() {
    const playlistId = await fetchUploadsPlaylistId();
    if (!playlistId) {
        console.error("No uploads playlist found.");
        return;
    }

    try {
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}&maxResults=50`;
        const response = await axios.get(url);
        const items = response.data.items;

        
        videoMap.clear();

        for (const item of items) {
            const title = item.snippet.title.toLowerCase().trim();
            const videoId = item.snippet.resourceId.videoId;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            videoMap.set(title, videoUrl);
        }
        console.log(`Loaded ${videoMap.size} videos from channel.`);
    } catch (error) {
        console.error("Error loading video list:", error);
    }
}


loadVideoList();

// Refresh the video list every hour
setInterval(loadVideoList, 60 * 60 * 1000);

// Listen for new messages
client.on("messageCreate", async (message) => {
    
    if (message.author.bot) return;

    
    const input = message.content.toLowerCase().trim();

    
    if (videoMap.size === 0) return;

    
    const titles = Array.from(videoMap.keys());

    
    const bestMatch = stringSimilarity.findBestMatch(input, titles);

    
    const threshold = 0.5;
    if (bestMatch.bestMatch.rating >= threshold) {
        const matchedTitle = bestMatch.bestMatch.target;
        const videoUrl = videoMap.get(matchedTitle);
        message.reply(`Here's the video you mentioned: ${videoUrl}`);
    }
});

// Login to Discord
client.login(DISCORD_TOKEN);
