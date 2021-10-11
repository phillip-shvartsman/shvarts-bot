import sqlite3, { Statement } from 'sqlite3';
import { Client, Guild, GuildManager, Intents} from 'discord.js';
import {Mutex, MutexInterface, Semaphore, SemaphoreInterface, withTimeout} from 'async-mutex';
import { compileFunction } from 'vm';
import { channel } from 'diagnostics_channel';


import discordConfig from '../discord-config.json';


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

const dbMutex = new Mutex;

var db = new sqlite3.Database('./main.db');

export async function instantiate()
{
    let releaseGuildTable = await dbMutex.acquire();
    console.log("Creating guilds table.");
    db.exec("CREATE TABLE IF NOT EXISTS guilds ( id INTEGER PRIMARY KEY, name TEXT NOT NULL);", async (err : Error) => {
        releaseGuildTable();
    })
    console.log("Creating channel table.");
        
}

export async function addGuilds(gM : GuildManager)
{
    gM.cache.forEach(async (guildCache) => 
    {
        const release = await dbMutex.acquire();
        let guild : Guild = await gM.fetch({guild:guildCache.id, withCounts:false});
        rest.put(Routes.applicationGuildCommands(discordConfig.clientId, guildCache.id), { body: commands })
    	.then(() => console.log('Successfully registered application commands with guild ID: %d', guildCache.id))
    	.catch(console.error);

       db.run('INSERT INTO guilds (id, name) VALUES (?, ?)', guild.id, guild.name, (result, err) => 
        {
            release();
        })
    });
    gM.cache.forEach( async guildCache => 
    {
        const release = await dbMutex.acquire();
        guildCache.channels.cache.forEach( async channelCache =>
        {
            console.log(channelCache.isVoice());
            console.log(channelCache.id);
            console.log(channelCache.name);
            release();
        });                  
    })
}
