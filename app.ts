import express from 'express';

import { ApplicationCommandPermissionsManager, Client, Guild, GuildManager, Intents, TextBasedChannels } from 'discord.js';

import discordConfig from './discord-config.json';
import {playQueue} from './playQueue'

var events = require('events');
var eventEmitter = new events.EventEmitter();

import ytdl from 'ytdl-core'

const client = new Client({intents:['GUILD_MESSAGES','GUILD_VOICE_STATES','GUILDS']});

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

import * as voice from '@discordjs/voice';
import internal from 'stream';
const audioPlayer = voice.createAudioPlayer();

var playQueues : playQueue[] = []

const app = express();
const port = 3000;

const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const commands = [
	new SlashCommandBuilder().setName('queue').setDescription('queue up a song').addStringOption(option => option.setName('link').setDescription('Youtube link to the song you want to play.')),
    new SlashCommandBuilder().setName('test-queue').setDescription('test adding a song on the queue'),
    new SlashCommandBuilder().setName('next').setDescription('Play next song in queue.'),
    new SlashCommandBuilder().setName('print-queue').setDescription('Print the current queue'),
    new SlashCommandBuilder().setName('pause').setDescription('pause current song'),
    new SlashCommandBuilder().setName('unpause').setDescription('unpause current song')
].map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(discordConfig.token);


async function addGuilds(gM : GuildManager)
{
    gM.cache.forEach(async (guildCache) => 
    {
        let guild : Guild = await gM.fetch({guild:guildCache.id, withCounts:false});
        rest.put(Routes.applicationGuildCommands(discordConfig.clientId, guildCache.id), { body: commands })
    	.then(() => console.log('Successfully registered application commands with guild ID: %d', guildCache.id))
    	.catch(console.error);

    });
}
let start = Date.now();

app.listen(port, () => {
    console.log("Listening on : %d", port);
    
});
client.once('ready', () => {
	console.log('Ready!');
});



client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;
    const { commandName } = interaction;

    const guild = client.guilds.cache.get(interaction.guildId);
    const member = await guild.members.fetch(interaction.member.user.id);
    const voiceChannelId = member.voice.channelId;
    var playQueueIndex = -1;

    for(var i : number = 0; i < playQueues.length; i++)
    {
        if(playQueues[i].getChannelId() == voiceChannelId)
        {
            playQueueIndex = playQueues.length - 1;
        }
    }
    if(playQueueIndex == -1)
    {
        console.log("Creating new queue");
        playQueues.push(new playQueue(interaction.channel, guild, voiceChannelId))
        playQueueIndex = playQueues.length - 1;
    }
    if (commandName === 'queue') {
    
        var link = interaction.options.getString('link');
        var result;
        try {
            result = await ytdl.getInfo(link);
        }
        catch
        {
            interaction.reply("Failed to find song with this link.");
            return
        }
        var title = result.videoDetails.title;
        console.log('Adding %s to queue', title)
        playQueues[playQueueIndex].addToQueue(title,link)
        var queueLength = playQueues[playQueueIndex].getQueueSize()
        interaction.reply("Added " + title + " to queue, position " + queueLength + ".")
	}
    else if (commandName === "print-queue")
    {
       interaction.reply(playQueues[playQueueIndex].getQueueString()) 
    }
    else if (commandName === "next")
    {
        await interaction.reply("Stopping current song and playing next.");
        playQueues[playQueueIndex].next()
    }
    else if(commandName === "test-queue")
    {
        var link = "https://www.youtube.com/watch?v=0bOUOCo6NLQ" 
        var result; 
        try 
        {
            result = await ytdl.getInfo(link);
        }
        catch
        {
            interaction.reply("Link broken!");
            return
        }
        var title = result.videoDetails.title;
        console.log('Adding %s to queue', title)
        playQueues[playQueueIndex].addToQueue(title,link)
        var queueLength = playQueues[playQueueIndex].getQueueSize()
        interaction.reply("Added " + title + " to queue, position " + queueLength + ".")
    }
    else if (commandName === "pause") 
    {
        if(playQueues[playQueueIndex].pause())
        {
            interaction.reply("Playback paused.");
        }     
        else
        {
            interaction.reply("Nothing playing.");
        }
        
    }
    else if (commandName === "unpause") 
    {
        if(playQueues[playQueueIndex].unpause())
        {
            interaction.reply("Playback resumed.");
        }     
        else
        {
            interaction.reply("Nothing paused.");
        }        
    }
});


client.login(discordConfig.token).then(result => {
    addGuilds(client.guilds);
}).catch( err => console.log(err));

console.log(voice.generateDependencyReport());