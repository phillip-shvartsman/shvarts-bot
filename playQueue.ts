
import { AudioPlayer, AudioPlayerStatus, AudioResource, createAudioPlayer, createAudioResource, DiscordGatewayAdapterCreator, entersState, joinVoiceChannel, VoiceConnection, VoiceConnectionDestroyedState, VoiceConnectionStatus } from '@discordjs/voice'; 
import { ApplicationCommandPermissionsManager, Client, Guild, GuildManager, Intents, TextBasedChannel, TextBasedChannels } from 'discord.js';
import * as events from "events"
import internal from 'stream';
import ytdl from 'ytdl-core'
import config from './config.json'
import {logger} from './logger'

export class playQueue {
    guild : Guild;
    channelId : string; 
    eventEmitter : events.EventEmitter; 
    connection : VoiceConnection;
    workingJob : boolean;
    audioPlayer : AudioPlayer;
    stream : internal.Readable;
    resource : AudioResource;
    queue : {title:string, link:string}[];
    boundProcessQueue : any;
    boundIdleCheck : any;
    textChannel : TextBasedChannels;
    idleCount : number;
    stale : boolean;
    idleCheckInterval : NodeJS.Timeout;
    playQueueId : string;
    constructor(textChannel:TextBasedChannels, guild:Guild, channelId:string)
    {
        this.playQueueId = guild.id + channelId
        logger.info('%s: Creating new play queue', this.playQueueId)
        this.textChannel = textChannel;
        this.guild = guild;
        this.channelId = channelId;
        this.eventEmitter = new events.EventEmitter();
        this.connection = undefined;
        this.workingJob = false;
        this.audioPlayer = createAudioPlayer();
        this.queue = []
        this.idleCount = 0
        this.stale = false

        this.boundProcessQueue = this.processQueue.bind(this)
        this.boundIdleCheck = this.checkForIdle.bind(this)
        this.eventEmitter.on('process',this.boundProcessQueue)
        this.idleCheckInterval = setInterval(this.boundIdleCheck, 60000); 
    }

    getQueueString() : string
    {
        logger.info("%s: Getting queue string") 
        if(this.queue == undefined || this.queue.length == 0)
        {
            return "Queue is empty!";
        }
        else
        {
            var replySting = "Current song queue:\n"
            for(var i = 0 ; i < this.queue.length ; i++)
            {
                let entry = i + ": " + this.queue[i]["title"] + "\n"
                replySting = replySting + entry; 
            }
            return replySting;
        }
    }

    getChannelId() : string
    {
        return this.channelId;
    }

    addToQueue(title:string,link:string) : void
    {
        logger.info("%s: Adding track to queue, %s", this.playQueueId, title)
        this.queue.push({title:title, link:link});
        this.eventEmitter.emit('process');
    }

    getQueueSize() : number 
    {
        return this.queue.length;
    }

    pause() : boolean
    {
        if(this.audioPlayer.state.status == AudioPlayerStatus.Playing)
        {
            this.audioPlayer.pause()
            return true
        }
        return false;
    }

    unpause() : boolean
    {
        if(this.audioPlayer.state.status == AudioPlayerStatus.Paused)
        {
            this.audioPlayer.unpause()
            return true
        }
        return false;
    }

    next() : void
    {
        this.audioPlayer.stop()
    }
    async processQueue()
    {
        if(this.workingJob)
        {
            this.stale = false
            return;
        }
        logger.info("%s: Working new job.", this.playQueueId)
        const job = this.queue.shift()
        if(job == undefined)
        {
            return;
        }
        this.workingJob = true;
        this.textChannel.send("Playing: " + job.title);
        this.playNext(job.link);
        await new Promise((resolve, reject)=>{
            this.audioPlayer.once(AudioPlayerStatus.Idle, resolve);
        });
        logger.info("%s: Job finished.", this.playQueueId)
        this.workingJob = false;
        this.eventEmitter.emit('process');
    }

    async playNext(url:string)
    {
        if(this.connection == undefined || this.connection.state.status != VoiceConnectionStatus.Ready)
        {
            logger.info("%s: Connecting to voice channel", this.playQueueId)
            this.connection = joinVoiceChannel({
                channelId: this.channelId,
                guildId: this.guild.id,
                //@tts-ignore
                adapterCreator: this.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
            });
        
            // Make sure the connection is ready before processing the user's request
            try {
                await entersState(this.connection, VoiceConnectionStatus.Ready, 20e3);
            } catch (error) {
                logger.error("%s: Failed to connect to channel.", this.playQueueId)
                logger.error(error)
                return;
            }   
        }

        this.stream = ytdl(url, {
            quality: 'highestaudio'
        });
        this.stream.removeAllListeners('progress');

        try{
            this.resource = createAudioResource(this.stream);
            logger.info("%s: Creating new resource.", this.playQueueId)
        }
        catch(error)
        {
            logger.error("%s: Failed to create resource!", this.playQueueId)
            logger.error(error);
        }
        this.connection.subscribe(this.audioPlayer);
        this.audioPlayer.play(this.resource);
        this.eventEmitter.emit('process') 
    }

    cleanup()
    {
        logger.info("%s: Performing cleanup.", this.playQueueId)
        this.stream.destroy()
        clearTimeout(this.idleCheckInterval) 
        this.connection.destroy()
        this.eventEmitter.removeAllListeners()
    }

    checkForIdle()
    {
        if(this.workingJob)
        {
            this.idleCount = 0
            this.stale = false
        }
        else
        {
            this.idleCount = this.idleCount + 1;
            if(this.idleCount >= config.idle_time)
            {
                logger.info("%s: Queue is now stale.", this.playQueueId)
                this.stale = true
            }
        }
    }
}
