import express from 'express';

import { ApplicationCommandPermissionsManager, Client, Guild, GuildManager, Intents, TextBasedChannels } from 'discord.js';

import discordConfig from './discord-config.json';

import * as db from './database/db'

var events = require('events');
var eventEmitter = new events.EventEmitter();

import ytdl from 'ytdl-core'
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({intents:['GUILD_MESSAGES','GUILD_VOICE_STATES','GUILDS']});

import * as voice from '@discordjs/voice';
import { serialize } from 'v8';
import { removeAllListeners } from 'process';
const { Routes } = require('discord-api-types/v9');
import internal from 'stream';
const audioPlayer = voice.createAudioPlayer();
var resource;
var connection : voice.VoiceConnection;
var queue : {title:string, link:string, channelId:string, guild:Guild}[] = [];
var workingJob = false;
var stream : internal.Readable;
var currentChannel : TextBasedChannels;

const app = express();
const port = 3000;

db.instantiate()

let start = Date.now();

app.listen(port, () => {
    console.log("Listening on : %d", port);
    
});
client.once('ready', () => {
	console.log('Ready!');
});

async function playNext(url:string, channelId : string, guild: Guild)
{
    if(connection == undefined || connection.state.status != voice.VoiceConnectionStatus.Ready)
    {
        connection = voice.joinVoiceChannel({
            channelId: channelId,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator as unknown as voice.DiscordGatewayAdapterCreator,
        });
    
        // Make sure the connection is ready before processing the user's request
        try {
            await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 20e3);
        } catch (error) {
            console.warn(error);
            return;
        }
    }
    stream = ytdl(url, {
        quality: 'highestaudio'
    });
    stream.removeAllListeners('progress');
    stream.on('progress',  (chunkLength, downloaded, total) => {
        const percent = downloaded / total;
        console.log(percent);
    });
    try{
        resource = voice.createAudioResource(stream);
        console.log("Created resource.");
    }
    catch
    {
        console.error("Failed to create resource.");
    }
    connection.subscribe(audioPlayer);
    audioPlayer.play(resource); 
}

client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;
    const { commandName } = interaction;
    currentChannel = interaction.channel
	if (commandName === 'queue') {
    
        const guild = client.guilds.cache.get(interaction.guildId);
        const member = await guild.members.fetch(interaction.member.user.id);
        const voiceChannelId = member.voice.channelId;
        var link = interaction.options.getString('link');
        var result = await ytdl.getInfo(link);
        var title = result.videoDetails.title;
        console.log('Adding %s to queue', title)
        queue.push({title:title, link:link, channelId:voiceChannelId, guild:guild});
        eventEmitter.emit('process');
        interaction.reply("Added " + title + " to queue, position " + queue.length + ".")
	}
    else if (commandName === "print-queue")
    {
        if(queue == undefined || queue.length == 0)
        {
            await interaction.reply("Queue is empty!");
        }
        else
        {
            var replySting = "Current song queue:\n"
            for(var i = 0 ; i < queue.length ; i++)
            {
                let entry = i + ": " + queue[i]["title"] + "\n"
                replySting = replySting + entry; 
            }
            await interaction.reply(replySting);
        }
    }
    else if (commandName === "next")
    {
        await interaction.reply("Stopping current song and playing next.");
        audioPlayer.stop() 
    }
    else if(commandName === "test-queue")
    {
        const guild = client.guilds.cache.get(interaction.guildId);
        const member = await guild.members.fetch(interaction.member.user.id);
        const channelId = member.voice.channelId;
        var link = "https://www.youtube.com/watch?v=0bOUOCo6NLQ" 
        var result = await ytdl.getInfo(link);
        var title = result.videoDetails.title;
        console.log('Adding %s to queue', title)
        queue.push({title:title, link:link,channelId:channelId,guild:guild});
        eventEmitter.emit('process'); 
        interaction.reply("Added " + title + " to queue, position " + queue.length + ".")
    }
    else if (commandName === "pause") {
        if(audioPlayer.state.status == voice.AudioPlayerStatus.Playing)
        {
            audioPlayer.pause()
            await interaction.reply("Paused")
        }
        else 
        {
            await interaction.reply("Paused")
        }
    }
    else if (commandName === "unpause") {
        if(audioPlayer.state.status == voice.AudioPlayerStatus.Paused)
        {
            audioPlayer.unpause()
            await interaction.reply("Unpaused")
        }
        else
        {
            await interaction.reply("Nothing paused.")
    
        }
    }
});


client.login(discordConfig.token).then(result => {
    db.addGuilds(client.guilds);
}).catch( err => console.log(err));


eventEmitter.on('process', processQueue);

async function processQueue()
{
    if(workingJob)
    {
        return;
    }
    const job = queue.shift()
    if(job == undefined)
    {
        return;
    }
    workingJob = true;
    await currentChannel.send("Playing: " + job.title);
    playNext(job.link,job.channelId,job.guild);
    console.log("Waiting for song to finish playing.")
    await new Promise((resolve, reject)=>{
        audioPlayer.once(voice.AudioPlayerStatus.Idle, resolve);
    });
    console.log("Song finished!");
    workingJob = false;
    eventEmitter.emit('process');
}