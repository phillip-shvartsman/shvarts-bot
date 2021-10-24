
import { AudioPlayer, AudioPlayerStatus, AudioResource, createAudioPlayer, createAudioResource, DiscordGatewayAdapterCreator, entersState, joinVoiceChannel, VoiceConnection, VoiceConnectionDestroyedState, VoiceConnectionStatus } from '@discordjs/voice'; 
import { ApplicationCommandPermissionsManager, Client, Guild, GuildManager, Intents, TextBasedChannel, TextBasedChannels } from 'discord.js';
import {EventEmitter,once}from "events"
import internal from 'stream';
import winston from 'winston';
import ytdl from 'ytdl-core'
import config from './config.json'
import {logger} from './logger'

export class playQueue {
    guild : Guild;
    channelId : string; 
    eventEmitter : EventEmitter; 
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
    currentJob : {title:string, link:string}; 
    playQueueLogger : winston.Logger;
    mbDownloaded : number
    downloadGrab : number
    progressCounter : number
    constructor(textChannel:TextBasedChannels, guild:Guild, channelId:string)
    {
        this.textChannel = textChannel;
        this.guild = guild;
        this.channelId = channelId;
        this.eventEmitter = new EventEmitter();
        this.connection = undefined;
        this.workingJob = false;
        this.audioPlayer = createAudioPlayer();
        this.queue = []
        this.currentJob = null
        this.idleCount = 0
        this.stale = false
        this.progressCounter = 0
        this.playQueueLogger = logger.child({guildId:guild.id,channelId:channelId,currentJob:this.currentJob})
        this.mbDownloaded = 0
        this.boundProcessQueue = this.processQueue.bind(this)
        this.boundIdleCheck = this.checkForIdle.bind(this)
        this.eventEmitter.on('process',this.boundProcessQueue)
        this.idleCheckInterval = setInterval(this.boundIdleCheck, 60000); 
    }

    getQueueString() : string
    {
        this.playQueueLogger.info("Getting queue string") 
        if(this.currentJob == null)
        {
            return "Nothing playing."
        }
        else
        {
            var replyString = "Currently playing:\n"
            replyString = replyString + this.currentJob["title"] + "\n"
            for(var i = 0 ; i < this.queue.length ; i++)
            {
                if(i==0)
                {
                    replyString = replyString + "\nQueue: \n"
                }
                let entry = i + ": " + this.queue[i]["title"] + "\n"
                replyString = replyString + entry; 
            }
            return replyString;
        }
    }

    getChannelId() : string
    {
        return this.channelId;
    }

    addToQueue(title:string,link:string) : void
    {
        this.playQueueLogger.info("Adding track to queue", {title:title})
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
            try{
                this.audioPlayer.pause()
            } catch(err)
            {
                this.playQueueLogger.error(err);
                return false
            }
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
        this.playQueueLogger.debug("Popping job off of queue.")
        this.currentJob = this.queue.shift()
        if(this.currentJob == undefined)
        {
            this.playQueueLogger.error("Job is undefined!")
            return;
        }
        this.workingJob = true;
        this.playQueueLogger = logger.child({guildId:this.guild.id,channelId:this.channelId,currentJob:this.currentJob})
        this.textChannel.send("Playing: " + this.currentJob.title);
        this.playNext(this.currentJob.link);
        await new Promise((resolve, reject)=>{
            this.audioPlayer.once(AudioPlayerStatus.Idle, resolve);
        });
        this.playQueueLogger.info("Job finished.")
        this.currentJob = null
        this.workingJob = false;
        this.eventEmitter.emit('process');
    }

    async playNext(url:string)
    {
        if(this.connection == undefined || this.connection.state.status != VoiceConnectionStatus.Ready)
        {
            this.playQueueLogger.info("Connecting to voice channel")
            try{
                this.connection = joinVoiceChannel({
                    channelId: this.channelId,
                    guildId: this.guild.id,
                    //@tts-ignore
                    adapterCreator: this.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
                });
            } catch(err) {
                this.playQueueLogger.error("Failed to connect to voice channel.")
                this.playQueueLogger.error(err)
            }
            // Make sure the connection is ready before processing the user's request
            try {
                await entersState(this.connection, VoiceConnectionStatus.Ready, 20e3);
            } catch (error) {
                this.playQueueLogger.error("Failed to connect to channel.")
                this.playQueueLogger.error(error)
                return;
            }   
        }
        try{
            this.playQueueLogger.debug("Creating new stream object.")
            var info = await ytdl.getInfo(url);
            var audioFormats = ytdl.filterFormats(info.formats,'audioonly')
            var itag = 0;
            var bitrate = 0;
            var chosenFormat : ytdl.videoFormat = null;
            audioFormats.forEach(format=>{
                if(format.mimeType == 'audio/webm; codecs="opus"' && format.audioBitrate > bitrate)
                {
                    bitrate = format.bitrate
                    itag = format.itag
                    chosenFormat = format
                }
            })
            if(this.stream != undefined)
            {
                this.stream.removeAllListeners('progress');
            }
            this.stream = ytdl(url, 
                {format:chosenFormat} 
            );
            this.stream.once('info',(info,videoFormat) => {
                this.playQueueLogger.debug(videoFormat)
            });
            await once(this.stream,'readable')
        } catch(err)
        {
            this.playQueueLogger.error(err);
        }
        this.playQueueLogger.info("Waiting for progress on audio stream before opening with log.")
        this.stream.on('progress', (chunkLength, downloaded, total) => {
            this.mbDownloaded = this.mbDownloaded + ((chunkLength / 1024) / 1024)       
            this.progressCounter = this.progressCounter + 1
            
            if(this.progressCounter == 20)
            {
                this.progressCounter = 0
                this.playQueueLogger.debug("progress on download",{mbDownloaded:this.mbDownloaded.toFixed(2),percent:(downloaded/total).toFixed(2)})
            }
        });
        try{
            this.resource = createAudioResource(this.stream);
            this.playQueueLogger.info("Creating new resource.")
        }
        catch(error)
        {
            this.playQueueLogger.error("Failed to create resource!")
            this.playQueueLogger.error(error);
        }
        this.connection.subscribe(this.audioPlayer);
        this.audioPlayer.play(this.resource);
        this.eventEmitter.emit('process') 
    }

    cleanup()
    {
        this.playQueueLogger.info("Performing cleanup.")
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
                this.playQueueLogger.info("Queue is now stale.")
                this.stale = true
            }
        }
    }

    jumpInQueue(position: string)
    {
            this.queue.slice(parseInt(position))
            this.audioPlayer.stop()
    }
}
