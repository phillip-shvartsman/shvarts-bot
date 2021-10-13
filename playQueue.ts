
import { AudioPlayer, AudioPlayerStatus, AudioResource, createAudioPlayer, createAudioResource, DiscordGatewayAdapterCreator, entersState, joinVoiceChannel, VoiceConnection, VoiceConnectionDestroyedState, VoiceConnectionStatus } from '@discordjs/voice'; 
import { ApplicationCommandPermissionsManager, Client, Guild, GuildManager, Intents, TextBasedChannels } from 'discord.js';
import * as events from "events"
import internal from 'stream';
import ytdl from 'ytdl-core'

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
    constructor(guild:Guild, channelId:string)
    {
        this.guild = guild;
        this.channelId = channelId;
        this.eventEmitter = new events.EventEmitter();
        this.connection = undefined;
        this.workingJob = false;
        this.audioPlayer = createAudioPlayer();
        this.queue = []
    
        this.boundProcessQueue = this.processQueue.bind(this)
        this.eventEmitter.on('process',this.boundProcessQueue)
    }

    getQueueString() : string
    {
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
        console.log("Pushed to queue."); 
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
        console.log(this.workingJob)
        if(this.workingJob)
        {
            return;
        }
        const job = this.queue.shift()
        if(job == undefined)
        {
            return;
        }
        this.workingJob = true;
        this.playNext(job.link);
        console.log("Waiting for song to finish playing.")
        await new Promise((resolve, reject)=>{
            this.audioPlayer.once(AudioPlayerStatus.Idle, resolve);
        });
        console.log("Song finished!");
        this.workingJob = false;
        this.eventEmitter.emit('process');
    }

    async playNext(url:string)
    {
        if(this.connection == undefined || this.connection.state.status != VoiceConnectionStatus.Ready)
        {
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
                console.warn(error);
                return;
            }   
        }
        console.log(this.connection.joinConfig)
        this.stream = ytdl(url, {
            quality: 'highestaudio'
        });
        this.stream.removeAllListeners('progress');
        try{
            this.resource = createAudioResource(this.stream);
            console.log("Created resource.");
        }
        catch
        {
            console.error("Failed to create resource.");
        }
        this.connection.subscribe(this.audioPlayer);
        this.audioPlayer.play(this.resource);
        this.eventEmitter.emit('process') 
    }
}
